/**
 * actor/v1 — who is asserting this, and may they?
 *
 * WHAT WAS WRONG. Every consequential event in this studio accepts `--by <role>`: an unauthenticated
 * string. The system checks SEPARATION between role names — the same name cannot approve its own
 * work — and never checks that the caller is entitled to either name. Grep the whole of scripts/lib
 * for auth, attest, sign, token or principal and you get nothing.
 *
 * So separation is avoidable by spelling. One agent supplies `ios-developer` for the work and
 * `code-reviewer` for the approval, satisfies every rule, and no artifact anywhere records that
 * both came from the same process. Waivers and specialist sign-offs have the same authorship as a
 * typo. Model, host, session and delegation provenance are not durable facts about a decision;
 * they are not facts at all.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT. This is not enterprise identity. It is a signed
 * envelope with an actor id, the roles that actor may assert, and an HMAC over the event, verified
 * against a per-project registry. Zero dependencies, one file, no network — the studio must keep
 * working offline on a laptop.
 *
 * THE BOUND THAT ACTUALLY MATTERS, AND WHICH THIS FILE ORIGINALLY FAILED TO STATE. The secrets live
 * in plaintext in `docs/team/actors.json`, INSIDE THE TREE AGENTS READ. So against the threat model
 * this studio actually has — a semi-trusted LLM agent with Read — any agent that can read that file
 * can mint a token for any role in it, including code-reviewer and founder. The security reviewer
 * demonstrated it: read the file, call mintToken, get a valid approval.
 *
 * That is sound cryptography with the key stored inside the attacker's reach. It bounds NOTHING
 * against a hostile agent. What it does bound, honestly:
 *
 *   - a CONFUSED agent cannot assert a role by spelling it, which is the common failure;
 *   - every event records whether its role was proven or merely asserted, so history stays readable;
 *   - an HMAC token is scoped to one (actor, role, ticket, event, ts), so a captured one is not
 *     universal. (This is the HMAC mode only. The per-spawn tokens below are scoped to ROLE + TICKET,
 *     not to an event — see C3G-16 there.)
 *
 * The earlier version of this comment bounded itself against "enterprise identity" and never
 * against "the caller can read the key" — which is the bound that decides whether the mechanism is
 * real here. Overclaiming in a docstring is how a team comes to believe a control holds.
 *
 * SO THE SECRET NOW COMES FROM THE ENVIRONMENT FIRST — `STUDIO_ACTOR_SECRET_<ACTOR_ID>`, set by
 * whatever spawns the agent, which the agent has no tool to read. The registry field is a kept
 * fallback for a single-machine local operator, and every event records `key_source` so the two
 * regimes are distinguishable forever rather than by inference.
 *
 * With `key_source: "env"`, `attested` means the role was proven. With `key_source:
 * "registry-file"`, it means the caller could read a file — still useful against a CONFUSED agent,
 * still worthless against a hostile one, and now it says which.
 *
 * TWO MODES, AND THE DIFFERENCE IS NEVER BLURRED:
 *
 *   insecure-local   the default. No token required. Every event is STAMPED `actor_mode:
 *                    "insecure-local"`, which is a permanent, machine-readable admission that the
 *                    role on it was asserted, not proven.
 *   attested         `requireAttestedActors: true`. A token is required, verified, and bound to
 *                    the event's content. An unproven role is refused.
 *
 * The stamp is the point. A local convenience that is INDISTINGUISHABLE from a verified decision is
 * how "we'll turn on auth later" becomes an audit log nobody can rely on retrospectively — every
 * historical approval would be permanently ambiguous. Marking each event with the regime it was
 * created under means switching the flag on tomorrow does not retroactively launder yesterday.
 *
 * ---------------------------------------------------------------------------------------------
 * PER-SPAWN CAPABILITY TOKENS (G-F1, 2026-11-18) — the mode new projects default to.
 *
 * The HMAC mode above has a key every agent can read (the registry file) or inherit (the session
 * environment: a subagent inherits it). So it bounds nothing against an agent that reads files.
 * A token mode whose proof is NOT on disk:
 *
 *   board.mjs actor mint --role code-reviewer --ticket APP-7 [--ttl-minutes 240]
 *
 * is run by the ORCHESTRATOR (the main session). It prints a random 192-bit token ONCE and stores
 * only sha256(token) + role + ticket + expiry in `docs/team/actor-tokens.jsonl`. The token goes
 * into that one agent's spawn prompt and nowhere else. Under `requireActorTokens: true` in
 * .studio-policy.json every GATE event (capabilities.mjs GATE_EVENTS: verified, verified_static,
 * rejected, approved, changes, merged, qa_passed, qa_failed, closed, reopened) needs `--token`
 * whose hash is in the registry, unexpired, unrevoked, minted for exactly this --by role and this
 * ticket. Reading the registry yields hashes, which mint nothing. Spelling a role yields nothing.
 *
 * Separation of duties survives: roles are still checked against history (events.mjs workedOn),
 * and additionally the TOKEN that appears on a ticket's claimed/done_reported/verified/approved
 * events may not be the one that writes its approved or qa_passed (events.mjs).
 *
 * THE RESIDUAL BOUND — read this before trusting the mode:
 *   - The orchestrator's context holds every token it minted. Anything that can read that context
 *     (a transcript reader, a compaction summary, a log of the spawn prompt) can reuse an
 *     UNEXPIRED token for its role and ticket. Expiry (default 4h) and `actor revoke` bound it;
 *     nothing here prevents it.
 *   - `actor mint` is a CLI. A subagent with Bash can run it, and can append a forged hash line to
 *     the registry, because it is the same OS user in the same tree. What stops that is a
 *     PreToolUse hook refusing `actor mint` and registry writes from subagent contexts (hook input
 *     carries agent_id) — Track B's hook, not this file. Without that hook this mode stops a
 *     CONFUSED or LITERAL agent cold and makes a hostile one take a deliberate, logged step
 *     (every mint is a line with its session) — it does not stop the hostile one.
 *   - C3G-16: A PER-SPAWN TOKEN IS SCOPED TO (role, ticket), NOT TO AN EVENT. QA's token for APP-7
 *     can write qa_passed OR qa_failed on APP-7 (and any other gate event capabilities.mjs lets
 *     qa-engineer write); a reviewer's can write approved OR changes. The bound is the role's
 *     capability row on that one ticket, for the token's lifetime — not the single event the spawn
 *     was for. Event-scoping would need one token per possible outcome in each prompt.
 *   - C3G-15: the main session (the orchestrator) mints for every role, so it can clear every gate
 *     of a ticket by itself; separation of duties binds ROLES and TOKENS, not the session. And the
 *     required-approval roster comes from docs/team/risk-policy.json, a file in the tree: editing a
 *     rule to `approvals: []` before a ticket is planned drops the specialist requirement (board.mjs
 *     refuses a DELETED policy, not an edited one — the edit is in git and reviewable).
 *   - Nothing in the environment tells a subagent from the main session (both see the same
 *     AI_AGENT / CLAUDE_CODE_CHILD_SESSION), so the session marker below is recorded, never enforced;
 *     only the PreToolUse hook's agent_id can tell them apart.
 *   - Work events (claimed, done_reported, review_requested…) need no token; a token passed on
 *     one is verified and stamped, which is what lets token-level separation see the author.
 *   - Once any event on a board was written with tokens required, a later policy that no longer
 *     requires them is refused for gate events (board.mjs): turning the flag off is not a
 *     downgrade an agent can make by editing .studio-policy.json.
 *   - Tokens are never read from the environment: subagents inherit it.
 *
 * FOUNDER TOKENS (G2-14). `reopened` is the founder's override of the review-cycle cap, and
 * `actor mint --role founder` was a CLI any orchestrator or subagent could run. Now a founder token
 * is minted only by a human at a terminal: stdin must be a TTY and the human types the ticket id
 * back. The token is short-lived (default 30 min) and SINGLE-USE (board.mjs refuses a founder
 * token_id already on the log), so pasting it into a `! …` command leaves nothing reusable behind.
 * The founder runs, in their own terminal (Claude Code's Bash tool and `!` give the process no TTY):
 *     node "<plugin>/scripts/board.mjs" actor mint --role founder --ticket APP-NNN
 * then, in Claude Code:   ! node "<plugin>/scripts/board.mjs" move APP-NNN reopened --by founder --token <it>
 * BOUND: a hostile agent can fake a TTY (script(1), expect) and type the id itself. This stops a
 * confused or literal agent cold and makes the hostile one take a deliberate, transcript-visible step.
 *
 * SESSION MARKER (G2-17). Every mint records the Claude Code session it ran in (CLAUDE_CODE_SESSION_ID)
 * and the agent markers the harness exports (AI_AGENT, CLAUDE_CODE_CHILD_SESSION), when present.
 * Recorded, not enforced: what those values mean for a subagent is the harness's, not ours to assume.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync } from 'node:fs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const REGISTRY = 'docs/team/actors.json';

/**
 * The bytes an actor signs. Every field that gives the assertion its meaning is inside: change the
 * ticket, the event, the role or the payload and the signature no longer verifies.
 *
 * Signing only the role would let a captured token be replayed onto any transition — the signature
 * would be valid and the claim it authorises entirely different.
 */
