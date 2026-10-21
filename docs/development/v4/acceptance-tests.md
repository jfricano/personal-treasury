# V4 acceptance tests

These extend the [existing acceptance tests](../acceptance-tests.md) and the [v3 acceptance tests](../v3/acceptance-tests.md), which all still apply. Test names in `tests/` refer to these as V4-AT1–V4-AT18. Amounts are invented fixture values, not the demo's seeded figures unless a test says so.

**Fixture household.** The Harper accounts (HH, PETC, LTS, TRV, KIDS, CLTH, GIFT, ENT), plus `CARD` (role card) and `RELATIVE` (role counterparty). Every Harper account has role `cash`, and HH is the hub bucket unless a test says otherwise. The clock is fixed at **2026-09-27** in America/Los_Angeles unless stated. Loan IDs in these tests start with `T-`, so they never collide with the demo's `H-` loans. Unless a test says otherwise, the setting-backed decisions hold their recommended values (`debt_summary_mode = as_of_today`, `amounts_in_cents = 1`, `hub_line_retained = 1`, `record_on_loan_in_save = 1`). **Each numbered step starts from the test's fixture** unless it says it continues from an earlier step.

**Track B institution accounts.** Checking ••1111 → HH; Savings ••2222 → PETC; Savings ••6101 → LTS; Savings ••6102 → TRV; Checking ••6103 → ENT; Card ••6104 → CARD; Brokerage ••4444 and Student loan ••5555 outside the treasury. GIFT, KIDS and CLTH are not linked. The **separate-hub** variant adds Checking ••6100 with the hub target, and HH is then not the hub bucket.

## Track A

### 1. Treasury roles and the hub (V4-AT1)

1. After migration every account's role is **Not declared**, every setting holds its pre-v4 value, and every month, final transfer, status and debt figure is unchanged.
2. With `RELATIVE` declared a counterparty:
   - creating 2026-10 from the budget creates no RELATIVE line;
   - setting RELATIVE's allocation to $10.00 is refused with *"RELATIVE is a counterparty and can't receive an allocation"*;
   - a transfer HH → RELATIVE is refused, and so is an advanced entry with a RELATIVE posting;
   - moving a budget line's funding to RELATIVE shows the issue *"Line funded by a counterparty"*, and creating a month from that version is refused until it is fixed;
   - a debt T-20, HH owes RELATIVE $400.00, can be created.
3. A legacy month imported before RELATIVE was declared, with a posting RELATIVE +$25.00, keeps the posting and its final transfer, and shows *"Posting on a counterparty account"*.
4. `CARD` gets no line in a month created from the budget, and $0.00 in a month created blank. Moving the Clothing line's funding to CARD shows the card warning and changes nothing else.
5. Marking HH the hub succeeds; then marking LTS is refused (*"HH is already the hub"*) and marking CARD is refused (*"Only a cash bucket can be the hub"*).
6. Importing a workbook that introduces codes `VISA2` (named "Visa card") and `GRANDMA` leaves both **Not declared**. A `replace` import of the Harper workbook keeps HH's hub flag and CARD's role; when that workbook is the app's own export with CARD marked `cash`, the preview lists the difference and keeps `card` by default.
7. Changing ENT to counterparty while ENT has $538.96 allocated in an open month is refused. A role change is audited, and **Undo** restores the previous role.
8. PETC is `cash`; its description is unchanged, and no behavior depends on it.
9. In the demo seed, every Harper account has a role, HH is the hub, CARD and RELATIVE exist with no debts, and the setting-backed decisions hold their recommended values.

### 2. A debt payment entered once (V4-AT2)

Fixture: T-01, KIDS owes ENT, opened 2026-07-10 with +$200.00. Open month 2026-09.

