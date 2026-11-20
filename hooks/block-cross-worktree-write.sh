#!/bin/sh
# block-cross-worktree-write — a PreToolUse hook stopping a Write/Edit reaching into ANOTHER
# agent's worktree.
#
# WHY THIS EXISTS
#
# DR4-027 (2026-07-29) was two writing agents sharing ONE checkout: one ran `git stash` + `git
# reset`, 22 files of the other's uncommitted work vanished. `block-shared-tree-destructive-git.sh`
# closed that at the git layer — a repo-wide destructive command on a dirty tree. But nothing closes
# the same class of harm at the FILE layer: nothing stops an agent standing in its own worktree from
# using `Write`/`Edit`/`MultiEdit` to reach straight into a *sibling* worktree
# (`.agent-wt/<other-owner>/...`) and overwrite that owner's in-progress file directly — no git
# command involved at all, so the git-layer hook never sees it. `agent-isolation` and `ic-workflow`
# both say "you are given that path and never leave it" and "another IC's code... is somebody else's
# — if your change needs one, say so and stop" — prose, and this repo's own measured lesson (H6,
# 2026-08-07: a qa-engineer agent ran `git merge` despite that exact sentence in its own role file)
# is that prose does not stop an agent. This makes the boundary a command instead of a convention.
#
# SCOPE — narrow, and specifically the SIBLING-worktree collision, not a blanket path restriction
#
# It refuses ONLY when the write target resolves inside a worktree directory
# (`.agent-wt/<name>/` or `.claude/worktrees/<name>/`) that is NOT the one the caller's own current
# directory is already inside. A shared-tree agent (no worktree at all) reaching into ANY agent
# worktree is refused the same way — it has no more business there than a sibling agent does.
#
# It does NOT restrict writes elsewhere: scratch files, files outside every worktree, and ordinary
# writes inside the caller's own tree are all untouched. A hook that blocked every write outside one
# directory would be broader than the harm it exists to stop, and — this repo's own recurring
# lesson — a gate that refuses constantly gets switched off, which protects nothing.
#
# CONTRACT
#   stdin  : the PreToolUse payload (JSON) — the target path is read from `tool_input.file_path`
#   exit 0 : allow
#   exit 2 : BLOCK, with the reason and the safe alternative on stderr
#
# Anything unparseable is ALLOWED, for the same reason the git-layer hook allows it: a hook that
# blocks on its own confusion is a hook that gets removed the first time it misfires.

set -u

PAYLOAD=$(cat 2>/dev/null || true)
[ -n "$PAYLOAD" ] || exit 0

# Pull `file_path` out without a JSON parser — same technique and same portability constraint as
# block-shared-tree-destructive-git.sh: GNU sed alternation fails SILENTLY on BSD sed (i.e. macOS),
# so this stays awk, POSIX character classes only.
field() {
  printf '%s' "$PAYLOAD" | tr '\n' ' ' | awk -v key="\"$1\"" '
  {
    i = index($0, key);
    if (i == 0) exit;
    rest = substr($0, i + length(key));
    j = index(rest, "\"");
    if (j == 0) exit;
    rest = substr(rest, j + 1);
    out = "";
    for (k = 1; k <= length(rest); k++) {
      c = substr(rest, k, 1);
      if (c == "\\") { k++; out = out substr(rest, k, 1); continue }
      if (c == "\"") break;
      out = out c;
    }
    print out;
  }'
}
FILE_PATH=$(field file_path)
[ -n "$FILE_PATH" ] || exit 0
# R7-7: a DEVELOPER subagent always works in its leased slot (.agent-wt/<role>-<n>). Its cwd resets to
# the orchestrator's checkout on every call, so "standing in no worktree" is its normal state, not
# a sign it is the shared-tree session. devops-engineer is not here: app-init has it write the main tree.
ROLE=$(field agent_type); ROLE=${ROLE#app-dev-team:}
case "$ROLE" in ios-developer|android-developer|backend-developer|web-developer|monetization-engineer|test-automation-engineer) DEV=1 ;; *) DEV="" ;; esac

