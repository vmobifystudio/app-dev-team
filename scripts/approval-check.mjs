#!/usr/bin/env node
/** Validate that approvals are bound to the exact evidence they claim to approve. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { checkApprovals } from './lib/approval.mjs';

const die = (code, message) => { process.stderr.write(`approval-check: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['log', 'policy', 'head', 'base', 'ticket']), die });
const logPath = resolve(String(flags.log || 'docs/31-board-events.jsonl'));
const policyPath = resolve(String(flags.policy || '.studio-policy.json'));
if (!existsSync(policyPath)) { console.log('APPROVAL CHECK: NOT REQUIRED — no .studio-policy.json'); process.exit(0); }
let policy; try { policy = JSON.parse(readFileSync(policyPath, 'utf8')); } catch (e) { die(2, `cannot read policy: ${e.message}`); }
if (!policy.requireApprovalBinding) { console.log('APPROVAL CHECK: NOT REQUIRED — strict binding is disabled'); process.exit(0); }
if (!existsSync(logPath)) die(2, `no event log at ${logPath}`);
let events; try { events = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch (e) { die(2, `cannot parse event log: ${e.message}`); }
// --ticket scopes the check to ONE ticket. The merge gate runs this per ticket with --head at that
// ticket's branch tip; checking every approval in the log against one feature branch made each
// OTHER ticket's (correct) approval read as "not an ancestor" and blocked every merge.
// The logic lives in lib/approval.mjs because `board.mjs move <T> merged` runs the same check.
const { counted, superseded, issues } = checkApprovals(events, {
  ticket: flags.ticket ? String(flags.ticket) : '',
  head: flags.head ? String(flags.head) : '',
});
if (!counted.length) { console.log('APPROVAL CHECK: CLEAR — no approvals require binding'); process.exit(0); }
if (issues.length) { issues.forEach((issue) => console.error(`approval-check: ${issue}`)); process.exit(1); }
console.log(`APPROVAL CHECK: CLEAR — ${counted.length} approval(s) are evidence-bound${superseded ? ` (${superseded} superseded by a later approval from the same role, ignored)` : ''}`);
