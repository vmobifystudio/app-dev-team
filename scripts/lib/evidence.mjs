/**
 * evidence/v1 — a gate passes only on evidence a SCRIPT produced and the board can RE-DERIVE.
 *
 * G-F4 / G-F6. `verified` and `qa_passed` used to carry a free-text `--detail` ("verify-done.sh
 * green") and readiness accepted any well-formed gate-result/v1 JSON. Both were claims about a run,
 * not the run. So:
 *
 *   test-evidence/v1   written by verify-done.sh (and wave-integrate.mjs) when a claim VERIFIES:
 *                      the raw test log under docs/team/evidence/, its sha256, the exit code, the
 *                      classifier verdict, the branch and the exact head SHA the suite ran on.
 *                      `board.mjs move <T> verified --evidence <record>` re-reads the log, re-hashes
 *                      it and RE-RUNS lib/test-evidence.mjs's classifier over it. A hand-typed
 *                      "green" whose log says "Executed 0 tests" is refused; so is a record for a
 *                      commit that is not (an ancestor of) the ticket's branch tip.
 *   gate-result/v1     journey-gate (and, once Track D adopts `evidence.mjs gate`, runtime-gate)
 *     + log            now carry `log` + `log_sha256`: the raw output the verdict came from, whose
 *                      `RESULT:` line must agree with `result` and whose `GATE-SUBJECT:` line must
 *                      name `subject.head`. Readiness refuses a result without one.
 *
 * THE WRITER RUNS THE THING ITSELF (G2-2). The CLI used to take `--result`, `--exit` and `--log`
 * from its caller, so `evidence.mjs test --exit 0 --log <a file saying "Executed 9 tests">` minted
 * a record the board accepted: a forgery through the sanctioned door. Now `test` runs the command
 * (resolved from the project profile for `--scope`), `docs`/`static` derive head and files from
 * git, and `gate` runs a KNOWN plugin gate script (GATES below) — each records its own exit code and
 * output. Nothing a caller says about an outcome is written down.
 *
 * THE BOUND, STATED. Re-derivation defeats a hand-written VERDICT — a result that says PASS over a
 * log that says otherwise, a green with no log, a log edited after the fact, a record for another
 * commit. It does NOT defeat an agent that fabricates the raw log itself and hashes it: every byte
 * here is in the same filesystem the agent can write. What closes that is upstream — the test
 * command must be the project-profile's declared one (checked below when the profile declares
 * any), `docs/team/` is outside every role's allowed_paths, and a forged log is a deliberate,
 * transcript-visible act rather than a confused agent's typo.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { classifyTestRun } from './test-evidence.mjs';
import { gitAt, integrationBase, isAncestor, ticketIdsFromBoard, ticketTip } from './integration.mjs';
import { resolveProjectRoot } from './root.mjs';
import { treeDirty } from './readiness.mjs';
import { inlineTokenFlag } from './actor.mjs';
import { censusTestFiles, isTestFile } from '../assertion-census.mjs';

export const EVIDENCE_DIR = 'docs/team/evidence';
export const PRODUCERS = new Set(['verify-done.sh', 'wave-integrate.mjs']);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The project root evidence is written under: the studio root, else the git common dir's parent. */
export function evidenceRoot(from = process.cwd()) {
  const r = resolveProjectRoot({ from });
  if (r.ok) return r.root;
  try {
    return dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: from, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { return resolve(from); }
}

const stem = (prefix, head) => `${prefix}-${String(head || 'nohead').slice(0, 12)}-${Date.now()}-${randomBytes(3).toString('hex')}`;

/** Write a raw log under docs/team/evidence/. Returns `{log, log_sha256}` (log is root-relative). */
export function writeEvidenceLog(root, name, text) {
  mkdirSync(resolve(root, EVIDENCE_DIR), { recursive: true });
  const log = `${EVIDENCE_DIR}/${name}.log`;
  writeFileSync(resolve(root, log), text);
  return { log, log_sha256: sha256(text) };
}

/** Write a test-evidence/v1 record (and its raw log). Returns the root-relative record path. */
export function writeTestEvidence(root, { producedBy, branch, base, head, mode, command = '', commandSource = 'caller', exitCode = null, output = '', commits = null, files = null, census = null, dirty = null }) {
  const name = stem('test', head);
  const record = {
    schema: 'test-evidence/v1', produced_by: producedBy, at: new Date().toISOString(),
    branch, base, head, mode, commits, files_changed: files,
    command, command_source: commandSource, exit_code: exitCode, verdict: 'n/a', why: '', log: null, log_sha256: null,
    ...(census ? { assertion_census: census } : {}),
    ...(dirty === null ? {} : { dirty }),
  };
  if (mode === 'tests') {
    const c = classifyTestRun(Number(exitCode), output);
    Object.assign(record, { verdict: c.verdict, why: c.why }, writeEvidenceLog(root, name, output));
  }
  mkdirSync(resolve(root, EVIDENCE_DIR), { recursive: true });
  const rel = `${EVIDENCE_DIR}/${name}.json`;
  writeFileSync(resolve(root, rel), `${JSON.stringify(record, null, 2)}\n`);
  return rel;
}

/** Resolve a caller-supplied evidence path, and refuse anything outside docs/team/evidence/. */
function locate(root, given) {
  if (typeof given !== 'string' || !given.trim()) return { ok: false, reason: 'no --evidence <record> was given' };
  const fromCwd = resolve(process.cwd(), given);
  const abs = existsSync(fromCwd) ? fromCwd : resolve(root, given);
  if (!existsSync(abs) || !statSync(abs).isFile()) return { ok: false, code: 2, reason: `no evidence record at ${given}` };
  const dir = resolve(realpathSync(root), EVIDENCE_DIR) + sep;
  const real = realpathSync(abs);
  if (!real.startsWith(dir)) return { ok: false, reason: `${given} is not under ${EVIDENCE_DIR}/ — evidence is what verify-done/journey-gate wrote there, not a file chosen at the moment of the claim` };
  return { ok: true, abs: real, rel: relative(realpathSync(root), real).split(sep).join('/') };
}

/** The raw log a record or result points at: present, inside the evidence dir, and hashing to its sha. */
function readLog(root, rec) {
  if (!rec.log || !rec.log_sha256) return { ok: false, reason: 'it carries no raw log pointer + sha256, so nothing can re-derive its verdict (a hand-written result looks exactly like this)' };
  const abs = resolve(root, String(rec.log));
  if (!abs.startsWith(resolve(root, EVIDENCE_DIR) + sep)) return { ok: false, reason: `its log ${rec.log} is not under ${EVIDENCE_DIR}/` };
  if (!existsSync(abs)) return { ok: false, reason: `its raw log ${rec.log} is missing` };
  const text = readFileSync(abs, 'utf8');
  if (sha256(text) !== rec.log_sha256) return { ok: false, reason: `its raw log ${rec.log} no longer hashes to the recorded sha256 — the log was edited after the verdict` };
  return { ok: true, text };
}

/** Declared test commands by scope (project-profile test.fast / test.full). {} when none. */
function profileTests(root) {
  try {
    const t = JSON.parse(readFileSync(resolve(root, 'docs/team/project-profile.json'), 'utf8')).test || {};
    return Object.fromEntries(['fast', 'full'].filter((k) => typeof t[k] === 'string' && t[k].trim()).map((k) => [k, t[k]]));
  } catch { return {}; }
}
function declaredCommands(root) { return Object.values(profileTests(root)); }

// ponytail: "a document" is a path under docs/ or a prose extension. A docs ticket shipping a .json
// schema needs a real test run; widen this list only with a reason.
// G2-25: a docs/ that is a SERVED SITE (GitHub Pages: docs/index.html, _config.yml or CNAME at the
// head) is product, not documentation — there only prose extensions count as documents.
const PROSE_FILE = /\.(md|mdx|txt|rst)$/i;
const docFile = (served) => (f) => PROSE_FILE.test(f) || (!served && /^docs\//.test(f));
function docsIsServedSite(git, head) {
  const listed = git(['ls-tree', '--name-only', `${head}:docs`]);
  return Boolean(listed && listed.split('\n').some((f) => ['index.html', '_config.yml', 'CNAME'].includes(f)));
}

/**
 * Is `head` the ticket's tip (or, unless `exact`, a descendant of it)? `{ok, reason, code}`.
 * G2-4: verify-done evidence must be EXACTLY the tip — a descendant scratch branch carrying extra
 * commits was accepted for `verified`. Descendants stay legal for a wave run and for QA's run on
 * the merged tree, where the ticket is, by construction, an ancestor of what ran.
 */
function boundToTicket(git, ticket, head, recordedBranch, { exact = false, root = '' } = {}) {
  const tip = ticketTip(git, ticket, root ? ticketIdsFromBoard(root) : []);
  if (tip.ambiguous.length) return { ok: false, code: 2, reason: `several branches are named for ${ticket} (${tip.ambiguous.join(', ')}) — the evidence cannot be bound to one` };
  if (tip.sha) {
    if (tip.sha === head || (!exact && isAncestor(git, tip.sha, head))) return { ok: true, tip: tip.sha };
    if (exact && isAncestor(git, tip.sha, head)) return { ok: false, reason: `the evidence ran on ${head.slice(0, 12)}, a DESCENDANT of ${ticket}'s tip ${tip.sha.slice(0, 12)} (${tip.branch}) carrying commits the ticket does not — \`verified\` is about exactly the tip. Re-run verify-done on ${tip.branch}.` };
    return { ok: false, reason: `the evidence ran on ${head.slice(0, 12)}, which does not contain ${ticket}'s branch tip ${tip.sha.slice(0, 12)} (${tip.branch}) — it is about older or different code. Re-run verify-done on the current tip.` };
  }
  // No branch named for the ticket (work on a shared branch): the record must still describe the
  // CURRENT tip of the branch it names, or it is evidence about a commit that has since moved.
  const now = recordedBranch ? git(['rev-parse', '--verify', `${recordedBranch}^{commit}`]) : null;
  if (now && now === head) return { ok: true, tip: head };
  return { ok: false, reason: `no branch is named for ${ticket}, and the evidence's branch ${recordedBranch || '(none)'} is now at ${now ? now.slice(0, 12) : 'nothing'}, not the ${head.slice(0, 12)} it ran on` };
}

/**
 * Re-derive a test-evidence/v1 record for `ticket`. `afterTs` (qa_passed) requires the run to have
 * happened after that moment (the merge). Returns `{ok, detail}` or `{ok:false, code, reason}`.
 */
export function verifyTestEvidence(root, given, { ticket, afterTs = '', cwd = process.cwd(), allowStatic = false, exactHead = '' } = {}) {
  const loc = locate(root, given);
  if (!loc.ok) return loc;
  let rec;
  try { rec = JSON.parse(readFileSync(loc.abs, 'utf8')); } catch (e) { return { ok: false, code: 2, reason: `${loc.rel} is unreadable: ${e.message}` }; }
  const fail = (reason, code = 1) => ({ ok: false, code, reason: `${loc.rel}: ${reason}` });
  if (rec.schema !== 'test-evidence/v1') return fail(`is not test-evidence/v1 (got ${JSON.stringify(rec.schema)})`);
  if (!PRODUCERS.has(rec.produced_by)) return fail(`names producer ${JSON.stringify(rec.produced_by)}; only ${[...PRODUCERS].join(' / ')} write test evidence`);
  const git = gitAt(cwd);
  if (!rec.head || git(['cat-file', '-e', `${rec.head}^{commit}`]) === null) return fail(`its head ${rec.head || '(none)'} is not a commit in this repository`, 2);
  const exact = rec.produced_by === 'verify-done.sh' && !afterTs;
  const bound = boundToTicket(git, ticket, rec.head, rec.branch, { exact, root });
  if (!bound.ok) return fail(bound.reason, bound.code || 1);
  if (exactHead && rec.head !== exactHead) return fail(`ran on ${String(rec.head).slice(0, 12)}, not the commit being approved (${exactHead.slice(0, 12)})`);
  if (afterTs && !(Date.parse(rec.at) > Date.parse(afterTs))) return fail(`was recorded at ${rec.at}, before ${ticket} merged (${afterTs}) — QA evidence is a run on the MERGED tree, not the developer's pre-review run`);

  if (rec.mode === 'tests') {
    const log = readLog(root, rec);
    if (!log.ok) return fail(log.reason);
    const again = classifyTestRun(Number(rec.exit_code), log.text);
    if (again.verdict !== rec.verdict) return fail(`says "${rec.verdict}" but re-classifying its own log gives "${again.verdict}"${again.why ? ` (${again.why})` : ''} — the recorded verdict is not the one its log supports`);
    if (again.verdict !== 'green') return fail(`the suite did not run green (${again.verdict}${again.why ? `: ${again.why}` : ''})`);
    // G2-3: the command must be one the PROFILE declares, resolved by the writer from the profile
    // (command_source "profile"). A profile that declares none cannot verify a code ticket at all.
    const declared = declaredCommands(root);
    if (!declared.length) {
      return fail('the project profile declares no test command (docs/team/project-profile.json test.fast / test.full), so no run can verify a code ticket — a caller-chosen command can be `echo "Executed 9 tests"`. Declare test.fast, then run verify-done with `fast`.', 2);
    }
    if (rec.command_source !== 'profile' || !declared.includes(rec.command)) {
      return fail(`ran "${rec.command}" (command_source ${JSON.stringify(rec.command_source)}), which is not a test command the project profile declares (${declared.map((c) => `"${c}"`).join(', ')}) — a caller-chosen command can be \`echo "Executed 9 tests"\`. Run verify-done with \`fast\` or \`full\`.`);
    }
    if (rec.dirty === true) return fail('the suite ran on a working tree with uncommitted changes to tracked files — it tested code that is not the commit. Commit or discard, then re-run.');
    // G2-22: a changed suite whose tests assert nothing is not evidence the code works.
    if (rec.assertion_census?.assert_nothing) {
      return fail(`the changed test files declare ${rec.assertion_census.tests} test(s) and ZERO assertions (${(rec.assertion_census.files || []).join(', ')}) — a suite that asserts nothing passes whatever the code does.`);
    }
  } else if (rec.mode === 'docs-only') {
    if (afterTs) return fail('is a --docs-only record; QA needs a run of the suite or a journey-gate result');
    const base = git(['merge-base', String(rec.base || integrationBase(git) || 'main'), rec.head]);
    const files = base ? (git(['diff', '--name-only', base, rec.head]) || '').split('\n').filter(Boolean) : [];
    if (!files.length) return fail('a --docs-only record whose branch changes no files (re-derived from git) verifies nothing');
    const isDoc = docFile(docsIsServedSite(git, rec.head));
    const code = files.filter((f) => !isDoc(f));
    if (code.length) return fail(`is --docs-only, but the branch changes non-document files (re-derived from git): ${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''} — run the tests`);
  } else if (!(allowStatic && rec.mode === 'static')) {
    return fail(`has mode ${JSON.stringify(rec.mode)}; only "tests" and "docs-only" earn verified`);
  }
  return {
    ok: true,
    detail: {
      evidence: loc.rel,
      evidence_sha256: sha256(readFileSync(loc.abs)),
      evidence_head: rec.head,
      evidence_mode: rec.mode,
      evidence_verdict: rec.verdict,
      ...(rec.log_sha256 ? { log_sha256: rec.log_sha256 } : {}),
    },
  };
}

/**
 * Does a gate-result/v1 re-derive from its raw log? Used by readiness (G-F6), qa_passed and
 * merged's required_evidence. `{ok, reason}`.
 */
export function checkGateLog(root, v) {
  const log = readLog(root, v);
  if (!log.ok) return log;
  const words = [...log.text.matchAll(/^RESULT: (PASS|FAIL|CANNOT EVALUATE)\b/gm)];
  const last = words.length ? words[words.length - 1][1].replace(' ', '_') : '';
  if (last !== v.result) return { ok: false, reason: `its raw log's RESULT line says ${last || 'nothing'} but the result file says ${v.result} — the file is not the verdict its own log reached` };
  const subjects = [...log.text.matchAll(/^GATE-SUBJECT: (\S+)/gm)];
  const subject = subjects.length ? subjects[subjects.length - 1][1] : '';
  if (subject !== String(v.subject?.head ?? 'null')) return { ok: false, reason: `its raw log was taken on ${subject || 'no recorded subject'}, the result file claims ${v.subject?.head}` };
  // The cited artifacts (journey screenshots) must still be the bytes the verdict looked at.
  for (const j of v.journeys || []) {
    for (const e of j.evidence || []) {
      const abs = resolve(root, String(e.path));
      if (!existsSync(abs) || sha256(readFileSync(abs)) !== e.sha256) return { ok: false, reason: `${j.id}: cited evidence ${e.path} is missing or changed since the verdict` };
    }
  }
  return { ok: true };
}

/**
 * Re-derive QA evidence for `ticket`: a journey-gate result (PASS, clean tree, log re-derives, run
 * on a tree containing the ticket's tip) or a test-evidence run recorded after the merge.
 */
export function verifyQaEvidence(root, given, { ticket, mergedTs, cwd = process.cwd() } = {}) {
  const loc = locate(root, given);
  if (!loc.ok) {
    // journey-gate writes docs/team/journey-result.json; accept it by its own path too.
    const jr = resolve(root, 'docs/team/journey-result.json');
    if (typeof given !== 'string' || (resolve(process.cwd(), given) !== jr && resolve(root, given) !== jr) || !existsSync(jr)) return loc;
    return verifyJourney(root, jr, 'docs/team/journey-result.json', { ticket, cwd });
  }
  let rec;
  try { rec = JSON.parse(readFileSync(loc.abs, 'utf8')); } catch (e) { return { ok: false, code: 2, reason: `${loc.rel} is unreadable: ${e.message}` }; }
  if (rec.schema === 'gate-result/v1') return verifyJourney(root, loc.abs, loc.rel, { ticket, cwd });
  return verifyTestEvidence(root, given, { ticket, afterTs: mergedTs || '1970-01-01T00:00:00Z', cwd });
}

function verifyJourney(root, abs, rel, { ticket, cwd }) {
  let v;
  try { v = JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { return { ok: false, code: 2, reason: `${rel} is unreadable: ${e.message}` }; }
  const fail = (reason, code = 1) => ({ ok: false, code, reason: `${rel}: ${reason}` });
  if (v.schema !== 'gate-result/v1' || v.gate !== 'journey-gate') return fail('is not a journey-gate gate-result/v1');
  if (v.result !== 'PASS') return fail(`journey-gate result is ${v.result}, not PASS`);
  if (v.subject?.dirty !== false) return fail('was recorded against a dirty (or unknown) working tree');
  const derived = checkGateLog(root, v);
  if (!derived.ok) return fail(derived.reason);
  const git = gitAt(cwd);
  const tip = ticketTip(git, ticket, ticketIdsFromBoard(root));
  const head = String(v.subject.head);
  if (tip.ambiguous.length) return fail(`several branches are named for ${ticket} (${tip.ambiguous.join(', ')})`, 2);
  if (tip.sha && !(tip.sha === head || isAncestor(git, tip.sha, head))) return fail(`the journeys ran on ${head.slice(0, 12)}, which does not contain ${ticket}'s tip ${tip.sha.slice(0, 12)}`);
  if (!tip.sha) {
    const base = integrationBase(git);
    if (!base || !(git(['rev-parse', base]) === head || isAncestor(git, head, base))) return fail(`no branch is named for ${ticket} and ${head.slice(0, 12)} is not on the integration branch`);
  }
  return { ok: true, detail: { evidence: rel, evidence_sha256: sha256(readFileSync(abs)), evidence_head: head, evidence_mode: 'journey-gate', log_sha256: v.log_sha256 } };
}

// Writers that RUN the thing ----------------------------------------------------------------------

/**
 * Run a test command on `branch` checked out in `dir` and record what happened. The command is
 * `test.<scope>` from the project profile (command_source "profile") or, for a caller-supplied
 * `command`, command_source "caller" — which the board refuses for `verified` (G2-3). The exit code
 * and output are this process's own observation; `dir` must have `branch`'s commit checked out.
 * The changed test files go through the assertion census (G2-22).
 */
export function runTestEvidence(root, { branch, base, dir, scope = '', command = '', cwd = process.cwd(), producedBy = 'verify-done.sh' }) {
  const git = gitAt(cwd);
  const head = git(['rev-parse', '--verify', `${branch}^{commit}`]);
  if (!head) return { ok: false, reason: `${branch} does not resolve to a commit` };
  let cmd = command;
  let source = 'caller';
  if (scope) {
    cmd = profileTests(root)[scope] || '';
    source = 'profile';
    if (!cmd) return { ok: false, reason: `the project profile declares no test.${scope}` };
  }
  if (!cmd) return { ok: false, reason: 'no test command (give --scope fast|full, or --command)' };
  const at = resolve(cwd, dir || '.');
  const inDir = gitAt(at);
  const dirHead = inDir(['rev-parse', 'HEAD']);
  if (dirHead !== head) return { ok: false, reason: `${at} has ${dirHead || 'nothing'} checked out, not ${branch} (${head})` };
  const dirty = inDir(['status', '--porcelain', '--untracked-files=no']);
  const run = spawnSync('sh', ['-c', cmd], { cwd: at, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = `${run.stdout || ''}${run.stderr || ''}${run.error ? `\n${run.error.message}\n` : ''}`;
  const exitCode = run.status === null ? 128 : run.status;
  const mb = git(['merge-base', base, head]);
  const changed = mb ? (git(['diff', '--name-only', mb, head]) || '').split('\n').filter(Boolean) : [];
  const tests = changed.filter(isTestFile).flatMap((f) => {
    const text = git(['show', `${head}:${f}`]);
    return text === null ? [] : [{ path: f, text }];
  });
  const census = tests.length ? censusTestFiles(tests) : null;
  const commits = Number(git(['rev-list', '--count', `${base}..${head}`]) || 0);
  const rel = writeTestEvidence(root, {
    producedBy, branch, base, head, mode: 'tests', command: cmd, commandSource: source, exitCode, output,
    commits, files: changed.length, census, dirty: Boolean(dirty),
  });
  const rec = JSON.parse(readFileSync(resolve(root, rel), 'utf8'));
  return { ok: true, record: rel, verdict: rec.verdict, why: rec.why, exit: exitCode, log: rec.log ? resolve(root, rec.log) : '', command: cmd, command_source: source, census, dirty: Boolean(dirty) };
}

/** A docs-only or static record: head and counts come from git, never from the caller. */
export function writeBranchEvidence(root, { branch, base, mode, cwd = process.cwd() }) {
  const git = gitAt(cwd);
  const head = git(['rev-parse', '--verify', `${branch}^{commit}`]);
  if (!head) return { ok: false, reason: `${branch} does not resolve to a commit` };
  const mb = git(['merge-base', base, head]);
  const files = mb ? (git(['diff', '--name-only', mb, head]) || '').split('\n').filter(Boolean).length : 0;
  const commits = Number(git(['rev-list', '--count', `${base}..${head}`]) || 0);
  return { ok: true, record: writeTestEvidence(root, { producedBy: 'verify-done.sh', branch, base, head, mode, commits, files }) };
}

/** The gate scripts `gate` may run, by name. Only the plugin's own — never a caller's path. */
const HERE = dirname(fileURLToPath(import.meta.url));
export const GATES = { 'runtime-gate': ['sh', resolve(HERE, '..', 'runtime-gate.sh')] };

/**
 * Run a known gate against `projectRoot` and write its gate-result/v1: result from the gate's OWN
 * exit code (0 PASS, 1 FAIL, anything else CANNOT_EVALUATE), head and dirty from git (dirty = the
 * tree was dirty BEFORE the run, or HEAD moved during it; no head -> dirty null), log = its own output.
 */
export function runGate(projectRoot, { gate, out, args = [] }) {
  const argv = GATES[gate];
  if (!argv) return { ok: false, code: 2, reason: `unknown gate ${JSON.stringify(gate)} — only ${Object.keys(GATES).join(', ')} (journey-gate records itself)` };
  if (args.includes('--record') || args.includes('--project-root')) return { ok: false, code: 2, reason: '--record / --project-root cannot be passed through; this command is the recording, and --root names the project' };
  const root = resolve(projectRoot);
  const git = gitAt(root);
  const head = git(['rev-parse', 'HEAD']);
  const dirtyBefore = head ? treeDirty(root) : true;
  const run = spawnSync(argv[0], [...argv.slice(1), '--project-root', root, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const raw = `${run.stdout || ''}${run.stderr || ''}`;
  const result = run.status === 0 ? 'PASS' : run.status === 1 ? 'FAIL' : 'CANNOT_EVALUATE';
  // Dirty is the tree the gate was GIVEN (W2-12): a build's own dist/ must not dirty its record. HEAD
  // moving under the run still voids it.
  const dirty = head ? (dirtyBefore || git(['rev-parse', 'HEAD']) !== head) : null;
  const text = `${raw}${raw.endsWith('\n') || !raw ? '' : '\n'}RESULT: ${result.replace('_', ' ')}\nGATE-SUBJECT: ${head ?? 'null'}\n`;
  const outAbs = resolve(root, out || `docs/team/${gate.replace(/-gate$/, '')}-result.json`);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, `${JSON.stringify({
    schema: 'gate-result/v1', gate, subject: { head: head || null, dirty },
    evaluated_at: new Date().toISOString(), result, ...writeEvidenceLog(root, stem(gate, head), text),
  }, null, 2)}\n`);
  return { ok: true, status: run.status, stdout: run.stdout || '', stderr: run.stderr || '', result, out: outAbs };
}

// CLI ----------------------------------------------------------------------------------------------
//   evidence.mjs test   --branch B --base X --dir D (--scope fast|full | --command C)
//       runs the command itself; prints one JSON line {record, verdict, why, exit, log, ...}
//   evidence.mjs docs   --branch B --base X      a --docs-only record (head/files from git)
//   evidence.mjs static --branch B --base X      a --static record (the suite is owed to the wave)
//   evidence.mjs gate   --gate runtime-gate [--root R] [--out RESULT.json] -- <gate args>
//       runs the plugin's own gate script, prints its output, exits with its code
//   evidence.mjs token-flag --role R --ticket T   the inline-mint --token text, or nothing
// There is no --result, --exit or --log: a writer that accepts the outcome from its caller is a
// forgery service with a schema (G2-2).
// The guard never throws: under `node -e` argv[1] is an ordinary argument, not a path.
const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf('--');
  const [cmd, ...rest] = dash === -1 ? argv : argv.slice(0, dash);
  const passthrough = dash === -1 ? [] : argv.slice(dash + 1);
  const f = {};
  for (let i = 0; i < rest.length; i += 1) if (rest[i].startsWith('--')) { f[rest[i].slice(2)] = rest[i + 1] ?? ''; i += 1; }
  const bye = (code, msg) => { process.stderr.write(`evidence: ${msg}\n`); process.exit(code); };
  for (const forged of ['result', 'exit', 'log', 'head', 'dirty', 'command-source']) {
    if (forged in f) bye(2, `--${forged} is not accepted: the writer observes the outcome itself (G2-2)`);
  }
  if (cmd === 'test') {
    if (!f.branch || !f.base) bye(2, 'test needs --branch and --base');
    const r = runTestEvidence(evidenceRoot(), { branch: f.branch, base: f.base, dir: f.dir || '.', scope: f.scope || '', command: f.command || '' });
    if (!r.ok) bye(2, r.reason);
    process.stdout.write(`${JSON.stringify(r)}\n`);
  } else if (cmd === 'docs' || cmd === 'static') {
    if (!f.branch || !f.base) bye(2, `${cmd} needs --branch and --base`);
    const r = writeBranchEvidence(evidenceRoot(), { branch: f.branch, base: f.base, mode: cmd === 'docs' ? 'docs-only' : 'static' });
    if (!r.ok) bye(2, r.reason);
    process.stdout.write(`${r.record}\n`);
  } else if (cmd === 'token-flag') {
    // For shell callers that PRINT a next-step board command (W2-10): the inline-mint --token form
    // when the project requires tokens, else nothing.
    process.stdout.write(inlineTokenFlag(evidenceRoot(), f.role || '<role>', f.ticket || '<ID>'));
  } else if (cmd === 'gate') {
    const r = runGate(f.root || evidenceRoot(), { gate: f.gate, out: f.out, args: passthrough });
    if (!r.ok) bye(r.code || 2, r.reason);
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exit(r.status === null ? 2 : r.status);
  } else {
    bye(2, 'usage: evidence.mjs test|docs|static|gate ... (see the header)');
  }
}
