import { useState, type FormEvent } from 'react';
import { Field } from '@/components/ui';

export interface CloudCredentials {
  baseUrl?: string;
  token: string;
  passphrase: string;
  confirmation?: string;
}

export function CloudAccessForm({
  desktop,
  onConnect,
}: {
  desktop: boolean;
  onConnect: (credentials: CloudCredentials) => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState(() => {
    try {
      return localStorage.getItem('pt.sync.url') ?? '';
    } catch {
      return '';
    }
  });
  const [token, setToken] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConnect({
        ...(desktop ? { baseUrl: baseUrl.trim() } : {}),
        token: token.trim(),
        passphrase,
        confirmation,
      });
      if (desktop) {
        try {
          localStorage.setItem('pt.sync.url', baseUrl.trim());
        } catch {
          // Remembering the URL is a convenience; credentials remain in memory.
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to cloud storage.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="cloud-access">
      {desktop && (
        <Field label="Cloud service URL">
          <input
            className="box"
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://treasury.example.com"
            required
            autoComplete="url"
          />
        </Field>
      )}
      <Field label="Access token">
        <input
          className="box"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          required
          autoComplete="off"
        />
      </Field>
      <Field label="Sync passphrase">
        <input
          className="box"
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          required
          minLength={12}
          autoComplete="off"
        />
      </Field>
      <Field label="Repeat passphrase (first cloud upload)">
        <input
          className="box"
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
        />
      </Field>
      <p className="small subtle" style={{ margin: 0 }}>
        The access token and passphrase stay in memory for this app session. Keep both somewhere safe; cloud
        versions cannot be decrypted without the passphrase.
      </p>
      {error && (
        <p role="alert" className="err" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <button className="btn primary" disabled={busy}>
        {busy ? 'Connecting…' : 'Connect to cloud'}
      </button>
    </form>
  );
}
