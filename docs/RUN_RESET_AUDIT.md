# Run Reset Audit — categories

Goal: every effect/state that mutates during gameplay must be reset on
`startGame()` (or rederived purely from state every frame). The aberration
bug was a class-1 leak.

Audits are in priority order. Highest-leak categories first.

---

## 1. Post-processing pass uniforms (THIS PASS — doing now)

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

## 3. Material mutations — opacity / color / emissive

These are gameplay-driven (powerup tints, near-miss flash, dark-slab override,
canyon skin tuner). High leak risk because materials are shared and persistent.

Mutators to enumerate:
- `material.opacity` writes (~110 spotted) — most for powerup VFX (shield mesh,
  laser tube, magnet wire). Each needs: visible=false AND opacity=0 reset.
- `material.color.set/copy` (~31 spotted) — hull tint cycling (invincible
  rainbow), canyon dark-slab override, skin recolor
- `emissive.set/copy` and `emissiveIntensity =` (~28 spotted) — near-miss red
  flash, invincible glow, hull pulse
- Canyon skin tuner mutations: `_PRE_T4A_CANYON_TUNER`, `_PRE_T4B_CANYON_TUNER`
  — we already restore originals after activate, but verify on death/retry mid-canyon
- Sun shader uniforms (`uIsL3Warp` already reset, but verify: uTime, uColor*, uTint)

---

## 4. Mesh visibility flags

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

Pass 1 (now): Post-processing uniforms — section 1
Pass 2: Material opacity/color/emissive sweep — section 3 (highest visual leak risk)
Pass 3: Mesh visibility sweep — section 4
Pass 4: Three.js scene state — section 2
Pass 5: Audio loops — section 5
Pass 6: Timers — section 6
Pass 7: DOM overlays — section 7
Pass 8: state.* coverage diff — section 9
Pass 9: window globals — section 8 (low priority)

Each pass: produces a list of leaks, then fixes them in one commit.
