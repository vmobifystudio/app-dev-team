/**
 * The register's vocabulary and its reducer — the one place either is decided.
 *
 * WHY THIS FILE EXISTS (N4). `portfolio.mjs` reduced `docs/90-register.jsonl` with its own inline
 * `items.set(id, {...prev, ...r})` loop while `register.mjs` had another. Two reducers over one
 * append-only log is precisely the shape `wave-integrate.mjs` refuses for branch resolution in its
 * own comment — *"two resolvers that disagree is worse than either being wrong"* — and this
 * repository has the receipts: `parseBugs` exists because a second reader of the bug board
 * fail-opened, and `lib/board.mjs` exists because a second reading of the board produced the last
 * four fail-open gates.
 *
 * `register.mjs` is a CLI whose top level runs on import, so the shared code could not live there.
 * That is the same reason `lib/board.mjs` and `lib/messages.mjs` are separate from their CLIs.
 */

/**
 * TERMINAL means "somebody decided, and said why". It does NOT mean "fixed" — `DEFERRED` and
 * `WRONG-FINDING` are terminal and are the honest outcomes for most audit findings. What is not
 * terminal is `OPEN` and `IN-PROGRESS`: those are the states in which an item is still owed, and
 * they are what `check` refuses to ship on.
 */
export const OPEN_STATUSES = new Set(['OPEN', 'IN-PROGRESS']);
export const TERMINAL_STATUSES = new Set(['FIXED', 'DEFERRED', 'WRONG-FINDING', 'WONTFIX']);
export const NEEDS_REASON = new Set(['DEFERRED', 'WRONG-FINDING', 'WONTFIX']);
export const ALL_STATUSES = new Set([...OPEN_STATUSES, ...TERMINAL_STATUSES]);

export const registerKey = (id) => String(id ?? '').toUpperCase();

/**
 * Is this terminal status earned? Returns null when it is, or the reason it is not.
 *
 * ONE function rather than two copies of an `if`, because `import-bugs` appended straight to the log
 * and was therefore a SECOND WRITE PATH around both refusals (B3): against the canonical bug row it
 * produced a `WONTFIX` collapsed to `FIXED` with no reason, and a `FIXED` with no ticket — exactly
 * the two states the rules exist to prevent, reachable by another door.
 */
export function terminalRefusal(status, { reason, ticket }) {
  if (NEEDS_REASON.has(status) && (typeof reason !== 'string' || reason.trim().length < 10)) {
    return `${status} requires a reason of substance. Without one it is indistinguishable from ignoring the item, and the whole point of a terminal status is that somebody DECIDED.`;
  }
  if (status === 'FIXED' && !ticket) {
    return 'FIXED needs the ticket whose merge carried it. FIXED is a claim about the integration branch; with no ticket there is nothing to check it against.';
  }
  return null;
}

/**
 * Reduce the append-only log to current state. Last write wins per id, which is what makes a
 * correction a later record rather than an edit — the whole history stays on disk for anyone asking
 * how an item got where it is.
 *
 * @param {string} text  the raw JSONL
 * @returns {{items: Map<string, object>, records: object[], errors: {line: number, message: string}[]}}
 *          `errors` is returned rather than thrown: a caller deciding whether to ship must fail
 *          closed on a half-readable register, and a caller drawing a dashboard must not crash on
 *          one. Both need the same parse and different responses.
 */
export function reduceRegister(text) {
  const records = [];
  const errors = [];
  let lineNo = 0;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    lineNo += 1;
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); }
    catch (e) { errors.push({ line: lineNo, message: e.message }); }
  }
  const items = new Map();
  for (const r of records) {
    const k = registerKey(r.id);
    const prev = items.get(k) || { id: r.id, history: [] };
    items.set(k, {
      ...prev,
      id: r.id,
      kind: r.kind ?? prev.kind,
      title: r.title ?? prev.title,
      severity: r.severity ?? prev.severity,
      owner: r.owner ?? prev.owner,
      ticket: r.ticket ?? prev.ticket,
      evidence: r.evidence ?? prev.evidence,
      status: r.status ?? prev.status,
      reason: r.reason ?? prev.reason,
      history: [...prev.history, r],
    });
  }
  return { items, records, errors };
}

/** The number that decides a release: items nobody has decided about, and how many have no ticket. */
export function undecided(items) {
  const open = [...items.values()].filter((i) => OPEN_STATUSES.has(i.status));
  return { open, untracked: open.filter((i) => !i.ticket) };
}
