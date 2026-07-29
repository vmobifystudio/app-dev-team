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
RELEASES="$ROOT/docs/60-releases.md"
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
# --- waivers ---------------------------------------------------------------------------------
# /app-ship's only route from a CANNOT EVALUATE to a release is a human appending
#     WAIVED: <artifact> — <who waived it> — <reason>
# to docs/60-releases.md. No script wrote that line and no script read it, so the single path that
# converts a non-pass into a ship was pure improvisation — precisely what this file was written to
# replace everywhere else in the command. It is read here, and held to its own stated shape.
#
# waiver_for <artifact> — prints "<who> — <reason>" and returns 0 when a well-formed waiver names
# exactly this artifact; returns 1 otherwise. The separator is the em dash /app-ship writes, with
# `--` accepted as its ASCII spelling. All three fields must be present and non-empty: "WAIVED:
# docs/51-bugs.md" on its own is a record that someone skipped a gate, not a decision anyone can be
# held to, and a waiver nobody signed is indistinguishable from a check that was never there.
waiver_for() {
  [ -f "$RELEASES" ] || return 1
  awk -v want="$1" '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    /WAIVED:/ {
      line = $0
      sub(/^.*WAIVED:/, "", line)
      gsub(/--/, "—", line)
      n = split(line, f, "—")
      if (n < 3) next
      if (trim(f[1]) != want) next
      who = trim(f[2]); why = trim(f[3])
      if (who == "" || why == "") next
      print who " — " why
      found = 1
      exit
    }
    END { exit (found ? 0 : 1) }
  ' "$RELEASES"
}

# unknown_unless_waived <artifact> <unknown-message> — the missing input still gets named either
# way. A waived gate must never look like a skipped one, so a waiver is REPORTED, not silent.
unknown_unless_waived() {
  W=$(waiver_for "$1") && { note "WAIVED: $1 by $W"; return 0; }
  if [ -f "$RELEASES" ] && grep -q "WAIVED:.*$1" "$RELEASES" 2>/dev/null; then
    unknown "$2
           A WAIVED: line naming $1 exists in docs/60-releases.md but is MALFORMED, so it does not
           count. It must read: WAIVED: $1 — <who waived it> — <reason>, all three present."
  else
    unknown "$2"
  fi
}

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
ERRFILE=$(mktemp); STATICF=$(mktemp); trap 'rm -f "$ERRFILE" "$STATICF"' EXIT
INFLIGHT=$(node "$HERE/ship-inflight.mjs" "$BOARD" 2>"$ERRFILE"); RC=$?
INFLIGHT_ERR=$(cat "$ERRFILE")
if [ "$RC" -ne 0 ]; then
  unknown "${INFLIGHT_ERR:-ship-inflight failed} — whether work is still in flight is UNKNOWN."
