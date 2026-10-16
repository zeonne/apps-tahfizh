/* Tahfizh Pro - jembatan API + cache offline.
   Menggantikan google.script.run saat aplikasi berjalan di GitHub Pages.
   Di Apps Script (google.script.run asli ada) file ini tidak melakukan apa-apa. */
(function () {
  if (window.google && window.google.script && window.google.script.run) return;

  var APP_URL = 'https://script.google.com/macros/s/AKfycbyr4jcBb0b_KuVe3nmb689vzVDPCoCpQUHgcciE5LqbULGiaFix5zyu568Qw4tGO36iug/exec';
  var MAX_AGE = 7 * 24 * 3600 * 1000;   // data offline dipakai maksimal 7 hari
  var READ_TIMEOUT = 15000, WRITE_TIMEOUT = 45000;
  // fungsi baca: hasilnya disimpan agar bisa dilihat saat offline
  var READ = { getData:1, getKelas:1, getLaporanBulanan:1, getLaporanData:1, getLeaderboardData:1,
               getMyMurojaah:1, getMySetoran:1, getPerizinanRiwayat:1, getSiswaProgress:1, getUsers:1 };

  /* ---------- cache (IndexedDB) ---------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      try {
        var r = indexedDB.open('tahfizh-cache', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('c'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      } catch (e) { rej(e); }
    });
    return dbp;
  }
  function cget(k) {
    return db().then(function (d) { return new Promise(function (res) {
      var q = d.transaction('c').objectStore('c').get(k);
      q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); };
    }); }).catch(function () { return null; });
  }
  function cset(k, v) {
    return db().then(function (d) { d.transaction('c', 'readwrite').objectStore('c').put({ t: Date.now(), v: v }, k); }).catch(function () {});
  }
  function cclear() {
    return db().then(function (d) { d.transaction('c', 'readwrite').objectStore('c').clear(); }).catch(function () {});
  }
  function user() { try { return localStorage.getItem('app_username') || ''; } catch (e) { return ''; } }
  function key(fn, args) { return user() + '|' + fn + '|' + JSON.stringify(args.slice(1)); }

  /* ---------- banner offline ---------- */
  var bar = null, stale = false;
  function ensureBar() {
    if (bar || !document.body) return bar;
    bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:calc(8px + env(safe-area-inset-top,0px));z-index:9500;max-width:92vw;padding:8px 14px;border-radius:999px;font:700 12px system-ui,sans-serif;color:#fff;background:#374151;box-shadow:0 6px 20px rgba(0,0,0,.25);display:none;cursor:default;text-align:center';
    document.body.appendChild(bar);
    bar.addEventListener('click', function () {
      if (bar.dataset.mode === 'online') { hideBar(); if (typeof loadDashboard === 'function' && window.appState && appState.token) loadDashboard(); else location.reload(); }
    });
    return bar;
  }
  function fmtT(t) { var d = new Date(t), p = function (x) { return String(x).padStart(2, '0'); }; return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function showOffline(t) { var b = ensureBar(); if (!b) return; stale = true; b.dataset.mode = 'offline'; b.style.background = '#374151'; b.style.cursor = 'default'; b.textContent = 'Mode offline · data per ' + fmtT(t); b.style.display = 'block'; }
  function hideBar() { if (bar) bar.style.display = 'none'; stale = false; }
  window.addEventListener('online', function () {
    if (!stale) return; var b = ensureBar(); if (!b) return;
    b.dataset.mode = 'online'; b.style.background = '#047857'; b.style.cursor = 'pointer'; b.textContent = 'Kembali online · ketuk untuk perbarui data';
  });

  /* ---------- panggilan ke server ---------- */
  function post(fn, args, timeout) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, timeout);
    return fetch(APP_URL, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // "simple request": tanpa preflight CORS
      body: JSON.stringify({ fn: fn, args: args })
    }).then(function (r) {
      if (!r.ok) throw new TypeError('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      clearTimeout(t);
      if (!j || j.ok !== true) { var e = new Error((j && j.error) || 'Kesalahan server'); e.server = true; throw e; }
      return j.result;
    }, function (e) { clearTimeout(t); throw e; });
  }

  function invoke(fn, args, ok, fail) {
    ok = ok || function () {}; fail = fail || function () {};
    var isRead = !!READ[fn];
    var failMsg = function (m) { try { fail(m); } catch (e) { console.error(e); } };
    var fromCache = function () {
      cget(key(fn, args)).then(function (c) {
        if (c && Date.now() - c.t <= MAX_AGE) { showOffline(c.t); ok(c.v); }
        else failMsg('Tidak ada internet dan belum ada data tersimpan. Buka halaman ini sekali saat online.');
      });
    };
    if (navigator.onLine === false) {
      if (isRead) return fromCache();
      return failMsg('Fitur ini butuh internet.');
    }
    post(fn, args, isRead ? READ_TIMEOUT : WRITE_TIMEOUT).then(function (res) {
      if (fn === 'loginUser' && res && res.status === 'success') cclear();       // ganti akun: buang cache lama
      if (isRead && res && res.status !== 'error' && res.message !== 'Unauthorized') cset(key(fn, args), res);
      if (stale) hideBar();
      ok(res);
    }, function (e) {
      if (e && e.server) return failMsg(e.message);
      if (isRead) return fromCache();                                           // sinyal lemah / putus
      failMsg('Koneksi bermasalah. Coba lagi.');
    });
  }

  function builder(ok, fail) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { return builder(f, fail); };
      if (name === 'withFailureHandler') return function (f) { return builder(ok, f); };
      if (name === 'withUserObject') return function () { return builder(ok, fail); };
      return function () { invoke(String(name), Array.prototype.slice.call(arguments), ok, fail); };
    } });
  }
  window.google = { script: { run: builder(null, null), host: { close: function () {}, setHeight: function () {}, setWidth: function () {} } } };
})();
