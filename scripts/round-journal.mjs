#!/usr/bin/env node
/**
 * round-journal — one JSONL line per sprint round, and the loop's only economic brake.
 *
 * `docs/31-board-events.jsonl` records what happened to TICKETS. Nothing records what happened to
 * the LOOP: how many rounds ran, how many agents were spawned, how many retries and refusals it
 * cost. Those are different questions and only the first was answerable, so an unattended
 * `/app-run` had no budget awareness at all — the only brake was a per-ticket spawn cap.
 *
 * Honesty rule: this harness cannot report token spend. `spendUsd` is `null` unless something
 * passes a real number, and `check` says plainly that token cost is not measurable here rather
 * than inventing one. What IS countable — rounds, spawns, retries, refusals, wall-clock — is
 * counted, and those are the ceilings that stop the loop.
 *
 * Usage:
 *   round-journal.mjs append --round N [--tickets A,B] [--verdicts approved=2,changes=1]
 *                            [--agents ios-developer=2,qa-engineer=1]
 *                            [--retries N] [--refusals N] [--spawns N] [--wall-clock-sec N]
 *                            [--spend-usd N] [--verified-static N] [--note "..."]
 *   round-journal.mjs show   [--json]
 *   round-journal.mjs check  [--max-rounds N] [--max-spawns N] [--max-retries N] [--max-spend-usd N]
 *                            [--max-agent-spawns N] [--max-static-stall-rounds N]
 *
 * `--verified-static N` records that round's odometer reading (OPS-013: how many tickets currently
 * carry `verified_static` rather than a real, executed `verified`) — `orchestrator round` prints
 * the number, this is what gives it teeth: `check` blocks once the reading has stayed above zero
 * and non-decreasing for `--max-static-stall-rounds` (default 3) consecutive reported rounds, the
 * signal that waves have stopped landing rather than merely being mid-flight.
 *
 * Ceilings: flag > env (APP_TEAM_MAX_ROUNDS, _SPAWNS, _RETRIES, _SPEND_USD, _AGENT_SPAWNS) > default.
 *
 * `check` also honours the studio EMERGENCY STOP (`.studio-stop` or APP_TEAM_STOP) and exits 1 with
 * the operator's recorded reason. See scripts/lib/stop.mjs.
 * Common flag: --journal <path>   (default docs/33-rounds.jsonl)
 *
 * Exit codes:
 *   0  appended / printed / within budget
 *   1  a ceiling is reached — STOP THE LOOP and report which one (check), or bad usage (append)
 *   2  cannot evaluate — the journal exists and is unreadable
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { parseArgs as parseArgv } from './lib/args.mjs';
import { readStop, STOP_FILE } from './lib/stop.mjs';

const DEFAULT_JOURNAL = 'docs/33-rounds.jsonl';
const DEFAULTS = { rounds: 12, spawns: 60, retries: 30, spendUsd: null, agentSpawns: 20, staticStallRounds: 3 };

const die = (code, message) => {
  process.stderr.write(`round-journal: ${message}\n`);
  process.exit(code);
};

/**
 * Every flag here takes a value, and that is the point: this file shipped a byte-identical copy of
 * the `board.mjs` argument-injection hole. `--note "--journal=/tmp/x"` set `note` to `true` and
 * wrote the loop's budget ledger to an attacker-chosen path — so the ceilings that stop an
 * unattended `/app-run` were computed from an empty file and never fired. Same class, second file;
 * one parser now, in lib/args.mjs.
 */
const VALUE_FLAGS = new Set([
  'round', 'tickets', 'verdicts', 'retries', 'refusals', 'spawns', 'agents',
  'wall-clock-sec', 'spend-usd', 'note', 'journal', 'verified-static',
  'max-rounds', 'max-spawns', 'max-retries', 'max-spend-usd', 'max-agent-spawns',
  'max-static-stall-rounds',
]);
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, 'json']);

const parseArgs = (argv) => parseArgv(argv, { valueFlags: VALUE_FLAGS, knownFlags: KNOWN_FLAGS, die });

