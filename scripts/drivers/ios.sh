#!/bin/sh
# ios journey driver — actually execute a declared journey against a booted simulator.
#
# Contract (docs/team/journeys/README.md): journey/v1 in, one journey-result/v1 on stdout.
#   0 PASS · 1 FAIL (the product is wrong) · 2 CANNOT EVALUATE (never a pass)
#
# A step that could not RUN is 2; a step that ran and whose assertion did not hold is 1. Collapsing
# them is how "no simulator was booted" gets read as "the feature is broken".
#
# QA-2: `xcrun simctl` launches and screenshots but cannot tap or read the accessibility tree, so
# every step other than `launch` used to be CANNOT EVALUATE and every iOS ship needed a waiver. The
# steps now run through AXe (`axe describe-ui` / `tap` / `type`, the HID + accessibility CLI that
# XcodeBuildMCP also uses) — from outside the app, no UITests target. No AXe → CANNOT EVALUATE naming
# the one install line. `back` stays refused: iOS has no universal Back, so tap the control by id.
#
# Usage: ios.sh --journey <path> [--bundle <id>] [--evidence-dir <dir>]
#   bundle id: --bundle, else STUDIO_IOS_BUNDLE (journey-gate sets it from runtime-gate's record).
# Ids resolve as AXUniqueId (accessibilityIdentifier), then AXLabel. Sizes are points (dp ≈ pt).

set -u
JOURNEY=""; BUNDLE="${STUDIO_IOS_BUNDLE:-}"; EVIDENCE_DIR="artifacts/journeys"
while [ $# -gt 0 ]; do
  case "$1" in
    --journey)      JOURNEY="${2:-}"; shift 2 ;;
    --bundle)       BUNDLE="${2:-}"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

command -v node >/dev/null 2>&1 || {
  printf '{"schema":"journey-result/v1","journey_id":"","result":"CANNOT_EVALUATE","detail":"node is not on PATH"}\n'; exit 2; }

exec node - "$JOURNEY" "$BUNDLE" "$EVIDENCE_DIR" <<'JS'
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const [journeyPath, bundle, evDir] = process.argv.slice(2);
let jid = '';
const out = (result, detail, extra = {}) => {
  process.stdout.write(`${JSON.stringify({ schema: 'journey-result/v1', journey_id: jid, result, detail, ...extra })}\n`);
  process.exit(result === 'PASS' ? 0 : result === 'FAIL' ? 1 : 2);
};
const cannot = (d) => out('CANNOT_EVALUATE', d);
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

if (!journeyPath || !existsSync(journeyPath)) cannot(`no journey declaration at ${journeyPath || '(none given)'}`);
let journey;
try { journey = JSON.parse(readFileSync(journeyPath, 'utf8')); } catch (e) { cannot(`journey is not JSON: ${e.message}`); }
jid = String(journey.id || '');
if (!jid) cannot('the journey declaration has no top-level id');

