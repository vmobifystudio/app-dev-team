#!/usr/bin/env node
/**
 * release-candidate — record the artifact you are about to ship, bound to the commit that passed.
 *
 * See scripts/lib/dossier.mjs for why this exists. In one line: readiness was a claim about a
 * COMMIT, and nothing anywhere recorded the BINARY, so the chain of custody ended exactly where it
 * starts mattering.
 *
 * Usage:
 *   release-candidate.mjs record --artifact <path> [--platform ios|android|web] [--variant release]
 *                                [--by <role>] [--root <dir>]
 *   release-candidate.mjs show [--json]
 *   release-candidate.mjs verify
 *
 * Exit codes, the studio's three-state contract:
 *   0  recorded / the binding holds
 *   1  refused, or the binding is broken
 *   2  cannot evaluate — no record, no artifact to hash, unreadable ledger
 *
 * WEB (W11): a web release has no single binary — the artifact is the build OUTPUT DIRECTORY
 * (`--artifact dist --platform web`), hashed over every file inside it (lib/artifact-hash.mjs), so
 * one edited asset after binding breaks `verify` exactly as a re-signed .ipa would.
 *
 * THIS COMMAND NEVER BUILDS AND NEVER UPLOADS. It records what a build produced. I-12 (no
 * executable path can submit or publish to a store) is unchanged by it.
 */
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { treeDirty } from './lib/readiness.mjs';
import { withFileLock } from './lib/atomic.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { DOSSIER_PATH, readDossier } from './lib/dossier.mjs';
import { artifactSize, hashArtifact } from './lib/artifact-hash.mjs';

const die = (code, message) => { process.stderr.write(`release-candidate: ${message}\n`); process.exit(code); };

const VALUE_FLAGS = new Set(['artifact', 'platform', 'variant', 'by', 'root', 'ledger', 'project-root']);
const { flags, positional } = parseArgs(process.argv.slice(2), { valueFlags: VALUE_FLAGS, die });
const [command] = positional;

// `resolveProjectRoot` returns {ok, root, via} — it does not throw and does not return a bare
// string. The first version here assumed a string and a throw, so `resolve()` got an object and
// every invocation died with a TypeError before reaching any of its own logic. I-01 exists because
// this repo kept resolving the project root five different ways; using the shared resolver but
// guessing its contract is the same defect with an extra step.
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
const LEDGER = typeof flags.ledger === 'string' ? resolve(flags.ledger) : resolve(ROOT, DOSSIER_PATH);

const git = (args) => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
};

/**
 * What built this, as far as we can tell.
 *
 * ASKED, NOT ASSUMED, and null when unanswerable. A toolchain field that quietly reads "unknown"
 * as "fine" is how a release gets attributed to a compiler nobody had. The three-state discipline
 * applies to provenance exactly as it applies to gates: not knowing is its own answer, and it is
 * recorded as one.
 */
function toolchain(platform) {
  const probe = (cmd, args) => {
    try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]; }
    catch { return null; }
  };
  if (platform === 'ios') return probe('xcodebuild', ['-version']);
  if (platform === 'android') return probe('./gradlew', ['--version']) || probe('gradle', ['--version']);
  if (platform === 'web') { const n = probe('node', ['--version']); const m = probe('npm', ['--version']); return n && m ? `node ${n} / npm ${m}` : null; }
  return null;
}

