# ADR 0010 — Temporary spending reviews and permanent monthly reports

Status: accepted for v3 · 2026-09-26

## Context

The owner wants to compare each month's budget with actual spending without keeping every transaction permanently: gather a month, classify it, clear it, and keep only a summary report. A review can take days when an institution is slow or needs re-authentication, and the work must survive a browser crash, a reload, or a switch between phone and Mac.

The obvious place for in-progress data, the synced SQLite profile, is the wrong one. V2.2 snapshots are whole-database versions, append-only and kept indefinitely ([ADR 0007](0007-guarded-cloud-snapshots.md)). Any transaction written to the profile would be copied into every snapshot taken while the review was open and would outlive the review.

## Decision

1. **A separate review store.** Transactions, dispositions, coverage state and waivers for an open review live in a review store that is not the profile database. The profile holds only an index row per review (`spending_review_sessions`: a random reference, the month, the state and timestamps), which also serves as a tombstone after clearing.
2. **Encrypted everywhere.** Each save is a complete review document encrypted with the data key ([ADR 0008](0008-single-user-sign-in.md)) using AES-256-GCM with a fresh random nonce. The review reference, month and revision are authenticated as associated data, so a copy cannot be replayed under another month or rolled back unnoticed.
3. **Two copies.** A local copy (an IndexedDB object store on the web; a file under the desktop app-data directory, outside the profile file) is written about a second after each change. A service copy is written a few seconds later with a conditional revision check, like snapshots. If both copies changed independently, the app stops and asks which to keep rather than merging.
4. **The service keeps no history for reviews.** It stores only the latest revision, replaces it in place, and deletes it permanently on request. It deletes a review automatically 14 days after its last change, and never keeps one more than 45 days after it started. It enforces an 8 MiB size limit and at most three open reviews.
5. **Clearing moves the result, then deletes the work.** Clearing writes the spending report into the profile in one transaction, marks the index row cleared, and deletes both review copies. Devices that later sync the tombstone delete any local copy they still hold, and the service refuses to store a review it has deleted.
6. **Local-only desktop profiles** have no password-derived key and keep their profile unencrypted, as v2.2 does. Their review file sits beside the profile with the same protection (FileVault) and is deleted on the same events. The macOS Keychain is not used: an ad-hoc-signed app cannot rely on it ([Security §5.4](../v3/security.md#54-sessions-idle-lock-and-sign-out)).
7. **Reports are summaries.** A cleared report stores only the fields listed in [Spending review rules §9](../v3/spending-review-rules.md#9-the-spending-report). One report per month; re-running replaces it only when the new review is cleared.

## Alternatives considered

- **Keep transactions in the profile and purge them on clearing.** Rejected: every snapshot taken during the review would keep them.
- **Keep reviews only on the device.** Rejected: clearing browser data would lose the work, and the owner could not start on the phone and finish on the Mac.
- **Keep transactions permanently.** Rejected by the owner for v3. The review store's format can be reused if a later version chooses to keep history.

## Consequences

- The service sees each review's size and write times, but not its month, content or number of transactions.
- An attacker who controls the signed-in browser or the running service during a review can see that review's transactions. The design limits what exists at rest, not what a compromised session can see.
- Expiry can delete unfinished work. The app warns after 7 days without a change and 3 days before the 45-day limit; any change restarts the 14 days. A month that outlasts 45 days is finished with files or waivers, or started again.
- Railway volume backups, where enabled, can keep review ciphertext for up to 89 days. It is readable only with the data key.
- Late-posting detection (Spending review rules §8) replaces the ability to look back through old transactions.
