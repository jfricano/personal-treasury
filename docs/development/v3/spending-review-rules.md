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
- **A transaction belongs to the month of its posted date.** Posted dates are final once a transaction posts, so each posted transaction belongs to exactly one month and a cleared month cannot gain members later. Authorized or transaction dates are shown for context only.
- **Pending transactions never count.** They are shown for context and cannot be classified. A purchase that is pending at month end belongs to the month in which it posts.
- Dates supplied as calendar dates are used exactly as supplied. Dates supplied as timestamps are converted with the **household time zone**, an IANA zone name stored in `meta` (default: the device zone when the owner first enables v3 features). Changing it affects only data gathered afterwards.
- OFX and QFX dates use their date part (`YYYYMMDD`) as written. CSV files map one column as the posted date; if a file has only one date column, it is treated as the posted date and the import preview says so.
- **Gather window.** A gather requests posted transactions from 7 days before the first day of the month through today, capped at 60 days after the month's last day. Transactions outside the month are **context** only: they support transfer pairing, month-end balance estimates, and late-posting detection (§8).

## 3. Transactions

A gathered transaction has:

| Field | Notes |
| --- | --- |
| `id` | Stable identity. Provider transaction ID, or for files: OFX `FITID`; for CSV, a SHA-256 of account, posted date, amount, normalized description and the occurrence index of identical rows within that file; for manual entry, a random ID. |
| `institutionAccountId` | The institution account it came from. |
| `source` | Provider name; file name, file SHA-256 and row or `FITID`; or `manual` with the entry time. |
| `postedDate`, `authorizedDate?` | ISO dates. |
| `amount` | Canonical signed amount (below). |
| `sourceAmount` | The amount text exactly as received, for traceability. |
| `description`, `merchantName?`, `providerCategory?` | As received. Provider categories are shown but never used unless a rule the owner wrote refers to them. |
| `pending`, `removedAtSource` | Flags. |

**Canonical sign.** From the owner's point of view on that account: **negative is money leaving** (a purchase, withdrawal, fee, interest charged, or payment sent from this account), and **positive is money arriving** (a deposit, refund, credit, or payment received by a card or loan). Each source adapter converts its provider's convention and has fixture tests for every account kind. Where a provider reports positive amounts for outflows, the adapter negates them.

**Exact amounts.** Provider responses are parsed with a lossless JSON parser that keeps numbers as their source text, never through a JavaScript number; file amounts are parsed as text. A value that is not a finite decimal with at most 4 fractional digits is a fatal error for that account's gather, reported with its source location.

**Untrusted text.** Descriptions, merchant names, memos and account names come from outside the owner's control. They are stored and rendered only as text, with control and bidirectional-override characters removed and length capped at 512 characters ([Security §5.5](security.md#55-attack-resistance)).

**Merging repeated gathers.** A later gather updates a transaction with the same `id` (description, pending to posted, amounts corrected at source) and keeps its disposition. If a classified transaction's amount changes, its disposition returns to **suggested** and the change is highlighted. If a source reports a transaction as removed, an unclassified one is dropped; a classified one is kept, flagged **Removed at source**, and must be confirmed by the owner before clearing.

**Possible duplicates.** Provider IDs are not trusted alone; some providers re-issue or repeat them. The owner keeps both or removes one of each flagged set:

- Two transactions from *different sources* (a provider gather and a file import, say) for the same institution account, with the same posted date and amount.
- Two transactions from the *same provider* for the same account, with the same posted date, amount and normalized description but different IDs.

Identical rows within one *file* are distinct by their occurrence index and are not flagged (two identical purchases on one day are real).

## 4. Coverage and completeness

Each institution account with **in spending review** set has one coverage status for the month:

| Status | Condition |
| --- | --- |
| **Complete** | Provider: a successful gather requested a window containing the whole month, **and** it ran at least the settle delay (default 3 days, configurable 0–10) after the month's last day in the household time zone, **and** the provider did not report that its available history starts after the month's first day. Files: the union of imported files' periods covers every day of the month. For OFX/QFX the period is `DTSTART`–`DTEND`; for CSV it is the range the owner confirms in the import dialog (default: the file's first and last dates). Manual entry: the owner confirms the statement period the entries come from, and it covers the month. |
| **Partial** | Some data was gathered, but the condition for Complete is not met. The reason is shown: gathered too early, history starts too late, or a gap between files. |
| **Missing** | Nothing has been gathered for this account. |
| **Needs reconnect** / **Error** | The latest provider attempt failed for that reason. Data gathered earlier still counts toward Partial. |
| **Waived** | The owner waived the account for this month with a reason: *no activity*, *account closed*, *not used this month*, or *data unavailable* (a note is required). An account with posted transactions in the month cannot be waived; those transactions must be classified, and may be excluded. |

A CSV import warns, but does not block, when none of its rows fall within 5 days of either end of the confirmed range, because that can indicate a truncated download.

