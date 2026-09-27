import { useEffect, useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { isTauri, defaultStorage } from '@/db/storage';
import { MigrationPanel } from './MigrationPanel';
import { DesktopSetup } from './DesktopSetup';
import { readDeviceKey, saveDeviceKey } from './device';
import { Treasury } from '@/api/treasury';
import { IndexedDbStorage } from '@/db/storage';
import { App } from '@/app/App';
import { SecurityClient, V3Session } from './client';
import {
  derivePasswordKeys,
  unwrapDataKey,
  userId,
  base64,
  unbase64,
  type KdfParameters,
  type Sealed,
} from './crypto';
import { EncryptedStorage } from './storage';
import { registerReviewBackend } from '@/features/spending/useReviewStore';
export function PrivateBoot({ wasmUrl }: { wasmUrl: string }) {
  const desktop = isTauri();
  const [migration, setMigration] = useState<CryptoKey | null>(null);
  const [setup, setSetup] = useState(false);
  const pending = useRef<string | undefined>(undefined);
  const [id, setId] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [stage, setStage] = useState<'password' | 'factor' | 'unlock'>('password'),
    [method, setMethod] = useState('totp'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [opened, setOpened] = useState<{ treasury: Treasury; session: V3Session } | null>(null);
  const wrap = useRef<CryptoKey | null>(null),
    [client] = useState(() => new SecurityClient(desktop ? import.meta.env.PT_SERVICE_ORIGIN : undefined));
  useEffect(() => {
    void client
      .request<{ userId: string }>('/api/auth/session')
      .then((s) => {
        setId(s.userId);
        setStage('unlock');
      })
      .catch(() => undefined);
  }, [client]);
  const enter = async (response: { wrapped: Sealed; kid: string; userId: string; token?: string }) => {
    if (!wrap.current) throw new Error('Enter your password again.');
    if (response.token) client.setToken(response.token);
    const key = await unwrapDataKey(wrap.current, response.wrapped, response.userId, response.kid);
    wrap.current = null;
    if (desktop) {
      const migration = await client.request<{ required: boolean }>('/api/migration/status');
      if (migration.required) {
        setMigration(key);
        return;
      }
    }
    const storage = new EncryptedStorage(
      desktop ? defaultStorage() : new IndexedDbStorage(),
      key,
      `v3:${response.userId}`,
    );
    const treasury = await Treasury.open({ storage, profile: 'default', locateWasm: () => wasmUrl });
    const session = new V3Session(client, key, response.userId, response.kid);
    await session.start(treasury);
    registerReviewBackend(treasury, session.reviewBackend(treasury.profile));
    if (desktop && !(await readDeviceKey(client.baseUrl))) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
        'sign',
        'verify',
      ]);
      const publicKey = base64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
      const { id } = await client.request<{ id: string }>('/api/auth/devices', 'POST', { publicKey });
      await saveDeviceKey(client.baseUrl, { id, privateKey: pair.privateKey, publicKey });
    }
    setOpened({ treasury, session });
    setPassword('');
    setCode('');
    setError('');
  };
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    await client.request('/api/auth/logout', 'POST', {});
    opened?.session.close();
    setOpened(null);
    wrap.current = null;
    setStage('password');
    setPassword('');
  };
  const lock = async () => {
    opened?.session.close();
    setOpened(null);
    wrap.current = null;
    setStage('unlock');
    setPassword('');
    await client.request('/api/auth/lock', 'POST', {}).catch(() => undefined);
  };
  useEffect(() => {
    if (!opened) return;
    let active = Date.now();
    const activity = () => {
      if (Date.now() - active >= 15 * 60000) {
        void lock();
        return;
      }
      active = Date.now();
    };
    const interval = setInterval(() => {
      if (Date.now() - active >= 15 * 60000) void lock();
    }, 5000);
    for (const event of ['keydown', 'pointerdown', 'touchstart'])
      window.addEventListener(event, activity, true);
    return () => {
      clearInterval(interval);
      for (const event of ['keydown', 'pointerdown', 'touchstart'])
        window.removeEventListener(event, activity, true);
    };
    // Replace the activity listeners only when a new unlocked session opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);
  useEffect(() => {
    if (!desktop || !opened) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen('pt-lock', () => void lock()))
      .then((fn) => {
        if (cancelled) fn();
        else dispose = fn;
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
    // Native lock listeners follow the unlocked session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, opened]);
  if (migration)
    return (
      <MigrationPanel
        client={client}
        dataKey={migration}
        onComplete={() => {
          setMigration(null);
          setStage('unlock');
        }}
      />
    );
  if (setup) return <DesktopSetup origin={client.baseUrl} onClose={() => setSetup(false)} />;
  if (opened)
    return (
      <App
        treasury={opened.treasury}
        switchProfile={() => {
          throw new Error('The private app has one signed-in profile.');
        }}
        onLogout={() => void perform(signOut)}
        extras={{ security: opened.session, onLock: () => void lock() }}
      />
    );
  return (
    <div className="cloud-gate">
      <div className="panel">
        <header>Personal Treasury · Private</header>
        <div className="body">
          <h1>
            {stage === 'unlock' ? 'Unlock your treasury' : stage === 'factor' ? 'Verify it’s you' : 'Sign in'}
          </h1>
          <p>Your password unlocks your encrypted treasury on this device.</p>
          <form
            className="v3-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                if (stage === 'factor') {
                  await enter(
                    await client.request('/api/auth/factor', 'POST', {
                      method,
                      code,
                      pending: pending.current,
                    }),
                  );
                  return;
                }
                const normalized = userId(id);
                const pre = await client.request<{ salt: string; params: KdfParameters }>(
                  '/api/auth/prelogin',
                  'POST',
                  { userId: normalized },
                );
                const keys = await derivePasswordKeys(password, pre.salt, pre.params);
                wrap.current = keys.wrapKey;
                setPassword('');
                if (stage === 'unlock') {
                  await enter(
                    await client.request('/api/auth/unlock', 'POST', {
                      userId: normalized,
                      authKey: keys.authKey,
                    }),
                  );
                } else {
                  const result = await client.request<{ methods: string[]; pending?: string }>(
                    '/api/auth/login',
                    'POST',
                    { userId: normalized, authKey: keys.authKey, client: desktop ? 'desktop' : 'web' },
                  );
                  pending.current = result.pending;
                  const device = desktop ? await readDeviceKey(client.baseUrl) : undefined;
                  if (device) {
                    const challenge = await client.request<{ challenge: string }>(
                      '/api/auth/factor/device',
                      'POST',
                      { pending: pending.current },
                    );
                    const signature = base64(
                      new Uint8Array(
                        await crypto.subtle.sign(
                          { name: 'ECDSA', hash: 'SHA-256' },
                          device.privateKey,
                          new Uint8Array(unbase64(challenge.challenge)),
                        ),
                      ),
                    );
                    await enter(
                      await client.request('/api/auth/factor', 'POST', {
                        pending: pending.current,
                        method: 'device',
                        deviceId: device.id,
                        signature,
                      }),
                    );
                    return;
                  }
                  setMethod(result.methods.includes('passkey') ? 'passkey' : 'totp');
                  setStage('factor');
                }
              });
            }}
          >
            {stage !== 'factor' ? (
              <>
                <label className="field">
                  <span>User ID</span>
                  <input
                    className="box"
                    required
                    autoComplete="username"
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input
                    className="box"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button className="btn primary" disabled={busy}>
                  {busy ? 'Unlocking…' : stage === 'unlock' ? 'Unlock' : 'Continue'}
                </button>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Second factor</span>
                  <select className="box" value={method} onChange={(e) => setMethod(e.target.value)}>
                    {!desktop && <option value="passkey">Passkey</option>}
                    <option value="totp">Authenticator code</option>
                    <option value="recovery">Recovery code</option>
                  </select>
                </label>
                {method === 'passkey' ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const optionsJSON = await client.request<PublicKeyCredentialRequestOptionsJSON>(
                          '/api/auth/factor/options',
                          'POST',
                          {},
                        );
                        const assertion = await startAuthentication({ optionsJSON });
                        await enter(
                          await client.request('/api/auth/factor', 'POST', { method: 'passkey', assertion }),
                        );
                      })
                    }
                  >
                    Use passkey
                  </button>
                ) : (
                  <>
                    <label className="field">
                      <span>{method === 'totp' ? 'Authenticator code' : 'Recovery code'}</span>
                      <input
                        className="box"
                        required
                        autoComplete="one-time-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                      />
                    </label>
                    <button className="btn primary" disabled={busy}>
                      Verify and sign in
                    </button>
                  </>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="err">
                {error}
              </p>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                wrap.current = null;
                setStage('password');
                setPassword('');
                setCode('');
              }}
            >
              Start sign-in again
            </button>
          </form>
          {desktop && (
            <button className="btn" onClick={() => setSetup(true)}>
              Set up a new private service
            </button>
          )}
          <p className="subtle">
            Setup and migration are completed from the desktop. A forgotten password requires your separately
            encrypted backup.
          </p>
        </div>
      </div>
    </div>
  );
}
