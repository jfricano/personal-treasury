# ADR 0003 — Account codes, aliases and unknown codes

Status: accepted · 2026-09-24 · updated 2026-09-25

- **Canonical spelling.** Codes are trimmed and uppercased (`ent`, `Ent` → `ENT`). The original text is kept on each posting (`original_code`) and each debt event (`source_debtor` / `source_creditor`).
- **Seed aliases** (editable in Accounts): `Splurge → SPLG` from the spec, plus **`Petc.` → PETC**, a header spelling in one legacy month sheet. The owner confirmed this mapping on 2026-09-24, and every use still produces a warning in the import report.
- **Workbook-specific aliases** stay out of source control. An optional `reference/seed-aliases.json` (an array of `{ alias, target, note }`) is merged into the seeds at build time by `import/analyze.ts`. `reference/` is gitignored, and the public demo build never includes the file.
- **`???`** is kept as its own account with `needs_review`, shown as “Imported unknown” until you mark it reviewed.
- **Conflicting parties.** When a loan's first row names one debtor and later rows name another, the origin rule keeps the first row's accounts as the origin and warns on each conflicting row. Nothing is merged or dropped, and the roster keeps every observed code, including codes that appear only once.
- **PETC description.** The workbook has no cell note, so the description comes from the handoff spec: “Flexible, as-needed actual savings account used for pets, medical, dental, auto maintenance, and similar expenses.” No behavior depends on it.

The specific codes and loans behind these decisions are recorded with the owner's reference data in `reference/`, which is never committed.