function canonical({ actorId, role, ticket, event, ts }) {
  return JSON.stringify([actorId, role, ticket || '', event || '', ts || '']);
}

function sign(secret, parts) {
  return createHmac('sha256', secret).update(canonical(parts)).digest('hex');
}


/**
 * The signing secret for an actor, and WHERE IT IS ALLOWED TO LIVE.
 *
 * The registry entry's `secret` field is the fallback, not the primary. The primary is an
 * environment variable the SPAWNER sets and the agent never sees:
 *
 *     STUDIO_ACTOR_SECRET_<ACTOR_ID>      (dashes and dots become underscores, upper-cased)
 *
 * That is the whole difference between a control and a decoration here. A secret in
 * `docs/team/actors.json` is inside the agent's read scope, so any agent that can read a file can
 * mint a token for every role the registry grants — the security reviewer demonstrated exactly
 * that. Moving it to the process environment of whatever spawns the agent puts it somewhere the
 * agent has no tool to reach, which is what "a caller cannot invent a reviewer" has to mean before
 * the sentence is worth writing down.
 *
 * The file fallback is KEPT, because a local operator running the studio on one machine with no
 * secret manager is a real and supported case. But its use is recorded on every event it signs, so
 * the two regimes never look alike in history — the same reason `insecure-local` is stamped rather
 * than assumed.
 */
