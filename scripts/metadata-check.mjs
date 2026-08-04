#!/usr/bin/env node
/**
 * Validate the public plugin metadata against the files that actually ship.
 *
 * A marketplace entry that advertises an older version or a smaller team is not cosmetic drift:
 * it can cause an operator to install the wrong release or trust a capability that is not present.
 * Keep this check dependency-free so CI and a local release audit use the same evidence.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const fail = (message) => {
  process.stderr.write(`METADATA: FAIL — ${message}\n`);
  process.exitCode = 1;
};

function json(path) {
  try {
    return JSON.parse(read(path));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
    return null;
  }
}

const plugin = json('.claude-plugin/plugin.json');
const marketplace = json('.claude-plugin/marketplace.json');
if (!plugin || !marketplace) process.exit(1);

const entry = marketplace.plugins?.find((item) => item.name === plugin.name);
if (!entry) fail(`marketplace has no plugin entry named ${plugin.name}`);

const count = (directory, suffix) =>
  readdirSync(join(ROOT, directory)).filter((name) => name.endsWith(suffix)).length;

const roles = count('agents', '.md');
const skills = readdirSync(join(ROOT, 'skills')).filter((name) => existsSync(join(ROOT, 'skills', name, 'SKILL.md'))).length;
const commands = count('commands', '.md');

if (entry) {
  if (entry.version !== plugin.version) fail(`marketplace version ${entry.version} != plugin version ${plugin.version}`);
  if (!String(entry.description || '').includes(`${roles}-role`)) {
    fail(`marketplace description does not advertise the current role count (${roles})`);
  }
}

// EVERY manifest, not just the marketplace. This checked the marketplace description, the README and
// the CHANGELOG — and never `plugin.json`'s own description, which is the one the installer shows.
// So the plugin advertised "29 role agents" while shipping 30 and this script printed CLEAR: a
// metadata checker that skips a manifest is a checker whose green means "the files I happened to
// read agree". Post-enhancement audit F-07, verified in the tree before this fix.
if (!String(plugin.description || '').includes(`${roles} role`)) {
  fail(`plugin.json description does not advertise the current role count (${roles})`);
}

// The boundary this whole system is built around must not be contradicted by its own shop window.
// "takes an idea to a shipped app" reads as store publishing; the pipeline stops at submission-ready
// and publishing is human-owned (docs/03-decision-rights.md). An overclaim here is the one piece of
// drift a user sees before they install anything.
for (const [label, text] of [['plugin.json', plugin.description], ['marketplace entry', entry?.description]]) {
  if (!text) continue;
  if (/\bto a shipped\b/i.test(text)) {
    fail(`${label} description claims it takes an idea "to a shipped app" — the pipeline stops at submission-ready and publishing is human-owned`);
  }
}

const readme = read('README.md');
const badge = readme.match(/version-([0-9]+\.[0-9]+\.[0-9]+)-blue/);
if (!badge || badge[1] !== plugin.version) fail(`README version badge ${badge?.[1] || '(missing)'} != ${plugin.version}`);
if (!new RegExp(`team\\*?\\s+of ${roles} AI specialists`).test(readme)) {
  fail(`README does not advertise the current role count (${roles})`);
}

const changelog = read('CHANGELOG.md');
if (!new RegExp(`^## \\[${plugin.version.replaceAll('.', '\\.') }\\]`, 'm').test(changelog)) {
  fail(`CHANGELOG has no top-level entry for ${plugin.version}`);
}

if (process.exitCode) process.exit(1);
process.stdout.write(`METADATA: CLEAR — ${plugin.name} ${plugin.version}; ${roles} roles, ${skills} skills, ${commands} commands\n`);
