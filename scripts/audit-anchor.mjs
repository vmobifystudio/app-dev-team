#!/usr/bin/env node
/** Release-time anchor for the append-only board log. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`audit-anchor: ${message}\n`); process.exit(code); };
const { flags, positional } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['log', 'out']), die });
const command = positional[0] || 'verify';
const log = resolve(String(flags.log || 'docs/31-board-events.jsonl'));
const out = resolve(String(flags.out || 'docs/team/audit-anchor.json'));
if (!existsSync(log)) die(2, `no event log at ${log}`);
const bytes = readFileSync(log);
const digest = createHash('sha256').update(bytes).digest('hex');
const tip = bytes.toString('utf8').trim().split('\n').filter(Boolean).at(-1);
let head = null; try { head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* non-git fixture */ }
if (command === 'create') {
  writeFileSync(out, `${JSON.stringify({ schema: 'audit-anchor/v1', created_at: new Date().toISOString(), log, log_sha256: digest, line_count: bytes.toString('utf8').split('\n').filter(Boolean).length, tip_hash: tip ? JSON.parse(tip).hash : null, git_head: head }, null, 2)}\n`);
  console.log(`AUDIT ANCHOR: CREATED — ${out}`);
} else if (command === 'verify') {
  if (!existsSync(out)) die(2, `no anchor at ${out}`);
  let anchor; try { anchor = JSON.parse(readFileSync(out, 'utf8')); } catch (e) { die(2, e.message); }
  const currentTip = tip ? JSON.parse(tip).hash : null;
  if (anchor.log_sha256 !== digest || anchor.tip_hash !== currentTip) die(1, 'audit anchor does not match the current event log');
  console.log(`AUDIT ANCHOR: INTACT — ${anchor.line_count} line(s), tip ${currentTip || 'empty'}`);
} else die(2, `unknown command ${command}; use create or verify`);
