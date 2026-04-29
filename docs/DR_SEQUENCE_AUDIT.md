# DR Sequence Audit

Snapshot of the DeathRun progression as it exists at commit `a33a686`.
Source of truth: `src/67-main-late.js` → `DR_SEQUENCE` (line 983) and
`DEATH_RUN_VIBES` (line 406).

`BASE_SPEED = 36`. Forward speed shown is `BASE_SPEED × stage.speed`.
Lateral physics (MAX_VEL / ACCEL / DECEL) is driven by `physTier` →
`_physIdx = tier + 1` → `_snap = (_physIdx / 4)²`.

---

## Physics tier table

| Tier | _snap | MAX_VEL (lateral cap) | ACCEL | DECEL |
|------|-------|-----------------------|-------|-------|
| 0    | 0.0625 | 14.4 | 66.3 | 11.6 |
| 1    | 0.25   | 18.75 | 85.0 | 16.5 |
| 2    | 0.5625 | 25.94 | 116.3 | 24.6 |
| 3    | 1.0    | 36.0 | 160.0 | 36.0 |

Slider scaling: `MAX_VEL = (13 + _snap × 23) × k` where `k = 0.4 + 1.2 × latSpd`.
At default slider (latSpd=0.5, k=1.0) the table above applies as-is.

---

## Full sequence table

| #  | Stage              | Type                | Forward speed   | Vibe                | physTier |
|----|--------------------|---------------------|-----------------|---------------------|----------|
| 1  | S1_CONES           | Random cones (30s)  | 1.0× = 36       | NEON DAWN (0)       | 0 |
| 2  | CA_CANYON          | Canyon (T4B mild)   | 2.0× = 72       | NEON DAWN           | 0 |
| 3  | CA_REST            | Rest (3s)           | 2.0× = 72       | ULTRAVIOLET (1)     | 0 |
| 4  | S2_CONES_ZIPS      | Cones + zippers     | 1.35× = 48.6    | ULTRAVIOLET         | 1 |
| 5  | CB_CANYON          | Canyon (mild)       | 2.0× = 72       | ULTRAVIOLET         | 1 |
| 6  | CB_REST            | Rest                | 2.0× = 72       | ELECTRIC HORIZON (2)| 1 |
| 7  | **S3_L3_CORRIDOR** | L3 knife canyon (40s) | 2.0× = 72     | ELECTRIC HORIZON    | **1** |
| 8  | CC_REST            | Rest                | 2.0× = 72       | ELECTRIC HORIZON    | 2 |
| 9  | S4_WALLS_RAND      | Angled walls random | 2.0× = 72       | ELECTRIC HORIZON    | 2 |
| 10 | CD_CANYON          | Canyon (T4A intense)| 2.0× = 72       | ELECTRIC HORIZON    | 2 |
| 11 | CD_REST            | Rest                | 2.0× = 72       | ELECTRIC HORIZON    | 2 |
| 12 | S5_WALLS_STRUCT    | Structured walls    | 2.0× = 72       | ELECTRIC HORIZON    | 2 |
| 13 | CE_CANYON          | Canyon (intense)    | 2.0× = 72       | ELECTRIC HORIZON    | 2 |
| 14 | CE_REST            | Rest                | 2.0× = 72       | ELECTRIC HORIZON    | 2 |
| 15 | S6_RINGS           | Lethal rings (sun=2)| 2.0× = 72       | ELECTRIC HORIZON    | 2 |
| 16 | CF_HIGH_WALL       | High Wall Lightning | 2.0× = 72       | ELECTRIC HORIZON    | 2 |
| 17 | CF_REST            | Rest **(promotion)**| 2.1× = 75.6     | ICE STORM (3)       | 2 |
| 18 | **S7_L4_CORRIDOR** | L4 sine corridor (~48s) | 2.1× = 75.6 | ICE STORM         | **2** |
| 19 | CG_CANYON          | Canyon (intense)    | 2.1× = 75.6     | ICE STORM           | 3 |
| 20 | CG_REST            | Rest                | 2.1× = 75.6     | ICE STORM           | 3 |
| 21 | S8_FAT_CONES       | Fat cones           | 2.1× = 75.6     | ICE STORM           | 3 |
| 22 | CH_CANYON          | Canyon (mild)       | 2.1× = 75.6     | ICE STORM           | 3 |
| 23 | CH_REST            | Rest                | 2.1× = 75.6     | ICE STORM           | 3 |
| 24 | S9_SLALOM          | Slalom              | 2.1× = 75.6     | ICE STORM           | 3 |
| 25 | CI_CANYON          | Canyon (intense)    | 2.1× = 75.6     | ICE STORM           | 3 |
| 26 | CI_REST            | Rest **(promotion)**| 2.2× = 79.2     | ICE STORM           | 3 |
| 27 | S10_ZIPPER         | Zipper burst        | 2.2× = 79.2     | ICE STORM           | 3 |
| 28 | CJ_CC1_MILD        | CC1 Mild canyon     | 2.2× = 79.2     | ICE STORM           | 3 |
| 29 | CJ_REST            | Rest **(promotion)**| 2.5× = 90       | VOID SINGULARITY (4)| 3 |
| 30 | **S11_L5_CORRIDOR**| L5 sine corridor (~33s) | 2.5× = 90   | VOID SINGULARITY  | **3** |
| 31 | CK_GATE_CANYON     | Gate canyon         | 2.5× = 90       | VOID SINGULARITY    | 3 |
| 32 | CK_REST            | Rest                | 2.5× = 90       | VOID SINGULARITY    | 3 |
| 33 | ENDLESS            | Mixed cycle         | 2.5× = 90 (floor) | VOID SINGULARITY  | 3 |

