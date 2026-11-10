/* Shared by the Customer payment (Ctrl+M) demos: made-up customers (no real names or numbers), the search as the
   till does it (name, initials, mobile, code), the keys, and the shop behind the window. */
(function () {
  var N = ['Green Valley Constructions', 'Silva Builders', 'Nimal Constructions', 'Sunrise Wedding Hall', 'Lake View Hotel', 'Perera & Sons Hardware',
    'Kandy Road Tyre House', 'Bright Electricals', 'Hill Top Rehabilitation Centre', 'Ocean Breeze Restaurant', 'Royal Paint Works', 'Mega Steel Fabricators',
    'Gamage Aluminium', 'City Plumbing Services', 'Fernando Contractors', 'Blue Star Motors', 'Jaya Timber Depot', 'Golden Rice Mill',
    'Sampath Welding Works', 'Weerasinghe Builders', 'Lotus Tiles Centre', 'New Era Furniture', 'Ruwan Electricals', 'Green Field Electricals'];
  var D = function (n) { var d = new Date(2026, 10, 10); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  var r = function (i, k) { return ((i * 9301 + k * 49297) % 233280) / 233280; };
  window.CUST = N.map(function (name, i) {
    var nb = 1 + Math.floor(r(i, 1) * 6), bills = [], owed = 0;
    for (var j = 0; j < nb; j++) { var a = Math.round((4000 + r(i, j + 3) * (i < 4 ? 420000 : 90000)) / 10) * 10, age = Math.floor(r(i, j + 9) * (i % 5 === 0 ? 120 : 50)) + j * 3; bills.push({ no: String(20100 + i * 7 + j), date: D(age), age: age, amt: a }); owed += a; }
    if (i > 19) { bills = []; owed = 0; }
    bills.sort(function (a, b) { return b.age - a.age; });
    var limit = Math.max(50000, Math.round(owed * (0.7 + r(i, 2) * 0.9) / 50000) * 50000);
    return { id: i + 2, name: name.toUpperCase(), phone: '07' + String(70000000 + i * 1371).slice(0, 8), code: 'CUS-11-' + String(300 + i * 13).padStart(6, '0'),
      owed: owed, bills: bills, limit: limit, oldest: bills.length ? bills[0].age : 0,
      lastPay: i % 4 === 3 ? null : { date: D(3 + (i * 5) % 40), amt: Math.round(5000 + r(i, 7) * 60000) } };
  }).sort(function (a, b) { return b.owed - a.owed; });
  window.money = function (v) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  window.initials = function (n) { return n.replace(/[^A-Z0-9 &]/gi, '').split(/\s+/).filter(function (w) { return w && w !== '&'; }).slice(0, 2).map(function (w) { return w[0]; }).join(''); };
  // as the till finds customers: words of the name, their first letters, the mobile, the code
  window.match = function (c, v) {
    v = v.trim().toLowerCase(); if (!v) return c.owed > 0.005;
    var nm = c.name.toLowerCase(), digits = v.replace(/\D/g, '');
    if (nm.indexOf(v) >= 0 || c.code.toLowerCase().indexOf(v) >= 0) return true;
    if (digits.length >= 3 && c.phone.indexOf(digits) >= 0) return true;
    var ini = nm.split(/\s+/).filter(function (w) { return w !== '&'; }).map(function (w) { return w[0]; }).join('');
    if (v.length >= 2 && ini.indexOf(v) === 0) return true;
    return v.split(/\s+/).every(function (p) { return nm.split(/\s+/).some(function (w) { return w.indexOf(p) === 0; }); });
  };
  window.mark = function (txt, v) {
    v = (v || '').trim(); if (!v || v.length < 2) return txt;
    var i = txt.toLowerCase().indexOf(v.toLowerCase()); if (i < 0) return txt;
    return txt.slice(0, i) + '<mark>' + txt.slice(i, i + v.length) + '</mark>' + txt.slice(i + v.length);
  };
  window.day = function (s) { var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], p = s.split('-'); return +p[2] + ' ' + M[+p[1] - 1]; };
  window.ageWord = function (d) { return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days'; };
  window.ageTone = function (d) { return d > 60 ? 'old' : d > 30 ? 'mid' : 'new'; };
  // the shop behind the window, dimmed, as on the till
  window.backdrop = function () {
    var b = document.createElement('div'); b.className = 'shop-behind';
    b.innerHTML = '<aside></aside><main><h1>What\'s new</h1><div class="ph"></div><div class="ph"></div><div class="ph short"></div></main>';
    document.body.prepend(b);
  };
  window.toast = function (t) {
    var el = document.getElementById('demoToast'); if (!el) { el = document.createElement('div'); el.id = 'demoToast'; document.body.appendChild(el); }
    el.textContent = t; el.className = 'on'; clearTimeout(el._t); el._t = setTimeout(function () { el.className = ''; }, 2200);
  };
  var css = document.createElement('style');
  css.textContent = '.shop-behind{position:fixed;inset:0;display:flex;background:#eef0f2;filter:blur(1.5px);z-index:0}.shop-behind aside{width:68px;background:linear-gradient(#4a0d14,#2a080c)}.shop-behind main{flex:1;padding:30px 26px}.shop-behind h1{font:800 28px Archivo,sans-serif;color:#333;border-bottom:3px solid #333;padding-bottom:12px}.shop-behind .ph{height:120px;background:#fff;border-radius:12px;margin-top:18px}.shop-behind .ph.short{height:60px}' +
    '.dim{position:fixed;inset:0;background:rgba(20,22,26,.45);z-index:1}' +
    '#demoToast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,30px);opacity:0;background:#1b1f22;color:#fff;padding:12px 18px;border-radius:12px;font:600 14px Inter,sans-serif;transition:.25s;z-index:99}#demoToast.on{opacity:1;transform:translate(-50%,0)}mark{background:#ffe08a;color:inherit;border-radius:3px;padding:0 1px}';
  document.head.appendChild(css);
})();
