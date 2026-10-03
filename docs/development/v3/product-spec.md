# Personal Treasury v3: product specification

Scope: the v3 target contract. Current preview implementation and remaining acceptance evidence are recorded in [release status](preview-status.md) and the [release report](../v3-release-report.md); publication does not certify every requirement below.

Status: approved direction; Q1 (passkeys) and Q2 (Plaid) decided 2026-09-27; remaining questions in §10 · 2026-09-26

V3 turns the private web app and the desktop app into one signed-in treasury for a **single owner**. It adds a monthly comparison of the budget with actual spending, drawn from the owner's own financial institutions, and a month-end snapshot of assets and liabilities. The treasury rules in [Data model and calculation rules](../data-and-rules.md) and the budget model in [Architecture §7](../architecture.md) do not change.

Companion documents:

- [Spending review rules](spending-review-rules.md): data model, calculations and invariants.
- [Security design](security.md): threat model, sign-in, key hierarchy and testable security requirements.
- [Institution data](aggregation.md): provider options (including one without Plaid), desktop-only gathering, and the file-import fallback.
- [Implementation plan](implementation-plan.md): branches, build order, review gates and the builder handoff.
- [Acceptance tests](acceptance-tests.md): the behaviors v3 must pass before release.
- Decisions: [ADR 0008](../decisions/0008-single-user-sign-in.md), [ADR 0009](../decisions/0009-institution-data-provider.md), [ADR 0010](../decisions/0010-temporary-spending-review.md).

## 1. Owner decisions that shape v3

Recorded 2026-09-26. These supersede the multi-user section of [v3 ideas](../v3-ideas.md).

1. **One user.** Access requests, an administrator dashboard, activation tokens, per-user isolation and email delivery are **not part of v3**. The design must not preclude them, but no v3 code or configuration exists for them.
2. **User ID and password.** The v2.2 "access token + sync passphrase" pair becomes a User ID and password on both the private website and the desktop app. The password still protects the encryption key, so the server cannot read treasury data.
3. **No password recovery.** If the password is lost, the owner restores a JSON backup into a new profile. The app says so plainly when the password is set.
4. **Security first.** Where convenience and security conflict, security wins, and the trade-off is written down.
5. **Budget Analysis by calendar month**, shown as an interactive view and exportable to `.xlsx`.
6. **Account types:** checking, savings, credit card, brokerage, retirement, and student, auto and mortgage loans.
7. **Assets and liabilities** are reported alongside the budget analysis, from the same data pull.
8. **Keep raw transactions temporary.** A month's transactions exist only while that month is being reviewed. The permanent record is a cleared **spending report**, one per month. Reports can be deleted, and can be replaced by clearing a new review; re-running an already cleared month asks for confirmation first.
9. **Incomplete data is normal.** A review stays open until every account is complete or explicitly waived, and in-progress work must survive a browser crash, reload or device switch.
10. **Use a connection service** to reach the institutions if one fits, rather than building per-bank integrations.
11. **Navigation is reorganized** into Budgeting and Treasury sections, and the new pages are named **Budget Analysis** and **Connected Accounts** (2026-09-27). The treasury buckets page keeps the name **Accounts**: the owner withdrew the earlier "List of Accounts" rename so every label fits on one line. The owner left the choice between static section labels and collapsible or drop-down menus to a design review, which chose static labels (§6, Navigation).

## 2. Goals and non-goals

### Goals

- Keep strangers out of the internet-facing site, and keep the treasury unreadable to the hosting provider and to anyone who copies the server's disk.
- Make the monthly budget review a 15–30 minute task: gather, classify with remembered rules, resolve the exceptions, clear.
- Show exactly where the month deviated from the plan, by budget line, category and funding account, with year-to-date context.
- Record net worth monthly without keeping transaction history.
- Keep every existing v2.2 workflow, calculation, import, export and undo behavior intact.

### Non-goals for v3

- Multiple users, sharing, administration or account recovery.
- Moving money: no payments, transfers or bill pay. Institution access is read-only.
- A permanent transaction ledger, transaction search across months, or tax and investment-performance reporting.
- Automatic classification without the owner's acceptance.
- Creating treasury journal entries, confirming treasury transfers or creating interaccount debts from institution data. V3 may *suggest*; the owner acts through the existing screens.
- Live balances on the Dashboard. Balances are captured when a review gathers data.
- Connecting the public demo to real institutions. The demo uses fictional sample files.

