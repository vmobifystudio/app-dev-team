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
 *                                 (a VE that OWNS the ticket gets the IC template; on a qa-engineer-
 *                                 owned ticket at `qa` it writes the QA verdict, with its token — R7-1)
 *   release-auditor               `Release audit.` (no board ticket needed; writes no gate event)
 *
 * WORD BUDGET (C11, C2-20). compose prints the prompt's words + the role file's + the SKILL.md bodies
 * the role must load (a static map, closed over the skills those skills require) + the House KB packs
 * its role file makes mandatory (C7-6), and warns (non-fatal) above the role's budget. Still a floor:
 * references and external skills loaded on demand are not counted.
 *
 * Usage:
 *   spawn-prompt.mjs compose --root <project> --ticket <ID> --role <role>
 *                    [--slot <path>] [--integration-branch <name>] [--mode design-qa]
 *                    [--retry <verdict file>] [--tickets A,B   (QA: the wave, default every row at qa)]
 *   spawn-prompt.mjs verify --role <role> [--prompt <file>]   (reads stdin if --prompt is omitted)
 *
 * Exit codes:
 *   compose:  0 printed the prompt to stdout · 2 the ticket, role or slot could not be resolved, or
 *             .studio-policy.json is unparseable (C7-12)
 *   verify:   0 the contract is present and inlined (not merely referenced) · 1 it is not · 2 usage
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { contractFor, contractBlock, BLOCKED_BLOCK, GATE_HEADERS } from './lib/contract.mjs';
import { matchesTicket } from './lib/integration.mjs';
import { verifyQaEvidence } from './lib/evidence.mjs';
import { ROLE_GATES } from './lib/capabilities.mjs';
import { parseMessageLog, CLOSING_KINDS } from './lib/messages.mjs';

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
// C4W-13: a QA- prompt carries every ticket of the wave and one token each, so its floor is over the
// IC line by design (role ~1650 + skills ~3220 + ~100 per ticket) — it gets its own line.
// C5W-12: verification-engineer is a GATE role (it certifies, like the reviewers) whose two rulebooks —
// defect-hunting and mutation-testing — are its instruments; role + those + isolation + conventions is
// ~4430 words before the prompt, so it gets its own line rather than a warning on every spawn.
// C7-6 (Sprint 7): the count now includes the KB packs, and each line is the MEASURED real load (prompt
// + role file + mandatory skills + packs, 2026-11-20) plus the 1500-word spec excerpt, so a warning means
// a ticket pulled in more than an ordinary one — not "every spawn". Measured with no excerpt: iOS 5041,
// Android 5013, backend 4499, web 4048, monetization 4160 (→ ic 6600); devops 6612, its role file alone
// ~2.9k (→ devops 8200); VE 5448 own ticket / 5388 gate (→ 7000); QA- base ~5750 + ~100 per wave ticket
// (→ 7000, ~12 tickets); reviewers 3700–5400 (8000 unchanged). Trim a role file, not these lines.
const BUDGET = { ic: 6600, devops: 8200, qa: 7000, verifier: 7000, reviewer: 8000 };
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
// C5W-12: ic-workflow inlines defect-hunting §1 and says "do not load that skill for it", so it is not
// in the IC closure; VE reads runtime-result.json by the command its role file gives, not the skill.
// C7-6: ic-workflow and code-reviewer `[all]` run context-preflight first, so its SKILL.md is mandatory too.
const SKILL_DEPS = { 'ic-workflow': ['agent-isolation', 'context-preflight'] };
/**
 * C7-6: the House KB packs (`knowledge/`) each role file says to load via house-conventions — part of
 * what the agent really reads before its first edit. `platform` is the project's platform pack; it
 * is read from docs/team/project-profile.json (EN-13); with no profile it counts as ios-conventions, the largest.
 */
