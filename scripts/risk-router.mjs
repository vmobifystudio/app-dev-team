#!/usr/bin/env node
/** Route work by blast radius, with explicit evidence and approval requirements. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { route } from './lib/risk.mjs';
const die = (code, message) => { process.stderr.write(`risk-router: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['policy', 'file', 'change']), die });
const path = resolve(String(flags.policy || 'docs/team/risk-policy.json'));
if (!existsSync(path)) die(2, `no risk policy at ${path}`);
let policy; try { policy = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die(2, e.message); }
if (policy.schema !== 'risk-policy/v1' || !Array.isArray(policy.rules)) die(2, 'policy must use schema risk-policy/v1 with rules');
const input = `${flags.file || ''} ${flags.change || ''}`.trim(); if (!input) die(1, '--file or --change is required');
const selected = route(policy, input);
if (!selected) die(2, 'policy has no valid default or matching route');
console.log(JSON.stringify({ schema: 'risk-route/v1', input, ...selected }, null, 2));
