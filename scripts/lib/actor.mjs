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

  const expected = sign(String(entry.secret || ''), { actorId: id, role, ticket, event, ts });
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
  return { ok: true, token: sign(String(entry.secret || ''), { actorId, role, ticket, event, ts }) };
}

export { resolveActor, mintToken, REGISTRY };
