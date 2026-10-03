# Distribution and release status

Personal Treasury is published by Orca Solutions. GitHub is the public source/download home; the [v3 browser demo](https://pt.orcasolutions.dev/) uses fictional tab-scoped data.

## Current public preview

**[v0.3.0-preview.2](https://github.com/jfricano/personal-treasury/releases/tag/v0.3.0-preview.2)** offers **Personal Treasury Local only**, for macOS 12+ on Apple Silicon. Assets are `_Local.pkg`, `_Local.dmg` and `SHA256SUMS.txt`. The demo and README link directly to the PKG and retain installation notes. GitHub hosts these files; a separate backend is unnecessary for downloads.

The owner approved an ad-hoc/non-notarized preview on October 2, 2026. The PKG is unsigned and installs the complete Local app in Applications, without installation scripts or records. Local works offline and starts empty. Its app is ad-hoc signed and not Apple-notarized; [Getting started](guide/getting-started.md#2-install-the-local-mac-app) documents per-file **Open Anyway** approval for installer and first launch. The DMG remains an alternative.

**Connected builds stay private.** Do not upload Connected apps, PKGs, DMGs or archives to GitHub Releases, Pages, containers or other public download locations. Do not add a Connected download link to the README, demo, guides or release notes. The build folder is ignored, and explicit Connected app/package patterns in `.gitignore` and `.dockerignore` protect copies elsewhere from tracking and container build contexts. Gitignore prevents accidental tracking; public release uploads must still select exact Local filenames rather than a bundle-folder wildcard.

Local uses `com.personaltreasury.app.local`; privately configured Connected retains `com.personaltreasury.app`. They have separate app names/data folders. The Local installer does not move records from an earlier unsuffixed app. Export/restore a backup deliberately when transferring those records.

## Publish or update a preview

1. Run appropriate checks, `npm run docs:links` and `npm run privacy:check`. Exclude `reference/`, `tests/local/`, keys, database files and private artifacts.
2. Build Local with `PT_SERVICE_ORIGIN` unset using `env -u PT_SERVICE_ORIGIN npm run desktop:installer`. `--existing-build` packages an app only after identity, version and signature checks. A DMG can be built with `npm run desktop:build`.
3. Expand the PKG and verify its Local-only payload, platform requirements, fixed Applications destination, absence of scripts/data, and enclosed app signature. Check the actual downloaded checksum. Perform and record external-install acceptance separately.
4. Publish an explicitly named Local asset on a tagged GitHub **prerelease**, with source commit, architecture/minimum OS, SHA-256, installation steps and pending gates. Preserve existing checksums when adding another package format.
5. Verify signed-out release visibility, direct download, demo and documentation links. Update the README and demo through a reviewed PR after the asset is available.

Publication and dated validation are in the [v3 release report](development/v3-release-report.md). The [v3 notes](release-notes-v0.3.0.md) describe features, migration and recovery.

## Stable-release gates

The preview does not complete stable-release acceptance. Before a stable tag:

- Complete provider lifecycle, independent security/operations review and real-device/native/Safari/iOS gates in [preview status](development/v3/preview-status.md#remaining-release-work).
- Sign the app with Developer ID Application, and a PKG with Developer ID Installer, then notarize/staple and verify the final distribution artifacts. The current PKG script is unsigned.
- Install the downloaded artifact on another Mac or a fresh user profile; exercise first launch, fictional imports, backup/restore and quit/relaunch persistence.
- Record the final source commit, checksums, supported platforms and evidence. Update docs/screenshots from that build and review every public link/asset for Local-only distribution.

## Promotion

[Launch copy](launch-post.md) identifies the current Local preview and its limits. A stable-release announcement waits for the gates above. Orca Solutions handles [AlternativeTo](https://alternativeto.net/faq/) and [MacUpdate](https://www.macupdate.com/help) submissions. Use the GitHub Local release as download URL and the demo as trial URL. Describe virtual bucket allocations, reconciliation and spending reviews accurately; do not imply public private-service access, certified bank linking, mobile installers or tax filing.

## References

- [Tauri macOS signing/notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Apple preview approval](https://support.apple.com/en-us/102445)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
