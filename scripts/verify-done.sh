#!/bin/sh
# verify-done — check a developer agent's "DONE: APP-NNN" claim against the repository.
#
# A developer agent reports "DONE / Branch / Files / Tests: N added, all green". Nothing in the
# sprint loop ever checked that claim: the branch might not exist, the commits might not be there,
# and the tests might never have run. tech-manager then merges on a reviewer's APPROVED, which is
# itself a self-report about a self-report.
#
# This script makes the claim falsifiable. It is pure POSIX sh + git — no Node, no dependencies.
#
# Usage:
#   scripts/verify-done.sh [--docs-only|--static] <branch> [base] [test-command]
#
# Examples:
#   scripts/verify-done.sh feat/APP-001-login
#   scripts/verify-done.sh feat/APP-001-login main "./gradlew test"
#   scripts/verify-done.sh --docs-only docs/APP-007-flows
#   scripts/verify-done.sh docs/APP-007-flows main --docs-only   (same thing — any position)
#
# --docs-only: the ticket's deliverable is a document, not code. Branch, commits and changed files
# are still verified; the test command is not required and is not run. ux-architect, product-designer,
# product-manager, product-researcher, qa-engineer,
# aso-specialist and data-analyst own tickets that produce a document and no test — without this
# flag their DONE was structurally un-passable, so the loop either re-spawned them forever or
# skipped verification for them entirely.
#
# Exit codes — and the headline word on line 1 always matches the code, because the only thing an
# agent reliably reads is line 1. It used to print "VERIFIED:" while exiting 2 for "tests never ran".
#   0  VERIFIED       — claim verified AND the tests were settled: they ran green, or --docs-only
#                       exempted them. A stated exemption is a decision; it is not an unknown.
#   1  REJECTED       — the claim is false, or a test RAN and FAILED. Its instruction is "re-spawn
#                       the developer with these failures verbatim", so it must never be reached by
#                       anything but a real defect.
#   2  CANNOT EVALUATE — usage error, not a git repository, no test command for a code ticket, or
#                       the test command could not be EXECUTED (missing toolchain, missing SDK,
#                       missing gradle wrapper, command not found).
#
# The 1/2 split is the whole point of this rewrite. Running the test string and branching on
# zero/non-zero made a MISSING TOOLCHAIN indistinguishable from a FAILING TEST — observed live: a
# host with no Xcode produced "1 REJECTED", which sent a developer to fix a bug that did not exist.
# `runtime-gate` has distinguished UNKNOWN from FAIL since it was written; this now does too.
#
# The tie-break is deliberately asymmetric: when the output does not prove a suite actually ran,
# this reports 2, not 1. A false REJECTED costs a developer a phantom hunt and looks legitimate the
# whole way; a false CANNOT EVALUATE costs one human question. Given the choice, stop and ask.

set -u

# --docs-only is accepted in ANY position. It was accepted only as $1, while the contract in
# skills/team-protocol/SKILL.md is the trailing form `<branch> <base> --docs-only` — so the flag
# landed in $3, was taken as the TEST COMMAND, and was executed: `sh: --: invalid option`, exit 1,
# REJECTED. A doc ticket failed a "test" that was the flag exempting it from tests, and it failed
# looking legitimate, so the loop would re-spawn the developer forever. Two correct halves written
# independently, disagreeing at the interface. Position-independent parsing is the fix; moving the
# check to $3 would just relocate the seam.
#
# `--static` is parsed the same way and for the same reason. It is the per-ticket lane of the WAVE
# INTEGRATION model (OPS-003, docs/reviews/2026-08-07-adversarial-operations-review.md): the branch
# half of the claim is checked here, cheaply and with no toolchain, and the executable suite runs
# ONCE for the whole wave in `wave-integrate.mjs` instead of once per ticket in a cold worktree.
#
# It deliberately exits 2, not 0. The tests genuinely have not run, so the honest word is CANNOT
# EVALUATE and the honest board event is `verified_static` — which already refuses `closed` and
# already blocks `ship-gate.sh`. `wave-integrate.mjs` is then what earns the real `verified`
# (legal from `qa` precisely so a static verification can be upgraded, lib/events.mjs legalEvents).
# No new event, no schema change, and no path from "nothing ran" to a green.
DOCS_ONLY=0
STATIC=0
ARGC=$#
i=0
while [ "$i" -lt "$ARGC" ]; do
  i=$((i + 1))
  arg="$1"; shift
  case "$arg" in
    --docs-only) DOCS_ONLY=1 ;;
    --static)    STATIC=1 ;;
    *)           set -- "$@" "$arg" ;;
  esac
