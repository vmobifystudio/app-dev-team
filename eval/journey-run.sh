#!/bin/sh
# journey-run.sh <android|ios|web> <fixture dir> — run the REAL journey gate and driver against a
# journey-wrong-value-* fixture (QA-8). The device/simulator/browser is the fixture's stub; every
# assertion is the plugin's own. Runs in a temp copy: the gate writes its result there, never here.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
cp -R "$2/." "$W" && cd "$W" || exit 2
if [ -f playwright.js ]; then mkdir -p node_modules/playwright && cp playwright.js node_modules/playwright/index.js; fi
PATH="$W/bin:$PATH" FIXTURE="$W" STUDIO_WEB_URL='' \
  node "$ROOT/scripts/journey-gate.mjs" --root . --driver "$ROOT/scripts/drivers/$1.sh"
