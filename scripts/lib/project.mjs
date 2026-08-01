/**
 * Reading a project's recorded state — the ONE read layer under every human-facing surface.
 *
 * `scripts/studio-dashboard.mjs` (the zero-dep emergency dashboard) and `control-room/` (the
 * product UI) must not disagree about how many tickets there are, which file they came from, or
 * whether the log is readable. They would, and quickly: `buildRows` alone encodes three decisions
 * that are not obvious — the board Markdown is preferred over the log, the log is a FALLBACK and
 * never a merge, and `stranded` is derived and never stored. A second implementation gets two of
 * the three right and nobody notices which.
 *
 * Two rules this file exists to hold:
 *
 *   ONE PARSER. Everything here comes out of `lib/board.mjs`, `lib/events.mjs` or `lib/messages.mjs`.
 *   No regex over the board, no second JSONL reader, no "quick" tally that could disagree with
 *   board-doctor about the same file.
 *
 *   A MISSING INPUT IS NOT AN EMPTY ONE. Every reader below returns `{ok, note}` and says which file
 *   it could not read and why. A surface that quietly drops half its inputs and still prints CLEAR
 *   is the failure this whole codebase exists to prevent.
 *
 * Node stdlib only. No dependencies, ever — the plugin has no package.json and must not acquire one.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  readBoard,
  parseBugs,
  parseMessages,
  parseDependencies,
  findBlockingAncestor,
  isEmpty,
  normalizeId,
  splitRow,
} from './board.mjs';
import { parseEventLog, reduce, key } from './events.mjs';
import { parseMessageLog, toLedgerRow } from './messages.mjs';

const REL = {
  board: 'docs/31-board.md',
  log: 'docs/31-board-events.jsonl',
  messages: 'docs/team/messages.md',
  messageLog: 'docs/team/messages.jsonl',
  roster: 'docs/02-team-roster.md',
  bugs: 'docs/51-bugs.md',
  rounds: 'docs/33-rounds.jsonl',
  releases: 'docs/60-releases.md',
  docs: 'docs',
};

/** Read one file, and say plainly when it is not there. Never throws. */
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
 * Fold the board event log. A log that exists but does not parse is UNAVAILABLE, never an empty
 * board — the same fail-closed rule board.mjs applies, for the same reason: an unreadable input
 * that reports "nothing to report" is how a broken check reports CLEAR.
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
 * and the owner load ARE board-render's — same parser, same `stranded` derivation. If the board file
 * is missing but the log is not, the rows are folded from the log instead, which is the same data
 * one step earlier. Never both, never a merge of two readings.
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

// --------------------------------------------------------------------------------------------
// why is nothing moving — the one derivation, shared by both dashboards
// --------------------------------------------------------------------------------------------

/** The literal headline every gate in this repo prints when it could not decide. */
const CANNOT_EVALUATE = /CANNOT EVALUATE/;

const detailText = (detail) => (typeof detail === 'string' ? detail : JSON.stringify(detail ?? ''));

/**
 * Every recorded reason work is not moving: blocked tickets with their reason, tickets stranded
 * behind one, and every gate verdict that said CANNOT EVALUATE.
 *
 * Shared because it is the single most useful fact either surface produces, and because the three
 * judgements in it are not obvious: a blocked ticket with NO recorded reason is itself the finding;
 * `verified_static` is a gate declining to certify, not a pass; and a `blocked` whose reason already
 * quotes a gate is ONE fact, not two. A second implementation gets the first one right and the other
 * two wrong, and the second surface then disagrees with the first about why the sprint is stopped.
 *
 * ponytail: this reads recorded verdicts, it never runs a gate — a projection that shells out to
 * ship-gate on every refresh is a second orchestrator. Run the gate, record it, and it shows up.
 */
function stuckItems(rows) {
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
      // stopping is the shape of report both dashboards exist to refuse.
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
      // ...but not twice. A `blocked` whose reason already quotes the gate is one fact.
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

  return items;
}

// --------------------------------------------------------------------------------------------
// the team channel — the JSONL log is the source, the Markdown is the degraded fallback
// --------------------------------------------------------------------------------------------

/**
 * Read the team channel.
 *
 * `docs/team/messages.jsonl` is the source of truth (P3a) and the only place the STRUCTURED
 * metadata lives — the artifact an answer was folded into, the obligation, the requirement, the
 * priority. `docs/team/messages.md` is its generated view and carries none of that.
 *
 * A project written before P3a has only the Markdown. Reading it is right; pretending it carries
 * the metadata is not, so `structured:false` is reported and every consumer must say so rather than
 * render an empty "artifact" column that reads as "this answer delivered nothing".
 *
 * @returns {{ok:boolean, structured:boolean, from:string, note:string, messages:Array, rows:Array}}
 */
