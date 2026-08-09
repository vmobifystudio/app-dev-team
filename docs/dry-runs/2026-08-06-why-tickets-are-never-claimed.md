# Targeted experiment — why is a ready ticket never claimed?

**Committed before the run.** One hypothesis, one stopping condition, no agents.

## The question

11 of 19 tickets across every recorded run ended at `created` — never claimed, never blocked, never
refused. The previous experiment proved the pipeline is completable once a ticket is claimed, so the
failure is upstream of the first transition.

`/app-build` mandates a dispatch gate before spawning any owner:

    dispatch-preflight.mjs --root --ticket --context --schedule --capability --risk
                           --role --operation --path --file [--change]

That is nine required inputs, four of which are manifests that must already exist.

## Hypothesis

**H2: a freshly planned project cannot satisfy `dispatch-preflight`, because the manifests it
requires are not created by any earlier step — so the first dispatch of every project fails and the
tickets stay at `created`.**

If H2 holds, 11-of-19 is a missing-input problem, not an agent-diligence problem, and no amount of
orchestration or agent quality fixes it.

## Method

Create a project the way `/app-plan` would leave it — a board with a ready ticket — then run the
documented dispatch path verbatim. Record the first thing that cannot be satisfied.

## Stopping condition

The first refusal whose remedy is not produced by a documented earlier step. Record it verbatim.

## Result

Recorded below after the run, whatever it says.

---

## Result — H2 HOLDS. The loop was structurally unable to dispatch.

A freshly planned project has **no `docs/team/` directory at all**. The documented dispatch path
dies on the first of four required manifests:

    dispatch-preflight: context-manifest.mjs failed:
    context-manifest: no manifest at .../docs/team/context-manifest.json

`/app-build`'s own rule — "a failed or unavailable check stops the spawn" — then stops the round.
The ticket stays at `created`. Forever.

**No command, agent or skill anywhere names any of the four files.** `/app-context` can create one
and `/app-capabilities` can check one, but they are separate user-invoked commands that the build
loop never calls and never mentions. `/app-plan` did not create them. `/app-init` did not.

**So 11-of-19 was never agent diligence.** Six dry-run reports treated it as behaviour. It was a
missing writer.

## It is FC-005, and the check for FC-005 could not see it

`knowledge/failure-corpus.md` FC-005 — "the check whose own input nobody writes: a rule reads an
artifact that no step in the pipeline produces. It never fires. The Definition of Done cites it,
everyone believes it is covered, and no writer was ever assigned."

That class is mechanised in `team-doctor` as `doc_undeclared` / `doc_unread` — **for `docs/NN-*.md`
artifacts only.** The `docs/team/*.json` manifests feeding the most consequential gate in the loop
were outside its scope. The check written for exactly this failure never looked where it happened.

## Fixed

- `scripts/team-bootstrap.mjs`, run by `/app-plan` step 4b.
- The five manifests added to `team-doctor`'s canonical-path set and documented in `team-protocol`,
  so the next artifact of this shape cannot be added without a writer.

**Proven end to end:** the identical project that could not dispatch now returns
`dispatch-preflight: "status": "CLEAR"`, while a designer writing source, any role writing
`actors.json`, and an undeclared role are all still refused.

## One correction I made mid-run

The first bootstrap wrote `roles: []`, reasoning that closed-by-default is the safe end of the
contract. It is — and dispatch then failed one step later with `role is not declared`: the same
outcome with a better error. **A bootstrap whose output cannot dispatch has not fixed the thing it
was written for; it has moved the stopping point and called it safety.**
