# V3 request ingestion (T-01)

Local remediation candidate, October 19, 2026. Based on `295ffa18c687ea1c986d4a842c17773d7b30a951`; the `1fe3bf8` implementation checkout has the same server source. No newer authoritative deployment was established. T-01 stays open until the reviewed candidate is deployed and verified. H-04 trusted-device behavior is outside this change.

## Supported requests

The executable method/path policy is `sync-server/ingestion.mjs`. Unknown API paths, unknown factor/setup suffixes and unsupported methods return 404 before reading a body. OPTIONS is accepted only for a supported path and `Access-Control-Request-Method`. All caps below are **received UTF-8 bytes**, including JSON and base64/envelope overhead. GET, HEAD and OPTIONS accept no body (zero bytes).

| Method | Path(s) | Authentication / additional checks | Body cap |
| --- | --- | --- | --- |
| GET | `/healthz` | Public | 0 |
| GET, HEAD | Existing static files | Public, existing realpath boundary | 0 |
| POST | `/api/auth/prelogin`, `/api/auth/login` | Credential acquisition; login validates derived password key in serialized route | 64 KiB |
| POST | `/api/auth/device/challenge` | Native Origin; challenge is public and grants no session | 64 KiB |
| POST | `/api/setup/begin`, `/api/setup/confirm` | Setup secret header, only before enrollment; confirm validates enrollment/token/code after bounded parse | 64 KiB |
| POST | `/api/auth/factor`, `/api/auth/factor/options`, `/api/auth/factor/device`, `/api/auth/factor/reset/begin`, `/api/auth/factor/reset/confirm` | Pending token (body or cookie), native Origin when applicable, existing factor/reset state machine | 256 KiB |
| GET | `/api/auth/session` | Session, including locked session | 0 |
| POST | `/api/auth/unlock`, `/api/auth/logout` | Session, including locked session; unlock also proves password | 64 KiB |
| GET | `/api/auth/activity`, `/api/auth/sessions`, `/api/auth/devices`, `/api/auth/passkeys`, `/api/migration/status`, `/api/sync/head`, `/api/sync/versions`, `/api/sync/versions/:positiveRevision`, `/api/review`, `/api/review/:ref` | Active session | 0 |
| POST | `/api/auth/lock`, `/api/auth/step-up`, `/api/auth/step-up/options`, `/api/auth/step-up/device` | Active session; existing browser/native proof rules | 256 KiB |
| POST | `/api/auth/recovery/regenerate`, `/api/auth/authenticator/begin`, `/api/auth/authenticator/confirm`, `/api/auth/passkeys/revoke`, `/api/auth/sessions/revoke`, `/api/auth/logout-all`, `/api/auth/devices/revoke`, `/api/sync/pin`, `/api/sync/prune` | Active session + fresh step-up | 64 KiB |
| POST | `/api/auth/password`, `/api/auth/password/key`, `/api/auth/devices` | Active native session + fresh step-up; existing password/device validation | 64 KiB |
| POST | `/api/auth/passkeys/options`, `/api/auth/passkeys/verify` | Active session + fresh step-up; existing WebAuthn verification | 256 KiB |
| POST | `/api/migration/start`, `/api/migration/verify`, `/api/migration/commit`, `/api/migration/delete-legacy`, `/api/migration/cancel` | Active native session + fresh step-up | 64 KiB |
| GET, PUT | `/api/migration/versions/:positiveRevision` | Active native session + fresh step-up + migration state | GET 0; PUT 32 MiB |
| PUT | `/api/sync/head` | Active session + conditional revision + envelope checks | 32 MiB |
| PUT, DELETE | `/api/review/:ref` | Active session + conditional revision/tombstone checks | PUT 8 MiB; DELETE 64 KiB |
| GET, PUT | `/api/vault` | Active native session + fresh step-up + conditional revision/envelope checks | GET 0; PUT 1 MiB |
| GET | Legacy `/api/sync/head`, `/api/sync/versions`, `/api/sync/versions/:positiveRevision` | Exact legacy bearer token, only before migration commits | 0 |
| PUT | Legacy `/api/sync/head` | Exact legacy bearer token + conditional revision; 423 while migration copies, 401 after commit | 32 MiB |

All v3 API requests retain the Origin allowlist; state-changing requests retain CSRF checks. The legacy bridge retains its token/Origin rules. Public Origin or `X-PT-Request` never substitutes for a protected session. Review references retain the existing `[a-f0-9-]{36}` format. Pending browser/native requests still parse their bounded bodies because a body pending token may override the cookie; pending validity, expiry, attempts, factor replay, reset authorization and native origin checks remain serialized.

