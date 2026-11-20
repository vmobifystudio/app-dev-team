#!/usr/bin/env node
/**
 * board — the only writer of the sprint board.
 *
 * Every mutation is a validated append to `docs/31-board-events.jsonl`, after which
 * `docs/31-board.md` is regenerated as a view. The Markdown is a rendering, never a source: an
 * agent that edits a cell is editing a file the next render overwrites, and no rule anywhere reads
 * it back as authority.
 *
 * Usage:
 *   board.mjs add   <ID> --title T [--owner R] [--feature F-001] [--depends A,B] [--estimate M]
 *                        [--spec S] [--acceptance A] [--notes N] [--by role] [--status blocked]
 *                        [--invariant "I1; I2"] [--rollback N] [--file path/to/touched.swift] [--change kind]
 *
 * `--file` derives `risk` from `risk-router.mjs` (docs/team/risk-policy.json), the same router
 * `dispatch-preflight.mjs` uses at spawn time — risk is never hand-typed. A ticket risk-router
 * marks `high`/`critical` cannot reach `review_requested` without at least one `--invariant`
 * recorded at creation (see `validateTransition`'s `review_requested` case in lib/events.mjs).
 *   board.mjs move  <ID> <event> --by <role> [--detail "..."]
 *   board.mjs move  <ID> corrected --by tech-manager [--invariant "I1; I2"] [--test-profile]
 *
 * TEST COMMANDS ARE FROZEN (C3G-3, design C): the first gate event stamps the profile's test.fast /
 * test.full (+ the profile's sha) on the log; a later gate event under a profile that declares
 * different commands is refused until the orchestrator runs `corrected --test-profile`.
 * `merged` records the commit it is about (`merged_head`); `closed` checks that commit (C3G-8).
 *   board.mjs assign <ID> --to <role> [--by <role>]
 *   board.mjs show  [ID] [--json]
 *   board.mjs render
 *   board.mjs migrate [path/to/31-board.md] [--out path.jsonl]
 *
 * Common flags: --log <events.jsonl>  --board <31-board.md>
 *
 * Events: created · claimed · assigned · done_reported · verified · verified_static · rejected ·
 *         review_requested · started · approved · changes · merged · qa_passed · qa_failed ·
 *         blocked · unblocked · reopened · closed
 *
 * `reopened` is founder-only (`--by founder`): blocked/review -> in_progress with one more review
 * cycle on top of the cap.
 *
 * `verified_static` is `verified`'s honest sibling: the branch, the commits and the changed files
 * check out and every non-executable check passed, but the test suite DID NOT RUN. It unlocks
 * review, approval and merge — a missing toolchain must not cost a ticket its code review — and it
 * blocks `closed`, because "done" is the word that asserts the suite ran green.
 *
 * Exit codes:
 *   0  appended / rendered
 *   1  refused — the transition is illegal, or a rule says no
 *   2  cannot evaluate — the log or board is missing or unreadable
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

import { parseArgs as parseArgv } from './lib/args.mjs';
import { withFileLock } from './lib/atomic.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { resolveActor, verifyActorToken, mintActorToken, revokeActorToken, listActorTokens, TOKEN_REGISTRY, inlineTokenFlag, founderConfirms, BOARD_CLI } from './lib/actor.mjs';
import { GATE_EVENTS, conditionalGate } from './lib/capabilities.mjs';
import { verifyTestEvidence, verifyQaEvidence, currentTestProfile, frozenTestProfile, sameCommands, docsOnlyDiff, changedFiles } from './lib/evidence.mjs';
import { RANK, routeFiles } from './lib/risk.mjs';
import { parseBoard, parseLedger, parseDependencies, isEmpty, normalizeId, MAX_REVIEW_CYCLES } from './lib/board.mjs';
import { redact } from './lib/redact.mjs';
import {
  EVENTS,
  key,
  parseEventLog,
  reduce,
  validate,
  chainHash,
  verifyChain,
  dependentsOf,
  renderBoard,
  deriveMetrics,
  isQaDocs,
  anchorPath,
  checkAnchor,
  writeAnchor,
} from './lib/events.mjs';
import { VERDICT_EVENTS, readVerdict } from './lib/verdict.mjs';
import { checkApprovals } from './lib/approval.mjs';
import { gitAt, integrationBase, ticketTip, isAncestor } from './lib/integration.mjs';

const DEFAULT_LOG = 'docs/31-board-events.jsonl';
const DEFAULT_BOARD = 'docs/31-board.md';

/**
 * Dry run 3 (tap-counter, 2026-08-02): `docs/31-board-events.jsonl` is operational state, not
 * source — it is never git-tracked. `git worktree add` only populates a new worktree from what
 * git tracks, so an agent operating with `cwd` inside `.agent-wt/<TICKET>` (this repo's own
 * `agent-isolation` convention) who runs `board.mjs` with no explicit `--log`/`--board` resolved
 * those defaults against `process.cwd()` — a SEPARATE, EMPTY ledger inside the worktree, not the
 * project's real one. Two isolated agents can each believe they hold the single source of truth.
 * Reproduced directly: a `code-reviewer` spawn operating inside a worktree found its own ledger
 * held a strict subset of the real one, purely because of the order commands happened to run in —
 * luck, not a guarantee.
 *
 * `git rev-parse --git-common-dir` resolves to the ORIGINAL `.git` directory in every case,
 * including from inside a linked worktree (git follows the `gitdir:` pointer file back to it) —
 * so its parent is the one project root regardless of which worktree asked. Only the DEFAULT path
 * uses this: an operator who explicitly passes `--log`/`--board` is making a deliberate choice and
 * that still resolves against cwd, unchanged.
 */
/**
 * ...and the git-based answer above was still not enough, because A GIT BOUNDARY IS NOT A PROJECT
 * BOUNDARY. `--git-common-dir` answers "the nearest git repository", so a command run inside a git
 * repo NESTED in a studio project (a vendored dependency, a sample app, a fixture) resolved to that
 * inner repo and silently created a SECOND, empty board there, reporting success. The work went to
 * a project nobody was watching — and unlike every other defect in this codebase, a write that
 * lands in the wrong repository cannot be undone by any gate downstream of it.
 *
 * Resolution now goes through the one shared resolver, which answers CANNOT EVALUATE with both
 * candidates named rather than picking silently.
 */
function projectRoot(flags = {}) {
  const result = resolveProjectRoot({ explicit: typeof flags['project-root'] === 'string' ? flags['project-root'] : '' });
  if (!result.ok) die(2, explainRootFailure(result));
  return result.root;
}

const die = (code, message) => {
  process.stderr.write(`board: ${message}\n`);
  process.exit(code);
};

/** The ids on this board — so a branch goes to the LONGEST id it matches (lib/integration.mjs). */
let BOARD_IDS = [];
const boardIds = () => BOARD_IDS;

/** Resolve an ID the user typed to the one on the board, whatever case either is in. */
function resolveId(tickets, id) {
  const state = tickets.get(key(id));
  return state ? state.id : normalizeId(id);
}

/**
 * Flags that take a value. A token in a value position is a VALUE, whatever it looks like.
 *
 * It used to be "the next token is a value unless it starts with `--`", which made every
 * agent-supplied string an argument injection: `--detail "--board=/tmp/x"` set `detail` to `true`
 * and `board` to `/tmp/x`, so the CLI rendered the board OVER AN ARBITRARY FILE and the recorded
 * reason — the one thing an unblock exists to preserve — was destroyed. Reproduced on the bare CLI
 * with no dashboard involved, so validating at any one caller would have left every other open.
 *
 * `--name=value` still works; a value-taking flag with no token after it is exit 2, not `true`.
 *
 * THIS SET MUST NAME EVERY VALUE-TAKING FLAG THIS FILE READS, and it did not. `evidence`,
 * `context`, `run`, `attempt` and `lease-seconds` were all read as values and none were declared,
 * so each was the original hole reopened: `--evidence "--board=<path>"` set `evidence` to `true`
 * and `board` to an arbitrary path. That approval path failed safe only by accident of ordering —
 * `bindApprovalEvidence` rejects the missing evidence file before `writeView` runs — and `--run` /
 * `--attempt` forward straight into `run-ledger.mjs`'s argv, where no such accident protects them.
 *
 * The fix belongs here and only here: five call sites each checking their own argument is the
 * shape that produced the byte-identical copy of this bug in `round-journal.mjs`. When you add a
 * flag that takes a value, add it to this set in the same edit — `assert_declared_value_flags` in
 * scripts/test.sh cross-checks the set against every `flags.X` this file reads, so a new
 * undeclared one fails the suite rather than waiting for a probe.
 */
const VALUE_FLAGS = new Set([
  'title', 'feature', 'owner', 'depends', 'estimate', 'spec', 'acceptance', 'notes',
  'status', 'by', 'detail', 'reason', 'to', 'log', 'board', 'out',
  'invariant', 'rollback', 'file', 'change', 'commit', 'idempotency-key', 'project-root', 'base', 'actor', 'actor-token',
  'evidence', 'context', 'run', 'attempt', 'lease-seconds', 'verdict', 'head',
  'token', 'role', 'ticket', 'ttl-minutes', 'token-id', 'mismatch',
]);

const parseArgs = (argv) => parseArgv(argv, { valueFlags: VALUE_FLAGS, die, listFlags: { file: ',', depends: ',', invariant: ';' } });

/**
 * Every free-text field an agent supplies, filtered through the credential patterns before it is
 * written. Loud on purpose: silent redaction leaves an operator staring at a truncated string with
 * no idea what removed it.
 */
function scrub(label, value) {
  if (typeof value !== 'string' || !value) return value;
  const { text, redacted } = redact(value);
  if (redacted.length) {
    process.stderr.write(
      `board: REDACTED ${redacted.join(', ')} from ${label}. The board is committed and rendered;\n` +
        '  a credential written here is in git history, where deleting it later does nothing.\n' +
        '  Rotate it if it was real.\n'
    );
  }
  return text;
}

/**
 * Read the log. A log that exists but does not parse is exit 2, never an empty board — an
 * unreadable gate that returns "nothing to report" is how a broken check reports CLEAR.
 *
 * It also refuses to read a log whose audit chain is broken, and that half was missing until
 * dry run 5 went looking for it. `append` verified the chain, so a tampered log could not be
 * written to — but `show` printed the rewritten state with exit 0, and `render` regenerated
 * `docs/31-board.md` from it, laundering the rewrite into the very artifact humans and agents
 * read as the state of the sprint. The guard was on the path an attacker does not need and
 * absent from the path they do.
 *
 * That is FC-001 once more: the fix stopped one layer short of the human. The rule this repo
 * keeps re-learning is to ask who ELSE touches this value between the check and the reader.
 * Here the answer was "every read command", so the check belongs in the one function they all
 * call rather than in each of them.
 *
 * Exit 2, matching the unreadable-line branch below it and `append` above: a rewritten record is
 * not a board whose state is bad, it is a board whose state is UNKNOWABLE. `board.mjs verify` is
 * deliberately exempt — it reads the file itself, because a command whose job is reporting the
 * break cannot die on encountering one.
 */
function loadLog(logPath, { required = true } = {}) {
  if (!existsSync(logPath)) {
    if (required) die(2, `no event log at ${logPath}. Run "board.mjs add" or "board.mjs migrate" first.`);
    return { events: [] };
  }
  let text;
  try {
    text = readFileSync(logPath, 'utf8');
  } catch (error) {
    die(2, `cannot read ${logPath}: ${error.message}`);
  }
  const { events, errors } = parseEventLog(text);
  if (errors.length) {
    die(
      2,
      `${logPath} has ${errors.length} unreadable line(s) — refusing to guess:\n` +
        errors.map((e) => `  line ${e.line}: ${e.reason}`).join('\n')
    );
  }
  const chain = verifyChain(text);
  if (!chain.ok) {
    die(
      2,
      `the audit chain of ${logPath} is broken at line ${chain.line}.\n` +
        `  ${chain.reason}\n` +
        `  ${chain.chained} line(s) verified before the break.\n` +
        '  Refusing to report a state derived from a rewritten history. Whatever this board would\n' +
        '  have said is a claim about the edited file, not about what the team did.\n' +
        `  Recover the log from version control (git checkout -- ${logPath}), then re-run.`
    );
  }
  const anchored = checkAnchor(logPath, text, chain);
  if (!anchored.ok) die(2, anchored.reason);
  return { events };
}


/**
 * Append one event, chained to everything already in the log.
 *
 * Verifying BEFORE every append is the wiring that makes the chain worth having. A check that only
 * runs in CI tells you on Tuesday that Monday's log was rewritten; this refuses to add a line to a
 * log that has already been tampered with, so the tampering cannot be buried under later work.
 *
 * FAIL CLOSED, and the recovery is `git checkout -- <log>`: the log is append-only and versioned,
 * so a broken chain means "restore the file", never "append a repair". There is deliberately no
 * `--force` — a flag that re-anchors a broken chain is a flag that erases the only evidence.
 */
