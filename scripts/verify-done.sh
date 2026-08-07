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

# Did the test command FAIL, or did it never actually RUN? The evidence is the output, and the
# order of these three questions is the decision.
#
# 1. An exit of 126/127 is the shell saying it could not execute the thing at all.
# 2. A toolchain/environment signature — `xcode-select: error: tool 'xcodebuild' requires Xcode`,
#    `command not found`, a missing SDK, a missing gradle wrapper — means nothing was exercised.
#    Checked BEFORE the ran-evidence patterns, because xcodebuild prints "** TEST FAILED **" when
#    it cannot find an SDK, and that string alone would read as a genuine test failure.
# 3. Only then, positive evidence that a suite ran and reported: the run happened, so exit 1 is a
#    real verdict about real code — and exit 0 is a real green.
# Anything else falls through to cannot-run. See the asymmetry note in the header.
#
# Returns 0 = "a suite demonstrably ran". Called on BOTH exit paths; the caller turns that into
# green or failing using $TEST_RC. It must never be consulted on one branch only.
classify_test_outcome() {
  if [ "$TEST_RC" -eq 127 ] || [ "$TEST_RC" -eq 126 ]; then
    CANNOT_EVAL_WHY="the test command exited $TEST_RC — the shell could not execute it at all"
    return 1
  fi
  if grep -Eqi 'command not found|: not found|no such file or directory|xcode-select: error|requires Xcode|xcrun: error|unable to find utility|cannot be located|[Uu]nable to find a destination|GradleWrapperMain|permission denied|not recognized as an internal' "$TEST_LOG"; then
    CANNOT_EVAL_WHY="the output names a missing or unusable toolchain, not a failing assertion"
    return 1
  fi
  if grep -Eqi 'test case|executed [0-9]+ test|tests? run:|[0-9]+ (test|assertion|example)s?[,.]? .*(fail|pass)|TEST FAILED|FAILED \(|assertion (failed|error)|expectation|[0-9]+ (passing|failing)|✗|✘' "$TEST_LOG"; then
    return 0
  fi
  CANNOT_EVAL_WHY="the output carries no evidence that a test suite ran at all (exit $TEST_RC, $(wc -l <"$TEST_LOG" | tr -d ' ') line(s) of output)"
  return 1
}

# ONE trap for both the temporary worktree and the test log. Two `trap ... EXIT` statements do not
# stack in POSIX sh — the second silently replaces the first — so the worktree would have been left
# behind the moment a test log was created.
TMP_WT=""
TEST_LOG=""
cleanup() {
  [ -n "$TEST_LOG" ] && rm -f "$TEST_LOG"
  if [ -n "$TMP_WT" ]; then
    git worktree remove --force "$TMP_WT" >/dev/null 2>&1
    git worktree prune >/dev/null 2>&1
    rm -rf "$TMP_WT"
  fi
  return 0
}
trap cleanup EXIT INT TERM

