#!/usr/bin/env node
/**
 * board-doctor — validate docs/31-board.md before any agent is spawned.
 *
 * The board is the team's only memory across agent invocations. Every row is written by an LLM
 * editing a Markdown table, so the board can drift into states the sprint loop cannot see:
 * a ticket whose dependency is permanently blocked is never "ready", never in review/qa, and
 * therefore never reported — the loop exits and prints a successful sprint summary.
 *
 * This script makes those states loud. Exit code 1 = do not spawn anyone.
 *
 * Usage:
 *   node scripts/board-doctor.mjs [path/to/31-board.md] [--json] [--quiet]
 *
 * Exit codes:
 *   0  board is coherent (or has warnings only)
 *   1  one or more anomalies — the sprint loop must not proceed
 *   2  board file missing or no parseable table
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

import {
  KNOWN_OWNERS,
  BUILD_SPAWNABLE_OWNERS,
  VALID_STATUS,
  ACTIVE_STATUS,
  POST_REVIEW_STATUS,
  MAX_REVIEW_CYCLES,
  LEDGER_ACTIONS,
  parseBoard,
  parseLedger,
  parseMessages,
  checkReadiness,
  isEmpty,
  parseDependencies,
  findBlockingAncestor,
  detectCycle,
  normalizeId,
  hasShipped,
} from './lib/board.mjs';
import {
  parseMessageLog,
  migrate as migrateMessages,
  threads as messageThreads,
  pairQuestions,
  openFollowUps,
  auditGuards,
  undeliveredAnswers,
  expiredWaivers,
  staleAssumptions,
  MAX_PAIR,
  MAX_CHAIN,
  MAX_PER_TICKET,
} from './lib/messages.mjs';
import { parseEventLog, reduce as reduceEvents } from './lib/events.mjs';
// --------------------------------------------------------------------------------------------
// the cascade
// --------------------------------------------------------------------------------------------

/**
 * Precedence-ordered. The first structural problem on a row suppresses the derived ones —
 * an invalid owner makes "who acts next" unanswerable, so we do not also guess about review.
 */
/**
 * Team-message checks. `team-protocol` promises these; until now nothing performed them.
 * An unanswered question is how a developer ends up guessing, and the guess ships.
 */
/**
 * Team-channel checks.
 *
 * The guard windows are NOT restated here any more. They lived in three files — this one,
 * team-message.sh and messages-render.mjs — and two of them disagreed about what a breach was: the
 * script counted pairs over the trailing 40 rows and refused a chain at >=4 roles, the doctor
 * counted the whole ledger and warned at >4. A ledger the script had happily written was reported
 * as a breach, and a real breach the script refused was invisible to the doctor. One implementation,
 * in lib/messages.mjs; this is its audit caller, team-message.sh is its send caller.
 *
 * `messages` here are schema-v1 events, not Markdown rows: the source of truth is
 * docs/team/messages.jsonl and the Markdown is a rendering of it.
 */
