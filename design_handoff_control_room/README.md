# Handoff: Control Room redesign

## Overview

A visual and structural redesign of the `app-dev-team` control room — the five-screen browser
interface (Mission Control · Communications · Board · Team · Founder Inbox) a founder uses to watch
an AI dev team work a kanban board.

The redesign replaces the single-column layout and its wrapping header pills with a collapsible
sidebar plus a sticky top bar, rebuilds the visual hierarchy so the "why is work not moving" section
is unmistakably the loudest thing on the page, and hardens the four-state model (attention / clear /
info / cannot-evaluate) so *cannot evaluate* can never be mistaken for *clear*.

Nothing about the product's contract changes. It remains a read-only projection of the append-only
log, with writes only through the whitelisted CLI actions in the Founder Inbox.

## About the design files

The files in this bundle are **design references authored in HTML**. They are prototypes showing
intended look and behaviour — they are **not production code to copy**. They use an internal
component format (`.dc.html`) with inline styles, which exists only to make the prototype stream and
render in a design tool.

Your task is to **recreate these designs in the existing control-room codebase**: React 19 +
TypeScript + Vite, plain CSS in `src/styles.css` using custom properties, hand-authored inline SVG
icons in `src/icons.tsx`. Do not introduce the prototype's inline-style approach into the codebase —
translate the values into CSS custom properties and classes the way `styles.css` already does.

**Open the files by double-clicking the HTML in a browser.** `support.js` must stay alongside them.

| File | What it is |
| --- | --- |
| `Control Room - Redesign v2.dc.html` | **The deliverable.** All five screens, clickable. Sidebar collapse, channel filter, source panel all work. |
| `Control Room - Spec.dc.html` | **Read this second.** Tokens, type scale, spacing, every component in every state, the chrome rules, and the variations that were considered. |
| `Control Room - Current.dc.html` | A faithful recreation of today's UI, for before/after comparison. Not a target. |

## Fidelity

**High fidelity.** Colours, type, spacing, radii and component states are final and are listed as
literals in the spec. Recreate the UI precisely, using the codebase's existing CSS-custom-property
approach.

Two deliberate gaps, both flagged again under *Open questions* at the end:

- **Light mode only.** The current app supports `prefers-color-scheme: dark` and that must not
  regress. The dark palette needs deriving from the light one — it is not specified here.
- The prototype hard-codes one plausible dataset. Every value on screen must come from `/state`.

---

## Design tokens

Define these in `:root` in `styles.css`, replacing the current values.

### Base

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#f2f2ef` | Page background |
| `--surface` | `#ffffff` | Cards, tables, ticket cards |
| `--surface-sunken` | `#fbfbf9` | Sidebar, kanban columns, form areas, chips |
| `--surface-footer` | `#fdfdfb` | Card footers, table heads |
| `--text` | `#14140f` | Body and headings |
| `--text-2` | `#5c5b54` | Secondary body copy |
| `--text-3` | `#6b6a62` | Meta, micro labels, provenance, zeros in tables |
| `--line` | `#e6e5de` | Card and control borders |
| `--line-soft` | `#f0efe9` | Row rules inside cards and tables |
| `--accent` | `#4f46e5` | Ticket IDs, primary buttons, focus rings, links |
| `--accent-strong` | `#3b32c9` | Active nav text |
| `--accent-soft` | `#eef0fe` | Active nav fill, decision chip |
| `--accent-line` | `#d5d5fb` | Active nav border |

There is **one** muted grey, not two. The previous design had a second, lighter grey for micro
labels; at 11px it measured 2.56:1 and failed WCAG AA. Hierarchy comes from size, weight and case.

### Semantic — four states, and only four