done

BRANCH="${1:-}"
BASE="${2:-main}"
TEST_CMD="${3:-}"

if [ -z "$BRANCH" ]; then
  echo "verify-done: usage: verify-done.sh [--docs-only|--static] <branch> [base] [test-command]" >&2
  echo "  test-command may be the literal word 'fast' or 'full' to take it from the project" >&2
  echo "  profile (docs/team/project-profile.json) instead of hardcoding one here." >&2
  exit 2
fi

# `fast` / `full` RESOLVE FROM THE PROJECT PROFILE (F6) RATHER THAN BEING HARDCODED PER CALLER.
#
# This script ran ONE test command per ticket — whatever the caller passed, which in practice was
# the whole suite, every time. A one-line ticket paid for the full matrix. The profile declares both
# scopes so the loop can spend proportionally: `fast` per ticket, `full` at merge and before ship.
#
# NOTHING IS SUBSTITUTED WHEN THE PROFILE IS SILENT. project-profile.mjs exits 2 for an undeclared
# scope and this passes that straight through, because a default test command would make "the tests
# ran" true of a command nobody chose — the same class as an evidence-optional pass.
_scope=""
case "$TEST_CMD" in
  fast|full)
    _scope="$TEST_CMD"
    _resolved=$(node "$(dirname "$0")/project-profile.mjs" test-command --scope "$_scope" 2>&1)
    if [ $? -ne 0 ]; then
      echo "verify-done: CANNOT EVALUATE — asked for the '$_scope' test command, and:" >&2
      echo "$_resolved" | sed 's/^/  /' >&2
      exit 2
    fi
    TEST_CMD="$_resolved"
    echo "verify-done: test scope '$_scope' resolved from the project profile: $TEST_CMD" >&2
    ;;
esac

if [ "$DOCS_ONLY" -eq 1 ] && [ -n "$TEST_CMD" ]; then
  echo "verify-done: --docs-only takes no test command (got '$TEST_CMD')." >&2
  echo "  A docs ticket that does have a test is not a docs ticket — drop the flag." >&2
  exit 2
fi

if [ "$STATIC" -eq 1 ] && [ -n "$TEST_CMD" ]; then
  echo "verify-done: --static takes no test command (got '$TEST_CMD')." >&2
  echo "  --static means the suite runs ONCE for the wave, in wave-integrate.mjs. Passing a command" >&2
  echo "  here would run it per ticket, which is the cost --static exists to remove." >&2
  exit 2
fi

if [ "$STATIC" -eq 1 ] && [ "$DOCS_ONLY" -eq 1 ]; then
  echo "verify-done: --static and --docs-only are mutually exclusive." >&2
  echo "  A docs ticket has no executable suite to defer; --docs-only already settles the tests as" >&2
  echo "  n/a, which is a decision. --static records that they are still owed. Pick one." >&2
  exit 2
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "verify-done: not a git repository" >&2
  exit 2
fi

FAILURES=""
fail() {
  FAILURES="${FAILURES}  - $1
"
}

# --- 1. the branch exists ---------------------------------------------------------------------
if git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null 2>&1; then
  RESOLVED="refs/heads/$BRANCH"
elif git rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null 2>&1; then
  RESOLVED="refs/remotes/origin/$BRANCH"
else
  echo "REJECTED: $BRANCH"
  echo "Blocking:"
  echo "  - branch does not exist locally or on origin. The DONE claim is unsupported."
  echo "Next: re-spawn the developer — the work was never committed to a branch."
  exit 1
