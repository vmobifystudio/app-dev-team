#!/usr/bin/env node
/**
 * contract-hooks — the spawn and report contracts as Claude Code hooks, not as prose (C10, C6).
 *
 * The 2026-11-18 review (C10) listed three steps a literal agent could skip because they were only
 * ever instructions: `spawn-prompt verify` before a spawn, `report-check` after one, and the
 * file-overlap check. Each existed as a script; nothing made anyone run it. These modes are the
 * harness running them instead.
 *
 *   pre-spawn      PreToolUse on Task|Agent (hooks/require-spawn-contract.sh). For an app-dev-team
 *                  IC or code-reviewer spawned on a ticket that is on the board: refuse when the
 *                  `.studio-stop` kill switch is set (spawn-gate.sh), when the output contract is
 *                  not inlined (spawn-prompt verify — BY MODE: a `Design QA ticket X.` or an
 *                  `ANALYTICS:` gate prompt owes its gate line, not a DONE block), or — code-tier
 *                  roles — when the ticket's files overlap in-flight work (contention-check.mjs).
 *   subagent-stop  SubagentStop for contract roles (hooks/persist-ic-report.sh). Persist the final
 *                  message (or, when the payload lacks it, the last assistant message of the
 *                  subagent's own transcript) to docs/team/reports/<ticket-or-role>-<UTC>.md, run
 *                  report-check on it, and block ONCE per subagent with the exact missing lines when
 *                  ticket work fails it. A report whose first line is the role's GATE line
 *                  (`DESIGN QA:`, `ANALYTICS:`, `ASO READY`, `VERIFICATION:` — lib/contract.mjs
 *                  GATE_HEADERS) is a verdict, not a DONE: persisted, never blocked.
 *   guard-gate-writes  below.
 *
 * NEVER FIRES OUTSIDE A STUDIO PROJECT: no docs/31-board-events.jsonl (in the cwd or the main tree
 * of its git repo) means allow — and the shell wrappers check that before starting node at all
 * (C2-27). NOT TICKET WORK IS NOT POLICED: a spawn whose prompt names no ticket on the board
 * (planning, grooming, an audit) passes; a stop whose report names none is persisted but never
 * blocked. Ticket IDs are WHOLE board IDs: `QA-1-w1` is not `QA-1`, `APP-001-analytics` is not
 * `APP-001` (the longest board ID a mention spells wins).
 *
 * FAIL OPEN, like every hook here: unparseable payload, missing node, unreadable state → exit 0.
 * Exit 2 blocks, with the reason on stderr (Claude Code feeds it back to the model).
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { contractFor, gateHeaderOf } from '../scripts/lib/contract.mjs';

// The scripts this hook runs. It lives in hooks/ so the plugin's script count stays what it says.
const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const allow = () => process.exit(0);
const block = (msg) => { process.stderr.write(`${msg.trimEnd()}\n`); process.exit(2); };
const REVIEW_ROLES = new Set(['code-reviewer']);
// An ID with its suffix segments (`QA-1-w1`, `APP-001-analytics`); boardTickets cuts it back to the
// longest board ID it spells, so a verdict file name `APP-001-cycle-0` still resolves to APP-001.
const ID_RE = /\b[A-Z][A-Z0-9]*-\d+(?:-[A-Za-z0-9]+)*/g;

let payload;
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { allow(); }
if (!payload || typeof payload !== 'object') allow();

/** This plugin's role name, or '' — bare names count, another plugin's namespace does not. */
function roleOf(name) {
  const s = String(name || '');
  const i = s.lastIndexOf(':');
  if (i >= 0 && s.slice(0, i) !== 'app-dev-team') return '';
  return s.slice(i + 1);
}

