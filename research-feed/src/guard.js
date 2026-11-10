'use strict';
// Content rails. Pure text checks. A hit blocks publishing and goes to a human.
// NOT LEGAL ADVICE. Word lists are a first pass for the lawyer review.

// Securities rail: we host research, never offers.
const SECURITIES = [
  /\binvest(?:s|ed|ing|ment|ments|or|ors)?\b/i,
  /\bvaluation\b/i,
  /\bjoin our round\b/i,
  /\b(?:seed|pre-seed|series\s+[a-d])\s+(?:round|raise|funding)\b/i,
  /\bround size\b/i,
  /\bterm sheet\b/i,
  /\braising\s+\$?\d/i,
  /\bguaranteed (?:returns?|profit)/i,
  /\bequity (?:stake|offer|offering)\b/i,
];
// Allowed exact phrase from the score label.
const ALLOWED = [/not investment advice/gi];

// Weapons and biothreat: flag for human review, never auto-publish.
const SENSITIVE = [
  /\b(?:synthesi[sz]e|culture|enhance)\b[^.]{0,40}\b(?:pathogen|toxin|nerve agent)\b/i,
  /\bnerve agent\b/i,
  /\bweaponi[sz]e\b/i,
  /\bexplosive (?:synthesis|formula)\b/i,
];

const FAKE_SOCIAL_PROOF = [/\btestimonial\b/i, /\bas seen in\b/i, /\b\d+% return\b/i];

function scan(text) {
  let t = String(text || '');
  for (const a of ALLOWED) t = t.replace(a, ' ');
  const hits = [];
  for (const re of SECURITIES) { const m = t.match(re); if (m) hits.push({ rail: 'securities', match: m[0] }); }
  for (const re of SENSITIVE) { const m = t.match(re); if (m) hits.push({ rail: 'sensitive', match: m[0] }); }
  for (const re of FAKE_SOCIAL_PROOF) { const m = t.match(re); if (m) hits.push({ rail: 'social_proof', match: m[0] }); }
  return hits;
}

// Creator-submitted stories need all three honesty tags (phase 3, behind a flag).
function creatorTagsOk(tags) {
  const need = ['I am the author', 'I am the founder', 'I hold equity'];
  return need.every((k) => tags && Object.prototype.hasOwnProperty.call(tags, k));
}

// CSV cells that start with = + - @ can run as formulas in a spreadsheet. Neutralise them.
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Tiny in-memory rate limiter (per key, per minute). Production: Redis or the CDN.
function limiter(maxPerMin) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const win = Math.floor(now / 60000);
    const k = `${key}:${win}`;
    const n = (hits.get(k) || 0) + 1;
    hits.set(k, n);
    if (hits.size > 5000) for (const x of hits.keys()) if (!x.endsWith(`:${win}`)) hits.delete(x);
    return n <= maxPerMin;
  };
}

module.exports = { scan, creatorTagsOk, csvCell, limiter };