1. Adding a transfer KIDS → ENT $80.00 dated 2026-09-05 with Loan ID T-01 previews *"T-01: KIDS owes ENT $200.00 → $120.00"*. Saving creates one entry (KIDS −80, ENT +80) and one `payment` event of −80 dated 2026-09-05, linked to the entry with origin *user*. T-01 is $120.00. One **Undo** removes both.
2. **Link first.** T-01 also has an unlinked `payment` of −80.00 dated 2026-08-31, recorded earlier on the Debts screen. The same transfer now defaults to **Link to existing event**; after saving, T-01 is $120.00 (not $40.00), the existing event carries the link, and no event is created.
3. With a second unlinked −80.00 event dated 2026-09-02 as well, no default is chosen and both candidates are listed; the owner picks one.
4. With `record_on_loan_in_save = 0`, the default is no debt effect: the entry saves alone, T-01 stays $200.00, and **Record on Loan** after saving still works as today.
5. With **Record on Loan T-01** unticked, only the entry is saved; T-01 stays $200.00 and the tie-out lists the entry.
6. Continuing from step 1, a transfer ENT → KIDS $30.00 on T-01 records an `adjustment` of +30; T-01 is $150.00.
7. Continuing from step 1: editing the amount to $90.00 changes the event to −90 in the same transaction (T-01 $110.00); editing the date to 2026-09-08 moves the event's date; changing the To account to PETC asks whether to delete the event it created, and deleting leaves T-01 at $200.00. Deleting the transfer instead asks the same question; the default deletes both.
8. An imported legacy entry KIDS → ENT $50.00 naming T-01, with a matching imported event of −50.00 that is not linked, is edited to change only its description. Nothing is recorded or linked, and T-01 is unchanged.
9. A transfer naming T-99 (no such debt) saves with no event and appears in the tie-out as *Unknown Loan ID*.
10. T-02, KIDS owes ENT, has +50.00 then −70.00 (ENT owes KIDS $20.00). A transfer ENT → KIDS $20.00 on T-02 records a `payment` of +20 and T-02 is **Paid**.
11. T-15, KIDS owes ENT +100.00: a transfer KIDS → ENT $250.00 records a `payment` of −250 (the sign is opposite to the balance), and T-15 shows ENT owes KIDS $150.00.
12. Creating a debt shows its first event as type `opening`.
13. With `amounts_in_cents = 1`, a transfer amount of $80.005, a debt opening of $10.005, a payment of $10.005 and an adjustment of $0.005 are each refused with *"Use at most two decimal places"*. With the setting at 0, each is accepted, as today.

### 3. Another account pays: the claim (V4-AT3)

Fixture: T-03, TRV owes LTS, opened 2026-06-01 with +$300.00.

1. A transfer HH → LTS $100.00 on 2026-09-06 naming T-03 opens the claim dialog. With the default, **HH takes the claim**, and Loan ID `T-03-HH`:
   - T-03 gets a `payment` of −100 and is $200.00;
   - a new debt T-03-HH, TRV owes HH, opened 2026-09-06, description *"Paid T-03 for TRV"*, `opening` +$100.00, linked to the entry as a claim;
   - net positions: TRV −$300.00, LTS +$200.00, HH +$100.00, summing to $0.00;
   - the entry is tied in the tie-out.
2. With an existing T-04, TRV owes HH $40.00, choosing **Add to T-04** records an `adjustment` of +100: T-04 is $140.00 and T-03 is $200.00.
3. Choosing **No claim** leaves T-03 at $200.00 and nothing else: TRV −$200.00, LTS +$200.00, HH $0.00.
4. If T-03 already has an unlinked −100.00 event dated 2026-09-06, step 1 links it instead of recording a payment; T-03 is still $200.00, and only the claim is added.
5. A transfer HH → LTS $350.00 naming T-03 is refused: a third account can't overpay a debt.
6. A transfer HH → PETC $100.00 naming T-03 shows no dialog, records no event, and appears only as *Accounts differ from the debt's parties*.
7. If `T-03-HH` already exists, saving is refused until the owner types another Loan ID.

### 4. Tie-out and link history (V4-AT4)

Fixture: month 2026-09 created from the Harper current plan, with balanced entries and no Done marks, so it is **Ready to transfer**. T-01 (KIDS owes ENT, +200.00 on 2026-07-10) and T-03 (TRV owes LTS, +300.00 on 2026-06-01) as in V4-AT2 and V4-AT3.

