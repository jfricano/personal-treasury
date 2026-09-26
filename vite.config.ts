import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * The public demo (`--mode demo`) is a static site: relative asset paths so it
 * works under any sub-path (GitHub Pages), no source maps, and a stricter
 * content security policy without the desktop shell's IPC endpoints.
 */
const demoHtml = (): Plugin => ({
  name: 'demo-html',
  apply: 'build',
  transformIndexHtml: (html) =>
    html
      .replace(
        /connect-src [^"]*/,
        "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'",
      )
      .replace(
        '<title>Personal Treasury</title>',
        '<title>Personal Treasury · Demo</title>\n    <meta name="description" content="Try Personal Treasury with sample data. Runs entirely in your browser." />',
      ),
});

const privateHtml = (): Plugin => ({
  name: 'private-html',
  apply: 'build',
  transformIndexHtml: (html) =>
    html
      .replace(
        /connect-src [^"]*/,
        "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
      )
      .replace('<title>Personal Treasury</title>', '<title>Personal Treasury · Private</title>'),
});

// Tauri expects a fixed port and no clearing of the screen during `tauri dev`.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  const privateWeb = mode === 'private';
  return {
    plugins: [react(), ...(demo ? [demoHtml()] : []), ...(privateWeb ? [privateHtml()] : [])],
    base: demo ? './' : '/',
    clearScreen: false,
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 1420,
      strictPort: true,
      ...(privateWeb ? { proxy: { '/api/sync': 'http://127.0.0.1:8787' } } : {}),
    },
    preview: demo ? { port: 4174, strictPort: true } : undefined,
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    build: {
      target: 'safari15',
      outDir: demo ? 'dist-demo' : privateWeb ? 'dist-private' : 'dist',
      sourcemap: !demo && !privateWeb,
      chunkSizeWarningLimit: 1600,
    },
    test: {
      // tests/local holds checks against personal reference workbooks; it is gitignored and absent in CI.
      include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/local/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30000,
    },
  };
});