fi

# --- 2. the base exists, so the comparison is meaningful ---------------------------------------
if ! git rev-parse --verify --quiet "$BASE" >/dev/null 2>&1; then
  if git rev-parse --verify --quiet "origin/$BASE" >/dev/null 2>&1; then
    BASE="origin/$BASE"
  else
    echo "verify-done: base branch '$BASE' not found" >&2
    exit 2
  fi
fi

# --- 3. there are commits on the branch that are not on base -----------------------------------
COMMITS=$(git rev-list --count "$BASE..$RESOLVED" 2>/dev/null || echo 0)
if [ "$COMMITS" -eq 0 ]; then
  fail "no commits on $BRANCH that are not already on $BASE — nothing was actually written."
fi

# --- 4. the commits changed files ---------------------------------------------------------------
FILES_CHANGED=$(git diff --name-only "$BASE...$RESOLVED" 2>/dev/null | grep -c . || true)
if [ "${FILES_CHANGED:-0}" -eq 0 ]; then
  fail "the branch changes no files relative to $BASE."
fi

# --- 5. tests ------------------------------------------------------------------------------------
# The agent-isolation skill gives every writing agent its own git worktree, so the branch under
# test is normally ALREADY checked out somewhere else. `git checkout <branch>` then fails with
# "already checked out at ...", which would reject every honest DONE and send the loop re-spawning
# developers until the spawn budget trips. Run the tests where the branch actually lives.
#
# TESTS_STATUS is one of: unverified · n/a (docs-only) · green · failing · cannot-run
# The last two are the DR4-001 split, and CANNOT_EVAL_WHY records which one was decided and why.
TESTS_STATUS="unverified"
CANNOT_EVAL_WHY=""
[ "$DOCS_ONLY" -eq 1 ] && TESTS_STATUS="n/a (docs-only)"
[ "$STATIC" -eq 1 ] && TESTS_STATUS="deferred-to-wave"

# THE CACHES MUST BE PINNED BEFORE THE TEST COMMAND IS BUILT, NOT AFTER IT RUNS.
#
# The command below executes in `$RUN_DIR`, which is either a per-round agent worktree or a
# throwaway `mktemp -d` this script deletes on exit. Both are cold, and the second is cold FOREVER
# — whatever it warms up dies with the trap. Sourcing this exports GRADLE_USER_HOME,
# SWIFTPM_CACHE_PATH and STUDIO_DERIVED_DATA at the MAIN checkout's `.studio-cache/`, so the
# subshell inherits them and the second ticket of a round compiles against the first one's cache.
# See OPS-003; `build-env.sh --check` says honestly which of the three the project actually uses.
. "$(dirname "$0")/build-env.sh"

# Did the test command FAIL, or did it never actually RUN — and on exit 0, did it run at least
# one test? ONE definition, shared with wave-integrate.mjs: scripts/lib/test-evidence.mjs (its
# header has the order of the three questions, and why GREEN is stricter than FAILING: a bare
# keyword or "Executed 0 tests" is never green — G-F5). The two copies of this regex had drifted,
# and each new test runner (H7 node --test, H9 AGP) had to be found twice, once per copy.
#
# Sets TESTS_STATUS (green | failing | cannot-run) and CANNOT_EVAL_WHY. Called on BOTH exit paths
# with $TEST_RC: a zero exit is evidence that nothing errored, never evidence that a suite ran.

