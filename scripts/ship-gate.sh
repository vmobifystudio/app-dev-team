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
# Exit:   0 clear to ship
#         1 BLOCKED — the gate evaluated every precondition and one of them says no
#         2 CANNOT EVALUATE — an input was missing or unreadable, so some precondition was never
#           checked at all. Distinct from 1 on purpose: "I could not look" is not "I looked and it
#           was fine", and a missing bug board or test plan used to be reported as a plain blocker,
#           which invited "it's only blocked because the file isn't there yet" as an override.
#
# There is no path from a check that did not run to exit 0.

set -u
ROOT=${1:-.}
BOARD="$ROOT/docs/31-board.md"
BUGS="$ROOT/docs/51-bugs.md"
PLAN="$ROOT/docs/50-test-plan.md"
HERE=$(cd "$(dirname "$0")" && pwd)

BLOCKERS=""
NOTES=""
UNKNOWNS=""
block()   { BLOCKERS="${BLOCKERS}  BLOCKED  $1
"; }
note()    { NOTES="${NOTES}  note     $1
"; }
unknown() { UNKNOWNS="${UNKNOWNS}  UNKNOWN  $1
"; }

# Every exit-2 path prints its reason on STDOUT in the same shape as the verdict below, because
# /app-ship displays that output verbatim to name the missing artifact and its owning role. A bare
# exit 2 with the reason only on stderr gives the command nothing to show.
cannot_evaluate_now() {
  echo "SHIP GATE"
  echo "  UNKNOWN  $1"
  echo
  echo "RESULT: CANNOT EVALUATE — do not release. Supply the missing input and re-run."
  exit 2
}

[ -f "$BOARD" ] || cannot_evaluate_now "no board at $BOARD — tech-manager owns it. Run /app-plan."

# node is required, not optional. The board checks are the two most consequential preconditions;
# skipping them with a note was a gate that passed while checking nothing.
command -v node >/dev/null 2>&1 || \
  cannot_evaluate_now "node is not on PATH, so the board cannot be read. Install node and re-run."

# --- 1. the board must be coherent ---------------------------------------------------------------
# A stranded or unspawnable ticket at release time is work the sprint never reported.
node "$HERE/board-doctor.mjs" "$BOARD" >/dev/null 2>&1
case $? in
  0) ;;
  1) block "board-doctor reports anomalies. Run it and clear them before releasing." ;;
  *) unknown "board-doctor could not read $BOARD (exit 2) — board coherence was NOT checked." ;;
esac

# --- 2. no ticket may still be in flight ----------------------------------------------------------
# Delegated to scripts/ship-inflight.mjs, which reads the board through lib/board.mjs — the one
# parser. The inline awk this replaced was a third parser and failed open four separate ways; they
# are catalogued in that file's header.
ERRFILE=$(mktemp); trap 'rm -f "$ERRFILE"' EXIT
INFLIGHT=$(node "$HERE/ship-inflight.mjs" "$BOARD" 2>"$ERRFILE"); RC=$?
INFLIGHT_ERR=$(cat "$ERRFILE")
if [ "$RC" -ne 0 ]; then
  unknown "${INFLIGHT_ERR:-ship-inflight failed} — whether work is still in flight is UNKNOWN."
elif [ -n "$INFLIGHT" ]; then
  block "tickets still in flight: $(printf '%s' "$INFLIGHT" | tr '\n' ' ')"
fi

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
  # Normal on a brownfield project that has not run a /app-build QA wave — that file is only ever
  # written inside one. A routine outcome, not an exceptional one: name the owner and the fix.
  unknown "no bug board at $BUGS — qa-engineer owns it. The open-defect count is UNKNOWN, not zero. Run a QA pass (or have qa-engineer write the file recording that none was needed), then re-run."
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
  unknown "no test plan at $PLAN — qa-engineer owns it. Nothing states what was verified or what the exit criteria were. Have qa-engineer write it (a brownfield ship still needs its exit criteria on paper), then re-run."
fi

# --- verdict ---------------------------------------------------------------------------------------
echo "SHIP GATE"
if [ -n "$UNKNOWNS" ]; then printf '%s' "$UNKNOWNS"; fi
if [ -n "$BLOCKERS" ]; then printf '%s' "$BLOCKERS"; fi
if [ -n "$NOTES" ]; then printf '%s' "$NOTES"; fi

# UNKNOWN outranks BLOCKED: a blocker is a finding you can go and fix, an unknown means the gate
# never evaluated that precondition and nobody should reason about what it would have said.
if [ -n "$UNKNOWNS" ]; then
  echo
  echo "RESULT: CANNOT EVALUATE — do not release. Supply the missing inputs and re-run."
  echo "        This is NOT a pass. A precondition above was never checked."
  exit 2
fi

if [ -n "$BLOCKERS" ]; then
  echo
  echo "RESULT: BLOCKED — do not release. Fix the above, then re-run."
  exit 1
fi
echo
echo "RESULT: CLEAR — preconditions met. Proceed to the parallel readiness agents."
exit 0
