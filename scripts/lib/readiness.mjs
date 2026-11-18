/**
 * ONE readiness reducer. Every surface projects it; none recomputes it.
 *
 * WHY. `/app-status`, `studio-dashboard.mjs` and `control-room/` each assembled their own picture
 * of "where is this release". Three readers of the same files, three sets of judgement calls about
 * what counts as blocked, and no rule anywhere saying they must agree. The audit's phrasing: the
 * control room is not the authoritative operational picture. A founder reading the dashboard and an
 * agent reading the CLI could act on different beliefs, both sincerely, with nothing to reconcile
 * them — and the disagreement surfaces at exactly the moment it is most expensive.
 *
 * THE FIVE STATES ARE DELIBERATE, AND STALE IS THE ONE THAT MATTERS MOST:
 *
 *   PASS             the gate ran against THIS candidate and held
 *   BLOCKED          the gate ran and did not hold
 *   CANNOT_EVALUATE  the gate could not run (no driver, no toolchain, no declaration)
 *   NOT_APPLICABLE   the gate has nothing to say about this project
 *   STALE            the gate ran, but against a different candidate or different evidence
 *   WAIVED           the gate ran on THIS candidate, could not evaluate, and a valid versioned
 *                    `WAIVED:` line in docs/60-releases.md records a human proceeding anyway (C5W-1)
 *
 * STALE is not PASS (the claim is no longer supported) and not BLOCKED (nothing was shown broken).
 * Collapsing it into PASS is how a release goes out on last Tuesday's evidence; collapsing it into
 * BLOCKED sends a team hunting a defect that does not exist. Both were possible before this file.
 *
 * A BLOCKING GATE ALWAYS BEATS A SCORE. Confidence numbers may be displayed; they never decide.
 * That property was already proven once (a 95% score with an open S1 still showing BLOCKED) and it
 * is preserved here structurally: `verdict` is derived from the gate states alone.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { artifactEntry } from './dossier.mjs';
import { checkGateLog } from './evidence.mjs';

/** The candidate every verdict below is about. A readiness answer with no subject is about nothing. */
function candidate(root) {
  const git = (args) => {
    try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return ''; }
  };
  const head = git(['rev-parse', 'HEAD']);
  return {
    head: head || null,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) || null,
    // `dirty` is null, not false, when git could not answer. "We could not tell" and "it is clean"
    // are different facts, and only one of them justifies a release.
    dirty: head ? treeDirty(root) : null,
  };
}

/**
 * Is the working tree dirty, NOT counting the studio's own operational files (the board log,
 * docs/team/, reviews, worktrees: lib/operational-paths.txt — the same list runtime-gate.sh and
 * ship-gate.sh read)? Counting them made every honest gate result STALE (W3 / G-F6). A git error
 * is dirty, never clean.
 *
 * FB6, decided: an UNTRACKED file outside the operational paths IS a dirty tree — a stray verdict or
 * scratch file at the root is state the commit does not contain, and the gate cannot know it is
 * harmless. Put scratch under docs/team/ (operational) or delete it.
 * C3G-7: an index entry marked skip-worktree or assume-unchanged (`git ls-files -v`: tag `S`, or a
 * lowercase tag) hides edits from `git status`, so it counts as dirty too.
 * BOUND: a file ignored by .gitignore or .git/info/exclude is invisible here. Test evidence is immune
 * (it runs in a fresh worktree of the commit); a journey/runtime gate run in the developer's tree is not.
 */
