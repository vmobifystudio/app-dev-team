#!/usr/bin/env node
/** Catch the high-confidence StoreKit restore path that syncs but never rehydrates entitlements. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root || !existsSync(root)) { process.stderr.write('subscription-restore-scan: project root is missing\n'); process.exit(2); }
function files(path, out = []) {
  const info = statSync(path);
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (!['.git', 'node_modules', 'Pods', 'dist'].includes(name)) files(join(path, name), out);
    }
  }
  else if (path.endsWith('.swift')) out.push(path);
  return out;
}
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
const findings = [];
for (const path of files(root)) {
  const text = withoutComments(readFileSync(path, 'utf8'));
  const restore = /func\s+restorePurchases\s*\([^)]*\)[^{]*\{([\s\S]{0,2400})\}/g;
  for (const match of text.matchAll(restore)) {
    if (/AppStore\.sync\s*\(/.test(match[1]) && !/Transaction\.currentEntitlements/.test(match[1])) findings.push(path);
  }
}
if (!findings.length) {
  process.stdout.write('SUBSCRIPTION RESTORE SCAN: CLEAR — no sync-only restore path found\n');
  process.exit(0);
}
process.stdout.write(`SUBSCRIPTION RESTORE SCAN: ${findings.length} sync-only restore path(s)\n`);
for (const path of findings) process.stdout.write(`  ${path}\n`);
process.exit(1);
