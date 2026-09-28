# Institution data: providers, gathering and statement files

Status: approved for implementation · 2026-09-26; the owner chose Plaid (Option A) on 2026-09-27

The spending review needs posted transactions and balances from the owner's checking, savings, credit card, brokerage, retirement and loan accounts. This document compares the ways to get them, including an option without Plaid, recommends one, and specifies where gathering runs, the adapter contract, and statement-file import. It names none of the owner's institutions: their coverage, quirks and connection plan are in the private notes (`reference/v3-institutions.md`). Research date 2026-09-26; every material claim has a source in §12.

## 1. What a source must provide

| Need | Level | Notes |
| --- | --- | --- |
| Posted transactions for a chosen month, for checking, savings and credit cards | Must | With a transaction ID and posted date. |
| Current balances for every account kind, including brokerage, retirement and loans | Must | For the balance snapshot. |
| Read-only access usable by one individual, not a registered business | Must | No money movement. |
| Institution credentials never handled by the app | Must | Linking happens on the provider's own page. |
| Credentials revocable by the owner | Must | |
| Low running cost for one person | Must | |
| Liability details (APR, statement balance, minimum payment, due date) | Should | FR-NW-4. Owner-entered fields are the fallback. |
| Investment holdings | Could | V3 stores account totals only. |
| Merchant names and categories | Could | The owner's rules classify; provider categories are context only. |

## 2. The options

### Option A — Plaid

Plaid's **Trial** plan (April 2026) is free and aimed at hobbyists. It includes Transactions, Balance, Investments and Liabilities, with immediate access to institutions that use OAuth [P1, P2]. On the desktop app, linking must use **Hosted Link** in the system browser, because Plaid no longer lets new customers embed Link in a webview [P6, P7].

- **Strengths:** the widest reach for the owner's institutions (below); liability details for cards and student loans; holdings; merchant names and categories; SOC 2 Type II and ISO 27001 [P23]; a separate access token per institution login, so one leaked token exposes one institution; Sandbox testing that is free and unlimited [P1].
- **Trade-offs:**
  - **10 Production Items for the life of the team.** An Item is one institution login. Removing an Item does not free its slot, and every Production access token counts [P1]. Re-consent must go through update mode, which keeps the same Item [P12]; a fresh link of the same login spends a new slot, and some OAuth institutions allow only one active Item per app.
  - Setup: a developer team, a Trial application and a Link use case before the first real connection [P1, P4].
  - Re-consent about every 12 months at several large institutions [P5].
  - Amounts are JSON floating-point numbers where **positive means money out** [P18]; the adapter parses losslessly and negates.
  - Paid plans beyond Trial have unpublished prices, and Trial Items with subscription products start billing on upgrade [P1].
  - Plaid keeps transaction history while an Item is connected [P15].

### Option B — Without Plaid: SimpleFIN Bridge

SimpleFIN Bridge is a paid personal service ($15 a year) that connects up to 25 institutions through MX, one of the large aggregators, and gives the owner one **Access URL** for reading them [S1, S3]. The owner links institutions on SimpleFIN's site and pastes a one-time Setup Token into the app [S2].

- **Strengths:** no developer registration or application; no lifetime cap; the simplest integration (one `GET` returns transactions, balances and holdings) [S2, S4, S7]; decimal-string amounts where positive means a deposit [S4]; a different network from Plaid.
- **Trade-offs:**
  - **Narrower reach for the owner's institutions** (below), so more months need statement files or manual entry.
  - **No liability details** and no account types; the owner sets each account's kind and types any APR or minimum payment.
  - **One credential reads every linked institution.** A leaked Access URL exposes all of them until the owner disables it on SimpleFIN's site.
  - **A small vendor:** third-party security testing but no SOC 2 or ISO claim found; liability capped at the fee paid; a disclosed MX incident on 2026-05-28 in which up to 39 users could see each other's data for four hours [S3, S6].
  - **Unstable transaction IDs** at one large card issuer, reported in September 2026: IDs are re-issued in date blocks, producing duplicates in clients that de-duplicate by ID alone [S11]. The app's content-based duplicate check (Spending review rules §3) catches these.
  - **Limits:** about 24 requests a day (exceeding it can disable the token), 90 days per request, history often 30–90 days on first link, and refreshes about once a day [S2, S10].

### Option C — Statement files only

The owner downloads OFX, QFX, QBO or CSV files every month and imports them. This path exists in every option (§6).

