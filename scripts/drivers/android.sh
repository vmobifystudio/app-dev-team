#!/bin/sh
# android journey driver — execute a declared journey against a real device or emulator.
#
# THIS IS THE SEAM THE JOURNEY GATE WAS BUILT AROUND, and the gap this repo has been stating out
# loud since the gate shipped: every declared journey has been CANNOT EVALUATE because nothing
# existed to drive one. The contract, the two load-time refusals, the digest capture and the
# staleness rule were all complete and testable without it — which is exactly what made it possible
# to drop this in without re-litigating any of them.
#
# THE HONEST BOUNDARY, STATED FIRST. This driver exercises a journey through `adb` and
# `uiautomator`. When there is no device, no adb, or no app installed, it emits CANNOT_EVALUATE and
# says which. It NEVER emits PASS for a step it did not execute. The whole reason the journey gate
# exists is that a green result which proves nothing is worse than a red one.
#
# Contract (docs/team/journeys/README.md): read a journey/v1 JSON on stdin or via --journey, emit
# one journey-result/v1 object on stdout.
#
#   0  PASS             every step ran, every assertion held
#   1  FAIL             a step or assertion did not hold — the PRODUCT is wrong
#   2  CANNOT EVALUATE  it was not exercised. Never a pass.
#
# Usage: android.sh --journey <path> [--package <id>] [--evidence-dir <dir>]

set -u

NAME="android-driver"
JOURNEY=""
PKG="${STUDIO_ANDROID_PACKAGE:-}"
EVIDENCE_DIR="artifacts/journeys"

while [ $# -gt 0 ]; do
  case "$1" in
    --journey)      JOURNEY="${2:-}"; shift 2 ;;
    --package)      PKG="${2:-}"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

# `cannot` prints a well-formed journey-result/v1 and exits 2. It is a FUNCTION rather than a
# scattered set of echoes so that no path can drift into emitting a malformed report — a driver
# whose output the gate cannot parse is indistinguishable, to the gate, from a driver that crashed.
cannot() {
  printf '{"schema":"journey-result/v1","journey_id":%s,"result":"CANNOT_EVALUATE","detail":"%s"}\n' \
    "${JID:-\"\"}" "$1"
  exit 2
}

[ -n "$JOURNEY" ] || cannot "no --journey was given"
[ -f "$JOURNEY" ] || cannot "no journey declaration at $JOURNEY"

# The journey id is echoed back on EVERY result. Without it one cached report clears every declared
# journey — found by codex on PR #21, and the gate now refuses a report whose id does not match.
JID=$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/"\1"/p' "$JOURNEY" | head -1)
[ -n "$JID" ] || cannot "the journey declaration has no id"

command -v adb >/dev/null 2>&1 || cannot "adb is not on PATH — this is an ENVIRONMENT fact, not a product fact"

DEVICES=$(adb devices 2>/dev/null | sed '1d' | grep -c "device$" || true)
[ "$DEVICES" -ge 1 ] 2>/dev/null || cannot "no Android device or emulator is attached (adb devices lists none)"

[ -n "$PKG" ] || cannot "no package id — pass --package or set STUDIO_ANDROID_PACKAGE"

adb shell pm list packages 2>/dev/null | grep -q "^package:$PKG$" \
  || cannot "$PKG is not installed on the attached device"

mkdir -p "$EVIDENCE_DIR" 2>/dev/null || cannot "cannot create the evidence directory $EVIDENCE_DIR"

# ---------------------------------------------------------------------------------------------
# THE STEP EXECUTOR IS NOT IMPLEMENTED, AND SAYS SO.
#
# Everything above is real: it establishes whether this journey COULD be exercised, and every
# refusal names a specific, checkable cause. What remains is the uiautomator step loop — resolving
# `id` to a node, tapping it, entering text, and reading back `value_equals` / `announces` /
# `min_touch_target`. That needs a device in front of it to write honestly, and there is none here.
#
# It emits CANNOT_EVALUATE rather than a stub PASS ON PURPOSE. A driver that returned PASS from a
# loop nobody had run would be the exact defect this entire gate exists to end — green while nothing
# happened, FC-002, with the added insult of living inside the mechanism built to prevent it. Six
# dry runs found zero product defects precisely because something plausible stood where a real check
# should have been.
#
# When the loop lands, the preflight above stays: it is the half that distinguishes "the product is
# wrong" from "this host could not ask".
# ---------------------------------------------------------------------------------------------
cannot "device preflight passed ($PKG on $DEVICES device(s)) but the uiautomator step executor is not implemented — the journey was NOT exercised, and reporting PASS here would be the green-while-nothing-happened defect this gate exists to end"
