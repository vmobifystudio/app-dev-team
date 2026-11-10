'use strict';
// HTTP server (node:http, no dependencies). Serves the static site and a small JSON API.
// Readers need no login. Pro users hold a bearer token. Editors hold the admin token.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, sha256, audit, ROOT } = require('./db');
const Billing = require('./billing');
const Alerts = require('./alerts');
const P = require('./pipeline');
const { build } = require('./site');
const { fileProbe } = require('./probe');
const { csvCell, limiter } = require('./guard');
const { POLICY } = require('./license');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml' };

function createApp({ db, outDir, adminToken, clock, probe } = {}) {
  db = db || open();
  outDir = outDir || process.env.RF_OUT_DIR || path.join(ROOT, 'public');
  adminToken = adminToken || process.env.RF_ADMIN_TOKEN || crypto.randomBytes(12).toString('hex');
  probe = probe || fileProbe();
  const now = () => (clock ? clock() : new Date());
  const rl = limiter(30);
  const rebuild = () => build(db, { day: now().toISOString().slice(0, 10) });

  const send = (res, code, obj, headers = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    res.end(JSON.stringify(obj));
  };
  const body = (req) => new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 65536) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('bad json')); } });
  });
  const userFrom = (req) => {
    const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) return null;
    const u = db.prepare('SELECT * FROM users WHERE token_hash=? AND deleted_at IS NULL').get(sha256(m[1]));
    return u || null;
  };
  const isAdmin = (req) => {
    const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
    return !!m && m[1].length === adminToken.length && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(adminToken));
  };

  async function api(req, res, url) {
    const p = url.pathname;
    const ip = req.socket.remoteAddress || 'x';
    // ---------- public ----------
    if (p === '/api/pro/terms' && req.method === 'GET') {
      try { return send(res, 200, Billing.terms(url.searchParams.get('plan') || 'monthly', now())); } catch { return send(res, 400, { error: 'unknown plan' }); }
    }
    if (p === '/api/pro/signup' && req.method === 'POST') {
      if (!rl('signup:' + ip)) return send(res, 429, { error: 'Too many tries. Wait a minute.' });
      const b = await body(req);
      const country = req.headers['cf-ipcountry'] || b.country;
      const r = Billing.signup(db, { ...b, country }, now());
      return send(res, r.ok ? 200 : 400, r);
    }
    if (p === '/api/report' && req.method === 'POST') {
      if (!rl('report:' + ip)) return send(res, 429, { ok: false, error: 'Too many reports. Wait a minute.' });
      const b = await body(req);
      const r = P.report(db, b, clock);
      if (r.ok) rebuild();
      return send(res, r.ok ? 200 : 400, r);
    }
    if (p === '/api/stories' && req.method === 'GET') {
      const q = url.searchParams;
      const proFilters = ['min', 'license', 'since', 'institution'].some((k) => q.get(k));
      const u = userFrom(req);
      if (proFilters && !(u && Billing.isPro(db, u.id, now()))) return send(res, 402, { error: 'Score, license, date and institution filters are part of Pro. Field browsing is free.', pro_filters: true });
      const feed = JSON.parse(fs.readFileSync(path.join(outDir, 'feed.json'), 'utf8'));
      let out = feed;
      if (q.get('field')) out = out.filter((s) => s.field === q.get('field'));
      if (q.get('min')) out = out.filter((s) => (s.score ?? -1) >= Number(q.get('min')));
      if (q.get('license')) out = out.filter((s) => s.license === q.get('license'));
      if (q.get('since')) out = out.filter((s) => s.published_at.slice(0, 10) >= q.get('since'));
      return send(res, 200, { stories: out });
    }
    // ---------- Pro user ----------
    const u = userFrom(req);
    if (['/api/me', '/api/follow', '/api/unfollow', '/api/saves', '/api/lists.csv', '/api/pro/cancel', '/api/account/delete'].includes(p)) {
      if (p === '/api/follow' && !u) return send(res, 200, { ok: false, pro_prompt: true }); // the one place the Pro prompt shows
      if (!u) return send(res, 401, { ok: false, error: 'Sign in with Pro.' });
      const pro = Billing.isPro(db, u.id, now());
      if (p === '/api/me') {
        const s = db.prepare('SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(u.id);
        return send(res, 200, { ok: true, name: u.name, pro, plan: s?.plan, status: s?.status, renews_at: s?.renews_at || '', follows: db.prepare('SELECT field FROM follows WHERE user_id=?').all(u.id).map((x) => x.field) });
      }
      if (p === '/api/follow') {
        if (!pro) return send(res, 200, { ok: false, pro_prompt: true });
        const b = await body(req);
        db.prepare('INSERT OR IGNORE INTO follows (user_id,field,created_at) VALUES (?,?,?)').run(u.id, String(b.field), now().toISOString());
        return send(res, 200, { ok: true });
      }
      if (p === '/api/unfollow') { const b = await body(req); db.prepare('DELETE FROM follows WHERE user_id=? AND field=?').run(u.id, String(b.field)); return send(res, 200, { ok: true }); }
      if (p === '/api/pro/cancel') return send(res, 200, Billing.cancel(db, u.id, now()));
      if (p === '/api/account/delete') return send(res, 200, Billing.deleteAccount(db, u.id, now()));
      if (!pro) return send(res, 402, { ok: false, error: 'Pro required.' });
      if (p === '/api/saves' && req.method === 'POST') {
        const b = await body(req);
        const st = db.prepare(`SELECT 1 FROM stories WHERE slug=? AND status='published'`).get(String(b.slug));
        if (!st) return send(res, 404, { ok: false, error: 'No such story.' });
        db.prepare('INSERT OR IGNORE INTO saves (user_id,slug,list_name,created_at) VALUES (?,?,?,?)').run(u.id, String(b.slug), String(b.list || 'Saved').slice(0, 40), now().toISOString());
        return send(res, 200, { ok: true });
      }
      if (p === '/api/saves') return send(res, 200, { saves: db.prepare('SELECT slug, list_name FROM saves WHERE user_id=?').all(u.id) });
      if (p === '/api/lists.csv') {
        const rows = db.prepare(`SELECT sv.list_name, st.slug, st.draft_json, st.arxiv_id, st.based_on_version, st.score_json FROM saves sv JOIN stories st ON st.slug=sv.slug WHERE sv.user_id=?`).all(u.id);
        const lines = ['list,title,score,paper,paper_link,story_link'];
        for (const r of rows) {
          const sc = r.score_json ? JSON.parse(r.score_json) : null;
          lines.push([r.list_name, JSON.parse(r.draft_json).title, sc && sc.status === 'scored' ? sc.score : 'too new', `arXiv:${r.arxiv_id}${r.based_on_version}`, `https://arxiv.org/abs/${r.arxiv_id}${r.based_on_version}`, `/s/${r.slug}/`].map(csvCell).join(','));
        }
        res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="research-feed-saves.csv"' });
        return res.end(lines.join('\n') + '\n');
      }
    }
    // ---------- editor ----------
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'Editor token required.' });
      const b = req.method === 'POST' ? await body(req) : {};
      if (p === '/api/admin/stories') {
        const rows = db.prepare('SELECT id,slug,arxiv_id,based_on_version,status,field,flags_json,checker_json,score_json,cut_log_json,approved_by FROM stories ORDER BY id').all();
        return send(res, 200, { stories: rows.map((r) => {
          const c = r.checker_json ? JSON.parse(r.checker_json) : null; const sc = r.score_json ? JSON.parse(r.score_json) : null;
          return { id: r.id, slug: r.slug, paper: `arXiv:${r.arxiv_id}${r.based_on_version}`, status: r.status, field: r.field, flags: JSON.parse(r.flags_json), cut: JSON.parse(r.cut_log_json).length,
            checker: c && { ok: c.ok, errors: c.errors, warnings: c.warnings, claims: c.claim_count, copycheck: c.copycheck.status }, score: sc && (sc.score ?? sc.headline), approved_by: r.approved_by };
        }) });
      }
      if (p === '/api/admin/approve') { try { return send(res, 200, P.approve(db, b.id, b.editor, { overrideCopycheck: b.override, reason: b.reason, clock })); } catch (e) { return send(res, 400, { error: e.message }); } }
      if (p === '/api/admin/publish') { try { const r = P.publish(db, b.id, { statusProbe: probe, clock }); rebuild(); return send(res, 200, r); } catch (e) { rebuild(); return send(res, 400, { error: e.message }); } }
      if (p === '/api/admin/pull') {
        const s = db.prepare('SELECT * FROM stories WHERE id=?').get(b.id);
        db.prepare(`UPDATE stories SET status='pulled' WHERE id=?`).run(b.id); audit(db, 'editor', 'story.pull', s.slug, b.reason || '', clock); rebuild(); return send(res, 200, { ok: true });
      }
      if (p === '/api/admin/reports') return send(res, 200, { reports: db.prepare('SELECT r.*, s.slug FROM reports r JOIN stories s ON s.id=r.story_id ORDER BY r.id DESC').all(), overdue: P.overdueReports(db, clock) });
      if (p === '/api/admin/resolve') { try { P.resolveReport(db, b.report_id, { editor: b.editor || 'editor', resolution: b.resolution || '', restore: !!b.restore }, clock); rebuild(); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); } }
      if (p === '/api/admin/recheck') { const n = P.recheckPapers(db, probe, clock); rebuild(); return send(res, 200, { pulled: n }); }
      if (p === '/api/admin/jobs') { const a = Alerts.deliver(db, now(), ''); const r = Billing.sendRenewalReminders(db, now()); return send(res, 200, { alerts: a, renewal_reminders: r }); }
      if (p === '/api/admin/outbox') return send(res, 200, { outbox: db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 50').all() });
      if (p === '/api/admin/licenselog') return send(res, 200, { log: db.prepare('SELECT * FROM license_log ORDER BY id DESC').all(), assets: db.prepare('SELECT * FROM asset_log ORDER BY id').all() });
      return send(res, 404, { error: 'not found' });
    }
    return send(res, 404, { error: 'not found' });
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    let file = path.normalize(path.join(outDir, rel));
    if (!file.startsWith(outDir)) { res.writeHead(403); return res.end('forbidden'); }
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { /* fall through */ }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
      const isStatus = rel.startsWith('/status/');
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': isStatus ? 'no-store' : 'public, max-age=60',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
        'x-rf-ai-assisted': file.includes(`${path.sep}s${path.sep}`) ? 'true' : 'n/a',
      });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) {
      send(res, 500, { error: process.env.NODE_ENV === 'production' ? 'server error' : e.message });
    }
  });
  return { server, db, adminToken, rebuild };
}

module.exports = { createApp };
