#!/bin/sh
# require-review-verdict — a SubagentStop hook refusing to let a `code-reviewer` subagent finish
# with no recorded verdict at all.
#
# WHY THIS EXISTS
#
# Measured live, this session: a `code-reviewer` spawned as a named interactive teammate to review
# this plugin's own PR #32 sat idle three separate times, producing nothing — no verdict message, no
# `docs/53-reviews/*.md` file, no `board.mjs move ... approved|changes` call. Two direct nudges asking
# it to report its findings changed nothing. The review only happened because a human stepped in and
# did it by hand. `agents/code-reviewer.md` already says, in prose, "your verdict is only checkable
# if it is recorded" and "before you return, write your full verdict to docs/53-reviews/..." — and
# this repo's own recurring lesson (H6, DR4-027, and now this) is that prose does not stop an agent
# from simply not doing it. This makes "did SOMETHING get recorded" a command instead of a hope.
#
# VERSION 2 — THE FIRST VERSION SHIPPED THE EXACT BUG IT EXISTED TO CATCH
#
# v1 grepped the SUBAGENT'S OWN TRANSCRIPT for the words "docs/53-reviews/" and
# "board.mjs move ... approved|changes". A real independent review of this hook (2026-08-10) ran it
# against a realistic transcript and reproduced, live: a nudge that merely QUOTES the required command
# (exactly what the incident above's own "two direct nudges" would contain) satisfies the check with
# nothing ever executed — exit 0, allowed to stop, verdict recorded is nothing. Worse, the hook's OWN
# refusal message (line ~90 below) contains both trigger strings verbatim, so if that stderr text ever
# reaches a later turn of the same transcript, the hook can fire at most ONCE per subagent, ever, then
# permanently disarms itself. Both are the "rule scanning text finds its own documentation" failure
# `defect-hunting` §3 names, and this hook fell into a version of exactly the pattern it exists to make
# other roles stop doing.
#
# THE FIX: stop trusting the agent's own prose for the CLAIM OF SUCCESS. The transcript is only ever
# used to find a CANDIDATE ticket ID to check — never to decide whether that ticket's review actually
# happened. What actually happened is answered by the board's own append-only event log
# (`docs/31-board-events.jsonl`), which can only gain a real `approved`/`changes` event authored by
# `code-reviewer` if `board.mjs move` was actually invoked AND actually succeeded — `board.mjs`'s own
# `readVerdict()` independently re-reads the verdict file and checks it contains a matching verdict
# word before that event is ever appended (`scripts/lib/verdict.mjs`). A line in that log naming this
# ticket, this role, and a `verdict_path` is not a claim — it is the same class of ground truth
# `verify-done.sh` already trusts over self-report, applied to review instead of implementation.
#
# RESIDUAL, STATED LIMITATION: correlating "this stop event" to "this review" still uses a ticket ID
# extracted from the transcript, because the SubagentStop payload carries no ticket ID at all. A real
# event for that ticket ID, from ANY point in the ticket's history (not provably from THIS session),
# satisfies the check. This closes the demonstrated exploit (prose can never forge a real log entry)
# without claiming to prove which session wrote it — narrower and honest, over a wider claim this
# script cannot actually back.
#
# WHAT IT DOES NOT DO
#
# It does not grade the verdict, check it against the diff, or verify the reviewer's reasoning was
# sound — that is `defect-hunting` and the human/downstream process's job. It answers exactly one
# question: does the board's own log show a real trace of one of this role's three legitimate outcomes
# (APPROVE, REQUEST CHANGES, or a documented BLOCKED refusal) for a ticket this subagent named — or
# did it just stop, the way the incident above did.
#
# CONTRACT
#   stdin  : the SubagentStop payload (JSON) — reads `agent_type`, `transcript_path`, `cwd`,
#            `last_assistant_message`
#   exit 0 : allow the stop
#   exit 2 : BLOCK, with the reason and what is missing on stderr
#
# Anything unparseable, or state this hook cannot read, is ALLOWED — same rule as every other hook in
# this plugin: a hook that blocks on its own confusion is a hook that gets removed the first time it
# misfires.

set -u

PAYLOAD=$(cat 2>/dev/null || true)
[ -n "$PAYLOAD" ] || exit 0

# Same character-walk JSON string extractor as block-cross-worktree-write.sh — no `jq` dependency,
# GNU sed alternation fails silently on BSD sed (macOS), so this stays awk with POSIX character
# classes only. Takes the field name as $1, reads $PAYLOAD (flattened to one line) from stdin.
extract_field() {
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
        if (c == "\\") { k++; nc = substr(rest, k, 1); if (nc == "n") out = out "\n"; else out = out nc; continue }
        if (c == "\"") break;
        out = out c;
      }
      print out;
    }'
}

