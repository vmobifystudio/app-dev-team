#!/usr/bin/env node
/**
 * messages-render — turn the team channel into something a human can read back.
 *
 * The channel is written (team-message.sh → scripts/messages.mjs) and validated (board-doctor) but
 * nothing ever rendered it. A channel nobody can read back is half a channel: the records are
 * chronological across all tickets, so the one question that matters — "what did we ship without an
 * answer to?" — is exactly what the flat table hides.
 *
 * Reads `docs/team/messages.jsonl` (schema studio-event-schema/v1, the source of truth). A project
 * that predates P3a and has only `docs/team/messages.md` is migrated IN MEMORY and renders
 * unchanged — a renderer must never be the thing that rewrites a project's files.
 *
 * Renders, in this order:
 *   OPEN QUESTIONS   first and loudest, flagged when the ticket already reached qa/done — i.e. it
 *                    shipped on an unconfirmed assumption
 *   DELIVERY         answers and decisions that named NO artifact and NO state transition. DR4-006:
 *                    a closed ledger is not delivery. This is the check the old renderer could not
 *                    make, because Markdown had nowhere to record the answer's destination
 *   EXPIRY          waivers past their date and assumptions past their validation date
 *   CHANNELS        derived — #founder-decisions, #product, #design, per-platform, per-ticket. A
 *                    channel is a query over the log, never a place state is authored
 *   THREADS          per ticket, in order
 *   MESSAGE BUDGET   per role and per pair, against the single guard in lib/messages.mjs
 *
 * The guard numbers are IMPORTED, not restated. They used to be declared here, in team-message.sh
 * and in board-doctor — three files, and two of them disagreed about the window.
 *
 * Usage:
 *   node scripts/messages-render.mjs [path/to/messages.md|.jsonl] [--board docs/31-board.md]
 *                                    [--out docs/33-messages-view.md] [--no-color]
 *
 * Exit codes: 0 rendered · 2 channel missing, damaged, or carrying no messages
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseBoard, parseMessages } from './lib/board.mjs';
import {
  MAX_PER_ROLE,
  MAX_PAIR,
  MAX_CHAIN,
  MAX_PER_TICKET,
  ROUND_WINDOW,
  parseMessageLog,
  migrate as migrateMessages,
  threads as messageThreads,
  channelIndex,
  channelsOf,
  openQuestions,
  openFollowUps,
  auditGuards,
  undeliveredAnswers,
  expiredWaivers,
  staleAssumptions,
} from './lib/messages.mjs';

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
 * Read the channel. `.jsonl` is the source of truth; `.md` is accepted for backwards compatibility
 * and migrated in memory. Either path may be given — an agent that still types `messages.md` gets
 * the same view, which is the whole point of never stranding a project.
 */
function readChannel(pathArg) {
  const given = resolve(process.cwd(), pathArg);
  const jsonl = given.endsWith('.jsonl') ? given : given.replace(/\.md$/, '.jsonl');
  const md = given.endsWith('.md') ? given : given.replace(/\.jsonl$/, '.md');

  if (existsSync(jsonl)) {
    const { messages, errors } = parseMessageLog(readFileSync(jsonl, 'utf8'));
    if (errors.length) {
      for (const e of errors) process.stderr.write(`messages-render: ${jsonl}:${e.line}: ${e.reason}\n`);
      process.stderr.write('messages-render: refusing to render a damaged log as a channel.\n');
      process.exit(2);
    }
    return { messages, source: jsonl, migrated: false };
  }
  if (existsSync(md)) {
    return { messages: migrateMessages(readFileSync(md, 'utf8'), { parseMessages }), source: md, migrated: true };
  }
  process.stderr.write(`messages-render: no channel at ${jsonl}. Nothing has been sent yet.\n`);
  process.exit(2);
}

