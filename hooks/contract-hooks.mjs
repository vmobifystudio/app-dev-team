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
 *                  subagent's own transcript) to docs/team/reports/<ticket-or-role>-<UTC>.md
 *                  (credentials and `st_…` role tokens redacted — C5G-8), run
 *                  report-check on it, and block ONCE per subagent with the exact missing lines when
 *                  ticket work fails it. A report whose first line is the role's GATE line
 *                  (`DESIGN QA:`, `ANALYTICS:`, `ASO READY`, `VERIFICATION:` — lib/contract.mjs
 *                  GATE_HEADERS) is a verdict, not a DONE: persisted, never blocked.
 *   guard-gate-writes  below.
 *
 * NEVER FIRES OUTSIDE A STUDIO PROJECT: no docs/31-board-events.jsonl (in the cwd or the main tree
 * of its git repo) means allow — and the shell wrappers check that before starting node at all
 * (C2-27); guard-gate-writes alone also looks at each absolute TARGET's project (G7-12). NOT TICKET WORK IS NOT POLICED: a spawn whose prompt names no ticket on the board
 * (planning, grooming, an audit) passes; a stop whose report names none is persisted but never
 * blocked. Ticket IDs are WHOLE board IDs: `QA-1-w1` is not `QA-1`, `APP-001-analytics` is not
 * `APP-001` (the longest board ID a mention spells wins).
 *
 * FAIL OPEN, like every hook here: unparseable payload, missing node, unreadable state → exit 0.
 * Exit 2 blocks, with the reason on stderr (Claude Code feeds it back to the model).
 */
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { contractFor, gateHeaderOf, headLine } from '../scripts/lib/contract.mjs';
import { redact } from '../scripts/lib/redact.mjs';
import { key, parseEventLog, reduce } from '../scripts/lib/events.mjs';

// The scripts this hook runs. It lives in hooks/ so the plugin's script count stays what it says.
const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const allow = () => process.exit(0);
const block = (msg) => { process.stderr.write(`${msg.trimEnd()}\n`); process.exit(2); };
const REVIEW_ROLES = new Set(['code-reviewer']);
// PR46-6: roles whose every board-naming spawn is ticket work. The others (product-manager, ux-architect,
// product-designer, …) are spawned for planning too — "clarify the AC of APP-003" — so for them a
// prompt is ticket work only when it CLAIMS a ticket (compose's own first line) or names one they own.
const TICKET_ROLES = new Set(['qa-engineer', 'verification-engineer']);
const CLAIMS_TICKET = /^(Work|Review|Design QA|Verify) ticket /;
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
  if (contract?.tier !== 'code' && !REVIEW_ROLES.has(role) && !TICKET_ROLES.has(role) && !CLAIMS_TICKET.test(headLine(prompt))) {
    let board = new Map();
    try { board = reduce(parseEventLog(readFileSync(join(root, 'docs', '31-board-events.jsonl'), 'utf8')).events).tickets; } catch { /* unreadable: police */ }
    if (board.size && !tickets.some((t) => board.get(key(t))?.owner === role)) allow();
  }

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

  // PR46-4: the FIRST line decides — a `BLOCKED:` quoted further down does not exempt the report.
  const head = (headLine(report).match(/^(DONE|BLOCKED):\s*([^\s*_]+)/) || []);
  const ticket = head[2] || (report.match(/^Ticket:\s*(\S+)/m) || [])[1] || boardTickets(root, report)[0] || '';
  const dir = join(root, 'docs', 'team', 'reports');
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const file = join(dir, `${(ticket || role).replace(/[^A-Za-z0-9-]/g, '')}-${stamp}.md`);
  // C5G-8: a report that pastes its `--token st_…` command must not leave a live role token on disk.
  try { mkdirSync(dir, { recursive: true }); writeFileSync(file, `${redact(report).text}\n`); } catch { allow(); }

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

// ── A small shell reader (Sprint 4, C3G-2/11/12/17, FB2; Sprint 5, C4G-H1..H4, M1, M2, L1, FB-n1..n6) ──
// The guard used to match regexes over the command with every quote deleted, which both MISSED
// (`cp -t`, `dd of=`, `docs//team`, `evidenc?`, `$D/studio`) and FALSE-BLOCKED (`--detail "the actor
// field is wrong"`, a commit message saying "actor mint", `grep "actor-tokens.jsonl"`). It now splits
// the command into simple commands of shell WORDS (quotes joined, so a quoted sentence is one word
// and `"mint"` is the word mint), substitutes `NAME=value` assignments made earlier in the same
// command, and resolves every path-like word against the cwd the command has `cd`-ed to. A glob char
// in an unquoted word, or an expansion it cannot resolve, is a WILDCARD — `evidenc?`, `$D/studio`
// and `~/.claude/proj*` match the guarded path they could expand to. Everything that RUNS is read as
// commands: `$(…)`/backtick/`<(…)` bodies, `sh -c` / `eval` text, and text fed to a bare shell on
// stdin (a heredoc, a here-string, `echo …|sh`). A heredoc fed to anything else is data.
const PLUGIN = resolve(HERE, '..');
const STAR = '\u0001'; // unquoted * (one segment)
const ONE = '\u0002';  // unquoted ? or [..] (one char)
const ANY = '\u0003';  // an expansion this reader cannot resolve (any text, any depth)
const WILD = /[\u0001\u0002\u0003]/;
// C4G-M1: macOS volumes are case-insensitive by default — `docs/Team`, `.GIT/studio`, `BOARD.mjs` are the same files.
const DARWIN = process.platform === 'darwin';
const fold = (s) => (DARWIN ? String(s).toLowerCase() : String(s));

/** `[[word, …], …]` simple commands. A word is `{ parts: [{t:'u'|'q', s} | {t:'var', name} | {t:'sub', body}] }`; operators are `{ op }`.
 *  A command array may carry `.stdin` (its heredoc text), `.stdinExpands` (unquoted delimiter) and `.pipedFrom` (the command piping into it). */
