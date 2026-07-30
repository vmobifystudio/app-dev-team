/**
 * The control room's state — five screens, assembled from the logs and nothing else.
 *
 * THE RULE THIS FILE IS HELD TO: render only what the log can produce.
 *
 * Every field below traces to `docs/31-board-events.jsonl`, `docs/team/messages.jsonl` (or its
 * generated Markdown view), `docs/31-board.md`, `docs/02-team-roster.md`, `docs/51-bugs.md` or
 * `docs/33-rounds.jsonl`. There is no agent chatter, no narrated thinking, no synthesised progress
 * and no invented recommendation. The moment this page shows something the event log cannot
 * produce, it becomes a second source of truth — and then two things claim to say what happened.
 *
 * THE SECOND RULE: `clear` is a claim that requires its inputs.
 *
 * Every section carries `swept` (the population it looked at) and one of four statuses:
 *
 *   attention    it found something
 *   clear        it swept a real population and found nothing
 *   info         it is a display, not a judgement (the board, the timeline)
 *   unavailable  it could not evaluate, and `note` says which input was missing
 *
 * A section whose inputs are missing is `unavailable`. It is never `clear` and never silently
 * empty — an empty panel that reads as all-clear is the failure this whole codebase exists to
 * prevent, and a UI is the easiest place to commit it.
 *
 * Nothing here parses a state file itself: every reader is `scripts/lib/project.mjs`, shared with
 * the zero-dep emergency dashboard, so the two surfaces cannot disagree about one board.
 *
 * Node stdlib only, deliberately: this module is imported by `server.mjs`, which must start without
 * `control-room/node_modules` present. The React app is the only part that needs the toolchain.
 */

import { IN_FLIGHT_STATUS, BUILD_SPAWNABLE_OWNERS, normalizeId, isEmpty } from '../scripts/lib/board.mjs';
import { deriveMetrics, verifyChain } from '../scripts/lib/events.mjs';
import {
  channelIndex,
  channelsOf,
  pairQuestions,
  threads as threadsOf,
  obligationOf,
  undeliveredAnswers,
  expiredWaivers,
  staleAssumptions,
} from '../scripts/lib/messages.mjs';
import { redact } from '../scripts/lib/redact.mjs';
import {
  REL,
  readSource,
  loadLog,
  buildRows,
  stuckItems,
  detailText,
  readChannel,
  readRoster,
  readBugsFile,
  readRounds,
} from '../scripts/lib/project.mjs';
import { ACTIONS, actionForms } from '../scripts/lib/actions.mjs';

const STATUS_ORDER = ['todo', 'in_progress', 'review', 'qa', 'done', 'blocked'];
const SHIPPED = new Set(['qa', 'done']);
const FOUNDER_ROLES = new Set(['ceo', 'cpo', 'cto', 'founder', 'studio-director', 'chief-of-staff']);
const REVIEW_EVENTS = new Set(['started', 'approved', 'changes']);
const VERIFY_EVENTS = new Set(['verified', 'verified_static', 'qa_passed', 'qa_failed']);

/** The one place a status is decided, so "clear" cannot be produced by forgetting to check. */
function section(id, title, { swept, note = '', clearNote = '', items = [], data = null, unavailable = '', info = false }) {
  if (unavailable) {
    return { id, title, status: 'unavailable', note: unavailable, swept: swept || 'nothing', items: [], data };
  }
  return {
    id,
    title,
    // `info` wins over a non-empty list: a section that DISPLAYS things (who owns work, the budget)
    // is not raising a finding by having rows, and colouring it red teaches the operator to ignore
    // red. Only a section that makes a judgement can reach `attention`.
    status: info ? 'info' : items.length ? 'attention' : 'clear',
    note,
    swept,
    clearNote,
    items,
    data,
  };
}

const WORST = { attention: 3, unavailable: 2, info: 1, clear: 0 };
const rollUp = (sections) =>
  sections.reduce((worst, s) => (WORST[s.status] > WORST[worst] ? s.status : worst), 'clear');

// ---------------------------------------------------------------------------------------------
// screen 1 — MISSION CONTROL
// ---------------------------------------------------------------------------------------------

/**
 * Whether a project is in charter, sprint or release. DERIVED, and it says so on the page.
 *
 * The log records no phase marker, so this is an inference from what exists, not a fact that was
 * written down. Labelling it as derived is the difference between a useful summary and a second
 * source of truth about where the project is.
 */
