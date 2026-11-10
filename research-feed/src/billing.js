'use strict';
// BILLING. Sandbox stub that behaves like a merchant of record (Paddle / Lemon Squeezy).
// Real money never moves here. The interface is what a real adapter must match.
// Rules built in:
//   price and renewal date are shown ABOVE the pay button (terms()).
//   consent to auto-renewal is an UNTICKED box; signup fails without it.
//   cancel is one call (cancel()), same place as sign-up.
//   a reminder email goes out 7 days before an ANNUAL renewal.
//   consent records are kept with the exact words shown.
// NOT LEGAL ADVICE. Wording goes to the lawyer review.
const crypto = require('node:crypto');
const { sha256, audit } = require('./db');

const PLANS = {
  monthly: { price_cents: 900, days: 30, label: '$9 per month' },
  annual: { price_cents: 7900, days: 365, label: '$79 per year' },
};
// Assumed merchant-of-record fee: 5% + $0.50 per charge. Test: compare with the real quote from Paddle or Lemon Squeezy.
const FEE_PCT = 0.05;
const FEE_FIXED_CENTS = 50;
const netCents = (priceCents) => Math.round(priceCents - (priceCents * FEE_PCT + FEE_FIXED_CENTS));

const EU = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);
const BLOCK_EU = () => process.env.RF_BLOCK_EU === '1'; // option: block EU sign-ups for the first 6 months

const DAY = 86400000;
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);

// The words the buyer sees above the pay button. Stored verbatim as the consent record.
function terms(plan, now = new Date()) {
  const p = PLANS[plan];
  if (!p) throw new Error('unknown plan');
  const renews = addDays(now, p.days).toISOString().slice(0, 10);
  return {
    plan, price_cents: p.price_cents, renews_at: renews,
    price_line: `You will be charged ${p.label} (USD, before any local tax). First charge today. Next charge on ${renews} unless you cancel.`,
    consent_text: `I agree that my subscription renews automatically at ${p.label} until I cancel. I can cancel in one click, in this same place.`,
    age_text: 'I am 18 or older.',
    cancel_line: 'Cancel any time in one click on this page. No call, no email.',
    net_cents_after_fee: netCents(p.price_cents),
  };
}

function signup(db, { name, email, plan, consent_auto_renew, age_18, country }, now = new Date()) {
  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Name and a valid email are required.' };
  if (!PLANS[plan]) return { ok: false, error: 'Pick monthly or annual.' };
  if (age_18 !== true) return { ok: false, error: 'You must confirm you are 18 or older.' };
  if (consent_auto_renew !== true) return { ok: false, error: 'Tick the box to agree to automatic renewal. It is off by default.' };
  if (BLOCK_EU() && country && EU.has(String(country).toUpperCase())) return { ok: false, error: 'Pro sign-ups are not open in your region yet.' };
  const t = terms(plan, now);
  const token = crypto.randomBytes(24).toString('hex');
  const existing = db.prepare('SELECT id FROM users WHERE email=? AND deleted_at IS NULL').get(email.toLowerCase());
  if (existing) return { ok: false, error: 'This email already has an account.' };
  const u = db.prepare('INSERT INTO users (name,email,age_18_confirmed,token_hash,created_at) VALUES (?,?,?,?,?)')
    .run(name.trim(), email.toLowerCase(), 1, sha256(token), now.toISOString());
  const userId = Number(u.lastInsertRowid);
  const ref = 'sbx_' + crypto.randomBytes(6).toString('hex'); // id at the merchant of record
  db.prepare(`INSERT INTO subscriptions (user_id,plan,price_cents,status,started_at,renews_at,merchant_ref) VALUES (?,?,?,?,?,?,?)`)
    .run(userId, plan, t.price_cents, 'active', now.toISOString(), t.renews_at, ref);
  const userRef = sha256(email.toLowerCase()).slice(0, 16);
  const ins = db.prepare('INSERT INTO consents (user_ref,kind,text_shown,price_cents,renews_at,given_at) VALUES (?,?,?,?,?,?)');
  ins.run(userRef, 'auto_renewal', t.price_line + ' ' + t.consent_text, t.price_cents, t.renews_at, now.toISOString());
  ins.run(userRef, 'age_18', t.age_text, null, null, now.toISOString());
  audit(db, `user:${userId}`, 'pro.signup', plan, { ref }, () => now);
  return { ok: true, token, user_id: userId, terms: t, merchant_ref: ref };
}

// One click. Access stays until the paid period ends; no further charge.
function cancel(db, userId, now = new Date()) {
  const s = db.prepare(`SELECT id FROM subscriptions WHERE user_id=? AND status='active'`).get(userId);
  if (!s) return { ok: false, error: 'No active subscription.' };
  db.prepare(`UPDATE subscriptions SET status='cancelled', cancelled_at=? WHERE id=?`).run(now.toISOString(), s.id);
  audit(db, `user:${userId}`, 'pro.cancel', String(s.id), '', () => now);
  return { ok: true };
}

function isPro(db, userId, now = new Date()) {
  const s = db.prepare(`SELECT status, renews_at FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1`).get(userId);
  if (!s) return false;
  return s.status === 'active' || new Date(s.renews_at) > now; // cancelled users keep access to the end of the paid period
}

// Job: annual plans get a reminder 7 days before renewal.
function sendRenewalReminders(db, now = new Date()) {
  const subs = db.prepare(
    `SELECT s.id, s.renews_at, s.price_cents, u.email, u.name FROM subscriptions s JOIN users u ON u.id=s.user_id
     WHERE s.plan='annual' AND s.status='active' AND s.renewal_reminder_sent=0 AND u.deleted_at IS NULL`,
  ).all();
  let sent = 0;
  for (const s of subs) {
    const days = (new Date(s.renews_at) - now) / DAY;
    if (days <= 7 && days > 0) {
      db.prepare(`INSERT INTO outbox (to_ref,subject,body,kind,created_at) VALUES (?,?,?,?,?)`).run(
        s.email, 'Your Research Feed Pro plan renews in 7 days',
        `Hi ${s.name},\n\nYour annual plan renews on ${s.renews_at.slice(0, 10)} at $${(s.price_cents / 100).toFixed(2)}.\nTo stop it, open Pro in the app and press Cancel. One click.\n`,
        'renewal_reminder', now.toISOString());
      db.prepare('UPDATE subscriptions SET renewal_reminder_sent=1 WHERE id=?').run(s.id);
      sent++;
    }
  }
  return sent;
}

// Delete-my-account. Consent records stay (hashed ref only); personal data goes.
function deleteAccount(db, userId, now = new Date()) {
  db.prepare(`UPDATE subscriptions SET status='cancelled', cancelled_at=COALESCE(cancelled_at,?) WHERE user_id=?`).run(now.toISOString(), userId);
  db.prepare('DELETE FROM follows WHERE user_id=?').run(userId);
  db.prepare('DELETE FROM saves WHERE user_id=?').run(userId);
  db.prepare('DELETE FROM alerts WHERE user_id=?').run(userId);
  db.prepare(`UPDATE users SET name='deleted', email='deleted-'||id||'@invalid', token_hash='', deleted_at=? WHERE id=?`).run(now.toISOString(), userId);
  audit(db, `user:${userId}`, 'account.delete', String(userId), '', () => now);
  return { ok: true };
}

module.exports = { PLANS, terms, signup, cancel, isPro, sendRenewalReminders, deleteAccount, netCents, EU };
