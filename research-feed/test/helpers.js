'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open, ROOT } = require('../src/db');
const P = require('../src/pipeline');

const FIXED = () => new Date('2026-11-10T12:00:00Z');
const tmpOut = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-')); process.env.RF_OUT_DIR = d; return d; };
const snapshot = (id, v) => fs.readFileSync(path.join(ROOT, `data/abs/${id}${v}.txt`), 'utf8');
const A = { id: '2603.27130', v: 'v2', link: 'https://arxiv.org/abs/2603.27130v2' };
const B = { id: '2611.08483', v: 'v1', link: 'https://arxiv.org/abs/2611.08483v1' };

// ingest -> draft -> check -> approve (and optionally publish) for one demo paper
async function through(db, paper, { publish = false, probe } = {}) {
  const ing = P.ingest(db, { link: paper.link, pageText: snapshot(paper.id, paper.v), clock: FIXED });
  const d = await P.draftStory(db, { arxivId: paper.id, version: paper.v, flags: ing.flags, clock: FIXED });
  const c = P.checkStory(db, d.id, { clock: FIXED });
  if (!c.ok) throw new Error('checker red: ' + c.report.errors.join('; '));
  P.approve(db, d.id, 'test-editor', { clock: FIXED });
  if (publish) P.publish(db, d.id, { statusProbe: probe, clock: FIXED });
  return d;
}
module.exports = { open, FIXED, tmpOut, snapshot, A, B, through, P, ROOT };
