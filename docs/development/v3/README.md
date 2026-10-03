# Personal Treasury v3

Current implementation: **0.3.0-preview.2**, merged into `main` and published as a Local-only Mac prerelease and [v3 demo](https://pt.orcasolutions.dev/). [Release notes](../../release-notes-v0.3.0.md) describe the current download and limits. These specifications define the target contract, not a claim that every acceptance gate has passed.

V3 is a single-user release. It replaces the v2.2 access token and sync passphrase with a User ID and password that the server can verify but cannot use to read data. It adds **Budget Analysis**, a monthly comparison of the budget with spending gathered from the owner's financial institutions, and a month-end **assets and liabilities** snapshot. Raw transactions are kept only while a month is under review. The permanent record is one cleared report per month.

The [implementation preview status and local walkthrough](preview-status.md) record what is runnable, validation evidence and remaining release gates.

These documents direct the implementation. Read them in this order:

| Document | Read it to… |
| --- | --- |
| [Product specification](product-spec.md) | Understand the owner's decisions, workflows, requirements (FR-…), screens and open questions. |
| [Spending review rules](spending-review-rules.md) | Implement the calculation and data contract: months, signs, coverage, dispositions, clearing, reports, balances and schema. |
| [Security design](security.md) | Implement sign-in, the key hierarchy, sessions, attack resistance, provider credentials and temporary storage, and the testable SEC requirements. |
| [Institution data](aggregation.md) | Compare the provider options (Plaid, a non-Plaid alternative, files only), and see desktop-only gathering, the adapter contract and statement-file import. |
| [Implementation plan](implementation-plan.md) | Follow the branches, slices, parallel work, test strategy, documentation pass, rollout and release gate. |
| [Acceptance tests](acceptance-tests.md) | See the behaviors v3 must pass (V3-AT1–V3-AT15). |

Decisions: [ADR 0008 — single-user sign-in](../decisions/0008-single-user-sign-in.md), [ADR 0009 — institution data provider](../decisions/0009-institution-data-provider.md), [ADR 0010 — temporary spending reviews](../decisions/0010-temporary-spending-review.md).

The multi-user proposal in [v3 ideas](../v3-ideas.md) is abandoned. The Windows installer continues as a separate track. Owner-specific institution coverage and setup notes are private and live in the gitignored `reference/` folder.
