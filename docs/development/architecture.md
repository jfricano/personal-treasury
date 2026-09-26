# Architecture — Personal Treasury

This covers the treasury system, the budget, payroll and tax integration built on top of it, the public browser demo (§13), and the optional v2.2 private cloud snapshot path.

The v2.2 private web build and desktop executable share the existing in-process SQLite and domain layers. `src/sync/` encrypts full snapshots, compares remote revisions before upload, and stops on divergence. `sync-server/` stores immutable encrypted versions and serves the private web build. See [ADR 0007](decisions/0007-guarded-cloud-snapshots.md) for the boundaries and recovery behavior.

Where things are specified:
- **Treasury rules:** [Data model and calculation rules](data-and-rules.md), [Workbook import](workbook-import.md) and [Acceptance tests](acceptance-tests.md).
- **Budget, payroll and tax:** §7 below. The owner's budget workbook is the authoritative reference; the original design notes quote it, so they are kept with the other personal files in `reference/` (never committed).
- **Decisions** made where those documents were open: [decisions/](decisions/).

## 1. Stack and folder structure

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri 2 (Rust). Registers only `tauri-plugin-fs` and `tauri-plugin-dialog`. |
| UI | React 19 + TypeScript, built with Vite. Plain CSS design tokens (`src/app/styles.css`); no component library. |
| Database | SQLite 3 compiled to WebAssembly (`sql.js`), running in-process. The file is persisted by a storage adapter. See ADR 0001 for why it isn't `tauri-plugin-sql`. |
| Money | `decimal.js` (60-digit precision). Values are stored as normalized decimal **strings**. |
| Validation | Zod, at the API boundary (`src/api/schemas.ts`, `src/api/budget.ts`, `src/domain/tax/rules.ts`). |
| Excel | SheetJS `xlsx` 0.20.3 (CDN tarball). |
| Tests | Vitest (unit, integration, database) and Playwright (end-to-end, with installed Google Chrome). |

```text
src/
  domain/        pure calculations, no I/O and no React:
                   money, monthly, debts, accounts, types        (treasury)
                   payroll, budget, tax/rules, tax/estimate      (budget and tax)
  db/            driver.ts (SQLite), migrations.ts, storage.ts,
                 repositories.ts (treasury rows), budgetRepositories.ts (budget, payroll, tax rows)
  api/           treasury.ts (application service = the API), budget.ts (BudgetService, reached as treasury.budget),
                 schemas.ts (Zod), errors.ts
  import/        sheet.ts, analyze.ts (treasury workbook), budget/analyzeBudget.ts (budget workbook), plan.ts, report.ts
  export/        workbook.ts (Excel, treasury), backup.ts (JSON backup/restore, all tables)
  platform/      files.ts (file pick/save: browser input/anchor, or Tauri dialog + fs)
  app/           App.tsx (shell/nav), context.tsx (routing, toasts, store hooks), styles.css
  components/    ui.tsx (Amount, badges, Dialog, CommitInput, AccountField, …)
  features/      dashboard/ monthly/ budget/ debts/ history/ accounts/ importExport/ settings/
src-tauri/       Tauri shell: Cargo.toml, tauri.conf.json, capabilities/default.json, icons/
tests/           unit/ integration/ e2e/ fixtures/ (synthetic workbooks generated in code)
  demo/          public demo only: persona.ts (the fictional Harper household), seed.ts, tab storage, banner
docs/            guide/ (getting started, user guide), development/ (this file, rules, import, tests, decisions/)
scripts/         privacy-check.mjs (blocks personal terms from committed files)
reference/       personal: source workbooks, audit notes, control totals (gitignored; see §12)
tests/local/     personal: tests against the reference workbooks (gitignored)
```

Dependencies only point downward: `features` → `api` → (`domain`, `db`, `import`, `export`). `domain` imports nothing from the other layers. `import` imports `domain` only. `export` reads through `api`. `BudgetService` reaches the treasury only through `Treasury.mutate` (transaction, undo, persistence) and the repositories.

## 2. Database schema and migrations

Migrations are forward-only entries in `src/db/migrations.ts`. Each runs in a transaction and sets `PRAGMA user_version`. A database whose version is newer than the app is refused. Foreign keys are on, and the setting is re-applied after every `export()`, because sql.js reopens the database on export.

