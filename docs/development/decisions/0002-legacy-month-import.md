# ADR 0002 — Interpreting legacy matrix months

Status: accepted · 2026-09-24

The legacy `YYYY-MM` sheets predate the normalized template. The spec leaves these points open. Each choice below is reversible in the app.

| Topic | Decision | Why |
| --- | --- | --- |
| Expected cash | Set to the decimal sum of the sheet's Budget Allocation row, with an info warning. | Legacy sheets have no expected-cash cell. Inventing another number would create a fake allocation difference. |
| Status | The full rules in [data-and-rules.md](../data-and-rules.md) apply. The sheet's own “Balanced/Review” (journal difference only) is kept as a comparison control. | Both are visible, so a month such as 2025-04 (negative TRV transfer) shows Review and also that the sheet said Balanced. |
| Lifecycle | Every month except the most recent is imported **closed**. A closed month that computes Review gets a recorded override note. | Keeps history read-only by default. Reopen is one click. |
| Rows with a label but no postings | Not imported as journal entries. Listed in an info warning with row numbers and text. | They carry no amounts. Making them entries would add invalid-entry failures that aren't in the source. |
| Dates | Stored as null (month-only), with a per-sheet warning about the month fallback. | The spec allows month-only legacy dates and forbids inventing data. |
| Confirmation rows | `x`/`X` in any “Transfer confirmation” row → Done. Any other marker (for example `-`) → pending, with a warning. | Follows [workbook-import.md](../workbook-import.md). |
| “Legacy balance check” rows | Copied into the month notes, with an info warning. | They sit after X'fer Amount and aren't journal rows. |
| Unbalanced rows | All postings imported unchanged, flagged with the exact difference. No plug. | Required (the reference workbook's unbalanced month keeps its exact difference). |

## Confirmed — 2026-09-24

The user confirmed that imported workbook months were works in progress kept for **archival purposes**. They don't necessarily match the current system, so they won't be linked to budget plan versions, and budget changes never apply to them.
