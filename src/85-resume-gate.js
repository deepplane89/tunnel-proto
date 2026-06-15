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

    // 0. Capacitor iOS bridge: ask native to rebuild AVAudioSession
    //    (setActive(false) -> setActive(true) + brief silent AVAudioPlayer kick).
    //    Posted synchronously BEFORE audioCtx.resume() so Swift's session
    //    rebuild completes within the same gesture window the JS resume() rides.
    //    No-op on web: window.webkit.messageHandlers.jhAudio is undefined
    //    outside Capacitor's WKWebView (and is only registered by the iOS
    //    AppDelegate — absent on Mobile Safari and desktop browsers).
    //    JS does NOT await the result; Swift handles the rebuild synchronously
    //    enough within the bridge call that the subsequent resume() still rides
    //    the trusted-activation context.
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jhAudio) {
        window.webkit.messageHandlers.jhAudio.postMessage({ action: 'rebuildSession' });
      }
    } catch (_) { /* no-op on web */ }

    // 1. SYNCHRONOUS suspend()->resume() cycle inside the gesture. iOS Safari
    //    lies about audioCtx.state (WebKit Bug 276687) — it can claim
    //    'running' while the OS audio resources are actually released. A bare
    //    resume() in that state is a no-op. The cycle forces the state machine
    //    to reset. Per CreateJS / WebKit Bug 276687 comment 6 + comment 4:
    //    'manually suspend/resume on visibility change, even when the context
    //    is set to running'. Both calls fire synchronously in the gesture;
    //    .catch() lives on the microtask queue but does not move the calls.
    try {
      audioCtx.suspend().catch(() => {});
      audioCtx.resume().catch(() => {});
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

    // 5. Clear the interrupted flag — but ONLY after verifying the resume
    //    actually took. Clearing synchronously (pre-v92 behavior) meant a
    //    silently-rejected resume left the flag clean while audio was dead,
    //    so the next visibility event wouldn't re-arm the recovery. Wait
    //    ~120ms for the audio thread to settle, then check state before
    //    clearing. If state is still not 'running', leave the flag set so
    //    the next gesture or visibility event tries again.
    setTimeout(() => {
      try {
        if (audioCtx && audioCtx.state === 'running' &&
            typeof _clearAudioInterrupted === 'function') {
          _clearAudioInterrupted();
        }
      } catch (_) {}
    }, 120);
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
    // Industry-standard mobile web game pattern: on resume from background,
    // just reload the page. MediaElementSource on iOS PWA is fundamentally
    // unrecoverable after the audio session is released (Howler.js #1194,
    // WebKit Bug 276687). Roblox, Genshin web wrappers, and other shipped
    // HTML5 games all reload on background-return rather than attempt
    // recovery. Deterministic fresh state beats a flaky resume path.
    // The overlay stays visible during the reload so the user sees an
    // explicit "reloading" beat rather than a stale game frame.
    try { window.location.reload(); } catch (_) {
      // Reload threw (shouldn't happen) — fall back to the in-place recovery
      // so we at least try something. Hide the overlay since reload failed.
      _nuclearRecover();
      if (overlayEl) overlayEl.style.display = 'none';
      _detachListeners();
    }
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

  // Public API: called by the visibilitychange handler in 72-main-late-mid.js,
  // and by the iOS Capacitor AppDelegate via WKWebView evaluateJavaScript.
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

    // Native-bridge auto-recovery, called by Swift's AppDelegate observers
    // (applicationDidBecomeActive, AVAudioSession.interruptionNotification
    // —> .ended) via WKWebView evaluateJavaScript.
    //
    // On most iOS versions, evaluateJavaScript from a system lifecycle
    // notification counts as a trusted activation context — enough to let
    // audioCtx.resume() run successfully WITHOUT the user tapping the overlay.
    // We try that first; if it works (audioCtx.state === 'running' after the
    // recovery), no overlay is shown. If it fails (state still suspended /
    // interrupted), we fall back to the regular overlay flow and the user
    // can tap RESUME themselves.
    //
    // The resume() call inside _nuclearRecover() MUST be synchronous on the
    // call-stack of this function invocation — i.e. on the call-stack of the
    // WKWebView.evaluateJavaScript that Swift made. Awaits AFTER resume() are
    // fine; the trusted-activation check happens at the resume() call site.
    //
    // Returns Promise<boolean>: true if audio is running after the attempt,
    // false if the overlay was shown as fallback.
    tryNativeResume() {
      return new Promise((resolve) => {
        // Fast-path: already running, nothing to do.
        try {
          if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'running') {
            return resolve(true);
          }
        } catch (_) {}

        // Synchronously run the same recovery the overlay-tap path runs.
        // Order matters: resume() must be reached on this exact call-stack.
        try { _nuclearRecover(); } catch (_) {}

        // resume() is queued on the microtask/audio-thread — give it a beat
        // to update state before deciding success. ~100ms is enough on iOS
        // for the state machine to settle but short enough that a failed
        // attempt still feels responsive when the overlay shows.
        setTimeout(() => {
          let running = false;
          try {
            running = !!(typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'running');
          } catch (_) {}
          if (running) return resolve(true);
          // Fallback: trusted-activation didn't take — surface the overlay so
          // the user can tap and recover via a real gesture.
          try { _show(); } catch (_) {}
          resolve(false);
        }, 120);
      });
    },
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
