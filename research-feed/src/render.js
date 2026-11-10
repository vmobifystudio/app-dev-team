'use strict';
// STATIC PAGES. Cheap to serve, good for search, shareable by link. Reading needs no login and no JS.
// JS only adds: share, audio, saves, status check, report forms.
const { bars, anim, esc } = require('./svg');
const { RULES } = require('./score');

const SITE = process.env.RF_SITE_URL || 'http://localhost:8787';
const PUBLISHER = 'Vizmaya';

const LOC = (l) => {
  if (l === 'Front matter') return 'abstract and introduction';
  if (/^Sec\./.test(l)) return l.replace('Sec.', 'section');
  if (/^Table in Sec\./.test(l)) return l.replace('Table in Sec.', 'appendix tables, section');
  return l;
};

// ---- credit block, filled from the paper (spec format) ----
function creditBlock({ meta, tier, reuse = [], photos = [], aiAssisted = true, sponsored = false }) {
  const parts = [];
  parts.push(`Source paper: ${meta.title}.`);
  parts.push(`${meta.authors.join(', ')}, ${meta.institutions.join(' and ')}.`);
  parts.push(`arXiv:${meta.arxiv_id}${meta.version}, ${meta.date_label}.`);
  if (!meta.peer_reviewed) parts.push('Preprint, not peer reviewed.');
  parts.push(`Paper license: ${meta.license_label}.`);
  if (tier === 'FULL_REUSE_WITH_CREDIT' && reuse.length) {
    parts.push(`This story reuses ${reuse.length} short quote${reuse.length > 1 ? 's' : ''} from the paper under ${meta.license_label}, shown in quotation marks with credit. It reuses none of the paper's figures.`);
  } else {
    parts.push('This story reuses none of its text or figures.');
  }
  parts.push(photos.length ? 'Photo credits: ' + photos.map((p) => `${p.author}, ${p.source}, ${p.license}`).join('; ') + '.' : 'No photos used.');
  parts.push(`Not affiliated with or endorsed by the authors or ${meta.institutions.join(' or ')}.`);
  if (aiAssisted) parts.push('AI-assisted: drafted by an AI model, numbers re-checked by a second automated step, approved by a Vizmaya editor.');
  if (sponsored) parts.push('Paid Advertisement: Vizmaya was paid to make this story. The paid party had no say in the score.');
  return parts.join(' ');
}

// ---- per-card sources: "Source: paper, Table 13" and "computed: a / b" ----
function sourceLine(card, draft) {
  const ids = new Set();
  (card.sentences || []).forEach((s) => (s.claims || []).forEach((c) => ids.add(c)));
  ((card.visual && card.visual.items) || []).forEach((it) => it.claim && ids.add(it.claim));
  const spans = [];
  const comps = [];
  for (const id of ids) {
    const c = draft.claims[id];
    if (!c) continue;
    if (c.kind === 'computed') {
      const expr = c.formula.replace(/[a-z]\w*/gi, (k) => c.inputs[k].value);
      comps.push(`<span class="computed">computed: ${esc(c.formula.replace(/\s+/g, ''))} with ${Object.entries(c.inputs).map(([k, x]) => `${k} = ${esc(x.value)}`).join(', ')} gives ${esc(c.display)}${c.decimals === 0 ? '' : ''} (${esc(expr)})</span>`);
      for (const x of Object.values(c.inputs)) spans.push(LOC(x.locator));
    } else spans.push(LOC(c.locator));
  }
  const uniq = [...new Set(spans)];
  const src = uniq.length ? `<span>Source: paper, ${uniq.map(esc).join('; ')}</span>` : '';
  return src || comps.length ? `<p class="src">${src}${comps.length ? '<br>' + comps.join('<br>') : ''}</p>` : '';
}