function cmdRecord() {
  if (typeof flags.artifact !== 'string' || !flags.artifact) {
    die(1, 'record needs --artifact <path to the built .ipa/.apk/.aab, or a web build output dir>\n' +
           '  The path is the point: a release candidate with no artifact is a claim about source,\n' +
           '  which is what readiness already tells you.');
  }
  const artifactPath = resolve(ROOT, flags.artifact);
  // CANNOT EVALUATE, not refused: the caller pointed at something that is not there, and the fix is
  // to build it or fix the path — a different action from "this candidate is not acceptable".
  if (!existsSync(artifactPath)) die(2, `no artifact at ${flags.artifact} — nothing to hash, so nothing can be bound`);
  const platform = typeof flags.platform === 'string' ? flags.platform : null;
  // A directory is an artifact only for web, where the build output dir IS what ships. A directory
  // passed for ios/android is a wrong path (the .app folder, not the .ipa), so it stays refused.
  const isDir = statSync(artifactPath).isDirectory();
  if (isDir && platform !== 'web') die(2, `${flags.artifact} is a directory — only --platform web ships a build output dir; ios/android bind the .ipa/.aab/.apk file`);
  if (!isDir && !statSync(artifactPath).isFile()) die(2, `${flags.artifact} is not a file`);
  if (isDir && artifactSize(artifactPath) === 0) die(2, `${flags.artifact} is empty — a web build that produced no files is nothing to bind`);

  const head = git(['rev-parse', 'HEAD']);
  if (!head) die(2, 'cannot resolve HEAD — a candidate that names no commit binds nothing');

  const record = {
    schema: 'release-candidate/v1',
    ts: new Date().toISOString(),
    commit: head,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) || null,
    // Recorded, never normalised away. An artifact built from an uncommitted tree cannot be
    // reproduced from the commit it names, and readiness reads this as STALE rather than PASS.
    dirty: treeDirty(ROOT), // studio operational files are not dirt (lib/operational-paths.txt)
    // Stored relative to the project root so the record survives being read from another checkout.
    artifact: relative(ROOT, artifactPath) || flags.artifact,
    sha256: hashArtifact(artifactPath),
    size: artifactSize(artifactPath),
    kind: isDir ? 'directory' : 'file',
    platform,
    variant: typeof flags.variant === 'string' ? flags.variant : null,
    toolchain: toolchain(platform),
    by: typeof flags.by === 'string' ? flags.by : null,
  };

  // Serialized and chained exactly like the board, the run ledger and the incident ledger. The read
  // of the previous tip and the append are ONE operation; two writers reading the same tip is how a
  // hash chain forks, which is the defect lib/atomic.mjs exists to make unrepresentable.
  withFileLock(LEDGER, () => {
    const read = readDossier(LEDGER);
    if (!read.ok) die(2, read.reason);
    const previous = read.records.at(-1)?.hash || '';
    const r = { ...record, prev_hash: previous };
    r.hash = createHash('sha256').update(`${previous}\n${JSON.stringify({ ...r, hash: undefined })}`).digest('hex');
    mkdirSync(dirname(LEDGER), { recursive: true });
    appendFileSync(LEDGER, `${JSON.stringify(r)}\n`);
    process.stdout.write(
      `RELEASE CANDIDATE recorded\n` +
      `  commit    ${r.commit}${r.dirty ? '  ** WORKING TREE WAS DIRTY **' : ''}\n` +
      `  artifact  ${r.artifact}\n` +
      `  sha256    ${r.sha256}\n` +
      `  size      ${r.size} bytes\n` +
      `  platform  ${r.platform || 'UNSTATED'} / ${r.variant || 'UNSTATED'}\n` +
      `  toolchain ${r.toolchain || 'UNKNOWN — nothing here could report it, recorded as unknown rather than omitted'}\n`
    );
    if (r.dirty) {
      process.stdout.write(
        '\n  The tree was dirty, so this artifact cannot be reproduced from the commit it names.\n' +
        '  Readiness will read this candidate as STALE. That is not a bug to work around.\n'
      );
    }
  }, { die });
}

function cmdShow() {
  const read = readDossier(LEDGER);
  if (!read.ok) die(2, read.reason);
  if (!read.records.length) die(2, `no ${DOSSIER_PATH} — no release candidate has ever been recorded for this project`);
  const rc = read.records.at(-1);
  if (flags.json) { process.stdout.write(`${JSON.stringify(rc, null, 2)}\n`); return; }
  process.stdout.write(
    `RELEASE CANDIDATE — ${read.records.length} recorded, showing the latest\n\n` +
    `  recorded  ${rc.ts}${rc.by ? ` by ${rc.by}` : ''}\n` +
    `  commit    ${rc.commit}${rc.dirty ? '  ** BUILT FROM A DIRTY TREE **' : ''}\n` +
    `  branch    ${rc.branch || 'UNKNOWN'}\n` +
    `  artifact  ${rc.artifact}\n` +
    `  sha256    ${rc.sha256}\n` +
    `  platform  ${rc.platform || 'UNSTATED'} / ${rc.variant || 'UNSTATED'}\n` +
    `  toolchain ${rc.toolchain || 'UNKNOWN'}\n`
  );
}

/** Does the artifact on disk still hash to what was recorded? */
function cmdVerify() {
  const read = readDossier(LEDGER);
  if (!read.ok) die(2, read.reason);
  if (!read.records.length) die(2, `no ${DOSSIER_PATH} — nothing to verify`);
  const rc = read.records.at(-1);
  const artifactPath = resolve(ROOT, rc.artifact || '');
  if (!rc.artifact || !existsSync(artifactPath)) {
    die(2, `the recorded artifact is not at ${rc.artifact || '(no path)'} — the binding cannot be checked, which is not the same as holding`);
  }
  const now = hashArtifact(artifactPath);
  if (now !== rc.sha256) {
    die(1, `${rc.artifact} CHANGED after it was bound\n` +
           `  recorded ${rc.sha256}\n` +
           `  on disk  ${now}\n` +
           '  The file about to be shipped is not the file that was recorded against this commit.');
  }
  process.stdout.write(
    `RELEASE CANDIDATE: CLEAR — ${read.records.length} chained record(s); ` +
    `${rc.artifact} still matches ${rc.sha256.slice(0, 12)} at ${rc.commit.slice(0, 12)}\n`
  );
}

switch (command) {
  case 'record': cmdRecord(); break;
  case 'show': cmdShow(); break;
  case 'verify': cmdVerify(); break;
  default:
    die(1, `unknown command "${command ?? ''}"\n` +
           '  record --artifact <path> [--platform ios|android|web] [--variant release] [--by <role>]\n' +
           '  show [--json]\n' +
           '  verify');
}