### Corridor-stage summary (the three "peak" moments)

| Corridor | Stage # | Forward | Lateral cap | Lat/Fwd ratio |
|----------|---------|---------|-------------|---------------|
| L3 knife | 7  | 72   | 18.75 | 26% |
| L4 sine  | 18 | 75.6 | 25.94 | 34% |
| L5 sine  | 30 | 90   | 36.0  | 40% |

Lateral cap nearly doubles L3 → L5. Forward speed climbs +25%.
Ratio climbs (more lateral reach per unit forward) at higher tiers — opposite of Wipeout's design where ratio is roughly constant.

---

## Open issues identified during audit

### Confirmed real issues

1. **S1 → CA hard 2× speed jump (36 → 72) at obstacle entry.**
   First speed bump of the run lands at the START of the first canyon with no
   rest stage to promote through. Every later speed bump uses a "rest as
   promotion" pattern (see #17, #26, #29) — this one doesn't.

2. **CA_REST → S2 speed regression (2.0 → 1.35).**
   Speed goes BACKWARDS coming out of the first canyon into S2. Player
   experiences 36 → 72 → 72(rest) → 48.6 → 72 in the first ~95 seconds. Yo-yo.

3. **L3 corridor doesn't differentiate by speed.**
   S3_L3_CORRIDOR runs at 2.0× — identical to the warmup canyons before it
   (CA_CANYON, CB_CANYON). Only physTier (1) sets it apart from CD_CANYON
   (also tier 2). The "first big peak" lacks a speed signature.

4. **physTier vs speed misalignment in mid-run.**
   Tier 3 (max physics) is reached at stage 19 (CG_CANYON, 2.1×). Speed then
   creeps 2.1 → 2.2 → 2.5 over 11 more stages while physics is locked at the
   ceiling. The lateral/forward ratio drifts 48% → 40% → 48% → 40% as a
   side-effect of tier-locked, speed-creeping stages.

5. **Endless = L5 forever.**
   Stage 33 starts at 2.5× / tier 3 / VOID SINGULARITY — same params as L5
   corridor. Whole second half of any long run is parametrically identical to
   the moment L5 ended. No further escalation, no progression dimension.

### Resolved on second look (NOT bugs)

- "CF_REST and CJ_REST bump speed mid-rest" — this is the **intended**
  rest-as-promotion pattern at L3→L4 and L4→L5 transitions. Speed promotes
  during the breather so the next obstacle stage starts at the new speed.
  Coherent design. Other rest stages correctly hold flat.

---

## Structural concerns

### 1. Three independent progression dimensions, hand-tuned per row

