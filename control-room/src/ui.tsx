/**
 * The four components every screen is built from.
 *
 * `SectionCard` is the important one, and its job is to make the honest degrade unskippable: it
 * renders the swept population on every section, and it has no branch that produces an empty body.
 * A section is one of four things and each has its own visible words:
 *
 *   attention    the list
 *   clear        "CLEAR — <what it swept and found nothing in>"
 *   info         the list, or "nothing recorded"
 *   unavailable  "CANNOT EVALUATE — <which input was missing>"
 *
 * There is deliberately no `if (!items.length) return null`. That one line is how a UI ships a
 * screen full of nothing that reads as a screen full of green.
 */
import { useState, type ReactNode } from 'react';
import type { ActionResult, Field, Item, Section, Status } from './types';

export function StatusBadge({ status, count }: { status: Status; count?: number }) {
  const label =
    status === 'attention' ? `${count ?? ''} need attention`.trim() : status === 'unavailable' ? 'cannot evaluate' : status;
  return <span className={`badge ${status}`}>{label}</span>;
}

export function SectionCard({ section, children }: { section: Section; children?: ReactNode }) {
  const { status, items } = section;
  return (
    <section className="card" data-status={status}>
      <header>
        <h3>{section.title}</h3>
        <StatusBadge status={status} count={items.length} />
      </header>
      <p className="swept">swept: {section.swept}</p>
      {section.note ? <p className="note">{section.note}</p> : null}
      {children}
      {status === 'unavailable' ? (
        <p className="verdict cannot">CANNOT EVALUATE{section.note ? '' : ' — the input this section needs was not readable'}</p>
      ) : items.length ? (
        <ItemList items={items} />
      ) : status === 'clear' ? (
        <p className="verdict clear">CLEAR — {section.clearNote || 'nothing found in the population above'}</p>
      ) : (
        <p className="verdict">nothing recorded in the population above</p>
      )}
    </section>
  );
}

export function ItemList({ items }: { items: Item[] }) {
  return (
    <ul className="items">
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.id ?? index}`}>
          <span className={`tag ${item.kind}`}>{item.kind.replace(/_/g, ' ')}</span>
          {item.id ? <span className="mono id">{item.id}</span> : null}
          {item.shipped ? <span className="tag shipped">shipped anyway</span> : null}
          <span className="why">
            {item.question || item.answer ? <b>{item.question || item.answer}</b> : null}
            {item.question || item.answer ? ' — ' : ''}
            {item.reason}
          </span>
          {item.from ? (
            <span className="dim mono">
              {item.from} → {item.to} · {item.asked || item.since || ''}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Run one whitelisted action.
 *
 * It shows the command it ran and its exit code, and it prints a refusal VERBATIM. Nothing here
 * interprets, summarises or retries a refusal: the CLI's words are the finding, and a UI that
 * translated "you have no reason recorded" into "something went wrong" would have destroyed the
 * only reason it is safe for this page to have buttons at all.
 */
export function ActionForm({
  name,
  spec,
  prefill,
  onDone,
}: {
  name: string;
  spec: { label: string; fields: Field[] };
  prefill?: Record<string, string>;
  onDone: () => void;
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="action"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const form = event.currentTarget;
        const params: Record<string, string> = {};
        for (const field of spec.fields) {
          params[field.name] = (form.elements.namedItem(field.name) as HTMLInputElement | HTMLTextAreaElement).value;
        }
        try {
          const res = await fetch('/action', {
            method: 'POST',
            // application/json is not decoration: it is what forces a CORS preflight and stops any
            // other page the operator has open from driving these buttons.
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: name, params }),
          });
          const body: ActionResult = await res.json();
          setResult(body);
          if ('ok' in body && body.ok) onDone();
        } catch (error) {
          setResult({ ok: false, refused: String(error) });
        }
        setBusy(false);
      }}
    >
      <span className="dim">{spec.label}</span>
      {spec.fields.map((field) =>
        field.long ? (
          <textarea key={field.name} name={field.name} placeholder={field.label} defaultValue={prefill?.[field.name] ?? field.value ?? ''} required />
        ) : (
          <input key={field.name} name={field.name} placeholder={field.label} defaultValue={prefill?.[field.name] ?? field.value ?? ''} required />
        )
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'running…' : 'Run'}
      </button>
      {result ? (
        <pre className={'result' + ('ok' in result && result.ok ? ' ok' : '')}>
          {'refused' in result && result.refused
            ? `REFUSED: ${result.refused}${result.whitelist ? `\nwhitelist: ${result.whitelist.join(', ')}` : ''}${
                result.detail ? `\n${result.detail}` : ''
              }`
            : 'command' in result
              ? `$ ${result.command}\nexit ${result.exitCode}\n${result.stdout}${result.stderr}`
              : JSON.stringify(result)}
        </pre>
      ) : null}
    </form>
  );
}
