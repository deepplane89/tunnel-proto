// ═══════════════════════════════════════════════════
//  iOS LIFECYCLE — force-silence audio on background
// ═══════════════════════════════════════════════════
//
// Bug we're fixing:
//   On Capacitor iOS, sound (especially radio + Web Audio buffer sources)
//   could keep playing after the app was backgrounded or even swiped away.
//
// Root causes:
//   1. AVAudioSession remained "active" on iOS even though the WebView
//      was paused — fixed in AppDelegate.swift (deactivate on background,
//      reactivate on foreground).
//   2. `visibilitychange` doesn't always fire reliably on Capacitor iOS,
//      and even when it does, JS may run *after* the audio has already
//      kept playing for a frame or two.
//
// This file adds belt-and-suspenders on the JS side: we listen for
// Capacitor's @capacitor/app `appStateChange` event (fires synchronously
// from the native side via the bridge) and force-silence everything we
// know about — AudioContext, all <audio> elements, engine sound, radio.
//
// Web build: this entire block is a no-op unless PLATFORM.isNative is true,
// so behavior on Vercel / mobile Safari is unchanged.

(function setupIOSLifecycle() {
  if (!window.PLATFORM || !window.PLATFORM.isNative) return;

  // Force-silence everything we can reach.
  function forceSilenceAll(reason) {
    try {
      // 1. Suspend the WebAudio context — stops every BufferSourceNode
      //    immediately, including in-flight SFX.
      if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'running') {
        audioCtx.suspend().catch(() => {});
      }
    } catch (_) {}

    try {
      // 2. Pause every <audio> element on the page (music tracks, engine
      //    voice, radio, etc.).
      const els = document.querySelectorAll('audio');
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el && !el.paused) {
          try { el.pause(); } catch (_) {}
        }
      }
    } catch (_) {}

    try {
      // 3. If a music-track helper exists, pause through that path too —
      //    handles MediaElementSource graphs that bypass the <audio>
      //    element's paused flag.
      if (typeof allTracks === 'function') {
        const tracks = allTracks();
        if (tracks) {
          Object.values(tracks).forEach(el => {
            if (el && typeof el.pause === 'function' && !el.paused) {
              try { el.pause(); } catch (_) {}
            }
          });
        }
      }
    } catch (_) {}

    try {
      // 4. Mark the audio interrupted so resume paths know to rewire on
      //    foreground (matches the existing visibilitychange handler).
      if (typeof _markAudioInterrupted === 'function') _markAudioInterrupted();
    } catch (_) {}

    try { console.log('[ios-lifecycle] forceSilenceAll:', reason); } catch (_) {}
  }

  // Resume audio context on foreground — JS-side mirror of the AppDelegate
  // reactivation. Existing visibilitychange handlers will re-issue play()
  // for tracks that were active.
  function tryResumeAudio(reason) {
    try {
      if (typeof audioCtx !== 'undefined' && audioCtx &&
          (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted')) {
        audioCtx.resume().catch(() => {});
      }
    } catch (_) {}
    try { console.log('[ios-lifecycle] tryResumeAudio:', reason); } catch (_) {}
  }

  // ── Capacitor App plugin ───────────────────────────────────────────────
  // Fires reliably on iOS lifecycle changes via the native bridge. This is
  // more dependable than visibilitychange in a WKWebView.
  function attachAppPlugin() {
    const App = window.nativePlugin && window.nativePlugin('App');
    if (!App || typeof App.addListener !== 'function') return false;

    try {
      App.addListener('appStateChange', (state) => {
        // state.isActive === true  → app foregrounded
        // state.isActive === false → app backgrounded / lost focus
        if (state && state.isActive === false) {
          forceSilenceAll('appStateChange:inactive');
        } else if (state && state.isActive === true) {
          tryResumeAudio('appStateChange:active');
        }
      });
    } catch (_) {}

    try {
      // pause / resume events fire on full background/foreground transitions
      App.addListener('pause',  () => forceSilenceAll('App.pause'));
      App.addListener('resume', () => tryResumeAudio('App.resume'));
    } catch (_) {}

    return true;
  }

  // The Capacitor bridge may not be ready immediately — try now, and again
  // after deviceready. attachAppPlugin is idempotent in practice (Capacitor
  // dedupes identical listeners).
  if (!attachAppPlugin()) {
    document.addEventListener('deviceready', attachAppPlugin, { once: true });
    // Fallback: poll briefly until the plugin appears (usually <100ms).
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      if (attachAppPlugin() || tries > 30) clearInterval(poll);
    }, 100);
  }

  // ── Page-hide as last-resort safety net ────────────────────────────────
  // pagehide fires on iOS when the app is being killed (terminate).
  window.addEventListener('pagehide', () => forceSilenceAll('pagehide'));
})();
