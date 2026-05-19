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

  function fireVisibility(hidden, source) {
    if (lastHiddenState === hidden) return;       // dedupe
    lastHiddenState = hidden;
    try {
      // Some browsers won't let us redefine document.hidden; we just
      // dispatch the event and let listeners read document.hidden as-is.
      // The handler in 72-main-late-mid.js checks document.hidden, which
      // WKWebView updates based on its own page-lifecycle signals — and
      // for cases where it doesn't, the synthetic dispatch + our own
      // tracking is enough to trigger the pause/resume flow.
      console.log('[ios-lifecycle]', source, 'hidden=' + hidden);
      window.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    } catch (e) {
      console.warn('[ios-lifecycle] dispatch failed', e);
    }
  }

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
