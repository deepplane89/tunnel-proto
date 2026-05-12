# Tunnel Proto — Continuity Document
**Last updated:** May 11, 2026 — Build split + Vercel build disabled

## Repo & Deployment
- **GitHub:** `deepplane89/tunnel-proto`
- **Live:** `https://tunnel-proto.vercel.app`
- **Working dir:** `/home/user/workspace/tunnel-proto-fresh/`
- **Auto-deploy from git push is ON — do NOT run `npx vercel --prod`**
- **Vercel build step DISABLED (2026-05-11)** — Build Command / Install Command overridden to `echo skip`, Output Directory = `.`. Vercel now serves the committed `dist/game.js` directly. This cut build-minutes costs to ~$0; user stays on Pro $20/mo through current cycle, plans to downgrade to Hobby after.
- **Current HEAD (dev):** `d434d6f` — build: flip default to prod, --dev opt-in

## Build System (added 2026-05-11)

**Unity build:** `src/*.js` files are concatenated alphabetically into `dist/game.js`. Numeric prefixes (00-, 10-, 20-, ...) control order. The browser only loads `dist/game.js` — never edit it directly; always edit `src/*.js` and rebuild.

**Two modes, prod is default** (matches Webpack/Vite/Rollup convention):

| Command | Mode | Size | Includes dev tools? | Use for |
|---|---|---|---|---|
| `bash scripts/build.sh` | **prod** | ~1.44 MB | No | Vercel + iOS App Store. **Commit this.** |
| `bash scripts/build.sh --dev` | dev | ~1.64 MB | Yes (tuner panels, perf diag) | Local Mac mini / iPhone-over-network testing. **DO NOT commit.** |

**Marker line:** First line of `dist/game.js` is `/* JH_BUILD: prod */` or `/* JH_BUILD: dev */`. A future `scripts/verify.sh` pre-commit hook can grep for the dev marker and refuse to commit.

**Files only included in dev builds** (~3500 lines dropped from prod):
- `src/49-tuner-hud.js` — showroom tuner HUD
- `src/70-perf-diag.js` — perf recorder
- `src/78-tuner-panels.js` — T/V/W/B/K hotkey tuner panels

**Underscore-prefixed files** (e.g. `src/_dev-stubs.js`) are NOT auto-included. `_dev-stubs.js` is appended only in prod mode to provide no-op stubs for symbols the prod build would otherwise miss: `window.TunerHud`, `window._perfDiag`, `_ringShowTuner()`, `buildSkinTunerSliders()`, `window._awPanel`.

**Local dev workflow:**
```
bash scripts/build.sh --dev    # rebuild dev locally
# (test on Mac mini browser or iPhone via http://192.168.2.37:8080/)
# DO NOT commit dist/game.js while in dev mode
```

**Ship-it workflow (push to dev branch, then merge to main):**
```
bash scripts/build.sh                                  # prod build, default
TS=$(date +%s); sed -i.bak -E "s|game\.js\?v=[0-9]+|game.js?v=${TS}|" index.html && rm -f index.html.bak
git add -A && git add -f dist/game.js
git commit -m "..."
git push origin dev    # then merge dev -> main when ready
```

Since Vercel's build is disabled, the committed `dist/game.js` IS what ships. Pushing to main refreshes the live game; no Vercel build runs.

## Key Code Locations (approximate — lines shift with edits)
- `SHIP_SKINS` array: ~line 360 (MK II at index 5, line 370)
- `_applyGlbConfig`: ~line 5596
- `_snapshotNozzleBaseline`: ~line 5589
- `_applyOrientationNozzles` (NEW): ~line 5803
- `_showAltShip`: ~line 5823
- `_hideAltShip`: ~line 5868
- `_rebuildLocalNozzles`: ~line 5898
- `NOZZLE_OFFSETS` declaration: ~line 5940
- Default ship `_localNozzles` init: ~line 5954
- `nozzleWorld()`: ~line 5957
- `updateCameraFOV`: ~line 16842
- G panel GLB nozzle sliders: ~line 18744
- G panel non-GLB nozzle sliders: ~line 18791

