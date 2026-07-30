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
import { ROLE_GATES, ROLES_IN_MATRIX } from './lib/capabilities.mjs';
import { STOP_FILE } from './lib/stop.mjs';

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
const protocolSkill = skills.find((s) => s.rel.endsWith('team-protocol/SKILL.md'));

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
  'web-developer',
  'monetization-engineer',
  'devops-engineer',
  'test-automation-engineer',
];
const ARTIFACT_ROLES = [
  'ux-architect',
  'product-designer',
  'product-manager',
  'product-researcher',
  'qa-engineer',
  'data-analyst',
  'aso-specialist',
];

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

// --- 2c. every role appears in the activation matrix exactly once ------------------------------------
//
// `role-activation` decides which roles a given product type and tier spawn at all. A role that is
// in agents/ but in no matrix row is unspawnable-by-omission: no command activates it, nothing
// records that it was deactivated, and no reason exists to read. That is the same silent-drop class
// as owner_never_spawned above, arriving through the other door — and the whole point of the roster
// is that a deactivated role is RECORDED, never absent. A matrix row for a role that does not exist
// is the mirror defect: the roster promises a specialist nothing can spawn.

const MATRIX = join(ROOT, 'skills/role-activation/SKILL.md');
if (!existsSync(MATRIX)) {
  add(findings, 'activation_matrix_missing', 'skills/role-activation/SKILL.md',
    'The role-activation skill is absent, so nothing decides which roles a product type activates and no roster can be generated from it.',
    'Restore skills/role-activation/SKILL.md with its activation matrix.');
} else {
  const matrixText = readFileSync(MATRIX, 'utf8');
  const seen = new Map();
  for (const m of matrixText.matchAll(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|/gm)) {
    seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  }
  for (const [role, count] of seen) {
    if (!roles.has(role)) {
      add(findings, 'matrix_role_unknown', 'skills/role-activation/SKILL.md',
        `The activation matrix has a row for "${role}", which is not a role — there is no agents/${role}.md. The roster would promise a specialist nothing can spawn.`,
        'Fix the row, or add the agent.');
    } else if (count > 1) {
      add(findings, 'matrix_role_duplicated', 'skills/role-activation/SKILL.md',
        `"${role}" has ${count} rows in the activation matrix. Two rows can disagree, and whichever is read second silently wins.`,
        'Keep exactly one row per role.');
    }
  }
  // DR5-002. The matrix decides activation; `docs/02-team-roster.md` is the TEMPLATE that
  // `/app-init`, `/app-onboard` and `/app-run` copy into every new project and "fill in from the
  // matrix". Nothing compared the two, so they drifted: the template still named `ux-designer`
  // (split into ux-architect + product-designer, agents/ux-designer.md deleted) and silently
  // omitted TWELVE matrix roles — among them `product-validator` and `release-auditor`, the two
  // roles whose whole justification is independent authority. An agent starting from the template
  // would produce a roster that staffs a role nothing can spawn and never mentions the role that
  // exists so `release-manager` cannot approve its own release.
  //
  // The checks above validate matrix -> agents. This validates matrix -> the artifact a human
  // reads, which is the direction DR5-001 also went wrong in. Both directions, because an omission
  // and an invention fail differently: an omitted role is a gate nobody knows is missing, and an
  // invented one is a promise nothing can keep.
  const ROSTER = join(ROOT, 'docs/02-team-roster.md');
  if (!existsSync(ROSTER)) {
    // FAIL CLOSED. This was `if (existsSync(ROSTER))`, so a deleted, renamed or unpackaged template
    // silently skipped the drift check and the doctor reported coherent — the check standing down
    // in precisely the state where `/app-init` and `/app-onboard` cannot copy the file they require.
    // "Absent" is not "fine"; it is the check being unable to run, which is exit-2 reasoning applied
    // to a finding. Reported by codex on PR #5.
    add(findings, 'roster_template_missing', 'docs/02-team-roster.md',
      'The roster template is absent. /app-init and /app-onboard copy it into every new project and fill it in from the activation matrix, so without it no project can be staffed — and the matrix-vs-roster drift check cannot run at all.',
      'Restore docs/02-team-roster.md with one row per role in skills/role-activation/SKILL.md.');
  } else {
    const rosterText = readFileSync(ROSTER, 'utf8');
    // State as well as membership. The first version of this check kept only role NAMES, so the
    // other consequential drift was invisible: a matrix cell changing between `on`, `?` and `—`
    // while the worked roster kept saying `active`, `conditional` or `off`. Flip the matrix's
    // mobile-app `web-developer` cell to `on` and the template still said `off`, and this exited 0
    // — the two files agreed on WHO is staffed and disagreed on WHETHER. Reported by codex on PR #5.
    //
    // The template advertises itself as flagship · mobile-app, so that is the column compared.
    // MOBILE_APP_COL is the index of `mobile-app` in the matrix header, resolved from the header
    // rather than hardcoded: a column inserted upstream would otherwise silently shift the
    // comparison one role to the left and this check would confidently compare the wrong cells.
    const rosterRows = [...rosterText.matchAll(/^\|\s*([a-z][a-z0-9-]*)\s*\|\s*([a-z]+)\s*\|/gm)];
    const rosterRoles = new Set(rosterRows.map((m) => m[1]));
    const rosterState = new Map(rosterRows.map((m) => [m[1], m[2]]));

    // Local, because the shared `cells` helper is declared further down this file. Same rule:
    // strip the leading/trailing empties and the bold markers the matrix uses for readers.
    const cellsOf = (line) => line.split('|').slice(1, -1).map((c) => c.trim().replace(/\*/g, ''));
    const headerLine = matrixText.split(/\r?\n/).find((l) => /^\|\s*Role\s*\|/.test(l));
    const headerCells = headerLine ? cellsOf(headerLine) : [];
    const mobileCol = headerCells.indexOf('mobile-app');
    // `on` → active · `—` → off · `?` → conditional. Anything else is a matrix cell this check does
    // not understand, and it says so rather than guessing.
    const EXPECTED = { on: 'active', '—': 'off', '?': 'conditional' };
    if (mobileCol > 0) {
      for (const line of matrixText.split(/\r?\n/)) {
        const m = /^\|\s*\*?\*?`([a-z][a-z0-9-]*)`/.exec(line);
        if (!m) continue;
        const role = m[1];
        if (!rosterState.has(role)) continue; // membership is the check above; this one is state
        const cell = cellsOf(line)[mobileCol];
        const want = EXPECTED[cell];
        if (!want) continue;
        if (rosterState.get(role) !== want) {
          add(findings, 'roster_state_drift', 'docs/02-team-roster.md',
            `"${role}" is "${cell}" in the activation matrix's mobile-app column, which means "${want}" — but the roster template says "${rosterState.get(role)}". The two files agree on who is staffed and disagree on whether, which is the half of drift that survives a membership check.`,
            `Set the roster row for "${role}" to "${want}", or change the matrix cell if the matrix is what is wrong.`);
        }
      }
    }
    if (rosterRoles.size === 0) {
      add(findings, 'roster_template_empty', 'docs/02-team-roster.md',
        'The roster template exists but no role rows parsed out of it. A template that produces zero roles is indistinguishable from one that lists them all, to every check downstream of it.',
        'Restore the role table, one row per role in the activation matrix.');
    }
    for (const role of rosterRoles) {
      if (!seen.has(role)) {
        add(findings, 'roster_role_not_in_matrix', 'docs/02-team-roster.md',
          `The roster template has a row for "${role}", which has no row in the activation matrix. Every project generated from this template starts by staffing a role activation never decides on.`,
          `Remove the row, or give "${role}" a matrix row in skills/role-activation/SKILL.md.`);
      }
    }
    for (const role of seen.keys()) {
      if (!rosterRoles.has(role)) {
        add(findings, 'roster_role_missing', 'docs/02-team-roster.md',
          `"${role}" is in the activation matrix and has no row in the roster template. A role missing from the roster is not "off" — it is unaccounted for, and nothing downstream reports its gate as N/A.`,
          `Add a "${role}" row with its state and the reason, taken from the matrix.`);
      }
    }
  }

  // Every product type must name at least one IC that can own an implementation ticket, or be
  // declared unstaffed. `web-app` and `cli` were declared supported with no role able to build
  // either: the ticket strands with no spawnable owner, or lands on backend-developer and gets
  // built against the wrong conventions. Both are the silent-drop class. The mirror check matters
  // more — an "unstaffed" type whose column still names an IC would quietly activate anyway.
  // `web-developer` joined this list when it was added: without it, `web-app` reads as staffed with
  // no IC and product_type_unstaffed fires on a type that IS now buildable. The list and the
  // matrix's staffed? row have to move in the same change, in both directions.
  const ICS = ['ios-developer', 'android-developer', 'backend-developer', 'web-developer'];
  // `**no**` is still no: the matrix bolds the unstaffed cells for readers, and comparing the raw
  // cell made both branches below unreachable for exactly the two types they exist to catch.
  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim().replace(/\*/g, ''));
  const rows = matrixText.split('\n').filter((l) => l.trim().startsWith('|')).map(cells);
  const header = rows.find((r) => r[0] === 'Role');
  const staffed = rows.find((r) => r[0] === 'staffed?');
  if (!header || !staffed) {
    add(findings, 'activation_matrix_unparseable', 'skills/role-activation/SKILL.md',
      `The matrix needs a "| Role | ..." header and a "| **staffed?** | ..." row; ${header ? 'the staffed? row' : 'the header'} is missing, so nothing can check that a product type has anyone to build it.`,
      'Restore both rows.');
  } else {
    for (let col = 1; col < header.length - 1; col++) {
      const type = header[col];
      const icCells = ICS.map((ic) => (rows.find((r) => r[0] === `\`${ic}\``) || [])[col]);
      const active = icCells.filter((v) => v === 'on' || v === '?');
      if (staffed[col] === 'yes' && active.length === 0) {
        add(findings, 'product_type_unstaffed', 'skills/role-activation/SKILL.md',
          `Product type "${type}" is marked staffed but no IC role (${ICS.join(', ')}) is on or conditional for it. Nothing on this team can own its implementation tickets — they strand with no spawnable owner, or get built by the wrong specialist.`,
          `Activate an IC for "${type}", add the IC role the product needs, or mark the type unstaffed so activation refuses instead of assembling a team that cannot build it.`);
      }
      if (staffed[col] === 'no' && active.length > 0) {
        add(findings, 'product_type_staffing_contradiction', 'skills/role-activation/SKILL.md',
          `Product type "${type}" is marked unstaffed — activation is supposed to refuse — yet ${active.length} IC role(s) would still activate for it.`,
          `Set every IC cell in the "${type}" column to — , or mark the type staffed.`);
      }
    }
  }

  for (const role of roleNames) {
    if (!seen.has(role)) {
      add(findings, 'role_not_in_matrix', `agents/${role}.md`,
        `"${role}" is in no activation-matrix row, so no product type ever activates it and no roster ever records why it was left out. It is unspawnable by omission — never picked up, never deactivated, never reported.`,
        'Add a row to the matrix in skills/role-activation/SKILL.md (on / ? / — for each product type), or delete the role.');
    }
  }
}

