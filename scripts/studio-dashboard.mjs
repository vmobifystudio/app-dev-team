#!/usr/bin/env node
/**
 * studio-dashboard — the control room. A PROJECTION of the project's state, never a second
 * orchestrator.
 *
 * Two invariants hold this thing honest, and everything else is layout:
 *
 *   1. ONE PARSER. Every fact on this page comes out of lib/board.mjs or lib/events.mjs. There is
 *      no regex over the board here, no second JSONL reader, no "quick" tally that could disagree
 *      with board-doctor about the same file. A renderer that disagrees with its validator is the
 *      defect class this repo names most often, and a dashboard is the easiest place to commit it.
 *
 *   2. NOTHING WRITES STATE EXCEPT THE VALIDATED CLI. The three buttons on this page shell out to
 *      `scripts/board.mjs` and `scripts/team-message.sh` — the same commands the agents run, with
 *      the same guards, the same refusals and the same append-only log. The server has no code path
 *      that opens a state file for writing. That is what makes buttons safe: a control room that
 *      could write directly would be a second writer, and two writers of one board is the thing
 *      Phase 2 exists to have abolished.
 *
 * The panel ORDER is the deliverable. Dry run 4 produced a sprint where all three tickets were
 * blocked; a burn-down would have drawn a flat line and explained nothing, while "here is the one
 * reason" was the single most useful fact of the day. So: cause first, progress last.
 *
 *   1 WHY IS NOTHING MOVING      blocked / stranded / gates that returned CANNOT EVALUATE
 *   2 INSPECTABLE, NOT RUNNABLE  verified_static work, and reviewers that never ran (DR4-002)
 *   3 UNOWNED ARTIFACTS          a file a doc requires that no ticket owns (DR4-019)
 *   4 WORK WITH NO PROVENANCE    changed files and branches belonging to no ticket (DR4-007)
 *   5 QUESTION -> ANSWER -> DELIVERY  a closed ledger is not delivery (DR4-006)
 *   6 BOARD                      kanban + per-owner load, board-render's semantics
 *   7 METRICS                    lib/events.mjs deriveMetrics
 *   8 TIMELINE                   forensics, deliberately last
 *
 * Every panel states the POPULATION IT SWEPT. DR4-025: a clearance claim that does not say what it
 * looked at hides its own blind spot. An empty panel here is never silently "all clear" — it is
 * either `clear` (swept N things, found none) or `unavailable` (could not evaluate, and why).
 *
 * Node stdlib only. No dependencies, ever.
 *
 * Usage:
 *   node scripts/studio-dashboard.mjs [--project DIR] [--port 4173] [--no-actions]
 *   node scripts/studio-dashboard.mjs --export docs/34-dashboard.html [--project DIR]
 *
 * Routes:
 *   GET  /         the page (one file, no CDN, no fonts, no images)
 *   GET  /state    the JSON above
 *   GET  /events   SSE; fs.watch on docs/ with a 2s debounce, pushes "refetch"
 *   POST /action   the whitelist: unblock · answer · assign-artifact. Anything else is refused.
 *
 * Exit codes: 0 served / exported · 2 the project directory does not exist
 */

import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, watch, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readBoard,
  parseMessages,
  parseDependencies,
  findBlockingAncestor,
  pairQuestions,
  isEmpty,
  normalizeId,
} from './lib/board.mjs';
import { parseEventLog, reduce, deriveMetrics, key } from './lib/events.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const BOARD_CLI = join(SCRIPTS, 'board.mjs');
const MESSAGE_CLI = join(SCRIPTS, 'team-message.sh');

const REL = {
  board: 'docs/31-board.md',
  log: 'docs/31-board-events.jsonl',
  messages: 'docs/team/messages.md',
  docs: 'docs',
};

/** Files with a writer of their own and a provenance story. Not "work with no provenance". */
const GENERATED = new Set([
  'docs/31-board.md',
  'docs/31-board-events.jsonl',
  'docs/32-board-view.md',
  'docs/34-dashboard.html',
  'docs/33-messages-view.md',
  // Both halves of the team channel: the event log is written by team-message.sh, the Markdown is
  // rendered from it. Listing only the Markdown would report the source of truth as "work with no
  // provenance" — the file with the MOST provenance in the project.
  'docs/team/messages.jsonl',
  'docs/team/messages.md',
]);

const STATUS_ORDER = ['todo', 'in_progress', 'review', 'qa', 'done', 'blocked'];

// ---------------------------------------------------------------------------------------------
// sources — read once, per request, and say plainly when one is not there
// ---------------------------------------------------------------------------------------------

function readSource(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return { path: rel, ok: false, note: `no ${rel} in this project` };
  try {
    return { path: rel, ok: true, text: readFileSync(path, 'utf8'), note: '' };
  } catch (error) {
    return { path: rel, ok: false, note: `cannot read ${rel}: ${error.message}` };
  }
}

/**
 * Fold the log. A log that exists but does not parse is UNAVAILABLE, never an empty board — the
 * same fail-closed rule board.mjs applies, for the same reason: an unreadable input that reports
 * "nothing to report" is how a broken check reports CLEAR.
 */
function loadLog(source) {
  if (!source.ok) return { ok: false, note: source.note, events: [], tickets: new Map(), violations: [] };
  const { events, errors } = parseEventLog(source.text);
  if (errors.length) {
    return {
      ok: false,
      note: `${REL.log} has ${errors.length} unreadable line(s) — refusing to guess: ${errors
        .map((e) => `line ${e.line}: ${e.reason}`)
        .join('; ')}`,
      events: [],
      tickets: new Map(),
      violations: [],
    };
  }
  const { tickets, violations } = reduce(events);
  return { ok: true, note: '', events, tickets, violations };
}

/**
 * One row set, two possible inputs.
 *
 * Preferred: the generated Markdown board, parsed exactly as board-render parses it, so the kanban
 * and the owner load on this page ARE board-render's — same parser, same `stranded` derivation.
 * If the board file is missing but the log is not, the rows are folded from the log instead, which
 * is the same data one step earlier. Never both, never a merge of two readings.
 */
