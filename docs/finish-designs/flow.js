/* Shared by the "end of a bill" demos (10 Nov 2026): the payment window, who sold it, and which bill to print.
   What the keys do is as on the till today; each demo draws it its own way through window.draw().
   The bill and the staff are made up. */
(function () {
  window.BILL = { no: '10241', total: 1990, lines: 3, cust: 'Walk-in customer', mobile: '' };
  window.METHODS = [['CASH', 'Cash', 'Enter'], ['CREDIT', 'Credit', 'C'], ['CARD', 'Card', 'A'], ['CHEQUE', 'Cheque', 'Q'], ['BANK', 'Bank transfer', 'B'], ['POINTS', 'Loyalty points', 'L'], ['VOUCHER', 'Gift voucher', 'V']];
  window.STAFF = [['', 'Nobody — cashier only', 'the bill stays with Afridh', ''], ['Nimal', 'Nimal', 'Sales', 'S1'], ['Kamal', 'Kamal', 'Sales', 'S2'], ['Sunil', 'Sunil', 'Sales', 'S3'],
    ['Afridh', 'Afridh', 'Super Admin', 'AF'], ['Ruwan', 'Ruwan', 'Admin / Director', 'RU'], ['Dinesh', 'Dinesh', 'Admin / Director', 'DI'], ['Priya', 'Priya', 'Management', 'PR']];
  window.PRINTS = [['r80', '80mm till receipt', '80mm thermal — quick for the counter'], ['a5', 'Printed bill', 'A5 — the full bill with outstanding boxes'], ['sms', 'e-Bill by text', 'no mobile on this bill'], ['none', 'No print', 'save the bill — nothing printed']];
  window.F = { step: 'pay', amt: '1990.00', pays: [], note: '', who: '', whoSel: 0, pr: 0, remember: true };
  window.money = function (v) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  window.paid = function () { return F.pays.reduce(function (a, p) { return a + p.amt; }, 0); };
  window.left = function () { return Math.max(0, +(BILL.total - paid()).toFixed(2)); };
  window.change = function () { var c = F.pays.filter(function (p) { return p.k === 'CASH'; }).reduce(function (a, p) { return a + p.amt; }, 0); return Math.max(0, +(paid() - BILL.total).toFixed(2)) && c ? +(paid() - BILL.total).toFixed(2) : 0; };
  window.creditAmt = function () { return F.pays.filter(function (p) { return p.k === 'CREDIT'; }).reduce(function (a, p) { return a + p.amt; }, 0); };
  window.staffHits = function () { var v = F.who.trim().toLowerCase(); return STAFF.filter(function (s) { return !v || (s[1] + ' ' + s[2] + ' ' + s[3]).toLowerCase().indexOf(v) >= 0; }); };
  window.addPay = function (k) {
    var a = +String(F.amt).replace(/[^\d.]/g, '') || 0; if (a <= 0) return;
    if (k !== 'CASH' && a > left() + 0.005) a = left();
    if (a <= 0) return toast('The bill is covered — press PRINT');
    F.pays.push({ k: k, amt: +a.toFixed(2) }); F.amt = left() ? left().toFixed(2) : ''; draw();
    if (!left()) { toast(change() ? 'Give change Rs ' + money(change()) + ' — press PRINT (P)' : 'Covered — press PRINT (P)'); }
  };
  window.finish = function () {
    if (left() > 0.005) return toast('Rs ' + money(left()) + ' still to take — or press C to put it on credit');
    F.step = 'who'; F.who = ''; F.whoSel = 0; draw(true);
  };
  window.pickWho = function (i) { var s = staffHits()[i]; if (!s) return; F.whoName = s[0]; F.step = 'print'; draw(true); toast(s[0] ? 'The bill counts towards ' + s[0] : 'The bill stays with Afridh'); };
  window.doPrint = function (i) { var p = PRINTS[i]; if (p[0] === 'sms' && !BILL.mobile) return toast('No mobile on this bill'); toast(p[0] === 'none' ? 'Saved — nothing printed' : 'Printing: ' + p[1]); setTimeout(reset, 1400); };
  window.reset = function () { F.step = 'pay'; F.pays = []; F.amt = BILL.total.toFixed(2); F.pr = 0; draw(true); };
  window.toast = function (t) {
    var el = document.getElementById('demoToast'); if (!el) { el = document.createElement('div'); el.id = 'demoToast'; document.body.appendChild(el); }
    el.textContent = t; el.className = 'on'; clearTimeout(el._t); el._t = setTimeout(function () { el.className = ''; }, 2200);
  };
  window.goStep = function (s) { F.step = s; draw(true); };
  document.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && t.id === 'amt', inNote = t && /note|ledger/.test(t.id || '');
    if (inNote) return;
    if (F.step === 'pay') {
      var k = e.key.toUpperCase();
      if (e.key === 'Enter') { e.preventDefault(); if (!left()) return finish(); addPay('CASH'); return; }
      if (e.key === 'Delete') { F.pays.pop(); F.amt = left().toFixed(2); draw(); return; }
      if (e.key === 'Escape') { toast('Back to the bill'); return; }
      var fk = { F11: 'CREDIT', F9: 'CARD', F8: 'CHEQUE', F7: 'BANK' }[e.key];
      if (fk) { e.preventDefault(); return addPay(fk); }
      if (!/^[A-Z]$/.test(k)) return;
      var m = { C: 'CREDIT', A: 'CARD', Q: 'CHEQUE', B: 'BANK', L: 'POINTS', V: 'VOUCHER' }[k];
      if (m) { e.preventDefault(); addPay(m); } else if (k === 'P') { e.preventDefault(); finish(); }
    } else if (F.step === 'who') {
      var L = staffHits();
      if (e.key === 'ArrowDown') { e.preventDefault(); F.whoSel = Math.min(L.length - 1, F.whoSel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); F.whoSel = Math.max(0, F.whoSel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); pickWho(F.whoSel); }
      else if (e.key === 'Escape') { e.preventDefault(); pickWho(0); }
    } else if (F.step === 'print') {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); F.pr = Math.min(3, F.pr + 1); if (PRINTS[F.pr][0] === 'sms' && !BILL.mobile) F.pr++; draw(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); F.pr = Math.max(0, F.pr - 1); if (PRINTS[F.pr][0] === 'sms' && !BILL.mobile) F.pr--; draw(); }
      else if (/^[1-4]$/.test(e.key)) { F.pr = +e.key - 1; draw(); doPrint(F.pr); }
      else if (e.key === 'Enter') { e.preventDefault(); doPrint(F.pr); }
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'amt') F.amt = e.target.value;
    if (e.target.id === 'who') { F.who = e.target.value; F.whoSel = 0; draw(); var w = document.getElementById('who'); w.focus(); w.setSelectionRange(w.value.length, w.value.length); }
    if (e.target.id === 'note') F.note = e.target.value;
  });
  document.addEventListener('click', function (e) {
    var x;
    if ((x = e.target.closest('[data-m]'))) return addPay(x.dataset.m);
    if ((x = e.target.closest('[data-q]'))) { var q = x.dataset.q, cur = +String(F.amt).replace(/[^\d.]/g, '') || 0; F.amt = (q === 'exact' ? left() : cur + +q).toFixed(2); return draw(); }
    if ((x = e.target.closest('[data-del]'))) { F.pays.splice(+x.dataset.del, 1); F.amt = left().toFixed(2); return draw(); }
    if ((x = e.target.closest('[data-w]'))) return pickWho(+x.dataset.w);
    if ((x = e.target.closest('[data-pr]'))) { F.pr = +x.dataset.pr; draw(); return doPrint(F.pr); }
    if ((x = e.target.closest('[data-step]'))) return goStep(x.dataset.step);
    if ((x = e.target.closest('[data-act]'))) { var a = x.dataset.act; if (a === 'print') finish(); if (a === 'undo') { F.pays.pop(); F.amt = left().toFixed(2); draw(); } if (a === 'rem') { F.remember = !F.remember; draw(); } }
  });
  var css = document.createElement('style');
  css.textContent = '#demoToast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,30px);opacity:0;background:#1b1f22;color:#fff;padding:11px 18px;border-radius:12px;font:600 14px Inter,sans-serif;transition:.25s;z-index:99;pointer-events:none}#demoToast.on{opacity:1;transform:translate(-50%,0)}' +
    '.till-bg{position:fixed;inset:0;background:#e9ecef;filter:blur(1.4px);display:flex}.till-bg aside{width:68px;background:linear-gradient(#4a0d14,#2a080c)}.till-bg main{flex:1;padding:10px;display:grid;grid-template-rows:84px 22px 1fr 46px;gap:10px}.till-bg main>div{background:#fff;border-radius:10px}.till-bg main>div:nth-child(2),.till-bg main>div:nth-child(4){background:#1b1f22}' +
    '.dim{position:fixed;inset:0;background:rgba(20,22,26,.48)}' +
    '.stepper{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:20;display:flex;gap:4px;background:rgba(20,22,26,.85);padding:5px;border-radius:999px;font:600 12.5px Inter,sans-serif}.stepper span{color:rgba(255,255,255,.65);padding:6px 14px;border-radius:999px;cursor:pointer}.stepper span.on{background:#fff;color:#1d2125}';
  document.head.appendChild(css);
  window.frame = function () {
    var b = document.createElement('div'); b.className = 'till-bg'; b.innerHTML = '<aside></aside><main><div></div><div></div><div></div><div></div></main>'; document.body.prepend(b);
    var d = document.createElement('div'); d.className = 'dim'; b.after(d);
    var s = document.createElement('div'); s.className = 'stepper'; s.id = 'stepper'; document.body.appendChild(s);
  };
  window.stepper = function () { var s = document.getElementById('stepper'); if (s) s.innerHTML = [['pay', '1 · Payment'], ['who', '2 · Who sold it'], ['print', '3 · The bill']].map(function (x) { return '<span data-step="' + x[0] + '" class="' + (F.step === x[0] ? 'on' : '') + '">' + x[1] + '</span>'; }).join(''); };
})();
