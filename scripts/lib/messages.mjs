/**
 * The team channel's event model — the write side of `docs/team/messages.jsonl`.
 *
 * `docs/team/messages.md` used to BE the channel: an agent appended a Markdown row and every rule
 * about what was legal was checked afterwards, by a guard in `team-message.sh`, a second guard in
 * `board-doctor`, and a third set of numbers in `messages-render`. Three implementations of one
 * rule, and two of them once disagreed about what a breach was. Here the append is validated in ONE
 * place before it lands, and the Markdown becomes a rendering — exactly the move `lib/events.mjs`
 * made for the board, for the same reason.
 *
 * Log format: one JSON object per line, append-only.
 *
 *   {"id":"MSG-0421","v":1,"ts":"2026-07-29T09:00Z","project":"tipjar","channel":"ios",
 *    "thread":"THR-APP-042","ticket":"APP-042","kind":"question","from":"ios-developer",
 *    "to":["tech-lead"],"priority":"material","blocking":false,"requires_response":true,
 *    "expires_after_round":6,"requirements":["REQ-031"],"summary":"...","body":"...",
 *    "status":"open","provenance":"cli"}
 *
 * `v` is the schema version and is checked on every line: a reader that silently accepts a record it
 * does not understand is how a projection drifts from its log. The shape is deliberately flat and
 * typed so a `node:sqlite` projection (Node 22.5+) drops in later as an INDEX BUILT FROM THE LOG —
 * never as the primary. See docs/RESUME.md §3.
 *
 * `provenance` is "cli" for anything this tool appended and "inferred" for anything `migrate`
 * reconstructed from the hand-written Markdown ledger, with `inferred_fields` naming exactly which
 * values were invented. The board's migration does the same, and the honesty matters more than the
 * completeness: a migration that quietly asserted an obligation nobody recorded would make the whole
 * obligation rule a lie on day one.
 *
 * THREADS AND CHANNELS ARE DERIVED. A thread is the messages sharing a ticket; a channel is a query
 * over the log (`channelsOf`). Neither is a place state is authored — same rule as the board's
 * Markdown. The `thread`/`channel` fields are stable identifiers carried for the reader's benefit,
 * and every one of them is reproducible from the rest of the record.
 */

// --------------------------------------------------------------------------------------------
// schema
// --------------------------------------------------------------------------------------------

const SCHEMA = 'studio-event-schema/v1';
const SCHEMA_VERSION = 1;

const KINDS = ['question', 'answer', 'handoff', 'blocker', 'fyi', 'escalation', 'decision'];
const KIND_SET = new Set(KINDS);

/**
 * `material` is the default. `fyi` is the escape hatch from the obligation rule and must be chosen,
 * never fallen into: it is selected by `--kind fyi` or `--priority fyi` and by nothing else.
 */
const PRIORITIES = new Set(['material', 'fyi']);

/** Kinds that inherently ask something of the recipient, so their obligation is the timed follow-up. */
const ASKING_KINDS = new Set(['question', 'blocker', 'escalation', 'handoff']);

/** Kinds that close something, so their obligation must NAME what it produced. */
const CLOSING_KINDS = new Set(['answer', 'decision']);

const TICKETLESS = '-';

/**
 * Formal artifacts. Each has an ID series, a directory, a declared writer and declared readers —
 * the same DOC_WRITERS discipline `team-doctor` enforces on every other document, because an
 * artifact with no declared producer is DR4-019 and one with no reader is RV-035.
 *
 * `requires` names the fields without which the artifact is decoration: a waiver with no expiry
 * never expires, and an assumption with no owner is nobody's to validate.
 */
