# Run Reset Audit — categories

Goal: every effect/state that mutates during gameplay must be reset on
`startGame()` (or rederived purely from state every frame). The aberration
bug was a class-1 leak.

Audits are in priority order. Highest-leak categories first.

---

## 1. Post-processing pass uniforms (✅ PASS 1 COMPLETE — commit 8c2740e)

**Result: only the `aberration` leak existed; already fixed.**

| Uniform | Status |
|---|---|
| `vignettePass.uniforms.aberration` | ✅ Reset in startGame (commit 8c2740e) |
| `vignettePass.uniforms.darkness` | ✅ Never written during gameplay (dev slider only) |
| `vignettePass.uniforms.offset` | ✅ Never written during gameplay (dev slider only) |
| `bloom.strength` | ✅ Forcibly reset by `applyLevelVisuals(LEVELS[0])` in startGame line 344 |
| `bloom.threshold` / `bloom.radius` | ✅ Never written during gameplay (dev slider only) |
| `_radialBlurPass.uniforms.*` | ✅ Never written during gameplay (init-only) |
| `_thrusterHazePass.uniforms.*` | ✅ Tick-driven every frame, re-derived from state |
| `renderer.toneMappingExposure` | ✅ Init-only |

---

## 1 (original notes)

Pass uniforms persist on the GPU until something writes them. Anything written
mid-run that has a non-default value will leak across runs.

Passes in the chain:
- `bloom` (UnrealBloomPass)
- `_thrusterHazePass` (custom ShaderPass)
- `_radialBlurPass` (custom ShaderPass)
- `vignettePass` (custom ShaderPass — owns `aberration` and vignette)

Mutators to enumerate:
- `vignettePass.uniforms.*` — aberration (FOUND, FIXED), vignette params, etc.
- `bloom.strength / threshold / radius`
- `_radialBlurPass.uniforms.*` — strength, center, etc.
- `_thrusterHazePass.uniforms.*` — uIntensity, uNozzleL/R, etc. (mostly tick-driven, verify)
- `renderer.toneMappingExposure` (4 writes spotted)

For each: confirm the value is either (a) reset on `startGame`, or (b) overwritten
every frame from `state` by the tick path. If neither — it's a leak.

---

## 2. Three.js scene state — fog, background, lights, layers

Anything written to the scene/lights/camera that's NOT re-derived per frame.

Mutators to enumerate:
- `scene.fog` — color, near, far (6 writes spotted across files)
- `scene.background` — material/texture
- Light mutations (~56 spotted): `intensity`, `color`, `position`, especially:
  - Sun light, ambient light, hemi light, fill lights
  - `shieldLight.intensity` (already nulled on shield expire path, but verify)
- `camera.fov` (FOV pulse bug we just fixed last session — but verify all writers)
- `camera.up`, `camera.position`, `camera.quaternion` (intro lift, retry sweep, canyon)
- `layers.enable/disable` calls (5 spotted) — bloom layer toggling

---

## 2. Material mutations — opacity / color / emissive (✅ PASS 2 COMPLETE)

**Result: no real leaks. All mutations are either per-frame re-derived,
pool-reset on checkout, dev-tuner-only, init-time-only, or auto-heal via
an existing fade-back loop.**