/**
 * Return true when this exact logical transition has already been committed.
 *
 * WITHOUT THIS, "the command timed out, run it again" DUPLICATES THE EFFECT. A retry is the single
 * most common thing an agent or operator does after an ambiguous failure, and until now the board
 * had no way to tell a retry from a second, genuinely-intended transition.
 */
/**
 * Has THIS transition — this ticket, this event, this key — already been committed?
 *
 * ALL THREE PARTS MATTER, and the first version of this compared only the key. A bare global string
 * meant that `move APP-002 claimed --idempotency-key RETRY-1`, after APP-001 had used RETRY-1,
 * printed "already applied" and exited 0 with APP-002 NEVER MOVED and nothing written.
 *
 * That is the single worst outcome available to this codebase: a real transition silently discarded
 * and reported as success. An orchestrator retrying a wave with one per-wave key — the obvious
 * thing to do, and the reason the flag exists — would have dropped every transition after the
 * first, and the board would have looked fine.
 *
 * A dedup guard that swallows work is strictly worse than no dedup guard, because the duplicate it
 * was preventing is visible and the loss it causes is not. Found by the code-reviewer, reproduced
 * on two tickets.
 *
 * Returns 'duplicate' (same ticket, same event — a genuine retry), 'collision' (the key was used
 * for something ELSE, which is a caller bug and must never be treated as success), or false.
 */
function idempotencyState(logPath, key, ticket, eventName) {
  if (!key) return false;
  if (!existsSync(logPath)) return false;
  for (const line of readFileSync(logPath, 'utf8').split('\n').filter(Boolean)) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.idempotency_key !== key) continue;
    if (key && e.ticket === ticket && e.event === eventName) return 'duplicate';
    return 'collision';
  }
  return false;
}

function append(logPath, event) {
  mkdirSync(dirname(logPath), { recursive: true });
  const existing = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  const chain = verifyChain(existing);
  if (!chain.ok) {
    die(
      2,
      `the audit chain of ${logPath} is broken at line ${chain.line}.\n` +
        `  ${chain.reason}\n` +
        '  Refusing to append: a new line on a rewritten log makes the rewrite permanent.\n' +
        `  Recover the log from version control (git checkout -- ${logPath}), then re-run.\n` +
        // THE OLD MESSAGE SAID ONLY "find out what wrote to it directly" — and for the entire life
        // of this defect the answer was: this CLI did, racing itself, because appends were not
        // serialized. Blaming the operator for the tool's own corruption is DR4-001 (a broken
        // harness must never read as sabotage). Appends are locked now, so a chain break here is
        // once again genuinely external — but the message must say which world it is in.
        '  Appends are serialized by a lockfile, so concurrent CLI writers can no longer cause\n' +
        '  this. A break now means the file was edited or truncated outside the CLI.'
    );
  }
  // A LEGACY LOG WITHOUT A TRAILING NEWLINE MUST GET ONE FIRST. `appendFileSync` concatenates raw
  // bytes: if `existing` ends mid-line (no trailing `\n`), the new JSON object lands on the SAME
  // line as the old one — `}{` glued together — and every reader from the next line onward fails
  // `not valid JSON`. `verifyChain` above tolerates a missing trailing newline when reading (each
  // line is `trim()`-checked), so this went unnoticed until the log was read again. Reported by
  // codex.
  // THE ENVELOPE. Every event carries its own identity and the version of the shape it was written
  // in, stamped in ONE place so no writer can omit them.
  //
  // `event_id` makes an event referenceable — causation ("this happened because of that") is
  // unstateable without it, and a log where nothing can be pointed at is a log you can only read
  // forwards. `schema` makes the shape self-describing: every reader currently infers the shape from
  // context, which is precisely how `routes` came to pass for `rules` elsewhere in this repo.
  //
  // Added at the append boundary rather than at each call site, because a field every writer must
  // remember is a field some writer will forget — the lesson of `assign` dropping the idempotency
  // key three commits ago.
  const anchored = checkAnchor(logPath, existing, chain);
  if (!anchored.ok) die(2, `refusing to append: ${anchored.reason}`);
  const anchor = anchorPath(logPath);
  const enveloped = {
    schema: 'board-event/v1',
    event_id: randomUUID(),
    ...event,
    ...(anchor ? { anchored: true } : {}),
  };
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  const hash = chainHash(chain.tip, enveloped);
  appendFileSync(logPath, `${sep}${JSON.stringify({ ...enveloped, hash })}\n`);
  if (anchor) writeAnchor(logPath, chain.chained + 1, hash);
}

/**
 * Resolve and stamp the actor/v1 envelope for an event.
 *
 * WHY THIS IS ON EVERY EVENT AND NOT JUST APPROVALS. Authority matters wherever a role is claimed:
 * who reported done, who verified, who unblocked. Stamping only the approval would leave the rest
 * of the chain as anonymous as before, and the chain is what an approval is an approval OF.
 *
 * Under the default (insecure-local) this never refuses — it records `mode: "insecure-local"`, a
 * durable admission that the role was asserted rather than proven. Under
 * `requireAttestedActors: true` an unproven role is refused outright.
 */
