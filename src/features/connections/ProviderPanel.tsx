import { useState } from 'react';
import { useTreasury } from '@/app/context';
import { isTauri } from '@/db/storage';
import { Panel, Field } from '@/components/ui';
import { guardTrial, parsePlaid, plaidAccounts, plaidRequest, type PlaidCredential } from '@/sources/plaid';
export function ProviderPanel() {
  const { t, extras, toast } = useTreasury();
  const [clientId, setClientId] = useState(''),
    [secret, setSecret] = useState(''),
    [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox'),
    [institution, setInstitution] = useState(''),
    [name, setName] = useState(''),
    [remaining, setRemaining] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{ linkToken: string; connectionId: string; reconnect: boolean } | null>(
      null,
    );
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const [now] = useState(() => Date.now());
  const session = extras.security;
  if (!isTauri() || !session)
    return (
      <Panel title="Provider connections">
        <p>
          Plaid linking and gathering run in the signed-in desktop app. Statement imports and monthly reviews
          work here.
        </p>
      </Panel>
    );
  const link = async (connectionId?: string) => {
    const { vault } = await session.readVault();
    const c = vault.plaid;
    if (!c) throw new Error('Save Plaid credentials first');
    const existing = c.items.find((i) => i.connectionId === connectionId);
    if (!existing) guardTrial(c, institution);
    setRemaining(10 - c.productionItemsUsed);
    const body = {
      client_name: 'Personal Treasury',
      language: 'en',
      country_codes: ['US'],
      user: { client_user_id: session.id },
      hosted_link: {},
      ...(existing
        ? { access_token: existing.accessToken }
        : { products: ['transactions'], optional_products: ['liabilities'] }),
    };
    const response = parsePlaid(await plaidRequest(c, '/link/token/create', body)) as {
      link_token: string;
      hosted_link_url: string;
    };
    if (!response.link_token || !response.hosted_link_url)
      throw new Error('Provider did not return Hosted Link');
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_hosted_link', { url: response.hosted_link_url });
    setPending({
      linkToken: response.link_token,
      connectionId: connectionId ?? crypto.randomUUID(),
      reconnect: !!existing,
    });
  };
  return (
    <Panel title="Plaid desktop connections">
      <p>
        Use Sandbox for testing. Production Trial has ten lifetime Items; removal does not recover a slot.{' '}
        {remaining !== null && <strong>{remaining} of 10 remaining.</strong>}
      </p>
      <p className="subtle">
        If a sensitive operation asks for fresh proof, enter an authenticator code in Settings → Security
        first.
      </p>
      <details>
        <summary>Provider credentials</summary>
        <form
          className="v3-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              const { vault, revision } = await session.readVault();
              const prior = vault.plaid;
              if (prior && prior.items.length && prior.environment !== environment)
                throw new Error('Use a separate service for Sandbox and Production');
              await session.writeVault(
                {
                  ...vault,
                  plaid: {
                    clientId,
                    secret,
                    environment,
                    items: prior?.items ?? [],
                    productionItemsUsed: prior?.productionItemsUsed ?? 0,
                  },
                },
                revision,
              );
              setClientId('');
              setSecret('');
              toast('Credentials saved in the encrypted vault', 'success');
            });
          }}
        >
          <Field label="Plaid client ID">
            <input className="box" required value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </Field>
          <Field label="Plaid secret">
            <input
              className="box"
              type="password"
              required
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
          <Field label="Plaid environment">
            <select
              className="box"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as PlaidCredential['environment'])}
            >
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </Field>
          <button className="btn" disabled={busy}>
            Save credentials
          </button>
        </form>
      </details>
      <form
        className="v3-form"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(() => link());
        }}
      >
        <Field label="Connection display name">
          <input className="box" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Institution ID from Plaid">
          <input
            className="box"
            required
            placeholder="ins_…"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          />
        </Field>
        <button className="btn" disabled={busy || !!pending}>
          Open Hosted Link
        </button>
      </form>
      {pending && (
        <div className="notice">
          <p>Complete Hosted Link in your browser, then check its result here.</p>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const { vault, revision } = await session.readVault(),
                  c = vault.plaid!;
                const response = parsePlaid(
                  await plaidRequest(c, '/link/token/get', { link_token: pending.linkToken }),
                ) as {
                  link_sessions?: {
                    results?: { item_add_results?: { public_token: string }[] };
                    on_success?: { public_token?: string };
                  }[];
                };
                const token =
                  response.link_sessions?.flatMap((s) => s.results?.item_add_results ?? [])[0]
                    ?.public_token ??
                  response.link_sessions?.find((s) => s.on_success?.public_token)?.on_success?.public_token;
                if (pending.reconnect) {
                  const existing = c.items.find((i) => i.connectionId === pending.connectionId)!;
                  await plaidRequest(c, '/item/get', { access_token: existing.accessToken });
                  const connection = t.spending.connections().find((c) => c.id === pending.connectionId)!;
                  t.spending.saveProviderConnection({ ...connection, status: 'ready', lastError: null });
                  setPending(null);
                  return;
                }
                if (!token) throw new Error('Hosted Link has not returned a completed connection yet');
                guardTrial(c, institution);
                const exchange = parsePlaid(
                  await plaidRequest(c, '/item/public_token/exchange', { public_token: token }),
                ) as { access_token: string; item_id: string };
                if (!exchange.access_token || !exchange.item_id)
                  throw new Error('Invalid token exchange response');
                const credential = {
                  ...c,
                  productionItemsUsed: c.productionItemsUsed + (c.environment === 'production' ? 1 : 0),
                  items: [
                    ...c.items,
                    {
                      connectionId: pending.connectionId,
                      accessToken: exchange.access_token,
                      itemId: exchange.item_id,
                      institutionId: institution,
                    },
                  ],
                };
                await session.writeVault({ ...vault, plaid: credential }, revision);
                t.spending.saveProviderConnection({
                  id: pending.connectionId,
                  provider: 'plaid',
                  displayName: name,
                  status: 'ready',
                  providerRef: institution,
                  credentialRef: 'plaid',
                  lastSuccessAt: null,
                  lastError: null,
                  consentExpiresAt: null,
                });
                const accounts = plaidAccounts(
                  await plaidRequest(credential, '/accounts/get', { access_token: exchange.access_token }),
                  pending.connectionId,
                );
                for (const { account } of accounts) t.spending.saveAccount(account);
                setPending(null);
                setRemaining(10 - credential.productionItemsUsed);
                toast('Connected. Edit each account to confirm its kind and scope.', 'success');
              })
            }
          >
            Check connection result
          </button>
        </div>
      )}
      <ul className="issues">
        {t.spending
          .connections()
          .filter((c) => c.provider === 'plaid' && c.status !== 'removed')
          .map((c) => (
            <li key={c.id}>
              {c.displayName}
              {c.consentExpiresAt && Date.parse(c.consentExpiresAt) - now < 30 * 86400000 && (
                <span className="badge warn">Reconnect soon</span>
              )}
              <button className="btn small" disabled={busy} onClick={() => void perform(() => link(c.id))}>
                Reconnect
              </button>
            </li>
          ))}
      </ul>
    </Panel>
  );
}
