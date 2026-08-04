#!/usr/bin/env node
/**
 * project-profile — the toolchain contract, so a broken host never reads as a broken app.
 *
 * THE DEFECT CLASS THIS EXISTS FOR IS THE OLDEST ONE HERE. DR4-001: `verify-done` could not tell a
 * MISSING toolchain from a FAILING test, so it reported failure either way and sent developers to
 * fix bugs that did not exist. That was fixed once, in one script, by adding a three-state contract.
 * Every other runner in the studio still guesses — and each one guesses separately, which is how
 * the same defect gets rediscovered on a new host.
 *
 * The structural answer is a DECLARED contract rather than per-script inference: the project states
 * which platforms it targets and which commands build, test and run it. Then "the command is not
 * here" is a fact anyone can check, not something each runner has to deduce from an exit code that
 * means six different things.
 *
 * It also carries `project_id`, the first of the four identities the audit asked for
 * (project -> work contract -> work candidate -> release candidate). Stable across renames and
 * across machines, because a directory name is not an identity.
 *
 *   project-profile.mjs init  [--root <dir>] [--platform ios,android] [--force]
 *   project-profile.mjs show  [--root <dir>] [--json]
 *   project-profile.mjs doctor [--root <dir>]     is every declared command actually present?
 *
 * Exit codes: 0 clear · 1 a declared command is missing · 2 cannot evaluate (no profile)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`project-profile: ${message}\n`); process.exit(code); };
const { flags, positional } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'platform', 'build', 'test', 'run']),
  die,
});
const command = positional[0];
const root = resolve(String(flags.root || '.'));
const PROFILE = 'docs/team/project-profile.json';
const path = resolve(root, PROFILE);

function load() {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { die(2, `${PROFILE} is unreadable: ${e.message}`); }
}

if (command === 'init') {
  if (existsSync(path) && !flags.force) {
    // Regenerating would mint a NEW project_id, silently orphaning every artifact that referenced
    // the old one. An identity that changes when you re-run a setup command is not an identity.
    die(1, `${PROFILE} already exists. Re-running init would mint a new project_id and orphan every artifact that names the current one. Pass --force only if that is genuinely what you want.`);
  }
  const platforms = String(flags.platform || 'ios,android').split(',').map((p) => p.trim()).filter(Boolean);
  const profile = {
    schema: 'project-profile/v1',
    project_id: `proj-${randomUUID()}`,
    created_at: new Date().toISOString(),
    root: '.',
    platforms,
    toolchain: {
      // Declared, never inferred. An empty string means "this project has not said" — which reads
      // as CANNOT EVALUATE downstream, not as "no build needed".
      build: String(flags.build || ''),
      test: String(flags.test || ''),
      run: String(flags.run || ''),
    },
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`);
  process.stdout.write(`${PROFILE} written — project_id ${profile.project_id}\n`);
  process.exit(0);
}

if (command === 'show') {
  const profile = load();
  if (!profile) die(2, `no ${PROFILE} — run project-profile.mjs init`);
  process.stdout.write(flags.json ? `${JSON.stringify(profile, null, 2)}\n`
    : `project_id  ${profile.project_id}\nplatforms   ${(profile.platforms || []).join(', ')}\nbuild       ${profile.toolchain?.build || '(undeclared)'}\ntest        ${profile.toolchain?.test || '(undeclared)'}\nrun         ${profile.toolchain?.run || '(undeclared)'}\n`);
  process.exit(0);
}

if (command === 'doctor') {
  const profile = load();
  if (!profile) {
    process.stdout.write(
      `TOOLCHAIN: CANNOT EVALUATE — no ${PROFILE}.\n` +
      '  Nothing declares how this project builds, so no runner can tell a missing tool from a failing test.\n'
    );
    process.exit(2);
  }
  const missing = [];
  const undeclared = [];
  for (const [name, cmd] of Object.entries(profile.toolchain || {})) {
    if (!cmd) { undeclared.push(name); continue; }
    // Check the EXECUTABLE, not the whole command line: `xcodebuild -scheme X test` fails for many
    // reasons, and only one of them is "xcodebuild is not installed". This answers exactly that.
    const exe = cmd.trim().split(/\s+/)[0];
    try { execFileSync('command', ['-v', exe], { stdio: 'ignore', shell: true }); }
    catch { missing.push(`${name}: "${exe}" is not on PATH`); }
  }
  process.stdout.write('TOOLCHAIN\n');
  undeclared.forEach((u) => process.stdout.write(`  UNDECLARED  ${u} — this project has not said how to ${u}\n`));
  missing.forEach((m) => process.stdout.write(`  MISSING     ${m}\n`));
  if (missing.length) {
    process.stdout.write(
      `\nRESULT: BLOCKED — ${missing.length} declared command(s) are absent on this host.\n` +
      '  This is an ENVIRONMENT fact, not a product fact. Nothing here says the app is broken.\n'
    );
    process.exit(1);
  }
  if (undeclared.length) {
    process.stdout.write(`\nRESULT: CANNOT EVALUATE — ${undeclared.length} undeclared command(s).\n`);
    process.exit(2);
  }
  process.stdout.write('\nRESULT: CLEAR — every declared command is present.\n');
  process.exit(0);
}

die(2, 'usage: project-profile.mjs init|show|doctor [--root <dir>]');