| Record | Expected |
| --- | --- |
| E1: 2026-09-05 KIDS → ENT $40.00, T-01, linked payment −40 | Not listed (tied) |
| E2: 2026-09-06 TRV → LTS $60.00 naming T-03, no event | *Journal row without matching debt event* |
| E3: 2026-09-07 HH → PETC $25.00, no Loan ID | Not listed |
| E4: 2026-09-08 HH → PETC $100.00 naming T-03 | *Accounts differ from the debt's parties* (only) |
| T-05 (PETC owes LTS): payment −70.00 on 2026-09-15, no entry | *Debt payment without journal row* |
| T-06: write-off on 2026-09-20 | Not listed |
| T-07: opened 2026-09-10 with +90.00 | Not listed |
| T-08 (HH owes RELATIVE): payment −50.00 on 2026-09-12 | *Outside payment* (informational) |
| T-09: payment −30.00 on 2026-09-29 | Not listed (scheduled) |
| T-10: +40.00 on 2026-09-18 on an open debt | Not listed (an increase) |
| T-11 and T-12: an offset group on 2026-09-14 | Not listed |

1. The panel shows three exceptions and one outside payment, each once. The month stays **Ready to transfer**.
2. Acknowledging E2 with a note leaves two exceptions. Editing E2's amount afterwards lists it again.
3. Every item links to its row; imported items also show their workbook sheet and range.
4. **Link history.** An imported legacy month 2026-03 has an entry with loan ID empty and description *"Loan T-13"*, TRV → LTS $50.00, and T-13 (TRV owes LTS) has an imported event −50.00 dated 2026-02-28. The link is proposed. Accepting it sets the event's link with origin *accepted proposal*; the event's amount, date, notes, source sheet and range are byte-identical to before. **Undo** removes the link.
5. With a second imported T-13 event of −50.00 dated 2026-03-01, nothing is proposed and both candidates are listed.
6. **Historical third-party payment.** An imported 2026-03 entry HH → LTS $70.00 naming T-14 (TRV owes LTS), and an imported unlinked T-14 event of −70.00 dated 2026-03-01, appear as *Accounts differ* and *Debt payment without journal row*. **Link as third-party payment** links them, and choosing the claim creates T-14-HH, TRV owes HH $70.00. T-14's balance is unchanged, both items clear, and no payment is recorded twice.

### 5. The as-of debt summary (V4-AT5)

Fixture:

- T-21, HH owes LTS: +600.00 on 2026-06-01; −200.00 on 2026-07-01; −200.00 on 2026-08-01; −200.00 on 2026-10-01.
- T-22, ENT owes CLTH: +150.00 on 2026-10-15.
- T-23, KIDS owes PETC: +90.00 on 2026-05-01; −120.00 on 2026-09-01.

| Mode | Debts shown | Count | Total | Largest |
| --- | --- | --- | --- | --- |
| As of 2026-09-27 | T-21 HH owes LTS $200.00; T-23 PETC owes KIDS $30.00; T-22 under **Scheduled** (opens 2026-10-15) | 2 | $230.00 | $200.00 |
| All recorded events | T-22 ENT owes CLTH $150.00; T-23 PETC owes KIDS $30.00; T-21 Paid | 2 | $180.00 | $150.00 |
| As of 2026-07-15 | T-21 HH owes LTS $400.00; T-23 KIDS owes PETC $90.00 | 2 | $490.00 | $400.00 |

1. With `debt_summary_mode = as_of_today`, the Dashboard headline reads *as of 27 Sep 2026* with *2 scheduled events*, and the events dated 2026-10-01 and 2026-10-15 are labelled **Scheduled**. With the setting at `all`, the headline shows the all-events row and says so.
2. Net positions sum to $0.00 in every mode.
3. For the Harper sample, all-events mode gives count 4, total $785.00 and largest $300.00, equal field for field to the pre-v4 summary. As-of-today mode gives the same figures, including with the clock set to the first day of a month.
4. The export's Overview, Account Ledger header and Interco Debt Summary use all recorded events and say so.

### 6. Write-offs and reassignment (V4-AT6)

Fixture: T-24, GIFT owes KIDS, opened 2024-03-11 with +100.00 and the note "canceled"; T-25, HH owes LTS, +300.00 on 2026-08-01 and −100.00 on 2026-11-01; T-23 as in V4-AT5; T-44, CLTH owes CARD $200.00; T-20, HH owes RELATIVE $400.00.