- **Strengths:** no third party; works offline and in local-only profiles; no cost.
- **Trade-offs:** monthly downloads from every institution's website; CSV layouts differ; some institutions now offer only CSV or PDF, and some card servicers offer only PDF statements, so balances and transactions are typed in.

### Others considered

| Provider | Why not |
| --- | --- |
| Teller | Free development tier, but checking, savings and credit cards only, an mTLS certificate for every call, and business verification for production [T1, T3, T4, T5]. It reached no institution that A or B could not. |
| SnapTrade Personal | Brokerage only, and its API can place trades [O1]. A read-only app should not hold a trading-capable credential. |
| MX, Finicity, Akoya, Yodlee | Business contracts or onboarding only [O2–O7]. MX is reachable for an individual through SimpleFIN. |
| Quiltt | $100 a month [O8]. |
| Tiller | $99 a year, but writes raw transactions into online spreadsheets [O9], which contradicts keeping transactions temporary. |

## 3. Comparison and recommendation

The private coverage check looked up each of the owner's institution logins in Plaid's published coverage file, SimpleFIN's institution search, Teller's institution list and an independent connection-health dataset. In aggregate:

| | A: Plaid | B: SimpleFIN (no Plaid) | C: Files only |
| --- | --- | --- | --- |
| Owner's logins reached (of about 9) | 6, possibly 7 | 3 reliably; 3 more with poor connection longevity | All that offer downloads |
| Logins left to files or manual entry | 2–3 | 3–6 | All |
| Plaid Trial Items used | About 7 of 10, lifetime | 0 | 0 |
| Cost | $0 on Trial | $15/year | $0 |
| One-time setup | Developer team, Trial application, Hosted Link per login | Link on SimpleFIN's site, paste one token | None |
| Liability details | Cards and student loans | Owner-entered | Owner-entered |
| Credential blast radius | One login per token | Every linked login | None |
| Vendor assurance | SOC 2 II, ISO 27001 | Pentested; no certification found | n/a |
| Build effort in this app | Moderate: Hosted Link, polling, token exchange, update mode, cap guard, liabilities | Low: token claim, one `GET` | Parsers only (needed in every option) |

**Decision (owner, 2026-09-27): Option A, Plaid Trial, for v3.0, with statement files for the institutions it cannot reach. Option B remains a supported alternative behind the same adapter contract.**

1. Plaid reaches roughly twice as many of the owner's logins as SimpleFIN does reliably, which is the difference between a mostly automatic month and a month of downloads.
2. It supplies liability details the balance snapshot would otherwise need typed in, and each credential exposes one login rather than all of them.
3. About 7 Items leaves 3 spare. The app protects the cap: it shows the remaining Items before every Production link, blocks linking an institution that already has an Item, sends every re-consent through update mode, and keeps all testing in Sandbox.
4. The adapter contract (§5) keeps the choice reversible. If the Trial's terms change or the cap binds, the SimpleFIN adapter and files cover the gap without changing any domain rule, table or screen.

**Choose B instead** if the owner prefers not to use Plaid at all. It works: the owner's main bank, main card issuer and brokerage connect reliably, and the rest are files or manual entry each month. The cost is roughly six extra downloads or entries a month, no automatic liability details, and a single credential for everything.

**Choose C** for any institution neither provider reaches, and whenever the owner prefers no third party.

The owner confirmed Option A on 2026-09-27 (Product spec §10, Q2). The private notes list the open questions that affect it, such as which loan servicer and which card products are involved.

## 4. Where gathering runs

Provider credentials are the most sensitive secret v3 adds: whoever holds one can read institution data without the owner's password.

**Decision for v3.0: provider linking and gathering run only in the signed-in desktop app.**