| Site | Pattern | Status |
|---|---|---|
| 67:4866-4914 hull tint (rainbow / near-miss-red / grace-flash) | Nested in `if (state.invincibleTimer > 0)` gate | ✅ Auto-heals: fade-back loop at 67:4921-4937 runs every frame OUTSIDE the gate while `_firstPbrHull.emissiveIntensity > 0`, lerping color→white and emissive→0 over ~30 frames during title/pause/restart |
| 67:2462, 2599, 5258-5429 ring/canyon/wall opacity | Per-frame derived from age/fadeT or pool-returned on death (`returnObstacleToPool`, `_awActive` cleared on startGame) | ✅ Re-derived each frame |
| 67:3789, 3801 tintObsColor / resetObsColor | Pool obstacle utility, every tint paired with reset, pool returned on startGame | ✅ |
| 67:5819, 5844 canyon dev-tuner emissive | Dev skin-tuner panel slider callback only | ✅ Dev-only |
| 67:330-338 (startGame) shield/laser/magnet opacity | Explicit reset already in place | ✅ |
| 72:332-373, 1510, 1576, 1832, 2363, 2414, 2471, 2586, 2786, 2841, 2862 | Dev-tuner panel callbacks only | ✅ Dev-only |
| 72:5333-5589 lightning bolt mat opacity | Pool-based projectile, re-init on spawn (`spawnLightning`), pool cleared on `_clearAllMechanics` from startGame | ✅ |
| 20:2145, 2149 _warpMat / nebulaMat | Per-frame derived from `_warpBrightness`, `currentNebulaTint.lerp` | ✅ |
| 20:3143, 3162 _flashSpriteMat | `_FLASH_DUR = 0.15s`, `_updateFlash` ticks every frame from main loop, self-resolves in 150ms | ✅ Self-clearing |
| 20:4898-4900, 4950-4951 aurora / l5 fronds | Per-frame derived from `auroraFadeT` / `l5fFadeT` | ✅ |
| 20:5088 sun lights color | Init-time only via `applyLevelVisuals` chain | ✅ |
| 20:5202 shipEdgeLines color/emissive | `updateGridColor` called from `applyLevelVisuals(LEVELS[0])` in startGame | ✅ |
| 20:5684 skin-2 hull color override | Init-time per-skin clone in `_prebuiltSkins` | ✅ |
| 20:6076-6084 alt-ship loader | Init-time inside `_loadAltShip` callback | ✅ |
| 20:6962-6965 thruster particle opacity | Per-frame from `window._thrPart_partOpacity` knob | ✅ |
| 20:7151-7159, 7349-7356 nozzle bloom mats | Per-frame derived from speedScale + `window._nozzleBloom*` | ✅ |
| 20:9015 canyon slab emissive fade | Per-frame derived from `fadeT` | ✅ |
| 20:9226-9227 angled-wall init opacity=0 | Init-time at spawn, runtime fade re-derives | ✅ |
| 20:9457-9458 angled-wall dev-tuner | Dev-only callback | ✅ |
| 20:9607 coin pool color set | Re-applied on every pool checkout from `_activeCoinMult` | ✅ |

**Key insight:** the hull tint cycle 4866-4914 is the same nested-block
pattern as the aberration bug (mutator inside `if (state.invincibleTimer > 0)`),
but a fade-back loop already runs OUTSIDE the gate (4921-4937) and auto-heals
color/emissive/EI to white/black/0 (default ship) or level-grid-color (edge
lines). No fix needed.

No commit pushed for Pass 2 — audit-only.

---

## 3. Mesh visibility flags (✅ PASS 3 COMPLETE — 2 leaks fixed)

**Result: two pool-based mechanics leaked across run-end transitions.**

| Site | Pattern | Status |
|---|---|---|
| `_ltActive` lightning bolts (72:5109) | `_updateLightning` gates on `phase==='playing'` so ticks stop on death, but instances stay in array with `boltGroup.visible = true` — frozen visible mid-strike | ❌ → ✅ `window._clearAllLightning` already called from startGame; **added to returnToTitle** |
| `_asteroidActive` asteroids (72:3152) | `_updateAsteroids(dt)` at 72:3747 is OUTSIDE the `phase==='playing'` gate — ticks every frame on title/gameover, asteroids keep falling and trigger landing FX | ❌ → ✅ **Exposed `window._clearAllAsteroids`, called from startGame and returnToTitle** |
| `shipGroup`, `auroraGroup`, `l5fGroup`, `l5DustPoints`, `shieldMesh`, `shieldWire`, `laserPivot`, `laserBolts`, `magnetRing/2` | Explicit reset in startGame (67:115-336) | ✅ |
| `laserMesh.visible`, `laserGlowMesh.visible` | Set true at 67:4752-4764, never set false. Children of `laserPivot` so hidden via parent. Internal flag persists but cosmetically harmless | ✅ No-op |
| `_flashSprite`, `_flashLight` | Self-clearing in `_updateFlash` after 0.15s | ✅ |
| `_shockDiscMesh` | Self-clearing in `_updateShockwave` | ✅ |
| Asteroid `warnMesh`/`flash`/`ring`/`boltGroup` (lightning) | Pool-init at spawn, pool-return on kill | ✅ (now that pools clear) |
| `_lethalRingActive` | `_clearAllMechanics` covers it | ✅ |
| `activeObstacles`, `_awActive` | `_clearAllMechanics` covers them | ✅ |
| `activeCoins`, `activePowerups`, `_activeForcefields` | startGame + returnToTitle both reset | ✅ |
| Face explosion fragments (`_activeShatterEffects`) | Self-clearing on `now >= fx.endT` timeout | ✅ |
| `_canyonWalls` slabs | Explicit teardown via `_destroyCanyonWalls` in startGame | ✅ |
| `_terrainWalls.strips` | Explicit teardown via `_destroyTerrainWalls` in startGame | ✅ |
| Title-only meshes (mirror, dust, sprites) | Toggled by settings/title logic, not gameplay | ✅ |
| Thruster systems / nozzle bloom / cones | Per-frame derived from `playing && tp > 0.01` | ✅ |
| `_dbgShipBox`, `_dbgObsPool` | Debug panel only | ✅ Dev-only |

