#!/usr/bin/env node
/**
 * messages — the CLI over `docs/team/messages.jsonl`, the team channel's append-only event log.
 *
 * `scripts/team-message.sh` is the front door every agent already knows; it resolves the repository
 * root and calls this. Everything that decides whether a message may exist — the obligation rule and
 * the anti-ping-pong guard — lives in `lib/messages.mjs` and is called from exactly one place here,
 * so `board-doctor` auditing the log and this CLI refusing a send cannot disagree about what a
 * breach is. They used to. Three files, two windows.
 *
 * Usage:
 *   messages.mjs send --from <role> --to <role[,role]> --kind <kind> --summary "<line>"
 *                     [--ticket <ID|->] [--body "<detail>"] [--priority material|fyi]
 *                     [--artifact <ID|path>] [--transition <TICKET:event>] [--decision "<what>"]
 *                     [--evidence "<what changed>"] [--expires-after-round <N>] [--round <N>]
 *                     [--requirements REQ-1,REQ-2] [--channel <name>] [--blocking]
 *                     [--ledger <docs/team/messages.md>]
 *   messages.mjs migrate [--ledger <docs/team/messages.md>] [--force]
 *   messages.mjs render  [--ledger <docs/team/messages.md>]
 *   messages.mjs channels [--ledger ...]              # every channel the log can produce
 *   messages.mjs open [--was <n>] [--escalations] [--json] [--ledger ...]
 *                     # what still owes an answer. `--was <n>` exits 1 if the count did not fall
 *                     # across a Q&A batch (EE-003); `--escalations` exits 1 while any escalation
 *                     # is unclosed, which is the founder's half of the channel (EE-004).
 *   messages.mjs artifact <ADR|PDR|DDR|WAIVER|INCIDENT|ASSUMPTION> --by <role> --title "<line>"
 *                     [--ticket <ID>] [--expires <YYYY-MM-DD>] [--owner <role>]
 *                     [--confidence high|medium|low] [--validate-by <YYYY-MM-DD>] [--body "<text>"]
 *
 * Exit codes:  0 done · 1 refused (guard or obligation; nothing was written) · 2 usage / cannot read
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';

import { parseMessages } from './lib/board.mjs';
import { redact } from './lib/redact.mjs';
import {
  SCHEMA_VERSION,
  KINDS,
  KIND_SET,
  PRIORITIES,
  ASKING_KINDS,
  ARTIFACT_TYPES,
  TICKETLESS,
  toArray,
  threadOf,
  pairQuestions,
  normalize,
  parseMessageLog,
  nextId,
  channelIndex,
  channelsOf,
  guard,
  obligationOf,
  obligationRefusal,
  renderMessages,
  migrate,
  serialize,
} from './lib/messages.mjs';

const die = (message, code = 2) => {
  process.stderr.write(`messages: ${message}\n`);
  process.exit(code);
};

// `nextId()` is necessarily read/compute/write. Without a lock, two parallel agent processes can
// read the same maximum and append duplicate MSG-NNNN records. A lock directory is used because
// mkdir is atomic on the filesystems this plugin supports and the core runtime has no dependency on
// flock. The process-exit hook releases locks even when a validation refusal calls process.exit().
let activeLock = '';
function releaseLogLock() {
  if (!activeLock) return;
  try { rmSync(activeLock, { recursive: true, force: true }); } catch { /* best effort on exit */ }
  activeLock = '';
}
process.on('exit', releaseLogLock);

function acquireLogLock(jsonlPath) {
  mkdirSync(dirname(jsonlPath), { recursive: true });
  const lock = `${jsonlPath}.lock`;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner'), `${process.pid}\n`);
      activeLock = lock;
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') die(`cannot lock ${jsonlPath}: ${error.message}`);
      let owner = 0;
      try { owner = Number.parseInt(readFileSync(join(lock, 'owner'), 'utf8'), 10); } catch { /* partial lock */ }
      if (owner && owner !== process.pid) {
        try {
          process.kill(owner, 0);
        } catch (probe) {
          if (probe.code === 'ESRCH') {
            rmSync(lock, { recursive: true, force: true });
            continue;
          }
        }
      }
      // Atomics.wait is a synchronous, dependency-free sleep; it avoids a busy loop while the
      // other writer completes its read/validate/append/render transaction.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
    }
  }
  die(`could not acquire ${jsonlPath} within 10 seconds — another writer may be stuck`);
}

