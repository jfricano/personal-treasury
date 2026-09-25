# Personal Treasury v2: review, plan, and builder handoff

Prepared 2026-09-25 from the published demo, the current source, and the existing test suite. This is a **build specification**, not a claim that v2 fixes or exhaustive testing are complete.

## Executive decision

Keep the product's compact ledger structure, navy headings, pale blue bands, exact monetary rules, local storage, and current workflows. V2 should fix the confirmed interaction and layout defects first, make pending work easier to distinguish from genuine reconciliation problems, then add a restrained button and color refinement. No new account model, hosted service, bank feed, or large navigation redesign is in scope.

The public demo and desktop app share most React/domain code, but the demo stores data in one browser tab while the desktop app uses local SQLite files through Tauri. A browser-only pass cannot certify native file dialogs, profiles, safety copies, or macOS packaging.

## Current baseline and limits

- `npm run check`: passed on 2026-09-25 (format, lint, typecheck, 166 Vitest tests across 14 files **in this checkout, including gitignored local suites**, desktop web build, demo build).
- `npm run test:e2e:demo`: 8 Playwright tests passed on 2026-09-25 against the local production demo build in Chrome. They cover important happy paths, not every visible control or state.
- Visual/UX review covered the published demo's eight pages at desktop and selected phone widths. Findings below name the evidence source; source-derived defects still need a regression test.
- The tester opened all eight published-demo routes at 375 px without page-level horizontal overflow; the ordinary New debt dialog fit; account creation and duplicate rejection worked; no console errors appeared on traversed paths. This spot check does not cover all controls.
- Desktop native Open/Save dialogs are already listed as unverified by hand in [Development](development.md). They remain a v2 release gate.
- Private reference workbooks and tests stay in gitignored `reference/` and `tests/local/`; never copy their names, figures, or screenshots into public artifacts.

## Confirmed problems and required fixes

| ID | Priority | Problem and evidence | Builder acceptance criteria |
| --- | --- | --- | --- |
| V2-01 | P1 | At 375 px, **Monthly reconciliation → Advanced entry** opens a dialog at 680 px wide because `Dialog` sets inline `minWidth: 680` for `wide`. The right-hand fields and footer extend off screen. **Refresh from budget** uses the same wide dialog. Published demo reproduction; `src/components/ui.tsx` and `src/features/monthly/MonthlyPage.tsx`. | Both dialogs fit 375/390 px without page-level horizontal overflow. All fields and actions are reachable by touch and keyboard. At desktop widths, the intended wide form remains usable. Add a mobile Playwright regression for both dialogs. |
| V2-02 | P1 | The editable 401(k) formula breaks into orphan `=`, value, operator and `)` lines at 1440 px. The shared `.cell { width: 100% }` applies to formula inputs in a wrapping row. Local production-demo screenshot and `src/features/budget/BudgetPage.tsx`, `src/app/styles.css`. | Rate and exclusion inputs have scoped, bounded widths. The formula reads as one coherent line, or wraps between meaningful groups, at 1440/1280/1024/768/390 px. Locked/read-only versions remain legible and every field remains keyboard accessible. |
| V2-03 | P1 | The Dashboard says **Ready to transfer** while five ordinary pending confirmations appear as **Items requiring review**. Monthly also calls nonblocking pending items **Reconciliation issues**. `src/domain/monthly.ts` already marks these issues `blocking: false`; `src/features/dashboard/Dashboard.tsx` renders them together. | Pending confirmations appear under a clear transfer-completion heading; actual failed checks and warning flags appear under **Needs review**. Counts, status text, and accessible names agree. The status algorithm and monetary calculations do not change. |
| V2-04 | P2 | Dashboard's review header counts only `m.result.issues.length`, while the same panel can also show account, budget-difference and import warnings. Source: `src/features/dashboard/Dashboard.tsx`. | Each displayed section's count equals its visible items, including all non-month warnings. Empty-state copy is truthful. |
| V2-05 | P2 | Five Dashboard **Resolve** buttons all route to the month without identifying the relevant account or entry. Source: `src/features/dashboard/Dashboard.tsx`. | A pending transfer opens the selected month and focuses/highlights that account's Done control; an entry issue lands at that entry; general reconciliation issues land at the relevant summary. Keyboard focus and browser Back behavior are predictable. |
| V2-06 | P2 | At about 1280 px, **Net by account** and **Debt detail** sit side by side; both tables scroll horizontally and descriptions wrap heavily. Source: `src/features/debts/DebtsPage.tsx` custom columns, shared 1100 px stacking rule in `src/app/styles.css`, published demo inspection. | Stack earlier or give Debt detail the full row until its key columns and notes fit naturally. At 1280 px, avoid two competing horizontal scrollers. At phone widths, intentional table scrolling and the frozen identifying column still work. |
| V2-07 | P2 | At about 1280 px, the Budget tax estimate table clips/scrolls inside half the page; Monthly header leaves **Export journal CSV** on its own line. Published demo inspection. | The tax difference and its horizontal-scroll affordance are visible, or the panels stack before clipping. Monthly actions wrap in intentional groups without an orphan control at 1280/1024/390 px. |
| V2-08 | P1 | `todayIso()` uses the UTC date (`toISOString().slice(0, 10)`) for new debt, payment and transfer defaults. In Pacific time after 17:00 PDT/16:00 PST, it defaults to tomorrow; early morning in positive UTC offsets can default to yesterday. Source-derived from `src/components/ui.tsx` and call sites. | Date defaults use the user's local calendar day in both demo and desktop. Test immediately before/after local midnight in at least a negative and positive UTC offset, and confirm explicit dates stay unchanged. |
| V2-09 | P2 | On phone, an expanded **What to try** list stays open after an exercise link navigates and can push the page's controls below the first screen. Source: `src/demo/DemoBanner.tsx`; published demo inspection. | Choosing an exercise closes the list and lands on its intended page/target. The list can be reopened, and privacy/demo context remains discoverable. |
| V2-10 | P2 | On a direct phone route to `#/debts`, the active tab is only partly visible at the edge of the horizontal nav. Published demo inspection; mobile nav rules in `src/app/styles.css`. | The active tab scrolls fully into view on initial load and navigation; users can tell that more sections are available. |

