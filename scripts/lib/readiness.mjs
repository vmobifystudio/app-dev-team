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

import { artifactEntry } from './dossier.mjs';

/** The candidate every verdict below is about. A readiness answer with no subject is about nothing. */
function candidate(root) {
  const git = (args) => {
    try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return ''; }
  };
  const head = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']);
  return {
    head: head || null,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) || null,
    // `dirty` is null, not false, when git could not answer. "We could not tell" and "it is clean"
    // are different facts, and only one of them justifies a release.
    dirty: head ? status.length > 0 : null,
  };
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
function gateEntry(root, name, relPath, cand) {
  const abs = resolve(root, relPath);
  if (!existsSync(abs)) {
    return { gate: name, state: 'CANNOT_EVALUATE', detail: `no ${relPath} — this gate has not run for this project`, subject: null };
  }
  const v = readJson(abs);
  if (!v || v.schema !== 'gate-result/v1') {
    return { gate: name, state: 'CANNOT_EVALUATE', detail: `${relPath} is not a readable gate-result/v1`, subject: null };
  }
  const recorded = v.subject?.head || null;
  if (v.subject?.dirty === true) {
    return { gate: name, state: 'STALE', detail: 'recorded against a dirty working tree, so the state it examined was never committed', subject: recorded };
  }
  if (recorded && cand.head && recorded !== cand.head) {
    return { gate: name, state: 'STALE', detail: `recorded for ${recorded.slice(0, 12)}, candidate is ${cand.head.slice(0, 12)}`, subject: recorded };
  }
  if (!recorded) {
    return { gate: name, state: 'STALE', detail: 'names no subject commit, so it cannot be shown to describe this candidate', subject: null };
  }
  const state = v.result === 'PASS' ? 'PASS' : v.result === 'FAIL' ? 'BLOCKED' : 'CANNOT_EVALUATE';
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
    gateEntry(root, 'journey', 'docs/team/journey-result.json', cand),
    gateEntry(root, 'runtime', 'docs/team/runtime-result.json', cand),
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
  // "not ready" is never softened by an adjacent green.
  const has = (s) => gates.some((g) => g.state === s);
  const verdict = has('BLOCKED') ? 'BLOCKED'
    : has('STALE') ? 'STALE'
      : has('CANNOT_EVALUATE') ? 'CANNOT_EVALUATE'
        : gates.length ? 'PASS' : 'CANNOT_EVALUATE';

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
