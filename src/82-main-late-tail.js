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
// Reusable: compile every material in the scene graphs NOW. Called at boot
// and again on resume from long backgrounding / WebGL context restore.
window._reprewarmShaders = function _reprewarmShaders(reason) {
  if (typeof renderer === 'undefined') return;
  const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
  try {
    if (typeof scene !== 'undefined' && typeof camera !== 'undefined') {
      renderer.compile(scene, camera);
    }
    if (typeof titleScene !== 'undefined' && titleScene && typeof camera !== 'undefined') {
      renderer.compile(titleScene, camera);
    }
    const dt = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0;
    if (window._perfDiag) try { window._perfDiag.tag('reprewarm', (reason||'?') + ' ' + dt.toFixed(0) + 'ms'); } catch(_) {}
  } catch (err) {
    console.warn('[PREWARM] reprewarm failed (non-fatal):', err && err.message);
  }
};

(function _globalShaderPrewarm() {
  if (typeof window === 'undefined' || typeof renderer === 'undefined') return;
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
    // 2) Compile every material currently in the scene graph (idempotent).
    window._reprewarmShaders('boot');
    status('PREWARM', 95);
  } catch (err) {
    console.warn('[PREWARM] global prewarm failed (non-fatal):', err && err.message);
  }
})();

// ── RESUME OVERLAY ─ tiny full-screen overlay shown during reprewarm ──
// Used by both webglcontextrestored and long-background visibilitychange paths
// so the user sees a brief "RESUMING" instead of a stalled black frame while
// shaders recompile.
window._jhResumeOverlay = (function _resumeOverlayFactory() {
  let el = null;
  function _build() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'jh-resume-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;color:#3ff;font-family:Silkscreen,monospace;font-size:14px;letter-spacing:2px;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .15s ease;';
    el.textContent = 'RESUMING…';
    document.body.appendChild(el);
    return el;
  }
  return {
    show(label) {
      const e = _build();
      e.textContent = label || 'RESUMING…';
      e.style.pointerEvents = 'auto';
      // Force reflow then fade in
      void e.offsetWidth;
      e.style.opacity = '1';
    },
    hide() {
      if (!el) return;
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    }
  };
})();

// ── WEBGL CONTEXT LOSS RECOVERY ──
// iOS Safari can drop the GL context after long backgrounding, OS memory
// pressure, or thermal events. When that happens every compiled shader is
// gone and the next render produces a blank canvas + recompile stalls.
// Listen on the canvas, prevent default loss handling, and reprewarm on
// restore so first-spawn doesn't re-stall.
(function _wireContextLossHandlers() {
  if (typeof renderer === 'undefined' || !renderer.domElement) return;
  const canvas = renderer.domElement;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // tells browser we want a restore
    console.warn('[GL] context lost — waiting for restore');
    try { window._jhResumeOverlay.show('RECOVERING…'); } catch(_) {}
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('[GL] context restored — reprewarming shaders');
    try { window._reprewarmShaders('ctx-restore'); } catch(_) {}
    // Pool textures/materials may need needsUpdate flips for re-upload.
    // Most THREE materials handle this automatically on next render, but
    // give the canvas one frame before hiding the overlay.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { window._jhResumeOverlay.hide(); } catch(_) {}
    }));
  }, false);
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

  // Mobile detection: iOS Safari blocks AudioContext until a real user gesture,
  // so we present an ACCESS GRANTED button between loader-ready and title-show.
  // The button tap doubles as the audio unlock gesture (initTitleAudio).
  const _isMobile = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  // Hard fallback: never block the user more than 10s even if a promise stalls.
  let _hidden = false;
  function _hide(label) {
    if (_hidden) return;
    _hidden = true;
    gate.setStatus(label || 'CONNECTION ESTABLISHED', 100);
    // Brief beat at 100% so the bar visibly completes, then fade.
    setTimeout(() => {
      // On mobile, show ACCESS GRANTED gate UNDER the loader before it fades
      // out so the title screen never becomes visible — the gate covers it.
      if (_isMobile) _showAccessGate();
      loader.classList.add('hide');
      setTimeout(() => {
        if (loader.parentNode) loader.parentNode.removeChild(loader);
      }, 700);
    }, 220);
  }

  function _showAccessGate() {
    const gateEl = document.getElementById('access-gate');
    const btn = document.getElementById('access-gate-btn');
    if (!gateEl || !btn) return;
    gateEl.classList.add('show');
    const _onTap = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      btn.removeEventListener('click', _onTap);
      btn.removeEventListener('touchstart', _onTap);
      // Initialize audio inside the gesture handler so iOS Safari unlocks the
      // AudioContext + lets background <audio> tags play. initTitleAudio is
      // wired up in 60-main-late.js and idempotent if already called.
      try {
        if (typeof window.initTitleAudio === 'function') window.initTitleAudio();
      } catch (_) {}
      // First-time-ever load: show the graphics-quality picker before fading
      // the gate. The picker handles its own dismissal + gate hide.
      const _firstLoad = !window._LS.getItem('jh_gfx_picked');
      if (_firstLoad && typeof window._showGfxPicker === 'function') {
        window._showGfxPicker(() => {
          gateEl.classList.add('hide');
          setTimeout(() => { if (gateEl.parentNode) gateEl.parentNode.removeChild(gateEl); }, 600);
        });
        return;
      }
      gateEl.classList.add('hide');
      setTimeout(() => { if (gateEl.parentNode) gateEl.parentNode.removeChild(gateEl); }, 600);
    };
    btn.addEventListener('click', _onTap, { passive: false });
    btn.addEventListener('touchstart', _onTap, { passive: false });
  }

  const hardTimeout = setTimeout(() => _hide('CONNECTION ESTABLISHED'), 10000);

  // Resolve when all registered promises settle.
  Promise.all(gate.promises.slice()).then(() => {
    clearTimeout(hardTimeout);
    // Suspenders for the cold-boot grey-runner bug: alt-GLB cache may have
    // populated AFTER the synchronous applyTitleSkin() call in 72-main-late-mid.
    // Re-apply the selected skin now that all GLBs are guaranteed loaded so the
    // title preview swaps to the proper ship before the loader fades out.
    try {
      if (typeof applyTitleSkin === 'function' && typeof loadSkinData === 'function') {
        applyTitleSkin(loadSkinData().selected);
      }
    } catch (_) {}
    // One RAF to let final shader compile + first frame render hidden behind us.
    requestAnimationFrame(() => requestAnimationFrame(() => _hide('CONNECTION ESTABLISHED')));
  }).catch(() => {
    clearTimeout(hardTimeout);
    _hide('CONNECTION ESTABLISHED');
  });
})();
