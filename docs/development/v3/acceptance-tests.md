# V3 acceptance tests

These extend the [existing acceptance tests](../acceptance-tests.md), which all still apply. Test names in `tests/` refer to these as V3-AT1–V3-AT15. Fixtures use the fictional Harper household and synthetic statement files only. Amounts below are illustrative fixture values, not the demo's seeded figures.

Unless stated otherwise, the fixture budget version for 2026-08 has take-home $6,000.00 and these lines: Groceries $600.00 (Household and personal, funded by HH); Fuel and parking $200.00 (Transportation, HH); Car maintenance $150.00 (Pets etc., PETC); Summer trip fund $250.00 (Travel, TRV, role set-aside); Everything else as the residual (Discretionary, ENT). Institution accounts: Checking ••1111 (in review, linked to HH), Savings ••2222 (in review, linked to PETC), Card ••3333 (in review, Shared), Brokerage ••4444 (snapshot only), Student loan ••5555 (snapshot only).

## 1. Navigation (V3-AT1)

1. The rail lists, in order: Dashboard; **Budgeting**: Budget and Tax, Budget Analysis, Budget History; **Treasury**: Monthly Reconciliation, Interaccount Debts, Accounts, Connected Accounts; then Import and Export, Settings. Every existing route and deep link still works.
2. Each label is identical to its page's title and window title. No navigation link contains a badge.
3. At 1280 px with default text size, every label fits on one line. With text enlarged to 200%, labels wrap and none is truncated.
4. Section labels are not focusable and are not headings; Tab visits the ten links in visual order; exactly one link has `aria-current="page"`; the focus ring has at least 3:1 contrast on the rail and on the active item.
5. At 390 px, a **Menu** button shows the current page's name; it opens the grouped list with `aria-expanded="true"`; Escape closes it and returns focus to the button; choosing a page closes it and focuses that page's `h1`. It starts closed after every page load.
6. Each page has exactly one `h1`.

## 2. Month membership and signs (V3-AT2)

