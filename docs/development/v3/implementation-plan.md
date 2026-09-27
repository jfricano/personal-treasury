# Personal Treasury v3: implementation plan and builder handoff

Prepared 2026-09-26 from the v2.2 source on `main`, the v3 notes Codex left in [v3 ideas](../v3-ideas.md), the Windows installer candidate on `codex/v3-windows-build`, and the owner's v3 direction. This is a **build plan**. Nothing in it is implemented yet.

Read first: [Product specification](product-spec.md), [Spending review rules](spending-review-rules.md), [Security design](security.md), [Institution data](aggregation.md), [Acceptance tests](acceptance-tests.md).

## 1. Starting point

| Item | State on 2026-09-26 | V3 treatment |
| --- | --- | --- |
| `main` (v0.2.2) | Treasury, budget, tax, private web build, encrypted snapshot sync on Railway. | Baseline. Every existing test must keep passing. |
| `codex/v3-implementation` | One commit beyond an older `main`: a multi-user sync plan in `v3-ideas.md`. No code. | **Superseded** by this plan. Keep until v3 merges, then delete with the owner's approval. |
| `codex/v3-admin-auth-ideas` | Merged into `main` (PR 4). | Its multi-user section is marked abandoned in `v3-ideas.md`. |
| `codex/v3-windows-build` (worktree) | Uncommitted Windows NSIS installer candidate: workflow, platform config, doc. | **Separate track** (§4, T-WIN). Not required for v3.0. Not touched by v3 branches. |
| v2.2 sync (`src/sync/`, `sync-server/`) | Bearer token + passphrase; PBKDF2; append-only versions; no rate limiting; token and passphrase in `sessionStorage`. | Replaced by the design in [Security](security.md). The conflict model (If-Match revisions, stop on divergence) stays. |

## 2. Branches, authorship and releases

```text
main ─────────────●────────────────────────────────────────────●── v0.3.0 tag
                  │ (spec merged)                              ▲
                  └─► release/v3 ──●──────●──────●──────●──────┘  release PR
                                   ▲      ▲      ▲      ▲
                          v3/<slice> PRs, one per slice, reviewed and green
```

- **`main`** is production. Railway's production service deploys only from `main`, by manual deploy after checks pass.
- **`v3/spec`** (this branch) holds the v3 documents only. It merges into `main` by PR so the plan is visible, without code changes.
- **`release/v3`** is cut from `main` after the spec merges. It is the v3 integration branch. Nothing merges into `main` from v3 until the release gate (§8) passes.
- **Slice branches `v3/<slice>`** are cut from `release/v3` and return by pull request. One slice per branch, small enough to review in one sitting. Rebase on `release/v3` before review.
- **Fixes to v0.2.2** go on `fix/<topic>` from `main`, merge into `main`, then `main` merges into `release/v3`.
- **Railway staging:** a second Railway environment tracks `release/v3` with its own volume, its own secrets and the provider's sandbox keys. It holds fictional data only, never a copy of the owner's volume.
- **Authorship:** every commit is authored by the owner with the repository's configured noreply address. No `Co-Authored-By` trailers and no tool attribution in commits, pull requests, code comments or documents.
- **Privacy:** `npm run privacy:check` before every push. Owner-specific institution names, account masks and coverage notes live only in gitignored `reference/`, and the privacy terms list covers them.
- **Parallel work** uses one git worktree per slice (`git worktree add ../pt-<slice> v3/<slice>`), so concurrent sessions never share a working tree. Gitignored personal files are not copied into worktrees; slices that need them (the private reference tests) run in the main checkout.

## 3. Slices

Each slice lists its requirements, what it must deliver, and what may run beside it. "Gate" is the evidence its pull request must include.

### S0 — Interim hardening of the running v2.2 service (`fix/v2.2-security-headers`, from `main`)

