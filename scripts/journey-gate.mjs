#!/usr/bin/env node
/**
 * journey-gate — prove a declared P0 user journey actually completes on a running app.
 *
 * WHY THIS EXISTS, measured rather than assumed. Six dry runs of this studio produced the same
 * result: the gates caught every PROCESS defect (version mismatch, illegal board transition, fake
 * test command, unspawnable owner) and ZERO PRODUCT defects. A date picker whose selection was
 * discarded for `System.currentTimeMillis()`. A 24dp touch target where the spec said 56dp. A
 * TalkBack announcement that stayed stale. A corrupt-data fallback indistinguishable from data
 * loss. A device test that exercised its own stub. Every one was found by a reviewer who went and
 * looked, or by a human afterwards — never by a gate.
 *
 * `runtime-gate.sh` is the closest thing that existed, and its PASS means: it built, it installed,
 * it launched, and the process was still alive 3 seconds later. That is a real and useful claim.
 * It is also entirely compatible with an app that shows a splash screen and does nothing the user
 * asked for. This gate makes a different claim: **a declared journey ran, step by step, and its
 * assertions held.**
 *
 * THE THREE-STATE CONTRACT, same as every other gate here:
 *   0  PASS            — every step ran and every assertion held
 *   1  FAIL            — a step or an assertion did not hold. The product is wrong.
 *   2  CANNOT EVALUATE — the journey could not be exercised (no declaration, no device, no driver).
 *                        NEVER a pass. An unrun journey and a passing journey are different facts.
 *
 * EVIDENCE IS NOT OPTIONAL. `runtime-gate.sh` used to return PASS when its screenshot failed, with
 * the reason "no evidence artifact" — a pass whose own sentence said it proved nothing. Fixed
 * 2026-08-04, and this gate is built to the corrected rule from the start: a step that cannot be
 * observed is CANNOT EVALUATE, never a pass.
 *
 * DECLARATION > INFERENCE. This gate never guesses what the product should do. It reads journeys
 * from `docs/team/journeys/*.json` — written by the team, reviewed like any other artifact. A
 * journey nobody declared is a journey this gate reports as undeclared, not one it invents.
 *
 * Usage:
 *   journey-gate.mjs --root <project> [--journeys <dir>] [--driver <path>] [--only <id>]
 *   journey-gate.mjs --root <project> --list        # what is declared, without running anything
 *
 * THE DRIVER SEAM. Executing a step against a real device needs a platform driver (adb+uiautomator,
 * simctl+XCUITest). Those are not written yet, and pretending otherwise would be the exact
 * green-while-nothing-happened defect this repo tracks as FC-002. With no driver, every runnable
 * journey is CANNOT EVALUATE and says so by name. `--driver` points at an executable implementing
 * the contract in `docs/team/journeys/README.md`; the schema, the validation, the staleness rule
 * and the reporting are complete and testable today, which is what lets a driver be dropped in
 * without re-litigating any of it.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`journey-gate: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'journeys', 'driver', 'only']),
  die,
});

const root = resolve(String(flags.root || '.'));
if (!existsSync(root)) die(2, `no such project root: ${root}`);
const journeyDir = resolve(root, typeof flags.journeys === 'string' ? flags.journeys : 'docs/team/journeys');

/** Every step shape this gate understands. A step it cannot execute is refused at load, not at run. */
const ACTIONS = new Set(['launch', 'tap', 'enter', 'back', 'wait_for']);
const ASSERTS = new Set(['screen', 'text_visible', 'text_absent', 'value_equals', 'min_touch_target', 'announces']);

/**
 * A journey is only worth trusting if its assertions could have failed. `assert: screen` after
 * `action: launch` and nothing else is a liveness check wearing a journey's clothes — exactly what
 * this gate exists to replace. So a declared journey must assert something ABOUT THE PRODUCT, not
 * only that a screen appeared.
 */