function buildRows(boardSource, log) {
  let rows = [];
  let from = null;
  let capabilities = { hasReviewColumns: false, hasLedger: false };
  let ledger = [];

  if (boardSource.ok) {
    const parsed = readBoard(boardSource.text);
    if (parsed.board.rows.length) {
      from = REL.board;
      ledger = parsed.ledger;
      capabilities = parsed.capabilities;
      rows = parsed.board.rows.map((row) => ({
        id: normalizeId(row.id),
        title: row.title || '',
        feature: row.feature || '',
        owner: isEmpty(row.owner) ? '' : row.owner,
        reviewer: isEmpty(row.reviewer) ? '' : row.reviewer,
        status: (row.status || '').toLowerCase().trim(),
        staticOnly: Boolean(row.staticOnly),
        dependsOn: row.dependsOn || '',
        notes: row.notes || '',
        acceptance: row.acceptance || '',
        spec: row.spec || '',
      }));
    }
  }

  if (!rows.length && log.ok && log.tickets.size) {
    from = REL.log;
    rows = [...log.tickets.values()].map((t) => ({
      id: normalizeId(t.id),
      title: t.meta.title || '',
      feature: t.meta.feature || '',
      owner: t.owner || '',
      reviewer: t.reviewer || '',
      status: t.status,
      staticOnly: t.verifiedStatic,
      dependsOn: t.dependsOn.join(', '),
      notes: t.meta.notes || '',
      acceptance: t.meta.acceptance || '',
      spec: t.meta.spec || '',
    }));
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of byId.values()) {
    // Derived, never stored — board-render's rule. A todo behind a blocked dependency is invisible
    // to the sprint loop, so it has to be visible here.
    row.stranded = row.status === 'todo' ? findBlockingAncestor(row.id, byId) : null;
    row.deps = parseDependencies(row.dependsOn);
    const state = log.ok ? log.tickets.get(key(row.id)) : null;
    row.events = state ? state.events : [];
    row.staticOnly = row.staticOnly || Boolean(state?.verifiedStatic);
    row.unrun = state?.staticUnrun || '';
  }

  return { rows: [...byId.values()], byId, from, ledger, capabilities };
}

// ---------------------------------------------------------------------------------------------
// panel 1 — WHY IS NOTHING MOVING
// ---------------------------------------------------------------------------------------------

/** The literal headline every gate in this repo prints when it could not decide. */
const CANNOT_EVALUATE = /CANNOT EVALUATE/;

const detailText = (detail) => (typeof detail === 'string' ? detail : JSON.stringify(detail ?? ''));

function panelStuck(model) {
  const { rows, log } = model;
  const items = [];

  for (const row of rows.filter((r) => r.status === 'blocked')) {
    const last = [...row.events].reverse().find((e) => e.event === 'blocked');
    const reason = detailText(last?.detail).trim() || row.notes.trim();
    items.push({
      kind: 'blocked',
      id: row.id,
      owner: row.owner,
      since: last?.ts || '',
      // A blocked ticket with no recorded reason is itself the finding. Saying "blocked" and
      // stopping is the shape of report this whole dashboard exists to refuse.
      reason: reason || 'NO REASON RECORDED — the block was written without one, so nobody can act on it',
      hasReason: Boolean(reason),
      actionable: true,
    });
  }

  for (const row of rows.filter((r) => r.stranded)) {
    items.push({
      kind: 'stranded',
      id: row.id,
      owner: row.owner,
      reason: `waiting on ${row.stranded.via} (${row.stranded.reason}) — the sprint loop cannot see this ticket at all`,
      actionable: false,
    });
  }

  // Gates do not report to this page; they report into the log, and the log is what survives. A
  // `verified_static` says a gate declined to certify something, and names it. Any event detail
  // carrying a gate's own CANNOT EVALUATE headline is the operator having pasted the verdict.
  // ponytail: this reads recorded verdicts, it never runs a gate — a projection that shells out to
  // ship-gate on every refresh is a second orchestrator. Run the gate, record it, and it shows up.
  for (const row of rows) {
    if (row.staticOnly) {
      items.push({
        kind: 'cannot_evaluate',
        id: row.id,
        gate: 'verify-done',
        reason: `${row.unrun || 'the executable test suite'} has never run — this ticket may be reviewed and merged, never closed`,
        actionable: false,
      });
    }
    for (const event of row.events) {
      // ...but not twice. A `blocked` whose reason already quotes the gate is one fact, and the
      // panel's job is the reason, not a tally of how many ways it can be phrased.
      if (event.event === 'blocked') continue;
      if (CANNOT_EVALUATE.test(detailText(event.detail))) {
        items.push({
          kind: 'cannot_evaluate',
          id: row.id,
          gate: event.event,
          reason: detailText(event.detail).trim(),
          actionable: false,
        });
      }
    }
  }

  return {
    id: 'stuck',
    title: 'Why is nothing moving',
    // With no readable log there are no blocked-reasons and no recorded gate verdicts, so an empty
    // list here has not been earned. `clear` is a claim; it needs both inputs to make it.
    status: model.unavailable || (items.length ? 'attention' : model.logGap ? 'unavailable' : 'clear'),
    note: model.unavailableNote || model.logGap,
    swept: `${rows.length} ticket(s) on the board and ${log.events.length} event(s) in the log — blocked, stranded, and every recorded CANNOT EVALUATE`,
    clearNote: 'nothing is blocked, nothing is stranded, and no gate has recorded a CANNOT EVALUATE',
    items,
  };
}

// ---------------------------------------------------------------------------------------------
// panel 2 — INSPECTABLE BUT NOT RUNNABLE
// ---------------------------------------------------------------------------------------------

const REVIEW_EVENTS = new Set(['started', 'approved', 'changes']);

function panelStatic(model) {
  const { rows, log } = model;

  const staticOnly = rows
    .filter((r) => r.staticOnly)
    .map((r) => ({
      kind: 'static',
      id: r.id,
      owner: r.owner,
      status: `${r.status} (static only)`,
      reason: `${r.unrun || 'the executable test suite'} has not been executed`,
    }));

  const awaiting = rows.filter((r) => r.status === 'review');
  const reviewerActions = log.events.filter((e) => REVIEW_EVENTS.has(e.event));
  const reviewers = [...new Set(reviewerActions.map((e) => e.by).filter(Boolean))];

  const items = [...staticOnly];

  // The fact that would have caught DR4-002 in seconds: "3 tickets awaiting review, 0 reviewers
  // ever spawned". Nothing in the run surfaced it, and code-reviewer never ran for a whole sprint.
  if (awaiting.length && reviewerActions.length === 0) {
    items.push({
      kind: 'no_reviewer',
      id: awaiting.map((r) => r.id).join(', '),
      reason: `${awaiting.length} ticket(s) awaiting review and NO reviewer has ever acted on this board — not one started, changes or approved in the whole log`,
    });
  }

  return {
    id: 'static',
    title: 'Inspectable but not runnable',
    // "0 reviewers ever spawned" is a fact ABOUT THE LOG. Without the log this panel cannot say
    // review is healthy, and saying nothing is how DR4-002 went unnoticed for a whole sprint.
    status: model.unavailable || (items.length ? 'attention' : model.logGap ? 'unavailable' : 'clear'),
    note: model.unavailableNote || model.logGap,
    swept: `${rows.length} ticket(s); ${awaiting.length} awaiting review; ${reviewerActions.length} reviewer action(s) in the log by ${
      reviewers.length ? reviewers.join(', ') : 'nobody'
    }`,
    clearNote: 'no ticket is carrying a static-only verification, and review is not starved',
    items,
    extra: { awaiting: awaiting.length, reviewerActions: reviewerActions.length, reviewers },
  };
}

