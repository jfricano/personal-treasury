# Security design

Status: approved for implementation; the second-factor requirement awaits owner confirmation (Product spec §10, Q1) · 2026-09-26

V3 puts one person's complete financial picture behind an internet-facing sign-in and adds read access to their institutions. This document is the security contract: the threat model, the design, and the testable requirements (SEC-…) that the [implementation plan](implementation-plan.md) turns into tests. It was prepared from a review of the v2.2 code and current guidance from OWASP, NIST SP 800-63B-4, RFC 9106 and the providers' documentation (§10), then checked by an independent review of the whole v3 document set.

## 1. Summary

- **Sign-in:** a User ID and a password of at least 15 characters. The password never leaves the device. The device derives two keys from it: one proves the password to the server, which stores only a keyed hash of it; the other unwraps the data key.
- **Encryption:** a random data key encrypts every snapshot, every local working copy, every temporary review and the provider credentials. Changing the password re-wraps the data key; nothing else is re-encrypted.
- **Second factor** (recommended, pending Q1): a passkey on the website, with an authenticator code as fallback; on the desktop, an authenticator code once per install, then a key bound to that install.
- **Sessions:** enforced by the server. After 15 minutes idle a session **locks**; after 12 hours it **expires**. Unlocking needs the password; an expired session needs a full sign-in. Nothing secret is kept in web storage.
- **Attack resistance:** rate limits and lockouts partitioned so a stranger cannot lock out the owner's known devices, identical responses for every credential failure, strict security headers and content policy, CSRF checks on cookie sessions, and logs that never contain secrets or financial data.
- **Institution access:** provider credentials are encrypted with the owner's key and used only by the desktop app. The service never contacts a provider.
- **Temporary transactions:** a separate encrypted store with its own index, expiry and deletion, never inside the database or its history.
- **Recovery:** none for the password, by the owner's choice. An encrypted backup with its own passphrase is the recovery path.

## 2. What v2.2 gets right, and what v3 must fix

V2.2 compares its token in constant time, authenticates before reading request bodies, caps body sizes, guards static paths against traversal, writes versions atomically with compare-and-swap, never logs bodies, and encrypts on the client with AES-256-GCM. V3 keeps all of that.

| ID | Severity | V2.2 behavior | V3 fix |
| --- | --- | --- | --- |
| H1 | High | The website keeps the access token and sync passphrase in `sessionStorage`, readable by any script in the origin. | No secret in web storage (§5.4). |
| H2 | High | The website's working copy and safety copies stay unencrypted in IndexedDB after logout and idle timeout. | Local copies encrypted; the key is gone once the page locks (§5.4). |
| H3 | High | One static token with no expiry or revocation; idle timeout enforced only by the page. | Server sessions with enforced lock, expiry and revocation (§5.4). |
| M1 | Medium | PBKDF2 at 310,000 iterations; a 12-character minimum checked only in the page; no way to change the passphrase or retire old versions. | Argon2id, a 15-character minimum with a blocklist, password change, retention (§5.2, §5.8). |
| M2 | Medium | No security headers; the content policy is a `<meta>` tag, which cannot prevent framing. | Full header set sent by the server (§5.5). |
| M3 | Medium | No rate limiting, resource limits or security logging. | §5.5. |
| M4 | Medium | A snapshot is not bound to its revision, so a compromised server can roll a device back. | Envelope v2 binds the revision (§5.8). |
| M5 | Medium | The same host serves the web code and stores the ciphertext, so a compromised host can capture the secret at the next sign-in. | Inherent to a website; sensitive work runs on the desktop (§6). |
| L1–L6 | Low | The desktop may connect to any HTTPS host; images and actions not pinned; plaintext backups; one corrupt version stops the service; password managers hindered; version labels stored in plaintext. | §5.5, §5.8, §5.9, §5.10. |

These issues exist in the running v2.2 service today. The implementation plan adds an interim fix (security headers) to v2.2 before v3 is ready.

## 3. Threat model

### Assets

| Asset | Where it lives in v3 |
| --- | --- |
| Treasury data (database, snapshot history, safety copies, backups) | Devices (encrypted local copies), service (ciphertext), the owner's backup media |
| Raw transactions for a month under review | The encrypted review store; device memory |
| Provider credentials | The encrypted credential vault; desktop memory during a gather |
| Password and derived keys | The owner's password manager; device memory while unlocked |
| Authenticators (sessions, passkeys, TOTP secret, device keys, recovery codes, verifier) | Service (hashed or encrypted), devices |
| Service secrets (pepper, at-rest key, device-cookie key, log key) | Railway sealed variables and the owner's password manager |
| Code integrity (web bundle, desktop app, service image) | GitHub, npm, CDN, base images, Railway builder |

### Adversaries

| Adversary | Can | Main defenses |
| --- | --- | --- |
| A stranger or scanner who finds the URL (certificate transparency logs publish new hostnames within minutes) | Unlimited requests, credential stuffing, enumeration | Second factor, rate limits, identical failures |
| A targeted attacker who knows the owner | Knows the User ID; tries leaked passwords; phishes | Unique long password, phishing-resistant passkey, lockout partitioned by device |
| A hostile script in the page (malicious dependency, extension, crafted transaction text) | Acts as the page while unlocked | Strict content policy, Trusted Types, text-only rendering, no secrets in web storage, short sessions |
| A compromised host (Railway account, container, leaked volume or backup) | Reads and writes the volume and environment; serves code | Client-side encryption, keyed verifier, key wrapped at rest, rollback detection, desktop-only provider access |
| A compromised supply chain | Injects code into a build | Lockfile integrity, release cooldown, pinned actions and images, a nearly dependency-free service |
| Someone with the phone, Mac or browser profile | Copies local storage | Encrypted local copies, keys held only in memory while unlocked, device lock |
| A breach at the provider | Holds its own copies | Read-only scope, fast revocation |
| A network attacker | Intercepts a first plain-HTTP visit | HSTS, HTTPS-only clients |

