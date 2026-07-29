#!/usr/bin/env node
/**
 * team-doctor — validate the plugin itself.
 *
 * The board doctor checks a project's board. Nothing checked the *team definition*, and that is
 * where the expensive gaps live, because they are invisible by construction:
 *
 *   - a role that can own a ticket but that /app-build never spawns  -> the ticket is never picked
 *     up, never blocked, never reported, and the loop prints a successful sprint
 *   - a doc one role writes that no role ever reads                  -> a handoff into a void
 *   - a skill an agent is told to invoke that does not exist         -> a silently skipped rule
 *   - a handoff target that is not a real role                       -> a dropped baton
 *
 * Each of these was a live defect found by hand once. This is the rule that stops them coming back.
 *
 * Usage:  node scripts/team-doctor.mjs [--json]
 * Exit:   0 clean (warnings allowed) · 1 findings · 2 not a plugin root
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

import { BUILD_SPAWNABLE_OWNERS } from './lib/board.mjs';

const ROOT = process.cwd();
const findings = [];
const warnings = [];
const add = (list, code, where, detail, action) => list.push({ code, where, detail, action });

// --- load ---------------------------------------------------------------------------------------

function readAll(dir, pattern = /\.md$/) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...readAll(p, pattern));
    else if (pattern.test(entry)) out.push({ path: p, rel: p.replace(`${ROOT}/`, ''), text: readFileSync(p, 'utf8') });
  }
  return out;
}

const agents = readAll(join(ROOT, 'agents'));
const commands = readAll(join(ROOT, 'commands'));
const skills = readAll(join(ROOT, 'skills'));

if (agents.length === 0 || commands.length === 0) {
  process.stderr.write('team-doctor: run me from the plugin root (agents/ and commands/ not found).\n');
  process.exit(2);
}

const frontmatterName = (text, fallback) => (text.match(/^name:\s*(.+)$/m) || [, fallback])[1].trim();

const roles = new Map(agents.map((a) => [frontmatterName(a.text, basename(a.path, '.md')), a]));
const skillNames = new Set(skills.map((s) => frontmatterName(s.text, basename(dirname(s.path)))));
const roleNames = [...roles.keys()];

const appBuild = commands.find((c) => c.rel.endsWith('app-build.md'));
const appTeam = commands.find((c) => c.rel.endsWith('app-team.md'));

// --- 1. every role is reachable -------------------------------------------------------------------

for (const role of roleNames) {
  const referenced = [...agents, ...commands, ...skills].some(
    (f) => !f.rel.endsWith(`agents/${role}.md`) && new RegExp(`\\b${role}\\b`).test(f.text)
  );
  if (!referenced) {
    add(findings, 'role_unreachable', `agents/${role}.md`,
      `Role "${role}" is defined but no command, agent, or skill ever references it. It can never run.`,
      'Wire it into a command, or delete the role.');
  }
  if (appTeam && !new RegExp(`\\b${role}\\b`).test(appTeam.text)) {
    add(warnings, 'role_not_in_roster', 'commands/app-team.md',
      `Role "${role}" is missing from the /app-team roster, so users cannot discover it.`,
      'Add it to the roster listing.');
  }
}

// --- 2. every ticket-owning role is spawnable by /app-build ---------------------------------------

if (appBuild) {
  for (const owner of BUILD_SPAWNABLE_OWNERS) {
    if (!roles.has(owner)) {
      add(findings, 'spawnable_owner_missing', 'scripts/lib/board.mjs',
        `BUILD_SPAWNABLE_OWNERS lists "${owner}" but there is no agents/${owner}.md.`,
        'Add the agent, or remove it from BUILD_SPAWNABLE_OWNERS.');
      continue;
    }
    if (!new RegExp(`\\b${owner}\\b`).test(appBuild.text)) {
      add(findings, 'owner_never_spawned', 'commands/app-build.md',
        `"${owner}" may own a ticket (BUILD_SPAWNABLE_OWNERS) but /app-build never names it. A ticket owned by it is never picked up, never blocked, and never reported — the loop drains around it and prints a successful sprint.`,
        'Name it in /app-build step 2, or remove it from BUILD_SPAWNABLE_OWNERS.');
    }
  }
}

// NOT CHECKED: a second copy of the spawnable-owner roster in another command. commands/app-audit.md
// carried one and it drifted to 8 of 10 (dropping ux-designer and qa-engineer) without this script
// noticing, because the check above reads app-build.md alone. Every mechanical rule tried here —
// "names N of the owners but not all" — fires on /app-ship, /app-run and /app-audit, which name the
// three or four roles they actually spawn and are not rosters at all. A check with a 3-in-3
// false-positive rate gets switched off, so the duplicate stays a review question, not a gate.

// --- 2b. ticket-working roles share one output contract ---------------------------------------------
// /app-build's gates parse these fields. A role missing one is a role every gate silently skips:
// backend-developer and monetization-engineer were two releases behind, so worktree isolation, the
// daily fragment, the assumptions-vs-ledger check and the shared-surface check did nothing at all
// for backend and billing tickets — the highest-risk code in the system.

// Two tiers, because the hazard differs. Roles that write source or repository config need branch
// and worktree discipline; roles that produce a uniquely-named document do not, but still owe the
// orchestrator the fields its gates read. Five of the ten spawnable owners had NO output contract
// at all, so /app-build got free-form prose back and every gate no-opped.
const CODE_CONTRACT = [
  'Worktree:',
  'Mutation confirmed:',
  'Daily fragment:',
  'Assumptions & open questions:',
  'Second-path check:',
  'Shared surfaces touched:',
];
const ARTIFACT_CONTRACT = ['Worktree:', 'Daily fragment:', 'Assumptions & open questions:'];

// Anything writing source or repo config (CI, signing, build flavors) is a code role.
const CODE_ROLES = [
  'ios-developer',
  'android-developer',
  'backend-developer',
  'monetization-engineer',
  'devops-engineer',
];
const ARTIFACT_ROLES = ['ux-designer', 'qa-engineer', 'data-analyst', 'aso-specialist'];

for (const [list, fields, tier] of [
  [CODE_ROLES, CODE_CONTRACT, 'code'],
  [ARTIFACT_ROLES, ARTIFACT_CONTRACT, 'artifact'],
]) {
  for (const role of list) {
    const agent = roles.get(role);
    if (!agent) continue;
    const missing = fields.filter((f) => !agent.text.includes(f));
    if (missing.length > 0) {
      add(findings, 'contract_drift', agent.rel,
        `Output contract is missing ${missing.length} field(s) required of a ${tier}-tier ticket owner: ${missing.join(' ')} — every /app-build gate that reads them silently does nothing for this role's tickets.`,
        `Bring it to parity with the other ${tier}-tier roles.`);
    }
  }
}

// Every spawnable owner must be in exactly one tier, or a new role slips through uncovered.
for (const owner of BUILD_SPAWNABLE_OWNERS) {
  if (owner === 'verification-engineer') continue; // returns a VERIFICATION verdict, not a DONE
  if (!CODE_ROLES.includes(owner) && !ARTIFACT_ROLES.includes(owner)) {
    add(findings, 'contract_tier_missing', 'scripts/team-doctor.mjs',
      `"${owner}" can own a ticket but belongs to neither contract tier, so nothing checks what it reports.`,
      'Add it to CODE_ROLES (writes source or repo config) or ARTIFACT_ROLES (writes a document).');
  }
}

// --- 3. every referenced skill exists --------------------------------------------------------------

/**
 * Skills this plugin legitimately borrows from OTHER installed plugins. They have no
 * skills/<name>/SKILL.md here and never will, so they are not findings.
 *
 * Namespaced references (`plugin:skill`) are self-evidently external and skipped outright; this
 * list exists for the bare names, which are how the agents actually cite them today.
 */
