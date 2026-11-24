#!/usr/bin/env node
// Builds a "facts index" from extracted paper text.
// It keeps NUMBERS ONLY, keyed by table row or section. It never stores paper sentences.
// Why: (1) the checker needs a source that is independent of the drafting model,
//      (2) for CC BY-NC-ND papers we must not republish the text.
// Usage: node tools/extract_facts.js <paper_text.md> <out.json> <arxivId> <version> <style:plain|md>
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

const [, , src, out, arxivId, version, style = 'md'] = process.argv;
if (!src || !out) {
  console.error('usage: extract_facts.js <text> <out.json> <arxivId> <version> <plain|md>');
  process.exit(2);
}
const text = fs.readFileSync(src, 'utf8');
const lines = text.split(/\r?\n/);

const NUM = /(?<![\d.])-?\d[\d,]*(?:\.\d+)?(?!\d)/g;
function nums(s) {
  const found = [];
  for (const m of s.matchAll(NUM)) {
    const v = m[0].replace(/,/g, '');
    if (v !== '' && !Number.isNaN(Number(v))) found.push(v);
  }
  return found;
}

const headingRe =
  style === 'md'
    ? /^#{2,4}\s+((?:[A-Z]|\d+)(?:\.\d+)*)\s+\S/
    : /^(\d+(?:\.\d+)*)\.?\s+[A-Z][A-Za-z\-:, &]{3,70}$/;
const captionRe = /^\**\s*((?:Supplementary )?Table \d+)\b/;
const targetRe = /^\*\*Target:\s*([A-Za-z]+)/;

function captionNear(i) {
  for (let k = i; k >= Math.max(0, i - 14); k--) {
    const t = lines[k].trim();
    const tm = t.match(targetRe);
    if (tm) return `Figure 4, target ${tm[1]}`;
    const m = t.match(captionRe);
    if (m) return m[1];
  }
  for (let k = i; k <= Math.min(lines.length - 1, i + 6); k++) {
    const m = lines[k].trim().match(captionRe);
    if (m) return m[1];
  }
  return null;
}

const locators = {};
function loc(name, kind) {
  if (!locators[name]) locators[name] = { kind, rows: [], nums: [] };
  return locators[name];
}

let section = 'Front matter';
let tableLabel = null;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const t = line.trim();
  const h = t.match(headingRe);
  if (h && !t.startsWith('|')) {
    section = `Sec. ${h[1]}`;
    loc(section, 'prose');
    continue;
  }
  if (t.startsWith('|')) {
    if (/^\|\s*-+/.test(t)) continue;
    if (tableLabel === null || lines[i - 1]?.trim().startsWith('|') === false) {
      tableLabel = captionNear(i) || `Table in ${section}`;
    }
    const cells = t.split('|').slice(1, -1).map((c) => c.trim());
    let k = 0;
    const lead = [];
    while (k < cells.length && !/^[-+]?[\d.,]+%?(\s*\\?±.*)?$/.test(cells[k].replace(/[*_]/g, ''))) lead.push(cells[k++]);
    const label = lead.filter(Boolean).slice(-2).join(' / ');
    const rowNums = nums(cells.slice(k).join(' ; '));
    if (rowNums.length) {
      const L = loc(tableLabel, 'table');
      L.rows.push({ label: label.replace(/\*+/g, ''), nums: rowNums });
      L.nums.push(...rowNums);
    }
    continue;
  }
  tableLabel = null;
  if (t.includes('\\') || t.startsWith('arXiv:')) continue; // skip LaTeX debris and stamps
  const n = nums(t);
  if (n.length) {
    const L = loc(section, 'prose');
    L.nums.push(...n);
  }
}
for (const L of Object.values(locators)) L.nums = [...new Set(L.nums)];

const doc = {
  arxiv_id: arxivId,
  version,
  source_sha256: crypto.createHash('sha256').update(text).digest('hex'),
  extracted_at: new Date().toISOString(),
  note: 'Numbers only. No paper text is stored. Locators are table captions or section numbers because the PDF parser gave no page numbers.',
  locators,
};
fs.writeFileSync(out, JSON.stringify(doc, null, 1));
console.log(`${arxivId}${version}: ${Object.keys(locators).length} locators -> ${out}`);
