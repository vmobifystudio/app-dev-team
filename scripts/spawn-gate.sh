#!/bin/sh
# spawn-gate — refuse a parallel writing-agent launch that has no isolation.
#
# DR4-027: the orchestrator that spent a day hardening `agent-isolation` then spawned two writing
# agents into one shared checkout. One ran `git stash` + `git reset`; 22 files of the other's work
# vanished, and recovery was luck. Knowing the rule, having written it, and having defended it for
# hours did not make anyone apply it.
#
# So the rule stops being a convention the orchestrator remembers and becomes a command it runs.
# Call this with the OWNERS you are about to spawn writers for — not the tickets. The unit of
# isolation is the WRITER: one owner working three tickets one after another in its own worktree
# cannot collide with anyone; two owners in one tree can. `worktree-slot.mjs lease` creates
# `.agent-wt/<owner>`, keyed the same way, since the slot model moved from per-ticket to per-owner
# (OPS-005) — this usage comment named ticket IDs after that move and nobody had actually called it
# since, caught only by running it for real during an adversarial re-review (2026-08-08). It
# answers GO or REFUSED, and on REFUSED it prints the exact commands that make it GO.
#
# Usage:
#   scripts/spawn-gate.sh ios-developer android-developer [...]
#   scripts/spawn-gate.sh --dir .agent-wt ios-developer     (non-default worktree parent)
#
# Exit codes:
#   0  GO             — every writer named has its own worktree, or there is exactly one writer
#                       (a lone writer cannot collide with anyone: that is the "serialize" branch
#                       of the rule, and it is stated in the output so it lands in the standup).
#   1  REFUSED        — two or more writers and at least one has no worktree, OR the studio
#                       emergency stop is set (`.studio-stop` / APP_TEAM_STOP). Spawn nobody.
#   2  CANNOT EVALUATE — not a git repository, or no owner names given. Not a pass.

set -u

# The ONE refusal exit. Three paths refuse now (emergency stop, two writers with no worktree) and
# routing them all through here keeps a single point that a mutation can flip — mutate.sh's M01
# anchors on it, and an anchor that occurs three times lands somewhere arbitrary and proves nothing.
refuse() { exit 1; }

DIR=.agent-wt
IDS=""

while [ $# -gt 0 ]; do
  case "$1" in
    # `--dir` with no value used to be `shift 2 || exit 2` — a SILENT exit 2. Every other
    # exit-2 path in this file prints `CANNOT EVALUATE: <reason>`, and a gate that exits non-zero
    # saying nothing is indistinguishable from a crash to the thing reading its output.
    --dir)
      if [ $# -lt 2 ]; then echo "CANNOT EVALUATE: --dir needs a directory"; exit 2; fi
      DIR="$2"; shift 2 ;;
    --dir=*) DIR="${1#--dir=}"; shift ;;
    -*) echo "CANNOT EVALUATE: unknown flag $1"; exit 2 ;;
    *) IDS="$IDS $1"; shift ;;
  esac
done

# `set -f` first: without it the shell GLOBS while re-splitting, so a ticket ID of `*` expands to
# every filename in the cwd and the gate reports on files instead of tickets.
set -f
# shellcheck disable=SC2086
set -- $IDS
set +f
if [ $# -eq 0 ]; then
  echo "CANNOT EVALUATE: no owner names given"
  echo "usage: spawn-gate.sh <OWNER> [OWNER ...]"
  exit 2
fi

# --- the emergency stop ------------------------------------------------------------------------
#
# Checked BEFORE anything else, because this is the mandatory pre-spawn call: every documented spawn
# site runs this gate, so the halt cannot be skipped without skipping the gate. A stop checked once
# at the top of a loop is a preference, not a stop.
#
# Set it without editing any code:   echo "why" > .studio-stop      (or APP_TEAM_STOP=1)
# Clear it the same way:             rm .studio-stop
#
# It halts SPAWNING. It cannot kill agents already running — nothing here holds a process handle on
# them — and saying otherwise would be a control believed to do more than it does.
STOP_FILE=${APP_TEAM_STOP_FILE:-.studio-stop}
STOP_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
if [ -n "${APP_TEAM_STOP:-}" ]; then
  echo "REFUSED: EMERGENCY STOP is set (APP_TEAM_STOP=$APP_TEAM_STOP)"
  echo "Spawn nobody. Report what is unfinished and stop the loop."
  refuse
fi
if [ -e "$STOP_ROOT/$STOP_FILE" ]; then
  echo "REFUSED: EMERGENCY STOP is set ($STOP_ROOT/$STOP_FILE)"
  echo "reason: $(cat "$STOP_ROOT/$STOP_FILE" 2>/dev/null || echo '(unreadable — treated as STOP)')"
  echo
  echo "Spawn nobody. Report what is unfinished and stop the loop. An operator clears this with"
  echo "  rm \"$STOP_ROOT/$STOP_FILE\""
  echo "and an agent never clears it on its own judgement that things look fine now."
  refuse
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
echo "Create them, then re-run this gate."
echo
echo "PASS OWNERS, NOT TICKETS. The unit of isolation is the WRITER, not the ticket: two agents in"
echo "one tree corrupt each other, while one agent working three tickets one after another in its"
echo "own tree cannot corrupt anyone. Leasing a slot per owner is what makes"
echo "parallel-orchestrator's 'one agent invocation per owner, batched' and 'each agent's prompt"
echo "names ITS worktree path' both true at once — they could not both be true per ticket (OPS-005)."
echo
for id in $missing; do
  echo "  node scripts/worktree-slot.mjs lease --owner $id --tickets APP-NNN,APP-NNN"
done
echo
echo "For a project still keyed by ticket, the old shape still works and this gate still checks it:"
for id in $missing; do
  echo "  git worktree add \"$DIR/$id\" -b \"feat/$id-short-slug\""
done
echo
echo "Or serialize: spawn one writer, let it commit, then the next. Say so in the standup."
refuse
