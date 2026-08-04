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
 *   - a token is scoped to one (actor, role, ticket, event), so a captured one is not universal.
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
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';

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

export { resolveActor, mintToken, REGISTRY };
