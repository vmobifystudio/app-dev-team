/**
 * Event log for the sprint board — the write side of lib/board.mjs.
 *
 * `docs/31-board.md` used to BE the state: an LLM edited a Markdown cell, and every rule about what
 * was legal was checked afterwards by board-doctor. That ordering is the whole defect class — a
 * self-approval, a merge without review, a claim on a stranded dependency and a drifted cycle count
 * were all writable, then detectable. Here the transition is validated BEFORE the append, so those
 * states are unrepresentable rather than reportable, and the Markdown board becomes a rendering.
 *
 * Log format: one JSON object per line, append-only.
 *   {"ts":"2026-07-29T09:00:00Z","ticket":"APP-001","event":"claimed","by":"ios-developer",
 *    "detail":"","provenance":"cli"}
 *
 * `provenance` is "cli" for anything this tool appended and "inferred" for anything `migrate`
 * reconstructed from a hand-written board. An inferred line has `ts: null` — a migration that
 * invented a plausible timestamp would be the same class of lie as a false DONE.
 *
 * Repair is by appending, never editing: the log is append-only exactly like the review ledger, for
 * the reason dry run 3 finding 2 established — a strict reader over a log with no repair path turns
 * one typo into a permanently blocked board.
 */

import { MAX_REVIEW_CYCLES } from './board.mjs';

const EVENTS = new Set([
  'created',
  'claimed',
  'assigned',
  'done_reported',
  'verified',
  'rejected',
  'review_requested',
  'started',
  'approved',
  'changes',
  'merged',
  'qa_passed',
  'qa_failed',
  'blocked',
  'unblocked',
  'closed',
]);

/**
 * `assigned` is the one event beyond the vocabulary the plan decided, and it is here because the
 * plan's own CLI surface requires an `assign` subcommand that the decided table cannot express.
 * Ownership at planning time is not `claimed`: `claimed` starts work, moves the row to in_progress
 * and (correctly) refuses when a dependency has not merged — so routing `assign` through it would
 * make it impossible to assign the second ticket of a track before the first one lands. `assigned`
 * changes the owner and nothing else.
 */
const STATUS_PRESERVING = new Set(['assigned', 'started', 'verified', 'done_reported', 'qa_passed', 'qa_failed', 'approved', 'rejected']);

/** What may legally happen next, keyed by derived status. Anything absent is refused. */
function legalEvents(state) {
  switch (state.status) {
    case 'todo':
      return ['claimed', 'assigned', 'blocked'];
    case 'in_progress':
      if (state.verifyPending) return ['verified', 'rejected', 'blocked', 'assigned'];
      if (state.verified) return ['review_requested', 'done_reported', 'blocked', 'assigned'];
      return ['done_reported', 'blocked', 'assigned'];
    case 'review':
      return ['started', 'approved', 'changes', 'merged', 'blocked', 'assigned'];
    case 'qa':
      return state.qaPassed
        ? ['closed', 'qa_failed', 'blocked']
        : ['qa_passed', 'qa_failed', 'blocked'];
    case 'done':
      return [];
    case 'blocked':
      return ['unblocked'];
    default:
      return [];
  }
}

// --------------------------------------------------------------------------------------------
// reading
// --------------------------------------------------------------------------------------------

/**
 * Parse a JSONL event log. Returns `{events, errors}`; a caller that finds errors must fail closed
 * (exit 2), never treat a half-readable log as an empty board.
 */
function parseEventLog(text) {
  const events = [];
  const errors = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      errors.push({ line: index + 1, reason: 'not valid JSON' });
      return;
    }
    if (!record || typeof record !== 'object' || !record.ticket || !record.event) {
      errors.push({ line: index + 1, reason: 'missing required field (ticket, event)' });
      return;
    }
    if (!EVENTS.has(record.event)) {
      errors.push({ line: index + 1, reason: `unknown event "${record.event}"` });
      return;
    }
    events.push({ _line: index + 1, provenance: 'cli', detail: '', by: '', ts: null, ...record });
  });
  return { events, errors };
}

const REVIEWER_IN_DETAIL = /(?:->|→)\s*([\w-]+)/;

function blankTicket(id) {
  return {
    id,
    status: 'todo',
    owner: '',
    reviewer: '',
    cycles: 0,
    approvals: [],
    dependsOn: [],
    verified: false,
    verifyPending: false,
    qaPassed: false,
    qaFailures: 0,
    prevStatus: 'todo',
    meta: {},
    events: [],
  };
}

