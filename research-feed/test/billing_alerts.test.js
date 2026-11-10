'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const B = require('../src/billing');
const Alerts = require('../src/alerts');

const NOW = new Date('2026-11-10T12:00:00Z');
const good = { name: 'Ada', email: 'ada@example.com', plan: 'monthly', consent_auto_renew: true, age_18: true };

test('price and renewal date are shown before payment; consent box is required and starts unticked', () => {
  const t = B.terms('monthly', NOW);
  assert.match(t.price_line, /\$9 per month/);
  assert.match(t.price_line, /2026-12-10/);
  assert.match(B.terms('annual', NOW).price_line, /\$79 per year.*2027-11-10/);
  const db = H.open(':memory:');
  assert.match(B.signup(db, { ...good, consent_auto_renew: undefined }, NOW).error, /box/);
  assert.match(B.signup(db, { ...good, consent_auto_renew: false }, NOW).error, /box/);
  assert.match(B.signup(db, { ...good, age_18: false }, NOW).error, /18/);
});

test('consent record keeps the exact words, price and renewal date', () => {
  const db = H.open(':memory:');
  const r = B.signup(db, good, NOW); assert.ok(r.ok);
  const c = db.prepare(`SELECT * FROM consents WHERE kind='auto_renewal'`).get();
  assert.match(c.text_shown, /charged \$9 per month/); assert.equal(c.price_cents, 900); assert.equal(c.renews_at, '2026-12-10');
});

test('net per Pro user after the assumed fee: $8.05 vs $9 list', () => {
  assert.equal(B.netCents(900), 805);
});

test('cancel is one call; access lasts to the end of the paid period', () => {
  const db = H.open(':memory:');
  const r = B.signup(db, good, NOW);
  assert.equal(B.cancel(db, r.user_id, NOW).ok, true);
  assert.equal(B.isPro(db, r.user_id, new Date('2026-11-20T00:00:00Z')), true);
  assert.equal(B.isPro(db, r.user_id, new Date('2026-12-20T00:00:00Z')), false);
});

test('annual plan: reminder email 7 days before renewal, once', () => {
  const db = H.open(':memory:');
  B.signup(db, { ...good, plan: 'annual' }, NOW);
  assert.equal(B.sendRenewalReminders(db, new Date('2027-06-01T00:00:00Z')), 0);
  assert.equal(B.sendRenewalReminders(db, new Date('2027-11-04T00:00:00Z')), 1);
  assert.equal(B.sendRenewalReminders(db, new Date('2027-11-05T00:00:00Z')), 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM outbox WHERE kind='renewal_reminder'`).get().n, 1);
});

test('delete my account erases personal data and keeps only hashed consent records', () => {
  const db = H.open(':memory:');
  const r = B.signup(db, good, NOW);
  db.prepare(`INSERT INTO follows VALUES (?,?,?)`).run(r.user_id, 'AI & software', NOW.toISOString());
  B.deleteAccount(db, r.user_id, NOW);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(r.user_id);
  assert.equal(u.name, 'deleted'); assert.ok(!u.email.includes('ada'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM follows').get().n, 0);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM consents').all()).includes('ada@example.com'));
});

test('EU sign-up block option', () => {
  const db = H.open(':memory:');
  process.env.RF_BLOCK_EU = '1';
  try { assert.match(B.signup(db, { ...good, country: 'DE' }, NOW).error, /region/); assert.ok(B.signup(db, { ...good, country: 'IN' }, NOW).ok); }
  finally { delete process.env.RF_BLOCK_EU; }
});

test('alerts: a Pro follower gets an alert within 1 hour of publishing; free users and cancelled-and-expired users do not', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  const pro = B.signup(db, good, NOW);
  const lapsed = B.signup(db, { ...good, email: 'old@example.com' }, new Date('2025-01-01T00:00:00Z'));
  B.cancel(db, lapsed.user_id, new Date('2025-01-02T00:00:00Z'));
  for (const u of [pro, lapsed]) db.prepare('INSERT INTO follows VALUES (?,?,?)').run(u.user_id, 'AI & software', NOW.toISOString());
  const d = await H.through(db, H.A, { publish: true, probe: () => ({ withdrawn: false }) });
  const q = db.prepare('SELECT * FROM alerts').all();
  assert.equal(q.length, 1);
  assert.equal((new Date(q[0].due_by) - new Date(q[0].queued_at)) / 60000, 60);
  const r = Alerts.deliver(db, new Date('2026-11-10T12:30:00Z'), 'https://x.test');
  assert.deepEqual(r, { sent: 1, late: 0 });
  const mail = db.prepare(`SELECT * FROM outbox WHERE kind='field_alert'`).get();
  assert.equal(mail.to_ref, 'ada@example.com'); assert.match(mail.body, /\/s\/ai-written-code-in-the-wild\//);
});

test('alerts: never sent for a story that was pulled before delivery', async () => {
  H.tmpOut(); const db = H.open(':memory:');
  const pro = B.signup(db, good, NOW);
  db.prepare('INSERT INTO follows VALUES (?,?,?)').run(pro.user_id, 'AI agents', NOW.toISOString());
  const d = await H.through(db, H.B, { publish: true, probe: () => ({ withdrawn: false }) });
  db.prepare(`UPDATE stories SET status='pulled' WHERE id=?`).run(d.id);
  assert.equal(Alerts.deliver(db, NOW).sent, 0);
});
