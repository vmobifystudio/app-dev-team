# control-room

The browser interface for `app-dev-team`. Five screens: **Mission Control · Communications · Board ·
Team · Founder Inbox**.

It lives here, with its own `package.json`, so the plugin stays zero-dependency.

---

## Install, dev, build

```bash
cd control-room
npm install          # React + TypeScript + Vite. Node 20 is the floor.
npm run build        # -> control-room/dist/
```

Then, from the **project you want to look at** (not from here):

```bash
node <plugin>/control-room/server.mjs --project . --port 4174
```

Live development, two terminals:

```bash
node control-room/server.mjs --project /path/to/project --port 4174   # data plane
cd control-room && npm run dev                                        # UI on :5174, proxied to 4174
```

The Vite proxy is not only convenience: it keeps the browser's `Origin` same-origin, so the dev
server exercises the same CSRF path as production. A dev setup that bypasses the guard is a dev
setup where the guard is never tested.

Flags: `--project DIR` · `--port N` · `--no-actions` (read-only) · `--dist DIR`.

## The render smoke test

```bash
node server.mjs --project /path/to/project --port 4174 &
npm run smoke -- http://127.0.0.1:4174/state
```

Server-renders **all five screens** against a real `/state` — not a fixture — and fails if any of
them renders to almost nothing, if a section the state marked `unavailable` produces a page with no
`CANNOT EVALUATE` on it, or if a `CLEAR` verdict appears for a section the state did not mark clear.
TypeScript proves the shapes line up; only rendering proves a screen does not deref a null on the
one degrade path nobody thought about, and only this proves it told the truth about what it could
not read.

Run it against a healthy project, an empty directory, and a project with a deliberately corrupted
`docs/31-board-events.jsonl`. It is not part of `sh scripts/test.sh`, deliberately: that suite must
pass with `node_modules` absent, and this needs the toolchain.

---

## The invariants

These are not style. Each one is a rule this repo learned by shipping the opposite.

**1. The plugin stays zero-dependency.** There is no `package.json` at the repository root and there
must never be one. `sh scripts/test.sh` and `node scripts/team-doctor.mjs` pass with
`control-room/node_modules` absent, and the suite asserts it. Nothing under `scripts/` or `hooks/`
may import from this directory or from any package.

**2. Two dashboards, permanently.** `scripts/studio-dashboard.mjs` is the **emergency / diagnostic**
interface: zero-dep, single file, no build step, works when the build stack is broken — which is
exactly when you need to see why. This is the **product**. Never make the only diagnostic tool
depend on the stack it may need to diagnose.

`server.mjs` is itself stdlib-only for the same reason: with `dist/` absent it still serves
`/state`, and the page it returns says which two commands build the UI. A blank page is
indistinguishable from a project with nothing wrong.

**3. The plugin must be correct with the UI absent.** This directory enhances visibility. It is
never required for correctness, and no gate, command or agent depends on it.

**4. Nothing writes state except the validated CLI.** Every action shells out to `scripts/board.mjs`
or `scripts/team-message.sh` — the same commands the agents run, with the same guards and the same
append-only log — via `execFile`, no shell. There is no `writeFileSync`, `appendFileSync` or
`createWriteStream` anywhere in this directory, and the suite greps for it. The page shows the
command it ran and its exit code, and **prints a refusal verbatim**: a refusal is a finding, not an
error to swallow.

The whitelist itself is `scripts/lib/actions.mjs`, shared with the emergency dashboard. Two copies
of a whitelist is two sets of rules about what a human may do to one board, and the drift between
them is invisible because both pages still work.

**5. Render only what the log can produce.** No fabricated agent chatter, no narrated thinking, no
synthesised progress. Routine execution appears as a compact system line. Every field on every
screen traces to `docs/31-board-events.jsonl`, `docs/team/messages.jsonl` (or its generated Markdown
view), `docs/31-board.md`, `docs/02-team-roster.md`, `docs/51-bugs.md` or `docs/33-rounds.jsonl`.
The moment the page shows something the log cannot produce, it becomes a second source of truth.

**6. Degrade honestly.** Every section states the population it swept and is exactly one of:

| status | means |
|---|---|
| `attention` | it found something |
| `clear` | it swept a real population and found nothing |
| `info` | it displays, it does not judge |
| `unavailable` | **CANNOT EVALUATE** — and it names the input it could not read |

`clear` is a claim that requires its inputs. A section whose inputs are missing is `unavailable`,
never `clear`, and never silently empty. There is no `if (!items.length) return null` in this
codebase — that one line is how a UI ships a screen full of nothing that reads as a screen full of
green. Sections with different inputs are kept separate for the same reason: merged, one verdict
would claim things the other half never swept.

---

## Layout

| Path | What |
|---|---|
| `server.mjs` | Node stdlib. `GET /state`, `GET /events` (SSE), `POST /action`, and `dist/`. Starts with `node_modules` absent |
| `state.mjs` | Node stdlib. Assembles the five screens. Reads nothing itself — every reader is `scripts/lib/project.mjs` |
| `src/` | React + TypeScript. The only part that needs the toolchain |
| `dist/` | Built output, gitignored |

Shared with the plugin, and deliberately living there rather than here:

| Path | Why it is shared |
|---|---|
| `scripts/lib/project.mjs` | The read layer. Both dashboards must agree about how many tickets there are and which file they came from |
| `scripts/lib/actions.mjs` | The action whitelist, its validators, and the CSRF guard |
| `scripts/lib/{board,events,messages}.mjs` | One parser per file. A renderer that disagrees with its validator is the defect class this repo names most often |

---

## SQLite

`node:sqlite` is stdlib from **Node 22.5** and would give the control room an indexed projection of
the log. Node 20 is the floor here and is LTS into 2026, so it is gated and reported in the header:
on any Node it degrades to a JSONL scan. It would be a **projection built from the log** either way —
the append-only log is the source of truth in both worlds, so its absence costs speed and nothing
else.
