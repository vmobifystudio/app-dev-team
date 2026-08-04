#!/bin/sh
# android journey driver — actually execute a declared journey against a device or emulator.
#
# This is the seam the journey gate was built around. Until now every declared journey was CANNOT
# EVALUATE because nothing drove one, which made the whole product-correctness engine inert: it
# could refuse a badly-written journey at load, and it could never tell you whether the product did
# what the journey said.
#
# It talks to the device through `adb` and `uiautomator dump`, which are the two things every
# Android install already has. No Appium, no Gradle plugin, no dependency — a driver that needs its
# own toolchain would just move the "cannot evaluate" one layer out.
#
# Contract (docs/team/journeys/README.md): journey/v1 in, one journey-result/v1 on stdout.
#   0 PASS · 1 FAIL (the product is wrong) · 2 CANNOT EVALUATE (never a pass)
#
# THE DISTINCTION THIS DRIVER EXISTS TO HOLD: a step that could not RUN is 2, a step that ran and
# whose assertion did not hold is 1. Collapsing them is how "the emulator was not booted" gets read
# as "the feature is broken", which sends people to fix code that was fine.
#
# Usage: android.sh --journey <path> [--package <id>] [--evidence-dir <dir>]

set -u

JOURNEY=""
PKG="${STUDIO_ANDROID_PACKAGE:-}"
EVIDENCE_DIR="artifacts/journeys"
JID='""'

while [ $# -gt 0 ]; do
  case "$1" in
    --journey)      JOURNEY="${2:-}"; shift 2 ;;
    --package)      PKG="${2:-}"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

# JSON string escaping, applied to every value that reaches the report. Building JSON with bare
# `printf` is how a path containing a quote produces a malformed report — which the gate then reads
# as "the driver crashed", conflating a driver bug with a product verdict.
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr -d '\n'; }

