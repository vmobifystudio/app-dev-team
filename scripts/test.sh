#!/bin/sh
# test — the regression suite for this plugin's scripts.
#
# CONTRIBUTING requires that any script added here has "a fixture-tested cascade: run it against a
# deliberately broken input and confirm every branch fires before you ship it." That instruction was
# unfollowable — the fixtures lived only in a scratch directory and every check was run by hand.
# A rule nobody can execute is the thing `defect-hunting` exists to stop.
#
# Every assertion below corresponds to a defect that was actually shipped and then found by running
# the thing. The comments name them, so a future change that breaks one knows what it is undoing.
#
# Usage:  sh scripts/test.sh [-v]
# Exit:   0 all passed · 1 one or more failed

set -u
HERE=$(cd "$(dirname "$0")" && pwd)
FIX="$HERE/fixtures"
VERBOSE=${1:-}
PASS=0
FAIL=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ok()   { PASS=$((PASS+1)); [ "$VERBOSE" = "-v" ] && echo "  ok    $1" || true; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL  $1"; [ -n "${2:-}" ] && echo "        $2"; }

# assert_exit <expected> <label> <command...>
assert_exit() {
  want=$1; label=$2; shift 2
  "$@" >"$TMP/out" 2>"$TMP/err"; got=$?
  [ "$got" = "$want" ] && ok "$label" || bad "$label" "expected exit $want, got $got"
}

# assert_has <fixture-output-file> <needle> <label>
assert_has() {
  grep -q -- "$2" "$1" && ok "$3" || bad "$3" "missing: $2"
}

# assert_finding <doctor-json> <code> <label> [needle]
#
# Asserts a *blocking finding* with that exact code, optionally naming <needle>. Deliberately not
# `grep code "$json"`: the JSON carries warnings too, and a broken check demoted from findings to
# warnings still greps clean — proven, when demoting one left this suite green. An assertion that
# cannot tell a finding from a warning is the "rule that cannot fail" class, in the test file.
assert_finding() {
  node -e '
const [, json, code, needle] = process.argv;
process.exit(require(json).findings.some(
  (f) => f.code === code && (!needle || JSON.stringify(f).includes(needle))
) ? 0 : 1);
' "$1" "$2" "${4:-}" && ok "$3" || bad "$3" "no blocking finding ${2}${4:+ naming $4}"
}

# assert_exit_within <seconds> <expected> <label> <command...>
#
# For assertions about a script that must not HANG. `assert_exit` would wait forever on a
# regression, and a suite that hangs reports nothing at all — the failure mode is indistinguishable
# from a machine that went to sleep. There is no `timeout(1)` on macOS, hence the watchdog.
assert_exit_within() {
  secs=$1; want=$2; label=$3; shift 3
  rm -f "$TMP/rc"
  ( "$@" >"$TMP/out" 2>"$TMP/err"; echo $? > "$TMP/rc" ) & job=$!
  # The watchdog polls for the result file and returns on its own, rather than being killed — a
  # signalled background job makes the shell print "Terminated" into the middle of the suite output.
  ( i=0
    while [ "$i" -lt "$secs" ]; do
      [ -f "$TMP/rc" ] && exit 0
      sleep 1; i=$((i + 1))
    done
    kill -9 "$job" 2>/dev/null ) & dog=$!
  wait "$job" 2>/dev/null; jrc=$?
  wait "$dog" 2>/dev/null
  got=$(cat "$TMP/rc" 2>/dev/null || echo "")
  if [ "$jrc" -eq 137 ] || [ -z "$got" ]; then
    bad "$label" "did not exit within ${secs}s — it hung"
  elif [ "$got" = "$want" ]; then ok "$label"
  else bad "$label" "expected exit $want, got $got"
  fi
  rm -f "$TMP/rc"
}

echo "SCRIPT TESTS"
echo

# --------------------------------------------------------------------------------------------
echo "board-doctor"
# --------------------------------------------------------------------------------------------
assert_exit 0 "clean board passes"            node "$HERE/board-doctor.mjs" "$FIX/clean.md"
assert_exit 1 "broken board blocks"           node "$HERE/board-doctor.mjs" "$FIX/broken.md"
assert_exit 1 "stranded board blocks"         node "$HERE/board-doctor.mjs" "$FIX/stranded.md"
assert_exit 0 "legacy board degrades to warn" node "$HERE/board-doctor.mjs" "$FIX/legacy.md"
assert_exit 2 "missing board is exit 2"       node "$HERE/board-doctor.mjs" "$TMP/nope.md"

node "$HERE/board-doctor.mjs" "$FIX/broken.md" --json > "$TMP/broken.json" 2>/dev/null
CODES=$(node -e 'const j=require(process.argv[1]);console.log([...new Set(j.anomalies.map(a=>a.code))].sort().join(" "))' "$TMP/broken.json")
for c in duplicate_id owner_missing owner_invalid owner_not_spawnable status_invalid \
         dependency_missing dependency_self self_review done_without_review \
         cycle_cap_breached cycles_invalid ledger_action_unknown; do
  case " $CODES " in *" $c "*) ok "emits $c" ;; *) bad "emits $c" "not in: $CODES" ;; esac
done

# The silent-drop defect: a todo behind a blocked dep is neither ready nor reported.
node "$HERE/board-doctor.mjs" "$FIX/stranded.md" --json > "$TMP/str.json" 2>/dev/null
node -e '
const j=require(process.argv[1]);
const s=j.anomalies.filter(a=>a.code==="stranded").map(a=>a.ticketId).sort();
process.exit(JSON.stringify(s)===JSON.stringify(["APP-002","APP-003"])?0:1);
' "$TMP/str.json" && ok "stranded is transitive (APP-002 and APP-003)" \
                  || bad "stranded is transitive (APP-002 and APP-003)"

# Regression: BUG-NNN-fix is the documented bug-intake ID form. A bare [A-Za-z]+-\d+ pattern
# truncated it to BUG-003 and reported dependency_missing against a ticket on the same board.
node -e '
import("'"$HERE"'/lib/board.mjs").then(m=>{
  const d=m.parseDependencies("BUG-001-fix, APP-010");
  process.exit(JSON.stringify(d)===JSON.stringify(["BUG-001-FIX","APP-010"])?0:1);
});' && ok "suffixed ticket ids parse whole (BUG-NNN-fix)" \
     || bad "suffixed ticket ids parse whole (BUG-NNN-fix)"

# Regression: an unknown ledger word must never be silently dropped — a REQUEST CHANGES once
# vanished because the parser filtered it and reported the milder 'review never started'.
assert_has "$TMP/broken.json" "ledger_action_unknown" "unknown ledger action is raised, not dropped"