function derivePhase(model) {
  if (!model.rows.length) return { phase: 'charter (no board)', derived: 'no ticket table anywhere, so no sprint has been planned' };
  const open = model.rows.filter((r) => IN_FLIGHT_STATUS.has(r.status));
  if (open.length) {
    return {
      phase: 'sprint',
      derived: `${open.length} of ${model.rows.length} ticket(s) are still in flight (${[...IN_FLIGHT_STATUS].join(', ')})`,
    };
  }
  return {
    phase: 'sprint closed — release not yet gated',
    derived: `every one of ${model.rows.length} ticket(s) has left the in-flight statuses; no ship-gate verdict is recorded on the log`,
  };
}

function missionControl(model) {
  const { rows, log, bugs, rounds } = model;

  // 1. LEADS with cause. On a blocked sprint a burn-down is a flat line that explains nothing; the
  //    single most useful fact of dry run 4 was "here is the one reason".
  const stuck = stuckItems(rows);
  const sections = [
    section('stuck', 'Why work is not moving', {
      unavailable:
        model.unavailableNote ||
        (log.ok ? '' : `${log.note} — without the log there are no blocked reasons and no recorded gate verdicts, so an empty list here has not been earned`),
      swept: `${rows.length} ticket(s) and ${log.events.length} event(s) — every blocked ticket with its recorded reason, every ticket stranded behind one, and every recorded CANNOT EVALUATE`,
      clearNote: 'nothing is blocked, nothing is stranded, and no gate has recorded a CANNOT EVALUATE',
      items: stuck,
    }),
  ];

  // 2. Who is working. The log records TICKET events, not processes — so this says who owns moving
  //    work and who last acted, and says that is what it means.
  const owners = new Map();
  for (const row of rows) {
    if (!['in_progress', 'review'].includes(row.status)) continue;
    if (!owners.has(row.owner || '(unassigned)')) owners.set(row.owner || '(unassigned)', []);
    owners.get(row.owner || '(unassigned)').push(row.id);
  }
  const actors = [...new Set(log.events.map((e) => e.by).filter(Boolean))];
  sections.push(
    section('agents', 'Active agents', {
      unavailable: model.unavailableNote,
      info: true,
      note: 'the log records ticket events, not running processes — this is who owns moving work and who has ever acted on this board, which is not the same as who is running right now',
      swept: `${rows.length} ticket(s); ${actors.length} role(s) have appeared as an actor in ${log.events.length} event(s)`,
      items: [...owners].map(([owner, ids]) => ({
        kind: 'working',
        id: owner,
        reason: `${ids.length} ticket(s) in progress or in review: ${ids.join(', ')}`,
      })),
      data: { actors },
    })
  );

  // 3. Budget. `spendUsd` is null unless something recorded a real number — see readRounds.
  sections.push(
    section('budget', 'Budget position', {
      unavailable: rounds.ok ? '' : rounds.note,
      info: true,
      swept: rounds.ok ? `${rounds.rounds.length} round(s) journalled in ${REL.rounds}` : 'nothing',
      data: rounds.ok ? rounds.totals : null,
      note: rounds.ok && rounds.totals.spendUsd === null
        ? 'token spend is not measurable in this harness and is reported as unknown, never as 0 — rounds, spawns, retries and refusals are the ceilings that actually stop the loop'
        : '',
    })
  );

  // 4. Latest build. Nothing in this system records a "build" as such; the closest recorded fact is
  //    a verification event, and calling it a build would be inventing one.
  const verifications = log.events.filter((e) => VERIFY_EVENTS.has(e.event));
  const last = verifications[verifications.length - 1];
  sections.push(
    section('build', 'Latest verification', {
      unavailable: !log.ok
        ? log.note
        : verifications.length
          ? ''
          : 'the log records no verification event at all. Nothing has been verified, statically or otherwise, through the board — which is not the same as a build that failed',
      info: true,
      note: 'the board log has no "build" event; a verification is the closest fact it records, and this panel will not call one the other',
      swept: `${log.events.length} event(s); ${verifications.length} verification event(s)`,
      data: last
        ? { ticket: last.ticket, event: last.event, by: last.by || '', ts: last.ts || 'inferred', detail: detailText(last.detail).slice(0, 400) }
        : null,
    })
  );

  // 5. Release readiness — DISPLAYED, NEVER AUTHORITATIVE. A blocking gate always wins.
  const inFlight = rows.filter((r) => IN_FLIGHT_STATUS.has(r.status));
  const staticOnly = rows.filter((r) => r.staticOnly);
  const releaseItems = [
    ...inFlight.map((r) => ({ kind: 'in_flight', id: r.id, reason: `${r.status} — the sprint is not finished` })),
    ...staticOnly.map((r) => ({
      kind: 'static_only',
      id: r.id,
      reason: `${r.unrun || 'the executable test suite'} has never run — it may merge and reach qa, it may not be called done`,
    })),
    ...(bugs.ok ? bugs.blocking : []).map((b) => ({ kind: 'blocking_bug', id: b.id, reason: `${b.severity} open — ${b.line.slice(0, 200)}` })),
  ];
  sections.push(
    section('release', 'Release readiness', {
      unavailable:
        model.unavailableNote ||
        (bugs.ok ? '' : `${bugs.note}. Readiness cannot be claimed with the open S1/S2 count unknown`),
      swept: `${rows.length} ticket(s) (in-flight = ${[...IN_FLIGHT_STATUS].join('/')}), ${staticOnly.length} verified static-only, ${bugs.ok ? `${bugs.open.length} open bug(s) of which ${bugs.blocking.length} are S1/S2` : 'the bug list could not be read'}`,
      clearNote: 'nothing is in flight, nothing is carrying a static-only verification, and no S1/S2 bug is open',
      note: 'displayed, never authoritative. This is a projection of recorded state; `scripts/ship-gate.sh` is the gate, and a blocking gate always wins over anything shown here',
      items: releaseItems,
    })
  );

  const phase = derivePhase(model);
  return {
    id: 'mission',
    title: 'Mission Control',
    status: rollUp(sections),
    phase,
    sections,
  };
}

