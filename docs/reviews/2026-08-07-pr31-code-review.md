# PR #31 code review — wave integration, slots, register, CI status

REVIEW VERDICT: REQUEST CHANGES

Scope: feat/review-verdict-contract..feat/ops-review-wiring

**Head:** `d5422c0` · 3 commits · 36 files · +4414/−220
**Reviewed against:** `docs/reviews/2026-08-07-adversarial-operations-review.md` (OPS-001…014) and
`docs/reviews/2026-08-07-end-to-end-flow-review.md` (EE-001…009), which this PR names as its spec.
**Skills applied:** `defect-hunting` §1, §2, §3, §4b · `house-conventions` (no platform pack —
this repo is the plugin; `docs/02-team-roster.md` names no app platform, so no Axiom auditor was
spawned. N/A: iOS/Android auditors — this branch contains no application code).

---

## 0. What was verified by executing, not by reading

| Claim | Result |
|---|---|
| `sh scripts/test.sh` | **1325 passed / 0 failed** — re-ran in full, no control-room flake this run |
| `sh scripts/mutate.sh --only M38,…,M52` | **15/15 CAUGHT** — every mutation this PR adds does go red |
| `register.mjs import-bugs` round trip against the canonical `qa-engineer` row | **FAILED** — see B3 |
| `wave-integrate.mjs --push` against a two-branch fixture with a remote | **FAILED** — see B1 |
| `ci-status.mjs` armed / unarmed / `--json` exit codes | **contract broken** — see B5 |

The two verification numbers the author asked me to spot-check are real. Everything below is what
survived them.

---

## 1. Does the diff satisfy its spec?

Yes, in coverage. Every S1 in both reviews has a mechanism with an exit code, and the seven fixes
listed in the operations review's STATUS block are all present and all reachable from
`orchestrator round` / `/app-build`. The three known-and-fixed items I was asked to re-check are
correctly fixed: `merge-reconcile`'s `awaitingWave` is right and M48/M49 prove it bites in both
directions; `ci-status` uses `spawnSync` on `integration-branch.sh`; `ship-gate` §3b has no `else`
and does not false-block a docs-only project.

It does not satisfy its spec in **coherence**, which is the thing the second review said was the
whole problem. EE-001's lesson — "I changed the meaning of an existing event and checked only the
consumers I wrote myself" — has been applied to exactly one sibling (`merge-reconcile`) and one
surface (`portfolio`). The others are below.

---

## 2. Blocking

### B1 · `wave-integrate --push` integrates onto the wrong branch and reports success

`scripts/wave-integrate.mjs:307` runs `git merge --ff-only <wave-branch>` with `cwd: ROOT` and
**never checks what `ROOT` has checked out**. `git merge` merges into `HEAD`. The hand-instructions
this same file prints at line 301 get it right — `git checkout $BASE && git merge --ff-only … &&
git push origin $BASE` — and the automated path drops the checkout.