# ...but an append-only log needs a repair path, or one typo blocks the board forever.
cp "$FIX/broken.md" "$TMP/superseded.md"
printf '| 2026-07-29T09:20Z | APP-005 | changes | code-reviewer |\n' >> "$TMP/superseded.md"
node "$HERE/board-doctor.mjs" "$TMP/superseded.md" --json > "$TMP/sup.json" 2>/dev/null
node -e '
const j=require(process.argv[1]);
const blocking=j.anomalies.some(a=>a.code==="ledger_action_unknown"&&a.ticketId==="APP-005");
const warned=j.warnings.some(a=>a.code==="ledger_action_unknown_superseded");
process.exit(!blocking&&warned?0:1);
' "$TMP/sup.json" && ok "a corrected ledger word supersedes (warns, does not block)" \
                  || bad "a corrected ledger word supersedes (warns, does not block)"

# Regression: team-protocol promised board-doctor checked these; it had never opened the ledger.
node "$HERE/board-doctor.mjs" "$FIX/clean.md" --json > "$TMP/msg.json" 2>/dev/null
node -e '
const j=require(process.argv[1]);
const w=j.warnings;
const unanswered=w.filter(x=>x.code==="question_unanswered").map(x=>x.ticketId).sort();
const pair=w.some(x=>x.code==="message_pair_exceeded"&&x.ticketId==="BUG-003-fix");
// APP-002 asked and was answered -> must NOT be flagged. APP-001 and BUG-003-fix must be.
const ok = JSON.stringify(unanswered)===JSON.stringify(["APP-001","BUG-003-fix"]) && pair;
process.exit(ok?0:1);
' "$TMP/msg.json" && ok "unanswered questions and pair-limit breaches are reported" \
                  || bad "unanswered questions and pair-limit breaches are reported"

# Regression: "any answer resolves any question" is a false negative the moment a ticket has two.
node "$HERE/board-doctor.mjs" "$FIX/clean.md" 2>/dev/null | grep -q "2 of 3 question(s) on this ticket are unresolved" \
  && ok "resolutions pair with questions by count, not existence" \
  || bad "resolutions pair with questions by count, not existence"

node "$HERE/board-doctor.mjs" "$FIX/clean.md" 2>/dev/null | grep -q "shipped on an unconfirmed assumption" \
  && ok "a question unanswered on a shipped ticket says so" \
  || bad "a question unanswered on a shipped ticket says so"

# Definition of Ready: a ticket that forces the developer to guess is a planning defect.
node "$HERE/board-doctor.mjs" "$FIX/not-ready.md" --json > "$TMP/ready.json" 2>/dev/null
node -e '
const j=require(process.argv[1]);
const f=[...new Set(j.warnings.filter(w=>w.code==="not_ready").map(w=>w.ticketId))].sort();
// APP-001 thin, APP-002 no observable outcome, APP-003 no spec anchor, APP-004 well-formed.
process.exit(JSON.stringify(f)===JSON.stringify(["APP-001","APP-002","APP-003"])?0:1);
' "$TMP/ready.json" && ok "flags unworkable tickets and leaves a well-formed one alone" \
                    || bad "flags unworkable tickets and leaves a well-formed one alone"

# Regression: the review-cycle cap fired on every status, so a ticket that legitimately spent its
# two cycles and then merged stayed a BLOCKING anomaly for the life of the board — the pre-spawn
# gate went permanently red on any sprint that had ever used its review budget.
assert_exit 0 "a done ticket that spent its whole review budget still passes" \
  node "$HERE/board-doctor.mjs" "$FIX/cycles-spent.md"
node "$HERE/board-doctor.mjs" "$FIX/cycles-spent.md" --json 2>/dev/null | grep -q cycle_cap_breached \
  && bad "Cycles over the cap on a done ticket raises nothing" \
  || ok "Cycles over the cap on a done ticket raises nothing"

# ...and the fix must have NARROWED the check, not deleted it. Same board, same Cycles, still in
# review: the loop can act on this ticket, so the cap is exactly what should stop it.
sed 's/| done |/| review |/' "$FIX/cycles-spent.md" > "$TMP/cycles-review.md"
node "$HERE/board-doctor.mjs" "$TMP/cycles-review.md" --json > "$TMP/cyc.json" 2>/dev/null
assert_has "$TMP/cyc.json" "cycle_cap_breached" "the same Cycles on a ticket still in review does breach"

# Regression: the cap was off by one. `effectiveCycles >= MAX_REVIEW_CYCLES` fired at Cycles = 2,
# but /app-build allows 2 review cycles and stops the loop on the THIRD REQUEST CHANGES — so the
# doctor blocked the second rework the command explicitly permits, and the documented retry flow
# could not complete. Cycles = 2 is a fully-spent budget, not a breach; only above it is.
sed 's/| done | 3 |/| review | 2 |/' "$FIX/cycles-spent.md" > "$TMP/cycles-at-cap.md"
node "$HERE/board-doctor.mjs" "$TMP/cycles-at-cap.md" --json > "$TMP/atcap.json" 2>/dev/null
grep -q cycle_cap_breached "$TMP/atcap.json" \
  && bad "Cycles = 2 in review is the budget spent, not a breach (the 3rd is the breach)" \
  || ok "Cycles = 2 in review is the budget spent, not a breach (the 3rd is the breach)"
assert_exit 0 "...so a ticket on its documented second rework is still spawnable" \
  node "$HERE/board-doctor.mjs" "$TMP/cycles-at-cap.md"

# Regression: self_review from the ledger had no correction path. The ledger is append-only and
# LEDGER_ACTIONS has no void/supersede verb, so the prescribed remediation ("void the approval")
# was impossible to perform legally — a mistaken owner-approval flagged forever. Same supersede
# pattern this repo already established for unknown ledger actions: evaluate the EFFECTIVE state.
SR="$TMP/selfreview.md"
cat > "$SR" <<'EOF'
# Sprint board — an owner-approval later corrected by a real reviewer

| ID | Feature | Title | Owner | Reviewer | Status | Cycles | Depends on | Estimate | Spec | Acceptance | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| APP-001 | F-001 | Login | ios-developer | code-reviewer | qa | 0 | — | M | prd#F-001 | Given a user, when they sign in, then the home screen appears | — |

## Review ledger (append-only — never edit or delete a line)

