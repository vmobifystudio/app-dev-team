#!/bin/sh
# mutate — prove this repo's assertions can go red.
#
# WHY THIS EXISTS
#
# On 2026-07-29 `scripts/test.sh` reported "385 passed, 0 failed" while containing assertions that
# could not fail. They were found by hand — a reviewer broke the code and watched whether the suite
# noticed. In one afternoon that technique found:
#
#   - "the page loads nothing from the network" used a PCRE lookahead in `grep -E`. The pattern was
#     a SYNTAX ERROR, stderr went to /dev/null, and control always fell through to `|| ok`. A live
#     CDN URL sat in the page and the suite stayed green.
#   - two board-doctor assertions grepped the whole `--json` blob, so demoting an anomaly to a
#     warning — DELETING the gate — left them green. One also matched a prefix of a different code.
#   - "one parser, proven by agreement" compared two callers of the SAME function. Mutating that
#     function so every merged ticket got the wrong status left the assertion green while seven
#     unrelated ones caught it.
#   - a PreToolUse hook that could not fire (GNU-only sed on BSD), and a second version that stood
#     down in exactly the incident it was written for.
#
# A green suite is evidence only to the extent its assertions can go red. That has to be a
# mechanism, not something a reviewer happens to do on a good day. This is the mechanism.
#
# HOW IT WORKS
#
# The repo is copied ONCE to a temp dir. Each mutation is applied to that copy — never the real
# tree — `scripts/test.sh` is run there, and the copy is restored from the real tree afterwards.
# Restore is unconditional (trap). On exit the real tree is compared against the snapshot taken at
# start; a mutation tester that leaves the repo mutated is worse than no mutation tester.
#
#   CAUGHT (n assertions)  the suite went red. The gate bites.
#   SURVIVED               the suite stayed green with the gate broken. THAT IS A HOLE.
#
# `CAUGHT, but not by <label>` means the suite noticed via some other assertion while the one
# written to guard this behaviour stayed green. That is the "proven by agreement" class above: the
# named assertion is decorative even though the score looks fine.
#
# Usage:
#   sh scripts/mutate.sh                 every mutation (~1 min per mutation — the whole suite runs)
#   sh scripts/mutate.sh --list          print the catalogue and exit
#   sh scripts/mutate.sh --only M04      one mutation
#   sh scripts/mutate.sh --sample 4      4 mutations, spread evenly across the catalogue (CI)
#
# Exit:
#   0  every mutation applied was caught
#   1  at least one mutation SURVIVED
#   2  could not run — baseline suite not green, an anchor no longer matches, no git, etc.
#
# ---------------------------------------------------------------------------------------------
# THE CATALOGUE
# ---------------------------------------------------------------------------------------------
# Fields, `@@`-separated (not `|` — half these mutations are `grep -E` patterns full of `|`):
#
#     id @@ file @@ exact text to find @@ replacement @@ assertion label expected to fail
#
# The find text must occur EXACTLY ONCE in the file. Zero or many stops the run with exit 2 rather
# than reporting a survivor: a mutation whose anchor has drifted proves nothing, and silently
# counting it as survived would be its own false alarm.
#
#   id   category                          what it breaks
#   M01  invert a gate's exit code         spawn-gate REFUSED becomes GO — an unisolated parallel spawn proceeds (DR4-027)
#   M02  flip a comparison operator        ship-gate stops counting open S1/S2 bugs as blocking
#   M03  neuter a regex                    ship-gate stops rejecting CI that masks an exit code (DR4-023)
#   M04  demote an anomaly to a warning    board-doctor's review-integrity findings stop blocking the spawn
#   M05  flip a comparison operator        board-doctor blocks the second rework /app-build explicitly permits
#   M06  neuter a regex                    the one board parser truncates BUG-NNN-fix to BUG-NNN (DR4-008 class)
#   M07  guard unconditional (if false)    a role may approve its own ticket
#   M08  guard unconditional (if false)    a ticket may merge with no external approval
#   M09  guard unconditional (if false)    review may be requested on a DONE nobody verified
#        ** SURVIVES today.** Not because an assertion is decorative — because the branch is
#        unreachable: `legalEvents()` already omits `review_requested` unless `state.verified`, so
#        the transition check's own `if (!state.verified)` can never run and its better-worded
#        refusal is never the one anyone sees. Left in the catalogue deliberately: a guard that
#        reads like a gate and cannot execute is exactly what this tool is for. Resolve it by
#        deleting one of the two checks, not by deleting the mutation.
#   M10  return the fallback, not refuse   integration-branch falls back to main instead of exit 2
#   M11  guard unconditional (if false)    team-message's per-role ping-pong cap stops firing
#   M12  flip a comparison operator        team-message's chain-depth cap fires backwards
#   M13  drop a liveness check             the destructive-git hook stands down in a DIRTY tree — i.e. in exactly the incident it exists for
#   M14  neuter a regex                    the hook stops recognising `git stash`, the DR4-027 command
#   M15  neuter a regex                    verify-done calls a missing toolchain a REJECTED test (DR4-001)
#   M16  flip a comparison operator        round-journal lets the loop run one spawn past its ceiling
#
# NOT MUTATABLE HERE — declared, not hidden. Reasons are in `excluded()` below and are PRINTED with
# the score, so the denominator says what it excluded. A mutation score that quietly omits the
# untestable parts is the same lie as a green suite full of decorative assertions.
#
# ADDING ONE: a new gate ships with a mutation proving its assertion bites. See
# skills/mutation-testing/SKILL.md.

