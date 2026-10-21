# Personal Treasury v4: implementation plan and builder handoff

Prepared 2026-09-27 from the v3 specification, the v0.2.2 source and a private accounting review of the treasury logic and the owner's history. Updated 2026-10-20 for the shipped v3 (v0.3.0-preview.2, schema 5, merged into `main`). This is a **build plan**. Nothing in it is implemented yet.

Read first: [Product specification](product-spec.md), [Treasury rules](treasury-rules.md), [Acceptance tests](acceptance-tests.md), the [delivery workflow](../DELIVERY_WORKFLOW.md), and v3's [preview status](../v3/preview-status.md) for what shipped and what remains open.

## 1. Starting point

| Item | State on 2026-10-20 | V4 treatment |
| --- | --- | --- |
| `main` (v0.3.0-preview.2) | Treasury, budget and tax from v2; v3's sign-in, Budget Analysis, Connected Accounts, cleared reports and balance snapshots. Schema version 5. V3's stable-release gates (provider lifecycle, native and browser acceptance, security and operational review) are still open. | Baseline for every slice. Every existing test must keep passing unless an accepted owner decision changes it. V4 migrations start at version 6. |
| Shipped v3 that Track B builds on | `institution_accounts` (optional `treasury_account_id`, `shared` flag), categorization rules, the review store and transfer pairing, `spending_reports` with lines, flows, sources (per-account inflows and outflows) and `balance_snapshots`. The funding-mismatch and transfer-confirmation hints (v3 FR-REV-12, FR-REV-13) were not built. | Extended by B0–B4 through the changes in [product spec §10](product-spec.md#10-changes-v4-makes-to-shipped-v3) (OD19). |
| `v4/spec` (this branch) | The v4 documents and ADR 0011. | Merges into `main` by PR, documents only. |
| Treasury code the change touches | `src/domain/debts.ts` (`rollForward`, `debtPosition`, `debtStatus`, `summarizeDebts`, `paymentToChange`, `suggestChangeForTransfer`), `src/domain/monthly.ts` (`computeMonth`), `src/domain/types.ts`, `src/api/treasury.ts` (`createMonth`, `setAllocation`, `addTransfer`, `updateTransfer`, `addAdvancedEntry`, `deleteEntry`, `debtBoard`, `recordPayment`, `recordAdjustment`, `recordEntryOnDebt`, `dashboard`), `src/api/schemas.ts`, `src/db/migrations.ts`, `src/import/analyze.ts`, `src/export/workbook.ts`, `src/export/backup.ts`, `src/demo/persona.ts`, `src/demo/seed.ts`. | Extended, not replaced. `summarizeDebts` keeps its signature and results; the as-of filter is a new `positionsAsOf` upstream of it. |
| Evidence | The owner's history, analyzed privately, shows the final-transfer method already reaches the minimum number of real transfers, and that most journal rows repay debts. | No netting work. The debt workflow and the checks are where the time goes. |

## 2. Branches, authorship and releases

```text
main ──●──────●──────●──────●───────────────────────────────●── v0.4.0 tag
       │ spec  ▲ B0   ▲ A1   ▲ A2 … (each slice its own PR,   ▲
       │       │      │      │  shipped in the next preview)  │ release PR
       │      v4/<slice> PRs from main                        │
       └────────────────────► release/v4 ──●────●────●────────┘
                                           ▲    ▲    ▲
                                  v4/<B1–B6 slice> PRs
```

- **`v4/spec`** holds the v4 documents only. It merges into `main` by PR so the plan is visible, without code changes. It changes no file in `docs/development/v3/`; slice D updates them when the changes in product spec §10 ship.
- **B0 and Track A** (A1–A7 and the Track A close checklist) are cut from `main` and return to `main` by PR, one slice per PR, under OD21's recommended path (§4). Each ships in the next preview release; every behavior change sits behind a setting that starts at the old behavior.
- **`release/v4`** is cut from `main` once B0 and A1 have merged. It is the integration branch for B1–B6, which add a page and change the link model together. Nothing merges into `main` from it until the release gate (§9) passes.
- **Slice branches `v4/<slice>`** are cut from their integration branch and return by pull request, one slice per branch, small enough to review in one sitting, rebased before review.
- **Fixes** to released versions go on `fix/<topic>` from `main` and are merged forward.
- **Authorship:** every commit is authored and signed with the owner's configured identity and key (the repository's noreply address and SSH signing). No co-author trailers and no tool attribution in commits, pull requests, code comments or documents. If signing fails, stop and report it; never fall back to unsigned commits.
- **Merging** belongs to the owner. Slices open pull requests; nobody else merges, tags or publishes.
- **Privacy:** `npm run privacy:check` before every push. The accounting review's notes and evidence, the owner's review questions (OD5, OD7, OD8) and every figure from the reference workbook stay in the gitignored `reference/` folder. Public tests use the Harper household and invented numbers only.
- **Parallel work** uses one git worktree per slice (`git worktree add ../pt-<slice> v4/<slice>`). Slices that need the private reference tests run them in the main checkout.

