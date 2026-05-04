# DR Sequence — Death Run game loop reference

Single source of truth for the player's journey through stages, canyons, speeds, physics tiers, FOV, and visual/audio vibes.

**If you change `DR_SEQUENCE` or `DEATH_RUN_VIBES`, update this doc in the same commit.**

Source of truth in code:
- `DR_SEQUENCE` — `src/67-main-late.js:1099`
- `DEATH_RUN_VIBES` — `src/67-main-late.js:463`
- Per-tick stage application — `src/67-main-late.js:1187` (`_drSequencerTick`)
- physTier → _physIdx mapping — `src/67-main-late.js:3722-3729`
- FOV speed coupling — `src/70-perf-diag.js:340-364`
- `BASE_SPEED = 36`, so `1.0× = 36 u/s`, `2.5× = 90 u/s`

---

## Speed monotonicity rule

Speed is **never supposed to decrease** during a normal Death Run. DR_SEQUENCE is the only authority. Every adjacent pair (stage N → stage N+1) must satisfy `speed[N+1] >= speed[N]`.

The per-tick setter at line 1229-1231 only writes a new speed when:
- a canyon corridor is **not** active (`!preT4ACanyon && !preT4BCanyon && !l3KnifeCanyon && !invincibleSpeedActive`),
- no pending speed bump is queued (`_pendingSpeed === undefined`),
- `|state.speed - targetSpeed| > 0.5`.

If you observe a speed drop, either DR_SEQUENCE has a regression, a canyon family hardcoded a lower speed in `activate()` (the bug fixed in d406b46), or the FOV-vs-speed visual is being misread.

---

## Physics tiers

`physTier` controls lateral physics snappiness via `_physIdx` lookup. `_physIdx = min(physTier + 1, 6)`. `MAX_VEL = _maxVelBase + (_lvlT^2) * _maxVelSnap` with `_lvlT = _physIdx / 4`.

| physTier | _physIdx | LEVELS | feel | MAX_VEL |
| --- | --- | --- | --- | --- |
| 1 | 2 | L3 | floaty-mid | 12.25 |
| 2 | 3 | L4 | crisp | 16.31 |
| 3 | 4 | L5 baseline | snappy | 22.00 |
| 4 | 5 | final-act 2.5× | very snappy | 29.31 |
| 5 | 6 | ENDLESS peak | maxed | 38.25 |

Slider scaling (LATERAL SPEED macro): `MAX_VEL = (13 + _snap × 23) × k` where `k = 0.4 + 1.2 × latSpd`. At default slider (latSpd=0.5, k=1.0) the table above applies as-is.

---

## FOV (purely speed-derived)

There is no canyon-specific FOV code. Every frame:

```
_rawFrac  = clamp((speed - BASE_SPEED) / (BASE_SPEED * 1.5), 0, 1)
speedFrac = _rawFrac ^ 1.4
targetFOV = _baseFOV + _fovSpeedBoost * speedFrac      // _fovSpeedBoost = 32
```

`_baseFOV` is set per orientation (mobile-portrait 79, mobile-landscape 60, desktop 78). Lerp toward `targetFOV` at rate 5 (rising) or 3 (falling), 12 during the 0.5s launch snap.

| speed mult | speed | targetFOV add (vs `_baseFOV`) |
| --- | --- | --- |
| 1.0× | 36 | +0° |
| 1.5× | 54 | +7.0° |
| 1.8× | 65 | +13.7° |
| 2.0× | 72 | +18.4° |
| 2.1× | 76 | +21.1° |
| 2.2× | 79 | +23.5° |
| 2.5× | 90 | +32.0° |

FOV climbs alongside speed and only eases back if speed is reduced (which DR_SEQUENCE never does).

---

## DEATH_RUN_VIBES (visual / lighting palettes)

Each `vibeIdx` defines sky gradient, grid color, sun color/shader, fog color, floor-line color, thruster color, bloom strength, and tendril overlay. Stages reference vibes by index. The first 5 are the only ones DR_SEQUENCE uses today; the rest power ENDLESS rotation.

