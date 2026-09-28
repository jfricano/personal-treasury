# Treasury rules for v4

Status: proposed · 2026-09-27

This is the calculation and data contract for v4. It has the same authority as [Data model and calculation rules](../data-and-rules.md) and v3's [Spending review rules](../v3/spending-review-rules.md). Where this document and `data-and-rules.md` differ, `data-and-rules.md` wins unless §18 marks the difference as an owner decision the owner has accepted; the product spec's wording never overrides either. All money uses `domain/money.ts` (decimal strings, `decimal.js`). Nothing here uses binary floating point.

Examples use the fictional Harper household (`src/demo/persona.ts`) extended with an invented card `CARD` and an invented counterparty `RELATIVE`. All amounts are invented.

## 1. Principles

1. **Kinds and links are declared, never inferred.** No code path sets an account's kind or link from its code, name, description, transactions or budget lines.
2. **Balances are observed, never computed.** The app still keeps no book balance for any account. Every balance in v4 comes from an institution account in a cleared spending report.
3. **Loan IDs stay the record.** Pairs, as-of summaries and aging are views derived from debts and events.
4. **Nothing posts by itself.** Proposals, verifications and suggestions become treasury records only when the owner accepts them, through the treasury services, with audit and undo.
5. **History is never rewritten.** Imported rows keep their values and provenance. Corrections are new events. A link added to an imported row records who added it; nothing else on the row changes.
6. **The final-transfer netting stays.** V4 never creates a real transfer per debt or per journal row.
7. **Checks warn; rule 5 decides status.** Tie-out items, balance differences and verification results never change a month's status.

## 2. Account kinds and the hub

`accounts.kind` is one of:

| Kind | Allocation line | Journal postings | Final transfer | Debts | Link (Track B) |
| --- | --- | --- | --- | --- | --- |
| `cash` | Yes | Yes | Yes | Either side | Exactly one checking or savings account |
| `card` | Yes, default zero | Yes | Yes (a card payment) | Either side | Exactly one credit card account |
| `counterparty` | Never | Never in new entries | Never | Either side | None |
| *(null: not declared)* | As in v3 | As in v3 | As in v3 | Either side | Any role, as in v3 |

- **Counterparties.** `createMonth` creates no allocation line for them. `setAllocation` with a non-zero amount, and a new transfer or advanced entry with a counterparty posting, are refused with a named reason. An imported posting or allocation that already involves an account later declared a counterparty is kept, counted exactly as before, and listed as a warning *"Posting on a counterparty account"*. Changing an account to `counterparty` is refused while it has a non-zero allocation in an open month.
- **Cards.** New months give a card a zero allocation unless a budget line funds it; a budget line funded by a card produces the warning *"CARD is a card; its lines are usually funded by a bucket"* and nothing else.
- **Hub bucket.** `accounts.is_hub = 1` on at most one account, and only when `kind = 'cash'`. It means pay lands in that bucket's own account.
- Kind and hub are owner facts. Imports (including `replace` mode, which updates accounts in place by code), budget imports and restores of older backups never set or clear them.
- PETC is one `cash` account. No behavior depends on its description.

## 3. Links (Track B)

V4 changes v3's `institution_accounts` link from an optional treasury account plus a `shared` flag to a **link role**:

| `link_role` | Meaning | `treasury_account_id` |
| --- | --- | --- |
| `unset` | Not decided yet. Default for new and migrated rows. | null |
| `treasury` | This institution account *is* that treasury account. | required |
| `hub` | The separate account where pay lands; it belongs to no bucket. | null |
| `outside` | Outside the treasury (brokerage, retirement, loans, unused accounts). | null |

Constraints:

- A unique partial index on `treasury_account_id` where it is not null: each treasury account has at most one linked institution account.
- A unique partial index on `link_role` where it is `hub`.
- Compatibility, enforced by the service: `cash` ↔ checking or savings; `card` ↔ credit card; `counterparty` and undeclared accounts can't be linked.
- **Exactly one hub** when any hub is set: either one `is_hub` bucket with a `treasury` link, or one institution account with role `hub`, never both.
- **Completeness** is a check, not a constraint: every active `cash` and `card` account should have a link, and every institution account should have a role other than `unset`. The setup view lists the gaps. A check that needs a missing link is shown as *Not linked* for that account.
- Links are set only by the owner. Relinking and role changes are audited and undoable, and survive reconnecting (v3 FR-CONN-6).
- **Migration from a built v3 that still has `shared`:** every row with `shared = 1` or no treasury account becomes `unset` and is listed; every row with a treasury account becomes `treasury` if compatible and unique, and otherwise `unset` with the reason listed. The `shared` column is left in place and no longer read.