const ARTIFACT_TYPES = {
  ADR: {
    dir: 'docs/24-adr/',
    label: 'architecture decision record',
    writers: ['cto', 'tech-lead'],
    readers: ['tech-lead', 'ios-developer', 'android-developer', 'backend-developer'],
    requires: [],
  },
  PDR: {
    dir: 'docs/16-pdr/',
    label: 'product decision record',
    writers: ['cpo', 'ceo'],
    readers: ['tech-manager', 'tech-lead', 'qa-engineer'],
    requires: [],
  },
  DDR: {
    dir: 'docs/17-ddr/',
    label: 'design decision record',
    writers: ['ux-architect', 'product-designer'],
    readers: ['ios-developer', 'android-developer', 'tech-lead'],
    requires: [],
  },
  WAIVER: {
    dir: 'docs/72-waivers/',
    label: 'waiver',
    writers: ['security-reviewer', 'cto'],
    readers: ['release-manager', 'tech-manager'],
    // An expired waiver is a FINDING, not a formality: a waiver with no expiry is a permanent
    // exemption granted by whoever was in the room that day.
    requires: ['expires'],
  },
  INCIDENT: {
    dir: 'docs/73-incidents/',
    label: 'incident record',
    writers: ['release-manager', 'qa-engineer'],
    readers: ['tech-manager', 'cto'],
    requires: [],
  },
  ASSUMPTION: {
    dir: 'docs/25-assumptions/',
    label: 'assumption',
    writers: ['tech-lead', 'cpo', 'ios-developer', 'android-developer', 'backend-developer'],
    readers: ['tech-manager', 'qa-engineer', 'product-validator'],
    requires: ['owner', 'confidence', 'validate_by'],
  },
};

const ARTIFACT_ID = /^(ADR|PDR|DDR|WAIVER|INCIDENT|ASSUMPTION)-\d{3,}$/;

// --------------------------------------------------------------------------------------------
// channels — a query over the log, never a place state is authored
// --------------------------------------------------------------------------------------------

const PLATFORM_CHANNEL = {
  'ios-developer': 'ios',
  'android-developer': 'android',
  'backend-developer': 'backend',
  'monetization-engineer': 'monetization',
  'devops-engineer': 'devops',
  'web-developer': 'web',
};
const PRODUCT_ROLES = new Set(['ceo', 'cpo', 'product-validator', 'data-analyst', 'aso-specialist']);
const DESIGN_ROLES = new Set(['ux-designer', 'ux-architect', 'product-designer']);
const FOUNDER_ROLES = new Set(['ceo', 'cpo', 'cto']);

