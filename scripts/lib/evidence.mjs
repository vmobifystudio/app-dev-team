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
 * command must be one the BOARD FROZE from the project profile (C3G-3, design C), the suite runs in
 * a fresh worktree of the exact commit (C3G-7, design E), `docs/team/` is outside every role's
 * allowed_paths, and a forged log is a deliberate, transcript-visible act rather than a confused
 * agent's typo.
 *
 * C3G-17 BOUND: a record and log hand-written into docs/team/evidence/ (through a guard evasion)
 * with a consistent sha still re-derive — nothing here is signed. What this file does guarantee is
 * that the path is CANONICAL: `docs//team`, `./docs/team` and symlinked spellings all resolve to
 * the one real evidence directory before the prefix check (locate/readLog), so a path game cannot
 * point a record outside it, and the recorded path is the normalized one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, posix, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { classifyTestRun } from './test-evidence.mjs';
import { gitAt, integrationBase, isAncestor, matchesTicket, ticketIdsFromBoard, ticketTip } from './integration.mjs';
import { resolveProjectRoot } from './root.mjs';
import { indexHides, treeDirty } from './readiness.mjs';
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
  // C3G-17: the pointer must be the CANONICAL spelling (what writeEvidenceLog writes), and its real
  // path must sit in the real evidence dir — `docs//team/…`, `./docs/…` or a symlink out are refused.
  const rel = String(rec.log);
  if (rel !== posix.normalize(rel) || rel.startsWith('./') || !rel.startsWith(`${EVIDENCE_DIR}/`)) return { ok: false, reason: `its log ${rel} is not under ${EVIDENCE_DIR}/ in canonical form` };
  const abs = resolve(root, rel);
  if (!existsSync(abs)) return { ok: false, reason: `its raw log ${rec.log} is missing` };
  if (!realpathSync(abs).startsWith(resolve(realpathSync(root), EVIDENCE_DIR) + sep)) return { ok: false, reason: `its log ${rel} resolves outside ${EVIDENCE_DIR}/` };
  const text = readFileSync(abs, 'utf8');
  if (sha256(text) !== rec.log_sha256) return { ok: false, reason: `its raw log ${rec.log} no longer hashes to the recorded sha256 — the log was edited after the verdict` };
  return { ok: true, text };
}

/** Declared test commands by scope (project-profile test.fast / test.full). {} when none. */
function testsOf(text) {
  try {
    const t = JSON.parse(text).test || {};
    return Object.fromEntries(['fast', 'full'].filter((k) => typeof t[k] === 'string' && t[k].trim()).map((k) => [k, t[k]]));
  } catch { return {}; }
}
function profileTests(root) {
  try { return testsOf(readFileSync(resolve(root, 'docs/team/project-profile.json'), 'utf8')); } catch { return {}; }
}

/**
 * C3G-3 / design C: THE DECLARED TEST COMMANDS ARE FROZEN ON THE BOARD. project-profile.json is a
 * file any role with Write can edit, so "the command the profile declares" was whatever the profile
 * said at the moment of the claim: `test.full: "echo Executed 9 tests"` minted a profile-sourced
 * green. The board stamps `test_profile` {commands, sha} on the first gate event once the profile
 * declares one (board.mjs), and only an orchestrator `corrected --test-profile` re-freezes it.
 * `frozenTestProfile` is the latest stamp on the log ({commands: null} when none yet).
 * BOUND: until the first gate event nothing is frozen, so a profile edited before any gate event is
 * what gets frozen — it is in the tree, reviewable, and every later edit needs the orchestrator.
 */
export const BOARD_LOG = 'docs/31-board-events.jsonl';
/**
 * C4G-G4: what gets FROZEN is the profile COMMITTED on the integration branch
 * (`git show <integration>:docs/team/project-profile.json`), never a working-tree edit of it — an
 * uncommitted edit is nobody's decision.
 * BOUND: no git repository, no integration branch, or a profile never committed there → the
 * working-tree file (there is no committed decision to prefer; /app-init commits the profile, so a
 * real project leaves this bound after its first commit).
 */