| State | Foreground | Background | Border | Meaning |
| --- | --- | --- | --- | --- |
| attention | `#b42318` | `#fef3f2` | `#fecdca` solid | Something needs a human decision now |
| clear | `#087443` | `#ecfdf3` | `#a9e5c3` solid | Swept a real population, found nothing |
| info | `#1d4ed8` | `#eff4ff` | `#c7d7fe` solid | Displays, does not judge |
| cannot evaluate | `#a15c07` | `#fffaeb` chip / `#fffdf5` card | `#f0c66b` **dashed** | The input it needed was not readable |

Supporting values: `#fee4e2` (attention count chip fill), `#065f38` (text on green tint), `#8a4b06`
(text on amber tint, and dashed-card footers).

**Cannot-evaluate always carries a second signal beyond hue: the border is dashed.** Amber alone is
a warning; dashed amber is "we do not know". This survives greyscale printing and every form of
colour blindness. Collapsing it into `clear` is a functional regression, not a style choice.

The accent is used **only** for identity and interactivity — never for state. Nothing that is
merely a status may be indigo, and nothing clickable may be red/amber/green/blue.

### Type

System stack only, unchanged: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.
Mono for everything log-derived — IDs, timestamps, paths, commands, row counts:
`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

| Role | Size | Weight | Tracking | Leading |
| --- | --- | --- | --- | --- |
| Page headline (phase) | 30px | 680 | −0.025em | 1.15 |
| Screen title | 22px | 680 | −0.02em | normal |
| Stat number | 28px (26px on Board) | 680 | −0.02em | 1.1, `tabular-nums` |
| Card / section header | 15px | 650 | −0.01em | normal |
| Item title | 14.5px | 600 | — | 1.4 |
| Body | 13.5px | 400 | — | 1.6 |
| Group label (uppercase) | 13px | 700 | .06em | — |
| Micro label (uppercase) | 11px | 700 | .07em | — |
| Provenance (mono) | 11.5px | 400 | — | — |
| Ticket card title | 13px | 550 | — | 1.4 |

### Space, radius, elevation

4px base. `4 · 8 · 12 · 16 · 20 · 28 · 40`.
Card padding 20px horizontal / 18px vertical. 28px between major sections. 12–16px between grid peers.
Page padding 28px top / 24px sides.

Radius: `12px` cards · `10px` ticket cards and panels · `8px` controls · `6px` chips · `999px` pills.

Shadow: `0 1px 2px rgba(20,20,10,.04)` on nav-active and cards; `0 12px 28px rgba(20,20,10,.12),
0 2px 6px rgba(20,20,10,.06)` on popovers only. Elevation is nearly absent by design — borders do
the work.

---

## Chrome

### Sidebar — `App.tsx`

248px expanded, **60px collapsed**, with a toggle at the foot. Contains, top to bottom: project
switcher (project name + `ios-app · tier-2`), nav section label, five nav items, runtime line
(`jsonl-scan · Node 20.14` / `log intact · 148 chained`), collapse button.
`position: sticky; top: 0; height: 100vh`.

Two implementation notes that cost real time to find:

- The `<aside>` must carry **`min-width: 0`** and `overflow: hidden`. As a flex item its default
  `min-width: auto` floors it at min-content width, and the 60px width is silently ignored.
- **Do not put a CSS transition on the width.** Any environment that throttles animation frames
  leaves the element pinned at its start width. The toggle is instant.

**The attention counts must survive the collapse.** In the rail, each count becomes a 14px red
numeral pinned to the icon's top-right with a 1.5px border in the sidebar fill. The rail is the
state an operator works the Board in, and with the health strip on Mission Control only, those
counts are the sole persistent cross-screen "something needs you" signal. Neutral counts (Team's
roster size) drop with the labels; only attention counts are promoted.

### Top bar — 56px, sticky

Breadcrumb · search · connection pill · source chip · operator avatar.

**The shrink order is fixed and it matters.** Getting this wrong produces painted collisions:

- Breadcrumb: `flex: 0 0 auto`, never yields. The project segment truncates at `max-width: 140px`;
  the screen name never truncates.
- Right cluster: `flex: 0 0 auto`, never yields. All three children fixed.
- Search: the **sole** flexible item — `flex: 0 1 240px`, `min-width: 34px`, `overflow: hidden`.
  It collapses toward an icon-only box.

Give any container in this bar `min-width: 0` and the shrink lands on the wrong element.

### Provenance, at three volumes

| Surface | Where | Says |
| --- | --- | --- |
| Source chip | Top bar, **every screen**, always | `all 8 sources` (green) or `6 of 8 sources` (amber). Opens an 8-row panel. |
| Health strip | **Mission Control only** | Full-width amber sentence naming the unreadable files. |
| Source panel | Under the bar, on click | Every source with a state dot and its row count or failure. |

The strip renders on Mission Control and nowhere else. On the other four screens the chip carries
the same fact. Rendering it everywhere makes it wallpaper within a week — and with `journeys` and
`verification` routinely absent, it would be permanently on. Nothing is hidden by this: the chip is
present on every screen in both states.

**The chip's healthy state is green and explicit, never absent.** An empty slot where a verdict
belongs is the exact failure this page exists to prevent.

### Connection pill — two states

- Live: `#ecfdf3` / `#a9e5c3` solid, green dot, `live · 14:22:06Z`
- Dropped: `#fffdf5` / `#f0c66b` **dashed**, `stream dropped · last read 14:22:06Z`