function stampActor(paths, flags, ticket, eventName, conditional = false) {
  // THE SECURITY ROOT COMES FROM THE RESOLVER, NOT FROM THE CALLER'S --log.
  //
  // This was `dirname(dirname(paths.log))`. `--log` is a caller-supplied path, so the caller chose
  // which .studio-policy.json and which actors.json governed their own append. Reproduced by the
  // security reviewer: a symlink pointing a decoy directory's log at the REAL log let an unattested
  // event into the real chain while attestation was on and the registry was intact. `root.mjs`
  // exists precisely to answer "which project is this, authoritatively" — and it was not on this
  // path at all.
  const { root, policy } = studioPolicy();
  const token = typeof flags.token === 'string' ? flags.token : '';
  const role = String(flags.by || '');
  const gate = GATE_EVENTS.has(eventName) || conditional; // S7-2/S7-3: corrected, unblocked of needs-approval
  // C3W-8 / design D: only the orchestrator's own role (tech-manager) is shown an inline mint. For an
  // AGENT role, printing a mint was an instruction to self-attest — the agent would mint the token
  // that is supposed to prove the orchestrator sent it.
  const refuseToken = (r) => die(r.code, `refusing ${eventName} on ${ticket}: ${r.reason}\n` +
    (role === 'tech-manager'
      ? '  A gate event needs --token. The orchestrator mints its own inline, in the same command:\n' +
        `    node "\${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move ${ticket} ${eventName} --by tech-manager${inlineTokenFlag(root, 'tech-manager', ticket) || ` --token "$(node "\${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" actor mint --role tech-manager --ticket ${ticket})"`} …`
      : role === 'founder'
        ? '  A founder token is minted by the human founder at their own terminal (actor mint --role founder).'
        : `  A gate event by ${role || 'an agent role'} needs the --token from THAT agent's spawn prompt. Agents never mint:\n` +
          '  the orchestrator composes the prompt (spawn-prompt.mjs compose), which mints the token. If you are the\n' +
          '  agent, return BLOCKED naming this refusal. If you are the orchestrator, re-spawn the agent with a\n' +
          '  freshly composed prompt.'));
  // G2-12: THE POLICY FLOOR IS RECORDED ON EVERY EVENT, not inferred from the first gate event — so
  // deleting requireActorTokens (or requireApprovalBinding) before any gate was written is refused
  // as well. A board with no event yet has no floor: that is the stated bound.
  const floor = RATCHETED.filter((k) => policy[k] === true);
  const lowered = gate ? ratchetedOff(paths.log, policy) : [];
  if (lowered.length) {
    die(2, `refusing ${eventName} on ${ticket}: this board recorded ${lowered.join(' and ')} on earlier events, and\n` +
      '  .studio-policy.json no longer sets it. Turning a gate off mid-board is a downgrade an agent could\n' +
      `  make by editing one file, so it is refused. Restore ${lowered.map((k) => `"${k}": true`).join(', ')}.`);
  }
  const withFloor = (actor) => (floor.length ? { ...actor, policy_floor: floor } : actor);
  // G2-14: a founder token opens ONE override. A token_id already on the log is spent.
  const spent = (r) => {
    if (r.ok && r.actor.single_use && logHasToken(paths.log, r.actor.token_id)) {
      die(1, `refusing ${eventName} on ${ticket}: founder token ${r.actor.token_id} was already used — it is single-use. Mint a new one at your terminal.`);
    }
    return r;
  };
  // G-F1: PER-SPAWN TOKENS. Required on gate events; verified (and stamped) wherever one is given.
  if (policy.requireActorTokens === true) {
    if (gate || token) {
      const r = spent(verifyActorToken({ root, token, role, ticket, required: true }));
      if (!r.ok) refuseToken(r);
      return withFloor(r.actor);
    }
    return withFloor({ schema: 'actor/v1', actor_id: 'unattested', role, mode: 'work-unattested', session: process.env.STUDIO_SESSION_ID || null });
  }
  // THE RATCHET. A board that ever recorded a token-required gate cannot have that requirement
  // dropped by editing .studio-policy.json — the edit an agent with Write would make.
  if (gate && tokenModeWasRequired(paths.log)) {
    die(2, `refusing ${eventName} on ${ticket}: this board recorded gate events under requireActorTokens, and\n` +
      '  .studio-policy.json no longer requires them. Turning attestation off mid-board is a downgrade an\n' +
      '  agent could make by editing one file, so it is refused. Restore "requireActorTokens": true.');
  }
  if (token) {
    const r = spent(verifyActorToken({ root, token, role, ticket, required: false }));
    if (!r.ok) refuseToken(r);
    return withFloor(r.actor);
  }
  const result = resolveActor({
    root,
    role: String(flags.by || ''),
    ticket,
    event: eventName,
    ts: '',
    token: typeof flags['actor-token'] === 'string' ? flags['actor-token'] : '',
    actorId: typeof flags.actor === 'string' ? flags.actor : '',
    requireAttested: policy.requireAttestedActors === true,
  });
  if (!result.ok) {
    die(result.code, `refusing ${eventName} on ${ticket}: ${result.reason}\n` +
      '  requireAttestedActors is on, so a role must be GRANTED to an actor in docs/team/actors.json\n' +
      '  and proven with a token, not merely spelled correctly in --by.');
  }
  return withFloor(result.actor);
}

/** Policy keys that, once recorded on a board, cannot be switched off for it (G2-12). */
const RATCHETED = ['requireActorTokens', 'requireApprovalBinding'];
function ratchetedOff(logPath, policy) {
  if (!existsSync(logPath)) return [];
  const seen = new Set();
  for (const l of readFileSync(logPath, 'utf8').split('\n')) {
    if (!l.includes('"policy_floor"')) continue;
    try { for (const k of JSON.parse(l).actor?.policy_floor || []) seen.add(k); } catch { /* parse errors are loadLog's */ }
  }
  return RATCHETED.filter((k) => seen.has(k) && policy[k] !== true);
}
function logHasToken(logPath, tokenId) {
  if (!existsSync(logPath)) return false;
  return readFileSync(logPath, 'utf8').split('\n').some((l) => l.includes(tokenId) && (() => { try { return JSON.parse(l).actor?.token_id === tokenId; } catch { return false; } })());
}

/** Did any event on this log carry an actor stamped under requireActorTokens? */
function tokenModeWasRequired(logPath) {
  if (!existsSync(logPath)) return false;
  return readFileSync(logPath, 'utf8').split('\n').some((l) => {
    if (!l.includes('"required":true')) return false;
    try { const e = JSON.parse(l); return e.actor?.mode === 'token' && e.actor?.required === true; } catch { return false; }
  });
}

/** The project root (from the resolver, never from --log) and its .studio-policy.json ({} if none). */
function studioPolicy() {
  const resolved = resolveProjectRoot({});
  if (!resolved.ok) die(2, explainRootFailure(resolved));
  const root = resolved.root;

  // AND THE POLICY READ FAILS CLOSED.
  //
  // This was a bare try/catch that fell through to `insecure-local`. So deleting the policy file,
  // or writing one byte of invalid JSON into it, SILENTLY DOWNGRADED THE SECURITY REGIME — all
  // three reproduced. Every other reader in this codebase treats an unreadable input as CANNOT
  // EVALUATE and refuses; actor.mjs argues for exactly that one layer down, about the registry.
  // The identity gate was the one place a corrupt config was a downgrade instead of a refusal.
  const policyPath = resolve(root, '.studio-policy.json');
  let policy = {};
  if (existsSync(policyPath)) {
    try { policy = JSON.parse(readFileSync(policyPath, 'utf8')) || {}; }
    catch (e) {
      die(2, `.studio-policy.json exists but is unreadable (${e.message}).\n` +
             '  Refusing rather than assuming the permissive default: an unparseable policy must not\n' +
             '  be able to turn attestation off. Fix the file, or delete it deliberately.');
    }
  }
  return { root, policy };
}

function writeView(boardPath, tickets) {
  mkdirSync(dirname(boardPath), { recursive: true });
  writeFileSync(boardPath, renderBoard(tickets));
}

function refuse(id, name, result) {
  process.stderr.write(
    `board: refused ${name} on ${id}\n` +
      `  ${result.reason}\n` +
      `  legal from here: ${result.legal.length ? result.legal.join(', ') : '(nothing — terminal state)'}\n`
  );
}

// --------------------------------------------------------------------------------------------
// commands
// --------------------------------------------------------------------------------------------

/**
 * The statuses a ticket can legitimately be BORN in.
 *
 * Bug intake needs this. `BUG-NNN-fix` inherits the original's owner and depends on it being done —
 * so when the original is blocked, the new row is stranded the instant it is created, and dropping
 * the dependency to avoid that is a lie about why the work is waiting. `add --status blocked`
 * creates the row in the state it belongs in, in one call, and `stranded` (a `todo`-only check)
 * correctly stays quiet about a ticket that is already reported as blocked.
 *
 * Nothing past `blocked` is offered on purpose: `review` or `qa` at creation time would assert a
 * verification and an approval that no event in the log records.
 */
const BIRTH_STATUS = new Set(['todo', 'blocked']);

const RISK_ROUTER = fileURLToPath(new URL('./risk-router.mjs', import.meta.url));

/**
 * Risk is derived, never hand-typed: `--file` names the surface the ticket touches, and
 * `risk-router.mjs` (already built, already tested — see `docs/team/risk-policy.json`) decides the
 * tier from it, the same way `dispatch-preflight.mjs` does at spawn time. No `--file`, or no risk
 * policy in this project yet, means risk stays unknown — that is not a refusal, it is the honest
 * absence of an opinion, and it must not read as "low risk" downstream.
 *
 * Codex, PR #15: this used to collapse "no policy exists yet" (a legitimate unknown) and "a policy
 * exists but is malformed, or the router otherwise failed to classify a supplied --file" into the
 * same `null`. `review_requested`'s guard (`lib/events.mjs`) only fires on risk EXPLICITLY
 * `high`/`critical` — it treats unknown as harmless — so a broken policy silently let a
 * billing/security/migration ticket reach review with no invariant recorded, which is exactly the
 * gap this ticket contract exists to close. A missing policy file stays a quiet null; anything else
 * that stops the router from answering is now a hard failure at ticket creation, loud where it can
 * still be fixed, not silent where it would only be discovered by the guard never firing.
 */
function deriveRisk(flags, paths) {
  if (!flags.file) return null;
  const policyPath = resolve(dirname(paths.log), 'team', 'risk-policy.json');
  if (!existsSync(policyPath)) return null; // no policy in this project yet — risk stays unknown, not silently low
  const result = spawnSync(
    process.execPath,
    [RISK_ROUTER, '--policy', policyPath, '--file', String(flags.file), '--change', String(flags.change || '')],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    die(1, `--file was supplied but risk-router.mjs could not classify it against ${policyPath} — fix the policy, or drop --file if this ticket genuinely has none:\n${`${result.stdout || ''}${result.stderr || ''}`.trim()}`);
  }
  // THE WHOLE DECISION IS KEPT, NOT JUST THE TIER.
  //
  // This used to read `.risk` and throw the rest away — so `approvals` and `required_evidence`,
  // the two fields that say what the tier actually DEMANDS, were computed and discarded at the
  // moment they were derived. The router printed advice; the mutation it governs never saw it.
  //
  // That is the general pattern the audit named: tools emit advice while other tools make
  // decisions. A policy decision has to be a durable object CONSUMED by the mutation it governs,
  // not console output the caller is trusted to remember. FC-001 restated at the architecture
  // level, which is why a recommendation-shaped mechanism keeps failing to bind.
  try {
    const route = JSON.parse(result.stdout);
    return {
      schema: 'policy-decision/v1',
      risk: route.risk || null,
      model: route.model || null,
      required_approvals: route.approvals || [],
      required_evidence: route.required_evidence || [],
      decided_at: new Date().toISOString(),
      policy: 'docs/team/risk-policy.json',
    };
  }
  catch (e) { die(1, `risk-router.mjs produced unparseable output for ${policyPath}: ${e.message}`); }
}

function cmdAdd(id, flags, paths, idempotencyKey = '') {
  if (!id) die(1, 'add needs a ticket ID: board.mjs add APP-001 --title "..."');
  const birth = String(flags.status || 'todo').toLowerCase().trim();
  if (!BIRTH_STATUS.has(birth)) {
    die(
      1,
      `add --status accepts ${[...BIRTH_STATUS].join(' or ')}, not "${birth}".\n` +
        '  Anything further along asserts a verification or an approval no event records — work the ticket there.'
    );
  }
  const { events } = loadLog(paths.log, { required: false });
  const { tickets } = reduce(events);

  const detail = {
    title: scrub('--title', flags.title || ''),
    feature: flags.feature || '',
    owner: flags.owner || '',
    dependsOn: flags.depends ? parseDependencies(String(flags.depends)) : [],
    estimate: flags.estimate || '',
    spec: scrub('--spec', flags.spec || ''),
    acceptance: scrub('--acceptance', flags.acceptance || ''),
    notes: scrub('--notes', flags.notes || ''),
    invariants: flags.invariant
      ? String(flags.invariant).split(';').map((s) => scrub('--invariant', s.trim())).filter(Boolean)
      : [],
    rollback: scrub('--rollback', flags.rollback || ''),
    // The file set is RECORDED, not just used to derive a risk tier and discarded. Contention
    // control needs to know what work touches what, and a value consumed once at creation and
    // thrown away cannot answer that later.
    files: flags.file ? String(flags.file).split(',').map((f) => f.trim()).filter(Boolean) : [],
    ...(() => {
      const decision = deriveRisk(flags, paths);
      // `risk` stays a bare string: board-render, events.mjs's review_requested guard and the
      // dashboards all read it, and changing its shape here would be the fix that breaks four
      // consumers to serve one. The decision rides alongside it.
      return decision ? { risk: decision.risk, policy_decision: decision } : { risk: null };
    })(),
  };
  const event = {
    ts: new Date().toISOString(),
    ticket: normalizeId(id),
    event: 'created',
    by: flags.by || 'tech-manager',
    detail,
    provenance: 'cli',
    actor: stampActor(paths, flags, normalizeId(id), 'created'),
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  };

  const result = validate(tickets, event);
  if (!result.ok) {
    refuse(event.ticket, 'created', result);
    process.exit(1);
  }
  append(paths.log, event);
  const appended = [event];

  if (birth === 'blocked') {
    // REUSE THE SCRUBBED VALUE. This read `flags.notes` — the RAW input — while the `created` event
    // above wrote `detail.notes`, the scrubbed one. So `add --status blocked --notes
    // "password=supersecret12"` printed "board: REDACTED credential-assignment from --notes" and
    // then wrote the password verbatim into the very next line of the committed audit log.
    //
    // Worse than a silent leak: the operator was TOLD the credential had been removed, so they had
    // every reason not to rotate it. `--reason` goes through `scrub` here for the same reason —
    // it is agent-supplied free text on the same path.
    //
    // FC-001 once more: the redaction was applied where the value was first written and not where
    // it was written again. Reported by codex on PR #12.
    const blocked = {
      ...event,
      event: 'blocked',
      detail: scrub('--reason', flags.reason || '') || detail.notes || 'created blocked',
    };
    append(paths.log, blocked);
    appended.push(blocked);
  }

  const next = reduce([...events, ...appended]);
  writeView(paths.board, next.tickets);
  process.stdout.write(`${event.ticket} created (${birth}). Board re-rendered to ${paths.board}\n`);
  if (birth === 'blocked') reportCascade(next.tickets, event.ticket);
}

const RUN_LEDGER = fileURLToPath(new URL('./run-ledger.mjs', import.meta.url));

/**
 * `claimed` is the moment two agents can race for the same ticket. The board's own transition
 * graph refuses a ticket that is not `todo`, but that check reads state derived from THIS process's
 * view of the log — it cannot see a second process claiming the same ticket in the same instant.
 * The run-ledger lease is the durable, ticket-keyed lock that closes that race: a second claim is
 * refused by the ledger even if both processes think the board is still `todo`.
 */
/**
 * `run-ledger.mjs start` prints the record it just appended — `run_id`, `attempt_id`,
 * `lease_until` — and this discarded it, keeping only a pass/fail bit. A `claimed` event carried no
 * durable pointer back to the run that made the claim, so nothing downstream (recovery, the
 * candidate-identity work the global enhancement plan calls for) could trace a ticket to the attempt
 * that is actually working it without re-deriving one from the ledger by hand. Global plugin
 * enhancement plan (2026-08-03), P0.2's narrow first slice.
 */
function claimLease(ticket, flags, paths) {
  const ledgerPath = resolve(dirname(paths.log), 'team', 'runs.jsonl');
  const args = ['start', '--ledger', ledgerPath, '--ticket', ticket, '--role', flags.by || 'unknown'];
  if (flags.run) args.push('--run', String(flags.run));
  if (flags.attempt) args.push('--attempt', String(flags.attempt));
  if (flags['lease-seconds']) args.push('--lease-seconds', String(flags['lease-seconds']));
  const result = spawnSync(process.execPath, [RUN_LEDGER, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    return { ok: false, reason: (result.stderr || '').trim() || 'run-ledger refused the claim' };
  }
  let record;
  try { record = JSON.parse((result.stdout || '').trim()); }
  catch { return { ok: true }; } // The lease itself succeeded; identity just isn't parseable — don't fail a claim over it.
  return {
    ok: true,
    run_id: record.run_id,
    attempt_id: record.attempt_id,
    lease_until: record.lease_until,
  };
}

/**
 * `approved --bind` closes the other half of the race a lease cannot: nothing stopped an `approved`
 * event from naming a commit that was later force-pushed over, or from carrying no evidence at all —
 * `approval-check.mjs` could only ever catch that at release time, long after the review that should
 * have bound it. `commit` and `diff_hash` are computed here, from git, the same way
 * `approval-check.mjs` recomputes them to verify — this is the one place they are ever hand-entered.
 * `--evidence` and `--context` point at whatever file the reviewer actually used (a verify-done
 * transcript, a context-manifest.json); their content is hashed, not trusted by name.
 *
 * Dry run 3 (tap-counter, 2026-08-02): with no `--commit`, this reads `HEAD` from `process.cwd()`
 * — correct when invoked from inside the reviewed ticket's own worktree, silently wrong when
 * invoked from the project root instead (binds whatever `main` happens to be, not the reviewed
 * branch). `--log`/`--board` now resolve to the project root by default regardless of `cwd` (see
 * `projectRoot()`), which makes running from the project root the natural thing to do — so the
 * commit can no longer be assumed from `cwd`. `--commit <sha>` makes it explicit instead of
 * ambient; omitting it keeps the old cwd-relative behavior for a caller that really is inside the
 * right worktree.
 *
 * W5: the reviewer runs from the project root, on main, and its prose never passed --commit — so
 * every approval bound main's HEAD and the merge gate refused it forever. The default is now the
 * TICKET'S BRANCH TIP (the one branch named for the ticket, lib/integration.mjs — the matcher
 * merge-reconcile uses). HEAD is used only when no branch is named for the ticket at all (work
 * committed straight onto the current branch), and the detail says which one was bound.
 */
function bindApprovalEvidence(flags, ticket, state) {
  let commit;
  let commitSource = 'explicit --commit';
  if (typeof flags.commit === 'string' && flags.commit) {
    try { commit = execFileSync('git', ['rev-parse', '--verify', `${flags.commit}^{commit}`], { encoding: 'utf8' }).trim(); }
    catch { return { ok: false, code: 2, reason: `--commit ${flags.commit} does not resolve to a real commit` }; }
  } else {
    const tip = ticketTip(gitAt(process.cwd()), ticket, boardIds());
    if (tip.ambiguous.length) {
      return { ok: false, code: 1, reason: `several branches are named for ${ticket} (${tip.ambiguous.join(', ')}) — delete the stale one, or pass --commit <sha> naming the one you reviewed` }; // C3W-9: a decidable refusal, not CANNOT EVALUATE
    }
    if (tip.sha) {
      commit = tip.sha;
      commitSource = `tip of ${tip.branch}`;
    } else {
      try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); commitSource = `HEAD (no branch is named for ${ticket})`; }
      catch { return { ok: false, code: 2, reason: 'cannot resolve HEAD — is this a git repository, and if not run from inside the reviewed worktree, pass --commit <sha>?' }; }
    }
  }
  // THE APPROVAL'S SUBJECT IS THE WHOLE CANDIDATE, NOT ONE COMMIT.
  //
  // This used to diff `${commit}^..${commit}` — literally the last commit. A three-commit branch
  // was therefore approved on the strength of the third commit alone: the reviewer may well have
  // read the whole branch, but what got RECORDED, hashed and later verified covered a third of it.
  // Everything upstream could change under an approval that still verified clean.
  //
  // That is the same mistake as binding to HEAD while the tools consume the working tree, one level
  // up: precise about a subject that was the wrong subject.
  //
  // The base is the merge-base with the integration branch — the point the work diverged — so the
  // candidate is every commit the branch adds. `--base` overrides it. When no integration branch is
  // resolvable we fall back to `${commit}^` and SAY SO in the recorded detail, rather than silently
  // narrowing the subject back to one commit.
  // W2-5 / R2-3: the base is the merge-base with the INTEGRATION branch (develop on the flagship
  // model), the same branch compose's Range and verify-done measure from. Hard-coding main/master
  // made every develop-model Scope disagree with the bound base, so the first approval was refused.
  let base = typeof flags.base === 'string' ? flags.base : '';
  let baseSource = 'explicit --base';
  if (!base) {
    const integration = integrationBase(gitAt(process.cwd()));
    for (const ref of [integration, 'origin/main', 'origin/master'].filter(Boolean)) {
      try {
        const mb = execFileSync('git', ['merge-base', ref, commit], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (mb && mb !== commit) { base = mb; baseSource = `merge-base with ${ref}`; break; }
      } catch { /* ref does not exist here */ }
    }
  }
  if (!base) {
    try { base = execFileSync('git', ['rev-parse', `${commit}^`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); baseSource = 'single-commit fallback (no integration branch found)'; }
    catch { return { ok: false, code: 2, reason: `cannot resolve a base for ${commit} — it has no parent and no integration branch was found. Pass --base <sha>.` }; }
  }
  let diff;
  // `.trim()` ON BOTH SIDES, DELIBERATELY. This hashed the RAW git output while approval-check's
  // `git()` helper trimmed before hashing, and a diff always ends in a newline — so the two hashes
  // could never agree and a correctly bound approval was reported as "not the change on disk".
  // The gate accused clean work of tampering, which teaches everyone to ignore it: FC-002 by
  // erosion rather than by design. Pre-existing on main; found because the reviewer ran the round
  // trip instead of reading either side alone.
  try { diff = execFileSync('git', ['diff', base, commit, '--binary'], { encoding: 'utf8' }).trim(); }
  catch { return { ok: false, code: 2, reason: `cannot diff ${base}..${commit}` }; }
  // The changed-file manifest is recorded alongside the diff hash. The hash proves the content did
  // not change; the manifest is what a human or a policy check can actually read to see the blast
  // radius of what was approved.
  // G7-4: --no-renames, raw paths (lib/evidence.mjs changedFiles) — the same list approval-check re-derives.
  const files = changedFiles(gitAt(process.cwd()), base, commit) || []; // empty on error; the diff hash is still authoritative
  if (!flags.evidence) return { ok: false, reason: '--bind requires --evidence <path to the evidence the review used>' };
  if (!flags.context) return { ok: false, reason: '--bind requires --context <path to the context the review used>' };
  // G2-6: --evidence is a record under docs/team/evidence/ that RE-DERIVES for this ticket and ran
  // on exactly the commit being approved (a --static record when the ticket is verified_static);
  // --context is a context-manifest/v2. Any file at all (/etc/hosts) used to be hashed and accepted.
  const { root } = studioPolicy();
  const ev = verifyTestEvidence(root, flags.evidence, { ticket, allowStatic: Boolean(state?.verifiedStatic), exactHead: commit });
  if (!ev.ok) return { ok: false, code: ev.code, reason: `--evidence: ${ev.reason}` };
  const evidencePath = resolve(root, ev.detail.evidence);
  const contextPath = existsSync(resolve(process.cwd(), String(flags.context))) ? resolve(process.cwd(), String(flags.context)) : resolve(root, String(flags.context));
  if (!existsSync(contextPath)) return { ok: false, code: 2, reason: `no context file at ${flags.context}` };
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(contextPath, 'utf8')); } catch { /* refused below */ }
  if (!manifest || manifest.schema !== 'context-manifest/v2' || !Array.isArray(manifest.sources)) {
    return { ok: false, reason: `--context ${flags.context} is not a context-manifest/v2 (context-manifest.mjs create writes docs/team/context-manifest.json) — the context a review used is a manifest of hashed sources, not any file` };
  }
  return {
    ok: true,
    detail: {
      commit,
      commit_source: commitSource,
      base,
      base_source: baseSource,
      files,
      diff_hash: createHash('sha256').update(diff).digest('hex'),
      evidence: ev.detail.evidence,
      evidence_hash: createHash('sha256').update(readFileSync(evidencePath)).digest('hex'),
      context_snapshot: createHash('sha256').update(readFileSync(contextPath)).digest('hex'),
    },
  };
}

