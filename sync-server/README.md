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
| `PT_AUTH_PEPPER` | Active authentication pepper: 32 random bytes in base64; selects v3 mode. |
| `PT_AUTH_PEPPER_ID` | Optional active verifier-pepper ID, default `1`. Separate from client and at-rest key IDs. |
| `PT_AUTH_PEPPER_<id>` | Optional single retiring verifier pepper, for an account still using that ID. Do not configure an alias for the active ID. |
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

## Request ingestion

The [request-ingestion contract and T-01 verification](../docs/development/v3/request-ingestion.md) lists supported methods, authentication gates, wire-byte caps, bounded concurrency settings, retry behavior and deployment/rollback constraints. Local remediation does not establish deployed acceptance or resource fit.

## Authentication and storage

Web sessions use HTTP-only cookies and CSRF protection. Native sessions use bearer authorization and enrolled-device proof. Initial enrollment and migration are desktop operations; routine access uses User ID, password and MFA. Sensitive actions require fresh verification. [User setup and sync](../docs/guide/user-guide.md#use-private-access-and-sync) describe the visible workflows; [security design](../docs/development/v3/security.md) records the full target contract.

Snapshots use conditional revisions; stale writes return a conflict for explicit client resolution. Temporary reviews have their own revision/deletion history and expiry, separate from permanent SQLite snapshots. The provider vault is available to native sessions and contains client-encrypted credentials. Persistent history supports retention and pinning; backups are still needed outside the service volume. Static application assets and `/healthz` are public; treasury APIs require the appropriate authenticated session.

Migration freezes legacy writes, accepts re-encrypted history and verifies it before cutover. Old ciphertext is preserved after commit; deletion uses a separate explicit migration operation. Keep the original token and passphrase until migration succeeds. See [upgrade steps](../docs/guide/railway-sync.md#upgrade-an-existing-v2-service).

## Operational recovery and key rotation

For lost MFA, configure a fresh random `PT_AUTH_MFA_RESET` of at least 32 characters and restart. The reset is single-use and still requires the owner's encryption password and new authenticator enrollment. Confirmation revokes old factors/sessions. A reset cannot recover a forgotten encryption password; recovery uses an independently encrypted backup and its passphrase.

For server at-rest rotation, retain the old key as `PT_AT_REST_KEY_1`, add independent `PT_AT_REST_KEY_2`, and set `PT_AT_REST_KEY_ID=2`. Startup rewraps protected server secrets without changing client ciphertext. Verify restart/sign-in before removing the old runtime key, and retain historical keys with backups that need them. Arbitrary replacement of a key is not rotation.

### Authentication-pepper transition

Independently review, then deploy rotation-aware source before changing authentication peppers. Existing accounts without `verifierPepperId` use logical pepper `1`. A transition to `2` sets the active `PT_AUTH_PEPPER` to an independent new key, `PT_AUTH_PEPPER_ID=2`, and `PT_AUTH_PEPPER_1` to the required old key through the approved secret store. IDs are case-sensitive, 1–32 letters/digits/underscores/hyphens, excluding reserved `ID`. Missing required keys, conflicting aliases, identical active/retiring key bytes or explicit versioned configuration without an active key fail startup; they never silently select legacy mode.

A correct password alone does not migrate the account. After a successful full sign-in with its existing second factor, the server atomically replaces only the verifier and its pepper ID, preserves the client data key and factor bookkeeping, and invalidates other sessions/pending sign-ins. Unlock and step-up checks are read-only. New enrollment and the existing authenticated native password-change operation write the active ID. The client protocol, password, KDF parameters, encrypted history and MFA enrollment do not change merely to rotate a pepper.

Private `auth_pepper_loaded` records report IDs and migration-needed status from the application being constructed; pair them with actual deployment/listening evidence. `auth_pepper_migrated` is emitted only after the durable write. Neither record includes credentials or account identifiers. SSH execution-environment values and a health response alone do not establish application configuration adoption. A failed/uncertain verifier write blocks API access with `authentication_unavailable` until a controlled restart reconciles the durable record with its required keys; never reset the account or blindly restore an old verifier.

After the durable new ID and a full owner sign-in are verified, protect historical recovery keys outside the service and **stage removal of the old alias**. A controlled deployment/restart with only the new pepper, followed by another owner sign-in/sync/reopen check, verifies final retirement. An empty old alias is invalid; remove it through the provider's reviewed staged configuration procedure. Keep the new key with post-migration backups. Old inactive accounts/backups may still need the old pepper for an explicitly isolated recovery; the live migration does not rewrite them. Rollback must retain the key required by the current durable verifier. Do not automatically revert to pre-transition source/configuration or reattach the old data directory.

This requires the legitimate owner to complete authentication during a bounded transition; a forgotten password is not recovered by pepper rotation. Retiring a pepper does not undo historical exposure of an old verifier/pepper pair or revoke a client authentication key that was itself compromised. Those cases need a separate evidence-based response. Keep at-rest rotation, device-cookie rotation and the native offline-login repair separate. No new public configuration endpoint or automatic deployment is provided.

## Development and validation

`npm run preview:private:fixture` starts a disposable fictional v3 service and prints fixture credentials. It creates fresh secrets and temporary storage; do not use it as a live deployment configuration.

Run `npm run test:server`, `npm run test:e2e:v3-private` and the Docker smoke test `node scripts/smoke-private-container.mjs`. The [testing guide](../docs/development/testing.md) distinguishes automated coverage from pending native, provider and independent security checks.

Startup without `PT_AUTH_PEPPER` uses the [legacy v2 protocol](legacy-v2.md). It is retained for migration and regression testing, not the current private frontend.
