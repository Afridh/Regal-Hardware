/* The welcome — the Regal mark wipes up, REGAL rises letter by letter, HARDWARE opens out, a red
   line sweeps across, then the screen parts like a curtain onto the page. Shared by the shop
   (shop.html), the customer's page (my.html) and the suppliers' page (supplier.html).

   Load it in the <head>, before anything is drawn, so it is there from the first frame:
     <script src="/welcome.js" data-sub="Your account"></script>
   data-sub is the small line under the name. It plays every time a page is opened or refreshed,
   about 2.3 s, and a tap skips it. It never plays for a device that has asked for less motion, or
   when the shop has switched it off (The shop site → Look & layout → Motion — the shop page keeps
   that choice in this browser as rh_intro). */
(function () {
  var me = document.currentScript, root = document.documentElement;
  try {
    var off = localStorage.getItem('rh_intro') === 'off',
        calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (off || calm) { root.classList.add('no-intro'); return; }
  } catch (e) { root.classList.add('no-intro'); return; }
  root.classList.add('intro-on');

  var logo = new URL('regal-logo.png', (me && me.src) || location.href).href;
  var sub = (me && me.getAttribute('data-sub')) || '748, Main Street · Kaduruwela';
  var font = "'Jost','Archivo',system-ui,-apple-system,'Segoe UI',sans-serif";

  var css = ''
    + '#intro{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;cursor:pointer}'
    + '.no-intro #intro{display:none}'
    + 'html.intro-on,html.intro-on body{overflow:hidden}'
    + '#intro .cur{position:absolute;left:0;right:0;height:50.5%;background:#fff;transition:transform .85s cubic-bezier(.77,0,.18,1)}'
    + '#intro .cur.t{top:0}#intro .cur.b{bottom:0}'
    + '#intro .wrap{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:14px;transition:opacity .45s ease,transform .6s cubic-bezier(.77,0,.18,1)}'
    + '#intro .mk{width:clamp(84px,16vw,128px);aspect-ratio:1;display:flex;align-items:center;justify-content:center;clip-path:inset(100% 0 0 0);animation:in-wipe .7s cubic-bezier(.65,0,.35,1) .15s forwards}'
    + '#intro .mk img{width:100%;height:auto;transform:scale(.7);animation:in-pop 1s cubic-bezier(.2,.9,.25,1.25) .15s forwards}'
    + '#intro .wd{display:flex;flex-direction:column;align-items:center;line-height:1}'
    + '#intro .wd b{display:flex;overflow:hidden;font:900 clamp(40px,8vw,72px)/1 ' + font + ';letter-spacing:.06em;color:#AE1E2B;padding-bottom:4px}'
    + '#intro .wd b span{display:inline-block;transform:translateY(110%);animation:in-rise .6s cubic-bezier(.2,.8,.2,1) forwards}'
    + '#intro .wd b span:nth-child(1){animation-delay:.55s}#intro .wd b span:nth-child(2){animation-delay:.62s}#intro .wd b span:nth-child(3){animation-delay:.69s}#intro .wd b span:nth-child(4){animation-delay:.76s}#intro .wd b span:nth-child(5){animation-delay:.83s}'
    + '#intro .wd small{font:600 clamp(11px,1.8vw,14px)/1 ' + font + ';color:#111;letter-spacing:.1em;opacity:0;margin-top:10px;animation:in-open .9s cubic-bezier(.2,.8,.2,1) 1s forwards}'
    + '#intro .ln{display:block;width:clamp(120px,22vw,220px);height:2px;background:#AE1E2B;transform:scaleX(0);animation:in-line .6s cubic-bezier(.65,0,.35,1) 1.2s forwards}'
    + '#intro .tg{font:400 clamp(11px,1.6vw,13px)/1 ' + font + ';font-style:normal;letter-spacing:.24em;text-transform:uppercase;color:#777;opacity:0;animation:in-fade .6s ease 1.45s forwards}'
    + '#intro.out .wrap{opacity:0;transform:scale(.94)}'
    + '#intro.out .cur.t{transform:translateY(-101%)}#intro.out .cur.b{transform:translateY(101%)}'
    + '#intro.out{pointer-events:none}'
    + '@keyframes in-wipe{to{clip-path:inset(0 0 0 0)}}@keyframes in-pop{to{transform:scale(1)}}@keyframes in-rise{to{transform:none}}'
    + '@keyframes in-open{to{opacity:1;letter-spacing:.52em}}@keyframes in-line{to{transform:scaleX(1)}}@keyframes in-fade{to{opacity:1}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  // the Jost face, if the page has not asked for it already, so the name looks the same everywhere
  if (!document.querySelector('link[href*="family=Jost"]')) {
    var lf = document.createElement('link'); lf.rel = 'stylesheet';
    lf.href = 'https://fonts.googleapis.com/css2?family=Jost:wght@400;600;900&display=swap'; document.head.appendChild(lf);
  }

  var el = document.createElement('div');
  el.id = 'intro'; el.setAttribute('aria-hidden', 'true');
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  el.innerHTML = '<div class="cur t"></div><div class="cur b"></div><div class="wrap">'
    + '<div class="mk"><img src="' + esc(logo) + '" alt=""></div>'
    + '<div class="wd"><b><span>R</span><span>E</span><span>G</span><span>A</span><span>L</span></b><small>HARDWARE</small></div>'
    + '<i class="ln"></i><em class="tg">' + esc(sub) + '</em></div>';
  // the page's <body> does not exist yet: the curtain hangs on <html> itself, over everything to come
  root.appendChild(el);

  function out() {
    if (el.classList.contains('out')) return;
    el.classList.add('out');
    setTimeout(function () { el.remove(); root.classList.remove('intro-on'); }, 900);
  }
  window.introOut = out;
  el.addEventListener('click', out);
  setTimeout(out, 2300);
})();
