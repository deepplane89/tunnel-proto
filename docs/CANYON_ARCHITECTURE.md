# Canyon Architecture

Single reference for how the canyon subsystem actually works — lifecycle, data flow, invariants, touch points, and known footguns. The canyon system has bitten us repeatedly with cascading-effect bugs (alternation collapse, parity drift, material identity loss, light-hash recompiles). This doc exists so we stop rediscovering the same problems.

If you change the canyon code, **read this first**, then update it in the same commit.

---

## 1. Mental model

A canyon is a **two-track conveyor belt of slab meshes** scrolling toward the ship in +Z. Each track (left/right) is a fixed-size pool that recycles back-to-front as slabs pass the ship. The corridor shape (sine wave, half-width, vertical position) is computed per-Z by stateless functions, so any slab arriving at a given Z bakes its position from those functions and never moves laterally afterward.

The system has **5 distinct phases** in a normal canyon lifecycle. Bugs almost always come from violating an invariant that holds in one phase but is broken in another.

```
PHASE 1: ACTIVATE         → flags flipped, _canyonTuner mutated, walls created
PHASE 2: ENTRANCE APPROACH → entrance slabs scroll in from -500, regulars frozen+invisible
PHASE 3: CORRIDOR REVEAL   → entrance reaches Z=-210, regulars unfrozen + visible
PHASE 4: CORRIDOR ACTIVE   → slabs scroll, recycle at back, parity preserved
PHASE 5: EXIT              → _canyonExiting flag, slabs drift past, no recycle, auto-destroy
```

Most bugs sit at phase boundaries: 1→2 (preset leaks), 3→4 (parity drift), 4→5 (mid-flight destroy/recreate), 5→1 of next canyon (state leak across instances).

---

## 2. State map: who owns what

Module-scoped variables in `src/20-main-early.js` that EVERY canyon-touching code path reads or mutates:

| Variable | Type | Set by | Read by | Notes |
| --- | --- | --- | --- | --- |
| `_canyonTuner` | object (shared) | preset `Object.assign`, hotkey panels | every `_canyon*` function | **One global mutated in place. Source of every "preset leaked into next canyon" bug.** |
| `_canyonWalls` | object \| null | `_createCanyonWalls`, `_destroyCanyonWalls` | render loop, recycle, debug | Holds `cyanMat`/`darkMat`/`cyanTex`/`darkTex` references. Disposed and recreated each canyon. |
| `_canyonActive` | bool | activate fns, stop fns | render loop, light ramp, debug | True from create→stop, false during `_canyonExiting`. |
| `_canyonExiting` | bool | stop fns (`immediate:false` path) | render loop, watchdog | True only during graceful exit; cleared by `_destroyCanyonWalls`. |
| `_canyonManual` | bool | activate fns | sequencer | True for V/B hotkey activations; bypasses sequencer ownership. |
| `_canyonMode` | int (0..5) | activate fns, B hotkey | `_canyonIntensityAtZ`, `_canyonHalfXAtZ`, debug | Drives mode-specific ramps (mode 5 = experimental). |
| `_canyonSinePhase` | float | every frame in `_updateCanyonWalls` | `_canyonPredictCenter`, recycle | Reset to 0 in `_destroyCanyonWalls`. Init-baked in `_createCanyonWalls`. |
| `_canyonLightT` | float (0..1) | `_updateCanyonWalls` ramp | light intensity calc | Smoothstep eased, 600ms in/out. **Persists across canyon destroy/recreate** so lights don't snap. |
| `_canyonDirLightFrom` | float \| null | `_setCanyonDirLightTarget` | dirLight ramp | Saved pre-canyon dirLight.intensity. |
| `_canyonDirLightTarget` | float \| null | `_setCanyonDirLightTarget`, `_clearCanyonDirLightTarget` | dirLight ramp | When non-null, dirLight ramps toward this. |
| `_l4RowsElapsed` | float | `_updateCanyonWalls` | L4 sine eval | Reset in `_destroyCanyonWalls`. |
| `_canyonTexCache` | object \| null | one-time prewarm | `_createCanyonWalls` | Pre-built textures to avoid first-spawn stutter. |
| `_canyonFillLight` | THREE light \| null | `_createCanyonWalls` | destroy | Zeroed but kept in scene to avoid light-hash recompile. |
| `_CANYON_PERSISTENT_LIGHTS` | array | scene init (constant) | every frame ramp | **Pre-added at intensity 0 so light-hash never changes.** Critical for perf — see footgun #4. |

