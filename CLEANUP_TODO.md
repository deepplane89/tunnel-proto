# Code Cleanup TODO

Low-priority cleanup items that shouldn't be touched mid-feature. Only tackle when things are stable.

## Done

- ✅ **RadialBlurShader + _radialBlurPass** removed from `src/20-main-early.js` (2026-05-12). Wormhole pass that was permanently `enabled = false`. ~46 lines.
- ✅ **`src/_archived/` folder** removed (2026-05-12). `legacy-wave-director.js`, `80-session-logger.js`.
- ✅ **`fuzz/fuzz.js`** removed (2026-05-12). Rebuild from scratch if soak testing needed.
- ✅ **Unused audio** removed (2026-05-12): engine-baseline.mp3, exit.mp3, garage-open.mp3, laser-beam.mp3, shop_purchase.mp3 (~336KB).
- ✅ **Unused images** removed (2026-05-12): coin-icon.png, coins-icon.png, trophy-icon.png (~60KB).

## Backlog

(nothing critical)
