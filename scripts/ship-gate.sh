#!/bin/sh
# ship-gate — decide whether a sprint may be released. Read-only by default.
#
# /app-ship's preconditions were prose for the orchestrator to improvise. Improvising them went
# wrong three times in one session: a `grep | sed || echo` guard that could not fail, a field-index
# mistake that reported a ticket in the wrong column, and a chain that printed BLOCKED on a clean
# board. Every one of those errors was silent and confident.
#
# `sprint-planner` requires that every Definition-of-Done gate name a runnable command. The release
# gate is the most consequential gate in the plugin and it did not have one. This is it.
#
# Usage:  sh scripts/ship-gate.sh [project-root] [--record]
#   --record   also write the verdict to <project-root>/docs/team/ship-gate-verdict.json, so
#              anything durable (the control room, a later run of this same gate) can read what the
#              last real evaluation said without re-running it. Opt-in, not the default: a project
#              root is sometimes a read-only fixture or someone else's checkout, and "read-only"
#              is this script's own documented contract — /app-ship and release-manager pass it.
# Exit:   0 clear to ship
#         1 BLOCKED — the gate evaluated every precondition and one of them says no
#         2 CANNOT EVALUATE — an input was missing or unreadable, so some precondition was never
#           checked at all. Distinct from 1 on purpose: "I could not look" is not "I looked and it
#           was fine", and a missing bug board or test plan used to be reported as a plain blocker,
#           which invited "it's only blocked because the file isn't there yet" as an override.
#
# There is no path from a check that did not run to exit 0.

set -u
ROOT=.
RECORD=0
for arg in "$@"; do
  case "$arg" in
    --record) RECORD=1 ;;
    *) ROOT="$arg" ;;
  esac
done
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
# canonical_version — the LAST `## vX.Y.Z` heading in docs/60-releases.md (mirrors
# version-consistency-check.mjs's own "last heading wins" rule), or nothing if this project has
# never declared one. Used below to scope a waiver to the release it was actually written for.
canonical_version() {
  [ -f "$RELEASES" ] || return 1
  awk '
    /^##[ \t]+v[0-9]+\.[0-9]+\.[0-9]+/ {
      line = $0
      sub(/^##[ \t]+v/, "", line)
      split(line, a, /[ \t]/)
      v = a[1]
    }
    END { if (v != "") print v; else exit 1 }
  ' "$RELEASES"
}

# waiver_for <artifact> — prints "<who> — <reason>" and returns 0 when a well-formed waiver names
# exactly this artifact; returns 1 otherwise. The separator is the em dash /app-ship writes, with
# `--` accepted as its ASCII spelling. All three fields must be present and non-empty: "WAIVED:
# docs/51-bugs.md" on its own is a record that someone skipped a gate, not a decision anyone can be
# held to, and a waiver nobody signed is indistinguishable from a check that was never there.
#
# SHIP-P0-005 (external audit, 2026-08-01): waivers used to be scanned with no version binding
# whatsoever — an old waiver written for v0.1.0 satisfied a check run against v9.0.0. Reproduced.
# Once a project has declared a canonical version (`## vX.Y.Z` in docs/60-releases.md), a waiver
# must name it as a fourth field to count: `WAIVED: <artifact> — <who> — <reason> — vX.Y.Z`. A
# project that has never declared a version (nothing to bind to yet) keeps the three-field form —
# this is additive, not a breaking change to every waiver ever written.
waiver_for() {
  [ -f "$RELEASES" ] || return 1
  CANON=$(canonical_version 2>/dev/null || true)
  awk -v want="$1" -v canon="$CANON" '
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
      if (canon != "") {
        if (n < 4) next
        ver = trim(f[4]); sub(/^v/, "", ver)
        if (ver != canon) next
      }
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
    CANON=$(canonical_version 2>/dev/null || true)
    if [ -n "$CANON" ]; then
      unknown "$2
           A WAIVED: line naming $1 exists in docs/60-releases.md but is MALFORMED, WRONG-ARTIFACT,
           or does not name the current release (v$CANON), so it does not count. It must read:
           WAIVED: $1 — <who waived it> — <reason> — v$CANON, all four present."
    else
      unknown "$2
           A WAIVED: line naming $1 exists in docs/60-releases.md but is MALFORMED, so it does not
           count. It must read: WAIVED: $1 — <who waived it> — <reason>, all three present."
    fi
  else
    unknown "$2"
  fi
}

