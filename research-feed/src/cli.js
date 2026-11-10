#!/usr/bin/env node
'use strict';
// CLI. `node src/cli.js demo` runs the whole path for the two demo papers.
const fs = require('node:fs');
const path = require('node:path');
const { open, ROOT } = require('./db');
const P = require('./pipeline');
const { build } = require('./site');
const { fileProbe } = require('./probe');
const { createApp } = require('./server');
const Alerts = require('./alerts');

const DEMO = [
  { link: 'https://arxiv.org/abs/2603.27130v2', note: 'CC BY, full reuse with credit (one short quote)' },
  { link: 'https://arxiv.org/abs/2611.08483v1', note: 'CC BY-NC-ND, ideas only' },
];

// Offline: reads the saved snapshot of the exact version's page. Online: set RF_ONLINE=1 to fetch arXiv.
async function readPage(link) {
  const { arxivId, version } = P.parseArxivLink(link);
  if (process.env.RF_ONLINE === '1') {
    const r = await fetch(`https://arxiv.org/abs/${arxivId}${version || ''}`);
    return r.text();
  }
  const meta = P.loadMeta(arxivId, version || 'v1');
  return fs.readFileSync(path.join(ROOT, meta.abs_snapshot), 'utf8');
}

// Source text, if this machine has it. The repo never stores paper text.
function sourceTextFor(arxivId, version) {
  const dir = process.env.RF_SOURCE_TEXT_DIR;
  if (!dir) return undefined;
  const f = path.join(dir, `${arxivId}${version}.md`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined;
}

async function runPipeline(db, link, { editor = 'demo-editor', publish = true } = {}) {
  const page = await readPage(link);
  const ing = P.ingest(db, { link, pageText: page });
  console.log(`\n[1] LICENSE GATE  ${link}`);
  console.log(`    license=${ing.gate.code} tier=${ing.gate.tier} decision=${ing.gate.decision} flags=${ing.gate.flags.join(',') || 'none'}`);
  if (!ing.ok) { console.log('    ' + ing.error); return null; }
  const { arxivId, version } = P.parseArxivLink(link);
  const d = await P.draftStory(db, { arxivId, version: version || 'v1', sourceText: sourceTextFor(arxivId, version), flags: ing.flags });
  console.log(`[2] DRAFT         story=${d.slug} cut=${d.cut.length} (unsourced claims removed)`);
  const c = P.checkStory(db, d.id, { sourceText: sourceTextFor(arxivId, version) });
  console.log(`[3] CHECKER       ok=${c.ok} claims=${c.report.claim_count} errors=${c.report.errors.length} warnings=${c.report.warnings.length} copycheck=${c.report.copycheck.status}${c.report.copycheck.recorded ? ' (recorded)' : ''}`);
  c.report.errors.forEach((e) => console.log('    ! ' + e));
  console.log(`    score: ${c.score.status === 'scored' ? c.score.score + '/100' : c.score.headline} confidence=${c.score.confidence}`);
  if (!c.ok) return d;
  P.approve(db, d.id, editor);
  console.log(`[4] APPROVED by ${editor}`);
  if (publish) {
    const r = P.publish(db, d.id, { statusProbe: fileProbe() });
    console.log(`[5] PUBLISHED     alerts queued=${r.alerts_queued}`);
  }
  return d;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'demo') {
    const dbFile = path.join(ROOT, 'db', 'feed.sqlite');
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
    const db = open();
    for (const d of DEMO) await runPipeline(db, d.link);
    const out = build(db);
    console.log('\nSITE BUILT', out, '->', path.join(ROOT, 'public'));
    console.log('Run: npm start   then open http://localhost:8787');
    return;
  }
  if (cmd === 'ingest') {
    const db = open();
    await runPipeline(db, args[0], { editor: args[1] || 'editor' });
    build(db);
    return;
  }
  if (cmd === 'build') { const db = open(); console.log(build(db)); return; }
  if (cmd === 'jobs') {
    const db = open();
    console.log('alerts', Alerts.deliver(db, new Date()), 'pulled', P.recheckPapers(db, fileProbe()));
    build(db);
    return;
  }
  if (cmd === 'serve') {
    const port = Number(process.env.PORT || 8787);
    const { server, db, adminToken, rebuild } = createApp({});
    rebuild();
    setInterval(() => { try { Alerts.deliver(db, new Date()); } catch (e) { console.error(e.message); } }, 60000).unref();
    setInterval(() => { try { P.recheckPapers(db, fileProbe()); rebuild(); } catch (e) { console.error(e.message); } }, 15 * 60000).unref();
    server.listen(port, () => {
      console.log(`Research Feed on http://localhost:${port}`);
      console.log(`Editor console: http://localhost:${port}/admin/   token: ${adminToken}  (set RF_ADMIN_TOKEN to fix it)`);
    });
    return;
  }
  console.log('usage: cli.js demo | ingest <arxiv link> [editor] | build | jobs | serve');
}

if (require.main === module) main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
module.exports = { runPipeline, readPage, DEMO };
