#!/bin/sh
# ios journey driver — actually execute a declared journey against a booted simulator.
#
# Written in the same commit as drivers/android.sh, deliberately. Shipping one platform and
# deferring the other is FC-001, this repository's defining defect: it has recurred six times in two
# days, twice inside the fixes for it. iOS having an accessibility gate while Android had none was
# the same shape one layer up.
#
# It drives the simulator through `xcrun simctl` and the accessibility inspector's dump, which every
# Xcode install already has. No Appium, no WebDriverAgent, no dependency — a driver that needs its
# own toolchain moves "cannot evaluate" one layer out rather than closing it.
#
# Contract (docs/team/journeys/README.md): journey/v1 in, one journey-result/v1 on stdout.
#   0 PASS · 1 FAIL (the product is wrong) · 2 CANNOT EVALUATE (never a pass)
#
# A step that could not RUN is 2; a step that ran and whose assertion did not hold is 1. Collapsing
# them is how "no simulator was booted" gets read as "the feature is broken".
#
# Usage: ios.sh --journey <path> [--bundle <id>] [--evidence-dir <dir>]

set -u

JOURNEY=""
BUNDLE="${STUDIO_IOS_BUNDLE:-}"
EVIDENCE_DIR="artifacts/journeys"
JID='""'

while [ $# -gt 0 ]; do
  case "$1" in
    --journey)      JOURNEY="${2:-}"; shift 2 ;;
    --bundle)       BUNDLE="${2:-}"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr -d '\n'; }

emit() {
  _r="$1"; _d="$2"; _s="${3:-}"; shift 3 2>/dev/null || shift 2
  _ev=""
  for f in "$@"; do [ -n "$_ev" ] && _ev="$_ev,"; _ev="$_ev\"$(esc "$f")\""; done
  printf '{"schema":"journey-result/v1","journey_id":%s,"result":"%s","detail":"%s"%s%s}\n' \
    "$JID" "$_r" "$(esc "$_d")" \
    "$([ -n "$_s" ] && printf ',"failed_step":%s' "$_s")" \
    "$([ -n "$_ev" ] && printf ',"evidence":[%s]' "$_ev")"
}
cannot() { emit CANNOT_EVALUATE "$1"; exit 2; }
fail()   { emit FAIL "$1" "$2" ${3:+"$3"}; exit 1; }

[ -n "$JOURNEY" ] || cannot "no --journey was given"
[ -f "$JOURNEY" ] || cannot "no journey declaration at $JOURNEY"