`DR_SEQUENCE` has 33 rows, each with `speed`, `physTier`, `vibeIdx` set
independently. No curve, no derivation — all hand-edited. Easy to introduce
regressions like S1→CA→S2 (#1, #2 above) or stair-step physics that doesn't
track speed (#4).

**Suggested fix:** define progression curves first, derive the table from them.
- Forward speed curve (e.g. monotonic with named milestones at corridors)
- Physics tier curve (e.g. tier transitions locked to corridor moments)
- Vibe schedule (currently OK)

`DR_SEQUENCE` becomes a derived/generated table, not 33 hand rows.

### 2. Two parallel scheduling systems (DR_SEQUENCE + DR2_RUN_BANDS)

`DR2_RUN_BANDS` was the OLD time-based progression (30s/30s/30s/Infinity).
`DR_SEQUENCE` rewrite replaced it for stages 1-32 but bands are still alive for:

- **Wave director** (line 4861, 4917, 4948-4963): `_drPickMechanic(role, bandIdx)`
  uses band index to filter eligible mechanic families by `minBand`/`maxBand`.
  Bands gate WHAT mechanics can fire when wave director is active.
- **Mechanic spawn parameters** (line 950-955): each band has `buildRows`,
  `peakRows`, `peakChance`, `buildVariant`, `peakVariant`. Bands tune
  density/variety/chance.
- **Endless loop** (line 1669): pegs `_drBandIdx = bands.length - 1` (Band 6
  always) and uses that band's params.

**Critical dead-code clue (lines 4872-4892):** there's still a Band 4 → 5 → 6
auto-progression that fires `CORRIDOR_ARC` when `_drBandIdx` hits 3. This is
dead in normal play because DR_SEQUENCE handles L3/L4/L5 corridors as scripted
stages, but the wave director will *also* try to fire CORRIDOR_ARC if you
reach band 3 organically — possibly the source of past dual-canyon bugs.

**Suggested fix:** see todo #8 — audit/consolidate DR2_RUN_BANDS, remove dead
Band 4→5→6 corridor-arc path, document remaining band responsibilities clearly.

### 3. Multiple `state.speed = ` write sites (~30+ across files)

See todo #7. Per-corridor hard sets, BAND_SPEED table, `_drSpeedFloor` ratchet,
per-stage arc speeds, tutorial/intro/death sets, `_pendingSpeed` deferral
system — all writing `state.speed` from different places. No single source of
truth. Repeatedly tripped me up while diagnosing speeds in this session.

**Suggested fix:** funnel all writes through a single `_setDRSpeed(mult, reason)`
setter with an explicit `DR_SPEED` trigger table.

---

## Lateral velocity slider mismatch

The LATERAL SPEED macro currently anchors at `_maxVelBase=13` baseline (tier 0
floor), so its range (k = 0.4 → 1.6) maps to MAX_VEL ~5.2 → 20.8 at tier 0.
But corridors run at tier 1-3 with MAX_VEL 18.75 → 36, mostly OUTSIDE the
slider's range. Slider max ~20.8 < L5 runtime 36.

**Reverse-mapped slider equivalents for actual runtime:**
- L3 (18.75) ≈ slider 0.87
- L4 (25.94) ≈ slider 1.33 (off the top)
- L5 (36.0)  ≈ slider 1.97 (way off the top)

See todo #9 — recalibrate slider so its range covers the actual gameplay range.

---

## Reference: file/line locations

- `DR_SEQUENCE`: `src/67-main-late.js:983`
- `DEATH_RUN_VIBES`: `src/67-main-late.js:406`
- `DR2_RUN_BANDS_BASE`: `src/67-main-late.js:949`
- `_drSequencerTick`: `src/67-main-late.js:1067`
- `_drEndlessTick`: `src/67-main-late.js:1661`
- `_drPickMechanic`: `src/67-main-late.js:2133`
- `checkDeathRunSpeed` (BAND_SPEED): `src/67-main-late.js:2706`
- `_physIdx` / `_snap` (lateral physics): `src/67-main-late.js:3770-3783`
- `_applyLateralSpeed` macro: `src/72-main-late-mid.js:1131`
- Per-corridor speed sets: `src/67-main-late.js:1856` (L3), `:1930` (L4), `:1948` (L5)
- physTier override: `src/67-main-late.js:1111`
