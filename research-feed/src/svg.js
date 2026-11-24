'use strict';
// Charts and animations. Charts are REBUILT from the paper's numbers; they never copy a paper figure.
// Every visual has role="img", a <title>, and alt text. Animations stop under prefers-reduced-motion.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const W = 360;
const BAR_MAX = 230;

function bars(v, uid) {
  const items = v.items || [];
  const series = v.series || [];
  const paired = series.length > 1;
  const nums = items.flatMap((it) => (it.flag ? [] : it.values.map(Number)));
  const gmax = Math.max(...nums, 1e-9);
  const rowH = paired ? 62 : 36;
  const top = paired ? 30 : 8;
  const H = top + items.length * rowH + 8;
  let y = top;
  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-labelledby="${uid}t" class="chart"><title id="${uid}t">${esc(v.alt)}</title>`;
  out += `<defs><pattern id="${uid}h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="currentColor" opacity=".35"/></pattern></defs>`;
  if (paired) {
    series.forEach((s, i) => {
      out += `<rect x="${8 + i * 120}" y="6" width="12" height="12" class="s${i}"/><text x="${24 + i * 120}" y="16" class="lbl">${esc(s)}</text>`;
    });
  }
  for (const it of items) {
    const vals = it.values.map(Number);
    const max = paired ? Math.max(...vals, 1e-9) : gmax;
    out += `<text x="8" y="${y + 12}" class="lbl">${esc(it.label)}</text>`;
    vals.forEach((val, i) => {
      const by = y + 18 + i * 18;
      if (it.flag === 'not_reached') {
        out += `<rect x="8" y="${by}" width="${BAR_MAX}" height="14" fill="url(#${uid}h)" stroke="currentColor" stroke-opacity=".4"/><text x="${BAR_MAX + 14}" y="${by + 11}" class="val">not reached</text>`;
      } else {
        const w = Math.max(2, (val / max) * BAR_MAX);
        out += `<rect x="8" y="${by}" width="${w.toFixed(1)}" height="14" class="s${paired ? i : 0}" rx="2"/><text x="${(8 + w + 6).toFixed(1)}" y="${by + 11}" class="val">${esc(it.values[i])}</text>`;
      }
    });
    y += rowH;
  }
  return out + '</svg>';
}

// Light animations that explain an idea from first principles. No numbers inside, so nothing here needs a source.
function anim(name, uid) {
  if (name === 'ripple-after-commit') {
    return `<svg viewBox="0 0 360 200" width="100%" role="img" aria-labelledby="${uid}t" class="anim"><title id="${uid}t">A stone drops into water and rings spread outward.</title>
<line x1="0" y1="110" x2="360" y2="110" class="wave"/>
<circle cx="180" cy="110" r="6" class="stone"/>
<ellipse cx="180" cy="110" rx="10" ry="4" class="ring r1"/><ellipse cx="180" cy="110" rx="10" ry="4" class="ring r2"/><ellipse cx="180" cy="110" rx="10" ry="4" class="ring r3"/>
<text x="180" y="190" text-anchor="middle" class="lbl">a save, and the edits that follow</text></svg>`;
  }
  if (name === 'swarm-vs-text') {
    const dots = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      const cx = 270 + Math.cos(a) * 58;
      const cy = 90 + Math.sin(a) * 52;
      return `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="270" y2="90" class="link" style="animation-delay:${(i * 0.18).toFixed(2)}s"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" class="agent" style="animation-delay:${(i * 0.18).toFixed(2)}s"/>`;
    }).join('');
    return `<svg viewBox="0 0 360 200" width="100%" role="img" aria-labelledby="${uid}t" class="anim"><title id="${uid}t">Left: one thinker fills a line of text slowly. Right: many dots pulse together and send links to a center dot.</title>
<g><circle cx="50" cy="60" r="7" class="writer"/><rect x="66" y="56" width="0" height="8" class="textline l1"/><rect x="66" y="76" width="0" height="8" class="textline l2"/><rect x="66" y="96" width="0" height="8" class="textline l3"/><text x="90" y="190" text-anchor="middle" class="lbl">writes every step</text></g>
<line x1="180" y1="20" x2="180" y2="170" class="divider"/>
<g>${dots}<circle cx="270" cy="90" r="9" class="hub"/><text x="270" y="190" text-anchor="middle" class="lbl">thinks together</text></g></svg>`;
  }
  return `<svg viewBox="0 0 360 60" width="100%" role="img"><title>Animation not found</title></svg>`;
}

module.exports = { bars, anim, esc };
