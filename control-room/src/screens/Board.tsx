/**
 * Board — kanban, per-owner load, NEEDS ATTENTION, and `qa (static only)` carried visibly.
 *
 * That last one is not a styling choice. `lib/board.mjs` splits the suffix off the status so every
 * downstream check keys on the bare word; a UI that then rendered the bare word would hide the one
 * fact a sprint must not close on — a ticket whose executable suite has never run. It is printed in
 * the cell a human reads, exactly as `board-render` writes it.
 */
import type { BoardScreen } from '../types';
import { SectionCard } from '../ui';

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
const dur = (ms: number | null) => {
  if (ms === null) return 'n/a';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default function Board({ screen }: { screen: BoardScreen }) {
  return (
    <>
      <p className="swept top">swept: {screen.swept}</p>
      {screen.note ? <p className="banner">{screen.note}</p> : null}

      {screen.sections.map((section) => (
        <SectionCard key={section.id} section={section} />
      ))}

      {screen.columns.length ? (
        <div className="scroll">
          <div className="kanban">
            {screen.columns.map((column) => (
              <div className="col" key={column.status}>
                <h4>
                  {column.status.replace('_', ' ')} ({column.tickets.length})
                </h4>
                {column.tickets.map((ticket) => (
                  <div className={`ticket${ticket.stranded || column.status === 'blocked' ? ' flag' : ''}`} key={ticket.id}>
                    <b className="mono">{ticket.id}</b> {ticket.title}
                    <div className="dim">
                      {ticket.owner || 'unassigned'}
                      {ticket.staticOnly ? ` · ${ticket.display}` : ''}
                      {ticket.stranded ? ' · STRANDED' : ''}
                      {ticket.dependsOn.length ? ` · depends on ${ticket.dependsOn.join(', ')}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            ))}
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
            <b>{dur(screen.metrics.medianCycleTimeMs)}</b>
            <span className="dim">cycle time (median), claimed → closed</span>
          </div>
          <div className="metric">
            {/* n/a, never 0% — an empty denominator reads as "every review failed". */}
            <b>{pct(screen.metrics.reviewPassRate)}</b>
            <span className="dim">review pass rate · {screen.metrics.reachedReview} reached review</span>
          </div>
          <div className="metric">
            <b>{pct(screen.metrics.reworkRate)}</b>
            <span className="dim">rework rate</span>
          </div>
          <div className="metric">
            <b>{Object.values(screen.metrics.gateFires).reduce((a, b) => a + b, 0)}</b>
            <span className="dim">
              gates fired ·{' '}
              {Object.entries(screen.metrics.gateFires)
                .map(([k, v]) => `${k} ${v}`)
                .join(' · ')}
            </span>
          </div>
          <div className="metric">
            <b>{screen.metrics.reviewerActions}</b>
            <span className="dim">reviewer actions in the whole log</span>
          </div>
        </div>
      ) : (
        <p className="banner">CANNOT EVALUATE — {screen.metricsNote}</p>
      )}
    </>
  );
}
