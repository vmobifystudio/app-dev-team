#!/usr/bin/env node
/**
 * orchestrator — "what is legal now, and why". READ-ONLY. Mutates nothing, ever.
 *
 * THE PROBLEM. The sprint loop is ~610 lines of prose in `commands/app-build.md` plus ~360 in
 * `agents/tech-manager.md`. Individual checks are real scripts with real exit codes, but the
 * SEQUENCING — what may happen next, who may do it, and what must run first — is inferred by
 * whichever agent is reading the file at the time.
 *
 * The proof is not theoretical. In dry run 3 the orchestrator itself skipped a mandated transition,
 * sending a ticket straight to `code-reviewer` and bypassing verify-done -> verified ->
 * review_requested. The board's transition guard refused to forge the event, so nothing broke — but
 * the person driving that run had WRITTEN that sequence, in the same session, and still violated
 * it. With DR4-027 (the operator who spent a day hardening the isolation rule, then spawned two
 * writers into one checkout and lost 22 files) the pattern is unambiguous:
 *
 *     Knowing a rule, having written it, and having defended it does not make you apply it.
 *     A rule survives as a mechanism that runs, not a convention someone remembers.
 *
 * So this answers the sequencing question as a COMMAND rather than as a paragraph.
 *
 * WHY THIS IS NOT A SECOND SOURCE OF TRUTH — the design decision the whole file turns on.
 *
 * It would be easy, and wrong, to transcribe the state machine into a table here. `lib/events.mjs`
 * already owns which events are legal from which state, and `lib/capabilities.mjs` already owns who
 * may write each gate event. A copy of either would drift, and a workflow model that disagrees with
 * the CLI is worse than no model: it would confidently tell an agent to attempt something the
 * append will refuse.
 *
 * Instead this ASKS THE SAME VALIDATOR THE CLI ASKS. For every candidate (event, role) pair it
 * calls `validate()` — the identical function `board.mjs` calls before appending — and reports what
 * comes back. If the rules change in `lib/events.mjs`, this file's answers change with them,
 * because it has no opinion of its own to go stale.
 *
 * WHY THERE IS NO docs/team/workflow.json. The enhancement plan proposed the workflow as data in a
 * JSON file. Everything in it except the gate-precondition table is already data, in the two libs
 * above; the remainder is the same for every project this plugin runs, so a per-project config file
 * would be a file nobody ever edits and one more thing that can contradict the code. It lives below
 * as a constant. If a project ever genuinely needs a different gate order, that is the moment to
 * lift it into a file — not before.
 *
 * WHAT THIS DELIBERATELY CANNOT DO. There are no mutation commands. `claim`, `advance`,
 * `record-result` and recovery automation are out of scope until this model has been run alongside
 * a real sprint and its disagreements with the prose are findings rather than guesses. A workflow
 * engine that mutates state before its model has been validated against a real run is exactly the
 * second truth the control room was carefully designed to avoid.
 *
 * Usage:
 *   orchestrator.mjs round                every mechanical precondition of a build round, then next
 *   orchestrator.mjs ship                 every mechanical precondition of a release
 *   orchestrator.mjs next [--json]        every ticket, what may happen to it next, and by whom
 *   orchestrator.mjs explain <TICKET>     why this ticket is or is not actionable right now
 *   orchestrator.mjs status               one line: how much is actionable, blocked, waiting
 *
 * Exit codes:
 *   0  answered / every precondition clear
 *   1  a precondition BLOCKED (round, ship)
 *   2  cannot evaluate — no event log, or a precondition could not be checked. Never a pass.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { parseEventLog, reduce, validate, key } from './lib/events.mjs';
import { ROLES_IN_MATRIX } from './lib/capabilities.mjs';
import { BUILD_SPAWNABLE_OWNERS } from './lib/board.mjs';

const HERE_SCRIPTS = dirname(fileURLToPath(import.meta.url));

const die = (code, message) => { process.stderr.write(`orchestrator: ${message}\n`); process.exit(code); };

const { flags, positional } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['log', 'root', 'project-root']),
  die,
});
const [command, subject] = positional;

let ROOT;
if (typeof flags.root === 'string') {
  ROOT = resolve(flags.root);
} else {
  const resolved = resolveProjectRoot({
    explicit: typeof flags['project-root'] === 'string' ? flags['project-root'] : '',
  });
  if (!resolved.ok) die(2, explainRootFailure(resolved));
  ROOT = resolved.root;
}
const LOG = typeof flags.log === 'string' ? resolve(flags.log) : resolve(ROOT, 'docs/31-board-events.jsonl');

/**
 * The one thing here that is not already data elsewhere: which command must have RUN before an
 * event may honestly be written.
 *
 * `lib/events.mjs` enforces ORDER (you cannot approve what was never reviewed). It cannot enforce
 * EVIDENCE — it has no way to know whether anyone actually ran the test suite before writing
 * `verified`. That gap is where "green while nothing happened" lives, and naming it per event is
 * the difference between an agent knowing the next step and knowing how to earn it.
 *
 * These are advisory: this file reports them, it does not enforce them. Enforcement lives at the
 * append (capability, transition, review verdict, approval binding) where it cannot be skipped.
 */
