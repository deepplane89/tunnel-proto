// Swipe-down to dismiss the garage overlay (mobile-first).
//
// Implementation notes (after several earlier attempts didn't fire on iOS):
//   - Bind on the .sr-panel element directly (which has pointer-events) AND
//     on .sr-stage (the canvas region, also touchable). Document-level
//     listeners were not reliably receiving touchmove on iOS Safari for
//     elements inside an overlay marked pointer-events:none.
//   - Use Pointer Events (pointerdown/move/up) with setPointerCapture so we
//     keep receiving updates even if the finger leaves the element. Pointer
//     Events are supported on iOS 13+ and unify mouse/touch.
//   - The whole #thruster-overlay element is what we transform — translate
//     it down + scale it down + round its corners (iOS app-close gesture).
//   - The body gets a `sr-dragging` class so CSS reveals the title screen
//     behind for the duration of the drag.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const OVERLAY_ID = 'thruster-overlay';
  const COMMIT_PX  = 100;       // commit dismiss past this drag distance
  const H_CANCEL   = 40;        // horizontal-dominant: cancel
  // Elements that should NOT initiate a drag (let their own taps run).
  const INTERACTIVE = 'button, a, select, input, textarea, .sr-card, .sr-tab, .sr-addon-row, .sr-addon-card, .sr-select-wrap';

  let active   = false;
  let pointerId = -1;
  let startX   = 0;
  let startY   = 0;
  let lastY    = 0;
  let overlay  = null;
  let scroller = null;

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

  function getOverlay() {
    return document.getElementById(OVERLAY_ID);
  }

  function onDown(e) {
    // Only primary touch / left mouse
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const ov = getOverlay();
    if (!ov || ov.classList.contains('hidden')) return;
    const target = e.target;
    if (target && target.closest && target.closest(INTERACTIVE)) return;

    overlay   = ov;
    active    = true;
    pointerId = e.pointerId;
    startX    = e.clientX;
    startY    = e.clientY;
    lastY     = e.clientY;
    scroller  = findScrollableAncestor(target, ov);

    // Capture pointer so we keep receiving moves even if the finger drifts
    // off this element.
    if (e.currentTarget && e.currentTarget.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(pointerId); } catch(_){}
    }
  }

  function onMove(e) {
    if (!active || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    lastY = e.clientY;

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > H_CANCEL) {
      cancel();
      return;
    }
    if (dy <= 0) return;
    if (scroller && scroller.scrollTop > 0) return;

    // iOS app-close: translate + scale + round corners
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
    overlay.style.opacity         = '1';
    document.body.classList.add('sr-dragging');

    if (e.cancelable) { try { e.preventDefault(); } catch(_){} }
  }

  function onUp(e) {
    if (!active || (e && e.pointerId !== pointerId)) return;
    const dy = lastY - startY;
    const commit = dy >= COMMIT_PX;
    const ov = overlay;

    if (commit && typeof window.closeThrusterPanel === 'function') {
      try { window.closeThrusterPanel(); } catch(_){}
      requestAnimationFrame(() => clearStyles(ov));
    } else if (ov) {
      // snap back
      ov.style.transition   = 'transform 240ms cubic-bezier(0.2,0.7,0.2,1), border-radius 240ms ease';
      ov.style.transform    = 'translateY(0) scale(1)';
      ov.style.borderRadius = '0px';
      setTimeout(() => clearStyles(ov), 280);
    }
    reset();
  }

  function cancel() {
    if (overlay) {
      overlay.style.transition   = 'transform 200ms ease, border-radius 200ms ease';
      overlay.style.transform    = 'translateY(0) scale(1)';
      overlay.style.borderRadius = '0px';
      const ov = overlay;
      setTimeout(() => clearStyles(ov), 240);
    }
    reset();
  }

  function clearStyles(ov) {
    if (!ov) return;
    ov.style.transition       = '';
    ov.style.transform        = '';
    ov.style.opacity          = '';
    ov.style.animation        = '';
    ov.style.borderRadius     = '';
    ov.style.overflow         = '';
    ov.style.transformOrigin  = '';
    document.body.classList.remove('sr-dragging');
  }

  function reset() {
    active   = false;
    overlay  = null;
    scroller = null;
    pointerId = -1;
  }

  // Wire pointer listeners on the panel + stage. Re-wire when overlay
  // contents are rebuilt (showroom open/close cycles re-run).
  let wired = new WeakSet();
  function wire() {
    const ov = getOverlay();
    if (!ov) return;
    const targets = [ov.querySelector('.sr-panel'), ov.querySelector('.sr-stage')];
    targets.forEach((el) => {
      if (!el || wired.has(el)) return;
      wired.add(el);
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup',   onUp);
      el.addEventListener('pointercancel', onUp);
      // CSS touch-action: pan-x lets horizontal scroll still happen if any,
      // but kills the browser's vertical-scroll claim so our handler runs.
      el.style.touchAction = 'none';
    });
  }

  // Wire once on DOM ready, again whenever showroom opens (Showroom.open
  // may rebuild children). Cheap idempotent re-wire on a ~250ms heartbeat.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
  setInterval(wire, 500);
})();
