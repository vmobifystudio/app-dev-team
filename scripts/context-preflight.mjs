#!/usr/bin/env node
/**
 * Verify the context an agent is about to act on, without changing the project.
 *
 *   context-preflight.mjs [<project-root>] [--ticket ID] [--role ROLE]
 *
 * C7-2 (Sprint 7): every IC and every reviewer is told to run this first, and it refused all of them —
 * a freshly leased slot is DETACHED (worktree-slot.mjs creates it so), the ticket was looked up in
 * docs/31-board.md (an operational view that exists only in the main checkout), and a reviewer in the
 * main checkout was "writing on protected branch main". So:
 *   - the ticket is read with `board.mjs show --json` from the MAIN project (the git common dir), which
 *     reads the event log wherever this runs from;
 *   - a detached HEAD inside an `.agent-wt/` slot is the expected state before step 0 (a NOTE);
 *   - being on the integration branch blocks only a WRITING role (one with a DONE contract); a
 *     reviewer, the orchestrator, and a run with no --role in the main checkout get a NOTE. With no
 *     --role inside a slot it is still a blocker: only a writer stands in a slot.
 * Exit: 0 CLEAR · 1 BLOCKED · 2 CANNOT EVALUATE (usage, or the root does not exist).
 */
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { contractFor } from './lib/contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const die = (code, message) => { console.error(`PREFLIGHT: CANNOT EVALUATE — ${message}`); process.exit(code); };
const { flags, positional } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['ticket', 'role']), knownFlags: new Set(['ticket', 'role']), die });
const root = resolve(positional[0] || '.');
const ticket = typeof flags.ticket === 'string' ? flags.ticket : '';
const role = typeof flags.role === 'string' ? flags.role : '';
const findings = [];
const notes = [];
const run = (command, argv, cwd = root) => { try { return execFileSync(command, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return ''; } };

if (!existsSync(root)) die(2, `project root does not exist: ${root}`);
const top = run('git', ['rev-parse', '--show-toplevel']);
if (!top) findings.push('not a Git worktree or Git could not be read');
const common = run('git', ['rev-parse', '--git-common-dir']);
const commonAbs = common ? resolve(root, common) : '';
const mainRoot = commonAbs && basename(commonAbs) === '.git' ? dirname(commonAbs) : (top || root);
const inSlot = Boolean(top) && `${resolve(top)}${sep}`.includes(`${sep}.agent-wt${sep}`);
const branch = run('git', ['branch', '--show-current']);
if (!branch && top) {
  if (inSlot) notes.push('detached HEAD in a leased slot — expected before step 0; create your ticket branch first');
  else findings.push('detached HEAD or branch name unavailable');
}
const integration = run('sh', [resolve(HERE, 'integration-branch.sh')], mainRoot);
const protectedBranches = new Set(['main', 'master', integration].filter(Boolean));
if (branch && protectedBranches.has(branch)) {
  const writer = role ? Boolean(contractFor(role)) : inSlot;
  if (writer) findings.push(`writing on protected branch ${branch} is not allowed — cut your ticket branch first`);
  else notes.push(`on ${branch} (the integration branch) — fine for ${role || 'a reader in the main checkout'}; a writing role must branch first`);
}
const dirty = run('git', ['status', '--porcelain']);
if (dirty) notes.push(`dirty tree: ${dirty.split('\n').length} path(s) already changed; preserve them`);
const worktrees = run('git', ['worktree', 'list', '--porcelain']);
if (worktrees) notes.push(`active worktrees: ${worktrees.split('\n\n').filter(Boolean).length}`);

if (ticket) {
  let out = '';
  try { out = execFileSync(process.execPath, [resolve(HERE, 'board.mjs'), 'show', '--json'], { cwd: mainRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = e.stdout || ''; }  // show exits 1 on violations but still prints the board
  let rows = null;
  try { rows = JSON.parse(out).tickets || {}; } catch { findings.push(`ticket ${ticket} requested but the board could not be read in ${mainRoot} (board.mjs show --json)`); }
  const row = rows && rows[ticket.toUpperCase()];
  if (rows && !row) findings.push(`ticket ${ticket} is not on the board (${mainRoot})`);
  else if (row) notes.push(`ticket ${row.id}: ${row.status} · owner ${row.owner || '—'} · ${String(row.title || '').slice(0, 120)}`);
}
for (const file of ['docs/20-architecture.md', 'docs/21-engineering-principles.md', 'docs/23-git-strategy.md']) {
  if (!existsSync(join(root, file))) notes.push(`context document not present: ${file}`);
}
const verdict = findings.length ? 'BLOCKED' : 'CLEAR';
console.log(`PREFLIGHT: ${verdict}`);
console.log(`  root: ${root}`);
if (mainRoot !== root) console.log(`  main project: ${mainRoot}`);
console.log(`  branch: ${branch || '(detached)'}`);
console.log(`  git: ${top ? 'readable' : 'unavailable'}`);
for (const item of findings) console.log(`  BLOCKER: ${item}`);
for (const item of notes) console.log(`  NOTE: ${item}`);
if (findings.length) process.exit(1);
