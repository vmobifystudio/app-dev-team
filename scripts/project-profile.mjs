#!/usr/bin/env node
/**
 * project-profile — what this project IS, and what it takes to build and test it.
 *
 * F6, and the answer to R10: "AGP 9 / Kotlin / KSP toolchain incompatibility broke the build in two
 * different fixtures", open across two dry runs. The pattern both times was the same — the
 * toolchain was discovered to be wrong *when the build broke*, halfway through a sprint, by an
 * agent who then had to diagnose someone else's environment. Pinning it is not bureaucracy; it is
 * the difference between "this project needs JDK 17" being a fact and being folklore.
 *
 * IT ALSO OWNS test.fast / test.full, and that is the item with the shortest payback in this file.
 * `verify-done.sh` runs ONE test command per ticket — the whole suite, every time. Measured on this
 * very repository: a ten-minute inner loop, eight full runs to land two fixes, most of them spent
 * using the suite as a search tool. A one-line ticket does not need the whole matrix; a merge does.
 * Declaring both, per project, is what lets the loop spend its time proportionally.
 *
 *   test.fast   per-ticket. Scoped, seconds-to-a-minute. May legitimately miss cross-module breaks.
 *   test.full   at merge and before ship. The authority. What `verify-done.sh` should use when the
 *               ticket is the last one in, and what CI runs.
 *
 * THREE-STATE, LIKE EVERY GATE HERE. No profile is CANNOT EVALUATE, never "defaults are fine": a
 * project whose toolchain nobody wrote down has an UNKNOWN toolchain, and the whole point of R10 is
 * that the unknown one is what broke two builds.
 *
 * Usage:
 *   project-profile.mjs check [--root <dir>]     verify the declared toolchain against this machine
 *   project-profile.mjs show [--json]            print the profile
 *   project-profile.mjs test-command --scope fast|full   print the command to run (for scripts)
 *
 * Exit codes:
 *   0  the profile is present and every declared tool is present at the declared version
 *   1  a declared tool is present at the WRONG version — this project will not build correctly here
 *   2  cannot evaluate — no profile, or a declared tool is absent so nothing could be compared
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { classify } from './lib/environment.mjs';

const die = (code, message) => { process.stderr.write(`project-profile: ${message}\n`); process.exit(code); };

const { flags, positional } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'profile', 'scope']),
  die,
});
const [command] = positional;

let ROOT;
if (typeof flags.root === 'string') {
  ROOT = resolve(flags.root);
} else {
  const resolved = resolveProjectRoot({
    explicit: typeof flags['project-root'] === 'string' ? flags['project-root'] : '',
  });
  if (!resolved.ok) die(2, explainRootFailure(resolved));
  ROOT = resolved.root;
}
const PROFILE = typeof flags.profile === 'string'
  ? resolve(flags.profile)
  : resolve(ROOT, 'docs/team/project-profile.json');

function load() {
  if (!existsSync(PROFILE)) {
    die(2, `no project profile at ${PROFILE}\n` +
           '  This project\'s platform, toolchain and test commands are UNKNOWN, which is not the\n' +
           '  same as "the defaults are fine" — R10 is two builds broken by a toolchain nobody had\n' +
           '  written down. Create it:\n' +
           '\n' +
           '  {\n' +
           '    "schema": "project-profile/v1",\n' +
           '    "platform": "ios",\n' +
           '    "toolchain": [{ "tool": "xcodebuild", "args": ["-version"], "expect": "16." }],\n' +
           '    "test": { "fast": "swift test --filter Unit", "full": "xcodebuild test -scheme App" }\n' +
           '  }');
  }
  let p;
  try { p = JSON.parse(readFileSync(PROFILE, 'utf8')); }
  catch (e) { die(2, `${PROFILE} is not readable JSON: ${e.message}`); }
  if (p.schema !== 'project-profile/v1') {
    die(2, `${PROFILE} must declare "schema": "project-profile/v1" (got ${JSON.stringify(p.schema)})`);
  }
  return p;
}

function cmdCheck() {
  const p = load();
  const tools = Array.isArray(p.toolchain) ? p.toolchain : [];
  if (!tools.length) {
    die(2, 'the profile declares no toolchain, so there is nothing to verify.\n' +
           '  An empty toolchain list is UNKNOWN, not "no requirements".');
  }

  let blocked = 0;
  let unevaluable = 0;
  process.stdout.write(`PROJECT PROFILE — ${p.platform || 'platform unstated'}\n\n`);

  for (const t of tools) {
    if (!t || typeof t.tool !== 'string') { process.stdout.write('  CANNOT EVALUATE  (malformed toolchain entry)\n'); unevaluable += 1; continue; }
    let status = 0;
    let output = '';
    try {
      output = execFileSync(t.tool, Array.isArray(t.args) ? t.args : [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      status = e.status ?? null;
      output = `${e.stdout || ''}${e.stderr || ''}${e.message || ''}`;
    }
    const c = classify({ status, output });
    if (c.kind === 'environment') {
      // ABSENT IS NOT WRONG. A tool that is not installed cannot be compared against a version, so
      // this is exit 2 — the same distinction DR4-001 was about, applied before the build instead
      // of during it.
      process.stdout.write(`  CANNOT EVALUATE  ${t.tool} — ${c.reason}\n`);
      unevaluable += 1;
      continue;
    }
    if (typeof t.expect === 'string' && t.expect && !output.includes(t.expect)) {
      process.stdout.write(`  BLOCKED          ${t.tool} — expected ${JSON.stringify(t.expect)}, got: ${output.trim().split('\n')[0]}\n`);
      blocked += 1;
      continue;
    }
    process.stdout.write(`  PASS             ${t.tool}${t.expect ? ` (${t.expect})` : ''}\n`);
  }

  const test = p.test || {};
  process.stdout.write(`\n  test.fast  ${test.fast || 'UNSTATED — every ticket will pay for the full suite'}\n`);
  process.stdout.write(`  test.full  ${test.full || 'UNSTATED — nothing states what must pass before merge'}\n`);

  if (blocked) {
    process.stdout.write(`\nRESULT: BLOCKED — ${blocked} tool(s) are the wrong version. This project will not build correctly here.\n`);
    process.exit(1);
  }
  if (unevaluable) {
    process.stdout.write(
      `\nRESULT: CANNOT EVALUATE — ${unevaluable} declared tool(s) are absent, so the toolchain is UNPROVEN here.\n` +
      '  This is NOT a pass. Install them, or run on a machine that has them.\n'
    );
    process.exit(2);
  }
  process.stdout.write('\nRESULT: CLEAR — every declared tool is present at its declared version.\n');
}

function cmdShow() {
  const p = load();
  if (flags.json) { process.stdout.write(`${JSON.stringify(p, null, 2)}\n`); return; }
  process.stdout.write(
    `PROJECT PROFILE\n  platform  ${p.platform || 'UNSTATED'}\n` +
    `  toolchain ${(p.toolchain || []).map((t) => t.tool).join(', ') || 'UNSTATED'}\n` +
    `  test.fast ${p.test?.fast || 'UNSTATED'}\n  test.full ${p.test?.full || 'UNSTATED'}\n`
  );
}

/**
 * Print the command for a scope, so `verify-done.sh` and CI can ask rather than hardcode.
 *
 * An unstated scope is exit 2 with nothing on stdout — a caller that substitutes its own default
 * for a missing declaration is how "the tests ran" becomes true of a different command than anyone
 * intended.
 */
function cmdTestCommand() {
  const p = load();
  const scope = String(flags.scope || '');
  if (scope !== 'fast' && scope !== 'full') die(1, 'test-command needs --scope fast|full');
  const value = p.test?.[scope];
  if (!value) {
    die(2, `the profile declares no test.${scope}.\n` +
           `  Nothing is substituted for it: a default test command would make "the tests ran" true\n` +
           '  of a command nobody chose.');
  }
  process.stdout.write(`${value}\n`);
}

switch (command) {
  case 'check': cmdCheck(); break;
  case 'show': cmdShow(); break;
  case 'test-command': cmdTestCommand(); break;
  default:
    die(1, `unknown command "${command ?? ''}"\n` +
           '  check                        verify the declared toolchain against this machine\n' +
           '  show [--json]                print the profile\n' +
           '  test-command --scope fast|full   print the command a caller should run');
}
