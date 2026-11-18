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
    // Design D: composing MINTS the agent's tokens, so only the orchestrator (the main session, no
    // agent_id) is told to run it. A subagent spawning a studio role is told to hand back instead.
    block(`BLOCKED — this ${role} spawn prompt does not carry its output contract.\n\n` +
      `${payload.agent_id ? verify.stdout.split('\n')[0] : verify.stdout}\n` +
      (payload.agent_id
        ? 'The orchestrator composes every spawn prompt (composing mints the agent\'s tokens); a subagent never\n' +
          `does. Do not spawn ${role} yourself: stop and return BLOCKED naming the ${role} work ${tickets[0]} needs.`
        : `The orchestrator (you) composes it, then spawns with that output verbatim:\n` +
          `  node "${join(HERE, 'spawn-prompt.mjs')}" compose --root "${root}" --ticket ${tickets[0]} --role ${role}`));
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

// ── A small shell reader (Sprint 4, C3G-2/11/12/17, FB2) ─────────────────────────────────────────
// The guard used to match regexes over the command with every quote deleted, which both MISSED
// (`cp -t`, `dd of=`, `docs//team`, `evidenc?`, `$D/studio`) and FALSE-BLOCKED (`--detail "the actor
// field is wrong"`, a commit message saying "actor mint", `grep "actor-tokens.jsonl"`). It now splits
// the command into simple commands of shell WORDS (quotes joined, so a quoted sentence is one word
// and `"mint"` is the word mint), substitutes `NAME=value` assignments made earlier in the same
// command, and resolves every path-like word against the cwd the command has `cd`-ed to. A glob char
// in an unquoted word, or an expansion it cannot resolve, is a WILDCARD — `evidenc?`, `$D/studio`
// and `~/.claude/proj*` match the guarded path they could expand to.
const PLUGIN = resolve(HERE, '..');
const STAR = '\u0001'; // unquoted * (one segment)
const ONE = '\u0002';  // unquoted ? or [..] (one char)
const ANY = '\u0003';  // an expansion this reader cannot resolve (any text, any depth)

