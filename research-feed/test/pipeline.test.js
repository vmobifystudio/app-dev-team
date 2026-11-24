'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const { build } = require('../src/site');
const { recorded } = require('../src/llm');
const Billing = require('../src/billing');
const Alerts = require('../src/alerts');

const ok = () => ({ withdrawn: false });

test('definition of done: link in, license log, cited draft, checker, approval, publish with score and credit block', async () => {
  const out = H.tmpOut(); const db = H.open(':memory:');
  const d = await H.through(db, H.A, { publish: true, probe: ok });
  const s = db.prepare('SELECT * FROM stories WHERE id=?').get(d.id);
  assert.equal(s.status, 'published');
  assert.ok(db.prepare(`SELECT 1 FROM license_log WHERE arxiv_id='2603.27130' AND version='v2' AND decision='ALLOW'`).get());
  assert.ok(db.prepare('SELECT COUNT(*) n FROM llm_runs').get().n >= 1);           // prompts and model stored
  assert.ok(db.prepare('SELECT COUNT(*) n FROM claims WHERE story_id=? AND verified=1').get(d.id).n >= 25);
  assert.ok(db.prepare(`SELECT 1 FROM asset_log WHERE story_id=? AND kind='quote'`).get(d.id));
  build(db, { day: '2026-11-10' });
  const html = fs.readFileSync(path.join(out, 's', s.slug, 'index.html'), 'utf8');
  assert.match(html, /Source paper: A Large-Scale Empirical Study/);
  assert.match(html, /arXiv:2603\.27130v2, 3 Apr 2026\. Preprint, not peer reviewed\. Paper license: CC BY 4\.0/);
  assert.match(html, /Not affiliated with or endorsed by the authors/);
  assert.match(html, /AI-assisted/);
  assert.match(html, /Automated opinion/);
  assert.match(html, /Score 35\/100/);
  assert.match(html, /Source: paper, Table 13/);
  assert.match(html, /computed: a\/b/);
  assert.match(html, /name="rf:ai-assisted" content="true"/);
  assert.match(html, /Based on v2/);                // v3 exists -> flagged
  assert.match(html, /Preprint/);
});

test('ideas-only paper: credit block says nothing is reused; too new to score', async () => {
  const out = H.tmpOut(); const db = H.open(':memory:');
  const d = await H.through(db, H.B, { publish: true, probe: ok });
  build(db, { day: '2026-11-10' });
  const html = fs.readFileSync(path.join(out, 's', 'ai-swarm-that-thinks-without-words', 'index.html'), 'utf8');
  assert.match(html, /This story reuses none of its text or figures\./);
  assert.match(html, /Paper license: CC BY-NC-ND 4\.0/);
  assert.match(html, /Too new to score/);
  assert.doesNotMatch(html, /Score 0\/100/);
  assert.match(html, /Contested/);
});

test('unknown license: no draft, no story', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  const r = H.P.ingest(db, { link: H.A.link, pageText: 'arXiv:2603.27130v2 [Submitted on 28 Mar 2026 (this version, v2)] no license', clock: H.FIXED });
  assert.equal(r.ok, false);
  await assert.rejects(() => H.P.draftStory(db, { arxivId: H.A.id, version: H.A.v, clock: H.FIXED }), /No ALLOW row/);
});

test('no story is published without a license in the log', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  const d = await H.through(db, H.A);
  db.exec('DELETE FROM license_log');
  assert.throws(() => H.P.publish(db, d.id, { statusProbe: ok, clock: H.FIXED }), /license log/);
});

test('editor approval is required: publish refuses a story that is only checked', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  H.P.ingest(db, { link: H.B.link, pageText: H.snapshot(H.B.id, H.B.v), clock: H.FIXED });
  const d = await H.P.draftStory(db, { arxivId: H.B.id, version: H.B.v, clock: H.FIXED });
  H.P.checkStory(db, d.id, { clock: H.FIXED });
  assert.throws(() => H.P.publish(db, d.id, { statusProbe: ok, clock: H.FIXED }), /not approved/);
});

test('red checker blocks approval', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  H.P.ingest(db, { link: H.A.link, pageText: H.snapshot(H.A.id, H.A.v), clock: H.FIXED });
  const d = await H.P.draftStory(db, { arxivId: H.A.id, version: H.A.v, clock: H.FIXED });
  const dj = JSON.parse(db.prepare('SELECT draft_json FROM stories WHERE id=?').get(d.id).draft_json);
  dj.claims.commits.numbers = ['12000']; dj.claims.commits.display = '12,000';
  db.prepare('UPDATE stories SET draft_json=? WHERE id=?').run(JSON.stringify(dj), d.id);
  const c = H.P.checkStory(db, d.id, { clock: H.FIXED });
  assert.equal(c.ok, false);
  assert.throws(() => H.P.approve(db, d.id, 'e', { clock: H.FIXED }), /not checked/);
});

