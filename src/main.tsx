import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Treasury } from '@/api/treasury';
import { defaultStorage } from '@/db/storage';
import { App } from '@/app/App';
import type { AppExtras } from '@/app/context';
import '@/app/styles.css';

const PROFILE_KEY = 'pt.profile';

function currentProfile(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('profile');
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(PROFILE_KEY) || 'default';
  } catch {
    return 'default';
  }
}

function switchProfile(name: string) {
  try {
    localStorage.setItem(PROFILE_KEY, name);
  } catch {
    /* profile choice is a convenience only */
  }
  // A hash-only change would not reload, so rewrite the URL and reload explicitly.
  const url = new URL(window.location.href);
  url.searchParams.delete('profile');
  url.hash = '#/dashboard';
  window.history.replaceState(null, '', url.toString());
  window.location.reload();
}

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  try {
    let treasury: Treasury;
    let extras: AppExtras | undefined;
    // The public demo build (`vite build --mode demo`); this branch is removed from every other build.
    if (import.meta.env.MODE === 'demo') {
      const { openDemo } = await import('@/demo/boot');
      ({ treasury, extras } = await openDemo(wasmUrl));
    } else {
      treasury = await Treasury.open({
        storage: defaultStorage(),
        profile: currentProfile(),
        locateWasm: () => wasmUrl,
      });
    }
    if (import.meta.env.DEV) {
      // Development-only hook for debugging and automated tests; stripped from production builds.
      const { analyzeWorkbook } = await import('@/import/analyze');
      (window as unknown as Record<string, unknown>).__PT__ = { treasury, analyzeWorkbook };
    }
    window.addEventListener('beforeunload', (e) => {
      if (treasury.saveState === 'saving') e.preventDefault();
    });
    root.render(
      <StrictMode>
        <App treasury={treasury} switchProfile={switchProfile} extras={extras} />
      </StrictMode>,
    );
  } catch (err) {
    root.render(
      <div className="empty">
        <h3>The database could not be opened</h3>
        <p>{(err as Error).message}</p>
        <p className="subtle">
          Your data has not been changed. Restore a backup from another profile or contact support.
        </p>
      </div>,
    );
  }
}

void boot();
