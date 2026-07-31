#!/usr/bin/env node
/** Read-only durable-run audit. Exit 0 healthy, 1 actionable anomaly, 2 cannot evaluate. */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`run-doctor: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['ledger', 'now']), die });
const path = resolve(String(flags.ledger || 'docs/team/runs.jsonl'));
if (!existsSync(path)) { process.stderr.write(`run-doctor: no ledger at ${path}\n`); process.exit(2); }
let lines;
try { lines = readFileSync(path, 'utf8').split('\n').filter(Boolean); } catch (e) { die(2, e.message); }
const runs = new Map(); let previous = ''; let bad = false;
for (const [index, line] of lines.entries()) {
  let record;
  try { record = JSON.parse(line); } catch { die(2, `malformed record at line ${index + 1}`); }
  const expected = createHash('sha256').update(`${previous}\n${JSON.stringify({ ...record, hash: undefined })}`).digest('hex');
  if (record.prev_hash !== previous || record.hash !== expected) die(2, `ledger chain broken at line ${index + 1}`);
  previous = record.hash;
  if (!record.run_id || !record.attempt_id || !record.event || !record.ts) die(2, `missing identity at line ${index + 1}`);
  const key = `${record.run_id}/${record.attempt_id}`;
  const state = runs.get(key) || { run_id: record.run_id, attempt_id: record.attempt_id, terminal: false };
  if (['start', 'checkpoint', 'heartbeat'].includes(record.event)) Object.assign(state, record);
  if (['complete', 'interrupt', 'abandon'].includes(record.event)) { state.terminal = true; state.terminal_event = record.event; }
  if (state.terminal && ['start', 'checkpoint', 'heartbeat'].includes(record.event)) { bad = true; console.error(`run-doctor: activity after terminal state: ${key}`); }
  runs.set(key, state);
}
const now = new Date(String(flags.now || new Date().toISOString()));
if (Number.isNaN(now.getTime())) die(2, '--now must be an ISO timestamp');
const active = [...runs.values()].filter((r) => !r.terminal);
const byRun = new Map();
for (const state of active) {
  const list = byRun.get(state.run_id) || []; list.push(state); byRun.set(state.run_id, list);
  if (!state.lease_until || Number.isNaN(new Date(state.lease_until).getTime())) { bad = true; console.error(`run-doctor: active attempt has no valid lease: ${state.attempt_id}`); }
  else if (new Date(state.lease_until) <= now) { bad = true; console.error(`run-doctor: orphaned lease: ${state.run_id}/${state.attempt_id} expired ${state.lease_until}`); }
}
for (const [run, attempts] of byRun) if (attempts.length > 1) { bad = true; console.error(`run-doctor: duplicate active attempts for ${run}: ${attempts.map((a) => a.attempt_id).join(', ')}`); }
console.log(`RUN DOCTOR: ${bad ? 'ANOMALIES' : 'CLEAR'} — ${runs.size} attempt(s), ${active.length} active`);
process.exit(bad ? 1 : 0);
