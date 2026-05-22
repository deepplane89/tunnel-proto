// ═══════════════════════════════════════════════════
//  RESUME GATE — tap-to-resume overlay for iOS PWA audio recovery
//
//  The problem (v79 and before):
//  On iOS PWA, after the user swipes the app away and returns, audio is
//  silently dead. The existing visibilitychange handler in 72-main-late-mid.js
//  calls audioCtx.resume() and _rewireTrackGains() — both of which are OUTSIDE
//  the call-stack of a user gesture, so iOS Safari silently rejects them.
//
//  Three known structural failures in the v79 gesture-recovery path:
//    1. _rewireTrackGains uses `audioCtx.suspend().then(() => audioCtx.resume())`.
//       The `.then()` callback fires on the microtask queue — NOT inside the
//       original gesture call-stack. iOS rejects the resume.
//    2. _armGestureRecovery listens on the FIRST tap anywhere — which can land
//       on a UI button that calls stopPropagation, or a tap that just doesn't
//       trigger the audio rewire path correctly.
//    3. play() calls happen inside double-rAF, also outside the gesture.
//
//  The fix: a dedicated full-screen "RESUME" overlay that intercepts ALL taps
//  for the first interaction after >2 seconds hidden. The tap handler runs
//  all audio recovery work SYNCHRONOUSLY in the gesture call-stack — no
//  awaits, no Promise chains, no rAFs before the resume() call.
//
//  Per the user's design intent (2026-05-22):
//    - Label: "RESUME" (no subtext)
//    - Threshold: 2 seconds hidden
//    - Always show above threshold (don't try to detect if audio is broken —
//      we can't; per WebKit Bug 276687, audioCtx.state lies)
//    - Nuclear recovery every time the tap fires
//    - No "still not working" button — if recovery fails, user closes/reopens
//
//  This module owns:
//    - Hidden-duration tracking (mirrors _jhHiddenAt in 72-main-late-mid.js)
//    - The visible overlay DOM (full-screen black with "RESUME" centered)
//    - The tap handler (synchronous audio recovery in-gesture)
//
//  Coexistence with the existing _jhResumeOverlay (82-main-late-tail.js):
//    - _jhResumeOverlay is the passive "RESUMING…" text shown during shader
//      reprewarm. It's non-interactive (pointer-events:none until shown).
//    - This resume gate is a SEPARATE interactive overlay. Both can stack;
//      the resume gate sits above (higher z-index) and is dismissed only by
//      a tap. After it dismisses, the reprewarm overlay may still be visible
//      for another beat.
// ═══════════════════════════════════════════════════
window._jhResumeGate = (function _resumeGateFactory() {
  const HIDDEN_THRESHOLD_MS = 2000;

  let overlayEl = null;
  let hiddenAt  = 0;
  let armed     = false;  // overlay is currently shown and waiting for a tap

  // Build the overlay DOM once, lazily, at first show. Higher z-index than
  // _jhResumeOverlay (99999) so it sits above the passive RESUMING text.
  function _buildOverlay() {
    if (overlayEl) return overlayEl;
    if (typeof document === 'undefined' || !document.body) return null;
    overlayEl = document.createElement('div');
    overlayEl.id = 'jh-resume-gate';
    overlayEl.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:100000',                   // above _jhResumeOverlay (99999)
      'background:#000',
      'color:#3ff',
      'font-family:Silkscreen,monospace',
      'font-size:32px',
      'letter-spacing:6px',
      'display:none',                     // start hidden
      'align-items:center',
      'justify-content:center',
      'opacity:1',
      'pointer-events:auto',
      '-webkit-user-select:none',
      'user-select:none',
      'cursor:pointer',
      'text-shadow:0 0 10px rgba(51,255,255,0.6)',
    ].join(';');
    overlayEl.textContent = 'RESUME';
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  // Run inside the tap gesture. EVERY audio recovery call here must be
  // synchronous — no awaits, no Promise chains, no setTimeout/rAF before
  // the resume(). The single iOS rule: resume() must be on the gesture's
  // call-stack. Side effects we schedule for later (rewire, replay) are fine.
  function _nuclearRecover() {
    if (typeof audioCtx === 'undefined' || !audioCtx) return;

    // 1. SYNCHRONOUS resume() inside the gesture. No .then(), no await.
    //    iOS Safari evaluates the call right here; .catch() handles rejection
    //    on the microtask queue but doesn't move the resume itself.
    try {
      if (audioCtx.state !== 'running') {
        audioCtx.resume().catch(() => {});
      }
    } catch (_) {}

    // 2. SYNCHRONOUS silent-buffer kick to nudge iOS sample-rate negotiation.
    //    This is the part that historically pulls a stuck context to running.
    try {
      const sb = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = sb;
      src.connect(audioCtx.destination);
      src.start(0);
    } catch (_) {}

    // 3. Lazy-init any track gains that never wired up (cold-start race).
    try { if (typeof _initTrackGains === 'function') _initTrackGains(); } catch (_) {}

    // 4. SYNCHRONOUS .play() on every track that was playing pre-interrupt,
    //    using the snapshot captured by _markAudioInterrupted. Calling play()
    //    inside the gesture is the second key requirement; double-rAF play()
    //    (what v79 does in _rewireTrackGains) misses the gesture window.
    let snap = null;
    try {
      // _interruptedPlayingSnapshot is module-scoped in 30-audio.js; it may
      // not be accessible from here directly. Fall back to checking which
      // tracks were paused: if a track was "paused" only because the
      // visibility handler paused it, we want to resume it.
      if (typeof allTracks === 'function') {
        snap = allTracks();
      }
    } catch (_) {}
    if (snap && typeof state !== 'undefined' && !state.muted) {
      // Only kick tracks that are mid-position (currentTime > 0) — those are
      // the ones the visibility handler paused. Tracks at position 0 were
      // intentionally stopped (e.g. game over) and shouldn't be resurrected.
      Object.keys(snap).forEach((k) => {
        const el = snap[k];
        if (!el) return;
        try {
          if (el.paused && (el.currentTime || 0) > 0.01) {
            // Special case: don't auto-resume gameplay tracks if the game is
            // paused — togglePause will start them when the user unpauses.
            if (state.phase === 'paused' && k !== 'title' && k !== 'radio') return;
            el.play().catch(() => {});
          }
        } catch (_) {}
      });
    }

    // 5. Clear the interrupted flag so subsequent visibility events get a
    //    clean slate. We just successfully ran the recovery from inside a
    //    real gesture, so by iOS's rules this is the recovery moment.
    try { if (typeof _clearAudioInterrupted === 'function') _clearAudioInterrupted(); } catch (_) {}
  }

  function _onTap(e) {
    if (!armed) return;
    // Capture phase: we MUST run before any other handler. stopImmediate so
    // a tap on the overlay does ONLY this — no game UI tap-through.
    if (e) {
      try { e.stopImmediatePropagation(); } catch (_) {}
      try { e.preventDefault(); } catch (_) {}
    }
    armed = false;
    // Run recovery synchronously RIGHT HERE in the gesture call-stack.
    _nuclearRecover();
    // Hide the overlay. Use display:none so it definitely doesn't intercept
    // anything else after this tap.
    if (overlayEl) overlayEl.style.display = 'none';
    // Remove the listeners so we don't fire on every subsequent tap.
    _detachListeners();
  }

  function _attachListeners() {
    if (!overlayEl) return;
    // Listen on the overlay itself, not document. Capture phase: ensure
    // we win over any other listener if event paths overlap.
    const opts = { capture: true, passive: false };
    overlayEl.addEventListener('pointerdown', _onTap, opts);
    overlayEl.addEventListener('touchstart',  _onTap, opts);
    overlayEl.addEventListener('mousedown',   _onTap, opts);
    overlayEl.addEventListener('click',       _onTap, opts);
  }
  function _detachListeners() {
    if (!overlayEl) return;
    const opts = { capture: true, passive: false };
    overlayEl.removeEventListener('pointerdown', _onTap, opts);
    overlayEl.removeEventListener('touchstart',  _onTap, opts);
    overlayEl.removeEventListener('mousedown',   _onTap, opts);
    overlayEl.removeEventListener('click',       _onTap, opts);
  }

  function _show() {
    if (armed) return;
    const el = _buildOverlay();
    if (!el) return;
    el.style.display = 'flex';
    armed = true;
    _attachListeners();
  }

  // Public API: called by the visibilitychange handler in 72-main-late-mid.js.
  return {
    onHide() {
      hiddenAt = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    },
    onVisible() {
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const dt = hiddenAt ? (now - hiddenAt) : 0;
      hiddenAt = 0;
      if (dt > HIDDEN_THRESHOLD_MS) _show();
    },
    // Imperative show — used by webglcontextrestored or other recovery sites
    // that want to force a gesture-gated audio recovery.
    forceShow() { _show(); },
    isArmed() { return armed; },
  };
})();