function cmdMove(id, name, flags, paths, idempotencyKey = '') {
  if (!id || !name) die(1, 'move needs a ticket and an event: board.mjs move APP-001 claimed --by ios-developer');
  const { events } = loadLog(paths.log);
  const { tickets } = reduce(events);
  const ticket = resolveId(tickets, id);
  BOARD_IDS = [...tickets.values()].map((t) => t.id);

  const event = {
    ts: new Date().toISOString(),
    ticket,
    event: name,
    by: flags.by || '',
    detail: typeof flags.detail === 'object' ? flags.detail : scrub('--detail', flags.detail || ''),
    provenance: 'cli',
    actor: stampActor(paths, flags, ticket, name, Boolean(conditionalGate(tickets.get(key(ticket)), name))),
    // Stamped here as well as in `cmdAdd`. The first version of this fix stamped the key on
    // `created` only, so `alreadyApplied` could never find it for a `move` — the dedup guard ran,
    // found nothing, and the retry fell through to the state machine. FC-001 inside the fix for
    // FC-001's cousin, caught by the conformance suite rather than by reading the diff.
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  };

  const result = validate(tickets, event);
  if (!result.ok) {
    refuse(ticket, name, result);
    // The cycle cap does not merely refuse: a ticket that has burnt its review budget is stuck, and
    // leaving it in `review` waiting for a 3rd rejection that can never be written is the state the
    // hand-edited board used to sit in. Force the escalation into the log so it is visible.
    if (result.force) {
      const forced = { ...event, event: result.force.event, detail: result.force.detail, by: flags.by || '' };
      append(paths.log, forced);
      syncLease(ticket, forced, [...events, forced], flags, paths);
      const next = reduce([...events, forced]);
      writeView(paths.board, next.tickets);
      process.stderr.write(`  -> ${ticket} moved to blocked instead: ${result.force.detail}\n`);
      reportCascade(next.tickets, ticket);
    }
    process.exit(1);
  }

  // C3W-7: `corrected --invariant "I1; I2"` records invariants (same spelling as `add`).
  if (name === 'corrected' && typeof flags.invariant === 'string') {
    let base = event.detail;
    if (typeof base === 'string' && base.trim().startsWith('{')) { try { base = JSON.parse(base); } catch { /* kept as a note */ } }
    const invariants = flags.invariant.split(';').map((s) => scrub('--invariant', s.trim())).filter(Boolean);
    event.detail = { ...(typeof base === 'object' && base ? base : base ? { note: base } : {}), invariants };
  }

  // C3G-3 / design C: THE TEST COMMANDS ARE FROZEN AT THE FIRST GATE EVENT; changing them is an
  // orchestrator decision (`corrected --test-profile`), never a file edit.
  const profileBlock = freezeTestProfile(name, ticket, flags, event, paths);
  if (profileBlock) {
    process.stderr.write(`board: refused ${ticket} ${name} — ${profileBlock}\n`);
    process.exit(1);
  }

  if (name === 'claimed') {
    const lease = claimLease(ticket, flags, paths);
    if (!lease.ok) {
      process.stderr.write(`board: refused ${ticket} claimed — ${lease.reason}\n`);
      process.exit(1);
    }
    if (lease.run_id) {
      const identity = { run_id: lease.run_id, attempt_id: lease.attempt_id, lease_until: lease.lease_until };
      event.detail = typeof event.detail === 'object' && event.detail
        ? { ...event.detail, ...identity }
        : { note: event.detail || undefined, ...identity };
    }
  }

  // THE REVIEW'S OUTPUT CONTRACT, checked before the append that records its conclusion.
  //
  // It sits AFTER `validate` on purpose. A caller whose transition is illegal, or who lacks the
  // capability to write this event at all, must hear THAT first — a reviewer told to go write a
  // verdict document for a ticket they were never allowed to approve is sent to do work that
  // cannot help. "Before believing a refusal, name the layer you expected it from" cuts both ways:
  // the layers have to fire in the order that makes the message actionable.
  // A merged ticket sent back from `qa` (wave FAIL/CONFLICT) carries the wave's reason, not a review.
  if (VERDICT_EVENTS.has(name) && !(name === 'changes' && tickets.get(key(ticket))?.status === 'qa')) {
    const v = readVerdict(flags.verdict, name, ticket);
    if (!v.ok) {
      process.stderr.write(`board: refused ${ticket} ${name} — ${v.reason}\n`);
      process.exit(v.code || 1);
    }
    event.detail = typeof event.detail === 'object' && event.detail
      ? { ...event.detail, ...v.detail }
      : { note: event.detail || undefined, ...v.detail };
  }

  if (name === 'approved' && flags.bind) {
    const bound = bindApprovalEvidence(flags, ticket, tickets.get(key(ticket)));
    if (!bound.ok) {
      process.stderr.write(`board: refused ${ticket} approved — ${bound.reason}\n`);
      process.exit(bound.code || 1);
    }
    // G-F4: THE VERDICT'S `Scope:` MUST BE THE CANDIDATE THAT WAS BOUND. A verdict reading
    // `Scope: main..HEAD` written on main, or naming last cycle's tip, approves a range that is not
    // the commit this approval pins.
    // G2-5: lib/verdict.mjs guarantees EXACTLY two sides (it refuses `a..b..c`), so this comparison
    // is never skipped — it used to be, whenever the split did not give two parts.
    const scope = String(event.detail?.reviewed_scope || '').split('..');
    {
      const g = gitAt(process.cwd());
      const to = g(['rev-parse', '--verify', `${scope[1]}^{commit}`]);
      const from = g(['rev-parse', '--verify', `${scope[0]}^{commit}`]);
      const problem = !to || !from
        ? `the verdict's Scope ${scope.join('..')} does not resolve to two commits here`
        : to !== bound.detail.commit
          ? `the verdict's Scope ends at ${to.slice(0, 12)} but the approval binds ${bound.detail.commit.slice(0, 12)} (${bound.detail.commit_source}) — the review read a different candidate`
          : !(from === bound.detail.base || isAncestor(g, from, bound.detail.base))
            ? `the verdict's Scope starts at ${from.slice(0, 12)}, after the candidate's base ${bound.detail.base.slice(0, 12)} — part of what is being approved was never in the reviewed range`
            : '';
      if (problem) {
        process.stderr.write(`board: refused ${ticket} approved — ${problem}\n  Write "Scope: ${bound.detail.base}..${bound.detail.commit}" (the range you read).\n`);
        process.exit(1);
      }
    }
    // C3G-13: an APPROVE must name at least one path from the bound diff. "I did not read the diff"
    // under `## Not checked` satisfied every structural check; a verdict that mentions none of the
    // files it approves was not written by anyone who looked at them. BOUND: naming a path proves
    // the reviewer saw the file list, not that they read the hunks.
    if (bound.detail.files.length) {
      let vtext = '';
      try { vtext = readFileSync(resolve(process.cwd(), String(flags.verdict)), 'utf8'); } catch { /* readVerdict already opened it */ }
      if (!bound.detail.files.some((f) => vtext.includes(f))) {
        process.stderr.write(`board: refused ${ticket} approved — the verdict ${flags.verdict} names none of the ${bound.detail.files.length} file(s) in the bound diff (${bound.detail.files.slice(0, 5).join(', ')}${bound.detail.files.length > 5 ? ', …' : ''}).\n` +
          '  An approval says what it read: cite the paths you reviewed (and what you found in each).\n');
        process.exit(1);
      }
    }
    event.detail = typeof event.detail === 'object' && event.detail
      ? { ...event.detail, ...bound.detail }
      : { note: event.detail || undefined, ...bound.detail };
  }

  // G-F4: THE EVIDENCE A GATE CITES IS RE-DERIVED, NOT READ. `verified` names the record
  // verify-done wrote; the board re-hashes its raw log, re-runs the classifier over it and checks it
  // ran on (a descendant of) the ticket's branch tip. `qa_passed` names a journey-gate result or a
  // post-merge test run, re-derived the same way.
  // C3W-4: `verified_static --evidence <the --static record>` is recorded (validated as a static
  // record for this ticket's exact tip), so the reviewer has a record to --bind to. Optional: a
  // static verification with no record still unlocks review, and --bind then has nothing to cite.
  if (name === 'verified' || name === 'qa_passed' || (name === 'verified_static' && flags.evidence)) {
    const { root } = studioPolicy();
    const ev = name === 'verified_static'
      ? verifyTestEvidence(root, flags.evidence, { ticket, staticOnly: true })
      : name === 'verified'
      ? verifyTestEvidence(root, flags.evidence, { ticket })
      : verifyQaEvidence(root, flags.evidence, { ticket, mergedTs: events.findLast((e) => key(e.ticket) === key(ticket) && e.event === 'merged')?.ts || '', mergedHead: recordedMergeHead(events, ticket),
        failedTs: events.findLast((e) => key(e.ticket) === key(ticket) && e.event === 'qa_failed')?.ts || '' });
    if (!ev.ok) {
      process.stderr.write(`board: refused ${ticket} ${name} — ${ev.reason}\n` +
        (name === 'verified_static'
          ? '  `verified_static --evidence` cites the --static record verify-done printed (docs/team/evidence/test-*.json).\n'
          : name === 'verified'
          ? '  `verified` needs --evidence <the record verify-done.sh printed> (docs/team/evidence/test-*.json).\n'
          : '  `qa_passed` needs --evidence docs/team/journey-result.json (a journey-gate PASS), or a verify-done record of a run on the merged tree.\n'));
      process.exit(ev.code || 1);
    }
    event.detail = typeof event.detail === 'object' && event.detail
      ? { ...event.detail, ...ev.detail }
      : { note: event.detail || undefined, ...ev.detail };
  }

  const gitBlock = gitRefusal(name, ticket, flags, events, tickets.get(key(ticket)));
  if (gitBlock) {
    process.stderr.write(`board: refused ${ticket} ${name} — ${gitBlock}\n`);
    process.exit(1);
  }

  // C3G-8: `merged` RECORDS the commit it is about, so `closed` checks that and not a caller's --head.
  if (name === 'merged') {
    const g = gitAt(process.cwd());
    const subj = g(['rev-parse', '--git-dir']) === null ? { error: 'no repository' } : mergeSubject(g, ticket, flags);
    if (!subj.error) {
      // C4G-G2: a docs-only QA- merge also records the base its docs-only proof was taken against.
      const qaBase = isQaDocs(tickets.get(key(ticket))) ? docsOnlyDiff(g, subj.sha, { qa: true }).base : '';
      const rec = { merged_head: subj.sha, ...(qaBase ? { merge_base: qaBase } : {}) };
      event.detail = typeof event.detail === 'object' && event.detail
        ? { ...event.detail, ...rec }
        : { note: event.detail || undefined, ...rec };
    }
  }

  // G-F7: RISK FROM THE DIFF, at the merge it governs.
  if (name === 'merged') {
    const risk = mergeRisk(ticket, tickets.get(key(ticket)), paths, flags);
    if (risk.refusal) {
      process.stderr.write(`board: refused ${ticket} merged — ${risk.refusal}\n`);
      process.exit(1);
    }
    if (risk.detail) {
      event.detail = typeof event.detail === 'object' && event.detail
        ? { ...event.detail, merge_risk: risk.detail }
        : { note: event.detail || undefined, merge_risk: risk.detail };
    }
  }

  append(paths.log, event);
  syncLease(ticket, event, [...events, event], flags, paths);
  const next = reduce([...events, event]);
  writeView(paths.board, next.tickets);
  const state = next.tickets.get(key(ticket));
  process.stdout.write(`${ticket} ${name} -> ${describeStatus(state)} (cycles ${state.cycles})\n`);
  if (state.verifiedStatic) {
    process.stdout.write(
      `  STATIC ONLY: ${state.staticUnrun} has not run on ${ticket}. It may be reviewed, approved and\n` +
        '  merged; it may NOT be closed. Run the suite and append "verified" to clear this.\n'
    );
  }
  if (name === 'blocked') reportCascade(next.tickets, ticket);
  if (name === 'closed' && isQaDocs(state)) printQaLanding(ticket, events);
}