## Admission, state and memory

Session admission is a synchronous, read-only check of the existing session map. It does not refresh activity or mutate lock/expiry/audit state. Invalid sessions use a bounded zero-body queue entry to preserve serialized lock/expiry side effects without consuming their uploads. Before executing a parsed request, authorization is rechecked against current state. The existing `session()` changes activity once inside the serialized route, and existing step-up/replay/conditional-write checks run there. Revoked, locked or expired sessions and stale step-up cannot commit an upload admitted earlier. Setup closure and legacy freeze/commit are rechecked too. An upload does not refresh idle time while it streams.

Capacity is fail-fast: no waiting list for admission. Defaults are 16 admitted requests (uploading, parsed/queued and executing combined), 4 simultaneous body readers, and 64 MiB of reserved wire capacity. Every body reserves its **entire route cap**, even if its declared length is small. The reservation remains through queued processing; finishing parsing releases only its reader slot. Success, parser/route errors, timeout and interrupted uploads release reservations in `finally`. Disconnected queued work is skipped when its queue entry retires; until then its reservation stays held, bounding retained bodies and queue entries. Running state changes finish under their reservation even if their client disconnects.

Received bytes are checked before retention. Retained chunks are coalesced into slabs of at most 64 KiB, so a one-byte-at-a-time sender cannot create millions of retained Buffer objects. Before string conversion/JSON parsing, a structural scan rejects depth over 32 or more than 4,096 container/separator tokens. This bounds object-graph amplification while leaving ciphertext strings opaque. It is not a general-purpose arbitrary JSON upload API.

`Content-Length` enables early refusal; actual received bytes enforce the cap independently. Incomplete/aborted bodies are invalid; the intake deadline is 30 seconds. Rejected requests close the connection without draining the remaining upload. `Expect: 100-continue` receives 100 only after route, auth, header, rate and capacity checks.

Operators can reduce capacity after measuring their target:

| Environment variable | Default | Valid range |
| --- | ---: | --- |
| `PT_INGESTION_REQUESTS` | 16 | Integer 1–16 |
| `PT_INGESTION_UPLOADS` | 4 | Integer 1–4, no greater than requests |
| `PT_INGESTION_BYTES` | 67108864 | Integer 33554432–67108864 bytes |

Invalid configuration refuses startup. The 32 MiB minimum preserves admission of a full supported snapshot; route caps cannot be silently reduced through these settings. Reservations are **not a heap/RSS ceiling**. A conservative planning allowance is roughly eight times reserved bytes plus measured baseline and at least 256 MiB headroom for serialization, filesystem reads, responses, runtime and garbage collection. This is a planning assumption, not a memory safety proof or a sustained-load claim. Large read responses, stored-object sizes and existing unrelated in-memory maps need separate operational capacity consideration.

## Compatibility and response behavior

The 32 MiB snapshot/migration/legacy wire limit is unchanged. Base64 ciphertext expands binary data by about 4/3; the full envelope and JSON must fit. Approximate plaintext ceilings are under 24 MiB for snapshots, under 6 MiB for reviews (header included), and under 768 KiB for vaults. A 256 KiB WebAuthn request allows much more space than ordinary credential/assertion metadata; controls allow 64 KiB for derived keys, wrapped keys, codes, IDs and device keys.

Review/vault wire caps now match their existing 8 MiB/1 MiB post-parse limits. Previously JSON whitespace/escape expansion or multibyte Unicode metadata could consume up to the global 32 MiB wire limit while normalizing below those post-parse string-length checks. Such noncanonical oversized encodings are now rejected. Ordinary encrypted base64 envelopes and native/browser key payloads fit; near-cap roundtrips exercise all large workflows. Existing post-parse envelope and size validations remain. Arbitrarily deep or field-heavy extra JSON is also newly rejected. No history, source workbook, encryption keys or envelope format changes.

- 404 unsupported method/path; 401/403 existing authentication errors; 415 non-JSON body.
- 413 declared or received body above route cap; 400 invalid/incomplete JSON or excessive structure; 408 intake deadline (Node may send an empty HTTP 408 before the JSON deadline handler).
- 503 `ingestion_busy`, `Retry-After: 1` when any capacity ceiling is full; no body is buffered while waiting for a slot.
- Existing 429 authentication/write limits and 409 conditional-write conflicts remain distinct.

