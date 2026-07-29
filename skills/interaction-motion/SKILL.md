---
name: interaction-motion
description: Use when specifying or reviewing motion and interaction feel — transitions, gestures, feedback timing, loading and progress. Invoked by product-designer while composing screens and by any IC implementing an animated surface. Triggers whenever something moves, and whenever something takes long enough that the user must be told.
---

# Interaction and motion

Motion has one job: **tell the user what just happened and where they are now**. Motion that decorates
costs battery, costs frames, and costs the users who cannot tolerate it.

## The durations

Do not invent a duration. Use the token, and use the shortest one that reads:

| Token | Use |
|---|---|
| `fast` 150ms ease-out | state feedback — press, toggle, ripple, checkbox |
| `base` 250ms ease-in-out | element enters or leaves within a screen |
| `slow` 400ms | full-screen transition, only when it carries spatial meaning |

Anything longer than 400ms is not motion, it is a wait — and a wait needs progress, not an animation.

## Feedback timing

| Elapsed | The interface owes the user |
|---|---|
| < 100ms | nothing — it feels instant |
| 100ms–1s | immediate visual acknowledgement that the input landed |
| 1s–10s | a determinate progress indicator if progress is knowable, an indeterminate one if not |
| > 10s | the ability to leave and come back, and a way to cancel |

A spinner with no cancel on a long operation is a trap; that is a reliability finding as much as a
design one.

## The rules

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

## Output

One `## Motion` section in `docs/14-components.md`: per component, what animates, which token, and
what the reduced-motion path is. A component with no reduced-motion line is not specified.
