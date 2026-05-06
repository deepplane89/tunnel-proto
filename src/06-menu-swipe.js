// Swipe-down to dismiss menu overlays (mobile, simple).
//
// Generalized over multiple overlays:
//   - thruster-overlay  (garage)        -> closeThrusterPanel
//   - missions-overlay  (missions)      -> closeMissions
//   - settings-overlay  (settings)      -> closeSettings
//
// Touch listeners on document; ignore swipes that start on interactive
// elements (buttons, tabs, cards, sliders). Translate the active overlay
// down with the finger; commit dismiss past threshold.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const OVERLAYS = [
    { id: 'thruster-overlay', close: 'closeThrusterPanel' },
    { id: 'missions-overlay', close: 'closeMissions'      },
    { id: 'settings-overlay', close: 'closeSettings'      },
  ];

  const COMMIT_PX   = 100;
  const H_CANCEL    = 60;
  const INTERACTIVE = 'button, a, select, input, textarea, ' +
    '.sr-card, .sr-tab, .sr-addon-row, .sr-addon-card, .sr-select-wrap, ' +
    '.settings-row, .settings-slider, [role="slider"], ' +
    // Flight-model dropdown bar + portaled menu rows. Without these, a touch
    // that even barely drifts on the FM bar/menu starts the swipe-to-dismiss
    // gesture, which translateY's the whole overlay and looks like the menu
    // is closing on its own.
    '.shop-handling-bar, .fm-head, .fm-menu, .fm-row, .fm-row *, ' +
    '.shop-card, .shop-detail, .shop-detail-tier, .shop-upgrade-btn, .btn-upgrade';

  let active = false;
  let startX = 0, startY = 0, lastY = 0;
  let target = null;
  let closeFn = null;

  function activeOverlay() {
    for (let i = 0; i < OVERLAYS.length; i++) {
      const o = OVERLAYS[i];
      const el = document.getElementById(o.id);
      if (el && !el.classList.contains('hidden')) {
        return { el, close: o.close };
      }
    }
    return null;
  }

  function onTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) return;
    const found = activeOverlay();
    if (!found) return;
    // If any popover/menu is currently open inside the overlay, kill the
    // swipe-to-dismiss gesture entirely. The FLIGHT MODEL dropdown is the
    // canonical case: while .open is set, any incidental touchmove would
    // translateY the overlay and visually close the menu.
    if (document.querySelector('.shop-handling-bar.open')) return;
    if (document.querySelector('.sf-select-wrap.open')) return;
    const tgt = e.target;
    if (tgt && tgt.closest && tgt.closest(INTERACTIVE)) return;
    active = true;
    target = found.el;
    closeFn = found.close;
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
    const t  = target;
    const fn = closeFn;
    if (dy >= COMMIT_PX) {
      try {
        if (fn && typeof window[fn] === 'function') window[fn]();
      } catch(_){}
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
    closeFn = null;
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove',  onTouchMove,  { passive: false });
  document.addEventListener('touchend',   onTouchEnd,   { passive: true });
  document.addEventListener('touchcancel', onTouchEnd,  { passive: true });
})();
