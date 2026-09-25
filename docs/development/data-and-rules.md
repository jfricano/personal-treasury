# Data Model and Calculation Rules

## Money representation

Store monetary values as normalized decimal strings and calculate with `decimal.js` or an equivalent decimal type. Do not store or calculate money using JavaScript `number` values.

Imported workbook values may contain more precision than cents. Preserve the source decimal value. Display currency to two decimals unless an import or diagnostic view explicitly shows source precision. Use an absolute tolerance of `0.01` dollars for reconciliation and zero-balance tests unless the user later makes the tolerance configurable.

## Proposed SQLite schema

The exact SQL may evolve, but the relationships and constraints must remain.

### `accounts`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text primary key | UUID. |
| `code` | text unique not null | Canonical user-defined code. Preserve opaque meaning. |
| `display_name` | text nullable | Never invent during import. |
| `description` | text nullable | PETC source note belongs here. |
| `color` | text nullable | UI preference. |
| `sort_order` | integer not null | Stable user order. |
| `active` | integer not null | Boolean. Archived accounts remain referentially valid. |
| `created_at`, `updated_at` | text not null | ISO timestamps. |

### `account_aliases`

| Column | Type | Rule |
| --- | --- | --- |
| `alias` | text primary key | Normalized comparison key. |
| `account_id` | text not null | References accounts. |
| `original_text` | text not null | Source spelling retained. |

Seed observed aliases: `Splurge` to `SPLG`; `Petc.` to `PETC`; plus any workbook-specific aliases in the gitignored `reference/seed-aliases.json`. Matching trims surrounding whitespace and compares case-insensitively. The alias table is editable.

### `allocation_profiles`

Reusable current or historical sets of default allocation amounts.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text primary key | UUID. |
| `name` | text not null | Example: Current allocations. |
| `expected_cash` | text not null | Decimal string. |
| `effective_from` | text nullable | ISO date. |
| `active` | integer not null | At most one default profile. |

### `allocation_profile_lines`

Composite uniqueness on profile and account. Amount is a decimal string.

### `monthly_cycles`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text primary key | UUID. |
| `month` | text unique not null | `YYYY-MM`. |
| `expected_cash` | text not null | Decimal string. |
| `notes` | text nullable | User notes. |
| `closed_at` | text nullable | Lifecycle lock; computed status remains separate. |
| `source_import_run_id` | text nullable | Provenance. |

### `monthly_allocations`

One row per month/account, unique on both.

| Column | Type | Rule |
| --- | --- | --- |
| `monthly_cycle_id` | text not null | Parent month. |
| `account_id` | text not null | Account. |
| `budget_amount` | text not null | Decimal string. |
| `transfer_state` | text not null | `pending`, `done`, or `not_required`. |
| `notes` | text nullable | Per-account monthly note. |

### `journal_entries`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text primary key | UUID. |
| `monthly_cycle_id` | text not null | Parent month. |
| `entry_date` | text nullable | ISO date; legacy imports may be month-only. |
| `loan_id` | text nullable | User-visible link; not necessarily a foreign key until resolved. |
| `description` | text nullable | Entry description. |
| `notes` | text nullable | Entry note. |
| `source_kind` | text not null | `user`, `normalized_workbook`, or `legacy_matrix`. |
| provenance fields | text nullable | Workbook, sheet, range, import-run ID. |

### `journal_postings`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text primary key | UUID. |
| `journal_entry_id` | text not null | Parent entry. |
| `account_id` | text not null | Account. |
| `amount` | text not null | Signed decimal. Negative decreases; positive increases. |
| `position` | integer not null | Stable source order. |

An ordinary transfer of $100 from HH to PETC is one journal entry with postings `HH -100` and `PETC +100`.

### `debts`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text primary key | UUID. |
| `loan_id` | text unique not null | Preserve as text even when numeric-looking. |
| `opened_date` | text not null | ISO date. |
| `description` | text nullable | Originating description. |
| `origin_debtor_account_id` | text not null | Direction when balance is positive. |
| `origin_creditor_account_id` | text not null | Direction when balance is positive. |
| `terms` | text nullable | Originating terms/notes. |
| provenance fields | text nullable | Source workbook location. |

### `debt_events`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text primary key | UUID. |
| `debt_id` | text not null | Parent debt. |
| `event_date` | text not null | ISO date. |
| `sequence` | integer not null | Preserves workbook row order for same-date events. |
| `change_amount` | text not null | Signed decimal relative to origin direction. |
| `description` | text nullable | Payment or adjustment description. |
| `notes` | text nullable | Event note. |
| `journal_entry_id` | text nullable | Optional explicit link. |
| provenance fields | text nullable | Workbook, sheet, row, import-run ID. |

### `import_runs` and `import_warnings`

Store filename, content hash, started/completed time, schema recognizer version, committed state, counts, control comparisons, warning severity, source location, message, and resolution state. A matching file hash should trigger a duplicate-import warning.

