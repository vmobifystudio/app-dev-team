#!/usr/bin/env node
/**
 * register — the index of everything the studio OWES, with a status that is never blank.
 *
 * THE MEASURED PROBLEM (OPS-004, docs/reviews/2026-08-07-adversarial-operations-review.md).
 * This studio tracks work in eleven places. Nine of them have a CLI, a schema, an append-only log
 * or a validator. The two that do not are `docs/51-bugs.md` and `docs/81-findings.md` — and those
 * two are the ONLY ones that feed work back INTO the loop. Every bug fix and every remediation
 * ticket originates in a hand-edited Markdown table with no writer, no vocabulary and no doctor,
 * while everything downstream of them is rigorously mechanised.
 *
 * The link from a bug to a ticket was prose. `/app-build` step 1: "for every open S1 or S2, ensure a
 * matching BUG-NNN-fix row exists on the board; if not, spawn tech-manager once." Nothing failed if
 * that never happened. A bug with no ticket is invisible to `board-doctor` (it is not a row), to
 * `orchestrator round`, to `/app-build`'s exit check (which accounts for every non-`done` ROW), and
 * to the sprint summary. `tech-manager.md` already records the consequence at scale — "~70 findings
 * were silently skipped in a real programme while four review rounds reported nothing wrong" — and
 * the mechanism that allowed it was still the mechanism in use.
 *
 * THE ONE RULE THAT MAKES THIS WORTH BUILDING, and the one neither Markdown file has ever had:
 *
 *     `register.mjs check` refuses while ANY item lacks a terminal status.
 *
 * It is wired into `ship-gate.sh` and reported by `orchestrator.mjs round`. Deferring an item is
 * fine and expected — `DEFERRED` is terminal — but deferring it is a DECISION with a reason and an
 * author, not an omission. The failure this closes is not "we shipped with known bugs"; it is
 * "nobody could tell whether we had".
 *
 * WHY THIS DOES NOT REPLACE THE BOARD. The board is the STATE MACHINE for tickets and stays exactly
 * as it is. This is the INDEX of what is owed, and a ticket is one thing that can discharge an item.
 * Two mechanisms, two questions: "what may happen to APP-004 next" is the board's; "is there
 * anything nobody has answered for" is this one's. Merging them would give the board a second
 * vocabulary and this file a state machine it does not need.
 *
 * WHY 51-bugs.md AND 81-findings.md SURVIVE. `import-bugs` reads `docs/51-bugs.md` through the same
 * `parseBugs` that `ship-gate.sh` already uses and files anything missing. The Markdown stays a
 * legitimate place for `qa-engineer` to write — it is human-writable, reviewable on a branch, and
 * every existing agent file already points at it. What changes is that it is now a SOURCE that gets
 * imported, not the register itself, so a bug written there can no longer be lost by nobody reading
 * it.
 *
 * Usage:
 *   register.mjs add <ID> --kind bug|finding|risk|assumption --title "..." --by <role>
 *                         [--severity S1..S4] [--owner <role>] [--ticket APP-NNN] [--evidence <path>]
 *   register.mjs status <ID> <STATUS> --by <role> [--reason "..."] [--ticket APP-NNN]
 *   register.mjs link <ID> --ticket APP-NNN --by <role>
 *   register.mjs show [ID] [--json]
 *   register.mjs render [--out docs/90-register.md]
 *   register.mjs check [--json]
 *   register.mjs import-bugs [--bugs docs/51-bugs.md] --by <role>
 *
 * Exit codes:
 *   0  done / CLEAR
 *   1  REFUSED (a write the rules do not allow) or, for `check`, items still owe an answer
 *   2  CANNOT EVALUATE — the register is missing or unreadable. Never an empty register.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { withFileLock } from './lib/atomic.mjs';
import { parseBugs } from './lib/board.mjs';

const die = (code, message) => { process.stderr.write(`register: ${message}\n`); process.exit(code); };

const { flags, positional } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'file', 'out', 'kind', 'title', 'by', 'owner', 'ticket', 'evidence', 'severity', 'reason', 'bugs']),
  die,
});
const [command, subject, argument] = positional;

let ROOT;
if (typeof flags.root === 'string') {
  ROOT = resolve(flags.root);
} else {
  const resolved = resolveProjectRoot({ explicit: typeof flags['project-root'] === 'string' ? flags['project-root'] : '' });
  if (!resolved.ok) die(2, explainRootFailure(resolved));
  ROOT = resolved.root;
}
const FILE = typeof flags.file === 'string' ? resolve(flags.file) : resolve(ROOT, 'docs/90-register.jsonl');

const KINDS = new Set(['bug', 'finding', 'risk', 'assumption']);

/**
 * The vocabulary, and the half of it that matters.
 *
 * TERMINAL means "somebody decided, and said why". It does NOT mean "fixed" — `DEFERRED` and
 * `WRONG-FINDING` are terminal and are the honest outcomes for most audit findings. What is not
 * terminal is `OPEN` and `IN-PROGRESS`: those are the states in which an item is still owed, and
 * they are what `check` refuses to ship on.
 *
 * `WRONG-FINDING` exists because an audit that cannot record "this was not actually a defect" makes
 * every reviewer round up to a fix. It requires a reason for exactly the same reason `DEFERRED`
 * does: without one it is indistinguishable from ignoring the finding.
 */
