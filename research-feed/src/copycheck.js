'use strict';
// COPY CHECK. For IDEAS_ONLY papers: no copied sentences, no section-by-section mirroring.
// Compares story text with the paper text using word n-grams. Needs the paper text on the machine.
// The paper text is NEVER committed to this repo (it may be CC BY-NC-ND). Only the verdict and the text hash are kept.
const crypto = require('node:crypto');

const words = (t) => String(t).toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);

function ngrams(ws, n) {
  const set = new Map();
  for (let i = 0; i + n <= ws.length; i++) {
    const g = ws.slice(i, i + n).join(' ');
    if (!set.has(g)) set.set(g, i);
  }
  return set;
}

// Longest run of consecutive words shared with the source.
function longestSharedRun(storyWords, srcSet, n) {
  let best = 0;
  let run = 0;
  for (let i = 0; i + n <= storyWords.length; i++) {
    if (srcSet.has(storyWords.slice(i, i + n).join(' '))) { run = run === 0 ? n : run + 1; best = Math.max(best, run); } else run = 0;
  }
  return best;
}

// allowedQuotes: verbatim quotes we are permitted to reuse (FULL tier only), removed before comparing.
function copycheck({ storyText, sourceText, tier, allowedQuotes = [], n = 6 }) {
  const storyHash = crypto.createHash('sha256').update(storyText).digest('hex');
  if (!sourceText) return { status: 'skipped', reason: 'paper text not available on this machine', story_text_sha256: storyHash };
  let st = storyText;
  for (const q of allowedQuotes) st = st.split(q).join(' ');
  const sw = words(st);
  const srcSet = ngrams(words(sourceText), n);
  const shared = [];
  for (let i = 0; i + n <= sw.length; i++) {
    const g = sw.slice(i, i + n).join(' ');
    if (srcSet.has(g)) shared.push(g);
  }
  const run = longestSharedRun(sw, srcSet, n);
  // Rule: in IDEAS_ONLY there must be zero shared 6-word runs. In FULL tier we also stay at zero outside declared quotes (house style).
  const status = shared.length === 0 ? 'pass' : 'fail';
  const quotesVerified = allowedQuotes.map((q) => ({ quote: q, verbatim_in_source: words(sourceText).join(' ').includes(words(q).join(' ')) }));
  return {
    status, n, tier, story_text_sha256: storyHash, shared_ngrams: shared.slice(0, 10), shared_count: shared.length, longest_shared_run_words: run,
    quotes_verified: quotesVerified,
    source_sha256: crypto.createHash('sha256').update(sourceText).digest('hex'),
  };
}

module.exports = { copycheck };
