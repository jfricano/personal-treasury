# Personal Treasury v4

V4 treats each treasury account as what the owner already uses it as: **one real account**. Every account gets a declared **treasury role** (cash bucket, card or counterparty), each cash bucket and card is linked to exactly one real account, and the app then checks the treasury against what the bank reports, without keeping a ledger of purchases. It also removes double entry from the debt workflow: a debt payment is entered once, the journal is tied out against the debt ledger, the debt summary is shown **as of a date**, and canceled debts can be closed with an explicit **write-off**. The monthly final-transfer method, which already nets every obligation into one real transfer per account, does not change.

V4 builds on the shipped v3 (v0.3.0-preview.2, schema 5). One small slice, B0, ships first so every month cleared from then on keeps the totals v4 needs. Track A needs no institution data and can ship in the next previews; Track B uses v3's connected accounts, reports and balances.

These documents direct the implementation. Read them in this order:

| Document | Read it to… |
| --- | --- |
| [Product specification](product-spec.md) | Understand the owner's question, the answer, the workflows, the requirements (FR-…), the screens, the owner decisions (OD1–OD21), and the changes v4 makes to shipped v3. |
| [Treasury rules](treasury-rules.md) | Implement the calculation and data contract: treasury roles, links, decision settings, the as-of debt summary, event types, the tie-out, balance checks, verification, settlement proposals, schema, and how each domain rule is kept, extended or changed. |
| [Implementation plan](implementation-plan.md) | Follow the branches, slice B0, the Track A and Track B slices, the release path for Track A, the test strategy, the documentation pass and the release gate. |
| [Acceptance tests](acceptance-tests.md) | See the behaviors v4 must pass (V4-AT1–V4-AT18). |

Decision: [ADR 0011 — treasury accounts are physical accounts](../decisions/0011-treasury-accounts-are-physical-accounts.md) (proposed).

V4 comes from an accounting review of the treasury logic, an analysis of the owner's imported history, and two reviews of this specification. The accounting review and the analysis cite the owner's real accounts and figures, so they are private and live in the gitignored `reference/` folder. Nothing in these documents is derived from that data: every example uses the fictional Harper household or invented numbers.

## Status and review record

| Date | Event |
| --- | --- |
| 2026-09-27 | Accounting review of the treasury logic and an analysis of the owner's imported history (private). Verdict: treasury accounts are one real account each, with named exceptions; the final-transfer method is already minimal netting; the gaps are single-entry debt payments, an as-of debt summary and checks against observed balances. |
| 2026-09-27 | Specification drafted, then reviewed twice: for accounting correctness (2 blockers, 11 should-fix) and for consistency, buildability and privacy (2 blockers, 19 should-fix). Every blocker and should-fix item was resolved in the second commit on `v4/spec`. |
| 2026-10-20 | Updated for the shipped v3: the proposed v3 amendments became changes to shipped v3 ([product spec §10](product-spec.md#10-changes-v4-makes-to-shipped-v3)); slice B0 added; the Track A release path rewritten for one migration sequence on `main` (OD21); reviews aligned with the [delivery workflow](../DELIVERY_WORKFLOW.md). |

**Handoff:** [state on 2026-10-20](handoff.md) for whoever continues.

**Next:** the owner answers the decisions in [product spec §9](product-spec.md#9-owner-decisions), OD19 and OD21 first. Nothing is built until then.
