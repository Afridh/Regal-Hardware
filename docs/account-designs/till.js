/* Shared by the "Put on account" demos: the till behind the side sheet, a sample bill, and what the sheet does —
   pick the customer (search, arrows, Enter), then what is paid now, how, the paper, and Save. Each demo draws it
   its own way through window.draw(). The customers come from ../payment-designs/common.js and are made up. */
(function () {
  window.BILL = { total: 18450, lines: 3 };
  var regulars = CUST.filter(function (c) { return c.owed > 0; }).slice(0, 12);
  window.ST = { q: '', sel: 0, cust: null, paid: '', how: 'CASH', paper: 'a5', taken: '', allowed: false };
  window.cands = function () {
    var v = ST.q.trim(); return v ? CUST.filter(function (c) { return match(c, v); }).slice(0, 30) : regulars;
  };
  window.fig = function (c) {
    var paid = Math.min(+ST.paid || 0, BILL.total), on = +(BILL.total - paid).toFixed(2), after = c.owed + on;
    var over = c.limit > 0 && after > c.limit && !ST.allowed && on > 0;
    return { owes: c.owed, paid: paid, on: on, after: after, left: c.limit - after, over: over, overBy: after - c.limit, pctNow: c.limit ? Math.min(100, c.owed / c.limit * 100) : 0, pctAfter: c.limit ? Math.min(100, after / c.limit * 100) : 0 };
  };
  window.HOWS = [['CASH', 'Cash'], ['CARD', 'Card'], ['BANK', 'Transfer'], ['CHEQUE', 'Cheque']];
  window.PAPERS = [['a5', 'Large A5'], ['sms', 'e-Bill text'], ['none', 'No print']];
  window.paperWord = function (k) { return { a5: 'large A5 bill', sms: 'e-bill by text', none: 'no print' }[k]; };
  window.pick = function (c) { ST.cust = c; ST.paid = ''; ST.allowed = false; draw(true); };
  window.save = function () {
    var c = ST.cust; if (!c) return; var f = fig(c);
    if (f.over) return toast('Over their limit — an admin allows it first');
    toast((f.paid ? 'Took ' + money(f.paid) + ' · ' : '') + money(f.on) + ' on ' + c.name + '\'s account — ' + paperWord(ST.paper));
  };
  window.till = function () {
    var b = document.createElement('div'); b.className = 'till-behind';
    b.innerHTML = '<aside></aside><main><div class="tb-top"><div class="tb-card"><b>WALK-IN CUSTOMER</b><span>no account · tap or F3 to choose</span></div><div class="tb-card small"></div></div><div class="tb-bar"></div>' +
      '<div class="tb-tbl"><div class="tb-h"></div><div class="tb-r">SELF BRACKET 10X12 EACH<span>1</span><span>4,150.00</span></div><div class="tb-r">GI PIPE 1/2" (6M)<span>2</span><span>9,600.00</span></div><div class="tb-r">BOLT &amp; NUT M10 (BOX)<span>1</span><span>4,700.00</span></div></div>' +
      '<div class="tb-keys"><i>CLEAR</i><i>HOLD</i><i>ON HOLD</i><i class="b">CUSTOMER</i><i class="b">DISCOUNT</i><i>ON ACCOUNT</i></div></main>';
    document.body.prepend(b);
  };
  var css = document.createElement('style');
  css.textContent = '.till-behind{position:fixed;inset:0;display:flex;background:#e9ecef;filter:blur(1.4px);z-index:0;font:600 13px Inter,sans-serif;color:#333}.till-behind aside{width:68px;background:linear-gradient(#4a0d14,#2a080c)}.till-behind main{flex:1;padding:10px;display:flex;flex-direction:column;gap:10px}' +
    '.tb-top{display:flex;gap:10px}.tb-card{flex:1;background:#fff;border-radius:10px;padding:14px;height:84px}.tb-card b{display:block;font:800 16px Archivo,sans-serif}.tb-card span{font-size:11px;color:#888}.tb-card.small{flex:.5}.tb-bar{height:22px;background:#1b1f22;border-radius:6px}' +
    '.tb-tbl{flex:1;background:#fff;border-radius:10px;overflow:hidden}.tb-h{height:32px;background:#1b1f22}.tb-r{display:flex;gap:40px;padding:12px 40px;border-bottom:1px solid #eee;background:#fbf4dc}.tb-r span{margin-left:auto}.tb-r span+span{margin-left:0}' +
    '.tb-keys{display:flex;gap:8px}.tb-keys i{flex:1;height:46px;border-radius:8px;background:#1b1f22;color:#fff;display:grid;place-items:center;font-style:normal;font-weight:800}.tb-keys i.b{background:#24476b}' +
    '.dim{position:fixed;inset:0;background:rgba(20,22,26,.42);z-index:1}';
  document.head.appendChild(css);
  document.addEventListener('keydown', function (e) {
    var t = e.target, inBox = t && /INPUT|SELECT/.test(t.tagName);
    if (!ST.cust) {
      var L = cands();
      if (e.key === 'ArrowDown') { e.preventDefault(); ST.sel = Math.min(L.length - 1, ST.sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); ST.sel = Math.max(0, ST.sel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (L[ST.sel]) pick(L[ST.sel]); }
      else if (e.key === 'Escape') { if (ST.q) { ST.q = ''; ST.sel = 0; draw(true); } else toast('Closes the sheet'); }
    } else {
      if (e.key === 'Enter' && !(t && t.id === 'pin')) { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { ST.cust = null; draw(true); }
      else if (!inBox && /^[1-4]$/.test(e.key)) { ST.how = HOWS[+e.key - 1][0]; draw(); }
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q') { ST.q = e.target.value; ST.sel = 0; draw(); var n = document.getElementById('q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    if (e.target.id === 'paid') { ST.paid = e.target.value.replace(/[^\d.]/g, ''); draw(); var p = document.getElementById('paid'); p.focus(); p.setSelectionRange(p.value.length, p.value.length); }
    if (e.target.id === 'taken') ST.taken = e.target.value;
  });
  document.addEventListener('click', function (e) {
    var x = e.target.closest('[data-c]'); if (x) return pick(cands()[+x.dataset.c]);
    var h = e.target.closest('[data-how]'); if (h) { ST.how = h.dataset.how; return draw(); }
    var p = e.target.closest('[data-paper]'); if (p) { ST.paper = p.dataset.paper; return draw(); }
    var a = e.target.closest('[data-act]'); if (!a) return;
    var k = a.dataset.act;
    if (k === 'back') { ST.cust = null; draw(true); }
    else if (k === 'save') save();
    else if (k === 'half') { ST.paid = String(Math.round(BILL.total / 2)); draw(); }
    else if (k === 'nothing') { ST.paid = ''; draw(); }
    else if (k === 'allow') { ST.allowed = true; draw(); toast('Allowed by Afridh'); }
    else if (k === 'close') toast('Closes the sheet');
    else if (k === 'new') toast('Opens New customer');
  });
})();
