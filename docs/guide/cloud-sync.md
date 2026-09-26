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

1. Open the private HTTPS URL on your phone. Enter the access token and sync passphrase. On the first upload, repeat the passphrase. The browser keeps a local working copy in IndexedDB.
2. Open the updated Mac app. In **Settings → Cloud sync**, enter the same HTTPS URL, token, and passphrase. The URL is remembered; the token and passphrase are held only in memory for that app session.
3. If the cloud is empty, the first connected device uploads its local treasury. If the cloud already contains data and this device has its own data, the app asks you to choose which copy becomes current. It does not silently overwrite either one.
4. Use **Settings → Cloud sync** to check status, sync immediately, see version history, or restore an older version. Restoring creates a new cloud version and saves a local safety copy first.

Edits save locally even when the service is unavailable. Sync retries when the app is open and online. The private web app needs a connection when a new browser session begins so it can verify cloud credentials; once open, it can keep local edits during an outage. Before switching devices, wait for **Up to date** in Cloud sync. If both devices were edited from different starting versions, choose **Use cloud copy** or **Keep this device's copy** after reviewing them. The overwritten cloud head remains in version history; the overwritten device copy becomes a local safety copy.

The private web tab remembers its credentials in browser session storage so a reload reconnects and checks for cloud changes without another login. **Log out** clears them and hides the treasury; it leaves the local IndexedDB working copy on the device for the next connection. The tab also logs out after 30 minutes without activity. Closing the tab normally clears session storage, though a browser's session-restore feature may reopen it; the inactivity limit still applies. Session storage is readable by scripts from the same origin, so use a trusted browser and keep the private app free of untrusted extensions or scripts. Browser data can be cleared by the browser or device, so keep the cloud service's persistent volume backed up and retain occasional complete JSON backups. For now, use one private web tab at a time for this treasury.
