/* Shared by the app-frame demos (10 Nov 2026): every page of Regal POS in ten groups, the icons, sample figures
   for the Dashboard (made up), and Ctrl+K — find any page by typing. Each demo draws the frame its own way. */
(function () {
  var I = {
    start: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
    sell: 'M3 6h18l-2 12H5zM8 6V3h8v3',
    cust: 'M9 11a4 4 0 100-8 4 4 0 000 8zM3 21a6 6 0 0112 0M17 8h4M19 6v4',
    supp: 'M3 8h11v9H3zM14 11h4l3 3v3h-7zM6.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
    stock: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    money: 'M2 7h20v10H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 7v10M18 7v10',
    staff: 'M8 7a3 3 0 106 0 3 3 0 00-6 0M4 21v-1a6 6 0 0112 0v1M17 11a3 3 0 100-6M20 21v-1a5 5 0 00-3-4.6',
    online: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    rep: 'M4 20V6M9 20V10M14 20V4M19 20v-8M3 20h18',
    set: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4', bell: 'M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4', plus: 'M12 5v14M5 12h14'
  };
  window.ICON = function (k, s) { return '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + I[k] + '"/></svg>'; };
  window.GROUPS = [
    { k: 'start', n: 'Start', pages: ['Home', 'Dashboard', 'Action centre', 'What is new'] },
    { k: 'sell', n: 'Selling', pages: ['POS billing', 'Bills', 'Store orders', 'Returns', 'Quotes & delivery notes', 'Goods to collect', 'Deliveries', 'Tool hire'] },
    { k: 'cust', n: 'Customers', pages: ['Customers', 'Take a payment', 'Credit follow-up', 'Easy payments', 'Tradesmen', 'Quotations & tenders', 'Repairs & warranty', 'Customer feedback'] },
    { k: 'supp', n: 'Suppliers', pages: ['Suppliers', 'Supplier orders', 'Purchases', 'Supplier payments', 'Purchasing & cash plan', 'Damage returns'] },
    { k: 'stock', n: 'Stock', pages: ['Products', 'Stock on hand', 'Stock ledger', 'Stock take', 'Stock transfers', 'Barcode labels', 'Who is reading the stock'] },
    { k: 'money', n: 'Money', pages: ['Open & close', 'Day book', 'Cash & bank', 'Petty cash', 'Expenses', 'Gift vouchers', 'Cheques in', 'Cheques out', 'Cheque books', 'Accounting'] },
    { k: 'staff', n: 'Staff', pages: ['Attendance & pay', 'Leave', 'Users & permissions'] },
    { k: 'online', n: 'Online', pages: ['Online store', 'Online orders', 'Online products', 'Social'] },
    { k: 'rep', n: 'Reports', pages: ['Reports', 'Everything', 'The trail', 'System log', 'AI support'] },
    { k: 'set', n: 'Settings', pages: ['Settings', 'Design the bill', 'Messages', 'Printing', 'Cameras'] }
  ];
  window.BADGE = { 'Action centre': 2, 'Store orders': 1, 'Credit follow-up': 4, 'Supplier orders': 1, 'Cheques in': 1 };
  window.FAV = ['POS billing', 'Bills', 'Customers', 'Take a payment', 'Products', 'Day book'];
  window.money = function (v) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  window.DASH = {
    sales: 127690, cash: 44300, credit: 83390, bills: 16, gp: 11370, gpPct: 8.9, vsAvg: 339,
    receivable: 205350, accounts: 4, payable: 478480, suppliers: 5, cheques: 10000,
    spark: [42000, 51000, 38000, 61000, 47000, 55000, 30000, 44000, 58000, 39000, 127690 * 0.6, 49000, 52000, 127690],
    todo: [['The float counted', 'nobody has counted the drawer this morning', 'todo'], ['Supplier order to answer', 'Sample Cement Ltd — 40 bags', 'todo'], ['A cheque to bank', 'Rs 10,000.00 · Hill Top Builders', 'todo'], ['Credit approval', 'Silva Builders over limit by Rs 12,400', 'wait']],
    staff: [['Afridh', 'in'], ['Akmal', 'in'], ['Azhad', 'in'], ['Sales1', 'in'], ['Sales2', 'in'], ['Sales3', 'late'], ['Ravi', 'out']],
    top: [['Tokyo Super Cement 50kg', 42, 98700], ['Dulux Weathershield 4L', 6, 67350], ['GI Pipe 1/2" (6m)', 18, 21600], ['Kevilton Wire 1.5mm', 3, 16314], ['Paint Brush 4"', 22, 10560]],
    owing: [['Sunrise Wedding Hall', 729760, 14], ['Nimal Constructions', 696270, 49], ['Silva Builders', 662780, 47], ['Green Valley Constructions', 629280, 108]]
  };
  window.spark = function (w, h, col, fill) {
    var a = DASH.spark, mx = Math.max.apply(null, a), mn = Math.min.apply(null, a);
    var pts = a.map(function (v, i) { return [i / (a.length - 1) * w, h - 4 - (v - mn) / (mx - mn) * (h - 8)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    return '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + (fill ? '<path d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + 'Z" fill="' + fill + '"/>' : '') + '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
  };
  window.toast = function (t) {
    var el = document.getElementById('demoToast'); if (!el) { el = document.createElement('div'); el.id = 'demoToast'; document.body.appendChild(el); }
    el.textContent = t; el.className = 'on'; clearTimeout(el._t); el._t = setTimeout(function () { el.className = ''; }, 2000);
  };
  window.goPage = function (p) { if (p === 'Dashboard') return; toast('Opens ' + p); };
  // Ctrl+K: any page, by typing
  var pal = null, cur = 0, hits = [];
  function all() { var o = []; GROUPS.forEach(function (g) { g.pages.forEach(function (p) { o.push({ p: p, g: g }); }); }); return o; }
  // the letters typed, in order, anywhere in the name: "chq" finds Cheques in
  function inOrder(t, v) { var j = 0; for (var i = 0; i < t.length && j < v.length; i++) if (t[i] === v[j]) j++; return v.length > 1 && j === v.length; }
  function drawPal() {
    var v = pal.querySelector('input').value.trim().toLowerCase();
    hits = all().filter(function (x) { return !v || x.p.toLowerCase().indexOf(v) >= 0 || x.g.n.toLowerCase().indexOf(v) === 0 || x.p.toLowerCase().split(/\W+/).some(function (w) { return w.indexOf(v) === 0; }) || inOrder(x.p.toLowerCase(), v); }).slice(0, 9);
    cur = Math.min(cur, hits.length - 1);
    pal.querySelector('.pl').innerHTML = hits.map(function (x, i) { return '<div class="pi ' + (i === cur ? 'on' : '') + '" data-pi="' + i + '">' + ICON(x.g.k, 18) + '<b>' + x.p + '</b><span>' + x.g.n + '</span></div>'; }).join('') || '<div class="pn">No page by that name</div>';
  }
  window.openPal = function () {
    if (pal) return; pal = document.createElement('div'); pal.className = 'pal-wrap';
    pal.innerHTML = '<div class="pal">' + ICON('search', 20) + '<input placeholder="Go to any page — type a few letters" autocomplete="off"><kbd>Esc</kbd><div class="pl"></div></div>';
    document.body.appendChild(pal); cur = 0; drawPal(); var i = pal.querySelector('input'); i.focus();
    i.oninput = function () { cur = 0; drawPal(); };
    pal.onclick = function (e) { var r = e.target.closest('[data-pi]'); if (r) { var p = hits[+r.dataset.pi].p; closePal(); goPage(p); } else if (e.target === pal) closePal(); };
  };
  function closePal() { if (pal) { pal.remove(); pal = null; } }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPal(); return; }
    if (!pal) return;
    if (e.key === 'Escape') closePal();
    else if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(hits.length - 1, cur + 1); drawPal(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, cur - 1); drawPal(); }
    else if (e.key === 'Enter' && hits[cur]) { var p = hits[cur].p; closePal(); goPage(p); }
  });
  var css = document.createElement('style');
  css.textContent = '#demoToast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,30px);opacity:0;background:#1b1f22;color:#fff;padding:11px 18px;border-radius:12px;font:600 14px Inter,sans-serif;transition:.25s;z-index:99;pointer-events:none}#demoToast.on{opacity:1;transform:translate(-50%,0)}' +
    '.pal-wrap{position:fixed;inset:0;background:rgba(15,17,20,.45);z-index:50;display:flex;justify-content:center;padding-top:14vh;backdrop-filter:blur(2px)}' +
    '.pal{width:min(620px,92vw);height:max-content;background:#fff;border-radius:18px;box-shadow:0 30px 70px -20px rgba(0,0,0,.6);display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:0 16px;font-family:Inter,sans-serif;color:#1d2125}' +
    '.pal>svg{color:#AE1E2B}.pal input{height:62px;border:0;outline:0;font:600 18px Inter}.pal kbd{font:700 11px Inter;color:#6b7480;border:1px solid #e3e6ea;border-radius:6px;padding:2px 6px}' +
    '.pl{grid-column:1/-1;border-top:1px solid #eceef1;padding:8px 0 10px}.pi{display:flex;align-items:center;gap:12px;padding:10px 10px;border-radius:12px;cursor:pointer;color:#6b7480}.pi b{color:#1d2125;font-weight:600;flex:1}.pi span{font-size:12px}.pi.on{background:#AE1E2B;color:#fff}.pi.on b{color:#fff}.pn{padding:16px;color:#6b7480}';
  document.head.appendChild(css);
})();
