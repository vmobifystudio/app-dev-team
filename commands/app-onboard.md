---
description: Adopt an EXISTING app — detect the stack, reverse-engineer the as-built architecture, and generate the baseline docs + CLAUDE.md so the team understands the codebase before auditing or extending it
argument-hint: [path to the app, optional — defaults to current directory]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent
---

# /app-onboard — Bring an existing app into the team

Target app path (optional, default = current directory): $ARGUMENTS

Use this when the project already has code. It produces the same baseline the greenfield flow
assumes, but reverse-engineered from what's actually there — so `/app-audit` and `/app-build` have
something to work against.

## Steps

1. **Invoke the `brownfield-onboarding` skill** and follow it. Run its Step 1 detection first:
   scan the target for iOS/Android markers, versions, libraries, and module layout. Print a short
   "what I found" block (platforms, stack, module count, whether CLAUDE.md / CI / Firebase exist).
   If the directory has no app in it, stop and suggest `/app-init` (greenfield) instead.

2. **Invoke `house-conventions`** so the reverse-engineering is framed against the studio's
   standards (and the right Flagship/Utility tier).

2a. **Activate the roster.** Invoke the `role-activation` skill. Both axes come from step 1's
   detection, not from a guess: the **product type** from its detection table (a tree that is
   neither iOS nor Android is a normal answer — read the package manifests), the **tier** from the
   app's size and shape, naming the signal that decided it. Ambiguous → ask one question.

   Write `docs/02-team-roster.md` (copy `${CLAUDE_PLUGIN_ROOT}/docs/02-team-roster.md` and fill it
   in) — all 18 roles, `active` / `conditional` / `off` with trigger or reason — **before spawning
   anyone below**. If detection lands on an unstaffed product type (`web-app`, `cli`), print the
   skill's `ACTIVATION REFUSED` block and stop: onboarding a codebase no IC on this team can work on
   produces a baseline nobody can act on. Otherwise print the
   tier, the product type, and the off-list. A brownfield backend service that spawns an
   `aso-specialist` and gets store-listing homework is the failure this closes.

3. **Spawn the `active` roles in parallel** (single message), each reading the codebase and writing
   an *as-built* snapshot — describe what exists, mark guesses `(inferred)`, change no code:
   - `cto` + `tech-lead` → `docs/20-architecture.md` (actual stack, layering, state/persistence/DI/
     navigation, backend, CI, signing) and per-platform `docs/22-impl-spec-<platform>.md` snapshots.
   - `cpo` → `docs/10-prd.md` feature inventory derived from the navigation graph and screen files,
     and from that same inventory **`docs/11-backlog.md` and a minimal `docs/00-vision.md`**.
     Ask the user only for product intent that cannot be read from code.

     **Every already-shipped feature enters the backlog as a `done` / `baseline` row**, never as
     work to do — the backlog must be real but must not re-propose building what already exists.
     New work arrives later as `/app-audit`'s `AUDIT-NNN` tickets or as the upgrade goal `/app-run`
     passes in. The vision is one paragraph: what the app does today, plus the upgrade goal if one
     was given.

     Both files are required, not nice-to-have: `/app-plan` stops without `docs/11-backlog.md` and
     `/app-status` reads the vision and the backlog unconditionally. Until `/app-onboard` wrote
     them, brownfield ran `/app-onboard` → `/app-audit` → `/app-plan` and hit a hard stop telling it
     to run `/app-init` — the one command this file tells brownfield users never to run.
   - `devops-engineer` → `docs/23-git-strategy.md` capturing the current branch model / CI / signing
     state vs the House KB target, flagging secrets hygiene issues.

4. **Generate `CLAUDE.md`** at the project root if missing (or offer to update a thin one): real
   stack, build/run commands, and canonical type/property names found in the code, seeded from the
   House KB. Never overwrite a substantial existing `CLAUDE.md` — propose a diff instead.

5. **Create the team channel** `docs/team/messages.jsonl` if absent — an empty append-only event log
   (`team-protocol` defines the schema). `docs/team/messages.md` is GENERATED from it on the first
   send and must never be hand-written. A brownfield project that already has only the Markdown
   ledger is migrated automatically on that first send, and the migration announces itself:

   ```bash
   mkdir -p docs/team && [ -f docs/team/messages.jsonl ] || [ -f docs/team/messages.md ] || : > docs/team/messages.jsonl
   ```

   No command created this file. Observed live: an agent reported raising a question on the channel
   when the channel had never existed, and nothing contradicted it.

6. **Summary.** Print the docs produced, the detected stack, the roster headline (tier, product
   type, which roles are off and why), and the suggested next step: `/app-audit` to grade the app
   against the House KB and build a remediation plan.

## Safety

- Read-only on app source during onboarding — this step takes a photograph, it does not renovate.
- Do not invent product intent; ask one focused question or mark it `(inferred)`.
- Never clobber an existing `CLAUDE.md`/architecture doc; propose changes for review.
