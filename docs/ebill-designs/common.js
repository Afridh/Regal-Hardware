/* What the five bill-page designs share: the sample bill and its four kinds, the switch at the top, the rating,
   Save as PDF and Share, button ripples, the count-up and the rolling digits. Each design draws its own page. */
(function () {
  'use strict';
  var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var rs = function (n) { return (+n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var LINES = [
    { name: 'Kevilton 13A Socket — Kumbuk', qty: 4, price: 1420, mrp: 1760 },
    { name: 'Kevilton 2 Gang 1 Way Switch — Kumbuk', qty: 3, price: 1190, mrp: 1480 },
    { name: 'Nippon Paint Vinyl Silk 4L', qty: 2, price: 6800, mrp: 7350 },
    { name: 'S-lon Elbow 90° 20 mm', qty: 12, price: 75, mrp: 90 },
    { name: 'Kelani Cable 1/1.13 Red (per m)', qty: -5, price: 58, mrp: 0 }
  ];
  var total = LINES.reduce(function (a, l) { return a + l.qty * l.price; }, 0);
  var saved = LINES.reduce(function (a, l) { return a + (l.mrp > l.price && l.qty > 0 ? (l.mrp - l.price) * l.qty : 0); }, 0);
  var STATES = {
    cash: { k: 'cash', kind: 'Cash bill', no: '20215', who: '', word: 'Paid', label: 'Paid in full', sub: 'Cash and card', pays: [['Cash', 15960], ['Card · HNB', 7500]], due: 0, amount: total },
    credit: { k: 'credit', kind: 'Credit bill', no: '20216', who: 'Kamal Stores', word: 'To pay', label: 'On your account', sub: 'Rs ' + rs(total) + ' to pay', pays: [['On account', total]], due: total, amount: total,
      acct: { owes: 84650, bills: [['20216', 23460], ['20188', 38400], ['20152', 22790]] } },
    void: { k: 'void', kind: 'Cancelled bill', no: '20217', who: '', word: 'Cancelled', label: 'Cancelled', sub: 'Nothing is owed', pays: [], due: 0, amount: 0, isVoid: true },
    quote: { k: 'quote', kind: 'Quotation', no: 'QTN-00021', who: '', word: 'Quote', label: 'Quotation', sub: 'Valid until 22 Nov 2026', pays: [], due: 0, amount: total, isQuote: true }
  };
  var MARK = '<svg viewBox="0 0 500 430" aria-hidden="true"><path d="M246 12 375 235H270L375 414H318L220 235 260 190H300L246 100 95 414H38ZM192 280 272 414H222L168 324ZM142 370 168 414H116ZM350 280H403L480 414H428Z"/></svg>';
  var ICON = {
    call: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.8 21 3 13.2 3 3.9c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>',
    dl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3zM4 19h16v2H4z"/></svg>',
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.7 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-5-4.3-5.1-4.5-.2-.2-1.2-1.6-1.2-3s.8-2.2 1-2.5c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.2.5.1.6 0l.9-1c.2-.3.4-.2.6-.1l2 .9c.3.2.5.2.5.4.1.1.1.7-.1 1.4z"/></svg>',
    bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7V6a6 6 0 0 1 12 0v1h3l-1 15H4L3 7zm2 0h8V6a4 4 0 0 0-8 0z"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
    tick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12l-8 8-9-9V4h7z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>'
  };
  var TAGS = { low: ['Long wait', 'Not in stock', 'Price', 'Staff', 'Billing mistake'], high: ['Friendly staff', 'Quick service', 'Good prices', 'Found everything', 'Good advice'] };

  (function css() {
    var st = document.createElement('style');
    st.textContent = '.ebdemo{position:sticky;top:0;z-index:90;background:#000;color:#f4efe9;font:500 13px/1.3 system-ui,sans-serif;padding:7px 10px;display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap}' +
      '.ebdemo b{color:#ffcf5a}.ebdemo a{color:#f4efe9;opacity:.75;text-decoration:underline;margin-right:4px}.ebdemo button{border:1px solid rgba(255,255,255,.25);background:transparent;border-radius:999px;padding:4px 11px;font:inherit;font-size:12.5px;color:#f4efe9;cursor:pointer}' +
      '.ebdemo button[aria-pressed=true]{background:#f4efe9;color:#000}' +
      '.eb-rip{position:absolute;border-radius:50%;background:currentColor;opacity:.22;transform:scale(0);pointer-events:none;animation:ebrip .6s cubic-bezier(.22,1,.36,1) forwards}@keyframes ebrip{to{transform:scale(1);opacity:0}}' +
      '.odo{display:inline-block;height:1em;overflow:hidden;line-height:1;vertical-align:top}.odo>span{display:flex;flex-direction:column;will-change:transform}.odo>span>span{height:1em;line-height:1;display:block}' +
      '@media print{.ebdemo{display:none!important}}';
    document.head.appendChild(st);
  })();

  /* the switch at the top: the demo's, not the page's */
  function switcher(name, draw) {
    var bar = document.createElement('div'); bar.className = 'ebdemo'; bar.setAttribute('role', 'note');
    bar.innerHTML = '<a href="./">All 5</a><b>' + esc(name) + '</b> · show: ' + ['cash', 'credit', 'void', 'quote'].map(function (k, i) {
      return '<button type="button" data-k="' + k + '" aria-pressed="' + (i === 0) + '">' + ({ cash: 'Cash bill', credit: 'Credit bill', void: 'Cancelled', quote: 'Quotation' })[k] + '</button>';
    }).join('');
    document.body.insertBefore(bar, document.body.firstChild);
    bar.querySelectorAll('[data-k]').forEach(function (b) {
      b.onclick = function () { bar.querySelectorAll('[data-k]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); scrollTo(0, 0); draw(STATES[b.dataset.k]); };
    });
    draw(STATES.cash);
  }
  /* ripples on anything marked .rp (the page sets position and overflow) */
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest('.rp'); if (!el || reduce) return;
    var r = el.getBoundingClientRect(), sz = Math.max(r.width, r.height) * 2.2, sp = document.createElement('span');
    sp.className = 'eb-rip'; sp.style.cssText = 'width:' + sz + 'px;height:' + sz + 'px;left:' + (e.clientX - r.left - sz / 2) + 'px;top:' + (e.clientY - r.top - sz / 2) + 'px';
    el.appendChild(sp); setTimeout(function () { sp.remove(); }, 650);
  }, { passive: true });
  /* a number counting up, easeOutCubic; the final value is what is shown without motion */
  function countUp(el, to, ms, delay) {
    if (!el) return; if (reduce || !to) { el.textContent = rs(to); return; }
    el.textContent = rs(0); var t0 = null;
    setTimeout(function () { requestAnimationFrame(function f(ts) { if (t0 === null) t0 = ts; var p = Math.min(1, (ts - t0) / (ms || 1500)), e = 1 - Math.pow(1 - p, 3); el.textContent = rs(to * e); if (p < 1) requestAnimationFrame(f); }); }, delay || 0);
  }
  /* digits that roll into place like a till's display, each a little later than the one before */
  function odometer(el, text, delay) {
    if (!el) return; if (reduce) { el.textContent = text; return; }
    el.innerHTML = ''; var cols = [];
    String(text).split('').forEach(function (ch, i) {
      if (/\d/.test(ch)) {
        var c = document.createElement('span'); c.className = 'odo';
        c.innerHTML = '<span>' + '0123456789'.split('').map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</span>';
        el.appendChild(c); cols.push([c.firstChild, +ch, i]);
      } else { var s = document.createElement('span'); s.textContent = ch; el.appendChild(s); }
    });
    setTimeout(function () { cols.forEach(function (x) { x[0].style.transition = 'transform ' + (1.1 + x[2] * 0.07).toFixed(2) + 's cubic-bezier(.2,.9,.1,1)'; x[0].style.transform = 'translateY(-' + x[1] + 'em)'; }); }, delay || 0);
  }
  /* the rating: buttons marked [data-rate] (1-5), then the reasons, a note, and Send */
  function rating(root, o) {
    o = o || {};
    var btns = root.querySelectorAll('[data-rate]'), more = root.querySelector('[data-more]');
    btns.forEach(function (b) {
      b.onclick = function () {
        var r = +b.dataset.rate;
        btns.forEach(function (x) { var on = o.single ? x === b : +x.dataset.rate <= r; x.classList.toggle('on', on); x.setAttribute('aria-checked', x === b); });
        b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
        var list = r <= 3 ? TAGS.low : TAGS.high;
        more.innerHTML = '<div class="' + (o.tagsClass || 'tags') + '">' + list.map(function (t, i) { return '<button type="button" class="' + (o.tagClass || 'tg') + ' rp" style="animation-delay:' + (i * 45) + 'ms">' + esc(t) + '</button>'; }).join('') + '</div>' +
          '<textarea class="' + (o.noteClass || 'fbnote') + '" rows="2" placeholder="' + (r <= 3 ? 'What went wrong? The owner reads every one.' : 'Anything else? (optional)') + '"></textarea>' +
          '<button class="' + (o.sendClass || 'btn') + ' rp" type="button" data-send>Send</button>';
        more.querySelectorAll('.' + (o.tagClass || 'tg')).forEach(function (g) { g.onclick = function () { g.classList.toggle('on'); }; });
        more.querySelector('[data-send]').onclick = function () {
          more.innerHTML = '<div class="' + (o.thanksClass || 'thanks') + '">' + ICON.tick + '<span>Thank you — the owner has it.</span></div>';
          btns.forEach(function (x) { x.disabled = true; });
        };
      };
    });
  }
  /* Save as PDF, Share, and the demo-only links */
  function wireActions(root, b) {
    root.querySelectorAll('[data-pdf]').forEach(function (x) { x.onclick = function () { window.print(); }; });
    root.querySelectorAll('[data-share]').forEach(function (x) {
      x.onclick = function () {
        var d = { title: 'My bill from Regal Hardware', text: (b.isQuote ? 'Quotation ' : 'Bill ') + b.no + ' from Regal Hardware', url: location.href };
        if (navigator.share) navigator.share(d).catch(function () {}); else window.open('https://wa.me/?text=' + encodeURIComponent(d.text + ' ' + d.url), '_blank', 'noopener');
      };
    });
    root.querySelectorAll('[data-demo]').forEach(function (x) { x.onclick = function (e) { e.preventDefault(); alert('On the live page this opens for real.'); }; });
  }
  function lineHTML(l, i, cls) {
    var a = l.qty * l.price;
    return '<div class="' + (cls || 'ln') + (l.qty < 0 ? ' ret' : '') + '" style="--i:' + i + '"><span class="n">' + esc(l.name) + (l.qty < 0 ? ' <em>returned</em>' : '') + '</span>' +
      '<span class="q">' + Math.abs(l.qty) + ' × ' + rs(l.price) + (l.mrp > l.price && l.qty > 0 ? ' <s>' + rs(l.mrp) + '</s>' : '') + '</span>' +
      '<span class="a">' + (a < 0 ? '− ' : '') + rs(Math.abs(a)) + '</span></div>';
  }
  window.EB = { reduce: reduce, esc: esc, rs: rs, LINES: LINES, total: total, saved: saved, STATES: STATES, MARK: MARK, ICON: ICON,
    switcher: switcher, countUp: countUp, odometer: odometer, rating: rating, wireActions: wireActions, lineHTML: lineHTML,
    when: '8 Nov 2026 · 10:28 am', by: 'Azhad', shop: { name: 'Regal Hardware', addr: '748, Main Street, Kaduruwela', phone: '077 222 22 59', tel: 'tel:+94772222259', hours: '8am to 7pm' } };
})();