function validate(journey, file) {
  const problems = [];
  if (journey.schema !== 'journey/v1') problems.push(`schema must be "journey/v1", got ${JSON.stringify(journey.schema)}`);
  if (!journey.id) problems.push('no id');
  if (!Array.isArray(journey.steps) || !journey.steps.length) problems.push('no steps');

  let substantive = 0;
  for (const [i, step] of (journey.steps || []).entries()) {
    const at = `step ${i + 1}`;
    if (step.action && step.assert) problems.push(`${at}: a step is an action OR an assert, never both`);
    else if (step.action) {
      if (!ACTIONS.has(step.action)) problems.push(`${at}: unknown action ${JSON.stringify(step.action)}`);
      if (['tap', 'enter', 'wait_for'].includes(step.action) && !step.id) problems.push(`${at}: ${step.action} needs an id`);
      if (step.action === 'enter' && step.value === undefined) problems.push(`${at}: enter needs a value`);
    } else if (step.assert) {
      if (!ASSERTS.has(step.assert)) problems.push(`${at}: unknown assert ${JSON.stringify(step.assert)}`);
      // `screen` alone only says something rendered; the others say something about the product.
      if (step.assert !== 'screen') substantive += 1;
      if (['text_visible', 'text_absent', 'value_equals', 'announces'].includes(step.assert) && step.value === undefined) {
        problems.push(`${at}: ${step.assert} needs a value`);
      }
      if (step.assert === 'min_touch_target' && !(Number(step.dp) > 0)) problems.push(`${at}: min_touch_target needs a positive dp`);
    } else problems.push(`${at}: neither an action nor an assert`);
  }

  if (!problems.length && substantive === 0) {
    problems.push(
      'every assertion is `screen` — this journey proves a screen rendered, which runtime-gate already ' +
      'proves. Assert something the USER would notice: a value that survived the round trip, a label, ' +
      'a touch target, an announcement.'
    );
  }

  // The round-trip lesson, encoded. A journey that enters today's date or 0 cannot tell a working
  // save from `System.currentTimeMillis()` or a default — the exact defect that survived three
  // separate reviews of the same fixture.
  for (const step of journey.steps || []) {
    if (step.action !== 'enter') continue;
    const v = String(step.value ?? '');
    if (v === '' || v === '0') {
      problems.push(`enter "${step.id}" uses ${JSON.stringify(v)} — indistinguishable from an empty default. Use a distinguishable value.`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v === new Date().toISOString().slice(0, 10)) {
      problems.push(`enter "${step.id}" uses today's date — indistinguishable from a clock call. Use a fixed past date.`);
    }
  }
  return { ok: !problems.length, problems, file };
}

function load() {
  if (!existsSync(journeyDir)) return { ok: false, reason: `no journey declarations at ${journeyDir}`, journeys: [] };
  const files = readdirSync(journeyDir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) return { ok: false, reason: `${journeyDir} contains no *.json journey declarations`, journeys: [] };
  const journeys = [];
  const invalid = [];
  for (const f of files) {
    const path = join(journeyDir, f);
    let parsed;
    try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) { invalid.push({ file: f, problems: [`not valid JSON: ${e.message}`] }); continue; }
    const v = validate(parsed, f);
    if (v.ok) journeys.push({ ...parsed, _file: f, _path: path });
    else invalid.push({ file: f, problems: v.problems });
  }
  return { ok: true, journeys, invalid };
}

const loaded = load();

if (flags.list) {
  if (!loaded.ok) { process.stdout.write(`JOURNEY GATE: none declared — ${loaded.reason}\n`); process.exit(2); }
  for (const j of loaded.journeys) {
    process.stdout.write(`${j.priority || 'P?'}  ${j.id}  (${j.steps.length} steps)  ${j._file}\n`);
  }
  for (const bad of loaded.invalid) {
    process.stdout.write(`INVALID  ${bad.file}\n`);
    bad.problems.forEach((p) => process.stdout.write(`         ${p}\n`));
  }
  process.exit(loaded.invalid.length ? 1 : 0);
}

// A malformed declaration is a FAIL, not a skip: it is a journey somebody meant to run. Silently
// dropping it would put a P0 flow in neither the numerator nor the denominator, which is the one
// outcome the evaluation lab's own rules forbid.
if (loaded.ok && loaded.invalid.length) {
  process.stderr.write('JOURNEY GATE: FAIL — declarations that cannot be run:\n');
  for (const bad of loaded.invalid) {
    process.stderr.write(`  ${bad.file}\n`);
    bad.problems.forEach((p) => process.stderr.write(`    ${p}\n`));
  }
  process.exit(1);
}

if (!loaded.ok) {
  process.stdout.write(
    `JOURNEY GATE: CANNOT EVALUATE — ${loaded.reason}.\n` +
    '  This is NOT a pass. Nothing states what this product must do, so nothing was checked.\n' +
    '  Declare at least one P0 journey (see docs/team/journeys/README.md) and re-run.\n'
  );
  process.exit(2);
}