else
  STILL=$(printf '%s' "$INFLIGHT" | grep -v 'static-only' || true)
  [ -n "$STILL" ] && block "tickets still in flight: $(printf '%s' "$STILL" | tr '\n' ' ')"

  # --- 2b. no ticket may ship on a suite that never ran ------------------------------------------
  # `verified_static` says "reviewed, but the executable suite was never executed". It unlocks
  # review, approval and merge on purpose — a broken toolchain must not also cost the code review.
  # It must NOT unlock a release. It did: lib/board.mjs parsed `qa (static only)` back to a plain
  # `qa`, board-doctor never mentioned the flag, ship-inflight dropped it, and this gate printed
  # CLEAR on a sprint asserting a suite that had never executed. A waiver is the only route past it,
  # keyed on the ticket ID, and it is REPORTED — a waived gate must never look like a skipped one.
  #
  # Via a file, not a pipe: `... | while read` runs the loop in a SUBSHELL in POSIX sh, so every
  # `block` it appended would be discarded and the gate would print CLEAR having found the defect.
  printf '%s\n' "$INFLIGHT" | grep 'static-only' > "$STATICF" || true
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    TID=${entry%%(*}
    if W=$(waiver_for "$TID"); then
      note "WAIVED: $TID shipped static-only (suite never ran) by $W"
    else
      block "$TID is verified_static — its test suite has NEVER RUN, so 'tests green' is unproven.
           Run the suite and append the real verdict:
             board.mjs move $TID verified --by <role> --detail \"<what ran>\"
           Or waive it deliberately in docs/60-releases.md:
             WAIVED: $TID — <who waived it> — <reason>"
    fi
  done < "$STATICF"
fi

# --- 3. no open S1/S2 bug -------------------------------------------------------------------------
if [ -f "$BUGS" ]; then
  # Delegated to lib/board.mjs `parseBugs` — the one parser, same rule as the in-flight check above.
  # This was two inline greps, and one of them fail-opened: `[^\n]*` in a POSIX bracket expression
  # means "not backslash and not the letter n", so the gate reported 0 open S1/S2 with two open. It
  # only showed up because the behaviour differed between the interactive shell and `sh`. When the
  # portfolio needed the same count across N projects, a second reader would have been the third.
  #
  # The library path goes in as an ARGUMENT, never interpolated into the -e source: this plugin's
  # own install path contains spaces, and a path spliced into JS is one apostrophe from a syntax
  # error that would make every project report zero open bugs.
  COUNTS=$(node -e 'const [lib, file] = process.argv.slice(1);
import(lib).then((m) => {
  const b = m.parseBugs(require("node:fs").readFileSync(file, "utf8"));
  process.stdout.write(`${b.blocking.length} ${b.deferred.length}`);
}).catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });' \
    "$HERE/lib/board.mjs" "$BUGS" 2>"$ERRFILE"); RC=$?
  if [ "$RC" -ne 0 ] || [ -z "$COUNTS" ]; then
    unknown "$BUGS could not be parsed ($(cat "$ERRFILE")) — the open-defect count is UNKNOWN, not zero."
  else
    OPEN=${COUNTS%% *}
    DEFERRED=${COUNTS##* }
    [ "${OPEN:-0}" -gt 0 ] && block "$OPEN open S1/S2 bug(s) on the bug board."
    [ "${DEFERRED:-0}" -gt 0 ] && note "$DEFERRED open S3/S4 bug(s) — not blocking, but name them in the release notes."
  fi
else
  # Normal on a brownfield project that has not run a /app-build QA wave — that file is only ever
  # written inside one. A routine outcome, not an exceptional one: name the owner and the fix.
  unknown_unless_waived "docs/51-bugs.md" \
    "no bug board at $BUGS — qa-engineer owns it. The open-defect count is UNKNOWN, not zero. Run a QA pass (or have qa-engineer write the file recording that none was needed), then re-run."
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
  unknown_unless_waived "docs/50-test-plan.md" \
    "no test plan at $PLAN — qa-engineer owns it. Nothing states what was verified or what the exit criteria were. Have qa-engineer write it (a brownfield ship still needs its exit criteria on paper), then re-run."
fi

# --- 5. the generated CI must be able to go red ---------------------------------------------------
# DR4-023. The devops agent wrote a workflow whose Build and Test steps both ended `| xcbeautify ||
# true`, so a failing test exited zero. It would have shipped dry run 4's real money bug green — in a
# repo whose own `defect-hunting` §3 says a rule that cannot fail is worse than no rule. The agent
# reproduced the exact anti-pattern the skill exists to forbid, and nothing inspected the file.
#
# DR4-024. The same workflow ran `brew install swiftlint` while the project's own
# 21-engineering-principles.md bans SwiftLint by name — a pipeline performing an install nobody
# asked for, against the project's own stated rules.
#
# Both are now prose rules in agents/devops-engineer.md. Prose is what produced the defect. This is
# the executable half. Absent CI is not a finding: plenty of projects ship without a workflow, and
# turning that into a blocker would make the gate unusable on exactly those projects.
#
# Globbed, never `for wf in $(find ...)`: this plugin's own install path contains spaces, and an
# unquoted word split turns one workflow into two nonexistent files — every check below then reads
# nothing and passes, which is the failure mode this whole section exists to stop.
for wf in "$ROOT"/.github/workflows/*.yml "$ROOT"/.github/workflows/*.yaml; do
  if [ -f "$wf" ]; then
    REL=${wf#"$ROOT"/}

    # `|| true`, `|| :` and continue-on-error each turn a red step green. Quoted per line so the
    # blocker names the step a human has to go and look at.
    MASKED=$(grep -nE '(\|\|[[:space:]]*(true|:)([[:space:]]|$))|continue-on-error:[[:space:]]*true' "$wf" 2>/dev/null || true)
    [ -n "$MASKED" ] && block "$REL masks an exit code, so a failing step reports green:
$(printf '%s' "$MASKED" | sed 's/^/             /')
           Remove the mask. A CI that cannot go red manufactures confidence (DR4-023)."

    # A pipe is the subtler half: GitHub Actions' DEFAULT shell is `bash -e {0}` WITHOUT pipefail,
    # so `xcodebuild test | xcbeautify` exits with xcbeautify's status and the compiler's failure is
    # discarded. `shell: bash` (which adds -eo pipefail) or an explicit `set -o pipefail` fixes it.
    #
    # PER STEP, not per file. `grep -q pipefail "$wf"` scanned the WHOLE workflow, so the safety of
    # one step cleared every other one — and a COMMENT reading "we do not set pipefail anywhere"
    # disabled the check outright. Reproduced: the same unguarded `xcodebuild test | xcbeautify`
    # went from BLOCKED to CLEAR when an unrelated step gained `shell: bash`. Comments are stripped
    # before anything is matched, so no prose can vouch for a step.
    #
    # A `defaults:` block IS legitimately file-wide (GitHub applies it to every run step), so a
    # `shell: bash` there really does clear the file — and only there.
    PIPED=$(awk '
      function flush(   i) {
        if (nbuf == 0) return
        if (!safe && !globalsafe)
          for (i = 1; i <= nbuf; i++)
            if (buf[i] ~ /(xcodebuild|gradlew|swift (build|test)|npm (test|run)|pytest|go test|cargo test|dotnet test)[^|]*\|[^|]/)
              print bufno[i] ":" buf[i]
        nbuf = 0; safe = 0
      }
      {
        code = $0; sub(/#.*/, "", code)                       # a comment can never vouch for a step
        if (code ~ /^[[:space:]]*defaults:/) { indefaults = 1; dind = match(code, /[^ ]/) }
        else if (indefaults && code ~ /[^[:space:]]/ && match(code, /[^ ]/) <= dind) indefaults = 0
        if (indefaults && code ~ /shell:[[:space:]]*bash/) globalsafe = 1
        if (code ~ /^[[:space:]]*-[[:space:]]/) flush()        # a new list item starts a new step
        nbuf++; buf[nbuf] = code; bufno[nbuf] = NR
        if (code ~ /pipefail/ || code ~ /shell:[[:space:]]*bash/) safe = 1
      }
      END { flush() }
    ' "$wf" 2>/dev/null || true)
    [ -n "$PIPED" ] && block "$REL pipes a build/test command in a step with no pipefail, so the build's exit code is thrown away:
$(printf '%s' "$PIPED" | sed 's/^/             /')
           Add \`set -o pipefail\` (or \`shell: bash\`) to THAT step, or do not pipe (DR4-023)."

    # An install in a workflow is a dependency the project never declared. It also silently pins
    # whatever version the package manager serves that morning.
    INSTALLS=$(grep -nE '(brew install|apt-get +(-[a-z]+ +)*install|apt +install|npm +(i|install) +(-g|--global)|gem install|pip3? install)' "$wf" 2>/dev/null || true)
    [ -n "$INSTALLS" ] && block "$REL installs a tool the project has not declared:
$(printf '%s' "$INSTALLS" | sed 's/^/             /')
           Check it against docs/21-engineering-principles.md — the project's rules beat the House KB
           defaults. An undeclared tool is a question for the ledger, not an install (DR4-024)."
  fi
done

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
