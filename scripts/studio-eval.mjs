#!/usr/bin/env node
/**
 * studio-eval — the evaluation laboratory. Mutation testing, one level up.
 *
 * WHY THIS EXISTS
 *
 * `scripts/mutate.sh` asks one question of one script: can this assertion go red? This asks the
 * same question of the whole studio: given a project with a defect planted in it, does the studio
 * find it?
 *
 * Without an answer, every improvement to this system is a belief. The plan calls this "the
 * instrument that tells us whether P1-P3 worked", and it is deliberately built BEFORE those
 * changes so they can be measured rather than asserted. A ruler made after the construction
 * measures the construction's own assumptions.
 *
 * HOW IT WORKS
 *
 * `eval/<name>/` is a small, complete project fixture carrying EXACTLY ONE planted defect and a
 * `manifest.json` naming the detector that is supposed to find it. This runs that detector against
 * that project and compares the answer to the manifest.
 *
 *   DETECTED             the named detector ran and returned its blocking verdict. The gate bites.
 *   MISSED               the named detector ran and did not. THAT IS A HOLE, and exit 1.
 *   NOT MUTATABLE HERE   no detector was claimed, or the claimed one cannot run on this host.
 *                        Excluded from the denominator and PRINTED, with the reason.
 *
 * The third verdict is the one that carries the information. Most of the planted defects in this
 * lab have NO detector at all today — a money constant that is wrong, a privacy label that
 * contradicts the code, a P0 feature with no analytics event. Those are not failures of the lab;
 * they are the measurement, and they are printed as GAPS in their own section at the end.
 *
 * THE HONESTY RULE, taken directly from mutate.sh
 *
 * A score that quietly omits the hard cases is the lie this whole system exists to prevent. So the
 * denominator says what it excluded, every exclusion carries a stated reason, and the two kinds of
 * exclusion are kept apart: `unreachable` means THIS MACHINE lacks a toolchain, `gap` means THE
 * STUDIO lacks a detector. Conflating them would let a missing simulator launder a missing gate.
 *
 * THE CLEAN PROJECT
 *
 * `eval/clean/` has no defect and must complete with ZERO false blocks. This half matters as much
 * as the other: a studio that blocks everything scores 100% on detection and is useless. Its
 * false-positive result is reported as a first-class number, not as an afterthought, and a single
 * false block fails the run.
 *
 * Usage:
 *   node scripts/studio-eval.mjs                every project
 *   node scripts/studio-eval.mjs --list         print the projects and their manifests, then exit
 *   node scripts/studio-eval.mjs --only <name>  one project
 *
 * Exit:
 *   0  every scored defect was detected AND the clean project was not blocked
 *   1  a planted defect escaped its own detector, or the clean project was falsely blocked
 *   2  could not run — no manifest, a malformed one, a detector script that is not there, git
 *      missing where a fixture needs it. Never 0: "I could not look" is not "I looked and it was
 *      fine", which is the same rule every gate in this repo follows.
 *
 * Zero dependencies: Node stdlib and the repo's own POSIX-sh gates.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LAB = join(ROOT, 'eval');

const cannot = (reason) => {
  process.stdout.write(`\nSTUDIO EVAL: CANNOT RUN — ${reason}\n`);
  process.stdout.write('This is NOT a pass. Nothing was measured.\n');
  process.exit(2);
};

// --- arguments ----------------------------------------------------------------------------------
let only = '';
let list = false;
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a === '--list') list = true;
  else if (a === '--only') { only = process.argv[i + 1] || ''; i += 1; }
  else if (a.startsWith('--only=')) only = a.slice('--only='.length);
  else if (a === '-h' || a === '--help') { process.stdout.write('usage: studio-eval.mjs [--list] [--only <project>]\n'); process.exit(0); }
  else cannot(`unknown argument '${a}'`);
}
if (only && !existsSync(join(LAB, only, 'manifest.json'))) {
  cannot(`no project named '${only}' in eval/. Try --list.`);
}

// --- load the manifests -------------------------------------------------------------------------
if (!existsSync(LAB)) cannot(`no eval/ directory at ${LAB}`);

const names = readdirSync(LAB)
  .filter((n) => existsSync(join(LAB, n, 'manifest.json')))
  .sort();
if (names.length === 0) cannot(`no project in ${LAB} carries a manifest.json`);

const projects = names.map((name) => {
  const path = join(LAB, name, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    cannot(`${path} is not valid JSON: ${e.message}`);
  }
  // A manifest that does not say what it planted cannot be scored, and guessing would make the
  // denominator a fiction. Refuse rather than skip: a silently skipped project is a defect that
  // reports as neither detected nor missed, which is the shape this lab exists to forbid.
  for (const field of ['name', 'defect', 'severity', 'why']) {
    if (!(field in manifest)) cannot(`${path} has no "${field}" field`);
  }
  if (manifest.name !== name) cannot(`${path} names itself "${manifest.name}" but lives in eval/${name}`);
  return { name, dir: join(LAB, name), manifest };
});

// The clean project is not optional. Delete it and the lab still printed a detection score and
// exited 0, having measured nothing about false positives — a score that is trivially maximised by
// blocking everything, reported as a pass. Found by removing eval/clean/manifest.json and watching
// this stay green. The false-positive number is half the measurement, so its absence is CANNOT RUN.
if (!projects.some((p) => p.manifest.clean)) {
  cannot('no project in eval/ declares `"clean": true`. Without one, the false-positive rate is unmeasured and the detection score alone is meaningless — it is maximised by a studio that blocks every project.');
}

if (list) {
  process.stdout.write('EVALUATION LABORATORY\n\n');
  for (const { name, manifest } of projects) {
    const kind = manifest.clean ? 'CLEAN (must not be blocked)'
      : manifest.unreachable ? 'NOT MUTATABLE HERE'
        : manifest.expected_detector ? `scored by ${manifest.expected_detector}`
          : 'NO DETECTOR EXISTS';
    process.stdout.write(`${name}  [${manifest.severity || '—'}]  ${kind}\n`);
    if (manifest.defect) process.stdout.write(`      defect: ${manifest.defect}\n`);
    if (manifest.unreachable) process.stdout.write(`      unreachable: ${manifest.unreachable}\n`);
    if (manifest.gap) process.stdout.write(`      gap: ${manifest.gap}\n`);
    process.stdout.write('\n');
  }
  process.exit(0);
}

// --- running a check ------------------------------------------------------------------------------
const cleanups = [];
process.on('exit', () => { for (const fn of cleanups) { try { fn(); } catch { /* best effort */ } } });

