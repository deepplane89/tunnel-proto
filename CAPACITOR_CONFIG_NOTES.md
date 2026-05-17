# Capacitor config — invariants and notes

These notes used to live as `_comment` / `_warning` keys inside `capacitor.config.json`. Apple App Store reviewers have been increasingly picky about unknown manifest keys in shipped bundles, so the notes were moved here on May 17 2026. The runtime config now contains only Capacitor-defined keys.

## Hard rules (do not change without reading IOS_CONTINUITY.md)

- **`ios.contentInset` MUST stay `"never"`**. Changing it brings back the home-indicator black strip. See IOS_CONTINUITY.md section 4 for the regression history.
- **`backgroundColor` MUST stay `"#050614"` at BOTH top-level AND `ios.backgroundColor`**. Without `webView.isOpaque = false` in AppDelegate (which depends on this color match), Capacitor issue #5335 causes the strip to return.
- **`server.url` MUST remain absent / commented** for any build that ships to App Store or TestFlight. The app loads the JS bundle from `www/` baked into the binary. Loading game JS from the web at runtime is a known App Store guideline 4.7 rejection trigger.
- **`webDir` is `"www"`**. Files reach `www/` via `scripts/build.sh`'s PROD mirror. See IOS_CONTINUITY.md section 2.

## Baseline tag

Working baseline: `ios-baseline-working` at commit `d7e7824` on branch `dev`. Restore with:

```bash
git checkout ios-baseline-working -- capacitor.config.json style.capacitor.css ios/App/App/AppDelegate.swift ios/App/App/Base.lproj/Main.storyboard ios/App/App/Base.lproj/LaunchScreen.storyboard
```

## WKAppBoundDomains removal (May 17 2026)

`WKAppBoundDomains` was removed from `ios/App/App/Info.plist` and `limitsNavigationsToAppBoundDomains` was removed from `capacitor.config.json`. Rationale:

- The app ships as a 100% local bundle (no `server.url`, no remote JS loading).
- The `capacitor://` scheme used by the local bundle is treated as app-bound automatically by iOS — no explicit allowlist needed.
- Keeping `tunnel-proto.vercel.app` in the allowlist was leftover from earlier hybrid experiments and confused App Store reviewers ("why does this offline app declare a remote domain?").

If you ever want to re-enable remote loading (e.g. for a separate dev-only build flavor), you must add BOTH the plist `WKAppBoundDomains` array AND `limitsNavigationsToAppBoundDomains: true` back together. Never one without the other.

## Why these notes are not in capacitor.config.json itself

Two reasons:
1. App Store reviewers have rejected apps for unknown keys in bundled JSON manifests. Even keys prefixed with `_` aren't safe — they're not part of the Capacitor schema.
2. Sibling docs are easier to grep, can be longer, and don't ship in the binary.

The `IOS_CONTINUITY.md` doc at repo root is the full bible. This file is the short version that lives next to `capacitor.config.json` so editors of that file see it.