const OPEN_STATUSES = new Set(['OPEN', 'IN-PROGRESS']);
const TERMINAL_STATUSES = new Set(['FIXED', 'DEFERRED', 'WRONG-FINDING', 'WONTFIX']);
const NEEDS_REASON = new Set(['DEFERRED', 'WRONG-FINDING', 'WONTFIX']);
const ALL_STATUSES = new Set([...OPEN_STATUSES, ...TERMINAL_STATUSES]);

const now = () => new Date().toISOString();
const key = (id) => String(id ?? '').toUpperCase();

/**
 * ONE place that decides whether a terminal status is earned. Returns null when it is, or the
 * reason it is not.
 *
 * WHY THIS IS A FUNCTION AND NOT TWO COPIES OF AN `if`. `cmdStatus` refused a `DEFERRED` with no
 * reason and a `FIXED` with no ticket — and `import-bugs` appended straight to the log, so it was a
 * SECOND WRITE PATH around both. Executed against the canonical row in `agents/qa-engineer.md`, an
 * import produced a `WONTFIX` collapsed to `FIXED` with no reason and a `FIXED` with no ticket:
 * exactly the two states M38 and M39 exist to make impossible, reachable by another door.
 *
 * That is `defect-hunting` §1 — the validation added to one producer while another walks around it
 * — committed inside the file whose whole purpose is that every item has an authored decision.
 */
function terminalRefusal(status, { reason, ticket }) {
  if (NEEDS_REASON.has(status) && (typeof reason !== 'string' || reason.trim().length < 10)) {
    return `${status} requires a reason of substance. Without one it is indistinguishable from ignoring the item, and the whole point of a terminal status is that somebody DECIDED.`;
  }
  if (status === 'FIXED' && !ticket) {
    return 'FIXED needs the ticket whose merge carried it. FIXED is a claim about the integration branch; with no ticket there is nothing to check it against.';
  }
  return null;
}

function load({ required = true } = {}) {
  if (!existsSync(FILE)) {
    if (required) die(2, `no register at ${FILE}\n  This is CANNOT EVALUATE, not an empty register: a missing file and "nothing is owed" are\n  different answers, and only one of them is safe to ship on.`);
    return { records: [], items: new Map() };
  }
  const records = [];
  const text = readFileSync(FILE, 'utf8');
  let lineNo = 0;
  for (const line of text.split(/\r?\n/)) {
    lineNo += 1;
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); }
    catch (e) { die(2, `${FILE}:${lineNo} is not valid JSON (${e.message})\n  A half-readable register is CANNOT EVALUATE. Fix the line; never re-render over it.`); }
  }
  // Last write wins per id, which is what makes this append-only rather than editable: a correction
  // is a later record, and the whole history stays on disk for anyone who asks how it got here.
  const items = new Map();
  for (const r of records) {
    const k = key(r.id);
    const prev = items.get(k) || { id: r.id, history: [] };
    items.set(k, {
      ...prev,
      id: r.id,
      kind: r.kind ?? prev.kind,
      title: r.title ?? prev.title,
      severity: r.severity ?? prev.severity,
      owner: r.owner ?? prev.owner,
      ticket: r.ticket ?? prev.ticket,
      evidence: r.evidence ?? prev.evidence,
      status: r.status ?? prev.status,
      reason: r.reason ?? prev.reason,
      history: [...prev.history, r],
    });
  }
  return { records, items };
}

function append(record) {
  mkdirSync(dirname(FILE), { recursive: true });
  withFileLock(FILE, () => { appendFileSync(FILE, `${JSON.stringify(record)}\n`); }, { die });
}

// --------------------------------------------------------------------------------------------
// commands
// --------------------------------------------------------------------------------------------

