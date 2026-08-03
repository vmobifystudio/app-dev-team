---
description: Mine a shipped app's conventions into the living House Knowledge Base — adds net-new learnings to knowledge/*.md, harvests its failures into knowledge/failure-corpus.md, and flags conflicts for human decision
argument-hint: <path to a shipped app> [more paths...] [--failures-only]   (defaults to the just-shipped project)
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent
---

# /app-learn — Grow the House Knowledge Base

Paths to mine (default = the current/just-shipped project): $ARGUMENTS

The House KB (`knowledge/`) is **living**. After shipping an app — or to ingest an existing one —
this command folds its real conventions back into the packs so future apps start smarter.

## Steps

1. **Resolve targets.** For each path, confirm it's a real app (has `CLAUDE.md`, `README.md`,
   `docs/ARCHITECTURE.md`, and/or build files). If none given, use the current project.

1a. **Read the learnings inbox first — `docs/90-learnings.md`.** `/app-ship` harvests every
   `LEARNING:` line the team wrote during the run into it, each with the daily fragment it came
   from. These are the highest-value inputs here: they are conventions the team discovered while
   building, not conventions inferred afterwards from finished code. Treat each as a candidate
   convention going into step 3's diff, alongside what step 2 mines from the app itself. Where a
   harvested line and the mined code disagree, the code wins and the line is recorded as a
   conflict — a learning nobody ended up following is not a house rule.

   No inbox (an app mined from outside a `/app-ship` run) → say so and continue with step 2 alone.

2. **Mine in parallel.** Spawn one `general-purpose` Agent per app (in a single message) to extract,
   read-only, a structured report: stack & versions, architecture, state, persistence, DI,
   navigation, networking, testing, monetization (IAP/ads/consent), analytics, ASO/store,
   git/commit conventions, and explicit "always/never" house rules. (This mirrors the original
   7-app mining that seeded the KB.)

3. **Diff against the KB.** For each pack under `knowledge/`, compute:
   - **New** conventions not yet captured → propose adding them.
   - **Confirmations** of existing rules → note increased confidence, no change.
   - **Conflicts** — the app disagrees with a pack (e.g. a different DI, analytics default, or
     min-SDK). **Never silently overwrite.** Record both positions and surface the conflict.

4. **Apply additions, flag conflicts.** Write the additions/confirmations into the relevant packs.
   For each conflict, print:
   ```
   CONFLICT in knowledge/<pack>.md
   KB says:   <current rule>
   <app> does: <observed rule>
   Decision needed: which becomes the house default?
   ```
   Wait for the user's call on each before changing a conflicting rule.

5. **The failure pass — harvest into `knowledge/failure-corpus.md`.** Steps 1–4 learn only from
   things that went right: conventions mined from code that shipped. Nothing accumulated what went
   *wrong*, and a single day of running this system produced 27 dry-run findings and 16 review
   findings, every one of them in a document no agent reads as normative. Meanwhile the same defect
   class recurred three times inside that day, and after the first instance the other two were a
   grep away — if a corpus had existed.

   Run this pass on every invocation, and on its own with `--failures-only` (an app that has not
   shipped still has failures worth keeping).

   1. **Harvest.** Read, from each target app: `docs/research/*-findings.md` (dry-run registers) and
      `docs/80-audit.md` (audit findings). Also `docs/51-bugs.md` for S1/S2 defects whose *shape*
      generalises beyond the app — most bugs do not, and a corpus of app-specific bugs is a bug
      tracker, not knowledge.

   2. **Classify, don't append.** For each finding, ask which existing class in
      `knowledge/failure-corpus.md` it belongs to and read that class's **Shape** before deciding.
      Then:

      - **It fits a class** → add ONE dated instance row, only if it says something the existing
        rows do not. Same shape, same rule, nothing new to a reviewer → record it as a confirmation
        in your summary and add no row. **A class with forty rows and no new shape is a changelog.**
      - **It fits no class** → propose a new `### FC-NNN` with all five fields. If you cannot write
        a mechanisable **Tell** — a grep or a question with a yes/no answer — the class is not
        finished, and a class nobody can apply is exactly the decoration this file exists instead of.
      - **It is a one-off with no generalisable shape** → leave it in the register. Say so.

   3. **Flag recurrence — this is the point of the pass.** After writing, run:

      ```bash
      node "${CLAUDE_PLUGIN_ROOT}/scripts/team-doctor.mjs" --json
      ```

      and read every `corpus_recurrence` finding. Each one means a class recurred **after the date
      its rule shipped** — proof the rule does not work, which is a strictly more valuable fact than
      the incident. Surface every one at the top of your summary, ahead of every convention you
      added:

      ```
      RECURRENCE  FC-NNN <name>
      Rule shipped: <date>   Recurred: <date>
      The rule that was supposed to catch this did not. Strengthen it and stamp a new
      "Rule shipped" date, or reclassify the instance. Deleting the row is not an exit.
      ```

      `team-doctor` exits 1 on a recurrence, so this cannot be reported as clean by accident.

   4. **Never delete an instance** to clear a flag. The dates are the evidence; a corpus you can
      quietly tidy is a corpus that measures nothing.

