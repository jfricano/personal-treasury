# V4 acceptance tests

These extend the [existing acceptance tests](../acceptance-tests.md) and the [v3 acceptance tests](../v3/acceptance-tests.md), which all still apply. Test names in `tests/` refer to these as V4-AT1–V4-AT18. Amounts are invented fixture values, not the demo's seeded figures unless a test says so.

**Fixture household.** The Harper accounts (HH, PETC, LTS, TRV, KIDS, CLTH, GIFT, ENT), plus `CARD` (kind card) and `RELATIVE` (kind counterparty). Kinds: every Harper account is `cash`; HH is the hub bucket unless a test says otherwise. The clock is fixed at **2026-09-27** in America/Los_Angeles unless stated. Loan IDs in these tests start with `T-`, so they never collide with the demo's `H-` loans.

**Track B institution accounts.** Checking ••1111 → HH; Savings ••2222 → PETC; Savings ••3333 → LTS; Savings ••4444 → TRV; Checking ••9999 → ENT; Card ••5555 → CARD; Brokerage ••6666 and Student loan ••7777 outside the treasury. The **separate-hub** variant adds Checking ••0001 with the hub role, and HH is then not the hub bucket.

## Track A

### 1. Account kinds and the hub (V4-AT1)

1. After migration every account's kind is **Not declared**, and every month, final transfer, status and debt figure is unchanged.
2. With `RELATIVE` declared a counterparty: creating 2026-10 from the budget creates no RELATIVE line; setting RELATIVE's allocation to $10.00 is refused with *"RELATIVE is a counterparty and can't receive an allocation"*; a transfer HH → RELATIVE is refused; a debt T-20, HH owes RELATIVE $400.00, can be created.
3. A legacy month imported before RELATIVE was declared, with a posting RELATIVE +$25.00, keeps the posting and its final transfer, and shows *"Posting on a counterparty account"*.
4. `CARD` gets a $0.00 line in a new month when no budget line funds it. Moving the Clothing line's funding to CARD shows the card warning and changes nothing else.
5. Marking HH the hub succeeds; then marking LTS is refused (*"HH is already the hub"*) and marking CARD is refused (*"Only a cash bucket can be the hub"*).
6. Importing a workbook that introduces codes `VISA2` (named "Visa card") and `GRANDMA` leaves both **Not declared**. A `replace` import of the Harper workbook keeps HH's hub flag and CARD's kind.
7. Changing ENT to counterparty while ENT has $538.96 allocated in an open month is refused. A kind change is audited, and **Undo** restores the previous kind.
8. PETC is `cash`; its description is unchanged, and no behavior depends on it.

### 2. A debt payment entered once (V4-AT2)

Fixture: T-01, KIDS owes ENT, opened 2026-07-10 with +$200.00. Open month 2026-09.

1. Adding a transfer KIDS → ENT $80.00 dated 2026-09-05 with Loan ID T-01 previews *"T-01: KIDS owes ENT $200.00 → $120.00"*. Saving creates one entry (KIDS −80, ENT +80) and one `payment` event of −80 dated 2026-09-05, linked to the entry. T-01 is $120.00. One **Undo** removes both.
2. With **Record on Loan T-01** unticked, only the entry is saved; T-01 stays $200.00 and the tie-out lists the entry.
3. After step 1, a transfer ENT → KIDS $30.00 on T-01 records an `adjustment` of +30; T-01 is $150.00.
4. Editing the step 1 transfer to $90.00 changes its event to −90 in the same transaction (T-01 $110.00 without step 3). Deleting it asks whether to delete the event; the default deletes both and T-01 returns to $200.00.
5. A transfer naming T-99 (no such debt) saves with no event and appears in the tie-out as *Unknown Loan ID*.
6. T-02, KIDS owes ENT, has +50.00 then −70.00 (ENT owes KIDS $20.00). A transfer ENT → KIDS $20.00 on T-02 records a `payment` of +20 and T-02 is **Paid**.
7. A transfer amount of $80.005 is refused: *"Use at most two decimal places"*.

