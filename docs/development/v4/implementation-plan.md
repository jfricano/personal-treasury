# Personal Treasury v4: implementation plan and builder handoff

Prepared 2026-09-27 from the v3 specification on `v3/spec`, the v0.2.2 source on `main`, and a private accounting review of the treasury logic and the owner's history. This is a **build plan**. Nothing in it is implemented yet, and v3, which Track B depends on, isn't built either.

Read first: [Product specification](product-spec.md), [Treasury rules](treasury-rules.md), [Acceptance tests](acceptance-tests.md), and the [v3 implementation plan](../v3/implementation-plan.md).

## 1. Starting point

| Item | State on 2026-09-27 | V4 treatment |
| --- | --- | --- |
| `main` (v0.2.2) | Treasury, budget, tax, private web build, encrypted snapshot sync. Schema version 3. | Baseline for Track A's code. Every existing test must keep passing. |
| `v3/spec` | V3 specified: sign-in, Budget Analysis, Connected Accounts, balance snapshot. No code. | Track B depends on v3 slices S3–S9. The amendments in [product spec §10](product-spec.md#10-proposed-amendments-to-v3) would change v3's specification before S4, if the owner adopts them (OD19). |
| `v4/spec` (this branch) | The v4 documents and ADR 0011. | Merges into `main` by PR, documents only. |
| Treasury code the change touches | `src/domain/debts.ts` (`rollForward`, `debtPosition`, `summarizeDebts`, `paymentToChange`, `suggestChangeForTransfer`), `src/domain/monthly.ts` (`computeMonth`), `src/domain/types.ts`, `src/api/treasury.ts` (`createMonth`, `addTransfer`, `updateTransfer`, `deleteEntry`, `debtBoard`, `recordPayment`, `recordAdjustment`, `recordEntryOnDebt`, `dashboard`), `src/db/migrations.ts`, `src/import/analyze.ts`, `src/export/workbook.ts`, `src/export/backup.ts`, `src/demo/seed.ts`. | Extended, not replaced. `summarizeDebts` in all-events mode must return exactly what it returns today. |
| Evidence | The owner's history, analyzed privately, shows the final-transfer method already reaches the minimum number of real transfers, and that most journal rows repay debts. | No netting work. The debt workflow and the checks are where the time goes. |

## 2. Branches, authorship and releases

```text
main ──●───────────────────────────────●─────────────────────────────●── v0.4.0 tag
       │ (v4 spec merged)              ▲ (v0.3.0)                    ▲
       │                               │                             │ release PR
       │   Track A early (optional, §4):                             │
       └─► release/v3 ◄── v4/<A-slice> PRs                           │
                                       └─► release/v4 ──●──────●─────┘
                                                        ▲      ▲
                                             v4/<slice> PRs, one per slice
```

- **`v4/spec`** holds the v4 documents only. It merges into `main` by PR so the plan is visible, without code changes. It changes no file in `docs/development/v3/`; the v3 amendments are adopted, if at all, by a separate PR to v3's documents.
- **`release/v4`** is cut from `main` after v3 (v0.3.0) merges. It is the v4 integration branch. Nothing merges into `main` from v4 until the release gate (§9) passes.
- **Slice branches `v4/<slice>`** are cut from `release/v4` and return by pull request, one slice per branch, small enough to review in one sitting, rebased before review.
- **Track A early (§4):** if the owner wants Track A before v3's institution work, its slice branches are cut from `release/v3` instead and merge there by PR. Nothing else changes.
- **Fixes** to released versions go on `fix/<topic>` from `main` and are merged forward.
- **Authorship:** every commit is authored by the owner with the repository's configured noreply address. No co-author trailers and no tool attribution in commits, pull requests, code comments or documents.
- **Privacy:** `npm run privacy:check` before every push. The consult's memo and evidence, the owner's review questions (OD5, OD7, OD8) and every figure from the reference workbook stay in the gitignored `reference/` folder. Public tests use the Harper household and invented numbers only.
- **Parallel work** uses one git worktree per slice (`git worktree add ../pt-<slice> v4/<slice>`). Slices that need the private reference tests run them in the main checkout.

## 3. Slices

Each slice lists its requirements, what it delivers, its dependencies, and its gate: the evidence its pull request must include. Migrations are numbered when the slice merges (Treasury rules §17).

### Track A: no v3 data needed

#### A1 — Account kinds and the hub bucket (`v4/account-kinds`)

- FR-ACCT-1 to FR-ACCT-4, FR-UI-1 (Kind column and hub marker), FR-DEMO-1, FR-DATA-3 and FR-DATA-4 for accounts.
- `accounts.kind` and `is_hub` with their constraint and trigger; `Account` type; `AccountInput` schema; refusal paths in `createMonth`, `setAllocation`, `addTransfer`, `addAdvancedEntry` for counterparties; the card warning; the **Set up your accounts** prompt; export and import of the new account columns; `replace` import keeping them.
- Demo: Harper declares every kind, HH is the hub, and gains `CARD` (card) and `RELATIVE` (counterparty) with no debts, so the pinned controls are unchanged.
- Gate: V4-AT1; `npm run check`; `npm run db:check`; demo seed test updated; a workbook import with card-like and person-like codes leaves kinds empty.
- Runs first; no dependencies.

#### A2 — Debt payments entered once, claims, and the tie-out (`v4/debt-payments`)

- FR-DEBT-1 to FR-DEBT-3, FR-DEBT-6, FR-DEBT-12, FR-TIE-1 to FR-TIE-5, FR-UI-3 (tie-out panel).
- `debt_events.kind`, `link_role`, `link_origin`; `tie_out_acknowledgements`. Domain: the §8 cases, the claim options, `tieOut(month)`, the link-history matcher. Services: `addTransfer`, `updateTransfer` and `deleteEntry` writing and maintaining linked events in one transaction; the third-party dialog; **Link history** with bulk acceptance.
- Gate: V4-AT2, V4-AT3, V4-AT4; property test that the Σ of linked transfer events never exceeds an entry's amount; the migration hash test (no existing value changes); the private link-history review run locally against the reference workbook, with its counts recorded privately.
- After A1 (the outside-payment rule reads kinds). Beside A3 and A5.

#### A3 — As-of summary, write-offs, aging and the review queue (`v4/debts-as-of`)

- FR-DEBT-4 to FR-DEBT-8, FR-DATA-5, FR-UI-2 (as-of control, Scheduled, ages, Review queue, Write off), FR-UI-5 (debt headline), FR-DEMO-3.
- `summarizeDebts` takes `{ asOf } | 'all'`; `debtPosition` over counted events; `WRITTEN_OFF`; write-off service and preview; aging; `debt_reviews`; `meta.debt_summary_mode` and thresholds; export labels its summary sheet as all events.
- Demo: the seed dates no event after today.
- Gate: V4-AT5, V4-AT6, V4-AT7; the property test that `all` mode equals the pre-v4 summary field for field; the private reference-workbook controls passing unchanged in `all` mode.
- After A1. Beside A2 and A5. Merge before A4.

#### A4 — Pairs, pay pair and offsets (`v4/debt-pairs`)

- FR-DEBT-9 to FR-DEBT-11, FR-UI-2 (Pairs tab, Pay pair, Offset), FR-UI-7 (keyboard entry for them).
- Domain: pair view, pay-pair allocation, offset validation. Services: `payPair` (one entry, several linked payment events), `offset` (two events, one group, deleted together).
- Gate: V4-AT8; property tests that offsets preserve every net position and pair net, and that pay pair pays exactly its amount without passing zero.
- After A2 (linked events) and A3 (as-of positions).

#### A5 — Cents, standing amounts and the retained hub line (`v4/monthly-lines`)

- FR-MON-1 to FR-MON-5, FR-UI-3 (automatic and by-hand split, Retained).
- Cent rounding in `createMonth`, **Refresh allocations** and `diffMonthAgainstBudget`; two-decimal limit on new user amounts in `TransferInputSchema`, `AdvancedEntryInput` and the debt inputs; `standing_amount` columns and warnings; the retained state in `computeMonth`, behind `meta.hub_line_retained` (set only when the owner accepts OD16).
- Gate: V4-AT9, V4-AT10; the existing AT4 monthly-status tests passing unchanged with the setting off.
- After A1. Beside A2 and A3.

### Track B: needs v3

#### B1 — Required links (`v4/links`)

- FR-ACCT-5 to FR-ACCT-9, FR-UI-1 (editable link column and setup view).
- `institution_accounts.link_role` with its indexes and the migration from `shared` (Treasury rules §3), unless V3-A1 and V3-A2 were adopted, in which case this slice only adds the setup view and completeness checks.
- Gate: V4-AT11; migration test from a v3 database fixture that has Shared and duplicate mappings.
- After A1 and v3 S4 (institution accounts) and S7 (Connected Accounts).

#### B2 — Observed balances and checks (`v4/balances`)

- FR-BAL-1 to FR-BAL-7, FR-MON-6, FR-UI-4, FR-UI-6.
- `domain/balances`: `month_end`, proof of cash, economic balance and the consolidation identity, card coverage, card funding, hub checks, explanations. The optional statement opening balance on manual entry. The **Balances** page. `balance_check_notes`.
- Gate: V4-AT12; the Balances view empty without a cleared report; screenshot review at 390 and 1440 px.
- After B1, A3 (as-of net positions) and v3 S9 (balance snapshot).

#### B3 — Transfer verification (`v4/verification`)

- FR-VER-1 to FR-VER-5, FR-UI-3 (verification column and actions).
- Matching over the open review's transactions (in-month and context), statuses, **Mark verified lines Done**, **Transfers outside the plan**, `transfer_verifications`. Replaces v3's FR-REV-13 hint.
- Gate: V4-AT13; the canary scan extended to `transfer_verifications`; the v3 isolation test (V3-AT11) still passing, because verification writes only on the owner's click.
- After B1, A5 (cents) and v3 S3, S6a and S7.

#### B4 — Settlement proposals (`v4/settlements`)

- FR-SETTLE-1 to FR-SETTLE-7, FR-DEMO-2, FR-UI-3 (proposals panel).
- `spending_report_funding_pairs` (unless V3-A4 was adopted), written at clearing; the proposal list; `settlement_decisions`; `journal_entries.settlement_proposal_id`; replaced-report handling; the demo's card statement file.
- Gate: V4-AT14; the canary scan over the new tables and the generated descriptions; the "nothing posts without acceptance" test.
- After B1 and v3 S7. Beside B2 and B3.

#### B5 — Floors, targets and sweeps (`v4/sinking-funds`)

- FR-BAL-8.
- Account columns, suggestions on the Balances page, acceptance into a journal row.
- Gate: V4-AT15.
- After B2.

#### B6 — Month-end close (`v4/close`)

- FR-CLOSE-1 to FR-CLOSE-3, FR-UI-5.
- The computed checklist on the Dashboard. With Track A only, the Dashboard shows steps 4–6 and marks 1–3 **Needs connected accounts**; this part can ship with Track A.
- Gate: V4-AT16; an end-to-end run of a full close in the demo.
- After B2–B4 for the full checklist.

### D — Documentation and screenshots (`v4/docs`)

Documentation is part of the release. This slice runs after the other slices are feature-complete, so the text and images describe the shipped interface. Each item is a checkbox in the PR description.

**Release-specific documents (new):**

- `docs/release-notes-v0.4.0.md` (and, if Track A ships early, short notes for that v3.x release): what v4 adds, the one-time account setup, the as-of debt headline and how to see all recorded events, and backup guidance before the first write-off.
- `docs/development/v4-release-report.md`: scope implemented, test commands with counts, the acceptance-test map, native macOS results, and remaining limitations, in the style of the v2.2 report. No private figures.

**Standing documents (update in place, so a reader of `main` never needs the v4 folder):**

| Document | Change |
| --- | --- |
| `README.md` | "New in v0.4.0"; **What it does** gains account kinds, single-entry debt payments, the as-of debt summary, balance checks, verified transfers and the month-end close; screenshots. |
| `docs/README.md` | Index new documents; move the v4 planning documents under "History and plans". |
| `docs/guide/user-guide.md` | New sections: Setting up your accounts (kinds, hub, links), The month-end close, Paying debts (single entry, another bucket paying, pay pair, offsets), Debts as of a date and write-offs, Balances and checks, Verified transfers, Settlement proposals, Sinking funds. |
| `docs/guide/getting-started.md`, `demo-walkthrough.md` | The account setup step; the demo's card and a settlement proposal in the walkthrough. |
| `docs/development/data-and-rules.md` | The accepted v4 rules: kinds, the as-of summary, event kinds and Written off, the readiness wording if OD16 is accepted, new-amount precision, and a link to the treasury rules for the checks. |
| `docs/development/architecture.md` | New modules (`domain/balances`, the debt additions), tables and migrations, and the updated invariants. |
| `docs/development/acceptance-tests.md` | Fold in V4-AT1–V4-AT18 so the release gate lists one set. |
| `docs/development/workbook-import.md` | The new export columns, and that kinds and links are never imported from other workbooks. |
| `docs/development/development.md`, `testing.md` | New suites, properties and fixtures. |
| `docs/development/decisions/` | ADR 0011 marked accepted with its final details; ADR 0004 updated for single-entry recording. |

**Screenshots:**

- Regenerate every image with `npm run docs:screenshots` from the **demo build only** (the fictional Harper household), with the fixed clock, fixed viewports and reduced motion v3 introduced. No image comes from a private profile.
- Add, at 1440 px unless noted: Accounts with kinds and links; Monthly Reconciliation with the tie-out panel, verification column and proposals; Interaccount Debts as of today with a scheduled event; the Pairs tab with a pay-pair preview; the Review queue; a write-off dialog; Balances; the Dashboard close checklist; and Balances at 390 px.
- Update every document that embeds an image, with descriptive alt text. A person reviews every image before merge: correct version, no clipped panels, no browser chrome, no personal data.

**Gate:** every link in `docs/` resolves; every screenshot is regenerated by the script and reviewed; `npm run privacy:check` passes; the guided tour covers account setup and the close checklist.

### R — Release (`v4/release`)

The full verification in §9, then the release PR from `release/v4` to `main`, the `v0.4.0` tag, and the owner rollout in §8.

## 4. Shipping Track A early

A1–A4 touch only treasury tables and screens. None of them needs sign-in, connections, reviews or reports, so they can ship as a **v3.x point release** before v3's institution slices (S4–S9) are finished, for example on the v3 line right after v3's sign-in work, or as a treasury-only update. A5 can go with them: cents, standing amounts and the retained line need no bank data, and only its verification waits for Track B. B6's steps 4–6 can also go with them.

Recommended: build A1 first, then A2, A3 and A5 side by side, then A4, and release them together once the owner has accepted OD6, OD9, OD13, OD15 and OD16. Shipping early lets the owner run the private review queue and link history on real data while v3 is being built. The only cost is basing those slice branches on `release/v3` (§2).

## 5. Dependencies on v3

| V4 slice | Needs from v3 | Better with |
| --- | --- | --- |
| B1 | S4 (`institution_accounts`), S7 (Connected Accounts page) | V3-A1, V3-A2 |
| B2 | S9 (balance snapshot), S4 (report source rows) | The manual-entry opening balance |
| B3 | S3 (pairing), S6a (review store), S7 | V3-A5 |
| B4 | S3 (dispositions), S7 (clearing), report tables | V3-A3, V3-A4 |
| B5 | B2 | — |
| B6 | B2–B4 | — |

## 6. Parallel work and reviews

| Phase | Parallel sessions | Why it is safe |
| --- | --- | --- |
| After A1 | A2 · A3 · A5 | A2 touches the journal services and `debt_events` links; A3 the summary and debt views; A5 `createMonth`, schemas and `computeMonth`. Agree the `debt_events` migration in A2's first PR, because A3 adds columns to the same table. |
| After A2 and A3 | A4 | Needs both. |
| After v3 S7 and B1 | B2 · B3 · B4 | B2 reads report balances, B3 reads the open review, B4 writes at clearing and reads reports; they share only B1's link lookups. |
| After B2 | B5 · B6 | Disjoint screens. |

- Every PR gets a correctness review against the treasury rules by someone (or a separate session) that did not write it. Slices that change a domain rule (A3, A5, B4) get a second review against §18 of the treasury rules.
- Each session starts by reading this plan, the treasury rules and the owner's local project instructions, and ends with a PR that names the requirements it satisfies and its evidence.

## 7. Test strategy

| Layer | Tool | Scope |
| --- | --- | --- |
| Domain | Vitest | Every rule in the treasury rules. Property tests: `all` mode equals the pre-v4 summary; offsets preserve net positions and pair nets; pay pair pays exactly its amount; net positions sum to zero for every as-of date; cent rounding makes allocations total expected cash. Decimal edge cases at half a cent. |
| Services and database | Vitest + sql.js | Migrations from v0.2.2 and v3 fixtures with the unchanged-rows hash; one-transaction writes and one-step undo for transfer-plus-event, pay pair, offset, write-off, claims and proposal acceptance; audit rows; backup round trip; `replace` import keeping kinds and links. |
| Import and export | Vitest | Kinds, hub, standing amounts, event kinds and reasons round-trip through the app's own export; other workbooks leave them empty; link history on synthetic legacy months. |
| Spending integration (Track B) | Vitest | Funding pairs at clearing; verification over synthetic reviews, including context transactions, splits and several candidates; the canary scan over every new table. |
| End to end | Playwright | Demo: account setup; a transfer that pays a debt; another bucket paying; pay pair; offset; write-off; as-of switch; a complete close with sample statements (Track B). Private build: the same against a local profile. |
| Private | Vitest in `tests/local/` | The reference workbook's controls in `all` mode; the link-history and review-queue counts, recorded privately. Never committed. |
| Native | Manual, recorded | Packaged macOS app: setup, the close checklist, undo of every new action, restore of a pre-v4 backup. |

Public tests use only synthetic data and the Harper household.

## 8. Owner rollout

1. Take a complete JSON backup and record where it is.
2. Decide the open owner decisions, at least OD6, OD9, OD13, OD15 and OD16 for Track A, and OD19 before v3 slice S4 starts.
3. After Track A: declare every account's kind and the hub bucket; set standing amounts once the bank's recurring transfers exist (OD14).
4. Run **Link history**, then work through the tie-out and the review queue using the private notes in `reference/` (OD5, OD7, OD8). Correct with write-offs and adjusting events, never by editing imported rows. Record the before-and-after controls privately.
5. After Track B: link every cash bucket and card, mark the rest outside the treasury, declare which month pay funds (OD18), and set the hub cushion if the hub is separate.
6. Run the first full close from the checklist. Record timing and any false alarms privately, to tune the verification window and the review-queue thresholds.

## 9. Release gate

V4 releases only with a report that shows:

- `npm run check`, `npm run db:check` and every Playwright suite passing, with counts.
- Every acceptance test in [Acceptance tests](acceptance-tests.md) mapped to a passing test or a recorded manual result, alongside the existing and v3 gates.
- The reference workbook's migration controls reproduced in all-recorded-events mode (recorded privately; the public report says only that they pass).
- The unchanged-rows migration test and the canary scan passing.
- The packaged macOS pass.
- The D documentation checklist complete: release notes and release report written, every standing document updated, links checked, and every screenshot regenerated from the demo build and reviewed.
- `npm run privacy:check` passing, and no personal names, institutions, account codes or figures in any public file.
- Every owner decision's answer recorded, and every remaining limitation listed.

## 10. Builder handoff prompt

> Implement Personal Treasury v4 from `docs/development/v4/`. Treat `treasury-rules.md` as the calculation contract, alongside `data-and-rules.md` and v3's rules, and add a test for every numbered rule you implement. Build Track A (A1–A5) first; it needs no v3 data and may ship early from `release/v3` if the owner asks. Build Track B (B1–B6) only after the v3 slices it names. Work on slice branches `v4/<slice>`, one git worktree per concurrent session, and author commits as the repository's configured owner with no co-author trailers or tool attribution. Never infer an account's kind or link, never compute a balance from allocations, never change an existing row's values, and never create a treasury record from institution data without the owner's click. Keep the summary in all-recorded-events mode identical to today's, and keep every existing treasury, budget, import, export, undo and backup behavior and test unchanged unless an accepted owner decision changes it. Build each owner decision's recommended default behind the setting the rules name, and change it only when the owner decides. Use only synthetic data and the Harper household in committed tests; run `npm run privacy:check` before every push. Finish with slice D: release notes, a release report, every standing document updated, and all screenshots regenerated from the demo build.