/**
 * C4W-2: a docs-only QA- ticket never rides a wave (wave-integrate skips QA-), so its files reach
 * the integration branch by ONE documented command — the fast-forward the destructive-git hook
 * allows. Printed after `closed`; running it before `closed` works too (closed diffs the merge-base
 * recorded at merged).
 */
function printQaLanding(ticket, events) {
  const g = gitAt(process.cwd());
  const base = integrationBase(g);
  const head = recordedMergeHead(events, ticket);
  if (!base || !head) return;
  if (isAncestor(g, head, base)) { process.stdout.write(`  ${ticket}'s files are already on ${base}.\n`); return; }
  const tip = ticketTip(g, ticket, boardIds());
  const branch = tip.sha === head ? tip.branch : head;
  process.stdout.write(
    `  Land ${ticket}'s documents on ${base} (docs-only, reviewed inline — a fast-forward, no merge commit):\n` +
    `    git checkout ${base} && git merge --ff-only ${branch}\n` +
    (isAncestor(g, g(['rev-parse', base]) || '', head) ? ''
      : `  ${base} has moved since the QA branch was cut, so that is not a fast-forward yet. Rebase it first (documents only, nothing to re-review):\n` +
        `    git rebase ${base} ${branch} && git checkout ${base} && git merge --ff-only ${branch}\n`)
  );
}

/**
 * C3G-3 / design C. Returns a refusal, or '' (stamping `event.test_profile` when it freezes).
 *   - a gate event on a board with nothing frozen, once the profile declares a test command: the
 *     profile's commands + sha are stamped on THIS event — that is the freeze;
 *   - a gate event whose profile commands differ from the frozen ones: refused;
 *   - `corrected --test-profile` by tech-manager (token-proven under requireActorTokens — and agents
 *     cannot mint): re-freezes to the profile as it is now. The board reads the file; the caller
 *     names no command.
 * BOUND: before the first gate event nothing is frozen (lib/evidence.mjs frozenTestProfile).
 */
function freezeTestProfile(name, ticket, flags, event, paths) {
  const { root } = studioPolicy();
  const cur = currentTestProfile(root);
  const frozen = frozenTestProfile(paths.log);
  if (name === 'corrected' && flags['test-profile']) {
    if (event.by !== 'tech-manager') return 'only the orchestrator (--by tech-manager) re-freezes the test commands';
    if (studioPolicy().policy.requireActorTokens === true && event.actor?.mode !== 'token') {
      return `re-freezing the test commands needs the orchestrator's token:${inlineTokenFlag(root, 'tech-manager', ticket)}`;
    }
    if (!Object.keys(cur.commands).length) return `the project profile (read from ${cur.source}) declares no test command to freeze`;
    event.test_profile = { commands: cur.commands, sha: cur.sha, at: event.ts };
    return '';
  }
  if (!GATE_EVENTS.has(name)) return '';
  if (!frozen.commands) {
    if (Object.keys(cur.commands).length) event.test_profile = { commands: cur.commands, sha: cur.sha, at: event.ts };
    return '';
  }
  if (sameCommands(frozen.commands, cur.commands)) return '';
  const show = (c) => JSON.stringify(c || {});
  return `docs/team/project-profile.json (${cur.source === 'working tree' ? 'working tree' : `as committed on ${cur.source}`}) declares test commands ${show(cur.commands)}, but this board froze ${show(frozen.commands)}.\n` +
    '  A test command is what a green means, and the profile is a file anyone with Write can edit, so the board\n' +
    '  keeps the frozen set until the orchestrator records the change. Restore the profile, or (orchestrator) run:\n' +
    `    node "\${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move ${ticket} corrected --by tech-manager --test-profile${inlineTokenFlag(root, 'tech-manager', ticket)}`;
}

/**
 * The two gates that need git, so they live here and not in lib/events.mjs (which stays pure).
 * Returns the refusal reason, or '' to proceed.
 *
 *   merged  (G-F3) under requireApprovalBinding the board runs approval-check's own logic
 *           (lib/approval.mjs) against the ticket's branch tip: the approval must be bound to
 *           EXACTLY that commit. The tip is resolved from the one branch named for the ticket;
 *           `--head <sha>` is required only when there is no such branch (or several), and a
 *           `--head` that disagrees with a resolvable tip is refused — the tip is what merges.
 *   closed  (G-F10) when a branch is named for the ticket and an integration branch exists, one
 *           of the ticket's branches must be an ancestor of it — merge-reconcile's question,
 *           asked before `done` instead of a round after. No branch / no integration branch:
 *           unknown, and unchanged.
 */
function gitRefusal(name, ticket, flags, events, state) {
  if (name !== 'merged' && name !== 'closed') return '';
  const git = gitAt(process.cwd());
  if (git(['rev-parse', '--git-dir']) === null) return ''; // no repository: no commit to bind (stated bound)
  const recorded = name === 'closed' ? recordedMergeHead(events, ticket) : '';
  // C3G-8: `closed` is about the commit RECORDED at `merged`, never a caller's --head.
  if (recorded && flags.head) process.stderr.write(`board: --head ${flags.head} ignored — ${ticket} is closed against the commit recorded at merged (${recorded.slice(0, 12)})\n`);
  // Design decision 1 + design B: a docs-only QA- ticket closes from merged without integration —
  // but only while GIT still proves its branch changes documents only, re-derived at merged and
  // closed against the integration branch (a code commit added after `verified` ends the fast path).
  // C4G-G2 / C4W-2: `closed` diffs against the merge-base RECORDED at `merged`, so the documented
  // `git merge --ff-only qa/<ID>` works before or after `closed` (after the fast-forward,
  // merge-base(integration, tip) is the tip itself and the branch "changed no files").
  if (state && isQaDocs(state)) {
    const subj = recorded ? { sha: recorded } : mergeSubject(git, ticket, flags);
    if (subj.error) return `${subj.error} — the QA- docs-only fast path must know which commit it is about.`;
    const d = docsOnlyDiff(git, subj.sha, { qa: true, base: name === 'closed' ? recordedMergeBase(events, ticket) : '' });
    if (!d.ok) return `${ticket} is on the QA- docs-only fast path, but ${d.reason}. A QA ticket that changes code takes the normal path (review_requested -> approved -> merged).`;
    // C5G-1: the docs-only proof is about the commit recorded at merged — a code commit added AFTER it and
    // fast-forwarded onto the integration branch rode in unreviewed, exactly as on the normal path.
    const base = name === 'closed' && recorded ? integrationBase(git) : '';
    return base ? landedAfterMerge(git, ticket, recorded, base) : '';
  }
  const binding = studioPolicy().policy.requireApprovalBinding === true;
  if (name === 'closed') {
    const base = integrationBase(git);
    if (!base) return '';
    // G2-8: the subject must be known — the merged commit recorded at `merged` (C3G-8), or, for a
    // ticket merged before that was recorded, the branch tip / --head.
    const subj = recorded ? { sha: recorded, source: 'the commit recorded at merged' } : mergeSubject(git, ticket, flags);
    if (subj.error) return `${subj.error} — "done" asserts integrated code, and which code is unknown.`;
    if (!isAncestor(git, subj.sha, base)) {
      return `${subj.source} (${subj.sha.slice(0, 12)}) is not merged into ${base} — "done" would claim integrated code that is not on the integration branch. Merge it (or land the wave) first.`;
    }
    // C3G-8: commits added to the ticket's branch AFTER `merged` must not be on the integration
    // branch — they rode in unreviewed. BOUND: checkable only while the branch still exists; once it
    // is deleted, a commit on the integration branch cannot be attributed to the ticket.
    const landed = recorded ? landedAfterMerge(git, ticket, recorded, base) : '';
    if (landed) return landed;
    // G2-9: what merged must be WHAT WAS APPROVED. Ancestry alone let commits pushed after the
    // `merged` event ride into `done` unreviewed.
    if (binding) {
      const { counted, issues } = checkApprovals(events, { ticket, head: subj.sha, cwd: process.cwd() });
      if (!counted.length) return `requireApprovalBinding is on and ${ticket} carries no bound approval to close against`;
      if (issues.length) return `the code being closed (${subj.sha.slice(0, 12)}) is not the approved code:\n  ${issues.join('\n  ')}`;
    }
    return '';
  }
  if (!binding) return '';
  const subj = mergeSubject(git, ticket, flags);
  if (subj.error) return `requireApprovalBinding is on and ${ticket}'s branch tip is unknown: ${subj.error}`;
  const { issues } = checkApprovals(events, { ticket, head: subj.sha, cwd: process.cwd() });
  return issues.length ? `the approval is not bound to ${subj.sha}:\n  ${issues.join('\n  ')}` : '';
}

/**
 * C3G-8 / C5G-1: commits added to the ticket's branch AFTER `merged` recorded `recorded` that are now on
 * `base` rode in unreviewed — the refusal, or ''. BOUND: checkable only while the branch still exists.
 */
