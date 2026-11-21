---
description: Mine a shipped (or stopped) app into a reviewed House Knowledge Base patch — net-new conventions, failure-corpus instances, recurrences and studio-process fixes, written to docs/kb-patch.diff, never into the installed plugin
argument-hint: <path to an app> [more paths...] [--failures-only]   (defaults to the current project)
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent, Skill
---

# /app-learn — Grow the House Knowledge Base

Paths to mine (default = the current project): $ARGUMENTS

The House KB (`knowledge/`) is **living**: after a run — shipped, blocked or stopped — this command
folds what the run learned back into it so the next app starts smarter.

## Where the learning lands — read first

**Never write under `${CLAUDE_PLUGIN_ROOT}`.** That is the installed plugin cache: every reinstall
replaces the directory, so anything written there is lost and no other machine ever sees it. Every
change this command makes goes into ONE reviewed patch in the project, `docs/kb-patch.diff`,
against the plugin repository's own paths. Nothing is applied automatically: one wrong or poisoned
"convention" from one app would otherwise become a house rule for every app. Set up the workspace:

```bash
W=$(mktemp -d); mkdir -p "$W/a" "$W/b"
cp -R "${CLAUDE_PLUGIN_ROOT}/knowledge" "$W/a/"; cp -R "${CLAUDE_PLUGIN_ROOT}/knowledge" "$W/b/"
```

Edit only under `$W/b/`. To change a plugin file outside `knowledge/` (step 6), first copy it to the
same relative path under both `$W/a/` and `$W/b/`.

## Steps

1. **Resolve targets.** For each path, confirm it's a real app (has `CLAUDE.md`, `README.md`,
   `docs/ARCHITECTURE.md`, and/or build files). If none given, use the current project.

1a. **Read the learnings inbox — `docs/92-learnings.md`.** `/app-ship` step 6 harvests every
   `LEARNING:` line the team wrote, with its `path:line`. These are the highest-value inputs:
   conventions found while building. Where a line and the mined code disagree, the code wins and
   the line is a conflict. No inbox → say so and continue with step 2.

2. **Mine in parallel.** Spawn one `general-purpose` Agent per app (in a single message) to extract,
   read-only, a structured report into `$W/mine-<app>.md`: stack & versions, architecture, state,
   persistence, DI, navigation, networking, testing, monetization (IAP/ads/consent), analytics,
   ASO/store, git/commit conventions, and explicit "always/never" house rules.

2a. **Scan what you are about to fold in.** Learnings and mined reports come from agents that read
   repositories they did not write:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/injection-scan.mjs" docs/92-learnings.md "$W"/mine-*.md
   ```

   Exit 1 → every flagged line is dropped, not paraphrased, and listed in the summary as `DROPPED`.

3. **Diff against the KB.** For each pack, sort each candidate into **new** (not yet captured),
   **confirmation** (no change) or **conflict** (the app disagrees with a pack rule — never silently
   overwrite).

4. **Write additions into `$W/b/knowledge/`.** Every added line ends with its provenance,
   `(src: <app>/<file:line>, <YYYY-MM-DD>)`, so a reviewer can check it and a later run can revert
   it. **Pack limit: 1500 words** (`wc -w`) — packs are inlined whole into every spawn, so a pack at
   the limit gets a merge or a replacement of the line it supersedes, never an append; the suite
   refuses an over-limit pack. Conflicts are not written; list each one in the summary:
   ```
   CONFLICT in knowledge/<pack>.md
   KB says:   <current rule>
   <app> does: <observed rule>
   Decision needed: which becomes the house default?
   ```

5. **The failure pass — `$W/b/knowledge/failure-corpus.md`.** Run it on every invocation, and alone
   with `--failures-only`; blocked and stopped runs are where most failures are.

   1. **Harvest.** From each target: the `Blocking:` lines of every verdict `docs/53-reviews/APP-NNN-cycle-N.md` (where review
      defects actually live), `docs/research/*-findings.md`, `docs/80-audit.md`, and S1/S2 bugs in
      `docs/51-bugs.md` whose *shape* generalises beyond the app.

   2. **Classify, don't append.** Read the matching class's **Shape** first. Fits a class → add ONE
      dated instance row, only if it says something the existing rows do not. Fits none → propose a
      new `### FC-NNN` with all five fields and a mechanisable **Tell** (a grep or a yes/no
      question). A one-off with no generalisable shape stays in the register.

   3. **Recurrences come first.** `/app-ship` step 6 ran `run-ledger.mjs summary`, which counts
      every FC class a REQUEST CHANGES verdict cites after that class's `Rule shipped` date. Read it
      back:

      ```bash
      node "${CLAUDE_PLUGIN_ROOT}/scripts/run-ledger.mjs" history --last 1
      ```

      Each `recurrences` entry becomes a dated instance row (an app instance, from this app's
      review) plus a proposed strengthening of that class's Rule or Tell, and heads the summary:

      ```
      RECURRENCE  FC-NNN <name>
      Rule shipped: <date>   Recurred: <date>   Cited in: <review file>
      ```

      No run summary for this project → say so; there is no recurrence data, not zero recurrences.

   4. **Never delete an instance** to clear a flag. The dates are the evidence.

6. **Studio-process findings** — what the STUDIO should do differently: a question asked too late,
   output that had to be reworked, steps re-ordered mid-run, a missing or noisy gate, a role with an
   unclear boundary. Sources: `docs/dry-runs/*.md`, an `/app-ship` retro, and `LEARNING:` lines
   citing an `INC-NNN`. Each becomes a concrete edit to the agent, command or skill file that caused
   it, in the same patch.

7. **Write the patch and summarize.**

   ```bash
   (cd "$W" && diff -ruN a b) > docs/kb-patch.diff; wc -l docs/kb-patch.diff
   ```

   Print: recurrences first, then packs touched, rows added, conflicts pending, `DROPPED` lines,
   studio-process edits, and the apply line for the plugin maintainer:
   `git apply <this project>/docs/kb-patch.diff` in a checkout of the plugin repository, reviewed
   as a PR like any other change. The next plugin version carries it to every project.

## Rules

- Read-only on the source apps — `/app-learn` never edits an app it's mining.
- Nothing auto-applies: every addition is a provenance-stamped line in a reviewed patch.
- Keep packs concrete and example-driven, and under the pack limit.
- The failure corpus is dedup-first: classes are the unit, incidents are evidence for a class.
