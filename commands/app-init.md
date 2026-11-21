---
description: Start a new mobile app project — runs requirements intake, then CEO vision, then PRD + architecture in parallel
argument-hint: [one-line idea, optional] [--yolo to skip the scope-lock gate] [--utility | --flagship to set the tier]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent, Skill
disable-model-invocation: true
---

# /app-init — Kick off a new app project

You are starting a fresh app project. The user's one-liner (if any) is:

> $ARGUMENTS

## Steps

0. **Record the founder's words before interpreting them.** Create `docs/00-founder-intent/` (copy
   `${CLAUDE_PLUGIN_ROOT}/docs/00-founder-intent/README.md` into it), write the user's brief and any
   material they supplied there **verbatim and dated**, then record it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/founder-intent.mjs" --project-root . --write
   ```

   This happens first because everything below is an interpretation of it, and an interpretation with
   nothing to be checked against is what makes this team's loop closed. The directory is append-only:
   never edit a recorded file, add a dated line to `decisions.md` instead.

1. **Run the `requirements-intake` skill** to get a clean `docs/01-intake.md`. If the user's prompt is already detailed, ask only the questions still unanswered.

1a. **Activate the roster.** Invoke the `role-activation` skill: fix the **tier** (`--utility` /
   `--flagship`, else derived from the intake) and the **product type** (from the intake's
   `## Product type` answer), then write `docs/02-team-roster.md` — copy
   `${CLAUDE_PLUGIN_ROOT}/docs/02-team-roster.md` and fill it in from the matrix; every role in the
   activation matrix, each
   `active` / `conditional` / `off` with its trigger or reason.

   **If the product type is unstaffed (`cli`), refuse and stop here** — print the skill's
   `ACTIVATION REFUSED` block naming the missing IC role. Write no roster and spawn nobody. A team
   that cannot build the product is not a lesser start, it is a sprint of stranded tickets.

   Write it **before spawning anyone**. Every fan-out below spawns only `active` roles, and this
   file is what says so; deriving activation again per step is how two steps come to disagree.
   Print the tier, the product type, and the off-list with reasons.

2. **Spawn the `ceo` agent** with the intake and the roster as input. CEO writes `docs/00-vision.md`.
   On `utility` tier the CEO runs the **founder pass** — vision plus the PRD and backlog `cpo` would
   have written — and `cpo` is not spawned at all (its roster row already says why).

2a. **If the roster has `product-researcher` `active`, spawn it now** — after the vision, before the
   PRD. Its trigger is flagship-gated and reads only the intake, so step 1a decides it `active` or
   `off`, never `conditional`. It writes `docs/16-research.md` in its own
   context, and `cpo` in step 3 reads it as an input. Run after scope-lock, research cannot change
   the scope it was meant to test.

3. **Spawn `cpo` and `cto` in parallel** in a single message — they both read `docs/00-vision.md` and produce their respective docs (PRD/backlog and architecture/principles).
   Skip either if the roster has it `off`: on `utility` both are, `cpo` merged into `ceo` above and
   `cto` into `tech-lead` below.

3a. **When both ran, re-spawn `ceo` to arbitrate.** It reads `docs/10-prd.md` and
   `docs/20-architecture.md`, resolves any conflict between them (a P0 the architecture prices at
   months, a constraint the PRD ignores), and appends the resolution to `docs/00-vision.md` as an
   addendum — or writes `no conflicts` there. `ceo.md` has always said it arbitrates after both
   report back; no step ever brought it back, so conflicts reached Gate 1 unarbitrated.

