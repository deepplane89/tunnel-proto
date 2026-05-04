// Menu open animation origin tracker.
// On any pointer/click/touch, capture the screen coordinates and write them
// as CSS custom properties (--menu-ox, --menu-oy) on :root. The shared
// menu-open keyframes use these for transform-origin so overlays appear to
// grow out of whatever the user just tapped (Material container-transform
// / iOS zoom-from-source approximation).
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var root = document.documentElement;
  function setOrigin(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (!isFinite(x) || !isFinite(y)) return;
    root.style.setProperty('--menu-ox', x + 'px');
    root.style.setProperty('--menu-oy', y + 'px');
  }
  function fromEvent(e) {
    if (e && e.touches && e.touches[0]) {
      setOrigin(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e && typeof e.clientX === 'number') {
      setOrigin(e.clientX, e.clientY);
    }
  }
  // capture phase so we record before any handler shows the overlay
  window.addEventListener('pointerdown', fromEvent, true);
  window.addEventListener('touchstart', fromEvent, { capture: true, passive: true });
  window.addEventListener('mousedown', fromEvent, true);
  // sensible default: screen center
  setOrigin(window.innerWidth / 2, window.innerHeight / 2);
  window.addEventListener('resize', function () {
    setOrigin(window.innerWidth / 2, window.innerHeight / 2);
  });
})();
