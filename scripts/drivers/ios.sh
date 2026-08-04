#!/bin/sh
# ios journey driver — execute a declared journey against a simulator.
#
# Sibling of drivers/android.sh, and written at the same time ON PURPOSE. Shipping one platform's
# driver and "adding the other later" is this repository's defining defect (FC-001: the fix that
# lands in one mechanism and stops before its sibling) — it has recurred five times in two days,
# including twice inside the fixes for it. iOS having an accessibility gate while Android had none
# is the same shape, one layer up.
#
# Contract (docs/team/journeys/README.md): journey/v1 in, one journey-result/v1 on stdout.
#   0 PASS · 1 FAIL (the product is wrong) · 2 CANNOT EVALUATE (never a pass)
#
# Usage: ios.sh --journey <path> [--bundle <id>] [--evidence-dir <dir>]

set -u

JOURNEY=""
BUNDLE="${STUDIO_IOS_BUNDLE:-}"
EVIDENCE_DIR="artifacts/journeys"

while [ $# -gt 0 ]; do
  case "$1" in
    --journey)      JOURNEY="${2:-}"; shift 2 ;;
    --bundle)       BUNDLE="${2:-}"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

cannot() {
  printf '{"schema":"journey-result/v1","journey_id":%s,"result":"CANNOT_EVALUATE","detail":"%s"}\n' \
    "${JID:-\"\"}" "$1"
  exit 2
}

[ -n "$JOURNEY" ] || cannot "no --journey was given"
[ -f "$JOURNEY" ] || cannot "no journey declaration at $JOURNEY"

JID=$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/"\1"/p' "$JOURNEY" | head -1)
[ -n "$JID" ] || cannot "the journey declaration has no id"

command -v xcrun >/dev/null 2>&1 || cannot "xcrun is not on PATH — this is an ENVIRONMENT fact, not a product fact"

BOOTED=$(xcrun simctl list devices booted 2>/dev/null | grep -c "Booted" || true)
[ "$BOOTED" -ge 1 ] 2>/dev/null || cannot "no booted simulator (xcrun simctl list devices booted is empty)"

[ -n "$BUNDLE" ] || cannot "no bundle id — pass --bundle or set STUDIO_IOS_BUNDLE"

xcrun simctl get_app_container booted "$BUNDLE" >/dev/null 2>&1 \
  || cannot "$BUNDLE is not installed on the booted simulator"

mkdir -p "$EVIDENCE_DIR" 2>/dev/null || cannot "cannot create the evidence directory $EVIDENCE_DIR"

# The XCUITest step executor is not implemented, and this says so rather than returning a stub PASS.
# A driver that reported success from a loop nobody ran would be green-while-nothing-happened inside
# the very gate built to end it. Six dry runs found zero product defects for exactly that reason:
# something plausible stood where a real check should have been.
cannot "simulator preflight passed ($BUNDLE on $BOOTED booted simulator(s)) but the XCUITest step executor is not implemented — the journey was NOT exercised, and reporting PASS here would be the defect this gate exists to end"