function cmdAdd() {
  if (!subject) die(1, 'add needs an ID: register.mjs add BUG-001 --kind bug --title "..." --by qa-engineer');
  const kind = String(flags.kind || '');
  if (!KINDS.has(kind)) die(1, `--kind must be one of ${[...KINDS].join(' | ')} (got "${kind || 'nothing'}")`);
  if (typeof flags.title !== 'string' || flags.title.trim().length < 5) die(1, '--title is required and must say what the item IS.\n  A register row whose title nobody can act on is the row that gets skipped.');
  if (typeof flags.by !== 'string') die(1, '--by is required: an item nobody raised is an item nobody will answer for.');

  const { items } = load({ required: false });
  if (items.has(key(subject))) {
    die(1, `REFUSED: ${subject} is already on the register (status ${items.get(key(subject)).status}).\n  Correct it by appending a later record — register.mjs status ${subject} <STATUS> --by <role>.`);
  }
  const record = {
    schema: 'studio-register/v1', v: 1, ts: now(), action: 'add',
    id: subject, kind, title: String(flags.title).trim(), status: 'OPEN', by: flags.by,
    ...(flags.severity ? { severity: String(flags.severity) } : {}),
    ...(flags.owner ? { owner: String(flags.owner) } : {}),
    ...(flags.ticket ? { ticket: String(flags.ticket) } : {}),
    ...(flags.evidence ? { evidence: String(flags.evidence) } : {}),
  };
  append(record);
  process.stdout.write(`register: ${subject} added as OPEN (${kind})\n`);
  render();
}

function cmdStatus() {
  if (!subject || !argument) die(1, `status needs an ID and a status: register.mjs status BUG-001 FIXED --by tech-manager\n  Legal: ${[...ALL_STATUSES].join(' | ')}`);
  const status = String(argument).toUpperCase();
  if (!ALL_STATUSES.has(status)) die(1, `REFUSED: "${argument}" is not a status.\n  Legal: ${[...ALL_STATUSES].join(' | ')}\n  The vocabulary is closed on purpose — a freehand word is a status nothing can count.`);
  if (typeof flags.by !== 'string') die(1, '--by is required: a status change nobody authored is a status change nobody owns.');

  const { items } = load();
  const item = items.get(key(subject));
  if (!item) die(1, `REFUSED: ${subject} is not on the register. Add it first — a status on nothing records nothing.`);

  // A DEFERRAL WITHOUT A REASON IS AN OMISSION WEARING A DECISION'S CLOTHES, and FIXED is a claim
  // about the INTEGRATION BRANCH rather than about a working tree. Both refusals live in
  // `terminalRefusal` so that `import-bugs` cannot reach a terminal status this path would reject.
  const ticket = typeof flags.ticket === 'string' ? flags.ticket : item.ticket;
  const refusal = terminalRefusal(status, { reason: flags.reason, ticket });
  if (refusal) die(1, `REFUSED: ${refusal}`);

  append({
    schema: 'studio-register/v1', v: 1, ts: now(), action: 'status',
    id: item.id, status, by: flags.by,
    ...(flags.reason ? { reason: String(flags.reason) } : {}),
    ...(ticket ? { ticket: String(ticket) } : {}),
  });
  process.stdout.write(`register: ${item.id} -> ${status}\n`);
  render();
}

function cmdLink() {
  if (!subject) die(1, 'link needs an ID: register.mjs link BUG-001 --ticket APP-004 --by tech-manager');
  if (typeof flags.ticket !== 'string') die(1, '--ticket is required.');
  if (typeof flags.by !== 'string') die(1, '--by is required.');
  const { items } = load();
  const item = items.get(key(subject));
  if (!item) die(1, `REFUSED: ${subject} is not on the register.`);
  append({ schema: 'studio-register/v1', v: 1, ts: now(), action: 'link', id: item.id, ticket: flags.ticket, by: flags.by });
  process.stdout.write(`register: ${item.id} linked to ${flags.ticket}\n`);
  render();
}

function cmdShow() {
  const { items } = load();
  const rows = subject ? [items.get(key(subject))].filter(Boolean) : [...items.values()];
  if (subject && !rows.length) die(2, `${subject} is not on the register`);
  if (flags.json) { process.stdout.write(`${JSON.stringify({ schema: 'register-show/v1', items: rows }, null, 2)}\n`); return; }
  if (!rows.length) { process.stdout.write('register: no items\n'); return; }
  for (const r of rows) {
    process.stdout.write(`  ${String(r.id).padEnd(14)} ${String(r.status).padEnd(14)} ${String(r.kind).padEnd(11)} ${r.severity ? `${r.severity} ` : ''}${r.title}\n`);
    if (r.ticket) process.stdout.write(`  ${' '.repeat(14)} ticket ${r.ticket}\n`);
    if (r.reason) process.stdout.write(`  ${' '.repeat(14)} reason ${r.reason}\n`);
  }
}