function landedAfterMerge(git, ticket, recorded, base) {
  const tip = ticketTip(git, ticket, boardIds());
  if (!tip.sha || tip.sha === recorded) return '';
  const beyond = (git(['rev-list', tip.sha, `^${recorded}`]) || '').split('\n').filter(Boolean);
  const landed = beyond.filter((c) => isAncestor(git, c, base));
  return landed.length ? `${tip.branch} gained ${landed.length} commit(s) after ${ticket} merged (${landed.slice(0, 3).map((c) => c.slice(0, 12)).join(', ')}), and they are on ${base} — they were never reviewed. Revert them, or reopen the ticket and review them.` : '';
}

/** C4G-G2: the merge-base the last `merged` of a docs-only QA- ticket recorded ('' when none). */
function recordedMergeBase(events, ticket) {
  const m = events.findLast((e) => key(e.ticket) === key(ticket) && e.event === 'merged');
  return (m && typeof m.detail === 'object' && m.detail && m.detail.merge_base) || '';
}

/** C3G-8: the commit the last `merged` on this ticket recorded ('' when none was recorded). */
function recordedMergeHead(events, ticket) {
  const m = events.findLast((e) => key(e.ticket) === key(ticket) && e.event === 'merged');
  return (m && typeof m.detail === 'object' && m.detail && m.detail.merged_head) || '';
}

/**
 * The commit a `merged` / `closed` is ABOUT (G2-7, G2-8): the one branch named for the ticket, or
 * --head (or --commit) when no branch is. A --head that disagrees with a resolvable tip is refused —
 * the tip is what merges. `{sha, source}` or `{error}`.
 */
function mergeSubject(git, ticket, flags) {
  const tip = ticketTip(git, ticket, boardIds());
  const given = typeof flags.head === 'string' && flags.head ? flags.head : typeof flags.commit === 'string' ? flags.commit : '';
  if (!given) {
    if (tip.sha) return { sha: tip.sha, source: `the tip of ${tip.branch}` };
    return { error: `${tip.ambiguous.length ? `several branches are named for ${ticket} (${tip.ambiguous.join(', ')})` : `no branch is named for ${ticket}`}. Pass --head <sha> of the commit being merged` };
  }
  const sha = git(['rev-parse', '--verify', `${given}^{commit}`]);
  if (!sha) return { error: `--head ${given} does not resolve to a commit` };
  if (tip.sha && sha !== tip.sha) return { error: `--head ${given} is not the tip of ${tip.branch} (${tip.sha}) — the tip is what merges, so the approval is checked against it` };
  if (tip.ambiguous.length && !tip.ambiguous.some((b) => git(['rev-parse', `${b}^{commit}`]) === sha)) {
    return { error: `--head ${given} is not the tip of any branch named for ${ticket} (${tip.ambiguous.join(', ')})` };
  }
  return { sha, source: tip.sha ? `the tip of ${tip.branch}` : `--head ${given}` };
}

/**
 * G-F7: the risk the ticket's DIFF carries, against risk-policy.json's path rules, and the
 * approvals and `required_evidence` the higher of (planned, diff) tier demands — checked here, at
 * the merge, with the missing list in the refusal.
 *
 * Unknown diff (no branch named for the ticket, or no integration branch) falls back to the planned
 * decision and SAYS so in the recorded detail; no policy file means nothing to enforce.
 */
const EVIDENCE_CHECKS = {
  // An approval by a role that did not work on it — events.mjs already refuses a merge without one.
  review: (st) => st.approvals.length > 0,
  'security-review': (st) => st.approvals.some((a) => a.by === 'security-reviewer'),
  'migration-plan': (st) => Boolean(String(st.meta?.rollback || '').trim()),
};
const RUNTIME_KINDS = new Set(['runtime-gate', 'runtime-evidence']);
function mergeRisk(ticket, state, paths, flags = {}) {
  const policyPath = resolve(dirname(paths.log), 'team', 'risk-policy.json');
  if (!state) return {};
  if (isQaDocs(state)) return { detail: { planned: null, diff: 'docs-only QA ticket', effective: null } };
  if (!existsSync(policyPath)) {
    // G2-18: a DELETED policy enforces nothing, so it is refused, not read as "no policy yet": the
    // board recorded a decision from it, or the integration branch still carries it.
    const g0 = gitAt(process.cwd());
    const base0 = integrationBase(g0);
    const committed = base0 && g0(['cat-file', '-e', `${base0}:docs/team/risk-policy.json`]) !== null;
    if (state.meta?.policy_decision || committed) {
      return { refusal: `docs/team/risk-policy.json is missing, but ${state.meta?.policy_decision ? `${ticket} was planned under it` : `${base0} still carries it`} — restore it; a deleted policy enforces nothing.` };
    }
    return {};
  }
  let policy;
  try { policy = JSON.parse(readFileSync(policyPath, 'utf8')); } catch (e) { return { refusal: `risk-policy.json is unreadable (${e.message}) — cannot tell what this merge requires` }; }
  if (policy.schema !== 'risk-policy/v1' || !Array.isArray(policy.rules)) return { refusal: 'risk-policy.json is not risk-policy/v1 — cannot tell what this merge requires' };
  const g = gitAt(process.cwd());
  // G2-7: the diff is the SUBJECT's — the ticket's branch tip, or --head when no branch is named for
  // it. An unknown diff is a refusal, never "no risk": a branch named without the ticket id used to
  // skip escalation entirely.
  const subj = mergeSubject(g, ticket, flags);
  if (subj.error) return { refusal: `${subj.error}\n  risk-policy.json is in force, so the merge must know which files it lands.` };
  const tip = { sha: subj.sha };
  const base = integrationBase(g);
  if (!base) return { refusal: 'risk-policy.json is in force and no integration branch (develop/main/master) exists, so the diff — and the risk it carries — is unknown' };
  const mb = g(['merge-base', base, tip.sha]);
  // G7-4: a rename routes BOTH paths (src/auth/login.ts -> src/login.ts still touched auth/), unquoted.
  const files = mb ? changedFiles(g, mb, tip.sha) : null;
  if (files === null) return { refusal: `cannot diff ${tip.sha.slice(0, 12)} against ${base} — the diff, and the risk it carries, is unknown` };
  const planned = state.meta?.policy_decision || null;
  const diff = files && files.length ? routeFiles(policy, files) : null;
  const plannedRank = planned?.risk ? RANK[planned.risk] : -1;
  const escalated = Boolean(diff && RANK[diff.risk] > plannedRank);
  const approvals = [...new Set([...(planned?.required_approvals || []), ...(escalated ? diff.approvals : [])])];
  const evidence = [...new Set([...(planned?.required_evidence || []), ...(escalated ? diff.required_evidence : [])])];
  const workers = new Set([state.owner, ...state.events.filter((e) => e.event === 'claimed' || e.event === 'done_reported').map((e) => e.by)].filter(Boolean));
  const have = new Set(state.approvals.map((a) => a.by).filter((b) => b && !workers.has(b)));
  const missing = [
    ...approvals.filter((r) => !have.has(r)).map((r) => `approval by ${r}`),
    // Decision 6 / W2-3: runtime evidence is checked at the WAVE (wave-integrate runs runtime-gate.sh
    // on the merged wave tree before a high/critical ticket lands), not before `merged`. It stays in
    // required_evidence on the merged event, which is what the wave reads.
    ...evidence.filter((k) => !RUNTIME_KINDS.has(k)).filter((k) => !(EVIDENCE_CHECKS[k] && EVIDENCE_CHECKS[k](state)))
      .map((k) => (EVIDENCE_CHECKS[k] ? `evidence "${k}"` : `evidence "${k}" (no checker exists for this kind — fix risk-policy.json)`)),
  ];
  const detail = {
    planned: planned?.risk || null,
    diff: diff ? diff.risk : files ? 'none' : 'unknown',
    because: diff?.because || null,
    effective: escalated ? diff.risk : planned?.risk || null,
    files_considered: files ? files.length : null,
    required_approvals: approvals,
    required_evidence: evidence,
  };
  if (missing.length) {
    return {
      refusal: `${ticket}'s merge requires ${detail.effective || 'its planned'} risk${escalated ? ` (escalated from ${detail.planned || 'unplanned'}: the diff touches ${diff.because})` : ''} — missing: ${missing.join('; ')}.\n` +
        '  How each is earned: approval by <role> = that role\'s `approved`; "security-review" = an `approved` by security-reviewer;\n' +
        '  "migration-plan" = `add --rollback` on the ticket. "runtime-gate" is checked at the WAVE: wave-integrate runs runtime-gate.sh\n' +
        '  on the merged wave tree before a high/critical ticket lands.',
      detail,
    };
  }
  return { detail };
}

/**
 * C4: keep the run-ledger lease `claimed` opened in step with the board. A lease nobody completed
 * read as an orphan after 15 minutes, so run-doctor flagged every claim and /app-recover stopped.
 * merged/closed/blocked/rejected end the attempt (`complete`); any other move by the lease holder
 * is a `heartbeat`. Best effort: the board event is already appended, and a lease that is already
 * terminal (or was never taken) is not an error here.
 */
const LEASE_ENDS = new Set(['merged', 'closed', 'blocked', 'rejected']);
function syncLease(ticket, event, events, flags, paths) {
  if (event.event === 'claimed') return;
  const claim = events.findLast((e) => key(e.ticket) === key(ticket) && e.event === 'claimed');
  const run = claim?.detail?.run_id;
  const attempt = claim?.detail?.attempt_id;
  if (!run || !attempt) return;
  const ends = LEASE_ENDS.has(event.event);
  if (!ends && event.by !== claim.by) return;
  const args = [ends ? 'complete' : 'heartbeat', '--ledger', resolve(dirname(paths.log), 'team', 'runs.jsonl'),
    '--run', String(run), '--attempt', String(attempt)];
  if (ends) args.push('--detail', `board: ${event.event}`);
  else if (flags['lease-seconds']) args.push('--lease-seconds', String(flags['lease-seconds']));
  spawnSync(process.execPath, [RUN_LEDGER, ...args], { encoding: 'utf8' });
}

/** The derived status as a human reads it — `qa` alone hides that nothing was ever executed. */
const describeStatus = (state) => (state.verifiedStatic ? `${state.status} (static only)` : state.status);

/** `blocked` cascades: say which dependents just stopped being claimable, and why. */
function reportCascade(tickets, id) {
  const dependents = dependentsOf(tickets, id);
  if (!dependents.length) return;
  process.stdout.write(
    `readiness recomputed — not claimable while ${id} is blocked: ${dependents.join(', ')}\n`
  );
}

// The key is FORWARDED. `assign` sat inside the lock and inside the dedup check but dropped the
// key on its way to cmdMove, so no `assigned` event ever carried one and every retry appended a
// second event. FC-001 in the same file as the comment claiming the FC-001 sweep was finished: the
// sweep covered `created` and `move` and stopped one caller short. I-10 could not see it because
// I-10 exercises `move`.
function cmdAssign(id, flags, paths, idempotencyKey = '') {
  if (!id || !flags.to) die(1, 'assign needs a ticket and a role: board.mjs assign APP-001 --to ios-developer');
  return cmdMove(id, 'assigned', { ...flags, detail: { to: flags.to } }, paths, idempotencyKey);
}

function cmdShow(id, flags, paths) {
  const { events } = loadLog(paths.log);
  const { tickets, violations } = reduce(events);
  const metrics = deriveMetrics(events);

  if (flags.json) {
    const state = {};
    for (const [k, t] of tickets) {
      state[k] = {
        id: t.id,
        status: t.status,
        verifiedStatic: t.verifiedStatic,
        unrun: t.staticUnrun,
        owner: t.owner,
        reviewer: t.reviewer,
        cycles: t.cycles,
        dependsOn: t.dependsOn,
        approvals: t.approvals,
        ...t.meta,
      };
    }
    const payload = id ? { [id.toUpperCase()]: state[id.toUpperCase()] } : { tickets: state, metrics, violations };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return violations.length ? process.exit(1) : undefined;
  }

  const wanted = id ? [tickets.get(id.toUpperCase())].filter(Boolean) : [...tickets.values()];
  if (id && !wanted.length) die(1, `${id.toUpperCase()} is not on the board`);

  for (const t of wanted) {
    process.stdout.write(
      `${t.id.padEnd(14)} ${describeStatus(t).padEnd(20)} owner=${t.owner || '—'} reviewer=${t.reviewer || '—'} ` +
        `cycles=${t.cycles}/${MAX_REVIEW_CYCLES} deps=${t.dependsOn.join(',') || '—'} events=${t.events.length}\n`
    );
    if (t.verifiedStatic) {
      process.stdout.write(`${' '.repeat(15)}NOT RUN: ${t.staticUnrun} — this ticket cannot be closed until it does.\n`);
    }
  }

  if (!id) {
    const pct = (v) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
    process.stdout.write(
      `\nreview pass rate ${pct(metrics.reviewPassRate)} · rework ${pct(metrics.reworkRate)} · ` +
        `gates fired ${JSON.stringify(metrics.gateFires)}\n`
    );
  }
  if (violations.length) {
    process.stderr.write(
      `\n${violations.length} sequence violation(s) in the log — repair by appending, never editing:\n` +
        violations.map((v) => `  line ${v.event._line}: ${v.reason}`).join('\n') +
        '\n'
    );
    process.exit(1);
  }
}

