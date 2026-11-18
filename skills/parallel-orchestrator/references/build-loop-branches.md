# /app-build — the rare branches

`commands/app-build.md` names this file at the step where each branch occurs. Read the one section
the step sends you to; nothing here runs on an ordinary round.

## Step 0 — a project with a hand-written board and no event log

Migrate once before `orchestrator round`, then continue as normal:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" migrate docs/31-board.md --out docs/31-board-events.jsonl \
  && node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" render
```

Announce how much it reconstructed as `inferred` (`ts: null`) — events the hand-written board never
recorded, so `/app-status` metrics are thin for tickets that predate the log. Never replace an
inferred `ts: null` with a plausible timestamp. If migrate exits non-zero the board is too old to
reconstruct: say `LEGACY BOARD: no event log`, use `board-doctor` as the authority for the rest of
the run (reading `docs/31-board.md` directly; the readiness rule is identical), and do not strand
the project over it.

## Step 3 — per-ticket tests when `fast` is genuinely scoped

`--static` is the default per-ticket lane. Still run tests per ticket when `fast` is genuinely scoped
(`./gradlew :module:test`, `swift test --filter Unit`) **and** `build-env.sh --check` says the caches
apply — then it costs seconds and buys the developer earlier feedback:

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> "$BASE" fast
```

`fast` and `full` resolve from `docs/team/project-profile.json` (F6); never hardcode a command. If
`fast` is really the whole matrix, it is not a fast scope — use `--static` and fix the profile. A
scope the profile does not declare is **exit 2, with nothing substituted**: a default test command
would make "the tests ran" true of a command nobody chose. Projects with no profile keep passing a
literal command.

## Step 3 — `verify-done` exit 2 has two causes

The script names which in its output; read it rather than assuming.

- *No test command was supplied for a code ticket.* Nothing verified the "all green" claim. Supply
  the project's test command and re-run, or `--docs-only` if the ticket really has no test.
- *A test command was supplied and the toolchain could not run it* — no SDK, no simulator, a missing
  wrapper. **Re-running cannot fix this**, and the work is not defective. Record what happened and
  let review proceed on inspection:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN verified_static \
    --by tech-manager --detail "<the toolchain reason, verbatim from verify-done>"
  ```

  The ticket can be reviewed, approved and merged, carries `qa (static only) — NOT RUN: the
  executable test suite` until something runs it, and **cannot reach `done`**. Say `CANNOT
  EVALUATE` in the standup and name what never ran. An exit-2 handler that only knows "supply a test
  command and re-run" leaves review unreachable in exactly the case the static lane exists for.

## Step 4 — the review-cycle cap and the founder's extra cycle

**Cap: 2 review cycles, enforced at write time.** The 3rd `changes` is **refused**; the CLI appends
`blocked` in its place and prints the dependents that just stopped being claimable. Stop the loop for
that ticket and surface it to the user with the full reviewer + developer history. Do not auto-retry.
If the founder decides it is worth one more cycle, that answer is recorded as:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN reopened --by founder --detail "<the founder's reason>"
```

It moves the ticket back to `in_progress` with exactly one more cycle; re-spawn the owner from there.
Only the founder's answer writes it — never append it on your own judgement.

## Step 4 — a `high`-risk merge needs a second approval

The default risk policy needs only the `code-reviewer` approval. A `high` ticket (auth, privacy,
credentials, migrations) also needs `tech-lead`'s: when `merged` refuses with `missing: tech-lead`,
spawn `tech-lead` with the ticket, the branch and the reviewer's verdict file — its role file says
how it records the second approval.

## Step 4 — utility tier

On a `utility` roster the same loop runs with less ceremony: `code-reviewer` also runs the design-QA
pass (there is no `ux-architect`), its approval is the only one, and the wave's `QA-` ticket is
closed straight from `merged`. `tech-manager` is spawned only for planning, the standup, an
escalation, or a semantic conflict between two tickets; never per ticket.

## Step 5 — runtime gate on a product type the script does not detect

`backend-service`, `web-app`, `cli` and `library` reach exit `2` structurally. Record
`N/A: runtime gate — product type <type> is outside runtime-gate.sh's detection` and run the
equivalent for the type — service starts and answers a health check, page renders, `--help` exits 0,
library builds and passes its suite — quoting the output. An N/A that replaces the check with
nothing is a skip wearing a label.

## Step 5 — journey-gate drivers

```
android  scripts/drivers/android.sh   drives adb + uiautomator; needs a device or emulator
ios      scripts/drivers/ios.sh       launches and screenshots; step execution needs XCUITest
```

Always pass `--driver`: a gate invoked without one makes every declared journey CANNOT EVALUATE for a
reason nobody can see. With no device attached either driver returns CANNOT EVALUATE naming the
missing thing — the correct answer, not a pass. Exit `1` means the product is wrong, not the
harness; do not re-spawn a developer against a broken driver.

## Step 5 — the QA ticket

The wave number is in the ID (`QA-<sprint>-w<n>`), not only the title: step 5 runs once per wave, so
a fixed `QA-<sprint>` collides on the second wave — `add` refuses the duplicate and `claimed` is
refused on the moved row, and QA falls back to an untracked errand.

A QA return with no `Branch:`, or a branch `verify-done` cannot find, is **REJECTED** — re-spawn QA to
redo the pass on a branch. Files appearing in the working tree are not evidence that a QA pass
happened; documents with no branch, commit, ticket or fragment are invisible to the board, the
doctor, `verify-done` and the merge gate.

## Step 6a — the journal fields

`--verified-static` gives the round budget teeth: `round-journal.mjs check` (run at step 0) blocks once
that count has stayed above zero and non-decreasing for 3 consecutive reported rounds. Read it from
step 0's `VERIFIED STATIC — N ticket(s)` line; omit the flag if that line did not print — 0 tickets
is a reading, no line is not. Add `--spend-usd` only if the harness actually reported a number;
otherwise the field stays `null`, which every reader prints as "not measurable here".
`docs/31-board-events.jsonl` records what happened to tickets; `docs/33-rounds.jsonl` what happened
to the loop.