const EARNED_BY = {
  verified: 'scripts/verify-done.sh <branch> <base> "<test command>" — exit 0. Never write this on an agent\'s say-so.',
  verified_static: 'scripts/verify-done.sh exit 2 with a TOOLCHAIN reason. This is the honest lane when the suite cannot run here; it blocks `closed`.',
  review_requested: 'a `verified` or `verified_static` since the last `done_reported` — the CLI refuses otherwise.',
  approved: 'a review document at docs/53-reviews/<ID>-cycle-N.md, passed as --verdict. The CLI refuses without it.',
  changes: 'the same review document, saying REQUEST CHANGES. The developer is re-spawned pointed at that file.',
  merged: 'a non-owner `approved` on the board; with requireApprovalBinding, approval-check.mjs --head must also clear.',
  qa_passed: 'a QA pass against the merged tree, recorded by qa-engineer — not by whoever wrote the code.',
  closed: 'a real `verified` (not `verified_static`): "done" is the word that asserts the suite ran green.',
  claimed: 'a worktree for this ticket and scripts/spawn-gate.sh exit 0 — isolation is a mechanism, not a convention.',
};

/** Every role that could plausibly be told to act. Union of the gate matrix and the spawnable set. */
const CANDIDATE_ROLES = [...new Set([...ROLES_IN_MATRIX, ...BUILD_SPAWNABLE_OWNERS])].sort();

function load() {
  if (!existsSync(LOG)) {
    die(2, `no event log at ${LOG}\n` +
           '  There is no sprint to reason about yet. `/app-plan` creates the board.');
  }
  let parsed;
  try { parsed = parseEventLog(readFileSync(LOG, 'utf8')); }
  catch (e) { die(2, `cannot read the event log: ${e.message}`); }
  // The raw events ride along: movement() measures staleness in BOARD EVENTS, which the reduced
  // ticket map cannot express — it holds the current state, not how much happened around it.
  return { ...reduce(parsed.events), events: parsed.events };
}

/**
 * For one ticket, what may legally happen next and who may do it.
 *
 * Derived by asking `validate()` per (event, role) pair — the same call `board.mjs` makes before
 * appending. Nothing here decides; it reports what the authority would say.
 */
function optionsFor(tickets, id) {
  const state = tickets.get(key(id));
  const byEvent = new Map();
  for (const role of CANDIDATE_ROLES) {
    for (const event of Object.keys(EARNED_BY).concat(['blocked', 'unblocked', 'done_reported', 'started', 'assigned', 'rejected'])) {
      const verdict = validate(tickets, { ticket: state.id, event, by: role });
      if (!verdict.ok) continue;
      if (!byEvent.has(event)) byEvent.set(event, []);
      byEvent.get(event).push(role);
    }
  }
  return [...byEvent.entries()]
    .map(([event, roles]) => {
      const set = [...new Set(roles)].sort();
      return {
        event,
        roles: set,
        // WORK EVENTS ARE OPEN TO EVERYONE BY DESIGN (capabilities.mjs: they report, they do not
        // decide), so enumerating all twenty-one roles beside `assigned` and `blocked` is noise
        // that buries the four-role answer beside `verified`. The distinction is the signal: a
        // short list means a gate, and a gate is the thing an orchestrator must not route around.
        gated: set.length < CANDIDATE_ROLES.length,
        earned_by: EARNED_BY[event] || null,
      };
    })
    .sort((a, b) => Number(b.gated) - Number(a.gated) || a.event.localeCompare(b.event));
}

