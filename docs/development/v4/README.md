# Personal Treasury v4

V4 treats each treasury account as what the owner already uses it as: **one real account**. Every account gets a declared **kind** (cash bucket, card or counterparty), each cash bucket and card is linked to exactly one real account, and the app then checks the treasury against what the bank reports, without keeping a ledger of purchases. It also removes double entry from the debt workflow: a debt payment is entered once, the journal is tied out against the debt ledger, the debt summary is shown **as of a date**, and canceled debts can be closed with an explicit **write-off**. The monthly final-transfer method, which already nets every obligation into one real transfer per account, does not change.

V4 builds on v3, which is specified but not yet built. Half of v4 (Track A) needs nothing from v3 and can ship first; the other half (Track B) uses v3's institution data.

These documents direct the implementation. Read them in this order:

| Document | Read it to… |
| --- | --- |
| [Product specification](product-spec.md) | Understand the owner's question, the answer, the workflows, the requirements (FR-…), the screens, the owner decisions, and the changes v4 asks of v3. |
| [Treasury rules](treasury-rules.md) | Implement the calculation and data contract: kinds, links, the as-of debt summary, event kinds, the tie-out, balance checks, verification, settlement proposals, schema, and how each domain rule is kept, extended or changed. |
| [Implementation plan](implementation-plan.md) | Follow the branches, the Track A and Track B slices, the test strategy, the documentation pass and the release gate. |
| [Acceptance tests](acceptance-tests.md) | See the behaviors v4 must pass (V4-AT1–V4-AT18). |

Decision: [ADR 0011 — treasury accounts are physical accounts](../decisions/0011-treasury-accounts-are-physical-accounts.md) (proposed).

V4 comes from an accounting review of the treasury logic and an analysis of the owner's imported history. Both cite the owner's real accounts and figures, so they are private and live in the gitignored `reference/` folder. Nothing in these documents is derived from that data: every example uses the fictional Harper household or invented numbers.
