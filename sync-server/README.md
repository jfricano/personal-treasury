# Private snapshot service

This small Node.js service stores client-encrypted SQLite snapshots. It does not decrypt or merge databases. A web browser and the desktop app can use the same API. Run one service instance against its data directory; write serialization is process-local. A single person should avoid making edits on two devices at once: a stale upload receives HTTP 409 and must be resolved on the client before retrying.

## Run

Use Node.js 24 or newer and a persistent directory outside the source checkout:

```sh
export PT_SYNC_TOKEN="$(openssl rand -hex 32)"
export PT_SYNC_DATA_DIR=/var/lib/personal-treasury-sync
export PT_STATIC_DIR=/opt/personal-treasury/dist-private
export PT_ALLOWED_ORIGINS='https://treasury.example.com,tauri://localhost,http://tauri.localhost,https://tauri.localhost'
export PT_SYNC_HOST=127.0.0.1
export PT_SYNC_PORT=8787
node sync-server/server.mjs
```

Save the token in a secret manager and provide it to each client through its private setup screen. Use HTTPS at the reverse proxy or hosting edge for every remote connection. Give `PT_SYNC_DATA_DIR` a persistent volume and back it up; deleting it deletes all remote versions. Set `PT_SYNC_HOST=0.0.0.0` only when the service must accept connections from a container network or proxy. `PT_STATIC_DIR` is optional; without it the service exposes only the API. Static assets are public application code; all snapshot API requests require the token. Add the private web app's exact HTTPS origin to `PT_ALLOWED_ORIGINS` even when the service serves the app itself, because browsers may send an `Origin` header on writes. Add the desktop WebView origin used on your platform too.

The service rejects missing tokens, tokens shorter than 32 characters, missing data directories, and wildcard CORS origins at startup. A randomly generated token is essential; token length by itself does not guarantee randomness. Store the data directory outside a publicly served static directory.

## API

All `/api/` requests other than CORS preflight need `Authorization: Bearer <PT_SYNC_TOKEN>`. Browser preflight (`OPTIONS`) is origin checked and returns only CORS headers. The API never uses cookies.

| Request | Response |
| --- | --- |
| `GET /api/sync/head` | `{ "revision": 0, "createdAt": null, "label": null }` for an empty store, otherwise the newest metadata |
| `GET /api/sync/versions` | Metadata array, newest first |
| `GET /api/sync/versions/:revision` | Metadata plus the opaque `envelope` object |
| `PUT /api/sync/head` | New metadata after a conditional upload |

For a PUT, send `Content-Type: application/json`, `If-Match: "0"` for an empty store or the quoted current decimal revision, and `{ "envelope": { ... }, "label": "optional note" }`. The label can be up to 120 characters. The server accepts at most 32 MiB of JSON per upload and stores the envelope without inspecting or decrypting it. The clients must validate the encryption format and decrypt locally. The server does not assert that arbitrary client-supplied envelopes are encrypted.

A stale `If-Match` receives HTTP 409 with `{ "error": "revision_conflict", "head": { ...current metadata... } }`. The client should stop and let the user resolve the divergence rather than automatically overwriting the newer version. A missing or malformed `If-Match` receives HTTP 428. Versions are append-only; a successful upload creates a new numbered file and updates the head pointer atomically. A complete version left by a crash before the head pointer update is published on restart. No API deletes history yet, so storage usage grows with each upload.

Run server tests with `node --test tests/server/sync-server.test.mjs`. They bind an ephemeral localhost port.
