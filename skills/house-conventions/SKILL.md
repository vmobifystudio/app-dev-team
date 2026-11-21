---
name: house-conventions
description: Use before writing any code, spec or store asset on a Mobify Studio app, to load the House Knowledge Base packs that apply. Every IC loads it first; execs load it when a document names a platform, version, library or store.
---

# House conventions

Load the House Knowledge Base pack (`knowledge/`, mined from our shipped apps) that matches your
work **before** the first edit or spec, so what you produce matches the studio's other apps.

## Procedure

1. Identify what you're about to do and load the matching pack(s). The packs live at
   **`${CLAUDE_PLUGIN_ROOT}/knowledge/<pack>.md`**. If `CLAUDE_PLUGIN_ROOT` is not set in your
   environment, glob for `**/knowledge/stack-defaults.md` inside the plugin install and read the
   packs from that directory. If you genuinely cannot locate the packs, **STOP and report a
   blocker** — do not silently proceed on generic defaults; that is exactly the failure this skill
   exists to prevent.

   | You are about to… | Read |
   |---|---|
   | Pick stack / versions / libraries | `stack-defaults.md` |
   | Write or review iOS code | `ios-conventions.md` (+ `stack-defaults.md`) |
   | Write or review Android code | `android-conventions.md` (+ `stack-defaults.md`) |
   | Write or review web code, web spec, web CI | `web-conventions.md` (not `stack-defaults.md`) |
   | Add ads, IAP, or a paywall | `monetization.md` |
   | Add analytics / events / KPIs | `analytics.md` |
   | Prepare store assets / submission | `aso.md` |
   | Set up git, CI, signing, releases | `git-workflow.md` |
   | Write a vision, PRD, or backlog | **No pack — the shape lives in `prd-builder` / `requirements-intake`, not here.** Read `stack-defaults.md` only where the document names a platform, version or library; otherwise this skill has nothing for you and you are done in one line. |

2. Treat the pack as the **floor**. Follow it unless the project's own `docs/` (architecture,
   engineering principles, `CLAUDE.md`) explicitly overrides a specific rule — a project may be
   stricter, never sloppier.

   **Tier:** default to the **Flagship** rules in each pack. If the project declares itself a
   *utility* app (in its `docs/` or `CLAUDE.md`), apply the **Utility** branch where a pack defines
   one (e.g. ad-first monetization, Koin); *brownfield reference only* sections never apply to a
   new app. See `${CLAUDE_PLUGIN_ROOT}/knowledge/README.md` §Tiers.

2a. **Load only what the project has.** Read `docs/02-team-roster.md` (tier, product type,
   platforms) before the pack. Do not produce a section for a platform, role or capability the
   project does not have — no Android stack section on an iOS-only app, no "consult tech-lead about
   capacity" with one active IC. **Skip it explicitly, never silently:** write
   `N/A: <section> — <reason> per docs/02-team-roster.md`. A silent skip and a forgotten section
   look identical to every reader afterwards.

3. If the pack and the project docs **conflict**, the project docs win for that project, but
   write one line to your per-run fragment (`docs/daily/<today>-<role>-<ticket>.md`) noting the
   divergence so the `tech-manager` can decide whether the KB or the project is wrong.

   **No ticket?** A spec-writing exec uses `docs/daily/<today>-<role>-spec.md` — same directory,
   so the standup collects it.

4. If you discover a genuinely new, reusable convention while working, add a `LEARNING:` line to
   that same fragment so `/app-learn` can fold it back into the KB after ship.

5. **If you wrote to a file OUTSIDE a leased worktree — a spec, the SRS, the PRD, the backlog, an
   ADR/PDR/DDR, anything in the shared tree — commit it before you report done or hand off.**
   `git worktree add` snapshots the last COMMIT, so an uncommitted spec or ticket does not exist in
   the next developer's worktree. `git add <the files you touched> && git commit -m "..."` —
   explicit paths only, the same rule `ic-workflow` gives ICs.

6. **Read what your role names, not the whole tree** — the pack this skill names, the docs your
   input contract names, nothing wider unless a specific question sends you looking. Re-reading the
   full PRD, every standup and every sibling ticket "to be safe" burns budget and invites a
   mid-ticket compaction. This never licenses skipping a required read.
