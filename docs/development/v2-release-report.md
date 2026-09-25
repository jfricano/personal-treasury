# Personal Treasury v2 release report

Date: 2026-09-25. Branch: `codex/v2`. V1 remains on `main` and at tag `v1-baseline` (`9e21d48`). This report describes the local checkout and packaged macOS build; no remote release was published.

## Delivered

- V2-01: wide Monthly dialogs now fit the viewport, with scrolling inside the dialog where needed.
- V2-02: 401(k) formula controls have bounded widths and wrap as coherent groups.
- V2-03/04/05: pending transfers, blocking issues, and other review flags have separate panels, accurate visible counts, and links to the relevant month control or entry. Browser Back and focus were exercised.
- V2-06/07: debt and tax panels stack before their tables compete for width; Monthly header actions wrap together.
- V2-08: new debt, payment, and transfer date defaults use the local calendar day. Pacific and Tokyo clock boundary tests cover negative and positive UTC offsets. Tokyo is a test zone only.
- V2-09/10: demo exercise links collapse after navigation and open their named debt; the active mobile nav tab scrolls into view with a swipe hint.
- Visual refinement: compact ledger rows, navy headings, pale blue bands, and account-code typography remain. Primary buttons use deep teal; hover and focus states are consistent. White text on primary/hover teal is 6.33:1/8.51:1 contrast.
- An additional defect found during screenshot review is fixed: replacing a formatted money field could append digits. Editable amounts now display full stored decimal precision, and replacement is checked at all five widths and after reload.
- Native workbook selection omits the macOS multi-extension filter that made a valid `.xlsx` file unselectable in the packaged Open dialog. The app still validates the workbook extension before reading. Picker errors now surface as toasts.

The public demo and desktop app share the changed components and domain code. The [rendered control inventory](v2-control-inventory.json) and [coverage matrix](v2-control-matrix.md) record the routes, states, expected effects, and test evidence. The initial inventory and V2-01 through V2-10 reproductions were recorded before source edits; baseline route counts are in the matrix.

## Verification

| Gate | Result |
| --- | --- |
| `npm run check` | Passed: Prettier, ESLint, TypeScript, 166 Vitest tests in 14 files, desktop build, demo build. |
| `npm run test:e2e:demo` | Passed: 24 Chrome tests, including V2-01 through V2-10, monetary input replacement, control-family data effects, and visual captures. |
| `npm run test:e2e` | Passed: 5 local private reference E2E flows. No private values or file names are included here. |
| `npm run privacy:check` | Passed. |
| `npm run tauri -- build --bundles app` | Passed: packaged `Personal Treasury.app`, ad-hoc signed. |

The browser pass covered same-tab persistence and independent tab storage; journal create/edit/delete/CSV; account create/edit/alias/color/archive/delete/undo; debt filtering/export, payment, adjustment, correction, deletion, undo and roll-forward; budget duplication/activation/draft deletion; import preview/commit and JSON/Excel round trips. The unit and integration suite continues to cover exact decimal and local service/database rules. Private reference controls passed locally without publishing their inputs or comparisons.

## Visual review

All eight populated demo pages were captured at the top and bottom of the main scroll pane at **390, 768, 1024, 1280, and 1440 px**. Advanced entry, new month, budget refresh, new debt, payment, loan drawer, alias, and new budget were captured at the same widths, with an additional bottom-of-drawer image: **125 screenshots** total. The 390 px captures used an 812 px tall viewport. The Chrome assertions found no page-level horizontal overflow and no dialog/drawer edge outside the viewport. The formula-group, panel-stack, monthly-action, and active-nav geometry regressions passed. Wide ledgers retain their intended internal horizontal scroll on phone widths.

Screenshot artifacts are under `test-results/v2-all-eight-pages*` and `test-results/v2-key-dialogs*` in this checkout; visual contact sheets are under `test-results/v2-review`. They contain only fictional demo data and are gitignored. The image review found the formatted-money replacement bug described above; it was fixed and the full capture suite was rerun.

The final top/bottom and dialog sheets were inspected at all five widths. Headers, panel edges, dialog footers, and lower-page actions remained reachable; no further clipping was found beyond intentional horizontal scrolling inside wide tables. The phone drawer's linked entries and Delete action were visible after scrolling its body.

## Packaged macOS pass

The app launched from the packaged bundle. Tests used two isolated local profiles and left the original `default` profile unchanged. Through native Open/Save dialogs, the tester saved a JSON backup, restored it, restored an automatic safety copy, opened a fictional `.xlsx` workbook, committed its passing preview, and exported an Excel workbook. The app was quit and relaunched; selected profile and imported data persisted. After the final package rebuild, the app relaunched and retained the isolated profile's account records; the UI was returned to `default`. Profile creation/switching, safety-copy behavior, import provenance, and audit display were exercised.

The bundle is ad-hoc signed and was **not notarized** because Apple notarization credentials were unavailable. Distribution outside local testing remains a separate step.

## Rollback

`main` and `v1-baseline` still point to the unmodified v1 commit. V2 is isolated on `codex/v2`. To run v1 again, switch the checkout to `main` and rebuild (`npm run tauri -- build --bundles app`); keep a JSON backup before replacing a desktop profile with another version. V2 did not add a storage migration or change the schema, so the branch switch does not require a conversion script. The v1 tag remains an immutable comparison point.

## Remaining gaps

- Chrome automation covers every **control family and critical data effect** in the matrix, but does not click every repeated row instance or every payroll, budget-line, and tax-rule input separately. It is therefore not an exhaustive per-control certification.
- The 125-image grid covers populated routes and key dialogs. Blank, invalid, closed, and restored states have targeted tests, but not a complete five-width screenshot matrix. WebKit was exercised through the packaged macOS app rather than an automated WebKit suite.
- Accent text contrast was measured, but a complete automated contrast audit of every text, border, and focus state was not run.
- Native file dialogs and profile recovery were manually exercised on isolated profiles. They are not in CI. Notarization and an external distribution install were not performed.

These gaps should be closed before treating the build as a fully certified external release. The v2 implementation and demo are available locally for review and can be rolled back to v1 without a schema migration.
