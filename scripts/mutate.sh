#!/bin/sh
# mutate — prove this repo's assertions can go red.
#
# WHY THIS EXISTS
#
# On 2026-07-29 `scripts/test.sh` reported "385 passed, 0 failed" while containing assertions that
# could not fail. They were found by hand — a reviewer broke the code and watched whether the suite
# noticed. In one afternoon that technique found:
#
#   - "the page loads nothing from the network" used a PCRE lookahead in `grep -E`. The pattern was
#     a SYNTAX ERROR, stderr went to /dev/null, and control always fell through to `|| ok`. A live
#     CDN URL sat in the page and the suite stayed green.
#   - two board-doctor assertions grepped the whole `--json` blob, so demoting an anomaly to a
#     warning — DELETING the gate — left them green. One also matched a prefix of a different code.
#   - "one parser, proven by agreement" compared two callers of the SAME function. Mutating that
#     function so every merged ticket got the wrong status left the assertion green while seven
#     unrelated ones caught it.
#   - a PreToolUse hook that could not fire (GNU-only sed on BSD), and a second version that stood
#     down in exactly the incident it was written for.
#
# A green suite is evidence only to the extent its assertions can go red. That has to be a
# mechanism, not something a reviewer happens to do on a good day. This is the mechanism.
#
# HOW IT WORKS
#
# The repo is copied ONCE to a temp dir. Each mutation is applied to that copy — never the real
# tree — `scripts/test.sh` is run there, and the copy is restored from the real tree afterwards.
# Restore is unconditional (trap). On exit the real tree is compared against the snapshot taken at
# start; a mutation tester that leaves the repo mutated is worse than no mutation tester.
#
#   CAUGHT (n assertions)  the suite went red. The gate bites.
#   SURVIVED               the suite stayed green with the gate broken. THAT IS A HOLE.
#
# `CAUGHT, but not by <label>` means the suite noticed via some other assertion while the one
# written to guard this behaviour stayed green. That is the "proven by agreement" class above: the
# named assertion is decorative even though the score looks fine.
#
# Usage:
#   sh scripts/mutate.sh                 every mutation, each against ONLY its test.sh section
#   sh scripts/mutate.sh --list          print the catalogue and exit
#   sh scripts/mutate.sh --only M04      one mutation (or a list: --only M38,M39,M40)
#   sh scripts/mutate.sh --sample 4      4 mutations, spread evenly across the catalogue (CI)
#
# Exit:
#   0  every mutation applied was caught
#   1  at least one mutation SURVIVED
#   2  could not run — baseline suite not green, an anchor no longer matches, no git, etc.
#
# ---------------------------------------------------------------------------------------------
# THE CATALOGUE
# ---------------------------------------------------------------------------------------------
# Fields, `@@`-separated (not `|` — half these mutations are `grep -E` patterns full of `|`):
#
#     id @@ file @@ exact text to find @@ replacement @@ assertion label expected to fail
#
# The find text must occur EXACTLY ONCE in the file. Zero or many stops the run with exit 2 rather
# than reporting a survivor: a mutation whose anchor has drifted proves nothing, and silently
# counting it as survived would be its own false alarm.
#
#   id   category                          what it breaks
#   M01  invert a gate's exit code         spawn-gate REFUSED becomes GO — an unisolated parallel spawn proceeds (DR4-027)
#   M02  flip a comparison operator        ship-gate stops counting open S1/S2 bugs as blocking
#   M03  neuter a regex                    ship-gate stops rejecting CI that masks an exit code (DR4-023)
#   M04  demote an anomaly to a warning    board-doctor's review-integrity findings stop blocking the spawn
#   M05  flip a comparison operator        board-doctor blocks the second rework /app-build explicitly permits
#   M06  neuter a regex                    the one board parser truncates BUG-NNN-fix to BUG-NNN (DR4-008 class)
#   M07  guard unconditional (if false)    a role may approve its own ticket
#   M08  guard unconditional (if false)    a ticket may merge with no external approval
#   M09  guard unconditional (if false)    review may be requested on a DONE nobody verified
#        ** SURVIVES today.** Not because an assertion is decorative — because the branch is
#        unreachable: `legalEvents()` already omits `review_requested` unless `state.verified`, so
#        the transition check's own `if (!state.verified)` can never run and its better-worded
#        refusal is never the one anyone sees. Left in the catalogue deliberately: a guard that
#        reads like a gate and cannot execute is exactly what this tool is for. Resolve it by
#        deleting one of the two checks, not by deleting the mutation.
#   M10  return the fallback, not refuse   integration-branch falls back to main instead of exit 2
#   M11  guard unconditional (if false)    team-message's per-role ping-pong cap stops firing
#   M12  flip a comparison operator        team-message's chain-depth cap fires backwards
#   M13  drop a liveness check             the destructive-git hook stands down in a DIRTY tree — i.e. in exactly the incident it exists for
#   M14  neuter a regex                    the hook stops recognising `git stash`, the DR4-027 command
#   M15  neuter a regex                    verify-done calls a missing toolchain a REJECTED test (DR4-001)
#   M16  flip a comparison operator        round-journal lets the loop run one spawn past its ceiling
#
# NOT MUTATABLE HERE — declared, not hidden. Reasons are in `excluded()` below and are PRINTED with
# the score, so the denominator says what it excluded. A mutation score that quietly omits the
# untestable parts is the same lie as a green suite full of decorative assertions.
#
# ADDING ONE: a new gate ships with a mutation proving its assertion bites. See
# skills/mutation-testing/SKILL.md.

set -u

ME=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$ME/.." && pwd)
# The field separator is US (\037), not a tab: IFS treats a tab as whitespace, so an EMPTY field
# (MF47T's empty replacement) collapsed and every later field shifted one left: the mutation
# replaced its anchor with the assertion label, and the label became the scope.
TAB=$(printf '\037')
ONLY=""
SAMPLE=""
LIST=0
FULL_SUITE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --list) LIST=1; shift ;;
    --only) ONLY="${2:-}"; shift 2 || exit 2 ;;
    --only=*) ONLY="${1#--only=}"; shift ;;
    --sample) SAMPLE="${2:-}"; shift 2 || exit 2 ;;
    --sample=*) SAMPLE="${1#--sample=}"; shift ;;
    # Ignore every catalogue scope and run the whole suite per mutation, as this script always did.
    # The nightly `mutation-full.yml` uses it: a scope is a claim that no OTHER section could have
    # caught the mutation, and once a quarter it is worth not taking that claim on trust.
    --full-suite) FULL_SUITE=1; shift ;;
    -h|--help) sed -n '36,46p' "$0"; exit 0 ;;
    *) echo "mutate: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

if [ -n "$SAMPLE" ]; then
  case "$SAMPLE" in
    ''|*[!0-9]*) echo "mutate: --sample takes a whole number" >&2; exit 2 ;;
  esac
  [ "$SAMPLE" -ge 1 ] || { echo "mutate: --sample must be >= 1" >&2; exit 2; }
fi

