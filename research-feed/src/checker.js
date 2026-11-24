'use strict';
// THE CHECKER. A separate step that re-verifies every number against the paper before an editor sees the story.
// It does not trust the drafter. It reads the facts index (built by tools/extract_facts.js from the paper text),
// not the draft's own quotes. In production, run the extractor with a different parser/model than the drafter.
const { numbersIn, norm, evalFormula, cardText, storyText } = require('./claims');
const { scan } = require('./guard');

const CARD_TYPES = new Set(['hook', 'question', 'point', 'chart', 'timeline', 'contested', 'climax', 'payoff', 'anim']);
const JARGON = ['stochastic', 'heteroscedastic', 'eigen', 'orthogonal', 'asymptotic', 'bayesian', 'cohen', 'mann-whitney', 'wilcoxon', 'chi-squared'];

function findRows(facts, locator, row) {
  const loc = facts.locators[locator];
  if (!loc) return null;
  if (!row) return loc.nums;
  const rows = loc.rows.filter((r) => r.label.toLowerCase() === row.toLowerCase());
  if (!rows.length) return null;
  return rows.flatMap((r) => r.nums);
}
const hasNum = (pool, n) => pool.some((x) => Number(x) === Number(n));

function verifyQuote(c, facts) {
  const errs = [];
  const pool = findRows(facts, c.locator, c.row);
  if (!pool) return [`locator not found in facts index: ${c.locator}${c.row ? ' / ' + c.row : ''}`];
  for (const n of c.numbers || []) if (!hasNum(pool, n)) errs.push(`${n} not found at ${c.locator}${c.row ? ' / ' + c.row : ''}`);
  // Column-exact check: claim.cols[i] is the position of numbers[i] inside the table row.
  if (c.cols && c.row) {
    const rows = facts.locators[c.locator].rows.filter((r) => r.label.toLowerCase() === c.row.toLowerCase());
    (c.numbers || []).forEach((n, i) => {
      if (!rows.some((r) => r.nums[c.cols[i]] !== undefined && Number(r.nums[c.cols[i]]) === Number(n))) errs.push(`${n} is not in column ${c.cols[i]} of row ${c.row}`);
    });
  }
  const shown = numbersIn(c.display);
  for (const s of shown) if (!(c.numbers || []).some((n) => Number(n) === Number(s))) errs.push(`display "${c.display}" shows ${s}, which is not in the claim's numbers`);
  return errs;
}

function verifyComputed(c, facts) {
  const errs = [];
  const vars = {};
  for (const [k, inp] of Object.entries(c.inputs || {})) {
    const pool = findRows(facts, inp.locator, inp.row);
    if (!pool) { errs.push(`input ${k}: locator not found ${inp.locator}${inp.row ? ' / ' + inp.row : ''}`); continue; }
    if (!hasNum(pool, inp.value)) errs.push(`input ${k}: ${inp.value} not found at ${inp.locator}${inp.row ? ' / ' + inp.row : ''}`);
    vars[k] = Number(inp.value);
  }
  if (errs.length) return errs;
  let result;
  try { result = evalFormula(c.formula, vars); } catch (e) { return [`formula error: ${e.message}`]; }
  const d = c.decimals ?? 2;
  const rounded = Number(result.toFixed(d));
  const shown = numbersIn(c.display);
  if (!shown.length) errs.push('computed claim display has no number');
  for (const s of shown) if (Math.abs(Number(s) - rounded) > 1e-9) errs.push(`display ${c.display} != recomputed ${rounded} (formula ${c.formula})`);
  c._recomputed = rounded;
  return errs;
}

