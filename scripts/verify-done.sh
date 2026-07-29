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
#   scripts/verify-done.sh [--docs-only] <branch> [base] [test-command]
#
# Examples:
#   scripts/verify-done.sh feat/APP-001-login
#   scripts/verify-done.sh feat/APP-001-login main "./gradlew test"
#   scripts/verify-done.sh --docs-only docs/APP-007-flows
#   scripts/verify-done.sh docs/APP-007-flows main --docs-only   (same thing — any position)
#
# --docs-only: the ticket's deliverable is a document, not code. Branch, commits and changed files
# are still verified; the test command is not required and is not run. ux-designer, qa-engineer,
# aso-specialist and data-analyst own tickets that produce a document and no test — without this
# flag their DONE was structurally un-passable, so the loop either re-spawned them forever or
# skipped verification for them entirely.
#
# Exit codes:
#   0  claim verified (see "tests=" in the output for whether tests were actually run)
#   1  claim rejected — do not move the board row to review
#   2  usage error / not a git repository

set -u

# --docs-only is accepted in ANY position. It was accepted only as $1, while the contract in
# skills/team-protocol/SKILL.md is the trailing form `<branch> <base> --docs-only` — so the flag
# landed in $3, was taken as the TEST COMMAND, and was executed: `sh: --: invalid option`, exit 1,
# REJECTED. A doc ticket failed a "test" that was the flag exempting it from tests, and it failed
# looking legitimate, so the loop would re-spawn the developer forever. Two correct halves written
# independently, disagreeing at the interface. Position-independent parsing is the fix; moving the
# check to $3 would just relocate the seam.
DOCS_ONLY=0
ARGC=$#
i=0
while [ "$i" -lt "$ARGC" ]; do
  i=$((i + 1))
  arg="$1"; shift
  if [ "$arg" = "--docs-only" ]; then DOCS_ONLY=1; else set -- "$@" "$arg"; fi
done

BRANCH="${1:-}"
BASE="${2:-main}"
TEST_CMD="${3:-}"

if [ -z "$BRANCH" ]; then
  echo "verify-done: usage: verify-done.sh [--docs-only] <branch> [base] [test-command]" >&2
  exit 2
fi

if [ "$DOCS_ONLY" -eq 1 ] && [ -n "$TEST_CMD" ]; then
  echo "verify-done: --docs-only takes no test command (got '$TEST_CMD')." >&2
  echo "  A docs ticket that does have a test is not a docs ticket — drop the flag." >&2
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
TESTS_STATUS="unverified"
[ "$DOCS_ONLY" -eq 1 ] && TESTS_STATUS="n/a (docs-only)"

if [ "$DOCS_ONLY" -eq 0 ] && [ -n "$TEST_CMD" ]; then
  # Locate a worktree holding this branch. `git worktree list --porcelain` emits, per worktree:
  #   worktree <path>\n ... \n branch refs/heads/<name>
  WT=$(git worktree list --porcelain 2>/dev/null | awk -v b="refs/heads/$BRANCH" '
    /^worktree /{ path = substr($0, 10) }
    $0 == "branch " b { print path; exit }')

  CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  RUN_DIR=""
  SWITCHED=0

  if [ -n "$WT" ]; then
    RUN_DIR="$WT"
    echo "verify-done: $BRANCH is checked out at $WT — running tests there (no checkout)." >&2
  elif [ "$CURRENT" = "$BRANCH" ]; then
    RUN_DIR="."
  elif git checkout --quiet "$BRANCH" 2>/dev/null; then
    RUN_DIR="."
    SWITCHED=1
  else
    fail "could not reach $BRANCH to run tests: it is not in a worktree and could not be checked out (uncommitted changes?)."
  fi

  if [ -z "$FAILURES" ]; then
    echo "verify-done: running tests on $BRANCH: $TEST_CMD" >&2
    # Capture, never discard. The verdict below tells the loop to "re-spawn the developer with
    # these failures verbatim" — and the output went to /dev/null, so there were no verbatim
    # failures to hand over. The re-spawned developer was told only that something failed, and
    # guessed at what; an instruction that cannot be followed is the same defect class as a gate
    # that cannot fail.
    TEST_LOG=$(mktemp)
    trap 'rm -f "$TEST_LOG"' EXIT INT TERM
    if ( cd "$RUN_DIR" && sh -c "$TEST_CMD" ) >"$TEST_LOG" 2>&1; then
      TESTS_STATUS="green"
    else
      TESTS_STATUS="failing"
      fail "test command exited non-zero: $TEST_CMD"
    fi
  fi

  [ "$SWITCHED" -eq 1 ] && git checkout --quiet "$CURRENT" 2>/dev/null
fi

# --- verdict --------------------------------------------------------------------------------------
if [ -n "$FAILURES" ]; then
  echo "REJECTED: $BRANCH"
  echo "Blocking:"
  printf '%s' "$FAILURES"
  if [ "$TESTS_STATUS" = "failing" ] && [ -s "${TEST_LOG:-}" ]; then
    echo "Test output (last 30 lines of: $TEST_CMD):"
    tail -n 30 "$TEST_LOG" | sed 's/^/  | /'
  fi
  echo "Next: re-spawn the developer with these failures verbatim. Do not move the board row to review."
  exit 1
fi

echo "VERIFIED: $BRANCH"
echo "  base=$BASE commits=$COMMITS files=$FILES_CHANGED tests=$TESTS_STATUS"
if [ "$TESTS_STATUS" = "unverified" ]; then
  echo "  NOTE: no test command was supplied, so 'tests: all green' in the DONE report is unproven."
  echo "        Pass the project's test command as the 3rd argument to close that gap."
fi
echo "Next: move the board row to review and spawn the code-reviewer."
exit 0
