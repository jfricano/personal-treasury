# Spending review rules

Status: approved for implementation · 2026-09-26

This is the calculation and data contract for **Budget vs actual**, the balance snapshot, and their storage. It has the same authority for v3 that [Data model and calculation rules](../data-and-rules.md) has for the treasury. When the product spec and this document disagree, this document wins and the disagreement is a bug in the spec. All money uses `domain/money.ts` (decimal strings, `decimal.js`); nothing here uses binary floating point.

## 1. Principles

1. **Raw transactions are temporary.** They live only in the encrypted temporary review store ([ADR 0010](../decisions/0010-temporary-spending-review.md)) and never enter the synced SQLite database, snapshots, the audit log, Excel exports of the treasury, or JSON backups.
2. **Budget plans come from the budget domain.** Planned amounts are computed with `computeBudget`; nothing re-implements the budget arithmetic.
3. **Transfers aren't expenses.** An internal transfer is never counted as spending or income.
4. **The treasury is read, never written.** A review does not create journal entries, change allocations, confirm transfers or touch debts. It may show hints that link to the treasury screens.
5. **Nothing is silently dropped.** Every posted transaction in the month on an in-scope account gets an explicit, accepted disposition before the month can be cleared, and the totals are checked for exact agreement.
6. **Mappings are explicit.** Institution accounts, budget lines and treasury accounts are linked only by the owner's choices or by rules the owner accepted, never by matching names.

## 2. Months and dates

- A review covers one calendar month, `YYYY-MM`, parsed with the existing `monthKey` schema.
- **A transaction belongs to the month of its posted date.** Posted dates normally stay fixed once a transaction posts, so each posted transaction belongs to exactly one month. Institutions occasionally post a transaction late with an earlier date; §8 detects that in a month's final week. Authorized or transaction dates are shown for context only.
- **Pending transactions never count.** They are shown for context and cannot be classified. A purchase that is pending at month end belongs to the month in which it posts.
- **Deriving the posted date.** Dates supplied as calendar dates are used exactly as supplied. Each adapter documents how it derives a date from a timestamp and proves it with recorded fixtures that include month-end cases. A timestamp at exactly 00:00:00 UTC is treated as a date in UTC, because providers use that form to encode a date. Any other timestamp is converted with the **household time zone**, an IANA zone name stored in `meta` (default: the device zone when the owner first enables v3 features); changing it affects only data gathered afterwards.
- OFX and QFX dates use their date part (`YYYYMMDD`) as written. CSV files map one column as the posted date; if a file has only one date column, it is treated as the posted date and the import preview says so.
- **Gather window.** A gather requests posted transactions from 7 days before the first day of the month through today, capped at 60 days after the month's last day. Adapters split the window where a provider limits request length (SimpleFIN: 90 days). Transactions outside the month are **context** only: they support transfer pairing, month-end balance estimates and late-posting detection.

## 3. Transactions

A gathered transaction has:

| Field | Notes |
| --- | --- |
| `id` | Identity. Provider transaction ID; for files, OFX `FITID`; for CSV, a SHA-256 of account, posted date, amount, normalized description and the occurrence index of identical rows within that file; for manual entry, a random ID. |
| `institutionAccountId` | The institution account it came from. |
| `source` | Provider name; file name, file SHA-256 and row or `FITID`; or `manual` with the entry time. |
| `postedDate`, `authorizedDate?` | ISO dates. |
| `amount` | Canonical signed amount (below). |
| `sourceAmount` | The amount text exactly as received, for traceability. |
| `description`, `merchantName?`, `providerCategory?` | As received, after sanitizing (below). Provider categories are shown but never used unless a rule the owner wrote refers to them. |
| `pending`, `removedAtSource` | Flags. |

**Canonical sign.** From the owner's point of view on that account: **negative is money leaving** (a purchase, withdrawal, fee, interest charged, or payment sent from this account), and **positive is money arriving** (a deposit, refund, credit, or payment received by a card or loan). Each source adapter converts its provider's convention and has fixture tests for every account kind. Where a provider reports positive amounts for outflows, the adapter negates them.

