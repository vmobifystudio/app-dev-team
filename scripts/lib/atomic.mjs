/**
 * ONE serialization primitive for every append-only log in the studio.
 *
 * WHY THIS FILE EXISTS. `run-ledger.mjs` already carried a correct `O_EXCL` lock, with a comment
 * describing the exact race it fixed: two concurrent writers both read the same tip, both computed
 * `prev_hash` against it, and the second append broke the chain for every future read. That fix
 * was never propagated to `board.mjs`, which performs the same read/verify/append with no
 * serialization at all. Measured on a clean repo: twelve concurrent `board.mjs add` calls produced
 * FOUR events — eight tickets silently lost — and left the chain broken at line 4.
 *
 * That is this repository's defining defect class (FC-001: the fix that lands in one mechanism and
 * stops before its sibling), committed against the mechanism whose whole purpose is to be the
 * durable record. A shared primitive is the structural answer: there is now one lock to reason
 * about, so the next writer cannot quietly omit it.
 *
 * Node has no built-in flock and this plugin stays dependency-free by design, so an `O_EXCL`
 * lockfile does the work — the same mechanism Unix mail spools and package managers use.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

// A lock is stale if its holder died without running the exit hook (SIGKILL, power loss). Without
// recovery, one crashed process wedges the board permanently and the studio's advice would be
// "delete this file by hand" — an instruction that is indistinguishable, to an operator, from
// "your data is corrupt". Ten seconds is far longer than any legitimate read/verify/append.
const STALE_LOCK_MS = 10_000;
const held = new Set();

process.on('exit', () => {
  for (const path of held) { try { unlinkSync(path); } catch { /* already gone */ } }
});

/**
 * Run `fn` with an exclusive lock on `target`. Every read/decide/append sequence against an
 * append-only log MUST be wrapped in this — locking only the write is not enough, because the
 * decision (and the tip the hash chains onto) is made during the read.
 */
function withFileLock(target, fn, { timeoutMs = 5000, die = defaultDie } = {}) {
  const lockPath = `${target}.lock`;
  mkdirSync(dirname(target), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let fd;
  for (;;) {
    try { fd = openSync(lockPath, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') die(2, `could not create lock ${lockPath}: ${e.message}`);
      if (reapIfStale(lockPath)) continue;
      if (Date.now() > deadline) {
        die(2,
          `could not acquire ${lockPath} within ${timeoutMs}ms — another writer is holding it.\n` +
          '  This is contention, not corruption: nothing has been written and nothing is lost.\n' +
          '  Re-run the command. If it persists, a process died holding the lock; remove the file.');
      }
      try { execFileSync('sleep', ['0.02']); } catch { /* best-effort backoff */ }
    }
  }
  held.add(lockPath);
  try {
    closeSync(fd);
    return fn();
  } finally {
    held.delete(lockPath);
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  }
}

function reapIfStale(lockPath) {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs < STALE_LOCK_MS) return false;
    unlinkSync(lockPath);
    return true;
  } catch { return false; }
}

/**
 * Compare-and-append. `expectedTip` is the chain tip the caller validated its decision against; if
 * the log has moved on, the decision was made against a snapshot that no longer exists and the
 * append is refused rather than committed on top of state nobody evaluated.
 *
 * `idempotencyKey` makes a retry after a timeout safe: the same logical transition submitted twice
 * commits once. Without it, "the command timed out, run it again" duplicates the effect.
 */
function compareAndAppend(logPath, { expectedTip, idempotencyKey, readTip, alreadyApplied, write }) {
  const currentTip = readTip();
  if (expectedTip !== undefined && expectedTip !== currentTip) {
    return {
      ok: false,
      reason: 'stale-snapshot',
      message:
        'the log moved while this decision was being made — another writer committed first.\n' +
        '  Nothing was written. Re-read the current state and decide again.',
    };
  }
  if (idempotencyKey && alreadyApplied?.(idempotencyKey)) {
    return { ok: true, duplicate: true, reason: 'already-applied' };
  }
  write(currentTip);
  return { ok: true, duplicate: false };
}

function defaultDie(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export { withFileLock, compareAndAppend, STALE_LOCK_MS };
