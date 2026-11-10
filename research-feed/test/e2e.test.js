'use strict';
// End to end over HTTP: reader, free follow -> Pro prompt, Pro signup, follow, alert, report, cancel, delete.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const { createApp } = require('../src/server');
const { build } = require('../src/site');
const Alerts = require('../src/alerts');

test('end to end', async (t) => {
  const out = H.tmpOut(); const db = H.open(':memory:');
  const a = await H.through(db, H.A, { publish: true, probe: () => ({ withdrawn: false }) });
  const b = await H.through(db, H.B); // approved, not yet published
  build(db, { day: '2026-11-10' });
  const app = createApp({ db, outDir: out, adminToken: 'tok-admin-1234567', clock: H.FIXED, probe: () => ({ withdrawn: false }) });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.server.close());
  const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null), r }));

  // 1. reader: no login, feed and story pages, share link works
  const feed = await fetch(base + '/'); assert.equal(feed.status, 200);
  const html = await feed.text(); assert.match(html, /Read one story today|streak/); assert.match(html, /ai-written-code-in-the-wild/);
  assert.doesNotMatch(html, /Pro prompt|\$9 per month/);                 // the Pro prompt is not on the feed until a follow
  const story = await fetch(base + '/s/ai-written-code-in-the-wild/'); assert.equal(story.status, 200);
  assert.match(story.headers.get('content-security-policy'), /default-src 'self'/);

  // 2. free reader follows a field -> Pro prompt (the only trigger)
  const f1 = await j('/api/follow', { method: 'POST', body: { field: 'AI & software' } });
  assert.equal(f1.j.pro_prompt, true);
  // Pro filters are Pro only; plain field browsing is free
  assert.equal((await j('/api/stories?min=50')).s, 402);
  assert.equal((await j('/api/stories?field=AI%20%26%20software')).s, 200);

  // 3. sign-up: consent required
  const bad = await j('/api/pro/signup', { method: 'POST', body: { name: 'Ada', email: 'ada@example.com', plan: 'monthly', age_18: true } });
  assert.equal(bad.s, 400);
  const terms = await j('/api/pro/terms?plan=annual'); assert.match(terms.j.price_line, /\$79 per year/);
  const su = await j('/api/pro/signup', { method: 'POST', body: { name: 'Ada', email: 'ada@example.com', plan: 'monthly', age_18: true, consent_auto_renew: true } });
  assert.equal(su.s, 200); const auth = { authorization: 'Bearer ' + su.j.token };

  // 4. Pro follows a field
  assert.equal((await j('/api/follow', { method: 'POST', headers: auth, body: { field: 'AI agents' } })).j.ok, true);
  assert.equal((await j('/api/stories?min=0', { headers: auth })).s, 200);

  // 5. editor publishes the second story -> alert queued -> worker sends it
  assert.equal((await j('/api/admin/publish', { method: 'POST', body: { id: b.id } })).s, 401);
  const pub = await j('/api/admin/publish', { method: 'POST', headers: { authorization: 'Bearer tok-admin-1234567' }, body: { id: b.id } });
  assert.equal(pub.j.alerts_queued, 1);
  const jobs = await j('/api/admin/jobs', { method: 'POST', headers: { authorization: 'Bearer tok-admin-1234567' }, body: {} });
  assert.equal(jobs.j.alerts.sent, 1);
  const outbox = await j('/api/admin/outbox', { headers: { authorization: 'Bearer tok-admin-1234567' } });
  assert.match(outbox.j.outbox[0].subject, /New in AI agents/);

  // 6. saves sync + CSV export with source links
  await j('/api/saves', { method: 'POST', headers: auth, body: { slug: 'ai-written-code-in-the-wild', list: 'Reading' } });
  const csv = await fetch(base + '/api/lists.csv', { headers: auth }).then((r) => r.text());
  assert.match(csv, /Reading,.*arXiv:2603\.27130v2,https:\/\/arxiv\.org\/abs\/2603\.27130v2/);
  assert.equal((await fetch(base + '/api/lists.csv')).status, 401);

  // 7. report an error -> under review at once, visible through the status file every page reads
  const rp = await j('/api/report', { method: 'POST', body: { slug: 'ai-written-code-in-the-wild', kind: 'error', body: 'Check the 33% number', contact: 'r@x.co' } });
  assert.equal(rp.j.ok, true);
  const st = await j('/status/ai-written-code-in-the-wild.json'); assert.equal(st.j.state, 'under_review');

  // 8. cancel in one click, then delete account
  assert.equal((await j('/api/pro/cancel', { method: 'POST', headers: auth })).j.ok, true);
  assert.equal((await j('/api/account/delete', { method: 'POST', headers: auth })).j.ok, true);
  assert.equal((await j('/api/me', { headers: auth })).s, 401);

  // 9. hardening: path traversal and oversize bodies
  assert.notEqual((await fetch(base + '/..%2f..%2fschema.sql')).status, 200);
  const big = await fetch(base + '/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(70000) }).then((r) => r.status, () => 'closed');
  assert.ok(big === 500 || big === 'closed' || big === 400);
});
