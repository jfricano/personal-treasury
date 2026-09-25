# ADR 0005 — Undo, audit trail and safety copies

Status: accepted · 2026-09-24

- **Undo.** Every mutation snapshots the database first, and Command-Z (or the Undo button) restores the latest snapshot for the current session. The stack is capped at 64 MB. This covers deletes of entries, events, debts and months.
- **Audit.** `audit_log` records create, update, delete, close, reopen, import, restore and undo with before/after JSON. Debt-event corrections show in the debt drawer.
- **Imported history.** Deleting an imported month, entry, event or debt needs explicit confirmation, enforced by the API (`confirmImported`) as well as the UI.
- **Closed months** refuse edits in the API. Closing while in Review needs an override note, which is stored and shown.
- **Safety copies.** Before an import replaces data, or a backup replaces the current profile, the app saves `<profile>~<label>-<timestamp>` next to the database. Copies are listed and restorable in Settings and never leave the computer.
- **Profiles** are separate database files. JSON restore defaults to a new profile.
