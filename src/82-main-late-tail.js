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
      // Computer-interference cue plays here (the actual audio-unlock gesture).
      // Previously fired on TAP TO PLAY, but iOS sometimes can't decode/play a
      // fresh sample synchronously on a *second* gesture; the unlock tap is the
      // most reliable place. Defer one tick so the AudioContext has resumed.
      setTimeout(() => {
        try { if (typeof window.playStartInterference === 'function') window.playStartInterference(); } catch (_) {}
      }, 30);
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