Reproduced end to end on a fixture (`develop` is the declared integration branch; the main checkout
sits on an unrelated branch, which is the ordinary state of an operator's tree):

```
before:  develop = beb20fa   scratch/operator = beb20fa   integration/wave-1 = 11b1fe1
run:     node scripts/wave-integrate.mjs --root . --wave 1 --push
printed: PUSHED develop — one push, one CI run for the wave. Read it next round with ci-status.mjs.
exit:    0
after:   develop = beb20fa   (local AND on origin — unchanged)
         scratch/operator = 11b1fe1   (silently fast-forwarded to the wave)
```

Three separate failures in one path:

1. **The wave never lands.** `git push origin develop` pushes the unmoved local `develop`. Every
   approved ticket in the wave stays unintegrated.
2. **It says it did.** Line 319 prints `PUSHED $BASE` on the strength of `push.ok`, which is true
   for a no-op push. This is `defect-hunting` §4b exactly: the value crosses the boundary, does not
   arrive, and both sides report success. It is also the corollary — an empty push and a lost push
   are indistinguishable here.
3. **It writes to a branch nobody asked it to.** This file's own header (line 151) says *"The main
   checkout may have an operator standing in it… Merging in either is the shared-tree collision this
   whole plugin exists to prevent, committed by the one process that holds every branch at once."*
   The `--push` path is that sentence happening. `agent-isolation` Rule 2's principle — never mutate
   the tree you did not lease — is violated by the one script that quotes it.

Then the downstream: `/app-build` step 5 tells the manager to run the printed
`board.mjs move APP-NNN verified` lines **before** `--push`. Those set `verifiedStatic = false`
(`lib/events.mjs:376`) while status stays `qa` (`STATUS_PRESERVING`, line 69). So next round
`awaitingWave()` is false, `merge-reconcile` blocks with *"the board is lying"*, and the loop
deadlocks — EE-001 re-created from a **green** wave.

`--push` has **no test and no mutation**. `scripts/test.sh:7891` asserts only `NOT PUSHED`, the
absence of the behaviour. The fixture is always checked out on `main == $BASE`, so even adding a
push test to it would not have found this (defect-hunting §3, step 2: a benign fixture passes on
broken code).

**Fix.** Do not merge in `ROOT`. Push the wave branch at the base ref directly and update the local
ref from the result:

```js
const push = gitTry(['push', 'origin', `${WAVE_BRANCH}:${BASE}`], { cwd: ROOT });
```

and before printing `PUSHED`, assert the fact rather than the command's exit status:
`git rev-parse BASE === git rev-parse WAVE_BRANCH`. If you keep the local ff, refuse unless
`git -C ROOT symbolic-ref --short HEAD` equals `$BASE` and the tree is clean. Add a mutation
(`const push = ... :BASE` → `BASE`) and a fixture whose checkout is *not* on the base — that is
the case the current fixture structurally cannot produce.

---

### B2 · The dependency guard still treats the `merged` event as the fact

This is the sibling the brief predicted, and it is the one that matters most.

`scripts/lib/events.mjs:526-529`, the `claimed` guard:

```js
const unmet = state.dependsOn.filter((depId) => {
  const dep = tickets.get(key(depId));
  if (!dep) return true;
  return !dep.events.some((e) => e.event === 'merged');
});
```

`merged` is now **permission**. Under the wave model a ticket carrying a `merged` event has its code
on an unmerged feature branch, and after a failed or deferred wave it may never reach the
integration branch at all. So `board.mjs move APP-002 claimed` is permitted, `dispatch-preflight`
passes, and `worktree-slot.mjs lease` cuts the slot **from the integration branch**
(`worktree-slot.mjs:152-161`) — a tree that does not contain APP-001's work. The developer is asked
to build on an API that is not there.

The same reading is in `orchestrator.mjs:176-179` and `:303-306`
(`!['qa','done'].includes(dep.status)`), and `orchestrator.mjs:191` prints the giveaway:

```
NOT ACTIONABLE — depends on APP-001, not yet merged
```

The string is correct about the *old* meaning and now describes the state it lets through.

This is the identical defect class as EE-001 (FC-001, "the fix that lands in one mechanism and stops
before its sibling"), in the reader whose entire job is to police ordering. The wave model's own
`verifiedStatic` signal resolves it the same way `merge-reconcile` was resolved: a dependency is met
when it is `done`, or when it is `qa` **and not** `verifiedStatic`. Fix it at the choke point in
`lib/events.mjs` — both `orchestrator` sites read the same reduced state and should call one shared
predicate, not re-derive it twice. Then mutate it.

---

### B3 · `register.mjs import-bugs` is a second write path around both of this PR's own refusals, and it loses the bug

`import-bugs` is the register's only seeding path (`/app-build` step 1 runs it every round). Three
defects, all executed:

**(a) The title is the wrong cell.** Line 298 takes the last non-empty cell of the row. The canonical
template in `agents/qa-engineer.md:80` is
`BUG-NNN | Ticket | Severity | Platform | Steps | Expected | Actual | Build | Resolution`, so the
last non-empty cell is the *Resolution*, or when that is blank, the *Build*:

```
input:  | BUG-001 | APP-001 | S1 | iOS | tap Save twice | one row | two rows | 1.0.3 (42) | |
output: BUG-001   OPEN   bug   S1   1.0.3 (42)
```

The steps, the expected and the actual are gone. The comment immediately above this line says it was
written to fix exactly this — *"a title nobody can read is the row that gets skipped, which is the
failure this file exists to close, reproduced inside its own migration path"* — and it ships a title
that is a build number. Take the cell by index from the declared template, not by position from the
end.

**(b) `FIXED` with no ticket, bypassing M39's refusal.** `cmdStatus` refuses `FIXED` without
`--ticket` (line 196) and M39 proves that refusal bites. `cmdImportBugs` appends `status: 'FIXED'`
directly (line 302) with `...(b.ticket ? {ticket} : {})`. Executed: a row with the word `FIXED` and
an empty Ticket cell imports as terminal, unattributed, and `check` reports CLEAR on it.

**(c) `WONTFIX` becomes `FIXED`, bypassing M38's refusal.** `parseBugs.closed` is
`/\b(FIXED|CLOSED|WONTFIX)\b/`, and the importer collapses all three to `FIXED`. So a bug the team
decided not to fix is recorded as fixed, with no reason, in the register whose entire argument is
that a terminal status means *somebody decided and said why*. Executed: BUG-002 (`WONTFIX`) →
`status: "FIXED"`, no `reason`.

Route the importer through the same validation `cmdStatus` applies — one code path, not two. That is
also the smaller diff.

---

### B4 · The disk leak was moved out from under its own ceiling

OPS-006's quantification is *"an iOS project's worktree… carries its own DerivedData — commonly
1–3 GB per configuration… tens of gigabytes"*. `build-env.sh` correctly moves DerivedData, the
Gradle home and the SwiftPM cache to `.studio-cache/` at the top level. `worktree-reap.mjs` then
measures and caps **only** `.agent-wt/` (`POOL_PREFIX`, line 107; `finalMb` from `rows`, line 230).

Two independent searches, per §4's "not found" rule: `grep -rn 'studio-cache\|STUDIO_CACHE'` across
the repo returns only `build-env.sh`, `.gitignore`, `verify-done.sh`'s comment and three doc lines —
no reader, no `du`, no ceiling. And `grep 'max-disk\|diskKb\|du -sk'` in `worktree-reap.mjs` shows
every measurement scoped to the pool prefix.

So the 5 GB ceiling now guards the *small* half of the resource it was written for, and the large
half is unbounded, uncounted and never mentioned by any gate — including `orchestrator round`, which
blocks on the ceiling. The reaper's header even says this out loud and reads it as reassurance:
*"three iOS slots with warm DerivedData sit well under it once `build-env.sh` moved the caches OUT
of the worktrees."* They sit under it because they are no longer measured.

Either include `.studio-cache/` in `totalMb` (with its own reporting line, since it is a cache and
its removal costs a rebuild, not work), or add a second ceiling for it. A ceiling that cannot see
the thing that fills the disk is `defect-hunting` §3: a green rule that stops people looking.

---

### B5 · `ci-status.mjs` breaks the line-1 / exit-code law

`skills/board-doctor/SKILL.md:128` states it as house law: *"Three outcomes, and the headline word
on line 1 always matches the exit code."* Executed:

```
unarmed:  line 1 = "CI STATUS: CANNOT EVALUATE — branch main"   exit 0
armed:    line 1 = "CI STATUS: CANNOT EVALUATE — branch main"   exit 2
unarmed --json: {"state": "CANNOT EVALUATE", "armed": false}    exit 0
```

The same holds for `FAIL`. It *does* say so — but only in a prose block eight lines down, and only
in non-`--json` mode. `verify-done.sh`'s own comment is the precedent: *"the headline says CANNOT
EVALUATE, because an agent reads line 1 and acts on it, and this used to say VERIFIED."* This is
that, inverted.

`orchestrator.mjs:372-380` carries the headline, which is a good mitigation for the one wired
caller — and it is a mitigation in the wrong place. The house pattern already exists two files over:
`dispatch-preflight.mjs` lets `contention-check` exit 2 honestly and decides non-fatality **at the
composer**. Do the same: `ci-status` reports its real state and its real exit code, and
`orchestrator round`'s step table marks the `ci` step advisory when `requireCiGreen` is unset. That
also removes the fragile `/^[A-Z ]+STATUS: /` scrape.

M42 does not cover this: it mutates `process.exit(ARMED ? code : 0)` → `process.exit(0)` and is
asserted only on the **armed** path.

---

### B6 · `worktree-slot.mjs` ships an undocumented bypass on the guard its own header calls "the guard that matters"

Line 127: `if (mine && !flags.force)`. The header (lines 124-126) says the second-lease refusal *"is
the guard that matters: it is exactly the 'two orchestrators both hand out work' window that
`parallel-orchestrator` closes for tickets with `claimed`, applied to the tree the work happens
in."* `--force` is in no usage line, no header, no exit-code block, not in `agent-isolation`, not in
`app-build.md`, and has no mutation. M44 mutates the **pool cap** (line 138), not this.

Either document it with the same weight the guard is documented with — what it costs, who may use
it, and why — or delete it. An undocumented flag that turns off the one collision guard in the slot
model is how DR4-027 happens again.

---

## 3. Non-blocking

- **N1 · `qa` still means "shipped" in five untouched readers.** `trace.mjs:311` (*"has shipped code
  (a ticket at done/qa)"*), `studio-dashboard.mjs:389`, `control-room/state.mjs:63`,
  `messages-render.mjs:59`, `board-doctor.mjs:106` (*"it shipped on an unconfirmed assumption"*).
  None is load-bearing the way B2 is, but all five now overstate to a founder, and EE-007's fix went
  to `portfolio.mjs` alone. Fix them as one sweep with a shared predicate, per §4's "a sweep is not
  done until a rule prevents recurrence".
- **N2 · `wave-integrate` picks a branch arbitrarily when a ticket has several.**
  `mine[0]` (line 129) with `allBranches` computed and never printed; and `already` (line 127)
  skips the ticket entirely if *any* matching branch is an ancestor of the base. A ticket with
  `feat/APP-001-login` and `fix/APP-001-retry` can integrate the wrong one, or silently none. The
  match is a case-insensitive `includes`, so `APP-1` also matches `feat/APP-12-…`. Report the
  ambiguity instead of resolving it, which is what this file does correctly everywhere else.
- **N3 · The kept wave worktree is in `os.tmpdir()`.** On failure and on CANNOT EVALUATE the script
  sets `keep = true` and tells you *"`integration/wave-N` is kept so the merged tree can be built
  somewhere that has the toolchain. It is checked out at /var/folders/…"*. That path is outside
  `.agent-wt/`, so `worktree-reap` never counts it and never reports it, and the OS may purge it —
  removing the one artifact the message exists to preserve. Put the integration worktree in
  `.agent-wt/integration-wave-N` so the reaper can see it and its dirty check protects it.
- **N4 · `portfolio.mjs` reimplements the register reducer inline** (the diff's `items.set(id, {...prev, ...r})`
  loop) rather than importing one from `register.mjs`. Two reducers over one append-only log is the
  shape `wave-integrate`'s own comment refuses for branch matching (*"two resolvers that disagree is
  worse than either being wrong"*). Export `load()`'s reduction and use it.
- **N5 · `messages.mjs open` mis-pairs escalations.** `escalations.push(...raised.slice(decided))`
  counts *every* `decision` on the thread as closing an escalation, including one that answered a
  question. A thread with one question, one escalation and one decision reports zero unclosed
  escalations. M51 mutates the exit wiring, not the pairing, so the arithmetic is unproven.
- **N6 · `register.mjs`'s header exit-code block is false for the subcommand ship-gate calls.** It
  says *"2 CANNOT EVALUATE — the register is missing or unreadable. Never an empty register"*;
  `cmdCheck` uses `load({ required: false })` and returns 0 on a missing file. That softening is
  correct (it is the 36-false-blocks fix) — the header now contradicts it. Say per-command what the
  codes mean.
- **N7 · `register.mjs` diverges from `board.mjs` on two conventions without arguing it.** No ID
  shape validation (`board.mjs` enforces `APP-NNN`) and no role validation on `--by`/`--owner`
  (`lib/capabilities.mjs` exists and is not consulted). The closed status vocabulary, the atomic
  append, the generated Markdown view and correction-by-appending are all correctly matched — these
  two are the gaps.
- **N8 · `app-build.md` step 1b hand-parses JSON in the runbook.**
  `messages.mjs open --json | tr -dc '0-9:,{}"a-z ' | sed -n 's/.*"open": *\([0-9]*\).*/\1/p'` is a
  greedy regex over prose summaries. Add `messages.mjs open --count`, which is one line, and delete
  the pipeline.
- **N9 · `worktree-reap`'s liveness rationale is now stale.** *"`qa`/`done`/`blocked`/`todo` do not
  need one — a merged ticket's work is on the integration branch"*. Under the wave model a `qa`
  ticket's work is **not** on the integration branch. The behaviour is still safe (branch refs
  survive and the dirty check holds), so this is a comment fix, not a code fix — but it is the exact
  belief that produced EE-001 and it is still written down as true.

---

## 4. EE-002 — instruction load

The review filed this as an S1 and this PR does not address it. `commands/app-build.md` is **750**
lines against the 753 the review measured and the 630 it started the day at; `agents/tech-manager.md`
is 431 against 442/365. Net movement on an S1: three lines.

Judged as asked — the prose that remains does not earn its place, and the specific blocks that
should move are:

| Block | Lines | Where it belongs |
|---|---|---|
| step 5's wave-integrate explanation (exit codes, conflict policy, candidate-list caveat) | ~40 | already verbatim in `wave-integrate.mjs`'s header. Runbook keeps: the command, and a four-row exit table |
| step 4a's reaper rationale ("every terminal outcome, not only a merge", the never-`--force` argument) | ~10 | already verbatim in `worktree-reap.mjs`'s header |
| step 1b's Q&A argument (the "zero times in ten agent-runs" measurement) | ~12 | already verbatim in `messages.mjs`'s `open` docstring |
| the CI paragraph (why round-start, why read-only, why opt-in) | ~10 | already verbatim in `ci-status.mjs`'s header |

Every one of those is duplicated prose, not new prose — which means moving it costs nothing but a
deletion, and the *why* survives at the place the reader is already standing when they need it. That
is this repository's own stated convention (`verify-done.sh`'s forty-line header is cited as the
precedent by the review itself).

Not blocking, because the review is right that shortening a runbook in a hurry is how the reasons
get re-litigated. But the PR that files EE-002 as an S1 and then adds 120 lines to the file has to
say what it is doing about it, and the CHANGELOG does not.

---

## 5. What was checked and cleared

- `verify-done.sh --static`: exit-code contract correct — line 1 says `CANNOT EVALUATE`, exit 2,
  mutually exclusive with `--docs-only`, refuses a test command, and routes to the one event that
  refuses `closed`. M43 proves the label bites.
- `merge-reconcile.mjs`'s `awaitingWave`: correct, and M48/M49 prove it fails in **both** directions
  — a pending wave does not block, a real `verified` with an unmerged branch still does. This is the
  best-tested change in the PR.
- `ship-gate.sh` §3b: the missing-`else` reasoning is right and is argued from the prior mistake.
  M46's assertion greps `block "the register has item` against a `note` mutation, which is a
  behaviour difference, not a shared string — the fix to the M46 problem held.
- `worktree-reap`'s never-`--force` rule and the dirty-orphan report: correct, and M40 proves it.
  Removal is opt-in behind `--apply`, `orchestrator round` calls it without, and `dirty()` treats an
  unreadable tree as dirty. DR4-027's bar is met **for the pool**; B1 is where it is not met.
- `build-env.sh`: the honest `ADVISORY` labelling of `STUDIO_DERIVED_DATA` and the `--check`
  subcommand are the right answer to "an exported variable nobody reads is a rule that cannot fail".
  Not sourcing with `set -u` and not `mkdir -p`ing are both correctly argued.
- Append atomicity: `register.mjs` and `worktree-slot.mjs` both use `withFileLock`, matching
  `board.mjs` / `messages.mjs`.
- `dispatch-preflight`'s `requireTicketFiles`: opt-in, refuses at dispatch with the exact repair
  command, M47 proves both the unarmed pass and the armed refusal.
- No new banned constructs, no debug output, no dead code introduced beyond N2's `allBranches`.

---

## Not checked

Stated because an unstated gap reads as a cleared one.

- **No agent was spawned.** Every finding here came from reading the diff and from executing scripts
  by hand against scratch fixtures. Whether an agent following the 750-line `app-build.md` reaches
  these same steps in this order is exactly EE-002's open question and this review does not answer
  it either.
- **`--push` was executed against a local bare remote only.** No GitHub, no Actions, so
  `ci-status.mjs`'s `gh run list` success paths (PASS, FAIL, waiver match, in-flight) were never
  reached — only the `gh` failure path. The waiver logic, the `GREEN` set
  (`success|neutral|skipped`) and the "newest run first" assumption about `gh run list` ordering are
  **read, not run**.
- **No toolchain.** `wave-integrate`'s `CANNOT_RUN` / `RAN` regexes were exercised only against the
  suite's `echo`-based fixture commands. Whether they classify a real `xcodebuild` or `gradlew`
  failure correctly is unverified here, and `mutate.sh --list`'s own exclusion block already says
  the same about `runtime-gate.sh`.
- **`.studio-cache/` was never populated.** B4 is a claim about what nothing measures, established
  by two greps; the actual size of a warm iOS cache was not measured.
- **Cross-platform consistency: N/A.** This branch contains no application code, so there is no
  iOS/Android pair to compare. The Axiom auditors and the Android convention pack do not apply.
- **`control-room/`'s five screens, `studio-dashboard.mjs` and `/app-audit`** were read only for
  their status vocabulary (N1). Their rendering was not reviewed.
- **The remaining 37 catalogued mutations (M1–M37)** were not re-run; only this PR's 15.
- **OPS-005's slot model was not exercised with a real multi-ticket owner.** The suite leases a slot
  and checks the directory exists; nothing has yet had one agent cut two branches inside one slot,
  which is the behaviour the whole model rests on. That is E5 from the operations review and it is
  still not run.

---

## Next

Developer to revise. B1 and B2 are the two that must land before this merges — B1 because a green
wave currently integrates nothing and says it did, B2 because it is the same defect class this PR
was written to close, in the reader that decides work order. B3–B6 are each under thirty lines.

Each blocking finding needs a mutation that goes red, per `defect-hunting` §3 and this repository's
own rule — and for B1 that means a fixture whose checkout is **not** on the integration branch,
because the existing one structurally cannot produce the failure.
