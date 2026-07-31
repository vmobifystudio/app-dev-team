#!/usr/bin/env node
/** A deterministic SwiftUI accessibility tripwire, not a replacement for VoiceOver testing. */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const die = (message) => { process.stderr.write(`accessibility-scan: ${message}\n`); process.exit(2); };
const roots = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (!roots.length) die('needs at least one Swift file or directory');
if (!roots.some((path) => existsSync(path))) die('none of the supplied paths exist');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'Pods', 'build', 'DerivedData', 'dist', '.gradle', '.agent-wt']);

function files(path, out = []) {
  let info;
  try { info = lstatSync(path); } catch { return out; }
  if (info.isSymbolicLink()) return out;
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (!SKIP_DIRS.has(name)) files(join(path, name), out);
    }
  } else if (path.endsWith('.swift')) out.push(path);
  return out;
}

function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '');
}

const findings = [];
for (const path of roots.flatMap((root) => files(root))) {
  const lines = withoutComments(readFileSync(path, 'utf8')).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/\bButton\s*\(/.test(lines[i])) continue;
    const block = lines.slice(i, Math.min(lines.length, i + 18)).join('\n');
    if (/Image\s*\(/.test(block) && /frame\s*\(\s*width\s*:\s*(?:2[0-9]|3[0-9]|4[0-3])\b/.test(block) && !/accessibilityLabel/.test(block)) {
      findings.push({ path, line: i + 1, kind: 'icon-button-too-small-and-unlabelled' });
    }
  }
}

if (!findings.length) {
  process.stdout.write(`ACCESSIBILITY SCAN: CLEAR — ${roots.length} target(s), no high-confidence finding\n`);
  process.exit(0);
}
process.stdout.write(`ACCESSIBILITY SCAN: ${findings.length} finding(s)\n`);
for (const finding of findings) process.stdout.write(`  ${finding.path}:${finding.line} [${finding.kind}]\n`);
process.exit(1);