# Resolve to an absolute path without requiring the file to exist yet (Write creates new files).
# `cd` the parent directory and re-append the basename — the standard trick for resolving a path
# that may not exist, since `realpath`/`readlink -f` are not universally present (notably not on
# stock macOS `/usr/bin`).
case "$FILE_PATH" in
  /*) ABS_TARGET="$FILE_PATH" ;;
  *)  ABS_TARGET="$(pwd)/$FILE_PATH" ;;
esac

# Resolve symlinks WITHOUT requiring the file (or even its parent directory) to exist: `Write`
# creates new files, sometimes in a new subdirectory. `cd`+`pwd -P` only works on a directory that
# already exists, so walk up from the target until an existing ancestor is found, resolve that one
# (the earliest point a symlink could be hiding), then re-append every path segment that did not
# exist yet, unresolved — they cannot contain a symlink if nothing has created them.
#
# Skipping this walk once bit exactly this class of bug: on macOS `/tmp` is itself a symlink to
# `/private/tmp` (spawn-gate.sh's own header names the identical trap), so a target under a
# not-yet-created subdirectory of `/tmp/...` resolved to a different absolute string than
# `$(pwd -P)` for a caller standing in the SAME worktree — read as two different worktrees, and a
# same-worktree write was refused. Caught by testing a brand-new subdirectory, not by reading it.
#
# THE WALK STARTED AT THE FILE, which missed every target that already exists (independent review,
# 2026-11): `[ -e ]` was true at once, `cd` on a FILE failed, and the raw string was compared —
# no symlink and no `..` ever resolved. With the caller in `.agent-wt/me`, all of these were
# allowed into a sibling: `me/link.swift` (a symlink to the sibling's file), `me/linkdir/src/f.swift`
# (a symlinked directory), `me/../other/src/f.swift`, `me/nope/../../other/src/f.swift`. And under
# a symlinked root (`/tmp`, `/var/folders` on macOS) the caller's OWN existing files were refused.
#
# So: normalise `.`/`..` lexically first (what the Write tool's own path.resolve does), resolve the
# PARENT through its nearest existing ancestor with `cd -P`, and follow a symlinked final component
# (bounded, so a link loop cannot hang the hook) — repeating until nothing is a link. The external
# `/bin/pwd -P` (getcwd) returns ON-DISK case on macOS, so `.Agent-WT/other` resolves to
# `.agent-wt/other` for free; sh's builtin `pwd -P` keeps the case as typed, hence not the builtin.
norm() {
  printf '%s\n' "$1" | awk -F/ '{
    n = 0
    for (i = 1; i <= NF; i++) { if ($i == "" || $i == ".") continue; if ($i == "..") { if (n) n--; continue } a[++n] = $i }
    out = ""; for (i = 1; i <= n; i++) out = out "/" a[i]
    print (out == "" ? "/" : out)
  }'
}
ABS_TARGET=$(norm "$ABS_TARGET")
hops=0
while :; do
  tail=$(basename "$ABS_TARGET")
  walk=$(dirname "$ABS_TARGET")
  while [ ! -d "$walk" ] && [ "$walk" != "/" ]; do
    tail="$(basename "$walk")/$tail"
    walk=$(dirname "$walk")
  done
  RESOLVED_BASE=$(cd -P "$walk" 2>/dev/null && { /bin/pwd -P 2>/dev/null || pwd -P; }) || RESOLVED_BASE="$walk"
  ABS_TARGET="${RESOLVED_BASE%/}/$tail"
  [ -L "$ABS_TARGET" ] && [ "$hops" -lt 40 ] || break
  hops=$((hops + 1))
  link=$(readlink "$ABS_TARGET")
  case "$link" in
    /*) ABS_TARGET=$(norm "$link") ;;
    *)  ABS_TARGET=$(norm "$RESOLVED_BASE/$link") ;;
  esac
done

# Which worktree, if any, is the CALLER standing in right now?
CWD=$(/bin/pwd -P 2>/dev/null || pwd -P)
worktree_of() {
  # Prints the worktree root (…/.agent-wt/<name> or …/.claude/worktrees/<name>) that $1 sits
  # inside, or nothing if $1 is not inside one. Pure string matching on the path — deliberately not
  # `git worktree list`, which needs a git repo and a live process; this only needs a path.
  case "$1" in
    */.agent-wt/*)
      printf '%s' "$1" | awk -F'/.agent-wt/' '{ n = split($2, parts, "/"); print $1 "/.agent-wt/" parts[1] }'
      ;;
    */.claude/worktrees/*)
      printf '%s' "$1" | awk -F'/.claude/worktrees/' '{ n = split($2, parts, "/"); print $1 "/.claude/worktrees/" parts[1] }'
      ;;
  esac
}

MY_WT=$(worktree_of "$CWD")
TARGET_WT=$(worktree_of "$ABS_TARGET")

# The refusal: the target is inside SOME worktree, and it is not the one I am standing in —
# including the case where I am standing in none at all (the shared tree reaching into an isolated
# worktree has exactly as little business there as a sibling worktree does).
# A developer standing in no worktree, writing into a slot of its OWN role, is in its own slot.
if [ -n "$DEV" ] && [ -z "$MY_WT" ] && [ -n "$TARGET_WT" ]; then
  case "${TARGET_WT##*/}" in "$ROLE"|"$ROLE"-[0-9]*) MY_WT=$TARGET_WT ;; esac
