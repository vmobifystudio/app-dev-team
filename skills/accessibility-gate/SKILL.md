---
name: accessibility-gate
description: Use as a pass/fail gate on any diff with a user-facing surface — by code-reviewer during review, by qa-engineer during the test pass, and by any IC before claiming a UI ticket done. This is the gate the plan called for instead of an accessibility specialist role. Triggers whenever a screen, component or state changes.
---

# Accessibility gate

The studio's position, from the plan: accessibility does not need a specialist role, it needs a
**gate that can fail**. This is that gate. It runs on the diff, not on the finished app, because a
retrofit is an order of magnitude more expensive than doing it in the ticket.

Where a platform auditor exists, spawn it first and fold its findings in — `axiom:accessibility-auditor`
on iOS, `ui-design:accessibility-audit` elsewhere. **Both are external and optional** (separate
plugins, not this one's `skills/`). Missing → record `N/A: <tool> — not installed`, walk the list by
hand, never file the absence as a defect.

## The gate

Each item is `PASS` or `FAIL: <what and where>`. There is no partial credit and no "minor".

1. **Every interactive element has an accessible label** that says what it does — not its icon name.
   An unlabelled icon button is a control that does not exist for a screen-reader user.
2. **Reading order matches visual order**, and grouped content is grouped for the screen reader too.
3. **Every state change is announced** — loading finished, error appeared, item deleted. A silent
   state change strands the user in the previous screen.
4. **Touch targets are at least 44pt (iOS) / 48dp (Android)**, including in dense lists.
5. **Contrast**: 4.5:1 body text, 3:1 large text and non-text indicators. Checked against the token,
   in both light and dark.
6. **Colour is never the only signal.** Error, selection and status carry a shape, an icon or text.
7. **Dynamic Type / font scaling to the largest supported size** does not clip, truncate meaning, or
   overlap. Test at the maximum, not at 120%.
8. **Keyboard and switch access** reach every action, focus is always visible, and focus is never
   trapped. On web this includes a skip link and a visible `:focus-visible` style.
9. **Reduce-motion is honoured** and still gives the user feedback (`interaction-motion`).
10. **Media has an alternative** — alt text, caption, or transcript.

## Verdict

```
ACCESSIBILITY: PASS
ACCESSIBILITY: FAIL — <n> item(s): <ids>
```

A `FAIL` blocks the ticket exactly like a code-review `changes` verdict. It is not a follow-up
ticket: a follow-up ticket is how this became a five-year backlog everywhere it has been tried.
