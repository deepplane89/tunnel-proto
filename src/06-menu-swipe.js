// Swipe-to-dismiss for the garage / showroom overlay (mobile-first).
// Touch only — keeps mouse interactions untouched. Listens for a vertical
// swipe-down gesture on #thruster-overlay; when the swipe exceeds threshold
// the overlay's close function is invoked (closeThrusterPanel).
//
// Guards:
//   - Ignored if pointer is not a touch (no mouse/trackpad).
//   - Ignored if the swipe starts on an interactive element (button, tab,
//     card, select, input) — those need their own taps.
//   - Ignored if the swipe starts inside a scrollable region that has been
//     scrolled (so we don't hijack content scroll).
//   - Horizontal motion dominating cancels the dismiss intent.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const OVERLAY_ID = 'thruster-overlay';
  // Distance (px) below the start point required to commit the dismiss.
  const COMMIT_PX  = 90;
  // Max horizontal drift (px) before we treat the gesture as a horizontal
  // swipe and bail out.
  const H_CANCEL   = 60;
  // Selector for elements whose taps must not be turned into a drag.
  const INTERACTIVE = 'button, a, select, input, textarea, .sr-card, .sr-tab, .sr-addon-row';

  let active = false;
  let startX = 0;
  let startY = 0;
  let lastY  = 0;
  let target = null; // the element we translate (whole overlay)
  let scroller = null;
  let scrollerStart = 0;

  function findScrollableAncestor(el, root) {
    let n = el;
    while (n && n !== root) {
      const cs = window.getComputedStyle(n);
      const oy = cs.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
      n = n.parentNode;
    }
    return null;
  }

  function onTouchStart(e) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    const target = e.target;
    // Bail on interactive elements so taps on tabs/cards still work normally.
    if (target && target.closest && target.closest(INTERACTIVE)) return;
    active   = true;
    startX   = t.clientX;
    startY   = t.clientY;
    lastY    = t.clientY;
    // Translate the entire overlay so the title screen is visible behind
    // it as the user drags down.
    target   = overlay;
    scroller = findScrollableAncestor(e.target, overlay);
    scrollerStart = scroller ? scroller.scrollTop : 0;
  }

  function onTouchMove(e) {
    if (!active) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    lastY = t.clientY;
    // Horizontal-dominant: cancel.
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > H_CANCEL) {
      reset();
      return;
    }
    // Only respond to downward drags. If the user is in a scroller and it's
    // already scrolled past 0, let normal scroll handle it.
    if (dy <= 0) return;
    if (scroller && scroller.scrollTop > 0) return;
    // Live drag: translate the whole overlay by dy with mild rubber-band
    // so the title screen behind shows through as the user drags down.
    const eased = dy < 0 ? 0 : (dy < 300 ? dy : 300 + (dy - 300) * 0.35);
    if (target) {
      // Cancel the menu-open keyframe animation otherwise its transform
      // wins over our inline transform (CSS animations beat inline style).
      target.style.animation  = 'none';
      target.style.transition = 'none';
      target.style.transform  = 'translateY(' + eased + 'px)';
      target.style.opacity    = String(Math.max(0.5, 1 - eased / 800));
    }
  }

  function onTouchEnd() {
    if (!active) return;
    const dy = lastY - startY;
    const commit = dy >= COMMIT_PX;
    const t = target;
    if (commit && typeof window.closeThrusterPanel === 'function') {
      // Let close handler hide overlay; clear inline styles next frame so
      // the close transition (or instant hide) isn't fought by leftover
      // transform.
      try { window.closeThrusterPanel(); } catch(_){}
      requestAnimationFrame(() => {
        if (!t) return;
        t.style.transition = '';
        t.style.transform  = '';
        t.style.opacity    = '';
        t.style.animation  = '';
      });
    } else if (t) {
      // Snap back. Keep animation:none so transition runs cleanly, then
      // restore animation back to stylesheet default after.
      t.style.transition = 'transform 220ms cubic-bezier(0.2,0.7,0.2,1), opacity 220ms ease';
      t.style.transform  = 'translateY(0)';
      t.style.opacity    = '1';
      setTimeout(() => {
        if (!t) return;
        t.style.transition = '';
        t.style.transform  = '';
        t.style.opacity    = '';
        t.style.animation  = '';
      }, 260);
    }
    reset();
  }

  function reset() {
    active   = false;
    target   = null;
    scroller = null;
  }

  // Bind on document so dynamically-rebuilt overlay still works. Capture
  // false so interactive children get their own tap handling first.
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove',  onTouchMove,  { passive: true });
  document.addEventListener('touchend',   onTouchEnd,   { passive: true });
  document.addEventListener('touchcancel', onTouchEnd,  { passive: true });
})();
