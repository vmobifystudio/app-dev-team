'use strict';
// SQLite via node:sqlite (built in, no install). Same SQL ports to Postgres.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowIso = (clock) => (clock ? clock() : new Date()).toISOString();

function open(file = path.join(ROOT, 'db', 'feed.sqlite')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
  return db;
}

function audit(db, actor, action, subject, detail = '', clock) {
  db.prepare('INSERT INTO audit_log (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').run(
    nowIso(clock), actor, action, subject, typeof detail === 'string' ? detail : JSON.stringify(detail),
  );
}

module.exports = { open, audit, sha256, nowIso, ROOT };
