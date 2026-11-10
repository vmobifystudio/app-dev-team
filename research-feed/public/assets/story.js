/* Story page behaviour. The page reads fine without this file. */
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('story-data').textContent);
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // 1. Status check on every page load: withdrawn, pulled, under review.
  fetch('/status/' + data.slug + '.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
    var b = document.getElementById('status-banner');
    if (s.state === 'pulled' || s.state === 'withdrawn') {
      document.getElementById('story').innerHTML = '<section class="card"><h2>This story was taken down.</h2><p>' + (s.reason || '') + '</p></section>';
      b.hidden = true;
    } else if (s.state === 'under_review') {
      b.hidden = false; b.innerHTML = '<strong>Under review.</strong> A reader reported a possible error. We are checking it.';
    } else if (s.state === 'published') { b.hidden = true; }
  }).catch(function () { /* offline: show the page as built */ });

  // 2. Progress bar
  var bar = document.querySelector('.progress i');
  function prog() { var h = document.documentElement; bar.style.width = (100 * h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)) + '%'; }
  addEventListener('scroll', prog, { passive: true }); prog();

  // 3. Share: no paywall, just the link
  document.getElementById('share').addEventListener('click', function () {
    if (navigator.share) { navigator.share({ title: data.title, url: data.url }).catch(function () {}); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(data.url) : Promise.reject()).then(function () { alert('Link copied'); }, function () { prompt('Copy this link', data.url); });
  });

  // 4. Save (free: up to 20 in this browser)
  var saveBtn = document.getElementById('save');
  function saves() { return store.get('rf.saves', []); }
  function paintSave() { saveBtn.setAttribute('aria-pressed', saves().indexOf(data.slug) >= 0 ? 'true' : 'false'); }
  saveBtn.addEventListener('click', function () {
    var s = saves(), i = s.indexOf(data.slug);
    if (i >= 0) s.splice(i, 1);
    else { if (s.length >= 20 && !store.get('rf.token', null)) { alert('Free saves hold 20 stories in this browser. Remove one first.'); return; } s.push(data.slug); }
    store.set('rf.saves', s); paintSave();
  }); paintSave();

  // 5. Audio with captions. Free: 1 story per day. Pro: unlimited. (Browser voice here; production uses pre-rendered audio.)
  var listen = document.getElementById('listen'), cap = document.getElementById('caption'), playing = false;
  function today() { return new Date().toISOString().slice(0, 10); }
  listen.addEventListener('click', function () {
    if (!('speechSynthesis' in window)) { alert('Audio is not supported in this browser.'); return; }
    if (playing) { speechSynthesis.cancel(); playing = false; listen.setAttribute('aria-pressed', 'false'); cap.hidden = true; return; }
    var pro = !!store.get('rf.token', null), used = store.get('rf.audio', { day: '', slugs: [] });
    if (used.day !== today()) used = { day: today(), slugs: [] };
    if (!pro && used.slugs.indexOf(data.slug) < 0 && used.slugs.length >= 1) { alert('Free audio is 1 story a day. You have used today\'s.'); return; }
    if (used.slugs.indexOf(data.slug) < 0) used.slugs.push(data.slug); store.set('rf.audio', used);
    var sentences = data.text.match(/[^.!?]+[.!?]+/g) || [data.text], i = 0;
    playing = true; listen.setAttribute('aria-pressed', 'true'); cap.hidden = false;
    (function next() {
      if (!playing || i >= sentences.length) { playing = false; cap.hidden = true; listen.setAttribute('aria-pressed', 'false'); return; }
      var u = new SpeechSynthesisUtterance(sentences[i].trim()); cap.textContent = sentences[i].trim(); i++; u.onend = next; speechSynthesis.speak(u);
    })();
  });

  // 6. Report forms: error, dispute, takedown
  var dlg = document.getElementById('report'), kind = 'error';
  var titles = { error: 'Report an error', dispute: 'Dispute this score', takedown: 'Author: remove this story' };
  document.querySelectorAll('[data-report]').forEach(function (b) {
    b.addEventListener('click', function () { kind = b.getAttribute('data-report'); document.getElementById('reporttitle').textContent = titles[kind]; document.getElementById('reportmsg').textContent = ''; dlg.showModal(); });
  });
  document.getElementById('reportform').addEventListener('submit', function (e) {
    var submitter = e.submitter && e.submitter.value; if (submitter !== 'send') return;
    e.preventDefault();
    var f = e.target;
    fetch('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: data.slug, kind: kind, body: f.body.value, contact: f.contact.value }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        document.getElementById('reportmsg').textContent = j.message || j.error || 'Sent.';
        if (j.ok && (kind === 'error' || kind === 'takedown')) setTimeout(function () { location.reload(); }, 1200);
      });
  });
})();
