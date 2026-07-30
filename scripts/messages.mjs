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
 *   messages.mjs artifact <ADR|PDR|DDR|WAIVER|INCIDENT|ASSUMPTION> --by <role> --title "<line>"
 *                     [--ticket <ID>] [--expires <YYYY-MM-DD>] [--owner <role>]
 *                     [--confidence high|medium|low] [--validate-by <YYYY-MM-DD>] [--body "<text>"]
 *
 * Exit codes:  0 done · 1 refused (guard or obligation; nothing was written) · 2 usage / cannot read
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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

// --------------------------------------------------------------------------------------------
// arguments — typed, never interpolated into a shell
// --------------------------------------------------------------------------------------------

const FLAGS = new Set([
  '--from', '--to', '--ticket', '--kind', '--summary', '--body', '--ledger', '--priority',
  '--artifact', '--transition', '--decision', '--evidence', '--expires-after-round', '--round',
  '--requirements', '--channel', '--project', '--by', '--title', '--expires', '--owner',
  '--confidence', '--validate-by',
]);
const BOOLEANS = new Set(['--blocking', '--force', '--quiet']);

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
  appendFileSync(paths.jsonl, serialize(candidate));
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

  writeFileSync(
    file,
    `# ${id} — ${options.title}\n\n${meta.join('\n')}\n\n## Context\n\n${
      options.body || '_TODO: what forced this decision._'
    }\n\n## Decision\n\n_TODO_\n\n## Consequences\n\n_TODO_\n`
  );

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

  mkdirSync(dirname(paths.jsonl), { recursive: true });
  appendFileSync(paths.jsonl, serialize(candidate));
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
    default:
      return die(`unknown command "${command}" — send | migrate | render | channels | artifact`);
  }
}

main();
