/* The demo till (/demo): the real till page with no way out to the shop.
   The server sends /demo as index.html without regal-bridge.js and with this file loaded first, so it
   runs before anything else on the page. It makes a sealed box:
     · storage   — localStorage and sessionStorage are swapped for a copy kept under its own prefix, so
                   the demo never sees the real shop's books, sign-in or settings in this browser, and
                   never writes over them
     · network   — every call to the shop's server (/api, /shift-api.php, /reports …) is answered
                   "demo — not connected" without leaving the browser
     · channels  — tills talk to each other over BroadcastChannel; the demo's channels are renamed, so a
                   real till open in the next tab hears nothing from it
   Everything in it is sample data. "Reset demo" throws the box away and starts again. */
(function () {
  window.__sandboxDemo = true;
  var PREFIX = 'regal_demo_sandbox::';

  /* ---- storage: a namespaced copy, persisted inside the real localStorage under PREFIX ---- */
  function box(backing, prefix) {
    var real = backing;
    var keys = function () {
      var out = [];
      try { for (var i = 0; i < real.length; i++) { var k = real.key(i); if (k && k.indexOf(prefix) === 0) out.push(k.slice(prefix.length)); } } catch (e) {}
      return out;
    };
    var mem = {};
    var s = {
      getItem: function (k) { k = String(k); try { var v = real.getItem(prefix + k); return v === null ? (k in mem ? mem[k] : null) : v; } catch (e) { return k in mem ? mem[k] : null; } },
      setItem: function (k, v) { k = String(k); v = String(v); mem[k] = v; try { real.setItem(prefix + k, v); } catch (e) {} },
      removeItem: function (k) { k = String(k); delete mem[k]; try { real.removeItem(prefix + k); } catch (e) {} },
      clear: function () { keys().forEach(function (k) { try { real.removeItem(prefix + k); } catch (e) {} }); mem = {}; },
      key: function (i) { return keys()[i] || null; }
    };
    Object.defineProperty(s, 'length', { get: function () { return keys().length; } });
    return s;
  }
  var realLocal = null, realSession = null;
  try { realLocal = window.localStorage; } catch (e) {}
  try { realSession = window.sessionStorage; } catch (e) {}
  var memStore = { length: 0, getItem: function () { return null; }, setItem: function () {}, removeItem: function () {}, clear: function () {}, key: function () { return null; } };
  var demoLocal = realLocal ? box(realLocal, PREFIX) : memStore;
  var demoSession = realSession ? box(realSession, PREFIX) : memStore;
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return demoLocal; } }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return demoSession; } }); } catch (e) {}

  /* ---- network: nothing reaches the shop's server ---- */
  var isShop = function (url) {
    try {
      var u = new URL(String(url), location.href);
      if (u.origin !== location.origin) return false;
      return /^\/(api|shift-api\.php|reports|books)/.test(u.pathname) || /\.php$/.test(u.pathname);
    } catch (e) { return false; }
  };
  var notConnected = function () {
    return new Response(JSON.stringify({ ok: false, demo: true, error: 'Demo till — not connected to the shop' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } });
  };
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (isShop(url)) return Promise.resolve(notConnected());
    return realFetch ? realFetch(input, init) : Promise.reject(new Error('offline'));
  };
  if (window.XMLHttpRequest) {
    var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, url) { this.__demoBlocked = isShop(url); return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      if (this.__demoBlocked) { var x = this; setTimeout(function () { x.dispatchEvent(new Event('error')); }, 0); return; }
      return send.apply(this, arguments);
    };
  }
  if (navigator.sendBeacon) navigator.sendBeacon = function (url) { return isShop(url) ? false : true; };
  if (window.EventSource) window.EventSource = function () { throw new Error('Demo till — not connected'); };
  if (window.WebSocket) { var RealWS = window.WebSocket; window.WebSocket = function (url) { if (isShop(String(url).replace(/^ws/, 'http'))) throw new Error('Demo till — not connected'); return new RealWS(url); }; }

  /* ---- channels between tills: the demo's are its own ---- */
  if (window.BroadcastChannel) {
    var RealBC = window.BroadcastChannel;
    window.BroadcastChannel = function (name) { return new RealBC('regal-demo-sandbox:' + name); };
    window.BroadcastChannel.prototype = RealBC.prototype;
  }
  /* the real tills listen for 'storage' events on their own keys; the demo's keys are prefixed, so a
     demo save never looks like a books change to a real till in another tab */

  /* ---- the ribbon: always says it is a demo, and starts it over ---- */
  window.resetSandboxDemo = function () {
    if (!confirm('Start the demo again with fresh sample data?')) return;
    window.__sandboxLeaving = true;
    window.leavingDemo = true;                     // the till's own switch: no save on the way out
    demoLocal.clear(); demoSession.clear();
    location.reload();
  };
  var ribbon = function () {
    if (document.getElementById('sandboxRibbon')) return;
    var r = document.createElement('div');
    r.id = 'sandboxRibbon';
    r.setAttribute('role', 'status');
    r.style.cssText = 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:10px;' +
      'background:#4F46E5;color:#fff;font:600 12px/1.3 system-ui,-apple-system,sans-serif;padding:6px 8px 6px 12px;border-radius:99px;' +
      'box-shadow:0 6px 18px rgba(0,0,0,.25);max-width:calc(100vw - 24px);white-space:nowrap';
    r.innerHTML = '<span>🧪 Demo till · sample data · not connected to the shop</span>' +
      '<button type="button" style="border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.15);color:#fff;border-radius:99px;padding:3px 10px;font:inherit;cursor:pointer">↺ Reset demo</button>';
    r.querySelector('button').onclick = window.resetSandboxDemo;
    document.body.appendChild(r);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ribbon); else ribbon();
})();
