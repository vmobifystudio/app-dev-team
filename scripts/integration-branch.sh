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
#   3. main — ONLY when there is no docs/23-git-strategy.md at all. A git-strategy doc that exists
#      and declares nothing is exit 2, not `main`: see the block that raises it.
#
# A branch named by the docs but absent from the repository is exit 2, NOT a fallback. This file
# used to print a warning to stderr and return `main` with exit 0 — failing open on the single
# condition it was written to catch. Its only caller does `BASE=$(sh scripts/integration-branch.sh)`,
# which discards stderr and never looks at `$?`, so on a develop-model project the base silently
# became `main` and features merged to the wrong branch: the outcome this header calls unrecoverable.
# The warning was real and nobody could see it.
#
# Usage:
#   scripts/integration-branch.sh [repo-root]
#
# Output: the branch name on stdout, nothing else, so it is safe to use inline:
#   BASE=$(sh scripts/integration-branch.sh) || { echo "$BASE"; exit 1; }
#
# Exit codes:
#   0  a branch name was resolved (see stderr for whether it was the documented one)
#   2  CANNOT RESOLVE — not a git repository, or the declared branch does not exist. The reason is
#      printed on STDOUT as well as stderr, because a caller capturing stdout is the only one that
#      exists and it must be able to show WHY the round stopped. Never fall back on this path: a
#      wrong merge base is not recoverable by a later fix.

set -u

ROOT="${1:-.}"
FALLBACK="main"

if ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "integration-branch: CANNOT RESOLVE — not a git repository: $ROOT"
  echo "integration-branch: CANNOT RESOLVE — not a git repository: $ROOT" >&2
  exit 2
fi

# Pull the first "Integration branch: <name>" declaration out of a doc, tolerating backticks,
# bold markers and table cells around the name.
#
# The separator set is wider than `[:|]` because prose is wider than `[:|]`. These are all real
# phrasings a devops-engineer writes into docs/23-git-strategy.md, and every one of them fell
# through to the silent `main` fallback:
#
#   Integration branch: develop            Integration branch = develop
#   - Integration branch — `develop`       The integration branch is `develop`.
#   | Integration branch | develop |
#
# ERE (`sed -E`), not BRE: `\|` alternation in a BRE is a GNU extension and this repo runs on BSD
# sed too, where it would have silently matched nothing — a resolver that always falls back.
read_declared() {
  [ -f "$1" ] || return 1
  sed -nE 's/.*[Ii]ntegration branch[[:space:]]*(:|=|—|–|-|\||is)[[:space:]]*[^A-Za-z0-9_/-]*([A-Za-z0-9._/-]+).*/\2/p' "$1" \
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
  # A SILENT declaration is not the same absence as a missing document, and the two get opposite
  # answers. `grep -rn "Integration branch" agents/ skills/ commands/` returned NOTHING: no role
  # was ever told to write the line this script reads, so on every real project the resolver found
  # no declaration and returned `main` at exit 0 — the exact fail-open its own header says it exists
  # to remove. The script was correct and its input was never produced, so fixing the script changed
  # nothing. agents/devops-engineer.md now REQUIRES the line; this makes its absence visible.
  #
  #   docs/23-git-strategy.md exists but declares nothing -> exit 2. The document that owns the
  #     answer is silent, and "the doc did not say" must never be spelled the same as "the doc said
  #     main". A wrong merge base is not recoverable by a later fix.
  #   no git-strategy doc at all -> `main`, exit 0. A project with no branch model has no develop
  #     model to get wrong, and brownfield /app-audit runs must not be bricked by a doc they never
  #     had.
  if [ -f "$ROOT/docs/23-git-strategy.md" ]; then
    MSG="integration-branch: CANNOT RESOLVE — $ROOT/docs/23-git-strategy.md exists but declares no
integration branch. Add the line devops-engineer owns, exactly:
    Integration branch: <name>
Refusing to assume $FALLBACK: on a develop-model project that silently merges features into the
wrong branch, which is not recoverable by a later fix."
    echo "$MSG"
    echo "$MSG" >&2
    exit 2
  fi
  echo "integration-branch: no docs/23-git-strategy.md in $ROOT; using $FALLBACK" >&2
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

MSG="integration-branch: CANNOT RESOLVE — $SOURCE declares '$DECLARED' but no such branch exists
locally or on origin. Refusing to fall back to $FALLBACK: merging feature work into the wrong
integration branch is not recoverable by a later fix. Create the branch, or fix the doc."
echo "$MSG"
echo "$MSG" >&2
exit 2
