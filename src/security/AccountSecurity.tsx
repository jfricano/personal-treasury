import { useEffect, useState } from 'react';
import { isTauri } from '@/db/storage';
import { useApp } from '@/app/context';
import { Field, Panel, useConfirm } from '@/components/ui';
import type { V3Session } from './client';
type Credential = { id: string; createdAt: string };
type SessionRow = { id: string; current: boolean; desktop: boolean; createdAt: string; lastActiveAt: string };
export function AccountSecurity({ session, verify }: { session: V3Session; verify: () => Promise<void> }) {
  const { toast } = useApp(),
    confirm = useConfirm();
  const [passkeys, setPasskeys] = useState<Credential[]>([]),
    [devices, setDevices] = useState<Credential[]>([]),
    [sessions, setSessions] = useState<SessionRow[]>([]),
    [codes, setCodes] = useState<string[]>([]),
    [enrollment, setEnrollment] = useState(''),
    [authenticatorCode, setAuthenticatorCode] = useState(''),
    [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [repeat, setRepeat] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    const [keys, devices, sessions] = await Promise.all([
      session.client.request<Credential[]>('/api/auth/passkeys'),
      session.client.request<Credential[]>('/api/auth/devices'),
      session.client.request<SessionRow[]>('/api/auth/sessions'),
    ]);
    setPasskeys(keys);
    setDevices(devices);
    setSessions(sessions);
  };
  useEffect(() => {
    void refresh().catch((e) => toast((e as Error).message, 'error')); // Credentials are fetched when the signed-in session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      setCurrent('');
      setNext('');
      setRepeat('');
    }
  };
  const revoke = (kind: 'passkeys' | 'devices' | 'sessions', id: string) =>
    void perform(async () => {
      if (
        !(await confirm.ask(
          `Revoke this ${kind === 'passkeys' ? 'passkey' : kind === 'devices' ? 'desktop device' : 'session'}? Associated sessions will need a new sign-in.`,
        ))
      )
        return;
      await verify();
      await session.client.request(`/api/auth/${kind}/revoke`, 'POST', { id });
      await refresh();
      toast('Access revoked', 'success');
    });
  return (
    <>
      <Panel title="Passkeys and devices">
        <p>
          Removing a credential ends sessions that used it. An authenticator code or another registered
          credential is needed to sign in again.
        </p>
        <h3>Passkeys</h3>
        <ul className="issues">
          {passkeys.length ? (
            passkeys.map((key, i) => (
              <li key={key.id}>
                Passkey {i + 1} · registered {new Date(key.createdAt).toLocaleDateString()}{' '}
                <button className="btn small" disabled={busy} onClick={() => revoke('passkeys', key.id)}>
                  Remove passkey {i + 1}
                </button>
              </li>
            ))
          ) : (
            <li>No passkeys registered yet.</li>
          )}
        </ul>
        <h3>Desktop devices</h3>
        <ul className="issues">
          {devices.length ? (
            devices.map((device, i) => (
              <li key={device.id}>
                Desktop {i + 1} · registered {new Date(device.createdAt).toLocaleDateString()}{' '}
                <button className="btn small" disabled={busy} onClick={() => revoke('devices', device.id)}>
                  Revoke desktop {i + 1}
                </button>
              </li>
            ))
          ) : (
            <li>No desktop devices registered yet.</li>
          )}
        </ul>
        <h3>Active sessions</h3>
        <ul className="issues">
          {sessions.map((s, i) => (
            <li key={s.id}>
              {s.desktop ? 'Desktop' : 'Browser'} session {i + 1} {s.current ? '· this session' : ''} · last
              used {new Date(s.lastActiveAt).toLocaleString()}
              {!s.current && (
                <button className="btn small" disabled={busy} onClick={() => revoke('sessions', s.id)}>
                  End session {i + 1}
                </button>
              )}
            </li>
          ))}
        </ul>
        <button className="btn" disabled={busy} onClick={() => void perform(refresh)}>
          Refresh access list
        </button>
      </Panel>
      <Panel title="Recovery codes">
        <p>
          Generate ten new one-use codes. This immediately invalidates all previous recovery codes. Save the
          new codes somewhere safe; they appear only once.
        </p>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              if (!(await confirm.ask('Replace every recovery code? Your existing codes will stop working.')))
                return;
              await verify();
              const value = await session.client.request<{ codes: string[] }>(
                '/api/auth/recovery/regenerate',
                'POST',
                {},
              );
              setCodes(value.codes);
            })
          }
        >
          Generate new recovery codes
        </button>
        {codes.length > 0 && (
          <div role="region" aria-label="New recovery codes">
            <pre>{codes.join('\n')}</pre>
            <button className="btn" onClick={() => setCodes([])}>
              I saved these codes
            </button>
          </div>
        )}
      </Panel>
      <Panel title="Replace authenticator">
        <p>
          Add the new secret to your authenticator, then enter its code. Your existing authenticator continues
          working until you confirm the replacement. Confirmation ends other signed-in sessions.
        </p>
        {!enrollment ? (
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await verify();
                const value = await session.client.request<{ secret: string }>(
                  '/api/auth/authenticator/begin',
                  'POST',
                  {},
                );
                setEnrollment(value.secret);
              })
            }
          >
            Set up a new authenticator
          </button>
        ) : (
          <form
            className="v3-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await verify();
                await session.client.request('/api/auth/authenticator/confirm', 'POST', {
                  code: authenticatorCode,
                });
                setEnrollment('');
                setAuthenticatorCode('');
                await refresh();
                toast('Authenticator replaced', 'success');
              });
            }}
          >
            <p>
              Authenticator secret: <code>{enrollment}</code>
            </p>
            <Field label="New authenticator code">
              <input
                className="box"
                required
                autoComplete="one-time-code"
                value={authenticatorCode}
                onChange={(e) => setAuthenticatorCode(e.target.value)}
              />
            </Field>
            <div className="btn-row">
              <button className="btn primary" disabled={busy}>
                Confirm new authenticator
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setEnrollment('');
                  setAuthenticatorCode('');
                }}
              >
                Cancel replacement
              </button>
            </div>
          </form>
        )}
      </Panel>
      <Panel title="Change sign-in password">
        {isTauri() ? (
          <form
            className="v3-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                if (next !== repeat) throw new Error('New passwords do not match');
                await session.changePassword(current, next);
                await refresh();
                toast('Password changed. Other devices must sign in again.', 'success');
              });
            }}
          >
            <p>
              Your treasury and its encrypted history keep the same data key. Use the new password at your
              next unlock.
            </p>
            {[
              ['Current password', current, setCurrent],
              ['New sign-in password', next, setNext],
              ['Repeat new sign-in password', repeat, setRepeat],
            ].map(([label, value, setter]) => (
              <Field label={String(label)} key={String(label)}>
                <input
                  className="box"
                  required
                  type="password"
                  autoComplete={label === 'Current password' ? 'current-password' : 'new-password'}
                  value={value as string}
                  onChange={(e) => (setter as (value: string) => void)(e.target.value)}
                />
              </Field>
            ))}
            <button className="btn primary" disabled={busy}>
              Change password
            </button>
          </form>
        ) : (
          <p>Change your sign-in password in the desktop app.</p>
        )}
      </Panel>
      {confirm.element}
    </>
  );
}
