'use strict';
// PIPELINE: paper link in -> license gate -> cited draft -> cut unsourced -> checker -> editor approval -> publish.
// Every transition is a function here, and every one writes an audit row.
const fs = require('node:fs');
const path = require('node:path');
const { open, audit, sha256, ROOT } = require('./db');
const License = require('./license');
const { runDraft, recorded } = require('./llm');
const { cutUnsourced, storyText } = require('./claims');
const { check } = require('./checker');
const { copycheck } = require('./copycheck');
const { scan } = require('./guard');
const { score: computeScore } = require('./score');
const Alerts = require('./alerts');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const iso = (clock) => (clock ? clock() : new Date()).toISOString();

function parseArxivLink(link) {
  const m = String(link).match(/(?:arxiv\.org\/(?:abs|pdf|html)\/|arXiv:)?(\d{4}\.\d{4,5})(v\d+)?/i);
  if (!m) throw new Error('Not an arXiv link or id: ' + link);
  return { arxivId: m[1], version: m[2] || null };
}

function loadMeta(arxivId, version) {
  const f = `content/papers/${arxivId}${version}.json`;
  if (!fs.existsSync(path.join(ROOT, f))) throw new Error(`No paper metadata for ${arxivId}${version}. Add ${f}.`);
  return readJson(f);
}

// Quality warning: papers we cannot read well get a visible warning (or are skipped by the editor).
// Partial heuristic: title not mostly Latin letters, or almost no numbers/tables extracted (scanned, math-heavy or figure-heavy).
function qualityFlags(meta, facts) {
  const flags = [];
  const letters = [...meta.title].filter((c) => /\p{L}/u.test(c));
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  if (letters.length && latin / letters.length < 0.8) flags.push('quality_warning');
  const locs = Object.values(facts.locators);
  const tables = locs.filter((l) => l.kind === 'table' && l.rows.length).length;
  const nums = locs.reduce((a, l) => a + l.nums.length, 0);
  if (tables === 0 || nums < 30) flags.push('quality_warning');
  return [...new Set(flags)];
}