Clients may retry 503 after at least one second with backoff/jitter. Existing clients automatically retry 429; 503 is currently surfaced as a recoverable sync/review error and may require explicit Retry or a later edit. Retry conditional writes only after checking the remote revision; a lost successful response is not proof a write failed. Do not retry 413 unchanged.

## Local verification and deployment gate

Reproduction commands (synthetic keys/data only):

```sh
npm run test:server
npx vitest run tests/unit/spending/crypto.test.ts
node scripts/measure-v3-ingestion.mjs
node scripts/measure-v3-ingestion.mjs --single
node scripts/smoke-private-container.mjs
```

The measurement starts a separate service process, so client allocations do not contaminate service RSS. It holds one or two near-32 MiB snapshot uploads open, completes them (concurrent writes yield 200/409), and reads back the stored version. `--single` uses a 32 MiB reservation/one reader. It reports process peak RSS, not merely final heap. It removes its disposable directory and starts no production connection.

Author evidence on October 19, 2026:

- Node 26.9.0/macOS: 38/38 server tests before the additional deterministic queue test; queue test separately 1/1. Existing encryption regressions 3/3.
- Node 24.21.0/Linux private-image runtime: 39/39 server tests passed, including the real timeout and deterministic queued-work test. Unenrolled setup-secret early rejection also passed as an additional focused test on both macOS and the Node 24 Linux image.
- Exact-limit/declaration/UTF-8/chunked parsing, one-byte chunks, parser timeout/error/abort cleanup, prompt anonymous/unknown rejection and Expect behavior; aggregate saturation, disconnect/parse-failure recovery, queued-body/request ceilings; lock/logout/expiry/step-up during upload and serialized audit events.
- Legitimate near-cap AES-GCM snapshot, migration, review and vault upload/readback/decryption; existing native/device/MFA/recovery/reset/CSRF/migration/CAS tests retained.
- Disposable private-image smoke: setup, MFA, authenticated upload, persistent restart, anonymous refusal, non-root/immutable application, Node permissions and sanitized logs passed.
- macOS separate service RSS: two uploads, baseline 76,546,048 bytes, receiving 189,808,640 bytes, peak 585,809,920 bytes (~559 MiB). Single upload with smaller reservation: baseline 76,791,808, receiving 137,773,056, peak 550,322,176 bytes (~525 MiB). Neither proves fit in 512 MiB.
- Node 24.21.0/Linux, disposable container capped at 1 GiB with no external networking: two near-cap uploads and readback passed; service baseline RSS 89,419,776 bytes, receiving 186,470,400, peak 406,839,296 bytes (~388 MiB). The cap includes the separate synthetic client process; reported RSS isolates the service. This is bounded local evidence, not production capacity certification.
- Focused independent authentication/ingestion review: initial idle-lock/expiry audit regression repaired and reviewed; no remaining blockers in the reviewed source. The review reused author large-envelope evidence; it independently ran ingestion/v3 tests and the later slab/configuration unit tests.

Current RAM entitlement, effective ingress settings, replica count and production revision remain unverified. The documented 500 MB deployment capacity is disk, not evidence of available RAM. Provisional planning: at least 1 GiB for this configuration, followed by target Node 24/container measurement with representative encrypted state and required headroom. No paid change, scaling, live configuration, volume access or deployment is authorized by these notes.

### Proposal for the deployment owner (not applied)

Confirm one process/replica, actual memory limit and current source first. Set ingress routes/methods and byte/time limits consistently with this matrix; upstream maximum must permit 32 MiB received bodies, not confuse plaintext/base64 sizes. Verify the edge's body buffering, early auth rejection forwarding, timeout and connection behavior with a small disposable candidate. Keep application caps even if ingress also limits bytes. Retain existing 16 KiB headers, 15-second header deadline, 30-second request/body deadline and 5-second keepalive unless separately reviewed. Measure saturated uploads plus parsed queue and normal read/write paths on the actual runtime. A healthy `/healthz` alone is not deployed acceptance.

Rollout needs a separately authorized candidate/image, resource fit, normal encrypted sync/review/vault and credential-acquisition checks, plus prompt rejection and cleanup verification. Stop if legitimate payloads fail, memory headroom is inadequate, state changes serialize incorrectly, or auth/recovery/migration behavior regresses. T-01 remains open until that evidence exists.

Rollback is code/image-only to the previous approved revision; encrypted history, volume and keys stay in place. This patch has no storage migration. Restart expires in-memory sessions, requiring sign-in again. Rolling back reintroduces T-01; record that exposure and coordinate containment. Volume restore, key rotation, scaling, migration and upstream configuration changes are separate operations requiring their own authority.
