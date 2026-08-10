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
# WHAT IT DOES NOT DO
#
# It does not grade the verdict, check it against the diff, or verify the reviewer's reasoning was
# sound — that is `defect-hunting` and the human/downstream process's job. It answers exactly one
# question: did this subagent leave ANY trace that it produced ONE of its three legitimate outcomes
# (APPROVE, REQUEST CHANGES, or a documented BLOCKED refusal — code-reviewer.md's own self-review
# refusal shape) — or did it just stop, the way the incident above did.
#
# CONTRACT
#   stdin  : the SubagentStop payload (JSON) — reads `transcript_path` and `last_assistant_message`
#   exit 0 : allow the stop (a verdict was recorded, or a documented BLOCKED refusal was given)
#   exit 2 : BLOCK, with the reason and what is missing on stderr
#
# Anything unparseable, or a transcript this hook cannot read, is ALLOWED — same rule as every other
# hook in this plugin: a hook that blocks on its own confusion is a hook that gets removed the first
# time it misfires, and this one exists on a role (`code-reviewer`) already wired via hooks.json's
# matcher, so it only ever runs where it is meant to.

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

TRANSCRIPT=$(extract_field "transcript_path")
LAST_MSG=$(extract_field "last_assistant_message")

# A documented BLOCKED refusal (e.g. self-review) is a legitimate third outcome — code-reviewer.md's
# own format is `BLOCKED: APP-NNN` at the start of the response. It produces neither a review file
# nor a board.mjs verdict event by design, and it is self-explaining in the transcript, unlike the
# silent idle-out this hook exists to catch.
case "$LAST_MSG" in
  *BLOCKED:*) exit 0 ;;
esac

[ -n "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ] || exit 0

WROTE_VERDICT_FILE=0
grep -q 'docs/53-reviews/' "$TRANSCRIPT" 2>/dev/null && WROTE_VERDICT_FILE=1

RECORDED_EVENT=0
grep -qE 'board\.mjs move [A-Za-z0-9_-]+ (approved|changes)' "$TRANSCRIPT" 2>/dev/null && RECORDED_EVENT=1

if [ "$WROTE_VERDICT_FILE" = 1 ] && [ "$RECORDED_EVENT" = 1 ]; then
  exit 0
fi

{
  echo "BLOCKED — this review subagent is stopping with no recorded verdict."
  echo ""
  echo "  wrote docs/53-reviews/*.md      : $([ "$WROTE_VERDICT_FILE" = 1 ] && echo yes || echo NO)"
  echo "  ran board.mjs move ... approved|changes : $([ "$RECORDED_EVENT" = 1 ] && echo yes || echo NO)"
  echo ""
  echo "Measured live: a code-reviewer spawned as a named teammate went idle three times reviewing"
  echo "this plugin's own PR #32 and never produced anything — no file, no board event, no message"
  echo "with findings. Your verdict is only checkable if it is recorded (code-reviewer.md, 'Persist"
  echo "the verdict'). Before stopping: write docs/53-reviews/APP-NNN-cycle-N.md, then run"
  echo "\`board.mjs move APP-NNN approved|changes --verdict <that file>\`. If you cannot review this"
  echo "ticket at all (e.g. self-review), say so explicitly: \`BLOCKED: APP-NNN\` with the reason."
} >&2
exit 2