- Every provider credential (for Plaid: the client ID, secret and each Item's access token; for SimpleFIN: the Access URL) is stored only in the encrypted **credential vault**: one latest-only object, encrypted under the data key, kept on the service and the desktop, and never in the database, snapshots, backups or exports ([Security §5.6](security.md#56-provider-credentials)). The service never holds a credential in plaintext and has no route that contacts a provider.
- On a gather, the desktop app decrypts the credential in memory and passes it to a Rust command. The command calls only allowlisted provider hosts over HTTPS, refuses redirects, enforces the provider's rate limits and quotas, returns the raw response text, and keeps nothing. The webview never gets general network access.
- Plaid's Hosted Link opens in the system browser, and only for a link URL on Plaid's hosted-link domain returned by Plaid itself. The app polls for the result; no webhook or inbound endpoint exists.
- Gathered data goes straight into the encrypted review store, so classification can continue on any signed-in device, including the phone.
- The website and phone can import statement files and classify, but cannot link or gather from providers.

**Trade-offs.** A provider gather needs the Mac. The alternative, a service proxy, would put provider credentials and plaintext transactions in the internet-facing process during every gather. Plaid's guidance is to keep its secret and access tokens off *untrusted* clients; here the owner is both the developer and the only user, the desktop app runs only local code, and no service proxy exists, so the desktop is the trusted side. The ADR records this reading and asks the owner to confirm it against Plaid's terms when applying for the Trial.

## 5. Source adapter contract

Every source, provider or file, produces the same result, and only adapters know provider formats.

```ts
interface GatherRequest {
  accounts: ProviderAccountRef[];   // the in-scope and snapshot accounts on this connection
  start: IsoDate;                   // Spending review rules §2 gather window
  end: IsoDate;
  wantBalances: boolean;
}

interface GatherResult {
  retrievedAt: IsoDateTime;
  accounts: {
    ref: ProviderAccountRef;
    name: string;
    mask?: string;                  // last four only
    kindHint?: InstitutionAccountKind;
    balance?: { value: Money; available?: Money; asOf: IsoDateTime };
    liability?: LiabilityDetails;   // when the source supplies it
    historyStartsAfter?: IsoDate;   // when the source says history is shorter than requested
  }[];
  transactions: CanonicalTransaction[];   // Spending review rules §3: canonical sign, exact decimal text
  errors: { accountRef?: ProviderAccountRef; code: SourceErrorCode; detail: string }[];
}
```

- `SourceErrorCode` is a small set shown in plain words: `needs_reconnect`, `consent_expiring`, `institution_unavailable`, `rate_limited`, `credential_revoked`, `history_unavailable`, `malformed_response`, `network`, `item_limit_reached`.
- Adapters parse provider JSON with a **lossless parser** (numbers kept as text) and validate every field with Zod. A malformed response fails that connection's gather and never produces partial transactions.
- A `kindHint` pre-fills the account kind; the owner still confirms it.
- Each adapter has fixture tests for every account kind, both signs, pending and posted items, removed items, and each error code.

### Plaid adapter (v3.0)

- **Keys:** the owner enters the Plaid client ID and secret once in the desktop app (step-up); they go into the vault. Production and Sandbox keys are kept apart, and Sandbox is used for every test.
- **Link:** `/link/token/create` with `hosted_link`, the Transactions product with `days_requested = 730` (it cannot be raised later) [P17], and Liabilities and Investments where the account kinds need them; open the returned URL in the system browser; poll `/link/token/get` for the `public_token` (available for 6 hours) [P6]; exchange it for an access token, which goes straight into the vault.
- **Cap guard:** before any Production link, show "N of 10 Trial Items used", and block the link if an Item already exists for that institution. `TRIAL_CONNECTION_LIMIT` maps to `item_limit_reached` [P1, P11].
- **Reconnect:** always **update mode** on the existing access token, never a fresh link [P12]. `/item/get` → `consent_expiration_time` drives a **Reconnect soon** notice a month ahead [P5].
- **Gather:** `/transactions/get` for the window (stateless, so no sync cursor needs storing); `/accounts/get` for balances cached at the last update (no per-call charge); `/liabilities/get` for card and student-loan details; `/investments/holdings/get` only if account totals are missing [P14, P18, P19]. Respect Plaid's per-Item rate limits.
- **Freshness:** the Item's last successful transactions update from `/item/get` is the source freshness time used for coverage ([Spending review rules §4](spending-review-rules.md#4-coverage-and-completeness)).
- **Mapping:** negate `amount` (Plaid's positive is an outflow); `date` → posted date; `authorized_date` → authorized date; `name`, `merchant_name`, `personal_finance_category` → description fields; `pending` items and `pending_transaction_id` are context only; account `type`/`subtype` → `kindHint`.
- **Remove:** `/item/remove`, then delete the vault entry. The owner is told that removing does not free a Trial slot.

### SimpleFIN adapter (v3.x fallback)

- **Link:** the owner pastes a Setup Token; the desktop app base64-decodes it to a claim URL, confirms it is HTTPS on the Bridge host, and `POST`s once. The Access URL goes straight into the vault as **one credential record** that covers every institution the owner linked at SimpleFIN; each institution (`conn_id`) becomes a connection referring to that record. The Setup Token is discarded [S2, S4]. A claim that fails with HTTP 403 means the token may have been used by someone else.
- **Gather:** `GET {access URL}/accounts?version=2&start-date=…&end-date=…&pending=1`, **one request per credential** per gather (covering all its institutions), split into 90-day windows only if needed [S2, S4]. The app refuses more than 20 requests a day.
- **Freshness:** each account's `balance-date` is its source freshness time for coverage.
- **Mapping:** `posted` (a timestamp) → posted date by the rule in [Spending review rules §2](spending-review-rules.md#2-months-and-dates) (a timestamp at exactly midnight UTC is a UTC date), proven with recorded fixtures that include month-end postings; `amount` (string, positive = deposit) → canonical as is; `transacted_at` → authorized date; `description`, `payee`, `memo` → description fields; `balance`, `available-balance`, `balance-date` → balance.
- **IDs are not trusted alone:** content-based duplicate detection always runs (Spending review rules §3).
- **Errors:** `errlist` entries map to `SourceErrorCode`; HTTP 403 means the credential was revoked.
- **Remove:** removing one institution tells the owner to unlink it on SimpleFIN's site and stops gathering it; the credential record is deleted only with its last connection, and the owner is told to disable the token on SimpleFIN's site, which the app cannot do.

## 6. Statement files

Required in every option, and the only source for local-only desktop profiles and the public demo.

| Format | Handling |
| --- | --- |
| OFX 2.x (XML) | `BANKACCTFROM` / `CCACCTFROM`, `STMTTRN` (`TRNTYPE`, `DTPOSTED`, `TRNAMT`, `FITID`, `NAME`, `MEMO`), `LEDGERBAL` / `AVAILBAL` with `DTASOF`, and the statement's `DTSTART`–`DTEND` for coverage [F4]. |
| OFX 1.x / QFX / QBO (SGML) | The same fields after an SGML-tolerant pass that closes unclosed tags; never a strict XML parse [F4, F6]. |
| CSV | A mapping step: posted date column and format, amount column or separate debit and credit columns, description, optional balance; the outflow sign chosen by the owner and confirmed against sample rows. Mappings are saved per institution account as profiles, because some institutions now offer only CSV. |
| Investment OFX (`INVSTMTRS`) | V3 reads the account's total value only. |
| PDF-only statements | Not parsed. The owner enters the month's transactions and closing balance by hand in a small form on the account's coverage row; entered rows carry the source `manual` and count toward coverage like a file. |

- `FITID` is the identity, but some institutions repeat or omit it [F6]. A repeated or missing `FITID` falls back to the CSV identity rule in [Spending review rules §3](spending-review-rules.md#3-transactions) and is flagged, never silently merged.
- OFX Direct Connect is not built; the institutions checked no longer offer it to new clients [F1].
- Each import records the file name and SHA-256 and warns when the same file is imported twice.

## 7. Liability details without a provider

Institution accounts of kind credit card, student loan, auto loan and mortgage have optional owner-entered fields: APR, minimum payment and due day. The balance snapshot copies whatever is filled in, labelled **entered by owner**. Provider-supplied values replace them and are labelled with their source.

## 8. Operating notes for the owner

- **Plaid:** protect the Plaid dashboard account with two-factor sign-in; keep all experiments in Sandbox; link each institution login in Production exactly once, following the private plan; use **Reconnect** (update mode) for every re-consent; rotate the secret yearly or on suspicion.
- **SimpleFIN, if used:** protect the account with TOTP; review its connected apps yearly; rotate the Access URL yearly or on suspicion by disabling it on SimpleFIN's site and reconnecting with a new Setup Token.
- Keep gathers to one or two per month-close.
- Record each institution's status, file format and quirks in the private notes, never in public documents.

## 9. Regulatory context

The CFPB's Section 1033 rule has been blocked from enforcement since 2025-10-29 while the agency rewrites it; a reconsideration proposal went to review in August 2026 [R3, R5]. The rule never gave individuals direct API access, so it changes nothing for this design in the next year. The practical risks are aggregator price increases if banks begin charging for data access, and more institutions moving to OAuth with periodic re-consent. Some federal student-loan servicers have blocked aggregators since late 2025; their balances would be entered by hand.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Plaid changes or ends the Trial, or the 10-Item cap binds. | Cap guard and update mode; the SimpleFIN adapter and files as fallbacks; a Pay-as-you-go quote before any upgrade. |
| An institution's connection breaks for weeks. | Coverage shows it; **Import file**, manual entry or **Waive** keeps the month moving. |
| A leaked provider credential. | Vault-only storage, desktop-only use, revocation at the provider, rotation. |
| Provider IDs change or repeat. | Content-based duplicate detection in every review. |
| Provider-side retention of history. | Unavoidable with any provider; stated in the user guide. Option C avoids it. |
| Sign and precision errors. | Canonical sign and lossless parsing, proven by adapter fixtures. |

## 11. Private coverage check

Done 2026-09-26 and recorded in `reference/v3-institutions.md`: per login, reach by Plaid (and OAuth status), by SimpleFIN/MX (with connection-health ratings), and by Teller; website export formats; known 2026 changes; the Plaid Item plan; and open questions for the owner. Update it as institutions are connected.

## 12. Sources

- [P1] Plaid, Pricing and billing: https://plaid.com/docs/account/billing/
- [P2] Plaid, Changelog: https://plaid.com/docs/changelog/
- [P4] Plaid, Link customization and use cases: https://plaid.com/docs/link/customization/
- [P5] Plaid, OAuth guide: https://plaid.com/docs/link/oauth/
- [P6] Plaid, Hosted Link: https://plaid.com/docs/link/hosted-link/
- [P7] Plaid, Webview integrations: https://plaid.com/docs/link/webview/
- [P11] Plaid, Errors and rate limits: https://plaid.com/docs/errors/
- [P12] Plaid, Update mode: https://plaid.com/docs/link/update-mode/
- [P14] Plaid, Accounts API: https://plaid.com/docs/api/accounts/
- [P15] Plaid, Transactions overview: https://plaid.com/docs/transactions/
- [P17] Plaid, Transactions data: https://plaid.com/docs/transactions/transactions-data/
- [P18] Plaid, Transactions API: https://plaid.com/docs/api/products/transactions/
- [P19] Plaid, Liabilities: https://plaid.com/docs/liabilities/
- [P23] Plaid, Trust and security: https://plaid.com/safety/
- Plaid US institution coverage file (generated 2026-09-18): https://plaid.com/documents/us_institution_coverage.csv
- [S1] SimpleFIN Bridge: https://beta-bridge.simplefin.org/
- [S2] SimpleFIN Bridge developer guide: https://beta-bridge.simplefin.org/info/developers
- [S3] SimpleFIN Bridge security policy: https://beta-bridge.simplefin.org/info/security
- [S4] SimpleFIN protocol 2.0.0: https://www.simplefin.org/protocol.html
- [S5] SimpleFIN Bridge privacy policy: https://beta-bridge.simplefin.org/info/privacy
- [S6] SimpleFIN Bridge terms (updated 2026-07-21): https://beta-bridge.simplefin.org/info/terms
- [S7] SimpleFIN public demo token response, fetched 2026-09-26 through the developer guide
- [S10] Actual Budget, SimpleFIN bank sync: https://actualbudget.org/docs/advanced/bank-sync/simplefin/
- [S11] SimpleFIN bridge issue on re-issued transaction IDs (2026-09-07): https://github.com/simplefin/bridge-issues/issues/28
- [T1] Teller: https://teller.io/ · [T3] environments: https://teller.io/docs/guides/environments · [T4] authentication: https://teller.io/docs/api/authentication · [T5] accounts: https://teller.io/docs/api/accounts
- [O1] SnapTrade Personal: https://snaptrade.com/personal
- [O2–O7] MX, Mastercard Open Finance, Akoya and Yodlee developer and onboarding pages (research notes)
- [O8] Quiltt pricing: https://www.quiltt.io/pricing · [O9] Tiller: https://www.tillerhq.com/
- [R3] ABA Banking Journal, court enjoins the 1033 rule: https://bankingjournal.aba.com/2025/11/kentucky-federal-court-enjoins-cfpb-from-enforcing-current-1033-final-rule/
- [R5] Consumer Finance Monitor, 1033 proposal sent to OIRA: https://www.consumerfinancemonitor.com/2026/08/06/cfpb-sends-new-section-1033-open-banking-proposal-to-oira-for-review/
- [F1] GnuCash wiki, OFX Direct Connect: https://wiki.gnucash.org/wiki/OFX_Direct_Connect_Bank_Settings
- [F4] What is an OFX/QFX file: https://www.legacyfile.net/learn/what-is-an-ofx-file
- [F6] QBO validator guide (FITID, SGML): https://dataconversioncenter.com/blog/guide-qbo-validator/