/** The main tree root (where board.mjs writes) if it, or the cwd, holds a board log; else null. */
function projectRoot(cwd) {
  const dir = cwd || process.cwd();
  let main = dir;
  try {
    main = dirname(execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { /* not a repo — the cwd is the only candidate */ }
  return [main, dir].find((r) => existsSync(join(r, 'docs', '31-board-events.jsonl'))) || null;
}

/** Board ticket IDs `text` names, as WHOLE IDs (the longest board ID each mention spells), first mention first. */
function boardTickets(root, text) {
  let log = '';
  try { log = readFileSync(join(root, 'docs', '31-board-events.jsonl'), 'utf8'); } catch { return []; }
  const ids = new Map([...log.matchAll(/"ticket":"([^"]+)"/g)].map((m) => [m[1].toUpperCase(), m[1]]));
  const out = [];
  for (const mention of String(text).match(ID_RE) || []) {
    const parts = mention.split('-');
    for (let n = parts.length; n >= 2; n--) {
      const id = ids.get(parts.slice(0, n).join('-').toUpperCase());
      if (id) { if (!out.includes(id)) out.push(id); break; }
    }
  }
  return out;
}

/** The last assistant text in a Claude Code transcript (JSONL), or ''. C2-26's fallback. */
function lastAssistantText(path) {
  let lines = [];
  try { lines = readFileSync(String(path), 'utf8').split('\n'); } catch { return ''; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o?.type !== 'assistant' && o?.message?.role !== 'assistant' && o?.role !== 'assistant') continue;
    const c = o.message?.content ?? o.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : '';
    if (text.trim()) return text;
  }
  return '';
}

const node = (script, args, opts = {}) => spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: 'utf8', ...opts });

function preSpawn() {
  const input = payload.tool_input || {};
  const role = roleOf(input.subagent_type);
  const contract = contractFor(role);
  if (!contract && !REVIEW_ROLES.has(role)) allow();
  const root = projectRoot(payload.cwd);
  if (!root) allow();
  const prompt = String(input.prompt || '');
  const tickets = boardTickets(root, prompt);
  if (!tickets.length) allow();

  const gate = spawnSync('sh', [join(HERE, 'spawn-gate.sh'), role], { cwd: root, encoding: 'utf8' });
  if (gate.status === 1) block(`BLOCKED — spawn-gate refused this ${role} spawn:\n${gate.stdout}`);

  const verify = node('spawn-prompt.mjs', ['verify', '--role', role], { input: prompt });
  if (verify.status === 1) {
    block(`BLOCKED — this ${role} spawn prompt does not carry its output contract.\n\n${verify.stdout}\n` +
      `Compose it, then spawn with that output verbatim:\n` +
      `  node "${join(HERE, 'spawn-prompt.mjs')}" compose --root "${root}" --ticket ${tickets[0]} --role ${role}`);
  }

  // Only the ticket this prompt WORKS — "Work ticket X." is spawn-prompt's own first line. A
  // depends-on ID elsewhere in the prompt is not this spawn's file set.
  const worked = (prompt.match(/^Work ticket (\S+?)\.\s*$/m) || [])[1];
  if (contract?.tier === 'code' && worked) {
    const c = node('contention-check.mjs', ['--log', join(root, 'docs', '31-board-events.jsonl'), '--ticket', worked]);
    if (c.status === 1) block(`BLOCKED — ${worked} overlaps work already in flight (contention-check.mjs):\n${c.stdout}`);
  }
  allow();
}

