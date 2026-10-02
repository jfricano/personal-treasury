import { useState } from 'react';
import {
  base64,
  random,
  validatePassword,
  userId,
  DEFAULT_KDF,
  derivePasswordKeys,
  wrapDataKey,
} from './crypto';
import { SecurityClient } from './client';
export function DesktopSetup({ origin, onClose }: { origin: string; onClose: () => void }) {
  const [secret, setSecret] = useState(''),
    [id, setId] = useState(''),
    [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState(''),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [enrollment, setEnrollment] = useState<{
      enrollment: string;
      totpSecret: string;
      recoveryCodes: string[];
    } | null>(null);
  return (
    <div className="cloud-gate">
      <div className="panel">
        <header>Set up private treasury</header>
        <div className="body">
          <p>
            Create your private sign-in. If this service contains v2.2 history, the desktop will guide you
            through migration after sign-in; existing history stays intact until verified.
          </p>
          <form
            className="v3-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const client = new SecurityClient(origin, secret);
                if (enrollment) {
                  await client.request('/api/setup/confirm', 'POST', {
                    enrollment: enrollment.enrollment,
                    code,
                  });
                  setPassword('');
                  setRepeat('');
                  setSecret('');
                  onClose();
                  return;
                }
                if (password !== repeat) throw new Error('Passwords do not match');
                const normalized = userId(id);
                await validatePassword(password, normalized);
                const salt = base64(random()),
                  keys = await derivePasswordKeys(password, salt, DEFAULT_KDF),
                  raw = random();
                const wrapped = await wrapDataKey(keys.wrapKey, raw, normalized, '1');
                raw.fill(0);
                const response = await client.request<typeof enrollment>('/api/setup/begin', 'POST', {
                  userId: normalized,
                  authKey: keys.authKey,
                  salt,
                  params: DEFAULT_KDF,
                  kid: '1',
                  wrapped,
                });
                setEnrollment(response);
                setPassword('');
                setRepeat('');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {!enrollment ? (
              <>
                {[
                  ['Setup secret', secret, setSecret],
                  ['User ID', id, setId],
                  ['New password', password, setPassword],
                  ['Repeat password', repeat, setRepeat],
                ].map(([label, value, setter]) => (
                  <label className="field" key={String(label)}>
                    <span>{String(label)}</span>
                    <input
                      className="box"
                      required
                      type={label === 'User ID' ? 'text' : 'password'}
                      autoComplete={label === 'User ID' ? 'username' : 'new-password'}
                      value={value as string}
                      onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                    />
                  </label>
                ))}
                <p>A forgotten password cannot be recovered. Keep a separately encrypted backup.</p>
                <button className="btn primary" disabled={busy}>
                  Create keys and enroll authenticator
                </button>
              </>
            ) : (
              <>
                <p>
                  Add this authenticator secret to your password manager: <code>{enrollment.totpSecret}</code>
                </p>
                <p>Save these one-use recovery codes offline:</p>
                <pre>{enrollment.recoveryCodes.join('\n')}</pre>
                <label className="field">
                  <span>Authenticator code</span>
                  <input
                    className="box"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <button className="btn primary" disabled={busy}>
                  Confirm enrollment
                </button>
              </>
            )}
            {error && (
              <p className="err" role="alert">
                {error}
              </p>
            )}
            <button className="btn" type="button" onClick={onClose}>
              Back to sign-in
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
