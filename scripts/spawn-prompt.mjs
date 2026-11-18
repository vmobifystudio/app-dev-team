#!/usr/bin/env node
/**
 * spawn-prompt — compose the exact text to hand an IC agent, with the output contract INLINED.
 *
 * THE MEASURED PROBLEM (H5, 2026-08-07). `parallel-orchestrator` step 4 has always said each spawn
 * prompt must include *"the expected output contract (`DONE: APP-NNN ...`)"*. In the first real
 * spawn against this loop, the prompt instead said *"Return the CODE profile defined in
 * `team-protocol`"* — a POINTER, not the text. The agent's code was correct and it committed
 * correctly; it returned 0 of 6 contract fields, worse than the agent that failed H4 the day
 * before. `report-check.mjs` caught it, exactly as designed — but the loop had already burned a
 * whole spawn on a report nothing downstream could act on.
 *
 * With the SAME ticket, SAME role, SAME slot, and ONLY the contract pasted in literally instead of
 * referenced, the next agent returned all six fields (H5b). The failure was dispatch, not
 * capability — which makes it exactly the kind of failure this repository's own rule exists to
 * retire: *"a rule survives as a mechanism that runs, not a convention someone remembers"*
 * (orchestrator.mjs). Remembering to paste the contract in is a convention. This is the mechanism.
 *
 * ENFORCED SINCE SPRINT 2 (C10). `hooks/require-spawn-contract.sh` is a PreToolUse hook on the
 * `Task`/`Agent` tool: in an app-dev-team project it runs `verify` on the outbound prompt and refuses
 * the spawn when the contract is not inlined. Composing is no longer something to remember.
 *
 * ONE TICKET PER COMPOSE (C7). An IC prompt carries a bounded excerpt of the impl spec and PRD
 * sections that name the ticket (<= EXCERPT_WORDS, with a pointer to each full file). A
 * `code-reviewer` prompt carries the IC's latest persisted DONE report (docs/team/reports/, written by
 * `hooks/persist-ic-report.sh`), the ticket branch tip, and the verdict contract.
 *
 * ONE TEMPLATE PER SPAWN THE LOOP MAKES (Sprint 3). Every gate role the loop spawns has one, and
 * each mints its own token for its ticket under `requireActorTokens` (an agent with no template could
 * not get a token, so its gate event was unrecordable — W2-2):
 *   IC (code / artifact tier)     `Work ticket X.`  base + the exact `git checkout -b` line; `--retry
 *                                 <verdict file>` re-spawns onto the EXISTING branch after changes
 *   qa-engineer on a `QA-` ticket the wave's tickets with acceptance, one `Token for APP-NNN:` each
 *   code-reviewer / tech-lead /   `Review ticket X.`  the reviewer stays in the main checkout, base,
 *   security-reviewer             bound range, evidence and context paths, the exact --bind command
 *   --mode design-qa              `Design QA ticket X.` (ux-architect, or code-reviewer when it is off)
 *   verification-engineer         `Verify ticket X.` with the reviewer's routed constants/rules
 *                                 (a VE that OWNS the ticket gets the IC template)
 *   release-auditor               `Release audit.` (no board ticket needed; writes no gate event)
 *
 * WORD BUDGET (C11, C2-20). compose prints the prompt's words + the role file's + the SKILL.md bodies
 * the role must load (a static map, closed over the skills those skills require) and warns
 * (non-fatal) above the role's budget. Still a floor: references, House KB packs and external skills
 * loaded on demand are not counted.
 *
 * Usage:
 *   spawn-prompt.mjs compose --root <project> --ticket <ID> --role <role>
 *                    [--slot <path>] [--integration-branch <name>] [--mode design-qa]
 *                    [--retry <verdict file>] [--tickets A,B   (QA: the wave, default every row at qa)]
 *   spawn-prompt.mjs verify --role <role> [--prompt <file>]   (reads stdin if --prompt is omitted)
 *
 * Exit codes:
 *   compose:  0 printed the prompt to stdout · 2 the ticket or role could not be resolved
 *   verify:   0 the contract is present and inlined (not merely referenced) · 1 it is not · 2 usage
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { contractFor, contractBlock, BLOCKED_BLOCK, GATE_HEADERS, matchesTicket } from './lib/contract.mjs';
import { ROLE_GATES } from './lib/capabilities.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARD = resolve(HERE, 'board.mjs');
const die = (code, message) => { process.stderr.write(`spawn-prompt: ${message}\n`); process.exit(code); };

const { flags, positional } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'ticket', 'role', 'slot', 'integration-branch', 'prompt', 'mode', 'retry', 'tickets']),
  die,
});
const [command] = positional;

// The review gate's own contract: the three lines board.mjs's readVerdict refuses an append without
// (lib/verdict.mjs), plus `Recorded:`, which require-review-verdict.sh checks against the log.
const REVIEW_ROLES = new Set(['code-reviewer', 'tech-lead', 'security-reviewer']);
const REVIEW_FIELDS = ['REVIEW VERDICT:', 'Scope:', 'Recorded:', '## Not checked'];
const DESIGN_QA_ROLES = new Set(['ux-architect', 'code-reviewer']);
const DESIGN_QA_FIELDS = ['DESIGN QA:', 'Ticket:', 'Scope:', '## Not checked'];
const VERIFY_FIELDS = ['VERIFICATION:', 'Ticket:', '## Not checked'];
const AUDIT_FIELDS = ['RELEASE AUDIT:', 'docs/76-release-audit.md'];
const BUDGET = { ic: 4000, reviewer: 8000 };
const EXCERPT_WORDS = 1500;
const PLATFORM_SPEC = {
  'ios-developer': 'docs/22-impl-spec-ios.md', 'android-developer': 'docs/22-impl-spec-android.md',
  'backend-developer': 'docs/22-impl-spec-backend.md', 'web-developer': 'docs/22-impl-spec-web.md',
  'monetization-engineer': 'docs/41-monetization.md',
};
// Roles that write some gate event (lib/capabilities.mjs ROLE_GATES) — derived, never hand-listed.
const GATE_WRITERS = new Set(Object.values(ROLE_GATES).flat());

/**
 * The SKILL.md bodies each spawn MUST load before it can work (its role file's "Skills you must use",
 * minus anything "routed by what the ticket needs"), closed over SKILL_DEPS. A static map: when a
 * role file's mandatory list changes, change it here. ponytail: hand-kept, no parser of role prose.
 */
