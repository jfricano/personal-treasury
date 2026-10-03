# V3 preview release report

Status checked October 3, 2026. Current public package: **0.3.0-preview.2**, a GitHub prerelease. The v3 implementation is merged into `main`; this report distinguishes published functionality from outstanding stable-release gates.

## Published

- V3 implementation [PR #7](https://github.com/jfricano/personal-treasury/pull/7) merged October 1, 2026 (Pacific time), after the specification PR. Budget Analysis, statements, temporary reviews, cleared aggregates, real-account balance snapshots, private password/MFA access and encrypted sync are in the merged source.
- Local preview distribution and app identities merged through [PR #11](https://github.com/jfricano/personal-treasury/pull/11), [PR #12](https://github.com/jfricano/personal-treasury/pull/12) and [PR #13](https://github.com/jfricano/personal-treasury/pull/13).
- [GitHub Pages deployment](https://github.com/jfricano/personal-treasury/actions/runs/37124568774) succeeded for `c0c77ae372c9206ca5665a857b97d2e8fe9f8fec`; the [public v3 demo](https://pt.orcasolutions.dev/) offers the direct Local PKG.
- [GitHub release v0.3.0-preview.2](https://github.com/jfricano/personal-treasury/releases/tag/v0.3.0-preview.2) has the Local PKG, alternate DMG and checksums. Both published preview tags contain Local assets only; the older v0.2.1 draft has no assets. No Connected installer is publicly offered.

The native payload was built from `d295ab4084ccb9ef4c6498ea7a2025fa609392bd` without `PT_SERVICE_ORIGIN`. Packaging/source changes followed on `main`; a new package format did not change the enclosed app version. Local starts empty and contains no private service address, records or credentials. Configured Connected builds are retained privately and explicitly ignored outside the build directory too.

## Validation evidence

The detailed September 30 implementation evidence remains in [preview status](v3/preview-status.md#validation-recorded), including unit/integration/service/browser/Rust checks and the immutable non-root container smoke test. Those dated counts are historical evidence, not current suite-size promises.

[PR #13 CI](https://github.com/jfricano/personal-treasury/pull/13/checks) passed the main test job, private-container job and demo-image job. The main job includes format, lint, types, Vitest, service tests, all web builds, documentation links and demo/v3-private/legacy-private Chrome suites. It does not compile native Mac packages.

Packaging checks recorded for the Local preview:

- App name/version/identifier and ARM64 executable checked; enclosed application signature verified. Native first launch opened an empty treasury.
- DMG verified; PKG expanded and inspected for only the named app under Applications, fixed location, macOS 12+/ARM64 requirements and no install scripts or treasury-data payload. Read-only Installer preflight passed.
- Clicking the updated localhost demo button downloaded the public PKG while leaving the demo open; the downloaded checksum matched the release.
- Privacy scans and Local/private build identities checked. These checks do not certify provider lifecycle or complete real-device/native acceptance.

| Public asset | SHA-256 |
| --- | --- |
| `Personal-Treasury_0.3.0-preview.2_Apple-Silicon_Local.pkg` | `e20e0833123dde1580bae0a621671f08656c267d4f132f4adf9c2aecb21ab424` |
| `Personal-Treasury_0.3.0-preview.2_Apple-Silicon_Local.dmg` | `8a4f61d95b6d5059a25868995c256dbbb3c5eca458ddcf16e4c496dfcdc9208f` |

The installer is unsigned; its app is ad-hoc signed and not Apple-notarized. Per-file macOS approval is documented in [Getting started](../guide/getting-started.md#2-install-the-local-mac-app). No clean install of the downloaded PKG on another Mac is recorded here.

## Documentation review

The October 3 review covers all tracked public Markdown: README/document index, current user/developer/hosting guides, release/distribution copy, v3 contracts, treasury/workbook rules and historical records. Current instructions now identify preview.2, direct Local downloads, v3 password/MFA setup, schema 5 and actual check/build commands. Legacy guides, v2 reports and the original v3 plan are explicitly dated/historical; financial rules and target acceptance contracts remain intact. Provider research remains labelled with its original date.

README screenshots were refreshed from the fictional v3 demo on October 3, including dashboard, reconciliation, debt history, the guided tour and Budget Analysis on desktop and phone. Earlier v2 images remain as historical assets. These captures are documentation evidence, not a substitute for the remaining device acceptance checks.

The public download policy is Local-only. Explicit `.gitignore` and `.dockerignore` patterns protect Connected apps and installer copies from tracking and container build contexts. Release uploads still require selecting exact Local assets; ignore rules alone do not govern GitHub uploads.

## Remaining acceptance and operations

Provider Sandbox/live lifecycle, independent security review, packaged native/private/Safari/iOS flows, accessibility and operational recovery/migration rehearsals remain in the [release gate list](v3/preview-status.md#remaining-release-work). Developer ID signing, notarization and external installation are pending stable-distribution gates.

Private service deployments and live treasury migration are separate from public Local publication. Current hosting instructions preserve the `/data` volume and legacy credentials during one-time migration, use v3 server secrets and verify non-root write permissions. This public report does not claim a completed owner-specific migration or expose household data. Restore, sync, restart and key recovery must be verified on the actual private deployment before marking those gates complete.
