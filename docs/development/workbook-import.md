# Workbook Migration and Export Specification

## General approach

The importer recognizes the workbook by structure and headings rather than relying only on sheet position. It performs analysis first, shows a preview, and commits the entire import in one SQLite transaction.

Derived workbook values are comparison controls. The app imports source events and allocations, recalculates all outputs, and reports differences. It must never overwrite the source workbook.

## Expected source sheets

| Sheet | Role | Import treatment |
| --- | --- | --- |
| `Overview` | Current headline values and allocations | Import current allocation profile and use displayed totals as comparison controls. |
| `Monthly Template` | Canonical future monthly workflow | Import account roster, default allocations, expected cash, validation rules, and normalized journal structure. |
| `Account Ledger` | Source debt events | Import debts and chronological debt events. |
| `YYYY-MM` sheets | Historical monthly reconciliations | Detect normalized or legacy matrix format and import as months. |
| `Interco Debt Summary` | Derived debt view | Do not import as source. Compare recalculated results with it. |

Unknown sheets are left untouched and reported as ignored unless a recognized adapter claims them.

## Date handling

- Convert Excel date serials using the workbook date system.
- Store ISO calendar dates without time when the source contains only a date.
- Use the sheet name month as the fallback for legacy rows lacking dates and flag that fallback.
- Preserve source serial/value and cell reference in provenance.

## Account discovery and aliases

Build the account roster from the union of:

- Overview allocation rows.
- Monthly Template account rows.
- Historical sheet account headers.
- Account Ledger debtor and creditor values.
- Interco Debt Summary only as a comparison source.

Resolve trimming and case differences. Seed observed aliases:

- `Splurge` → `SPLG`
- `Petc.` → `PETC`
- Workbook-specific aliases from the gitignored `reference/seed-aliases.json`

Do not infer any other merge. Preserve `???` as an account requiring review. Do not drop accounts that have no current allocation.

## Current allocation import

From Overview and Monthly Template, detect the account/allocation table by headings. Prefer Monthly Template as the canonical future profile when both structures are valid. Compare the Overview values and warn on a material difference.

Expected current controls:

- Expected monthly cash: the full-precision value recorded in `reference/current_snapshot.json`.
- Visible active allocations: HH, PETC, LTS, TRV, ENT, and CLTH.
- Accounts with a zero default allocation remain valid accounts.

Preserve full numeric precision and display cents.

## Normalized monthly format

Recognize a sheet containing both:

- An account transfer summary with Account, Budget allocation, Transfers in, Transfers out, Final transfer, Transferred?, and Notes.
- A transfer journal with Date, LID, Description, From account, To account, Amount, Notes, and Row check.

For each nonblank journal row:

1. Normalize account codes through aliases.
2. Require a positive amount for a valid ordinary transfer.
3. Create one journal entry and two postings: From negative, To positive.
4. Preserve invalid or incomplete rows as import warnings. If enough source content exists to retain a draft, import it as a flagged draft rather than dropping it.
5. Compare calculated Row check and monthly checks with the workbook values.

Import Transferred? values case-insensitively. `Done` becomes done. Blank non-zero rows become pending. Effective zero rows become not required. Unknown confirmation text is preserved in notes and warned.

## Legacy matrix monthly format

Historical sheets use account codes across columns and descriptions down rows.

Recognition signals:

- Sheet name `YYYY-MM`.
- A row containing Description, LID, one or more account-code columns, and Total.
- A Budget Allocation row.
- A final row such as `X'fer Amount`.

Import algorithm:

1. Detect the header row and account columns between LID and Total.
2. Import the Budget Allocation row as monthly allocations.
3. Treat rows after Budget Allocation and before X'fer Amount as journal-entry candidates.
4. For every numeric non-zero account cell, create a posting using the signed cell value.
5. Set the journal entry description and Loan ID from the left columns.
6. Compare the sum of postings with the displayed row Total.
7. A row within $0.01 of zero is balanced.
8. When a row has exactly one negative and one positive equal amount, it is semantically an ordinary transfer but remains stored as the same general journal-entry/posting structure.
9. When a row has more postings, preserve all of them as a multi-posting entry.
10. When a row is unbalanced, import every posting unchanged and flag the exact difference. Never add a plug.
11. Compare calculated account totals with the X'fer Amount row.

