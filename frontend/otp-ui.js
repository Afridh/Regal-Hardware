/* The mobile number and the texted code, made pleasant to type — on the customers' page (/my) and the
   suppliers' page (/supplier).

   It dresses up the page's own inputs rather than replacing them: the original input stays in the page
   (hidden, for the code) and keeps the value, so everything that reads it carries on as before.

     <input data-phone>                      the mobile: spaced as typed (077 123 4567), the network
                                             shown as soon as the first digits say it, a tick when complete
     <input data-otp data-otp-go="#btn">     six boxes; typing, pasting or the phone's own "fill from
                                             message" all fill them; the sixth digit presses the button
     <input data-otp data-otp-next="#pass">  …or moves on to the next box instead

   RegalOTP.auto(root) dresses everything under root (safe to call again after a redraw).
   RegalOTP.fail(sel) shakes the boxes red and clears them; RegalOTP.ok(sel) turns them green. */
(function () {
  if (window.RegalOTP) return;
  const css = `
.ro-phone{position:relative;display:flex;align-items:center;gap:8px;border:2px solid #E8DEDE;border-radius:14px;background:#fff;padding:0 12px;transition:border-color .2s,box-shadow .2s;animation:ro-in .4s cubic-bezier(.2,.9,.25,1.15) both}
.ro-phone:focus-within{border-color:#AE1E2B;box-shadow:0 0 0 4px rgba(174,30,43,.12)}
.ro-phone.good{border-color:#1e8a5a;box-shadow:0 0 0 4px rgba(30,138,90,.12)}
.ro-phone .ro-ic{font-size:20px;flex:none;transition:transform .3s}
.ro-phone:focus-within .ro-ic{animation:ro-ring .6s ease 1}
.ro-phone input{flex:1;min-width:0;border:0!important;outline:0;background:transparent!important;box-shadow:none!important;font:700 20px/1 'Archivo',system-ui,sans-serif!important;letter-spacing:.06em;padding:14px 0!important;margin:0!important;color:#1c1214}
.ro-phone input::placeholder{color:#cdbfc0;font-weight:600;letter-spacing:.04em}
.ro-net{flex:none;font:800 11px/1 system-ui,sans-serif;letter-spacing:.04em;color:#fff;padding:5px 9px;border-radius:999px;transform:scale(0);opacity:0;transition:transform .35s cubic-bezier(.2,.9,.25,1.5),opacity .2s}
.ro-net.on{transform:scale(1);opacity:1}
.ro-tick{flex:none;width:26px;height:26px;border-radius:50%;background:#1e8a5a;display:grid;place-items:center;transform:scale(0);transition:transform .35s cubic-bezier(.2,.9,.25,1.6)}
.ro-tick svg{width:15px;height:15px;stroke:#fff;stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:24;stroke-dashoffset:24}
.ro-phone.good .ro-tick{transform:scale(1)}.ro-phone.good .ro-tick svg{animation:ro-draw .4s .15s ease forwards}
.ro-hint{font-size:12.5px;color:#B42318;margin-top:6px;min-height:16px;transition:opacity .2s}
.ro-code{display:flex;gap:8px;justify-content:center;margin:6px 0 2px}
.ro-code input{width:46px!important;height:58px;padding:0!important;text-align:center;font:800 26px/1 'Archivo',system-ui,sans-serif!important;color:#1c1214;border:2px solid #E8DEDE!important;border-radius:14px!important;background:#fff!important;outline:0;caret-color:#AE1E2B;
  transition:border-color .15s,box-shadow .15s,transform .15s,background .3s;animation:ro-in .45s cubic-bezier(.2,.9,.25,1.3) both;margin:0!important}
.ro-code input:nth-child(2){animation-delay:.05s}.ro-code input:nth-child(3){animation-delay:.1s}.ro-code input:nth-child(4){animation-delay:.15s}.ro-code input:nth-child(5){animation-delay:.2s}.ro-code input:nth-child(6){animation-delay:.25s}
.ro-code input:focus{border-color:#AE1E2B!important;box-shadow:0 0 0 4px rgba(174,30,43,.14);transform:translateY(-2px)}
.ro-code input.filled{border-color:#d9b8bb!important;background:#FFF7F7!important;animation:ro-pop .25s ease}
.ro-code.ok input{border-color:#1e8a5a!important;background:#E9F7F0!important;color:#12613D;animation:ro-wave .5s ease both}
.ro-code.ok input:nth-child(2){animation-delay:.05s}.ro-code.ok input:nth-child(3){animation-delay:.1s}.ro-code.ok input:nth-child(4){animation-delay:.15s}.ro-code.ok input:nth-child(5){animation-delay:.2s}.ro-code.ok input:nth-child(6){animation-delay:.25s}
.ro-code.bad{animation:ro-shake .45s ease}.ro-code.bad input{border-color:#B42318!important;background:#FDECEC!important}
.ro-code.busy input{opacity:.7}
.ro-hide{position:absolute!important;opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;overflow:hidden}
@keyframes ro-in{from{opacity:0;transform:translateY(10px) scale(.94)}}
@keyframes ro-pop{40%{transform:scale(1.12)}}
@keyframes ro-wave{40%{transform:translateY(-8px)}}
@keyframes ro-shake{20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
@keyframes ro-ring{25%{transform:rotate(-14deg)}50%{transform:rotate(12deg)}75%{transform:rotate(-6deg)}}
@keyframes ro-draw{to{stroke-dashoffset:0}}
@media (max-width:380px){.ro-code{gap:6px}.ro-code input{width:40px!important;height:52px}}
@media (prefers-reduced-motion:reduce){.ro-phone,.ro-code input,.ro-code.ok input,.ro-code.bad{animation:none!important}}`;
  const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);

  // Sri Lanka's networks, by the first digits of the mobile
  const NETS = [[/^07[01]/, 'Mobitel', '#00A651'], [/^07[28]/, 'Hutch', '#F28C00'], [/^07[467]/, 'Dialog', '#E4002B'], [/^075/, 'Airtel', '#ED1C24']];
  const fmt = (d) => d.length <= 3 ? d : d.length <= 6 ? d.slice(0, 3) + ' ' + d.slice(3) : d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6, 10);

  function phone(inp) {
    if (inp.dataset.roDone) return; inp.dataset.roDone = '1';
    const wrap = document.createElement('div'); wrap.className = 'ro-phone';
    wrap.innerHTML = '<span class="ro-ic">📱</span><span class="ro-net"></span><span class="ro-tick"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';
    inp.parentNode.insertBefore(wrap, inp); wrap.insertBefore(inp, wrap.querySelector('.ro-net'));
    const hint = document.createElement('div'); hint.className = 'ro-hint'; wrap.after(hint);
    inp.setAttribute('maxlength', '13'); inp.placeholder = '07X XXX XXXX';
    const net = wrap.querySelector('.ro-net');
    const look = () => {
      let d = inp.value.replace(/\D/g, '');
      if (d.startsWith('94') && d.length > 10) d = '0' + d.slice(2);        // pasted as +94 77 …
      d = d.slice(0, 10);
      const shown = fmt(d); if (inp.value !== shown) inp.value = shown;
      const n = d.length >= 3 && NETS.find(([re]) => re.test(d));
      if (n) { net.textContent = n[1]; net.style.background = n[2]; net.classList.add('on'); } else net.classList.remove('on');
      wrap.classList.toggle('good', /^07\d{8}$/.test(d));
      hint.textContent = d.length >= 2 && !/^07/.test(d) ? 'A Sri Lankan mobile starts with 07' : (d.length === 10 && !n ? 'Check the number — that network is not known' : '');
    };
    inp.addEventListener('input', look); look();
  }

  function code(inp) {
    if (inp.dataset.roDone) return; inp.dataset.roDone = '1';
    const n = +inp.getAttribute('maxlength') || 6;
    const row = document.createElement('div'); row.className = 'ro-code'; row.dataset.for = inp.id || '';
    const boxes = [];
    for (let i = 0; i < n; i++) {
      const b = document.createElement('input');
      b.type = 'text'; b.inputMode = 'numeric'; b.maxLength = n; b.setAttribute('aria-label', 'Digit ' + (i + 1));
      if (i === 0) b.autocomplete = 'one-time-code'; else b.autocomplete = 'off';
      boxes.push(b); row.appendChild(b);
    }
    inp.classList.add('ro-hide'); inp.tabIndex = -1; inp.setAttribute('aria-hidden', 'true');
    inp.parentNode.insertBefore(row, inp);
    const value = () => boxes.map(b => b.value).join('');
    const sync = () => {
      boxes.forEach(b => b.classList.toggle('filled', !!b.value));
      inp.value = value(); inp.dispatchEvent(new Event('input', { bubbles: true }));
      row.classList.remove('bad', 'ok');
      if (inp.value.length === n) done();
    };
    let firing = false;
    const done = () => {
      if (firing) return; firing = true; setTimeout(() => { firing = false }, 800);
      const go = inp.dataset.otpGo && document.querySelector(inp.dataset.otpGo);
      const next = inp.dataset.otpNext && document.querySelector(inp.dataset.otpNext);
      if (go && !go.disabled) { row.classList.add('busy'); setTimeout(() => go.click(), 120); }
      else if (next) next.focus();
    };
    const fill = (from, digits) => {
      let i = from;
      for (const d of digits) { if (i >= n) break; boxes[i].value = d; i++; }
      boxes[Math.min(i, n - 1)].focus(); sync();
    };
    boxes.forEach((b, i) => {
      b.addEventListener('input', () => {
        const d = b.value.replace(/\D/g, '');
        if (d.length > 1) return fill(i, d);                       // a whole code arrived in one box (autofill, paste)
        b.value = d;
        if (d && i < n - 1) boxes[i + 1].focus();
        sync();
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].value = ''; boxes[i - 1].focus(); sync(); e.preventDefault(); }
        else if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus();
        else if (e.key === 'ArrowRight' && i < n - 1) boxes[i + 1].focus();
        else if (e.key === 'Enter') { e.preventDefault(); done(); }
      });
      b.addEventListener('paste', (e) => { const t = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, ''); if (t) { e.preventDefault(); fill(i, t); } });
      b.addEventListener('focus', () => b.select());
    });
    // the page may set the value itself (or clear it): keep the boxes in step
    inp._roSet = (v) => { const d = String(v || '').replace(/\D/g, ''); boxes.forEach((b, i) => { b.value = d[i] || '' }); boxes.forEach(b => b.classList.toggle('filled', !!b.value)); };
    if (inp.value) inp._roSet(inp.value);
    // focusing the hidden input (the page does this) lands on the first empty box
    inp.addEventListener('focus', () => { (boxes.find(b => !b.value) || boxes[n - 1]).focus(); });
    row._boxes = boxes;
  }

  const rowOf = (sel) => { const inp = typeof sel === 'string' ? document.querySelector(sel) : sel; return inp && inp.previousElementSibling && inp.previousElementSibling.classList.contains('ro-code') ? { inp, row: inp.previousElementSibling } : null; };
  window.RegalOTP = {
    auto(root) { (root || document).querySelectorAll('input[data-phone]').forEach(phone); (root || document).querySelectorAll('input[data-otp]').forEach(code); },
    fail(sel) { const r = rowOf(sel); if (!r) return; r.row.classList.remove('busy', 'ok'); void r.row.offsetWidth; r.row.classList.add('bad');
      setTimeout(() => { r.inp._roSet(''); r.inp.value = ''; r.row._boxes[0].focus(); }, 500); },
    ok(sel) { const r = rowOf(sel); if (!r) return; r.row.classList.remove('busy', 'bad'); r.row.classList.add('ok'); },
    idle(sel) { const r = rowOf(sel); if (r) r.row.classList.remove('busy'); },
  };
  const go = () => window.RegalOTP.auto(document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
