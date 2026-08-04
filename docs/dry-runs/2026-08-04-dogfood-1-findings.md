# Dogfood run 1 — findings

Date: 2026-08-04
Hypotheses committed before the run: `docs/dry-runs/2026-08-04-dogfood-1-hypotheses.md`
Scope reached: ticket intake and DISPATCH. The run stopped before any agent was spawned, because
dispatch itself could not be completed — which is the finding.

## Summary

The run never reached the code-writing stage. Getting ONE ticket to the point of dispatch took
**eleven consecutive failed invocations**, each revealing exactly one more missing argument. That is
not a usability complaint; it is an orchestration defect with a specific, dangerous shape, described
in DF1-002 below.

Two hypotheses resolved, one of them in a worse way than predicted.

---

## DF1-001 — `contention-check` is not called by anything (H1 CONFIRMED)

**Predicted.** The detector was written earlier today and I expected it to be unwired. It is.

```
$ grep -c "contention" scripts/dispatch-preflight.mjs scripts/scheduler.mjs
scripts/dispatch-preflight.mjs:0
scripts/scheduler.mjs:0
```

Called by hand it works exactly as designed — STUDIO-001 and STUDIO-002 both declare
`scripts/lib/args.mjs`, and with STUDIO-001 in flight:

```
$ node scripts/contention-check.mjs --ticket STUDIO-002   # exit 1
CONTENTION: BLOCKED — STUDIO-002 overlaps work already in flight.
  STUDIO-001 (in_progress, ios-developer) also touches: scripts/lib/args.mjs
```

But nothing in the dispatch path asks it, so in a real wave both tickets would have been dispatched
into the same file. **A detector nobody calls is FC-002 with extra steps**: it cannot fail, because
it never runs. The PR that introduced it said so in its "Not checked" section; this run is the
execution that proves it rather than the claim that asserts it.

**Fix:** compose `contention-check` into `dispatch-preflight`, gated by policy like its siblings.

---

## DF1-002 — dispatch-preflight discloses its contract one argument at a time, and every failure is exit 2

**Not predicted. This is the more serious finding.**

Reaching a dispatch decision for a single ticket required eleven invocations:

| # | refusal |
|---|---|
| 1 | `--root is required` |
| 2 | `--context is required` |
| 3 | `--schedule is required` |
| 4 | `--capability is required` |
| 5 | `--risk is required` |
| 6 | `--operation is required` |
| 7 | `--path is required` |
| 8 | `--file is required` |
| 9 | `context-manifest.mjs failed: no manifest at /tmp/ctx.json` |
| 10 | `context-manifest: at least one --source is required` (the manifest step has the same shape) |
| 11 | still not dispatched |

Two things make this more than friction.

**Every one of these exits 2 — CANNOT EVALUATE.** In this studio's own contract that means "the gate
could not run", and the documented posture toward a gate that cannot run is to record it and, in
several paths, degrade rather than stop. So the failure mode is not "the orchestrator gets stuck":
it is **an orchestrator concluding that preflight is unavailable on this host and proceeding
without it**. A missing argument and a broken environment are indistinguishable at the call site.
That is DR4-001 — a harness fault reading as an environment fault — inside the gate that authorises
every agent spawn.

**A human gets a staircase; an agent gets a wall.** I had the whole repository open and it still
took eleven tries. An agent with a fixed retry budget would exhaust it, and what it learns on the
way is nothing: each refusal names one flag and hides the other seven.

**Fix:** validate all required arguments in one pass and report the complete missing set; and
distinguish `2` (cannot evaluate — the environment) from a distinct code for `the caller's
invocation is malformed`. Those are different facts and only one of them justifies degrading.

---

## DF1-003 — the ticket contract is satisfiable but the dispatch contract is undiscoverable

`board.mjs add` is self-describing: one usage line, and a refusal names the legal alternatives.
`dispatch-preflight.mjs` — the gate that stands between a ticket and an agent — has no usage output
at all, and its ten required arguments are documented only in `commands/app-build.md` prose.

The asymmetry matters because the board is the mechanism agents use most often and dispatch is the
one they use at the highest stakes.

