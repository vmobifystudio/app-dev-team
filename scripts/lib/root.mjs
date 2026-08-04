/**
 * ONE project-root resolver, used by every command that reads or writes project state.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. A mutation that lands in the wrong repository is the one
 * failure no downstream gate can undo — the write has already happened, and every check after it is
 * evaluating the wrong project. Everything else in this codebase is recoverable; this is not.
 *
 * The failure mode is not exotic. A studio project containing a second git repository (a vendored
 * dependency, a sample app, a fixture, a worktree someone nested by hand) is ordinary. Before this,
 * `board.mjs` resolved its root through `git rev-parse --git-common-dir`, which answers "the
 * nearest git repo" — so a command run inside the nested repo silently created a SECOND, empty
 * board there and reported success. Every other script simply used `process.cwd()`.
 *
 * The rule: a git boundary is not a project boundary. A project is marked by studio state, and when
 * the two disagree the answer is CANNOT EVALUATE with the candidates named — never a silent pick.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// What makes a directory a studio project root. `.studio-policy.json` is the deliberate marker;
// the event log is accepted too so that projects predating the policy file still resolve.
const MARKERS = ['.studio-policy.json', 'docs/31-board-events.jsonl', 'docs/31-board.md'];

function isProjectRoot(dir) {
  return MARKERS.some((m) => existsSync(resolve(dir, m)));
}

function ancestors(from) {
  const out = [];
  let dir = resolve(from);
  for (;;) {
    out.push(dir);
    const up = dirname(dir);
    if (up === dir) return out;
    dir = up;
  }
}

/**
 * If `from` is inside a LINKED worktree, return the main project root; otherwise ''.
 *
 * `--git-dir` differs from `--git-common-dir` in a linked worktree (`.git/worktrees/<name>` versus
 * `.git`) and is identical in the main one. That difference is the only reliable signal, and it is
 * what tells "the agent is working in `.agent-wt/APP-001`, which is this project" apart from "the
 * agent is standing in a different repository entirely".
 */
function linkedWorktreeRoot(from) {
  try {
    const opts = { cwd: from, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-dir'], opts).trim();
    const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], opts).trim();
    if (!gitDir || !commonDir || resolve(gitDir) === resolve(commonDir)) return '';
    return dirname(commonDir);
  } catch { return ''; }
}

function gitRoot(from) {
  try {
    return dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: from, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim());
  } catch { return ''; }
}

/**
 * Resolve the project root for `from` (default: cwd).
 *
 * Returns `{ ok: true, root }` or `{ ok: false, reason, candidates }`. Callers treat the failure as
 * exit 2 — cannot evaluate — never as "use cwd and hope".
 *
 * `explicit` (a --project-root value) always wins: an operator naming a root is making a deliberate
 * choice, and this resolver exists to remove ambiguity, not to overrule people.
 */
function resolveProjectRoot({ from = process.cwd(), explicit = '' } = {}) {
  if (explicit) {
    const root = resolve(from, explicit);
    return isProjectRoot(root)
      ? { ok: true, root, via: 'explicit' }
      : { ok: false, reason: `--project-root ${explicit} does not look like a studio project (no ${MARKERS.join(' / ')})`, candidates: [] };
  }

  // A LINKED WORKTREE IS THE SAME PROJECT, ANSWERED FIRST.
  //
  // The previous version claimed worktrees were unaffected because `--git-common-dir` points back
  // at the original. That claim was FALSE, and the comment asserting it was the reason nobody
  // looked: a worktree never reached the git-boundary branch, because `docs/31-board.md` and
  // `docs/31-board-events.jsonl` are TRACKED, so `git worktree add` checks them out and the
  // worktree becomes a marker directory nested inside a marker directory — `marked.length > 1`,
  // ambiguous, exit 2.
  //
  // `skills/agent-isolation` makes a worktree MANDATORY for every writing agent, so this refused
  // the studio's primary path on every board command. A regression against main, shipped behind a
  // comment stating the opposite. Being inside a linked worktree is not ambiguity — it is exactly
  // the case where the answer is known: the common dir's parent, which is what dry run 3 required.
  const linked = linkedWorktreeRoot(from);
  if (linked) return { ok: true, root: linked, via: 'worktree' };

  const chain = ancestors(from);
  const marked = chain.filter(isProjectRoot);

  // The common case: exactly one studio root at or above us.
  if (marked.length === 1) {
    // ...unless the GIT boundary disagrees with the PROJECT boundary. Being inside a separate git
    // repository that sits within a studio project is genuinely ambiguous: the operator may mean
    // the vendored repo they are standing in, or the studio project containing it. Silently
    // choosing the outer one is safer than inventing a new project, but it is still a guess, and a
    // guess about which repository to mutate is the guess this resolver exists to refuse.
    //
    // Linked worktrees are NOT caught by this: `--git-common-dir` follows the gitdir pointer back
    // to the original .git, so an agent working in `.agent-wt/<TICKET>` resolves to the same root
    // as everyone else — which is the behaviour dry run 3 required.
    const git = gitRoot(from);
    if (git && resolve(git) !== resolve(marked[0]) && resolve(git).startsWith(`${resolve(marked[0])}/`)) {
      return {
        ok: false,
        reason:
          `the git boundary and the project boundary disagree: you are inside the git repository ${git}, ` +
          `which is nested in the studio project ${marked[0]}. Which one this command should mutate is not inferable.`,
        candidates: [marked[0], git],
      };
    }
    return { ok: true, root: marked[0], via: 'marker' };
  }

  // Nested studio projects. Picking either silently is how work lands in the wrong board, so the
  // caller is told both and asked to say which.
  if (marked.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous project root — this path is inside more than one studio project',
      candidates: marked,
    };
  }

  // No marker anywhere. If we are inside a git repo that is ITSELF inside a studio project, this is
  // the nested-repo trap: proceeding would create a new, empty project rather than joining the real
  // one. If there is no enclosing studio project either, this is simply a fresh project — the
  // ordinary `/app-init` case — and cwd is the honest answer.
  const git = gitRoot(from);
  if (git) {
    const enclosing = ancestors(dirname(git)).find(isProjectRoot);
    if (enclosing) {
      return {
        ok: false,
        reason:
          `this directory is a git repository (${git}) nested inside the studio project ${enclosing}, ` +
          'and carries no project state of its own. Writing here would create a SECOND, empty project ' +
          'rather than joining the one you are inside.',
        candidates: [enclosing, git],
      };
    }
    return { ok: true, root: git, via: 'git' };
  }
  return { ok: true, root: resolve(from), via: 'cwd' };
}

/** Format a refusal for a CLI. Names both candidates and the flag that resolves the ambiguity. */
function explainRootFailure(result) {
  return (
    `cannot determine which project this command applies to.\n  ${result.reason}\n` +
    (result.candidates.length
      ? `  candidates:\n${result.candidates.map((c) => `    ${c}\n`).join('')}` +
        '  Re-run with --project-root <path> to say which one you mean.\n'
      : '')
  );
}

export { resolveProjectRoot, explainRootFailure, isProjectRoot, MARKERS };