// Returns {ok, errors[], warnings[], claims:{id:{ok,errors}}, recomputed}
function check({ draft, facts, tier, peerReviewed }) {
  const errors = [];
  const warnings = [];
  const claimReport = {};

  // 1. every claim
  for (const [id, c] of Object.entries(draft.claims || {})) {
    const errs = c.kind === 'computed' ? verifyComputed(c, facts) : verifyQuote(c, facts);
    claimReport[id] = { ok: errs.length === 0, errors: errs, display: c.display, recomputed: c._recomputed };
    errs.forEach((e) => errors.push(`claim ${id}: ${e}`));
  }

  // 2. every number in visible text must be backed by a claim the same sentence points at
  for (const card of draft.cards) {
    if (!CARD_TYPES.has(card.type)) errors.push(`card ${card.id}: unknown type ${card.type}`);
    for (const s of card.sentences || []) {
      const allowed = new Set();
      for (const id of s.claims || []) {
        const c = draft.claims[id];
        if (!c) { errors.push(`card ${card.id}: sentence cites missing claim ${id}`); continue; }
        numbersIn(c.display).forEach((n) => allowed.add(n));
        (c.numbers || []).forEach((n) => allowed.add(norm(n)));
      }
      for (const n of numbersIn(s.t)) if (!allowed.has(n)) errors.push(`card ${card.id}: number ${n} in "${s.t.slice(0, 60)}..." has no claim`);
      if (s.factual && !(s.claims || []).length) errors.push(`card ${card.id}: factual sentence without claim`);
      const wc = s.t.trim().split(/\s+/).length;
      if (wc > 24) errors.push(`card ${card.id}: sentence has ${wc} words (limit 24)`);
    }
    const headNums = numbersIn(card.headline || '');
    if (headNums.length) errors.push(`card ${card.id}: headline has numbers; put them in a sourced sentence`);

    // 3. visuals: alt text, caption, numbers from claims
    const v = card.visual;
    if (v) {
      // Numbers printed in chart titles, labels, alt text and captions must also come from this card's claims.
      const cardAllowed = new Set();
      const addClaim = (id) => { const c = draft.claims[id]; if (c) { numbersIn(c.display).forEach((n) => cardAllowed.add(n)); (c.numbers || []).forEach((n) => cardAllowed.add(norm(n))); } };
      (card.sentences || []).forEach((s) => (s.claims || []).forEach(addClaim));
      (v.items || []).forEach((it) => addClaim(it.claim));
      const vtexts = [v.title, v.alt, v.caption, ...(v.items || []).flatMap((it) => [it.label, it.when, it.text])];
      for (const t of vtexts) for (const n of numbersIn(t || '', { digitsOnly: true })) if (!cardAllowed.has(n)) errors.push(`card ${card.id}: number ${n} in visual text "${String(t).slice(0, 50)}" has no claim`);
      if (!v.alt || v.alt.trim().length < 20) errors.push(`card ${card.id}: visual needs alt text`);
      if (!v.caption) errors.push(`card ${card.id}: visual needs a caption`);
      if (v.kind === 'bars' || v.kind === 'timeline') {
        for (const it of v.items || []) {
          const c = draft.claims[it.claim];
          if (!c) { errors.push(`card ${card.id}: chart item "${it.label || it.when}" has no claim`); continue; }
          if (v.kind === 'bars') {
            const have = (c.kind === 'computed' ? [String(c._recomputed ?? '')] : (c.numbers || [])).map(norm);
            for (const val of it.values || []) if (!have.includes(norm(val))) errors.push(`card ${card.id}: chart value ${val} not in claim ${it.claim}`);
          }
        }
      }
      if (v.kind === 'anim' && !v.name) errors.push(`card ${card.id}: animation needs a name`);
    }
    if (card.type === 'contested') {
      const ct = card.contested;
      if (!ct || !draft.claims[ct.headline_claim] || !(ct.table_claims || []).every((id) => draft.claims[id])) errors.push(`card ${card.id}: contested box needs headline_claim and table_claims`);
    }
  }

  // 4. structure of a Vizmaya story
  const types = draft.cards.map((c) => c.type);
  if (types[0] !== 'hook') errors.push('first card must be a hook');
  for (const need of ['climax', 'payoff']) if (!types.includes(need)) errors.push(`missing ${need} card`);
  if (!types.includes('question')) errors.push('missing a question card (open question that pulls to the next card)');
  if (draft.cards.length < 8 || draft.cards.length > 16) warnings.push(`story has ${draft.cards.length} cards (target 8 to 16)`);
  const reuse = draft.reuse || [];
  if (tier === 'IDEAS_ONLY' && reuse.length) errors.push('ideas-only license: story must not declare reused text or figures');

  // 5. rails: securities, sensitive, social proof
  const text = storyText(draft);
  for (const h of scan(text)) errors.push(`rail ${h.rail}: "${h.match}"`);

  // 6. plain English lint
  const low = text.toLowerCase();
  for (const j of JARGON) if (low.includes(j)) warnings.push(`jargon: "${j}" (explain it or cut it)`);

  // 7. labels
  if (!peerReviewed && draft.preprint_warning === false) errors.push('preprint warning cannot be turned off');
  return { ok: errors.length === 0, errors, warnings, claims: claimReport, cards: draft.cards.length, claim_count: Object.keys(draft.claims || {}).length };
}

module.exports = { check, CARD_TYPES };
