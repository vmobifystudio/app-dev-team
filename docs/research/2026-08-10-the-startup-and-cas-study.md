# Study: `the-startup` and `cas` — what we stole, and what's still on the table

**Date:** 2026-08-10
**Subjects:** `github.com/rsmdt/the-startup` (Claude Code plugin, spec-first/tiered) and
`github.com/codingagentsystem/cas` (compiled Rust orchestrator + MCP memory server)
**Method:** full clone of both, read end to end (README, CHANGELOG, agent/skill definitions, and
for `cas` the hook and verifier source under `cas-cli/src/`). Read-only — nothing in either repo
was modified, and neither repo is a dependency of this plugin.
**Purpose:** the same as the 2026-07-29 `agent-teams-ai` study before it — find what to steal, and
be honest about what we already do better, rather than either dismiss or overrate a comparable.

---

## What actually shipped from this study, same day

Two findings converted straight into `skills/defect-hunting/SKILL.md` (§1b, §3b) and
`agents/code-reviewer.md`'s required-sections line, because both were cheap (a checklist addition,
no new infrastructure) and both were validated by a defect in **our own work from this same
session** — not a hypothetical.

- **§1b — "prove the new code is reachable."** Mined from `cas`'s `task-verifier.md` Step 8.9 ("No
  Dead Code") and Step 8.10 ("Missing Co-Changes"). The trigger case: `control-room/src/ui.tsx`
  exported `VerdictBar`, and nothing imported it — typechecked, built, merged, and only found when
  a real (not stuck) `code-reviewer` pass finally grepped for callers. §1's "enumerate every writer
  and reader" doesn't catch this shape; it assumes the symbol is already wired into something.
  §1b adds the narrower, mechanical question: does anything call this at all.
- **§3b — "a test that cannot fail is worse than no test."** Mined from `the-startup`'s
  `NOISE_TEST` category (tautologies, identity mocks, call-sequence-only assertions, framework
  re-verification). Real gap: every RAN-evidence regex fix this session (H7/H8/H9, three separate
  test-runner output shapes) checked *whether tests ran*, never *whether they could catch
  anything*. §3's mutation-testing discipline already covers guard rules and lint rules; §3b
  extends the same "watch it fail" requirement to ordinary unit/regression tests.

Both are additive to the existing numbered structure (`1b` sits beside `1`, `3b` beside `3`) so
every existing cross-reference (`ic-workflow`, `mutation-testing`, `runtime-gate`, `sprint-planner`,
`database-migration` all cite `defect-hunting §N` by number) stays valid.

---

## What's proposed, not shipped: a builder/verifier information barrier

`the-startup`'s `implement-factory` skill (`plugins/start/skills/implement-factory/SKILL.md:65-70`)
keeps the agent that writes code and the agent that judges it from ever seeing each other's inputs:
the code agent never sees the test scenarios it will be evaluated against; the eval agent never
sees the source diff or the unit spec; failure feedback routed back to the code agent is filtered
to a one-line summary, never the raw scenario text or eval output.

**We don't have this, and it's a real gap, not a nice-to-have.** Our `code-reviewer` reads the same
impl spec the `android-developer`/`ios-developer` worked from, and the developer typically writes
its own tests against its own understanding of that spec. This is exactly the shape that produces
"wrote the test to match the bug" — a test that passes because it encodes the same misunderstanding
as the code, which no amount of re-reading the diff will catch, because the diff is internally
consistent. It is a different failure class from everything `defect-hunting` already covers: §1 is
about a second write path elsewhere in the codebase; §3/§3b are about a rule or test provably unable
to fail; this is about the *reviewer's own information* being contaminated by the same source that
produced the bug.

### Why this is a proposal and not a same-day change

The other two items were checklist additions to an existing skill file — zero new infrastructure,
validated same-session, safe to ship immediately. This one is a real workflow change: it needs a
new artifact (acceptance criteria rephrased as black-box scenarios, authored *before* implementation
starts, not derived from the impl spec after the fact) and a new or repurposed role to consume it
without seeing the implementation. Rushing that into existence in the same sitting as two checklist
edits is exactly the "ship it and hope" pattern this studio's whole culture exists to refuse — a
proposal that hasn't been dry-run is worth exactly as much as a rule nobody watched fail (§3).

### Sketch, for whoever picks this up

1. `tech-lead`'s impl spec already names acceptance criteria per ticket. Add a required companion:
   scenario descriptions phrased entirely in terms of observable behavior (inputs, actions, expected
   outcomes) — no implementation detail, no file names, no function names. This can be authored
   alongside the impl spec, by the same role, since the contamination this guards against is
   reviewer-side, not authoring-side.
2. The developer gets the impl spec as today. It does **not** get the scenario file.
3. `code-reviewer` (or a new narrower role, if `code-reviewer`'s existing access to the diff makes a
   true barrier impossible within one agent) evaluates the scenarios against the built behavior —
   running the app/API/CLI and checking outcomes, not reading source — before it ever opens the
   diff for the rest of its existing `defect-hunting` pass.
4. Failure feedback back to the developer is the scenario's plain-language failure, not the
   reviewer's internal reasoning about *why* — mirroring `the-startup`'s one-line-summary filter, so
   a retry doesn't just receive a hint shaped like the fix.
5. **Prove it before trusting it**, per this codebase's own repeated lesson: plant a ticket where the
   spec and the "obviously correct" implementation share the same wrong assumption, and confirm the
   scenario-only reviewer catches it where a spec-reading reviewer wouldn't. If it doesn't move the
   needle in that dry run, the barrier isn't earning its complexity and shouldn't ship.

---

## For calibration: where we're already ahead of both

Recorded here so this study doesn't read as one-directional. Full detail in the session's own
review report; the headline findings:

- **Neither system enforces parallel-agent isolation the way `worktree-slot.mjs` does.**
  `the-startup` asserts independent units "can run in parallel" with no worktree/branch-per-agent
  mechanism in its implementation skill — one shared branch, all code agents in the same tree,
  exactly the collision class our own dry run measured (two independent tickets, one shared tree,
  8-file add/add conflicts, ~50% of one agent's budget burned redoing already-correct work).
  `cas` does isolate via git worktrees, but shows no measured evidence of what that isolation
  actually prevents — we have the dry-run write-up.
- **`the-startup`'s `/validate` gate is explicitly advisory** ("doesn't block you") while marketed
  under "Quality Gates." Every gate we treat as load-bearing — `verify-done.sh`, `board-doctor.mjs`,
  the board's own `closed` transition refusing an unverified ticket (see `scripts/lib/events.mjs`'s
  `case 'closed'`) — is a hard refusal, specifically because this codebase already learned that an
  advisory rule gets ignored.
- **`cas`'s verification records a self-assigned confidence score (0.0–1.0) from the same LLM doing
  the verifying**, with no calibration shown against real outcomes — precisely the kind of
  unverified number this codebase's CANNOT-EVALUATE / no-fabricated-numbers stance refuses to trust.
- **Plain-text, git-diffable state vs. opaque storage.** Our board and log are Markdown + JSONL,
  readable and `git diff`-able directly, with hash-chain tamper detection surfaced in the control
  room. `cas`'s memory/tasks/rules live in a local SQLite db requiring its own CLI to inspect; `cas`
  is also a funded product with a Stripe/Supabase/Sentry-backed cloud tier threaded through its
  CHANGELOG, not a comparable pure local dev tool.

---

## Open item

The builder/verifier barrier above is unscoped work — no ticket, no owner, no dry run yet. It stays
here until someone picks it up; do not treat this document as "done," and do not cite it as a
shipped mitigation.
