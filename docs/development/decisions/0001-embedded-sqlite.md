# ADR 0001 — Embedded SQLite (sql.js) instead of the Tauri SQL plugin

Status: accepted · 2026-09-24

## Context

The original specification asked for SQLite through the supported Tauri SQL plugin. Two problems blocked that:

1. **Atomic imports.** `tauri-plugin-sql` runs statements on a pooled `sqlx` connection. `BEGIN`, the inserts, and `COMMIT` sent as separate `execute` calls can land on different pooled connections, so a multi-statement import can't be guaranteed to roll back as a unit. The spec requires imports to run in one transaction and roll back completely on failure (acceptance test 12).
2. **Toolchain.** Rust isn't installed on the development Mac yet (the user will install it). With the database in the web layer, the whole app can be built and tested now, and the Tauri shell is added without changing application code.

## Decision

- SQLite runs in-process as WebAssembly through `sql.js` (`src/db/driver.ts`). Transactions and savepoints run on one connection, so they are truly atomic.
- The database is a standard SQLite file. `DatabaseStorage` (`src/db/storage.ts`) persists it after every committed change:
  - Tauri: `<AppData>/databases/<profile>.sqlite`. The app writes a `.tmp` file and renames it into place, so a crash mid-write can't corrupt the database.
  - Browser (development and Playwright): IndexedDB.
  - Tests: memory.
- Vitest runs the same engine in Node, so integration tests use exactly the SQL the app runs.

## Consequences

- Local storage: unchanged. The file is ordinary SQLite and can be opened with any SQLite tool.
- Excel migration: unaffected. Import and export are pure TypeScript over SheetJS.
- macOS packaging: unchanged. The Tauri shell only registers `fs` and `dialog`, and capabilities restrict `fs` to `$APPDATA` plus the files you pick in a dialog. No network plugin is registered.
- Cost: each commit rewrites the whole file. That takes milliseconds at the current size (about 200 KB) and stays acceptable into the tens of MB. If the data grows past that, move persistence to a Rust command using `rusqlite` with the same schema and migrations.

## Update — 2026-09-24

Rust is now installed. `npm run tauri build` produces an ad-hoc signed `.app` and `.dmg`. The packaged app creates and migrates `<AppData>/databases/default.sqlite` as described above.

## Confirmed — 2026-09-24

The user delegated the storage choice. Embedded SQLite stays: it's the only option in this stack that keeps multi-statement imports atomic without adding Rust persistence code. Revisit only if data size makes whole-file writes slow.
