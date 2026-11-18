/* Pekingese Standard Atlas — desktop add-ons.
   Adds, without touching the original app code, texts, photos or overlays:
   1) bilingual full-text search over all FCI/AKC/KC clauses,
   2) deep links  pekingese-atlas://<standard>/<section-slug>  (+ #/... hash form)
      with per-clause "copy link" buttons,
   3) a local-only "show results log" (その日のショー結果) stored on this PC only.
   The pure helpers are exported for Node-based tests. */
(function () {
  'use strict';

  var INDEX = (typeof window !== 'undefined' && window.ATLAS_SEARCH_INDEX) || { entries: [], stdNames: {} };
  var STDS = ['fci', 'akc', 'kc'];

  /* ================= pure helpers ================= */

  function parseAtlasAddress(input) {
    if (!input || typeof input !== 'string') return null;
    var s = input.trim();
    s = s.replace(/^pekingese-atlas:\/\//i, '');
    s = s.replace(/^#\/?/, '');
    s = s.replace(/^\//, '');
    var parts = s.split('/').filter(function (x) { return x.length > 0; });
    if (parts.length < 1 || parts.length > 2) return null;
    var std = parts[0].toLowerCase();
    if (STDS.indexOf(std) < 0) return null;
    var slug = parts.length === 2 ? decodeURIComponent(parts[1]) : '';
    return { std: std, slug: slug };
  }

  function resolveAddress(entries, input) {
    var a = parseAtlasAddress(input);
    if (!a) return null;
    if (!a.slug) return { type: 'std', std: a.std };
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].std === a.std && entries[i].slug === a.slug) {
        return { type: 'clause', std: a.std, entry: entries[i] };
      }
    }
    // part-level address: slug is a part id
    for (var j = 0; j < entries.length; j++) {
      if (entries[j].part === a.slug) return { type: 'part', std: a.std, part: a.slug };
    }
    return null;
  }

  function snippetFor(entry, query) {
    var q = query.toLowerCase();
    var fields = [
      { key: 'ja', text: entry.ja }, { key: 'en', text: entry.en },
      { key: 'orig', text: entry.orig }, { key: 'labelJa', text: entry.labelJa },
      { key: 'labelEn', text: entry.labelEn }
    ];
    for (var i = 0; i < fields.length; i++) {
      var t = fields[i].text || '';
      var pos = t.toLowerCase().indexOf(q);
      if (pos >= 0) {
        var start = Math.max(0, pos - 38);
        var end = Math.min(t.length, pos + query.length + 52);
        return {
          field: fields[i].key,
          before: (start > 0 ? '…' : '') + t.slice(start, pos),
          match: t.slice(pos, pos + query.length),
          after: t.slice(pos + query.length, end) + (end < t.length ? '…' : '')
        };
      }
    }
    return null;
  }

  function searchEntries(entries, query, limit) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var hay = (e.labelJa + '\n' + e.labelEn + '\n' + e.ja + '\n' + e.en + '\n' + e.orig + '\n' + e.partJa + '\n' + e.partEn).toLowerCase();
      if (hay.indexOf(q) >= 0) {
        out.push({ entry: e, snippet: snippetFor(e, String(query).trim()) });
        if (out.length >= (limit || 30)) break;
      }
    }
    return out;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseAtlasAddress: parseAtlasAddress,
      resolveAddress: resolveAddress,
      searchEntries: searchEntries,
      snippetFor: snippetFor
    };
  }
  if (typeof document === 'undefined') return;

  /* ================= DOM helpers / app state ================= */

  function $(sel) { return document.querySelector(sel); }
  function lang() { return document.body.getAttribute('data-lang') === 'en' ? 'en' : 'ja'; }
  function L(ja, en) { return lang() === 'en' ? en : ja; }
  function currentPart() {
    var b = document.querySelector('.part-tab[aria-selected="true"]');
    return b ? b.getAttribute('data-part') : 'overall';
  }
  function currentStd() {
    var b = document.querySelector('#stdSeg button[aria-pressed="true"]');
    return b ? b.getAttribute('data-std') : 'fci';
  }
  function entryFor(std, part, idx) {
    for (var i = 0; i < INDEX.entries.length; i++) {
      var e = INDEX.entries[i];
      if (e.std === std && e.part === part && e.idx === idx) return e;
    }
    return null;
  }
  function copyText(text, btn) {
    function done() {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = L('コピーしました ✓', 'Copied ✓');
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('copied'); }, 1500);
    }
    if (window.atlasDesktop && window.atlasDesktop.copyText) {
      window.atlasDesktop.copyText(text); done(); return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done); return;
    }
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta); done();
  }

  /* ================= navigation ================= */

  var suppressHash = false;
  function setHash(addr) {
    suppressHash = true;
    try { history.replaceState(null, '', '#/' + addr); } catch (e) { /* file:// */ }
    setTimeout(function () { suppressHash = false; }, 0);
  }

  function setStd(std) {
    if (currentStd() === std) return;
    var b = document.querySelector('#stdSeg button[data-std="' + std + '"]');
    if (b) b.click();
  }
  function setPart(part) {
    if (currentPart() === part) return;
    var b = document.querySelector('.part-tab[data-part="' + part + '"]');
    if (b) b.click();
  }

  function highlightMatch(root, query) {
    if (!query || !root) return;
    var q = query.toLowerCase();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var pos = node.nodeValue.toLowerCase().indexOf(q);
      if (pos >= 0) {
        var mark = document.createElement('mark');
        mark.className = 'atlas-mark';
        var mid = node.splitText(pos);
        mid.splitText(query.length);
        mark.textContent = mid.nodeValue;
        mid.parentNode.replaceChild(mark, mid);
        setTimeout(function () {
          document.querySelectorAll('.atlas-mark').forEach(function (m) {
            m.replaceWith(document.createTextNode(m.textContent));
          });
        }, 6000);
        return;
      }
    }
  }

  function navigateToEntry(entry, query) {
    setStd(entry.std);
    setPart(entry.part);
    var list = document.getElementById('stdList');
    if (!list) return;
    var li = list.children[entry.idx] || null;
    var expect = lang() === 'en' ? entry.labelEn : entry.labelJa;
    if (li && expect && li.textContent.indexOf(expect) < 0) {
      for (var i = 0; i < list.children.length; i++) {
        if (list.children[i].textContent.indexOf(expect) >= 0) { li = list.children[i]; break; }
      }
    }
    if (!li) return;
    var target = li.querySelector('blockquote') || li;
    li.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('atlas-flash');
    void target.offsetWidth;
    target.classList.add('atlas-flash');
    setTimeout(function () { target.classList.remove('atlas-flash'); }, 3000);
    highlightMatch(li, query);
    setHash(entry.std + '/' + entry.slug);
  }

  function applyAddress(input) {
    var r = resolveAddress(INDEX.entries, input);
    if (!r) return false;
    if (r.type === 'clause') { navigateToEntry(r.entry, null); return true; }
    if (r.type === 'part') {
      setStd(r.std); setPart(r.part);
      setHash(r.std + '/' + r.part);
      var tabs = document.getElementById('partTabs');
      if (tabs) tabs.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    }
    if (r.type === 'std') { setStd(r.std); setHash(r.std); return true; }
    return false;
  }

  /* ================= toolbar (search + records + view link) ================= */

  var toolbar = document.createElement('div');
  toolbar.className = 'atlas-toolbar';
  toolbar.innerHTML =
    '<div class="atlas-search-wrap">' +
      '<input type="search" class="atlas-search-input" id="atlasSearchInput" autocomplete="off" />' +
      '<div class="atlas-results" id="atlasResults" hidden></div>' +
    '</div>' +
    '<button type="button" class="atlas-btn" id="atlasViewLinkBtn"></button>' +
    '<button type="button" class="atlas-btn primary" id="atlasRecordsBtn"></button>';
  var langBar = document.querySelector('.lang-bar');
  if (langBar && langBar.parentNode) langBar.parentNode.insertBefore(toolbar, langBar.nextSibling);
  else document.body.insertBefore(toolbar, document.body.firstChild);

  var searchInput = document.getElementById('atlasSearchInput');
  var resultsBox = document.getElementById('atlasResults');
  var viewLinkBtn = document.getElementById('atlasViewLinkBtn');
  var recordsBtn = document.getElementById('atlasRecordsBtn');

  function refreshToolbarLabels() {
    searchInput.placeholder = L('標準文を検索（日本語・英語）…', 'Search the standards (Japanese / English)…');
    viewLinkBtn.textContent = L('🔗 表示中のリンクをコピー', '🔗 Copy link to this view');
    recordsBtn.textContent = L('🏆 ショー結果の記録', '🏆 Show Results Log');
  }
  refreshToolbarLabels();

  viewLinkBtn.addEventListener('click', function () {
    copyText('pekingese-atlas://' + currentStd() + '/' + currentPart(), viewLinkBtn);
  });

  var searchTimer = null;
  function closeResults() { resultsBox.hidden = true; resultsBox.innerHTML = ''; }
  function runSearch() {
    var q = searchInput.value.trim();
    if (!q) { closeResults(); return; }
    var results = searchEntries(INDEX.entries, q, 30);
    resultsBox.innerHTML = '';
    if (!results.length) {
      var none = document.createElement('div');
      none.className = 'r-none';
      none.textContent = L('見つかりませんでした', 'No matches found');
      resultsBox.appendChild(none);
    }
    results.forEach(function (r) {
      var e = r.entry;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'atlas-result';
      var head = document.createElement('span');
      head.className = 'r-head';
      var stdName = (INDEX.stdNames[e.std] || {})[lang()] || e.std.toUpperCase();
      head.textContent = stdName + ' ・ ' + (lang() === 'en' ? e.partEn : e.partJa) + ' ― ' + (lang() === 'en' ? e.labelEn : e.labelJa);
      b.appendChild(head);
      if (r.snippet) {
        var sn = document.createElement('span');
        sn.className = 'r-snippet';
        sn.appendChild(document.createTextNode(r.snippet.before));
        var mk = document.createElement('mark');
        mk.textContent = r.snippet.match;
        sn.appendChild(mk);
        sn.appendChild(document.createTextNode(r.snippet.after));
        b.appendChild(sn);
      }
      b.addEventListener('click', function () {
        closeResults();
        navigateToEntry(e, q);
      });
      resultsBox.appendChild(b);
    });
    resultsBox.hidden = false;
  }
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 120);
  });
  searchInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      var first = resultsBox.querySelector('.atlas-result');
      if (first) first.click();
    } else if (ev.key === 'Escape') { closeResults(); }
  });
  document.addEventListener('click', function (ev) {
    if (!toolbar.contains(ev.target)) closeResults();
  });

  /* ---- per-clause copy-link buttons (re-applied after every std render) ---- */
  function decorateClauses() {
    var list = document.getElementById('stdList');
    if (!list) return;
    var std = currentStd(), part = currentPart();
    for (var i = 0; i < list.children.length; i++) {
      (function (li, idx) {
        if (li.querySelector('.atlas-clause-tools')) return;
        var e = entryFor(std, part, idx);
        if (!e) return;
        var tools = document.createElement('div');
        tools.className = 'atlas-clause-tools';
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'atlas-copy-btn';
        btn.textContent = L('🔗 リンクをコピー', '🔗 Copy link');
        btn.addEventListener('click', function () { copyText(e.address, btn); });
        tools.appendChild(btn);
        li.appendChild(tools);
      })(list.children[i], i);
    }
  }
  var stdListEl = document.getElementById('stdList');
  if (stdListEl) {
    new MutationObserver(function () { decorateClauses(); })
      .observe(stdListEl, { childList: true });
  }
  decorateClauses();

  /* ---- language toggle: refresh add-on labels ---- */
  var langSeg = document.getElementById('langSeg');
  if (langSeg) langSeg.addEventListener('click', function () {
    setTimeout(function () { refreshToolbarLabels(); decorateClauses(); if (recordsOpen) renderRecords(); }, 60);
  });

  /* ---- routing: hash + Electron deep links ---- */
  window.addEventListener('hashchange', function () {
    if (suppressHash) return;
    if (location.hash && location.hash.length > 2) applyAddress(location.hash);
  });
  if (location.hash && location.hash.length > 2) {
    setTimeout(function () { applyAddress(location.hash); }, 80);
  }
  if (window.atlasDesktop && window.atlasDesktop.onDeepLink) {
    window.atlasDesktop.onDeepLink(function (url) { applyAddress(url); });
  }

  /* ================= show results log （その日のショー結果） ================= */

  var LS_KEY = 'atlas-show-results-v1';
  var records = [];
  var editingId = null;
  var recordsOpen = false;

  var adapter = {
    load: function () {
      if (window.atlasRecords && window.atlasRecords.load) return window.atlasRecords.load();
      try { return Promise.resolve(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); }
      catch (e) { return Promise.resolve([]); }
    },
    save: function (recs) {
      if (window.atlasRecords && window.atlasRecords.save) return window.atlasRecords.save(recs);
      try { localStorage.setItem(LS_KEY, JSON.stringify(recs)); } catch (e) { /* ignore */ }
      return Promise.resolve(true);
    }
  };

  var overlay = document.createElement('div');
  overlay.className = 'atlas-records-overlay';
  overlay.hidden = true;
  overlay.innerHTML =
    '<div class="atlas-records-panel" role="dialog" aria-modal="true">' +
      '<div class="atlas-records-head"><div>' +
        '<h2 id="rpTitle"></h2><p class="rp-sub" id="rpSub"></p>' +
      '</div><button type="button" class="atlas-btn" id="rpClose"></button></div>' +
      '<form class="atlas-form" id="rpForm">' +
        '<label><span data-l="date"></span><input type="date" id="rpDate" required /></label>' +
        '<label><span data-l="show"></span><input type="text" id="rpShow" /></label>' +
        '<label><span data-l="dog"></span><input type="text" id="rpDog" /></label>' +
        '<label class="span3"><span data-l="result"></span><input type="text" id="rpResult" /></label>' +
        '<label class="span3"><span data-l="memo"></span><textarea id="rpMemo" rows="2"></textarea></label>' +
      '</form>' +
      '<div class="atlas-form-actions">' +
        '<button type="button" class="atlas-btn primary" id="rpSave"></button>' +
        '<button type="button" class="atlas-btn" id="rpCancelEdit" hidden></button>' +
      '</div>' +
      '<div id="rpList"></div>' +
    '</div>';
  document.body.appendChild(overlay);

  var rpEls = {};
  ['rpTitle','rpSub','rpClose','rpForm','rpDate','rpShow','rpDog','rpResult','rpMemo','rpSave','rpCancelEdit','rpList']
    .forEach(function (id) { rpEls[id] = document.getElementById(id); });

  function todayStr() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtDate(ds) {
    if (!ds) return '';
    var p = ds.split('-');
    if (p.length !== 3) return ds;
    return lang() === 'en' ? (p[0] + '/' + p[1] + '/' + p[2]) : (p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日');
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderRecords() {
    rpEls.rpTitle.textContent = L('ショー結果の記録', 'Show Results Log');
    rpEls.rpSub.textContent = L('その日のドッグショーの結果を、日付ごとに残せます。記録はこのPCの中だけに保存され、外部に送信されることはありません。',
      'Keep each day’s dog-show results, grouped by date. Records are stored only on this PC and are never sent anywhere.');
    rpEls.rpClose.textContent = L('閉じる', 'Close');
    rpEls.rpSave.textContent = editingId ? L('更新する', 'Update') : L('追加する', 'Add record');
    rpEls.rpCancelEdit.hidden = !editingId;
    rpEls.rpCancelEdit.textContent = L('編集をやめる', 'Cancel editing');
    var labels = {
      date: L('日付', 'Date'), show: L('ショー名', 'Show name'), dog: L('犬名', 'Dog name'),
      result: L('結果（例：BOB、グループ2席）', 'Result (e.g. BOB, Group 2nd)'), memo: L('メモ', 'Memo')
    };
    overlay.querySelectorAll('[data-l]').forEach(function (el) {
      el.textContent = labels[el.getAttribute('data-l')] || '';
    });

    var groups = {};
    records.forEach(function (r) { (groups[r.date] = groups[r.date] || []).push(r); });
    var dates = Object.keys(groups).sort().reverse();
    if (!dates.length) {
      rpEls.rpList.innerHTML = '<p class="atlas-empty">' + esc(L('まだ記録がありません。上のフォームから最初の記録を追加してください。', 'No records yet. Add your first record with the form above.')) + '</p>';
      return;
    }
    var html = '';
    dates.forEach(function (ds) {
      var items = groups[ds].slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      html += '<div class="atlas-day"><h3>' + esc(fmtDate(ds)) + '</h3>';
      items.forEach(function (r) {
        html += '<div class="atlas-record">' +
          '<div class="rec-main">' +
            (r.show ? '<span class="rec-show">' + esc(r.show) + '</span>' : '') +
            (r.dog ? ' ― ' + esc(r.dog) : '') +
            (r.result ? ' ／ <span class="rec-result">' + esc(r.result) + '</span>' : '') +
          '</div>' +
          (r.memo ? '<div class="rec-memo">' + esc(r.memo) + '</div>' : '') +
          '<div class="rec-tools">' +
            '<button type="button" class="atlas-btn small" data-act="edit" data-id="' + esc(r.id) + '">' + esc(L('編集', 'Edit')) + '</button>' +
            '<button type="button" class="atlas-btn small" data-act="del" data-id="' + esc(r.id) + '">' + esc(L('削除', 'Delete')) + '</button>' +
          '</div></div>';
      });
      html += '</div>';
    });
    rpEls.rpList.innerHTML = html;
    rpEls.rpList.querySelectorAll('button[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        if (b.getAttribute('data-act') === 'edit') startEdit(id);
        else deleteRecord(id);
      });
    });
  }

  function persist() { return adapter.save(records); }
  function resetForm() {
    editingId = null;
    rpEls.rpDate.value = todayStr();
    rpEls.rpShow.value = ''; rpEls.rpDog.value = '';
    rpEls.rpResult.value = ''; rpEls.rpMemo.value = '';
    renderRecords();
  }
  function startEdit(id) {
    var r = records.find(function (x) { return x.id === id; });
    if (!r) return;
    editingId = id;
    rpEls.rpDate.value = r.date || todayStr();
    rpEls.rpShow.value = r.show || ''; rpEls.rpDog.value = r.dog || '';
    rpEls.rpResult.value = r.result || ''; rpEls.rpMemo.value = r.memo || '';
    renderRecords();
    rpEls.rpShow.focus();
  }
  function deleteRecord(id) {
    var r = records.find(function (x) { return x.id === id; });
    if (!r) return;
    var msg = L('この記録を削除しますか？', 'Delete this record?') + '\n' +
      (r.date || '') + ' ' + (r.show || '') + ' ' + (r.dog || '');
    if (!window.confirm(msg)) return;
    records = records.filter(function (x) { return x.id !== id; });
    if (editingId === id) editingId = null;
    persist().then(renderRecords);
  }

  rpEls.rpSave.addEventListener('click', function () {
    var rec = {
      date: rpEls.rpDate.value || todayStr(),
      show: rpEls.rpShow.value.trim(), dog: rpEls.rpDog.value.trim(),
      result: rpEls.rpResult.value.trim(), memo: rpEls.rpMemo.value.trim()
    };
    if (editingId) {
      var old = records.find(function (x) { return x.id === editingId; });
      if (old) { Object.assign(old, rec, { updatedAt: Date.now() }); }
    } else {
      rec.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      rec.createdAt = Date.now(); rec.updatedAt = rec.createdAt;
      records.push(rec);
    }
    persist().then(resetForm);
  });
  rpEls.rpCancelEdit.addEventListener('click', resetForm);
  rpEls.rpClose.addEventListener('click', closeRecords);
  overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closeRecords(); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && recordsOpen) closeRecords();
  });

  function openRecords() {
    recordsOpen = true;
    overlay.hidden = false;
    if (!rpEls.rpDate.value) rpEls.rpDate.value = todayStr();
    renderRecords();
  }
  function closeRecords() { recordsOpen = false; overlay.hidden = true; }
  recordsBtn.addEventListener('click', openRecords);

  adapter.load().then(function (recs) {
    records = Array.isArray(recs) ? recs : [];
    if (recordsOpen) renderRecords();
  }).catch(function () { records = []; });

  /* expose for tests / deep-link debugging */
  window.atlasDesktopAddons = {
    applyAddress: applyAddress,
    navigateToEntry: navigateToEntry,
    search: function (q) { return searchEntries(INDEX.entries, q, 30); },
    records: function () { return records.slice(); }
  };
})();
