# V3 private treasury service

The Node.js service serves the private web app and stores client-encrypted treasury versions, temporary review objects and the encrypted provider vault. It cannot decrypt the treasury and never contacts financial institutions. Current public version: **0.3.0-preview.2**; see [release status](../docs/development/v3/preview-status.md) for outstanding acceptance checks.

The public Local Mac app and demo do not use this service. Connected apps are configured and retained privately, with no public installer download.

## Configuration and startup

Use Node.js 24 or newer and one process against a persistent data directory outside the checkout. Install frontend and service dependencies, build private assets, then start:

```sh
npm ci
npm --prefix sync-server ci
npm run build:private
node sync-server/server.mjs
```

Configure secrets through a secret manager or deployment environment before startup:

| Variable | Requirement |
| --- | --- |
| `PT_PUBLIC_ORIGIN` | Exact public HTTPS origin; localhost HTTP is permitted only for fixtures/development. |
| `PT_AUTH_PEPPER` | 32 random bytes in base64; selects v3 mode. |
| `PT_AT_REST_KEY` | Separate 32-byte base64 key for protected account secrets. |
| `PT_DEVICE_COOKIE_KEY` | Separate 32-byte base64 secret. |
| `PT_LOG_KEY` | Separate 32-byte base64 log key. |
| `PT_SETUP_SECRET` | Random initial-enrollment secret; use a separate `openssl rand -base64 32` value. |
| `PT_SYNC_DATA_DIR` | Persistent writable directory, outside the static-assets directory. |
| `PT_STATIC_DIR` | Optional private frontend directory, normally `dist-private`. |
| `PT_SYNC_HOST` / `PT_SYNC_PORT` | Defaults `127.0.0.1` / `8787`; `PORT` overrides the port. Use `0.0.0.0` behind a container/hosting edge. |
| `PT_SYNC_TOKEN` | Preserve the existing v2 token only for unfinished legacy migration. |
| `PT_TRUST_PROXY` | `1` only if the trusted edge overwrites `X-Real-IP`; otherwise unset. |

Generate the four server secrets independently with `openssl rand -base64 32`. Save keys with your volume-backup recovery plan. `PT_ALLOWED_ORIGINS` applies only to legacy mode; v3 allowlists `PT_PUBLIC_ORIGIN` plus built-in native origins. A remotely accessed service requires HTTPS at the proxy/hosting edge.

For Railway, use the [v3 hosting guide](../docs/guide/railway-sync.md). The Docker image has private production assets and isolated service dependencies, runs as UID 1000 with Node filesystem permissions, and needs a mounted volume writable by that user. It contains no npm/npx runtime and does not chown the mount.

## Authentication and storage

Web sessions use HTTP-only cookies and CSRF protection. Native sessions use bearer authorization and enrolled-device proof. Initial enrollment and migration are desktop operations; routine access uses User ID, password and MFA. Sensitive actions require fresh verification. [User setup and sync](../docs/guide/user-guide.md#use-private-access-and-sync) describe the visible workflows; [security design](../docs/development/v3/security.md) records the full target contract.

Snapshots use conditional revisions; stale writes return a conflict for explicit client resolution. Temporary reviews have their own revision/deletion history and expiry, separate from permanent SQLite snapshots. The provider vault is available to native sessions and contains client-encrypted credentials. Persistent history supports retention and pinning; backups are still needed outside the service volume. Static application assets and `/healthz` are public; treasury APIs require the appropriate authenticated session.

Migration freezes legacy writes, accepts re-encrypted history and verifies it before cutover. Old ciphertext is preserved after commit; deletion uses a separate explicit migration operation. Keep the original token and passphrase until migration succeeds. See [upgrade steps](../docs/guide/railway-sync.md#upgrade-an-existing-v2-service).

## Operational recovery and key rotation

For lost MFA, configure a fresh random `PT_AUTH_MFA_RESET` of at least 32 characters and restart. The reset is single-use and still requires the owner's encryption password and new authenticator enrollment. Confirmation revokes old factors/sessions. A reset cannot recover a forgotten encryption password; recovery uses an independently encrypted backup and its passphrase.

For server at-rest rotation, retain the old key as `PT_AT_REST_KEY_1`, add independent `PT_AT_REST_KEY_2`, and set `PT_AT_REST_KEY_ID=2`. Startup rewraps protected server secrets without changing client ciphertext. Verify restart/sign-in before removing the old runtime key, and retain historical keys with backups that need them. Arbitrary replacement of a key is not rotation.

## Development and validation

`npm run preview:private:fixture` starts a disposable fictional v3 service and prints fixture credentials. It creates fresh secrets and temporary storage; do not use it as a live deployment configuration.

Run `npm run test:server`, `npm run test:e2e:v3-private` and the Docker smoke test `node scripts/smoke-private-container.mjs`. The [testing guide](../docs/development/testing.md) distinguishes automated coverage from pending native, provider and independent security checks.

Startup without `PT_AUTH_PEPPER` uses the [legacy v2 protocol](legacy-v2.md). It is retained for migration and regression testing, not the current private frontend.
