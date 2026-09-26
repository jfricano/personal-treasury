# Personal Treasury v3 ideas

Started 2026-09-25. This is a place to collect possibilities, not a release commitment. V2.2 is the current baseline; a new feature should earn its place by making an existing task easier or making the app available to someone who cannot use it today.

## Keep from v2.2

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

## Candidate: multi-user access and administration

Let people request access with first name, last name, and email. An administrator reviews pending requests in a restricted dashboard, either within the main app or in a separate admin app. Prefer a familiar username or email plus password sign-in over v2.2's manually entered access token and sync passphrase. Approval could issue a one-time activation token so the user can create their credentials; the app would manage session tokens behind the scenes. The admin can see request and account status, revoke access, and review a minimal audit trail.

This needs more than an admin screen:

- Give each user a separate account and encrypted snapshot history. Replace v2.2's one shared service token with user-scoped authentication and enforce account isolation on every API request, version lookup, backup, and restore.
- Show the admin only the identity and operational details needed to approve and support accounts. Treasury contents, sync passphrases, encryption keys, and plaintext backups must remain unavailable to the admin and server. Make that boundary clear in the request form: the admin will see the submitted name and email.
- Generate activation and session tokens securely, deliver activation tokens only once, store verifiers rather than raw tokens or passwords on the server, and support expiration, rotation, revocation, and lost-device recovery. Let users see and end active device sessions.
- Verify email ownership and protect the request form against spam and repeated requests. Record approvals, denials, token changes, and admin actions without logging secrets or financial data.
- Let users change their account password and, separately, change the secret that unlocks their encrypted treasury. A sync passphrase change must preserve access to the entire snapshot history, not only new uploads; evaluate re-encrypting old versions or migrating to a user-held data key that can be rewrapped safely. Make rotation atomic and recoverable if interrupted.
- Design password reset and token recovery for a verified user, including lost-device and revoked-token cases. An admin may help restore account access but must not gain the ability to decrypt treasury data. If a forgotten password also protects the encryption key, resetting account access alone cannot unlock old snapshots; recovery would need a user-held recovery key, another signed-in device, or an explicitly chosen recovery design. Explain that limit before users rely on the service.
- Plan migration of the existing single-person v2.2 service and its snapshot history into one user account, plus tests that try cross-user reads, writes, restores, and token misuse.

Open design choices include where to host the admin interface, how to deliver activation credentials safely, which account metadata an admin may see, whether invitation-only onboarding is preferable to public access requests, and how one sign-in can unlock client-encrypted data without giving the server or admin the key. Scope these before implementation.

## Ideas to discuss later

| Idea | Why it might help | Open question |
| --- | --- | --- |
| Downloadable desktop releases | Make the Mac app, and eventually the Windows app, available without asking someone to build from source. | Which builds are ready to share, and what signing or install instructions do they need? |
| Compare budget versions | Show the active budget beside a draft before activation: take-home pay, category totals, and funding differences. | Which comparisons would actually help a budget decision? |
| Year overview | Summarize completed months and debt balances from records already in the app. | What is useful to see together without adding a new bookkeeping task? |
| Backup confidence | Make it easier to see when a backup was last saved and check that it can be restored. | How can the check avoid changing the active profile? |

- customizeable/collapsable views from the dashboard

Pick and scope these with real use cases before implementation. None of the ideas in this table is approved or scheduled yet.