`hub_institution_account` means the hub bucket's linked institution account, or the institution account with role `hub`.

## 4. Money precision

- The reconciliation tolerance stays `0.01`. `cents(x)` is `toCents(x)`: round half-up to two decimals.
- **Equal at cents:** `cents(a) = cents(b)`.
- **New user amounts.** Transfer amounts, advanced-entry postings, debt opening changes, payments, adjustments, standing amounts, floors, targets and cushions entered after v4 must have at most two decimal places. Imported values, and values already stored, keep their precision (OD13).
- **New months from a budget (OD13).** With `plan = computeBudget(version)`:

  ```text
  R                 = the funding account of the version's residual line
  expected_cash     = cents(plan.takeHome)
  allocation(A)     = cents(Σ planned lines funded by A)          for every funding account A ≠ R
  allocation(R)     = expected_cash − Σ allocation(A) over A ≠ R  (R's other lines are inside this remainder)
  planned_amount(A) = the exact Σ planned lines funded by A, as today (kept for traceability)
  ```

  So the allocations total `expected_cash` exactly, and R absorbs every rounding difference. If the version has no residual line, each account is rounded and any resulting allocation difference is shown as the existing *allocation difference* issue (Review) for the owner to resolve; nothing is assigned silently. **Refresh allocations** and `diffMonthAgainstBudget` use the same rounded proposal, so rounding never appears as an override.
- **New months from another source** (template, duplicate): amounts are rounded with `cents`, and any resulting difference is shown as an allocation difference.
- Imported and existing months are never rounded.

## 5. Monthly lines: standing amounts and the retained hub line

- `accounts.standing_amount` (optional, `cash` accounts only) is what the owner's bank moves automatically each payday (OD14). A month copies it to `monthly_allocations.standing_amount` when the month is created; later changes to the account don't alter existing months.
- Display only, per line with a standing amount `S` and final transfer `F`:

  ```text
  automatic = S
  by_hand   = F − S        positive: send from the hub; negative: send |F − S| back to the hub
  ```

  `final_transfer = budget_allocation + net_postings` is unchanged (rule 4). The to-do list shows `by_hand` only, and hides lines where `|by_hand| < 0.01`.
- A warning appears on the open month and the Accounts page when `cents(active budget allocation for A) ≠ S`.
- **Retained hub line (OD16).** When `meta.hub_line_retained = 1` (set when the owner accepts OD16) and account H has `is_hub = 1`, H's line is **Retained**: `effective_state = 'retained'`, which counts as confirmed. The status rule becomes:

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

  A retained line with a negative final transfer still counts in `negative_transfer_count`. With OD16 declined, or no hub bucket, the rule is exactly as in `data-and-rules.md`.

## 6. Debt events and their kinds

`debt_events.kind`:

| Kind | Created by | Constraints |
| --- | --- | --- |
| `recorded` | Every event that exists before v4, and every imported event. A signed change whose kind wasn't recorded. | None beyond v3. |
| `opening` | `createDebt`'s first event. | First event of a debt created in the app. |
| `payment` | Record payment, a transfer recorded on a debt, pay pair. | `change = paymentToChange(balance, amount)`. |
| `adjustment` | Record adjustment; a claim added to an existing debt (§9). | Signed change typed by the owner or computed by §9. |
| `write_off` | Write off. | See below. |
| `offset` | Offset (§11). | Belongs to an `offset_group_id` with exactly two events. |

- The roll-forward is unchanged: order by `(event_date, sequence)`, `prior[n] = Σ change[1..n−1]`, `remaining[n] = prior[n] + change[n]`. Kind never changes arithmetic.
- **Write-off.** For debt `d` written off on date `w` with reason `r`:

  ```text
  refused if r is blank
  refused if any event of d has event_date > w           (the owner deletes or re-dates those first; imported ones need confirmation)
  change = −(Σ change of events of d with event_date ≤ w)
  refused if |change| < 0.01                              (nothing to write off)
  ```

  The event takes the next `sequence`, so it is last on its date. It moves no cash and needs no journal row.
- **Status** extends `data-and-rules.md`:

  ```text
  if abs(balance) < 0.01 and the last counted event is write_off: WRITTEN_OFF
  else if abs(balance) < 0.01:                                  PAID
  else if balance < 0:                                          CREDIT
  else:                                                         OPEN
  ```

  `WRITTEN_OFF` behaves as `PAID` everywhere else: excluded from the summary, never editable.
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

