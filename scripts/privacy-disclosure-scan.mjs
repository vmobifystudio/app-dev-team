#!/usr/bin/env node
/** Reconcile the strongest store privacy claim with obvious outbound identity fields. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root || !existsSync(root)) { process.stderr.write('privacy-disclosure-scan: project root is missing\n'); process.exit(2); }
const declaration = join(root, 'docs/15-aso.md');
if (!existsSync(declaration)) { process.stderr.write('privacy-disclosure-scan: docs/15-aso.md is missing\n'); process.exit(2); }
const aso = readFileSync(declaration, 'utf8');
if (!/Data Not Collected/i.test(aso)) {
  process.stdout.write('PRIVACY DISCLOSURE SCAN: no blanket Data Not Collected claim found\n');
  process.exit(0);
}

function files(path, out = []) {
  const info = statSync(path);
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) if (!['.git', 'node_modules', 'Pods', 'dist'].includes(name)) files(join(path, name), out);
  } else if (/\.(swift|m|mm|kt|java|ts|tsx|js)$/.test(path)) out.push(path);
  return out;
}
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');

const findings = [];
for (const path of files(root)) {
  const text = withoutComments(readFileSync(path, 'utf8'));
  if (/(URLSession|OkHttp|dataTask|httpBody|fetch\s*\(|axios\.)/.test(text) && /(userEmail|email|identifierForVendor|idfv|device.?id|advertisingIdentifier)/i.test(text)) {
    findings.push(path);
  }
}
if (!findings.length) {
  process.stdout.write('PRIVACY DISCLOSURE SCAN: CLEAR — no obvious outbound identity field under a blanket declaration\n');
  process.exit(0);
}
process.stdout.write(`PRIVACY DISCLOSURE SCAN: ${findings.length} possible mismatch(es)\n`);
for (const path of findings) process.stdout.write(`  ${path}\n`);
process.exit(1);
