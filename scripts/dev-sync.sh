#!/usr/bin/env bash
# dev-sync.sh — pull latest origin/dev, force-reset local, rebuild as DEV bundle.
# Use this on the Mac mini to keep the local dev server in lockstep with origin/dev.
#
# Destroys any local commits or uncommitted changes on the current branch.
# Only run this on the Mac mini that's serving via python http.server.
#
# Usage:  bash scripts/dev-sync.sh

set -euo pipefail

REPO="${REPO:-$HOME/Developer/tunnel-proto}"
BRANCH="${BRANCH:-dev}"

cd "$REPO"

echo "── dev-sync ── $(date '+%H:%M:%S')"
echo "fetch + reset to origin/$BRANCH..."
git fetch origin "$BRANCH" --quiet
git reset --hard "origin/$BRANCH" --quiet

HEAD_SHA="$(git rev-parse --short HEAD)"
HEAD_MSG="$(git log -1 --pretty=%s)"
echo "  → $HEAD_SHA  $HEAD_MSG"

echo "building DEV bundle..."
bash scripts/build.sh --dev > /tmp/dev-sync-build.log 2>&1 || {
  echo "BUILD FAILED. Last 10 lines:"; tail -10 /tmp/dev-sync-build.log; exit 1;
}

FIRST_LINE="$(head -1 dist/game.js)"
case "$FIRST_LINE" in
  *"JH_BUILD: dev"*) echo "  → dev bundle confirmed: $FIRST_LINE" ;;
  *) echo "  → WRONG BUILD MARKER: $FIRST_LINE"; exit 1 ;;
esac

TS=$(date +%s)
sed -i.bak -E "s|game\\.js\\?v=[0-9]+|game.js?v=${TS}|" index.html
rm -f index.html.bak
echo "  → cache buster: v=$TS"

# Quick sanity check against local server if it's up
if curl -s --max-time 2 http://127.0.0.1:8080/index.html > /tmp/dev-sync-served.html 2>/dev/null; then
  SERVED_BUSTER="$(grep -oE 'game\.js\?v=[0-9]+' /tmp/dev-sync-served.html | head -1)"
  if [ "$SERVED_BUSTER" = "game.js?v=$TS" ]; then
    echo "  → server: serving fresh ($SERVED_BUSTER) ✓"
  else
    echo "  → server: WARNING served=$SERVED_BUSTER expected=game.js?v=$TS"
  fi
else
  echo "  → server: not running on :8080 (start with: python3 -m http.server 8080 --bind 0.0.0.0 &)"
fi

echo "DONE."
