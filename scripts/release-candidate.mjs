#!/usr/bin/env node
/**
 * release-candidate — the immutable dossier that says exactly what is being shipped, and why.
 *
 * WHAT WAS MISSING. Ship status was an OVERWRITTEN verdict file: the least durable shape available
 * for the most consequential claim the studio makes. Nothing could answer "which exact build is
 * being prepared, and what evidence supports it" after the next run had replaced the answer. A
 * founder asked to approve a submission was approving a sentence, not a subject.
 *
 * The four identities the audit asked for end here:
 *
 *     project_id -> work_contract_id -> work_candidate_id -> release_candidate_id
 *
 * A release candidate names the commit, the tickets it contains, the gate results bound to that
 * commit, and the digest of every artifact. Append-only and hash-chained through the same primitive
 * as the board, so a dossier cannot be quietly revised after someone has read it.
 *
 * WHY IT REFUSES A DIRTY TREE. A candidate assembled from uncommitted work names a state that
 * exists on exactly one machine and in no commit. It could never be re-established, by anyone,
 * including the person who built it — so its evidence can never be re-checked. That is not a
 * candidate; it is a description of somebody's afternoon.
 *
 *   release-candidate.mjs create [--root <dir>] [--version <v>]
 *   release-candidate.mjs show   [--root <dir>] [--id <rc>] [--json]
 *
 * Exit: 0 created/shown · 1 refused · 2 cannot evaluate
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { withFileLock } from './lib/atomic.mjs';
import { reduceReadiness } from './lib/readiness.mjs';
import { EXIT, refuse } from './lib/cli.mjs';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const NAME = 'release-candidate';
const die = (code, message) => { process.stderr.write(`${NAME}: ${message}\n`); process.exit(code); };
const { flags, positional } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['root', 'version', 'id', 'ledger']), die });
const command = positional[0];
const root = resolve(String(flags.root || '.'));
const ledger = resolve(root, String(flags.ledger || 'docs/team/release-candidates.jsonl'));

const git = (args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
};

function records() {
  if (!existsSync(ledger)) return [];
  return readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

if (command === 'create') {
  const head = git(['rev-parse', 'HEAD']);
  if (!head) {
    refuse(NAME, EXIT.UNKNOWN, `${root} is not a git repository, or has no commits`,
      ['A release candidate names a commit. With no commit there is no subject to name.']);
  }
  if (git(['status', '--porcelain']).length) {
    refuse(NAME, EXIT.BLOCKED, 'the working tree is DIRTY',
      ['A candidate assembled from uncommitted work names a state that exists on one machine and in',
       'no commit — nobody, including you, could ever re-establish it to re-check its evidence.'],
      'Commit or stash, then create the candidate.');
  }

  // The readiness picture, from the one reducer. NOT recomputed here: a dossier that forms its own
  // opinion is a fourth surface that can disagree with the other three.
  const readiness = reduceReadiness(root);

  // Every ticket the log says reached qa or done. The dossier states its contents rather than
  // implying them, so "what is in this build" is answerable without reading a diff.
  let tickets = [];
  const logPath = resolve(root, 'docs/31-board-events.jsonl');
  if (existsSync(logPath)) {
    try {
      const { parseEventLog, reduce } = await import('./lib/events.mjs');
      tickets = [...reduce(parseEventLog(readFileSync(logPath, 'utf8')).events).tickets.values()]
        .filter((t) => ['qa', 'done'].includes(t.status))
        .map((t) => ({ id: t.id, status: t.status, title: t.meta?.title || '' }));
    } catch { /* an unreadable log leaves tickets empty and readiness says why */ }
  }

  const rc = {
    schema: 'release-candidate/v1',
    release_candidate_id: `rc-${randomUUID()}`,
    created_at: new Date().toISOString(),
    version: String(flags.version || ''),
    subject: { head, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), dirty: false },
    tickets,
    readiness,
    // Stated plainly, on the artifact itself, because this is the document a human is asked to act
    // on and the constraint is constitutional rather than configurable.
    publication: 'HUMAN ONLY. No executable path in this studio may submit or publish to a store. This dossier prepares a submission; it never performs one.',
  };

  withFileLock(ledger, () => {
    const all = records();
    const previous = all.at(-1)?.hash || '';
    rc.prev_hash = previous;
    rc.hash = createHash('sha256').update(`${previous}\n${JSON.stringify({ ...rc, hash: undefined })}`).digest('hex');
    mkdirSync(dirname(ledger), { recursive: true });
    appendFileSync(ledger, `${JSON.stringify(rc)}\n`);
  }, { die });

  process.stdout.write(
    `${rc.release_candidate_id}\n` +
    `  commit    ${head}\n` +
    `  tickets   ${tickets.length ? tickets.map((t) => t.id).join(', ') : '(none at qa or done)'}\n` +
    `  readiness ${readiness.verdict}\n` +
    (readiness.verdict === 'PASS' ? '' :
      `\n  This candidate is recorded, NOT cleared. Readiness is ${readiness.verdict}; recording a\n` +
      '  candidate is how you get something to point at, not permission to ship it.\n')
  );
  process.exit(0);
}

if (command === 'show') {
  const all = records();
  if (!all.length) { process.stdout.write(`${NAME}: no candidates recorded yet.\n`); process.exit(2); }
  const rc = flags.id ? all.find((r) => r.release_candidate_id === String(flags.id)) : all.at(-1);
  if (!rc) die(2, `no candidate ${flags.id}`);
  process.stdout.write(flags.json ? `${JSON.stringify(rc, null, 2)}\n`
    : `${rc.release_candidate_id}\n  commit ${rc.subject.head}\n  readiness ${rc.readiness?.verdict}\n  tickets ${(rc.tickets || []).map((t) => t.id).join(', ') || '(none)'}\n`);
  process.exit(0);
}

refuse(NAME, EXIT.USAGE, 'unknown command', ['usage: release-candidate.mjs create|show [--root <dir>] [--version <v>]']);
