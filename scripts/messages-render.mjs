#!/usr/bin/env node
/**
 * messages-render — turn docs/team/messages.md into something a human can read back.
 *
 * The ledger is written (team-message.sh) and validated (board-doctor) but nothing ever rendered it.
 * A channel nobody can read back is half a channel: the rows are chronological across all tickets,
 * so the one question that matters — "what did we ship without an answer to?" — is exactly what the
 * flat table hides.
 *
 * Renders: OPEN QUESTIONS first and loudest (flagged when the ticket already reached qa/done, i.e.
 * it shipped on an unconfirmed assumption), then per-ticket threads in order, then the
 * anti-ping-pong budget per role and per pair.
 *
 * Parsing is lib/board.mjs's parseMessages. There is deliberately no second parser here — a
 * renderer that disagrees with its validator is the defect class this repo names most often.
 *
 * Usage:
 *   node scripts/messages-render.mjs [path/to/messages.md] [--board docs/31-board.md]
 *                                    [--out docs/33-messages-view.md] [--no-color]
 *
 * Exit codes: 0 rendered · 2 ledger missing or carries no parseable rows
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseMessages, parseBoard, isEmpty } from './lib/board.mjs';

/**
 * Guard windows. These MUST match scripts/team-message.sh and board-doctor.mjs's diagnoseMessages;
 * all three now state the same numbers in three files, which is one file too many — they belong in
 * lib/board.mjs. Until they move, changing one means changing all three.
 *
 *   per-role  10 sends in the trailing 40 rows ("this round" — the ledger has no round marker)
 *   pair      2 messages A->B on one ticket without a third party (whole thread)
 *   chain     4 distinct roles involved on one ticket (whole thread)
 */
const MAX_PER_ROLE = 10;
const MAX_PAIR = 2;
const MAX_CHAIN = 4;
const ROUND_WINDOW = 40;

const RESOLVING_KINDS = new Set(['answer', 'decision']);
const SHIPPED_STATUS = new Set(['qa', 'done']);

let useColor = process.stdout.isTTY && !process.argv.includes('--no-color');
const c = (code, text) => (useColor ? `[${code}m${text}[0m` : text);
const dim = (t) => c('2', t);
const bold = (t) => c('1', t);
const red = (t) => c('31', t);
const green = (t) => c('32', t);
const yellow = (t) => c('33', t);
const blue = (t) => c('34', t);

const KIND_PAINT = {
  question: yellow,
  answer: green,
  decision: green,
  blocker: red,
  escalation: red,
  handoff: blue,
  fyi: dim,
};

// ---------------------------------------------------------------------------------------------