# One trap, for the test log. (The temporary worktree the suite runs in is lib/evidence.mjs's now —
# design E: it makes and removes a fresh detached worktree of the exact tip itself.)
TEST_LOG=""
EVIDENCE=""
EV="$(dirname "$0")/lib/evidence.mjs"
# The ticket id, for the next-step commands this prints — as the BOARD spells it, and the LONGEST
# board id the branch is named for (C3G-9 / FB5): feat/APP-001-analytics-x is APP-001-analytics's
# when that ticket exists, and BUG-001-fix is not BUG-001. With no board (or no match), the first
# ID-shaped token, either case.
TICKET_ID=$(node "$EV" ticket-for --branch "$BRANCH" 2>/dev/null || true)
[ -n "$TICKET_ID" ] || TICKET_ID=$(printf '%s' "$BRANCH" | grep -oiE '[A-Z][A-Z0-9]*-[0-9]+(-w[0-9]+)?' | head -n 1)
[ -n "$TICKET_ID" ] || TICKET_ID='<ID>'
# W2-10: every printed board command carries the inline-mint --token when the project requires
# tokens — a shell variable minted in one Bash call does not survive to the next.
TOKFLAG=$(node "$EV" token-flag --role tech-manager --ticket "$TICKET_ID" 2>/dev/null || true)
cleanup() {
  [ -n "$TEST_LOG" ] && rm -f "$TEST_LOG"
  return 0
}
trap cleanup EXIT INT TERM

if [ "$DOCS_ONLY" -eq 0 ] && [ -n "$TEST_CMD" ] && [ -z "$FAILURES" ]; then
  # Say, once per run, whether the caches this script just pinned actually apply to THIS command.
  # An exported variable the project's own test command ignores is a saving nobody made, and
  # silently believing in it is the shape of defect this repository keeps re-finding.
  sh "$(dirname "$0")/build-env.sh" --check "$TEST_CMD" >&2 || true
  echo "verify-done: running tests on $BRANCH, in a fresh detached worktree of its tip: $TEST_CMD" >&2
  # NEVER `git checkout` here, and never run in the developer's tree (C3G-7, design E): a shared
  # tree carries other agents' files, and any tree carries skip-worktree / assume-unchanged bits and
  # untracked files the commit does not contain. lib/evidence.mjs runs the suite in a worktree made
  # for this run from exactly the tip.
  # Capture, never discard: the verdict below tells the loop to "re-spawn the developer with these
  # failures verbatim", and needs them.
  # G2-2: lib/evidence.mjs RUNS the command and records its own exit code and output — there is
  # no path where this script reports an outcome for the record to copy. The verdict below is the
  # record's own (the shared classifier), and the census of the changed test files rides on it.
  # The SAME question on both branches: a zero exit is evidence that nothing errored, never
  # evidence that a suite ran. Ran-evidence decides both directions.
  TEST_LOG=$(mktemp)
  if [ -n "$_scope" ]; then
    _evj=$(node "$EV" test --branch "$RESOLVED" --base "$BASE" --scope "$_scope" 2>"$TEST_LOG")
  else
    _evj=$(node "$EV" test --branch "$RESOLVED" --base "$BASE" --command "$TEST_CMD" 2>"$TEST_LOG")
  fi
  if [ $? -ne 0 ] || [ -z "$_evj" ]; then
    TESTS_STATUS="cannot-run"
    CANNOT_EVAL_WHY="the evidence writer could not run the suite: $(tr '\n' ' ' < "$TEST_LOG")"
  else
    _ef() { node -e 'const r = JSON.parse(process.argv[1]); const v = process.argv[2].split(".").reduce((o, k) => (o == null ? o : o[k]), r); process.stdout.write(v == null ? "" : String(v));' "$_evj" "$1"; }
    TESTS_STATUS=$(_ef verdict); CANNOT_EVAL_WHY=$(_ef why); TEST_RC=$(_ef exit); EVIDENCE=$(_ef record)
    cp "$(_ef log)" "$TEST_LOG" 2>/dev/null || :
    case "$TESTS_STATUS" in green|failing|cannot-run) ;; *) TESTS_STATUS="cannot-run"; CANNOT_EVAL_WHY="the classifier returned no verdict" ;; esac
    # G2-22: a GREEN run whose changed tests assert nothing is not evidence the code works. Not a
    # REJECTED — the census is a heuristic, and a false REJECTED sends a developer on a phantom hunt.
    if [ "$TESTS_STATUS" = green ] && [ "$(_ef census.assert_nothing)" = true ]; then
      TESTS_STATUS="cannot-run"
      CANNOT_EVAL_WHY="the suite ran green, but the test files this branch adds or changes declare $(_ef census.tests) test(s) and ZERO assertions ($(_ef census.files)) — a suite that asserts nothing passes whatever the code does. Add assertions; the board refuses \`verified\` on this record"
    fi
    if [ "$TESTS_STATUS" = green ] && [ "$(_ef dirty)" = true ]; then
      TESTS_STATUS="cannot-run"
      CANNOT_EVAL_WHY="the suite changed tracked files (or HEAD) in its own fresh worktree while it ran, so what it tested is not $BRANCH's commit"
    fi
    # FB3: a green the BOARD will refuse is not VERIFIED. The command must be one the board froze
    # from the project profile (an identical explicit string counts — FB4); ask the same function.
    if [ "$TESTS_STATUS" = green ]; then
      _cc=$(node "$EV" check-command --record "$EVIDENCE" 2>&1)
      if [ $? -ne 0 ]; then
        TESTS_STATUS="cannot-run"
        CANNOT_EVAL_WHY="the suite ran green, but the board will refuse this record: $(printf '%s' "$_cc" | sed 's/^evidence: //' | tr '\n' ' ' | sed 's/[. ]*$//')"
      fi
    fi
  fi