## MK II Thruster Nozzle System (CURRENT STATE)
### What was done this session
- Added `_applyOrientationNozzles()` function that checks `window.innerWidth > window.innerHeight` and writes the correct set of baked nozzle offsets directly to `NOZZLE_OFFSETS` / `MINI_NOZZLE_OFFSETS`
- glbConfig for MK II now stores TWO sets: landscape (`nozzleL/R`, `miniL/R`) and portrait (`portraitNozzleL/R`, `portraitMiniL/R`)
- Called from `_showAltShip()` (on ship select) and `updateCameraFOV()` (on resize/orientation change)
- No transforms, no sRatio/delta math for these values — they're the exact slider numbers the user tuned
- Removed debug logging from `_showAltShip`
- Fixed MK II `posY` from `-0.5` to `-0.590` per user's portrait tuner values

### Baked values (user-calibrated)
**Landscape** (calibrated in Chrome DevTools mobile landscape):
| Nozzle | X | Y | Z |
|--------|-------|-------|-------|
| Noz L | -0.560 | -0.050 | 4.960 |
| Noz R | 0.530 | -0.060 | 4.900 |
| Mini L | -0.150 | 0.060 | 5.100 |
| Mini R | 0.160 | 0.060 | 5.100 |

**Portrait** (calibrated in Chrome DevTools mobile portrait):
| Nozzle | X | Y | Z |
|--------|-------|-------|-------|
| Noz L | -0.520 | -0.020 | 5.020 |
| Noz R | 0.570 | -0.130 | 4.860 |
| Mini L | -0.140 | 0.070 | 5.100 |
| Mini R | 0.160 | 0.070 | 5.100 |

### How `_rebuildLocalNozzles` works for matchDefault ships
- Uses fixed `sc = 0.30` and refs `(0, 0.28, 4.5)` — same as default ship init formula
- `_localNozzles[i] = (NOZZLE_OFFSETS[i] - ref) / 0.30`
- `nozzleWorld()` then does `shipGroup.localToWorld(_localNozzles[i])` to get world position
- For non-matchDefault alt ships, uses dynamic scale/delta from `_nozzleBaseline`

### Cone thruster values (landscape, user-calibrated)
| Setting | Value |
|---------|-------|
| Cone Length | 3.400 |
| Cone Radius | 0.140 |
| Cone Rot X | 1.420 |
| Cone Rot Y | 1.720 |
| Cone Rot Z | 0.050 |
| Cone Off X | 0.000 |
| Cone Off Y | 0.000 |
| Cone Off Z | 0.000 |
| Neon Power | 1.500 |
| Noise Speed | 0.800 |
| Noise Strength | 0.130 |
| Fresnel Power | 6.000 |
| Cone Opacity | 1.000 |

### Desktop nozzles
- Desktop does NOT have separate baked values yet — it uses landscape values since innerWidth > innerHeight on desktop
- May need desktop-specific tuning in a future session

## Dev/Prod Gating (2026-05-11)

Prod ships **player-facing only**. All dev tools gated behind `window.__JH_DEV__` (set by build.sh — true for `--dev`, false for prod).

**Gates added this session:**
- `src/60-main-late.js` triple-tap skin-label `_adminUnlockAll()` cheat (unlocks all skins/powerups + 99k fuel)
- `src/60-main-late.js` keydown dev block: L/S/I/M powerups, Z/X/C/V spawn cubes, T skin tuner, R rings tuner, P pattern force, C/X/Z/V/K/J/N/B force-arc keys, 1-5/7/9/6 level skips, 0 hitbox wireframes
- `src/72-main-late-mid.js` six tuner panel hotkeys: ` canyon, R terrain, G ship-GLB, Y asteroid, L lightning, F fat-cone
- `src/72-main-late-mid.js` Q god mode toggle
- `src/72-main-late-mid.js` skin-tuner-btn MutationObserver
- `src/67-main-late.js` D debug overlay + C cone diagnostic
- `src/48-showroom.js` P thruster positioner (in garage)

**Pattern:** wrap the listener bind in `if (window.__JH_DEV__) { ... }`. State objects (`_canyonTuner`, `_terrainTuner`, etc.) stay — gameplay reads them. Console-only `window._*` utilities stay (only fire if typed). The `#admin-panel` DIV in index.html is harmless — its triple-tap reveal lives in `src/78-tuner-panels.js` which is stripped from prod entirely.

