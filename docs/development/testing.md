# Testing

Public fixtures are synthetic workbooks or the fictional Harper household. Tests against the owner's workbooks are in ignored `tests/local/` and `reference/`. Current v3 publication and dated evidence are in the [release report](v3-release-report.md); acceptance requirements are broader than an automated pass.

## Commands

| Command | What it runs |
| --- | --- |
| `npm run check` | Format, lint, types, Vitest, Node service tests, default/demo/private web builds, and documentation links. It does not compile the native Rust app. |
| `npm run test:e2e:demo` | Chrome against the production demo, including v2 regressions and v3 review/report workflows. |
| `npm run test:e2e:v3-private` | Fictional v3 sign-in, recovery factor, virtual passkey, encrypted reload/unlock and review conflicts. |
| `npm run test:e2e:private` | Legacy token/passphrase regressions using the separate private-legacy mode. |
| `npm run test:server` | Legacy and v3 auth, MFA, sessions, step-up, migration, retention, review/vault and conditional-write tests. |
| `npm run db:check` | SQLite integrity, constraints and forward migrations. |
| `npm run docs:links` | Repository Markdown file-link resolution. |
| `npm run privacy:check` | Before every push: scan publishable files against ignored owner privacy terms. |
| `node scripts/smoke-private-container.mjs` | Disposable private Docker fixture: runtime restrictions, encrypted persistence, auth and restart. Requires Docker. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Native provider allowlist and persisted rate/backoff tests. |
| `npm run desktop:build` | Build the native app; run packaged acceptance separately. |

CI (`.github/workflows/ci.yml`) runs the web/service checks and all three Chrome suites plus the private container smoke test. The demo-container workflow also builds and smoke-tests its image. Pages builds/tests the demo when `main` changes. Native packaging and owner-private workbook tests are separate from Linux CI.

## Suite coverage

- `tests/unit/`: exact decimal money, account resolution, monthly reconciliation, debt roll-forward, payroll/budget/tax, conditional sync and spending/review/crypto/vault rules.
- `tests/integration/`: workbook controls and round trips, SQLite migrations through schema 5, backup recovery, budget/treasury workflows, sample data, spending-report persistence and aggregate-only canaries.
- `tests/server/`: v2 regression protocol and v3 authentication, credential/session revocation, step-up, migration cutover, at-rest rotation, tombstones, conflicts and sanitized logging.
- `tests/e2e/`: sample reset/undo/reload, imports/exports, reconciliation, debts, budgets, responsive control regressions and sample review → classify/pair → clear → aggregate export.
- `tests/e2e-v3-private/`: strict CSP/Trusted Types, signed-in encrypted storage and reload, virtual passkeys and multi-browser review conflicts with disposable credentials.
- `tests/e2e-private/`: the legacy protocol only. Passing it does not certify current v3 sign-in.

See the test files for exact assertions. Historical test counts remain in dated reports instead of this command reference. Date-relative demo tests pin their clocks where needed.

## Native and external acceptance

Use [treasury acceptance](acceptance-tests.md), [v3 acceptance](v3/acceptance-tests.md) and the [security matrix](v3/security.md#7-security-requirements) together. Pending gates include live/Sandbox provider lifecycle, packaged Mac enrollment/unlock/lock behavior, Safari/iOS passkeys and accessibility, independent security review and operational restore/migration rehearsals.

The Local preview app and installer have payload/signature/preflight checks and a recorded empty native first launch. They remain ad-hoc/unsigned and unnotarized. A clean install of the downloaded PKG on another Mac has not been recorded. Earlier v2 native-dialog tests are historical evidence, not a substitute for v3 packaged acceptance.

## Owner-local data

Vitest and the local Playwright configuration include `tests/local/` only when it exists. Those tests read ignored `reference/`. Never publish their fixtures, figures or control reports. Connected installers and app copies are explicitly ignored even outside `src-tauri/target`; only Local assets belong in public GitHub releases.
