# Contributing to app-dev-team

Thanks for your interest. This plugin is a team of Claude Code agents, skills, and commands.
Almost everything here is **Markdown** — agents, commands, and skills are prompt files with
YAML frontmatter. No build step.

## Repo layout

```
.claude-plugin/plugin.json   Plugin manifest
agents/                      One Markdown file per role (the system prompt for that agent)
commands/                    Slash commands (/app-init, /app-run, ...)
skills/                      Reusable procedures agents invoke
knowledge/                   Mobify Studio house knowledge base (mined house conventions)
scripts/                     The few checks that must be deterministic (see below)
docs/                        Design specs and plugin docs
```

## When something may be a script instead of a prompt

Almost everything here is Markdown, and it should stay that way. A script is justified only when
**an agent checking its own work is the thing being fixed** — a correctness gate whose whole value
is that it cannot be talked out of a verdict. Today that is eleven entries, plus `scripts/test.sh`,
the suite that proves them, and `scripts/mutate.sh`, which proves the suite:

- `scripts/board-doctor.mjs` — validates the board before any agent is spawned (Node, no deps)
- `scripts/board-render.mjs` — renders the board for humans, through the same parser
- `scripts/lib/board.mjs` — the one board parser the others share; a second parser is a defect
- `scripts/verify-done.sh` — checks a `DONE` claim against git (POSIX `sh`, no deps)
- `scripts/ship-gate.sh` — the release preconditions, with `scripts/ship-inflight.mjs` reading the board
- `scripts/runtime-gate.sh` — builds and launches the app; the only gate that runs the artifact
- `scripts/integration-branch.sh` — resolves the branch feature work integrates into
- `scripts/team-message.sh` — appends to the team ledger with the anti-ping-pong guard enforced
- `scripts/team-doctor.mjs` — validates the plugin's own agents, commands and skills
- `scripts/spawn-gate.sh` — refuses a parallel launch whose writing agents have no worktrees
- `scripts/round-journal.mjs` — one JSONL line per round, and the loop's budget ceiling
- `scripts/mutate.sh` — breaks each gate on purpose and reports which assertions failed to notice

Eleven is not a licence to add a twelfth. Each one earned its place by being a rule an agent had
already talked itself out of at least once — `spawn-gate.sh` most literally: the isolation rule was
prose for a release, and then the person who wrote and defended that prose spawned two writers into
one checkout and lost 22 files (DR4-027). **When a rule has been broken by the operator best placed
to remember it, prose is the wrong medium. Make it a command with an exit code.**

## Model tiers

A role's default tier lives in its agent file's `model:`. Two rules move off it:

- **Blast radius sets the default.** Irreversible actions and money paths (`release-manager`,
  `monetization-engineer`) run high; an advisory pass that produces one document can run lower.
- **A retry escalates one tier** — `haiku → sonnet → opus`, capped at opus — on a re-spawn after
  `REQUEST CHANGES` only. A ticket that failed review is by definition harder than it looked. A
  `rejected` verify-done retry does not escalate: nothing was reviewed, so nothing said it was hard.

Rules for any script added here:

1. **No dependencies, no build step, no install.** Plain Node or POSIX `sh`.
2. **A documented manual fallback** in the owning skill, so a vanilla Claude Code install without
   Node still performs the check by hand. The plugin must never hard-require a runtime.
3. **A meaningful exit code**, so a command can gate on it.
4. **A fixture-tested cascade.** Run it against a deliberately broken input and confirm every
   branch fires before you ship it — and add the case to `scripts/test.sh`:

   ```bash
   sh scripts/test.sh        # 410 assertions over committed fixtures, ~1 min, no network
   sh scripts/test.sh -v     # list every passing assertion
   ```

   Fixtures live in `scripts/fixtures/`. Every assertion in the suite corresponds to a defect that
   was really shipped and then found by running the thing; the comments name them, so a change that
   breaks one can see what it is undoing.

5. **Prove your new assertion can fail — with the runnable thing, not by hand.** A test that has
   never failed is indistinguishable from one that cannot, and doing it by hand meant it happened
   when someone remembered. On 2026-07-29 the suite read `385 passed, 0 failed` and a reviewer
   found four assertions that could not go red — including a `grep -E` whose pattern was a *syntax
   error*, so a live CDN URL sat in the page while the check reported green.

   ```bash
   sh scripts/mutate.sh --list        # the catalogue, and what it cannot test, and why
   sh scripts/mutate.sh --only M04    # break one gate, run the whole suite, see if it notices
   sh scripts/mutate.sh               # all 16, ~1 min each
   ```

   `CAUGHT (n assertions)` — the gate bites. `SURVIVED` — the gate can be broken and the suite stays
   green, which is a hole at the same severity as the bug the gate was meant to catch.
   `CAUGHT, but NOT by the assertion written for it` — something unrelated noticed; yours is
   decorative and the next refactor takes the coverage with it.

   **A new gate ships with a mutation proving its assertion bites.** Adding one is a line in the
   catalogue at the top of `scripts/mutate.sh`; `skills/mutation-testing/SKILL.md` has the format and
   the rule for what to do when a gate genuinely cannot be mutation-tested here (declare it in
   `excluded()` — never fake the coverage). CI runs a four-mutation sample on every PR.

6. **Watch what your assertion is actually reading.** One here grepped a rejection report for a marker
   string — and passed with the report empty, because the script echoes the command it is about to
   run and the marker was in the command. It survived the mutation that deleted the behaviour it
   guarded. If a needle can reach the haystack by any route other than the behaviour under test,
   it is not an assertion. This is what `mutate.sh` reports as *CAUGHT, but NOT by the assertion
   written for it*.

## How to add or change a role

1. Copy an existing file in `agents/` as a template — match the frontmatter shape
   (`name`, `description`, `tools`, `model`).
2. Keep the writing concrete and contract-driven: inputs it reads, deliverables it writes,
   the exact `DONE:` / `BLOCKED:` output contract, and what it must **never** do.
3. If the role does platform work, point it at the right skills under a
   **"Skills you must use"** heading (soft routing — never a hard dependency).
4. Register it in `README.md`'s roster table.

## How to add a command

1. Add a file in `commands/` with frontmatter (`description`, `argument-hint`, `allowed-tools`).
2. Spell out the step list. If it spawns agents in parallel, reference the
   `parallel-orchestrator` skill and launch all agents in a single assistant message.

## Conventions

- Prefer multiple-choice / contract-driven prompts over open-ended prose.
- Agents communicate through files under the target project's `docs/`, never through hidden state.
- Never introduce a hard dependency on an external MCP server — the plugin must run on a
  vanilla Claude Code install.

## Validating

Run the `plugin-dev:plugin-validator` agent (or `/plugin-dev:create-plugin`) to lint structure
before opening a PR.

## Commit style

`type: short summary` (e.g. `agents: add monetization-engineer`). Keep PRs focused.