// Wire visibility events to the gate. The existing visibilitychange handler
// in 72-main-late-mid.js still runs (it pauses audio on hide, manages the
// shader reprewarm overlay, etc.) — we just add the resume-gate hooks here.
//
// Two handlers on the same event run in registration order. 72-main-late-mid
// registers earlier (it's in src/72-main-late-mid.js, this is src/85-...) so
// 72's handler runs first: it pauses tracks on hide, fires _markAudioInterrupted,
// schedules reprewarm on visible. Then this handler runs: it ticks the gate's
// internal hidden-duration tracker and shows the overlay if needed.
//
// CRITICAL: we deliberately do NOT call audioCtx.resume() or play() on
// visible — those calls fail silently outside a gesture. The gate's tap
// handler does it instead, where iOS will actually honor it.
document.addEventListener('visibilitychange', () => {
  try {
    if (document.hidden) {
      window._jhResumeGate.onHide();
    } else {
      window._jhResumeGate.onVisible();
    }
  } catch (_) {}
});

// pageshow event: fired on bfcache restore on iOS. Not all backgroundings go
// through visibilitychange (esp. when iOS does a hard suspend then warm-start).
// Treat any bfcache restore as a backgrounding event from the gate's PoV.
window.addEventListener('pageshow', (e) => {
  try {
    if (e && e.persisted) {
      // Cold-restore from bfcache — treat as long hide. Force-show the gate.
      window._jhResumeGate.forceShow();
    }
  } catch (_) {}
});