Priority is for the next build, not a claim that all other controls are defect-free. A builder who finds a new reproducible defect should add it to this list with steps, expected/actual behavior, affected storage mode, and a regression test.

## Visual direction

1. Preserve navy navigation and table headers, pale blue section bands, white work areas, compact rows, tabular numbers, and account-code typography. Do not change density to a card-heavy interface.
2. Use one restrained deep teal accent as a **candidate** for primary actions and selected detail: `#176B63` with `#11564F` hover and `#E8F4F1` tint. Keep existing green for completed/saved states and red/amber for genuine exceptions. Validate the candidate on a small before/after mockup, then adjust for contrast before applying globally.
3. Refine button padding, border, radius, hover, pressed, disabled and focus states consistently. Target roughly 6 px vertical/11 px horizontal padding and a 6 px radius where space permits; keep small table actions compact. Avoid gradients, large shadows, new display fonts, and decorative animation.
4. Raise small muted copy selectively where it affects comprehension, especially at phone width. Keep monetary figures aligned and do not make color the only status signal.
5. Meet text contrast of at least 4.5:1 and control boundary/focus contrast of at least 3:1; retain visible keyboard focus and reduced-motion behavior. Review all eight pages at 390, 768, 1024, 1280 and 1440 px for clipped text, borders, panel edges, and intended-only horizontal scroll.

## End-to-end coverage specification

Make a control inventory from the rendered UI, including every button, link, form field, tab, menu, dialog action, row action and keyboard shortcut. Give each control a stable accessible name, an expected state transition, a storage assertion where it changes data, and a Playwright test or a documented reason for a manual native test. Exercise empty, sample/populated, invalid, closed/read-only, and restored states. No visible enabled control may be a dead end.