**Fixes applied:**
- `src/72-main-late-mid.js:3712-3716` — expose `window._clearAllAsteroids`
- `src/67-main-late.js:127-129` — call `window._clearAllAsteroids` from startGame
- `src/60-main-late.js:196-201` — call both `_clearAllLightning` and `_clearAllAsteroids` from returnToTitle

---

## 4. Mesh visibility flags (original notes)

Lots of `mesh.visible =` writes (~174 spotted). Most are toggled both ways by
gameplay logic (e.g. powerup spawn → visible=true, expire → visible=false) but
if a run ends between the two, the mesh stays in the wrong state.

Mutators to enumerate:
- `shipGroup.visible`, hull subparts
- `shieldMesh.visible`, `shieldWire.visible` (mostly handled, verify game-over path)
- `laserBeamMesh.visible`, `magnetWireMesh.visible`
- `l5DustPoints.visible` — already reset in startGame line 225 (good example)
- Canyon walls, terrain walls — already explicitly torn down in startGame (good)
- Powerup pickup meshes (might persist if despawn fails)
- Banner/HUD child elements

---

## 5. Audio — looping sources and HTMLAudio elements

Loops can keep playing across runs if not stopped. We already have defensive
stop-paths for engine, argon, magnet, shield, invincible loops in pause/title/
gameover, but coverage isn't proven complete.

Mutators to enumerate:
- All `<audio loop>` elements in index.html — confirm each has a stop on
  game-over / startGame / returnToTitle
- All Web Audio `BufferSource` with `loop = true` (`_playArgonLoop`,
  `_playMagnetWhir`, etc.) — confirm each tracked handle gets `.stop()`
- Music crossfades (`musicFadeTo`) — verify no orphaned fade timers
- Engine roar layers — multiple layers, verify all are stopped

---

## 6. Timers & intervals — orphan cleanup

~142 setTimeout/setInterval calls. Each needs to either:
- Be tracked (in `_introTimers`, `_musicTimers`, etc.) and cleared on startGame
- OR be self-contained and idempotent (firing late doesn't matter)

Highest-risk locations:
- src/67-main-late.js (61 calls) — gameplay tick + powerup activation
- src/72-main-late-mid.js (29 calls) — wave director, vibe transitions
- src/40-main-late.js (6 calls)

Already-tracked lists: `_introTimers`, `_musicTimers`, `_bannerTimers`(?),
`_argonCutIv`, `_argonReplayTo`, `_gameOverDelayTimer`. Need to confirm every
gameplay timer either lives in one of these or is idempotent.

---

## 7. DOM overlay states

~133 `classList.add/remove` calls. Banners, toasts, overlays. If a run ends
while one is showing, it can persist into the title or next run.

Mutators to enumerate:
- `#level-banner` (TIER N banner)
- `#mission-toast`
- `#headstart-overlay`
- `#shop` overlay state (but shop is paused-game so probably fine)
- `#go-overlay` (game over screen — should always be intentional)
- `#pause-menu`
- `#tutorial-overlay`
- `#intro-overlay` (the prologue — already has fade-out cleanup)
- Inline `style.opacity` / `style.display` overrides on these elements

---

## 8. Window / global state pollution

256+ `window._*` references in src/72-main-late-mid.js alone (most are reads).
Some gameplay state lives on `window` for cross-file access. If a value gets
stuck (e.g. a debug flag set during a session), it persists.

Mutators to enumerate:
- Anything assigned via `window._foo =` during gameplay
- Particularly: `window._cheatLadder`, `window._diagDump`-style hooks, dev
  toggles
- Verify each is either init-time-only OR has a reset hook

---

## 9. State.* fields — current `startGame` coverage

`startGame()` already resets ~80+ `state.*` fields. But the audit should:
- Diff all `state.*` writes across the codebase against startGame's reset list
- Flag any state field written during gameplay that's NOT in the reset list
- Especially session-scoped fields (`sessionCoins`, `sessionPowerups`, etc.)
  and powerup timers/flags

---

## Pass plan

Pass 1 (✅ done): Post-processing uniforms — section 1
Pass 2 (✅ done): Material opacity/color/emissive sweep — section 3 (highest visual leak risk)
Pass 3 (✅ done): Mesh visibility sweep — section 3 (2 leaks fixed)
Pass 4 (next): Three.js scene state — section 4
Pass 5: Audio loops — section 5
Pass 6: Timers — section 6
Pass 7: DOM overlays — section 7
Pass 8: state.* coverage diff — section 9
Pass 9: window globals — section 8 (low priority)

Each pass: produces a list of leaks, then fixes them in one commit.