function cardHtml(card, draft, story, idx, total) {
  const tag = story.sponsored ? `<span class="adtag">Paid Advertisement</span>` : '';
  const kind = { hook: 'Hook', question: 'Question', point: '', chart: 'Chart', timeline: 'Timeline', contested: 'Contested', climax: 'The big one', payoff: 'Payoff', anim: 'Animation' }[card.type] || '';
  const sents = (card.sentences || []).map((s) => `<p class="s">${esc(s.t)}</p>`).join('');
  let visual = '';
  if (card.visual) {
    const uid = `${story.slug}-${card.id}`.replace(/[^a-z0-9-]/gi, '');
    const inner = card.visual.kind === 'bars' ? bars(card.visual, uid) : card.visual.kind === 'anim' ? anim(card.visual.name, uid) : '';
    visual = `<figure class="vis">${inner}<figcaption><strong>${esc(card.visual.title || '')}</strong> ${esc(card.visual.caption || '')}<span class="sr"> Description: ${esc(card.visual.alt)}</span></figcaption></figure>`;
  }
  const quote = card.quote
    ? `<blockquote class="q"><p>"${esc(card.quote.text)}"</p><footer>${esc(story.meta.authors[0])} and co-authors, arXiv:${esc(story.meta.arxiv_id)}${esc(story.meta.version)}, ${esc(story.meta.license_label)}</footer></blockquote>`
    : '';
  const contested = card.contested
    ? `<div class="contested" role="note"><strong>Contested.</strong> ${esc(card.contested.explain)}</div>`
    : '';
  return `<section class="card card-${card.type}" id="${card.id}" aria-labelledby="${card.id}-h" data-card="${idx}">
  ${tag}<div class="kicker">${kind ? esc(kind) + ' · ' : ''}${idx + 1} of ${total}</div>
  <h2 id="${card.id}-h">${esc(card.headline)}</h2>
  ${sents}${quote}${visual}${contested}${sourceLine(card, draft)}
</section>`;
}

function scoreChip(score, big = false) {
  if (!score) return '';
  const cls = score.status === 'scored' ? 'chip chip-score' : 'chip chip-new';
  const label = score.status === 'scored' ? `Score ${score.score}/100` : score.headline;
  return `<span class="${cls}${big ? ' big' : ''}" title="Automated opinion. Research signal. Not investment advice.">${esc(label)} <small>${esc(score.confidence)} confidence · Automated opinion</small></span>`;
}

function scorePanel(score) {
  const rows = score.components.map((c) => `<tr class="${c.status}"><td>${esc(c.title)}</td><td>${c.status === 'ok' ? `${c.points} / ${c.max}` : `not counted (max ${c.max})`}</td><td>${esc(c.note)}<br><code>${esc(c.formula)}</code>${c.source ? `<br><small>Source: ${esc(c.source.name || '')}${c.source.url ? ` · <a href="${esc(c.source.url)}" rel="nofollow noopener">link</a>` : ''}${c.source.line ? ` · ${esc(c.source.line)}` : ''}${c.source.locator ? ` · ${esc(LOC(c.source.locator))}` : ''}${c.source.fetched_at ? ` · fetched ${esc(c.source.fetched_at)}` : ''}</small>` : ''}</td></tr>`).join('');
  return `<details class="scorebox" ${score.status === 'scored' ? '' : 'open'}><summary>How this score works (rules v${esc(score.rules_version)})</summary>
<p><strong>${esc(score.label)}</strong></p>
<p>${esc(score.explain)}</p>
<table><thead><tr><th>Signal</th><th>Points</th><th>How, and where it came from</th></tr></thead><tbody>${rows}</tbody></table>
<p><code>${esc(score.formula)}</code></p>
<p>Only outside signals count. We never use anything the authors can edit. Nobody can pay to change a score, and sponsored stories use the same rules. We score the work, never the person. <a href="/about/#score">Read the full rules</a>.</p>
<p><button type="button" class="linkbtn" data-report="dispute">Dispute this score</button> · reviewed within 48 hours (assumption)</p></details>`;
}

function flagBanners(flags, story) {
  const out = [];
  if (!story.meta.peer_reviewed) out.push(`<div class="banner warn" role="note"><strong>Preprint.</strong> This paper is not peer reviewed yet.</div>`);
  if (flags.includes('based_on_old_version')) out.push(`<div class="banner warn" role="note"><strong>Based on ${esc(story.meta.version)}.</strong> A newer version (${esc(story.latest_version || 'newer')}) exists and has not been reviewed by us yet.</div>`);
  if (flags.includes('quality_warning')) out.push(`<div class="banner warn" role="note"><strong>Quality warning.</strong> This paper is hard to read automatically. Treat details with care.</div>`);
  if (flags.includes('score_disputed')) out.push(`<div class="banner warn" role="note"><strong>Score under dispute.</strong> A reader or author asked us to review this score.</div>`);
  return out.join('');
}