/**
 * `board.mjs verify` — is this log the one that was written?
 *
 * Runs in CI. Exit 1 is "the history was rewritten", which is a different fact from "the board is
 * in a state a rule dislikes" (board-doctor's job) and must never be reported as the same thing.
 */
/**
 * `adopt`: anchor a COMMITTED log in a checkout that has no anchor for it (Codex on PR #46: a fresh
 * clone, or a moved project, refused every read — the anchor lives in .git and is keyed by the
 * log's real path, and "delete the anchor" cannot recover an anchor that is already absent).
 * Founder-only by the same rule as a founder token: a human at a terminal types ADOPT. The chain
 * must verify intact; adoption trusts the log's CONTENT as of now, which is the decision the
 * founder is asked to make. BOUND: a log rewritten and re-hashed before the clone is adopted as-is.
 */
// G7-13 / C7-8 / G7-15: adopt is for an ABSENT anchor (fresh clone, moved project). An anchor that
// disagrees with the log is adopted only with `--mismatch <deleted|appended|rewritten>` naming what
// the founder accepts losing or trusting, and the counts are printed first. The confirmation is
// read BEFORE the log lock, and the log is re-assessed inside it: unchanged, or nothing is written.
function adoptState(paths) {
  if (!existsSync(paths.log)) die(2, `no event log at ${paths.log} — nothing to adopt`);
  const text = readFileSync(paths.log, 'utf8');
  const chain = verifyChain(text);
  if (!chain.ok) die(2, `the audit chain of ${paths.log} is broken at line ${chain.line} (${chain.reason}) — a broken log is restored, never adopted.`);
  const at = anchorPath(paths.log);
  if (!at) die(2, `${paths.log} is not in a git repository — there is no anchor to write.`);
  let a = null;
  if (existsSync(at)) { try { a = JSON.parse(readFileSync(at, 'utf8')); } catch { a = { chained: null, tip: null, unreadable: true }; } }
  const kind = !a ? 'absent' : a.unreadable ? 'rewritten'
    : a.chained === chain.chained && a.tip === chain.tip ? 'none'
      : chain.chained < a.chained ? 'deleted' : chain.chained > a.chained ? 'appended' : 'rewritten';
  return { text, chain, at, a, kind };
}
function cmdAdopt(paths, flags) {
  const s = adoptState(paths);
  if (s.kind === 'none') {
    process.stdout.write(`board: ${paths.log} already matches its anchor (${s.chain.chained} chained line(s)) — nothing to adopt\n`);
    return;
  }
  const cd = `cd "${dirname(dirname(paths.log))}" && `;
  const cmd = `${cd}node "${BOARD_CLI}" adopt${s.kind === 'absent' ? '' : ` --mismatch ${s.kind}`}`;
  const counts = s.kind === 'absent'
    ? `  no anchor for this log in this checkout; the log has ${s.chain.chained} chained line(s).`
    : `  the anchor recorded ${s.a.chained ?? '?'} chained line(s) ending ${String(s.a.tip || '?').slice(0, 12)}; the log has ${s.chain.chained} ending ${String(s.chain.tip || '').slice(0, 12)}.\n` +
      (s.kind === 'deleted' ? `  ${s.a.chained - s.chain.chained} line(s) the anchor vouched for are GONE — adopting forgets them.`
        : s.kind === 'appended' ? `  ${s.chain.chained - s.a.chained} line(s) were appended without the CLI — adopting trusts them:\n` +
          s.text.split('\n').filter((l) => l.includes('"hash"')).slice(s.a.chained)
            .map((l) => { try { const e = JSON.parse(l); return `    ${e.ts || ''} ${e.ticket || ''} ${e.event || ''} --by ${e.by || '?'}`; } catch { return '    (unreadable line)'; } }).join('\n')
          : '  the same number of lines hash differently — the history was rewritten and re-hashed.');
  if (s.kind !== 'absent' && flags.mismatch !== s.kind) {
    die(1, `refusing adopt: the anchor exists and disagrees with ${paths.log} (${s.kind}).\n${counts}\n` +
      '  adopt is for a checkout with NO anchor (a fresh clone, a moved project). Restore the log from a backup that\n' +
      '  matches the anchor; or, if the founder accepts exactly this, at their own terminal:\n' +
      `    ${cmd}`);
  }
  const c = founderConfirms('ADOPT', {
    root: dirname(dirname(paths.log)),
    prompt: `Adopt ${paths.log}?\n${counts}\nThis re-trusts the log as it stands. Type the word ADOPT to anchor it: `,
    refusal: `adopt re-trusts the log as it stands, so the human founder confirms it at a terminal (stdin is not a TTY here; an agent Bash call and a Claude Code \`!\` command never have one).\n${counts}\n` +
      `  Founder: in your own terminal run\n    ${cmd}`,
  });
  if (!c.ok) {
    die(1, `refusing adopt: ${c.reason}`);
  }
  withFileLock(paths.log, () => {
    const now = adoptState(paths);
    if (now.kind !== s.kind || now.chain.tip !== s.chain.tip || now.chain.chained !== s.chain.chained) {
      die(1, `refusing adopt: ${paths.log} changed while the founder was confirming — nothing anchored. Run adopt again.`);
    }
    writeAnchor(paths.log, now.chain.chained, now.chain.tip);
    process.stdout.write(`board: adopted ${paths.log} — ${now.chain.chained} chained line(s), anchored at ${now.at}\n`);
  }, { die });
}