const EXTERNAL_SKILL_PREFIXES = ['axiom-', 'superpowers:', 'ui-design:'];
const EXTERNAL_SKILLS = new Set([
  'ui-design',
  'ui-ux-pro-max',
  'aso-screenshots',
  'admob-android-integration',
  'material-3-expressive',
  'deep-app-audit',
  'mobile-ios-design',
  'mobile-android-design',
  'frontend-design',
  'skill-creator',
]);
const isExternalSkill = (name) =>
  name.includes(':') || EXTERNAL_SKILLS.has(name) || EXTERNAL_SKILL_PREFIXES.some((p) => name.startsWith(p));

/**
 * Two arms, because they carry different confidence.
 *
 * Strong: the prose says "skill" or "invoke", so an unknown name is a broken reference.
 * Weak: a backticked name followed by an arrow. That form is also how this codebase writes
 *   plain vocabulary — `critical`/`high` → stop — so it additionally requires a hyphenated,
 *   skill-shaped name. Without that, `high` was reported as a missing skill.
 *
 * Case-sensitive on purpose. The old pattern carried /i, so `APPROVED` → , `DONE` → and
 * `REJECTED` → all matched as "skill names"; skill names are lowercase kebab-case.
 */
const SKILL_REF = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`\s*(?:→|->)|`([a-z][a-z0-9-]{2,})`\s*skill|invoke[s]?\s+`([a-z][a-z0-9-]{2,})`|(?:use|using)\s+the\s+`([a-z][a-z0-9-]{2,})`\s+skill/g;

// This check was previously gated behind a hard-coded whitelist of eleven skill names — all of
// which existed — so it could report a missing skill only for a skill that was not missing. A rule
// that cannot fail is worse than no rule: it reads as coverage. Validate against skills/ itself.
for (const file of [...agents, ...commands]) {
  const seen = new Set();
  for (const m of file.text.matchAll(SKILL_REF)) {
    const name = (m[1] || m[2] || m[3] || m[4] || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (isExternalSkill(name) || roleNames.includes(name) || skillNames.has(name)) continue;
    add(findings, 'skill_missing', file.rel,
      `References skill \`${name}\`, which has no skills/${name}/SKILL.md and is not a known external plugin skill.`,
      `Create skills/${name}/SKILL.md, fix the reference, or add it to EXTERNAL_SKILLS in team-doctor if another plugin supplies it.`);
  }
}

