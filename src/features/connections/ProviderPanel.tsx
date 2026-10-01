import { useState } from 'react';
import { useTreasury } from '@/app/context';
import { isTauri } from '@/db/storage';
import { Panel, Field } from '@/components/ui';
import {
  guardTrial,
  countLinkAttempt,
  abandonPendingLink,
  hostedLinkResult,
  parsePlaid,
  plaidAccounts,
  plaidRequest,
  type PendingLink,
  type PlaidCredential,
} from '@/sources/plaid';
export function ProviderPanel() {
  const { t, extras, toast } = useTreasury();
  const [clientId, setClientId] = useState(''),
    [secret, setSecret] = useState(''),
    [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox'),
    [institution, setInstitution] = useState(''),
    [name, setName] = useState(''),
    [remaining, setRemaining] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<PendingLink | null>(null);
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
  if (!isTauri() || !session || session.offline)
    return (
      <Panel title="Provider connections">
        <p>
          Plaid linking and gathering run in the signed-in desktop app. Statement imports and monthly reviews
          work here.
        </p>
      </Panel>
    );
  const link = async (connectionId?: string) => {
    const { vault, revision } = await session.readVault();
    const c = vault.plaid;
    if (!c) throw new Error('Save Plaid credentials first');
    if (c.pendingLink)
      throw new Error('Finish or abandon the pending Hosted Link before opening another connection.');
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
    const next: PendingLink = {
      linkToken: response.link_token,
      hostedUrl: response.hosted_link_url,
      connectionId: connectionId ?? crypto.randomUUID(),
      reconnect: !!existing,
      institutionId: existing?.institutionId ?? institution,
      displayName: existing
        ? (t.spending.connections().find((c) => c.id === connectionId)?.displayName ?? name)
        : name,
      reservation: !existing && c.environment === 'production',
      counted: false,
    };
    const reserved = countLinkAttempt({ ...c, pendingLink: next });
    await session.writeVault({ ...vault, plaid: reserved }, revision);
    setPending(reserved.pendingLink!);
    setRemaining(10 - reserved.productionItemsUsed);
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_hosted_link', { url: next.hostedUrl });
  };
  return (
    <Panel title="Plaid desktop connections">
      <p>
        Use Sandbox for testing. The configured Production Trial budget is ten lifetime Items. Pending links
        consume a slot before opening; reopening an unfinished link may create another Item and consumes
        another slot. Abandoning or removing a connection does not recover slots.{' '}
        {remaining !== null && <strong>{remaining} of 10 remaining.</strong>}
      </p>
      <p className="subtle">
        If a sensitive operation asks for fresh proof, verify your password in Settings → Security first.
      </p>
      <button
        className="btn"
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            const { vault } = await session.readVault();
            const c = vault.plaid;
            if (c) {
              for (const item of c.items) {
                const connection = t.spending.connections().find((x) => x.id === item.connectionId);
                if (connection?.status === 'removed') continue;
                if (!connection)
                  t.spending.saveProviderConnection({
                    id: item.connectionId,
                    provider: 'plaid',
                    displayName: item.displayName ?? item.institutionId,
                    status: 'ready',
                    providerRef: item.institutionId,
                    credentialRef: 'plaid',
                    lastSuccessAt: null,
                    lastError: null,
                    consentExpiresAt: null,
                  });
                const accounts = plaidAccounts(
                  await plaidRequest(c, '/accounts/get', { access_token: item.accessToken }),
                  item.connectionId,
                  t.spending.accounts().filter((a) => a.connectionId === item.connectionId),
                );
                for (const { account } of accounts) t.spending.saveAccount(account);
              }
            }
            setPending(c?.pendingLink ?? null);
            setRemaining(c ? 10 - c.productionItemsUsed - (c.pendingLink?.reservation ? 1 : 0) : null);
          })
        }
      >
        Refresh provider state
      </button>
      <details>
        <summary>Provider credentials</summary>
        <form
          className="v3-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              const { vault, revision } = await session.readVault();
              const prior = vault.plaid;
              if (prior && (prior.items.length || prior.pendingLink) && prior.environment !== environment)
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
                    pendingLink: prior?.pendingLink,
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
          <p>
            Complete Hosted Link in your browser, then check its result here. Pending work is kept encrypted
            across restart.
          </p>
          <button
            className="btn"
            disabled={busy || !!pending.publicToken}
            onClick={() =>
              void perform(async () => {
                if (
                  !pending.reconnect &&
                  !window.confirm(
                    'Reopening may create another Item and consumes another lifetime Trial slot in Production. Continue?',
                  )
                )
                  return;
                const { vault, revision } = await session.readVault();
                const c = vault.plaid;
                if (!c?.pendingLink || c.pendingLink.linkToken !== pending.linkToken)
                  throw new Error('Refresh the provider state first.');
                const next = countLinkAttempt(c);
                await session.writeVault({ ...vault, plaid: next }, revision);
                setPending(next.pendingLink!);
                setRemaining(10 - next.productionItemsUsed);
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('open_hosted_link', { url: pending.hostedUrl });
              })
            }
          >
            Resume Hosted Link
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                let { vault, revision } = await session.readVault();
                let c = vault.plaid!;
                if (!c.pendingLink || c.pendingLink.linkToken !== pending.linkToken)
                  throw new Error('Refresh the pending provider connection first.');
                const response = parsePlaid(
                  await plaidRequest(c, '/link/token/get', { link_token: pending.linkToken }),
                ) as {
                  link_sessions?: {
                    results?: { item_add_results?: { public_token: string }[] };
                    on_success?: { public_token?: string };
                  }[];
                };
                if (pending.reconnect) {
                  const existing = c.items.find((i) => i.connectionId === pending.connectionId)!;
                  if (
                    !(response.link_sessions ?? []).some((s) => !!(s as { finished_at?: string }).finished_at)
                  )
                    throw new Error('Finish Hosted Link before checking reconnect.');
                  const item = parsePlaid(
                    await plaidRequest(c, '/item/get', { access_token: existing.accessToken }),
                  ) as { item?: { error?: unknown; institution_id?: string } };
                  if (!item.item || item.item.error || item.item.institution_id !== existing.institutionId)
                    throw new Error('This institution still needs reconnect.');
                  await session.writeVault({ ...vault, plaid: { ...c, pendingLink: undefined } }, revision);
                  const connection = t.spending.connections().find((c) => c.id === pending.connectionId)!;
                  t.spending.saveProviderConnection({ ...connection, status: 'ready', lastError: null });
                  setPending(null);
                  return;
                }
                const token =
                  c.pendingLink.publicToken ??
                  hostedLinkResult(JSON.stringify(response), pending.institutionId);
                if (c.items.some((i) => i.institutionId === pending.institutionId))
                  throw new Error('This institution is already connected.');
                if (!c.pendingLink.publicToken) {
                  await session.writeVault(
                    {
                      ...vault,
                      plaid: {
                        ...c,
                        productionItemsUsed:
                          c.productionItemsUsed +
                          (c.environment === 'production' && !c.pendingLink.counted ? 1 : 0),
                        pendingLink: {
                          ...c.pendingLink,
                          publicToken: token,
                          counted: true,
                          reservation: false,
                        },
                      },
                    },
                    revision,
                  );
                  ({ vault, revision } = await session.readVault());
                  c = vault.plaid!;
                }
                const exchange = parsePlaid(
                  await plaidRequest(c, '/item/public_token/exchange', { public_token: token }),
                ) as { access_token: string; item_id: string };
                if (!exchange.access_token || !exchange.item_id)
                  throw new Error('Invalid token exchange response');
                const itemInfo = parsePlaid(
                  await plaidRequest(c, '/item/get', { access_token: exchange.access_token }),
                ) as { item?: { institution_id?: string } };
                if (itemInfo.item?.institution_id !== pending.institutionId)
                  throw new Error(
                    'Exchanged Item belongs to a different institution. The reserved slot remains counted.',
                  );
                const credential = {
                  ...c,
                  productionItemsUsed: c.productionItemsUsed,
                  pendingLink: undefined,
                  items: [
                    ...c.items,
                    {
                      connectionId: pending.connectionId,
                      accessToken: exchange.access_token,
                      itemId: exchange.item_id,
                      institutionId: pending.institutionId,
                      displayName: pending.displayName,
                    },
                  ],
                };
                await session.writeVault({ ...vault, plaid: credential }, revision);
                t.spending.saveProviderConnection({
                  id: pending.connectionId,
                  provider: 'plaid',
                  displayName: pending.displayName,
                  status: 'ready',
                  providerRef: pending.institutionId,
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
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                if (
                  !window.confirm(
                    'Abandon this pending connection? Any used or uncertain Trial slots remain consumed. If an Item was created, remove it in Plaid before trying again.',
                  )
                )
                  return;
                const { vault, revision } = await session.readVault();
                if (!vault.plaid?.pendingLink || vault.plaid.pendingLink.linkToken !== pending.linkToken)
                  throw new Error('Refresh the provider state first.');
                const next = abandonPendingLink(vault.plaid);
                await session.writeVault({ ...vault, plaid: next }, revision);
                setPending(null);
                setRemaining(10 - next.productionItemsUsed);
              })
            }
          >
            Abandon pending connection
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
