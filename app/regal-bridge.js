/* regal-bridge.js — connects the Regal front-end to the SePOS Node + PostgreSQL server.
   Loaded before the app's own script.  It provides:
     window.storage      the get/set/delete store the app already looks for (books live in PostgreSQL)
     window.regalBridge  sign-in against the server, SMS relay, and a poll that pulls changes made on other tills
   Nothing here touches the app's business logic. */
(function () {
  'use strict';
  var API = '/api';
  var KEY = 'regal';                       // books document key on the server
  var TOKEN_KEY = 'regal_token';
  var TERMINAL_KEY = 'regal_terminal';
  var POLL_MS = 2000;
  // per-device state that must never travel between tills
  /* What stays on the machine it was typed on. The bill being keyed right now (pos) does:
     nobody wants half a bill appearing on the next till. Bills put ON HOLD do not, and used
     to — so a bill held at the counter could not be picked up on a phone, and was lost
     outright when the page was reloaded, because nothing ever wrote it down. */
  var LOCAL_KEYS = ['user', 'pos', 'view', 'terminal', 'portal', 'cportal', 'phoneOpen', 'phoneMode', 'notifOpen', 'signedOut', 'drawer', '_fromStore', 'locId'];

  var rev = 0, token = localStorage.getItem(TOKEN_KEY) || '', busy = false, lastPushAt = 0, pollTimer = null, offlineSince = 0, build = '', toldBuild = false;

  function isDemoSession() {
    return !!(window.isDemo || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('regal_is_demo') === '1'));
  }

  function headers(json) {
    var h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }
  async function call(method, path, body) {
    try {
      var r = await fetch(API + path, { method: method, headers: headers(!!body), body: body ? JSON.stringify(body) : undefined });
      var j = null; try { j = await r.json(); } catch (e) { j = {}; }
      j.__status = r.status;
      if (r.status === 401 && token) { token = ''; localStorage.removeItem(TOKEN_KEY); onSignedOut(); }
      return j;
    } catch (e) {
      return { __status: 0, error: e.message || 'Server unreachable' };
    }
  }
  function strip(data) {
    // the document as saved: shared books only, no per-till state
    var d = JSON.parse(JSON.stringify(data));
    if (d && d.S) LOCAL_KEYS.forEach(function (k) { delete d.S[k]; });
    return d;
  }
  /* ---------------- two tills saving at once ----------------
     base   the books as this till last had them from the server
     mine   this till's books now (base + what was done here)
     theirs the server's books now (base + what other tills did)
     The result keeps both sides' work: a bill made here and a bill made there are both kept, stock sold
     on both tills comes off twice (numbers changed on both sides add their changes), entries added to the
     journal or the stock movements on either side are all kept, and of two changes to one attendance
     record the newer stands. Only where both sides changed the same text does this till's version win. */
  var base = null;
  var same = function (a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); };
  var isObj = function (v) { return v && typeof v === 'object' && !Array.isArray(v); };
  function keyOf(arrs) {
    var cand = ['id', 'no', 'code'];
    for (var c = 0; c < cand.length; c++) {
      var k = cand[c], ok = true, any = false;
      for (var a = 0; a < arrs.length && ok; a++) {
        var seen = {};
        for (var i = 0; i < arrs[a].length; i++) {
          var x = arrs[a][i];
          if (!isObj(x) || x[k] === undefined || x[k] === null || x[k] === '') { ok = false; break; }
          var kk = String(x[k]); if (seen[kk]) { ok = false; break; } seen[kk] = 1; any = true;
        }
      }
      if (ok && any) return k;
    }
    return null;
  }
  function mergeArr(b, m, t) {
    var k = keyOf([b, m, t]);
    var out = [], front = [], end = [];
    if (k) {
      var B = Object.create(null), M = Object.create(null), T = Object.create(null);
      b.forEach(function (x) { B[x[k]] = x; }); m.forEach(function (x) { M[x[k]] = x; }); t.forEach(function (x) { T[x[k]] = x; });
      // what both knew, in the server's order, each merged
      var order = t.filter(function (x) { return x[k] in B; }).map(function (x) { return x[k]; });
      b.forEach(function (x) { if (!(x[k] in T) && x[k] in M) order.push(x[k]); });
      order.forEach(function (id) {
        var bb = B[id], mm = M[id], tt = T[id];
        if (mm === undefined && tt === undefined) return;
        if (mm === undefined) { if (!same(tt, bb)) out.push(tt); return; }           // deleted here, unless changed there
        if (tt === undefined) { if (!same(mm, bb)) out.push(mm); return; }           // deleted there, unless changed here
        out.push(merge3(bb, mm, tt, true));
      });
      // new on either side: those added before the first known item go first, the rest at the end
      var addNew = function (arr) {
        var firstKnown = arr.findIndex(function (x) { return x[k] in B; });
        arr.forEach(function (x, i) {
          if (x[k] in B) return;
          if (arr === m && x[k] in T) { if (!same(x, T[x[k]])) (firstKnown >= 0 && i < firstKnown ? front : end).push(x); return; }
          (firstKnown >= 0 && i < firstKnown ? front : end).push(x);
        });
      };
      addNew(t); addNew(m);
      return front.concat(out, end);
    }
    // no key (journal lines, stock movements): as a bag — the server's, less what was taken out here,
    // plus what was added here
    var count = function (arr) { var c = {}; arr.forEach(function (x) { var s = JSON.stringify(x); c[s] = (c[s] || 0) + 1; }); return c; };
    var cb = count(b), cm = count(m);
    var gone = {}; Object.keys(cb).forEach(function (s) { var d = cb[s] - (cm[s] || 0); if (d > 0) gone[s] = d; });
    var res = t.filter(function (x) { var s = JSON.stringify(x); if (gone[s]) { gone[s]--; return false; } return true; });
    var extra = {}; Object.keys(cm).forEach(function (s) { var d = cm[s] - (cb[s] || 0); if (d > 0) extra[s] = d; });
    m.forEach(function (x) { var s = JSON.stringify(x); if (extra[s]) { extra[s]--; res.push(x); } });
    return res;
  }
  function merge3(b, m, t, deep) {
    if (same(m, b)) return t;
    if (same(t, b)) return m;
    // the same books on both sides: nothing to put together (a save that went through twice)
    if (!deep && same(m, t)) return m;
    // a number both sides moved (stock, a balance, a counter): both moves — even when they moved it
    // by the same amount (both tills sold one of the same thing)
    if (typeof m === 'number' && typeof t === 'number' && typeof b === 'number') return t + (m - b);
    if (Array.isArray(m) && Array.isArray(t)) return mergeArr(Array.isArray(b) ? b : [], m, t);
    if (isObj(m) && isObj(t)) {
      // one record changed on both sides (an attendance day): the newer whole record
      if (m.updatedAt && t.updatedAt) return Number(m.updatedAt) >= Number(t.updatedAt) ? m : t;
      var bo = isObj(b) ? b : {}, o = {};
      Object.keys(Object.assign({}, bo, m, t)).forEach(function (key) {
        var inM = key in m, inT = key in t, inB = key in bo;
        if (!inM && !inT) return;
        if (!inM) { if (inB && same(t[key], bo[key])) return; o[key] = t[key]; return; }
        if (!inT) { if (inB && same(m[key], bo[key])) return; o[key] = m[key]; return; }
        o[key] = merge3(bo[key], m[key], t[key], true);
      });
      return o;
    }
    return m;                                                          // text changed on both: this till's
  }

  function keepLocal() {
    var S = window.S; if (!S) return null;
    var k = {}; LOCAL_KEYS.forEach(function (n) { if (S[n] !== undefined) k[n] = S[n]; });
    return k;
  }
  function restoreLocal(k) { if (k && window.S) Object.keys(k).forEach(function (n) { window.S[n] = k[n]; }); }
  // someone is mid-entry when the focused box holds something (an empty search box a page focused by itself does not count)
  function typing() { var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && (a.tagName === 'SELECT' || a.type === 'checkbox' || String(a.value || '').length > 0)); }
  /* Whether pulling the books now would get in somebody's way. A bill being rung up on the till screen,
     or a popup somebody is filling in, does. A popup that only shows something (a print preview, an
     order being looked at) does not: one left open used to stop the till hearing anything at all, so
     orders from the suppliers never arrived. The two order popups are drawn again from what is kept for
     them, so they do not count either. strict: about to reload the page, when any popup counts. */
  // the last time anybody pressed a key or touched the screen here
  var lastInputAt = 0;
  ['keydown', 'pointerdown', 'input'].forEach(function (t) { document.addEventListener(t, function () { lastInputAt = Date.now(); }, true); });
  var IDLE_MS = 4000;
  function tillBusy(strict) {
    var S = window.S;
    var filling = Array.prototype.some.call(document.querySelectorAll('.modal'), function (m) {
      return strict || (m.id !== 'ordModal' && m.id !== 'poModal' && !!m.querySelector('input,textarea,select'));
    });
    // A bill open on the till screen is this till's own and is kept whatever comes in, so the books can
    // be brought up to date under it — the other tills' held bills, customers, stock. Only not while
    // somebody is in the middle of keying it: the screen is redrawn when they stop for a moment.
    var billing = S && S.view === 'pos' && S.pos && S.pos.lines && S.pos.lines.length && (strict || Date.now() - lastInputAt < IDLE_MS);
    return !!(filling || document.querySelector('.lock') || billing);
  }
  function say(msg) { if (typeof window.toast === 'function') window.toast(msg); }
  function badge(txt) { ['savedAt', 'csSync'].forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = txt; }); }

  /** Apply a books document that came from the server, keeping this till's own screen state. */
  function applyRemote(doc) {
    if (!doc || typeof window.applyKept !== 'function') return;
    var local = keepLocal();
    window.keptLocalPunches = false;
    window.applyKept(doc);
    restoreLocal(local);
    if (typeof window.refreshMe === 'function') window.refreshMe();
    if (typeof window.markSaved === 'function') window.markSaved();
    // punches made here that the server copy did not have yet: marked saved above, so send them up now
    // or they stay on this till only
    if (window.keptLocalPunches && typeof window.persist === 'function') { window.keptLocalPunches = false; setTimeout(function () { window.persist(true); }, 0); }
    if (window.S) { window.S._fromStore = true; window.S.terminal = localStorage.getItem(TERMINAL_KEY) || window.S.terminal || 'T1'; }
    if (typeof window.applyLayout === 'function') window.applyLayout();
    if (window.S && window.S.view === 'payroll' && typeof window.refreshAttendanceBoard === 'function') {
      window.refreshAttendanceBoard();
    }
    if (typeof window.render === 'function') window.render();
    if (typeof window.drawPhone === 'function') window.drawPhone();
    if (typeof window.drawBell === 'function') window.drawBell();
  }

  /** Punches made on /shift that the server laid over our last save: hold them, so the next save keeps them. */
  function takeShiftDays(days) {
    var S = window.S; if (!S || !days) return;
    S.shift = S.shift || {}; S.shift.days = S.shift.days || {};
    Object.keys(days).forEach(function (ds) {
      S.shift.days[ds] = S.shift.days[ds] || {};
      Object.keys(days[ds] || {}).forEach(function (id) { S.shift.days[ds][id] = days[ds][id]; });
    });
    if (S.view === 'payroll' && typeof window.refreshAttendanceBoard === 'function') window.refreshAttendanceBoard();
    else if (typeof window.render === 'function' && !typing() && !tillBusy()) window.render();
  }

  async function pull(quiet) {
    if (isDemoSession()) return false;
    if (!token || busy) return false;
    if (Date.now() - lastPushAt < 3000) return false;
    // a bill or an edit made here and not saved yet would be wiped by the server's copy: save first
    if (!window.booksUnreadable && typeof window.hasUnsaved === 'function' && window.hasUnsaved()) { if (typeof window.persist === 'function') window.persist(true); return false; }
    var j = await call('GET', '/books/' + KEY);
    // the books are there but would not come down: nothing may be saved until they do
    if (j.__status !== 200) { window.booksUnreadable = true; return false; }
    window.booksUnreadable = false;
    if (j.data) {
      rev = j.rev; base = strip(j.data); applyRemote(j.data);
      if (!quiet) say('Books picked up from the server');
      // orders from the shop site ride in with the books; saving is what hands them to the shop for good
      if (j.inbox > 0) { say(j.inbox === 1 ? 'A new order from the website' : j.inbox + ' new orders from the website'); if (typeof window.persist === 'function') window.persist(true); }
      return true;
    }
    rev = j.rev || 0; return false;
  }

  /* ---------------- window.storage : what the app calls ---------------- */
  window.storage = {
    get: async function () {
      if (isDemoSession()) {
        try {
          var d = sessionStorage.getItem('regal_demo_store');
          return d ? { value: d } : null;
        } catch(e){ return null; }
      }
      if (!token) return null;
      var j = await call('GET', '/books/' + KEY);
      // a shop with no books yet answers 200 with nothing, and that is fine \u2014 the till seeds itself.
      // Anything else means the books are there but could not be read, which the till must not paper over.
      if (j.__status === 200 && !j.data) { window.booksUnreadable = false; return null; }
      if (j.__status !== 200) {
        // the books are on the server but would not come down. Whoever asked, the till must not now
        // save what it is holding \u2014 that is sample data, and it would wipe the real shop.
        window.booksUnreadable = true;
        throw new Error('the books could not be read (' + j.__status + ')');
      }
      rev = j.rev;
      window.booksUnreadable = false;                    // they came down: saving is safe again
      var d = j.data; if (d && d.S) LOCAL_KEYS.forEach(function (k) { delete d.S[k]; });
      base = JSON.parse(JSON.stringify(d));
      return { value: JSON.stringify(d) };
    },
    set: async function (_k, txt) {
      if (isDemoSession()) {
        try { sessionStorage.setItem('regal_demo_store', txt); } catch(e){}
        badge('demo trial · not shared');
        return true;
      }
      if (!token) throw new Error('not signed in');
      // Last gate before anything reaches the server. If the books would not come down, whatever this
      // till is holding is the sample data the page starts with, and writing it would wipe the shop.
      if (window.booksUnreadable) {
        badge('not saved \u2014 the books did not load');
        return false;
      }
      if (busy) { pendingSet = txt; return true; }
      busy = true;
      lastPushAt = Date.now();
      try {
        var doc = strip(JSON.parse(txt));
        if (window._allowWipeOnce && Date.now() - window._allowWipeOnce < 120000) doc._allowWipe = window._allowWipeOnce;
        window._allowWipeOnce = 0;
        var j = await call('PUT', '/books/' + KEY, { data: doc, rev: rev });
        if (j.__status === 200) {
          rev = j.rev; lastPushAt = Date.now(); offlineSince = 0; base = doc;
          if (j.shiftDays) takeShiftDays(j.shiftDays);
          badge('saved ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · shared');
          return true;
        }
        if (j.blocked) { rev = j.rev; base = strip(j.data); applyRemote(j.data); say(j.error || 'Save blocked — the real books were reloaded'); return true; }
        if (j.__status === 409 && base) {
          // another till saved first: put both tills' work together and save that (again, if yet another
          // till gets in between)
          var b = base, mine = doc, theirs = strip(j.data), srvRev = j.rev;
          for (var tries = 0; tries < 4; tries++) {
            var merged = merge3(b, mine, theirs);
            merged.at = new Date().toISOString();
            var r2 = await call('PUT', '/books/' + KEY, { data: merged, rev: srvRev });
            if (r2.__status === 200) {
              rev = r2.rev; base = merged; lastPushAt = Date.now(); offlineSince = 0;
              // work done here while this was saving is laid over the merged books, not lost
              var show = merged;
              if (pendingSet) { show = merge3(doc, strip(JSON.parse(pendingSet)), merged); pendingSet = JSON.stringify(show); }
              applyRemote(show);
              if (r2.shiftDays) takeShiftDays(r2.shiftDays);
              badge('saved ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · shared');
              return true;
            }
            if (r2.__status !== 409) { j = r2; break; }
            b = theirs; mine = merged; theirs = strip(r2.data); srvRev = r2.rev;
          }
          if (j.__status === 409) {
            rev = srvRev; base = theirs; applyRemote(theirs);
            say('The tills are very busy — the books were reloaded. Please check the last thing you did.');
            return true;
          }
        }
        if (j.__status === 409) {
          rev = j.rev; base = strip(j.data); applyRemote(j.data);
          say('Another till saved first — the books were reloaded. Please re-enter what you were doing.');
          return true;
        }
        if (j.__status === 0 || j.__status >= 500) { offlineSince = offlineSince || Date.now(); badge('server unreachable — kept on this PC'); }
        throw new Error(j.error || ('save failed ' + j.__status));
      } finally {
        busy = false;
        if (pendingSet) { var t = pendingSet; pendingSet = null; window.storage.set(_k, t); }
      }
    },
    delete: async function () {
      if (isDemoSession()) {
        try { sessionStorage.removeItem('regal_demo_store'); } catch(e){}
        return;
      }
      if (!token) return;
      await call('DELETE', '/books/' + KEY);
      rev = 0;
    }
  };
  var pendingSet = null;

  /* ---------------- sign in ---------------- */
  async function login(name, password) {
    if (String(name).toLowerCase() === 'demo') {
      if (password !== 'demo123') return { ok: false, status: 401, error: 'Demo password is demo123' };
      window.isDemo = true;
      try { sessionStorage.setItem('regal_is_demo', '1'); } catch(e){}
      stopPolling();
      var demoUser = {
        name: 'Demo User',
        role: 'Demo Admin',
        perms: ['sell','discount','cancelBill','cost','profit','adjustInvoice','overLimit','belowCost','receive','products','paySupplier','reports','settings','users','approve']
      };
      return { ok: true, isDemo: true, user: demoUser };
    }
    var j = await call('POST', '/books/login', { user: name, password: password });
    if (j.__status !== 200 || !j.ok) return { ok: false, status: j.__status, error: j.error || 'Could not sign in' };
    token = j.token; localStorage.setItem(TOKEN_KEY, token);
    await pull(true);
    startPolling();
    return { ok: true, user: j.user, bootstrap: !!j.bootstrap };
  }
  function onSignedOut() {
    stopPolling();
    badge('signed out of the server');
    // the till must not go on as if nothing happened: nothing it does would reach the server
    if (typeof window.serverSignedOut === 'function') { try { window.serverSignedOut(); } catch (e) {} }
  }
  /* when the sign-in was made: renewed once it is an hour old, so a till in use never runs out */
  function tokenAge() {
    try { var p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return Date.now() / 1000 - (p.iat || 0); }
    catch (e) { return 0; }
  }
  var renewTried = 0;
  async function renew() {
    if (!token || isDemoSession() || tokenAge() < 3600 || Date.now() - renewTried < 600000) return;
    renewTried = Date.now();
    var j = await call('POST', '/books/refresh', {});
    if (j.__status === 200 && j.token) { token = j.token; localStorage.setItem(TOKEN_KEY, token); }
  }
  function logout() { token = ''; localStorage.removeItem(TOKEN_KEY); onSignedOut(); }

  /** Names for the lock screen from the server, so a fresh browser lists the real staff. */
  async function serverUsers() {
    if (isDemoSession()) return [];
    var j = await call('GET', '/books/users');
    if (j.__status === 200 && Array.isArray(j.users)) {
      return j.users.filter(function (u) {
        var n = String(u.name || '').toLowerCase().trim();
        return n !== 'demo' && n !== 'demo user';
      });
    }
    return [];
  }

  /* ---------------- other tills ---------------- */
  var toldOld = false;
  async function poll() {
    if (isDemoSession()) return;
    if (!token || busy || document.hidden) return;       // a tab nobody is looking at does not poll
    if (window.privacyOn) return;                          // the privacy screen is up: nothing moves until it is taken down
    if (Date.now() - lastPushAt < 3000) return;          // our own save is still settling
    renew();                                              // keeps the sign-in alive while the till is in use
    var j = await call('GET', '/books/' + KEY + '/rev');
    if (j.__status !== 200) return;
    // the server has not been restarted since the pages were updated: things this page shares (held
    // bills) are thrown away by it on every save. Said once, on the screen, so nobody has to guess.
    if (!(j.server && (j.server.features || []).indexOf('held') >= 0)) {
      badge('not shared — server needs a restart');           // every poll, so a save does not hide it
      if (!toldOld) { toldOld = true; say('The server is running an older version — restart the Node.js app in cPanel. Until then held bills do not reach the other tills.'); }
    }
    // A till that could not read the books refuses to save, so that it never writes its sample data
    // over a real shop. The books are only pulled when the revision moves, though — and a till that is
    // not saving cannot move it. That deadlocked: one failed read and the till went quiet for good.
    // While the flag is up, read the books outright to see whether the server is answering again.
    if (window.booksUnreadable) {
      try { await window.storage.get(STORE_KEY); } catch (e) { return; }   // get() clears the flag if it works
      if (!window.booksUnreadable) say('The books are readable again — this till is saving once more');
      return;
    }
    // a newer version of the app on the server: reload as soon as the till is idle
    if (j.build) {
      if (!build) build = j.build;
      else if (j.build !== build) {
        if (!typing() && !tillBusy(true) && !(window.S && window.S.pos && window.S.pos.lines && window.S.pos.lines.length)) { say('A newer version is ready — reloading'); setTimeout(function () { location.reload(); }, 900); return; }
        if (!toldBuild) { toldBuild = true; say('A newer version is ready — it will load when the bill is done, or press F5'); }
      }
    }
    if (j.rev > rev || j.inbox > 0) {
      if (typing() || tillBusy()) return;                  // never pull the rug while someone is keying a bill
      var who = j.updated_by ? ' by ' + j.updated_by : '', newer = j.rev > rev;
      if (await pull(true) && newer) say('Books updated' + who);
    }
  }
  function startPolling() { stopPolling(); pollTimer = setInterval(poll, POLL_MS); }
  // a till that comes back to the front catches up at once, not on the next tick
  document.addEventListener('visibilitychange', function () { if (!document.hidden && pollTimer) poll(); });
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  /* ---------------- SMS through the server ---------------- */
  async function sms(to, message) {
    var j = await call('POST', '/sms/send', { to: to, message: message });
    if (j.__status !== 200) return { ok: false, status: 'Failed — ' + (j.error || j.__status) };
    return j;
  }

  window.regalBridge = {
    online: function () { return !!token; },
    localKeys: LOCAL_KEYS,
    token: function () { return token; },
    rev: function () { return rev; },
    login: login, logout: logout, pull: pull, sms: sms, serverUsers: serverUsers,
    setTerminal: function (t) { localStorage.setItem(TERMINAL_KEY, t); },
    terminal: function () { return localStorage.getItem(TERMINAL_KEY) || ''; }
  };
  if (token) startPolling();
})();