1. Before any write-off, T-24 is in the summary and in the review queue with the reason *cancel note*.
2. Writing off T-24 on 2026-09-27 with the reason "Gift never happened" previews GIFT's net position rising by $100.00 and KIDS's falling by $100.00, then records a `write_off` event of −100.00, computed by the app. T-24 shows **Written off**, leaves the summary, and the total falls by $100.00. The 2026-09 tie-out doesn't list it.
3. A write-off with a blank reason is refused, and so is one dated 2026-09-28 (after today).
4. Writing off T-25 on 2026-09-27 is refused, naming the event dated 2026-11-01. After the owner deletes that scheduled event (with confirmation), the write-off records −300.00.
5. Writing off T-23 (PETC owes KIDS $30.00) records +30.00.
6. Writing off T-44 is refused (*"CARD is still owed; reassign instead"*). **Reassign** to ENT with Loan ID T-45 records a write-off of −200.00 on T-44 with the reason *"Reassigned to T-45"* and creates T-45, ENT owes CARD $200.00, the two events referencing each other. CARD's net position stays +$200.00; CLTH's moves from −$200.00 to $0.00 and ENT's to −$200.00.
7. **Reassign** T-20's creditor to LTS with Loan ID T-20-LTS leaves HH owing $400.00, now to LTS.
8. As of 2026-09-26, T-24 still shows $100.00 outstanding.
9. Deleting the write-off asks for confirmation and returns T-24 to $100.00; **Undo** restores the write-off.

### 7. Aging and the review queue (V4-AT7)

As of 2026-09-27, with the V4-AT5 and V4-AT6 fixtures before any write-off, plus T-26, HH owes PETC, +80.00 on 2025-06-15 and −20.00 on 2026-06-01:

| Debt | Age | Last reduction | Idle | Group | Queue reasons |
| --- | --- | --- | --- | --- | --- |
| T-21 | 118 days | 2026-08-01 | 57 days | 91–180 | none |
| T-23 | 149 days | 2026-09-01 | 26 days | 91–180 | reversed |
| T-24 | 930 days | none | 930 days | over 365 | cancel note; old and idle |
| T-25 | 57 days | none (its reduction is scheduled) | 57 days | 31–90 | none |
| T-26 | 469 days | 2026-06-01 | 118 days | over 365 | none (not idle) |

1. **Keep** on T-23 with a note removes it from the queue. Recording, editing or deleting any event of T-23 returns it.
2. Changing the idle threshold to 90 days adds T-26 with the reason *old and idle*.
3. **Adjust** on T-26 with −10.00 and a note records an `adjustment`; **Open source** on an imported debt shows its workbook sheet and row.

### 8. Pairs, pay pair and offsets (V4-AT8)

Fixture: T-31, ENT owes KIDS, +120.00 opened 2026-03-01; T-32, ENT owes KIDS, +80.00 opened 2026-05-01; T-33, KIDS owes ENT, +50.00 opened 2026-06-01. Steps 2–5 run in order.

1. The pair ENT–KIDS shows gross $250.00, net *ENT owes KIDS $150.00*, and T-31, T-32, T-33 oldest first. The pay-pair preview offers *Offset T-33 first*.
2. **Offset** T-33 against T-31 on 2026-09-27 defaults to $50.00 and records two `offset` events in one group, with no journal row: T-33 −50 (Paid) and T-31 −50 ($70.00). The pair shows gross $150.00 and net $150.00; ENT's and KIDS's net positions are unchanged; total outstanding falls by $100.00.
3. An offset of $60.00 is refused (*at most $50.00*), and so is one dated after today. Offsetting T-31 against T-32 is refused (same direction). Offsetting T-31 against a debt between ENT and CLTH is refused (different pair). Deleting one offset event deletes both.
4. **Pay pair** ENT → KIDS $160.00 is refused (*at most $150.00*).
5. **Pay pair** ENT → KIDS $100.00 in 2026-09 previews T-31 $70.00 → $0.00 and T-32 $80.00 → $50.00. Saving creates one entry ENT → KIDS $100.00 described *"Pay pair: ENT to KIDS (T-31, T-32)"* and two linked `payment` events (−70, −30). The tie-out shows it tied. **Undo** removes all three.
6. Adding T-34, ENT owes KIDS, +40.00 opened 2026-02-01 with a scheduled −40.00 on 2026-11-01: pay pair skips T-34 and lists it (*has scheduled events*), and an offset involving T-34 is refused.

### 9. Cents in new months (V4-AT9)

Fixture budget version: take-home $5,000.00; HH lines total $3,333.335; PETC $416.6667; LTS $250.00; the residual line "Everything else" funded by ENT.

