# Treasury rules for v4

Status: proposed · 2026-09-27

This is the calculation and data contract for v4. It has the same authority as [Data model and calculation rules](../data-and-rules.md) and v3's [Spending review rules](../v3/spending-review-rules.md). Where this document and `data-and-rules.md` differ, `data-and-rules.md` wins unless §18 marks the difference as an owner decision the owner has accepted. The product spec's wording never overrides either. All money uses `domain/money.ts` (decimal strings, `decimal.js`). Nothing here uses binary floating point.

Examples use the fictional Harper household (`src/demo/persona.ts`) extended with an invented card `CARD` and an invented counterparty `RELATIVE`. All amounts are invented.

**Words.** Three different things are easy to confuse, so each has its own name:

- **Treasury role**: what a treasury account physically is (`cash`, `card`, `counterparty`). New in v4, stored in `accounts.treasury_role`.
- **Institution kind**: what v3 calls an institution account's kind (checking, savings, credit card, brokerage, …). Unchanged from v3.
- **Event type**: what a debt event records (payment, write-off, …). New in v4, stored in `debt_events.event_type`.

## 1. Principles

1. **Roles and links are declared, never inferred.** No code path derives a treasury role or a link from a code, name, description, transaction or budget line. They are set by the owner, or copied verbatim from the app's own workbook export or a v4 backup.
2. **Balances are observed, never computed.** The app still keeps no book balance for any account. Every balance in v4 comes from an institution account in a cleared spending report.
3. **Loan IDs stay the record.** Pairs, as-of summaries and aging are views derived from debts and events.
4. **Nothing posts by itself.** Proposals, verifications and suggestions become treasury records only when the owner accepts them, through the treasury services, with audit and undo.
5. **History is never rewritten.** Imported rows keep their values and provenance. Corrections are new events. A link added to an imported row records how it was added; nothing else on the row changes.
6. **The final-transfer netting stays.** V4 never creates a real transfer per debt or per journal row. (Standing amounts, §5, may split one line into two real transfers; that is the owner's trade of transfer count for automation, not a change to the netting.)
7. **Checks warn; rule 5 decides status.** Tie-out items, balance differences and verification results never change a month's status.
8. **Decisions that change existing behavior start switched off.** Every setting in §2.3 starts at the pre-v4 behavior and changes only when the owner records the decision.

## 2. Treasury roles, the hub and decision settings

### 2.1 Treasury roles

| Role | Allocation line | Journal postings | Final transfer | Debts | Link target (Track B) |
| --- | --- | --- | --- | --- | --- |
| `cash` | Yes | Yes | Yes | Either side | Exactly one checking or savings account |
| `card` | Only if a budget line funds it | Yes | Yes (a card payment) | Either side | Exactly one credit card account |
| `counterparty` | Never | Never in new entries | Never | Either side | None |
| *(null: not declared)* | As in v3 | As in v3 | As in v3 | Either side | Any, as in v3 |

- **Counterparties.** `createMonth` creates no allocation line for them. These are refused with a named reason: `setAllocation` with a non-zero amount; a new transfer or advanced entry with a counterparty posting; a budget line funded by a counterparty (the budget view lists it as an issue, so `createMonth` from that version is refused until it is fixed). An imported posting or allocation that already involves an account later declared a counterparty is kept, counted exactly as before, and listed as a warning *"Posting on a counterparty account"*. Changing a role to `counterparty` is refused while the account has a non-zero allocation in an open month.
- **Cards.** A card gets no allocation from a budget unless a budget line funds it; a month created blank gives it $0.00, as it does every account. A budget line funded by a card produces the warning *"CARD is a card; its lines are usually funded by a bucket"* and nothing else.
- **Roles are owner facts.** Budget imports, workbook imports of other workbooks, and restores of backups older than v4 never set or clear them. A `replace` import keeps each account's live role; if the workbook is the app's own export and its value differs, the preview lists the difference and the owner chooses per account (default: keep the live value). A live role that is empty takes the export's value.
- PETC is one `cash` account. No behavior depends on its description.

### 2.2 The hub

- `accounts.is_hub = 1` on at most one account, and only when `treasury_role = 'cash'`. It means pay lands in that bucket's own account.
- In Track B the hub may instead be a separate institution account (§3). There is **at most one hub**, and the owner declares it; until then, checks that need it show *No hub declared*.

### 2.3 Settings that implement owner decisions

| Setting in `meta` | Decision | Value before the decision | Recommended value |
| --- | --- | --- | --- |
| `debt_summary_mode` | OD6 | `all` | `as_of_today` |
| `amounts_in_cents` | OD13 | `0` | `1` |
| `hub_line_retained` | OD16 | `0` | `1` |
| `record_on_loan_in_save` | OD20 | `0` (record after saving, as today) | `1` |
| `hub_pay_month_offset` | OD18 | unset (pay checks off) | the owner states `0` or `1` |

On upgrade, the setup prompt asks for each, pre-filled with the recommended value; recording it is audited and undoable. The public demo seed records the recommended values. Decisions that only add a capability (OD9, OD10, OD11, OD14, OD15, OD17) have no setting: they are built as recommended, and a declined one is removed from the release.

## 3. Links (Track B)

V4 changes v3's `institution_accounts` link from an optional treasury account plus a `shared` flag to a **link target**:

| `link_target` | Meaning | `treasury_account_id` |
| --- | --- | --- |
| `unset` | Not decided yet. Default for new and migrated rows. | null |
| `treasury_account` | This institution account *is* that treasury account. | required |
| `hub` | The separate account where pay lands; it belongs to no bucket. | null |
| `outside` | Outside the treasury (brokerage, retirement, loans, unused accounts). | null |

Constraints:

- A unique partial index on `treasury_account_id` where it is not null: each treasury account has at most one linked institution account.
- A unique partial index on `link_target` where it is `hub`.
- Compatibility, enforced by the service: `cash` ↔ institution kind checking or savings; `card` ↔ credit card. Counterparties and undeclared accounts can't be linked.
- **At most one hub**: either one `is_hub` bucket with a link, or one institution account with target `hub`, never both.
- **Completeness** is a check, not a constraint: every active `cash` and `card` account should have a link, and every institution account a target other than `unset`. The setup view lists the gaps. A check that needs a missing link shows *Not linked*.
- Links are set only by the owner (or restored from a v4 backup). Relinking and target changes are audited and undoable, and survive reconnecting (v3 FR-CONN-6).
- **Migration from a built v3 that still has `shared`:** every row with `shared = 1` or no treasury account becomes `unset`. A row with a treasury account becomes `treasury_account` only if the pair is compatible and it is the only row pointing to that treasury account; otherwise every row pointing there becomes `unset`. All `unset` rows are listed with the reason. The `shared` column is left in place and no longer read.

`H` (the hub institution account) means the hub bucket's linked institution account, or the institution account whose target is `hub`.

## 4. Money precision

- The reconciliation tolerance stays `0.01`. `cents(x)` is `toCents(x)`: round half-up to two decimals. **Equal at cents** means `cents(a) = cents(b)`.
- **New user amounts (OD13, `amounts_in_cents`).** With the setting on, every amount the owner enters has at most two decimal places: transfer amounts, advanced-entry postings, `setAllocation`, expected cash (`NewMonthInput.expectedCash`, `updateMonth`), allocation-template amounts, debt opening changes, payments, adjustments, standing amounts, floors, targets and cushions. Imported values, and values already stored, keep their precision.
- **New months from a budget (setting on).** With `plan = computeBudget(version)`:

  ```text
  R                 = the funding account of the version's residual line
  expected_cash     = cents(plan.takeHome)
  allocation(A)     = cents(Σ planned lines funded by A)          for every funding account A ≠ R
  allocation(R)     = expected_cash − Σ allocation(A) over A ≠ R  (R's other lines are inside this remainder)
  planned_amount(A) = the exact Σ planned lines funded by A, as today (kept for traceability)
  ```

  So the allocations total `expected_cash` exactly, and R absorbs every rounding difference. If the version has no residual line, each account is rounded and any difference appears as the existing allocation-difference issue, worded *"Rounding difference of $0.01: add a residual line to the budget, or adjust one allocation"*. Nothing is assigned silently. **Refresh allocations** and `diffMonthAgainstBudget` use the same rounded proposal, so rounding never shows as an override.
- **New months from another source** (template, duplicate): amounts are rounded with `cents`, and any difference appears the same way.
- Imported and existing months are never rounded. With the setting off, months are created exactly as today.

## 5. Monthly lines: standing amounts and the retained hub line

- `accounts.standing_amount` (optional, `cash` accounts only) is what the owner's bank moves into the bucket automatically each payday (OD14): a recurring transfer from the hub, or a split direct deposit. A month copies it to `monthly_allocations.standing_amount` when the month is created; later changes to the account don't alter existing months.
- Display only, per line with standing amount `S` and final transfer `F`:

  ```text
  automatic = S
  by_hand   = F − S        positive: send from the hub; negative: send abs(F − S) back to the hub
  ```

  `final_transfer = budget_allocation + net_postings` is unchanged (rule 4). The to-do list shows `by_hand`. A line whose `abs(by_hand) < 0.01` stays on the list as **Confirm arrival**: rule 5 still needs its Done mark, so it is never hidden.
- A standing amount can mean two real transfers for one line (the automatic leg and the adjustment), or a transfer back when `F < S`. That is the owner's choice of automation over transfer count, and is shown in the line's tooltip.
- A warning appears on the open month and the Accounts page when `cents(active budget allocation for A) ≠ S`.
- **Retained hub line (OD16, `hub_line_retained`).** With the setting on and account `Hb` marked `is_hub`, `Hb`'s line is **Retained**: `effective_state = 'retained'`, which counts as confirmed. The status rule becomes:

  ```text
  if abs(allocation_difference) >= 0.01
     or abs(journal_difference) >= 0.01
     or abs(final_transfer_difference) >= 0.01
     or invalid_entry_count > 0
     or negative_transfer_count > 0:
      REVIEW
  else if every account with abs(final_transfer) >= 0.01, except a retained hub line, is marked done:
      COMPLETE
  else:
      READY_TO_TRANSFER
  ```

  A retained line with a negative final transfer still counts in `negative_transfer_count`. With the setting off, or no hub bucket, the rule is exactly as in `data-and-rules.md`.
- **`computeMonth` inputs.** `MonthInput` gains `retainedAccountId?: string` (set by the service only when the setting is on) and `standingAmounts?: Map<accountId, Money>` (display only). No other input changes.

## 6. Debt events and their types

`debt_events.event_type`:

| Type | Created by | Constraints |
| --- | --- | --- |
| `recorded` | Every event that exists before v4, and every imported event. A signed change whose type wasn't recorded. | None beyond v3. |
| `opening` | `createDebt`'s first event, and the new debt of a claim (§9) or reassignment. | First event of a debt created in the app. |
| `payment` | Record payment, a transfer recorded on a debt, pay pair. | A change of the opposite sign to the balance before it. |
| `adjustment` | Record adjustment; money advanced on the same debt (§8); a claim added to an existing debt (§9). | Signed change typed by the owner or computed by §8 or §9. |
| `write_off` | Write off, Reassign. | See below. |
| `offset` | Offset (§11). | Belongs to an `offset_group_id` with exactly two events. |

- The roll-forward is unchanged: order by `(event_date, sequence)`, `prior[n] = Σ change[1..n−1]`, `remaining[n] = prior[n] + change[n]`. Event type never changes arithmetic.
- **Write-off.** For debt `d` written off on date `w` with reason `r`:

  ```text
  refused if r is blank
  refused if w > today                                     (no scheduled write-offs)
  refused if any event of d has event_date > w           (the owner deletes or re-dates those first; imported ones need confirmation)
  refused if d's current creditor is a card              (use Reassign: the card is still owed by someone)
  change = −(Σ change of events of d with event_date ≤ w)
  refused if abs(change) < 0.01                           (nothing to write off)
  ```

  The event takes the next `sequence`, so it is last on its date. It moves no cash and needs no journal row. The preview shows each party's net-position change.
- **Reassign.** Moves a debt's remaining balance to a different debtor or creditor in one transaction: a `write_off` on `d` with the reason *"Reassigned to <new Loan ID>"*, and a new debt between the new parties with an `opening` change equal to `d`'s display balance in its current direction. The two events reference each other through `related_event_id`. It has the write-off's date rules. For a debt owed to a card, the owner names the cash bucket that now owes the card. The preview shows every party's net-position change.
- **Status** extends `data-and-rules.md`:

  ```text
  if abs(balance) < 0.01 and the last counted event is write_off: WRITTEN_OFF
  else if abs(balance) < 0.01:                                  PAID
  else if balance < 0:                                          CREDIT
  else:                                                         OPEN
  ```

  `debtStatus(balance, lastEventType)` returns it, and `DEBT_STATUS_LABEL` gains *Written off*. `WRITTEN_OFF` behaves as `PAID` everywhere else: excluded from the summary, never editable.
- **Review note** (rule 10): any event note, or the debt's terms, containing `cancel` (case-insensitive) flags the debt and places it in the review queue (§12). It never changes the balance, status or summary inclusion. A write-off is only ever the owner's act.
- Deleting or editing an event keeps the existing rules: confirmation for imported events, audit, undo, and a preference for adjusting events once a month is closed or exported.

## 7. The as-of debt summary

For an as-of date `t` (an ISO date) or the mode `all`:

```text
counted(d, t)   = events of d with event_date ≤ t          (all events when mode = all)
scheduled(d, t) = events of d with event_date > t          (none when mode = all)
position(d, t)  = debtPosition(d, counted(d, t))           (roll-forward, direction, display balance as today)
included(t)     = debts with abs(position(d, t).balance) ≥ 0.01
non_zero_count, total_outstanding, largest_debt, owed_to, owed_by, net_position
                = the formulas in data-and-rules.md, over included(t)
```

- **Code shape.** `summarizeDebts(positions, accountCode)` is unchanged. A new `positionsAsOf(debts, events, t | 'all')` in `domain/debts.ts` builds the positions, and `debtBoard` and `dashboard` call it.
- A debt with no counted events has not opened as of `t`. It is excluded and listed under **Scheduled** with its opening date.
- Direction reversal (rule 8) uses `position(d, t)`. Origin metadata (rule 9) always comes from the debt record.
- Displayed notes follow the existing rule over `counted(d, t)`: the latest counted event's note, else the terms. The review-note flag reads every event, because a note is information, not a balance.
- Net positions sum to zero within tolerance for every `t`.
- **Mode.** The Dashboard and Interaccount Debts use `debt_summary_mode` (§2.3): `all` until the owner accepts OD6, then `t = today` in the household time zone (v3 `meta.household_time_zone`, or the device zone before v3), with a switch to the other mode. The export's Overview, Account Ledger header and Interco Debt Summary, and the import controls, always use `all` and say so.
- **`all` mode is v3's summary exactly.** For any set of debts and events, the `all`-mode result equals the pre-v4 result field for field. A property test enforces this.

## 8. Recording a transfer on a debt

Let a new or edited ordinary transfer move amount `a` from account `F` to account `T` on date `x` and name Loan ID `L`, resolving to debt `d` with origin debtor `D` and origin creditor `C`. "Currently owed" uses `position(d, x)`.

**Cases:**

| Case | Debt effect |
| --- | --- |
| `{F, T} = {D, C}` | `change = suggestChangeForTransfer(d, transfer)`: `−a` when `F = D`, `+a` when `F = C`. Type `payment` when the change has the opposite sign to the balance before it, else `adjustment` (money advanced on the same debt). |
| `T` is the account currently owed on `d`, and `F` is a third account `P` | A `payment` on `d`, plus the claim chosen in §9. |
| `L` names no debt | None; tie-out item *Unknown Loan ID*. |
| Any other pair | None; tie-out item *Accounts differ from the debt's parties*. |

**Existing events first.** For the first two cases, the app looks for **candidate events**: unlinked events on `d` of type `recorded`, `payment` or `adjustment`, whose change equals at cents the change the case would record, dated from 10 days before the first day of the entry's month through its last day. Then:

| Candidates | Default action | Effect |
| --- | --- | --- |
| Exactly one | **Link to existing event** | Sets that event's link; creates no event. |
| Several | None; the owner picks one or **Record new** | As chosen. |
| None | **Record** when `record_on_loan_in_save` is on; otherwise none | Creates the event. |

- When editing an imported or pre-v4 entry, every default is **none** unless the owner changed its Loan ID or amount.
- The form shows the effect before saving: the debt's balance before and after, whether the direction reverses, or which existing event will be linked. Saving writes the entry, its postings and the event or link in **one transaction** with one undo step. A new event is dated `x`, or the first day of the month when the entry has none.
- **Link fields.** `journal_entry_id` is the entry; `link_purpose = 'transfer'`; `link_origin = 'user'` for new events and links made while saving, `accepted_proposal` for Link history and tie-out resolutions.
- **Editing** the entry's amount or date recalculates each linked `transfer` event it created, in the same transaction, with a preview. A linked event it didn't create (a pre-existing one) is unlinked instead, and appears in the tie-out. Changing the accounts or Loan ID so the case no longer applies asks whether to delete the linked events it created or keep them unlinked.
- **Deleting** the entry asks whether to delete the events it created (default yes). Kept events lose the link (`ON DELETE SET NULL`, as today) and appear in the tie-out.
- **Several events per entry** are allowed (pay pair, claims). The existing guard that refuses a second event for one entry becomes: the sum of absolute changes of linked `transfer` events may not exceed the entry's amount.
- **Service shape.** `addTransfer(monthId, input, opts?)` and `updateTransfer(entryId, input, opts?)` take an optional `debtEffect`: `{ action: 'record' }` or `{ action: 'link', eventId }`, with an optional `claim` (§9). Omitted means no debt effect, so existing callers behave as today. The UI fills `debtEffect` from `suggestDebtEffect(draft)`, a pure function returning the case, the candidates and the default. `recordEntryOnDebt(entryId)` stays for entries saved without an effect and for imported rows; when a candidate exists, the UI offers **Link** beside it.

## 9. When another account pays: the claim

A transfer of `a` from `P` to the creditor `C` names debt `d`, on which `D` currently owes `C` the display balance `b`, and `P ∉ {D, C}`.

- Refused when `a > b`: an overpayment by a third account is entered as two transfers.
- The owner chooses (OD9):
  1. **P takes the claim** (default). In one transaction, the `payment` of `a` on `d` (created, or an existing candidate linked per §8), and either:
     - a **new debt** `D owes P`, Loan ID typed by the owner (prefilled `L-P`, which must be unique), opened on `x`, description *"Paid L for D"*, `opening` change `+a`, linked to the entry with `link_purpose = 'claim'`;
     - or an **increase** of an existing open debt on which `D` currently owes `P`, chosen from a list: an `adjustment` moving its balance `a` further from zero, `link_purpose = 'claim'`.
  2. **No claim.** Only the payment on `d`. `P` covered `D`'s debt, and `D`'s total debt falls by `a`.
- Net positions sum to zero in every case.
- **Historical rows.** An imported entry in which `P` paid `D`'s debt to `C`, with an existing unlinked event on `d`, is resolved from the tie-out by **Link as third-party payment**: the entry is linked to that event (`link_purpose = 'transfer'`), then the claim choice above adds only the claim, or nothing. No payment is recorded twice.

## 10. The tie-out

For treasury month `M` (first day `m0`, last day `m1`), with `today` the household date:

```text
tied(e)      = the sum of absolute changes of events linked to e with link_purpose 'transfer' (or null)
               equals, at cents, the sum of e's positive postings
reduces(ev)  = abs(remaining(ev)) < abs(prior(ev))
```

Each entry and event appears at most once. Entries are tested in this order and take the first item that applies:

| # | Item | Condition |
| --- | --- | --- |
| 1 | **Unknown Loan ID** | An entry in `M` whose Loan ID resolves to no debt. |
| 2 | **Accounts differ from the debt's parties** | An entry in `M` whose Loan ID resolves to a debt, whose postings match no case in §8, and which has no linked events. |
| 3 | **Journal row without matching debt event** | An entry in `M` that either names a resolving Loan ID and matches a §8 case, or has linked events, and is not `tied`. |
| 4 | **Debt payment without journal row** | An event with no `journal_entry_id`, `m0 ≤ event_date ≤ min(m1, today)`, of type `recorded`, `payment` or `adjustment`, that `reduces`, on a debt where neither current party is a counterparty. |
| 5 | **Outside payment** (informational) | As item 4, but a party is a counterparty: money that moved outside the treasury. Not an exception. |

Never listed: `opening`, `write_off` and `offset` events; events that increase a balance; scheduled events (after today); the first event of any debt.

**Resolutions**, each audited and undoable: **Acknowledge** with a note (stored in `tie_out_acknowledgements`; it lapses when the entry or event changes); **Link to existing event** (item 3, when a candidate exists); **Record on loan** (item 3, when none exists); **Link as third-party payment** (item 2, §9); **Open source**. Items are warnings (OD17). Each shows the source workbook, sheet and range for imported records.

**Link history (one-time review, repeatable).** For each unlinked imported or pre-v4 entry `e` and unlinked event `ev`, propose a link when all hold:

- `e`'s Loan ID resolves to `ev`'s debt, using `journal_entries.loan_id`, or else a token in `e`'s description that equals an existing Loan ID exactly (or `Loan <n>` / `Loan #<n>` for a numeric Loan ID `<n>`);
- `e` is an ordinary transfer between the debt's two origin parties;
- `ev`'s change equals at cents the change §8 gives for that direction;
- `ev.event_date` falls between 10 days before `M`'s first day and `M`'s last day;
- exactly one such event exists for `e`, and exactly one such entry exists for `ev`. Otherwise all candidates are listed and none is proposed.

Accepting sets `journal_entry_id`, `link_purpose = 'transfer'` and `link_origin = 'accepted_proposal'`, and is audited. It changes nothing else on either row. Bulk acceptance is one undo step. Rows that don't match stay tie-out items.

## 11. Pairs, pay pair and offsets

For as-of date `t` and two accounts `X`, `Y` (ordered by code):

```text
signed(d)   = +display_balance(d, t) if owed_by = X and owed_to = Y
              −display_balance(d, t) if owed_by = Y and owed_to = X
gross(X, Y) = Σ display_balance over included debts between X and Y
net(X, Y)   = Σ signed(d)                 positive: X owes Y; negative: Y owes X
```

**Pay pair (OD15)**, entered on date `x`. Every balance, sign and limit is computed at `x`, not at the view's date. The payer `P` is the net debtor and the payee `Q` the net creditor as of `x`. Eligible debts are those on which `P` currently owes `Q` and which have no event dated after `x`; debts with later events are skipped and listed (*has scheduled events*). Eligible debts are ordered by `opened_date`, then the sequence of their first event. `limit = Σ display_balance(eligible, x)`.

```text
refused unless 0.01 ≤ amount ≤ limit
remaining = amount
for each eligible debt d, in order, while remaining ≥ 0.01:
    pay(d)     = min(remaining, display_balance(d, x))
    event      = payment on d, change = paymentToChange(balance(d, x), pay(d)), link_purpose 'transfer'
    remaining −= pay(d)
entry = one ordinary transfer P → Q of amount, dated x, in the chosen open month,
        description "Pay pair: P to Q (<Loan IDs>)"
```

The entry, its postings and every event are one transaction and one undo step. When the pair also has debts in the other direction, the preview offers an offset first.

**Offset (OD15)** on date `s ≤ today`, for debts `x` (on which `A` owes `B`) and `y` (on which `B` owes `A`):

```text
refused unless x and y are between the same two accounts, in opposite current directions as of s
refused if x or y has an event dated after s
refused unless 0.01 ≤ m ≤ min(display_balance(x, s), display_balance(y, s))    default m = the minimum
event on x: type offset, change = paymentToChange(balance(x, s), m)
event on y: type offset, change = paymentToChange(balance(y, s), m)
both share one new offset_group_id, date s, no journal row
```

An offset leaves `net(X, Y)` and every account's net position unchanged, and lowers `gross` and `total_outstanding` by `2m`. Deleting either event of a group deletes both.

## 12. Aging and the review queue

For as-of date `t`:

```text
age_days(d)          = t − d.opened_date
last_reduction(d)    = latest event_date among counted events that reduce the balance, or none
idle_days(d)         = t − last_reduction(d), or age_days(d) when none
age_group(d)         = 0–30 | 31–90 | 91–180 | 181–365 | over 365 days
```

The **review queue** lists included debts for any of these reasons, each shown by name:

- a `cancel` note (rule 10);
- **old and idle**: `age_days > review_old_days` and `idle_days > review_idle_days` (defaults 365 and 180, in `meta`);
- **reversed**: status `CREDIT`, which is legitimate after an overpayment, so it is listed for a look, not as an error;
- **tie-out**: an event of the debt, or an entry naming it, is in an unacknowledged tie-out item.

Actions: **Keep** (stored in `debt_reviews` with the reason, date, optional note and a fingerprint of the debt's events; it lapses when any event of the debt is added, edited or deleted), **Write off** or **Reassign** (§6), **Adjust** (a new `adjustment` with a note), **Open source**. Nothing leaves the queue by itself except through an event.

## 13. Observed balances and checks (Track B)

All values come from cleared spending reports ([Spending review rules §12](../v3/spending-review-rules.md#12-balance-snapshot)). For institution account `I` and report month `M` (last day `e`):

```text
month_end(I, M) = the month-end estimate, if the report has one
                  else the value, if its as-of date is e
                  else none                       ("not a month-end balance", shown with its date)
observed(A, M)  = month_end(link(A), M)           for a linked treasury account A
```

Values keep v3's signed convention: assets positive; a card owing money is negative.

**Settlement amounts at month end.** Funding pairs (§15) are charges one account's institution account paid for another account's budget lines. Until a pair is settled, the funding account owes the paying account that amount. For report month `M`:

```text
counted(M, P, F) = funding_pairs(M, P, F).net
                   − the part decided "settle over time" (it becomes a debt, already in net_position)
                   − the part rejected
```

Undecided pairs and the part settled now count in full. Pairs paid from a separate hub are information only and never counted.

### 13.1 Proof of cash

For `I` in spending review in both `M−1` and `M`:

```text
opening    = month_end(I, M−1)
inflows    = Σ inflows on I's source row in report M
outflows   = Σ outflows on I's source row in report M         (≤ 0)
expected   = opening + inflows + outflows
difference = month_end(I, M) − expected
status     = Proven if abs(difference) < 0.01, else Difference (or Timing, §13.7)
```

A month waived for *no activity*, *account closed* or *not used this month* has inflows and outflows of 0. Not available, with the reason: a month waived for *data unavailable* (flows unknown); no report for `M−1` (the first report is the opening balance); either value is not a month-end balance; the balance is unavailable; or `I` is not in review.

Explanations shown for a difference: pending items included in the provider's balance; a late posting dated inside a cleared month; a transaction missing from the gather, or doubled; a possible duplicate removed during the review that was real; a balance timestamp that isn't month end.

**Typed-in statements.** When the owner entered a statement by hand with its opening balance, the review computes `statement_difference = closing − (opening + Σ entries in the statement period)` while the entries exist, and the report keeps only the opening, closing and difference on the source row.

### 13.2 Economic balance

```text
economic(A, M) = observed(A, M) + net_position(A, as of e)
                 + Σ counted(M, A, F) over F      (others owe A for charges A's account paid)
                 − Σ counted(M, P, A) over P      (A owes others for its charges they paid)
```

For a card that funds no budget line (the normal case), `economic(K, M) = −gap(K, M)` (§13.3), a cross-check the tests use.

**Integrity footer.** The Balances page shows `Σ economic over linked accounts = Σ observed over linked accounts + (net positions and counted settlements with accounts that aren't linked)`. It holds by algebra, because net positions and counted settlements each sum to zero, so it catches implementation errors, not ledger errors. It is never a check result and never a close-checklist exception. The ledger controls are coverage, the tie-out and proof of cash.

### 13.3 Card coverage

For card `K` with `observed(K, M)` available:

```text
owed      = −observed(K, M)
covered   = net_position(K, as of e) + Σ counted(M, K, F) over F ≠ K
gap       = owed − covered
status    = Covered if abs(gap) < 0.01, else Gap (or Timing, §13.7)
```

Explanations for a positive gap: interest or fees; unbudgeted or excluded spending on the card; a charge from another month; rejected settlement proposals; pending charges included in the card balance; a card payment in transit. For a negative gap: a payment or refund posted before the debts were reduced; a debt booked by hand for a charge also counted in this month's pairs; a debt owed to the card that was paid elsewhere. Without persisted funding pairs for `M` (V3-A4), coverage uses debts only and says so. Cards whose data comes only from typed statements that don't end on the month's last day have no month-end balance, so coverage is not available for them (a limitation; statement-date coverage is deferred).

### 13.4 Card funding

When a card's liability details carry a statement balance `S` and a due date, the card's line in the treasury month the owner chose shows `short = S − final_transfer(K)` when `short ≥ 0.01` (OD12). Informational.

### 13.5 Hub checks

Both need `hub_pay_month_offset` (OD18). `take_home(M)` is the report's actual take-home income for `M`.

- **Pay received.** Compare `take_home(M)` with `expected_cash` of treasury month `M + offset`. Equal at cents, or a named difference. Explanations include a month with an extra paycheck (for example, a third biweekly pay date).
- **Hub residual** (separate hub only, with `meta.hub_cushion` set):

  ```text
  offset 0: residual = month_end(H, M) − cushion
  offset 1: residual = month_end(H, M) − cushion − undistributed(M)
            undistributed(M) = take_home(M) − Σ verified_cents of N's legs whose transfer posted on or before e
            (N = M + 1; not available until every leg of N is Verified or Retained)
  ```

  A positive residual is *"money that stayed in the hub"*, which often matches an unbalanced journal or a transfer not made. A negative one often means spending paid from the hub (it has no settlement path).

### 13.6 Floors, targets and sweeps

Optional per `cash` account: `floor_amount`, `target_amount` (`floor ≤ target` when both are set) and `sweep_to_account_id` (another `cash` account). With `v = observed(A, M)`:

```text
under = floor − v    when v < floor     → "A is $under under its floor"
over  = v − target   when v > target    → "A is $over over its target" (+ "Move it to S?" when a sweep destination is set)
```

Accepting creates a journal row in an open month chosen by the owner (from a bucket the owner picks for **under**; `A → S` for **over**), or opens the budget. Nothing changes allocations. PETC has one floor and one target, like any bucket.

### 13.7 Timing and explanations

- **Timing tolerance.** At clearing, each report source row also keeps two totals: `pending_total` (the sum of the account's pending amounts at its last gather) and `in_transit_total` (the sum of this account's side of accepted transfer pairs whose other side posted in a different month). A check whose difference equals at cents either total, their sum, or the negative of any of these, for the accounts it involves, shows **Timing** with that explanation instead of Difference or Gap. Timing counts as explained on the close checklist.
- Any result can be marked **Explained** with a note, stored in `balance_check_notes` by (report month, institution account, check) with the difference it explains. The note lapses if the report is replaced and the difference changes.

## 14. Transfer verification (Track B)

**Window and input.** For treasury month `N`, the window `W(N)` runs from `L` days before `N`'s first day through `N`'s last day, where `L = meta.verify_days_before` (default 7, at most 7: v3's gather starts 7 days before its month). The input is the union of posted transactions, in-month and context, from every open spending review whose gathered range intersects `W(N)`. Verification never changes a review's dispositions.

**Legs.** Each line `A` with `abs(F) ≥ 0.01` has one or two legs:

- Without a standing amount: one leg of `cents(abs(F))`, from `H` to `I_A` when `F > 0`, from `I_A` to `H` when `F < 0`.
- With standing amount `S`: an **automatic leg** of `cents(S)`, satisfied by a transfer from `H` to `I_A` or by an inflow on `I_A` accepted as `take_home` income (split direct deposit); and a **by-hand leg** of `cents(abs(F − S))` in the direction of `F − S`, when `abs(F − S) ≥ 0.01`.

**Leg status**, for a leg of `target` from `source` to `dest`:

```text
candidate        = an outflow o on source of −target and an inflow i on dest of +target, both posted in W(N),
                   abs(posted(o) − posted(i)) ≤ the v3 pairing window, neither used by another accepted leg
                   (for an automatic leg, also: a take_home inflow of +target on dest in W(N))
Verified         exactly one candidate
Choose           more than one candidate (all listed; the owner picks)
Possible split   no candidate, but two or three source → dest transfers in W(N) total target exactly
Amount differs   no candidate, but exactly one source → dest transfer in W(N) at another amount (difference shown)
Not yet gathered no candidate, and the input's gathered range for source or dest ends before N's first day
Not found        otherwise
```

Transfers that exactly match a leg of month `N − 1` or `N + 1` within that month's window are set aside: they are never used for Possible split or Amount differs in `N`.

**Line status**: **Retained** for a retained hub line; **Not linked** when `H` or `I_A` is unknown or not in spending review; otherwise **Verified** when every leg is Verified (or confirmed by the owner), else the first unresolved leg's status.

- **Mark verified lines Done** (OD11) sets `transfer_state = 'done'` on every Verified line whose state is pending, as one undoable step. Nothing sets Done otherwise, and status never depends on verification.
- **Stored result**, in `transfer_verifications` (key: month, account, leg): status, `decided_by` (`match` or `owner`), the review month it came from, the time, `verified_cents`, and `posted_by_prior_month_end` (whether the matched outflow posted before `N`'s first day; §13.5 needs it). No transaction amount, date, description or identifier is stored. If the line's `cents(F)` or standing amount later changes, the result shows **Stale**.
- **Transfers outside the plan.** Listed from the input:
  - **Between two linked treasury accounts** (neither is `H`), not used by any leg. Actions: **Record as payment on a debt** (debts on which the sending account currently owes the receiving account, with §8's preview); **Record as debt** (receiving account owes sending account, Loan ID typed by the owner, dated the last day of the month in which the outflow posted, described *"Transfer from X to Y, <Month YYYY>"*); **Reverse through funding** (a journal row in an open month from the receiving account to the sending account, so the final transfers move the money back); **Ignore**, with a reason.
  - **Between `H` and a linked account**, not used by any leg and not matching a leg of month `N − 1` or `N + 1` within their windows (early or late funding). Actions: **Count toward a line** (it becomes a candidate for that line's legs, usually a Possible split) or **Ignore**.
  - Ignored transfers are stored only as a count per month in `transfer_verification_months`.
- Records created from these actions carry one amount and a month-end date chosen by the owner's click (OD10); they are owner records, not transactions, and the canary scan's expectations list them.

## 15. Settlement proposals (Track B)

**Source totals.** When a review is cleared, for every accepted `budget` part on a transaction from institution account `I` linked to treasury account `P`, where the part's line is funded by `F ≠ P`:

```text
funding_pairs(M, P, F).net   += −part.amount        (spending positive, refunds negative)
funding_pairs(M, P, F).count += 1
```

Parts on a transaction from the separate hub are totalled in a row with `paying_is_hub = 1` and no paying account, shown for information; they produce no proposal. Parts whose line is funded by `P` itself add nothing. These rows are totals only; they are v3's FR-REV-12 table, persisted (V3-A4).

**Proposals.** For each `(M, P, F)` with `abs(net) ≥ 0.01` not fully decided, one proposal in an open treasury month the owner picks (default: the earliest open month after `M`):

```text
from, to = (F, P) if net > 0 else (P, F);     amount = abs(net) − Σ amounts already decided for (M, P, F)
description = "Settlement: F purchases on P, <Month YYYY>"
```

| Decision | Result |
| --- | --- |
| **Settle now** | One ordinary transfer `from → to` of `amount` in the chosen month. |
| **Settle over time** | A new debt, `from` owes `to`, Loan ID and terms typed by the owner, opened on `M`'s last day, `opening` change `+amount`. |
| **Split** | Both, with parts summing exactly to `amount`. |
| **Reject** | Nothing created; optional reason. |

- **Refunds on a card.** When settling now would make a card's final transfer negative in the chosen month, the default becomes **Settle over time** (the card owes the bucket, repaid by a later card line). If the original charge was booked as a debt, the proposal also offers to reduce that debt instead.
- **Storage.** `settlement_decisions` holds one row per decision: `(M, P, F, sequence)`, the decision, the amount, `supersedes_decision_id` when it follows a changed report, links to the created `journal_entry_id` and `debt_id` (`ON DELETE SET NULL`), the reason and the time. Journal rows carry no back-reference; the drill-down looks decisions up by entry. Pending proposals are computed, not stored. Bulk acceptance is one undo step.
- **Duplicates.** Beside each proposal: debts between `P` and `F`, and journal rows between them in the chosen month. A journal row in that month, or a debt opened in `M`, between the same accounts for the same amount is flagged as a possible duplicate.
- **Replaced report.** When report `M` is replaced, each decided `(M, P, F)` whose new `net` differs from the total decided by at least 0.01 shows *"Changed since decided"*, and the difference becomes a new proposal whose decision supersedes the earlier one. Created rows are never edited. A deleted report's pending proposals disappear; its decisions and created rows stay.
- No proposal, decision or created row contains transaction text. Reports cleared without funding pairs produce no proposals.

## 16. Close checklist

Computed on read for `M` = the latest calendar month that has ended and `N` = the treasury month after it. Never stored.

| Step | State |
| --- | --- |
| 1 Clear `M`'s review | While a review for `M` is open: **In progress**, with *"M's lines: x verified, y unresolved"*. **Done** once report `M` exists. **Needs connected accounts** when no account is connected. |
| 2 Decide proposals | **Done** if no proposal from `M` is pending; count otherwise. |
| 3 Check balances | **Done** if every check for `M` is Proven, Covered, Timing, Explained or not available for a stated reason; count otherwise. |
| 4 Review debts | **Done** if treasury month `M` has no unacknowledged tie-out item and the review queue as of `M`'s last day has no unacknowledged item; counts otherwise. |
| 5 Fund `N` | **Done** if `N` exists and is Ready to transfer or Complete; its status otherwise. |
| 6 Close `M` | **Done** if treasury month `M` is closed. |

- **Last chance to verify.** Clearing a review for `M` while treasury month `M` has pending lines whose verification is unresolved shows a warning in the clearing confirmation: after clearing, those lines can no longer be verified from bank data. It never blocks clearing.
- A step with nothing to do is **Not applicable**. The checklist never blocks `closeMonth`, which keeps its existing rules.

## 17. Schema and migrations

Forward-only and additive. Money is `TEXT` holding normalized decimals. No migration changes an existing value; new columns get defaults or nulls. Migration numbers follow one linear sequence on the branch that ships them; see the [implementation plan §4](implementation-plan.md#4-release-path-for-track-a) for how Track A's migrations are ordered with v3's.

| Change | Slice | Details |
| --- | --- | --- |
| `accounts.treasury_role` | A1 | `TEXT NULL CHECK (treasury_role IN ('cash','card','counterparty'))`. |
| `accounts.is_hub` | A1 | `INTEGER NOT NULL DEFAULT 0`; unique partial index where `is_hub = 1`; trigger requiring `treasury_role = 'cash'`. |
| `debt_events.event_type` | A2 | `TEXT NOT NULL DEFAULT 'recorded' CHECK (event_type IN ('recorded','opening','payment','adjustment','write_off','offset'))`. |
| `debt_events.link_purpose`, `link_origin` | A2 | `link_purpose IN ('transfer','claim')`, null read as `transfer`; `link_origin IN ('user','accepted_proposal')`, null for pre-v4 links. |
| `debt_events.reason`, `related_event_id`, `offset_group_id` | A2 | Trigger: `event_type = 'write_off'` requires a non-blank reason; `related_event_id` FK `debt_events ON DELETE SET NULL`; index on `offset_group_id`. |
| `meta` settings | A2, A3, A7, B2, B3 | Those in §2.3, plus `review_old_days`, `review_idle_days`, `hub_cushion`, `verify_days_before`. |
| `tie_out_acknowledgements` | A4 | `entry_id` or `event_id` (FKs, `ON DELETE CASCADE`), `item`, `note`, `acknowledged_at`, a fingerprint of the row. |
| `debt_reviews` | A5 | `debt_id` (FK cascade), `reason`, `note`, `acknowledged_at`, a fingerprint of the debt's events (their IDs and `updated_at` values). |
| `accounts.standing_amount`, `monthly_allocations.standing_amount` | A7 | Decimal text, nullable. |
| `institution_accounts.link_target` | B1 | As §3, with its unique partial indexes; migration as §3. |
| `spending_report_sources.statement_opening`, `statement_closing`, `statement_difference`, `pending_total`, `in_transit_total` | B2 | Nullable. |
| `balance_check_notes` | B2 | Report month, institution account, check, note, the difference it explains. |
| `transfer_verifications` | B3 | PK (month, account, leg); status; `verified_cents`; `posted_by_prior_month_end`; `decided_by`; review month; time. |
| `transfer_verification_months` | B3 | PK month; count of ignored outside transfers. |
| `spending_report_funding_pairs` | B0 | FK report `ON DELETE CASCADE`; `paying_account_id` (nullable, `ON DELETE SET NULL`) with a code copy; `paying_is_hub`; `funding_account_id` (`ON DELETE SET NULL`) with a code copy; `net`; `count`. |
| `settlement_decisions` | B4 | Unique `(report month, paying, funding, sequence)`; decision; amount; `supersedes_decision_id`; `journal_entry_id`, `debt_id` (`ON DELETE SET NULL`); reason; time. |
| `accounts.floor_amount`, `target_amount`, `sweep_to_account_id` | B5 | Nullable; `sweep_to_account_id` FK `accounts`. |

- **Backup and restore.** Every new table and column is added to `BACKUP_TABLES` in foreign-key order (there are no key cycles: journal entries hold no reference to settlement decisions). A backup restores at its recorded schema version and then migrates forward, so v0.2.2 and v3 backups restore into v4 with roles empty and every event `recorded`. A v4 backup restores roles, links and every new row verbatim.
- **Workbook export and import.** The export's account table gains *Treasury role*, *Hub* and *Standing amount*. The Account Ledger gains *Event type*, *Reason*, *Offset group* and *Related Loan ID* (for reassignments). Its Overview and Account Ledger header, like the Interco Debt Summary, are labelled *all recorded events*. The importer reads these columns only from the app's own export tables; other workbooks leave them empty. The workbook path does **not** carry links between events and journal rows (the importer sets them to null, as today) or per-month standing amounts; after a workbook import the owner runs Link history, which proposes the app-made links again because they match exactly.
- **`replace` import** (which deletes treasury tables and updates accounts in place by code):

  | Table or column | In `replace` mode |
  | --- | --- |
  | Account role, hub, standing amount, floor, target, sweep, links | Kept (§2.1 for a differing role in the app's own export). |
  | `tie_out_acknowledgements`, `debt_reviews` | Deleted with the rows they describe (cascade). |
  | `transfer_verifications`, `transfer_verification_months` | Deleted: the months are replaced. |
  | `settlement_decisions` | Kept, with their links set to null and marked *record removed by import*; their proposals do not return as pending unless the owner reopens them. |
  | `balance_check_notes`, report tables | Kept: they describe reports, not treasury rows. |

  The preview lists the app-entered events (write-offs, offsets, claims, reassignments) the import will remove, as it lists other app-entered data today.
- **Database checks.** `npm run db:check` covers the new constraints, triggers and indexes, money normalization in the new columns, and idempotent migration.

## 18. Domain rules kept, extended or changed

The eleven domain rules that must not drift, and the rules in `data-and-rules.md`, the architecture, v3 and the ADRs that v4 touches. "Changed" always names the owner decision that allows it; without that decision, the rule stays as it is.

| Rule | V4 treatment | Where |
| --- | --- | --- |
| 1. Account codes are opaque; spelling preserved through canonical records and explicit aliases. | **Kept.** Treasury role is a separate fact the owner declares; it is never inferred from a code or name, and never changes a code or alias. | §1, §2 |
| 2. PETC is one flexible actual-savings bucket; never relabelled or subdivided. | **Kept.** PETC is one `cash` account with at most one link, one floor and one target. | §2, §13.6 |
| 3. Normal transfers: positive amount, one From, one To. | **Kept.** Pay pair, settlements, reversals and sweeps each create ordinary transfers. **Extended (OD4):** a counterparty can't be the From or To of a new transfer. | §2, §8, §11, §15 |
| 4. `final transfer = allocation + transfers in − transfers out`. | **Kept.** Standing amounts only split the display. New months' allocations are in cents (OD13), but the formula is unchanged. | §4, §5 |
| 5. Readiness: allocation, journal and final-transfer reconciliation, row validity, negative transfers, completion of required transfers. | **Changed (OD16):** a retained hub line needs no Done mark. **Kept:** verification (OD11), tie-out items (OD17) and balance checks never affect status. | §5 |
| 6. Debts are event-sourced by Loan ID; prior and remaining balances are calculated, never editable. | **Extended.** Write-offs, reassignments, offsets and claims are events; write-off amounts are computed; the roll-forward is unchanged. | §6 |
| 7. The summary includes only the latest event per Loan ID with an absolute balance of at least $0.01. | **Extended (OD6):** the latest event on or before the as-of date. In `all` mode the summary is identical to v3's. | §7 |
| 8. A negative balance reverses the displayed parties and shows the absolute balance. | **Kept**, applied at the as-of date. | §7 |
| 9. Description, opened date, original parties and terms come from the originating record. | **Kept.** New events never alter origin metadata; a claim or reassignment creates a new debt with its own origin. | §6, §9 |
| 10. `canceled` in notes is review information; it doesn't remove a balance. | **Kept.** The note places the debt in the review queue; only the owner's explicit write-off, with a reason, closes it. | §6, §12 |
| 11. Unknown accounts and questionable rows are preserved with warnings. | **Kept.** The tie-out and review queue list, never delete; imported postings on a counterparty account stay and are flagged; links are added only on the owner's action. | §2, §10, §12 |
| `data-and-rules.md`: money as decimal strings; $0.01 tolerance. | **Kept.** Cent matching compares rounded values; stored values keep precision. **Extended (OD13):** new user amounts have at most two decimals. | §4 |
| `data-and-rules.md`: debt status Paid, Credit, Open. | **Extended:** Written off, which behaves as Paid. | §6 |
| `data-and-rules.md`: `journal_entry_id` is an optional explicit link. | **Extended:** several events may share an entry within its amount; link purpose and origin recorded; existing events are linked before new ones are created. | §8, §10 |
| `data-and-rules.md`: prefer adjusting events after a month is closed or exported; no direct editing of calculated values. | **Kept**, and used for every correction the review queue leads to. | §6, §12 |
| Architecture §4: the app doesn't compute bank balances. | **Kept.** Every balance is observed from a report. | §1, §13 |
| Architecture §6: `computeMonth` reads only expected cash, allocations and postings. | **Extended (OD16, OD14):** it also takes the retained account and, for display only, the standing amounts. | §5 |
| ADR 0004: "Record on Loan" is a one-click option after saving. | **Changed (OD20):** the debt effect is chosen in the same save, linking an existing event first. The API default stays off. | §8 |
| V3 non-goal: no journal entries, confirmed transfers or debts from institution data. | **Changed (OD10, OD11; V3-A6):** proposals become records, and verified lines become Done, only on the owner's click. | §14, §15 |
| V3 FR-REV-13: transfer-confirmation hints. | **Replaced** by verification (§14), with cent matching (V3-A5). The hint was not built in v3 and is not built separately. | §14 |
| V3 principle: the spending review never writes treasury data. | **Kept.** Clearing writes only the report and its funding pairs; treasury records are created later, on treasury screens. | §15 |
| V3 principle: raw transactions are temporary. | **Kept.** Verification, proposals and checks store totals and statuses only. Records the owner creates from a single transfer carry its amount and a month-end date (OD10). | §13–§15 |
| V3: interaccount debts are excluded from net worth. | **Kept.** Economic balances are shown beside, never inside, net worth. | §13.2 |
| V3: the institution link is optional; cards may be Shared; a treasury account is a "virtual bucket". | **Changed (OD3, OD19; V3-A1, V3-A2):** one link per cash bucket and card; no Shared; a treasury account may now be declared a physical cash bucket, card or counterparty. | §2, §3 |

## 19. Migration controls

- The owner's reference workbook controls (non-zero debt count, total outstanding, largest debt and every net position) are checked in `all` mode by the private tests in `tests/local/`, unchanged. They pass before any write-off, offset, claim or reassignment is recorded.
- Public tests pin the Harper household in both modes: in `all` mode the figures in [Acceptance tests §9](../acceptance-tests.md#9-debt-controls); in as-of-today mode the same figures, because the demo seed dates no event after today.
- Adding a write-off, offset, claim or reassignment changes the controls in both modes, as any new event does today; undo restores them.

## 20. Invariants and where they are enforced

| Invariant | Enforcement |
| --- | --- |
| Roles and links are never inferred. | No budget import, import of another workbook, or restore of a pre-v4 backup writes `treasury_role`, `is_hub` or `link_target`; tests import workbooks with card-like and person-like codes and assert both stay empty. Only owner actions, the app's own export and v4 backups set them. |
| `all` mode equals v3's summary. | A property test over generated debts and events compares field by field. |
| Existing rows never change. | The migration test hashes every pre-existing column of every row before and after; link acceptance changes only the link columns. |
| No event is recorded twice for one transfer. | Tests: editing an imported entry with a matching event records nothing; saving a transfer with one candidate links it; the sum of absolute changes of linked transfer events never exceeds the entry amount (property test). |
| Offsets preserve net positions. | Property test: any valid offset leaves every account's net position and every pair's net unchanged. |
| Pay pair pays exactly the amount. | Property test: the sum of absolute changes of its events equals the transfer amount, and no debt goes past zero at the entry date. |
| The tie-out never changes status, and each row appears once. | Tests compute `computeMonth` with and without tie-out items, and assert item exclusivity. |
| Coverage and economic balance agree. | Test: for every card that funds no budget line, `economic = −gap`, before and after each type of proposal decision. |
| Nothing posts without acceptance. | Tests clear a review and run verification and proposals, then assert journal, allocation, debt and Done state are unchanged until an accept call. |
| No transaction text or detail reaches treasury tables. | The v3 canary scan is extended to `transfer_verifications`, `settlement_decisions`, `spending_report_funding_pairs`, generated descriptions and the audit log. Owner-created records from a single transfer are listed in the scan's expectations with the one amount they carry. |
| Balances are observed. | The v4 checks live in a pure `domain/balances` module whose only balance inputs are report snapshot and source rows; a test asserts the Balances view is empty for a profile with months, allocations and debts but no cleared report. |