const selected = flags.only
  ? loaded.journeys.filter((j) => j.id === String(flags.only))
  : loaded.journeys.filter((j) => (j.priority || 'P0') === 'P0');

if (!selected.length) {
  process.stdout.write(
    `JOURNEY GATE: CANNOT EVALUATE — ${flags.only ? `no journey with id ${flags.only}` : 'no P0 journey is declared'}.\n` +
    '  This is NOT a pass.\n'
  );
  process.exit(2);
}

// THE DRIVER SEAM. No driver → every journey is CANNOT EVALUATE, named individually. This is the
// honest state today: the schema, validation and reporting are real and tested; execution against a
// device is not written. Claiming otherwise is the defect this file's header names.
const driver = typeof flags.driver === 'string' ? resolve(String(flags.driver)) : null;
if (!driver || !existsSync(driver)) {
  process.stdout.write('JOURNEY GATE: CANNOT EVALUATE — no journey driver available.\n\n');
  for (const j of selected) {
    process.stdout.write(`  ${j.priority || 'P0'}  ${j.id}  — declared, ${j.steps.length} steps, NOT executed\n`);
  }
  process.stdout.write(
    `\n  ${driver ? `--driver ${driver} does not exist` : 'no --driver was supplied'}. A journey nobody ran is\n` +
    '  UNKNOWN, never a pass: an unrun journey and a passing journey are different facts, and the\n' +
    '  whole reason this gate exists is that they were being reported as the same one.\n' +
    '  Driver contract: docs/team/journeys/README.md\n'
  );
  process.exit(2);
}

const results = [];
for (const j of selected) {
  const started = new Date().toISOString();
  let raw;
  try {
    raw = execFileSync(driver, ['--root', root, '--journey', j._path], { encoding: 'utf8', timeout: 300000 });
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
    // A driver that dies is not a product that failed. Distinguish them, or a broken harness reads
    // as a broken app and a developer is sent to fix a defect that does not exist (DR4-001).
    const crashed = typeof e.status !== 'number' || e.status > 1;
    results.push({ j, state: crashed ? 'UNKNOWN' : 'FAIL', detail: out || (crashed ? `driver exited abnormally: ${e.message}` : 'journey failed'), started });
    continue;
  }
  let report;
  try { report = JSON.parse(raw); }
  catch { results.push({ j, state: 'UNKNOWN', detail: 'driver did not emit a parseable journey-result/v1 report', started }); continue; }
  if (report.schema !== 'journey-result/v1' || !['PASS', 'FAIL', 'CANNOT_EVALUATE'].includes(report.result)) {
    results.push({ j, state: 'UNKNOWN', detail: `driver report is not journey-result/v1 (got ${JSON.stringify(report.result)})`, started });
    continue;
  }
  // Evidence is not optional — the corrected runtime-gate rule, applied here from the start.
  if (report.result === 'PASS' && !(Array.isArray(report.evidence) && report.evidence.length)) {
    results.push({ j, state: 'UNKNOWN', detail: 'driver reported PASS with no evidence artifact — a pass nobody can inspect is not a pass', started });
    continue;
  }
  results.push({
    j,
    state: report.result === 'CANNOT_EVALUATE' ? 'UNKNOWN' : report.result,
    detail: report.detail || (report.failed_step ? `failed at step ${report.failed_step}` : ''),
    evidence: report.evidence || [],
    started,
  });
}

process.stdout.write('JOURNEY GATE\n');
for (const r of results) {
  const label = r.state === 'PASS' ? 'PASS   ' : r.state === 'FAIL' ? 'FAIL   ' : 'UNKNOWN';
  process.stdout.write(`  ${label}  ${r.j.id}  ${r.detail}\n`);
  (r.evidence || []).forEach((e) => process.stdout.write(`           evidence: ${e}\n`));
}

const anyFail = results.some((r) => r.state === 'FAIL');
const anyUnknown = results.some((r) => r.state === 'UNKNOWN');
process.stdout.write('\n');
if (anyFail) {
  process.stdout.write('RESULT: FAIL — a declared P0 journey did not complete. The product is wrong, not the harness.\n');
  process.exit(1);
}
if (anyUnknown) {
  process.stdout.write('RESULT: CANNOT EVALUATE — at least one journey was not exercised. This is NOT a pass.\n');
  process.exit(2);
}
process.stdout.write(`RESULT: PASS — ${results.length} declared P0 journey(s) completed with their assertions holding.\n`);
