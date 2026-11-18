#!/usr/bin/env node
/**
 * team-bootstrap — write the manifests every dispatch requires, so a planned project can start.
 *
 * FOUND BY RUNNING IT, 2026-08-06. `/app-build` mandates a dispatch gate before spawning any owner:
 *
 *   dispatch-preflight.mjs --root --ticket --context --schedule --capability --risk --role
 *                          --operation --path --file [--change]
 *
 * Four of those are manifests that must already exist. On a freshly planned project, `docs/team/`
 * DOES NOT EXIST AT ALL. Preflight dies on the first manifest, `/app-build`'s own rule says "a
 * failed or unavailable check stops the spawn", and the ticket stays at `created` — forever.
 *
 * That is the complete explanation for the number nobody had counted: across every recorded dry
 * run, 11 of 19 tickets ended at `created`, never claimed, never blocked, never refused. It was
 * never agent diligence. The loop was structurally unable to dispatch.
 *
 * IT IS FC-005 FROM THIS REPOSITORY'S OWN FAILURE CORPUS — "the check whose own input nobody
 * writes: a rule reads an artifact that no step in the pipeline produces. It never fires. The
 * Definition of Done cites it, everyone believes it is covered, and no writer was ever assigned."
 * The corpus even names the Tell and mechanises it in `team-doctor`… for `docs/NN-*.md` artifacts
 * only. The `docs/team/*.json` manifests that the most important gate in the loop consumes were
 * outside its scope, so the check that exists for exactly this class never looked at the place it
 * had happened.
 *
 * WHAT THE DEFAULTS ARE, AND WHY THEY ARE NOT PERMISSIVE.
 *
 * A bootstrap that wrote wide-open defaults would convert a hard failure into a silent one, which
 * is worse: the gate would pass while checking nothing. So each default is the SAFE end of its own
 * contract, and every one of them is meant to be edited:
 *
 *   capabilities  the spawnable roles, each limited to its own surface: developers to source and
 *                 the root build manifests, document roles to their documents (QA also to
 *                 docs/team/journeys), `deny_all` on the actor secrets. A role not listed may not
 *                 write at all.
 *   risk-policy   default risk `medium` requiring a code-reviewer approval, plus the auth/migration
 *                 patterns at `high` (adds tech-lead) and billing/release at `critical`.
 *   schedule      `max_parallel: 2` and no tasks. The scheduler derives its ready set from the
 *                 board when a log exists, so an empty task list is correct, not a stub.
 *   context       delegated to `context-manifest.mjs create`, which hashes real files. Writing a
 *                 context manifest by hand here would be inventing the freshness claim the gate
 *                 exists to verify.
 *
 * Refuses to overwrite by default: a project's edited policy is not something a bootstrap gets to
 * reset. `--force` for a deliberate reset.
 *
 * Usage:  team-bootstrap.mjs [--root <dir>] [--force] [--context-only]
 *
 * --context-only re-snapshots docs/team/context-manifest.json and touches nothing else. Run it only
 * when a planning document changed: the manifest no longer goes STALE because HEAD moved (a wave
 * merge), so /app-build does not re-snapshot every round. A planning doc that changes mid-round
 * still reads STALE until it is re-run, which is the property the gate exists for.
 * Exit:   0 written, or already present
 *         1 refused — files exist and --force was not given
 *         2 cannot evaluate — the root does not exist
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const die = (code, message) => { process.stderr.write(`team-bootstrap: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['root']), die });

const ROOT = resolve(String(flags.root || '.'));
if (!existsSync(ROOT)) die(2, `no such project root: ${ROOT}`);
const TEAM = join(ROOT, 'docs/team');

/**
 * Root build manifests, spelled out because capability-check matches path PREFIXES, not globs.
 * ponytail: an enumerated list misses an unusual config name (say `rspack.config.ts`); teach
 * capability-check globs if that starts costing dispatches.
 */
const BUILD_MANIFESTS = [
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'tsconfig.json', 'tsconfig.base.json', 'tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.build.json', 'tsconfig.spec.json',
  ...['vite', 'vitest', 'jest', 'next', 'babel', 'metro', 'eslint', 'postcss', 'tailwind', 'playwright', 'webpack', 'rollup', 'svelte', 'astro', 'nuxt']
    .flatMap((tool) => ['js', 'ts', 'mjs'].map((ext) => `${tool}.config.${ext}`)),
  'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'gradle',
  'Podfile', 'Podfile.lock', 'Package.swift', 'Package.resolved',
];