// --- 4. handoff targets resolve --------------------------------------------------------------------

for (const agent of agents) {
  for (const m of agent.text.matchAll(/^- ([a-z][a-z0-9-]+):\s/gm)) {
    const target = m[1];
    if (!roles.has(target) && !/^(id|status|owner|note|why|kind|reason|need|scope|next)$/.test(target)) {
      add(warnings, 'handoff_unresolved', agent.rel,
        `Handoff names "${target}", which is not a role.`,
        'Point it at a real role, or reword so it does not read as a handoff.');
    }
  }
}

// --- 5. docs written but never read -----------------------------------------------------------------
// Terminal artifacts are deliverables for the human, not handoffs — they are allowed to be unread.

const TERMINAL_DOCS = new Set(['docs/32-board-view', 'docs/60-releases', 'docs/70-security-review',
  'docs/71-verification', 'docs/23-git-strategy', 'docs/15-aso', 'docs/50-test-plan']);

const docMentions = new Map();
for (const file of [...agents, ...commands, ...skills]) {
  for (const m of file.text.matchAll(/docs\/\d{2}-[a-z0-9-]+/g)) {
    const doc = m[0];
    if (!docMentions.has(doc)) docMentions.set(doc, new Set());
    docMentions.get(doc).add(file.rel);
  }
}
for (const [doc, refs] of docMentions) {
  if (TERMINAL_DOCS.has(doc)) continue;
  if (refs.size === 1) {
    add(warnings, 'doc_single_reference', [...refs][0],
      `${doc}.md is mentioned in exactly one file — it is written and never read, or read and never written.`,
      'Either wire a consumer/producer, or mark it a terminal deliverable in team-doctor.');
  }
}

// --- report ------------------------------------------------------------------------------------------

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ ok: findings.length === 0, roles: roleNames.length, skills: skillNames.size, findings, warnings }, null, 2)}\n`);
} else {
  const render = (title, items) => {
    if (!items.length) return;
    process.stdout.write(`\n${title}\n`);
    for (const i of items) {
      process.stdout.write(`  ${i.code}  (${i.where})\n     ${i.detail}\n     -> ${i.action}\n`);
    }
  };
  process.stdout.write(`TEAM DOCTOR — ${roleNames.length} roles, ${skillNames.size} skills, ${commands.length} commands`);
  render('\nFINDINGS (blocking):', findings);
  render('WARNINGS:', warnings);
  process.stdout.write(
    findings.length === 0
      ? `\n\nTeam definition is coherent.${warnings.length ? ` ${warnings.length} warning(s).` : ''}\n`
      : `\n\n${findings.length} finding(s). Fix before release.\n`
  );
}

process.exit(findings.length > 0 ? 1 : 0);
