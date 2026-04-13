# Tunnel Proto — Continuity Document
**Last updated:** April 13, 2026 — Session end

## Repo & Deployment
- **GitHub:** `deepplane89/tunnel-proto`
- **Live:** `https://tunnel-proto.vercel.app`
- **Working dir:** `/home/user/workspace/tunnel-proto-fresh/`
- **Auto-deploy from git push is ON — do NOT run `npx vercel --prod`**
- **Current HEAD:** `dac8047` — fix: correct MK II landscape nozzle values from user tuner

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

## Critical User Instructions
- DO NOT touch ice (T4) or gold (T5) sun warp effects
- NEVER read lines 16-17 of game.js
- NEVER read more than 200 lines at a time
- Syntax check after each edit: `node -c game.js`
- Only deploy via git push (auto-deploy ON) — NEVER `npx vercel --prod`
- Bump cache buster in index.html with each deploy
- Don't make cosmetic changes — only add tuner sliders, let user decide values
- Call them "particles" not "stars"
- Answer questions first, only change code when explicitly told to
- X = lateral, Z = forward/back, Y = vertical
- The floor is WATER, not a grid
- Don't use subagents for simple tasks
- Don't double-deploy, don't over-complicate, don't refactor working code without being asked