function buildModel(messages, boardText) {
  const rowsById = new Map();
  if (boardText) {
    for (const row of parseBoard(boardText).rows) {
      rowsById.set(row.id.toUpperCase(), (row.status || '').toLowerCase().trim());
    }
  }

  const threads = messageThreads(messages);
  const open = [];
  const followUps = [];
  for (const [ticketId, thread] of threads) {
    if (ticketId === '(no ticket)') continue;
    const status = rowsById.get(ticketId.toUpperCase()) ?? null;
    for (const q of openQuestions(thread)) {
      open.push({ ...q, status, shipped: status !== null && SHIPPED_STATUS.has(status) });
    }
    for (const message of openFollowUps(thread).filter((m) => m.kind !== 'question')) {
      followUps.push({ ...message, status, ticketId });
    }
  }

  const breaches = auditGuards(messages);

  // Per-role budget over the same trailing window the send guard uses to refuse a message.
  const sends = new Map();
  for (const m of messages.slice(-ROUND_WINDOW)) sends.set(m.from, (sends.get(m.from) || 0) + 1);

  return {
    messages,
    threads,
    open,
    followUps,
    channels: channelIndex(messages),
    undelivered: undeliveredAnswers(messages),
    expired: [...expiredWaivers(messages), ...staleAssumptions(messages)],
    pairBreaches: breaches.filter((b) => b.code === 'message_pair_exceeded'),
    deepChains: breaches.filter((b) => b.code === 'message_chain_too_deep'),
    overBudget: breaches.filter((b) => b.code === 'ticket_budget_exceeded'),
    duplicates: breaches.filter((b) => b.code === 'duplicate_question'),
    sends: [...sends].sort((a, b) => b[1] - a[1]),
    hasBoard: rowsById.size > 0,
  };
}

// ---------------------------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------------------------

function renderOpen(model) {
  if (model.open.length === 0 && model.followUps.length === 0) {
    return [dim('  no open questions — every question on the log has an answer or a decision')];
  }
  const questions = model.open.map((q) => {
    const flag = q.shipped ? red(`SHIPPED ON IT (${q.status})`) : yellow('open');
    return `  ${red('?')} ${q.ticket.padEnd(12)} ${flag}  ${q.from} → ${q.to.join(', ')}\n      ${bold(
      truncate(q.summary, 90)
    )}  ${dim(`asked ${q.ts ?? 'inferred'} · ${q.id}`)}`;
  });
  const followUps = model.followUps.map((m) =>
    `  ${red('!')} ${m.ticketId.padEnd(12)} ${yellow(m.kind)}  ${m.from} → ${m.to.join(', ')}\n      ${bold(truncate(m.summary, 90))}  ${dim(`follow-up due · ${m.id}`)}`
  );
  return [...questions, ...followUps];
}

/**
 * DR4-006 made visible. An answered question whose answer named nothing changed no artifact, so the
 * next agent to read the spec still reads the old answer. "Every question answered" was the metric
 * that hid this.
 */
function renderDelivery(model) {
  if (model.undelivered.length === 0) {
    return [dim('  every answer and decision named an artifact or a transition')];
  }
  return model.undelivered.map(
    (m) =>
      `  ${red('!')} ${m.ticket.padEnd(12)} ${m.kind.padEnd(9)} ${m.from} → ${m.to.join(', ')}\n` +
      `      ${bold(truncate(m.summary, 90))}\n` +
      `      ${red('named no artifact')} ${dim('— a closed ledger is not delivery (DR4-006)')}`
  );
}

function renderExpiry(model) {
  if (model.expired.length === 0) return [dim('  no waiver or assumption is past its date')];
  return model.expired.map(
    (m) =>
      `  ${red('×')} ${m.artifact.padEnd(16)} ${m.expires ? `expired ${m.expires}` : `due ${m.validate_by}`}` +
      `  ${truncate(m.summary, 70)}${m.owner ? dim(` · owner ${m.owner}`) : ''}`
  );
}

