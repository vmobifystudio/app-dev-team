'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/license');
const { score } = require('../src/score');
const H = require('./helpers');

const page = (lic, extra = '') => `Submitted on 1 Jan 2026 (this version, v1)\n[view license](${lic})\n${extra}`;

test('license gate: tier for every license', () => {
  const cases = [
    ['http://creativecommons.org/licenses/by/4.0/', 'FULL_REUSE_WITH_CREDIT'],
    ['http://creativecommons.org/publicdomain/zero/1.0/', 'FULL_REUSE_WITH_CREDIT'],
    ['http://creativecommons.org/licenses/by-sa/4.0/', 'IDEAS_ONLY'],
    ['http://creativecommons.org/licenses/by-nc/4.0/', 'IDEAS_ONLY'],
    ['http://creativecommons.org/licenses/by-nc-nd/4.0/', 'IDEAS_ONLY'],
    ['http://creativecommons.org/licenses/by-nc-sa/4.0/', 'IDEAS_ONLY'],
    ['http://arxiv.org/licenses/nonexclusive-distrib/1.0/', 'IDEAS_ONLY'],
  ];
  for (const [url, tier] of cases) {
    const g = L.gate({ arxivId: '2601.00001', version: 'v1', pageText: page(url) });
    assert.equal(g.tier, tier, url);
    assert.equal(g.decision, 'ALLOW');
  }
});

test('unknown license blocks publishing', () => {
  const g = L.gate({ arxivId: '2601.00001', version: 'v1', pageText: 'Submitted on 1 Jan 2026 (this version, v1) no license here' });
  assert.equal(g.decision, 'BLOCK');
  assert.equal(g.tier, 'BLOCK');
});

test('license is read from the exact version', () => {
  const g = L.gate({ arxivId: '2601.00001', version: 'v1', pageText: page('http://creativecommons.org/licenses/by/4.0/').replace('this version, v1', 'this version, v2') });
  assert.equal(g.decision, 'BLOCK');
  assert.match(g.reason, /exact version/);
});

test('newer version exists -> flag based_on_old_version', () => {
  const g = L.gate({ arxivId: 'x', version: 'v2', pageText: H.snapshot(H.A.id, H.A.v) });
  assert.ok(g.flags.includes('based_on_old_version'));
  assert.equal(g.latestVersion, 'v3');
});

test('withdrawn paper is blocked', () => {
  const g = L.gate({ arxivId: 'x', version: 'v1', pageText: page('http://creativecommons.org/licenses/by/4.0/', 'This paper has been withdrawn by the authors.') });
  assert.equal(g.decision, 'BLOCK');
  assert.ok(g.flags.includes('withdrawn'));
});

const sig = (over = {}) => ({
  citations: { status: 'ok', citations: 7 }, patents: { status: 'unavailable' },
  code_data: { status: 'ok', code_released: false, data_released: false, promised: true },
  industry: { status: 'ok', industry_authors: 0, total_authors: 5 }, funder: { status: 'unavailable' },
  readiness: { status: 'ok', cues: [{ cue: 'validation_sample', locator: 'Sec. 3.1' }, { cue: 'matched_controls', locator: 'Sec. 3.1' }, { cue: 'significance_tests', locator: 'Sec. 3.3' }, { cue: 'real_world_data', locator: 'Sec. 3.1' }] },
  ...over,
});

test('score is deterministic and matches the worked example (35/100, medium)', () => {
  const a = score({ submittedOn: '2026-03-28', field: 'cs.SE', signals: sig(), asOf: '2026-11-10T12:00:00Z' });
  const b = score({ submittedOn: '2026-03-28', field: 'cs.SE', signals: sig(), asOf: '2026-11-10T12:00:00Z' });
  assert.deepEqual(a, b);
  assert.equal(a.status, 'scored');
  assert.equal(a.score, 35);
  assert.equal(a.confidence, 'medium');
  assert.equal(a.available_weight, 75);
});

test('unavailable signals are removed from the denominator, never counted as zero', () => {
  const s = score({ submittedOn: '2026-03-28', field: 'cs.SE', signals: sig(), asOf: '2026-11-10T12:00:00Z' });
  const patents = s.components.find((c) => c.id === 'patents');
  assert.equal(patents.status, 'unavailable');
  assert.equal(s.available_weight, 75);
});

test('very new paper: "Too new to score" with a confidence level, never a fake 0', () => {
  const s = score({ submittedOn: '2026-11-05', field: 'cs.AI', signals: sig(), asOf: '2026-11-10T12:00:00Z' });
  assert.equal(s.status, 'too_new');
  assert.equal(s.score, null);
  assert.equal(s.headline, 'Too new to score');
  assert.equal(s.confidence, 'low');
});

test('author-editable signals are ignored: unknown cues and cues without a source do not count', () => {
  const s = score({ submittedOn: '2026-03-28', field: 'cs.SE', asOf: '2026-11-10T12:00:00Z', signals: sig({
    readiness: { status: 'ok', cues: [{ cue: 'my_bio_says_genius', locator: 'x' }, { cue: 'ablation_study' }] } }) });
  assert.equal(s.components.find((c) => c.id === 'readiness').points, 0);
});

test('pay-to-score does not exist: sponsored flag has no input to the score', () => {
  const a = score({ submittedOn: '2026-03-28', field: 'cs.SE', signals: sig(), asOf: '2026-11-10T12:00:00Z' });
  const b = score({ submittedOn: '2026-03-28', field: 'cs.SE', signals: { ...sig(), sponsored: true, paid: 500 }, asOf: '2026-11-10T12:00:00Z' });
  assert.equal(a.score, b.score);
});
