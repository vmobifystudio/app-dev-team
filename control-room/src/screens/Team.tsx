/**
 * Team — the activated roster for this project.
 *
 * An `off` role is shown WITH ITS REASON, in the same table as the active ones. The roster file's
 * own rule is that a role missing from it is not "off", it is unaccounted for — so hiding the off
 * rows in the UI would recreate exactly the state the file was written to prevent. Every role gets
 * a row here for the same reason it gets a row there.
 */
import { useState } from 'react';
import type { TeamScreen } from '../types';
import { SectionCard, Avatar } from '../ui';

const STATES = ['active', 'conditional', 'off'] as const;

export default function Team({ screen, query = '' }: { screen: TeamScreen; query?: string }) {
  const [stateFilter, setStateFilter] = useState<string>('');

  if (screen.status === 'unavailable' && !screen.roles.length) {
    return (
      <>
        <p className="banner">CANNOT EVALUATE — {screen.note}</p>
        {screen.sections.map((section) => (
          <SectionCard key={section.id} section={section} />
        ))}
      </>
    );
  }

  const byState = { active: 0, conditional: 0, off: 0 } as Record<string, number>;
  for (const role of screen.roles) byState[role.state] = (byState[role.state] ?? 0) + 1;

  const q = query.trim().toLowerCase();
  const roles = screen.roles.filter(
    (r) => (!stateFilter || r.state === stateFilter) && (!q || r.role.toLowerCase().includes(q))
  );

  return (
    <>
      <div className="headline">
        <div>
          <span className="dim">tier</span>
          <b>{screen.tier || 'not recorded'}</b>
          <span className="dim">product type: {screen.productType || 'not recorded'}</span>
        </div>
        <div className="channels">
          <button className={stateFilter === '' ? 'on' : ''} onClick={() => setStateFilter('')}>
            all ({screen.roles.length})
          </button>
          {STATES.map((s) => (
            <button key={s} className={stateFilter === s ? 'on' : ''} onClick={() => setStateFilter(s)}>
              {s} ({byState[s] ?? 0})
            </button>
          ))}
        </div>
      </div>
      <p className="swept top">swept: {screen.swept}</p>

      {screen.sections.map((section) => (
        <SectionCard key={section.id} section={section} />
      ))}

      <div className="scroll">
        <table className="roster">
          <thead>
            <tr>
              <th>Role</th>
              <th>State</th>
              <th>Working on</th>
              <th>Log actions</th>
              <th>Trigger / reason it is off</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.role} data-state={role.state}>
                <td className="mono">
                  <span className="rolecell">
                    <Avatar name={role.role} size={24} variant={role.state === 'off' ? 'off' : undefined} />
                    {role.role}
                  </span>
                </td>
                <td>
                  <span className={`tag state-${role.state}`}>{role.state}</span>
                </td>
                <td>
                  {role.workingOn.length
                    ? role.workingOn.map((t) => `${t.id} (${t.status})`).join(', ')
                    : <span className="dim">nothing on the board</span>}
                </td>
                <td>{role.logActions}</td>
                <td className="reason">{role.reason || <span className="dim">NO REASON RECORDED</span>}</td>
              </tr>
            ))}
            {!roles.length ? (
              <tr>
                <td colSpan={5} className="dim" style={{ padding: '16px 20px' }}>
                  no role matches this filter
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
