# Personal Treasury v3 — 0.3.0-preview.2

V3 adds actual-spending reviews and real-account balance snapshots to the existing budget, monthly allocation and interaccount-debt workflows. The public demo and Local Mac app now include v3. This is a **GitHub prerelease**; outstanding acceptance and security checks are listed in the [release status](development/v3/preview-status.md#remaining-release-work).

**Try:** [browser demo](https://pt.orcasolutions.dev/) · [walkthrough](guide/demo-walkthrough.md) · [user guide](guide/user-guide.md)

**Download:** [Local Mac installer (.pkg)](https://github.com/jfricano/personal-treasury/releases/download/v0.3.0-preview.2/Personal-Treasury_0.3.0-preview.2_Apple-Silicon_Local.pkg) · [release assets, alternate DMG and checksums](https://github.com/jfricano/personal-treasury/releases/tag/v0.3.0-preview.2)

## What's new

- **Budget Analysis:** CSV, OFX, QFX and QBO statement previews, explicit monthly coverage, classifications and splits, duplicate decisions, reciprocal transfer pairs and categorization rules.
- **Monthly reports:** planned-versus-actual spending, category/funding totals, income, unbudgeted spending, year-to-date figures and aggregate Excel exports. Clearing keeps the report and deletes the temporary review's transactions.
- **Assets and liabilities:** real-account balance snapshots and optional liability details alongside the review, separate from treasury buckets and interaccount loans.
- **Private sign-in:** one owner, User ID and password, authenticator/passkey/recovery factors, native device enrollment, locking, security activity and encrypted backups with a separate recovery passphrase.
- **Encrypted sync:** persistent treasury snapshots and separately stored temporary reviews, explicit conflict choices, and encrypted local working copies for private access. Provider credentials stay in a separate vault and are used only on the native desktop.
- **Navigation and distribution:** grouped screens, guided sample reviews, distinct Local/Connected identities and a direct Local PKG download.

## Installation and upgrades

Local is the only public download. It works offline, starts empty and requires macOS 12+ on Apple Silicon. The unsigned PKG installs the complete **Personal Treasury Local.app** in Applications. Its app is ad-hoc signed without notarization. For a blocked installer or first launch, use **Done → System Settings → Privacy & Security → Security → Open Anyway**, then confirm. See [Getting started](guide/getting-started.md#2-install-the-local-mac-app).

Connected builds are configured and retained privately; no Connected installer is offered on GitHub or the public demo. Local has its own data folder. An earlier unsuffixed app does not automatically transfer its records to Local: export a complete backup and restore it. Reinstalling an app alone does not delete its separately stored data.

For an existing v2 private service, back up the volume, secrets and treasury before deployment. Preserve the old token and sync passphrase until desktop migration has re-encrypted and read back every historical version and cutover succeeds. Legacy files are retained after cutover. Subsequent sign-in uses the v3 User ID, password and second factor; legacy credentials belong only to migration. See [Railway migration](guide/railway-sync.md#upgrade-an-existing-v2-service).

## Limits and recovery

Live/Sandbox Plaid lifecycle, independent security review and remaining packaged Mac/Safari/iOS checks are outstanding. Provider linking/gathering is exposed only in a configured, signed-in native app; use statements or manual entry in Local and browser builds. V3 does not move bank money or file taxes.

At most three temporary reviews are retained. They expire after 14 idle days or 45 days from creation; clearing deletes their transaction details. Ordinary backups retain persistent reports, not those temporary rows or provider credentials. Keep encrypted recovery backups and their separate passphrase outside the device or service. Recovery codes replace a missing second factor, not a forgotten encryption password.

Publication and validation evidence: [v3 release report](development/v3-release-report.md). Earlier [v2.2 notes](release-notes-v0.2.2.md) are retained as history.
