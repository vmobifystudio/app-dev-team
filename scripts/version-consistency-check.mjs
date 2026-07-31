#!/usr/bin/env node
/** Compare a declared release version with common iOS/Android manifests. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const releases = join(root, 'docs/60-releases.md');
if (!existsSync(releases)) { console.log('VERSIONS: CLEAR — no release record is present for this project'); process.exit(0); }
const text = readFileSync(releases, 'utf8');
const declared = text.match(/(?:release\s+)?version\s*[:=]\s*v?([0-9]+\.[0-9]+\.[0-9]+)/i)?.[1];
if (!declared) { console.error('VERSIONS: CANNOT EVALUATE — docs/60-releases.md has no canonical version'); process.exit(2); }
const values = [];
const walk = (dir, depth = 0) => {
  if (depth > 4 || !existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (['.git', 'node_modules', 'Pods', 'build', 'dist'].includes(name)) continue;
    const path = join(dir, name);
    try {
      const body = readFileSync(path, 'utf8');
      if (/Info\.plist$/.test(name)) { const v = body.match(/CFBundleShortVersionString[^\n]*\n\s*<string>([^<]+)/)?.[1]; if (v) values.push([path, v]); }
      if (/build\.gradle(?:\.kts)?$/.test(name)) { const v = body.match(/versionName\s*[=:]\s*["']([^"']+)/)?.[1]; if (v) values.push([path, v]); }
    } catch { walk(path, depth + 1); }
  }
};
walk(root);
const mismatches = values.filter(([, value]) => value !== declared);
console.log(`VERSIONS: ${mismatches.length ? 'BLOCKED' : 'CLEAR'} — canonical ${declared}`);
for (const [path, value] of values) console.log(`  ${mismatches.some(([p]) => p === path) ? 'BLOCKER' : 'OK'}: ${path} = ${value}`);
if (mismatches.length) process.exit(1);