1. Creating 2026-10 from this version gives expected cash $5,000.00 and allocations HH $3,333.34, PETC $416.67, LTS $250.00 and ENT $999.99 (the exact remainder is $999.9983). They total $5,000.00; the allocation difference is $0.00.
2. Planned amounts keep the exact values (HH 3333.335, PETC 416.6667, ENT 999.9983). The budget comparison shows no override, and **Refresh allocations** proposes the same cents.
3. A version with no residual line, HH $3,333.335 and PETC $1,666.665 against take-home $5,000.00, gives HH $3,333.34 and PETC $1,666.67, and the month shows **Review** with *"Rounding difference of $0.01: add a residual line to the budget, or adjust one allocation"*.
4. An imported month with an allocation of 1234.5678 keeps it exactly and displays $1,234.57. Duplicating that month rounds the new allocation to $1,234.57.
5. A new transfer of $10.005, an allocation of $10.005 and an expected cash of $5,000.005 are refused; an imported posting of −12.3456 is kept exactly.
6. With `amounts_in_cents = 0`, step 1 gives HH 3333.335, PETC 416.6667 and ENT 999.9983, as today.

### 10. Standing amounts and the retained hub line (V4-AT10)

Fixture: month 2026-10 from the Harper current plan (take-home $4,690.96: HH $3,137.00, CLTH $90.00, KIDS $260.00, PETC $180.00, LTS $300.00, TRV $125.00, GIFT $60.00, ENT $538.96), with a journal row ENT → PETC $50.00. Standing amounts: PETC $180.00, LTS $300.00.

1. PETC shows *Automatic $180.00 · By hand $50.00*; LTS shows *Automatic $300.00 · Confirm arrival*; HH shows **Retained**. The to-do list is CLTH $90.00, KIDS $260.00, PETC $50.00 by hand, LTS confirm arrival, TRV $125.00, GIFT $60.00, ENT $488.96.
2. Marking CLTH, KIDS, PETC, LTS, TRV, GIFT and ENT Done makes the month **Complete** without an HH mark.
3. With `hub_line_retained = 0`, the month stays **Ready to transfer** until HH is marked Done.
4. A journal row that makes HH's final transfer −$10.00 still puts the month in **Review**.
5. Changing PETC's budget funding to $200.00 shows *"PETC's standing transfer is $180.00; the budget allocates $200.00"*.
6. With a journal row PETC → ENT $30.00 instead, PETC's final transfer is $150.00 and its by-hand part reads *Send $30.00 back from PETC to the hub*; the month is not in Review.
7. Changing PETC's standing amount to $200.00 leaves 2026-10's line at $180.00; a month created afterwards copies $200.00.

## Track B

### 11. Links (V4-AT11)

1. Linking PETC to Savings ••2222 succeeds; then linking Savings ••6199 to PETC is refused (*"PETC is already linked to Savings ••2222"*).
2. Each of these is refused with its own reason: Card ••6104 to PETC (a card can't hold a cash bucket); an unlinked Savings ••6109 to CARD (a savings account can't hold a card); anything to RELATIVE (a counterparty); anything to an undeclared account (*"Declare its role first"*).
3. **Shared** is not offered. Migrating the v3 acceptance fixture, where Card ••3333 is Shared, plus a second Checking ••6108 also pointing to HH, leaves Card ••3333, Checking ••1111 and Checking ••6108 **not set** and lists them with reasons; no mapping is chosen for the owner.
4. The setup view lists GIFT, KIDS and CLTH as unlinked; their checks show *Not linked*; months and debts work normally.
5. With HH as the hub bucket, giving Checking ••6100 the hub target is refused (*"The hub is already HH's account"*).
6. The link dialog shows the account's name, ••2222 and its latest balance before saving. Relinking is audited and undoable, and links survive **Reconnect**.

### 12. Observed balances and checks (V4-AT12)

Cleared reports exist for 2026-08 and 2026-09. September's funding pairs (built in V4-AT14.0): (paid by CARD, funded by CLTH) $180.00; (CARD, ENT) $112.40; (CARD, GIFT) $30.00; (CARD, TRV) −$25.00; (HH, ENT) $40.00. No proposal is decided yet.