| Version | Change |
| --- | --- |
| 1 | Initial treasury schema. |
| 2 | Triggers rejecting month numbers outside 01–12. v1's `GLOB` check allowed 13–19. |
| 3 | Budget, payroll and tax tables. Treasury linkage: `monthly_cycles.budget_version_id` and `expected_cash_origin`; `monthly_allocations.planned_amount` and `allocation_origin`. Existing months are back-filled as `import` or `template`. |

### Treasury tables

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `accounts` | Treasury buckets (HH, PETC, …) | `code` unique, case-insensitive; `sort_order`, `active`, `needs_review` |
| `account_aliases` | Alternate spellings → account | `alias` PK, case-insensitive; `original_text` kept |
| `allocation_profiles` / `_lines` | Legacy allocation template, kept for history. Replaced by budget versions and no longer edited in the UI. | Partial unique index on `active = 1` |
| `monthly_cycles` | One row per `YYYY-MM` | Unique month; `expected_cash` + `expected_cash_origin`; `closed_at`; `close_override_note`; `budget_version_id` (NULL for archival and manual months) |
| `monthly_allocations` | Funding amount per month × account | PK (month, account); `budget_amount` (reconciled), `planned_amount` (what the budget proposed), `allocation_origin` ∈ budget / manual_override / import / template; `transfer_state` |
| `journal_entries` / `journal_postings` | Transfer journal and signed postings | FK month (cascade), FK account; `source_kind`, `draft_reason`, provenance |
| `debts` / `debt_events` | Interaccount debts, event-sourced by Loan ID | `loan_id` unique; unique (debt, sequence) |
| `import_runs` / `import_warnings` | Provenance for both workbook imports (`mode` = empty / replace / budget) | Content hash indexed |
| `audit_log`, `meta` | Before/after JSON of every mutation; key/value | — |

### Budget, payroll and tax tables (v3)

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `budget_categories` | **Purpose** of spending (Housing and utilities, Pets etc., …) | `name` unique, case-insensitive |
| `budget_versions` | One plan per version (current, archived, summary-only history, drafts) | `status` ∈ draft / active / archived; one active (partial unique index); `detail_level` ∈ full / summary; `effective_from` / `effective_to`; `locked_at`; `gross_monthly`; `tax_year`; `filing_status` |
| `payroll_deductions` | Pretax and post-tax deductions per version | `method` ∈ fixed / rate_of_gross_less_exclusion; flags `reduces_federal_income`, `reduces_ca_income`, `reduces_fica_wages` |
| `payroll_withholdings` | **Actual** withholding (hard inputs) per version | PK (version, component); component ∈ federal / california / social_security / medicare |
| `budget_lines` | Planned amount for a purpose, funded by a treasury account | FK category; `funding_account_id NOT NULL` → `accounts`; `kind` ∈ amount / residual (CHECK: residual has no stored amount) |
| `budget_summary_rows` | Archival versions known only at summary level (the Budget History columns) | PK (version, position) |
| `tax_rule_sets` | Rules per tax year × jurisdiction × filing status, as Zod-validated JSON | UNIQUE (year, jurisdiction, filing status); `rates_from_year`, `provisional`, `source_note` |

Money columns are `TEXT`. Repositories reject anything that isn't a decimal and store the normalized form (no exponent, no trailing zeros, no `-0`). `npm run db:check` verifies integrity, foreign keys, money normalization, constraints, idempotent migration, and in-place upgrades.

## 3. Ledger and journal-entry model

- A **journal entry** belongs to one month and holds two or more **postings** of signed amounts on accounts.
- An ordinary transfer is `From −amount`, `To +amount`. The API accepts only a positive amount, two different accounts and resolved account ids (`TransferInputSchema`).
- Legacy matrix rows are stored exactly as their cells: any number of postings, balanced or not. No plug is ever added.
- Invalid imported rows are kept as **flagged drafts** (`draft_reason`), never discarded.
- `source_kind` records origin (`user`, `normalized_workbook`, `legacy_matrix`), and provenance columns record workbook, sheet, range and import run.
- This isn't a double-entry general ledger. Postings move allocated cash between the user's own buckets inside one month's plan. **Transfers aren't expenses**: no budget or report sums postings as spending.

## 4. Account-level calculations

The app deliberately **doesn't compute bank balances**. It computes these account-level figures:

1. **Monthly line** (`computeMonth`): `transfers_in`, `transfers_out`, and `final_transfer = budget_allocation + Σ postings`.
2. **Debt position** (`summarizeDebts`): owed-to, owed-by and net across the latest non-zero balance of each debt. Net positions sum to $0.
3. **Budget funding** (`computeBudget`): Σ budget lines per funding account. A treasury month takes these amounts as its allocations when it's created or refreshed from a version.