function readChannel(root) {
  const logSource = readSource(root, REL.messageLog);
  if (logSource.ok) {
    const { messages, errors } = parseMessageLog(logSource.text);
    if (errors.length) {
      // Same fail-closed rule as the board log. Half a channel is not a channel.
      return {
        ok: false,
        structured: true,
        from: REL.messageLog,
        note: `${REL.messageLog} has ${errors.length} unreadable line(s) — refusing to guess: ${errors
          .map((e) => `line ${e.line}: ${e.reason}`)
          .join('; ')}`,
        messages: [],
        rows: [],
      };
    }
    return {
      ok: true,
      structured: true,
      from: REL.messageLog,
      note: '',
      messages,
      rows: messages.map(toLedgerRow),
    };
  }

  const mdSource = readSource(root, REL.messages);
  if (!mdSource.ok) {
    return {
      ok: false,
      structured: false,
      from: '',
      note: `${logSource.note}; ${mdSource.note}. Nothing has been said on this project, or the channel was never used — those are different, and this cannot tell them apart.`,
      messages: [],
      rows: [],
    };
  }

  // The Markdown view, promoted to the message shape so one renderer serves both. Every field the
  // Markdown cannot carry is left empty AND flagged by `structured:false` — not silently defaulted.
  const rows = parseMessages(mdSource.text);
  const messages = rows.map((row, index) => ({
    _line: row._line,
    id: `MD-${String(index + 1).padStart(4, '0')}`,
    v: 1,
    ts: row.timestamp,
    ticket: row.ticketId,
    kind: row.kind,
    from: row.from,
    to: row.to ? row.to.split(/\s*,\s*/).filter(Boolean) : [],
    priority: row.kind === 'fyi' ? 'fyi' : 'material',
    blocking: false,
    requires_response: false,
    expires_after_round: null,
    round: null,
    requirements: [],
    artifact: '',
    transition: '',
    decision: '',
    evidence: '',
    expires: '',
    owner: '',
    confidence: '',
    validate_by: '',
    summary: row.summary,
    body: row.body === '—' ? '' : row.body,
    status: 'open',
    // Exactly the word the JSONL migration uses for the same situation, so a reader that already
    // knows to distrust `inferred` distrusts these too.
    provenance: 'inferred',
    inferred_fields: ['artifact', 'transition', 'priority', 'status', 'requires_response'],
    channel: '',
    thread: row.ticketId && row.ticketId !== '-' ? `THR-${String(row.ticketId).toUpperCase()}` : 'THR-broadcast',
  }));

  return {
    ok: true,
    structured: false,
    from: REL.messages,
    note:
      `${logSource.note} — read the generated Markdown view instead. It carries NO structured metadata: ` +
      'the artifact an answer was folded into, the obligation it satisfied, the requirement it cites and its ' +
      'priority were never written to this file, so their absence here is a gap in the source, not a finding ' +
      'about the team. Run `node scripts/messages.mjs migrate` to reconstruct the log.',
    messages,
    rows,
  };
}

// --------------------------------------------------------------------------------------------
// the roster — docs/02-team-roster.md, the record of who is on this project and who is off
// --------------------------------------------------------------------------------------------

const ROSTER_STATE = new Set(['active', 'conditional', 'off']);

/**
 * Parse `docs/02-team-roster.md`: `Tier:`, `Product type:`, and the `| Role | State | Reason |` table.
 *
 * The file's own rules say every activation-matrix role gets a row and a deactivated role is an
 * `off` WITH ITS REASON — "a role missing from this file is not off, it is unaccounted for". A row
 * whose state is not one of the three, or whose reason is empty, is therefore a finding about the
 * roster and is returned as one, never dropped: a silently skipped row is a role nobody is
 * accountable for, reported as absent.
 */
