#!/usr/bin/env node
/**
 * trace — the product-intent graph, the conflicts across it, and the founder gates it trips.
 *
 * The team derives criteria from its own PRD and tests them against its own criteria. Every gate in
 * this repo checks that the derivation is INTERNALLY consistent; nothing checked that the chain
 * exists at all. A requirement with no criterion, a criterion with no test, a ticket attached to no
 * requirement and a decision that reached no artifact are all invisible to a green board.
 *
 * Three sections, one exit contract:
 *
 *   trace       the graph: does every node have a source, a verifier, and a downstream?
 *   conflicts   two documents asserting different values for the same claim, resolved BY RULE and
 *               reported — or refused when the rule cannot separate them
 *   gates       the eight conditional founder gates, each detected rather than described
 *
 * The board is read through scripts/lib/board.mjs. One parser: a second reading of the board is how
 * the last four fail-open gates in this repo got written.
 *
 * Usage:  node scripts/trace.mjs [--project-root <dir>] [--only trace|conflicts|gates] [--json]
 * Exit:   0 clean · 1 findings · 2 cannot evaluate
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { parseBoard, parseMessages, isEmpty, hasShipped } from './lib/board.mjs';

// --- args ----------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const ROOT = value('--project-root', '.');
const ONLY = value('--only', 'all');
const JSON_OUT = flag('--json');

if (!['all', 'trace', 'conflicts', 'gates'].includes(ONLY)) {
  process.stderr.write(`trace: --only takes trace|conflicts|gates, not "${ONLY}".\n`);
  process.exit(2);
}

const findings = [];
const unevaluable = [];
const add = (code, where, detail, action) => findings.push({ code, where, detail, action });
const cannot = (what, why) => unevaluable.push({ what, why });

// --- load ------------------------------------------------------------------------------------------

const DOCS = join(ROOT, 'docs');
if (!existsSync(DOCS)) {
  finish(2, `CANNOT EVALUATE — no docs/ under ${ROOT}. There is no product record to trace.`);
}

/** Every markdown file under docs/, POSIX-spelled relative to the project root. */
function docFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d).sort()) {
      if (entry.startsWith('.')) continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.md$/.test(entry)) out.push(p);
    }
  };
  walk(dir);
  return out.map((p) => ({ rel: relative(ROOT, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }));
}

const docs = docFiles(DOCS);
const BOARD = 'docs/31-board.md';
const boardDoc = docs.find((d) => d.rel === BOARD);

// --- the node grammar --------------------------------------------------------------------------------
//
// A node DECLARES itself when its ID is the first token on its line or in its first non-empty table
// cell; anywhere else on the line it is a REFERENCE. That single rule is what stops the backlog's
// `- APP-001 [F-001] Export` counting as a second definition of F-001 — which it would, and then a
// requirement declared in two documents could disagree with itself and both halves look traced.

const ID = '(?:AC|EV|[GOFSDTER])-\\d+';
const DECLARES = new RegExp(`^\\s*(?:[-*]\\s+)?\\|?\\s*\\**\\[(${ID})\\]`);
const REFERS = new RegExp(`\\[(${ID})\\]`, 'g');
const KIND = { G: 'goal', O: 'outcome', F: 'requirement', S: 'story', AC: 'criterion', D: 'design', T: 'test', E: 'evidence', EV: 'analytics', R: 'release' };
const kindOf = (id) => KIND[id.replace(/-\d+$/, '')];

// A token runs to the next cell or separator. `·` is this repo's in-cell separator.
const token = (line, name) => {
  const m = line.match(new RegExp(`\\b${name}:\\s*([^|·\\n]+)`));
  return m ? m[1].trim().replace(/\s+$/, '') : null;
};
const idsIn = (text) => (text ? text.match(new RegExp(ID, 'g')) || [] : []);

const STATES = {
  requirement: ['satisfied', 'violated', 'unverified'],
  criterion: ['satisfied', 'violated', 'unverified'],
  design: ['approved', 'revision-required', 'not-reviewed'],
  analytics: ['observed', 'incorrect', 'no-event-data'],
};
const DEFAULT_STATE = { requirement: 'unverified', criterion: 'unverified', design: 'not-reviewed', analytics: 'no-event-data' };

