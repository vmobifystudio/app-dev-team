/**
 * Shared board parsing for scripts/board-doctor.mjs and scripts/board-render.mjs.
 *
 * One parser, deliberately. Two parsers of the same file drift, and a renderer that disagrees with
 * its validator is precisely the "second path to the same data" defect class the defect-hunting
 * skill exists to catch.
 */

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
  'verification-engineer',
  'tech-lead',
  'tech-manager',
]);

/**
 * Roles the /app-build loop can actually spawn to WORK a ticket.
 *
 * A ticket owned by a valid role that the loop cannot spawn is never picked up, is never blocked,
 * and is never reported — the loop drains and prints a successful sprint. Same silent-drop class
 * as a stranded dependency, through a different door. /app-audit hits it directly: it files
 * AUDIT-NNN tickets against monetization / analytics / aso / devops / security findings and then
 * says "remediate via the normal /app-build loop".
 *
 * Keep this in sync with commands/app-build.md step 2 and agents/tech-manager.md's ticket shape.
 */
const BUILD_SPAWNABLE_OWNERS = new Set([
  'ios-developer',
  'android-developer',
  'backend-developer',
  'monetization-engineer',
  'ux-designer',
  'qa-engineer',
  'data-analyst',
  'devops-engineer',
  'aso-specialist',
  'verification-engineer',
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
    if (!/^[A-Za-z]+-\d+/.test(ticketId)) continue;
    // Do NOT drop an unrecognised action. A row that looks like a ledger entry but uses a word
    // outside the vocabulary is a verdict that silently vanishes: observed live, a reviewer wrote
    // `changes-requested` instead of `changes`, the row was filtered out, and the doctor reported
    // the milder "review never started" — misdirecting away from a REQUEST CHANGES that had
    // actually happened. Tag it and let the caller raise it.
    const known = LEDGER_ACTIONS.has(action);

    const actorField = (rest[0] || '').trim();
    const arrow = actorField.split(/\s*(?:->|→)\s*/);
    entries.push({
      _line: i + 1,
      timestamp: timestamp.trim(),
      ticketId: ticketId.trim(),
      action,
      known,
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


export {
  KNOWN_OWNERS,
  BUILD_SPAWNABLE_OWNERS,
  VALID_STATUS,
  POST_REVIEW_STATUS,
  LEDGER_ACTIONS,
  MAX_REVIEW_CYCLES,
  EMPTY_CELL,
  splitRow,
  isSeparatorRow,
  parseBoard,
  parseLedger,
  isEmpty,
  parseDependencies,
  findBlockingAncestor,
  detectCycle,
};

/** Convenience: parse everything a consumer needs from the board file in one pass. */
export function readBoard(text) {
  const board = parseBoard(text);
  return {
    board,
    ledger: parseLedger(text),
    capabilities: {
      hasReviewColumns: board.columns.includes('reviewer') && board.columns.includes('cycles'),
      hasLedger: /^\s*#{1,6}\s.*review\s+ledger/im.test(text),
    },
  };
}
