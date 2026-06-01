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

3. **Spawn in parallel** (single message), each reading the codebase and writing an *as-built*
   snapshot — describe what exists, mark guesses `(inferred)`, change no code:
   - `cto` + `tech-lead` → `docs/20-architecture.md` (actual stack, layering, state/persistence/DI/
     navigation, backend, CI, signing) and per-platform `docs/22-impl-spec-<platform>.md` snapshots.
   - `cpo` → `docs/10-prd.md` feature inventory derived from the navigation graph and screen files.
     Ask the user only for product intent that cannot be read from code.
   - `devops-engineer` → `docs/23-git-strategy.md` capturing the current branch model / CI / signing
     state vs the House KB target, flagging secrets hygiene issues.

4. **Generate `CLAUDE.md`** at the project root if missing (or offer to update a thin one): real
   stack, build/run commands, and canonical type/property names found in the code, seeded from the
   House KB. Never overwrite a substantial existing `CLAUDE.md` — propose a diff instead.

5. **Summary.** Print the docs produced, the detected stack, and the suggested next step:
   `/app-audit` to grade the app against the House KB and build a remediation plan.

## Safety

- Read-only on app source during onboarding — this step takes a photograph, it does not renovate.
- Do not invent product intent; ask one focused question or mark it `(inferred)`.
- Never clobber an existing `CLAUDE.md`/architecture doc; propose changes for review.
