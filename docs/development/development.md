# Development

## Layout

| Path | Contents |
| --- | --- |
| `src/domain/` | Pure types and calculations: decimal money, monthly reconciliation, debt roll-forward, account resolution, payroll (take-home), budget (funding by account, month diff), tax (`tax/rules.ts`, `tax/estimate.ts`). |
| `src/db/` | SQLite driver (sql.js), versioned migrations (v1–v3), treasury and budget repositories, storage backends. |
| `src/api/` | `Treasury` service (the application API): validation (Zod), transactions, audit, undo, import commit, budget diff/refresh. `treasury.budget` is the `BudgetService` (versions, payroll, lines, tax rules, budget import). |
| `src/import/` | Treasury workbook recognition and parsers (Overview, Template, Ledger, legacy and normalized months); `import/budget/` for the budget workbook; control comparisons; reports. |
| `src/export/` | Excel workbook export and JSON backup/restore. |
| `src/features/` | React screens. They call `Treasury` and render domain results; they don't do their own arithmetic. |
| `src/demo/` | Public browser demo only: the fictional Harper household (`persona.ts`), its seed, tab-scoped storage, the banner and the guided tour. Never part of the desktop build. |
| `src-tauri/` | Tauri 2 desktop shell (fs + dialog plugins only). |
| `tests/unit`, `tests/integration`, `tests/e2e`, `tests/fixtures` | Vitest, Playwright (against the demo build), synthetic workbooks. Public: they use only synthetic and sample data. |
| `tests/local/`, `reference/` | Personal: the owner's workbooks, control totals and the tests that check them. Gitignored; see [reference/README.md](../../reference/README.md). |
| `docker/`, `Dockerfile`, `.github/workflows/` | Demo container, CI and deployment. |
| `docs/guide/` | For people using the app: getting started and the user guide. |
| `docs/development/` | For people building it: this file, [architecture](architecture.md), [data and rules](data-and-rules.md), [workbook import](workbook-import.md), [acceptance tests](acceptance-tests.md), [testing](testing.md) and [decisions](decisions/). |

## Commands

```bash
npm install
npm run dev            # browser dev server at http://localhost:1420 (IndexedDB storage)
npm run dev:demo       # the public demo with sample data, at http://localhost:1420
npm test               # unit + integration + database checks (Vitest)
npm run db:check       # database integrity, constraints and migrations only
npm run check          # format, lint, typecheck, tests, production build and demo build
npm run test:e2e:demo  # Playwright against the demo build, using the installed Google Chrome
npm run test:e2e       # Playwright against the personal reference workbooks (local only)
npm run lint && npm run typecheck
npm run build          # production web bundle in dist/
npm run build:demo     # static demo site in dist-demo/
npm run privacy:check  # scan publishable files for personal terms (run before every push)
```

### Personal data stays local

The owner's workbooks and everything derived from them live in `reference/` and `tests/local/`, which are gitignored. Vitest and `npm run test:e2e` include `tests/local/` only when it exists, so a fresh clone runs the public suite alone. `npm run privacy:check` fails if any committed or committable file contains a term from `reference/privacy-terms.txt`; run it before pushing.

### Demo container

```bash
docker build -t personal-treasury-demo .
docker run --rm -p 8080:8080 personal-treasury-demo   # http://localhost:8080
```

The image builds the demo in a Node stage and serves it from an unprivileged nginx on port 8080 with a health check at `/healthz`. `.dockerignore` keeps `reference/` and `tests/local/` out of the build context.

## Desktop app (Tauri)

Rust is installed in `~/.cargo/bin`. If `cargo` isn't found, run `source ~/.cargo/env` or add that directory to `PATH`.

```bash
npm run tauri dev      # desktop window with hot reload
npm run tauri build    # .app + .dmg in src-tauri/target/release/bundle/
```

`tauri.conf.json` sets `"signingIdentity": "-"`, so `tauri build` produces an **ad-hoc signed** build (verified with `codesign --verify --deep --strict`) that runs on this Mac. It isn't notarized, so another Mac's Gatekeeper will block it. For a distributable build:

1. Get a *Developer ID Application* certificate (Apple Developer Program) and install it in your login keychain.
2. Set `bundle.macOS.signingIdentity` to the certificate name (or export `APPLE_SIGNING_IDENTITY`).
3. For notarization, export `APPLE_ID`, `APPLE_PASSWORD` (app-specific password) and `APPLE_TEAM_ID`, then run `npm run tauri build`.

The DMG step styles the disk image by driving Finder and can fail intermittently (`error running bundle_dmg.sh`). If it does, detach any leftover `/Volumes/dmg.*` volume (`hdiutil detach`), delete `src-tauri/target/release/bundle/macos/rw.*.dmg`, and rerun `npm run tauri build`.

The database lives at `~/Library/Application Support/com.personaltreasury.app/databases/<profile>.sqlite`. Safety copies sit next to it as `<profile>~<label>-<timestamp>.sqlite`.

Verified in the packaged app: first launch creates the database (AppData scope, mkdir, write-then-rename), and the v1→v2 migration upgrades an existing file. Not yet exercised by hand: the native Open/Save dialogs for import, export and backup. They use `tauri-plugin-dialog`, which adds the chosen path to the fs scope.
