#!/usr/bin/env node
// Fails if any file that git would publish contains a term from reference/privacy-terms.txt.
// The terms file is personal and gitignored, so this check runs on the owner's machine only
// (for example before a push); on a clone without it, it reports that and exits cleanly.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const TERMS = 'reference/privacy-terms.txt';
if (!existsSync(TERMS)) {
  console.log(`privacy:check skipped: ${TERMS} not found (it is personal and never committed).`);
  process.exit(0);
}

const terms = readFileSync(TERMS, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const m = /^\/(.*)\/([a-z]*)$/.exec(l);
    if (!m) throw new Error(`Not a /regex/flags line in ${TERMS}: ${l}`);
    return new RegExp(m[1], m[2]);
  });

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
const files = [...new Set([...git('ls-files'), ...git('ls-files', '--others', '--exclude-standard')])].filter(
  (f) => existsSync(f) && !/(^|\/)(package-lock\.json|Cargo\.lock)$|\.(png|ico|icns|wasm|xlsx)$/.test(f),
);

let hits = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('\u0000')) continue;
  text.split('\n').forEach((line, i) => {
    for (const re of terms) {
      if (re.test(line)) {
        hits++;
        console.log(`${file}:${i + 1}: ${re} → ${line.trim().slice(0, 140)}`);
      }
    }
  });
}
if (hits) {
  console.error(`\nprivacy:check found ${hits} match(es) in ${files.length} publishable files.`);
  process.exit(1);
}
console.log(`privacy:check passed: ${files.length} publishable files, ${terms.length} terms.`);
