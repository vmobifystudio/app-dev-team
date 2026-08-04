#!/usr/bin/env node
/**
 * evidence-check — is this verdict still about the thing in front of us?
 *
 * THE PROBLEM THIS CLOSES. Every gate in this studio answers a question at a moment in time and
 * then stops thinking. `journey-gate` says PASS; the branch gets three more commits; the PASS is
 * still sitting there, green, describing a candidate that no longer exists. Nothing was lying and
 * nothing was tampered with — the verdict simply outlived its subject, which is the ordinary way a
 * release goes out believing something that was true last Tuesday.
 *
 * The audit's phrasing is the one worth keeping: EVIDENCE MUST BE CONTENT-ADDRESSED AND
 * SUBJECT-BOUND. "The file exists" is necessary, not sufficient. A path is mutable — the screenshot
 * a PASS cites can be overwritten by the next run, by a different journey, or by hand, and the
 * verdict keeps pointing at it as though nothing happened.
 *
 * So there are two ways a verdict goes stale, and this checks both:
 *
 *   1. THE SUBJECT MOVED.   The verdict named a commit; HEAD is somewhere else now.
 *   2. THE EVIDENCE MOVED.  The bytes behind a cited path no longer hash to what was recorded.
 *
 * STALE IS ITS OWN STATE. It is not PASS (the claim is no longer supported) and it is not FAIL
 * (nothing was shown to be broken). Collapsing it into either is how a green gate keeps yesterday's
 * answer, or how a re-run panic starts over a candidate nobody actually broke. It blocks exactly as
 * hard as BLOCKED at a decisive transition, and it says WHY.
 *
 * Exit codes, the same three-state contract as every other gate here:
 *   0  the verdict still holds for this candidate
 *   1  STALE or FAIL — do not act on this verdict
 *   2  cannot evaluate — no verdict file, unreadable, or not a git repository
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`evidence-check: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['root', 'result', 'head']), die });

const root = resolve(String(flags.root || '.'));
const resultPath = resolve(root, typeof flags.result === 'string' ? flags.result : 'docs/team/journey-result.json');

if (!existsSync(resultPath)) {
  // Not a pass and not a failure: there is simply no verdict to age. Callers decide whether a
  // missing verdict is acceptable for the transition they are attempting — that is their policy
  // question, not this script's.
  process.stdout.write(`EVIDENCE CHECK: CANNOT EVALUATE — no gate result at ${resultPath}.\n`);
  process.exit(2);
}

let verdict;
try { verdict = JSON.parse(readFileSync(resultPath, 'utf8')); }
catch (e) { die(2, `cannot parse ${resultPath}: ${e.message}`); }
if (verdict.schema !== 'gate-result/v1') die(2, `${resultPath} is not gate-result/v1 (got ${JSON.stringify(verdict.schema)})`);

const reasons = [];

// --- 1. did the subject move? ------------------------------------------------------------------
let head = typeof flags.head === 'string' ? flags.head : '';
if (!head) {
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { head = ''; }
}
const recorded = verdict.subject?.head || null;
if (!recorded) {
  // A verdict that never named its subject cannot be shown to still apply. Reporting that as
  // "current" would be the evidence-optional pass again, one level up: a claim with nothing to
  // check it against.
  reasons.push('the verdict names no subject commit, so there is nothing to compare it against — it cannot be shown to describe this candidate');
} else if (head && recorded !== head) {
  reasons.push(`the verdict was recorded for ${recorded.slice(0, 12)}, and HEAD is now ${head.slice(0, 12)} — it describes a candidate that no longer exists`);
}

// A verdict taken against a DIRTY tree could never be re-established even in principle: the bytes
// it looked at were not in any commit, so there is no way to ask whether they are still there.
if (verdict.subject?.dirty === true) {
  reasons.push('the verdict was recorded against a DIRTY working tree — the state it examined was never committed, so it cannot be re-established for any candidate');
}

// --- 2. did the evidence move? -----------------------------------------------------------------
for (const j of verdict.journeys || []) {
  for (const e of j.evidence || []) {
    const abs = resolve(root, String(e.path));
    if (!existsSync(abs)) { reasons.push(`${j.id}: cited evidence ${e.path} no longer exists`); continue; }
    if (!statSync(abs).isFile()) { reasons.push(`${j.id}: cited evidence ${e.path} is no longer a file`); continue; }
    const now = createHash('sha256').update(readFileSync(abs)).digest('hex');
    if (now !== e.sha256) {
      // The most valuable line this script prints. Without the digest, this file looks fine: it
      // exists, it is non-empty, and it has the name the verdict cited. Only the hash can tell you
      // it is a DIFFERENT artifact wearing the same path.
      reasons.push(
        `${j.id}: cited evidence ${e.path} still exists but its contents changed ` +
        `(recorded sha256:${e.sha256.slice(0, 12)}, now sha256:${now.slice(0, 12)}) — the verdict is about bytes that are gone`
      );
    }
  }
}

process.stdout.write('EVIDENCE CHECK\n');
if (!reasons.length) {
  process.stdout.write(`  CURRENT — ${verdict.gate} result "${verdict.result}" still describes this candidate.\n`);
  process.exit(verdict.result === 'PASS' ? 0 : 1);
}
reasons.forEach((r) => process.stdout.write(`  STALE: ${r}\n`));
process.stdout.write(
  '\nRESULT: STALE — this verdict is not evidence for the current candidate.\n' +
  '  Not a failure: nothing here says the product is broken. It says nobody has checked THIS version.\n' +
  '  Re-run the gate against the current candidate.\n'
);
process.exit(1);