function diagnoseMessages(messages, rowsById, warnings) {
  for (const [ticketId, thread] of messageThreads(messages)) {
    // Ticketless rows (`--ticket -`) are broadcast chatter, not a thread. Bucketing them together
    // collapsed every unrelated FYI into one pseudo-ticket that tripped the chain-depth warning on
    // a team that had done nothing wrong — and the send guard already exempts them, so the doctor
    // was flagging sends the CLI itself permits.
    if (ticketId === '(no ticket)') continue;

    // Pair by COUNT, not existence. "Any answer resolves any question" is a false negative the
    // moment a ticket carries two questions, or one unrelated decision: observed live, a
    // `decision` row correcting a tooling mistake made a genuinely open product question look
    // resolved. One resolution closes one question — anything else is still open.
    const { open } = pairQuestions(thread);
    const followUps = openFollowUps(thread);
    const questions = thread.filter((m) => m.kind === 'question');
    const row = rowsById.get(normalizeId(ticketId));

    if (open.length > 0) {
      const last = open[open.length - 1];
      warnings.push({
        code: 'question_unanswered',
        ticketId,
        line: last._line,
        detail: `${open.length} of ${questions.length} question(s) on this ticket are unresolved — most recent: "${last.summary}" (asked of ${last.to.join(', ')}). ${
          hasShipped(row)
            ? `The ticket has already reached "${row.status}" — it shipped on an unconfirmed assumption.`
            : 'The owner is deciding without it.'
        }`,
        action: 'tech-manager: answer it, route it, or record a decision. An open question is how a guess becomes shipped behaviour.',
      });
    }
    for (const followUp of followUps.filter((m) => m.kind !== 'question')) {
      warnings.push({
        code: 'follow_up_unresolved',
        ticketId,
        line: followUp._line,
        detail: `${followUp.id} is an unresolved ${followUp.kind} from ${followUp.from} to ${followUp.to.join(', ')}: "${followUp.summary}". It declared a follow-up obligation, but no later answer or decision delivered it.`,
        action: 'tech-manager: deliver the handoff/blocker/escalation, record the resulting artifact or transition, or escalate it explicitly.',
      });
    }
  }

  // The send guard refuses the message; this catches a log written by hand or migrated around it.
  const DETAIL = {
    message_pair_exceeded: (b) =>
      `${b.pair} exchanged ${b.count} messages on ${b.ticket} (limit ${MAX_PAIR} without a third party). Two is a conversation; more is a stall.`,
    message_chain_too_deep: (b) =>
      `${b.ticket} has involved ${b.count} roles (limit ${MAX_CHAIN}). A question relayed that far is an escalation.`,
    ticket_budget_exceeded: (b) =>
      `${b.ticket} has spent ${b.count} messages (budget ${MAX_PER_TICKET}). A ticket that needs another message needs a decision.`,
    duplicate_question: (b) =>
      `${b.id} re-asks what ${b.of} already asked on ${b.ticket}: "${b.summary}". Re-asking is not escalation; it produces a second unanswered question.`,
  };
  for (const breach of auditGuards(messages)) {
    warnings.push({
      code: breach.code,
      ticketId: breach.ticket,
      line: 0,
      detail: DETAIL[breach.code](breach),
      action: 'tech-manager: resolve it or escalate. Do not let the thread keep going.',
    });
  }

  // DR4-006: a closed ledger is not delivery. Every question answered still means nothing changed
  // if no answer names where it was folded in.
  for (const m of undeliveredAnswers(messages)) {
    warnings.push({
      code: 'answer_not_delivered',
      ticketId: m.ticket,
      line: m._line,
      detail: `${m.id} (${m.kind}, ${m.from} → ${m.to.join(', ')}) closed "${m.summary}" without naming an artifact or a state transition. The ledger reads resolved; nothing downstream was changed.`,
      action: 'Name the spec, ADR or ticket transition it was folded into. An answer that lives only in the channel is an answer nobody can act on.',
    });
  }

  // An expiry that passed with nobody noticing is a permanent exemption granted by accident.
  for (const m of expiredWaivers(messages)) {
    warnings.push({
      code: 'waiver_expired',
      ticketId: m.ticket,
      line: m._line,
      detail: `${m.artifact} expired on ${m.expires} and is still on the log: "${m.summary}".`,
      action: 'Renew it with a new expiry and a stated reason, or close the exemption and fix the thing it excused.',
    });
  }
  for (const m of staleAssumptions(messages)) {
    warnings.push({
      code: 'assumption_unvalidated',
      ticketId: m.ticket,
      line: m._line,
      detail: `${m.artifact} was due for validation on ${m.validate_by} (owner ${m.owner || 'unset'}, confidence ${m.confidence || 'unstated'}): "${m.summary}".`,
      action: 'Validate it or restate it. An assumption past its date is a belief with a timestamp.',
    });
  }
}