/** `[[word, …], …]` simple commands. A word is `{ parts: [{t:'u'|'q', s} | {t:'var', name} | {t:'sub', body}] }`; operators are `{ op }`. */
function shellCommands(src) {
  const cmds = [];
  const heredocs = [];
  let cur = [];
  let word = null;
  const part = (t, s) => { word ||= { parts: [] }; word.parts.push(t === 'var' ? { t, name: s } : t === 'sub' ? { t, body: s } : { t, s }); };
  const endWord = () => { if (word) cur.push(word); word = null; };
  const endCmd = () => { endWord(); if (cur.length) cmds.push(cur); cur = []; };
  // $( … ) / ` … ` / ${ … } body, balanced well enough for a guard: returns [body, next index].
  const balanced = (i, open, close) => {
    let depth = 1; let j = i;
    for (; j < src.length && depth; j++) { if (src[j] === '\\') { j++; continue; } if (src[j] === open && open !== close) depth++; else if (src[j] === close) depth--; }
    return [src.slice(i, j - 1), j];
  };
  const dollar = (i) => { // src[i] === '$'
    const n = src[i + 1];
    if (n === '(') { const [b, j] = balanced(i + 2, '(', ')'); part('sub', b); return j; }
    if (n === '{') { const [b, j] = balanced(i + 2, '{', '}'); const m = b.match(/^([A-Za-z_][A-Za-z0-9_]*)$/); if (m) part('var', m[1]); else part('sub', b); return j; }
    const m = src.slice(i + 1).match(/^([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/);
    if (m) { part('var', m[1]); return i + 1 + m[1].length; }
    part('u', '$'); return i + 1;
  };
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '\\') { if (src[i + 1] === '\n') { i += 2; continue; } part('q', src[i + 1] || ''); i += 2; continue; }
    if (c === "'") { const j = src.indexOf("'", i + 1); const e = j < 0 ? src.length : j; part('q', src.slice(i + 1, e)); i = e + 1; continue; }
    if (c === '"') {
      word ||= { parts: [] };
      let j = i + 1; let buf = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) { buf += src[j + 1]; j += 2; continue; }
        if (src[j] === '$' || src[j] === '`') {
          if (buf) part('q', buf); buf = '';
          if (src[j] === '`') { const [b, k] = balanced(j + 1, '`', '`'); part('sub', b); j = k; } else j = dollar(j);
          continue;
        }
        buf += src[j]; j++;
      }
      if (buf || !word.parts.length) part('q', buf);
      i = j + 1; continue;
    }
    if (c === '$') { i = dollar(i); continue; }
    if (c === '`') { const [b, j] = balanced(i + 1, '`', '`'); part('sub', b); i = j; continue; }
    if (c === '#' && !word) { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue; }
    if (/[ \t]/.test(c)) { endWord(); i++; continue; }
    if (c === '\n' && heredocs.length) { // skip each heredoc body: data, not commands
      endCmd();
      let pos = i + 1;
      for (const d of heredocs.splice(0)) {
        while (pos < src.length) {
          const e = src.indexOf('\n', pos);
          const line = src.slice(pos, e < 0 ? src.length : e);
          pos = e < 0 ? src.length : e + 1;
          if (line.replace(/^\t+/, '') === d) break;
        }
      }
      i = pos; continue;
    }
    if (/[;&|\n()]/.test(c)) {
      if (c === '&' && src[i + 1] === '>') { endWord(); cur.push({ op: '>' }); i += src[i + 2] === '>' ? 3 : 2; continue; }
      endCmd(); i++; continue;
    }
    if (c === '>' || c === '<') {
      // `2>` — a word of digits right before the operator is its fd, not a file.
      if (word && word.parts.every((p) => p.t === 'u' && /^\d+$/.test(p.s))) word = null;
      endWord();
      let j = i + 1;
      if (src[j] === '>' || src[j] === '|') j++;
      if (src[j] === '&') { cur.push({ op: 'dup' }); i = j + 1; continue; } // `2>&1`, `>&2`: an fd, not a path
      if (c === '<' && src[j] === '<') { // heredoc: the body is data, the delimiter is not a path
        if (src[j + 1] === '<') { cur.push({ op: '<' }); i = j + 2; continue; } // here-string: one word of data
        const m = src.slice(j + 1).match(/^-?\s*(['"]?)([A-Za-z0-9_.-]+)\1/);
        if (m) { heredocs.push(m[2]); i = j + 1 + m[0].length; } else i = j + 1;
        continue;
      }
      cur.push({ op: c === '>' ? '>' : '<' }); i = j; continue;
    }
    part('u', c); i++;
  }
  endCmd();
  return cmds;
}

/** A word as `{ text, pat }`: text with known values substituted (unknown → ''), pat with wildcards. */
function wordValue(w, vars) {
  let text = ''; let pat = '';
  w.parts.forEach((p, idx) => {
    if (p.t === 'q') { text += p.s; pat += p.s; return; }
    if (p.t === 'var') {
      const v = Object.prototype.hasOwnProperty.call(vars, p.name) ? vars[p.name]
        : p.name === 'CLAUDE_PLUGIN_ROOT' ? { text: PLUGIN, pat: PLUGIN } : null;
      if (!v) { pat += ANY; return; }
      text += v.text; pat += v.pat; return;
    }
    if (p.t === 'sub') { pat += ANY; return; }
    let s = p.s;
    if (idx === 0 && /^~(\/|$)/.test(s)) s = homedir() + s.slice(1);
    text += s;
    pat += s.replace(/\[[^\]/]*\]/g, ONE).replace(/\*/g, STAR).replace(/\?/g, ONE);
  });
  return { text, pat };
}

