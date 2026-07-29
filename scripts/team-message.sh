#!/bin/sh
# team-message — append a message to the team ledger, with the anti-ping-pong guard enforced.
#
# Agents talking to each other is how a team beats a queue of strangers. It is also how two agents
# burn an entire budget agreeing with each other. This helper makes the first cheap and the second
# impossible: it writes the row in one canonical shape, and it refuses a send that breaches the
# guard rather than trusting an agent to count its own messages.
#
# Pure POSIX sh + awk. No Node, no dependencies.
#
# Usage:
#   team-message.sh --from <role> --to <role> --ticket <ID|-> --kind <kind> \
#                   --summary "<one line>" [--body "<detail>"] [--ledger docs/team/messages.md]
#
# Kinds: question | answer | handoff | blocker | fyi | escalation | decision
#
# Exit codes:
#   0  appended
#   1  refused — guard breached (the message was NOT written; escalate instead)
#   2  usage error

set -u

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
LEDGER=""
FROM=""; TO=""; TICKET="-"; KIND=""; SUMMARY=""; BODY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --to) TO="${2:-}"; shift 2 ;;
    --ticket) TICKET="${2:-}"; shift 2 ;;
    --kind) KIND="${2:-}"; shift 2 ;;
    --summary) SUMMARY="${2:-}"; shift 2 ;;
    --body) BODY="${2:-}"; shift 2 ;;
    --ledger) LEDGER="${2:-}"; shift 2 ;;
    *) echo "team-message: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

[ -n "$FROM" ] && [ -n "$TO" ] && [ -n "$KIND" ] && [ -n "$SUMMARY" ] || {
  echo "team-message: --from, --to, --kind and --summary are required" >&2; exit 2; }

# Anchor the ledger to the repo root unless the caller named a path explicitly.
if [ -z "$LEDGER" ]; then
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
  if [ -z "$ROOT" ]; then
    echo "team-message: not inside a git repository, and no --ledger given." >&2
    echo "  Run me from your worktree, or pass --ledger <path>. I will not guess a location:" >&2
    echo "  a relative default once wrote a team message into an unrelated project." >&2
    exit 2
  fi
  LEDGER="$ROOT/docs/team/messages.md"
  echo "team-message: ledger -> $LEDGER" >&2
fi

case "$KIND" in
  question|answer|handoff|blocker|fyi|escalation|decision) ;;
  *) echo "team-message: --kind must be question|answer|handoff|blocker|fyi|escalation|decision" >&2; exit 2 ;;
esac

[ "$FROM" = "$TO" ] && { echo "team-message: refusing a message from $FROM to itself" >&2; exit 2; }

# Pipes would break the table; newlines would break the row.
clean() { printf '%s' "$1" | tr '\n' ' ' | sed 's/|/\//g; s/  */ /g; s/^ //; s/ $//'; }
SUMMARY=$(clean "$SUMMARY"); BODY=$(clean "$BODY"); [ -n "$BODY" ] || BODY="—"

mkdir -p "$(dirname "$LEDGER")"
if [ ! -f "$LEDGER" ]; then
  {
    echo "## Team messages (append-only — never edit or delete a line)"
    echo
    echo "| Timestamp | From | To | Ticket | Kind | Summary | Body |"
    echo "|---|---|---|---|---|---|---|"
  } > "$LEDGER"
fi

# --- guard -------------------------------------------------------------------------------------
# Counted from the ledger itself, not from anything the sender claims. An escalation is always
# allowed through: it is the prescribed way *out* of a breach, so blocking it would trap the team.

MAX_PER_ROLE=10        # messages from one role in the recent window
MAX_PAIR=2             # A->B on one ticket without a third party
MAX_CHAIN=4            # distinct roles involved on one ticket
WINDOW=40              # trailing rows considered "this round"

if [ "$KIND" != "escalation" ]; then
  RECENT=$(tail -n "$WINDOW" "$LEDGER")

  ROLE_COUNT=$(printf '%s\n' "$RECENT" | awk -F'|' -v f=" $FROM " 'NF>6 && $3==f {n++} END{print n+0}')
  if [ "$ROLE_COUNT" -ge "$MAX_PER_ROLE" ]; then
    echo "REFUSED: $FROM has sent $ROLE_COUNT messages this round (max $MAX_PER_ROLE)." >&2
    echo "You are looping, not working. Send one --kind escalation to tech-manager instead." >&2
    exit 1
  fi

  if [ "$TICKET" != "-" ]; then
    PAIR_COUNT=$(printf '%s\n' "$RECENT" | awk -F'|' -v f=" $FROM " -v t=" $TO " -v k=" $TICKET " \
      'NF>6 && $3==f && $4==t && $5==k {n++} END{print n+0}')
    if [ "$PAIR_COUNT" -ge "$MAX_PAIR" ]; then
      echo "REFUSED: $FROM -> $TO on $TICKET already happened $PAIR_COUNT times (max $MAX_PAIR)." >&2
      echo "Two is a conversation; three is a stall. Escalate to tech-manager with both positions." >&2
      exit 1
    fi

    CHAIN=$(printf '%s\n' "$RECENT" | awk -F'|' -v k=" $TICKET " \
      'NF>6 && $5==k {gsub(/^ +| +$/,"",$3); gsub(/^ +| +$/,"",$4); r[$3]=1; r[$4]=1} END{print length(r)}')
    if [ "$CHAIN" -ge "$MAX_CHAIN" ]; then
      echo "REFUSED: $TICKET already involves $CHAIN roles (max $MAX_CHAIN)." >&2
      echo "A question relayed through four roles is an escalation. Send it to tech-manager." >&2
      exit 1
    fi
  fi
fi

# --- append ------------------------------------------------------------------------------------
TS=$(date -u +"%Y-%m-%dT%H:%MZ")
printf '| %s | %s | %s | %s | %s | %s | %s |\n' \
  "$TS" "$FROM" "$TO" "$TICKET" "$KIND" "$SUMMARY" "$BODY" >> "$LEDGER"

echo "SENT: $FROM -> $TO [$TICKET/$KIND] $SUMMARY"
[ "$KIND" = "question" ] && echo "NOTE: keep working on another part of the ticket while you wait. Do not BLOCK unless nothing else can proceed."
exit 0