1. **Proof of cash.** Savings ••2222: August month-end estimate $1,200.00; September inflows $400.00, outflows −$310.25, month-end $1,289.75 → **Proven**. With a September month-end of $1,279.75 instead → **Difference −$10.00**, with its explanations.
2. Savings ••6101, waived in September for *no activity*, with $2,500.00 at both month ends → **Proven**. Waived for *data unavailable* instead → **Not available**.
3. Savings ••6102 with only a balance as of 2026-10-04 and no estimate → *Not a month-end balance (as of 4 Oct 2026)*; no difference is computed. With a month-end value that differs from expected by −$12.50 and a recorded `pending_total` of −$12.50 → **Timing**.
4. A typed statement with opening $500.00, entries totalling −$120.00 and closing $380.00 → **Proven**; with closing typed as $308.00 → **Difference −$72.00**.
5. **Economic balance.** With T-41 (HH owes PETC $90.00) and T-42 (PETC owes TRV $30.00) as of 2026-09-30, PETC's economic balance is $1,289.75 + $90.00 − $30.00 = $1,349.75. ENT, observed at $600.00 with no debts, has $600.00 − $112.40 − $40.00 = $447.60, because two settlements it owes are pending.
6. **Card coverage.** Card ••6104 owes $517.40 at month end; T-44 (CLTH owes CARD $200.00); counted pairs $180.00 + $112.40 + $30.00 − $25.00 = $297.40 → covered $497.40, **gap $20.00**. CARD's economic balance is −$517.40 + $200.00 + $297.40 = −$20.00, the negative of the gap. Without funding pairs, coverage uses debts only and says so.
7. **Coverage after decisions.** After V4-AT14's decisions (CLTH and TRV settled now, ENT settled over time as T-61 opened 2026-09-30, GIFT rejected): net position $312.40 (T-44 and T-61) + counted $155.00 (CLTH $180.00, TRV −$25.00; ENT and GIFT count $0.00) = covered $467.40, **gap $50.00**: the original $20.00 plus the rejected $30.00. The over-time debt changed nothing.
8. **Hub, pay in the same month** (separate-hub variant, `hub_pay_month_offset = 0`, cushion $100.00). A September month-end of $246.20 → *$146.20 stayed in the hub*. September take-home income $4,690.96 against September expected cash $4,690.96 → matches; against $4,700.00 → difference −$9.04.
9. **Hub, pay funding the next month** (`hub_pay_month_offset = 1`). The September month-end is $4,937.16, because October's pay arrived in September; every October leg is verified with transfers posted 2026-10-01. Undistributed pay is $4,690.96, and the residual is $4,937.16 − $100.00 − $4,690.96 = $146.20. Before October's legs are verified, the residual is **Not available**.
10. Marking a difference **Explained** with a note records it; an **unavailable** balance skips its checks with the reason. Each Balances row shows the observed balance with its source, owed to and by, pending settlements, economic balance and the check results; clicking PETC's economic balance lists T-41, T-42 and the report row, and clicking the card's gap lists T-44 and the funding pairs.

### 13. Transfer verification (V4-AT13)

Separate-hub variant. Treasury month 2026-10, created before v4 so ENT's allocation carries a fraction: final transfers HH $3,137.00, PETC $230.00, LTS $300.00, CARD $292.40, GIFT $60.00, ENT $488.9583. No standing amounts. The open review for October, gathered 2026-09-24 to 2026-10-15, holds:

| Transactions | Line | Status |
| --- | --- | --- |
| 2026-10-01 ••6100 −3,137.00 · ••1111 +3,137.00 | HH | Verified |
| 2026-10-01 ••6100 −230.00 · ••2222 +230.00 | PETC | Verified |
| 2026-10-02 ••6100 −250.00 · ••6101 +250.00 | LTS | Amount differs by −$50.00 |
| none | CARD | Not found |
| none (GIFT is not linked) | GIFT | Not linked |
| 2026-10-01 ••6100 −300.00 · ••6103 +300.00 and 2026-10-03 ••6100 −188.96 · ••6103 +188.96 | ENT | Possible split ($488.96 at cents) |

