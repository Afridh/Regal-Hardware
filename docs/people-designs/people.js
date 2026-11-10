/* Shared by the Customers / Suppliers page demos (10 Nov 2026): made-up customers and suppliers (no real names or
   numbers), their open bills, the buttons each page has today, search, and the keys. Each demo draws it its own way. */
(function () {
  var CN = ['Green Valley Constructions', 'Silva Builders', 'Sunrise Wedding Hall & Reception', 'Hill Top Rehabilitation Centre', 'Perera & Sons Hardware', 'Kandy Road Tyre House',
    'Bright Electricals', 'Lake View Hotel', 'Royal Paint Works', 'Mega Steel Fabricators', 'Gamage Aluminium', 'City Plumbing Services', 'Fernando Contractors', 'Blue Star Motors',
    'Jaya Timber Depot', 'Golden Rice Mill', 'Sampath Welding Works', 'Weerasinghe Builders', 'Lotus Tiles Centre', 'New Era Furniture'];
  var SN = ['Sample Paints Ltd', 'Sample Cement Distributors', 'Island Pipes & Fittings', 'Lanka Steel Traders', 'Ceylon Wire Products', 'Eastern Hardware Agency',
    'Polythene Packers', 'Bright Lamps Co', 'Coastal Timber Suppliers', 'Unity Tiles Imports', 'Metro Tools Wholesale', 'Royal Locks & Hinges'];
  var r = function (i, k) { return ((i * 9301 + k * 49297 + 7) % 233280) / 233280; };
  var D = function (n) { var d = new Date(2026, 10, 10); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  function make(names, kind) {
    return names.map(function (n, i) {
      var nb = i > 15 ? 0 : 1 + Math.floor(r(i, 1) * 7), bills = [], owed = 0;
      for (var j = 0; j < nb; j++) { var age = Math.floor(r(i, j + 4) * (i % 4 === 0 ? 130 : 55)) + j * 2, a = Math.round((3000 + r(i, j + 9) * (i < 4 ? 260000 : 60000)) / 10) * 10; bills.push({ no: (kind === 'c' ? '' : 'GRN-') + (20200 + i * 9 + j), date: D(age), age: age, amt: a }); owed += a; }
      bills.sort(function (a, b) { return b.age - a.age; });
      var limit = kind === 'c' ? Math.max(50000, Math.round(owed * (0.6 + r(i, 2)) / 50000) * 50000) : 0;
      return { id: i + 1, kind: kind, name: n.toUpperCase(), phone: '07' + String(70100000 + i * 3137).slice(0, 8), phone2: i % 3 === 0 ? '07' + String(71200000 + i * 911).slice(0, 8) : '',
        code: (kind === 'c' ? 'CUS-11-' : 'SUP-11-') + String(100 + i * 17).padStart(6, '0'), owed: owed, bills: bills, limit: limit, oldest: bills.length ? bills[0].age : 0,
        level: kind === 'c' ? (i % 5 === 1 ? 'wholesale' : 'retail') : '', terms: kind === 's' ? [30, 45, 60][i % 3] : 0, page: i % 3 !== 2, since: D(30 + i * 11),
        lastPay: i % 4 === 3 ? null : { date: D(2 + (i * 5) % 30), amt: Math.round(4000 + r(i, 7) * 50000), how: ['cash', 'cheque', 'transfer'][i % 3] },
        bought: owed + Math.round(r(i, 8) * 400000), billsAll: nb + 3 + i % 5, chequesOut: kind === 's' && i % 3 === 0 ? Math.round(20000 + r(i, 3) * 90000) : 0,
        prev: i === 2 ? 102625 : 0, notes: i % 4 === 0 ? ['Promised to pay on Friday — called 8 Nov'] : [] };
    }).sort(function (a, b) { return b.owed - a.owed; });
  }
  window.PEOPLE = { c: make(CN, 'c'), s: make(SN, 's') };
  window.ACTIONS = {
    c: [['Take a payment', 'F7', 'main'], ['New bill', 'F6'], ['Statement', 'F8'], ['Text it'], ['Remind'], ['WhatsApp'], ['Add a note'], ['Edit', 'Ctrl+E'], ['Log a call'], ['Previous balance'], ['Black / red list…'], ['Their page link']],
    s: [['Pay supplier', 'F7', 'main'], ['New purchase', 'F6'], ['Statement', 'Ctrl+F8'], ['Goods back'], ['Damage returns'], ['Show them their stock'], ["Show the rep's phone"], ['Credit periods'], ['Add a note'], ['Edit', 'Ctrl+E'], ['Previous balance']]
  };
  window.FILTERS = { c: ['All', 'Outstanding', '60+ days', 'Over limit', 'Wholesale', 'Portal', 'No mobile', 'Inactive'], s: ['All', 'Outstanding', '60+ days', 'Cheques out', 'Orders waiting', 'Portal', 'Settled', 'Inactive'] };
  window.P = { kind: 'c', q: '', f: 'All', sort: 'Outstanding', sel: 0, tab: 'Overview' };
  window.money = function (v) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  window.short = function (v) { return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(Math.round(v)); };
  window.ini = function (n) { return n.replace(/[^A-Z0-9 ]/gi, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join(''); };
  window.tone = function (d) { return d > 60 ? 'old' : d > 30 ? 'mid' : 'new'; };
  window.ago = function (dt) { var n = Math.round((new Date(2026, 10, 10) - new Date(dt + 'T00:00:00')) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; };
  window.day = function (s) { var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], p = s.split('-'); return +p[2] + ' ' + M[+p[1] - 1]; };
  window.buckets = function (x) { var b = [0, 0, 0, 0]; x.bills.forEach(function (bl) { b[bl.age > 90 ? 3 : bl.age > 60 ? 2 : bl.age > 30 ? 1 : 0] += bl.amt; }); return b; };
  window.list = function () {
    var v = P.q.trim().toLowerCase(), L = PEOPLE[P.kind].filter(function (x) {
      if (v && !(x.name.toLowerCase().indexOf(v) >= 0 || x.phone.indexOf(v) >= 0 || x.code.toLowerCase().indexOf(v) >= 0 || ini(x.name).toLowerCase().indexOf(v) === 0)) return false;
      return P.f === 'All' || (P.f === 'Outstanding' && x.owed > 0) || (P.f === '60+ days' && x.oldest > 60) || (P.f === 'Over limit' && x.limit && x.owed > x.limit) || (P.f === 'Wholesale' && x.level === 'wholesale') || (P.f === 'Portal' && x.page) || (P.f === 'Cheques out' && x.chequesOut) || (P.f === 'Settled' && !x.owed) || P.f === 'No mobile' && false || P.f === 'Orders waiting' && x.id % 4 === 0 || P.f === 'Inactive' && false;
    });
    if (P.sort === 'Name') L = L.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (P.sort === 'Oldest debt' || P.sort === 'Oldest bill') L = L.slice().sort(function (a, b) { return b.oldest - a.oldest; });
    return L;
  };
  window.cur = function () { var L = list(); P.sel = Math.min(P.sel, Math.max(0, L.length - 1)); return L[P.sel]; };
  window.toast = function (t) {
    var el = document.getElementById('demoToast'); if (!el) { el = document.createElement('div'); el.id = 'demoToast'; document.body.appendChild(el); }
    el.textContent = t; el.className = 'on'; clearTimeout(el._t); el._t = setTimeout(function () { el.className = ''; }, 2000);
  };
  document.addEventListener('keydown', function (e) {
    var L = list();
    if (e.key === 'ArrowDown') { e.preventDefault(); P.sel = Math.min(L.length - 1, P.sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); P.sel = Math.max(0, P.sel - 1); draw(); }
    else if (e.key === 'F7' || e.key === 'F6' || e.key === 'F8') { e.preventDefault(); var a = ACTIONS[P.kind].find(function (x) { return x[1] && x[1].indexOf(e.key) >= 0; }); if (a) toast(a[0] + ' — ' + (cur() || {}).name); }
    else if (e.key === 'Escape' && P.q) { P.q = ''; draw(true); }
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'q') { P.q = e.target.value; P.sel = 0; draw(); var q = document.getElementById('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } });
  document.addEventListener('click', function (e) {
    var x;
    if ((x = e.target.closest('[data-i]'))) { P.sel = +x.dataset.i; return draw(); }
    if ((x = e.target.closest('[data-kind]'))) { P.kind = x.dataset.kind; P.sel = 0; P.f = 'All'; P.q = ''; P.sort = 'Outstanding'; return draw(true); }
    if ((x = e.target.closest('[data-f]'))) { P.f = x.dataset.f; P.sel = 0; return draw(); }
    if ((x = e.target.closest('[data-sort]'))) { P.sort = x.dataset.sort; P.sel = 0; return draw(); }
    if ((x = e.target.closest('[data-tab]'))) { P.tab = x.dataset.tab; return draw(); }
    if ((x = e.target.closest('[data-a]'))) { return toast(x.dataset.a + ' — ' + (cur() || {}).name); }
  });
  var css = document.createElement('style');
  css.textContent = '#demoToast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,30px);opacity:0;background:#1b1f22;color:#fff;padding:11px 18px;border-radius:12px;font:600 14px Inter,sans-serif;transition:.25s;z-index:99;pointer-events:none}#demoToast.on{opacity:1;transform:translate(-50%,0)}' +
    '.rail-bg{position:fixed;left:0;top:0;bottom:0;width:68px;background:linear-gradient(#4a0d14,#2a080c)}';
  document.head.appendChild(css);
})();