**Exact amounts.** Provider responses are parsed with a lossless JSON parser that keeps numbers as their source text, never through a JavaScript number; file amounts are parsed as text. A value that is not a finite decimal with at most 4 fractional digits is a fatal error for that account's gather, reported with its source location.

**Untrusted text.** Descriptions, merchant names, memos and account names come from outside the owner's control. They are stored and rendered only as text, with control and bidirectional-override characters removed and length capped at 512 characters ([Security §5.5](security.md#55-attack-resistance)).

**Merging repeated gathers.** A later gather updates a transaction with the same `id` (description, pending to posted, amounts corrected at source) and keeps its disposition. If a classified transaction's amount changes, its disposition returns to **suggested** and the change is highlighted. If a source reports a transaction as removed, an unclassified one is removed and the review shows a count of such removals; a classified one is kept, flagged **Removed at source**, and must be confirmed by the owner before clearing.

**Possible duplicates.** Provider IDs are not trusted alone; some providers re-issue or repeat them. The owner keeps both or removes one of each flagged set:

- Two transactions from *different sources* (a provider gather and a file import, say) for the same institution account, with the same posted date and amount. Descriptions often differ between sources, so they are not compared.
- Two transactions from the *same provider* for the same account, with the same posted date, amount and normalized description but different IDs.

Identical rows within one *file* are distinct by their occurrence index and are not flagged (two identical purchases on one day are real).

## 4. Coverage and completeness

Each institution account with **in spending review** set has one coverage status for the month:

| Status | Condition |
| --- | --- |
| **Complete** | Provider: a successful gather requested a window containing the whole month; **and** the source's own freshness time (the provider's last successful update from the institution, when the provider reports one, otherwise the gather time) is at least the settle delay (default 3 days, configurable 0–10) after the month's last day in the household time zone; **and** history is known to cover the month's first day (below). Files: the union of imported files' periods covers every day of the month. For OFX/QFX the period is `DTSTART`–`DTEND`; for CSV it is the range the owner confirms in the import dialog (default: the file's first and last dates). Manual entry: the owner confirms the statement period the entries come from, and it covers the month. |
| **Partial** | Some data was gathered, but the condition for Complete is not met. The reason is shown: data not yet fresh enough, history not confirmed, or a gap between files. |
| **Missing** | Nothing has been gathered for this account. |
| **Needs reconnect** | The latest provider attempt failed because the owner must sign in to the institution again. Data gathered earlier still counts toward Partial. |
| **Error** | The latest provider attempt failed for another reason, shown in plain words. Data gathered earlier still counts toward Partial. |
| **Waived** | The owner waived the account for this month with a reason: *no activity*, *account closed*, *not used this month*, or *data unavailable* (a note is required). An account with posted transactions in the month cannot be waived; those transactions must be classified, and may be excluded. |

**History covers the month** when the provider states its history starts on or before the month's first day, or when the account was linked before the month began and has been gathered since, or when the owner confirms it for that month (the confirmation is recorded on the report's source row). A newly linked account therefore needs one confirmation for its first month.

A CSV import warns, but does not block, when its earliest row is more than 5 days after the start of the confirmed range or its latest row is more than 5 days before the end, because that can indicate a truncated download.

## 5. Dispositions