fi

# --- verdict --------------------------------------------------------------------------------------
# Print the test log on any outcome that has one. Whichever verdict this is, the next actor's first
# question is "what did it actually say", and the only copy is in $TEST_LOG.
quote_test_output() {
  [ -s "${TEST_LOG:-}" ] || return 0
  echo "Test output (last 30 lines of: $TEST_CMD):"
  tail -n 30 "$TEST_LOG" | sed 's/^/  | /'
}

# 1. The CLAIM is false — the branch, the commits or the changed files do not support it.
if [ -n "$FAILURES" ]; then
  echo "REJECTED: $BRANCH"
  echo "Blocking:"
  printf '%s' "$FAILURES"
  echo "Next: re-spawn the developer with these failures verbatim. Do not move the board row to review."
  exit 1
fi

# 2. A suite RAN and REPORTED failures. The only path to "re-spawn the developer" that is about code.
if [ "$TESTS_STATUS" = "failing" ]; then
  echo "REJECTED: $BRANCH"
  echo "  base=$BASE commits=$COMMITS files=$FILES_CHANGED tests=failing"
  echo "Decided REJECTED, not CANNOT EVALUATE: the output shows a test suite that ran and reported"
  echo "  failures, so this is a defect in the code, not a problem with the machine."
  quote_test_output
  echo "Next: re-spawn the developer with these failures verbatim. Do not move the board row to review."
  exit 1
fi

# 3a. The suite was DELIBERATELY deferred to the wave. Distinct from `unverified` because the action
#     is different: nothing is missing, nothing is broken, and re-running this changes nothing.
if [ "$TESTS_STATUS" = "deferred-to-wave" ]; then
  echo "CANNOT EVALUATE: $BRANCH"
  echo "  base=$BASE commits=$COMMITS files=$FILES_CHANGED tests=deferred-to-wave"
  echo "  The branch, the commits and the changed files all check out. The executable suite has NOT"
  echo "  run — by design: --static defers it to the wave integration pass, which runs it ONCE on the"
  echo "  merged tree rather than once per ticket in a cold worktree."
  echo "  This is NOT a pass and NOT a rejection. Do not re-spawn the developer."
  STATIC_EV=$(node "$EV" static --branch "$RESOLVED" --base "$BASE" 2>/dev/null || true)
  [ -n "$STATIC_EV" ] && echo "  Evidence (static — what a reviewer binds to): $STATIC_EV"
  echo "Next: record the honest state, which unlocks review, approval and the merge gate:"
  echo "    node \"\${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs\" move $TICKET_ID verified_static --by tech-manager${STATIC_EV:+ --evidence $STATIC_EV} --detail \"deferred to wave integration\"$TOKFLAG"
  echo "  It refuses \`closed\` and blocks ship-gate until something runs the suite. That something is"
  echo "    node \"\${CLAUDE_PLUGIN_ROOT}/scripts/wave-integrate.mjs\" --root . --wave <N> --base $BASE"
  echo "  whose green full run is what earns the real \`verified\` for every ticket in the wave."
  exit 2
