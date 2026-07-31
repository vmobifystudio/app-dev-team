#!/usr/bin/env node
/** Ensure every P0 feature in the PRD is represented in the analytics contract. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root || !existsSync(root)) { process.stderr.write('analytics-coverage-scan: project root is missing\n'); process.exit(2); }
const prdPath = join(root, 'docs/10-prd.md');
const analyticsPath = join(root, 'docs/52-analytics.md');
if (!existsSync(prdPath) || !existsSync(analyticsPath)) { process.stderr.write('analytics-coverage-scan: PRD or analytics contract is missing\n'); process.exit(2); }
const prd = readFileSync(prdPath, 'utf8');
const analytics = readFileSync(analyticsPath, 'utf8');
const p0 = [...prd.matchAll(/^\|\s*(F-\d+)\s*\|[^|]+\|\s*P0\s*\|/gmi)].map((match) => match[1]);
const missing = p0.filter((id) => !new RegExp(`\\b${id}\\b`).test(analytics));
if (!missing.length) {
  process.stdout.write(`ANALYTICS COVERAGE: CLEAR — all ${p0.length} P0 feature(s) are represented\n`);
  process.exit(0);
}
process.stdout.write(`ANALYTICS COVERAGE: ${missing.length} P0 feature(s) have no event\n`);
for (const id of missing) process.stdout.write(`  ${id}\n`);
process.exit(1);
