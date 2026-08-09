/**
 * Five screens, one fetch, one SSE subscription.
 *
 * The chrome is not decoration. The source chip carries "which inputs produced this page" on every
 * screen, always; the connection pill tells you the moment the page stops being live rather than
 * silently going stale; the sidebar's attention counts survive collapse because the rail is the
 * state an operator works the Board in, and it is the only persistent cross-screen "something needs
 * you" signal outside Mission Control's own health strip.
 */
import { useCallback, useEffect, useState } from 'react';
import type { BoardScreen, CommsScreen, Screen, State, TeamScreen } from './types';
import { StatusBadge } from './ui';
import {
  RadarIcon,
  MessageIcon,
  ColumnsIcon,
  UsersIcon,
  InboxIcon,
  ShieldIcon,
  ShieldAlertIcon,
  LayersIcon,
  AlertTriangleIcon,
  PanelIcon,
  SearchIcon,
  ChevronDownIcon,
  type IconComponent,
} from './icons';
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
const TITLE: Record<(typeof ORDER)[number], string> = {
  mission: 'Mission Control',
  comms: 'Communications',
  board: 'Board',
  team: 'Team',
  inbox: 'Founder Inbox',
};

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string>('');
  const [tab, setTab] = useState<string>('mission');
  const [collapsed, setCollapsed] = useState(false);
  const [srcPanel, setSrcPanel] = useState(false);
  const [query, setQuery] = useState('');
  const [live, setLive] = useState(true);
  const [lastEventAt, setLastEventAt] = useState<string>('');

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
    es.onmessage = () => {
      setLive(true);
      setLastEventAt(new Date().toISOString().slice(11, 19) + 'Z');
      load();
    };
    es.onerror = () => {
      setLive(false);
      setError('the /events stream dropped — this page is no longer live and may be stale');
    };
    return () => es.close();
  }, [load]);

  if (error && !state) return <main className="boot">Could not reach /state: {error}</main>;
  if (!state) return <main className="boot">loading…</main>;

  const screens = new Map(state.screens.map((s) => [s.id, s]));
  const current = screens.get(tab) as Screen;
  const unreadableSources = state.sources.filter((s) => !s.ok);

  return (
    <main>
      <div className="shell">
        <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
          <div className="switcher">
            <span className="brandmark">
              <LayersIcon size={16} />
            </span>
            <div className="who">
              <b>{state.project}</b>
              <span>{(state.screens.find((s) => s.id === 'team') as TeamScreen | undefined)?.tier || 'tier not recorded'}</span>
            </div>
          </div>

          <div className="navlabel">Screens</div>
          <nav className="sidenav">
            {ORDER.map((id) => {
              const screen = screens.get(id);
              if (!screen) return null;
              const Glyph = NAV_ICON[id];
              const count = typeof screen.count === 'number' ? (screen.count as number) : undefined;
              const isAttention = screen.status === 'attention';
              return (
                <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} title={screen.title}>
                  <Glyph size={16} />
                  <span className="label">{screen.title}</span>
                  {count && !collapsed ? <span className="navcount">{count}</span> : null}
                  <span className={`navdot${isAttention && count ? ' show' : ''}`}>{count}</span>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-runtime mono">
            jsonl-scan · Node {state.runtime.node}
            <br />
            {state.chain.ok ? `log intact · ${state.chain.chained} chained` : `LOG TAMPER: line ${state.chain.line}`}
          </div>
          <button className="sidebar-collapse" onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'expand' : 'collapse'}>
            <PanelIcon size={15} />
            {!collapsed ? <span>Collapse</span> : null}
          </button>
        </aside>

        <div className="main-col">
          <header className="top">
            <div className="crumb">
              <span className="proj">{state.project}</span>
              <ChevronDownIcon size={13} />
              <span className="screen-name">{TITLE[tab as (typeof ORDER)[number]] ?? current?.title}</span>
            </div>

            <div className="topsearch">
              <label>
                <SearchIcon size={14} />
                <input
                  placeholder="Search tickets, threads, roles…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search"
                />
              </label>
            </div>

            <div className="topright" style={{ position: 'relative' }}>
              <span className={`connpill${live ? '' : ' dropped'}`}>
                <span className="dot" />
                {live ? `live${lastEventAt ? ` · ${lastEventAt}` : ''}` : `stream dropped${lastEventAt ? ` · last read ${lastEventAt}` : ''}`}
              </span>

              <span className={`srcchip${unreadableSources.length ? ' bad' : ''}`} onClick={() => setSrcPanel((v) => !v)}>
                {unreadableSources.length ? <AlertTriangleIcon size={12} /> : <ShieldIcon size={12} />}
                {unreadableSources.length ? `${state.sources.length - unreadableSources.length} of ${state.sources.length} sources` : `all ${state.sources.length} sources`}
                <ChevronDownIcon size={12} />
              </span>

              {srcPanel ? (
                <div className="srcpanel">
                  {state.sources.map((s) => (
                    <div className={`srcrow${s.ok ? '' : ' bad'}`} key={s.id}>
                      <span className="sdot" />
                      <div className="srctext">
                        <span className="mono">{s.id}</span>
                        {s.ok ? <span className="scount mono">ok</span> : <p className="scount">{s.note || 'unavailable'}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <span title={state.project}>
                <StatusBadge status={current?.status ?? 'info'} />
              </span>
            </div>
          </header>

          {tab === 'mission' && unreadableSources.length ? (
            <div className="healthstrip">
              <AlertTriangleIcon size={15} />
              <span>
                {unreadableSources.length} of {state.sources.length} source(s) could not be read:{' '}
                {unreadableSources.map((s) => `${s.id} (${s.note || 'unavailable'})`).join(', ')}.
              </span>
            </div>
          ) : null}

          {error ? <p className="banner bad" style={{ margin: '16px 24px 0' }}>{error}</p> : null}
          {!state.runtime.available ? <p className="footnote" style={{ margin: '16px 24px 0' }}>{state.runtime.note}</p> : null}
          {state.violations.length ? (
            <p className="banner bad" style={{ margin: '16px 24px 0' }}>{state.violations.length} log violation(s) recorded.</p>
          ) : null}
          {!state.chain.ok ? (
            <p className="banner bad icon" style={{ margin: '16px 24px 0' }}>
              <ShieldAlertIcon size={14} /> LOG TAMPER: line {state.chain.line}
            </p>
          ) : null}

          <div className="screen">
            {tab === 'mission' ? <Mission screen={current} /> : null}
            {tab === 'comms' ? <Comms screen={current as CommsScreen} query={query} /> : null}
            {tab === 'board' ? <Board screen={current as BoardScreen} query={query} /> : null}
            {tab === 'team' ? <Team screen={current as TeamScreen} query={query} /> : null}
            {tab === 'inbox' ? <Inbox screen={current} state={state} onDone={load} /> : null}

            <p className="footnote">
              A projection. Nothing on this page writes state — every action shells out to{' '}
              <code>scripts/board.mjs</code> and <code>scripts/team-message.sh</code>, the same validated CLI the agents use,
              and shows you the command and its exit code. A refusal is printed verbatim, because a refusal is a finding.
              The zero-dependency diagnostic dashboard (<code>node scripts/studio-dashboard.mjs</code>) still exists and
              still works when this build does not.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