emit() { # emit <result> <detail> [failed_step] [evidence...]
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

command -v adb >/dev/null 2>&1 || cannot "adb is not on PATH — an ENVIRONMENT fact, not a product fact"
DEVICES=$(adb devices 2>/dev/null | sed '1d' | grep -c "device$" || true)
[ "$DEVICES" -ge 1 ] 2>/dev/null || cannot "no device or emulator attached (adb devices lists none)"
[ -n "$PKG" ] || cannot "no package id — pass --package or set STUDIO_ANDROID_PACKAGE"
adb shell pm list packages 2>/dev/null | grep -q "^package:$PKG$" || cannot "$PKG is not installed on the device"
mkdir -p "$EVIDENCE_DIR" 2>/dev/null || cannot "cannot create the evidence directory $EVIDENCE_DIR"

DUMP="$(mktemp)"; trap 'rm -f "$DUMP"' EXIT
DENSITY=$(adb shell wm density 2>/dev/null | sed -n 's/.*Physical density: *\([0-9]*\).*/\1/p' | head -1)
[ -n "$DENSITY" ] || DENSITY=160

refresh() { # snapshot the view hierarchy; a dump that fails is CANNOT EVALUATE, never a failed assertion
  adb shell uiautomator dump /sdcard/.journey.xml >/dev/null 2>&1 || return 1
  adb pull /sdcard/.journey.xml "$DUMP" >/dev/null 2>&1 || return 1
  [ -s "$DUMP" ]
}

node_for() { # node_for <id> -> the matching <node ...> element, by resource-id then content-desc then text
  tr '>' '>\n' < "$DUMP" | grep "resource-id=\"[^\"]*/$1\"" | head -1 && return 0
  tr '>' '>\n' < "$DUMP" | grep "content-desc=\"$1\"" | head -1 && return 0
  tr '>' '>\n' < "$DUMP" | grep "text=\"$1\"" | head -1
}
attr() { printf '%s' "$1" | sed -n "s/.*$2=\"\([^\"]*\)\".*/\1/p"; }

centre() { # bounds "[x1,y1][x2,y2]" -> "cx cy"
  printf '%s' "$1" | sed 's/\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]/\1 \2 \3 \4/' \
    | awk '{ printf "%d %d", ($1+$3)/2, ($2+$4)/2 }'
}

# --- execute -----------------------------------------------------------------------------------
# Steps are read one JSON object at a time. Node is not available here by design: this driver has to
# run on a machine that has adb, which is not necessarily one that has the studio's toolchain.
STEP_N=0
EVIDENCE=""

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
  SDP=$(printf '%s' "$step" | sed -n 's/.*"dp"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')

  case "$ACTION" in
    launch)
      adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
        || cannot "step $STEP_N: could not launch $PKG"
      sleep 2 ;;
    tap)
      refresh || cannot "step $STEP_N: uiautomator dump failed — the view hierarchy could not be read"
      NODE=$(node_for "$SID")
      [ -n "$NODE" ] || fail "step $STEP_N: no element matching \"$SID\" is on screen" "$STEP_N"
      set -- $(centre "$(attr "$NODE" bounds)")
      adb shell input tap "$1" "$2" >/dev/null 2>&1 || cannot "step $STEP_N: adb input tap failed"
      sleep 1 ;;
    enter)
      refresh || cannot "step $STEP_N: uiautomator dump failed"
      NODE=$(node_for "$SID")
      [ -n "$NODE" ] || fail "step $STEP_N: no input matching \"$SID\" is on screen" "$STEP_N"
      set -- $(centre "$(attr "$NODE" bounds)")
      adb shell input tap "$1" "$2" >/dev/null 2>&1
      adb shell input text "$(printf '%s' "$SVAL" | sed 's/ /%s/g')" >/dev/null 2>&1 \
        || cannot "step $STEP_N: adb input text failed"
      sleep 1 ;;
    back)
      adb shell input keyevent 4 >/dev/null 2>&1; sleep 1 ;;
    wait_for)
      _n=0
      while [ "$_n" -lt 10 ]; do
        refresh && [ -n "$(node_for "$SID")" ] && break
        _n=$((_n + 1)); sleep 1
      done
      [ "$_n" -lt 10 ] || fail "step $STEP_N: \"$SID\" never appeared within 10s" "$STEP_N" ;;
  esac

  case "$ASSERT" in
    screen|text_visible)
      refresh || cannot "step $STEP_N: uiautomator dump failed"
      NEEDLE="${SVAL:-$SID}"
      grep -q "$NEEDLE" "$DUMP" || fail "step $STEP_N: \"$NEEDLE\" is not on screen" "$STEP_N" ;;
    text_absent)
      refresh || cannot "step $STEP_N: uiautomator dump failed"
      grep -q "$SVAL" "$DUMP" && fail "step $STEP_N: \"$SVAL\" is on screen and should not be" "$STEP_N" ;;
    value_equals)
      # THE ROUND TRIP. This is the assertion the whole gate was written for: read back what the
      # product STORED, not what was typed. A date picker that discards your selection and writes
      # System.currentTimeMillis() passes every other check here and fails this one.
      refresh || cannot "step $STEP_N: uiautomator dump failed"
      NODE=$(node_for "$SID")
      [ -n "$NODE" ] || fail "step $STEP_N: no element \"$SID\" to read back" "$STEP_N"
      GOT=$(attr "$NODE" text)
      [ "$GOT" = "$SVAL" ] || fail "step $STEP_N: \"$SID\" reads \"$GOT\", expected \"$SVAL\" — the value did not survive the round trip" "$STEP_N" ;;
    min_touch_target)
      refresh || cannot "step $STEP_N: uiautomator dump failed"
      NODE=$(node_for "$SID")
      [ -n "$NODE" ] || fail "step $STEP_N: no element \"$SID\" to measure" "$STEP_N"
      # MEASURED ON THE DEVICE, in real dp, not read off a stylesheet. A spec saying 56dp and a
      # layout rendering 24dp agree on paper and differ on glass.
      DPVAL=$(printf '%s' "$(attr "$NODE" bounds)" \
        | sed 's/\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]/\1 \2 \3 \4/' \
        | awk -v d="$DENSITY" '{ w=($3-$1)*160/d; h=($4-$2)*160/d; print (w<h?w:h) }')
      awk -v got="$DPVAL" -v want="${SDP:-48}" 'BEGIN { exit !(got + 0.5 >= want) }' \
        || fail "step $STEP_N: \"$SID\" measures ${DPVAL}dp on this device, spec says ${SDP}dp" "$STEP_N" ;;
    announces)
      # What a screen reader would say — content-desc, not the visible label. A control can read
      # correctly and announce nothing, and only this assertion can tell.
      refresh || cannot "step $STEP_N: uiautomator dump failed"
      NODE=$(node_for "$SID")
      [ -n "$NODE" ] || fail "step $STEP_N: no element \"$SID\" to check for an announcement" "$STEP_N"
      SAID=$(attr "$NODE" content-desc)
      [ "$SAID" = "$SVAL" ] || fail "step $STEP_N: \"$SID\" announces \"$SAID\", expected \"$SVAL\"" "$STEP_N" ;;
  esac
done || exit $?

# Evidence is captured once the journey has actually completed — a screenshot of a run that failed
# halfway is evidence of nothing in particular, and the gate refuses a PASS citing a file it cannot
# find or that is empty.
SHOT="$EVIDENCE_DIR/$JID_RAW.png"
adb exec-out screencap -p > "$SHOT" 2>/dev/null
[ -s "$SHOT" ] || cannot "every step passed, but the screenshot could not be captured — a PASS with no evidence is not a pass"

emit PASS "every step ran and every assertion held on $DEVICES device(s)" "" "$SHOT"