const num = (value, fallback = 0) => {
  if (value === undefined || value === true) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const readJournal = (path) => {
  if (!existsSync(path)) return [];
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    die(2, `cannot read ${path}: ${error.message}`);
  }
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        die(2, `${path}:${index + 1} is not valid JSON — the journal is append-only, never edited`);
      }
      return null;
    });
};

// "approved=2,changes=1" -> { approved: 2, changes: 1 }. Verdicts are free-form on purpose: the
// board CLI owns the closed set of events, and duplicating it here would be a second authority.
const parsePairs = (value) => {
  if (typeof value !== 'string' || !value.trim()) return {};
  return Object.fromEntries(
    value
      .split(',')
      .map((pair) => pair.split('='))
      .filter(([k]) => k && k.trim())
      .map(([k, v]) => [k.trim(), num(v, 1)]),
  );
};

const list = (value) =>
  typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];

/**
 * Spawns per role, summed over the journal.
 *
 * The studio-wide `spawns` ceiling is a blunt instrument: 59 of 60 spawns can belong to one looping
 * `ios-developer` retrying the same ticket, and the aggregate looks healthy right up to the moment
 * it stops the whole loop. A per-agent ceiling catches the one role that is stuck while the others
 * are working, which is both the cheaper failure to catch and the one an operator can act on.
 */
const perAgent = (rounds) => {
  const out = {};
  for (const r of rounds) {
    for (const [role, n] of Object.entries(r.agents || {})) out[role] = (out[role] || 0) + num(n);
  }
  return out;
};

const totals = (rounds) =>
  rounds.reduce(
    (acc, r) => ({
      rounds: acc.rounds + 1,
      spawns: acc.spawns + num(r.spawns),
      retries: acc.retries + num(r.retries),
      refusals: acc.refusals + num(r.refusals),
      wallClockSec: acc.wallClockSec + num(r.wallClockSec),
      spendUsd: r.spendUsd === null || r.spendUsd === undefined ? acc.spendUsd : acc.spendUsd + num(r.spendUsd),
      spendReported: acc.spendReported || (r.spendUsd !== null && r.spendUsd !== undefined),
    }),
    { rounds: 0, spawns: 0, retries: 0, refusals: 0, wallClockSec: 0, spendUsd: 0, spendReported: false },
  );

// A COUNTER CANNOT BE NEGATIVE. `num()` accepts any finite number, so `--spawns -60` after 60
// recorded spawns summed to zero and cleared the ceiling — the economic brake on an unattended
// /app-run, removed by one flag. Counters are monotone by nature; a negative one is malformed
// input, not a correction. Reported by codex on PR #14.
const count = (label, v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    process.stderr.write(`round-journal: ${label} must be a non-negative number (got ${JSON.stringify(v)}). ` +
      'A negative counter would subtract from the running total and clear a ceiling that has already been reached.\n');
    process.exit(2);
  }
  return n;
};

const ceilings = (flags) => ({
  rounds: num(flags['max-rounds'], num(process.env.APP_TEAM_MAX_ROUNDS, DEFAULTS.rounds)),
  spawns: num(flags['max-spawns'], num(process.env.APP_TEAM_MAX_SPAWNS, DEFAULTS.spawns)),
  retries: num(flags['max-retries'], num(process.env.APP_TEAM_MAX_RETRIES, DEFAULTS.retries)),
  spendUsd:
    flags['max-spend-usd'] !== undefined
      ? num(flags['max-spend-usd'], null)
      : process.env.APP_TEAM_MAX_SPEND_USD
        ? num(process.env.APP_TEAM_MAX_SPEND_USD, null)
        : DEFAULTS.spendUsd,
  agentSpawns: num(flags['max-agent-spawns'], num(process.env.APP_TEAM_MAX_AGENT_SPAWNS, DEFAULTS.agentSpawns)),
  staticStallRounds: num(
    flags['max-static-stall-rounds'],
    num(process.env.APP_TEAM_MAX_STATIC_STALL_ROUNDS, DEFAULTS.staticStallRounds),
  ),
});