6. **The studio-process pass — harvest into `memory-curator.mjs`'s `studio` class.** Steps 1–5
   learn about the APPS this studio builds — conventions and code-level failure shapes. Nothing
   accumulates what the STUDIO ITSELF should do differently: a question that should have been
   asked earlier, an output format an operator had to manually rework, flow logic that had to be
   reordered mid-run, a missing or redundant gate, a missing or redundant role. That's a different
   population from `knowledge/failure-corpus.md`'s and it lives in a different, already-governed
   place — `scripts/memory-curator.mjs`'s `studio` class, proposed and reviewed the same way any
   other memory class is, never auto-promoted.

   Run this pass whenever a `docs/dry-runs/*.md` report (or an `/app-ship` retro) exists to read —
   it does not require a shipped app, unlike steps 1–5.

   1. **Harvest.** Read the dry-run report or retro for the studio's OWN process, not the app's
      code. Classify each finding into one of five categories:
      - `question-quality` — a question that should have been asked earlier or wasn't asked at all
      - `output-format` — an agent's output had to be manually reworked before it was usable
      - `flow-logic` — steps had to be reordered, re-run, or worked around mid-execution
      - `gate-design` — a check that should have existed and didn't, or fired on the wrong signal
      - `role-design` — a role was missing, redundant, or had an unclear boundary with another

   2. **Propose, never write directly.** For each finding, run:

      ```bash
      node "${CLAUDE_PLUGIN_ROOT}/scripts/memory-curator.mjs" propose \
        --ledger docs/team/memory.jsonl --class studio --confidence <0-1> \
        --content "<category>: <the finding, stated as an abstract shape, not this app's specifics>" \
        --source <path to the dry-run report or retro>
      ```

      This is a PROPOSAL, not a change. A human (or a dedicated reviewer role) runs
      `memory-curator.mjs review` to promote or reject it — the same governance every other memory
      class already has. `/app-learn` never edits `agents/*.md`, `commands/*.md`, or `scripts/*`
      directly from this pass; it only proposes.

   3. **Surface what's pending.** After proposing, run:

      ```bash
      node "${CLAUDE_PLUGIN_ROOT}/scripts/memory-curator.mjs" list --ledger docs/team/memory.jsonl --class studio
      ```

      and print every entry still showing `"event":"proposed"` (not yet reviewed) in the summary —
      a proposal nobody reviews is the exact "scaffolding with no producer" failure this pass exists
      to close, and it should not be able to happen quietly a second time.

7. **Summarize.** Print a diff summary: recurrences first, then packs touched, conventions added,
   failure classes touched (added / instance appended / confirmed-no-change), conflicts pending,
   pending studio-process proposals from step 6, and a one-line note per source app. Append a dated
   entry to `CHANGELOG.md` under the KB section.

## Rules

- Read-only on the source apps — `/app-learn` never edits an app it's mining.
- Additions are safe to auto-apply; conflicts always require a human decision.
- Keep packs concrete and example-driven (the studio's `iOS_GENERIC_RULES_AND_LEARNINGS.md` style).
- The failure corpus is dedup-first: classes are the unit, incidents are evidence for a class. Adding
  an incident is cheap and nearly worthless; naming a new **shape** is the expensive, valuable thing.
