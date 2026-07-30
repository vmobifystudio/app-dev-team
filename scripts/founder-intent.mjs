#!/usr/bin/env node
/**
 * founder-intent — the immutable record, and the check that proves it is still immutable.
 *
 * `docs/00-founder-intent/` holds the founder's own words: the brief, the transcripts, the examples
 * they sent, the constraints they set. Every derived document in the project is an interpretation of
 * this directory, and the team's entire closed-loop problem is that it can prove conformity to its
 * interpretation and nothing else. That only helps if the thing being interpreted cannot quietly
 * change to match the interpretation.
 *
 * So: a manifest of SHA-256 hashes, and a check that fails when a recorded file and its hash
 * disagree. `--write` is append-only itself — it records new files and REFUSES to re-record a
 * changed one, because a writer that launders the record is not a record.
 *
 * ponytail: the body digest detects a deleted manifest line; it does not defend against someone
 * rewriting the manifest wholesale. Git history is the real chain — this catches the accidental
 * edit and the agent that "tidied" the brief, which are the two things that actually happen.
 *
 * Usage:  node scripts/founder-intent.mjs [--project-root <dir>] [--write] [--json]
 * Exit:   0 clean · 1 findings (tampered) · 2 cannot evaluate (no record, or no manifest yet)
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIR = 'docs/00-founder-intent';
const MANIFEST = 'MANIFEST.sha256';
const HEADER = [
  '# Founder intent manifest — append-only. One line per recorded file: <sha256>  <path>',
  '# Written by scripts/founder-intent.mjs --write. Never hand-edit: the check will say so.',
];

// --- args ----------------------------------------------------------------------------------------
// Typed, positionally, and never interpolated into a shell. `--project-root` takes the NEXT
// argument and nothing else, so a value that begins with `--` is a value, not a second flag.
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const ROOT = value('--project-root', '.');
const WRITE = flag('--write');
const JSON_OUT = flag('--json');

const findings = [];
const add = (code, where, detail, action) => findings.push({ code, where, detail, action });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Every file under the record, relative to it, sorted, POSIX-spelled. `MANIFEST.sha256` excluded. */
function recordedFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d).sort()) {
      if (entry.startsWith('.')) continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.filter((f) => f !== MANIFEST);
}

/** Body lines only — `<sha>  <path>` — plus the digest line if present. */
function parseManifest(text) {
  const entries = new Map();
  let digest = null;
  for (const line of text.split(/\r?\n/)) {
    const d = line.match(/^#\s*body-sha256:\s*([0-9a-f]{64})\s*$/);
    if (d) { digest = d[1]; continue; }
    if (line.startsWith('#') || !line.trim()) continue;
    const m = line.match(/^([0-9a-f]{64})\s\s(.+)$/);
    if (m) entries.set(m[2].trim(), m[1]);
  }
  return { entries, digest };
}

const bodyLines = (entries) =>
  [...entries.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, h]) => `${h}  ${p}`);

// --- run -----------------------------------------------------------------------------------------

const dir = join(ROOT, DIR);
const manifestPath = join(dir, MANIFEST);

if (!existsSync(dir)) {
  report(2, `CANNOT EVALUATE — there is no ${DIR}/ in ${ROOT}. There is no founder record to check, which is itself the finding: every scope decision downstream points at nothing.`);
}

const present = recordedFiles(dir);
if (present.length === 0) {
  report(2, `CANNOT EVALUATE — ${DIR}/ exists and is empty. A record with nothing in it cannot support a PRD; product-validator returns INTENT: CANNOT EVALUATE against it.`);
}

const hashes = new Map(present.map((f) => [f, sha256(readFileSync(join(dir, f)))]));
const prior = existsSync(manifestPath) ? parseManifest(readFileSync(manifestPath, 'utf8')) : null;