function truncate(value, max) {
  const s = String(value ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Which questions are still open.
 *
 * board-doctor pairs questions and resolutions BY COUNT on a ticket, so this must resolve to the
 * same number or the renderer and the validator disagree about the same ledger. Counting alone
 * cannot name a row, and tech-lead needs the specific question to answer — so pair them oldest
 * first: each `answer`/`decision` closes the earliest still-open question on that ticket. The
 * leftovers are open, and their count is exactly doctor's `questions.length - resolutions.length`.
 */
function openQuestions(thread) {
  const open = [];
  for (const m of thread) {
    if (m.kind === 'question') open.push(m);
    else if (RESOLVING_KINDS.has(m.kind)) open.shift();
  }
  return open;
}

function buildModel(text, boardText) {
  const messages = parseMessages(text);

  const rowsById = new Map();
  if (boardText) {
    for (const row of parseBoard(boardText).rows) {
      rowsById.set(row.id.toUpperCase(), (row.status || '').toLowerCase().trim());
    }
  }

  const threads = new Map();
  for (const m of messages) {
    // Ticketless rows are broadcast chatter, not a thread — same exemption team-message.sh and
    // board-doctor make, so all three agree on what a thread is.
    const key = isEmpty(m.ticketId) ? '(no ticket)' : m.ticketId;
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(m);
  }

  const open = [];
  const pairBreaches = [];
  const deepChains = [];

  for (const [ticketId, thread] of threads) {
    if (ticketId === '(no ticket)') continue;
    const status = rowsById.get(ticketId.toUpperCase()) ?? null;
    for (const q of openQuestions(thread)) {
      open.push({ ...q, status, shipped: status !== null && SHIPPED_STATUS.has(status) });
    }

    const pairs = new Map();
    for (const m of thread) {
      if (m.kind === 'escalation') continue;
      const key = `${m.from} → ${m.to}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
    for (const [pair, count] of pairs) {
      if (count > MAX_PAIR) pairBreaches.push({ ticketId, pair, count });
    }

    const roles = new Set(thread.flatMap((m) => [m.from, m.to]));
    if (roles.size > MAX_CHAIN) deepChains.push({ ticketId, roles: roles.size });
  }

  // Per-role budget over the same trailing window team-message.sh uses to refuse a send.
  const sends = new Map();
  for (const m of messages.slice(-ROUND_WINDOW)) sends.set(m.from, (sends.get(m.from) || 0) + 1);

  return {
    messages,
    threads,
    open,
    pairBreaches,
    deepChains,
    sends: [...sends].sort((a, b) => b[1] - a[1]),
    hasBoard: rowsById.size > 0,
  };
}

// ---------------------------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------------------------

function renderOpen(model) {
  if (model.open.length === 0) return [dim('  no open questions — every question on the ledger has an answer or a decision')];
  return model.open.map((q) => {
    const flag = q.shipped ? red(`SHIPPED ON IT (${q.status})`) : yellow('open');
    return `  ${red('?')} ${q.ticketId.padEnd(12)} ${flag}  ${q.from} → ${q.to}\n      ${bold(truncate(q.summary, 90))}  ${dim(`asked ${q.timestamp} · line ${q._line}`)}`;
  });
}

function renderThreads(model) {
  const lines = [];
  for (const [ticketId, thread] of model.threads) {
    const stillOpen = ticketId === '(no ticket)' ? [] : openQuestions(thread);
    const tail = stillOpen.length ? red(` — ${stillOpen.length} unanswered`) : '';
    lines.push(`  ${bold(ticketId)}${dim(` (${thread.length} message${thread.length === 1 ? '' : 's'})`)}${tail}`);
    for (const m of thread) {
      const paint = KIND_PAINT[m.kind] ?? dim;
      lines.push(
        `    ${dim(m.timestamp)}  ${paint(m.kind.padEnd(10))} ${dim(`${m.from} → ${m.to}`.padEnd(38))} ${truncate(m.summary, 60)}`
      );
    }
    lines.push('');
  }
  return lines.length ? lines.slice(0, -1) : [dim('  (no messages)')];
}

function renderBudget(model) {
  const lines = [];
  if (model.sends.length === 0) return [dim('  (nothing sent)')];
  const width = Math.max(...model.sends.map(([role]) => role.length));
  for (const [role, count] of model.sends) {
    const over = count >= MAX_PER_ROLE;
    const bar = (over ? red : count > MAX_PER_ROLE / 2 ? yellow : green)('█'.repeat(count));
    lines.push(`  ${role.padEnd(width)}  ${bar} ${dim(`${count}/${MAX_PER_ROLE}`)}${over ? red('  AT LIMIT — team-message.sh will refuse the next send') : ''}`);
  }
  for (const b of model.pairBreaches) {
    lines.push(`  ${red('PAIR')}  ${b.ticketId}  ${b.pair} exchanged ${b.count} (limit ${MAX_PAIR} without a third party)`);
  }
  for (const d of model.deepChains) {
    lines.push(`  ${red('CHAIN')} ${d.ticketId}  ${d.roles} roles involved (limit ${MAX_CHAIN}) — relayed that far, it is an escalation`);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const flagValue = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : null;
  };
  const outPath = flagValue('--out');
  const boardArg = flagValue('--board') || 'docs/31-board.md';
  const consumed = new Set(['--out', '--board'].map((f) => args.indexOf(f) + 1).filter((i) => i > 0));
  const pathArg = args.find((a, i) => !a.startsWith('--') && !consumed.has(i)) || 'docs/team/messages.md';

  const messagesPath = resolve(process.cwd(), pathArg);
  if (!existsSync(messagesPath)) {
    process.stderr.write(`messages-render: no ledger at ${messagesPath}. Nothing has been sent yet.\n`);
    process.exit(2);
  }

  const boardPath = resolve(process.cwd(), boardArg);
  const boardText = existsSync(boardPath) ? readFileSync(boardPath, 'utf8') : null;

  const model = buildModel(readFileSync(messagesPath, 'utf8'), boardText);
  if (model.messages.length === 0) {
    process.stderr.write(`messages-render: no parseable message rows in ${messagesPath}.\n`);
    process.exit(2);
  }

  const ticketCount = [...model.threads.keys()].filter((k) => k !== '(no ticket)').length;
  const summary = `${model.messages.length} messages · ${ticketCount} tickets · ${model.sends.length} roles`;

  const out = [];
  out.push(bold('TEAM CHANNEL'), dim(`  ${summary}`), '');
  out.push(
    model.open.length ? red(bold(`OPEN QUESTIONS (${model.open.length})`)) : bold('OPEN QUESTIONS'),
    ...renderOpen(model),
    ''
  );
  if (!model.hasBoard) {
    out.push(dim(`  (no board at ${boardArg} — cannot tell which of these already shipped)`), '');
  }
  out.push(bold('THREADS'), ...renderThreads(model), '');
  out.push(bold('MESSAGE BUDGET'), ...renderBudget(model));
  process.stdout.write(`${out.join('\n')}\n`);

  if (outPath) {
    useColor = false;
    const md = [
      '# Team channel — generated view',
      '',
      '> Generated by `scripts/messages-render.mjs`. **Do not edit** — the ledger is `docs/team/messages.md`.',
      '',
      `**${summary}**`,
      '',
      `## Open questions (${model.open.length})`,
      '',
      ...(model.open.length
        ? [
            '| Ticket | Asked | From → To | Question | State |',
            '|---|---|---|---|---|',
            ...model.open.map(
              (q) =>
                `| ${q.ticketId} | ${q.timestamp} | ${q.from} → ${q.to} | ${q.summary} | ${
                  q.shipped ? `**SHIPPED ON IT (${q.status})**` : 'open'
                } |`
            ),
          ]
        : ['Every question on the ledger has an answer or a decision.']),
      '',
      '## Threads',
      '',
      ...[...model.threads].flatMap(([ticketId, thread]) => [
        `### ${ticketId}`,
        '',
        '| Timestamp | Kind | From → To | Summary |',
        '|---|---|---|---|',
        ...thread.map((m) => `| ${m.timestamp} | ${m.kind} | ${m.from} → ${m.to} | ${m.summary} |`),
        '',
      ]),
      '## Message budget',
      '',
      `| Role | Sent (last ${ROUND_WINDOW} rows) | Limit |`,
      '|---|---|---|',
      ...model.sends.map(([role, count]) => `| ${role} | ${count} | ${MAX_PER_ROLE} |`),
      '',
      ...(model.pairBreaches.length || model.deepChains.length
        ? [
            '### Guard breaches',
            '',
            ...model.pairBreaches.map((b) => `- **pair** ${b.ticketId}: ${b.pair} exchanged ${b.count} (limit ${MAX_PAIR})`),
            ...model.deepChains.map((d) => `- **chain** ${d.ticketId}: ${d.roles} roles (limit ${MAX_CHAIN})`),
            '',
          ]
        : []),
    ].join('\n');
    writeFileSync(resolve(process.cwd(), outPath), md);
    process.stderr.write(`messages-render: wrote ${outPath}\n`);
  }
}

main();
