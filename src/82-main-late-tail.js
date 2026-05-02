// cache bust 1777249800

// ── GLOBAL SHADER PREWARM ──
// Force-init every lazy pool, then call renderer.compile(scene, camera) so
// EVERY material in the scene graph (eager + just-initialized lazy pools)
// gets its shader compiled NOW, during loading, instead of mid-gameplay.
//
// This eliminates the "first lightning bolt flash", "first lethal ring spawn
// hitch", and similar one-frame stalls users see when a new material first
// hits the screen. Same family of fix as the cone obstacle needsUpdate fix.
//
// Runs synchronously at module load (this is the LAST module concatenated, so
// every dependency is defined). The boot load gate below waits 2 frames after
// all promises settle for any final pipeline state to flush, which is the
// safety net if anything still compiles lazily.
(function _globalShaderPrewarm() {
  if (typeof window === 'undefined' || typeof renderer === 'undefined') return;
  const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
  const status = (label, pct) => { try { window.__loadGate && window.__loadGate.setStatus(label, pct); } catch(e) {} };
  try {
    status('PREWARM', 85);
    // 1) Force-init every lazy pool so its meshes are now in the scene graph.
    if (typeof window._ltInitPool === 'function') {
      try { window._ltInitPool(); } catch (e) { console.warn('[PREWARM] lightning init failed:', e && e.message); }
    }
    if (typeof window._initLethalRings === 'function') {
      try { window._initLethalRings(); } catch (e) { console.warn('[PREWARM] lethal rings init failed:', e && e.message); }
    }
    // 2) Compile every material currently in the scene graph. renderer.compile()
    //    is idempotent — a no-op for materials already compiled, so this is
    //    safe even though earlier sites already compiled subsets.
    if (typeof scene !== 'undefined' && typeof camera !== 'undefined') {
      renderer.compile(scene, camera);
    }
    if (typeof titleScene !== 'undefined' && titleScene && typeof camera !== 'undefined') {
      renderer.compile(titleScene, camera);
    }
    const dt = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0;
    status('PREWARM', 95);
  } catch (err) {
    // Non-fatal — lazy compilation will still happen, we just lose the
    // upfront-cost benefit. Log and let the game continue.
    console.warn('[PREWARM] global prewarm failed (non-fatal):', err && err.message);
  }
})();

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
