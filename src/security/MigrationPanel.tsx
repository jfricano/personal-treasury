import { useState } from 'react';
import { SecurityClient, SecurityError } from './client';
import { migrateLegacy } from './migration';
export function MigrationPanel({
  client,
  dataKey,
  onComplete,
  onSignInAgain,
}: {
  client: SecurityClient;
  dataKey: CryptoKey;
  onComplete: () => void;
  onSignInAgain: () => void;
}) {
  const [token, setToken] = useState(''),
    [passphrase, setPassphrase] = useState(''),
    [backup, setBackup] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [needsSignIn, setNeedsSignIn] = useState(false);
  return (
    <div className="cloud-gate">
      <div className="panel">
        <header>Upgrade your v2.2 history</header>
        <div className="body">
          <p>
            Take a JSON backup before starting. Each cloud version is decrypted here, re-encrypted, uploaded
            and read back for verification. Old files remain until you explicitly delete them after checking
            your treasury. This is a one-time upgrade; normal v3 sign-in does not use the old token or
            passphrase.
          </p>
          <form
            className="v3-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await migrateLegacy(client, dataKey, token, passphrase, setMessage);
                setToken('');
                setPassphrase('');
                onComplete();
              } catch (e) {
                if (e instanceof SecurityError && e.code === 'step_up_required') {
                  setNeedsSignIn(true);
                  setMessage(
                    'Your sign-in verification expired. Sign in again, then retry the upgrade. Existing history and verified migration progress are preserved.',
                  );
                } else setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>Legacy access token</span>
              <input
                className="box"
                type="password"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Legacy sync passphrase</span>
              <input
                className="box"
                type="password"
                required
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
            <label>
              <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} /> I have
              saved a separate backup.
            </label>
            <button className="btn primary" disabled={busy || !backup || needsSignIn}>
              Migrate and verify history
            </button>
            <p role={needsSignIn ? 'alert' : 'status'}>{message}</p>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                setToken('');
                setPassphrase('');
                onSignInAgain();
              }}
            >
              Sign in again
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
