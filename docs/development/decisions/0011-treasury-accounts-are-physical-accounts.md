# ADR 0011 — Treasury accounts are physical accounts: declared treasury roles and required 1:1 links

Status: proposed · 2026-09-27. Becomes accepted when the owner confirms OD1–OD4 and OD19 in the [v4 product spec](../v4/product-spec.md#9-owner-decisions).

## Context

The treasury's accounts were designed as opaque virtual buckets ([ADR 0003](0003-account-normalization.md)). A household using this design typically keeps each cash bucket's money in one deposit account and gives each credit card its own code. The owner asked whether the app should treat treasury accounts as 1:1 with physical accounts, and whether that allows a more efficient setup.

An accounting review found that it does, with general exceptions:

- the account where pay lands (the hub) isn't modeled at all, although every final transfer leaves from it;
- cards are one real account each, but they are debts that several buckets spend on, and a card's code works as its payment envelope;
- some codes aren't accounts: a relative who lends money, or an account outside the treasury, is only ever a party to a debt;
- some real accounts (brokerage, retirement, loans) sit outside the treasury on purpose.

V3, as shipped in v0.3.0-preview.2, links an institution account to a treasury account optionally, starts new accounts as **Shared**, and uses the link for no treasury check (its two planned hints were not built). Nothing in the app records what a code physically is, so the app treats a bucket, a card and a person alike, and it can't check itself against the balances the institutions report.

The review also confirmed that the monthly final transfers already net every journal row and debt repayment into one real transfer per account, the minimum possible. That part of the design is not in question.

## Decision

1. **Every treasury account has a treasury role** the owner declares: `cash` (a pot of money in one deposit account), `card` (one credit card account, whose code is its payment envelope) or `counterparty` (a party to debts with no real account in the treasury). An undeclared account behaves exactly as today. The name is deliberately distinct from v3's institution kind (checking, savings, credit card, …), which is unchanged.
2. **A role is never inferred** from a code, name, description, transaction or budget line. It is set only by the owner, or copied verbatim from the app's own workbook export or a v4 backup; budget imports, other workbooks and older backups never set it. Codes stay opaque (domain rule 1); the role is a separate fact.
3. **The role drives defaults and checks only.** Counterparties get no allocation and can't appear in a new transfer; cards get an allocation only when a budget line funds them. Imported rows that conflict with a later declaration are kept and flagged (rule 11). No calculation depends on the role.
4. **At most one hub**, declared by the owner: either a cash bucket that doubles as the pay account, or a separate deposit account that belongs to no bucket.
5. **Required 1:1 links.** Each active cash bucket and card links to exactly one institution account of a compatible institution kind; each institution account's link target is one treasury account, the separate hub, or outside the treasury. There is no **Shared**. "Required" is a completeness check, not a constraint: unlinked accounts keep working, and only the checks that need a link are skipped for them.
6. **Balances are observed, not computed.** A linked account's balance is its institution account's month-end balance from a cleared spending report. The app still keeps no book balance, and never derives one from allocations or spending.
7. **Loan IDs stay the record** for interaccount debts. A debt owed to a card is a bucket's share of that card's balance; pair views, settlement proposals and card coverage are derived from Loan IDs, not a replacement for them.

## Alternatives considered

- **Keep links optional, with Shared for cards** (v3 as specified). Rejected: when cards have their own codes, a Shared card can't be checked against the debts owed to it.
- **Fold each card into a "home" bucket.** It would remove the Loan IDs for a bucket's own card charges, but it mixes a debt into a cash bucket, breaks 1:1 and reinterprets existing codes. Settlement proposals remove most of the same bookkeeping without those costs.
- **Keep several buckets as sub-balances inside fewer bank accounts.** Rejected as a default: it saves a few accounts and costs a sub-ledger the bank would otherwise keep. Two buckets that truly share one account are deferred to a later release.
- **Infer roles from names or activity.** Rejected: it reinterprets account semantics the owner controls, and names are approximate.
- **Compute bucket book balances from allocations and spending.** Rejected: it fabricates balances the bank already reports and breaks the rule that the app doesn't compute bank balances.
- **A full double-entry general ledger.** Rejected: it duplicates the bank, contradicts v3's temporary-transaction rule, and costs more than every v4 check combined.

## Consequences

- The owner declares each account's role once and, with v3, links each bucket and card once. Until then, nothing changes.
- With links in place, the app can prove each month's cash, compare each card with what will pay for it, verify the final transfers to the cent, and propose settlements for spending from the wrong account, all without storing transactions.
- A wrong link produces wrong checks. The link dialog shows the account's last four digits and balance before saving, and relinking is audited and undoable.
- V3's institution-account table gains a link target and a unique link, and loses Shared. V4 migrates it (slice B1) and asks the owner to re-confirm every mapping; nothing is mapped silently.
- ADR 0003 stands: codes, aliases and unknown codes are handled as before. An imported unknown code may be declared a counterparty and archived with its history.