- A debt with no counted events has not opened as of `t`. It is excluded and listed under **Scheduled** with its opening date.
- Direction reversal (rule 8) uses `position(d, t)`. Origin metadata (rule 9) always comes from the debt record.
- Displayed notes follow the existing rule over `counted(d, t)`: the latest counted event's note, else the terms. The review-note flag reads every event, because a note is information, not a balance.
- Net positions sum to zero within tolerance for every `t`.
- **Defaults (OD6):** the Dashboard and Interaccount Debts use `t = today` in the household time zone (v3 `meta.household_time_zone`, or the device zone before v3). The export's Interco Debt Summary sheet and the import controls use `all`, and label it.
- **`all` mode is v3's summary exactly.** For any set of debts and events, `summarize(all)` equals the pre-v4 `summarizeDebts` result field for field. A property test enforces this.

## 8. Recording a transfer on a debt

Let a new or edited ordinary transfer move amount `a` from account `F` to account `T` and name Loan ID `L`, resolving to debt `d` with origin debtor `D` and origin creditor `C`.

| Case | Default | Event |
| --- | --- | --- |
| `{F, T} = {D, C}` | Record | `change = suggestChangeForTransfer(d, transfer)`: `−a` when `F = D`, `+a` when `F = C`. Kind `payment` when the change moves the balance toward zero as of the transfer date, `adjustment` when it moves it away (money advanced on the same debt). |
| `T` is the account currently owed on `d`, and `F` is a third account `P` | Ask (§9) | `payment` on `d`, plus the claim chosen in §9 |
| `L` names no debt | None | None; tie-out item *Unknown Loan ID* |
| Any other pair | None | None; tie-out item *Accounts differ from the debt's parties* |

- "Currently owed" uses the debt's position as of the transfer date (§7), so a reversed debt is paid by its origin creditor.
- The preview shows the debt's balance before and after, and whether the direction reverses. Saving writes the entry, its postings and the event in **one transaction** with one undo step. The event's date is the entry date, or the first day of the month when the entry has none.
- Links: the event's `journal_entry_id` is the entry, `link_role = 'transfer'`, `link_origin = 'user'`.
- **Editing** the entry's amount or date recalculates each linked `transfer` event in the same transaction, with a preview. Changing the accounts or Loan ID so the case no longer applies asks whether to delete the linked events or keep them unlinked.
- **Deleting** the entry asks whether to delete its linked events too (default yes). Kept events lose the link (`ON DELETE SET NULL`, as today) and appear in the tie-out.
- **Several events per entry** are allowed (pay pair, third-party claims). The existing guard that refuses a second event for one entry becomes: the Σ `|change|` of linked `transfer` events may not exceed the entry's amount.

## 9. When another account pays: the claim

A transfer of `a` from `P` to the creditor `C` names debt `d`, on which `D` currently owes `C`, and `P ∉ {D, C}`. The owner chooses (OD9):

1. **P takes the claim** (default). In one transaction:
   - a `payment` of `a` on `d` (`link_role = 'transfer'`);
   - either a **new debt** `D owes P`, Loan ID typed by the owner (prefilled `L-P`, which must be unique), opened on the transfer date, description *"Paid L for D"*, opening change `+a`, its opening event linked to the entry with `link_role = 'claim'`;
   - or an **increase** of an existing open debt on which `D` currently owes `P`, chosen from a list: an `adjustment` that moves its balance `a` further from zero, `link_role = 'claim'`.
2. **No claim.** Only the payment on `d`. `P` covered `D`'s debt; `D`'s total debt falls by `a`.

If `a` exceeds what `D` owes `C` on `d`, the preview shows the reversal, as for any payment. Net positions still sum to zero in every case.

## 10. The tie-out

For treasury month `M` (first day `m0`, last day `m1`), with `today` the household date:

```text
tied(e)      = Σ |change| of events linked to e with link_role 'transfer' (or null)
               equals, at cents, Σ positive postings of e
reduces(ev)  = abs(remaining(ev)) < abs(prior(ev))
```

Items listed:

| Item | Condition |
| --- | --- |
| **Journal row without matching debt event** | An entry in `M` that names a Loan ID resolving to a debt, or has linked events, and is not `tied`. |
| **Unknown Loan ID** | An entry in `M` whose Loan ID resolves to no debt. |
| **Accounts differ from the debt's parties** | An entry in `M` whose Loan ID resolves to a debt, whose postings don't match any case in §8, and which has no linked events. |
| **Debt payment without journal row** | An event with no `journal_entry_id`, `m0 ≤ event_date ≤ min(m1, today)`, kind `recorded`, `payment` or `adjustment`, that `reduces`, on a debt where neither current party is a counterparty. |
| **Outside payment** (informational) | As above, but a party is a counterparty: money that moved outside the treasury. Not an exception. |