function renderChannels(model) {
  if (model.channels.length === 0) return [dim('  (no channels — the log carries no messages)')];
  const width = Math.max(...model.channels.map(([name]) => name.length)) + 1;
  return model.channels.map(
    ([name, count]) => `  ${blue(`#${name}`.padEnd(width + 1))} ${dim(`${count} message${count === 1 ? '' : 's'}`)}`
  );
}

function renderThreads(model) {
  const lines = [];
  for (const [ticketId, thread] of model.threads) {
    const stillOpen = ticketId === '(no ticket)' ? [] : openQuestions(thread);
    const tail = stillOpen.length ? red(` — ${stillOpen.length} unanswered`) : '';
    const budget =
      ticketId === '(no ticket)'
        ? ''
        : dim(` [${thread.filter((m) => m.kind !== 'escalation').length}/${MAX_PER_TICKET} budget]`);
    lines.push(
      `  ${bold(ticketId)}${dim(` (${thread.length} message${thread.length === 1 ? '' : 's'})`)}${budget}${tail}`
    );
    for (const m of thread) {
      const paint = KIND_PAINT[m.kind] ?? dim;
      const dest = m.artifact ? green(` → ${m.artifact}`) : m.transition ? green(` → ${m.transition}`) : '';
      lines.push(
        `    ${dim(m.ts ?? 'inferred')}  ${paint(m.kind.padEnd(10))} ${dim(
          `${m.from} → ${m.to.join(', ')}`.padEnd(38)
        )} ${truncate(m.summary, 60)}${dest}`
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
    lines.push(
      `  ${role.padEnd(width)}  ${bar} ${dim(`${count}/${MAX_PER_ROLE}`)}${
        over ? red('  AT LIMIT — the next send is refused') : ''
      }`
    );
  }
  for (const b of model.pairBreaches) {
    lines.push(`  ${red('PAIR')}  ${b.ticket}  ${b.pair} exchanged ${b.count} (limit ${MAX_PAIR} without a third party)`);
  }
  for (const d of model.deepChains) {
    lines.push(`  ${red('CHAIN')} ${d.ticket}  ${d.count} roles involved (limit ${MAX_CHAIN}) — relayed that far, it is an escalation`);
  }
  for (const b of model.overBudget) {
    lines.push(`  ${red('BUDGET')} ${b.ticket}  ${b.count} messages (limit ${MAX_PER_TICKET}) — it needs a decision, not another round`);
  }
  for (const d of model.duplicates) {
    lines.push(`  ${red('DUP')}   ${d.ticket}  ${d.id} re-asks ${d.of}: "${truncate(d.summary, 50)}"`);
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
  const pathArg = args.find((a, i) => !a.startsWith('--') && !consumed.has(i)) || 'docs/team/messages.jsonl';

  const channel = readChannel(pathArg);
  if (channel.messages.length === 0) {
    process.stderr.write(`messages-render: no messages in ${channel.source}.\n`);
    process.exit(2);
  }

  const boardPath = resolve(process.cwd(), boardArg);
  const boardText = existsSync(boardPath) ? readFileSync(boardPath, 'utf8') : null;
  const model = buildModel(channel.messages, boardText);

  const ticketCount = [...model.threads.keys()].filter((k) => k !== '(no ticket)').length;
  const summary = `${model.messages.length} messages · ${ticketCount} tickets · ${model.sends.length} roles · ${model.channels.length} channels`;

  const out = [];
  out.push(bold('TEAM CHANNEL'), dim(`  ${summary}`));
  if (channel.migrated) {
    out.push(
      dim(`  (read from ${channel.source} — this project predates the event log; every field it could`),
      dim('   not carry is reconstructed. Send one message to migrate it for real.)')
    );
  }
  out.push('');
  out.push(
    model.open.length ? red(bold(`OPEN QUESTIONS (${model.open.length})`)) : bold('OPEN QUESTIONS'),
    ...renderOpen(model),
    ''
  );
  if (!model.hasBoard) {
    out.push(dim(`  (no board at ${boardArg} — cannot tell which of these already shipped)`), '');
  }
  out.push(
    model.undelivered.length ? red(bold(`DELIVERY (${model.undelivered.length} answered nowhere)`)) : bold('DELIVERY'),
    ...renderDelivery(model),
    ''
  );
  out.push(model.expired.length ? red(bold(`EXPIRY (${model.expired.length})`)) : bold('EXPIRY'), ...renderExpiry(model), '');
  out.push(bold('CHANNELS'), ...renderChannels(model), '');
  out.push(bold('THREADS'), ...renderThreads(model), '');
  out.push(bold('MESSAGE BUDGET'), ...renderBudget(model));
  process.stdout.write(`${out.join('\n')}\n`);

  if (outPath) {
    useColor = false;
    const md = [
      '# Team channel — generated view',
      '',
      `> Generated by \`scripts/messages-render.mjs\`. **Do not edit** — the log is \`${channel.source}\`.`,
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
                `| ${q.ticket} | ${q.ts ?? 'inferred'} | ${q.from} → ${q.to.join(', ')} | ${q.summary} | ${
                  q.shipped ? `**SHIPPED ON IT (${q.status})**` : 'open'
                } |`
            ),
          ]
        : ['Every question on the log has an answer or a decision.']),
      '',
      `## Delivery (${model.undelivered.length} answered nowhere)`,
      '',
      ...(model.undelivered.length
        ? [
            'A closed ledger is not delivery (DR4-006): these named no artifact and no state transition.',
            '',
            '| Ticket | Kind | From → To | Summary |',
            '|---|---|---|---|',
            ...model.undelivered.map((m) => `| ${m.ticket} | ${m.kind} | ${m.from} → ${m.to.join(', ')} | ${m.summary} |`),
          ]
        : ['Every answer and decision named an artifact or a transition.']),
      '',
      '## Channels',
      '',
      '| Channel | Messages |',
      '|---|---|',
      ...model.channels.map(([name, count]) => `| #${name} | ${count} |`),
      '',
      '## Threads',
      '',
      ...[...model.threads].flatMap(([ticketId, thread]) => [
        `### ${ticketId}`,
        '',
        '| Timestamp | Kind | From → To | Summary | Folded into |',
        '|---|---|---|---|---|',
        ...thread.map(
          (m) =>
            `| ${m.ts ?? 'inferred'} | ${m.kind} | ${m.from} → ${m.to.join(', ')} | ${m.summary} | ${
              m.artifact || m.transition || '—'
            } |`
        ),
        '',
      ]),
      '## Message budget',
      '',
      `| Role | Sent (last ${ROUND_WINDOW}) | Limit |`,
      '|---|---|---|',
      ...model.sends.map(([role, count]) => `| ${role} | ${count} | ${MAX_PER_ROLE} |`),
      '',
      ...(model.pairBreaches.length || model.deepChains.length || model.overBudget.length || model.duplicates.length
        ? [
            '### Guard breaches',
            '',
            ...model.pairBreaches.map((b) => `- **pair** ${b.ticket}: ${b.pair} exchanged ${b.count} (limit ${MAX_PAIR})`),
            ...model.deepChains.map((d) => `- **chain** ${d.ticket}: ${d.count} roles (limit ${MAX_CHAIN})`),
            ...model.overBudget.map((b) => `- **budget** ${b.ticket}: ${b.count} messages (limit ${MAX_PER_TICKET})`),
            ...model.duplicates.map((d) => `- **duplicate** ${d.ticket}: ${d.id} re-asks ${d.of}`),
            '',
          ]
        : []),
    ].join('\n');
    writeFileSync(resolve(process.cwd(), outPath), md);
    process.stderr.write(`messages-render: wrote ${outPath}\n`);
  }
}

main();
