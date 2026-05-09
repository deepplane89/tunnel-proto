#!/usr/bin/env bash
# build.sh — Concatenate src/*.js into dist/game.js.
#
# This is the "unity build" pattern: source lives as numbered files in src/,
# but the shipped dist/game.js is a single concatenated file with one shared
# scope, byte-identical to what the browser loaded before the split.
#
# The files are ordered alphabetically, so numeric prefixes (00-, 10-, 20-,
# etc.) control concatenation order. Leave gaps between prefixes (00, 10, 20
# rather than 00, 01, 02) so new files can slot in without renumbering.
#
# Usage:
#   ./scripts/build.sh           # writes ./dist/game.js
#   ./scripts/build.sh -o out.js # writes ./out.js
#
# Exit 0 on success, nonzero on failure.

set -euo pipefail

# Resolve repo root no matter where the script is invoked from.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
SRC_DIR="$REPO_ROOT/src"
OUT_PATH="$REPO_ROOT/dist/game.js"
mkdir -p "$(dirname "$OUT_PATH")"

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

# Find all .js files under src/ (and one level of subdirs, e.g. src/radio/),
# ordered by BASENAME so a file's numeric prefix controls placement regardless
# of which subdir it lives in. e.g. src/radio/31-radio.js slots between
# src/30-audio.js and src/40-main-late.js because basename '31-radio.js' sorts
# between '30-audio.js' and '40-main-late.js'.
#
# Portable across macOS (BSD find) and Linux (GNU find): we don't use -printf.
# Instead we awk the basename to the front, sort, then strip it back off.
# Skip any directory whose name starts with `_` (e.g. src/_archived/) so
# experimental / parked code doesn't get pulled into the build.
FILES=()
while IFS= read -r line; do
  FILES+=("${line#*$'\t'}")
done < <(
  find "$SRC_DIR" -type d -name '_*' -prune -o -type f -name '*.js' -print \
    | awk -F/ '{print $NF "\t" $0}' \
    | sort
)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No .js files found in $SRC_DIR" >&2
  exit 1
fi

# ── Per-file syntax check ───────────────────────────────────────────────
# Each src/*.js MUST be a self-contained, syntactically-valid JS module on
# its own — balanced braces, no half-open functions, no truncated strings.
#
# Why: this is a concat build. A file that ends mid-statement (e.g. an
# unterminated `function foo() {`) silently swallows the next file into its
# body when concatenated. The combined dist/game.js still parses fine, so
# `node --check dist/game.js` does NOT catch it. We caught one such bug
# (radio module nested inside playCrash) only after a runtime symptom.
#
# `node --check --input-type=module` validates SYNTAX only, not references,
# so shared-scope globals (`state`, `audioCtx`, etc.) declared in sibling
# files don't trigger false failures. Module mode tolerates top-level
# `import`/`export` (only 00-imports.js uses these) without breaking
# anything in plain-script files.
#
# If you ever legitimately need a file to span a function across boundaries,
# rethink it — it's the exact footgun this guard exists to prevent.
if command -v node >/dev/null 2>&1; then
  echo "Per-file syntax check (node --check)..."
  SC_FAIL=0
  for f in "${FILES[@]}"; do
    if ! node --check --input-type=module < "$f" 2>/tmp/_jh_syntax_err; then
      echo "  FAIL: ${f#$REPO_ROOT/}" >&2
      sed 's/^/    /' /tmp/_jh_syntax_err >&2
      SC_FAIL=1
    fi
  done
  rm -f /tmp/_jh_syntax_err
  if [[ "$SC_FAIL" -ne 0 ]]; then
    echo "" >&2
    echo "Build aborted: one or more src/*.js files are not self-contained." >&2
    echo "Fix the file(s) above so each parses standalone, then rerun build." >&2
    exit 1
  fi
else
  echo "Warning: node not found, skipping per-file syntax check." >&2
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