// STEP 1. License gate. Reads the exact version's page. Writes the log. Stops here on BLOCK.
function ingest(db, { link, pageText, clock }) {
  const { arxivId, version: v } = parseArxivLink(link);
  const version = v || 'v1';
  const g = License.gate({ arxivId, version, pageText, clock });
  License.logGate(db, g);
  audit(db, 'system', 'license.gate', `${arxivId}${version}`, { code: g.code, tier: g.tier, decision: g.decision }, clock);
  if (g.decision === 'BLOCK') return { ok: false, gate: g, error: `Blocked: ${g.reason}` };
  const meta = loadMeta(arxivId, version);
  const facts = readJson(meta.facts);
  db.prepare(
    `INSERT OR REPLACE INTO paper_versions (arxiv_id,version,title,authors_json,institutions_json,submitted_on,peer_reviewed,license_code,license_url,tier,withdrawn,latest_version,facts_sha256,source_sha256)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(arxivId, version, meta.title, JSON.stringify(meta.authors), JSON.stringify(meta.institutions), meta.submitted_on,
    meta.peer_reviewed ? 1 : 0, g.code, g.licenseUrl, g.tier, 0, g.latestVersion, sha256(JSON.stringify(facts)), facts.source_sha256);
  return { ok: true, gate: g, meta, flags: [...new Set([...g.flags, ...qualityFlags(meta, facts)])] };
}

// STEP 2. Draft. Refuses without an ALLOW row in the license log for this exact version.
async function draftStory(db, { arxivId, version, provider = recorded, sourceText, clock, flags = [], sponsored = false }) {
  if (!License.hasAllowedLogRow(db, arxivId, version)) throw new Error('No ALLOW row in the license log. Drafting refused.');
  if (sponsored && process.env.RF_SPONSORED !== '1') throw new Error('Sponsored stories are phase 3 and behind a flag (RF_SPONSORED=1).');
  const meta = loadMeta(arxivId, version);
  const pv = db.prepare('SELECT * FROM paper_versions WHERE arxiv_id=? AND version=?').get(arxivId, version);
  const facts = readJson(meta.facts);
  const { draft, runId } = await runDraft(db, provider, {
    meta, tier: pv.tier, sourceText, sourceSha: facts.source_sha256, factsLocators: Object.keys(facts.locators),
  }, clock);
  const cut = cutUnsourced(draft); // claims with no source are cut automatically
  const slug = cut.draft.slug || `${arxivId}${version}`;
  const dup = db.prepare('SELECT slug FROM stories WHERE arxiv_id=? AND status NOT IN (\'pulled\')').get(arxivId);
  if (dup) throw new Error(`Duplicate: a story for arXiv:${arxivId} already exists (${dup.slug}).`);
  const r = db.prepare(
    `INSERT INTO stories (slug,arxiv_id,based_on_version,field,status,flags_json,sponsored,ai_assisted,draft_json,cut_log_json,created_at)
     VALUES (?,?,?,?,?,?,?,1,?,?,?)`,
  ).run(slug, arxivId, version, meta.field, 'draft', JSON.stringify(flags), sponsored ? 1 : 0, JSON.stringify(cut.draft), JSON.stringify(cut.log), iso(clock));
  const id = Number(r.lastInsertRowid);
  db.prepare('UPDATE llm_runs SET story_id=? WHERE id=?').run(id, runId);
  audit(db, 'system', 'story.draft', slug, { cut: cut.log.length, run: runId }, clock);
  return { id, slug, cut: cut.log };
}

// STEP 3. Checker + copy check + rails + score. Separate from the drafter.
function checkStory(db, id, { sourceText, clock } = {}) {
  const s = db.prepare('SELECT * FROM stories WHERE id=?').get(id);
  if (!s) throw new Error('no such story');
  const pv = db.prepare('SELECT * FROM paper_versions WHERE arxiv_id=? AND version=?').get(s.arxiv_id, s.based_on_version);
  const meta = loadMeta(s.arxiv_id, s.based_on_version);
  const facts = readJson(meta.facts);
  const draft = JSON.parse(s.draft_json);
  const rep = check({ draft, facts, tier: pv.tier, peerReviewed: !!pv.peer_reviewed });
  rep.facts_sha256 = sha256(JSON.stringify(facts));
  rep.copycheck = copycheck({ storyText: storyText(draft), sourceText, tier: pv.tier, allowedQuotes: (draft.reuse || []).map((r) => r.text) });
  if (rep.copycheck.status === 'skipped') {
    // No paper text on this machine. Accept a recorded result ONLY if it was made for this exact story text.
    const recFile = path.join(ROOT, 'content', 'copycheck', `${s.arxiv_id}${s.based_on_version}.json`);
    if (fs.existsSync(recFile)) {
      const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
      if (rec.story_text_sha256 === rep.copycheck.story_text_sha256) rep.copycheck = { ...rec, recorded: true };
    }
  }
  if (rep.copycheck.status === 'fail') { rep.ok = false; rep.errors.push(`copy check: ${rep.copycheck.shared_count} shared word runs with the paper`); }
  if (rep.copycheck.quotes_verified) for (const q of rep.copycheck.quotes_verified) if (!q.verbatim_in_source) { rep.ok = false; rep.errors.push(`reused quote is not verbatim in the paper: "${q.quote.slice(0, 40)}..."`); }
  rep.checked_at = iso(clock);
  const sc = scoreFor(meta, clock);
  db.prepare('DELETE FROM claims WHERE story_id=?').run(id);
  const ins = db.prepare('INSERT INTO claims (story_id,claim_id,card_id,kind,display,locator,row_label,formula,verified) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const [cid, c] of Object.entries(draft.claims)) {
    const card = draft.cards.find((k) => (k.sentences || []).some((x) => (x.claims || []).includes(cid)) || (k.visual?.items || []).some((i) => i.claim === cid));
    ins.run(id, cid, card ? card.id : '-', c.kind, c.display, c.locator || null, c.row || null, c.formula || null, rep.claims[cid]?.ok ? 1 : 0);
  }
  const status = rep.ok ? 'checked' : 'draft';
  db.prepare('UPDATE stories SET checker_json=?, score_json=?, status=? WHERE id=? AND status IN (\'draft\',\'checked\')').run(JSON.stringify(rep), JSON.stringify(sc), status, id);
  audit(db, 'checker', 'story.check', s.slug, { ok: rep.ok, errors: rep.errors.length, copycheck: rep.copycheck.status }, clock);
  return { ok: rep.ok, report: rep, score: sc };
}

function scoreFor(meta, clock) {
  const signals = readJson(meta.signals);
  return computeScore({ submittedOn: meta.first_submitted_on || meta.submitted_on, field: meta.arxiv_category, signals, asOf: iso(clock) });
}

// STEP 4. Editor approval. A human. Checker must be green. Ideas-only needs a passed copy check (or a logged override).
function approve(db, id, editor, { overrideCopycheck, reason, clock } = {}) {
  const s = db.prepare('SELECT * FROM stories WHERE id=?').get(id);
  if (!editor) throw new Error('Editor name required.');
  if (s.status !== 'checked') throw new Error(`Story is ${s.status}, not checked.`);
  const rep = JSON.parse(s.checker_json);
  if (!rep.ok) throw new Error('Checker is not green.');
  const pv = db.prepare('SELECT tier FROM paper_versions WHERE arxiv_id=? AND version=?').get(s.arxiv_id, s.based_on_version);
  if (rep.copycheck.status !== 'pass') {
    if (pv.tier === 'IDEAS_ONLY' && !(overrideCopycheck && reason)) throw new Error('Ideas-only story needs a passed copy check, or an override with a reason.');
    audit(db, `editor:${editor}`, 'copycheck.override', s.slug, reason || '', clock);
  }
  db.prepare(`UPDATE stories SET status='approved', approved_by=?, approved_at=? WHERE id=?`).run(editor, iso(clock), id);
  audit(db, `editor:${editor}`, 'story.approve', s.slug, '', clock);
  return { ok: true };
}

// STEP 5. Publish. Re-checks the license log and the live paper status first.
// statusProbe(arxivId) -> {withdrawn, latestVersion}. Production: fetch the arXiv page. Tests: a stub.
function publish(db, id, { statusProbe, clock } = {}) {
  const s = db.prepare('SELECT * FROM stories WHERE id=?').get(id);
  if (s.status !== 'approved') throw new Error(`Story is ${s.status}, not approved.`);
  if (!License.hasAllowedLogRow(db, s.arxiv_id, s.based_on_version)) throw new Error('No ALLOW row in the license log for this exact version. Publish refused.');
  if (s.sponsored && process.env.RF_SPONSORED !== '1') throw new Error('Sponsored stories are behind a flag.');
  const hits = scan(storyText(JSON.parse(s.draft_json)));
  if (hits.length) throw new Error('Rail hit at publish: ' + JSON.stringify(hits));
  const probe = statusProbe ? statusProbe(s.arxiv_id) : { withdrawn: false, latestVersion: s.based_on_version };
  if (probe.withdrawn) {
    db.prepare(`UPDATE stories SET status='pulled' WHERE id=?`).run(id);
    db.prepare('UPDATE paper_versions SET withdrawn=1 WHERE arxiv_id=?').run(s.arxiv_id);
    audit(db, 'system', 'story.blocked_withdrawn', s.slug, '', clock);
    throw new Error('Paper is withdrawn. Story not published.');
  }
  const flags = new Set(JSON.parse(s.flags_json));
  if (probe.latestVersion && probe.latestVersion !== s.based_on_version) flags.add('based_on_old_version');
  const meta = loadMeta(s.arxiv_id, s.based_on_version);
  const sc = scoreFor(meta, clock); // score is recomputed at publish so the age is right
  db.prepare(`UPDATE stories SET status='published', published_at=?, flags_json=?, score_json=? WHERE id=?`).run(iso(clock), JSON.stringify([...flags]), JSON.stringify(sc), id);
  // Log every figure, chart, animation and quote used.
  const draft = JSON.parse(s.draft_json);
  const asset = db.prepare('INSERT INTO asset_log (story_id,kind,source,author,license,url,logged_at) VALUES (?,?,?,?,?,?,?)');
  for (const c of draft.cards) {
    if (c.visual && c.visual.kind === 'bars') asset.run(id, 'chart', `rebuilt from ${[...new Set((c.visual.items || []).map((i) => draft.claims[i.claim].locator))].join(', ')}`, 'Vizmaya', 'own work', null, iso(clock));
    if (c.visual && c.visual.kind === 'anim') asset.run(id, 'animation', `original animation "${c.visual.name}", no paper content`, 'Vizmaya', 'own work', null, iso(clock));
  }
  for (const r of draft.reuse || []) asset.run(id, 'quote', `verbatim quote, ${r.locator}`, meta.authors.join(', '), r.license, `https://arxiv.org/abs/${s.arxiv_id}${s.based_on_version}`, iso(clock));
  const queued = Alerts.queueForStory(db, { id, field: s.field }, clock ? clock() : new Date());
  audit(db, 'system', 'story.publish', s.slug, { alerts_queued: queued }, clock);
  return { ok: true, alerts_queued: queued };
}

// ---- after publishing ----

// Wrong claim reported: "Under review" at once (SLA 1 hour). Takedown: down first, questions after.
function report(db, { slug, kind, body, contact }, clock) {
  const s = db.prepare('SELECT * FROM stories WHERE slug=?').get(slug);
  if (!s) return { ok: false, error: 'Unknown story.' };
  if (!['error', 'dispute', 'takedown', 'dmca', 'counter_notice'].includes(kind)) return { ok: false, error: 'Unknown report type.' };
  if (!body || String(body).length < 5) return { ok: false, error: 'Please say what is wrong.' };
  const now = clock ? clock() : new Date();
  const due = { error: 24, dispute: 48, takedown: 24, dmca: 24, counter_notice: 24 }[kind]; // hours (assumptions)
  db.prepare('INSERT INTO reports (story_id,kind,body,contact,created_at,due_at) VALUES (?,?,?,?,?,?)')
    .run(s.id, kind, String(body).slice(0, 4000), contact ? String(contact).slice(0, 200) : null, now.toISOString(), new Date(now.getTime() + due * 3600000).toISOString());
  let message = 'Thank you. A human will read this.';
  if (s.status === 'published') {
    if (kind === 'error') { setStatus(db, s, 'under_review', clock); message = 'Thank you. The story now shows "Under review" while we check. We fix confirmed errors within 24 hours.'; }
    if (kind === 'takedown' || kind === 'dmca') { setStatus(db, s, 'pulled', clock); message = 'The story is down now. A human will follow up the same day.'; }
    if (kind === 'dispute') { const f = new Set(JSON.parse(s.flags_json)); f.add('score_disputed'); db.prepare('UPDATE stories SET flags_json=? WHERE id=?').run(JSON.stringify([...f]), s.id); message = 'Score dispute logged. We review within 48 hours.'; }
  }
  audit(db, 'public', `report.${kind}`, slug, { contact: !!contact }, clock);
  return { ok: true, message };
}

function setStatus(db, s, status, clock) {
  db.prepare('UPDATE stories SET status=? WHERE id=?').run(status, s.id);
  audit(db, 'system', `story.${status}`, s.slug, '', clock);
}

function resolveReport(db, reportId, { editor, resolution, restore }, clock) {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(reportId);
  db.prepare('UPDATE reports SET resolved_at=?, resolution=? WHERE id=?').run(iso(clock), resolution, reportId);
  const s = db.prepare('SELECT * FROM stories WHERE id=?').get(r.story_id);
  if (restore && ['under_review', 'pulled'].includes(s.status)) {
    if (r.kind === 'dmca') throw new Error('DMCA matters need a human decision outside this tool (counter-notice window).');
    db.prepare(`UPDATE stories SET status='published' WHERE id=?`).run(s.id);
  }
  if (r.kind === 'dispute') { const f = JSON.parse(s.flags_json).filter((x) => x !== 'score_disputed'); db.prepare('UPDATE stories SET flags_json=? WHERE id=?').run(JSON.stringify(f), s.id); }
  audit(db, `editor:${editor}`, 'report.resolve', `${s.slug}#${reportId}`, resolution, clock);
}

// Paper updated to a newer version: flag "based on vN" until a human reviews it.
function onPaperUpdated(db, arxivId, newVersion, clock) {
  const rows = db.prepare(`SELECT * FROM stories WHERE arxiv_id=? AND status IN ('published','approved','checked')`).all(arxivId);
  for (const s of rows) {
    if (s.based_on_version === newVersion) continue;
    const f = new Set(JSON.parse(s.flags_json)); f.add('based_on_old_version');
    db.prepare('UPDATE stories SET flags_json=? WHERE id=?').run(JSON.stringify([...f]), s.id);
    audit(db, 'system', 'story.flag_old_version', s.slug, newVersion, clock);
  }
  db.prepare('UPDATE paper_versions SET latest_version=? WHERE arxiv_id=?').run(newVersion, arxivId);
  return rows.length;
}

// Job: run on a schedule AND on page load via the status file. Pull anything whose paper is withdrawn.
function recheckPapers(db, statusProbe, clock) {
  const rows = db.prepare(`SELECT * FROM stories WHERE status IN ('published','under_review')`).all();
  let pulled = 0;
  for (const s of rows) {
    const p = statusProbe(s.arxiv_id);
    if (p.withdrawn) { db.prepare(`UPDATE stories SET status='pulled' WHERE id=?`).run(s.id); db.prepare('UPDATE paper_versions SET withdrawn=1 WHERE arxiv_id=?').run(s.arxiv_id); audit(db, 'system', 'story.pulled_withdrawn', s.slug, '', clock); pulled++; }
    else if (p.latestVersion && p.latestVersion !== s.based_on_version) onPaperUpdated(db, s.arxiv_id, p.latestVersion, clock);
  }
  return pulled;
}

// Reports past due: surfaced to a human.
function overdueReports(db, clock) {
  return db.prepare(`SELECT r.id, r.kind, r.due_at, s.slug FROM reports r JOIN stories s ON s.id=r.story_id WHERE r.resolved_at IS NULL AND r.due_at < ?`).all(iso(clock));
}

module.exports = { qualityFlags, ingest, draftStory, checkStory, approve, publish, report, resolveReport, onPaperUpdated, recheckPapers, overdueReports, parseArxivLink, loadMeta, scoreFor, readJson };