function secretFor(actorId, entry) {
  const key = `STUDIO_ACTOR_SECRET_${String(actorId).replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
  const fromEnv = process.env[key];
  if (fromEnv) return { secret: fromEnv, source: 'env' };
  if (entry && entry.secret) return { secret: String(entry.secret), source: 'registry-file' };
  return { secret: '', source: 'none' };
}

function loadRegistry(root) {
  const path = resolve(root, REGISTRY);
  if (!existsSync(path)) return { ok: false, reason: `no actor registry at ${REGISTRY}` };
  try { return { ok: true, actors: JSON.parse(readFileSync(path, 'utf8')).actors || {} }; }
  catch (e) { return { ok: false, reason: `${REGISTRY} is unreadable: ${e.message}` }; }
}

/**
 * Resolve the actor envelope for an event.
 *
 * Returns `{ ok: true, actor }` where `actor` is the `actor/v1` object to stamp on the event, or
 * `{ ok: false, code, reason }`. `code` is 1 for a refused claim (the caller may not assert this
 * role) and 2 for cannot-evaluate (the registry is missing or unreadable while attestation is
 * required) — a broken identity store must never read as an identity failure.
 */
function resolveActor({ root, role, ticket, event, ts, token = '', actorId = '', requireAttested = false }) {
  const session = process.env.STUDIO_SESSION_ID || '';
  const model = process.env.STUDIO_MODEL || '';
  const delegator = process.env.STUDIO_DELEGATOR || '';

  if (!requireAttested) {
    return {
      ok: true,
      actor: {
        schema: 'actor/v1',
        actor_id: actorId || process.env.STUDIO_ACTOR_ID || 'unattested',
        role,
        // THE ADMISSION. Not a warning that scrolls past — a field on the durable record saying
        // this role was asserted rather than proven. Anything reading history later can tell the
        // two regimes apart forever.
        mode: 'insecure-local',
        session: session || null,
        model: model || null,
        delegator: delegator || null,
      },
    };
  }

  const id = actorId || process.env.STUDIO_ACTOR_ID || '';
  const secret = token || process.env.STUDIO_ACTOR_TOKEN || '';
  if (!id) return { ok: false, code: 1, reason: 'attestation is required but no --actor was given (and STUDIO_ACTOR_ID is unset)' };
  if (!secret) return { ok: false, code: 1, reason: `attestation is required but ${id} presented no token (--actor-token, or STUDIO_ACTOR_TOKEN)` };

  const registry = loadRegistry(root);
  // Exit 2, not 1. A missing or corrupt registry means we cannot tell whether the claim is good —
  // reporting that as "you are not authorised" would send someone to fix their permissions when
  // the real problem is a missing file. DR4-001 at the identity layer.
  if (!registry.ok) return { ok: false, code: 2, reason: `${registry.reason} — cannot evaluate whether ${id} may act as ${role}` };

  const entry = registry.actors[id];
  if (!entry) return { ok: false, code: 1, reason: `${id} is not in ${REGISTRY} — an unregistered actor cannot assert any role` };

  const allowed = Array.isArray(entry.roles) ? entry.roles : [];
  if (!allowed.includes(role)) {
    // THE INVARIANT, IN ONE LINE. This is what "a caller cannot invent a reviewer or a founder"
    // means operationally: the role must be granted to this actor in advance, by someone editing
    // the registry, not chosen at the moment of the assertion.
    return { ok: false, code: 1, reason: `${id} may act as [${allowed.join(', ') || 'nothing'}] and is not granted "${role}"` };
  }

  const { secret: signing, source } = secretFor(id, entry);
  if (!signing) {
    return { ok: false, code: 2, reason: `no signing secret for ${id}: set ${`STUDIO_ACTOR_SECRET_${String(id).replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`} in the spawner's environment, or add one to ${REGISTRY} for local use` };
  }
  const expected = sign(signing, { actorId: id, role, ticket, event, ts });
  const given = Buffer.from(String(secret));
  const want = Buffer.from(expected);
  // Constant-time, and length-checked first because timingSafeEqual throws on a length mismatch —
  // a throw here would be an unhandled crash on the most obvious wrong input there is.
  const good = given.length === want.length && timingSafeEqual(given, want);
  if (!good) {
    return { ok: false, code: 1, reason: `${id}'s token does not authorise "${event || 'this event'}" on ${ticket || 'this ticket'} as ${role} — the signature covers the whole assertion, so a token minted for something else will not verify here` };
  }

  return {
    ok: true,
    actor: {
      schema: 'actor/v1',
      actor_id: id,
      role,
      mode: 'attested',
      // WHICH KEY STORE SIGNED THIS. `registry-file` means the secret was readable by whatever it
      // authorised, so the signature proves the caller could read a file — not that the role was
      // independently verified. Recording it means a project that later moves to `env` can tell its
      // two eras apart, and an auditor is never left inferring which regime an approval came from.
      key_source: source,
      session: session || null,
      model: model || null,
      delegator: delegator || null,
    },
  };
}