// ---------------------------------------------------------------------------------------------
// screen 2 — COMMUNICATIONS
// ---------------------------------------------------------------------------------------------

/**
 * Channels and per-ticket threads, rendered as a conversation with the structured metadata beside
 * each message.
 *
 * The degrade here is the interesting part. `docs/team/messages.jsonl` carries the metadata that
 * makes a thread operational — ticket, requirement, decision, the artifact an answer was folded
 * into, whether a verification is required. `docs/team/messages.md` is its generated view and
 * carries none of it. A project written before P3a has only the Markdown, and the honest report is
 * "UNKNOWN for all N answers", never "none of them named an artifact": the second is a finding
 * about the team, and this would be a finding about the file format.
 */
function communications(model) {
  const { channel, byId } = model;

  if (!channel.ok) {
    return {
      id: 'comms',
      title: 'Communications',
      status: 'unavailable',
      note: channel.note,
      structured: false,
      from: channel.from,
      channels: [],
      threads: [],
      sections: [
        section('open', 'Open questions', { unavailable: channel.note, swept: 'nothing' }),
        section('delivery', 'Answers and the artifact they were folded into', { unavailable: channel.note, swept: 'nothing' }),
      ],
    };
  }

  const messages = channel.messages;
  const threadMap = threadsOf(messages);

  const openItems = [];
  const undeliveredItems = [];
  let answeredCount = 0;

  for (const [ticket, thread] of threadMap) {
    const status = ticket === '(no ticket)' ? null : (byId.get(normalizeId(ticket))?.status ?? null);
    const { open, answered } = pairQuestions(thread);
    for (const q of open) {
      openItems.push({
        kind: 'open_question',
        id: ticket,
        messageId: q.id,
        from: q.from,
        to: q.to.join(', '),
        question: q.summary,
        asked: q.ts || 'inferred',
        shipped: Boolean(status && SHIPPED.has(status)),
        ticketStatus: status || 'not on the board',
        reason:
          status && SHIPPED.has(status)
            ? `STILL OPEN while ${ticket} is ${status} — it shipped on an unconfirmed assumption`
            : 'open — a question nobody answered is how a guess becomes shipped behaviour',
        actionable: true,
      });
    }
    answeredCount += answered.length;
  }

  // Only the structured log can answer "did this answer name its artifact". `undeliveredAnswers`
  // exempts `provenance: inferred` rows for exactly this reason, so the Markdown fallback produces
  // an empty list — which must NOT be rendered as "every answer delivered".
  if (channel.structured) {
    for (const m of undeliveredAnswers(messages)) {
      undeliveredItems.push({
        kind: 'undelivered_answer',
        id: m.ticket,
        messageId: m.id,
        from: m.from,
        to: m.to.join(', '),
        answer: m.summary,
        reason: 'closed the ledger and named no artifact and no state transition — a closed ledger is not delivery',
        actionable: false,
      });
    }
  }

  const openSection = section('open', 'Open questions', {
    swept: `${messages.length} message(s) across ${threadMap.size} thread(s), read from ${channel.from}`,
    clearNote: 'every question on the channel has an answer',
    items: openItems,
  });

  const deliverySection = channel.structured
    ? section('delivery', 'Answers and the artifact they were folded into', {
        swept: `${answeredCount} answered question(s); every answer and decision checked for the artifact or transition it produced`,
        clearNote: 'every answer names the artifact or the state transition it was folded into',
        items: undeliveredItems,
      })
    : section('delivery', 'Answers and the artifact they were folded into', {
        unavailable:
          `${channel.from} is the GENERATED Markdown view and has no artifact column. Whether each of the ${answeredCount} ` +
          'answer(s) named where it was folded in is UNKNOWN — not "none", which would be a finding about the team rather ' +
          'than about the file. Run `node scripts/messages.mjs migrate` to reconstruct docs/team/messages.jsonl.',
        swept: `${answeredCount} answered question(s), none of which carries structured metadata in this source`,
      });

  const artifactSections = channel.structured
    ? [
        section('waivers', 'Expired waivers and stale assumptions', {
          swept: `${messages.filter((m) => m.artifact).length} message(s) carrying a formal artifact`,
          clearNote: 'no waiver is past its expiry and no assumption is past its validation date',
          items: [
            ...expiredWaivers(messages).map((m) => ({
              kind: 'expired_waiver',
              id: m.artifact,
              reason: `expired ${m.expires} — an exemption granted for a period that ended without anyone noticing is a permanent exemption granted by accident`,
            })),
            ...staleAssumptions(messages).map((m) => ({
              kind: 'stale_assumption',
              id: m.artifact,
              reason: `should have been validated by ${m.validate_by} (owner: ${m.owner || 'nobody recorded'})`,
            })),
          ],
        }),
      ]
    : [];

  const threads = [...threadMap].map(([ticket, thread]) => ({
    ticket,
    ticketStatus: ticket === '(no ticket)' ? '' : (byId.get(normalizeId(ticket))?.status ?? ''),
    open: pairQuestions(thread).open.length,
    messages: thread.map((m) => ({
      id: m.id,
      ts: m.ts || 'inferred',
      from: m.from,
      to: m.to,
      kind: m.kind,
      priority: m.priority,
      summary: m.summary,
      body: m.body,
      provenance: m.provenance,
      // The metadata panel beside each message. This is what makes the chat view operational rather
      // than decorative — and on an unstructured source every one of these is empty, which the
      // screen-level `structured:false` flag explains rather than leaving to be read as "none".
      meta: {
        ticket: m.ticket,
        requirements: m.requirements,
        decision: m.decision,
        artifact: m.artifact,
        transition: m.transition,
        evidence: m.evidence,
        requiresResponse: m.requires_response,
        expiresAfterRound: m.expires_after_round,
        obligation: channel.structured ? obligationOf(m) : null,
        channels: channelsOf(m),
      },
    })),
  }));

  const sections = [openSection, deliverySection, ...artifactSections];
  return {
    id: 'comms',
    title: 'Communications',
    status: rollUp(sections),
    structured: channel.structured,
    from: channel.from,
    note: channel.note,
    channels: channelIndex(messages).map(([name, count]) => ({ name, count })),
    threads,
    sections,
  };
}