### 3. Another account pays: the claim (V4-AT3)

Fixture: T-03, TRV owes LTS, opened 2026-06-01 with +$300.00.

1. A transfer HH → LTS $100.00 on 2026-09-06 naming T-03 opens the claim dialog. With the default, **HH takes the claim**, and Loan ID `T-03-HH`:
   - T-03 gets a `payment` of −100 and is $200.00;
   - a new debt T-03-HH, TRV owes HH, opened 2026-09-06, description *"Paid T-03 for TRV"*, opening +$100.00, linked to the entry as a claim;
   - net positions: TRV −$300.00, LTS +$200.00, HH +$100.00, summing to $0.00;
   - the entry is tied in the tie-out.
2. With an existing T-04, TRV owes HH $40.00, choosing **Add to T-04** records an `adjustment` of +100: T-04 is $140.00 and T-03 is $200.00.
3. Choosing **No claim** leaves T-03 at $200.00 and nothing else: TRV −$200.00, LTS +$200.00, HH $0.00.
4. A transfer HH → PETC $100.00 naming T-03 shows no dialog, records no event, and appears as *Accounts differ from the debt's parties*.
5. If `T-03-HH` already exists, saving is refused until the owner types another Loan ID.

### 4. Tie-out and link history (V4-AT4)

Fixture for treasury month 2026-09:

| Record | Expected |
| --- | --- |
| E1: 2026-09-05 KIDS → ENT $40.00, T-01, linked payment −40 | Not listed (tied) |
| E2: 2026-09-06 TRV → LTS $60.00 naming T-03, no event | *Journal row without matching debt event* |
| E3: 2026-09-07 HH → PETC $25.00, no Loan ID | Not listed |
| T-05 (PETC owes LTS): payment −70.00 on 2026-09-15, no entry | *Debt payment without journal row* |
| T-06: write-off on 2026-09-20 | Not listed |
| T-07: opened 2026-09-10 with +90.00 | Not listed |
| T-08 (HH owes RELATIVE): payment −50.00 on 2026-09-12 | *Outside payment* (informational) |
| T-09: payment −30.00 on 2026-09-29 | Not listed (scheduled) |
| T-10: +40.00 on 2026-09-18 on an open debt | Not listed (an increase) |

1. The panel shows two exceptions and one outside payment. The month's status is **Ready to transfer** with or without them.
2. Acknowledging E2 with a note leaves one exception. Editing E2's amount afterwards lists it again.
3. Every item links to its row; imported items also show their workbook sheet and range.
4. **Link history.** An imported legacy month 2026-03 has an entry with loan ID empty and description *"Loan T-11"*, TRV → LTS $50.00, and T-11 (TRV owes LTS) has an imported event −50.00 dated 2026-02-28. The link is proposed. Accepting it sets the event's link with origin *accepted proposal*; the event's amount, date, notes, source sheet and range are byte-identical to before. **Undo** removes the link.
5. With a second imported T-11 event of −50.00 dated 2026-03-01, nothing is proposed and both candidates are listed.

### 5. The as-of debt summary (V4-AT5)

Fixture:

- T-21, HH owes LTS: +600.00 on 2026-06-01; −200.00 on 2026-07-01; −200.00 on 2026-08-01; −200.00 on 2026-10-01.
- T-22, ENT owes CLTH: +150.00 on 2026-10-15.
- T-23, KIDS owes PETC: +90.00 on 2026-05-01; −120.00 on 2026-09-01.

| Mode | Debts shown | Count | Total | Largest |
| --- | --- | --- | --- | --- |
| As of 2026-09-27 (default) | T-21 HH owes LTS $200.00; T-23 PETC owes KIDS $30.00; T-22 under **Scheduled** (opens 2026-10-15) | 2 | $230.00 | $200.00 |
| All recorded events | T-22 ENT owes CLTH $150.00; T-23 PETC owes KIDS $30.00; T-21 Paid | 2 | $180.00 | $150.00 |
| As of 2026-07-15 | T-21 HH owes LTS $400.00; T-23 KIDS owes PETC $90.00 | 2 | $490.00 | $400.00 |