fi

if [ -n "$TARGET_WT" ] && [ "$TARGET_WT" != "$MY_WT" ]; then
  cat >&2 <<EOF
BLOCKED — a write reaching into another agent's worktree.

  target    : $ABS_TARGET
  that path is inside : $TARGET_WT
  you are standing in  : ${MY_WT:-"(no worktree — the shared tree)"}

Measured live, DR4-027 (2026-07-29): two writing agents in one shared checkout, one ran a
destructive git command, 22 files of the other's uncommitted work vanished. That incident closed
the git-command half; this is the same collision reached through Write/Edit instead of git —
nothing else was stopping one agent's file tools from reaching straight into a sibling's tree.

If you need something from that ticket's work: ask for it (\`team-protocol\`'s question/answer
channel), or wait for it to be reviewed and merged. Never read or write another agent's worktree
directly — it may be mid-edit, and a write racing theirs is exactly what this refuses.
EOF
  exit 2
fi

# R7-7: ...and never writes into a studio project's MAIN checkout — the tree the orchestrator and every
# other role read. A literal agent given a relative path writes there, because that is its cwd.
if [ -n "$DEV" ] && [ -z "$TARGET_WT" ]; then
  TOP=$(git -C "$RESOLVED_BASE" rev-parse --show-toplevel 2>/dev/null) || TOP=""
  if [ -n "$TOP" ] && [ -f "$TOP/docs/31-board-events.jsonl" ] \
    && [ "$(git -C "$TOP" rev-parse --absolute-git-dir 2>/dev/null)" = "$(git -C "$TOP" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ]; then
    cat >&2 <<EOF
BLOCKED — a $ROLE subagent writing into the studio's MAIN checkout.

  target : $ABS_TARGET
  tree   : $TOP (the orchestrator's checkout — not your slot)

You work in the slot your prompt names (.agent-wt/$ROLE-<n>). Write to it by its ABSOLUTE path:
  $TOP/.agent-wt/$ROLE-<n>/<path>
Your Bash cwd resets to this checkout on every call, so a relative path lands here (R7-7).
EOF
    exit 2
  fi
fi

exit 0