function readRoster(root) {
  const source = readSource(root, REL.roster);
  if (!source.ok) {
    return { ok: false, note: `${source.note} — nothing records which roles this project activated`, tier: '', productType: '', roles: [], problems: [] };
  }
  const lines = source.text.split(/\r?\n/);
  const grab = (label) => {
    const hit = lines.find((l) => new RegExp(`^\\s*(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:`, 'i').test(l));
    if (!hit) return '';
    return hit.slice(hit.indexOf(':') + 1).replace(/\s*\(source:.*$/i, '').trim();
  };

  const roles = [];
  const problems = [];
  for (const [index, line] of lines.entries()) {
    if (!line.includes('|')) continue;
    const cells = splitRow(line);
    if (cells.length < 3) continue;
    const [role, rawState, ...rest] = cells.map((c) => c.replace(/`/g, '').trim());
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(role)) continue; // header, separator, prose
    const state = rawState.toLowerCase();
    const reason = rest.join(' | ').trim();
    if (!ROSTER_STATE.has(state)) {
      problems.push({ role, line: index + 1, reason: `state "${rawState}" is not one of active / conditional / off` });
      continue;
    }
    // A deactivated role is RECORDED, never silently absent — and a reason-less `off` is a role
    // switched off by whoever was in the room that day, which is the same thing one step along.
    if (!reason || reason === '—') {
      problems.push({ role, line: index + 1, reason: `${role} is "${state}" with no recorded reason or trigger` });
    }
    roles.push({ role, state, reason, line: index + 1 });
  }

  return {
    // A ROSTER THAT PARSED TO NOTHING IS NOT A READABLE ROSTER. This returned `ok: true` with an
    // empty `roles` and an explanatory note — and `ok` is what the sections branch on, so every
    // Team section rolled up to `clear` and the roster-integrity card reported that every role has
    // a valid state, while the note underneath admitted no role table had been parsed. A verdict
    // and its own note contradicting each other is the shape this whole file exists to prevent.
    //
    // Zero roles and every role valid are indistinguishable to a caller that only reads `ok`.
    // Reported by codex on PR #8.
    ok: roles.length > 0,
    note: roles.length ? '' : `${REL.roster} exists but carries no parseable role table, so nothing about the roster can be verified from it`,
    tier: grab('Tier'),
    productType: grab('Product type'),
    roles,
    problems,
  };
}

// --------------------------------------------------------------------------------------------
// bugs and rounds
// --------------------------------------------------------------------------------------------

/** `docs/51-bugs.md` through lib/board.mjs's parser — the same one the ship gate uses. */
function readBugsFile(root) {
  const source = readSource(root, REL.bugs);
  if (!source.ok) {
    return { ok: false, note: `${source.note} — the open S1/S2 count that decides releases is unknown, not zero`, bugs: [], open: [], blocking: [], deferred: [] };
  }
  return { ok: true, note: '', ...parseBugs(source.text) };
}

/**
 * `docs/33-rounds.jsonl` — the loop's economic brake, as recorded by `scripts/round-journal.mjs`.
 *
 * Deliberately reports `spendUsd: null` unless a line carries a real number: this harness cannot
 * measure token cost, and round-journal says so plainly rather than inventing one. A budget panel
 * that showed "$0.00 spent" would be a fabricated number on the one screen a founder reads for money.
 */
function readRounds(root) {
  const source = readSource(root, REL.rounds);
  if (!source.ok) {
    return { ok: false, note: `${source.note} — no round has ever been journalled, so there is no budget position to report`, rounds: [] };
  }
  const rounds = [];
  const errors = [];
  source.text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rounds.push(JSON.parse(line));
    } catch {
      errors.push(index + 1);
    }
  });
  if (errors.length) {
    return { ok: false, note: `${REL.rounds} has unreadable line(s) ${errors.join(', ')} — refusing to total a ledger it cannot read`, rounds: [] };
  }
  const sum = (field) => rounds.reduce((total, r) => total + (Number(r[field]) || 0), 0);
  const spends = rounds.map((r) => r.spendUsd).filter((v) => typeof v === 'number');
  return {
    ok: true,
    note: '',
    rounds,
    totals: {
      rounds: rounds.length,
      spawns: sum('spawns'),
      retries: sum('retries'),
      refusals: sum('refusals'),
      // null, not 0. See above.
      spendUsd: spends.length ? spends.reduce((a, b) => a + b, 0) : null,
    },
  };
}

/**
 * `docs/60-releases.md`'s founder-facing submission checklist — the ONE place "app ready to
 * submit" becomes a progress figure. `release-manager` never uploads or submits to a store at any
 * track (`docs/03-decision-rights.md`); the checklist it writes is the founder's own action list.
 * Reads the LAST `### Submission checklist` block only, so an older release's checklist in the
 * same file cannot be mistaken for the current one's progress.
 */
function readReleaseChecklist(root) {
  const source = readSource(root, REL.releases);
  if (!source.ok) {
    return { ok: false, note: `${source.note} — no release has been prepared yet`, items: [], version: '', done: 0, total: 0 };
  }
  // Codex, PR #15: the `m` flag makes `$` in this lookahead match end-of-LINE, not end-of-input,
  // so the lazy `[\s\S]*?` stopped after the block's first line — a checklist with one checked
  // item and two unchecked ones reported 1/1 done and the Founder Inbox item vanished with real
  // work still outstanding. `(?![\s\S])` is end-of-STRING regardless of the `m` flag (no character
  // of any kind, including newline, can follow), so it isn't affected by multiline mode.
  const heading = /^###\s+Submission checklist\s+—\s+(\S+)/m;
  const blocks = [...source.text.matchAll(/^###\s+Submission checklist\s+—\s+(\S+)[^\n]*\n([\s\S]*?)(?=\n##|\n###|(?![\s\S]))/gm)];
  if (!blocks.length) {
    return { ok: true, note: `no "### Submission checklist" section in ${REL.releases} yet — release-manager writes one when it assembles a candidate`, items: [], version: '', done: 0, total: 0 };
  }
  const [, version, body] = blocks[blocks.length - 1];
  const items = [...body.matchAll(/^-\s+\[( |x|X)\]\s+(.+)$/gm)].map((m) => ({ done: m[1].toLowerCase() === 'x', text: m[2].trim() }));
  return {
    ok: true,
    note: '',
    version,
    items,
    done: items.filter((i) => i.done).length,
    total: items.length,
  };
}

export {
  REL,
  readSource,
  loadLog,
  buildRows,
  stuckItems,
  detailText,
  readChannel,
  readRoster,
  readBugsFile,
  readRounds,
  readReleaseChecklist,
};