Never listed: `opening`, `write_off` and `offset` events; events that increase a balance; scheduled events (after today); the first event of any debt.

- Items are warnings (OD17). The owner can **Acknowledge** one with a note; the acknowledgement is stored in `tie_out_acknowledgements` and lapses if the entry or event changes.
- Each item links to its entry or event, and shows the source workbook, sheet and range for imported records.
- **Link history (one-time review, repeatable).** For each unlinked imported or pre-v4 entry `e` and unlinked event `ev`, propose a link when all hold:
  - `e`'s Loan ID resolves to `ev`'s debt — using `journal_entries.loan_id`, or else a token in `e`'s description that equals an existing Loan ID exactly (or `Loan <n>` / `Loan #<n>` for a numeric Loan ID `<n>`);
  - `e` is an ordinary transfer between the debt's two origin parties;
  - `cents(|change(ev)|) = cents(a)` and `ev` has the sign §8 gives for that direction;
  - `ev.event_date` falls between 10 days before `M`'s first day and `M`'s last day;
  - exactly one such event exists for `e`, and exactly one such entry exists for `ev`. Otherwise all candidates are listed and none is proposed.

  Accepting sets `journal_entry_id`, `link_role = 'transfer'` and `link_origin = 'accepted_proposal'`, and is audited. It changes nothing else on either row. Bulk acceptance is one undo step. Rows that don't match stay tie-out items for the owner's review.

## 11. Pairs, pay pair and offsets

For as-of date `t` and two accounts `X`, `Y` (ordered by code):

```text
signed(d) = +display_balance(d, t) if owed_by = X and owed_to = Y
            −display_balance(d, t) if owed_by = Y and owed_to = X
gross(X, Y) = Σ display_balance over included debts between X and Y
net(X, Y)   = Σ signed(d)                 positive: X owes Y; negative: Y owes X
```

**Pay pair (OD15).** The payer `P` is the net debtor and the payee `Q` the net creditor. Eligible debts are the included debts on which `P` currently owes `Q`, ordered by `opened_date`, then the sequence of their first event. `limit = Σ display_balance(eligible)`.

```text
refused unless 0.01 ≤ amount ≤ limit
remaining = amount
for each eligible debt d, in order, while remaining ≥ 0.01:
    pay(d)     = min(remaining, display_balance(d))
    event      = payment on d, change = paymentToChange(balance(d), pay(d)), link_role 'transfer'
    remaining −= pay(d)
entry = one ordinary transfer P → Q of amount, in the chosen open month,
        description "Pay pair: P to Q (<Loan IDs>)"
```

The entry, its postings and every event are one transaction and one undo step. When the pair also has debts in the other direction, the preview offers an offset first.

**Offset (OD15).** Debts `x` (on which `A` owes `B`) and `y` (on which `B` owes `A`), both included on date `s`:

```text
refused unless x and y are between the same two accounts, in opposite current directions
refused unless 0.01 ≤ m ≤ min(display_balance(x, s), display_balance(y, s))    default m = the minimum
event on x: kind offset, change = paymentToChange(balance(x), m)
event on y: kind offset, change = paymentToChange(balance(y), m)
both share one new offset_group_id, date s, no journal row
```

An offset leaves `net(X, Y)` and every account's net position unchanged and lowers `gross` and `total_outstanding` by `2m`. Deleting either event of a group deletes both.

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
- **old and idle**: `age_days > 365` and `idle_days > 180` (both settings in `meta`);
- **reversed**: status `CREDIT`, which is legitimate after an overpayment, so it is listed for a look, not as an error;
- **tie-out**: an event of the debt, or an entry naming it, is in an unacknowledged tie-out item.

Actions: **Keep** (stored in `debt_reviews` with the reason, date and optional note; it lapses when a new event is recorded on the debt), **Write off** (§6), **Adjust** (a new `adjustment` event with a note), **Open source**. Nothing leaves the queue by itself except by a new event.

## 13. Observed balances and checks (Track B)

