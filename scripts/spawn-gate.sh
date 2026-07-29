#!/bin/sh
# spawn-gate — refuse a parallel writing-agent launch that has no isolation.
#
# DR4-027: the orchestrator that spent a day hardening `agent-isolation` then spawned two writing
# agents into one shared checkout. One ran `git stash` + `git reset`; 22 files of the other's work
# vanished, and recovery was luck. Knowing the rule, having written it, and having defended it for
# hours did not make anyone apply it.
#
# So the rule stops being a convention the orchestrator remembers and becomes a command it runs.
# Call this with the ticket IDs you are about to spawn writers for. It answers GO or REFUSED, and
# on REFUSED it prints the exact commands that make it GO.
#
# Usage:
#   scripts/spawn-gate.sh APP-001 APP-002 [...]
#   scripts/spawn-gate.sh --dir .agent-wt APP-001      (non-default worktree parent)
#
# Exit codes:
#   0  GO             — every writer named has its own worktree, or there is exactly one writer
#                       (a lone writer cannot collide with anyone: that is the "serialize" branch
#                       of the rule, and it is stated in the output so it lands in the standup).
#   1  REFUSED        — two or more writers and at least one has no worktree. Spawn nobody.
#   2  CANNOT EVALUATE — not a git repository, or no ticket IDs given. Not a pass.

set -u

DIR=.agent-wt
IDS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:-}"; shift 2 || exit 2 ;;
    --dir=*) DIR="${1#--dir=}"; shift ;;
    -*) echo "CANNOT EVALUATE: unknown flag $1"; exit 2 ;;
    *) IDS="$IDS $1"; shift ;;
  esac
done

# shellcheck disable=SC2086
set -- $IDS
if [ $# -eq 0 ]; then
  echo "CANNOT EVALUATE: no ticket IDs given"
  echo "usage: spawn-gate.sh <TICKET-ID> [TICKET-ID ...]"
  exit 2
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "CANNOT EVALUATE: not a git repository — worktrees are unavailable here"
  echo "Serialize the writers instead: one at a time, each committing before the next starts,"
  echo "and say in the standup that you serialized and why."
  exit 2
fi

COUNT=$#
HERE=$(git rev-parse --show-toplevel 2>/dev/null | { read -r p; cd "$p" 2>/dev/null && pwd -P; })

# A worktree is a directory that is its own git top level and is NOT this repo's top level.
# Deliberately not string-matching `git worktree list` output: on macOS /tmp is a symlink, so the
# registered path and a resolved `pwd` disagree and every real worktree reads as missing — a gate
# that refuses everything gets switched off, which is the same as no gate.
missing=""
for id in "$@"; do
  path="$DIR/$id"
  top=$(cd "$path" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null | { read -r p; cd "$p" 2>/dev/null && pwd -P; })
  abs=$(cd "$path" 2>/dev/null && pwd -P)
  if [ -n "$abs" ] && [ "$abs" = "$top" ] && [ "$abs" != "$HERE" ]; then
    continue
  fi
  missing="$missing $id"
done

if [ "$COUNT" -eq 1 ]; then
  if [ -z "$missing" ]; then
    echo "GO: 1 writing agent, isolated in $DIR/$1"
  else
    echo "GO: 1 writing agent, no worktree — SERIALIZED"
    echo "A lone writer cannot collide. This is the 'or serialize' branch of the rule, and it holds"
    echo "only while it stays lone: spawn a second writer into this tree and the gate refuses."
    echo "Say in the standup that this round was serialized and why."
  fi
  exit 0
fi

if [ -z "$missing" ]; then
  echo "GO: $COUNT writing agents, each isolated under $DIR/"
  exit 0
fi

echo "REFUSED: $COUNT writing agents, and these have no worktree:$missing"
echo
echo "Spawn nobody. Two writers in one tree is the collision this plugin exists to prevent, and it"
echo "has been reproduced twice — most recently by the orchestrator that had just documented it"
echo "(docs/research/2026-07-29-dry-run-4-findings.md, DR4-027: 22 files lost to one \`git reset\`)."
echo
echo "Create them, then re-run this gate:"
for id in $missing; do
  echo "  git worktree add \"$DIR/$id\" -b \"feat/$id-short-slug\""
done
echo
echo "Or serialize: spawn one writer, let it commit, then the next. Say so in the standup."
exit 1