# ---------------------------------------------------------------------------------------------
catalogue() {
  cat <<'CATALOGUE'
M01@@scripts/spawn-gate.sh@@exit 1@@exit 0@@REFUSES two writing agents when neither has a worktree
M02@@scripts/ship-gate.sh@@[ "${OPEN:-0}" -gt 0 ] && block@@[ "${OPEN:-0}" -lt 0 ] && block@@counts open S1/S2 bugs correctly
M03@@scripts/ship-gate.sh@@grep -nE '(\|\|[[:space:]]*(true|:)([[:space:]]|$))|continue-on-error:[[:space:]]*true'@@grep -nE 'zzzz-this-pattern-matches-nothing'@@a generated workflow that masks an exit code blocks the release
M04@@scripts/board-doctor.mjs@@(reviewChecksBlock ? anomalies : warnings).push(item)@@warnings.push(item)@@emits done_without_review@@DR4-001: a MISSING TOOLCHAIN is not a FAILING TEST
M05@@scripts/board-doctor.mjs@@effectiveCycles > cap && ACTIVE_STATUS.has(row.status)@@effectiveCycles >= cap && ACTIVE_STATUS.has(row.status)@@Cycles = 2 in review is the budget spent, not a breach
M06@@scripts/lib/board.mjs@@/[A-Za-z]+-\d+(?:-[A-Za-z]+)?/g@@/[A-Za-z]+-\d+/g@@suffixed ticket ids parse whole (BUG-NNN-fix)
M07@@scripts/lib/events.mjs@@if (by && workers.has(by)) {@@if (false) {@@the ticket's owner approving their own ticket is refused
M08@@scripts/lib/events.mjs@@if (!external.length) {@@if (false) {@@a merge with no approval at all is refused
M09@@scripts/lib/events.mjs@@if (!state.verified) {@@if (false) {@@review_requested on a DONE with no verify-done result is refused
M10@@scripts/integration-branch.sh@@integration branch is not recoverable by a later fix. Create the branch, or fix the doc."@@integration branch is not recoverable by a later fix."; echo "$FALLBACK"; exit 0@@a declared branch that does not exist is exit 2, never a fallback
M11@@scripts/lib/messages.mjs@@if (recent >= MAX_PER_ROLE) {@@if (false) {@@the per-role cap refuses the eleventh message of a round
M12@@scripts/lib/messages.mjs@@if (roles.size > MAX_CHAIN) {@@if (roles.size > MAX_CHAIN + 1) {@@a fifth role on one ticket's thread is refused
M13@@hooks/block-shared-tree-destructive-git.sh@@[ -n "$DIRTY" ] || continue@@[ -z "$DIRTY" ] || continue@@dirty tree: blocks git stash
M14@@hooks/block-shared-tree-destructive-git.sh@@} else if (sc == "stash") {@@} else if (sc == "zzzz-no-such-command") {@@dirty tree: blocks git stash
M15@@scripts/lib/test-evidence.mjs@@/command not found|: not found|no such file or directory|xcode-select: error|requires Xcode|xcrun: error|unable to find utility|cannot be located|unable to find a destination|GradleWrapperMain|permission denied|not recognized as an internal/i@@/zzzz-this-pattern-matches-nothing/i@@a missing toolchain is CANNOT EVALUATE, not REJECTED
M16@@scripts/round-journal.mjs@@if (t.spawns >= caps.spawns) breached.push@@if (t.spawns > caps.spawns) breached.push@@the spawn ceiling fires independently of the round ceiling
M17@@scripts/lib/capabilities.mjs@@if (!allowed.includes(actor)) {@@if (false) {@@a designer may not write a gate event (verified)
M18@@scripts/lib/capabilities.mjs@@if (NOT_ON_OWN_TICKET.has(name) && state && same(actor, state.owner)) {@@if (false) {@@QA may not pass the ticket it owns
M19@@scripts/lib/events.mjs@@if (record.hash !== expected) {@@if (false) {@@an edited line is detected, with the line number
M20@@scripts/lib/redact.mjs@@if (isPlaceholder(value)) continue;@@if (true) continue;@@the artifact scan fails on a credential-shaped string
M21@@scripts/spawn-gate.sh@@if [ -e "$STOP_ROOT/$STOP_FILE" ]; then@@if false; then@@spawn-gate refuses while the emergency stop file exists
M22@@scripts/injection-scan.mjs@@if (pattern.test(raw)) findings.push@@if (false) findings.push@@instruction-shaped content in repository text is reported
M23@@scripts/ship-gate.sh@@CHAIN_OUT=$(node "$HERE/board.mjs" verify --log "$LOG" 2>&1)@@CHAIN_OUT=$(true)@@ship-gate BLOCKS a release whose event log was rewritten
M24@@scripts/messages.mjs@@if (obligationOf(candidate) === null) {@@if (false) {@@an answer that names no artifact is REFUSED
M25@@scripts/lib/messages.mjs@@if (prior) {@@if (false) {@@a duplicate question on one ticket is refused
M26@@scripts/lib/messages.mjs@@if (decided.length && openQuestions(thread).length === 0 && !candidate.evidence) {@@if (false) {@@reopening a decided thread with no evidence is refused
M27@@scripts/lib/messages.mjs@@if (mine.length) {@@if (false) {@@a second open question from one role is refused — escalate the first
M28@@scripts/lib/messages.mjs@@if (spent >= MAX_PER_TICKET) {@@if (false) {@@the thirteenth message on one ticket is refused
M29@@scripts/lib/messages.mjs@@m.expires && m.expires < today@@m.expires && m.expires > today@@an expired waiver is a finding, not a formality
M30@@scripts/lib/messages.mjs@@if (record.v !== SCHEMA_VERSION) {@@if (false) {@@a schema-v2 record makes board-doctor CANNOT EVALUATE, never a pass
M31@@scripts/messages.mjs@@writeFileSync(md, renderMessages(messages));@@if (!existsSync(md)) writeFileSync(md, renderMessages(messages));@@a hand edit to the generated view is overwritten by the next render
M32@@scripts/accessibility-scan.mjs@@&& !/accessibilityLabel/.test(block)@@&& false@@comment-only and unlabelled SwiftUI controls remain detectable
M33@@scripts/privacy-disclosure-scan.mjs@@if (!findings.length)@@if (true)@@the lab passes against this tree@@S.7 repository controls
M34@@scripts/subscription-restore-scan.mjs@@&& !/Transaction\.currentEntitlements/.test(match[1])@@&& false@@the lab passes against this tree@@S.7 repository controls
M35@@scripts/financial-constant-scan.mjs@@if (!findings.length)@@if (true)@@a bankers rounding implementation under a half-up rule blocks release
M36@@scripts/requirements-conflict-scan.mjs@@if (prdQuota && archQuota && prdQuota !== archQuota)@@if (false)@@the lab passes against this tree@@S.7 repository controls
M37@@scripts/analytics-coverage-scan.mjs@@if (!missing.length)@@if (true)@@the lab passes against this tree@@S.7 repository controls
M38@@scripts/lib/register.mjs@@if (NEEDS_REASON.has(status)@@if (false && NEEDS_REASON.has(status)@@DEFERRED with no --reason is REFUSED (a deferral without one is an omission)@@register: the two trackers
M39@@scripts/lib/register.mjs@@if (status === 'FIXED' && !ticket) {@@if (false) {@@FIXED with no --ticket is REFUSED (nothing would be checkable against the board)@@register: the two trackers
M40@@scripts/worktree-reap.mjs@@dirty: state.live ? false : dirty(w.path)@@dirty: false@@a DIRTY orphan is reported, not reclaimed@@worktree-reap: the leak
M41@@scripts/worktree-reap.mjs@@if (finalMb > MAX_DISK_MB) {@@if (false) {@@the disk ceiling BLOCKS when the pool exceeds it@@worktree-reap: the leak
M42@@scripts/ci-status.mjs@@process.exit(ARMED ? code : 0);@@process.exit(0);@@armed, an unanswerable CI question is CANNOT EVALUATE — never a pass@@ci-status: the merge gate
M43@@scripts/verify-done.sh@@[ "$STATIC" -eq 1 ] && TESTS_STATUS="deferred-to-wave"@@:@@...naming WHY the suite did not run, so it is not mistaken for a missing command@@verify-done --static
M44@@scripts/worktree-slot.mjs@@if (!mine && others.length >= POOL) {@@if (false) {@@leasing past the pool size is REFUSED — that is the parallelism cap doing its job@@worktree-slot: one tree per WRITER
M45@@scripts/wave-integrate.mjs@@const green = run.verdict === 'green';@@const green = true;@@a wave whose merged tree fails its suite is exit 1 — the wave does not advance@@wave-integrate: merge once
M46@@scripts/ship-gate.sh@@    1) block "the register has item@@    1) note "the register has item@@ship-gate BLOCKS on a register item nobody has decided about@@ship-gate reads the register
M47@@scripts/dispatch-preflight.mjs@@if (policy.requireTicketFiles === true) {@@if (false) {@@...and ARMED, the same undeclared ticket is REFUSED at dispatch, not at merge@@requireTicketFiles
M48@@scripts/merge-reconcile.mjs@@const awaitingWave = (t) => t.status === 'qa' && t.verifiedStatic === true;@@const awaitingWave = () => false;@@a merge-gated ticket awaiting the wave does NOT block the loop@@EE-001
M49@@scripts/merge-reconcile.mjs@@const awaitingWave = (t) => t.status === 'qa' && t.verifiedStatic === true;@@const awaitingWave = () => true;@@...while a REAL verified whose branch is unmerged still BLOCKS — the gate still bites@@EE-001
M50@@scripts/messages.mjs@@if (open.length >= was && was > 0) {@@if (false) {@@...and --was REFUSES a Q&A batch that answered nothing@@EE-003 / EE-004
M51@@scripts/messages.mjs@@if (options.escalations) return escalations.length ? 1 : 0;@@if (options.escalations) return 0;@@...and an unclosed escalation exits 1, which is what /app-run surfaces to the user@@EE-003 / EE-004
M52@@scripts/messages.mjs@@process.exit(main() ?? 0);@@main();@@messages open exits 1 while a question still owes an answer@@EE-003 / EE-004
M53@@scripts/wave-integrate.mjs@@let ff = gitTry(['fetch', '.', `${WAVE_BRANCH}:${BASE}`], { cwd: ROOT });@@let ff = gitTry(['merge', '--ff-only', WAVE_BRANCH], { cwd: ROOT });@@--push fast-forwards $BASE itself, with the checkout on another branch entirely@@B1: --push must land
M55@@scripts/lib/events.mjs@@return dep.verifiedStatic === true;@@return false;@@a dependent is REFUSED while its dependency is merge-gated but not yet integrated@@B2: a dependency is satisfied
M56@@scripts/register.mjs@@if (refusal) { downgraded.push@@if (false) { downgraded.push@@...downgraded to OPEN, while a FIXED row that DOES name its ticket imports terminal@@B3: import-bugs is held
M57@@scripts/worktree-reap.mjs@@const totalMb = poolMb + cacheMb;@@const totalMb = poolMb;@@...so a cache over the ceiling BLOCKS, with no worktrees involved at all@@B4/B5/B6
M58@@scripts/ci-status.mjs@@const headline = ARMED || code === 0 ? state : `ADVISORY (${state})`;@@const headline = state;@@unarmed, ci-status says ADVISORY on line 1 rather than a verdict it is not enforcing@@B4/B5/B6
M59@@scripts/worktree-slot.mjs@@  if (mine) {@@  if (mine && !flags.force) {@@--force no longer buys a second lease past the guard its own header calls the one that matters@@B4/B5/B6
M60@@scripts/lib/board.mjs@@  return !(row.staticOnly === true || row.verifiedStatic === true);@@  return true;@@...and a merge-gated one awaiting the wave has NOT (board-row spelling)@@N1/N9: one predicate
M61@@scripts/messages.mjs@@if (m.kind === 'decision' && pending.length) pending.shift();@@if (m.kind === 'decision') { const j = pending.findIndex((x) => x.kind === 'escalation'); if (j >= 0) pending.splice(j, 1); }@@a decision that answered a QUESTION does not also close an escalation@@N5: one decision
M62@@scripts/messages.mjs@@if (options.count) { process.stdout.write(`${open.length}\n`); return 0; }@@if (false) { process.stdout.write(`${open.length}\n`); return 0; }@@...and that line is a bare number the runbook can use without a regex@@N8: --count
M63@@scripts/wave-integrate.mjs@@  if (outstanding.length > 1) { ambiguous.push({ id: t.id, branches: outstanding }); continue; }@@  if (false) { ambiguous.push({ id: t.id, branches: outstanding }); continue; }@@a ticket with two unintegrated branches is REPORTED, not picked between@@N2: ambiguity
M64@@scripts/wave-integrate.mjs@@branches.filter((b) => matchesTicket(b, t.id, ALL_IDS))@@branches.filter((b) => b.includes(t.id))@@...and APP-1 does not match the branch of APP-12@@N2: ambiguity
M65@@scripts/worktree-reap.mjs@@  if (/^integration-wave-/.test(name)) {@@  if (false) {@@...and --apply never reaps it, because a kept wave tree is CLEAN and the dirty check would not save it@@N3: the kept
M66@@scripts/register.mjs@@  if (!ROLES.has(String(value))) {@@  if (false) {@@a role this studio does not have is REFUSED — an item authored by nobody answers to nobody@@N4/N6/N7
M67@@scripts/register.mjs@@  if (!ID_SHAPE.test(subject)) die(1,@@  if (false) die(1,@@...and so is an id the board could never match, which makes every --ticket link uncheckable@@N4/N6/N7
M68@@scripts/register.mjs@@  if (errors.length) die(2,@@  if (false) die(2,@@...but a register that EXISTS and will not parse is CANNOT EVALUATE, never 'nothing owed'@@N4/N6/N7
M69@@scripts/report-check.mjs@@if (fragmentTruth?.ok === false) {@@if (false) {@@...naming it a false claim, not a missing field@@presence is not truth
M70@@scripts/spawn-prompt.mjs@@const missing = contract.fields.filter((f) => !text.includes(f));@@const missing = [];@@verify REFUSES the exact prompt shape that produced H5's 0-of-6 result@@spawn-prompt
M71@@hooks/block-shared-tree-destructive-git.sh@@if [ -n "$HEAD" ] && pick_declared "$HEAD" "$DECLARED_ALL"; then@@if false; then@@on the integration branch: BLOCKS the exact H6 shape (git merge --no-ff)
M72@@scripts/wave-integrate.mjs@@if (push.ok) {@@if (false) {@@--push runs merge-reconcile.mjs again right after the wave lands@@B1: --push must land
M73@@scripts/orchestrator.mjs@@const staticOnly = [...tickets.values()].filter((t) => t.verifiedStatic === true).map((t) => t.id);@@const staticOnly = [];@@a ticket still carrying verified_static is counted, every round@@OPS-013: the verified_static
M74@@scripts/messages.mjs@@if (candidate.kind === 'answer' && candidate.ticket !== TICKETLESS) {@@if (false) {@@an answer on an already-shipped ticket says it filed a register item
M75@@scripts/review-pattern-scan.mjs@@.filter(([, tickets]) => tickets.size >= 2)@@.filter(([, tickets]) => tickets.size >= 99)@@two tickets blocking on the same file are correlated@@OPS-014: cross-ticket
M76@@hooks/block-shared-tree-destructive-git.sh@@if [ -n "$REFBLOCK" ]; then@@if false; then@@a push refspec ending :main is blocked, even from a different branch entirely
M77@@scripts/lib/test-evidence.mjs@@/^#\s*(?:tests|pass)\s+([0-9]+)/gim,@@/zzzz-never-matches-([0-9]+)/gim,@@a wave whose suite is Node's own `node --test` TAP summary is recognized as GREEN
M78@@scripts/lib/test-evidence.mjs@@/^#\s*(?:tests|pass)\s+([0-9]+)/gim,@@/zzzz-never-matches-([0-9]+)/gim,@@Node's own `node --test` TAP summary (count after the noun) verifies too
M79@@hooks/block-cross-worktree-write.sh@@if [ -n "$TARGET_WT" ] && [ "$TARGET_WT" != "$MY_WT" ]; then@@if false; then@@writing into a SIBLING worktree is blocked@@cross-worktree-write hook
M80@@scripts/lib/test-evidence.mjs@@/Finished ([0-9]+) tests? on/gi,@@/zzzz-never-matches-([0-9]+)/gi,@@AGP's own connectedAndroidTest completion line is recognized as GREEN
M81@@scripts/lib/test-evidence.mjs@@/Finished ([0-9]+) tests? on/gi,@@/zzzz-never-matches-([0-9]+)/gi,@@AGP's own connectedAndroidTest completion line ('Finished N tests on <device>') verifies too
M82@@hooks/require-review-verdict.sh@@[ "$RECORDED" = 1 ] && exit 0@@exit 0@@still BLOCKED (the v1 exploit, closed)
M83@@scripts/wave-integrate.mjs@@baseFailed: !baseGreen };@@baseFailed: false };@@the unmodified base ref fails too — this failure may pre-date the wave
M84@@hooks/require-review-verdict.sh@@grep '"by":"code-reviewer"' | grep -F '"verdict_path"'@@grep -F '"verdict_path"'@@a real event for the SAME ticket authored by a DIFFERENT role is still BLOCKED
M85@@hooks/block-cross-worktree-write.sh@@[ -L "$ABS_TARGET" ] && [ "$hops" -lt 40 ] || break@@break@@a symlink in your own worktree pointing at a sibling's file is blocked@@cross-worktree-write hook
M86@@hooks/block-shared-tree-destructive-git.sh@@if (c == "\n" || c == ";" ||@@if (c == ";" ||@@a newline separates commands, like ;
M95@@scripts/lib/test-evidence.mjs@@if (most > 0 || uncounted) return { verdict: 'green'@@if (counted || uncounted) return { verdict: 'green'@@verify-done: 'Executed 0 tests' is never green (G-F5)
M96@@scripts/wave-integrate.mjs@@if (flags.push && greenTip.ok && greenTip.out === tip) {@@if (flags.push) {@@--push refuses an existing wave branch whose tip is NOT the commit that ran green (W6)@@W1/G-F5 in the wave
M97@@scripts/wave-integrate.mjs@@const push = hasOrigin ? gitTry(['push', 'origin', BASE], { cwd: ROOT }) : { ok: true, out: '' };@@const push = gitTry(['push', 'origin', BASE], { cwd: ROOT });@@--wave N --push after a green --wave N lands it instead of refusing 'already exists' (W6)@@W1/G-F5 in the wave
M98@@scripts/lib/readiness.mjs@@['status', '--porcelain', '--', ':(top)', ...excludes]@@['status', '--porcelain', '--', ':(top)']@@readiness: a tree dirty ONLY in the studio's operational files is clean (W3)@@W3 / G-F6
M99@@scripts/lib/readiness.mjs@@.map((p) => `:(exclude)${p}`);@@.filter(() => false);@@runtime-gate --record: operational files do not record the tree as dirty (W3)@@W3 / G-F6
M100@@scripts/ship-gate.sh@@-e 's/^/:(exclude)/' "$HERE/lib/operational-paths.txt")@@-e 's/^/:(exclude)/' /dev/null)@@ship-gate: operational files do not make approval binding UNKNOWN (G-F6)@@W3 / G-F6
M129@@hooks/contract-hooks.mjs@@if (verify.status === 1) {@@if (false) {@@C10: the pre-spawn hook BLOCKS an IC prompt that only points at the contract@@Sprint 2 track B
M121@@hooks/contract-hooks.mjs@@if (payload.stop_hook_active === true || existsSync(marker)) allow();@@if (false) allow();@@C10: ...and a SECOND stop by the same subagent is let through (never blocks forever)@@Sprint 2 track B
M122@@hooks/contract-hooks.mjs@@existsSync(join(r, 'docs', '31-board-events.jsonl'))) || null;@@existsSync(join(r, 'docs', '31-board-events.jsonl'))) || dir;@@C10: the report hook is a no-op in an unrelated repo and writes nothing there@@Sprint 2 track B
M123@@hooks/contract-hooks.mjs@@if (check.status !== 1 && !noDone) allow();@@allow();@@C10: an IC stopping with an incomplete DONE report is BLOCKED@@Sprint 2 track B
M124@@hooks/contract-hooks.mjs@@if (c.status === 1) block(@@if (false) block(@@C10: the pre-spawn hook BLOCKS a ticket whose files overlap in-flight work@@Sprint 2 track B
M125@@hooks/contract-hooks.mjs@@if (gate.status === 1) block(@@if (false) block(@@C10: the pre-spawn hook honours .studio-stop (spawn-gate)@@Sprint 2 track B
M126@@scripts/spawn-prompt.mjs@@.filter((p) => res.some((r) => r.test(p.join('\n'))))@@.filter(() => false)@@C7: an IC prompt inlines the impl-spec section that names its ticket@@Sprint 2 track B
M127@@scripts/spawn-prompt.mjs@@.sort().pop()@@.sort().shift()@@C7: the reviewer prompt carries the LATEST persisted DONE report for the ticket@@Sprint 2 track B
M128@@scripts/context-manifest.mjs@@if (moved && flags['strict-head'])@@if (moved)@@C11: a merge moving HEAD alone does not make the context manifest STALE@@Sprint 2 track B
MA01@@skills/defect-hunting/SKILL.md@@`references/round-trip.md`@@`references/round-trip-moved.md`@@every references/ file a SKILL.md or command names exists, and every reference is named@@Sprint 2 track A
M101@@scripts/lib/evidence.mjs@@if (again.verdict !== rec.verdict) return fail(@@if (false) return fail(@@TC: ...because the board re-runs the classifier over the log@@Sprint 2 track C
M102@@scripts/lib/evidence.mjs@@if (sha256(text) !== rec.log_sha256) return@@if (false) return@@TC: ...because the log no longer hashes to the record@@Sprint 2 track C
M103@@scripts/lib/evidence.mjs@@if (tip.sha === head || (!exact && isAncestor(git, tip.sha, head))) return { ok: true, tip: tip.sha };@@if (tip.sha) return { ok: true, tip: tip.sha };@@TC: a record for an older tip of the ticket branch is refused@@Sprint 2 track C
M104@@scripts/lib/evidence.mjs@@if (!declared.includes(rec.command)) {@@if (false) {@@TC: a caller-chosen test command is refused when the profile declares one@@Sprint 2 track C
M105@@scripts/lib/evidence.mjs@@if (code.length) return { ok: false, code: 1,@@if (false) return { ok: false, code: 1,@@TC: a --docs-only record on a branch that changes source is refused@@Sprint 2 track C
M106@@scripts/lib/evidence.mjs@@if (afterTs && !(Date.parse(rec.at) > Date.parse(afterTs)))@@if (false)@@TC: qa_passed on the developer's pre-merge record is refused@@Sprint 2 track C
M107@@scripts/lib/readiness.mjs@@const derived = checkGateLog(root, v);@@const derived = { ok: true };@@TC: readiness: a hand-written PASS gate-result is CANNOT_EVALUATE, not PASS@@Sprint 2 track C
M108@@scripts/lib/evidence.mjs@@if (last !== v.result) return@@if (false) return@@TC: readiness: a result whose own log reached a different verdict is not PASS@@Sprint 2 track C
M109@@scripts/board.mjs@@const r = spent(verifyActorToken({ root, token, role, ticket, required: true }));@@const r = { ok: true, actor: { mode: 'token', required: true } };@@TC: under requireActorTokens a gate event with --by alone is refused@@Sprint 2 track C
M110@@scripts/lib/actor.mjs@@if (rec.role !== role) return@@if (false) return@@TC: a token minted for another role cannot clear the gate@@Sprint 2 track C
M111@@scripts/lib/actor.mjs@@if (rec.ticket !== String(ticket).toUpperCase()) return@@if (false) return@@TC: a token minted for another ticket is refused@@Sprint 2 track C
M112@@scripts/lib/actor.mjs@@if (r.records.some((x) => x.kind === 'revoke' && x.token_id === rec.token_id)) return@@if (false) return@@TC: a revoked token is refused@@Sprint 2 track C
M113@@scripts/lib/events.mjs@@const prior = (state?.events || []).find((e) => e.actor?.token_id === tokenId && e.event !== candidate.event);@@const prior = null;@@TC: the token that verified a ticket may not also approve it@@Sprint 2 track C
M114@@scripts/board.mjs@@if (gate && tokenModeWasRequired(paths.log)) {@@if (false) {@@TC: dropping requireActorTokens after the board used it is refused (the ratchet)@@Sprint 2 track C
M115@@scripts/board.mjs@@const escalated = Boolean(diff && RANK[diff.risk] > plannedRank);@@const escalated = false;@@TC: a ticket planned without risk whose diff touches auth/ cannot merge on medium approvals@@Sprint 2 track C
M116@@scripts/board.mjs@@!(EVIDENCE_CHECKS[k] && EVIDENCE_CHECKS[k](state))@@!(!EVIDENCE_CHECKS[k] || EVIDENCE_CHECKS[k](state))@@TC: a required_evidence kind with no checker fails closed at merged@@Sprint 2 track C
M117@@scripts/board.mjs@@: to !== bound.detail.commit@@: false@@TC: a bound approval whose verdict Scope is not the bound candidate is refused@@Sprint 2 track C
M118@@scripts/lib/actor.mjs@@if (hash !== linkHash(prev, body)) return@@if (false) return@@TC: an edited token registry is CANNOT EVALUATE, never a silent change@@Sprint 2 track C
M119@@scripts/lib/evidence.mjs@@if (!real.startsWith(dir)) return@@if (false) return@@TC: a record outside docs/team/evidence/ is refused@@Sprint 2 track C
M120@@scripts/board.mjs@@? verifyTestEvidence(root, flags.evidence, { ticket })@@? { ok: true, detail: {} }@@TC: verified with no --evidence is refused@@Sprint 2 track C
MD01@@scripts/runtime-gate.sh@@[ "$HAS_WEB" -eq 1 ] && web_gate@@true@@runtime-gate web: a package.json app builds, tests, serves and answers GET / (W11)@@Sprint 2 track D
MD02@@scripts/runtime-gate.sh@@  if [ "$RC" -eq 127 ]; then@@  if false; then@@runtime-gate web: a build command that is not installed is CANNOT EVALUATE@@Sprint 2 track D
MD03@@scripts/runtime-gate.sh@@  if ! node --version >/dev/null 2>&1 || ! npm --version >/dev/null 2>&1; then@@  if false; then@@...naming the missing tool@@Sprint 2 track D
MD04@@scripts/web-smoke.mjs@@if (!r.body.trim()) out(1@@if (false) out(1@@runtime-gate web: a server answering an EMPTY body is FAIL@@Sprint 2 track D
MD05@@scripts/release-candidate.mjs@@  const now = hashArtifact(artifactPath);@@  const now = rc.sha256;@@release-candidate web: one edited file in the build dir breaks the binding@@Sprint 2 track D
MD06@@scripts/lib/artifact-hash.mjs@@return sha(lines.sort().join('\n'));@@return sha(String(lines.length));@@release-candidate web: one edited file in the build dir breaks the binding@@Sprint 2 track D
MD07@@scripts/release-candidate.mjs@@if (isDir && platform !== 'web') die(2@@if (false) die(2@@release-candidate: a directory is refused for ios (that is the .app folder, not the .ipa)@@Sprint 2 track D
MD08@@scripts/scheduler.mjs@@: t.status === 'in_progress' ? 'running'@@: ['in_progress', 'review', 'qa'].includes(t.status) ? 'running'@@scheduler: only in_progress holds a slot — review and qa tickets do not starve the next wave (C9)@@Sprint 2 track D
MD09@@scripts/scheduler.mjs@@export const MAX_PARALLEL = 3;@@export const MAX_PARALLEL = 2;@@scheduler.mjs cap prints the one parallelism cap, the same constant scripts import (C9)@@Sprint 2 track D
MD10@@scripts/ship-gate.sh@@echo "        LIMIT: the scanners only replay KNOWN defect classes; unknown defects are covered by"@@:@@ship-gate and /app-ship state the scanners only replay known defects (G-F13)@@Sprint 2 track D
MS01@@hooks/contract-hooks.mjs@@if (actorCmd) refuse(@@if (false) refuse(@@S2: guard-gate-writes refuses a subagent minting an actor token@@Sprint 2 lead
MS02@@scripts/spawn-prompt.mjs@@if (policy.requireActorTokens !== true) return [];@@return [];@@S2: compose mints the reviewer's token under requireActorTokens; the registry holds only its hash@@Sprint 2 lead
MG01@@scripts/lib/readiness.mjs@@if (v.subject?.dirty !== false) {@@if (v.subject?.dirty === true) {@@F2: readiness: a gate result whose dirty is null (unknown) is STALE (G2-11)@@Sprint 3 track F2
MG02@@scripts/lib/readiness.mjs@@if (verdict === 'PASS' && cand.dirty !== false) verdict = 'STALE';@@if (false) verdict = 'STALE';@@F2: readiness: a candidate with uncommitted source is STALE, never PASS (G2-11)@@Sprint 3 track F2
MG03@@scripts/lib/readiness.mjs@@if (v.gate !== gateName) {@@if (false) {@@F2: readiness: a journey result filed as runtime-result.json is not a runtime verdict (G2-11)@@Sprint 3 track F2
MG04@@scripts/lib/operational-paths.txt@@docs/team/runs.jsonl@@docs/team@@F2: an edited docs/team/risk-policy.json is a real change, not studio bookkeeping (G2-18)@@Sprint 3 track F2
MG05@@scripts/release-candidate.mjs@@if (SHAPE[platform] && !SHAPE[platform].test(artifactPath)) die(1@@if (false) die(1@@F2: release-candidate refuses an ios artifact that is not an .ipa (G2-23)@@Sprint 3 track F2
MG06@@scripts/ship-gate.sh@@if (!e) out.push(@@if (false) out.push(@@F2: ship-gate blocks a merged ticket with no qa_passed EVENT, whatever the markdown says (G2-19)@@Sprint 3 track F2
MG07@@scripts/wave-integrate.mjs@@if (rg.status !== 0) {@@if (false) {@@F2: wave-integrate will not land a high-risk ticket (routed from its diff) until runtime passes on the wave (W2-3)@@Sprint 3 track F2
MG08@@scripts/wave-integrate.mjs@@const tokenFor = (role, id) => inlineTokenFlag(ROOT, role, id);@@const tokenFor = () => '';@@F2: wave-integrate's printed verified command mints its token inline under requireActorTokens (W2-10)@@Sprint 3 track F2
MG09@@scripts/worktree-slot.mjs@@while (state.slots?.[`${owner}-${n}`]) n += 1;@@;@@...as ios-developer-2@@worktree-slot: one tree per WRITER
MG10@@scripts/trace.mjs@@} else if (!boardDoc && INTENT) {@@} else if (false) {@@F2: trace --intent evaluates the intent chain at Gate 1 instead of CANNOT EVALUATE for a missing board (W2-19)@@Sprint 3 track F2
MG11@@scripts/integration-branch.sh@@| head -n 1 | sed -E 's/[./]+$//'@@| head -n 1@@F2: integration-branch reads 'Integration branch: main.' as main (W2-22)@@Sprint 3 track F2
MG12@@scripts/drivers/web.sh@@if (!(await text()).includes(String(s.value))) failStep(@@if (false) failStep(@@F2: web driver FAILs the step whose assertion did not hold (G2-21)@@Sprint 3 track F2
MG13@@scripts/orchestrator.mjs@@for (const l of why) lines.push(@@for (const l of []) lines.push(@@F2: orchestrator ship relays the sub-gate's own reason lines, not just its name (W2-20)@@Sprint 3 track F2
MG14@@scripts/project-profile.mjs@@if (/\bweb\b/.test(String(p.platform || ''))) {@@if (false) {@@F2: project-profile check: a web project with no build script is CANNOT EVALUATE (W2-13)@@Sprint 3 track F2
MG15@@scripts/wave-integrate.mjs@@if (/untracked working tree files would be overwritten/i.test(l))@@if (false)@@F2: wave-integrate names untracked-file collisions instead of 'something landed' (W2-9)@@Sprint 3 track F2
MG16@@scripts/dispatch-preflight.mjs@@'role', 'operation', 'ticket'];@@'role', 'operation', 'path', 'file', 'ticket'];@@F2: dispatch-preflight needs no --path/--file for a ticket that declares no files, and says it checked none (C2-28)@@Sprint 3 track F2
MG17@@scripts/orchestrator.mjs@@if (unrouted.length) {@@if (false) {@@F2: orchestrator round names tickets created before risk-policy.json existed (W2-14)@@Sprint 3 track F2
MG18@@scripts/ship-gate.sh@@grep -q '"requireActorTokens"[[:space:]]*:[[:space:]]*true' "$ROOT/.studio-policy.json" 2>/dev/null || return 0@@return 0@@F2: ship-gate's printed qa_passed command carries the agent's prompt token, never a mint, under requireActorTokens (W2-10, C3W-8)@@Sprint 3 track F2
MG19@@scripts/drivers/web.sh@@catch { cannot('Playwright is not installed in this project@@catch { out('PASS', 'Playwright is not installed in this project@@F2: web driver without Playwright is CANNOT EVALUATE with the exact install line (G2-21)@@Sprint 3 track F2
MG20@@scripts/worktree-slot.mjs@@if (tickets.length > 1) die(1@@if (false) die(1@@a batch of tickets in one lease is REFUSED — one spawn per ticket@@worktree-slot: one tree per WRITER
ME01@@scripts/spawn-prompt.mjs@@tokensFor(ROOT, 'qa-engineer', wave.map((r) => r.id))@@tokensFor(ROOT, 'qa-engineer', [])@@S3E: the QA prompt carries one qa-engineer token per wave ticket (Token for APP-NNN:)@@Sprint 3 track E
ME02@@hooks/contract-hooks.mjs@@|| !ticket || gateHeaderOf(role, report)) allow();@@|| !ticket) allow();@@S3E: a DESIGN QA verdict on stop is persisted and NOT blocked as a missing DONE (R2-8)@@Sprint 3 track E
ME03@@hooks/contract-hooks.mjs@@for (let n = parts.length; n >= 2; n--)@@for (let n = 2; n >= 2; n--)@@S3E: a hand-written QA-1-w1 prompt is policed as QA-1-w1, not read as QA-1 (W2-16)@@Sprint 3 track E
ME04@@hooks/contract-hooks.mjs@@if (name === 'cd' || name === 'pushd') {@@if (false) {@@S3E: guard refuses cd into the evidence dir then write (G2-1)@@Sprint 3 track E
ME05@@hooks/contract-hooks.mjs@@if (name === 'claude' || name === 'claude-code' || texts.some((t) => /@anthropic-ai\/claude-code\b/.test(t))) {@@if (false) {@@S3E: guard refuses a nested claude session from a subagent (G2-16)@@Sprint 3 track E
ME06@@hooks/require-review-verdict.sh@@[ -n "$MENTIONS" ] || MENTIONS=$(grep -oE "$ID_ERE" "$TRANSCRIPT" 2>/dev/null | sort -u)@@MENTIONS=$(grep -oE "$ID_ERE" "$TRANSCRIPT" 2>/dev/null | sort -u)@@S3E: a reviewer of APP-002 is not let off by APP-001's verdict named elsewhere in its transcript (C2-25)@@Sprint 3 track E
ME07@@scripts/spawn-prompt.mjs@@ && readFileSync(join(dir, f), 'utf8').trimStart().startsWith('DONE:')).sort().pop();@@ && true).sort().pop();@@S3E: the reviewer gets the DONE report for exactly this ID, never APP-001-analytics's or a DESIGN QA verdict (W2-4, C2-3)@@Sprint 3 track E
ME08@@scripts/spawn-prompt.mjs@@const gate = /^Work ticket /.test(first) ? '' : (GATE_HEADERS[role] || []).find((h) => text.includes(h));@@const gate = '';@@S3E: a data-analyst ANALYTICS gate prompt is a gate spawn, not an un-contracted IC spawn@@Sprint 3 track E
ME09@@hooks/contract-hooks.mjs@@const real = /[*?[]/.test(abs) ? abs : realish(abs);@@const real = abs;@@S3E: guard resolves a symlink into the evidence dir before comparing (G2-27)@@Sprint 3 track E
ME10@@hooks/contract-hooks.mjs@@|| lastAssistantText(payload.agent_transcript_path) ||@@||@@S3E: with no last_assistant_message the transcript's last assistant text is persisted and checked (C2-26)@@Sprint 3 track E
ME11@@hooks/in-studio.sh@@[ "$_studio" = 1 ] || [ -z "$_cwd" ] || exit 0@@true@@S3E: outside a studio project the hook wrapper exits before starting node (C2-27)@@Sprint 3 track E
ME12@@hooks/require-review-verdict.sh@@[ -e "$_m" ] && exit 0@@true@@S3E: the review hook blocks ONCE per agent_id, and lets stop_hook_active through@@Sprint 3 track E
ME13@@scripts/spawn-prompt.mjs@@...fence(`git -C "${slot}" checkout -b ${branchName} ${base}`)]@@...fence('')]@@S3E: the IC prompt prints the base and the exact git checkout -b line (C2-5)@@Sprint 3 track E
ME14@@scripts/lib/contract.mjs@@export const ARTIFACT_CONTRACT = ['Worktree:', 'Branch:',@@export const ARTIFACT_CONTRACT = ['Worktree:',@@S3E: report-check refuses an artifact DONE with no Branch: (C2-8)@@Sprint 3 track E
MF01@@scripts/lib/integration.mjs@@return o.length > want.length && o.startsWith(`${want}-`) && bare(n, o);@@return false;@@F1: ...with all three branches present, each ticket's tip is its own branch (no ambiguity, no theft)@@Sprint 3 track F1
MF02@@scripts/lib/integration.mjs@@const bare = (name, id) => new RegExp(`(^|/)${esc(id)}${SLUG}$`).test(name);@@const bare = (name, id) => name.includes(id);@@F1: matchesTicket is whole-id and gives a branch to the LONGEST board id (APP-001 / APP-001-analytics / APP-0010)@@Sprint 3 track F1
MF03@@scripts/lib/evidence.mjs@@if (forged in f) bye(2,@@if (false) bye(2,@@F1: evidence.mjs test refuses --exit/--log — the writer observes the outcome itself (G2-2)@@Sprint 3 track F1
MF04@@scripts/lib/evidence.mjs@@if (!declared.length) {@@if (false) {@@F1: a profile that declares no test command cannot verify a code ticket (G2-3)@@Sprint 3 track F1
MF05@@scripts/lib/evidence.mjs@@const exact = rec.produced_by === 'verify-done.sh' && !afterTs;@@const exact = false;@@F1: verified evidence from a DESCENDANT of the ticket tip is refused (G2-4)@@Sprint 3 track F1
MF06@@scripts/lib/evidence.mjs@@if (rec.assertion_census?.assert_nothing) {@@if (false) {@@F1: ...and the board refuses verified on that record@@Sprint 3 track F1
MF07@@scripts/lib/evidence.mjs@@const isDoc = docFile(docsIsServedSite(git, head), { qa });@@const isDoc = docFile(false, { qa });@@F1: a --docs-only record over a served docs/ site (docs/index.html) is refused (G2-25)@@Sprint 3 track F1
MF08@@scripts/lib/verdict.mjs@@if (event === 'approved' && NOTHING_REVIEWED.test(body)) {@@if (false) {@@F1: an APPROVE whose ## Not checked says Everything is refused (G2-26)@@Sprint 3 track F1
MF09@@scripts/lib/verdict.mjs@@const scope = sides.length === 2 && sides[0] && sides[1] ? [scopeLine[0], sides[0], sides[1]] : null;@@const scope = scopeLine ? [scopeLine[0], sides[0], sides.slice(1).join('..')] : null;@@F1: a three-sided Scope is refused by the verdict contract itself, with or without --bind (G2-5)@@Sprint 3 track F1
MF10@@scripts/board.mjs@@if (!manifest || manifest.schema !== 'context-manifest/v2' || !Array.isArray(manifest.sources)) {@@if (false) {@@F1: --bind --context must be a context-manifest/v2 (G2-6)@@Sprint 3 track F1
MF11@@scripts/board.mjs@@if (!ev.ok) return { ok: false, code: ev.code, reason: `--evidence: ${ev.reason}` };@@if (false) return {};@@F1: ...the evidence is re-derived, not hashed by name@@Sprint 3 track F1
MF12@@scripts/board.mjs@@if (subj.error) return { refusal: `${subj.error}\n  risk-policy.json is in force@@if (false) return { refusal: `${subj.error}\n  risk-policy.json is in force@@F1: ...naming why the diff is unknown@@Sprint 3 track F1
MF15@@scripts/lib/approval.mjs@@if (tip.sha && tip.sha !== detail.commit) {@@if (false) {@@F1: approval-check (ship mode) refuses a branch that moved past its approval (G2-9)@@Sprint 3 track F1
MF16@@scripts/lib/events.mjs@@if (a.chained === chain.chained && a.tip === chain.tip) return { ok: true };@@return { ok: true };@@F1: a log rewritten with every hash RECOMPUTED is refused — the anchor outside the tree disagrees (G2-10)@@Sprint 3 track F1
MF17@@scripts/board.mjs@@const lowered = gate ? ratchetedOff(paths.log, policy) : [];@@const lowered = [];@@F1: deleting requireActorTokens before any gate event was written is still refused (G2-12)@@Sprint 3 track F1
MF18@@scripts/lib/events.mjs@@if ((name === 'merged' || name === 'closed') && wroteOn(state, by, ['approved'])) {@@if (false) {@@F1: the role that approved a ticket may not merge it (G2-13)@@Sprint 3 track F1
MF19@@scripts/lib/events.mjs@@if (name === 'approved' && wroteOn(state, by, ['verified', 'verified_static'])) {@@if (false) {@@F1: the role that verified a ticket may not approve it (G2-13)@@Sprint 3 track F1
MF20@@scripts/lib/actor.mjs@@if (!stdin.isTTY) {@@if (false) {@@F1: actor mint --role founder is refused without a TTY (G2-14)@@Sprint 3 track F1
MF21@@scripts/lib/actor.mjs@@session: pick('STUDIO_SESSION_ID') || pick('CLAUDE_CODE_SESSION_ID'),@@session: pick('STUDIO_SESSION_ID'),@@F1: a mint records the Claude Code session it ran in (G2-17)@@Sprint 3 track F1
MF22@@scripts/verify-done.sh@@if [ "$TESTS_STATUS" = green ] && [ "$(_ef census.assert_nothing)" = true ]; then@@if false; then@@F1: verify-done downgrades a green run whose changed tests assert nothing to CANNOT EVALUATE (G2-22)@@Sprint 3 track F1
MF23@@scripts/lib/events.mjs@@...(isQaDocs(state) ? ['merged'] : [])@@...[]@@F1: a docs-only QA- ticket merges straight from verified, reviewed inline (decision 1)@@Sprint 3 track F1
MF24@@scripts/board.mjs@@if (state && isQaDocs(state)) {@@if (false) {@@F1: ...and closes from merged without being on the integration branch (W2-6)@@Sprint 3 track F1
MF25@@scripts/board.mjs@@const integration = integrationBase(gitAt(process.cwd()));@@const integration = 'main';@@F1: ...and the recorded base is develop's tip, not main's@@Sprint 3 track F1
MF26@@scripts/verify-done.sh@@TOKFLAG=$(node "$EV" token-flag@@TOKFLAG=$(true "$EV" token-flag@@F1: verify-done prints the board command with the inline-mint --token under requireActorTokens (W2-10)@@Sprint 3 track F1
MM01@@commands/app-init.md@@docs/53-reviews/ docs/54-evidence/@@docs/53-review/ docs/54-evidence/@@K3: every path /app-init gitignores is an operational path (C3W-12)@@Sprint 4 track K3
MM02@@commands/app-ship.md@@waiver is the exception: android, ios and web drivers all ship.@@Drivers do not ship yet.@@K3: app-build and app-ship name the web driver and its setup (C3W-3)@@Sprint 4 track K3
MM03@@commands/app-build.md@@on every tier, except a wave made only of@@skip it on the utility tier and a wave made only of@@K3: the utility lane runs one QA- ticket per wave, like flagship (C3W-2)@@Sprint 4 track K3
ML01@@hooks/contract-hooks.mjs@@if (script === 'spawn-prompt.mjs' && after.some((w) => w.v.text === 'compose'))@@if (false)@@spawn-prompt.mjs" compose --ticket APP-001 --role qa-engineer@@Sprint 4 track K2
ML02@@hooks/contract-hooks.mjs@@if (dynamicMjs || dynamicScript) {@@if (false) {@@K2: guard exit 2 for Bash: node scripts/b?ard.mjs@@Sprint 4 track K2
ML03@@hooks/contract-hooks.mjs@@if (hitsH(w.v.pat, G[key], tree)) {@@if (false) {@@K2: guard exit 2 for Bash: cp x docs/team/risk-policy.json@@Sprint 4 track K2
ML04@@hooks/contract-hooks.mjs@@if (a.v.text === '-t' || a.v.text === '--target-directory')@@if (false)@@K2: guard exit 2 for Bash: cp -t docs/team/evidence x.json@@Sprint 4 track K2
ML05@@hooks/contract-hooks.mjs@@if (name === 'dd')@@if (false)@@K2: guard exit 2 for Bash: dd if=x.json@@Sprint 4 track K2
ML06@@hooks/contract-hooks.mjs@@if (s === '' || s === '.') continue;@@if (s === '') continue;@@K2: guard exit 2 for Bash: echo {} > docs/team/./evidence@@Sprint 4 track K2
ML07@@hooks/contract-hooks.mjs@@if (name === 'cd' || name === 'pushd') {@@if (false) {@@K2: guard exit 2 for Bash: cd docs/team && cp x.json evidence/@@Sprint 4 track K2
ML08@@hooks/contract-hooks.mjs@@pat += s.replace(/\[[^\]/]*\]/g, ONE).replace(/\*/g, STAR).replace(/\?/g, ONE);@@pat += s.replace(/\*/g, STAR);@@K2: guard exit 2 for Bash: cp x.json docs/team/evidenc?/@@Sprint 4 track K2
ML09@@hooks/contract-hooks.mjs@@    if (c === '"') {@@    if (false) {@@K2: guard exit 0 for Bash: node scripts/board.mjs move APP-001 blocked --by ios-developer --detail "the actor field is wrong"@@Sprint 4 track K2
ML10@@hooks/contract-hooks.mjs@@if (c === '\n' && heredocs.length) {@@if (false) {@@K2: guard exit 0 for Bash: git commit -F - <<EOF@@Sprint 4 track K2
ML11@@hooks/contract-hooks.mjs@@\b(actor|evidence|events)\.mjs\b/g@@\b(actor|evidence)\.mjs\b/g@@import('./scripts/lib/events.mjs')@@Sprint 4 track K2
ML12@@hooks/contract-hooks.mjs@@if (searchFrom) {@@if (false) {@@K2: guard exit 2 for Glob: @@Sprint 4 track K2
ML13@@hooks/contract-hooks.mjs@@Do not spawn ${role} yourself: stop and return BLOCKED@@run node spawn-prompt.mjs compose --root x@@K2: a subagent's refused spawn is told the orchestrator composes@@Sprint 4 track K2
ML14@@hooks/contract-hooks.mjs@@if (hits(target, [], G[key]))@@if (false)@@K2: guard exit 2 for Write: @@Sprint 4 track K2
ML15@@hooks/contract-hooks.mjs@@const { hit, writes } = inlineWrite(body);@@const { hit, writes } = { hit: '', writes: false };@@writeFileSync('docs/team/capabilities.json'@@Sprint 4 track K2
ML16@@hooks/contract-hooks.mjs@@if (body) queue.push(...shellCommands(body.v.pat));@@if (false) queue.push(...shellCommands(body.v.pat));@@K2: guard exit 2 for Bash: bash -c "cp x docs/team/evidence/"@@Sprint 4 track K2
ML17@@hooks/contract-hooks.mjs@@if (/^(perl|ruby)$/.test(name) && flagged(@@if (false && flagged(@@K2: guard exit 2 for Bash: perl -pi -e@@Sprint 4 track K2
ML18@@scripts/spawn-prompt.mjs@@const branchName = qa ? `qa/${row.id}`@@const branchName = qa ? `feat/${row.id}-<short-slug>`@@K2: QA composes on branch qa/@@Sprint 4 track K2
ML19@@scripts/spawn-prompt.mjs@@if (role === 'qa-engineer' && !qa && row.owner !== 'qa-engineer') {@@if (false) {@@K2: qa-engineer composed on an app ticket@@Sprint 4 track K2
ML20@@scripts/worktree-slot.mjs@@'release-auditor', 'red-team-agent'].includes(owner)) {@@'release-auditor', 'red-team-agent'].includes('')) {@@K2: worktree-slot refuses a gate role a slot@@Sprint 4 track K2
ML21@@scripts/orchestrator.mjs@@actor mint --role tech-manager --ticket ${state.id}@@actor mint --role <role> --ticket ${state.id}@@K2: orchestrator explain mints for the orchestrator's own role only@@Sprint 4 track K2
ML22@@scripts/orchestrator.mjs@@const why = reason ? ` [${reason.slice(0, 600)}]` : '';@@const why = '';@@K2: orchestrator round carries the failing step's own reason@@Sprint 4 track K2
ML23@@scripts/project-profile.mjs@@missingBuild = why || 'package.json has no "build" script';@@missingBuild = 'package.json has no "build" script';@@K2: project-profile names the missing package.json@@Sprint 4 track K2
ML24@@scripts/ship-gate.sh@@if [ "$1" = tech-manager ]; then@@if true; then@@F2: ship-gate's printed qa_passed command carries the agent's prompt token@@Sprint 3 track F2
ML25@@scripts/drivers/web.sh@@drives a RUNNING app. Start it ${SERVE}@@drives a RUNNING app.@@K2: the web driver with no URL says how to start the app@@Sprint 4 track K2
MK01@@scripts/board.mjs@@if (sameCommands(frozen.commands, cur.commands)) return '';@@return '';@@K1: a gate event under a profile whose test commands changed is refused (C3G-3)@@Sprint 4 track K1
MK02@@scripts/board.mjs@@if (event.by !== 'tech-manager') return 'only the orchestrator@@if (false) return 'only the orchestrator@@K1: only tech-manager re-freezes the test commands@@Sprint 4 track K1
MK03@@scripts/verify-done.sh@@_cc=$(node "$EV" check-command --record "$EVIDENCE" 2>&1)@@_cc=$(true)@@K1: a green of an undeclared command prints CANNOT EVALUATE, not VERIFIED (FB3)@@Sprint 4 track K1
MK04@@scripts/lib/evidence.mjs@@const mb = base || git(['merge-base', integration, head]);@@const mb = base || git(['rev-parse', `${head}~1`]);@@K1: a --docs-only record whose own base hides a code commit is refused — the diff is from merge-base(integration, tip) (C3G-4)@@Sprint 4 track K1
MK05@@scripts/board.mjs@@if (!d.ok) return `${ticket} is on the QA- docs-only fast path@@if (false) return `${ticket} is on the QA- docs-only fast path@@K1: ...but a code commit added after verified ends the fast path at merged (C3G-5)@@Sprint 4 track K1
MK06@@scripts/journey-gate.mjs@@if (dirname(real) !== realpathSync(DRIVERS_DIR) || !statSync(real).isFile()) {@@if (false) {@@K1: journey-gate refuses a driver that is not one of the plugin's scripts/drivers/* (C3G-6)@@Sprint 4 track K1
MK07@@scripts/lib/evidence.mjs@@if (drv) return fail(drv);@@if (false) return fail(drv);@@K1: qa_passed refuses a journey result that names no plugin driver (design F)@@Sprint 4 track K1
MK08@@scripts/lib/evidence.mjs@@run = spawnSync('sh', ['-c', cmd], { cwd: at,@@run = spawnSync('sh', ['-c', cmd], { cwd,@@K1: a skip-worktree'd edit in the developer's tree does not change the result — the committed suite fails (C3G-7)@@Sprint 4 track K1
MK09@@scripts/lib/readiness.mjs@@.split('\n').some((l) => /^(S|[a-z]) /.test(l));@@.split('\n').some(() => false);@@K1: ...and a skip-worktree entry makes the tree dirty for the gates (ls-files -v)@@Sprint 4 track K1
MK10@@scripts/board.mjs@@return landed.length ? `${tip.branch} gained@@return false ? `${tip.branch} gained@@K1: closed refuses when the ticket's branch gained commits after merged that are on the integration branch (C3G-8)@@Sprint 4 track K1
MK11@@scripts/board.mjs@@{ merged_head: subj.sha, ...(qaBase@@{ ...(qaBase@@K1: merged records the commit it is about (C3G-8)@@Sprint 4 track K1
MK12@@scripts/lib/evidence.mjs@@if (!recordedBranch || !matchesTicket(@@if (false && !matchesTicket(@@K1: a ticket with no branch named for it cannot cite another branch's green (C3G-9)@@Sprint 4 track K1
MK13@@scripts/lib/evidence.mjs@@.replace(/^refs\/(heads|remotes\/[^/]+)\//, ''), id, ids))[0];@@.replace(/^refs\/(heads|remotes\/[^/]+)\//, ''), id, []))[0];@@K1: verify-done's ticket is the LONGEST board id the branch is named for (C3G-9 / FB5)@@Sprint 4 track K1
MK14@@scripts/lib/evidence.mjs@@if (tip.ambiguous.length) return { ok: false, code: 1, reason:@@if (tip.ambiguous.length) return { ok: false, code: 2, reason:@@K1: evidence for a ticket with two branches named for it is refused with exit 1 (C3W-9)@@Sprint 4 track K1
MK15@@scripts/lib/evidence.mjs@@if (staticOnly && rec.mode !== 'static') return fail(@@if (false) return fail(@@K1: verified_static refuses a tests record — it cites the --static one@@Sprint 4 track K1
MK16@@scripts/lib/events.mjs@@if (Array.isArray(fields.invariants)) state.meta.invariants@@if (false) state.meta.invariants@@K1: ...after corrected --invariant it can (C3W-7)@@Sprint 4 track K1
MK17@@scripts/board.mjs@@(role === 'tech-manager'@@(true@@K1: ...and the refusal tells the agent to return BLOCKED, never how to mint (C3W-8)@@Sprint 4 track K1
MK18@@scripts/board.mjs@@if (!bound.detail.files.some((f) => vtext.includes(f))) {@@if (false) {@@K1: an APPROVE that names none of the bound diff's files is refused (C3G-13)@@Sprint 4 track K1
MK19@@scripts/board.mjs@@if (existsSync(out) || out === paths.log) {@@if (false) {@@K1: migrate --out onto an existing file is refused (C3G-14)@@Sprint 4 track K1
MK20@@scripts/lib/evidence.mjs@@if (rel !== posix.normalize(rel) || rel.startsWith('./') || !rel.startsWith(`${EVIDENCE_DIR}/`)) return@@if (false) return@@K1: a record whose log is spelled docs//team/… is refused (C3G-17)@@Sprint 4 track K1
MK21@@scripts/lib/actor.mjs@@if (e.code !== 'EAGAIN' || waited >= maxWaitMs) throw e;@@throw e;@@K1: the founder confirmation retries EAGAIN instead of failing (C3G-10)@@Sprint 4 track K1
MK22@@scripts/lib/events.mjs@@state.staticUnrun = 'the executable test suite';@@state.staticUnrun = String(detail?.note || detail || '').trim() || 'the executable test suite';@@K1: the STATIC ONLY banner never echoes free-text --detail (C3W-13)@@Sprint 4 track K1
MP01@@scripts/lib/evidence.mjs@@if (lf.startsWith('docs/team/')) return qa && QA_JOURNEY.test(f);@@if (false) return false;@@P1: a QA- --docs-only record whose branch changes docs/team/risk-policy.json is refused (C4G-G1)@@Sprint 5 track P1
MP02@@scripts/lib/evidence.mjs@@if (MANIFEST.test(f) || /\.mdx$/i.test(f)) return false;@@if (false) return false;@@P1: a QA- --docs-only record whose branch changes CMakeLists.txt is refused (C4G-G1)@@Sprint 5 track P1
MP03@@scripts/lib/evidence.mjs@@return !qa && PROSE_ANYWHERE.test(f);@@return PROSE_ANYWHERE.test(f);@@P1: a QA- --docs-only record whose branch changes README.md is refused (C4G-G1)@@Sprint 5 track P1
MP04@@scripts/board.mjs@@base: name === 'closed' ? recordedMergeBase(events, ticket) : ''@@base: ''@@P1: a QA- ticket fast-forwarded into main BEFORE closed still closes (C4G-G2)@@Sprint 5 track P1
MP05@@scripts/board.mjs@@const qaBase = isQaDocs(tickets.get(key(ticket))) ? docsOnlyDiff(g, subj.sha, { qa: true }).base : '';@@const qaBase = '';@@P1: merged records the merge-base its docs-only proof was taken against (C4G-G2)@@Sprint 5 track P1
MP06@@scripts/board.mjs@@if (name === 'closed' && isQaDocs(state)) printQaLanding(ticket, events);@@if (false) printQaLanding(ticket, events);@@P1: ...and closed prints the exact ff-only command that lands its files (C4W-2)@@Sprint 5 track P1
MP07@@scripts/lib/events.mjs@@if (isQaTicket(state)) return withCorrection(['closed'@@if (isQaTicket(state)) return ((x) => x)(['closed'@@P1: corrected is legal while a ticket sits in qa (C4G-G3)@@Sprint 5 track P1
MP08@@scripts/lib/evidence.mjs@@if (text !== null) return { commands: testsOf(text)@@if (false) return { commands: testsOf(text)@@P1: the board freezes main's committed profile, not an uncommitted working-tree edit (C4G-G4)@@Sprint 5 track P1
MP09@@scripts/lib/approval.mjs@@if (mb && base !== mb && !isAncestor(git, base, mb)) {@@if (false) {@@P1: merged refuses an approval bound to tip~1..tip@@Sprint 5 track P1
MP10@@scripts/project-profile.mjs@@blocked += coldDeps.length;@@blocked += 0;@@P1: project-profile check BLOCKS a bare 'npm test'@@Sprint 5 track P1
MP11@@scripts/board-doctor.mjs@@ && !capabilities.qaDocs?.has(String(normalizeId(row.id)).toUpperCase())) {@@) {@@P1: board-doctor exempts a docs-only QA- ticket that closed through the gate from done_without_review (C4W-1)@@Sprint 5 track P1
MP12@@scripts/scheduler.mjs@@(task?.status === 'complete' || task?.merged === true)@@(task?.status === 'complete')@@P1: qa_failed -> BUG-001-fix is in the scheduler's ready set@@Sprint 5 track P1
MP13@@scripts/scheduler.mjs@@const ids = new Set(plan.tasks.map((task) => up(task.id)));@@const ids = new Set(plan.tasks.map((task) => task.id));@@P1: qa_failed -> BUG-001-fix is in the scheduler's ready set@@Sprint 5 track P1
MP14@@scripts/orchestrator.mjs@@const mine = new Set([key(t.id), ...(t.dependsOn || []).map(key)]);@@const mine = new Set([key(t.id)]);@@P1: the stall detector measures a dependent from its dependency's last move@@Sprint 5 track P1
MP15@@scripts/lib/args.mjs@@? `${prev}${listFlags[name]}${value}` : value;@@? value : value;@@P1: --file / --invariant repeated accumulate@@Sprint 5 track P1
MP16@@scripts/verify-done.sh@@  [Qq][Aa]-*)@@  [Qq][Aa]-NEVER)@@P1: verify-done prints the QA inline-merge line for a docs-only QA- ticket@@Sprint 5 track P1
MP17@@scripts/board.mjs@@(r.record.role === 'tech-manager'@@(false@@P1: a tech-manager self-mint says to use it inline@@Sprint 5 track P1
MP18@@scripts/orchestrator.mjs@@const part = (code, label) => (byState[code].length ? `${label}: ${byState[code].join(', ')}` : '');@@const part = () => '';@@P1: orchestrator ship's RESULT names the BLOCKED and CANNOT EVALUATE steps (C4W-13)@@Sprint 5 track P1
MP19@@scripts/spawn-prompt.mjs@@: role === 'qa-engineer' && /^QA-/i.test(String(ticket)) ? BUDGET.qa@@: false ? BUDGET.qa@@P1: a qa-engineer prompt on a QA- ticket is measured against the QA budget@@Sprint 5 track P1
MR01@@scripts/lib/readiness.mjs@@const waived = state === 'CANNOT_EVALUATE' ? waiverFor(root, name) : null;@@const waived = null;@@Q1: readiness — a valid versioned journey waiver is WAIVED, not blocking (C5W-1)@@Sprint 6 track Q1
MR02@@scripts/lib/waiver.sh@@if (ver != canon) next@@if (0) next@@Q1: an unversioned / stale-version / unsigned journey waiver still blocks: 'WAIVED: journey gate — founder (Q) — no browser on this machine — v0.0.9' (C5W-1)@@Sprint 6 track Q1
MR03@@scripts/orchestrator.mjs@@filter((x) => /WAIVED/.test(x) &&@@filter((x) => false &&@@Q1: orchestrator ship — readiness CLEAR on a waived journey gate@@Sprint 6 track Q1
MR04@@scripts/lib/evidence.mjs@@const afterFail = failedTs && Date.parse(failedTs) > Date.parse(mergedTs || 0);@@const afterFail = false;@@Q1: qa_passed citing the record QA already failed is refused after qa_failed (C5W-2)@@Sprint 6 track Q1
MR05@@scripts/spawn-prompt.mjs@@const ev = qaEvidence(ROOT, r.id);@@const ev = latestEvidence(ROOT, r.id);@@Q1: ...and compose no longer offers the failed build's record (C5W-2)@@Sprint 6 track Q1
MR06@@scripts/dispatch-preflight.mjs@@listFlags: { file: ',', path: ',' } });@@listFlags: {} });@@Q1: dispatch-preflight routes every repeated --file, in either order (C5W-3)@@Sprint 6 track Q1
MR07@@scripts/lib/operational-paths.txt@@docs/32-board-view.md@@docs/32-board-view.mdx@@Q1: board view, register and rendered channel are operational — not DIRTY (C5W-4)@@Sprint 6 track Q1
MR08@@scripts/spawn-gate.sh@@if [ -n "$missing" ] && { [ -e "$DIR/$1" ] ||@@if false && { [ -e "$DIR/$1" ] ||@@Q1: spawn-gate refuses a leased slot whose worktree does not exist (C5W-6)@@Sprint 6 track Q1
MR09@@scripts/register.mjs@@if (!b.closed || !OPEN_STATUSES.has(existing.status)) continue;@@continue;@@Q1: import-bugs moves an OPEN register item to FIXED when its row's Resolution says so (C5W-8)@@Sprint 6 track Q1
MR10@@scripts/approval-check.mjs@@if (!counted.length && flags.ticket) {@@if (false) {@@Q1: approval-check --ticket with zero approvals exits 1, never 'CLEAR' (C5W-10)@@Sprint 6 track Q1
MR11@@scripts/orchestrator.mjs@@.filter(Boolean).join(' ') || detail || '';@@.find(Boolean) || detail || '';@@Q1: the round's ci row shows the unresolved-branch reason through to its remedy (C5W-11)@@Sprint 6 track Q1
MR12@@scripts/spawn-prompt.mjs@@const SKILL_DEPS = { 'ic-workflow': ['agent-isolation', 'context-preflight'] };@@const SKILL_DEPS = { 'ic-workflow': ['agent-isolation', 'context-preflight', 'defect-hunting', 'mutation-testing'] };@@Q1: developer and verification-engineer composes are within their word budgets (C5W-12)@@Sprint 6 track Q1
MR13@@commands/app-ship.md@@--project-root . --write`.@@--project-root .`.@@Q1: app-ship 1a re-records the waiver's founder decision, and the record reads INTACT (C5W-7)@@Sprint 6 track Q1
MQ01@@hooks/contract-hooks.mjs@@else if (fed !== undefined) queue.push(...shellCommands(fed));@@else if (false) queue.push(...shellCommands(fed));@@MQ: guard exit 2 — heredoc into sh minting@@Sprint 5 track P2
MQ02@@hooks/contract-hooks.mjs@@else if (fed === null) refuse(@@else if (false) refuse(@@MQ: guard exit 2 — unknown text piped into sh@@Sprint 5 track P2
MQ03@@hooks/contract-hooks.mjs@@for (const w of raw) for@@for (const w of []) for@@MQ: guard exit 2 — command substitution minting@@Sprint 5 track P2
MQ04@@hooks/contract-hooks.mjs@@if (raw.stdinExpands) for@@if (false) for@@MQ: guard exit 2 — unquoted heredoc substitution runs@@Sprint 5 track P2
MQ05@@hooks/contract-hooks.mjs@@srcs.forEach((s) => path(under(dest,@@srcs.forEach((s) => (under(dest,@@MQ: guard exit 2 — cp a .studio-policy.json into the root@@Sprint 5 track P2
MQ06@@hooks/contract-hooks.mjs@@if (into && heres().some((h) => isDir(w.v.pat, h, G.teamDir[0]))) {@@if (false) {@@MQ: guard exit 2 — cp into docs/team/@@Sprint 5 track P2
MQ07@@hooks/contract-hooks.mjs@@(tree ? segsRel : segsHit)(q, toSegs(g))@@segsHit(q, toSegs(g))@@MQ: guard exit 2 — rm -rf docs/team@@Sprint 5 track P2
MQ08@@hooks/contract-hooks.mjs@@if (['rm', 'mv', 'restore', 'checkout', 'switch'].includes(sub))@@if (false)@@MQ: guard exit 2 — git restore the profile@@Sprint 5 track P2
MQ09@@hooks/contract-hooks.mjs@@if (!out1 && !pl[0]) {@@if (false) {@@MQ: guard exit 2 — patch from a file on stdin@@Sprint 5 track P2
MQ10@@hooks/contract-hooks.mjs@@texts.forEach((t) => patchPaths(t).map(at).forEach(path))@@texts.forEach(() => {})@@MQ: guard exit 2 — git apply a patch touching risk-policy@@Sprint 5 track P2
MQ11@@hooks/contract-hooks.mjs@@if (pure(cmdWords[0])) refuse(@@if (false) refuse(@@MQ: guard exit 2 — a bare "$@" verb@@Sprint 5 track P2
MQ12@@hooks/contract-hooks.mjs@@positionals.some((w) => WILD.test(w.v.pat))@@false@@MQ: guard exit 2 — board.mjs with a computed subcommand@@Sprint 5 track P2
MQ13@@hooks/contract-hooks.mjs@@part('sub', ''); return j + 1; } // C4G-L1@@part('q', ''); return j + 1; } // C4G-L1@@MQ: guard exit 2 — ANSI-C quoted subcommand@@Sprint 5 track P2
MQ14@@hooks/contract-hooks.mjs@@if ([...roots, DOT].some((w) => hitsH(w.v.pat, G.transcripts, true)))@@if (false)@@MQ: guard exit 2 — grep -r from home@@Sprint 5 track P2
MQ15@@hooks/contract-hooks.mjs@@const DARWIN = process.platform === 'darwin';@@const DARWIN = false;@@MQ: guard exit 2 — docs/Team case variant (macOS)@@Sprint 5 track P2
MQ16@@hooks/contract-hooks.mjs@@const ps = p.some((s) => WILD.test(s)) ? [p] : [p, toSegs(realish(`/${p.join('/')}`))];@@const ps = [p];@@MQ: guard exit 2 — an absolute path through a symlinked dir@@Sprint 5 track P2
MQ17@@hooks/contract-hooks.mjs@@if (script === 'audit-anchor.mjs' && after.some((w) => w.v.text === 'create'))@@if (false)@@MQ: guard exit 2 — audit-anchor.mjs create@@Sprint 5 track P2
MQ18@@hooks/contract-hooks.mjs@@const withBase = (p) => { const t = tilde(String(p)); return isAbsolute(t) ? t : join(base, t); };@@const withBase = (p) => join(base, String(p));@@MQ: guard exit 2 — Glob pattern starting with ~@@Sprint 5 track P2
MQ19@@hooks/contract-hooks.mjs@@['*-result.json', 'ship-gate-verdict.json'@@['ship-gate-verdict.json'@@MQ: guard exit 2 — cp over a gate result@@Sprint 5 track P2
MQ20@@hooks/contract-hooks.mjs@@log: [join(R, 'docs', '31-board-events.jsonl')],@@log: [],@@MQ: guard exit 2 — append to the board log@@Sprint 5 track P2
MQ21@@hooks/contract-hooks.mjs@@const hit = named(target) || (tainted.some(uses) ? 'a guarded file' : '');@@const hit = named(target);@@MQ: guard exit 2 — inline program writing via a variable@@Sprint 5 track P2
MQ22@@hooks/contract-hooks.mjs@@const target = /^write_(text|bytes)$/.test(m[1])@@const target = /team\/evidence/.test(body) ? body : /^write_(text|bytes)$/.test(m[1])@@MQ: guard exit 0 — inline program reads evidence and renames elsewhere@@Sprint 5 track P2
MQ23@@hooks/contract-hooks.mjs@@if (existsSync(join(dirname(dirname(realish(p))), 'board.mjs'))) return p;@@return p;@@MQ: guard exit 0 — the app's own src/events.mjs@@Sprint 5 track P2
MQ24@@hooks/contract-hooks.mjs@@if (/^(bsd|g)?tar$/.test(name) &&@@if (false &&@@MQ: guard exit 2 — tar -x in the main tree@@Sprint 5 track P2
MQ25@@hooks/contract-hooks.mjs@@if (rest.some((w) => w.v.text === '-delete'))@@if (false)@@MQ: guard exit 2 — find -delete over docs@@Sprint 5 track P2
MQ26@@hooks/contract-hooks.mjs@@if (cmd.length) queue.push(cmd);@@if (false) queue.push(cmd);@@MQ: guard exit 2 — find -exec cp into docs/team@@Sprint 5 track P2
MQ27@@hooks/contract-hooks.mjs@@if (ctx.xargs && WRITERS.has(name)) tree(DOT);@@if (false) tree(DOT);@@MQ: guard exit 2 — xargs rm in the main tree@@Sprint 5 track P2
MQ28@@hooks/contract-hooks.mjs@@if (!s || ['push', 'save', 'pop', 'apply'].includes(s) || dd >= 0)@@if (false)@@MQ: guard exit 2 — git stash in the main tree@@Sprint 5 track P2
MQ29@@hooks/contract-hooks.mjs@@if (Object.prototype.hasOwnProperty.call(fileBodies, script.v.text)) queue.push(@@if (false) queue.push(@@MQ: guard exit 2 — heredoc to a script then sh runs it@@Sprint 5 track P2
MQ30@@hooks/contract-hooks.mjs@@evidence: [join(R, 'docs', 'team', 'evidence')],@@evidence: [join(R, 'docs', 'team', 'evidence'), join(cwd, 'docs', 'team', 'evidence')],@@MQ: guard exit 0 — in its own worktree: git stash@@Sprint 5 track P2
MQ31@@commands/app-build.md@@**Then** land its@@Then land its@@MQ: app-build lands a QA- ticket by close-then-ff-only@@Sprint 5 track P2
MQ32@@agents/release-manager.md@@`docs/60-releases.md`, `docs/70-security-review.md` and `docs/71-verification.md`, staged by@@`docs/60-releases.md`, staged by@@MQ: ship's STALE first pass, release-manager's release-doc commit@@Sprint 5 track P2
MT01@@hooks/contract-hooks.mjs@@if (!cmdWords.length) { checkWrites(redirects.map(@@if (!cmdWords.length) { (redirects.map(@@MT: guard exit 2 — a { …; } group redirected onto risk-policy@@Sprint 6 track Q2
MT02@@hooks/contract-hooks.mjs@@cur.push({ op: c === '>' || src[i + 1] === '>' ? '>' : '<' });@@cur.push({ op: c === '>' ? '>' : '<' });@@MT: guard exit 2 — a 1<> read-write open of risk-policy@@Sprint 6 track Q2
MT03@@hooks/contract-hooks.mjs@@        if (writes) {@@        if (false) {@@MT: guard exit 2 — node -e writing process.argv[1] = evidence@@Sprint 6 track Q2
MT04@@hooks/contract-hooks.mjs@@? args.join(',') : args[0];@@? args.join(',') : (m[2] || '');@@MT: guard exit 0 — writeFileSync whose CONTENT names risk-policy@@Sprint 6 track Q2
MT05@@hooks/contract-hooks.mjs@@for (const m of body.matchAll(PERL_OPEN)) {@@for (const m of []) {@@MT: guard exit 2 — perl -e open > $ARGV[0] = risk-policy@@Sprint 6 track Q2
MT06@@hooks/contract-hooks.mjs@@MKTEMP.test(ps.at(-1).body)) vars[m[1]]@@MKTEMP.test(ps.at(-1).body) && false) vars[m[1]]@@MT: guard exit 0 — reviewer idiom: worktree add, cd "$T"@@Sprint 6 track Q2
MT07@@hooks/contract-hooks.mjs@@const vars = { HOME: lit(homedir()).v, TMPDIR: lit(process.env.TMPDIR || tmpdir()).v, PWD: lit(cwd).v };@@const vars = {};@@MT: guard exit 0 — rm -rf "$HOME/.cache/x"@@Sprint 6 track Q2
MT08@@hooks/contract-hooks.mjs@@if (name === 'curl' || name === 'sort') opt('o', ['--output']).forEach(path);@@if (false) opt('o', ['--output']).forEach(path);@@MT: guard exit 2 — writer: curl --output=docs/team/risk-policy.json@@Sprint 6 track Q2
MT09@@hooks/contract-hooks.mjs@@opt('P', ['--directory-prefix']).forEach(inDir);@@opt('P', ['--directory-prefix']).forEach(() => {});@@MT: guard exit 2 — writer: wget -P docs/team@@Sprint 6 track Q2
MT10@@hooks/contract-hooks.mjs@@if (['merge', 'pull', 'cherry-pick', 'rebase', 'revert'].includes(sub)@@if ([].includes(sub)@@MT: guard exit 2 — writer: git merge feat/x@@Sprint 6 track Q2
MT11@@hooks/contract-hooks.mjs@@if (sub === 'worktree' && paths[0]?.v.text === 'add' && paths[1])@@if (false)@@MT: guard exit 2 — writer: git worktree add docs/team/evidence/wt@@Sprint 6 track Q2
MT12@@hooks/contract-hooks.mjs@@for (const l of LINKS) if (out.length@@for (const l of []) if (out.length@@MT: guard exit 2 — ln -s docs/team l; write l/risk-policy.json@@Sprint 6 track Q2
MT13@@scripts/lib/redact.mjs@@['studio-actor-token', /\bst_[A-Za-z0-9_-]{32,}/g],@@// removed@@MT: SubagentStop persists the report with its st_ role token redacted (C5G-8)@@Sprint 6 track Q2
MT14@@hooks/contract-hooks.mjs@@writeFileSync(file, `${redact(report).text}\n`)@@writeFileSync(file, `${report}\n`)@@MT: SubagentStop persists the report with its st_ role token redacted (C5G-8)@@Sprint 6 track Q2
MT15@@scripts/lib/evidence.mjs@@const lf = f.toLowerCase();@@const lf = f;@@MT: the QA- docs-only classifier refuses docs/Team/risk-policy.json@@Sprint 6 track Q2
MT16@@scripts/lib/evidence.mjs@@|Directory\.Build\.props)$/i;@@|Directory\.Build\.props)$/;@@MT: the QA- docs-only classifier refuses docs/Team/risk-policy.json and a PACKAGE.JSON@@Sprint 6 track Q2
MT17@@scripts/board.mjs@@return base ? landedAfterMerge(git, ticket, recorded, base) : '';@@return '';@@MT: a QA- ticket whose branch gained code AFTER merged@@Sprint 6 track Q2
MT18@@hooks/block-shared-tree-destructive-git.sh@@for c in $2; do same_ref "$1" "$c"@@for c in $2; do [ "$1" = "$c" ]@@MT: ref hook blocks update-ref refs/heads/Main on macOS@@Sprint 6 track Q2
MT19@@hooks/block-shared-tree-destructive-git.sh@@} else if (sc == "symbolic-ref") {@@} else if (sc == "zzzz-no-such-command") {@@MT: ref hook blocks git symbolic-ref@@Sprint 6 track Q2
MT20@@hooks/contract-hooks.mjs@@if (/^(ex|vi|vim|nvim|ed|red)$/.test(name)) plain.forEach(path);@@if (false) plain.forEach(path);@@MT: guard exit 2 — writer: vim -es@@Sprint 6 track Q2
MT21@@hooks/contract-hooks.mjs@@if (sub === 'clone' && paths.length > 1)@@if (false)@@MT: guard exit 2 — writer: git clone@@Sprint 6 track Q2
MT22@@hooks/contract-hooks.mjs@@if (name === 'split') {@@if (false) {@@MT: guard exit 2 — writer: split@@Sprint 6 track Q2
MT23@@hooks/contract-hooks.mjs@@if (name === 'mktemp') plain.forEach(path);@@if (false) plain.forEach(path);@@MT: guard exit 2 — writer: mktemp docs/team@@Sprint 6 track Q2
MT24@@hooks/contract-hooks.mjs@@(sub === 'read-tree' && a.some(@@(false && a.some(@@MT: guard exit 2 — writer: git read-tree@@Sprint 6 track Q2
MT25@@hooks/contract-hooks.mjs@@if (sub === 'checkout-index')@@if (false)@@MT: guard exit 2 — writer: git checkout-index@@Sprint 6 track Q2
MT26@@hooks/contract-hooks.mjs@@if (/^7z[az]?$/.test(name)@@if (false@@MT: guard exit 2 — writer: 7z x@@Sprint 6 track Q2
MT27@@hooks/contract-hooks.mjs@@if (name === 'cpio' &&@@if (false &&@@MT: guard exit 2 — writer: cpio@@Sprint 6 track Q2
MT28@@hooks/contract-hooks.mjs@@if (name === 'openssl')@@if (false)@@MT: guard exit 2 — writer: openssl@@Sprint 6 track Q2
MT29@@hooks/contract-hooks.mjs@@'scp', 'ditto'].includes(name)@@'scp'].includes(name)@@MT: guard exit 2 — writer: ditto@@Sprint 6 track Q2
MT30@@hooks/contract-hooks.mjs@@if (/^(bsd|g)?tar$/.test(name) &&@@if (/^tar$/.test(name) &&@@MT: guard exit 2 — writer: bsdtar@@Sprint 6 track Q2
MT31@@hooks/contract-hooks.mjs@@vars.PWD = hereAbs() ? lit(hereAbs()).v : { text: '', pat: ANY };@@vars.PWD = { text: '', pat: ANY };@@MT: guard exit 0 — cd src && rm -rf "$PWD/build"@@Sprint 6 track Q2
MU01@@hooks/contract-hooks.mjs@@if (!chained && pend) { if (!pend.sure || orElse) alts = [...alts, ...pend.cwds]; pend = null; }@@if (!chained && pend) { pend = null; }@@MU: guard exit 2 — cd /nonexistent; rm evidence@@PR46 review
MU02@@hooks/contract-hooks.mjs@@else if (ch === ')') { if (stack.length) ({ here, alts, pend, pwd: vars.PWD } = stack.pop()); }@@else if (ch === ')') { stack.pop(); }@@MU: guard exit 2 — (cd /tmp); rm -rf evidence@@PR46 review
MU03@@hooks/contract-hooks.mjs@@if (!pend.sure || orElse)@@if (!pend.sure)@@MU: guard exit 2 — cd /tmp || rm the token registry@@PR46 review
MU04@@hooks/contract-hooks.mjs@@abs && (abs.includes('/mktemp.anon') || (existsSync(abs)@@abs && ((existsSync(abs)@@MU: guard exit 0 — T=$(mktemp -d); cd "$T"; git checkout .@@PR46 review
MU05@@hooks/block-shared-tree-destructive-git.sh@@if (index(WV[w], " " W[i] " ")) i++@@if (0) i++@@MU: dirty tree blocks a wrapped git: sudo -u me git clean -fdx@@PR46 review
MU06@@hooks/block-shared-tree-destructive-git.sh@@for (k = WP[w]; k > 0 && i <= nw; k--) i++@@for (k = 0; k > 0 && i <= nw; k--) i++@@MU: dirty tree blocks a wrapped git: timeout 30 git reset --hard@@PR46 review
MU07@@hooks/contract-hooks.mjs@@'.studio-policy.json', 'docs/team/actors.json', '.studio-stop'];@@'.studio-policy.json'];@@MU: guard exit 2 — echo > .studio-stop@@PR46 review
MU08@@hooks/contract-hooks.mjs@@const head = (headLine(report).match(/^(DONE|BLOCKED):\s*([^\s*_]+)/) || []);@@const head = (report.match(/^(DONE|BLOCKED):\s*([^\s*_]+)/m) || []);@@MU: a report whose BLOCKED: is not its first line is held to the DONE contract@@PR46 review
MU09@@scripts/lib/contract.mjs@@.replace(/^[\s*_#>]+/, '').trim();@@.trim();@@MU: ...and **BLOCKED: APP-1** as the first line is a BLOCKED report@@PR46 review
MU10@@hooks/require-review-verdict.sh@@sub(/^[ \t\r*_#>]+/, "");@@sub(/^[ \t\r]+/, "");@@MU: the reviewer hook takes a leading-newline **BLOCKED: APP-001** as the refusal@@PR46 review
MU11@@scripts/lib/evidence.mjs@@if (qa) return QA_DOCS.test(f);@@if (false) return QA_DOCS.test(f);@@MU: the QA- fast path takes the test plan, bugs, evidence, daily and journeys@@PR46 review
MU12@@hooks/contract-hooks.mjs@@?.owner === role)) allow();@@?.owner === role)) {}@@MU: product-manager clarifying APP-1 (an ios-developer ticket) is not policed as ticket work@@PR46 review
MU13@@hooks/contract-hooks.mjs@@? String(input.path || cwd) : '';@@? String(input.path || '') : '';@@MU: Grep with no path from an ancestor of ~/.claude/projects is refused@@PR46 review
MU14@@hooks/guard-gate-writes.sh@@case $_P in *'"agent_id"'*) ;; *) exit 0 ;; esac@@:@@MU: a main-session tool call never starts node in guard-gate-writes@@PR46 review
MU15@@scripts/wave-integrate.mjs@@const tokenFor = (role, id) => inlineTokenFlag(ROOT, role, id);@@const tokenFor = (role, id) => ` --token "$(${BOARD_CLI} actor mint --role ${role} --ticket ${id})"`;@@MU: wave-integrate and ship-gate print the mint through inlineTokenFlag, not a copy@@PR46 review
MU16@@scripts/lib/evidence.mjs@@inlineTokenFlag(f.root ? resolve(String(f.root)) : evidenceRoot(),@@inlineTokenFlag(evidenceRoot(),@@MU: evidence.mjs token-flag --root reads that project's policy@@PR46 review
MU17@@scripts/lib/evidence.mjs@@if (mergedHead && !(mergedHead === head || isAncestor(git, mergedHead, head))) return fail(@@if (false) return fail(@@MU: a journey PASS on an ancestor made before the ticket's merged commit is refused@@PR46 review
MU18@@scripts/wave-integrate.mjs@@if (isQaDocs(t)) continue;@@if (/^QA-/i.test(t.id)) continue;@@MU: wave-integrate takes a code-changing QA- ticket at qa into the wave@@PR46 review
MU19@@scripts/wave-integrate.mjs@@const run = waveDirty@@const run = false@@MU: a wave suite that rewrites a tracked file is CANNOT EVALUATE, not GREEN@@PR46 review
MU20@@scripts/lib/integration.mjs@@if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) !== null) return { base: name, reason: '' };@@void name;@@MU: a declared 'Integration branch: main' wins over an existing develop branch@@PR46 review
MU21@@scripts/wave-integrate.mjs@@['high', 'critical'].includes(tier(m)) || runtimeRequired(m));@@['high', 'critical'].includes(tier(m)));@@MU: a medium ticket whose policy requires runtime-gate does not land on a failing runtime gate@@PR46 review
MU22@@scripts/board.mjs@@  if (!c.ok) {@@  if (false) {@@MU: adopt without a terminal is refused and writes no anchor@@PR46 review
MS7U2-01@@scripts/lib/evidence.mjs@@git(['diff', '--no-renames', '--name-only', '-z', from, to]);@@git(['diff', '--name-only', '-z', from, to]);@@U2: a QA- branch that renames code into docs/ is not docs-only — both sides of the rename are listed (G7-1)@@Sprint 7 U2
MS7U2-02@@scripts/lib/evidence.mjs@@'--no-renames', '--name-only', '-z', from, to]);@@'--no-renames', '--name-only', from, to]);@@U2: a non-ASCII path is listed raw and routes to its tier (G7-4)@@Sprint 7 U2
MS7U2-03@@scripts/board.mjs@@const files = mb ? changedFiles(g, mb, tip.sha) : null;@@const files = mb ? (g(['diff', '--name-only', mb, tip.sha]) || '').split('\n').filter(Boolean) : null;@@U2: merged is refused when a rename moves code out of a high-risk path (G7-4)@@Sprint 7 U2
MS7U2-04@@scripts/lib/risk.mjs@@approvals: union(tier, 'approvals')@@approvals: selected.approvals || []@@U2: routeFiles/route union the approvals and evidence of every rule at the winning tier (G7-5)@@Sprint 7 U2
MS7U2-05@@scripts/lib/risk.mjs@@best.approvals = [...new Set([...best.approvals, ...r.approvals])];@@void 0;@@U2: routeFiles/route union the approvals and evidence of every rule at the winning tier (G7-5)@@Sprint 7 U2
MS7U2-06@@scripts/lib/evidence.mjs@@const away = wave ? '' : notIntegrated(git, ticket, rec.head, mergedHead, root);@@const away = '';@@U2: qa_passed on a post-merge re-run of the ticket's own unintegrated branch is refused (G7-2)@@Sprint 7 U2
MS7U2-07@@scripts/lib/evidence.mjs@@if (mergedTs && !(Date.parse(v.evaluated_at) > Date.parse(mergedTs))) return fail(@@if (false) return fail(@@U2: a journey PASS evaluated before the ticket merged is not QA evidence (G7-2)@@Sprint 7 U2
MS7U2-08@@scripts/lib/evidence.mjs@@const undeclared = journeyDeclarationGap(root, git);@@const undeclared = '';@@U2: qa_passed on a web project with no journey declared is refused (S7-5)@@Sprint 7 U2
MS7U2-09@@scripts/lib/evidence.mjs@@if (sel.only) return@@if (false) return@@U2: a journey PASS from --only <id> does not count (G7-7)@@Sprint 7 U2
MS7U2-10@@scripts/lib/evidence.mjs@@if (!d || d.sha256 !== w.sha256) return@@if (!d) return@@U2: a journey run on an edited, uncommitted declaration does not count (G7-7)@@Sprint 7 U2
MS7U2-11@@scripts/journey-gate.mjs@@only: flags.only ? String(flags.only) : null,@@only: null,@@U2: journey-gate records its selection, directory and declaration sha256 (G7-7)@@Sprint 7 U2
MS7U2-12@@scripts/lib/capabilities.mjs@@if (name === 'unblocked' && needsApproval(state)) return@@if (false) return@@U2: a worker cannot release a needs-approval ticket (S7-2)@@Sprint 7 U2
MS7U2-13@@scripts/lib/capabilities.mjs@@if (name === 'corrected') return@@if (false) return@@U2: a worker cannot rewrite a ticket's invariants with corrected (S7-3)@@Sprint 7 U2
MS7U2-14@@scripts/board.mjs@@const gate = GATE_EVENTS.has(eventName) || conditional;@@const gate = GATE_EVENTS.has(eventName);@@U2: ...nor can --by tech-manager without the orchestrator's token (S7-2)@@Sprint 7 U2
MS7U2-15@@scripts/lib/events.mjs@@status: 'in_progress', approvals: [], qaPassed@@status: 'in_progress', qaPassed@@U2: ...it is in_progress with no approvals — re-review before it merges again@@Sprint 7 U2
MS7U2-16@@scripts/lib/capabilities.mjs@@rework: ['tech-manager'],@@rework: ['tech-manager', 'code-reviewer'],@@U2: only the orchestrator sends a merged ticket back to rework@@Sprint 7 U2
MS7U2-19@@scripts/lib/events.mjs@@if (dep.events.findLastIndex((e) => e.event === 'rework') > dep.events.findLastIndex((e) => e.event === 'merged')) return true;@@void 0;@@U2: ...and a ticket depending on it is not claimable until it merges again@@Sprint 7 U2
MS7U2-20@@scripts/lib/events.mjs@@reason: `rework sends a merged ticket back and must say why@@ok: true, reason: `rework sends a merged ticket back and must say why@@U2: ...and it must say why@@Sprint 7 U2
MS7U2-21@@scripts/lib/events.mjs@@qaPassed: false, verified: false, verifiedStatic@@qaPassed: false, verifiedStatic@@U2: ...and it cannot go straight to review: verification was voided@@Sprint 7 U2
MS7U2-22@@scripts/board.mjs@@if (!base) return unresolvedBase(git);@@if (!base) return '';@@U2: closed refuses, naming why, when the declared integration branch does not resolve@@Sprint 7 U2
MS7U2-23@@scripts/board.mjs@@const local = base.replace(/^origin\//, '');@@const local = base;@@U2: ...and the landing command checks out develop, not origin/develop@@Sprint 7 U2
MS7U2-24@@scripts/lib/risk.mjs@@new RegExp(rule.pattern, 'i')@@new RegExp(rule.pattern)@@U2: risk-policy patterns match case-insensitively (App/Persistence/Migrations)@@Sprint 7 U2
MS7U2-17@@scripts/board.mjs@@if (s.kind !== 'absent' && flags.mismatch !== s.kind) {@@if (false) {@@U2: adopt refuses a log the anchor disagrees with unless the mismatch is named, printing both counts (G7-13)@@Sprint 7 U2
MS7U2-18@@scripts/board.mjs@@if (String(flags.role || '') === 'founder' && tkt) {@@if (false) {@@U2: the founder mint refusal names the resolved path, and no registry lock was taken to ask (C7-8)@@Sprint 7 U2
U401@@scripts/context-preflight.mjs@@if (inSlot) notes.push(@@if (false) notes.push(@@Sprint 7 U4: preflight clears a freshly leased, detached slot (C7-2)@@Sprint 7 U4
U402@@scripts/context-preflight.mjs@@const writer = role ? Boolean(contractFor(role)) : inSlot;@@const writer = true;@@Sprint 7 U4: a reviewer in the main checkout on the integration branch is not blocked, --ticket first (C7-2)@@Sprint 7 U4
U403@@scripts/context-preflight.mjs@@const row = rows && rows[ticket.toUpperCase()];@@const row = null;@@Sprint 7 U4: ...reading the ticket from the main project's board, not a docs/31-board.md the slot lacks (C7-2)@@Sprint 7 U4
U404@@scripts/spawn-prompt.mjs@@if (row.owner === 'qa-engineer' && row.status === 'qa' && !/^QA-/i.test(row.id)) return composeQaVerdict(@@if (false) return composeQaVerdict(@@Sprint 7 U4: the VE QA-verdict prompt's own qa_passed command is accepted, and the ticket closes (R7-1)@@Sprint 7 U4
U405@@scripts/spawn-prompt.mjs@@const mine = wave.filter(own);@@const mine = [];@@Sprint 7 U4: the QA wave refuses a qa-engineer-owned ticket (it cannot pass its own work) (R7-1)@@Sprint 7 U4
U406@@scripts/spawn-prompt.mjs@@e.by === 'code-reviewer' && (e.event === 'approved' || e.event === 'changes') && e.detail?.verdict_path@@false@@Sprint 7 U4: after REQUEST CHANGES the VE prompt carries the constants routed in the verdict the reviewer cited (R7-5, C7-4)@@Sprint 7 U4
U407@@scripts/spawn-prompt.mjs@@const artifact = contract.tier === 'artifact' && !qa;@@const artifact = false;@@Sprint 7 U4: an artifact owner (ux-architect on docs/12-flows.md) is told to edit its Spec, not forbidden to (R7-6)@@Sprint 7 U4
U408@@scripts/spawn-prompt.mjs@@...fence(`git -C "${slot}" checkout -b@@...fence(`git checkout -b@@Sprint 7 U4: the IC prompt prints the absolute slot, git -C <slot>, and cd <slot> on every Bash call (R7-7)@@Sprint 7 U4
U409@@scripts/spawn-prompt.mjs@@+ skillWords + packWords;@@+ skillWords;@@Sprint 7 U4: the budget total includes the role's mandatory KB packs (C7-6)@@Sprint 7 U4
U410@@scripts/spawn-prompt.mjs@@if (inFence) kept.push(@@if (false) kept.push(@@Sprint 7 U4: ...and a fence cut open is closed, so every later fence pairs (C7-7)@@Sprint 7 U4
U411@@scripts/spawn-prompt.mjs@@out.push('', n > left ? cutLines(body.split('\n'), left) : body);@@out.push('', n > left ? `${body.split(/\s+/).slice(0, left).join(' ')} […truncated]` : body);@@Sprint 7 U4: a truncated excerpt keeps its lines, and a # comment in a code block does not split the section (C7-7)@@Sprint 7 U4
U412@@scripts/spawn-prompt.mjs@@[...new Set(['docs/10-prd.md', PLATFORM_SPEC[role], specFile]@@[...new Set([PLATFORM_SPEC[role], specFile, 'docs/10-prd.md']@@Sprint 7 U4: ...with the PRD's acceptance first, before the impl spec spends the budget (C7-7)@@Sprint 7 U4
U413@@scripts/spawn-prompt.mjs@@die(2, `slot ${slot} does not exist.@@process.stderr.write(`slot ${slot} does not exist.@@Sprint 7 U4: compose refuses a slot that does not exist (C7-12)@@Sprint 7 U4
U414@@scripts/spawn-prompt.mjs@@readPolicy(ROOT);  // C7-12@@void ROOT;  // C7-12@@Sprint 7 U4: compose refuses an unparseable .studio-policy.json, as the board does (C7-12)@@Sprint 7 U4
U415@@scripts/lib/contract.mjs@@'ASO BLOCKED', 'ASO:'],@@'ASO BLOCKED'],@@Sprint 7 U4: an aso-specialist 'ASO: CANNOT EVALUATE' stop is not blocked as a missing DONE (R7-9)@@Sprint 7 U4
U417@@scripts/spawn-prompt.mjs@@'You write no board event: the orchestrator records a FAIL as `changes`.',@@...tokenLines(ROOT, role, row.id),@@Sprint 7 U4: ...mints no token for a spawn that writes no board event, and clears verify (R7-13)@@Sprint 7 U4

M7U5-01@@scripts/test.sh@@if [ "$_after" != "$PLUGIN_STATUS_BEFORE" ]; then@@if false; then@@C7-1: a run that writes a tracked plugin file fails loudly on exit@@Sprint 7 U5
M7U5-02@@scripts/test.sh@@grep -qF -- "$2" "$1" && ok "$3"@@grep -q -- "$2" "$1" && ok "$3"@@C7-11: assert_has reads its needle as a fixed string — 'a.c' does not match 'abc'@@Sprint 7 U5
M7U5-03@@scripts/test.sh@@for _kt in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$_kt"; done@@:@@C7-11: assert_exit_within kills the hung command's children, not only its subshell@@Sprint 7 U5
M7U5-04@@scripts/worktree-slot.mjs@@case 'lease': withFileLock(STATE, cmdLease, { die }); break;@@case 'lease': cmdLease(); break;@@C7-3: 4 concurrent leases with --pool 2 lease exactly 2, record both, create 2 worktrees@@Sprint 7 U5
M7U5-05@@scripts/lib/atomic.mjs@@const LOCK_WAIT_MS = 30_000;@@const LOCK_WAIT_MS = 5000;@@C7-9: a lock waiter outlasts a live 6s holder instead of refusing at 5s@@Sprint 7 U5
M7U5-06@@scripts/run-ledger.mjs@@withFileLock(ledger, () => {@@((fn) => { if (existsSync(ledger + '.lock')) die(2, 'locked'); return fn(); })(() => {@@C7-10: run-ledger reaps a dead holder's aged lock instead of blocking every claim@@Sprint 7 U5
M7U5-07@@scripts/messages.mjs@@return withFileLock(ledgerPaths(options).jsonl, () => cmdSend(options), { die: lockDie });@@if (existsSync(ledgerPaths(options).jsonl + '.lock')) die('locked'); return cmdSend(options);@@C7-10: messages.mjs takes the same shared lock and reaps the same dead holder@@Sprint 7 U5
M7U5-08@@scripts/lib/messages.mjs@@const roles = new Set([from, ...(isRegistration(candidate) ? [] : to)]);@@const roles = new Set([from, ...to]);@@R7-2: messages.mjs artifact ADR --by cto --ticket APP-060 is not chain_too_deep@@Sprint 7 U5
M7U5-09@@scripts/lib/messages.mjs@@m.kind === 'decision' && !isRegistration(m)@@m.kind === 'decision'@@R7-11: an artifact registration does not close the ticket thread to a later question@@Sprint 7 U5
M7U5-10@@scripts/review-pattern-scan.mjs@@if (/^REVIEW VERDICT:\s*REQUEST CHANGES\s*$/m.test(text)) {@@if (false) {@@R7-3: two current-format verdicts blocking on one file are correlated@@Sprint 7 U5
M7U5-11@@scripts/memory-curator.mjs@@if (candidate.by === by) die(1,@@if (false) die(1,@@S7-11: memory review by the proposer is refused@@Sprint 7 U5
M7U5-12@@scripts/memory-curator.mjs@@by: required('by') });@@by: flags.by || null });@@S7-11: ...and propose without --by is refused@@Sprint 7 U5
M7U5-13@@scripts/lib/operational-paths.txt@@.studio-cache@@.studio-cache-x@@S7-1: a .studio-cache/ build cache does not make the tree dirty@@Sprint 7 U5
M7U5-14@@scripts/run-doctor.mjs@@for (const a of active) console.log(@@for (const a of []) console.log(@@S7-4: run-doctor --root reads that project and lists the live attempt's run and attempt ids@@Sprint 7 U5
M7U5-15@@scripts/run-doctor.mjs@@resolve(String(flags.root || '.'), String(flags.ledger@@resolve(String(flags.ledger@@S7-4: run-doctor --root reads that project and lists the live attempt's run and attempt ids@@Sprint 7 U5
M7U5-16@@scripts/verify-done.sh@@    node \"\${CLAUDE_PLUGIN_ROOT}/scripts/wave-integrate.mjs\" --root . --wave <N> --base $BASE@@    node scripts/wave-integrate.mjs --root . --wave <N> --base $BASE@@W7-12: verify-done and merge-reconcile print ${CLAUDE_PLUGIN_ROOT} paths, not relative ones@@Sprint 7 U5
M7U5-17@@scripts/ship-gate.sh@@echo "        red-team-agent and defect-hunting, not by this gate."@@:@@N6: a CLEAR ship-gate run itself states it only replays known defects (G-F13)@@Sprint 7 U5

MS7U1A@@scripts/integration-branch.sh@@s/^[[:space:]>*|#-]*([0-9]+\.[[:space:]]*)?[Ii]ntegration branch[[:space:]]*(\*\*)?@@s/.*(@)?[Ii]ntegration branch[[:space:]]*(\*\*)?@@Sprint 7 U1: prose naming 'the integration branch' is not a declaration — main is read, not never/protected (C7-5)@@Sprint 7 U1
MS7U1B@@scripts/integration-branch.sh@@  feat/*|fix/*|qa/*|bug/*)@@  __no_ticket_branch__)@@Sprint 7 U1: a declared ticket branch (feat/…) is CANNOT RESOLVE, even committed (G7-3)@@Sprint 7 U1
MS7U1C@@scripts/integration-branch.sh@@if git --git-dir="$COMMON" cat-file -e "HEAD:$PREFIX$1" 2>/dev/null; then@@if false; then@@Sprint 7 U1: an uncommitted rewrite of the strategy doc does not move the integration branch (G7-3)@@Sprint 7 U1
MS7U1D@@scripts/lib/integration.mjs@@if (r.status !== 0 || !name) return { base: '',@@if (r.status !== 0 || !name) return { base: 'develop',@@Sprint 7 U1: a strategy doc that cannot resolve gives the board no base, not a fallback develop (C7-5)@@Sprint 7 U1
MS7U1E@@scripts/lib/integration.mjs@@return { base: `origin/${name}`, reason: '' };@@return { base: name, reason: '' };@@Sprint 7 U1: in a fresh clone the board's integration base is origin/develop, a ref that resolves (G7-16)@@Sprint 7 U1
MS7U1F@@scripts/wave-integrate.mjs@@if (head) {@@if (false) {@@Sprint 7 U1: a branch with commits after merged is held out of the wave and routed to rework (G7-6, W7-1)@@Sprint 7 U1
MS7U1G@@scripts/wave-integrate.mjs@@if (ahead.length) { moved.push(@@if (false) { moved.push(@@Sprint 7 U1: a branch with commits after merged is held out of the wave and routed to rework (G7-6, W7-1)@@Sprint 7 U1
MS7U1H@@scripts/wave-integrate.mjs@@  || indexHides(WT);@@  || false;@@Sprint 7 U1: a wave suite that hides an edit behind assume-unchanged is CANNOT EVALUATE (G7-17)@@Sprint 7 U1
MS7U1I@@scripts/wave-integrate.mjs@@const GREEN_REF = `refs/studio/wave-green/${WAVE}`;@@rmSync(WT, { recursive: true, force: true }); const GREEN_REF = `refs/studio/wave-green/${WAVE}`;@@Sprint 7 U1: re-running an existing wave keeps the kept wave tree on disk (W7-8)@@Sprint 7 U1
MS7U1J@@scripts/board-doctor.mjs@@if (!anchor.ok) {@@if (false) {@@Sprint 7 U1: board-doctor is CANNOT EVALUATE on a log whose anchor is gone, naming adopt (W7-5)@@Sprint 7 U1
MS7U1K@@scripts/ship-gate.sh@@(absent)'; then CHAIN_RC=3;@@(absent)'; then CHAIN_RC=1;@@Sprint 7 U1: ship-gate tells a missing anchor from a broken chain, and names adopt (W7-5)@@Sprint 7 U1
MS7U1L@@scripts/runtime-gate.sh@@if [ -n "$IB_SHA" ] && [ "$IB_SHA" != "$HEAD_SHA" ]@@if false@@Sprint 7 U1: runtime-gate refuses a main checkout that is not on the integration branch tip (W7-3)@@Sprint 7 U1

MV01@@hooks/contract-hooks.mjs@@if (n && !n.startsWith('#')) WRAPPERS.set(n, { ops: Number(ops) || 0, vals: new Set(vals) });@@void n;@@U3: guard exit 2 — wrappers.txt row 'timeout' wraps rm@@Sprint 7 U3
MV02@@hooks/block-shared-tree-destructive-git.sh@@nf = split(line, F, /[ \t]+/); WRAP[F[1]] = 1;@@nf = split(line, F, /[ \t]+/);@@U3: git hook exit 2 — wrappers.txt row 'setsid' wraps git@@Sprint 7 U3
MV03@@hooks/contract-hooks.mjs@@if (unsure) alts = [...alts, ...before];@@if (false) alts = [...alts, ...before];@@U3: guard exit 2 — uncertain cd: sh -c "cd /nonexistent@@Sprint 7 U3
MV04@@hooks/block-shared-tree-destructive-git.sh@@return (unsure || SHADOW || !enterable(nd)) ? union(nd, dir) : nd@@return nd@@U3: git hook exit 2 — dirty tree: false && cd /tmp; git stash@@Sprint 7 U3
MV05@@hooks/block-shared-tree-destructive-git.sh@@if d=$(sh "$PLUGIN/scripts/integration-branch.sh" "$1" 2>/dev/null); then@@if d=main; then@@U3: git hook exit 2 — merge --no-ff onto develop declared as "develop."@@Sprint 7 U3
MV06@@hooks/contract-hooks.mjs@@.slice(0, 20).forEach(addRoot);@@.slice(0, 0).forEach(addRoot);@@U3: guard exit 2 — rm -rf <abs project>/docs/team/evidence from cwd /tmp@@Sprint 7 U3
MV07@@hooks/contract-hooks.mjs@@if (script === 'board.mjs' && after.some((w) => w.v.text === 'adopt')) refuse(ADOPT);@@void ADOPT;@@U3: guard exit 2 — board.mjs adopt run by its shebang@@Sprint 7 U3
MV08@@hooks/contract-hooks.mjs@@if (/^(g?base64|uudecode|plutil)$/.test(name)) opt(@@if (false) opt(@@U3: guard exit 2 — writer: base64@@Sprint 7 U3
MV09@@hooks/block-shared-tree-destructive-git.sh@@git -C "$GDIR" status --porcelain -uall -- ':/' $EXCL 2>/dev/null | grep '^??'@@git -C "$GDIR" status --porcelain -uall 2>/dev/null | grep '^??'@@U3: git hook exit 0 — branch -D with only operational files untracked@@Sprint 7 U3
MV10@@hooks/block-shared-tree-destructive-git.sh@@[ -n "$AGENT" ] && [ -n "$ROOT" ] && [ -f "$ROOT/docs/31-board-events.jsonl" ] || continue@@continue@@U3: git hook exit 2 — a subagent: checkout -b in the studio main checkout@@Sprint 7 U3
MV11@@hooks/block-cross-worktree-write.sh@@if [ -n "$DEV" ] && [ -z "$TARGET_WT" ]; then@@if false; then@@U3: write hook exit 2 — an ios-developer writing into the studio main checkout@@Sprint 7 U3
MV12@@hooks/block-shared-tree-destructive-git.sh@@if (has(A, na, "-u")) emit("D", "", d, "git read-tree@@if (0) emit("D", "", d, "git read-tree@@U3: git hook exit 2 — dirty tree: git read-tree@@Sprint 7 U3
MV13@@hooks/contract-hooks.mjs@@if (/board\.mjs/.test(body) && /\badopt\b/.test(body)) refuse(ADOPT);@@void ADOPT;@@U3: guard exit 2 — python3 pty.spawn board.mjs adopt@@Sprint 7 U3
MV14@@hooks/guard-gate-writes.sh@@  *[/~]*) printf@@  *NEVER*) printf@@U3: guard exit 2 — rm -rf <abs project>/docs/team/evidence from cwd /tmp@@Sprint 7 U3
MS7L01@@hooks/block-shared-tree-destructive-git.sh@@      if [ -z "$DIRTY" ] && [ -n "$SWEEP" ] && [ -n "$OPS" ]; then@@      if false; then@@Sprint 7 lead: 'git clean -fdx' in a main checkout with a gitignored board log is refused@@Sprint 7 lead
MP47A@@scripts/lib/events.mjs@@...(isQaDocs(state) ? [] : ['rework'])@@...(isQaDocs(state) ? [] : [])@@PR47: rework is legal for a code-changing QA- ticket at qa, not for a docs-only one@@PR47 review
MP47B@@hooks/block-shared-tree-destructive-git.sh@@      STAT=$( { git -C "$GDIR" status --porcelain -uno -- ':/' 2>/dev/null@@      STAT=$( { true@@PR47: a tracked operational file with uncommitted changes still blocks git reset --hard@@PR47 review
MP47C@@scripts/runtime-gate.sh@@[ -f "$TOPL/docs/31-board-events.jsonl" ]@@true@@PR47: the runtime gate's integration-tip check skips a repo that is not a studio project@@PR47 review
MP47D@@scripts/runtime-gate.sh@@[ "$(cd "$ROOT" && pwd -P)" = "$(cd "$TOPL" && pwd -P)" ]@@true@@PR47: the runtime gate's integration-tip check skips a fixture directory inside another repo@@PR47 review
MP47E@@scripts/spawn-prompt.mjs@@return ticketEvents(root, id).filter((e) => !METADATA_EVENTS.has(e.event)).pop();@@return ticketEvents(root, id).pop();@@PR47 round 2: a corrected event after rework still composes the rework (existing branch, wave reason)@@PR47 fixes
MP47F@@scripts/spawn-prompt.mjs@@} else if (qa && base && tryGit(ROOT, ['rev-parse', '--verify', '-q', `refs/heads/${branchName}`])) {@@} else if (false) {@@PR47 round 3: QA's first spawn cuts qa/QA-1; the re-spawn once it exists is a verdict pass on the landed tree@@PR47 fixes
MF47A@@scripts/integration-branch.sh@@-e 's/^[[:space:]>*|#-]*([0-9]+\.[[:space:]]*)?[Ii]ntegration branch[[:space:]]*(\*\*)?@@-e 's/^[[:space:]>*|-]*(@)?[Ii]ntegration branch[[:space:]]*(\*\*)?@@PR47 fixes: heading, numbered, hyphen@@PR47 fixes
MF47B@@hooks/block-shared-tree-destructive-git.sh@@printf 'main master develop %s'@@printf 'main %s'@@PR47 fixes: an unresolvable declaration still protects develop from a raw merge@@PR47 fixes
MF47C@@hooks/block-shared-tree-destructive-git.sh@@case $REF in i) SWEEP=1; EXCL="" ;; u) EXCL="" ;; esac@@SWEEP=1; EXCL=""@@PR47 fixes: git clean -fd runs when the only operational file is the gitignored board log@@PR47 fixes
MF47D@@hooks/block-shared-tree-destructive-git.sh@@m = (sc == "clean") ? "u" : ""@@m = ""@@PR47 fixes: git clean -fd is refused when an untracked operational file exists@@PR47 fixes
MF47E@@scripts/spawn-prompt.mjs@@} else if (lastWorkEvent(ROOT, row.id)?.event === 'rework') {@@} else if (false) {@@PR47 fixes: after rework, compose checks out the existing branch and carries the wave's reason@@PR47 fixes
MF47F@@hooks/contract-hooks.mjs@@.filter((w) => w.includes('/') && !/^[~/]/.test(w)@@.filter((w) => false && !/^[~/]/.test(w)@@PR47 fixes: rm -rf ../proj/docs/team/evidence from a non-studio cwd is refused@@PR47 fixes
MF47G@@scripts/messages.mjs@@if (String(options.channel || '').replace(/^#/, '') === 'artifacts') die(@@if (false) die(@@PR47 fixes: send refuses --channel artifacts@@PR47 fixes
MF47H@@scripts/messages.mjs@@      registration: true,@@      registration: false,@@PR47 fixes: messages.mjs artifact stamps registration:true@@PR47 fixes
MF47I@@scripts/lib/atomic.mjs@@const ownerFile = (lockPath) => (statSync(lockPath).isDirectory() ? join(lockPath, 'owner') : lockPath);@@const ownerFile = (lockPath) => lockPath;@@PR47 fixes: main's directory lock with a dead owner is reaped, not waited out@@PR47 fixes
MF47J@@scripts/lib/atomic.mjs@@if ((Number.isInteger(pid) && pid > 0) || age < ORPHAN_AGE_MS) return '';@@return '';@@PR47 fixes: an aged lock naming no holder says how to clear it@@PR47 fixes
MF47L@@scripts/board-doctor.mjs@@process.exit(anchor.kind === 'absent' ? 2 : 1);@@process.exit(2);@@PR47 fixes: board-doctor exits 1 on a log with lines deleted under its anchor@@PR47 fixes
MF47M@@scripts/ship-gate.sh@@then CHAIN_RC=3; else CHAIN_RC=4; fi@@then CHAIN_RC=3; else CHAIN_RC=3; fi@@PR47 fixes: ship-gate blocks a deleted-lines anchor mismatch@@PR47 fixes
MF47N@@scripts/wave-integrate.mjs@@if (r.base.startsWith('origin/')) {@@if (false) {@@PR47 fixes: in a fresh clone the wave names origin/develop@@PR47 fixes
MF47O@@scripts/runtime-gate.sh@@ && ! git -C "$ROOT" merge-base --is-ancestor "$IB_SHA" "$HEAD_SHA" 2>/dev/null; then@@; then@@PR47 fixes: runtime-gate on a release/* HEAD that contains the develop tip@@PR47 fixes
MF47P@@scripts/lib/evidence.mjs@@const UI_PLATFORMS = /\b(ios|android|web|web-app)\b/i;@@const UI_PLATFORMS = /^(ios|android|web|web-app)$/i;@@PR47 fixes: platform@@PR47 fixes
MF47Q@@scripts/lib/evidence.mjs@@&& /^integration\/wave-/.test(String(rec.branch || ''));@@;@@PR47 fixes: a wave-integrate.mjs record on the ticket's own unintegrated branch@@PR47 fixes
MF47R@@scripts/spawn-prompt.mjs@@row.status === 'qa' && !/^QA-/i.test(row.id)) return composeQaVerdict@@row.status === 'qa') return composeQaVerdict@@PR47 fixes: a QA- ticket at qa is composed as a verification@@PR47 fixes
MF47S@@scripts/merge-reconcile.mjs@@corrected --by tech-manager --detail "<what went wrong>"@@corrected --detail "<what went wrong>"@@PR47 fixes: merge-reconcile prints the full corrected command, with --by@@PR47 fixes
MF47T@@scripts/dispatch-preflight.mjs@@${inlineTokenFlag(resolve(String(flags.root)), 'tech-manager', flags.ticket)}@@@@PR47 fixes: dispatch-preflight's corrected command is absolute@@PR47 fixes
V601@@scripts/lib/args.mjs@@if (help && name === 'help' && inline === undefined) {@@if (false) {@@Sprint 8 V6: team-bootstrap --help prints its usage, exits 0 and writes nothing (EN-10)@@Sprint 8 V6
V602@@scripts/foundation-conformance.mjs@@if (badId) {@@if (false) {@@Sprint 8 V6: foundation-conformance rejects an argument that is not an invariant id (EN-10)@@Sprint 8 V6
MV701@@skills/role-activation/SKILL.md@@| flagship. utility: off, merged into `verification-engineer`'s ship pass (delta 6) |@@| never off on a staffed type, never tier-gated |@@Sprint 8 V7: utility roster drops release-auditor and the no-op data-analyst/product-validator deltas (SK-3, SK-4)@@Sprint 8 V7
MV702@@commands/app-ship.md@@row still `conditional` is decided now@@row still `conditional` stays as written@@Sprint 8 V7: /app-ship re-evaluates conditional roles before the ship fan-out (SK-2)@@Sprint 8 V7
MV703@@commands/app-init.md@@has `product-researcher` `active`, spawn it now@@has `product-researcher` `active`, spawn it after scope-lock@@Sprint 8 V7: /app-init spawns product-researcher between ceo and cpo (SK-1)@@Sprint 8 V7
MV704@@agents/release-auditor.md@@evidence-check.mjs" --head@@evidence-check.mjs" --skip@@Sprint 8 V7: release-auditor binds journeys via evidence-check, kill switch only when named (FL-6)@@Sprint 8 V7
MV705@@agents/code-reviewer.md@@- `database-migration` — any persisted model or schema change@@- schema changes need no procedure@@Sprint 8 V7: XS review is the floor track, IC tests follow the diff, one backend branch form, migrations routed (EN-4, EN-6, EN-12, SK-7)@@Sprint 8 V7
S8V1A@@scripts/trace.mjs@@if (id !== 'waiver' && founderWords.includes(s)) return true;@@if (false) return true;@@Sprint 8 V1: a price in the founder's own words@@Sprint 8 V1
S8V1B@@scripts/trace.mjs@@re.test(l) && l.toLowerCase().includes(s)@@re.test(l) && l.includes(subj)@@Sprint 8 V1: a decision matches its subject case-insensitively@@Sprint 8 V1
S8V1C@@scripts/trace.mjs@@.replace(/\s*—\s*v\d+\.\d+\.\d+\s*$/, '')@@@@Sprint 8 V1: the version field release-manager appends does not re-open an approved waiver@@Sprint 8 V1
S8V1D@@scripts/trace.mjs@@const wantsAnalytics = docs.some((d) => d.rel === 'docs/52-analytics.md');@@const wantsAnalytics = true;@@Sprint 8 V1: ...and one without docs/52-analytics.md owes none@@Sprint 8 V1
S8V1E@@scripts/trace.mjs@@  { id: 'destructive-migration', where:@@  { id: 'account-deletion', where: /^docs\//, pattern: /\baccount deletion\b/i, why: 'x' }, { id: 'destructive-migration', where:@@Sprint 8 V1: a price in the founder's own words@@Sprint 8 V1
CATALOGUE
}

catalogue_tsv() { catalogue | awk '{ gsub(/@@/, "\037"); print }'; }

# Assertions that exist but CANNOT be mutation-tested on this host, with the reason. Printed with
# the score. Counted in neither numerator nor denominator — and said out loud, because a score that
# silently drops what it could not test is the failure mode this tool exists to catch.
excluded() {
  cat <<'EXCLUDED'
runtime-gate.sh — the build, install, launch and liveness paths@@Needs Xcode, a booted simulator, or adb. The suite only exercises runtime-gate's CANNOT-EVALUATE branches; the branches that decide PASS vs FAIL never execute on this host or in CI, so nothing would go red for a mutation in them. This is the gate whose whole job is running the artifact, and it is the one we cannot mutation-test.
runtime-gate.sh — the xcodebuild / gradle invocations themselves@@Same reason. A mutation to a build command is invisible without a mobile toolchain.
ship-gate.sh — the malformed-WAIVED: branch@@No fixture reaches it. Mutating it would report SURVIVED, but the cause is a missing fixture, not a decorative assertion. Write the fixture first, then add the mutation; reporting it as a hole today would be a false alarm, which is how a tool like this gets switched off.
wave-integrate.mjs — the post-push confirmation that $BASE actually moved@@No fixture reaches it. `git fetch . <wave>:<base>` either advances the ref or fails, so the branch where the fetch SUCCEEDS and the ref is still elsewhere cannot be constructed — mutating it reports SURVIVED for want of a fixture rather than for want of an assertion. It is kept in the code because the defect it guards against (B1) shipped once already: --push printed PUSHED for a branch that never moved. A confirmation is cheap; believing an exit code twice is not.
board.mjs — `closed` with no commit recorded at merged and no branch or --head (the old MF13)@@No fixture reaches it. Since C3G-8 every `merged` records merged_head, so `closed` always knows its subject; this branch only fires for a board written before that, and the hash-chained log cannot be hand-built to omit the field. MF13 "survived" on a CI sample because its assertion matched the recorded-commit refusal's wording instead. Kept in the code for old boards.
board.mjs — `closed`'s approval re-check against the recorded merged commit (the old MF14)@@No fixture reaches it. `merged` already refuses unless the approvals cover the commit it records, and `closed` checks THAT commit, so the approvals cannot disagree with it afterwards (no verdict event is legal past merged). A late commit is refused earlier, by the commits-after-merged check — which is what MF14's assertion was actually seeing, so it "survived" on a CI sample. Kept as defence in depth.
network-dependent assertions@@There are none in this suite, deliberately. If one is ever added it belongs on this list rather than in the score, because a mutation caught only when the network is up is not caught.
test.sh — the unescaped-backtick self-check@@The only mutation that would prove this is reintroducing the exact defect it guards (an unescaped backtick pair in a double-quoted label), and that defect is a shell command-substitution error at the point the mutated test.sh copy tries to construct that argument — the nested suite process crashes before it can print a "N passed, M failed" line, so `run_suite` reports CANNOT RUN rather than a clean FAIL for this assertion, and mutate.sh's own crash handling aborts the whole run rather than scoring one mutation. Proven correct by hand instead (both directions): reintroducing the fixed backtick line is caught, the clean file is not flagged.
EXCLUDED
}

# A ROW WITH NO SCOPE GETS ONE DERIVED, NOT THE WHOLE SUITE (QA-9). 49 rows named no section, so
# each ran all ~1400 assertions; a full catalogue cost ~450 x full suite, about 7.5 hours, and so
# nobody ran it. The section that holds the row's own assertion label is exactly the scope a human
# would have typed. Derived only when ONE section holds the label; none or several stays unscoped
# (full suite). `--full-suite` still ignores every scope.
#
# A label in the preamble (before the first banner) runs in EVERY subset, so any section is its
# scope: the first one is used. A label is also looked up with test.sh's \` escaping.
derive_scope() {
  MUT_LABEL="$1" awk '
    BEGIN { l = ENVIRON["MUT_LABEL"]; e = l; gsub(/`/, "\\`", e); pre = 1 }
    /^# --- / { b = $0; pre = 0; if (first == "") first = $0 }
    /^echo "─────/ { b = "" }
    (index($0, l) || index($0, e)) { if (pre) inpre = 1; else if (b != "" && !(b in seen)) { seen[b] = 1; n++; hit = b } }
    END { if (n == 1) print hit; else if (n == 0 && inpre) print first }
  ' "$REPO/scripts/test.sh"
}

if [ "$LIST" = "1" ]; then
  echo "MUTATION CATALOGUE"
  echo
  catalogue_tsv | while IFS="$TAB" read -r id file old new expect scope; do
    [ -n "$id" ] || continue
    printf '%-5s %s\n' "$id" "$file"
    printf '      - %s\n' "$old"
    printf '      + %s\n' "$new"
    printf '      expects to fail: %s\n' "$expect"
    [ -n "$scope" ] || scope=$(derive_scope "$expect")
    printf '      runs: %s\n\n' "${scope:-THE WHOLE SUITE (no section holds the label)}"
  done
  echo "NOT MUTATABLE HERE"
  excluded | awk '{ gsub(/@@/, "\037"); print }' | while IFS="$TAB" read -r what why; do
    printf '  · %s\n      %s\n' "$what" "$why"
  done
  exit 0
fi

# An unknown --only id is rejected HERE, before the baseline suite runs. Not only because a minute
# of waiting to be told about a typo is rude: `scripts/test.sh` asserts on this path, and the copy's
# suite would otherwise invoke a baseline run of its own, recursively, forever.
# `--only` takes a COMMA-SEPARATED LIST, because proving a batch of new gates one invocation at a
# time re-pays the baseline every time. Every id is validated before anything runs: being told about
# a typo after four minutes of waiting is how a tool stops getting used.
if [ -n "$ONLY" ]; then
  ONLY_RE=""
  echo "$ONLY" | tr ',' '\n' | while read -r _id; do
    [ -n "$_id" ] || continue
    catalogue | grep -q "^$_id@@" || { echo "mutate: no mutation with id '$_id'. Try --list." >&2; exit 3; }
  done || exit 2
  ONLY_RE=$(echo "$ONLY" | tr ',' '|' | sed "s/^/^(/; s/\$/)$TAB/")
fi

# ---------------------------------------------------------------------------------------------
# The copy, and the guarantee that the real tree is untouched.
# ---------------------------------------------------------------------------------------------
command -v git >/dev/null 2>&1 || { echo "mutate: CANNOT RUN — git is not on PATH" >&2; exit 2; }
git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "mutate: CANNOT RUN — $REPO is not a git work tree, so 'the tree is unchanged' cannot be proven" >&2; exit 2; }

# The snapshot the tree must still match on exit. Not "empty": the operator may legitimately have
# uncommitted work in progress. What must not change is *this* set.
BEFORE=$(git -C "$REPO" status --porcelain -uall)

WORK=$(mktemp -d) || { echo "mutate: CANNOT RUN — no temp dir" >&2; exit 2; }
RC=2
cleanup() {
  rm -rf "$WORK"
  AFTER=$(git -C "$REPO" status --porcelain -uall)
  if [ "$BEFORE" != "$AFTER" ]; then
    echo
    echo "FATAL: the working tree changed during this run. A mutation may be left in place."
    echo "       Nothing here writes to the real tree, so this means something else did — but"
    echo "       check the diff before trusting the repo."
    echo "  before:"; printf '%s\n' "$BEFORE" | sed 's/^/    /'
    echo "  after:";  printf '%s\n' "$AFTER"  | sed 's/^/    /'
    exit 2
  fi
  exit "$RC"
}
trap cleanup EXIT INT TERM HUP

( cd "$REPO" && tar cf - --exclude .git . ) | ( cd "$WORK" && tar xf - ) \
  || { echo "mutate: CANNOT RUN — could not copy the repo" >&2; RC=2; exit 2; }

# `.git` is deliberately NOT copied. In a worktree it is a *file* pointing at the real repository's
# gitdir, so every git command in the copy would operate on the real tree — the exact accident this
# script exists to make impossible. An empty init is enough: the suite has one assertion whose
# subject is verify-done's behaviour inside a repo, and without any git context it reads
# CANNOT EVALUATE (exit 2) instead of REJECTED (exit 1) and the baseline is never green.
git -C "$WORK" init -q -b main . >/dev/null 2>&1 \
  || { echo "mutate: CANNOT RUN — could not init the copy" >&2; RC=2; exit 2; }

# Tells the suite that one line of this tree is deliberately broken. The suite has exactly one
# assertion that would otherwise fail under EVERY mutation — it checks that each catalogue anchor
# still appears once in its target file, which is false for the anchor currently replaced. Without
# this, the suite becomes a detector of its own mutation tester: every gate reports CAUGHT and a
# genuine survivor is masked. Observed on the first run of this script.
#
# Nothing else reads it, and it is exported for the baseline run too, so the mutated and unmutated
# runs assert exactly the same set.
export APP_TEAM_MUTATING=1

# run_suite <logfile> [scope] — echoes the failure count ("?" if the suite never reported one).
#
# SCOPES EXIST BECAUSE THIS TOOL WAS TOO SLOW TO USE, and a check nobody runs is the exact thing it
# was built to find. Every mutation ran the whole 1300-assertion suite: ~4.5 minutes each, so nine
# new mutations cost ninety minutes and were therefore catalogued and left unproven — a rule this
# repository could not say could fail, which is the shape of defect the whole file exists to refuse.
#
# A scope is the `# --- <banner> ---` section of scripts/test.sh that holds the assertion this
# mutation targets. Running only that section takes seconds.
#
# WHAT A SCOPE COSTS, said plainly: `test.sh --only` is documented as an accelerator and NOT the
# gate, because a subset can miss an assertion elsewhere that would also have gone red. For mutation
# testing that trade is the right way round — the question here is "can the assertion written for
# this behaviour go red", which is precisely a question about ONE section. What a scope can hide is
# the "CAUGHT, but not by its own assertion" verdict, since the other section that would have caught
# it is not running. `--full-suite` turns scopes off, and the nightly full run uses it.
run_suite() {
  if [ -n "${2:-}" ]; then
    ( cd "$WORK" && sh scripts/test.sh --only "$2" ) >"$1" 2>&1
  else
    ( cd "$WORK" && sh scripts/test.sh ) >"$1" 2>&1
  fi
  awk 'match($0, /[0-9]+ passed, [0-9]+ failed/) {
         split(substr($0, RSTART, RLENGTH), a, " "); n = a[3]
       }
       END { print (n == "" ? "?" : n) }' "$1"
}

# A scope needs its OWN green baseline before any verdict from it can be believed. Sections inherit
# setup from earlier ones, so a subset can fail for want of a fixture rather than for want of
# correctness — test.sh says so on every `--only` invocation. If the scoped baseline is not green,
# this falls back to the full suite for that mutation and SAYS SO: a scoped run on a red baseline
# would report CAUGHT for every mutation and prove nothing.
#
# Echoes the scope to use (possibly empty, meaning "full suite").
scope_baseline() {
  _scope="$1"
  [ -n "$_scope" ] || { echo ""; return 0; }
  _key=$(printf '%s' "$_scope" | tr -c 'A-Za-z0-9' '-')
  _log="$WORK/baseline-$_key.log"
  if [ ! -f "$_log" ]; then
    _f=$(run_suite "$_log" "$_scope")
    if [ "$_f" != "0" ]; then
      printf '%s' "FALLBACK" > "$WORK/scope-$_key.verdict"
    else
      printf '%s' "OK" > "$WORK/scope-$_key.verdict"
    fi
  fi
  if [ "$(cat "$WORK/scope-$_key.verdict")" = "OK" ]; then echo "$_scope"; else echo ""; fi
}
suite_passed() {
  awk 'match($0, /[0-9]+ passed, [0-9]+ failed/) { split(substr($0, RSTART, RLENGTH), a, " "); n = a[1] }
       END { print (n == "" ? "?" : n) }' "$1"
}

echo "MUTATION TESTING"
echo "  repo: $REPO"
echo "  copy: $WORK"
echo

# --- select FIRST, so the baseline can be sized to what was actually asked for -------------------
catalogue_tsv > "$WORK/cat.txt"
TOTAL=$(grep -c . "$WORK/cat.txt")

if [ -n "$ONLY" ]; then
  grep -E "$ONLY_RE" "$WORK/cat.txt" > "$WORK/sel.txt"
elif [ -n "$SAMPLE" ]; then
  # Spread across the catalogue rather than taking the first N: consecutive entries share target
  # files, and a sample that only ever probes one script tells CI nothing about the rest.
  awk -v n="$SAMPLE" -v total="$TOTAL" '
    BEGIN { if (n > total) n = total; step = total / n; at = 1 }
    { if (taken < n && NR >= at - 0.0001) { print; taken++; at += step } }
  ' "$WORK/cat.txt" > "$WORK/sel.txt"
else
  cp "$WORK/cat.txt" "$WORK/sel.txt"
fi
SELECTED=$(grep -c . "$WORK/sel.txt")

if [ "$FULL_SUITE" != "1" ]; then
  while IFS="$TAB" read -r id file old new expect scope; do
    [ -n "$scope" ] || scope=$(derive_scope "$expect")
    printf "%s$TAB%s$TAB%s$TAB%s$TAB%s$TAB%s\n" "$id" "$file" "$old" "$new" "$expect" "$scope"
  done < "$WORK/sel.txt" > "$WORK/sel.scoped" && mv "$WORK/sel.scoped" "$WORK/sel.txt"
fi

# THE FULL BASELINE IS SKIPPED WHEN EVERY SELECTED MUTATION IS SCOPED, and that is the whole speed
# win. `--only M30` used to cost two full suites — one baseline, one mutated — for a verdict about a
# single refusal in one file. With a scope, both runs are that section and the answer arrives in
# seconds. The moment ONE selected mutation has no scope, the full baseline runs as before: a
# mutation compared against a baseline nobody established is not a verdict.
UNSCOPED=$(awk -F"$TAB" '$6 == "" { n++ } END { print n + 0 }' "$WORK/sel.txt")
[ "$FULL_SUITE" = "1" ] && UNSCOPED=$SELECTED

if [ "$UNSCOPED" -gt 0 ]; then
  printf 'baseline (unmutated suite) ... '
  BASE_FAIL=$(run_suite "$WORK/baseline.log")
  if [ "$BASE_FAIL" != "0" ]; then
    echo "NOT GREEN"
    echo
    echo "CANNOT RUN: the suite reports $BASE_FAIL failure(s) before any mutation is applied."
    echo "Every mutation would then read as CAUGHT for the wrong reason. Fix the suite first."
    tail -n 20 "$WORK/baseline.log"
    RC=2; exit 2
  fi
  echo "green — $(suite_passed "$WORK/baseline.log") assertions"
else
  echo "baseline: per-scope only — every selected mutation names the test.sh section that must go red."
  echo "  The whole suite is NOT the baseline for this run. Each scope is green-checked on its own"
  echo "  before its mutation is applied, and a scope that is not green falls back to the full suite."
  echo "  \`--full-suite\` forces the old behaviour; the nightly full catalogue uses it."
fi
echo

CAUGHT=0
SURVIVED=0
SURVIVORS=""
BLIND=""
I=0

while IFS="$TAB" read -r id file old new expect scope <&3; do
  [ -n "$id" ] || continue
  I=$((I + 1))
  printf '[%d/%d] %-5s %s\n' "$I" "$SELECTED" "$id" "$file"

  # RESOLVE THE BASELINE BEFORE THE MUTATION IS APPLIED, NOT AFTER.
  #
  # This block sat below the substitution, so `scope_baseline` ran against the ALREADY-MUTATED copy
  # and every scope reported "not green" — correctly, because the mutation was in it. The fallback
  # then ran the full suite on the same mutated tree, found it red too, and reported CANNOT RUN.
  # A baseline measured after the change is not a baseline; it is the change.
  #
  # Caught by reproducing the copy by hand and finding it green, which is the only reason the
  # difference was visible at all: the tool was reporting a defect in the repo that was a defect in
  # the tool. Scope results are cached per scope, so this costs one scoped run per distinct scope.
  [ "$FULL_SUITE" = "1" ] && scope=""
  USE_SCOPE=$(scope_baseline "$scope")
  if [ -n "$scope" ] && [ -z "$USE_SCOPE" ]; then
    echo "        NOTE: the scope '$scope' is not green on its own, so this mutation is judged"
    echo "        against the WHOLE suite instead. A scoped verdict on a red scope proves nothing."
    if [ ! -f "$WORK/baseline.log" ]; then
      BASE_FAIL=$(run_suite "$WORK/baseline.log")
      [ "$BASE_FAIL" = "0" ] || { echo "        CANNOT RUN: the full suite is not green either ($BASE_FAIL failing)."; RC=2; exit 2; }
    fi
  fi
  [ -n "$USE_SCOPE" ] && printf '        scope: %s\n' "$USE_SCOPE"

  src="$REPO/$file"
  dst="$WORK/$file"
  [ -f "$src" ] || { echo "        CANNOT RUN: no such file: $file"; RC=2; exit 2; }

  # Literal, first-occurrence substitution. Passed through the ENVIRONMENT, not `awk -v`, because
  # -v processes backslash escapes — it would turn the `\d` in M06's pattern into a bare `d` and
  # quietly mutate the mutation. Every occurrence is counted so a drifted anchor is loud rather
  # than a phantom survivor.
  MUT_OLD="$old" MUT_NEW="$new" awk '
    BEGIN { old = ENVIRON["MUT_OLD"]; new = ENVIRON["MUT_NEW"]; n = 0; done = 0 }
    {
      rest = $0
      while ((i = index(rest, old)) > 0) { n++; rest = substr(rest, i + length(old)) }
      if (!done) {
        i = index($0, old)
        if (i > 0) { $0 = substr($0, 1, i - 1) new substr($0, i + length(old)); done = 1 }
      }
      print
    }
    END { exit (n == 1 ? 0 : (n == 0 ? 3 : 4)) }
  ' "$src" > "$dst.mut"
  arc=$?
  if [ "$arc" = "3" ]; then
    echo "        CANNOT RUN: the anchor for $id no longer appears in $file."
    echo "        Fix the catalogue entry. An unanchored mutation proves nothing."
    rm -f "$dst.mut"; RC=2; exit 2
  elif [ "$arc" = "4" ]; then
    echo "        CANNOT RUN: the anchor for $id appears more than once in $file."
    echo "        Make it unique. Mutating an arbitrary one of several sites proves nothing."
    rm -f "$dst.mut"; RC=2; exit 2
  fi
  mv "$dst.mut" "$dst"

  fails=$(run_suite "$WORK/run-$id.log" "$USE_SCOPE")
  grep '^  FAIL  ' "$WORK/run-$id.log" | sed 's/^  FAIL  //' > "$WORK/labels-$id.txt"

  # Unconditional restore, whatever the verdict was.
  cp "$src" "$dst"

  if [ "$fails" = "?" ]; then
    echo "        CANNOT RUN: the suite printed no 'N passed, M failed' line under $id."
    echo "        It crashed rather than failing, and a crash is not a verdict."
    tail -n 10 "$WORK/run-$id.log" | sed 's/^/        /'
    RC=2; exit 2
  elif [ "$fails" = "0" ]; then
    SURVIVED=$((SURVIVED + 1))
    SURVIVORS="$SURVIVORS$id|$file|$expect
"
    echo "        SURVIVED — the suite stayed green with this gate broken"
    echo "        should have failed: $expect"
  else
    CAUGHT=$((CAUGHT + 1))
    if grep -qF -- "$expect" "$WORK/labels-$id.txt"; then
      echo "        CAUGHT ($fails assertions)"
    else
      BLIND="$BLIND$id|$expect
"
      echo "        CAUGHT ($fails assertions) — but NOT by the assertion written for it"
      echo "        expected: $expect"
      printf '        actual:   %s\n' "$(head -n 1 "$WORK/labels-$id.txt")"
    fi
  fi
  echo
done 3< "$WORK/sel.txt"

# ---------------------------------------------------------------------------------------------
echo "─────────────────────────────────────────"
echo "MUTATION SCORE: $CAUGHT/$SELECTED caught"
[ "$SELECTED" != "$TOTAL" ] && echo "  ($SELECTED of $TOTAL catalogued mutations — a sample, not the whole of it)"
echo
echo "Denominator: $SELECTED mutations over $(cut -d "$TAB" -f2 "$WORK/sel.txt" | sort -u | grep -c .) file(s)."
echo "It EXCLUDES the following, which cannot be mutation-tested on this host:"
excluded | awk '{ gsub(/@@/, "\037"); print }' | while IFS="$TAB" read -r what why; do
  printf '  · %s\n      %s\n' "$what" "$why"
done
echo "  Those assertions are UNPROVEN here. The score does not claim otherwise."
echo

if [ -n "$BLIND" ]; then
  echo "CAUGHT BY THE WRONG ASSERTION — the guard written for this behaviour stayed green:"
  printf '%s' "$BLIND" | while IFS='|' read -r id expect; do
    [ -n "$id" ] && printf '  %s  %s\n' "$id" "$expect"
  done
  echo "  Not a hole today — the suite noticed. But that assertion is decorative, and the next"
  echo "  refactor that touches the unrelated one takes the coverage with it."
  echo
fi

if [ "$SURVIVED" -gt 0 ]; then
  echo "SURVIVORS — $SURVIVED gate(s) can be broken without this suite noticing:"
  printf '%s' "$SURVIVORS" | while IFS='|' read -r id file expect; do
    [ -n "$id" ] && printf '  %s  %s\n        should have failed: %s\n' "$id" "$file" "$expect"
  done
  echo
  echo "Each is an assertion that cannot go red. Re-run one with:  sh scripts/mutate.sh --only <id>"
  RC=1
else
  echo "Every mutation applied was caught. These gates bite."
  RC=0
fi

exit "$RC"
