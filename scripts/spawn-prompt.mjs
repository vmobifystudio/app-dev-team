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
 * WORD BUDGET (C11). compose prints the prompt's word count plus the role file's to stderr and warns
 * (non-fatal) above the role's budget — IC 4k, reviewer 8k. It is a floor: skills the agent loads
 * on demand are not counted.
 *
 * Usage:
 *   spawn-prompt.mjs compose --root <project> --ticket <ID> --role <role>
 *                    [--slot <path>] [--integration-branch <name>]
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
import { contractFor, contractBlock, BLOCKED_BLOCK } from './lib/contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const die = (code, message) => { process.stderr.write(`spawn-prompt: ${message}\n`); process.exit(code); };

const { flags, positional } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'ticket', 'role', 'slot', 'integration-branch', 'prompt']),
  die,
});
const [command] = positional;

// The review gate's own contract: the three lines board.mjs's readVerdict refuses an append without
// (lib/verdict.mjs), plus `Recorded:`, which require-review-verdict.sh checks against the log.
const REVIEW_ROLES = new Set(['code-reviewer']);
const REVIEW_FIELDS = ['REVIEW VERDICT:', 'Scope:', 'Recorded:', '## Not checked'];
const BUDGET = { ic: 4000, reviewer: 8000 };
const EXCERPT_WORDS = 1500;
const PLATFORM_SPEC = {
  'ios-developer': 'docs/22-impl-spec-ios.md', 'android-developer': 'docs/22-impl-spec-android.md',
  'backend-developer': 'docs/22-impl-spec-backend.md', 'web-developer': 'docs/22-impl-spec-web.md',
  'monetization-engineer': 'docs/41-monetization.md',
};
const words = (t) => (String(t).match(/\S+/g) || []).length;
const tryGit = (root, args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/** Words the agent starts with: this prompt plus its role file. A floor, not the total. */
function reportBudget(role, ticket, text) {
  const roleFile = resolve(HERE, '..', 'agents', `${role}.md`);
  const roleWords = existsSync(roleFile) ? words(readFileSync(roleFile, 'utf8')) : 0;
  const total = words(text) + roleWords;
  const budget = REVIEW_ROLES.has(role) ? BUDGET.reviewer : BUDGET.ic;
  process.stderr.write(`spawn-prompt: ${role} ${ticket}: prompt ${words(text)} words + role file ${roleWords} = ${total} words (budget ${budget}; skills loaded on demand not counted)\n`);
  if (total > budget) process.stderr.write(`spawn-prompt: WARNING — OVER BUDGET by ${total - budget} words. Not a refusal; trim the role file or the specs this ticket pulls in.\n`);
}

function cmdCompose() {
  const ticket = String(flags.ticket || '');
  const role = String(flags.role || '');
  if (!ticket) die(2, 'compose needs --ticket <ID>');
  if (!role) die(2, 'compose needs --role <role>');
  const contract = contractFor(role);
  if (!contract && !REVIEW_ROLES.has(role)) die(2, `"${role}" is not a ticket-owning role in either contract tier (see lib/contract.mjs), nor a reviewer with a template.`);

  let ROOT;
  if (typeof flags.root === 'string') ROOT = resolve(flags.root);
  else {
    const resolved = resolveProjectRoot({ explicit: typeof flags['project-root'] === 'string' ? flags['project-root'] : '' });
    if (!resolved.ok) die(2, explainRootFailure(resolved));
    ROOT = resolved.root;
  }

  let row;
  try {
    const out = execFileSync(process.execPath, [resolve(HERE, 'board.mjs'), 'show', ticket, '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    row = JSON.parse(out)[ticket.toUpperCase()] ?? Object.values(JSON.parse(out))[0];
  } catch (e) {
    die(2, `could not read ${ticket} from the board: ${String(e.stderr || e.message).trim()}`);
  }
  if (!row) die(2, `${ticket} is not on the board.`);

  const slot = typeof flags.slot === 'string' ? flags.slot : `.agent-wt/${role}`;
  let base = typeof flags['integration-branch'] === 'string' ? flags['integration-branch'] : '';
  if (!base) {
    try { base = execFileSync('sh', [resolve(HERE, 'integration-branch.sh')], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { base = ''; }
  }

  if (REVIEW_ROLES.has(role)) composeReview(ROOT, row, slot, base);

  const [specFile, anchor] = String(row.spec || '').split('#');
  const excerpt = specExcerpt(ROOT, [...new Set([PLATFORM_SPEC[role], specFile, 'docs/10-prd.md'].filter(Boolean))],
    [row.id, row.feature, anchor, ...(String(row.acceptance || '').match(/\b[A-Z]{1,6}-\d+(?:\.\d+)?\b/g) || [])]);

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
    'Read, in order: the impl spec your role file names, then whichever of `docs/12-flows.md`,',
    '`docs/13-design-tokens.md`, `docs/14-components.md`, `docs/52-analytics.md`, `docs/40-api.md`',
    'the ticket actually touches.',
    ...excerpt,
    '',
    base ? `The integration branch for this project is \`${base}\`.` : null,
    '',
    'Do not edit the specs. If you are blocked, flag the blocker and stop — do not guess.',
    '',
    '**Expected output contract.** Return exactly this block, with every field filled in — a',
    'pointer to a skill or a role file is not a substitute; this text, completed:',
    '',
    '```',
    contractBlock(role, { ticket: row.id }),
    '```',
    '',
    `If blocked, return this instead:`,
    '',
    '```',
    BLOCKED_BLOCK(row.id),
    '```',
  ].filter((l) => l !== null);

  const text = lines.join('\n') + '\n';
  reportBudget(role, row.id, text);
  process.stdout.write(text);
  process.exit(0);
}

/** The reviewer template: the IC's own persisted DONE report, the branch tip, the verdict contract. */
function composeReview(ROOT, row, slot, base) {
  const dir = join(ROOT, 'docs', 'team', 'reports');
  const latest = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.startsWith(`${row.id}-`) && f.endsWith('.md')).sort().pop()
    : undefined;
  const report = latest ? readFileSync(join(dir, latest), 'utf8').trim() : '';
  if (!latest) process.stderr.write(`spawn-prompt: WARNING — no persisted report for ${row.id} in docs/team/reports/ (hooks/persist-ic-report.sh writes one when the IC stops).\n`);
  const branch = (report.match(/^Branch:\s*(\S+)/m) || [])[1]
    || tryGit(ROOT, ['for-each-ref', '--format=%(refname:short)', `refs/heads/*${row.id}*`, `refs/heads/*/${row.id}*`]).split('\n')[0];
  const tip = branch ? tryGit(ROOT, ['rev-parse', '--verify', `${branch}^{commit}`]) : '';
  const mergeBase = tip && base ? tryGit(ROOT, ['merge-base', base, tip]) : '';
  const cycle = Number(row.cycles || 0);

  const lines = [
    `Review ticket ${row.id}.`,
    '',
    `Your project root is \`${slot}\`. Review this ticket's branch, not the whole app.`,
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
    `Ticket branch: ${branch || 'NOT FOUND — say so under ## Not checked'}`,
    `Branch tip:    ${tip || 'UNKNOWN'}`,
    `Range:         ${mergeBase && tip ? `${mergeBase}..${tip}` : `could not derive${base ? '' : ' (no integration branch)'}`}`,
    '',
    latest
      ? `**The developer's DONE report** (\`docs/team/reports/${latest}\`, verbatim — re-verify every claim, trust none):`
      : `**No persisted DONE report for ${row.id}.** Review against the board row and the branch, and say so under \`## Not checked\`.`,
    ...(latest ? ['', '```', report, '```'] : []),
    '',
    `Write the verdict to \`docs/53-reviews/${row.id}-cycle-${cycle}.md\`, record it with`,
    `\`board.mjs move ${row.id} approved|changes --by code-reviewer --verdict <that file>\`, and return the`,
    'same block verbatim. **Expected output contract** — every field filled in:',
    '',
    '```',
    'REVIEW VERDICT: APPROVE | REQUEST CHANGES',
    `Ticket: ${row.id}`,
    'Scope: <base>..<head>',
    'Track: <floor | light | standard | full> — <why, if raised>',
    `Recorded: \`board.mjs move ${row.id} approved|changes --by code-reviewer\` (exit 0)`,
    'Acceptance (black-box): <criterion → pass/fail, one line each>',
    'Second-path check: <writers/readers grepped, and the invariant holding on each>',
    'Branch contains only this ticket: <yes | no — which files>',
    'Blocking: <none | file:line, what is wrong, what to do>',
    'Notes (non-blocking): <list, or "none">',
    '',
    '## Not checked',
    '<each item not done and why — or "Nothing — every item above was executed.">',
    '```',
    '',
    'If you cannot review this ticket (e.g. self-review), return instead:',
    '',
    '```',
    BLOCKED_BLOCK(row.id),
    '```',
  ];
  const text = lines.join('\n') + '\n';
  reportBudget('code-reviewer', row.id, text);
  process.stdout.write(text);
  process.exit(0);
}

/**
 * Was the contract actually INLINED, not merely referenced? This is the check H5 argues for: a
 * prompt that says "return the CODE profile defined in team-protocol" contains none of the field
 * labels literally and must fail this, precisely because it failed the loop the same way.
 */
function cmdVerify() {
  const role = String(flags.role || '');
  if (!role) die(2, 'verify needs --role <role>');
  const contract = REVIEW_ROLES.has(role) ? { tier: 'review', fields: REVIEW_FIELDS } : contractFor(role);
  if (!contract) die(2, `"${role}" is not a ticket-owning role in either contract tier, nor a reviewer with a template.`);

  let text = '';
  if (typeof flags.prompt === 'string') {
    const p = resolve(String(flags.prompt));
    if (!existsSync(p)) die(2, `no prompt at ${flags.prompt}`);
    text = readFileSync(p, 'utf8');
  } else {
    try { text = readFileSync(0, 'utf8'); } catch { text = ''; }
  }
  if (!text.trim()) die(2, 'no prompt to check — pass --prompt <file> or pipe it on stdin');

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
           '  verify  --role <role> [--prompt <file>]');
}
