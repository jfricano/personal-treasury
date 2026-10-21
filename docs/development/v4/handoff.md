# V4 handoff — 20 October 2026

For the next session or team that continues v4. It records the state of the repository and of the v4 specification on this date. The specification itself ([README](README.md)) is the authoritative record; this page points into it.

## 1. Where things stand

| Item | State |
| --- | --- |
| Repository | `github.com/jfricano/personal-treasury` (public). |
| `main` | `8a1c435`, matching `origin/main`. It ships v3 as **v0.3.0-preview.2** (schema 5): sign-in, Budget Analysis, Connected Accounts, cleared spending reports and balance snapshots. V3's stable-release gates are still open; see [v3 preview status](../v3/preview-status.md#remaining-release-work). |
| `v4/spec` | Documentation only, open as a draft pull request to `main`. Every commit is signed with the owner's key. |
| Open pull request | **#19** `repo-docs/agent-instructions-20261020` (tracks the shared agent-instruction entry points in the repository root). The owner merges it; nobody else should touch it. |
| Operations | Before any credential, sync-service, deployment, signing-key or history-rewriting work, confirm with the owner that no operational issue is open. |

## 2. What v4 is

The owner asked whether treasury accounts are really "physical" accounts, 1:1 with real bank accounts, and whether the system takes full advantage of that. An accounting review (private, because it cites the owner's records) found:

- **Mostly yes.** Cash buckets each behave like one real account. Cards have their own codes but are debts that several buckets spend on. The account pay lands in isn't modeled. A few codes are parties to debts (a person, a non-cash account), not accounts.
- **The monthly final-transfer method is already the minimum number of real transfers.** Don't "optimize" netting.
- **The gaps:**
  - debt payments are entered twice;
  - the debt headline counts payments scheduled for future months;
  - canceled debts have no proper write-off;
  - the app never checks its plan against the balances the bank reports.

Start at the [v4 README](README.md), which has the review record and the next step.

| Slice | What it does | Needs |
| --- | --- | --- |
| **B0** (ship first) | Cleared reports keep per-pair totals (spending paid from one account, funded by another) and rules may match on an account alone. | Nothing. Each month cleared without B0 permanently loses data that proposals need. |
| **Track A** (A1–A7 + close checklist) | Account roles (cash bucket, card, counterparty) and the hub; a debt payment entered once; a journal-to-ledger tie-out; the debt summary as of a date; write-off and reassign; pairs, pay-pair and offsets; cent amounts and standing transfers. | No institution data. |
| **Track B** (B1–B6) | Required 1:1 links (replacing v3's optional link and "Shared"); proof of cash, economic balance and card coverage; two-way transfer verification with one-click Done; settlement proposals; sinking-fund floors and targets; the full month-end close. | v3's connected accounts and reports (shipped). |
| **D, R** | Documentation and regenerated demo screenshots, then release. | Everything else. |

### The accountant's recommendations, and where each lives

| # | Recommendation | v4 requirements | Slice |
| --- | --- | --- | --- |
| 1 | Declare each account's role and link it to its real account | FR-ACCT-1–9 | A1 (roles, hub), B1 (links) |
| 2 | Enter each debt payment once; tie the journal to the debt ledger | FR-DEBT-1–3, FR-TIE-1–5 | A3, A4 |
| 3 | Debt summary as of a date; write-offs; aging | FR-DEBT-4–8, FR-DEBT-13 | A2, A5 |
| 4 | Observed-balance checks: proof of cash, economic balance, card coverage, hub | FR-BAL-1–7 | B2 |
| 5 | Two-way transfer verification at cents; one-click Done | FR-VER-1–5, FR-MON-1 | A7, B3 |
| 6 | Settlement proposals from classified spending | FR-SETTLE-1–7 | B0, B4 |
| 7 | Standing transfers for the fixed allocations | FR-MON-2–5 | A7 |
| 8 | Pair view, pay-pair, offsets | FR-DEBT-9–11 | A6 |
| 9 | Sinking-fund floors, targets, sweep suggestions | FR-BAL-8 | B5 |
| 10 | Month-end close checklist | FR-CLOSE-1–4 | Track A part, B6 |

- The accountant's 16 owner decisions keep their numbers (OD1–OD16) in [product spec §9](product-spec.md#9-owner-decisions); OD17–OD21 came from writing the spec.
- The accountant's review of the draft (2 blockers, 11 should-fix) is fully resolved, and the accountant agreed with the spec's seven departures from the memo.
- **Owner actions outside the app:**
  - work through the private data questions (OD5, OD7, OD8) with write-offs and adjusting events once A4 and A5 ship ([plan §8](implementation-plan.md#8-owner-rollout) step 4);
  - set up recurring transfers or split direct deposit at the bank (OD14);
  - keep one real account per bucket, and the hub and most-used buckets at one institution.
- **One small open gap:** the memo recommends the first cleared report's balances as each account's opening balance. The spec does this implicitly (proof of cash starts from the previous report) but never says so. Add one sentence to [treasury rules](treasury-rules.md) §13.

## 3. What the owner must decide next

Product spec §9 lists 21 owner decisions, each with a recommended default. Nothing gets built until the first two are answered:

- **OD19:** make the changes to shipped v3 in [product spec §10](product-spec.md#10-changes-v4-makes-to-shipped-v3) (required links, no Shared, account-only rules, funding-pair totals, cent matching, a narrower "no confirmations from bank data" non-goal). Recommended: yes, B0 first.
- **OD21:** how Track A ships. Recommended: slice by slice from `main`, in the next v0.3 previews, with every behavior change behind a setting that starts at today's behavior.

OD5, OD7 and OD8 are the owner's private data-cleanup questions about specific imported debts. They exist only in the owner's private notes and must never appear in public files.

## 4. Suggested next actions

1. Confirm with the owner that no operational issue is open, or what is off-limits while one is.
2. Get the owner's answers to OD19 and OD21, then open a pull request for `v4/spec` → `main` (documentation only).
3. Build B0 on `v4/funding-pairs` from `main`.
4. Optional cleanup, **with the owner's approval** (remote deletion is outward-facing):
   - Thirteen GitHub branches belong to merged pull requests and can be deleted, plus `v3/spec` later; GitHub keeps a restore button on each pull request. They are: `codex/demo-native-download`, `codex/desktop-build-suffixes`, `codex/direct-mac-installer`, `codex/private-setup-guide`, `codex/t01-ingestion`, `codex/v2`, `codex/v2.2`, `codex/v2.2.1-docs`, `codex/v3-admin-auth-ideas`, `codex/v3-build`, `codex/v3-migration-reauth`, `codex/v3-release-docs`, `docs/practical-workflow-v3-publish-20261009`. Delete `v3/spec` once `v4/spec` no longer needs it as context.
   - The branch behind PR #16 (closed without merging): ask the owner before deleting it.

## 5. Ground rules that held in this work

- **Privacy:** the repository is public. Everything derived from the owner's workbooks stays in gitignored `reference/` and `tests/local/`. Public examples use the fictional Harper household (`src/demo/persona.ts`) and invented numbers. Run `npm run privacy:check` before every push; its terms list is `reference/privacy-terms.txt`. A worktree needs its own copy of that file, or the check silently skips.
- **Identity:**
  - commits are authored and signed as Jason Fricano with the GitHub noreply address and the SSH key;
  - no co-author trailers and no tool attribution in commits, pull requests or files;
  - if signing fails, stop and report it.
- **Authority:** the owner merges, tags, publishes and deploys. Ask before outward-facing actions: deleting remote branches, opening or merging pull requests, releases.
- **Parallel sessions:** uncommitted changes you didn't make may be another session's work in progress. Ask before stashing, resetting or cleaning. Use one worktree per concurrent editor. Never run `git clean -x` in the owner's checkout; it deletes the gitignored private files.
- **Delivery workflow** ([delivery workflow](../DELIVERY_WORKFLOW.md)):
  - one owner per increment, verified by its author;
  - focused independent review only for high-risk parts (migrations of existing data, backup and restore, the temporary-transaction boundary, auth and secrets);
  - one concise milestone update.
- **Domain rules:** the eleven domain rules and [data and calculation rules](../data-and-rules.md). Every v4 change to financial meaning is an owner decision and ships behind its setting.

## 6. Private material

The accounting review, the usage analysis, both reviews of the draft, and the workbook controls live only in the owner's local, gitignored `reference/` folder, so remote sessions can't read them. Ask the owner for anything specific from them; never copy their figures into the repository.