const SKILL_DEPS = { 'ic-workflow': ['agent-isolation', 'defect-hunting'] };
const MANDATORY_SKILLS = {
  code: ['ic-workflow', 'house-conventions'],
  artifact: ['agent-isolation', 'house-conventions'],
  'qa-engineer': ['agent-isolation', 'house-conventions', 'runtime-gate', 'defect-hunting'],
  'verification-engineer': ['agent-isolation', 'house-conventions', 'defect-hunting', 'mutation-testing', 'runtime-gate'],
  'code-reviewer': ['defect-hunting', 'house-conventions'],
  'tech-lead': ['house-conventions', 'process-tiering'],
  'security-reviewer': ['house-conventions', 'team-protocol'],
  'release-auditor': ['house-conventions', 'board-doctor', 'team-protocol'],
  'design-qa': ['accessibility-gate', 'house-conventions'],
};
const MODEL_LADDER = ['haiku', 'sonnet', 'opus'];

const words = (t) => (String(t).match(/\S+/g) || []).length;
const tryGit = (root, args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };
const fence = (body) => ['```', body, '```'];

/**
 * The sections of each file that name any token (ticket ID, feature ID, spec anchor, acceptance IDs),
 * whole-word, capped at EXCERPT_WORDS across all files. A heading starts a section; sub-sections are
 * matched on their own. ponytail: keyword match, not semantic — a section that describes the ticket
 * without naming it is missed, which is why every excerpt points at the full file.
 */