// --- 2d. the capability matrix names real roles, and the controls are reachable --------------------
//
// lib/capabilities.mjs decides who may write a gate event. A TYPO in it is silent and expensive in
// exactly one direction: `code-revewier` does not grant a stranger anything, it locks out the real
// reviewer — so every approval starts failing and the fastest fix under pressure is to widen the
// list. A misspelling that makes a control unusable is how controls get deleted.

for (const role of ROLES_IN_MATRIX) {
  if (!roles.has(role)) {
    add(findings, 'capability_role_unknown', 'scripts/lib/capabilities.mjs',
      `The capability matrix grants "${role}" a gate event, and there is no agents/${role}.md. Nothing can exercise that grant, and the roles that CAN are the ones the matrix silently locks out.`,
      'Fix the spelling, or add the agent.');
  }
}

// A role that owns tickets and can write no gate event at all is fine and common (developers).
// A role that can write a gate event but no command ever spawns is not: the capability is a
// promise nothing can keep, and every attempt to use it is refused with a list naming a ghost.
for (const [event, allowed] of Object.entries(ROLE_GATES)) {
  const live = allowed.filter((r) => roles.has(r));
  if (live.length === 0) {
    add(findings, 'capability_event_unreachable', 'scripts/lib/capabilities.mjs',
      `No existing role may write "${event}", so that transition can never legally happen and every ticket needing it strands.`,
      `Grant "${event}" to a role that exists.`);
  }
}