**Layout tuner** (`src/72-main-late-mid.js:268-293`) is the prototype gate: panel element gets `.remove()`'d in prod AND click handler skipped, but the layout-apply/resize logic still runs (it positions title screen).

**To add a new dev tool:** wrap UI reveal/listener in `if (window.__JH_DEV__) { ... }`. Don't gate gameplay state objects.

## Commits This Session
- `100b5e8` — cone thruster toggle (pushed from prev session)
- `f107253` → `0690952` → `995b667` → `ed6763a` → `d29beaa` → `86828d1` — various failed nozzle attempts
- `49f9bc6` — matchDefault uses default refs + exact values
- `39a40d1` — fixed scale 0.30 for matchDefault
- `eb3cf64` — orientation-specific nozzle offsets
- `dac8047` — correct landscape nozzle values from user tuner (CURRENT)

## Pending Items
- Desktop nozzle tuning for MK II (no baked values yet)
- Mobile thruster positioning for other ships
- Old thrusters toggle decision
- Cone tracking during liftoff
- Stress testing / dev tools diagnostics
- EnvMap for Phoenix, terrain walls brightness, motion blur, speed vignette, MK II mesh toggling
- 3D artist contact: "tkkjee" (Serbian, tkkjee@gmail.com, +381 62 961 9583)
- iOS / TestFlight build with new prod (Capacitor wrap)
- Vercel Pro → Hobby downgrade next cycle
- Optional: strip `console.log` from prod (51 in 20-main-early.js, ~17 across other prod files)

## Glitch Fixes (root causes + resolutions)

### Garage skin mismatch / orphan-ship grey RUNNER (FIXED 2026-05-06, commit `3f6f34c`)
- **Symptom:** Wrong skin shown in gameplay vs garage; sometimes a grey RUNNER (orphan ship) appeared.
- **Root cause:** Concurrent `_loadAltShip` calls for the same `cacheKey` raced — two paint passes on the same ship produced an orphan mesh + holo material registry mismatch. Cache-shared materials were also being disposed by one caller while still in use by another.
- **Fix:** Dedupe concurrent `_loadAltShip` invocations per `cacheKey` (in-flight promise map). Combined with prior `46ee984` (session-owned material tagging + safe dispose skip on cache-shared mats) and `139debf` (sweep orphan holo materials on title-ship swap).
- **Confirmed working:** User verified 2026-05-06.

### No-cone-spawn after exiting tutorial via overlay (FIXED 2026-05-03, commit `0e2202d`)
- **Symptom:** Cones never spawned in next death run after exiting tutorial via settings/tuner overlay (instead of the EXIT TUTORIAL button).
- **Root cause:** `state._tutorialActive` stuck true when overlay routed back to title without clearing the flag. The update loop's `_noSpawnMode` re-asserted, closing both spawn gates.
- **Fix:** One-line `state._tutorialActive = false;` in `returnToTitle()`.

## Critical User Instructions
- DO NOT touch ice (T4) or gold (T5) sun warp effects
- NEVER read lines 16-17 of game.js
- NEVER read more than 200 lines at a time
- Syntax check after each edit: `node -c game.js`
- Vercel auto-deploy on main push is sometimes sluggish/silent. If a main push doesn't refresh prod within ~1 min, force-deploy via `npx --yes vercel --token "$VERCEL_TOKEN" --prod --yes` from `/tmp/tunnel-proto` (with `api_credentials=["vercel"]`)
- Vercel build step is OFF — committed `dist/game.js` is what ships. Always rebuild prod (`bash scripts/build.sh`, no flag) before commit
- NEVER commit a dev build — check first line of `dist/game.js`; it must say `/* JH_BUILD: prod */`
- Bump cache buster in index.html with each deploy
- Don't make cosmetic changes — only add tuner sliders, let user decide values
- Call them "particles" not "stars"
- Answer questions first, only change code when explicitly told to
- X = lateral, Z = forward/back, Y = vertical
- The floor is WATER, not a grid
- Don't use subagents for simple tasks
- Don't double-deploy, don't over-complicate, don't refactor working code without being asked
