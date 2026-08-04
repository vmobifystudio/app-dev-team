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
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

// A lock is stale if its holder DIED — not if it is merely slow.
//
// The first version judged staleness by mtime alone, with a 10-second cutoff justified by the
// assertion that ten seconds is "far longer than any legitimate read/verify/append". That was a
// guess nobody executed, and it was wrong: the locked section contains `git diff --binary` over a
// whole branch, a full hash-verify of the event log, and a board render. Reproduced by the
// code-reviewer — a holder running 14 seconds had its lock UNLINKED BY A LIVE WAITER, both
// processes then ran the critical section concurrently, and the first one's `finally` deleted the
// lock the second was holding, letting a third walk in.
//
// A lock that hands the critical section to someone else is worse than no lock: it produces the
// exact hash-chain fork this primitive exists to prevent, while looking like protection.
//
// So liveness is asked directly. The lockfile carries the holder's pid; `kill(pid, 0)` answers
// "does this process still exist" without signalling it. A slow holder is left alone however long
// it takes; a dead one is reaped immediately, with no timing guess anywhere.
const held = new Set();

process.on('exit', () => {
  for (const path of held) {
    try { if (readFileSync(path, 'utf8').trim() === String(process.pid)) unlinkSync(path); }
    catch { /* already gone, or not ours */ }
  }
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
    try { fd = openSync(lockPath, 'wx'); writeFileSync(lockPath, String(process.pid)); break; }
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
    // ONLY UNLINK OUR OWN LOCK. Unconditionally deleting it is how the previous version let a third
    // writer in: once a waiter had reaped this lock and taken it, this `finally` deleted THEIR lock.
    try { if (readFileSync(lockPath, 'utf8').trim() === String(process.pid)) unlinkSync(lockPath); }
    catch { /* already gone, or taken by someone else — either way not ours to remove */ }
  }
}

/** Reap the lock only if its recorded holder is gone. A slow holder is not a dead holder. */
function reapIfStale(lockPath) {
  try {
    const pid = Number(readFileSync(lockPath, 'utf8').trim());
    // An unreadable or pid-less lockfile is left alone. Guessing that it must be abandoned is how
    // the mtime version stole a live holder's lock; if it really is orphaned, the timeout below
    // still surfaces it to a human with an explanation.
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (pid === process.pid) return false;
    try { process.kill(pid, 0); return false; }  // still alive — wait for it, however long it takes
    catch (e) { if (e.code === 'EPERM') return false; }  // alive, owned by another user
    unlinkSync(lockPath);
    return true;
  } catch { return false; }
}

function defaultDie(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export { withFileLock };
