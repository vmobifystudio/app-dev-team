#!/usr/bin/env node
/**
 * portfolio — N projects, one question: where should the next hour go?
 *
 * The single-project dashboard answers "what is happening here". A studio shipping several apps has
 * a different problem: which of them is quietly stuck. Activity is a terrible proxy for that — the
 * busy project is the one being looked after. A project blocked three days with nobody on it is
 * both the least active and the one that needs the hour, so the ranking multiplies what is stuck by
 * how long nothing has moved.
 *
 * Every reading goes through lib/board.mjs and lib/events.mjs. There is no second parser here: the
 * board, the event log, the message ledger and the bug board are read exactly as board-render,
 * board-doctor, the dashboard and ship-gate read them, and the round journal is read by shelling out
 * to round-journal.mjs, which owns the budget ceilings. A portfolio that agreed with nothing else in
 * the system would be a fifth opinion, and the one people looked at.
 *
 * DEGRADE HONESTLY — the whole point. A project whose board cannot be read is printed as
 * `UNREADABLE — <why>` at the top of the ranking. It is never omitted and never counted as healthy,
 * because a project silently missing from a list reads as "nothing to worry about", and this is the
 * easiest place in the entire codebase to commit that error. An empty registry is exit 2, not an
 * all-clear.
 *
 * Usage:
 *   portfolio.mjs [--registry <path>] [--json] [--limit N]
 *
 * Registry: one project path per line; `#` comments and blank lines ignored; `~` expanded; relative
 * paths resolve against the registry file's own directory. Default path:
 *   $APP_TEAM_REGISTRY, else ~/.app-dev-team/projects.txt
 *
 * Exit codes:
 *   0  a portfolio was reported (UNREADABLE rows included — they are reported, not failures here)
 *   1  bad usage
 *   2  cannot evaluate — no registry, an unreadable registry, or a registry naming no projects
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import {
  readBoard,
  parseMessages,
  parseBugs,
  openQuestions,
  findBlockingAncestor,
  isEmpty,
} from './lib/board.mjs';
import { parseEventLog, reduce, key } from './lib/events.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const REL = {
  board: 'docs/31-board.md',
  log: 'docs/31-board-events.jsonl',
  messages: 'docs/team/messages.md',
  bugs: 'docs/51-bugs.md',
  journal: 'docs/33-rounds.jsonl',
};

const DEFAULT_REGISTRY = process.env.APP_TEAM_REGISTRY || join(homedir(), '.app-dev-team/projects.txt');

const die = (code, message) => {
  process.stderr.write(`portfolio: ${message}\n`);
  process.exit(code);
};

// The three-state contract, at the portfolio's own boundary: "I could not evaluate this" prints on
// stdout in the shape the caller displays, and never shares an exit code with "all clear".
const cannotEvaluate = (message, action) => {
  process.stdout.write('PORTFOLIO\n');
  process.stdout.write(`  UNKNOWN  ${message}\n`);
  process.stdout.write(`\nRESULT: CANNOT EVALUATE — the portfolio is UNKNOWN, not healthy.\n  ${action}\n`);
  process.exit(2);
};

// --- registry -----------------------------------------------------------------------------------

const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

function readRegistry(path) {
  if (!existsSync(path)) {
    cannotEvaluate(
      `no registry at ${path}, so the set of projects is unknown — which is not the same as there being none.`,
      `Create it (one project path per line), or pass --registry <path>. Override the default with APP_TEAM_REGISTRY.`,
    );
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    cannotEvaluate(`cannot read ${path}: ${error.message}`, 'Fix the permissions or the path and re-run.');
  }
  const base = dirname(resolve(path));
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => resolve(base, expand(line)));
  if (!entries.length) {
    cannotEvaluate(
      `${path} names no projects. An empty portfolio is reported as empty — it is never "nothing needs attention".`,
      'Add project paths to the registry, one per line.',
    );
  }
  return [...new Set(entries)];
}

// --- one project --------------------------------------------------------------------------------

const read = (root, rel) => {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
};

const DAY = 86_400_000;

/**
 * Lifecycle: the least-advanced thing still true about the sprint, not the most advanced.
 *
 * "One ticket reached qa" is the sentence a project reports about itself; "four are still blocked"
 * is the one that decides where the hour goes. Blocked outranks everything for that reason.
 */