function storyPage(story) {
  const { draft, meta, score, flags } = story;
  const total = draft.cards.length;
  const url = `${SITE}/s/${story.slug}/`;
  const credit = creditBlock({ meta, tier: story.tier, reuse: draft.reuse, photos: meta.photos || [], aiAssisted: !!story.ai_assisted, sponsored: !!story.sponsored });
  const reading = draft.cards.flatMap((c) => (c.sentences || []).map((s) => s.t)).join(' ');
  const underReview = story.status === 'under_review';
  const ld = {
    '@context': 'https://schema.org', '@type': 'Article', headline: draft.title, description: draft.deck,
    datePublished: story.published_at, publisher: { '@type': 'Organization', name: PUBLISHER },
    isBasedOn: { '@type': 'ScholarlyArticle', name: meta.title, url: `https://arxiv.org/abs/${meta.arxiv_id}${meta.version}`, license: meta.license_url },
    creativeWorkStatus: 'AI-assisted',
    additionalProperty: [{ '@type': 'PropertyValue', name: 'digitalSourceType', value: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' }],
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(draft.title)} · Research Feed</title>
<meta name="description" content="${esc(draft.deck)}">
<link rel="canonical" href="${esc(url)}">
<meta name="rf:ai-assisted" content="true"><meta name="rf:score-rules" content="${esc(score ? score.rules_version : 'none')}">
<meta name="rf:license" content="${esc(meta.license_code)}"><meta name="rf:based-on" content="arXiv:${esc(meta.arxiv_id)}${esc(meta.version)}">
<meta property="og:title" content="${esc(draft.title)}"><meta property="og:description" content="${esc(draft.deck)}${score && score.status === 'scored' ? ' Score ' + score.score + '/100 (automated opinion).' : ''}">
<meta property="og:type" content="article"><meta property="og:url" content="${esc(url)}">
<link rel="stylesheet" href="/assets/app.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head><body class="story" data-slug="${esc(story.slug)}" data-state="${esc(story.status)}">
<a class="skip" href="#k1">Skip to story</a>
<div class="progress" aria-hidden="true"><i></i></div>
<header class="top"><a href="/" class="back">← Feed</a><span class="brand">Research Feed</span>
<div class="actions"><button type="button" id="share">Share</button><button type="button" id="save" aria-pressed="false">Save</button><button type="button" id="listen" aria-pressed="false">Listen</button></div></header>
<div id="status-banner" ${underReview ? '' : 'hidden'} class="banner bad" role="status">${underReview ? '<strong>Under review.</strong> A reader reported a possible error. We are checking it.' : ''}</div>
<main id="story" tabindex="-1">
<section class="cover">
  <p class="field">${esc(story.field)}${story.sponsored ? ' · <span class="adtag inline">Paid Advertisement</span>' : ''}</p>
  <h1>${esc(draft.title)}</h1><p class="deck">${esc(draft.deck)}</p>
  <p class="badges">${scoreChip(score, true)} <span class="chip">AI-assisted</span> ${!meta.peer_reviewed ? '<span class="chip chip-warn">Preprint</span>' : ''} <span class="chip">License: ${esc(meta.license_label)}</span> ${flags.includes('based_on_old_version') ? `<span class="chip chip-warn">Based on ${esc(meta.version)}</span>` : ''}</p>
  ${flagBanners(flags, story)}
  <p class="hint">Scroll down. One idea per card.</p>
</section>
${draft.cards.map((c, i) => cardHtml(c, draft, story, i, total)).join('\n')}
<section class="card card-end" id="end">
  <div class="kicker">End</div><h2>About the score</h2>
  ${score ? scoreChip(score) + scorePanel(score) : ''}
  <h2>Credits</h2><p class="credit" id="credit">${esc(credit)}</p>
  <p class="actionrow"><button type="button" data-report="error">Report an error</button> <button type="button" data-report="takedown">I am an author: remove this story</button></p>
  <p class="fine">We fix reported errors within 24 hours. A reply of "remove" takes the story down the same day. Facts are rebuilt from the paper's numbers. This is research, not investment advice and not an offer of any kind.</p>
</section>
</main>
<div id="caption" class="caption" aria-live="polite" hidden></div>
<dialog id="report"><form method="dialog" id="reportform"><h3 id="reporttitle">Report</h3>
<label>What is wrong?<textarea name="body" required rows="4"></textarea></label>
<label>Your email (so we can reply)<input type="email" name="contact" required></label>
<menu><button value="cancel" formnovalidate>Cancel</button><button value="send" class="primary">Send</button></menu><p id="reportmsg" role="status"></p></form></dialog>
<script id="story-data" type="application/json">${JSON.stringify({ slug: story.slug, title: draft.title, text: reading, url })}</script>
<script src="/assets/story.js" defer></script>
</body></html>`;
}

function feedCard(s) {
  const sc = s.score;
  return `<article class="fcard" data-slug="${esc(s.slug)}" data-field="${esc(s.field)}" data-score="${sc && sc.status === 'scored' ? sc.score : ''}" data-license="${esc(s.meta.license_code)}" data-date="${esc(s.published_at.slice(0, 10))}" data-inst="${esc(s.meta.institutions.join('|'))}">
  <p class="field">${esc(s.field)} · ${esc(s.published_at.slice(0, 10))}</p>
  <h2><a href="/s/${esc(s.slug)}/">${esc(s.draft.title)}</a></h2><p>${esc(s.draft.deck)}</p>
  <p class="badges">${scoreChip(sc)} <span class="chip">AI-assisted</span> ${!s.meta.peer_reviewed ? '<span class="chip chip-warn">Preprint</span>' : ''} ${s.sponsored ? '<span class="adtag inline">Paid Advertisement</span>' : ''} ${s.flags.includes('based_on_old_version') ? `<span class="chip chip-warn">Based on ${esc(s.meta.version)}</span>` : ''}</p>
  <p class="row"><a class="btn" href="/s/${esc(s.slug)}/">Read</a><button type="button" class="save" data-save="${esc(s.slug)}" aria-pressed="false">Save</button><button type="button" class="follow" data-follow="${esc(s.field)}">Follow ${esc(s.field)}</button></p>
</article>`;
}

function feedPage(stories, pick) {
  const fields = [...new Set(stories.map((s) => s.field))].sort();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Research Feed · deep-tech research, in plain English</title>
<meta name="description" content="Short, scrollable stories about new research. Free to read. Each has an automated score built from outside signals.">
<link rel="stylesheet" href="/assets/app.css"></head><body class="feed">
<header class="top"><span class="brand">Research Feed</span><nav><a href="/digest/">Weekly top 5</a> <a href="/about/">About &amp; rules</a> <button type="button" id="pro-open">Pro</button></nav></header>
<main>
<section class="hero"><h1>Research, one idea at a time.</h1><p>Free to read. No login. Every number has a source line. Every story has a score from outside signals.</p>
<p id="streak" class="streak" aria-live="polite"></p></section>
${pick ? `<section class="pick" aria-label="Daily pick"><p class="field">Today's pick</p><h2><a href="/s/${esc(pick.slug)}/">${esc(pick.draft.title)}</a></h2><p>${esc(pick.draft.deck)}</p></section>` : ''}
<section class="filters" aria-label="Browse by field"><button type="button" class="fbtn on" data-field="">All</button>${fields.map((f) => `<button type="button" class="fbtn" data-field="${esc(f)}">${esc(f)}</button>`).join('')}
<span id="profilters" hidden>
 <label>Min score <input type="number" id="f-min" min="0" max="100" value="0"></label>
 <label>License <select id="f-lic"><option value="">any</option><option>CC_BY</option><option>CC_BY_NC_ND</option><option>CC_BY_SA</option></select></label>
 <label>Since <input type="date" id="f-since"></label>
 <label>Institution <input type="text" id="f-inst" placeholder="contains"></label>
 <button type="button" id="export">Export saves (CSV)</button></span></section>
<section id="list">${stories.map(feedCard).join('\n') || '<p>No stories yet.</p>'}</section>
<section id="saved-box" hidden><h2>Saved (<span id="saved-n">0</span> of 20)</h2><ul id="saved"></ul><p class="fine">Saved in this browser. Pro syncs saves across devices.</p></section>
</main>
<footer class="foot"><p>Research Feed is a working title. Published by Vizmaya. Stories are AI-assisted and edited. Scores are an automated opinion, not investment advice. Not legal advice in internal docs. <a href="/about/">Privacy, terms and takedown</a></p></footer>
<dialog id="pro"><div id="pro-body"></div><button type="button" id="pro-close">Close</button></dialog>
<script id="index-data" type="application/json">${JSON.stringify(stories.map((s) => ({ slug: s.slug, title: s.draft.title, field: s.field, score: s.score && s.score.status === 'scored' ? s.score.score : null, date: s.published_at.slice(0, 10), license: s.meta.license_code, institutions: s.meta.institutions })))}</script>
<script src="/assets/app.js" defer></script></body></html>`;
}

function digestPage(top) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weekly top 5 · Research Feed</title><link rel="stylesheet" href="/assets/app.css"></head><body class="feed"><header class="top"><a href="/" class="back">← Feed</a><span class="brand">Weekly top 5</span></header><main>
<p>Rule: scored stories first, highest score first. Stories too new to score come after, newest first. No one can pay to appear here.</p>
<ol>${top.map((s) => `<li><a href="/s/${esc(s.slug)}/">${esc(s.draft.title)}</a> ${scoreChip(s.score)}</li>`).join('')}</ol></main></body></html>`;
}

function tombstone(slug, title, state) {
  const msg = state === 'pulled' ? 'This story was taken down.' : 'This story is not available.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(msg)} · Research Feed</title><link rel="stylesheet" href="/assets/app.css"></head><body class="feed"><header class="top"><a href="/" class="back">← Feed</a></header><main><h1>${esc(msg)}</h1><p>${esc(title)}</p><p>If you think this is a mistake, write to the grievance contact on the <a href="/about/">About page</a>.</p></main></body></html>`;
}

module.exports = { storyPage, feedPage, digestPage, tombstone, creditBlock, scoreChip, sourceLine, SITE };