export function currentTestProfile(root) {
  const git = gitAt(root);
  const integration = git(['rev-parse', '--git-dir']) === null ? '' : integrationBase(git);
  const text = integration ? git(['show', `${integration}:docs/team/project-profile.json`]) : null;
  if (text !== null) return { commands: testsOf(text), sha: sha256(`${text}\n`), source: integration };
  let sha = null;
  try { sha = sha256(readFileSync(resolve(root, 'docs/team/project-profile.json'))); } catch { /* no profile */ }
  return { commands: profileTests(root), sha, source: 'working tree' };
}
export function frozenTestProfile(logPath) {
  let frozen = null;
  try {
    for (const l of readFileSync(logPath, 'utf8').split('\n')) {
      if (!l.includes('"test_profile"')) continue;
      try { const tp = JSON.parse(l).test_profile; if (tp && tp.commands) frozen = tp; } catch { /* loadLog reports bad lines */ }
    }
  } catch { /* no log */ }
  return frozen || { commands: null, sha: null };
}
export const sameCommands = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());
/** The commands a record must have run: the board's frozen set, else (nothing frozen yet) the profile's. */
function declaredCommands(root) {
  const frozen = frozenTestProfile(resolve(root, BOARD_LOG)).commands;
  return Object.values(frozen || currentTestProfile(root).commands); // C4G-G4: committed, not the working tree
}
/**
 * FB4: the COMMAND decides, not who typed it — an explicit command string identical to a declared
 * one is that command. `{ok}` or `{ok:false, code, reason}`. Shared with verify-done (FB3), so it
 * never prints VERIFIED for a record the board will refuse.
 */
export function commandAccepted(root, rec) {
  const declared = declaredCommands(root);
  if (!declared.length) {
    return { ok: false, code: 2, reason: 'the project profile declares no test command (docs/team/project-profile.json test.fast / test.full), so no run can verify a code ticket — a caller-chosen command can be `echo "Executed 9 tests"`. Declare test.fast, then run verify-done with `fast`.' };
  }
  if (!declared.includes(rec.command)) {
    return { ok: false, code: 1, reason: `ran "${rec.command}", which is not a test command the board accepts (the ones it froze from the project profile) (${declared.map((c) => `"${c}"`).join(', ')}) — a caller-chosen command can be \`echo "Executed 9 tests"\`. Run verify-done with \`fast\` or \`full\`.` };
  }
  return { ok: true };
}

// C4G-G1: WHAT COUNTS AS "A DOCUMENT". It used to be "any .md/.mdx/.txt anywhere, and all of
// docs/" — so a QA- branch changing docs/team/risk-policy.json ({"rules":[]}), project-profile.json,
// CMakeLists.txt, requirements.txt or app/page.mdx was verified AND merged with no review, and the
// relaxed risk policy governed every later merge. Now:
//   - docs/team/** is the studio's CONTROL and DATA plane (risk policy, profile, capabilities,
//     tokens, evidence, schedule…): never a document. The one exception is a QA- ticket's own
//     deliverable, docs/team/journeys/<id>.json (qa-engineer writes them with the test plan).
//   - build/dependency manifests are never documents, wherever they sit (a .txt or .json name
//     does not make requirements.txt or package.json prose).
//   - under docs/ (not docs/team/): any file, except the board log and — when docs/ is a SERVED
//     SITE (G2-25: index.html, _config.yml or CNAME at its head) — anything but .md / .rst / .txt.
//   - outside docs/: .md / .rst only, and never for a QA- ticket (the fast path skips review, so it
//     gets docs/ prose only: CLAUDE.md or .claude/agents/*.md are instructions, not documents).
//   - .mdx is never a document: it is a JSX module.
// ponytail: an allow-shape, not a full map of every control file; widen it only with a reason.
const MANIFEST = /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-(lock|workspace)\.yaml|yarn\.lock|bun\.lockb?|CMakeLists\.txt|[^/]*\.cmake|Makefile|GNUmakefile|requirements[^/]*\.txt|constraints[^/]*\.txt|Pipfile(\.lock)?|pyproject\.toml|setup\.(py|cfg)|poetry\.lock|Gemfile(\.lock)?|Podfile(\.lock)?|[^/]*\.podspec|Cartfile(\.resolved)?|Package\.(swift|resolved)|[^/]*\.gradle(\.kts)?|gradle\.properties|gradle-wrapper\.properties|Cargo\.(toml|lock)|go\.(mod|sum)|Dockerfile|[^/]*\.csproj|Directory\.Build\.props)$/i;
const PROSE_ANYWHERE = /\.(md|rst)$/i;
const PROSE_IN_DOCS = /\.(md|rst|txt)$/i;
const QA_JOURNEY = /^docs\/team\/journeys\/[^/]+\.json$/;
export const docFile = (served, { qa = false } = {}) => (f) => {
  if (MANIFEST.test(f) || /\.mdx$/i.test(f)) return false;
  // C5G-5: macOS volumes fold case — `docs/Team/risk-policy.json` IS docs/team/risk-policy.json there.
  const lf = f.toLowerCase();
  if (lf.startsWith('docs/team/')) return qa && QA_JOURNEY.test(f);
  if (lf === BOARD_LOG) return false;
  if (f.startsWith('docs/')) return served ? PROSE_IN_DOCS.test(f) : true;
  return !qa && PROSE_ANYWHERE.test(f);
};
function docsIsServedSite(git, head) {
  const listed = git(['ls-tree', '--name-only', `${head}:docs`]);
  return Boolean(listed && listed.split('\n').some((f) => ['index.html', '_config.yml', 'CNAME'].includes(f)));
}

