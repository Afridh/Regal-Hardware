/* Shared by the Home screen demos: the 26 tiles (as on the real Home page), the till's own icons, sample figures, keys. */
(function(){
var ICON={"pos":"M3 6h18l-2 12H5zM8 6V3h8v3M9 21h.01M15 21h.01","purchases":"M3 4h3l2.5 11h9L20 7H7M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z","products":"M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7.5 5l9 4","suppliers":"M3 8h11v9H3zM14 11h4l3 3v3h-7zM6.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3z","customers":"M9 11a4 4 0 100-8 4 4 0 000 8zM3 21a6 6 0 0112 0M17 8h4M19 6v4","reports":"M4 20V6M9 20V10M14 20V4M19 20v-8M3 20h18","dashboard":"M3 12h6V3H3zM11 21h6v-9h-6zM3 21h6v-6H3zM11 8h6V3h-6z","orders":"M8 4h9l3 4v12H8zM8 4H4v16h4M12 11h5M12 15h5","stock":"M4 20h16M6 20V9M11 20V4M16 20v-7M21 20v-4","payreqs":"M4 6h16v12H4zM4 10h16M8 14h4M17 3v4M15 5h4","receipts":"M4 5h16v14H4zM4 10h16M8 15h4","bills":"M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6","returns":"M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3","docs":"M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4","expenses":"M12 3v18M8 7h6a3 3 0 010 6H9a3 3 0 000 6h6","cashup":"M3 7h18v10H3zM12 10a2 2 0 100 4 2 2 0 000-4zM6 10h.01M18 14h.01","cashbank":"M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18","chequesIn":"M3 6h18v12H3zM7 14h5M16 10l2 2 3-4","labels":"M3 6h4v12H3zM9 6h1v12H9zM12 6h2v12h-2zM16 6h1v12h-1zM19 6h2v12h-2z","payroll":"M12 3a4 4 0 100 8 4 4 0 000-8zM4 21a8 8 0 0116 0M12 13v3M10.5 14.5h3","actions":"M12 3a6 6 0 016 6c0 5 2 6 2 7H4c0-1 2-2 2-7a6 6 0 016-6zM10 19a2 2 0 004 0M17 4l2-1M7 4L5 3","settings":"M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 006.6 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 15H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 9.4l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 009 6.6V6a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1A1.6 1.6 0 0021 12v0a2 2 0 110 4h-.1z","home":"M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"};
var TILES=[{"k":"pos","label":"New Invoice","desc":"Make a bill at the till","group":"Sell","add":true,"key":"F3"},{"k":"purchases","label":"New Purchase","desc":"Goods in from a supplier","group":"Buy","add":true,"key":""},{"k":"products","label":"Add Product","desc":"Barcode, prices, stock","group":"Stock","add":true,"key":""},{"k":"suppliers","label":"Add Supplier","desc":"Contact and credit terms","group":"Buy","add":true,"key":""},{"k":"customers","label":"Add Customer","desc":"Mobile, limit, price level","group":"Sell","add":true,"key":""},{"k":"reports","label":"Sales Revenue","desc":"By day, item, salesman, profit","group":"Money","add":false,"key":"Alt+Z"},{"k":"purchases","label":"Purchase History","desc":"Every goods-in, in full","group":"Buy","add":false,"key":"Alt+G"},{"k":"products","label":"Products","desc":"The whole catalogue","group":"Stock","add":false,"key":"Alt+P"},{"k":"suppliers","label":"Suppliers","desc":"What we owe, their ledger","group":"Buy","add":false,"key":"F12"},{"k":"customers","label":"Customers","desc":"What they owe, their bills","group":"Sell","add":false,"key":"F8"},{"k":"dashboard","label":"Dashboard","desc":"Today at a glance","group":"Money","add":false,"key":"F2"},{"k":"orders","label":"Purchase Order","desc":"From what is running low","group":"Buy","add":false,"key":""},{"k":"stock","label":"Inventory","desc":"On hand, low, fast, slow","group":"Stock","add":false,"key":"Alt+K"},{"k":"payreqs","label":"Paid Out","desc":"Pay suppliers","group":"Buy","add":false,"key":"Alt+Y"},{"k":"receipts","label":"Received","desc":"Customer payments","group":"Sell","add":false,"key":"F7"},{"k":"bills","label":"Bills","desc":"Find, reprint, change","group":"Sell","add":false,"key":"Alt+B"},{"k":"returns","label":"Returns","desc":"Refund or off the account","group":"Sell","add":false,"key":"Alt+V"},{"k":"docs","label":"Quotations","desc":"Quotes and delivery notes","group":"Sell","add":false,"key":"Alt+Q"},{"k":"expenses","label":"Expenses","desc":"Rent, bills, transport","group":"Money","add":false,"key":"Alt+X"},{"k":"cashup","label":"Day Book","desc":"Open and close the drawer","group":"Money","add":false,"key":"Alt+J"},{"k":"cashbank","label":"Cash & Bank","desc":"Cash in hand and the banks","group":"Money","add":false,"key":""},{"k":"chequesIn","label":"Cheques","desc":"Due and cleared","group":"Money","add":false,"key":"Alt+H"},{"k":"labels","label":"Barcode Labels","desc":"Shelf price labels","group":"Stock","add":false,"key":"F11"},{"k":"payroll","label":"Employees","desc":"Attendance, leave, pay","group":"People","add":false,"key":"F9"},{"k":"actions","label":"Action Centre","desc":"What needs a look","group":"People","add":false,"key":"Alt+A"},{"k":"settings","label":"Settings","desc":"Shop, bill, printers, users","group":"People","add":false,"key":""}];
var calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
var GROUPS = [['Sell', 'Selling & customers'], ['Buy', 'Buying & suppliers'], ['Stock', 'Goods & stock'], ['Money', 'Money & figures'], ['People', 'Staff & setup']];
var TODAY = { sales: 186450, bills: 42, cash: 128900, credit: 57550, toCollect: 412300, lowStock: 17, waiting: 3 };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
var rs = function (n) { return Math.round(n).toLocaleString('en-LK'); };
function icon(k, cls) { return '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="' + (ICON[k] || ICON.dashboard) + '"/></svg>'; }
function countUp(el, to, ms, delay) {
  if (!el) return; if (calm) { el.textContent = rs(to); return; }
  el.textContent = '0';
  setTimeout(function () { var t0 = performance.now();
    (function step(t) { var p = Math.min(1, (t - t0) / ms), e = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p); el.textContent = rs(to * e); if (p < 1) requestAnimationFrame(step); })(t0); }, delay || 0);
}
function clock(el, withSec) { if (!el) return; var tick = function () { el.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: withSec ? '2-digit' : undefined, hour12: true }); }; tick(); setInterval(tick, 1000); }
function hello() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function today() { return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
/* a small note at the foot: in the demo a tile says what it would open */
var toastT;
function toast(msg) { var t = document.querySelector('.h-toast'); if (!t) { t = document.createElement('div'); t.className = 'h-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.remove('on'); void t.offsetWidth; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 1800); }
function open(t) { toast((t.add ? 'Opens the add window: ' : 'Opens: ') + t.label + (t.key ? '  (' + t.key + ')' : '')); }
/* every [data-tile] button: a click or Enter opens it, the arrows move by where the tiles sit on screen */
function wire(root) {
  var tiles = [].slice.call((root || document).querySelectorAll('[data-tile]'));
  tiles.forEach(function (b) { b.onclick = function () { open(TILES[+b.dataset.tile]); }; });
  document.addEventListener('keydown', function (e) {
    var dirs = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }, d = dirs[e.key];
    if (!d || (e.target && e.target.tagName === 'INPUT')) return;
    var vis = tiles.filter(function (t) { return t.offsetParent && !t.classList.contains('dim'); });
    var cur = document.activeElement && vis.indexOf(document.activeElement) >= 0 ? document.activeElement : null;
    if (!cur) { if (vis[0]) { vis[0].focus(); e.preventDefault(); } return; }
    var a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2, best = null, bd = 1e9;
    vis.forEach(function (t) { if (t === cur) return; var r = t.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - ax, dy = y - ay;
      if (d[0] && Math.sign(dx) !== d[0]) return; if (d[1] && Math.sign(dy) !== d[1]) return; if (d[0] && Math.abs(dx) < 4) return; if (d[1] && Math.abs(dy) < 4) return;
      var s = d[0] ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 3; if (s < bd) { bd = s; best = t; } });
    if (best) { e.preventDefault(); best.focus(); }
  });
  return tiles;
}
/* typing anywhere finds a tile: the others dim, Enter opens the first one left */
function search(input, tiles) {
  if (!input) return;
  var run = function () { var q = input.value.trim().toLowerCase(), first = null;
    tiles.forEach(function (b) { var t = TILES[+b.dataset.tile], hit = !q || (t.label + ' ' + t.desc + ' ' + t.group).toLowerCase().indexOf(q) >= 0; b.classList.toggle('dim', !hit); if (hit && !first) first = b; });
    tiles.forEach(function (b) { b.classList.toggle('first', !!q && b === first); }); return first; };
  input.oninput = run;
  input.onkeydown = function (e) { if (e.key === 'Enter') { var f = run(); if (f) f.click(); } if (e.key === 'Escape') { input.value = ''; run(); input.blur(); } if (e.key === 'ArrowDown') { var f2 = run(); if (f2) { e.preventDefault(); f2.focus(); } } };
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && document.activeElement !== input)) { e.preventDefault(); input.focus(); input.select(); return; }
    if (document.activeElement !== input && e.key.length === 1 && /[a-z]/i.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) { input.focus(); }
  });
}
/* a ripple where a tile is pressed */
document.addEventListener('pointerdown', function (e) { var el = e.target.closest('[data-tile],.rp'); if (!el || calm) return;
  var r = el.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement('span'); s.className = 'h-ripple';
  s.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (e.clientX - r.left - d / 2) + 'px;top:' + (e.clientY - r.top - d / 2) + 'px';
  el.appendChild(s); setTimeout(function () { s.remove(); }, 650); });
var style = document.createElement('style');
style.textContent = '[data-tile]{position:relative;overflow:hidden}.h-ripple{position:absolute;border-radius:50%;background:currentColor;opacity:.18;transform:scale(0);animation:hrip .6s ease-out forwards;pointer-events:none}@keyframes hrip{to{transform:scale(2.4);opacity:0}}' +
  '.h-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,20px);opacity:0;z-index:99;background:#111;color:#fff;font:600 14px/1.3 system-ui,sans-serif;padding:10px 18px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.3);transition:opacity .2s,transform .3s cubic-bezier(.34,1.56,.64,1);pointer-events:none}.h-toast.on{opacity:1;transform:translate(-50%,0)}' +
  '.demo-back{position:fixed;left:10px;bottom:10px;z-index:98;font:600 12px system-ui,sans-serif;color:inherit;opacity:.55;text-decoration:none}.demo-back:hover{opacity:1}';
document.head.appendChild(style);
window.H = { ICON: ICON, TILES: TILES, GROUPS: GROUPS, TODAY: TODAY, esc: esc, rs: rs, icon: icon, countUp: countUp, clock: clock, hello: hello, today: today, toast: toast, open: open, wire: wire, search: search, calm: calm };

})();