const MANIFESTS = {
  'capabilities.json': {
    schema: 'capability-manifest/v1',
    root: '../..',
    // SEEDED WITH THE SPAWNABLE OWNERS, and this is a correction of my own first attempt.
    //
    // I first wrote `roles: []`, reasoning that closed-by-default is the safe end of the contract.
    // It is — and it left dispatch failing one step later with "role is not declared", which is a
    // clearer error for the identical outcome: a planned project still could not start. A bootstrap
    // whose output cannot dispatch has not fixed the thing it was written for; it has moved the
    // stopping point and called it safety.
    //
    // So the roles that /app-build can actually spawn are granted `write` to SOURCE, and to nothing
    // else. `deny_all` still covers the actor secrets, docs/team stays outside every allowed path,
    // and a project that wants a role touching release material has to say so deliberately. That is
    // the honest safe default: open enough to work, closed on everything that matters.
    roles: [
      'ios-developer', 'android-developer', 'backend-developer', 'web-developer',
      'monetization-engineer', 'devops-engineer', 'test-automation-engineer',
    ].map((role) => ({
      role,
      operations: ['read', 'write'],
      // ROOT BUILD MANIFESTS TOO (W9): a web developer adding a dependency writes package.json and
      // its lockfile; an Android one writes build.gradle. Source-only refused the first real ticket.
      allowed_paths: ['src', 'app', 'lib', 'test', 'tests', 'ios', 'android', 'web', 'docs/daily', ...BUILD_MANIFESTS],
    })).concat(
      ['ux-architect', 'product-designer', 'product-manager', 'product-researcher',
       'qa-engineer', 'data-analyst', 'aso-specialist', 'verification-engineer'].map((role) => ({
        role,
        operations: ['read', 'write'],
        // Document roles write documents. Not source, and not docs/team — a designer editing the
        // capability manifest is the shape this file exists to prevent. The one exception is QA's
        // journey files (docs/team/journeys/), which journey-gate reads and only QA writes.
        allowed_paths: ['docs/daily', 'docs/10-prd.md', 'docs/12-flows.md', 'docs/14-components.md',
          'docs/15-aso.md', 'docs/50-test-plan.md', 'docs/51-bugs.md', 'docs/52-analytics.md',
          ...(role === 'qa-engineer' ? ['docs/team/journeys'] : [])],
      }))
    ),
    // The token registry and the evidence store are written by the CLI (board.mjs actor mint,
    // verify-done, journey-gate) and by no role directly: a role that can write either can forge
    // a token hash or a test log (lib/actor.mjs, lib/evidence.mjs headers).
    deny_all: ['docs/team/actors.json', 'docs/team/actor-tokens.jsonl', 'docs/team/evidence'],
  },
  'risk-policy.json': {
    schema: 'risk-policy/v1',
    // W4: every role named in `approvals` must be one that can write `approved` (lib/capabilities.mjs)
    // AND is told to by its role file. The default asked for tech-manager — which nothing told to
    // approve, and which may no longer approve at all — so every medium ticket's merge was refused.
    // release-manager is not here either: it can never write `approved` (it must not author the
    // evidence that its build is shippable), so requiring it stranded every billing ticket.
    default: { risk: 'medium', model: 'strong', approvals: ['code-reviewer'], required_evidence: ['review'] },
    rules: [
      {
        pattern: 'billing|subscription|payment|app.?store|play.?store|storefront|release|rollout',
        risk: 'critical',
        model: 'frontier',
        approvals: ['code-reviewer'],
        required_evidence: ['security-review', 'runtime-gate'],
      },
      {
        pattern: 'migration|schema|database|keychain|credential|auth',
        risk: 'high',
        model: 'frontier',
        approvals: ['code-reviewer', 'tech-lead'],
        required_evidence: ['review', 'runtime-gate'],
      },
    ],
  },
  // project-profile.json — scaffolded UNSTATED, on purpose.
  //
  // Found while building the H4 fixture: `orchestrator round` step 0c requires this file, and this
  // bootstrap — written that same morning to fix exactly this class — did not produce it. FC-005
  // again, committed by the person who had just fixed FC-005, one file over.
  //
  // It is written with the toolchain EMPTY and the test commands UNSTATED, which means
  // `project-profile.mjs check` still returns CANNOT EVALUATE until a human fills it in. That is
  // deliberate and is not a half-fix: the toolchain genuinely IS unknown until someone states it,
  // and R10 is two builds broken by a toolchain nobody had written down. What the scaffold removes
  // is having to invent the schema from scratch — the failure stays, the guesswork goes.
  'project-profile.json': {
    schema: 'project-profile/v1',
    platform: 'UNSTATED — ios | android | backend-service | web',
    toolchain: [],
    test: {},
    _note: 'Fill in platform, toolchain (tool/args/expect per pinned tool) and test.fast / test.full. '
      + 'Until then `project-profile.mjs check` reports CANNOT EVALUATE and /app-build stops at step 0 — '
      + 'which is correct: an unstated toolchain is UNKNOWN, not fine.',
  },
  'schedule.json': {
    schema: 'scheduler-plan/v1',
    max_parallel: 2,
    // Empty by design: when a board event log exists the scheduler DERIVES tasks from it, and a
    // hand-written list beside the board is the two-writable-truths defect that cost dogfood run 2
    // a dispatch. This file carries overrides, not a second copy of the board.
    tasks: [],
  },
};

mkdirSync(TEAM, { recursive: true });