function subagentStop() {
  const role = roleOf(payload.agent_type);
  if (!contractFor(role)) allow();
  const root = projectRoot(payload.cwd);
  if (!root) allow();
  const report = String(payload.last_assistant_message || lastAssistantText(payload.agent_transcript_path) || '').trim();
  if (!report) allow();

  const head = (report.match(/^(DONE|BLOCKED):\s*(\S+)/m) || []);
  const ticket = head[2] || (report.match(/^Ticket:\s*(\S+)/m) || [])[1] || boardTickets(root, report)[0] || '';
  const dir = join(root, 'docs', 'team', 'reports');
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const file = join(dir, `${(ticket || role).replace(/[^A-Za-z0-9-]/g, '')}-${stamp}.md`);
  try { mkdirSync(dir, { recursive: true }); writeFileSync(file, `${report}\n`); } catch { allow(); }

  // A gate verdict (the role judged someone else's work) is not a DONE and owes no DONE contract.
  if (head[1] === 'BLOCKED' || !ticket || gateHeaderOf(role, report)) allow();

  const check = node('report-check.mjs', ['--role', role, '--report', file, '--root', root]);
  const noDone = head[1] !== 'DONE';
  if (check.status !== 1 && !noDone) allow();

  // ONCE PER SUBAGENT. stop_hook_active is Claude Code's own "already continued by a stop hook";
  // the marker covers a harness that does not send it. Never block forever — a second failing stop
  // is let through, and the persisted file still says what was missing.
  const key = createHash('sha256').update(String(payload.agent_id || payload.agent_transcript_path || payload.transcript_path || `${payload.session_id}:${role}`)).digest('hex').slice(0, 16);
  const marker = join(dir, '.blocked', key);
  if (payload.stop_hook_active === true || existsSync(marker)) allow();
  try { mkdirSync(dirname(marker), { recursive: true }); writeFileSync(marker, `${file}\n`); } catch { allow(); }

  block(`BLOCKED (once) — your final report does not meet the ${role} output contract. Saved as ${file}.\n\n` +
    (noDone ? `  MISSING  a first line \`DONE: ${ticket}\` (or \`BLOCKED: ${ticket}\` with Reason: and Need:)\n\n` : '') +
    (check.status === 1 ? check.stdout : '') +
    '\nStop again with the COMPLETE block as your final message — every field, filled in with what you ' +
    'actually did. This hook blocks once; a second incomplete report is let through, and the orchestrator\'s ' +
    'own report-check on the persisted file will refuse it.');
}

/** `p` with symlinks resolved as far as the path exists (the rest appended), so a link INTO a guarded dir is seen. */
function realish(p) {
  let head = p;
  const tail = [];
  while (head && !existsSync(head) && dirname(head) !== head) { tail.unshift(basename(head)); head = dirname(head); }
  try { return join(realpathSync(head), ...tail); } catch { return p; }
}

/**
 * guard-gate-writes (PreToolUse on Bash, the file-writing tools, and Read|Grep|Glob). A SUBAGENT (the
 * payload carries `agent_id`) may not: mint, revoke or list actor tokens (any `board.mjs actor`
 * subcommand, however quoted or computed); load actor.mjs / evidence.mjs into its own program
 * (`node -e`, `--input-type`, a heredoc); touch the token registry; write INTO the gate evidence dir
 * by hand (redirect, tee, cp/mv/ln/install target, rm/touch/sed -i, or a `cd` there followed by a
 * write); start a nested `claude` session (which would arrive with no agent_id and pass every check
 * here — G2-16); or read Claude Code's own transcripts under ~/.claude/projects, where minted tokens
 * sit in the orchestrator's history (G2-15). Write/Edit paths are compared after resolving symlinks
 * (G2-27). The main session (no `agent_id`) is the orchestrator and is not restricted. Scripts the
 * agent runs (verify-done.sh, journey-gate) still write evidence themselves — only hand-written
 * paths are refused; READING evidence, and a `2>&1` next to an evidence path, are fine (C2-4).
 *
 * THE BOUND, STATED: this is a text match over a shell command, not a sandbox. A subagent that
 * builds a path or a module name at runtime inside a program this hook cannot see into (python,
 * a script file it wrote, base64) is not stopped here; it is stopped, if at all, by the mint side
 * (actor.mjs) and by the board re-deriving evidence from git. This stops the confused and the
 * literal, and makes the hostile leave a visible trail in its own transcript.
 */