Historical confirmation rows such as `Transfer confirmation 1` may contain `x`, `-`, or blanks. Import `x` as done for that account, treat effective-zero transfers as not required, and report ambiguous values.

Known controls:

- The balanced legacy month named in `reference/WORKBOOK_REFERENCE.md` should calculate with a journal difference of $0.00.
- The unbalanced legacy month named there should calculate as Review with its exact documented journal difference.

## Account Ledger import

Expected columns:

| Column | Source meaning | App treatment |
| --- | --- | --- |
| Loan ID | Debt identifier | Store as text; group repeated IDs. |
| Date | Event date | Convert to ISO date. |
| Description | Debt or event description | First nonblank value establishes origin description; retain event value. |
| Debtor account | Origin direction | First valid value establishes origin debtor. |
| Creditor account | Origin direction | First valid value establishes origin creditor. |
| Prior balance | Derived control | Do not import as authoritative. Compare. |
| Change | Signed event change | Import as source amount; blank becomes zero with warning if row otherwise populated. |
| Remaining balance | Derived control | Do not import as authoritative. Compare. |
| Terms / notes | Terms or event note | Preserve. Origin terms come from first suitable row. |
| Status | Derived display | Do not import as authoritative. Compare. |

Group by Loan ID while preserving sheet row order. The first occurrence establishes the debt record. Later rows with blank description or parties inherit the debt record in the interface without modifying the source event.

If later nonblank party fields conflict with the origin, retain them as source metadata and warn. Do not create a second debt unless Loan ID differs.

Status comparisons:

- App Paid when absolute balance is below $0.01.
- App Credit when balance is below -$0.01.
- App Open when balance is at least $0.01.
- Workbook Canceled is treated as a note/status comparison only; a non-zero balance remains in the summary.

## Derived debt validation

After importing the ledger, compare the app's summary with the workbook's Interco Debt Summary:

- Non-zero count.
- Total outstanding.
- Largest debt.
- Each included Loan ID, current direction, and balance.
- Owed-to, owed-by, and net position by account.
- Net positions sum to zero.

Any mismatch is at least a high-severity warning. The user may inspect and abort before commit.

## Duplicate and repeat imports

- Hash the workbook bytes.
- Warn when the same hash was previously committed.
- A preview never changes the database.
- For MVP, committed repeat imports should default to creating a new database or require an explicit replace/merge mode.
- Replace mode backs up the database first and replaces imported records in one transaction.
- Merge mode is a later feature unless implemented with deterministic source identity and tested conflict behavior.

## Import report

The report must include:

- Workbook and recognizer version.
- Recognized sheets.
- Imported counts by entity.
- Accounts created and aliases applied.
- Ignored sheets or ranges.
- Source rows with blank changes, unknown codes, conflicting debt metadata, invalid transfers, unbalanced entries, or ambiguous confirmation markers.
- Control totals and pass/fail comparison.
- Commit or rollback outcome.

Every warning includes a sheet and cell or row reference.

## Excel export

The app exports a new workbook; it does not modify the imported original.

Minimum export sheets:

1. Overview.
2. Monthly Template or current Monthly Reconciliation.
3. Account Ledger.
4. One historical sheet per month, or a normalized history table plus user-selected month sheets.
5. Interco Debt Summary.

Export rules:

- Use typed dates and numeric values.
- Keep calculations traceable and use formulas where practical, but app-generated stored events remain the authoritative data.
- Preserve Loan IDs as text.
- Export debt prior/remaining/status values calculated by the domain engine.
- Include notes and unknown codes.
- Use the same current-direction logic in the debt summary.
- Add an Exported by application timestamp in a nonintrusive metadata area or document properties.

## JSON backup

Backup contains:

- Schema version.
- Export timestamp.
- Accounts and aliases.
- Allocation profiles.
- Months, allocations, entries, and postings.
- Debts and events.
- Import provenance and unresolved warnings.

Restore validates the schema, shows a summary, and imports into a transaction. Unknown future schema versions fail clearly without partial restore.
