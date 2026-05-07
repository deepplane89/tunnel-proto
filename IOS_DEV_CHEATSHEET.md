# iOS Dev Cheat Sheet

This game has TWO deployment targets sharing one source tree:
- **Web (Vercel)** — auto-deploys from `main` branch on push
- **iOS app (Capacitor)** — bundles web into a native wrapper

## File ownership

- `src/`, `style.css`, `index.html`, `assets/` — **shared game code**. Edit once, fixes both.
- `capacitor.config.json`, `ios/`, `package.json` — **iOS-only**. Vercel ignores.

## DEV MODE — live-load from Vercel (no rebuild on web changes)

Edit `capacitor.config.json` and add inside the `server` block:
```json
"server": {
  "androidScheme": "https",
  "url": "https://tunnel-proto.vercel.app",
  "cleartext": false
}
```

Then rebuild ONCE:
```bash
cd /Users/robertc/Developer/tunnel-proto
npx cap sync ios
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS,id=BD57AB05-90D0-5385-810F-202362CDB822' \
  -derivedDataPath build-device/ -allowProvisioningUpdates build
xcrun devicectl device install app --device BD57AB05-90D0-5385-810F-202362CDB822 build-device/Build/Products/Debug-iphoneos/App.app
xcrun devicectl device process launch --device BD57AB05-90D0-5385-810F-202362CDB822 com.deepplane.jethorizon
```

**After this:** every web push to GitHub → Vercel deploys (~30s) → close+reopen iOS app → updated.

## PRODUCTION MODE — bundled (App Store ready)

Edit `capacitor.config.json` and **remove** the `server.url` line (keep `androidScheme`):
```json
"server": {
  "androidScheme": "https"
}
```

Then rebuild with the bundled web assets:
```bash
cd /Users/robertc/Developer/tunnel-proto
git pull   # make sure you have latest web code
npx cap sync ios   # copies www/ into the iOS app bundle
# Then archive in Xcode for App Store distribution (or Debug build for testing)
```

## Pull latest web changes into iOS app (bundled mode)

```bash
cd /Users/robertc/Developer/tunnel-proto
git pull
npx cap sync ios
# rebuild as above
```

## ⚠️ App Store gotcha

Apps that load primary content from a remote URL (server.url set) can be flagged
under Apple Guideline 4.7. ALWAYS remove server.url before submitting.
