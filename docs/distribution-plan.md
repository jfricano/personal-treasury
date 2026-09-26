# Distribution plan

Personal Treasury is published by Orca Solutions. GitHub is the source and download home; the [browser demo](https://jfricano.github.io/personal-treasury/) is the fastest way to try it. The demo uses fictional data and does not retain changes after the tab closes.

## 1. Prepare the Mac release

- Use the reviewed V2.1 work already merged into remote `main`; integrate the version and launch documentation before tagging.
- Run `npm run check`, `npm run test:e2e:demo`, and `npm run privacy:check`. Confirm no file from `reference/` or `tests/local/` is tracked or included in release assets.
- Build a macOS 12+ Apple Silicon DMG with a Developer ID Application signature and Apple notarization. Check `codesign --verify --deep --strict`, `spctl --assess --type execute`, and `xcrun stapler validate` on the final artifact.
- Install the downloaded DMG in a fresh macOS user profile or on another Mac and exercise first launch, a sample workbook import, JSON backup and restore, and a quit/relaunch persistence check.
- Record the version, commit, SHA-256, supported Mac architecture, and test results in the release notes.

The current local V2.1 package is ad-hoc signed. It is not a public Mac release until the signing, notarization, and external-install checks above pass.

## 2. Publish the download hub

- Publish a tagged GitHub Release with the notarized DMG, release notes, SHA-256, install instructions, screenshots, and links to the demo and [one-minute walkthrough](guide/demo-walkthrough.md).
- Update the README's download link only after the release is live. Keep source-build instructions available.
- Add accurate GitHub topics: `personal-finance`, `budgeting`, `local-first`, `macos`, `tauri`, and `open-source`. Set the repository website to the demo.
- Verify the download, source archive, demo, and README links from a signed-out browser session.

## 3. Submit software listings — owner handoff

Once the release URL exists, submit Personal Treasury to [AlternativeTo](https://alternativeto.net/faq/) and [MacUpdate](https://www.macupdate.com/help). Use the GitHub Release as the download URL and the browser demo as the trial URL. Orca Solutions will handle these submissions and their reviews.

Suggested category: personal finance. Describe it as a private household cash-allocation and monthly-reconciliation app. Specify macOS, free, and MIT open source. Do not describe the demo as a persistent web product or claim bank connections, mobile installers, or tax filing.

## 4. Show the workflow

- Put the [walkthrough](guide/demo-walkthrough.md) beside the demo link in the README and release notes.
- Use the existing guided tour and screenshots to show the sequence: paycheck plan → account buckets → monthly transfers → reconciliation → interaccount debt history.
- Share the [launch post](launch-post.md) built around that sequence after the release is live. It links directly to the demo, walkthrough, source, and release. Keep the sample data fictional and avoid promising features that are not in the app.

### Short launch copy

> Personal Treasury by Orca Solutions is a free, open-source Mac app for households that split each paycheck across account buckets. It turns a budget into a monthly transfer plan, names every reconciliation issue, and keeps a traceable history of transfers and interaccount debts. Data stays on your Mac. Try the one-minute demo with a fictional household, then download the Mac app from GitHub.

## Release status

| Item | Status |
| --- | --- |
| V2.1 implementation and local acceptance report | Complete; V2.1 was merged into remote `main`. See [V2 release report](development/v2-release-report.md). |
| Public walkthrough and launch copy | Prepared in this repository. |
| Local v0.2.1 build and tests | 169 Vitest tests, 26 Chrome tests, privacy check, app signature and ad-hoc DMG checksum passed. |
| Developer ID signing and Apple notarization | Pending credentials and external-install verification. |
| GitHub repository metadata | Demo website and six discovery topics are set. |
| GitHub Release and public v0.2.1 demo update | Pending release artifact and source publication. |
| AlternativeTo and MacUpdate submissions | Orca Solutions after the release. |

## Sources

- [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [GitHub repository topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
