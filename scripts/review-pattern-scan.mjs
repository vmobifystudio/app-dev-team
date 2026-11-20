#!/usr/bin/env node
/**
 * review-pattern-scan — do two or more tickets share the same blocking review finding?
 *
 * THE MEASURED GAP (OPS-014, docs/reviews/2026-08-07-adversarial-operations-review.md). Code review
 * is per-ticket: `code-reviewer` writes a verdict to `docs/53-reviews/APP-NNN-cycle-N.md` and each
 * REQUEST CHANGES burns that ticket's own retry budget. Nothing correlates across tickets — three
 * tickets independently failing on the same underlying spec defect (a wrong token, a missing
 * pattern in the impl spec, a contract nobody documented) each pay for their own discovery, even
 * though every verdict that found it is already sitting on disk in the same directory.
 *
 * WHAT THIS CHECKS, mechanically rather than semantically: a `REVIEW VERDICT: REQUEST CHANGES`
 * file's `Ticket:` and its `Blocking: <file:line> …` items (the format the board requires), or the
 * older `## REQUEST CHANGES: <ticket>` / `## Blocking` / `### N. \`<file[:line]>\`` shape. Group the
 * (file path) side of that heading across every review file; if two or more DISTINCT tickets have a
 * blocking finding naming the same file, that is reported as a shared-file pattern. A cheap,
 * defensible signal — not a claim that the underlying defect is identical, only that the same file
 * has blocked more than one ticket, which is exactly the thing worth a human's five minutes before a
 * third ticket burns a retry on it.
 *
 * REPORT-ONLY. This never blocks a round; `orchestrator.mjs round` prints what it finds. Correlating
 * findings is a lead, not a verdict — the human or `tech-manager` decides whether it is one root
 * cause worth a shared fix.
 *
 * Usage:  review-pattern-scan.mjs [--root <dir>] [--reviews-dir docs/53-reviews] [--json]
 *
 * Exit codes:
 *   0  ran to completion (patterns are reported in the output, not in the exit code)
 *   2  cannot evaluate — no reviews directory found
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`review-pattern-scan: ${message}\n`); process.exit(code); };

const { flags } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'reviews-dir']),
  knownFlags: new Set(['root', 'reviews-dir', 'json']),
  die,
});

// No project-root resolution here, deliberately: this reads one directory of Markdown and mutates
// nothing, so the strict marker check `lib/root.mjs` uses to protect writes would only produce
// false CANNOT-EVALUATEs on a reviews-only fixture or a project mid-`/app-init`. `--root` (default
// cwd) names the directory whose `docs/53-reviews` (or `--reviews-dir`) to scan; nothing more.
const ROOT = resolve(String(flags.root || '.'));

const REVIEWS_DIR = resolve(ROOT, flags['reviews-dir'] || 'docs/53-reviews');

if (!existsSync(REVIEWS_DIR)) {
  if (flags.json) process.stdout.write(JSON.stringify({ evaluated: false, reason: 'no reviews directory' }) + '\n');
  else process.stdout.write(`review-pattern-scan: CANNOT EVALUATE — no reviews directory at ${REVIEWS_DIR}\n`);
  process.exit(2);
}

// Every verdict in the directory, not only `*-cycle-N.md`: the board accepts a verdict file by its
// contents, not its name (R7-3).
const files = readdirSync(REVIEWS_DIR).filter((f) => f.endsWith('.md'));

// file path (the blocking finding's own target) -> Set of ticket IDs that blocked on it
const byFile = new Map();
const total = { reviewed: 0, requestChanges: 0 };
const note = (target, ticket) => {
  const file = target.replace(/^\s*(?:[-*]|\d+\.)?\s*`?/, '').split(/[`\s]/)[0].replace(/:\d.*$/, '').trim();
  if (!file || !/[./]/.test(file)) return; // "none", prose — not a path
  if (!byFile.has(file)) byFile.set(file, new Set());
  byFile.get(file).add(ticket);
};

for (const f of files) {
  const text = readFileSync(resolve(REVIEWS_DIR, f), 'utf8');
  total.reviewed += 1;
  // R7-3: the format the board REQUIRES (agents/code-reviewer.md) is `REVIEW VERDICT: REQUEST
  // CHANGES` with `Ticket:` and `Blocking: <file:line> …` (items may continue on the lines after).
  // The scan read only the older `## REQUEST CHANGES: <ticket>` / `## Blocking` / `### N.` shape,
  // so it reported 0 verdicts on every review the board would actually accept.
  if (/^REVIEW VERDICT:\s*REQUEST CHANGES\s*$/m.test(text)) {
    const ticket = (text.match(/^Ticket:\s*(\S+)/m) || [])[1] || f.replace(/(-cycle-\d+)?\.md$/, '');
    total.requestChanges += 1;
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /^Blocking:/.test(l));
    if (at < 0) continue;
    const items = [lines[at].replace(/^Blocking:\s*/, '')];
    for (const l of lines.slice(at + 1)) {
      if (!l.trim() || /^#/.test(l) || /^[A-Z][A-Za-z ()-]*:\s/.test(l)) break;
      items.push(l);
    }
    for (const item of items) for (const part of item.split(/;\s*/)) note(part.trim(), ticket);
    continue;
  }
  const verdictMatch = text.match(/^##\s*REQUEST CHANGES:\s*(\S+)/m);
  if (!verdictMatch) continue;
  const ticket = verdictMatch[1];
  total.requestChanges += 1;

  const blockingSection = text.split(/^##\s*Blocking\s*$/m)[1]?.split(/^##\s/m)[0] || '';
  const headingRe = /^###\s*\d+\.\s*`([^`]+)`/gm;
  let m;
  while ((m = headingRe.exec(blockingSection))) note(m[1], ticket);
}

const patterns = [...byFile.entries()]
  .filter(([, tickets]) => tickets.size >= 2)
  .map(([file, tickets]) => ({ file, tickets: [...tickets].sort() }))
  .sort((a, b) => b.tickets.length - a.tickets.length);

if (flags.json) {
  process.stdout.write(JSON.stringify({ evaluated: true, ...total, patterns }) + '\n');
  process.exit(0);
}

process.stdout.write(
  `REVIEW PATTERN SCAN — ${total.requestChanges} REQUEST CHANGES verdict(s) across ${total.reviewed} review file(s)\n`
);
if (!patterns.length) {
  process.stdout.write('  No file has blocked more than one ticket. Nothing to correlate.\n');
} else {
  for (const p of patterns) {
    process.stdout.write(`  SHARED FILE: ${p.file} blocked ${p.tickets.length} ticket(s): ${p.tickets.join(', ')}\n`);
  }
  process.stdout.write(
    '  Same file blocking multiple tickets is a lead, not a verdict — worth five minutes before a\n' +
    '  further ticket burns its own retry rediscovering it.\n'
  );
}
process.exit(0);
