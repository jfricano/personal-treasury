import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('This installer targets Apple Silicon Macs. Build it on an Apple Silicon Mac.');
if (process.argv.slice(2).some((arg) => arg !== '--existing-build'))
  throw new Error(
    'Use no arguments to build the app, or --existing-build to package a verified existing build.',
  );
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const connected = Boolean(process.env.PT_SERVICE_ORIGIN);
const variant = connected ? 'Connected' : 'Local';
const name = `Personal Treasury ${variant}`;
const identifier = connected ? 'com.personaltreasury.app' : 'com.personaltreasury.app.local';
const target = process.env.CARGO_TARGET_DIR
  ? resolve(root, process.env.CARGO_TARGET_DIR)
  : join(root, 'src-tauri/target');
const app = join(target, 'release/bundle/macos', `${name}.app`);
const run = (tool, args) => execFileSync(tool, args, { cwd: root, stdio: 'inherit' });
if (!process.argv.includes('--existing-build'))
  run(process.execPath, [
    join(root, 'scripts/desktop.mjs'),
    'build',
    '--config',
    '{"bundle":{"targets":["app"]}}',
  ]);
const plist = join(app, 'Contents/Info.plist');
for (const [key, expected] of [
  ['CFBundleIdentifier', identifier],
  ['CFBundleName', name],
  ['CFBundleShortVersionString', config.version],
]) {
  const actual = execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], {
    encoding: 'utf8',
  }).trim();
  if (actual !== expected) throw new Error(`Existing app has an unexpected ${key}; rebuild it first.`);
}
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const outputDir = join(target, 'release/bundle/pkg');
mkdirSync(outputDir, { recursive: true });
const output = join(outputDir, `Personal-Treasury_${config.version}_Apple-Silicon_${variant}.pkg`);
const work = mkdtempSync(join(tmpdir(), 'personal-treasury-installer-'));
try {
  const payload = join(work, 'root');
  mkdirSync(join(payload, 'Applications'), { recursive: true });
  run('/usr/bin/ditto', [app, join(payload, 'Applications', `${name}.app`)]);
  const components = join(work, 'components.plist');
  run('/usr/bin/pkgbuild', ['--analyze', '--root', payload, components]);
  // Always install at /Applications; never follow a matching build into a development folder.
  const componentInfo = JSON.parse(
    execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', components], {
      encoding: 'utf8',
    }),
  );
  if (componentInfo.length !== 1 || componentInfo[0].RootRelativeBundlePath !== `Applications/${name}.app`)
    throw new Error('The installer payload must contain exactly the expected app bundle.');
  Object.assign(componentInfo[0], {
    BundleIsRelocatable: false,
    BundleHasStrictIdentifier: true,
    BundleIsVersionChecked: true,
    BundleOverwriteAction: 'upgrade',
  });
  writeFileSync(components, JSON.stringify(componentInfo));
  run('/usr/bin/plutil', ['-convert', 'xml1', components]);
  const component = join(work, 'application.pkg');
  run('/usr/bin/pkgbuild', [
    '--root',
    payload,
    '--component-plist',
    components,
    '--identifier',
    `${identifier}.installer`,
    '--version',
    config.version.split('-')[0],
    '--install-location',
    '/',
    component,
  ]);
  const requirements = join(work, 'requirements.plist');
  writeFileSync(
    requirements,
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>arch</key><array><string>arm64</string></array>
<key>os</key><array><string>${config.bundle.macOS.minimumSystemVersion}</string></array>
<key>home</key><false/>
</dict></plist>`,
  );
  const distribution = join(work, 'Distribution.xml');
  run('/usr/bin/productbuild', [
    '--synthesize',
    '--product',
    requirements,
    '--package',
    component,
    distribution,
  ]);
  const resources = join(work, 'resources');
  mkdirSync(resources);
  writeFileSync(
    join(resources, 'ReadMe.html'),
    `<!doctype html><html><body>
<h1>${name}</h1>
<p>This installer places ${name}.app in Applications. Open it from Applications when installation finishes.</p>
<p>${connected ? 'Connected syncs with its configured private website.' : 'Local works offline and saves its treasury only on this Mac.'}</p>
<p>Your treasury records are stored separately from the app and are not included in or replaced by this installer.</p>
<p>This is a preview for Apple Silicon Macs running macOS ${config.bundle.macOS.minimumSystemVersion} or later. The installer is unsigned and the app is not Apple-notarized; macOS may ask you to explicitly allow them. Back up existing records before preview use.</p>
</body></html>`,
  );
  writeFileSync(
    distribution,
    readFileSync(distribution, 'utf8').replace(
      /(<installer-gui-script[^>]*>)/,
      `$1\n<title>${name}</title>\n<readme file="ReadMe.html" mime-type="text/html"/>`,
    ),
  );
  run('/usr/bin/productbuild', [
    '--distribution',
    distribution,
    '--resources',
    resources,
    '--package-path',
    work,
    output,
  ]);
  console.log(`Installer ready: ${output}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