Every posted, in-month transaction on an in-scope account has exactly one disposition, in state **suggested** (made by a rule, recording the rule's ID) or **accepted** (by the owner, including bulk acceptance).

| Kind | Meaning | Constraints |
| --- | --- | --- |
| `budget` | Spending, or a refund, against one or more budget lines. | Parts `[{ lineKey, amount }]`. Every part is non-zero and has the transaction's sign; parts sum **exactly** to the transaction amount; every `lineKey` exists in the review's budget version. |
| `income` | Money earned. | Inflow only. `incomeKind` is `take_home` (compared with planned take-home) or `other`. |
| `transfer` | Money moving between the owner's own accounts, including credit card payments. | Optional `pairedId`, whose transaction must also be an accepted `transfer` paired back. Without a pair, `counterparty` is another institution account (out of scope or outside the month) or `own_unconnected`. A payment to another person is not a transfer. |
| `unbudgeted` | Real spending, or a refund of it, that no budget line covers. | Either sign. Planned amount is zero. |
| `excluded` | Not household cash flow for this report. | Reason: `reimbursable`, `not_household`, `duplicate_at_source`, `adjustment`, or `other` (note required). |

If the owner changes the review's budget version, any `budget` part whose `lineKey` is missing from the new version becomes unclassified and is listed as a blocker.

**Loan and investment accounts** are out of spending review by default. A payment from checking to a loan is then classified against the budget line that plans it, which is what the budget compares. If the owner puts a loan or investment account in scope, its incoming payments must also be classified, normally as the other half of a transfer; the Connections page warns that this moves the payment out of budget spending.

## 6. Internal transfers and pairing

- **Candidate pair:** an outflow `a` and an inflow `b` on two different institution accounts, both in scope, with `a.amount = −b.amount` exactly, posted within the pairing window (default 5 days, configurable 0–10), neither already paired.
- If exactly one candidate exists for each side, the pair is **suggested**. If several match, all are listed for the owner and none is suggested. Accepting a pair sets both sides to accepted `transfer`.
- A pair may cross the month boundary. Only the in-month side is counted; the other side is context.
- Pairing never changes amounts or dates, and an accepted pair can be unpaired.

## 7. Rules

A rule has: a position; enabled; a match on the normalized description (`contains`, `starts_with` or `equals`), optionally the merchant name, an institution account, direction (`outflow`, `inflow`, `any`), and an inclusive amount range on the absolute amount; and an action that produces one disposition (a single budget `lineKey`, an income kind, `transfer`, `unbudgeted`, or an exclusion reason).

- **Normalization:** uppercase, trim, collapse runs of whitespace, and replace runs of four or more digits with `#`, so store numbers and reference codes don't defeat a match.
- Rules are evaluated in order of position, then creation time, and the **first enabled match wins**. Positions need not be unique, so reordering rewrites only the moved rule. Rules only ever produce **suggested** dispositions.
- A rule whose `lineKey` is absent from the review's budget version suggests nothing and is marked **Stale** on the rules list.
- **Remember this** on a classified transaction creates a rule prefilled from it. On clearing, the app offers rules for descriptions the owner classified the same way two or more times by hand.
- Rules persist in the synced database. A rule's pattern is text the owner chose to keep, so it is not a transaction; rules never hold amounts from specific transactions unless the owner types a range.

## 8. Clearing

A review can be cleared only when all of these hold. Each unmet condition is listed with a link to its row or account.

1. A **budget version** with full detail is selected for the month (§10.1).
2. Every in-scope institution account is **Complete** or **Waived**, and every institution account that first appeared during this review has had its kind and scope confirmed.
3. Every posted, in-month transaction on an in-scope account has an **accepted** disposition.
4. Every disposition satisfies §5: `budget` parts are valid and sum exactly; `income` is an inflow; every `pairedId` points to an accepted transfer paired back; every `excluded` with reason `other` has a note.
5. No possible duplicate and no **Removed at source** item is unresolved.
6. Every account in the balance snapshot has a balance, or the owner has marked its balance **unavailable** for this month.
7. **Identity check:** Σ canonical amounts of posted, in-month, in-scope transactions = Σ budget parts + Σ income + Σ transfers + Σ unbudgeted + Σ excluded, exactly.

Before the owner confirms, the app states that clearing deletes the month's transactions and that **Undo** will restore the previous report but not the transactions.

Clearing then runs in this order:

1. Write the spending report (§9) in **one database transaction**, replacing any existing report for that month after the confirmation in the [product spec §4.5](product-spec.md#45-re-running-replacing-and-deleting-reports). The write is audited and undoable.
2. Wait until the database file is saved. For a connected profile, also wait until the snapshot containing the report is uploaded.
3. Mark the review **cleared** in the review index (which lives in the review store, outside the database), delete the service copy, then wipe local copies.

If step 2 cannot complete, the review stays **cleared, awaiting upload** with its data intact, and the app retries. Deletion is idempotent and repeated on every start until it is confirmed.

**Undo of a clear** restores the database to its state before clearing: the previous report for that month, or none. The review stays cleared and its transactions are not restored, because they have been deleted; the month can be gathered again.

**Late postings.** Each report source row records the count and sum of posted transactions dated in the month's final 7 days (§9). The next month's gather window starts 7 days before its month, so it covers exactly those days. If, for an account, the count or sum it finds differs from the cleared report, the review says how many transactions and how much, without their details, and offers to re-run the earlier month. A late posting dated more than 7 days before the end of a cleared month is not detected; this is a documented limitation.

## 9. The spending report

A cleared report contains exactly the following, all derived at clearing time from accepted dispositions and the selected budget version. It never contains a transaction's description, merchant, individual amount or date, provider ID, or any credential.

- **Header:** month; cleared time; budget version ID and label (text copy); household time zone; gather window, settle delay and pairing window; app version; count of in-scope transactions; the identity-check totals (Σ inflows and Σ outflows); optional owner note.
- **Lines:** one row for every line in the budget version, including lines with no activity: `lineKey`; category name and line label (text copies); funding treasury account ID and code (text copy); role (`spending` or `set_aside`); planned; actual; transaction count; optional note.
- **Unbudgeted:** actual and count.
- **Income:** planned take-home; actual take-home income; other income; counts.
- **Flows:** count and total for paired transfers, unpaired transfers, and each exclusion reason.
- **Sources:** one row per in-scope institution account: display label (text copy), kind, source (provider name, `file` or `manual`), gathered window, status (`complete` or `waived`), waiver reason and note, whether the owner confirmed history, transaction count, Σ inflows, Σ outflows, and the **tail totals** (count and sum of posted transactions dated in the month's final 7 days).
- **Balance snapshot:** §12.

The owner may edit the report's note and its line notes after clearing; those edits are audited and undoable. Nothing else in a report changes. Category and funding-account totals are computed from the line rows when shown, using their text copies, so a later rename or budget edit never changes a cleared report.

## 10. Calculations

### 10.1 Budget version for a month

1. If treasury month `M` exists and has a `budget_version_id`, use that version.
2. Otherwise, use the full-detail version whose effective range contains `M` (`effective_from ≤ M` and `effective_to` is null or `≥ M`).
3. Otherwise, none: the owner must choose a full-detail version. Summary-only versions have no lines and can't be used.

The owner may override the choice before clearing. The report records the version used.

### 10.2 Planned amounts

`computeBudget(takeHome(version), lines(version))` gives each line's planned amount, including the residual line, and the planned take-home. Nothing else computes a planned amount.

### 10.3 Actual amounts and variance

```text
actual(line)       = − Σ amount of budget parts on that line       (outflows count as positive spending)
actual(unbudgeted) = − Σ amount of unbudgeted transactions
income(kind)       =   Σ amount of income transactions of that kind
over(line)         =   actual(line) − planned(line)
status(line)       =   Over     if over ≥ 0.01
                       Under    if over ≤ −0.01
                       On plan  otherwise
used(line)         =   actual / planned, only when planned ≠ 0     (display only)
```

A refund-heavy line can have a negative actual; it is shown as it is.

### 10.4 Totals

```text
planned spending = Σ planned(line) for lines with role spending
actual spending  = Σ actual(line)  for lines with role spending + actual(unbudgeted)
set-aside        = Σ planned and Σ actual for lines with role set_aside, shown as a separate group
income           = planned take-home vs actual take-home income; other income shown separately
```

A line's **role** is stored per `lineKey` in `spending_line_settings` (default `spending`) and copied into the report. Set-aside lines, such as a travel fund or an emergency fund, plan money that is saved rather than spent each month; their actual is the spending drawn from them that month.

### 10.5 Year to date

For month `M` in year `Y` and line key `K`: Σ planned and Σ actual over the cleared reports for months `Y-01` through `M` that contain `K`. The view names the months in that range that have no cleared report. Nothing is estimated for them.

### 10.6 Funding treasury accounts

Planned and actual grouped by each line's funding treasury account. This is the budget-side view of the treasury: how much of each account's monthly allocation was used for its lines.

## 11. Excel export

`export/spendingReport.ts` writes a cleared report to `Spending report YYYY-MM.xlsx`:

| Sheet | Content |
| --- | --- |
| Summary | Month, cleared time, budget version, headline totals, income, coverage summary, net worth. |
| Lines | Category, line, funding account, role, planned, actual, over/under, status, year-to-date planned and actual, count, note. |
| Categories | Planned, actual, over/under by category. |
| Funding accounts | Planned and actual by treasury account. |
| Coverage | One row per source row of the report. |
| Transfers and exclusions | The flow rows. |
| Assets and liabilities | The balance snapshot and totals, with change from the previous report. |

Money cells are numbers formatted to cents. Excel stores doubles; the report in the app remains the exact record ([ADR 0006](../decisions/0006-excel-export.md)). Every text value is written as a string cell, which Excel never evaluates as a formula. The **working copy** export, available only during a review and only after a warning, adds a **Transactions** sheet with date, account, description, amount, disposition and line.

## 12. Balance snapshot

For each institution account with **in balance snapshot** set:

- **Side:** checking, savings, brokerage, retirement and other asset accounts are **assets**; credit cards, loans and other liabilities are **liabilities**.
- **Value:** stored as a signed account value: assets positive; liabilities negative when money is owed, so a card with a credit balance has a positive value. Displays show liabilities as an amount owed.
- **As of:** the provider's balance timestamp, or the gather time if none is supplied. File connections take the balance from OFX `LEDGERBAL` with its date, or from the owner's entry.
- **Month-end estimate:** only for checking, savings and credit cards, and only when posted transactions for the account are gathered for every day after the month's last day through the as-of date:

  ```text
  value at month end ≈ value as of D − Σ amount of posted transactions dated after the month's last day, through D
  ```

  It is labelled **estimate**, because providers differ on whether current balances include pending items. Investment and loan balances are never estimated; they show their as-of date.
- **Totals:** assets, liabilities and net worth, using the month-end estimate where it exists and the as-of value otherwise, and saying which were used. Accounts marked **unavailable** are listed and excluded from totals.
- **Change:** compared by institution account with the previous cleared report's snapshot. New and missing accounts are listed.
- **Liability details** (statement balance, minimum payment, APR, next due date, original principal) are stored when the provider supplies them or the owner has entered them, as Zod-validated fields labelled with their source.
- Interaccount debts are excluded; they are internal to the treasury and sum to zero.

## 13. Schema

Forward-only migrations, numbered after the current version 3. Money is `TEXT` holding normalized decimals, as elsewhere. Every table below is included in the JSON backup and restored in foreign-key order. A treasury workbook import in `replace` mode never touches them.

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `budget_lines.line_key` (new column) | Stable identity of a line across versions, used by rules, settings and reports. | See **Line keys** below. |
| `connections` | One per institution link. Holds **no credential**: `credential_ref` names a credential record in the encrypted vault ([Security §5.6](security.md#56-provider-credentials)); several connections share one record when one provider login covers several institutions (SimpleFIN). | `provider` ∈ plaid / simplefin / file, where `file` also covers manual entry (see [ADR 0009](../decisions/0009-institution-data-provider.md)); `provider_connection_ref` (not secret); `credential_ref` (null for files); `display_name`; `status`; `last_success_at`; `last_error`; `consent_expires_at`; `removed_at`. |
| `institution_accounts` | One per real account. | FK connection; `provider_account_ref`; `display_name`; `mask` (last four only; never a full account or routing number); `kind`; `in_review`; `in_snapshot`; `treasury_account_id` (nullable FK `accounts`; a separate `shared` flag); optional owner-entered `apr`, `minimum_payment`, `due_day`; `csv_profile` (JSON, for CSV mapping); `active`; `closed_at`. Unique (connection, provider account ref). |
| `categorization_rules` | Owner's rules. | `position` (not unique); match fields; action fields with the same constraints as dispositions; `created_at`; `last_used_month`. |
| `spending_line_settings` | Role per line key. | PK `line_key`; `role` ∈ spending / set_aside. |
| `spending_reports` | Report header. | `month` unique; totals; budget version ID (`ON DELETE SET NULL`) plus label copy; `note`. |
| `spending_report_lines`, `_flows`, `_sources` | Report rows. | FK report `ON DELETE CASCADE`; institution account FK `ON DELETE SET NULL` with a label copy; line rows have `note`; source rows have the tail totals and the history confirmation. |
| `balance_snapshots` | Snapshot rows. | FK report `ON DELETE CASCADE`; institution account FK `ON DELETE SET NULL` with label and kind copies; value (nullable when **unavailable**), as-of, estimate and method, liability detail fields and their source. |

There is **no** review-index table: the index of open and cleared reviews lives in the review store, so database undo and restore can never rewind it ([Security §5.7](security.md#57-temporary-review-storage)).

`meta` gains `household_time_zone`, `review_settle_days` and `review_pairing_days`. The database runs with `PRAGMA secure_delete = ON` so deleted pages do not keep remnants.

**Line keys.**

- The migration adds `line_key TEXT NOT NULL DEFAULT ''`, fills every row, then creates a unique index on `(version_id, line_key)` and triggers that reject an empty key on insert and update.
- **Backfill:** within each version, lines are ordered by position, and each line's match identity is its category, its case-insensitive trimmed label, and its occurrence number among lines of that version with the same category and label. Lines in different versions with the same match identity share a key; every other line gets a new random key.
- **Duplicate** copies keys. A new line gets a new key. Renaming a line keeps its key.
- **Budget workbook imports** assign keys to a new version's lines by the same match identity against the most recent existing version, and new keys otherwise.

**Restoring older backups.** A backup records its schema version. Restore creates a database at that version, inserts the rows, and then runs the forward migrations, so a v0.2.2 backup (schema version 3) restores into v3 with line keys backfilled. A test restores a v0.2.2 backup fixture.

## 14. Invariants and where they are enforced

| Invariant | Enforcement |
| --- | --- |
| Raw transactions never reach the synced database, snapshots, audit log, backups or treasury exports. | The review store is a separate module with no import from `db/`. A test gathers, classifies and clears a synthetic month using canary descriptions and amounts that no rule is ever created from, then scans the SQLite file, every uploaded envelope's plaintext, the audit log, the undo snapshots, the safety copies, a JSON backup, the review store and the service's storage. Rule patterns are expected to persist and are outside the scan. |
| A review never writes treasury or budget data. | Review services have no path to journal, allocation, debt or budget repositories. Tests assert those tables are unchanged before and after a gather-classify-clear cycle. |
| Every in-month transaction is accounted for. | Clearing requires the identity check (§8.7); a domain test covers every disposition kind and split. |
| Reports change only by replacement, deletion, or note edits. | Report tables have no other update path; re-running replaces the whole report in one transaction. |
| Planned amounts come only from the budget domain. | The report builder calls `computeBudget`; a test compares report planned amounts with `budget.versionView`. |
| Institution accounts and treasury accounts stay distinct. | Separate tables; the link is an optional FK set only by the owner. |
| Provider credentials never enter the database. | No column holds them; the canary scan also searches for a fixture credential. |
| The review index is never rewound. | It is outside the database; a test performs undo, restore and **Keep device copy** around a clear and checks the index and tombstones. |
| Transfers aren't expenses. | `transfer` has no path into spending totals; a test asserts totals are unchanged when a pair is accepted or unpaired. |

## 15. Treasury hints

Hints are read-only suggestions that link to existing treasury screens. They never write.

- **Funding mismatch** (FR-REV-12): budget spending on lines funded by treasury account A, paid from an institution account linked to a different treasury account B, totalled per (A, B). It links to Monthly reconciliation for a transfer the owner may choose to enter.
- **Transfer confirmation** (FR-REV-13): an inflow into an institution account linked to treasury account A that equals A's final transfer for the same treasury month, while A is still **Pending**. It links to that account's **Done** control using the existing deep link.

## 16. Undo inside a review

Review edits (classifications, splits, pairs, waivers, bulk acceptance) live in the review store, not the database, so the database undo in [ADR 0005](../decisions/0005-undo-audit-persistence.md) does not cover them.

- Each open review keeps its own undo history of its last 100 edits, in memory. **Accept all suggestions** and other bulk actions are one step.
- **Cmd-Z** on Budget vs actual undoes the latest review edit while the review has undo history; anywhere else it undoes the latest database change, as today. The page shows which one the next undo will affect.
- Review undo history does not survive a reload or a switch to another device; the review's saved state does.
- Database actions on the page (clearing, deleting or replacing a report, rule changes, line roles) use the database undo.