// ---------------------------------------------------------------------------------------------
// screen 3 — BOARD
// ---------------------------------------------------------------------------------------------

function boardScreen(model) {
  const { rows, log } = model;

  const columns = STATUS_ORDER.map((status) => ({
    status,
    tickets: rows
      .filter((r) => r.status === status)
      .map((r) => ({
        id: r.id,
        title: r.title,
        owner: r.owner,
        reviewer: r.reviewer,
        stranded: Boolean(r.stranded),
        // Carried VISIBLY, in the cell every human reads, exactly as board-render writes it. A
        // ticket whose tests never ran must not read as plain `qa`.
        display: r.staticOnly ? `${status} (static only)` : status,
        staticOnly: r.staticOnly,
        dependsOn: r.deps,
      })),
  })).filter((c) => c.tickets.length);

  const byOwner = new Map();
  for (const row of rows) {
    if (row.status === 'done') continue;
    const owner = row.owner || '(unassigned)';
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(row);
  }

  // NEEDS ATTENTION — every reason a row cannot simply proceed, each naming the reason.
  const attention = [];
  for (const row of rows) {
    if (row.status === 'blocked') {
      const lastBlock = [...row.events].reverse().find((e) => e.event === 'blocked');
      attention.push({
        kind: 'blocked',
        id: row.id,
        owner: row.owner,
        reason: detailText(lastBlock?.detail).trim() || row.notes.trim() || 'NO REASON RECORDED — nobody can act on this',
        actionable: true,
      });
    }
    if (row.stranded) {
      attention.push({ kind: 'stranded', id: row.id, owner: row.owner, reason: `behind ${row.stranded.via} (${row.stranded.reason})` });
    }
    if (row.staticOnly) {
      attention.push({ kind: 'static_only', id: row.id, owner: row.owner, reason: `${row.unrun || 'the executable test suite'} has never run` });
    }
    if (!row.owner && row.status !== 'done') {
      attention.push({ kind: 'unowned', id: row.id, owner: '', reason: 'no owner — the sprint loop has nobody to spawn for it' });
    }
    if (row.status === 'review' && isEmpty(row.reviewer)) {
      attention.push({ kind: 'no_reviewer', id: row.id, owner: row.owner, reason: 'awaiting review with no reviewer named' });
    }
  }

  const sections = [
    section('attention', 'Needs attention', {
      unavailable: model.unavailableNote,
      swept: `${rows.length} ticket(s) — blocked, stranded, static-only, unowned, and awaiting review with no reviewer`,
      clearNote: 'every ticket has an owner, none is blocked or stranded, and none carries a static-only verification',
      items: attention,
    }),
  ];

  return {
    id: 'board',
    title: 'Board',
    status: rollUp(sections),
    from: model.from,
    swept: model.from ? `${rows.length} ticket(s), read from ${model.from}` : 'nothing',
    note: model.unavailableNote,
    columns,
    owners: [...byOwner]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([owner, list]) => ({
        owner,
        open: list.length,
        inProgress: list.filter((r) => r.status === 'in_progress').length,
        review: list.filter((r) => r.status === 'review').length,
        blocked: list.filter((r) => r.status === 'blocked').length,
        stranded: list.filter((r) => r.stranded).length,
        staticOnly: list.filter((r) => r.staticOnly).length,
      })),
    metrics: log.ok
      ? (() => {
          const m = deriveMetrics(log.events);
          return {
            medianCycleTimeMs: m.medianCycleTimeMs,
            // n/a, never 0% — an empty denominator reads as "every review failed".
            reviewPassRate: m.reviewPassRate,
            reworkRate: m.reworkRate,
            gateFires: m.gateFires,
            reachedReview: Object.values(m.tickets).filter((t) => t.reviewed).length,
            reviewerActions: log.events.filter((e) => REVIEW_EVENTS.has(e.event)).length,
          };
        })()
      : null,
    metricsNote: log.ok ? '' : `${log.note} — every number here is derived from the event log, so there are none`,
    sections,
  };
}