| idx | name | sunShader | sky bottom | grid | sun color | bloom | tendrils |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | NEON DAWN | 0 (L1) | `#08102a` | cyan `#00eeff` | orange `#ff9500` | 0.35 | none |
| 1 | ULTRAVIOLET | 1 (L2) | `#0e0320` | magenta `#dd00ff` | violet `#cc44ff` | 0.38 | none |
| 2 | ELECTRIC HORIZON | 3 (L4 ICE) | `#050002` | teal `#00ffcc` | orange `#ff6600` | 0.38 | none |
| 3 | ICE STORM | 4 (L5) | `#000c18` | ice `#55ffff` | pale-blue `#aaeeff` | 0.30 | none |
| 4 | VOID SINGULARITY | 4 (L5) | `#060400` | gold `#ffcc00` | amber `#ffaa33` | 0.30 | l5f |
| 5+ | DEEP EMERALD, SOLAR FLARE, MIDNIGHT ROSE, TOXIC, ARCTIC DAWN, BLOOD MOON, ELECTRIC INDIGO, COPPER, PLASMA, OBSIDIAN, SUPERNOVA, PHANTOM, … | mixed | mixed | mixed | mixed | mixed | mixed |

Sun shader IDs:
- 0 — L1 (Neon Dawn original)
- 1 — L2
- 2 — L3 crimson warp (used by `S6_RINGS` via `sunOverride: 2` so lethal rings keep the original L3 look)
- 3 — L4 ICE STORM (built-in Quilez warp)
- 4 — L5 (built-in Quilez warp)

`sunOverride` on a stage swaps just the sun shader without changing the rest of the vibe palette. Currently used only by `S6_RINGS` (override 2).

The "warped era" begins at `S3_L3_CORRIDOR` — from S3 onward, `uIsL3Warp` is forced on for sun shaders 0/1/2. Shaders 3 and 4 already have warp baked in.

---

## DR_SEQUENCE (ordered stage table)

Speed climbs **monotonically** 1.5× → 2.5×. physTier climbs 1 → 5. vibeIdx steps 0 → 4 across the 11 named stages, then ENDLESS rotates through the rest.

Canyon corridor stages run their natural slab-pool length (~40s) when no `duration` is set; rest stages all 3s; obstacle stages all 30s except S11 (60s) and S7 (~48s, row-count gated).

