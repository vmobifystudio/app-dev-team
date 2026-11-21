#!/usr/bin/env node
/**
 * FOUNDATION CONFORMANCE SUITE — twelve invariants (I-01..I-12; I-09 "criterion-level proof" now
 * checks journey-gate evidence by digest — criterion-check.mjs, which no flow ever ran, is gone, QA-7).
 *
 * Usage:  node scripts/foundation-conformance.mjs [I-NN ...]    (no ids: every invariant)
 * Exit:   0 all hold · 1 one or more fail · 2 cannot evaluate, or a bad argument
 *
 * WHY THIS EXISTS, AND WHY IT WAS COMMITTED RED. The studio has 981 regression assertions and they
 * were all green while the board could lose two thirds of its concurrent writes and the read layer
 * trusted a hand-editable Markdown table over its own hash-chained log. Those assertions measure
 * MECHANISMS — does this script refuse that input. They cannot measure whether the system holds a
 * property end to end, so a defect that lives between two correct mechanisms is invisible to all
 * 981 of them.
 *
 * This suite measures INVARIANTS instead: properties that must hold no matter which mechanism is
 * involved. It was committed failing, on purpose, so that "we fixed it" is falsifiable — the same
 * reason the eval lab was built before the phases it grades.
 *
 * REPORTING RULE. Print invariant PASS/FAIL counts with a denominator. Never average these into a
 * maturity score: 9/12 is a fact, "7.4/10 mature" is a vibe, and one failed critical invariant
 * blocks a "trustworthy autonomous team" claim regardless of how much else is green.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkGateLog, writeEvidenceLog } from './lib/evidence.mjs';

import { parseArgs } from './lib/args.mjs';

// A CI runner has no git identity ("fatal: empty ident name"), and the scripts these sandboxes run
// commit. Set one only when git cannot form its own, so a configured machine is left as it was
// (same rule as scripts/test.sh).
try { execFileSync('git', ['var', 'GIT_COMMITTER_IDENT'], { stdio: 'ignore' }); } catch {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'studio-test', GIT_AUTHOR_EMAIL: 'studio-test@example.invalid', GIT_COMMITTER_NAME: 'studio-test', GIT_COMMITTER_EMAIL: 'studio-test@example.invalid' });
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
// EN-10: arguments were filtered, not parsed — `--help` (or a typo) ran the whole suite.
const { positional: only } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(), knownFlags: new Set(),
  die: (code, message) => { process.stderr.write(`foundation-conformance: ${message}\n`); process.exit(2); },
});
const badId = only.find((a) => !/^I-\d\d$/.test(a));
if (badId) { process.stderr.write(`foundation-conformance: not an invariant id: ${badId} (usage: [I-NN ...])\n`); process.exit(2); }

const results = [];

function invariant(id, title, critical, fn) {
  if (only.length && !only.includes(id)) return;
  let outcome;
  try {
    outcome = fn();
  } catch (e) {
    // A crashed check is CANNOT EVALUATE, never a pass and never a fail. A harness fault that
    // reads as a product fault sends people to fix bugs that do not exist (DR4-001).
    outcome = { state: 'CANNOT_EVALUATE', detail: `check crashed: ${e.message}` };
  }
  results.push({ id, title, critical, ...outcome });
}

function sandbox(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-'));
  try {
    run('git', ['init', '-q', '-b', 'main', '.'], dir); // -b: CI's git defaults to master, and fixtures name main
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(cmd, args, cwd) {
  try {
    return { code: 0, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/**
 * `approved` and `changes` require `--verdict <file>` (scripts/lib/verdict.mjs). The invariants
 * here are about candidate identity, capability and atomicity — not about the review's output
 * contract, which scripts/test.sh probes directly. So a minimal valid verdict is supplied when the
 * caller did not, keeping each invariant's subject visible. An invariant that fails because a
 * fixture forgot a fixture file is a harness fault reported as a product fault (DR4-001).
 */
/**
 * `verified` / `qa_passed` require --evidence a SCRIPT wrote (lib/evidence.mjs). Supplied the same
 * honest way a team would: verify-done.sh run on a real branch — the ticket's own when exactly one
 * is named for it, else a fixture branch made with plumbing so no working tree moves.
 */