/** Mint the token an actor presents for one specific assertion. Used by tooling and by tests. */
function mintToken({ root, actorId, role, ticket, event, ts }) {
  const registry = loadRegistry(root);
  if (!registry.ok) return { ok: false, reason: registry.reason };
  const entry = registry.actors[actorId];
  if (!entry) return { ok: false, reason: `${actorId} is not in ${REGISTRY}` };
  const { secret: signing } = secretFor(actorId, entry);
  if (!signing) return { ok: false, reason: `no signing secret for ${actorId} (checked the environment, then ${REGISTRY})` };
  return { ok: true, token: sign(signing, { actorId, role, ticket, event, ts }) };
}

// --------------------------------------------------------------------------------------------
// per-spawn capability tokens
// --------------------------------------------------------------------------------------------

const TOKEN_REGISTRY = 'docs/team/actor-tokens.jsonl';
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const linkHash = (prev, rec) => sha256(`${prev}\n${JSON.stringify(rec)}`);

/**
 * Read the token registry, verifying its link chain (each line's `hash` covers the previous line's
 * hash and its own content), so an edited or deleted line — a quietly un-revoked token — is a
 * CANNOT EVALUATE rather than a silent change. Appending a forged line is NOT caught here; see the
 * residual bound in the header.
 */
function readTokens(root) {
  const path = resolve(root, TOKEN_REGISTRY);
  if (!existsSync(path)) return { ok: true, records: [], tip: '' };
  let prev = '';
  const records = [];
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  for (const [i, line] of lines.entries()) {
    let rec;
    try { rec = JSON.parse(line); } catch { return { ok: false, reason: `${TOKEN_REGISTRY} line ${i + 1} is not JSON` }; }
    const { hash, ...body } = rec;
    if (hash !== linkHash(prev, body)) return { ok: false, reason: `${TOKEN_REGISTRY} line ${i + 1} does not chain — the registry was edited, reordered or truncated` };
    prev = hash;
    records.push(body);
  }
  return { ok: true, records, tip: prev };
}

