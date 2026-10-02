import { isTauri } from '@/db/storage';
import { plaidRequest } from '@/sources/plaid';
import { ProviderPanel } from './ProviderPanel';
import { useState } from 'react';
import { useTreasury } from '@/app/context';
import { Dialog, Field, Panel, useConfirm } from '@/components/ui';
import type { InstitutionAccount } from '@/domain/spending';
export function ConnectionsPage() {
  const { t, run, navigate, extras, toast } = useTreasury();
  const [name, setName] = useState(''),
    [editing, setEditing] = useState<InstitutionAccount | null>(null);
  const confirm = useConfirm();
  const connections = t.spending.connections().filter((c) => c.status !== 'removed'),
    accounts = t.spending.accounts();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Connected Accounts</h1>
          <p className="subtle">Real institution accounts, kept separate from your treasury buckets.</p>
        </div>
        <button className="btn" onClick={() => navigate({ page: 'analysis' })}>
          Open Budget Analysis
        </button>
      </div>
      <ProviderPanel />
      <Panel title="Add a statement connection">
        <form
          className="btn-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (run(() => t.spending.addConnection(name), 'Connection added')) setName('');
          }}
        >
          <Field label="Institution or connection name">
            <input
              className="box"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Household banking"
            />
          </Field>
          <button className="btn primary" disabled={!name.trim()}>
            Add file connection
          </button>
        </form>
        <p className="subtle">
          Import OFX, QFX, QBO or CSV statements in a monthly review. Use manual entry for PDF-only accounts.
        </p>
      </Panel>
      {connections.length === 0 && (
        <div className="empty-state">
          <h2>Your accounts start here</h2>
          <p>
            Add a connection, then choose which accounts belong in spending reviews and balance snapshots.
          </p>
        </div>
      )}
      {connections.map((c) => (
        <Panel
          key={c.id}
          title={c.displayName}
          actions={
            <>
              <span className="badge neutral">{c.provider === 'file' ? 'Statements' : c.provider}</span>
              <button
                className="btn small"
                onClick={() =>
                  setEditing({
                    id: crypto.randomUUID(),
                    connectionId: c.id,
                    providerRef: crypto.randomUUID(),
                    displayName: '',
                    mask: '',
                    kind: 'checking',
                    inReview: true,
                    inSnapshot: true,
                    confirmed: true,
                    treasuryAccountId: null,
                    shared: true,
                    active: true,
                    csvProfile: null,
                  })
                }
              >
                Add account
              </button>
              <button
                className="btn small"
                onClick={async () => {
                  if (
                    await confirm.ask(
                      'Remove this connection? Existing reports stay intact; its accounts leave future reviews.',
                      { danger: true },
                    )
                  )
                    try {
                      if (c.provider === 'plaid') {
                        if (!extras.security || !isTauri() || extras.security.offline)
                          throw new Error('Remove provider connections from the signed-in desktop app.');
                        const { vault, revision } = await extras.security.readVault();
                        const credential = vault.plaid,
                          item = credential?.items.find((i) => i.connectionId === c.id);
                        if (credential && item) {
                          await plaidRequest(credential, '/item/remove', { access_token: item.accessToken });
                          await extras.security.writeVault(
                            {
                              ...vault,
                              plaid: {
                                ...credential,
                                items: credential.items.filter((i) => i.connectionId !== c.id),
                              },
                            },
                            revision,
                          );
                        }
                      }
                      run(() => t.spending.removeConnection(c.id));
                    } catch (e) {
                      toast((e as Error).message, 'error');
                    }
                }}
              >
                Remove
              </button>
            </>
          }
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Kind</th>
                  <th>Spending review</th>
                  <th>Balance snapshot</th>
                  <th>Funded from</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts
                  .filter((a) => a.connectionId === c.id && a.active)
                  .map((a) => (
                    <tr key={a.id}>
                      <td>
                        {a.displayName}
                        {a.mask && ` ••${a.mask}`}
                      </td>
                      <td>{a.kind.replaceAll('_', ' ')}</td>
                      <td>{a.inReview ? 'Included' : 'Not included'}</td>
                      <td>{a.inSnapshot ? 'Included' : 'Not included'}</td>
                      <td>{a.treasuryAccountId ? t.nameOf(a.treasuryAccountId) : 'Shared'}</td>
                      <td>
                        <button className="btn small" onClick={() => setEditing(a)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
      <Dialog open={!!editing} title="Connected account" onClose={() => setEditing(null)}>
        {editing && (
          <form
            className="v3-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                run(() => t.spending.saveAccount({ ...editing, confirmed: true }), 'Account saved') !==
                undefined
              )
                setEditing(null);
            }}
          >
            <Field label="Display name">
              <input
                className="box"
                required
                value={editing.displayName}
                onChange={(e) => setEditing({ ...editing, displayName: e.target.value })}
              />
            </Field>
            <Field label="Last four digits (optional)">
              <input
                className="box"
                inputMode="numeric"
                pattern="[0-9]{0,4}"
                maxLength={4}
                value={editing.mask}
                onChange={(e) => setEditing({ ...editing, mask: e.target.value })}
              />
            </Field>
            <Field label="Account kind">
              <select
                className="box"
                value={editing.kind}
                onChange={(e) => {
                  const kind = e.target.value as InstitutionAccount['kind'];
                  setEditing({
                    ...editing,
                    kind,
                    inReview: ['checking', 'savings', 'credit_card'].includes(kind),
                  });
                }}
              >
                {[
                  'checking',
                  'savings',
                  'credit_card',
                  'brokerage',
                  'retirement',
                  'loan',
                  'student_loan',
                  'auto_loan',
                  'mortgage',
                  'other_asset',
                  'other_liability',
                ].map((k) => (
                  <option key={k} value={k}>
                    {k.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <label>
              <input
                type="checkbox"
                checked={editing.inReview}
                onChange={(e) => setEditing({ ...editing, inReview: e.target.checked })}
              />{' '}
              In spending review
            </label>
            <label>
              <input
                type="checkbox"
                checked={editing.inSnapshot}
                onChange={(e) => setEditing({ ...editing, inSnapshot: e.target.checked })}
              />{' '}
              In balance snapshot
            </label>
            {['loan', 'student_loan', 'auto_loan', 'mortgage', 'brokerage', 'retirement'].includes(
              editing.kind,
            ) &&
              editing.inReview && (
                <p className="notice">
                  Including this account can turn its incoming payments into internal transfers instead of
                  budget spending.
                </p>
              )}
            <Field label="Treasury bucket">
              <select
                className="box"
                value={editing.treasuryAccountId ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    treasuryAccountId: e.target.value || null,
                    shared: !e.target.value,
                  })
                }
              >
                <option value="">Shared / no link</option>
                {t.accounts().map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName || a.code}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn primary">Save account</button>
          </form>
        )}
      </Dialog>
      {confirm.element}
    </>
  );
}