| Timestamp | Ticket | Action | Actor |
|---|---|---|---|
| 2026-07-29T09:00Z | APP-001 | requested | ios-developer -> code-reviewer |
| 2026-07-29T09:10Z | APP-001 | approved | ios-developer |
EOF
assert_exit 1 "an owner-approval with nothing after it still blocks" node "$HERE/board-doctor.mjs" "$SR"
printf '| 2026-07-29T10:00Z | APP-001 | approved | code-reviewer |\n' >> "$SR"
node "$HERE/board-doctor.mjs" "$SR" --json > "$TMP/sr.json" 2>/dev/null
node -e '
const j=require(process.argv[1]);
const blocking=j.anomalies.some(a=>a.code==="self_review");
const warned=j.warnings.some(a=>a.code==="self_review_superseded");
process.exit(!blocking&&warned?0:1);
' "$TMP/sr.json" && ok "a later legitimate approval supersedes it (warns, does not block)" \
                 || bad "a later legitimate approval supersedes it (warns, does not block)"

echo
# --------------------------------------------------------------------------------------------
echo "board-render"
# --------------------------------------------------------------------------------------------
for f in clean stranded broken legacy; do
  assert_exit 0 "renders $f without crashing" node "$HERE/board-render.mjs" "$FIX/$f.md" --no-color
done
node "$HERE/board-render.mjs" "$FIX/stranded.md" --no-color > "$TMP/r.txt" 2>/dev/null
assert_has "$TMP/r.txt" "STRANDED" "render surfaces stranded tickets"
node "$HERE/board-render.mjs" "$FIX/clean.md" --out "$TMP/view.md" --no-color >/dev/null 2>&1
assert_has "$TMP/view.md" "mermaid" "render writes a mermaid graph"

echo
# --------------------------------------------------------------------------------------------
echo "verify-done"
# --------------------------------------------------------------------------------------------
R="$TMP/repo"; mkdir -p "$R"
( cd "$R" && git init -q -b main . && git config user.email t@t.t && git config user.name T \
  && echo a > a.txt && git add a.txt && git commit -qm init ) >/dev/null 2>&1

assert_exit 1 "rejects a branch that does not exist" sh "$HERE/verify-done.sh" nope main "true"
( cd "$R" && git checkout -q -b feat/empty && git checkout -q main ) >/dev/null 2>&1
( cd "$R" && sh "$HERE/verify-done.sh" feat/empty main "true" ) >/dev/null 2>&1
[ $? = 1 ] && ok "rejects a branch with no commits" || bad "rejects a branch with no commits"
( cd "$R" && git checkout -q feat/empty && echo b > b.txt && git add b.txt && git commit -qm work && git checkout -q main ) >/dev/null 2>&1
( cd "$R" && sh "$HERE/verify-done.sh" feat/empty main "true" ) >/dev/null 2>&1
[ $? = 0 ] && ok "accepts real work with passing tests" || bad "accepts real work with passing tests"
( cd "$R" && sh "$HERE/verify-done.sh" feat/empty main "false" ) >/dev/null 2>&1
[ $? = 1 ] && ok "rejects failing tests" || bad "rejects failing tests"

# Regression: agent-isolation puts every branch in a worktree, and `git checkout` refuses a branch
# already checked out elsewhere. verify-done rejected every honest DONE until it ran tests in place.
( cd "$R" && git worktree add -q wt feat/empty ) >/dev/null 2>&1
( cd "$R" && sh "$HERE/verify-done.sh" feat/empty main "true" ) >"$TMP/vd.txt" 2>&1
if [ $? = 0 ] && grep -q "VERIFIED" "$TMP/vd.txt"; then
  ok "verifies a branch live in a worktree (no checkout)"
else
  bad "verifies a branch live in a worktree (no checkout)" "$(head -2 "$TMP/vd.txt")"
fi

# Regression: --docs-only parsed only as $1, but team-protocol documents the TRAILING form. The
# flag landed in $3, was taken as the test command and executed (`sh: --: invalid option`), so a
# doc ticket was REJECTED for failing the test the flag exempts it from. Both forms, or neither.
( cd "$R" && git checkout -q -b docs/flows && echo "# flows" > flows.md && git add flows.md \
  && git commit -qm docs && git checkout -q main ) >/dev/null 2>&1

( cd "$R" && sh "$HERE/verify-done.sh" docs/flows main --docs-only ) >"$TMP/doc1.txt" 2>&1
if [ $? = 0 ] && grep -q "tests=n/a (docs-only)" "$TMP/doc1.txt"; then
  ok "--docs-only in trailing position verifies a doc branch"
else
  bad "--docs-only in trailing position verifies a doc branch" "$(head -3 "$TMP/doc1.txt")"
fi

( cd "$R" && sh "$HERE/verify-done.sh" --docs-only docs/flows main ) >"$TMP/doc2.txt" 2>&1
if [ $? = 0 ] && grep -q "tests=n/a (docs-only)" "$TMP/doc2.txt"; then
  ok "--docs-only in leading position gives the identical result"
else
  bad "--docs-only in leading position gives the identical result" "$(head -3 "$TMP/doc2.txt")"
fi

( cd "$R" && sh "$HERE/verify-done.sh" --docs-only docs/flows main "true" ) >/dev/null 2>&1
[ $? = 2 ] && ok "--docs-only with a test command is a usage error" \
            || bad "--docs-only with a test command is a usage error"

# --docs-only relaxes the TEST requirement and nothing else. A doc branch with no commits is still
# an unsupported DONE claim — the flag must not become a way to wave a ticket through.
( cd "$R" && git checkout -q -b docs/empty && git checkout -q main ) >/dev/null 2>&1
( cd "$R" && sh "$HERE/verify-done.sh" docs/empty main --docs-only ) >/dev/null 2>&1
[ $? = 1 ] && ok "--docs-only still rejects a branch with no commits" \
            || bad "--docs-only still rejects a branch with no commits"

# Regression: the failing-test output went to /dev/null while the verdict told the loop to
# re-spawn "with these failures verbatim" — there were none to hand over.
#
# The marker is emitted by a script FILE, never named in the command string. Written inline as
# `"echo NOPE_MARKER_7; exit 1"` this assertion passed with the output still going to /dev/null:
# verify-done echoes the command it is about to run, so the grep matched its own argument. An
# assertion tripped by its own input is the defect this suite exists to catch, found in the suite.
printf '#!/bin/sh\necho NOPE_MARKER_7\nexit 1\n' > "$TMP/faketest.sh"
( cd "$R" && sh "$HERE/verify-done.sh" feat/empty main "sh $TMP/faketest.sh" ) >"$TMP/vf.txt" 2>&1
assert_has "$TMP/vf.txt" "NOPE_MARKER_7" "a failing test's own output is quoted in the rejection"

