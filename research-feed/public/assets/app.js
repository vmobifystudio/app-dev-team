/* Feed behaviour: field browse, saves (20, in the browser), streak, follow a field -> Pro prompt, Pro panel. */
(function () {
  'use strict';
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  var index = JSON.parse(document.getElementById('index-data').textContent);
  var token = function () { return store.get('rf.token', null); };
  function api(path, opts) {
    opts = opts || {}; opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    if (token()) opts.headers.authorization = 'Bearer ' + token();
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  // Streak: days in a row with a visit that opened the feed. Kept in this browser only.
  (function streak() {
    var d = new Date().toISOString().slice(0, 10), s = store.get('rf.streak', { last: '', n: 0 });
    if (s.last !== d) {
      var y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      s = { last: d, n: s.last === y ? s.n + 1 : 1 }; store.set('rf.streak', s);
    }
    document.getElementById('streak').textContent = s.n > 1 ? s.n + '-day reading streak' : 'Read one story today to start a streak.';
  })();

  // Field browse (free)
  var activeField = '';
  function applyFilters() {
    var min = Number((document.getElementById('f-min') || {}).value || 0), lic = (document.getElementById('f-lic') || {}).value || '',
      since = (document.getElementById('f-since') || {}).value || '', inst = ((document.getElementById('f-inst') || {}).value || '').toLowerCase();
    var pro = !document.getElementById('profilters').hidden;
    document.querySelectorAll('.fcard').forEach(function (c) {
      var ok = !activeField || c.dataset.field === activeField;
      if (pro) {
        if (min && Number(c.dataset.score || 0) < min) ok = false;
        if (lic && c.dataset.license !== lic) ok = false;
        if (since && c.dataset.date < since) ok = false;
        if (inst && c.dataset.inst.toLowerCase().indexOf(inst) < 0) ok = false;
      }
      c.hidden = !ok;
    });
  }
  document.querySelectorAll('.fbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.fbtn').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on');
      activeField = b.dataset.field; applyFilters();
    });
  });
  ['f-min', 'f-lic', 'f-since', 'f-inst'].forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener('input', applyFilters); });

  // Saves
  function saves() { return store.get('rf.saves', []); }
  function paintSaves() {
    var s = saves();
    document.querySelectorAll('.save').forEach(function (b) { b.setAttribute('aria-pressed', s.indexOf(b.dataset.save) >= 0 ? 'true' : 'false'); });
    var box = document.getElementById('saved-box'); box.hidden = !s.length;
    document.getElementById('saved-n').textContent = s.length;
    document.getElementById('saved').innerHTML = s.map(function (slug) { var it = index.filter(function (x) { return x.slug === slug; })[0]; return '<li><a href="/s/' + slug + '/">' + (it ? it.title.replace(/</g, '&lt;') : slug) + '</a></li>'; }).join('');
  }
  document.querySelectorAll('.save').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = saves(), i = s.indexOf(b.dataset.save);
      if (i >= 0) s.splice(i, 1);
      else {
        if (s.length >= 20 && !token()) { alert('Free saves hold 20 stories in this browser. Remove one first.'); return; }
        s.push(b.dataset.save);
        if (token()) api('/api/saves', { method: 'POST', body: JSON.stringify({ slug: b.dataset.save, list: 'Saved' }) });
      }
      store.set('rf.saves', s); paintSaves();
    });
  });
  paintSaves();

  // Follow a field. This is the ONLY place the Pro prompt appears.
  document.querySelectorAll('.follow').forEach(function (b) {
    b.addEventListener('click', function () {
      api('/api/follow', { method: 'POST', body: JSON.stringify({ field: b.dataset.follow }) }).then(function (j) {
        if (j.pro_prompt) openPro(b.dataset.follow);
        else if (j.ok) { b.textContent = 'Following ' + b.dataset.follow; b.setAttribute('aria-pressed', 'true'); }
      });
    });
  });

  // Pro dialog. Price and renewal date sit ABOVE the pay button. The consent box starts unticked.
  var dlg = document.getElementById('pro'), body = document.getElementById('pro-body');
  document.getElementById('pro-close').addEventListener('click', function () { dlg.close(); });
  document.getElementById('pro-open').addEventListener('click', function () { openPro(); });
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function openPro(field) {
    if (token()) {
      api('/api/me').then(function (me) {
        if (!me.ok) { store.set('rf.token', null); return openPro(field); }
        body.innerHTML = '<h3>Pro</h3><p>Signed in as ' + esc(me.name) + '. Plan: ' + esc(me.plan) + ' (' + esc(me.status) + '). Renews ' + esc(me.renews_at.slice(0, 10)) + '.</p>' +
          '<p><button type="button" id="cancel" class="primary">Cancel subscription</button> <button type="button" id="del">Delete my account</button></p><p id="pm" role="status"></p>';
        document.getElementById('cancel').onclick = function () { api('/api/pro/cancel', { method: 'POST' }).then(function (j) { document.getElementById('pm').textContent = j.ok ? 'Cancelled. You keep Pro until ' + me.renews_at.slice(0, 10) + '.' : j.error; }); };
        document.getElementById('del').onclick = function () { if (confirm('Delete your account and personal data?')) api('/api/account/delete', { method: 'POST' }).then(function () { store.set('rf.token', null); location.reload(); }); };
        dlg.showModal();
      }); return;
    }
    renderSignup(field, 'monthly'); dlg.showModal();
  }

  function renderSignup(field, plan) {
    api('/api/pro/terms?plan=' + plan).then(function (t) {
      body.innerHTML = '<h3>' + (field ? 'Get alerts for ' + esc(field) : 'Research Feed Pro') + '</h3>' +
        '<p>Reading stays free for everyone. Pro adds: alerts for followed fields within about 1 hour of publishing, saves synced across devices, filters, CSV export, audio for every story.</p>' +
        '<form id="signup"><label>Plan <select name="plan" id="plan"><option value="monthly"' + (plan === 'monthly' ? ' selected' : '') + '>$9 per month</option><option value="annual"' + (plan === 'annual' ? ' selected' : '') + '>$79 per year</option></select></label>' +
        '<label>Name <input type="text" name="name" required autocomplete="name"></label><label>Email <input type="email" name="email" required autocomplete="email"></label>' +
        '<label class="check"><input type="checkbox" name="age_18"> <span>' + esc(t.age_text) + '</span></label>' +
        '<label class="check"><input type="checkbox" name="consent_auto_renew"> <span>' + esc(t.consent_text) + '</span></label>' +
        '<div class="terms"><strong>' + esc(t.price_line) + '</strong><br>' + esc(t.cancel_line) + '</div>' +
        '<button class="primary" type="submit">Pay (sandbox, no real charge)</button> <p id="pm" role="status"></p></form>' +
        '<p class="fine">We ask for name and email only. 18+ only. Payments run through a merchant of record. This build uses a sandbox. <a href="/about/">Privacy and terms</a></p>';
      document.getElementById('plan').onchange = function (e) { renderSignup(field, e.target.value); };
      document.getElementById('signup').onsubmit = function (e) {
        e.preventDefault(); var f = e.target;
        api('/api/pro/signup', { method: 'POST', body: JSON.stringify({ plan: f.plan.value, name: f.name.value, email: f.email.value, age_18: f.age_18.checked, consent_auto_renew: f.consent_auto_renew.checked }) }).then(function (j) {
          if (!j.ok) { document.getElementById('pm').textContent = j.error; return; }
          store.set('rf.token', j.token);
          var p = field ? api('/api/follow', { method: 'POST', body: JSON.stringify({ field: field }) }) : Promise.resolve();
          p.then(function () { location.reload(); });
        });
      };
    });
  }

  // Pro-only controls appear only for Pro users. Free users see no teaser here.
  if (token()) {
    api('/api/me').then(function (me) {
      if (!me.ok) return;
      document.getElementById('profilters').hidden = false;
      document.getElementById('export').onclick = function () {
        fetch('/api/lists.csv', { headers: { authorization: 'Bearer ' + token() } }).then(function (r) { return r.blob(); }).then(function (b) {
          var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'research-feed-saves.csv'; a.click();
        });
      };
      (me.follows || []).forEach(function (f) { document.querySelectorAll('.follow').forEach(function (b) { if (b.dataset.follow === f) { b.textContent = 'Following ' + f; b.setAttribute('aria-pressed', 'true'); } }); });
    });
  }
})();