/**
 * C3G-4 / design B: does `head` change documents only? The file list is derived from
 * merge-base(INTEGRATION BRANCH, head) — never from a record's or caller's base, which could be
 * `head~1` and hide every code commit before it. `{ok, files, base}` or `{ok:false, code, reason}`.
 *   qa    the QA- fast path's stricter set (docFile above).
 *   base  C4G-G2: the merge-base the BOARD recorded at `merged` (never a caller's). Once the QA
 *         branch is fast-forwarded into the integration branch, merge-base(integration, tip) IS the
 *         tip and the branch "changes no files" — `closed` diffs the recorded base instead. It must
 *         still be an ancestor of `head`.
 */
export function docsOnlyDiff(git, head, { qa = false, base = '' } = {}) {
  const integration = integrationBase(git);
  if (!integration) return { ok: false, code: 2, reason: 'no integration branch (develop/main/master) exists, so what the branch changes — and whether it is documents only — is unknown' };
  if (base && !(base === head || isAncestor(git, base, head))) return { ok: false, code: 1, reason: `the merge-base recorded at merged (${String(base).slice(0, 12)}) is not an ancestor of ${String(head).slice(0, 12)}` };
  const mb = base || git(['merge-base', integration, head]);
  if (!mb) return { ok: false, code: 2, reason: `${String(head).slice(0, 12)} shares no history with ${integration}` };
  const files = (git(['diff', '--name-only', mb, head]) || '').split('\n').filter(Boolean);
  if (!files.length) return { ok: false, code: 1, reason: `the branch changes no files against ${base ? `the merge-base recorded at merged (${mb.slice(0, 12)})` : integration} (re-derived from git), so a --docs-only record verifies nothing` };
  const isDoc = docFile(docsIsServedSite(git, head), { qa });
  const code = files.filter((f) => !isDoc(f));
  if (code.length) return { ok: false, code: 1, reason: `the branch changes non-document files against ${integration} (re-derived from git): ${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''}${qa ? ' — on a QA- ticket only docs/ prose (outside docs/team/) and docs/team/journeys/*.json are documents' : ''}` };
  return { ok: true, files, base: mb };
}

/**
 * Is `head` the ticket's tip (or, unless `exact`, a descendant of it)? `{ok, reason, code}`.
 * G2-4: verify-done evidence must be EXACTLY the tip — a descendant scratch branch carrying extra
 * commits was accepted for `verified`. Descendants stay legal for a wave run and for QA's run on
 * the merged tree, where the ticket is, by construction, an ancestor of what ran.
 */