const nodes = new Map();      // id -> node
const claims = [];            // {key, value, file, line, text}

for (const doc of docs) {
  // The board is a node source too, but it is read through lib/board.mjs below. Scanning its cells
  // here as well would be the second parser this repo keeps being bitten by.
  if (doc.rel === BOARD) continue;
  doc.text.split(/\r?\n/).forEach((line, i) => {
    const claim = line.match(/\bclaim:\s*([a-z][a-z0-9-]*)\s*=\s*([^|·\n]+)/i);
    if (claim) claims.push({ key: claim[1].toLowerCase(), value: claim[2].trim(), file: doc.rel, line: i + 1, text: line.trim() });

    const declared = line.match(DECLARES);
    if (!declared) return;
    const id = declared[1];
    const kind = kindOf(id);
    const node = {
      id,
      kind,
      file: doc.rel,
      line: i + 1,
      src: token(line, 'src'),
      ver: token(line, 'ver'),
      state: token(line, 'state'),
      rev: token(line, 'rev'),
      refs: [...line.matchAll(REFERS)].map((m) => m[1]).filter((r) => r !== id),
      text: line.trim(),
    };
    node.srcIds = idsIn(node.src);
    if (nodes.has(id)) {
      add('node_declared_twice', `${doc.rel}:${i + 1}`,
        `${id} is declared here and again at ${nodes.get(id).file}:${nodes.get(id).line}. Two declarations can disagree, and whichever a reader reaches second silently wins.`,
        'Keep one declaration; make the other a reference (do not lead the line with the ID).');
      return;
    }
    nodes.set(id, node);
  });
}

// A NODE'S SOURCES MUST EXIST.
//
// `srcIds` was parsed and then only ever used in the reverse direction — `sourcedBy()` asks who
// points AT a node, and nothing asked whether what a node points at is real. So changing a
// requirement from `src: O-001` to `src: O-999` left `--only trace` exiting 0, as long as the
// requirement still had a criterion and a test: the chain no longer reached any outcome, and the
// tool that exists to prove the chain is unbroken reported it TRACED.
//
// A dangling source is worse than a missing one. A node with no `src` is visibly unsourced; a node
// citing O-999 looks sourced to every reader and to every generated view. Reported by codex on PR #10.
//
// Deliberately NOT enforced here: that each source is of the correct UPSTREAM KIND (outcome ← goal,
// requirement ← outcome, and so on). That contract is currently prose spread across the skills
// rather than declared in one place, and inventing it inside the validator would produce confident
// false blocks on projects that spell the chain slightly differently. Existence is unambiguous
// today; the kind contract needs the chain declared once, first.
for (const node of nodes.values()) {
  for (const src of node.srcIds) {
    if (nodes.has(src)) continue;
    add('source_undeclared', `${node.file}:${node.line}`,
      `${node.id} cites src: ${src}, which is not declared anywhere. The chain above ${node.id} does not reach a goal — it stops at an ID that does not exist, while looking sourced to every reader and every generated view.`,
      `Declare ${src}, or correct ${node.id}'s src to the node it is actually derived from.`);
  }
}

const byKind = (k) => [...nodes.values()].filter((n) => n.kind === k);
const sourcedBy = (id) => [...nodes.values()].filter((n) => n.srcIds.includes(id));

// --- the board -----------------------------------------------------------------------------------

// Only the trace section reads the board, so only the trace section may report it missing. Reporting
// it under `--only gates` made the gates verdict CANNOT EVALUATE for a reason the gates do not
// depend on — a section reporting someone else's missing input is a fail-closed check firing in the
// wrong place, and it reads exactly like a real one.
let tickets = [];
const wantsTrace = ONLY === 'all' || ONLY === 'trace';
if (!wantsTrace) {
  tickets = boardDoc ? parseBoard(boardDoc.text).rows : [];
} else if (!boardDoc) {
  cannot('the ticket half of the graph', `${BOARD} does not exist, so no ticket, no shipped code and no analytics coverage can be checked.`);
} else {
  tickets = parseBoard(boardDoc.text).rows;
  if (tickets.length === 0) {
    cannot('the ticket half of the graph', `${BOARD} parsed to zero rows — the table header is missing or renamed. An empty parse is not an empty board.`);
  }
}

