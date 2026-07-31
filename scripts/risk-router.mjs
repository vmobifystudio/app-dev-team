#!/usr/bin/env node
/** Route work by blast radius, with explicit evidence and approval requirements. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`risk-router: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['policy', 'file', 'change']), die });
const path = resolve(String(flags.policy || 'docs/team/risk-policy.json'));
if (!existsSync(path)) die(2, `no risk policy at ${path}`);
let policy; try { policy = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die(2, e.message); }
if (policy.schema !== 'risk-policy/v1' || !Array.isArray(policy.rules)) die(2, 'policy must use schema risk-policy/v1 with rules');
const input = `${flags.file || ''} ${flags.change || ''}`.trim(); if (!input) die(2, '--file or --change is required');
const matched = policy.rules.filter((rule) => new RegExp(rule.pattern).test(input));
const rank = { low: 0, medium: 1, high: 2, critical: 3 };
const selected = matched.sort((a, b) => rank[b.risk] - rank[a.risk])[0] || policy.default;
if (!selected || !selected.model || !selected.risk) die(2, 'policy has no valid default or matching route');
console.log(JSON.stringify({ schema: 'risk-route/v1', input, risk: selected.risk, model: selected.model, approvals: selected.approvals || [], required_evidence: selected.required_evidence || [], matched_rules: matched.length }, null, 2));