const existing = flags['context-only'] ? [] : Object.keys(MANIFESTS).filter((f) => existsSync(join(TEAM, f)));
if (existing.length && !flags.force) {
  die(1, `these already exist in docs/team/: ${existing.join(', ')}\n` +
         '  Refusing to overwrite — an edited policy is not something a bootstrap resets.\n' +
         '  Pass --force to reset them deliberately.');
}

const written = [];
for (const [name, body] of flags['context-only'] ? [] : Object.entries(MANIFESTS)) {
  writeFileSync(join(TEAM, name), `${JSON.stringify(body, null, 2)}\n`);
  written.push(name);
}

// G-F1: A NEW PROJECT PROVES ITS GATE ROLES. When this run actually wrote the manifests (a project
// being planned, not --context-only), `requireActorTokens: true` is added to .studio-policy.json if
// the policy does not already decide it. An existing project that never ran bootstrap keeps its
// stamped `insecure-local` regime; one that set the key either way keeps its choice.
let tokenNote = '';
const policyPath = join(ROOT, '.studio-policy.json');
if (written.length && existsSync(policyPath)) {
  try {
    const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
    if (!('requireActorTokens' in policy)) {
      writeFileSync(policyPath, `${JSON.stringify({ ...policy, requireActorTokens: true }, null, 2)}\n`);
      tokenNote = '\n  .studio-policy.json: requireActorTokens -> true. Every gate event now needs a per-spawn token\n' +
        '  minted by the orchestrator (board.mjs actor mint --role R --ticket T) and passed as --token.\n';
    }
  } catch (e) {
    tokenNote = `\n  .studio-policy.json is unreadable (${e.message}); requireActorTokens was NOT set.\n`;
  }
} else if (written.length) {
  tokenNote = '\n  No .studio-policy.json (app-init writes it) — requireActorTokens is not on; gate roles are\n' +
    '  asserted, not proven, and every event is stamped insecure-local.\n';
}

// The context manifest is NOT written here. It records hashes of real files so a later `verify` can
// tell whether the context an agent was given has since changed; inventing one would fabricate the
// freshness claim the gate exists to check.
const ctx = join(TEAM, 'context-manifest.json');
let ctxNote;
if (existsSync(ctx) && !flags.force && !flags['context-only']) {
  ctxNote = 'context-manifest.json already present — left alone';
} else {
  // The sources are the project's own planning documents — what an agent's context actually IS.
  // `context-manifest.mjs` requires them explicitly and refuses to record implicit context, which
  // is correct: a manifest that guessed its own sources would certify a freshness claim about files
  // nobody named. So they are discovered from what the project has, and their absence is reported
  // as "this project has not been planned yet" rather than papered over.
  const candidates = ['docs/00-vision.md', 'docs/10-prd.md', 'docs/11-backlog.md', 'docs/20-architecture.md', 'docs/11-srs.md', 'docs/12-flows.md',
    'docs/21-engineering-principles.md'];
  // NOT docs/31-board.md: it is a generated view that board.mjs rewrites on EVERY move, so hashing
  // it made preflight STALE the moment the first ticket was claimed — one spawn per round, ever.
  // The board's own integrity is board-doctor's and `board.mjs verify`'s job.
  const sources = candidates.filter((c) => existsSync(join(ROOT, c)));
  if (!sources.length) {
    ctxNote = 'context-manifest.json NOT created — this project has no planning documents yet.\n' +
      '      That is not a bootstrap failure: there is genuinely no context to record. Run /app-plan,\n' +
      '      then re-run this command.';
  } else {
    const args = [join(HERE, 'context-manifest.mjs'), 'create', '--root', ROOT, '--manifest', ctx];
    for (const s of sources) args.push('--source', s);
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
    ctxNote = r.status === 0
      ? `context-manifest.json created over ${sources.length} planning document(s)`
      : `context-manifest.json NOT created:\n      ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`;
  }
}

process.stdout.write(
  `TEAM BOOTSTRAP — wrote ${written.length} manifest(s) to docs/team/\n` +
  written.map((w) => `  ${w}`).join('\n') + `\n  ${ctxNote}\n` + tokenNote +
  '\n  These are the four inputs `dispatch-preflight` requires before any owner may be spawned.\n' +
  '  Without them a planned project cannot dispatch AT ALL — which is why 11 of 19 tickets in the\n' +
  '  recorded runs never left `created`.\n' +
  '\n  EVERY ONE IS MEANT TO BE EDITED. capabilities.json lets developer roles write source and the\n' +
  '  root build manifests (package.json, lockfiles, tsconfig, *.config, gradle, Podfile, Package.swift),\n' +
  '  document roles write their own docs (qa-engineer also docs/team/journeys/), no role may write\n' +
  '  docs/team/actors.json; any role not listed may write nothing. risk-policy.json defaults to\n' +
  '  medium risk needing a code-reviewer approval (high adds tech-lead). They are a starting point,\n' +
  '  not settings anyone chose for this project.\n'
);
