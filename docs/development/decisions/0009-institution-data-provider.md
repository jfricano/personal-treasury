# ADR 0009 — Institution data: Plaid Trial, statement files, and desktop-only gathering

Status: proposed · 2026-09-26. Becomes accepted when the owner confirms the provider (Product spec §10, Q2).

## Context

Budget vs actual needs posted transactions and balances from the owner's checking, savings, credit card, brokerage, retirement and loan accounts. The owner asked to use a service that simplifies connecting institutions, and asked for a non-Plaid option with its trade-offs. The full comparison is in [Institution data](../v3/aggregation.md).

For an individual in 2026, the realistic providers are Plaid's Trial plan (free, rich data, a lifetime cap of 10 institution logins that removal does not free) and SimpleFIN Bridge ($15 a year through MX, up to 25 institutions, no liability details, one credential for every linked institution). Teller covers banks and cards only; MX, Finicity, Akoya and Yodlee are contract-only.

A private coverage check of the owner's roughly nine institution logins found that Plaid reaches six, possibly seven (about seven Trial Items), SimpleFIN reaches three reliably and three more with poor connection longevity, and two are reachable by neither.

## Decision

1. **Plaid Trial is the recommended v3.0 provider**, used for the logins it reaches, within a guarded budget of about seven of its ten lifetime Items.
2. **SimpleFIN Bridge is the supported non-Plaid alternative.** If the owner prefers not to use Plaid, v3.0 ships the SimpleFIN adapter instead, with more months relying on files. Either way, the other adapter can be added later without changing any rule, table or screen.
3. **Statement files (OFX, QFX, QBO, CSV) and manual entry** cover institutions neither provider reaches, local-only profiles, and the demo.
4. **Linking and gathering run only in the signed-in desktop app.** Every provider credential, including Plaid's client ID and secret, lives only in the encrypted credential vault and is used by a Rust command with a host allowlist. The service never contacts a provider and never holds a credential or a raw transaction in plaintext. Plaid's guidance keeps these secrets off untrusted clients; in this single-user design the owner's desktop app, running only local code, is the trusted side. The owner confirms this reading against Plaid's terms when applying for the Trial.
5. **The Trial cap is protected in code:** remaining Items are shown before every Production link, duplicate links are blocked, re-consent always uses update mode, and all testing uses Sandbox.
6. **Liability details** come from Plaid where it supplies them, otherwise from optional owner-entered fields.

## Consequences

- Most months need few or no downloads; two or three logins remain files or manual entry.
- The owner sets up a Plaid developer team and Trial application once, and re-consents at several institutions about once a year.
- The Trial program is new. If its terms change or the cap binds, the SimpleFIN adapter and files cover the gap, or the owner obtains a Pay-as-you-go quote before upgrading.
- Provider gathers need the Mac; classification, clearing and file imports work on any signed-in device.
- Provider-side retention of transaction history is outside the app's control; the user guide says so.