function cmdNext() {
  const { tickets } = load();
  const rows = [...tickets.values()].map((t) => ({
    id: t.id,
    status: t.status,
    owner: t.owner || null,
    verifiedStatic: t.verifiedStatic,
    // A ticket whose dependency is unmet is not "actionable but tricky" — it is not actionable,
    // and saying so is the whole job of this command.
    // INTEGRATED, not merely merge-gated (B2). `qa` covers both "the wave landed this" and "the
    // gate passed and the wave has not run", and only the first satisfies a dependent. Same test
    // `validate()` applies, so this reporter cannot disagree with the refusal the CLI would give.
    blockedBy: (t.dependsOn || []).filter((d) => {
      const dep = tickets.get(key(d));
      return !dep || !['qa', 'done'].includes(dep.status) || dep.verifiedStatic === true;
    }),
    options: optionsFor(tickets, t.id),
  }));

  if (flags.json) { process.stdout.write(`${JSON.stringify({ schema: 'orchestrator-next/v1', tickets: rows }, null, 2)}\n`); return; }

  if (!rows.length) { process.stdout.write('ORCHESTRATOR: the board has no tickets.\n'); return; }
  process.stdout.write(`ORCHESTRATOR — what is legal now (${rows.length} ticket(s))\n\n`);
  for (const r of rows) {
    process.stdout.write(`  ${r.id}  [${r.status}${r.verifiedStatic ? ', static only' : ''}]${r.owner ? `  owner ${r.owner}` : ''}\n`);
    if (r.blockedBy.length) {
      process.stdout.write(`      NOT ACTIONABLE — depends on ${r.blockedBy.join(', ')}, whose code is not on the integration branch\n`);
    }
    if (!r.options.length) {
      process.stdout.write('      no legal transition from here for any known role\n');
    }
    for (const o of r.options) {
      const who = o.gated ? o.roles.join(', ') : 'any role (a work event — it reports, it does not decide)';
      process.stdout.write(`      ${o.gated ? 'GATE ' : '     '}${o.event.padEnd(17)} by ${who}\n`);
      if (o.earned_by) process.stdout.write(`           ${' '.repeat(17)}    earned by: ${o.earned_by}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write(
    '  These are the transitions the CLI would ACCEPT, asked of the same validator it uses.\n' +
    '  "earned by" is advisory and is NOT enforced here — it is enforced at the append.\n'
  );
}

function cmdExplain() {
  if (!subject) die(1, 'explain needs a ticket: orchestrator.mjs explain APP-001');
  const { tickets } = load();
  const state = tickets.get(key(subject));
  if (!state) die(2, `${subject} is not on the board — nothing to explain`);

  process.stdout.write(`ORCHESTRATOR — ${state.id}\n\n  status    ${state.status}${state.verifiedStatic ? ' (static only)' : ''}\n`);
  process.stdout.write(`  owner     ${state.owner || 'unassigned'}\n  cycles    ${state.cycles}\n`);
  if (state.dependsOn?.length) process.stdout.write(`  depends   ${state.dependsOn.join(', ')}\n`);

  process.stdout.write('\n  history\n');
  for (const e of state.events || []) {
    process.stdout.write(`    ${(e.ts || 'inferred').slice(0, 19).padEnd(19)}  ${String(e.event).padEnd(17)} ${e.by || '(unattributed)'}\n`);
  }

  const options = optionsFor(tickets, state.id);
  process.stdout.write('\n  what may happen next\n');
  if (!options.length) process.stdout.write('    nothing — no legal transition from here for any known role\n');
  for (const o of options) {
    const who = o.gated ? o.roles.join(', ') : 'any role (a work event)';
    process.stdout.write(`    ${o.gated ? 'GATE ' : '     '}${o.event.padEnd(17)} by ${who}\n`);
    if (o.earned_by) process.stdout.write(`         ${' '.repeat(17)}    earned by: ${o.earned_by}\n`);
  }

  // WHY SOMETHING IS *NOT* LEGAL IS THE MORE USEFUL HALF. An agent that knows the next step still
  // does not know why the step it wanted was refused, and that is where the loop actually stalls.
  process.stdout.write('\n  why not the others\n');
  const legal = new Set(options.map((o) => o.event));
  for (const event of Object.keys(EARNED_BY)) {
    if (legal.has(event)) continue;
    const verdict = validate(tickets, { ticket: state.id, event, by: state.owner || 'tech-manager' });
    process.stdout.write(`    ${event.padEnd(17)} ${verdict.reason || 'refused'}\n`);
  }
}

/**
 * `round` — every mechanical precondition of a build round, in order, as ONE command.
 *
 * WHY. `/app-build` is 658 lines and `tech-manager.md` another 365. Before any work happens an
 * agent must read past a thousand lines of instructions and then REMEMBER to run four separate
 * checks in the right order. That is the same pressure that produced dry run 3's skipped
 * transition: not ignorance, load. The steps were always scripts; what was prose was the
 * discipline of running all of them, every round, before spawning anybody.
 *
 * It RUNS NOTHING NEW. Every check below already existed and already had an exit code; this only
 * removes the opportunity to do three of four and believe you did all of them. Nothing here
 * mutates — no claim, no advance, no append. It is the read-only half on purpose: a model that
 * starts writing before it has been validated against a live loop is the second source of truth
 * the control room was designed to avoid.
 *
 * THE WORST ANSWER WINS, and CANNOT EVALUATE is not softened into a pass. A round that cannot
 * prove its preconditions is not a round that may spawn agents.
 */
/**
 * Is anything actually MOVING?
 *
 * THE NUMBER THAT PROMPTED THIS. Across every recorded run: 19 tickets created, ONE reached
 * `closed`. Eleven never left `created` — never claimed, never blocked, never refused. The gates
 * were not the obstacle; nothing ever reached them.
 *
 * And every existing check passes on that board. `board-doctor` says coherent — it is. `readiness`
 * says what it says about a release nobody is approaching. `orchestrator next` lists legal
 * transitions for tickets nobody is performing them on. Six dry-run reports analysed the QUALITY OF
 * REFUSALS and not one counted throughput, so a system that had stopped was indistinguishable from
 * one that was working carefully.
 *
 * TWO DISTINCT SIGNALS, because they need different responses:
 *
 *   READY BUT UNCLAIMED  every dependency merged, no owner has picked it up. This is the 11-of-19
 *                        case. It is not a defect in the ticket; it means the loop stopped
 *                        dispatching, and the fix is to spawn someone or to say why not.
 *   STALLED              in flight, but nothing has happened to it while the board moved on around
 *                        it. Measured in BOARD EVENTS rather than wall-clock: an agent loop has no
 *                        reliable clock, and "ten things happened and none of them were this" is
 *                        the honest statement of being left behind.
 *
 * Round one of a project has no history, so nothing can be stalled and nothing false-blocks.
 */
const STALL_EVENTS = Number(process.env.APP_TEAM_STALL_EVENTS || 10);
// ONLY `done` IS TERMINAL. This said `['done', 'qa']`, and that was a defect in the instrument
// itself: a ticket at `qa` has merged and still owes `qa_passed` and `closed`. Excluding it made
// the stall detector BLIND TO EXACTLY THE POPULATION IT WAS BUILT TO FIND — of 19 recorded tickets,
// 4 ended at `merged` and 2 at `qa_passed`, all of them sitting at `qa`, and this check would have
// reported the board as moving fine.
//
// Caught by the third experiment, which was aimed at those six tickets and found the transitions
// out of `merged` work cleanly (H3 falsified). The blind spot only surfaced because the experiment
// then asked whether the new instrument would have SEEN them. It would not have.
const TERMINAL = new Set(['done']);

function movement(tickets, events) {
  const unclaimed = [];
  const stalled = [];
  for (const t of tickets.values()) {
    if (TERMINAL.has(t.status)) continue;
    const deps = (t.dependsOn || []).filter((d) => {
      const dep = tickets.get(key(d));
      return !dep || !['qa', 'done'].includes(dep.status) || dep.verifiedStatic === true;
    });
    const everClaimed = (t.events || []).some((e) => e.event === 'claimed');
    const isUnclaimed = t.status === 'todo' && !deps.length && !everClaimed;
    if (isUnclaimed) unclaimed.push(t.id);

    // How much of the board moved since this ticket last did.
    //
    // COMPUTED FOR UNCLAIMED TICKETS TOO, and the first version did not — it `continue`d after
    // recording them, so the 11-of-19 case reported forever and never blocked. A signal that can
    // only ever be advice is the thing this whole check was written to stop being: a stopped loop
    // that looks identical to a careful one, round after round, with a friendly note about it.
    //
    // Round one is unaffected: nothing has ten events behind it yet.
    const lastIndex = events.map((e, i) => (key(e.ticket) === key(t.id) ? i : -1)).filter((i) => i >= 0).pop();
    const since = lastIndex === undefined ? events.length : events.length - 1 - lastIndex;
    if (since >= STALL_EVENTS && !deps.length) {
      stalled.push({ id: t.id, status: isUnclaimed ? 'never claimed' : t.status, since });
    }
  }
  return { unclaimed, stalled };
}

function cmdRound() {
  const steps = [
    { name: 'board doctor', argv: [resolve(HERE_SCRIPTS, 'board-doctor.mjs'), resolve(ROOT, 'docs/31-board.md')],
      blocked: 'the board is incoherent — spawn nobody until tech-manager repairs it',
      unknown: 'there is no board yet; run /app-plan' },
    { name: 'budget', argv: [resolve(HERE_SCRIPTS, 'round-journal.mjs'), 'check'],
      blocked: 'a ceiling is reached, or the emergency stop is set. Raising a ceiling is the operator\'s call, not a workaround',
      unknown: 'the budget could not be read' },
    { name: 'merge truth', argv: [resolve(HERE_SCRIPTS, 'merge-reconcile.mjs'), '--root', ROOT],
      blocked: 'a ticket claims its code is integrated and git says it is not — the board is lying',
      unknown: 'not a git repository, or no branch matches a ticket, so integration is UNKNOWN' },
    { name: 'toolchain', argv: [resolve(HERE_SCRIPTS, 'project-profile.mjs'), 'check'],
      blocked: 'a declared tool is the WRONG version — this project will not build correctly here',
      unknown: 'no project profile, or a declared tool is absent: the toolchain is UNPROVEN, which is not the same as fine' },

    // CI (OPS-001). `knowledge/git-workflow.md` has always said "a clean build + green tests is a
    // hard merge gate" and nothing implemented it — the merge gate reads an approval and nothing on
    // the server. Asking at the TOP of the round rather than at merge time costs one read-only
    // command, puts no agent in a polling loop, and still stops the studio piling a wave on top of
    // a red base. Opt-in via `.studio-policy.json: requireCiGreen`, so a project with no gh, no
    // remote or no CI is unaffected — a gate that deadlocks ordinary projects is a gate its first
    // user switches off.
    { name: 'ci', argv: [resolve(HERE_SCRIPTS, 'ci-status.mjs'), '--root', ROOT],
      blocked: 'the integration branch is RED and no waiver names that commit — fix it before adding a wave on top of it',
      unknown: 'CI could not be asked (no gh, not authenticated, no runs, or a run still going). NOT green — nobody asked' },

    // DISK (OPS-006). Worktree removal was only ever specified on the merge path, so a rejected,
    // blocked or crashed ticket left its tree behind forever, with no cap and no reaper. Measured in
    // this repository — which contains no application code — 12 worktrees and 88 MB. On an iOS
    // project each also carries its own DerivedData. This is REPORT-ONLY here (no `--apply`, because
    // this command is read-only by construction) and blocks only on the disk ceiling: an orphan is
    // reclaimable, a full disk fails every build on the machine.
    { name: 'worktree pool', argv: [resolve(HERE_SCRIPTS, 'worktree-reap.mjs'), '--root', ROOT],
      blocked: 'the agent worktree pool is over its disk ceiling — reclaim it (worktree-reap.mjs --apply) or raise the ceiling deliberately',
      unknown: 'not a git repository, or the event log is unreadable, so no worktree can be judged orphaned' },
  ];

  let worst = 0;
  const lines = [];
  for (const s of steps) {
    const r = spawnSync(process.execPath, s.argv, { cwd: ROOT, encoding: 'utf8' });
    const code = r.status === 0 ? 0 : r.status === 1 ? 1 : 2;
    worst = Math.max(worst, code);
    const state = code === 0 ? 'CLEAR' : code === 1 ? 'BLOCKED' : 'CANNOT EVALUATE';
    // A STEP THAT SOFTENED ITS OWN VERDICT MUST SAY SO ON THIS LINE.
    //
    // `ci-status.mjs` exits 0 whenever `requireCiGreen` is not armed, whatever it actually found —
    // deliberately, so an ordinary project without `gh` is not deadlocked. But printing a bare
    // `CLEAR ci` for "we could not ask anyone" is the exact green-while-nothing-happened shape this
    // file's own header argues against. Its headline rides along, so CLEAR never stands in for
    // CANNOT EVALUATE without saying which it was.
    const headline = (r.stdout || '').split('\n').find((l) => /^[A-Z ]+STATUS: /.test(l.trim()));
    const carried = code === 0 && headline && !/: PASS\b/.test(headline) ? ` — ${headline.trim()} (advisory: this project has not armed it)` : '';
    lines.push(`  ${state.padEnd(16)} ${s.name}${code === 1 ? ` — ${s.blocked}` : code === 2 ? ` — ${s.unknown}` : carried}`);
  }

  process.stdout.write('ROUND PRECONDITIONS\n\n' + lines.join('\n') + '\n\n');
  // THROUGHPUT IS REPORTED WHATEVER THE PRECONDITIONS SAID. A blocked round still wants to know
  // that eleven tickets have never been picked up; reporting it only on the happy path would hide
  // it exactly when the loop is already struggling.
  const { tickets, events } = load();
  const move = movement(tickets, events);
  if (move.unclaimed.length || move.stalled.length) {
    process.stdout.write('  MOVEMENT\n');
    if (move.unclaimed.length) {
      process.stdout.write(
        `    READY BUT UNCLAIMED (${move.unclaimed.length}): ${move.unclaimed.join(', ')}\n` +
        '        Every dependency merged and nobody has picked them up. Across every recorded run,\n' +
        '        11 of 19 tickets ended here — never claimed, never blocked, never refused. Spawn an\n' +
        '        owner, or say in the standup why not. Silence here is how a stopped loop looks\n' +
        '        identical to a careful one.\n'
      );
    }
    for (const s of move.stalled) {
      process.stdout.write(`    STALLED ${s.id} [${s.status}] — ${s.since} board events have happened since this one moved\n`);
    }
    process.stdout.write('\n');
  }

  // THE REGISTER IS REPORTED HERE AND ENFORCED AT SHIP, and the asymmetry is deliberate.
  //
  // Open bugs and unanswered findings mid-sprint are NORMAL — that is what a sprint is for — so
  // blocking a build round on them would deadlock the loop on its own inbox. `ship-gate.sh` is
  // where `register.mjs check` is a refusal. What this achieves is visibility every round instead
  // of a single discovery at the release, which is the specific failure OPS-004 describes: an item
  // with no ticket is invisible to the board, the doctor and the sprint summary, and gets closed by
  // being unmentioned.
  {
    const reg = spawnSync(process.execPath, [resolve(HERE_SCRIPTS, 'register.mjs'), '--root', ROOT, 'check', '--json'], { cwd: ROOT, encoding: 'utf8' });
    if (reg.status === 0 || reg.status === 1) {
      try {
        const parsed = JSON.parse(reg.stdout);
        if (parsed.open > 0) {
          process.stdout.write(`  REGISTER — ${parsed.open} of ${parsed.total} item(s) still owe an answer\n`);
          for (const i of parsed.openItems.slice(0, 8)) {
            process.stdout.write(`    ${String(i.status).padEnd(12)} ${String(i.id).padEnd(14)} ${i.ticket ? `-> ${i.ticket}` : 'NO TICKET — nothing will pick this up'}  ${i.title}\n`);
          }
          if (parsed.openItems.length > 8) process.stdout.write(`    ... and ${parsed.openItems.length - 8} more (register.mjs check)\n`);
          process.stdout.write('    Not blocking a round; ship-gate.sh refuses on these. An item with no ticket is the one\n    to act on now — it is the shape that gets closed by being unmentioned.\n\n');
        }
      } catch { /* a register that will not parse is ship-gate's problem, loudly, not this reporter's */ }
    }
  }

  // VERIFIED-STATIC ODOMETER (OPS-013). Per-ticket verification is static-only by design (see
  // `knowledge/git-workflow.md`'s wave model) and a wave landing green upgrades it to real
  // `verified`. Nothing counted how many tickets were CURRENTLY sitting on the static-only promise
  // rather than the executed one — `round-journal.mjs` records rounds/spawns/retries but has no
  // field for this, so a sprint could carry a growing pile of never-actually-run suites and nobody
  // would see the number until asked. Reported here, every round; not blocked, because static-only
  // is legitimate mid-wave — it is only a problem if it never clears.
  {
    const staticOnly = [...tickets.values()].filter((t) => t.verifiedStatic === true).map((t) => t.id);
    if (staticOnly.length) {
      process.stdout.write(
        `  VERIFIED STATIC — ${staticOnly.length} ticket(s) have not had the executable suite run yet: ` +
        `${staticOnly.slice(0, 10).join(', ')}${staticOnly.length > 10 ? ` … and ${staticOnly.length - 10} more` : ''}\n` +
        '    Cleared by a green `wave-integrate.mjs` for the wave each belongs to. If this count is not\n' +
        '    shrinking round over round, waves are not landing — that is the thing to chase, not the flag.\n\n'
      );
    }
  }

  // CROSS-TICKET REVIEW PATTERNS (OPS-014). Code review is per-ticket, so three tickets failing
  // review on the same underlying spec defect each burn their own retry with no correlation, even
  // though every verdict is already on disk in `docs/53-reviews/`. Report-only: a shared blocking
  // file across tickets is a lead for a human or tech-manager, never a block on its own.
  {
    const scan = spawnSync(process.execPath, [resolve(HERE_SCRIPTS, 'review-pattern-scan.mjs'), '--root', ROOT, '--json'], { cwd: ROOT, encoding: 'utf8' });
    if (scan.status === 0) {
      try {
        const parsed = JSON.parse(scan.stdout);
        if (parsed.evaluated && parsed.patterns?.length) {
          process.stdout.write(`  REVIEW PATTERNS — ${parsed.patterns.length} file(s) have blocked more than one ticket\n`);
          for (const p of parsed.patterns.slice(0, 5)) {
            process.stdout.write(`    ${p.file} -> ${p.tickets.join(', ')}\n`);
          }
          process.stdout.write('    Same file, multiple tickets — worth checking for one shared root cause before a\n    further ticket retries into it blind (review-pattern-scan.mjs for the full list).\n\n');
        }
      } catch { /* an unparsable scan is not this reporter's failure */ }
    }
  }

  // TICKETS THAT DECLARE NO FILES (OPS-007). `contention-check.mjs` can only see the file set a
  // ticket declared at creation, and declaring it is conditional — so the ORDINARY ticket has no
  // collision protection and the printed word is an honest `CANNOT EVALUATE` that still lets both
  // agents go. Reported here, every round, because the fix is one `--file` at planning time and
  // costs nothing, while the same gap discovered at merge time costs a rebase and a cold respawn.
  //
  // Reported, not blocked: arming it is `.studio-policy.json: requireTicketFiles`, which
  // `dispatch-preflight` enforces at the spawn. A round that refused every legacy ticket would be
  // a gate its first user switches off.
  {
    const undeclared = [...tickets.values()]
      .filter((t) => !TERMINAL.has(t.status) && t.status !== 'blocked')
      .filter((t) => !(t.meta?.files || []).length)
      .map((t) => t.id);
    if (undeclared.length) {
      process.stdout.write(
        `  FILE SETS — ${undeclared.length} ticket(s) declare no files: ${undeclared.slice(0, 10).join(', ')}` +
        `${undeclared.length > 10 ? ` … and ${undeclared.length - 10} more` : ''}\n` +
        '    contention-check cannot judge these, so two agents can be dispatched into the same file\n' +
        '    and find out at merge. Declare what each touches — `board.mjs add --file a,b` on a new\n' +
        '    ticket, or `move <ID> corrected --detail \'{"files":["a","b"]}\'` on an existing one —\n' +
        '    then set "requireTicketFiles": true once the board is clean, to keep it that way.\n\n'
      );
    }
  }

  // INTENT DRIFT, REPORTED IN THE ROUND THAT CREATES IT (EE-009).
  //
  // `trace.mjs` walks goal -> outcome -> requirement -> criterion -> ticket -> test -> analytics and
  // reports every break. Its callers were `/app-init`, `/app-run` (before Gate 1) and `/app-ship`:
  // before any ticket exists, and again when it is too late to be cheap. Nothing ran it during the
  // sprint that creates the drift — so a ticket cut mid-round (a `BUG-NNN-fix`, an `AUDIT-NNN`,
  // anything tech-manager files in response to QA) attaches to no requirement and nothing notices
  // until the release gate asks.
  //
  // Reported, never blocking: a mid-sprint board legitimately has loose ends, and a round that
  // refused to start over an untraced bug-fix ticket would be switched off in a week.
  {
    const tr = spawnSync(process.execPath, [resolve(HERE_SCRIPTS, 'trace.mjs'), '--project-root', ROOT, '--only', 'trace', '--json'], { cwd: ROOT, encoding: 'utf8' });
    if (tr.status === 1) {
      try {
        const parsed = JSON.parse(tr.stdout);
        const breaks = parsed.trace?.breaks || parsed.breaks || [];
        if (breaks.length) {
          process.stdout.write(`  INTENT — ${breaks.length} break(s) in the goal -> ticket -> test chain\n`);
          for (const b of breaks.slice(0, 6)) process.stdout.write(`    ${typeof b === 'string' ? b : (b.detail || b.node || JSON.stringify(b)).slice(0, 140)}\n`);
          if (breaks.length > 6) process.stdout.write(`    ... and ${breaks.length - 6} more (trace.mjs --only trace)\n`);
          process.stdout.write('    Not blocking a round. /app-ship asks the same question with more at stake.\n\n');
        }
      } catch { /* trace's own exit-2 path reports itself at ship; this reporter stays quiet */ }
    }
  }

  if (worst === 0 && move.stalled.length) {
    process.stdout.write(
      '  RESULT: BLOCKED — every precondition is clear and work is not moving.\n' +
      '  That combination is the one this check exists for: a coherent board where nothing is\n' +
      '  happening passes every other gate in this studio. Claim it, block it with a reason, or\n' +
      '  close it — but do not run another round around it.\n'
    );
    process.exit(1);
  }

  if (worst === 0) {
    process.stdout.write('  All preconditions CLEAR. What is legal now:\n\n');
    cmdNext();
    process.exit(0);
  }
  process.stdout.write(
    worst === 1
      ? '  RESULT: BLOCKED — spawn nobody this round. Fix what is named above.\n'
      : '  RESULT: CANNOT EVALUATE — a precondition could not be checked. This is NOT a pass;\n' +
        '  supply what is named above rather than proceeding on the assumption it is fine.\n'
  );
  process.exit(worst);
}

