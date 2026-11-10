'use strict';
// LICENSE GATE. Deterministic. The LLM never decides the license.
// Runs BEFORE any story is drafted. Reads the license link on the exact version's page.
const GATE_VERSION = 'gate-1.0.0';

const TIERS = {
  FULL: 'FULL_REUSE_WITH_CREDIT',
  IDEAS: 'IDEAS_ONLY',
  BLOCK: 'BLOCK',
};

// Policy table. Share-alike is treated as ideas-only because it conflicts with a paid layer.
const POLICY = {
  CC_BY: { tier: TIERS.FULL, label: 'CC BY 4.0', why: 'Reuse allowed with credit.' },
  CC0: { tier: TIERS.FULL, label: 'CC0', why: 'Public domain dedication.' },
  CC_BY_SA: { tier: TIERS.IDEAS, label: 'CC BY-SA', why: 'Share-alike clashes with a paid layer. Ideas only.' },
  CC_BY_NC: { tier: TIERS.IDEAS, label: 'CC BY-NC', why: 'Non-commercial. Ideas and facts only.' },
  CC_BY_NC_SA: { tier: TIERS.IDEAS, label: 'CC BY-NC-SA', why: 'Non-commercial share-alike. Ideas and facts only.' },
  CC_BY_ND: { tier: TIERS.IDEAS, label: 'CC BY-ND', why: 'No derivatives. Ideas and facts only.' },
  CC_BY_NC_ND: { tier: TIERS.IDEAS, label: 'CC BY-NC-ND 4.0', why: 'Non-commercial, no derivatives. Ideas and facts only.' },
  ARXIV_DEFAULT: { tier: TIERS.IDEAS, label: 'arXiv non-exclusive license', why: 'Authors keep rights. Ideas and facts only.' },
  PUBLISHER: { tier: TIERS.IDEAS, label: 'Publisher copyright', why: 'Ideas and facts only.' },
  UNKNOWN: { tier: TIERS.BLOCK, label: 'Unknown', why: 'License not found. Publishing is blocked.' },
};

// Read the license from the paper's "Access Paper" block (HTML or markdown).
function parseLicense(pageText) {
  const t = pageText || '';
  const cc = t.match(/creativecommons\.org\/(licenses|publicdomain)\/([a-z0-9-]+)\/([\d.]+)/i);
  if (cc) {
    const kind = cc[2].toLowerCase();
    const map = {
      by: 'CC_BY', 'by-sa': 'CC_BY_SA', 'by-nc': 'CC_BY_NC', 'by-nc-sa': 'CC_BY_NC_SA',
      'by-nd': 'CC_BY_ND', 'by-nc-nd': 'CC_BY_NC_ND', zero: 'CC0', mark: 'CC0',
    };
    const code = map[kind] || 'UNKNOWN';
    return { code, url: cc[0].startsWith('http') ? cc[0] : `http://${cc[0]}`, raw: kind };
  }
  const std = t.match(/arxiv\.org\/(licenses\/nonexclusive-distrib[^\s)"']*)/i);
  if (std) return { code: 'ARXIV_DEFAULT', url: `http://arxiv.org/${std[1]}`, raw: 'nonexclusive-distrib' };
  return { code: 'UNKNOWN', url: null, raw: null };
}

// Read the page header facts: version, latest version, withdrawn flag.
function parsePageState(pageText, requestedVersion) {
  const t = pageText || '';
  const latest = t.match(/latest version[^v]*\(?\[?(v\d+)/i);
  const withdrawn = /\b(withdrawn|this paper has been withdrawn)\b/i.test(t) && !/not withdrawn/i.test(t);
  const thisVersion = (t.match(/this version,\s*(v\d+)/i) || [])[1] || requestedVersion;
  return { thisVersion, latestVersion: latest ? latest[1] : thisVersion, withdrawn };
}

// The gate. Pure function of the page text and the requested version.
function gate({ arxivId, version, pageText, clock = () => new Date() }) {
  const lic = parseLicense(pageText);
  const state = parsePageState(pageText, version);
  const pol = POLICY[lic.code];
  const flags = [];
  let decision = pol.tier === TIERS.BLOCK ? 'BLOCK' : 'ALLOW';
  let reason = pol.why;
  if (state.withdrawn) {
    decision = 'BLOCK';
    reason = 'Paper is withdrawn.';
    flags.push('withdrawn');
  }
  if (state.thisVersion !== version) {
    decision = 'BLOCK';
    reason = `Page shows ${state.thisVersion} but ${version} was requested. License must be read from the exact version.`;
  }
  if (state.latestVersion !== state.thisVersion) flags.push('based_on_old_version');
  return {
    arxivId, version, code: lic.code, licenseUrl: lic.url, label: pol.label,
    tier: decision === 'BLOCK' ? TIERS.BLOCK : pol.tier,
    decision, reason, flags, latestVersion: state.latestVersion,
    checkedAt: clock().toISOString(), gateVersion: GATE_VERSION,
  };
}

// Writes the log row. Publishing later refuses any story with no ALLOW row for its exact version.
function logGate(db, g) {
  db.prepare(
    `INSERT INTO license_log (arxiv_id, version, license_code, tier, decision, reason, evidence, checked_at, gate_version)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(g.arxivId, g.version, g.code, g.tier, g.decision, g.reason, g.licenseUrl || 'none found', g.checkedAt, g.gateVersion);
}

function hasAllowedLogRow(db, arxivId, version) {
  const r = db
    .prepare(`SELECT decision FROM license_log WHERE arxiv_id=? AND version=? ORDER BY id DESC LIMIT 1`)
    .get(arxivId, version);
  return !!r && r.decision === 'ALLOW';
}

module.exports = { gate, logGate, hasAllowedLogRow, parseLicense, parsePageState, POLICY, TIERS, GATE_VERSION };
