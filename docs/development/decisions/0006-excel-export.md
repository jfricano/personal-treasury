# ADR 0006 — Excel export format

Status: accepted · 2026-09-24

The exported workbook stays recognizable and re-imports without loss:

- **Overview, Monthly Template, Account Ledger, Interco Debt Summary**, in the same layouts and headings as the source.
- **One `YYYY-MM` sheet per month in the normalized layout**, legacy months included. It has live SUMIF formulas, check formulas and cached values. Two-leg transfers with a description go in the transfer journal. Multi-posting, unbalanced, draft and undescribed entries go in an **Advanced postings** section that the formulas also read. A `Position` column restores entry order on import.
- **Accounts, Debts and Months** tables carry display names, descriptions, aliases, origin metadata, closed flags, override notes, and the exact expected-cash decimal.
- Loan IDs are text cells. Dates are typed dates. Debt prior/remaining/status values come from the domain engine. “Exported by” appears on Overview and in document properties.
- **Precision.** Excel stores doubles. Values that came from the workbook round-trip exactly. A value typed with more than about 15 significant digits would narrow. The JSON backup is the exact, lossless format.
