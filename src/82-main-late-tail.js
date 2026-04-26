// cache bust 1777249800

// ── BOOT LOAD GATE ─ fade out the boot loader once critical assets are ready ──
(function _bootLoadGate() {
  if (!window.__loadGate) return;
  const gate = window.__loadGate;
  const loader = document.getElementById('app-loader');
  if (!loader) return;

  // Also wait on web fonts (Knewave / Silkscreen / Rajdhani) so title text
  // doesn't reflow once the loader fades out.
  if (document.fonts && document.fonts.ready) {
    gate.add('fonts', document.fonts.ready);
  }

  // Hard fallback: never block the user more than 10s even if a promise stalls.
  let _hidden = false;
  function _hide(label) {
    if (_hidden) return;
    _hidden = true;
    gate.setStatus(label || 'READY', 100);
    // Brief beat at 100% so the bar visibly completes, then fade.
    setTimeout(() => {
      loader.classList.add('hide');
      setTimeout(() => { if (loader.parentNode) loader.parentNode.removeChild(loader); }, 700);
    }, 220);
  }

  const hardTimeout = setTimeout(() => _hide('READY'), 10000);

  // Resolve when all registered promises settle.
  Promise.all(gate.promises.slice()).then(() => {
    clearTimeout(hardTimeout);
    // One RAF to let final shader compile + first frame render hidden behind us.
    requestAnimationFrame(() => requestAnimationFrame(() => _hide('READY')));
  }).catch(() => {
    clearTimeout(hardTimeout);
    _hide('READY');
  });
})();