// ---------------------------------------------------------------------------------------------
// screen 4 — TEAM
// ---------------------------------------------------------------------------------------------

/**
 * The activated roster for this project.
 *
 * `docs/02-team-roster.md`'s own rule is that every activation-matrix role gets a row and a
 * deactivated role is an `off` WITH ITS REASON — "a role missing from this file is not off, it is
 * unaccounted for". So this screen reports three populations, not one: the roster rows, the roster's
 * own defects (a state that is not one of the three, an `off` with no reason), and any role that has
 * ACTED ON THE LOG without a roster row at all, which is the case the roster file cannot see.
 */
function teamScreen(model) {
  const { roster, rows, log } = model;

  if (!roster.ok) {
    return {
      id: 'team',
      title: 'Team',
      status: 'unavailable',
      note: roster.note,
      tier: '',
      productType: '',
      roles: [],
      sections: [section('roster', 'Roster integrity', { unavailable: roster.note, swept: 'nothing' })],
    };
  }

  const workedBy = new Map();
  for (const row of rows) {
    if (!row.owner) continue;
    if (!workedBy.has(row.owner)) workedBy.set(row.owner, []);
    workedBy.get(row.owner).push({ id: row.id, status: row.staticOnly ? `${row.status} (static only)` : row.status });
  }
  const actors = new Map();
  for (const e of log.events) {
    if (!e.by) continue;
    actors.set(e.by, (actors.get(e.by) || 0) + 1);
  }

  const roles = roster.roles.map((r) => ({
    role: r.role,
    state: r.state,
    // The trigger for a conditional role and the reason for an off role live in the same column;
    // the file's format makes them one field, so this reports it as one field rather than guessing.
    reason: r.reason,
    workingOn: workedBy.get(r.role) || [],
    logActions: actors.get(r.role) || 0,
  }));

  const named = new Set(roster.roles.map((r) => r.role));
  const unaccounted = [...actors.keys()]
    .filter((role) => !named.has(role))
    .map((role) => ({
      kind: 'unaccounted_actor',
      id: role,
      reason: `${role} has acted on this board ${actors.get(role)} time(s) and has no row in ${REL.roster} — a role that is not on the roster is not "off", it is unaccounted for`,
    }));

  // Only roles the BUILD LOOP can spawn. A `ceo` that wrote the vision and never touched the board
  // is doing its job; flagging it would be a false positive, and a panel that cries wolf is read as
  // decoration — which is how the one real finding gets missed. The real finding is DR4-002's shape:
  // a role the sprint loop is supposed to spawn that never once appears in the board's own log.
  const idleActive = roles
    .filter((r) => BUILD_SPAWNABLE_OWNERS.has(r.role) && r.state === 'active' && !r.workingOn.length && !r.logActions)
    .map((r) => ({
      kind: 'active_but_silent',
      id: r.role,
      reason: `active and spawnable by the build loop, yet owns no ticket and has never appeared as an actor in the ${log.events.length} event(s) on the board log`,
    }));

  // Two sections, not one, because they have DIFFERENT INPUTS. Merged, a clear verdict would be
  // claiming "every role that has acted is on the roster" on a run where the log was unreadable —
  // a panel that quietly drops half its inputs and still prints CLEAR, which is the exact failure
  // this whole codebase exists to prevent. Split, each one can only claim what it actually swept.
  const sections = [
    section('roster', 'Roster integrity', {
      swept: `${roster.roles.length} role row(s) in ${REL.roster} — every row checked for a valid state and a recorded reason`,
      clearNote: 'every role has one of the three states and a recorded reason or trigger',
      items: roster.problems.map((p) => ({ kind: 'roster_defect', id: p.role, reason: `${REL.roster}:${p.line} — ${p.reason}` })),
    }),
    section('unaccounted', 'Roles that acted without a roster row', {
      unavailable: log.ok ? '' : `${log.note} — "which roles have acted?" is a question about the log, and it cannot be answered`,
      swept: `${actors.size} distinct actor(s) across ${log.events.length} log event(s), checked against ${roster.roles.length} roster row(s)`,
      clearNote: 'every role that has acted on this board has a row on the roster',
      items: unaccounted,
    }),
    section('idle', 'Active but silent', {
      unavailable: log.ok ? '' : `${log.note} — "has this role ever acted?" is a question about the log`,
      swept: `${roles.filter((r) => r.state === 'active').length} active role(s)`,
      clearNote: 'every active role either owns a ticket or has acted on the log',
      items: idleActive,
    }),
  ];

  return {
    id: 'team',
    title: 'Team',
    status: rollUp(sections),
    tier: roster.tier,
    productType: roster.productType,
    note: roster.note,
    swept: `${roster.roles.length} role(s) recorded in ${REL.roster}`,
    roles,
    sections,
  };
}

