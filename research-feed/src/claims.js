'use strict';
// Claim handling shared by the cutter, the checker and the renderer.
// A story is cards of sentences. A sentence marked factual MUST point at claims. A claim MUST point at a source span.

// Numbers in visible text. Names like "Qwen3" or "8B" are not numbers; "60-minute" and "12,749" are.
const NUM_IN_TEXT = /(?<![A-Za-z\d.])-?\d[\d,]*(?:\.\d+)?(?![A-Za-z\d])/g;

function norm(n) {
  const s = String(n).replace(/,/g, '').replace(/[%x×]$/i, '');
  const f = Number(s);
  return Number.isFinite(f) ? String(f) : s;
}

// Spelled-out numbers must be sourced too. "one" is skipped: it is mostly a pronoun.
const WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, hundreds: 100, dozen: 12 };
const WORD_RE = new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\b`, 'gi');

function numbersIn(text, opts = {}) {
  const out = [];
  for (const m of String(text || '').matchAll(NUM_IN_TEXT)) {
    const raw = m[0].replace(/\.$/, '');
    out.push(norm(raw));
  }
  if (!opts.digitsOnly) for (const m of String(text || '').matchAll(WORD_RE)) out.push(String(WORDS[m[1].toLowerCase()]));
  return out;
}

// Safe arithmetic: + - * / ( ) numbers and single-letter variables. No eval.
function evalFormula(formula, vars) {
  const toks = formula.match(/\d+\.?\d*|[a-z]\w*|[()+\-*/]/gi);
  if (!toks || toks.join('') !== formula.replace(/\s+/g, '')) throw new Error(`bad formula: ${formula}`);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  function primary() {
    const t = next();
    if (t === '(') { const v = expr(); if (next() !== ')') throw new Error('missing )'); return v; }
    if (t === '-') return -primary();
    if (/^\d/.test(t)) return Number(t);
    if (Object.prototype.hasOwnProperty.call(vars, t)) return vars[t];
    throw new Error(`unknown variable ${t}`);
  }
  function term() {
    let v = primary();
    while (peek() === '*' || peek() === '/') { const op = next(); const r = primary(); v = op === '*' ? v * r : v / r; }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = next(); const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  const v = expr();
  if (i !== toks.length) throw new Error('trailing tokens');
  return v;
}

// AUTOMATIC CUT: a factual sentence with no resolvable claim is removed and logged.
// A claim with no source locator is removed first, which can orphan its sentences.
function cutUnsourced(draft) {
  const log = [];
  const claims = { ...draft.claims };
  for (const [id, c] of Object.entries(claims)) {
    const hasSource = c.kind === 'computed'
      ? c.inputs && Object.values(c.inputs).every((x) => x.locator)
      : !!c.locator;
    if (!hasSource) { log.push({ type: 'claim', id, display: c.display, reason: 'no source span' }); delete claims[id]; }
  }
  const cards = [];
  for (const card of draft.cards) {
    const sentences = [];
    for (const s of card.sentences || []) {
      const refs = (s.claims || []).filter((id) => claims[id]);
      const hasNum = numbersIn(s.t).length > 0;
      if ((s.factual || hasNum) && refs.length === 0) {
        log.push({ type: 'sentence', card: card.id, text: s.t, reason: 'factual sentence with no sourced claim' });
        continue;
      }
      sentences.push({ ...s, claims: refs });
    }
    // A card whose only content was cut is dropped. Cards with a visual keep it.
    if (sentences.length === 0 && !card.visual) { log.push({ type: 'card', id: card.id, reason: 'all sentences cut' }); continue; }
    cards.push({ ...card, sentences });
  }
  return { draft: { ...draft, claims, cards }, log };
}

function cardText(card) {
  const parts = [card.headline || ''];
  for (const s of card.sentences || []) parts.push(s.t);
  const v = card.visual;
  if (v) {
    parts.push(v.title || '', v.alt || '', v.caption || '');
    for (const it of v.items || []) parts.push(it.label || '', it.when || '', it.text || '');
  }
  if (card.contested) parts.push(card.contested.explain || '');
  return parts.join(' ');
}

function storyText(draft) {
  return [draft.title, draft.deck, ...draft.cards.map(cardText)].join('\n');
}

module.exports = { numbersIn, norm, evalFormula, cutUnsourced, cardText, storyText, NUM_IN_TEXT };