/**
 * `check` — the refusal that this whole file exists to provide.
 *
 * Called by `ship-gate.sh` and reported by `orchestrator.mjs round`. It answers one question:
 * is there anything on this register that nobody has decided about? Not "is anything broken" —
 * a shipped release with three DEFERRED S3 bugs is a fine release. The failure it stops is
 * shipping without knowing.
 */
function cmdCheck() {
  const { items } = load({ required: false });
  const all = [...items.values()];
  const open = all.filter((i) => OPEN_STATUSES.has(i.status));
  const untracked = open.filter((i) => !i.ticket);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      schema: 'register-check/v1', total: all.length, open: open.length,
      openItems: open.map((i) => ({ id: i.id, kind: i.kind, severity: i.severity ?? null, status: i.status, ticket: i.ticket ?? null, title: i.title })),
    }, null, 2)}\n`);
  } else if (!all.length) {
    process.stdout.write('REGISTER: CLEAR — no items recorded.\n');
  } else if (!open.length) {
    process.stdout.write(`REGISTER: CLEAR — ${all.length} item(s), every one with a terminal status.\n`);
  } else {
    process.stdout.write(`REGISTER: ${open.length} of ${all.length} item(s) still owe an answer\n\n`);
    for (const i of open) {
      process.stdout.write(`  ${String(i.status).padEnd(12)} ${String(i.id).padEnd(14)} ${i.severity ? `${i.severity} ` : ''}${i.title}\n`);
      process.stdout.write(`  ${' '.repeat(12)} ${i.ticket ? `ticket ${i.ticket}` : 'NO TICKET — nothing on the board will ever pick this up'}\n`);
    }
    process.stdout.write(
      '\n  Every one of these needs a DECISION, not a fix. Legal terminal states:\n' +
      `    ${[...TERMINAL_STATUSES].join(' · ')}   (DEFERRED / WRONG-FINDING / WONTFIX need --reason)\n` +
      (untracked.length
        ? `\n  ${untracked.length} of them have no ticket at all. That is the shape of the failure this register\n  was built for: an item nobody will ever pick up, invisible to the board, the doctor and the\n  sprint summary, closed by being unmentioned.\n`
        : '')
    );
  }
  process.exit(open.length ? 1 : 0);
}

/**
 * `import-bugs` — make the hand-written table a SOURCE instead of the register.
 *
 * Uses the same `parseBugs` that `ship-gate.sh` already trusts, so there is one parser for
 * `docs/51-bugs.md` and not two that can disagree about what a bug row is.
 */
function cmdImportBugs() {
  if (typeof flags.by !== 'string') die(1, '--by is required: an import is a write, and writes are attributed.');
  const bugsPath = typeof flags.bugs === 'string' ? resolve(flags.bugs) : resolve(ROOT, 'docs/51-bugs.md');
  if (!existsSync(bugsPath)) die(2, `no bug list at ${bugsPath} — nothing to import. This is CANNOT EVALUATE, not "no bugs".`);
  const parsed = parseBugs(readFileSync(bugsPath, 'utf8'));
  const { items } = load({ required: false });

  let added = 0;
  const downgraded = [];
  for (const b of parsed.bugs) {
    if (items.has(key(b.id))) continue;

    // THE DESCRIPTION CELL, and not by position. `qa-engineer.md`'s canonical row is nine columns
    // (id | ticket | severity | platform | steps | expected | actual | build | resolution) but real
    // boards carry shorter ones. Taking the LAST cell — the first attempt here — yielded titles like
    // "1.0.3 (42)", the Build column. Taking the longest cell after the severity is right for both
    // shapes, and a title nobody can read is the row that gets skipped, which is the failure this
    // whole file exists to close.
    const cells = b.line.split('|').map((c) => c.replace(/\*\*/g, '').trim()).filter(Boolean);
    const title = cells.slice(3).sort((x, y) => y.length - x.length)[0] || cells.slice(-1)[0] || b.line;

    // `parseBugs.closed` is one boolean over FIXED|CLOSED|WONTFIX, so importing it as `FIXED`
    // collapsed a refusal ("WONTFIX needs a reason") into a status that needs none. Read the word
    // the row actually used, then hold the import to the SAME rule the CLI enforces: a row that
    // cannot satisfy it imports as OPEN and is reported, rather than being waved through terminal.
    // An importer that can mint a terminal status the CLI would refuse is a second write path
    // around the only rule this register has.
    let status = 'OPEN';
    let reason;
    if (b.closed) {
      status = /\bWONTFIX\b/i.test(b.line) ? 'WONTFIX' : 'FIXED';
      reason = cells.slice(3).find((c) => c.length >= 10 && /wont|won't|not|dupl|invalid|by design|cannot/i.test(c));
      const refusal = terminalRefusal(status, { reason, ticket: b.ticket });
      if (refusal) { downgraded.push(`${b.id}: ${status} -> OPEN (${refusal.split('.')[0]})`); status = 'OPEN'; reason = undefined; }
    }

    append({
      schema: 'studio-register/v1', v: 1, ts: now(), action: 'add',
      id: b.id, kind: 'bug', severity: b.severity, title: String(title).slice(0, 200),
      status, by: flags.by,
      ...(reason ? { reason } : {}),
      ...(b.ticket ? { ticket: b.ticket } : {}),
      evidence: bugsPath.replace(`${ROOT}/`, ''),
    });
    added += 1;
  }
  process.stdout.write(`register: imported ${added} bug(s) from ${bugsPath} (${parsed.bugs.length} row(s) seen, ${parsed.bugs.length - added} already present)\n`);
  if (downgraded.length) {
    process.stdout.write(
      `register: ${downgraded.length} row(s) claimed a terminal status the register's own rule refuses, and were imported OPEN:\n` +
      downgraded.map((d) => `  ${d}\n`).join('') +
      '  Give each a real decision: register.mjs status <ID> <STATUS> --by <role> --reason "..." [--ticket <ID>]\n'
    );
  }
  if (added) render();
}