// The emergency stop is only a control if the loops that spawn agents know about it. This is the
// same shape as the integration-branch defect from dry run 4: the resolver was hardened and its
// input was never produced, so the fix did nothing. A kill switch nobody documents is a file.
const STOP_MUST_MENTION = ['commands/app-build.md', 'commands/app-run.md', 'scripts/spawn-gate.sh'];
for (const rel of STOP_MUST_MENTION) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) continue;
  if (!readFileSync(path, 'utf8').includes(STOP_FILE)) {
    add(findings, 'kill_switch_unreferenced', rel,
      `The studio emergency stop is the file "${STOP_FILE}", and ${rel} never mentions it. A spawn site that does not check the stop is a spawn site the stop does not stop.`,
      `Name ${STOP_FILE} here, and check it before spawning.`);
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

// --- 3b. every skill is triggered by something ------------------------------------------------------
//
// The mirror of skill_missing, and the one that was absent. A skill nothing invokes is a procedure
// nobody runs: the corpus grows, the rule reads as coverage, and no agent has ever been told to
// apply it. Proven live — `architecture-builder` sat in skills/ referenced by no agent, command or
// other skill at all, while team-doctor's own DOC_WRITERS asserted it produced two architecture
// documents. The check that existed only ran the other direction, so it could not see it.
//
// A skill's own directory does not count as a reference to itself.

for (const skill of skills) {
  const name = frontmatterName(skill.text, basename(dirname(skill.path)));
  const dir = `skills/${basename(dirname(skill.path))}/`;
  const referenced = [...agents, ...commands, ...skills].some(
    (f) => !f.rel.startsWith(dir) && new RegExp(`\\b${name}\\b`).test(f.text)
  );
  if (!referenced) {
    add(findings, 'skill_unreferenced', skill.rel,
      `Skill "${name}" is defined but no agent, command or other skill ever names it, so nothing triggers it. A procedure nobody runs still reads as coverage — that is worse than not having it.`,
      'Name it in the agent or command that should invoke it, or delete the skill.');
  }
}

// --- 3c. the evidence bundle contract is published where agents read it ------------------------------
//
// P2.7. A test result is a claim by the actor that ran it; the bundle is what makes it checkable.
// team-doctor cannot verify a bundle it has never seen (bundles live in a project, not here), but it
// CAN enforce the half that rots silently: the field list agents are told to fill must still be the
// field list team-protocol publishes. Same shape as canonical_path_undocumented below, same reason —
// every agent reads the skill, nothing reads this script, so a field dropped from the table is a
// field nobody records and `release-auditor` then marks the claim `unverified` forever.
const EVIDENCE_FIELDS = [
  'Build id:', 'Device:', 'OS:', 'Inputs:', 'Screenshot/recording:', 'Logs:',
  'Analytics events:', 'Result:', 'Requirement IDs:', 'Tester identity:', 'Timestamp:',
  'Artifact hash:',
];
if (protocolSkill) {
  const missing = EVIDENCE_FIELDS.filter((f) => !protocolSkill.text.includes(f));
  if (missing.length > 0) {
    add(findings, 'evidence_field_undocumented', 'skills/team-protocol/SKILL.md',
      `The evidence bundle contract is missing ${missing.length} required field(s): ${missing.join(' ')} — qa-engineer and test-automation-engineer fill in what this table publishes, and release-auditor refuses a bundle that is short of it. A dropped field is a claim that stays unverified with nobody able to say which field is missing.`,
      'Restore the row in the Evidence bundle table, or change the table and EVIDENCE_FIELDS together.');
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

// --- 5. the doc graph: every document has a declared writer and at least one reader -------------------
//
// RV-035: four documents were written by a step and read by no step at all. The handoff went into a
// void and every producer reported success. The check that was here counted MENTIONS — "referenced
// in exactly one file" — which is directionless (it cannot tell a producer from a consumer, so a doc
// written twice and never read looked healthy) and it printed `.md` onto every name it reported,
// including `docs/31-board-events.jsonl`. A tool that names a file that does not exist is a tool
// people stop believing.
//
// The producer is DECLARED here, in the same style as BUILD_SPAWNABLE_OWNERS and CODE_ROLES above,
// and everything else that mentions the doc is a reader. That makes both halves mechanical:
//
//   - a declared writer that has stopped mentioning its own doc   -> doc_writer_silent
//   - a doc referenced anywhere with no row at all                -> doc_undeclared
//   - a row for a doc nothing mentions                            -> doc_unused
//   - a doc mentioned ONLY by its writers                         -> doc_unread   (this is RV-035)
//
// The key is the real filename, extension included, because that is the string a reader will paste
// into a terminal.
const DOC_WRITERS = new Map([
  // The founder record. A directory, not a file, and the only artifact in the pipeline whose
  // correct state is UNCHANGED — scripts/founder-intent.mjs holds it to that.
  ['docs/00-founder-intent/',           ['skills/requirements-intake/SKILL.md', 'commands/app-init.md']],
  ['docs/00-vision.md',                 ['agents/ceo.md']],
  ['docs/01-intake.md',                 ['skills/requirements-intake/SKILL.md']],
  ['docs/02-team-roster.md',            ['skills/role-activation/SKILL.md']],
  ['docs/10-prd.md',                    ['agents/cpo.md', 'skills/prd-builder/SKILL.md']],
  ['docs/11-backlog.md',                ['agents/cpo.md', 'skills/prd-builder/SKILL.md', 'agents/product-manager.md']],
  ['docs/12-flows.md',                  ['agents/ux-architect.md']],
  ['docs/13-design-tokens.md',          ['agents/product-designer.md']],
  ['docs/14-components.md',             ['agents/product-designer.md']],
  ['docs/15-aso.md',                    ['agents/aso-specialist.md']],
  ['docs/16-intent-validation.md',      ['agents/product-validator.md']],
  ['docs/16-research.md',               ['agents/product-researcher.md']],
  ['docs/17-founder-inbox.md',          ['agents/chief-of-staff.md']],
  // The formal-artifact series (P3a). Each is created by `scripts/messages.mjs artifact <TYPE>`,
  // which writes the file AND registers it on the team channel in one step — the file alone is a
  // document nobody knows exists, the message alone is a claim with no content.
  ['docs/16-pdr/',                      ['agents/cpo.md']],
  ['docs/17-ddr/',                      ['agents/ux-architect.md', 'agents/product-designer.md']],
  ['docs/20-architecture.md',           ['agents/cto.md', 'skills/architecture-builder/SKILL.md']],
  ['docs/21-engineering-principles.md', ['agents/cto.md', 'skills/architecture-builder/SKILL.md']],
  // One artifact per platform, so every `docs/22-impl-spec-<anything>` folds into this row.
  ['docs/22-impl-spec-*.md',            ['agents/tech-lead.md', 'commands/app-onboard.md']],
  ['docs/23-git-strategy.md',           ['agents/devops-engineer.md']],
  // The server-side controls. Written by devops, read by security-reviewer before ship — the one
  // artifact in the set whose contents nothing in this plugin can enforce, which is why a role has
  // to go and look.
  ['docs/24-repository-controls.md',    ['agents/devops-engineer.md']],
  ['docs/24-adr/',                      ['agents/cto.md']],
  // The assumption register. An assumption carries an owner, a confidence and a validation date;
  // one past its date is reported by board-doctor, because a belief with a timestamp is not a fact.
  ['docs/25-assumptions/',              ['agents/tech-lead.md']],
  ['docs/30-sprint-plan.md',            ['skills/sprint-planner/SKILL.md']],
  ['docs/31-board.md',                  ['skills/sprint-planner/SKILL.md', 'commands/app-plan.md']],
  ['docs/31-board-events.jsonl',        ['skills/sprint-planner/SKILL.md', 'commands/app-plan.md']],
  ['docs/32-board-view.md',             ['commands/app-build.md', 'commands/app-status.md']],
  // The round journal: what happened to the LOOP, as distinct from the event log's what happened to
  // the TICKETS. Written by /app-build at the end of each round via round-journal.mjs, read by
  // /app-status for the trend and the budget position.
  ['docs/33-rounds.jsonl',              ['commands/app-build.md']],
  // The dashboard's static export. Deliberately NOT 32-board-view.html: board-render already owns
  // 32-board-view.md, and two renderings sharing one name is DR4-020 — a second view nobody declared.
  ['docs/34-dashboard.html',            ['commands/app-dashboard.md']],
  ['docs/40-api.md',                    ['agents/backend-developer.md']],
  ['docs/41-monetization.md',           ['agents/monetization-engineer.md']],
  ['docs/50-test-plan.md',              ['agents/qa-engineer.md']],
  ['docs/51-bugs.md',                   ['agents/qa-engineer.md']],
  ['docs/52-analytics.md',              ['agents/data-analyst.md']],
  ['docs/53-reviews/',                  ['agents/code-reviewer.md']],
  // The evidence bundles behind every test claim. Written by whoever ran the test, read
  // independently by release-auditor — which is the whole point: a claim whose only witness is the
  // actor that made it is not evidence.
  ['docs/54-evidence/',                 ['agents/qa-engineer.md', 'agents/test-automation-engineer.md']],
  ['docs/60-releases.md',               ['agents/release-manager.md']],
  ['docs/70-security-review.md',        ['agents/security-reviewer.md']],
  ['docs/71-verification.md',           ['agents/verification-engineer.md']],
  ['docs/72-release-audit.md',          ['agents/release-auditor.md']],
  ['docs/73-privacy-review.md',         ['agents/privacy-reviewer.md']],
  ['docs/74-red-team.md',               ['agents/red-team-agent.md']],
  ['docs/75-reliability-review.md',     ['agents/reliability-engineer.md']],
  // A waiver carries an expiry and an EXPIRED WAIVER IS A FINDING — the exemption was granted for a
  // period, and a period that ended without anyone noticing is a permanent exemption by accident.
  ['docs/72-waivers/',                  ['agents/security-reviewer.md']],
  ['docs/73-incidents/',                ['agents/release-manager.md']],
  ['docs/80-audit.md',                  ['commands/app-audit.md']],
  ['docs/81-findings.md',               ['commands/app-audit.md']],
  ['docs/90-learnings.md',              ['commands/app-ship.md', 'commands/app-run.md']],
]);

// A generated projection of a file that already has readers. It exists to be LOOKED at by a human,
// so "no step reads it" is its correct shape rather than a defect. Everything else earns its row.
// Terminal deliverables: produced for a human to look at, not consumed by any later step. Being
// unread is their correct end state, so `doc_unread` must not fire on them.
const TERMINAL_DOCS = new Set(['docs/32-board-view.md', 'docs/34-dashboard.html']);

// `docs/NN-slug` with the extension it was actually written with. Every impl spec folds to one key.
const docKey = (base, ext) =>
  base.startsWith('docs/22-impl-spec-') ? 'docs/22-impl-spec-*.md' : `${base}${ext || ''}`;

const docMentions = new Map();
for (const file of [...agents, ...commands, ...skills]) {
  // The extension list must cover every artifact type the pipeline produces, not just the ones it
  // produced when this was written. `.html` was missing when the dashboard's static export landed:
  // the reference normalised to `docs/34-dashboard` while DOC_WRITERS held `docs/34-dashboard.html`,
  // so the same file was reported BOTH as undeclared and as an unused row — a check disagreeing with
  // itself about one artifact. Add the extension when a new artifact type appears.
  for (const m of file.text.matchAll(/docs\/(\d{2}-[a-z0-9-]*)(\.md|\.jsonl|\.html|\/)?/g)) {
    const key = docKey(`docs/${m[1]}`, m[2]);
    if (!docMentions.has(key)) docMentions.set(key, new Set());
    docMentions.get(key).add(file.rel);
  }
}

for (const [doc, refs] of docMentions) {
  const writers = DOC_WRITERS.get(doc);
  if (!writers) {
    add(findings, 'doc_undeclared', [...refs].sort()[0],
      `${doc} is referenced by ${refs.size} file(s) but has no row in DOC_WRITERS, so nothing knows which step is supposed to produce it. An artifact with no declared producer is the shape of DR4-019: every role assumes another one owns it.`,
      'Add a row naming its writer(s) in scripts/team-doctor.mjs.');
    continue;
  }
  for (const w of writers) {
    if (!refs.has(w)) {
      add(findings, 'doc_writer_silent', w,
        `${doc} is declared written by ${w}, and that file no longer mentions it. Either the producer moved and the declaration is stale, or the document is now written by nobody.`,
        `Restore the reference in ${w}, or move the row to the step that writes it now.`);
    }
  }
  if (TERMINAL_DOCS.has(doc)) continue;
  const readers = [...refs].filter((r) => !writers.includes(r));
  if (readers.length === 0) {
    add(findings, 'doc_unread', writers[0],
      `${doc} is written by ${writers.join(', ')} and read by no step at all. This is RV-035: a handoff into a void — the producer reports success and nothing downstream ever opens the file.`,
      'Name it in the inputs of the role that needs it, or mark it a terminal deliverable in TERMINAL_DOCS.');
  }
}

// --- 5b. the validator cannot write what it validates ------------------------------------------------
//
// `product-validator` exists for exactly one reason: this team writes the PRD, derives criteria from
// its own PRD, and tests against its own criteria, so it can prove conformity to its interpretation
// and nothing else. A validator that also authors the PRD does not narrow that loop, it lengthens it
// by one step — and it does so invisibly, because every document still reads as reviewed.
//
// Independence is a property of the doc graph, so it is enforced in the doc graph. Adding
// `agents/product-validator.md` to either row below is the whole failure, and it is one plausible
// edit away at any time ("the validator noticed the gap, so it filled it").
const VALIDATOR = 'agents/product-validator.md';
for (const doc of ['docs/10-prd.md', 'docs/11-backlog.md']) {
  if ((DOC_WRITERS.get(doc) || []).includes(VALIDATOR)) {
    add(findings, 'validator_writes_prd', 'scripts/team-doctor.mjs',
      `${VALIDATOR} is declared a writer of ${doc}. It approves that document at scope-lock, so writing it makes the check self-confirming: the only role positioned outside the cpo/cto/tech-manager chain is now inside it, and the closed loop this role exists to break is closed again with one more step in it.`,
      `Remove ${VALIDATOR} from the ${doc} row. A validator that finds a gap says so and hands it back to cpo; it never fills it.`);
  }
}

for (const doc of DOC_WRITERS.keys()) {
  if (!docMentions.has(doc)) {
    add(findings, 'doc_unused', 'scripts/team-doctor.mjs',
      `DOC_WRITERS has a row for ${doc}, which no agent, command or skill mentions. The row asserts a document that no step in the pipeline touches.`,
      'Delete the row, or wire the document into the step that needs it.');
  }
}

// --- 6. one spelling per path ------------------------------------------------------------------------
//
// RV-031: the daily fragment had FIVE spellings across the corpus — `<today>` vs `<date>` vs
// `YYYY-MM-DD`, `<role>` vs `<agent>` vs `<your-role>` — and /app-build gated on exactly one of them.
// Every agent that used one of the other four wrote a fragment the standup never found, and the loop
// reported a clean round. skills/team-protocol/SKILL.md publishes a canonical paths table; this is
// that table made executable.
//
// Both halves. The corpus must use only the canonical spellings, AND the canonical spellings must
// still be the ones the table publishes — a check enforcing a pattern the documentation no longer
// states is a rule enforcing itself.
const CANONICAL_PATHS = [
  'docs/daily/<today>-<role>-<ticket>.md',   // the per-run fragment
  'docs/daily/<today>-<role>-spec.md',       // ...for a spec-writing exec with no ticket
  'docs/daily/<today>.md',                   // the aggregated standup
  'docs/team/messages.jsonl',                // the channel — the source of truth (schema v1)
  'docs/team/messages.md',                   // ...and its generated human view
  'docs/53-reviews/APP-NNN-cycle-N.md',      // a review verdict
];
// Structural references that name no artifact: the directories themselves, the glob the standup
// reads a day's fragments with, and the archive consumed fragments are moved to.
const STRUCTURAL_PATHS = new Set([
  'docs/daily', 'docs/daily/', 'docs/daily/<today>-*.md', 'docs/daily/.fragments/',
  'docs/team', 'docs/team/', 'docs/53-reviews', 'docs/53-reviews/',
]);
const ALLOWED_PATHS = new Set([...CANONICAL_PATHS, ...STRUCTURAL_PATHS]);

const protocol = skills.find((s) => s.rel.endsWith('team-protocol/SKILL.md'));
for (const canonical of CANONICAL_PATHS) {
  if (protocol && !protocol.text.includes(canonical)) {
    add(findings, 'canonical_path_undocumented', 'skills/team-protocol/SKILL.md',
      `team-doctor enforces "${canonical}" as the one legal spelling, and the canonical paths table no longer publishes it. Every agent reads the table; nothing reads this script.`,
      'Restore the row in the paths table, or change both together.');
  }
}

for (const file of [...agents, ...commands, ...skills]) {
  const seen = new Set();
  for (const m of file.text.matchAll(/docs\/(?:daily|team|53-reviews)[^\s`'")\];,]*/g)) {
    const path = m[0].replace(/\.$/, '');
    if (ALLOWED_PATHS.has(path) || seen.has(path)) continue;
    seen.add(path);
    add(findings, 'path_spelling', file.rel,
      `"${path}" is a variant spelling. The loop matches one pattern per artifact and reads no other, so a fragment, standup or verdict written at this path is invisible to the step that consumes it — written, committed, and never found.`,
      `Use the canonical spelling from skills/team-protocol/SKILL.md: ${CANONICAL_PATHS.join(' · ')}`);
  }
}

// --- 7. the failure corpus, and the one signal it exists to produce ------------------------------------
//
// `knowledge/failure-corpus.md` is the only pack that learns from failure; the rest learn from
// shipped code. Two things can rot it, and both are silent:
//
//   1. a class with no Tell or no Rule — a story, not knowledge. Nobody can act on it and nobody
//      notices, because prose always looks finished.
//   2. an instance dated AFTER its class's `Rule shipped` date. That is a class recurring under a
//      rule that was supposed to stop it, which is a strictly more valuable fact than the incident:
//      it says the rule does not work. Left unflagged it reads as "we know about this one", the most
//      expensive misreading in the file.
//
// Blocking, not a warning. The exit is to strengthen the rule and stamp a new `Rule shipped` date —
// a claim someone is then on the hook for — or to reclassify the instance into the class it really
// belongs to. Deleting the row is not an exit.
const CORPUS = join(ROOT, 'knowledge/failure-corpus.md');
const CORPUS_FIELDS = ['Shape', 'Tell', 'Rule', 'Rule shipped'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One parser for the corpus. Exported shape: [{id, name, fields, instances:[{date, text}]}].
 * A class heading is `### FC-NNN — <name>`; fields are `**<Field>:**` lines; instances are table
 * rows whose first cell is an ISO date. Anything else in the section is commentary.
 */
function parseCorpus(text) {
  const classes = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.match(/^###\s+(FC-\d+)\s+[—-]\s+(.+?)\s*$/);
    if (heading) {
      current = { id: heading[1], name: heading[2], fields: new Map(), instances: [] };
      classes.push(current);
      continue;
    }
    if (!current) continue;
    const field = raw.match(/^\*\*([^:*]+):\*\*\s*(.*)$/);
    if (field) {
      current.fields.set(field[1].trim(), field[2].trim());
      continue;
    }
    const row = raw.match(/^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (row && DATE.test(row[1])) current.instances.push({ date: row[1], text: row[2] });
  }
  return classes;
}

if (!existsSync(CORPUS)) {
  add(findings, 'corpus_missing', 'knowledge/failure-corpus.md',
    'The failure corpus is gone. code-reviewer and verification-engineer are told to run its tells against every diff, so its absence turns two gates into generic checklists without either of them reporting a thing.',
    'Restore knowledge/failure-corpus.md, or remove the instruction from both agents in the same change.');
} else {
  const classes = parseCorpus(readFileSync(CORPUS, 'utf8'));
  if (classes.length === 0) {
    add(findings, 'corpus_unparseable', 'knowledge/failure-corpus.md',
      'The corpus contains no `### FC-NNN — <name>` class headings, so the recurrence check reads zero classes and reports clean over a file that may be full of them. A parser finding nothing is not the same as nothing being there.',
      'Restore the heading shape documented in the file, or update parseCorpus in scripts/team-doctor.mjs alongside it.');
  }
  for (const cls of classes) {
    const missing = CORPUS_FIELDS.filter((f) => !(cls.fields.get(f) || '').length);
    if (missing.length) {
      add(findings, 'corpus_class_incomplete', 'knowledge/failure-corpus.md',
        `${cls.id} is missing ${missing.join(', ')}. A class with no Tell cannot be applied to a diff and a class with no Rule catches nothing — either way it is a story, and stories read as finished work.`,
        'Fill the field, or delete the class rather than leaving a decorative one.');
      continue;
    }
    const shipped = cls.fields.get('Rule shipped');
    if (!DATE.test(shipped)) {
      add(findings, 'corpus_class_incomplete', 'knowledge/failure-corpus.md',
        `${cls.id} has "Rule shipped: ${shipped}", which is not a YYYY-MM-DD date. The recurrence check compares instance dates against it, so an unparseable date silently disables the single most valuable signal in this file.`,
        'Write the date the catching rule actually landed, as YYYY-MM-DD.');
      continue;
    }
    for (const instance of cls.instances) {
      if (instance.date > shipped) {
        add(findings, 'corpus_recurrence', 'knowledge/failure-corpus.md',
          `RECURRENCE — ${cls.id} (${cls.name}) happened again on ${instance.date}, after its rule shipped on ${shipped}: ${instance.text}. The rule did not work. That is the finding, not the incident.`,
          `Strengthen the rule that claims to catch ${cls.id} and stamp its new "Rule shipped" date, or move this instance to the class it actually belongs to. Deleting the row is not an exit.`);
      }
    }
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
