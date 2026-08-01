#!/usr/bin/env node
/**
 * Turns `release-manager.md`'s staged-rollout prose into a real gate. The doc already says "hold
 * at each step until the release health checks below are clean" — nothing ever checked. A human
 * reading a threshold in prose is not a gate; this is the same three-state contract every other
 * check in this repo already uses (0 clear, 1 refuse the ramp advance, 2 cannot evaluate).
 *
 * Usage: release-health.mjs --crash-free-rate 0.996 --p0-count 0 [--policy .studio-policy.json]
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`release-health: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['crash-free-rate', 'p0-count', 'policy']), die });

const crashFreeRate = flags['crash-free-rate'];
const p0Count = flags['p0-count'];
if (crashFreeRate === undefined || p0Count === undefined) {
  die(2, '--crash-free-rate and --p0-count are both required — a metric nobody supplied is CANNOT EVALUATE, never an implicit pass');
}
const rate = Number(crashFreeRate);
const p0 = Number(p0Count);
if (!Number.isFinite(rate) || rate < 0 || rate > 1) die(2, '--crash-free-rate must be a number between 0 and 1');
if (!Number.isFinite(p0) || p0 < 0 || !Number.isInteger(p0)) die(2, '--p0-count must be a non-negative integer');

// Defaults match release-manager.md's own "hold or halt" framing: any open P0 during the ramp
// window halts widening, and crash-free rate has a floor rather than a target nobody enforces.
const DEFAULTS = { minCrashFreeRate: 0.995, maxP0Count: 0 };
const policyPath = resolve(String(flags.policy || '.studio-policy.json'));
let thresholds = DEFAULTS;
if (existsSync(policyPath)) {
  let policy;
  try { policy = JSON.parse(readFileSync(policyPath, 'utf8')); } catch (e) { die(2, `cannot read ${policyPath}: ${e.message}`); }
  if (policy.releaseHealth) thresholds = { ...DEFAULTS, ...policy.releaseHealth };
}

// A non-numeric override does not throw — `rate < "not-a-number"` and `p0 > "not-a-number"` both
// coerce to NaN and every comparison against NaN is false, so a malformed policy silently defeated
// BOTH thresholds at once: reproduced with a string override that returned RELEASE HEALTH: CLEAR
// for a 0% crash-free rate and 99 open P0 incidents. A malformed threshold is CANNOT EVALUATE, the
// same rule this file already applies to a malformed CLI argument two lines up.
if (!Number.isFinite(thresholds.minCrashFreeRate) || thresholds.minCrashFreeRate < 0 || thresholds.minCrashFreeRate > 1) {
  die(2, `${policyPath}'s releaseHealth.minCrashFreeRate must be a number between 0 and 1, got ${JSON.stringify(thresholds.minCrashFreeRate)}`);
}
if (!Number.isFinite(thresholds.maxP0Count) || thresholds.maxP0Count < 0) {
  die(2, `${policyPath}'s releaseHealth.maxP0Count must be a non-negative number, got ${JSON.stringify(thresholds.maxP0Count)}`);
}

const failures = [];
if (rate < thresholds.minCrashFreeRate) {
  failures.push(`crash-free rate ${rate} is below the floor ${thresholds.minCrashFreeRate}`);
}
if (p0 > thresholds.maxP0Count) {
  failures.push(`${p0} open P0 incident(s) exceeds the max ${thresholds.maxP0Count} — widening does not proceed with an open P0`);
}

if (failures.length) {
  failures.forEach((f) => process.stderr.write(`release-health: ${f}\n`));
  process.stdout.write('RELEASE HEALTH: HOLD — do not widen the ramp\n');
  process.exit(1);
}
process.stdout.write(`RELEASE HEALTH: CLEAR — crash-free ${rate} >= ${thresholds.minCrashFreeRate}, ${p0} <= ${thresholds.maxP0Count} open P0\n`);
