# Personal Treasury v0.2.2 — private cloud sync

V2.2 adds an optional way for one person to use the same treasury from the Mac app and a private website on a phone or computer. The desktop app still works from its local SQLite file, and the public [Pages demo](https://jfricano.github.io/personal-treasury/) remains a separate, fictional-data experience.

## What's new

- **Private web app.** A separate HTTPS build opens a local browser working copy only after the cloud access token and sync passphrase are verified. It is distinct from the public demo.
- **Mac-to-web sync.** The Mac app can connect under **Settings → Cloud sync**. Edits save locally first, then encrypted database snapshots move through a small hosted service. The server does not receive the passphrase or plaintext treasury.
- **Guarded changes.** Each upload names the cloud revision it started from. If another device changed the cloud and this device also has edits, the app stops and asks which copy should become current. It does not silently merge or overwrite them.
- **Version history and recovery.** Successful uploads remain as cloud versions. You can restore an older version as a new head; choosing the cloud after a conflict saves the displaced device copy locally first.
- **Web session controls.** A reload reconnects and checks for changes without another login. **Log out** clears the tab's credentials, and 30 minutes without activity logs it out. The local browser working copy remains on that device.

## Start using it

1. Set up a private HTTPS snapshot service with persistent storage, an access token, and a backup plan. The [Railway guide](guide/railway-sync.md) is one hosting example; the app is not tied to Railway.
2. Keep the access token and your new sync passphrase in a password manager. If your treasury already lives on the Mac, connect the Mac first in **Settings → Cloud sync** and wait for **Up to date**.
3. Open the private HTTPS URL on your phone or another computer, enter the same token and passphrase, and wait for **Up to date** before editing. Use **Sync now** or check the status in Settings before switching devices.

The [private cloud sync guide](guide/cloud-sync.md) explains first connection, conflicts, version restore, and session behavior. The [user guide](guide/user-guide.md) covers the treasury workflow.

## Limits and backups

V2.2 supports one person across devices. It does not add user accounts, password login, passphrase changes, or credential recovery. Losing the sync passphrase prevents decryption of cloud snapshots; keep a complete JSON backup outside the service. Cloud versions live on the same volume and cannot recover a lost volume. Railway's current Hobby plan does not allow scheduled volume backups, so use encrypted storage outside Railway for regular JSON exports.

The private web app needs a connection to verify credentials when a new tab session begins. Once open, it can save edits locally during an outage and reconcile later. Its token and passphrase live in tab session storage across reloads; closing the tab normally clears them, although browser session restore can preserve them until the inactivity limit. The Mac app keeps them in memory only for its app session.

The [v2.2 implementation report](development/v2.2-release-report.md) records test coverage and remaining real-device checks. A notarized, publicly downloadable Mac installer is not part of this update.