# Regression: exit 0 meant three different things — tests green, tests exempt (--docs-only), and
# tests never run. /app-build reads the exit code and does not parse stdout, so "nobody ran the
# tests" was indistinguishable from "the tests passed". The stated exemption stays a 0; the unknown
# gets the same code every other gate in this repo uses for it.
( cd "$R" && sh "$HERE/verify-done.sh" feat/empty main ) >"$TMP/vnone.txt" 2>&1
[ $? = 2 ] && ok "a code ticket with no test command is CANNOT EVALUATE, not a pass" \
            || bad "a code ticket with no test command is CANNOT EVALUATE, not a pass" "$(head -3 "$TMP/vnone.txt")"
assert_has "$TMP/vnone.txt" "NOT a pass" "...and says so in words, not only in the exit code"

# Regression: with the branch not already in a worktree, verify-done ran `git checkout` in the
# SHARED tree. /app-build explicitly runs verification alongside still-running developers, so that
# rejected a valid DONE whenever another agent's files were dirty, carried those files onto the
# branch under test, and moved HEAD under an agent mid-edit. Three failures from one line.
D="$TMP/dirtyrepo"; mkdir -p "$D"
( cd "$D" && git init -q -b main . && git config user.email t@t.t && git config user.name T \
  && echo one > a.txt && git add a.txt && git commit -qm init \
  && git checkout -q -b feat/rework && echo two > a.txt && echo c > c.txt \
  && git add -A && git commit -qm work && git checkout -q main \
  && echo "uncommitted work by another agent" > a.txt ) >/dev/null 2>&1

( cd "$D" && sh "$HERE/verify-done.sh" feat/rework main "test -f c.txt" ) >"$TMP/vdirty.txt" 2>&1
VDRC=$?
if [ "$VDRC" = 0 ] && grep -q "VERIFIED" "$TMP/vdirty.txt"; then
  ok "verifies a branch while the shared tree is dirty (temporary worktree, no checkout)"
else
  bad "verifies a branch while the shared tree is dirty (temporary worktree, no checkout)" "$(head -3 "$TMP/vdirty.txt")"
fi
# ...and it left the other agent's tree exactly where it found it.
[ "$( cd "$D" && git rev-parse --abbrev-ref HEAD )" = "main" ] \
  && ok "...without moving HEAD under the agent that is still working" \
  || bad "...without moving HEAD under the agent that is still working"
[ "$( cd "$D" && cat a.txt )" = "uncommitted work by another agent" ] \
  && ok "...and without touching its uncommitted files" \
  || bad "...and without touching its uncommitted files"
# The temporary worktree is cleaned up by the trap, or the next round starts in a littered repo.
[ "$( cd "$D" && git worktree list | wc -l | tr -d ' ' )" = "1" ] \
  && ok "...and the temporary worktree is removed on exit" \
  || bad "...and the temporary worktree is removed on exit" "$( cd "$D" && git worktree list )"

# --docs-only was unreachable: `grep -rn docs-only commands/` returned nothing and /app-build always
# passed a test command, so the flag the whole doc-ticket path depends on could never fire.
# Grep for the INVOCATION, not the word. A file that merely mentions `--docs-only` in passing is
# exactly the state this was in: skills/team-protocol documented the call, and the loop never made
# it. Mentioning a flag is not wiring it.
grep -q 'verify-done.sh" <branch> "\$BASE" --docs-only' "$HERE/../commands/app-build.md" \
  && ok "/app-build actually passes --docs-only for doc-profile tickets" \
  || bad "/app-build actually passes --docs-only for doc-profile tickets"
# The roster has to be named where the flag is used, or the loop cannot tell which tickets get it.
MISSING_ROLE=""
for role in ux-designer qa-engineer aso-specialist data-analyst verification-engineer; do
  grep -q -- "--docs-only" "$HERE/../commands/app-build.md" \
    && sed -n '/pass .--docs-only. instead/,/^     Branch, commits/p' "$HERE/../commands/app-build.md" \
       | grep -q "$role" || MISSING_ROLE="$MISSING_ROLE $role"
done
[ -z "$MISSING_ROLE" ] && ok "...naming every doc-profile role where the flag is used" \
                       || bad "...naming every doc-profile role where the flag is used" "missing:$MISSING_ROLE"

# No role executed a constant anywhere INSIDE the sprint loop. code-reviewer routes constants and
# guard-rules to verification-engineer rather than running them; verification-engineer was spawned
# only by /app-ship. So a mis-calibrated threshold introduced in an ordinary ticket was executed by
# nobody before it merged — defect-hunting §2 cited everywhere and performed nowhere in the loop.
# The two halves must agree on the field name, or the gate is wired to a line that is never emitted.
for field in "Constants routed to verification-engineer:" "Rules routed to verification-engineer:"; do
  if grep -qF "$field" "$HERE/../agents/code-reviewer.md" \
     && grep -qF "$field" "$HERE/../commands/app-build.md"; then
    ok "reviewer and /app-build agree on \"$field\""
  else
    bad "reviewer and /app-build agree on \"$field\"" "emitted or read by only one of them"
  fi
done
sed -n '/^4\. \*\*Process reviewer verdicts/,/^4a\./p' "$HERE/../commands/app-build.md" \
  | grep -q "spawn \`verification-engineer\`" \
  && ok "a flagged constant spawns verification-engineer before the merge gate" \
  || bad "a flagged constant spawns verification-engineer before the merge gate"
sed -n '/^4\. \*\*Process reviewer verdicts/,/^4a\./p' "$HERE/../commands/app-build.md" \
  | grep -q "VERIFICATION: FAIL" \
  && ok "...and its FAIL gates the merge alongside the review verdict" \
  || bad "...and its FAIL gates the merge alongside the review verdict"

echo
# --------------------------------------------------------------------------------------------
echo "team-message"
# --------------------------------------------------------------------------------------------
M="$HERE/team-message.sh"
send() { ( cd "$1" && shift && sh "$M" "$@" ) >/dev/null 2>&1; }

# Regression: a RELATIVE default path once wrote a team message into an unrelated repository.
mkdir -p "$R/deep/nested"
send "$R/deep/nested" --from ios-developer --to tech-lead --ticket APP-1 --kind question --summary s
[ -f "$R/docs/team/messages.md" ] && ok "ledger anchors to the repo root, not the cwd" \
                                  || bad "ledger anchors to the repo root, not the cwd"
