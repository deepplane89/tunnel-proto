#!/usr/bin/env bash
# verify.sh — Prove that a unity-build rebuild produces byte-identical game.js.
#
# The whole safety claim of the unity-build refactor is: "splitting game.js
# into src/ files is safe because concatenating them back together produces
# the same file the browser was loading before." This script PROVES that
# claim by building to a temp file and diffing against the committed game.js.
#
# If `diff` outputs anything, the split is broken — some chunk boundary cut
# mid-token, some file forgot a trailing newline, etc. Do NOT merge to main
# until this script exits 0 with zero diff.
#
# Usage:
#   ./scripts/verify.sh
#
# Exit 0 = byte-identical. Exit 1 = mismatch (diff printed). Exit 2 = env error.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
BUILD_SH="$SCRIPT_DIR/build.sh"
COMMITTED="$REPO_ROOT/game.js"
TMP_OUT="$(mktemp -t unity-build-verify.XXXXXX.js)"
trap 'rm -f "$TMP_OUT"' EXIT

if [[ ! -x "$BUILD_SH" ]]; then
  echo "build.sh not executable at $BUILD_SH" >&2
  exit 2
fi
if [[ ! -f "$COMMITTED" ]]; then
  echo "Committed game.js not found at $COMMITTED" >&2
  exit 2
fi

# If src/ doesn't exist yet, there's nothing to verify — the split hasn't
# happened. This is the pre-Push-24 state: report OK and exit cleanly.
if [[ ! -d "$REPO_ROOT/src" ]]; then
  echo "src/ does not exist yet — split has not happened."
  echo "Committed game.js is the canonical source. Nothing to verify."
  exit 0
fi

echo "Building src/*.js → $TMP_OUT ..."
"$BUILD_SH" -o "$TMP_OUT"

# Byte-identical check via cmp (faster than diff for large files; reports
# only whether files differ, no content output).
if cmp -s "$TMP_OUT" "$COMMITTED"; then
  COMMITTED_BYTES=$(wc -c < "$COMMITTED")
  COMMITTED_LINES=$(wc -l < "$COMMITTED")
  echo
  echo "✅ PASS: rebuilt game.js is byte-identical to committed game.js"
  echo "   $COMMITTED_LINES lines, $COMMITTED_BYTES bytes"
  echo "   (Safe to merge this branch.)"
  exit 0
else
  echo
  echo "❌ FAIL: rebuilt game.js differs from committed game.js"
  echo
  echo "First 40 lines of diff (run 'diff game.js $TMP_OUT' for full output):"
  diff "$COMMITTED" "$TMP_OUT" | head -40 || true
  echo
  echo "Do NOT merge this branch until diff is empty."
  echo "Common causes:"
  echo "  - A src/ file doesn't end with a newline (fix: add trailing \\n)"
  echo "  - A chunk boundary cut mid-token or mid-string literal"
  echo "  - A src/ file was edited independently of game.js"
  echo "  - File ordering changed (check numeric prefixes)"
  exit 1
fi
