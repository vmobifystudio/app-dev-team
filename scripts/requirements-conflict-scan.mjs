#!/usr/bin/env node
/** Detect a concrete numeric quota contradiction between PRD and architecture artifacts. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root || !existsSync(root)) { process.stderr.write('requirements-conflict-scan: project root is missing\n'); process.exit(2); }
const prdPath = join(root, 'docs/10-prd.md');
const archPath = join(root, 'docs/20-architecture.md');
if (!existsSync(prdPath) || !existsSync(archPath)) { process.stderr.write('requirements-conflict-scan: PRD or architecture artifact is missing\n'); process.exit(2); }
const prd = readFileSync(prdPath, 'utf8');
const architecture = readFileSync(archPath, 'utf8');
const prdQuota = /exports?\s+per\s+month[\s\S]{0,80}?\b([0-9]+)\b/i.exec(prd)?.[1];
const archQuota = /(?:FREE_TIER_MONTHLY_EXPORTS|quota)[^\n]{0,100}?\b([0-9]+)\b/i.exec(architecture)?.[1];
if (prdQuota && archQuota && prdQuota !== archQuota) {
  process.stdout.write(`REQUIREMENTS CONFLICT: PRD quota ${prdQuota} != architecture quota ${archQuota}\n`);
  process.exit(1);
}
process.stdout.write('REQUIREMENTS CONFLICT: CLEAR — no concrete quota contradiction found\n');
process.exit(0);