1. The events dated 2026-10-01 and 2026-10-15 are labelled **Scheduled** in the as-of-today view, and the Dashboard headline reads *as of 27 Sep 2026* with *2 scheduled events*.
2. Net positions sum to $0.00 in every mode.
3. For the Harper sample, all-events mode gives count 4, total $785.00 and largest $300.00, equal field for field to the pre-v4 summary. As-of-today mode gives the same figures, including with the clock set to the first day of a month.
4. The export's Interco Debt Summary sheet uses all recorded events and says so.

### 6. Write-offs (V4-AT6)

Fixture: T-24, ENT owes LTS, opened 2025-01-20 with +245.00 and the note "canceled"; T-25, HH owes LTS, +300.00 on 2026-08-01 and −100.00 on 2026-11-01; T-23 as in V4-AT5.

1. Before any write-off, T-24 is in the summary and in the review queue with the reason *cancel note*.
2. Writing off T-24 on 2026-09-27 with the reason "Returned; never repaid" records a `write_off` event of −245.00, computed by the app. T-24 shows **Written off**, leaves the summary, and the total falls by $245.00. The 2026-09 tie-out doesn't list it.
3. A write-off with a blank reason is refused.
4. Writing off T-25 on 2026-09-27 is refused, naming the event dated 2026-11-01. Writing it off on 2026-11-01 records −200.00.
5. Writing off T-23 (PETC owes KIDS $30.00) records +30.00.
6. As of 2026-09-26, T-24 still shows $245.00 outstanding.
7. Deleting the write-off asks for confirmation and returns T-24 to $245.00; **Undo** restores the write-off.

### 7. Aging and the review queue (V4-AT7)

As of 2026-09-27, with the V4-AT5 and V4-AT6 fixtures before any write-off, plus T-26, HH owes PETC, +80.00 on 2025-06-15 and −20.00 on 2026-06-01:

| Debt | Age | Last reduction | Idle | Group | Queue reasons |
| --- | --- | --- | --- | --- | --- |
| T-21 | 118 days | 2026-08-01 | 57 days | 91–180 | none |
| T-23 | 149 days | 2026-09-01 | 26 days | 91–180 | reversed |
| T-24 | 615 days | none | 615 days | over 365 | cancel note; old and idle |
| T-26 | 469 days | 2026-06-01 | 118 days | over 365 | none (not idle) |

1. **Keep** on T-23 with a note removes it from the queue. Recording any new event on T-23 returns it.
2. Changing the idle threshold to 90 days adds T-26 with the reason *old and idle*.

### 8. Pairs, pay pair and offsets (V4-AT8)

Fixture: T-31, ENT owes KIDS, +120.00 opened 2026-03-01; T-32, ENT owes KIDS, +80.00 opened 2026-05-01; T-33, KIDS owes ENT, +50.00 opened 2026-06-01.

1. The pair ENT–KIDS shows gross $250.00, net *ENT owes KIDS $150.00*, and T-31, T-32, T-33 oldest first.
2. **Offset** T-33 against T-31 on 2026-09-27 defaults to $50.00 and records two `offset` events in one group, with no journal row: T-33 −50 (Paid) and T-31 −50 ($70.00). The pair shows gross $150.00 and net $150.00; ENT's and KIDS's net positions are unchanged; total outstanding falls by $100.00.
3. An offset of $60.00 is refused (*at most $50.00*). Offsetting T-31 against T-32 is refused (same direction). Offsetting T-31 against a debt between ENT and CLTH is refused (different pair). Deleting one offset event deletes both.
4. After the offset, **Pay pair** ENT → KIDS $100.00 in 2026-09 previews T-31 $70.00 → $0.00 and T-32 $80.00 → $50.00. Saving creates one entry ENT → KIDS $100.00 described *"Pay pair: ENT to KIDS (T-31, T-32)"* and two linked `payment` events (−70, −30). The tie-out shows it tied. **Undo** removes all three.
5. Pay pair of $160.00 is refused (*at most $150.00*).
6. Without the offset, the pay-pair preview offers *Offset T-33 first*.