function guardGateWrites() {
  if (!payload.agent_id) allow();
  const root = projectRoot(payload.cwd);
  if (!root) allow();
  const input = payload.tool_input || {};
  const TOKENS = 'docs/team/actor-tokens.jsonl';
  const EVIDENCE = 'docs/team/evidence/';
  const refuse = (what) => block(`guard-gate-writes: a subagent may not ${what}.\n` +
    '  Actor tokens are minted by the orchestrator (spawn-prompt.mjs compose puts yours in your prompt), and\n' +
    '  gate evidence is written by the scripts that produce it (verify-done.sh, journey-gate, runtime-gate).\n' +
    '  Use the token and the evidence path you were given; if you lack one, return BLOCKED and say so.');
  if (payload.tool_name === 'Bash') {
    // Quotes and backslashes removed first: `actor "mint"`, `a\ctor mint` and `'mint'` are `actor mint`.
    const cmd = String(input.command || '').replace(/["'\\]/g, '');
    if (/\bactor\s+(mint|revoke)\b/.test(cmd)) refuse('mint or revoke actor tokens');
    if (/board\.mjs\b[^;&|\n]*\sactor\s+(?!(mint|revoke)\b)/.test(cmd)) refuse('run a `board.mjs actor` subcommand (the subcommand may be in a variable)');
    if (/\b(mintActorToken|mintToken|revokeActorToken|writeTestEvidence|writeEvidenceLog)\b/.test(cmd)
      || (/\b(node|deno|bun)\b/.test(cmd) && /\b(actor|evidence)\.mjs\b/.test(cmd))) refuse('load the actor or evidence library into a program of its own');
    if (cmd.includes(TOKENS) || cmd.includes('actor-tokens.jsonl')) refuse('read or write the actor token registry');
    if (/(^|[;&|(`\n]|\$\()\s*(?:(?:env|exec|nohup|command|xargs|time|sudo)\s+)*(?:\S*\/)?(claude|claude-code)(\s|$)/.test(cmd)
      || /@anthropic-ai\/claude-code\b/.test(cmd)) refuse('start a nested `claude` session (it would carry no agent_id past these checks)');
    if (/\.claude\/projects\b/.test(cmd)) refuse('read Claude Code session transcripts under ~/.claude/projects');
    const ev = /\S*docs\/team\/evidence\b\S*/;
    const into = new RegExp(`(>>?|\\btee\\s+(?:-a\\s+)?)\\s*${ev.source}`);
    const dest = new RegExp(`\\b(cp|mv|ln|install|rsync)\\b[^;&|\\n]*\\s${ev.source}\\s*($|[;&|\\n])`);
    const touch = new RegExp(`\\b(rm|touch|truncate|sed\\s+-i\\S*|writeFile\\S*)\\b[^;&|\\n]*${ev.source}`);
    const cdThere = /\bcd\s+\S*docs\/team\/evidence\b[\s\S]*(>|\btee\b|\bcp\b|\bmv\b|\brm\b|\btouch\b|\bln\b|\bsed\s+-i)/;
    const viaVar = cmd.includes('docs/team/evidence') && /(^|[^0-9&])>>?\s*\$/.test(cmd);
    if (into.test(cmd) || dest.test(cmd) || touch.test(cmd) || cdThere.test(cmd) || viaVar) refuse('write gate evidence by hand');
    allow();
  }
  const raw = String(input.file_path || input.notebook_path || input.path || '').replace(/\\/g, '/');
  if (!raw) allow();
  const abs = realish(isAbsolute(raw) ? raw : resolve(payload.cwd || process.cwd(), raw));
  if (abs.startsWith(join(realish(homedir()), '.claude', 'projects') + '/') || raw.includes('/.claude/projects/')) {
    refuse('read Claude Code session transcripts under ~/.claude/projects');
  }
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(payload.tool_name)) allow();
  const roots = [...new Set([root, payload.cwd || root].map((r) => realish(resolve(r))))];
  if (raw.endsWith(TOKENS) || roots.some((r) => abs === join(r, TOKENS))) refuse('write the actor token registry');
  if (raw.includes(`/${EVIDENCE}`) || raw.startsWith(EVIDENCE) || roots.some((r) => abs.startsWith(join(r, EVIDENCE)))) refuse('write gate evidence by hand');
  allow();
}

switch (process.argv[2]) {
  case 'pre-spawn': preSpawn(); break;
  case 'subagent-stop': subagentStop(); break;
  case 'guard-gate-writes': guardGateWrites(); break;
  default: allow();
}