function shellCommands(src) {
  const cmds = [];
  const heredocs = [];
  let cur = [];
  let word = null;
  let ops = ''; // PR46-1: the operators (`;` `&&` `||` `(` `)` `|` newline) between the last command and the next
  const part = (t, s) => { word ||= { parts: [] }; word.parts.push(t === 'var' ? { t, name: s } : t === 'sub' ? { t, body: s } : { t, s }); };
  const endWord = () => { if (word) cur.push(word); word = null; };
  const endCmd = () => { endWord(); if (cur.length) { cur.ops = ops; ops = ''; cmds.push(cur); cur = []; } };
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
    if (n === "'") { let j = i + 2; while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1; part('sub', ''); return j + 1; } // C4G-L1: $'\x61ctor' is computed text
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
    if (c === '\n' && heredocs.length) { // each heredoc body belongs to the command that opened it
      endCmd(); ops += '\n';
      let pos = i + 1;
      for (const d of heredocs.splice(0)) {
        const body = [];
        while (pos < src.length) {
          const e = src.indexOf('\n', pos);
          const line = src.slice(pos, e < 0 ? src.length : e);
          pos = e < 0 ? src.length : e + 1;
          if (line.replace(/^\t+/, '') === d.delim) break;
          body.push(line);
        }
        d.cmd.stdin = `${d.cmd.stdin || ''}${body.join('\n')}\n`;
        if (!d.quoted) d.cmd.stdinExpands = true;
      }
      i = pos; continue;
    }
    if (c === '|' && src[i + 1] !== '|') { // a pipe: remember who feeds the next command
      endCmd(); ops += '|'; const from = cmds[cmds.length - 1]; if (from) from.pipeTo = true; cur.pipedFrom = from; i += src[i + 1] === '&' ? 2 : 1; continue;
    }
    if (c === '|') { endCmd(); ops += '||'; i += 2; continue; }
    if (/[;&\n()]/.test(c)) {
      if (c === '&' && src[i + 1] === '>') { endWord(); cur.push({ op: '>' }); i += src[i + 2] === '>' ? 3 : 2; continue; }
      endCmd(); ops += c;
      if (c === '&' && src[i + 1] !== '&' && src[i - 1] !== '&' && cmds.length) cmds[cmds.length - 1].bg = true; // G7-9: `x &` runs in a subshell
      i++; continue;
    }
    if ((c === '>' || c === '<') && src[i + 1] === '(') { const [b, j] = balanced(i + 2, '(', ')'); part('sub', b); i = j; continue; } // <(…) runs
    if (c === '>' || c === '<') {
      // `2>` — a word of digits right before the operator is its fd, not a file.
      if (word && word.parts.every((p) => p.t === 'u' && /^\d+$/.test(p.s))) word = null;
      endWord();
      let j = i + 1;
      if (src[j] === '>' || src[j] === '|') j++;
      if (src[j] === '&') { cur.push({ op: 'dup' }); i = j + 1; continue; } // `2>&1`, `>&2`: an fd, not a path
      if (c === '<' && src[j] === '<') { // heredoc: the body is data unless a shell reads it; the delimiter is not a path
        if (src[j + 1] === '<') { cur.push({ op: '<<<' }); i = j + 2; continue; } // here-string: one word
        const m = src.slice(j + 1).match(/^-?\s*(['"]?)([A-Za-z0-9_.-]+)\1/);
        if (m) { heredocs.push({ delim: m[2], quoted: Boolean(m[1]), cmd: cur }); i = j + 1 + m[0].length; } else i = j + 1;
        continue;
      }
      cur.push({ op: c === '>' || src[i + 1] === '>' ? '>' : '<' }); i = j; continue; // C5G-2: `<>` opens for writing
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

// C5G-7: symlinks `ln -s` made EARLIER IN THIS COMMAND (`ln -s docs/team l; echo x > l/…`) — realish only sees links that exist.
const LINKS = [];
/** Pattern string → path segments, resolved against `cwd` (itself a segment list, possibly ANY-led), through LINKS. */
function patSegs(pat, cwd) {
  const raw = pat.startsWith('/') ? [] : pat.startsWith(ANY) ? [] : [...cwd];
  const out = raw;
  for (const s of pat.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') { if (out.length && out[out.length - 1] !== ANY) out.pop(); continue; }
    out.push(s);
  }
  for (const l of LINKS) if (out.length >= l.from.length && l.from.every((s, i) => fold(s) === fold(out[i]))) return [...l.to, ...out.slice(l.from.length)];
  return out;
}
const segRe = (s) => new RegExp(`^${s.split('').map((ch) => (ch === STAR ? '[^/]*' : ch === ONE ? '[^/]' : ch === ANY ? '.*' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`, DARWIN ? 'i' : '');
// A guard segment may itself hold STAR (`*-result.json`); a wildcard against a wildcard could be anything.
const segMatch = (ps, gs) => (gs.includes(STAR) ? (WILD.test(ps) || segRe(gs).test(ps)) : segRe(ps).test(gs));

/** Could the pattern segments `p` name guarded path `g` (segments) or something under it? */
function segsHit(p, g, i = 0, j = 0) {
  if (j === g.length) return true;
  if (i === p.length) return false;
  if (p[i] === ANY) { for (let k = j; k < g.length; k++) if (segsHit(p, g, i + 1, k)) return true; return false; }
  return segMatch(p[i], g[j]) && segsHit(p, g, i + 1, j + 1);
}
/** …or, for a command that sweeps a whole tree (`rm -r`, `git checkout .`, `tar -x -C`), an ANCESTOR of it (C4G-H2). */
function segsRel(p, g, i = 0, j = 0) {
  if (j === g.length || i === p.length) return true;
  if (p[i] === ANY) { for (let k = j; k <= g.length; k++) if (segsRel(p, g, i + 1, k)) return true; return false; }
  return segMatch(p[i], g[j]) && segsRel(p, g, i + 1, j + 1);
}
const toSegs = (abs) => abs.split('/').filter(Boolean);
/** C4G-M2: a literal path is compared as written AND with its symlinks resolved (`/var` is `/private/var`). */
const hits = (pat, cwd, guards, tree = false) => {
  const p = patSegs(pat, cwd);
  const ps = p.some((s) => WILD.test(s)) ? [p] : [p, toSegs(realish(`/${p.join('/')}`))];
  return guards.some((g) => ps.some((q) => (tree ? segsRel : segsHit)(q, toSegs(g))));
};

/** Is the pattern exactly directory `dir` (not something under it)? */
const isDir = (pat, cwd, dir) => {
  const p = patSegs(pat, cwd); const g = toSegs(dir);
  const same = (q) => q.length === g.length && q.every((s, i) => segMatch(s, g[i]));
  return same(p) || (!p.some((s) => WILD.test(s)) && same(toSegs(realish(`/${p.join('/')}`))));
};

// G7-8: hooks/wrappers.txt — the ONE wrapper table, shared with block-shared-tree-destructive-git.sh.
// name → { ops: operands before the command (`timeout 30`), vals: flags whose value is a separate word }.
const WRAPPERS = new Map();
try {
  for (const line of readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'wrappers.txt'), 'utf8').split('\n')) {
    const [n, ops, ...vals] = line.trim().split(/\s+/);
    if (n && !n.startsWith('#')) WRAPPERS.set(n, { ops: Number(ops) || 0, vals: new Set(vals) });
  }
} catch { /* no table: no wrappers seen through — the hooks' fail-open rule */ }
const RESERVED = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until']);
// G7-9: a command inside one of these may not run (if/while/case/a function body) — a cd there is uncertain.
const OPENS = new Set(['if', 'while', 'until', 'for', 'select', 'case', 'function', '{']);
const CLOSES = new Set(['fi', 'done', 'esac', '}']);
const PKG_WRITERS = /^(prettier|eslint|biome|stylelint|standard|xo|rimraf|del-cli)$/;
const enterable = (abs) => { try { accessSync(abs, constants.X_OK); return statSync(abs).isDirectory(); } catch { return false; } };
const INTERPRETERS = /^(node|deno|bun|tsx|ts-node|python[0-9.]*|perl|ruby|php|osascript)$/;
const SHELLS = /^(sh|bash|zsh|dash|ksh)$/;
const WRITERS = new Set(['rm', 'rmdir', 'mv', 'cp', 'ln', 'install', 'rsync', 'scp', 'touch', 'truncate', 'mkdir', 'tee', 'chmod', 'chown',
  'shred', 'unlink', 'dd', 'sed', 'perl', 'ruby', 'git', 'patch', 'tar', 'unzip', 'sponge', 'awk', 'gawk']);
const DOT = { v: { text: '.', pat: '.' } };
const lastSeg = (s) => s.replace(/\/+$/, '').split('/').pop();
const under = (dir, w) => ({ v: { text: `${dir.v.text}/${w.v.text}`, pat: `${dir.v.pat}/${w.v.pat}` } });
const lit = (s) => ({ v: { text: s, pat: s } });
// `mktemp`, `mktemp -d`, `mktemp -d -t x.XXXX`: a new name under $TMPDIR (no template, -p or --tmpdir that could aim elsewhere).
const MKTEMP = /^\s*mktemp(\s+(-[dqu]+|-t\s*[^\s/]+|--directory|--quiet))*\s*$/;

/** Paths a unified diff writes (`+++ b/x`, `rename to`, …), each also with its first component stripped (`-p1`). */
function patchPaths(text) {
  const out = [];
  for (const m of String(text).matchAll(/^(?:(?:\+\+\+|---) ([^\t\n]+)|diff --git a\/(\S+) b\/(\S+)|(?:rename|copy) (?:from|to) (.+))$/gm)) {
    for (const p of m.slice(1).filter(Boolean)) if (p !== '/dev/null') out.push(lit(p), lit(p.replace(/^[^/]+\//, '')));
  }
  return out;
}

/**
 * Where one simple command writes, as `{ w, tree }`: `tree` marks a command that sweeps everything
 * under its target (`rm -r`, `git checkout .`, `git stash`, `tar -x -C`), so an ANCESTOR of a guarded
 * path counts. `ctx` = `{ redirects, stdin, read(path) → text|null, xargs }`.
 */
function writeTargets(name, rest, ctx) {
  const out = [];
  const path = (w) => out.push({ w, tree: false });
  const tree = (w) => out.push({ w, tree: true });
  ctx.redirects.forEach(path);
  const plain = rest.filter((a) => !a.v.text.startsWith('-'));
  const flagged = (re) => rest.some((a) => re.test(a.v.text));
  if (ctx.xargs && WRITERS.has(name)) tree(DOT); // `… | xargs rm`: the paths come from stdin
  if (['rm', 'rmdir'].includes(name)) plain.forEach(tree);
  if (name === 'tee' || ['touch', 'truncate', 'mkdir', 'unlink', 'chmod', 'chown', 'shred', 'ln', 'sponge'].includes(name)) plain.forEach(path);
  if (['cp', 'mv', 'install', 'ln', 'rsync', 'scp', 'ditto'].includes(name)) {
    let dest = null;
    rest.forEach((a, i) => {
      if (a.v.text === '-t' || a.v.text === '--target-directory') { if (rest[i + 1]) dest = rest[i + 1]; }
      else if (/^(-t|--target-directory=)./.test(a.v.text)) dest = { v: { text: a.v.text.replace(/^(-t|--target-directory=)/, ''), pat: a.v.pat.replace(/^(-t|--target-directory=)/, '') } };
    });
    const srcs = dest ? plain.filter((a) => a !== dest) : plain.slice(0, -1);
    dest ||= plain[plain.length - 1];
    if (dest) {
      out.push({ w: dest, tree: false, into: true });
      // C4G-H2: `cp x docs/team/` writes docs/team/x; a recursive copy (`cp -R d/ docs/team`, rsync) may write anything under it.
      srcs.forEach((s) => path(under(dest, { v: { text: lastSeg(s.v.text), pat: lastSeg(s.v.pat) } })));
      if (name === 'rsync' || name === 'ditto' || (name === 'cp' && flagged(/^-[a-zA-Z]*[rRa]/))) tree(dest);
    }
    if (name === 'mv') srcs.forEach(tree); // moving a directory away moves what it holds
  }
  if (name === 'dd') rest.filter((a) => a.v.text.startsWith('of=')).forEach((a) => path({ v: { text: a.v.text.slice(3), pat: a.v.pat.slice(3) } }));
  if (name === 'sed' && flagged(/^(-i|--in-place|-[a-zA-Z]*i)/)) plain.forEach(path);
  if (/^(perl|ruby)$/.test(name) && flagged(/^-[a-zA-Z]*i/)) plain.forEach(path);
  if (/^g?awk$/.test(name) && rest.some((a, i) => /^(-iinplace|--include=inplace)$/.test(a.v.text) || (/^(-i|--include)$/.test(a.v.text) && rest[i + 1]?.v.text === 'inplace'))) plain.forEach(path);
  // C5G-4: the writers a flag points at a file (or a directory) — `-o f`, `-sSo f`, `-of`, `--output f`, `--output=f`, `-out f`.
  const opt = (short, longs) => {
    const vals = [];
    const cut = (a, n) => vals.push({ v: { text: a.v.text.slice(n), pat: a.v.pat.slice(n) } });
    rest.forEach((a, i) => {
      const t = a.v.text;
      for (const l of longs) { if (t === l && rest[i + 1]) vals.push(rest[i + 1]); else if (t.startsWith(`${l}=`)) cut(a, l.length + 1); }
      if (!short || t.startsWith('--')) return;
      if (new RegExp(`^-[a-zA-Z]*${short}$`).test(t) && rest[i + 1]) vals.push(rest[i + 1]);
      else if (t.startsWith(`-${short}`) && t.length > 2) cut(a, 2);
    });
    return vals;
  };
  const inDir = (d) => path(under(d, { v: { text: '*', pat: STAR } }));
  if (name === 'curl' || name === 'sort') opt('o', ['--output']).forEach(path);
  if (name === 'wget') { opt('O', ['--output-document']).forEach(path); opt('P', ['--directory-prefix']).forEach(inDir); }
  if (name === 'openssl') opt('', ['-out', '-keyout']).forEach(path);
  if (/^(ex|vi|vim|nvim|ed|red)$/.test(name)) plain.forEach(path);
  if (name === 'mktemp') plain.forEach(path);
  if (name === 'split') { const p = rest.filter((a, i) => !a.v.text.startsWith('-') && !/^-[bClnap]$/.test(rest[i - 1]?.v.text || '')); if (p[1]) path({ v: { text: `${p[1].v.text}*`, pat: `${p[1].v.pat}${STAR}` } }); }
  if (/^7z[az]?$/.test(name) && /^[ex]$/.test(plain[0]?.v.text || '')) { const o = opt('o', []); tree(o[0] || DOT); }
  if (name === 'cpio' && flagged(/^(-[a-zA-Z]*i|--extract)/)) tree(opt('D', ['--directory'])[0] || DOT);
  if (/^(bsd|g)?tar$/.test(name) && (rest[0] && /^[a-zA-Z]*x[a-zA-Z]*$/.test(rest[0].v.text) || flagged(/^(-[a-zA-Z]*x[a-zA-Z]*|--extract|--get)$/))) {
    const i = rest.findIndex((a) => a.v.text === '-C' || a.v.text === '--directory');
    const eq = rest.find((a) => a.v.text.startsWith('--directory='));
    tree(i >= 0 && rest[i + 1] ? rest[i + 1] : eq ? { v: { text: eq.v.text.slice(12), pat: eq.v.pat.slice(12) } } : DOT);
  }
  if (name === 'unzip' && !flagged(/^-[a-zA-Z]*[lZtv]/)) { const i = rest.findIndex((a) => a.v.text === '-d'); tree(i >= 0 && rest[i + 1] ? rest[i + 1] : DOT); }
  if (name === 'patch') {
    const val = (f) => { const i = rest.findIndex((a) => a.v.text === f); if (i >= 0) return rest[i + 1]; const a = rest.find((x) => x.v.text.startsWith(f) && x.v.text.length > 2); return a ? { v: { text: a.v.text.slice(2), pat: a.v.pat.slice(2) } } : null; };
    const dir = val('-d'); const out1 = val('-o'); const input = val('-i');
    const pl = rest.filter((a, i) => !a.v.text.startsWith('-') && !/^-[idoprDFzBYV]$/.test(rest[i - 1]?.v.text || ''));
    if (out1) path(out1); else if (pl[0]) path(pl[0]);
    const text = ctx.read(input || pl[1] || ctx.stdinFile) ?? ctx.stdin;
    if (!out1 && !pl[0]) { if (text == null) tree(dir || DOT); else patchPaths(text).forEach((w) => path(dir ? under(dir, w) : w)); }
  }
  // G7-18: more writers — `python3 -m json.tool in out`, `-o out` decoders/converters, `cmake -E`, and a
  // package run through npx/bunx (or a known formatter) that rewrites what it is given.
  if (/^python[0-9.]*$/.test(name)) {
    const m = rest.findIndex((a) => a.v.text === '-m');
    if (m >= 0 && rest[m + 1]?.v.text === 'json.tool') { const p = rest.slice(m + 2).filter((a) => !a.v.text.startsWith('-')); if (p[1]) path(p[1]); }
  }
  if (/^(g?base64|uudecode|plutil)$/.test(name)) opt('o', ['--output', '--output-file']).forEach(path);
  if (name === 'plutil' && flagged(/^-(convert|insert|replace|remove)$/) && !opt('o', []).length) plain.forEach(path);
  if (name === 'cmake' && rest[0]?.v.text === '-E' && rest[1]) {
    const v = rest[1].v.text; const xs = rest.slice(2).filter((a) => !a.v.text.startsWith('-'));
    if (/^(copy|rename)/.test(v) && xs.length) { tree(xs[xs.length - 1]); if (v === 'rename') tree(xs[0]); }
    else if (/^(rm|remove|remove_directory|touch|touch_nocreate|make_directory|create_symlink|create_hardlink)$/.test(v)) xs.forEach(tree);
  }
  if (/^(rimraf|del-cli)$/.test(name)) plain.forEach(tree);
  if (ctx.viaPkg || PKG_WRITERS.test(name)) {
    if (flagged(/^(--write|-w|--fix|--apply|--apply-unsafe)$/)) plain.forEach(tree);
    opt('o', ['--output', '--out-file', '--outfile', '--out-dir', '--outdir']).forEach(path);
  }
  if (name === 'git') {
    let i = 0; let base = null;
    while (i < rest.length && rest[i].v.text.startsWith('-')) {
      const t = rest[i].v.text;
      if (t === '-C') { base = rest[i + 1]; i += 2; continue; }
      i += ['-c', '--git-dir', '--work-tree', '--namespace'].includes(t) ? 2 : 1;
    }
    const sub = rest[i]?.v.text || '';
    const a = rest.slice(i + 1);
    const at = (w) => (base && !w.v.pat.startsWith('/') ? under(base, w) : w);
    const here0 = base || DOT;
    const dd = a.findIndex((x) => x.v.text === '--');
    const VAL = new Set(['-b', '-B', '--orphan', '-s', '--source', '-m', '--message', '-U', '--conflict', '--pathspec-from-file']);
    const paths = (dd >= 0 ? a.slice(dd + 1) : a).filter((x, k, arr) => !x.v.text.startsWith('-') && !VAL.has(arr[k - 1]?.v.text));
    if (['rm', 'mv', 'restore', 'checkout', 'switch'].includes(sub)) paths.map(at).forEach(tree);
    // C5G-4: plumbing and history verbs that rewrite the whole working tree; a clone or a new worktree written at a path.
    if (['merge', 'pull', 'cherry-pick', 'rebase', 'revert'].includes(sub) || (sub === 'read-tree' && a.some((x) => /^(-u|--reset)$/.test(x.v.text)))) tree(here0);
    if (sub === 'checkout-index') (paths.length && !a.some((x) => /^(-a|--all)$/.test(x.v.text)) ? paths.map(at) : [here0]).forEach(tree);
    if (sub === 'clone' && paths.length > 1) path(at(paths[paths.length - 1]));
    if (sub === 'worktree' && paths[0]?.v.text === 'add' && paths[1]) path(at(paths[1]));
    if (sub === 'clean') (paths.length ? paths.map(at) : [here0]).forEach(tree);
    if (sub === 'reset' && a.some((x) => /^--(hard|merge|keep)$/.test(x.v.text))) (dd >= 0 && paths.length ? paths.map(at) : [here0]).forEach(tree);
    if (sub === 'stash') {
      const s = a.find((x) => !x.v.text.startsWith('-'))?.v.text;
      if (!s || ['push', 'save', 'pop', 'apply'].includes(s) || dd >= 0) (dd >= 0 && paths.length ? paths.map(at) : [here0]).forEach(tree);
    }
    if (sub === 'apply' || sub === 'am') {
      const files = a.filter((x) => !x.v.text.startsWith('-'));
      const texts = files.length ? files.map((f) => ctx.read(f)) : [ctx.read(ctx.stdinFile) ?? ctx.stdin];
      if (texts.some((t) => t == null)) tree(here0); else texts.forEach((t) => patchPaths(t).map(at).forEach(path));
    }
  }
  return out;
}

const GUARDED_NAMES = ['team/evidence', 'project-profile.json', 'risk-policy.json', 'capabilities.json', '.studio-policy.json', 'actors.json', '.studio-stop',
  'actor-tokens.jsonl', '31-board-events.jsonl', '-result.json', 'ship-gate-verdict.json', 'audit-anchor.json'];
const WRITE_CALL = /\b(writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|copyFile(?:Sync)?|cpSync|cp|rename(?:Sync)?|rmSync|rm|unlink(?:Sync)?|truncate(?:Sync)?|symlink(?:Sync)?|write_text|write_bytes|shutil\.\w+|os\.(?:remove|rename|replace|unlink|symlink)|open|File\.write|IO\.write|file_put_contents)\s*\(([^)]*)\)?/g;
/** A call's argument text split at its top-level commas (quotes and brackets respected). */
function callArgs(s) {
  const out = []; let depth = 0; let q = ''; let cur = '';
  for (const ch of String(s)) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (/['"`]/.test(ch)) q = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
// Perl/Ruby `open F, ">", $path` / `open(F, ">$ARGV[0]")` (no parens needed): a mode starting `>` or `+>`.
const PERL_OPEN = /\bopen\b\s*\(?([^;\n]*['"]\s*\+?>[^;\n]*)/g;
/**
 * `{ hit, writes }`: the guarded file an inline program WRITES ('' if none), and whether it writes
 * anything at all. Only a write call's PATH counts (FB5-3): its first argument (`writeFileSync(p, …)`),
 * the destination of a copy, both ends of a rename, every argument of `open`, the receiver of
 * `Path('…').write_text()` — or a variable assigned a guarded name that the path uses. Content that
 * mentions a guarded file, or was read from one, is not a write (FB-n4). Names assembled from pieces
 * (`'risk-' + 'policy.json'`) are past the bound.
 */
function inlineWrite(body) {
  const named = (s) => GUARDED_NAMES.find((g) => fold(s).includes(fold(g))) || '';
  const tainted = [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)].filter((m) => named(m[2])).map((m) => m[1]);
  let writes = false;
  for (const m of body.matchAll(WRITE_CALL)) {
    if (m[1] === 'open' && !/,\s*(?:mode\s*=\s*)?['"](?:[^'"]*[wax+]|\s*[>+])/.test(m[2])) continue;
    writes = true;
    const start = Math.max(body.lastIndexOf(';', m.index), body.lastIndexOf('\n', m.index)) + 1;
    const args = callArgs(m[2] || '');
    const target = /^write_(text|bytes)$/.test(m[1]) ? body.slice(start, m.index)
      : /^(copyFile(Sync)?|cpSync|cp|shutil\.copy\w*)$/.test(m[1]) ? args.slice(1).join(',')
        : /^(open|rename(Sync)?|symlink(Sync)?|shutil\.move|os\.\w+)$/.test(m[1]) ? args.join(',') : args[0];
    const uses = (t) => new RegExp(`(^|[^\\w$])${t.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(target);
    const hit = named(target) || (tainted.some(uses) ? 'a guarded file' : '');
    if (hit) return { hit, writes };
  }
  for (const m of body.matchAll(PERL_OPEN)) {
    writes = true;
    if (named(m[1])) return { hit: named(m[1]), writes };
  }
  return { hit: '', writes };
}

/** A path in inline code that loads THIS plugin's actor/evidence/events library (FB-n2: an app's own `src/events.mjs` is not one). */
function pluginLib(body, hereAbs) {
  for (const m of String(body).matchAll(/[^\s'"`()=,;]*\b(actor|evidence|events)\.mjs\b/g)) {
    let p = m[0].replace(/^file:\/\//, '').replace(/^\$\{?CLAUDE_PLUGIN_ROOT\}?/, PLUGIN).replace(/^~(?=\/)/, homedir());
    const libShape = /(^|\/)lib\/(actor|evidence|events)\.mjs$/.test(p);
    if (/[$*?\u0001-\u0003]/.test(p) || (!isAbsolute(p) && !hereAbs)) { if (libShape) return p; continue; }
    p = isAbsolute(p) ? p : resolve(hereAbs, p);
    if (!existsSync(p)) { if (libShape) return p; continue; }
    // A copy of the plugin anywhere (its cache, a checkout): the lib sits in scripts/lib/ next to scripts/board.mjs.
    if (existsSync(join(dirname(dirname(realish(p))), 'board.mjs'))) return p;
  }
  return '';
}

/**
 * guard-gate-writes (PreToolUse on Bash, the file-writing tools, and Read|Grep|Glob). A SUBAGENT (the
 * payload carries `agent_id`) may not: mint, revoke or list actor tokens (any `board.mjs actor`
 * subcommand); compose a spawn prompt (`spawn-prompt.mjs compose` MINTS — design D: the orchestrator
 * composes, a subagent never does); re-seal the board's audit anchor (`audit-anchor.mjs create`);
 * run board.mjs / spawn-prompt.mjs / audit-anchor.mjs with a SUBCOMMAND or positional built at runtime,
 * or any command whose VERB or SCRIPT is (`$X`, `"$@"`, `$1`, `$'…'`, `$(…)` — C3G-2, C4G-H3, C4G-L1;
 * an expansion in a FLAG VALUE, `--head $(git rev-parse HEAD)`, or a script PATH whose file name is
 * spelled, `"$HOME/…/board.mjs"`, is fine — FB-n1); feed a shell text it did not spell out (`curl …|sh`;
 * a spelled heredoc / here-string / echo into a shell is read as commands — C4G-H1); load THIS
 * plugin's actor.mjs / evidence.mjs / events.mjs into its own program (matched by path, FB-n2); WRITE
 * — or remove, move, restore, check out, stash, reset, clean, patch, untar or unzip over — the token
 * registry, the board anchor under `<git dir>/studio/`, the gate evidence dir, the board log, a gate
 * result (`docs/team/*-result.json`, ship-gate-verdict.json, audit-anchor.json), or a CONTROL FILE
 * in the main tree (`docs/team/project-profile.json`, `risk-policy.json`, `capabilities.json`,
 * `.studio-policy.json` — C3G-3, C4G-H2, C4W-12), including by writing into or sweeping a directory
 * that holds them (`cp x docs/team/`, `rm -rf docs`, `git checkout .`, `find docs -delete`); start a
 * nested `claude` session (G2-16); read Claude Code's transcripts under ~/.claude/projects (G2-15),
 * including by a recursive search rooted at or above them (`grep -r x ~`, `rg x ~/.claude` — C4G-H4).
 * Paths are compared after `cd`, `git -C`, `NAME=value`, `$HOME`/`$PWD`/`$TMPDIR` and
 * `T=$(mktemp -d)` (a fresh temp dir — the reviewer prompt's own idiom, FB5-1/2), `.`/`..`/`//`,
 * symlink resolution (C4G-M2) including an `ln -s` made earlier in the same command (C5G-7),
 * case-insensitively on macOS (C4G-M1), with globs and unresolvable expansions as wildcards. A
 * redirect counts with or without a command word (`{ …; } > f`, `exec 3> f`, `<>` — C5G-2); an
 * inline program that writes anything counts every argv path it is handed (C5G-3). The writers are
 * an ENUMERATED list (C5G-4), deliberately not a reader allowlist: a false block on an honest
 * command costs more than a writer nobody has thought of yet. The main session (no `agent_id`) is the orchestrator and is not restricted. Scripts the
 * agent runs (verify-done.sh, journey-gate) still write evidence themselves — only hand-written paths
 * are refused. READING evidence, control files and the token registry (hashes only — C4G-L4) is fine,
 * and so is any sentence that merely MENTIONS these words (a quoted `--detail`, a commit message, a
 * grep, a heredoc that is data — FB-n3..n6). QA's journey declarations (docs/team/journeys/) are not
 * guarded.
 *
 * THE BOUND, STATED: this is a reading of a shell command, not a sandbox. It cannot see into a
 * program the subagent wrote to a file in an EARLIER call and runs now (`python3 x.py`, `sh x.sh` —
 * a file written by a heredoc in the SAME command is read), a value computed by a command
 * substitution whose output it then uses as a path (`D=$(…); cp x "$D"` with nothing else naming the
 * target), names built inside an interpreter (`'risk-' + 'policy.json'`, base64), a patch or archive
 * whose contents it cannot read (`curl …|git apply` is refused only in the main tree), aliases, or a
 * process it started earlier writing later. Nor can anything here tell a subagent from the
 * orchestrator by ENVIRONMENT: Claude Code sets the same AI_AGENT / CLAUDE_CODE_CHILD_SESSION in the
 * main session's Bash and in a subagent's (checked 2026-11-18), so the hook payload's `agent_id` is
 * the only marker — which is why compose refusal lives here and not in spawn-prompt.mjs. What this
 * misses is stopped, if at all, by the mint side (actor.mjs), the board re-deriving evidence from
 * git, the hash-chained token registry and board log, and the frozen test commands (design C). It
 * stops the confused and the literal, and makes the hostile leave a visible trail in its own
 * transcript.
 */
function guardGateWrites() {
  if (!payload.agent_id) allow();
  const input = payload.tool_input || {};
  const cwd = realish(resolve(payload.cwd || process.cwd()));
  // G7-12: the studio a target belongs to comes from the TARGET, not only from the cwd — `rm -rf
  // /abs/proj/docs/team/evidence` from /tmp names a studio root too. Each absolute path's nearest
  // existing directory is resolved like the cwd (its git main tree, else an ancestor holding a board log).
  const roots = new Set();
  const addRoot = (p) => {
    let d = resolve(cwd, /^~(\/|$)/.test(p) ? homedir() + p.slice(1) : p);
    while (!existsSync(d) && dirname(d) !== d) d = dirname(d);
    try { if (!statSync(d).isDirectory()) d = dirname(d); } catch { return; }
    if ([...roots].some((r) => d === r || d.startsWith(`${r}/`))) return;
    let r = projectRoot(d);
    for (let a = d; !r && dirname(a) !== a; a = dirname(a)) if (existsSync(join(a, 'docs', '31-board-events.jsonl'))) r = a;
    if (r) roots.add(realish(resolve(r)));
  };
  addRoot(cwd);
  const pathText = payload.tool_name === 'Bash' ? String(input.command || '') : [input.file_path, input.notebook_path, input.path].filter(Boolean).join('\n');
  // ponytail: the first 20 distinct absolute spellings; a command naming more is past the bound.
  [...new Set(pathText.match(/(?<![\w.$-])[~/][^\s'"`;|&<>(){}]*/g) || [])].slice(0, 20).forEach(addRoot);
  // PR47-6: ...and every RELATIVE path-like word (one containing `/`), resolved against the cwd —
  // `rm -rf ../proj/docs/team/evidence` from a non-studio cwd names that studio root too.
  [...new Set(pathText.split(/[\s'"`;|&<>(){}]+/).map((w) => w.replace(/^-[\w-]*=/, ''))
    .filter((w) => w.includes('/') && !/^[~/]/.test(w) && !/^\w+:\/\//.test(w)))].slice(0, 20).forEach((w) => addRoot(w));
  if (!roots.size) allow();
  const TOKENS = 'docs/team/actor-tokens.jsonl';
  // PR46-3: actors.json (the actor registry and its HMAC keys) and .studio-stop (the spawn kill switch) are control files too.
  const CONTROL = ['docs/team/project-profile.json', 'docs/team/risk-policy.json', 'docs/team/capabilities.json', '.studio-policy.json', 'docs/team/actors.json', '.studio-stop'];
  // Evidence, tokens and results live under the studio root (evidenceRoot) — an agent's own worktree copy is not them.
  const G = { transcripts: [join(realish(homedir()), '.claude', 'projects'), join(homedir(), '.claude', 'projects')],
    tokens: [], anchor: [], evidence: [], control: [], log: [], teamDir: [], results: [] };
  for (const R of roots) {
    let common = '';
    try { common = realish(execFileSync('git', ['-C', R, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { common = join(R, '.git'); }
    const g = {
      tokens: [join(R, TOKENS)],
      anchor: [join(common, 'studio'), join(R, '.git', 'studio')],
      evidence: [join(R, 'docs', 'team', 'evidence')],
      control: CONTROL.map((c) => join(R, c)),
      log: [join(R, 'docs', '31-board-events.jsonl')],
      teamDir: [join(R, 'docs', 'team')],
      results: ['*-result.json', 'ship-gate-verdict.json', 'audit-anchor.json'].map((f) => join(R, 'docs', 'team', f.replace('*', STAR))),
    };
    for (const k of Object.keys(g)) G[k].push(...g[k]);
  }
  const WRITE_WHAT = [
    ['tokens', 'write the actor token registry (board.mjs mints and revokes; reading it is fine)'],
    ['anchor', 'touch the board anchor under <git dir>/studio/'],
    ['evidence', 'write gate evidence by hand'],
    ['control', `write a control file in the main tree (${CONTROL.join(', ')})`],
    ['log', 'write the board log by hand (docs/31-board-events.jsonl — board.mjs appends it)'],
    ['results', 'write a gate result by hand (docs/team/*-result.json — the gate scripts write them)'],
  ];
  // G7-14: re-trusting the board log is the founder's, at a real terminal — never a subagent's, as `actor` is not.
  const ADOPT = 'run `board.mjs adopt` (re-trusting the board log is the founder\'s, at a real terminal; a faked TTY is still a subagent)';
  const refuse = (what) => block(`guard-gate-writes: a subagent may not ${what}.\n` +
    '  The orchestrator composes every spawn prompt and mints every token in it; gate evidence is written by\n' +
    '  the scripts that produce it (verify-done.sh, journey-gate, runtime-gate); control files change on the\n' +
    '  orchestrator\'s say. Use the token and paths your prompt gave you, spelled literally. If you lack one,\n' +
    '  stop and return BLOCKED naming what is missing — the orchestrator re-spawns you with a fresh prompt.');

  if (payload.tool_name === 'Bash') {
    const src = String(input.command || '');
    // FB5-1/FB5-2: the shell's own HOME / TMPDIR / PWD are known values, not wildcards (`rm -rf "$TMPDIR/x"`).
    const vars = { HOME: lit(homedir()).v, TMPDIR: lit(process.env.TMPDIR || tmpdir()).v, PWD: lit(cwd).v };
    const fileBodies = {}; // `cat > x.py <<EOF` earlier in this command: what x.py will hold
    let here = toSegs(cwd);
    // PR46-1: a `cd` that may not have run or may have failed (inside `( … )`, after `&&`/`||`, to a
    // directory that does not exist) cannot MOVE the guard: what runs after its and-or list is checked
    // against every cwd it could be in (`alts`), so an uncertain cd only ever adds refusals.
    let alts = []; let pend = null; const stack = [];
    // G7-9: …and so can a cd inside if/while/case/a function body (`depth`), in a pipeline or behind `&`
    // (a subshell), from a nested shell, a popd, a cd the command redefines, or into a dir it cannot enter.
    let depth = 0; const dirStack = [];
    const cdShadow = /(^|[^\w-])(cd|pushd|popd)\s*\(\s*\)|\bfunction\s+(cd|pushd|popd)\b|\balias\s+(cd|pushd|popd)=/.test(src);
    const heres = () => [here, ...alts];
    const hitsH = (pat, guards, tree = false) => heres().some((h) => hits(pat, h, guards, tree));
    const hereAbs = () => (here.some((s) => WILD.test(s)) ? '' : `/${here.join('/')}`);
    const read = (w) => {
      if (!w) return null;
      if (Object.prototype.hasOwnProperty.call(fileBodies, w.v.text)) return fileBodies[w.v.text];
      if (WILD.test(w.v.pat) || !hereAbs()) return null;
      try { return readFileSync(resolve(hereAbs(), w.v.text), 'utf8').slice(0, 1 << 20); } catch { return null; }
    };
    const checkWrites = (targets) => {
      for (const { w, tree, into } of targets) {
        // `cp x docs/team/`: docs/team/ is the studio's machine state (profile, policy, tokens, results) — nothing is copied into it.
        if (into && heres().some((h) => isDir(w.v.pat, h, G.teamDir[0]))) {
          refuse('copy or move a file into docs/team/ — the studio\'s machine state (profile, policy, tokens, results)');
        }
        if (into && heres().some((h) => G.teamDir.slice(1).some((t) => isDir(w.v.pat, h, t)))) refuse('copy or move a file into docs/team/ of another studio project');
        for (const [key, what] of WRITE_WHAT) {
          if (hitsH(w.v.pat, G[key], tree)) {
            refuse(tree ? `${what.replace(/^write /, 'remove, move or overwrite ')} — not even by sweeping the directory that holds it` : what);
          }
        }
      }
    };
    const queue = shellCommands(src);
    queue.forEach((c) => { c.top = true; });
    while (queue.length) {
      const raw = queue.shift();
      let chained = false; let orElse = false; // runs only if the one before it succeeded (`&&`) / failed (`||`)
      if (raw.top) {
        for (const ch of raw.ops.replace(/&&|\|\|/g, (m) => (m === '&&' ? 'A' : 'O'))) {
          if (ch === '(') stack.push({ here, alts, pend, pwd: vars.PWD });
          else if (ch === ')') { if (stack.length) ({ here, alts, pend, pwd: vars.PWD } = stack.pop()); }
          else { chained = ch === 'A'; orElse = ch === 'O'; }
        }
        // A cd's list has ended: its old cwds stay possible unless it surely ran (`cd x || y` — y runs only if it did not).
        if (!chained && pend) { if (!pend.sure || orElse) alts = [...alts, ...pend.cwds]; pend = null; }
        if (alts.length) vars.PWD = { text: '', pat: ANY };
      }
      // Everything that RUNS is read as commands: $(…), backticks, <(…) — and, in a heredoc whose delimiter is unquoted, its $(…).
      for (const w of raw) for (const p of w.parts || []) if (p.t === 'sub' && p.body) queue.push(...shellCommands(p.body));
      if (raw.stdinExpands) for (const c of shellCommands(`"${raw.stdin.replace(/"/g, '\\"')}"`)) for (const w of c) for (const p of w.parts || []) if (p.t === 'sub' && p.body) queue.push(...shellCommands(p.body));
      const words = raw.map((w) => (w.op || w.v ? w : { ...w, v: wordValue(w, vars) }));
      const args = []; const redirects = []; let stdinFile = null; let hereString = null;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!w.op) { args.push(w); continue; }
        const next = words[i + 1] && !words[i + 1].op ? words[++i] : null;
        if (!next) continue;
        if (w.op === '>') redirects.push(next); else if (w.op === '<') stdinFile = next; else if (w.op === '<<<') hereString = next.v.pat;
      }
      if (raw.stdin) redirects.forEach((r) => { fileBodies[r.v.text] = raw.stdin; });
      for (const a of args) { const t = a.v.text; if (OPENS.has(t)) depth++; else if (CLOSES.has(t)) depth = Math.max(0, depth - 1); else if (!RESERVED.has(t)) break; }
      // Assignments: `NAME=value` words before the command (or alone) bind for the rest of the line.
      let k = 0;
      for (; k < args.length; k++) {
        const m = args[k].v.text.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
        if (!m || args[k].parts?.[0]?.t !== 'u') break;
        const cut = m[0].length;
        vars[m[1]] = { text: args[k].v.text.slice(cut), pat: args[k].v.pat.slice(cut) };
        // FB5-1: `T=$(mktemp -d)` (the reviewer prompt's own idiom) is a fresh dir under $TMPDIR, not ANY.
        const ps = args[k].parts || [];
        if (ps.at(-1)?.t === 'sub' && ps.slice(0, -1).every((p) => p.t === 'u') && MKTEMP.test(ps.at(-1).body)) vars[m[1]] = lit(join(vars.TMPDIR.text, 'mktemp.anon')).v;
      }
      // Reserved words and wrappers (`if`, `do`, `env -i`, `xargs -0`, `sudo -u x`) are not the command.
      let xargs = false; let viaPkg = false;
      while (k < args.length) {
        const t = args[k].v.text;
        if (RESERVED.has(t)) { k++; continue; }
        const wn = fold(basename(t)); const wr = WRAPPERS.get(wn);
        if (!wr) break;
        if (wn === 'xargs') xargs = true;
        if (wn === 'npx' || wn === 'bunx') viaPkg = true;
        k++;
        while (k < args.length && (args[k].v.text.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[k].v.text))) k += wr.vals.has(args[k].v.text) ? 2 : 1;
        k += wr.ops;
      }
      const cmdWords = args.slice(k);
      // C5G-2: `{ …; } > f`, `( … ) > f`, `exec 3> f` — a redirect with no command word still opens its file.
      if (!cmdWords.length) { checkWrites(redirects.map((w) => ({ w, tree: false }))); continue; }
      const texts = cmdWords.map((w) => w.v.text);
      const name = fold(basename(texts[0])).replace(/(.)@[^/]*$/, '$1'); // `npx prettier@3`
      if (['case', 'for', 'select', 'function'].includes(name)) continue;
      const rest = cmdWords.slice(1);
      const pure = (w) => w.v.text === '' && /^\u0003+$/.test(w.v.pat);
      const nameWild = (w) => WILD.test(lastSeg(w.v.pat));
      // C4G-H3 / L1: a verb that is nothing but an expansion runs whatever it expands to.
      if (pure(cmdWords[0])) refuse('run a command whose name is built at runtime ($X, "$@", $1, $\'…\', $(…)). Spell the command literally');
      if (name === 'claude' || name === 'claude-code' || texts.some((t) => /@anthropic-ai\/claude-code\b/.test(t))) {
        refuse('start a nested `claude` session (it would carry no agent_id past these checks)');
      }
      if (name === 'popd') { // back to where the matching pushd stood — uncertain, so where it is now stays too
        const before = heres();
        [here, ...alts] = dirStack.pop() || [[ANY]];
        alts = [...alts, ...before];
        pend = { cwds: [...(pend?.cwds || []), ...before], sure: false };
        vars.PWD = { text: '', pat: ANY }; // uncertain: $PWD could be either
        continue;
      }
      if (name === 'cd' || name === 'pushd') {
        const t = cmdWords.slice(1).find((w) => !/^-[LPe@]+$/.test(w.v.text));
        const before = heres();
        const to = (h) => (!t ? toSegs(homedir()) : t.v.text === '-' ? [ANY] : patSegs(t.v.pat.includes(ANY) || /[\u0001\u0002]/.test(t.v.pat) ? t.v.pat : t.v.text, h));
        if (name === 'pushd') dirStack.push(before);
        [here, ...alts] = before.map(to);
        const abs = hereAbs();
        const exists = abs && (abs.includes('/mktemp.anon') || (existsSync(abs) && enterable(abs)));
        const unsure = depth > 0 || raw.bg || raw.pipedFrom || raw.pipeTo || cdShadow || !raw.top;
        if (unsure) alts = [...alts, ...before]; // it may not run, or not here: the old cwds stay possible at once
        pend = { cwds: [...(pend?.cwds || []), ...before], sure: !unsure && !pend && !chained && Boolean(exists) };
        vars.PWD = hereAbs() ? lit(hereAbs()).v : { text: '', pat: ANY };
        continue;
      }
      // What a shell would read from stdin here, if it is spelled out: a heredoc, a here-string, `echo …|`, `cat <<EOF|`.
      const fed = (() => {
        if (raw.stdin) return raw.stdin;
        if (hereString != null) return hereString;
        const from = raw.pipedFrom;
        if (from) {
          const fw = from.filter((w) => !w.op).map((w) => wordValue(w, vars));
          const fn = basename(fw[0]?.text || '');
          if (fn === 'echo' || fn === 'printf') return fw.slice(1).map((v) => v.pat).join(' ').replace(/\\n/g, '\n');
          if (fn === 'cat' && from.stdin && fw.length === 1) return from.stdin;
          return null; // unknown text
        }
        if (stdinFile) return read(stdinFile);
        return undefined; // no stdin redirect at all
      })();
      // `sh -c "…"`, `bash -lc`, `eval …`, and a bare shell reading its script from stdin (C4G-H1).
      if (SHELLS.test(name) || ((name === 'source' || name === '.') && rest[0])) {
        const ci = rest.findIndex((w) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w.v.text));
        const script = rest.find((w) => !w.v.text.startsWith('-'));
        if (ci >= 0 && SHELLS.test(name)) {
          const body = rest[ci + 1];
          if (body && pure(body)) refuse('run a shell command whose text is built at runtime');
          if (body) queue.push(...shellCommands(body.v.pat));
        } else if (script && !['/dev/stdin', '-'].includes(script.v.text) && !(SHELLS.test(name) && rest.some((w) => /^-[a-zA-Z]*s/.test(w.v.text)))) {
          if (pure(script) || nameWild(script)) refuse('run a shell script whose name is built at runtime');
          if (Object.prototype.hasOwnProperty.call(fileBodies, script.v.text)) queue.push(...shellCommands(fileBodies[script.v.text]));
        } else if (fed === null) refuse('pipe text it did not spell out into a shell (`curl …|sh`). Run the commands themselves');
        else if (fed !== undefined) queue.push(...shellCommands(fed));
      }
      if (name === 'eval') {
        if (rest.some((w) => WILD.test(w.v.pat))) refuse('eval text built at runtime');
        queue.push(...shellCommands(rest.map((w) => w.v.text).join(' ')));
      }

      // The plugin's own CLIs: the subcommand and every positional must be spelled (flag VALUES may expand — FB-n1).
      const si = cmdWords.findIndex((w) => /(^|\/)(board|spawn-prompt|audit-anchor)\.mjs$/.test(fold(w.v.text)));
      if (si >= 0) {
        const script = fold(basename(texts[si]));
        const after = cmdWords.slice(si + 1);
        const positionals = [];
        for (let i = 0; i < after.length; i++) {
          const t = after[i].v.text;
          if (t.startsWith('--')) { if (!t.includes('=') && after[i + 1] && !after[i + 1].v.text.startsWith('--')) i++; continue; }
          positionals.push(after[i]);
        }
        if (nameWild(cmdWords[si]) || xargs || positionals.some((w) => WILD.test(w.v.pat))) {
          refuse(`run ${script} with a script name, subcommand or positional built at runtime ($(…), backticks, $VAR, "$@", a glob, xargs). Spell the command literally — only flag values (--head "$(git rev-parse HEAD)") and \${CLAUDE_PLUGIN_ROOT} may expand`);
        }
        const actorCmd = script === 'board.mjs' && after.some((w) => w.v.text === 'actor');
        if (actorCmd) refuse('mint, revoke or list actor tokens (any `board.mjs actor` subcommand)');
        if (script === 'board.mjs' && after.some((w) => w.v.text === 'adopt')) refuse(ADOPT);
        if (script === 'spawn-prompt.mjs' && after.some((w) => w.v.text === 'compose')) refuse('run `spawn-prompt.mjs compose` — composing a prompt MINTS its tokens; the orchestrator composes');
        if (script === 'audit-anchor.mjs' && after.some((w) => w.v.text === 'create')) refuse('re-seal the board log (`audit-anchor.mjs create`) — the release manager\'s orchestrator does, at ship');
      }
      if (!['echo', 'printf'].includes(name) && texts.some((t, i) => t === 'actor' && /^(mint|revoke)$/.test(texts[i + 1] || ''))) refuse('mint, revoke or list actor tokens (any `board.mjs actor` subcommand)');
      // C3G-2: a script whose FILE NAME is built at runtime (`scripts/$B.mjs`, `b?ard.mjs`), or an interpreter's script that is one.
      const dynamicMjs = cmdWords.some((w) => /\.m?js$/.test(w.v.text) && nameWild(w));
      const interp = INTERPRETERS.test(name) ? rest.find((w) => !w.v.text.startsWith('-')) : null;
      const dynamicScript = interp && /^(node|deno|bun|tsx|ts-node)$/.test(name) && (pure(interp) || nameWild(interp));
      if (dynamicMjs || dynamicScript) {
        refuse('run a plugin script whose name is built at runtime ($(…), backticks, $VAR, a glob). Spell the command literally, with only ${CLAUDE_PLUGIN_ROOT} expanded');
      }

      // C4G-H4: a recursive search rooted at or above ~/.claude/projects reads the transcripts too.
      const recursive = ['rg', 'ag', 'ack', 'find', 'fd', 'tree', 'du'].includes(name)
        || (/^(grep|egrep|fgrep|ls)$/.test(name) && rest.some((w) => /^(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive)$/.test(w.v.text)));
      if (recursive) {
        const roots = rest.filter((w) => !w.v.text.startsWith('-'));
        if ([...roots, DOT].some((w) => hitsH(w.v.pat, G.transcripts, true))) refuse('search a directory that holds Claude Code session transcripts (~/.claude/projects)');
      }
      // Paths: any word naming the anchor or the transcripts.
      for (const w of cmdWords) {
        const { pat } = w.v;
        if (hitsH(pat, G.transcripts)) refuse('read Claude Code session transcripts under ~/.claude/projects');
        if (hitsH(pat, G.anchor)) refuse('touch the board anchor under <git dir>/studio/');
      }
      // find: -delete sweeps its start paths; -exec/-execdir/-ok run a command on each `{}` — read that command too.
      if (name === 'find') {
        const starts = [];
        for (const w of rest) { if (/^[-(!]/.test(w.v.text)) break; starts.push(w); }
        const start = starts[0] || DOT;
        if (rest.some((w) => w.v.text === '-delete')) starts.concat(starts.length ? [] : [DOT]).forEach((w) => {
          for (const [key, what] of WRITE_WHAT) if (hitsH(w.v.pat, G[key], true)) refuse(what);
        });
        rest.forEach((w, i) => {
          if (/^-(fprint0?|fprintf|fls)$/.test(w.v.text) && rest[i + 1]) for (const [key, what] of WRITE_WHAT) if (hitsH(rest[i + 1].v.pat, G[key])) refuse(what);
          if (!/^-(exec|execdir|ok|okdir)$/.test(w.v.text)) return;
          const cmd = [];
          for (let j = i + 1; j < rest.length && !/^[;+]$/.test(rest[j].v.text); j++) {
            const t = rest[j].v;
            cmd.push({ v: t.text.includes('{}') ? { text: t.text.replace('{}', `${start.v.text}/x`), pat: t.pat.replace('{}', `${start.v.pat}/${ANY}`) } : t });
          }
          if (cmd.length) queue.push(cmd);
        });
      }
      checkWrites(writeTargets(name, rest, { redirects, stdin: fed ?? null, stdinFile, read, xargs, viaPkg }));
      if (name === 'ln' && rest.some((w) => /^(-[a-zA-Z]*s[a-zA-Z]*|--symbolic)$/.test(w.v.text))) {
        const [t, l] = rest.filter((w) => !w.v.text.startsWith('-'));
        if (t) {
          let from = patSegs(l ? l.v.pat : lastSeg(t.v.pat), here);
          const abs = `/${from.join('/')}`;
          if (!from.some((x) => WILD.test(x)) && existsSync(abs) && statSync(abs).isDirectory()) from = [...from, lastSeg(t.v.pat)];
          LINKS.push({ from, to: patSegs(t.v.pat, from.slice(0, -1)) }); // a relative target is relative to the link's own dir
        }
      }
      // A program written inline (`node -e`, a heredoc into python, a file this command just wrote) that touches a guarded file.
      if (INTERPRETERS.test(name)) {
        const fromFile = interp && Object.prototype.hasOwnProperty.call(fileBodies, interp.v.text) ? fileBodies[interp.v.text] : '';
        const body = [texts.join(' '), typeof fed === 'string' ? fed : '', fromFile].join('\n').replace(/\/+(\.\/)*/g, '/');
        const has = (s) => (DARWIN ? body.toLowerCase().includes(s.toLowerCase()) : body.includes(s));
        if (has('.claude/projects')) refuse('read Claude Code session transcripts under ~/.claude/projects');
        if (has('.git/studio')) refuse('touch the board anchor under <git dir>/studio/');
        if (/board\.mjs/.test(body) && /\badopt\b/.test(body)) refuse(ADOPT); // G7-14: `python3 -c "…pty.spawn([…'board.mjs','adopt'])"`
        if (pluginLib(body, hereAbs()) || /\b(mintActorToken|revokeActorToken|writeTestEvidence|writeEvidenceLog|writeAnchor)\b/.test(body)) {
          refuse('load the actor, evidence or events library into a program of its own');
        }
        const { hit, writes } = inlineWrite(body);
        if (hit) refuse(`write ${hit} by hand from a program of its own`);
        // C5G-3: a program that writes SOMETHING may write a path it is handed on argv
        // (`node -e "…writeFileSync(process.argv[1]…" <path>`, `python3 - <path> <<EOF`): every argv word is a target.
        if (writes) {
          const pi = rest.findIndex((w) => /^(-[a-zA-Z]*[ecE]|--eval|--print)$/.test(w.v.text));
          for (const w of rest.filter((x, i) => !x.v.text.startsWith('-') && !(pi >= 0 && i === pi + 1))) {
            for (const [key, what] of WRITE_WHAT) if (hitsH(w.v.pat, G[key])) refuse(`${what} — not by handing its path to a program that writes`);
          }
        }
      }
    }
    allow();
  }

  // Write/Edit/Read/Grep/Glob: the path (and, for Glob/Grep, path + pattern) as a glob over guarded paths.
  const tilde = (p) => (/^~(\/|$)/.test(p) ? homedir() + p.slice(1) : p);
  const base = tilde(String(input.path || '')) || cwd;
  // C4G-L5: a Glob pattern may itself start with ~ or be absolute.
  const withBase = (p) => { const t = tilde(String(p)); return isAbsolute(t) ? t : join(base, t); };
  const searchFrom = ['Grep', 'Glob'].includes(payload.tool_name) ? String(input.path || cwd) : ''; // PR46-7: no path = the cwd
  const candidates = [input.file_path, input.notebook_path, input.path || searchFrom,
    input.pattern && payload.tool_name === 'Glob' ? withBase(input.pattern) : '',
    input.glob ? withBase(input.glob) : ''].filter(Boolean).map((p) => String(p).replace(/\\/g, '/'));
  if (!candidates.length) allow();
  const asPat = (p) => {
    const abs = p.startsWith('~') ? homedir() + p.slice(1) : isAbsolute(p) ? p : resolve(cwd, p);
    const real = /[*?[]/.test(abs) ? abs : realish(abs);
    return real.replace(/\[[^\]/]*\]/g, ONE).replace(/\*/g, STAR).replace(/\?/g, ONE);
  };
  for (const c of candidates) if (hits(asPat(c), [], G.transcripts)) refuse('read Claude Code session transcripts under ~/.claude/projects');
  // A recursive search FROM an ancestor (`Grep path: ~/.claude`) walks into the transcripts too.
  if (searchFrom) {
    const dir = realish(resolve(cwd, tilde(searchFrom)));
    if (G.transcripts.some((t) => t.startsWith(`${dir.replace(/\/$/, '')}/`))) refuse('search a directory that holds Claude Code session transcripts (~/.claude/projects)');
  }
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(payload.tool_name)) allow();
  const target = asPat(candidates[0]);
  if (hits(target, [], G.anchor) || fold(candidates[0]).includes('.git/studio/')) refuse('write the board anchor under .git/studio/');
  for (const [key, what] of WRITE_WHAT) if (hits(target, [], G[key])) refuse(what);
  allow();
}

switch (process.argv[2]) {
  case 'pre-spawn': preSpawn(); break;
  case 'subagent-stop': subagentStop(); break;
  case 'guard-gate-writes': guardGateWrites(); break;
  default: allow();
}
