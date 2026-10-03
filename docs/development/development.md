# Development

Current implementation: **v3 / 0.3.0-preview.2**. Use Node.js 24+; Rust is needed for native builds. See [release status](v3/preview-status.md) for pending acceptance checks.

## Layout

| Path | Contents |
| --- | --- |
| `src/domain/` | Pure types and calculations: decimal money, monthly reconciliation, debt roll-forward, account resolution, payroll (take-home), budget (funding by account, month diff), tax (`tax/rules.ts`, `tax/estimate.ts`). |
| `src/db/` | SQLite driver (sql.js), versioned migrations (schema 1–5), persistent spending aggregates, treasury and budget repositories, storage backends. |
| `src/api/` | `Treasury` service (the application API): validation (Zod), transactions, audit, undo, import commit, budget diff/refresh. `treasury.budget` is the `BudgetService` (versions, payroll, lines, tax rules, budget import). |
| `src/import/` | Treasury workbook recognition and parsers (Overview, Template, Ledger, legacy and normalized months); `import/budget/` for the budget workbook; control comparisons; reports. |
| `src/export/` | Excel workbook export and JSON backup/restore. |
| `src/security/`, `src/review-store/`, `src/sources/`, `src/sync/` | Client cryptography, separate temporary reviews, provider/statement adapters and encrypted sync. |
| `sync-server/` | V3 private web/API service; isolated production dependencies and a persistent encrypted store. |
| `src/features/` | React screens. They call `Treasury` and render domain results; they don't do their own arithmetic. |
| `src/demo/` | Public browser demo only: the fictional Harper household (`persona.ts`), its seed, tab-scoped storage, the banner and the guided tour. Never part of the desktop build. |
| `src-tauri/` | Tauri 2 shell: fs/dialog plugins, native allowlisted provider transport, offline-key storage and screen-lock integration. |
| `tests/unit`, `tests/integration`, `tests/e2e`, `tests/fixtures` | Vitest, Playwright (against the demo build), synthetic workbooks. Public: they use only synthetic and sample data. |
| `tests/local/`, `reference/` | Personal: the owner's workbooks, control totals and the tests that check them. Gitignored; see [reference/README.md](../../reference/README.md). |
| `docker/`, `Dockerfile`, `.github/workflows/` | Demo container, CI and deployment. |
| `docs/guide/` | For people using the app: getting started and the user guide. |
| `docs/development/` | For people building it: this file, [architecture](architecture.md), [data and rules](data-and-rules.md), [workbook import](workbook-import.md), [acceptance tests](acceptance-tests.md), [testing](testing.md) and [decisions](decisions/). |

## Commands

```bash
npm ci
npm run dev            # browser dev server at http://localhost:1420 (IndexedDB storage)
npm run dev:demo       # the public demo with sample data, at http://localhost:1420
npm run dev:private    # private web UI; proxy /api to localhost:8787
npm test               # unit + integration + database checks (Vitest)
npm run db:check       # database integrity, constraints and migrations only
npm run check          # format, lint, types, unit/service tests, all web builds and doc links
npm run test:e2e:demo  # Playwright against the demo build, using the installed Google Chrome
npm run test:e2e       # Playwright against the personal reference workbooks (local only)
npm run lint && npm run typecheck
npm run build          # production web bundle in dist/
npm run build:demo     # static demo site in dist-demo/
npm run build:private  # private web app in dist-private/
npm run test:server    # legacy and v3 service tests
npm run test:e2e:v3-private # disposable v3 private Chrome fixture
npm run test:e2e:private # legacy private browser regressions
npm run docs:links    # Markdown repository links
npm run privacy:check  # scan publishable files for personal terms (run before every push)
```

### Personal data stays local

The owner's workbooks and everything derived from them live in `reference/` and `tests/local/`, which are gitignored. Vitest and `npm run test:e2e` include `tests/local/` only when it exists, so a fresh clone runs the public suite alone. `npm run privacy:check` fails if any committed or committable file contains a term from `reference/privacy-terms.txt`; run it before pushing.

## Private cloud build

`npm run build:private` creates the v3 password/MFA web app. The [service README](../../sync-server/README.md) documents current configuration; the [Railway guide](../guide/railway-sync.md) covers deployment and migration. `npm run preview:private:fixture` creates a disposable localhost service with fictional credentials. Private sessions encrypt local working copies; snapshots, reviews and the provider vault are separate stores.

The public demo excludes the live provider adapter. Local native builds work offline without private auth. Configured Connected builds select the service via `PT_SERVICE_ORIGIN` at build time and retain the private app's storage identity. **Connected artifacts stay private; only Local is publicly distributed.**

### Demo container

```bash
docker build -t personal-treasury-demo .
docker run --rm -p 8080:8080 personal-treasury-demo   # http://localhost:8080
```

The image builds the demo in a Node stage and serves it from an unprivileged nginx on port 8080 with a health check at `/healthz`. `.dockerignore` keeps `reference/` and `tests/local/` out of the build context.

## Desktop app (Tauri)

Rust is installed in `~/.cargo/bin`. If `cargo` isn't found, run `source ~/.cargo/env` or add that directory to `PATH`.

```bash
npm run tauri:dev          # Local Dev, separate app identity/storage
npm run desktop:build      # Local.app + DMG in target/release/bundle/
npm run desktop:installer  # builds Local.app and a self-contained PKG
npm run desktop:installer -- --existing-build # package a matching, verified app already built
```

Use these wrappers so app names, storage identity and native CSP follow the selected variant. For a private source build, set `PT_SERVICE_ORIGIN` to the exact HTTPS service origin before the command. Development builds append **Dev** to the name and identifier. The PKG builder targets Apple Silicon/macOS 12+ and installs only the named app in Applications, without install scripts or records. Generated files are in `src-tauri/target/release/bundle/`; Connected packages remain private and explicitly ignored, including copies outside that directory.

### Signing and preview permissions

`tauri.conf.json` defaults to ad-hoc application signing. The current PKG builder does not sign the installer or notarize the app. Its readme discloses that preview status. Downloaded files may require **System Settings → Privacy & Security → Open Anyway** for both the installer and first app launch; see [Getting started](../guide/getting-started.md#2-install-the-local-mac-app).

For a stable distributable app, configure a Developer ID Application identity and notarization credentials using [Tauri's macOS guide](https://v2.tauri.app/distribute/sign/macos/), then build through `npm run desktop:build`. A signed PKG also requires a Developer ID Installer identity and a signing/notarization step beyond the current script. See the [distribution gates](../distribution-plan.md).

### Data and packaged validation

Local profiles live under `~/Library/Application Support/com.personaltreasury.app.local/databases/`. Connected retains `com.personaltreasury.app` and uses encrypted private storage; Dev variants have separate identifiers. App deletion from Applications leaves these data folders and any cloud history intact. Records and keys are never packaged with installers.

The [release report](v3-release-report.md) records native first launch, installer verification and earlier automated evidence. Native UI, external-install, provider and security acceptance remain separate gates; do not infer them from `npm run check` or a successful build.
