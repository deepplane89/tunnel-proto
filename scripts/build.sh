#!/usr/bin/env bash
# build.sh — Concatenate src/*.js into game.js.
#
# This is the "unity build" pattern: source lives as numbered files in src/,
# but the shipped game.js is a single concatenated file with one shared scope,
# byte-identical to what the browser loaded before the split.
#
# The files are ordered alphabetically, so numeric prefixes (00-, 10-, 20-,
# etc.) control concatenation order. Leave gaps between prefixes (00, 10, 20
# rather than 00, 01, 02) so new files can slot in without renumbering.
#
# Usage:
#   ./scripts/build.sh           # writes ./game.js
#   ./scripts/build.sh -o out.js # writes ./out.js
#
# Exit 0 on success, nonzero on failure.

set -euo pipefail

# Resolve repo root no matter where the script is invoked from.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
SRC_DIR="$REPO_ROOT/src"
OUT_PATH="$REPO_ROOT/game.js"

# --output / -o flag override
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) OUT_PATH="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [-o OUT_PATH]"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ ! -d "$SRC_DIR" ]]; then
  echo "src/ directory not found at $SRC_DIR" >&2
  echo "The split has not happened yet — game.js is still the canonical source." >&2
  echo "Nothing to build." >&2
  exit 0
fi

# Find all .js files under src/, sorted alphabetically (which honors numeric
# prefixes). `sort` is defensive against shells with weird glob ordering.
mapfile -t FILES < <(find "$SRC_DIR" -maxdepth 1 -type f -name '*.js' | sort)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No .js files found in $SRC_DIR" >&2
  exit 1
fi

# Concatenate with no added separators — each src file must be self-contained
# and end with a newline. Adding separators risks breaking template literals
# that straddle boundaries. If a file doesn't end with \n, cat preserves that
# and the next file's first line joins onto the last line of the previous.
# Source files MUST end with a newline. `scripts/verify.sh` catches this.
cat "${FILES[@]}" > "$OUT_PATH"

echo "Built $OUT_PATH from ${#FILES[@]} source file(s):"
for f in "${FILES[@]}"; do
  echo "  - ${f#$REPO_ROOT/}"
done
