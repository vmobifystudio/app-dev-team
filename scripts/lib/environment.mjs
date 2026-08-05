/**
 * F8 — telling "this is broken" apart from "this cannot be checked here", once, for everyone.
 *
 * THE DEFECT THIS CLASS PRODUCES. DR4-001: `verify-done.sh` could not distinguish a FAILING test
 * from a test command that never RAN, so a missing simulator looked exactly like a real defect.
 * Developers were re-spawned to fix bugs that did not exist, and an entire sprint lost its review
 * stage. The same shape recurs everywhere a tool might be absent: a missing `xcodebuild`, an
 * `adb` with no device, a `gradlew` that is not executable.
 *
 * The three-state contract already names the answer — exit 2 is CANNOT EVALUATE — but each script
 * decided for itself what deserved a 2, by reading exit codes and grepping stderr in its own way.
 * This is that judgement in one place, so a new script inherits it instead of re-deriving it.
 *
 * THE RULE, and why it is conservative in this direction: an unrecognised failure is treated as a
 * REAL failure, never as an environment problem. Getting this backwards is the dangerous error —
 * a genuine defect reported as "your toolchain is missing" is a defect nobody investigates, which
 * is precisely the false-clear this repo exists to refuse. A real failure misreported as an
 * environment issue wastes an hour; an environment issue misreported as a pass ships a bug.
 */

/**
 * Shell and POSIX conventions for "the command could not be run at all", as opposed to "the
 * command ran and returned failure".
 *
 *   127  command not found          — the classic missing-toolchain signal
 *   126  found but not executable   — a gradlew without +x, a script with a bad shebang
 *   null/undefined exit with a spawn error — the process never started
 */
const CANNOT_RUN_EXITS = new Set([126, 127]);

/**
 * Text that means the environment, not the code. Matched case-insensitively against combined
 * stdout+stderr.
 *
 * DELIBERATELY NARROW. Every entry here is a phrase a TOOL emits about ITSELF being unavailable.
 * Broad patterns like /not found/ alone would swallow "test not found" and "module not found",
 * which are real failures — and a classifier that calls a real failure an environment problem is
 * the exact inversion the note above warns about.
 */
const CANNOT_RUN_PATTERNS = [
  /command not found/i,
  /: not found\b/i,
  /no such file or directory.*(xcodebuild|gradlew|gradle|adb|swift|node|npm|pod)/i,
  /xcode-select: error/i,
  /unable to find utility/i,
  /no devices?\/simulators? (are )?available/i,
  /unable to boot (the )?simulator/i,
  /no connected devices/i,
  /adb: no devices/i,
  /sdk location not found/i,
  /java(_home)? is not set/i,
  /permission denied/i,
];

/**
 * Classify a completed command.
 *
 * @param {{status: number|null, output: string}} result
 * @returns {{kind: 'ok'|'failed'|'environment', exit: 0|1|2, reason: string}}
 *
 * `exit` is the code a GATE should return, so callers do not each re-map the three states and
 * quietly disagree about which is which.
 */
export function classify({ status, output = '' }) {
  if (status === 0) return { kind: 'ok', exit: 0, reason: '' };

  if (status === null || status === undefined) {
    return { kind: 'environment', exit: 2, reason: 'the process never started — the command could not be executed here' };
  }
  if (CANNOT_RUN_EXITS.has(status)) {
    return {
      kind: 'environment',
      exit: 2,
      reason: status === 127
        ? 'exit 127 — the command was not found, so nothing ran and nothing was checked'
        : 'exit 126 — the command was found but is not executable, so nothing ran',
    };
  }
  const hit = CANNOT_RUN_PATTERNS.find((re) => re.test(output));
  if (hit) {
    return { kind: 'environment', exit: 2, reason: `the output names a missing or unusable tool (${hit.source})` };
  }
  // Everything else is a REAL failure. Conservative on purpose: see the header.
  return { kind: 'failed', exit: 1, reason: `exit ${status} — the command ran and reported failure` };
}

/**
 * The sentence a gate should print for a classification, in the studio's own vocabulary.
 *
 * Centralised because the WORDING is load-bearing: "CANNOT EVALUATE" tells a reader that re-running
 * will not help until something changes, while "BLOCKED" tells them to go and fix code. Those two
 * send a team in opposite directions, and three scripts phrasing it three ways is how the
 * distinction erodes.
 */
export function say(name, c) {
  if (c.kind === 'ok') return `${name}: CLEAR`;
  if (c.kind === 'environment') {
    return `${name}: CANNOT EVALUATE — ${c.reason}.\n` +
           '  This is NOT a pass and NOT a failure of the work. Re-running changes nothing until\n' +
           '  the tool is available; say so rather than reporting a defect nobody can reproduce.';
  }
  return `${name}: BLOCKED — ${c.reason}`;
}