[ -d "$R/deep/nested/docs" ] && bad "no stray ledger in the subdirectory" || ok "no stray ledger in the subdirectory"

OUTSIDE="$TMP/nogit"; mkdir -p "$OUTSIDE"
( cd "$OUTSIDE" && sh "$M" --from ios-developer --to tech-lead --ticket APP-1 --kind question --summary s ) >/dev/null 2>&1
[ $? = 2 ] && ok "refuses to guess a location outside a git repo" || bad "refuses to guess a location outside a git repo"

send "$R" --from ios-developer --to tech-lead --ticket APP-1 --kind question --summary s2
( cd "$R" && sh "$M" --from ios-developer --to tech-lead --ticket APP-1 --kind question --summary s3 ) >/dev/null 2>&1
[ $? = 1 ] && ok "pair cooldown refuses a third A->B on one ticket" || bad "pair cooldown refuses a third A->B on one ticket"
( cd "$R" && sh "$M" --from ios-developer --to tech-manager --ticket APP-1 --kind escalation --summary esc ) >/dev/null 2>&1
[ $? = 0 ] && ok "escalation always passes the guard" || bad "escalation always passes the guard"
( cd "$R" && sh "$M" --from tech-lead --to tech-lead --ticket APP-1 --kind fyi --summary x ) >/dev/null 2>&1
[ $? = 2 ] && ok "refuses a message to self" || bad "refuses a message to self"

# A fresh repo per scenario, because every guard below counts rows in the ledger and a shared
# ledger would make each test depend on the ones before it.
newrepo() {
  d="$TMP/$1"; mkdir -p "$d"
  ( cd "$d" && git init -q -b main . && git config user.email t@t.t && git config user.name T ) >/dev/null 2>&1
  printf '%s' "$d"
}

# Regression: only --summary and --body were sanitized. A `|` in --ticket or --from splits the row
# into extra cells and every field after it shifts one column left for the parser — the Kind column
# reads a role name and the ticket disappears, so the guards below then count a thread that does
# not exist. A row is only as trustworthy as its least-escaped field.
P=$(newrepo tm-pipe)
send "$P" --from "tech-lead | acting" --to ios-developer --ticket "APP-001 | APP-002" --kind fyi --summary s
LED="$P/docs/team/messages.md"
[ "$(awk -F'|' 'NF>1 {print NF}' "$LED" | sort -u | wc -l | tr -d ' ')" = "1" ] \
  && ok "a piped --ticket/--from does not change the row's column count" \
  || bad "a piped --ticket/--from does not change the row's column count" "$(tail -1 "$LED")"
node -e '
import("'"$HERE"'/lib/board.mjs").then(async (m) => {
  const fs = await import("node:fs");
  const [e] = m.parseMessages(fs.readFileSync(process.argv[1], "utf8"));
  // Kind must still be in the Kind column: that is the field the shift used to eat.
  process.exit(e && e.kind === "fyi" && e.from === "tech-lead / acting" ? 0 : 1);
});' "$LED" && ok "lib/board.mjs parses the escaped row back into the right columns" \
             || bad "lib/board.mjs parses the escaped row back into the right columns"

# CHANGELOG claimed all four guard branches were tested firing; only the pair limit was. The
# per-role cap is a rate limit on one agent's turn — ten sends that each pass every other guard.
C=$(newrepo tm-cap)
i=1
while [ "$i" -le 5 ]; do
  send "$C" --from ios-developer --to tech-lead --ticket "MSG-$i" --kind fyi --summary "a$i"
  send "$C" --from ios-developer --to tech-lead --ticket "MSG-$i" --kind fyi --summary "b$i"
  i=$((i + 1))
done
SENT=$(grep -c '^| 20' "$C/docs/team/messages.md")
[ "$SENT" = "10" ] && ok "ten sends under every other guard are all accepted" \
                   || bad "ten sends under every other guard are all accepted" "wrote $SENT rows"
( cd "$C" && sh "$M" --from ios-developer --to tech-lead --ticket MSG-9 --kind fyi --summary over ) >/dev/null 2>&1
[ $? = 1 ] && ok "the per-role cap refuses the eleventh message of a round" \
            || bad "the per-role cap refuses the eleventh message of a round"

# Chain depth: a question relayed through more than four roles is an escalation wearing a question's
# clothes. Counted on the roles the message WOULD create, not the ones already recorded.
H=$(newrepo tm-chain)
send "$H" --from ios-developer --to tech-lead --ticket CH-1 --kind question --summary q1
send "$H" --from qa-engineer --to ux-designer --ticket CH-1 --kind fyi --summary q2
( cd "$H" && sh "$M" --from data-analyst --to tech-lead --ticket CH-1 --kind fyi --summary q3 ) >/dev/null 2>&1
[ $? = 1 ] && ok "a fifth role on one ticket's thread is refused" \
            || bad "a fifth role on one ticket's thread is refused"

# Regression: ticketless rows all keyed on "-", so every unrelated broadcast FYI deepened the same
# pseudo-thread and the pair guard then refused sends on tickets nobody had discussed.
T=$(newrepo tm-noticket)
send "$T" --from ios-developer --to tech-lead --ticket - --kind fyi --summary n1
send "$T" --from ios-developer --to tech-lead --ticket - --kind fyi --summary n2
( cd "$T" && sh "$M" --from ios-developer --to tech-lead --ticket - --kind fyi --summary n3 ) >/dev/null 2>&1
[ $? = 0 ] && ok "ticketless messages do not accumulate into one pseudo-thread" \
            || bad "ticketless messages do not accumulate into one pseudo-thread"

echo
# --------------------------------------------------------------------------------------------
echo "ship-gate"
# --------------------------------------------------------------------------------------------
assert_exit 1 "blocks on an open S1/S2 and an in-flight ticket" sh "$HERE/ship-gate.sh" "$FIX/ship-blocked"
assert_exit 0 "clears a genuinely shippable sprint"             sh "$HERE/ship-gate.sh" "$FIX/ship-clear"

# Regression: `[^\n]*` in a POSIX bracket expression means "not backslash, not the letter n" — the
# gate reported 0 open S1/S2 with two open, and only differed between the interactive shell and sh.
sh "$HERE/ship-gate.sh" "$FIX/ship-blocked" 2>/dev/null | grep -q "1 open S1/S2" \
  && ok "counts open S1/S2 bugs correctly (no [^\\n] regex)" \
  || bad "counts open S1/S2 bugs correctly (no [^\\n] regex)"