| # | stage name | type | duration | speed mult | physTier | vibeIdx | sun shader (effective) | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `S1_CONES` | random_cones | 30s | **1.5×** | 1 | 0 NEON DAWN | 0 L1 orange | cones ramp 5→9 |
| 2 | `CA_CANYON` | corridor `PRE_T4B_CANYON` | ~40s | **1.8×** | 1 | 0 NEON DAWN | 0 L1 orange | first canyon, mild |
| 3 | `CA_REST` | rest | 3s | 1.8× | 1 | 1 ULTRAVIOLET | 1 L2 violet | klaxon if next is faster |
| 4 | `S2_CONES_ZIPS` | cones_and_zips | 30s | 1.8× | **2** | 1 ULTRAVIOLET | 1 L2 violet | physTier bumps 1→2 |
| 5 | `CB_CANYON` | corridor `PRE_T4B_CANYON` | ~40s | **2.0×** | 2 | 1 ULTRAVIOLET | 1 L2 violet | |
| 6 | `CB_REST` | rest | 3s | 2.0× | 2 | 2 ELECTRIC HORIZON | 3 L4 ICE | vibe steps to ICE world |
| 7 | `S3_L3_CORRIDOR` | l3_cone_corridor | 40s | 2.0× | 2 | 2 ELECTRIC HORIZON | 3 L4 ICE | L3 KNIFE canyon, music → `l4`, warped era starts |
| 8 | `CC_REST` | rest | 3s | 2.0× | 2 | 2 ELECTRIC HORIZON | 3 L4 ICE | |
| 9 | `S4_WALLS_RAND` | angled_walls | 30s | 2.0× | 2 | 2 ELECTRIC HORIZON | 3 L4 ICE | |
| 10 | `CD_CANYON` | corridor `PRE_T4A_CANYON` | ~40s | 2.0× | 2 | 2 ELECTRIC HORIZON | 3 L4 ICE | |
| 11 | `CD_REST` | rest | 3s | 2.0× | 2 | 2 ELECTRIC HORIZON | 3 L4 ICE | |
| 12 | `S5_WALLS_STRUCT` | structured_walls | 30s | 2.0× | 2 | 2 ELECTRIC HORIZON | 3 L4 ICE | |
| 13 | `CE_CANYON` | corridor `PRE_T4A_CANYON` | ~40s | 2.0× | 2 | 2 ELECTRIC HORIZON | 3 L4 ICE | |
| 14 | `CE_REST` | rest | 3s | 2.0× | 2 | 2 ELECTRIC HORIZON | 3 L4 ICE | |
| 15 | `S6_RINGS` | lethal_rings | 30s | 2.0× | 2 | 2 ELECTRIC HORIZON | **2 L3 crimson** (sunOverride) | only stage where sun differs from vibe |
| 16 | `CF_HIGH_WALL` | corridor `PRE_T4A_CANYON` | ~40s | 2.0× | 2 | 2 ELECTRIC HORIZON | 3 L4 ICE | `darkSlabs: true` |
| 17 | `CF_REST` | rest | 3s | **2.1×** | 2 | 3 ICE STORM | 4 L5 ice-blue | klaxon countdown, music → `keepgoing` |
| 18 | `S7_L4_CORRIDOR` | corridor `L4_SINE_CORRIDOR` | ~48s | 2.1× | 2 | 3 ICE STORM | 4 L5 ice-blue | row-count gated (518 rows) |
| 19 | `CG_CANYON` | corridor `PRE_T4A_CANYON` | ~40s | 2.1× | **3** | 3 ICE STORM | 4 L5 ice-blue | physTier bumps 2→3 |
| 20 | `CG_REST` | rest | 3s | 2.1× | 3 | 3 ICE STORM | 4 L5 ice-blue | |
| 21 | `S8_FAT_CONES` | fat_cones | 30s | 2.1× | 3 | 3 ICE STORM | 4 L5 ice-blue | |
| 22 | `CH_CANYON` | corridor `PRE_T4B_CANYON` | ~40s | 2.1× | 3 | 3 ICE STORM | 4 L5 ice-blue | |
| 23 | `CH_REST` | rest | 3s | 2.1× | 3 | 3 ICE STORM | 4 L5 ice-blue | |
| 24 | `S9_SLALOM` | slalom_only | 30s | 2.1× | 3 | 3 ICE STORM | 4 L5 ice-blue | |
| 25 | `CI_CANYON` | corridor `PRE_T4A_CANYON` | ~40s | 2.1× | 3 | 3 ICE STORM | 4 L5 ice-blue | |
| 26 | `CI_REST` | rest | 3s | **2.2×** | 3 | 3 ICE STORM | 4 L5 ice-blue | klaxon countdown |
| 27 | `S10_ZIPPER` | zipper_only | 30s | 2.2× | 3 | 3 ICE STORM | 4 L5 ice-blue | |
| 28 | `CJ_CC1_MILD` | corridor `PRE_T4B_CANYON` | ~40s | 2.2× | 3 | 3 ICE STORM | 4 L5 ice-blue | |
| 29 | `CJ_REST` | rest | 3s | **2.5×** | **4** | 4 VOID SINGULARITY | 4 L5 amber | klaxon, physTier 3→4, vibe steps to gold/void |
| 30 | `S11_L5_CORRIDOR` | corridor `L5_SINE_CORRIDOR` | 60s | 2.5× | 4 | 4 VOID SINGULARITY | 4 L5 amber | climax sine corridor |
| 31 | `CK_GATE_CANYON` | corridor `PRE_T4A_CANYON` | ~40s | 2.5× | 4 | 4 VOID SINGULARITY | 4 L5 amber | gate canyon |
| 32 | `CK_REST` | rest | 3s | 2.5× | 4 | 4 VOID SINGULARITY | 4 L5 amber | |
| 33 | `ENDLESS` | endless_mix | ∞ | 2.5× | **5** | 4 VOID SINGULARITY → rotates | rotates | endless mix; vibe rotates through 5..N |

### Speed-step boundaries (where klaxon countdown fires)

The klaxon countdown plays during the last 1.5s of **any timed stage** when the next stage's speed > current. Implemented in two parallel blocks:

- `67-main-late.js:1271-1289` — fires for rest stages
- `67-main-late.js:1561-1577` — fires for any other timed stage (`stage.duration` set)

In DR_SEQUENCE this triggers at every speed bump:

- `S1_CONES` (1.5× → CA 1.8×)
- `S2_CONES_ZIPS` (1.8× → CB 2.0×)
- `CF_REST` (2.0× → S7 2.1×)
- `CI_REST` (2.1× → S10 2.2×)
- `CJ_REST` (2.2× → S11 2.5×)

CA_REST and CB_REST hold their canyon's speed (no jump on exit), so no klaxon fires there even though canyon entry itself was a bump.

### Corridor "peak" moments

| Corridor | Stage # | Forward speed | Lateral cap | Lat/Fwd ratio |
|----------|---------|---------------|-------------|---------------|
| L3 knife | 7  | 72   | 12.25 | 17% |
| L4 sine  | 18 | 75.6 | 16.31 | 22% |
| L5 sine  | 30 | 90   | 29.31 | 33% |