---

## DF1-004 — the shipped capability manifest declares no roles, so the studio cannot dispatch in its own repo

`docs/team/capabilities.json` ships as `{"schema": "capability-manifest/v1", "roles": []}`.
`capability-check` correctly refuses every role against it — fail-closed, which is right — but the
consequence is that no agent can be dispatched in this repository at all until someone seeds it.

Not a defect in the checker. It is a gap between what the plugin SHIPS and what its own workflow
NEEDS, and it is invisible until you try to run the workflow here. Seeded during this run.

## DF1-005 — capability paths resolve against the MANIFEST'S directory, silently (audit P0-04, confirmed live)

`capability-check.mjs` resolved `allowed_paths` against `resolve(dirname(manifestPath), manifest.root || '.')`.
With no `root` declared — as shipped — that base is `docs/team/`, so a manifest granting `scripts`
to a developer refused `scripts/lib/args.mjs`:

```
capability-check: android-developer is outside allowed paths: ../../scripts/lib/args.mjs
```

The refusal contains its own explanation and nobody reads `../../` as a configuration bug.

**It fails in both directions.** Observed here it refused legitimate work. A manifest authored
against the other assumption would GRANT paths nobody meant to grant — in the gate that decides what
an agent may write.

Fixed by requiring `root` to be declared: an undeclared root is now CANNOT EVALUATE, because
guessing which of two plausible bases the author meant is precisely the guess that produced this.
The same move as the eval manifests and the disposition field — an inferred thing became a stated
one.

## Hypotheses, scored honestly

| # | Hypothesis | Result |
|---|---|---|
| H1 | contention fires, or proves it is unwired | **CONFIRMED — unwired** (DF1-001) |
| H2 | worktree isolation holds under load | **NOT REACHED** — no agent was spawned |
| H3 | every event stamped `insecure-local` | **CONFIRMED so far** — both `created` events and the `claimed` event are `insecure-local`; zero `attested`. Attestation is built and unadopted, as predicted. |
| H4 | at least one non-cosmetic REQUEST CHANGES | **NOT REACHED** |
| H5 | board survives with an intact chain | **HELD** for the events written: `board.mjs verify` clean, `board-doctor` reports no divergence |
| H6 | off-domain cost visible in code quality | **NOT REACHED** |

Three of six unreached. **The run stopping early is itself the result** — the orchestration layer
could not get a well-formed ticket to a well-formed agent, and no amount of agent quality would have
compensated.

---

## What this run says about the twelve invariants

Nothing it says contradicts them, and that is the point worth sitting with. The conformance suite
passes 12/12 and every one of those checks is behavioural. **None of them asks whether the studio's
own commands can be driven in sequence by something that has not read the source.**

The invariants measure whether state is trustworthy. This run measured whether the machine is
*operable*, and found it is not — by a margin that eleven failed calls makes impossible to argue
with. Both are necessary; only one was being measured.

That is the thirteenth thing nobody thought to measure, and it took a real run to find, exactly as
the dogfooding argument predicted.

## Fixed during the run

- **DF1-002** — one pass, complete missing set, and exit **64** (`EX_USAGE`) for a malformed
  invocation, distinct from 2. Eleven invocations became one. A caller that degrades on 2 must not
  degrade on 64, and the message says so.
- **DF1-001** — `contention-check` composed into `dispatch-preflight`. The overlapping dispatch is
  now refused by name. Exit 2 from the detector (ticket declares no files) is reported and does not
  block: most tickets predate `--file`, and blocking them would buy a guarantee the check cannot
  offer anyway. What it must never print is CLEAR, and it does not.
- **DF1-005** — capability manifest root is now required rather than inferred.

## Still open

- **DF1-004** — the shipped manifest has no roles. Decide whether `/app-init` should seed it, or
  whether the plugin repo is simply not a studio project and should say so.
- **H2, H4, H6 remain untested.** No agent was spawned. The tickets are still on the board.

## Next

Re-run. The three fixes above were all in the path between a ticket and an agent, and none of them
was visible to 1045 assertions or twelve green invariants.