fi

# 3. The tests were never settled. The branch half of the claim IS verified — but the headline says
#    CANNOT EVALUATE, because an agent reads line 1 and acts on it, and this used to say VERIFIED.
if [ "$TESTS_STATUS" = "unverified" ] || [ "$TESTS_STATUS" = "cannot-run" ]; then
  echo "CANNOT EVALUATE: $BRANCH"
  echo "  base=$BASE commits=$COMMITS files=$FILES_CHANGED tests=$TESTS_STATUS"
  echo "  The branch, the commits and the changed files all check out. The test suite did NOT run,"
  echo "  so 'tests: all green' in the DONE report is unproven. This is NOT a pass and NOT a"
  echo "  rejection — do not re-spawn the developer, there is no failure to fix."
  if [ "$TESTS_STATUS" = "unverified" ]; then
    echo "  Why: no test command was supplied for a code ticket."
    echo "  Fix: pass the project's test command as the 3rd argument, or --docs-only if the ticket"
    echo "       genuinely produces a document and no test."
  else
    echo "  Why: $CANNOT_EVAL_WHY."
    quote_test_output
  fi
  STATIC_EV=$(node "$EV" static --branch "$RESOLVED" --base "$BASE" 2>/dev/null || true)
  [ -n "$STATIC_EV" ] && echo "  Evidence (static — what a reviewer binds to): $STATIC_EV"
  echo "Next: this ticket is INSPECTABLE BUT NOT RUNNABLE. Static review is still owed and still"
  echo "  possible — record it and let the code-reviewer work:"
  echo "    node \"\${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs\" move $TICKET_ID verified_static --by tech-manager${STATIC_EV:+ --evidence $STATIC_EV} --detail \"the executable test suite\"$TOKFLAG"
  echo "  That unlocks review, approval and merge, and refuses \`closed\` until the suite has run."
  exit 2
fi

# THE EVIDENCE RECORD (G-F4). `verified` on the board must cite what THIS script saw: the raw test
# log, its sha256, the exit code, the classifier's verdict and the exact head it ran on. The board
# re-hashes the log and re-runs the classifier over it, so "VERIFIED" pasted into --detail is no
# longer evidence of anything. Written only here, on the VERIFIED path.
HEAD_SHA=$(git rev-parse "$RESOLVED^{commit}")
if [ "$DOCS_ONLY" -eq 1 ]; then
  EVIDENCE=$(node "$EV" docs --branch "$RESOLVED" --base "$BASE" 2>&1) || {
    echo "CANNOT EVALUATE: $BRANCH"
    echo "  The claim checks out, but the evidence record could not be written: $EVIDENCE"
    echo "  Without it the board will not accept \`verified\`. Fix the write, re-run."
    exit 2
  }
fi

echo "VERIFIED: $BRANCH"
echo "  base=$BASE commits=$COMMITS files=$FILES_CHANGED tests=$TESTS_STATUS head=$HEAD_SHA"
echo "  Evidence: $EVIDENCE"
echo "Next: record it — node \"\${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs\" move $TICKET_ID verified --by tech-manager --evidence $EVIDENCE$TOKFLAG"
# C4W-9: a docs-only QA- ticket is reviewed INLINE by the orchestrator (design decision 1) — telling
# it to spawn the code-reviewer sent the QA pass down a path the board does not offer it.
case "$TICKET_ID" in
  [Qq][Aa]-*)
    if [ "$DOCS_ONLY" -eq 1 ]; then
      echo "  then read the QA diff yourself (docs-only QA ticket: reviewed inline, no code-reviewer) and merge it:"
      echo "    node \"\${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs\" move $TICKET_ID merged --by tech-manager$TOKFLAG"
    else
      echo "  This QA- ticket changed code, so it takes the normal path: move it to review and spawn the code-reviewer."
    fi ;;
  *) echo "  then move the board row to review and spawn the code-reviewer." ;;
esac
exit 0
