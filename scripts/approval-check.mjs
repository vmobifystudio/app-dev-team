#!/usr/bin/env node
/** Validate that approvals are bound to the exact evidence they claim to approve. */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`approval-check: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['log', 'policy', 'head']), die });
const logPath = resolve(String(flags.log || 'docs/31-board-events.jsonl'));
const policyPath = resolve(String(flags.policy || '.studio-policy.json'));
if (!existsSync(policyPath)) { console.log('APPROVAL CHECK: NOT REQUIRED — no .studio-policy.json'); process.exit(0); }
let policy; try { policy = JSON.parse(readFileSync(policyPath, 'utf8')); } catch (e) { die(2, `cannot read policy: ${e.message}`); }
if (!policy.requireApprovalBinding) { console.log('APPROVAL CHECK: NOT REQUIRED — strict binding is disabled'); process.exit(0); }
if (!existsSync(logPath)) die(2, `no event log at ${logPath}`);
let events; try { events = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch (e) { die(2, `cannot parse event log: ${e.message}`); }
const approvals = events.filter((event) => event.event === 'approved');
if (!approvals.length) { console.log('APPROVAL CHECK: CLEAR — no approvals require binding'); process.exit(0); }
const issues = [];
function git(args) { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }
for (const event of approvals) {
  let detail = event.detail;
  if (typeof detail === 'string') { try { detail = JSON.parse(detail); } catch { detail = null; } }
  const ticket = event.ticket || 'unknown-ticket';
  for (const field of ['commit', 'diff_hash', 'context_snapshot', 'evidence_hash']) if (!detail?.[field]) issues.push(`${ticket}: approved event is missing detail.${field}`);
  if (!detail?.commit) continue;
  if (!git(['cat-file', '-e', `${detail.commit}^{commit}`])) issues.push(`${ticket}: approval commit does not exist: ${detail.commit}`);
  if (flags.head && detail.commit !== flags.head && !git(['merge-base', '--is-ancestor', detail.commit, String(flags.head)])) issues.push(`${ticket}: approval commit ${detail.commit} is not an ancestor of ${flags.head}`);
  const diff = git(['diff', `${detail.commit}^`, detail.commit, '--binary']);
  if (diff !== null) {
    const actual = createHash('sha256').update(diff).digest('hex');
    if (actual !== detail.diff_hash) issues.push(`${ticket}: diff_hash does not match approval commit ${detail.commit}`);
  }
}
if (issues.length) { issues.forEach((issue) => console.error(`approval-check: ${issue}`)); process.exit(1); }
console.log(`APPROVAL CHECK: CLEAR — ${approvals.length} approval(s) are evidence-bound`);