function appendToken(root, body) {
  const r = readTokens(root);
  if (!r.ok) return r;
  const path = resolve(root, TOKEN_REGISTRY);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ ...body, hash: linkHash(r.tip, body) })}\n`);
  return { ok: true };
}

/** Who is minting: the session and agent markers the harness exports, when it does (G2-17). */
function mintContext() {
  const env = process.env;
  const pick = (k) => (env[k] ? String(env[k]) : null);
  return {
    session: pick('STUDIO_SESSION_ID') || pick('CLAUDE_CODE_SESSION_ID'),
    agent: { ai_agent: pick('AI_AGENT'), child_session: pick('CLAUDE_CODE_CHILD_SESSION'), entrypoint: pick('CLAUDE_CODE_ENTRYPOINT') },
    tty: Boolean(process.stdin.isTTY),
  };
}

/** A human at a terminal types the ticket id back. `{ok}` or `{ok:false, reason}`. */
/**
 * Read one line from `fd`, blocking. EAGAIN (a non-blocking fd with nothing typed yet) waits 50 ms
 * and retries instead of failing; EOF ends the line.
 */
function readLineBlocking(fd, read = readSync, { maxWaitMs = 10 * 60000 } = {}) {
  const buf = Buffer.alloc(256);
  const nap = new Int32Array(new SharedArrayBuffer(4));
  let line = '';
  let waited = 0;
  for (;;) {
    let n;
    try { n = read(fd, buf, 0, buf.length, null); } catch (e) {
      if (e.code !== 'EAGAIN' || waited >= maxWaitMs) throw e;
      Atomics.wait(nap, 0, 0, 50);
      waited += 50;
      continue;
    }
    if (n <= 0) break;
    line += buf.subarray(0, n).toString('utf8');
    if (line.includes('\n')) break;
  }
  return line;
}

function founderConfirms(ticket, { stdin = process.stdin, read = readSync, openTty = () => openSync('/dev/tty', 'r') } = {}) {
  if (!stdin.isTTY) {
    return { ok: false, reason: 'a founder token is minted only by the human founder at a terminal (stdin is not a TTY here, and an agent Bash call never has one).\n' +
      '  Founder: in your own terminal run\n' +
      `    node "<plugin>/scripts/board.mjs" actor mint --role founder --ticket ${ticket}\n` +
      `  then in Claude Code:  ! node "<plugin>/scripts/board.mjs" move ${ticket} reopened --by founder --token <the token>` };
  }
  process.stderr.write(`Founder override for ${ticket}. Type the ticket id to mint a single-use founder token: `);
  // C3G-10: read the CONTROLLING TERMINAL, opened fresh and blocking. fd 0 of a node process on a
  // real pty is non-blocking, so readSync(0) threw EAGAIN the instant before the founder typed —
  // the mint only ever worked when input was already queued. `openTty` is injectable for tests.
  let fd;
  try { fd = openTty(); } catch (e) { return { ok: false, reason: `could not open the terminal for the confirmation: ${e.message}` }; }
  let line;
  try { line = readLineBlocking(fd, read); } catch (e) { return { ok: false, reason: `could not read the confirmation: ${e.message}` }; }
  finally { try { if (fd !== 0) closeSync(fd); } catch { /* already closed */ } }
  if (line.trim().toUpperCase() !== String(ticket).toUpperCase()) return { ok: false, reason: `confirmation "${line.trim()}" is not ${ticket} — nothing minted` };
  return { ok: true };
}

/** Mint a token for one role on one ticket. The plaintext is returned ONCE and never stored. */
function mintActorToken({ root, role, ticket, ttlMinutes = 240, confirm = founderConfirms }) {
  if (!role) return { ok: false, reason: 'mint needs --role' };
  if (!ticket) return { ok: false, reason: 'mint needs --ticket (a token is scoped to one ticket so a leaked one is not universal)' };
  if (role === 'founder') {
    const c = confirm(ticket);
    if (!c.ok) return c;
    if (ttlMinutes === 240) ttlMinutes = 30;
  }
  const minutes = Number(ttlMinutes);
  if (!(minutes > 0 && minutes <= 24 * 60)) return { ok: false, reason: '--ttl-minutes must be between 1 and 1440' };
  const token = `st_${randomBytes(24).toString('base64url')}`;
  const now = Date.now();
  const record = {
    schema: 'actor-token/v1', kind: 'mint', token_id: sha256(token).slice(0, 16), token_sha256: sha256(token),
    role, ticket: String(ticket).toUpperCase(), minted_at: new Date(now).toISOString(),
    expires_at: new Date(now + minutes * 60000).toISOString(), ...mintContext(),
    ...(role === 'founder' ? { single_use: true } : {}),
  };
  const w = appendToken(root, record);
  if (!w.ok) return w;
  return { ok: true, token, record };
}

function revokeActorToken({ root, tokenId }) {
  const r = readTokens(root);
  if (!r.ok) return r;
  if (!r.records.some((x) => x.kind === 'mint' && x.token_id === tokenId)) return { ok: false, reason: `no token ${tokenId} in ${TOKEN_REGISTRY}` };
  return appendToken(root, { schema: 'actor-token/v1', kind: 'revoke', token_id: tokenId, at: new Date().toISOString() });
}

function listActorTokens(root) { return readTokens(root); }

/**
 * Prove `role` on `ticket` with a token. `{ok, actor}` or `{ok:false, code, reason}`.
 * code 2 = cannot evaluate (registry unreadable), 1 = refused.
 */
function verifyActorToken({ root, token, role, ticket, required = true }) {
  if (!token) return { ok: false, code: 1, reason: 'no --token was given' };
  const r = readTokens(root);
  if (!r.ok) return { ok: false, code: 2, reason: r.reason };
  const want = sha256(token);
  const rec = r.records.find((x) => x.kind === 'mint' && x.token_sha256 === want);
  if (!rec) return { ok: false, code: 1, reason: `that token is not in ${TOKEN_REGISTRY} — it was never minted here (only "board.mjs actor mint", run by the orchestrator, creates one)` };
  if (r.records.some((x) => x.kind === 'revoke' && x.token_id === rec.token_id)) return { ok: false, code: 1, reason: `token ${rec.token_id} was revoked` };
  if (Date.parse(rec.expires_at) <= Date.now()) return { ok: false, code: 1, reason: `token ${rec.token_id} expired at ${rec.expires_at} — mint a fresh one for this spawn` };
  if (rec.role !== role) return { ok: false, code: 1, reason: `token ${rec.token_id} was minted for "${rec.role}", not "${role}" — a token proves one role, and --by cannot change which` };
  if (rec.ticket !== String(ticket).toUpperCase()) return { ok: false, code: 1, reason: `token ${rec.token_id} was minted for ${rec.ticket}, not ${ticket}` };
  return {
    ok: true,
    actor: {
      schema: 'actor/v1', actor_id: `token:${rec.token_id}`, role, mode: 'token', required,
      token_id: rec.token_id, minted_at: rec.minted_at, expires_at: rec.expires_at, ...(rec.single_use ? { single_use: true } : {}),
      session: process.env.STUDIO_SESSION_ID || null, model: process.env.STUDIO_MODEL || null,
    },
  };
}

/**
 * The `--token` argument a PRINTED next-step board command must carry (W2-10/W2-11): the
 * orchestrator's inline mint, in the SAME command, because a shell variable does not survive
 * between Bash calls. '' when the project does not require tokens.
 */
function inlineTokenFlag(root, role, ticket) {
  let policy = {};
  try { policy = JSON.parse(readFileSync(resolve(root, '.studio-policy.json'), 'utf8')) || {}; } catch { return ''; }
  if (policy.requireActorTokens !== true) return '';
  return ` --token "$(node "\${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" actor mint --role ${role} --ticket ${ticket || '<ID>'})"`;
}

export { inlineTokenFlag, founderConfirms, readLineBlocking, resolveActor, mintToken, REGISTRY, TOKEN_REGISTRY, mintActorToken, revokeActorToken, listActorTokens, verifyActorToken };