function boundToTicket(git, ticket, head, recordedBranch, { exact = false, root = '', mergedHead = '' } = {}) {
  const tip = ticketTip(git, ticket, root ? ticketIdsFromBoard(root) : []);
  if (tip.ambiguous.length) return { ok: false, code: 1, reason: `several branches are named for ${ticket} (${tip.ambiguous.join(', ')}) — the evidence cannot be bound to one. Delete the stale branch (one branch per ticket) and re-record` }; // C3W-9: exit 1, the fix is known
  if (tip.sha) {
    if (tip.sha === head || (!exact && isAncestor(git, tip.sha, head))) return { ok: true, tip: tip.sha };
    if (exact && isAncestor(git, tip.sha, head)) return { ok: false, reason: `the evidence ran on ${head.slice(0, 12)}, a DESCENDANT of ${ticket}'s tip ${tip.sha.slice(0, 12)} (${tip.branch}) carrying commits the ticket does not — \`verified\` is about exactly the tip. Re-run verify-done on ${tip.branch}.` };
    return { ok: false, reason: `the evidence ran on ${head.slice(0, 12)}, which does not contain ${ticket}'s branch tip ${tip.sha.slice(0, 12)} (${tip.branch}) — it is about older or different code. Re-run verify-done on the current tip.` };
  }
  // QA on the merged tree after the ticket's branch was deleted: the commit `merged` recorded
  // (C3G-8) must be in what ran.
  if (mergedHead && !exact && (mergedHead === head || isAncestor(git, mergedHead, head))) return { ok: true, tip: mergedHead };
  // No LOCAL branch named for the ticket: the record's own branch must be named for it (C3G-9 — a
  // remote-only ticket branch) and still be at the head it ran on. Any other branch's green is
  // evidence about other work, so a ticket with no branch named for it earns no test evidence.
  const shortName = String(recordedBranch || '').replace(/^refs\/(heads|remotes\/[^/]+)\//, '');
  if (!recordedBranch || !matchesTicket(shortName, ticket, root ? ticketIdsFromBoard(root) : [])) {
    return { ok: false, reason: `no branch is named for ${ticket}, and the evidence ran on ${recordedBranch || '(no branch)'}, which is not named for it either — ${ticket}'s work belongs on a branch named for it (feat/${ticket}-<slug>)` };
  }
  const now = recordedBranch ? git(['rev-parse', '--verify', `${recordedBranch}^{commit}`]) : null;
  if (now && now === head) return { ok: true, tip: head };
  return { ok: false, reason: `no branch is named for ${ticket}, and the evidence's branch ${recordedBranch || '(none)'} is now at ${now ? now.slice(0, 12) : 'nothing'}, not the ${head.slice(0, 12)} it ran on` };
}

/**
 * Re-derive a test-evidence/v1 record for `ticket`. `afterTs` (qa_passed) requires the run to have
 * happened after that moment (the merge). Returns `{ok, detail}` or `{ok:false, code, reason}`.
 */
export function verifyTestEvidence(root, given, { ticket, afterTs = '', cwd = process.cwd(), allowStatic = false, staticOnly = false, exactHead = '', mergedHead = '' } = {}) {
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
  const bound = boundToTicket(git, ticket, rec.head, rec.branch, { exact, root, mergedHead });
  if (!bound.ok) return fail(bound.reason, bound.code || 1);
  if (exactHead && rec.head !== exactHead) return fail(`ran on ${String(rec.head).slice(0, 12)}, not the commit being approved (${exactHead.slice(0, 12)})`);
  if (afterTs && !(Date.parse(rec.at) > Date.parse(afterTs))) return fail(`was recorded at ${rec.at}, before ${ticket} merged (${afterTs}) — QA evidence is a run on the MERGED tree, not the developer's pre-review run`);

  if (rec.mode === 'tests') {
    const log = readLog(root, rec);
    if (!log.ok) return fail(log.reason);
    const again = classifyTestRun(Number(rec.exit_code), log.text);
    if (again.verdict !== rec.verdict) return fail(`says "${rec.verdict}" but re-classifying its own log gives "${again.verdict}"${again.why ? ` (${again.why})` : ''} — the recorded verdict is not the one its log supports`);
    if (again.verdict !== 'green') return fail(`the suite did not run green (${again.verdict}${again.why ? `: ${again.why}` : ''})`);
    // G2-3 / C3G-3: the command must be one the board FROZE from the profile (commandAccepted). A
    // profile that declares none cannot verify a code ticket at all.
    const cmdOk = commandAccepted(root, rec);
    if (!cmdOk.ok) return fail(cmdOk.reason, cmdOk.code);
    if (rec.dirty === true) return fail('the suite ran on a working tree with uncommitted changes to tracked files — it tested code that is not the commit. Commit or discard, then re-run.');
    // G2-22: a changed suite whose tests assert nothing is not evidence the code works.
    if (rec.assertion_census?.assert_nothing) {
      return fail(`the changed test files declare ${rec.assertion_census.tests} test(s) and ZERO assertions (${(rec.assertion_census.files || []).join(', ')}) — a suite that asserts nothing passes whatever the code does.`);
    }
  } else if (rec.mode === 'docs-only') {
    if (afterTs) return fail('is a --docs-only record; QA needs a run of the suite or a journey-gate result');
    const d = docsOnlyDiff(git, rec.head, { qa: /^QA-/i.test(String(ticket)) });
    if (!d.ok) return fail(`is --docs-only, but ${d.reason} — run the tests`, d.code);
  } else if (!((allowStatic || staticOnly) && rec.mode === 'static')) {
    return fail(`has mode ${JSON.stringify(rec.mode)}; only "tests" and "docs-only" earn verified (a "static" record is what verified_static cites)`);
  }
  if (staticOnly && rec.mode !== 'static') return fail(`has mode ${JSON.stringify(rec.mode)}; \`verified_static\` cites the --static record verify-done printed`);
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
export function verifyQaEvidence(root, given, { ticket, mergedTs, mergedHead = '', cwd = process.cwd() } = {}) {
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
  return verifyTestEvidence(root, given, { ticket, afterTs: mergedTs || '1970-01-01T00:00:00Z', mergedHead, cwd });
}

const DRIVERS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'drivers');
function journeyDriverProblem(root, v) {
  const d = v.driver || {};
  const m = /^scripts\/drivers\/([A-Za-z0-9._-]+)$/.exec(String(d.path || ''));
  if (!m) return `names no plugin driver (driver ${JSON.stringify(d.path ?? null)}) — only scripts/drivers/* produce a journey verdict the board accepts`;
  const file = resolve(DRIVERS_DIR, m[1]);
  if (!existsSync(file) || sha256(readFileSync(file)) !== d.sha256) return `its driver ${d.path} is not the plugin's current ${m[1]} (sha256 differs or the file is gone)`;
  const log = readFileSync(resolve(root, String(v.log)), 'utf8');
  const lines = [...log.matchAll(/^GATE-DRIVER: (\S+) (\S+)$/gm)];
  const last = lines[lines.length - 1];
  if (!last || last[1] !== d.path || last[2] !== d.sha256) return 'its raw log does not name the driver the result claims';
  return '';
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
  // Design F: the verdict came from one of THIS plugin's drivers, byte for byte — named in the
  // result, named again in the raw log (which the sha pins), and still the file shipped beside us.
  const drv = journeyDriverProblem(root, v);
  if (drv) return fail(drv);
  const git = gitAt(cwd);
  const tip = ticketTip(git, ticket, ticketIdsFromBoard(root));
  const head = String(v.subject.head);
  if (tip.ambiguous.length) return fail(`several branches are named for ${ticket} (${tip.ambiguous.join(', ')}) — delete the stale one`, 1);
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
  // C3G-7 / design E: THE SUITE RUNS IN A FRESH DETACHED WORKTREE OF EXACTLY `head`, never in the
  // developer's tree. skip-worktree / assume-unchanged bits, .git/info/exclude'd and untracked
  // planted files live in one worktree's index or directory; a tree made for this run has none of
  // them. `dir` is no longer consulted. Cost: a cold tree — build-env.sh pins the caches outside it.
  const at = mkdtempSync(resolve(tmpdir(), 'studio-run-'));
  rmSync(at, { recursive: true, force: true });
  if (git(['worktree', 'add', '--detach', '--quiet', at, head]) === null) return { ok: false, reason: `could not create a detached worktree of ${head} to run the suite in` };
  const inDir = gitAt(at);
  let run;
  let dirty;
  try {
    run = spawnSync('sh', ['-c', cmd], { cwd: at, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    // HEAD moving or tracked files changing under the run still voids it (the suite edited its tree).
    dirty = inDir(['rev-parse', 'HEAD']) !== head || indexHides(at) || Boolean(inDir(['status', '--porcelain', '--untracked-files=no']));
  } finally {
    git(['worktree', 'remove', '--force', at]);
    git(['worktree', 'prune']);
    rmSync(at, { recursive: true, force: true });
  }
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
//   evidence.mjs check-command --record R    exit 0 when the board would accept the record's command
//   evidence.mjs ticket-for --branch B       the board ticket B is named for (longest id), or nothing
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
  } else if (cmd === 'check-command') {
    // FB3: would the board accept this record's command? verify-done asks before it prints VERIFIED.
    const root = evidenceRoot();
    let rec = null;
    try { rec = JSON.parse(readFileSync(resolve(root, f.record || ''), 'utf8')); } catch { bye(2, `no readable record at ${f.record}`); }
    const r = commandAccepted(root, rec);
    if (!r.ok) bye(r.code, r.reason);
  } else if (cmd === 'ticket-for') {
    // C3G-9 / FB5: the board ticket a branch is named for — the LONGEST matching board id, spelled
    // as the board spells it. Nothing when no board id matches.
    const ids = ticketIdsFromBoard(evidenceRoot());
    // matchesTicket already gives the name to the longest board id, so at most one id matches.
    const hit = ids.filter((id) => matchesTicket(String(f.branch || '').replace(/^refs\/(heads|remotes\/[^/]+)\//, ''), id, ids))[0];
    process.stdout.write(hit || '');
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
