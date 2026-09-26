# Private cloud sync (v2.2)

The private web app and Mac executable can use one treasury across devices. Each device works from a local SQLite copy. A small service keeps encrypted, versioned snapshots and rejects an upload if another device has changed the cloud copy.

The public demo remains separate and contains only fictional data. Do not use it as the private web app.

## What you need

- A machine that runs the snapshot service whenever you want devices to exchange changes. This may be an always-on home machine or a hosted machine. An ordinary Mac that is asleep or shut down cannot sync at that time.
- A persistent data directory or volume. Back up that directory separately; cloud version history on the same disk cannot protect against losing the disk.
- HTTPS for access outside the host, normally provided by a reverse proxy or hosting platform. Do not expose the service's plain HTTP port directly to the internet.
- One high-entropy access token and one memorable, strong sync passphrase. Keep both in a password manager. Losing the passphrase means the cloud snapshots cannot be decrypted.

## Start the service

Build the private web app and run the Node service on a machine with Node 24 or newer:

```sh
npm ci
npm run build:private
export PT_SYNC_TOKEN="$(openssl rand -hex 32)"
export PT_SYNC_DATA_DIR=/path/to/persistent/treasury-data
export PT_STATIC_DIR="$PWD/dist-private"
export PT_ALLOWED_ORIGINS='https://your-private-domain.example,tauri://localhost,http://tauri.localhost,https://tauri.localhost'
node sync-server/server.mjs
```

Record the generated token before closing the terminal. Keep it out of source control and shell history. Set your reverse proxy to forward HTTPS requests for the private domain to `127.0.0.1:8787`. The service serves the private web app and `/api/sync` from that one domain. Change `PT_SYNC_HOST` and `PT_SYNC_PORT` only when your deployment needs different listening settings. The [service README](../../sync-server/README.md) documents the API and environment variables.

For a container deployment, build with `docker build -f sync-server/Dockerfile -t personal-treasury-sync .`, mount a persistent volume at `/data`, pass `PT_SYNC_TOKEN` and `PT_ALLOWED_ORIGINS` as secrets/configuration, and place HTTPS in front of port 8787. The image does not select a hosting provider.

For a hosted example, see the [Railway deployment guide](railway-sync.md). The client API does not depend on Railway.

## Connect devices

1. If your treasury already lives in the Mac app, connect it first under **Settings → Cloud sync**. Enter the private HTTPS service URL, access token, and a new sync passphrase; repeat the passphrase for the first upload. Wait for **Up to date**. The URL is remembered on the Mac, while the token and passphrase stay only in memory for that app session. If you are starting from an empty treasury, either device can connect first.
2. Open the private HTTPS URL on your phone or another computer. Enter the same token and passphrase and wait for **Up to date** before editing. This private website is separate from the public demo and keeps a local working copy in IndexedDB.
3. If the cloud is empty, the first connected device uploads its local treasury. If the cloud already contains data and this device has its own data, the app asks you to choose which copy becomes current. It does not silently overwrite either one.

## Daily use, conflicts, and versions

Use **Settings → Cloud sync** to see the current status and cloud version, choose **Sync now**, or restore an older version. Edits save locally even when the service is unavailable. The app checks again while open and online; the private website also checks when it becomes visible. Before switching devices, wait for **Up to date**.

If both the device and cloud changed, syncing stops at **Needs a choice**. **Use cloud copy** preserves the device's current data as a local safety copy before opening the cloud copy. **Keep device copy** uploads this device's data as a new version; the prior cloud head remains in history. Review the copies before choosing. **Restore** on an older cloud version creates a new head and saves a local safety copy first; it does not erase the older versions.

Cloud version history lives on the service's volume and protects against a mistaken edit. It cannot recover a lost or corrupted volume. Keep complete JSON backups in encrypted storage outside the service. The [Railway guide](railway-sync.md) describes its current backup-plan limits.

## Sessions and credential recovery

The private website needs a connection when a new browser tab session begins so it can verify credentials. Once open, it can keep local edits during an outage. It remembers the token and passphrase in tab session storage so a reload reconnects and checks for cloud changes without another login. **Log out** clears them and hides the treasury; it leaves the local IndexedDB working copy on the device for the next connection. The tab also logs out after 30 minutes without activity. Closing the tab normally clears session storage, though a browser's session-restore feature may reopen it until the inactivity limit. Session storage is readable by scripts from the same origin, so use a trusted browser and avoid untrusted extensions or scripts. Use one private web tab at a time for this treasury.

V2.2 has no in-app access-token or passphrase change and no credential-recovery flow. Keep both secrets in a password manager. The service owner can replace a lost or exposed access token in the service configuration and update the connected devices, but that does not recover a forgotten passphrase. Without the passphrase, existing cloud snapshots cannot be decrypted; a complete JSON backup or an already-unlocked local copy is the practical recovery source. Take a backup before changing credentials or service storage.
