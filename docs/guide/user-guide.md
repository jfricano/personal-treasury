# Personal Treasury User Guide

Personal Treasury helps you plan where your household's income goes, reconcile the money allocated to each account bucket, and track what those buckets owe one another. Budget Analysis adds a separate monthly review of actual spending and real account balances.

This guide covers **v3 preview 0.3.0-preview.1**. The preview is available for local evaluation; provider connections and private access still have release acceptance work outstanding. The published demo may show the earlier interface. For that version, use the [v2 user guide](user-guide-v2.md). See [Getting started](getting-started.md) for installation and the [preview walkthrough](../development/v3/preview-status.md) for running the v3 demo.

All household names and examples below are fictional. Buttons and field names appear in **bold**.

## Find the instructions you need

- [Understand your treasury](#understand-your-treasury)
- [Set up your household](#set-up-your-household)
- [Plan and update your budget](#plan-and-update-your-budget)
- [Run monthly reconciliation](#run-monthly-reconciliation)
- [Track interaccount debts](#track-interaccount-debts)
- [Set up connected accounts](#set-up-connected-accounts)
- [Review actual spending](#review-actual-spending)
- [Use private access and sync](#use-private-access-and-sync)
- [Back up and restore](#back-up-and-restore)
- [Correct mistakes and resolve problems](#correct-mistakes-and-resolve-problems)

## Understand your treasury

A **treasury account** is a money bucket with a purpose, such as Household, Travel or Long-term savings. A **connected account** is a real checking, savings, card or other institution account. Several buckets can share one real account; linking an institution account to a bucket provides context for classification.

The app has three related workflows:

| Workflow | What you do | What it changes |
| --- | --- | --- |
| Budget planning | Plan monthly pay, deductions, withholding and allocations. | A budget version used to fund treasury buckets. |
| Monthly reconciliation | Adjust allocations with bucket-to-bucket transfers, then confirm the final transfers. | That month's cash allocation and completion state. |
| Budget Analysis | Review statement activity against budget lines and record account balances. | A spending report and balance snapshot. |

Interaccount debts record borrowing between buckets. They are separate from credit cards and loans shown under **Assets and liabilities**.

**The app records plans and activity; it does not move money at your bank.** Marking a transfer Done records your confirmation. Importing a statement or classifying a purchase does not create a monthly journal entry or change the budget.

### Find your way around

| Screen | Use it for |
| --- | --- |
| **Dashboard** | See the selected treasury month, outstanding transfers, review items and spending-review status. Click a summary to open its detail. |
| **Budget and Tax** | Create and edit budget versions, payroll inputs and tax rules. |
| **Budget History** | Compare versions and see which treasury months use them. |
| **Monthly Reconciliation** | Create months, enter bucket transfers, check totals and confirm completion. |
| **Interaccount Debts** | Create loans between buckets and record payments or adjustments. |
| **Accounts** | Name, reorder and archive treasury buckets. |
| **Connected Accounts** | Set up real accounts for statement reviews and balance snapshots. |
| **Budget Analysis** | Check coverage, classify transactions, review results and retain reports. |
| **Import and Export** | Import supported workbooks, export records and restore JSON backups. |
| **Settings** | Manage review defaults, safety copies and audit history; private sessions also show security and encrypted sync. |

On a phone, use the navigation menu and scroll wide tables horizontally inside their panels.

### Practise with the demo

The demo uses the Harper household. **Take the tour** explains the screens; **What to try** lists exercises. **Reset sample data** restores the example treasury and **Start blank** opens an empty example. Both discard temporary spending reviews. Demo data belongs to the browser tab and disappears when it closes.

In the v3 demo, **Budget Analysis → Try a sample review** opens a fictional August review with checking and card activity. It is a useful way to practise classification before using your own statements.

## Set up your household

Choose either workbook import or manual setup. Create the treasury buckets and budget before starting your first month. Connected Accounts is an additional setup step when you want to review actual spending.

### Import existing workbooks

Import the treasury workbook first, then the budget workbook. Imports read the source files without changing them.

1. Open **Import and Export → Import treasury workbook → Choose workbook…**.
2. Review the control comparison and warnings. Controls compare the workbook's displayed totals with values recalculated by the app; warnings identify questionable source sheets and cells.
3. If the current profile already has data, review the **Replace the data** checkbox carefully. Treasury import replaces its months, transfer journal and debt history, and saves a safety copy first. Export a backup beforehand if you need a separate recovery file.
4. Choose **Commit import**. A fatal structural problem blocks the import; a failed commit rolls back. **Report (Markdown)** and **Report (JSON)** save the treasury import report.
5. Under **Import budget workbook**, choose **Choose budget workbook…** and review the plan and controls.
6. Leave **Make the workbook's current plan the active budget** selected if you want to use it immediately. Existing tax rules for the same year are kept unless you select **Replace existing tax rules for the same year**. Choose **Commit budget import**.

Budget import leaves treasury months, transfers and debts unchanged. Historical treasury months import as closed, with the newest month open. Their **Archival** badge means they preserve workbook history without a link to a budget version. Older budget workbooks may supply summary-only versions; those cannot be used as full plans for a spending review.

For supported spreadsheet layouts, see [Workbook import](../development/workbook-import.md).

### Start from an empty treasury

1. Open **Accounts**, enter a name in **New account name**, and choose **Add account** for each bucket.
2. Open **Budget and Tax → New empty draft**. Give the draft a useful label.
3. Enter monthly gross pay, payroll deductions and actual withholding from your pay stub.
4. Under **Planned allocations**, use **Add category** and **+ Line** to enter each purpose, monthly amount and **Funded by** bucket. Use **Remainder** for a line that receives take-home pay left after the other lines.
5. Review **Funding by treasury account** and resolve any budget issues. Choose **Activate…**, select **In effect from**, and activate the plan.
6. Open **Monthly Reconciliation → New month**, check the month and **Start from → Active budget**, then choose **Create month**.

On **Accounts**, edit names and descriptions, reorder with the arrows, and clear **Active** to archive a bucket. Archiving retains its history. Accounts referenced by budgets, months, transfers or debts cannot be deleted. **Mark reviewed** acknowledges an imported unknown account after you have checked it.

## Plan and update your budget

A budget is a monthly plan. New treasury months take a copy of its take-home pay and funding totals.

### Enter pay and allocations

**Pay and payroll deductions (monthly)** uses monthly amounts. Enter deductions as positive amounts and an employer credit as a negative amount. Formula deductions use a rate and an exclusion from gross pay. The **Fed**, **CA** and **FICA** flags tell the estimate which wage bases a deduction reduces; match these inputs to your payroll treatment.

Enter **Actual withholding** from the pay stub. The app calculates:

**Take-home pay = gross pay − deductions − actual withholding.**

Each allocation line has a category describing its purpose and a **Funded by** bucket. Several lines can fund the same bucket. A remainder line receives take-home pay minus the other lines. Review the funding totals before starting a month; missing funding or an oversubscribed plan needs attention.

### Change a plan without rewriting history

1. Open the current version in **Budget and Tax** or **Budget History**.
2. Choose **Duplicate** and edit the new draft.
3. Choose **Activate…** and set its effective month. The previous active version becomes Archived.
4. For an already-open treasury month, review the budget-change banner and use **Review and refresh…** if the month should use the new plan.

Using a budget in a treasury month locks its amounts. Duplicate it to change allocations or payroll. Its label, dates, notes and tax year remain editable. Summary-only historical versions are read-only; active versions and versions used by treasury months cannot be deleted.

### Read the tax estimate

The estimate compares projected annual federal, California, Social Security and Medicare amounts with actual withholding. It uses the version's **Tax year for estimate** and the editable rule tables under **Tax rules**. The model supports a single filer and does not replace your actual withholding or change take-home pay.

A provisional notice identifies rules copied from another year. To prepare a new year, **Copy** an existing year's rules, update the values and source information, and **Save** each section. Copying does not establish that the rules are current.

## Run monthly reconciliation

Use this workflow when allocating the month's available cash among your treasury buckets.

### Create and check the month

Open **Monthly Reconciliation → New month**. Check the proposed month and choose **Active budget** under **Start from**. Leave **Expected cash** blank to use the budget's take-home pay, or enter the amount you intend to allocate. You can also duplicate a prior month's allocations, start blank, or use an existing legacy template.

The new month contains planned allocations and a badge naming its budget. Creating it does not create journal transfers. Click the budget badge to inspect the source plan.

### Record changes between buckets

In the entry row at the bottom of **Transfer journal**, enter **Date**, optional **Loan ID**, **Description**, **From**, **To**, a positive **Amount**, and optional **Notes**. Tab between fields and press Enter to save; Escape clears the row.

**From** decreases and **To** increases. For example, reallocating $100 from Travel to Household reduces Travel's final transfer by $100 and increases Household's by $100. A normal transfer needs two different accounts and an amount greater than zero.

Use **Advanced entry** for multiple signed postings. Negative postings decrease a bucket, positive postings increase it, and the entry must balance to zero. Imported unbalanced entries remain visible for correction rather than being silently removed.

### Check the final transfers

Each account's amount is:

**Final transfer = budget allocation + transfers in − transfers out.**

For example, a $500 allocation with $75 coming in and $100 going out produces a $475 final transfer. These are illustrative amounts, not the demo's fixed balances.

The **Reconciliation** panel checks that allocations and final transfers equal expected cash, journal postings balance, entries are valid and no final transfer is negative.

| Status | Meaning | Next step |
| --- | --- | --- |
| **Review** | One or more checks fail. | Read the named issues and inspect the affected amounts or journal rows. |
| **Ready to transfer** | Calculation checks pass; confirmations remain. | Make the intended transfers outside the app and confirm them. |
| **Complete** | Checks pass and every required transfer is Done. | Review notes, close the month and back up. |

Click a bucket name in **Account transfer summary** to filter its journal entries; use **Clear filter** to return to the full journal. Zero final transfers show **Not required**.

### Confirm and close

After completing each real transfer, set **Transferred? → Done** in the account summary, or use the Dashboard's completion controls. Choose **Close month** when finished. Closing makes the month read-only; **Reopen month** allows corrections. Closing a month in Review requires a reason and retains the recorded exception; it does not resolve the failed checks.

Use the month selector or **Past months** to inspect earlier months. If you change amounts after confirming a transfer, check the new final amount and its completion state yourself.

### Handle one month differently

Editing expected cash or a budget-driven allocation creates a manual override for that month. It does not change the budget.

When a new plan differs from an open month, **Review and refresh…** previews the changes. Overrides are retained unless you select **Also replace my manual overrides**. A refresh resets changed Done lines to Pending. Closed months cannot refresh, and imported archival months are not linked to budgets.

## Track interaccount debts

Open **Interaccount Debts** to see borrowing between buckets. Each **Loan ID** has an opening record and a dated event history. The app calculates prior and remaining balances from those events.

### Create a loan

Choose **New debt**, then enter a unique **Loan ID**, **Opened date**, **Description**, **Debtor account (owes)**, **Creditor account (is owed)**, a positive **Opening amount**, and optional terms. Check the direction shown before saving. For later activity, use the same loan's payment or adjustment controls.

### Record a payment or adjustment

1. Click the Loan ID to inspect its history, then choose **Record payment**.
2. Enter the event date and a positive **Payment amount**.
3. Read the preview of the signed change and resulting balance, then choose **Save payment**.

A payoff removes the loan from the non-zero summary, but its history remains. An overpayment reverses who owes whom. If Travel owes Long-term savings $300 and pays $400, Long-term savings now owes Travel $100.

**Advanced: signed adjustment** lets you enter a change directly. Positive changes increase what the original debtor owes; negative changes reduce it. Event dates matter, including when inserting an earlier payment.

### Record a monthly transfer on a loan

Entering a Loan ID in a monthly journal row does not automatically post a debt event. When the row matches an existing loan and moves money between its two buckets, **Record on Loan …** shows the signed change. Choose it once to post the linked event.

A payment recorded directly on the debt screen does not create a monthly journal transfer. Avoid recording the same payment both directly and through the journal. If you edit or delete a linked journal entry, inspect the debt history too: deleting the journal entry leaves the debt event in place.

### Find balances and review history

The summary counts each loan's latest balance once and excludes balances below one cent in absolute value. **Debt detail** also offers **All**, **Paid**, **Credit** and other filters. Click **Net by account** amounts to inspect contributing loans.

Notes containing “canceled” flag a review question; they do not cancel an outstanding balance. In a loan's event history, **Correct** changes an event and **✕** deletes it. For settled history, an explanatory adjusting event can preserve a clearer record than rewriting the original activity.

## Set up connected accounts

Connected Accounts supplies real accounts to Budget Analysis; treasury bucket setup remains on Accounts.

1. Open **Connected Accounts**. Under **Add a statement connection**, name the institution or file group and choose **Add file connection**.
2. Choose **Add account** within the connection.
3. Enter its display name, optional last four digits and **Account kind**.
4. Select **In spending review** for accounts whose posted activity you will classify. Select **In balance snapshot** for accounts whose balances belong in assets and liabilities.
5. Choose a **Treasury bucket** when useful, or keep **Shared / no link**, then choose **Save account**.

A bucket link supplies funding hints; you still choose the purchase's classification. Be deliberate about including loans or investment accounts in spending review: their incoming payments can become internal transfers when both sides are present. Accounts can be included in balance snapshots without including their activity in spending review.

The preview exposes Plaid linking and gathering only in the signed-in desktop app. Its provider lifecycle has not yet been validated for release. Use the statement workflow for this walkthrough; browser and demo builds support statements and manual entry. Removing a connection leaves existing reports intact and removes its accounts from future reviews.

## Review actual spending

Use Budget Analysis after a month's posted activity is available. **Clear month** here finishes a spending review; **Close month** in Monthly Reconciliation finishes cash allocation. These are separate actions.

### Start and check coverage

1. Open **Budget Analysis**, choose **Review month**, then **Start review**.
2. Check **Budget version**. Choose a full-detail plan appropriate to the month; summary-only imported history cannot supply its budget lines.
3. On **Coverage**, bring in activity for every included account. Each needs complete monthly coverage or an explicit waiver.

**Import statement** accepts CSV, OFX, QFX and QBO. For CSV, map the date, description and amount columns, choose the sign convention, and specify the actual statement period. Choose **Preview statement**, check the rows, then **Confirm and import**. A file containing some transactions is not evidence that it covers the whole month; use additional statement periods when needed. Importing the exact same file into a review again is rejected.

For PDF-only sources, use **Manual entry**. Enter posted dates, descriptions and signed amounts, then choose **Confirm the entire month is entered** only when you have entered the complete month. **Waive account** requires a reason and note. An account with posted activity cannot be waived to bypass classification.

Provider coverage also considers freshness, settlement delay and history confirmation. **Settings → Spending review defaults** sets the household time zone, provider settle delay and transfer pairing window. New reviews capture these defaults; existing reviews and reports keep their original settings.

### Classify posted transactions

![Fictional checking and card transactions in the v3 review](../screenshots/v3/transactions.png)

Open **Transactions** and use **Needs classification**, search and account filters to work through the list. Pending activity is not classified as posted spending. Choose **Classify** on each posted row:

| Classification | Use it for |
| --- | --- |
| **budget** | A purchase or refund assigned to a budget line. |
| **income** | Take-home pay or other income. |
| **transfer** | Movement to another account you own outside the review. Pair the rows instead when both sides are present. |
| **unbudgeted** | Spending without a matching planned line. |
| **excluded** | Activity intentionally left out, with a reason and note. |

Review the selection and choose **Accept classification**. Only accepted classifications count in the working summary; suggestions still need review.

For **budget**, keep the transaction's sign: a purchase normally has a negative amount and a refund a positive amount. A refund assigned to the original budget line reduces its actual spending.

For a mixed purchase, use **Add split part**. The signed parts must add to the transaction amount. For example, split a −$120 purchase into −$80 for Household supplies and −$40 for another relevant line.

### Pair transfers and resolve duplicates

When checking and card statements both contain a card payment, pair the outgoing payment with its incoming counterpart using **Pair** on the transaction list. This accepts the reciprocal transfer rather than counting the card payment as a second purchase. Candidates use different accounts, opposite matching amounts and the review's pairing window. Suggested pairs still require your choice.

A possible-duplicate flag asks you to inspect the source rows. Exclude an actual duplicate with the duplicate reason, or confirm that similar rows are distinct. Do not remove a genuine purchase merely because its amount and date resemble another.

### Remember classifications

**Remember this** on a classified transaction lets you save a chosen description pattern as a rule. **Rules** lets you edit matching criteria, direction, action and priority.

**Apply rules** creates suggestions. Review them individually, or filter the list and use **Accept visible suggestions** for the visible rows you have checked. Rules do not accept transactions automatically. A stale rule pointing to a missing budget line needs correction. Split purchases must be reviewed individually; a remembered budget rule chooses one line.

Rule patterns remain in the database after transaction details are deleted. Save only the description text you want to retain.

### Review spending and balances

On **Summary**, compare planned and actual amounts by budget line, category and funding bucket. Click a line to inspect its transactions while the review is open. **Remaining** is planned spending minus actual spending; it is not a bank balance.

Under **Line roles**, explicitly mark savings or other provisions as **Set-aside** when appropriate. Set-asides are shown separately from spending totals. The app does not infer this role from a line's name.

On **Assets and liabilities**, check each included account's balance and **As of** date. Use positive values for assets, negative values for money owed, and a positive value for a card credit balance. Mark a missing balance **Unavailable this month** instead of entering zero. Review whether the report labels a value as an as-of balance or a month-end estimate. Its net worth reflects the included available balances.

Optional liability fields include statement balance, minimum payment, APR, due date and original principal. These entries belong to this review. Year-to-date spending uses cleared reports and lists missing months; it does not invent results for unreviewed months.

### Clear and retain the report

1. Read the **items before clearing** list on Summary and resolve each blocker, including coverage, classifications, duplicates, transfer pairs and reconciliation.
2. Check balances, line roles and notes. If you want to keep individual transaction details, use **Export working copy** before clearing. That export includes descriptions and amounts.
3. Choose **Clear month** and read the confirmation. The app saves the report, then deletes the review's temporary transactions.
4. Open **Reports** to inspect the retained totals, coverage, balances and notes. **Export report** produces an aggregate Excel report.

**Undo cannot recover transaction details deleted by clearing, discarding or expiry.** After clearing, the report retains aggregates rather than a list of purchases. To correct it later, start the month again, bring in source activity and clear a replacement report. The previous report stays visible until the replacement is cleared.

Up to three reviews can remain open. Temporary reviews expire after 14 days without an edit or after 45 days from creation, whichever comes first. **Keep open** renews the idle period but cannot extend the maximum age. Cleared reports remain; a complete treasury backup does not include temporary review transactions.

If completion says **awaiting upload**, reconnect and use **Retry completion**. Do not treat the review as fully finished until persistence and deletion complete. A late-posting notice compares aggregate changes in the preceding month's final seven days; it does not detect every possible correction. Re-run the affected month when needed.

## Use private access and sync

The v3 private app uses a User ID, password and second factor. On the private website, enter your credentials, choose an enrolled passkey, authenticator code or one-use recovery code, and finish verification. The desktop app can use its registered device factor after initial enrollment. Reloading an authenticated website asks for the password to unlock its encrypted local copy.

**Settings → Security → Lock now** hides the treasury and ends the unlocked session. The preview locks after 15 minutes without input. **Log out** ends sign-in; a later unlock or sign-in does not delete the local treasury.

Settings also provides passkey registration, recovery codes, authenticator replacement, session/device revocation and security activity. Sensitive changes require fresh verification through **Verify for sensitive changes**. Password changes are available in the desktop app. Recovery codes address a missing second factor; they cannot recover a forgotten encryption password.

### Switch devices and resolve conflicts

Check **Settings → Encrypted cloud sync** and choose **Sync now** before switching devices. Temporary reviews have a separate **Review sync** panel in Budget Analysis; check that status too.

For a treasury conflict, **Use cloud copy** saves an encrypted device safety copy before adopting cloud data. **Keep device copy** makes the device's treasury current while preserving the previous cloud version in history. **Restore** on a cloud version makes it a new current version.

For a temporary-review conflict, **Keep device copy** or **Use cloud copy** replaces the other review copy and its classifications. **Keep both copies** preserves them separately when a review slot is available; it does not merge them. If another device deleted a review, an old copy cannot resurrect its transaction details.

An already-enrolled desktop can unlock an existing local copy offline. Sync, clearing reviews, institution connections and security management require an online sign-in. Follow the on-screen saved and sync statuses before leaving the app.

The [cloud sync guide](cloud-sync.md) describes the older v2 token-and-passphrase flow. It is not the v3 sign-in procedure. Deployment and migration requirements are in the [preview status](../development/v3/preview-status.md).

## Back up and restore

Choose the export that matches what you need to recover:

| Export | Where | What it preserves |
| --- | --- | --- |
| **Complete JSON backup** | Import and Export | Exact decimals and persistent treasury records, budgets, rules and cleared reports. Temporary review transactions and provider credentials are excluded. The file is not encrypted. |
| **Export encrypted backup** | Settings → Encrypted backup in a signed-in v3 session | Persistent backup data encrypted with a separate backup passphrase. Temporary review transactions are excluded. |
| **Excel workbooks** | Import and Export | A treasury workbook and, when an active budget exists, a current-budget workbook. The budget workbook does not preserve the full version history. |
| **Export report** | Budget Analysis → Reports | A cleared spending report with aggregate results. |
| **Export working copy** | An open Budget Analysis review | The working report plus transaction details you explicitly choose to retain. |
| Journal or debt CSV | Monthly Reconciliation or Interaccount Debts | The selected month's postings or debt events for the current debt filter. |

Backups retain connection metadata, but provider credentials and sign-in recovery codes need their own recovery plan.

Keep recovery files outside the device or service they protect. Cloud history and local safety copies cannot recover a lost service volume or device by themselves.

### Make an encrypted recovery backup

In a private v3 session, open **Settings → Encrypted backup**, enter and repeat a separate passphrase of at least 15 characters, then choose **Export encrypted backup**. Save the `.ptbackup` file and its passphrase somewhere you can recover independently of the sign-in password.

To restore, enter the backup passphrase, choose **Restore encrypted backup**, select the file and review the replacement confirmation. The app saves a safety copy, restores persistent data locally and leaves temporary review history unchanged. Sync afterward to make the restored treasury current on other devices.

### Restore JSON or a local safety copy

Open **Import and Export → Restore JSON backup → Choose backup…** and inspect the preview. In the local app, **Restore into new profile** lets you inspect the backup separately. **Replace current profile…** replaces the open treasury after confirmation and saves a safety copy first. The demo replaces its tab's data; private access uses one signed-in profile, so use its encrypted restore controls.

Under **Settings → Safety copies**, choose **Restore** beside a copy. The current treasury is saved as another safety copy before replacement. Safety copies and persistent backups do not restore discarded temporary transactions.

## Correct mistakes and resolve problems

Most editable cells save with Enter or when focus leaves the field. An amber outline means an edit is still pending; Escape reverts it. Journal rows and dialogs use their own Save or Accept action. **Undo** or Command-Z on Mac, Ctrl-Z elsewhere, reverses available edits in the current session when focus is outside an input. **Undo review edit** reverses temporary-review edits separately. Neither is a long-term backup.

| Problem | What to check |
| --- | --- |
| A treasury month shows Review | Read each named check. Allocation totals and final transfers must match expected cash, and every journal entry must be valid and balanced. |
| A final transfer is negative | Click the bucket to inspect transfers out and its allocation. Correct the underlying entries or plan; marking it Done does not fix the amount. |
| A month or budget amount cannot be edited | Reopen a closed month, or duplicate a locked/archived budget into a draft. |
| A debt remains after a payment | Check the loan's event history and date. A journal Loan ID alone does not post a payment; a canceled note does not zero the balance. |
| Budget Analysis shows no actual spending | Choose a full-detail budget and accept classifications. Suggestions and unclassified activity do not count in the working totals. |
| Clear month is disabled | Follow the blocker list. Check full-month coverage, accepted classifications, duplicate decisions and reciprocal transfer pairs. Private offline sessions cannot clear. |
| A card payment appears as extra spending | Pair both statement sides when present; classify the underlying card purchases to their budget lines. |
| An open review disappeared | Check for expiry or deletion on another device. Start a new review from source activity; normal backups cannot recover its temporary rows. |
| Sync needs a choice | Review the device and cloud copies before choosing. Treasury and temporary reviews have separate conflict controls. |
| An import fails | Check whether you chose the matching treasury/budget import and a supported layout. Inspect fatal warnings and source locations. |

Use **Settings → Audit log** to inspect recent persistent changes and the import reports to trace source cells. When correcting settled history, add a clear note explaining the change.
