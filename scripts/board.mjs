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
 *   board.mjs assign <ID> --to <role> [--by <role>]
 *   board.mjs show  [ID] [--json]
 *   board.mjs render
 *   board.mjs migrate [path/to/31-board.md] [--out path.jsonl]
 *
 * Common flags: --log <events.jsonl>  --board <31-board.md>
 *
 * Events: created · claimed · assigned · done_reported · verified · verified_static · rejected ·
 *         review_requested · started · approved · changes · merged · qa_passed · qa_failed ·
 *         blocked · unblocked · closed
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

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { parseArgs as parseArgv } from './lib/args.mjs';
import { withFileLock } from './lib/atomic.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
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
} from './lib/events.mjs';

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
 */
const VALUE_FLAGS = new Set([
  'title', 'feature', 'owner', 'depends', 'estimate', 'spec', 'acceptance', 'notes',
  'status', 'by', 'detail', 'reason', 'to', 'log', 'board', 'out',
  'invariant', 'rollback', 'file', 'change', 'commit', 'idempotency-key', 'project-root', 'base',
]);

const parseArgs = (argv) => parseArgv(argv, { valueFlags: VALUE_FLAGS, die });

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
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(logPath, `${sep}${JSON.stringify({ ...event, hash: chainHash(chain.tip, event) })}\n`);
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
  try { return JSON.parse(result.stdout).risk || null; }
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
    risk: deriveRisk(flags, paths),
  };
  const event = {
    ts: new Date().toISOString(),
    ticket: normalizeId(id),
    event: 'created',
    by: flags.by || 'tech-manager',
    detail,
    provenance: 'cli',
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
      detail: detail.notes || scrub('--reason', flags.reason || '') || 'created blocked',
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
 */
function bindApprovalEvidence(flags) {
  let commit;
  if (typeof flags.commit === 'string' && flags.commit) {
    try { commit = execFileSync('git', ['rev-parse', '--verify', `${flags.commit}^{commit}`], { encoding: 'utf8' }).trim(); }
    catch { return { ok: false, code: 2, reason: `--commit ${flags.commit} does not resolve to a real commit` }; }
  } else {
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
    catch { return { ok: false, code: 2, reason: 'cannot resolve HEAD — is this a git repository, and if not run from inside the reviewed worktree, pass --commit <sha>?' }; }
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
  let base = typeof flags.base === 'string' ? flags.base : '';
  let baseSource = 'explicit --base';
  if (!base) {
    for (const ref of ['main', 'master', 'origin/main', 'origin/master']) {
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
  let files = [];
  try { files = execFileSync('git', ['diff', '--name-only', base, commit], { encoding: 'utf8' }).split('\n').filter(Boolean); }
  catch { /* recorded as empty; the diff hash is still authoritative */ }
  if (!flags.evidence) return { ok: false, reason: '--bind requires --evidence <path to the evidence the review used>' };
  if (!flags.context) return { ok: false, reason: '--bind requires --context <path to the context the review used>' };
  const evidencePath = resolve(process.cwd(), String(flags.evidence));
  const contextPath = resolve(process.cwd(), String(flags.context));
  if (!existsSync(evidencePath)) return { ok: false, reason: `no evidence file at ${flags.evidence}` };
  if (!existsSync(contextPath)) return { ok: false, reason: `no context file at ${flags.context}` };
  return {
    ok: true,
    detail: {
      commit,
      base,
      base_source: baseSource,
      files,
      diff_hash: createHash('sha256').update(diff).digest('hex'),
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

  const event = {
    ts: new Date().toISOString(),
    ticket,
    event: name,
    by: flags.by || '',
    detail: typeof flags.detail === 'object' ? flags.detail : scrub('--detail', flags.detail || ''),
    provenance: 'cli',
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
      const next = reduce([...events, forced]);
      writeView(paths.board, next.tickets);
      process.stderr.write(`  -> ${ticket} moved to blocked instead: ${result.force.detail}\n`);
      reportCascade(next.tickets, ticket);
    }
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

  if (name === 'approved' && flags.bind) {
    const bound = bindApprovalEvidence(flags);
    if (!bound.ok) {
      process.stderr.write(`board: refused ${ticket} approved — ${bound.reason}\n`);
      process.exit(bound.code || 1);
    }
    event.detail = typeof event.detail === 'object' && event.detail
      ? { ...event.detail, ...bound.detail }
      : { note: event.detail || undefined, ...bound.detail };
  }

  append(paths.log, event);
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
  process.stdout.write(
    `AUDIT CHAIN: intact — ${chain.chained} chained line(s)` +
      (chain.unchained
        ? `, ${chain.unchained} unchained line(s) written before the chain existed (covered by the\n` +
          '  first chained line\'s anchor: editing them breaks verification too).\n'
        : '.\n')
  );
  process.exit(0);
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

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;
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
    case 'migrate':
      return cmdMigrate(rest[0], flags, paths);
    default:
      process.stderr.write(
        `board: unknown command "${command ?? ''}"\n` +
          '  add <ID> --title T [--owner R] [--depends A,B] [--status todo|blocked] ...\n' +
          '  move <ID> <event> --by <role> [--detail "..."]\n' +
          '  assign <ID> --to <role>\n' +
          '  show [ID] [--json]\n' +
          '  render\n' +
          '  verify                          the audit chain — was this log rewritten?\n' +
          '  migrate [board.md] [--out log.jsonl]\n' +
          `  events: ${[...EVENTS].join(' ')}\n`
      );
      return process.exit(1);
  }
}

main();
