/**
 * Board — kanban, per-owner load, NEEDS ATTENTION, and `qa (static only)` carried visibly.
 *
 * That last one is not a styling choice. `lib/board.mjs` splits the suffix off the status so every
 * downstream check keys on the bare word; a UI that then rendered the bare word would hide the one
 * fact a sprint must not close on — a ticket whose executable suite has never run. It is printed in
 * the cell a human reads, exactly as `board-render` writes it.
 */
import { useMemo, useState } from 'react';
import type { BoardScreen, BoardTicket } from '../types';
import { SectionCard, Avatar } from '../ui';
import { RefreshIcon, CircleDotIcon, EyeIcon, AlertOctagonIcon, CheckCircleIcon, ClockIcon, GitBranchIcon, FilterIcon, GroupIcon, ChevronDownIcon, type IconComponent } from '../icons';

const COLUMN_ICON: Record<string, IconComponent> = {
  todo: CircleDotIcon,
  in_progress: RefreshIcon,
  review: EyeIcon,
  blocked: AlertOctagonIcon,
  done: CheckCircleIcon,
};

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
const dur = (ms: number | null) => {
  if (ms === null) return 'n/a';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

function TicketCard({ ticket, showStatus }: { ticket: BoardTicket & { status?: string }; showStatus?: boolean }) {
  return (
    <div className={`ticket${ticket.stranded || ticket.status === 'blocked' ? ' flag' : ''}`}>
      <div className="tline">
        <span className="mono id">{ticket.id}</span>
        {showStatus && ticket.status ? <span className="dim">{ticket.status.replace('_', ' ')}</span> : null}
      </div>
      <span className="ttitle">{ticket.title}</span>
      <div className="towner">
        {ticket.owner ? <Avatar name={ticket.owner} size={18} /> : <Avatar name="unassigned" size={18} variant="unassigned" />}
        {ticket.owner || 'unassigned'}
      </div>
      {ticket.staticOnly || ticket.stranded || ticket.dependsOn.length ? (
        <div className="tflags">
          {ticket.staticOnly ? (
            <span className="tag static_only">
              <ClockIcon size={10} /> {ticket.display}
            </span>
          ) : null}
          {ticket.stranded ? (
            <span className="tag stranded">
              <AlertOctagonIcon size={10} /> stranded
            </span>
          ) : null}
          {ticket.dependsOn.length ? (
            <span className="tag working">
              <GitBranchIcon size={10} /> needs {ticket.dependsOn.join(', ')}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function Board({ screen, query = '' }: { screen: BoardScreen; query?: string }) {
  const [owner, setOwner] = useState('');
  const [groupBy, setGroupBy] = useState<'status' | 'owner'>('status');

  const q = query.trim().toLowerCase();
  const matches = (t: BoardTicket) =>
    (!owner || t.owner === owner) &&
    (!q || t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || (t.owner || '').toLowerCase().includes(q));

  const statusColumns = useMemo(
    () => screen.columns.map((c) => ({ status: c.status, tickets: c.tickets.filter(matches) })),
    [screen.columns, owner, q]
  );

  const ownerColumns = useMemo(() => {
    const byOwner = new Map<string, (BoardTicket & { status: string })[]>();
    for (const col of screen.columns) {
      for (const t of col.tickets) {
        if (!matches(t)) continue;
        const key = t.owner || 'unassigned';
        if (!byOwner.has(key)) byOwner.set(key, []);
        byOwner.get(key)!.push({ ...t, status: col.status });
      }
    }
    return [...byOwner.entries()].map(([o, tickets]) => ({ status: o, tickets }));
  }, [screen.columns, owner, q]);

  const columns = groupBy === 'status' ? statusColumns : ownerColumns;

  return (
    <>
      <div className="toolbar">
        <div className="title-row">
          <p className="swept top" style={{ margin: 0 }}>
            swept: {screen.swept}
          </p>
        </div>
        {screen.owners.length ? (
          <label className="dropdown">
            <FilterIcon size={13} />
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">all owners</option>
              {screen.owners.map((o) => (
                <option key={o.owner} value={o.owner}>
                  {o.owner}
                </option>
              ))}
            </select>
            <ChevronDownIcon size={12} />
          </label>
        ) : null}
        <label className="dropdown">
          <GroupIcon size={13} />
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'status' | 'owner')}>
            <option value="status">group by status</option>
            <option value="owner">group by owner</option>
          </select>
          <ChevronDownIcon size={12} />
        </label>
      </div>

      {screen.note ? <p className="banner">{screen.note}</p> : null}

      {screen.sections.map((section) => (
        <SectionCard key={section.id} section={section} />
      ))}

      {screen.columns.length ? (
        <div className="scroll">
          <div className="kanban" style={groupBy === 'owner' ? { gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, 254px)` } : undefined}>
            {columns.map((column) => {
              const Glyph = groupBy === 'status' ? (COLUMN_ICON[column.status] ?? CircleDotIcon) : undefined;
              return (
                <div className="col" data-status={groupBy === 'status' ? column.status : undefined} key={column.status}>
                  <h4>
                    {Glyph ? <Glyph size={13} /> : <Avatar name={column.status} size={16} variant={column.status === 'unassigned' ? 'unassigned' : undefined} />}
                    {groupBy === 'status' ? column.status.replace('_', ' ') : column.status}
                    <span className="colcount">{column.tickets.length}</span>
                  </h4>
                  {column.tickets.length ? (
                    column.tickets.map((ticket) => <TicketCard ticket={ticket} key={ticket.id} showStatus={groupBy === 'owner'} />)
                  ) : (
                    <p className="col-empty">no tickets {groupBy === 'status' ? `in ${column.status.replace('_', ' ')}` : 'here'}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="banner">No ticket table could be read, so there is no kanban. That is not an empty sprint.</p>
      )}

      {screen.owners.length ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                {['Owner', 'Open', 'In progress', 'In review', 'Blocked', 'Stranded', 'Static only'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {screen.owners.map((o) => (
                <tr key={o.owner}>
                  <td>{o.owner}</td>
                  <td>{o.open}</td>
                  <td>{o.inProgress}</td>
                  <td>{o.review}</td>
                  <td>{o.blocked}</td>
                  <td>{o.stranded}</td>
                  <td>{o.staticOnly}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {screen.metrics ? (
        <div className="metrics">
          <div className="metric">
            <span className="micon"><ClockIcon size={17} /></span>
            <div>
              <b>{dur(screen.metrics.medianCycleTimeMs)}</b>
              <span className="dim">cycle time (median), claimed → closed</span>
            </div>
          </div>
          <div className="metric">
            {/* n/a, never 0% — an empty denominator reads as "every review failed". */}
            <span className="micon"><CheckCircleIcon size={17} /></span>
            <div>
              <b>{pct(screen.metrics.reviewPassRate)}</b>
              <span className="dim">review pass rate · {screen.metrics.reachedReview} reached review</span>
            </div>
          </div>
          <div className="metric">
            <span className="micon"><RefreshIcon size={17} /></span>
            <div>
              <b>{pct(screen.metrics.reworkRate)}</b>
              <span className="dim">rework rate</span>
            </div>
          </div>
          <div className="metric">
            <span className="micon"><AlertOctagonIcon size={17} /></span>
            <div>
              <b>{Object.values(screen.metrics.gateFires).reduce((a, b) => a + b, 0)}</b>
              <span className="dim">
                gates fired ·{' '}
                {Object.entries(screen.metrics.gateFires)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(' · ')}
              </span>
            </div>
          </div>
          <div className="metric">
            <span className="micon"><EyeIcon size={17} /></span>
            <div>
              <b>{screen.metrics.reviewerActions}</b>
              <span className="dim">reviewer actions in the whole log</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="banner">CANNOT EVALUATE — {screen.metricsNote}</p>
      )}
    </>
  );
}
