# Testing

Every public test uses synthetic workbooks (`tests/fixtures/`) or the fictional sample household (`src/demo/persona.ts`), so a fresh clone runs the whole suite. CI runs the same commands on every push and pull request (`.github/workflows/ci.yml`).

| Command | What it runs |
| --- | --- |
| `npm run check` | Formatting, lint, types, all Vitest suites, the desktop build and the demo build |
| `npm run test:e2e:demo` | Playwright against the production demo build, using the installed Google Chrome |
| `npm run db:check` | Database integrity, constraints and migrations only |
| `npm run privacy:check` | Owner's machine only, before pushing: no personal terms in any publishable file |

## Vitest

| File | Tests | Covers |
| --- | ---: | --- |
| `tests/unit/money.test.ts` | 5 | Decimal parsing, sums without float artifacts, the $0.01 tolerance, formatting (AT1). |
| `tests/unit/monthly.test.ts` | 15 | Final transfer, transfer validation, legacy postings without plugs, status rules (AT2–AT4). |
| `tests/unit/debts.test.ts` | 10 | Roll-forward, payoff, reversal, event ordering, payment signs, transfer suggestions, cancel notes (AT5, AT7). |
| `tests/unit/accounts.test.ts` | 3 | Aliases and unknown codes (AT8). |
| `tests/unit/payroll-budget-tax.test.ts` | 19 | Take-home, wage bases, tax estimate and rule edge cases, budget funding and month diff, using the sample household's payroll. |
| `tests/integration/synthetic-import.test.ts` | 7 | Importing a synthetic workbook in the source layouts: aliases and unknown codes, inherited debt metadata, canceled and reversed debts, legacy months without plugs, normalized months with flagged drafts, fatal errors (AT3, AT6–AT8). |
| `tests/integration/database.test.ts` | 6 | Migrations, integrity, foreign keys, normalized money text and constraints. |
| `tests/integration/demo-seed.test.ts` | 9 | The sample household's figures, date handling across year boundaries, and undoable reset and clean slate. |
| `tests/integration/workflows.test.ts` | 23 | Incremental debt controls (AT10), monthly workflow and closed-month protection (AT13), accounts, budget → treasury refresh, tax rules per year, backup and restore (AT14), Excel round trip (AT15). |

## Playwright (demo build)

The clock is pinned to 2026-09-24 so the date-relative sample data gives exact figures.

1. Sample data → a change survives reload → start blank → undo → reset; a new tab starts from the sample.
2. Allocation change → Review → undo; keyboard transfer settles a reversed debt and is recorded on the loan; mark done → Complete → close.
3. Pay off a debt, then overpay another and see the direction reverse.
4. Budget plan shows versions and take-home.
5. JSON backup → blank → restore; Excel export → blank → import with all controls passing.
6. Guided tour: starts on a first visit only, walks every page with the keyboard, finishes on the dashboard, and reopens from the banner.
7. Sample workbook: download → blank → import with every control passing.
8. Phone width (375 px): no page scrolls sideways; wide tables scroll inside their panels; the loan drawer and payment dialog fit.

## The owner's reference workbooks

The same checks against the owner's real workbooks (control totals, net positions, legacy months, budget import) live in `tests/local/` and read `reference/`. Both folders are gitignored, so their results and figures are kept locally.
