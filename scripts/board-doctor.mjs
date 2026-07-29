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
import { resolve } from 'node:path';

const KNOWN_OWNERS = new Set([
  'ios-developer',
  'android-developer',
  'backend-developer',
  'monetization-engineer',
  'ux-designer',
  'qa-engineer',
  'devops-engineer',
  'data-analyst',
  'aso-specialist',
  'security-reviewer',
  'release-manager',
  'code-reviewer',
  'tech-lead',
  'tech-manager',
]);

const VALID_STATUS = new Set(['todo', 'in_progress', 'review', 'qa', 'done', 'blocked']);
const POST_REVIEW_STATUS = new Set(['qa', 'done']);
const LEDGER_ACTIONS = new Set(['requested', 'started', 'changes', 'approved', 'merged']);
const MAX_REVIEW_CYCLES = 2;
const EMPTY_CELL = new Set(['', '-', '—', '–', 'n/a', 'none', 'tbd']);

// --------------------------------------------------------------------------------------------
// parsing
// --------------------------------------------------------------------------------------------

function splitRow(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

const isSeparatorRow = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

function normalizeHeader(cell) {
  return cell.toLowerCase().replace(/[^a-z]/g, '');
}

const HEADER_ALIASES = {
  id: 'id',
  ticket: 'id',
  ticketid: 'id',
  feature: 'feature',
  f: 'feature',
  title: 'title',
  owner: 'owner',
  reviewer: 'reviewer',
  status: 'status',
  cycles: 'cycles',
  dependson: 'dependsOn',
  depends: 'dependsOn',
  dependencies: 'dependsOn',
  estimate: 'estimate',
  spec: 'spec',
  acceptance: 'acceptance',
  notes: 'notes',
};

/** Locate the widest pipe table in the file and return its rows keyed by canonical column name. */
function parseBoard(text) {
  const lines = text.split(/\r?\n/);
  let header = null;
  let headerIndex = -1;

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes('|')) continue;
    if (!isSeparatorRow(lines[i + 1])) continue;
    const cells = splitRow(lines[i]);
    if (!cells.some((cell) => normalizeHeader(cell) === 'id' || /^app-?nnn$/i.test(cell))) continue;
    header = cells;
    headerIndex = i;
    break;
  }

  if (!header) return { rows: [], columns: [], headerIndex: -1 };

  const columns = header.map((cell) => HEADER_ALIASES[normalizeHeader(cell)] || normalizeHeader(cell));
  const rows = [];

  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes('|')) {
      if (line.trim() === '') continue;
      break; // table ended
    }
    if (isSeparatorRow(line)) continue;
    const cells = splitRow(line);
    const record = { _line: i + 1, _cellCount: cells.length };
    columns.forEach((name, index) => {
      record[name] = (cells[index] ?? '').replace(/`/g, '').trim();
    });
    // Skip the format-example row some boards carry (APP-NNN / F-NNN placeholders).
    if (/^APP-?NNN$/i.test(record.id || '')) continue;
    if (!record.id) continue;
    rows.push(record);
  }

  return { rows, columns, headerIndex };
}

/**
 * Review ledger: append-only lines under a "## Review ledger" heading.
 *   <iso-ts> | APP-001 | requested | android-developer -> code-reviewer
 *   <iso-ts> | APP-001 | changes   | code-reviewer
 *   <iso-ts> | APP-001 | approved  | code-reviewer
 */
function parseLedger(text) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  let inLedger = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*#{1,6}\s/.test(line)) {
      inLedger = /review\s+ledger/i.test(line);
      continue;
    }
    if (!inLedger) continue;
    if (!line.includes('|')) continue;
    if (isSeparatorRow(line)) continue;

    const cells = splitRow(line);
    if (cells.length < 3) continue;
    const [timestamp, ticketId, rawAction, ...rest] = cells;
    const action = rawAction.toLowerCase().trim();
    if (!LEDGER_ACTIONS.has(action)) continue;
    if (!/^[A-Za-z]+-\d+/.test(ticketId)) continue;

    const actorField = (rest[0] || '').trim();
    const arrow = actorField.split(/\s*(?:->|→)\s*/);
    entries.push({
      _line: i + 1,
      timestamp: timestamp.trim(),
      ticketId: ticketId.trim(),
      action,
      from: (arrow[0] || '').trim(),
      to: (arrow[1] || '').trim(),
      raw: line.trim(),
    });
  }

  return entries;
}

// --------------------------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------------------------

const isEmpty = (value) => EMPTY_CELL.has((value ?? '').trim().toLowerCase());

function parseDependencies(cell) {
  if (isEmpty(cell)) return [];
  return (cell.match(/[A-Za-z]+-\d+/g) || []).map((id) => id.toUpperCase());
}

/** Walk the dependency graph from `id`; returns the first blocking reason found, or null. */
function findBlockingAncestor(id, rowsById, seen = new Set()) {
  if (seen.has(id)) return null;
  seen.add(id);

  for (const depId of parseDependencies(rowsById.get(id)?.dependsOn)) {
    const dep = rowsById.get(depId);
    if (!dep) continue; // reported separately as dependency_missing
    if (dep.status === 'blocked') return { via: depId, reason: 'blocked' };
    const deeper = findBlockingAncestor(depId, rowsById, seen);
    if (deeper) return { via: depId, reason: `blocked via ${deeper.via}` };
  }
  return null;
}

function detectCycle(id, rowsById, stack = []) {
  if (stack.includes(id)) return [...stack.slice(stack.indexOf(id)), id];
  const nextStack = [...stack, id];
  for (const depId of parseDependencies(rowsById.get(id)?.dependsOn)) {
    if (!rowsById.has(depId)) continue;
    const cycle = detectCycle(depId, rowsById, nextStack);
    if (cycle) return cycle;
  }
  return null;
}

// --------------------------------------------------------------------------------------------
// the cascade
// --------------------------------------------------------------------------------------------

/**
 * Precedence-ordered. The first structural problem on a row suppresses the derived ones —
 * an invalid owner makes "who acts next" unanswerable, so we do not also guess about review.
 */
function diagnose(board, ledger, capabilities) {
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
  for (const entry of ledger) {
    const id = entry.ticketId.toUpperCase();
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

      if (effectiveCycles >= MAX_REVIEW_CYCLES && row.status !== 'blocked') {
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

  const result = diagnose(board, ledger, capabilities);
  if (!options.quiet || result.anomalies.length > 0) report(result, board, capabilities, options);
  process.exit(result.anomalies.length > 0 ? 1 : 0);
}

main();