/**
 * OPS-013's odometer had no teeth: `orchestrator round` printed the verified_static count every
 * round and nothing read it — an operator running unattended would see a growing number scroll by
 * in stdout with nothing stopping the loop. This is the enforcement half. `--verified-static <n>`
 * on `append` records one round's reading; `check` looks at the most recent N readings (default 3,
 * `--max-static-stall-rounds` / `APP_TEAM_MAX_STATIC_STALL_ROUNDS`) and blocks if the count is
 * NON-DECREASING across all of them while staying above zero — waves are not landing, and the
 * static-only promise is piling up rather than clearing. A round that never reported the odometer
 * at all (older journals, or a project that hasn't adopted OPS-013 yet) has no data to stall on:
 * `null` entries are skipped rather than treated as zero, so absence of data never reads as "stuck
 * at zero" — the same distinction `spendUsd: null` already draws in this file.
 */
const staticStall = (rounds, cap) => {
  const readings = rounds
    .filter((r) => r.verifiedStatic !== null && r.verifiedStatic !== undefined)
    .map((r) => ({ round: r.round, n: num(r.verifiedStatic) }));
  if (readings.length < cap) return null;
  const window = readings.slice(-cap);
  if (!window.every((w) => w.n > 0)) return null;
  for (let i = 1; i < window.length; i += 1) {
    if (window[i].n < window[i - 1].n) return null; // it shrank somewhere in the window — not a stall
  }
  return window;
};

