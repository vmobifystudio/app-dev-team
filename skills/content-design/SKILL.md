---
name: content-design
description: Use when writing or reviewing any string a user reads — labels, buttons, empty states, errors, permission prompts, onboarding, notifications. Invoked by ux-architect and product-designer while specifying screens, and by product-manager when a clarification turns out to be a copy decision. Triggers the moment a placeholder string would ship.
---

# Content design

The interface is mostly words. Words written last, by whoever was implementing, are the ones users
actually read.

## Buttons and labels

- **A button says what happens when you press it.** `Save changes`, not `OK`. `Delete 3 photos`, not
  `Confirm`.
- **A destructive button names what is destroyed and whether it comes back.** "This cannot be undone"
  belongs in the dialog, not in the button.
- Sentence case throughout. Never end a button label with a full stop.
- `Cancel` means "nothing happens". Never label a button `Cancel` when something happens.

## Errors — three parts, always

1. **What happened**, in the user's terms, not the system's.
2. **Whether their data is safe.** This is the question they are actually asking.
3. **What to do next**, as an action they can take right now.

`Something went wrong` fails all three. `Couldn't save — your note is still here. Retry when you're
back online.` passes all three in one line. **Never show an error code without also showing prose**,
and never show raw exception text.

## Empty states

An empty state is not a blank screen with an apology. It says what belongs here, why it is empty
(new, filtered, or failed — three different states, three different messages), and the one action
that fills it.

## Permission prompts

Ask *at the moment of need*, never at launch. The prompt says what the user gets, not what the app
wants. The system string (`NSCameraUsageDescription` etc.) is written by you, not by an engineer at
build time — and a denied permission needs a working path, not a dead end.

## The rules

- **Every user-visible string goes into the localisation file from the moment it is written.**
  Retrofitting is far more expensive and is where hardcoded strings survive to ship (`localisation`).
- **No placeholder text reaches a build.** `Lorem ipsum`, `TODO`, `Test` in a screenshot is an ASO
  and a review failure at once.
- **One term per concept, product-wide.** A record is not an "item" here and an "entry" there. Keep
  the list in `docs/14-components.md`.
- Numbers, dates, currencies and plurals are formatted by the platform's locale-aware API — never by
  string concatenation.

## Output

Copy lives with the screen that shows it, in `docs/12-flows.md` and `docs/14-components.md`. A state
in the inventory with no copy is not specified.
