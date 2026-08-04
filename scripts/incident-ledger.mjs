#!/usr/bin/env node
/** Small append-only incident/release-health record, separate from ticket completion state. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { withFileLock } from './lib/atomic.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`incident-ledger: ${message}\n`); process.exit(code); };
const { flags, positional } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['ledger', 'id', 'severity', 'title', 'owner', 'detail', 'by', 'status', 'evidence']), die });
const command = positional[0]; const path = resolve(String(flags.ledger || 'docs/team/incidents.jsonl'));
function records() { if (!existsSync(path)) return []; const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean); let previous = ''; return lines.map((line, index) => { let r; try { r = JSON.parse(line); } catch { die(2, `malformed record at line ${index + 1}`); } const expected = createHash('sha256').update(`${previous}\n${JSON.stringify({ ...r, hash: undefined })}`).digest('hex'); if (r.prev_hash !== previous || r.hash !== expected) die(2, `incident chain broken at line ${index + 1}`); previous = r.hash; return r; }); }
function required(name) { if (!flags[name] || flags[name] === true) die(2, `--${name} needs a value`); return String(flags[name]); }
// Serialized like the board and the run ledger. The read of the previous hash and the append are
// one operation: two concurrent `open` calls both reading the same tip is how a hash chain forks,
// and an incident ledger that forks during an incident is the worst possible moment to lose the
// record. Same primitive, so there is one lock semantics in the repo rather than four.
function append(event, fields) { return withFileLock(path, () => { const all = records(); const previous = all.at(-1)?.hash || ''; const r = { schema: 'incident-ledger/v1', ts: new Date().toISOString(), event, ...fields, prev_hash: previous }; r.hash = createHash('sha256').update(`${previous}\n${JSON.stringify({ ...r, hash: undefined })}`).digest('hex'); mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(r)}\n`); console.log(JSON.stringify(r)); }, { die }); }
if (!command) die(2, 'usage: open|update|resolve|verify');
const all = records();
if (command === 'open') { const severity = required('severity'); if (!['sev1', 'sev2', 'sev3', 'sev4'].includes(severity)) die(2, 'severity must be sev1, sev2, sev3, or sev4'); append('opened', { incident_id: String(flags.id || `INC-${randomUUID()}`), severity, title: required('title'), owner: required('owner'), status: 'open', detail: flags.detail || null, by: flags.by || null }); }
else if (command === 'update' || command === 'resolve') { const id = required('id'); if (!all.some((r) => r.incident_id === id && r.event !== 'resolved')) die(1, `no open incident ${id}`); append(command === 'resolve' ? 'resolved' : 'updated', { incident_id: id, status: command === 'resolve' ? 'resolved' : String(flags.status || 'mitigating'), detail: required('detail'), evidence: flags.evidence || null, by: required('by') }); }
else if (command === 'verify') console.log(`INCIDENT LEDGER: CLEAR — ${all.length} chained record(s)`);
else die(2, `unknown command ${command}`);
