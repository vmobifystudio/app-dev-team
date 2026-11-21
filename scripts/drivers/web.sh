#!/bin/sh
# web journey driver — execute a declared journey/v1 in a real browser through Playwright (G2-21).
#
# Contract (docs/team/journeys/README.md): journey/v1 in, one journey-result/v1 on stdout.
#   0 PASS · 1 FAIL (the product is wrong) · 2 CANNOT EVALUATE (never a pass)
#
# Playwright is the PROJECT's dev dependency, resolved from <root>/node_modules — this plugin stays
# zero-dependency. Not installed, no browser, no URL: CANNOT EVALUATE with the exact fix, never PASS.
#
# Usage: web.sh --journey <path> [--root <dir>] [--url <served app>] [--evidence-dir <dir>]
#   The URL is the running app (`npm start` / a preview server): --url, else STUDIO_WEB_URL.
# Element ids resolve as [data-testid=ID], then [id=ID], then [aria-label=ID] — attribute selectors, so
# an id that is not a valid CSS identifier (`1st-item`) is still found, never a driver error (QA-11).

set -u
ROOT=.; JOURNEY=""; URL="${STUDIO_WEB_URL:-}"; EVIDENCE_DIR="docs/54-evidence/journeys"
while [ $# -gt 0 ]; do
  case "$1" in
    --root)         ROOT="${2:-.}"; shift 2 ;;
    --journey)      JOURNEY="${2:-}"; shift 2 ;;
    --url)          URL="${2:-}"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

command -v node >/dev/null 2>&1 || {
  printf '{"schema":"journey-result/v1","journey_id":"","result":"CANNOT_EVALUATE","detail":"node is not on PATH"}\n'; exit 2; }

exec node - "$ROOT" "$JOURNEY" "$URL" "$EVIDENCE_DIR" <<'JS'
const { createRequire } = require('node:module');
const { existsSync, mkdirSync, readFileSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const [root, journeyPath, url, evDir] = process.argv.slice(2);
let jid = '';
const out = (result, detail, extra = {}) => {
  process.stdout.write(`${JSON.stringify({ schema: 'journey-result/v1', journey_id: jid, result, detail, ...extra })}\n`);
  process.exit(result === 'PASS' ? 0 : result === 'FAIL' ? 1 : 2);
};
const cannot = (d) => out('CANNOT_EVALUATE', d);

if (!journeyPath || !existsSync(journeyPath)) cannot(`no journey declaration at ${journeyPath || '(none given)'}`);
let journey;
try { journey = JSON.parse(readFileSync(journeyPath, 'utf8')); } catch (e) { cannot(`journey is not JSON: ${e.message}`); }
jid = String(journey.id || '');
if (!jid) cannot('the journey declaration has no top-level id');
// C3W-3: the whole fix, not a hint — a served build, and where it listens.
const SERVE = 'in a second shell, from the project root: `npm run build && npx vite preview --port 4173` (or `npm start` / ' +
  'your preview server), then re-run with STUDIO_WEB_URL=http://localhost:4173 set (or --url http://localhost:4173)';
if (!url) cannot(`no app URL — this driver drives a RUNNING app. Start it ${SERVE}`);

let pw;
try { pw = createRequire(join(resolve(root), 'package.json'))('playwright'); }
catch { cannot('Playwright is not installed in this project — add playwright as a committed devDependency (with its lockfile) via a ticket, then: npm ci && npx playwright install chromium'); }

(async () => {
  let browser;
  try { browser = await pw.chromium.launch(); }
  catch (e) { cannot(`Playwright could not start Chromium (${String(e.message).split('\n')[0]}) — run: npx playwright install chromium`); }
  const page = await browser.newPage();
  const el = (id) => { const q = JSON.stringify(String(id)); return page.locator(`[data-testid=${q}], [id=${q}], [aria-label=${q}]`).first(); };
  const steps = Array.isArray(journey.steps) ? journey.steps : [];
  try {
    for (const [i, s] of steps.entries()) {
      const n = i + 1;
      const failStep = (d) => { throw Object.assign(new Error(d), { step: n }); };
      const wait = async (id) => { try { await el(id).waitFor({ timeout: 5000 }); } catch { failStep(`step ${n}: no element "${id}" on the page`); } };
      switch (s.action) {
        case 'launch': try { await page.goto(url); } catch (e) { cannot(`step ${n}: could not open ${url} (${String(e.message).split('\n')[0]}) — is the app running? Start it ${SERVE}`); } break;
        case 'tap': await wait(s.id); await el(s.id).click(); break;
        case 'enter': await wait(s.id); await el(s.id).fill(String(s.value)); break;
        case 'back': await page.goBack(); break;
        case 'wait_for': await wait(s.id); break;
        case undefined: break;
        default: cannot(`step ${n}: unknown action "${s.action}"`);
      }
      const text = async () => String(await page.locator('body').innerText());
      switch (s.assert) {
        case undefined: break;
        case 'screen': await wait(s.id); break;
        case 'text_visible': if (!(await text()).includes(String(s.value))) failStep(`step ${n}: "${s.value}" is not visible`); break;
        case 'text_absent': if ((await text()).includes(String(s.value))) failStep(`step ${n}: "${s.value}" is visible`); break;
        case 'value_equals': {
          await wait(s.id);
          const got = await el(s.id).evaluate((e) => ('value' in e ? e.value : e.textContent || '').trim());
          if (got !== String(s.value)) failStep(`step ${n}: "${s.id}" is "${got}", expected "${s.value}"`);
          break;
        }
        case 'min_touch_target': {
          await wait(s.id);
          const b = await el(s.id).boundingBox();
          if (!b || b.width < s.dp || b.height < s.dp) failStep(`step ${n}: "${s.id}" is ${b ? `${b.width}x${b.height}` : 'not rendered'} CSS px, needs ${s.dp}`);
          break;
        }
        case 'announces': {
          // ponytail: accessible name = aria-label, else text; a live-region/AX-tree read is the upgrade.
          await wait(s.id);
          const name = await el(s.id).evaluate((e) => e.getAttribute('aria-label') || e.textContent || '');
          if (!name.includes(String(s.value))) failStep(`step ${n}: "${s.id}" announces "${name.trim()}", expected "${s.value}"`);
          break;
        }
        case 'is_checked': { // FL-15: `.value` of a checkbox is "on" whatever its state
          await wait(s.id);
          const on = await el(s.id).evaluate((e) => (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.getAttribute('aria-checked') === 'true'));
          if (on !== s.value) failStep(`step ${n}: "${s.id}" is ${on ? 'checked' : 'unchecked'}, expected ${s.value ? 'checked' : 'unchecked'}`);
          break;
        }
        default: cannot(`step ${n}: unknown assert "${s.assert}"`);
      }
    }
    mkdirSync(evDir, { recursive: true });
    const shot = join(evDir, `${jid}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    if (!existsSync(shot) || !statSync(shot).size) cannot('the journey ran but the screenshot could not be captured — a PASS with no evidence is not a pass');
    await browser.close();
    out('PASS', `${steps.length} steps ran in Chromium against ${url}`, { evidence: [shot] });
  } catch (e) {
    await browser.close().catch(() => {});
    if (e.step) out('FAIL', e.message, { failed_step: e.step });
    cannot(`driver error: ${e.message}`);
  }
})();
JS
