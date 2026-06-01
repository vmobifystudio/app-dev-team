---
name: house-conventions
description: Use before writing any code, spec, or store asset on a Mobify Studio app — loads the relevant House Knowledge Base pack(s) so output matches the studio's established conventions instead of generic defaults. Every IC and exec agent invokes this first.
---

# House conventions

The plugin ships a House Knowledge Base under `knowledge/` mined from our internal shipped
apps. This skill is how an agent loads the right pack before working, so what it produces looks
like the studio's other apps — same architecture, same monetization patterns, same store hygiene.

## When to use

Invoke this **before** the first edit/spec on any ticket, sprint, or asset. It costs one read
and prevents a whole class of "this doesn't match how we build" rework.

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
   | Add ads, IAP, or a paywall | `monetization.md` |
   | Add analytics / events / KPIs | `analytics.md` |
   | Prepare store assets / submission | `aso.md` |
   | Set up git, CI, signing, releases | `git-workflow.md` |

2. Treat the pack as the **floor**. Follow it unless the project's own `docs/` (architecture,
   engineering principles, `CLAUDE.md`) explicitly overrides a specific rule — a project may be
   stricter, never sloppier.

   **Tier:** default to the **Flagship** rules in each pack. If the project declares itself a
   *utility* app (in its `docs/` or `CLAUDE.md`), apply the **Utility** branch where a pack defines
   one (e.g. ad-first monetization, leaner stack) — see `knowledge/README.md` §Tiers.

3. If the pack and the project docs **conflict**, the project docs win for that project, but
   write one line to your per-run fragment (`docs/daily/<today>-<agent>-<ticket>.md`) noting the
   divergence so the `tech-manager` can decide whether the KB or the project is wrong.

4. If you discover a genuinely new, reusable convention while working, add a `LEARNING:` line to
   that same fragment so `/app-learn` can fold it back into the KB after ship.

## Anti-patterns

- Writing code first and checking conventions later — the rework is the cost you were avoiding.
- Inventing a new architecture/pattern when a pack already specifies one.
- Silently following the KB when the project doc says otherwise (or vice-versa) without flagging it.
