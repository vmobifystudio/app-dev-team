/**
 * The action surface — the ONE whitelist, shared by every human-facing surface.
 *
 * This lived inside `scripts/studio-dashboard.mjs`. The control room (`control-room/`) needs the
 * same three actions, and a second copy of a whitelist is a second set of rules about what a human
 * may do to the board: the copies drift, and the drift is invisible because both pages "work".
 * A renderer that disagrees with its validator is the defect class this repo names most often —
 * an ACTION surface that disagrees with itself is the same class with write access.
 *
 * Two invariants, and they are the reason it is safe for a web page to have buttons at all:
 *
 *   1. NOTHING HERE WRITES STATE. Every action BUILDS AN ARGV for the real CLI — `scripts/board.mjs`
 *      or `scripts/team-message.sh`, the same commands the agents run, with the same guards, the
 *      same refusals and the same append-only log — and runs it with `execFile`. No shell, so there
 *      is no interpolation anywhere in this file, and no code path from a form field to a state file.
 *
 *   2. A REFUSAL IS A FINDING. The CLI's own words are returned verbatim with its exit code. A
 *      surface that swallowed a refusal and showed "done" would be worse than no button.
 *
 * Zero dependencies, Node stdlib only — the plugin ships this, and the plugin has no package.json.
 */

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const BOARD_CLI = join(SCRIPTS, 'board.mjs');
const MESSAGE_CLI = join(SCRIPTS, 'team-message.sh');

const TICKET_RE = /^[A-Za-z]+-\d+(?:-[A-Za-z]+)?$/;
const ROLE_RE = /^[a-z][a-z0-9-]{1,40}$/;

/**
 * A free-text field: non-empty, one line, bounded — and NOT shaped like a flag.
 *
 * The `--` rule is defence in depth. The real hole was scripts/board.mjs `parseArgs` reading any
 * `--`-prefixed token as a new flag even in a value position, so `reason: "--board=/tmp/x"` made
 * the CLI render a board over an arbitrary file and recorded `"detail": true` in its place. That is
 * fixed at the CLI, where every caller routes; this refuses it at the trust boundary too, because a
 * form field that looks like a flag is never a legitimate reason, summary or artifact path.
 */
const oneLine = (value, max) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\n\r]/.test(value) &&
  !/^\s*--/.test(value);

/**
 * Three actions.
 *
 * "Re-prioritise" is deliberately absent: nobody wanted it once in the whole run, and every action
 * that exists here is one more thing that has to stay in step with the CLI's rules.
 */
const ACTIONS = {
  unblock: {
    label: 'Unblock a ticket',
    fields: [
      { name: 'ticket', label: 'Ticket', required: true },
      { name: 'by', label: 'By (role)', required: true, value: 'tech-manager' },
      { name: 'reason', label: 'Recorded reason', required: true, long: true },
    ],
    validate: (p) =>
      (!TICKET_RE.test(p.ticket || '') && 'ticket must look like APP-001 or BUG-001-fix') ||
      (!ROLE_RE.test(p.by || '') && 'by must be a role name') ||
      (!oneLine(p.reason, 500) && 'a reason is required, one line, max 500 chars — an unblock with no reason is how a block becomes a mystery') ||
      null,
    argv: (p) => ['node', [BOARD_CLI, 'move', p.ticket, 'unblocked', '--by', p.by, '--detail', p.reason]],
  },
  answer: {
    label: 'Answer an open question',
    fields: [
      { name: 'ticket', label: 'Ticket', required: true },
      { name: 'from', label: 'From (role)', required: true },
      { name: 'to', label: 'To (role)', required: true },
      { name: 'summary', label: 'Answer (one line)', required: true },
      // THE OBLIGATION IS A FIELD, NOT PROSE. This form asked for the artifact in `body` and sent
      // it as `--body`, while `obligationOf()` in scripts/lib/messages.mjs requires the STRUCTURED
      // `--artifact` (or `--transition`) for a closing kind. `answer` is a closing kind, so the
      // button constructed a command the CLI refuses every single time: the Founder Inbox's answer
      // action could never once have succeeded.
      //
      // The form was asking the operator for exactly the right thing and then throwing away the
      // part that mattered — the label said "name the artifact" and the value went somewhere the
      // rule does not read. Reported by codex on PR #8.
      { name: 'artifact', label: 'Artifact it was folded into (e.g. docs/21-impl-spec-ios.md, ADR-012)', required: true },
      { name: 'body', label: 'Detail', required: true, long: true },
    ],
    validate: (p) =>
      (!TICKET_RE.test(p.ticket || '') && 'ticket must look like APP-001') ||
      (!ROLE_RE.test(p.from || '') && 'from must be a role name') ||
      (!ROLE_RE.test(p.to || '') && 'to must be a role name') ||
      (p.from === p.to && 'from and to must differ — a role does not answer its own question') ||
      (!oneLine(p.summary, 300) && 'a one-line summary is required') ||
      (!oneLine(p.artifact, 300) &&
        'an artifact is required — an "answer" that names nothing closes the ledger without delivering anything (DR4-006), and team-message.sh will refuse it') ||
      (!oneLine(p.body, 2000) && 'a body is required') ||
      null,
    argv: (p) => [
      'sh',
      [MESSAGE_CLI, '--from', p.from, '--to', p.to, '--ticket', p.ticket, '--kind', 'answer',
       '--summary', p.summary, '--artifact', p.artifact, '--body', p.body],
    ],
  },
  'assign-artifact': {
    label: 'Assign an unowned artifact',
    fields: [
      { name: 'ticket', label: 'Ticket that will own it', required: true },
      { name: 'artifact', label: 'Artifact path', required: true },
      { name: 'from', label: 'By (role)', required: true, value: 'tech-manager' },
      { name: 'body', label: 'Why this ticket', required: true, long: true },
    ],
    validate: (p) =>
      (!TICKET_RE.test(p.ticket || '') && 'ticket must look like APP-001') ||
      (!oneLine(p.artifact, 200) && 'an artifact path is required') ||
      (!ROLE_RE.test(p.from || '') && 'by must be a role name') ||
      (!oneLine(p.body, 2000) && 'say why this ticket owns it') ||
      null,
    // There is no board field for "this ticket owns this file", and inventing a writer for one
    // would make the page a second writer of state. A `decision` on the team ledger is the
    // existing, validated, append-only place where an ownership call is recorded — and the unowned
    // artifacts panel reads decisions back, so the artifact stops being unowned when this succeeds.
    argv: (p) => [
      'sh',
      [
        MESSAGE_CLI,
        '--from',
        p.from,
        '--to',
        'tech-manager',
        '--ticket',
        p.ticket,
        '--kind',
        'decision',
        '--summary',
        `${p.ticket} owns ${p.artifact}`,
        '--body',
        p.body,
      ],
    ],
  },
};

