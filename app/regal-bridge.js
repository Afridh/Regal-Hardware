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
  var LOCAL_KEYS = ['user', 'pos', 'view', 'terminal', 'held', 'heldBills', 'portal', 'cportal', 'phoneOpen', 'phoneMode', 'notifOpen', 'signedOut', 'drawer', '_fromStore', 'locId'];

  var rev = 0, token = localStorage.getItem(TOKEN_KEY) || '', busy = false, lastPushAt = 0, pollTimer = null, offlineSince = 0, build = '', toldBuild = false;

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
  function keepLocal() {
    var S = window.S; if (!S) return null;
    var k = {}; LOCAL_KEYS.forEach(function (n) { if (S[n] !== undefined) k[n] = S[n]; });
    return k;
  }
  function restoreLocal(k) { if (k && window.S) Object.keys(k).forEach(function (n) { window.S[n] = k[n]; }); }
  // someone is mid-entry when the focused box holds something (an empty search box a page focused by itself does not count)
  function typing() { var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && (a.tagName === 'SELECT' || a.type === 'checkbox' || String(a.value || '').length > 0)); }
  function tillBusy() { var S = window.S; return !!(document.querySelector('.modal') || document.querySelector('.lock') || (S && S.pos && S.pos.lines && S.pos.lines.length)); }
  function say(msg) { if (typeof window.toast === 'function') window.toast(msg); }
  function badge(txt) { ['savedAt', 'csSync'].forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = txt; }); }

  /** Apply a books document that came from the server, keeping this till's own screen state. */
  function applyRemote(doc) {
    if (!doc || typeof window.applyKept !== 'function') return;
    var local = keepLocal();
    window.applyKept(doc);
    restoreLocal(local);
    if (typeof window.markSaved === 'function') window.markSaved();
    if (window.S) { window.S._fromStore = true; window.S.terminal = localStorage.getItem(TERMINAL_KEY) || window.S.terminal || 'T1'; }
    if (typeof window.applyLayout === 'function') window.applyLayout();
    if (window.S && window.S.view === 'payroll' && typeof window.refreshAttendanceBoard === 'function') {
      window.refreshAttendanceBoard();
    }
    if (typeof window.render === 'function') window.render();
    if (typeof window.drawPhone === 'function') window.drawPhone();
    if (typeof window.drawBell === 'function') window.drawBell();
  }

  async function pull(quiet) {
    if (!token || busy) return false;
    if (Date.now() - lastPushAt < 3000) return false;
    var j = await call('GET', '/books/' + KEY);
    if (j.__status !== 200) return false;
    if (j.data) {
      rev = j.rev; applyRemote(j.data);
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
      if (!token) return null;
      var j = await call('GET', '/books/' + KEY);
      if (j.__status !== 200 || !j.data) return null;
      rev = j.rev;
      var d = j.data; if (d && d.S) LOCAL_KEYS.forEach(function (k) { delete d.S[k]; });
      return { value: JSON.stringify(d) };
    },
    set: async function (_k, txt) {
      if (!token) throw new Error('not signed in');
      if (busy) { pendingSet = txt; return true; }
      busy = true;
      lastPushAt = Date.now();
      try {
        var doc = strip(JSON.parse(txt));
        var j = await call('PUT', '/books/' + KEY, { data: doc, rev: rev });
        if (j.__status === 200) { rev = j.rev; lastPushAt = Date.now(); offlineSince = 0; badge('saved ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · shared'); return true; }
        if (j.__status === 409) {
          rev = j.rev; applyRemote(j.data);
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
      if (!token) return;
      await call('DELETE', '/books/' + KEY);
      rev = 0;
    }
  };
  var pendingSet = null;

  /* ---------------- sign in ---------------- */
  async function login(name, password) {
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
  }
  function logout() { token = ''; localStorage.removeItem(TOKEN_KEY); onSignedOut(); }

  /** Names for the lock screen from the server, so a fresh browser lists the real staff. */
  async function serverUsers() {
    var j = await call('GET', '/books/users');
    return (j.__status === 200 && Array.isArray(j.users)) ? j.users : [];
  }

  /* ---------------- other tills ---------------- */
  async function poll() {
    if (!token || busy || document.hidden) return;       // a tab nobody is looking at does not poll
    if (window.privacyOn) return;                          // the privacy screen is up: nothing moves until it is taken down
    if (Date.now() - lastPushAt < 3000) return;          // our own save is still settling
    var j = await call('GET', '/books/' + KEY + '/rev');
    if (j.__status !== 200) return;
    // a newer version of the app on the server: reload as soon as the till is idle
    if (j.build) {
      if (!build) build = j.build;
      else if (j.build !== build) {
        if (!typing() && !tillBusy()) { say('A newer version is ready — reloading'); setTimeout(function () { location.reload(); }, 900); return; }
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
