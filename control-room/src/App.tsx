/**
 * Five screens, one fetch, one SSE subscription.
 *
 * The header is not chrome. It carries the source pills, the log's tamper-evidence verdict and the
 * read path (`jsonl-scan` or a SQLite projection), because "which inputs produced this page" is a
 * fact the page must never make you guess at. A source that could not be read is a red pill with
 * the reason in its tooltip, on every screen, always.
 */
import { useCallback, useEffect, useState } from 'react';
import type { BoardScreen, CommsScreen, Screen, State, TeamScreen } from './types';
import { StatusBadge } from './ui';
import { RadarIcon, MessageIcon, ColumnsIcon, UsersIcon, InboxIcon, ShieldIcon, ShieldAlertIcon, LayersIcon, CheckCircleIcon, AlertTriangleIcon, type IconComponent } from './icons';
import Mission from './screens/Mission';
import Comms from './screens/Comms';
import Board from './screens/Board';
import Team from './screens/Team';
import Inbox from './screens/Inbox';
import './styles.css';

const ORDER = ['mission', 'comms', 'board', 'team', 'inbox'] as const;
const NAV_ICON: Record<(typeof ORDER)[number], IconComponent> = {
  mission: RadarIcon,
  comms: MessageIcon,
  board: ColumnsIcon,
  team: UsersIcon,
  inbox: InboxIcon,
};

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string>('');
  const [tab, setTab] = useState<string>('mission');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/state');
      if (!res.ok) throw new Error(`GET /state responded ${res.status}`);
      setState(await res.json());
      setError('');
    } catch (e) {
      // Never fall back to the last good state silently: a stale page that looks live is a page
      // that reports yesterday's clear as today's.
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
    const es = new EventSource('/events');
    es.onmessage = () => load();
    es.onerror = () => setError('the /events stream dropped — this page is no longer live and may be stale');
    return () => es.close();
  }, [load]);

  if (error && !state) return <main className="boot">Could not reach /state: {error}</main>;
  if (!state) return <main className="boot">loading…</main>;

  const screens = new Map(state.screens.map((s) => [s.id, s]));
  const current = screens.get(tab) as Screen;

  return (
    <main>
      <header className="top">
        <div className="brand">
          <span className="brandmark">
            <LayersIcon size={18} />
          </span>
          <div>
            <h1>Studio control room</h1>
            <div className="brand-meta mono">
              {state.project} · {state.generatedAt}
              {state.readFrom ? ` · tickets from ${state.readFrom}` : ''} · {state.runtime.mode} on Node {state.runtime.node}
            </div>
          </div>
        </div>
        <div className="pills">
          {state.sources.map((s) => (
            <span className={`pill${s.ok ? ' good' : ' bad'}`} key={s.id} title={s.note || `${s.path} read`}>
              {s.ok ? <CheckCircleIcon size={12} /> : <AlertTriangleIcon size={12} />}
              {s.id} {s.ok ? '' : '— unavailable'}
            </span>
          ))}
          {/* A rewritten `approved` is the cheapest way past a failed gate. A control room that
              showed the state without saying whether the log still hashes would report a forgery. */}
          <span className={`pill${state.chain.ok ? ' good' : ' bad'}`} title={state.chain.reason || `${state.chain.chained} chained, ${state.chain.unchained} unchained`}>
            {state.chain.ok ? <ShieldIcon size={12} /> : <ShieldAlertIcon size={12} />}
            {state.chain.ok
              ? `log intact (${state.chain.chained} chained, ${state.chain.unchained} unchained)`
              : `LOG TAMPER: line ${state.chain.line}`}
          </span>
          {state.violations.length ? <span className="pill bad">{state.violations.length} log violation(s)</span> : null}
        </div>
      </header>

      {error ? <p className="banner bad">{error}</p> : null}
      {!state.runtime.available ? <p className="footnote">{state.runtime.note}</p> : null}

      <nav>
        {ORDER.map((id) => {
          const screen = screens.get(id);
          if (!screen) return null;
          const Glyph = NAV_ICON[id];
          return (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              <Glyph size={16} />
              {screen.title}
              <StatusBadge status={screen.status} count={typeof screen.count === 'number' ? (screen.count as number) : undefined} />
            </button>
          );
        })}
      </nav>

      <div className="screen">
        {tab === 'mission' ? <Mission screen={current} /> : null}
        {tab === 'comms' ? <Comms screen={current as CommsScreen} /> : null}
        {tab === 'board' ? <Board screen={current as BoardScreen} /> : null}
        {tab === 'team' ? <Team screen={current as TeamScreen} /> : null}
        {tab === 'inbox' ? <Inbox screen={current} state={state} onDone={load} /> : null}
      </div>

      <p className="footnote">
        A projection. Nothing on this page writes state — every action shells out to{' '}
        <code>scripts/board.mjs</code> and <code>scripts/team-message.sh</code>, the same validated CLI the agents use,
        and shows you the command and its exit code. A refusal is printed verbatim, because a refusal is a finding.
        The zero-dependency diagnostic dashboard (<code>node scripts/studio-dashboard.mjs</code>) still exists and
        still works when this build does not.
      </p>
    </main>
  );
}