if [ "$DOCS_ONLY" -eq 0 ] && [ -n "$TEST_CMD" ]; then
  # Locate a worktree holding this branch. `git worktree list --porcelain` emits, per worktree:
  #   worktree <path>\n ... \n branch refs/heads/<name>
  WT=$(git worktree list --porcelain 2>/dev/null | awk -v b="refs/heads/$BRANCH" '
    /^worktree /{ path = substr($0, 10) }
    $0 == "branch " b { print path; exit }')

  CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  RUN_DIR=""

  if [ -n "$WT" ]; then
    RUN_DIR="$WT"
    echo "verify-done: $BRANCH is checked out at $WT — running tests there (no checkout)." >&2
  elif [ "$CURRENT" = "$BRANCH" ]; then
    RUN_DIR="."
  else
    # NEVER `git checkout` here. /app-build explicitly runs verification alongside still-running
    # developers, and the shared worktree is where those developers are writing. Checking out in
    # place did three wrong things at once: it rejected a valid DONE because someone else's files
    # were dirty, it carried those uncommitted files onto the branch under test so the tests were
    # not testing this branch, and it moved HEAD under an agent that was mid-edit. A throwaway
    # detached worktree is the branch's own tree and touches nobody else's.
    CANDIDATE=$(mktemp -d)
    rmdir "$CANDIDATE" 2>/dev/null   # `git worktree add` wants to create the directory itself
    if git worktree add --detach --quiet "$CANDIDATE" "$RESOLVED" 2>/dev/null; then
      TMP_WT="$CANDIDATE"            # only now is there something for the trap to clean up
      RUN_DIR="$TMP_WT"
      echo "verify-done: running tests in a temporary detached worktree at $TMP_WT." >&2
    else
      rm -rf "$CANDIDATE"
      # Not a REJECTED: the developer's claim is untouched by this repo's inability to make a
      # worktree. It is precisely a cannot-evaluate.
      TESTS_STATUS="cannot-run"
      CANNOT_EVAL_WHY="could not create a temporary worktree for $BRANCH, so the tests were never started"
    fi
  fi

  if [ -z "$FAILURES" ] && [ "$TESTS_STATUS" != "cannot-run" ]; then
    # Say, once per run, whether the caches this script just pinned actually apply to THIS command.
    # An exported variable the project's own test command ignores is a saving nobody made, and
    # silently believing in it is the shape of defect this repository keeps re-finding.
    sh "$(dirname "$0")/build-env.sh" --check "$TEST_CMD" >&2 || true
    echo "verify-done: running tests on $BRANCH: $TEST_CMD" >&2
    # Capture, never discard. The verdict below tells the loop to "re-spawn the developer with
    # these failures verbatim" — and the output went to /dev/null, so there were no verbatim
    # failures to hand over. The re-spawned developer was told only that something failed, and
    # guessed at what; an instruction that cannot be followed is the same defect class as a gate
    # that cannot fail.
    TEST_LOG=$(mktemp)
    # The SAME question on both branches. `classify_test_outcome` was consulted only when the
    # command FAILED; on exit 0 this wrote `green` unconditionally, so `verify-done.sh feat/X main
    # "true"` — and `"echo 'skipping tests'"` — printed `VERIFIED ... tests=green`. Rigorous when
    # the command fails and credulous when it succeeds is backwards for a gate, and it is the purest
    # green-while-nothing-happened case in the repo: a zero exit is evidence that nothing errored,
    # never evidence that a suite ran. Ran-evidence decides both directions; the exit code only
    # decides which verdict a suite that DID run gets.
    if ( cd "$RUN_DIR" && sh -c "$TEST_CMD" ) >"$TEST_LOG" 2>&1; then
      TEST_RC=0
      if classify_test_outcome; then TESTS_STATUS="green"; else TESTS_STATUS="cannot-run"; fi
    else
      TEST_RC=$?
      if classify_test_outcome; then TESTS_STATUS="failing"; else TESTS_STATUS="cannot-run"; fi
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
  echo "Next: record the honest state, which unlocks review, approval and the merge gate:"
  echo "    board.mjs move <ID> verified_static --by tech-manager --detail \"deferred to wave integration\""
  echo "  It refuses \`closed\` and blocks ship-gate until something runs the suite. That something is"
  echo "    node scripts/wave-integrate.mjs --root . --wave <N> --base $BASE"
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
  echo "Next: this ticket is INSPECTABLE BUT NOT RUNNABLE. Static review is still owed and still"
  echo "  possible — record it and let the code-reviewer work:"
  echo "    board.mjs move <ID> verified_static --by tech-manager --detail \"the executable test suite\""
  echo "  That unlocks review, approval and merge, and refuses \`closed\` until the suite has run."
  exit 2
fi

echo "VERIFIED: $BRANCH"
echo "  base=$BASE commits=$COMMITS files=$FILES_CHANGED tests=$TESTS_STATUS"
echo "Next: move the board row to review and spawn the code-reviewer."
exit 0