4. **Spawn the `active` roles among `ux-architect`, `tech-lead`, and `devops-engineer` in parallel**
   in a single message, then **`product-designer` once `ux-architect` has returned** — it composes
   the screen inventory `docs/12-flows.md` defines, so launching both together has the designer
   composing screens that do not exist yet. **On `utility` tier `tech-lead` runs first and
   `devops-engineer` is spawned after it returns**: there `tech-lead` writes the architecture
   `devops-engineer` reads.
   - `ux-architect` reads PRD, writes docs/12-flows.md — flows and the screen-and-state inventory.
   - `product-designer` composes that inventory into docs/13-design-tokens.md and docs/14-components.md.
   - `tech-lead` reads architecture + PRD, writes per-platform impl specs — and on `utility` tier
     also writes `docs/20-architecture.md` + `docs/21-engineering-principles.md`, the technical pass
     `cto` would have run. Write only the impl specs for platforms the product type actually has:
     a `backend-service` gets `22-impl-spec-backend.md` and no iOS or Android spec; a `web-app` gets
     `22-impl-spec-web.md` (what `web-developer` reads — it names the `build`, `start` and `test`
     scripts; `devops-engineer`, or the first `web-developer` scaffold ticket, writes them into
     `package.json`), plus `22-impl-spec-backend.md` only if a
     backend is in scope.
   - `devops-engineer` reads architecture, writes `docs/23-git-strategy.md`, a platform
     `.gitignore`, and the CI workflow — seeded from the House KB `git-workflow.md`.
     The `.gitignore` **must include `.agent-wt/`** — that is where per-agent git worktrees live
     (`agent-isolation`), and an un-ignored worktree dir shows up as untracked noise in every
     agent's `git status`.