/** Pattern string → path segments, resolved against `cwd` (itself a segment list, possibly ANY-led). */
function patSegs(pat, cwd) {
  const raw = pat.startsWith('/') ? [] : pat.startsWith(ANY) ? [] : [...cwd];
  const out = raw;
  for (const s of pat.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') { if (out.length && out[out.length - 1] !== ANY) out.pop(); continue; }
    out.push(s);
  }
  return out;
}
const segRe = (s) => new RegExp(`^${s.split('').map((ch) => (ch === STAR ? '[^/]*' : ch === ONE ? '[^/]' : ch === ANY ? '.*' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);

/** Could the pattern segments `p` name guarded path `g` (segments) or something under it? */
function segsHit(p, g, i = 0, j = 0) {
  if (j === g.length) return true;
  if (i === p.length) return false;
  if (p[i] === ANY) { for (let k = j; k < g.length; k++) if (segsHit(p, g, i + 1, k)) return true; return false; }
  return segRe(p[i]).test(g[j]) && segsHit(p, g, i + 1, j + 1);
}
const toSegs = (abs) => abs.split('/').filter(Boolean);
const hits = (pat, cwd, guards) => { const p = patSegs(pat, cwd); return guards.some((g) => segsHit(p, toSegs(g))); };

const WRAPPERS = new Set(['env', 'exec', 'nohup', 'command', 'time', 'sudo', 'nice', 'xargs', 'builtin']);
const INTERPRETERS = /^(node|deno|bun|python[0-9.]*|perl|ruby|php|osascript)$/;

/** The words of one simple command a write lands on (redirect targets and each writing tool's destination). */
function writeTargets(words) {
  const out = [];
  const args = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.op) { if ((w.op === '>') && words[i + 1] && !words[i + 1].op) out.push(words[++i]); else if (w.op !== 'dup' && words[i + 1] && !words[i + 1].op) i++; continue; }
    args.push(w);
  }
  let k = 0;
  while (k < args.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[k].v.text) || WRAPPERS.has(basename(args[k].v.text)))) k++;
  const name = basename(args[k]?.v.text || '');
  const rest = args.slice(k + 1);
  const plain = rest.filter((a) => !a.v.text.startsWith('-'));
  const flagged = (re) => rest.some((a) => re.test(a.v.text));
  if (name === 'tee' || ['rm', 'touch', 'truncate', 'mkdir', 'rmdir', 'unlink', 'chmod', 'chown', 'shred', 'ln'].includes(name)) out.push(...plain);
  if (['cp', 'mv', 'install', 'ln', 'rsync', 'scp'].includes(name)) {
    if (plain.length) out.push(plain[plain.length - 1]);
    rest.forEach((a, i) => {
      if (a.v.text === '-t' || a.v.text === '--target-directory') { if (rest[i + 1]) out.push(rest[i + 1]); }
      else if (/^(-t|--target-directory=)./.test(a.v.text)) out.push({ v: { text: a.v.text.replace(/^(-t|--target-directory=)/, ''), pat: a.v.pat.replace(/^(-t|--target-directory=)/, '') } });
    });
  }
  if (name === 'dd') rest.filter((a) => a.v.text.startsWith('of=')).forEach((a) => out.push({ v: { text: a.v.text.slice(3), pat: a.v.pat.slice(3) } }));
  if (name === 'sed' && flagged(/^(-i|--in-place|-[a-zA-Z]*i)/)) out.push(...plain);
  if (/^(perl|ruby)$/.test(name) && flagged(/^-[a-zA-Z]*i/)) out.push(...plain);
  if ((name === 'curl' || name === 'wget') ) rest.forEach((a, i) => { if (/^(-o|-O|--output|--output-document)$/.test(a.v.text) && rest[i + 1]) out.push(rest[i + 1]); });
  return out;
}

/**
 * guard-gate-writes (PreToolUse on Bash, the file-writing tools, and Read|Grep|Glob). A SUBAGENT (the
 * payload carries `agent_id`) may not: mint, revoke or list actor tokens (any `board.mjs actor`
 * subcommand); compose a spawn prompt (`spawn-prompt.mjs compose` MINTS — design D: the orchestrator
 * composes, a subagent never does); run board.mjs / spawn-prompt.mjs / a `*.mjs` whose name or
 * subcommand is built at runtime (`$(…)`, backticks, `$VAR`, a glob — C3G-2); load actor.mjs /
 * evidence.mjs / events.mjs into its own program; touch the token registry or the board anchor under
 * `<git dir>/studio/`; write INTO the gate evidence dir, or write a CONTROL FILE in the main tree
 * (`docs/team/project-profile.json`, `risk-policy.json`, `capabilities.json`, `.studio-policy.json` —
 * C3G-3: a subagent that rewrites the profile's test command fakes `test.full`); start a nested
 * `claude` session (G2-16); or read Claude Code's transcripts under ~/.claude/projects (G2-15).
 * Paths are compared after `cd`, `NAME=value`, `.`/`..`/`//` and symlink resolution, with globs and
 * unresolvable expansions as wildcards. The main session (no `agent_id`) is the orchestrator and is
 * not restricted. Scripts the agent runs (verify-done.sh, journey-gate) still write evidence
 * themselves — only hand-written paths are refused; READING evidence and control files is fine, and
 * so is any sentence that merely MENTIONS these words (a quoted `--detail`, a commit message, a grep).
 *
 * THE BOUND, STATED: this is a reading of a shell command, not a sandbox. It cannot see into a
 * program the subagent wrote to a file, a value computed by a command substitution whose output it
 * then uses as a path (`D=$(…); cp x "$D"` with nothing else naming the target), python/base64
 * indirection, or `find -exec`/`xargs` composing the path. Nor can anything here tell a subagent from
 * the orchestrator by ENVIRONMENT: Claude Code sets the same AI_AGENT / CLAUDE_CODE_CHILD_SESSION in
 * the main session's Bash and in a subagent's (checked 2026-11-18), so the hook payload's `agent_id`
 * is the only marker — which is why compose refusal lives here and not in spawn-prompt.mjs. What
 * this misses is stopped, if at all, by the mint side (actor.mjs), the board re-deriving evidence
 * from git, and the frozen test commands (design C). It stops the confused and the literal, and
 * makes the hostile leave a visible trail in its own transcript.
 */
function guardGateWrites() {
  if (!payload.agent_id) allow();
  const root = projectRoot(payload.cwd);
  if (!root) allow();
  const input = payload.tool_input || {};
  const cwd = realish(resolve(payload.cwd || process.cwd()));
  const TOKENS = 'docs/team/actor-tokens.jsonl';
  const CONTROL = ['docs/team/project-profile.json', 'docs/team/risk-policy.json', 'docs/team/capabilities.json', '.studio-policy.json'];
  const roots = [...new Set([root, cwd].map((r) => realish(resolve(r))))];
  let common = '';
  try { common = realish(execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { common = join(realish(root), '.git'); }
  const G = {
    transcripts: [join(realish(homedir()), '.claude', 'projects'), join(homedir(), '.claude', 'projects')],
    tokens: roots.map((r) => join(r, TOKENS)),
    anchor: [join(common, 'studio'), ...roots.map((r) => join(r, '.git', 'studio'))],
    evidence: roots.map((r) => join(r, 'docs', 'team', 'evidence')),
    control: CONTROL.map((c) => join(realish(root), c)),
  };
  const refuse = (what) => block(`guard-gate-writes: a subagent may not ${what}.\n` +
    '  The orchestrator composes every spawn prompt and mints every token in it; gate evidence is written by\n' +
    '  the scripts that produce it (verify-done.sh, journey-gate, runtime-gate); control files change on the\n' +
    '  orchestrator\'s say. Use the token and paths your prompt gave you, spelled literally. If you lack one,\n' +
    '  stop and return BLOCKED naming what is missing — the orchestrator re-spawns you with a fresh prompt.');

  if (payload.tool_name === 'Bash') {
    const src = String(input.command || '');
    // Text checks that need no parse: a nested claude, or library entry points named outright.
    const flat = src.replace(/["'\\]/g, '');
    if (/(^|[;&|(`\n]|\$\()\s*(?:(?:env|exec|nohup|command|xargs|time|sudo)\s+)*(?:\S*\/)?(claude|claude-code)(\s|$)/.test(flat)
      || /@anthropic-ai\/claude-code\b/.test(flat)) refuse('start a nested `claude` session (it would carry no agent_id past these checks)');
    if (/\b(mintActorToken|mintToken|revokeActorToken|writeTestEvidence|writeEvidenceLog|writeAnchor)\b/.test(flat)
      || (/\b(node|deno|bun)\b/.test(flat) && /\b(actor|evidence|events)\.mjs\b/.test(flat))) refuse('load the actor, evidence or events library into a program of its own');
    if (/\.claude\/projects\b/.test(flat)) refuse('read Claude Code session transcripts under ~/.claude/projects');
    if (/\.git\/+studio\b/.test(flat)) refuse('touch the board anchor under .git/studio/');

    const vars = {};
    let here = toSegs(cwd);
    const expansion = /\$\(|`|\$\{?(?!CLAUDE_PLUGIN_ROOT\b)[A-Za-z_]/.test(src);
    const queue = shellCommands(src);
    while (queue.length) {
      const raw = queue.shift();
      const words = raw.map((w) => (w.op ? w : { ...w, v: wordValue(w, vars) }));
      const args = words.filter((w) => !w.op);
      // Assignments: `NAME=value` words before the command (or alone) bind for the rest of the line.
      let k = 0;
      for (; k < args.length; k++) {
        const m = args[k].v.text.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
        if (!m || args[k].parts[0]?.t !== 'u') break;
        const cut = m[0].length;
        vars[m[1]] = { text: args[k].v.text.slice(cut), pat: args[k].v.pat.slice(cut) };
      }
      const cmdWords = args.slice(k);
      if (!cmdWords.length) continue;
      const texts = cmdWords.map((w) => w.v.text);
      const name = basename(texts[0]);
      // `sh -c "…"`, `bash -c`, `eval …` — read the inner command too.
      if (/^(sh|bash|zsh|dash|ksh)$/.test(name)) { const i = texts.indexOf('-c'); if (i > 0 && texts[i + 1]) queue.push(...shellCommands(texts[i + 1])); }
      if (name === 'eval') queue.push(...shellCommands(texts.slice(1).join(' ')));
      if (name === 'cd' || name === 'pushd') {
        const t = cmdWords[1];
        if (!t) here = toSegs(homedir());
        else if (t.v.text === '-') here = [ANY];
        else here = patSegs(t.v.pat.includes(ANY) || /[\u0001\u0002]/.test(t.v.pat) ? t.v.pat : t.v.text, here);
        continue;
      }

      const scriptIdx = texts.findIndex((t) => /(^|\/)(board|spawn-prompt)\.mjs$/.test(t));
      const runsBoard = texts.some((t) => /(^|\/)board\.mjs$/.test(t));
      const actorCmd = (runsBoard && texts.slice(texts.findIndex((t) => /(^|\/)board\.mjs$/.test(t)) + 1).includes('actor'))
        || texts.some((t, i) => t === 'actor' && /^(mint|revoke)$/.test(texts[i + 1] || ''));
      if (actorCmd) refuse('mint, revoke or list actor tokens (any `board.mjs actor` subcommand)');
      const sp = texts.findIndex((t) => /(^|\/)spawn-prompt\.mjs$/.test(t));
      if (sp >= 0 && texts.slice(sp + 1).includes('compose')) refuse('run `spawn-prompt.mjs compose` — composing a prompt MINTS its tokens; the orchestrator composes');
      // C3G-2: a script name or subcommand built at runtime. A `*.mjs` word with a glob or an
      // unresolved expansion in it, an interpreter whose script is one, or board.mjs / spawn-prompt.mjs
      // on a line that expands anything other than ${CLAUDE_PLUGIN_ROOT}.
      const dynamicMjs = cmdWords.some((w) => /\.m?js$/.test(w.v.text) && /[\u0001\u0002\u0003]/.test(w.v.pat));
      const interp = INTERPRETERS.test(name) ? cmdWords.slice(1).find((w) => !w.v.text.startsWith('-')) : null;
      const dynamicScript = interp && /^(node|deno|bun)$/.test(name) && /[\u0001\u0002\u0003]/.test(interp.v.pat);
      if (dynamicMjs || dynamicScript || ((scriptIdx >= 0) && expansion)) {
        refuse('run board.mjs, spawn-prompt.mjs or a plugin script whose name or arguments are built at runtime ($(…), backticks, $VAR, a glob). Spell the command literally, with only ${CLAUDE_PLUGIN_ROOT} expanded');
      }

      // Paths: any word naming the registry, the anchor or the transcripts; any WRITE into evidence or a control file.
      for (const w of cmdWords) {
        const { pat } = w.v;
        if (hits(pat, here, G.transcripts)) refuse('read Claude Code session transcripts under ~/.claude/projects');
        if (hits(pat, here, G.anchor)) refuse('touch the board anchor under <git dir>/studio/');
        if (hits(pat, here, G.tokens)) refuse('read or write the actor token registry');
      }
      for (const w of writeTargets(words)) {
        if (hits(w.v.pat, here, G.evidence)) refuse('write gate evidence by hand');
        if (hits(w.v.pat, here, G.control)) refuse(`write a control file in the main tree (${CONTROL.join(', ')})`);
      }
      // A program written inline (`node -e`, a heredoc into python) that names a guarded file and writes.
      if (INTERPRETERS.test(name)) {
        const body = src.replace(/\/+(\.\/)*/g, '/');
        const writes = /\b(writeFile|appendFile|createWriteStream|copyFile|rename|rmSync|unlink|truncate|write_text|write_bytes|shutil|open\s*\([^)]*['"][wa+])/.test(body);
        if (writes && /team\/evidence\b/.test(body)) refuse('write gate evidence by hand');
        if (writes && CONTROL.some((c) => body.includes(basename(c)))) refuse(`write a control file in the main tree (${CONTROL.join(', ')})`);
        if (body.includes('actor-tokens.jsonl')) refuse('read or write the actor token registry');
      }
    }
    allow();
  }

  // Write/Edit/Read/Grep/Glob: the path (and, for Glob/Grep, path + pattern) as a glob over guarded paths.
  const base = String(input.path || '') || cwd;
  const candidates = [input.file_path, input.notebook_path, input.path,
    input.pattern && payload.tool_name === 'Glob' ? join(base, String(input.pattern)) : '',
    input.glob ? join(base, String(input.glob)) : ''].filter(Boolean).map((p) => String(p).replace(/\\/g, '/'));
  if (!candidates.length) allow();
  const asPat = (p) => {
    const abs = p.startsWith('~') ? homedir() + p.slice(1) : isAbsolute(p) ? p : resolve(cwd, p);
    const real = /[*?[]/.test(abs) ? abs : realish(abs);
    return real.replace(/\[[^\]/]*\]/g, ONE).replace(/\*/g, STAR).replace(/\?/g, ONE);
  };
  for (const c of candidates) if (hits(asPat(c), [], G.transcripts)) refuse('read Claude Code session transcripts under ~/.claude/projects');
  // A recursive search FROM an ancestor (`Grep path: ~/.claude`) walks into the transcripts too.
  if (['Grep', 'Glob'].includes(payload.tool_name) && input.path) {
    const dir = realish(resolve(cwd, String(input.path).replace(/^~/, homedir())));
    if (G.transcripts.some((t) => t.startsWith(`${dir.replace(/\/$/, '')}/`))) refuse('search a directory that holds Claude Code session transcripts (~/.claude/projects)');
  }
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(payload.tool_name)) allow();
  const target = asPat(candidates[0]);
  if (hits(target, [], G.anchor) || candidates[0].includes('.git/studio/')) refuse('write the board anchor under .git/studio/');
  if (hits(target, [], G.tokens) || candidates[0].endsWith(TOKENS)) refuse('write the actor token registry');
  if (hits(target, [], G.evidence)) refuse('write gate evidence by hand');
  if (hits(target, [], G.control)) refuse(`write a control file in the main tree (${CONTROL.join(', ')})`);
  allow();
}

switch (process.argv[2]) {
  case 'pre-spawn': preSpawn(); break;
  case 'subagent-stop': subagentStop(); break;
  case 'guard-gate-writes': guardGateWrites(); break;
  default: allow();
}