Bind the second to the `EventSource.onerror` that `App.tsx` already detects. A dot that is always
green is decoration. Dashed, like every other "we cannot know" on the page: a page that stopped
receiving updates is not reporting a problem, it is reporting that it can no longer tell you.

---

## Screens

### 1 · Mission Control

Order is the deliverable and it is unchanged from today's intent: **cause before consequence**.

1. **Phase headline** — 30px, with the derivation stated beneath (`derived — the log records no
   phase marker`) and an attention pill on the right.
2. **Why work is not moving** — the only tinted card on the page. Rows are a
   `120px 1fr 230px` grid: state chip · ID + title + reason · owner avatar + timing. Footer carries
   the swept line.
3. **Budget position** — five stat cards. The fifth is `not measurable` in a dashed amber card, not
   `$0.00`. The harness cannot measure token spend, and a fabricated zero on the one screen a
   founder reads for money is the worst possible invented number.
4. **Latest verification / Build** — two-up. Verification is dashed amber (cannot evaluate); Build
   is a neutral info card with the actor's avatar and a relative timestamp.
5. **Active agents** — four avatar + name + action-count cards.

### 2 · Communications

Screen title, thread count, and the channel pills right-aligned in the same row.

- **Open questions nobody answered** — attention card, above the threads, always first.
- **Channel pills** filter the thread list. Counts are **thread** counts and must agree with what
  renders. In the prototype `#ios` → both threads, `#product` → APP-004, `#artifacts` → APP-003.
- **Threads** are cards with a header (ID · title · status chip · message count) and messages as
  `32px 1fr` grid rows: avatar, then sender → recipients, kind chip, timestamp, summary, body,
  metadata chips.
- A message from the generated Markdown view renders a **dashed amber note** saying its metadata is
  unknown — never empty metadata chips. An empty chip reads as "delivered nothing", which would be
  a finding about the team invented out of a file format.
- **Empty filter state**: `No thread matches this filter. N thread(s) were read from <source>` in a
  verdict bar. The prototype's data reaches every channel so it cannot be seen there — build it.

Kind chips map to the semantic palette by meaning: question → amber (unanswered), answer and
decision → green and accent (resolved), escalation and blocker → red (needs a human), fyi → blue,
handoff → neutral (moves work without judging it).

### 3 · Board

Toolbar: owner filter · group-by · attention pill, right-aligned beside the title.