const cmdAppend = (flags, path) => {
  const round = num(flags.round, null);
  if (!round) die(1, 'append needs --round <N>');
  const entry = {
    ts: new Date().toISOString(),
    round,
    tickets: list(flags.tickets),
    verdicts: parsePairs(flags.verdicts),
    retries: count('--retries', flags.retries ?? 0),
    refusals: count('--refusals', flags.refusals ?? 0),
    spawns: count('--spawns', flags.spawns ?? 0),
    // "ios-developer=2,qa-engineer=1" — same shape as --verdicts, same parser.
    agents: parsePairs(flags.agents),
    wallClockSec: count('--wall-clock-sec', flags['wall-clock-sec'] ?? 0),
    // null, not 0: "not measurable in this harness" and "cost nothing" are different claims.
    spendUsd: flags['spend-usd'] === undefined ? null : num(flags['spend-usd'], null),
    // null, not 0: "the odometer wasn't reported this round" and "zero tickets are static-only"
    // are different claims — the same distinction spendUsd already draws.
    verifiedStatic: flags['verified-static'] === undefined ? null : count('--verified-static', flags['verified-static']),
    note: typeof flags.note === 'string' ? flags.note : '',
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
  process.stdout.write(
    `ROUND ${round} journaled: ${entry.tickets.length} tickets, ${entry.spawns} spawns, ${entry.retries} retries, ${entry.refusals} refusals` +
      `${entry.verifiedStatic === null ? '' : `, ${entry.verifiedStatic} verified_static`}\n`,
  );
  process.exit(0);
};

const cmdShow = (flags, path) => {
  const rounds = readJournal(path);
  const t = totals(rounds);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ rounds, totals: t }, null, 2)}\n`);
    process.exit(0);
  }
  if (!rounds.length) {
    process.stdout.write('ROUND JOURNAL: no rounds yet\n');
    process.exit(0);
  }
  process.stdout.write(`ROUND JOURNAL  (${t.rounds} rounds)\n`);
  for (const r of rounds) {
    const verdicts = Object.entries(r.verdicts || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';
    process.stdout.write(
      `  round ${r.round}  tickets ${(r.tickets || []).length}  spawns ${num(r.spawns)}  retries ${num(r.retries)}  refusals ${num(r.refusals)}  ${verdicts}\n`,
    );
  }
  process.stdout.write(
    `  totals        spawns ${t.spawns} · retries ${t.retries} · refusals ${t.refusals} · wall-clock ${Math.round(t.wallClockSec / 60)}m\n`,
  );
  process.stdout.write(
    t.spendReported
      ? `  spend         $${t.spendUsd.toFixed(2)}\n`
      : '  spend         not measurable in this harness — spawns/rounds/retries are what is counted\n',
  );
  process.exit(0);
};

const cmdCheck = (flags, path) => {
  // The kill switch is checked FIRST and reported on its own line. It is not a budget: a budget
  // says "this has cost enough", a stop says "an operator wants this halted now", and printing
  // them as the same kind of fact invites the same response — raise the ceiling and continue.
  const stop = readStop(process.cwd());
  if (stop.stopped) {
    process.stdout.write(`EMERGENCY STOP is set (${stop.source})\n  reason: ${stop.reason}\n`);
    process.stdout.write(
      '  Spawn nothing. Report what is unfinished and stop the loop.\n' +
        `  This is cleared by an operator (rm ${STOP_FILE}), never by an agent deciding it is fine now.\n`
    );
    process.exit(1);
  }
  const rounds = readJournal(path);
  const t = totals(rounds);
  const caps = ceilings(flags);
  const agents = perAgent(rounds);
  const breached = [];
  if (t.rounds >= caps.rounds) breached.push(`rounds ${t.rounds} / ${caps.rounds}`);
  for (const [role, n] of Object.entries(agents)) {
    if (n >= caps.agentSpawns) breached.push(`agent ${role} ${n} / ${caps.agentSpawns}`);
  }
  if (t.spawns >= caps.spawns) breached.push(`spawns ${t.spawns} / ${caps.spawns}`);
  if (t.retries >= caps.retries) breached.push(`retries ${t.retries} / ${caps.retries}`);
  if (caps.spendUsd !== null && t.spendReported && t.spendUsd >= caps.spendUsd) {
    breached.push(`spend $${t.spendUsd.toFixed(2)} / $${caps.spendUsd.toFixed(2)}`);
  }
  const stall = staticStall(rounds, caps.staticStallRounds);
  if (stall) {
    breached.push(
      `verified_static has not shrunk in ${stall.length} rounds (${stall.map((w) => `r${w.round}:${w.n}`).join(' -> ')})`,
    );
  }

  const spendLine = t.spendReported
    ? `spend $${t.spendUsd.toFixed(2)}`
    : 'spend not measurable in this harness';

  if (breached.length) {
    process.stdout.write(`BUDGET: CEILING REACHED — ${breached.join(' · ')}\n`);
    process.stdout.write(`  rounds ${t.rounds}/${caps.rounds} · spawns ${t.spawns}/${caps.spawns} · retries ${t.retries}/${caps.retries} · ${spendLine}\n`);
    process.stdout.write('  STOP THE LOOP. Report the ceiling and what is unfinished; do not spawn another round.\n');
    process.stdout.write('  Raise it deliberately with --max-rounds/--max-spawns/--max-retries (or APP_TEAM_MAX_*) if the work justifies it.\n');
    process.exit(1);
  }

  process.stdout.write(
    `BUDGET: rounds ${t.rounds}/${caps.rounds} · spawns ${t.spawns}/${caps.spawns} · retries ${t.retries}/${caps.retries} · ${spendLine}\n` +
      `  per agent (max ${caps.agentSpawns} each): ${Object.entries(agents).map(([r, n]) => `${r} ${n}`).join(' · ') || 'nothing journaled — pass --agents role=N'}\n`,
  );
  process.exit(0);
};

const main = () => {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const path = resolve(process.cwd(), typeof flags.journal === 'string' ? flags.journal : DEFAULT_JOURNAL);
  switch (positional[0]) {
    case 'append':
      return cmdAppend(flags, path);
    case 'show':
      return cmdShow(flags, path);
    case 'check':
      return cmdCheck(flags, path);
    default:
      return die(1, 'usage: round-journal.mjs append|show|check [flags]');
  }
};

main();