### 9. Cents in new months (V4-AT9)

Fixture budget version: take-home $5,000.00; HH lines total $3,333.335; PETC $416.6667; LTS $250.00; the residual line "Everything else" funded by ENT.

1. Creating 2026-10 from this version gives expected cash $5,000.00 and allocations HH $3,333.34, PETC $416.67, LTS $250.00 and ENT $999.99 (the exact remainder is $999.9983). They total $5,000.00; the allocation difference is $0.00.
2. Planned amounts keep the exact values (HH 3333.335, PETC 416.6667, ENT 999.9983). The budget comparison shows no override, and **Refresh allocations** proposes the same cents.
3. A version with no residual line, HH $3,333.335 and PETC $1,666.665 against take-home $5,000.00, gives HH $3,333.34 and PETC $1,666.67, and the month shows **Review**: *Allocations exceed expected cash by $0.01*.
4. An imported month with an allocation of 1234.5678 keeps it exactly and displays $1,234.57. Duplicating that month rounds the new allocation to $1,234.57.
5. A new transfer of $10.005 is refused; an imported posting of −12.3456 is kept exactly.

### 10. Standing amounts and the retained hub line (V4-AT10)

Fixture: month 2026-10 from the Harper current plan (take-home $4,690.96: HH $3,137.00, CLTH $90.00, KIDS $260.00, PETC $180.00, LTS $300.00, TRV $125.00, GIFT $60.00, ENT $538.96), with a journal row ENT → PETC $50.00. Standing amounts: PETC $180.00, LTS $300.00. OD16 accepted.

1. PETC shows *Automatic $180.00 · By hand $50.00*; LTS shows *Automatic $300.00* and is not on the to-do list; HH shows **Retained**. The to-do list is CLTH $90.00, KIDS $260.00, PETC $50.00, TRV $125.00, GIFT $60.00, ENT $488.96.
2. Marking CLTH, KIDS, PETC, LTS, TRV, GIFT and ENT Done makes the month **Complete** without an HH mark.
3. With the retained setting off, the month stays **Ready to transfer** until HH is marked Done.
4. A journal row that makes HH's final transfer −$10.00 still puts the month in **Review**.
5. Changing PETC's budget funding to $200.00 shows *"PETC's standing transfer is $180.00; the budget allocates $200.00"*.
6. With a journal row PETC → ENT $30.00 instead, PETC's final transfer is $150.00 and its by-hand part reads *Send $30.00 back from PETC to the hub*; the month is not in Review.

## Track B

### 11. Links (V4-AT11)

1. Linking PETC to Savings ••2222 succeeds; then linking Savings ••8888 to PETC is refused (*"PETC is already linked to Savings ••2222"*).
2. Linking Card ••5555 to PETC, Savings ••4444 to CARD, anything to RELATIVE, or anything to an undeclared account is refused with the reason.
3. **Shared** is not offered. Migrating a v3 fixture where Card ••5555 is Shared, and two institution accounts both point to HH, leaves all three **not set** and lists them; no mapping is chosen for the owner.
4. The setup view lists every active cash bucket and card without a link; their checks show *Not linked*; months and debts work normally.
5. With HH as the hub bucket, giving Checking ••0001 the hub role is refused (*"The hub is already HH's account"*).
6. The link dialog shows the account's name, ••2222 and its latest balance before saving. Relinking is audited and undoable, and links survive **Reconnect**.

### 12. Observed balances and checks (V4-AT12)

Cleared reports exist for 2026-08 and 2026-09.