All values come from cleared spending reports ([Spending review rules §12](../v3/spending-review-rules.md#12-balance-snapshot)). For institution account `I` and report month `M` (last day `e`):

```text
month_end(I, M) = the month-end estimate, if the report has one
                  else the value, if its as-of date is e
                  else none                       ("not a month-end balance", shown with its date)
observed(A, M)  = month_end(link(A), M)           for a linked treasury account A
```

Values keep v3's signed convention: assets positive; a card owing money is negative.

### 13.1 Proof of cash

For `I` in spending review in both `M−1` and `M`:

```text
opening    = month_end(I, M−1)
inflows    = Σ inflows on I's source row in report M          (0 for a waived month)
outflows   = Σ outflows on I's source row in report M         (≤ 0; 0 for a waived month)
expected   = opening + inflows + outflows
difference = month_end(I, M) − expected
status     = Proven if abs(difference) < 0.01, else Difference
```

Not available, with the reason shown: no report for `M−1` (the first report is the opening balance), either value is not a month-end balance, the balance is unavailable, or `I` is not in review.

**Typed-in statements (FR-BAL-3).** When the owner entered a statement by hand with its opening balance, the review computes `statement_difference = closing − (opening + Σ entries in the statement period)` while the entries exist, and the report keeps only the opening, closing and difference on the source row.

### 13.2 Economic balance

```text
economic(A, M) = observed(A, M) + net_position(A, as of e)            (§7)
Σ economic over linked A = Σ observed over linked A − Σ net_position(B, as of e) over every other account B
```

The second line is shown as the Balances footer: *"Debts with counterparties and unlinked accounts: …"*. It holds because net positions sum to zero.

### 13.3 Card coverage

For card `K` with `observed(K, M)` available:

```text
owed      = −observed(K, M)
covered   = net_position(K, as of e) + Σ funding_pairs(M, paying = K, funding = F) over F ≠ K
gap       = owed − covered
status    = Covered if abs(gap) < 0.01, else Gap
```

Explanations shown for a positive gap: interest or fees, unbudgeted or excluded spending on the card, a charge from another month, or a card payment not yet posted. For a negative gap: a payment or refund posted before the debts were reduced, or a debt owed to the card that was paid elsewhere. Without persisted funding pairs for `M` (V3-A4), coverage uses debts only and says so.

### 13.4 Card funding (FR-MON-6)

When a card's liability details carry a statement balance `S` and due date, the card's line in the treasury month the owner chose shows `short = S − final_transfer(K)` when `short ≥ 0.01` (OD12). Informational.

### 13.5 Hub checks

- **Pay received.** With `meta.hub_pay_month_offset` ∈ {0, 1} declared (OD18): compare the report's actual take-home income for `M` with `expected_cash` of treasury month `M + offset`. Equal at cents, or a named difference.
- **Hub residual** (separate hub only). With `meta.hub_cushion` set: `residual = month_end(hub, M) − cushion`. A positive residual is *"money that stayed in the hub"*, which often matches an unbalanced journal or an unmade transfer.

### 13.6 Floors, targets and sweeps

Optional per `cash` account: `floor_amount`, `target_amount` (`floor ≤ target` when both are set) and `sweep_to_account_id` (another `cash` account). With `v = observed(A, M)`:

```text
under = floor − v    when v < floor     → "A is $under under its floor"
over  = v − target   when v > target    → "A is $over over its target" (+ "Move it to S?" when a sweep destination is set)
```

Accepting creates a journal row in an open month chosen by the owner (from a bucket the owner picks for **under**; `A → S` for **over**) or opens the budget. Nothing changes allocations. PETC has one floor and one target, like any bucket.

### 13.7 Explanations

Any check result can be marked **Explained** with a note, stored in `balance_check_notes` by (report month, institution account, check). A note lapses if the report is replaced and the difference changes.

## 14. Transfer verification (Track B)

Inputs: a treasury month `N`; its `computeMonth` lines; the hub institution account `H`; each line's linked institution account `I_A`; and every open spending review whose gathered transactions (in-month and context) cover the window `W(N)` = from `meta.verify_days_before` (default 10, 0–20) days before `N`'s first day through `N`'s last day. Posted transactions only.

For each line `A` with `abs(F) ≥ 0.01`:

```text
if A is a retained hub line:              Retained
if H or I_A is not known:                 Not linked
target    = cents(abs(F))
source    = H if F > 0 else I_A;   dest = I_A if F > 0 else H
candidate = an outflow o on source with amount = −target and an inflow i on dest with amount = +target,
            both posted in W(N), |posted(o) − posted(i)| ≤ the v3 pairing window,
            neither already used by another line's accepted verification
Verified         exactly one candidate
Choose           more than one candidate (all listed; the owner picks)
Possible split   no candidate, but two or three outflows source → dest in W(N), each with its matching inflow,
                 total target exactly (listed for the owner to confirm)
Amount differs   no candidate, but exactly one transfer source → dest in W(N) at another amount (difference shown)
Not found        otherwise
```

- Accepted v3 transfer pairs count as candidates; unpaired transactions may be paired for this purpose. Verification never changes a review's dispositions.
- **Mark verified lines Done** sets `transfer_state = 'done'` on every line whose status is Verified (or confirmed by the owner) and whose state is pending, as one undoable step. Nothing sets Done otherwise (OD11).
- **Stored result** in `transfer_verifications`: month, account, status, `decided_by` (`match` or `owner`), the review month it came from, the time, and the `cents(F)` it verified. No transaction amount, date, description or identifier is stored. If the line's `cents(F)` later changes, the result shows **Stale**.
- **Transfers outside the plan.** A transfer pair between two institution accounts linked to treasury accounts, where neither side is `H` and no verification uses it, or a transfer between `H` and a linked account that no line uses. Actions:
  - **Record as debt**: receiving account owes sending account, Loan ID typed by the owner, dated the outflow's posted date, description *"Transfer from X to Y, <Month YYYY>"*.
  - **Reverse through funding**: a journal row in an open month from the receiving account to the sending account, so the final transfers move the money back.
  - **Ignore**, with a reason. Stored as a count per month in `transfer_verifications`, without detail.

## 15. Settlement proposals (Track B)

**Source totals.** When a review is cleared, for every accepted `budget` part on a transaction from institution account `I` with `link_role = 'treasury'` to account `P`, where the part's line is funded by `F ≠ P`:

```text
funding_pairs(M, P, F).net   += −part.amount        (spending positive, refunds negative)
funding_pairs(M, P, F).count += 1
```

Parts paid from the separate hub are totalled with `P = hub` and shown for information; they produce no proposal. These rows are totals only; they are v3's FR-REV-12 table, persisted (V3-A4).

**Proposals.** For each `(M, P, F)` with `abs(net) ≥ 0.01`, one proposal in an open treasury month the owner picks (default: the earliest open month after `M`):

```text
from, to = (F, P) if net > 0 else (P, F);     amount = abs(net)
description = "Settlement: F purchases on P, <Month YYYY>"
```

| Decision | Result |
| --- | --- |
| **Settle now** | One ordinary transfer `from → to` of `amount` in the chosen month; `journal_entries.settlement_proposal_id` set. |
| **Settle over time** | A new debt, `from` owes `to`, Loan ID and terms typed by the owner, opened on `M`'s last day, opening change `+amount`. |
| **Split** | Both, with parts summing exactly to `amount`. |
| **Reject** | Nothing created; optional reason. |

- A decision is stored once per `(M, P, F)` in `settlement_decisions` with the amount decided and links to what it created; pending proposals are computed, not stored. Bulk acceptance is one undo step.
- Beside each proposal: debts between `P` and `F`, and journal rows between them in the chosen month. A journal row in that month between the same accounts for the same amount is flagged as a possible duplicate.
- **Replaced report.** When report `M` is replaced, each decided pair whose new `net` differs from the decided amount by at least 0.01 shows *"Changed since decided"* and offers the difference as a new proposal. Created rows are never edited. A deleted report's pending proposals disappear; its decisions and created rows stay.
- No proposal, decision or created row contains transaction text. Reports cleared without funding pairs produce no proposals.

## 16. Close checklist

Computed on read for `M` = the latest calendar month that has ended and `N` = the treasury month after it. Never stored.

| Step | State |
| --- | --- |
| 1 Clear `M`'s review | **Done** if report `M` exists; **In progress** if a review is open; **Needs connected accounts** without v3 data. |
| 2 Decide proposals | **Done** if no proposal from `M` is pending; count otherwise. |
| 3 Check balances | **Done** if every check for `M` is Proven, Covered, Explained or not available for a stated reason; count otherwise. |
| 4 Review debts | **Done** if treasury month `M` has no unacknowledged tie-out item and the review queue (as of `M`'s last day) has no unacknowledged item; counts otherwise. |
| 5 Fund `N` | **Done** if `N` exists and is Ready to transfer or Complete; shows its status otherwise. |
| 6 Close `M` | **Done** if treasury month `M` is closed. |

A step with nothing to do (for example, no treasury month `M`) is **Not applicable**. The checklist never blocks `closeMonth`, which keeps its existing rules.

## 17. Schema and migrations

Forward-only and additive, numbered after the last migration on the target branch when each slice merges (Track A migrations touch only treasury tables, so their order relative to v3's tables doesn't matter). Money is `TEXT` holding normalized decimals. No migration changes an existing value; new columns get defaults or nulls.

| Change | Slice | Details |
| --- | --- | --- |
| `accounts.kind` | A1 | `TEXT NULL CHECK (kind IN ('cash','card','counterparty'))`. |
| `accounts.is_hub` | A1 | `INTEGER NOT NULL DEFAULT 0`; unique partial index where `is_hub = 1`; trigger requiring `kind = 'cash'`. |
| `debt_events.kind` | A2 | `TEXT NOT NULL DEFAULT 'recorded' CHECK (kind IN ('recorded','opening','payment','adjustment','write_off','offset'))`. |
| `debt_events.link_role`, `link_origin` | A2 | `link_role IN ('transfer','claim')`, null read as `transfer`; `link_origin IN ('user','accepted_proposal')`, null for pre-v4 links. |
| `tie_out_acknowledgements` | A2 | `entry_id` or `event_id` (FKs, `ON DELETE CASCADE`), `item`, `note`, `acknowledged_at`, a fingerprint of the row that lapses it. |
| `debt_events.reason`, `offset_group_id` | A3, A4 | Trigger: `kind = 'write_off'` requires a non-blank reason; index on `offset_group_id`. |
| `debt_reviews` | A3 | `debt_id` (FK cascade), `reason`, `note`, `acknowledged_at`, the event count at acknowledgement. |
| `accounts.standing_amount`, `monthly_allocations.standing_amount` | A5 | Decimal text, nullable. |
| `meta` | A3, A5, B2, B3 | `debt_summary_mode` (`as_of_today` or `all`), `review_old_days` (365), `review_idle_days` (180), `hub_line_retained`, `hub_pay_month_offset`, `hub_cushion`, `verify_days_before`. |
| `institution_accounts.link_role` | B1 | As §3, with its unique partial indexes; migration as §3. |
| `accounts.floor_amount`, `target_amount`, `sweep_to_account_id` | B5 | Nullable; `sweep_to_account_id` FK `accounts`. |
| `spending_report_funding_pairs` | B4 (or v3 via V3-A4) | FK report `ON DELETE CASCADE`; paying and funding account IDs (`ON DELETE SET NULL`) with code copies; `net`; `count`. |
| `spending_report_sources.statement_opening`, `statement_closing`, `statement_difference` | B2 | Nullable. |
| `balance_check_notes` | B2 | Report month, institution account, check, note, the difference it explains. |
| `transfer_verifications` | B3 | PK (month, account); status; `verified_cents`; `decided_by`; review month; time; plus a per-month count of ignored outside transfers. |
| `settlement_decisions` | B4 | Unique (report month, paying, funding); decision; amount; `journal_entry_id`, `debt_id` (`ON DELETE SET NULL`); reason; time. |
| `journal_entries.settlement_proposal_id` | B4 | Nullable reference to `settlement_decisions`. |

- **Backup and restore.** Every new table and column is in the JSON backup, in foreign-key order. A backup restores at its recorded schema version and then migrates forward, so v0.2.2 and v3 backups restore into v4 with kinds empty and every event `recorded`.
- **Workbook export and import.** The export's account table gains Kind, Hub and Standing amount; the Account Ledger gains Kind and Reason. The importer reads these columns only from the app's own export tables; other workbooks leave them empty. A `replace` import keeps every account's kind, hub flag, standing amount, floor, target, sweep destination and links, and its preview lists the app-entered events (write-offs, offsets, claims) it will remove, as it lists other app-entered data today.
- **Database checks.** `npm run db:check` covers the new constraints, triggers and indexes, money normalization in the new columns, and idempotent migration.

## 18. Domain rules kept, extended or changed

The eleven domain rules that must not drift, and the rules in `data-and-rules.md`, v3 and the ADRs that v4 touches. "Changed" always names the owner decision that allows it; without that decision, the rule stays as it is.

| Rule | V4 treatment | Where |
| --- | --- | --- |
| 1. Account codes are opaque; spelling preserved through canonical records and explicit aliases. | **Kept.** Kind is a separate fact the owner declares; it is never inferred from a code or name, and it never changes a code or alias. | §1, §2 |
| 2. PETC is one flexible actual-savings bucket; never relabelled or subdivided. | **Kept.** PETC is one `cash` account with at most one link, one floor and one target. | §2, §13.6 |
| 3. Normal transfers: positive amount, one From, one To. | **Kept.** Pay pair, settlements, reversals and sweeps each create ordinary transfers. **Extended:** a counterparty can't be the From or To of a new transfer (OD4). | §2, §8, §11, §15 |
| 4. `final transfer = allocation + transfers in − transfers out`. | **Kept.** Standing amounts only split the display. New months' allocations are cents (OD13), but the formula is unchanged. | §4, §5 |
| 5. Readiness: allocation, journal and final-transfer reconciliation, row validity, negative transfers, completion of required transfers. | **Changed (OD16):** a retained hub line needs no Done mark. **Kept:** verification (OD11), tie-out items (OD17) and balance checks never affect status. | §5 |
| 6. Debts are event-sourced by Loan ID; prior and remaining balances are calculated, never editable. | **Extended.** Write-offs, offsets and claims are events; the write-off amount is computed; the roll-forward is unchanged. | §6 |
| 7. The summary includes only the latest event per Loan ID with an absolute balance of at least $0.01. | **Extended (OD6):** the latest event on or before the as-of date. In `all` mode the summary is identical to v3's. | §7 |
| 8. A negative balance reverses the displayed parties and shows the absolute balance. | **Kept**, applied at the as-of date. | §7 |
| 9. Description, opened date, original parties and terms come from the originating record. | **Kept.** New events never alter origin metadata; a claim creates a new debt with its own origin. | §6, §9 |
| 10. `canceled` in notes is review information; it doesn't remove a balance. | **Kept.** The note places the debt in the review queue; only the owner's explicit write-off, with a reason, closes it. | §6, §12 |
| 11. Unknown accounts and questionable rows are preserved with warnings. | **Kept.** The tie-out and review queue list, never delete; imported postings on a counterparty account stay and are flagged; link history adds links only on acceptance. | §2, §10, §12 |
| `data-and-rules.md`: money as decimal strings; $0.01 tolerance. | **Kept.** Cent matching compares rounded values; stored values keep precision. **Extended (OD13):** new user amounts have at most two decimals. | §4 |
| `data-and-rules.md`: debt status Paid, Credit, Open. | **Extended:** Written off, which behaves as Paid. | §6 |
| `data-and-rules.md`: `journal_entry_id` is an optional explicit link. | **Extended:** recorded by default for matching transfers; several events may share an entry within its amount; link role and origin recorded. | §8, §10 |
| `data-and-rules.md`: prefer adjusting events after a month is closed or exported; no direct editing of calculated values. | **Kept**, and used for every correction the review queue leads to. | §6, §12 |
| Architecture §4: the app doesn't compute bank balances. | **Kept.** Every balance is observed from a report. | §1, §13 |
| ADR 0004: "Record on Loan" is a one-click option after saving. | **Changed:** recorded in the same save by default, with a preview (no financial meaning changes; the event is the same). | §8 |
| V3 non-goal: no journal entries or debts from institution data. | **Changed (OD10):** proposals become records on the owner's acceptance only. | §15 |
| V3 principle: the spending review never writes treasury data. | **Kept.** Clearing writes only the report and its funding pairs; treasury records are created later, on treasury screens. | §15 |
| V3 principle: raw transactions are temporary. | **Kept.** Verification, proposals and checks store totals and statuses only. | §13–§15 |
| V3: interaccount debts are excluded from net worth. | **Kept.** Economic balances are shown beside, never inside, net worth. | §13.2 |
| V3: the institution link is optional; cards may be Shared. | **Changed (OD3, OD19):** one link per cash bucket and card; no Shared. | §3 |

## 19. Migration controls

- The owner's reference workbook controls (non-zero debt count, total outstanding, largest debt and every net position) are checked in `all` mode by the private tests in `tests/local/`, unchanged. They pass before any write-off, offset or claim is recorded.
- Public tests pin the Harper household in both modes: in `all` mode the figures in [Acceptance tests §9](../acceptance-tests.md#9-debt-controls); in as-of-today mode the same figures, because the demo seed dates no event after today.
- Adding a write-off, offset or claim changes the controls in both modes, as any new event does today; undo restores them.

## 20. Invariants and where they are enforced

| Invariant | Enforcement |
| --- | --- |
| Kind and links are never inferred. | No import, budget or restore path writes `kind`, `is_hub` or `link_role`; tests import workbooks with card-like and person-like codes and assert both stay empty. |
| `all` mode equals v3's summary. | A property test over generated debts and events compares field by field. |
| Existing rows never change. | The migration test hashes every pre-existing column of every row before and after; link-history acceptance changes only the link columns. |
| Offsets preserve net positions. | Property test: any valid offset leaves every account's net position and every pair's net unchanged. |
| Pay pair pays exactly the amount. | Property test: Σ `|change|` of its events equals the transfer amount, and no debt goes past zero. |
| The tie-out never changes status. | Tests compute `computeMonth` with and without tie-out items. |
| Nothing posts without acceptance. | Tests clear a review and run verification and proposals, then assert journal, allocation and debt tables are unchanged until an accept call. |
| No transaction text or detail reaches treasury tables. | The v3 canary scan is extended to `transfer_verifications`, `settlement_decisions`, `spending_report_funding_pairs`, generated descriptions and the audit log. |
| Balances are observed. | The v4 checks live in a pure `domain/balances` module whose only balance inputs are report snapshot and source rows; a test asserts the Balances view is empty for a profile with months, allocations and debts but no cleared report. |