export function indexHides(root) {
  try {
    return execFileSync('git', ['ls-files', '-v'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').some((l) => /^(S|[a-z]) /.test(l));
  } catch { return true; }
}
export function treeDirty(root) {
  const excludes = readFileSync(new URL('./operational-paths.txt', import.meta.url), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((p) => `:(exclude)${p}`);
  try {
    return indexHides(root)
      || execFileSync('git', ['status', '--porcelain', '--', ':(top)', ...excludes], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
  } catch { return true; }
}

/**
 * C5W-1: the waiver for a CANNOT_EVALUATE gate, read by lib/waiver.sh — the SAME parser ship-gate.sh
 * uses (artifact, who, reason, and the canonical version once one exists), never a second one.
 * Returns "<who> — <reason>" or null. Only `journey gate` / `runtime gate` (optionally `(<platform>)`).
 */
const WAIVABLE = { journey: ['journey gate'], runtime: ['runtime gate', 'runtime gate (ios)', 'runtime gate (android)', 'runtime gate (web)'] };
function waiverFor(root, name) {
  for (const artifact of WAIVABLE[name] || []) {
    try {
      return `${artifact}: ${execFileSync('sh', [fileURLToPath(new URL('./waiver.sh', import.meta.url)), resolve(root, 'docs/60-releases.md'), artifact],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()}`;
    } catch { /* exit 1: no valid waiver for this spelling */ }
  }
  return null;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * Fold one gate-result/v1 file into a readiness entry, applying the staleness rule.
 *
 * The staleness comparison lives HERE rather than in each gate, because a gate cannot know it has
 * gone stale — it stopped running before the thing that invalidated it happened.
 */
function gateEntry(root, name, relPath, cand, gateName) {
  const abs = resolve(root, relPath);
  if (!existsSync(abs)) {
    return { gate: name, state: 'CANNOT_EVALUATE', detail: `no ${relPath} — this gate has not run for this project`, subject: null };
  }
  const v = readJson(abs);
  if (!v || v.schema !== 'gate-result/v1') {
    return { gate: name, state: 'CANNOT_EVALUATE', detail: `${relPath} is not a readable gate-result/v1`, subject: null };
  }
  const recorded = v.subject?.head || null;
  // G2-11: the file must be the gate it is filed as — a journey result copied over runtime-result.json
  // is not a runtime verdict.
  if (v.gate !== gateName) {
    return { gate: name, state: 'CANNOT_EVALUATE', detail: `${relPath} names gate '${v.gate}', expected '${gateName}'`, subject: recorded };
  }
  // Only `dirty === false` is clean. `null` means git could not say, and "could not tell" never
  // supports a release (G2-11).
  if (v.subject?.dirty !== false) {
    return { gate: name, state: 'STALE', detail: v.subject?.dirty === true ? 'recorded against a dirty working tree, so the state it examined was never committed' : 'does not record that the working tree was clean', subject: recorded };
  }
  if (recorded && cand.head && recorded !== cand.head) {
    return { gate: name, state: 'STALE', detail: `recorded for ${recorded.slice(0, 12)}, candidate is ${cand.head.slice(0, 12)}`, subject: recorded };
  }
  if (!recorded) {
    return { gate: name, state: 'STALE', detail: 'names no subject commit, so it cannot be shown to describe this candidate', subject: null };
  }
  // G-F6: WELL-FORMED JSON IS NOT A VERDICT. A result must point at the raw log it was derived
  // from, the log must still hash to the recorded sha256, and its own RESULT / GATE-SUBJECT lines
  // must agree with the file. A hand-written gate-result has no such log, so it can never PASS
  // here — it is CANNOT_EVALUATE, the state for "no gate actually ran that we can show".
  const derived = checkGateLog(root, v);
  if (!derived.ok) {
    return { gate: name, state: 'CANNOT_EVALUATE', detail: `${relPath} does not re-derive: ${derived.reason}`, subject: recorded };
  }
  const state = v.result === 'PASS' ? 'PASS' : v.result === 'FAIL' ? 'BLOCKED' : 'CANNOT_EVALUATE';
  // C5W-1: a waiver covers only "this candidate's gate ran and could not evaluate" — never a FAIL
  // (app-ship: no waiver for a product that does not work), a STALE result, or a gate that never ran.
  const waived = state === 'CANNOT_EVALUATE' ? waiverFor(root, name) : null;
  if (waived) return { gate: name, state: 'WAIVED', detail: `WAIVED: ${waived} (docs/60-releases.md; trace.mjs --only gates checks the founder record)`, subject: recorded };
  return { gate: name, state, detail: v.detail || '', subject: recorded };
}

/**
 * The canonical readiness state for a project.
 *
 * Returns a plain object with no formatting decisions in it, so a CLI, an HTTP endpoint and a React
 * view can all render the SAME values without any of them being tempted to recompute a verdict.
 */
function reduceReadiness(root) {
  const cand = candidate(root);
  const gates = [
    gateEntry(root, 'journey', 'docs/team/journey-result.json', cand, 'journey-gate'),
    gateEntry(root, 'runtime', 'docs/team/runtime-result.json', cand, 'runtime-gate'),
    // THE ARTIFACT IS A GATE, NOT A FOOTNOTE. Every gate above is about a COMMIT; this one is about
    // the file that would actually be uploaded. Without it, "readiness: PASS" is a true statement
    // about source and silent about the binary — so an .ipa built from a different commit than the
    // one that passed could ship with nothing noticing. It folds in HERE, through the same
    // precedence as everything else, rather than being reported beside the verdict: a fact that
    // does not participate in the verdict is a fact nobody has to act on.
    artifactEntry(root, cand.head),
  ];

  // Precedence is explicit and ordered, so every surface reaches the same verdict from the same
  // inputs. BLOCKED outranks STALE outranks CANNOT_EVALUATE: the worst honest answer wins, and
  // "not ready" is never softened by an adjacent green. WAIVED does not block (C5W-1) — it is
  // printed on its own line by every surface, so a waived gate never reads as a passed one.
  const has = (s) => gates.some((g) => g.state === s);
  let verdict = has('BLOCKED') ? 'BLOCKED'
    : has('STALE') ? 'STALE'
      : has('CANNOT_EVALUATE') ? 'CANNOT_EVALUATE'
        : gates.length ? 'PASS' : 'CANNOT_EVALUATE';
  // G2-11: the candidate itself has uncommitted (non-operational) changes, or git could not say.
  // Every gate above examined the commit, not this tree — so PASS would describe a different thing.
  if (verdict === 'PASS' && cand.dirty !== false) verdict = 'STALE';

  return {
    schema: 'readiness/v1',
    candidate: cand,
    gates,
    verdict,
    // Stated, not implied. Anything reading this is told in words that the verdict is about a
    // specific commit — so a screenshot of a green dashboard cannot be waved at a different one.
    about: cand.head ? `candidate ${cand.head.slice(0, 12)}${cand.dirty ? ' (WORKING TREE DIRTY)' : ''}` : 'no candidate — not a git repository',
  };
}

export { reduceReadiness };
