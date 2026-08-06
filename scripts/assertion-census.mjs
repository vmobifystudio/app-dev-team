#!/usr/bin/env node
/**
 * assertion-census — how many of our assertions test BEHAVIOUR, and how many test PROSE?
 *
 * "1210 assertions" is the number this project quotes about itself, in the README, the HANDBOOK,
 * every commit message and every status report. It implies more than it delivers, and the gap is
 * measurable: a meaningful share of those assertions do nothing but grep a Markdown file for a
 * string.
 *
 * A documentary assertion proves an INSTRUCTION EXISTS. It cannot prove anything HAPPENS. That is
 * the shape `failure-corpus.md` FC-002 calls "the rule that cannot fail", and this repository has
 * been caught by it before — the only assertion guarding `code-reviewer.md`'s mandatory
 * `## Not checked` section grepped the instruction file, so a reviewer could omit the section
 * forever with the suite green.
 *
 * THEY ARE NOT WORTHLESS, AND THIS DOES NOT PROPOSE DELETING THEM. They catch generator/validator
 * drift, which is R5 — the recurrence where templates emit documents the validator rejects — and
 * that has bitten twice, most recently when making `--verdict` mandatory left `tech-manager.md`
 * naming a command the CLI now refuses. A doc-grep caught that.
 *
 * What is wrong is COUNTING THEM TOGETHER and quoting one number. So this prints two, and CI prints
 * it on every run, so the honest figure is the one in front of whoever is deciding whether to trust
 * the suite.
 *
 * HOW IT CLASSIFIES, and its own limits stated rather than implied:
 *   documentary  the assertion's command greps a file under agents/ commands/ skills/ knowledge/
 *                docs/ or .github/ — i.e. its entire subject is a text file humans read
 *   behavioural  everything else: it ran something and checked what happened
 *
 * This is a heuristic over shell source, not a parse. An assertion that greps a doc AND executes a
 * script is counted documentary, which understates behaviour slightly — the conservative direction,
 * because a census that flattered the suite would be the exact self-deception it exists to prevent.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const suite = resolve(HERE, 'test.sh');
const lines = readFileSync(suite, 'utf8').split('\n');

const PROSE = /"\$HERE\/\.\.\/(agents|commands|skills|knowledge|docs|\.github)\/|"\$RULES"|"\$CR"/;
const ASSERTS = /(^|\s)(ok|bad)\s+"|assert_has\s|assert_exit\s|assert_finding\s/;

let documentary = 0;
let behavioural = 0;
for (const [i, line] of lines.entries()) {
  if (!ASSERTS.test(line)) continue;
  // The assertion plus the few lines above it — a shell assertion's subject is usually the command
  // immediately preceding, not the `ok "..."` line itself.
  const context = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
  if (PROSE.test(context) && !/node "|sh "|\$BD |\$RJ /.test(context)) documentary += 1;
  else behavioural += 1;
}

const total = documentary + behavioural;
const pct = total ? Math.round((documentary / total) * 100) : 0;
// SITES, NOT EXECUTIONS, and the two are not interchangeable. The suite reports how many
// assertions RAN (some sites sit inside `for` loops over every agent or skill and fire many times;
// others are behind a conditional and may not fire at all). This counts places in the source. The
// ratio is the useful part; quoting this total as "the number of assertions" would be swapping one
// misleading number for another, which is the thing this file was written to stop.
process.stdout.write(
  `ASSERTION CENSUS — ${total} assertion SITE(s) in scripts/test.sh\n` +
  `  (sites, not executions — the suite's own total counts assertions that RAN, which differs)\n` +
  `  behavioural  ${String(behavioural).padStart(4)}   ran something and checked what happened\n` +
  `  documentary  ${String(documentary).padStart(4)}   greps a file humans read; proves an instruction EXISTS, not that anything happens\n` +
  `\n  ${pct}% documentary.\n`
);
if (pct >= 25) {
  process.stdout.write(
    '\n  That share is high enough to be misleading when quoted as one number. Documentary\n' +
    '  assertions catch generator/validator drift (R5, twice real here) and are worth keeping —\n' +
    '  but a claim of "N assertions" should say which N.\n'
  );
}
// Always exit 0: this is a MEASUREMENT, not a gate. A threshold here would invite gaming the
// classifier instead of writing behavioural tests, and the number is more useful un-gamed.
process.exit(0);