## 3. Glossary

Existing words keep their meaning. V3 needs several new ones, and "account" and "reconciliation" are each already taken, so the new terms are deliberately distinct.

| Term | Meaning |
| --- | --- |
| **Treasury account** | An existing virtual bucket such as HH or PETC. Listed on **Accounts**. Unchanged. |
| **Institution** | A bank, credit union, card issuer, brokerage or loan servicer. |
| **Connection** | The app's link to one institution: through a data provider, or through files the owner downloads and imports. |
| **Institution account** | One real account at an institution, such as a checking account or a credit card. Identified to the owner by name and last four digits. |
| **Provider** | The data-aggregation service that brokers read-only access to institutions (see [ADR 0009](../decisions/0009-institution-data-provider.md)). |
| **Spending review** | The in-progress work for one calendar month: gathered transactions, their classifications, coverage and waivers. Temporary. |
| **Disposition** | What one transaction means for the budget: budget line(s), income, internal transfer, unbudgeted spending, or excluded. |
| **Rule** | A saved pattern that suggests a disposition for future transactions. Rules persist; the transactions they matched do not. |
| **Coverage** | Whether the gathered data for an institution account spans the whole month. |
| **Waiver** | The owner's explicit statement, with a reason, that an institution account needs no data for a month. |
| **Clear** | Finalize a spending review. Clearing writes the spending report and deletes the review's transactions. |
| **Spending report** | The permanent monthly summary: planned vs actual by line, income, coverage, totals of transfers and exclusions, and the balance snapshot. No individual transactions. |
| **Balance snapshot** | Assets and liabilities by institution account, captured during the review and saved with the report. |

The treasury's **Monthly Reconciliation** is unchanged, and remains the only thing the app calls a reconciliation. The new page is **Budget Analysis**.

## 4. Workflows

### 4.1 First sign-in and moving from v2.2

