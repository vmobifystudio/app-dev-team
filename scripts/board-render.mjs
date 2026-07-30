#!/usr/bin/env node
/**
 * board-render — turn docs/31-board.md into something a human can see at a glance.
 *
 * The board is a wide Markdown table. Past ~10 tickets nobody can read it, and the two things that
 * actually matter — who is overloaded, and what is stuck behind what — are exactly the things a
 * table hides.
 *
 * Renders: a terminal kanban, owner swimlanes with load, a Mermaid dependency graph (stranded and
 * blocked tickets flagged), and recent REVIEW-LEDGER activity.
 *
 * It does not render message activity. The comment claimed it did, and this file has never opened
 * docs/team/messages.md — a description that promises a view nobody built is how a reader concludes
 * the messages were checked. (A message renderer is a separate piece of work.)
 *
 * Usage:
 *   node scripts/board-render.mjs [path/to/31-board.md] [--out docs/32-board-view.md] [--no-color]
 *
 * Exit codes: 0 rendered · 2 board missing or unparseable
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

import { readBoard, parseDependencies, isEmpty, findBlockingAncestor } from './lib/board.mjs';

const COLUMNS = ['todo', 'in_progress', 'review', 'qa', 'done', 'blocked'];
const COLUMN_LABEL = {
  todo: 'TODO',
  in_progress: 'IN PROGRESS',
  review: 'REVIEW',
  qa: 'QA',
  done: 'DONE',
  blocked: 'BLOCKED',
};

let useColor = process.stdout.isTTY && !process.argv.includes('--no-color');
const c = (code, text) => (useColor ? `[${code}m${text}[0m` : text);
const dim = (t) => c('2', t);
const bold = (t) => c('1', t);
const red = (t) => c('31', t);
const green = (t) => c('32', t);
const yellow = (t) => c('33', t);
const blue = (t) => c('34', t);

const STATUS_PAINT = {
  todo: dim,
  in_progress: blue,
  review: yellow,
  qa: yellow,
  done: green,
  blocked: red,
};

// ---------------------------------------------------------------------------------------------

function buildModel(text) {
  const { board, ledger, capabilities } = readBoard(text);
  const rowsById = new Map();
  for (const row of board.rows) {
    // `id` is the GRAPH key and must stay upper-cased: parseDependencies() upper-cases every
    // dependency it parses, so a lower-cased key would silently stop matching its own edges.
    //
    // `label` is what a human reads, and it keeps the spelling the board actually carries. DR4-008
    // was fixed in board.mjs — `BUG-001-fix` is the ID that tech-manager.md and /app-build mandate —
    // and this file re-introduced it one layer later, printing `BUG-001-FIX` into the terminal view
    // and into docs/32-board-view.md. A grep for the documented spelling found nothing on a board
    // that had the ticket, which is the whole defect, just moved to the surface people look at.
    const id = row.id.toUpperCase();
    rowsById.set(id, { ...row, id, label: String(row.id).trim(), status: (row.status || '').toLowerCase().trim() });
  }

  // Derived, never stored: a todo behind a blocked dependency is invisible to the sprint loop.
  for (const row of rowsById.values()) {
    row.stranded = row.status === 'todo' ? findBlockingAncestor(row.id, rowsById) : null;
    row.deps = parseDependencies(row.dependsOn);
  }

  return { rows: [...rowsById.values()], rowsById, ledger, capabilities };
}

function truncate(value, max) {
  const s = String(value ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------------------------
// terminal views
// ---------------------------------------------------------------------------------------------

function renderKanban(model) {
  const byColumn = new Map(COLUMNS.map((col) => [col, []]));
  for (const row of model.rows) {
    if (byColumn.has(row.status)) byColumn.get(row.status).push(row);
  }

  const active = COLUMNS.filter((col) => byColumn.get(col).length > 0);
  if (active.length === 0) return ['(no tickets)'];

  const width = 22;
  const lines = [];
  const header = active
    .map((col) => {
      const label = `${COLUMN_LABEL[col]} (${byColumn.get(col).length})`;
      return STATUS_PAINT[col](bold(label.padEnd(width)));
    })
    .join(' │ ');
  lines.push(header);
  lines.push(active.map(() => '─'.repeat(width)).join('─┼─'));

  const depth = Math.max(...active.map((col) => byColumn.get(col).length));
  for (let i = 0; i < depth; i += 1) {
    const cells = active.map((col) => {
      const row = byColumn.get(col)[i];
      if (!row) return ' '.repeat(width);
      const flag = row.stranded ? red('!') : ' ';
      return `${flag}${truncate(`${row.label} ${row.title}`, width - 1).padEnd(width - 1)}`;
    });
    lines.push(cells.join(' │ '));
  }
  return lines;
}

function renderSwimlanes(model) {
  const byOwner = new Map();
  for (const row of model.rows) {
    if (row.status === 'done') continue;
    const owner = isEmpty(row.owner) ? '(unassigned)' : row.owner;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(row);
  }
  if (byOwner.size === 0) return ['(nothing open)'];

  const width = Math.max(...[...byOwner.keys()].map((o) => o.length));
  const lines = [];
  for (const [owner, rows] of [...byOwner].sort((a, b) => b[1].length - a[1].length)) {
    const open = rows.filter((r) => r.status === 'in_progress').length;
    const bar = rows
      .map((r) => STATUS_PAINT[r.status] ?? dim)
      .map((paint, i) => paint(rows[i].stranded ? '!' : '█'))
      .join('');
    const load = open > 1 ? red(` WIP=${open}`) : '';
    lines.push(`  ${owner.padEnd(width)}  ${bar}  ${dim(`${rows.length} open`)}${load}`);
  }
  return lines;
}

function renderAttention(model) {
  const lines = [];
  for (const row of model.rows) {
    if (row.stranded) {
      lines.push(
        `  ${red('STRANDED')}  ${row.label}  waiting on ${row.stranded.via} (${row.stranded.reason}) — the sprint loop cannot see this`
      );
    }
  }
  for (const row of model.rows) {
    if (row.status === 'blocked') lines.push(`  ${red('BLOCKED ')}  ${row.label}  ${truncate(row.notes || row.title, 60)}`);
  }
  // Agree with the validator. board-doctor deliberately degrades this finding on a board that has
  // no Reviewer column at all — the column's absence is one migration to fix, not a per-ticket
  // accusation — while the renderer printed NO REVIEWER against every row in review, so a legacy
  // board looked like a team that had stopped assigning reviewers. Two readings of one board.
  if (model.capabilities.hasReviewColumns) {
    for (const row of model.rows) {
      if (row.status === 'review' && isEmpty(row.reviewer)) {
        lines.push(`  ${yellow('NO REVIEWER')} ${row.label}  in review with nobody assigned`);
      }
    }
  } else if (model.rows.some((row) => row.status === 'review')) {
    lines.push(
      `  ${yellow('LEGACY BOARD')} no Reviewer column, so self-review cannot be detected — migrate the board (see sprint-planner)`
    );
  }
  return lines.length ? lines : [dim('  nothing needs attention')];
}

function renderActivity(model) {
  if (model.ledger.length === 0) return [dim('  (no review activity recorded)')];
  return model.ledger.slice(-8).map((e) => {
    const paint = e.action === 'approved' ? green : e.action === 'changes' ? red : dim;
    const actor = e.to ? `${e.from} → ${e.to}` : e.from;
    return `  ${dim(e.timestamp)}  ${e.ticketId.padEnd(9)} ${paint(e.action.padEnd(10))} ${actor}`;
  });
}

// ---------------------------------------------------------------------------------------------
// mermaid
// ---------------------------------------------------------------------------------------------

function renderMermaid(model) {
  const lines = ['flowchart LR'];
  const nodeId = (id) => id.replace(/[^A-Za-z0-9]/g, '_');

  for (const row of model.rows) {
    const label = `${row.label}<br/>${truncate(row.title, 28).replace(/"/g, "'")}`;
    lines.push(`    ${nodeId(row.id)}["${label}"]`);
  }
  for (const row of model.rows) {
    for (const dep of row.deps) {
      if (model.rowsById.has(dep)) lines.push(`    ${nodeId(dep)} --> ${nodeId(row.id)}`);
    }
  }

  // Class per state. Stranded wins over todo — it is the state the loop cannot see.
  const classes = { done: [], blocked: [], stranded: [], review: [], progress: [], todo: [] };
  for (const row of model.rows) {
    if (row.stranded) classes.stranded.push(nodeId(row.id));
    else if (row.status === 'done') classes.done.push(nodeId(row.id));
    else if (row.status === 'blocked') classes.blocked.push(nodeId(row.id));
    else if (row.status === 'review' || row.status === 'qa') classes.review.push(nodeId(row.id));
    else if (row.status === 'in_progress') classes.progress.push(nodeId(row.id));
    else classes.todo.push(nodeId(row.id));
  }

  lines.push(
    '    classDef done fill:#bbf7d0,stroke:#15803d,color:#000',
    '    classDef blocked fill:#fecaca,stroke:#b91c1c,color:#000',
    '    classDef stranded fill:#fca5a5,stroke:#7f1d1d,stroke-width:3px,color:#000',
    '    classDef review fill:#fde68a,stroke:#b45309,color:#000',
    '    classDef progress fill:#bfdbfe,stroke:#1d4ed8,color:#000',
    '    classDef todo fill:#e5e7eb,stroke:#6b7280,color:#000'
  );
  for (const [name, ids] of Object.entries(classes)) {
    if (ids.length) lines.push(`    class ${ids.join(',')} ${name}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------

function counts(model) {
  const tally = Object.fromEntries(COLUMNS.map((col) => [col, 0]));
  for (const row of model.rows) if (tally[row.status] !== undefined) tally[row.status] += 1;
  const stranded = model.rows.filter((r) => r.stranded).length;
  return { tally, stranded };
}

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outPath = outIndex !== -1 ? args[outIndex + 1] : null;
  const pathArg = args.find((a, i) => !a.startsWith('--') && (outIndex === -1 || i !== outIndex + 1)) || 'docs/31-board.md';
  const boardPath = resolve(process.cwd(), pathArg);

  if (!existsSync(boardPath)) {
    process.stderr.write(`board-render: no board at ${boardPath}. Run /app-plan first.\n`);
    process.exit(2);
  }

  const text = readFileSync(boardPath, 'utf8');
  const model = buildModel(text);
  if (model.rows.length === 0) {
    process.stderr.write(`board-render: no parseable ticket table in ${boardPath}.\n`);
    process.exit(2);
  }

  const { tally, stranded } = counts(model);
  const summary = COLUMNS.filter((col) => tally[col] > 0)
    .map((col) => `${COLUMN_LABEL[col].toLowerCase()}=${tally[col]}`)
    .join(' · ');

  const out = [];
  out.push(bold(`SPRINT BOARD — ${model.rows.length} tickets`), dim(`  ${summary}${stranded ? red(` · stranded=${stranded}`) : ''}`), '');
  out.push(bold('KANBAN'), ...renderKanban(model), '');
  out.push(bold('BY OWNER'), ...renderSwimlanes(model), '');
  out.push(bold('NEEDS ATTENTION'), ...renderAttention(model), '');
  out.push(bold('RECENT REVIEW ACTIVITY'), ...renderActivity(model));
  process.stdout.write(`${out.join('\n')}\n`);

  if (outPath) {
    const target = resolve(process.cwd(), outPath);
    useColor = false;
    const md = [
      '# Sprint board — generated view',
      '',
      '> Generated by `scripts/board-render.mjs`. **Do not edit** — edit `docs/31-board.md`.',
      '',
      `**${model.rows.length} tickets** — ${summary}${stranded ? ` · **stranded=${stranded}**` : ''}`,
      '',
      '## Dependency graph',
      '',
      '```mermaid',
      ...renderMermaid(model),
      '```',
      '',
      '## Needs attention',
      '',
      ...renderAttention(model).map((l) => `- ${l.trim()}`),
      '',
      '## By owner',
      '',
      '| Owner | Open | In progress | Stranded |',
      '|---|---|---|---|',
      ...(() => {
        const byOwner = new Map();
        for (const row of model.rows) {
          if (row.status === 'done') continue;
          const owner = isEmpty(row.owner) ? '(unassigned)' : row.owner;
          if (!byOwner.has(owner)) byOwner.set(owner, []);
          byOwner.get(owner).push(row);
        }
        return [...byOwner]
          .sort((a, b) => b[1].length - a[1].length)
          .map(
            ([owner, rows]) =>
              `| ${owner} | ${rows.length} | ${rows.filter((r) => r.status === 'in_progress').length} | ${rows.filter((r) => r.stranded).length} |`
          );
      })(),
      '',
    ].join('\n');
    writeFileSync(target, md);
    process.stderr.write(`board-render: wrote ${outPath}\n`);
  }
}

main();
