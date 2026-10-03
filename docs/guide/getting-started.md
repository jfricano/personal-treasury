# Getting started with v3

The current public release is **0.3.0-preview.2**. It includes the Local Mac app and the browser demo. Private service owners can separately build and configure Connected; there is no public Connected download.

## 1. Try the demo

Open the [live v3 demo](https://pt.orcasolutions.dev/). It uses a fictional Harper household, includes a guided tour and offers **Budget Analysis → Try a sample review**. Changes stay in the browser tab and disappear when it closes. The demo does not open your private treasury.

## 2. Install the Local Mac app

You need an Apple Silicon Mac with macOS 12 or later.

1. [Download the Local PKG installer](https://github.com/jfricano/personal-treasury/releases/download/v0.3.0-preview.2/Personal-Treasury_0.3.0-preview.2_Apple-Silicon_Local.pkg). The [GitHub release](https://github.com/jfricano/personal-treasury/releases/tag/v0.3.0-preview.2) also has an alternate DMG and SHA-256 checksums.
2. Open the PKG. If macOS displays **Apple could not verify…**, click **Done**, open **System Settings → Privacy & Security**, scroll to **Security**, and click **Open Anyway** for that installer. Confirm and authenticate if prompted. This is [Apple's documented per-file approval](https://support.apple.com/en-us/102445).
3. Follow macOS Installer to place **Personal Treasury Local.app** in Applications. The package contains the complete app and needs no further download.
4. Open the app from Applications. Its first launch may need the same **Open Anyway** approval.

The preview installer is unsigned; the app is ad-hoc signed and not Apple-notarized. A clean install on another Mac remains part of release acceptance. Local starts with an empty treasury and does not sign in or sync to a private website.

### Existing installations and records

Local and Connected have different app names and local data folders. Their application bundles are separate from their records: deleting only an app from Applications leaves its application data and any cloud history intact. Keep a backup before reinstalling or changing versions, and avoid cleanup tools that also remove application data.

An earlier preview used the unsuffixed **Personal Treasury.app** name and the older storage identity. If it holds records you want in Local, export a complete JSON backup there and restore it in Local. The new installer does not automatically move those records. A configured Connected build retains its existing private storage identity.

## 3. Set up your household

Choose workbook import or manual setup:

- **Import:** open **Import and Export**, choose the treasury workbook, inspect controls and warnings, then **Commit import**. Import a budget workbook separately. The source files are unchanged; replacement imports save a safety copy.
- **Start fresh:** add treasury buckets on **Accounts**, create and activate a plan on **Budget and Tax**, then create a month on **Monthly Reconciliation** using the active budget.

For actual-spending comparisons, add statement connections and real accounts under **Connected Accounts**, then start a monthly review in **Budget Analysis**. CSV and OFX/QFX/QBO imports have a preview; PDF-only statements use manual entry. See the [user guide](user-guide.md).

## 4. Optional private service

The public Local app remains offline. A privately configured desktop and private HTTPS website can use one encrypted treasury with **User ID, password and MFA**. Service enrollment happens once from the configured desktop. The [Railway guide](railway-sync.md) explains v3 hosting; the [private sign-in instructions](user-guide.md#create-your-private-sign-in) cover enrollment, authenticator codes and recovery codes.

Only existing v2 cloud history requires the old token and sync passphrase during its one-time migration. Normal v3 sign-in uses the new credentials. The [v2 sync guide](cloud-sync.md) is historical.

## 5. Back up

Use **Import and Export → Complete JSON backup** to preserve persistent records, budgets, rules and cleared reports. JSON backups are unencrypted: keep them in encrypted storage outside the Mac or service. In a signed-in private session, **Settings → Encrypted backup** creates a `.ptbackup` with a separate recovery passphrase.

Temporary review transactions and provider credentials are excluded from normal backups. Cloud history on one volume cannot recover a lost volume. See [backup and restore](user-guide.md#back-up-and-restore).

## Build and run from source

Use Node.js 24 or newer. A native build also needs Rust; the PKG builder targets Apple Silicon Macs.

```bash
git clone https://github.com/jfricano/personal-treasury.git
cd personal-treasury
npm ci
npm run dev:demo           # sample demo at http://localhost:1420
npm run dev                # local browser app with IndexedDB storage
env -u PT_SERVICE_ORIGIN npm run tauri:dev # Local Dev; separate storage
env -u PT_SERVICE_ORIGIN npm run desktop:installer # Local app and PKG
```

Run one development server at a time on port 1420. The installer is in `src-tauri/target/release/bundle/pkg/`; `npm run desktop:build` additionally creates a DMG. See [Development](../development/development.md) for commands and private source builds.