// A LEGACY LOG WITHOUT A TRAILING NEWLINE MUST GET ONE FIRST. `serialize()` only trails a record
// with `\n`; it never LEADS with one. `appendFileSync` concatenates raw bytes, so a log whose last
// byte is not `\n` — hand-edited, or written by a tool with this same bug — glues the new object
// onto the end of the old line as `}{`, and every reader from that line onward fails with "not
// valid JSON". board.mjs's `append()` had the identical gap; fixed there the same way. Reported
// by codex.
function appendMessage(jsonlPath, candidate) {
  const existing = existsSync(jsonlPath) ? readFileSync(jsonlPath, 'utf8') : '';
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(jsonlPath, `${sep}${serialize(candidate)}`);
}

// --------------------------------------------------------------------------------------------
// arguments — typed, never interpolated into a shell
// --------------------------------------------------------------------------------------------

const FLAGS = new Set([
  '--from', '--to', '--ticket', '--kind', '--summary', '--body', '--ledger', '--priority',
  '--artifact', '--transition', '--decision', '--evidence', '--expires-after-round', '--round',
  '--requirements', '--channel', '--project', '--by', '--title', '--expires', '--owner',
  '--confidence', '--validate-by', '--was',
]);
const BOOLEANS = new Set(['--blocking', '--force', '--quiet', '--json', '--escalations']);

function parseArgs(argv) {
  const out = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (BOOLEANS.has(arg)) {
      out[arg.replace(/^--/, '')] = true;
      continue;
    }
    if (FLAGS.has(arg)) {
      const value = argv[i + 1];
      // A flag whose value is missing must not swallow the next flag: `--summary --kind fyi` would
      // otherwise send a message summarised "--kind".
      if (value === undefined || FLAGS.has(value) || BOOLEANS.has(value)) {
        die(`${arg} needs a value`);
      }
      out[arg.replace(/^--/, '').replace(/-/g, '_')] = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      // RV-039: a mistyped flag silently swallowed drops the message entirely while the sender
      // reports it sent. There is no recovery from a message nobody has.
      die(`unknown argument '${arg}'`);
    }
    positional.push(arg);
  }
  return { options: out, positional };
}

// --------------------------------------------------------------------------------------------
// paths — the .md is the human name everybody already passes; the .jsonl is its sibling
// --------------------------------------------------------------------------------------------

function ledgerPaths(options) {
  const md = resolve(process.cwd(), options.ledger || 'docs/team/messages.md');
  if (!md.endsWith('.md')) die(`--ledger must name the Markdown view (…/messages.md), got ${md}`);
  return { md, jsonl: md.replace(/\.md$/, '.jsonl') };
}

/**
 * Read the log, migrating the Markdown ledger once if that is all this project has.
 *
 * Backwards compatibility is not optional here: every project created before this phase has only
 * `messages.md`, and a tool that refused those projects would strand every one of them. The
 * migration is announced on stderr, happens exactly once, and never runs again because the JSONL now
 * exists. A project with neither file starts empty.
 */
function readLog({ md, jsonl }, { quiet = false } = {}) {
  if (existsSync(jsonl)) {
    const { messages, errors } = parseMessageLog(readFileSync(jsonl, 'utf8'));
    if (errors.length) {
      // Fail closed. A half-readable log rendered as a partial channel is a channel that silently
      // lost messages, and nothing downstream can tell.
      for (const e of errors) process.stderr.write(`messages: ${jsonl}:${e.line}: ${e.reason}\n`);
      die(`${errors.length} unreadable line(s) in ${jsonl} — refusing to treat a damaged log as a channel`);
    }
    return { messages, migrated: false };
  }

  if (!existsSync(md)) return { messages: [], migrated: false };

  const messages = migrate(readFileSync(md, 'utf8'), { parseMessages });
  mkdirSync(dirname(jsonl), { recursive: true });
  writeFileSync(jsonl, messages.map(serialize).join(''));
  if (!quiet) {
    process.stderr.write(
      `messages: MIGRATED ${messages.length} row(s) from ${basename(md)} to ${basename(jsonl)}.\n` +
        `  The JSONL is now the source of truth and the Markdown is generated from it.\n` +
        `  Every migrated record is provenance:"inferred" — priority, status, thread and the\n` +
        `  follow-up round were never recorded in Markdown, so they were reconstructed, not read.\n`
    );
  }
  return { messages, migrated: true };
}

function writeView({ md, jsonl }, messages) {
  mkdirSync(dirname(md), { recursive: true });
  writeFileSync(md, renderMessages(messages));
  return { md, jsonl };
}