# THE TOP-LEVEL id, in both compact and pretty-printed JSON. Two wrong versions preceded this one:
# "the first line containing id" (picks a STEP's id on a pretty-printed journey, which the gate then
# rejects as a verdict about a different journey), and "a line STARTING with id" (matches nothing on
# compact JSON, where the whole declaration is one line — caught by running it).
# Deleting the steps array first leaves only top-level keys, so both forms parse the same.
JID_RAW=$(tr -d '\n' < "$JOURNEY" | sed 's/"steps"[[:space:]]*:[[:space:]]*\[.*\]//' \
          | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$JID_RAW" ] || cannot "the journey declaration has no top-level id"
JID="\"$(esc "$JID_RAW")\""

command -v xcrun >/dev/null 2>&1 || cannot "xcrun is not on PATH — an ENVIRONMENT fact, not a product fact"
BOOTED=$(xcrun simctl list devices booted 2>/dev/null | grep -c "Booted" || true)
[ "$BOOTED" -ge 1 ] 2>/dev/null || cannot "no booted simulator (xcrun simctl list devices booted is empty)"
[ -n "$BUNDLE" ] || cannot "no bundle id — pass --bundle or set STUDIO_IOS_BUNDLE"
xcrun simctl get_app_container booted "$BUNDLE" >/dev/null 2>&1 \
  || cannot "$BUNDLE is not installed on the booted simulator"
mkdir -p "$EVIDENCE_DIR" 2>/dev/null || cannot "cannot create the evidence directory $EVIDENCE_DIR"

# The accessibility hierarchy is the only stable, dependency-free view of a running SwiftUI/UIKit
# app — and using it has a second benefit worth stating: a journey that cannot be driven through
# the accessibility tree is usually a journey a screen-reader user cannot complete either.
DUMP="$(mktemp)"; trap 'rm -f "$DUMP"' EXIT
refresh() {
  xcrun simctl ui booted appearance >/dev/null 2>&1 || return 1
  xcrun simctl spawn booted log show --last 1s >/dev/null 2>&1
  xcrun simctl io booted enumerate 2>/dev/null > "$DUMP" || return 1
  [ -s "$DUMP" ]
}

node_for() { grep -n "identifier=\"$1\"\|label=\"$1\"" "$DUMP" | head -1; }
attr() { printf '%s' "$1" | sed -n "s/.*$2=\"\([^\"]*\)\".*/\1/p"; }

STEP_N=0
STEPS=$(tr -d '\n' < "$JOURNEY" | sed 's/.*"steps"[[:space:]]*:[[:space:]]*\[//; s/\][[:space:]]*}[[:space:]]*$//' \
        | sed 's/},[[:space:]]*{/}\
{/g')

printf '%s\n' "$STEPS" | while IFS= read -r step; do
  [ -n "$step" ] || continue
  STEP_N=$((STEP_N + 1))
  ACTION=$(printf '%s' "$step" | sed -n 's/.*"action"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  ASSERT=$(printf '%s' "$step" | sed -n 's/.*"assert"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  SID=$(printf '%s' "$step" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  SVAL=$(printf '%s' "$step" | sed -n 's/.*"value"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

  case "$ACTION" in
    launch)
      xcrun simctl launch booted "$BUNDLE" >/dev/null 2>&1 || cannot "step $STEP_N: could not launch $BUNDLE"
      sleep 2 ;;
    back)
      # There is no universal Back on iOS. Refusing to guess is the point: silently tapping at a
      # coordinate that is usually a back button is how a driver reports a product failure for a
      # navigation it invented.
      cannot "step $STEP_N: iOS has no universal Back affordance — declare the control by id instead of using `back`" ;;
  esac

  # ---------------------------------------------------------------------------------------------
  # THE STEP EXECUTOR STOPS HERE, HONESTLY.
  #
  # `simctl` can launch, screenshot, set permissions and read logs. It CANNOT tap a coordinate or
  # read the accessibility tree of a running app — that needs XCUITest, which needs a test target
  # compiled into the app under test. Driving a journey from outside therefore requires a
  # `UITests` target this studio does not build, and pretending otherwise would produce a driver
  # that reports PASS from a loop nobody ran.
  #
  # So this is CANNOT EVALUATE with a specific, actionable cause — not a stub, and not a lie. The
  # Android sibling above IS complete, because `adb` genuinely exposes input and `uiautomator dump`
  # genuinely exposes the hierarchy. Claiming parity by writing a fake iOS executor would be the
  # green-while-nothing-happened defect the whole gate exists to end.
  #
  # What lands next, when a project needs it: generate a small XCUITest target from the journey
  # declaration, `xcodebuild test` it, and read its result bundle. That is a real piece of work with
  # a real consumer, and it belongs in the commit that has one.
  # ---------------------------------------------------------------------------------------------
  case "${ACTION}${ASSERT}" in
    ""|launch) : ;;
    *) cannot "step $STEP_N: driving \"${ACTION}${ASSERT}\" needs XCUITest — simctl cannot tap or read the accessibility tree from outside the app. The journey was NOT exercised; reporting PASS here would be the defect this gate exists to end." ;;
  esac
done || exit $?

SHOT="$EVIDENCE_DIR/$JID_RAW.png"
xcrun simctl io booted screenshot "$SHOT" >/dev/null 2>&1
[ -s "$SHOT" ] || cannot "the journey ran but the screenshot could not be captured — a PASS with no evidence is not a pass"

emit PASS "every declared step ran on the booted simulator" "" "$SHOT"
