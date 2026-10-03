# Host the v3 private service on Railway

This guide applies to **v3 / 0.3.0-preview.2**. Railway hosts the private app and encrypted data; GitHub hosts the public Local installers. There is no public Connected installer. Service owners configure their private desktop from source.

Run one service process and one replica against a persistent volume. Keep a backup of the existing data and server secrets before upgrading. The [release status](../development/v3/preview-status.md#remaining-release-work) lists outstanding acceptance/security checks; a successful deployment alone does not complete them. Review [Railway pricing](https://docs.railway.com/pricing) for your project.

## Configure the service

1. Connect this repository's `main` branch as one Railway service. Set `RAILWAY_DOCKERFILE_PATH=sync-server/Dockerfile` and use the repository root as build context. Keep automatic deployment disabled until configuration is complete. If enabled later, use [Wait for CI](https://docs.railway.com/deployments/github-autodeploys#wait-for-ci).
2. Preserve or create a [persistent volume](https://docs.railway.com/volumes) at `/data`. The image runs as the non-root `node` user (UID 1000) and does not change mounted-volume ownership. Verify UID 1000 can create and rename files there before deploying; an existing root-owned volume may need an ownership correction during maintenance. Keep the service at one replica.
3. Choose the final HTTPS origin, preferably the custom domain you intend to keep before registering passkeys. Set the variables below in Railway's secret/configuration store. The image supplies the `/data` and static paths; Railway supplies `PORT`.

| Variable | Value or purpose |
| --- | --- |
| `PT_PUBLIC_ORIGIN` | Exact HTTPS origin, such as `https://treasury.example.com`, without a trailing slash or path. |
| `PT_AUTH_PEPPER` | Independent random 32-byte base64 authentication secret; selects v3 mode. |
| `PT_AT_REST_KEY` | Independent random 32-byte base64 key for protected server account secrets. |
| `PT_DEVICE_COOKIE_KEY` | Independent random 32-byte base64 cookie/device secret. |
| `PT_LOG_KEY` | Independent random 32-byte base64 security-log key. |
| `PT_SETUP_SECRET` | Separate random enrollment secret, used once from the configured desktop. |
| `PT_SYNC_TOKEN` | Existing v2 token only while migrating legacy history; preserve its exact value. |
| `PT_TRUST_PROXY` | Leave unset unless the trusted edge overwrites `X-Real-IP`; set `1` only after verifying that behavior. |

Generate each new secret separately with `openssl rand -base64 32` and save it directly in your secret manager. Keep the existing token and secrets when upgrading; replacing encryption keys arbitrarily can make retained history unreadable. `PT_ALLOWED_ORIGINS` is a legacy-v2 setting: v3 derives allowed browser/native origins from `PT_PUBLIC_ORIGIN` and its built-in native origins. Do not put server secrets in frontend `VITE_` variables.

4. Configure [HTTPS public networking](https://docs.railway.com/networking/public-networking), with `/healthz` as the health-check path. The image defaults to port 8787, but Railway's `PORT` takes precedence: check the actual listening port in deployment logs and match the domain's target port. Review staged source, variables, volume and domain changes, then deploy together.
5. Confirm `https://your-origin/healthz` returns `{"status":"ok"}` and the private sign-in screen loads. Verify TLS and security headers at the actual edge. Check write permissions and persistence across restart with disposable staging data before enrolling or migrating live history.

## Enroll the owner and use devices

Build/run the private desktop with its HTTPS origin:

```sh
PT_SERVICE_ORIGIN=https://treasury.example.com npm run tauri:dev
```

This is a **Connected Dev** build with separate development storage. For an owner-retained packaged build, use `npm run desktop:build` with the same environment value. Keep configured app/installer artifacts private; publish only Local assets. The Local GitHub download cannot connect to this service.

On the configured desktop, choose **Set up a new private service**. This enrolls the sole owner on the existing server; it does not provision another host. Use `PT_SETUP_SECRET`, choose your User ID/password, add the long uppercase authenticator secret to your password manager and enter its generated **six-digit code**. Save the recovery codes. See [private sign-in](user-guide.md#create-your-private-sign-in).

After setup and any migration, sign in at the private HTTPS website with the same User ID/password and second factor. Check treasury **Encrypted cloud sync** and temporary **Review sync** before switching devices. Preserve an off-service encrypted backup and test restore.

## Upgrade an existing v2 service

1. Back up the treasury and entire server data directory, and preserve its old token, sync passphrase and server configuration separately. Keep the existing `/data` volume attached.
2. Configure v3 variables above, retaining `PT_SYNC_TOKEN` for the existing legacy history. Deploy the reviewed source and build the privately configured desktop against that same origin.
3. Enroll the owner once, then follow the desktop's legacy migration. Enter the old token and passphrase only here. The client decrypts each old version, re-encrypts it with the v3 data key, uploads and reads it back for verification before cutover.
4. Check balances/history against the backup, sign in on another device, test sync and restart, and test encrypted backup recovery. Legacy files are retained after cutover; their deletion is a separate explicit operation. After committed cutover, the old token no longer grants normal v3 access and can be removed from service configuration.

Do not initialize a new empty volume to replace the old one, or remove old credentials/history while migration is unfinished. New v3 treasuries do not require legacy credentials. Daily sign-in is User ID, password and MFA.

## Backups and operations

Use Railway [volume backups](https://docs.railway.com/volumes/backups) where available for your service, plus encrypted `.ptbackup` exports kept outside Railway and the Mac. Preserve the required server keys with volume backups; ciphertext alone is not sufficient for complete recovery. Cloud versions on one volume do not protect against losing that volume.

Key rotation, operational MFA recovery and trusted-proxy constraints are documented in the [v3 service README](../../sync-server/README.md). Provider credentials remain client-encrypted; the service does not contact Plaid. User financial data and secrets never belong in GitHub or build artifacts.