Out of scope: malware running on the owner's device with the owner's privileges.

### Trust boundaries and data flow

```text
 Private website (phone, Mac browser)            Desktop app (local code)
 Argon2id(password) → master key → auth key | wrap key   (same on both)
 data key in memory; IndexedDB holds only ciphertext     data key in memory; app data holds only ciphertext
        │ TLS, session cookie                         │ TLS, bearer session     │ TLS
        ▼                                             ▼                         ▼
 ════ Railway edge (TLS ends here) ═══════════════════════════════      Provider (read-only)
        ▼ plain HTTP inside Railway                                      linking and gathers run
 Node service, one replica, non-root                                     only from the desktop app
   /api/auth/*     verify keyed hash; sessions in memory
   /api/sync/*     snapshot ciphertext, append-only with retention
   /api/review/*   temporary review ciphertext and index, latest only, expiring
   /api/vault      provider-credential ciphertext, latest only (desktop sessions only)
   env:  pepper, at-rest key, device-cookie key, log key, setup secret
   /data: account record, snapshots, reviews, review tombstones, vault, lockout state, security log
```

Railway's edge sees the authentication key and session identifiers in transit, never treasury plaintext or provider credentials.

## 4. Key hierarchy

```text
password ──NFKC──► Argon2id(salt S, m = 64 MiB, t = 3, p = 1) ──► master key MK (32 bytes)
MK ──HKDF-SHA-256 "pt/v3/auth-key"──► AK  (sent to the service; stored only as HMAC-SHA-256(pepper, AK))
MK ──HKDF-SHA-256 "pt/v3/key-wrap"──► KEK (never leaves the device)
DEK = 32 random bytes, created once at setup
W   = AES-256-GCM(KEK, DEK, AAD = "pt/v3/dek|" + userId + "|" + kid)   stored by the service as AES-256-GCM(at-rest key, W)
DEK ──HKDF with a random per-object salt──► K_snapshot · K_review · K_vault · K_local
```

- **Why this design.** It uses standard primitives (WebCrypto HKDF, HMAC and AES-GCM, plus one WebAssembly Argon2id), behaves the same on the web and the desktop, and can be tested with known-answer vectors. OPAQUE (RFC 9807) would keep the authentication key off the wire, but the website's code comes from the same host, so a compromised host could capture the password either way. The account record carries an `authScheme` field so OPAQUE can be adopted later.
- **Why a keyed hash, not a second slow hash, on the server.** AK is a 256-bit output of Argon2id, so it cannot be guessed directly; every guess must repeat the client's Argon2id. Storing `HMAC(pepper, AK)` means a leaked volume without the pepper gives nothing to test guesses against. A second server-side Argon2id would add little and would need concurrency limits to stop it being used to exhaust the service.
- **Argon2id parameters** are chosen once at setup and are account-wide. The default is m = 64 MiB, t = 3, p = 1, targeting 0.5–1.5 seconds on the slowest device the owner uses; measure on the owner's oldest phone during setup. The client refuses any parameters below its hard floor of **m = 47,104 KiB (46 MiB), t = 1** (an OWASP-equivalent setting), so a compromised service cannot weaken them. Parameters change only through a password change.
- **The wrapped key is encrypted again at rest** with a key held only in Railway's environment, so a leaked volume or volume backup gives an attacker nothing to test password guesses against. A full host compromise (environment and volume) still allows offline guessing, bounded by Argon2id and the password's strength.

## 5. Design

### 5.1 Account setup

- The service starts in **setup mode** only when no account record exists and a one-time `PT_SETUP_SECRET` (32 random bytes) is set; for a v2.2 service, the existing `PT_SYNC_TOKEN` serves as the setup secret and also authorizes migration (§5.8). While in setup mode, the service still serves the v2.2 API unchanged, so v2.2 devices keep working until migration commits.
- Setup runs from the **desktop app**, whose code is local rather than served by the host. The owner enters the service URL, the setup secret, a User ID and a password, then (if Q1 confirms a second factor) enrolls an authenticator app and saves ten recovery codes.
- The **User ID** is 3–64 characters, normalized (NFKC, trimmed, lowercased). It is not a secret, and nothing depends on it staying hidden.
- The **password** is at least 15 characters (up to 256, any Unicode, NFKC-normalized), checked against a bundled list of common passwords and against the User ID, with no composition rules. The app recommends a password-manager-generated value or five or more random words, and says plainly that a forgotten password cannot be recovered.
- After setup, the setup path is disabled permanently and the owner deletes the setup variable.
- The owner then signs in on the website with the password and authenticator code and registers **two passkeys**: one in the platform keychain, one hardware key kept safe. A custom domain must be in place first, because passkeys are bound to the domain.

### 5.2 Sign-in

1. `POST /api/auth/prelogin {userId}` returns the scheme, the Argon2id parameters and the salt. For an unknown User ID it returns a deterministic fake salt (`HMAC(pepper, "fake-salt|" + id)`) with identical parameters.
2. The client derives MK, AK and KEK and sends `POST /api/auth/login {userId, authKey}`.
3. The service compares `HMAC(pepper, AK)` with the stored value in constant time, against a dummy value for unknown IDs. A wrong password and an unknown User ID produce byte-identical responses.
4. On success it issues a short-lived pending state and asks for the second factor (§5.3).
5. After the second factor, it issues the session and returns the wrapped data key `W`, only in that response. The client unwraps the DEK with KEK and imports it as non-extractable.

