'use strict';
// SITE BUILD. Turns the database into static files in public/. Run after every state change.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./db');
const R = require('./render');
const { loadMeta } = require('./pipeline');
const { POLICY } = require('./license');

const outDir = () => process.env.RF_OUT_DIR || path.join(ROOT, 'public');

function write(rel, content) {
  const f = path.join(outDir(), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

function hydrate(db, row) {
  const meta = { ...loadMeta(row.arxiv_id, row.based_on_version) };
  const pv = db.prepare('SELECT * FROM paper_versions WHERE arxiv_id=? AND version=?').get(row.arxiv_id, row.based_on_version);
  meta.license_code = pv.license_code; meta.license_url = pv.license_url; meta.license_label = POLICY[pv.license_code].label;
  return {
    ...row, draft: JSON.parse(row.draft_json), meta, tier: pv.tier,
    score: row.score_json ? JSON.parse(row.score_json) : null, flags: JSON.parse(row.flags_json), latest_version: pv.latest_version,
  };
}

function dailyPick(stories, day) {
  if (!stories.length) return null;
  const n = Math.floor(new Date(day + 'T00:00:00Z').getTime() / 86400000);
  return stories[n % stories.length]; // rotation by date. Not for sale, not tuned by score.
}

function build(db, { day = new Date().toISOString().slice(0, 10) } = {}) {
  const OUT = outDir();
  fs.rmSync(path.join(OUT, 's'), { recursive: true, force: true });
  fs.rmSync(path.join(OUT, 'status'), { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.cpSync(path.join(ROOT, 'web'), OUT, { recursive: true });
  const rows = db.prepare(`SELECT * FROM stories WHERE status IN ('published','under_review','pulled') ORDER BY published_at DESC`).all();
  const all = rows.map((r) => hydrate(db, r));
  const live = all.filter((s) => s.status !== 'pulled');
  for (const s of all) {
    if (s.status === 'pulled') write(`s/${s.slug}/index.html`, R.tombstone(s.slug, s.draft.title, 'pulled'));
    else write(`s/${s.slug}/index.html`, R.storyPage(s));
    write(`status/${s.slug}.json`, JSON.stringify({ slug: s.slug, state: s.status, reason: s.status === 'pulled' ? 'Taken down after a report or because the paper changed.' : '' }));
  }
  const feed = live.filter((s) => s.status === 'published');
  write('index.html', R.feedPage(feed, dailyPick(feed, day)));
  const scoreOf = (s) => (s.score && s.score.status === 'scored' ? s.score.score : -1);
  const top = [...feed].sort((a, b) => scoreOf(b) - scoreOf(a) || b.published_at.localeCompare(a.published_at)).slice(0, 5);
  write('digest/index.html', R.digestPage(top));
  write('feed.json', JSON.stringify(feed.map((s) => ({ slug: s.slug, title: s.draft.title, field: s.field, published_at: s.published_at, score: s.score && s.score.score, score_status: s.score && s.score.status, license: s.meta.license_code }))));
  write('robots.txt', 'User-agent: *\nAllow: /\nSitemap: ' + R.SITE + '/sitemap.xml\n');
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${R.SITE}/</loc></url>${feed.map((s) => `<url><loc>${R.SITE}/s/${s.slug}/</loc><lastmod>${s.published_at.slice(0, 10)}</lastmod></url>`).join('')}</urlset>`);
  return { stories: feed.length, pulled: all.filter((s) => s.status === 'pulled').length, under_review: all.filter((s) => s.status === 'under_review').length };
}

module.exports = { build, hydrate, outDir };
