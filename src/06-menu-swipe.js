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

  function applyDrag(dy) {
    if (!target) return;
    // iOS-app-close feel: as you drag, the surface translates AND scales
    // down with corners rounding. Numbers tuned so a ~250px drag lands
    // around scale 0.86 with 18px border-radius (matches iPhone home
    // gesture).
    const norm  = Math.min(1, dy / 320);          // 0..1 over the drag
    const scale = 1 - 0.16 * norm;                // 1 → 0.84
    const radius = 18 * norm;                     // 0 → 18px
    const eased  = dy < 300 ? dy : 300 + (dy - 300) * 0.35;
    target.style.animation       = 'none';
    target.style.transition      = 'none';
    target.style.transformOrigin = '50% 50%';
    target.style.transform       = 'translateY(' + eased + 'px) scale(' + scale + ')';
    target.style.borderRadius    = radius + 'px';
    target.style.overflow        = 'hidden';
    target.style.opacity         = '1';
    if (document.body) document.body.classList.add('sr-dragging');
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
    // Prevent the browser from claiming this gesture as a scroll.
    if (e.cancelable) { try { e.preventDefault(); } catch(_){} }
    applyDrag(dy);
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
      // Snap back to scale(1), translate(0), no border-radius.
      t.style.transition   = 'transform 240ms cubic-bezier(0.2,0.7,0.2,1), border-radius 240ms ease';
      t.style.transform    = 'translateY(0) scale(1)';
      t.style.borderRadius = '0px';
      setTimeout(() => {
        if (!t) return;
        t.style.transition    = '';
        t.style.transform     = '';
        t.style.opacity       = '';
        t.style.animation     = '';
        t.style.borderRadius  = '';
        t.style.overflow      = '';
        t.style.transformOrigin = '';
        if (document.body) document.body.classList.remove('sr-dragging');
      }, 280);
    }
    if (commit && document.body) {
      // remove drag class on next frame so close transition reads clean
      requestAnimationFrame(() => document.body.classList.remove('sr-dragging'));
    }
    reset();
  }

  function reset() {
    active   = false;
    target   = null;
    scroller = null;
    if (document.body && document.body.classList.contains('sr-dragging')) {
      // Only remove if no inline transform is present (avoid race with snap).
      // The snap-back / commit branches handle their own cleanup.
    }
  }

  // Bind on document so dynamically-rebuilt overlay still works. Capture
  // false so interactive children get their own tap handling first.
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  // touchmove non-passive so we can call preventDefault while dragging
  // (otherwise iOS will treat the gesture as a scroll and stop sending us
  // updates).
  document.addEventListener('touchmove',  onTouchMove,  { passive: false });
  document.addEventListener('touchend',   onTouchEnd,   { passive: true });
  document.addEventListener('touchcancel', onTouchEnd,  { passive: true });
})();
