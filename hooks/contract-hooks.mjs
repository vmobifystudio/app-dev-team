#!/usr/bin/env node
/**
 * contract-hooks — the spawn and report contracts as Claude Code hooks, not as prose (C10, C6).
 *
 * The 2026-11-18 review (C10) listed three steps a literal agent could skip because they were only
 * ever instructions: `spawn-prompt verify` before a spawn, `report-check` after one, and the
 * file-overlap check. Each existed as a script; nothing made anyone run it. These two modes are the
 * harness running them instead.
 *
 *   pre-spawn      PreToolUse on Task|Agent (hooks/require-spawn-contract.sh). For an app-dev-team
 *                  IC or code-reviewer spawned on a ticket that is on the board: refuse when the
 *                  `.studio-stop` kill switch is set (spawn-gate.sh), when the output contract is
 *                  not inlined (spawn-prompt verify), or — code-tier roles — when the ticket's files
 *                  overlap in-flight work (contention-check.mjs, the same call dispatch-preflight
 *                  makes; deterministic, one log read).
 *   subagent-stop  SubagentStop for contract roles (hooks/persist-ic-report.sh). Persist the final
 *                  message to docs/team/reports/<ticket-or-role>-<UTC>.md, run report-check on it,
 *                  and block ONCE per subagent with the exact missing lines when ticket work fails it.
 *
 * NEVER FIRES OUTSIDE A STUDIO PROJECT: no docs/31-board-events.jsonl (in the cwd or the main tree
 * of its git repo) means allow. NOT TICKET WORK IS NOT POLICED: a spawn whose prompt names no ticket
 * on the board (planning, grooming, an audit) passes; a stop whose report names none is persisted
 * but never blocked. ponytail: "names a board ticket" is a grep of the log for the ID — a ticket
 * spawn whose prompt names no ticket at all is not caught, and could not be worked either.
 *
 * FAIL OPEN, like every hook here: unparseable payload, missing node, unreadable state → exit 0.
 * Exit 2 blocks, with the reason on stderr (Claude Code feeds it back to the model).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contractFor } from '../scripts/lib/contract.mjs';

// The scripts this hook runs. It lives in hooks/ so the plugin's script count stays what it says.
const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const allow = () => process.exit(0);
const block = (msg) => { process.stderr.write(`${msg.trimEnd()}\n`); process.exit(2); };
const REVIEW_ROLES = new Set(['code-reviewer']);
const ID_RE = /\b[A-Z][A-Z0-9]*-\d+(?:-[A-Za-z]+)?\b/g;

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

/** Ticket IDs in `text` that the board's log actually carries, first mention first. */
function boardTickets(root, text) {
  let log = '';
  try { log = readFileSync(join(root, 'docs', '31-board-events.jsonl'), 'utf8'); } catch { return []; }
  return [...new Set(String(text).match(ID_RE) || [])].filter((id) => log.includes(`"ticket":"${id}"`));
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
  const report = String(payload.last_assistant_message || '').trim();
  if (!report) allow();

  const head = (report.match(/^(DONE|BLOCKED):\s*(\S+)/m) || []);
  const ticket = head[2] || boardTickets(root, report)[0] || '';
  const dir = join(root, 'docs', 'team', 'reports');
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const file = join(dir, `${(ticket || role).replace(/[^A-Za-z0-9-]/g, '')}-${stamp}.md`);
  try { mkdirSync(dir, { recursive: true }); writeFileSync(file, `${report}\n`); } catch { allow(); }

  if (head[1] === 'BLOCKED' || !ticket) allow();

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

/**
 * guard-gate-writes (PreToolUse on Bash|Write|Edit|MultiEdit). A SUBAGENT (the payload carries
 * `agent_id`) may not mint or revoke actor tokens, touch the token registry, or write gate evidence
 * by hand: those are what make a gate event's role and evidence provable (lib/actor.mjs, evidence.mjs).
 * The main session (no `agent_id`) is the orchestrator and is not restricted. Scripts the agent runs
 * (verify-done.sh, journey-gate) still write evidence themselves — only hand-written paths are refused.
 * Bound: a subagent that writes the path from inside an opaque program (`node -e` with a computed
 * path) is not seen; this stops confused and literal agents, and leaves a hostile one a visible trail.
 */
function guardGateWrites() {
  if (!payload.agent_id) allow();
  if (!projectRoot(payload.cwd)) allow();
  const input = payload.tool_input || {};
  const TOKENS = 'docs/team/actor-tokens.jsonl';
  const EVIDENCE = 'docs/team/evidence/';
  const refuse = (what) => block(`guard-gate-writes: a subagent may not ${what}.\n` +
    '  Actor tokens are minted by the orchestrator (spawn-prompt.mjs compose puts yours in your prompt), and\n' +
    '  gate evidence is written by the scripts that produce it (verify-done.sh, journey-gate, runtime-gate).\n' +
    '  Use the token and the evidence path you were given; if you lack one, return BLOCKED and say so.');
  if (payload.tool_name === 'Bash') {
    const cmd = String(input.command || '');
    if (/\bactor\s+(mint|revoke)\b/.test(cmd)) refuse('mint or revoke actor tokens');
    if (cmd.includes(TOKENS) || cmd.includes('actor-tokens.jsonl')) refuse('read or write the actor token registry');
    if (cmd.includes(EVIDENCE) && /(>|\btee\b|\bcp\b|\bmv\b|\brm\b|\bsed\s+-i|\bln\b|\btouch\b|writeFile)/.test(cmd)) refuse('write gate evidence by hand');
    allow();
  }
  const path = String(input.file_path || '').replace(/\\/g, '/');
  if (path.endsWith(TOKENS)) refuse('write the actor token registry');
  if (path.includes(`/${EVIDENCE}`) || path.startsWith(EVIDENCE)) refuse('write gate evidence by hand');
  allow();
}

switch (process.argv[2]) {
  case 'pre-spawn': preSpawn(); break;
  case 'subagent-stop': subagentStop(); break;
  case 'guard-gate-writes': guardGateWrites(); break;
  default: allow();
}