5. **Bootstrap the project.** First make it a git repository — every later step leases git
   worktrees, and a worktree sees only what is committed:

   ```bash
   git rev-parse --is-inside-work-tree >/dev/null 2>&1 || git init -b main
   touch .gitignore
   for p in .agent-wt/ .studio-stop .studio-cache/ docs/31-board-events.jsonl docs/31-board.md \
            docs/team/runs.jsonl docs/team/runtime-result.json docs/team/journey-result.json \
            docs/team/actors.json docs/team/actor-tokens.jsonl docs/team/reports/ \
            docs/53-reviews/ docs/54-evidence/runtime/ docs/54-evidence/journeys/ \
            docs/33-rounds.jsonl docs/team/evidence/ \
            docs/team/worktree-slots.json docs/team/ship-gate-verdict.json \
            docs/32-board-view.md docs/team/messages.md \
            docs/90-register.jsonl docs/90-register.md docs/team/release-candidates.jsonl; do
     grep -qxF "$p" .gitignore || printf '%s\n' "$p" >> .gitignore
   done
   ```

   That list is the studio's own operational state, appended to whatever platform `.gitignore`
   `devops-engineer` wrote (plus `docs/team/actors.json` and `docs/team/actor-tokens.jsonl`, which hold actor keys and
   per-spawn tokens). Every entry is in `${CLAUDE_PLUGIN_ROOT}/scripts/lib/operational-paths.txt`;
   review verdicts (`docs/53-reviews/`) and evidence records stay uncommitted in the main checkout,
   where the board and the gates read them. **QA evidence bundles stay TRACKED** (R7-4): QA commits
   `docs/54-evidence/<journey>-<build>.md` on its branch, so only the script-written
   `docs/54-evidence/runtime/` and `journeys/` are ignored — ignoring all of `docs/54-evidence/` made
   `git add` refuse every bundle, and release-auditor then marked every test claim unverified.
   The register (`docs/90-register.jsonl` / `.md`) and `docs/team/release-candidates.jsonl` are
   written in the main checkout after init and nothing commits them, so they are ignored too (W7-9):
   as untracked files they made the destructive-git hook treat the checkout as holding uncommitted
   work. The rest of that file (`docs/daily/`, the channel, `schedule.json`, `memory.jsonl`,
   `incidents.jsonl`, `audit-anchor.json`) is tracked on purpose: dirty checks skip it, history keeps it. The
   board log and its rendering live in the main checkout only — a
   `git checkout` must not roll the board back, and ICs get their ticket through the spawn prompt,
   not from the board file. `docs/team/messages.jsonl` and the dispatch manifests stay
   **tracked**: they are project decisions and history a reviewer should be able to read.

   Then generate, seeded from the House Knowledge Base (`${CLAUDE_PLUGIN_ROOT}/knowledge/`) and the
   docs just produced:
   - the target project's **`CLAUDE.md`** — chosen stack, build/run commands, the team's working
     rules, the picked commit convention, and canonical names (so agents never guess);
   - stubs `docs/15-aso.md`, `docs/41-monetization.md`, `docs/52-analytics.md` when those concerns
     are in scope per the architecture;
   - **the team channel `docs/team/messages.jsonl`, if it does not already exist** — an empty
     append-only event log (`team-protocol` defines the schema). `docs/team/messages.md` is
     GENERATED from it by `${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs` on the first send and must never be hand-written:

     ```bash
     mkdir -p docs/team && [ -f docs/team/messages.jsonl ] || : > docs/team/messages.jsonl
     ```

     No command created this file. Observed live: an agent reported raising a question on the
     channel when the channel had never existed, and nothing contradicted it.

   - **`.studio-policy.json`, if it does not already exist** — turns two of the four Revamp P0 trust
     controls on by default for every new project. They are opt-in at the `ship-gate` layer precisely
     so an *existing*, onboarded repo is not retroactively blocked by controls it never adopted — a
     fresh project has no such excuse, and shipping with these silently absent is the gap, not a
     feature:

     ```bash
     [ -f .studio-policy.json ] || cat > .studio-policy.json <<EOF
     {
       "owner": "founder",
       "reviewedOn": "$(date -u +%Y-%m-%d)",
       "requireDurableRuns": true,
       "requireApprovalBinding": true,
       "requireActorTokens": true
     }
     EOF
     ```

     Edit `owner` to the actual accountable role once one is decided; `ship-gate.sh`'s `policy-check`
     only requires the field to be non-empty, not who it names. `requireActorTokens` (not one of the
     four) is also on: `spawn-prompt.mjs compose` mints each spawned agent's token, so it needs
     nothing before the first spawn.

     **Only these two default on.** Codex found (PR #15) that turning on all five here breaks the
     very first spawn: `requireAuditAnchor` and `requireEvaluation` are both
     composed into `dispatch-preflight.mjs`, which runs before *every* ticket claim — and
     each needs an artifact this step cannot produce yet. Reproduced directly against a fresh
     project directory: `audit-anchor.mjs verify` needs `docs/31-board-events.jsonl`, which does not
     exist until the first ticket is added (later, at planning); `eval-lab.mjs` needs `eval/manifest.json`
     naming planted-defect golden fixtures, which a fresh project has none of. Enabling either of the
     two at init time turns "cannot evaluate yet" into "every spawn is blocked forever," which is
     worse than the opt-in gap they were meant to close. `requireDurableRuns` and
     `requireApprovalBinding` have no such ordering problem — `run-ledger.mjs` and
     `approval-check.mjs` degrade to CANNOT EVALUATE on an empty/absent log rather than erroring at
     spawn time — so they default on safely. Neither is checked at spawn: `ship-gate.sh` checks both
     at release, and the merge gate (`/app-build` step 4, run inline by the orchestrator) checks the
     ticket's own approval, which is why `code-reviewer` approves with `--bind` on such a project. Turn the other two on explicitly, per project, once their
     prerequisite exists: `requireAuditAnchor` after the board has its first ticket and someone runs
     `audit-anchor.mjs create`; `requireEvaluation` once the project has its own `eval/manifest.json`.

5a. **Commit the planning docs and everything `devops-engineer` wrote**, staging by explicit path —
   never a blanket add:

   ```bash
   sh -c 'for f in .gitignore CLAUDE.md .studio-policy.json docs/00-founder-intent/ docs/team/messages.jsonl \
            docs/*.md .github fastlane \
            package.json package-lock.json pnpm-lock.yaml yarn.lock .nvmrc */package.json \
            Package.swift Package.resolved */Package.swift build.gradle build.gradle.kts \
            settings.gradle settings.gradle.kts */build.gradle */build.gradle.kts gradle gradlew; do
     [ -e "$f" ] && ! git check-ignore -q "$f" && git add -- "$f"
   done; true'   # true: an absent last path is no failure. sh, not zsh: zsh aborts the loop on an unmatched */ glob
   git diff --cached --name-only    # confirm only those landed
   git commit -m "docs: project plan from /app-init"
   git status --short               # anything left is a file nobody committed: commit it or say why
   ```

   **Then create and check out the declared integration branch, and verify it (W7-3).** Nothing
   else creates it: devops-engineer runs at step 4, before this repository had a commit, so its
   check could only fail, and every later commit (this one, `/app-plan`'s) landed on whatever was
   checked out — `main` — while tickets were cut from a `develop` that lacked the plan:

   ```bash
   B=$(sed -nE 's/^Integration branch:[[:space:]]*`?([A-Za-z0-9._/-]+).*/\1/p' docs/23-git-strategy.md | head -n 1)
   [ -n "$B" ] && [ "$B" != "$(git branch --show-current)" ] && { git rev-parse --verify -q "refs/heads/$B" >/dev/null || git branch "$B"; git checkout "$B"; }
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/integration-branch.sh" .   # must print $B, exit 0 — exit 2: STOP and fix the doc
   ```

   The main checkout stays on the integration branch from here on: `/app-plan` commits onto it,
   worktrees are cut from it, and the runtime gate refuses (CANNOT EVALUATE) a main checkout whose
   HEAD is not its tip. The declaration is read from the COMMITTED doc, so this runs after the commit.

   The platform manifests are in the list because a worktree without `package.json` /
   `Package.swift` / the Gradle files cannot build, and the wave's fresh test worktree sees only
   what is committed. Uncommitted docs are invisible to every worktree `/app-build` leases, so an IC would build
   against no spec at all — and a dirty base makes the first wave push fail to fast-forward.

6. **Print a summary**: list every doc produced, with one-line description each, and the suggested
   next command (`/app-run` for the mostly-autonomous flow, or `/app-plan` → `/app-build` for manual control).

6a. **Validate intent against the record — before the gate, not after it.** Spawn
   `product-validator` (active per the roster). It reads `docs/00-founder-intent/` and the derived
   documents, writes `docs/04-intent-validation.md`, and returns one line:
   `INTENT: ALIGNED | DRIFTED | CANNOT EVALUATE`. This is the one `product-validator` spawn for
   the run — `/app-run` reuses this result rather than spawning it again. Commit
   `docs/04-intent-validation.md` (`git add -- docs/04-intent-validation.md && git commit -m "docs:
   intent validation"`). Then run the intent half of the graph — there is no board yet, so the
   ticket half is CANNOT EVALUATE by construction and runs after `/app-plan` (`--only trace`):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/trace.mjs" --project-root . --only conflicts
   node "${CLAUDE_PLUGIN_ROOT}/scripts/trace.mjs" --project-root . --only gates
   ```

   **Both results go into the Gate 1 brief verbatim.** `DRIFTED` and `CANNOT EVALUATE` do not stop
   the command — they stop the *founder*, which is the point: the drift is a scope question and Gate
   1 is where scope is decided. Never resolve one by re-reading the PRD and agreeing with it.
   `product-validator` reports here and to nobody in the cpo/cto/tech-manager chain, and it never
   writes `docs/10-prd.md`.

7. **GATE 1 — scope-lock (human).** Print a one-screen brief — vision, P0 feature list, architecture
   headline, rough effort, top risk — and ask *"Approve scope and proceed to planning?"* Wait for the
   answer and record it in `docs/00-vision.md` under a `## Scope lock` heading, with the date and
   anything the user cut or added.

   This is the same Gate 1 `/app-run` runs, and it is the **only** place the manual flow
   (`/app-init` → `/app-plan` → `/app-build`) asks a human to approve scope before the pod starts
   spending agents on it. Without it, the design's two-gate contract held for `/app-run` only.

   `--yolo` skips the question, auto-approves, and logs in the vision doc that it did.
   **When `/app-init` was invoked by `/app-run`, `/app-run` owns this gate — skip it here rather
   than asking twice.**

## Output contract

After this command, the workspace contains:

```
CLAUDE.md                    (project conventions, seeded from the House KB)
.gitignore
docs/
  00-founder-intent/          (always — the brief verbatim, plus MANIFEST.sha256)
  00-vision.md
  01-intake.md
  02-team-roster.md          (always — every activation-matrix role, active/conditional/off + reason)
  10-prd.md
  11-backlog.md
  12-flows.md
  13-design-tokens.md
  14-components.md
  15-aso.md                  (if store work in scope)
  04-intent-validation.md    (product-validator's verdict, read at GATE 1)
  20-architecture.md
  21-engineering-principles.md
  22-impl-spec-ios.md        (product type ios-app / mobile-app)
  22-impl-spec-android.md    (product type android-app / mobile-app)
  22-impl-spec-web.md        (product type web-app)
  22-impl-spec-backend.md    (product type backend-service, or backend in scope)
  23-git-strategy.md
  41-monetization.md         (if monetized)
  52-analytics.md
  team/messages.jsonl        (empty team channel — the event log, source of truth)
  team/messages.md           (its generated view; written on the first send, never by hand)
```

If anything is missing, name it explicitly in the summary with a reason. For anything missing
*because a role is off*, the reason is already written in `docs/02-team-roster.md` — quote it, and
say `N/A` rather than leaving a gap the next command has to interpret.
