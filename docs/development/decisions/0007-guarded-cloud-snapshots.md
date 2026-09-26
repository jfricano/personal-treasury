# ADR 0007 — Guarded encrypted cloud snapshots for v2.2

Status: accepted · 2026-09-25

## Context

The owner wants to edit the same treasury from a phone and the Mac executable. The existing desktop profile is a local SQLite file, while the public browser demo deliberately loses changes when its tab closes. JSON backup and restore can move a complete copy manually, but it does not persist edits across devices.

The earlier local-only requirements in the original project brief are superseded for this opt-in feature by the owner's v2.2 request. Financial calculations, imports, and transactional edits stay in the existing in-process SQLite engine.

## Decision

- Add a separate private web build. It uses local IndexedDB and requires the snapshot service access token and sync passphrase before opening the treasury. The public demo remains fictional and tab-scoped.
- Keep the desktop executable's local SQLite profile. Connecting cloud sync is optional and requires an HTTPS service URL, access token, and passphrase each app session. The desktop app keeps both secrets in memory.
- The private web tab keeps the token and passphrase in session storage so reload can reconnect and reconcile with the cloud. Log out clears them, and 30 minutes without activity locks the app. Closing the tab normally clears session storage; browser session restore can preserve it until the inactivity limit expires.
- A small Node service stores opaque, client-encrypted SQLite snapshots. The service can run on an always-on home machine or a hosted machine with persistent disk and HTTPS. The client API is the same in either place.
- Every upload includes the cloud revision the client last saw. The service atomically advances the revision only if it still matches. Older versions remain available and can be restored as a new head.
- Each device remembers the last synced revision and a hash of its local database. If both the local database and cloud head changed, syncing stops for an explicit choice. Choosing the cloud saves the device copy locally first; choosing the device creates a new cloud version and retains the old cloud head in history.
- Cloud payloads are encrypted on the client with AES-256-GCM using a key derived from a user passphrase with PBKDF2-SHA-256. The server never receives the passphrase or plaintext database. A separate high-entropy bearer token controls API access. The server still sees version timestamps, labels, and encrypted payload sizes.

## Limits and follow-up

This is whole-database, single-person sync. It deliberately does not merge simultaneous edits from two devices. The app must stop and ask for a choice when histories diverge. A device can keep editing while offline, but it cannot publish those edits until it reconnects and passes the revision check.

The service retains all versions in v2.2, so the data directory grows with use. A future release can add a deliberate retention policy after backup requirements are known. A persistent volume backup is still needed against loss of the host itself. The private web app's local IndexedDB is a working copy, not the only backup.

No hosting provider is selected by this decision. Moving the service to another machine changes its URL and deployment configuration; using a different storage system behind the service would require a server adapter without changing the app sync API.
