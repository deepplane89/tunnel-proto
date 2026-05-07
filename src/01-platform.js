// ═══════════════════════════════════════════════════
//  PLATFORM DETECTION (web vs Capacitor native iOS/Android)
// ═══════════════════════════════════════════════════
//
// Single source of truth for runtime platform checks.
// All Capacitor-specific code paths in the rest of the codebase MUST
// route through PLATFORM.* and nativePlugin() instead of touching
// window.Capacitor directly.
//
// Why: keeps "is this native?" logic in one file, makes web/iOS
// abstractions uniform, and means feature code can stay platform-agnostic.
//
// PATTERN FOR PLATFORM-SPECIFIC FEATURES:
//   const Haptics = nativePlugin('Haptics');
//   if (Haptics) Haptics.impact({ style: 'medium' });
//   else if (navigator.vibrate) navigator.vibrate(20);
//
// See: https://capacitorjs.com/docs/basics/utilities

const PLATFORM = {
  // True when running inside the Capacitor iOS or Android app shell.
  // False on Vercel, Mobile Safari, desktop browsers, PWAs.
  isNative: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),

  // 'web' | 'ios' | 'android' — Capacitor's own answer.
  name: (window.Capacitor && window.Capacitor.getPlatform) ? window.Capacitor.getPlatform() : 'web',

  // True for iPhone/iPad/iPod regardless of native vs web (UA-based).
  isIOS: /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),

  // True only for installed PWA on iOS Safari (Add to Home Screen).
  // Distinct from isNative — isNative covers Capacitor app, this covers PWA.
  isStandalonePWA: window.navigator.standalone === true,
};

// Convenience: PLATFORM.isIOSNative === Capacitor app on iOS specifically.
PLATFORM.isIOSNative = PLATFORM.isNative && PLATFORM.name === 'ios';

// Get a Capacitor plugin if we're native AND the plugin is registered.
// Returns the plugin object, or null on web / when plugin isn't installed.
// Always check the return value before calling methods on it.
function nativePlugin(name) {
  if (!PLATFORM.isNative) return null;
  if (window.Capacitor.isPluginAvailable && !window.Capacitor.isPluginAvailable(name)) return null;
  return (window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;
}

// Expose globally for use across the unity-build (concatenated) bundle.
window.PLATFORM = PLATFORM;
window.nativePlugin = nativePlugin;
