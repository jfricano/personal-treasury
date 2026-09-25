# ADR 0004 — Debt event ordering, notes and payments

Status: accepted · 2026-09-24

- **Order.** Events are ordered by event date, then `sequence`, as [data-and-rules.md](../data-and-rules.md) specifies. `sequence` is the global source row number for imported events and the next number for new ones. Exporting in `sequence` order reproduces the workbook's ledger row order.
- **Out-of-order rows.** When a loan's rows aren't in date order (for example, an opening row dated after its payments, likely a typo), the intermediate prior/remaining balances differ from the workbook columns, which follow row order. The final balance still matches, and the import report explains the difference. The date is left for the owner to correct with an audited edit.
- **Blank changes** import as zero-value events with a warning.
- **Displayed terms/notes** follow the workbook's summary formula: the latest event's note, else the originating terms.
- **Review note.** Any note or terms containing `cancel` flags the debt. The balance and summary inclusion don't change.
- **Payments.** The UI takes a positive payment and stores the change that moves the balance toward zero in its *current* direction: negative while positive, positive while in credit. A direct signed adjustment is also available.
- **Monthly transfers with a Loan ID.** When cash moves origin debtor → origin creditor (or the reverse), the journal offers a one-click “Record on Loan …” that shows the amount first. The event links to the journal entry, so it can't be recorded twice.
