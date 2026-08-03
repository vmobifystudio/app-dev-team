#!/usr/bin/env node
/**
 * Governed memory inbox. Proposals are append-only; only an explicit review event can promote,
 * reject, supersede, or contradict one. Memory is never silently learned from arbitrary output.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`memory-curator: ${message}\n`); process.exit(code); };
const { flags, positional } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['ledger', 'id', 'class', 'content', 'source', 'scope', 'confidence', 'expires', 'supersedes', 'contradicts', 'by', 'reason', 'now']), die });
const command = positional[0];
const path = resolve(String(flags.ledger || 'docs/team/memory.jsonl'));
const classes = new Set(['run', 'ticket', 'project', 'platform', 'studio', 'founder']);
function records() {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean); let previous = '';
  return lines.map((line, index) => {
    let record; try { record = JSON.parse(line); } catch { die(2, `malformed record at line ${index + 1}`); }
    const expected = createHash('sha256').update(`${previous}\n${JSON.stringify({ ...record, hash: undefined })}`).digest('hex');
    if (record.prev_hash !== previous || record.hash !== expected) die(2, `memory chain broken at line ${index + 1}`);
    previous = record.hash; return record;
  });
}
function required(name) { if (!flags[name] || flags[name] === true) die(2, `--${name} needs a value`); return String(flags[name]); }
function append(event, fields) {
  const all = records(); const previous = all.at(-1)?.hash || '';
  const record = { schema: 'memory-ledger/v1', ts: new Date().toISOString(), event, ...fields, prev_hash: previous };
  record.hash = createHash('sha256').update(`${previous}\n${JSON.stringify({ ...record, hash: undefined })}`).digest('hex');
  mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(record)}\n`); console.log(JSON.stringify(record));
}
if (!command) die(2, 'usage: propose|review|list|retrieve|verify');
const all = records();
if (command === 'propose') {
  const memoryClass = required('class'); if (!classes.has(memoryClass)) die(2, `invalid memory class: ${memoryClass}`);
  const content = required('content'); const source = required('source'); const confidence = Number(flags.confidence || 0.5);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) die(2, '--confidence must be between 0 and 1');
  append('proposed', { memory_id: String(flags.id || `MEM-${randomUUID()}`), class: memoryClass, content, source, scope: flags.scope || 'project', confidence, expires: flags.expires || null, supersedes: flags.supersedes || null, contradicts: flags.contradicts || null, by: flags.by || null });
} else if (command === 'review') {
  const id = required('id'); const candidate = all.find((r) => r.memory_id === id && r.event === 'proposed');
  if (!candidate) die(1, `no proposed memory candidate ${id}`);
  const decision = required('reason'); if (!['promote', 'reject', 'supersede', 'contradict'].includes(decision)) die(2, '--reason must be promote, reject, supersede, or contradict');
  append('reviewed', { memory_id: id, decision, by: required('by'), rationale: required('content'), source: candidate.source });
} else if (command === 'list') {
  // `retrieve` already filtered by `--class` (studio/founder/etc.) so a reviewer could ask "what's
  // live in this class"; `list` — the one place a PENDING proposal is visible before promotion —
  // had no such filter, so a class with proposals nobody had reviewed yet (e.g. `studio`, still
  // scaffolding with zero producers before this) was invisible to a targeted look and only found
  // by scanning every class's output by eye.
  const proposalsById = new Map();
  for (const record of all) if (record.event === 'proposed') proposalsById.set(record.memory_id, record);
  const latest = new Map(); for (const record of all) if (record.memory_id) latest.set(record.memory_id, record);
  for (const record of latest.values()) {
    if (record.event !== 'proposed' && !(record.event === 'reviewed' && record.decision === 'promote')) continue;
    if (flags.class && proposalsById.get(record.memory_id)?.class !== String(flags.class)) continue;
    console.log(JSON.stringify(record));
  }
} else if (command === 'retrieve') {
  // The missing read path: `propose`/`review` write, but nothing ever read the six scopes back —
  // a memory-scope vocabulary with no retrieval that respects it is not governance, it is a write-
  // only log. Live means: promoted (not merely proposed), not expired as of --now, and not the
  // target of another PROMOTED memory's `supersedes`/`contradicts` — a stale or reversed memory
  // must not keep surfacing just because nobody deleted the line that proposed it.
  const now = new Date(String(flags.now || new Date().toISOString()));
  if (Number.isNaN(now.getTime())) die(2, '--now must be an ISO timestamp');
  const proposals = new Map();
  const decisions = new Map();
  for (const record of all) {
    if (record.event === 'proposed') proposals.set(record.memory_id, record);
    if (record.event === 'reviewed') decisions.set(record.memory_id, record);
  }
  const invalidated = new Set();
  for (const [id, decision] of decisions) {
    if (decision.decision !== 'promote') continue;
    const proposal = proposals.get(id);
    if (proposal?.supersedes) invalidated.add(proposal.supersedes);
    if (proposal?.contradicts) invalidated.add(proposal.contradicts);
  }
  const live = [];
  for (const [id, proposal] of proposals) {
    if (decisions.get(id)?.decision !== 'promote') continue;
    if (invalidated.has(id)) continue;
    if (proposal.expires && new Date(proposal.expires) <= now) continue;
    if (flags.class && proposal.class !== String(flags.class)) continue;
    live.push(proposal);
  }
  live.forEach((record) => console.log(JSON.stringify(record)));
  console.log(`MEMORY RETRIEVE: ${live.length} live record(s)${flags.class ? ` in class ${flags.class}` : ''}`);
} else if (command === 'verify') {
  console.log(`MEMORY CURATOR: CLEAR — ${all.length} chained record(s)`);
} else die(2, `unknown command ${command}`);
