#!/usr/bin/env node
/** Verify the context an agent is about to act on, without changing the project. */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const root = resolve(args.find((a) => !a.startsWith('--')) || '.');
const ticket = args.find((a, i) => a === '--ticket' && args[i + 1]) ? args[args.indexOf('--ticket') + 1] : '';
const findings = [];
const notes = [];
const run = (command, argv) => { try { return execFileSync(command, argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return ''; } };

if (!existsSync(root)) {
  console.error(`PREFLIGHT: CANNOT EVALUATE — project root does not exist: ${root}`);
  process.exit(2);
}
const top = run('git', ['rev-parse', '--show-toplevel']);
if (!top) findings.push('not a Git worktree or Git could not be read');
const branch = run('git', ['branch', '--show-current']);
if (!branch) findings.push('detached HEAD or branch name unavailable');
if (branch === 'main' || branch === 'master') findings.push(`writing on protected branch ${branch} is not allowed`);
const dirty = run('git', ['status', '--porcelain']);
if (dirty) notes.push(`dirty tree: ${dirty.split('\n').length} path(s) already changed; preserve them`);
const worktrees = run('git', ['worktree', 'list', '--porcelain']);
if (worktrees) notes.push(`active worktrees: ${worktrees.split('\n\n').filter(Boolean).length}`);

const board = join(root, 'docs/31-board.md');
if (ticket) {
  if (!existsSync(board)) findings.push(`ticket ${ticket} requested but docs/31-board.md is missing`);
  else {
    const row = readFileSync(board, 'utf8').split(/\r?\n/).find((line) => new RegExp(`\\b${ticket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(line));
    if (!row) findings.push(`ticket ${ticket} has no discoverable board row`);
    else notes.push(`ticket row found: ${row.trim().slice(0, 180)}`);
  }
}
for (const file of ['docs/20-architecture.md', 'docs/21-engineering-principles.md', 'docs/23-git-strategy.md']) {
  if (!existsSync(join(root, file))) notes.push(`context document not present: ${file}`);
}
const verdict = findings.length ? 'BLOCKED' : 'CLEAR';
console.log(`PREFLIGHT: ${verdict}`);
console.log(`  root: ${root}`);
console.log(`  branch: ${branch || '(unknown)'}`);
console.log(`  git: ${top ? 'readable' : 'unavailable'}`);
for (const item of findings) console.log(`  BLOCKER: ${item}`);
for (const item of notes) console.log(`  NOTE: ${item}`);
if (findings.length) process.exit(1);
