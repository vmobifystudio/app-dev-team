'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cutUnsourced, evalFormula, storyText } = require('../src/claims');
const { check } = require('../src/checker');
const { copycheck } = require('../src/copycheck');
const G = require('../src/guard');
const H = require('./helpers');

const load = (id) => ({ draft: JSON.parse(fs.readFileSync(path.join(H.ROOT, `content/drafts/${id}.json`), 'utf8')), facts: JSON.parse(fs.readFileSync(path.join(H.ROOT, `data/facts/${id}.json`), 'utf8')) });
const clone = (o) => JSON.parse(JSON.stringify(o));

test('both demo drafts pass the checker', () => {
  for (const [id, tier] of [['2603.27130v2', 'FULL_REUSE_WITH_CREDIT'], ['2611.08483v1', 'IDEAS_ONLY']]) {
    const { draft, facts } = load(id);
    const r = check({ draft, facts, tier, peerReviewed: false });
    assert.deepEqual(r.errors, [], id);
  }
});

test('checker catches a wrong number', () => {
  const { draft, facts } = load('2603.27130v2');
  const d = clone(draft); d.claims.ploc.numbers = ['256.57', '199.99']; d.claims.ploc.display = '256.57 and 199.99';
  const r = check({ draft: d, facts, tier: 'FULL_REUSE_WITH_CREDIT', peerReviewed: false });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('199.99')));
});

test('checker catches a right number in the wrong column', () => {
  const { draft, facts } = load('2603.27130v2');
  const d = clone(draft); d.claims.ploc.numbers = ['192.68', '256.57']; // swapped
  const r = check({ draft: d, facts, tier: 'FULL_REUSE_WITH_CREDIT', peerReviewed: false });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /column/.test(e)));
});

test('checker recomputes "computed" numbers and rejects a wrong result', () => {
  const { draft, facts } = load('2603.27130v2');
  const d = clone(draft); d.claims.highx.display = '2.5';
  const r = check({ draft: d, facts, tier: 'FULL_REUSE_WITH_CREDIT', peerReviewed: false });
  assert.ok(r.errors.some((e) => /recomputed/.test(e)));
});

test('a number in the text with no claim fails', () => {
  const { draft, facts } = load('2603.27130v2');
  const d = clone(draft); d.cards[2].sentences[0].t = 'They found 99,999 saves of code where AI helped.';
  const r = check({ draft: d, facts, tier: 'FULL_REUSE_WITH_CREDIT', peerReviewed: false });
  assert.ok(r.errors.some((e) => /99999/.test(e)));
});

test('no source for a claim: the claim and its sentence are cut automatically', () => {
  const { draft } = load('2603.27130v2');
  const d = clone(draft); delete d.claims.commits.locator;
  const cut = cutUnsourced(d);
  assert.ok(cut.log.some((l) => l.type === 'claim' && l.id === 'commits'));
  assert.ok(cut.log.some((l) => l.type === 'sentence' && /12,749/.test(l.text)));
  assert.ok(!JSON.stringify(cut.draft).includes('12,749 saves'));
});

test('every image needs alt text and a caption', () => {
  const { draft, facts } = load('2603.27130v2');
  const d = clone(draft); d.cards[4].visual.alt = ''; delete d.cards[4].visual.caption;
  const r = check({ draft: d, facts, tier: 'FULL_REUSE_WITH_CREDIT', peerReviewed: false });
  assert.ok(r.errors.some((e) => /alt text/.test(e)));
  assert.ok(r.errors.some((e) => /caption/.test(e)));
});

test('securities rail: investing language blocks the story', () => {
  const { draft, facts } = load('2611.08483v1');
  for (const bad of ['Join our round and invest now.', 'The team raised a seed round at a high valuation.']) {
    const d = clone(draft); d.cards[0].sentences[0].t = bad;
    const r = check({ draft: d, facts, tier: 'IDEAS_ONLY', peerReviewed: false });
    assert.ok(r.errors.some((e) => /rail securities/.test(e)), bad);
  }
  assert.equal(G.scan('Research signal. Not investment advice.').length, 0);
});

test('ideas-only story may not declare reused text', () => {
  const { draft, facts } = load('2611.08483v1');
  const d = clone(draft); d.reuse = [{ kind: 'quote', text: 'x' }];
  assert.ok(check({ draft: d, facts, tier: 'IDEAS_ONLY', peerReviewed: false }).errors.some((e) => /ideas-only/.test(e)));
});

test('formula evaluator is safe (no eval)', () => {
  assert.equal(evalFormula('(a-b)/b*100', { a: 150, b: 100 }), 50);
  assert.throws(() => evalFormula('process.exit()', {}));
  assert.throws(() => evalFormula('a;b', { a: 1, b: 2 }));
});

test('copy check: a copied sentence fails, own words pass', () => {
  const src = 'The increased size of the AI generated code comes from expanded structures and not from more comments in the files we studied.';
  const bad = copycheck({ storyText: 'We saw that the increased size of the AI generated code comes from expanded structures.', sourceText: src, tier: 'IDEAS_ONLY' });
  assert.equal(bad.status, 'fail');
  const ok = copycheck({ storyText: 'Bigger files come from longer logic, not from notes.', sourceText: src, tier: 'IDEAS_ONLY' });
  assert.equal(ok.status, 'pass');
  assert.equal(copycheck({ storyText: 'x', sourceText: '', tier: 'IDEAS_ONLY' }).status, 'skipped');
});

test('real papers: copy check passes if the paper text is on this machine', { skip: !process.env.RF_SOURCE_TEXT_DIR }, () => {
  for (const [id, tier] of [['2603.27130v2', 'FULL_REUSE_WITH_CREDIT'], ['2611.08483v1', 'IDEAS_ONLY']]) {
    const f = path.join(process.env.RF_SOURCE_TEXT_DIR, `${id}.md`);
    if (!fs.existsSync(f)) continue;
    const { draft } = load(id);
    const r = copycheck({ storyText: storyText(draft), sourceText: fs.readFileSync(f, 'utf8'), tier, allowedQuotes: (draft.reuse || []).map((x) => x.text) });
    assert.equal(r.status, 'pass', id);
  }
});

test('CSV export neutralises spreadsheet formulas', () => {
  assert.equal(G.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(G.csvCell('plain'), 'plain');
});

test('creator honesty tags are all required (phase 3)', () => {
  assert.equal(G.creatorTagsOk({ 'I am the author': true, 'I am the founder': false, 'I hold equity': false }), true);
  assert.equal(G.creatorTagsOk({ 'I am the author': true }), false);
});
