#!/usr/bin/env node
/**
 * board — the only writer of the sprint board.
 *
 * Every mutation is a validated append to `docs/31-board-events.jsonl`, after which
 * `docs/31-board.md` is regenerated as a view. The Markdown is a rendering, never a source: an
 * agent that edits a cell is editing a file the next render overwrites, and no rule anywhere reads
 * it back as authority.
 *
 * Usage:
 *   board.mjs add   <ID> --title T [--owner R] [--feature F-001] [--depends A,B] [--estimate M]
 *                        [--spec S] [--acceptance A] [--notes N] [--by role]
 *   board.mjs move  <ID> <event> --by <role> [--detail "..."]
 *   board.mjs assign <ID> --to <role> [--by <role>]
 *   board.mjs show  [ID] [--json]
 *   board.mjs render
 *   board.mjs migrate [path/to/31-board.md] [--out path.jsonl]
 *
 * Common flags: --log <events.jsonl>  --board <31-board.md>
 *
 * Events: created · claimed · assigned · done_reported · verified · rejected · review_requested ·
 *         started · approved · changes · merged · qa_passed · qa_failed · blocked · unblocked · closed
 *
 * Exit codes:
 *   0  appended / rendered
 *   1  refused — the transition is illegal, or a rule says no
 *   2  cannot evaluate — the log or board is missing or unreadable
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { parseBoard, parseLedger, parseDependencies, isEmpty, MAX_REVIEW_CYCLES } from './lib/board.mjs';
import {
  EVENTS,
  parseEventLog,
  reduce,
  validate,
  dependentsOf,
  renderBoard,
  deriveMetrics,
} from './lib/events.mjs';

const DEFAULT_LOG = 'docs/31-board-events.jsonl';
const DEFAULT_BOARD = 'docs/31-board.md';

const die = (code, message) => {
  process.stderr.write(`board: ${message}\n`);
  process.exit(code);
};

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s);
    if (inline !== undefined) flags[name] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[name] = argv[(i += 1)];
    else flags[name] = true;
  }
  return { flags, positional };
}

/**
 * Read the log. A log that exists but does not parse is exit 2, never an empty board — an
 * unreadable gate that returns "nothing to report" is how a broken check reports CLEAR.
 */
function loadLog(logPath, { required = true } = {}) {
  if (!existsSync(logPath)) {
    if (required) die(2, `no event log at ${logPath}. Run "board.mjs add" or "board.mjs migrate" first.`);
    return { events: [] };
  }
  let text;
  try {
    text = readFileSync(logPath, 'utf8');
  } catch (error) {
    die(2, `cannot read ${logPath}: ${error.message}`);
  }
  const { events, errors } = parseEventLog(text);
  if (errors.length) {
    die(
      2,
      `${logPath} has ${errors.length} unreadable line(s) — refusing to guess:\n` +
        errors.map((e) => `  line ${e.line}: ${e.reason}`).join('\n')
    );
  }
  return { events };
}