/**
 * Fold the log into per-ticket state. Lenient by design: a migrated or hand-repaired log can
 * contain sequences the CLI would refuse, and rendering has to survive them. Illegal folds are
 * collected in `violations` so a caller can report them instead of the reducer throwing and taking
 * the whole board down with it. The strict check lives at append time (`validate`), where refusing
 * costs nothing.
 */
function reduce(events) {
  const tickets = new Map();
  const violations = [];

  for (const event of events) {
    const { ticket: id, event: name, by, detail } = event;
    if (name === 'created') {
      if (tickets.has(id)) {
        violations.push({ event, reason: `${id} was created twice` });
        continue;
      }
      const state = blankTicket(id);
      const meta = typeof detail === 'object' && detail ? detail : {};
      state.meta = meta;
      state.owner = meta.owner || by || '';
      state.dependsOn = Array.isArray(meta.dependsOn) ? meta.dependsOn : [];
      state.created = event;
      state.events.push(event);
      tickets.set(id, state);
      continue;
    }

    const state = tickets.get(id);
    if (!state) {
      violations.push({ event, reason: `event on unknown ticket ${id} (no "created")` });
      continue;
    }
    if (!legalEvents(state).includes(name)) {
      violations.push({ event, reason: `${name} is not legal from ${state.status}` });
    }
    state.events.push(event);

    switch (name) {
      case 'assigned':
        state.owner = (typeof detail === 'object' ? detail.to : detail) || by || state.owner;
        break;
      case 'claimed':
        state.status = 'in_progress';
        state.owner = by || state.owner;
        state.verified = false;
        break;
      case 'done_reported':
        state.verifyPending = true;
        state.verified = false;
        break;
      case 'verified':
        state.verifyPending = false;
        state.verified = true;
        break;
      case 'rejected':
        state.verifyPending = false;
        state.verified = false;
        break;
      case 'review_requested': {
        state.status = 'review';
        const named = REVIEWER_IN_DETAIL.exec(String(detail || ''));
        if (named) state.reviewer = named[1];
        break;
      }
      case 'started':
        state.reviewer = by || state.reviewer;
        break;
      case 'approved':
        state.reviewer = by || state.reviewer;
        state.approvals.push({ by, ts: event.ts });
        break;
      case 'changes':
        state.cycles += 1;
        state.status = 'in_progress';
        state.reviewer = by || state.reviewer;
        state.verified = false;
        break;
      case 'merged':
        state.status = 'qa';
        state.mergedAt = event.ts;
        break;
      case 'qa_passed':
        state.qaPassed = true;
        break;
      case 'qa_failed':
        state.qaFailures += 1;
        break;
      case 'closed':
        state.status = 'done';
        state.closedAt = event.ts;
        break;
      case 'blocked':
        if (state.status !== 'blocked') state.prevStatus = state.status;
        state.status = 'blocked';
        break;
      case 'unblocked':
        state.status = state.prevStatus || 'todo';
        break;
      default:
        break;
    }
  }

  return { tickets, violations };
}

// --------------------------------------------------------------------------------------------
// the gate
// --------------------------------------------------------------------------------------------

/**
 * Decide whether `candidate` may be appended given the state the log folds to.
 * Returns `{ok: true}` or `{ok: false, reason, legal, force}`, where `force` is an event this
 * refusal obliges the caller to append instead (the cycle cap forcing `blocked`).
 */
