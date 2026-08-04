#!/usr/bin/env node
/**
 * contention-check — will dispatching this ticket collide with work already in flight?
 *
 * THE FAILURE IT PREVENTS. The scheduler picks ready tickets by dependency order and owner
 * availability. It has never looked at WHICH FILES the work touches, so two agents can be
 * dispatched onto the same file in the same wave. Both branch from the same base, both edit it,
 * and the collision surfaces later as a merge conflict — or, worse, as a silent lost edit when one
 * side resolves by taking its own version.
 *
 * `eval/shared-file-collision` has existed as a golden fixture for exactly this and had no detector.
 *
 * WHY IT COMES AFTER THE ATOMIC KERNEL, NOT BEFORE. Contention control on top of a racy append
 * would be a lock built on sand: the check would pass, two writers would still interleave, and the
 * resulting corruption would look like a contention bug rather than the append bug it really was.
 * The audit was explicit about the ordering and it was right.
 *
 * WHAT COUNTS AS "IN FLIGHT" is deliberately generous: anything claimed and not yet merged. A
 * ticket in review still owns its files, because changes-requested sends it straight back to
 * editing them.
 *
 * Exit codes:
 *   0  clear — no overlap with in-flight work
 *   1  contended — dispatching this would put two agents in the same files
 *   2  cannot evaluate — no log, or this ticket declares no files
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { parseEventLog, reduce } from './lib/events.mjs';

const die = (code, message) => { process.stderr.write(`contention-check: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['log', 'ticket', 'file']), die });

const logPath = resolve(String(flags.log || 'docs/31-board-events.jsonl'));
const ticket = String(flags.ticket || '').toUpperCase();
if (!ticket) die(2, '--ticket is required');
if (!existsSync(logPath)) die(2, `no event log at ${logPath}`);

let tickets;
try { tickets = reduce(parseEventLog(readFileSync(logPath, 'utf8')).events).tickets; }
catch (e) { die(2, `cannot read the event log: ${e.message}`); }

/** Files a ticket touches: whatever it declared at creation, plus whatever its approval recorded. */
function filesOf(state) {
  const out = new Set();
  const declared = state?.meta?.files;
  if (Array.isArray(declared)) declared.forEach((f) => out.add(String(f)));
  for (const e of state?.events || []) {
    const d = typeof e.detail === 'object' ? e.detail : null;
    if (Array.isArray(d?.files)) d.files.forEach((f) => out.add(String(f)));
  }
  return out;
}

const mine = new Set([
  ...filesOf(tickets.get(ticket)),
  ...String(flags.file || '').split(',').map((f) => f.trim()).filter(Boolean),
]);

if (!mine.size) {
  // NOT a pass. A ticket that declares no files is one this check cannot reason about, and saying
  // "clear" would turn silence into a guarantee — the shape of every fail-open gate in this repo's
  // history.
  process.stdout.write(
    `CONTENTION: CANNOT EVALUATE — ${ticket} declares no files (no --file at creation, none recorded on its events).\n` +
    '  Nothing states what this work touches, so nothing could be compared. This is not a clearance.\n'
  );
  process.exit(2);
}

const IN_FLIGHT = new Set(['in_progress', 'review']);
const clashes = [];
for (const [id, state] of tickets) {
  if (id === ticket) continue;
  if (!IN_FLIGHT.has(state.status)) continue;
  const overlap = [...filesOf(state)].filter((f) => mine.has(f));
  if (overlap.length) clashes.push({ id: state.id || id, owner: state.owner || 'unassigned', status: state.status, overlap });
}

if (!clashes.length) {
  process.stdout.write(`CONTENTION: CLEAR — ${ticket} touches ${mine.size} file(s), none held by in-flight work.\n`);
  process.exit(0);
}

process.stdout.write(`CONTENTION: BLOCKED — ${ticket} overlaps work already in flight.\n`);
for (const c of clashes) {
  process.stdout.write(`  ${c.id} (${c.status}, ${c.owner}) also touches: ${c.overlap.join(', ')}\n`);
}
process.stdout.write(
  '\n  Dispatching both puts two agents in the same files. Either wait for the in-flight ticket to\n' +
  '  merge, or split the work so the file sets are disjoint. A merge conflict found here is cheap;\n' +
  '  found at integration it costs a wave, and a silently lost edit costs more than that.\n'
);
process.exit(1);
