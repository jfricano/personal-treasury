# ADR 0011 — Treasury accounts are physical accounts: declared kinds and required 1:1 links

Status: proposed · 2026-09-27. Becomes accepted when the owner confirms OD1–OD4 and OD19 in the [v4 product spec](../v4/product-spec.md#9-owner-decisions).

## Context

The treasury's accounts were designed as opaque virtual buckets ([ADR 0003](0003-account-normalization.md)). In practice the owner uses them as real accounts: each cash bucket is money in one deposit account, and each card code stands for one credit card. The owner asked whether the app should treat them as 1:1 with physical accounts, and whether that allows a more efficient setup.

An accounting review found that it does, with named exceptions:

- the account where pay lands (the hub) isn't modeled at all, although every final transfer leaves from it;
- cards are one real account each, but they are debts that several buckets spend on, and their codes already work as each card's payment envelope;
- some codes aren't accounts: a person who lent money, or an account outside the treasury, is only ever a party to a debt;
- some real accounts (brokerage, retirement, loans) sit outside the treasury on purpose.

V3, which is specified but not built, links an institution account to a treasury account optionally, offers **Shared** for cards, and uses the link only for two hints. Nothing in the app records what kind of account a code is, so the app treats a bucket, a card and a person alike, and it can't check itself against the balances the institutions report.

The review also confirmed that the monthly final transfers already net every journal row and debt repayment into one real transfer per account, the minimum possible. That part of the design is not in question.

## Decision

1. **Every treasury account has a kind** the owner declares: `cash` (a pot of money in one deposit account), `card` (one credit card account, whose code is its payment envelope) or `counterparty` (a party to debts with no real account in the treasury). An undeclared account behaves exactly as today.
2. **Kind is never inferred** from a code, name, description, transaction or budget line, and never set by an import or restore. Codes stay opaque (domain rule 1); kind is a separate fact.
3. **Kind drives defaults and checks only.** Counterparties get no allocation and can't be the From or To of a new transfer; cards default to a zero allocation. Imported rows that conflict with a later declaration are kept and flagged (rule 11). No calculation depends on kind.
4. **One hub.** Either a cash bucket that doubles as the pay account, or a separate deposit account that belongs to no bucket.
5. **Required 1:1 links.** Each active cash bucket and card links to exactly one institution account, of a compatible type; each institution account links to at most one treasury account, is the separate hub, or is marked outside the treasury. There is no **Shared**. "Required" is a completeness check, not a constraint: unlinked accounts keep working, and only the checks that need a link are skipped for them.
6. **Balances are observed, not computed.** A linked account's balance is its institution account's month-end balance from a cleared spending report. The app still keeps no book balance, and never derives one from allocations or spending.
7. **Loan IDs stay the record** for interaccount debts. A debt owed to a card is a bucket's share of that card's balance; pair views, settlement proposals and card coverage are derived from Loan IDs, not a replacement for them.

## Alternatives considered

- **Keep links optional, with Shared for cards** (v3 as specified). Rejected: cards already have their own codes, and a Shared card can't be checked against the debts owed to it.
- **Fold each card into a "home" bucket.** It would remove the Loan IDs for a bucket's own card charges, but it mixes a debt into a cash bucket, breaks 1:1 and reinterprets existing codes. Settlement proposals remove most of the same bookkeeping without those costs.
- **Keep several buckets as sub-balances inside fewer bank accounts.** Rejected as a default: it saves a few accounts and costs a sub-ledger the bank would otherwise keep. Two buckets that truly share one account remain an open question for a later release.
- **Infer kinds from names or activity.** Rejected: it reinterprets account semantics the owner controls, and names are approximate.
- **Compute bucket book balances from allocations and spending.** Rejected: it fabricates balances the bank already reports and breaks the rule that the app doesn't compute bank balances.
- **A full double-entry general ledger.** Rejected: it duplicates the bank, contradicts v3's temporary-transaction rule, and costs more than every v4 check combined.

## Consequences

- The owner declares each account's kind once and, with v3, links each bucket and card once. Until then, nothing changes.
- With links in place, the app can prove each month's cash, compare each card with the debts owed to it, verify the final transfers to the cent, and propose settlements for spending from the wrong account, all without storing transactions.
- A wrong link produces wrong checks. The link dialog shows the account's last four digits and balance before saving, and relinking is audited and undoable.
- V3's institution-account table gains a link role and a unique link, and loses Shared. If the owner adopts the proposed v3 amendments, this happens in v3's own schema; otherwise v4 migrates it and asks the owner to re-confirm every mapping.
- ADR 0003 stands: codes, aliases and unknown codes are handled as before. An imported unknown code may be declared a counterparty and archived with its history.
