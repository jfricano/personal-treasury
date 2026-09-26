# Host the private sync service on Railway

Railway is one hosted option for the provider-independent service. Its [Hobby plan](https://docs.railway.com/pricing) currently has a $5/month minimum that counts toward resource usage; usage above that is billed separately. Review its pricing before creating a paid project.

The steps below deploy **one** service instance. The snapshot writer serializes changes within that process, so do not scale it to multiple replicas against one volume.

1. Create a Railway project and connect this repository's `codex/v2.2` branch as one service. Set `RAILWAY_DOCKERFILE_PATH=sync-server/Dockerfile` in its variables and keep the repository root as the build context. Railway documents [custom Dockerfile paths](https://docs.railway.com/builds/dockerfiles).
2. Attach one [persistent volume](https://docs.railway.com/volumes) mounted at `/data`. The image starts as root only to set the mounted directory's ownership, then runs the Node process as `node`. Keep one replica.
3. Add service variables: `PT_SYNC_TOKEN` (a freshly generated 64-character hex token from `openssl rand -hex 32`) and `PT_ALLOWED_ORIGINS` (the final HTTPS app origin plus `tauri://localhost,http://tauri.localhost,https://tauri.localhost`). The image already sets `PT_SYNC_DATA_DIR=/data`, `PT_STATIC_DIR=/app/dist-private`, and `PT_SYNC_HOST=0.0.0.0`. Keep the token out of the repository and frontend build variables. [Railway variables](https://docs.railway.com/variables).
4. Generate a Railway domain under Public Networking. Railway provides HTTPS automatically. Add that exact `https://…` origin to `PT_ALLOWED_ORIGINS`, then deploy the staged variable change. Set the service health check path to `/healthz`. [Railway public networking](https://docs.railway.com/networking/public-networking).
5. Schedule [daily volume backups](https://docs.railway.com/volumes/backups). App version history protects against a mistaken edit; volume backups protect against loss or corruption of the hosted storage. Also keep occasional complete JSON backups outside Railway.
6. Open the HTTPS URL on the phone, enter the token and a sync passphrase, and repeat the passphrase for the first upload. In the Mac app, connect to the same URL and credentials under **Settings → Cloud sync**. Wait for **Up to date** before switching devices.

No private financial data needs to be pushed to GitHub or placed in Railway variables. The server stores client-encrypted snapshots on the volume. Moving to another host means copying the data directory, updating the app URL, and resolving the first connection choice if the new URL has no remembered local baseline.