# A bug marked FIXED on its row must not count as open.
sh "$HERE/ship-gate.sh" "$FIX/ship-clear" 2>/dev/null | grep -q "open S1/S2" \
  && bad "a FIXED S2 does not block" \
  || ok "a FIXED S2 does not block"

# The board half of this gate used to be an inline awk — a third parser of the board, and the
# weakest of the three. Every one of its divergences failed the gate OPEN, and each case below
# returned CLEAR before scripts/ship-inflight.mjs took over. Each tree is ship-clear with ONE cell
# rewritten, so the mutation is the entire difference between CLEAR and the verdict asserted here.
mkship() {   # mkship <name> <sed-expression-over-the-board>
  rm -rf "$TMP/$1"; cp -R "$FIX/ship-clear" "$TMP/$1"
  sed "$2" "$FIX/ship-clear/docs/31-board.md" > "$TMP/$1/docs/31-board.md"
}

# A renamed (or absent) Status column left awk's column index unset: it read an empty cell, matched
# nothing, and the gate printed CLEAR on a board it had not read.
mkship nostatus 's/| Status |/| State |/'
assert_exit 2 "a board with no Status column cannot be evaluated" sh "$HERE/ship-gate.sh" "$TMP/nostatus"
assert_has "$TMP/out" "Status column" "...and the output names the column it could not find"

# `| \`todo\` |` is never string-equal to "todo". lib/board.mjs strips backticks; awk did not, so a
# ticket that had not been started was invisible to the release gate.
mkship backtick 's/| qa |/| `todo` |/'
assert_exit 1 "a backticked status cell is still a ticket in flight" sh "$HERE/ship-gate.sh" "$TMP/backtick"
assert_has "$TMP/out" "APP-002(todo)" "...and it is named in the in-flight list"

# `blocked` was not in the in-flight set, so a sprint with a blocked ticket shipped silently. A
# blocked ticket is unfinished work with a reason attached, not an exemption.
mkship blockedwork 's/| qa |/| blocked |/'
assert_exit 1 "a blocked ticket blocks the release" sh "$HERE/ship-gate.sh" "$TMP/blockedwork"
assert_has "$TMP/out" "APP-002(blocked)" "...and it is named in the in-flight list"

# 0=clear, 1=blocked by a real condition, 2=cannot evaluate. A missing input is the third: reporting
# it as a plain blocker invited "it's only blocked because the file isn't there yet" as an override.
mkship nobugs '' && rm "$TMP/nobugs/docs/51-bugs.md"
assert_exit 2 "a missing bug board is CANNOT EVALUATE, not BLOCKED" sh "$HERE/ship-gate.sh" "$TMP/nobugs"
mkship noplan '' && rm "$TMP/noplan/docs/50-test-plan.md"
assert_exit 2 "a missing test plan is CANNOT EVALUATE, not BLOCKED" sh "$HERE/ship-gate.sh" "$TMP/noplan"

# `WAIVED:` was enforced by nothing. /app-ship lets a human convert a CANNOT EVALUATE into a ship by
# writing `WAIVED: <artifact> — <who> — <reason>` into docs/60-releases.md — and no script wrote
# that line, no script read it. The single path from a non-pass to a release was improvisation,
# which is the exact thing this file was written to replace. Read it, and hold it to its own shape.
waivetree() {   # waivetree <name> <releases-file-content>
  mkship "$1" '' && rm "$TMP/$1/docs/51-bugs.md"
  printf '%s\n' "$2" > "$TMP/$1/docs/60-releases.md"
}

waivetree waived "WAIVED: docs/51-bugs.md — amol — internal distribution only, no QA wave this cycle"
assert_exit 0 "a well-formed waiver clears the gate it names" sh "$HERE/ship-gate.sh" "$TMP/waived"
assert_has "$TMP/out" "WAIVED: docs/51-bugs.md by amol" "...and the waiver is REPORTED, never silent"

# A waived gate must never look like a skipped gate, so every field has to be there. A waiver with
# nobody's name on it, or no reason, records that someone walked past a gate — not a decision.
waivetree noreason "WAIVED: docs/51-bugs.md — amol"
assert_exit 2 "a waiver with no reason does not count" sh "$HERE/ship-gate.sh" "$TMP/noreason"
assert_has "$TMP/out" "MALFORMED" "...and says the waiver was malformed rather than ignoring it"

waivetree nowho "WAIVED: docs/51-bugs.md —  — because"
assert_exit 2 "a waiver with nobody's name does not count" sh "$HERE/ship-gate.sh" "$TMP/nowho"

waivetree wrongart "WAIVED: docs/50-test-plan.md — amol — a real reason for a different artifact"
assert_exit 2 "a waiver for another artifact does not cover this one" sh "$HERE/ship-gate.sh" "$TMP/wrongart"

waivetree bare "WAIVED: docs/51-bugs.md"
assert_exit 2 "a bare WAIVED: line does not count" sh "$HERE/ship-gate.sh" "$TMP/bare"

echo
# --------------------------------------------------------------------------------------------
echo "team-doctor"
# --------------------------------------------------------------------------------------------
( cd "$HERE/.." && node "$HERE/team-doctor.mjs" ) >/dev/null 2>&1
[ $? = 0 ] && ok "the shipped team definition is coherent" || bad "the shipped team definition is coherent"

# Regression: backend-developer and monetization-engineer sat two releases behind on the output
# contract, so every /app-build gate silently skipped backend and billing tickets.
( cd "$HERE/.." && node "$HERE/team-doctor.mjs" --json ) 2>/dev/null > "$TMP/td.json"
node -e '
const j=require(process.argv[1]);
process.exit(j.findings.some(f=>f.code==="contract_drift")?1:0);
' "$TMP/td.json" && ok "all ticket-working roles share one output contract" \
                 || bad "all ticket-working roles share one output contract"

# team-doctor validates the plugin it is run from, so the only way to plant a defect in it is to
# give it a scratch plugin to validate. Markdown only — the copy is a few hundred KB and no slower
# than the run against the real tree above.
PLUG="$TMP/plugin"; mkdir -p "$PLUG"
cp -R "$HERE/../agents" "$HERE/../commands" "$HERE/../skills" "$PLUG/"

# Regression: the skill-exists check was gated behind a hard-coded whitelist of eleven skill names,
# all of which existed — so it could report a missing skill only for a skill that was not missing.
# A rule that cannot fire reads as coverage, which is worse than no rule.
printf '\nThen invoke `no-such-skill-here` before writing any code.\n' >> "$PLUG/agents/ios-developer.md"
( cd "$PLUG" && node "$HERE/team-doctor.mjs" --json ) > "$TMP/tdbad.json" 2>/dev/null
[ $? = 1 ] && ok "a reference to a skill that does not exist is a blocking finding" \
            || bad "a reference to a skill that does not exist is a blocking finding"
