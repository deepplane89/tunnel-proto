// Capacitor iOS lifecycle bridge. Capacitor's native App plugin emits
// app-state events that the WKWebView's standard `visibilitychange` event
// doesn't always reflect on iOS — meaning swipe-to-App-Switcher,
// background-tap return, lock-screen, and notification-center pulls can
// silently fail to pause/resume the game's audio + RAF loop.
//
// We listen for those Capacitor events and dispatch a synthetic
// `visibilitychange` so the existing handler in 72-main-late-mid.js (which
// already does pause/snapshot/resume correctly for desktop browsers) just
// works on iOS Capacitor builds.
//
// Native-only: this file is a no-op on web/Android. Only fires when the
// page is running inside Capacitor's iOS WebView (detected via the
// `platform-ios-native` class set by 01-platform.js).

(function () {
  // Bail early on non-iOS-native (web, Android, dev server in browser).
  if (!document.documentElement.classList.contains('platform-ios-native')) return;

  // Capacitor 8 exposes the App plugin via the global Capacitor.Plugins.App
  // (after @capacitor/app is bundled). If it's not available, we can still
  // fall back to pagehide/pageshow which fire reasonably on iOS WKWebView.
  const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  const App = Plugins.App;

  let lastHiddenState = null;

  // Audio-ready gate: on a cold-boot launch under Capacitor, iOS often fires
  // pageshow (and sometimes a spurious appStateChange) BEFORE the AudioContext
  // and music elements have been wired by initAudio(). If we dispatch a
  // synthetic visibilitychange in that window, the resume handler in
  // 72-main-late-mid.js runs against an uninitialized snapshot — symptom:
  // first-launch silence until you tap into a screen.
  //
  // We queue any pre-init events and replay the LAST one once audio is ready.
  // The web side signals readiness by setting window.__jhAudioReady = true at
  // the end of initAudio(). If the flag never gets set (e.g. user didn't tap
  // to satisfy mobile autoplay), the queued event is still drained on the
  // first real user gesture so backgrounding-before-first-tap still pauses.
  let queuedEvent = null;
  function isAudioReady() { return window.__jhAudioReady === true; }

  function _dispatch(hidden, source) {
    try {
      console.log('[ios-lifecycle]', source, 'hidden=' + hidden);
      window.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    } catch (e) {
      console.warn('[ios-lifecycle] dispatch failed', e);
    }
  }

  function fireVisibility(hidden, source) {
    if (lastHiddenState === hidden) return;       // dedupe
    lastHiddenState = hidden;
    if (!isAudioReady()) {
      // Queue ONLY the most recent transition so a hide→show before init
      // resolves to a single show (the current truth).
      queuedEvent = { hidden: hidden, source: source + '+queued' };
      console.log('[ios-lifecycle]', source, 'queued (audio not ready) hidden=' + hidden);
      return;
    }
    _dispatch(hidden, source);
  }

  // Drain queued event once audio init has finished. Polls because we don't
  // want a hard dependency on whatever module sets __jhAudioReady (could be
  // initAudio, could be the first-tap handler — both legitimate signals).
  let _drainPoll = setInterval(() => {
    if (!isAudioReady()) return;
    clearInterval(_drainPoll); _drainPoll = null;
    if (queuedEvent) {
      const q = queuedEvent; queuedEvent = null;
      _dispatch(q.hidden, q.source + '+drain');
    }
  }, 100);
  // Safety: if init never completes (e.g. user-gesture path failed), stop
  // polling after 30s and drain whatever's queued anyway so backgrounding
  // still gets handled (better partial than silent).
  setTimeout(() => {
    if (!_drainPoll) return;
    clearInterval(_drainPoll); _drainPoll = null;
    if (queuedEvent) {
      const q = queuedEvent; queuedEvent = null;
      console.warn('[ios-lifecycle] audio never ready, draining queued event anyway');
      _dispatch(q.hidden, q.source + '+timeout-drain');
    }
  }, 30000);

  if (App && App.addListener) {
    App.addListener('appStateChange', (state) => {
      // state.isActive: true when foreground, false when backgrounded.
      fireVisibility(!state.isActive, 'appStateChange');
    });
    App.addListener('pause', () => fireVisibility(true, 'pause'));
    App.addListener('resume', () => fireVisibility(false, 'resume'));
  } else {
    console.warn('[ios-lifecycle] @capacitor/app not available; using pagehide/pageshow fallback');
  }

  // Always wire pagehide/pageshow — these fire on iOS WKWebView and are
  // a useful belt-and-suspenders alongside the App plugin events.
  window.addEventListener('pagehide', () => fireVisibility(true, 'pagehide'));
  window.addEventListener('pageshow', () => fireVisibility(false, 'pageshow'));
})();
