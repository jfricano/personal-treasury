# Documentation

Current public release: **v3 / 0.3.0-preview.2**. [GitHub downloads](https://github.com/jfricano/personal-treasury/releases/tag/v0.3.0-preview.2) offer **Local only**. Private service instructions describe owner-configured builds; no Connected installer is publicly offered.

## Using Personal Treasury

| Document | Read it to… |
| --- | --- |
| [Getting started](guide/getting-started.md) | Install the Local PKG, approve a macOS preview, run from source and set up your household. |
| [Demo walkthrough](guide/demo-walkthrough.md) | Follow the fictional paycheck, transfers, reconciliation, debts and sample spending review. |
| [User guide](guide/user-guide.md) | Use v3 budgets, cash reconciliation, spending reviews, real balances, private access and recovery. |
| [V3 release notes](release-notes-v0.3.0.md) | See the current preview's features, downloads, upgrade steps and limits. |
| [Railway hosting](guide/railway-sync.md) | Configure and deploy the v3 private service; preserve and migrate existing v2 history. |

## Building and changing it

| Document | Read it to… |
| --- | --- |
| [Development](development/development.md) | Run commands, understand the code layout and build Local or privately configured native apps. |
| [Architecture](development/architecture.md) | Understand SQLite, treasury/budget boundaries, review storage, encrypted sync and demo isolation. |
| [Data and calculation rules](development/data-and-rules.md) | Preserve exact monthly reconciliation, account and debt calculations. |
| [Workbook import](development/workbook-import.md) | Implement supported spreadsheet layouts and provenance/control checks. |
| [Treasury acceptance tests](development/acceptance-tests.md) | Check the unchanged treasury baseline, alongside the v3 acceptance matrix. |
| [Testing](development/testing.md) | Find the current unit, integration, service, browser, native and container checks. |
| [V3 specification](development/v3/README.md) | Find the product, spending, security and provider contracts and their acceptance requirements. |
| [V3 release report](development/v3-release-report.md) | Review publication, test evidence, documentation audit and remaining acceptance work. |
| [Preview status](development/v3/preview-status.md) | See implemented paths, outstanding gates and disposable local walkthroughs. |
| [Distribution plan](distribution-plan.md) | Maintain Local-only public downloads and track stable signing/acceptance work. |
| [Launch post](launch-post.md) | Use current preview announcement copy. |
| [Decisions](development/decisions/) | Read the rationale for storage, imports, sync, sign-in and review lifetimes. |

## Historical documents

These record earlier behavior or the plan at its original date. They are not current installation instructions.

- [V2 user guide](guide/user-guide-v2.md) and [v2 token/passphrase sync](guide/cloud-sync.md).
- [v0.2.1 notes draft](release-notes-v0.2.1.md), [v0.2.2 notes](release-notes-v0.2.2.md), [v2 report](development/v2-release-report.md) and [v2.2 report](development/v2.2-release-report.md).
- [V2 plan](development/v2-plan.md) and [control matrix](development/v2-control-matrix.md).
- [Original v3 implementation plan](development/v3/implementation-plan.md) and [ideas](development/v3-ideas.md); implementation status is in the current release report. The earlier multi-user proposal is abandoned.
