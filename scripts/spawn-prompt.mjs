#!/usr/bin/env node
/**
 * spawn-prompt — compose the exact text to hand an IC agent, with the output contract INLINED.
 *
 * THE MEASURED PROBLEM (H5, 2026-08-07). `parallel-orchestrator` step 4 has always said each spawn
 * prompt must include *"the expected output contract (`DONE: APP-NNN ...`)"*. In the first real
 * spawn against this loop, the prompt instead said *"Return the CODE profile defined in
 * `team-protocol`"* — a POINTER, not the text. The agent's code was correct and it committed
 * correctly; it returned 0 of 6 contract fields, worse than the agent that failed H4 the day
 * before. `report-check.mjs` caught it, exactly as designed — but the loop had already burned a
 * whole spawn on a report nothing downstream could act on.
 *
 * With the SAME ticket, SAME role, SAME slot, and ONLY the contract pasted in literally instead of
 * referenced, the next agent returned all six fields (H5b). The failure was dispatch, not
 * capability — which makes it exactly the kind of failure this repository's own rule exists to
 * retire: *"a rule survives as a mechanism that runs, not a convention someone remembers"*
 * (orchestrator.mjs). Remembering to paste the contract in is a convention. This is the mechanism.
 *
 * WHAT THIS DOES NOT DO. It cannot force a `Task`/`Agent` tool call to use its output — no harness
 * this plugin targets exposes a pre-flight hook on an outbound subagent prompt. What it CAN do is
 * remove every reason not to use the real text: composing the block by hand is now slower than
 * running this, and `--verify` gives the orchestrator (or this repo's own dry-run harness) a way to
 * confirm a prompt it already sent was compliant, the same shape `dispatch-preflight` and
 * `spawn-gate` already use for other pre-launch questions.
 *
 * Usage:
 *   spawn-prompt.mjs compose --root <project> --ticket <ID> --role <role>
 *                    [--slot <path>] [--integration-branch <name>]
 *   spawn-prompt.mjs verify --role <role> [--prompt <file>]   (reads stdin if --prompt is omitted)
 *
 * Exit codes:
 *   compose:  0 printed the prompt to stdout · 2 the ticket or role could not be resolved
 *   verify:   0 the contract is present and inlined (not merely referenced) · 1 it is not · 2 usage
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { contractFor, contractBlock, BLOCKED_BLOCK } from './lib/contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const die = (code, message) => { process.stderr.write(`spawn-prompt: ${message}\n`); process.exit(code); };

const { flags, positional } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'ticket', 'role', 'slot', 'integration-branch', 'prompt']),
  die,
});
const [command] = positional;

function cmdCompose() {
  const ticket = String(flags.ticket || '');
  const role = String(flags.role || '');
  if (!ticket) die(2, 'compose needs --ticket <ID>');
  if (!role) die(2, 'compose needs --role <role>');
  const contract = contractFor(role);
  if (!contract) die(2, `"${role}" is not a ticket-owning role in either contract tier (see lib/contract.mjs).`);

  let ROOT;
  if (typeof flags.root === 'string') ROOT = resolve(flags.root);
  else {
    const resolved = resolveProjectRoot({ explicit: typeof flags['project-root'] === 'string' ? flags['project-root'] : '' });
    if (!resolved.ok) die(2, explainRootFailure(resolved));
    ROOT = resolved.root;
  }

  let row;
  try {
    const out = execFileSync(process.execPath, [resolve(HERE, 'board.mjs'), 'show', ticket, '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    row = JSON.parse(out)[ticket.toUpperCase()] ?? Object.values(JSON.parse(out))[0];
  } catch (e) {
    die(2, `could not read ${ticket} from the board: ${String(e.stderr || e.message).trim()}`);
  }
  if (!row) die(2, `${ticket} is not on the board.`);

  const slot = typeof flags.slot === 'string' ? flags.slot : `.agent-wt/${role}`;
  let base = typeof flags['integration-branch'] === 'string' ? flags['integration-branch'] : '';
  if (!base) {
    try { base = execFileSync('sh', [resolve(HERE, 'integration-branch.sh')], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { base = ''; }
  }

  const lines = [
    `Work ticket ${row.id}.`,
    '',
    `Your project root is \`${slot}\`. That is your worktree. Do not leave it.`,
    '',
    'Board row (verbatim):',
    '',
    '```',
    `ID:         ${row.id}`,
    `Feature:    ${row.feature || '—'}`,
    `Title:      ${row.title || '—'}`,
    `Owner:      ${row.owner || '—'}`,
    `Reviewer:   ${row.reviewer || '—'}`,
    `Spec:       ${row.spec || '—'}`,
    `Acceptance: ${row.acceptance || '—'}`,
    `Estimate:   ${row.estimate || '—'}`,
    `Status:     ${row.status || '—'}`,
    `Depends on: ${(row.dependsOn || []).join(', ') || '—'}`,
    row.files?.length ? `Files:      ${row.files.join(', ')}` : null,
    '```',
    '',
    'Read, in order: the impl spec your role file names, then whichever of `docs/12-flows.md`,',
    '`docs/13-design-tokens.md`, `docs/14-components.md`, `docs/52-analytics.md`, `docs/40-api.md`',
    'the ticket actually touches.',
    '',
    base ? `The integration branch for this project is \`${base}\`.` : null,
    '',
    'Do not edit the specs. If you are blocked, flag the blocker and stop — do not guess.',
    '',
    '**Expected output contract.** Return exactly this block, with every field filled in — a',
    'pointer to a skill or a role file is not a substitute; this text, completed:',
    '',
    '```',
    contractBlock(role, { ticket: row.id }),
    '```',
    '',
    `If blocked, return this instead:`,
    '',
    '```',
    BLOCKED_BLOCK(row.id),
    '```',
  ].filter((l) => l !== null);

  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

/**
 * Was the contract actually INLINED, not merely referenced? This is the check H5 argues for: a
 * prompt that says "return the CODE profile defined in team-protocol" contains none of the field
 * labels literally and must fail this, precisely because it failed the loop the same way.
 */
