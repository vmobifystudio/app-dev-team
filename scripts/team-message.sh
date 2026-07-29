#!/bin/sh
# team-message — send a message on the team channel.
#
# Agents talking to each other is how a team beats a queue of strangers. It is also how two agents
# burn an entire budget agreeing with each other. This helper makes the first cheap and the second
# impossible: it writes the record in one canonical shape, and it refuses a send that breaches the
# obligation rule or the anti-ping-pong guard rather than trusting an agent to police itself.
#
# WHAT CHANGED IN P3a, and why this file shrank.
#
# The channel used to be `docs/team/messages.md` — an LLM (or this script) appended a Markdown row,
# and every rule about what was legal was checked afterwards. The guard lived HERE in awk, again in
# board-doctor.mjs, and its numbers were restated a third time in messages-render.mjs. Three
# implementations of one rule, and two of them disagreed about the window: a ledger this script had
# happily written was reported as a breach, and a chain it refused was invisible to the doctor.
#
# Now `docs/team/messages.jsonl` is the source of truth, the Markdown is GENERATED from it, and the
# single implementation of the guard lives in scripts/lib/messages.mjs. This script keeps the one job
# it was always right about — resolving the ledger against the repository root, never the cwd — and
# hands the rest to scripts/messages.mjs. The flags are unchanged; every existing caller keeps working.
#
# Node stdlib + POSIX sh. No dependencies.
#
# Usage:
#   team-message.sh --from <role> --to <role[,role]> --ticket <ID|-> --kind <kind> \
#                   --summary "<one line>" [--body "<detail>"] [--ledger docs/team/messages.md] \
#                   [--artifact <ID|path>] [--transition <TICKET:event>] [--decision "<what>"] \
#                   [--evidence "<what changed>"] [--priority material|fyi] [--blocking]
#
# Kinds: question | answer | handoff | blocker | fyi | escalation | decision
#
# Every MATERIAL message must yield a decision, a state transition, an artifact update or a timed
# follow-up. An `answer` or `decision` that names no artifact is REFUSED: a closed ledger is not
# delivery (DR4-006). `--kind fyi` is the escape hatch and must be chosen, never defaulted into.
#
# Exit codes:
#   0  sent
#   1  refused — obligation missing or guard breached (nothing was written; escalate instead)
#   2  usage error

set -u

HERE=$(cd "$(dirname "$0")" && pwd)

# Resolved against the git repository root, never the shell's cwd.
#
# This defaulted to the bare relative path "docs/team/messages.md". An agent working in a git
# worktree ran the helper without cd-ing there first, so the path resolved against the session's
# cwd — a COMPLETELY UNRELATED repository — and wrote a team message into somebody else's project.
# The agent had done exactly what it was told; the script put the file in the wrong place, and the
# absence of the message where it was expected was then misread as the agent having lied about
# sending it.
#
# A relative default in a tool that agents invoke from arbitrary directories is a footgun.
HAS_LEDGER=0
for arg in "$@"; do
  [ "$arg" = "--ledger" ] && HAS_LEDGER=1
done

if [ "$HAS_LEDGER" = "0" ]; then
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
  if [ -z "$ROOT" ]; then
    echo "team-message: not inside a git repository, and no --ledger given." >&2
    echo "  Run me from your worktree, or pass --ledger <path>. I will not guess a location:" >&2
    echo "  a relative default once wrote a team message into an unrelated project." >&2
    exit 2
  fi
  LEDGER="$ROOT/docs/team/messages.md"
  echo "team-message: ledger -> $LEDGER" >&2
  # Arguments are passed as an argv array to node and are never interpolated into a shell, so a
  # `|`, a `;` or a `--board=/etc/passwd` inside a summary is inert text rather than syntax. The
  # old row-escaping dance existed only because the destination was a Markdown table.
  exec node "$HERE/messages.mjs" send --ledger "$LEDGER" "$@"
fi

exec node "$HERE/messages.mjs" send "$@"
