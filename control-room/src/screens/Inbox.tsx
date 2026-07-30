/**
 * Founder Inbox — the screen that replaces talking to N agents.
 *
 * Each item carries three things and no fourth: the CONTEXT (quoted from the log), the
 * RECOMMENDATION (quoted from the log, with its source named — or the explicit statement that
 * nobody recorded one), and the ACTION, which is a whitelisted CLI invocation, prefilled.
 *
 * "Nobody proposed a remedy" is itself a finding, and printing that is the entire difference
 * between an inbox and a page that makes up advice. This UI never composes a recommendation.
 */
import type { InboxItem, Screen, State } from '../types';
import { ActionForm, StatusBadge } from '../ui';

export default function Inbox({ screen, state, onDone }: { screen: Screen; state: State; onDone: () => void }) {
  const section = screen.sections[0];
  const items = (section?.items ?? []) as unknown as InboxItem[];

  return (
    <>
      <div className="headline">
        <div>
          <span className="dim">decisions required</span>
          <b>{String(screen.count ?? items.length)}</b>
          <span className="dim">swept: {section?.swept}</span>
        </div>
        <StatusBadge status={screen.status} count={items.length} />
      </div>

      {section?.note ? <p className="banner">{section.note}</p> : null}

      {section?.status === 'unavailable' ? (
        <p className="verdict cannot">CANNOT EVALUATE — {section.note}</p>
      ) : items.length === 0 ? (
        <p className="verdict clear">CLEAR — {section?.clearNote}</p>
      ) : (
        items.map((item) => (
          <section className="decision card" data-status="attention" key={`${item.kind}-${item.id}-${item.since}`}>
            <header>
              <span className={`tag ${item.kind}`}>{item.kind.replace(/_/g, ' ')}</span>
              <span className="mono id">{item.id}</span>
              <h3>{item.title}</h3>
              <span className="dim mono">
                {item.owner} · since {item.since}
              </span>
            </header>
            <p className="context">{item.context}</p>
            {item.recommendation ? (
              <p className="recommendation">
                <b>Recommendation:</b> {item.recommendation.text}
                <span className="dim"> — {item.recommendation.source}</span>
              </p>
            ) : (
              <p className="recommendation none">
                <b>No recommendation.</b> {item.recommendationNote}
              </p>
            )}
            {state.actionForms[item.action.name] ? (
              <ActionForm
                name={item.action.name}
                spec={state.actionForms[item.action.name]}
                prefill={item.action.prefill}
                onDone={onDone}
              />
            ) : (
              <p className="dim">actions are disabled on this control room</p>
            )}
          </section>
        ))
      )}
    </>
  );
}