/** Every channel this one message appears in. Membership is computed; nothing subscribes. */
function channelsOf(message) {
  const out = new Set();
  const parties = [message.from, ...toArray(message.to)];

  if (message.channel) out.add(String(message.channel).replace(/^#/, ''));
  for (const role of parties) {
    if (PLATFORM_CHANNEL[role]) out.add(PLATFORM_CHANNEL[role]);
    if (PRODUCT_ROLES.has(role)) out.add('product');
    if (DESIGN_ROLES.has(role)) out.add('design');
  }
  // A founder decision is a decision a founder role took or was told of. It is the one channel a
  // human is expected to read every line of, so it stays narrow on purpose.
  if (message.kind === 'decision' && parties.some((r) => FOUNDER_ROLES.has(r))) {
    out.add('founder-decisions');
  }
  if (message.artifact) out.add('artifacts');
  if (!isTicketless(message.ticket)) out.add(String(message.ticket).toLowerCase());
  return [...out].sort();
}

const isTicketless = (ticket) => !ticket || String(ticket).trim() === TICKETLESS;

const toArray = (value) =>
  Array.isArray(value)
    ? value.map((v) => String(v).trim()).filter(Boolean)
    : String(value ?? '')
        .split(/\s*,\s*/)
        .map((v) => v.trim())
        .filter(Boolean);

/** The thread a message belongs to. Derived from the ticket; stored only so a reader can key on it. */
const threadOf = (message) =>
  message.thread || (isTicketless(message.ticket) ? 'THR-broadcast' : `THR-${String(message.ticket).toUpperCase()}`);

// --------------------------------------------------------------------------------------------
// reading
// --------------------------------------------------------------------------------------------

function normalize(record, line) {
  const message = {
    _line: line,
    id: String(record.id),
    v: record.v,
    ts: record.ts ?? null,
    project: record.project ?? '',
    ticket: isTicketless(record.ticket) ? TICKETLESS : String(record.ticket).trim(),
    kind: String(record.kind).toLowerCase(),
    from: String(record.from).trim(),
    to: toArray(record.to),
    priority: record.priority || (String(record.kind).toLowerCase() === 'fyi' ? 'fyi' : 'material'),
    blocking: record.blocking === true,
    requires_response: record.requires_response === true,
    expires_after_round: Number.isInteger(record.expires_after_round) ? record.expires_after_round : null,
    round: Number.isInteger(record.round) ? record.round : null,
    requirements: toArray(record.requirements),
    artifact: record.artifact ? String(record.artifact).trim() : '',
    transition: record.transition ? String(record.transition).trim() : '',
    decision: record.decision ? String(record.decision).trim() : '',
    evidence: record.evidence ? String(record.evidence).trim() : '',
    expires: record.expires ? String(record.expires).trim() : '',
    owner: record.owner ? String(record.owner).trim() : '',
    confidence: record.confidence ? String(record.confidence).trim() : '',
    validate_by: record.validate_by ? String(record.validate_by).trim() : '',
    summary: String(record.summary ?? '').trim(),
    body: String(record.body ?? '').trim(),
    status: record.status || 'open',
    provenance: record.provenance || 'cli',
    inferred_fields: toArray(record.inferred_fields),
    channel: record.channel ? String(record.channel).replace(/^#/, '') : '',
  };
  message.thread = record.thread || threadOf(message);
  return message;
}

/**
 * Parse the JSONL channel. Returns `{messages, errors}`; a caller that finds errors must fail closed,
 * never treat a half-readable log as an empty channel.
 */
function parseMessageLog(text) {
  const messages = [];
  const errors = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (!line.trim()) return;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        errors.push({ line: index + 1, reason: 'not valid JSON' });
        return;
      }
      if (!record || typeof record !== 'object') {
        errors.push({ line: index + 1, reason: 'not a JSON object' });
        return;
      }
      // The version check is the point of versioning it. A v2 record read by a v1 reader is not
      // "mostly fine" — it is a record whose fields mean something this code does not know.
      if (record.v !== SCHEMA_VERSION) {
        errors.push({
          line: index + 1,
          reason: `schema v${record.v ?? '(absent)'} — this reader speaks ${SCHEMA} only`,
        });
        return;
      }
      for (const field of ['id', 'kind', 'from', 'summary']) {
        if (!record[field]) {
          errors.push({ line: index + 1, reason: `missing required field "${field}"` });
          return;
        }
      }
      if (!KIND_SET.has(String(record.kind).toLowerCase())) {
        errors.push({ line: index + 1, reason: `unknown kind "${record.kind}"` });
        return;
      }
      messages.push(normalize(record, index + 1));
    });
  return { messages, errors };
}

/**
 * The Markdown-ledger shape every existing reader (`board-doctor`, `portfolio`, the dashboard,
 * `messages-render`) already speaks. Deliberately identical to `lib/board.mjs`'s `parseMessages`
 * output so moving the source of truth to JSONL changed no consumer's parser — a renderer that
 * disagrees with its validator is the defect class this repo names most often.
 */
const toLedgerRow = (m) => ({
  _line: m._line,
  timestamp: m.ts ?? 'inferred',
  from: m.from,
  to: m.to.join(', '),
  ticketId: m.ticket,
  kind: m.kind,
  summary: m.summary,
  body: m.body,
  event: m,
});

