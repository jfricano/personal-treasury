import { isTauri } from '@/db/storage';
/** Native webviews need explicit browser-style zoom shortcuts. */
export async function installDesktopZoom() {
  if (!isTauri()) return;
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const webview = getCurrentWebview();
  let zoom = 1;
  window.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || !['+', '=', '-', '0'].includes(event.key)) return;
    event.preventDefault();
    zoom =
      event.key === '0'
        ? 1
        : Math.max(0.5, Math.min(2, Math.round((zoom + (event.key === '-' ? -0.1 : 0.1)) * 10) / 10));
    void webview.setZoom(zoom).catch(() => undefined);
  });
}
