'use strict';
// Paper status probes. Used on publish, on a schedule, and behind the status files that every story page reads on load.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./db');
const { parsePageState } = require('./license');

// Offline: reads data/live_status.json. Edit it to simulate a withdrawal or a v2 (the tests do this).
function fileProbe(file = path.join(ROOT, 'data', 'live_status.json')) {
  return (arxivId) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8'))[arxivId] || { withdrawn: false }; } catch { return { withdrawn: false }; }
  };
}

// Online: reads the arXiv abstract page. Sync callers use the async form below.
async function liveFetch(arxivId) {
  const res = await fetch(`https://arxiv.org/abs/${arxivId}`, { headers: { 'user-agent': 'ResearchFeedBot/0.1 (status check)' } });
  if (!res.ok) throw new Error(`arXiv ${res.status}`);
  const text = await res.text();
  const st = parsePageState(text, 'v1');
  return { withdrawn: st.withdrawn, latestVersion: st.latestVersion, pageText: text };
}

module.exports = { fileProbe, liveFetch };