State on `state.*` (the global game state):

| State flag | Meaning | Notes |
| --- | --- | --- |
| `state.preT4ACanyon` / `state.preT4BCanyon` | True while that canyon is active | Set/cleared by start/stop functions in `40-main-late.js`. |
| `state.l3KnifeCanyon` / `state.l3KnifeDone` | True during/after L3 knife corridor | Re-armed by sequencer for next entry. |
| `state._drStageSpeed` | The DR_SEQUENCE-declared speed for the current stage | Set by sequencer in `67-main-late.js:1323` before `fam.activate()`, cleared right after. Canyon families read it instead of hardcoding. (Bug d406b46 fix.) |
| `state._preT4ASavedSpeed`, `_preT4ASavedLT`, `_preT4ASavedPhysLevel` | Restore values on canyon exit | Captured at activate, applied at stop. **If a stop is skipped, these stay set and leak into next.** |
| `state.preT4ARampPhase`, `preT4ARampT` | 'pending' / 'ramping' / 'active' / 'off' | Drives entry speed ramp. |
| `state.corridorGapCenter` | The X position the corridor centers on | Set to `state.shipX` at activate. Drives all sine math. |

---

## 3. Lifecycle phase by phase

### Phase 1: ACTIVATE

Triggered by:
- Sequencer dispatcher: `67-main-late.js:1323` calls `fam.activate(dummyBand, 'peak')` for `corridor`-type stages.
- L3 knife: sequencer's `l3_cone_corridor` type calls `_startL3KnifeCanyon()` directly.
- JL playback: `_jlCanyonStart(mode)` / `_jlCanyonStartOpen(mode)` in `72-main-late-mid.js`.
- Hotkeys: V (canyon tuner), B (B-mode), K (L4-recreation toggle) in `78-tuner-panels.js`.

Flow inside an activate function (using `_startPreT4ACanyon` as the canonical example, `40-main-late.js:715`):

1. Set state flags (`state.preT4ACanyon = true`, etc.).
2. Save restore values (`state._preT4ASavedSpeed`, `_preT4ASavedLT`).
3. Init ramp state (`state.preT4ARampPhase = 'pending'`).
4. **Set `_canyonMode`** (5 for T4A, 1 for T4B).
5. **Clear `_canyonTuner._allCyan` and `_allDark` to false** (line 734-735 / 898-899).
6. **Clear `_canyonTuner._l4Recreation = false`** (defensive — prior canyon may have set it).
7. **`Object.assign(_canyonTuner, _PRE_T4A_CANYON_TUNER)`** (or T4B preset). Preset re-asserts every flag the preset cares about.
8. Reset `_canyonSinePhase = 0` and `_l4RowsElapsed = 0`.
9. **If old walls exist, `_destroyCanyonWalls()`**. Critical for hot-restart.
10. Set `_canyonExiting = false`, `_canyonActive = true`, `_canyonManual = true`.
11. `_jlCorridor.active = false` (defensive).
12. `state.corridorGapCenter = state.shipX || 0` (anchor sine to ship X).
13. Call `_setCanyonDirLightTarget(0)` if defined (kills global dirLight smoothly).
14. **`_createCanyonWalls()`** — builds the slab pool and materials (see Phase 2).
15. Apply `_LT` lightning preset and call `_startLtPattern('random')`.

**Stop fns (`_stopPreT4ACanyon`) reverse this:**
- Set state flags off (`state.preT4ACanyon = false; preT4ADone = true`).
- If `opts.immediate !== false`: `_destroyCanyonWalls()` immediately.
- Else: `_canyonActive = false; _canyonExiting = true` (graceful exit, watchdog destroys later).
- Restore `state._LT`, speed, physLevel from saved values.
- `_clearCanyonDirLightTarget()` to ramp dirLight back to original.