let udid = '';
try {
  const devs = Object.values(JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'])).devices || {}).flat();
  udid = (devs.find((d) => d.state === 'Booted') || {}).udid || '';
} catch { cannot('xcrun simctl is unusable here (no Xcode, or xcode-select points at the Command Line Tools) — an ENVIRONMENT fact, not a product fact'); }
if (!udid) cannot('no booted simulator (xcrun simctl list devices booted is empty)');
if (!bundle) cannot('no bundle id — run runtime-gate.sh --record first (journey-gate reads the id from it), or pass --bundle / set STUDIO_IOS_BUNDLE');
try { run('xcrun', ['simctl', 'get_app_container', udid, bundle]); } catch { cannot(`${bundle} is not installed on the booted simulator`); }
try { run('axe', ['--version']); } catch { cannot('AXe is not installed, and simctl cannot tap or read the accessibility tree — brew install cameroncooke/axe/axe, then re-run. The journey was NOT exercised.'); }

const flat = (nodes) => (Array.isArray(nodes) ? nodes : [nodes]).flatMap((n) => (n && typeof n === 'object' ? [n, ...flat(n.children || [])] : []));
const tree = (n) => { try { return flat(JSON.parse(run('axe', ['describe-ui', '--udid', udid]))); } catch (e) { cannot(`step ${n}: axe describe-ui failed — the accessibility tree could not be read (${String(e.message).split('\n')[0]})`); } };
const find = (els, id) => els.find((e) => e.AXUniqueId === id) || els.find((e) => e.AXLabel === id);
const frame = (e) => {
  if (e.frame && typeof e.frame === 'object') return e.frame;
  const m = String(e.AXFrame || '').match(/-?[\d.]+/g) || [];
  return { x: +m[0] || 0, y: +m[1] || 0, width: +m[2] || 0, height: +m[3] || 0 };
};
const value = (e) => String(e.AXValue != null && e.AXValue !== '' ? e.AXValue : e.AXLabel ?? '').trim();

const steps = Array.isArray(journey.steps) ? journey.steps : [];
for (const [i, s] of steps.entries()) {
  const n = i + 1;
  const fail = (d) => out('FAIL', d, { failed_step: n });
  const waitFor = (id, secs) => {
    for (let t = 0; t <= secs * 4; t += 1) { const e = find(tree(n), id); if (e) return e; sleep(250); }
    fail(`step ${n}: no element "${id}" on screen within ${secs}s`);
  };
  const tap = (e) => {
    const f = frame(e);
    try { run('axe', ['tap', '-x', String(Math.round(f.x + f.width / 2)), '-y', String(Math.round(f.y + f.height / 2)), '--udid', udid]); }
    catch { cannot(`step ${n}: axe tap failed`); }
    sleep(500);
  };
  switch (s.action) {
    case undefined: break;
    case 'launch':
      try { run('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, bundle]); } catch { cannot(`step ${n}: could not launch ${bundle}`); }
      sleep(2000); break;
    case 'tap': tap(waitFor(s.id, 5)); break;
    case 'enter':
      tap(waitFor(s.id, 5));
      try { run('axe', ['type', String(s.value), '--udid', udid]); } catch { cannot(`step ${n}: axe type failed`); }
      sleep(500); break;
    case 'wait_for': waitFor(s.id, 10); break;
    case 'back': cannot(`step ${n}: iOS has no universal Back affordance — declare the control by id instead of using \`back\``); break;
    default: cannot(`step ${n}: unknown action "${s.action}"`);
  }
  if (s.assert === undefined) continue;
  const els = tree(n);
  const texts = els.flatMap((e) => [e.AXLabel, e.AXValue]).filter((t) => t != null).map(String);
  const el = s.id === undefined ? null : find(els, s.id) || (s.assert === 'screen' ? waitFor(s.id, 5) : fail(`step ${n}: no element "${s.id}" on screen`));
  switch (s.assert) {
    case 'screen': break;
    case 'text_visible': if (!texts.some((t) => t.includes(String(s.value)))) fail(`step ${n}: "${s.value}" is not on screen`); break;
    case 'text_absent': if (texts.some((t) => t.includes(String(s.value)))) fail(`step ${n}: "${s.value}" is on screen and should not be`); break;
    case 'value_equals':
      // THE ROUND TRIP: what the product STORED, read back off the screen.
      if (value(el) !== String(s.value)) fail(`step ${n}: "${s.id}" reads "${value(el)}", expected "${s.value}" — the value did not survive the round trip`);
      break;
    case 'min_touch_target': {
      const f = frame(el); const got = Math.min(f.width, f.height);
      if (got + 0.5 < Number(s.dp)) fail(`step ${n}: "${s.id}" measures ${got}pt on this simulator, spec says ${s.dp}`);
      break;
    }
    case 'announces': // what VoiceOver reads: the label (then the value)
      if (String(el.AXLabel ?? '') !== String(s.value) && [el.AXLabel, el.AXValue].filter(Boolean).join(', ') !== String(s.value)) {
        fail(`step ${n}: "${s.id}" announces "${el.AXLabel ?? ''}", expected "${s.value}"`);
      }
      break;
    case 'is_checked': {
      const on = ['1', 'true', 'on'].includes(String(el.AXValue ?? '').toLowerCase());
      if (on !== s.value) fail(`step ${n}: "${s.id}" is ${on ? 'checked' : 'unchecked'}, expected ${s.value ? 'checked' : 'unchecked'}`);
      break;
    }
    default: cannot(`step ${n}: unknown assert "${s.assert}"`);
  }
}

try { mkdirSync(evDir, { recursive: true }); } catch { cannot(`cannot create the evidence directory ${evDir}`); }
const shot = join(evDir, `${jid}.png`);
try { run('xcrun', ['simctl', 'io', udid, 'screenshot', shot]); } catch { /* checked below */ }
if (!existsSync(shot) || !statSync(shot).size) cannot('every step passed, but the screenshot could not be captured — a PASS with no evidence is not a pass');
out('PASS', `${steps.length} steps ran on simulator ${udid} through AXe`, { evidence: [shot] });
JS
