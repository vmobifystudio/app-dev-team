#!/usr/bin/env node
/**
 * readiness — print the one canonical readiness state.
 *
 * This is a PROJECTION, not a second opinion. It formats what `lib/readiness.mjs` computed and adds
 * nothing: no extra heuristic, no "but the tests looked fine". The moment a surface starts deciding
 * for itself, the studio is back to three pictures that can disagree.
 *
 * Exit codes follow the studio's three-state contract, so this composes into a shell gate:
 *   0  PASS
 *   1  BLOCKED or STALE — do not act on this as though it were ready
 *   2  CANNOT EVALUATE
 */
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { reduceReadiness } from './lib/readiness.mjs';

const die = (code, message) => { process.stderr.write(`readiness: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['root']), die });
const root = resolve(String(flags.root || '.'));

const state = reduceReadiness(root);

if (flags.json) {
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
} else {
  process.stdout.write(`READINESS — ${state.about}\n\n`);
  for (const g of state.gates) {
    process.stdout.write(`  ${g.state.padEnd(16)} ${g.gate}${g.detail ? `  — ${g.detail}` : ''}\n`);
  }
  process.stdout.write(`\n  VERDICT: ${state.verdict}\n`);
  if (state.verdict === 'STALE') {
    process.stdout.write(
      '  STALE is not a failure. Nothing here says the product is broken;\n' +
      '  it says nobody has checked THIS candidate. Re-run the gates.\n'
    );
  }
}

process.exit(state.verdict === 'PASS' ? 0 : state.verdict === 'CANNOT_EVALUATE' ? 2 : 1);
