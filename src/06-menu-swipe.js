// Swipe-down to dismiss the garage overlay (mobile, simple).
//
// Touch listeners on document; ignore swipes that start on interactive
// elements (buttons, tabs, cards). Translate the entire #thruster-overlay
// down with the finger; commit dismiss past threshold.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const OVERLAY_ID  = 'thruster-overlay';
  const COMMIT_PX   = 100;
  const H_CANCEL    = 60;
  const INTERACTIVE = 'button, a, select, input, textarea, .sr-card, .sr-tab, .sr-addon-row, .sr-addon-card, .sr-select-wrap';

  let active = false;
  let startX = 0, startY = 0, lastY = 0;
  let target = null;

  function getOverlay() {
    const ov = document.getElementById(OVERLAY_ID);
    if (!ov || ov.classList.contains('hidden')) return null;
    return ov;
  }

  function onTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) return;
    const ov = getOverlay();
    if (!ov) return;
    const tgt = e.target;
    if (tgt && tgt.closest && tgt.closest(INTERACTIVE)) return;
    active = true;
    target = ov;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lastY  = startY;
  }

  function onTouchMove(e) {
    if (!active) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    lastY = t.clientY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > H_CANCEL) {
      reset();
      return;
    }
    if (dy <= 0) return;
    if (target) {
      const eased = dy < 300 ? dy : 300 + (dy - 300) * 0.35;
      target.style.animation  = 'none';
      target.style.transition = 'none';
      target.style.transform  = 'translateY(' + eased + 'px)';
      target.style.opacity    = String(Math.max(0.4, 1 - eased / 700));
    }
    if (e.cancelable) { try { e.preventDefault(); } catch(_){} }
  }

  function onTouchEnd() {
    if (!active) return;
    const dy = lastY - startY;
    const t = target;
    if (dy >= COMMIT_PX) {
      try { window.closeThrusterPanel && window.closeThrusterPanel(); } catch(_){}
      requestAnimationFrame(() => clearStyles(t));
    } else if (t) {
      t.style.transition = 'transform 220ms cubic-bezier(0.2,0.7,0.2,1), opacity 220ms ease';
      t.style.transform  = 'translateY(0)';
      t.style.opacity    = '1';
      setTimeout(() => clearStyles(t), 260);
    }
    reset();
  }

  function clearStyles(t) {
    if (!t) return;
    t.style.transition = '';
    t.style.transform  = '';
    t.style.opacity    = '';
    t.style.animation  = '';
  }

  function reset() {
    active = false;
    target = null;
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove',  onTouchMove,  { passive: false });
  document.addEventListener('touchend',   onTouchEnd,   { passive: true });
  document.addEventListener('touchcancel', onTouchEnd,  { passive: true });
})();
