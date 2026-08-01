#!/usr/bin/env node
/** Compare a declared release version with common iOS/Android manifests. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const releases = join(root, 'docs/60-releases.md');
if (!existsSync(releases)) { console.log('VERSIONS: CLEAR — no release record is present for this project'); process.exit(0); }
const text = readFileSync(releases, 'utf8');
// SHIP-P0-006 (external audit, 2026-08-01): this used to recognize ONLY `version: X.Y.Z` prose.
// `release-manager.md`'s own required release-note format is `## vX.Y.Z — YYYY-MM-DD` — a
// heading, never that prose — so a correctly-formatted release note never matched and this check
// silently never ran on the release format the role is actually told to write. Reproduced: a
// fixture with `## v1.2.3` and an iOS manifest at `9.9.9` returned CLEAR. The heading form is now
// recognized directly; the last one in the file wins, since releases are appended in order and the
// most recent entry is the one under test.
const headingMatches = [...text.matchAll(/^##\s+v([0-9]+\.[0-9]+\.[0-9]+)\b/gm)];
const declared = headingMatches.length
  ? headingMatches[headingMatches.length - 1][1]
  : text.match(/(?:release\s+)?version\s*[:=]\s*v?([0-9]+\.[0-9]+\.[0-9]+)/i)?.[1];
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