// ---------------------------------------------------------------------------------------------
// panel 3 — UNOWNED ARTIFACTS
// ---------------------------------------------------------------------------------------------

/**
 * A path-shaped token in prose. Deliberately narrow: something with a directory or a leading slash
 * and a short extension. `/project.yml` — the artifact that sat between two charters and nearly
 * became dry run 4's fatal blocker — matches; a sentence about "version 1.2" does not.
 */
const PATH_TOKEN = /(?:^|[\s`("'>])((?:\/|[A-Za-z0-9_.-]+\/)[A-Za-z0-9_./-]*\.[A-Za-z0-9]{1,6})\b/g;

/**
 * Not every path in a doc is an artifact this project owes.
 *
 * `docs/` and `scripts/` are this system's own furniture; `agents/`, `skills/`, `commands/` and
 * `knowledge/` are the PLUGIN's files, cited constantly by generated specs and never created by a
 * ticket; an absolute system path is a machine, not a deliverable. Without this the panel listed
 * `agents/cpo.md` and `/Applications/Xcode.app` as unowned artifacts, and a panel that cries wolf
 * thirty times is read as decoration — which is how the one real orphan gets missed.
 */
const IGNORED_PREFIX =
  /^(?:https?:|\.git|node_modules\/|(?:docs|scripts|agents|skills|commands|knowledge)\/|(?:Applications|Library|System|Users|usr|opt|tmp|var|private|bin|etc)\/)/;

function extractPaths(text) {
  const out = new Map();
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(PATH_TOKEN)) {
      const path = match[1].replace(/[.,)]+$/, '');
      const normal = path.replace(/^\/+/, '');
      if (!out.has(normal)) out.set(normal, { path, line: index + 1 });
    }
  });
  return out;
}

function panelArtifacts(model, root) {
  const docsDir = join(root, REL.docs);
  if (!existsSync(docsDir)) {
    return {
      id: 'artifacts',
      title: 'Unowned artifacts',
      status: 'unavailable',
      note: `no ${REL.docs}/ directory — there are no specs to read requirements out of`,
      swept: 'nothing',
      items: [],
    };
  }

  const docs = readdirSync(docsDir)
    .filter((name) => name.endsWith('.md'))
    .sort();

  // What a ticket claims: its notes, acceptance, spec anchor and title. Plus decisions on the
  // ledger, which is where this dashboard's own "assign an unowned artifact" action records
  // ownership — the CLI has no field for it, and inventing a writer would break invariant 2.
  const claims = model.rows.map((row) => ({
    id: row.id,
    text: `${row.title} ${row.notes} ${row.acceptance} ${row.spec}`.toLowerCase(),
  }));
  for (const m of model.messages) {
    if (m.kind === 'decision' && !isEmpty(m.ticketId)) {
      claims.push({ id: normalizeId(m.ticketId), text: `${m.summary} ${m.body || ''}`.toLowerCase() });
    }
  }

  const items = [];
  let sweptPaths = 0;
  for (const name of docs) {
    const rel = `${REL.docs}/${name}`;
    const found = extractPaths(readFileSync(join(docsDir, name), 'utf8'));
    for (const [normal, where] of found) {
      // The filter lives HERE and not in extractPaths, because the delivery check in panel 5 wants
      // the opposite answer: a `docs/…` path in an answer is precisely the artifact it was folded
      // into. Sharing one filtered extractor made every answer that named a doc read as undelivered.
      if (IGNORED_PREFIX.test(normal)) continue;
      sweptPaths += 1;
      if (existsSync(join(root, normal))) continue; // it exists: whoever owns it, it got written
      const needle = normal.toLowerCase();
      const owner = claims.find((c) => c.text.includes(needle) || c.text.includes(where.path.toLowerCase()));
      if (owner) continue;
      items.push({
        kind: 'unowned',
        artifact: where.path,
        reason: `required by ${rel}:${where.line}, does not exist, and no ticket names it`,
        where: `${rel}:${where.line}`,
        actionable: true,
      });
    }
  }

  return {
    id: 'artifacts',
    title: 'Unowned artifacts',
    status: items.length ? 'attention' : 'clear',
    swept: `${sweptPaths} path(s) named across ${docs.length} doc(s) in ${REL.docs}/; a path that exists on disk, or that any ticket or decision names, is not listed`,
    clearNote: 'every artifact named in the specs either exists or belongs to a ticket',
    items,
  };
}

// ---------------------------------------------------------------------------------------------
// panel 4 — WORK WITH NO PROVENANCE
// ---------------------------------------------------------------------------------------------

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Commits since the board existed, split into {subject, ts, files}.
 *
 * The cut-off matters. Everything committed BEFORE the first ticket was created is charter output —
 * vision, PRD, architecture — which by definition cannot carry a ticket ID. After the board exists,
 * a commit with no ticket in its subject is work with no provenance, which is DR4-007 exactly: the
 * best artifact of dry run 4 was written straight into the shared tree with no branch, no ticket
 * and no commit reference, and only a human reading the standup could have noticed.
 */
const MARK = ''; // a byte that cannot appear in a commit subject or a path
function commitsSinceBoard(root, sinceIso) {
  const raw = git(root, ['log', '--no-merges', '-n', '80', `--pretty=format:${MARK}%cI %s`, '--name-only']);
  const commits = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith(MARK)) {
      const [ts, ...rest] = line.slice(1).split(' ');
      commits.push({ ts, subject: rest.join(' '), files: [] });
    } else if (line.trim() && commits.length) {
      commits[commits.length - 1].files.push(line.trim());
    }
  }
  // Parsed, not string-compared: %cI carries the local offset (…+05:30) and the event log is UTC
  // (…Z), so a lexical compare puts an evening commit before a morning event and the cut-off
  // silently stops working — which it did, and every charter doc came back as orphaned work.
  const since = sinceIso ? Date.parse(sinceIso) : NaN;
  return Number.isFinite(since) ? commits.filter((c) => Date.parse(c.ts) >= since) : commits;
}

function panelProvenance(model, root) {
  let porcelain;
  let branches = [];
  let commits = [];
  try {
    // -uall, not the default: plain `--porcelain` collapses an untracked directory to `TipJar/`,
    // so a file a ticket DOES name is invisible and the directory it lives in gets reported instead
    // — the panel then lists a folder nobody can match against a ticket, which is noise wearing a
    // finding's clothes. Proven by mutating the ownership check off and watching nothing change.
    porcelain = git(root, ['status', '--porcelain', '-uall']);
    branches = git(root, ['branch', '--format=%(refname:short)'])
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean);
    const firstCreated = model.log.events.find((e) => e.event === 'created')?.ts || null;
    commits = commitsSinceBoard(root, firstCreated);
  } catch (error) {
    return {
      id: 'provenance',
      title: 'Work with no provenance',
      status: 'unavailable',
      note: `git could not be read in ${root}: ${String(error.stderr || error.message).trim()}`,
      swept: 'nothing',
      items: [],
    };
  }

  const claims = model.rows.map((row) => ({
    id: row.id,
    text: `${row.title} ${row.notes} ${row.acceptance} ${row.spec}`.toLowerCase(),
  }));
  const ticketIds = new Set(model.rows.map((r) => r.id.toUpperCase()));

  const changed = porcelain
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ state: line.slice(0, 2).trim() || '??', path: line.slice(3).trim().replace(/^"|"$/g, '') }))
    .filter((f) => !GENERATED.has(f.path));

  const items = [];
  for (const file of changed) {
    const owner = claims.find((c) => c.text.includes(file.path.toLowerCase()));
    if (owner) continue;
    items.push({
      kind: 'orphan_file',
      artifact: file.path,
      reason: `${file.state === '??' ? 'untracked' : `changed (${file.state})`} in the working tree and named by no ticket — no branch, no ticket, no commit is the shape of the best artifact of dry run 4`,
      actionable: true,
    });
  }

  const seen = new Set(items.map((i) => i.artifact));
  for (const commit of commits) {
    if ([...ticketIds].some((id) => commit.subject.toUpperCase().includes(id))) continue;
    for (const file of commit.files) {
      if (GENERATED.has(file) || seen.has(file)) continue;
      if (claims.some((c) => c.text.includes(file.toLowerCase()))) continue;
      seen.add(file);
      items.push({
        kind: 'orphan_commit',
        artifact: file,
        reason: `committed after the board existed, by a commit naming no ticket ("${commit.subject}") — and no ticket names the file either`,
        actionable: true,
      });
    }
  }

  for (const branch of branches) {
    if (/^(main|master|HEAD)$/.test(branch)) continue;
    const named = [...ticketIds].some((id) => branch.toUpperCase().includes(id));
    if (named) continue;
    items.push({
      kind: 'orphan_branch',
      artifact: branch,
      reason: 'a branch whose name carries no ticket on this board',
      actionable: false,
    });
  }

  return {
    id: 'provenance',
    title: 'Work with no provenance',
    status: items.length ? 'attention' : model.logGap ? 'unavailable' : 'clear',
    note: model.logGap && `${model.logGap} — without it there is no "since the board existed" cut-off, so every commit was swept`,
    swept: `${changed.length} file(s) git reports changed or untracked, ${commits.length} commit(s) made since the board existed, and ${branches.length} local branch(es) — generated board/ledger files excluded, and charter work committed before the first ticket is out of scope by definition`,
    clearNote: 'everything git can see belongs to a ticket',
    items,
  };
}

// ---------------------------------------------------------------------------------------------
// panel 5 — QUESTION -> ANSWER -> DELIVERY
// ---------------------------------------------------------------------------------------------

const SHIPPED = new Set(['qa', 'done']);

function panelQuestions(model, messagesSource) {
  if (!messagesSource.ok) {
    return {
      id: 'questions',
      title: 'Question → answer → delivery',
      status: 'unavailable',
      note: `${messagesSource.note}. Nothing has been asked, or the channel was never used — those are different, and this cannot tell them apart.`,
      swept: 'nothing',
      items: [],
    };
  }
  if (model.messages.length === 0) {
    return {
      id: 'questions',
      title: 'Question → answer → delivery',
      status: 'unavailable',
      note: `${REL.messages} exists but carries no parseable rows. An empty channel is not a channel with nothing to say.`,
      swept: `${REL.messages}, 0 rows`,
      items: [],
    };
  }

  const threads = new Map();
  for (const m of model.messages) {
    const id = isEmpty(m.ticketId) ? '(no ticket)' : m.ticketId;
    if (!threads.has(id)) threads.set(id, []);
    threads.get(id).push(m);
  }

  const items = [];
  let answeredCount = 0;
  for (const [ticketId, thread] of threads) {
    if (ticketId === '(no ticket)') continue;
    const status = model.byId.get(normalizeId(ticketId))?.status ?? null;
    const { open, answered } = pairQuestions(thread);

    for (const q of open) {
      items.push({
        kind: 'open_question',
        id: ticketId,
        from: q.from,
        to: q.to,
        question: q.summary,
        asked: q.timestamp,
        reason:
          status && SHIPPED.has(status)
            ? `still open while the ticket is ${status} — it shipped on an unconfirmed assumption`
            : 'open — a question nobody answered is how a guess becomes shipped behaviour',
        shipped: Boolean(status && SHIPPED.has(status)),
        actionable: true,
      });
    }

    for (const pair of answered) {
      answeredCount += 1;
      const artifacts = [...extractPaths(`${pair.resolution.summary} ${pair.resolution.body || ''}`).keys()];
      if (artifacts.length) continue;
      // DR4-006. The ledger renders green, the developer still guesses. A closed ledger is not
      // delivery: the question is which ARTIFACT the answer was folded into, and an answer that
      // names none has been delivered to a party that may never read it.
      items.push({
        kind: 'undelivered_answer',
        id: ticketId,
        from: pair.resolution.from,
        to: pair.resolution.to,
        question: pair.question.summary,
        answer: pair.resolution.summary,
        reason:
          'answered on the ledger, but the answer names no artifact it was folded into — a closed ledger is not delivery',
        actionable: false,
      });
    }
  }

  return {
    id: 'questions',
    title: 'Question → answer → delivery',
    status: items.length ? 'attention' : 'clear',
    swept: `${model.messages.length} message(s) across ${threads.size} thread(s); ${answeredCount} question(s) answered, each checked for the artifact the answer landed in`,
    clearNote: 'every question has an answer, and every answer names where it was folded in',
    items,
  };
}

// ---------------------------------------------------------------------------------------------
// panels 6-8 — board, metrics, timeline
// ---------------------------------------------------------------------------------------------

function panelBoard(model) {
  const columns = STATUS_ORDER.map((status) => ({
    status,
    tickets: model.rows
      .filter((r) => r.status === status)
      .map((r) => ({ id: r.id, title: r.title, owner: r.owner, stranded: Boolean(r.stranded), staticOnly: r.staticOnly })),
  })).filter((c) => c.tickets.length);

  const byOwner = new Map();
  for (const row of model.rows) {
    if (row.status === 'done') continue;
    const owner = row.owner || '(unassigned)';
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(row);
  }

  return {
    id: 'board',
    title: 'Board',
    status: model.unavailable || (model.rows.length ? 'info' : 'unavailable'),
    note: model.unavailableNote || (model.rows.length ? '' : 'no ticket table anywhere — this project has no board yet'),
    swept: model.from ? `${model.rows.length} ticket(s), read from ${model.from}` : 'nothing',
    columns,
    owners: [...byOwner]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([owner, rows]) => ({
        owner,
        open: rows.length,
        inProgress: rows.filter((r) => r.status === 'in_progress').length,
        stranded: rows.filter((r) => r.stranded).length,
        blocked: rows.filter((r) => r.status === 'blocked').length,
      })),
    items: [],
  };
}

function panelMetrics(model) {
  if (!model.log.ok) {
    return {
      id: 'metrics',
      title: 'Metrics',
      status: 'unavailable',
      note: `${model.log.note} — every number below is derived from the event log, so there are none`,
      swept: 'nothing',
      items: [],
    };
  }
  const m = deriveMetrics(model.log.events);
  const reached = Object.values(m.tickets).filter((t) => t.reviewed).length;
  return {
    id: 'metrics',
    title: 'Metrics',
    status: 'info',
    // n/a, never 0% — an empty denominator reads as "every review failed", which is /app-status's
    // rule and has to be the same rule here or two surfaces report different health.
    swept: `${model.log.events.length} event(s); ${reached} ticket(s) reached review`,
    metrics: {
      medianCycleTimeMs: m.medianCycleTimeMs,
      reviewPassRate: m.reviewPassRate,
      reworkRate: m.reworkRate,
      gateFires: m.gateFires,
      ticketsPerRound: m.ticketsPerRound,
      reachedReview: reached,
      inferred: model.log.events.filter((e) => e.ts === null).length,
    },
    items: [],
  };
}

function panelTimeline(model) {
  if (!model.log.ok) {
    return {
      id: 'timeline',
      title: 'Timeline',
      status: 'unavailable',
      note: model.log.note,
      swept: 'nothing',
      items: [],
    };
  }
  return {
    id: 'timeline',
    title: 'Timeline',
    status: model.log.events.length ? 'info' : 'unavailable',
    note: model.log.events.length ? '' : 'the event log is empty — nothing has happened on this board yet',
    swept: `${model.log.events.length} event(s), most recent 40 shown`,
    items: model.log.events.slice(-40).reverse().map((e) => ({
      kind: 'event',
      id: e.ticket,
      event: e.event,
      by: e.by || '',
      ts: e.ts || 'inferred',
      reason: detailText(e.detail).slice(0, 240),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------------------------

function assembleState(root, { actions = true } = {}) {
  const boardSource = readSource(root, REL.board);
  const logSource = readSource(root, REL.log);
  const messagesSource = readSource(root, REL.messages);

  const log = loadLog(logSource);
  const { rows, byId, from, ledger, capabilities } = buildRows(boardSource, log);
  const messages = messagesSource.ok ? parseMessages(messagesSource.text) : [];

  const model = {
    rows,
    byId,
    from,
    ledger,
    capabilities,
    log,
    messages,
    // Every panel that reads the log has to know the log is gone. A panel that quietly drops half
    // its inputs and still prints CLEAR is the failure mode this whole file exists to prevent.
    logGap: log.ok ? '' : `${log.note} — every fact this panel derives from the event log is missing`,
    // If neither input produced a ticket, every board-derived panel is CANNOT EVALUATE — not clear.
    unavailable: rows.length ? null : 'unavailable',
    unavailableNote: rows.length
      ? ''
      : `no tickets: ${boardSource.ok ? `${REL.board} has no parseable ticket table` : boardSource.note}; ${
          log.ok ? `${REL.log} folds to 0 tickets` : log.note
        }`,
  };

  const panels = [
    panelStuck(model),
    panelStatic(model),
    panelArtifacts(model, root),
    panelProvenance(model, root),
    panelQuestions(model, messagesSource),
    panelBoard(model),
    panelMetrics(model),
    panelTimeline(model),
  ];

  return {
    generatedAt: new Date().toISOString(),
    project: root,
    readFrom: from,
    sources: [
      { id: 'board', ...boardSource, text: undefined },
      { id: 'log', ...logSource, text: undefined, ok: log.ok, note: log.ok ? '' : log.note },
      { id: 'messages', ...messagesSource, text: undefined },
    ],
    violations: log.violations.map((v) => ({ line: v.event._line, reason: v.reason })),
    tickets: rows.map((r) => ({ id: r.id, status: r.status, owner: r.owner, staticOnly: r.staticOnly })),
    actions: actions ? Object.keys(ACTIONS) : [],
    panels,
  };
}

// ---------------------------------------------------------------------------------------------
// the action surface — a whitelist, and nothing but
// ---------------------------------------------------------------------------------------------

const TICKET_RE = /^[A-Za-z]+-\d+(?:-[A-Za-z]+)?$/;
const ROLE_RE = /^[a-z][a-z0-9-]{1,40}$/;
/**
 * A free-text field: non-empty, one line, bounded — and NOT shaped like a flag.
 *
 * The `--` rule is defence in depth. The real hole was scripts/board.mjs `parseArgs` reading any
 * `--`-prefixed token as a new flag even in a value position, so `reason: "--board=/tmp/x"` made
 * the CLI render a board over an arbitrary file and recorded `"detail": true` in its place. That is
 * fixed at the CLI, where every caller routes; this refuses it at the trust boundary too, because a
 * form field that looks like a flag is never a legitimate reason, summary or artifact path.
 */
const oneLine = (value, max) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\n\r]/.test(value) &&
  !/^\s*--/.test(value);

/**
 * Three actions. Each one BUILDS AN ARGV FOR THE REAL CLI and runs it with execFile — no shell, so
 * there is no interpolation anywhere in this file, and no path from a form field to a state file.
 *
 * "Re-prioritise" is deliberately absent: nobody wanted it once in the whole run, and every action
 * that exists here is one more thing that has to stay in step with the CLI's rules.
 */
const ACTIONS = {
  unblock: {
    label: 'Unblock a ticket',
    fields: [
      { name: 'ticket', label: 'Ticket', required: true },
      { name: 'by', label: 'By (role)', required: true, value: 'tech-manager' },
      { name: 'reason', label: 'Recorded reason', required: true, long: true },
    ],
    validate: (p) =>
      (!TICKET_RE.test(p.ticket || '') && 'ticket must look like APP-001 or BUG-001-fix') ||
      (!ROLE_RE.test(p.by || '') && 'by must be a role name') ||
      (!oneLine(p.reason, 500) && 'a reason is required, one line, max 500 chars — an unblock with no reason is how a block becomes a mystery') ||
      null,
    argv: (p) => ['node', [BOARD_CLI, 'move', p.ticket, 'unblocked', '--by', p.by, '--detail', p.reason]],
  },
  answer: {
    label: 'Answer an open question',
    fields: [
      { name: 'ticket', label: 'Ticket', required: true },
      { name: 'from', label: 'From (role)', required: true },
      { name: 'to', label: 'To (role)', required: true },
      { name: 'summary', label: 'Answer (one line)', required: true },
      { name: 'body', label: 'Detail — name the artifact you folded it into', required: true, long: true },
    ],
    validate: (p) =>
      (!TICKET_RE.test(p.ticket || '') && 'ticket must look like APP-001') ||
      (!ROLE_RE.test(p.from || '') && 'from must be a role name') ||
      (!ROLE_RE.test(p.to || '') && 'to must be a role name') ||
      (!oneLine(p.summary, 300) && 'a one-line summary is required') ||
      (!oneLine(p.body, 2000) && 'a body is required — name the artifact the answer was folded into, or this is a closed ledger and nothing else') ||
      null,
    argv: (p) => [
      'sh',
      [MESSAGE_CLI, '--from', p.from, '--to', p.to, '--ticket', p.ticket, '--kind', 'answer', '--summary', p.summary, '--body', p.body],
    ],
  },
  'assign-artifact': {
    label: 'Assign an unowned artifact',
    fields: [
      { name: 'ticket', label: 'Ticket that will own it', required: true },
      { name: 'artifact', label: 'Artifact path', required: true },
      { name: 'from', label: 'By (role)', required: true, value: 'tech-manager' },
      { name: 'body', label: 'Why this ticket', required: true, long: true },
    ],
    validate: (p) =>
      (!TICKET_RE.test(p.ticket || '') && 'ticket must look like APP-001') ||
      (!oneLine(p.artifact, 200) && 'an artifact path is required') ||
      (!ROLE_RE.test(p.from || '') && 'by must be a role name') ||
      (!oneLine(p.body, 2000) && 'say why this ticket owns it') ||
      null,
    // There is no board field for "this ticket owns this file", and inventing a writer for one
    // would make this page a second writer of state. A `decision` on the team ledger is the
    // existing, validated, append-only place where an ownership call is recorded — and panel 3
    // reads decisions back, so the artifact stops being unowned the moment this succeeds.
    argv: (p) => [
      'sh',
      [
        MESSAGE_CLI,
        '--from',
        p.from,
        '--to',
        'tech-manager',
        '--ticket',
        p.ticket,
        '--kind',
        'decision',
        '--summary',
        `${p.ticket} owns ${p.artifact}`,
        '--body',
        p.body,
      ],
    ],
  },
};

function runAction(root, name, params) {
  // `Object.hasOwn`, not `ACTIONS[name]`: a bare lookup inherits from Object.prototype, so
  // {"action":"constructor"} passed the whitelist guard, `action.validate` was undefined, and the
  // TypeError escaped the async handler and KILLED THE PROCESS. The existing negative test used
  // "render" — not an inherited property — so it stayed green over the hole.
  const action = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : null;
  if (!action) {
    return {
      status: 400,
      body: {
        ok: false,
        refused: `"${name}" is not on the action whitelist`,
        whitelist: Object.keys(ACTIONS),
        detail:
          'This page can unblock a ticket with a recorded reason, answer an open question, and assign an unowned artifact. Nothing else is actionable from here, by construction.',
      },
    };
  }
  const problem = action.validate(params);
  if (problem) return { status: 400, body: { ok: false, refused: problem, action: name } };

  const [command, args] = action.argv(params);
  const display = `${command} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;

  return new Promise((done) => {
    execFile(command, args, { cwd: root, timeout: 20000, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      done({
        status: 200,
        body: {
          // A refusal is a FINDING, not an error to swallow. The CLI's own words, verbatim, exit
          // code included — that is the whole reason it is safe for this page to have buttons.
          ok: exitCode === 0,
          action: name,
          command: display,
          exitCode,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        },
      });
    });
  });
}

// ---------------------------------------------------------------------------------------------
// the page — one file, no CDN, no fonts, no images, theme-aware
// ---------------------------------------------------------------------------------------------

const escapeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function page({ boot = null, actions = true } = {}) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studio control room</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #fbfbfa; --fg: #16150f; --dim: #6b6a63; --line: #e0dfd8; --card: #ffffff;
  --red: #b91c1c; --amber: #a16207; --green: #15803d; --blue: #1d4ed8;
  --redbg: #fef2f2; --amberbg: #fefce8; --greenbg: #f0fdf4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14140f; --fg: #ecebe4; --dim: #96958c; --line: #2c2c25; --card: #1c1c16;
    --red: #f87171; --amber: #fbbf24; --green: #4ade80; --blue: #93b4fd;
    --redbg: #2a1616; --amberbg: #29220f; --greenbg: #14251a;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 80px; }
h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.01em; }
h2 { font-size: 15px; margin: 0; letter-spacing: 0.06em; text-transform: uppercase; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
.dim { color: var(--dim); }
header.top { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; justify-content: space-between; border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 20px; }
.sources { display: flex; flex-wrap: wrap; gap: 6px; }
.pill { border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; font-size: 12px; }
.pill.bad { border-color: var(--red); color: var(--red); background: var(--redbg); }
section.panel { border: 1px solid var(--line); border-radius: 10px; background: var(--card); margin-bottom: 16px; overflow: hidden; }
section.panel > .head { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; padding: 12px 14px; border-bottom: 1px solid var(--line); }
section.panel[data-status="attention"] > .head { background: var(--redbg); }
section.panel[data-status="unavailable"] > .head { background: var(--amberbg); }
section.panel[data-status="clear"] > .head { background: var(--greenbg); }
.rank { font-size: 12px; color: var(--dim); font-variant-numeric: tabular-nums; }
.badge { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; }
[data-status="attention"] .badge { color: var(--red); }
[data-status="unavailable"] .badge { color: var(--amber); }
[data-status="clear"] .badge { color: var(--green); }
[data-status="info"] .badge { color: var(--blue); }
.swept { padding: 8px 14px; font-size: 12px; color: var(--dim); border-bottom: 1px solid var(--line); }
ul.items { list-style: none; margin: 0; padding: 0; }
ul.items > li { padding: 11px 14px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
ul.items > li:last-child { border-bottom: 0; }
.tag { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--red); flex: 0 0 auto; }
.tag.soft { color: var(--amber); }
.id { font-family: ui-monospace, monospace; font-weight: 600; flex: 0 0 auto; }
.why { flex: 1 1 320px; min-width: 240px; }
.empty { padding: 12px 14px; color: var(--dim); font-size: 14px; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 7px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { font-weight: 600; color: var(--dim); font-size: 12px; }
.kanban { display: flex; gap: 12px; padding: 12px 14px; }
.kanban .col { flex: 1 0 150px; min-width: 150px; }
.kanban h3 { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); margin: 0 0 6px; }
.kanban .card { border: 1px solid var(--line); border-radius: 7px; padding: 6px 8px; margin-bottom: 6px; font-size: 12px; }
.kanban .card.flag { border-color: var(--red); background: var(--redbg); }
.metrics { display: flex; flex-wrap: wrap; gap: 14px; padding: 14px; }
.metric { min-width: 150px; }
.metric b { display: block; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
form.act { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 10px 14px; border-top: 1px dashed var(--line); }
form.act input, form.act textarea { font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); min-width: 120px; }
form.act textarea { flex: 1 1 260px; min-height: 34px; }
button { font: inherit; font-size: 13px; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); cursor: pointer; }
button:hover { border-color: var(--fg); }
pre.result { margin: 0; padding: 10px 14px; background: var(--amberbg); border-top: 1px solid var(--line); white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; }
pre.result.ok { background: var(--greenbg); }
.note { padding: 10px 14px; color: var(--amber); font-size: 13px; }
</style>
</head><body><main>
<header class="top">
  <div><h1>Studio control room</h1><div class="dim mono" id="meta">loading…</div></div>
  <div class="sources" id="sources"></div>