assert_has "$TMP/tdbad.json" "no-such-skill-here" "...naming the skill it could not find"

# ...and the un-whitelisted check must not now flag the skills this plugin legitimately borrows
# from OTHER installed plugins. They have no skills/<name>/SKILL.md here and never will.
sed 's/no-such-skill-here/axiom-ios-ui/' "$PLUG/agents/ios-developer.md" > "$TMP/iosdev.md"
cp "$TMP/iosdev.md" "$PLUG/agents/ios-developer.md"
printf '\nUse the `ui-design:mobile-ios-design` skill, then invoke `superpowers:brainstorming`.\n' \
  >> "$PLUG/agents/ux-designer.md"
( cd "$PLUG" && node "$HERE/team-doctor.mjs" --json ) > "$TMP/tdext.json" 2>/dev/null
grep -q "skill_missing" "$TMP/tdext.json" \
  && bad "external plugin skills are not reported missing" "$(grep -m1 'References skill' "$TMP/tdext.json")" \
  || ok "external plugin skills are not reported missing"

# The activation matrix in skills/role-activation decides which roles a product type and tier spawn
# at all. A role present in agents/ but absent from the matrix is unspawnable-by-omission: nothing
# activates it and nothing records that it was deactivated — the silent-drop class this repo keeps
# rediscovering, arriving through the roster door. The mirror defect is a matrix row naming a role
# that does not exist: a roster promising a specialist nothing can spawn.
MATRIX="$PLUG/skills/role-activation/SKILL.md"
cp "$MATRIX" "$TMP/matrix-pristine.md"
restore_matrix() { cp "$TMP/matrix-pristine.md" "$MATRIX"; }

grep -v '^| `ux-designer` |' "$TMP/matrix-pristine.md" > "$MATRIX"
( cd "$PLUG" && node "$HERE/team-doctor.mjs" --json ) > "$TMP/tdmx1.json" 2>/dev/null
[ $? = 1 ] && ok "a role missing from the activation matrix blocks" \
            || bad "a role missing from the activation matrix blocks"
assert_finding "$TMP/tdmx1.json" role_not_in_matrix \
  "...as role_not_in_matrix, naming the role nothing would activate" "ux-designer"
restore_matrix

# Appended, not renamed: renaming a real row ALSO removes that role from the matrix, so this case
# passed on role_not_in_matrix while matrix_role_unknown was disabled. Proven by breaking it.
{ cat "$TMP/matrix-pristine.md"; echo '| `ux-designerr` | on | on | on | on | on | on | on | typo |'; } > "$MATRIX"
( cd "$PLUG" && node "$HERE/team-doctor.mjs" --json ) > "$TMP/tdmx2.json" 2>/dev/null
assert_finding "$TMP/tdmx2.json" matrix_role_unknown \
  "a matrix row for a role that does not exist blocks" "ux-designerr"
restore_matrix

# Two rows for one role is not a duplicate to tidy up later: they can disagree, and whichever is
# read second silently wins.
{ cat "$TMP/matrix-pristine.md"; grep '^| `qa-engineer` |' "$TMP/matrix-pristine.md"; } > "$MATRIX"
( cd "$PLUG" && node "$HERE/team-doctor.mjs" --json ) > "$TMP/tdmx3.json" 2>/dev/null
assert_finding "$TMP/tdmx3.json" matrix_role_duplicated \
  "a role with two matrix rows blocks" "qa-engineer"
restore_matrix

# And the matrix has to exist at all — the roster is generated from it. Asserted on the finding
# code, not on exit status: removing the file also trips skill_missing, so exit 1 proves nothing.
mv "$MATRIX" "$TMP/matrix-away.md"
( cd "$PLUG" && node "$HERE/team-doctor.mjs" --json ) > "$TMP/tdmx4.json" 2>/dev/null
assert_finding "$TMP/tdmx4.json" activation_matrix_missing "a missing activation matrix blocks"
mv "$TMP/matrix-away.md" "$MATRIX"

echo
# --------------------------------------------------------------------------------------------
echo "runtime-gate"
# --------------------------------------------------------------------------------------------
# The single most important property of this gate: there is no path from a check that did not run
# to a PASS. A runtime gate that reports success on a machine which could not build or launch
# anything is worse than not having one — every downstream reader takes PASS as "the app ran".
NOAPP="$TMP/notanapp"; mkdir -p "$NOAPP"
assert_exit 2 "a tree that is neither iOS nor Android is CANNOT EVALUATE" \
  sh "$HERE/runtime-gate.sh" --project-root "$NOAPP"
cp "$TMP/out" "$TMP/rg-none.txt"
assert_has "$TMP/rg-none.txt" "xcworkspace" "...and it names what it searched for"

# A bare `gradle` on PATH is a different version than the project pins, so a gradle project with no
# committed wrapper was never built. Not built is not passed.
GRA="$TMP/gradle-nowrapper"; mkdir -p "$GRA"; : > "$GRA/build.gradle"
assert_exit 2 "a gradle project with no ./gradlew is CANNOT EVALUATE" \
  sh "$HERE/runtime-gate.sh" --project-root "$GRA"
cp "$TMP/out" "$TMP/rg-gradle.txt"
assert_has "$TMP/rg-gradle.txt" "gradlew" "...naming the missing wrapper"

grep -q "PASS" "$TMP/rg-none.txt" "$TMP/rg-gradle.txt" \
  && bad "no verdict says PASS when the toolchain never ran" \
  || ok "no verdict says PASS when the toolchain never ran"

# Regression: `--platform`/`--project-root` did `shift 2`, which in POSIX sh FAILS and does not
# shift when only one argument remains — so $1 stayed the flag and the parse loop spun forever
# writing zero bytes. `sh scripts/runtime-gate.sh --project-root` never returned. A gate that hangs
# is a gate that gets removed, which is the rule the timeout logic in the same file was written to.
assert_exit_within 5 2 "a dangling --project-root exits 2, it does not hang" \
  sh "$HERE/runtime-gate.sh" --project-root
assert_exit_within 5 2 "a dangling --platform exits 2, it does not hang" \
  sh "$HERE/runtime-gate.sh" --platform

