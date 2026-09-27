# ADR 0010 — Temporary spending reviews and permanent monthly reports

Status: accepted for v3 · 2026-09-26

## Context

The owner wants to compare each month's budget with actual spending without keeping every transaction permanently: gather a month, classify it, clear it, and keep only a summary report. A review can take days when an institution is slow or needs re-authentication, and the work must survive a browser crash, a reload, or a switch between phone and Mac.

The obvious place for in-progress data, the synced SQLite profile, is the wrong one. V2.2 snapshots are whole-database versions kept for a long time ([ADR 0007](0007-guarded-cloud-snapshots.md)), the audit log keeps before-and-after copies of changed rows, and undo restores whole-database snapshots ([ADR 0005](0005-undo-audit-persistence.md)). Any transaction written to the profile would be copied into all of them and outlive the review. The same mechanisms would also rewind any record of which reviews exist.

## Decision

1. **A separate review store.** Transactions, dispositions, coverage state and waivers for an open review live in a review store that is not the profile database. The store also holds the **review index** (reference, month, state and timestamps) and the tombstones of deleted reviews, so database undo, restore, **Keep device copy** and snapshot restores never rewind them.
2. **Encrypted everywhere.** Each save is a complete review document encrypted with a key derived from the data key ([ADR 0008](0008-single-user-sign-in.md)), using AES-256-GCM with a fresh random nonce. The review's random reference, revision and key ID are authenticated as associated data, so a copy cannot be replayed under another reference or rolled back unnoticed. The month is inside the ciphertext.
3. **Two copies.** A local copy (IndexedDB on the web; a file under the desktop app-data directory, outside the profile file) is written about a second after each change, and the app shows **Saved**. A service copy is written every 30 seconds and when the page is hidden, with a conditional revision check. If both copies changed independently, the app stops and asks which to keep rather than merging.
4. **The service keeps no history for reviews.** It stores only the latest revision, replaces it in place, and deletes it permanently on request. It deletes a review automatically 14 days after its last change, and never keeps one more than 45 days after it started. It enforces an 8 MiB size limit and at most three open reviews, lists references for the index, and refuses writes to a deleted reference for 90 days.
5. **Clearing moves the result, then deletes the work.** Clearing writes the spending report into the profile in one transaction, waits until the profile is saved (and, for a connected profile, uploaded), marks the review cleared in the index, and deletes both review copies. Devices that later see the tombstone delete any local copy they still hold.
6. **Undo of a clear** restores the previous report (or none); it does not bring back the transactions, and the owner is told so before clearing. Edits inside a review have their own in-memory undo history ([Spending review rules §16](../v3/spending-review-rules.md#16-undo-inside-a-review)).
7. **Local-only desktop profiles** have no password-derived key and keep their profile unencrypted, as v2.2 does. Their review file sits beside the profile with the same protection (FileVault) and is deleted on the same events. The macOS Keychain is not used, because an ad-hoc-signed app cannot rely on it ([Security §5.4](../v3/security.md#54-sessions-lock-and-sign-out)).
8. **Reports are summaries.** A cleared report stores only the fields listed in [Spending review rules §9](../v3/spending-review-rules.md#9-the-spending-report). One report per month; re-running replaces it only when the new review is cleared.

## Alternatives considered

- **Keep transactions in the profile and purge them on clearing.** Rejected: snapshots, audit rows and undo copies taken during the review would keep them.
- **Keep the review index in the profile.** Rejected: undo and restore would rewind it, resurrecting deleted reviews or dropping tombstones.
- **Keep reviews only on the device.** Rejected: clearing browser data would lose the work, and the owner could not start on the phone and finish on the Mac.
- **Keep transactions permanently.** Rejected by the owner for v3. The review store's format can be reused if a later version chooses to keep history.

## Consequences

- The service sees each review's size and write times, but not its month, content or number of transactions.
- An attacker who controls the signed-in browser or the running service during a review can see that review's transactions. The design limits what exists at rest, not what a compromised session can see.
- Expiry can delete unfinished work. The app warns after 7 days without a change and 3 days before the 45-day limit; any change restarts the 14 days. A month that outlasts 45 days is finished with files or waivers, or started again.
- After clearing, drill-downs stop at the report's rows: individual transactions are gone by design. Late-posting detection (Spending review rules §8) uses the report's per-account tail totals instead of transaction history, so a late posting dated more than 7 days before month end is not detected.
- Railway volume backups, where enabled, can keep review ciphertext for up to 89 days. It is readable only with the data key.