/**
 * Read the team channel next to the board. The JSONL is the source of truth; a project that has only
 * the Markdown ledger is migrated IN MEMORY so it keeps working unchanged — the doctor is a
 * read-only tool and must never be the thing that rewrites a project's files.
 */
function readChannel(boardPath) {
  const dir = join(dirname(boardPath), 'team');
  const jsonl = join(dir, 'messages.jsonl');
  if (existsSync(jsonl)) return parseMessageLog(readFileSync(jsonl, 'utf8'));
  const md = join(dir, 'messages.md');
  if (!existsSync(md)) return { messages: [], errors: [] };
  return { messages: migrateMessages(readFileSync(md, 'utf8'), { parseMessages }), errors: [] };
}

function diagnose(board, ledger, capabilities, messages = []) {
  const anomalies = [];
  const warnings = [];
  const rowsById = new Map();
  const seenIds = new Set();

  // A board written before the review ledger existed cannot answer review-integrity questions.
  // Structural checks still apply to every board; review checks degrade to warnings so the
  // doctor never hard-blocks a project purely for predating this feature.
  const reviewChecksBlock = capabilities.hasReviewColumns && capabilities.hasLedger;
  const pushReview = (item) => (reviewChecksBlock ? anomalies : warnings).push(item);

  const expectedCells = board.columns.length;

  for (const row of board.rows) {
    const id = normalizeId(row.id);
    if (seenIds.has(id)) {
      anomalies.push({
        code: 'duplicate_id',
        ticketId: id,
        line: row._line,
        detail: `Ticket ${id} appears more than once on the board.`,
        action: 'tech-manager: delete or renumber the duplicate row.',
      });
      continue;
    }
    seenIds.add(id);
    rowsById.set(id, { ...row, id, status: (row.status || '').toLowerCase().trim() });
  }

  // Parallel worktrees isolate branches, not merge conflicts. If two in-progress tickets name the
  // same primary file, the work must be serialized even though spawn-gate correctly allows both
  // worktrees. The file scope is conventionally recorded in the spec or notes column; absence of a
  // scope is not guessed into a collision, it remains the tech-manager's planning responsibility.
  const fileOwners = new Map();
  for (const row of rowsById.values()) {
    if (row.status !== 'in_progress') continue;
    const text = Object.values(row).filter((value) => typeof value === 'string').join(' ');
    const match = /primary file:\s*(\S+)/i.exec(text);
    if (!match) continue;
    const file = match[1].trim();
    if (!fileOwners.has(file)) fileOwners.set(file, []);
    fileOwners.get(file).push(row);
  }
  for (const [file, owners] of fileOwners) {
    if (owners.length < 2) continue;
    for (const row of owners) {
      anomalies.push({
        code: 'shared_file_collision',
        ticketId: row.id,
        line: row._line,
        detail: `${owners.map((other) => other.id).join(' and ')} are both in progress and name ${file} as their primary file. Parallel worktrees do not prevent a merge collision.`,
        action: 'tech-manager: serialize these tickets or split the file scope before spawning both writers.',
      });
    }
  }

  const ledgerByTicket = new Map();
  for (const [index, entry] of ledger.entries()) {
    const id = normalizeId(entry.ticketId);

    if (!entry.known) {
      // The ledger is append-only, so a bad line can never be removed. A strict parser plus an
      // immutable log therefore needs a supersede path, or one typo blocks the board forever.
      // A later valid entry for the same ticket IS the correction: the record has been repaired,
      // so the bad row drops to a warning that keeps the mistake visible without gating on it.
      const superseded = ledger
        .slice(index + 1)
        .some((later) => later.known && normalizeId(later.ticketId) === id);

      (superseded ? warnings : anomalies).push({
        code: superseded ? 'ledger_action_unknown_superseded' : 'ledger_action_unknown',
        ticketId: id,
        line: entry._line,
        detail: superseded
          ? `Review ledger line uses the non-canonical action "${entry.action}", but a later valid entry for ${id} supersedes it. Left visible because the ledger is append-only; no action needed.`
          : `Review ledger uses action "${entry.action}", which is not one of: ${[...LEDGER_ACTIONS].join(', ')}. The verdict it records is invisible to every mechanical check — cycle counts and the approval requirement both silently ignore it.`,
        action: superseded
          ? 'None — the record was repaired by a later line.'
          : 'Append a corrected line using the exact vocabulary (never edit the wrong one — the ledger is append-only).',
      });
      continue;
    }

    if (!ledgerByTicket.has(id)) ledgerByTicket.set(id, []);
    ledgerByTicket.get(id).push(entry);
    if (!rowsById.has(id)) {
      warnings.push({
        code: 'orphan_ledger_entry',
        ticketId: id,
        line: entry._line,
        detail: `Review ledger references ${id}, which has no board row.`,
        action: 'tech-manager: restore the row, or leave it if the ticket was intentionally removed.',
      });
    }
  }

  for (const row of rowsById.values()) {
    const push = (code, detail, action) =>
      anomalies.push({ code, ticketId: row.id, line: row._line, detail, action });

    // --- structural -------------------------------------------------------------------------
    if (expectedCells && row._cellCount !== expectedCells) {
      push(
        'malformed_row',
        `Row has ${row._cellCount} cells; the header declares ${expectedCells}.`,
        'tech-manager: repair the row so its cell count matches the header.'
      );
      continue;
    }

    if (!VALID_STATUS.has(row.status)) {
      push(
        'status_invalid',
        `Status "${row.status || '(empty)'}" is not one of: ${[...VALID_STATUS].join(', ')}.`,
        'tech-manager: set a valid status.'
      );
      continue;
    }

    // --- ownership --------------------------------------------------------------------------
    if (isEmpty(row.owner)) {
      push('owner_missing', 'Ticket has no owner, so it can never become ready.', 'tech-manager: assign an owner.');
      continue;
    }
    if (!KNOWN_OWNERS.has(row.owner.toLowerCase())) {
      push(
        'owner_invalid',
        `Owner "${row.owner}" is not a known role.`,
        'tech-manager: reassign to a role listed in the roster.'
      );
      continue;
    }

    // A valid role the build loop cannot spawn is a ticket nobody will ever pick up. It is not
    // blocked and not ready, so — exactly like a stranded dependency — the loop drains around it
    // and reports the sprint complete. /app-audit files these routinely.
    if (row.status !== 'done' && !BUILD_SPAWNABLE_OWNERS.has(row.owner.toLowerCase())) {
      push(
        'owner_not_spawnable',
        `Owner "${row.owner}" is a real role but /app-build never spawns it to work a ticket, so this ticket will never be picked up and never reported.`,
        'tech-manager: reassign to a role the build loop spawns, or work it outside the sprint loop and mark it done.'
      );
      continue;
    }

    // --- dependency graph -------------------------------------------------------------------
    const deps = parseDependencies(row.dependsOn);
    let dependencyBroken = false;

    if (deps.includes(row.id)) {
      push('dependency_self', 'Ticket depends on itself.', 'tech-manager: remove the self-dependency.');
      dependencyBroken = true;
    }

    for (const depId of deps) {
      if (!rowsById.has(depId)) {
        push(
          'dependency_missing',
          `Depends on ${depId}, which has no board row.`,
          'tech-manager: restore the dependency or drop it from Depends on.'
        );
        dependencyBroken = true;
      }
    }

    const cycle = detectCycle(row.id, rowsById);
    if (cycle) {
      push(
        'dependency_cycle',
        `Dependency cycle: ${cycle.join(' -> ')}.`,
        'tech-manager: break the cycle — one of these edges is wrong.'
      );
      dependencyBroken = true;
    }

    // --- the silent-stranding defect --------------------------------------------------------
    // A todo row behind a blocked dependency is never "ready", never in review/qa, and so the
    // /app-build loop terminates and prints a successful sprint summary without mentioning it.
    if (!dependencyBroken && row.status === 'todo') {
      const blocker = findBlockingAncestor(row.id, rowsById);
      if (blocker) {
        push(
          'stranded',
          `Waiting on ${blocker.via}, which is ${blocker.reason}. The sprint loop cannot see this ticket and will report the sprint complete without it.`,
          'tech-manager: unblock the dependency, re-scope this ticket, or mark it blocked so it is reported.'
        );
      }
    }

    // --- definition of ready ------------------------------------------------------------------
    // Only for work not yet started: a vague ticket is a planning problem, and once it is in
    // review the question has already been answered one way or another.
    if (row.status === 'todo') {
      for (const problem of checkReadiness(row)) {
        warnings.push({
          code: 'not_ready',
          ticketId: row.id,
          line: row._line,
          detail: `${problem}. A developer given this will decide alone, and the decision ships.`,
          action: 'tech-manager/cpo: sharpen it before the ticket is picked up, or expect an assumption in its place.',
        });
      }
    }

    // --- review integrity -------------------------------------------------------------------
    const entries = ledgerByTicket.get(row.id) || [];
    const approvals = entries.filter((entry) => entry.action === 'approved');
    const changeRequests = entries.filter((entry) => entry.action === 'changes');
    const reviewerCell = (row.reviewer || '').toLowerCase();

    if (row.status === 'review' && isEmpty(row.reviewer)) {
      pushReview({
        code: 'reviewer_missing',
        ticketId: row.id,
        line: row._line,
        detail: capabilities.hasReviewColumns
          ? 'Ticket is in review with no reviewer recorded.'
          : 'Ticket is in review and the board has no Reviewer column, so self-review cannot be detected.',
        action: capabilities.hasReviewColumns
          ? 'tech-manager: record the reviewer, or move the row back to in_progress.'
          : 'tech-manager: migrate the board to the Reviewer + Cycles columns (see sprint-planner).',
      });
    }

    // Self-review is always blocking wherever it is actually detectable — it is never acceptable,
    // and unlike the other review checks it needs no ledger to prove.
    if (!isEmpty(row.reviewer) && reviewerCell === row.owner.toLowerCase()) {
      push(
        'self_review',
        `Reviewer "${row.reviewer}" is the same role as the owner.`,
        'tech-manager: assign a different reviewer. A role never gates its own work.'
      );
    }

    // Evaluate the EFFECTIVE approval state, not every line in isolation. The ledger is append-only
    // and LEDGER_ACTIONS has no void/supersede verb, so the prescribed remediation ("void the
    // approval") was literally impossible to carry out — a mistaken owner-approval, later corrected
    // by a genuine reviewer approval, flagged as a blocking anomaly forever with no legal way to
    // clear it. Same shape as the unknown-action case above, and the same fix: a later valid entry
    // IS the correction. An owner-approval with no legitimate approval after it is still blocking.
    for (const [i, entry] of approvals.entries()) {
      if (!entry.from || entry.from.toLowerCase() !== row.owner.toLowerCase()) continue;
      const superseded = approvals
        .slice(i + 1)
        .some((later) => later.from && later.from.toLowerCase() !== row.owner.toLowerCase());

      (superseded ? warnings : anomalies).push({
        code: superseded ? 'self_review_superseded' : 'self_review',
        ticketId: row.id,
        line: entry._line,
        detail: superseded
          ? `Review ledger records an approval by the owner (${entry.from}), but a later approval by a different role supersedes it. Left visible because the ledger is append-only; no action needed.`
          : `Review ledger records an approval by the owner (${entry.from}), and no later approval by a different role supersedes it.`,
        action: superseded
          ? 'None — the record was repaired by a later, legitimate approval.'
          : 'Append a fresh approval from a different role (never edit the wrong line — the ledger is append-only). Until then this ticket has not been reviewed.',
      });
    }

    // An INFERRED approval is not evidence of a review. `board.mjs migrate` reconstructs one for
    // any row it finds already sitting in qa/done, stamps it `provenance: inferred`, and prints
    // "this is not evidence that a review happened" in its own report — then the renderer wrote it
    // into the ledger looking exactly like a real approval, and this check counted it. A migration
    // could therefore manufacture the approval that lets a ticket merge.
    const evidencedApprovals = approvals.filter((entry) => !entry.inferred);
    if (POST_REVIEW_STATUS.has(row.status) && approvals.length > 0 && evidencedApprovals.length === 0) {
      pushReview({
        code: 'approval_inferred_only',
        ticketId: row.id,
        line: approvals[0]._line,
        detail:
          `Every approval for this ticket was RECONSTRUCTED by \`board.mjs migrate\` (timestamp "inferred"), not recorded by a reviewer. ` +
          'The migration says so about itself; the ledger row does not, and it reads like a real approval.',
        action:
          'code-reviewer: review the ticket and record it (`board.mjs move <ID> approved --by code-reviewer`). Until then this ticket has not been reviewed.',
      });
    }

    if (POST_REVIEW_STATUS.has(row.status) && approvals.length === 0) {
      pushReview({
        code: 'done_without_review',
        ticketId: row.id,
        line: row._line,
        detail: capabilities.hasLedger
          ? `Status is "${row.status}" but the review ledger has no approval for this ticket.`
          : `Status is "${row.status}" and the board has no review ledger, so the approval cannot be evidenced.`,
        action: capabilities.hasLedger
          ? 'tech-manager: move it back to review, or append the missing ledger line if the review did happen.'
          : 'tech-manager: add a "## Review ledger" section (see sprint-planner) — future tickets will be checkable.',
      });
    }

    // --- review-cycle cap -------------------------------------------------------------------
    const cyclesCell = (row.cycles ?? '').trim();
    const cycles = Number.parseInt(cyclesCell, 10);

    if (cyclesCell !== '' && !isEmpty(cyclesCell) && Number.isNaN(cycles)) {
      push(
        'cycles_invalid',
        `Cycles column is "${cyclesCell}", which is not a number.`,
        'tech-manager: set Cycles to an integer.'
      );
    } else {
      const effectiveCycles = Number.isNaN(cycles) ? 0 : cycles;

      // SEMANTICS, stated so this cannot drift again: `Cycles` counts REQUEST CHANGES verdicts
      // already recorded. /app-build allows 2 review cycles and stops the loop on the THIRD
      // REQUEST CHANGES — so Cycles = 2 is a ticket that has used its whole budget legitimately
      // and may still be worked, and only Cycles > 2 is a breach. `>=` fired at 2 and blocked the
      // second rework the command explicitly permits: the doctor and the command disagreed about
      // the same number, and the doctor won because it is the one with an exit code.
      //
      // Only while the ticket is still being worked. `status !== 'blocked'` meant a ticket that
      // legitimately used its two review cycles and then merged stayed a BLOCKING anomaly for the
      // life of the board, so the pre-spawn gate went permanently red on any real sprint.
      if (effectiveCycles > MAX_REVIEW_CYCLES && ACTIVE_STATUS.has(row.status)) {
        push(
          'cycle_cap_breached',
          `Cycles = ${effectiveCycles} (cap is ${MAX_REVIEW_CYCLES}, breached above it) but status is "${row.status}", not blocked.`,
          'Stop the loop for this ticket, set it blocked, and surface the full reviewer + developer history.'
        );
      }

      if (capabilities.hasLedger && changeRequests.length !== effectiveCycles) {
        warnings.push({
          code: 'ledger_cycle_mismatch',
          ticketId: row.id,
          line: row._line,
          detail: `Cycles column says ${effectiveCycles}; the ledger records ${changeRequests.length} change request(s).`,
          action: 'tech-manager: reconcile — the ledger is the record, the column is the summary.',
        });
      }
    }

    // --- stale review pickup ----------------------------------------------------------------
    const lastEntry = entries[entries.length - 1];
    if (row.status === 'review' && lastEntry && lastEntry.action === 'requested') {
      warnings.push({
        code: 'review_never_started',
        ticketId: row.id,
        line: lastEntry._line,
        detail: 'Review was requested but the reviewer never recorded a start or a verdict.',
        action: 'Re-spawn the reviewer once; if it stalls again, surface to the user.',
      });
    }
  }

  diagnoseMessages(messages, rowsById, warnings);

  return { anomalies, warnings };
}

