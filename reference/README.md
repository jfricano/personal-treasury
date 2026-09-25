# reference/ — personal data, never committed

Everything in this folder except this README is gitignored. It holds the owner's
source material:

- the treasury and budget workbooks the app was built to replace,
- their audit notes and control totals (`WORKBOOK_REFERENCE.md`, `current_snapshot.json`, import and test reports),
- `seed-aliases.json`: workbook-specific account aliases merged into imports at build time (never in the demo),
- `privacy-terms.txt`: terms that must never appear in committed files, used by `npm run privacy:check`.

The matching tests live in `tests/local/`, which is also gitignored. On a fresh clone
both folders are absent and the public test suite runs on synthetic workbooks and the
fictional sample household instead.