function append(logPath, event) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(event)}\n`);
}

function writeView(boardPath, tickets) {
  mkdirSync(dirname(boardPath), { recursive: true });
  writeFileSync(boardPath, renderBoard(tickets));
}

function refuse(id, name, result) {
  process.stderr.write(
    `board: refused ${name} on ${id}\n` +
      `  ${result.reason}\n` +
      `  legal from here: ${result.legal.length ? result.legal.join(', ') : '(nothing — terminal state)'}\n`
  );
}

// --------------------------------------------------------------------------------------------
// commands
// --------------------------------------------------------------------------------------------

function cmdAdd(id, flags, paths) {
  if (!id) die(1, 'add needs a ticket ID: board.mjs add APP-001 --title "..."');
  const { events } = loadLog(paths.log, { required: false });
  const { tickets } = reduce(events);

  const detail = {
    title: flags.title || '',
    feature: flags.feature || '',
    owner: flags.owner || '',
    dependsOn: flags.depends ? parseDependencies(String(flags.depends)) : [],
    estimate: flags.estimate || '',
    spec: flags.spec || '',
    acceptance: flags.acceptance || '',
    notes: flags.notes || '',
  };
  const event = {
    ts: new Date().toISOString(),
    ticket: id.toUpperCase(),
    event: 'created',
    by: flags.by || 'tech-manager',
    detail,
    provenance: 'cli',
  };

  const result = validate(tickets, event);
  if (!result.ok) {
    refuse(event.ticket, 'created', result);
    process.exit(1);
  }
  append(paths.log, event);
  const next = reduce([...events, event]);
  writeView(paths.board, next.tickets);
  process.stdout.write(`${event.ticket} created (todo). Board re-rendered to ${paths.board}\n`);
}

function cmdMove(id, name, flags, paths) {
  if (!id || !name) die(1, 'move needs a ticket and an event: board.mjs move APP-001 claimed --by ios-developer');
  const ticket = id.toUpperCase();
  const { events } = loadLog(paths.log);
  const { tickets } = reduce(events);

  const event = {
    ts: new Date().toISOString(),
    ticket,
    event: name,
    by: flags.by || '',
    detail: flags.detail || '',
    provenance: 'cli',
  };

  const result = validate(tickets, event);
  if (!result.ok) {
    refuse(ticket, name, result);
    // The cycle cap does not merely refuse: a ticket that has burnt its review budget is stuck, and
    // leaving it in `review` waiting for a 3rd rejection that can never be written is the state the
    // hand-edited board used to sit in. Force the escalation into the log so it is visible.
    if (result.force) {
      const forced = { ...event, event: result.force.event, detail: result.force.detail, by: flags.by || '' };
      append(paths.log, forced);
      const next = reduce([...events, forced]);
      writeView(paths.board, next.tickets);
      process.stderr.write(`  -> ${ticket} moved to blocked instead: ${result.force.detail}\n`);
      reportCascade(next.tickets, ticket);
    }
    process.exit(1);
  }

  append(paths.log, event);
  const next = reduce([...events, event]);
  writeView(paths.board, next.tickets);
  const state = next.tickets.get(ticket);
  process.stdout.write(`${ticket} ${name} -> ${state.status} (cycles ${state.cycles})\n`);
  if (name === 'blocked') reportCascade(next.tickets, ticket);
}

/** `blocked` cascades: say which dependents just stopped being claimable, and why. */
function reportCascade(tickets, id) {
  const dependents = dependentsOf(tickets, id);
  if (!dependents.length) return;
  process.stdout.write(
    `readiness recomputed — not claimable while ${id} is blocked: ${dependents.join(', ')}\n`
  );
}

function cmdAssign(id, flags, paths) {
  if (!id || !flags.to) die(1, 'assign needs a ticket and a role: board.mjs assign APP-001 --to ios-developer');
  return cmdMove(id, 'assigned', { ...flags, detail: { to: flags.to } }, paths);
}

function cmdShow(id, flags, paths) {
  const { events } = loadLog(paths.log);
  const { tickets, violations } = reduce(events);
  const metrics = deriveMetrics(events);

  if (flags.json) {
    const state = {};
    for (const [key, t] of tickets) {
      state[key] = {
        id: t.id,
        status: t.status,
        owner: t.owner,
        reviewer: t.reviewer,
        cycles: t.cycles,
        dependsOn: t.dependsOn,
        approvals: t.approvals,
        ...t.meta,
      };
    }
    const payload = id ? { [id.toUpperCase()]: state[id.toUpperCase()] } : { tickets: state, metrics, violations };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return violations.length ? process.exit(1) : undefined;
  }

  const wanted = id ? [tickets.get(id.toUpperCase())].filter(Boolean) : [...tickets.values()];
  if (id && !wanted.length) die(1, `${id.toUpperCase()} is not on the board`);

  for (const t of wanted) {
    process.stdout.write(
      `${t.id.padEnd(14)} ${t.status.padEnd(12)} owner=${t.owner || '—'} reviewer=${t.reviewer || '—'} ` +
        `cycles=${t.cycles}/${MAX_REVIEW_CYCLES} deps=${t.dependsOn.join(',') || '—'} events=${t.events.length}\n`
    );
  }

  if (!id) {
    const pct = (v) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
    process.stdout.write(
      `\nreview pass rate ${pct(metrics.reviewPassRate)} · rework ${pct(metrics.reworkRate)} · ` +
        `gates fired ${JSON.stringify(metrics.gateFires)}\n`
    );
  }
  if (violations.length) {
    process.stderr.write(
      `\n${violations.length} sequence violation(s) in the log — repair by appending, never editing:\n` +
        violations.map((v) => `  line ${v.event._line}: ${v.reason}`).join('\n') +
        '\n'
    );
    process.exit(1);
  }
}

function cmdRender(paths) {
  const { events } = loadLog(paths.log);
  const { tickets } = reduce(events);
  writeView(paths.board, tickets);
  process.stdout.write(`rendered ${tickets.size} ticket(s) to ${paths.board}\n`);
}

// --------------------------------------------------------------------------------------------
// migrate
// --------------------------------------------------------------------------------------------

const LEDGER_EVENT = {
  requested: 'review_requested',
  started: 'started',
  changes: 'changes',
  approved: 'approved',
  merged: 'merged',
};

/**
 * Reconstruct an event log from a hand-written board plus its review ledger.
 *
 * Two provenances, and the distinction is the whole point. Ledger lines carry a real timestamp and
 * a real actor, so they migrate as `provenance: "ledger"`. Everything else — that a ticket was
 * created, claimed, verified, QA'd — was never recorded anywhere, so it is emitted with `ts: null`
 * and `provenance: "inferred"`. A migration that filled those in with plausible times would produce
 * a log that reads as evidence and is not, which is the same class of lie as a false DONE.
 */
function migrate(text) {
  const board = parseBoard(text);
  if (board.rows.length === 0) return null;
  const ledger = parseLedger(text);
  const byTicket = new Map();
  for (const entry of ledger) {
    if (!byTicket.has(entry.ticketId)) byTicket.set(entry.ticketId, []);
    byTicket.get(entry.ticketId).push(entry);
  }

  const events = [];
  const notes = [];
  const inferred = (ticket, event, detail = '') => ({
    ts: null,
    ticket,
    event,
    by: '',
    detail,
    provenance: 'inferred',
  });

  for (const row of board.rows) {
    const id = row.id.toUpperCase();
    const status = (row.status || '').toLowerCase();
    const owner = isEmpty(row.owner) ? '' : row.owner;

    events.push({
      ts: null,
      ticket: id,
      event: 'created',
      by: '',
      detail: {
        title: row.title || '',
        feature: row.feature || '',
        owner,
        dependsOn: parseDependencies(row.dependsOn),
        estimate: isEmpty(row.estimate) ? '' : row.estimate,
        spec: isEmpty(row.spec) ? '' : row.spec,
        acceptance: isEmpty(row.acceptance) ? '' : row.acceptance,
        notes: isEmpty(row.notes) ? '' : row.notes,
      },
      provenance: 'inferred',
    });

    if (status === 'todo') continue;

    // Anything past todo was worked, so a claim happened — but nothing recorded when or by whom.
    events.push({ ...inferred(id, 'claimed'), by: owner });

    const entries = byTicket.get(id) || [];

    // The ledger records review verdicts and nothing else, so the developer's half of each rework
    // loop — the fix, the re-verify, the re-request — was never written down anywhere. A `changes`
    // followed later by an `approved` is proof the ticket went back through review; the steps
    // between are inferred, because the alternative is a log whose every rework loop replays as a
    // violation and drowns the real ones.
    let inReview = false;
    const preReview = () => {
      events.push(inferred(id, 'done_reported'));
      events.push(inferred(id, 'verified', 'no verify-done record on the hand-written board'));
    };
    const enterReview = (to) => {
      if (inReview) return;
      preReview();
      events.push(inferred(id, 'review_requested', to ? `-> ${to}` : ''));
      inReview = true;
    };

    for (const entry of entries) {
      const name = LEDGER_EVENT[entry.action];
      if (!name) {
        notes.push(`${id}: ledger action "${entry.action}" (line ${entry._line}) has no event — dropped`);
        continue;
      }
      if (name === 'review_requested') {
        if (inReview) continue; // already re-entered; a duplicate request is not a second review
        preReview();
        inReview = true;
      } else {
        enterReview(entry.to || row.reviewer);
      }
      events.push({
        ts: entry.timestamp || null,
        ticket: id,
        event: name,
        by: name === 'review_requested' ? entry.from : entry.from || entry.to,
        detail: name === 'review_requested' ? `-> ${entry.to}` : '',
        provenance: entry.timestamp ? 'ledger' : 'inferred',
      });
      if (name === 'changes') inReview = false;
    }

    // A row sitting in review/qa/done with an empty ledger reached review some way nobody recorded.
    // A blocked or in_progress row did not, and inferring one for it would invent a review that
    // never happened — the migration's only job is to be honest about what it does not know.
    if (['review', 'qa', 'done'].includes(status)) enterReview(isEmpty(row.reviewer) ? '' : row.reviewer);

    const merged = entries.some((e) => e.action === 'merged');
    const approved = entries.some((e) => e.action === 'approved');
    if (['qa', 'done'].includes(status)) {
      if (!approved) {
        events.push({ ...inferred(id, 'approved', 'no approval on the board — status implies one'), by: isEmpty(row.reviewer) ? '' : row.reviewer });
        notes.push(`${id}: status "${status}" with no approved ledger line — approval is inferred, not evidence`);
      }
      if (!merged) events.push(inferred(id, 'merged'));
    }
    if (status === 'done') {
      events.push(inferred(id, 'qa_passed'));
      events.push(inferred(id, 'closed'));
    }
    if (status === 'blocked') events.push(inferred(id, 'blocked', isEmpty(row.notes) ? '' : row.notes));

    // The Cycles column is the pre-migration counter and it is exactly the thing that drifted from
    // the ledger. Trust the ledger; report the disagreement rather than silently picking one.
    const ledgerCycles = entries.filter((e) => e.action === 'changes').length;
    const columnCycles = Number.parseInt(row.cycles ?? '', 10);
    if (Number.isFinite(columnCycles) && columnCycles !== ledgerCycles) {
      notes.push(
        `${id}: Cycles column says ${columnCycles}, ledger has ${ledgerCycles} "changes" — migrated log uses the ledger`
      );
    }
  }

  return { events, notes, ticketCount: board.rows.length };
}

function cmdMigrate(pathArg, flags, paths) {
  const boardPath = resolve(process.cwd(), pathArg || paths.board);
  if (!existsSync(boardPath)) die(2, `no board at ${boardPath}`);
  let text;
  try {
    text = readFileSync(boardPath, 'utf8');
  } catch (error) {
    die(2, `cannot read ${boardPath}: ${error.message}`);
  }

  const migrated = migrate(text);
  if (!migrated) die(2, `no parseable ticket table in ${boardPath} — nothing to migrate`);

  const { events, notes, ticketCount } = migrated;
  const lines = events.map((e) => JSON.stringify(e)).join('\n');
  const out = typeof flags.out === 'string' ? resolve(process.cwd(), flags.out) : null;
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${lines}\n`);
  } else {
    process.stdout.write(`${lines}\n`);
  }

  const inferredCount = events.filter((e) => e.provenance === 'inferred').length;
  const { violations } = reduce(events);
  process.stderr.write(
    `migrated ${ticketCount} ticket(s) -> ${events.length} event(s), ` +
      `${inferredCount} inferred (ts: null), ${events.length - inferredCount} from the ledger\n` +
      notes.map((n) => `  note: ${n}\n`).join('') +
      violations.map((v) => `  violation: ${v.reason}\n`).join('')
  );
}

// --------------------------------------------------------------------------------------------

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;
  const paths = {
    log: resolve(process.cwd(), typeof flags.log === 'string' ? flags.log : DEFAULT_LOG),
    board: resolve(process.cwd(), typeof flags.board === 'string' ? flags.board : DEFAULT_BOARD),
  };

  switch (command) {
    case 'add':
      return cmdAdd(rest[0], flags, paths);
    case 'move':
      return cmdMove(rest[0], rest[1], flags, paths);
    case 'assign':
      return cmdAssign(rest[0], flags, paths);
    case 'show':
      return cmdShow(rest[0], flags, paths);
    case 'render':
      return cmdRender(paths);
    case 'migrate':
      return cmdMigrate(rest[0], flags, paths);
    default:
      process.stderr.write(
        `board: unknown command "${command ?? ''}"\n` +
          '  add <ID> --title T [--owner R] [--depends A,B] ...\n' +
          '  move <ID> <event> --by <role> [--detail "..."]\n' +
          '  assign <ID> --to <role>\n' +
          '  show [ID] [--json]\n' +
          '  render\n' +
          '  migrate [board.md] [--out log.jsonl]\n' +
          `  events: ${[...EVENTS].join(' ')}\n`
      );
      return process.exit(1);
  }
}

main();