# record_verdict <CLEAR|BLOCKED|CANNOT_EVALUATE> — the ONLY place this gate's verdict outlives the
# process that ran it. Dry run 5 (Android fixture) found the control room's Mission Control panel
# could show release readiness as `clear` while this gate returned BLOCKED, because nothing durable
# ever recorded that this gate ran, or what it said — the panel only ever swept ticket/bug state,
# which is a different, narrower population than this file checks. Writing the verdict here, and
# reading it back in `scripts/lib/project.mjs`, closes that gap without control-room re-running this
# shell script on every page load (a second orchestrator, which this repo does not do). A verdict
# stays authoritative until a NEWER run overwrites it — an old BLOCKED does not silently go away
# just because time passed; only re-running this gate can clear it.
record_verdict() {
  [ "$RECORD" = 1 ] || return 0
  mkdir -p "$ROOT/docs/team" 2>/dev/null || return 0
  SHIP_GATE_RESULT="$1" SHIP_GATE_BLOCKERS="$BLOCKERS" SHIP_GATE_UNKNOWNS="$UNKNOWNS" SHIP_GATE_NOTES="$NOTES" \
    node -e '
      const fs = require("node:fs");
      const split = (s) => s.split("\n").map((l) => l.replace(/^\s*(BLOCKED|UNKNOWN|note)\s*/, "").trim()).filter(Boolean);
      const record = {
        schema: "ship-gate-verdict/v1",
        result: process.env.SHIP_GATE_RESULT,
        evaluated_at: new Date().toISOString(),
        blockers: split(process.env.SHIP_GATE_BLOCKERS || ""),
        unknowns: split(process.env.SHIP_GATE_UNKNOWNS || ""),
        notes: split(process.env.SHIP_GATE_NOTES || ""),
      };
      fs.writeFileSync(process.argv[1], JSON.stringify(record, null, 2) + "\n");
    ' "$ROOT/docs/team/ship-gate-verdict.json" 2>/dev/null || true
}

cannot_evaluate_now() {
  echo "SHIP GATE"
  echo "  UNKNOWN  $1"
  echo
  echo "RESULT: CANNOT EVALUATE — do not release. Supply the missing input and re-run."
  UNKNOWNS="$1"
  record_verdict CANNOT_EVALUATE
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

# High-confidence SwiftUI accessibility tripwire. This complements, rather than replaces, the
# human/platform accessibility review: an icon-only button below 44pt with no label is sufficiently
# concrete to block a release, while projects with no Swift sources are not forced through a
# platform-specific check.
SWIFT_FILES=$(find "$ROOT" -type f -name '*.swift' -not -path '*/.git/*' -not -path '*/Pods/*' 2>/dev/null || true)
if [ -n "$SWIFT_FILES" ]; then
  node "$HERE/accessibility-scan.mjs" "$ROOT" >/dev/null 2>&1
  case $? in
    0) ;;
    1) block "accessibility-scan found a high-confidence unlabelled, undersized SwiftUI control." ;;
    *) unknown "accessibility-scan could not evaluate the Swift sources." ;;
  esac
fi

# Release-connected defect tripwires. Each detector is intentionally narrow and remains advisory
# about semantics, but a positive high-confidence finding is a release blocker. Missing optional
# product artifacts are reported as notes here because the dedicated human reviewers still own the
# full privacy, monetization, product, and analytics reviews; a present artifact must never silently
# bypass its detector.
run_detector() {
  DETECTOR_NAME=$1
  shift
  "$@" >/dev/null 2>&1
  DETECTOR_RC=$?
  case "$DETECTOR_RC" in
    0) ;;
    1) block "$DETECTOR_NAME found a release defect. Run it directly for the file-level finding." ;;
    *) unknown "$DETECTOR_NAME could not evaluate the project." ;;
  esac
}

run_detector "injection-scan" node "$HERE/injection-scan.mjs" "$ROOT"
run_detector "dependency-check" node "$HERE/dependency-check.mjs" "$ROOT"
[ -f "$ROOT/docs/15-aso.md" ] && run_detector "privacy-disclosure-scan" node "$HERE/privacy-disclosure-scan.mjs" "$ROOT"
[ -f "$ROOT/docs/10-prd.md" ] && run_detector "financial-constant-scan" node "$HERE/financial-constant-scan.mjs" "$ROOT"
[ -f "$ROOT/docs/10-prd.md" ] && [ -f "$ROOT/docs/20-architecture.md" ] && \
  run_detector "requirements-conflict-scan" node "$HERE/requirements-conflict-scan.mjs" "$ROOT"
