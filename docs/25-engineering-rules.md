# Engineering rules

**Ratified 2026-08-05.** These ten rules were written in
`docs/dry-runs/2026-08-04-medication-companion-operational-audit-and-revamp-plan.md` §20 and lived
only there — inside a dry-run report, which is exactly the shape this repository keeps proving is
not a rule at all. A rule nobody can find is a rule nobody applies. This is the canonical copy.

**Each rule names its enforcing mechanism, or says plainly that it has none.** That second half is
the point. A rule with no mechanism is a convention someone must remember, and this codebase's
defining lesson — DR4-027, dry run 3, and twice more in the session that wrote this file — is that
knowing a rule, having written it, and having defended it does not make you apply it.

| # | Rule | Enforced by |
|---|---|---|
| 1 | No broad dry run until the kernels pass their invariant suites | `scripts/foundation-conformance.mjs` — 12/12 required |
| 2 | A dry run is a targeted experiment, never an app-building project: one hypothesis, one defect class, a fixed budget, a stopping condition | **No mechanism.** Convention, held by whoever plans the run |
| 3 | No finding enters the plan without current-tree reproduction | **No mechanism.** The 2026-08-04 plan applied it by hand and found four audit claims already stale |
| 4 | No score without an executable rubric and denominator | `scripts/studio-eval.mjs` prints its denominator and names what it excluded |
| 5 | No new writer outside the workflow journal without an architecture decision | **Partial** — `scripts/lib/atomic.mjs` forces every writer through one lock, but nothing requires the decision to be recorded |
| 6 | No new schema without registry entry, compatibility fixture, and migration policy | **Partial** — `scripts/schema-registry.mjs check` enforces the *entry*. Fixtures and migration policy are **not** enforced; see below |
| 7 | No gate output without subject identity and provenance | `gate-result/v1` carries `subject`; `lib/readiness.mjs` marks a subject-less verdict STALE |
| 8 | No policy recommendation without enforcement at the governed mutation | I-07, `scripts/lib/events.mjs` — the risk route is a precondition of the append it governs |
| 9 | No control-room calculation that differs from the canonical reducer | I-11, `scripts/lib/readiness.mjs` — one reducer, every surface projects it |
| 10 | No automatic app-store publication | I-12 — no executable path can submit or publish. Constitutional |

## Where rule 6 is deliberately half-kept

`schema-registry.mjs` enforces that every `name/vN` written in `scripts/` is declared, and that no
declared schema has silently vanished. It does **not** require a compatibility fixture or a
migration policy per schema.

That is a considered deviation, not an oversight. Thirty-one schemas exist and exactly **one** has
ever been versioned up (`context-manifest` v1 → v2). A migration framework for thirty schemas that
have never migrated is a large amount of code defending a problem nobody has had — the speculative
generality this codebase already pays for elsewhere.

What the registry does instead is record **who reads each schema**, because that is the question a
migration has to answer first. When a schema genuinely needs a v2, the registry tells you who
breaks; writing the framework before then would be guessing at the shape of a migration nobody has
performed.

**Revisit when:** a second schema needs a version bump, or a bump ships and a reader breaks. Either
event is the evidence this deviation is waiting for.

## Rules 2, 3 and 5 have no mechanism, and that is stated rather than hidden

These three are held by convention today. Listing them as enforced would be the "rule that cannot
fail" pattern — a green checkmark against something nothing checks.

- **Rule 2** is about how a dry run is *scoped*, which is a judgement made before any command runs.
- **Rule 3** was applied by hand on 2026-08-04 and immediately paid for itself: four claims from
  audits written the same week were already false against the tree.
- **Rule 5** is partly structural — `lib/atomic.mjs` means a new writer cannot skip serialization —
  but nothing forces the architecture decision to be written down.

If any of the three recurs as a real defect, that recurrence is the argument for building the
mechanism. Until then they are conventions, labelled as conventions.
