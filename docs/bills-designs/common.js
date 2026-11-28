/* Shared by the Bills screen demos: sample bills (as on the till on 9 Nov 2026), the side menu, and small helpers.
   The figures are samples; nothing here talks to the shop. */
(function () {
  var L20207 = [['8434', 'CAT 6 WIRE', 305, 0, 270], ['8434', 'EARTH WIRE 10MM', 95, 0, 895], ['8434', 'MAIN WIRE 16MM SINGLE BLUE', 100, 0, 1325],
    ['8434', 'MAIN WIRE 16MM SINGLE BROWN', 200, 0, 1325], ['8071', '1" CONDUITE PIPE-NORMAL', 15, 290, 220], ['1735', 'SINGLE SUN BOX KEVILTON', 70, 155, 140],
    ['1736', 'DOUBLE SUN BOX KEVILTON', 40, 210, 190], ['2210', 'KELANI CABLE 2.5MM RED (100M)', 6, 24500, 23800], ['2211', 'KELANI CABLE 2.5MM BLACK (100M)', 6, 24500, 23800],
    ['3302', 'MCB 32A SINGLE POLE', 24, 3000, 2750], ['3303', 'MCB 63A DOUBLE POLE', 6, 9800, 9200], ['4410', 'DB BOX 12 WAY', 4, 18500, 17400],
    ['4411', 'RCCB 63A 30MA', 4, 21500, 20600], ['5120', 'LED PANEL 18W ROUND', 60, 1450, 1290], ['5121', 'LED BULB 12W B22', 120, 690, 600],
    ['6001', 'CEILING ROSE WHITE', 80, 120, 100], ['6002', '13A SOCKET KUMBUK', 45, 1760, 1420], ['6003', '1 GANG 1 WAY SWITCH KUMBUK', 70, 1480, 1190],
    ['7001', 'PVC TAPE BLACK', 50, 120, 95], ['7002', 'GI JUNCTION BOX 4"', 30, 450, 390]];
  var line = function (r) { return { code: r[0], name: r[1], qty: r[2], mrp: r[3], price: r[4], amount: r[2] * r[4] }; };
  var BILLS = [
    { no: '20207', time: '12:21:38 pm', day: 'Today', cust: 'FAIZAL MAMA WEDDING HALL', phone: '0704804274', by: 'Azhad', type: 'credit', lines: L20207.map(line), paid: 0, gp: 656339.58, gpPct: 73.9, other: 428285, cam: '12:21 pm' },
    { no: '10212', time: '12:17:04 pm', day: 'Today', cust: 'DARMASIRI TRADING & HARDWARE STORES', phone: '0716844165', by: 'Afridh', type: 'credit', lines: [line(['2210', 'KELANI CABLE 2.5MM RED (100M)', 1, 12300, 11850])], paid: 0, gp: 480, gpPct: 4.1, other: 0, cam: '12:17 pm' },
    { no: '10211', time: '11:59:33 am', day: 'Today', cust: '', phone: '', by: 'Afridh', type: 'cash', lines: [line(['5121', 'LED BULB 12W B22', 6, 690, 600]), line(['6002', '13A SOCKET KUMBUK', 2, 1760, 1420]), line(['7001', 'PVC TAPE BLACK', 4, 120, 95])], paid: 6900, gp: 881, gpPct: 12.8, other: 0, cam: '11:59 am' },
    { no: '20206', time: '11:51:46 am', day: 'Today', cust: '', phone: '', by: 'Azhad', type: 'cash', lines: [line(['6003', '1 GANG 1 WAY SWITCH KUMBUK', 1, 1480, 1190]), line(['6001', 'CEILING ROSE WHITE', 10, 120, 101])], paid: 2200, gp: 334.8, gpPct: 15.2, other: 0, cam: '11:51 am' },
    { no: '20205', time: '11:41:06 am', day: 'Today', cust: '', phone: '', by: 'Azhad', type: 'cash', lines: [line(['3302', 'MCB 32A SINGLE POLE', 10, 3000, 2750]), line(['4410', 'DB BOX 12 WAY', 2, 18500, 17400]), line(['5120', 'LED PANEL 18W ROUND', 12, 1450, 1290])], paid: 81920, gp: 5440, gpPct: 6.6, other: 0, cam: '11:41 am' },
    { no: '10210', time: '11:20:12 am', day: 'Today', cust: 'NIMAL CONSTRUCTIONS (PVT) LTD — POLONNARUWA SITE', phone: '0771234567', by: 'Afridh', type: 'credit', lines: [line(['8071', '1" CONDUITE PIPE-NORMAL', 120, 290, 220]), line(['1735', 'SINGLE SUN BOX KEVILTON', 40, 155, 140])], paid: 10000, gp: 3120, gpPct: 9.1, other: 138700, cam: '11:20 am' },
    { no: '20204', time: '10:58:40 am', day: 'Today', cust: 'SUNIL ELECTRICALS', phone: '0752223344', by: 'Azhad', type: 'cash', lines: [line(['5121', 'LED BULB 12W B22', 24, 690, 600])], paid: 14400, gp: 1680, gpPct: 11.7, other: 0, cam: '10:58 am' },
    { no: '10209', time: '10:31:02 am', day: 'Today', cust: 'KAMAL STORES', phone: '0779988776', by: 'Afridh', type: 'credit', lines: [line(['6002', '13A SOCKET KUMBUK', 4, 1760, 1420])], paid: 5680, gp: 600, gpPct: 10.6, other: 23460, cam: '10:31 am' },
    { no: '20203', time: '5:48:15 pm', day: 'Yesterday', cust: '', phone: '', by: 'Azhad', type: 'cash', lines: [line(['7002', 'GI JUNCTION BOX 4"', 3, 450, 390])], paid: 1170, gp: 150, gpPct: 12.8, other: 0, cam: '5:48 pm' },
    { no: '10208', time: '4:02:51 pm', day: 'Yesterday', cust: 'ROHANA STORES', phone: '0713456789', by: 'Afridh', type: 'credit', lines: [line(['2211', 'KELANI CABLE 2.5MM BLACK (100M)', 2, 24500, 23800])], paid: 0, gp: 2400, gpPct: 5, other: 61200, cam: '4:02 pm' }
  ];
  BILLS.forEach(function (b) { b.items = b.lines.length; b.qty = b.lines.reduce(function (a, l) { return a + l.qty; }, 0);
    b.total = b.lines.reduce(function (a, l) { return a + l.amount; }, 0); b.gross = b.total; b.disc = 0; if (b.type === 'cash') b.paid = b.total; b.balance = Math.max(0, b.total - b.paid); });
  var rs = function (n, dp) { return (+n || 0).toLocaleString('en-LK', { minimumFractionDigits: dp === 0 ? 0 : 2, maximumFractionDigits: dp === 0 ? 0 : 2 }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var initials = function (n) { return String(n || 'W').split(/\s+/).filter(function (w) { return /^[A-Z]/i.test(w); }).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); };
  /* the till's red side menu, so each demo sits in the screen as it really is */
  var SIDE = '<nav class="side" aria-label="Menu"><span class="rh">RH</span>' + ['home', 'grid', 'bell', 'star', 'gap', 'bag', 'bills', 'doc', 'back', 'file', 'grid', 'truck'].map(function (k) {
    if (k === 'gap') return '<i class="gap"></i>';
    var P = { home: 'M3 11l9-7 9 7v9H3z', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', bell: 'M12 3a6 6 0 016 6c0 5 2 6 2 7H4c0-1 2-2 2-7a6 6 0 016-6zM10 19a2 2 0 004 0', star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
      bag: 'M5 8h14l-1.5 12h-11zM9 8V6a3 3 0 016 0v2', bills: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', doc: 'M7 3h7l5 5v13H7zM14 3v5h5', back: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3', file: 'M7 3h10v18H7zM10 8h4M10 12h4M10 16h2', truck: 'M3 8h11v9H3zM14 11h4l3 3v3h-7z' }[k];
    return '<span class="si' + (k === 'bills' ? ' on' : '') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + P + '"/></svg></span>';
  }).join('') + '<span class="me">A</span></nav>';
  var SIDE_CSS = '.side{position:fixed;left:0;top:0;bottom:0;width:68px;background:linear-gradient(180deg,#3a0d12,#2a080c);display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 0;z-index:5}' +
    '.side .rh{width:40px;height:40px;border-radius:12px;background:#c62833;color:#fff;font:800 14px system-ui;display:grid;place-items:center;margin-bottom:10px}' +
    '.side .si{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#e9c9cc}.side .si svg{width:20px;height:20px}.side .si.on{background:#c62833;color:#fff;box-shadow:0 6px 16px rgba(198,40,51,.45)}' +
    '.side .gap{height:18px}.side .me{margin-top:auto;width:36px;height:36px;border-radius:50%;background:#c62833;color:#fff;font:800 14px system-ui;display:grid;place-items:center}' +
    '.demo-back{position:fixed;right:12px;bottom:8px;z-index:9;font:600 12px system-ui;color:#888;text-decoration:none}.demo-back:hover{color:#111}' +
    '.h-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,20px);opacity:0;z-index:99;background:#111;color:#fff;font:600 14px system-ui;padding:10px 18px;border-radius:999px;transition:opacity .2s,transform .3s cubic-bezier(.34,1.56,.64,1);pointer-events:none}.h-toast.on{opacity:1;transform:translate(-50%,0)}';
  var st = document.createElement('style'); st.textContent = SIDE_CSS; document.head.appendChild(st);
  var tt; function toast(m) { var t = document.querySelector('.h-toast'); if (!t) { t = document.createElement('div'); t.className = 'h-toast'; document.body.appendChild(t); } t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('on'); }, 1600); }
  /* the list: search and the filter chips, shared by all three */
  function filtered(q, f) {
    q = (q || '').trim().toLowerCase();
    return BILLS.filter(function (b) {
      if (f === 'cash' && b.type !== 'cash') return false; if (f === 'credit' && b.type !== 'credit') return false; if (f === 'out' && !(b.balance > 0)) return false;
      if (!q) return true; return (b.no + ' ' + b.cust + ' ' + b.phone + ' ' + b.lines.map(function (l) { return l.name; }).join(' ') + ' ' + b.total).toLowerCase().indexOf(q) >= 0;
    });
  }
  /* actions in the demo say what they would do */
  document.addEventListener('click', function (e) { var a = e.target.closest('[data-do]'); if (a) { e.preventDefault(); toast(a.dataset.do); } });
  window.B = { BILLS: BILLS, rs: rs, esc: esc, initials: initials, SIDE: SIDE, toast: toast, filtered: filtered,
    totals: { bills: 478, billed: 4564238.85, out: 2844972.75 } };
})();
