# ADR 0008 — Single-user sign-in with a key the server cannot use

Status: accepted for v3, except item 4 (second factor), which is proposed until the owner confirms it (Product spec §10, Q1) · 2026-09-26. Supersedes the credential parts of [ADR 0007](0007-guarded-cloud-snapshots.md) and the multi-user proposal in [v3 ideas](../v3-ideas.md).

## Context

V2.2 opens the private website and desktop sync with a static 256-bit access token and a sync passphrase. The owner wants a familiar **User ID and password** instead, for one user only, with no password recovery, and with security as the first priority because v3 adds access to the owner's financial institutions. A security review of v2.2 ([Security §2](../v3/security.md#2-what-v22-gets-right-and-what-v3-must-fix)) found the token and passphrase in web storage, an unencrypted browser working copy that survives logout, no server-side sessions, no rate limiting and no security headers.

The earlier multi-user proposal (access requests, administration, activation tokens, per-user isolation) is abandoned. The owner may revisit multi-user access later; nothing in this decision prevents it, but nothing is built for it.

## Decision

1. **One account**, created once in setup mode from the desktop app with a one-time setup secret (or the legacy v2.2 token, which also authorizes migration). Setup is then disabled permanently.
2. **A split key hierarchy.** The password is stretched with Argon2id (64 MiB, t = 3, p = 1) on the device. HKDF splits the result into an authentication key, which the server stores only as a keyed hash (HMAC with a secret pepper), and a key-encryption key, which never leaves the device and wraps a random data key. The server stores the wrapped data key only after encrypting it again with a key held in Railway's environment. A password change re-wraps the data key; nothing else is re-encrypted.
3. **OPAQUE is deferred.** It would keep the authentication key off the wire, but the website's code is served by the same host, so a compromised host could capture the password either way. The account record carries an `authScheme` so OPAQUE can be adopted later.
4. **A second factor is required on the website** (passkey, with authenticator codes and recovery codes as fallbacks). The desktop app uses an authenticator code once per install, then a device key. Break-glass re-enrollment requires a value set in Railway. This goes beyond "User ID and password"; it is recorded as the recommended default in the product spec's open questions for the owner to confirm.
5. **Server-enforced sessions**: a session locks after 15 minutes idle and expires after 12 hours, with a `__Host-` cookie on the web and an in-memory bearer on the desktop. Unlocking needs the password; no password, key or session identifier is kept in web storage. A passkey unlock through a session-bound escrow is an optional addition.
6. **Every copy at rest is encrypted** with keys derived from the data key: snapshots (envelope v2, bound to revision and history), local working copies, temporary reviews and provider credentials. Local-only desktop profiles stay as in v2.2.
7. **No password recovery.** An encrypted backup with its own passphrase is the recovery path. The app says so when the password is set.
8. **Migration** re-encrypts the whole v2.2 history from the desktop app, verifies it, and retires the legacy token. Legacy files are deleted only after the owner confirms.

The full design, parameters and testable requirements are in [Security](../v3/security.md).

## Consequences

- Strangers who find the URL face a second factor, rate limits and lockouts that cannot be turned against the owner. A copy of the server's disk alone gives an attacker nothing to test passwords against.
- The owner's daily cost is a password-manager fill at each sign-in or unlock, one biometric tap per web sign-in if the second factor is confirmed, and the password at desktop launch.
- A compromised host could still serve malicious website code, so setup, migration, provider access and password changes happen in the desktop app.
- Forgetting the password without an encrypted backup loses the data. That is the owner's explicit choice.
- Losing a Railway secret (the pepper or the at-rest key) requires re-enrolling from the desktop's local copy of the wrapped key or from a backup, so the owner keeps copies in a password manager.
