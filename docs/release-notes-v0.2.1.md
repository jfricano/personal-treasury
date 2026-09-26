# Personal Treasury v0.2.1 — release notes draft

Personal Treasury by Orca Solutions is a local-first Mac app for allocating a household paycheck across virtual account buckets, reconciling monthly transfers, and tracking debts between those buckets. It is free and MIT licensed.

**Try it first:** [one-minute browser demo](https://jfricano.github.io/personal-treasury/) · [guided walkthrough](guide/demo-walkthrough.md)

## In this release

- Budget versions connect take-home pay to account funding and lock after a month uses them.
- Monthly reconciliation names each failing check and traces final account transfers back to the budget and journal.
- Interaccount debts retain chronological events, recalculate balances, and show when an overpayment reverses who owes whom.
- Excel import previews control totals and source-cell warnings. Excel export and complete JSON backups let you take your data with you.
- V2.1 improves narrow-screen dialogs, review links, account naming, budget workbook round trips, date defaults, and amount-field editing.

## Privacy and compatibility

The desktop app stores data in a local SQLite file, works offline, and has no account, telemetry, or cloud sync. The browser demo uses fictional data and clears changes when its tab closes.

- Supported build: macOS 12 or later on Apple Silicon.
- This release does not connect to banks or file taxes. Tax figures are estimates based on editable rule tables.

## Release verification

Local preparation on 2026-09-25: `npm run check` passed (169 Vitest tests, production and demo builds), `npm run test:e2e:demo` passed (26 Chrome tests), and `npm run privacy:check` passed. The v0.2.1 Apple Silicon app bundle passed `codesign --verify --deep --strict`; the ad-hoc DMG passed `hdiutil verify`. This DMG is for local checks only.

Complete before publication:

- [ ] Re-run the release checks on the final tagged commit.
- [ ] Developer ID signature, Apple notarization, stapling, and Gatekeeper assessment pass for the final DMG.
- [ ] A clean Mac installation passes first launch, fictional workbook import, backup/restore, and quit/relaunch checks.
- [ ] Add the release commit SHA and DMG SHA-256 here and to the GitHub Release.

The detailed local test evidence is in the [V2 release report](development/v2-release-report.md). Download and installation instructions will be linked from the GitHub Release once the checks above pass.
