/**
 * The shape of `GET /state`. Mirrors `control-room/state.mjs`; that file is the authority.
 *
 * `Status` is the whole contract in one type. There is no boolean "ok" anywhere in this UI, because
 * a boolean cannot express `unavailable` — and the difference between "swept 40 things, found none"
 * and "could not read the input" is the difference this entire codebase exists to preserve.
 */
export type Status = 'attention' | 'clear' | 'info' | 'unavailable';

export interface Item {
  kind: string;
  id?: string;
  owner?: string;
  reason?: string;
  gate?: string;
  since?: string;
  actionable?: boolean;
  /** Question/answer rows. */
  messageId?: string;
  from?: string;
  to?: string;
  question?: string;
  answer?: string;
  asked?: string;
  shipped?: boolean;
  ticketStatus?: string;
}

export interface Section {
  id: string;
  title: string;
  status: Status;
  note?: string;
  swept: string;
  clearNote?: string;
  items: Item[];
  data?: unknown;
}

export interface Screen {
  id: string;
  title: string;
  status: Status;
  note?: string;
  swept?: string;
  sections: Section[];
  [extra: string]: unknown;
}

export interface MessageMeta {
  ticket: string;
  requirements: string[];
  decision: string;
  artifact: string;
  transition: string;
  evidence: string;
  requiresResponse: boolean;
  expiresAfterRound: number | null;
  obligation: string | null;
  channels: string[];
}

export interface Message {
  id: string;
  ts: string;
  from: string;
  to: string[];
  kind: string;
  priority: string;
  summary: string;
  body: string;
  provenance: string;
  meta: MessageMeta;
}

export interface Thread {
  ticket: string;
  ticketStatus: string;
  open: number;
  messages: Message[];
}

export interface CommsScreen extends Screen {
  structured: boolean;
  from: string;
  channels: { name: string; count: number }[];
  threads: Thread[];
}

export interface BoardTicket {
  id: string;
  title: string;
  owner: string;
  reviewer: string;
  stranded: boolean;
  display: string;
  staticOnly: boolean;
  dependsOn: string[];
}

export interface BoardScreen extends Screen {
  from: string | null;
  columns: { status: string; tickets: BoardTicket[] }[];
  owners: {
    owner: string;
    open: number;
    inProgress: number;
    review: number;
    blocked: number;
    stranded: number;
    staticOnly: number;
  }[];
  metrics: {
    medianCycleTimeMs: number | null;
    reviewPassRate: number | null;
    reworkRate: number | null;
    gateFires: Record<string, number>;
    reachedReview: number;
    reviewerActions: number;
  } | null;
  metricsNote: string;
}

export interface TeamScreen extends Screen {
  tier: string;
  productType: string;
  roles: {
    role: string;
    state: 'active' | 'conditional' | 'off';
    reason: string;
    workingOn: { id: string; status: string }[];
    logActions: number;
  }[];
}

export interface InboxItem {
  kind: string;
  id: string;
  title: string;
  owner: string;
  since: string;
  context: string;
  recommendation: { text: string; source: string } | null;
  recommendationNote: string;
  action: { name: string; prefill: Record<string, string> };
}

export interface Field {
  name: string;
  label: string;
  required?: boolean;
  value?: string;
  long?: boolean;
}

export interface State {
  generatedAt: string;
  project: string;
  readFrom: string | null;
  runtime: { available: boolean; node: string; mode: string; note: string };
  sources: { id: string; path: string; ok: boolean; note: string }[];
  chain: { ok: boolean; chained: number; unchained: number; reason?: string; line?: number; tip?: string };
  violations: { line: number; reason: string }[];
  actions: string[];
  actionForms: Record<string, { label: string; fields: Field[] }>;
  screens: Screen[];
}

/** What `POST /action` answers with. A refusal is a finding, so it has its own shape. */
export type ActionResult =
  | { ok: false; refused: string; whitelist?: string[]; detail?: string }
  | { ok: boolean; action: string; command: string; exitCode: number; stdout: string; stderr: string };
