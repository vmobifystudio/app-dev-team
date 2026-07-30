---
name: design-system
description: Use when defining or extending design tokens and the shared component library — by product-designer when writing docs/13-design-tokens.md and docs/14-components.md, and by any IC about to add a component. Triggers the moment a value would be hardcoded instead of named, or a one-off component would be created instead of composed.
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

## Output

Tokens go in `docs/13-design-tokens.md`, components in `docs/14-components.md`. Both are single-owner
files — `product-designer` writes them, everyone reads them. An IC that needs a change asks; it does
not edit.
