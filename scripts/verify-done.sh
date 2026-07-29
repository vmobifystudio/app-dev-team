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
#   scripts/verify-done.sh <branch> [base] [test-command]
#
# Examples:
#   scripts/verify-done.sh feat/APP-001-login
#   scripts/verify-done.sh feat/APP-001-login main "./gradlew test"
#
# Exit codes:
#   0  claim verified (see "tests=" in the output for whether tests were actually run)
#   1  claim rejected — do not move the board row to review
#   2  usage error / not a git repository

set -u

BRANCH="${1:-}"
BASE="${2:-main}"
TEST_CMD="${3:-}"

if [ -z "$BRANCH" ]; then
  echo "verify-done: usage: verify-done.sh <branch> [base] [test-command]" >&2
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
if [ -n "$TEST_CMD" ]; then
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
    if ( cd "$RUN_DIR" && sh -c "$TEST_CMD" ) >/dev/null 2>&1; then
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
