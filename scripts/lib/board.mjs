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

/**
 * Statuses where the sprint loop can still act on the ticket.
 *
 * `qa`/`done` are terminal and `blocked` is already surfaced by its own checks, so a rule about
 * "what should happen next" must not fire on them. The review-cycle cap did, and a ticket that
 * legitimately spent its two cycles and then merged stayed flagged as a BLOCKING anomaly forever —
 * the pre-spawn gate went permanently red on any sprint that had ever used its review budget.
 */
const ACTIVE_STATUS = new Set(['todo', 'in_progress', 'review']);

/**
 * Statuses that mean "this sprint is not finished". Used by the ship gate.
 *
 * `blocked` belongs here: a blocked ticket is unfinished work with a reason attached, not an
 * exemption. Leaving it out let a sprint with a blocked ticket ship silently.
 */
const IN_FLIGHT_STATUS = new Set([...ACTIVE_STATUS, 'blocked']);
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

/**
 * Locate the TICKET table in the file and return its rows keyed by canonical column name.
 *
 * "First pipe table with an id-ish header" is not the same thing, and the difference is a live
 * defect: `Ticket` aliases to `id`, so a board whose review ledger is written above the ticket
 * table parsed the LEDGER as the board — every ticket vanished and the doctor reported a clean
 * sprint. Anchor on the columns only the ticket table has (status + owner) so the ledger, the
 * message ledger and any other id-bearing table can never be mistaken for it.
 *
 * A board whose Status column is absent or renamed therefore yields NO rows. That is deliberate:
 * callers must treat "no ticket table" as "cannot evaluate", never as "nothing to report".
 */
function parseBoard(text) {
  const lines = text.split(/\r?\n/);
  let header = null;
  let headerIndex = -1;

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes('|')) continue;
    if (!isSeparatorRow(lines[i + 1])) continue;
    const cells = splitRow(lines[i]);
    if (!cells.some((cell) => normalizeHeader(cell) === 'id' || /^app-?nnn$/i.test(cell))) continue;
    const canonical = cells.map((cell) => HEADER_ALIASES[normalizeHeader(cell)] || normalizeHeader(cell));
    if (!canonical.includes('status') || !canonical.includes('owner')) continue;
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
    // `qa (static only)` — the renderer's marker for a ticket verified without running its test
    // suite. Split it back into a plain status plus a flag: every downstream check (status_invalid,
    // POST_REVIEW_STATUS, the ship gate) keys on the bare word and would otherwise read a legally
    // generated board as malformed. A hand-written board that never carries the suffix is untouched.
    if (/\(static only\)/i.test(record.status || '')) {
      record.status = record.status.replace(/\s*\(static only\)\s*/i, '').trim();
      record.staticOnly = true;
    }
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

/**
 * Ticket IDs are `<PREFIX>-<NUMBER>` with an optional trailing word — the bug-intake convention in
 * agents/tech-manager.md mandates `BUG-NNN-fix`. Without the suffix group this truncated
 * `BUG-001-fix` to `BUG-001` and then reported `dependency_missing` against a ticket that was
 * sitting right there on the board. Found by running the bug loop for the first time.
 */
function parseDependencies(cell) {
  if (isEmpty(cell)) return [];
  return (cell.match(/[A-Za-z]+-\d+(?:-[A-Za-z]+)?/g) || []).map((id) => id.toUpperCase());
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
  ACTIVE_STATUS,
  IN_FLIGHT_STATUS,
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

/**
 * Parse the team message ledger — `docs/team/messages.md`, a sibling of the board.
 *
 * `team-protocol` claimed board-doctor checked the anti-ping-pong limits and reported unanswered
 * questions. It read neither: the doctor had never opened this file. Two asserted gates that did
 * not run — the same defect as a Definition of Done citing a script nobody can find.
 */
export function parseMessages(text) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes('|') || isSeparatorRow(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 6) continue;
    const [timestamp, from, to, ticketId, kind, summary, body] = cells;
    if (!/^\d{4}-\d{2}-\d{2}/.test(timestamp.trim())) continue;
    entries.push({
      _line: i + 1,
      timestamp: timestamp.trim(),
      from: from.trim(),
      to: to.trim(),
      ticketId: ticketId.trim(),
      kind: kind.trim().toLowerCase(),
      summary: summary.trim(),
      // The Body column was parsed off and thrown away, so every reader saw a one-line ledger while
      // team-message.sh had been writing the detail all along. The dashboard needs it: the artifact
      // an answer was folded into is named in the body, and without it every answered question read
      // as "delivered nowhere".
      body: (body || '').trim(),
    });
  }
  return entries;
}

const RESOLVING_KINDS = new Set(['answer', 'decision']);

/**
 * Pair a ticket's questions with the resolutions that closed them.
 *
 * board-doctor pairs questions and resolutions BY COUNT on a ticket, so every reader must resolve to
 * the same number or the renderer and the validator disagree about one ledger. Counting alone cannot
 * NAME a row, and both tech-lead (which must answer the specific question) and the dashboard (which
 * must show question → answer → the artifact it was folded into) need the pairing itself. Oldest
 * first: each `answer`/`decision` closes the earliest still-open question on that ticket, so
 * `open.length` is exactly doctor's `questions.length - resolutions.length`.
 *
 * Lives here, not in a renderer, because it was written twice the moment a second consumer wanted
 * it — which is how the two readings of one board this file's header warns about begin.
 */
export function pairQuestions(thread) {
  const open = [];
  const answered = [];
  for (const m of thread) {
    if (m.kind === 'question') open.push(m);
    else if (RESOLVING_KINDS.has(m.kind)) {
      const question = open.shift();
      if (question) answered.push({ question, resolution: m });
    }
  }
  return { open, answered };
}

export const openQuestions = (thread) => pairQuestions(thread).open;

/**
 * Definition of Ready — is this ticket workable, or will the developer have to guess?
 *
 * board-doctor checked that a row was structurally valid; nothing checked it was *answerable*. A
 * ticket whose acceptance criteria do not state a verifiable outcome forces the developer to invent
 * one — observed live: an export ticket said nothing about the empty-list case, the developer
 * decided alone, and it shipped on an unconfirmed assumption nobody had approved.
 *
 * Deliberately weak signals, reported as warnings. The aim is to make a vague ticket visible at
 * planning time, not to block on prose style.
 */
const VAGUE_ACCEPTANCE = /^(tbd|todo|as discussed|see prd|same as|obvious|n\/a|—|-)?$/i;

export function checkReadiness(row) {
  const problems = [];
  const acceptance = (row.acceptance || '').trim();
  const spec = (row.spec || '').trim();

  if (VAGUE_ACCEPTANCE.test(acceptance) || acceptance.length < 15) {
    problems.push('acceptance criteria are missing or too thin to verify');
  } else if (!/\b(given|when|then|should|must|appears|returns|rejects|shows)\b/i.test(acceptance)) {
    problems.push('acceptance criteria state no observable outcome — nothing to test against');
  }
  if (VAGUE_ACCEPTANCE.test(spec)) {
    problems.push('no spec anchor, so the developer has nowhere to read the intent');
  }
  return problems;
}

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
