# Targeted experiment — H5: can an agent follow the loop NOW?

**Committed before the run.** One hypothesis, one ticket, one stopping condition. Result recorded
below whatever it says.

## Why re-run this

On 2026-08-06, **H4 failed**: the first agent ever pointed at this loop returned **1 of 6** contract
fields, claimed "no git repo initialized" about a git repository, made no commit, and reported DONE.
`verify-done.sh` rejected it and the board would not advance — the gates worked; the **handoff**
broke.

`scripts/report-check.mjs` was built in response and wired into `/app-build` step 3. **It has never
been measured against the thing it was built for.** A fix for the only recorded failure of this
system's central premise, itself unvalidated, is exactly the shape this repository refuses
everywhere else.

Since then the loop also changed underneath that fix: worktree **slots** replaced worktree-per-ticket,
per-ticket verification became `verify-done.sh --static`, and the merge gate stopped merging. So H4's
result no longer describes the loop that exists.

## Hypothesis

**H5: an `ios-developer` agent, given a leased slot, a ready ticket and its own role file, returns
all six contract fields and leaves the branch in a state `verify-done.sh --static` accepts.**

- If H5 **holds**, the handoff is followable and the remaining risk is orchestration and throughput.
- If H5 **fails**, `report-check.mjs` catches it — which is a working gate and a broken pipeline, and
  it means `/app-run` must not be trusted unattended.

## What would make this a lie

Stated in advance, because the confounder in H4 was found after the fact and owned:

- **No coaching.** The agent is given exactly what `/app-build` step 2 hands an owner: the ticket ID,
  the board row, the spec pointers, its slot path as project root, and the output contract. Nothing
  about *how* to satisfy the contract, and no correction mid-run.
- **The prompt must not name the failure modes H4 hit.** No "remember to commit", no "confirm the
  mutation landed". Those are in `ic-workflow` and `agent-isolation`, which the agent is told to use
  — testing whether it reads them is the point.
- **A real toolchain.** Swift 6.1.2 is present, so the ticket is a genuine build-and-test ticket, not
  a documentation stand-in.

## Method

1. One bootstrapped scratch project: git repo, Swift package that builds and tests, PRD, impl spec,
   `docs/team/` manifests via `team-bootstrap.mjs`, one ready ticket on the board.
2. Lease a slot with `worktree-slot.mjs` — the current isolation shape.
3. `board.mjs move APP-001 claimed`, then spawn ONE `ios-developer` agent.
4. Measure, in this order, exactly as `/app-build` step 3 does:
   - `report-check.mjs --role ios-developer --report <saved report>`
   - `verify-done.sh --static <branch> <base>`
5. Record contract fields returned (n of 6), both exit codes, and whether the board can advance.

## Stopping condition

The agent returns, or the first refusal with no documented remedy. **One agent only** — this measures
contract compliance, not throughput. Throughput is a separate question and conflating them is how six
earlier dry runs produced anecdotes.

## Result — H5 FAILS on the contract, PASSES on the work. 0 of 6 fields.

One `ios-developer` agent, one ready ticket, no coaching. 11 tools, 96 seconds.

**What it got right — and this is a real improvement over H4:**

| | H4 (2026-08-06) | H5 (2026-08-07) |
|---|---|---|
| The code | correct | correct — `return "Hello \(name)"`, matching F-001 |
| Committed? | **no** | **yes** — 1 commit, 2 files, on `feat/APP-001-greet-with-name` |
| A test added? | no | yes — extended the check target |
| `verify-done.sh` | **REJECTED** ("nothing was actually written") | **accepted** — `commits=1 files=2`, exit 2 = the static lane's correct answer |
| Contract fields | 1 of 6 | **0 of 6** |
| Daily fragment | written (wrong path) | **not written** |

So the branch is now in a state the pipeline can advance from — H4's blocker is gone. The **handoff
is still the thing that breaks**, and it broke harder.

**`report-check.mjs` did exactly its job.** It named all six missing fields and what each one would
have silently stopped gating. The gate built after H4 caught the H5 failure on its first real
exposure. That is the one unambiguous win here.

## Confounders — both real, one of them mine

**1. The spawn prompt referenced the contract instead of stating it.** `parallel-orchestrator`
step 4 requires each agent prompt to include *"the expected output contract (`DONE: APP-NNN ...`)"*.
Mine said "Return the CODE profile defined in `team-protocol`" — a pointer. The loop's own
instruction is to inline it, and I did not. That is an orchestrator error, not an agent failure.

**2. A session-level style directive was competing with the contract.** The harness session carried
an active "lazy senior developer" mode whose stated output rule is *"Code first. Then at most three
short lines."* The agent's opening line — *"One-line fix in `greet(name:)`: … → skipped: nothing else
touches this"* — is that template exactly. A user-level style preference silently outranked a role's
output contract.

