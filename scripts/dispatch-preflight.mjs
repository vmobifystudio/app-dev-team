#!/usr/bin/env node
/** Unified dispatch gate composing context, scheduling, capability, and risk checks. */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`dispatch-preflight: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['root', 'context', 'schedule', 'capability', 'risk', 'role', 'operation', 'path', 'file', 'change']), die });
for (const name of ['root', 'context', 'schedule', 'capability', 'risk', 'role', 'operation', 'path', 'file']) if (!flags[name]) die(2, `--${name} is required`);
const root = resolve(String(flags.root)); const here = dirname(fileURLToPath(import.meta.url));
function run(script, args) {
  try { return execFileSync(process.execPath, [resolve(here, script), ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) { const output = `${error.stdout || ''}${error.stderr || ''}`.trim(); die(typeof error.status === 'number' && error.status === 2 ? 2 : 1, `${script} failed:\n${output}`); }
}
const context = run('context-manifest.mjs', ['verify', '--root', root, '--manifest', resolve(root, String(flags.context))]);
const schedule = run('scheduler.mjs', ['--plan', resolve(root, String(flags.schedule))]);
const capability = run('capability-check.mjs', ['--manifest', resolve(root, String(flags.capability)), '--role', String(flags.role), '--operation', String(flags.operation), '--path', resolve(root, String(flags.path))]);
const risk = run('risk-router.mjs', ['--policy', resolve(root, String(flags.risk)), '--file', String(flags.file), '--change', String(flags.change || '')]);
console.log(JSON.stringify({ schema: 'dispatch-preflight/v1', status: 'CLEAR', role: flags.role, operation: flags.operation, context, schedule: JSON.parse(schedule), capability, risk: JSON.parse(risk) }, null, 2));
