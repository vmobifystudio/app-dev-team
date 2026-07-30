/**
 * A render smoke test, run against a REAL project's `/state` rather than a fixture object.
 *
 *   node control-room/server.mjs --project <dir> --port 4174 &
 *   cd control-room && npx vite build --ssr src/smoke.tsx --outDir .smoke && node .smoke/smoke.js http://127.0.0.1:4174/state
 *
 * TypeScript proves the shapes line up; only rendering proves a screen does not deref a null on the
 * one degrade path nobody thought about. Every screen is rendered, not just the default tab —
 * a crash on the tab you did not click is still a crash.
 */
import { renderToString } from 'react-dom/server';
import type { BoardScreen, CommsScreen, Screen, State, TeamScreen } from './types';
import Mission from './screens/Mission';
import Comms from './screens/Comms';
import Board from './screens/Board';
import Team from './screens/Team';
import Inbox from './screens/Inbox';

const url = process.argv[2] || 'http://127.0.0.1:4174/state';

async function main() {
const state: State = await fetch(url).then((r) => r.json());
const find = (id: string) => state.screens.find((s) => s.id === id) as Screen;

const rendered: Record<string, string> = {
  mission: renderToString(<Mission screen={find('mission')} />),
  comms: renderToString(<Comms screen={find('comms') as CommsScreen} />),
  board: renderToString(<Board screen={find('board') as BoardScreen} />),
  team: renderToString(<Team screen={find('team') as TeamScreen} />),
  inbox: renderToString(<Inbox screen={find('inbox')} state={state} onDone={() => {}} />),
};

for (const [id, html] of Object.entries(rendered)) {
  // 1. A screen that renders to almost nothing is the failure this whole project is about: it looks
  //    like a page with nothing wrong.
  if (html.length < 200) throw new Error(`${id} rendered ${html.length} bytes — a screen that renders to nothing reads as all-clear`);

  // 2. THE assertion. Every section the state marked `unavailable` must put CANNOT EVALUATE on the
  //    page, and no section may reach the page as an unexplained blank. Byte counts prove a
  //    component did not throw; only this proves it told the truth about what it could not read.
  const screen = find(id);
  const unavailable = screen.sections.filter((s) => s.status === 'unavailable');
  if (unavailable.length && !html.includes('CANNOT EVALUATE')) {
    throw new Error(`${id} has ${unavailable.length} unavailable section(s) and the words CANNOT EVALUATE appear nowhere on it`);
  }
  const clear = screen.sections.filter((s) => s.status === 'clear');
  if (!clear.length && html.includes('CLEAR —')) {
    throw new Error(`${id} rendered a CLEAR verdict for a section the state did not mark clear`);
  }
  process.stdout.write(`ok ${id} (${html.length} bytes, ${unavailable.length} unavailable, ${clear.length} clear)\n`);
}
}
main();