function lifecycleOf(rows) {
  if (!rows.length) return 'unplanned';
  const open = rows.filter((r) => r.status !== 'done' && r.status !== 'closed');
  if (!open.length) return 'all tickets done';
  if (open.every((r) => r.status === 'blocked')) return 'blocked';
  if (open.some((r) => r.status === 'blocked')) return 'building (some blocked)';
  if (open.some((r) => r.status === 'in_progress')) return 'building';
  if (open.some((r) => r.status === 'review')) return 'in review';
  if (open.some((r) => r.status === 'qa')) return 'in qa';
  if (open.some((r) => r.status === 'todo')) return 'planned, not started';
  return 'unknown';
}

function budgetOf(root) {
  if (!existsSync(join(root, REL.journal))) return { state: 'no journal', line: 'no round journal — the loop has not run, or has not been recording' };
  try {
    const out = execFileSync('node', [join(SCRIPTS, 'round-journal.mjs'), 'check', '--journal', join(root, REL.journal)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { state: 'within budget', line: out.split('\n')[0].trim() };
  } catch (error) {
    const line = String(error.stdout || error.stderr || '').split('\n')[0].trim();
    // exit 1 = a ceiling is reached and the loop must stop. exit 2 = the journal is unreadable, and
    // an unreadable budget is not an unspent one.
    if (error.status === 1) return { state: 'ceiling reached', line: line || 'a budget ceiling is reached' };
    return { state: 'unknown', line: line || `round-journal could not read ${REL.journal}` };
  }
}

function readProject(root) {
  const name = basename(root);
  const bad = (why) => ({ root, name, unreadable: why });

  if (!existsSync(root)) return bad(`no such path: ${root}`);
  try {
    if (!statSync(root).isDirectory()) return bad(`${root} is not a directory`);
  } catch (error) {
    return bad(`cannot stat ${root}: ${error.message}`);
  }

  let boardText;
  let logText;
  try {
    boardText = read(root, REL.board);
    logText = read(root, REL.log);
  } catch (error) {
    return bad(`cannot read the board: ${error.message}`);
  }

  // A log that exists and does not parse is UNREADABLE, never an empty board. Guessing past a
  // corrupt line is how a broken reader reports CLEAR.
  let tickets = new Map();
  let events = [];
  if (logText !== null) {
    const parsed = parseEventLog(logText);
    if (parsed.errors.length) {
      return bad(`${REL.log} has ${parsed.errors.length} unreadable line(s): ${parsed.errors.map((e) => `line ${e.line}: ${e.reason}`).join('; ')}`);
    }
    events = parsed.events;
    tickets = reduce(events).tickets;
  }

  let rows = [];
  let from = null;
  if (boardText !== null) {
    let parsed;
    try {
      parsed = readBoard(boardText);
    } catch (error) {
      return bad(`${REL.board} could not be parsed: ${error.message}`);
    }
    if (parsed.board.rows.length) {
      from = REL.board;
      rows = parsed.board.rows.map((row) => ({
        id: row.id.toUpperCase(),
        owner: isEmpty(row.owner) ? '' : row.owner,
        status: (row.status || '').toLowerCase().trim(),
        staticOnly: Boolean(row.staticOnly),
        dependsOn: row.dependsOn || '',
        notes: row.notes || '',
      }));
    } else if (boardText.trim() && !parsed.board.columns.includes('status')) {
      // The exact shape that cleared a release: a board whose Status column was renamed read as an
      // empty board, and an empty board looks finished.
      return bad(`${REL.board} has no Status column, so no ticket's state can be read`);
    }
  }
  if (!rows.length && tickets.size) {
    from = REL.log;
    rows = [...tickets.values()].map((t) => ({
      id: t.id.toUpperCase(),
      owner: t.owner || '',
      status: t.status,
      staticOnly: t.verifiedStatic,
      dependsOn: t.dependsOn.join(', '),
      notes: '',
    }));
  }
  if (boardText === null && logText === null) {
    return bad(`no ${REL.board} and no ${REL.log} — this path is registered as a project and has no board at all`);
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const blocking = [];
  const awaiting = [];
  const staticOnly = [];
  for (const row of byId.values()) {
    const state = tickets.get(key(row.id));
    if (row.status === 'blocked') {
      const last = state?.events.findLast((e) => e.event === 'blocked');
      const why = (typeof last?.detail === 'string' ? last.detail : '') || row.notes || 'no reason recorded';
      blocking.push(`${row.id}${row.owner ? ` (${row.owner})` : ' (unowned)'} blocked — ${why}`);
    } else if (row.status === 'todo') {
      const ancestor = findBlockingAncestor(row.id, byId);
      if (ancestor) blocking.push(`${row.id} stranded behind ${ancestor.via} (${ancestor.reason})`);
    }
    // Parked in a hand-off state. Not stuck today, but nothing moves it without a person, so the
    // idle multiplier is what turns a forgotten review into the top of the list.
    if (row.status === 'review' || row.status === 'qa') {
      awaiting.push(`${row.id} awaiting ${row.status}${row.owner ? ` (${row.owner})` : ''}`);
    }
    // The fact a sprint must not close on: merged or in QA while asserting a suite that never ran.
    if ((row.staticOnly || state?.verifiedStatic) && ['qa', 'done', 'review'].includes(row.status)) {
      staticOnly.push(`${row.id} is ${row.status} on a static-only verification${state?.staticUnrun ? ` (${state.staticUnrun})` : ''}`);
    }
  }

  const bugsText = read(root, REL.bugs);
  const bugs = bugsText === null ? null : parseBugs(bugsText);

  const messagesText = read(root, REL.messages);
  const questions = messagesText === null ? null : openQuestions(parseMessages(messagesText));

  const stamps = events.map((e) => e.ts).filter(Boolean).sort();
  const last = stamps.length ? stamps[stamps.length - 1] : null;
  const idleDays = last ? Math.max(0, Math.floor((Date.now() - Date.parse(last)) / DAY)) : null;

  return {
    root,
    name,
    from,
    lifecycle: lifecycleOf(rows),
    tickets: rows.length,
    blocking,
    awaiting,
    staticOnly,
    bugs,
    questions,
    budget: budgetOf(root),
    idleDays,
    lastEvent: last,
  };
}

// --- ranking ------------------------------------------------------------------------------------

/**
 * attention = (what is stuck) × (how long nothing has moved)
 *
 * Activity ranks nobody: the project with commits landing today is the one someone is already
 * looking after. Everything in the weighted sum is a thing WAITING for a person — a blocker, an open
 * S1, an unanswered question, a merge resting on a suite that never ran — and the idle multiplier is
 * what makes "blocked for three days with nobody on it" outrank a busy project with the same count.
 *
 * UNREADABLE sorts above every score. Not knowing is worse than any known state, and the fix is
 * usually two minutes.
 */
// JSON.stringify(Infinity) is `null`, and a null attention score reads as "no attention needed" —
// the exact misreading this file exists to prevent, committed in its own output. A finite sentinel.
const UNREADABLE_RANK = 1_000_000_000;
const IDLE_CAP = 8;
const WEIGHTS = { s1: 30, s2: 15, blocked: 12, staticOnly: 10, question: 6, awaiting: 4, unplanned: 20, budget: 20, unknownBugs: 8 };

function score(p) {
  if (p.unreadable) return { total: UNREADABLE_RANK, why: ['UNREADABLE'] };
  const why = [];
  let base = 0;
  const add = (n, label) => { if (n > 0) { base += n; why.push(label); } };

  const s1 = p.bugs ? p.bugs.blocking.filter((b) => b.severity === 'S1').length : 0;
  const s2 = p.bugs ? p.bugs.blocking.filter((b) => b.severity === 'S2').length : 0;
  add(s1 * WEIGHTS.s1, `${s1} open S1`);
  add(s2 * WEIGHTS.s2, `${s2} open S2`);
  add(p.blocking.length * WEIGHTS.blocked, `${p.blocking.length} blocked/stranded`);
  add(p.staticOnly.length * WEIGHTS.staticOnly, `${p.staticOnly.length} static-only`);
  add(p.awaiting.length * WEIGHTS.awaiting, `${p.awaiting.length} awaiting review/qa`);
  add((p.questions?.length || 0) * WEIGHTS.question, `${p.questions?.length} open question(s)`);
  if (p.lifecycle === 'unplanned') add(WEIGHTS.unplanned, 'no tickets yet');
  if (p.budget.state === 'ceiling reached') add(WEIGHTS.budget, 'budget ceiling reached');
  // An unknown count is not a zero count, and it must cost something or it is free to ignore.
  if (p.bugs === null) add(WEIGHTS.unknownBugs, 'open defects UNKNOWN (no bug board)');
  if (p.budget.state === 'unknown') add(WEIGHTS.unknownBugs, 'budget UNKNOWN');

  const idle = p.idleDays === null ? 1 : 1 + Math.min(p.idleDays, IDLE_CAP);
  if (base > 0 && idle > 1) why.push(`idle ${p.idleDays}d (×${idle})`);
  return { total: base * idle, why };
}

// --- render -------------------------------------------------------------------------------------

const line = (s) => process.stdout.write(`${s}\n`);

function render(projects) {
  line(`PORTFOLIO — ${projects.length} project(s), ranked by attention needed`);
  line('');
  for (const [index, p] of projects.entries()) {
    if (p.unreadable) {
      line(`${index + 1}. ${p.name}  —  UNREADABLE — ${p.unreadable}`);
      line(`     ${p.root}`);
      line('     Counted as needing attention, never as healthy. Fix the input and re-run.');
      line('');
      continue;
    }
    const idle = p.idleDays === null ? 'idle unknown (no timestamps)' : `idle ${p.idleDays}d`;
    line(`${index + 1}. ${p.name}  —  ${p.lifecycle}  ·  ${p.tickets} ticket(s)  ·  ${idle}  ·  attention ${p.attention.total}`);
    line(`     ${p.root}`);
    if (p.attention.why.length) line(`     why:       ${p.attention.why.join(' · ')}`);
    for (const b of p.blocking.slice(0, 4)) line(`     blocking:  ${b}`);
    if (p.blocking.length > 4) line(`     blocking:  ...and ${p.blocking.length - 4} more`);
    line(
      p.bugs === null
        ? `     bugs:      UNKNOWN — no ${REL.bugs}. Not zero.`
        : `     bugs:      ${p.bugs.blocking.length} open S1/S2, ${p.bugs.deferred.length} open S3/S4`,
    );
    for (const a of p.awaiting.slice(0, 4)) line(`     awaiting:  ${a}`);
    for (const s of p.staticOnly) line(`     static:    ${s}`);
    line(
      p.questions === null
        ? `     questions: UNKNOWN — no ${REL.messages}`
        : `     questions: ${p.questions.length} open`,
    );
    line(`     budget:    ${p.budget.line}`);
    line('');
  }
  const unreadable = projects.filter((p) => p.unreadable).length;
  line(`${unreadable} unreadable · ${projects.length - unreadable} readable`);
}

// --- main ---------------------------------------------------------------------------------------

// One parser (lib/args.mjs), not a fourth hand-rolled one. The old local `flag` returned `true` for
// a value beginning with `--` and then fell back to the DEFAULT registry — so `--registry
// --my-list.txt` silently reported on a completely different set of projects and said nothing. A
// portfolio quietly reporting on the wrong projects is the exact failure this file's header warns
// about, arriving through the argument parser instead of the reader.
const { flags } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['registry', 'limit']),
  knownFlags: new Set(['registry', 'limit', 'json']),
  die: (code, message) => die(code, `${message}\nusage: portfolio.mjs [--registry <path>] [--json] [--limit N]`),
});
const flag = (name) => flags[name];

const registry = typeof flag('registry') === 'string' ? flag('registry') : DEFAULT_REGISTRY;
const limit = Number(flag('limit')) || Infinity;

const projects = readRegistry(expand(registry))
  .map(readProject)
  .map((p) => ({ ...p, attention: score(p) }))
  .sort((a, b) => b.attention.total - a.attention.total || a.name.localeCompare(b.name))
  .slice(0, limit);

if (flag('json')) {
  process.stdout.write(`${JSON.stringify({ registry, projects }, null, 2)}\n`);
} else {
  render(projects);
}
process.exit(0);
