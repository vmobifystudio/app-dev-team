/**
 * Mission Control — and the ORDER is the deliverable.
 *
 * "Why work is not moving" is first because dry run 4 produced a sprint where every ticket was
 * blocked: a burn-down would have drawn a flat line and explained nothing, while "here is the one
 * reason" was the single most useful fact of the day. Cause first. There is no burn-down on this
 * page at all, and its absence is the design.
 */
import type { Screen, Section } from '../types';
import { SectionCard, StatusBadge, Avatar } from '../ui';
import { RefreshIcon, UsersIcon, RotateIcon, XCircleIcon, DollarIcon, RadarIcon } from '../icons';

const BUDGET_ICON = { rounds: RefreshIcon, spawns: UsersIcon, retries: RotateIcon, refusals: XCircleIcon, spend: DollarIcon };

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
      ).map(([label, value]) => {
        const Glyph = BUDGET_ICON[label];
        return (
          <div className="metric" key={label}>
            <span className="micon"><Glyph size={17} /></span>
            <div>
              <b>{value}</b>
              <span className="dim">{label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Build({ section }: { section: Section }) {
  const data = section.data as { ticket: string; event: string; by: string; ts: string; detail: string } | null;
  if (!data) return null;
  return (
    <div className="detail" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Avatar name={data.by || '?'} size={26} />
      <span>
        <span className="mono id">{data.ticket}</span> <b>{data.event}</b> by {data.by || 'nobody recorded'} <span className="faint">· {data.ts}</span>
        {data.detail ? <span className="dim"> — {data.detail}</span> : null}
      </span>
    </div>
  );
}

export default function Mission({ screen }: { screen: Screen }) {
  const phase = screen.phase as { phase: string; derived: string };
  return (
    <>
      <div className="headline">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="micon" style={{ width: 40, height: 40 }}><RadarIcon size={20} /></span>
          <div>
            <span className="dim">phase</span>
            <b>{phase.phase}</b>
            <span className="dim">derived — the log records no phase marker: {phase.derived}</span>
          </div>
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