---

## Canyon families

| family | activate fn | tuner | duration | used by |
| --- | --- | --- | --- | --- |
| `PRE_T4A_CANYON` | `40-main-late.js:670` | `_PRE_T4A_CANYON_TUNER` | natural slab pool (~40s) | CD, CE, CF (darkSlabs), CG, CI, CK |
| `PRE_T4B_CANYON` | `40-main-late.js:850` | `_PRE_T4B_CANYON_TUNER` | natural slab pool (~40s) | CA, CB, CH, CJ |
| `L4_SINE_CORRIDOR` | `_jlCorridor` start | `_canyonTuner` (L4 preset) | row-count gated (518 rows ≈ 48s @ 2.1×) | S7 |
| `L5_SINE_CORRIDOR` | `_jlCorridor` start | `_canyonTuner` (L5 preset) | duration: 60s | S11 |
| `L3_KNIFE_CANYON` | `_startL3KnifeCanyon` | hardcoded | 40s timer | S3 |

**Speed handoff rule** (post d406b46): the dispatcher writes `state._drStageSpeed = stage.speed` before calling `fam.activate()`. Each family reads it and uses the declared speed instead of a hardcoded `2.0×`.

---

## Stage type → spawn behavior cheatsheet

| `type` | spawner | notes |
| --- | --- | --- |
| `random_cones` | normal cone field | density: `ramp` (5→9 over duration), `sparse`, `dense`, `normal` |
| `cones_and_zips` | cones + zippers | |
| `angled_walls` | random angled walls (AW) | |
| `structured_walls` | scripted AW patterns | |
| `lethal_rings` | bonus rings only, lethal if missed | |
| `fat_cones` | fat-cone field | |
| `slalom_only` | slalom only | |
| `zipper_only` | zippers only | |
| `l3_cone_corridor` | fires `_startL3KnifeCanyon()` directly (legacy cone-corridor under `_L3_KNIFE_ENABLED=false`) | |
| `corridor` | activates `DR_MECHANIC_FAMILIES[stage.family]` | |
| `rest` | clears all obstacles, gates by `duration` | klaxon if next.speed > current |
| `endless_mix` | rotates obstacle types + vibes | physTier locked at 5 |

---

## Known structural concerns (carry-overs from earlier audit)

These are open items from the original audit at commit `a33a686`. Not bugs in the current loop, but caveats for future edits.

### Two parallel scheduling systems (DR_SEQUENCE + DR2_RUN_BANDS)

`DR2_RUN_BANDS` was the OLD time-based progression (30s/30s/30s/Infinity). DR_SEQUENCE replaced it for stages 1-32, but bands are still alive for:

- **Wave director** (`67-main-late.js` ~4861, 4917, 4948-4963): `_drPickMechanic(role, bandIdx)` uses band index to filter eligible mechanic families by `minBand`/`maxBand`.
- **Mechanic spawn parameters** (~950-955): `buildRows`, `peakRows`, `peakChance`, `buildVariant`, `peakVariant` per band.
- **Endless loop** (~1669): pegs `_drBandIdx = bands.length - 1` (Band 6) and uses that band's params.

There's still a Band 4 → 5 → 6 auto-progression (~4872-4892) that fires `CORRIDOR_ARC` when `_drBandIdx` hits 3. Dead in normal play because DR_SEQUENCE handles L3/L4/L5 corridors as scripted stages, but worth removing.

### Multiple `state.speed = ` write sites

~30+ sites across files. Per-corridor hard sets, BAND_SPEED table, `_drSpeedFloor` ratchet, per-stage arc speeds, tutorial/intro/death sets, `_pendingSpeed` deferral. No single source of truth. Funneling all writes through one `_setDRSpeed(mult, reason)` setter would prevent the class of bug d406b46 fixed.

### Lateral velocity slider mismatch

LATERAL SPEED macro anchors at `_maxVelBase=13` (tier 0 floor). Slider range (k = 0.4 → 1.6) maps to MAX_VEL ~5.2 → 20.8 at tier 0. Corridors run at tier 1-3 with MAX_VEL 12.25 → 22.00, mostly OUTSIDE the slider's range at default scaling. Recalibrate slider to cover actual gameplay range.

---

## Changes since previous audit (commit `a33a686` → current)

The old `DR_SEQUENCE_AUDIT.md` was a snapshot at commit `a33a686`. Since then the loop has been re-tuned. Material drifts:

**Speed table (resolves old audit issues #1 and #2 — the S1→CA hard jump and CA_REST→S2 yo-yo regression):**
- `S1_CONES`: 1.0× → **1.5×**
- `CA_CANYON`: 2.0× → **1.8×**
- `CA_REST`: 2.0× → **1.8×**
- `S2_CONES_ZIPS`: 1.35× → **1.8×** (no longer regresses below the canyon it follows)

Net result: the run now climbs monotonically 1.5 → 1.8 → 2.0 → 2.1 → 2.2 → 2.5 with no backwards steps. This is now an enforced invariant (see "Speed monotonicity rule" at top).

**Physics tier numbering shifted +1 (and two new tiers added at the top):**
- Old audit: tiers 0..3, formula `_physIdx = tier + 1`, max tier 3 reached at CG_CANYON, ENDLESS still at tier 3.
- Current: tiers 1..5, formula `_physIdx = min(physTier + 1, 6)`, tier 4 introduced at `CJ_REST`, tier 5 reserved for `ENDLESS`. Partially resolves old audit issue #5 ("Endless = L5 forever") — endless now sits 2 tiers above L5 corridor.

**MAX_VEL values dropped at default slider** (lateral handling is less twitchy than the old audit table implied):
- Old tier 1 = 18.75, current physTier 1 = 12.25
- Old tier 2 = 25.94, current physTier 2 = 16.31
- Old tier 3 = 36.0, current physTier 3 = 22.00
- New physTier 4 = 29.31, physTier 5 = 38.25

Corridor lat/fwd ratios are correspondingly lower than the old audit reported: L3 17% (was 26%), L4 22% (was 34%), L5 33% (was 40%). The ratio still climbs across corridors but starts and ends lower.

**Stage durations:**
- `S11_L5_CORRIDOR`: ~33s → **60s**

**New behavior not in old audit:**
- Klaxon countdown during last 1.5s of any timed stage with a speed bump ahead. Currently fires at S1→CA, S2→CB, CF_REST→S7, CI_REST→S10, CJ_REST→S11 (every speed bump in DR_SEQUENCE).
- `S6_RINGS` uses `sunOverride: 2` (L3 crimson) so lethal rings keep their original look despite riding the ELECTRIC HORIZON vibe.
- `_drStageSpeed` handoff: dispatcher writes the declared speed before `fam.activate()` so canyon families honor stage-declared speed (fixed in d406b46 this session — previously canyons hardcoded 2.0×).
- Warped-era flag (`uIsL3Warp` forced on from S3 onward for sun shaders 0/1/2).

**Resolved from old audit:**
- Issue #1 (S1→CA hard 2× jump) — fixed by lowering S1 to 1.5× and CA to 1.8×.
- Issue #2 (CA_REST→S2 regression) — fixed by raising S2 to 1.8×.

**Still open from old audit:**
- Issue #3 (L3 corridor lacks unique speed signature) — S3 still runs at 2.0× same as CB.
- Issue #4 (physTier vs speed misalignment mid-run) — partially mitigated by adding tier 4 at CJ_REST, but tier 3 still spans CG..CJ at speeds 2.1 → 2.2.
- Issue #5 (Endless homogeneity) — partially mitigated by ENDLESS now at physTier 5, but speed still pegged at 2.5×.
- DR2_RUN_BANDS dead `CORRIDOR_ARC` Band 4→5→6 path (~4872-4892) — still present.
- ~30+ `state.speed =` write sites with no central setter — still present.
- Lateral velocity slider mismatch — still present (slider range 5.2 → 20.8 still doesn't cover physTier 3+ caps).

**Source-of-truth line numbers shifted** (build is unchanged, just code grew):
- `DR_SEQUENCE`: 983 → **1099**
- `DEATH_RUN_VIBES`: 406 → **463**
- `_drSequencerTick`: 1067 → **1187**
- `_drEndlessTick`: 1661 → not re-audited (not used by current main loop)
- `_physIdx` mapping: 3770-3783 → **3722-3729**

---

## Update procedure

When you change `DR_SEQUENCE` or `DEATH_RUN_VIBES`:

1. Edit the table in `src/67-main-late.js`.
2. Update the corresponding row(s) in this doc.
3. Re-check speed monotonicity (no decreases).
4. Re-check physTier monotonicity (no decreases).
5. Update the "Speed-step boundaries" list if you added/removed speed jumps.
6. `bash scripts/build.sh && bash scripts/verify.sh && node --check dist/game.js`.
7. Commit `src/67-main-late.js` + `docs/DR_SEQUENCE.md` together.