function cmdVerify() {
  const role = String(flags.role || '');
  if (!role) die(2, 'verify needs --role <role>');
  const contract = contractFor(role);
  if (!contract) die(2, `"${role}" is not a ticket-owning role in either contract tier.`);

  let text = '';
  if (typeof flags.prompt === 'string') {
    const p = resolve(String(flags.prompt));
    if (!existsSync(p)) die(2, `no prompt at ${flags.prompt}`);
    text = readFileSync(p, 'utf8');
  } else {
    try { text = readFileSync(0, 'utf8'); } catch { text = ''; }
  }
  if (!text.trim()) die(2, 'no prompt to check — pass --prompt <file> or pipe it on stdin');

  const missing = contract.fields.filter((f) => !text.includes(f));
  if (!missing.length) {
    process.stdout.write(`SPAWN PROMPT: CONTRACT INLINED — all ${contract.fields.length} ${contract.tier}-tier field labels are present in the prompt text.\n`);
    process.exit(0);
  }
  process.stdout.write(
    `SPAWN PROMPT: CONTRACT NOT INLINED — missing ${missing.length} of ${contract.fields.length} field label(s): ${missing.join(' ')}\n\n` +
    '  This is the H5 failure: a prompt that POINTS AT the contract instead of containing it\n' +
    '  produces an agent that returns none of it — measured, not assumed. Compose the prompt with:\n' +
    `    node scripts/spawn-prompt.mjs compose --root <project> --ticket <ID> --role ${role}\n` +
    '  and use its output as the spawn message verbatim, rather than a reference to team-protocol.\n'
  );
  process.exit(1);
}

switch (command) {
  case 'compose': cmdCompose(); break;
  case 'verify': cmdVerify(); break;
  default:
    die(2, `unknown command "${command ?? ''}"\n` +
           '  compose --root <project> --ticket <ID> --role <role> [--slot <path>] [--integration-branch <name>]\n' +
           '  verify  --role <role> [--prompt <file>]');
}
