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

echo
# --------------------------------------------------------------------------------------------
echo "team-doctor"
# --------------------------------------------------------------------------------------------
( cd "$HERE/.." && node "$HERE/team-doctor.mjs" ) >/dev/null 2>&1
[ $? = 0 ] && ok "the shipped team definition is coherent" || bad "the shipped team definition is coherent"

echo
echo "─────────────────────────────────────────"
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