/** The form spec a page needs to render the actions, without handing it the argv builders. */
const actionForms = () =>
  Object.fromEntries(Object.entries(ACTIONS).map(([name, a]) => [name, { label: a.label, fields: a.fields }]));

function runAction(root, name, params) {
  // `Object.hasOwn`, not `ACTIONS[name]`: a bare lookup inherits from Object.prototype, so
  // {"action":"constructor"} passed the whitelist guard, `action.validate` was undefined, and the
  // TypeError escaped the async handler and KILLED THE PROCESS. The existing negative test used
  // "render" — not an inherited property — so it stayed green over the hole.
  const action = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : null;
  if (!action) {
    return Promise.resolve({
      status: 400,
      body: {
        ok: false,
        refused: `"${name}" is not on the action whitelist`,
        whitelist: Object.keys(ACTIONS),
        detail:
          'This page can unblock a ticket with a recorded reason, answer an open question, and assign an unowned artifact. Nothing else is actionable from here, by construction.',
      },
    });
  }
  const problem = action.validate(params);
  if (problem) return Promise.resolve({ status: 400, body: { ok: false, refused: problem, action: name } });

  const [command, args] = action.argv(params);
  const display = `${command} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;

  return new Promise((done) => {
    execFile(command, args, { cwd: root, timeout: 20000, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      done({
        status: 200,
        body: {
          // A refusal is a FINDING, not an error to swallow. The CLI's own words, verbatim, exit
          // code included — that is the whole reason it is safe for this page to have buttons.
          ok: exitCode === 0,
          action: name,
          command: display,
          exitCode,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        },
      });
    });
  });
}

/**
 * The trust boundary in front of `POST /action`. Returns `null` when the request may proceed, or
 * `{status, body}` to send instead.
 *
 * Binding to 127.0.0.1 keeps the network out; it does not keep the OPERATOR'S BROWSER out.
 * `JSON.parse(body)` ignored Content-Type, and a `text/plain` POST is a CORS-simple request — no
 * preflight — so any page open in another tab could drive all three actions. Requiring
 * application/json reinstates the preflight; rejecting a foreign Origin closes the rest.
 */
function refuseRequest(req) {
  const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ctype !== 'application/json') {
    return {
      status: 415,
      body: {
        ok: false,
        refused:
          'POST /action requires content-type: application/json — a simple-CORS body is a drive-by from any page the operator has open',
      },
    };
  }
  const origin = req.headers.origin;
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  const sameOrigin =
    origin === undefined ||
    (() => {
      try {
        const host = new URL(origin).hostname;
        return host === '127.0.0.1' || host === 'localhost';
      } catch {
        return false;
      }
    })();
  if (!sameOrigin || (site && site !== 'same-origin' && site !== 'none')) {
    return {
      status: 403,
      body: {
        ok: false,
        refused: `cross-origin POST /action refused (origin: ${origin ?? 'none'}, sec-fetch-site: ${site || 'none'})`,
      },
    };
  }
  return null;
}

export { ACTIONS, actionForms, runAction, refuseRequest, BOARD_CLI, MESSAGE_CLI };
