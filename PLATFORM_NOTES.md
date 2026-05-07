# Platform Notes (web vs iOS Capacitor app)

The same codebase ships to two places:

1. **Web** — Vercel, https://tunnel-proto.vercel.app. Mobile Safari, desktop browsers.
2. **iOS app** — Capacitor wrapper, App Store distribution. Same web files bundled inside a native iOS shell.

## Rules for Editing

### Safe to edit anywhere (auto-syncs to both)
- `src/*.js`
- `style.css`
- `index.html`
- `assets/`
- `scripts/`
- `manifest.json`, `privacy.html`

Push to `main` → Vercel deploys automatically. iOS app needs a manual rebuild (ask in the iOS chat: "port to iOS").

### Do NOT touch unless you know iOS Capacitor
- `ios/` — Xcode project, Swift files, native config
- `capacitor.config.json` — Capacitor runtime config
- `package.json` Capacitor deps (`@capacitor/*`, `@capacitor-community/*`)
- `www/` — auto-generated, gitignored

## Platform-Specific Code Pattern

When something needs different behavior on iOS app vs web, **never** check `window.Capacitor` directly. Use the helpers from `src/01-platform.js`:

```js
// Boolean checks
if (PLATFORM.isNative) {
  // Inside Capacitor iOS or Android app
}
if (PLATFORM.isIOSNative) {
  // Specifically inside iOS Capacitor app (not Android, not web)
}
if (PLATFORM.isIOS) {
  // Any iPhone/iPad — covers Safari + Capacitor + PWA
}

// Calling Capacitor plugins safely
const Haptics = nativePlugin('Haptics');
if (Haptics) {
  Haptics.impact({ style: 'medium' });
} else if (navigator.vibrate) {
  navigator.vibrate(20); // web fallback
}
```

`nativePlugin()` returns `null` on web or if the plugin isn't installed, so always null-check before calling methods.

## Why This Pattern

- **Single source of truth** — all platform detection in one file.
- **Web stays web** — `PLATFORM.isNative` is `false` on Vercel, so iOS-only branches don't run.
- **Easy to test** — open the page in browser, all `isNative` branches no-op cleanly.
- **Capacitor docs recommend this** — see https://capacitorjs.com/docs/basics/utilities

## Existing Platform Branches

| Feature | File | Web Behavior | iOS App Behavior |
|---|---|---|---|
| Add to Home Screen banner | `60-main-late.js` | Shows on iOS Safari | Hidden (already an app) |
| AVAudioSession (mix with music) | `ios/App/App/AppDelegate.swift` | N/A | Mixes with Spotify/Music, respects silent switch |
| Status bar | `Info.plist` | Browser handles | Hidden for fullscreen |
