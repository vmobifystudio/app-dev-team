# RESUME — pick the work up from here

*Written to survive a context reset. If you are an agent or a person starting cold, read this file
first and nothing else until you have.*

**Last updated:** 2026-07-29 · **Branch:** `revamp/phase-r-fixes` · **Suite:** 503 assertions green

---

## 1. Read these, in this order

| File | Why |
|---|---|
| `docs/HANDBOOK.md` | What the system is, its six beliefs, all roles, the loop. **Part 12 lists what is not finished** |
| `docs/research/2026-07-29-dry-run-4-findings.md` | The register from the first real end-to-end run, plus the team's own review of its revamp. Every finding has a reproduction |
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

### Building now (each in its own git worktree)

- **P4** — evaluation laboratory (`eval/`, `scripts/studio-eval.mjs`)
- **P1** — product-intent loop (founder-intent vault, `product-validator`, `scripts/trace.mjs`)
- **S** — security hardening (capabilities, signed events, redaction, kill switch)

### Not started

- **P3b** minimum control room (5 screens) · **P2** roles on the revised bar · **P3c**
  evidence/design/release rooms · metrics.

  (**P3a** — structured comms backend — is built on its own worktree branch: `docs/team/messages.jsonl`
  as a schema-v1 event log, Markdown generated, message obligations, derived channels, formal
  artifacts, and the anti-ping-pong guard unified into `scripts/lib/messages.mjs`.)
- **P0.3–P0.6**: dry run 5 (full pipeline through `/app-ship`), adversarial runs, proof that release
  cannot be self-approved, evidence bundle. **Deferred by owner decision: finish the code first,
  then validate the complete system rather than an intermediate one.**

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

**Worth installing when needed:** Node 22+ (for the SQLite projection), the frontend toolchain (for
`control-room/`), Xcode (the runtime gate's build/launch paths are the only thing this repo cannot
mutation-test, and that gap is the largest remaining blind spot).

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

1. **Merge the three in-flight worktree branches** (P4, P1, S). Expect semantic conflicts —
   resolve by asking which layer each side fixed, not by picking a side. The `ship-gate` conflict on
   2026-07-29 was two correct fixes on two layers; taking either alone would have lost one.
2. **P3a** — structured comms backend: event schema v1, threads, channels, decisions, questions.
   JSONL now, shaped so the SQLite projection drops in.
3. **P3b** — five screens only: Mission Control · Communications · Board · Team · Founder Inbox.
4. **P2** — roles on the revised bar: a trigger, a contract tier, a spawn site, and a reason it
   cannot be a skill.
5. **P0.3–P0.6** — dry run 5 through `/app-ship`, hypotheses written first; adversarial runs;
   evidence bundle. **Only after this may autonomous release be enabled.**
6. **P3c**, then metrics (DORA/flow/quality) — *after* there is a real pipeline to measure. Metrics
   on a system that has never shipped are theatre.

---

## 6. Standing verification commands

```bash
sh scripts/test.sh                 # the suite            (503 green)
node scripts/team-doctor.mjs       # the team definition  (coherent)
sh scripts/mutate.sh --sample 4    # can the suite go red
sh scripts/mutate.sh               # full run, ~17 min
node scripts/portfolio.mjs         # N projects by attention needed
```

**The one probe that must never regress** — argument injection, from the security review:

```bash
echo SENTINEL > victim.txt
node scripts/board.mjs move APP-001 unblocked --by tech-manager --detail "--board=$PWD/victim.txt"
head -1 victim.txt        # must still read SENTINEL
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

Do not let a green suite convince you otherwise. That is the mistake this entire document exists to
prevent.