1. A card purchase authorized 2026-07-31 and posted 2026-08-02 belongs to 2026-08, not 2026-07.
2. A pending transaction dated 2026-08-30 is shown for context, cannot be classified, and is not counted.
3. A timestamp at 2026-09-01T06:30:00Z with household time zone America/Los_Angeles is posted 2026-08-31.
4. For each account kind and each source (provider sandbox, OFX, QFX, CSV), a purchase is negative and a refund, deposit or card payment received is positive in canonical form. The adapter test fails if any is reversed.
5. The amount `"-12.345"` is kept exactly; `"1e3"`, `"12.34567"` and a non-numeric amount fail that account's gather with the source location.
6. A provider amount written in JSON as `9007199254740993.25` (beyond a double's exact range) reaches the domain as that exact decimal text (with its canonical sign), proving it never passed through a JavaScript number.

## 3. Coverage (V3-AT3)

1. With a settle delay of 3 days, a provider gather of Checking whose source freshness (the provider's last update from the institution) is 2026-09-01 is **Partial: not fresh enough**. A later gather whose source freshness is 2026-09-04 is **Complete**, even though the institution posted nothing new.
2. OFX files covering 2026-08-01 to 2026-08-15 and 2026-08-17 to 2026-08-31 make Savings **Partial: gap on 2026-08-16**. Adding a file covering 2026-08-16 makes it **Complete**.
3. A CSV with a confirmed range covering the month whose last row is 2026-08-20 imports with a truncation warning and is **Complete**.
4. Waiving Card with reason *no activity* succeeds when no posted August transactions were gathered for it, and is refused when one was.
5. An account with **in spending review** off never appears in coverage and never blocks clearing.
6. For a PDF-only card, entering three transactions and a closing balance with a confirmed statement period of 2026-08-01 to 2026-08-31 makes it **Complete**; the rows carry source `manual`.
7. An account linked on 2026-08-12 whose provider does not state where its history starts is **Partial: confirm history** for August until the owner confirms; the confirmation appears on the report's source row.
8. A gather run on 2026-10-15 for August requests posted transactions from 2026-07-25 through 2026-10-15, split into windows of at most 90 days for SimpleFIN.

## 4. Dispositions and splits (V3-AT4)

1. A −$120.00 purchase split into Groceries −$80.00 and Everything else −$40.00 is valid. Changing one part to −$39.99 blocks clearing with **Split differs by $0.01**.
2. A split part with the opposite sign of its transaction is rejected.
3. Income on an outflow is rejected. An inflow marked income `take_home` counts toward actual take-home.
4. A +$25.00 refund assigned to Groceries reduces Groceries actual by $25.00.
5. Excluding with reason `other` requires a note.
6. Switching the review's budget version to one without Car maintenance returns transactions assigned to it to unclassified, and lists them as blockers.

## 5. Transfers and pairing (V3-AT5)

1. Checking −$500.00 on 2026-08-10 and Card +$500.00 on 2026-08-12 are suggested as a pair; accepting sets both to transfer.
2. With a second Card +$500.00 on 2026-08-13, no pair is suggested and both candidates are listed.
3. A pair whose inflow posts 2026-09-02 counts only its August side.
4. Accepting, then unpairing, a transfer leaves all spending and income totals unchanged.
5. Checking −$300.00 to the Student loan (out of review) classified to its budget line counts as spending on that line.
6. A transfer whose `pairedId` points to a transaction that is not an accepted transfer paired back blocks clearing with **Unmatched transfer pair**.

## 6. Rules (V3-AT6)

1. `HARBOR MARKET #1234 MAPLE VALE` and `HARBOR MARKET #5678 ELM RIDGE` both normalize to match a rule `contains "HARBOR MARKET #"`.
2. With two matching rules, the one with the lower position wins.
3. Rule suggestions are **suggested**, never accepted, until the owner accepts them. **Accept all suggestions** accepts every suggestion in the current filter in one undoable step.
4. A rule pointing to a line key absent from the review's version suggests nothing and is shown as **Stale**.
5. Clearing a month where the owner classified `CORNER CAFE` as Everything else three times by hand offers to create a rule.

## 7. Clearing, replacing and deleting (V3-AT7)

1. With every clear condition met, clearing writes one report and the review shows **Cleared**.
2. Each clear condition in [Spending review rules §8](spending-review-rules.md#8-clearing), when violated alone, blocks clearing with its own named reason and a link to the affected row or account.
3. The identity check: for a fixture month with every disposition kind and a split, Σ in-month amounts equals the sum of all disposition totals exactly; a fixture that bypasses validation to break it by $0.01 cannot be cleared.
4. Starting a review for a cleared month asks for confirmation. Cancelling changes nothing. After confirming, the old report remains visible until the new review is cleared, then is replaced in one transaction.
5. The clear confirmation says that **Undo** will not restore the transactions. **Undo** after clearing restores the prior report state (no report, or the replaced report); the review stays cleared and its temporary data stays deleted.
6. Deleting a report asks for confirmation, is audited, and can be undone. Rules and connections are unchanged.
7. August's cleared report records Checking's tail totals for 2026-08-25 to 2026-08-31. A September gather that finds one more posted transaction dated 2026-08-29 on Checking shows "1 transaction, $18.40" for August and a **Re-run August** action, with no transaction details. A late posting dated 2026-08-20 is not detected.

## 8. Report contents and export (V3-AT8)

1. The report has one line row for every line in the version, including lines with no activity.
2. Groceries planned $600.00 and actual $642.18 shows **Over by $42.18**; Fuel and parking planned $200.00 and actual $199.995 shows **On plan**.
3. Summer trip fund (set-aside) is excluded from planned and actual spending totals and shown in the set-aside group.
4. Year to date through 2026-08 with cleared reports for January–June and August lists **July** as missing and sums only the cleared months.
5. Renaming the Groceries line or the HH account after clearing does not change the cleared report.
6. A search of the report tables for every fixture transaction description, merchant and individual amount finds none.
7. The `.xlsx` export contains the sheets in [Spending review rules §11](spending-review-rules.md#11-excel-export), its totals equal the app's to the cent, and it contains no transaction descriptions. The working-copy export shows a warning first and includes a Transactions sheet.
8. JSON and encrypted backup and restore into a fresh profile reproduce every report, rule, line role, connection and institution account. Neither backup contains a provider credential; restored provider connections use the vault on the service when it still holds their credentials, and otherwise show **Reconnect**.
9. A transaction description of `=HYPERLINK("http://x")` appears in the working-copy export as text, not as a formula.
10. A v0.2.2 JSON backup fixture (schema version 3) restores into v3: the budget lines receive line keys, lines with the same category and label in consecutive versions share a key, and two such lines within one version get different keys.

## 9. Balance snapshot (V3-AT9)

1. Checking value $2,400.00 as of 2026-09-05, with posted September transactions summing −$350.00 gathered through that date, gives an estimated 2026-08-31 value of $2,750.00, labelled **estimate**.
2. If September transactions are gathered only through 2026-09-03, no estimate is shown and the as-of value is used, with the date.
3. Brokerage and Student loan are shown as of their capture time and never estimated.
4. Card owing $812.40 is a liability of $812.40; a card with a $15.00 credit balance shows a credit, not a negative liability.
5. Net worth equals assets minus liabilities to the cent, and the change from the previous report lists new and missing accounts.
6. Interaccount debts do not appear in the snapshot.
7. Clearing is blocked while a snapshot account has no balance, until the owner gathers one, enters one, or marks it **unavailable**; an unavailable account is listed and left out of the totals.

## 10. Temporary storage and no persistence (V3-AT10)

1. Classify ten transactions, wait for **Saved**, force-close the tab without warning, reopen and sign in: all ten classifications are present.
2. Classify on the private website, then sign in on the desktop app: the review resumes at the same state.
3. After clearing: the local review store, the service's review storage, the synced SQLite file, every snapshot uploaded during the review (decrypted in the test), the audit log, a JSON backup and the service logs contain none of the canary descriptions or amounts. No rule is created from a canary description.
4. With the service offline at clearing time, the review shows **Cleared; temporary data awaiting deletion**; when the service returns, the data is deleted and the state clears.
5. A device holding a stale local copy deletes it after syncing the tombstone.
6. With a fixed clock: a review untouched for 7 days shows a warning; at 14 days without a change its data is deleted on the device and the service, and the index records **expired**. A review changed every few days still expires 45 days after it started, with a warning 3 days before.
7. **Discard review** asks for confirmation, says it cannot be undone, then deletes the temporary data everywhere and writes no report.
8. Clearing, then **Undo**, then restoring a JSON backup taken before the review, then choosing **Keep device copy** in a sync conflict, leaves the review index and tombstones unchanged, and no device keeps or resurrects the cleared review's data.
9. Within a review, **Cmd-Z** undoes the latest classification; after **Accept all suggestions**, one **Cmd-Z** undoes the whole bulk acceptance. Outside the review views, **Cmd-Z** undoes the latest database change.

## 11. Treasury and budget isolation (V3-AT11)

For a full gather-classify-clear cycle, the `journal_entries`, `journal_postings`, `monthly_allocations`, `monthly_cycles`, `debts`, `debt_events` and every budget table are unchanged, row for row. Treasury hints link to Monthly Reconciliation and write nothing.

## 12. Sign-in and security (V3-AT12)

Every requirement in [Security §7](security.md#7-security-requirements) has a named automated test or a recorded manual check. At minimum:

1. The server never receives the password: requests captured during setup, sign-in and password change contain only the derived authentication key and ciphertext.
2. A wrong password and an unknown User ID produce the same response and comparable timing. A wrong second-factor code, reachable only after a correct password, produces a generic second-factor failure.
3. Repeated failures slow and then temporarily block sign-in as specified, and a correct sign-in after the wait succeeds.
4. Changing the password keeps all history readable, ends other sessions, and does not re-upload snapshots.
5. A stolen copy of the service's data directory plus the environment variables cannot decrypt any snapshot or review.

## 13. Migration from v2.2 (V3-AT13)

1. From a fictional v2.2 history of five versions, migration produces five v3 versions whose decrypted databases are byte-identical to the originals.
2. Old files are deleted only after the owner confirms, and only after every new version has been read back and decrypted.
3. Interrupting migration at any step leaves the v2.2 history intact and readable; restarting completes it.

## 14. Critical end-to-end flows (V3-AT14)

Automate with Playwright in the demo (files) and the private build against a local service, and record a native pass for the desktop-only steps:

- In Chromium with a virtual passkey authenticator: sign in with the password and a passkey, reload and unlock with the password, lock after idle and unlock with the password, sign out. (Safari and iOS passkeys are checked by hand.)
- Add a file connection → import statements → classify with rules, a split and a pair → waive an account → clear → export `.xlsx`.
- Provider path (desktop, Plaid Sandbox): add a connection through Hosted Link → gather → force a login-required error → **Reconnect** in update mode → clear. If the owner chooses the non-Plaid option, the same path uses SimpleFIN's public demo token.
- Re-run a cleared month with confirmation → clear → the report is replaced.
- Start on the phone-width browser, finish on a desktop-width browser.

## 15. Provider adapters (V3-AT15)

1. A Plaid Sandbox purchase of 12.34 (Plaid's positive outflow) becomes canonical −12.34; a refund becomes positive. A SimpleFIN deposit string `"100.00"` stays +100.00.
2. With 9 of 10 Trial Items recorded as used, **Add connection** shows "1 of 10 remaining" before opening Hosted Link. Linking an institution that already has an Item is blocked with a pointer to **Reconnect**.
3. **Reconnect** on a Sandbox Item in a login-required state uses update mode: the access token and the Item count are unchanged.
4. A consent expiry 25 days away shows **Reconnect soon** on Connected Accounts and the Dashboard.
5. A provider response that repeats a transaction under a new ID (same account, date, amount and description) produces one **possible duplicate** flag, not a silent double count.
6. A malformed provider response (an amount of `"abc"`) fails that connection's gather with `malformed_response` and adds no transactions.
7. No request from the service process reaches a provider host during any of the above (checked by the service's egress log and SEC-VAULT-6).

## Release gate

The v3 release report lists every V3-AT test with its automated test name or recorded manual result, alongside the existing gate in [Acceptance tests](../acceptance-tests.md#release-gate).