- The security review found that the live private site sends no security headers and can be framed ([Security §2](security.md#2-what-v22-gets-right-and-what-v3-must-fix), M2). Before v3 is ready, add the header set from [Security §5.5](security.md#55-attack-resistance) to `sync-server/server.mjs` (with `trusted-types` in report-only mode until the app is verified under it), explicit Node request timeouts, and quarantine of a corrupt version file instead of refusing to start.
- Gate: server tests for the headers on every response type; the private E2E suite passing under the new policy; deployed to Railway after a JSON backup.
- A hotfix on `main`, merged forward into `release/v3`. It does not change the sign-in model.

### S1 — List of Accounts (`v3/list-of-accounts`)

- FR-UI-1. Rename the navigation label, the page's table accessible name, the user guide, the demo tour text, and the Playwright selectors that find them.
- Gate: `npm run check`, `npm run test:e2e:demo`, private E2E selectors updated.
- Runs first; no dependencies.

### S2 — Sign-in and encryption foundation (`v3/sign-in`)

The largest and highest-risk slice. Split into three pull requests on the same branch line:

1. **S2a Service authentication** (`sync-server/`): setup and migration modes; prelogin with fake salts; login with the peppered Argon2id verifier (`node:crypto`); the wrapped data key encrypted at rest; passkeys (one pinned WebAuthn library), authenticator codes, recovery codes, desktop device keys and break-glass; sessions (cookie on the web, bearer on the desktop) with server-enforced timeouts and the unlock share; step-up; CSRF checks; rate limits and partitioned lockout; sign-out variants; the security log; snapshot envelope v2 support, retention and pinning; the credential-vault endpoint; quotas; container and supply-chain hardening ([Security §5.10](security.md#510-supply-chain-and-hosting)). Retire `PT_SYNC_TOKEN` after migration.
2. **S2b Client key hierarchy** (`src/sync/` → `src/security/`): Argon2id in a Worker (pinned WebAssembly) with the parameter floor; HKDF split; data-key wrap and unwrap; snapshot envelope v2 with rollback checks; encrypted local copies (IndexedDB and the desktop profile file) with the session-bound escrow for reloads; sign-in, passkey, lock and idle UI; password change; Settings → Security with sessions and **Security activity**; the encrypted `.ptbackup` export and restore; text sanitizing and Trusted Types readiness.
3. **S2c Setup and v2.2 migration** (desktop app): enrollment, then the resumable per-version re-encryption and upload, verification by read-back, commit, and deletion of legacy files only after the owner confirms.

- FR-AUTH-1 through FR-AUTH-7; SEC requirements in [Security §7](security.md#7-security-requirements).
- Gate: a test for every SEC-AUTH, SEC-SESS, SEC-CSRF, SEC-RL, SEC-MFA, SEC-SYNC, SEC-MIG, SEC-HDR, SEC-XSS, SEC-LOG, SEC-SUP, SEC-CONT and SEC-BAK requirement; key-hierarchy tests against published vectors; a private-build E2E (virtual passkey authenticator) covering sign-in, wrong-password backoff, reload, lock, unlock, sign-out and password change; a native desktop pass for setup and migration from a fictional v2.2 history; an independent security review of each PR (§5); staging passing the header and TLS checks in [Security §8](security.md#8-verification).
- Runs beside S3, S4 and S5.

### S3 — Spending review domain (`v3/review-domain`)

- Pure functions in `src/domain/spending/`: month membership, canonical signs, identity and merge, coverage, dispositions and splits, pairing, rule normalization and matching, the clear conditions and identity check, the report builder, year-to-date, funding groups, balance classification and month-end estimates, treasury hints.
- No I/O, no React, no database. Uses `money.ts` and `computeBudget`.
- Gate: the domain acceptance tests in [Acceptance tests §2–§8](acceptance-tests.md) pass, with 100% branch coverage of the clear conditions and the identity check.
- Runs beside S2. Defines the types S4–S9 use, so merge it early.

### S4 — Schema, repositories and services (`v3/review-schema`)

- Migrations after version 3 per [Spending review rules §13](spending-review-rules.md#13-schema), including the `line_key` backfill and **Duplicate** carrying keys.
- Repositories and `SpendingService` (reached as `treasury.spending`) for connections, institution accounts, rules, line roles, the review index, and reports, all through `Treasury.mutate` for transactions, audit and undo.
- JSON backup and restore of every new table; `npm run db:check` extended to the new tables.
- Gate: migration tests from a v0.2.2 database; backup round trip; assertions that treasury and budget tables are unchanged by every spending service method.
- After S3.

### S5 — File sources (`v3/file-sources`)

- `src/import/statements/`: OFX 1.x (SGML) and 2.x (XML), QFX, and CSV with a column-mapping step (posted date, amount or debit/credit, description, optional balance) and an explicit outflow-sign choice with a sample-row preview. Zod validation, source locations on every warning, file hash, duplicate-file warning.
- Synthetic fixtures for the Harper household: checking, savings and a credit card, including edge cases (identical same-day rows, a truncated file, SGML without closing tags, a CSV with separate debit and credit columns).
- Gate: parser tests, sign tests per account kind, coverage tests from file periods.
- After S3; beside S2 and S4.

### S6 — Temporary review store (`v3/review-store`)

- Client module `src/review-store/` with encryption under the data key, debounced autosave, a local store (IndexedDB on the web; an app-data file on the desktop, never inside the profile SQLite file), and the service copy.
- Service endpoints for temporary reviews (`/api/review/:ref`): read, conditional write, delete, refusal of deleted references, 8 MiB limit, at most three open, expiry sweep; latest version only, with no history ([Security §5.7](security.md#57-temporary-review-storage)).
- Gate: SEC-REV-1 to SEC-REV-4; crash and reload tests (kill the tab mid-edit and resume); cross-device resume in the private E2E; expiry with a fixed clock; tombstones; and the canary scan from [Spending review rules §14](spending-review-rules.md#14-invariants-and-where-they-are-enforced).
- After S2a and S2b.

### S7 — Budget vs actual interface (`v3/review-ui`)

- Pages and components in `src/features/spending/` and `src/features/connections/`: Connections (file connections first), Budget vs actual with its Coverage, Transactions, Summary, Assets and liabilities, and Reports views, keyboard entry, drill-downs, the Dashboard panel, and the `.xlsx` export in `src/export/spendingReport.ts`.
- Demo: fictional statement files and a guided exercise that runs a complete review (FR-DEMO-1, FR-DEMO-2).
- Gate: E2E for a complete file-based review in the demo and private builds at 390, 768, 1280 and 1440 px; keyboard-only review; screenshot review of every new view; export opened and checked.
- After S4, S5 and S6. **At this point v3 works end to end with files and no provider.** Consider releasing it as v0.3.0-beta to staging for the owner's first real month, using downloaded files.

### S8 — Provider connections on the desktop (`v3/provider`)

- For the provider the owner confirms in [ADR 0009](../decisions/0009-institution-data-provider.md) (recommended: Plaid Trial): a Rust gather command in `src-tauri/` with the host allowlist, no redirects, timeouts, size cap and rate limits; the credential vault client (step-up to read or change); connection add, reconnect and remove in the desktop app; error states in plain words; the source adapter in `src/sources/<provider>/` with lossless parsing and canonical signs. **No service route contacts a provider.**
- For Plaid: key entry, Hosted Link in the system browser with polling, token exchange, the Trial Item guard (remaining count, duplicate block, `TRIAL_CONNECTION_LIMIT`), update-mode reconnect, the consent-expiry notice, and liabilities. All development and automated tests use Sandbox; no Production Item is created until the owner links an institution from the private plan.
- Gate: SEC-VAULT-1 to SEC-VAULT-6; V3-AT15; adapter fixtures for every account kind, sign, pending and removed item and error code; Sandbox integration tests (run locally with Sandbox keys, never in public CI logs); a native desktop pass; Q2 confirmed.
- After S2 and S6; beside S7.
- **S8b (v3.x, optional): the other adapter.** If v3.0 ships Plaid, the SimpleFIN adapter becomes the fallback for a Trial change or a binding cap; if v3.0 ships SimpleFIN, a Plaid adapter can be added for the logins only it reaches. Either way, it plugs into the same contract.

### S9 — Balance snapshot (`v3/balances`)

- Balances from providers and files, the month-end estimate, liability details, net worth and change, the Dashboard net-worth figure, and the Assets and liabilities sheet in the export.
- Gate: domain and E2E tests from [Acceptance tests §9](acceptance-tests.md).
- After S4 and S5; provider balances after S8.

### S10 — Documentation and screenshots (`v3/docs`)

Documentation is part of the release, not a follow-up. This slice runs after S7–S9 are feature-complete, so the text and images describe the shipped interface. Each item below is a checkbox in the PR description.

**Release-specific documents (new):**

- `docs/release-notes-v0.3.0.md`: what v3 adds and removes (User ID and password replace the token and passphrase; Budget vs actual; Connections; Assets and liabilities; List of Accounts), the one-time migration from v2.2, limits, and backup guidance. Same voice and length as the v0.2.2 notes.
- `docs/development/v3-release-report.md`: scope implemented, test commands with counts, security verification evidence, native macOS results, deployment status, and remaining limitations, in the style of the [v2.2 report](../v2.2-release-report.md). Private figures stay out.

**Standing documents (update in place, so a reader of `main` never needs the v3 folder to understand the current app):**

| Document | Change |
| --- | --- |
| `README.md` | Replace "New in v2.2" with "New in v0.3.0"; update **What it does**, **Privacy** (sign-in, encryption, provider access, temporary transactions), **Screenshots**, **Documentation** and **Stack**. |
| `docs/README.md` | Index every new and renamed document; move the v3 planning documents under a "History and plans" heading. |
| `docs/guide/getting-started.md` | Setup of the service account, first sign-in, desktop sign-in, and the local-only desktop option. |
| `docs/guide/user-guide.md` | New sections: Signing in and locking, Connections, Budget vs actual (the monthly review, rules, waivers, clearing, reports, export), Assets and liabilities. Rename **Accounts** to **List of Accounts** throughout. |
| `docs/guide/demo-walkthrough.md` | Add the sample spending-review exercise. |
| `docs/guide/cloud-sync.md` | Rewrite for v3 as the private service guide: sign-in, sessions, lock, sync and conflicts, temporary review storage, retention, what the server can and cannot see, and the no-recovery rule. Keep the file name or leave a pointer from it. |
| `docs/guide/railway-sync.md` | New variables (setup secret, provider keys), custom domain and provider redirect registration, staging environment, backup guidance. |
| `sync-server/README.md` | The v3 API: setup and migration, authentication, second factors, sessions, temporary review storage, the credential vault, retention, headers and variables. |
| `docs/development/architecture.md` | New modules and layers, schema tables and migrations, service endpoints, key hierarchy summary, demo additions, updated known limitations. |
| `docs/development/data-and-rules.md` | Link to the spending review rules as the contract for Budget vs actual. |
| `docs/development/spending-review-rules.md` | Promote `v3/spending-review-rules.md` to a standing document once implemented, and leave the v3 copy as a pointer. Do the same for `security.md` as `docs/development/security.md`. |
| `docs/development/acceptance-tests.md` | Fold in the v3 acceptance tests, so the release gate lists one set. |
| `docs/development/development.md`, `testing.md` | New commands, suites, environment variables, worktree practice, and the screenshot script. |
| `docs/development/workbook-import.md` | Point to statement-file import (OFX, QFX, CSV) and its rules. |
| `docs/development/decisions/` | ADRs 0008–0010 marked accepted with their final details; ADR 0007 marked superseded in part by 0008 and 0010. |
| `docs/development/v3-ideas.md` | Mark what shipped; keep the remaining ideas. |
| `docs/distribution-plan.md`, `docs/launch-post.md` | Update for v0.3.0 if a public release announcement is planned. |

**Screenshots:**

- The images in `docs/images/` date from the first public release and predate the budget, tax and sync features. Replace all of them, and add images for the new features.
- Add `npm run docs:screenshots`, a Playwright script against the **demo build only** (the fictional Harper household), with a fixed clock, fixed viewport sizes, reduced motion and the tour dismissed except for its own image, so images are reproducible and contain no personal data. Sign-in images come from a local private build with a fictional account on a local service.
- Required set, at 1440 px unless noted: Dashboard; Monthly reconciliation; Budget and tax; Budget vs actual (Summary); Budget vs actual (Transactions with suggestions and a split); Assets and liabilities; Connections (demo notice with sample files); List of Accounts; Interaccount debts with a reversed loan; Sign-in; the guided tour; and Budget vs actual on a phone at 390 px.
- Update every document that embeds or links an image (at least `README.md`, `docs/guide/user-guide.md`, `docs/guide/demo-walkthrough.md`), and give each image descriptive alt text.
- A person reviews every new image before merge: correct version, no clipped panels, no browser chrome, no personal data.

**Gate:** every link in `docs/` resolves (add a link check to `npm run check`); every screenshot is regenerated by the script and reviewed; `npm run privacy:check` passes; the in-app guided tour covers the new pages.

### S11 — Release (`v3/release`)

- The full verification in §8, then the release PR from `release/v3` to `main`, the `v0.3.0` tag, the production deployment, and the owner rollout in §7.

## 4. Other tracks

| Track | Plan |
| --- | --- |
| T-WIN Windows installer | Continue on `codex/v3-windows-build`. When its clean-install acceptance run passes, rebase it onto `release/v3` (or `main` after v0.3.0) and merge by PR. A signed installer is required before any public Windows download. It does not block v3.0. |
| Deferred ideas | Budget-version comparison, year overview, backup confidence, and collapsible dashboard panels stay in [v3 ideas](../v3-ideas.md) for a later release. The year-to-date figures in v3 are a first step toward a year overview. |
| Abandoned | Multi-user access, administration, activation tokens, account recovery. |

## 5. Working with several agents

Multiple builder sessions can shorten the schedule if they never share a working tree or a branch.

| Phase | Parallel sessions | Why it is safe |
| --- | --- | --- |
| After S1 | S2 (sign-in) · S3 (domain) | Disjoint folders: `sync-server/` and `src/security/` vs `src/domain/spending/`. |
| After S3 merges | S2 continues · S4 (schema) · S5 (file sources) | S4 and S5 touch `db/`, `api/` and `import/statements/` respectively and share only S3's types. |
| After S2 merges | S6 (review store) · S8 (provider, desktop) | S6 touches `sync-server/` and `src/review-store/`; S8 touches `src-tauri/` and `src/sources/`. |
| After S4–S6 merge | S7 (UI) · S9 (balances) · S8 finishing | S8 and S9 add views inside S7's page; agree the component boundaries in S7's first PR. |

- **Reviewer agents:** every PR in S2, S6 and S8 gets an independent security review of its diff against [Security §7](security.md#7-security-requirements) before merge, and every PR gets a correctness review against the relevant rules document. Findings are fixed or answered on the PR.
- **Research agents:** before S8, confirm the provider's current terms, pricing and coverage for the owner's institutions (recorded privately in `reference/`).
- Each session starts by reading this plan, the rules document for its slice, and the owner's local project instructions. Each ends with a PR that names the requirements it satisfies and the evidence.

## 6. Test strategy

| Layer | Tool | Scope |
| --- | --- | --- |
| Domain | Vitest | Every rule in [Spending review rules](spending-review-rules.md); property tests for splits, the identity check and pairing; decimal edge cases. |
| Services and database | Vitest + sql.js | Migrations from v0.2.2, repositories, service lifecycle, audit, undo, backup round trip, isolation of treasury and budget tables. |
| Parsers | Vitest | OFX, QFX and CSV fixtures, signs per account kind, malformed files, and exact amounts. |
| Crypto | Vitest | KDF and HKDF test vectors, envelope v2 round trip, wrong-password and tamper failures, re-wrap on password change, v2.2 migration. |
| Service | `node --test` | Every endpoint's authentication, authorization, rate limits, CSRF, headers, size limits, If-Match behavior, retention, expiry, tombstones, and absence of secrets and bodies in logs. |
| End to end | Playwright (Chrome and WebKit) | Demo: complete file-based review, export, List of Accounts. Private: setup, migration, sign-in, lock, cross-device review resume, conflict handling, provider sandbox flows. |
| Native | Manual, recorded | Packaged macOS app: sign-in, lock on sleep, encrypted profile on disk, file dialogs for statement import and report export. |
| External | Scanners and manual checks | [Security §8](security.md#8-verification). |

Public tests use only synthetic data and the Harper household. The owner's real-institution checks are manual and recorded privately.

## 7. Owner rollout (after S7, and after S8 for providers)

1. Take a complete JSON backup and store it encrypted outside Railway. Record where it is.
2. Complete the "before v3 goes live" list in [Security §9](security.md#9-owner-operations): custom domain, account protection, sealed secrets with copies in the password manager.
3. Deploy v3 to staging and rehearse setup, migration and a file-based review with fictional data.
4. Deploy to production. From the desktop app, run setup, migrate the v2.2 history, and confirm the treasury matches the backup (counts and control totals). On the website, register two passkeys. Export an encrypted backup.
5. Create the provider account, protect it with an authenticator, and connect institutions one at a time following the private coverage notes in `reference/`. Use file connections where the provider cannot reach an institution.
6. Run the first real month. Record timing, blockers and rule counts in the private notes to tune defaults (settle delay, pairing window, expiry).

## 8. Release gate

V3 releases only with a report that shows:

- `npm run check`, `npm run db:check`, server tests, and every Playwright suite passing, with counts.
- Every acceptance test in [Acceptance tests](acceptance-tests.md) mapped to a passing test or a recorded manual result.
- The security verification in [Security §8](security.md#8-verification): header scan, TLS scan, rate-limit and lockout evidence, dependency audit with no unresolved high or critical findings, an independent review of S2, S6 and S8, and the "no raw transactions after clearing" scan.
- The packaged macOS pass.
- The owner's first cleared month, recorded privately, with no private values in the public report.
- The S10 documentation checklist complete: release notes and release report written, every standing document updated, links checked, and every screenshot regenerated from the demo and reviewed.
- `npm run privacy:check` passing, and no personal names, institutions or figures in any public file.
- Every remaining limitation listed.

## 9. Builder handoff prompt

> Implement Personal Treasury v3 from `docs/development/v3/`. It is a single-user app: do not build multi-user, administration or recovery features. Work on slice branches cut from `release/v3`, in the order and with the gates in `implementation-plan.md`, one git worktree per concurrent session. Author commits as the repository's configured owner with no co-author trailers or tool attribution. Start with S0 (security headers for the running v2.2 service, a hotfix on `main`) and S1 (List of Accounts), then S2 (sign-in and encryption) and S3 (spending review domain) in parallel. Provider credentials are used only by the desktop app; the service never contacts a provider. Treat `spending-review-rules.md` as the calculation contract and `security.md` as the security contract; add a test for every numbered rule and SEC requirement you implement. Keep raw transactions out of the synced database, snapshots, logs, backups and treasury exports, and prove it with the scan test. Keep every existing treasury, budget, import, export, undo and backup behavior and test unchanged. Use only synthetic data in committed tests; run `npm run privacy:check` before every push. Each PR names the requirements it satisfies and includes its evidence; S2, S6 and S8 also need an independent security review before merge. Finish with S10: release notes and a release report, every standing guide and development document updated to describe the shipped app, and all screenshots regenerated from the demo build with `npm run docs:screenshots`.