## 5. Interaccount debt model

- `debts` holds the origin metadata from a Loan ID's first row. `debt_events` holds every signed change. A repeated Loan ID is another event, never another debt.
- `rollForward` orders events by `(event_date, sequence)` and computes prior and remaining balances. These values are never stored.
- Status: **Paid** if |balance| < 0.01, **Credit** if the balance is negative, otherwise **Open**. A `cancel` note flags the debt for review without changing its status or summary inclusion.
- A negative balance reverses the displayed direction. The summary uses the latest balance per Loan ID with |balance| ≥ 0.01.
- Payments are entered as positive amounts and stored as the change toward zero (`paymentToChange`). A transfer naming a Loan ID can be recorded on the debt once (`journal_entry_id` link).
- **Borrowing is separate from spending:** the budget module never reads or writes debts.

## 6. Monthly cash flow and reconciliation

```text
allocation_difference     = Σ budget_allocation − expected_cash
journal_difference        = Σ all postings
final_transfer_difference = Σ final_transfer − expected_cash
REVIEW   if any |difference| ≥ 0.01, an invalid entry, or any final_transfer ≤ −0.01
COMPLETE if not REVIEW and every account with |final_transfer| ≥ 0.01 is Done
READY_TO_TRANSFER otherwise
```

- Status is always **computed**, never stored. `closed_at` is a separate lifecycle lock. Closing while in Review needs a recorded override note.
- `computeMonth` reads only `expected_cash`, `monthly_allocations.budget_amount` and postings. **Budget activity never enters the reconciliation except through the month's own allocation snapshot.**
- A new month can start from the **active budget** (default), a prior month, a blank sheet, or the legacy template.

## 7. Budget, payroll and tax model

### Payroll (`domain/payroll.ts`)

```text
deduction amount = fixed amount, or rate × (gross − exclusion) ≥ 0      (sample 401(k): 5% × (6500 − 0) = 325)
take-home        = gross − Σ pretax − Σ post-tax − Σ ACTUAL withholding  (sample: 4690.96)
wage bases       = gross − Σ pretax deductions flagged for that base      (federal / California / FICA)
```

Withholding (federal, California, Social Security, Medicare) comes straight from the pay stub. The model has no stipend or CA SDI lines; add them as deductions if a pay stub has them.

### Budget (`domain/budget.ts`)

- Each line has a **category (purpose)** and an **explicit funding account**, never inferred from names. A cost split across accounts becomes separate lines. For example, car maintenance is a transportation cost but is funded by PETC and grouped under **Pets etc.** (recurring but non-regular charges).
- One optional **residual** line (Discretionary → ENT) takes whatever is left: take-home − Σ other lines.
- `computeBudget` returns lines, totals by category, totals by funding account, and issues: unmapped lines, remainder below zero, unallocated take-home.
- `diffMonthAgainstBudget` compares a month's allocations with a version. Overrides are kept unless reset, and Done lines whose amount changes return to Pending.

### Tax estimate (`domain/tax/*`)

- Rule sets are data per tax year and jurisdiction: federal brackets, standard deduction and credits; California brackets, standard deduction, exemption credit and Mental Health Services tax; FICA rates, Social Security wage base and Additional Medicare threshold.
- `rates_from_year` and `provisional` record provenance. The imported 2026 California set uses **2025** figures, and every estimate says so.
- `estimateTax` computes liability per component, rounds half-up to whole dollars (Social Security and Medicare combined, as the workbook does), and compares with actual withholding ×12. The result is a projected underpayment or overpayment (sample: $258.52 under).
- A missing year is an error, never a silent fallback. **The estimate never feeds take-home, the budget or the treasury.**

### Versions and the budget → treasury lifecycle

```text
Budget version:  draft ──activate(from month)──► active ──(another activated)──► archived
                 locked when a treasury month first uses it; locked, archived and summary versions are read-only
                 (label, dates, notes and tax year stay editable); "Duplicate" makes an editable draft

Treasury month:  createMonth(source: 'budget')  expected_cash = take-home, allocations = funding by account,
                                                planned = budget, origin = budget, budget_version_id recorded
                 manual edit of an allocation or expected cash ⇒ origin manual_override / manual (never written back)
                 open month ≠ active version ⇒ banner + previewed "Refresh allocations" (explicit, audited, undoable)
                 only kept overrides differ ⇒ quiet note, no refresh prompt
                 closed month ⇒ never refreshed; archival imported months ⇒ no budget link at all
```