AGENT_TYPE=$(extract_field "agent_type")
TRANSCRIPT=$(extract_field "transcript_path")
CWD=$(extract_field "cwd")
LAST_MSG=$(extract_field "last_assistant_message")

# Belt-and-braces beyond hooks.json's own "code-reviewer" matcher: a fail-CLOSED hook misfiring on
# the wrong role (developer, tech-lead, qa-engineer — none of which ever write docs/53-reviews/) is
# the worst possible blast radius for a matcher assumption this script never itself verified. If
# agent_type is present and is not code-reviewer, this hook has nothing to do with this subagent.
if [ -n "$AGENT_TYPE" ] && [ "$AGENT_TYPE" != "code-reviewer" ]; then
  exit 0
fi

# A documented BLOCKED refusal (e.g. self-review) is a legitimate third outcome — code-reviewer.md's
# own format is `BLOCKED: APP-NNN` at the start of the response. It produces neither a review file nor
# a board.mjs verdict event by design, and it is self-explaining, unlike the silent idle-out this hook
# exists to catch. `last_assistant_message` is part of the documented SubagentStop payload; the
# transcript-scan fallback below is defensive in case a given invocation omits or truncates it.
BLOCKED=0
case "$LAST_MSG" in
  *BLOCKED:*) BLOCKED=1 ;;
esac
if [ "$BLOCKED" = 0 ] && [ -n "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ]; then
  tail -20 "$TRANSCRIPT" 2>/dev/null | grep -q 'BLOCKED:' && BLOCKED=1
fi
[ "$BLOCKED" = 1 ] && exit 0

# Everything past here needs the transcript ONLY to find a candidate ticket ID — never to decide
# whether the review actually happened. A false claim in the transcript cannot forge a log line.
[ -n "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ] || exit 0

LOG="${CWD:-.}/docs/31-board-events.jsonl"
[ -r "$LOG" ] || exit 0

# Ticket IDs this subagent's transcript mentions — the studio's own convention, `[A-Z]+-[0-9]+`
# (APP-001, OPS-014, ...). Deduplicated candidates only; order doesn't matter, one real match is enough.
CANDIDATES=$(grep -oE '[A-Z]{2,}-[0-9]+' "$TRANSCRIPT" 2>/dev/null | sort -u)
[ -n "$CANDIDATES" ] || {
  cat >&2 <<'EOF'
BLOCKED — this review subagent is stopping and its transcript names no ticket ID at all.

Nothing to check a verdict against. If this truly is not a per-ticket review, that is unusual for
this role — say so explicitly. Otherwise name the ticket you were reviewing somewhere in your work.
EOF
  exit 2
}

RECORDED=0
MATCHED_TICKET=""
for id in $CANDIDATES; do
  # One board-event-log line is one JSON object — `"ticket":"<id>"`, `"event":"approved"|"changes"`,
  # `"by":"code-reviewer"` and `"verdict_path":...` all co-occur on the SAME line when real, so
  # piping grep -F/-E stages (each narrowing the SAME candidate lines further) requiring all four
  # substrings cannot be satisfied by unrelated lines or by separate events that merely share a
  # substring across different tickets.
  LINE=$(grep -F "\"ticket\":\"$id\"" "$LOG" 2>/dev/null | grep -E '"event":"(approved|changes)"' | grep '"by":"code-reviewer"' | grep -F '"verdict_path"' | tail -1)
  if [ -n "$LINE" ]; then
    RECORDED=1
    MATCHED_TICKET="$id"
    break
  fi
done

[ "$RECORDED" = 1 ] && exit 0

{
  echo "BLOCKED — this review subagent is stopping with no recorded verdict."
  echo ""
  echo "  candidate ticket(s) mentioned : $(printf '%s' "$CANDIDATES" | tr '\n' ' ')"
  echo "  a real approved|changes event, by code-reviewer, with a verdict_path, exists for any of them: NO"
  echo ""
  echo "This is checked against docs/31-board-events.jsonl directly — the board's own append-only"
  echo "log — not against anything you said. Mentioning the command is not the same as running it."
  echo "Your verdict is only checkable if it is recorded (code-reviewer.md, 'Persist the verdict')."
  echo "Before stopping: write docs/53-reviews/APP-NNN-cycle-N.md, then run"
  echo "\`board.mjs move APP-NNN approved|changes --verdict <that file>\` and confirm it exits 0."
  echo "If you cannot review this ticket at all (e.g. self-review), say so explicitly:"
  echo "\`BLOCKED: APP-NNN\` with the reason."
} >&2
exit 2