## 5. Dispositions

Every posted, in-month transaction on an in-scope account has exactly one disposition, in state **suggested** (made by a rule, recording the rule's ID) or **accepted** (by the owner, including bulk acceptance).

| Kind | Meaning | Constraints |
| --- | --- | --- |
| `budget` | Spending, or a refund, against one or more budget lines. | Parts `[{ lineKey, amount }]`. Every part is non-zero and has the transaction's sign; parts sum **exactly** to the transaction amount; every `lineKey` exists in the review's budget version. |
| `income` | Money earned. | Inflow only. `incomeKind` is `take_home` (compared with planned take-home) or `other`. |
| `transfer` | Money moving between the owner's own accounts, including credit card payments. | Optional `pairedId`. Without a pair, `counterparty` is another institution account (out of scope or outside the month) or `own_unconnected`. A payment to another person is not a transfer. |
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

A rule has: position; enabled; a match on the normalized description (`contains`, `starts_with` or `equals`), optionally the merchant name, an institution account, direction (`outflow`, `inflow`, `any`), and an inclusive amount range on the absolute amount; and an action that produces one disposition (a single budget `lineKey`, an income kind, `transfer`, `unbudgeted`, or an exclusion reason).

- **Normalization:** uppercase, trim, collapse runs of whitespace, and replace runs of four or more digits with `#`, so store numbers and reference codes don't defeat a match.
- Rules are evaluated in order and the **first enabled match wins**. They only ever produce **suggested** dispositions.
- A rule whose `lineKey` is absent from the review's budget version suggests nothing and is marked **Stale** on the rules list.
- **Remember this** on a classified transaction creates a rule prefilled from it. On clearing, the app offers rules for descriptions the owner classified the same way two or more times by hand.
- Rules persist in the synced database. They contain description patterns, never amounts from specific transactions unless the owner types a range.

## 8. Clearing

A review can be cleared only when all of these hold. Each unmet condition is listed with a link to its row or account.

1. A **budget version** with full detail is selected for the month (§10.1).
2. Every in-scope institution account is **Complete** or **Waived**.
3. Every posted, in-month transaction on an in-scope account has an **accepted** disposition.
4. Every `budget` disposition satisfies §5, and every `excluded` disposition with reason `other` has a note.
5. No possible duplicate and no **Removed at source** item is unresolved.
6. **Identity check:** Σ canonical amounts of posted, in-month, in-scope transactions = Σ budget parts + Σ income + Σ transfers + Σ unbudgeted + Σ excluded, exactly.

Clearing then:

1. Writes the spending report (§9) and updates the review index in **one database transaction**, replacing any existing report for that month (after the confirmation in the [product spec §4.5](product-spec.md#45-re-running-replacing-and-deleting-reports)). The write is audited and undoable in-session.
2. Records a **tombstone** for the review in `spending_review_sessions` so every device deletes its local copy when it next syncs.
3. Deletes the temporary review data locally and on the service. If the service cannot be reached, the review shows **Cleared; temporary data awaiting deletion** and retries on every start until deletion is confirmed. The service also deletes any review whose tombstone it has been sent.

**Late postings.** When a later month's gather finds posted transactions dated in an already-cleared month, the review shows how many (not their details) and offers to re-run that month. Those transactions are otherwise context only.

## 9. The spending report

A cleared report contains exactly the following, all derived at clearing time from accepted dispositions and the selected budget version. It never contains a transaction's description, merchant, individual amount, date, provider ID, or any credential.

- **Header:** month; cleared time; budget version ID and label (text copy); household time zone; gather window, settle delay and pairing window; app version; count of in-scope transactions; the identity-check totals (Σ inflows and Σ outflows); optional owner note.
- **Lines:** one row for every line in the budget version, including lines with no activity: `lineKey`; category name and line label (text copies); funding treasury account ID and code (text copy); role (`spending` or `set_aside`); planned; actual; transaction count; optional note.
- **Unbudgeted:** actual and count.
- **Income:** planned take-home; actual take-home income; other income; counts.
- **Flows:** count and total for paired transfers, unpaired transfers, and each exclusion reason.
- **Sources:** one row per in-scope institution account: display label (text copy), kind, source (provider name or `file`), gathered window, status (`complete` or `waived`), waiver reason and note, transaction count, Σ inflows, Σ outflows.
- **Balance snapshot:** §12.

Category and funding-account totals are computed from the line rows when shown, using their text copies, so a later rename or budget edit never changes a cleared report.

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

Money cells are numbers formatted to cents. Excel stores doubles; the report in the app remains the exact record ([ADR 0006](../decisions/0006-excel-export.md)). Text cells that begin with `=`, `+`, `-`, `@`, tab or carriage return are written with a leading apostrophe so a spreadsheet never evaluates them. The **working copy** export, available only during a review and only after a warning, adds a **Transactions** sheet with date, account, description, amount, disposition and line.

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
- **Totals:** assets, liabilities and net worth, using the month-end estimate where it exists and the as-of value otherwise, and saying which were used.
- **Change:** compared by institution account with the previous cleared report's snapshot. New and missing accounts are listed.
- **Liability details** (statement balance, minimum payment, APR, next due date, original principal) are stored when the provider supplies them, as Zod-validated fields.
- Interaccount debts are excluded; they are internal to the treasury and sum to zero.

## 13. Schema

Forward-only migrations, numbered after the current version 3. Money is `TEXT` holding normalized decimals, as elsewhere. Every table below is included in the JSON backup and restored in foreign-key order. A treasury workbook import in `replace` mode never touches them.

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `budget_lines.line_key` (new column) | Stable identity of a line across versions, used by rules, settings and reports. | `NOT NULL`; unique per version. **Duplicate** copies it; a new line gets a new key; renaming keeps it. Backfill: lines with the same category and case-insensitive trimmed label across versions share a key. |
| `connections` | One per institution link. Holds **no credential**: credentials live in the encrypted credential vault, keyed by connection ID ([Security §5.6](security.md#56-provider-credentials)). | `provider` ∈ plaid / simplefin / file, where `file` also covers manual entry (see [ADR 0009](../decisions/0009-institution-data-provider.md)); `provider_connection_ref` (not secret); `display_name`; `status`; `last_success_at`; `last_error`; `consent_expires_at`; `removed_at`. |
| `institution_accounts` | One per real account. | FK connection; `provider_account_ref`; `display_name`; `mask` (last four only; never a full account or routing number); `kind`; `in_review`; `in_snapshot`; `treasury_account_id` (nullable FK `accounts`; a separate `shared` flag); optional owner-entered `apr`, `minimum_payment`, `due_day`; `active`; `closed_at`. Unique (connection, provider account ref). |
| `categorization_rules` | Owner's rules. | `position` unique; match fields; action fields with the same constraints as dispositions; `last_used_month`. |
| `spending_line_settings` | Role per line key. | PK `line_key`; `role` ∈ spending / set_aside. |
| `spending_review_sessions` | Index and tombstones of temporary reviews. Contains **no** transaction data. | PK `session_ref` (random 128-bit); `month`; `state` ∈ open / cleared / discarded / expired; timestamps; at most one `open` per month (partial unique index). |
| `spending_reports` | Report header. | `month` unique; totals; budget version ID (`ON DELETE SET NULL`) plus label copy. |
| `spending_report_lines`, `_flows`, `_sources` | Report rows. | FK report `ON DELETE CASCADE`; institution account FK `ON DELETE SET NULL` with a label copy. |
| `balance_snapshots` | Snapshot rows. | FK report `ON DELETE CASCADE`; institution account FK `ON DELETE SET NULL` with label and kind copies; value, as-of, estimate and method, liability detail fields. |

`meta` gains `household_time_zone`, `review_settle_days` and `review_pairing_days`. The database runs with `PRAGMA secure_delete = ON` so deleted pages do not keep remnants.

## 14. Invariants and where they are enforced

| Invariant | Enforcement |
| --- | --- |
| Raw transactions never reach the synced database, snapshots, audit log, backups or treasury exports. | The review store is a separate module with no import from `db/`. A test gathers, classifies and clears a synthetic month, then scans the SQLite file, every uploaded envelope's plaintext, the audit log, a JSON backup and the service's storage for the fixture descriptions and amounts. |
| A review never writes treasury or budget data. | Review services have no path to journal, allocation, debt or budget repositories. Tests assert those tables are byte-identical before and after a gather-classify-clear cycle. |
| Every in-month transaction is accounted for. | Clearing requires the identity check (§8.6); a domain test covers every disposition kind and split. |
| Reports never change after clearing. | Report tables have no update path; re-running replaces the whole report in one transaction. |
| Planned amounts come only from the budget domain. | The report builder calls `computeBudget`; a test compares report planned amounts with `budget.versionView`. |
| Institution accounts and treasury accounts stay distinct. | Separate tables; the link is an optional FK set only by the owner. |
| Provider credentials never enter the database. | No column holds them; the canary scan also searches for a fixture credential. |
| Transfers aren't expenses. | `transfer` has no path into spending totals; a test asserts totals are unchanged when a pair is accepted or unpaired. |

## 15. Treasury hints

Hints are read-only suggestions that link to existing treasury screens. They never write.

- **Funding mismatch** (FR-REV-12): budget spending on lines funded by treasury account A, paid from an institution account linked to a different treasury account B, totalled per (A, B). It links to Monthly reconciliation for a transfer the owner may choose to enter.
- **Transfer confirmation** (FR-REV-13): an inflow into an institution account linked to treasury account A that equals A's final transfer for the same treasury month, while A is still **Pending**. It links to that account's **Done** control using the existing deep link.