## Monthly calculations

For each journal entry:

```text
entry_difference = sum(posting.amount)
entry_is_balanced = abs(entry_difference) < 0.01
```

For each account in a month:

```text
transfers_in  = sum(positive postings for account)
transfers_out = abs(sum(negative postings for account))
net_postings  = sum(all postings for account)
final_transfer = budget_allocation + net_postings
```

This is equivalent to the spreadsheet formula:

```text
final_transfer = budget_allocation + transfers_in - transfers_out
```

Month controls:

```text
allocation_difference = sum(budget_allocation) - expected_cash
journal_difference = sum(all journal postings)
final_transfer_difference = sum(final_transfer) - expected_cash
invalid_entry_count = number of entries that fail entry validation or balance
negative_transfer_count = number of account final_transfer values < -0.01
```

Normal two-account transfer validation:

- From account is required.
- To account is required.
- From and To accounts differ.
- Amount is strictly greater than zero.
- The generated postings sum to zero.

Imported multi-posting entries are valid when they contain at least two postings and balance within tolerance. Unbalanced legacy rows remain imported with a Review warning; do not invent a balancing posting.

Monthly reconciliation status:

```text
if abs(allocation_difference) >= 0.01
   or abs(journal_difference) >= 0.01
   or abs(final_transfer_difference) >= 0.01
   or invalid_entry_count > 0
   or negative_transfer_count > 0:
    REVIEW
else if every account with abs(final_transfer) >= 0.01 is marked done:
    COMPLETE
else:
    READY_TO_TRANSFER
```

Accounts with an effectively zero final transfer are `not_required` and do not block completion.

## Debt calculations

Order each debt's events by event date, then stable sequence. Workbook row order controls events imported from the same sheet and date.

For event `n`:

```text
prior_balance[n] = sum(change_amount[1 .. n-1])
remaining_balance[n] = prior_balance[n] + change_amount[n]
```

Current balance is the remaining balance of the last event. It may also be calculated as the sum of every event change.

Debt row status:

```text
if abs(remaining_balance) < 0.01: PAID
else if remaining_balance < 0: CREDIT
else: OPEN
```

If notes contain `cancel` case-insensitively, add a review-note indicator. Do not replace the calculated status and do not exclude the debt from summaries.

Current display direction:

```text
if current_balance >= 0:
    owed_by = origin_debtor
    owed_to = origin_creditor
else:
    owed_by = origin_creditor
    owed_to = origin_debtor
display_balance = abs(current_balance)
```

Non-zero debt summary:

```text
included_debts = debts where abs(current_balance) >= 0.01
non_zero_count = count(included_debts)
total_outstanding = sum(abs(current_balance))
largest_debt = max(abs(current_balance))
```

For each account:

```text
owed_to_account = sum(display_balance where current owed_to = account)
owed_by_account = sum(display_balance where current owed_by = account)
net_position = owed_to_account - owed_by_account
```

Across all accounts, net positions must sum to zero within tolerance.

## Source metadata inheritance

The workbook often omits descriptions and parties on later payment rows. During import:

- The first occurrence of a Loan ID establishes the debt record's opened date, description, originating debtor, originating creditor, and originating terms when present.
- Later nonblank metadata does not silently replace origin metadata. If it conflicts, preserve the event value and create a warning.
- Event date and signed change always come from the event row.
- A blank change imports as zero and creates a warning if the row otherwise contains data.
- Loan ID is stored as text to preserve both legacy numeric IDs and values such as `H-01`.

## Account normalization

Normalization sequence:

1. Preserve original source text.
2. Trim whitespace.
3. Compare case-insensitively with existing canonical codes and aliases.
4. Resolve through the editable alias table.
5. If no match exists, create or propose a new account using the trimmed original code and flag it for review.

Never merge two canonical accounts solely because their descriptions sound similar.

## Deletion and correction rules

- Referenced accounts cannot be deleted; archive them.
- Closed months require Reopen before edits.
- Debt events may be corrected with an audit record. Prefer an adjusting event once a month has been closed or exported.
- Deleting an event or posting must immediately recalculate every affected summary and leave a recoverable audit/undo record.
- Do not allow direct editing of calculated totals, prior balances, remaining balances, or statuses.

## Database constraints and indexes

At minimum:

- Unique account code, case-insensitive.
- Unique Loan ID.
- Unique month.
- Unique monthly allocation on month/account.
- Unique event sequence within a debt when importing a stable source order.
- Index journal entries by month/date and Loan ID.
- Index debt events by debt/date/sequence.
- Foreign keys enabled.

## Current workbook controls

The imported current state must reproduce the non-zero debt count, total outstanding, largest debt and account net positions recorded in `reference/current_snapshot.json` and `reference/WORKBOOK_REFERENCE.md` (personal data, gitignored), with net positions summing to zero.

These are migration controls, not hardcoded application values.