## 3. Slices

Each slice lists its requirements, what it delivers, its dependencies, and its gate: the evidence its pull request must include. **Every slice's gate also includes** its new tables and columns in `BACKUP_TABLES` with a backup round trip, `npm run db:check` covering its constraints (FR-DATA-1, FR-DATA-2), its part of V4-AT17, and keyboard entry for the actions it adds (FR-V4UI-7).

### B0 — Keep funding-pair totals and allow account-only rules (`v4/funding-pairs`)

Ship this first and on its own. Every month cleared without it loses the totals that settlement proposals and card coverage need, because the month's transactions are deleted when it is cleared.

- FR-SETTLE-1 (the totals only), V3-A3 and V3-A4 from [product spec §10](product-spec.md#10-changes-v4-makes-to-shipped-v3).
- `spending_report_funding_pairs` (Treasury rules §17), written at clearing from accepted budget parts, in the same transaction as the report; the **Funding pairs** sheet in the report export; categorization rules that match on an institution account with an empty description pattern (the matcher and the API schema both accept it only when an account is set); backup, restore and replaced-report handling for the new table.
- Until B1 ships, a pair's paying side comes from the institution account's existing treasury link, and spending from unlinked or Shared accounts is totalled in an "unlinked" row that never produces a proposal.
- Gate: V4-AT14.0 (totals built at clearing); the canary scan over the new table; a report cleared before B0 still opens and exports unchanged; rules without an account still require a pattern.
- No dependencies. Changes no treasury calculation.

### Track A: no institution data needed

#### A1 — Treasury roles and the hub bucket (`v4/treasury-roles`)

- FR-ACCT-1 to FR-ACCT-4, FR-V4UI-1 (Role column, hub marker, setup view), FR-V4DEMO-1, FR-DATA-3 and FR-DATA-4 for accounts.
- `accounts.treasury_role` and `is_hub` with their constraint and trigger; the `Account` type; the `AccountInput` schema; refusal paths in `createMonth`, `setAllocation`, `addTransfer`, `addAdvancedEntry` and the budget view for counterparties; the card warning; the **Set up your accounts** prompt, including the questions for the setting-backed decisions (each slice adds its own); export and import of the account columns; `replace` import keeping them.
- Demo: Harper declares every role, HH is the hub, and gains `CARD` and `RELATIVE` with no debts. Tests that change: `tests/integration/demo-seed.test.ts` (the account list and any assertion that lists every account), and the persona blurb in `src/demo/persona.ts`. The pinned debt controls don't change.
- Gate: V4-AT1; a workbook import with card-like and person-like codes leaves roles empty.
- No dependencies. Beside A2.

#### A2 — Debt foundations and the as-of summary (`v4/debt-foundations`)

- FR-DEBT-4, FR-DEBT-6, FR-DATA-5, FR-V4UI-2 (as-of control, Scheduled), FR-V4UI-5 (debt headline), FR-V4DEMO-3.
- The `debt_events` columns (`event_type`, `link_purpose`, `link_origin`, `reason`, `related_event_id`, `offset_group_id`) in one migration; `meta` settings and the setup questions for OD6 and OD13; `positionsAsOf(debts, events, t | 'all')` in `domain/debts.ts`, used by `debtBoard` and `dashboard`; `debtStatus(balance, lastEventType)` with `WRITTEN_OFF` and its label; export labels for *all recorded events*; the demo seed dating no event after today.
- Gate: V4-AT5; the property test that `all` mode equals the pre-v4 summary field for field; the private reference-workbook controls passing unchanged in `all` mode.
- No dependencies. Beside A1. Merge before A3, A5 and A6.

#### A3 — Debt payments entered once, and claims (`v4/debt-payments`)

- FR-DEBT-1 to FR-DEBT-3, FR-DEBT-12, FR-V4UI-3 (debt-effect choice in the transfer form).
- `suggestDebtEffect(draft)`: the §8 cases, candidate events, and defaults; `addTransfer` and `updateTransfer` with the optional `debtEffect` (API default off); linked-event maintenance on edit and delete; the claim dialog; the setup question for OD20; two-decimal validation of debt amounts under OD13.
- Tests that change: `tests/e2e/demo.spec.ts` (its "Record on Loan H-03" click after saving moves into the transfer form); `tests/integration/workflows.test.ts` gains the link-first and same-save cases, and its existing assertion that a second `recordEntryOnDebt` is refused still holds; `src/demo/seed.ts` may pass `debtEffect` instead of calling `recordEntryOnDebt`, with identical pinned figures.
- Gate: V4-AT2, V4-AT3; property test that the sum of absolute changes of linked transfer events never exceeds an entry's amount; the migration hash test.
- After A2.

#### A4 — Tie-out and link history (`v4/tie-out`)

- FR-TIE-1 to FR-TIE-5, FR-V4UI-3 (tie-out panel).
- `tieOut(month)` with exclusive items; `tie_out_acknowledgements`; the resolutions (link, record, link as third-party payment, acknowledge); the **Link history** matcher and bulk acceptance.
- Gate: V4-AT4; the private link-history review run locally against the reference workbook, with its counts recorded privately.
- After A3 (links and the claim path) and A1 (counterparty rule).

#### A5 — Write-offs, reassignment, aging and the review queue (`v4/debt-review`)

- FR-DEBT-5, FR-DEBT-7, FR-DEBT-8, FR-DEBT-13, FR-V4UI-2 (ages, Review queue, Write off, Reassign).
- Write-off and reassign services with previews; aging; `debt_reviews`; the queue's reasons, including the tie-out reason.
- Gate: V4-AT6, V4-AT7.
- After A2 and A4.

#### A6 — Pairs, pay pair and offsets (`v4/debt-pairs`)

- FR-DEBT-9 to FR-DEBT-11, FR-V4UI-2 (Pairs tab, Pay pair, Offset).
- Domain: pair view, pay-pair allocation at the entry date, offset validation. Services: `payPair` (one entry, several linked payment events), `offset` (two events, one group, deleted together).
- Gate: V4-AT8; property tests that offsets preserve every net position and pair net, and that pay pair pays exactly its amount without passing zero.
- After A3.

#### A7 — Cents, standing amounts and the retained hub line (`v4/monthly-lines`)

- FR-MON-1 to FR-MON-5, FR-V4UI-3 (automatic and by-hand split, Confirm arrival, Retained).
- Cent rounding in `createMonth`, **Refresh allocations** and `diffMonthAgainstBudget`; two-decimal validation in `TransferInputSchema`, `AdvancedEntryInput`, `setAllocation`, `NewMonthInput`, `updateMonth` and template amounts, behind `amounts_in_cents`; `standing_amount` columns and warnings; `MonthInput.retainedAccountId` and `standingAmounts`; the setup question for OD16.
- Gate: V4-AT9, V4-AT10; the existing AT4 monthly-status tests passing unchanged with every setting off.
- After A1. Beside A3.

#### Track A close checklist (`v4/close-a`)

- FR-CLOSE-1 (steps 4–6), FR-CLOSE-2, FR-CLOSE-3, FR-V4UI-5: the Dashboard checklist with steps 1–3 showing **Needs connected accounts**.
- Gate: V4-AT16.1.
- After A4 and A5.

### Track B: uses institution data

#### B1 — Required links (`v4/links`)

- FR-ACCT-5 to FR-ACCT-9, FR-V4UI-1 (editable link picker and setup view), FR-DATA-4 for links.
- `institution_accounts.link_target` with its indexes and the migration from `shared` and the optional `treasury_account_id` (Treasury rules §3, V3-A1, V3-A2); Connected Accounts' **Shared** label removed.
- Gate: V4-AT11; migration test from a schema-5 database fixture with a Shared card and duplicate mappings.
- After A1 and B0.

#### B2 — Observed balances and checks (`v4/balances`)

- FR-BAL-1 to FR-BAL-7, FR-MON-6, FR-V4UI-4, FR-V4UI-6.
- `domain/balances`: `month_end`, settlement amounts, proof of cash, economic balance and the integrity footer, card coverage, card funding, hub checks, timing, explanations. The optional statement opening balance on manual entry; `pending_total` and `in_transit_total` written at clearing. The **Balances** page. `balance_check_notes`. The setup question for OD18.
- Gate: V4-AT12; the Balances view empty without a cleared report; screenshot review at 390 and 1440 px.
- After B1, A2 (as-of net positions) and B0 (funding pairs). Uses v3's `balance_snapshots` and report source rows.

#### B3 — Transfer verification (`v4/verification`)

- FR-VER-1 to FR-VER-5, FR-CLOSE-4, FR-V4UI-3 (verification column and actions).
- Legs, windows and statuses over the open reviews' transactions; **Mark verified lines Done**; **Transfers outside the plan**; `transfer_verifications` and `transfer_verification_months`; the clearing warning. Takes the place of v3's unbuilt FR-REV-13 hint, with cent matching (V3-A5).
- Gate: V4-AT13; the canary scan extended to the new tables; v3's isolation test (V3-AT11) still passing, because verification writes only on the owner's click.
- After B1 and A7 (cents and standing amounts). Uses v3's review store and transfer pairing.

#### B4 — Settlement proposals (`v4/settlements`)

- FR-SETTLE-1 to FR-SETTLE-7, FR-V4DEMO-2, FR-V4UI-3 (proposals panel).
- The proposal list over B0's funding pairs; `settlement_decisions` with sequence and supersession; the card-refund default; replaced-report handling; the demo's card statement file.
- Gate: V4-AT14; the canary scan over the new tables and the generated descriptions; the "nothing posts without acceptance" test.
- After B0 and B1.

#### B5 — Floors, targets and sweeps (`v4/sinking-funds`)

- FR-BAL-8.
- Account columns, suggestions on the Balances page, acceptance into a journal row.
- Gate: V4-AT15.
- After B2.

#### B6 — Full month-end close (`v4/close`)

- FR-CLOSE-1 (all steps), FR-CLOSE-2, FR-V4UI-5.
- Steps 1–3 of the Dashboard checklist, with the verification counts in step 1.
- Gate: V4-AT16; V4-AT18 run in the demo and the private build.
- After B2–B4.

### D — Documentation and screenshots (`v4/docs`)

Documentation is part of the release. This slice runs after the other slices are feature-complete, so the text and images describe the shipped interface. Each item is a checkbox in the PR description. (A shorter version runs with each Track A preview: its release notes and the affected guide sections.)

**Release-specific documents (new):**

- `docs/release-notes-v0.4.0.md` (and notes for Track A's release): what v4 adds, the one-time account setup and its questions, the as-of debt headline and how to see all recorded events, and backup guidance before the first write-off.
- `docs/development/v4-release-report.md`: scope implemented, test commands with counts, the acceptance-test map, native macOS results, and remaining limitations, in the style of the v2.2 report. No private figures.

**Standing documents (update in place, so a reader of `main` never needs the v4 folder):**

| Document | Change |
| --- | --- |
| `README.md` | "New in v0.4.0"; **What it does** gains treasury roles, single-entry debt payments, the as-of debt summary, balance checks, verified transfers and the month-end close; screenshots. |
| `docs/README.md` | Index new documents; move the v4 planning documents under "History and plans". |
| `docs/guide/user-guide.md` | New sections: Setting up your accounts (roles, hub, links, setup questions), The month-end close, Paying debts (single entry, another bucket paying, pay pair, offsets), Debts as of a date, write-offs and reassignment, Balances and checks, Verified transfers, Settlement proposals, Sinking funds. |
| `docs/guide/getting-started.md`, `demo-walkthrough.md` | The account setup step; the demo's card and a settlement proposal in the walkthrough. |
| `docs/development/data-and-rules.md` | The accepted v4 rules: roles, the as-of summary, event types and Written off, the readiness wording if OD16 is accepted, new-amount precision, and a link to the treasury rules for the checks. |
| `docs/development/architecture.md` | New modules (`domain/balances`, the debt additions), tables and migrations, the new `computeMonth` inputs, and the updated invariants. |
| `docs/development/acceptance-tests.md` | Fold in V4-AT1–V4-AT18 so the release gate lists one set. |
| `docs/development/workbook-import.md` | The new export columns, what the workbook path doesn't carry, and that roles and links are never imported from other workbooks. |
| `docs/development/development.md`, `testing.md` | New suites, properties and fixtures. |
| `docs/development/decisions/` | ADR 0011 marked accepted with its final details; ADR 0004 updated for recording in the same save. |
| `docs/development/v3/` | The product spec, spending review rules and preview status updated for the shipped changes in product spec §10 (links, no Shared, account-only rules, funding pairs, the narrowed non-goal). |

**Screenshots:**

- Regenerate every image with `npm run docs:screenshots` from the **demo build only** (the fictional Harper household), with the fixed clock, fixed viewports and reduced motion v3 introduced. No image comes from a private profile.
- Add, at 1440 px unless noted: Accounts with roles and links; Monthly Reconciliation with the tie-out panel, verification column and proposals; Interaccount Debts as of today with a scheduled event; the Pairs tab with a pay-pair preview; the Review queue; a write-off dialog; Balances; the Dashboard close checklist; and Balances at 390 px.
- Update every document that embeds an image, with descriptive alt text. A person reviews every image before merge: correct version, no clipped panels, no browser chrome, no personal data.

**Gate:** every link in `docs/` resolves; every screenshot is regenerated by the script and reviewed; `npm run privacy:check` passes; the guided tour covers account setup and the close checklist.

### R — Release (`v4/release`)

The full verification in §9, including V4-AT18, then the release PR from `release/v4` to `main`, the `v0.4.0` tag, and the owner rollout in §8.

## 4. Release path for Track A

V3's schema is complete at version 5 on `main`, so Track A no longer has to share a migration sequence with unmerged v3 work. `PRAGMA user_version` stays one linear counter on `main`: each v4 migration takes the next number when its slice merges. The owner chooses the path (OD21).

| Option | How | Cost |
| --- | --- | --- |
| **(a) Previews from `main`** | B0 and each Track A slice merge into `main` by PR and ship in the next v0.3 preview (for example v0.3.0-preview.3). V3's stable gates continue alongside; the stable v0.3.0 then includes whatever has merged. | Track A's acceptance tests join the next stable gate. Behavior changes stay behind settings until the owner answers each decision, so a preview never changes an existing figure on its own. |
| **(b) Hold for v0.4.0** | Track A merges into `release/v4` with Track B and ships once, as v0.4.0. | Nothing reaches the owner until Track B is done; B0's totals are lost for every month cleared meanwhile, unless B0 alone still ships from `main`. |

**Recommended:** (a). B0 ships first under either option.

## 5. Dependencies on shipped v3

| V4 slice | Uses from shipped v3 | Changes it |
| --- | --- | --- |
| B0 | Clearing, report tables, categorization rules | V3-A3, V3-A4 |
| B1 | `institution_accounts`, Connected Accounts | V3-A1, V3-A2 |
| B2 | `balance_snapshots`, report source rows (inflows, outflows) | V3-A7 |
| B3 | Review store, transfer pairing, household settings | V3-A5, V3-A6 |
| B4 | B0's funding pairs, report months | V3-A6 |
| B5 | B2 | — |
| B6 | B2–B4 | — |

## 6. Parallel work and reviews

| Phase | Parallel sessions | Why it is safe |
| --- | --- | --- |
| Start | B0 · A1 · A2 | B0 touches clearing, report tables and rules; A1 touches accounts, month creation and the Accounts page; A2 touches `debt_events`, `domain/debts.ts` and the debt views. They share only `src/db/migrations.ts`: merge them one at a time and renumber on rebase. |
| After A1 and A2 | A3 · A7 | A3 touches the transfer services and debt links; A7 touches `createMonth`, schemas and `computeMonth`. Both edit `src/api/schemas.ts`; agree the two-decimal helper in A7's first PR. |
| After A3 | A4 · A6 | A4 adds the tie-out and link history; A6 adds pair services and the Pairs tab. |
| After A4 | A5, then the Track A close checklist | A5 needs the tie-out reason. |
| After B0 and B1 | B2 · B3 · B4 | B2 reads reports, B3 reads the open reviews and B4 reads B0's totals; they share only B1's link lookups. |
| After B2 | B5 · B6 | Disjoint screens. |

- Reviews follow the [delivery workflow](../DELIVERY_WORKFLOW.md). The author verifies each slice with its gate. A focused independent review is required for the high-risk parts: B1's migration of existing link data; the backup and restore delta of every slice; and B0, B3 and B4, which touch the boundary that keeps raw transactions temporary. Repairs are checked by delta, not by a full re-review.
- Domain-rule changes are not settled by review: each is an owner decision (Treasury rules §18) and ships behind its setting.
- Each session starts by reading this plan and the treasury rules, and ends with a PR that names the requirements it satisfies and its evidence.

## 7. Test strategy

| Layer | Tool | Scope |
| --- | --- | --- |
| Domain | Vitest | Every rule in the treasury rules. Property tests: `all` mode equals the pre-v4 summary; offsets preserve net positions and pair nets; pay pair pays exactly its amount; linked transfer events never exceed an entry; net positions sum to zero for every as-of date; cent rounding makes allocations total expected cash; a card's economic balance equals the negative of its coverage gap. Decimal edge cases at half a cent. |
| Services and database | Vitest + sql.js | Migrations from v0.2.2 and v3 fixtures with the unchanged-rows hash; one-transaction writes and one-step undo for transfer-plus-event, links, pay pair, offset, write-off, reassign, claims and proposal decisions; audit rows; backup round trip; `replace` import handling every new table. |
| Import and export | Vitest | Roles, hub, standing amounts, event types, reasons, offset groups and related Loan IDs round-trip through the app's own export; other workbooks leave them empty; Link history restores entry links after a workbook round trip. |
| Spending integration (Track B) | Vitest | Funding pairs built at clearing from accepted parts; verification over synthetic reviews, including context transactions, two legs, split deposits, splits and several candidates; timing totals; the canary scan over every new table. |
| End to end | Playwright | V4-AT18 in the demo and the private build, including its keyboard-only steps. |
| Private | Vitest in `tests/local/` | The reference workbook's controls in `all` mode; the link-history and review-queue counts, recorded privately. Never committed. |
| Native | Manual, recorded | Packaged macOS app: setup, the close checklist, undo of every new action, restore of a pre-v4 backup. |

Public tests use only synthetic data and the Harper household.

## 8. Owner rollout

1. Take a complete JSON backup and record where it is.
2. Decide the open owner decisions: OD19 and OD21 first (they unblock B0 and the release path); for Track A at least OD2, OD3, OD4, OD6, OD9, OD13, OD15, OD16 and OD20.
3. After Track A: answer the setup questions, declare every account's role and the hub bucket, and set standing amounts once the bank's recurring transfers exist (OD14).
4. Run **Link history**, then work through the tie-out and the review queue using the private notes in `reference/` (OD5, OD7, OD8). Correct with write-offs, reassignments and adjusting events, never by editing imported rows. Record the before-and-after controls privately.
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

> Implement Personal Treasury v4 from `docs/development/v4/`. Treat `treasury-rules.md` as the calculation contract, alongside `data-and-rules.md` and v3's rules, and add a test for every numbered rule you implement. Build B0 first, then Track A (A1–A7) on the path OD21 names, then Track B (B1–B6) on `release/v4`. Work on slice branches `v4/<slice>`, one git worktree per concurrent session, and author and sign commits as the repository's configured owner with no co-author trailers or tool attribution, and leave merging to the owner. Never infer an account's treasury role or link, never compute a balance from allocations, never change an existing row's values, never record a debt event twice for one transfer, and never create a treasury record or a Done mark from institution data without the owner's click. Keep the summary in all-recorded-events mode identical to today's. Every decision that changes existing behavior is a setting that starts at the old behavior; keep every existing treasury, budget, import, export, undo and backup behavior and test unchanged except where this plan lists the change. Use only synthetic data and the Harper household in committed tests; run `npm run privacy:check` before every push. Finish with slice D: release notes, a release report, every standing document updated, and all screenshots regenerated from the demo build.
