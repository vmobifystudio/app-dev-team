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

import { classifyTestRun } from './test-evidence.mjs';
import { gitAt, integrationBase, isAncestor, ticketTip } from './integration.mjs';
import { resolveProjectRoot } from './root.mjs';

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
export function writeTestEvidence(root, { producedBy, branch, base, head, mode, command = '', commandSource = 'caller', exitCode = null, output = '', commits = null, files = null }) {
  const name = stem('test', head);
  const record = {
    schema: 'test-evidence/v1', produced_by: producedBy, at: new Date().toISOString(),
    branch, base, head, mode, commits, files_changed: files,
    command, command_source: commandSource, exit_code: exitCode, verdict: 'n/a', why: '', log: null, log_sha256: null,
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

/** Declared test commands (project-profile test.fast / test.full). Empty when the profile declares none. */
function declaredCommands(root) {
  try {
    const p = JSON.parse(readFileSync(resolve(root, 'docs/team/project-profile.json'), 'utf8'));
    return [p.test?.fast, p.test?.full].filter((c) => typeof c === 'string' && c.trim());
  } catch { return []; }
}

// ponytail: "a document" is a path under docs/ or a prose extension. A docs ticket shipping a .json
// schema needs a real test run; widen this list only with a reason.
const DOC_FILE = /^docs\/|\.(md|mdx|txt|rst)$/i;

/** Is `head` the ticket's tip, or a descendant of it? `{ok, reason, code}`. */
function boundToTicket(git, ticket, head, recordedBranch) {
  const tip = ticketTip(git, ticket);
  if (tip.ambiguous.length) return { ok: false, code: 2, reason: `several branches are named for ${ticket} (${tip.ambiguous.join(', ')}) — the evidence cannot be bound to one` };
  if (tip.sha) {
    if (tip.sha === head || isAncestor(git, tip.sha, head)) return { ok: true, tip: tip.sha };
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
export function verifyTestEvidence(root, given, { ticket, afterTs = '', cwd = process.cwd() } = {}) {
  const loc = locate(root, given);
  if (!loc.ok) return loc;
  let rec;
  try { rec = JSON.parse(readFileSync(loc.abs, 'utf8')); } catch (e) { return { ok: false, code: 2, reason: `${loc.rel} is unreadable: ${e.message}` }; }
  const fail = (reason, code = 1) => ({ ok: false, code, reason: `${loc.rel}: ${reason}` });
  if (rec.schema !== 'test-evidence/v1') return fail(`is not test-evidence/v1 (got ${JSON.stringify(rec.schema)})`);
  if (!PRODUCERS.has(rec.produced_by)) return fail(`names producer ${JSON.stringify(rec.produced_by)}; only ${[...PRODUCERS].join(' / ')} write test evidence`);
  const git = gitAt(cwd);
  if (!rec.head || git(['cat-file', '-e', `${rec.head}^{commit}`]) === null) return fail(`its head ${rec.head || '(none)'} is not a commit in this repository`, 2);
  const bound = boundToTicket(git, ticket, rec.head, rec.branch);
  if (!bound.ok) return fail(bound.reason, bound.code || 1);
  if (afterTs && !(Date.parse(rec.at) > Date.parse(afterTs))) return fail(`was recorded at ${rec.at}, before ${ticket} merged (${afterTs}) — QA evidence is a run on the MERGED tree, not the developer's pre-review run`);

  if (rec.mode === 'tests') {
    const log = readLog(root, rec);
    if (!log.ok) return fail(log.reason);
    const again = classifyTestRun(Number(rec.exit_code), log.text);
    if (again.verdict !== rec.verdict) return fail(`says "${rec.verdict}" but re-classifying its own log gives "${again.verdict}"${again.why ? ` (${again.why})` : ''} — the recorded verdict is not the one its log supports`);
    if (again.verdict !== 'green') return fail(`the suite did not run green (${again.verdict}${again.why ? `: ${again.why}` : ''})`);
    const declared = declaredCommands(root);
    if (declared.length && !declared.includes(rec.command)) {
      return fail(`ran "${rec.command}", which is not a test command the project profile declares (${declared.map((c) => `"${c}"`).join(', ')}) — a caller-chosen command can be \`echo "Executed 9 tests"\`. Run verify-done with \`fast\` or \`full\`.`);
    }
  } else if (rec.mode === 'docs-only') {
    if (afterTs) return fail('is a --docs-only record; QA needs a run of the suite or a journey-gate result');
    const base = git(['merge-base', String(rec.base || 'main'), rec.head]);
    const files = base ? (git(['diff', '--name-only', base, rec.head]) || '').split('\n').filter(Boolean) : [];
    if (!files.length) return fail('a --docs-only record whose branch changes no files (re-derived from git) verifies nothing');
    const code = files.filter((f) => !DOC_FILE.test(f));
    if (code.length) return fail(`is --docs-only, but the branch changes non-document files (re-derived from git): ${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''} — run the tests`);
  } else {
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
  const tip = ticketTip(git, ticket);
  const head = String(v.subject.head);
  if (tip.ambiguous.length) return fail(`several branches are named for ${ticket} (${tip.ambiguous.join(', ')})`, 2);
  if (tip.sha && !(tip.sha === head || isAncestor(git, tip.sha, head))) return fail(`the journeys ran on ${head.slice(0, 12)}, which does not contain ${ticket}'s tip ${tip.sha.slice(0, 12)}`);
  if (!tip.sha) {
    const base = integrationBase(git);
    if (!base || !(git(['rev-parse', base]) === head || isAncestor(git, head, base))) return fail(`no branch is named for ${ticket} and ${head.slice(0, 12)} is not on the integration branch`);
  }
  return { ok: true, detail: { evidence: rel, evidence_sha256: sha256(readFileSync(abs)), evidence_head: head, evidence_mode: 'journey-gate', log_sha256: v.log_sha256 } };
}

// CLI ----------------------------------------------------------------------------------------------
//   evidence.mjs test --branch B --base X --head SHA --mode tests|docs-only [--command C]
//                     [--command-source profile|caller] [--exit N] [--log FILE] [--commits N] [--files N]
//       -> prints the record path (root-relative). Used by verify-done.sh.
//   evidence.mjs gate --gate NAME --result PASS|FAIL|CANNOT_EVALUATE --log FILE --out RESULT.json
//                     [--head SHA] [--dirty true|false]
//       -> writes a gate-result/v1 whose raw log readiness can re-derive. For runtime-gate --record.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = {};
  for (let i = 0; i < rest.length; i += 1) if (rest[i].startsWith('--')) { f[rest[i].slice(2)] = rest[i + 1] ?? ''; i += 1; }
  const root = evidenceRoot();
  const raw = f.log ? readFileSync(f.log, 'utf8') : '';
  if (cmd === 'test') {
    process.stdout.write(`${writeTestEvidence(root, {
      producedBy: 'verify-done.sh', branch: f.branch, base: f.base, head: f.head, mode: f.mode,
      command: f.command || '', commandSource: f['command-source'] || 'caller',
      exitCode: f.exit === undefined ? null : Number(f.exit), output: raw,
      commits: f.commits ? Number(f.commits) : null, files: f.files ? Number(f.files) : null,
    })}\n`);
  } else if (cmd === 'gate') {
    const head = f.head && f.head !== 'null' ? f.head : null;
    const text = `${raw}${raw.endsWith('\n') || !raw ? '' : '\n'}RESULT: ${String(f.result).replace('_', ' ')}\nGATE-SUBJECT: ${head ?? 'null'}\n`;
    const out = resolve(root, f.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({
      schema: 'gate-result/v1', gate: f.gate, subject: { head, dirty: f.dirty === undefined ? null : f.dirty === 'true' },
      evaluated_at: new Date().toISOString(), result: f.result, ...writeEvidenceLog(root, stem(f.gate, head), text),
    }, null, 2)}\n`);
  } else {
    process.stderr.write('evidence: usage: evidence.mjs test ... | evidence.mjs gate ...\n');
    process.exit(2);
  }
}
