# v3 implementation preview — 0.3.0-preview.1

This branch is a runnable implementation preview, **not a release candidate**. It incorporates the design from PR #6 and adds the spending workflow, schema 4, private authentication, encrypted storage and a native provider adapter. The existing public Pages deployment remains v2.2. Do not migrate the live private service onto this preview.

## Try it locally

```sh
npm ci
npm run dev:demo -- --host 127.0.0.1 --port 1430
```

Open <http://127.0.0.1:1430/#/analysis>, choose **Try a sample review**, pair the two card-payment rows, and classify the other five transactions. Try splitting Household and travel supplies between budget lines. Review Coverage, Summary, and Assets and liabilities. Clear the month to retain the aggregate report and delete its transaction details. Export the report to Excel; Undo removes the report without recovering deleted transaction details.

The sample uses the fictional Harper household. Its data stays in the browser tab. Reset sample data / Start blank also discard temporary reviews. Statement connections accept CSV and OFX/QFX/QBO files after a preview. CSV imports require explicit columns, sign convention, and statement period.

To experience private sign-in with disposable fictional data:

```sh
npm run preview:private:fixture
```

Open <http://localhost:8788>. The command prints a fictional user ID, password, and one-use recovery code. Choose Recovery code as the second factor. Reload to experience password unlock; Settings includes passkey enrollment, encrypted backups, history and locking. The fixture generates fresh secrets and a temporary data directory on each run; its access file is gitignored. This is a localhost test fixture, not a deployment configuration.

![Transaction review](../../screenshots/v3/transactions.png)
![Working summary](../../screenshots/v3/summary.png)

## Implemented paths

- Grouped responsive navigation, Budget Analysis and Connected Accounts.
- Exact decimal transaction normalization; explicit coverage and waivers; classifications, splits, rules, duplicates, reciprocal transfer pairs, and clear blockers.
- Separate ephemeral review storage with local undo, three-review limit, 14-day idle / 45-day maximum retention and deletion after confirmed report persistence.
- Schema-4 line keys, account metadata, rules and aggregate reports. Upgrades schema-3 backups before opening them. Review transactions are outside SQLite, audit snapshots and normal backups.
- Working and cleared summaries, planned-versus-actual spending, year-to-date totals, balance estimates and aggregate XLSX export.
- Private Argon2id/HKDF/AES-GCM client encryption, TOTP/recovery/passkey sign-in, cookie sessions, desktop device challenges, server idle/absolute expiry, CSRF controls and conditional snapshot writes.
- Encrypted local databases/safety copies, encrypted review objects, encrypted provider vault and separately encrypted backups. Account and review data use separate persistence paths.
- Desktop-first legacy history migration with write freeze, per-version decrypt/re-encrypt/readback and explicit cutover; legacy ciphertext remains preserved after commit.
- Native allowlisted Plaid HTTPS transport, lossless decimal response parsing, Hosted Link flow, account confirmation and transaction/balance gathering. **Live provider behavior is not validated.**
- macOS lock/sleep observers compile and emit the application lock event; manual packaged-app validation is outstanding.

## Validation recorded

- 129 unit/integration tests, including backup migration and aggregate-only persistence canaries.
- 13 Node service tests, including MFA, CAS writes, tombstones, migration cutover and device challenge replay rejection.
- 29 demo browser tests across existing features and the v3 sample review; responsive checks at 390, 768, 1280 and 1440 pixels.
- Private Chrome test: password plus recovery code, encrypted reload/unlock, virtual-passkey registration and lock.
- Native Rust provider allowlist test and macOS compilation.
- Private container image build and runtime smoke check: static UI loads; unauthenticated data requests are rejected.
- Two legacy private browser regressions: cross-device sync/conflict handling and inactivity logout.
- Format, lint, TypeScript, desktop web/demo/private builds; production dependency audit; owner-local privacy scan.

These are targeted checks, not a claim that every acceptance item in the v3 specification has passed. CI runs the repeatable web checks. See the test files for the exact assertions.

## Work still required before v3 release

1. **Private security completion:** desktop offline unlock; full recovery-code regeneration / authenticator-reset / passkey-revocation and password-change user flows; bounded breached-password blocklist; dedicated trusted-desktop lockout partition; session revocation tied to revoked device keys; server secret-key rotation and operational break-glass recovery.
2. **Review sync completion:** debounced writes, actionable cross-device review conflict choices and a full offline/reconnect/restart matrix. The current implementation fails closed on conflicting local review state; it does not yet expose both-copy resolution. Retest clear/delete races and expiry across offline devices.
3. **Security policy:** remove remaining inline styles and enforce strict style CSP / Trusted Types after browser validation. They are report-only in the preview; the current enforced CSP still permits inline styles. Independent security review and the complete SEC acceptance matrix remain gates.
4. **Plaid:** real Sandbox lifecycle tests; durable Trial Item accounting across exchange/write failures; verify selected institution identity rather than trusting the typed identifier; persistent rate/backoff state; provider removals/corrections and liability detail handling. No production credentials or financial institutions have been used for validation.
5. **Product completeness:** late-posting comparison to a prior cleared report, complete source-window/coverage reporting, working-review export UI, funding hints, and finer rule management still need specification-level acceptance work. The preview persists typed JSON report rows in separate normalized child tables; this is not the specification's complete column-level schema.
6. **Platform and release:** Safari/iOS and packaged Mac checks, sleep/lock key-lifetime review, desktop zoom shortcuts, full container deployment/restart rehearsal, owner verification of a real completed month, signed release artifacts and operational rollout/recovery rehearsal.

No deployment, release tag, real-account connection or live-data migration is part of this preview.

## Private service development configuration

The v3 service requires `PT_PUBLIC_ORIGIN` and four independent 32-byte base64 values: `PT_AUTH_PEPPER`, `PT_AT_REST_KEY`, `PT_DEVICE_COOKIE_KEY`, `PT_LOG_KEY`. Use `PT_SETUP_SECRET` for initial enrollment; an existing v2 service also requires its existing `PT_SYNC_TOKEN` for migration. Preserve and back up server secrets separately from ciphertext. The service never recovers a forgotten encryption password.

`PT_SYNC_DATA_DIR`, `PT_STATIC_DIR`, `PT_SYNC_HOST` and `PT_SYNC_PORT` select data, assets, interface and port. Startup without `PT_AUTH_PEPPER` retains the legacy service protocol for regression testing; the v3 private UI requires the v3 protocol. The separate `private-legacy` Vite mode exists only for the legacy browser regression suite.

For a development desktop against a disposable HTTPS service:

```sh
PT_SERVICE_ORIGIN=https://your-development-service.example npm run tauri:dev
```

The wrapper uses a separate development application identifier and narrows CSP to that service origin. `npm run desktop:build` uses the same origin configuration for a packaged build. The service URL is configuration, never a provider secret. Only the native adapter contacts Plaid.
