# RESUME — pick the work up from here

*Written to survive a context reset. If you are an agent or a person starting cold, read this file
first and nothing else until you have.*

**Last updated:** 2026-08-06 · **Branch:** `feat/review-verdict-contract` (PR #30, all CI green)
**Suite:** 1240 assertions · **Invariants:** 12/12 · **Version:** 3.0.0

## THE NUMBER THAT MATTERS MOST, AND WHY IT IS AT THE TOP

Across every recorded dry run: **19 tickets created, 1 reached `closed`.** Eleven never left
`created`. That number appeared in no document, no assertion and none of six dry-run reports —
every one of which analysed the QUALITY OF REFUSALS and not one of which counted whether anything
moved.

On 2026-08-06 three targeted experiments explained all of it, in about fifteen minutes, without
spawning a single agent or building an app:

| | | |
|---|---|---|
| **H1** | a ticket can be driven `created → closed` by hand | **HELD** — the pipeline works |
| **H2** | a planned project cannot dispatch at all | **HELD** — the whole of 11-of-19 |
| **H3** | post-merge transitions blocked by a missing artifact | **FALSIFIED** |

**H2 is the headline.** `dispatch-preflight` requires four manifests in `docs/team/`, and on a fresh
project that directory did not exist. Preflight died on the first one, `/app-build`'s own rule
("a failed or unavailable check stops the spawn") stopped the round, and every ticket sat at
`created` forever. **No command, agent or skill anywhere wrote any of those four files.** It was
never agent diligence; the loop was structurally unable to start. Fixed by
`scripts/team-bootstrap.mjs`, run from `/app-plan` step 4b.

Three further defects were found the same day, each by running something rather than reading it:

- **A ticket reached `done` with the code never merged.** `git merge` failed on a dirty tree and the
  board accepted `merged`, `qa_passed` and `closed` anyway. The merge gate is a PRECONDITION that
  runs before any git command by design, so it cannot confirm the merge afterwards — and nothing
  did. Fixed by `scripts/merge-reconcile.mjs`, wired into `orchestrator round` and `ship-gate`.
- **Five scripts were built, tested and invoked by nothing** — including
  `foundation-conformance.mjs`, the twelve-invariant suite, which was in no CI and no command. Now
  a rule: every top-level script must have a caller other than the test harness.
- **The new stall detector was blind to the six tickets it was built to find.** `TERMINAL` included
  `qa`, and all six parked tickets sit at `qa`.

**The lesson, stated plainly because it is the most transferable thing here:** six dry runs spent
days building fixture apps and produced reports whose findings were handed off and never landed.
Three experiments with one falsifiable question each, a stopping condition, and no agents produced
four fixes and a killed hypothesis in fifteen minutes. Engineering rule #2 was written down for
months and never practised.

## What is honestly still open

- **`/app-ship` has never executed against a real submission.**
- **Whether an AGENT following `app-build.md` reaches the same outcomes a careful hand does.** Every
  finding above came from driving the CLI directly. That question needs a spawn.
- **The eval lab's 12/12 is not evidence.** 13 of 15 fixtures name the detector written for them in
  the same session, so it measures "does my grep match my own fixture". Re-baselining needs defects
  from code nobody here wrote.
- **Five of six product defect classes are unmechanised** (`knowledge/product-failure-corpus.md`).
  PF-001 — the user's value discarded on the way to storage — is the highest severity and only
  PARTIAL.
- **12% of assertions are documentary** (`scripts/assertion-census.mjs`), proving an instruction
  exists rather than that anything happens. Kept deliberately — they catch generator/validator
  drift — but the single number "1240 assertions" flatters itself.

> **Everything below §2 was written on 2026-07-30 and much of it is historical.** The arguments hold
> and are worth reading; the state claims do not. §2 and the section above are the only parts that
> describe today.

---

## 1. Read these, in this order

| File | Why |
|---|---|
| `docs/HANDBOOK.md` | What the system is, its six beliefs, all roles, the loop. **Part 12 lists what is not finished** |
| `docs/dry-runs/2026-08-06-*.md` | **The three targeted experiments of 2026-08-06** — hypothesis committed first, result recorded whatever it said. The shortest path to understanding what actually breaks |
| `knowledge/product-failure-corpus.md` | The defect classes the APPS produce, each marked MECHANISED / PARTIAL / REVIEWER-ONLY |
| `docs/25-engineering-rules.md` | The ten rules, each naming its enforcing mechanism **or stating it has none** |
| `docs/research/2026-07-29-dry-run-4-findings.md` | The register from the first real end-to-end run. Historical; every finding has a reproduction |
| `docs/2026-07-29-studio-os-plan.md` | The current plan: review of two improvement plans, position changes, phase order |
| `knowledge/failure-corpus.md` | The six defect classes this codebase actually produces, and the *tell* for each |
| `docs/2026-07-29-revamp-master-plan.md` | The earlier register (RV-NNN) — historical, mostly closed |

---

## 2. Where the work stands

### Shipped and verified (on `revamp/phase-r-fixes`)

Phases 0–8: fail-closed gates · runtime gate · role activation by tier × product type ·
event-sourced board · mid-sprint Q&A · control-room dashboard · spawn gate · CI · portfolio ·
failure corpus with a blocking recurrence flag · mutation testing.

**48 → 503 assertions.** Every finding from the first real run and from the team's own review is
closed and re-probed by execution.

### Open PRs — nothing is on `main` yet

`#2` Phase 0 → `main` · `#3` Phase 1 → #2 · `#4` Phase R → #3. All green, stacked.

**All merged into `revamp/phase-r-fixes` as of 2026-07-30:** P4 (evaluation laboratory) · P1
(product-intent loop) · S (security hardening) · P2 (team expansion on the revised bar) · P3a
(message event log) · **P3b (the control room, five screens, `control-room/`)**.

### CI now proves things it could not prove locally

GitHub Actions billing is on. **Three workflows, and their triggers are a cost decision** — the
expensive two deliberately skip the intermediate PRs of a stacked review, because those stack into
each other rather than into a release.

| Workflow | Runner | Trigger | What it establishes |
|---|---|---|---|
| `checks` | ubuntu | push to main + every PR | the suite, `team-doctor`, `mutate.sh --sample 4`, `studio-eval.mjs` |
| `runtime gate` | **macos-15** | **PRs into main** + dispatch | the runtime gate against real Xcode — FAIL for `eval/crash-on-launch`, PASS for the same fixture repaired |
| `mutation (full catalogue)` | ubuntu | **PRs into main** + dispatch | all 31 mutations, `cancel-in-progress: false` so it can actually finish |

The macOS job closed this repo's largest self-declared blind spot. See §7.

**Do not put a long job behind `cancel-in-progress: true`.** The full catalogue was started four
times and completed zero, cancelled mid-flight by the next push every time. A check that never
finishes reports nothing.

### Not started

- **P3c** evidence/design/release rooms · metrics (DORA/flow/quality).
- **P0.3–P0.6 are HALF done.** The adversarial pass ran: see
  `docs/research/2026-07-30-dry-run-5-findings.md`. **Six of fourteen hypotheses have verdicts.**
  H8, H2 (board layer), H12 and H6 held; **H13 and H7 were falsified** and fixed as DR5-001 and
  DR5-002. H6 held with DR5-003 left open beside it. **H7 is only HALF answered** — the artifact
  contradicting the matrix is fixed, but whether the roles actually spawn per the matrix in a live
  run is still unprobed. The pipeline half — H1, H3, H4, H5, H9, H10, H11, H14 — is untouched,
  including H3, predicted before the run to be among the likeliest
  to fail.

**`/app-ship` has still never executed.** Autonomous release stays disabled until it has.

---

## 3. Tech-stack decisions (settled — do not re-litigate without new evidence)

Installing and upgrading is permitted; tooling is not a blocker. These calls stand on their merits,
not on what happened to be installed.

| Decision | Call | Why |
|---|---|---|
| **Source of truth** | **JSONL append-only event logs** | Git-diffable, human-readable, survives agent death, reconstructible. This is not a workaround for a missing database — an inspectable log *is* the right source of truth for a system whose central claim is that its state can be audited |
| **SQLite** | **Optional projection, never the source** | `node:sqlite` is stdlib from Node 22.5. Use it as a query index for the control room, built from the log, degrading to a log scan when absent. The plugin ships to users whose Node version we do not control (Node 20 is LTS into 2026), so it must work without it |
| **Plugin runtime deps** | **Zero. Node stdlib + POSIX sh only** | A security property, not a style preference — it passed a security review outright. Do not add a `package.json` at the repo root |
| **Control room frontend** | **React + TypeScript + Vite, in its own directory with its own deps** | A real UI is a product; hand-rolling it in one stdlib file does not scale. It lives in `control-room/` so the plugin stays zero-dep |
| **Two dashboards, permanently** | `scripts/studio-dashboard.mjs` = **emergency/diagnostic**, zero-dep, must work when the build stack is broken. `control-room/` = the full product | Never make the only diagnostic interface depend on the stack it may need to diagnose |
| **Transport** | **SSE** | Already in use; activity flows server→browser. Actions are ordinary HTTP |
| **Local-first** | Repos, credentials and evidence stay on the machine | Remote later as a control plane receiving *selected events* — never shell or filesystem access |
| **Shared contract** | `studio-event-schema/v1`, versioned | The plugin must be correct with the UI absent. The UI enhances visibility; it is never required for correctness |

**Worth installing when needed:** Node 22+ (for the SQLite projection) and the frontend toolchain
(for `control-room/`).

**Xcode is no longer on that list — the gap is closed.** It was described here as "the largest
remaining blind spot", and the answer turned out not to be installing Xcode locally but renting it:
the `runtime-gate` job on `macos-15` runs `runtime-gate.sh` against `eval/crash-on-launch` and
asserts **exit 1**, then repairs the single force-unwrap and asserts **exit 0** on the otherwise
identical app. Both executed on Xcode 16.4 with real simulator runtimes. The second assertion is
the load-bearing one; without it the first is satisfied by a gate that fails everything.

---

## 4. The rules that govern all of it

These are earned, not stylistic. Violating one is how every serious defect in this repo happened.

1. **A green signal is evidence only to the extent it could have gone red.** Prove every new
   assertion fails before it passes. `scripts/mutate.sh` makes this mechanical.
2. **When you fix something, ask who else touches this value between the fix and the human.**
   FC-001. It accounts for eleven of sixteen findings in the team's own review, and it recurred
   during a merge on the same day.
3. **Gates fail closed.** `0` clear · `1` blocked · `2` **cannot evaluate**. Exit 2 is never a pass.
4. **Never render an empty panel that reads as all-clear.** State the population you swept.
5. **Isolation is a mechanism, not a convention.** One worktree per writing agent, enforced by
   `spawn-gate.sh`; no repo-wide destructive git, enforced by the PreToolUse hook.
6. **A role is warranted only when it needs independent authority or an independent context.**
   Everything else is a skill, a gate, or an activation variant.
7. **The failure mode must be "honestly blocked", never "falsely complete."**

---

## 5. What to do next, in order

1. **Finish dry run 5 — the pipeline half.** Eight hypotheses have no verdict. Run intake through
   `/app-ship` on a fresh utility-tier project (H1), then H9 (prompt injection planted in a README),
   H10 (conflicting PRD/SRS), H11 (no false PASS with the toolchain absent), H14 (no claim the
   repository contradicts), H3 (`product-validator` against a real PRD), H4, H5.
   **Finish H7 while you are there** — DR5-002 fixed the artifact that contradicted the activation
   matrix, but whether the roles actually SPAWN per that matrix in a live run is still unprobed.
2. **Final review** — the team's own `code-reviewer` and `security-reviewer` over
   `main...revamp/phase-r-fixes`, which is now a very large diff.
3. **Collapse the PR stack** — `#2 → main`, `#3 → #2`, `#4 → #3`, plus everything merged since.
4. **P3c**, then metrics (DORA/flow/quality) — *after* there is a real pipeline to measure. Metrics
   on a system that has never shipped are theatre.

**Only after step 1 may autonomous release be enabled.**

---

## 6. Standing verification commands

```bash
sh scripts/test.sh                 # the suite            (733 green)
node scripts/team-doctor.mjs       # the team definition  (coherent)
sh scripts/mutate.sh --sample 4    # can the suite go red
sh scripts/mutate.sh               # full run, ~17 min — or let the macos CI job do it
node scripts/studio-eval.mjs       # the evaluation laboratory
node scripts/portfolio.mjs         # N projects by attention needed
```

**The one probe that must never regress** — argument injection, from the security review.

⚠️ **The transition must be LEGAL for the ticket's current state.** The version printed here until
2026-07-30 used `todo → unblocked`, which is illegal for every role, so the state machine refused
before `parseArgs` was ever reached — the probe passed without testing anything, for weeks. This is
the failure mode dry run 5 hit twice. **A refusal is evidence only when you know which layer
refused.**

⚠️ **The `add` line below used to read `add APP-001 "probe"`, and that spelling was broken** — the
title is `--title`, so `"probe"` landed in a positional nothing read, the ticket was created with an
empty title, and the command exited 0. The standing probe in the file that says "must never
regress" was itself teaching the wrong invocation. `board.mjs` now refuses an extra positional
rather than discarding it (2026-08-05), so the old line fails loudly instead of quietly.

```bash
echo SENTINEL > victim.txt
node scripts/board.mjs add APP-001 --title probe --by tech-manager
node scripts/board.mjs move APP-001 blocked --by tech-manager --detail "--board=$PWD/victim.txt"
head -1 victim.txt        # must still read SENTINEL — and the move must have EXITED 0,
                          # because a refusal here means you tested the state machine again
```

---

## 7. Honest state of the thing

It is a **verification-oriented engineering pod** that has been run end to end exactly once, and
that run produced zero merged code on a machine with no iOS SDK — correctly, with every gate saying
which one it was and why.

It is **not yet** an autonomous app company. The gap is not features; it is that nine of ten
commands have been exercised once, `/app-ship` never, and the product-intent loop is still closed:
the team writes the spec it implements and tests against. P1 narrows that. Real users remain the
only external oracle.

**What 2026-07-30 changed, and what it did not.** The runtime gate's central claim is now executed
rather than asserted — that is real, and it was the largest self-declared blind spot. Four
adversarial hypotheses have verdicts. Against that: one of the four was **falsified** (DR5-001, the
audit chain guarded the write and not the read, found by probing rather than by review), it was
**FC-001 recurring one day after the rule against FC-001 shipped**, and eight hypotheses remain
untouched. The system's own recurrence flag caught it and blocked — which is the most reassuring
fact in this section, and it is reassuring about the *instrument*, not about the code.

Nine planted defects in the evaluation lab still have **no detector at all**, six of them S1. That
number has not moved.

Do not let a green suite convince you otherwise. That is the mistake this entire document exists to
prevent — and on 2026-07-30 a green suite was, once again, not enough.
