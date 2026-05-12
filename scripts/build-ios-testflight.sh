#!/bin/bash
# build-ios-testflight.sh — Archive Jet Horizon for TestFlight and upload to App Store Connect.
#
# Prerequisites (one-time):
#   1. App Store Connect API key created at https://appstoreconnect.apple.com/access/api
#      Save the .p8 to ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
#   2. Export env vars (add to ~/.zshrc):
#        export ASC_API_KEY_ID="ABCD123456"          # 10-char key id
#        export ASC_API_ISSUER_ID="xxxxxxxx-xxxx-..." # UUID issuer id
#   3. App record exists in App Store Connect for bundle com.deepplane.jethorizon
#
# Usage:
#   bash scripts/build-ios-testflight.sh
#
# Output:
#   ios/App/build-archive/App.xcarchive
#   ios/App/build-archive/export/App.ipa
#   Upload status printed to console

set -e

# ── Config ──────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SCHEME="App"
PROJECT="ios/App/App.xcodeproj"
CONFIG="Release"
TEAM_ID="64KJWV8765"
BUNDLE_ID="com.deepplane.jethorizon"
ARCHIVE_DIR="ios/App/build-archive"
ARCHIVE_PATH="$ARCHIVE_DIR/App.xcarchive"
EXPORT_PATH="$ARCHIVE_DIR/export"
EXPORT_OPTIONS_PLIST="$ARCHIVE_DIR/ExportOptions.plist"

# ── Sanity checks ───────────────────────────────────────────────────────────
echo "=== Sanity checks ==="
if [ -z "$ASC_API_KEY_ID" ] || [ -z "$ASC_API_ISSUER_ID" ]; then
  echo "ERROR: Set ASC_API_KEY_ID and ASC_API_ISSUER_ID env vars."
  echo "See script header for setup instructions."
  exit 1
fi

# Confirm prod build (no dev tools)
if [ -f dist/game.js ]; then
  FIRST_LINE=$(head -1 dist/game.js)
  if [[ "$FIRST_LINE" != *"JH_BUILD: prod"* ]]; then
    echo "ERROR: dist/game.js is NOT a prod build (first line: $FIRST_LINE)"
    echo "Run: bash scripts/build.sh   (no --dev flag)"
    exit 1
  fi
  echo "OK: dist/game.js is a prod build"
fi

# ── Sync latest ─────────────────────────────────────────────────────────────
echo "=== git status ==="
git status --short

echo "=== Building web bundle (prod) ==="
bash scripts/build.sh

# ── Sync to Capacitor www/ ──────────────────────────────────────────────────
echo "=== Copying web files to www/ for Capacitor ==="
rm -rf www
mkdir -p www
cp index.html style.css manifest.json privacy.html www/
cp -r src dist assets vendor www/ 2>/dev/null || true

echo "=== cap sync ios ==="
npx cap sync ios

# ── Write ExportOptions.plist ───────────────────────────────────────────────
echo "=== Writing ExportOptions.plist ==="
mkdir -p "$ARCHIVE_DIR"
cat > "$EXPORT_OPTIONS_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>teamID</key>
    <string>$TEAM_ID</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>stripSwiftSymbols</key>
    <true/>
    <key>uploadBitcode</key>
    <false/>
    <key>uploadSymbols</key>
    <true/>
    <key>destination</key>
    <string>export</string>
</dict>
</plist>
EOF

# ── Archive ─────────────────────────────────────────────────────────────────
echo "=== Archiving ($CONFIG) ==="
rm -rf "$ARCHIVE_PATH"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  archive 2>&1 | tail -30

if [ ! -d "$ARCHIVE_PATH" ]; then
  echo "ERROR: Archive failed — $ARCHIVE_PATH not created"
  exit 1
fi

# ── Export .ipa ─────────────────────────────────────────────────────────────
echo "=== Exporting .ipa ==="
rm -rf "$EXPORT_PATH"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PLIST" \
  -allowProvisioningUpdates 2>&1 | tail -20

IPA_PATH="$EXPORT_PATH/App.ipa"
if [ ! -f "$IPA_PATH" ]; then
  echo "ERROR: .ipa not found at $IPA_PATH"
  exit 1
fi

IPA_SIZE=$(du -h "$IPA_PATH" | cut -f1)
echo "OK: .ipa built ($IPA_SIZE) at $IPA_PATH"

# ── Validate ────────────────────────────────────────────────────────────────
echo "=== Validating with App Store Connect ==="
xcrun altool --validate-app \
  -f "$IPA_PATH" \
  -t ios \
  --apiKey "$ASC_API_KEY_ID" \
  --apiIssuer "$ASC_API_ISSUER_ID" 2>&1 | tail -10

# ── Upload ──────────────────────────────────────────────────────────────────
echo "=== Uploading to App Store Connect ==="
xcrun altool --upload-app \
  -f "$IPA_PATH" \
  -t ios \
  --apiKey "$ASC_API_KEY_ID" \
  --apiIssuer "$ASC_API_ISSUER_ID" 2>&1 | tail -15

echo ""
echo "=== DONE ==="
echo "Build uploaded. Check App Store Connect → TestFlight in ~5-15 min for processing."
echo "URL: https://appstoreconnect.apple.com/apps"