// ---------------------------------------------------------------------------------------------
// screen 5 — FOUNDER INBOX
// ---------------------------------------------------------------------------------------------

/**
 * A recorded remedy, quoted — never a generated one.
 *
 * tech-manager writes "Unblock trigger: <what has to happen>" into a block reason, and that is a
 * recommendation the team actually made. Quoting it is reporting; composing one from the ticket's
 * shape would be this page inventing advice and attributing it to the log. Where no remedy was
 * recorded, this returns null and the screen says so — "nobody proposed one" is a finding.
 */
const RECORDED_REMEDY = /(?:unblock trigger|remedy|recommendation|proposal)\s*:\s*([^\n]{3,400})/i;

function founderInbox(model) {
  const { rows, channel, log } = model;
  const items = [];

  // 1. Blocked work. A blocked sprint is a founder call — resource it, rescope it, or accept it.
  for (const row of rows.filter((r) => r.status === 'blocked')) {
    const lastBlock = [...row.events].reverse().find((e) => e.event === 'blocked');
    const context = detailText(lastBlock?.detail).trim() || row.notes.trim();
    const quoted = RECORDED_REMEDY.exec(context);
    items.push({
      kind: 'blocked_work',
      id: row.id,
      title: row.title || row.id,
      owner: row.owner,
      since: lastBlock?.ts || 'inferred',
      context: context || 'NO REASON RECORDED — the block was written without one, so nobody can act on it',
      recommendation: quoted
        ? { text: quoted[1].trim(), source: `quoted from the recorded block reason (${REL.log})` }
        : null,
      recommendationNote: quoted ? '' : 'no remedy was recorded with this block. Nobody proposed one — that is the finding, and this page will not invent one.',
      action: { name: 'unblock', prefill: { ticket: row.id, by: 'tech-manager' } },
    });
  }

  // 2. Questions routed to a founder role, still open. Only the channel can produce these.
  if (channel.ok) {
    for (const [ticket, thread] of threadsOf(channel.messages)) {
      for (const q of pairQuestions(thread).open) {
        if (![q.from, ...q.to].some((r) => FOUNDER_ROLES.has(r))) continue;
        const proposals = thread.filter((m) => m.id !== q.id && m.decision);
        items.push({
          kind: 'decision_required',
          id: ticket,
          title: q.summary,
          owner: q.from,
          since: q.ts || 'inferred',
          context: q.body || q.summary,
          recommendation: proposals.length
            ? { text: proposals[proposals.length - 1].decision, source: `proposed on the channel by ${proposals[proposals.length - 1].from}` }
            : null,
          recommendationNote: proposals.length ? '' : 'no proposal is recorded on this thread — the question was asked and nobody put an option on the table.',
          action: { name: 'answer', prefill: { ticket: ticket === '(no ticket)' ? '' : ticket, to: q.from, from: 'ceo' } },
        });
      }
    }
  }

  // 3. Escalations nothing decided. `escalation` is the prescribed way out of every guard breach,
  //    so one that produced no decision is a route out that was taken and then dropped.
  if (channel.ok && channel.structured) {
    for (const [ticket, thread] of threadsOf(channel.messages)) {
      const escalations = thread.filter((m) => m.kind === 'escalation');
      for (const e of escalations) {
        const after = thread.filter((m) => m.kind === 'decision' && thread.indexOf(m) > thread.indexOf(e));
        if (after.length) continue;
        items.push({
          kind: 'escalation_open',
          id: ticket,
          title: e.summary,
          owner: e.from,
          since: e.ts || 'inferred',
          context: e.body || e.summary,
          recommendation: null,
          recommendationNote: 'an escalation is the way OUT of a stalled thread. No decision follows this one on the log.',
          action: { name: 'answer', prefill: { ticket: ticket === '(no ticket)' ? '' : ticket, to: e.from, from: 'ceo' } },
        });
      }
    }
  }

  const sections = [
    section('decisions', 'Decisions required', {
      // EITHER input missing makes this verdict unavailable, not just both.
      //
      // This was `!log.ok && !channel.ok`, so an unreadable CHANNEL with a readable board still let
      // the section reach `clear` — while its own note said "questions routed to a founder cannot
      // be listed". A clear verdict here asserts that no founder question and no undecided
      // escalation exists, and half of that population had not been looked at. The symmetric case
      // hid blocked work when only the log was unreadable.
      //
      // This section spans two populations, so it needs both. Splitting it into two sections would
      // also be correct and is the better long-term shape; keeping it whole and refusing to answer
      // is the change that does not move the Founder Inbox around under someone mid-review.
      // Reported by codex on PR #8.
      unavailable:
        model.unavailableNote ||
        (!log.ok || !channel.ok
          ? `this verdict spans two populations and one is unreadable — ${[
              log.ok ? '' : `board: ${log.note} (blocked work cannot be listed)`,
              channel.ok ? '' : `channel: ${channel.note} (questions routed to a founder cannot be listed)`,
            ]
              .filter(Boolean)
              .join('; ')}. An empty inbox has not been earned`
          : ''),
      note: [
        log.ok ? '' : `${log.note} — blocked work cannot be listed`,
        channel.ok ? '' : `${channel.note} — questions routed to a founder cannot be listed`,
        channel.ok && !channel.structured
          ? `${channel.from} is the generated Markdown view: escalations that produced no decision cannot be identified from it, because it carries no obligation metadata`
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
      swept: `${rows.filter((r) => r.status === 'blocked').length} blocked ticket(s); ${channel.ok ? `${channel.messages.length} message(s) from ${channel.from}` : 'no readable channel'}`,
      clearNote: 'nothing is blocked, no question is waiting on a founder role, and no escalation is undecided',
      items,
    }),
  ];

  return {
    id: 'inbox',
    title: 'Founder Inbox',
    status: rollUp(sections),
    // The count a founder actually reads. Derived from the same list, so the badge cannot disagree
    // with the page under it.
    count: items.length,
    sections,
  };
}

// ---------------------------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------------------------

/**
 * `node:sqlite` is stdlib from Node 22.5 and would give the control room an indexed projection of
 * the log. It is a PROJECTION either way: the log stays the source, so its absence costs speed and
 * nothing else. Reported rather than silently branched, because "which read path produced this
 * page" is exactly the kind of thing that should never be invisible.
 */
function sqliteAvailability() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const available = major > 22 || (major === 22 && minor >= 5);
  return {
    available,
    node: process.versions.node,
    mode: 'jsonl-scan',
    note: available
      ? 'node:sqlite is available on this Node; the control room still scans the JSONL log, because the log is the source and an index is only worth building when a scan is measurably too slow'
      : `node:sqlite needs Node 22.5+ and this is Node ${process.versions.node} — the control room scans the JSONL log directly. The log is the source of truth either way, so nothing is missing`,
  };
}

