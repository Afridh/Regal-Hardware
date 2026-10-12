/* Regal theme: a ripple where a button is pressed, as on the supplier and customer pages.
   It only adds a short-lived span inside the button, so what the button does is untouched. */
(function () {
  var still = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches };
  document.addEventListener('pointerdown', function (e) {
    if (still()) return;
    var b = e.target.closest && e.target.closest('#app .btn, #app .till-hold, #app .till-clear, #app .till-del');
    if (!b || b.disabled) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height), d = document.createElement('span');
    d.className = 'th-ripple';
    d.style.cssText = 'width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px';
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    // clipped only while the ripple plays, so a badge sitting over the edge is never cut off
    var was = b.style.overflow; b.style.overflow = 'hidden';
    b.appendChild(d);
    setTimeout(function () { d.remove(); b.style.overflow = was }, 650);
  }, { passive: true });
})();
