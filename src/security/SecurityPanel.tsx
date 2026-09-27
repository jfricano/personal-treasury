import { useEffect, useState, useSyncExternalStore } from 'react';
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useApp } from '@/app/context';
import { Field, Panel, useConfirm } from '@/components/ui';
import type { V3Session } from './client';
import { encryptedBackup, decryptBackup } from './crypto';
import { createBackup, readBackup, buildDatabaseFromBackup } from '@/export/backup';
import { loadSqlJs } from '@/db/driver';
import { saveFile, pickFile } from '@/platform/files';
export function SecurityPanel({ session }: { session: V3Session }) {
  const { treasury: t, toast, extras } = useApp();
  const status = useSyncExternalStore(session.subscribe, session.getStatus),
    confirm = useConfirm();
  const [events, setEvents] = useState<{ time: string; type: string }[]>([]),
    [versions, setVersions] = useState<{ revision: number; createdAt: string; pinned: boolean }[]>([]),
    [code, setCode] = useState(''),
    [passphrase, setPassphrase] = useState(''),
    [repeat, setRepeat] = useState(''),
    [busy, setBusy] = useState(false);
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
  useEffect(() => {
    void session.client
      .request<typeof events>('/api/auth/activity')
      .then(setEvents)
      .catch(() => undefined);
    void session.client
      .request<typeof versions>('/api/sync/versions')
      .then(setVersions)
      .catch(() => undefined);
  }, [session, status.revision]);
  const step = async () => {
    if (code) {
      await session.client.request('/api/auth/step-up', 'POST', { method: 'totp', code });
      setCode('');
    }
  };
  return (
    <>
      <Panel
        title="Security"
        actions={
          <button className="btn small" onClick={extras.onLock}>
            Lock now
          </button>
        }
      >
        <p>Signed in as {session.id}. Passwords and data keys stay in memory while unlocked.</p>
        <Field label="Authenticator code for sensitive changes">
          <input
            className="box"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <div className="btn-row">
          <button
            disabled={busy}
            className="btn"
            onClick={() =>
              void perform(async () => {
                await step();
                const optionsJSON = await session.client.request<PublicKeyCredentialCreationOptionsJSON>(
                  '/api/auth/passkeys/options',
                  'POST',
                  {},
                );
                const response = await startRegistration({ optionsJSON });
                await session.client.request('/api/auth/passkeys/verify', 'POST', response);
                toast('Passkey registered', 'success');
              })
            }
          >
            Register a passkey
          </button>
          <button
            disabled={busy}
            className="btn"
            onClick={() =>
              void perform(async () => {
                if (await confirm.ask('Sign out every device, including this one?')) {
                  await step();
                  await session.client.request('/api/auth/logout-all', 'POST', {});
                  window.location.reload();
                }
              })
            }
          >
            Sign out everywhere
          </button>
        </div>
      </Panel>
      <Panel title="Encrypted cloud sync">
        <p role="status">
          {status.message} · Version {status.revision}
        </p>
        <button className="btn" onClick={() => void perform(() => session.flush())}>
          Sync now
        </button>
        {status.phase === 'conflict' && (
          <div className="btn-row">
            <button
              className="btn"
              onClick={() =>
                void perform(async () => {
                  if (
                    await confirm.ask(
                      'Use the cloud copy? This device’s copy is saved as an encrypted safety copy first.',
                    )
                  )
                    await session.useCloud();
                })
              }
            >
              Use cloud copy
            </button>
            <button
              className="btn"
              onClick={() =>
                void perform(async () => {
                  if (await confirm.ask('Make this device’s copy current? The other copy stays in history.'))
                    await session.keepLocal();
                })
              }
            >
              Keep device copy
            </button>
          </div>
        )}
        <ul className="issues">
          {versions.map((v) => (
            <li key={v.revision}>
              Version {v.revision} · {v.createdAt.slice(0, 10)}{' '}
              <button
                className="btn small"
                disabled={busy || v.revision === status.revision}
                onClick={() =>
                  void perform(async () => {
                    if (await confirm.ask(`Restore version ${v.revision} as a new cloud version?`))
                      await session.restoreVersion(v.revision);
                  })
                }
              >
                Restore
              </button>
              <button
                className="btn small"
                onClick={() =>
                  void perform(async () => {
                    await step();
                    await session.client.request('/api/sync/pin', 'POST', {
                      revision: v.revision,
                      pinned: !v.pinned,
                    });
                    setVersions(await session.client.request('/api/sync/versions'));
                  })
                }
              >
                {v.pinned ? 'Unpin' : 'Pin'}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Encrypted backup">
        <p>
          Use a separate passphrase of at least 15 characters. This backup is your recovery path if you forget
          your sign-in password. Keep it in your password manager.
        </p>
        <div className="grid-2">
          <Field label="Backup passphrase">
            <input
              className="box"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </Field>
          <Field label="Repeat backup passphrase">
            <input
              className="box"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </Field>
        </div>
        <div className="btn-row">
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                if (passphrase !== repeat) throw new Error('Backup passphrases do not match');
                const value = await encryptedBackup(
                  new TextEncoder().encode(JSON.stringify(createBackup(t.db))),
                  passphrase,
                );
                await saveFile(
                  `Treasury ${new Date().toISOString().slice(0, 10)}.ptbackup`,
                  value,
                  'application/json',
                );
                setPassphrase('');
                setRepeat('');
              })
            }
          >
            Export encrypted backup
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const file = await pickFile(['.ptbackup']);
                if (!file) return;
                const plain = await decryptBackup(new TextDecoder().decode(file.bytes), passphrase);
                const { backup } = readBackup(new TextDecoder().decode(plain));
                const db = buildDatabaseFromBackup(await loadSqlJs(), backup);
                if (
                  await confirm.ask(
                    'Restore this encrypted backup? A safety copy is saved first. Temporary review history is unchanged.',
                  )
                ) {
                  await t.adoptCloudSnapshot(db, true, t.db.export());
                  setPassphrase('');
                  setRepeat('');
                  toast('Backup restored locally. Sync to publish it.', 'success');
                }
              })
            }
          >
            Restore encrypted backup
          </button>
        </div>
      </Panel>
      <Panel title="Security activity">
        <ul className="issues">
          {events.map((event, i) => (
            <li key={i}>
              {new Date(event.time).toLocaleString()} · {event.type.replaceAll('_', ' ')}
            </li>
          ))}
        </ul>
      </Panel>
      {confirm.element}
    </>
  );
}