function assembleStateRaw(root, { actions = true } = {}) {
  const boardSource = readSource(root, REL.board);
  const logSource = readSource(root, REL.log);
  const log = loadLog(logSource);
  const { rows, byId, from } = buildRows(boardSource, log);
  const channel = readChannel(root);
  const roster = readRoster(root);
  const bugs = readBugsFile(root);
  const rounds = readRounds(root);

  const model = {
    rows,
    byId,
    from,
    log,
    channel,
    roster,
    bugs,
    rounds,
    // If neither input produced a ticket, every board-derived section is CANNOT EVALUATE — not clear.
    unavailableNote: rows.length
      ? ''
      : `no tickets: ${boardSource.ok ? `${REL.board} has no parseable ticket table` : boardSource.note}; ${
          log.ok ? `${REL.log} folds to 0 tickets` : log.note
        }`,
  };

  const screens = [missionControl(model), communications(model), boardScreen(model), teamScreen(model), founderInbox(model)];

  return {
    generatedAt: new Date().toISOString(),
    project: root,
    readFrom: from,
    runtime: sqliteAvailability(),
    sources: [
      { id: 'board', path: REL.board, ok: boardSource.ok, note: boardSource.note },
      { id: 'board log', path: REL.log, ok: log.ok, note: log.ok ? '' : log.note },
      { id: 'channel', path: channel.from || REL.messageLog, ok: channel.ok, note: channel.note },
      { id: 'roster', path: REL.roster, ok: roster.ok, note: roster.note },
      { id: 'bugs', path: REL.bugs, ok: bugs.ok, note: bugs.note },
      { id: 'rounds', path: REL.rounds, ok: rounds.ok, note: rounds.note },
    ],
    // Tamper evidence on the board log. A rewritten `approved` is the cheapest way to bypass a
    // failed gate, and a control room that showed the state without saying whether the log still
    // hashes would be reporting a forgery as fact.
    chain: logSource.ok ? verifyChain(logSource.text) : { ok: false, reason: logSource.note, chained: 0, unchained: 0 },
    violations: log.violations.map((v) => ({ line: v.event._line, reason: v.reason })),
    actions: actions ? Object.keys(ACTIONS) : [],
    actionForms: actions ? actionForms() : {},
    screens,
  };
}

/**
 * Everything the page shows, with credentials stripped.
 *
 * One choke point, deliberately — the same reason studio-dashboard has one. A redaction applied at
 * the renderer is a redaction the JSON endpoint quietly skips, and `/state` is the endpoint people
 * pipe into a file and paste into a ticket.
 */
function assembleState(root, options = {}) {
  const raw = assembleStateRaw(root, options);
  const { text, redacted } = redact(JSON.stringify(raw));
  if (redacted.length) {
    process.stderr.write(
      `control-room: REDACTED ${redacted.join(', ')} from the rendered state. ` +
        'It is still in the source file — find it and rotate it.\n'
    );
  }
  return JSON.parse(text);
}

export { assembleState, assembleStateRaw };
