#!/usr/bin/env node
/** Validate that approvals are bound to the exact evidence they claim to approve. */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`approval-check: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['log', 'policy', 'head', 'base']), die });
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
// `cat-file -e` and `merge-base --is-ancestor` are silent on SUCCESS — their stdout is '', which is
// falsy in JS. Using `git()`'s return value as a truthy pass/fail made every commit read as missing
// and every ancestor check read as failed, whether or not it was — an assertion that could not pass
// is an assertion that cannot fail either, the exact defect class this repo tracks (FC-002). These
// two calls only ever mean "did the process exit 0", so they check that, not the printed text.
function gitOk(args) { try { execFileSync('git', args, { stdio: 'ignore' }); return true; } catch { return false; } }
for (const event of approvals) {
  let detail = event.detail;
  if (typeof detail === 'string') { try { detail = JSON.parse(detail); } catch { detail = null; } }
  const ticket = event.ticket || 'unknown-ticket';
  for (const field of ['commit', 'diff_hash', 'context_snapshot', 'evidence_hash']) if (!detail?.[field]) issues.push(`${ticket}: approved event is missing detail.${field}`);
  if (!detail?.commit) continue;
  if (!gitOk(['cat-file', '-e', `${detail.commit}^{commit}`])) issues.push(`${ticket}: approval commit does not exist: ${detail.commit}`);
  if (flags.head && detail.commit !== flags.head && !gitOk(['merge-base', '--is-ancestor', detail.commit, String(flags.head)])) issues.push(`${ticket}: approval commit ${detail.commit} is not an ancestor of ${flags.head}`);
  // VERIFY THE CANDIDATE THE APPROVAL NAMED, NOT ITS LAST COMMIT. This recomputed
  // `${commit}^..${commit}` regardless of what was approved, so a multi-commit branch's approval was
  // re-verified against one commit — the check agreed with the narrow subject it should have been
  // catching. Legacy approvals carry no `base`; they are verified the old way AND reported, because
  // silently accepting them would let the weaker binding persist unnoticed.
  const base = detail.base || null;
  if (!base) {
    issues.push(`${ticket}: approval names no base — it binds the single commit ${detail.commit}, so any earlier commit on the branch is unapproved. Re-bind with --bind (or --base <sha>).`);
  }
  const diff = git(['diff', base || `${detail.commit}^`, detail.commit, '--binary']);
  if (diff !== null) {
    const actual = createHash('sha256').update(diff).digest('hex');
    if (actual !== detail.diff_hash) issues.push(`${ticket}: diff_hash does not match ${base || `${detail.commit}^`}..${detail.commit} — the approved change is not the change on disk`);
  }
  // The file manifest is what makes the blast radius readable. A mismatch means files entered or
  // left the candidate after it was approved.
  if (Array.isArray(detail.files) && base) {
    const now = git(['diff', '--name-only', base, detail.commit]);
    if (now !== null) {
      const actual = now.split('\n').filter(Boolean);
      const added = actual.filter((f) => !detail.files.includes(f));
      const gone = detail.files.filter((f) => !actual.includes(f));
      if (added.length || gone.length) {
        issues.push(`${ticket}: the approved file set no longer matches${added.length ? ` (now also touches: ${added.join(', ')})` : ''}${gone.length ? ` (no longer touches: ${gone.join(', ')})` : ''}`);
      }
    }
  }
}
if (issues.length) { issues.forEach((issue) => console.error(`approval-check: ${issue}`)); process.exit(1); }
console.log(`APPROVAL CHECK: CLEAR — ${approvals.length} approval(s) are evidence-bound`);
