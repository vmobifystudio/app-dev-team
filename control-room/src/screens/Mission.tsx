/**
 * Mission Control — and the ORDER is the deliverable.
 *
 * "Why work is not moving" is first because dry run 4 produced a sprint where every ticket was
 * blocked: a burn-down would have drawn a flat line and explained nothing, while "here is the one
 * reason" was the single most useful fact of the day. Cause first. There is no burn-down on this
 * page at all, and its absence is the design.
 */
import type { Screen, Section } from '../types';
import { SectionCard, StatusBadge } from '../ui';

function Budget({ section }: { section: Section }) {
  const data = section.data as { rounds: number; spawns: number; retries: number; refusals: number; spendUsd: number | null } | null;
  if (!data) return null;
  return (
    <div className="metrics">
      {(
        [
          ['rounds', data.rounds],
          ['spawns', data.spawns],
          ['retries', data.retries],
          ['refusals', data.refusals],
          // Never "$0.00". The harness cannot measure token spend, and a fabricated zero on the one
          // screen a founder reads for money is the worst possible place to invent a number.
          ['spend', data.spendUsd === null ? 'not measurable' : `$${data.spendUsd.toFixed(2)}`],
        ] as const
      ).map(([label, value]) => (
        <div className="metric" key={label}>
          <b>{value}</b>
          <span className="dim">{label}</span>
        </div>
      ))}
    </div>
  );
}

function Build({ section }: { section: Section }) {
  const data = section.data as { ticket: string; event: string; by: string; ts: string; detail: string } | null;
  if (!data) return null;
  return (
    <p className="detail">
      <span className="mono id">{data.ticket}</span> <b>{data.event}</b> by {data.by || 'nobody recorded'} · {data.ts}
      {data.detail ? <span className="dim"> — {data.detail}</span> : null}
    </p>
  );
}

export default function Mission({ screen }: { screen: Screen }) {
  const phase = screen.phase as { phase: string; derived: string };
  return (
    <>
      <div className="headline">
        <div>
          <span className="dim">phase</span>
          <b>{phase.phase}</b>
          <span className="dim">derived — the log records no phase marker: {phase.derived}</span>
        </div>
        <StatusBadge status={screen.status} />
      </div>
      {screen.sections.map((section) => (
        <SectionCard key={section.id} section={section}>
          {section.id === 'budget' ? <Budget section={section} /> : null}
          {section.id === 'build' ? <Build section={section} /> : null}
        </SectionCard>
      ))}
    </>
  );
}
