# Acceptance Tests

These tests are automated wherever practical; test names in `tests/` refer to them as AT1–AT15. Current-workbook assertions are migration controls, not values to hardcode in the application.

## 1. Decimal arithmetic

1. Import a value with more than two decimal places and round only for display.
2. Sum decimal strings deterministically without binary floating-point artifacts.
3. Treat absolute differences below $0.01 as reconciled and differences at or above $0.01 as unresolved.

## 2. Ordinary transfer behavior

Given a month with HH allocation $1,000 and PETC allocation $200:

1. Add a $75 transfer from HH to PETC.
2. Confirm one entry exists with postings HH `-75` and PETC `+75`.
3. Confirm HH transfers out is $75 and final transfer is $925.
4. Confirm PETC transfers in is $75 and final transfer is $275.
5. Confirm the entry and journal remain balanced.

Reject:

- Missing From.
- Missing To.
- Same From and To.
- Zero amount.
- Negative amount in ordinary-transfer mode.

## 3. Multi-posting entry behavior

Create a legacy entry with postings A `-100`, B `+60`, and C `+40`.

- The entry is valid and balanced.
- Each account's monthly summary updates by its posting.
- The UI expands the entry to show all three postings.

Create another with A `-100` and B `+90`.

- Preserve both postings.
- Show a $10 imbalance and Review status.
- Do not create a $10 plug.

## 4. Monthly status

With matching expected cash and allocations, a balanced journal, nonnegative final transfers, and pending required transfers:

- Status is Ready to transfer.

After marking every account with a non-zero final transfer Done:

- Status is Complete.

If any one of the following occurs, status becomes Review with a specific reason:

- Allocation difference is at least $0.01.
- Journal difference is at least $0.01.
- Final-transfer difference is at least $0.01.
- An entry is incomplete or invalid.
- A final transfer is below -$0.01.

A zero final transfer does not require a completion mark.

## 5. Debt roll-forward

Create Loan X with origin debtor HH, origin creditor LTS, and opening change $300.

- First prior balance is $0.
- First remaining balance is $300.
- Status is Open.

Add payment `-125`.

- Prior balance is $300.
- Remaining balance is $175.
- Summary shows HH owes LTS $175.

Add payment `-175`.

- Remaining balance is $0.
- Status is Paid.
- Loan X is absent from the non-zero summary.

Add adjustment `-25`.

- Remaining balance is `-25`.
- Status is Credit.
- Summary reverses direction and shows LTS owes HH $25.

## 6. Origin metadata inheritance

Import a debt whose first row contains all metadata and whose payment rows contain only Loan ID, date, and change.

- The debt detail preserves the origin description, opened date, debtor, creditor, and terms.
- Payment rows remain separate events.
- Blank payment metadata does not erase origin metadata.

## 7. Canceled-note behavior

Import a final event with a non-zero balance and `canceled` in notes.

- The debt remains in the non-zero summary.
- The note is visible and highlighted for review.
- The event is not silently deleted and the balance is not forced to zero.

## 8. Account alias and unknown-code behavior

- `Splurge`, `splurge`, and ` SPLURGE ` resolve to canonical `SPLG` through the alias table.
- `Petc.` resolves to `PETC`.
- Aliases that belong to one person's workbook live in the gitignored `reference/seed-aliases.json` and are merged at build time.
- `???` remains a distinct account and receives a review warning.
- PETC retains its supplied description and receives no pet-only behavior.

## 9. Debt controls

**Reference workbook (local only).** After importing the owner's workbook, the non-zero debt count, total outstanding, largest debt and every net position match `reference/current_snapshot.json` within the decimal tolerance. Those figures are personal, so they stay in the gitignored `reference/` folder and are checked by `tests/local/`.

**Sample household (public).** The Harper household sample data (`src/demo/persona.ts`) gives:

- Non-zero debt count `4`, total outstanding `$785.00`, largest debt `$300.00` (H-01 and H-05).
- The sum of all account net positions equals `$0.00` within tolerance.
- Loan `H-03` has a latest balance of `-35` relative to origin direction and therefore displays **ENT owes KIDS $35**.
- Loan `H-02` is paid off and is excluded from the summary.
- Loan `H-04` has a `canceled` note and a non-zero balance, and remains included.

## 10. Incremental debt controls

Starting from the sample household:

1. Record a $300 payment on Loan `H-01` (a `-300` debt change).
   - Non-zero count becomes `3`.
   - Total outstanding becomes `$485.00`.
2. Undo or delete that test event.
   - Controls return to `4` and `$785.00`.
3. Add a new $250 debt from HH to LTS.
   - Non-zero count becomes `5`.
   - Total outstanding becomes `$1,035.00`.
4. Remove the test debt.
   - Controls return to the source values.

The same sequence runs against the reference workbook in `tests/local/`.

## 11. Historical month controls

Import legacy matrix sheets:

- A balanced legacy month reports a journal difference of `$0.00` and a Balanced/valid reconciliation.
- An unbalanced legacy month preserves all source postings, reports its exact journal difference, and shows Review status. The synthetic workbook's `2026-01` sheet reproduces this with a `-$10` difference.
- The importer does not add an unexplained balancing entry.

## 12. Import transaction and provenance

- Previewing an import changes no database rows.
- A fatal error rolls back every entity created during commit.
- Every imported journal entry and debt event can display its source workbook sheet and row/range.
- Reimporting the same file hash warns about duplication.
- Original source code/value remains available when an alias is applied.

## 13. Closed-month protection

- A closed month is read-only.
- Reopen requires an explicit action.
- Reopening and editing recalculates summaries.
- Closing again is impossible while status is Review unless the user explicitly overrides with a recorded warning. The safer default is to block closure.

## 14. Backup and restore

1. Export a JSON backup.
2. Restore into a fresh database.
3. Compare entity counts, IDs, monetary strings, current monthly status, and all debt controls.
4. The restored results must match exactly.

## 15. Excel export round trip

1. Export a normalized workbook.
2. Import it into a fresh database.
3. Confirm account roster, monthly allocations, journal postings, debts, events, and control totals match.
4. Confirm Loan IDs containing hyphens remain text.
5. Confirm no formula errors or missing source rows appear in the exported workbook when opened in Excel-compatible software.

## 16. Critical end-to-end flows

Automate with Playwright:

- First launch → import preview → commit → dashboard controls.
- New month → adjust allocations → add transfer → resolve checks → mark transfers done → complete.
- Open debt → record payment → summary updates → reverse direction with overpayment.
- Export backup → restore into new test profile.

## Release gate

Before claiming completion, produce a test report containing:

- Unit/integration/E2E counts and results.
- Source workbook import counts and warnings.
- All current control comparisons.
- Any acceptance test not automated, why it was not automated, and its documented manual result.