/**
 * `ship` — the mechanical preconditions of a release, in order, as ONE command.
 *
 * Same argument as `round`, at the other end of the pipeline: /app-ship is 328 lines and its first
 * four steps were four separate paragraphs each ending in "read the exit code". They are the four
 * questions that must all hold before a human is asked to submit anything:
 *
 *   is the board coherent          a release is the worst moment to discover an incoherent board
 *   is the candidate ready         ONE reducer — including the artifact bound to its commit
 *   is the evidence still current  a gate answers at a moment and then stops thinking
 *   did the process complete       ship-gate's preconditions
 *
 * DELIBERATELY NOT INCLUDED, with reasons rather than omission:
 *
 *   release-candidate record  needs `--artifact <path>`, which only the caller knows. Guessing it
 *                             would be inventing the subject of the whole release.
 *   runtime-gate              needs a device or simulator and takes minutes. It stays its own step
 *                             so a CANNOT EVALUATE there is unmistakably about the environment.
 *   the human submission      I-12. No executable path submits or publishes, and this is a
 *                             read-only reporter, not an exception to that.
 */
function cmdShip() {
  const steps = [
    { name: 'board', argv: [resolve(HERE_SCRIPTS, 'board-doctor.mjs'), resolve(ROOT, 'docs/31-board.md')],
      blocked: 'the board is incoherent — a release is the worst moment to find that out',
      unknown: 'there is no board to check' },
    { name: 'readiness', argv: [resolve(HERE_SCRIPTS, 'readiness.mjs')],
      blocked: 'BLOCKED or STALE. STALE is not a failure — nobody has checked THIS candidate. Re-run the gates it names, or rebuild and re-record',
      unknown: 'a gate has never run for this project, or no artifact was recorded — what would be uploaded is UNKNOWN' },
    { name: 'ship gate', argv: [resolve(HERE_SCRIPTS, 'ship-gate.sh')],
      blocked: 'a release precondition failed — read its lines verbatim, they name which',
      unknown: 'a precondition could not be checked; supply what it names' },
  ];

  let worst = 0;
  const lines = [];
  for (const s of steps) {
    const isShell = s.argv[0].endsWith('.sh');
    const r = isShell
      // `--record` writes docs/team/ship-gate-verdict.json, which the control room's Mission
      // Control panel defers to. Dry run 5 found its narrower sweep could report `clear` while this
      // gate had just returned BLOCKED, so the recorded verdict is not optional decoration.
      ? spawnSync('sh', [s.argv[0], ROOT, '--record'], { cwd: ROOT, encoding: 'utf8' })
      : spawnSync(process.execPath, s.argv, { cwd: ROOT, encoding: 'utf8' });
    const code = r.status === 0 ? 0 : r.status === 1 ? 1 : 2;
    worst = Math.max(worst, code);
    const state = code === 0 ? 'CLEAR' : code === 1 ? 'BLOCKED' : 'CANNOT EVALUATE';
    lines.push(`  ${state.padEnd(16)} ${s.name}${code === 1 ? ` — ${s.blocked}` : code === 2 ? ` — ${s.unknown}` : ''}`);
  }

  process.stdout.write('SHIP PRECONDITIONS\n\n' + lines.join('\n') + '\n\n');
  process.stdout.write(
    worst === 0
      ? '  All CLEAR. Still to do by hand: the runtime gate, and the human submission decision.\n' +
        '  Nothing here submits or publishes anything — that boundary is constitutional (I-12).\n'
      : worst === 1
        ? '  RESULT: BLOCKED — do not release. Fix what is named above.\n'
        : '  RESULT: CANNOT EVALUATE — a precondition could not be checked. This is NOT a pass.\n'
  );
  process.exit(worst);
}

function cmdStatus() {
  const { tickets } = load();
  const all = [...tickets.values()];
  const actionable = all.filter((t) => optionsFor(tickets, t.id).length > 0);
  process.stdout.write(
    `ORCHESTRATOR: ${all.length} ticket(s) — ${actionable.length} with a legal next transition, ` +
    `${all.length - actionable.length} with none\n`
  );
}

switch (command) {
  case 'next': cmdNext(); break;
  case 'explain': cmdExplain(); break;
  case 'round': cmdRound(); break;
  case 'ship': cmdShip(); break;
  case 'status': cmdStatus(); break;
  default:
    die(1, `unknown command "${command ?? ''}"\n` +
           '  round                every mechanical precondition of a build round, then next\n' +
           '  ship                 every mechanical precondition of a release\n' +
           '  next [--json]        what may happen to every ticket, and by whom\n' +
           '  explain <TICKET>     why this ticket is or is not actionable\n' +
           '  status               one-line summary\n' +
           '  This command is READ-ONLY. It never appends, claims or advances anything.');
}
