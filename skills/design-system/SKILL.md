---
name: design-system
description: On an app-dev-team project, use when defining or extending docs/13-design-tokens.md and docs/14-components.md, or the moment a value would be hardcoded or a one-off component created; also when specifying or reviewing motion (§Motion). Used by product-designer, tech-lead and the /app-build design-QA pass.
---

# Design system

A design system is not a document, it is a **constraint that holds at build time**. Tokens nobody is
forced to use are a colour list.

## Three layers, in this order

1. **Primitive** — the raw values. `blue-600 #2563EB`, `space-4 16`, `dur-fast 150ms`. No screen
   ever references a primitive directly.
2. **Semantic** — what it means. `text/primary`, `surface/elevated`, `semantic/error`,
   `motion/enter`. Screens reference these and only these.
3. **Component** — what a component uses. `button/primary/background` → `semantic/action`.

Skipping layer 2 is the failure: a dark mode, a rebrand or a contrast fix then edits every screen.

## The rules

- **A hardcoded colour, spacing, radius, duration or font size in a screen is a defect**, not a
  style preference. Name it or use the token that already exists.
- **Every semantic token names its dark-mode value at the same time.** A token added light-only is a
  dark-mode bug already merged.
- **A new component needs a reason the existing ones cannot compose it.** Write the reason in
  `docs/14-components.md`. "It looked different in the mock" is not one.
- **Every component declares its states** — default, pressed, disabled, loading, error, empty where
  applicable — and its minimum touch target (44pt iOS / 48dp Android).
- **Contrast is checked when the token is defined**, not when accessibility is audited. Text pairs
  meet 4.5:1, large text and non-text 3:1. A token failing contrast never ships and is never
  "fixed downstream".

## Extending versus forking

Before adding anything, in this order: use the existing component → extend it with a prop → compose
two existing ones → add a new one. Stop at the first that works. The third is where most teams stop
too early and the fourth is where design systems die.

## Motion

Motion has one job: **tell the user what just happened and where they are now**. Motion that decorates
costs battery, costs frames, and costs the users who cannot tolerate it.

### Durations

Do not invent a duration. Use the token, and use the shortest one that reads:

| Token | Use |
|---|---|
| `fast` 150ms ease-out | state feedback — press, toggle, ripple, checkbox |
| `base` 250ms ease-in-out | element enters or leaves within a screen |
| `slow` 400ms | full-screen transition, only when it carries spatial meaning |

Anything longer than 400ms is not motion, it is a wait — and a wait needs progress, not an animation.

### Feedback timing

| Elapsed | The interface owes the user |
|---|---|
| < 100ms | nothing — it feels instant |
| 100ms–1s | immediate visual acknowledgement that the input landed |
| 1s–10s | a determinate progress indicator if progress is knowable, an indeterminate one if not |
| > 10s | the ability to leave and come back, and a way to cancel |

A spinner with no cancel on a long operation is a trap; that is a reliability finding as much as a
design one.

### Rules

- **Motion must be interruptible.** A user tapping during an animation is answered immediately, not
  after it finishes.
- **Position must be preserved.** An element that moves animates from where it was; an element that
  is replaced cross-fades. Getting this backwards is what makes an interface feel arbitrary.
- **Respect reduce-motion.** `UIAccessibility.isReduceMotionEnabled` /
  `Settings.Global.ANIMATOR_DURATION_SCALE` / `prefers-reduced-motion`. The reduced path replaces
  movement with a cross-fade or an instant change — **it never removes the feedback itself**, which
  would leave those users with no indication anything happened.
- **Nothing animates on first paint** except what the user's own action caused.
- **No animation loops indefinitely** except a genuine indeterminate progress indicator.

### Motion output

One `## Motion` section in `docs/14-components.md`: per component, what animates, which token, and
what the reduced-motion path is. A component with no reduced-motion line is not specified.

## Output

Tokens go in `docs/13-design-tokens.md`, components in `docs/14-components.md`. Both are single-owner
files — `product-designer` writes them, everyone reads them. An IC that needs a change asks; it does
not edit.
