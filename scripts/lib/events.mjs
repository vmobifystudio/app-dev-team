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

import { createHash } from 'node:crypto';

import { MAX_REVIEW_CYCLES } from './board.mjs';
import { checkCapability } from './capabilities.mjs';

const EVENTS = new Set([
  'created',
  // `corrected` is the SANCTIONED way to fix a ticket's metadata — a typo in a title, a wrong
  // owner, a feature ID that names the wrong requirement.
  //
  // IT EXISTS BECAUSE ITS ABSENCE CAUSED A WORSE PROBLEM. There was no legal way to correct a
  // field, so agents edited docs/31-board.md directly — which is precisely the behaviour the
  // log-authoritative change made illegal. Closing an escape hatch without providing the sanctioned
  // route does not remove the pressure; it relocates it, and the next hatch is usually less visible
  // than the one you shut. The two have to ship together.
  //
  // A correction is an APPEND like everything else: the original event stays, the correction states
  // what changed and why, and history shows both. Nothing is rewritten, so the chain still proves
  // what it always proved.
  'corrected',
  'claimed',
  'assigned',
  'done_reported',
  'verified',
  'verified_static',
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
const STATUS_PRESERVING = new Set(['assigned', 'started', 'verified', 'verified_static', 'done_reported', 'qa_passed', 'qa_failed', 'approved', 'rejected']);

/**
 * Ticket IDs are matched case-insensitively but STORED as written.
 *
 * The CLI used to upcase every ID, so the mandated `BUG-001-fix` was rendered `BUG-001-FIX` and a
 * grep for the documented spelling found nothing. Keying the map on the upper form keeps every log
 * ever written (and `parseDependencies`, which upcases) resolving to the same ticket, while
 * `state.id` carries the spelling the operator actually typed.
 */
const key = (id) => String(id ?? '').toUpperCase();

/** What may legally happen next, keyed by derived status. Anything absent is refused. */
function legalEvents(state) {
  // `corrected` is legal from EVERY state, including terminal ones. A typo in a closed ticket's
  // title is still a typo, and refusing to fix it is what sends someone to the Markdown. It cannot
  // move a ticket (see the reducer), so allowing it everywhere costs no safety.
  const withCorrection = (events) => [...events, 'corrected'];
  switch (state.status) {
    case 'todo':
      return withCorrection(['claimed', 'assigned', 'blocked']);
    case 'in_progress':
      if (state.verifyPending) return withCorrection(['verified', 'verified_static', 'rejected', 'blocked', 'assigned']);
      // `review_requested` is listed whether or not a verification is on record. This function
      // answers "what does the STATUS allow"; whether the DONE was actually checked is a
      // PRECONDITION, and it is enforced below with a reason worth reading.
      //
      // It used to be gated here on `state.verified`, which made the precondition check at
      // case 'review_requested' unreachable — the generic "not legal, it is in_progress" answered
      // first and the better message ("a DONE nobody checked is not reviewable") plus its curated
      // legal list were dead code. Two checks for one rule, one of which could never run.
      // mutate.sh found it: M09 was the single surviving mutation of sixteen, because breaking a
      // guard nothing reaches breaks no assertion.
      return withCorrection(['review_requested', 'done_reported', 'blocked', 'assigned']);
    case 'review':
      return withCorrection(['started', 'approved', 'changes', 'merged', 'blocked', 'assigned']);
    case 'qa':
      // `verified` is legal here so a ticket merged on a STATIC verification can be upgraded once
      // the executable suite finally runs. Without that there is no path from `qa (static only)` to
      // `done` except lying, and a sprint would have to close by hand — which is what happened.
      return state.qaPassed
        ? ['closed', 'verified', 'qa_failed', 'blocked']
        : ['qa_passed', 'verified', 'qa_failed', 'blocked'];
    case 'done':
      return withCorrection([]);
    case 'blocked':
      return withCorrection(['unblocked']);
    default:
      return withCorrection([]);
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

// --------------------------------------------------------------------------------------------
// the audit chain
// --------------------------------------------------------------------------------------------

/**
 * Tamper evidence for an append-only log, in about thirty lines and no dependency.
 *
 * The event log is the studio's only record of who decided what. Every rule in this file is
 * enforced at APPEND time — which is exactly why the log is worth attacking: an agent with `Write`
 * can bypass `board.mjs` entirely and edit a line, and until now nothing anywhere would notice. A
 * rewritten `approved` is the cheapest possible way to bypass a failed gate.
 *
 * Each appended line carries `hash = sha256(previous-hash + canonical(this event))`. Editing,
 * reordering or deleting any line changes every hash after it, so the break is located to a line
 * number. This proves the log was not rewritten. It does NOT prove who wrote a line — that needs a
 * key an autonomous agent would have to hold, and an agent that holds a signing key can sign a lie.
 * Attribution is `by`, enforced for gate events in lib/capabilities.mjs; tamper-evidence is here.
 * Two different claims, and conflating them would be the more comfortable lie.
 *
 * LEGACY PREFIX: a log written before this existed has no hashes. The chain starts at the first
 * hashed line, and its anchor is the sha of every raw byte before it — so the unhashed prefix is
 * still covered: edit a legacy line and the first chained line stops verifying. No migration, no
 * flag day, and the honest report is "N unchained / M chained".
 */
const HASH_FIELDS_EXCLUDED = new Set(['hash', '_line']);

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);

/** Key order is not part of the claim, so it must not be part of the hash. */
const canonicalEvent = (event) => {
  const out = {};
  for (const k of Object.keys(event).filter((k) => !HASH_FIELDS_EXCLUDED.has(k)).sort()) out[k] = event[k];
  return JSON.stringify(out);
};

const chainHash = (previous, event) => sha(`${previous}\n${canonicalEvent(event)}`);

/**
 * Walk the log's raw text and confirm every hashed line still hashes.
 *
 * @returns {{ok: true, chained: number, unchained: number, tip: string}
 *         | {ok: false, line: number, reason: string, chained: number, unchained: number}}
 */
function verifyChain(text) {
  const lines = text.split('\n');
  let previous = null;
  let consumed = 0;
  let chained = 0;
  let unchained = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim()) {
      let record = null;
      try {
        record = JSON.parse(line);
      } catch {
        record = null; // parseEventLog owns the "unreadable line" report; this is not a chain break
      }
      if (record && typeof record.hash === 'string') {
        const base = previous === null ? sha(text.slice(0, consumed)) : previous;
        const expected = chainHash(base, record);
        if (record.hash !== expected) {
          return {
            ok: false,
            line: i + 1,
            chained,
            unchained,
            reason:
              `line ${i + 1} does not hash to its recorded value — this line, or something before ` +
              'it, was edited, reordered or deleted after it was appended.',
          };
        }
        previous = record.hash;
        chained += 1;
      } else if (previous !== null) {
        return {
          ok: false,
          line: i + 1,
          chained,
          unchained,
          reason:
            `line ${i + 1} carries no hash but follows ${chained} chained line(s). Something appended ` +
            'to this log without the CLI, so the chain cannot certify anything after it.',
        };
      } else {
        unchained += 1;
      }
    }
    consumed += line.length + (i === lines.length - 1 ? 0 : 1);
  }

  return { ok: true, chained, unchained, tip: previous === null ? sha(text) : previous };
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
    // "the branch checks out and the non-executable checks passed, but the test suite never ran."
    // Carried on the ticket for the rest of its life, not consumed by review, because the fact that
    // survives into `qa` is exactly the one a sprint must not close on.
    verifiedStatic: false,
    staticUnrun: '',
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
      if (tickets.has(key(id))) {
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
      tickets.set(key(id), state);
      continue;
    }

    const state = tickets.get(key(id));
    if (!state) {
      violations.push({ event, reason: `event on unknown ticket ${id} (no "created")` });
      continue;
    }
    if (!legalEvents(state).includes(name)) {
      violations.push({ event, reason: `${name} is not legal from ${state.status}` });
    }
    state.events.push(event);

    switch (name) {
      // A correction changes METADATA, never STATUS. Letting it move a ticket would make it a
      // universal bypass of the whole state machine — every guard in this file could be sidestepped
      // by "correcting" a row into `done`. Only the descriptive fields are writable.
      case 'corrected': {
        // `--detail` ARRIVES AS A STRING FROM THE CLI. cmdMove only keeps an object when the caller
        // is in-process; a shell invocation passes JSON text, so `typeof detail === 'object'` was
        // false for every correction ever made through the command line and the whole case body was
        // skipped in silence.
        //
        // MY OWN TEST COULD NOT SEE IT. It asserted "the correction is accepted" (exit 0 — true, the
        // event appended) and "a correction cannot move status" (also true when NOTHING happens).
        // Both assertions pass against a no-op. That is a rule that cannot fail, written by someone
        // who had just spent the day removing them. Found by dogfood run 2, when a corrected file
        // set had no effect on contention.
        let parsed = detail;
        if (typeof parsed === 'string' && parsed.trim().startsWith('{')) {
          try { parsed = JSON.parse(parsed); } catch { parsed = null; }
        }
        const fields = (typeof parsed === 'object' && parsed) || {};
        for (const f of ['title', 'feature', 'acceptance', 'spec', 'notes', 'estimate']) {
          if (typeof fields[f] === 'string') state.meta[f] = fields[f];
        }
        // `files` IS CORRECTABLE, and leaving it out was FC-001 in the correction path itself.
        //
        // Dogfood run 2: contention refused a dispatch and advised "split the work so the file sets
        // are disjoint" — and `corrected` could not change `files`, so the studio's own remedy was
        // unreachable through the studio's own sanctioned route. The escape hatch was closed, the
        // replacement was built, and the replacement did not cover the field the workflow actually
        // needed. The list of correctable fields was the list I thought of, not the list the work
        // requires.
        if (Array.isArray(fields.files)) state.meta.files = fields.files.map(String);
        // `owner` is corrigible because a mis-assigned ticket is a real and common mistake, and
        // leaving it wrong forces the hand-edit this event exists to replace.
        if (typeof fields.owner === 'string' && fields.owner) state.owner = fields.owner;
        break;
      }
      case 'assigned': {
        // THE SAME STRING/OBJECT BUG `corrected` WAS JUST FIXED FOR, THREE LINES AWAY, IN THE SAME
        // SWITCH. `--detail '{"to":"x"}'` arrives from the CLI as text, so `typeof detail ===
        // 'object'` was false and the whole JSON string became the owner — the reducer wrote
        // `owner: '{"to":"ios-developer"}'`. FC-001 at its shortest range yet: I fixed the case I
        // had written and did not look at its neighbour.
        let parsed = detail;
        if (typeof parsed === 'string' && parsed.trim().startsWith('{')) {
          try { parsed = JSON.parse(parsed); } catch { parsed = detail; }
        }
        state.owner = (typeof parsed === 'object' && parsed ? parsed.to : parsed) || by || state.owner;
        break;
      }
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
        state.verifiedStatic = false;
        state.staticUnrun = '';
        break;
      case 'verified_static':
        state.verifyPending = false;
        state.verified = true;
        state.verifiedStatic = true;
        state.staticUnrun = String(detail || '').trim() || 'the executable test suite';
        break;
      case 'rejected':
        state.verifyPending = false;
        state.verified = false;
        state.verifiedStatic = false;
        state.staticUnrun = '';
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
  const transition = validateTransition(tickets, candidate);
  if (!transition.ok) return transition;
  // Capability runs LAST, so every older refusal keeps its own words. The self-approval message
  // ("a role does not gate its own work") is the one a reviewer needs to read, and it must not be
  // replaced by a generic capability refusal just because this check is newer.
  return checkCapability(tickets.get(key(candidate.ticket)), candidate, legalEvents(tickets.get(key(candidate.ticket)) || { status: 'todo' }));
}

/**
 * Everyone who actually DID work on this ticket.
 *
 * SEPARATION MUST BE CHECKED AGAINST HISTORY, NOT AGAINST A MUTABLE CELL. It compared `by` against
 * `state.owner` — and `owner` is rewritten by `assigned` and by `corrected`, both of which any role
 * may append. The security reviewer walked straight through it with ONE actor:
 *
 *     tech-lead approves own ticket        -> refused, "a role does not gate its own work"
 *     tech-lead corrects owner to "ghost"  -> accepted
 *     tech-lead approves the same ticket   -> ACCEPTED
 *     merged                               -> ACCEPTED
 *
 * And `corrected` was not the hole. The identical escalation works through `assigned`, which is a
 * work event with no capability check and predates all of this — so fixing only `corrected` would
 * have fixed nothing while looking like a fix. FC-001 in the reasoning rather than the code: I went
 * after the mechanism I had just written instead of the property being violated.
 *
 * The property is: THE ROLE THAT DID THE WORK MAY NOT BE THE ROLE THAT CLEARS IT. Who did the work
 * is written in the log — `claimed`, `started`, `done_reported` — and nothing can rewrite it,
 * because the log is append-only. So that is what separation is measured against.
 */
function workedOn(state) {
  // `started` IS NOT WORK — it is the REVIEWER opening the review (`case 'started'` sets
  // state.reviewer). Including it made every reviewer an author of the thing they were reviewing,
  // so the fix for the separation bypass refused every legitimate approval in the suite. Twelve
  // assertions went red at once, which is the only reason it was caught before it shipped: a
  // narrower fix would have passed and quietly broken the review path in the field.
  const WORK = new Set(['claimed', 'done_reported']);
  const who = new Set();
  if (state.owner) who.add(state.owner);
  for (const e of state.events || []) {
    if (WORK.has(e.event) && e.by) who.add(e.by);
  }
  return who;
}

function validateTransition(tickets, candidate) {
  const { ticket: id, event: name, by } = candidate;

  if (!EVENTS.has(name)) {
    return { ok: false, reason: `"${name}" is not an event`, legal: [...EVENTS] };
  }

  const state = tickets.get(key(id));

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
        const dep = tickets.get(key(depId));
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
      // A ticket risk-router routed `high`/`critical` at creation carries a real blast radius —
      // billing, security, a destructive migration. `--invariant` at `board.mjs add` is where that
      // gets named; a high-risk ticket that reaches review with none recorded is a field nobody
      // read, not a contract. Low/medium/unknown risk (no --file at creation, or risk-router not
      // opted into) is unaffected — this is teeth for the risk tier that already asked for scrutiny.
      if (['high', 'critical'].includes(state.meta?.risk) && !(state.meta?.invariants?.length > 0)) {
        return {
          ok: false,
          reason: `${id} is ${state.meta.risk}-risk and was created with no --invariant — a reviewer has nothing to check the change against`,
          legal: legal.filter((e) => e !== 'review_requested'),
        };
      }
      return { ok: true };
    case 'approved': {
      const workers = workedOn(state);
      if (by && workers.has(by)) {
        return {
          ok: false,
          reason: `${by} worked on ${id} (owner or an author of claimed/started/done_reported) — a role does not gate its own work`,
          legal: legal.filter((e) => e !== 'approved'),
        };
      }
      return { ok: true };
    }
    case 'merged': {
      const workers = workedOn(state);
      const external = state.approvals.filter((a) => a.by && !workers.has(a.by));
      if (!external.length) {
        return {
          ok: false,
          reason: `${id} has no "approved" by a role that did not work on it (workers: ${[...workers].join(', ') || 'unset'})`,
          legal: legal.filter((e) => e !== 'merged'),
        };
      }
      // THE POLICY DECISION IS ENFORCED HERE, AT THE MUTATION IT GOVERNS.
      //
      // risk-router has always computed `approvals` — which specialist roles a given blast radius
      // requires — and until now that list was printed and discarded. Ticket creation kept the
      // tier; nothing ever checked the roster it demanded. So a `critical`-risk change touching
      // billing or auth could merge on one generic code-review, exactly as a trivial one does, and
      // every gate reported CLEAR because every gate was asking a different question.
      //
      // `merged` is the right place: it is the last point before the change is in the trunk, and
      // it is where the existing separation rule already lives, so the two authority checks are
      // read together instead of drifting apart.
      const required = state.meta?.policy_decision?.required_approvals || [];
      if (required.length) {
        const have = new Set(state.approvals.map((a) => a.by).filter(Boolean));
        const missing = required.filter((role) => !have.has(role));
        if (missing.length) {
          return {
            ok: false,
            reason:
              `${id} is risk "${state.meta.policy_decision.risk}" and its policy decision requires approval from ` +
              `${required.join(', ')} — missing: ${missing.join(', ')}. ` +
              'A specialist requirement that only prints to stdout is advice; this one is a precondition.',
            legal: legal.filter((e) => e !== 'merged'),
          };
        }
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
      // A ticket verified STATICALLY may merge and may reach qa — that is the whole point, it keeps
      // real work moving on a host whose toolchain is absent. It may not be called done: `done` is
      // the one word that asserts the executable suite ran green, and nothing here has seen it do
      // that. The sprint closes as "merged, verification deferred", which is the truth.
      if (state.verifiedStatic) {
        return {
          ok: false,
          reason:
            `${id} was verified STATICALLY only — ${state.staticUnrun} has never run, so "done" would ` +
            'assert something nobody has checked. The sprint can close as "merged, verification deferred".',
          legal: ['verified', 'qa_failed', 'blocked'],
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
    if (seen.has(otherId) || !state.dependsOn.map(key).includes(key(id))) continue;
    seen.add(otherId);
    out.push(state.id, ...dependentsOf(tickets, otherId, seen));
  }
  return out;
}

// --------------------------------------------------------------------------------------------
// rendering
// --------------------------------------------------------------------------------------------

/**
 * One table cell. `|` is escaped (lib/board.mjs `splitRow` unescapes it) and every newline is
 * collapsed to a space: a multi-line title used to emit extra lines INSIDE the ticket table, and
 * the parser read each one as another row — phantom tickets, forged by a title.
 */
const CELL = (value) => {
  const text = String(value ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
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
      // The static-only fact rides in the Status cell because that is the cell every human and
      // every reader looks at, and a ticket whose tests never ran must not read as plain `qa`.
      // lib/board.mjs splits the suffix back off, so board-doctor still sees a valid status and
      // every existing check keeps working on the generated board unchanged.
      t.verifiedStatic ? `${t.status} (static only)` : t.status,
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
  key,
  legalEvents,
  parseEventLog,
  reduce,
  validate,
  chainHash,
  verifyChain,
  dependentsOf,
  renderBoard,
  deriveMetrics,
};