1. The owner deploys the v3 service with a one-time setup secret (see [Security §5.1](security.md#51-account-setup)). Setup runs from the **desktop app**, because its code is local rather than served by the host: enter the service URL and setup secret, choose a User ID and a password (at least 15 characters; a password-manager value or five or more random words is recommended), acknowledge that a forgotten password cannot be recovered, enroll an authenticator app, and save the recovery codes.
2. If a v2.2 snapshot history exists, setup offers **Bring over my v2.2 treasury**. The owner enters the old access token and sync passphrase once. The desktop app decrypts every v2.2 version, re-encrypts it under the new key, uploads the new history, and verifies it by reading it back. Old files are deleted only after the owner confirms that the treasury matches. Until then, v2.2 keeps working.
3. On the private website, the owner signs in with the password and an authenticator code and registers two passkeys (one in the phone's and Mac's keychain, one hardware key). From then on, a web sign-in is the password plus a passkey tap.
4. Other desktop installs get the service URL once, then sign in with the same User ID, password and an authenticator code the first time. If one already has a local profile, the existing first-connection choice (**Use cloud copy** / **Keep device copy**) still applies.
5. A desktop that never connects to a service keeps working as a **local-only** profile exactly as in v2.2, with file-based spending reviews available (§4.3).

### 4.2 Connecting institutions

1. **Connected Accounts** lists each institution with its accounts, status and last successful refresh.
2. **Add connection** is done in the **desktop app**, the only place provider credentials are used (see [Institution data §4](aggregation.md#4-where-gathering-runs)). The app opens the provider's own linking page in the system browser (with the recommended provider, Plaid Hosted Link), where the owner signs in to the institution; the app never sees those credentials. The resulting access credential goes straight into the encrypted credential vault. Before each link, the app shows how many of the provider's lifetime connection slots remain and blocks a duplicate link. The website shows connections and their accounts but cannot add them or gather from them.
3. For each new institution account the owner confirms:
   - the **kind** (checking, savings, credit card, brokerage, retirement, student loan, auto loan, mortgage, other asset, other liability);
   - whether it is **in spending review** (default on for checking, savings and credit cards; off for investment and loan accounts);
   - whether it is **in the balance snapshot** (default on);
   - an optional **treasury account** it represents (for example, a savings account that holds the PETC bucket), or **Shared** for an account that serves several buckets, such as a credit card.
4. An institution the provider cannot reach becomes a **file connection**: the owner names it, adds its accounts by hand, and each month imports statement files (OFX, QFX or CSV) or, for institutions that offer only PDF statements, types the month's transactions and closing balance into a short form.
5. A connection that needs the owner to sign in again shows **Reconnect**, which walks the owner through the provider's repair step (for example, re-linking on the provider's site or pasting a new setup token) without losing the account mappings.
6. **Remove connection** deletes the stored credential, revokes it at the provider where the provider allows (otherwise it tells the owner exactly where to disable it), and keeps the institution accounts' names on past reports.

### 4.3 The monthly spending review

1. On **Budget Analysis**, choose a month. The default is the most recent calendar month without a cleared report.
2. **Gather** (provider accounts on the desktop app; files on any device). The app requests posted transactions for each in-scope account, from seven days before the month through today (at most 60 days after it), plus current balances for accounts in the snapshot. File connections prompt for a file. Progress is shown per account. Anything that fails is listed with its reason and a next step: **Retry**, **Reconnect**, **Import file**, or **Waive**.
3. **Coverage.** Each in-scope account is **Complete**, **Partial**, **Missing**, **Needs reconnect**, **Error** or **Waived**. A newly linked account asks the owner once to confirm that its history covers the month. See [Spending review rules §4](spending-review-rules.md#4-coverage-and-completeness).
4. **Classify.** The transaction table shows only the month's posted transactions. Neighboring-month and pending items are available for context but never counted. Rules pre-fill suggested dispositions; the owner accepts them in bulk or one at a time, splits a transaction across budget lines, pairs internal transfers, and marks exclusions with a reason. Every change autosaves.
5. **Resolve.** A checklist names what prevents clearing: unclassified or unaccepted transactions, unbalanced splits, accounts not complete or waived, a missing budget version, or unresolved possible duplicates. Each item links to the affected row or account.
6. **Summary.** Planned vs actual by budget line, category and funding treasury account, with income, unbudgeted spending, set-aside lines, transfers and exclusions, year-to-date figures, and the balance snapshot. This view is live while the owner classifies.
7. **Clear.** The owner reviews the summary and confirms, after a reminder that clearing deletes the month's transactions and that **Undo** restores the previous report but not the transactions. The app writes the spending report in one transaction, records it in the audit log, waits until it is saved (and uploaded, when signed in), offers to save any new rules, then deletes the review's transactions from every place they were held. The report appears under **Reports**.
8. **Export** a cleared report to `.xlsx` at any time. During a review, the owner can also export a working copy that includes individual transactions; the app warns that this file contains transaction detail and saves it only where the owner chooses.

### 4.4 When data is incomplete

- The review stays open for as long as it is needed. Its temporary data is encrypted and saved after every change, locally and to the service, so a crash, reload or switch from phone to Mac resumes where the owner left off (see [ADR 0010](../decisions/0010-temporary-spending-review.md)).
- A partially gathered account can be re-gathered later. A new gather merges with the existing data by transaction identity and keeps every classification already made.
- If an institution is down or needs re-authentication, the owner can **Import file** for that account, or **Waive** it with a reason (for example, "no activity" or "account closed"). Waivers appear on the report.
- An open review expires 14 days after its last change, and never later than 45 days after it was started; its temporary data is then deleted everywhere (§10, Q4). The Dashboard and Budget Analysis warn after 7 days without a change and 3 days before the 45-day limit. Any change, including **Keep open**, restarts the 14 days.
- The Dashboard shows the most recent month that has not been cleared and the review's state.

### 4.5 Re-running, replacing and deleting reports

- Starting a review for a month that already has a cleared report requires confirmation: *"September 2026 was cleared on 3 October. Re-running is rarely needed. The existing report stays until you clear the new review, which then replaces it."*
- Clearing the new review replaces the old report atomically. The replacement is audited and can be undone in the same session.
- **Delete report** requires confirmation, is audited, and can be undone in the same session. Deleting a report never deletes rules or connections.
- If a later review finds that the posted transactions dated in the final week of an already-cleared month no longer match that month's report (an institution posted something late), it says how many and how much, and offers to re-run that month. Earlier late postings are not detected.

### 4.6 Assets and liabilities

- Each review captures current balances for accounts in the snapshot. Liability details (statement balance, minimum payment, APR, due date, loan principal) are shown when the provider supplies them.
- For checking, savings and credit card accounts whose later transactions were gathered, the app also shows an **estimated month-end balance**. Investment and loan balances are shown **as of** their capture time, never estimated.
- The report shows total assets, total liabilities, net worth, and the change from the previous cleared report.
- Interaccount debts between treasury accounts are internal and net to zero, so they are not in this snapshot. The page says so.

### 4.7 Signing out and locking

- **Sign out** ends the session and removes the decrypted data from the page. **Sign out everywhere** ends every session. **Sign out and remove this device's data** also clears the device's encrypted copy.
- The private website locks after 15 minutes without activity and signs out after 12 hours regardless of activity. Unlocking after idle, or after a reload, needs the password (a password manager fills it) but not the second factor again. A passkey tap may replace the password for unlocking if the optional passkey unlock is built (§10, Q7). See [Security §5.4](security.md#54-sessions-lock-and-sign-out).
- The desktop app asks for the password at launch, and again after 15 minutes idle or whenever the Mac sleeps or the screen locks. It never stores the password.
- **Security activity** in Settings lists recent sign-ins, failures, lockouts and security changes. After each sign-in, the app shows when and from which device the previous sign-in happened.

## 5. Functional requirements

IDs are referenced by the [implementation plan](implementation-plan.md) and the [acceptance tests](acceptance-tests.md). "Must" is required for the v3.0 release; "should" may slip to a v3.x release with a recorded reason.

### Sign-in and security (FR-AUTH)

| ID | Requirement |
| --- | --- |
| FR-AUTH-1 | The private website and the connected desktop app open the treasury only after a successful User ID + password sign-in and a second factor: a passkey (or authenticator code) on the website, and on the desktop an authenticator code once per install, then that install's device key (§10, Q1). Must. |
| FR-AUTH-2 | The server never receives the password, the master key or the data key; it stores only a slow hash of a derived authentication key. Must. |
| FR-AUTH-3 | Changing the password re-wraps the data key without re-encrypting history, and signs out other sessions. Must. |
| FR-AUTH-4 | Brute-force protections, security headers, session rules and logging rules in [Security](security.md) are implemented and tested. Must. |
| FR-AUTH-5 | The v2.2 access token and passphrase screens are removed after migration. The v2.2 history is re-encrypted and verified before any old file is deleted. Must. |
| FR-AUTH-6 | Local working copies (IndexedDB on the web, the profile file on a connected desktop) are encrypted at rest with the data key. Local-only desktop profiles behave as in v2.2. Must. |
| FR-AUTH-7 | Settings → Security lists active sessions with device label and last use, and can end any of them. Should. |
| FR-AUTH-8 | An **encrypted backup** (`.ptbackup`) protected by a separate backup passphrase is the recovery path for a lost password. The plain JSON backup remains behind a warning. Must. |
| FR-AUTH-9 | **Security activity** view and last-sign-in notice, from the service's security log. Must. |
| FR-AUTH-10 | Snapshot retention as in [Security §5.8](security.md#58-snapshots), with pinned versions. Must. |

### Connected Accounts (FR-CONN)

| ID | Requirement |
| --- | --- |
| FR-CONN-1 | Add, reconnect and remove provider connections from the desktop app; the provider's own site or window collects institution credentials. Must. |
| FR-CONN-2 | Provider credentials (access URLs or access tokens) live only in the encrypted credential vault, never in the database, snapshots, backups, exports or logs. Restoring a backup asks the owner to reconnect. Must. |
| FR-CONN-3 | Create file connections and institution accounts by hand. Must. |
| FR-CONN-4 | Each institution account has a kind, spending-review and snapshot flags, and an optional treasury account or **Shared**. Must. |
| FR-CONN-5 | Status per connection: Active, Needs reconnect, Error (with the provider's reason in plain words), Removed. Must. |
| FR-CONN-6 | Account mappings survive reconnecting, and past reports keep an account's display name after the account or connection is removed. Must. |

### Spending review (FR-REV)

| ID | Requirement |
| --- | --- |
| FR-REV-1 | One open review per calendar month; reviews for different months may be open at once. Must. |
| FR-REV-2 | Gather from providers, from OFX, QFX, QBO and CSV files, and by manual entry for PDF-only accounts; merge repeated gathers by transaction identity without losing classifications. Must. |
| FR-REV-3 | Month membership, signs, pending handling, coverage and dispositions follow [Spending review rules](spending-review-rules.md) exactly. Must. |
| FR-REV-4 | Split a transaction across budget lines, with parts that sum exactly to the transaction amount. Must. |
| FR-REV-5 | Suggest internal-transfer pairs and never pair automatically when more than one candidate matches. Must. |
| FR-REV-6 | Rules suggest dispositions; the owner accepts, edits, creates and reorders rules. Must. |
| FR-REV-7 | Autosave every change to encrypted temporary storage locally and on the service; resume on any signed-in device. Must. |
| FR-REV-8 | Clearing is blocked, with a named and linked reason for each blocker, until [the clear conditions](spending-review-rules.md#8-clearing) hold. Must. |
| FR-REV-9 | Clearing writes the report and deletes the review's temporary data everywhere; **Discard review** deletes it without a report. Must. |
| FR-REV-10 | Keyboard entry: move between rows, accept a suggestion, choose a budget line by typing, split, and mark transfer or exclusion without the mouse. Must. |
| FR-REV-11 | Possible duplicates are flagged and must be resolved before clearing: the same account, date and amount from different sources, or the same account, date, amount and description from one provider under different IDs. Must. |
| FR-REV-12 | Funding-mismatch hints: spending on lines funded by one treasury account but paid from an institution account linked to another. Hints only. Should. |
| FR-REV-13 | Transfer-confirmation hints: a deposit into an institution account linked to a treasury account that matches that account's final transfer in the treasury month. Hints only; the owner marks **Done** on Monthly Reconciliation. Should. |

### Reports and export (FR-RPT)

| ID | Requirement |
| --- | --- |
| FR-RPT-1 | One cleared spending report per month, containing only the data listed in [Spending review rules §9](spending-review-rules.md#9-the-spending-report). Must. |
| FR-RPT-2 | Re-running a cleared month requires confirmation; clearing again replaces the report atomically. Must. |
| FR-RPT-3 | Delete a report with confirmation; audited; undoable in-session. Must. |
| FR-RPT-4 | Export a cleared report to `.xlsx` with the sheets in [Spending review rules §11](spending-review-rules.md#11-excel-export). Must. |
| FR-RPT-5 | Export a working copy with transactions during a review, only after a warning. Should. |
| FR-RPT-6 | Year-to-date planned vs actual per line from cleared reports, naming months without a report. Must. |
| FR-RPT-7 | Reports and their rules round-trip through JSON backup and restore. Must. |

### Assets and liabilities (FR-NW)

| ID | Requirement |
| --- | --- |
| FR-NW-1 | Capture balances for every snapshot account during a review, with capture time and source. Must. |
| FR-NW-2 | Month-end estimates for cash and credit card accounts only, and only when the needed later transactions were gathered. Must. |
| FR-NW-3 | Totals, net worth and change from the previous cleared report. Must. |
| FR-NW-4 | Liability details (APR, minimum payment, due date) from the provider when it supplies them, otherwise from optional fields the owner fills in on the institution account. Should. |

### Interface (FR-UI)

| ID | Requirement |
| --- | --- |
| FR-UI-1 | Reorganize the navigation exactly as in §6, Navigation: static **Budgeting** and **Treasury** section labels, the order shown, and Title Case labels that match each page's title. Must. |
| FR-UI-2 | Add **Budget Analysis** to Budgeting and **Connected Accounts** to Treasury. New pages are announced once on the Dashboard and in their own page header, never with badges inside navigation links. Must. |
| FR-UI-3 | Dashboard: a spending-review panel (latest uncleared month, review state, blockers) and the latest cleared net worth with its date. Must. |
| FR-UI-4 | Every figure in the review and the report drills down: to transactions while a review is open, and to report rows after it is cleared. Must. |
| FR-UI-5 | Visual language as in v2: navy headings, pale blue bands, red only for genuine exceptions, green only for completed actions. Must. |
| FR-UI-6 | Phone width: the review can be completed on a 390 px screen, with tables scrolling inside their panels. Must. |
| FR-UI-7 | Below 760 px wide, the navigation becomes a **Menu** button that shows the current page and opens the same grouped list, replacing the horizontal scroller. Must. |
| FR-UI-8 | Navigation meets the accessibility rules in §6, Navigation. Must. |
| FR-UI-9 | The desktop app enables its browser zoom shortcuts (Cmd + and Cmd −). Should. |

### Public demo (FR-DEMO)

| ID | Requirement |
| --- | --- |
| FR-DEMO-1 | The demo includes fictional sample statement files for the Harper household so visitors can run a complete review. No provider code or keys are included in the demo build. Must. |
| FR-DEMO-2 | The demo explains that the real app connects to institutions through a provider, and that the demo never does. Must. |

## 6. Screens

### Navigation

Decided 2026-09-27 from a design review (information architecture, accessibility and phone layout):

```text
Dashboard
BUDGETING
  Budget and Tax
  Budget Analysis
  Budget History
TREASURY
  Monthly Reconciliation
  Interaccount Debts
  Accounts
  Connected Accounts
────────
Import and Export
Settings
```

- **Static section labels, not collapsible or drop-down menus.** About ten items fit a 13-inch window without scrolling. Collapsing would add a click to pages used every month, hide the new pages, and need saved state; fly-outs depend on hover and fail on touch and keyboard. Revisit if the menu grows past about 15 items, a section passes 6 items, or pages gain a second level; even then, collapse only a rarely used section and keep it open by default.
- **Labels:** Title Case for navigation labels, page titles and the window title, with each label identical to its page title ("and" and "of" stay lowercase). Everything inside a page stays sentence case.
- **Accounts vs Connected Accounts:** the plain noun means the app's own buckets; "Connected" marks real outside accounts. Each page's subtitle says so: *Your treasury buckets, such as HH and PETC* and *Bank, card, brokerage and loan accounts, each mapped to a treasury account*. If the two are still confused in use, rename the new page, not the buckets.
- **Monthly Reconciliation** leads Treasury; it was left out of the owner's list by oversight and stays. Budget Analysis sits above Budget History (plan, compare, archive), as a design reviewer recommended and the owner approved.
- **Style:** a section label is plain text in 11 px, weight 600, uppercase with 0.06 em letter-spacing, colour #9fb2d3 (at least 4.5:1 on navy), with 14 px above and 4 px below; it replaces the divider above its section. One divider remains above Import and Export. The active item keeps its left bar, light fill, white text and bold weight.
- **Accessibility:** one `nav` landmark named "Main"; each section is a list labelled by its visible label, which is plain text, never a heading or button, and never takes focus; Tab visits the links in visual order; exactly one link has `aria-current="page"`; the active state is not shown by colour alone; the rail has its own focus ring (2 px #9fc0ef, inset 2 px) with at least 3:1 contrast on the navy and on the active item; every link is at least 24 × 24 px; labels wrap as a safety net and are never truncated. The rail's product name is not an `h1`, so each page has one `h1`.
- **Phone (under 760 px):** the top bar shows the product name and a **Menu** button whose visible text is the current page (for example "Interaccount Debts"), with `aria-expanded` and `aria-controls`. It opens the same grouped list inline (no overlay or focus trap) with 44 px rows. Escape closes it and returns focus to the button; choosing a page closes it and moves focus to the page's `h1`. It always starts closed, and its state is not saved.

### Sign-in

User ID and password, then a passkey prompt (or an authenticator or recovery code) on the website, or the authenticator code on a new desktop install. One generic failure message for every wrong combination. After repeated failures, a visible wait time. No "forgot password" link; a short line explains that a lost password means restoring an encrypted backup.

### Connected Accounts

Subtitle: *Bank, card, brokerage and loan accounts, each mapped to a treasury account.* One panel per institution: name, provider or **Files**, status, last successful refresh, **Reconnect**, **Remove**. A table of its accounts: name and last four digits, kind, in review, in snapshot, treasury account, active. **Add connection** and **Add file connection** in the page header.

### Budget Analysis

- **Header:** month selector, review state badge (**Not started**, **Gathering**, **Reviewing**, **Ready to clear**, **Cleared**), **Gather**, **Clear month**, **Export**, and a **Discard review** action in a menu.
- **Coverage:** one row per in-scope account: source, window gathered, status, transaction count, last attempt, and the next action.
- **Transactions:** date, account, description, amount, suggested or accepted disposition, rule that matched, and notes. Filters for unclassified, suggested, transfers, excluded, by account and by line. A **Pairs** view for transfer candidates.
- **Summary:** lines grouped by category with planned, actual, over/under and year-to-date; set-aside lines grouped separately; unbudgeted; income vs planned take-home; funding treasury accounts; transfers and exclusions totals.
- **Assets and liabilities:** accounts by kind with balance, as-of time, month-end estimate where available, and totals.
- **Reports:** cleared months with cleared date, planned, actual, net worth, and **Open**, **Export**, **Re-run**, **Delete**.

### Accounts

The existing page, with the subtitle *Your treasury buckets, such as HH and PETC*. It gains a read-only column showing which connected accounts represent each treasury account.

### Settings → Security

Change password; passkeys, authenticator and recovery codes; desktop device keys; active sessions; sign out everywhere; **Security activity**; snapshot retention and pinned versions; the encrypted-backup export; and the service URL on the desktop. The v2.2 **Cloud sync** status panel moves here and loses its token and passphrase fields.

## 7. Platforms

| Capability | Private website | Desktop, signed in | Desktop, local only | Public demo |
| --- | --- | --- | --- | --- |
| Sign-in | Password and passkey; 12-hour session | Password at launch and after lock | None (as v2.2) | None |
| Setup and v2.2 migration | No | Yes | n/a | n/a |
| Treasury, budget, debts, import/export | Yes | Yes | Yes | Yes, fictional |
| Add, reconnect or remove a provider connection | No | Yes | No | No |
| Gather from providers | No | Yes, directly from the app | No | No |
| File-based gather, classify, clear, export | Yes | Yes | Yes | Sample files only |
| Temporary review storage | Encrypted in the browser and on the service | Encrypted on disk and on the service | Local file only (see [Security §5.7](security.md#57-temporary-review-storage)) | Tab session only |
| Windows installer | n/a | Separate track (see the [implementation plan](implementation-plan.md#4-other-tracks)) | Same | n/a |

## 8. What changes from v2.2

- **Kept:** every treasury, budget, payroll, tax, debt, import, export, undo, audit and backup behavior; the snapshot conflict model (whole-database versions, stop on divergence); the public demo's privacy model.
- **Replaced:** the access token and sync passphrase (by User ID, password and server-issued sessions); the passphrase-derived snapshot key (by a random data key wrapped by the password-derived key); the 30-minute tab-session model (by the lock and session rules in [Security](security.md)).
- **Added:** connections, institution accounts, rules, spending reviews, spending reports, balance snapshots; the service's session, second-factor, rate-limit, temporary-review and credential-vault endpoints; security headers and logging; encrypted backups; and a snapshot retention policy. The service does **not** contact providers.
- **Abandoned:** the multi-user and administration design in [v3 ideas](../v3-ideas.md). It is kept there as history only.

## 9. Success measures

- Monthly review of a typical month takes 30 minutes or less after the second month, when rules exist.
- 100% of in-scope transactions for a cleared month have an accepted disposition, and the report's totals equal the sum of its parts to the cent.
- No raw transaction exists anywhere (local stores, service storage, snapshots, logs) after a month is cleared or its review expires. This is tested, not assumed.
- The security requirements in [Security §7](security.md#7-security-requirements) pass in the release gate, including the external checks.

## 10. Open questions for the owner

Each has a recommended default that the plan assumes unless the owner decides otherwise.

| # | Question | Recommended default |
| --- | --- | --- |
| Q1 | Require a second factor? | **Decided 2026-09-27: yes, passkeys.** A passkey tap after the password on the website (authenticator code and recovery codes as fallbacks); on the desktop, an authenticator code once per install, then that install's device key. See [Security §5.3](security.md#53-second-factor). |
| Q2 | Which provider: Plaid, or the non-Plaid option? | **Decided 2026-09-27: Plaid Trial**, with statement files or manual entry for institutions it can't reach. SimpleFIN Bridge stays documented as the fallback adapter. See [Institution data §3](aggregation.md#3-comparison-and-recommendation) and [ADR 0009](../decisions/0009-institution-data-provider.md). |
| Q3 | Institution-specific questions (exact servicers, card products and logins) | Listed in the private coverage notes; they affect the provider plan, not the design. |
| Q4 | How long may an untouched review stay open? | 14 days after its last change, never more than 45 days after it started. |
| Q5 | Should budget lines such as savings funds default to **set-aside** in the summary? | No default by name. The owner marks set-aside lines once; the choice is remembered by line. |
| Q6 | Custom domain for the private site? | **Required before passkeys are registered**, because passkeys are bound to the domain and would have to be re-registered if the Railway hostname changed. |
| Q7 | Unlock after idle or reload with a passkey tap instead of the password? | **Not in v3.0.** The password (autofilled) unlocks; the passkey unlock in [Security §5.4](security.md#54-sessions-lock-and-sign-out) is an optional addition because it adds a stored, escrowed copy of the key. |
| Q8 | Give the encrypted backup its own passphrase? | **Yes.** It is the recovery path for a lost account password, so it must not depend on that password. One more secret for the password manager. |