### Phase 2: ENTRANCE APPROACH

`_createCanyonWalls()` (lines `20-main-early.js:8962`-9182) builds two pools:
- For each side ('left', 'right'):
  - `autoPool` slabs created (typically ~25-40 depending on `DESPAWN_Z`, `INIT_Z`, spacing).
  - First `T.entranceSlabs` (typically 1) are entrance slabs (thicker, scroll in from -500).
  - Remaining slabs are regulars, laid out at consecutive Z values from `entranceEnd` back to `INIT_Z` and beyond into overflow.
- **Regular slabs are `slab.visible = false`** until corridor reveal fires.
- **All slabs get `bakedX` baked at init** using stateless `_canyonXAtZ(initZ)` (or `_l4SineAtZ` if L4 mode).
- Materials: each slab's mesh chooses cyan or dark via `T._allCyan ? cyan : T._allDark ? dark : (posIdx % 2 === 0 ? cyan : dark)` at init (line 9040).

In Phase 2, only entrance slabs scroll. Regular slabs are frozen at their initial Z values. `_canyonSinePhase` does NOT advance (gated by `_corridorRevealed`).

### Phase 3: CORRIDOR REVEAL

`_updateCanyonWalls` (line 9431-9442) checks: when the nearest entrance slab reaches `Z >= -210`, flip `_canyonWalls._corridorRevealed = true` and unhide all regular slabs.

This is a one-shot. After it fires:
- `_canyonSinePhase` starts advancing.
- `_l4RowsElapsed` starts advancing (if L4 mode).
- Regular slabs scroll normally.

### Phase 4: CORRIDOR ACTIVE

Per frame, in `_updateCanyonWalls`:

