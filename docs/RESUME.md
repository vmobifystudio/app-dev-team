# RESUME — pick the work up from here

*Written to survive a context reset. If you are an agent or a person starting cold, read this file
first and nothing else until you have.*

**Last updated:** 2026-11-20 · **Branch:** `main` at `c6cf277` (Sprint 7 merged as #47)
**Suite:** 2590 passed, 0 failed · **Mutation anchors:** 443, all unique · **Eval lab:** 7/7 · **Invariants:** 12/12 · **Version:** 3.1.0

## 2026-11-19/20 — fresh audit on main and Sprint 7 (`fix/sprint-7`)

Five fresh reviewers re-audited `main` after PR #46 (`docs/reviews/2026-11-19-fresh-audit.md`): 62
unique findings, 17 High, none caught by the 2331-check suite. Sprint 7 fixed all 62 plus N3/N6
(never closed) and two found on the way (N13, N14) in six tracks U1–U6 — register
`docs/reviews/2026-11-18-sprint-2.md` § Sprint 7 outcome. Biggest changes: one integration-branch
resolver read from the committed doc; the wave lands `merged_head` and a new `rework` event routes a
failed wave back through review; gate file lists see renames; QA evidence must be on the integrated
build with the full P0 journey set; `unblocked`(needs-approval)/`corrected` are token-gated; adopt only
on an absent anchor; one wrapper table for both hooks; preflight no longer refuses every IC; test.sh
never edits the plugin in place. Still unproven: a real agent-spawned run on the reinstalled plugin.

## 2026-11-17 — the end-to-end review (`fix/e2e-review-sweep`)

An end-to-end walk of `/app-run` → init → plan → build → ship, each defect reproduced against a
scratch project before it was fixed. What it found, plainly:

- **The review-verdict hook never fired.** Claude Code names plugin agents `app-dev-team:code-reviewer`
  and the hook matched only `code-reviewer`. It also disarmed itself on its own refusal text and let a
  hand-typed verdict line through. Fixed; a verdict now has to pass `board.mjs verify`.
- **The build loop stalled after round one.** Preflight went stale after the first board move and the
  first merge, and `project-profile.json` was never filled in. `/app-build` now re-snapshots every
  round, and `/app-plan` hands the profile to `devops-engineer`.
- **`/app-ship` could never pass.** Nothing wrote the runtime result its readiness check reads.
  `runtime-gate.sh --record` writes it, and `/app-ship` now re-checks the built candidate before the
  release audit.
- **The merge gate checked the wrong commit.** `approval-check --ticket` with the branch tip.
- **No agent could actually use a skill** — none had the `Skill` tool. All 30 do now; spawners gain
  `Agent`, five reviewers gain `Write`.
- **Prose that pointed at nothing:** a nonexistent `run-ledger.mjs list`, "increment Cycles", a
  promise that `release-manager` uploads (it never does), a deleted role's name.
- **The docs caught up:** README, HANDBOOK, CONTRIBUTING, CHANGELOG and `knowledge/README.md` now
  match the tree (30 roles · 27 commands · 32 skills · 9 packs, both dashboards, both corpora).
- **More fixed in the same pass:** the destructive-git hook now tokenises the command (quoted text,
  heredocs, `-C`/`-c`, `cd X &&`, chains) instead of substring-matching it, so it stops blocking
  `grep "git add -A"` and commit-message heredocs and starts blocking `git -C . reset --hard`,
  `git push origin +main` and friends; the cross-worktree hook resolves symlinks and `..`; the kill
  switch is seen from worktrees and subdirectories; `decisions.md` is append-only rather than
  immutable; brownfield gets a founder record; `qa-engineer` declares the P0 journeys; audit
  findings reach the register `ship-gate` reads; `security-reviewer` has its utility privacy mode.
- **2026-11-18 five-lens expert review** (`docs/reviews/2026-11-18-expert-review.md`, every
  finding): a literal agent still could not reach Gate 2. Fixed in Phase 1 — Jest/Vitest/pytest/go/
  Gradle now count as a suite that ran and zero tests never pass; app-init creates the repo, ignores
  the studio's operational files and commits the planning docs; dirty checks ignore those files;
  approvals bind the ticket branch tip, only the latest per role counts, a later commit needs a
  re-review, and `merged` enforces it itself; the default risk policy needs only code-reviewer;
  `QA-` tickets close from `merged`; founder `reopened` past the cycle cap; `closed` needs the code
  on main; leases complete; the review hook wants this cycle's verdict; the orchestrator runs the
  merge gate inline (no tech-manager spawn); tech-manager/code-reviewer cut ~35%; skill
  descriptions <=255 chars; all commands have frontmatter.
  **Phase 2 (done 2026-11-18/19, see below):** split the big shared skills into short cores (IC
  spawn ~15k -> ~4k words); hooks that enforce the spawn/report contracts and persist reports;
  machine-produced gate evidence + signed actors; spec excerpts and a reviewer template in
  spawn-prompt; risk from the actual diff; renumber colliding doc numbers (16/17/72/73).
- **2026-11-18/19 — Phase 2 and six sprints** (register with every finding and its outcome:
  `docs/reviews/2026-11-18-sprint-2.md`). Phase 2 shipped: short skill cores, hooks that enforce the
  spawn/report contracts and persist reports, per-spawn actor tokens (hashes only on disk), gate
  evidence the CLI re-derives itself in a cold worktree, risk from the merged diff, spec excerpts in
  spawn prompts, colliding doc numbers renumbered. A five-lens re-audit (136 findings) and three
  confirmation passes (a literal agent driving every script, plus an adversarial gate probe) drove
  sprints 3–6. Final state: a literal run reaches Gate 2, survives qa_failed -> BUG-fix, lands QA
  tickets on main, and reaches a ship candidate, including a browserless web app with a versioned
  journey waiver; a confused subagent cannot close a ticket without tests that ran and a bound
  review. Accepted bounds are listed in HANDBOOK "What the gates prove and what they don't".
- **Still open:** the new destructive-git tokenizer was only exercised under macOS awk — CI on
  ubuntu is its first mawk run. And everything here was proven by driving the CLI and the hooks,
  not by an agent following the commands end to end; that still needs a real spawned run.

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
| `knowledge/failure-corpus.md` | The seven defect classes this codebase actually produces, and the *tell* for each |
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