# Regression: `simctl launch` returns 0 for a process that has merely been FORKED, and `adb shell
# monkey` returns 0 once it has injected its events — so a build that crashed 200ms later produced
# RESULT: PASS with a screenshot of a dead simulator, on the gate whose header claims to catch
# exactly crash-on-launch. The fix is a liveness check after the settle sleep.
#
# This box has neither Xcode nor adb, so the gate's happy path cannot be exercised end to end. The
# predicate that decides PASS vs FAIL is one command each, so it is extracted and run against a stub
# `xcrun`/`adb` on PATH — the branch is real, reachable, and does what it says on both answers.
eval "$(sed -n '/^ios_running()/p;/^android_running()/p' "$HERE/runtime-gate.sh")"
STUB="$TMP/stubbin"; mkdir -p "$STUB"
mkstub() {   # mkstub <name> <stdout>
  printf '#!/bin/sh\nprintf "%%s\\n" "%s"\n' "$2" > "$STUB/$1"; chmod +x "$STUB/$1"
}

if ! command -v ios_running >/dev/null 2>&1 && ! type ios_running >/dev/null 2>&1; then
  bad "the liveness predicates exist in runtime-gate.sh" "ios_running/android_running not found"
else
  mkstub xcrun "0	1	com.example.app"
  ( PATH="$STUB:$PATH"; ios_running SOME-UDID com.example.app ) \
    && ok "ios_running is true while the process is in launchctl list" \
    || bad "ios_running is true while the process is in launchctl list"
  mkstub xcrun ""
  ( PATH="$STUB:$PATH"; ios_running SOME-UDID com.example.app ) \
    && bad "ios_running is FALSE once the app has exited" \
    || ok "ios_running is FALSE once the app has exited"

  mkstub adb "4213"
  ( PATH="$STUB:$PATH"; android_running SOME-DEV com.example.app ) \
    && ok "android_running is true while pidof returns a pid" \
    || bad "android_running is true while pidof returns a pid"
  mkstub adb ""
  ( PATH="$STUB:$PATH"; android_running SOME-DEV com.example.app ) \
    && bad "android_running is FALSE once pidof returns nothing" \
    || ok "android_running is FALSE once pidof returns nothing"
fi

# ...and the predicate has to be WIRED to a fail, not merely defined. Both launch blocks must reach
# it, and a dead process must produce FAIL — this is the line whose absence produced the pass.
LIVE=$(grep -c 'if ! ios_running\|if ! android_running' "$HERE/runtime-gate.sh")
[ "$LIVE" = "2" ] && ok "both launch paths assert liveness after the settle sleep" \
                  || bad "both launch paths assert liveness after the settle sleep" "found $LIVE"
grep -A2 'if ! ios_running' "$HERE/runtime-gate.sh" | grep -q 'fail ' \
  && grep -A2 'if ! android_running' "$HERE/runtime-gate.sh" | grep -q 'fail ' \
  && ok "a process that is gone is a FAIL, not a PASS" \
  || bad "a process that is gone is a FAIL, not a PASS"

# The SwiftPM branch called pass() with text saying the launch half was never exercised, then
# exited 0 — while exit 0 is defined at the top of the file as "built AND launched". A verdict that
# contradicts itself inside its own sentence still reads as green to /app-ship.
# Not executable here (no swift toolchain, and xcodebuild is refused before this branch is reached),
# so this is asserted on the source: the SwiftPM success arm must be an `unknown`.
sed -n '/SWIFTPKG/,/^  fi/p' "$HERE/runtime-gate.sh" | grep -q 'unknown "ios    " "Package.swift builds' \
  && ok "a SwiftPM package that builds is CANNOT EVALUATE, not PASS" \
  || bad "a SwiftPM package that builds is CANNOT EVALUATE, not PASS"

echo
# --------------------------------------------------------------------------------------------
echo "integration-branch"
# --------------------------------------------------------------------------------------------
# The merge base was hardcoded as `main` in four call sites while knowledge/git-workflow.md
# specifies that the flagship model integrates on `develop`. Merging features straight to `main` on
# a project whose release process expects `develop` is not recoverable by a later fix.
IB="$TMP/ibrepo"; mkdir -p "$IB/docs"
( cd "$IB" && git init -q -b main . && git config user.email t@t.t && git config user.name T \
  && echo a > a.txt && git add a.txt && git commit -qm init ) >/dev/null 2>&1

[ "$(sh "$HERE/integration-branch.sh" "$IB" 2>/dev/null)" = "main" ] \
  && ok "no git-strategy doc resolves to main" || bad "no git-strategy doc resolves to main"

# A base that does not exist used to print a warning on stderr and return `main` with exit 0 —
# failing OPEN on the one condition this script exists to catch. Its only caller is
# `BASE=$(sh scripts/integration-branch.sh)` in commands/app-build.md, which discards stderr and
# never looked at $?, so on a develop-model project the base silently became `main` and features
# merged to the wrong branch: the outcome this file's own header calls unrecoverable. The warning
# was real and structurally invisible. It is exit 2 now, and the reason goes to STDOUT so the one
# caller that exists can show it.
printf 'Integration branch: develop\n' > "$IB/docs/23-git-strategy.md"
IBOUT=$(sh "$HERE/integration-branch.sh" "$IB" 2>"$TMP/ib.err"); IBRC=$?
[ "$IBRC" = "2" ] && ok "a declared branch that does not exist is exit 2, never a fallback" \
                  || bad "a declared branch that does not exist is exit 2, never a fallback" "got $IBRC, printed '$IBOUT'"
printf '%s' "$IBOUT" | grep -q "CANNOT RESOLVE" \
  && ok "...and the reason is on stdout, where the only caller can see it" \
  || bad "...and the reason is on stdout, where the only caller can see it"
printf '%s' "$IBOUT" | grep -qx "main" \
  && bad "...and it never emits a usable branch name on that path" \
  || ok "...and it never emits a usable branch name on that path"
assert_has "$TMP/ib.err" "no such branch exists" "...and says so on stderr too"

# The caller has to actually check it. A gate nothing reads is the defect that was just fixed one
# file over; asserting the script alone would repeat it.
grep -q 'integration-branch.sh") \\' "$HERE/../commands/app-build.md" \
  && grep -q "STOP the round" "$HERE/../commands/app-build.md" \
  && ok "/app-build checks the exit code and stops the round on 2" \
  || bad "/app-build checks the exit code and stops the round on 2"

( cd "$IB" && git branch develop ) >/dev/null 2>&1
[ "$(sh "$HERE/integration-branch.sh" "$IB" 2>/dev/null)" = "develop" ] \
  && ok "a declared branch that exists is used" || bad "a declared branch that exists is used"

echo
echo "─────────────────────────────────────────"
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
