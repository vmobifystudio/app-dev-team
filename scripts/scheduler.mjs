#!/usr/bin/env node
/** Deterministic dependency scheduler: ready queue, fairness, and backpressure. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`scheduler: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['plan']), die });
const path = resolve(String(flags.plan || 'docs/team/schedule.json'));
if (!existsSync(path)) die(2, `no schedule plan at ${path}`);
let plan; try { plan = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die(2, e.message); }
if (plan.schema !== 'scheduler-plan/v1' || !Array.isArray(plan.tasks)) die(2, 'plan must use schema scheduler-plan/v1 with tasks');
const ids = new Set(plan.tasks.map((task) => task.id)); const errors = [];
for (const task of plan.tasks) {
  if (!task.id || !task.owner || !['pending', 'running', 'complete', 'blocked'].includes(task.status)) errors.push(`${task.id || '(unknown)'}: invalid identity or status`);
  for (const dep of task.depends || []) if (!ids.has(dep)) errors.push(`${task.id}: missing dependency ${dep}`);
}
if (errors.length) { errors.forEach((error) => console.error(`scheduler: ${error}`)); process.exit(1); }
const byId = new Map(plan.tasks.map((task) => [task.id, task]));
function completed(id, seen = new Set()) { if (seen.has(id)) die(1, `dependency cycle includes ${id}`); seen.add(id); const task = byId.get(id); return task?.status === 'complete' && (task.depends || []).every((dep) => completed(dep, seen)); }
const running = plan.tasks.filter((task) => task.status === 'running').length;
const capacity = Number(plan.max_parallel || 1); if (!Number.isInteger(capacity) || capacity < 1) die(2, 'max_parallel must be a positive integer');
const ready = plan.tasks.filter((task) => task.status === 'pending' && (task.depends || []).every((dep) => completed(dep)))
  .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(b.wait_cycles || 0) - Number(a.wait_cycles || 0) || String(a.id).localeCompare(String(b.id)));
const dispatch = ready.slice(0, Math.max(0, capacity - running));
const result = { schema: 'schedule-result/v1', max_parallel: capacity, running, backpressure: running >= capacity, ready: dispatch.map((task) => task.id), deferred: ready.slice(dispatch.length).map((task) => task.id) };
console.log(JSON.stringify(result, null, 2));
