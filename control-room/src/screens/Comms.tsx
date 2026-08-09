/**
 * Communications — channels and per-ticket threads, as a readable conversation.
 *
 * Two rules hold this screen honest.
 *
 * ONE: every message rendered here is a row of the log. There is no synthesised chatter and no
 * narrated thinking. Routine execution belongs in the compact system line, not in a speech bubble.
 *
 * TWO: the metadata panel beside each message is what makes this operational rather than
 * decorative — ticket, requirement, decision, the artifact it updated, whether a response is
 * required. When the source is the generated Markdown view, that metadata does not exist, and the
 * banner says so. It never renders an empty artifact chip, because an empty chip reads as
 * "delivered nothing" and that would be a finding about the team invented out of a file format.
 */
import { useState } from 'react';
import type { CommsScreen, Message, Thread } from '../types';
import { SectionCard, Avatar } from '../ui';
import { IconByKind, MessageIcon } from '../icons';

function Meta({ message, structured }: { message: Message; structured: boolean }) {
  const m = message.meta;
  const chips: [string, string][] = [];
  if (m.ticket && m.ticket !== '-') chips.push(['ticket', m.ticket]);
  if (m.requirements.length) chips.push(['requirement', m.requirements.join(', ')]);
  if (m.decision) chips.push(['decision', m.decision]);
  if (m.artifact) chips.push(['artifact updated', m.artifact]);
  if (m.transition) chips.push(['transition', m.transition]);
  if (m.evidence) chips.push(['evidence', m.evidence]);
  if (m.requiresResponse) chips.push(['verification required', m.expiresAfterRound === null ? 'yes' : `by round ${m.expiresAfterRound}`]);
  if (m.obligation) chips.push(['obligation', m.obligation]);

  if (!structured) {
    return <div className="meta unknown">metadata unknown — this row came from the generated Markdown view, which has no columns for it</div>;
  }
  if (!chips.length) {
    return <div className="meta unknown">no metadata on this record</div>;
  }
  return (
    <div className="meta">
      {chips.map(([label, value]) => (
        <span className="chip" key={label}>
          <span className="dim">{label}</span> {value}
        </span>
      ))}
    </div>
  );
}

function ThreadView({ thread, structured }: { thread: Thread; structured: boolean }) {
  return (
    <div className="thread">
      <h4>
        <MessageIcon size={14} />
        <span className="mono id">{thread.ticket}</span>
        {thread.ticketStatus ? <span className="dim"> {thread.ticketStatus}</span> : <span className="dim"> not on the board</span>}
        {thread.open ? <span className="tag open_question">{thread.open} open</span> : null}
      </h4>
      {thread.messages.map((message) => {
        const KindGlyph = IconByKind[message.kind];
        return (
          <article className={`message kind-${message.kind}`} key={message.id}>
            <Avatar name={message.from} />
            <div className="bubble">
              <div className="line">
                <b>{message.from}</b>
                <span className="dim">→ {message.to.join(', ') || 'nobody'}</span>
                <span className={`kindchip tag ${message.kind}`}>
                  {KindGlyph ? <KindGlyph size={10} /> : null}
                  {message.kind}
                </span>
                {message.provenance === 'inferred' ? <span className="tag inferred">reconstructed, not recorded</span> : null}
                <span className="mono faint" style={{ marginLeft: 'auto' }}>{message.ts}</span>
              </div>
              <p className="summary">{message.summary}</p>
              {message.body ? <p className="body">{message.body}</p> : null}
              <Meta message={message} structured={structured} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function Comms({ screen, query = '' }: { screen: CommsScreen; query?: string }) {
  const [channel, setChannel] = useState<string>('');
  const threads = screen.threads ?? [];
  const byChannel = channel ? threads.filter((t) => t.messages.some((m) => m.meta.channels.includes(channel))) : threads;
  const q = query.trim().toLowerCase();
  const shown = q
    ? byChannel.filter(
        (t) =>
          t.ticket.toLowerCase().includes(q) ||
          t.messages.some((m) => m.from.toLowerCase().includes(q) || m.summary.toLowerCase().includes(q))
      )
    : byChannel;

  return (
    <>
      {!screen.structured ? (
        <p className="banner">
          Reading <code>{screen.from}</code>, the generated Markdown view. It carries no structured metadata — ticket
          links, requirements, decisions, the artifact an answer was folded into and the obligation it satisfied are
          absent from the FILE, not from the team. <code>node scripts/messages.mjs migrate</code> reconstructs
          <code> docs/team/messages.jsonl</code>.
        </p>
      ) : null}

      {/* Open questions first, and loudest — a question nobody answered is how a guess becomes
          shipped behaviour, and one still open on a shipped ticket is worse. */}
      {screen.sections.map((section) => (
        <SectionCard key={section.id} section={section} />
      ))}

      {screen.channels.length ? (
        <div className="channels">
          <button className={channel === '' ? 'on' : ''} onClick={() => setChannel('')}>
            all threads ({threads.length})
          </button>
          {screen.channels.map((c) => (
            <button key={c.name} className={channel === c.name ? 'on' : ''} onClick={() => setChannel(c.name)}>
              #{c.name} ({c.count})
            </button>
          ))}
        </div>
      ) : (
        <p className="banner">
          No channel can be produced from this source. A channel is a query over the log — with no readable log there
          are no channels, which is not the same as a team with nothing to say.
        </p>
      )}

      {shown.length ? (
        shown.map((thread) => <ThreadView key={thread.ticket} thread={thread} structured={screen.structured} />)
      ) : (
        <p className="banner">
          No thread matches this filter. {threads.length} thread(s) were read from <code>{screen.from || 'nothing'}</code>.
        </p>
      )}
    </>
  );
}