**Password change** happens in the desktop app (§6, residual risk 1) and requires step-up. The client derives new keys with a fresh salt, re-wraps the same DEK, and the service replaces the verifier, `W` and the parameters in one atomic write, then ends every other session. History is untouched. Other desktops replace their local copy of `W` at their next online sign-in; until then the old password still unlocks that desktop offline.

**Data-key rotation** (should; may follow v3.0), for a suspected key exposure, re-encrypts retained versions into a new store and switches over atomically. Every encrypted object carries a key ID (`kid`) from v3.0 so rotation can be added without a format change.

### 5.3 Second factor

Recommended default, pending the owner's decision (Product spec §10, Q1). If the owner declines, sign-in is User ID and password only, and every other control in this document still applies.

- **Website:** every new session needs a passkey assertion with user verification (a Face ID or Touch ID tap), or an authenticator code, or a recovery code. Passkeys use `userVerification: required`, `attestation: none`, and the private site's domain as the relying party. WebAuthn requires a user gesture, so the prompt appears behind a button.
- **Desktop app:** the first sign-in on an install needs an authenticator code. It then registers a **device key**, a non-extractable ECDSA P-256 key held by the app, whose public key the service records. Later desktop sign-ins are the password plus a signature over a single-use challenge. (Passkeys cannot work inside the desktop webview, whose origin cannot be a relying party.)
- **Authenticator codes** follow RFC 6238 (6 digits, 30 seconds, one step of drift) and reject a code whose time step was already used. The secret is stored encrypted with the at-rest key.
- **Recovery codes:** ten single-use 80-bit codes, stored hashed, shown once.
- **Break-glass:** if the owner loses every second factor, they set `PT_AUTH_MFA_RESET` to a random value in Railway. One password-only sign-in may then re-enroll the second factor; the value is consumed and the event is logged. Whoever controls Railway already controls the service, so this adds no new power.
- **Step-up** means a fresh proof within the last 5 minutes: on the website, a passkey assertion or authenticator code; on the desktop, re-entering the password plus a device-key signature. It is required to change the password or second factors, sign out everywhere, read or change the credential vault, prune snapshots or change retention, commit or delete migration data, and rotate the data key.
- **Cost to the owner:** on the website, a password (autofilled) and one biometric tap per sign-in; on the desktop, one code per install, then the password at launch. Setup takes about ten minutes.

### 5.4 Sessions, lock and sign-out

**Session states** (enforced by the service; the same for web and desktop):

| State | Entered when | What it allows |
| --- | --- | --- |
| **Active** | Sign-in completes, or a locked session is unlocked | Everything the session is authorized for |
| **Locked** | 15 minutes without activity | Only the unlock request; the client has dropped the data key |
| **Expired** | 12 hours after sign-in, sign-out, sign-out everywhere, or a password change | Nothing; a full sign-in is needed |

- **Unlocking** a locked session needs the password (the client re-derives KEK and unwraps `W`, which the service returns only to an unlock request that proves the password). No second factor is needed while the session has not expired.
- **Website:** session cookie `__Host-pt_session`: 256 random bits; `Secure; HttpOnly; SameSite=Strict; Path=/`; no `Domain`, no `Max-Age`. The service stores only its SHA-256 hash, in memory, so a redeploy expires every session. A reload keeps the session but, like a lock, needs the password to bring back the data key.
- **Optional: passkey unlock (should).** If implemented, the page keeps a copy of the data key in IndexedDB encrypted under both a non-extractable device key and a random **unlock share** that only the service holds. The copy is written from the raw key bytes during unwrap, before the non-extractable import, and those bytes are then discarded. The service releases the share only to an **active or locked** session and only after a fresh user-verified passkey assertion; it deletes the share when the session **expires**. A reload or idle unlock is then one passkey tap, and an expired session leaves the stored copy useless.
- Everything the page stores in IndexedDB (database, safety copies, reviews) is ciphertext under `K_local` or `K_review`. The page requests persistent storage so the browser does not evict it.
- `sessionStorage` and `localStorage` never hold the password, any key, an unlock share or a session identifier.
- **Desktop app:** a bearer session identifier held in memory; the same states and timeouts. The owner enters the password at launch and to unlock. The app keeps a copy of `W` and the parameters locally so it can unlock offline, and keeps its local profile and reviews encrypted. It also locks when the Mac sleeps or the screen locks; a small Rust listener for the macOS sleep and screen-lock notifications is part of slice S2.
- The macOS Keychain is not used while the app is ad-hoc signed: ad-hoc apps cannot use the data-protection keychain, and legacy keychain access is tied to a signature that changes with every build. With a Developer ID signature, a later release may offer **Unlock with Touch ID** by storing the data key (never the password) with biometric access control.

**Sign-out**

- **Sign out** expires the session (and any unlock share), expires the cookie with `Clear-Site-Data: "cache"`, and the client drops its keys and any stored unlock copy.
- **Sign out and remove this device's data** also clears cookies and storage.
- **Sign out everywhere** (step-up) expires every session and share; it can also revoke desktop device keys and trusted-device cookies. A password change does the same.

**Session fixation:** the service never accepts an identifier it did not issue, issues the session only after the second factor, and rotates it on step-up. The pre-second-factor state lives in a separate `__Host-pt_pending` cookie with a 5-minute life and at most 5 attempts.

### 5.5 Attack resistance

**Rate limits and lockout** (lockout counters persist across restarts):