/**
 * Some gates reason about branches and commits, so their fixture has to be a real repository.
 * Built fresh in a temp dir from a COPY of the project — never the project itself, and never this
 * repo, whose .git a stray command could reach. `git init` with an explicit identity so the run
 * does not depend on the operator having configured one.
 */
function gitFixture(project, spec) {
  const git = (args, cwd) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) cannot(`git ${args.join(' ')} failed in ${project.name}: ${(r.stderr || '').trim()}`);
    return r;
  };
  if (spawnSync('git', ['--version'], { encoding: 'utf8' }).status !== 0) {
    cannot(`${project.name} needs a git fixture and git is not on PATH`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'studio-eval-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(project.dir, dir, { recursive: true });

  const id = ['-c', 'user.name=studio-eval', '-c', 'user.email=studio-eval@localhost'];
  git(['init', '-q', '-b', 'main'], dir);
  git([...id, 'add', '-A'], dir);
  git([...id, 'commit', '-q', '-m', 'base'], dir);
  git(['checkout', '-q', '-b', spec.branch], dir);
  writeFileSync(join(dir, 'src', 'CHANGED.swift'), '// the work the DONE report claims\n');
  git([...id, 'add', '--', 'src/CHANGED.swift'], dir);
  git([...id, 'commit', '-q', '-m', 'the ticket'], dir);
  return dir;
}

/** Runs one check and returns { exit, output }. */
function runCheck(project, check) {
  if (!Array.isArray(check.run) || check.run.length === 0) {
    cannot(`${project.name}: "run" must be a non-empty array of argv words`);
  }
  let cwd = ROOT;
  let projectPath = project.dir;
  if (check.in === 'git-fixture') {
    if (!check.git_fixture || !check.git_fixture.branch) {
      cannot(`${project.name}: a git-fixture check must name its branch`);
    }
    if (!existsSync(join(project.dir, 'src'))) {
      cannot(`${project.name}: a git-fixture check needs a src/ directory to commit into`);
    }
    projectPath = gitFixture(project, check.git_fixture);
    cwd = projectPath;
  }
  const argv = check.run.map((w) => w.replaceAll('{project}', projectPath).replaceAll('{root}', ROOT));

  // The detector must be a script that exists. A typo'd path would otherwise exit non-zero and read
  // as DETECTED — a lab that scores its own typos as successes measures nothing. Resolved against
  // the repo root, because the gates are invoked from a fixture's cwd.
  const scriptArg = argv.find((w) => w.startsWith('scripts/'));
  if (scriptArg) {
    const abs = join(ROOT, scriptArg);
    if (!existsSync(abs)) cannot(`${project.name}: detector ${scriptArg} does not exist`);
    argv[argv.indexOf(scriptArg)] = abs;
  }

  const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', env: { ...process.env } });
  if (r.error) cannot(`${project.name}: could not run ${argv[0]} — ${r.error.message}`);
  return { exit: r.status, output: `${r.stdout || ''}${r.stderr || ''}` };
}

// --- score -----------------------------------------------------------------------------------------
const detected = [];
const missed = [];
const unreachable = [];
const gaps = [];
let cleanResult = null;
let cleanChecked = 0;

process.stdout.write('STUDIO EVAL — golden projects with planted defects\n');
process.stdout.write(`  lab:  ${LAB}\n`);
process.stdout.write(`  gates under test run from: ${ROOT}\n\n`);

for (const project of projects) {
  if (only && project.name !== only) continue;
  const m = project.manifest;

  // --- the clean project ------------------------------------------------------------------------
  if (m.clean) {
    const falseBlocks = [];
    for (const check of m.checks || []) {
      cleanChecked += 1;
      const { exit, output } = runCheck(project, check);
      const want = check.expect_exit ?? 0;
      const signalOk = !check.expect_signal || output.includes(check.expect_signal);
      if (exit !== want || !signalOk) {
        falseBlocks.push({
          cmd: check.run.join(' '),
          exit,
          want,
          detail: exit !== want ? `exit ${exit}, expected ${want}` : `expected output to carry "${check.expect_signal}"`,
          output,
        });
      }
    }
    cleanResult = falseBlocks;
    if (falseBlocks.length === 0) {
      process.stdout.write(`CLEAR              ${project.name}  (${cleanChecked} gate(s), zero false blocks)\n\n`);
    } else {
      process.stdout.write(`FALSE BLOCK        ${project.name}\n`);
      for (const fb of falseBlocks) {
        process.stdout.write(`                   ${fb.cmd}\n                   ${fb.detail}\n`);
        process.stdout.write(`${fb.output.trimEnd().split('\n').map((l) => `                   | ${l}`).join('\n')}\n`);
      }
      process.stdout.write('\n');
    }
    continue;
  }

  // --- a defect this machine cannot reach --------------------------------------------------------
  if (m.unreachable) {
    unreachable.push(project);
    process.stdout.write(`NOT MUTATABLE HERE ${project.name}  [${m.severity}]\n`);
    process.stdout.write(`                   detector: ${m.expected_detector || '—'}\n`);
    process.stdout.write(`                   ${m.unreachable}\n\n`);
    continue;
  }

  // --- a defect no detector in this studio can find ----------------------------------------------
  if (!m.expected_detector) {
    gaps.push(project);
    process.stdout.write(`NOT MUTATABLE HERE ${project.name}  [${m.severity}]  NO DETECTOR EXISTS\n`);
    process.stdout.write(`                   ${m.gap || m.why}\n\n`);
    continue;
  }

  // --- scored ------------------------------------------------------------------------------------
  const check = m.detector || {};
  const { exit, output } = runCheck(project, {
    run: check.run || ['sh', m.expected_detector, '{project}'],
    in: check.in,
    git_fixture: check.git_fixture,
  });
  const wantExit = check.expect_exit ?? 1;
  const wantSignal = m.expected_signal;
  const exitOk = exit === wantExit;
  const signalOk = !wantSignal || output.includes(wantSignal);

  if (exitOk && signalOk) {
    detected.push(project);
    process.stdout.write(`DETECTED           ${project.name}  [${m.severity}]  by ${m.expected_detector} (exit ${exit})\n\n`);
  } else {
    missed.push({ project, exit, wantExit, wantSignal, exitOk, signalOk, output });
    process.stdout.write(`MISSED             ${project.name}  [${m.severity}]\n`);
    process.stdout.write(`                   ${m.expected_detector} was supposed to find this and did not.\n`);
    if (!exitOk) process.stdout.write(`                   exit ${exit}, expected ${wantExit}\n`);
    if (!signalOk) process.stdout.write(`                   output does not carry "${wantSignal}"\n`);
    process.stdout.write(`${output.trimEnd().split('\n').map((l) => `                   | ${l}`).join('\n')}\n\n`);
  }
}

// --- the report --------------------------------------------------------------------------------------
const scored = detected.length + missed.length;
process.stdout.write('─────────────────────────────────────────\n');
process.stdout.write(`DETECTION SCORE: ${detected.length}/${scored} planted defect(s) caught by the detector named for them\n\n`);

process.stdout.write(`Denominator: ${scored}. It EXCLUDES ${unreachable.length + gaps.length} planted defect(s), named here rather than dropped:\n\n`);

if (unreachable.length > 0) {
  process.stdout.write('  NOT MUTATABLE HERE — the detector exists, this host cannot run it:\n');
  for (const p of unreachable) {
    process.stdout.write(`    · ${p.name} (${p.manifest.expected_detector})\n        ${p.manifest.unreachable}\n`);
  }
  process.stdout.write('\n');
}

if (gaps.length > 0) {
  process.stdout.write('  NO DETECTOR EXISTS — the defect is planted and nothing in this studio can find it.\n');
  process.stdout.write('  THIS IS THE MOST VALUABLE OUTPUT IN THIS FILE. Each line is a real defect class that\n');
  process.stdout.write('  reaches a user today, and the score above deliberately does not launder it:\n');
  for (const p of gaps) {
    process.stdout.write(`    · ${p.name} [${p.manifest.severity}]\n        ${p.manifest.defect}\n        ${p.manifest.gap || p.manifest.why}\n`);
  }
  process.stdout.write('\n');
}

process.stdout.write('  Those defects are UNMEASURED here. The score does not claim otherwise.\n\n');

// The false-positive rate is a first-class number. A studio that blocks everything scores 100% on
// detection and is useless, so this is printed next to the score and never below the fold.
if (!only || only === 'clean') {
  if (cleanResult === null) {
    process.stdout.write('FALSE-POSITIVE RATE: NOT MEASURED — no clean project ran.\n');
  } else {
    const fp = cleanResult.length;
    process.stdout.write(`FALSE-POSITIVE RATE: ${fp}/${cleanChecked} gate(s) blocked the clean project.\n`);
    process.stdout.write(fp === 0
      ? '  Zero false blocks. Detection above was not bought by refusing everything.\n'
      : '  A gate refused a project with nothing wrong with it. That is as disqualifying as a miss:\n  a studio nobody can get a release past is a studio nobody runs.\n');
  }
  process.stdout.write('\n');
}

if (missed.length > 0) {
  process.stdout.write(`ESCAPED — ${missed.length} planted defect(s) walked past the gate written for them:\n`);
  for (const m of missed) {
    process.stdout.write(`  ${m.project.name}  ${m.project.manifest.expected_detector}\n        ${m.project.manifest.defect}\n`);
  }
  process.stdout.write('\nRe-run one with:  node scripts/studio-eval.mjs --only <name>\n');
  process.exit(1);
}

if (cleanResult && cleanResult.length > 0) {
  process.stdout.write('The clean project was blocked. Fix the gate, not the project.\n');
  process.exit(1);
}

process.stdout.write('Every scored defect was caught, and the clean project shipped. The lab passes.\n');
process.exit(0);