const KB_PACKS = {
  'ios-developer': ['ios-conventions', 'stack-defaults'], 'android-developer': ['android-conventions', 'stack-defaults'],
  'backend-developer': ['stack-defaults'], 'web-developer': ['web-conventions'], 'monetization-engineer': ['monetization'],
  'devops-engineer': ['git-workflow', 'stack-defaults'], 'test-automation-engineer': ['platform'],
  'data-analyst': ['analytics'], 'aso-specialist': ['aso'], 'ux-architect': ['platform'], 'product-designer': ['platform'],
  'qa-engineer': ['platform'], 'verification-engineer': ['platform'], 'code-reviewer': ['platform'], 'tech-lead': ['platform'],
  'security-reviewer': ['git-workflow'], 'release-auditor': ['git-workflow'],
};
const MANDATORY_SKILLS = {
  code: ['ic-workflow', 'house-conventions'],
  artifact: ['agent-isolation', 'house-conventions'],
  'qa-engineer': ['agent-isolation', 'house-conventions', 'runtime-gate', 'defect-hunting'],
  'verification-engineer': ['agent-isolation', 'house-conventions', 'defect-hunting', 'mutation-testing'],
  'code-reviewer': ['defect-hunting', 'house-conventions', 'context-preflight'],
  'tech-lead': ['house-conventions'],
  'security-reviewer': ['house-conventions'],
  'release-auditor': ['house-conventions', 'board-doctor'],
  'design-qa': ['accessibility-gate', 'house-conventions'],
};
const MODEL_LADDER = ['haiku', 'sonnet', 'opus'];

const words = (t) => (String(t).match(/\S+/g) || []).length;
const tryGit = (root, args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// C7-12: an unparseable policy is exit 2 here, as board.mjs refuses it — never "no tokens", which hands the agent a token refusal instead.
const readPolicy = (root) => { const p = join(root, '.studio-policy.json'); if (!existsSync(p)) return {}; try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return die(2, `cannot parse ${p}: ${e.message}`); } };
const fence = (body) => ['```', body, '```'];

/**
 * The sections of each file that name any token (ticket ID, feature ID, spec anchor, acceptance IDs),
 * whole-word, capped at EXCERPT_WORDS across all files. A heading starts a section; sub-sections are
 * matched on their own. ponytail: keyword match, not semantic — a section that describes the ticket
 * without naming it is missed, which is why every excerpt points at the full file.
 */
const FENCE_RE = /^\s*(```|~~~)/;
/** Sections split at headings OUTSIDE code fences (a `# comment` in a shell block is not a heading). */
function sections(text) {
  const out = [];
  let cur = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (!inFence && /^#{1,6} /.test(line) && cur.length) { out.push(cur); cur = []; }
    if (FENCE_RE.test(line)) inFence = !inFence;
    cur.push(line);
  }
  if (cur.length) out.push(cur);
  return out;
}
/** C7-7: cut a section at whole lines (tables, lists and criteria keep their shape) and close an open fence. */
function cutLines(lines, left) {
  const kept = [];
  let inFence = false;
  for (const line of lines) {
    const n = words(line);
    if (n > left) { if (!kept.length) kept.push(line.trim().split(/\s+/).slice(0, left).join(' ')); break; }
    kept.push(line);
    left -= n;
    if (FENCE_RE.test(line)) inFence = !inFence;
  }
  if (inFence) kept.push('```');
  return [...kept, '[…truncated]'].join('\n');
}

/**
 * CX-8: a matched section keeps its heading, prose and code fences whole, but only the table rows,
 * list items and `[AC-…]`-style lines that name a token — a shared criteria list or feature table put
 * every sibling ticket's acceptance into every prompt. A section whose heading names a token is kept
 * whole. A kept table keeps its header; an indented line follows its item.
 */
const TABLE_RE = /^\s*\|/;
const ITEM_RE = /^ ?(?:[-*+]|\d+[.)])\s|^\s*(?:\*\*)?\[?[A-Z]{1,6}-\d+/;
function narrow(lines, res) {
  const hit = (l) => res.some((r) => r.test(l));
  if (hit(lines[0])) return lines;  // a section whose heading names the ticket is the ticket's own
  const out = [];
  let inFence = false;
  let keepItem = true;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (FENCE_RE.test(l)) inFence = !inFence;
    if (i === 0 || inFence || FENCE_RE.test(l)) { out.push(l); continue; }
    if (TABLE_RE.test(l)) {
      const table = [];
      while (i < lines.length && TABLE_RE.test(lines[i])) table.push(lines[i++]);
      i--;
      const head = /^\s*\|?[\s:|-]*-{3,}/.test(table[1] || '') ? table.slice(0, 2) : [];
      const rows = table.slice(head.length).filter(hit);
      if (rows.length) out.push(...head, ...rows);
      continue;
    }
    if (ITEM_RE.test(l)) { keepItem = hit(l); if (keepItem) out.push(l); continue; }
    if (/^\s{2,}\S/.test(l)) { if (keepItem) out.push(l); continue; }
    keepItem = true;
    out.push(l);
  }
  return out;
}