// --------------------------------------------------------------------------------------------
// send
// --------------------------------------------------------------------------------------------

/**
 * Credential redaction at the write (S.4). The realistic leak is not exfiltration, it is an agent
 * pasting a working `.env` line into a blocker "so the reviewer can reproduce it". This ledger is
 * committed, GENERATED into Markdown, rendered into the dashboard and quoted in the standup — four
 * artifacts from one paste, and git history makes deleting it later useless.
 *
 * Only the free-text fields go through: `from`/`to`/`kind` are constrained to role and enum shapes,
 * so filtering them could only produce a false positive. Loud on purpose — a silent redaction
 * leaves an operator staring at a truncated string with no idea what removed it.
 */
function scrub(label, value) {
  if (typeof value !== 'string' || !value) return value;
  const { text, redacted } = redact(value);
  if (redacted.length) {
    process.stderr.write(
      `team-message: REDACTED ${redacted.join(', ')} from ${label}. The channel is committed and\n` +
        '  rendered; a credential written here is in git history, where deleting it later does\n' +
        '  nothing. Rotate it if it was real.\n'
    );
  }
  return text;
}

function cmdSend(options) {
  const required = ['from', 'to', 'kind', 'summary'];
  for (const field of required) {
    if (!options[field]) die(`--from, --to, --kind and --summary are required (missing --${field})`);
  }

  const kind = String(options.kind).toLowerCase();
  if (!KIND_SET.has(kind)) die(`--kind must be ${KINDS.join('|')}`);

  const priority = options.priority || (kind === 'fyi' ? 'fyi' : 'material');
  if (!PRIORITIES.has(priority)) die('--priority must be material|fyi');

  const paths = ledgerPaths(options);
  acquireLogLock(paths.jsonl);
  const { messages } = readLog(paths);

  const candidate = normalize(
    {
      id: nextId(messages),
      v: SCHEMA_VERSION,
      ts: new Date().toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z'),
      project: options.project || basename(dirname(dirname(dirname(paths.md)))),
      ticket: options.ticket || TICKETLESS,
      kind,
      from: options.from,
      to: options.to,
      priority,
      blocking: options.blocking === true,
      requires_response: ASKING_KINDS.has(kind),
      expires_after_round: options.expires_after_round
        ? Number.parseInt(options.expires_after_round, 10)
        : ASKING_KINDS.has(kind)
          ? (Number.parseInt(options.round ?? '0', 10) || 0) + 1
          : null,
      round: options.round ? Number.parseInt(options.round, 10) : null,
      requirements: options.requirements,
      artifact: options.artifact,
      transition: options.transition,
      decision: scrub('--decision', options.decision),
      evidence: scrub('--evidence', options.evidence),
      summary: scrub('--summary', options.summary),
      body: scrub('--body', options.body),
      channel: options.channel,
      status: kind === 'question' ? 'open' : 'closed',
    },
    messages.length + 1
  );

  if (candidate.from === candidate.to.join(', ')) die(`refusing a message from ${candidate.from} to itself`);
  if (candidate.to.includes(candidate.from)) die(`refusing a message from ${candidate.from} to itself`);

  // Obligation BEFORE guard: "this message achieves nothing" is a more useful refusal than "you have
  // sent too many of them", and a message with no obligation should never have counted against a
  // budget in the first place.
  if (obligationOf(candidate) === null) {
    const refusal = obligationRefusal(candidate);
    process.stderr.write(`REFUSED (${refusal.code}): ${refusal.reason}.\n${refusal.remedy}\n`);
    process.exit(1);
  }

  const verdict = guard(messages, candidate);
  if (!verdict.ok) {
    process.stderr.write(`REFUSED (${verdict.code}): ${verdict.reason}.\n${verdict.remedy}\n`);
    process.exit(1);
  }

  mkdirSync(dirname(paths.jsonl), { recursive: true });
  appendMessage(paths.jsonl, candidate);
  const { messages: after } = readLog(paths, { quiet: true });
  writeView(paths, after);

  process.stdout.write(
    `SENT: ${candidate.id} ${candidate.from} -> ${candidate.to.join(', ')} ` +
      `[${candidate.ticket}/${candidate.kind}] ${candidate.summary}\n` +
      `  obligation: ${obligationOf(candidate)} · channels: ${channelsOf(candidate).map((c) => `#${c}`).join(' ') || '(none)'}\n`
  );
  if (candidate.kind === 'question') {
    process.stdout.write(
      'NOTE: keep working on another part of the ticket while you wait. Do not BLOCK unless nothing else can proceed.\n'
    );
  }
  return 0;
}

