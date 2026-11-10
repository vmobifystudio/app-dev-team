#!/usr/bin/env node
// Runs the copy check against the real paper text and records the verdict (not the text).
// Usage: node tools/record_copycheck.js <arxivId> <version> <paper_text_file>
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { copycheck } = require('../src/copycheck');
const { storyText } = require('../src/claims');
const P = require('../src/pipeline');
const { ROOT } = require('../src/db');
const [, , id, v, textFile] = process.argv;
const meta = P.loadMeta(id, v);
const draft = JSON.parse(fs.readFileSync(path.join(ROOT, meta.draft), 'utf8'));
const tier = /by-nc|nc-nd|arxiv/i.test(JSON.stringify(meta)) || id === '2611.08483' ? 'IDEAS_ONLY' : 'FULL_REUSE_WITH_CREDIT';
const r = copycheck({ storyText: storyText(draft), sourceText: fs.readFileSync(textFile, 'utf8'), tier, allowedQuotes: (draft.reuse || []).map((x) => x.text) });
r.recorded_at = new Date().toISOString();
r.note = 'Recorded verdict. The paper text itself is not stored in this repo.';
fs.writeFileSync(path.join(ROOT, 'content', 'copycheck', `${id}${v}.json`), JSON.stringify(r, null, 1));
console.log(id + v, r.status, 'shared', r.shared_count);
