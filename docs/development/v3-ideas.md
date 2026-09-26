# Personal Treasury v3 ideas

Started 2026-09-25. This is a place to collect possibilities, not a release commitment. V2.1 is the current baseline; a new feature should earn its place by making an existing task easier or making the app available to someone who cannot use it today.

## Keep from v2.1

- Calculations stay on the user's device. The optional v2.2 private sync service stores client-encrypted snapshots; the public demo continues to use fictional data.
- Preserve exact money calculations, import compatibility, budget history, and the ability to undo or restore changes.
- Keep the compact, clear interface. Prefer a few useful additions over a larger set of controls.

## First candidate: Windows desktop app

Create a 64-bit Windows installer (`.exe`) for the same local app. This is a packaging and testing project, not a rewrite.

Before calling it ready:

- Build on a Windows runner and retain the installer as a downloadable artifact. The current CI runs on Linux, and the current bundle settings produce macOS packages only.
- Test a clean install, first launch, local profile storage, restart, workbook import and export, backup and restore, and native file dialogs on Windows with fictional data.
- Decide how to include the WebView2 runtime so installation can work without an internet connection, and whether a publicly distributed installer needs code signing.
- Keep private profiles, personal workbooks, and local backups out of the build and its published artifacts.

Tauri's [Windows installer guide](https://v2.tauri.app/distribute/windows-installer/) and [GitHub Actions guide](https://v2.tauri.app/distribute/pipelines/github/) are the starting references.

## Ideas to discuss later

| Idea | Why it might help | Open question |
| --- | --- | --- |
| Downloadable desktop releases | Make the Mac app, and eventually the Windows app, available without asking someone to build from source. | Which builds are ready to share, and what signing or install instructions do they need? |
| Compare budget versions | Show the active budget beside a draft before activation: take-home pay, category totals, and funding differences. | Which comparisons would actually help a budget decision? |
| Year overview | Summarize completed months and debt balances from records already in the app. | What is useful to see together without adding a new bookkeeping task? |
| Backup confidence | Make it easier to see when a backup was last saved and check that it can be restored. | How can the check avoid changing the active profile? |

- customizeable/collapsable views from the dashboard

Pick and scope these with real use cases before implementation. None of the ideas in this table is approved or scheduled yet.