| Surface | Required interaction coverage |
| --- | --- |
| Shell and demo | Every nav route, direct hash load, Back/Forward, active tab visibility, Undo and disabled state, toasts, tour start/skip/restart/keyboard steps, exercise links, reset/blank/undo, same-tab reload and independent tab storage. |
| Dashboard and History | Every summary drill-down, month selector, pending/review action target, Done toggle, Show all, budget/debt links, history row/link, empty states. |
| Monthly | Create/duplicate/blank month, budget link and refresh with/without overrides, allocations and expected cash edit/revert, ordinary and advanced entries, validation, loan-link posting, journal edit/delete/CSV, account filters, pending/done, close/reopen/override, notes and closed protection. Assert journal postings and derived status in the service/database after UI actions. |
| Budget and tax | Version create/duplicate/activate/lock, dates, payroll and deductions, line/category edits, discretionary funding, tax year/rules copy/edit/save, invalid input, source-to-month refresh. Assert take-home, funding, tax display and stored version history. |
| Debts and Accounts | Debt filters/search/dates/account, create/payoff/overpay/adjust/correct/delete, event provenance and linked journal, CSV; account create/edit/reorder/color/alias/review/archive/delete constraints. Assert event roll-forward and account net controls in service/database. |
| Import/export and Settings | Treasury/budget preview, warnings/control failures, cancellation and transaction rollback, re-import warning, workbook/CSV/JSON export, fresh-profile restore, profile switch/create, safety-copy restore and audit log. Use synthetic files in public tests; use private reference tests locally only. |

**Visual and access pass:** capture reviewed screenshots for each of the eight pages and key dialogs/drawers at the widths above in populated and relevant empty/error states. Check text containers, wrapping, borders, sticky columns, overlay bounds, focus order, keyboard activation, labels, contrast, and reduced motion. Automated geometry assertions should catch viewport overflow; screenshot comparison should be reviewed by a person rather than blindly accepted. Run Chrome for the web demo and a native macOS/Tauri pass for file dialogs, local persistence, profiles, safety copies, and build launch. Add WebKit coverage where practical because Tauri on macOS uses WebKit.

**Logic pass:** keep every existing acceptance test in [Acceptance tests](acceptance-tests.md). Add boundary and error tests at the domain/service layer rather than trying to prove all combinations through slow UI scripts. Verify exact decimal and reconciliation invariants, no silent import coercion, transaction rollback, audit/undo, backup/restore parity and export round trip. The desktop app has no hosted backend; “back-end” verification means its local API, repositories, SQLite persistence, imports and exports.

## Build order and review gates

1. **Inventory and reproduce.** Record route/control inventory; convert V2-01 through V2-10 into failing tests or documented visual reproductions. Confirm published-demo and local-build parity before coding.
2. **Correct behavior.** Fix mobile dialog bounds and local-date defaults; split pending/review states and counts; make issue actions target the right control. Keep financial rules intact.
3. **Resolve layout.** Fix the formula row, debts/tax panel breakpoints, header actions, demo exercise collapse and mobile active-tab visibility. Review screenshots at every target width.
4. **Apply restrained polish.** Approve one small before/after visual proposal, then apply the shared token/button changes. Check contrast, keyboard focus and dense-table alignment.
5. **Complete test matrix.** Automate every browser control and critical negative path, run the existing private reference gates locally, and perform a documented packaged macOS pass. Re-run privacy check before any push.

Release only with a report that lists test commands/counts/results, control inventory coverage, screenshot widths/states, native manual results, private control comparisons without disclosing private values, and every remaining limitation. A green existing test suite alone does not satisfy the v2 gate.

## Builder handoff prompt

> Implement Personal Treasury v2 according to `docs/development/v2-plan.md`. Start by inventorying the rendered controls and reproducing V2-01 through V2-10. Fix confirmed behavior and layout defects, then apply a minimal navy/blue/teal button refinement that preserves the compact ledger and vintage feel. Keep the domain rules, local-first privacy model, exact decimal arithmetic, import provenance, and undo/backup behavior unchanged. Add UI regressions for each fix and complete the per-page control matrix, with service/SQLite assertions for data-changing flows. Run the public unit/integration/build and demo E2E suites, private reference gates locally, visual review at 390/768/1024/1280/1440 px, and a packaged macOS pass including native file dialogs, profiles, safety copies and persistence. Produce a release report with evidence and unresolved gaps; do not claim full coverage from the current eight demo E2E tests.
