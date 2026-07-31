#!/usr/bin/env node
/** Portable warm/cold manager contract harness. */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`manager-harness: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['scenario', 'mode']), die });
const scenarioPath = resolve(String(flags.scenario || 'eval/manager-scenario.json'));
if (!existsSync(scenarioPath)) die(2, `no scenario at ${scenarioPath}`);
let scenario; try { scenario = JSON.parse(readFileSync(scenarioPath, 'utf8')); } catch (e) { die(2, e.message); }
if (scenario.schema !== 'manager-scenario/v1' || !Array.isArray(scenario.rounds)) die(2, 'scenario must use schema manager-scenario/v1 with rounds');
if (!['warm', 'cold', 'compare'].includes(flags.mode || 'compare')) die(2, '--mode must be warm, cold, or compare');
function run(mode) {
  let persisted = { schema: 'manager-state/v1', run: scenario.run || 'RUN-HARNESS', round: 0, tickets: {}, questions: {}, decisions: [] };
  let live = mode === 'warm' ? persisted : null;
  for (const round of scenario.rounds) {
    if (!round.number || !Array.isArray(round.events)) die(2, 'each round needs number and events');
    if (mode === 'cold') live = JSON.parse(JSON.stringify(persisted));
    live.round = round.number;
    for (const event of round.events) {
      if (!event.type) die(2, 'manager event needs type');
      if (event.type === 'ticket') live.tickets[event.id] = event.status;
      else if (event.type === 'question') live.questions[event.id] = event.answer || 'open';
      else if (event.type === 'decision') live.decisions.push({ id: event.id, value: event.value });
      else die(2, `unknown manager event ${event.type}`);
    }
    persisted = JSON.parse(JSON.stringify(live));
  }
  const canonical = JSON.stringify(persisted);
  return { mode, digest: createHash('sha256').update(canonical).digest('hex'), state: persisted };
}
const warm = run('warm'); const cold = run('cold');
if (flags.mode === 'warm' || flags.mode === 'cold') { console.log(JSON.stringify(flags.mode === 'warm' ? warm : cold, null, 2)); process.exit(0); }
if (warm.digest !== cold.digest) { console.error(`manager-harness: WARM/COLD DIVERGENCE\n  warm: ${warm.digest}\n  cold: ${cold.digest}`); process.exit(1); }
console.log(JSON.stringify({ schema: 'manager-harness/v1', status: 'PASS', warm_digest: warm.digest, cold_digest: cold.digest, rounds: scenario.rounds.length }, null, 2));
