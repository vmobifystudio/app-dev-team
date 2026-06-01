---
description: Mine a shipped app's conventions into the living House Knowledge Base — adds net-new learnings to knowledge/*.md and flags conflicts for human decision
argument-hint: <path to a shipped app> [more paths...]   (defaults to the just-shipped project)
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent
---

# /app-learn — Grow the House Knowledge Base

Paths to mine (default = the current/just-shipped project): $ARGUMENTS

The House KB (`knowledge/`) is **living**. After shipping an app — or to ingest an existing one —
this command folds its real conventions back into the packs so future apps start smarter.

## Steps

1. **Resolve targets.** For each path, confirm it's a real app (has `CLAUDE.md`, `README.md`,
   `docs/ARCHITECTURE.md`, and/or build files). If none given, use the current project.

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

5. **Summarize.** Print a diff summary: packs touched, conventions added, conflicts pending, and a
   one-line note per source app. Append a dated entry to `CHANGELOG.md` under the KB section.

## Rules

- Read-only on the source apps — `/app-learn` never edits an app it's mining.
- Additions are safe to auto-apply; conflicts always require a human decision.
- Keep packs concrete and example-driven (the studio's `iOS_GENERIC_RULES_AND_LEARNINGS.md` style).