set -u

ME=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$ME/.." && pwd)
TAB=$(printf '\t')
ONLY=""
SAMPLE=""
LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --list) LIST=1; shift ;;
    --only) ONLY="${2:-}"; shift 2 || exit 2 ;;
    --only=*) ONLY="${1#--only=}"; shift ;;
    --sample) SAMPLE="${2:-}"; shift 2 || exit 2 ;;
    --sample=*) SAMPLE="${1#--sample=}"; shift ;;
    -h|--help) sed -n '36,46p' "$0"; exit 0 ;;
    *) echo "mutate: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

if [ -n "$SAMPLE" ]; then
  case "$SAMPLE" in
    ''|*[!0-9]*) echo "mutate: --sample takes a whole number" >&2; exit 2 ;;
  esac
  [ "$SAMPLE" -ge 1 ] || { echo "mutate: --sample must be >= 1" >&2; exit 2; }
fi

# ---------------------------------------------------------------------------------------------
catalogue() {
  cat <<'CATALOGUE'
M01@@scripts/spawn-gate.sh@@exit 1@@exit 0@@REFUSES two writing agents when neither has a worktree
M02@@scripts/ship-gate.sh@@[ "${OPEN:-0}" -gt 0 ] && block@@[ "${OPEN:-0}" -lt 0 ] && block@@counts open S1/S2 bugs correctly
M03@@scripts/ship-gate.sh@@grep -nE '(\|\|[[:space:]]*(true|:)([[:space:]]|$))|continue-on-error:[[:space:]]*true'@@grep -nE 'zzzz-this-pattern-matches-nothing'@@a generated workflow that masks an exit code blocks the release
M04@@scripts/board-doctor.mjs@@(reviewChecksBlock ? anomalies : warnings).push(item)@@warnings.push(item)@@emits done_without_review
M05@@scripts/board-doctor.mjs@@effectiveCycles > MAX_REVIEW_CYCLES && ACTIVE_STATUS.has(row.status)@@effectiveCycles >= MAX_REVIEW_CYCLES && ACTIVE_STATUS.has(row.status)@@Cycles = 2 in review is the budget spent, not a breach
M06@@scripts/lib/board.mjs@@/[A-Za-z]+-\d+(?:-[A-Za-z]+)?/g@@/[A-Za-z]+-\d+/g@@suffixed ticket ids parse whole (BUG-NNN-fix)
M07@@scripts/lib/events.mjs@@if (by && by === state.owner) {@@if (false) {@@the ticket's owner approving their own ticket is refused
M08@@scripts/lib/events.mjs@@if (!external.length) {@@if (false) {@@a merge with no approval at all is refused
M09@@scripts/lib/events.mjs@@if (!state.verified) {@@if (false) {@@review_requested on a DONE with no verify-done result is refused
M10@@scripts/integration-branch.sh@@integration branch is not recoverable by a later fix. Create the branch, or fix the doc."@@integration branch is not recoverable by a later fix."; echo "$FALLBACK"; exit 0@@a declared branch that does not exist is exit 2, never a fallback
M11@@scripts/lib/messages.mjs@@if (recent >= MAX_PER_ROLE) {@@if (false) {@@the per-role cap refuses the eleventh message of a round
M12@@scripts/lib/messages.mjs@@if (roles.size > MAX_CHAIN) {@@if (roles.size > MAX_CHAIN + 1) {@@a fifth role on one ticket's thread is refused
M13@@hooks/block-shared-tree-destructive-git.sh@@[ -n "$DIRTY" ] || exit 0@@[ -z "$DIRTY" ] || exit 0@@dirty tree: blocks git stash
M14@@hooks/block-shared-tree-destructive-git.sh@@*"git stash"*)@@*"zzzz-no-such-command"*)@@dirty tree: blocks git stash
M15@@scripts/verify-done.sh@@grep -Eqi 'command not found|: not found|no such file or directory|xcode-select: error|requires Xcode|xcrun: error|unable to find utility|cannot be located|[Uu]nable to find a destination|GradleWrapperMain|permission denied|not recognized as an internal'@@grep -Eqi 'zzzz-this-pattern-matches-nothing'@@a missing toolchain is CANNOT EVALUATE, not REJECTED
M16@@scripts/round-journal.mjs@@if (t.spawns >= caps.spawns) breached.push@@if (t.spawns > caps.spawns) breached.push@@the spawn ceiling fires independently of the round ceiling
M17@@scripts/lib/capabilities.mjs@@if (!allowed.includes(actor)) {@@if (false) {@@a designer may not write a gate event (verified)
M18@@scripts/lib/capabilities.mjs@@if (NOT_ON_OWN_TICKET.has(name) && state && same(actor, state.owner)) {@@if (false) {@@QA may not pass the ticket it owns
M19@@scripts/lib/events.mjs@@if (record.hash !== expected) {@@if (false) {@@an edited line is detected, with the line number
M20@@scripts/lib/redact.mjs@@if (isPlaceholder(value)) continue;@@if (true) continue;@@the artifact scan fails on a credential-shaped string
M21@@scripts/spawn-gate.sh@@if [ -e "$STOP_ROOT/$STOP_FILE" ]; then@@if false; then@@spawn-gate refuses while the emergency stop file exists
M22@@scripts/injection-scan.mjs@@if (pattern.test(raw)) findings.push@@if (false) findings.push@@instruction-shaped content in repository text is reported
M23@@scripts/ship-gate.sh@@node "$HERE/board.mjs" verify --log "$LOG" >/dev/null 2>&1@@true@@ship-gate BLOCKS a release whose event log was rewritten
M24@@scripts/messages.mjs@@if (obligationOf(candidate) === null) {@@if (false) {@@an answer that names no artifact is REFUSED
M25@@scripts/lib/messages.mjs@@if (prior) {@@if (false) {@@a duplicate question on one ticket is refused
M26@@scripts/lib/messages.mjs@@if (decided.length && openQuestions(thread).length === 0 && !candidate.evidence) {@@if (false) {@@reopening a decided thread with no evidence is refused
M27@@scripts/lib/messages.mjs@@if (mine.length) {@@if (false) {@@a second open question from one role is refused — escalate the first
M28@@scripts/lib/messages.mjs@@if (spent >= MAX_PER_TICKET) {@@if (false) {@@the thirteenth message on one ticket is refused
M29@@scripts/lib/messages.mjs@@m.expires && m.expires < today@@m.expires && m.expires > today@@an expired waiver is a finding, not a formality
M30@@scripts/lib/messages.mjs@@if (record.v !== SCHEMA_VERSION) {@@if (false) {@@a schema-v2 record makes board-doctor CANNOT EVALUATE, never a pass
M31@@scripts/messages.mjs@@writeFileSync(md, renderMessages(messages));@@if (!existsSync(md)) writeFileSync(md, renderMessages(messages));@@a hand edit to the generated view is overwritten by the next render
M32@@scripts/accessibility-scan.mjs@@&& !/accessibilityLabel/.test(block)@@&& false@@comment-only and unlabelled SwiftUI controls remain detectable
M33@@scripts/privacy-disclosure-scan.mjs@@if (!findings.length)@@if (true)@@a blanket privacy claim with outbound identity data blocks release
M34@@scripts/subscription-restore-scan.mjs@@&& !/Transaction\.currentEntitlements/.test(match[1])@@&& false@@a sync-only restore path blocks release
M35@@scripts/financial-constant-scan.mjs@@if (!findings.length)@@if (true)@@a bankers rounding implementation under a half-up rule blocks release
M36@@scripts/requirements-conflict-scan.mjs@@if (prdQuota && archQuota && prdQuota !== archQuota)@@if (false)@@a quota conflict blocks release
M37@@scripts/analytics-coverage-scan.mjs@@if (!missing.length)@@if (true)@@a missing P0 analytics event blocks release
CATALOGUE
}

catalogue_tsv() { catalogue | awk '{ gsub(/@@/, "\t"); print }'; }

# Assertions that exist but CANNOT be mutation-tested on this host, with the reason. Printed with
# the score. Counted in neither numerator nor denominator — and said out loud, because a score that
# silently drops what it could not test is the failure mode this tool exists to catch.
excluded() {
  cat <<'EXCLUDED'
runtime-gate.sh — the build, install, launch and liveness paths@@Needs Xcode, a booted simulator, or adb. The suite only exercises runtime-gate's CANNOT-EVALUATE branches; the branches that decide PASS vs FAIL never execute on this host or in CI, so nothing would go red for a mutation in them. This is the gate whose whole job is running the artifact, and it is the one we cannot mutation-test.
runtime-gate.sh — the xcodebuild / gradle invocations themselves@@Same reason. A mutation to a build command is invisible without a mobile toolchain.
ship-gate.sh — the malformed-WAIVED: branch@@No fixture reaches it. Mutating it would report SURVIVED, but the cause is a missing fixture, not a decorative assertion. Write the fixture first, then add the mutation; reporting it as a hole today would be a false alarm, which is how a tool like this gets switched off.
network-dependent assertions@@There are none in this suite, deliberately. If one is ever added it belongs on this list rather than in the score, because a mutation caught only when the network is up is not caught.
EXCLUDED
}

if [ "$LIST" = "1" ]; then
  echo "MUTATION CATALOGUE"
  echo
  catalogue_tsv | while IFS="$TAB" read -r id file old new expect; do
    printf '%-5s %s\n' "$id" "$file"
    printf '      - %s\n' "$old"
    printf '      + %s\n' "$new"
    printf '      expects to fail: %s\n\n' "$expect"
  done
  echo "NOT MUTATABLE HERE"
  excluded | awk '{ gsub(/@@/, "\t"); print }' | while IFS="$TAB" read -r what why; do
    printf '  · %s\n      %s\n' "$what" "$why"
  done
  exit 0
fi

# An unknown --only id is rejected HERE, before the baseline suite runs. Not only because a minute
# of waiting to be told about a typo is rude: `scripts/test.sh` asserts on this path, and the copy's
# suite would otherwise invoke a baseline run of its own, recursively, forever.
if [ -n "$ONLY" ]; then
  catalogue | grep -q "^$ONLY@@" \
    || { echo "mutate: no mutation with id '$ONLY'. Try --list." >&2; exit 2; }
fi

# ---------------------------------------------------------------------------------------------
# The copy, and the guarantee that the real tree is untouched.
# ---------------------------------------------------------------------------------------------
command -v git >/dev/null 2>&1 || { echo "mutate: CANNOT RUN — git is not on PATH" >&2; exit 2; }
git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "mutate: CANNOT RUN — $REPO is not a git work tree, so 'the tree is unchanged' cannot be proven" >&2; exit 2; }

# The snapshot the tree must still match on exit. Not "empty": the operator may legitimately have
# uncommitted work in progress. What must not change is *this* set.
BEFORE=$(git -C "$REPO" status --porcelain -uall)

WORK=$(mktemp -d) || { echo "mutate: CANNOT RUN — no temp dir" >&2; exit 2; }
RC=2
cleanup() {
  rm -rf "$WORK"
  AFTER=$(git -C "$REPO" status --porcelain -uall)
  if [ "$BEFORE" != "$AFTER" ]; then
    echo
    echo "FATAL: the working tree changed during this run. A mutation may be left in place."
    echo "       Nothing here writes to the real tree, so this means something else did — but"
    echo "       check the diff before trusting the repo."
    echo "  before:"; printf '%s\n' "$BEFORE" | sed 's/^/    /'
    echo "  after:";  printf '%s\n' "$AFTER"  | sed 's/^/    /'
    exit 2
  fi
  exit "$RC"
}
trap cleanup EXIT INT TERM HUP

( cd "$REPO" && tar cf - --exclude .git . ) | ( cd "$WORK" && tar xf - ) \
  || { echo "mutate: CANNOT RUN — could not copy the repo" >&2; RC=2; exit 2; }

# `.git` is deliberately NOT copied. In a worktree it is a *file* pointing at the real repository's
# gitdir, so every git command in the copy would operate on the real tree — the exact accident this
# script exists to make impossible. An empty init is enough: the suite has one assertion whose
# subject is verify-done's behaviour inside a repo, and without any git context it reads
# CANNOT EVALUATE (exit 2) instead of REJECTED (exit 1) and the baseline is never green.
git -C "$WORK" init -q -b main . >/dev/null 2>&1 \
  || { echo "mutate: CANNOT RUN — could not init the copy" >&2; RC=2; exit 2; }

# Tells the suite that one line of this tree is deliberately broken. The suite has exactly one
# assertion that would otherwise fail under EVERY mutation — it checks that each catalogue anchor
# still appears once in its target file, which is false for the anchor currently replaced. Without
# this, the suite becomes a detector of its own mutation tester: every gate reports CAUGHT and a
# genuine survivor is masked. Observed on the first run of this script.
#
# Nothing else reads it, and it is exported for the baseline run too, so the mutated and unmutated
# runs assert exactly the same set.
export APP_TEAM_MUTATING=1

# run_suite <logfile> — echoes the failure count ("?" if the suite never reported one).
run_suite() {
  ( cd "$WORK" && sh scripts/test.sh ) >"$1" 2>&1
  awk 'match($0, /[0-9]+ passed, [0-9]+ failed/) {
         split(substr($0, RSTART, RLENGTH), a, " "); n = a[3]
       }
       END { print (n == "" ? "?" : n) }' "$1"
}
suite_passed() {
  awk 'match($0, /[0-9]+ passed, [0-9]+ failed/) { split(substr($0, RSTART, RLENGTH), a, " "); n = a[1] }
       END { print (n == "" ? "?" : n) }' "$1"
}

echo "MUTATION TESTING"
echo "  repo: $REPO"
echo "  copy: $WORK"
echo

printf 'baseline (unmutated suite) ... '
BASE_FAIL=$(run_suite "$WORK/baseline.log")
if [ "$BASE_FAIL" != "0" ]; then
  echo "NOT GREEN"
  echo
  echo "CANNOT RUN: the suite reports $BASE_FAIL failure(s) before any mutation is applied."
  echo "Every mutation would then read as CAUGHT for the wrong reason. Fix the suite first."
  tail -n 20 "$WORK/baseline.log"
  RC=2; exit 2
fi
echo "green — $(suite_passed "$WORK/baseline.log") assertions"
echo

# --- select --------------------------------------------------------------------------------------
catalogue_tsv > "$WORK/cat.txt"
TOTAL=$(grep -c . "$WORK/cat.txt")

if [ -n "$ONLY" ]; then
  grep "^$ONLY$TAB" "$WORK/cat.txt" > "$WORK/sel.txt"
elif [ -n "$SAMPLE" ]; then
  # Spread across the catalogue rather than taking the first N: consecutive entries share target
  # files, and a sample that only ever probes one script tells CI nothing about the rest.
  awk -v n="$SAMPLE" -v total="$TOTAL" '
    BEGIN { if (n > total) n = total; step = total / n; at = 1 }
    { if (taken < n && NR >= at - 0.0001) { print; taken++; at += step } }
  ' "$WORK/cat.txt" > "$WORK/sel.txt"
else
  cp "$WORK/cat.txt" "$WORK/sel.txt"
fi
SELECTED=$(grep -c . "$WORK/sel.txt")

CAUGHT=0
SURVIVED=0
SURVIVORS=""
BLIND=""
I=0

while IFS="$TAB" read -r id file old new expect <&3; do
  [ -n "$id" ] || continue
  I=$((I + 1))
  printf '[%d/%d] %-5s %s\n' "$I" "$SELECTED" "$id" "$file"

  src="$REPO/$file"
  dst="$WORK/$file"
  [ -f "$src" ] || { echo "        CANNOT RUN: no such file: $file"; RC=2; exit 2; }

  # Literal, first-occurrence substitution. Passed through the ENVIRONMENT, not `awk -v`, because
  # -v processes backslash escapes — it would turn the `\d` in M06's pattern into a bare `d` and
  # quietly mutate the mutation. Every occurrence is counted so a drifted anchor is loud rather
  # than a phantom survivor.
  MUT_OLD="$old" MUT_NEW="$new" awk '
    BEGIN { old = ENVIRON["MUT_OLD"]; new = ENVIRON["MUT_NEW"]; n = 0; done = 0 }
    {
      rest = $0
      while ((i = index(rest, old)) > 0) { n++; rest = substr(rest, i + length(old)) }
      if (!done) {
        i = index($0, old)
        if (i > 0) { $0 = substr($0, 1, i - 1) new substr($0, i + length(old)); done = 1 }
      }
      print
    }
    END { exit (n == 1 ? 0 : (n == 0 ? 3 : 4)) }
  ' "$src" > "$dst.mut"
  arc=$?
  if [ "$arc" = "3" ]; then
    echo "        CANNOT RUN: the anchor for $id no longer appears in $file."
    echo "        Fix the catalogue entry. An unanchored mutation proves nothing."
    rm -f "$dst.mut"; RC=2; exit 2
  elif [ "$arc" = "4" ]; then
    echo "        CANNOT RUN: the anchor for $id appears more than once in $file."
    echo "        Make it unique. Mutating an arbitrary one of several sites proves nothing."
    rm -f "$dst.mut"; RC=2; exit 2
  fi
  mv "$dst.mut" "$dst"

  fails=$(run_suite "$WORK/run-$id.log")
  grep '^  FAIL  ' "$WORK/run-$id.log" | sed 's/^  FAIL  //' > "$WORK/labels-$id.txt"

  # Unconditional restore, whatever the verdict was.
  cp "$src" "$dst"

  if [ "$fails" = "?" ]; then
    echo "        CANNOT RUN: the suite printed no 'N passed, M failed' line under $id."
    echo "        It crashed rather than failing, and a crash is not a verdict."
    tail -n 10 "$WORK/run-$id.log" | sed 's/^/        /'
    RC=2; exit 2
  elif [ "$fails" = "0" ]; then
    SURVIVED=$((SURVIVED + 1))
    SURVIVORS="$SURVIVORS$id|$file|$expect
"
    echo "        SURVIVED — the suite stayed green with this gate broken"
    echo "        should have failed: $expect"
  else
    CAUGHT=$((CAUGHT + 1))
    if grep -qF -- "$expect" "$WORK/labels-$id.txt"; then
      echo "        CAUGHT ($fails assertions)"
    else
      BLIND="$BLIND$id|$expect
"
      echo "        CAUGHT ($fails assertions) — but NOT by the assertion written for it"
      echo "        expected: $expect"
      printf '        actual:   %s\n' "$(head -n 1 "$WORK/labels-$id.txt")"
    fi
  fi
  echo
done 3< "$WORK/sel.txt"

# ---------------------------------------------------------------------------------------------
echo "─────────────────────────────────────────"
echo "MUTATION SCORE: $CAUGHT/$SELECTED caught"
[ "$SELECTED" != "$TOTAL" ] && echo "  ($SELECTED of $TOTAL catalogued mutations — a sample, not the whole of it)"
echo
echo "Denominator: $SELECTED mutations over $(cut -f2 "$WORK/sel.txt" | sort -u | grep -c .) file(s)."
echo "It EXCLUDES the following, which cannot be mutation-tested on this host:"
excluded | awk '{ gsub(/@@/, "\t"); print }' | while IFS="$TAB" read -r what why; do
  printf '  · %s\n      %s\n' "$what" "$why"
done
echo "  Those assertions are UNPROVEN here. The score does not claim otherwise."
echo

if [ -n "$BLIND" ]; then
  echo "CAUGHT BY THE WRONG ASSERTION — the guard written for this behaviour stayed green:"
  printf '%s' "$BLIND" | while IFS='|' read -r id expect; do
    [ -n "$id" ] && printf '  %s  %s\n' "$id" "$expect"
  done
  echo "  Not a hole today — the suite noticed. But that assertion is decorative, and the next"
  echo "  refactor that touches the unrelated one takes the coverage with it."
  echo
fi

if [ "$SURVIVED" -gt 0 ]; then
  echo "SURVIVORS — $SURVIVED gate(s) can be broken without this suite noticing:"
  printf '%s' "$SURVIVORS" | while IFS='|' read -r id file expect; do
    [ -n "$id" ] && printf '  %s  %s\n        should have failed: %s\n' "$id" "$file" "$expect"
  done
  echo
  echo "Each is an assertion that cannot go red. Re-run one with:  sh scripts/mutate.sh --only <id>"
  RC=1
else
  echo "Every mutation applied was caught. These gates bite."
  RC=0
fi

exit "$RC"
