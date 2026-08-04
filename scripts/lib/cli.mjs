/**
 * ONE exit contract and ONE way to refuse, for every script in the studio.
 *
 * WHAT THIS FIXES, MEASURED RATHER THAN ASSUMED. Dogfood run 1 spent ELEVEN invocations discovering
 * one command's required arguments, one flag per attempt, and every refusal exited 2. In this
 * studio's contract 2 means CANNOT EVALUATE — the gate could not run — and several callers are
 * documented to record that and DEGRADE. So a caller with a typo could conclude a gate was
 * unavailable on this host and proceed without it.
 *
 * That is DR4-001, the oldest defect here, wearing a new hat: a HARNESS fault reading as an
 * ENVIRONMENT fault. It was fixed once, in verify-done, by adding a three-state contract. Every
 * other script then re-derived its own conventions, and the same confusion grew back in the gate
 * that authorises agent spawns.
 *
 * THE FIVE OUTCOMES, and the distinctions that matter:
 *
 *   PASS       0   the thing holds
 *   BLOCKED    1   the thing does not hold — a real, product-level refusal
 *   UNKNOWN    2   the check could not run: no toolchain, no device, no declaration
 *   USAGE     64   the CALLER is wrong. EX_USAGE from sysexits.h.
 *   ENVIRON   69   a required external dependency is absent. EX_UNAVAILABLE.
 *
 * 64 and 69 both used to be 2, and collapsing them cost real safety. A caller that degrades on
 * UNKNOWN must not degrade on USAGE — one means "the world is not ready", the other means "you
 * asked wrong", and only the first is anyone's excuse to continue. Splitting ENVIRON out of UNKNOWN
 * is the same distinction one level down: "no Android SDK on this host" is actionable by a human in
 * a way that "no journey declared" is not.
 */

const EXIT = { PASS: 0, BLOCKED: 1, UNKNOWN: 2, USAGE: 64, ENVIRON: 69 };

/**
 * Refuse with the COMPLETE set of problems, not the first one.
 *
 * One-at-a-time disclosure is a staircase for a human and a wall for an agent: each refusal names
 * one thing and hides the rest, so a caller with a retry budget burns it learning nothing. Every
 * refusal built here says everything that is wrong, and what to do about it.
 */
function refuse(name, code, summary, details = [], remedy = '') {
  const label = code === EXIT.USAGE ? 'USAGE' : code === EXIT.ENVIRON ? 'ENVIRONMENT'
    : code === EXIT.UNKNOWN ? 'CANNOT EVALUATE' : 'BLOCKED';
  let text = `${name}: ${label} — ${summary}\n`;
  for (const d of details) text += `  ${d}\n`;
  if (remedy) text += `  ${remedy}\n`;
  if (code === EXIT.USAGE) {
    text += '  This is a malformed invocation, NOT a check that could not run.\n' +
            '  A caller that degrades on exit 2 must not degrade on this — fix the call.\n';
  }
  if (code === EXIT.ENVIRON) {
    text += '  This is an ENVIRONMENT fact, not a product fact. Nothing here says the work is wrong.\n';
  }
  process.stderr.write(text);
  process.exit(code);
}

/**
 * Assert every required flag at once.
 *
 * Returns nothing and exits 64 when anything is missing, naming ALL of them plus a usage line —
 * because the failure this replaces was a caller learning its contract one refusal at a time.
 */
function requireFlags(name, flags, required, extra = '') {
  const missing = required.filter((f) => !flags[f]);
  if (!missing.length) return;
  refuse(name, EXIT.USAGE,
    `missing required argument(s): ${missing.map((m) => `--${m}`).join(' ')}`,
    [`usage: ${name} ${required.map((r) => `--${r} <value>`).join(' ')}${extra ? ` ${extra}` : ''}`]);
}

/**
 * Is an external command available?
 *
 * Answers the ONE question "is this binary on PATH", not "did the build succeed". Conflating those
 * is precisely how a missing toolchain became indistinguishable from a failing test and sent
 * developers to fix bugs that did not exist.
 */
function haveCommand(exe) {
  try {
    // `command -v` rather than `which`: POSIX, and present where `which` is not.
    require('node:child_process').execFileSync('command', ['-v', exe], { stdio: 'ignore', shell: true });
    return true;
  } catch { return false; }
}

export { EXIT, refuse, requireFlags, haveCommand };