No budget code path creates journal entries or postings. The integration tests assert posting counts stay unchanged.

## 8. Import pipelines

```text
bytes ─► analyze…()  (pure, no DB writes) ─► plan { …, warnings, controls, counts, fatal } ─► UI preview ─► commit (ONE transaction)
```

| Pipeline | Recognizes | Commit | Controls |
| --- | --- | --- | --- |
| Treasury (`import/analyze.ts`) | Overview, Monthly Template, Account Ledger, legacy and normalized months, Interco Debt Summary (comparison only), app export tables | `empty`, or `replace` with a safety copy. Replace deletes treasury tables but **updates accounts in place by code**, so budget lines keep valid references. Budget tables are never touched. | Debt counts, totals and net positions; each month's reconciliation |
| Budget (`import/budget/analyzeBudget.ts`) | Budget Plan, Payroll, Tax (withholding table and rule formulas), Housing, Transportation, Lifestyle, Petc, Budget History, Overview | **Adds** versions (history is never replaced), optionally activates the current plan, and keeps existing tax rule sets unless replacement is chosen. Treasury months, entries and debts are never touched. | Take-home, category totals, tax sheet, and funding by account vs the latest treasury month |

- Derived workbook values (balances, statuses, totals, take-home, category totals, tax liabilities) are **only compared**, never imported as data.
- The budget funding map (`FUNDING_MAP`) is explicit data, shown per line and editable after import. It's verified locally by reproducing the reference workbook's latest treasury allocations.
- Every warning carries sheet and cell. A repeated file hash triggers a duplicate warning.
- JSON backup (`export/backup.ts`) includes every table, budget tables included, in foreign-key order, and restores into a fresh database before anything is replaced.

## 9. Routes, views and state management

- **Routing:** hash routes `#/<page>?month=&debt=&account=&role=&version=&tab=` (`app/context.tsx`).
  - Pages: dashboard, monthly, **budget** (versions, or `tab=tax` for the tax rules editor), debts, history, accounts, import, settings.
  - Deep links open a month, a debt drawer, an account filter, or a budget version.
- **State:** the `Treasury` instance is the single source of truth.
  - Components subscribe with `useSyncExternalStore` on `treasury.version` and re-read derived views synchronously: `monthView`, `budgetDiff`, `debtBoard`, `budget.versionView`, `dashboard`.
  - React state holds only drafts, dialogs and filters.
- **Writes** go through `run(() => t.method(...))`. It shows errors as toasts, returns `undefined` only on failure, and returns `true` for successful void calls, so dialogs close reliably.
- **Undo:** the database is snapshotted before each mutation, and Cmd-Z restores it. This covers budget edits, activation and refreshes too.
- **Persistence:** the SQLite file is saved after each commit (IndexedDB in the browser; `<AppData>/databases/<profile>.sqlite` in Tauri, via tmp file + rename).

## 10. Service and domain boundaries

| Concern | Lives in | Never in |
| --- | --- | --- |
| Arithmetic, statuses, directions, take-home, funding totals, tax | `domain/*` (pure, unit-tested) | React components, SQL |
| Validation of user input | `api/schemas.ts`, `api/budget.ts`, `domain/tax/rules.ts` | components (they only pre-check for UX) |
| Transactions, audit, undo, lifecycle rules (closed months, locked versions, overrides) | `api/treasury.ts`, `api/budget.ts` | repositories, UI |
| Row mapping and SQL | `db/repositories.ts`, `db/budgetRepositories.ts` | anywhere else, except integrity checks in tests |
| Workbook knowledge | `import/*`, `export/*` | domain |

## 11. Invariants for budget integration, and where they're enforced