- Client IP from `X-Real-IP`, set by Railway's edge; `X-Forwarded-For` is ignored. IPs are stored only as keyed hashes.
- Per IP, authentication endpoints allow a burst of 5 requests and 10 a minute, and failures add a delay of `min(2^(failures−1) s, 15 min)`, returned as HTTP 429 with `Retry-After`.
- **Lockout partitioned by device**, so a stranger cannot lock out the owner's known devices:
  - A trusted client (a browser holding a signed `__Host-pt_device` cookie, or a desktop with a registered device key) has its own counter: 10 failures lock it for 5 minutes, doubling to 60.
  - All other clients share one counter: 5 consecutive failures lock the pool for 1 minute, doubling to 60; 100 failures without a success close the pool until a trusted client signs in or the owner uses break-glass.
  - The device cookie only selects a counter. It never skips the second factor.
  - Trade-off: during a sustained attack, a **new** device cannot sign in until a trusted device signs in once. The owner always has at least the desktop app.
- A global breaker closes the untrusted pool for an hour after more than 1,000 failures in an hour.
- A pending sign-in allows at most 5 second-factor attempts.
- Snapshot uploads are **coalesced by the client**: at most one per minute while editing, plus one when the page is hidden or the owner signs out, with back-off on HTTP 429 using `Retry-After`. The service allows 90 snapshot writes an hour per session, and a write that would exceed the 2 GiB data quota receives HTTP 507.

**Enumeration and timing:** identical 401 bodies for every wrong User ID or password, fake salts for unknown IDs, a dummy verifier, and constant-time comparisons. A wrong second-factor code returns its own generic second-factor failure, which is reachable only after a correct password. Logs record whether the User ID matched, never the value tried.

**CSRF** applies to **cookie-authenticated** requests that change state: `Sec-Fetch-Site` must be `same-origin` when present, otherwise `Origin` must be allowlisted, and a request with neither is rejected; `Content-Type: application/json`; and a custom header `X-PT-Request: 1`. **Bearer-authenticated** requests (the desktop app) carry no ambient credential, so they are not subject to the Fetch Metadata check; they must still come from an allowlisted `Origin` (`tauri://localhost`, `http://tauri.localhost`) through CORS. No `GET` changes state.

**XSS and untrusted text:**

- Content policy with no inline script, no `unsafe-inline` styles, and Trusted Types, rolled out in report-only mode first.
- Lint rules forbid `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval` and `new Function`.
- **Transaction text is untrusted input**: anyone can send the owner a payment with a crafted memo. Descriptions, merchant names and account names are rendered only as text, with control and bidirectional-override characters removed and length capped at 512 characters.
- Spreadsheet exports write text as string cells, which Excel never evaluates; CSV exports prefix a text value beginning with `=`, `+`, `-`, `@`, tab or carriage return with an apostrophe.

**Headers on every private-site response**, sent by the service (the `<meta>` policy remains only as a fallback):

```text
Strict-Transport-Security: max-age=63072000; includeSubDomains
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:;
  font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; frame-ancestors 'none';
  form-action 'self'; base-uri 'none'; object-src 'none'; require-trusted-types-for 'script'; trusted-types pt-worker;
  report-to csp
Reporting-Endpoints: csp="/api/csp-report"
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(),
  clipboard-read=(), publickey-credentials-get=(self), publickey-credentials-create=(self)
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Robots-Tag: noindex, nofollow
Cache-Control: no-store (API) · no-cache (index.html) · public, max-age=31536000, immutable (hashed assets)
```

**Desktop content policy.** Tauri fixes the policy at build time, and v2.2 allows `connect-src https:` because the service URL is typed at runtime. In v3, a connected desktop build takes the service origin at build time (`PT_SERVICE_ORIGIN`), and its policy allows only that origin plus Tauri's IPC. A build without it is local-only and allows no network origins. Provider hosts are reached only through the Rust gather command (§5.6), never from the webview.

