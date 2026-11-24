'use strict';
// ALERTS. Pro users who follow a field get an alert within about 1 hour of publishing (assumption).
// Test the assumption: measure p95 of (sent_at - published_at) in the first month.
const { isPro } = require('./billing');

const SLA_MS = 60 * 60 * 1000;

function queueForStory(db, story, now = new Date()) {
  const followers = db.prepare(`SELECT f.user_id FROM follows f JOIN users u ON u.id=f.user_id WHERE f.field=? AND u.deleted_at IS NULL`).all(story.field);
  let n = 0;
  for (const f of followers) {
    if (!isPro(db, f.user_id, now)) continue;
    db.prepare(`INSERT INTO alerts (user_id,story_id,field,queued_at,due_by) VALUES (?,?,?,?,?)`)
      .run(f.user_id, story.id, story.field, now.toISOString(), new Date(now.getTime() + SLA_MS).toISOString());
    n++;
  }
  return n;
}

// Worker: run every minute. Sends anything unsent. Reports anything late.
function deliver(db, now = new Date(), baseUrl = '') {
  const due = db.prepare(
    `SELECT a.id, a.due_by, a.queued_at, u.email, u.name, s.slug, s.field, s.status, s.draft_json
       FROM alerts a JOIN users u ON u.id=a.user_id JOIN stories s ON s.id=a.story_id WHERE a.sent_at IS NULL`,
  ).all();
  let sent = 0, late = 0;
  for (const a of due) {
    if (a.status !== 'published') continue; // never alert on a story that was pulled or is under review
    const title = JSON.parse(a.draft_json).title;
    db.prepare(`INSERT INTO outbox (to_ref,subject,body,kind,created_at) VALUES (?,?,?,?,?)`).run(
      a.email, `New in ${a.field}: ${title}`,
      `Hi ${a.name},\n\nA new story in ${a.field} just went live:\n${title}\n${baseUrl}/s/${a.slug}/\n\nYou get this because you follow ${a.field}. Unfollow any time in the app.\n`,
      'field_alert', now.toISOString());
    db.prepare('UPDATE alerts SET sent_at=? WHERE id=?').run(now.toISOString(), a.id);
    sent++;
    if (now > new Date(a.due_by)) late++;
  }
  return { sent, late };
}

module.exports = { queueForStory, deliver, SLA_MS };
