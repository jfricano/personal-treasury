import type { CloudCredentials } from './CloudAccessForm';

const KEY = 'pt.private.session.v1';
export const PRIVATE_IDLE_MS = 30 * 60 * 1000;

interface SavedSession {
  token: string;
  passphrase: string;
  lastActivityAt: number;
}

export function forgetPrivateSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage may be disabled. The in-memory session can still be closed.
  }
}

export function readPrivateSession(now = Date.now()): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (
      typeof saved === 'object' &&
      saved !== null &&
      'token' in saved &&
      typeof saved.token === 'string' &&
      saved.token.length > 0 &&
      'passphrase' in saved &&
      typeof saved.passphrase === 'string' &&
      saved.passphrase.length >= 12 &&
      'lastActivityAt' in saved &&
      typeof saved.lastActivityAt === 'number' &&
      Number.isFinite(saved.lastActivityAt) &&
      saved.lastActivityAt <= now &&
      now - saved.lastActivityAt < PRIVATE_IDLE_MS
    )
      return saved as SavedSession;
  } catch {
    // Treat unavailable or malformed browser storage as signed out.
  }
  forgetPrivateSession();
  return null;
}

export function rememberPrivateSession(credentials: CloudCredentials, now = Date.now()): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ token: credentials.token, passphrase: credentials.passphrase, lastActivityAt: now }),
    );
  } catch {
    // A browser that blocks session storage simply asks again after a reload.
  }
}