[ -f "$ROOT/docs/10-prd.md" ] && [ -f "$ROOT/docs/52-analytics.md" ] && \
  run_detector "analytics-coverage-scan" node "$HERE/analytics-coverage-scan.mjs" "$ROOT"
[ -n "$SWIFT_FILES" ] && run_detector "subscription-restore-scan" node "$HERE/subscription-restore-scan.mjs" "$ROOT"
# SHIP-P0-006: this guard only recognized `version: X.Y.Z` prose, not release-manager.md's own
# required release-note heading `## vX.Y.Z — YYYY-MM-DD` — so the checker never even ran on a
# correctly-formatted release note. Recognize both shapes; the checker's own regex mirrors this.
[ -f "$ROOT/docs/60-releases.md" ] && grep -qiE '(^|[[:space:]])(release[[:space:]]+)?version[[:space:]]*[:=]|^##[[:space:]]+v[0-9]+\.[0-9]+\.[0-9]+' "$ROOT/docs/60-releases.md" 2>/dev/null && \
  run_detector "version-consistency-check" node "$HERE/version-consistency-check.mjs" "$ROOT"
[ -f "$ROOT/.studio-policy.json" ] && run_detector "policy-check" node "$HERE/policy-check.mjs" "$ROOT"

# Revamp P0 trust controls are opt-in per project policy until existing app repositories have
# adopted the artifacts. Once enabled, absence is CANNOT EVALUATE, never an implicit pass.
if [ -f "$ROOT/.studio-policy.json" ]; then
  grep -q '"requireDurableRuns"[[:space:]]*:[[:space:]]*true' "$ROOT/.studio-policy.json" 2>/dev/null && \
    run_detector "run-doctor" node "$HERE/run-doctor.mjs" --ledger "$ROOT/docs/team/runs.jsonl"
  # `approval-check.mjs` verifies that every approval names a commit that is still reachable from
  # the candidate being shipped — but that comparison only happens when it is GIVEN the candidate,
  # via `--head`. This call omitted it, so the one check that ties an approval to the thing being
  # released did the least useful half of its job: it confirmed the approval had a commit field and
  # never asked whether that commit is in what ships. An approval for an abandoned branch passed.
  #
  # Reported by the 2026-08-01 app-ship audit (SHIP-P1-001) and verified still live in the tree on
  # 2026-08-04. Resolving HEAD here also makes the failure mode honest: a project root that is not
  # a git repository cannot have its approvals bound to a candidate at all, and that is CANNOT
  # EVALUATE — not a silent pass, which is what omitting `--head` quietly produced.
  if grep -q '"requireApprovalBinding"[[:space:]]*:[[:space:]]*true' "$ROOT/.studio-policy.json" 2>/dev/null; then
    SHIP_HEAD=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)
    # A DIRTY TREE MEANS HEAD IS NOT THE CANDIDATE. `rev-parse HEAD` happily returns the last
    # approved commit while staged, unstaged or untracked files sit in the working tree — and the
    # runtime gate, the build and the release tooling all consume the TREE, not the commit. So
    # approval-check could clear a SHA that nobody is actually shipping.
    #
    # Reported by codex on PR #21, on the very commit that first passed `--head` at all: binding to
    # the right commit is worthless if the thing being released is not that commit. This is FC-001
    # again — the fix landed in the argument and stopped before the thing the argument describes.
    if [ -z "$SHIP_HEAD" ]; then
      unknown "requireApprovalBinding is on, but $ROOT is not a git repository (or has no commits),
           so no approval can be checked against the candidate being shipped. Approval binding is
           UNKNOWN here, not clear."
    elif [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
      # Three distinct states, three distinct messages. The first version of this cleared SHIP_HEAD
      # to skip the detector and then fell through to the `else`, so a DIRTY repo was reported as
      # "not a git repository" as well — two UNKNOWNs for one cause, one of them false. Caught by
      # running it against a real dirty repo rather than by reading the diff, which is §4b's own
      # point turned back on the person who wrote it.
      unknown "requireApprovalBinding is on and HEAD is $SHIP_HEAD, but the working tree is DIRTY —
           uncommitted or untracked changes mean the tree being released is not the commit any
           approval was bound to. Approval binding is UNKNOWN, not clear. Commit or stash the
           changes (\`git -C $ROOT status\` lists them) and re-run."
    else
      run_detector "approval-check" node "$HERE/approval-check.mjs" --log "$ROOT/docs/31-board-events.jsonl" \
        --policy "$ROOT/.studio-policy.json" --head "$SHIP_HEAD"
    fi
  fi
  grep -q '"requireAuditAnchor"[[:space:]]*:[[:space:]]*true' "$ROOT/.studio-policy.json" 2>/dev/null && \
    run_detector "audit-anchor" node "$HERE/audit-anchor.mjs" verify --log "$ROOT/docs/31-board-events.jsonl" --out "$ROOT/docs/team/audit-anchor.json"
  grep -q '"requirePromptRegistry"[[:space:]]*:[[:space:]]*true' "$ROOT/.studio-policy.json" 2>/dev/null && \
    run_detector "prompt-registry" node "$HERE/prompt-registry.mjs" --registry "$ROOT/docs/team/prompt-registry.json"
  grep -q '"requireEvaluation"[[:space:]]*:[[:space:]]*true' "$ROOT/.studio-policy.json" 2>/dev/null && \
    run_detector "eval-lab" node "$HERE/eval-lab.mjs" --manifest "$ROOT/eval/manifest.json"
fi

# --- 1b. the audit chain must be intact -----------------------------------------------------------
#
# Release is where rewriting the event log pays off: every gate below reads state derived from it, so
# one edited `approved` line ships an unreviewed ticket with every check reporting green. Checked
# here rather than only in CI because CI runs on a push and a release does not have to be one.
#
# Three states, kept apart on purpose: intact, BROKEN (a rewritten history — not a rule violation,
# and the message says so), and CANNOT EVALUATE when there is no log to read.
LOG="$ROOT/docs/31-board-events.jsonl"
if [ -f "$LOG" ]; then
  node "$HERE/board.mjs" verify --log "$LOG" >/dev/null 2>&1
  case $? in
    0) ;;
    1) block "the board's audit chain is BROKEN — the event log was edited, reordered or truncated after it was written. Run: node scripts/board.mjs verify. Every gate below reads state derived from that log." ;;
    *) unknown "board.mjs verify could not read $LOG — the audit chain was NOT checked." ;;
  esac
else
  # A NOTE, not an UNKNOWN. Everywhere else in this file "I could not look" must not read as "it was
  # fine" — but a project with no event log has no chained history to rewrite, so "there is nothing
  # here to verify" is a true statement rather than a gap. Treating it as UNKNOWN would block every
  # release on every board that predates the log, which is how a control gets switched off.
  note "no event log at $LOG — this board has no chained history, so there is nothing to verify. Boards written by scripts/board.mjs carry one."
fi

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
#
# This used to grep for loose hold-language ("hold", "blocked", ...) and only ever call note() —
# so the ONE THING app-ship.md promises stops a release (a QA hold) never actually reached the exit
# code CI and automation consume. Confirmed by reproduction: an explicit "Recommendation: HOLD —
# composition journey failed" line in the test plan still returned ship-gate RESULT CLEAR. Fixed by
# giving QA a structured, one-line verdict the gate can key on instead of reading prose: a plan with
# no verdict line is CANNOT EVALUATE, same as every other missing-input case in this file, not a
# silent pass.
if [ -f "$PLAN" ]; then
  if grep -qE '^QA VERDICT:[[:space:]]*HOLD\b' "$PLAN" 2>/dev/null; then
    block "$(grep -E '^QA VERDICT:[[:space:]]*HOLD\b' "$PLAN" | head -1) — read docs/50-test-plan.md's exit criteria before overriding."
  elif grep -qE '^QA VERDICT:[[:space:]]*GO\b' "$PLAN" 2>/dev/null; then
    :
  else
    unknown_unless_waived "qa-verdict" \
      "docs/50-test-plan.md has no 'QA VERDICT: GO' or 'QA VERDICT: HOLD — <reason>' line — whether qa-engineer is willing to ship is UNKNOWN, not clear. Have qa-engineer add the verdict line, then re-run."
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
  record_verdict CANNOT_EVALUATE
  exit 2
fi

if [ -n "$BLOCKERS" ]; then
  echo
  echo "RESULT: BLOCKED — do not release. Fix the above, then re-run."
  record_verdict BLOCKED
  exit 1
fi
echo
echo "RESULT: CLEAR — preconditions met. Proceed to the parallel readiness agents."
record_verdict CLEAR
exit 0