For every slab on each side:
1. Apply scroll: `m.position.z += scroll`.
2. Update emissive fade-in based on Z (lines 9477-9486 — see footgun #2).
3. If `_canyonExiting`: hide if past despawn, skip recycle.
4. If past despawn (`m.position.z > DESPAWN_Z + spacing`): **recycle**.

Recycle (lines 9501-9540):
1. Find min Z among non-entrance slabs on this side: `minZ`.
2. `snappedMin = round(minZ / spacing) * spacing` (snaps to grid).
3. `slabZ = snappedMin - spacing` (one spacing behind back).
4. Compute `center` from `_canyonPredictCenter(rowsAhead)` or `_l4SineAtZ`.
5. Bake new `m.userData.bakedX = center + halfX * side`.
6. Set `m.position.x = bakedX, m.position.z = slabZ`.
7. **Reassign material based on `posIdx % 2`** (line 9531).

The parity rule: `posIdx = round(-slabZ / spacing)`. Since `slabZ = snappedMin - spacing` and `snappedMin` is `spacing * integer`, `posIdx` is always an integer. **Parity alternates with each recycle as long as `_canyonTuner._allCyan` and `_allDark` are both false.**

### Phase 5: EXIT

Triggered by stop function with `opts.immediate: false`:
- `_canyonActive = false; _canyonExiting = true`.
- Slabs scroll forward but **don't recycle** (line 9489-9491).
- Slabs go invisible past despawn.
- Watchdog at line 9550-9553 calls `_destroyCanyonWalls()` once `allGone === true`.

`_destroyCanyonWalls()` (line 9221-9247):
1. Reset `_canyonSinePhase = 0`, `_l4RowsElapsed = 0`, `_canyonExiting = false`.
2. Remove all pivot groups from scene.
3. **Dispose `cyanMat`, `darkMat`, `cyanTex`, `darkTex`**.
4. Zero (don't remove) `canyonLight` lights.
5. `_canyonWalls = null`.
6. Zero (don't remove) `_canyonFillLight`.

---

## 4. The alternation/parity system in detail

This is the most-bug-prone subsystem. Read this section before touching color logic.

### How alternation is supposed to work

`_canyonTuner._allCyan` and `_allDark` are two flags. The decision tree:
- If `_allCyan === true`: every slab is cyan.
- Else if `_allDark === true`: every slab is dark.
- Else (both false): alternate by `posIdx % 2 === 0` (even = cyan, odd = dark).

`posIdx = Math.round(-slabZ / spacing)` is the slab's grid-position index.

### Where the alternation logic lives

Three places — they MUST agree:

1. **Init (makeSlab)**, `20-main-early.js:9040`:
   ```js
   const posIdx = Math.round(-zPos / SPACING);
   const isCyan = T._allCyan ? true : T._allDark ? false : (posIdx % 2 === 0);
   const mesh = new THREE.Mesh(geo, isCyan ? cyanMat : darkMat);
   ```
2. **Recycle**, `20-main-early.js:9530-9537`:
   ```js
   const posIdx = Math.round(-slabZ / spacing);
   const wantCyan = T._allCyan ? true : T._allDark ? false : (posIdx % 2 === 0);
   const wantMat = wantCyan ? _canyonWalls.cyanMat : _canyonWalls.darkMat;
   if (m.children[0].material !== wantMat) m.children[0].material = wantMat;
   ```
3. **Both arms read the SAME `_canyonTuner` object.** If anything mutates the flags between phases, the slabs split: pre-mutation slabs keep old material, post-mutation slabs get new material.

### Invariants for alternation to hold

1. `_canyonTuner._allCyan` and `_allDark` MUST be set explicitly before each canyon's first slab is built. (Every preset does this. `_CANYON_PRESETS[5]` is the one exception — see footgun #1.)
2. `_canyonTuner._allCyan` / `_allDark` MUST NOT mutate while a canyon is alive. (Hotkey panels CAN mutate them — see footgun #3.)
3. `posIdx` parity is computed from snapped `slabZ`. **`spacing` must not change mid-canyon** or the parity reference shifts. (No code currently changes spacing mid-canyon.)
4. `cyanMat` and `darkMat` references on `_canyonWalls` MUST be the same instances slabs were initialized with. **`_destroyCanyonWalls` disposes them, so any held reference outside `_canyonWalls.{cyanMat,darkMat}` becomes stale.** (No code currently holds external refs, but pay attention.)

---

## 5. Touch-point checklist (use before changing X)

### If you change canyon color/material logic
- [ ] `_canyonTuner._allCyan` / `_allDark` defaults in `_canyonTuner` declaration (`20-main-early.js:8401`).
- [ ] All 5 entries in `_CANYON_PRESETS` (`20-main-early.js:8522-8537`). **Mode 5 currently missing `_allDark`.**
- [ ] `_PRE_T4A_CANYON_TUNER` and `_PRE_T4B_CANYON_TUNER` (`40-main-late.js:681, 860`).
- [ ] All activate paths set the flags before `Object.assign`:
  - `_jlCanyonStart` / `_jlCanyonStartOpen` (`72-main-late-mid.js:2629, 2645`) — **don't pre-clear.** Relies on preset being explicit.
  - `_startPreT4ACanyon` (`40-main-late.js:734-735`).
  - `_startPreT4BCanyon` (`40-main-late.js:898-899`).
  - L4 recreation start (`40-main-late.js:499-500`).
  - L3 knife (no flag mutation, inherits whatever's there — review).
  - `78-tuner-panels.js` panel handlers (lines 562, 616, 661).
- [ ] `CF_HIGH_WALL` in `67-main-late.js:1308-1326` mutates `_PRE_T4A_CANYON_TUNER._allDark` directly (not just `_canyonTuner`). **Has manual restore but no try/finally.**
- [ ] `makeSlab` at `20-main-early.js:9040`.
- [ ] Recycle path at `20-main-early.js:9530-9537`.
- [ ] `cyanMat` / `darkMat` material defs at `20-main-early.js:8981-9010`.

### If you change canyon shape/sine/halfX
- [ ] `_canyonXAtZ`, `_canyonIntensityAtZ`, `_canyonHalfXAtZ`, `_canyonPredictCenter`, `_canyonPredictHalfX` (`20-main-early.js:9254-9310`).
- [ ] `_l4SineAtZ` and `_bakeSlabCurveForL4` (in 40-main-late.js).
- [ ] Init bake loop (`20-main-early.js:9111-9155`).
- [ ] Recycle bake (`20-main-early.js:9508-9540`).
- [ ] `_canyonSinePhase` advance (gated by `_corridorRevealed`, line 9418).
- [ ] Mode 5 ramp fields: `sineStartI`, `sineStartZ`, `sineFullZ`, `halfXStart`, `halfXFull`, `halfXStartZ`, `halfXFullZ`.

### If you change canyon spawn/pool
- [ ] `T.entranceSlabs`, `T.entranceThick`, `T.spawnDepth` in tuner.
- [ ] `INIT_Z`, `SAFE_Z`, `autoPool` calc in `_createCanyonWalls` (`20-main-early.js:9069-9078`).
- [ ] Init Z layout for entrance vs regular slabs (`20-main-early.js:9095-9100`).
- [ ] Reveal trigger Z (`-210`, line 9436) — must be after entrance lands but before the first regular crosses ship.

### If you change destroy/recreate behavior
- [ ] `_destroyCanyonWalls` (`20-main-early.js:9221`) — order matters: scene removal → geometry dispose → material dispose → texture dispose → light zero → null out `_canyonWalls`.
- [ ] Persistent lights stay in scene (`_CANYON_PERSISTENT_LIGHTS`, `_canyonFillLight`) — **do not remove or you trigger a light-hash recompile wave**.
- [ ] `_canyonLightT` is **not reset** in destroy — preserves smooth ramp across canyon transitions.

### If you change activate/stop flow
- [ ] State flag pair (`state.preT4{A,B}Canyon`, `_done`, `_RampPhase`).
- [ ] Saved restore values (`_preT4{A,B}SavedSpeed`, `_LT`, `_PhysLevel`).
- [ ] `_canyonActive`, `_canyonExiting`, `_canyonManual`, `_canyonMode`.
- [ ] `_canyonTuner._l4Recreation` (cleared on every activate; toggled by L4-mode entries).
- [ ] `_destroyCanyonWalls()` call if old walls exist.
- [ ] Lightning `_LT` save/restore.
- [ ] `state._drStageSpeed` channel (sequencer's way to pass declared speed without hardcoding).
- [ ] `_setCanyonDirLightTarget` / `_clearCanyonDirLightTarget` for dirLight ramp.

---

## 6. Known footguns (the bug museum)

### Footgun #1: `_CANYON_PRESETS[5]` doesn't set `_allDark`
`20-main-early.js:8530-8536`. Mode 5 has `_allCyan: false` but no `_allDark`. The comment at line 8518-8521 explicitly warns about this exact pattern. If mode 5 is entered after mode 2 (which sets `_allDark: true`), mode 5 inherits dark-only. Triggered only by B hotkey today, but a real latent bug. **Fix: add `_allDark: false` to mode 5.**

### Footgun #2: emissive fade picks wrong base via `mat.color.r > 0.5`
`20-main-early.js:9483`:
```js
const baseEmi = mat.color && mat.color.r > 0.5 ? T.cyanEmi : T.darkEmi;
```
- `cyanMat.color = 0x04d4f0` → r = 0.016 (< 0.5)
- `darkMat.color = 0x080810` → r = 0.031 (< 0.5)

Both materials always go through the `T.darkEmi` branch. Cyan slabs get dark emissive. Not the alternation bug per se but a real color bug — cyan slabs are dimmer than they should be.

**Worse**: this writes `mat.emissiveIntensity` every frame for every slab. Since `mat` is the SHARED `cyanMat` or `darkMat` instance, ALL slabs sharing a material write to the same `emissiveIntensity` ping-ponging based on whichever slab's `fadeT` was last computed. **The visible emissive intensity is whatever the last slab in the loop set.** This causes flicker and effectively means the fade-in fights itself. Two real bugs in 9 lines.

**Fix:** identity-compare `mat === _canyonWalls.cyanMat`, and don't mutate shared materials per-frame — use per-mesh material clones or move fade to a shader uniform.

### Footgun #3: Hotkey panels mutate `_canyonTuner` flags directly with no preset reset
`78-tuner-panels.js:401-403`:
```js
chk.checked = !!_canyonTuner[key];
chk.onchange = () => { _canyonTuner[key] = chk.checked; };
```
A user toggling "All cyan" or "All dark" in the V panel writes the flag and it **stays set across canyons** until the next preset assign. Activate functions DO clear before assigning preset, so it's bounded — but if a panel toggles flags during an active canyon, you get mid-canyon split alternation.

**Mitigation:** today's flow always ends in a preset reset, so it self-heals on next canyon. Worth adding a "snapshot tuner state" assertion check.

### Footgun #4: Light-hash recompile wave
THREE.js shaders include the count and types of lights in their cacheKey. **Adding or removing a light from the scene** (or toggling its visibility) triggers every material to recompile, causing a 30-90ms frame freeze.

This is why:
- `_CANYON_PERSISTENT_LIGHTS` are **pre-added at scene init with intensity=0** and never removed.
- `_canyonFillLight` is zeroed in destroy, not removed.
- `canyonLight.lights` in `_canyonWalls` are zeroed in destroy, not removed.
- The cyan-light ramp uses `_canyonLightT` smoothstep so intensity changes are smooth.

**Never `scene.add` or `scene.remove` a light during gameplay.** Always pre-add at intensity 0 and ramp.

### Footgun #5: `_canyonTuner` global mutation pattern
The tuner is a single module-scoped object that every code path mutates with `Object.assign(_canyonTuner, preset)`. **`Object.assign` does NOT clear keys not in the source.** If preset A sets `disp: 4` and preset B doesn't mention `disp`, B inherits A's `disp`.

Comment at `20-main-early.js:8518-8521` explicitly warns: "_allCyan and _allDark MUST be explicit on every preset." **This invariant is not enforced anywhere — only documented.** A future preset that omits a flag will silently break alternation.

**Mitigation idea:** wrap activate in a helper that resets known-leaky keys to defaults before `Object.assign`. Or use full replacement instead of merge.

### Footgun #6: CF_HIGH_WALL preset mutation is not exception-safe
`67-main-late.js:1308-1326`:
```js
let _restoreT4A = null;
if (stage.darkSlabs && ...) {
  _restoreT4A = { _allDark, _allCyan, darkRgh, darkEmi };
  _PRE_T4A_CANYON_TUNER._allDark = true;
  // ...
}
state._drStageSpeed = stage.speed;
fam.activate(dummyBand, 'peak');           // ← mutates global _canyonTuner
state._drStageSpeed = undefined;
if (_restoreT4A) Object.assign(_PRE_T4A_CANYON_TUNER, _restoreT4A);
```

If `fam.activate()` throws (lightning init fails, dirLight undefined, anything), the restore at the bottom never runs. `_PRE_T4A_CANYON_TUNER._allDark` stays `true`. Every subsequent T4A canyon (CG, CI, CK_GATE) becomes all-dark forever this run.

**Fix:** wrap in try/finally. 4 lines. Closes the leak.

### Footgun #7: `_jlCanyonStart` / `_jlCanyonStartOpen` don't pre-clear flags
`72-main-late-mid.js:2629, 2645`. They `Object.assign(_canyonTuner, _CANYON_PRESETS[mode])` without clearing first. **Currently safe because all `_CANYON_PRESETS[1..4]` set both `_allCyan` and `_allDark` explicitly.** Mode 5 doesn't (footgun #1), but mode 5 isn't reachable from JL paths.

If a future preset omits a flag, this is the next leak point.

### Footgun #8: Init parity vs recycle parity must match
The init loop bakes posIdx from the slab's init Z. The recycle loop computes posIdx from the recycled Z. Both use `Math.round(-Z / spacing)`. **As long as Z values stay snapped to the grid**, parity is consistent.

The recycle path explicitly snaps via `Math.round(minZ / spacing) * spacing` to enforce this. **If anything ever mutates `m.position.z` to a non-snapped value mid-canyon** (a physics nudge, a rotation pivot offset, a bug in the bake math), parity drifts and alternation collapses or scrambles.

The comment at line 9036-9038 mentions this exact bug class:
> "Parity must match the recycle path which uses posIdx from Z, NOT init-loop index — otherwise a slab baked cyan at idx=4 lands at a Z whose posIdx is odd, gets flipped to dark on first recycle, and alternation drifts (looks like it 'goes all cyan' partway through)."

This is most likely the bug you've been seeing. **Triggered if the init Z grid and recycle Z grid disagree by half a spacing.** Worth checking: do all init Z values snap cleanly? Look at `entranceEnd - (i - T.entranceSlabs + 1) * SPACING` — this is integer-multiple aligned. Looks safe. But L4 mode's `_l4SineAtZ` is consulted at recycle but not at init for the bakedX, which could affect where slabs visually settle even if Z stays snapped.

### Footgun #9: `_canyonTuner._l4Recreation` defaults vary
- `_canyonTuner` declaration: `_l4Recreation: undefined` (not in initial object).
- Activates ALL clear it to `false` defensively.
- L4 mode start sets it to `true`.
- If an activate is added in the future that DOESN'T clear it, and L4 mode was last used, you get L4 sine geometry inside a non-L4 canyon — visually broken.

### Footgun #10: Multiple canyons can briefly overlap
When stage N's canyon ends with `immediate: false` and stage N+1 is also a canyon, stage N+1's activate calls `_destroyCanyonWalls()` (line 740 / 904) on the still-exiting old canyon. Old slabs get yanked instantly, no graceful tail. **Symptom: the previous canyon's exit visibly snaps off when the new canyon starts.** Whether this matters depends on stage timing.

---

## 7. Diagnostic checklist when something looks wrong

If alternation collapses to all-cyan or all-dark mid-canyon:
1. Check `_canyonTuner._allCyan` and `_allDark` at the moment of collapse. (Add temporary log in recycle path; remove before commit.)
2. Was a hotkey panel toggled during the canyon?
3. Was CF_HIGH_WALL's activate exception-thrown? (Footgun #6)
4. Did a preset assign omit one of the flags?

If alternation pattern is scrambled (random not striped):
1. Check whether `m.position.z` is non-snapped mid-flight.
2. Check whether `spacing` was changed mid-canyon (shouldn't happen).
3. Check init bake vs recycle bake formulas — they MUST use the same snap rule.

If canyon entry has visible glitches:
1. Check `_corridorRevealed` flag timing.
2. Check entrance slab bakeX vs regular slab bakeX (entrance uses `+ ENTRANCE_PAD`).
3. Check that `_canyonSinePhase` is still 0 at reveal moment (gated by reveal flag).

If canyon exit pops or stutters:
1. Check whether destroy was called immediately or graceful.
2. Check `_canyonLightT` ramp state — are lights snapping?
3. Check if a new canyon activate is racing the old exit.

If post-canyon dirLight is wrong:
1. Did `_clearCanyonDirLightTarget` fire?
2. Did `_canyonDirLightFrom` get set on entry?
3. Did `_canyonLightT` reach 0 cleanly (not interrupted by a new activate)?

---

## 8. Open questions / things this doc doesn't fully cover

- **L3 knife canyon path** uses different machinery (`_startL3KnifeCanyon` in 40-main-late.js, separate from PRE_T4{A,B}). Mostly self-contained but its interaction with `_canyonTuner.snap` mutation (lines 608, 613) is worth a dedicated review.
- **L4 sine corridor (`_l4Recreation` mode)** has its own bake function `_bakeSlabCurveForL4` that bends slab geometry, not just position. Adds another layer of state.
- **JL playback canyons** (mode 1-4 via `_jlCanyonStart`) share the same `_canyonWalls` machinery but are activated by music sync, not the DR sequencer. Some interaction with sequencer-spawned canyons is theoretically possible if both fire on the same frame.

---

## 9. Update procedure

When you change anything in the canyon system:
1. Identify which phase(s) and touch points are affected (Section 5).
2. Check whether the change can violate any invariant in Section 4 or footgun in Section 6.
3. Make the change.
4. Update this doc — at minimum, update line numbers if structure shifted, add new footguns if you found one.
5. Build + verify + node --check.
6. Commit src + this doc together.

If you find a new failure mode, add it to Section 6 (footguns) before fixing it. Future-you (and AI collaborators) will thank you.