1. **Proof of cash.** Savings ••2222: August month-end estimate $1,200.00; September inflows $400.00, outflows −$310.25, month-end $1,289.75 → **Proven**. With a September month-end of $1,279.75 instead → **Difference −$10.00**, with its explanations.
2. Savings ••3333, waived in September for *no activity*, with $2,500.00 at both month ends → **Proven**.
3. Savings ••4444 with only a balance as of 2026-10-04 and no estimate → *Not a month-end balance (as of 4 Oct 2026)*; no difference is computed.
4. A typed statement with opening $500.00, entries totalling −$120.00 and closing $380.00 → **Proven**; with closing typed as $308.00 → **Difference −$72.00**.
5. **Economic balance.** With T-41 (HH owes PETC $90.00) and T-42 (PETC owes TRV $30.00) as of 2026-09-30, PETC's economic balance is $1,289.75 + $90.00 − $30.00 = $1,349.75. The Balances footer's identity holds to the cent, with T-20 (HH owes RELATIVE) among the debts with counterparties.
6. **Card coverage.** Card ••5555 owes $512.40 at month end; T-44 (CLTH owes CARD $200.00); September funding pairs (CARD, CLTH) $180.00 and (CARD, ENT) $112.40 → covered $492.40, **gap $20.00**. Without funding pairs, coverage uses debts only and says so.
7. **Hub** (separate-hub variant). Cushion $100.00 and a September month-end of $246.20 → *$146.20 stayed in the hub*. With pay funding the next month: September take-home income $4,690.96 against October expected cash $4,690.96 → matches; against $4,700.00 → difference −$9.04.
8. Marking a difference **Explained** with a note records it; an **unavailable** balance skips its checks with the reason.

### 13. Transfer verification (V4-AT13)

Separate-hub variant. Treasury month 2026-10, created before v4 so ENT's allocation carries a fraction: final transfers HH $3,137.00, PETC $230.00, LTS $300.00, CARD $292.40, ENT $488.9583. The open review holds:

| Transactions | Line | Status |
| --- | --- | --- |
| 2026-10-01 ••0001 −3,137.00 · ••1111 +3,137.00 | HH | Verified |
| 2026-10-01 ••0001 −230.00 · ••2222 +230.00 | PETC | Verified |
| 2026-10-02 ••0001 −250.00 · ••3333 +250.00 | LTS | Amount differs by −$50.00 |
| none | CARD | Not found |
| 2026-10-01 ••0001 −300.00 · ••9999 +300.00 and 2026-10-03 ••0001 −188.96 · ••9999 +188.96 | ENT | Possible split ($488.96 at cents) |

1. The owner confirms ENT's split. **Mark verified lines Done** marks HH, PETC and ENT Done in one undoable step; LTS and CARD stay pending; the month is **Ready to transfer**.
2. Adding a second pair 2026-09-28 ••0001 −230.00 · ••2222 +230.00 makes PETC **Choose**, listing both.
3. After the review is cleared, the badges remain. `transfer_verifications` holds statuses and verified cents only; the canary scan finds no transaction description, individual amount, date or identifier.
4. Changing PETC's allocation marks its verification **Stale**.
5. In the default variant (HH is the hub bucket), HH shows **Retained** and no transfer is searched for.
6. **Outside the plan.** A pair 2026-10-12 ••2222 −75.00 · ••9999 +75.00 is listed. **Record as debt** with Loan ID T-51 creates ENT owes PETC $75.00, opened 2026-10-12, described *"Transfer from PETC to ENT, October 2026"*. **Reverse through funding** instead creates a journal row ENT → PETC $75.00 in the chosen open month. **Ignore** requires a reason.
7. No line is ever marked Done without the owner's click, and the status is the same with or without verification.

### 14. Settlement proposals (V4-AT14)

Report 2026-09 funding pairs: (paid by CARD, funded by CLTH) $180.00 in 3 parts; (CARD, ENT) $112.40 in 2; (HH, ENT) $40.00 in 1; (CARD, TRV) −$25.00 in 1 (a refund).