// --------------------------------------------------------------------------------------------
// artifact
// --------------------------------------------------------------------------------------------

/**
 * Create a formal artifact and register it on the log in one step.
 *
 * The file alone is a document nobody knows exists; the message alone is a claim with no content.
 * Both, atomically, is what makes "an answer named the artifact it was folded into" checkable.
 */
function cmdArtifact(type, options) {
  const spec = ARTIFACT_TYPES[type];
  if (!spec) die(`unknown artifact type "${type}" — one of ${Object.keys(ARTIFACT_TYPES).join(', ')}`);
  if (!options.by) die('--by <role> is required: an artifact with no author is an artifact with no owner');
  // AND IT MUST BE A DECLARED WRITER. `--by` was checked only for non-emptiness even though
  // ARTIFACT_TYPES names the permitted writers for each type, so any role could author a WAIVER —
  // the formal exemption every downstream role is instructed to treat as authoritative — and no
  // later check flagged the mismatch. A waiver anyone can write is not an exemption, it is a
  // bypass with paperwork. Reported by codex on PR #13.
  if (Array.isArray(spec.writers) && spec.writers.length && !spec.writers.includes(options.by)) {
    die(`"${options.by}" may not author a ${type} — that belongs to ${spec.writers.join(', ')}.\n` +
      '  An artifact type declares its writers because the artifact carries their authority; an author ' +
      'outside that list is asserting an authority they do not have.');
  }
  if (!options.title) die('--title "<one line>" is required');

  for (const field of spec.requires) {
    const value = options[field];
    if (!value) {
      die(
        `${type} requires --${field.replace(/_/g, '-')}. ` +
          (field === 'expires'
            ? 'A waiver with no expiry is a permanent exemption granted by whoever was in the room that day.'
            : `An ${spec.label} with no ${field.replace(/_/g, ' ')} is nobody's to validate.`)
      );
    }
    if (/^(expires|validate_by)$/.test(field) && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      die(`--${field.replace(/_/g, '-')} must be YYYY-MM-DD, got "${value}"`);
    }
  }

  const paths = ledgerPaths(options);
  acquireLogLock(paths.jsonl);
  const root = dirname(dirname(dirname(paths.md))); // …/docs/team/messages.md -> project root
  const dir = join(root, spec.dir);
  mkdirSync(dir, { recursive: true });

  const existing = existsSync(dir)
    ? readdirSafe(dir)
        .map((f) => Number.parseInt((f.match(new RegExp(`^${type}-(\\d+)`)) || [])[1] ?? '', 10))
        .filter(Number.isFinite)
    : [];
  const number = String((existing.length ? Math.max(...existing) : 0) + 1).padStart(3, '0');
  const id = `${type}-${number}`;
  const slug = String(options.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const file = join(dir, `${id}${slug ? `-${slug}` : ''}.md`);

  const meta = [
    `- **ID:** ${id}`,
    `- **Type:** ${spec.label}`,
    `- **Author:** ${options.by}`,
    `- **Date:** ${new Date().toISOString().slice(0, 10)}`,
    options.ticket ? `- **Ticket:** ${options.ticket}` : null,
    options.expires ? `- **Expires:** ${options.expires}  *(an expired waiver is a finding)*` : null,
    options.owner ? `- **Owner:** ${options.owner}` : null,
    options.confidence ? `- **Confidence:** ${options.confidence}` : null,
    options.validate_by ? `- **Validate by:** ${options.validate_by}` : null,
    `- **Readers:** ${spec.readers.join(', ')}`,
  ].filter(Boolean);

  // GUARD BEFORE THE FILE IS WRITTEN, NOT AFTER. `cmdArtifact` never called `guard()` at all, so a
  // WAIVER (or any artifact) could push a ticket's thread past MAX_CHAIN roles and be accepted —
  // the exact same limit `board-doctor`'s `auditGuards()` enforces retroactively, which meant an
  // artifact could be written clean and then reported as a breach the moment anything re-audited
  // the log. The write-time and audit-time checks are the SAME limit; only one of them was wired
  // to the write path. Reported by codex on PR #13.
  //
  // The candidate is built first — deterministically, from `file`'s path — so `guard()` can run
  // BEFORE any side effect. Writing the .md file first and refusing after would leave an artifact
  // on disk with no ledger entry, which is worse than the bug being fixed: an artifact nothing can
  // find is the same failure as a message nothing delivered.
  const { messages } = readLog(paths);
  const candidate = normalize(
    {
      id: nextId(messages),
      v: SCHEMA_VERSION,
      ts: new Date().toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z'),
      ticket: options.ticket || TICKETLESS,
      kind: type === 'INCIDENT' ? 'blocker' : 'decision',
      from: options.by,
      to: spec.readers,
      priority: 'material',
      artifact: id,
      expires: options.expires,
      owner: options.owner,
      confidence: options.confidence,
      validate_by: options.validate_by,
      summary: `${id}: ${options.title}`,
      body: `${spec.dir}${basename(file)}`,
      channel: 'artifacts',
      status: 'closed',
    },
    messages.length + 1
  );

  const verdict = guard(messages, candidate);
  if (!verdict.ok) {
    process.stderr.write(`REFUSED (${verdict.code}): ${verdict.reason}.\n${verdict.remedy}\n`);
    process.exit(1);
  }

  writeFileSync(
    file,
    `# ${id} — ${options.title}\n\n${meta.join('\n')}\n\n## Context\n\n${
      options.body || '_TODO: what forced this decision._'
    }\n\n## Decision\n\n_TODO_\n\n## Consequences\n\n_TODO_\n`
  );

  mkdirSync(dirname(paths.jsonl), { recursive: true });
  appendMessage(paths.jsonl, candidate);
  const { messages: after } = readLog(paths, { quiet: true });
  writeView(paths, after);

  process.stdout.write(`CREATED: ${id} -> ${spec.dir}${basename(file)}\n  registered as ${candidate.id}\n`);
  return 0;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'send';
  const { options, positional } = parseArgs(argv[0] === command ? argv.slice(1) : argv);

  switch (command) {
    case 'send':
      return cmdSend(options);
    case 'artifact':
      return cmdArtifact(String(positional[0] || '').toUpperCase(), options);
    case 'migrate': {
      const paths = ledgerPaths(options);
      if (existsSync(paths.jsonl) && !options.force) {
        process.stderr.write(`messages: ${paths.jsonl} already exists — nothing to migrate.\n`);
        return 0;
      }
      if (options.force && existsSync(paths.jsonl)) {
        // Re-migrating over a live log would discard every field the CLI recorded and replace it
        // with reconstructions. Refuse rather than downgrade the truth.
        die('--force will not overwrite an existing event log with reconstructed records');
      }
      const { messages } = readLog(paths);
      writeView(paths, messages);
      process.stdout.write(`MIGRATED: ${messages.length} message(s) -> ${paths.jsonl}\n`);
      return 0;
    }
    case 'render': {
      const paths = ledgerPaths(options);
      const { messages } = readLog(paths);
      if (!messages.length) die(`no messages at ${paths.jsonl}. Nothing has been sent yet.`);
      writeView(paths, messages);
      process.stdout.write(`RENDERED: ${messages.length} message(s) -> ${paths.md}\n`);
      return 0;
    }
    case 'channels': {
      const paths = ledgerPaths(options);
      const { messages } = readLog(paths);
      const index = channelIndex(messages);
      if (!index.length) {
        process.stdout.write('no channels — the log carries no messages. A channel is a query, not a place.\n');
        return 0;
      }
      for (const [name, count] of index) process.stdout.write(`#${name}\t${count}\n`);
      return 0;
    }
    /**
     * `open` — how many questions still owe an answer, and which escalations nobody has closed.
     *
     * TWO SEAMS CLOSE HERE, and both were instructions rather than mechanisms (EE-003, EE-004).
     *
     * EE-003. `/app-build` step 1b is, by its own argument, the highest-leverage step in the loop:
     * "a question answered after the wave is spawned is answered too late — the developer has
     * already decided", measured across three dry runs where the live channel was used ZERO times.
     * Its verification was one sentence — "re-render and confirm the count actually fell" — with
     * nothing checking it. A `tech-lead` that returns a thoughtful paragraph instead of `answer`
     * rows produces exactly the shape `report-check.mjs` exists to catch one step below, where the
     * lesson was already learned: reading the report does not catch this.
     *
     * `--was <n>` is that sentence as an exit code. The caller reads the count before it spawns the
     * batch and passes it back afterwards; if the count did not fall, exit 1.
     *
     * EE-004. `team-protocol` requires every escalation to `tech-manager` to be "resolved or passed
     * to the user in the same round", and `/app-run` surfaces "only blockers and the two human
     * gates". An escalation is not a blocker in that sense — the ticket that raised it keeps moving
     * — so in the studio's designed mode an escalation was written to a ledger, counted by a
     * renderer, and read by nobody. `--escalations` gives the autonomous driver a non-zero exit to
     * act on, which is the only kind of instruction it has been shown to follow.
     *
     * Exit: 0 nothing owed (or the count fell) · 1 something owes an answer · 2 no ledger yet.
     */
    case 'open': {
      const paths = ledgerPaths(options);
      if (!existsSync(paths.jsonl)) {
        process.stdout.write(`OPEN: CANNOT EVALUATE — no ledger at ${paths.jsonl}.\n  Normal in round 1; a missing ledger is not an empty one.\n`);
        return 2;
      }
      const { messages } = readLog(paths);
      const byThread = new Map();
      for (const m of messages) {
        const t = m.thread || threadOf(m);
        if (!byThread.has(t)) byThread.set(t, []);
        byThread.get(t).push(m);
      }
      const open = [];
      for (const thread of byThread.values()) open.push(...pairQuestions(thread).open);

      // An escalation is closed by a `decision` on the same thread — the same pairing rule the
      // renderer's DELIVERY block uses, so there is one answer to "is this still open" and not two.
      const escalations = [];
      for (const thread of byThread.values()) {
        const raised = thread.filter((m) => m.kind === 'escalation');
        const decided = thread.filter((m) => m.kind === 'decision').length;
        escalations.push(...raised.slice(decided));
      }

      if (options.json) {
        process.stdout.write(`${JSON.stringify({
          schema: 'messages-open/v1', open: open.length, escalations: escalations.length,
          questions: open.map((m) => ({ id: m.id, ticket: m.ticket, from: m.from, to: m.to, summary: m.summary })),
          escalated: escalations.map((m) => ({ id: m.id, ticket: m.ticket, from: m.from, to: m.to, summary: m.summary })),
        }, null, 2)}\n`);
      } else {
        process.stdout.write(`OPEN QUESTIONS: ${open.length}\n`);
        for (const m of open) process.stdout.write(`  ${m.id}  ${m.ticket}  ${m.from} -> ${toArray(m.to).join(',')}  ${m.summary}\n`);
        if (escalations.length) {
          process.stdout.write(`\nUNCLOSED ESCALATIONS: ${escalations.length} — these are the founder's, not the team's\n`);
          for (const m of escalations) process.stdout.write(`  ${m.id}  ${m.ticket}  ${m.from}: ${m.summary}\n`);
          process.stdout.write(
            '  team-protocol: an escalation is resolved or passed to the user IN THE SAME ROUND.\n' +
            '  Close one by appending a `decision` that names the artifact it changed.\n'
          );
        }
      }

      // `--escalations` narrows the exit code to the founder-facing half, so /app-run can surface
      // exactly those without stopping for every ordinary open question mid-sprint.
      if (options.escalations) return escalations.length ? 1 : 0;

      if (options.was !== undefined) {
        const was = Number(options.was);
        if (!Number.isFinite(was)) return die('--was takes the open-question count you read BEFORE the batch');
        if (open.length >= was && was > 0) {
          process.stderr.write(
            `messages: the batch answered NOTHING — ${was} open before, ${open.length} open now.\n` +
            '  tech-lead wrote prose instead of ledger rows, and the next wave is about to inherit\n' +
            '  the same guesses. Re-spawn it with the batch and require one `answer` row per question\n' +
            '  it can settle, and ONE `escalation` covering everything it cannot (team-protocol\n' +
            '  §Mid-sprint Q&A). Do not proceed to step 2 on an unfallen count.\n'
          );
          return 1;
        }
        return 0;
      }
      return open.length ? 1 : 0;
    }
    default:
      return die(`unknown command "${command}" — send | migrate | render | channels | artifact | open`);
  }
}

// `main()` RETURNS an exit code and nothing was reading it — every `return 1` in the switch above
// was decorative, and `messages.mjs open --was 1` reported the refusal on stderr while exiting 0.
// A caller branching on that exit code would have proceeded through a batch that answered nothing.
// The existing commands were unaffected only because they exit through `die()`, which calls
// process.exit itself — so the hole was invisible until a command needed a non-zero SUCCESS path.
process.exit(main() ?? 0);
