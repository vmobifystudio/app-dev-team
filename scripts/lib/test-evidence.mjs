/**
 * Did a test suite demonstrably RUN, and did it PASS? One definition, read by wave-integrate.mjs
 * (imported) and verify-done.sh (via the CLI below). They used to carry two copies of this regex,
 * and every new test runner had to be found twice (H7, H9) — once per copy.
 *
 * THE ORDER IS THE DECISION, and it is DR4-001's order:
 *   1. exit 126/127 — the shell could not execute the command at all;
 *   2. a toolchain signature — checked BEFORE ran-evidence, because xcodebuild prints
 *      "** TEST FAILED **" when it cannot find an SDK;
 *   3. only then, evidence that a suite ran.
 *
 * GREEN IS STRICTER THAN FAILING (G-F5, W1). A failing verdict may rest on a keyword ("TEST FAILED",
 * "assertion failed"): calling a broken run broken is the safe direction. GREEN needs a runner's own
 * summary line counting AT LEAST ONE test (or one of the two count-less shapes that only print when
 * tests executed: go's `ok <pkg> <time>` and a Gradle test task followed by BUILD SUCCESSFUL).
 * "Executed 0 tests", "# tests 0", "Tests: 0 total", "no tests ran" and a bare `echo "test case"`
 * are never green. Anything else falls through to cannot-run, never to a verdict about the code.
 *
 * lib/environment.mjs DELIBERATELY DISAGREES with this file (it defaults unrecognised failures to
 * REAL failures); see its header. Do not merge the two.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CANNOT_RUN = /command not found|: not found|no such file or directory|xcode-select: error|requires Xcode|xcrun: error|unable to find utility|cannot be located|unable to find a destination|GradleWrapperMain|permission denied|not recognized as an internal/i;

// A runner's summary line, with group 1 = how many tests it counted. Anchored to the runner's own
// shape; never widened into prose that merely says "tests" or "passed".
const COUNTED = [
  /executed ([0-9]+) tests?/gi,                                        // XCTest
  /test run with ([0-9]+) tests?/gi,                                   // Swift Testing
  /tests? run: ([0-9]+)/gi,                                            // JUnit / surefire
  /([0-9]+) (?:tests?|assertions?|examples?)[,.]? .*(?:fail|pass)/gi,  // RSpec, Gradle "N tests completed, M failed"
  /([0-9]+) passing/gi,                                                // mocha
  /^#\s*(?:tests|pass)\s+([0-9]+)/gim,                                 // node --test TAP
  /Finished ([0-9]+) tests? on/gi,                                     // AGP connectedAndroidTest
  /^Tests:\s+(?:[0-9]+ \w+, )*([0-9]+) passed, .*[0-9]+ total/gim,     // Jest   "Tests:       3 passed, 3 total"
  /^\s*Tests\s+(?:[0-9]+ \w+ \| )*([0-9]+) passed\b.*\([0-9]+\)/gim,   // Vitest "      Tests  3 passed (3)"
  /^=*\s*(?:[0-9]+ \w+, )*([0-9]+) passed\b.* in [0-9.]+s/gim,         // pytest "3 passed in 0.12s"
];

// Shapes that print only when tests executed but carry no count.
// ponytail: a Gradle/JUnit5 test task with test sources and zero test methods still prints this on
// Gradle < 9; reading build/test-results XML would close it.
const UNCOUNTED_PASS = [
  /^ok\s+\S+\s+(?:[0-9.]+s|\(cached\))(?:\s+coverage:[^[\n]*)?\s*$/m,                                         // go test
  /^> Task :(?:\S+:)?(?:test|test\w*UnitTest)(?: UP-TO-DATE| FROM-CACHE)?\s*$[\s\S]*^BUILD SUCCESSFUL/m,     // Gradle --console=plain
];

// Evidence a suite ran and FAILED. Never enough for green.
const FAILED = /test case|TEST FAILED|FAILED \(|assertion (?:failed|error)|expectation|✗|✘|[0-9]+ failing|^--- FAIL: |^FAIL\s+\S+\s+[0-9.]+s|^Tests:\s+.*[0-9]+ total|^\s*Tests\s+[0-9]+ .*\([0-9]+\)\s*$|^=*\s*[0-9]+ (?:failed|errors?)\b.* in [0-9.]+s/im;

const ZERO = /executed 0 tests|^#\s*tests\s+0\b|tests:\s+0 total|\b0 passed\b|\b0 passing\b|no tests ran|no tests found|no test files found|\[no test files\]|\[no tests to run\]|> Task \S*test\w* NO-SOURCE/im;

/** @returns {{verdict: 'green'|'failing'|'cannot-run', why: string}} */
export function classifyTestRun(status, output) {
  const out = String(output || '');
  const cannot = (why) => ({ verdict: 'cannot-run', why });
  if (status === 126 || status === 127) return cannot(`the test command exited ${status} — the shell could not execute it at all`);
  if (CANNOT_RUN.test(out)) return cannot('the output names a missing or unusable toolchain, not a failing assertion');

  let counted = false;
  let most = 0;
  for (const re of COUNTED) {
    for (const m of out.matchAll(re)) { counted = true; most = Math.max(most, Number(m[1])); }
  }
  const uncounted = UNCOUNTED_PASS.some((re) => re.test(out));
  const zero = out.match(ZERO);
  const zeroWhy = zero && `the suite ran ZERO tests ("${zero[0].trim()}") — zero tests is not a green`;

  if (status === 0) {
    if (most > 0 || uncounted) return { verdict: 'green', why: '' };
    if (zeroWhy) return cannot(zeroWhy);
    if (counted || FAILED.test(out)) return cannot('exit 0, but no test-runner summary counts at least one test that ran — a keyword is not a test count');
  } else if (counted || uncounted || FAILED.test(out)) {
    return { verdict: 'failing', why: '' };
  } else if (zeroWhy) {
    return cannot(zeroWhy);
  }
  const lines = out ? out.split('\n').filter(Boolean).length : 0;
  return cannot(`the output carries no evidence that a test suite ran at all (exit ${status}, ${lines} line(s) of output)`);
}

// CLI for verify-done.sh: test-evidence.mjs <exit-code> <log-file>  ->  "<verdict>\t<why>"
// realpath: import.meta.url is resolved through symlinks (/var -> /private/var on macOS), argv[1]
// is not — comparing them raw made the CLI print nothing under a symlinked path.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let log = '';
  try { log = readFileSync(process.argv[3], 'utf8'); } catch { /* empty log: no evidence */ }
  const r = classifyTestRun(Number(process.argv[2]), log);
  process.stdout.write(`${r.verdict}\t${r.why}\n`);
}
