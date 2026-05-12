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
#   ./scripts/build.sh                 # PROD build (default — dev tools omitted)
#                                      # This is what ships to Vercel + App Store.
#                                      # Always commit prod builds.
#   ./scripts/build.sh --dev           # DEV build (tuner panels, perf recorder)
#                                      # Use for local tuning. DO NOT commit.
#   ./scripts/build.sh -o out.js       # writes to a custom path
#
# Convention follows Webpack/Vite/Rollup: production is the default, dev is
# opt-in via flag. CI/CD and `git push` are safe with no flag.
#
# A marker is embedded near the top of dist/game.js so scripts/verify.sh can
# refuse to commit dev builds (see DEV_BUILD_MARKER below).
#
# Exit 0 on success, nonzero on failure.

set -euo pipefail

# Resolve repo root no matter where the script is invoked from.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
SRC_DIR="$REPO_ROOT/src"
OUT_PATH="$REPO_ROOT/dist/game.js"
PROD_BUILD=1   # DEFAULT: prod. Use --dev to opt out.
mkdir -p "$(dirname "$OUT_PATH")"

# Marker string the verify hook greps for to detect dev builds.
DEV_BUILD_MARKER="/* JH_BUILD: dev */"
PROD_BUILD_MARKER="/* JH_BUILD: prod */"

# --output / -o flag override
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) OUT_PATH="$2"; shift 2 ;;
    --prod)      PROD_BUILD=1; shift ;;
    --dev)       PROD_BUILD=0; shift ;;
    -h|--help)
      echo "Usage: $0 [-o OUT_PATH] [--prod|--dev]"
      echo "  default mode is --prod"; exit 0 ;;
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
# Dev-only files swapped out in --prod builds. Stays the same in dev builds.
# Stub file _dev-stubs.js provides no-op replacements for the few unguarded
# globals these files export.
# NOTE: 70-perf-diag.js is NOT dev-only. It contains the main animate() loop,
# adaptive DPR, and frame budgeting — gameplay-critical. The _perfDiag tooling
# inside it is gated by `window._perfDiagOn` (default false), so it adds ~28KB
# of inert code in prod but nothing runs unless explicitly toggled on.
DEV_ONLY_FILES=(
  "$SRC_DIR/49-tuner-hud.js"
  "$SRC_DIR/78-tuner-panels.js"
)
DEV_STUB_FILE="$SRC_DIR/_dev-stubs.js"

FILES=()
while IFS= read -r line; do
  f="${line#*$'\t'}"
  # Skip files starting with `_` (e.g. _dev-stubs.js) — they're conditional.
  base="$(basename "$f")"
  if [[ "$base" == _* ]]; then continue; fi
  # In --prod mode, drop the dev-only files from the normal stream.
  if [[ "$PROD_BUILD" -eq 1 ]]; then
    skip=0
    for dev in "${DEV_ONLY_FILES[@]}"; do
      if [[ "$f" == "$dev" ]]; then skip=1; break; fi
    done
    if [[ "$skip" -eq 1 ]]; then continue; fi
  fi
  FILES+=("$f")
done < <(
  find "$SRC_DIR" -type d -name '_*' -prune -o -type f -name '*.js' -print \
    | awk -F/ '{print $NF "\t" $0}' \
    | sort
)

# In --prod mode, inject the stub file at position ~49 (between 48-showroom
# and 50-shop). Simplest: append at end — stubs only set window.* + a couple
# top-level functions, runs after every gameplay file is loaded. Callers are
# all on user input (hotkeys), so by the time they fire the stubs are in place.
if [[ "$PROD_BUILD" -eq 1 ]]; then
  if [[ ! -f "$DEV_STUB_FILE" ]]; then
    echo "prod build requested but $DEV_STUB_FILE not found" >&2
    exit 1
  fi
  FILES+=("$DEV_STUB_FILE")
fi

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
# Prepend a build-mode marker on the first line so verify.sh can detect dev
# bundles before they get committed. Use a JS line-comment so it doesn't
# perturb parsing.
if [[ "$PROD_BUILD" -eq 1 ]]; then
  echo "$PROD_BUILD_MARKER" > "$OUT_PATH"
else
  echo "$DEV_BUILD_MARKER" > "$OUT_PATH"
fi
cat "${FILES[@]}" >> "$OUT_PATH"

if [[ "$PROD_BUILD" -eq 1 ]]; then
  echo "Built $OUT_PATH (PROD) from ${#FILES[@]} source file(s):"
else
  echo "Built $OUT_PATH (DEV)  from ${#FILES[@]} source file(s):"
  echo "  ⚠️  DEV build — do NOT commit. Run \`bash scripts/build.sh\` (no flag) before committing." >&2
fi
for f in "${FILES[@]}"; do
  echo "  - ${f#$REPO_ROOT/}"
done
