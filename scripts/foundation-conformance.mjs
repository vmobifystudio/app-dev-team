#!/usr/bin/env node
/**
 * FOUNDATION CONFORMANCE SUITE — the twelve invariants (I-01..I-12).
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const only = process.argv.slice(2).filter((a) => /^I-\d+$/.test(a));

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
    run('git', ['init', '-q', '.'], dir);
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

const board = (args, cwd) => run('node', [join(ROOT, 'scripts/board.mjs'), ...args], cwd);
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
  run('git', ['init', '-q', '.'], inner);
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
  board(['add', 'A-001', '--title', 'x', '--owner', 'ios-developer'], dir);
  board(['move', 'A-001', 'claimed', '--by', 'ios-developer'], dir);
  board(['move', 'A-001', 'done_reported', '--by', 'ios-developer'], dir);
  // The question is not whether role SEPARATION is checked — it is. The question is whether a
  // caller must PROVE it may assert a role at all, or merely spell it correctly.
  const invented = board(['move', 'A-001', 'approved', '--by', 'a-role-that-does-not-exist'], dir);
  const grep = run('grep', ['-rlE', 'actor/v1|attest|verifySignature', join(ROOT, 'scripts/lib')], ROOT);
  if (grep.code === 0) {
    return invented.code !== 0
      ? { state: 'PASS', detail: 'actor attestation present and an invented role is refused' }
      : { state: 'FAIL', detail: 'actor attestation exists but an invented role still passed' };
  }
  return {
    state: 'FAIL',
    detail: '`--by` is an unauthenticated string: no actor/v1, attestation or signature check exists anywhere in scripts/lib',
  };
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
  run('git', ['checkout', '-q', '-b', 'feat/x'], dir);
  writeFileSync(join(dir, 'f1.txt'), 'one\n');
  run('git', ['add', '-A'], dir); run('git', ['commit', '-qm', 'c1'], dir);
  writeFileSync(join(dir, 'f2.txt'), 'two\n');
  run('git', ['add', '-A'], dir); run('git', ['commit', '-qm', 'c2'], dir);
  writeFileSync(join(dir, 'ev.txt'), 'evidence\n');
  writeFileSync(join(dir, 'ctx.txt'), 'context\n');

  board(['add', 'A-001', '--title', 'x', '--owner', 'ios-developer'], dir);
  for (const [e, by] of [['claimed', 'ios-developer'], ['done_reported', 'ios-developer'],
    ['verified', 'verification-engineer'], ['review_requested', 'ios-developer'], ['started', 'code-reviewer']]) {
    board(['move', 'A-001', e, '--by', by], dir);
  }
  const bind = board(['move', 'A-001', 'approved', '--by', 'code-reviewer', '--bind',
    '--evidence', 'ev.txt', '--context', 'ctx.txt'], dir);
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
invariant('I-07', 'Enforced risk route', true, () => {
  const src = readFileSync(join(ROOT, 'scripts/lib/events.mjs'), 'utf8');
  const consumes = /policy[_-]decision|required_approvals|policy\.approvals/i.test(src);
  return consumes
    ? { state: 'PASS', detail: 'the governed mutation consumes a durable policy decision' }
    : { state: 'FAIL', detail: 'risk routing is advice on stdout: no policy-decision object is consumed at the transition it governs' };
});

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
invariant('I-09', 'Criterion-level proof', true, () => {
  const hit = run('grep', ['-rlE', 'criterion[_-]?evidence|evidence[_-]?registry', join(ROOT, 'scripts')], ROOT);
  return hit.code === 0
    ? { state: 'PASS', detail: 'each acceptance criterion maps to required evidence' }
    : { state: 'FAIL', detail: 'no criterion→evidence mapping: a generic green test stands in for criterion proof' };
});

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
invariant('I-11', 'One readiness reducer', true, () => {
  // The grep version of this check matched exactly one file — ITSELF — and reported PASS. Any
  // check whose only evidence is its own source text is measuring nothing. Exclude self.
  const hit = run('grep', ['-rlE', '--exclude=foundation-conformance.mjs', 'readiness[_-]?reduce|reduceReadiness', join(ROOT, 'scripts')], ROOT);
  return hit.code === 0
    ? { state: 'PASS', detail: `one readiness reducer, consumed by: ${hit.out.trim().split('\n').length} surface(s)` }
    : { state: 'FAIL', detail: 'no single readiness reducer: CLI, dashboard and control-room each compute their own picture' };
});

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

process.stdout.write('FOUNDATION CONFORMANCE — I-01..I-12\n\n');
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