- **Needs attention** — attention card listing blocked, stranded and unowned tickets.
- **Kanban** — `grid-template-columns: repeat(5, 254px)`, 14px gap, inside an `overflow-x: auto`
  wrapper. **A fixed track, never flex-grow, never `minmax(0, …)`** — `0` as the minimum lets every
  track shrink to nothing and squashes the cards instead of scrolling. 254 is derived, not chosen:
  5×254 + 4×14 = 1326px, plus 48px content padding and the 60px rail = 1434px, the widest the board
  can be and still fit a 1440px laptop with the sidebar collapsed.
  An empty column says `no tickets in review` in a dashed box — it never renders as a void.
  The blocked column tints; the others do not.
- **Ticket card**: ID (accent, mono) · title · owner avatar · flag chips. `qa (static only)` and
  `stranded` are dashed amber; `needs APP-002` is blue. Unassigned renders as a **red `?` avatar** —
  the absence of an owner is a finding, not a person.
- **Five metric cards**, then the **workload table**. `n/a`, never `0%` — an empty denominator reads
  as "every review failed". Non-zero counts in blocked/stranded/static-only columns take their
  semantic colour and 650 weight; zeros are `--text-3`.

### 4 · Team

Title, tier, product type and state counts inline in the subtitle. Then the CLEAR verdict bar, then
the roster table.

Every role gets a row, including `off` ones, **with the recorded reason**. Off rows sit on
`--surface-footer` with a hollow state dot and muted role name — de-emphasised, never hidden. A role
missing from the roster is not "off", it is unaccounted for, so hiding off rows in the UI recreates
exactly the state the roster file was written to prevent.

### 5 · Founder Inbox

Each item is an attention card carrying three things and no fourth:

1. **Context**, quoted from the log — a `blockquote` with a 3px left border on sunken fill, under a
   micro label reading `Context, quoted from the log`.
2. **Recommendation**, quoted with its source named — or, when none exists, a dashed amber box:
   *"None recorded. Nobody proposed a remedy for this escalation in the log. This page does not
   compose one."* The UI never composes a recommendation.
3. **Action** — a prefilled form running one whitelisted CLI command, labelled with the script it
   shells out to.

Result block: green `#ecfdf3` on exit 0, showing `$ command` / `exit N` / output. Amber `#fffaeb`
for a refusal, printed **verbatim** with the whitelist. Red is reserved for a failed command — a
non-zero exit that was not a refusal. A refusal is a finding, not an error to swallow.

---

## Component states

### Nav item
| State | Fill | Border | Text |
| --- | --- | --- | --- |
| default | transparent | transparent | `--text-2` |
| hover | `--line-soft` | transparent | `--text` |
| active | `--accent-soft` | `--accent-line` | `--accent-strong`, 600 |
| focus | as active | as active | + `box-shadow: 0 0 0 2px <local bg>, 0 0 0 4px #4f46e5` |

The 2px gap in the focus ring keeps it legible against tinted card headers. Apply the same ring to
every interactive element — this replaces the browser default.

### Action form
`default` → `submitting` (inputs disabled, button `#6c63e8`, label `running…`) → `success` (green
block) or `refused` (amber block).

### Avatar
Same hash as today, **one value changed**: `hsl(hash(name) 70% 92%)` fill,
`hsl(h 55% 29%)` text. The source's 32% lightness leaves several hues at 4.4:1, below AA at these
sizes; 29% clears every hue. Sizes 18 / 20 / 22 / 26 / 30 / 32px.
Two exceptions: an `off` role renders neutral grey, and `unassigned` renders as a red `?`.

---

## Icons

All hand-authored inline SVG, 24×24 viewBox, `stroke-width: 2`, round caps and joins, `currentColor`,
sized via props — same `Icon` wrapper as the existing set. **No icon library.**

Five glyphs are new. The existing `icons.tsx` covers everything else.

