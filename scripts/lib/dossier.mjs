/**
 * release-candidate/v1 — the artifact you upload, bound to the commit that passed the gates.
 *
 * THE HOLE THIS CLOSES. Readiness is computed about a COMMIT: gates record `subject.head`, and the
 * reducer marks a gate STALE when that head is not the current one. Nothing anywhere records the
 * BINARY. So the chain of custody ends exactly where it starts mattering — you can build an .ipa
 * from one commit, pass every gate on another, and upload the first, and no mechanism in this
 * studio notices. "Readiness: PASS" is a true statement about source and says nothing at all about
 * the file a human is about to hand to Apple.
 *
 * This is R1 in the recurrence table — "no release-candidate aggregate; /app-ship is a bag of gates,
 * not a submission pipeline" — which appeared in 4 of 6 dry runs, scored 4/10 twice, and is the
 * only dimension that never moved. It never moved because every previous pass added another gate,
 * and the missing thing was never a gate: it is the SUBJECT the gates are about.
 *
 * WHAT A RECORD BINDS TOGETHER, and why each field is here rather than assumed:
 *
 *   commit + dirty     the source. `dirty` is recorded, never normalised away: an artifact built
 *                      from an uncommitted tree is not reproducible from the commit it names, and
 *                      that is a fact about the release, not a lint warning.
 *   artifact + sha256  the actual file. The hash is what makes the binding checkable later — a
 *                      path alone is a pointer to whatever happens to be there now.
 *   size               cheap corroboration; a truncated upload has the same path and a new hash,
 *                      but a size that is obviously wrong is the faster tell for a human.
 *   toolchain          what built it. Recorded as null-and-stated when it cannot be determined,
 *                      never omitted — "we did not ask" and "there was none" are different facts.
 *   built_at / by      provenance. An artifact nobody claims is an artifact nobody can be asked
 *                      about.
 *
 * APPEND-ONLY AND HASH-CHAINED, like every other ledger here. A dossier that can be edited after
 * the fact is a dossier that proves nothing; the point of recording the binding is that a later
 * disagreement can be settled, and that requires the record to be older than the argument.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not build anything, it does not upload anything, and
 * it does not decide whether to ship. `I-12` (no executable path can submit or publish) holds
 * unchanged — this only records what was built so a human deciding to submit can see what they are
 * submitting.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export const DOSSIER_PATH = 'docs/team/release-candidates.jsonl';

/**
 * Read and chain-verify the dossier.
 *
 * A broken chain is CANNOT EVALUATE, never "no records": silently treating a corrupt ledger as an
 * empty one turns tampering into a clean slate, which is the most useful possible outcome for
 * whoever tampered.
 */
export function readDossier(path) {
  if (!existsSync(path)) return { ok: true, records: [] };
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const records = [];
  let previous = '';
  for (const [i, line] of lines.entries()) {
    let r;
    try { r = JSON.parse(line); } catch { return { ok: false, reason: `malformed record at line ${i + 1}` }; }
    const expected = createHash('sha256').update(`${previous}\n${JSON.stringify({ ...r, hash: undefined })}`).digest('hex');
    if (r.prev_hash !== previous || r.hash !== expected) {
      return { ok: false, reason: `release-candidate chain broken at line ${i + 1} — this ledger has been rewritten` };
    }
    previous = r.hash;
    records.push(r);
  }
  return { ok: true, records };
}

/** Hash a file in one read. Artifacts are tens of megabytes, not gigabytes; streaming buys nothing. */
export function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * The readiness view of the latest candidate: does the artifact on disk still match what was
 * recorded, and was it recorded for THIS commit?
 *
 * Returns the same shape `lib/readiness.mjs` uses for every other gate, so it folds into the one
 * reducer rather than becoming a second opinion beside it.
 *
 * EVERY BRANCH THAT IS NOT A DEMONSTRATED MATCH IS STALE OR CANNOT_EVALUATE, NEVER PASS. The whole
 * value of this file is that it refuses to let "we have an artifact" stand in for "this artifact is
 * the one that passed".
 */
export function artifactEntry(root, head) {
  const gate = 'artifact';
  const path = resolve(root, DOSSIER_PATH);
  const read = readDossier(path);
  if (!read.ok) return { gate, state: 'CANNOT_EVALUATE', detail: read.reason, subject: null };
  if (!read.records.length) {
    return {
      gate,
      state: 'CANNOT_EVALUATE',
      detail: `no ${DOSSIER_PATH} — no build artifact has been recorded, so what would be uploaded is UNKNOWN`,
      subject: null,
    };
  }

  const rc = read.records.at(-1);
  const recorded = rc.commit || null;

  if (rc.dirty === true) {
    return {
      gate,
      state: 'STALE',
      detail: `artifact was built from a DIRTY tree at ${recorded ? recorded.slice(0, 12) : 'an unknown commit'} — it cannot be reproduced from any commit`,
      subject: recorded,
    };
  }
  if (!recorded) {
    return { gate, state: 'STALE', detail: 'the recorded artifact names no commit, so nothing ties it to reviewed source', subject: null };
  }
  if (head && recorded !== head) {
    return {
      gate,
      state: 'STALE',
      detail: `artifact was built from ${recorded.slice(0, 12)}, candidate is ${head.slice(0, 12)} — the gates and the binary are about different source`,
      subject: recorded,
    };
  }

  const artifactPath = resolve(root, rc.artifact || '');
  if (!rc.artifact || !existsSync(artifactPath)) {
    return {
      gate,
      state: 'CANNOT_EVALUATE',
      detail: `the recorded artifact is not at ${rc.artifact || '(no path)'} — it cannot be re-hashed, so the binding is unverifiable`,
      subject: recorded,
    };
  }
  const now = hashFile(artifactPath);
  if (now !== rc.sha256) {
    return {
      gate,
      state: 'BLOCKED',
      detail: `${rc.artifact} no longer hashes to what was recorded (${rc.sha256.slice(0, 12)} -> ${now.slice(0, 12)}) — the file changed after it was bound`,
      subject: recorded,
    };
  }
  const size = statSync(artifactPath).size;
  return {
    gate,
    state: 'PASS',
    detail: `${rc.artifact} (${rc.platform || 'platform unstated'}/${rc.variant || 'variant unstated'}, ${size} bytes) matches its recorded hash and its commit`,
    subject: recorded,
  };
}