1. The owner confirms ENT's split. **Mark verified lines Done** marks HH, PETC and ENT Done in one undoable step; the others stay pending; the month is **Ready to transfer**.
2. Adding a second pair 2026-09-28 ••6100 −230.00 · ••2222 +230.00 makes PETC **Choose**, listing both.
3. Adding 2026-10-09 ••6100 −50.00 · ••6101 +50.00 makes LTS **Possible split** ($250.00 + $50.00).
4. If the review's data for ••6104 ended on 2026-09-29, CARD shows **Not yet gathered** instead of Not found.
5. **Two legs.** With PETC's standing amount $180.00, and these transactions in place of PETC's row in the table: a split direct deposit of +180.00 on ••2222 on 2026-10-01 accepted as take-home income, and ••6100 −50.00 · ••2222 +50.00 on 2026-10-02, verify both legs, and PETC is **Verified**. With PETC's final transfer $150.00 instead, the automatic +180.00 and ••2222 −30.00 · ••6100 +30.00 verify it.
6. After the review is cleared, the badges remain. `transfer_verifications` holds statuses and verified cents only; the canary scan finds no transaction description, individual amount, date or identifier.
7. Changing PETC's allocation marks its verification **Stale**.
8. In the default variant (HH is the hub bucket), HH shows **Retained** and no transfer is searched for.
9. **Outside the plan, between buckets.** A pair 2026-10-12 ••2222 −75.00 · ••6103 +75.00 is listed. With T-52 (PETC owes ENT $100.00), **Record as payment on a debt** records −75.00 on T-52. **Record as debt** instead, with Loan ID T-51, creates ENT owes PETC $75.00, opened 2026-10-31, described *"Transfer from PETC to ENT, October 2026"*. **Reverse through funding** instead creates a journal row ENT → PETC $75.00 in the chosen open month. **Ignore** requires a reason and stores only a count for the month.
10. **Outside the plan, with the hub.** A pair 2026-10-14 ••6100 −40.00 · ••1111 +40.00 is listed with **Count toward a line** and **Ignore**. With November created and its CARD line at $120.00, a pair 2026-10-29 ••6100 −120.00 · ••6104 +120.00 matches November's CARD leg: it is not listed, and October's CARD line stays **Not found** rather than Amount differs.
11. No line is ever marked Done without the owner's click, and the status is the same with or without verification.

### 14. Settlement proposals (V4-AT14)

0. **Building the pairs.** A synthetic September review has accepted budget parts on Card ••6104: Clothing (funded by CLTH) −60.00, −70.00, −50.00; Everything else (ENT) −62.40, −50.00; Birthdays and holidays (GIFT) −30.00; Summer trip fund (TRV) +25.00 (a refund); on Checking ••1111: Everything else (ENT) −40.00 and Groceries (HH) −95.00; and, in the separate-hub variant, Everything else −15.00 on ••6100. Clearing writes exactly: (CARD, CLTH) $180.00 in 3; (CARD, ENT) $112.40 in 2; (CARD, GIFT) $30.00 in 1; (CARD, TRV) −$25.00 in 1; (HH, ENT) $40.00 in 1; and a hub-paid ENT row of $15.00 for information. Groceries adds nothing.
1. Open month 2026-10 shows five proposals: CLTH → CARD $180.00; ENT → CARD $112.40; GIFT → CARD $30.00; CARD → TRV $25.00; ENT → HH $40.00. The hub-paid row produces none.
2. **Settle now** on CLTH → CARD creates a journal row CLTH → CARD $180.00 described *"Settlement: CLTH purchases on CARD, September 2026"*; the decision links to it, and the proposal can't be decided again.
3. **Settle over time** on ENT → CARD with Loan ID T-61 and terms "3 months" creates ENT owes CARD $112.40, opened 2026-09-30.
4. **Split** on ENT → HH into $25.00 now and $15.00 over time (T-62) succeeds; $25.00 and $10.00 is refused (*parts must total $40.00*).
5. **Reject** on GIFT → CARD records the reason and creates nothing.
6. **Settle now** on CARD → TRV creates CARD → TRV $25.00; CARD's October final transfer is $155.00. In a month with no other CARD settlement, the same proposal defaults to **Settle over time**, because settling now would make CARD's final transfer −$25.00.
7. Accepting several in bulk is one undo step.
8. T-44 (CLTH owes CARD) appears beside the CLTH proposal. An existing journal row CLTH → CARD $180.00 in 2026-10, or a debt CLTH owes CARD $180.00 opened 2026-09-20, flags it as a possible duplicate.
9. Re-running September and clearing a new report with (CARD, CLTH) $195.00 shows *Changed since decided: now $195.00, decided $180.00* and offers $15.00 as a new proposal, whose decision is stored with sequence 2 and supersedes the first. The $180.00 row is unchanged.
10. Journal, allocation, debt and Done state are unchanged, row for row, after clearing and before any acceptance. No fixture merchant or description appears in any treasury table or the audit log.
11. A report cleared without funding pairs yields no proposals and says why.

