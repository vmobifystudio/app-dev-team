#!/usr/bin/env node
/** Minimal deterministic evaluation runner for role, policy, and workflow fixtures. */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`eval-lab: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['manifest']), die });
const path = resolve(String(flags.manifest || 'eval/manifest.json'));
if (!existsSync(path)) die(2, `no evaluation manifest at ${path}`);
let manifest; try { manifest = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die(2, `invalid manifest: ${e.message}`); }
if (manifest.schema !== 'eval-manifest/v1' || !Array.isArray(manifest.cases)) die(2, 'manifest must use schema eval-manifest/v1 with cases');
let failed = 0;
for (const test of manifest.cases) {
  if (!test.id || !Array.isArray(test.command)) die(2, 'each case needs id and command array');
  let output = ''; let code = 0;
  try { output = execFileSync(test.command[0], test.command.slice(1), { cwd: resolve(String(test.cwd || '.')), encoding: 'utf8', stderr: 'pipe' }); }
  catch (error) { code = typeof error.status === 'number' ? error.status : 2; output = `${error.stdout || ''}${error.stderr || ''}`; }
  const expected = Number(test.expect_exit ?? 0); const missing = (test.must_contain || []).filter((needle) => !output.includes(needle));
  const pass = code === expected && missing.length === 0;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${test.id}${pass ? '' : ` (exit ${code}, expected ${expected}${missing.length ? `; missing ${missing.join(', ')}` : ''})`}`);
  if (!pass) failed += 1;
}
console.log(`EVAL LAB: ${failed ? 'FAIL' : 'PASS'} — ${manifest.cases.length - failed}/${manifest.cases.length} case(s)`);
process.exit(failed ? 1 : 0);
