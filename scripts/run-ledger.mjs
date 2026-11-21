#!/usr/bin/env node
/**
 * Durable execution ledger for agent runs.
 *
 * This is deliberately a small append-only primitive. A board ticket says what work exists;
 * this ledger says which attempt is executing it, what checkpoint was reached, and whether the
 * lease is still alive. A process may die between any two records; recovery must inspect the
 * ledger, never silently create a second attempt.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { withFileLock } from './lib/atomic.mjs';
import { deriveMetrics, parseEventLog } from './lib/events.mjs';

const die = (code, message) => { process.stderr.write(`run-ledger: ${message}\n`); process.exit(code); };

// Codex, PR #15: the ticket-holder check (`activeForTicket`, reading a snapshot of the ledger) and
// the write that follows it (`append`, which re-reads the ledger for its own hash-chain tip) are
// two separate operations with nothing between them. Two `start` invocations racing the same
// ticket can both read "no active holder" before either writes, so both append a `start` record —
// reproduced directly: two concurrent claims on one ticket both succeeded, and because each
// process computed `prev_hash` against the same stale tip, the SECOND append's `prev_hash` no
// longer matched the file's actual last hash, breaking the chain for every future read. An
// `O_EXCL` lockfile serializes the whole read-decide-append sequence per ledger, the same
// mechanism every Unix mail spool and package manager uses for exactly this problem — Node has no
// built-in flock, and this plugin stays dependency-free by design.
//
// The lock is lib/atomic.mjs's withFileLock (C7-10). This file used to carry its own O_EXCL lock
// with no stale reaping, so a SIGKILLed holder blocked every claim until someone deleted the file
// by hand; the shared primitive reaps a dead holder once the lock has aged past any real section.
const VALUE_FLAGS = new Set([
  'ledger', 'run', 'ticket', 'role', 'attempt', 'phase', 'lease-seconds', 'detail', 'context',
  'worktree', 'by', 'effect', 'pending', 'now', 'stop', 'root', 'last',
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

if (!command) die(2, 'usage: start|checkpoint|heartbeat|complete|interrupt|summary|history');

/**
 * LN-4 / LN-6: `summary --stop <cause>` appends ONE line per finished or stopped run, derived from
 * the project's own board log and review verdicts, to a studio-level file OUTSIDE the plugin cache
 * (a reinstall replaces the cache; this survives it and spans projects). `history` reads it back so
 * a run can be compared with the last ones. A recurrence is an FC class a REQUEST CHANGES verdict
 * cites after that class's `Rule shipped` date: counted from what reviewers already write, never
 * from rows someone has to remember to add.
 * ponytail: the verdict's date is its file mtime — a fresh clone dates every verdict "today", which
 * over-reports recurrences (fails loud, never clean). Read the board's `changes` ts if that bites.
 */
const SUMMARY = join(process.env.APP_TEAM_HOME || join(homedir(), '.app-dev-team'), 'runs-summary.jsonl');
const STOPS = new Set(['shipped', 'blocked', 'budget', 'stopped', 'gate']);
const readSummary = () => (existsSync(SUMMARY) ? readFileSync(SUMMARY, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);
const trend = (a, b) => `first-pass ${pct(a.first_pass_rate)}→${pct(b.first_pass_rate)} · cycles/ticket ${a.cycles_per_ticket}→${b.cycles_per_ticket} · rounds ${a.rounds}→${b.rounds} · FC cited ${a.fc_cited_total}→${b.fc_cited_total}`;

if (command === 'summary') {
  const stop = String(flags.stop || '');
  if (!STOPS.has(stop)) die(2, `--stop must be one of ${[...STOPS].join('|')}`);
  const root = resolve(String(flags.root || '.'));
  const log = join(root, 'docs/31-board-events.jsonl');
  if (!existsSync(log)) die(2, `no board log at ${log} — nothing to summarise`);
  const metrics = deriveMetrics(parseEventLog(readFileSync(log, 'utf8')).events);
  const tickets = Object.values(metrics.tickets);
  const reviewed = tickets.filter((t) => t.reviewed);
  const journal = join(root, 'docs/33-rounds.jsonl');
  const rounds = Math.max(Object.keys(metrics.ticketsPerRound).length,
    existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter((l) => l.trim()).length : 0);
  const shipped = {};
  const corpus = fileURLToPath(new URL('../knowledge/failure-corpus.md', import.meta.url));
  let cls = null;
  for (const line of readFileSync(corpus, 'utf8').split('\n')) {
    cls = line.match(/^###\s+(FC-\d+)/)?.[1] || cls;
    const d = line.match(/^\*\*Rule shipped:\*\*\s*(\d{4}-\d{2}-\d{2})/);
    if (cls && d) shipped[cls] = d[1];
  }
  const fcCited = {};
  const recurrences = [];
  const reviews = join(root, 'docs/53-reviews');
  for (const f of existsSync(reviews) ? readdirSync(reviews).filter((n) => n.endsWith('.md')).sort() : []) {
    const text = readFileSync(join(reviews, f), 'utf8');
    if (!/^REVIEW VERDICT:\s*REQUEST CHANGES\s*$/m.test(text)) continue;
    const date = statSync(join(reviews, f)).mtime.toISOString().slice(0, 10);
    for (const id of new Set(text.match(/\bFC-\d+\b/g) || [])) {
      fcCited[id] = (fcCited[id] || 0) + 1;
      if (shipped[id] && date > shipped[id]) recurrences.push({ id, file: `docs/53-reviews/${f}`, date, rule_shipped: shipped[id] });
    }
  }
  const line = {
    schema: 'runs-summary/v1', ts: String(flags.now || new Date().toISOString()), project: basename(root), stop,
    tickets: tickets.length, done: tickets.filter((t) => t.status === 'done').length, descoped: tickets.filter((t) => t.status === 'descoped').length,
    first_pass_rate: metrics.reviewPassRate, rework_rate: metrics.reworkRate,
    cycles_per_ticket: reviewed.length ? +(reviewed.reduce((n, t) => n + t.cycles, 0) / reviewed.length).toFixed(2) : 0,
    qa_failures: metrics.gateFires.qa_failed, rounds,
    fc_cited: fcCited, fc_cited_total: Object.values(fcCited).reduce((a, b) => a + b, 0), recurrences,
  };
  const previous = readSummary().filter((r) => r.project === line.project).at(-1); // PR49P-5: this project's last run
  mkdirSync(dirname(SUMMARY), { recursive: true });
  appendFileSync(SUMMARY, `${JSON.stringify(line)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(line)}\n`);
  if (previous) process.stdout.write(`VS LAST RUN (${previous.project}, ${previous.stop}): ${trend(previous, line)}\n`);
  for (const r of recurrences) {
    process.stdout.write(`RECURRENCE ${r.id} — cited in ${r.file} on ${r.date}, after its rule shipped ${r.rule_shipped}\n`);
  }
  process.exit(0);
}
if (command === 'history') {
  const last = Math.max(1, Number(flags.last) || 5);
  // PR49P-5: --project narrows to one app; the file spans every project on this machine.
  const runs = readSummary().filter((r) => typeof flags.project !== 'string' || r.project === flags.project).slice(-last);
  if (!runs.length) { process.stdout.write(`HISTORY: no runs recorded yet in ${SUMMARY}\n`); process.exit(0); }
  for (const r of runs) process.stdout.write(`${JSON.stringify(r)}\n`);
  if (runs.length > 1) process.stdout.write(`TREND (${runs.length} runs): ${trend(runs[0], runs.at(-1))}\n`);
  process.exit(0);
}
withFileLock(ledger, () => {
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
}, { die });
