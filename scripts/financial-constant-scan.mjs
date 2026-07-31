#!/usr/bin/env node
/** Catch a documented half-up money rule paired with an explicit bankers/even rounding mode. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root || !existsSync(root)) { process.stderr.write('financial-constant-scan: project root is missing\n'); process.exit(2); }
const prd = join(root, 'docs/10-prd.md');
if (!existsSync(prd)) { process.stderr.write('financial-constant-scan: docs/10-prd.md is missing\n'); process.exit(2); }
const rule = readFileSync(prd, 'utf8');
if (!/half[- ]up|round half up/i.test(rule)) {
  process.stdout.write('FINANCIAL CONSTANT SCAN: no explicit half-up rule found\n');
  process.exit(0);
}
function files(path, out = []) {
  const info = statSync(path);
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) if (!['.git', 'node_modules', 'Pods', 'dist'].includes(name)) files(join(path, name), out);
  } else if (/\.(swift|kt|java|ts|tsx|js)$/.test(path)) out.push(path);
  return out;
}
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
const findings = files(root).filter((path) => /bankers|toNearestOrEven|halfEven|HALF_EVEN/i.test(withoutComments(readFileSync(path, 'utf8'))));
if (!findings.length) {
  process.stdout.write('FINANCIAL CONSTANT SCAN: CLEAR — no explicit bankers rounding under a half-up rule\n');
  process.exit(0);
}
process.stdout.write(`FINANCIAL CONSTANT SCAN: ${findings.length} rounding mode mismatch(es)\n`);
for (const path of findings) process.stdout.write(`  ${path}\n`);
process.exit(1);
