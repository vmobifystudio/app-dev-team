#!/bin/sh
# integration-branch — resolve the branch that feature work integrates into.
#
# Why this exists: the merge base was hardcoded as `main` in four places (verify-done call sites,
# the merge gate), while knowledge/git-workflow.md specifies that the flagship model integrates on
# `develop` and promotes to `main` via a release branch. Merging features straight to `main` on a
# project whose release process expects `develop` is not recoverable by a later fix, so the base
# must come from the project's own git strategy — from one place, every time.
#
# Resolution order:
#   1. docs/23-git-strategy.md      — an "Integration branch: <name>" line (devops-engineer writes this)
#   2. docs/20-architecture.md      — the same line, if §7 carries it instead
#   3. main
#
# A branch named by the docs but absent from the repository is reported on stderr and the fallback
# is used — a base that does not exist would make every verify-done comparison meaningless, and
# failing loudly here beats silently comparing against nothing.
#
# Usage:
#   scripts/integration-branch.sh [repo-root]
#
# Output: the branch name on stdout, nothing else, so it is safe to use inline:
#   BASE=$(sh scripts/integration-branch.sh)
#
# Exit codes:
#   0  a branch name was resolved (see stderr for whether it was the documented one)
#   2  not a git repository

set -u

ROOT="${1:-.}"
FALLBACK="main"

if ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "integration-branch: not a git repository: $ROOT" >&2
  exit 2
fi

# Pull the first "Integration branch: <name>" declaration out of a doc, tolerating backticks,
# bold markers and table cells around the name.
read_declared() {
  [ -f "$1" ] || return 1
  sed -n 's/.*[Ii]ntegration branch[^A-Za-z0-9]*[:|][^A-Za-z0-9_/-]*\([A-Za-z0-9._/-][A-Za-z0-9._/-]*\).*/\1/p' "$1" \
    | head -n 1
}

DECLARED=""
SOURCE=""
for doc in "$ROOT/docs/23-git-strategy.md" "$ROOT/docs/20-architecture.md"; do
  candidate=$(read_declared "$doc" || true)
  if [ -n "$candidate" ]; then
    DECLARED="$candidate"
    SOURCE="$doc"
    break
  fi
done

if [ -z "$DECLARED" ]; then
  echo "integration-branch: no 'Integration branch:' declaration found; using $FALLBACK" >&2
  echo "$FALLBACK"
  exit 0
fi

# The declared branch has to actually exist, or every comparison against it is vacuous.
if git -C "$ROOT" rev-parse --verify --quiet "refs/heads/$DECLARED" >/dev/null 2>&1 \
  || git -C "$ROOT" rev-parse --verify --quiet "refs/remotes/origin/$DECLARED" >/dev/null 2>&1; then
  echo "integration-branch: $DECLARED (declared in $SOURCE)" >&2
  echo "$DECLARED"
  exit 0
fi

echo "integration-branch: $SOURCE declares '$DECLARED' but no such branch exists locally or on origin." >&2
echo "integration-branch: falling back to $FALLBACK — create the branch or fix the doc." >&2
echo "$FALLBACK"
exit 0