### 15. Floors, targets and sweeps (V4-AT15)

1. PETC with floor $500.00 and target $1,500.00 and an observed $420.00 shows *PETC is $80.00 under its floor*. Accepting with ENT as the source creates a journal row ENT → PETC $80.00 in the chosen month.
2. TRV with target $800.00, sweep destination LTS and an observed $950.00 shows *TRV is $150.00 over its target. Move it to LTS?*; accepting creates TRV → LTS $150.00.
3. LTS, with neither set, shows no suggestion. A floor above the target is refused. No allocation changes in any case.

### 16. Month-end close (V4-AT16)

Clock 2026-10-06, so M = 2026-09 and N = 2026-10.

1. In a profile with Track A only: steps 1–3 show **Needs connected accounts**; step 4 shows the V4-AT4 exceptions; step 5 is Done once 2026-10 exists and is Ready to transfer; step 6 is Done once 2026-09 is closed. Each step's link opens its screen (Monthly Reconciliation for 2026-09, Interaccount Debts, Monthly Reconciliation for 2026-10).
2. With Track B: while the September review is open, step 1 is **In progress** and shows how many of September's lines are verified and how many are unresolved. Clearing then warns that unresolved lines can't be verified afterwards; after clearing, step 1 is Done. With the V4-AT14 proposals pending, step 2 reads *5 to decide*. With the V4-AT12 differences unexplained, step 3 lists them.
3. Closing 2026-09 while steps 2–4 are not done succeeds under the existing rules. No table stores the checklist.

## Both tracks

### 17. Migration, backup, import and export (V4-AT17)

1. Migrating a v0.2.2 (schema version 3) fixture and a v0.3.0-preview.2 (schema version 5) fixture changes no pre-existing column of any row (hash comparison). Roles are empty, every setting holds its pre-v4 value, and every existing event is `recorded`.
2. JSON backups from v0.2.2 and v3 restore into v4 and migrate forward.
3. A v4 backup round trip reproduces roles, the hub, settings, standing amounts, event types, reasons, offset groups, related events, link purposes and origins, institution links, acknowledgements, reviews, decisions, verifications and funding pairs.
4. The workbook export imported into a fresh profile reproduces roles, hub, account standing amounts, event types, reasons, offset groups and related Loan IDs; Loan IDs with hyphens remain text. Links between events and journal rows are empty after import, and **Link history** proposes every one of them again.
5. A `replace` import keeps roles, the hub, standing amounts, floors, targets, sweep destinations and links; deletes acknowledgements, debt reviews and verifications; keeps settlement decisions with their links cleared and marked *record removed by import*, without re-proposing them; and its preview lists the app-entered write-offs, offsets, claims and reassignments it will remove.
6. Reference workbook (local only): in all-recorded-events mode the non-zero count, total outstanding, largest debt and every net position match the private snapshot.

### 18. Critical end-to-end flows (V4-AT18)

Automate with Playwright in the demo and the private build:

- Answer the setup questions, declare roles and the hub → create a month → the counterparty is refused an allocation.
- Transfer with a Loan ID → debt updated in the same save → **Undo** removes both; a transfer matching an existing event links it.
- Another bucket pays → claim created → summary and net positions update.
- Offset, then pay pair → pair view and summary update → tie-out tied.
- Write off a canceled debt and reassign a card debt → review queue and headline update → switch to all recorded events.
- Track B, demo sample files: gather and classify → verify and **Mark verified lines Done** → clear → decide proposals → check balances → close from the Dashboard checklist.
- Keyboard only: choose the debt effect in the transfer form, write off, reassign, pay pair, offset, resolve a tie-out item and decide a proposal, without the mouse.
- The same close at 390 px.

## Release gate

The v4 release report lists every V4-AT test with its automated test name or recorded manual result, alongside the existing gate in [Acceptance tests](../acceptance-tests.md#release-gate) and the [v3 gate](../v3/acceptance-tests.md#release-gate).
