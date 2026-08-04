#!/usr/bin/env node
/**
 * criterion-check — is every acceptance criterion actually proven, one by one?
 *
 * THE GAP THIS CLOSES. `verify-done` runs the test command and reports green. `qa_passed` records
 * that QA exercised the ticket. Both are real, and neither says anything about a SPECIFIC
 * criterion: a suite can be green while the one behaviour the founder asked for was never
 * exercised, because "the tests passed" is a claim about the suite, not about the acceptance list.
 *
 * The audit's P0-08, stated plainly: generic green tests do not prove acceptance criteria. That is
 * how a feature ships having satisfied its own interpretation and nothing else — the closed loop
 * this studio was built to open.
 *
 * SO EACH CRITERION NAMES ITS OWN PROOF. docs/team/criteria.json maps a criterion to the evidence
 * kinds that would settle it, and to the artifact that carries them. A criterion with no required
 * evidence is not "trivially satisfied" — it is UNPROVEN, and says so, because a criterion nobody
 * can check is a criterion nobody wrote down properly.
 *
 * Evidence is matched by CONTENT, not by path: the digest recorded when the evidence was produced
 * must still match the bytes on disk. A path is mutable; the same filename can hold a different
 * run's output tomorrow, and a check that only asks "does the file exist" cannot tell those apart.
 *
 * Exit codes:
 *   0  every criterion in scope is proven against current evidence
 *   1  at least one criterion is unproven or its evidence is stale
 *   2  cannot evaluate — no registry, or it is unreadable
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`criterion-check: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['root', 'registry', 'ticket']), die });

const root = resolve(String(flags.root || '.'));
const registryPath = resolve(root, typeof flags.registry === 'string' ? flags.registry : 'docs/team/criteria.json');

if (!existsSync(registryPath)) {
  // CANNOT EVALUATE, not CLEAR. A project that has not declared its criteria has not proven them;
  // reporting "nothing to check" would turn an absent contract into a passing one, which is the
  // evidence-optional pass wearing different clothes.
  process.stdout.write(
    `CRITERION CHECK: CANNOT EVALUATE — no ${registryPath}.\n` +
    '  Nothing states which evidence would settle each acceptance criterion, so nothing was checked.\n' +
    '  This is not a pass. Declare the criteria (see docs/team/journeys/README.md for the evidence contract).\n'
  );
  process.exit(2);
}

let registry;
try { registry = JSON.parse(readFileSync(registryPath, 'utf8')); }
catch (e) { die(2, `cannot parse ${registryPath}: ${e.message}`); }
if (registry.schema !== 'criteria/v1') die(2, `${registryPath} is not criteria/v1 (got ${JSON.stringify(registry.schema)})`);

const only = typeof flags.ticket === 'string' ? String(flags.ticket).toUpperCase() : '';
const criteria = (registry.criteria || []).filter((c) => !only || String(c.ticket || '').toUpperCase() === only);

const unproven = [];
const proven = [];

for (const c of criteria) {
  const id = c.id || '(unnamed criterion)';
  const required = Array.isArray(c.evidence) ? c.evidence : [];
  if (!required.length) {
    unproven.push(`${id}: names no evidence — a criterion nobody can check is not a criterion, it is a wish`);
    continue;
  }
  for (const e of required) {
    const rel = String(e.path || '');
    const abs = resolve(root, rel);
    if (!rel) { unproven.push(`${id}: an evidence entry has no path`); continue; }
    if (!existsSync(abs) || !statSync(abs).isFile()) { unproven.push(`${id}: evidence ${rel} does not exist`); continue; }
    if (statSync(abs).size === 0) { unproven.push(`${id}: evidence ${rel} is empty`); continue; }
    if (!e.sha256) {
      unproven.push(`${id}: evidence ${rel} carries no digest, so nothing can tell whether it is still the artifact that was examined`);
      continue;
    }
    const now = createHash('sha256').update(readFileSync(abs)).digest('hex');
    if (now !== e.sha256) {
      unproven.push(`${id}: evidence ${rel} exists but its contents changed (recorded ${String(e.sha256).slice(0, 12)}, now ${now.slice(0, 12)}) — STALE`);
      continue;
    }
    proven.push(`${id} <- ${rel}`);
  }
}

process.stdout.write('CRITERION CHECK\n');
proven.forEach((p) => process.stdout.write(`  PROVEN   ${p}\n`));
unproven.forEach((u) => process.stdout.write(`  UNPROVEN ${u}\n`));

if (!criteria.length) {
  process.stdout.write(`\nRESULT: CANNOT EVALUATE — ${only ? `no criteria declared for ${only}` : 'the registry declares no criteria'}.\n`);
  process.exit(2);
}
if (unproven.length) {
  process.stdout.write(`\nRESULT: BLOCKED — ${unproven.length} of ${criteria.length} criteria are unproven against current evidence.\n`);
  process.exit(1);
}
process.stdout.write(`\nRESULT: PASS — all ${criteria.length} criteria are proven against current evidence.\n`);