if (WRITE) {
  const entries = new Map(prior ? prior.entries : []);
  const changed = [];
  const added = [];
  for (const [file, hash] of hashes) {
    if (!entries.has(file)) { entries.set(file, hash); added.push(file); }
    else if (entries.get(file) !== hash) changed.push(file);
  }
  // A DELETION IS A CHANGE. This loop walked `hashes` — the files still ON DISK — so a recorded
  // file that had been DELETED was neither in `changed` nor in `added`: `--write` exited 0 saying
  // RECORDED, left the stale manifest entry in place, and only a separate later invocation of the
  // verify path ever noticed. `/app-init` and `requirements-intake` use the writer AS the recording
  // step, so the moment that mattered passed clean.
  //
  // Same principle as the edit case immediately below, and the reason is identical: the record is
  // append-only, so removing the founder's words is exactly the operation it exists to prevent.
  // Reported by codex on PR #10.
  const onDisk = new Set([...hashes].map(([file]) => file));
  const deleted = prior ? [...prior.entries].filter(([file]) => !onDisk.has(file)).map(([file]) => file) : [];
  if (deleted.length > 0) {
    add('intent_file_deleted', `${DIR}/${MANIFEST}`,
      `${deleted.length} recorded file(s) are gone from disk: ${deleted.join(', ')}. The founder record is append-only; --write refuses rather than quietly recording a smaller record than the one it was given.`,
      `Restore ${deleted.join(', ')} from version control. If the founder genuinely retracted something, that is a NEW dated entry in decisions.md saying so — the original stays.`);
    report(1, `REFUSED — ${deleted.length} recorded file(s) were deleted.`);
  }
  if (changed.length > 0) {
    // The whole point. A writer that re-records a changed file is a writer that erases the evidence
    // of the edit, and then every check downstream is green about a brief nobody can trust.
    add('intent_write_refused', `${DIR}/${MANIFEST}`,
      `${changed.length} recorded file(s) changed since they were recorded: ${changed.join(', ')}. The founder record is append-only, so --write refuses rather than re-recording them.`,
      'Restore the file to its recorded content and re-run, or add the founder\'s new words as a NEW dated entry in decisions.md and leave the original alone.');
    report(1, `REFUSED — ${changed.length} recorded file(s) were edited.`);
  }
  const body = bodyLines(entries);
  const text = `${[...HEADER, ...body, `# body-sha256: ${sha256(body.join('\n'))}`].join('\n')}\n`;
  writeFileSync(manifestPath, text);
  report(0, `RECORDED — ${entries.size} file(s) in ${DIR}/${added.length ? `, ${added.length} newly added: ${added.join(', ')}` : ' (nothing new)'}.`);
}

if (!prior) {
  report(2, `CANNOT EVALUATE — ${DIR}/ holds ${present.length} file(s) and no ${MANIFEST}. Nothing has been recorded, so nothing can be shown to be unchanged.`);
}

const expectedDigest = sha256(bodyLines(prior.entries).join('\n'));
if (prior.digest && prior.digest !== expectedDigest) {
  add('intent_manifest_tampered', `${DIR}/${MANIFEST}`,
    'The manifest\'s own body digest does not match its lines. A line was edited or removed — which is how a recorded file gets un-recorded without its hash ever being seen to disagree.',
    'Recover the manifest from git history. Do not re-run --write over it: that records the current state as if it had always been the founder\'s words.');
}

for (const [file, hash] of prior.entries) {
  if (!hashes.has(file)) {
    add('intent_record_removed', `${DIR}/${file}`,
      'Recorded in the manifest and no longer on disk. The founder record is append-only; a removal is a deletion of the only external oracle this team has.',
      'Restore the file from git history.');
  } else if (hashes.get(file) !== hash) {
    add('intent_record_modified', `${DIR}/${file}`,
      `Content hash disagrees with the manifest (recorded ${hash.slice(0, 12)}…, found ${hashes.get(file).slice(0, 12)}…). The founder's words were edited after they were recorded, so every document derived from them is now derived from something else.`,
      'Restore the recorded content, and record the founder\'s new words as a new dated entry in decisions.md instead.');
  }
}

for (const file of hashes.keys()) {
  if (!prior.entries.has(file)) {
    add('intent_record_unrecorded', `${DIR}/${file}`,
      'Present in the founder record and named by no manifest line, so nothing can tell whether it has been edited since it arrived. An unrecorded source is indistinguishable from an invented one.',
      'Run: node scripts/founder-intent.mjs --project-root <dir> --write');
  }
}

report(findings.length > 0 ? 1 : 0,
  findings.length > 0
    ? `TAMPERED — ${findings.length} finding(s) against the founder record.`
    : `INTACT — ${prior.entries.size} recorded file(s), all hashes agree.`);

// --- report --------------------------------------------------------------------------------------

function report(code, headline) {
  const verdict = code === 0 ? 'INTACT' : code === 1 ? 'TAMPERED' : 'CANNOT EVALUATE';
  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify({ ok: code === 0, verdict, exit: code, headline, findings }, null, 2)}\n`);
  } else {
    process.stdout.write(`FOUNDER INTENT — ${headline}\n`);
    for (const f of findings) {
      process.stdout.write(`\n  ${f.code}  (${f.where})\n     ${f.detail}\n     -> ${f.action}\n`);
    }
  }
  process.exit(code);
}
