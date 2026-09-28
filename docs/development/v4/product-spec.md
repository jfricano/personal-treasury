# Personal Treasury v4: product specification

Status: proposed direction, pending owner review of the decisions in §9 and the v3 amendments in §10 · 2026-09-27

V4 makes each treasury account formally one real account and uses that fact to check the treasury against reality. It also makes the debt workflow single-entry and shows debts as of a date. The treasury rules in [Data model and calculation rules](../data-and-rules.md) stay in force except where [Treasury rules §18](treasury-rules.md#18-domain-rules-kept-extended-or-changed) marks a change, and every such change is an owner decision.

Companion documents:

- [Treasury rules](treasury-rules.md): the calculation and data contract for v4.
- [Implementation plan](implementation-plan.md): branches, Track A and Track B, build order and release gate.
- [Acceptance tests](acceptance-tests.md): the behaviors v4 must pass.
- Decision: [ADR 0011](../decisions/0011-treasury-accounts-are-physical-accounts.md).
- V3, which v4 builds on: [v3 specification](../v3/README.md).

## 1. The owner's question and the answer

The owner asked:

> "I believe that in the end, I'm using these treasury accounts as 'physical' accounts. So there should be a 1:1 relationship there. If there are efficiencies in the way we can set things up, I'm not sure we've fully taken advantage of them."

An accounting review of the treasury logic, the imported history and the v3 specification answered:

1. **Yes, 1:1 is right, with named exceptions.** Each cash bucket behaves like one bank account, and each card code behaves like one credit card. The exceptions are:
   - the account where pay lands, which the treasury doesn't model at all (the **hub**);
   - cards, which are one real account each but are *debts* that several buckets spend on;
   - codes that are not accounts at all, such as a person who lent money (**counterparties**);
   - real accounts that sit outside the treasury on purpose, such as a brokerage account or a student loan.

   The structure that fits is an explicit **kind** for every treasury account, declared by the owner, plus a **required link** from each cash bucket and card to exactly one real account.
2. **The netting is already as efficient as it can be.** Each bucket's final transfer is `allocation + transfers in − transfers out`, and the owner sends one real transfer per account. That is multilateral netting through the hub, the same thing a company's in-house bank does. An analysis of the owner's history confirms that it already reaches the minimum number of real transfers for the same end balances in every month; netting journal rows by pair first would add transfers, not remove them. **V4 must not re-optimize netting.**
3. **What 1:1 makes possible has not been used yet.** Once a bucket *is* a bank account, the bank reports its balance for free. The app can then check itself without keeping a ledger of every purchase: the balance is observed, not computed. With 1:1, an interaccount debt is money sitting in the wrong real account, and that reframing drives every change below.
4. **Three changes need no bank data** and can ship before or alongside v3: declare each account's kind; enter each debt payment once and tie the journal to the debt ledger; show the debt summary as of a date, with an explicit write-off. The rest becomes cheap once v3 brings in real account data: observed-balance checks, bank-verified transfers and proposed settlements.

## 2. Goals and non-goals

### Goals

- Record, once, which real account each treasury account is, and what kind of account it is.
- Record each debt payment once, and show every journal row and debt event that don't agree.
- Show the debts that exist **today**, separately from payments scheduled for later months, and close a canceled debt honestly.
- Check each bucket and card against its real balance every month, and show every difference with a likely explanation.
- Confirm the month's real transfers from bank data in one click, to the cent.
- Turn last month's spending from the wrong account or card into ready-made settlement entries the owner accepts.
- Put the month-end steps, now spread over four screens, on one checklist.
- Keep every existing calculation, import, export, undo and backup behavior, and every v3 behavior, intact.

### Non-goals for v4

- **Re-optimizing netting.** The final transfers are already the minimum; v4 adds no pairwise or per-debt real transfers.
- **The app moving money.** No sweeps, card payments or transfers. Institution access stays read-only, as in v3.
- **Computing book balances from allocations** or from spending. Balances are always observed from the institution, never derived from the plan.
- A general ledger, a permanent transaction history, or running balances built from transactions. V3's rule that raw transactions are temporary stands.
- Replacing Loan IDs with one running balance per account pair. The pair view is a view; Loan IDs stay the record.
- Automatic debt creation, settlement, offset or write-off. Everything that changes financial meaning is accepted by the owner, one proposal at a time or in a previewed batch.
- Interest on internal debts, or interaccount debts in net worth.
- Inferring an account's kind or link from its code, name or transactions.
- Cleaning the owner's imported history. The app gives the owner the tools (review queues, write-offs, adjusting events); the owner's specific review questions are private.

## 3. Glossary

Existing words keep their meaning, including v3's **treasury account**, **institution account**, **spending review** and **spending report**.

| Term | Meaning |
| --- | --- |
| **Account kind** | What a treasury account physically is, declared by the owner: **cash bucket** (`cash`: a pot of the owner's money held in one deposit account), **card** (`card`: one credit card account; its code is the card's payment envelope), or **counterparty** (`counterparty`: a person or an account outside the treasury that is party to a debt, with no allocation and no final transfer). An account whose kind hasn't been declared behaves exactly as in v3. |
| **Hub** | Where pay lands and from where the final transfers leave. Either a cash bucket that doubles as the pay account (for example HH), or a separate deposit account that belongs to no bucket. Exactly one. |
| **Link** | The owner's statement that a treasury account *is* one institution account. Cash buckets and cards each have exactly one link; each institution account links to at most one treasury account, is the separate hub, or is marked **outside the treasury**. |
| **Retained line** | The hub bucket's own monthly line when the hub is a bucket: its money is already where it belongs, so no transfer is needed (owner decision OD16). |
| **Standing amount** | The part of a bucket's allocation that the owner's bank moves automatically on payday. Only the rest, the **by-hand amount**, is on the month's to-do list. |
| **As-of date** | The date a debt summary describes. The summary counts only events dated on or before it. **All recorded events** is the mode the migration controls use. |
| **Scheduled event** | A debt event dated after the as-of date, such as a pre-entered installment. Shown, labelled, never counted. |
| **Write-off** | A dated, zero-cash debt event with a required reason that brings a debt's balance to zero without pretending a payment happened. Always the owner's explicit act. |
| **Offset** | A pair of zero-cash events that cancels two opposite debts between the same two accounts by the same amount. |
| **Pair view** | One row per pair of accounts with open debts between them: the pair's net balance and its Loan IDs. |
| **Pay pair** | One transfer between two accounts that pays the pair's debts, oldest first, with a preview. |
| **Tie-out** | The monthly comparison of journal rows that name a debt with the debt events they should have produced, and the reverse. |
| **Observed balance** | A treasury account's balance as the institution reports it at month end, taken from its linked institution account in the cleared spending report. Never computed. |
| **Proof of cash** | The check that last month's closing balance plus this month's inflows and outflows equals this month's closing balance, per institution account. |
| **Economic balance** | A bucket's observed balance plus what others owe it minus what it owes others: what it really has after its debts. |
| **Card coverage** | A card's balance owed compared with what the treasury says will pay for it: the debts owed to the card plus the month's charges attributed to buckets. |
| **Verification** | Evidence from bank data that a final transfer happened, at the same amount to the cent. A badge beside **Done**, never a replacement for it. |
| **Settlement proposal** | A ready-made entry, built from a cleared spending report's totals, that settles spending one bucket's line made from another account or card: **settle now** (a journal row) or **settle over time** (a new debt). Nothing posts until the owner accepts it. |
| **Floor** and **target** | Optional lower and upper balances for a cash bucket used as a sinking fund. Crossing either produces a suggestion, never a change. |
| **Month-end close** | The fixed sequence of steps that finishes one month and funds the next, shown as a computed checklist. |

## 4. Workflows

### 4.1 Declaring kinds and links

1. After upgrading, the Dashboard shows **Set up your accounts** until every active account has a kind. Nothing else waits for it: undeclared accounts behave as before, and the checks that need a kind or a link simply don't run for them.
2. On **Accounts**, the owner sets each account's kind: **Cash bucket**, **Card** or **Counterparty**. The app never guesses; a code named like a card stays undeclared until the owner says otherwise. PETC is one cash bucket.
3. The owner marks the **hub**: either the cash bucket where pay lands, or "a separate account" (chosen on Connected Accounts once v3 is available).
4. Once v3's Connected Accounts exist (Track B), each cash bucket and card gets its **link**: the owner picks the institution account, sees its name, last four digits and latest balance, and confirms. Institution accounts that belong to no bucket are marked **Separate hub** or **Outside the treasury**. **Shared** is not offered.
5. Relinking or changing a kind is audited and undoable. A kind can't change to counterparty while the account has a non-zero allocation in an open month.

### 4.2 Recording a transfer that pays a debt

1. On **Monthly Reconciliation**, the owner adds a transfer and types a Loan ID, as today.
2. If the transfer runs between the debt's two accounts, the entry form shows the effect before saving: *"A-01: KIDS owes ENT $200.00 → $120.00"*. **Record on Loan A-01** is ticked by default.
3. Saving creates the journal row and the debt event in one transaction; one **Undo** removes both. Editing the transfer's amount updates the event; deleting the transfer asks whether to delete the event too.
4. If a **different** bucket pays the debt (HH pays TRV's debt to LTS), the app asks how to record it (owner decision OD9):
   - **HH takes over the claim** (default): the payment reduces TRV's debt to LTS, and TRV now owes HH the same amount, as a new debt or added to an existing one.
   - **No claim**: HH covered it; nobody owes HH.
5. A transfer whose Loan ID is unknown, or whose accounts don't match the debt, saves without an event and appears in the tie-out.

### 4.3 Reviewing debts

1. **Interaccount Debts** opens **as of today** (owner decision OD6). Events dated later are labelled **Scheduled** and not counted. A switch shows **All recorded events**, the basis of the migration controls.
2. Each debt shows its age since opened and days since its last reduction. Old debts are grouped by age.
3. A **Review queue** lists debts that carry a "cancel" note, debts that are old and idle, reversed debts, and debts touched by an unresolved tie-out item. The owner can **Keep** (acknowledged, with an optional note), **Write off** (with a reason), record an adjusting event, or open the source row. A "cancel" note never removes a balance by itself.
4. The **Pairs** tab shows each pair of accounts with its net balance and its Loan IDs. From a pair the owner can **Pay pair** (one transfer spread over the pair's debts, oldest first, previewed) or **Offset** two opposite debts without cash.

### 4.4 Settlement proposals (Track B)

1. When a month's spending review is cleared, its report keeps, per pair of treasury accounts, the total spent on one account's budget lines from the other's institution account (totals only).
2. The next treasury month shows one proposal per pair, for example *"CLTH purchases on CARD, September 2026: $180.00"*, with **Settle now** (a journal row CLTH → CARD, paid through this month's final transfers), **Settle over time** (a new debt, CLTH owes CARD, with terms), **Split**, or **Reject**.
3. The owner accepts proposals one at a time or in bulk. Existing debts and journal rows on the same pair are shown alongside, so nothing is booked twice. Descriptions are generated from account codes and the month, never from transaction text.

### 4.5 Verifying transfers (Track B)

1. While a spending review is open, **Monthly Reconciliation** shows a verification badge on each line of the month being funded: **Verified**, **Amount differs**, **Not found**, **Choose** (several candidates), or **Retained** (the hub bucket).
2. **Mark verified lines Done** marks every verified, pending line Done in one undoable step. Done stays the owner's action (OD11).
3. A **Transfers outside the plan** list shows real transfers between two buckets that no final transfer explains, each with **Record as debt**, **Reverse through funding** (a journal row in the open month that sends the money back through the final transfers) or **Ignore** with a reason.

### 4.6 The month-end close

Today the steps sit on four screens and the owner remembers the order. V4 puts them on one computed checklist on the Dashboard, for the month that just ended (M) and the month being funded (N):

| # | Step | Where it happens | Done when |
| --- | --- | --- | --- |
| 1 | **Clear M's spending review.** Verify M's transfers while the review is open. | Budget Analysis, Monthly Reconciliation | M has a cleared report. |
| 2 | **Decide M's settlement proposals** into N. | Monthly Reconciliation (N) | No proposal from M is pending. |
| 3 | **Check M's balances:** proof of cash, card coverage, hub. | Balances | Every check is proven, explained with a note, or not applicable. |
| 4 | **Review debts:** tie-out for M, review queue, write-offs. | Monthly Reconciliation (M), Interaccount Debts | No unacknowledged tie-out or queue item. |
| 5 | **Fund N:** create it from the budget, accept proposals, make the by-hand transfers. | Monthly Reconciliation (N) | N is Ready to transfer or Complete. |
| 6 | **Close M.** | Monthly Reconciliation (M) | M is closed. |

- The checklist is computed from the data, never stored, like the reconciliation status. It never blocks closing: closing still follows the existing rules.
- Without v3 data (Track A only, or a local-only profile), steps 1–3 show **Needs connected accounts** and the rest still works.
- N's own verification appears in step 1 of the next cycle, or earlier if the owner gathers N's data mid-month.

### 4.7 Sinking funds (Track B)

The owner may give any cash bucket a floor, a target and a sweep destination. The Balances page shows each bucket's observed balance against them and suggests, never applies: *"PETC is $80.00 under its floor"*, *"TRV is $150.00 over its target. Move it to LTS?"*. Accepting creates a journal row in the open month, or opens the budget.

## 5. Functional requirements

IDs are referenced by the [implementation plan](implementation-plan.md) and the [acceptance tests](acceptance-tests.md). "Must" is required for the v4.0 release; "should" may slip to a v4.x release with a recorded reason. The track is **A** (no v3 data needed) or **B** (needs v3).

### Account kinds, hub and links (FR-ACCT)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-ACCT-1 | Each treasury account has an optional kind: cash, card or counterparty. Only the owner sets it; import, restore of an older backup and the budget never set or infer it. Must. | A |
| FR-ACCT-2 | Kind drives defaults and checks only: counterparties get no allocation line and can't be the From or To of a new transfer; cards default to a zero allocation and warn when a budget line is funded by a card. Imported rows that already conflict are kept and flagged. Must. | A |
| FR-ACCT-3 | At most one cash bucket is the hub bucket. Must. | A |
| FR-ACCT-4 | Kind changes are audited and undoable; a change to counterparty is refused while the account has a non-zero allocation in an open month. Must. | A |
| FR-ACCT-5 | Each institution account has a link role: linked to one treasury account, separate hub, outside the treasury, or not yet set. A treasury account has at most one linked institution account. Must. | B |
| FR-ACCT-6 | Link compatibility: cash buckets link to checking or savings accounts, cards to credit card accounts; counterparties can't be linked. There is no **Shared** role. Must. | B |
| FR-ACCT-7 | Exactly one hub: a hub bucket (its linked account is the hub) or one institution account with the separate-hub role, never both. Must. | B |
| FR-ACCT-8 | A setup view lists every active cash bucket and card without a link and every institution account whose role is not set. Checks that need a link are skipped for those accounts, with the reason shown. Must. | B |
| FR-ACCT-9 | Before a link is saved, the owner sees the institution account's name, last four digits and latest balance. Relinking is audited and undoable. Must. | B |

### Debts (FR-DEBT)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-DEBT-1 | A transfer naming a Loan ID between the debt's two accounts records the debt event in the same transaction by default, after a preview; the owner can untick it. Must. | A |
| FR-DEBT-2 | Editing the amount or date of a transfer updates its linked events in the same transaction; deleting it asks whether to delete them. Must. | A |
| FR-DEBT-3 | When a third account pays a debt, the owner chooses: the payer takes the claim (default, OD9) as a new debt or an increase of an existing open debt from the same debtor to the payer, or no claim. Must. | A |
| FR-DEBT-4 | The debt summary, the account net positions and the debt list are computed as of a date. Dashboard and Interaccount Debts default to today (OD6), with a switch to all recorded events. Later events are labelled **Scheduled**. Must. | A |
| FR-DEBT-5 | Write-off events: dated, zero cash, a required reason, an amount computed by the app to bring the balance to zero, shown differently from payments, and refused while events dated after it exist. Must. | A |
| FR-DEBT-6 | Debt events record a kind (recorded, opening, payment, adjustment, write-off, offset). Existing events read as **recorded**; no existing value changes. Must. | A |
| FR-DEBT-7 | Each debt shows its age since opened and days since its last reduction, as of the summary date, with age groups. Must. | A |
| FR-DEBT-8 | A review queue lists debts with a "cancel" note, old idle debts, reversed debts and debts touched by an unresolved tie-out item, with Keep, Write off, Adjust and Open source actions. Must. | A |
| FR-DEBT-9 | A pair view lists, per pair of accounts, the gross and net balance and its Loan IDs, as of the summary date. Must. | A |
| FR-DEBT-10 | **Pay pair** records one transfer and one payment event per debt it pays, oldest first (OD15), previewed; it refuses more than the payer owes in the pair. Must. | A |
| FR-DEBT-11 | **Offset** records two linked zero-cash events on opposite debts in the same pair, for at most the smaller balance (OD15). Must. | A |
| FR-DEBT-12 | Every new debt amount, payment and adjustment entered by the owner has at most two decimal places. Imported events keep their source precision. Must. | A |

### Tie-out (FR-TIE)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-TIE-1 | Each month shows a tie-out panel: journal rows that name a Loan ID or have linked events but don't tie, journal rows naming an unknown Loan ID, and debt-reducing events dated in the month with no journal row. Must. | A |
| FR-TIE-2 | Write-offs, offsets, opening events, balance increases, scheduled events and payments on debts with a counterparty are not tie-out exceptions; payments with a counterparty are listed separately as outside payments. Must. | A |
| FR-TIE-3 | Tie-out items are warnings. They never change the month's status (OD17). The owner can acknowledge an item with a note. Must. | A |
| FR-TIE-4 | A one-time **Link history** review proposes links between imported journal rows and debt events that match exactly; the owner accepts them in bulk or one at a time. Accepting adds a link; it never changes an amount, date, party, note or provenance. Must. | A |
| FR-TIE-5 | Every tie-out item links to its journal row or debt event, and to the source sheet and row for imported records. Must. | A |

### Monthly lines (FR-MON)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-MON-1 | New months hold allocations in cents. From a budget, the residual line's account absorbs the rounding so allocations still total take-home (OD13). Imported history keeps its precision. Must. | A |
| FR-MON-2 | New journal amounts entered by the owner have at most two decimal places. Must. | A |
| FR-MON-3 | Each cash bucket may have a standing amount (OD14). A month copies it when created; the line shows the automatic part and the by-hand part, and only the by-hand part is on the to-do list. Must. | A |
| FR-MON-4 | A warning appears when the active budget's allocation for an account differs from its standing amount. Must. | A |
| FR-MON-5 | When the hub is a bucket and OD16 is accepted, its line counts as **Retained** and needs no Done mark. Must. | A |
| FR-MON-6 | Cards show the latest statement balance and due date beside their final transfer, and how far the final transfer falls short of it (OD12). Should. | B |

### Balance checks (FR-BAL)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-BAL-1 | Each linked treasury account shows its observed month-end balance from the cleared report, with its source and date. Must. | B |
| FR-BAL-2 | Proof of cash per institution account in review, from the previous and current reports' closing values and the current report's inflow and outflow totals. Must. | B |
| FR-BAL-3 | For typed-in statements, a check that the statement's opening balance plus the entries equals its closing balance. Should. | B |
| FR-BAL-4 | Economic balance per cash bucket, and the identity that the total of economic balances equals the total of observed balances plus the debts with unlinked accounts and counterparties. Must. | B |
| FR-BAL-5 | Card coverage per card. Must. | B |
| FR-BAL-6 | Hub checks: take-home received against the expected cash of the month it funds, and, for a separate hub, the month-end balance against the owner's cushion. Must. | B |
| FR-BAL-7 | Every difference is shown with its likely explanations and a tolerance of $0.01, never forced to zero; the owner can mark it explained with a note. Checks never block anything. Must. | B |
| FR-BAL-8 | Optional floor, target and sweep destination per cash bucket, with suggestions only; off by default. Should. | B |

### Verification (FR-VER)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-VER-1 | For each required final transfer, find the matching transfer pair (hub out, account in; or the reverse for a negative line) at the same amount in cents within the verification window. Must. | B |
| FR-VER-2 | Statuses: Verified, Choose, Possible split, Amount differs, Not found, Retained, Not linked. Must. | B |
| FR-VER-3 | **Mark verified lines Done** in one undoable step. Verification never sets Done by itself and never affects the status (OD11). Must. | B |
| FR-VER-4 | Verification results persist after the review is cleared, without amounts, dates or transaction identifiers. A later change to the line's final transfer marks its verification stale. Must. | B |
| FR-VER-5 | List real transfers between two linked treasury accounts that no final transfer explains, with Record as debt, Reverse through funding and Ignore. Must. | B |

### Settlement proposals (FR-SETTLE)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-SETTLE-1 | Each cleared report keeps net totals per (paying treasury account, funding treasury account), totals only. Must. | B |
| FR-SETTLE-2 | The next open treasury month offers one proposal per pair with Settle now, Settle over time, Split and Reject, one at a time or in bulk (OD10). Must. | B |
| FR-SETTLE-3 | Refunds reduce a pair's total; a negative total is proposed in the reverse direction. Must. | B |
| FR-SETTLE-4 | A proposal is decided once; the created journal row or debt links back to it. Must. | B |
| FR-SETTLE-5 | Replacing a cleared report flags decided proposals whose total changed and offers the difference as a new proposal; nothing already created is edited. Must. | B |
| FR-SETTLE-6 | Proposal descriptions are generated from account codes and the month only. Must. | B |
| FR-SETTLE-7 | Existing debts and journal rows on the same pair appear beside each proposal, and a likely duplicate is flagged. Must. | B |

### Month-end close (FR-CLOSE)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-CLOSE-1 | The Dashboard shows the computed close checklist in §4.6 for the latest ended month and the month being funded. Must. | A (steps 4–6), B (all) |
| FR-CLOSE-2 | Each step links to the screen that completes it and says what is left. Must. | A/B |
| FR-CLOSE-3 | The checklist is never stored and never blocks closing a month. Must. | A |

### Data, import and export (FR-DATA)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-DATA-1 | Forward-only, additive migrations; no existing row's values change. Must. | A/B |
| FR-DATA-2 | Every new table and column round-trips through JSON backup and restore; older backups restore and then migrate forward. Must. | A/B |
| FR-DATA-3 | The workbook export adds kind, hub and standing amount to the accounts, and kind and reason to the Account Ledger; the importer reads them back from the app's own export and leaves them empty for other workbooks. Must. | A |
| FR-DATA-4 | A workbook import in replace mode keeps every account's kind, hub flag, standing amount, floor, target and links. Must. | A/B |
| FR-DATA-5 | The migration controls (non-zero debt count, total outstanding, largest debt, net positions) remain reproducible in all-recorded-events mode. Must. | A |

### Interface (FR-UI)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-UI-1 | Accounts: a **Kind** column and hub marker; in Track B the link column becomes editable, with the setup view. Must. | A/B |
| FR-UI-2 | Interaccount Debts: the as-of control and label, Scheduled labels, age columns, the Review queue, the Pairs tab, and Write off, Offset and Pay pair actions. Must. | A |
| FR-UI-3 | Monthly Reconciliation: the tie-out panel, the automatic and by-hand split, the Retained state; in Track B the verification column, **Mark verified lines Done**, **Transfers outside the plan** and the proposals panel. Must. | A/B |
| FR-UI-4 | A **Balances** page in the Treasury section, after Interaccount Debts: per account the observed and economic balance, floor and target, and each check with its explanation. Must. | B |
| FR-UI-5 | Dashboard: the close checklist, and the debt headline labelled with its as-of date. Must. | A/B |
| FR-UI-6 | Every figure drills down to the events, journal rows, report rows or checks that produce it. Must. | A/B |
| FR-UI-7 | Keyboard entry for pay pair, offset, write-off and proposal decisions. Visual language, phone width and navigation rules as in v3. Must. | A/B |

### Public demo (FR-DEMO)

| ID | Requirement | Track |
| --- | --- | --- |
| FR-DEMO-1 | The Harper household declares a kind for every account, marks HH as the hub, and gains a card (`CARD`) and a counterparty (`RELATIVE`) without changing its pinned debt controls. Must. | A |
| FR-DEMO-2 | The sample statement files include the card, so a visitor's review produces settlement proposals, balance checks and verification. Must. | B |
| FR-DEMO-3 | The demo seed dates no event after today, so its as-of-today and all-events figures agree on every day. Must. | A |

## 6. Screens

### Dashboard

- **Month-end close** panel: the six steps of §4.6, each with its state and link.
- **Interaccount debts** headline: count, total and largest, labelled *as of 27 Sep 2026*, with the number of scheduled events and a link to the all-events view.
- **Set up your accounts** while any active account has no kind (and, in Track B, while any cash bucket or card has no link).

### Accounts

Adds **Kind** (Cash bucket, Card, Counterparty, Not declared), a **Hub** marker, and **Standing amount** for cash buckets. In Track B the **Connected account** column becomes a picker that shows name, last four digits and latest balance, plus floor, target and sweep destination for cash buckets. A setup view filters to accounts that still need a kind or a link.

### Monthly Reconciliation

- Each line shows the final transfer split into **Automatic** and **By hand** when a standing amount exists, and **Retained** for the hub bucket.
- **Tie-out** panel below the journal, with its items and **Acknowledge**.
- The transfer form shows the debt preview and **Record on Loan**; the third-party dialog appears when needed.
- Track B: a **Verified** column, **Mark verified lines Done**, **Transfers outside the plan**, the card statement comparison, and a **Settlement proposals** panel above the journal with bulk actions.

### Interaccount Debts

- An **As of** date control (default today) and an **All recorded events** switch; scheduled events greyed and labelled.
- Debt list columns: Loan ID, owed by, owed to, balance, status (Open, Credit, Paid, Written off), opened, age, last reduction, notes.
- Tabs: **Debts**, **Pairs**, **Review queue**.
- Debt drawer actions: Record payment, Adjust, **Write off**, **Offset**. Pair row actions: **Pay pair**, **Offset**.

### Balances (Track B)

One row per linked treasury account for the selected report month: observed balance (with source: estimate, as-of or statement), what it's owed and owes, economic balance, floor and target bars, and the check results (proof of cash, card coverage, hub). A footer shows the consolidation identity. Each difference opens its explanation and a note field.

## 7. What changes from v3

- **Kept:** every v3 behavior, the temporary-transaction rule, the read-only stance toward institutions, and every treasury calculation not listed in [Treasury rules §18](treasury-rules.md#18-domain-rules-kept-extended-or-changed).
- **Changed (owner decisions):** the debt headline defaults to today (OD6); the hub bucket's line is retained (OD16); proposals from institution data may become treasury records on acceptance (OD10), replacing v3's non-goal of never creating them; new months and new entries hold cents (OD13).
- **Added:** account kinds, hub, required links, event kinds, write-offs, offsets, pay pair, the tie-out, balance checks, verification, settlement proposals, standing amounts, floors and targets, the close checklist and the Balances page.
- **Asked of v3:** the amendments in §10, if the owner adopts them.

## 8. Success measures

- A debt repayment takes one entry, not two, and the tie-out for a new month has no exceptions the owner didn't choose.
- The debt headline matches what is owed today; the migration controls still reproduce in all-events mode.
- After the first linked month, every linked account is proven or explained each month.
- Marking a month's transfers Done takes one click once the data is gathered.
- The month-end close runs from one checklist, in the order it shows.

## 9. Owner decisions

These change financial meaning or reinterpret an account, so none is assumed. The plan builds the recommended default unless the owner decides otherwise. OD1–OD16 follow the accounting review's numbering; OD17–OD19 were added while writing this specification.

| # | Decision | Recommended default |
| --- | --- | --- |
| OD1 | Which real account holds each cash bucket and card, and where does pay land? | Record it once, in setup. One bucket per real account. Mark the pay account as the hub. |
| OD2 | What is each account whose physical form is unclear, such as an account with no allocation or one already flagged for review? | The owner declares its kind, or leaves it undeclared. The code stays as it is; the app never guesses. |
| OD3 | Cards: their own treasury accounts linked 1:1, or folded into a "home" bucket? | Keep them as their own accounts, kind **card**. Drop v3's **Shared** for cards. |
| OD4 | Do people and outside accounts that are parties to debts become **counterparties**, with no link, no allocation and no new transfers? | Yes. An imported unknown code keeps its history and may be declared a counterparty and archived. |
| OD5 | A specific imported debt whose settlement is now in question. | Private; recorded in the owner's notes. V4 supplies the tools (write-off, adjusting events, new debts) and assumes no outcome. |
| OD6 | Should the debt summary default to **as of today** instead of every recorded event? | Yes, with a switch to include scheduled events. The migration controls stay on all recorded events. |
| OD7 | Imported debts that carry a "cancel" note. | Private. The review queue lists them; the owner writes off each truly canceled one with a reason. Nothing is written off automatically. |
| OD8 | Imported rows the tie-out flags as possible entry slips. | Private. The owner checks each against the bank or card record and corrects with adjusting events, never by editing imported rows. |
| OD9 | When one bucket pays another bucket's debt, does the payer now hold the claim? | Yes by default (the debtor owes the payer), with a one-click **No claim**. |
| OD10 | May proposals from bank data become journal rows or debts **on the owner's acceptance** (a v3 non-goal today)? | Yes, in v4. Accept-only, never automatic, and no transaction text copied. |
| OD11 | Should **Complete** require bank-verified transfers? | No. Verification is a separate badge; rule 5 is unchanged by it. |
| OD12 | Card policy: pay each card's statement balance in full every month from the hub? Who bears interest and fees? | Pay in full from the hub where cash allows, with the buckets' shares settled through the journal. Interest and fees are borne by the bucket(s) whose charges were carried, ENT (the residual bucket) when that's unclear. The owner does this by classifying interest and fees to a budget line funded by that bucket; the settlement proposal then charges it. |
| OD13 | Should new months hold cent amounts, with the residual line absorbing the rounding? | Yes. Imported history keeps its source precision. |
| OD14 | Should the fixed allocations move automatically (split direct deposit or recurring transfers)? | Yes, for the fixed lines; the owner sets them up at the bank. Adjustments stay by hand. |
| OD15 | Should zero-cash offsets be allowed, and in what order does a pair payment settle debts? | Offsets allowed, explicitly, per pair. Pay pair settles the oldest debt first. |
| OD16 | If pay lands in a bucket, should that bucket's line count as **retained** rather than waiting for Done? | Yes. This rewords rule 5 ("every account except the hub bucket"), so it needs the owner's approval. |
| OD17 | Should unresolved tie-out items block **Complete**? | No. They are warnings on the month and a step on the close checklist. |
| OD18 | Which treasury month does pay received in a calendar month fund: the same month or the next? | The owner states it once when marking the hub; the hub pay check stays off until then. |
| OD19 | Amend the v3 specification (§10) before v3's connection slices start? | Yes, all five, before v3 slice S4. Each is cheaper in v3 than as a v4 migration. |

## 10. Proposed amendments to v3

**Proposed, not applied.** V3 is specified but not built. Some v4 decisions are cheapest to make in v3's specification before its connection slices (S4 onward) create the tables and reports. None of the files in `docs/development/v3/` has been changed; adopting any of these is owner decision OD19. If an amendment is not adopted, v4 does the same work later, at the cost shown.

| # | Amendment | v3 sections it would change | Why now | If not adopted |
| --- | --- | --- | --- | --- |
| V3-A1 | **Required 1:1 links.** Replace the optional treasury account with a link role (linked, separate hub, outside the treasury, not set); a treasury account links to at most one institution account; cash buckets link only to checking or savings, cards only to credit cards; the Accounts page's read-only column becomes the place links are edited, with a setup prompt for unlinked cash buckets and cards. | [Product spec §4.2](../v3/product-spec.md#42-connecting-institutions) step 3; FR-CONN-4; §6 Accounts; [Spending review rules §13](../v3/spending-review-rules.md#13-schema) `institution_accounts`; §14 invariant "the link is an optional FK". | S4 creates `institution_accounts`; the owner maps each account once while connecting. | V4 slice B1 adds the role and unique index by migration and asks the owner to re-confirm every mapping. |
| V3-A2 | **Drop "Shared"** for cards (and everything else). A card links to its own card treasury account. Two buckets that truly share one bank account are an open question for a later release, not a v3 option. | Product spec §4.2 step 3 ("or Shared…, such as a credit card"); FR-CONN-4; Spending review rules §13 (`shared` flag); [V3 acceptance tests](../v3/acceptance-tests.md) fixture ("Card ••3333 … Shared"). | Cards already have their own treasury codes; Shared would record a mapping v4 must then undo. | B1's migration turns every Shared account into "not set" and lists it for the owner; nothing is mapped silently. |
| V3-A3 | **Account-only classification rules.** A rule may match on an institution account (with optional direction and amount range) and no description, so a bucket that funds a single budget line classifies its own account's spending without description patterns. Suggestions only, as for every rule. | [Spending review rules §7](../v3/spending-review-rules.md#7-rules); FR-REV-6; V3-AT6. | Under 1:1 the account decides the line for single-line buckets; this saves the owner writing a rule per merchant from the first review. | V4 adds the rule shape later; reviews before then need description rules. |
| V3-A4 | **Persist funding-pair totals.** Each cleared report keeps, per (paying treasury account, funding treasury account), the net spending total and count: totals only. Promote FR-REV-12 from Should to Must, and add a **Funding pairs** sheet to the export. | [Spending review rules §9](../v3/spending-review-rules.md#9-the-spending-report), §11, §13 (new `spending_report_funding_pairs`), §15; product spec FR-REV-12. | Settlement proposals are built from these totals. Reports cleared without them can never produce proposals, because their transactions are gone. | V4 adds the table in B4; every month cleared before then yields no proposals. |
| V3-A5 | **Cent matching in FR-REV-13.** The transfer-confirmation hint compares the deposit with the final transfer after rounding both half-up to cents, rather than exactly. | [Spending review rules §15](../v3/spending-review-rules.md#15-treasury-hints); FR-REV-13. | Budget-driven and imported final transfers can carry fractions of a cent; an exact comparison never matches them. | The v3 hint misses those lines until v4's verification (B3) replaces it. |

A smaller, optional amendment: let the manual-entry form for PDF-only accounts ([product spec §4.2](../v3/product-spec.md#42-connecting-institutions) step 4) take the statement's **opening** balance as well as its closing balance, and keep both on the report's source row. V4's typing check (FR-BAL-3) needs it; without it, v4 adds the field in B2 and the check starts from that month.
