#!/usr/bin/env node
/** Require changed surfaces to declare their downstream consumers. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`impact-map: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['map', 'file', 'consumer']), die });
const path = resolve(String(flags.map || 'docs/team/impact-map.json'));
if (!existsSync(path)) die(2, `no impact map at ${path}`);
let map; try { map = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die(2, e.message); }
if (map.schema !== 'impact-map/v1' || !Array.isArray(map.rules)) die(2, 'map must use schema impact-map/v1 with rules');
const files = flags.file ? String(flags.file).split(',').map((file) => file.trim()).filter(Boolean) : [];
if (!files.length) die(2, '--file is required');
const missing = [];
for (const file of files) {
  const matches = map.rules.filter((rule) => new RegExp(rule.pattern).test(file));
  if (!matches.length) missing.push(`${file}: no impact rule`);
  for (const rule of matches) if (!rule.consumers?.length) missing.push(`${file}: impact rule has no consumers`);
}
if (missing.length) { missing.forEach((item) => console.error(`impact-map: ${item}`)); process.exit(1); }
console.log(`IMPACT MAP: CLEAR — ${files.length} changed file(s) have declared consumers`);
