#!/usr/bin/env node
/** Dependency declaration/lockfile/toolchain tripwire. Network lookups remain a separate CI concern. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const root = resolve(process.argv[2] || '.');
if (!existsSync(root)) { console.error('DEPENDENCIES: CANNOT EVALUATE — project root is missing'); process.exit(2); }
const blockers = [];
const notes = [];
const files = (dir, depth = 0) => {
  if (depth > 3 || !existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (['.git', 'node_modules', 'Pods', 'build', 'dist', '.gradle'].includes(name)) continue;
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    try {
      if (statSync(path).isDirectory()) out.push(...files(path, depth + 1));
      else out.push(path);
    } catch { /* unreadable path is reported by the relevant manifest check */ }
  }
  return out;
};
const has = (name) => existsSync(join(root, name));
const packageFiles = files(root).filter((p) => /package\.json$/.test(p));
for (const manifest of packageFiles) {
  const rel = relative(root, manifest);
  let json;
  try { json = JSON.parse(readFileSync(manifest, 'utf8')); } catch { blockers.push(`${rel} is invalid JSON`); continue; }
  const dir = manifest.slice(0, -'package.json'.length);
  const locks = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'].filter((f) => existsSync(join(dir, f)));
  if (Object.keys({ ...(json.dependencies || {}), ...(json.devDependencies || {}) }).length && !locks.length) blockers.push(`${rel} declares dependencies but no lockfile exists`);
  for (const [name, version] of Object.entries({ ...(json.dependencies || {}), ...(json.devDependencies || {}) })) {
    if (/^(latest|\*|next|git\+|https?:)/i.test(String(version))) blockers.push(`${rel}: ${name} uses a non-reproducible version ${version}`);
  }
}
if (has('Podfile') && !has('Podfile.lock')) blockers.push('Podfile exists without Podfile.lock');
if (has('Package.swift') && !has('Package.resolved') && has('Package.resolved') === false) notes.push('Swift package has no Package.resolved; pinning may be intentional for a library');
if ((has('build.gradle') || has('build.gradle.kts') || has('settings.gradle') || has('settings.gradle.kts')) && !has('gradle/libs.versions.toml')) notes.push('Gradle project has no central libs.versions.toml; confirm versions are governed elsewhere');
for (const required of ['docs/20-architecture.md', 'docs/21-engineering-principles.md']) if (has(required) === false) notes.push(`no ${required} to compare dependency policy against`);
console.log(`DEPENDENCIES: ${blockers.length ? 'BLOCKED' : 'CLEAR'}`);
for (const item of blockers) console.log(`  BLOCKER: ${item}`);
for (const item of notes) console.log(`  NOTE: ${item}`);
if (blockers.length) process.exit(1);
