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
} from './lib/board.mjs';
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
 * Guard windows, kept identical to scripts/team-message.sh (which refuses the send) so the two
 * cannot disagree about what a breach is. They diverged once: the script counted pairs over the
 * trailing 40 rows and refused a chain at >=4 roles, the doctor counted the whole ledger and warned
 * at >4 — so a ledger the script had happily written was reported as a breach, and a real breach
 * the script refused was invisible to the doctor. One window, stated in both files:
 *
 *   window   the whole thread for one ticket, for all time (the ledger is append-only)
 *   pair     at most 2 messages from one role to another on one ticket without a third party
 *   chain    at most 4 distinct roles involved in one ticket's thread
 *
 * `MAX_PER_ROLE` in team-message.sh has no counterpart here on purpose: it is a rate limit on one
 * agent's current turn, not a property of the ledger.
 */
const MAX_PAIR = 2;
const MAX_CHAIN = 4;

function diagnoseMessages(messages, rowsById, warnings) {
  const byTicket = new Map();
  for (const m of messages) {
    // Ticketless rows (`--ticket -`) are broadcast chatter, not a thread. Bucketing them together
    // collapsed every unrelated FYI into one pseudo-ticket that tripped the chain-depth warning on
    // a team that had done nothing wrong — and team-message.sh already exempts them, so the doctor
    // was flagging sends the script itself permits.
    if (isEmpty(m.ticketId)) continue;
    if (!byTicket.has(m.ticketId)) byTicket.set(m.ticketId, []);
    byTicket.get(m.ticketId).push(m);
  }

  for (const [ticketId, thread] of byTicket) {
    // Pair by COUNT, not existence. "Any answer resolves any question" is a false negative the
    // moment a ticket carries two questions, or one unrelated decision: observed live, a
    // `decision` row correcting a tooling mistake made a genuinely open product question look
    // resolved. One resolution closes one question — anything else is still open.
    const questions = thread.filter((m) => m.kind === 'question');
    const resolutions = thread.filter((m) => m.kind === 'answer' || m.kind === 'decision');
    const row = rowsById.get(ticketId.toUpperCase());

    if (questions.length > resolutions.length) {
      const last = questions[questions.length - 1];
      warnings.push({
        code: 'question_unanswered',
        ticketId,
        line: last._line,
        detail: `${questions.length - resolutions.length} of ${questions.length} question(s) on this ticket are unresolved — most recent: "${last.summary}" (asked of ${last.to}). ${
          row && (row.status === 'qa' || row.status === 'done')
            ? `The ticket has already reached "${row.status}" — it shipped on an unconfirmed assumption.`
            : 'The owner is deciding without it.'
        }`,
        action: 'tech-manager: answer it, route it, or record a decision. An open question is how a guess becomes shipped behaviour.',
      });
    }

    // The guard in team-message.sh refuses the send; this catches a ledger written by hand.
    const pairs = new Map();
    for (const m of thread) {
      if (m.kind === 'escalation') continue;
      const key = `${m.from}\u2192${m.to}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
    for (const [pair, count] of pairs) {
      if (count > MAX_PAIR) {
        warnings.push({
          code: 'message_pair_exceeded',
          ticketId,
          line: 0,
          detail: `${pair} exchanged ${count} messages on ${ticketId} (limit ${MAX_PAIR} without a third party). Two is a conversation; more is a stall.`,
          action: 'tech-manager: resolve it or escalate. Do not let the pair keep going.',
        });
      }
    }

    const roles = new Set(thread.flatMap((m) => [m.from, m.to]));
    if (roles.size > MAX_CHAIN) {
      warnings.push({
        code: 'message_chain_too_deep',
        ticketId,
        line: 0,
        detail: `${ticketId} has involved ${roles.size} roles (limit ${MAX_CHAIN}). A question relayed that far is an escalation.`,
        action: 'tech-manager: take the decision rather than relaying it further.',
      });
    }
  }
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
    const id = row.id.toUpperCase();
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

  const ledgerByTicket = new Map();
  for (const [index, entry] of ledger.entries()) {
    const id = entry.ticketId.toUpperCase();

    if (!entry.known) {
      // The ledger is append-only, so a bad line can never be removed. A strict parser plus an
      // immutable log therefore needs a supersede path, or one typo blocks the board forever.
      // A later valid entry for the same ticket IS the correction: the record has been repaired,
      // so the bad row drops to a warning that keeps the mistake visible without gating on it.
      const superseded = ledger
        .slice(index + 1)
        .some((later) => later.known && later.ticketId.toUpperCase() === id);

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

    for (const entry of approvals) {
      if (entry.from && entry.from.toLowerCase() === row.owner.toLowerCase()) {
        anomalies.push({
          code: 'self_review',
          ticketId: row.id,
          line: entry._line,
          detail: `Review ledger records an approval by the owner (${entry.from}).`,
          action: 'tech-manager: void the approval and re-review with a different role.',
        });
      }
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

      // Only while the ticket is still being worked. `status !== 'blocked'` meant a ticket that
      // legitimately used its two review cycles and then merged stayed a BLOCKING anomaly for the
      // life of the board, so the pre-spawn gate went permanently red on any real sprint.
      if (effectiveCycles >= MAX_REVIEW_CYCLES && ACTIVE_STATUS.has(row.status)) {
        push(
          'cycle_cap_breached',
          `Cycles = ${effectiveCycles} (cap is ${MAX_REVIEW_CYCLES}) but status is "${row.status}", not blocked.`,
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

  // The message ledger is a sibling of the board: docs/31-board.md -> docs/team/messages.md
  const messagesPath = join(dirname(boardPath), 'team', 'messages.md');
  const messages = existsSync(messagesPath) ? parseMessages(readFileSync(messagesPath, 'utf8')) : [];

  const result = diagnose(board, ledger, capabilities, messages);
  if (!options.quiet || result.anomalies.length > 0) report(result, board, capabilities, options);
  process.exit(result.anomalies.length > 0 ? 1 : 0);
}

main();