function specExcerpt(root, files, tokens) {
  const res = tokens.filter(Boolean).map((t) => new RegExp(`(^|[^A-Za-z0-9-])${escapeRe(String(t))}($|[^A-Za-z0-9])`, 'i'));
  const out = [];
  let left = EXCERPT_WORDS;
  for (const file of files) {
    const abs = resolve(root, file);
    if (!existsSync(abs)) continue;
    const hits = readFileSync(abs, 'utf8').split(/^(?=#{1,6} )/m).filter((p) => res.some((r) => r.test(p)));
    out.push('', hits.length ? `From \`${file}\` (full file: \`${file}\`):` : `\`${file}\`: no section names this ticket — read it if the ticket needs it.`);
    for (const h of hits) {
      if (left <= 0) { out.push('', '[…excerpt budget spent — read the full file for the rest]'); break; }
      const w = h.trim().split(/\s+/);
      out.push('', w.length > left ? `${w.slice(0, left).join(' ')} […truncated]` : h.trim());
      left -= w.length;
    }
  }
  return out.length ? ['', '**Spec excerpt** — only the sections that name this ticket; the full files are the authority:', ...out] : [];
}

/** Words the agent starts with: prompt + role file + its mandatory SKILL.md closure. A floor. */
function reportBudget(role, ticket, text, skillKey) {
  const fileWords = (p) => (existsSync(p) ? words(readFileSync(p, 'utf8')) : 0);
  const roleWords = fileWords(resolve(HERE, '..', 'agents', `${role}.md`));
  const skills = new Set();
  const add = (s) => { if (skills.has(s)) return; skills.add(s); (SKILL_DEPS[s] || []).forEach(add); };
  (MANDATORY_SKILLS[skillKey] || MANDATORY_SKILLS[role] || []).forEach(add);
  const skillWords = [...skills].reduce((n, s) => n + fileWords(resolve(HERE, '..', 'skills', s, 'SKILL.md')), 0);
  const total = words(text) + roleWords + skillWords;
  const budget = REVIEW_ROLES.has(role) || role === 'release-auditor' || skillKey === 'design-qa' ? BUDGET.reviewer : BUDGET.ic;
  process.stderr.write(`spawn-prompt: ${role} ${ticket}: prompt ${words(text)} + role file ${roleWords} + mandatory skills ${skillWords} (${[...skills].join(', ') || 'none'}) = ${total} words (budget ${budget}; references and skills loaded on demand not counted)\n`);
  if (total > budget) process.stderr.write(`spawn-prompt: WARNING — OVER BUDGET by ${total - budget} words. Not a refusal; trim the role file, its mandatory skills, or the specs this ticket pulls in.\n`);
}

/**
 * Under `requireActorTokens: true` in .studio-policy.json, compose mints THIS agent's token for each
 * ticket it gates (board.mjs actor mint — the main session is the orchestrator; hooks/guard-gate-
 * writes.sh refuses a subagent minting) and inlines it, so nobody has to remember to. Roles that
 * write no gate event get none. `[{ticket, token}]`.
 */
function tokensFor(root, role, tickets) {
  if (!GATE_WRITERS.has(role)) return [];
  const policy = readJson(join(root, '.studio-policy.json'));
  if (policy.requireActorTokens !== true) return [];
  return tickets.map((ticket) => {
    try {
      return { ticket, token: execFileSync(process.execPath, [BOARD, 'actor', 'mint', '--role', role, '--ticket', ticket],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
    } catch (e) { return die(2, `could not mint the ${role} token for ${ticket}: ${String(e.stderr || e.message).trim()}`); }
  });
}
const tokenLines = (root, role, ticket) => tokensFor(root, role, [ticket]).flatMap(({ token }) => ['', `Token: ${token}`,
  `Pass \`--token ${token}\` on every gate event you write for ${ticket}. It proves your role for this ticket only; never write it to a file or hand it on.`]);

/** Every row on the board, keyed by upper-case ID (`board.mjs show --json` exits 1 on violations but still prints). */
function boardRows(root) {
  let out;
  try { out = execFileSync(process.execPath, [BOARD, 'show', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = e.stdout || ''; if (!out) die(2, `could not read the board: ${String(e.stderr || e.message).trim()}`); }
  try { return JSON.parse(out).tickets || {}; } catch { return die(2, 'could not parse `board.mjs show --json`'); }
}

/** The log's events for one ticket, oldest first. Unparseable lines are skipped (board.mjs verify owns integrity). */
function ticketEvents(root, id) {
  let text = '';
  try { text = readFileSync(join(root, 'docs', '31-board-events.jsonl'), 'utf8'); } catch { return []; }
  return text.split('\n').flatMap((l) => { try { const e = JSON.parse(l); return String(e.ticket).toUpperCase() === id.toUpperCase() ? [e] : []; } catch { return []; } });
}
/** The evidence record the latest `verified`/`verified_static` cited, or ''. */
const latestEvidence = (root, id) => ticketEvents(root, id).filter((e) => (e.event === 'verified' || e.event === 'verified_static') && e.detail?.evidence).pop()?.detail.evidence || '';

/** The ticket's one branch, by the shared matcher. `{branch, ambiguous}`. */
function ticketBranch(root, id, allIds) {
  const mine = tryGit(root, ['branch', '--format=%(refname:short)']).split('\n').filter((b) => b && matchesTicket(b, id, allIds));
  return { branch: mine.length === 1 ? mine[0] : '', ambiguous: mine.length > 1 ? mine : [] };
}

/** The latest persisted report for EXACTLY this ID (`<ID>-<UTC>.md`) whose text is a DONE report. */
function latestDone(root, id) {
  const dir = join(root, 'docs', 'team', 'reports');
  if (!existsSync(dir)) return null;
  const re = new RegExp(`^${escapeRe(id)}-\\d{8}T[0-9]+Z\\.md$`, 'i');
  const file = readdirSync(dir)
    .filter((f) => re.test(f) && readFileSync(join(dir, f), 'utf8').trimStart().startsWith('DONE:')).sort().pop();
  return file ? { file, text: readFileSync(join(dir, file), 'utf8').trim() } : null;
}

function resolveRoot() {
  if (typeof flags.root === 'string') return resolve(flags.root);
  const resolved = resolveProjectRoot({ explicit: typeof flags['project-root'] === 'string' ? flags['project-root'] : '' });
  if (!resolved.ok) die(2, explainRootFailure(resolved));
  return resolved.root;
}

function emit(role, ticket, lines, skillKey) {
  const text = lines.filter((l) => l !== null).join('\n') + '\n';
  reportBudget(role, ticket, text, skillKey);
  process.stdout.write(text);
  process.exit(0);
}

function cmdCompose() {
  const ticket = String(flags.ticket || '');
  const role = String(flags.role || '');
  const mode = typeof flags.mode === 'string' ? flags.mode : '';
  if (!role) die(2, 'compose needs --role <role>');
  if (mode && mode !== 'design-qa') die(2, `unknown --mode "${mode}" (only design-qa)`);
  if (mode && !DESIGN_QA_ROLES.has(role)) die(2, `--mode design-qa is run by ${[...DESIGN_QA_ROLES].join(' or ')}, never by "${role}" (never product-designer on its own design).`);
  const contract = contractFor(role);
  if (!contract && !REVIEW_ROLES.has(role) && role !== 'release-auditor') {
    die(2, `"${role}" is not a ticket-owning role in either contract tier (see lib/contract.mjs), nor a gate role with a template.`);
  }
  const ROOT = resolveRoot();
  if (role === 'release-auditor') return composeAudit(ROOT, ticket);
  if (!ticket) die(2, 'compose needs --ticket <ID>');

  const rows = boardRows(ROOT);
  const row = rows[ticket.toUpperCase()];
  if (!row) die(2, `${ticket} is not on the board.`);
  const allIds = Object.values(rows).map((r) => r.id);

  let base = typeof flags['integration-branch'] === 'string' ? flags['integration-branch'] : '';
  if (!base) {
    try { base = execFileSync('sh', [resolve(HERE, 'integration-branch.sh')], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { base = ''; }
  }
  const ctx = { ROOT, row, rows, allIds, base, role };

  if (mode === 'design-qa') return composeDesignQa(ctx);
  if (REVIEW_ROLES.has(role)) return composeReview(ctx);
  if (role === 'verification-engineer' && row.owner !== role) return composeVerify(ctx);
  return composeIc(ctx, contract);
}

/** Where the agent stands: the slot it was leased. Says so when the slot is not there yet. */
function slotFor(ROOT, role, id) {
  const slot = typeof flags.slot === 'string' ? flags.slot : `.agent-wt/${role}`;
  if (!existsSync(resolve(ROOT, slot))) {
    process.stderr.write(`spawn-prompt: WARNING — slot ${slot} does not exist. Lease one first (worktree-slot.mjs lease --owner ${role} --tickets ${id}) and pass --slot <the path it prints>.\n`);
  }
  return slot;
}

function composeIc({ ROOT, row, rows, allIds, base, role }, contract) {
  const slot = slotFor(ROOT, role, row.id);
  const qa = role === 'qa-engineer' && /^QA-/i.test(row.id);
  const [specFile, anchor] = String(row.spec || '').split('#');
  const excerpt = qa ? [] : specExcerpt(ROOT, [...new Set([PLATFORM_SPEC[role], specFile, 'docs/10-prd.md'].filter(Boolean))],
    [row.id, row.feature, anchor, ...(String(row.acceptance || '').match(/\b[A-Z]{1,6}-\d+(?:\.\d+)?\b/g) || [])]);

  // --retry: the branch already exists and carries the last cycle; re-branching from the base
  // would throw that work away or fork it (C2-11). The model goes one tier up per review cycle.
  let start;
  if (flags.retry) {
    const vf = String(flags.retry);
    const abs = resolve(ROOT, vf);
    if (!existsSync(abs)) die(2, `--retry: no verdict file at ${vf}`);
    const { branch, ambiguous } = ticketBranch(ROOT, row.id, allIds);
    if (!branch) die(2, ambiguous.length ? `--retry: several branches are ${row.id}'s (${ambiguous.join(', ')}) — delete the stray one first` : `--retry: no branch is named for ${row.id}; this is not a retry`);
    const fm = (readFileSync(resolve(HERE, '..', 'agents', `${role}.md`), 'utf8').match(/^model:\s*(\S+)/m) || [])[1] || 'sonnet';
    const at = Math.max(0, MODEL_LADDER.indexOf(fm));
    const tier = MODEL_LADDER[Math.min(at + Math.max(1, Number(row.cycles || 0)), MODEL_LADDER.length - 1)];
    process.stderr.write(`spawn-prompt: RETRY ${row.id} cycle ${row.cycles || 0} — spawn with model: ${tier} (agent default ${fm}, one tier up per review cycle, capped at opus)\n`);
    start = [
      `**This is a RETRY after review.** Your branch \`${branch}\` already exists — \`git checkout ${branch}\` in your slot.`,
      'Do NOT create a new branch and do NOT re-branch from the base: commit the fix on that branch.',
      `Fix exactly the \`Blocking:\` lines of \`${vf}\` (verbatim below), then return the full contract again.`,
      '', ...fence(readFileSync(abs, 'utf8').trim()),
    ];
  } else {
    start = base
      ? [`Base: \`${base}\` (the integration branch). Your FIRST action in your slot, before writing any file:`, '',
        ...fence(`git checkout -b feat/${row.id}-<short-slug> ${base}`)]
      : ['Base: UNKNOWN — no integration branch resolved (scripts/integration-branch.sh). Return BLOCKED rather than guess one.'];
  }

  const lines = [
    `Work ticket ${row.id}.`,
    '',
    `Your project root is \`${slot}\`. That is your worktree. Do not leave it.`,
    '',
    'Board row (verbatim):',
    '',
    '```',
    `ID:         ${row.id}`,
    `Feature:    ${row.feature || '—'}`,
    `Title:      ${row.title || '—'}`,
    `Owner:      ${row.owner || '—'}`,
    `Reviewer:   ${row.reviewer || '—'}`,
    `Spec:       ${row.spec || '—'}`,
    `Acceptance: ${row.acceptance || '—'}`,
    `Estimate:   ${row.estimate || '—'}`,
    `Status:     ${row.status || '—'}`,
    `Depends on: ${(row.dependsOn || []).join(', ') || '—'}`,
    row.files?.length ? `Files:      ${row.files.join(', ')}` : null,
    '```',
    '',
    ...start,
    '',
    ...(qa ? qaWave(ROOT, rows) : [
      'Read, in order: the impl spec your role file names, then whichever of `docs/12-flows.md`,',
      '`docs/13-design-tokens.md`, `docs/14-components.md`, `docs/52-analytics.md`, `docs/40-api.md`',
      'the ticket actually touches.',
      ...excerpt,
    ]),
    '',
    'Do not edit the specs. If you are blocked, flag the blocker and stop — do not guess.',
    ...(qa ? [] : tokenLines(ROOT, role, row.id)),
    '',
    '**Expected output contract.** Return exactly this block, with every field filled in — a',
    'pointer to a skill or a role file is not a substitute; this text, completed:',
    '',
    ...fence(contractBlock(role, { ticket: row.id })),
    '',
    'If blocked, return this instead:',
    '',
    ...fence(BLOCKED_BLOCK(row.id)),
  ];
  emit(role, row.id, lines, contract.tier === 'code' ? 'code' : (MANDATORY_SKILLS[role] ? role : 'artifact'));
}

/**
 * The QA ticket's wave: every ticket QA must pass or fail (`--tickets`, default every non-QA row at
 * `qa`), each with its acceptance, its evidence on record, and its OWN qa-engineer token — a token
 * minted for the QA- ticket could never write `qa_passed` on APP-NNN (W2-1). QA records its verdicts
 * itself; the orchestrator only checks them.
 */
function qaWave(ROOT, rows) {
  const wanted = typeof flags.tickets === 'string' ? flags.tickets.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const wave = wanted
    ? wanted.map((id) => rows[id.toUpperCase()] || die(2, `--tickets: ${id} is not on the board`))
    : Object.values(rows).filter((r) => r.status === 'qa' && !/^QA-/i.test(r.id));
  if (!wave.length) die(2, 'no ticket of this wave is at `qa` — nothing to QA (a wave made only of QA tickets gets no QA ticket). Pass --tickets A,B to name them.');
  const tokens = new Map(tokensFor(ROOT, 'qa-engineer', wave.map((r) => r.id)).map((t) => [t.ticket, t.token]));
  return [
    `**The wave you QA — ${wave.length} ticket(s).** Exercise each acceptance criterion against the merged build`,
    '(drive the P0 journey per `runtime-gate` where a driver exists), file defects in `docs/51-bugs.md`, and record',
    'each verdict YOURSELF with the commands below. After a `RUNTIME GATE: FAIL` no ticket gets `qa_passed`.',
    '',
    ...wave.flatMap((r) => [
      `### ${r.id} — ${r.title || '—'}`,
      `Owner: ${r.owner || '—'} · Acceptance: ${r.acceptance || '—'}`,
      `Evidence on record: ${latestEvidence(ROOT, r.id) || 'none — use docs/team/journey-result.json, or the post-merge verify-done record'}`,
      tokens.has(r.id) ? `Token for ${r.id}: ${tokens.get(r.id)}` : null,
      '',
    ]),
    'Record, per ticket (its own token — never another ticket\'s):',
    '',
    ...fence([
      `node "${BOARD}" move <ID> qa_passed --by qa-engineer${tokens.size ? ' --token "<Token for ID>"' : ''} \\`,
      '  --evidence <docs/team/journey-result.json | that ticket\'s evidence on record, a run on the merged tree>',
      `node "${BOARD}" move <ID> qa_failed --by qa-engineer${tokens.size ? ' --token "<Token for ID>"' : ''} --detail "BUG-NNN"`,
    ].join('\n')),
    '',
    'Your own ticket is the QA pass itself: its branch holds the test-plan updates and bug entries (a docs-only branch).',
  ];
}

/** The reviewer is in the main checkout; anything it runs or edits is in a throwaway worktree (C2-9). */
const scratchLines = (ROOT, tip) => [
  `You stay in the main checkout \`${ROOT}\` — do not create, lease or enter a slot, and never edit the developer's tree.`,
  'Read the branch from here (`git diff <base>...<branch>`, `git show`). Anything you RUN or EDIT happens in a scratch worktree:',
  '',
  ...fence([`T=$(mktemp -d) && git worktree add --detach "$T" ${tip || '<the branch tip>'}`,
    '# ...run the tests, revert lines, reintroduce the defect — inside "$T" only...',
    'git worktree remove --force "$T"      # always, pass or fail'].join('\n')),
];

function reviewSubject(ROOT, row, allIds, base) {
  const report = latestDone(ROOT, row.id);
  if (!report) process.stderr.write(`spawn-prompt: WARNING — no persisted DONE report for ${row.id} in docs/team/reports/ (hooks/persist-ic-report.sh writes one when the IC stops).\n`);
  const named = report ? (report.text.match(/^Branch:\s*(\S+)/m) || [])[1] : '';
  const found = ticketBranch(ROOT, row.id, allIds);
  const branch = (named && tryGit(ROOT, ['rev-parse', '--verify', `${named}^{commit}`]) ? named : '') || found.branch;
  const tip = branch ? tryGit(ROOT, ['rev-parse', '--verify', `${branch}^{commit}`]) : '';
  const mergeBase = tip && base ? tryGit(ROOT, ['merge-base', base, tip]) : '';
  return { report, branch, tip, mergeBase, ambiguous: found.ambiguous };
}

/**
 * The review template — code-reviewer, tech-lead (second approval) and security-reviewer (per-ticket
 * review): the IC's own DONE report, the base and bound range, the evidence and context the binding
 * hashes, and the exact command that records the verdict with this agent's own token.
 */
function composeReview({ ROOT, row, allIds, base, role }) {
  const { report, branch, tip, mergeBase, ambiguous } = reviewSubject(ROOT, row, allIds, base);
  const cycle = Number(row.cycles || 0);
  const suffix = { 'code-reviewer': '', 'tech-lead': '-tech-lead', 'security-reviewer': '-security' }[role];
  const verdictFile = `docs/53-reviews/${row.id}-cycle-${cycle}${suffix}.md`;
  const policy = readJson(join(ROOT, '.studio-policy.json'));
  const evidence = latestEvidence(ROOT, row.id);
  const context = existsSync(join(ROOT, 'docs', 'team', 'context-manifest.json')) ? 'docs/team/context-manifest.json' : '';
  const [tok] = tokensFor(ROOT, role, [row.id]);
  const T = tok ? ` --token ${tok.token}` : '';
  const bind = policy.requireApprovalBinding === true
    ? ` \\\n  --bind --commit ${tip || '<the commit you reviewed>'} --base ${mergeBase || '<base>'} \\\n  --evidence ${evidence || '<the verify-done record you reviewed>'} --context ${context || '<the context manifest or spec you reviewed>'}`
    : '';
  const what = {
    'code-reviewer': 'Review this ticket\'s branch, not the whole app.',
    'tech-lead': 'SECOND APPROVAL (high-risk ticket): read the reviewer\'s verdict and the diff, and judge the design risk the reviewer is not placed to — migration path, auth boundary, what breaks on rollback. Approve the SAME head the reviewer approved.',
    'security-reviewer': 'PER-TICKET SECURITY REVIEW (required on the critical tier): credentials, network safety, data at rest, permissions, auth flows — severity-classified. Never approve over a critical or high.',
  }[role];
  const roleFields = {
    'code-reviewer': ['Constants routed to verification-engineer: <which, or "none in this diff">',
      'Rules routed to verification-engineer: <which, or "none in this diff">'],
    'tech-lead': ['Design risk: <migration path, auth boundary, rollback — what you judged, and how>'],
    'security-reviewer': ['Security findings: <severity — file:line — what, one per line, or "none">'],
  }[role];

  const lines = [
    `Review ticket ${row.id}.`,
    '',
    what,
    '',
    ...scratchLines(ROOT, tip),
    '',
    'Board row (verbatim):',
    '',
    '```',
    `ID:         ${row.id}`,
    `Title:      ${row.title || '—'}`,
    `Owner:      ${row.owner || '—'}`,
    `Spec:       ${row.spec || '—'}`,
    `Acceptance: ${row.acceptance || '—'}`,
    `Cycles:     ${cycle}`,
    '```',
    '',
    `Ticket branch: ${branch || `NOT FOUND${ambiguous.length ? ` (ambiguous: ${ambiguous.join(', ')})` : ''} — say so under ## Not checked`}`,
    `Branch tip:    ${tip || 'UNKNOWN'}`,
    `Base:          ${base || 'UNKNOWN (no integration branch)'}${mergeBase ? ` — merge-base ${mergeBase}` : ''}`,
    `Range:         ${mergeBase && tip ? `${mergeBase}..${tip}` : 'could not derive'}  → your verdict's line is \`Scope: ${mergeBase && tip ? `${mergeBase}..${tip}` : '<base>..<the commit you bind>'}\``,
    `Evidence:      ${evidence || 'NONE on record (no verified/verified_static cited one)'}`,
    `Context:       ${context || 'docs/team/context-manifest.json is MISSING'}`,
    '',
    report
      ? `**The developer's DONE report** (\`docs/team/reports/${report.file}\`, verbatim — re-verify every claim, trust none):`
      : `**No persisted DONE report for ${row.id}.** Review against the board row and the branch, and say so under \`## Not checked\`.`,
    ...(report ? ['', ...fence(report.text)] : []),
    ...(tok ? ['', `Token: ${tok.token}`, `Pass \`--token ${tok.token}\` on every gate event you write for ${row.id}. It proves your role for this ticket only; never write it to a file or hand it on.`] : []),
    '',
    `Write the verdict to \`${verdictFile}\` in the main checkout (an operational path — do not commit it), then record it:`,
    '',
    ...fence([
      `node "${BOARD}" move ${row.id} started --by ${role}`,
      `node "${BOARD}" move ${row.id} approved --by ${role}${T} --verdict ${verdictFile}${bind}`,
      `node "${BOARD}" move ${row.id} changes --by ${role}${T} --verdict ${verdictFile}`,
    ].join('\n')),
    '',
    'Return the same block verbatim. **Expected output contract** — every field filled in:',
    '',
    ...fence([
      'REVIEW VERDICT: APPROVE | REQUEST CHANGES',
      `Ticket: ${row.id}`,
      'Scope: <base>..<the commit you bind>',
      'Track: <floor | light | standard | full> — <why, if raised>',
      `Recorded: \`board.mjs move ${row.id} approved|changes --by ${role}\` (exit 0)`,
      'Acceptance (black-box): <criterion → pass/fail, one line each>',
      'Second-path check: <writers/readers grepped, and the invariant holding on each>',
      ...roleFields,
      'Branch contains only this ticket: <yes | no — which files>',
      'Blocking: <none | file:line, what is wrong, what to do>',
      'Notes (non-blocking): <list, or "none">',
      '',
      '## Not checked',
      '<each item not done and why — or "Nothing — every item above was executed.">',
    ].join('\n')),
    '',
    'If you cannot review this ticket (e.g. self-review), return instead:',
    '',
    ...fence(BLOCKED_BLOCK(row.id)),
  ];
  emit(role, row.id, lines);
}

/** Design QA: the five questions, against the flows and the component inventory. Records nothing. */
function composeDesignQa({ ROOT, row, allIds, base, role }) {
  const { branch, tip, mergeBase } = reviewSubject(ROOT, row, allIds, base);
  const lines = [
    `Design QA ticket ${row.id}.`,
    '',
    `You judge someone else's build — ${row.title || row.id} — against \`docs/12-flows.md\` and \`docs/14-components.md\`.`,
    '',
    ...scratchLines(ROOT, tip),
    '',
    `Ticket branch: ${branch || 'NOT FOUND — say so under ## Not checked'}`,
    `Branch tip:    ${tip || 'UNKNOWN'}`,
    `Base:          ${base || 'UNKNOWN'}`,
    `Acceptance:    ${row.acceptance || '—'}`,
    '',
    'You write no board event. A FAIL is recorded by the orchestrator (`changes --by tech-manager --verdict <FAIL file>`).',
    '',
    '**Expected output contract** — your final message, every line filled in:',
    '',
    ...fence([
      'DESIGN QA: PASS | FAIL — <n> item(s)',
      `Ticket: ${row.id}`,
      `Scope: ${mergeBase && tip ? `${mergeBase}..${tip}` : '<base>..<the commit you read>'}`,
      'Implementation versus design: <pass/fail — what you compared>',
      'Component consistency: <pass/fail — any unrecorded one-off>',
      'State completeness: <every state the inventory lists → seen / missing>',
      'Responsive behaviour: <smallest and largest size, largest font scale>',
      'Accessibility implementation: <accessibility-gate result against the build>',
      '',
      '## Not checked',
      '<each item not done and why — or "Nothing — every item above was executed.">',
    ].join('\n')),
    '',
    'If you cannot judge it (e.g. you designed it), return instead:',
    '',
    ...fence(BLOCKED_BLOCK(row.id)),
  ];
  emit(role, row.id, lines, 'design-qa');
}

/** Verification of what a reviewer routed: the constants and rules named in its verdict file. */
function composeVerify({ ROOT, row, allIds, base, role }) {
  const { branch, tip } = reviewSubject(ROOT, row, allIds, base);
  const vf = join(ROOT, 'docs', '53-reviews', `${row.id}-cycle-${Number(row.cycles || 0)}.md`);
  const routed = existsSync(vf) ? readFileSync(vf, 'utf8').split('\n').filter((l) => /^(Constants|Rules) routed to verification-engineer:/.test(l)) : [];
  const lines = [
    `Verify ticket ${row.id}.`,
    '',
    'Certify what the reviewer routed to you — run it, do not read it. A rule is not verified until you have watched it fail.',
    '',
    ...scratchLines(ROOT, tip),
    '',
    `Ticket branch: ${branch || 'NOT FOUND'}`,
    `Branch tip:    ${tip || 'UNKNOWN'}`,
    `Base:          ${base || 'UNKNOWN'}`,
    '',
    routed.length ? `Routed by the reviewer (\`docs/53-reviews/${row.id}-cycle-${Number(row.cycles || 0)}.md\`):` : 'The reviewer\'s verdict file names nothing routed — certify the ticket\'s constants and rules as you find them.',
    ...routed,
    ...tokenLines(ROOT, role, row.id),
    '',
    '**Expected output contract** — your final message:',
    '',
    ...fence([
      'VERIFICATION: PASS | PASS WITH NOTES | FAIL',
      `Ticket: ${row.id}`,
      'Executed: <each constant / rule → the command you ran and what it showed>',
      'Watched it fail: <each rule → the mutation you made and the red result>',
      '',
      '## Not checked',
      '<each item not done and why — or "Nothing — every item above was executed.">',
    ].join('\n')),
  ];
  emit(role, row.id, lines);
}

/** The release audit: artifacts, not summaries. No board ticket needed; it writes no gate event. */
function composeAudit(ROOT, ticket) {
  const lines = [
    `Release audit${ticket ? ` for ${ticket}` : ''}.`,
    '',
    `Project root: \`${ROOT}\` (read-only). Read the artifacts, not the summaries: \`docs/60-releases.md\`, \`docs/50-test-plan.md\`,`,
    '`docs/54-evidence/`, `docs/51-bugs.md`, `docs/team/evidence/`, and every gate verdict. An artifact whose only witness is',
    'release-manager is a claim: mark it unverified. You take no input from release-manager beyond what you can read yourself.',
    '',
    'Write `docs/76-release-audit.md` (Verdict · Checklist · Unverified claims), then return exactly one line:',
    '',
    ...fence('RELEASE AUDIT: PASS | PASS WITH NOTES | FAIL'),
  ];
  emit('release-auditor', ticket || 'release', lines);
}

/**
 * Was the contract actually INLINED, not merely referenced? This is the check H5 argues for: a
 * prompt that says "return the CODE profile defined in team-protocol" contains none of the field
 * labels literally and must fail this, precisely because it failed the loop the same way.
 *
 * BY MODE, NOT ONLY ROLE (R2-8): the first line says which template the prompt is — `Review ticket`,
 * `Design QA ticket`, `Verify ticket`, `Release audit` — and a contract role whose prompt is not
 * `Work ticket X.` but demands its gate line (`ANALYTICS:`, `ASO READY`, `DESIGN QA:`,
 * `VERIFICATION:`) is a gate spawn that owes that line, not a DONE block.
 */
function fieldsFor(role, text) {
  const first = (String(text).split('\n').find((l) => l.trim()) || '').trim();
  if (/^Review ticket /.test(first) && REVIEW_ROLES.has(role)) return { tier: 'review', fields: REVIEW_FIELDS };
  if (/^Design QA ticket /.test(first) && DESIGN_QA_ROLES.has(role)) return { tier: 'design-qa', fields: DESIGN_QA_FIELDS };
  if (/^Verify ticket /.test(first) && role === 'verification-engineer') return { tier: 'verification', fields: VERIFY_FIELDS };
  if (role === 'release-auditor') return { tier: 'release-audit', fields: AUDIT_FIELDS };
  if (REVIEW_ROLES.has(role)) return { tier: 'review', fields: REVIEW_FIELDS };
  const contract = contractFor(role);
  if (!contract) return null;
  const gate = /^Work ticket /.test(first) ? '' : (GATE_HEADERS[role] || []).find((h) => text.includes(h));
  return gate ? { tier: `${gate.replace(/:$/, '')} gate`, fields: [gate] } : contract;
}

function cmdVerify() {
  const role = String(flags.role || '');
  if (!role) die(2, 'verify needs --role <role>');
  if (!contractFor(role) && !REVIEW_ROLES.has(role) && role !== 'release-auditor') die(2, `"${role}" is not a ticket-owning role in either contract tier, nor a gate role with a template.`);

  let text = '';
  if (typeof flags.prompt === 'string') {
    const p = resolve(String(flags.prompt));
    if (!existsSync(p)) die(2, `no prompt at ${flags.prompt}`);
    text = readFileSync(p, 'utf8');
  } else {
    try { text = readFileSync(0, 'utf8'); } catch { text = ''; }
  }
  if (!text.trim()) die(2, 'no prompt to check — pass --prompt <file> or pipe it on stdin');
  const contract = fieldsFor(role, text);

  const missing = contract.fields.filter((f) => !text.includes(f));
  if (!missing.length) {
    process.stdout.write(`SPAWN PROMPT: CONTRACT INLINED — all ${contract.fields.length} ${contract.tier}-tier field labels are present in the prompt text.\n`);
    process.exit(0);
  }
  process.stdout.write(
    `SPAWN PROMPT: CONTRACT NOT INLINED — missing ${missing.length} of ${contract.fields.length} field label(s): ${missing.join(' ')}\n\n` +
    '  This is the H5 failure: a prompt that POINTS AT the contract instead of containing it\n' +
    '  produces an agent that returns none of it — measured, not assumed. Compose the prompt with:\n' +
    `    node scripts/spawn-prompt.mjs compose --root <project> --ticket <ID> --role ${role}\n` +
    '  and use its output as the spawn message verbatim, rather than a reference to team-protocol.\n'
  );
  process.exit(1);
}

switch (command) {
  case 'compose': cmdCompose(); break;
  case 'verify': cmdVerify(); break;
  default:
    die(2, `unknown command "${command ?? ''}"\n` +
           '  compose --root <project> --ticket <ID> --role <role> [--slot <path>] [--integration-branch <name>]\n' +
           '          [--mode design-qa] [--retry <verdict file>] [--tickets A,B]\n' +
           '  verify  --role <role> [--prompt <file>]');
}