function evidenceFor(cwd, ticket) {
  const git = (a) => run('git', ['-c', 'user.name=fc', '-c', 'user.email=fc@localhost', ...a], cwd);
  if (git(['rev-parse', '--verify', '-q', 'HEAD']).code !== 0) git(['commit', '-q', '--allow-empty', '-m', 'base']);
  const named = git(['branch', '--format=%(refname:short)']).out.split('\n').filter((b) => b && b.toLowerCase().includes(ticket.toLowerCase()));
  let branch;
  let base;
  if (named.length === 1) {
    branch = named[0];
    base = git(['merge-base', 'main', branch]).out.trim() || `${branch}^`;
  } else {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd, input: `fixture ${ticket}\n`, encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['mktree'], { cwd, input: `100644 blob ${blob}\tev-fixture.txt\n`, encoding: 'utf8' }).trim();
    base = git(['rev-parse', 'HEAD']).out.trim();
    const commit = git(['commit-tree', tree, '-p', base, '-m', 'evidence fixture']).out.trim();
    branch = `evfixture-${Date.now()}`;
    git(['update-ref', `refs/heads/${branch}`, commit]);
  }
  // `verified` needs a run of a command the project profile DECLARES (lib/evidence.mjs, G2-3), so a
  // fixture with no profile gets one declaring test.fast, as a team's bootstrap would.
  const profile = join(cwd, 'docs/team/project-profile.json');
  if (!existsSync(profile)) {
    mkdirSync(join(cwd, 'docs/team'), { recursive: true });
    writeFileSync(profile, `${JSON.stringify({ schema: 'project-profile/v1', test: { fast: 'echo "Executed 1 tests, with 0 failures"' } })}\n`);
  }
  const vd = run('sh', [join(ROOT, 'scripts/verify-done.sh'), branch, base, 'fast'], cwd);
  return (vd.out.match(/^ {2}Evidence: (\S+)/m) || [])[1] || '';
}
const board = (args, cwd) => {
  if ((args.includes('verified') || args.includes('qa_passed')) && args[0] === 'move' && !args.includes('--evidence')) {
    const ev = evidenceFor(cwd, args[1]);
    if (ev) args = [...args, '--evidence', ev];
  }
  if ((args.includes('approved') || args.includes('changes')) && !args.includes('--verdict')) {
    const word = args.includes('approved') ? 'APPROVE' : 'REQUEST CHANGES';
    const path = join(cwd, '.conformance-verdict.md');
    // Under --bind the Scope must be the bound candidate (board.mjs, G-F4), so name it.
    let scope = 'base..head';
    let read = '';
    if (args.includes('--bind')) {
      const head = run('git', ['rev-parse', 'HEAD'], cwd).out.trim();
      const base = run('git', ['merge-base', 'main', head], cwd).out.trim();
      scope = `${base}..${head}`;
      // C3G-13: a bound APPROVE names at least one file of the bound diff.
      read = run('git', ['diff', '--name-only', base, head], cwd).out.trim().split('\n').join(', ');
    }
    writeFileSync(path, `REVIEW VERDICT: ${word}\nScope: ${scope}\n\nRead: ${read}\n\n## Not checked\nNothing — conformance fixture.\n`);
    args = [...args, '--verdict', path];
  }
  return run('node', [join(ROOT, 'scripts/board.mjs'), ...args], cwd);
};
const logLines = (dir) => {
  const p = join(dir, 'docs/31-board-events.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

// ---------------------------------------------------------------------------------------------
// I-01  One project boundary
// ---------------------------------------------------------------------------------------------
invariant('I-01', 'One project boundary', true, () => sandbox((outer) => {
  board(['add', 'O-001', '--title', 'outer', '--owner', 'ios-developer'], outer);
  // A studio project nested inside another is the ambiguity that lets a command mutate the wrong
  // repository — the one failure no downstream gate can undo, because the write already landed.
  const inner = join(outer, 'vendor/inner');
  mkdirSync(inner, { recursive: true });
  run('git', ['init', '-q', '-b', 'main', '.'], inner);
  const r = board(['add', 'I-001', '--title', 'inner', '--owner', 'ios-developer'], inner);
  const wroteInner = existsSync(join(inner, 'docs/31-board-events.jsonl'));
  const outerCount = logLines(outer).length;
  if (r.code === 2 && /ambiguous|which project|--project-root/i.test(r.out)) {
    return { state: 'PASS', detail: 'nested root refused as CANNOT EVALUATE with candidates named' };
  }
  if (!wroteInner && outerCount > 1) {
    return { state: 'FAIL', detail: 'a command run inside the nested repo wrote into the OUTER project log' };
  }
  return { state: 'FAIL', detail: `no project boundary is asserted: nested repo silently created its own root (exit ${r.code})` };
}));

// ---------------------------------------------------------------------------------------------
// I-02  One workflow truth
// ---------------------------------------------------------------------------------------------
invariant('I-02', 'One workflow truth', true, () => sandbox((dir) => {
  board(['add', 'T-001', '--title', 'real work', '--owner', 'ios-developer'], dir);
  const view = join(dir, 'docs/31-board.md');
  // Edit ONLY the generated view, to a LEGAL status and a REAL role — an illegal value would be
  // caught incidentally by an unrelated validity rule and would prove nothing about precedence.
  writeFileSync(view, readFileSync(view, 'utf8').replace('| ios-developer | — | todo |', '| android-developer | — | in_progress |'));
  const shown = run('node', ['-e', `
    import(${JSON.stringify(join(ROOT, 'scripts/lib/project.mjs'))}).then((m) => {
      const rows = m.buildRows(m.readSource(process.cwd(), m.REL.board), m.loadLog(m.readSource(process.cwd(), m.REL.log)));
      console.log(JSON.stringify(rows.rows.map((r) => ({ id: r.id, status: r.status, owner: r.owner }))));
    });`], dir);
  const seen = JSON.parse(shown.out.trim() || '[]')[0] || {};
  if (seen.status === 'todo' && seen.owner === 'ios-developer') {
    return { state: 'PASS', detail: 'the read layer reports the log, not the hand-edited view' };
  }
  return {
    state: 'FAIL',
    detail: `the read layer reports the hand-edited VIEW (${seen.owner}/${seen.status}) while the log says ios-developer/todo`,
  };
}));

// ---------------------------------------------------------------------------------------------
// I-03  Atomic admission
// ---------------------------------------------------------------------------------------------
invariant('I-03', 'Atomic admission', true, () => sandbox((dir) => {
  const N = 12;
  const script = Array.from({ length: N }, (_, i) =>
    `node ${JSON.stringify(join(ROOT, 'scripts/board.mjs'))} add C-${String(i + 1).padStart(3, '0')} --title t${i} --owner ios-developer >/dev/null 2>&1 &`
  ).join('\n');
  run('sh', ['-c', `${script}\nwait`], dir);
  const lines = logLines(dir);
  const verify = board(['verify'], dir);
  if (lines.length === N && verify.code === 0) {
    return { state: 'PASS', detail: `${N}/${N} concurrent admissions committed, chain intact` };
  }
  return {
    state: 'FAIL',
    detail: `${lines.length}/${N} events survived ${N} concurrent writers` +
      (verify.code !== 0 ? '; chain BROKEN' : '') +
      ` — ${N - lines.length} silently lost`,
  };
}));

// ---------------------------------------------------------------------------------------------
// I-04  Authenticated authority
// ---------------------------------------------------------------------------------------------
invariant('I-04', 'Authenticated authority', true, () => sandbox((dir) => {
  // BEHAVIOURAL. The grep version of this check ("does the word attest appear anywhere in
  // scripts/lib") would have gone green the moment the file existed, whether or not anything
  // consulted it — the same trap that made I-05 certify unfixed code.
  //
  // The question is NOT whether role separation is enforced; it is. The question is whether a
  // caller must PROVE it may assert a role, or merely spell it correctly.
  mkdirSync(join(dir, 'docs/team'), { recursive: true });
  writeFileSync(join(dir, '.studio-policy.json'), JSON.stringify({ requireAttestedActors: true }));
  writeFileSync(join(dir, 'docs/team/actors.json'), JSON.stringify({
    actors: { 'dev-1': { roles: ['ios-developer'], secret: 's-dev' } },
  }));

  // 1. A bare `--by` with no actor at all must not proceed.
  const bare = board(['add', 'T-001', '--title', 'x', '--owner', 'ios-developer', '--by', 'tech-manager'], dir);
  if (bare.code === 0) return { state: 'FAIL', detail: '`--by` alone was accepted under requireAttestedActors — the role is still just a string' };

  // 2. A REAL actor holding a REAL token, claiming a role it was never granted. This is the
  //    self-approval bypass in its purest form: one process supplying two names.
  const minted = run('node', ['-e',
    `import(${JSON.stringify(join(ROOT, 'scripts/lib/actor.mjs'))}).then((m) => {` +
    `const r = m.mintToken({ root: process.cwd(), actorId: 'dev-1', role: 'code-reviewer', ticket: 'T-001', event: 'created', ts: '' });` +
    'process.stdout.write(r.ok ? r.token : "");});'], dir).out.trim();
  const invented = board(['add', 'T-001', '--title', 'x', '--owner', 'ios-developer',
    '--by', 'code-reviewer', '--actor', 'dev-1', '--actor-token', minted], dir);
  if (invented.code === 0) return { state: 'FAIL', detail: 'dev-1 asserted "code-reviewer", a role it was never granted, and the event was accepted' };

  // 3. ...and the legitimate case still works, or this is a wall rather than a gate.
  const good = run('node', ['-e',
    `import(${JSON.stringify(join(ROOT, 'scripts/lib/actor.mjs'))}).then((m) => {` +
    `const r = m.mintToken({ root: process.cwd(), actorId: 'dev-1', role: 'ios-developer', ticket: 'T-001', event: 'created', ts: '' });` +
    'process.stdout.write(r.ok ? r.token : "");});'], dir).out.trim();
  const ok = board(['add', 'T-001', '--title', 'x', '--owner', 'ios-developer',
    '--by', 'ios-developer', '--actor', 'dev-1', '--actor-token', good], dir);
  if (ok.code !== 0) return { state: 'FAIL', detail: `a correctly attested actor was refused: ${ok.out.trim().split('\n')[0]}` };

  // 4. The durable record must say which regime produced it. Without this stamp, turning the flag
  //    on tomorrow retroactively launders every unproven decision made before it.
  const stamped = logLines(dir).some((l) => { try { return JSON.parse(l).actor?.mode === 'attested'; } catch { return false; } });
  if (!stamped) return { state: 'FAIL', detail: 'the accepted event carries no actor/v1 mode — history cannot distinguish proven from asserted' };

  // 5. PER-SPAWN TOKENS (G-F1), the mode a new project defaults to: the registry holds hashes, so
  //    READING it proves nothing. A gate event with --by alone, or with a token minted for another
  //    role, is refused; the token minted for this role on this ticket is accepted.
  const tokens = sandbox((t) => {
    writeFileSync(join(t, '.studio-policy.json'), JSON.stringify({ requireActorTokens: true }));
    board(['add', 'K-001', '--title', 'x', '--owner', 'ios-developer'], t);
    board(['move', 'K-001', 'claimed', '--by', 'ios-developer'], t);
    board(['move', 'K-001', 'done_reported', '--by', 'ios-developer'], t);
    const mint = (role) => run('node', [join(ROOT, 'scripts/board.mjs'), 'actor', 'mint', '--role', role, '--ticket', 'K-001'], t).out.trim();
    if (board(['move', 'K-001', 'rejected', '--by', 'tech-lead'], t).code === 0) return 'a gate event with --by alone was accepted under requireActorTokens';
    if (board(['move', 'K-001', 'rejected', '--by', 'tech-lead', '--token', mint('ios-developer')], t).code === 0) return 'a token minted for ios-developer cleared a tech-lead gate';
    const reg = readFileSync(join(t, 'docs/team/actor-tokens.jsonl'), 'utf8');
    const good = mint('tech-lead');
    if (reg.includes(good)) return 'the token registry stores the plaintext token — reading it would mint any role';
    const r = board(['move', 'K-001', 'rejected', '--by', 'tech-lead', '--token', good], t);
    return r.code === 0 ? '' : `the correctly minted token was refused: ${r.out.trim().split('\n')[0]}`;
  });
  if (tokens) return { state: 'FAIL', detail: tokens };

  return { state: 'PASS', detail: 'a role must be granted to an actor and proven per-assertion (HMAC, or a per-spawn token whose plaintext is on no disk); the regime is stamped on the event' };
}));

// ---------------------------------------------------------------------------------------------
// I-05  Complete work identity
// ---------------------------------------------------------------------------------------------
invariant('I-05', 'Complete work identity', true, () => sandbox((dir) => {
  // BEHAVIOURAL, AND IT TOOK TWO TRIES TO GET THERE. The first draft grepped approval-check.mjs for
  // /merge[_-]?base|candidate_id/ and matched a COMMENT. The second draft grepped for `--base` and
  // was PROVEN by the code-reviewer to pass on main's UNFIXED file plus one added comment line
  // reading "someday we should accept --base" — it certified the exact code it exists to reject,
  // while carrying a comment saying a regex cannot tell an assertion from a citation.
  //
  // So this one runs the product: it builds a real two-commit branch, binds an approval through the
  // CLI, and asks git what the approval actually covers.
  const g = (args) => run('git', args, dir).out.trim();
  run('git', ['config', 'user.email', 't@t'], dir); run('git', ['config', 'user.name', 't'], dir);
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  run('git', ['add', '-A'], dir); run('git', ['commit', '-qm', 'base'], dir);
  run('git', ['branch', '-M', 'main'], dir);
  run('git', ['checkout', '-q', '-b', 'feat/A-001-x'], dir);
  writeFileSync(join(dir, 'f1.txt'), 'one\n');
  run('git', ['add', '-A'], dir); run('git', ['commit', '-qm', 'c1'], dir);
  writeFileSync(join(dir, 'f2.txt'), 'two\n');
  run('git', ['add', '-A'], dir); run('git', ['commit', '-qm', 'c2'], dir);

  board(['add', 'A-001', '--title', 'x', '--owner', 'ios-developer'], dir);
  for (const [e, by] of [['claimed', 'ios-developer'], ['done_reported', 'ios-developer'],
    ['verified', 'verification-engineer'], ['review_requested', 'ios-developer'], ['started', 'code-reviewer']]) {
    board(['move', 'A-001', e, '--by', by], dir);
  }
  // --bind re-derives its evidence (a verify-done record for exactly this tip) and reads a
  // context-manifest/v2 (board.mjs, G2-6) — any file at all used to be hashed and accepted.
  run('node', [join(ROOT, 'scripts/context-manifest.mjs'), 'create', '--source', 'a.txt'], dir);
  const bind = board(['move', 'A-001', 'approved', '--by', 'code-reviewer', '--bind',
    '--evidence', evidenceFor(dir, 'A-001'), '--context', 'docs/team/context-manifest.json'], dir);
  if (bind.code !== 0) return { state: 'CANNOT_EVALUATE', detail: `could not bind an approval: ${bind.out.trim().split('\n')[0]}` };

  const events = logLines(dir).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const approval = events.filter((e) => e.event === 'approved').pop();
  const detail = approval?.detail || {};
  const mergeBase = g(['merge-base', 'main', 'HEAD']);
  const tipParent = g(['rev-parse', 'HEAD^']);

  if (!detail.base) return { state: 'FAIL', detail: 'the approval records no base — it binds a single commit, so earlier commits on the branch are unapproved' };
  if (detail.base === tipParent && tipParent !== mergeBase) {
    return { state: 'FAIL', detail: `the approval binds HEAD^..HEAD (${tipParent.slice(0, 8)}), not the branch (${mergeBase.slice(0, 8)}..HEAD) — earlier commits are unapproved` };
  }
  if (detail.base !== mergeBase) return { state: 'FAIL', detail: `the approval's base ${String(detail.base).slice(0, 8)} is neither the merge-base nor HEAD^` };
  if (!Array.isArray(detail.files) || !detail.files.includes('f1.txt') || !detail.files.includes('f2.txt')) {
    return { state: 'FAIL', detail: `the approved file set is ${JSON.stringify(detail.files)} — it does not cover every commit on the branch` };
  }
  // THE ROUND TRIP. Binding and verifying were written apart, and for the life of that gap a
  // correctly bound approval was reported as tampered with because one side trimmed the diff and
  // the other did not. Section 4b: put the collection site and the verification site next to each other.
  writeFileSync(join(dir, '.studio-policy.json'), JSON.stringify({ requireApprovalBinding: true }));
  const check = run('node', [join(ROOT, 'scripts/approval-check.mjs'),
    '--log', join(dir, 'docs/31-board-events.jsonl'), '--policy', join(dir, '.studio-policy.json')], dir);
  if (check.code !== 0) return { state: 'FAIL', detail: `approval-check rejects an approval the CLI just bound: ${check.out.trim().split('\n')[0]}` };
  return { state: 'PASS', detail: 'an approval binds base..head, covers every commit, and re-verifies clean' };
}));

// ---------------------------------------------------------------------------------------------
// I-06  Candidate-bound evidence
// ---------------------------------------------------------------------------------------------
invariant('I-06', 'Candidate-bound evidence', true, () => {
  const gate = readFileSync(join(ROOT, 'scripts/journey-gate.mjs'), 'utf8');
  const digests = /sha256|digest|content[_-]?hash/i.test(gate);
  // `--exclude` self, exactly as I-11 already does. Without it this matched its own source line
  // AND `STALE_LOCK_MS`, an unrelated lock constant — a check reporting the feature it is looking
  // for because it mentioned it. I-11 carried the exclusion and a comment explaining this trap;
  // I-06 did not get it. FC-001 inside the anti-FC-002 tool.
  const stale = run('grep', ['-rl', '--exclude=foundation-conformance.mjs', 'STALE:', join(ROOT, 'scripts')], ROOT).code === 0;
  if (digests && stale) return { state: 'PASS', detail: 'evidence is content-addressed and invalidates as STALE' };
  return {
    state: 'FAIL',
    detail: `evidence existence is checked but ${!digests ? 'no digest is captured at evaluation' : 'nothing invalidates it'}` +
      ' — a mutable path can still stand in for durable proof',
  };
});

// ---------------------------------------------------------------------------------------------
// I-07  Enforced risk route
// ---------------------------------------------------------------------------------------------
invariant('I-07', 'Enforced risk route', true, () => sandbox((dir) => {
  // Behavioural. The grep version asked whether events.mjs MENTIONED a policy decision — which a
  // comment satisfies. What matters is whether the governed mutation refuses without one.
  mkdirSync(join(dir, 'docs/team'), { recursive: true });
  writeFileSync(join(dir, 'docs/team/risk-policy.json'), JSON.stringify({
    schema: 'risk-policy/v1',
    default: { risk: 'low', model: 'sonnet', approvals: [], required_evidence: [] },
    rules: [{ match: { path: '**/billing/**' }, risk: 'critical', model: 'opus',
      approvals: ['code-reviewer', 'security-reviewer'], required_evidence: ['security-review'] }],
  }));
  board(['add', 'PAY-001', '--title', 'billing change', '--owner', 'ios-developer',
    '--file', 'src/billing/Checkout.swift', '--invariant', 'totals never negative'], dir);
  // The merge reads the ticket's DIFF (board.mjs, G2-7: an unknown diff is refused, never "no
  // risk"), so the fixture carries the ticket's branch, as a real one would.
  const g = (a) => run('git', ['-c', 'user.name=fc', '-c', 'user.email=fc@localhost', ...a], dir);
  g(['commit', '-q', '--allow-empty', '-m', 'base']);
  g(['checkout', '-q', '-b', 'feat/PAY-001-billing']);
  mkdirSync(join(dir, 'src/billing'), { recursive: true });
  writeFileSync(join(dir, 'src/billing/Checkout.swift'), 'let total = 0\n');
  g(['add', 'src']); g(['commit', '-q', '-m', 'billing']); g(['checkout', '-q', '-']);
  for (const [e, by] of [['claimed', 'ios-developer'], ['done_reported', 'ios-developer'],
    ['verified', 'verification-engineer'], ['review_requested', 'ios-developer'],
    ['started', 'code-reviewer'], ['approved', 'code-reviewer']]) {
    const m = board(['move', 'PAY-001', e, '--by', by], dir);
    // A setup move that fails makes the merge refusal below meaningless — say which one, and why.
    if (m.code !== 0) return { state: 'FAIL', detail: `fixture move ${e} --by ${by} was refused: ${m.out.trim().split('\n').slice(0, 3).join(' / ')}` };
  }

  // The generic review is present and the separation rule is satisfied. Only the SPECIALIST the
  // risk route demanded is missing — the requirement that used to be printed and discarded.
  const short = board(['move', 'PAY-001', 'merged', '--by', 'tech-manager'], dir);
  if (short.code === 0) {
    return { state: 'FAIL', detail: 'a critical-risk change merged with the required security-reviewer approval absent — the risk route is advice, not a precondition' };
  }
  if (!/security-reviewer/.test(short.out)) {
    return { state: 'FAIL', detail: `merge was refused, but not for the missing specialist: ${short.out.trim().split('\n')[1] || ''}` };
  }
  // ...and it must be a gate, not a wall.
  board(['move', 'PAY-001', 'approved', '--by', 'security-reviewer'], dir);
  const ok = board(['move', 'PAY-001', 'merged', '--by', 'tech-manager'], dir);
  if (ok.code !== 0) return { state: 'FAIL', detail: 'the merge stayed refused after every required approval was recorded' };
  return { state: 'PASS', detail: 'the risk route\'s required approvals are a precondition of the mutation they govern' };
}));

// ---------------------------------------------------------------------------------------------
// I-08  Bidirectional scope coverage
// ---------------------------------------------------------------------------------------------
invariant('I-08', 'Bidirectional scope coverage', true, () => sandbox((dir) => {
  // Behavioural for the same reason as I-05: the grep version PASSed on the word "reverse"
  // appearing inside a code comment in trace.mjs.
  mkdirSync(join(dir, 'docs'), { recursive: true });
  // Requirements are the `F-` kind and must be DECLARED in brackets — the first draft of this
  // fixture wrote `R-002`, which trace.mjs classifies as a release, so the check could never have
  // fired regardless of the code under test. A fixture that cannot express the defect proves
  // nothing about the detector.
  writeFileSync(join(dir, 'docs/10-prd.md'), [
    '# PRD', '', '## Requirements', '',
    '- [F-001] the user can save a reading.',
    '- [F-002] the user can export their history.',
    '',
  ].join('\n'));
  board(['add', 'T-001', '--title', 'save a reading', '--owner', 'ios-developer', '--feature', 'F-001'], dir);
  const r = run('node', [join(ROOT, 'scripts/trace.mjs')], dir);
  return /F-002/.test(r.out) && /requirement_not_implemented/.test(r.out)
    ? { state: 'PASS', detail: 'an in-scope requirement that nothing implements is a named finding' }
    : { state: 'FAIL', detail: 'trace follows links forward only: R-002 is in scope, unimplemented, and unreported' };
}));

// ---------------------------------------------------------------------------------------------
// I-09  Criterion-level proof
// ---------------------------------------------------------------------------------------------
invariant('I-09', 'Criterion-level proof', true, () => sandbox((dir) => {
  // Sprint 8 (QA-7): criteria are proven by journey assertions, each journey's evidence named by
  // digest in journey-gate's result. criterion-check.mjs + criteria.json had no writer and no caller.
  mkdirSync(join(dir, 'artifacts'), { recursive: true });
  writeFileSync(join(dir, 'artifacts/ac1.png'), 'screenshot bytes\n');
  const sha256 = createHash('sha256').update(readFileSync(join(dir, 'artifacts/ac1.png'))).digest('hex');
  const v = { schema: 'gate-result/v1', gate: 'journey-gate', subject: { head: null }, result: 'PASS',
    journeys: [{ id: 'AC-001', state: 'PASS', evidence: [{ path: 'artifacts/ac1.png', sha256 }] }],
    ...writeEvidenceLog(dir, 'journey-i09', 'RESULT: PASS\nGATE-SUBJECT: null\n') };
  if (!checkGateLog(dir, v, { coverage: false }).ok) return { state: 'FAIL', detail: 'a journey verdict whose evidence still matches was refused' };
  writeFileSync(join(dir, 'artifacts/ac1.png'), 'a DIFFERENT run\n');
  if (checkGateLog(dir, v, { coverage: false }).ok) return { state: 'FAIL', detail: 'the journey stayed proven after its evidence was overwritten with different bytes' };
  return { state: 'PASS', detail: 'each journey names its own evidence, matched by digest; a changed artifact blocks' };
}));

// ---------------------------------------------------------------------------------------------
// I-10  Durable recovery
// ---------------------------------------------------------------------------------------------
invariant('I-10', 'Durable recovery', true, () => sandbox((dir) => {
  board(['add', 'R-001', '--title', 'x', '--owner', 'ios-developer'], dir);
  const before = logLines(dir).length;
  // The first draft of this check submitted `claimed` twice and counted ONE new event, so it
  // reported PASS. That was the state machine refusing an illegal second claim, not idempotency —
  // board.mjs contains no idempotency support at all. The check has to prove the mechanism EXISTS,
  // not observe an outcome some other rule happens to produce.
  const first = board(['move', 'R-001', 'claimed', '--by', 'ios-developer', '--idempotency-key', 'k1'], dir);
  if (first.code !== 0 && /unknown|unrecognis|unexpected/i.test(first.out)) {
    return { state: 'FAIL', detail: 'no idempotency key is accepted: a retry after a timeout duplicates the effect' };
  }
  const replay = board(['move', 'R-001', 'claimed', '--by', 'ios-developer', '--idempotency-key', 'k1'], dir);
  const added = logLines(dir).length - before;
  if (added === 1 && replay.code === 0) return { state: 'PASS', detail: 'a replayed transition commits exactly once and reports success' };
  return { state: 'FAIL', detail: `replay produced ${added} event(s) and exit ${replay.code} — retry is not idempotent` };
}));

// ---------------------------------------------------------------------------------------------
// I-11  One readiness reducer
// ---------------------------------------------------------------------------------------------
invariant('I-11', 'One readiness reducer', true, () => sandbox((dir) => {
  // Behavioural. The grep version matched only its own source file and reported PASS — the same
  // trap that flattered I-05 and I-06. What matters is that two SURFACES agree, so this asks both.
  run('git', ['config', 'user.email', 't@t'], dir); run('git', ['config', 'user.name', 't'], dir);
  mkdirSync(join(dir, 'docs/team'), { recursive: true });
  writeFileSync(join(dir, 'docs/team/journey-result.json'), JSON.stringify({
    schema: 'gate-result/v1', gate: 'journey-gate', subject: { head: 'deadbeef', dirty: false },
    result: 'PASS', journeys: [],
  }));
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  run('git', ['add', '-A'], dir); run('git', ['commit', '-qm', 'c1'], dir);

  const cli = run('node', [join(ROOT, 'scripts/readiness.mjs'), '--root', dir, '--json'], dir);
  let fromCli;
  try { fromCli = JSON.parse(cli.out); } catch { return { state: 'FAIL', detail: 'the readiness CLI did not emit parseable state' }; }

  // The dashboard's assembled state must carry the SAME object, not its own recomputation.
  const dash = run('node', ['-e',
    `import(${JSON.stringify(join(ROOT, 'scripts/lib/readiness.mjs'))}).then((m) => ` +
    `process.stdout.write(JSON.stringify(m.reduceReadiness(${JSON.stringify(dir)}))));`], dir);
  let fromLib;
  try { fromLib = JSON.parse(dash.out); } catch { return { state: 'FAIL', detail: 'the shared reducer did not emit parseable state' }; }

  if (JSON.stringify(fromCli.gates) !== JSON.stringify(fromLib.gates) || fromCli.verdict !== fromLib.verdict) {
    return { state: 'FAIL', detail: `the CLI and the shared reducer disagree (${fromCli.verdict} vs ${fromLib.verdict})` };
  }
  // The verdict must be STALE here: the recorded subject is not this candidate. If it reported
  // PASS, a release could go out on a verdict about a different commit entirely.
  if (fromCli.verdict !== 'STALE') {
    return { state: 'FAIL', detail: `a gate result recorded for a different commit yielded "${fromCli.verdict}", not STALE` };
  }
  return { state: 'PASS', detail: 'CLI and dashboard project one reducer; a verdict about another candidate reads STALE' };
}));

// ---------------------------------------------------------------------------------------------
// I-12  Human-only publication
// ---------------------------------------------------------------------------------------------
invariant('I-12', 'Human-only publication', true, () => {
  // Expected GREEN. It is here to stay green: a constitutional constraint with no test is a
  // promise, and this repository's whole thesis is that a rule nobody executes is not a rule.
  // Exclude this file and the test suite: both NAME the forbidden commands in order to forbid
  // them. A checker that flags its own prohibition is the citation-vs-assertion trap again — it
  // fired on the first run and reported the constitutional constraint as violated by itself.
  const bad = run('grep', [
    '-rlnE', '--exclude=foundation-conformance.mjs', '--exclude=test.sh',
    '(xcrun +altool|fastlane +(deliver|pilot|supply)|--upload-app)',
    join(ROOT, 'scripts'), join(ROOT, 'commands'),
  ], ROOT);
  return bad.code !== 0
    ? { state: 'PASS', detail: 'no executable path can submit or publish to a store' }
    : { state: 'FAIL', detail: `an executable publication path exists: ${bad.out.trim()}` };
});

// ---------------------------------------------------------------------------------------------

const pass = results.filter((r) => r.state === 'PASS').length;
const fail = results.filter((r) => r.state === 'FAIL').length;
const unknown = results.filter((r) => r.state === 'CANNOT_EVALUATE').length;

process.stdout.write('FOUNDATION CONFORMANCE — I-01..I-12 (I-09 retired)\n\n');
for (const r of results) {
  const mark = r.state === 'PASS' ? 'PASS' : r.state === 'FAIL' ? 'FAIL' : '????';
  process.stdout.write(`  ${mark}  ${r.id}  ${r.title}\n        ${r.detail}\n`);
}
process.stdout.write(`\n  ${pass}/${results.length} invariants hold`);
process.stdout.write(fail ? `, ${fail} failing` : '');
process.stdout.write(unknown ? `, ${unknown} cannot evaluate` : '');
process.stdout.write('\n');

if (fail || unknown) {
  process.stdout.write(
    '\n  The foundation is NOT ESTABLISHED. Report these counts, never an averaged score:\n' +
    '  one failed critical invariant blocks a "trustworthy autonomous team" claim regardless\n' +
    '  of how many documentation capabilities pass.\n'
  );
}
process.exit(fail ? 1 : unknown ? 2 : 0);