function cmdVerify(paths) {
  if (!existsSync(paths.log)) die(2, `no event log at ${paths.log} — nothing to verify`);
  const text = readFileSync(paths.log, 'utf8');
  const chain = verifyChain(text);
  if (!chain.ok) {
    process.stdout.write(
      `AUDIT CHAIN: BROKEN at line ${chain.line}\n` +
        `  ${chain.reason}\n` +
        `  ${chain.chained} line(s) verified before the break.\n` +
        '  This is a rewritten history, not a board rule violation. Recover the log from version\n' +
        `  control (git checkout -- ${paths.log}) and find out what wrote to it directly.\n`
    );
    process.exit(1);
  }
  const anchored = checkAnchor(paths.log, text, chain);
  if (!anchored.ok) {
    process.stdout.write(`AUDIT CHAIN: does NOT match its anchor\n  ${anchored.reason.split('\n').join('\n  ')}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `AUDIT CHAIN: intact — ${chain.chained} chained line(s)` +
      (chain.unchained
        ? `, ${chain.unchained} unchained line(s) written before the chain existed (covered by the\n` +
          '  first chained line\'s anchor: editing them breaks verification too).\n'
        : '.\n')
  );
  process.exit(0);
}

/**
 * `board.mjs actor mint|revoke|list` — the per-spawn capability tokens (lib/actor.mjs header).
 * mint is run by the ORCHESTRATOR; the plaintext token is printed once, to stdout, and only its
 * sha256 is kept. A spawned agent must never run it (Track B's hook refuses it from subagents).
 */
function cmdActor(sub, flags) {
  const { root } = studioPolicy();
  const regPath = resolve(root, TOKEN_REGISTRY);
  if (sub === 'mint') {
    // C7-8: the founder confirms BEFORE the registry lock — a lock held for minutes on terminal
    // input failed every orchestrator mint meanwhile, with advice to delete a live lock.
    const tkt = typeof flags.ticket === 'string' ? flags.ticket : '';
    let confirm;
    if (String(flags.role || '') === 'founder' && tkt) {
      const c = founderConfirms(tkt, { root });
      if (!c.ok) die(1, `actor mint: ${c.reason}`);
      confirm = () => ({ ok: true });
    }
    const r = withFileLock(regPath, () => mintActorToken({ root, role: String(flags.role || ''), ticket: tkt, ttlMinutes: flags['ttl-minutes'] || 240, ...(confirm ? { confirm } : {}) }), { die });
    if (!r.ok) die(1, `actor mint: ${r.reason}`);
    process.stderr.write(`board: minted token ${r.record.token_id} for ${r.record.role} on ${r.record.ticket}, expires ${r.record.expires_at}.\n` +
      // C4W-13: the orchestrator's own inline `--token "$(… mint --role tech-manager …)"` is not a
      // spawn — telling it to put the token in an agent's prompt sent it looking for an agent.
      (r.record.role === 'tech-manager'
        ? '  Orchestrator token: use it on this one board command (the inline --token "$(…)" form). It is not stored anywhere; mint again if lost.\n'
        : "  Put it in THAT agent's spawn prompt only. It is not stored anywhere; mint again if lost.\n"));
    process.stdout.write(`${r.token}\n`);
    return;
  }
  if (sub === 'revoke') {
    const r = withFileLock(regPath, () => revokeActorToken({ root, tokenId: String(flags['token-id'] || '') }), { die });
    if (!r.ok) die(1, `actor revoke: ${r.reason}`);
    process.stdout.write(`revoked ${flags['token-id']}\n`);
    return;
  }
  if (sub === 'list') {
    const r = listActorTokens(root);
    if (!r.ok) die(2, r.reason);
    const revoked = new Set(r.records.filter((x) => x.kind === 'revoke').map((x) => x.token_id));
    for (const x of r.records.filter((y) => y.kind === 'mint')) {
      const state = revoked.has(x.token_id) ? 'revoked' : Date.parse(x.expires_at) <= Date.now() ? 'expired' : 'live';
      process.stdout.write(`${x.token_id}  ${x.role.padEnd(22)} ${x.ticket.padEnd(14)} ${state.padEnd(8)} minted ${x.minted_at}\n`);
    }
    return;
  }
  die(1, 'actor needs mint --role R --ticket T [--ttl-minutes N] | revoke --token-id ID | list');
}

function cmdRender(paths) {
  const { events } = loadLog(paths.log);
  const { tickets } = reduce(events);
  writeView(paths.board, tickets);
  process.stdout.write(`rendered ${tickets.size} ticket(s) to ${paths.board}\n`);
}

// --------------------------------------------------------------------------------------------
// migrate
// --------------------------------------------------------------------------------------------

const LEDGER_EVENT = {
  requested: 'review_requested',
  started: 'started',
  changes: 'changes',
  approved: 'approved',
  merged: 'merged',
};

/**
 * Reconstruct an event log from a hand-written board plus its review ledger.
 *
 * Two provenances, and the distinction is the whole point. Ledger lines carry a real timestamp and
 * a real actor, so they migrate as `provenance: "ledger"`. Everything else — that a ticket was
 * created, claimed, verified, QA'd — was never recorded anywhere, so it is emitted with `ts: null`
 * and `provenance: "inferred"`. A migration that filled those in with plausible times would produce
 * a log that reads as evidence and is not, which is the same class of lie as a false DONE.
 */
function migrate(text) {
  const board = parseBoard(text);
  if (board.rows.length === 0) return null;
  const ledger = parseLedger(text);
  const byTicket = new Map();
  for (const entry of ledger) {
    if (!byTicket.has(entry.ticketId)) byTicket.set(entry.ticketId, []);
    byTicket.get(entry.ticketId).push(entry);
  }

  const events = [];
  const notes = [];
  const inferred = (ticket, event, detail = '') => ({
    ts: null,
    ticket,
    event,
    by: '',
    detail,
    provenance: 'inferred',
  });

  for (const row of board.rows) {
    const id = normalizeId(row.id);
    const status = (row.status || '').toLowerCase();
    const owner = isEmpty(row.owner) ? '' : row.owner;

    events.push({
      ts: null,
      ticket: id,
      event: 'created',
      by: '',
      detail: {
        title: row.title || '',
        feature: row.feature || '',
        owner,
        dependsOn: parseDependencies(row.dependsOn),
        estimate: isEmpty(row.estimate) ? '' : row.estimate,
        spec: isEmpty(row.spec) ? '' : row.spec,
        acceptance: isEmpty(row.acceptance) ? '' : row.acceptance,
        notes: isEmpty(row.notes) ? '' : row.notes,
      },
      provenance: 'inferred',
    });

    if (status === 'todo') continue;

    // Anything past todo was worked, so a claim happened — but nothing recorded when or by whom.
    events.push({ ...inferred(id, 'claimed'), by: owner });

    const entries = byTicket.get(id) || [];

    // The ledger records review verdicts and nothing else, so the developer's half of each rework
    // loop — the fix, the re-verify, the re-request — was never written down anywhere. A `changes`
    // followed later by an `approved` is proof the ticket went back through review; the steps
    // between are inferred, because the alternative is a log whose every rework loop replays as a
    // violation and drowns the real ones.
    let inReview = false;
    const preReview = () => {
      events.push(inferred(id, 'done_reported'));
      // A board rendered as `qa (static only)` says in writing that its suite never ran. Migrating
      // that to a plain `verified` would launder the one fact the marker exists to keep.
      events.push(
        row.staticOnly
          ? inferred(id, 'verified_static', 'the executable test suite (recorded static-only on the board)')
          : inferred(id, 'verified', 'no verify-done record on the hand-written board')
      );
    };
    const enterReview = (to) => {
      if (inReview) return;
      preReview();
      events.push(inferred(id, 'review_requested', to ? `-> ${to}` : ''));
      inReview = true;
    };

    for (const entry of entries) {
      const name = LEDGER_EVENT[entry.action];
      if (!name) {
        notes.push(`${id}: ledger action "${entry.action}" (line ${entry._line}) has no event — dropped`);
        continue;
      }
      if (name === 'review_requested') {
        if (inReview) continue; // already re-entered; a duplicate request is not a second review
        preReview();
        inReview = true;
      } else {
        enterReview(entry.to || row.reviewer);
      }
      events.push({
        ts: entry.timestamp || null,
        ticket: id,
        event: name,
        by: name === 'review_requested' ? entry.from : entry.from || entry.to,
        detail: name === 'review_requested' ? `-> ${entry.to}` : '',
        provenance: entry.timestamp ? 'ledger' : 'inferred',
      });
      if (name === 'changes') inReview = false;
    }

    // A row sitting in review/qa/done with an empty ledger reached review some way nobody recorded.
    // A blocked or in_progress row did not, and inferring one for it would invent a review that
    // never happened — the migration's only job is to be honest about what it does not know.
    if (['review', 'qa', 'done'].includes(status)) enterReview(isEmpty(row.reviewer) ? '' : row.reviewer);

    const merged = entries.some((e) => e.action === 'merged');
    const approved = entries.some((e) => e.action === 'approved');
    if (['qa', 'done'].includes(status)) {
      if (!approved) {
        events.push({ ...inferred(id, 'approved', 'no approval on the board — status implies one'), by: isEmpty(row.reviewer) ? '' : row.reviewer });
        notes.push(`${id}: status "${status}" with no approved ledger line — approval is inferred, not evidence`);
      }
      if (!merged) events.push(inferred(id, 'merged'));
    }
    if (status === 'done') {
      events.push(inferred(id, 'qa_passed'));
      events.push(inferred(id, 'closed'));
    }
    if (status === 'blocked') events.push(inferred(id, 'blocked', isEmpty(row.notes) ? '' : row.notes));

    // The Cycles column is the pre-migration counter and it is exactly the thing that drifted from
    // the ledger. Trust the ledger; report the disagreement rather than silently picking one.
    const ledgerCycles = entries.filter((e) => e.action === 'changes').length;
    const columnCycles = Number.parseInt(row.cycles ?? '', 10);
    if (Number.isFinite(columnCycles) && columnCycles !== ledgerCycles) {
      notes.push(
        `${id}: Cycles column says ${columnCycles}, ledger has ${ledgerCycles} "changes" — migrated log uses the ledger`
      );
    }
  }

  return { events, notes, ticketCount: board.rows.length };
}

function cmdMigrate(pathArg, flags, paths) {
  const boardPath = resolve(process.cwd(), pathArg || paths.board);
  if (!existsSync(boardPath)) die(2, `no board at ${boardPath}`);
  let text;
  try {
    text = readFileSync(boardPath, 'utf8');
  } catch (error) {
    die(2, `cannot read ${boardPath}: ${error.message}`);
  }

  const migrated = migrate(text);
  if (!migrated) die(2, `no parseable ticket table in ${boardPath} — nothing to migrate`);

  const { events, notes, ticketCount } = migrated;
  const lines = events.map((e) => JSON.stringify(e)).join('\n');
  const out = typeof flags.out === 'string' ? resolve(process.cwd(), flags.out) : null;
  if (out) {
    // C3G-14: --out never overwrites. Pointed at the live log it replaced the chained, anchored
    // history with an unchained inferred one in one command; pointed at any other file it destroyed
    // that. A migration writes a NEW file, which a human then moves into place deliberately.
    if (existsSync(out) || out === paths.log) {
      die(1, `migrate --out ${flags.out}: ${out === paths.log ? 'that is the live event log' : 'the file exists'} — migrate writes a new file and never overwrites one. Choose a path that does not exist.`);
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${lines}\n`);
  } else {
    process.stdout.write(`${lines}\n`);
  }

  const inferredCount = events.filter((e) => e.provenance === 'inferred').length;
  const { violations } = reduce(events);
  process.stderr.write(
    `migrated ${ticketCount} ticket(s) -> ${events.length} event(s), ` +
      `${inferredCount} inferred (ts: null), ${events.length - inferredCount} from the ledger\n` +
      notes.map((n) => `  note: ${n}\n`).join('') +
      violations.map((v) => `  violation: ${v.reason}\n`).join('')
  );
}

// --------------------------------------------------------------------------------------------

/**
 * How many positional arguments each command takes, past the command word itself.
 *
 * AN EXTRA POSITIONAL USED TO BE SILENTLY DISCARDED. `board.mjs add APP-001 "Foundation"` — the
 * obvious spelling, and the one `docs/RESUME.md`'s standing probe used for weeks — recorded
 * `title: ""`, because the title is `--title` and `"Foundation"` went into `rest[1]` where nothing
 * read it. The command exited 0 and the board rendered `—` in the Title column forever.
 *
 * That is the quiet half of the argument-injection class already fixed in VALUE_FLAGS: there the
 * problem was a value read as a flag, here it is a value read as nothing at all. Both end with the
 * CLI reporting success for an instruction it did not carry out, which is the failure mode this
 * whole repository is built to refuse.
 *
 * Checked BEFORE the lock and before any append: refusing a malformed invocation must not first
 * take a lock or write an event.
 */
const EXPECTED_POSITIONALS = {
  add: { max: 1, usage: 'add <ID> --title "..." [--owner R] [--feature F-001] ...' },
  move: { max: 2, usage: 'move <ID> <event> --by <role> [--detail "..."]' },
  assign: { max: 1, usage: 'assign <ID> --to <role>' },
  show: { max: 1, usage: 'show [ID] [--json]' },
  render: { max: 0, usage: 'render' },
  verify: { max: 0, usage: 'verify' },
  adopt: { max: 0, usage: 'adopt [--mismatch deleted|appended|rewritten]   (founder, at a terminal: anchor a committed log in this checkout)' },
  actor: { max: 1, usage: 'actor mint --role R --ticket T [--ttl-minutes N] | actor revoke --token-id ID | actor list' },
  migrate: { max: 1, usage: 'migrate [path/to/31-board.md] [--out log.jsonl]' },
};

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;

  const arity = EXPECTED_POSITIONALS[command];
  if (arity && rest.length > arity.max) {
    const extra = rest.slice(arity.max);
    die(
      1,
      `${command} takes ${arity.max} positional argument(s); got ${rest.length}.\n` +
        `  Ignored: ${extra.map((a) => JSON.stringify(a)).join(' ')}\n` +
        `  usage: ${arity.usage}\n` +
        '  Every field past the ID is a NAMED flag. An extra positional was silently discarded until\n' +
        '  now, so `add APP-001 "My title"` recorded an empty title and still exited 0.'
    );
  }
  const paths = {
    log: typeof flags.log === 'string' ? resolve(process.cwd(), flags.log) : resolve(projectRoot(flags), DEFAULT_LOG),
    board: typeof flags.board === 'string' ? resolve(process.cwd(), flags.board) : resolve(projectRoot(flags), DEFAULT_BOARD),
  };

  // EVERY MUTATING COMMAND RUNS UNDER ONE LOCK, HELD ACROSS THE WHOLE READ-DECIDE-APPEND.
  //
  // `cmdAdd` and friends do loadLog -> reduce -> validate -> append: four steps with nothing
  // serializing them. Twelve concurrent `add` calls on a clean repo committed TWO events. Ten
  // tickets vanished with no error, and because each process chained its append onto the same
  // stale tip, the log was left corrupt — `verify` then reported "rewritten history" and told the
  // operator to go find what wrote to the file directly. The studio's own CLI had.
  //
  // Locking only the append would not fix this: the DECISION (is this transition legal, what is
  // the tip to chain onto) is made during the read, so the read must be inside the lock too.
  //
  // The lock lives HERE, at the single dispatch point, rather than inside each command — this
  // repository's defining defect is the fix that lands in one mechanism and stops before its
  // sibling, and a per-command lock is that defect waiting for the next command to be added.
  const MUTATES = new Set(['add', 'move', 'assign', 'migrate']);
  if (MUTATES.has(command)) {
    return withFileLock(paths.log, () => {
      // IDEMPOTENCY IS CHECKED INSIDE THE LOCK, not before it. Checked outside, two retries of the
      // same key could both find "not yet applied" and both commit — the very race the lock exists
      // to close, reintroduced by the deduplication meant to prevent duplicates.
      const key = typeof flags['idempotency-key'] === 'string' ? flags['idempotency-key'] : '';
      if (key) {
        // The subject of the retry must be named, or the guard cannot tell a repeat from a
        // different piece of work. `assign` is `assigned` under the hood — spelled out here so the
        // key is scoped to the event actually appended.
        const subject = normalizeId(rest[0] || '');
        const eventName = command === 'add' ? 'created' : command === 'assign' ? 'assigned' : String(rest[1] || '');
        const state = idempotencyState(paths.log, key, subject, eventName);
        if (state === 'duplicate') {
          // Exit 0: the caller asked for a state that now holds. A retry after an ambiguous timeout
          // must report success without committing a second effect.
          process.stdout.write(`already applied (idempotency-key ${key} on ${subject} ${eventName}) — nothing appended\n`);
          return undefined;
        }
        if (state === 'collision') {
          // NEVER exit 0 here. This key was used for DIFFERENT work, so treating it as a duplicate
          // would discard a real transition and call it success — the defect this branch exists to
          // prevent. Exit 2: cannot evaluate, because the caller's intent is genuinely unknowable.
          die(2, `idempotency-key ${key} was already used for a DIFFERENT transition.\n` +
                 `  Refusing: treating this as a duplicate would silently discard ${subject} ${eventName}.\n` +
                 '  Use a key unique to the transition (for example "<ticket>-<event>-<attempt>").');
        }
      }
      return dispatch(command, rest, flags, paths, key);
    }, { die });
  }
  return dispatch(command, rest, flags, paths, '');
}

function dispatch(command, rest, flags, paths, idempotencyKey = '') {
  switch (command) {
    case 'add':
      return cmdAdd(rest[0], flags, paths, idempotencyKey);
    // (arity is checked above, before the lock — see EXPECTED_POSITIONALS)
    case 'move':
      return cmdMove(rest[0], rest[1], flags, paths, idempotencyKey);
    case 'assign':
      return cmdAssign(rest[0], flags, paths, idempotencyKey);
    case 'show':
      return cmdShow(rest[0], flags, paths);
    case 'render':
      return cmdRender(paths);
    case 'verify':
      return cmdVerify(paths);
    case 'adopt':
      return cmdAdopt(paths, flags); // takes the log lock itself, after the founder confirms (C7-8)
    case 'migrate':
      return cmdMigrate(rest[0], flags, paths);
    case 'actor':
      return cmdActor(rest[0], flags);
    default:
      process.stderr.write(
        `board: unknown command "${command ?? ''}"\n` +
          '  add <ID> --title T [--owner R] [--depends A,B] [--status todo|blocked] ...\n' +
          '  move <ID> <event> --by <role> [--detail "..."]\n' +
          '  move <ID> merged --by <role> [--head <sha>]   --head only when no branch is named for <ID>\n' +
          '  move <ID> closed --by <role>    checked against the commit recorded at merged (--head only for a legacy merge)\n' +
          '  move <ID> verified_static --by <role> [--evidence <the --static record verify-done printed>]\n' +
          '  move <ID> corrected --by tech-manager --invariant "I1; I2"   record a ticket\'s invariants\n' +
          '  move <ID> corrected --by tech-manager --test-profile [--token T]   re-freeze the profile\'s test commands\n' +
          '  move <ID> reopened --by founder  blocked|review -> in_progress, +1 review cycle over the cap\n' +
          '  assign <ID> --to <role>\n' +
          '  show [ID] [--json]\n' +
          '  render\n' +
          '  verify                          the audit chain — was this log rewritten?\n' +
          '  adopt                           founder, at a terminal: anchor a committed log in a fresh clone\n' +
          '  move <ID> verified --by <role> --evidence <record verify-done printed> [--token T]\n' +
          '  move <ID> qa_passed --by <role> --evidence docs/team/journey-result.json|<post-merge record> [--token T]\n' +
          '  actor mint --role R --ticket T [--ttl-minutes N]   orchestrator only: prints a per-spawn token once\n' +
          '  actor mint --role founder --ticket T   the human founder, at a terminal (TTY): single-use, 30 min\n' +
          '  actor revoke --token-id ID | actor list\n' +
          '  migrate [board.md] [--out log.jsonl]\n' +
          `  events: ${[...EVENTS].join(' ')}\n`
      );
      return process.exit(1);
  }
}

main();