**Transport:** clients never send a request over plain HTTP (Railway's edge converts a redirected `POST` into a `GET`). A **custom domain** is set up before passkeys are registered; it also allows HSTS preload.

**Logging:** one JSON line per request with time, request ID, method, route template, status, duration, sizes and a keyed IP tag. Security events (sign-in success and failure by reason, lockouts, locks and unlocks, session expiry and revocation, password and second-factor changes, device changes, pruning, vault changes, migration steps) go to an append-only security log kept 400 days and shown in the app under **Security activity**. The time and device of the previous successful sign-in are shown **after** sign-in, never on the sign-in screen. Never logged: request bodies, `Authorization`, cookies, keys, codes, the User ID tried, labels, amounts, transaction fields, credentials or full URLs.

### 5.6 Provider credentials

- Provider credentials are encrypted under `K_vault` and stored in the **credential vault**: one latest-only object on the service (`/api/vault`, conditional writes, no history) with a local encrypted copy on the desktop. The vault holds one **credential record** per provider login: for Plaid, the app's client ID and secret plus one access token per Item; for SimpleFIN, one Access URL that may cover several institutions. Connections refer to their credential record.
- Credentials are **not** in the database, snapshots, JSON or encrypted backups, or exports. Restoring a backup therefore shows **Reconnect** unless the vault on the service still holds the credential, which is the normal case; so a restore does not spend a Plaid Trial Item.
- Only the **desktop app** reads the vault: vault routes accept bearer (desktop) sessions only, after step-up. A gather decrypts the credential in memory and hands it to a Rust command that calls only allowlisted provider API hosts over HTTPS, refuses redirects, applies a 30-second timeout and a 20 MiB response cap, returns the response text, and writes nothing except a per-provider request counter (counts and dates only) used to enforce limits: Plaid's per-Item rate limits, and for SimpleFIN at most 20 requests a day and 90-day windows.
- The desktop webview holds a credential in memory only for the moment it passes it to the Rust command. It runs only bundled code under a policy that allows only the service origin, so a script in it has no direct route to send a credential elsewhere.
- Plaid Hosted Link opens in the system browser, and only for a URL on Plaid's hosted-link domain that Plaid returned. The app polls Plaid for the result, so no webhook or other inbound endpoint exists.
- A SimpleFIN Setup Token is claimed only after checking that it decodes to an HTTPS URL on the Bridge host. A claim that fails with HTTP 403 tells the owner the token may have been used by someone else.
- The service has **no provider proxy**, so it never sees credentials or raw transactions. If a later release adds one, it needs its own ADR, a fixed host allowlist, service-built requests with no client-supplied headers, no redirects, no persistence, logging of only `{provider, status, duration, size}`, the same limits, and step-up for linking.
- Removing a connection deletes its credential record from the vault when no other connection uses it, and revokes it at the provider where the provider allows.

### 5.7 Temporary review storage

- A review is one document encrypted under `K_review` with a random per-save salt and nonce. Its random 128-bit reference, revision and key ID are authenticated as associated data; the month and everything else are inside the ciphertext. The service stores only ciphertext and `{revision, createdAt, updatedAt, expiresAt}`.
- **The review index lives in the review store, not in the database**, so undo, restore, **Keep device copy** and snapshot restores never rewind it. `GET /api/review` lists references with their metadata and a small encrypted header (month and state) for each; `PUT`, `GET` and `DELETE /api/review/:ref` handle one review: latest version only (atomic replace, old file removed), conditional writes, 8 MiB limit, at most 3 open. The desktop and the website each keep the same index locally.
- **Tombstones:** the service remembers deleted references for 90 days and refuses writes to them. On every start and sync, a device lists the service's reviews and deletes any local copy whose reference the service has deleted or does not know, after first uploading a local copy that is newer than the service's.
- **Expiry:** `expiresAt = min(last change + 14 days, start + 45 days)`. The service sweeps at start-up and hourly; the app warns after 7 days without change and 3 days before the 45-day limit.
- **Local crash safety:** the encrypted document is saved locally within about a second of each change (the app shows **Saved**), and to the service every 30 seconds and when the page is hidden.
- **Clearing** (Spending review rules §8) writes the report, waits until the database file is saved and, for a connected profile, until the snapshot upload succeeds; only then deletes the service copy and wipes local copies. If the upload cannot complete, the review stays in state **cleared, awaiting upload** and keeps its data until it can.
- The database runs with `PRAGMA secure_delete = ON`, and no table can hold raw transactions.
- **Local-only desktop profiles**, which have no password-derived key, keep the review file unencrypted next to their unencrypted profile, as v2.2 does for the profile itself, and rely on FileVault. It is deleted on the same events.
- Railway volume backups, where enabled, may keep review ciphertext for up to 89 days; it is readable only with the data key.

### 5.8 Snapshots

**Envelope v2:**

```text
{ format: "pt-snapshot", v: 2, kid, rev, prev, created, device, nonce, iv, ciphertext }
AAD  = canonical JSON of { format, v, kid, rev, prev, created, device }
key  = K_snapshot(nonce); the version label moves inside the ciphertext
```

- **Must:** the client rejects an envelope whose `rev` differs from the one it requested or is lower than the highest revision that device has verified. A restore re-encrypts the old content as a new revision; it never re-uploads an old envelope.
- **Should:** `prev` holds the SHA-256 of the previous envelope, and the client verifies the chain where it has the previous envelope. The field exists from v3.0 (as `"unchecked"` if the chain is not yet verified), so adding the check later needs no format change.
- Freezing (withholding new versions) can be detected only across devices, so every device shows the last change's device and time.

**Retention:** keep every version for 14 days, then one per day to 90 days, then the last of each month; versions the owner **pins** (for example "before migration" or "year end") are kept. Pruning runs on metadata only, keeps `{rev, digest}` tombstones, requires step-up to change, and never removes anything under 14 days old. A corrupt version file is quarantined instead of stopping the service.

**Migration from v2.2** (from the desktop app):

1. The v3 service starts in migration mode when `PT_SYNC_TOKEN` is set and no account exists. It keeps serving the v2.2 API, and enables enrollment and migration endpoints authorized by the legacy token.
2. The owner enters the old token and passphrase once, plus the new User ID and password (which must differ from the old passphrase), and enrolls any second factor.
3. **Starting migration freezes v2.2 writes**: legacy `PUT` requests receive HTTP 423 with a message, so no version is added after the copy begins.
4. The app downloads, decrypts, verifies and re-encrypts each legacy version as envelope v2, keeping its original time and label, and uploads it. Uploads are idempotent and resumable.
5. On commit, the service checks the count against the frozen head, switches to the new store atomically, moves legacy files aside read-only, and rejects the legacy token from then on. Cancelling before commit lifts the freeze.
6. After the owner confirms the treasury matches (with step-up), the legacy files are deleted. The old passphrase should be treated as exposed while any older volume backup exists.
7. A JSON backup is taken first.

### 5.9 Backups

- A new **encrypted backup** (`.ptbackup`) wraps the existing JSON backup with Argon2id (m = 64 MiB, t = 3, p = 1) and AES-256-GCM, using a **separate backup passphrase** of at least 15 characters kept in the password manager. It is the recovery path for a lost account password, so it must not depend on that password.
- The plain JSON export remains, behind a confirmation that explains the risk.
- No backup contains provider credentials.
- Restore reads a backup at the schema version it records and migrates it forward, so backups from v0.2.2 and later stay restorable (Spending review rules §13).

### 5.10 Supply chain and hosting

- `.npmrc`: `ignore-scripts=true` with an explicit allowlist, a 7-day minimum release age, and `audit-level=high`. CI runs `npm audit signatures` and `npm audit --omit=dev --audit-level=high`.
- GitHub Actions pinned to commit SHAs; base images pinned by digest; Dependabot with a cooldown.
- The service stays almost dependency-free: HMAC, HKDF, AES-GCM and TOTP from `node:crypto`, and one pinned WebAuthn verification library.
- Container: pinned `node:24-alpine`, no npm, npx or corepack in the final image, `/app` read-only to the service user, only `/data` writable, the service running as a non-root user after fixing the volume's ownership, Node's permission model limiting writes to `/data`, explicit request timeouts and header limits, and one replica.
- Service secrets (`PT_AUTH_PEPPER`, `PT_AT_REST_KEY_<kid>`, `PT_DEVICE_COOKIE_KEY`, `PT_LOG_KEY`) are 32 random bytes each, stored as Railway **sealed** variables, with a copy in the owner's password manager. Losing the at-rest key or pepper means re-enrolling from the desktop's local copy of `W` or from a backup.
- Railway and GitHub accounts use passkeys or two-factor sign-in, the owner is the only member, and `main` is protected. Railway builds `main` only after CI passes (**Wait for CI**), and the owner triggers each production deploy by hand.

## 6. Residual risks

1. **A compromised host or deploy pipeline can serve code that captures the password at the next web sign-in.** No website can prevent this. Setup, migration, provider linking and gathers, and password changes happen in the desktop app, whose code is local. A later option is to serve the website's static files from a separate host under the owner's domain.
2. **A malicious script running while the owner is unlocked can read what the page can read.** The content policy, Trusted Types, text-only rendering and short sessions make this unlikely; they cannot make it impossible.
3. **Railway's edge sees the authentication key and session identifiers in transit**, never treasury plaintext or provider credentials.
4. **Offline guessing** is possible after a full host compromise, or with a copy of a desktop's app data (which holds `W` for offline unlock), limited by Argon2id and the password's strength. Use a password-manager-generated password and FileVault.
5. **Volume backups keep deleted data** (old wrapped keys, legacy files, review ciphertext, pruned versions) for up to 89 days.
6. **During a sustained attack, a new device cannot sign in** until a trusted device signs in once.
7. **Provider-side retention and breaches** are outside the app's control, limited by read-only access and quick revocation.
8. **Availability:** one replica and in-memory sessions (a redeploy expires every session). A lost password means restoring an encrypted backup; lost second factors mean break-glass.

## 7. Security requirements

Each requirement is covered by a unit test (U), an integration test with the real database and crypto in-process (I), a service test (S), an end-to-end test (E), or a CI or deployment check (C). Numbers are stable; add new ones at the end of a group.

**Authentication and keys**

- SEC-AUTH-1 (U): MK is Argon2id with the account's parameters and 32-byte output, matching RFC 9106 vectors and `node:crypto.argon2`.
- SEC-AUTH-2 (U): The client refuses prelogin parameters below m = 47,104 KiB or t = 1 and sends no authentication request.
- SEC-AUTH-3 (U): AK and KEK come from MK through HKDF-SHA-256 with distinct labels, and differ.
- SEC-AUTH-4 (S): The service stores only `HMAC-SHA-256(pepper, AK)`; a search of `/data` finds no AK, MK or password in any encoding.
- SEC-AUTH-5 (S): Prelogin for an unknown ID returns the same shape and parameters with a deterministic fake salt; median latency differs from a known ID by less than 10 ms over 200 requests.
- SEC-AUTH-6 (S): Wrong password and unknown ID give byte-identical 401 bodies; median latencies differ by less than 10% over 50 requests.
- SEC-AUTH-7 (U/E): Setup and password change reject passwords under 15 characters, blocklisted passwords and passwords containing the User ID; no composition rules.
- SEC-AUTH-8 (S): The wrapped data key is stored only encrypted with the at-rest key and is returned only in the response that completes sign-in or proves the password for an unlock.
- SEC-AUTH-9 (S): A password change replaces verifier, wrapped key and parameters atomically, leaves no old wrapped key on the volume, and expires every other session.
- SEC-AUTH-10 (E): Sign-in fields use `autocomplete` values `username`, `current-password` and `new-password`, and allow pasting.
- SEC-AUTH-11 (S): Setup mode accepts only the setup secret (or the legacy token), and every setup endpoint returns 404 once an account exists.

**Sessions**

- SEC-SESS-1 (S): Sign-in sets exactly one `__Host-pt_session` cookie with `Secure; HttpOnly; SameSite=Strict; Path=/`, no `Domain`, and a 256-bit value.
- SEC-SESS-2 (S): The service stores only hashes of session identifiers, and no identifier appears in logs.
- SEC-SESS-3 (S): After 15 minutes idle a session is **locked**: every request except unlock gets 401 `locked`, and unlock succeeds only with proof of the password. After 12 hours, or on sign-out, it is **expired**: every request gets 401 and any unlock share is deleted.
- SEC-SESS-4 (S): The session identifier after the second factor differs from any the client presented, and a client-supplied identifier is never accepted.
- SEC-SESS-5 (E): After sign-in, reload, lock and sign-out, web storage contains no password, key, unlock share or session identifier.
- SEC-SESS-6 (E): After a reload or lock, the data is unreadable until the password is entered (or, if passkey unlock is implemented, a passkey assertion releases the share). After expiry, any stored unlock copy cannot be decrypted and a full sign-in is required.
- SEC-SESS-7 (E): IndexedDB holds only ciphertext; no known treasury marker appears in its raw bytes.
- SEC-SESS-8 (S/E): Sign out everywhere expires every other web and desktop session in one request and needs step-up.
- SEC-SESS-9 (S): Sign-out sends `Clear-Site-Data: "cache"`; removing device data sends `"cache", "cookies", "storage"`.
- SEC-SESS-10 (U/E): The desktop keeps its session identifier, password and data key only in memory, and drops the data key on lock, sleep and screen lock.

**CSRF and origins**

- SEC-CSRF-1 (S): A cookie-authenticated state-changing request with `Sec-Fetch-Site: cross-site` or `same-site` gets 403.
- SEC-CSRF-2 (S): A cookie-authenticated state-changing request without `X-PT-Request: 1` or JSON content type gets 403 or 415.
- SEC-CSRF-3 (S): Without Fetch Metadata, a cookie-authenticated request with a missing or unlisted `Origin` gets 403.
- SEC-CSRF-4 (S): No `GET` route changes state.
- SEC-CSRF-5 (S): Bearer-authenticated requests are accepted from the allowlisted desktop origins and rejected from any other `Origin`; a cookie is never accepted on a bearer-only route.

**Rate limits and lockout**

- SEC-RL-1 (S): The sixth authentication request within a burst from one IP gets 429 with `Retry-After`.
- SEC-RL-2 (S): After 5 consecutive untrusted failures, untrusted sign-ins are refused for 60 seconds even with the right password, doubling to 60 minutes.
- SEC-RL-3 (S): While the untrusted pool is locked, a trusted client can still sign in.
- SEC-RL-4 (S): After 100 failures without a success, untrusted sign-ins stay closed across a restart until a trusted sign-in or break-glass.
- SEC-RL-5 (S/C): The client IP comes from `X-Real-IP`; `X-Forwarded-For` is ignored; in deployment, a client-supplied `X-Real-IP` is overwritten by the edge.
- SEC-RL-6 (S): A pending sign-in allows at most 5 second-factor attempts and expires after 5 minutes.
- SEC-RL-7 (S/U): The client uploads snapshots at most once a minute while editing and backs off on 429; the service answers more than 90 snapshot writes an hour per session with 429, and exceeding the data quota with 507.

**Second factor** (if Q1 confirms it)

- SEC-MFA-1 (S/E): No web session exists without a passkey assertion with user verification, an authenticator code or a recovery code.
- SEC-MFA-2 (S): Passkey and device-key challenges are 32 random bytes, single-use and valid for 120 seconds; a replayed assertion is rejected.
- SEC-MFA-3 (U/S): Authenticator codes match RFC 6238 vectors, accept one step of drift and reject reuse of an accepted step.
- SEC-MFA-4 (S): Recovery codes are stored hashed, work once, and are all invalidated when regenerated.
- SEC-MFA-5 (S): Desktop device-key sign-in verifies an ECDSA P-256 signature over a single-use challenge; a revoked device key cannot sign in.
- SEC-MFA-6 (S): Every step-up operation in §5.3 fails without a proof from the last 5 minutes.
- SEC-MFA-7 (S): The break-glass value allows exactly one re-enrollment and writes a security event.

**Snapshots and migration**

- SEC-SYNC-1 (U): Envelope v2 authenticates its header fields; changing any of them makes decryption fail.
- SEC-SYNC-2 (U): The client rejects an envelope with the wrong `rev` or a `rev` below its highest verified revision, including revision 3's envelope served as revision 5.
- SEC-SYNC-3 (U): A restore produces a new envelope and never re-sends old ciphertext.
- SEC-SYNC-4 (S): Version labels are not stored in plaintext on the service.
- SEC-SYNC-5 (S): A corrupt version file is quarantined and the service starts and serves the others.
- SEC-MIG-1 (I): Migrating N legacy versions yields N v3 versions whose decrypted bytes equal the legacy plaintext, with original times.
- SEC-MIG-2 (I): An interrupted migration resumes without duplicates, and v2.2 reads work until commit.
- SEC-MIG-3 (S): After commit, the legacy token gets 401 everywhere.
- SEC-MIG-4 (U): Setup rejects a new password equal to the legacy passphrase.
- SEC-MIG-5 (S): After migration starts, a legacy `PUT` gets 423 until commit or cancel.

**Headers and XSS**

- SEC-HDR-1 (S/C): Every response, including errors, 404s and static files, carries the headers in §5.5.
- SEC-HDR-2 (E): The private site cannot be loaded in a cross-origin frame.
- SEC-HDR-3 (E): The Playwright suites run under the enforced policy with no policy or Trusted Types violations.
- SEC-HDR-4 (C): A connected desktop build's content policy allows only its configured service origin; a local-only build allows none.
- SEC-XSS-1 (C): Lint fails on the forbidden DOM and evaluation APIs in `src/`.
- SEC-XSS-2 (U/E): Transaction text containing markup, `javascript:` URLs and bidirectional overrides renders as inert text with those characters removed.
- SEC-XSS-3 (U): Spreadsheet exports write text as string cells; CSV text values beginning with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with an apostrophe.

**Provider credentials**

- SEC-VAULT-1 (S/I): Provider credentials exist only as vault ciphertext; they are absent from the database, snapshots, backups, exports and logs.
- SEC-VAULT-2 (S): The vault keeps one version; a write replaces it and no earlier ciphertext remains in `/data`.
- SEC-VAULT-3 (U): The desktop gather command rejects non-HTTPS URLs, hosts outside the allowlist and paths outside the provider's API, and does not follow redirects. The Hosted Link opener accepts only URLs on Plaid's hosted-link domain.
- SEC-VAULT-4 (U): The gather command enforces Plaid's per-Item rate limits, and refuses more than 20 SimpleFIN requests a day or a SimpleFIN window over 90 days; its counter file holds only counts and dates.
- SEC-VAULT-5 (S): Vault routes reject cookie sessions and require step-up.
- SEC-VAULT-6 (C): The service has no route or dependency that contacts a provider.

**Reviews and retention**

- SEC-REV-1 (S): The service deletes a review within an hour of its expiry; a `GET` afterwards returns 404.
- SEC-REV-2 (I): After clearing, canary transaction descriptions and amounts are absent from the SQLite bytes, audit log, undo snapshots, safety copies, uploaded snapshots, backups, the local review store and the service's storage. Canary descriptions are never used to create rules.
- SEC-REV-3 (U): The database runs with `PRAGMA secure_delete = ON`.
- SEC-REV-4 (S): Only one version of each review exists on disk, and a write to a deleted reference is refused for 90 days.
- SEC-REV-5 (I): Undo, restore, **Keep device copy** and snapshot restore leave the review index and tombstones unchanged.
- SEC-RET-1 (S): Pruning never removes a version under 14 days old or a pinned version, and keeps tombstones.

**Logging**

- SEC-LOG-1 (S): Across a scripted session (setup, sign-in, sync, review save, vault write, sign-out), logs contain none of the canary password, keys, cookies, session identifiers, codes, attempted User ID, labels, amounts or URLs with credentials.
- SEC-LOG-2 (S/E): Every event listed in §5.5 appears in the security log and in **Security activity**; the previous sign-in is shown only after sign-in.

**Supply chain, container and backups**

- SEC-SUP-1 (C): CI fails on high or critical audit findings or signature failures; `.npmrc` sets `ignore-scripts` and the release-age cooldown.
- SEC-SUP-2 (C): Actions are pinned to 40-character SHAs and images by digest.
- SEC-SUP-3 (C): The service's production dependencies are limited to the WebAuthn library and its pinned dependencies.
- SEC-CONT-1 (C): The service runs as a non-root user, cannot write `/app`, and the image has no npm or npx.
- SEC-CONT-2 (C): The service starts with Node's permission model and writes only to `/data`.
- SEC-BAK-1 (U): An encrypted backup round-trips, fails with the wrong backup passphrase, and shares no salt or key with the account password.
- SEC-BAK-2 (U): No backup contains provider credentials.

## 8. Verification

Before release, in addition to the automated requirements:

- Scan the staging and production private sites with an external header checker and an SSL/TLS scanner; record the results.
- Attempt sign-in abuse against staging from outside (wrong passwords, unknown IDs, bursts) and record the lockout and rate-limit behavior.
- Run the dependency audit and record any accepted findings with reasons.
- An independent reviewer reviews the S2, S6b and S8 diffs against §7 and records findings and resolutions on the pull requests.
- Run the canary scan (SEC-REV-2) against a real staging deployment, including the service's data directory and logs.
- Passkey flows are automated in Chromium with a virtual authenticator; Safari and iOS passkey flows are checked by hand.
- On the packaged macOS app: sign-in, lock on idle, sleep and screen lock, offline unlock, encrypted files on disk, and the gather command's allowlist.

## 9. Owner operations

- **Before v3 goes live:** set up a custom domain; secure the Railway and GitHub accounts with passkeys; protect `main` and turn on **Wait for CI**; generate the four service secrets with `openssl rand -base64 32`, save copies in the password manager, and set them as sealed variables; export a JSON backup and an encrypted backup.
- **Setup:** run setup and migration from the desktop app; choose a new password; register two passkeys and an authenticator (if Q1 confirms); store the recovery codes offline; after verifying, delete the legacy files and `PT_SYNC_TOKEN`.
- **Rotation:** change the password only on suspicion of exposure. Rotate the at-rest key yearly (add a new key ID; the service re-wraps at start-up). Rotate the pepper or device-cookie key on suspicion. Rotate provider credentials yearly and on suspicion.
- **Backups:** an encrypted backup monthly and after large imports, stored offline outside Railway; a test restore into a fresh profile every quarter.
- **Monitoring:** review **Security activity** monthly and whenever the previous sign-in looks wrong; check the provider's connected-apps list.
- **If the host may be compromised:** rotate every Railway secret; disable provider credentials at the provider; change the password from the desktop (which expires every session); if malicious code may have run while signed in, rotate the data key; review GitHub and Railway activity.

## 10. Sources

- OWASP cheat sheets: [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html), [Credential Stuffing Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html), and [device cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies).
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) (passwords, rate limiting, timeouts, phishing resistance) and its [session management section](https://pages.nist.gov/800-63-4/sp800-63b/session/).
- [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html) (Argon2), [RFC 9807](https://www.rfc-editor.org/info/rfc9807/) (OPAQUE), RFC 2104 (HMAC), RFC 5869 (HKDF), RFC 6238 (TOTP), NIST SP 800-38D (GCM).
- [Bitwarden security whitepaper](https://bitwarden.com/help/bitwarden-security-white-paper/) (the split-key pattern).
- [WICG Modern Algorithms in WebCrypto](https://wicg.github.io/webcrypto-modern-algos/) and Chrome's September 2026 intent to ship, which does not include Argon2.
- [Node.js 24.7.0](https://nodejs.org/en/blog/release/v24.7.0) (`crypto.argon2`, used in tests) and the [Node permission model](https://nodejs.org/api/permissions.html).
- MDN: [`frame-ancestors` is not supported in `<meta>`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), [`require-trusted-types-for`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/require-trusted-types-for).
- Railway: [volumes](https://docs.railway.com/volumes), [variables](https://docs.railway.com/variables), [backups](https://docs.railway.com/volumes/backups), [networking specs and limits](https://docs.railway.com/networking/public-networking/specs-and-limits).
- [SimpleFIN protocol](https://www.simplefin.org/protocol.html) and [Bridge developer guide](https://beta-bridge.simplefin.org/info/developers); [Plaid Hosted Link](https://plaid.com/docs/link/hosted-link/).
- WebAuthn in the Tauri webview: [tauri-apps/tauri#7926](https://github.com/tauri-apps/tauri/issues/7926); [passkeys on macOS](https://passkeys.dev/docs/reference/macos/); keychain entitlement error −34018: [Apple Developer Forums](https://developer.apple.com/forums/thread/4743).
