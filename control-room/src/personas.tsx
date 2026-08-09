/**
 * A display-only nickname layer. Every role's REAL identifier — `tech-lead`, `android-developer`,
 * the string that scripts/board.mjs, worktree-slot.mjs and every log line actually use — never
 * changes anywhere outside this file. This just maps that identifier to a name and a house sigil
 * for the UI to show alongside it, never instead of it: the log's own words stay the source of
 * truth, this is decoration on top.
 */
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
type IconComponent = (p: IconProps) => ReactNode;

function Sigil({ size = 16, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5z" />
      {children}
    </svg>
  );
}

/* Each mark is 1-2 bold, large primitives — small multi-point detail (fine dots, thin crosshatch)
   disappears at the 13-16px this renders at next to a role name, and a sigil nobody can tell apart
   from another is decoration, not identity. */

const DirewolfSigil: IconComponent = (p) => (
  <Sigil {...p}>
    <path d="M8.5 15.5 12 8l3.5 7.5" />
    <circle cx="12" cy="14" r="1.3" fill="currentColor" stroke="none" />
  </Sigil>
);

const DragonSigil: IconComponent = (p) => (
  <Sigil {...p}>
    <path d="M12 6.5c2.6 2.6 2.6 6.4 0 9-2.6-2.6-2.6-6.4 0-9z" fill="currentColor" stroke="currentColor" strokeWidth="1" />
  </Sigil>
);

const LionSigil: IconComponent = (p) => (
  <Sigil {...p}>
    <circle cx="12" cy="12" r="2.6" />
    <path d="M12 6.5v2M12 15.5v2M6.5 12h2M15.5 12h2" />
  </Sigil>
);

const RoseSigil: IconComponent = (p) => (
  <Sigil {...p}>
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="4" />
  </Sigil>
);

const StagSigil: IconComponent = (p) => (
  <Sigil {...p}>
    <path d="M12 16.5V10" />
    <path d="M12 10c-2-.5-2.6-2-2.4-3.8M12 10c2-.5 2.6-2 2.4-3.8" />
  </Sigil>
);

const SpiderSigil: IconComponent = (p) => (
  <Sigil {...p}>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M9.5 10 6.5 8M14.5 10l3-2M9 13.5 6 15M15 13.5l3 1.5" />
  </Sigil>
);

const MockingbirdSigil: IconComponent = (p) => (
  <Sigil {...p}>
    <path d="M6.5 11.5C9 10 15 10 17.5 11.5c-2.5 3-6.5 4.5-11 0z" />
  </Sigil>
);

const SwordsSigil: IconComponent = (p) => (
  <Sigil {...p}>
    <path d="M8 8l8 8M16 8l-8 8" />
  </Sigil>
);

export interface Persona {
  name: string;
  house: string;
  sigil: IconComponent;
}

/** Keyed by the REAL role slug from docs/team roster / board ownership — never a made-up id.
 * Covers every file in agents/ (30 roles), matched by personality/function, not just the 17 the
 * README's roster table names — the studio spawns more roles than that table lists. */
export const PERSONAS: Record<string, Persona> = {
  ceo: { name: 'Daenerys Targaryen', house: 'Targaryen', sigil: DragonSigil },
  cpo: { name: 'Tyrion Lannister', house: 'Lannister', sigil: LionSigil },
  cto: { name: 'Ned Stark', house: 'Stark', sigil: DirewolfSigil },
  'chief-of-staff': { name: 'Jorah Mormont', house: 'Targaryen', sigil: DragonSigil },

  'tech-lead': { name: 'Jon Snow', house: 'Stark', sigil: DirewolfSigil },
  'tech-manager': { name: 'Sansa Stark', house: 'Stark', sigil: DirewolfSigil },

  'android-developer': { name: 'Grey Worm', house: 'Targaryen', sigil: DragonSigil },
  'ios-developer': { name: 'Arya Stark', house: 'Stark', sigil: DirewolfSigil },
  'backend-developer': { name: 'Samwell Tarly', house: 'Stark', sigil: DirewolfSigil },
  'web-developer': { name: 'Gilly', house: 'Stark', sigil: DirewolfSigil },
  'monetization-engineer': { name: 'Petyr "Littlefinger" Baelish', house: 'none', sigil: MockingbirdSigil },
  'code-reviewer': { name: 'Varys', house: 'none', sigil: SpiderSigil },
  'qa-engineer': { name: 'Brienne of Tarth', house: 'errant', sigil: SwordsSigil },
  'test-automation-engineer': { name: 'Daario Naharis', house: 'Targaryen', sigil: DragonSigil },
  'verification-engineer': { name: 'Maester Luwin', house: 'none', sigil: SpiderSigil },
  'red-team-agent': { name: 'Bronn', house: 'errant', sigil: SwordsSigil },

  'ux-architect': { name: 'Margaery Tyrell', house: 'Tyrell', sigil: RoseSigil },
  'product-designer': { name: 'Shireen Baratheon', house: 'Baratheon', sigil: StagSigil },
  'product-manager': { name: 'Podrick Payne', house: 'errant', sigil: SwordsSigil },
  'product-researcher': { name: 'Maester Aemon', house: 'none', sigil: SpiderSigil },
  'product-validator': { name: 'Yara Greyjoy', house: 'errant', sigil: SwordsSigil },
  'aso-specialist': { name: 'Missandei', house: 'Targaryen', sigil: DragonSigil },
  'data-analyst': { name: 'Bran Stark', house: 'Stark', sigil: DirewolfSigil },

  'devops-engineer': { name: 'Gendry', house: 'Baratheon', sigil: StagSigil },
  'release-manager': { name: 'Davos Seaworth', house: 'Baratheon', sigil: StagSigil },
  'release-auditor': { name: 'Barristan Selmy', house: 'errant', sigil: SwordsSigil },
  'security-reviewer': { name: 'Sandor "The Hound" Clegane', house: 'errant', sigil: SwordsSigil },
  'privacy-reviewer': { name: 'Howland Reed', house: 'Stark', sigil: DirewolfSigil },
  'incident-commander': { name: 'Beric Dondarrion', house: 'errant', sigil: SwordsSigil },
  'reliability-engineer': { name: 'Brandon "the Builder" Stark', house: 'Stark', sigil: DirewolfSigil },
};

/** Bare role slug from a possibly-prefixed agent name, e.g. `h9-android-developer-2` -> `android-developer`. */
export function personaFor(roleOrAgentName: string): Persona | null {
  if (PERSONAS[roleOrAgentName]) return PERSONAS[roleOrAgentName];
  const stripped = roleOrAgentName.replace(/^[a-z0-9]+-/i, '').replace(/-\d+$/, '');
  return PERSONAS[stripped] ?? null;
}