// --------------------------------------------------------------------------------------------
// reporting
// --------------------------------------------------------------------------------------------

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function report({ anomalies, warnings }, board, capabilities, options) {
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        { ok: anomalies.length === 0, ticketCount: board.rows.length, capabilities, anomalies, warnings },
        null,
        2
      )}\n`
    );
    return;
  }

  const lines = [];
  const render = (title, items) => {
    if (items.length === 0) return;
    const idWidth = Math.max(...items.map((item) => item.ticketId.length), 7);
    const codeWidth = Math.max(...items.map((item) => item.code.length), 4);
    lines.push('', title);
    for (const item of items) {
      lines.push(`  ${pad(item.ticketId, idWidth)}  ${pad(item.code, codeWidth)}  ${item.detail}`);
      lines.push(`  ${' '.repeat(idWidth)}  ${' '.repeat(codeWidth)}  -> ${item.action}`);
    }
  };

  lines.push(`BOARD DOCTOR — ${board.rows.length} ticket(s) checked`);
  if (!capabilities.hasReviewColumns || !capabilities.hasLedger) {
    const missing = [
      capabilities.hasReviewColumns ? null : 'Reviewer/Cycles columns',
      capabilities.hasLedger ? null : 'Review ledger section',
    ].filter(Boolean);
    lines.push(
      `LEGACY BOARD — missing ${missing.join(' and ')}. Structural checks are enforced;`,
      'review-integrity findings are reported as warnings until the board is migrated.'
    );
  }
  render('ANOMALIES (blocking — do not spawn):', anomalies);
  render('WARNINGS (non-blocking):', warnings);

  if (anomalies.length === 0 && warnings.length === 0) {
    lines.push('', 'Board is coherent. Safe to spawn.');
  } else if (anomalies.length === 0) {
    lines.push('', `${warnings.length} warning(s), 0 anomalies. Safe to spawn.`);
  } else {
    lines.push(
      '',
      `${anomalies.length} anomaly(ies) -> tech-manager. Refusing to spawn.`,
      'Fix the board first. Every one of these is a ticket the sprint loop cannot see.'
    );
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

// --------------------------------------------------------------------------------------------

/**
 * The generated view must match the log it was generated from.
 *
 * `project.mjs` now reads the log rather than the Markdown, so a hand-edit can no longer CHANGE
 * what the studio believes. But silently ignoring the edit is its own failure: it means a human or
 * an agent wrote something down and the system quietly discarded it. The three reasons a divergence
 * exists — a confused agent, a hand-edit that lost real work, or tampering — all deserve to be said
 * out loud rather than papered over by the next render.
 *
 * The expected rows are derived from the LOG. Deriving them by re-parsing the same Markdown would
 * make this the checking tool that carries the defect it checks for: it would agree with itself
 * every time.
 */
function reportViewDivergence(boardPath, board) {
  const logPath = join(dirname(boardPath), '31-board-events.jsonl');
  if (!existsSync(logPath)) return false; // legacy hand-written board, nothing to compare against
  let expected;
  try {
    const { events } = parseEventLog(readFileSync(logPath, 'utf8'));
    expected = reduceEvents(events).tickets;
  } catch {
    return false; // an unreadable log is loadLog's exit-2 problem, not a divergence finding
  }
  const drift = [];
  for (const row of board.rows) {
    // The log keys tickets with `key()`, which UPPERCASES. Looking up a lowercased id found
    // nothing and reported every row as "present in the view, absent from the log" — a divergence
    // checker that fires on a correct board is worse than none, because the first thing anyone
    // learns is to ignore it.
    const truth = expected.get(String(normalizeId(row.id)).toUpperCase());
    // A row the log has never heard of is NOT reported. It is what a half-migrated legacy board
    // looks like — the log was started partway through, so early rows exist only in Markdown — and
    // flagging it would make this check fire on projects that have done nothing wrong. The signal
    // worth blocking on is CONTRADICTION: the log and the view describing the same ticket
    // differently. That is also the shape of the attack this check was written for.
    if (!truth) continue;
    const seenStatus = (row.status || '').toLowerCase().trim();
    if (truth.status && seenStatus && truth.status !== seenStatus) {
      drift.push(`${row.id}: view says status "${seenStatus}", log says "${truth.status}"`);
    }
    const seenOwner = isEmpty(row.owner) ? '' : String(row.owner).trim();
    if (truth.owner && seenOwner && truth.owner !== seenOwner) {
      drift.push(`${row.id}: view says owner "${seenOwner}", log says "${truth.owner}"`);
    }
  }
  if (!drift.length) return false;
  process.stderr.write(
    `board-doctor: docs/31-board.md DIVERGES from the event log it is generated from.\n` +
      drift.map((d) => `  ${d}\n`).join('') +
      '  The log is authoritative and nothing reads these edits, so this is not corrupt state —\n' +
      '  but the edit expressed an intention that has been discarded. Two ways forward:\n' +
      `    regenerate the view:  node scripts/board.mjs render\n` +
      '    record the intention: node scripts/board.mjs move <ID> <event> --by <role>\n'
  );
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const options = { json: args.includes('--json'), quiet: args.includes('--quiet') };
  const pathArg = args.find((arg) => !arg.startsWith('--')) || 'docs/31-board.md';
  const boardPath = resolve(process.cwd(), pathArg);

  if (!existsSync(boardPath)) {
    process.stderr.write(`board-doctor: no board at ${boardPath}. Run /app-plan first.\n`);
    process.exit(2);
  }

  const text = readFileSync(boardPath, 'utf8');
  const board = parseBoard(text);

  if (board.rows.length === 0) {
    process.stderr.write(
      `board-doctor: no parseable ticket table in ${boardPath}. Expected a Markdown table with an "ID" column.\n`
    );
    process.exit(2);
  }

  const ledger = parseLedger(text);
  const capabilities = {
    hasReviewColumns: board.columns.includes('reviewer') && board.columns.includes('cycles'),
    hasLedger: /^\s*#{1,6}\s.*review\s+ledger/im.test(text),
  };

  // The team channel is a sibling of the board: docs/31-board.md -> docs/team/messages.jsonl
  const channel = readChannel(boardPath);
  if (channel.errors.length) {
    for (const e of channel.errors) {
      process.stderr.write(`board-doctor: docs/team/messages.jsonl:${e.line}: ${e.reason}\n`);
    }
    // Fail closed, exit 2 — "cannot evaluate", never a pass. A damaged channel rendered as an empty
    // one is a board reported clean because its questions were unreadable.
    process.stderr.write(
      `board-doctor: ${channel.errors.length} unreadable line(s) in the team channel — cannot evaluate.\n`
    );
    process.exit(2);
  }

  // The return value is USED. The first version of this set `process.exitCode` and let the call
  // below run — `process.exit()` overrode it, so the divergence printed and the tool still exited 0
  // and still announced "Board is coherent. Safe to spawn." three lines under its own warning.
  // A finding the final exit discards is not a finding; it is a log line.
  const diverged = reportViewDivergence(boardPath, board);

  const result = diagnose(board, ledger, capabilities, channel.messages);
  if (!options.quiet || result.anomalies.length > 0) report(result, board, capabilities, options);
  if (diverged && !result.anomalies.length) {
    process.stderr.write('board-doctor: refusing to report a coherent board while the view diverges from the log.\n');
  }
  process.exit(result.anomalies.length > 0 || diverged ? 1 : 0);
}

main();
