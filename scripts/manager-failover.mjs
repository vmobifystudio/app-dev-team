#!/usr/bin/env node
/** Decide whether a durable manager lease permits continuation or requires failover. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`manager-failover: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['ledger', 'run', 'manager', 'backup', 'now']), die });
const path = resolve(String(flags.ledger || 'docs/team/runs.jsonl')); if (!existsSync(path)) die(2, `no run ledger at ${path}`);
let lines; try { lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch (e) { die(2, `cannot parse run ledger: ${e.message}`); }
const run = flags.run; const manager = flags.manager || 'tech-manager'; const backup = flags.backup || 'tech-lead'; if (!run) die(2, '--run is required');
const attempts = new Map(); for (const record of lines) { if (record.run_id !== run || record.role !== manager) continue; const state = attempts.get(record.attempt_id) || { terminal: false }; Object.assign(state, record); if (['complete', 'interrupt', 'abandon'].includes(record.event)) state.terminal = true; attempts.set(record.attempt_id, state); }
const active = [...attempts.values()].filter((attempt) => !attempt.terminal); const now = new Date(String(flags.now || new Date().toISOString())); if (Number.isNaN(now.getTime())) die(2, '--now must be an ISO timestamp');
if (active.length > 1) { console.error(`manager-failover: BLOCK — multiple active ${manager} attempts`); process.exit(1); }
if (active.length === 1 && active[0].lease_until && new Date(active[0].lease_until) > now) { console.log(JSON.stringify({ decision: 'HOLD', run, manager, attempt: active[0].attempt_id, lease_until: active[0].lease_until })); process.exit(0); }
console.log(JSON.stringify({ decision: 'FAILOVER', run, manager, backup, reason: active.length ? 'manager lease expired' : 'manager has no active attempt' }));
