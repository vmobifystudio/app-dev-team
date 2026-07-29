#!/bin/sh
# ship-gate — decide whether a sprint may be released. Read-only.
#
# /app-ship's preconditions were prose for the orchestrator to improvise. Improvising them went
# wrong three times in one session: a `grep | sed || echo` guard that could not fail, a field-index
# mistake that reported a ticket in the wrong column, and a chain that printed BLOCKED on a clean
# board. Every one of those errors was silent and confident.
#
# `sprint-planner` requires that every Definition-of-Done gate name a runnable command. The release
# gate is the most consequential gate in the plugin and it did not have one. This is it.
#
# Usage:  sh scripts/ship-gate.sh [project-root]
# Exit:   0 clear to ship · 1 blocked (reasons printed) · 2 cannot evaluate (missing inputs)

set -u
ROOT=${1:-.}
BOARD="$ROOT/docs/31-board.md"
BUGS="$ROOT/docs/51-bugs.md"
PLAN="$ROOT/docs/50-test-plan.md"
HERE=$(cd "$(dirname "$0")" && pwd)

BLOCKERS=""
NOTES=""
block() { BLOCKERS="${BLOCKERS}  BLOCKED  $1
"; }
note()  { NOTES="${NOTES}  note     $1
"; }

[ -f "$BOARD" ] || { echo "ship-gate: no board at $BOARD" >&2; exit 2; }

# --- 1. the board must be coherent ---------------------------------------------------------------
# A stranded or unspawnable ticket at release time is work the sprint never reported.
if command -v node >/dev/null 2>&1 && [ -f "$HERE/board-doctor.mjs" ]; then
  if ! node "$HERE/board-doctor.mjs" "$BOARD" >/dev/null 2>&1; then
    block "board-doctor reports anomalies. Run it and clear them before releasing."
  fi
else
  note "board-doctor not runnable here — board coherence NOT checked (say so in the release notes)."
fi

# --- 2. no ticket may still be in flight ----------------------------------------------------------
# Parse the Status column by position rather than by guessing a field index: find which column the
# header calls "Status", then read that cell. A hardcoded index silently reads the wrong column when
# the board gains a column — which is exactly how Reviewer/Cycles broke earlier readers.
INFLIGHT=$(awk -F'|' '
  /^[[:space:]]*\|/ {
    if (!found) {
      for (i = 1; i <= NF; i++) { gsub(/^ +| +$/, "", $i); if (tolower($i) == "status") { col = i; found = 1 } }
      next
    }
    id = $2; st = $col
    gsub(/^ +| +$/, "", id); gsub(/^ +| +$/, "", st)
    if (id ~ /^[A-Za-z]+-[0-9]+/ && (st == "todo" || st == "in_progress" || st == "review"))
      printf "%s(%s) ", id, st
  }' "$BOARD")
[ -n "$INFLIGHT" ] && block "tickets still in flight: $INFLIGHT"

# --- 3. no open S1/S2 bug -------------------------------------------------------------------------
if [ -f "$BUGS" ]; then
  # A bug is closed when its row is marked FIXED/CLOSED/WONTFIX on the same line.
  #
  # Use `.*`, never `[^\n]*`. grep is line-oriented, so `.` already excludes newlines — and in a
  # POSIX bracket expression `[^\n]` means "not backslash and not the letter n", which silently
  # matches almost nothing. That exact mistake made this gate report 0 open S1/S2 bugs when two
  # were open: a ship gate failing open, in the script written to stop gates failing open. It only
  # showed up because the behaviour differed between the interactive shell and `sh`.
  OPEN=$(grep -cE '\*\*BUG-[0-9]+\*\*.*\*\*S[12]\*\*' "$BUGS" 2>/dev/null || true)
  CLOSED=$(grep -cE '\*\*BUG-[0-9]+\*\*.*\*\*S[12]\*\*.*(FIXED|CLOSED|WONTFIX)' "$BUGS" 2>/dev/null || true)
  OPEN=$((${OPEN:-0} - ${CLOSED:-0}))
  [ "${OPEN:-0}" -gt 0 ] && block "$OPEN open S1/S2 bug(s) on the bug board."
  DEFERRED=$(grep -oE '\*\*S[34]\*\*' "$BUGS" | wc -l | tr -d ' ')
  [ "$DEFERRED" -gt 0 ] && note "$DEFERRED open S3/S4 bug(s) — not blocking, but name them in the release notes."
else
  block "no bug board at $BUGS. QA has not run; a release without a QA pass is not a release."
fi

# --- 4. QA's own verdict --------------------------------------------------------------------------
# QA can recommend holding while every per-ticket review approved, and both can be right: a review
# is scoped to one diff and cannot see that the sprint's journey was never wired together.
if [ -f "$PLAN" ]; then
  if grep -qiE 'hold|do not ship|not shippable|blocked' "$BUGS" "$PLAN" 2>/dev/null; then
    note "QA text mentions a hold — read docs/50-test-plan.md's exit criteria and QA's recommendation before overriding."
  fi
  if grep -qiE 'NOT PERFORMED|not executed|by reading' "$PLAN" 2>/dev/null; then
    note "the test plan contains rows that were reasoned, not executed. Do not report those as tested."
  fi
else
  block "no test plan at $PLAN. Nothing states what was verified or what the exit criteria were."
fi

# --- verdict ---------------------------------------------------------------------------------------
echo "SHIP GATE"
if [ -n "$BLOCKERS" ]; then printf '%s' "$BLOCKERS"; fi
if [ -n "$NOTES" ]; then printf '%s' "$NOTES"; fi

if [ -n "$BLOCKERS" ]; then
  echo
  echo "RESULT: BLOCKED — do not release. Fix the above, then re-run."
  exit 1
fi
echo
echo "RESULT: CLEAR — preconditions met. Proceed to the parallel readiness agents."
exit 0
