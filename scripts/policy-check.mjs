#!/usr/bin/env node
/** Evaluate the project's explicit policy contract without pretending network/legal review is local. */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const file = join(root, '.studio-policy.json');
if (!existsSync(file)) { console.error('POLICY: CANNOT EVALUATE — .studio-policy.json is missing'); process.exit(2); }
let policy;
try { policy = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { console.error(`POLICY: CANNOT EVALUATE — invalid .studio-policy.json (${error.message})`); process.exit(2); }
const blockers = [];
for (const required of policy.requiredFiles || []) if (!existsSync(join(root, required))) blockers.push(`required file missing: ${required}`);
for (const artifact of policy.requiredArtifacts || []) if (!existsSync(join(root, artifact))) blockers.push(`required evidence missing: ${artifact}`);
if (!policy.owner || !policy.reviewedOn) blockers.push('policy must name owner and reviewedOn');
console.log(`POLICY: ${blockers.length ? 'BLOCKED' : 'CLEAR'} — owner ${policy.owner || '(missing)'}`);
for (const item of blockers) console.log(`  BLOCKER: ${item}`);
if (blockers.length) process.exit(1);
