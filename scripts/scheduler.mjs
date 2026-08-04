#!/usr/bin/env node
/** Deterministic dependency scheduler: ready queue, fairness, and backpressure. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { parseEventLog, reduce } from './lib/events.mjs';
const die = (code, message) => { process.stderr.write(`scheduler: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['plan', 'log']), die });
const path = resolve(String(flags.plan || 'docs/team/schedule.json'));
if (!existsSync(path)) die(2, `no schedule plan at ${path}`);
let plan; try { plan = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die(2, e.message); }
if (plan.schema !== 'scheduler-plan/v1' || !Array.isArray(plan.tasks)) die(2, 'plan must use schema scheduler-plan/v1 with tasks');

/**
 * THE PLAN IS A PROJECTION OF THE BOARD, NOT A SECOND TRUTH.
 *
 * `docs/team/schedule.json` was separately authored and separately maintained. Measured in dogfood
 * run 2: the board held two tickets, one of them claimed and in progress, while the plan held
 * `"tasks": []` — and `dispatch-preflight` believed the PLAN, refusing to dispatch a ticket the
 * board said was already being worked. Two writable truths, disagreeing, with the less informed one
 * winning. The audit called multiple writable truths the central architectural defect; this is that
 * defect deciding whether work can start.
 *
 * When the log is readable, tasks are DERIVED from it and the hand-written list is used only for
 * per-task overrides (priority, ceilings). A plan that names tickets the board has never heard of
 * is a stated error, not a silent extra: it means someone is scheduling work that does not exist.
 */
if (existsSync(logPath())) {
  let derived;
  let allTickets = [];
  try {
    const tickets = reduce(parseEventLog(readFileSync(logPath(), 'utf8')).events).tickets;
    allTickets = [...tickets.values()];
    derived = allTickets
      // NOTHING IS FILTERED OUT, and the earlier `.filter(t => t.status !== 'done')` was two bugs
      // in one line. Deciding what is SCHEDULABLE while building the set that describes what
      // EXISTS conflated two different questions, and both consumers of the set then got a wrong
      // answer:
      //
      //   - a COMPLETED dependency read as a MISSING one, so a ticket depending on finished work
      //     became permanently unschedulable — on the most ordinary sequence a project can have;
      //   - the phantom check compared the plan against this set, so the first ticket a project
      //     ever completed made the plan look like it named a ticket the board had never heard of,
      //     halting ALL dispatch with an untrue message and an impossible remedy.
      //
      // `done` maps to `complete` below, which this scheduler already understands.
      // THE SCHEDULER SPEAKS A SECOND LIFECYCLE VOCABULARY. The board says
      // todo/in_progress/review/qa/done/blocked; this validator says pending/running/complete/blocked.
      // The audit stated the lifecycle vocabulary was already single and clean — it is not, and
      // dogfood run 2 is what found the second one, because nothing had ever fed board state into
      // the scheduler before.
      //
      // Mapped rather than unified HERE, deliberately: rewriting the scheduler's vocabulary is a
      // change to a working component to serve a new caller, and the honest sequencing is to record
      // the duplication and translate at the boundary. The mapping is the ONE place the two
      // vocabularies meet, so a future unification has a single site to delete.
      .map((t) => ({
        id: t.id,
        owner: t.owner || '(unassigned)',
        status: t.status === 'done' ? 'complete'
          : t.status === 'blocked' ? 'blocked'
            : ['in_progress', 'review', 'qa'].includes(t.status) ? 'running'
              : 'pending',
        // `depends`, NOT `depends_on`. Every consumer in this file reads `depends`; emitting the
        // other spelling silently dropped ALL board-derived dependency ordering, and
        // dispatch-preflight gates every spawn on the resulting ready set — so an agent could be
        // sent at a ticket whose dependency was unmet. The hand-written plan used `depends` and the
        // ordering held; this was a REGRESSION introduced by deriving the set, found by review.
        depends: t.dependsOn || [],
      }));
  } catch (e) {
    die(2, `the event log at ${logPath()} is unreadable, so the ready set cannot be derived: ${e.message}`);
  }
  // COMPARE AGAINST EVERY TICKET THE BOARD HAS, not against the schedulable subset. `derived`
  // filters out `done`, so the first ticket a project ever completed made the plan look like it
  // named a ticket the board had never heard of — halting ALL dispatch, with a message that was
  // untrue and a remedy ("create the ticket") that was impossible. Found by review; it would have
  // fired on the first completed ticket of the first real project.
  const known = new Set(allTickets.map((t) => t.id.toUpperCase()));
  const phantom = plan.tasks.map((t) => String(t.id).toUpperCase()).filter((id) => !known.has(id));
  if (phantom.length) {
    die(1, `the plan schedules ticket(s) the board has never heard of: ${phantom.join(', ')}.\n` +
           '  The board is authoritative. Either create the ticket, or remove it from the plan.');
  }
  // OVERRIDES MAY NOT TOUCH STATE. The first version spread the whole plan entry over the derived
  // one, so a stale hand-written `status` still beat the board — the unification landed for the SET
  // of tasks and stopped before the STATE of tasks. That is the second-truth defect this change was
  // written to remove, half-removed, in the commit claiming to remove it.
  //
  // Only scheduling PREFERENCES are the plan's to state. Lifecycle facts are the board's.
  const TUNABLE = new Set(['priority', 'wait_cycles', 'max_attempts', 'ceiling']);
  const overrides = new Map(plan.tasks.map((t) => [String(t.id).toUpperCase(), t]));
  plan.tasks = derived.map((t) => {
    const o = overrides.get(t.id.toUpperCase()) || {};
    const tunable = Object.fromEntries(Object.entries(o).filter(([k]) => TUNABLE.has(k)));
    return { ...t, ...tunable };
  });
}

function logPath() {
  return resolve(String(flags.log || resolve(path, '../../31-board-events.jsonl')));
}
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