function validate(tickets, candidate) {
  const { ticket: id, event: name, by } = candidate;

  if (!EVENTS.has(name)) {
    return { ok: false, reason: `"${name}" is not an event`, legal: [...EVENTS] };
  }

  const state = tickets.get(id);

  if (name === 'created') {
    return state
      ? { ok: false, reason: `${id} already exists`, legal: legalEvents(state) }
      : { ok: true };
  }
  if (!state) {
    return {
      ok: false,
      reason: `${id} is not on the board — create it first with "board.mjs add ${id} ..."`,
      legal: ['created'],
    };
  }

  const legal = legalEvents(state);
  if (!legal.includes(name)) {
    return {
      ok: false,
      reason: `${name} is not legal on ${id} — it is ${state.status}`,
      legal,
    };
  }

  switch (name) {
    case 'claimed': {
      const unmet = state.dependsOn.filter((depId) => {
        const dep = tickets.get(depId);
        if (!dep) return true;
        return !dep.events.some((e) => e.event === 'merged');
      });
      if (unmet.length) {
        return {
          ok: false,
          reason: `${id} depends on ${unmet.join(', ')}, which ${unmet.length > 1 ? 'have' : 'has'} not merged`,
          legal: legal.filter((e) => e !== 'claimed'),
        };
      }
      return { ok: true };
    }
    case 'review_requested':
      if (!state.verified) {
        return {
          ok: false,
          reason: `${id} has no "verified" since its last done_reported — a DONE nobody checked is not reviewable`,
          legal: state.verifyPending ? ['verified', 'rejected', 'blocked'] : ['done_reported', 'blocked'],
        };
      }
      return { ok: true };
    case 'approved':
      if (by && by === state.owner) {
        return {
          ok: false,
          reason: `${by} owns ${id} — a role does not gate its own work`,
          legal: legal.filter((e) => e !== 'approved'),
        };
      }
      return { ok: true };
    case 'merged': {
      const external = state.approvals.filter((a) => a.by && a.by !== state.owner);
      if (!external.length) {
        return {
          ok: false,
          reason: `${id} has no "approved" by a role other than its owner (${state.owner || 'unset'})`,
          legal: legal.filter((e) => e !== 'merged'),
        };
      }
      return { ok: true };
    }
    case 'changes':
      if (state.cycles + 1 > MAX_REVIEW_CYCLES) {
        return {
          ok: false,
          reason: `${id} has spent its ${MAX_REVIEW_CYCLES} review cycles — a 3rd rejection is an escalation, not another loop`,
          legal: ['approved', 'blocked'],
          force: { event: 'blocked', detail: `review cycle cap (${MAX_REVIEW_CYCLES}) reached` },
        };
      }
      return { ok: true };
    case 'closed':
      if (!state.qaPassed) {
        return {
          ok: false,
          reason: `${id} has no "qa_passed" — QA has not exercised the acceptance criteria`,
          legal: ['qa_passed', 'qa_failed', 'blocked'],
        };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

/** Tickets whose readiness changes when `id` is blocked — the cascade the plan's table asks for. */
function dependentsOf(tickets, id, seen = new Set()) {
  const out = [];
  for (const [otherId, state] of tickets) {
    if (seen.has(otherId) || !state.dependsOn.includes(id)) continue;
    seen.add(otherId);
    out.push(otherId, ...dependentsOf(tickets, otherId, seen));
  }
  return out;
}

// --------------------------------------------------------------------------------------------
// rendering
// --------------------------------------------------------------------------------------------

const CELL = (value) => {
  const text = String(value ?? '').trim();
  return text === '' ? '—' : text.replace(/\|/g, '\\|');
};

const LEDGER_ACTION = {
  review_requested: 'requested',
  started: 'started',
  changes: 'changes',
  approved: 'approved',
  merged: 'merged',
};

/**
 * Regenerate `docs/31-board.md` from the log.
 *
 * The Markdown stays human-readable and diffable on purpose — that is what makes this system
 * inspectable without running anything, and it is why board-doctor still works as the drift
 * detector over the generated file. The column set and the review-ledger section are held identical
 * to the hand-written format so every existing reader keeps parsing it unchanged.
 */
function renderBoard(tickets, { generatedAt = new Date().toISOString() } = {}) {
  const header = [
    '# Sprint board',
    '',
    '<!-- GENERATED FILE — do not hand-edit.',
    '     Rendered from docs/31-board-events.jsonl by scripts/board.mjs.',
    '     Mutate the board with `node scripts/board.mjs move <ID> <event> --by <role>`;',
    '     a hand edit is silently overwritten by the next render and is invisible to every rule. -->',
    '',
    `Generated ${generatedAt} from ${tickets.size} ticket(s).`,
    '',
    '| ID | Feature | Title | Owner | Reviewer | Status | Cycles | Depends on | Estimate | Spec | Acceptance | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];

  const rows = [...tickets.values()].map((t) =>
    `| ${[
      t.id,
      t.meta.feature,
      t.meta.title,
      t.owner,
      t.reviewer,
      t.status,
      t.cycles,
      t.dependsOn.join(', '),
      t.meta.estimate,
      t.meta.spec,
      t.meta.acceptance,
      t.meta.notes,
    ]
      .map(CELL)
      .join(' | ')} |`
  );

  const ledger = [
    '',
    '## Review ledger (append-only — never edit or delete a line)',
    'Derived from the event log. Action is exactly one of: `requested` `started` `changes` `approved` `merged`',
    '',
    '| Timestamp | Ticket | Action | Actor |',
    '|---|---|---|---|',
  ];

  for (const t of tickets.values()) {
    for (const event of t.events) {
      const action = LEDGER_ACTION[event.event];
      if (!action) continue;
      const actor = action === 'requested' && t.reviewer ? `${event.by} -> ${t.reviewer}` : event.by;
      ledger.push(`| ${CELL(event.ts ?? 'inferred')} | ${t.id} | ${action} | ${CELL(actor)} |`);
    }
  }

  return `${[...header, ...rows, ...ledger].join('\n')}\n`;
}

// --------------------------------------------------------------------------------------------
// self-metrics
// --------------------------------------------------------------------------------------------

/**
 * Derive the numbers that make a judgement about this system evidence-based instead of a belief.
 *
 * Consumed by `/app-status`; takes the parsed events (not a path) so it never becomes a second read
 * path to the log.
 *
 *   deriveMetrics(events) -> {
 *     tickets: { [id]: { cycleTimeMs, cycles, reviewed, approvedFirstPass, qaFailures, status } },
 *     reviewPassRate,   // approved with 0 `changes` / all tickets that reached review
 *     reworkRate,       // tickets with >=1 `changes` / all tickets that reached review
 *     gateFires,        // {rejected, changes, qa_failed, blocked} — times a gate actually caught something
 *     ticketsPerRound,  // {<round>: n}
 *     medianCycleTimeMs,
 *   }
 *
 * ponytail: a "round" is `detail.round` when the caller stamps one, else the UTC date of the
 * `claimed` event. Date-bucketing is wrong for a sprint that runs two rounds in a day; stamp
 * `--round N` on `claimed` if that ever matters.
 */
function deriveMetrics(events) {
  const { tickets } = reduce(events);
  const perTicket = {};
  const gateFires = { rejected: 0, changes: 0, qa_failed: 0, blocked: 0 };
  const ticketsPerRound = {};
  const cycleTimes = [];
  let reachedReview = 0;
  let firstPass = 0;
  let reworked = 0;

  for (const event of events) {
    if (event.event in gateFires) gateFires[event.event] += 1;
  }

  for (const [id, t] of tickets) {
    const claimed = t.events.find((e) => e.event === 'claimed');
    const closed = t.events.findLast((e) => e.event === 'closed') || t.events.findLast((e) => e.event === 'merged');
    const cycleTimeMs =
      claimed?.ts && closed?.ts ? Date.parse(closed.ts) - Date.parse(claimed.ts) : null;
    if (Number.isFinite(cycleTimeMs)) cycleTimes.push(cycleTimeMs);

    const reviewed = t.events.some((e) => e.event === 'review_requested');
    if (reviewed) {
      reachedReview += 1;
      if (t.cycles === 0 && t.approvals.length) firstPass += 1;
      if (t.cycles > 0) reworked += 1;
    }

    const round =
      (typeof claimed?.detail === 'object' ? claimed.detail.round : undefined) ??
      (claimed?.ts ? claimed.ts.slice(0, 10) : 'unscheduled');
    ticketsPerRound[round] = (ticketsPerRound[round] || 0) + 1;

    perTicket[id] = {
      cycleTimeMs,
      cycles: t.cycles,
      reviewed,
      approvedFirstPass: reviewed && t.cycles === 0 && t.approvals.length > 0,
      qaFailures: t.qaFailures,
      status: t.status,
    };
  }

  cycleTimes.sort((a, b) => a - b);

  return {
    tickets: perTicket,
    reviewPassRate: reachedReview ? firstPass / reachedReview : null,
    reworkRate: reachedReview ? reworked / reachedReview : null,
    gateFires,
    ticketsPerRound,
    medianCycleTimeMs: cycleTimes.length ? cycleTimes[Math.floor(cycleTimes.length / 2)] : null,
  };
}

export {
  EVENTS,
  STATUS_PRESERVING,
  legalEvents,
  parseEventLog,
  reduce,
  validate,
  dependentsOf,
  renderBoard,
  deriveMetrics,
};
