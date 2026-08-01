#!/usr/bin/env node
/**
 * Durable execution ledger for agent runs.
 *
 * This is deliberately a small append-only primitive. A board ticket says what work exists;
 * this ledger says which attempt is executing it, what checkpoint was reached, and whether the
 * lease is still alive. A process may die between any two records; recovery must inspect the
 * ledger, never silently create a second attempt.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`run-ledger: ${message}\n`); process.exit(code); };
const VALUE_FLAGS = new Set([
  'ledger', 'run', 'ticket', 'role', 'attempt', 'phase', 'lease-seconds', 'detail', 'context',
  'worktree', 'by', 'effect', 'pending', 'now',
]);
const { flags, positional } = parseArgs(process.argv.slice(2), { valueFlags: VALUE_FLAGS, die });
const command = positional[0];
const ledger = resolve(String(flags.ledger || 'docs/team/runs.jsonl'));

function readRecords() {
  if (!existsSync(ledger)) return [];
  let text;
  try { text = readFileSync(ledger, 'utf8'); } catch (e) { die(2, `cannot read ${ledger}: ${e.message}`); }
  const records = [];
  let previous = '';
  for (const [index, line] of text.split('\n').filter(Boolean).entries()) {
    let record;
    try { record = JSON.parse(line); } catch { die(2, `malformed record at line ${index + 1}`); }
    const expected = createHash('sha256').update(`${previous}\n${JSON.stringify({ ...record, hash: undefined })}`).digest('hex');
    if (record.prev_hash !== previous || record.hash !== expected) die(2, `ledger chain is broken at line ${index + 1}`);
    previous = record.hash;
    records.push(record);
  }
  return records;
}

function value(name, required = true) {
  const result = flags[name];
  if (required && (!result || result === true)) die(2, `--${name} needs a value`);
  return result;
}

function append(event, fields = {}) {
  const records = readRecords();
  const previous = records.at(-1)?.hash || '';
  const record = {
    schema: 'run-ledger/v1', ts: String(flags.now || new Date().toISOString()), event,
    ...fields, prev_hash: previous,
  };
  record.hash = createHash('sha256').update(`${previous}\n${JSON.stringify({ ...record, hash: undefined })}`).digest('hex');
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, `${JSON.stringify(record)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function active(records, run, attempt) {
  let state = null;
  for (const record of records) {
    if (record.run_id !== run || (attempt && record.attempt_id !== attempt)) continue;
    if (['start', 'checkpoint', 'heartbeat'].includes(record.event)) state = { ...state, ...record };
    if (['complete', 'interrupt', 'abandon'].includes(record.event)) state = { ...state, ...record, terminal: true };
  }
  return state && !state.terminal ? state : null;
}

/**
 * A ticket has at most one live claim: two different runs racing `board.mjs move X claimed` must
 * not both succeed. Unlike `active()`, this checks the ticket, not the run, and only counts a
 * still-leased attempt — an expired lease is an orphan `run-doctor` reports, not a hold.
 */
function activeForTicket(records, ticket, now) {
  const byAttempt = new Map();
  for (const record of records) {
    if (record.ticket !== ticket) continue;
    const attemptKey = `${record.run_id}/${record.attempt_id}`;
    const state = byAttempt.get(attemptKey) || {};
    if (['start', 'checkpoint', 'heartbeat'].includes(record.event)) Object.assign(state, record, { terminal: false });
    if (['complete', 'interrupt', 'abandon'].includes(record.event)) Object.assign(state, record, { terminal: true });
    byAttempt.set(attemptKey, state);
  }
  for (const state of byAttempt.values()) {
    if (state.terminal) continue;
    if (state.lease_until && new Date(state.lease_until) > now) return state;
  }
  return null;
}

if (!command) die(2, 'usage: start|checkpoint|heartbeat|complete|interrupt');
const records = readRecords();
if (command === 'start') {
  const run = String(flags.run || `RUN-${randomUUID()}`);
  const attempt = String(flags.attempt || `ATT-${randomUUID()}`);
  if (active(records, run)) die(1, `run ${run} already has an active attempt; recover or interrupt it first`);
  const seconds = Number(flags['lease-seconds'] || 900);
  if (!Number.isFinite(seconds) || seconds <= 0) die(2, '--lease-seconds must be a positive number');
  const now = new Date(String(flags.now || new Date().toISOString()));
  if (Number.isNaN(now.getTime())) die(2, '--now must be an ISO timestamp');
  const ticket = value('ticket');
  const holder = activeForTicket(records, ticket, now);
  if (holder) {
    die(1, `ticket ${ticket} is already leased by ${holder.run_id}/${holder.attempt_id} ` +
      `(${holder.role}) until ${holder.lease_until}`);
  }
  append('start', {
    run_id: run, attempt_id: attempt, ticket, role: value('role'),
    phase: String(flags.phase || 'start'), lease_until: new Date(now.getTime() + seconds * 1000).toISOString(),
    context_snapshot: flags.context || null, worktree: flags.worktree || null, by: flags.by || null,
  });
} else {
  const run = value('run');
  const attempt = value('attempt');
  const current = active(records, run, attempt);
  if (!current) die(1, `no active attempt ${attempt} for run ${run}`);
  if (command === 'heartbeat' || command === 'checkpoint') {
    const seconds = Number(flags['lease-seconds'] || 900);
    const now = new Date(String(flags.now || new Date().toISOString()));
    if (!Number.isFinite(seconds) || seconds <= 0 || Number.isNaN(now.getTime())) die(2, 'invalid lease or timestamp');
    append(command, {
      run_id: run, attempt_id: attempt, ticket: current.ticket, role: current.role,
      phase: flags.phase || current.phase, checkpoint: command === 'checkpoint' ? (value('detail') || 'checkpoint') : null,
      lease_until: new Date(now.getTime() + seconds * 1000).toISOString(),
      effect: flags.effect || null, pending: flags.pending || null, context_snapshot: flags.context || current.context_snapshot,
      by: flags.by || current.by || null,
    });
  } else if (['complete', 'interrupt', 'abandon'].includes(command)) {
    append(command, {
      run_id: run, attempt_id: attempt, ticket: current.ticket, role: current.role,
      phase: flags.phase || current.phase, detail: flags.detail || null, effect: flags.effect || null,
      pending: flags.pending || null, context_snapshot: flags.context || current.context_snapshot,
      by: flags.by || current.by || null,
    });
  } else die(2, `unknown command ${command}`);
}
