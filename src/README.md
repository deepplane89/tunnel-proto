# src/ — unity-build source files

game.js is the shipped file the browser loads. It is **generated** by
concatenating the files in this directory (alphabetical order, which respects
the numeric prefixes).

## Rules

1. **Edit here, not in game.js.** Any edit directly to game.js at the repo
   root will be overwritten by the next `./scripts/build.sh`.
2. **Every file must end with a trailing newline.** `cat` concatenates with no
   separators; missing a newline joins two lines mid-token.
3. **All files share one scope.** A `const` in one file is visible in all
   later files. Do not wrap in `(() => { ... })()` unless intentional.
4. **Ordering matters — preserve original byte order.** Prefixes (`00-`, `10-`,
   `20-`) control concat order. When extracting a new system, its prefix must
   place it at its original position in game.js, or `verify.sh` will fail.
   Leave gaps between prefixes so new files can slot in without renumbering.
5. **Always run `./scripts/verify.sh` before committing.** It proves the
   rebuild is byte-identical to the previous game.js. Never commit a split
   that fails verify.

## Current layout

- `00-imports.js` — three.js + addon imports, must come first
- `10-leaderboard.js` — leaderboard API, submit/render, escapeHtml
- `20-main-early.js` — state, constants, levels, scene setup, explosions, sun, ship, thrusters, obstacles, walls, powerups, laser, fog (still being split)
- `30-audio.js` — procedural Web Audio: SFX, music tracks, crossfades, magnet whir
- `40-main-late.js` — grid, level transitions, spawn, funnel, level checking, powerup effects (still being split)
- `45-daily-streak.js` — daily streak rewards UI + state
- `50-shop.js` — shop UI, purchase flows, currency check, toggleLeaderboard
- `60-main-late.js` — crash flash, input, reward wheel (still being split)
- `65-settings.js` — settings overlay: audio volumes, mutes, haptics toggle, replay tutorial, show tutorial
- `67-main-late.js` — haptics, onboarding, game states, sequencers, tuners, update/render loops (still being split)

## Workflow

```bash
# Edit a source file
vim src/10-leaderboard.js

# Rebuild game.js
./scripts/build.sh

# Verify byte-identical (if you didn't intend a change)
./scripts/verify.sh

# Commit both the src/ change AND the regenerated game.js together
git add src/ game.js
git commit
```