function specExcerpt(root, files, tokens) {
  const res = tokens.filter(Boolean).map((t) => new RegExp(`(^|[^A-Za-z0-9-])${escapeRe(String(t))}($|[^A-Za-z0-9])`, 'i'));
  const out = [];
  let left = EXCERPT_WORDS;
  for (const file of files) {
    const abs = resolve(root, file);
    if (!existsSync(abs)) continue;
    // C7-7: acceptance first — the PRD leads (`files` order) and, within a file, an Acceptance heading does.
    const hits = sections(readFileSync(abs, 'utf8')).filter((p) => res.some((r) => r.test(p.join('\n'))))
      .map((p, i) => [p, /acceptance/i.test(p[0]) ? 0 : 1, i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([p]) => p);
    out.push('', hits.length ? `From \`${file}\` (full file: \`${file}\`):` : `\`${file}\`: no section names this ticket — read it if the ticket needs it.`);
    for (const h of hits) {
      if (left <= 0) { out.push('', '[…excerpt budget spent — read the full file for the rest]'); break; }
      const body = narrow(h, res).join('\n').trim();
      const n = words(body);
      out.push('', n > left ? cutLines(body.split('\n'), left) : body);
      left -= n;
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
  // EN-13: `platform` is the project profile's platform pack (web/android/ios); ios-conventions only when it names none.
  let plat = '';
  try { plat = String(JSON.parse(readFileSync(resolve(typeof flags.root === 'string' ? flags.root : '.', 'docs/team/project-profile.json'), 'utf8')).platform || ''); } catch { /* no profile */ }
  const platPack = /\bweb\b/i.test(plat) ? 'web-conventions' : /\bandroid\b/i.test(plat) && !/\bios\b/i.test(plat) ? 'android-conventions' : 'ios-conventions';
  const packs = skills.has('house-conventions') ? (KB_PACKS[role] || []).map((p) => (p === 'platform' ? platPack : p)) : [];
  const packWords = packs.reduce((n, p) => n + fileWords(resolve(HERE, '..', 'knowledge', `${p}.md`)), 0);
  const total = words(text) + roleWords + skillWords + packWords;
  const budget = REVIEW_ROLES.has(role) || role === 'release-auditor' || skillKey === 'design-qa' ? BUDGET.reviewer
    : role === 'qa-engineer' && /^QA-/i.test(String(ticket)) ? BUDGET.qa
    : role === 'verification-engineer' ? BUDGET.verifier : role === 'devops-engineer' ? BUDGET.devops : BUDGET.ic;
  process.stderr.write(`spawn-prompt: ${role} ${ticket}: prompt ${words(text)} + role file ${roleWords} + mandatory skills ${skillWords} (${[...skills].join(', ') || 'none'}) + KB packs ${packWords} (${packs.join(', ') || 'none'}) = ${total} words (budget ${budget}; references and skills loaded on demand not counted)\n`);
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
  const policy = readPolicy(root);
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

/**
 * C5W-2: the evidence a QA `qa_passed` should cite — the NEWEST `verified` record on the board (any
 * ticket's: a later wave's run contains this ticket's merge too) that the board's own check accepts
 * for THIS ticket. After a `qa_failed`, the record QA just failed is older than the failure and is
 * never offered; '' when no run since then exists yet.
 */
function qaEvidence(root, id) {
  let text = '';
  try { text = readFileSync(join(root, 'docs', '31-board-events.jsonl'), 'utf8'); } catch { return ''; }
  const all = text.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const mine = all.filter((e) => String(e.ticket).toUpperCase() === id.toUpperCase());
  const last = (name) => mine.filter((e) => e.event === name).pop();
  const merged = last('merged');
  const opts = { ticket: id, mergedTs: merged?.ts || '', mergedHead: merged?.detail?.merged_head || '', failedTs: last('qa_failed')?.ts || '', cwd: root };
  const seen = new Set();
  for (const e of all.filter((x) => x.event === 'verified' && x.detail?.evidence).reverse()) {
    if (seen.has(e.detail.evidence)) continue;
    seen.add(e.detail.evidence);
    if (verifyQaEvidence(root, e.detail.evidence, opts).ok) return e.detail.evidence;
  }
  return '';
}

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

const detailText = (d) => String(typeof d === 'object' && d ? (d.note ?? JSON.stringify(d)) : (d ?? '')).trim();

/** CX-2: the ticket's settled `answer`/`decision` rows from the team channel, newest 10 — the asker and its reviewer both read them. */
function answerLines(root, id) {
  let text = '';
  try { text = readFileSync(join(root, 'docs', 'team', 'messages.jsonl'), 'utf8'); } catch { return []; }
  const rows = parseMessageLog(text).messages
    .filter((m) => CLOSING_KINDS.has(m.kind) && String(m.ticket).toUpperCase() === id.toUpperCase()).slice(-10);
  return rows.length ? ['', `**Answers on record for ${id}** (team channel, verbatim — they settle the spec where it was ambiguous; the code must follow them):`,
    ...rows.map((m) => `- ${m.id} ${m.from} ${m.kind}: ${m.summary}${m.body ? ` — ${m.body}` : ''}${m.artifact ? ` [${m.artifact}]` : ''}`)] : [];
}

/**
 * LN-2: the `Blocking:` lines of the REQUEST CHANGES verdicts on OTHER tickets (each `changes` event
 * names its verdict file), newest first, capped at 10 lines. ponytail: "this sprint" is "this board's
 * log", newest first — a cross-sprint log just fills the cap with the most recent.
 */
function caughtLines(root, id) {
  let text = '';
  try { text = readFileSync(join(root, 'docs', '31-board-events.jsonl'), 'utf8'); } catch { return []; }
  const paths = [...new Set(text.split('\n').flatMap((l) => { try { const e = JSON.parse(l); return e.event === 'changes' && e.detail?.verdict_path && String(e.ticket).toUpperCase() !== id.toUpperCase() ? [e.detail.verdict_path] : []; } catch { return []; } }).reverse())];
  const out = [];
  for (const p of paths) {
    let v = '';
    try { v = readFileSync(resolve(root, p), 'utf8'); } catch { continue; }
    const m = v.match(/^Blocking:[ \t]*(.*)\n((?:[ \t]*(?:[-*]|\d+[.)])[ \t].*\n?)*)/m);
    if (!m) continue;
    for (const l of [m[1], ...m[2].split('\n')].map((s) => s.trim().replace(/^(?:[-*]|\d+[.)])\s+/, '')).filter((s) => s && !/^<?none>?$/i.test(s))) {
      if (out.length < 10) out.push(`- ${l}  (${p})`);
    }
  }
  return out.length ? ['', '**Already caught in review this sprint — do not repeat** (other tickets\' `Blocking:` lines):', ...out] : [];
}

/** CX-3: the latest event that sent this ticket back to its owner. PR49C-4: a `rework`, `rejected`
 * or `reopened` wins over a later `blocked` pause (metadata, as on main) — otherwise the real reason
 * and the CONFLICT rebase line vanish; a `blocked` is the reason only when nothing else sent it back. */
const sentBack = (root, id) => {
  const evs = ticketEvents(root, id);
  return evs.filter((e) => ['rework', 'rejected', 'reopened'].includes(e.event)).pop() || evs.filter((e) => e.event === 'blocked').pop();
};

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
  readPolicy(ROOT);  // C7-12: refuse an unparseable policy before composing anything
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

/**
 * Where the agent stands: the slot it was leased, ABSOLUTE (R7-7: a subagent's Bash cwd resets to the
 * main checkout, so a relative path sends it home). C7-12: a slot that does not exist is exit 2 — a
 * prompt naming a project root that is not there is not a prompt to hand anyone.
 */
function slotFor(ROOT, role, id) {
  const slot = resolve(ROOT, typeof flags.slot === 'string' ? flags.slot : `.agent-wt/${role}`);
  if (!existsSync(slot)) {
    die(2, `slot ${slot} does not exist. Lease one first (worktree-slot.mjs lease --owner ${role} --tickets ${id}) and pass --slot <the path it prints>.`);
  }
  return slot;
}

function composeIc({ ROOT, row, rows, allIds, base, role }, contract) {
  const qa = role === 'qa-engineer' && /^QA-/i.test(row.id);
  // Design A (C3W-1): QA is composed on the wave's docs-only QA- ticket in EVERY lane. A qa-engineer
  // composed with the IC template on an app ticket it does not own cut a second `feat/APP-…` branch
  // for that ticket, and every later branch lookup for it went ambiguous.
  if (role === 'qa-engineer' && !qa && row.owner !== 'qa-engineer') {
    die(2, `${row.id} is not a QA- ticket and qa-engineer does not own it. QA is composed on the wave's QA ticket, in every lane:\n` +
      `  node "${BOARD}" add QA-<sprint>-w<n> --title "QA pass — wave <n>" --owner qa-engineer --by tech-manager\n` +
      `  node "${resolve(HERE, 'spawn-prompt.mjs')}" compose --ticket QA-<sprint>-w<n> --role qa-engineer --tickets ${row.id}[,…]`);
  }
  const artifact = contract.tier === 'artifact' && !qa;
  const branchName = qa ? `qa/${row.id}` : `feat/${row.id}-<short-slug>`;
  const slot = slotFor(ROOT, role, row.id);
  const [specFile, anchor] = String(row.spec || '').split('#');
  const excerpt = qa ? [] : specExcerpt(ROOT, [...new Set(['docs/10-prd.md', PLATFORM_SPEC[role], specFile].filter(Boolean))],
    [row.id, row.feature, anchor, ...(String(row.acceptance || '').match(/\b[A-Z]{1,6}-\d+(?:\.\d+)?\b/g) || [])]);

  // --retry: the branch already exists and carries the last cycle; re-branching from the base
  // would throw that work away or fork it (C2-11). The model goes one tier up per review cycle.
  let start;
  let found;
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
      `**This is a RETRY after review.** Your branch \`${branch}\` already exists — \`git -C "${slot}" checkout ${branch}\`.`,
      'Do NOT create a new branch and do NOT re-branch from the base: commit the fix on that branch.',
      `Fix exactly the \`Blocking:\` lines of \`${vf}\` (verbatim below), then return the full contract again.`,
      '', ...fence(readFileSync(abs, 'utf8').trim()),
    ];
  } else if (!qa && ((found = ticketBranch(ROOT, row.id, allIds)).branch || found.ambiguous.length || sentBack(ROOT, row.id)?.event === 'rework')) {
    // PR47-5: `rework` (the wave could not land it: FAIL / CONFLICT) sends a MERGED ticket back. Its
    // branch exists and carries the reviewed work; a fresh `checkout -b` forked a second branch and
    // `verified` then refused the ambiguity. CX-3: the same holds for EVERY re-spawn onto an existing
    // branch — verify-done REJECTED, report-check INCOMPLETE, blocked then unblocked — and the task is
    // the detail of the event that sent it back.
    const back = sentBack(ROOT, row.id);
    const rework = back?.event === 'rework';
    const why = back ? detailText(back.detail) : '';
    const { branch, ambiguous } = ticketBranch(ROOT, row.id, allIds);
    if (!branch) die(2, ambiguous.length ? `${row.id}: several branches are ${row.id}'s (${ambiguous.join(', ')}) — delete the stray one first` : `rework: no branch is named for ${row.id}, but the board sent it back with rework`);
    start = [
      rework ? `**This is a REWORK: the wave could not land this ticket.** Your branch \`${branch}\` already exists — \`git -C "${slot}" checkout ${branch}\`.`
        : `**This is a RE-SPAWN: your branch \`${branch}\` already exists** — \`git -C "${slot}" checkout ${branch}\`.`,
      'Do NOT create a new branch: commit the fix on that branch, then return the full contract again.',
      ...(rework && /CONFLICT/i.test(why) && base ? [`It CONFLICTED with \`${base}\`: rebase first and resolve — \`git -C "${slot}" rebase ${base}\`.`] : []),
      ...(back ? [`Why it came back (the \`${back.event}\` event, verbatim):`, '', ...fence(why || '(no detail recorded)')] : []),
    ];
  } else if (qa && base && tryGit(ROOT, ['rev-parse', '--verify', '-q', `refs/heads/${branchName}`])) {
    // Codex PR #47 R3: first P0 declarations land BEFORE verdicts (build-loop-branches §Step 5), so QA
    // is re-spawned on its own QA- ticket after landing. Its branch exists; `checkout -b` is fatal.
    start = [
      `**This is the VERDICT PASS.** \`${branchName}\` already exists and its declarations have landed on \`${base}\`.`,
      `Do NOT create a branch and do NOT redo the plan: \`git -C "${slot}" checkout --detach ${base}\` (the landed tree),`,
      're-run the journey gate there, then record a verdict for every ticket below. Return the contract with',
      `\`Branch: ${branchName}\` and \`Files:\` listing only evidence you added (usually none).`,
    ];
  } else {
    start = base
      ? [`Base: \`${base}\` (the integration branch). Your FIRST action, before writing any file:`, '',
        ...fence(`git -C "${slot}" checkout -b ${branchName} ${base}`)]
      : ['Base: UNKNOWN — no integration branch resolved (scripts/integration-branch.sh). Return BLOCKED rather than guess one.'];
  }

  const lines = [
    `Work ticket ${row.id}.`,
    '',
    `Your project root is \`${slot}\`. That is your worktree. Do not leave it.`,
    `Your Bash cwd resets to the main checkout between calls: start EVERY Bash call with \`cd "${slot}" && …\` (or use \`git -C "${slot}" …\`), and write files only under that path.`,
    `Preflight: \`node "${resolve(HERE, 'context-preflight.mjs')}" "${slot}" --ticket ${row.id} --role ${role}\` (a detached HEAD before your first action is expected).`,
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
    ...(qa ? qaWave(ROOT, rows, row) : [
      artifact ? 'Read, in order: your ticket\'s Spec, then whichever of `docs/10-prd.md`, `docs/12-flows.md`,'
        : 'Read, in order: the impl spec your role file names, then whichever of `docs/12-flows.md`,',
      '`docs/13-design-tokens.md`, `docs/14-components.md`, `docs/52-analytics.md`, `docs/40-api.md`',
      'the ticket actually touches.',
      ...excerpt,
      ...answerLines(ROOT, row.id),
      ...caughtLines(ROOT, row.id),
    ]),
    '',
    // R7-6: an artifact ticket IS a document (docs/12-flows.md for ux-architect, …) — "do not edit the specs" forbade the work.
    artifact ? 'Edit only the document(s) your ticket\'s Spec names; no other spec. If you are blocked, return the BLOCKED block below — do not guess.'
      : 'Do not edit the specs. If you are blocked, return the BLOCKED block below — do not guess.',
    ...(qa ? [] : tokenLines(ROOT, role, row.id)),
    '',
    '**Expected output contract.** Return exactly this block, with every field filled in — a',
    'pointer to a skill or a role file is not a substitute; this text, completed:',
    '',
    ...fence(contractBlock(role, { ticket: row.id, ...(qa ? { branch: branchName } : {}) })),
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
function qaWave(ROOT, rows, self) {
  const wanted = typeof flags.tickets === 'string' ? flags.tickets.split(',').map((s) => s.trim()).filter(Boolean) : null;
  // R7-1: a row qa-engineer owns cannot take its own qa_passed — verification-engineer writes that verdict.
  const own = (r) => r.owner === 'qa-engineer';
  const wave = wanted
    ? wanted.map((id) => rows[id.toUpperCase()] || die(2, `--tickets: ${id} is not on the board`))
    : Object.values(rows).filter((r) => r.status === 'qa' && !/^QA-/i.test(r.id) && !own(r));
  const mine = wave.filter(own);
  if (mine.length) die(2, `--tickets: ${mine.map((r) => r.id).join(', ')} ${mine.length > 1 ? 'are' : 'is'} qa-engineer's own — its QA verdict is verification-engineer's:\n  node "${resolve(HERE, 'spawn-prompt.mjs')}" compose --ticket ${mine[0].id} --role verification-engineer`);
  if (!wave.length) die(2, 'no ticket of this wave is at `qa` — nothing to QA (a wave made only of QA tickets gets no QA ticket). Pass --tickets A,B to name them.');
  const tokens = new Map(tokensFor(ROOT, 'qa-engineer', wave.map((r) => r.id)).map((t) => [t.ticket, t.token]));
  return [
    `**The wave you QA — ${wave.length} ticket(s).** Exercise each acceptance criterion against the merged build`,
    '(drive the P0 journey per `runtime-gate` where a driver exists), file defects in `docs/51-bugs.md`, and record',
    'each verdict YOURSELF with the commands below. After a `RUNTIME GATE: FAIL` no ticket gets `qa_passed`.',
    '',
    // C3W-1 / design A: the exact commands per ticket, its ID and its own token spelled out — a
    // `<ID>` template invited one token on every ticket, which the board refuses.
    ...wave.flatMap((r) => {
      const T = tokens.has(r.id) ? ` --token ${tokens.get(r.id)}` : '';
      const ev = qaEvidence(ROOT, r.id);
      return [
        `### ${r.id} — ${r.title || '—'}`,
        `Owner: ${r.owner || '—'} · Acceptance: ${r.acceptance || '—'}`,
        `Evidence on record: ${ev || 'none newer than the merge and any qa_failed — a journey-gate PASS (docs/team/journey-result.json) or the next wave\'s run on the integration branch'}`,
        tokens.has(r.id) ? `Token for ${r.id}: ${tokens.get(r.id)}` : null,
        'Record its verdict with ONE of:',
        ...fence([
          `node "${BOARD}" move ${r.id} qa_passed --by qa-engineer${T} --evidence ${ev || '<docs/team/journey-result.json | a run on the merged tree>'}`,
          `node "${BOARD}" move ${r.id} qa_failed --by qa-engineer${T} --detail "BUG-NNN"`,
        ].join('\n')),
        '',
      ];
    }),
    'Each ticket\'s own token only — never another ticket\'s. If a command is refused for its token, stop and return',
    'BLOCKED naming the ticket: the orchestrator re-spawns you with a freshly composed prompt (you never mint).',
    '',
    `Your own ticket is the QA pass itself: branch \`qa/${self.id}\` holds the test-plan updates, journey declarations and`,
    'bug entries (docs only — no app code). The orchestrator merges it inline; it needs no review.',
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
  const policy = readPolicy(ROOT);
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
    ...answerLines(ROOT, row.id),
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
      // C5W-5: `approved --bind` refuses a verdict that names none of the bound diff's files.
      'Files reviewed: <every path in the Range above (`git diff --name-only`), and what you found in each>',
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
  // PR47-15: not on a QA- ticket — its legal events at `qa` are closed/verified/qa_failed, never qa_passed.
  if (row.owner === 'qa-engineer' && row.status === 'qa' && !/^QA-/i.test(row.id)) return composeQaVerdict({ ROOT, row, allIds, base, role });
  const { branch, tip } = reviewSubject(ROOT, row, allIds, base);
  // R7-5 / C7-4: the file the latest code-reviewer verdict CITED — `changes` bumps `cycles`, so
  // recomputing `<ID>-cycle-<cycles>.md` named a file nobody wrote after every REQUEST CHANGES.
  const rel = ticketEvents(ROOT, row.id).filter((e) => e.by === 'code-reviewer' && (e.event === 'approved' || e.event === 'changes') && e.detail?.verdict_path).pop()?.detail.verdict_path || '';
  const vf = rel ? resolve(ROOT, rel) : '';
  const routed = vf && existsSync(vf) ? readFileSync(vf, 'utf8').split('\n').filter((l) => /^(Constants|Rules) routed to verification-engineer:/.test(l)) : [];
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
    routed.length ? `Routed by the reviewer (\`${rel}\`):`
      : `${rel ? `The reviewer's verdict file (\`${rel}\`)` : 'No code-reviewer verdict on record; it'} names nothing routed — certify the ticket's constants and rules as you find them.`,
    ...routed,
    '',
    // R7-13: this spawn writes no board event (agents/verification-engineer.md), so it carries no token.
    'You write no board event: the orchestrator records a FAIL as `changes`.',
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

/**
 * R7-1: a qa-engineer-owned ticket that is not a `QA-` ticket (an /app-audit test plan) can never
 * take `qa_passed --by qa-engineer` — NOT_ON_OWN_TICKET. verification-engineer writes its QA verdict:
 * its own token, the evidence the board would accept, and the two commands.
 */
function composeQaVerdict({ ROOT, row, allIds, base, role }) {
  const { branch, tip } = reviewSubject(ROOT, row, allIds, base);
  const [tok] = tokensFor(ROOT, role, [row.id]);
  const T = tok ? ` --token ${tok.token}` : '';
  const ev = qaEvidence(ROOT, row.id);
  const lines = [
    `Verify ticket ${row.id}.`,
    '',
    `QA VERDICT for a qa-engineer-owned ticket (${row.title || row.id}): qa-engineer may not pass its own work, so you do.`,
    'Check the merged deliverable against its acceptance — run what can be run, do not read it as done.',
    '',
    ...scratchLines(ROOT, tip),
    '',
    `Ticket branch: ${branch || 'NOT FOUND'}`,
    `Base:          ${base || 'UNKNOWN'}`,
    `Acceptance:    ${row.acceptance || '—'}`,
    `Evidence on record: ${ev || 'none newer than the merge and any qa_failed — the next wave\'s run on the integration branch'}`,
    ...(tok ? ['', `Token: ${tok.token}`, `Pass \`--token ${tok.token}\` on the verdict you write for ${row.id}. It proves your role for this ticket only; never write it to a file or hand it on.`] : []),
    '',
    'Record the verdict YOURSELF with ONE of:',
    '',
    ...fence([
      `node "${BOARD}" move ${row.id} qa_passed --by ${role}${T} --evidence ${ev || '<a run on the merged tree>'}`,
      `node "${BOARD}" move ${row.id} qa_failed --by ${role}${T} --detail "BUG-NNN"`,
    ].join('\n')),
    '',
    '**Expected output contract** — your final message:',
    '',
    ...fence([
      'VERIFICATION: PASS | PASS WITH NOTES | FAIL',
      `Ticket: ${row.id}`,
      'Executed: <each acceptance criterion → the command you ran and what it showed>',
      `Recorded: \`board.mjs move ${row.id} qa_passed|qa_failed --by ${role}\` (exit 0)`,
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
    '  produces an agent that returns none of it — measured, not assumed. The ORCHESTRATOR composes it with:\n' +
    `    node scripts/spawn-prompt.mjs compose --root <project> --ticket <ID> --role ${role}\n` +
    '  and uses its output as the spawn message verbatim. Composing mints the agent\'s tokens, so a\n' +
    '  subagent never composes: it returns BLOCKED and the orchestrator re-spawns.\n'
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