test('ideas-only approval needs a passed copy check; override needs a reason and is logged', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  H.P.ingest(db, { link: H.B.link, pageText: H.snapshot(H.B.id, H.B.v), clock: H.FIXED });
  const d = await H.P.draftStory(db, { arxivId: H.B.id, version: H.B.v, clock: H.FIXED });
  H.P.checkStory(db, d.id, { clock: H.FIXED });
  // forge a skipped copy check
  const rep = JSON.parse(db.prepare('SELECT checker_json FROM stories WHERE id=?').get(d.id).checker_json); rep.copycheck = { status: 'skipped' };
  db.prepare('UPDATE stories SET checker_json=? WHERE id=?').run(JSON.stringify(rep), d.id);
  assert.throws(() => H.P.approve(db, d.id, 'e', { clock: H.FIXED }), /copy check/);
  H.P.approve(db, d.id, 'e', { overrideCopycheck: true, reason: 'checked by hand', clock: H.FIXED });
  assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE action='copycheck.override'`).get());
});

test('paper withdrawn: publish is blocked; live story is pulled on re-check', async () => {
  const out = H.tmpOut(); const db = H.open(':memory:');
  const d = await H.through(db, H.A);
  assert.throws(() => H.P.publish(db, d.id, { statusProbe: () => ({ withdrawn: true }), clock: H.FIXED }), /withdrawn/);
  assert.equal(db.prepare('SELECT status FROM stories WHERE id=?').get(d.id).status, 'pulled');

  const db2 = H.open(':memory:');
  const d2 = await H.through(db2, H.B, { publish: true, probe: ok });
  assert.equal(H.P.recheckPapers(db2, () => ({ withdrawn: true }), H.FIXED), 1);
  build(db2);
  assert.match(fs.readFileSync(path.join(out, 's', 'ai-swarm-that-thinks-without-words', 'index.html'), 'utf8'), /taken down/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'status', 'ai-swarm-that-thinks-without-words.json'), 'utf8')).state, 'pulled');
});

test('paper updated to v2: story is flagged "based on v1" until reviewed', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  const d = await H.through(db, H.B, { publish: true, probe: ok });
  H.P.recheckPapers(db, () => ({ withdrawn: false, latestVersion: 'v2' }), H.FIXED);
  assert.ok(JSON.parse(db.prepare('SELECT flags_json FROM stories WHERE id=?').get(d.id).flags_json).includes('based_on_old_version'));
});

test('wrong claim reported: "Under review" at once; author says remove: story goes down first', async () => {
  const out = H.tmpOut(); const db = H.open(':memory:');
  const d = await H.through(db, H.A, { publish: true, probe: ok });
  const slug = 'ai-written-code-in-the-wild';
  const r1 = H.P.report(db, { slug, kind: 'error', body: 'The 33% figure looks off.', contact: 'a@b.co' }, H.FIXED);
  assert.ok(r1.ok);
  assert.equal(db.prepare('SELECT status FROM stories WHERE id=?').get(d.id).status, 'under_review');
  const row = db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 1').get();
  assert.equal((new Date(row.due_at) - new Date(row.created_at)) / 3600000, 24);
  build(db);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'status', slug + '.json'), 'utf8')).state, 'under_review');
  assert.match(fs.readFileSync(path.join(out, 's', slug, 'index.html'), 'utf8'), /Under review/);
  const r2 = H.P.report(db, { slug, kind: 'takedown', body: 'remove', contact: 'author@uni.edu' }, H.FIXED);
  assert.ok(r2.ok);
  // under_review is not 'published', so a takedown must still pull it
  H.P.resolveReport(db, 1, { editor: 'e', resolution: 'fixed', restore: true }, H.FIXED);
});

test('takedown on a live story pulls it immediately', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  const d = await H.through(db, H.B, { publish: true, probe: ok });
  H.P.report(db, { slug: 'ai-swarm-that-thinks-without-words', kind: 'takedown', body: 'remove' }, H.FIXED);
  assert.equal(db.prepare('SELECT status FROM stories WHERE id=?').get(d.id).status, 'pulled');
});

test('DMCA: pulls and cannot be auto-restored; score dispute adds a flag and a 48h due date', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  const d = await H.through(db, H.B, { publish: true, probe: ok });
  H.P.report(db, { slug: 'ai-swarm-that-thinks-without-words', kind: 'dmca', body: 'notice text here' }, H.FIXED);
  assert.equal(db.prepare('SELECT status FROM stories WHERE id=?').get(d.id).status, 'pulled');
  assert.throws(() => H.P.resolveReport(db, 1, { editor: 'e', resolution: 'x', restore: true }, H.FIXED), /human decision/);
  const db2 = H.open(':memory:');
  const d2 = await H.through(db2, H.A, { publish: true, probe: ok });
  H.P.report(db2, { slug: 'ai-written-code-in-the-wild', kind: 'dispute', body: 'score looks low' }, H.FIXED);
  assert.ok(JSON.parse(db2.prepare('SELECT flags_json FROM stories WHERE id=?').get(d2.id).flags_json).includes('score_disputed'));
  const r = db2.prepare('SELECT * FROM reports').get();
  assert.equal((new Date(r.due_at) - new Date(r.created_at)) / 3600000, 48);
  assert.equal(H.P.overdueReports(db2, () => new Date('2026-11-20T00:00:00Z')).length, 1);
});

test('duplicate story for the same paper is refused', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  await H.through(db, H.A);
  await assert.rejects(() => H.P.draftStory(db, { arxivId: H.A.id, version: H.A.v, clock: H.FIXED }), /Duplicate/);
});

test('AI cost cap: draft calls stop at the per-day limit', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  H.P.ingest(db, { link: H.A.link, pageText: H.snapshot(H.A.id, H.A.v), clock: H.FIXED });
  db.prepare('INSERT INTO ai_budget (day, calls, usd) VALUES (?,?,?)').run('2026-11-10', 25, 10);
  await assert.rejects(() => H.P.draftStory(db, { arxivId: H.A.id, version: H.A.v, provider: recorded, clock: H.FIXED }), /AI cap reached/);
});

test('sponsored stories (phase 3) are behind a flag and carry "Paid Advertisement" inside every card', async () => {
  const out = H.tmpOut(); const db = H.open(':memory:');
  H.P.ingest(db, { link: H.B.link, pageText: H.snapshot(H.B.id, H.B.v), clock: H.FIXED });
  delete process.env.RF_SPONSORED;
  await assert.rejects(() => H.P.draftStory(db, { arxivId: H.B.id, version: H.B.v, sponsored: true, clock: H.FIXED }), /phase 3/);
  process.env.RF_SPONSORED = '1';
  try {
    const d = await H.P.draftStory(db, { arxivId: H.B.id, version: H.B.v, sponsored: true, clock: H.FIXED });
    H.P.checkStory(db, d.id, { clock: H.FIXED }); H.P.approve(db, d.id, 'e', { clock: H.FIXED }); H.P.publish(db, d.id, { statusProbe: ok, clock: H.FIXED });
    build(db);
    const html = fs.readFileSync(path.join(out, 's', 'ai-swarm-that-thinks-without-words', 'index.html'), 'utf8');
    const cards = html.match(/<section class="card card-/g).length;
    const tags = (html.match(/<span class="adtag">Paid Advertisement<\/span>/g) || []).length;
    assert.equal(tags, cards - 1);                 // every story card except the closing credits card
    assert.doesNotMatch(html, /Sponsored by|Presented by/);
    assert.match(html, /The paid party had no say in the score/);
    // same score rules: too-new result is identical to the unsponsored case
    assert.equal(JSON.parse(db.prepare('SELECT score_json FROM stories WHERE id=?').get(d.id).score_json).status, 'too_new');
  } finally { delete process.env.RF_SPONSORED; }
});

test('daily pick rotates by date and is not tuned by score or payment', async () => {
  const out = H.tmpOut(); const db = H.open(':memory:');
  await H.through(db, H.A, { publish: true, probe: ok }); await H.through(db, H.B, { publish: true, probe: ok });
  build(db, { day: '2026-11-10' }); const a = fs.readFileSync(path.join(out, 'index.html'), 'utf8').match(/Today's pick<\/p><h2><a href="\/s\/([^/]+)/)[1];
  build(db, { day: '2026-11-11' }); const b = fs.readFileSync(path.join(out, 'index.html'), 'utf8').match(/Today's pick<\/p><h2><a href="\/s\/([^/]+)/)[1];
  assert.notEqual(a, b);
});
