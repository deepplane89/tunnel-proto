// ═══════════════════════════════════════════════════
//  iOS LIFECYCLE — backstop for visibilitychange
// ═══════════════════════════════════════════════════
//
// The existing `visibilitychange` handler in 72-main-late-mid.js has
// careful pause/resume logic — it pauses music tracks, suspends the
// AudioContext, marks audio as interrupted, snapshots which tracks were
// playing, re-issues play() on resume, and reprewarms shaders after a
// long background.
//
// On Capacitor iOS, `visibilitychange` fires unreliably from a WKWebView
// (sometimes late, sometimes not at all). We don't want to duplicate the
// pause/resume logic here — that caused a regression where:
//   1. Music wouldn't restart on return (our resume path skipped the
//      _rewireTrackGains snapshot replay).
//   2. Game state could double-pause and feel like it "reset".
//
// Fix: this file ONLY ensures the existing handler runs reliably. It does
// not pause/resume audio itself. It listens for Capacitor's App lifecycle
// events and fires a synthetic `visibilitychange` event, so all the
// existing logic just works.
//
// Web build: native-only no-op so Vercel / mobile Safari are unaffected.

(function setupIOSLifecycle() {
  if (!window.PLATFORM || !window.PLATFORM.isNative) return;

  // Track our own "is hidden" state so we don't fire duplicate events when
  // the document.hidden flag is already in sync (iOS often fires both).
  let lastHiddenState = null;

  function setHidden(shouldBeHidden, reason) {
    try {
      // Already in the requested state? Skip — avoid double-firing the
      // visibilitychange handler which would double-pause music.
      if (lastHiddenState === shouldBeHidden) return;
      lastHiddenState = shouldBeHidden;

      // If the browser's document.hidden is already correct, just fire
      // the event so the existing handler runs. If it's out of sync,
      // we still fire the event — the handler reads document.hidden,
      // and Capacitor WKWebView usually has it correct by the time we
      // get here.
      try { console.log('[ios-lifecycle] visibility →', shouldBeHidden ? 'hidden' : 'visible', '(' + reason + ')'); } catch (_) {}

      // Synthesize the event so the existing visibilitychange handler runs.
      const evt = new Event('visibilitychange');
      document.dispatchEvent(evt);
    } catch (_) {}
  }

  function attachAppPlugin() {
    const App = window.nativePlugin && window.nativePlugin('App');
    if (!App || typeof App.addListener !== 'function') return false;

    try {
      App.addListener('appStateChange', (state) => {
        if (state && state.isActive === false) {
          setHidden(true,  'appStateChange:inactive');
        } else if (state && state.isActive === true) {
          setHidden(false, 'appStateChange:active');
        }
      });
    } catch (_) {}

    try {
      App.addListener('pause',  () => setHidden(true,  'App.pause'));
      App.addListener('resume', () => setHidden(false, 'App.resume'));
    } catch (_) {}

    return true;
  }

  if (!attachAppPlugin()) {
    document.addEventListener('deviceready', attachAppPlugin, { once: true });
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      if (attachAppPlugin() || tries > 30) clearInterval(poll);
    }, 100);
  }

  // Track real visibilitychange so our state stays in sync. If the OS
  // already fires it correctly, we just record it; we won't synthesize
  // a duplicate.
  document.addEventListener('visibilitychange', () => {
    lastHiddenState = !!document.hidden;
  });
})();