| Invariant | Enforcement |
| --- | --- |
| Budget plans are separate from actual journal entries | Budget code has no path to `journal_entries` or `journal_postings`; tests assert posting counts are unchanged after import, month creation and refresh. |
| Categories describe purpose; accounts describe funding source | `budget_lines.category_id` and `funding_account_id NOT NULL` are separate columns. Split costs are separate lines. No category becomes an account. |
| Transfers aren't expenses | Nothing sums postings as spending; budget totals come only from budget lines. |
| Interaccount borrowing is separate from spending | The budget module never reads or writes `debts` or `debt_events`. |
| PETC stays an actual flexible savings account | PETC is an account ("pets etc.": recurring but non-regular charges). The **Pets etc.** category groups the lines it funds. |
| Historical budgets are preserved | Versions lock when used and are archived (never deleted) when superseded. Summary history is read-only. Closed months keep their allocation snapshot. |
| Budget activity doesn't disturb reconciliation | `computeMonth` is unchanged. Allocations change only through an explicit refresh on open months (`assertOpen`), with a preview, audit and undo. |
| Estimated tax doesn't replace withholding | Take-home uses `payroll_withholdings` only; `estimateTax` output isn't read by payroll, budget or treasury code. |

## 12. Tests and known limitations

Public tests run on synthetic workbooks (`tests/fixtures/`) and the fictional sample household (`src/demo/persona.ts`), so a fresh clone can run everything: `npm run check` (format, lint, types, Vitest, build), `npm run db:check`, and `npm run test:e2e:demo` (Playwright against the demo build). See [Testing](testing.md).

The owner's real-workbook checks live in `tests/local/` and read `reference/`. Both folders are gitignored; Vitest and `npm run test:e2e` pick them up only when present. `npm run privacy:check` scans every publishable file for terms listed in the gitignored `reference/privacy-terms.txt`.

Known limitations:

- The source workbooks contain personal financial data and **aren't committed**. Public tests use synthetic and sample data instead.
- Each commit rewrites the whole SQLite file. That's fine at current size and needs revisiting past tens of MB (ADR 0001).
- Undo covers the current session only. The audit log is permanent.
- The Excel export covers treasury data only. Budget, payroll and tax data round-trip through the JSON backup, not Excel.
- The 2026 California tax figures are 2025 values (provisional) until updated in Tax rules. The estimate assumes a single filer with no credits beyond those entered.
- The funding map for the budget workbook reflects the audited layout. A differently structured workbook needs its lines reassigned after import.
- Legacy months have no expected-cash cell and no entry dates (ADR 0002). They're archival and not linked to budgets.
- The packaged app is ad-hoc signed, not notarized. Native Open/Save dialogs in the desktop build haven't been clicked through by hand.

## 13. Public demo

`npm run build:demo` (Vite `--mode demo`) builds the same app as a static site in `dist-demo/`. The desktop and development builds contain none of it: `main.tsx` loads `src/demo/boot.tsx` only in that mode, and the branch is removed from every other build.

- **Storage:** `SessionDatabaseStorage` keeps the SQLite file base64-encoded in the tab's `sessionStorage`. It survives a reload and is discarded when the tab closes. Each tab is independent, and nothing is sent anywhere. Safety copies stay in memory; if the database outgrows the storage quota, the session continues in memory and the banner says so.
- **Sample data:** `seedHarpers` builds the fictional Harper household through the public service API, so it passes the same validation, lifecycle rules and audit as typed-in data. Dates are relative to today: three closed months and the current open month. The debts cover a roll-forward, a paid-off loan, a reversed overpayment and a `canceled` note. `tests/integration/demo-seed.test.ts` pins every figure.
- **Reset and clean slate:** the banner replaces the database with a freshly built sample or a freshly migrated empty database through `Treasury.replaceDatabase(…, { undoLabel })`, so each can be undone.
- **Guided tour:** `src/demo/Tour.tsx`, eight steps anchored to the pages' own labelled panels (`aria-label`), navigating between pages as it goes. It starts once per browser (a `localStorage` flag, a convenience only) and reopens from the banner. While it's open the app root is `inert`, so focus stays in the tour; arrow keys step and Escape closes. On narrow screens the card becomes a bottom sheet.
- **Sample workbook:** the Import page offers the sample household's workbook, exported from a freshly built sample with the app's own exporter, so visitors can try an import without a file of their own.
- **How the demo plugs in:** `main.tsx` passes `AppExtras` (`app/context.tsx`): a banner and an optional sample workbook. Pages read them from context. The desktop build passes none.
- **Differences from the desktop app:** no profiles (backups restore by replacing the demo data), relative asset paths for any sub-path, no source maps, and a content security policy limited to the page's own origin. Workbook-specific seed aliases are never included.
- **Hosting:** GitHub Pages serves `dist-demo/` (`.github/workflows/deploy-demo.yml`). The same files ship as a small unprivileged nginx image (`Dockerfile`, published to GitHub Container Registry) for anyone who wants to host it themselves.