// =================================================================================================
// section: trace
// =================================================================================================

if (ONLY === 'all' || ONLY === 'trace') {
  // Every material scope decision must point at the founder record. A goal sourced from a derived
  // document, or from nothing, is a goal the team invented — and an invented goal is traceable,
  // testable, evidenced, and not what anybody asked for.
  for (const goal of byKind('goal')) {
    if (!goal.src || !/00-founder-intent\//.test(goal.src)) {
      add('goal_no_founder_source', `${goal.file}:${goal.line}`,
        `${goal.id} names no source in docs/00-founder-intent/ (src: ${goal.src || 'absent'}). Every document below it will be validated against this goal, and the goal is validated against nothing.`,
        'Point src: at the file in the founder record that states it, or take the goal to the founder before anything derives from it.');
    }
  }

  for (const req of byKind('requirement')) {
    const criteria = sourcedBy(req.id).filter((n) => n.kind === 'criterion');
    if (criteria.length === 0) {
      add('requirement_no_criterion', `${req.file}:${req.line}`,
        `${req.id} has no acceptance criterion sourced from it. Nothing states what "done" means, so whatever gets built satisfies it by construction.`,
        `Write at least one [AC-NNN] with src: ${req.id}, or delete the requirement.`);
    }
  }

  for (const crit of byKind('criterion')) {
    const tests = sourcedBy(crit.id).filter((n) => n.kind === 'test');
    const named = idsIn(crit.ver).some((v) => kindOf(v) === 'test' && nodes.has(v));
    if (tests.length === 0 && !named) {
      add('criterion_no_test', `${crit.file}:${crit.line}`,
        `${crit.id} is verified by no test — no [T-NNN] names it as src: and its own ver: names no declared test. The criterion is an assertion nobody executes.`,
        `Add a test in docs/50-test-plan.md with src: ${crit.id}, and name it in this criterion's ver:.`);
    }
  }

  // Stale coverage: the requirement moved after the tests were written, so the tests pass against a
  // requirement that no longer exists. Green, and about the wrong thing.
  for (const req of byKind('requirement')) {
    if (!req.rev) continue;
    const tests = sourcedBy(req.id)
      .filter((n) => n.kind === 'criterion')
      .flatMap((c) => sourcedBy(c.id).filter((n) => n.kind === 'test'));
    const dated = tests.filter((t) => t.rev);
    if (dated.length === 0) continue;
    const stale = dated.filter((t) => t.rev < req.rev);
    if (stale.length === dated.length) {
      add('stale_coverage', `${req.file}:${req.line}`,
        `${req.id} changed on ${req.rev}; every test covering it (${stale.map((t) => `${t.id}@${t.rev}`).join(', ')}) was written earlier. Those tests are green about the previous requirement.`,
        'Re-derive the criteria and tests from the current requirement, then stamp their rev:.');
    }
  }

  if (tickets.length > 0) {
    const featureOf = (row) => (isEmpty(row.feature) ? '' : String(row.feature).trim());

    for (const row of tickets) {
      const f = featureOf(row);
      if (!f) {
        add('ticket_no_requirement', `${BOARD}:${row._line}`,
          `${row.id} names no feature. A ticket attached to no requirement is work nobody asked for, and it merges through every gate this repo has.`,
          'Set the Feature cell to the F-NNN it implements, or take the ticket off the board.');
      } else if (!nodes.has(f)) {
        add('ticket_no_requirement', `${BOARD}:${row._line}`,
          `${row.id} names feature ${f}, which is declared nowhere in docs/. The ticket cites a requirement that does not exist, so its acceptance criteria came from somewhere else.`,
          `Declare [${f}] in docs/10-prd.md, or point the ticket at the requirement it really implements.`);
      }
    }

    // THE REVERSE EDGE. Every check above walks the graph FORWARD — this ticket names a
    // requirement, that requirement has a criterion, that criterion has a test. Walking forward
    // proves nothing about coverage: it can only report on things that already have a ticket. A
    // requirement that is in scope and that NOTHING implements is invisible to all of it, because
    // there is no ticket from which to start walking.
    //
    // This is defect-hunting §4b at scope level. Following the value forward proves the pointer is
    // valid; only following it BACK proves nothing was dropped. Where is scope written, where is it
    // read, and are they the same set?
    //
    // Silence is not a defer. A requirement may be implemented, explicitly deferred, or explicitly
    // rejected — the last two by a role with the authority to make that call (docs/03-decision-rights.md).
    // What it may not be is unmentioned, because unmentioned is indistinguishable from forgotten,
    // and forgotten is exactly what the founder finds out about at release.
    const implemented = new Set(tickets.map(featureOf).filter(Boolean));
    // A STRUCTURED FIELD, NOT A WORD SEARCH.
    //
    // The first version matched free prose for "deferred|rejected|out of scope|not in v1". Ordinary
    // requirement text satisfies that by accident: "the user can see which invitations were
    // REJECTED", "a card that is NOT IN V1 currency format". Both were in scope, unimplemented,
    // cited by no ticket, and silently exempted — the exact outcome this check exists to prevent,
    // granted by the check itself. FC-002: a rule satisfied by prose ABOUT the thing.
    //
    // It also asked for more than it enforced. The remedy text demanded the deciding role, and the
    // regex never looked for one — so the rule taught a discipline it did not require, which is how
    // a convention quietly stops being followed.
    //
    // The lesson this repo keeps re-learning, third time in two days: prose is not checkable; a
    // field is. Same move as the eval manifests' enumerated `status`.
    const DISPOSITION = /\(disposition:\s*(deferred|out-of-scope|rejected)\s*,\s*by:\s*([a-z][a-z0-9-]*)\s*\)/i;
    for (const req of byKind('requirement')) {
      if (implemented.has(req.id)) continue;
      const disposed = DISPOSITION.exec(req.text || '');
      if (disposed) continue; // disposed of in a parseable field, naming the role that decided it
      add('requirement_not_implemented', `${req.file}:${req.line}`,
        `${req.id} is declared in scope and no board row implements it. Every forward check passes — ` +
        'there is simply no ticket to walk forward FROM, so the requirement is invisible to all of them. ' +
        'This is how a promised feature reaches release having never been built.',
        `Add a ticket whose Feature cell is ${req.id}, or record the disposition in the requirement ` +
        'line as a parseable field naming the role that decided it: ' +
        '`(disposition: deferred|out-of-scope|rejected, by: <role>)`.');
    }

    const boardText = tickets.map((r) => Object.values(r).join(' ')).join('\n');
    for (const design of byKind('design')) {
      if (!new RegExp(`\\b${design.id}\\b`).test(boardText)) {
        add('design_no_ticket', `${design.file}:${design.line}`,
          `${design.id} is a designed screen that no board row names. It was designed, reviewed, and nobody was ever asked to build it — the loop drains and the screen does not exist.`,
          `Add a ticket whose Spec cell names ${design.id}, or record the screen as out of scope.`);
      }
    }

    // Shipped code with no analytics event. The KPI half of the vision is asserted by the feature
    // list and delivered by nothing; nobody finds out until the post-launch review has no numbers.
    // hasShipped, not a status test: a merge-gated ticket awaiting the wave has NOT shipped, and
    // saying it has is how a founder is told a feature landed that is still on its own branch (N1).
    const shipped = new Set(tickets.filter((r) => hasShipped(r)).map(featureOf).filter(Boolean));
    for (const f of shipped) {
      if (!nodes.has(f)) continue; // already reported as ticket_no_requirement
      const events = sourcedBy(f).filter((n) => n.kind === 'analytics');
      if (events.length === 0) {
        add('code_no_analytics', `${BOARD}`,
          `${f} has shipped code (a ticket at done/qa) and no analytics event sourced from it. Whatever it does to the funnel is unobservable, and the outcome it was built to move cannot be measured.`,
          `Declare [EV-NNN] in docs/52-analytics.md with src: ${f}, and pair the ticket with its analytics ticket.`);
      }
    }
  }

  // DR4-006, made structural. A decision recorded on the channel and folded into no artifact is a
  // decision the implementer never receives: the ledger renders green and the developer still
  // guesses. "Reached an artifact" means the row names a doc path or a node ID that exists.
  const LEDGER = 'docs/team/messages.md';
  const ledgerDoc = docs.find((d) => d.rel === LEDGER);
  if (!ledgerDoc) {
    cannot('the decision half of the graph', `${LEDGER} does not exist, so no recorded decision can be followed to an artifact.`);
  } else {
    for (const msg of parseMessages(ledgerDoc.text)) {
      if (msg.kind !== 'decision') continue;
      const body = `${msg.summary} ${msg.body}`;
      const namesDoc = /docs\/[\w./*-]+\.(md|jsonl|html)/.test(body);
      const namesNode = idsIn(body).some((id) => nodes.has(id));
      const namesTicket = msg.ticketId && tickets.some((r) => r.id === msg.ticketId.replace(/`/g, '').trim());
      if (!namesDoc && !namesNode && !namesTicket) {
        add('decision_no_artifact', `${LEDGER}:${msg._line}`,
          `The decision "${msg.summary}" (${msg.timestamp}, ${msg.from} -> ${msg.to}) names no artifact, no node and no ticket on the board. It was recorded and it reached nothing — the ledger is green and the implementer never received it.`,
          'Name the document the decision was folded into, or the node/ticket it changed, in the message body.');
      }
    }
  }

  // The third state, everywhere. An absent state is never the good one.
  for (const node of nodes.values()) {
    const vocab = STATES[node.kind];
    if (!vocab) continue;
    if (node.state && !vocab.includes(node.state)) {
      add('state_invalid', `${node.file}:${node.line}`,
        `${node.id} carries state "${node.state}", which is not one of ${vocab.join(' · ')}. A word outside the vocabulary is read by nothing, so the artifact has no state at all — and no state reads as a fine one.`,
        `Use one of: ${vocab.join(' · ')}. The third value is the honest one when nobody has looked.`);
    }
  }
}

// =================================================================================================
// section: conflicts
// =================================================================================================

// Highest authority first. A conflict is resolved by the rank of the document asserting it, and the
// rule that resolved it is printed with both sides — the team never picks silently.
const PRECEDENCE = [
  [/^docs\/00-founder-intent\//, 'latest founder decision'],
  [/^docs\/team\/messages\.md$/, 'approved decision record'],
  [/^docs\/10-prd\.md$/, 'scope-locked PRD'],
  [/^docs\/20-architecture\.md$/, 'SRS'],
  [/^docs\/1[234]-/, 'design'],
  [/^docs\/22-impl-spec-/, 'impl notes'],
];
const rankOf = (file) => {
  const i = PRECEDENCE.findIndex(([re]) => re.test(file));
  return i === -1 ? { rank: PRECEDENCE.length, name: 'agent assumption' } : { rank: i, name: PRECEDENCE[i][1] };
};

if (ONLY === 'all' || ONLY === 'conflicts') {
  const byKey = new Map();
  for (const c of claims) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push({ ...c, ...rankOf(c.file) });
  }
  for (const [key, all] of byKey) {
    const distinct = [...new Set(all.map((c) => c.value.toLowerCase()))];
    if (distinct.length < 2) continue;
    const sorted = [...all].sort((a, b) => a.rank - b.rank);
    const top = sorted[0];
    const loser = sorted.find((c) => c.value.toLowerCase() !== top.value.toLowerCase());
    if (loser.rank === top.rank) {
      add('conflict_unresolvable', `${top.file}:${top.line}`,
        `"${key}" is asserted as "${top.value}" here and as "${loser.value}" at ${loser.file}:${loser.line}. Both sides are ${top.name}, so no precedence rule separates them. Refusing: a tool that picks one anyway has invented the answer.`,
        'Take both sides to the founder and record the decision in docs/00-founder-intent/decisions.md, which outranks everything.');
    } else {
      add('conflict_resolved', `${loser.file}:${loser.line}`,
        `"${key}" = "${loser.value}" here (${loser.name}) contradicts "${top.value}" at ${top.file}:${top.line} (${top.name}). RULE: ${top.name} outranks ${loser.name}, so "${top.value}" holds. The losing document is wrong and is still being read.`,
        `Correct ${loser.file} to "${top.value}", or escalate if the lower document is the one that is right.`);
    }
  }
}

// =================================================================================================
// section: gates
// =================================================================================================
//
// Each trigger is DETECTED, not described: a pattern, over a named set of documents, cleared only by
// an append-only founder decision. Detection is deliberately fail-closed — a trigger that fires
// without an approval stops the loop and costs one line in decisions.md; a trigger that does not
// fire costs a pricing change nobody approved.

const GATE_TRIGGERS = [
  { id: 'pricing', where: /^docs\/(41-monetization|10-prd)\.md$/,
    pattern: /(?:[$£€]\s?\d+(?:[.,]\d{2})?\s*(?:\/|per\s+|a\s+)\s*(?:month|year|mo|yr|week))|\bsubscription tier\b|\bprice\s*=/i,
    why: 'pricing or subscription change' },
  { id: 'sensitive-data', where: /^docs\//,
    pattern: /\b(health(?:kit)? data|biometrics?|precise location|contact list|payment card|government id|children under 13)\b/i,
    why: 'new sensitive-data collection' },
  { id: 'destructive-migration', where: /^docs\//,
    pattern: /\b(drop table|drop column|destructive ?migration|fallbackToDestructiveMigration|delete all user data|drop and recreate)\b/i,
    why: 'destructive migration' },
  { id: 'account-deletion', where: /^docs\//,
    pattern: /\b(account deletion|delete (?:the |their |your )?account|erase all (?:user )?data)\b/i,
    why: 'account-deletion behaviour' },
  { id: 'legal-disclosure', where: /^docs\//,
    pattern: /\b(privacy policy|terms of service|EULA|export compliance)\b/i,
    why: 'legal disclosure' },
  { id: 'visual-direction', where: /^docs\/1[34]-/,
    pattern: /\bclaim:\s*visual-direction\s*=/i,
    why: 'major visual-direction change' },
  { id: 'paid-infrastructure', where: /^docs\/(20-architecture|23-git-strategy)\.md$/,
    pattern: /\b(blaze plan|paid tier|billing account|reserved instance|[$£€]\s?\d+\s*\/\s*month)\b/i,
    why: 'paid infrastructure commitment' },
  // Dry run 5 (both the Android and Daily Reading Log fixtures, 2026-08-01): this used to scan
  // ANY file under docs/ for the bare string `WAIVED:`, so a roster template's own explanatory
  // prose about waiver syntax — instructional text, not a real waiver — tripped a founder gate the
  // project never actually needed approval for. `WAIVED:` has exactly one legitimate home:
  // `docs/60-releases.md` is the only file `ship-gate.sh`'s `waiver_for()` ever reads, and every
  // doc describing how to write a waiver says to append it there. Scoping the trigger to that one
  // file is not a narrower heuristic, it is the actual shape of a real waiver record.
  { id: 'waiver', where: /^docs\/60-releases\.md$/,
    pattern: /\bWAIVED:/,
    why: 'a waiver of a failed or unavailable gate' },
];

if (ONLY === 'all' || ONLY === 'gates') {
  const intentDir = join(ROOT, 'docs/00-founder-intent');
  const decisions = existsSync(intentDir)
    ? docFiles(intentDir).map((d) => d.text).join('\n')
    : null;
  if (decisions === null) {
    cannot('the conditional founder gates', 'docs/00-founder-intent/ does not exist, so no trigger can be cleared and none can be shown to have been approved.');
  }
  // AN APPROVAL IS ABOUT A VALUE, NOT ABOUT A TOPIC.
  //
  // This was `approved(id)` — does `FOUNDER DECISION: pricing` appear anywhere in the record? If it
  // did, the pricing gate was cleared FOREVER. Approve $3.99/month once and the PRD could be
  // changed to $99/month with the gate still exiting clean, because the check never looked at the
  // value it was clearing. The same defect let one waiver authorize every subsequent waiver, which
  // is the more dangerous half: a waiver is by definition the thing you grant narrowly.
  //
  // The approval must therefore QUOTE what it approves. `subject()` pulls the distinctive text out
  // of the triggering line — the matched value for a value trigger, and for `WAIVED:` the reason
  // that follows it, since the keyword itself carries no information. A decision clears a trigger
  // only if it names the trigger AND contains that subject.
  //
  // This is FC-005's shape — "approved" as a claim about a moment rather than about a diff — and
  // the evaluation lab has been carrying `stale-approval` as an undetectable planted defect for
  // exactly this reason. Reported by codex on PR #10.
  const subject = (trigger, line) => {
    const m = trigger.pattern.exec(line);
    if (!m) return '';
    if (trigger.id === 'waiver') {
      const after = line.slice(line.indexOf(m[0]) + m[0].length).trim();
      return after.slice(0, 80);
    }
    return m[0].trim();
  };

  // A decision covers a subject when SOME line naming this trigger also contains it. Line-scoped on
  // purpose: matching across the whole file would let an unrelated decision elsewhere in the record
  // satisfy this one by coincidence.
  const covers = (id, subj) => {
    if (decisions === null || !subj) return false;
    const re = new RegExp(`FOUNDER DECISION:\\s*${id}\\b`);
    return decisions.split(/\r?\n/).some((l) => re.test(l) && l.includes(subj));
  };

  for (const trigger of GATE_TRIGGERS) {
    for (const doc of docs) {
      if (doc.rel.startsWith('docs/00-founder-intent/')) continue; // the record states, it does not decide
      if (!trigger.where.test(doc.rel)) continue;
      const lines = doc.text.split(/\r?\n/);
      const hit = lines.findIndex((l) => trigger.pattern.test(l));
      if (hit === -1) continue;
      const subj = subject(trigger, lines[hit]);
      if (covers(trigger.id, subj)) continue;
      const namedButUncovered =
        decisions !== null && new RegExp(`FOUNDER DECISION:\\s*${trigger.id}\\b`).test(decisions);
      add('founder_gate_required', `${doc.rel}:${hit + 1}`,
        `TRIGGER ${trigger.id} — ${trigger.why} — detected: "${lines[hit].trim().slice(0, 120)}". ` +
          (namedButUncovered
            ? `The record HAS a "${trigger.id}" decision, but none of them names "${subj}" — an approval of some earlier value does not authorize this one.`
            : 'No founder decision covers it, and this is not a call an agent gets to make.'),
        `Stop the loop, put it to the founder, and record: "<date> FOUNDER DECISION: ${trigger.id} — ${subj} — <what was decided>" in docs/00-founder-intent/decisions.md. The line must quote "${subj}", because that is what makes the approval about this change rather than about the topic.`);
      break; // one finding per trigger; the founder decides the trigger, not each line of it
    }
  }
}

// --- report ------------------------------------------------------------------------------------------

finish(findings.length > 0 ? 1 : unevaluable.length > 0 ? 2 : 0);

function finish(code, headline) {
  const verdict = code === 0 ? 'TRACED' : code === 1 ? 'FINDINGS' : 'CANNOT EVALUATE';
  const line = headline || (code === 0
    ? `TRACED — ${nodes.size} node(s), ${tickets.length} ticket(s), no break in the chain.`
    : code === 1
      ? `FINDINGS — ${findings.length} break(s) in the intent chain${unevaluable.length ? `, and ${unevaluable.length} section(s) that could not be evaluated` : ''}.`
      : `CANNOT EVALUATE — ${unevaluable.length} section(s) had no input to read. This is not a pass.`);
  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify({ ok: code === 0, verdict, exit: code, headline: line, findings, unevaluable }, null, 2)}\n`);
  } else {
    process.stdout.write(`TRACE — ${line}\n`);
    for (const f of findings) process.stdout.write(`\n  ${f.code}  (${f.where})\n     ${f.detail}\n     -> ${f.action}\n`);
    for (const u of unevaluable) process.stdout.write(`\n  CANNOT EVALUATE  ${u.what}\n     ${u.why}\n`);
  }
  process.exit(code);
}