/**
 * The Markdown view is GENERATED, exactly like `docs/31-board.md` and `docs/team/messages.md`.
 * A hand edit here survives until the next append and is read by nothing.
 */
function render() {
  const out = typeof flags.out === 'string' ? resolve(flags.out) : resolve(ROOT, 'docs/90-register.md');
  const { items } = load({ required: false });
  const all = [...items.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const open = all.filter((i) => OPEN_STATUSES.has(i.status));
  const lines = [
    '# 90 — Register',
    '',
    '**GENERATED from `docs/90-register.jsonl` by `scripts/register.mjs`. Never edit this file** —',
    'the next append regenerates it and no rule in this plugin ever saw your edit.',
    '',
    `${all.length} item(s) · **${open.length} still owe an answer** · ` +
      `\`register.mjs check\` exits 1 while that number is above zero, and \`ship-gate.sh\` reads it.`,
    '',
    '| ID | Kind | Sev | Status | Ticket | Title | Reason |',
    '|---|---|---|---|---|---|---|',
    ...all.map((i) => `| ${i.id} | ${i.kind ?? ''} | ${i.severity ?? ''} | **${i.status}** | ${i.ticket ?? '—'} | ${String(i.title ?? '').replace(/\|/g, '\\|').slice(0, 120)} | ${String(i.reason ?? '').replace(/\|/g, '\\|')} |`),
    '',
    '## Terminal statuses',
    '',
    '`FIXED` (needs the ticket that carried it) · `DEFERRED` · `WRONG-FINDING` · `WONTFIX`',
    '(the last three need a reason). `OPEN` and `IN-PROGRESS` are not terminal and block the ship gate.',
    '',
  ];
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${lines.join('\n')}\n`);
}

switch (command) {
  case 'add': cmdAdd(); break;
  case 'status': cmdStatus(); break;
  case 'link': cmdLink(); break;
  case 'show': cmdShow(); break;
  case 'check': cmdCheck(); break;
  case 'render': render(); process.stdout.write('register: rendered\n'); break;
  case 'import-bugs': cmdImportBugs(); break;
  default:
    die(1, `unknown command "${command ?? ''}"\n` +
           '  add <ID> --kind bug|finding|risk|assumption --title "..." --by <role>\n' +
           '  status <ID> <FIXED|DEFERRED|WRONG-FINDING|WONTFIX|OPEN|IN-PROGRESS> --by <role> [--reason ...]\n' +
           '  link <ID> --ticket APP-NNN --by <role>\n' +
           '  show [ID] [--json]        render        check [--json]\n' +
           '  import-bugs --by <role> [--bugs docs/51-bugs.md]');
}
