/**
 * The kill switch.
 *
 * An autonomous loop that spawns agents which run shell commands and drive git needs one control an
 * operator can reach in a hurry, from a phone, over ssh, with no editor and no knowledge of this
 * codebase. That control is a FILE:
 *
 *     echo "reason" > .studio-stop        # halt all spawning, now
 *     rm .studio-stop                     # resume
 *
 * or `APP_TEAM_STOP=1` in the environment for a single run.
 *
 * Design constraints it is built to, each one from a way kill switches fail in practice:
 *
 *   - **No code edit.** A stop that requires editing a script cannot be used by the person most
 *     likely to need it, and a stop that lives in a running process dies with the process.
 *   - **Checked before every spawn, not once at the top.** A loop that reads the switch once at
 *     round 1 is not a stop, it is a preference. `spawn-gate.sh` is the mandatory pre-spawn call
 *     already, so the check goes there, where it cannot be skipped without skipping the gate.
 *   - **Fails CLOSED on an unreadable file.** A stop file that exists but cannot be read is a stop.
 *   - **Carries a reason.** The file's contents are printed back, so the next operator knows
 *     whether they may clear it. An unexplained halt gets deleted by whoever finds it first.
 *
 * The switch stops SPAWNING. It does not kill agents already running — nothing in this repo has a
 * process handle on them — and it says so, because a control believed to do more than it does is
 * worse than no control.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STOP_FILE = '.studio-stop';

/**
 * @param {string} root  the directory to look in (repo root)
 * @returns {{stopped: boolean, source: string, reason: string}}
 */
export function readStop(root = process.cwd()) {
  if (process.env.APP_TEAM_STOP) {
    return { stopped: true, source: 'APP_TEAM_STOP', reason: String(process.env.APP_TEAM_STOP) };
  }
  const path = join(root, STOP_FILE);
  if (!existsSync(path)) return { stopped: false, source: '', reason: '' };
  let reason;
  try {
    reason = readFileSync(path, 'utf8').trim();
  } catch (error) {
    // Fail closed. "I could not read the stop file" is not "there is no stop file".
    return { stopped: true, source: path, reason: `unreadable (${error.message}) — treated as STOP` };
  }
  return { stopped: true, source: path, reason: reason || '(no reason recorded)' };
}

export { STOP_FILE };
