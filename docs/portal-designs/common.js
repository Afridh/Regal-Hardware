/* Small helpers shared by the two portal demos: ripples, the big word, counting up, the tab bar. */
(function () {
  var calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var rs = function (n) { return (+n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var MARK = '<svg viewBox="0 0 500 430" aria-hidden="true"><path d="M246 12 375 235H270L375 414H318L220 235 260 190H300L246 100 95 414H38ZM192 280 272 414H222L168 324ZM142 370 168 414H116ZM350 280H403L480 414H428Z"/></svg>';
  var I = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    pay: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
    me: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
    out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    wa: '<path d="M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-3.9-1z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 01-1.8-1.8l.8-1-1-2z"/>',
    cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
  };
  var icon = function (k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + I[k] + '</svg>'; };
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest('.rp,.btn,.chip,.tabs button'); if (!el || calm) return;
    var r = el.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement('span');
    s.className = 'ripple'; s.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (e.clientX - r.left - d / 2) + 'px;top:' + (e.clientY - r.top - d / 2) + 'px';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.overflow = 'hidden'; el.appendChild(s); setTimeout(function () { s.remove(); }, 650);
  });
  function word(w, gold) {
    return '<div class="wrapw"><h1 class="disp word' + (gold ? ' gold' : '') + '" style="--n:' + Math.max(w.length, 4) + '" aria-label="' + esc(w) + '">' +
      w.split('').map(function (c, i) { return '<span style="--i:' + i + '">' + (c === ' ' ? '&nbsp;' : esc(c)) + '</span>'; }).join('') + '</h1></div>';
  }
  function band(text) { var s = ''; for (var i = 0; i < 10; i++) s += '<span>' + esc(text) + '</span>'; return '<div class="band" aria-hidden="true"><div>' + s + '</div></div>'; }
  function countUp(el, to, ms, delay) {
    if (!el) return; if (calm) { el.textContent = rs(to); return; }
    el.textContent = rs(0);
    setTimeout(function () {
      var t0 = performance.now();
      (function step(t) { var p = Math.min(1, (t - t0) / ms), e = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p); el.textContent = rs(to * e); if (p < 1) requestAnimationFrame(step); })(t0);
    }, delay || 0);
  }
  /* the tab bar: a red pill glides to the tab pressed; the page changes with a view transition where the phone has one */
  function tabs(root, list, onPick) {
    root.innerHTML = '<span class="glide"></span>' + list.map(function (t) { return '<button type="button" data-tab="' + t[0] + '">' + icon(t[1]) + '<span>' + esc(t[2]) + '</span>' + (t[3] ? '<i>' + t[3] + '</i>' : '') + '</button>'; }).join('');
    var glide = root.querySelector('.glide');
    function set(k, first) {
      root.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === k); });
      var b = root.querySelector('[data-tab="' + k + '"]'); glide.style.left = b.offsetLeft + 'px'; glide.style.width = b.offsetWidth + 'px';
      b.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      var go = function () { onPick(k); if (!first) window.scrollTo({ top: document.querySelector('.sheet').offsetTop - 70, behavior: calm ? 'auto' : 'smooth' }); };
      if (!first && document.startViewTransition && !calm) document.startViewTransition(go); else go();
    }
    root.querySelectorAll('button').forEach(function (b) { b.onclick = function () { set(b.dataset.tab); }; });
    window.addEventListener('resize', function () { var on = root.querySelector('.on'); if (on) { glide.style.left = on.offsetLeft + 'px'; glide.style.width = on.offsetWidth + 'px'; } });
    return set;
  }
  function over(html) {
    var o = document.createElement('div'); o.className = 'over';
    o.innerHTML = '<div class="box" role="dialog" aria-modal="true"><div class="grab" style="margin:-8px auto 16px"></div>' + html + '<button class="btn wide ink" type="button" data-x>Close</button></div>';
    o.onclick = function (e) { if (e.target === o || e.target.closest('[data-x]')) o.remove(); };
    document.body.appendChild(o); return o;
  }
  function done(el, text) { el.innerHTML = '<div class="done"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>' + esc(text) + '</span></div>'; }
  window.P = { calm: calm, esc: esc, rs: rs, MARK: MARK, icon: icon, word: word, band: band, countUp: countUp, tabs: tabs, over: over, done: done };
})();
