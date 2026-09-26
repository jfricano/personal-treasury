# Getting started

## 1. Try the demo

The quickest way to see Personal Treasury is the [live demo](https://jfricano.github.io/personal-treasury/). It runs entirely in your browser with a made-up household, the Harpers, and starts with a one-minute guided tour. Your changes stay in that browser tab and disappear when you close it.

## 2. Run it on your Mac

You need [Node.js](https://nodejs.org/) 22.12 or later. Then:

```bash
git clone https://github.com/jfricano/personal-treasury.git
cd personal-treasury
npm install
npm run dev:demo      # the demo, with sample data, at http://localhost:1420
npm run dev           # the app itself, starting empty, at http://localhost:1420
```

`npm run dev` keeps its data in that browser's local storage. For real use, build the desktop app.

## 3. Build the desktop app

The desktop app stores everything in a SQLite file on your Mac and works offline. Building it needs [Rust](https://www.rust-lang.org/tools/install) as well as Node.js.

```bash
npm run tauri build
```

The app lands in `src-tauri/target/release/bundle/macos/Personal Treasury.app`, with a disk image in `bundle/dmg/`. It needs macOS 12 or later on Apple Silicon.

The build is signed for your own Mac only. It isn't notarized by Apple, so another Mac blocks it on first launch; the owner of that Mac can allow it under **System Settings → Privacy & Security → Open Anyway**. See [Development](../development/development.md#desktop-app-tauri) for signed, distributable builds.

## 4. Set up your household

Open the app and choose one of the two paths on the welcome screen:

- **Import a workbook.** If you kept your plan in a spreadsheet with the supported layout, choose **Import and export → Choose workbook…**. You get a full preview, with control totals and cell-level warnings, before anything is saved. [Workbook import](../development/workbook-import.md) describes the supported layouts.
- **Start fresh.**
  1. Create your account buckets on **Accounts**.
  2. On **Budget and tax**, create a budget: gross pay, deductions, actual withholding, then a line for each purpose, each funded by an account.
  3. Activate the budget.
  4. On **Monthly reconciliation**, choose **New month**. The month starts from the active budget.

## 5. Back up

By default, data stays on your Mac unless you save a file yourself. If you connect the optional private cloud service, encrypted database snapshots sync across your devices. See [private cloud sync](cloud-sync.md). Use **Import and export → Complete JSON backup** regularly. A backup restores every record exactly, including budgets and tax rules.

## Next

The [user guide](user-guide.md) covers the monthly workflow, debts, budgets and tax in detail.