Confounder 2 is **not** a reason to discount the result; it is a finding in its own right. Any
project-level `CLAUDE.md` or house style can defeat the contract this loop parses, and the only thing
that notices is `report-check.mjs`. That is an argument for the gate, and an argument that the
contract must be in the prompt rather than behind a reference.

---

# H5b — is the contract followable when the prompt actually carries it?

**Committed before the run.**

## Hypothesis

**H5b: given the same ticket and the same slot, with the six-field contract stated VERBATIM in the
spawn prompt as `parallel-orchestrator` step 4 requires, an `ios-developer` agent returns all six
fields and leaves the branch in a state `verify-done.sh --static` accepts.**

- If H5b **holds**, the loop is followable and H5's failure was dispatch, not design. The fix is to
  make the contract impossible to omit from a spawn prompt.
- If H5b **fails**, the contract is too long or too buried to follow even when handed over
  literally, and no amount of orchestrator discipline will fix it — the contract itself needs to
  shrink.

## Method

Identical fixture, reset to the baseline commit. Same role, same ticket, same slot. The ONLY change
is the prompt: the contract block is pasted in. Still no coaching about how to satisfy any field —
naming the fields is what step 4 mandates; explaining them would be teaching to the test.

## Stopping condition

The agent returns. One agent.

## Result — H5b HOLDS, with one false claim caught by verifying rather than reading.

Same fixture, same ticket, same slot. Only the prompt changed: the contract stated verbatim.
15 tools, 101 seconds.

**All six fields returned.** `report-check.mjs`: `CLEAR — returned all 6 contract field(s)`, exit 0.
That is the flip from H5's 0 of 6, and it isolates the cause: **this was a dispatch failure, not a
capability failure.** The agent can produce the contract when the prompt states it, at the same
model, same role file, same ticket, same slot, one prompt-shape apart.

**`verify-done.sh --static`** — `CANNOT EVALUATE: tests=deferred-to-wave`, exit 2. Correct: branch
exists (cut from `main`'s tip, confirmed by `git rev-parse`), 1 commit, 2 files changed. This is the
static lane's designed answer, not a failure.

**The code is right.** `return "Hello"` → `return "Hello \(name)"`, matching F-001. The check target
was extended and genuinely passes — re-run independently, not taken from the report: `2 tests run:
2 passing, 0 failing`.

**But one field was FALSE, and it is the same class of failure H4 found — a claim that reads as done
and is not — surviving into the run built specifically to catch it.**

| Field | Claimed | Verified |
|---|---|---|
| `Daily fragment: docs/daily/2026-08-07-ios-developer-APP-001.md` | present | **the file exists on disk, well-written, but was never `git add`ed or committed — `git status` in the worktree shows it `??` (untracked)** |
| Every other field | as stated | **confirmed independently** — diff numstat matched exactly (+2/-1, 2 files), the second-path check's claim (only two call sites) matched a fresh grep, the branch's parent commit was `main`'s tip before any write |

**Why `report-check.mjs` did not catch this.** It checks that the field exists and is non-empty. It
has no way to check that the path it names is true — that is exactly the gap `agent-isolation`'s
"Mutation confirmed" field exists to close for the code diff, and there is no equivalent confirmation
for the daily fragment. The agent's own `ic-workflow` instruction is explicit: *"commit it with your
change — never to the repo root"*. It wrote the file, in the right place, with real content, and did
not stage it.

## What H5 + H5b together say

1. **The contract is followable when the prompt actually states it.** H5's failure was mine, not the
   model's or the loop's — `parallel-orchestrator` step 4 already says to inline the contract, and I
   did not. The fix is structural: a spawn helper that refuses to launch without the contract block
   present in the prompt, so this cannot be gotten wrong by omission again.
2. **A field being present is not evidence it is true**, and this run reproduced that gap in the one
   field nothing double-checks. `report-check.mjs` closes the presence gap; it does not close the
   truth gap. The fix is small and specific: extend the daily-fragment check to `git show
   <branch>:<path>` rather than trusting the string, mirroring what `agent-isolation` already asks
   of the code diff.
3. **The session-level style directive (confounder 2 in H5) did not reappear here.** With the
   contract stated explicitly in the prompt, the model followed it over the ambient style rule. That
   is mild evidence the fix in point 1 is sufficient on its own — worth confirming with a repeat run,
   not yet a settled fact from n=1.

**Net effect on the rating asked for.** The blocking failure — an agent that cannot produce the
contract at all — is now understood as dispatch-shaped and has a structural fix. A new, narrower
failure was found in the same run: one gate (fragment presence) checks the wrong thing. Two agent
runs is not throughput evidence and this does not establish a passing rate; it establishes that the
contract CAN be followed and names the next gate to build. `report-check.mjs`'s presence check should
be extended before this is trusted further, and H6 (a real multi-ticket sprint, counted) is still the
experiment that would move the needle on the number that was actually asked for.