| Name | Path | Use |
| --- | --- | --- |
| `ChevronDownIcon` | `m6 9 6 6 6-6` | Trailing disclosure on the source chip and every dropdown |
| `SearchIcon` | `circle cx=11 cy=11 r=7` + `m20 20-3.5-3.5` | Search field; the only thing left when it collapses |
| `SelectorIcon` | `m8 9 4-4 4 4` + `m16 15-4 4-4-4` | Project switcher — a two-way swap, so it must not reuse the chevron |
| `PanelIcon` | `rect x=3 y=4 w=18 h=16 rx=2.5` + `M9 4v16` | Sidebar collapse toggle |
| `FilterIcon` | `M3 5h18l-7 8v6l-4 2v-8z` | Leads every filter dropdown |
| `GroupIcon` | `rect x=3 y=4 w=18 h=7 rx=2` + `rect x=3 y=15 w=18 h=5 rx=2` | Leads the group-by dropdown |

The small state dots on kanban columns, role rows and the source list are **CSS circles, not SVG**.

**Icon rule: every element of a class gets one, or none of them do.** Icon-bearing classes are status
badges, message-kind chips, section headers, sidebar nav items, and toolbar dropdowns — *including*
the group-by control, which is the same class as the filter beside it. Non-bearing: flag chips on
ticket cards, metadata chips, table cells.

---

## Accessibility

Both prototype and spec were audited per element, computing the required ratio from each element's
own size and weight against its resolved background: **0 failures**. Preserve this.

- Every text token clears 4.5:1 at 11px. If you reintroduce a lighter grey for hierarchy, you have
  reintroduced the bug — the `swept …` provenance line is load-bearing evidence and was previously
  the least readable text on the page.
- Every state is distinguishable without colour: cannot-evaluate is dashed, attention is the only
  tinted card, every badge carries a glyph and a word.
- Focus rings are visible and on-brand on every interactive element.

---

## What must not regress

These come from the repo's own invariants. Each was learned by shipping the opposite.

1. **Zero runtime dependencies** beyond React 19 + React DOM. No icon library, no CSS framework, no
   charting or animation library. A repo-level check enforces it.
2. **No CDN, no external fonts, no external images.** System font stack only.
3. **Dark mode via `prefers-color-scheme` must keep working.** See *Open questions*.
4. **Read-only projection.** No drag-to-reorder on the kanban. The board is a read projection, and
   any interaction implying otherwise is a lie about what the page can do.
5. **Degrade honestly.** The four-state model is preserved exactly. No section renders empty as if
   it were clear. Every section states the population it swept.
6. **Render only what the log can produce.** No fabricated chatter, no invented recommendations, no
   synthesised numbers. `not measurable` and `n/a` are real values.

---

## Files in this bundle

```
Control Room - Redesign v2.dc.html   the deliverable — five screens, interactive
Control Room - Spec.dc.html          tokens, type, spacing, all component states, variations
Control Room - Current.dc.html       today's UI, recreated, for comparison
support.js                           runtime the three HTML files need — keep alongside
```

Target files in the codebase: `src/App.tsx` (shell, sidebar, top bar), `src/screens/*.tsx`,
`src/ui.tsx` (StatusBadge, SectionCard, ItemList, Avatar, ActionForm — add VerdictBar),
`src/icons.tsx`, `src/styles.css`.

---

## Open questions for the founder

1. **Dark mode.** The redesign specifies light only, by request. The app currently supports dark via
   `prefers-color-scheme` and that must not regress — the dark palette needs deriving before this
   ships. Ask before inventing one.
2. **Search is drawn but not wired.** The top-bar field is chrome in the prototype. Decide whether
   it searches tickets, messages and roles client-side over `/state`, or is deferred.
3. **Board toolbar filters** (owner, group-by) and **Team's state filter** are likewise drawn, not
   wired. The channel filter on Communications *is* wired and can serve as the pattern.
4. **Project switcher** in the sidebar implies multiple projects. The server takes a single
   `--project` flag, so this is currently a label, not a control.