1. Open month 2026-10 shows four proposals: CLTH → CARD $180.00; ENT → CARD $112.40; ENT → HH $40.00; CARD → TRV $25.00.
2. **Settle now** on the first creates a journal row CLTH → CARD $180.00 described *"Settlement: CLTH purchases on CARD, September 2026"*, linked to the proposal, which can't be decided again.
3. **Settle over time** on the second with Loan ID T-61 and terms "3 months" creates ENT owes CARD $112.40, opened 2026-09-30.
4. **Split** on the third into $25.00 now and $15.00 over time succeeds; $25.00 and $10.00 is refused (*parts must total $40.00*).
5. **Reject** on the fourth records the reason and creates nothing.
6. Accepting several in bulk is one undo step.
7. T-44 (CLTH owes CARD) appears beside the first proposal. An existing journal row CLTH → CARD $180.00 in 2026-10 flags it as a possible duplicate.
8. Re-running September and clearing a new report with (CARD, CLTH) $195.00 shows *Changed since decided: now $195.00, decided $180.00* and offers $15.00 as a new proposal. The $180.00 row is unchanged.
9. Journal, allocation and debt tables are unchanged, row for row, after clearing and before any acceptance. No fixture merchant or description appears in any treasury table or the audit log.
10. A report cleared without funding pairs yields no proposals and says why.

### 15. Floors, targets and sweeps (V4-AT15)

1. PETC with floor $500.00 and target $1,500.00 and an observed $420.00 shows *PETC is $80.00 under its floor*. Accepting with ENT as the source creates a journal row ENT → PETC $80.00 in the chosen month.
2. TRV with target $800.00, sweep destination LTS and an observed $950.00 shows *TRV is $150.00 over its target. Move it to LTS?*; accepting creates TRV → LTS $150.00.
3. LTS, with neither set, shows no suggestion. A floor above the target is refused. No allocation changes in any case.

### 16. Month-end close (V4-AT16)

Clock 2026-10-06, so M = 2026-09 and N = 2026-10.

1. In a profile with Track A only: steps 1–3 show **Needs connected accounts**; step 4 shows the V4-AT4 exceptions; step 5 is Done once 2026-10 exists and is Ready to transfer; step 6 is Done once 2026-09 is closed.
2. With Track B: while the September review is open, step 1 is **In progress**; after clearing, Done. With the four V4-AT14 proposals pending, step 2 reads *4 to decide*. With the V4-AT12 differences unexplained, step 3 lists them.
3. Closing 2026-09 while steps 2–4 are not done succeeds under the existing rules. No table stores the checklist.

## Both tracks

### 17. Migration, backup, import and export (V4-AT17)

1. Migrating a v0.2.2 (schema version 3) fixture and a v3 fixture changes no pre-existing column of any row (hash comparison). Kinds are empty and every existing event is `recorded`.
2. JSON backups from v0.2.2 and v3 restore into v4 and migrate forward.
3. A v4 backup round trip reproduces kinds, the hub, standing amounts, event kinds, reasons, offset groups, link roles and origins, links, acknowledgements, reviews, decisions, verifications and funding pairs.
4. The workbook export imported into a fresh profile reproduces kinds, hub, standing amounts, event kinds and reasons; Loan IDs with hyphens remain text.
5. A `replace` import keeps kinds, the hub and links, and its preview lists the app-entered write-offs, offsets and claims it will remove.
6. Reference workbook (local only): in all-recorded-events mode the non-zero count, total outstanding, largest debt and every net position match the private snapshot.

### 18. Critical end-to-end flows (V4-AT18)

Automate with Playwright in the demo and the private build:

- Declare kinds and the hub → create a month → the counterparty is refused an allocation.
- Transfer with a Loan ID → debt updated in the same save → **Undo** removes both.
- Another bucket pays → claim created → summary and net positions update.
- Offset, then pay pair → pair view and summary update → tie-out tied.
- Write off a canceled debt → review queue and headline update → switch to all recorded events.
- Track B, demo sample files: gather and classify → verify and **Mark verified lines Done** → clear → decide proposals → check balances → close from the Dashboard checklist.
- The same close at 390 px.

## Release gate

The v4 release report lists every V4-AT test with its automated test name or recorded manual result, alongside the existing gate in [Acceptance tests](../acceptance-tests.md#release-gate) and the [v3 gate](../v3/acceptance-tests.md#release-gate).