</header>
<div id="panels"></div>
<p class="dim" style="font-size:12px">A projection. Nothing on this page writes state — the three actions shell out to
<code>scripts/board.mjs</code> and <code>scripts/team-message.sh</code>, the same validated CLI the agents use, and show you the
command and its exit code. A refusal is a finding, printed verbatim.</p>
</main>
<script>
const BOOT = ${boot ? escapeJson(boot) : 'null'};
const CAN_ACT = ${actions ? 'true' : 'false'};
const $ = (t, a, k) => { const e = document.createElement(t); if (a) Object.assign(e, a); (k||[]).forEach(c => e.append(c)); return e; };
const txt = (s) => document.createTextNode(s == null ? '' : String(s));

const FIELDS = ${escapeJson(
    Object.fromEntries(Object.entries(ACTIONS).map(([name, a]) => [name, { label: a.label, fields: a.fields }]))
  )};
const PANEL_ACTION = { stuck: 'unblock', questions: 'answer', artifacts: 'assign-artifact' };

function pct(v) { return v === null || v === undefined ? 'n/a' : Math.round(v * 100) + '%'; }
function dur(ms) {
  if (ms === null || ms === undefined) return 'n/a';
  const m = Math.round(ms / 60000);
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function renderItems(p) {
  const ul = $('ul', { className: 'items' });
  for (const it of p.items) {
    const li = $('li');
    li.append($('span', { className: 'tag' + (it.kind === 'cannot_evaluate' || it.kind === 'undelivered_answer' ? ' soft' : '') }, [txt((it.kind || '').replace(/_/g, ' '))]));
    if (it.id) li.append($('span', { className: 'id' }, [txt(it.id)]));
    if (it.artifact) li.append($('span', { className: 'id mono' }, [txt(it.artifact)]));
    if (it.status) li.append($('span', { className: 'dim' }, [txt(it.status)]));
    if (it.question) li.append($('span', { className: 'why' }, [txt(it.question)]));
    if (it.event) li.append($('span', { className: 'dim mono' }, [txt(it.event + ' by ' + (it.by || '—') + ' · ' + it.ts)]));
    li.append($('span', { className: 'why dim' }, [txt(it.reason || '')]));
    ul.append(li);
  }
  return ul;
}

function renderBoard(p) {
  const wrap = $('div', { className: 'scroll' });
  const k = $('div', { className: 'kanban' });
  for (const col of p.columns || []) {
    const c = $('div', { className: 'col' }, [$('h3', {}, [txt(col.status.replace('_', ' ') + ' (' + col.tickets.length + ')')])]);
    for (const t of col.tickets) {
      c.append($('div', { className: 'card' + (t.stranded || col.status === 'blocked' ? ' flag' : '') }, [
        $('b', { className: 'mono' }, [txt(t.id)]), txt(' '), txt(t.title || ''),
        $('div', { className: 'dim' }, [txt((t.owner || 'unassigned') + (t.staticOnly ? ' · static only' : '') + (t.stranded ? ' · STRANDED' : ''))]),
      ]));
    }
    k.append(c);
  }
  wrap.append(k);
  if ((p.owners || []).length) {
    const tb = $('table', {}, [$('thead', {}, [$('tr', {}, ['Owner', 'Open', 'In progress', 'Blocked', 'Stranded'].map(h => $('th', {}, [txt(h)])))])]);
    const body = $('tbody');
    for (const o of p.owners) body.append($('tr', {}, [o.owner, o.open, o.inProgress, o.blocked, o.stranded].map(v => $('td', {}, [txt(v)]))));
    tb.append(body);
    wrap.append(tb);
  }
  return wrap;
}

function renderMetrics(p) {
  const m = p.metrics;
  const g = m.gateFires || {};
  const box = $('div', { className: 'metrics' });
  const add = (label, value, sub) => box.append($('div', { className: 'metric' }, [
    $('b', {}, [txt(value)]), $('div', { className: 'dim' }, [txt(label)]), $('div', { className: 'dim', style: 'font-size:12px' }, [txt(sub || '')]),
  ]));
  add('cycle time (median)', dur(m.medianCycleTimeMs), 'claimed → closed');
  add('review pass rate', pct(m.reviewPassRate), m.reachedReview + ' ticket(s) reached review');
  add('rework rate', pct(m.reworkRate), 'went back for changes');
  add('gates fired', Object.values(g).reduce((a, b) => a + b, 0), Object.entries(g).map(([k2, v]) => k2 + ' ' + v).join(' · '));
  if (m.inferred) add('inferred events', m.inferred, 'migrated, no timestamp — timings start at the migration');
  return box;
}

function actionForm(name, panelEl) {
  const spec = FIELDS[name];
  if (!spec || !CAN_ACT) return null;
  const form = $('form', { className: 'act' });
  form.append($('span', { className: 'dim', style: 'font-size:12px' }, [txt(spec.label + ':')]));
  for (const f of spec.fields) {
    const el = $(f.long ? 'textarea' : 'input', { name: f.name, placeholder: f.label, value: f.value || '', required: true });
    form.append(el);
  }
  const btn = $('button', { type: 'submit' }, [txt('Run')]);
  form.append(btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    btn.disabled = true;
    const params = {};
    for (const f of spec.fields) params[f.name] = form.elements[f.name].value;
    let out;
    try {
      const res = await fetch('/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: name, params }) });
      out = await res.json();
    } catch (e) { out = { ok: false, refused: String(e) }; }
    const pre = $('pre', { className: 'result' + (out.ok ? ' ok' : '') });
    pre.append(txt(out.refused
      ? 'REFUSED: ' + out.refused + (out.whitelist ? '\\nwhitelist: ' + out.whitelist.join(', ') : '')
      : '$ ' + out.command + '\\nexit ' + out.exitCode + '\\n' + (out.stdout || '') + (out.stderr || '')));
    const old = panelEl.querySelector('pre.result');
    if (old) old.remove();
    panelEl.append(pre);
    btn.disabled = false;
    if (out.ok) load();
  });
  return form;
}

function renderPanel(p, rank) {
  const el = $('section', { className: 'panel' });
  el.dataset.status = p.status;
  el.append($('div', { className: 'head' }, [
    $('span', { className: 'rank' }, [txt(rank + '.')]),
    $('h2', {}, [txt(p.title)]),
    $('span', { className: 'badge' }, [txt(p.status === 'attention' ? p.items.length + ' need attention' : p.status)]),
  ]));
  el.append($('div', { className: 'swept' }, [txt('swept: ' + p.swept)]));
  if (p.note) el.append($('div', { className: 'note' }, [txt(p.note)]));

  if (p.id === 'board') el.append(renderBoard(p));
  else if (p.id === 'metrics' && p.metrics) el.append(renderMetrics(p));
  else if (p.items.length) el.append(renderItems(p));
  else if (p.status === 'clear') el.append($('div', { className: 'empty' }, [txt('CLEAR — ' + (p.clearNote || 'nothing found in the population above'))]));
  else if (p.status !== 'unavailable') el.append($('div', { className: 'empty' }, [txt('nothing to show')]));
  else if (!p.note) el.append($('div', { className: 'note' }, [txt('CANNOT EVALUATE')]));

  const act = PANEL_ACTION[p.id] && p.status !== 'unavailable' ? actionForm(PANEL_ACTION[p.id], el) : null;
  if (act) el.append(act);
  return el;
}

function render(state) {
  document.getElementById('meta').textContent = state.project + ' · ' + state.generatedAt + (state.readFrom ? ' · tickets from ' + state.readFrom : '');
  const src = document.getElementById('sources');
  src.textContent = '';
  for (const s of state.sources) src.append($('span', { className: 'pill' + (s.ok ? '' : ' bad'), title: s.note || '' }, [txt(s.id + (s.ok ? ' ✓' : ' — missing'))]));
  if (state.violations && state.violations.length) src.append($('span', { className: 'pill bad' }, [txt(state.violations.length + ' log violation(s)')]));
  const host = document.getElementById('panels');
  host.textContent = '';
  state.panels.forEach((p, i) => host.append(renderPanel(p, i + 1)));
}

async function load() {
  try { render(await (await fetch('/state')).json()); }
  catch (e) { document.getElementById('meta').textContent = 'could not reach /state: ' + e; }
}

if (BOOT) render(BOOT);
else {
  load();
  const es = new EventSource('/events');
  es.onmessage = load;
}
</script>
</body></html>
`;
}

// ---------------------------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------------------------

function watchDocs(root, onChange) {
  const docsDir = join(root, REL.docs);
  if (!existsSync(docsDir)) return () => {};
  const watchers = [];
  try {
    watchers.push(watch(docsDir, { recursive: true }, onChange));
  } catch {
    // recursive fs.watch is not available on every platform; watch the directories we care about.
    for (const dir of [docsDir, join(docsDir, 'team'), join(docsDir, 'daily')]) {
      if (existsSync(dir)) watchers.push(watch(dir, onChange));
    }
  }
  return () => watchers.forEach((w) => w.close());
}

function serve(root, { port, actions }) {
  const clients = new Set();
  let timer = null;
  const ping = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const res of clients) res.write('data: refetch\n\n');
    }, 2000);
  };
  watchDocs(root, ping);
  const beat = setInterval(() => {
    for (const res of clients) res.write(': keep-alive\n\n');
  }, 25000);
  beat.unref?.();

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };

    if (req.method === 'GET' && url.pathname === '/') return send(200, 'text/html; charset=utf-8', page({ actions }));
    if (req.method === 'GET' && url.pathname === '/state') {
      try {
        return send(200, 'application/json', JSON.stringify(assembleState(root, { actions })));
      } catch (error) {
        return send(500, 'application/json', JSON.stringify({ error: String(error.stack || error) }));
      }
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('data: hello\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    if (req.method === 'POST' && url.pathname === '/action') {
      if (!actions) return send(403, 'application/json', JSON.stringify({ ok: false, refused: 'this dashboard was started with --no-actions' }));

      // Binding to 127.0.0.1 keeps the network out; it does not keep the OPERATOR'S BROWSER out.
      // `JSON.parse(body)` ignored Content-Type, and a `text/plain` POST is a CORS-simple request —
      // no preflight — so any page open in another tab could drive all three actions. Requiring
      // application/json reinstates the preflight; rejecting a foreign Origin closes the rest.
      const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (ctype !== 'application/json') {
        return send(415, 'application/json', JSON.stringify({
          ok: false,
          refused: 'POST /action requires content-type: application/json — a simple-CORS body is a drive-by from any page the operator has open',
        }));
      }
      const origin = req.headers.origin;
      const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
      const sameOrigin =
        origin === undefined ||
        (() => { try { return new URL(origin).hostname === '127.0.0.1' || new URL(origin).hostname === 'localhost'; } catch { return false; } })();
      if (!sameOrigin || (site && site !== 'same-origin' && site !== 'none')) {
        return send(403, 'application/json', JSON.stringify({
          ok: false,
          refused: `cross-origin POST /action refused (origin: ${origin ?? 'none'}, sec-fetch-site: ${site || 'none'})`,
        }));
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1 << 16) req.destroy();
      });
      req.on('end', async () => {
        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          return send(400, 'application/json', JSON.stringify({ ok: false, refused: 'body is not JSON' }));
        }
        const result = await runAction(root, String(parsed.action ?? ''), parsed.params || {});
        return send(result.status, 'application/json', JSON.stringify(result.body));
      });
      return undefined;
    }
    return send(404, 'text/plain', 'not found');
  });

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`studio-dashboard: http://localhost:${port}  (project: ${root})\n`);
    if (!actions) process.stdout.write('studio-dashboard: read-only — actions disabled\n');
  });
  server.on('error', (error) => {
    process.stderr.write(`studio-dashboard: cannot listen on ${port}: ${error.message}\n`);
    process.exit(2);
  });
  return server;
}

// ---------------------------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
  };
  const root = resolve(process.cwd(), flag('project', '.'));
  if (!existsSync(root)) {
    process.stderr.write(`studio-dashboard: no such project directory: ${root}\n`);
    process.exit(2);
  }
  const exportPath = flag('export', null);
  const actions = !argv.includes('--no-actions') && !exportPath;

  if (exportPath) {
    // Static mode: the same page with the state baked in, no server, no SSE, no actions. Shareable
    // as one file; stale the moment it is written, which is why the header carries its timestamp.
    const target = resolve(process.cwd(), exportPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, page({ boot: assembleState(root, { actions: false }), actions: false }));
    const shown = relative(process.cwd(), target);
    process.stdout.write(`studio-dashboard: wrote ${shown && !shown.startsWith('..') ? shown : target}\n`);
    return;
  }

  serve(root, { port: Number(flag('port', 4173)), actions });
}

main();
