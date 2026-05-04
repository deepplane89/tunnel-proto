// Drag-the-grabber to dismiss the garage overlay.
//
// Earlier attempts to make the whole overlay swipeable hit a wall on iOS
// (pointer-events:none on the overlay shell, touch-action conflicts, etc.).
// The classic iOS pattern is a small grabber bar at the top of the sheet
// that the user drags. Binding pointer handlers ONLY to that bar gives us
// a clean event surface with zero competition from the canvas / tabs.
//
// Visual: as the user drags, the entire #thruster-overlay translates and
// scales down (iOS-app-close feel), with the title screen revealed behind
// (body.sr-dragging gates that via CSS).
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const OVERLAY_ID = 'thruster-overlay';
  const GRABBER_ID = 'sr-grabber';
  const COMMIT_PX  = 90;
  const H_CANCEL   = 60;

  let active   = false;
  let pointerId = -1;
  let startX = 0, startY = 0, lastY = 0;
  let overlay = null;

  function getOverlay() { return document.getElementById(OVERLAY_ID); }
  function getGrabber() { return document.getElementById(GRABBER_ID); }

  function applyDrag(dy) {
    if (!overlay) return;
    const norm   = Math.min(1, dy / 320);
    const scale  = 1 - 0.16 * norm;
    const radius = 18 * norm;
    const eased  = dy < 300 ? dy : 300 + (dy - 300) * 0.35;
    overlay.style.animation       = 'none';
    overlay.style.transition      = 'none';
    overlay.style.transformOrigin = '50% 50%';
    overlay.style.transform       = 'translateY(' + eased + 'px) scale(' + scale + ')';
    overlay.style.borderRadius    = radius + 'px';
    overlay.style.overflow        = 'hidden';
    document.body.classList.add('sr-dragging');
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const ov = getOverlay();
    if (!ov || ov.classList.contains('hidden')) return;
    overlay   = ov;
    active    = true;
    pointerId = e.pointerId;
    startX    = e.clientX;
    startY    = e.clientY;
    lastY     = e.clientY;
    try { e.currentTarget.setPointerCapture(pointerId); } catch(_){}
    e.preventDefault();
  }

  function onMove(e) {
    if (!active || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    lastY = e.clientY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > H_CANCEL) {
      snapBack();
      reset();
      return;
    }
    if (dy <= 0) {
      // pulling up: reset transform to neutral
      if (overlay) {
        overlay.style.transition = 'none';
        overlay.style.transform = '';
        overlay.style.borderRadius = '';
      }
      return;
    }
    applyDrag(dy);
  }

  function onUp(e) {
    if (!active) return;
    if (e && e.pointerId !== pointerId) return;
    const dy = lastY - startY;
    if (dy >= COMMIT_PX) {
      // commit dismiss
      try { window.closeThrusterPanel && window.closeThrusterPanel(); } catch(_){}
      requestAnimationFrame(() => clearStyles(overlay));
    } else {
      snapBack();
    }
    reset();
  }

  function snapBack() {
    if (!overlay) return;
    const ov = overlay;
    ov.style.transition   = 'transform 240ms cubic-bezier(0.2,0.7,0.2,1), border-radius 240ms ease';
    ov.style.transform    = 'translateY(0) scale(1)';
    ov.style.borderRadius = '0px';
    setTimeout(() => clearStyles(ov), 280);
  }

  function clearStyles(ov) {
    if (!ov) return;
    ov.style.transition      = '';
    ov.style.transform       = '';
    ov.style.opacity         = '';
    ov.style.animation       = '';
    ov.style.borderRadius    = '';
    ov.style.overflow        = '';
    ov.style.transformOrigin = '';
    document.body.classList.remove('sr-dragging');
  }

  function reset() {
    active = false;
    overlay = null;
    pointerId = -1;
  }

  function wire() {
    const g = getGrabber();
    if (!g || g.__wired) return;
    g.__wired = true;
    g.addEventListener('pointerdown', onDown);
    g.addEventListener('pointermove', onMove);
    g.addEventListener('pointerup',   onUp);
    g.addEventListener('pointercancel', onUp);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
  // Re-check periodically in case the panel is rebuilt.
  setInterval(wire, 1000);
})();