/** Next `MSG-NNNN`, one past the highest already on the log — never a count, which reuses IDs. */
function nextId(messages) {
  let max = 0;
  for (const m of messages) {
    const n = Number.parseInt(String(m.id).replace(/^MSG-/, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `MSG-${String(max + 1).padStart(4, '0')}`;
}

/** Messages on one ticket, oldest first. A thread is derived; nothing subscribes to it. */
function threads(messages) {
  const out = new Map();
  for (const m of messages) {
    const key = isTicketless(m.ticket) ? '(no ticket)' : m.ticket;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(m);
  }
  return out;
}

/** Messages in a channel, oldest first. This IS the channel — there is no other representation. */
const inChannel = (messages, name) =>
  messages.filter((m) => channelsOf(m).includes(String(name).replace(/^#/, '')));

/** Every channel the log can produce, with its message count. */
function channelIndex(messages) {
  const counts = new Map();
  for (const m of messages) for (const ch of channelsOf(m)) counts.set(ch, (counts.get(ch) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// --------------------------------------------------------------------------------------------
// obligations
// --------------------------------------------------------------------------------------------

/**
 * Every MATERIAL message must yield one of four things: a decision, a state transition, an artifact
 * update, or a timed follow-up. A message that yields none is a message that cost a round and moved
 * nothing, and the ledger fills with them precisely because each one looks reasonable alone.
 *
 * Returns the obligation it satisfies, or `null` if it satisfies none.
 */
function obligationOf(message) {
  // CLOSING KINDS ARE CHECKED BEFORE THE FYI EXEMPTION, not after.
  //
  // `if (priority === 'fyi') return 'none'` used to run first, so `--kind answer --priority fyi`
  // and `--kind decision --priority fyi` were accepted with no artifact and no transition. That is
  // not a harmless label: `pairQuestions` treats `answer` and `decision` as RESOLVING kinds, so the
  // open question was marked closed while nothing whatsoever was delivered. DR4-006 exactly, through
  // a door left open by the escape hatch that exists for messages which decide nothing.
  //
  // "This closes the question" and "this needs no action" are contradictory claims. A message cannot
  // make both, so the closing rule wins and `fyi` cannot be used to smuggle a closure past it.
  // Reported by codex on PR #13, and it means the dry-run-5 H6 verdict was overstated: the
  // obligation rule held for default priority and not for this one.
  if (CLOSING_KINDS.has(message.kind)) {
    if (message.artifact) return 'artifact';
    if (message.transition) return 'transition';
    return null;
  }

  // The escape hatch, now that it can no longer be pointed at a closing kind.
  if (message.priority === 'fyi') return 'none';

  if (message.artifact) return 'artifact';
  if (message.transition) return 'transition';
  if (message.decision) return 'decision';
  if (message.requires_response && Number.isInteger(message.expires_after_round)) return 'follow_up';
  return null;
}

/**
 * Why a message would be refused for having no obligation. Separate from `obligationOf` so the
 * refusal can say the useful thing rather than "invalid": an agent told *what shape* is missing
 * fixes the message; an agent told "refused" sends it again as an `fyi`.
 */
function obligationRefusal(message) {
  if (CLOSING_KINDS.has(message.kind)) {
    return {
      code: 'obligation_missing',
      reason: `a "${message.kind}" that names no artifact closes the ledger without delivering anything (DR4-006) — a closed ledger is not delivery`,
      remedy:
        'Add --artifact <ADR-012|docs/22-impl-spec-ios.md> naming where the answer was folded in, ' +
        'or --transition <APP-001:merged>, or send it as --kind fyi if it genuinely decides nothing.',
    };
  }
  return {
    code: 'obligation_missing',
    reason: `a material "${message.kind}" that yields no decision, no state transition, no artifact update and no timed follow-up is a message that costs a round and moves nothing`,
    remedy:
      'Give it one: --artifact <ID>, --transition <TICKET:event>, --decision "<what was decided>", ' +
      'or --expires-after-round <N> for a question you will chase. --kind fyi is the escape hatch and must be chosen deliberately.',
  };
}

// --------------------------------------------------------------------------------------------
// the guard — one implementation, called by team-message.sh (send) and board-doctor (audit)
// --------------------------------------------------------------------------------------------

/**
 * The anti-ping-pong limits. These lived in THREE files with TWO different windows: team-message.sh
 * counted pairs over the trailing 40 rows and refused a chain at >=4 roles, board-doctor counted the
 * whole thread and warned only above 4, and messages-render restated both. A ledger one had happily
 * written was a breach to another. One implementation, one set of numbers, two callers.
 *
 *   per-role     10 sends in the trailing 40 messages — a rate limit on one agent's turn
 *   pair          2 messages A->B on one ticket without a third party (whole thread)
 *   chain         4 distinct roles involved on one ticket (whole thread)
 *   ticket       12 messages total on one ticket (whole thread) — the discussion budget
 */
const MAX_PER_ROLE = 10;
const MAX_PAIR = 2;
const MAX_CHAIN = 4;
const MAX_PER_TICKET = 12;
const ROUND_WINDOW = 40;

/** Compare question texts the way a human would: a re-ask with different punctuation is a re-ask. */
const normalizeText = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const RESOLVING = new Set(['answer', 'decision']);

/**
 * Pair a ticket's questions with the resolutions that closed them — oldest first, one resolution
 * closes one question. Identical semantics to `lib/board.mjs`'s `pairQuestions`, which counts the
 * Markdown view; both must resolve to the same number or the renderer and the validator disagree
 * about one channel.
 */
function pairQuestions(thread) {
  const open = [];
  const answered = [];
  for (const m of thread) {
    if (m.kind === 'question') open.push(m);
    else if (RESOLVING.has(m.kind)) {
      const question = open.shift();
      if (question) answered.push({ question, resolution: m });
    }
  }
  return { open, answered };
}

/** Every asking message creates a follow-up obligation, not only `question`. */
function openFollowUps(thread) {
  const open = [];
  for (const message of thread) {
    if (ASKING_KINDS.has(message.kind)) open.push(message);
    else if (CLOSING_KINDS.has(message.kind) && open.length) {
      // A question may be answered directly, but a handoff/blocker/escalation is a delivery
      // obligation. A bare answer cannot close it: it must name the artifact or state transition
      // that carries the work forward. This prevents an unrelated-looking resolution from making a
      // material follow-up disappear merely because it was next in the thread.
      const target = open[0];
      if (target.kind === 'question' || message.artifact || message.transition) open.shift();
    }
  }
  return open;
}

const openQuestions = (thread) => pairQuestions(thread).open;

/**
 * Decide whether `candidate` may be appended given the log. `{ok:true}` or
 * `{ok:false, code, reason, remedy}`.
 *
 * An `escalation` is always allowed through the volume guards: it is the prescribed way OUT of every
 * breach below, so blocking it would trap the team in the state the guard exists to end.
 */
function guard(messages, candidate) {
  const from = candidate.from;
  const to = toArray(candidate.to);
  const ticket = isTicketless(candidate.ticket) ? TICKETLESS : String(candidate.ticket).trim();
  const isEscalation = candidate.kind === 'escalation';

  if (isEscalation) return { ok: true };

  // 1. per-role rate limit — a property of the sender's turn, not of the ledger.
  const recent = messages.slice(-ROUND_WINDOW).filter((m) => m.from === from).length;
  if (recent >= MAX_PER_ROLE) {
    return {
      ok: false,
      code: 'role_budget_spent',
      reason: `${from} has sent ${recent} messages this round (max ${MAX_PER_ROLE})`,
      remedy: 'You are looping, not working. Send one --kind escalation to tech-manager instead.',
    };
  }

  // Ticketless rows (`--ticket -`) are broadcast chatter and carry no thread, so the per-ticket
  // guards do not apply. Counting them as one pseudo-thread made every unrelated FYI deepen the same
  // chain and refuse sends on tickets nobody had discussed.
  if (ticket === TICKETLESS) return { ok: true };

  const thread = messages.filter((m) => m.ticket === ticket);

  // 2. per-ticket discussion budget. The pair and chain caps bound WHO talks; nothing bounded HOW
  // MUCH, so a ticket could accumulate an unbounded thread by rotating participants.
  const spent = thread.filter((m) => m.kind !== 'escalation').length;
  if (spent >= MAX_PER_TICKET) {
    return {
      ok: false,
      code: 'ticket_budget_spent',
      reason: `${ticket} has spent its discussion budget — ${spent} messages (max ${MAX_PER_TICKET})`,
      remedy: 'A ticket that needs a 13th message needs a decision. Escalate to tech-manager with both positions.',
    };
  }

  // 3. duplicate question. Re-asking is not escalation; it is the same round again, and the second
  // asker usually cannot see the first because the flat ledger buries it.
  if (candidate.kind === 'question') {
    const text = normalizeText(candidate.summary);
    const prior = thread.find((m) => m.kind === 'question' && normalizeText(m.summary) === text);
    if (prior) {
      return {
        ok: false,
        code: 'duplicate_question',
        reason: `${prior.id} already asked this on ${ticket} ("${prior.summary}" — ${prior.from} → ${prior.to.join(', ')})`,
        remedy: 'Chase that message, or escalate it. Asking again produces a second unanswered question, not an answer.',
      };
    }

    // 4. mandatory escalation after one unresolved round. You already have an open question on this
    // ticket: a second one is a second thing nobody answered, and the honest move is to escalate the
    // first rather than widen the ask.
    //
    // ponytail: "one round" is measured as "your previous question on this ticket is still open",
    // not by a clock — the log has no reliable round marker on every send. Stamp --round N and key
    // this on `expires_after_round` if rounds ever need to be wall-clock real.
    const mine = openQuestions(thread).filter((m) => m.from === from);
    if (mine.length) {
      return {
        ok: false,
        code: 'escalation_required',
        reason: `${from} already has an unanswered question on ${ticket} (${mine[0].id}: "${mine[0].summary}")`,
        remedy: 'One unresolved round is the limit. Send --kind escalation to tech-manager naming both questions.',
      };
    }

    // 5. no reopening a resolved thread without new evidence. A thread that reached a `decision` and
    // then reopens on the same ground is how a settled scope gets relitigated by whoever arrived last.
    const decided = thread.filter((m) => m.kind === 'decision');
    if (decided.length && openQuestions(thread).length === 0 && !candidate.evidence) {
      const last = decided[decided.length - 1];
      return {
        ok: false,
        code: 'reopen_without_evidence',
        reason: `${ticket} was decided by ${last.id} ("${last.summary}") and carries no open question`,
        remedy:
          'Reopening a resolved thread needs new evidence, not a new opinion: pass --evidence "<what changed, and where it is recorded>". ' +
          'If nothing changed, the decision stands.',
      };
    }
  }

  // 6. pair cooldown — A→B twice on one ticket is a conversation; three times is a stall.
  for (const recipient of to) {
    const pair = thread.filter(
      (m) => m.from === from && m.kind !== 'escalation' && m.to.includes(recipient)
    ).length;
    if (pair >= MAX_PAIR) {
      return {
        ok: false,
        code: 'pair_exhausted',
        reason: `${from} → ${recipient} on ${ticket} already happened ${pair} times (max ${MAX_PAIR})`,
        remedy: 'Two is a conversation; three is a stall. Escalate to tech-manager with both positions.',
      };
    }
  }

  // 7. chain depth — counted on the roles this message WOULD create, not the ones already recorded.
  const roles = new Set([from, ...to]);
  for (const m of thread) {
    roles.add(m.from);
    for (const r of m.to) roles.add(r);
  }
  if (roles.size > MAX_CHAIN) {
    return {
      ok: false,
      code: 'chain_too_deep',
      reason: `${ticket} would involve ${roles.size} roles (max ${MAX_CHAIN})`,
      remedy: 'A question relayed through more than four roles is an escalation. Send it to tech-manager.',
    };
  }

  return { ok: true };
}

/**
 * The same limits, applied to a log that already exists — for `board-doctor`, which must catch a
 * channel written by hand or migrated from Markdown around the guard. Returns breach descriptors;
 * the caller decides whether they block.
 */
function auditGuards(messages) {
  const breaches = [];
  for (const [ticket, thread] of threads(messages)) {
    if (ticket === '(no ticket)') continue;

    const pairs = new Map();
    for (const m of thread) {
      if (m.kind === 'escalation') continue;
      for (const r of m.to) {
        const key = `${m.from}→${r}`;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
    }
    for (const [pair, count] of pairs) {
      if (count > MAX_PAIR) breaches.push({ code: 'message_pair_exceeded', ticket, pair, count, limit: MAX_PAIR });
    }

    const involved = new Set(thread.flatMap((m) => [m.from, ...m.to])).size;
    if (involved > MAX_CHAIN) {
      breaches.push({ code: 'message_chain_too_deep', ticket, count: involved, limit: MAX_CHAIN });
    }

    const spent = thread.filter((m) => m.kind !== 'escalation').length;
    if (spent > MAX_PER_TICKET) {
      breaches.push({ code: 'ticket_budget_exceeded', ticket, count: spent, limit: MAX_PER_TICKET });
    }

    const seen = new Map();
    for (const m of thread) {
      if (m.kind !== 'question') continue;
      const text = normalizeText(m.summary);
      if (seen.has(text)) {
        breaches.push({ code: 'duplicate_question', ticket, id: m.id, of: seen.get(text), summary: m.summary });
      } else seen.set(text, m.id);
    }
  }
  return breaches;
}

/**
 * Answers and decisions that named no artifact. A ledger where every question has an answer looks
 * closed; if no answer names where it was folded in, nothing downstream ever changed — DR4-006, "a
 * closed ledger is not delivery". Migrated rows are exempt: the Markdown never carried the field, so
 * reporting them would be reporting the migration, not the team.
 */
const undeliveredAnswers = (messages) =>
  messages.filter(
    (m) => CLOSING_KINDS.has(m.kind) && m.provenance !== 'inferred' && !m.artifact && !m.transition
  );

/**
 * Waivers past their expiry. An expired waiver is a finding: the exemption was granted for a period,
 * and a period that ended without anyone noticing is a permanent exemption granted by accident.
 */
function expiredWaivers(messages, today = new Date().toISOString().slice(0, 10)) {
  return messages.filter((m) => m.artifact.startsWith('WAIVER-') && m.expires && m.expires < today);
}

/** Assumptions past their validation date — the same rule, one artifact along. */
function staleAssumptions(messages, today = new Date().toISOString().slice(0, 10)) {
  return messages.filter((m) => m.artifact.startsWith('ASSUMPTION-') && m.validate_by && m.validate_by < today);
}

// --------------------------------------------------------------------------------------------
// rendering — docs/team/messages.md is GENERATED
// --------------------------------------------------------------------------------------------

/**
 * One table cell. Every newline is collapsed and every `|` becomes `/`.
 *
 * A multi-line body used to emit extra lines INSIDE the table and the parser read each one as
 * another message — phantom rows, forged by a body. A `|` in a ticket ID or a role name
 * ("tech-lead | acting", "APP-001 | APP-002") shifted every field after it one column left, so the
 * Kind column read a role name and the ticket disappeared.
 *
 * Substituted rather than escaped, deliberately: this is the VIEW, and the JSONL keeps the exact
 * text. A lossy-but-unambiguous rendering beside a lossless log is the right trade; an escaped `\|`
 * is still a `|` to every `awk -F'|'` a human will reach for.
 */
const CELL = (value) => {
  const text = String(value ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/\|/g, '/')
    .replace(/ {2,}/g, ' ')
    .trim();
  return text === '' ? '—' : text;
};

/**
 * Regenerate `docs/team/messages.md` from the log.
 *
 * The column set is held IDENTICAL to the hand-written ledger — `lib/board.mjs`'s `parseMessages`,
 * `board-doctor`, `portfolio.mjs` and the dashboard all still parse it unchanged. Moving the source
 * of truth was allowed to change where state is written; it was not allowed to break every reader.
 */
function renderMessages(messages, { generatedAt = new Date().toISOString() } = {}) {
  const lines = [
    '## Team messages (append-only — never edit or delete a line)',
    '',
    '<!-- GENERATED FILE — do not hand-edit.',
    '     Rendered from docs/team/messages.jsonl by scripts/messages.mjs.',
    '     Send with `sh scripts/team-message.sh --from ... --to ... --kind ... --summary ...`;',
    '     a hand edit is silently overwritten by the next render and is invisible to every rule. -->',
    '',
    `Generated ${generatedAt} from ${messages.length} message(s).`,
    '',
    '| Timestamp | From | To | Ticket | Kind | Summary | Body |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const m of messages) {
    lines.push(
      `| ${[m.ts ?? 'inferred', m.from, m.to.join(', '), m.ticket, m.kind, m.summary, m.body]
        .map(CELL)
        .join(' | ')} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

// --------------------------------------------------------------------------------------------
// migration — from the hand-written Markdown ledger
// --------------------------------------------------------------------------------------------

/**
 * Reconstruct the event log from `docs/team/messages.md`.
 *
 * Everything the Markdown could not carry — priority, obligation, thread, status, requirements, the
 * artifact an answer was folded into — is INVENTED, so every migrated record is
 * `provenance: "inferred"` and names the fields in `inferred_fields`. The board's migration does
 * exactly this. A migration that quietly asserted an obligation nobody recorded would make the
 * obligation rule a lie from the first line, and the rule is the point of the phase.
 *
 * `ts` is the one field genuinely sourced: the Markdown carried a timestamp and it is copied, not
 * regenerated.
 */
function migrate(markdown, { parseMessages }) {
  const rows = parseMessages(markdown);
  const inferred = ['priority', 'status', 'thread', 'requires_response', 'expires_after_round'];
  const messages = [];

  for (const [index, row] of rows.entries()) {
    const kind = row.kind;
    const message = normalize(
      {
        id: `MSG-${String(index + 1).padStart(4, '0')}`,
        v: SCHEMA_VERSION,
        ts: row.timestamp,
        ticket: row.ticketId,
        kind,
        from: row.from,
        to: row.to,
        priority: kind === 'fyi' ? 'fyi' : 'material',
        requires_response: ASKING_KINDS.has(kind),
        // One round, because that is what team-protocol has always said the age limit is. It is a
        // reconstruction, which is why it is listed as inferred rather than presented as recorded.
        expires_after_round: ASKING_KINDS.has(kind) ? 1 : null,
        summary: row.summary,
        body: row.body === '—' ? '' : row.body,
        provenance: 'inferred',
        inferred_fields: inferred,
      },
      index + 1
    );
    messages.push(message);
  }

  // Status is derived from the pairing, exactly as every reader derives it — not stored knowledge.
  for (const [ticket, thread] of threads(messages)) {
    if (ticket === '(no ticket)') continue;
    const { open } = pairQuestions(thread);
    const openIds = new Set(open.map((m) => m.id));
    for (const m of thread) {
      if (m.kind === 'question') m.status = openIds.has(m.id) ? 'open' : 'resolved';
      else m.status = 'closed';
    }
  }

  return messages;
}

/** Serialise for the log. `_line` is a read artifact and never goes back to disk. */
function serialize(message) {
  const { _line, ...record } = message;
  return `${JSON.stringify(record)}\n`;
}

export {
  SCHEMA,
  SCHEMA_VERSION,
  KINDS,
  KIND_SET,
  PRIORITIES,
  ASKING_KINDS,
  CLOSING_KINDS,
  TICKETLESS,
  ARTIFACT_TYPES,
  ARTIFACT_ID,
  MAX_PER_ROLE,
  MAX_PAIR,
  MAX_CHAIN,
  MAX_PER_TICKET,
  ROUND_WINDOW,
  isTicketless,
  toArray,
  threadOf,
  channelsOf,
  channelIndex,
  inChannel,
  normalize,
  parseMessageLog,
  toLedgerRow,
  nextId,
  threads,
  pairQuestions,
  openFollowUps,
  openQuestions,
  obligationOf,
  obligationRefusal,
  guard,
  auditGuards,
  undeliveredAnswers,
  expiredWaivers,
  staleAssumptions,
  renderMessages,
  migrate,
  serialize,
};
