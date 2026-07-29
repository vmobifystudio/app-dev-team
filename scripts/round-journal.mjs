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
 *                            [--retries N] [--refusals N] [--spawns N] [--wall-clock-sec N]
 *                            [--spend-usd N] [--note "..."]
 *   round-journal.mjs show   [--json]
 *   round-journal.mjs check  [--max-rounds N] [--max-spawns N] [--max-retries N] [--max-spend-usd N]
 *
 * Ceilings: flag > env (APP_TEAM_MAX_ROUNDS, _SPAWNS, _RETRIES, _SPEND_USD) > default.
 * Common flag: --journal <path>   (default docs/33-rounds.jsonl)
 *
 * Exit codes:
 *   0  appended / printed / within budget
 *   1  a ceiling is reached — STOP THE LOOP and report which one (check), or bad usage (append)
 *   2  cannot evaluate — the journal exists and is unreadable
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_JOURNAL = 'docs/33-rounds.jsonl';
const DEFAULTS = { rounds: 12, spawns: 60, retries: 30, spendUsd: null };

const die = (code, message) => {
  process.stderr.write(`round-journal: ${message}\n`);
  process.exit(code);
};

const parseArgs = (argv) => {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s);
      if (inline !== undefined) flags[name] = inline;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
      else flags[name] = true;
    } else positional.push(arg);
  }
  return { flags, positional };
};

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
});

const cmdAppend = (flags, path) => {
  const round = num(flags.round, null);
  if (!round) die(1, 'append needs --round <N>');
  const entry = {
    ts: new Date().toISOString(),
    round,
    tickets: list(flags.tickets),
    verdicts: parsePairs(flags.verdicts),
    retries: num(flags.retries),
    refusals: num(flags.refusals),
    spawns: num(flags.spawns),
    wallClockSec: num(flags['wall-clock-sec']),
    // null, not 0: "not measurable in this harness" and "cost nothing" are different claims.
    spendUsd: flags['spend-usd'] === undefined ? null : num(flags['spend-usd'], null),
    note: typeof flags.note === 'string' ? flags.note : '',
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
  process.stdout.write(`ROUND ${round} journaled: ${entry.tickets.length} tickets, ${entry.spawns} spawns, ${entry.retries} retries, ${entry.refusals} refusals\n`);
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
  const rounds = readJournal(path);
  const t = totals(rounds);
  const caps = ceilings(flags);
  const breached = [];
  if (t.rounds >= caps.rounds) breached.push(`rounds ${t.rounds} / ${caps.rounds}`);
  if (t.spawns >= caps.spawns) breached.push(`spawns ${t.spawns} / ${caps.spawns}`);
  if (t.retries >= caps.retries) breached.push(`retries ${t.retries} / ${caps.retries}`);
  if (caps.spendUsd !== null && t.spendReported && t.spendUsd >= caps.spendUsd) {
    breached.push(`spend $${t.spendUsd.toFixed(2)} / $${caps.spendUsd.toFixed(2)}`);
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
    `BUDGET: rounds ${t.rounds}/${caps.rounds} · spawns ${t.spawns}/${caps.spawns} · retries ${t.retries}/${caps.retries} · ${spendLine}\n`,
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
