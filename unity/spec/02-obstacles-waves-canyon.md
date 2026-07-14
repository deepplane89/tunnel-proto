# Jet Horizon — Spec 02: Obstacles, Wave Director / DR Sequence, Canyon System, Water

Extracted 2026-07-04 from the live source (`src/*.js`), NOT from the docs — the docs
(`docs/DR_SEQUENCE.md`) have drifted (e.g. S2 is now `fat_cones`, canyon corridor
durations are now 20 s not 40 s). **Code line numbers below are the source of truth.**

Everything here is in world units (u). The ship is stationary at Z = 3.9; the world
scrolls toward the ship in +Z. All obstacle movement per frame is:

```
effectiveSpeed = state.invincibleSpeedActive ? state.speed * 1.8 : state.speed   // 67-main-late.js:4376
obstacle.position.z += effectiveSpeed * dt        // every hazard/coin/powerup/slab
```

---

## 0. Global constants

| Name | Value | Meaning | Source |
|---|---|---|---|
| `BASE_SPEED` | 36 | u/s at 1.0× multiplier. Runtime speed = `BASE_SPEED * stage.speed` | 20-main-early.js:154 |
| `LANE_COUNT` | 21 | logical lanes for the random spawner | 20-main-early.js:214 |
| `LANE_WIDTH` | 3.2 | u per lane (road ≈ 67 u wide logically) | 20-main-early.js:215 |
| `SPAWN_Z` | −160 | Z where cones/walls/rings/coins spawn (fade in from horizon) | 20-main-early.js:222 |
| `DESPAWN_Z` | 6 | Z past which obstacles are recycled | 20-main-early.js:223 |
| `OBSTACLE_POOL_SIZE` | 500 | shared cone pool (3 color types round-robin) | 20-main-early.js:224 |
| `SHIP_HALF_WIDTH` | 1.2 | used by canyon-slab collision | 20-main-early.js:218 |
| Ship Z | 3.9 | fixed ship world Z | (throughout) |
| Ship hover Y | 1.71 | `_hoverBaseY` flight height | docs/continuity |
| `COIN_POOL_SIZE` | 60 (+40 arc) | coin pool | 20-main-early.js:11343-11344 |
| `LETHAL_RING_POOL_SIZE` | 20 | lethal ring pool | 40-main-late.js:1985 |
| `_RING_POOL_SIZE` | 24 | bonus (fuel) ring pool (12 spawn + 12 ripple) | 67-main-late.js:2820 |
| Post-launch grace | 2.0 s | no spawns for 2 s after intro lift ends | 67-main-late.js:5998 |

Ship-vs-cone collision (67-main-late.js:6170-6195), roll-aware:

```
roll      = shipGroup.rotation.z            // 0 flat … ±π/2 knife-edge
rollFrac  = min(|roll| / (π/2), 1)
WING_HALF = 1.5 ; BODY_HALF = 0.8
colDistX  = WING_HALF*(1-rollFrac) + BODY_HALF*rollFrac
colDistZ  = 1.5
cScale    = obs.slalomScaled ? obs.scale.x : 1        // fat/slalom cones scaled 4×
cMult     = obs.isFatCone ? 0.9 : 1.2
HIT if |obs.x - shipX| < colDistX + (cScale-1)*cMult
   AND |obs.z - shipZ| < colDistZ + (cScale-1)*0.4
```

Near-miss: `colDistX < dx < colDistX+0.6` and `dz < 2.0` → +25 × levelMult score,
one per cone, SFX cooldown 0.5 s (67-main-late.js:6198).

---

## 1. Obstacle taxonomy

### 1.1 Cone (standard hazard)
- Geometry: `THREE.ConeGeometry(radius=1.6, height=totalH, radialSegments=6)` where
  `h = 8 + rand()*3`, `SINK = 2.0`, `totalH = h + SINK`; mesh Y = `totalH/2 − SINK`
  (bottom 2 u submerged below the water plane). Source 20-main-early.js:9409-9468.
- 3 color types (round-robin per spawn: `type = floor(rand()*3)`):
  `CONE_COLORS = [0xff1a8c pink, 0x44ccff cyan, 0xffcc00 gold]`, opacities [0.92, 0.88, 0.95].
  Obsidian body 0x12121a with a neon UV band (band OFF by default; forced ON during
  L4/L5 sine corridors via `_setConeNeonBand(true)`, uGlowBot=0.255/uGlowTop=0.345).
- Movement: pure +Z scroll, `velX = 0` in all current spawners. Fades in from SPAWN_Z.
- Corridor cones set `userData.isCorridor = true` (laser can't destroy them);
  slalom cones set it false.

### 1.2 Fat cone
- Same pooled cone with `obs.scale.set(4, 1, 4)` + `userData.isFatCone = true`,
  `userData.slalomScaled = true` (scale reset on pool return). 40-main-late.js:2315-2330.
- Hitbox mult 0.9 (see §0); visual radius ≈ 6.4 u at base, ~4.33 u at ship height.

### 1.3 Angled wall (neon panel)
Two systems share a pool (`_awPool`, active list `_awActive`):

**(a) Random walls** — spawned by `spawnObstacles()` in `_seqSpawnMode='angled'`
(S4_WALLS_RAND, endless `angled_random`). Tuner `_awRandTuner` (20-main-early.js:11052):

| Param | Value | Meaning |
|---|---|---|
| wallW / wallH | 8 / 4 | panel size (box scaled 8×4×0.3, center Y = wallH/2) |
| angleMin / angleMax | 25 / 45 | random Y-rotation degrees, random sign |
| countMin / countMax | 6 / 8 | walls per row |
| laneGap | 4 | min lane separation within a row |

**(b) Structured bursts** — `ANGLED_WALL` family (S5_WALLS_STRUCT fires it every 3 s;
endless `angled_struct`). Spawns rows from `spawnAngledWallRow()`
(20-main-early.js:11284) using grid tuner `_awTuner` (20-main-early.js:11022):
wallW 22, wallH 4, angle 35°, zSpacing 50 (Z between rows), xOffset 12, rows 20,
copiesX 6 @ spacingX 42, copiesY 2 @ spacingY 6, copiesZ 2 @ spacingZ 5,
rotX −36°, fieldShift −9.5, thickness 0.3, emissive 1.5, edgeGlow 1.5.
Rows alternate lean: even rows `angleSign=+1` (/), odd `−1` (\).
Base X = `shipX + angleSign*xOffset + fieldShift`. Row cadence: accumulator
`angledWallSpawnZ += effectiveSpeed*dt`, fire at ≥0, reset to `−zSpacing`
(67-main-late.js:6226-6230). Family ends when `rowsDone ≥ rows` and all walls passed.
- Collision: full rotated-OBB test, ship treated as 0.3 u cube (67-main-late.js:6264-6305).
- Fade-in over the first 40% of the run-in: `fadeT = clamp((z − SPAWN_Z)/(−SPAWN_Z*0.4))`.

### 1.4 Lethal ring (red octagon torus)
- Geometry: tube following an 8-sided polygon, `_LR_SIDES=8, _LR_R=5.25, _LR_TUBE=2.2`,
  ring center height `_LR_Y=2` (40-main-late.js:1986). Colors: neon 0xff1a1a on
  obsidian 0x0a0a0f, band shader.
- Spawned by `spawnObstacles()` in `_seqSpawnMode='lethal'` (S6_RINGS, endless
  `lethal`): 3–4 per row, min 4-lane separation.
- Collision: exact distance-to-octagon-tube-path in 3D, hit radius = 2.2 (tube radius),
  67-main-late.js:6349-6377. Flying *through* the opening is safe.
- Fade-in same 40% ramp; opacity cap 0.92.

### 1.5 Corridor cone walls (L3 legacy / L4 / L5 sine corridors)
Rows of 2 cones per side (inner at `center ± halfX`, outer at `center ± (halfX+LANE_WIDTH)`),
wall jitter ±0.3 u (`(rand()-0.5)*0.6`). Row cadence for ALL corridors: accumulator
`spawnZ += effectiveSpeed*dt`; fire at ≥0; reset to `−7 + (rand()−0.5)*2` → one row
every ~7 world units (67-main-late.js:5690, 5707, 5753). Full math in §5.

### 1.6 Zipper (alternating gate walls)
Constants (40-main-late.js:1354-1358): `ZIPPER_ROWS=13`, `ZIPPER_GAP_HALF=7.5`,
`ZIPPER_OFFSET=11`, tint 0xffcc00 gold, `ZIPPER_COOLDOWN=30` (campaign only).
`spawnZipperRow()` (40-main-late.js:1925):

```
gapCX    = shipX + zipperSide * ZIPPER_OFFSET          // side flips every row
laneSpan = LANE_COUNT * 8 lanes (=168) centered on shipX   // fills side vision
rowsDone = ZIPPER_ROWS - zipperRowsLeft
gapHalf  = (rowsDone >= ZIPPER_ROWS-2) ? ZIPPER_GAP_HALF*1.9 : ZIPPER_GAP_HALF  // exit reward
spawn cone in every lane x where |x - gapCX| > gapHalf   (jitter ±0.25)
zipperSide *= -1
```
Cadence: time-based, `zipperSpawnTimer = 1.5 − ramp*0.65` seconds
(`ramp = min(rowsDone/(ZIPPER_ROWS−1),1)` → 1.5 s → 0.85 s), first row after 1.0 s
grace (`zipperSpawnTimer=-1.0`). 67-main-late.js:5763-5769.

### 1.7 Slalom (closing doors with wandering gap)
Constants (40-main-late.js:1475-1484): `SLALOM_Z_SPACING=60` (Z between rows),
`SLALOM_GAP_WIDTH=8` (default; DR sets `_slalomGapWidth=10`, endless 9),
`SLALOM_WALL_HALF=500`, tint 0xff44aa hot pink, cone scale 4×, cone X step 14,
30% random skip per cone (breathing holes). `spawnSlalomRow()` (40-main-late.js:1486):
- gap center from `_drNextGapCenter(0.7)` physics curve when `slalomUsePhysicsCurve`
  (all DR usages) — smooth sweeping gap with rules: gap pushed ≥14 u from ship
  (`_minGapFromShip=14`, 40-main-late.js:1450), clamped at `DR_CORRIDOR_MAX_WANDER`.
- start: gap forced to `shipX ± 18` (random side) so player must move immediately.
- 3 coins evenly placed in the gap at Y 1.2 (reward).
- Row cadence: `slalomSpawnZ` accumulator, reset −60. Rows: `16 + floor(rand()*3)`
  (S9; endless `16+rand*4`). 67-main-late.js:5774-5784.

### 1.8 Custom pattern
`DR_CUSTOM_PATTERN_1` — 106 hand-authored rows of lane lists (40-main-late.js:1556),
xScale 3, centered on shipX, tint 0xff1a8c, row every 7 u. Only reachable through
the legacy `CUSTOM_PATTERN` family (not in the current DR_SEQUENCE). Optional.

### 1.9 Canyon slabs — see §6 (they are the walls of canyon corridors; lethal via
stateless X-edge test, not the cone collision).

### 1.10 Lightning bolts
During PRE_T4A/PRE_T4B canyons a lightning pattern fires (visual + hazard,
`warnRadius 3.5`, spawnZ −83, lanes −8..+8). T4A frequency 0.3 s, T4B 2.0 s
(_PRE_T4A_LT_TUNER / _PRE_T4B_LT_TUNER, 40-main-late.js:957/1141). Full bolt system
is out of scope for this file; treat as: telegraphed strike at a lane X, warning 0.3 s,
bolt lives 0.5 s, kill radius 3.5 u ground circle (hitboxScale 1).

### 1.11 Coins
Gold discs `CylinderGeometry(0.46, 0.46, 0.14)`, Y 1.2, collected by proximity.
Spawn inside `spawnObstacles()` (40-main-late.js:2381-2435), throttle: in DR a coin
event is allowed every ≥2 spawner waves (`framesSinceLastCoin > 1`):
- roll < 0.45 → single coin in a random free lane.
- roll < 0.80 → **curved chain**: `count = 10 + floor(rand*6)` (DR), Z span
  `28 + rand*16`, `x = baseX + sin(frac*π)*xSwing` (baseX = shipX ± 4, xSwing ±5),
  `y = 1.2 + sin(frac*π)*0.7`.
- else → **straight chain**: `count = 8 + floor(rand*5)` (DR), Z span `20 + rand*12`,
  single free lane.
Also: 3 coins per slalom row inside the gap. Coin score: +75 × levelMult.

### 1.12 Bonus (fuel) rings — friendly, not obstacles
`_ringTuner = { y:2, radius:5.25, lineWidth:20, sides:8, length:12, freq:3.5 }`
(67-main-late.js:2809) — a row = 12 octagon Line2 rings spaced 3.5 u in Z, colors
cycling orange/cyan/purple. Spawn triggers: run launch (`_ringSpawnRow(0, near=true)`
→ startZ −15), and end of every endless wave (centered on shipX, startZ −160) unless
next block is a corridor. Fly-through = +1 fuel cell. Wiped on any canyon/corridor
activation (`_ringRemoveAll`).

### 1.13 Power-ups
`POWERUP_TYPES = [shield 0x00f0ff, laser 0xff2200, invincible(OVERDRIVE) 0xffcc00,
magnet 0x44ff88]` (20-main-early.js:11330). Spawned by `spawnObstacles()` in a free
lane at Y 1.4; rate scales with unlocked count; max 2 concurrent (1 if only one type
unlocked). Overdrive multiplies effectiveSpeed and stage-timer dt by 1.8.

---

## 2. Random spawner (`spawnObstacles`, 40-main-late.js:2086)

### 2.1 Cadence (67-main-late.js:6001-6041)
```
nextSpawnZ += effectiveSpeed * dt
if (nextSpawnZ >= 0):
    spawnZBase = fat_cones mode ? -28 : (DR ? -30 : -50)
    if coneDensity == 'ramp':  spawnZBase = -32 + 6 * rampT01     // -32 → -26
    nextSpawnZ = spawnZBase + (rand()-0.5)*10
    spawnObstacles()
```
i.e. one wave every ~30 world units (~26–36 with jitter). Blocked while: zipper
active, corridor/canyon active, slalom active, angled-wall family active, rest beat
> 0, rings active, intro, tutorial, custom pattern, pre-bump-rest drain (last 2 s
of a stage that precedes a bump-rest — 67-main-late.js:5894-5907), post-launch
grace (2 s), `_seqSpawnMode == 'none'`.

### 2.2 Per-wave count by density mode (40-main-late.js:2093-2125)
| `_seqConeDensity` / mode | base obs | maxObs | gapFactor | note |
|---|---|---|---|---|
| sparse | 5 | 7 | 1.0 | |
| dense | 6 | 8 | 1.0 | |
| ramp (S1, endless cones) | 4 | 5 | 1.0 | count steady; cadence ramps instead |
| normal | `7 + floor(tier*0.5)` | +2 | 1.0 | tier = physTier |
| endless | `min(8 + floor(tier*0.8), 12)` | +2 | `max(0.72, 0.88−tier*0.02)` |

`count = obs + (rand < 0.5 + min(score/200,1)*0.3 ? 1 : 0)`, clamped to maxObs.
Spawn-mode overrides: angled → count 6–8 (from `_awRandTuner`); lethal → 3–4;
fat_cones → 4–5; endless-mix → 3–4.

### 2.3 Lane picking
- Predicted ship X: `shipX + shipVelX * (|SPAWN_Z|/speed) * 0.85`, clamped ±8 u
  (±4 at level ≥4) from current shipX.
- Fisher-Yates shuffle 21 lanes; reserve a random adjacent 2-lane gap (always free).
- Min-lane-gap rules: rings/mix ≥4 lanes apart; angled ≥`laneGap`(4); fat ≥5;
  ramp ≥3. Lane world X = `shipX + (lane − 10) * LANE_WIDTH * spreadMul`
  (spreadMul 1.35 for fat cones, else 1.0). X jitter ±0.3.
- Cones skipped if inside a bonus-ring lane (dx < radius+0.8 near ring Z).
- Endless-mix per slot roll: <0.25 lethal ring, <0.5 angled wall (8×4, angle 25–45°),
  else cone (half of them fat 4× scale).

---

## 3. DR sequence (the run script)

`DR_SEQUENCE`, src/67-main-late.js:1319-1405. Speed = multiplier of BASE_SPEED 36.
Monotonic non-decreasing speed AND physTier are hard invariants.
`physTier` drives lateral physics: `_physIdx = min(physTier+1, 6)`,
`MAX_VEL = (13 + (_physIdx/4)² * 23)` at default slider → tier1 12.25, tier2 16.31,
tier3 22.00, tier4 29.31, tier5 38.25 (docs/DR_SEQUENCE.md).

### 3.1 Stage table (33 stages, current code)

| # | name | type | family | dur (s) | speed | physTier | vibe | extras |
|---|---|---|---|---|---|---|---|---|
| 0 | S1_CONES | random_cones | — | 30 | 1.5 | 1 | 0 | density 'ramp' |
| 1 | CA_CANYON | corridor | PRE_T4B_CANYON | ~20 (natural) | 1.8 | 1 | 0 | |
| 2 | CA_REST | rest | — | 3 | 1.8 | 1 | 1 | |
| 3 | S2_FAT_CONES | fat_cones | — | 30 | 1.8 | 2 | 1 | |
| 4 | CB_CANYON | corridor | PRE_T4B_CANYON | ~20 | 2.0 | 2 | 1 | |
| 5 | CB_REST | rest | — | 3 | 2.0 | 2 | 2 | |
| 6 | S3_L3_CORRIDOR | l3_cone_corridor | (knife canyon) | 40 | 2.0 | 2 | 2 | useL3Warp, music 'l4' |
| 7 | CC_REST | rest | — | 3 | 2.0 | 2 | 2 | |
| 8 | S4_WALLS_RAND | angled_walls | — | 30 | 2.0 | 2 | 2 | 15s walls/2s break/13s walls |
| 9 | CD_CANYON | corridor | PRE_T4A_CANYON | ~20 | 2.0 | 2 | 2 | |
| 10 | CD_REST | rest | — | 3 | 2.0 | 2 | 2 | |
| 11 | S5_WALLS_STRUCT | structured_walls | — | 30 | 2.0 | 2 | 2 | burst every 3 s |
| 12 | CE_CANYON | corridor | PRE_T4A_CANYON | ~20 | 2.0 | 2 | 2 | |
| 13 | CE_REST | rest | — | 3 | 2.0 | 2 | 2 | |
| 14 | S6_RINGS | lethal_rings | — | 30 | 2.0 | 2 | 2 | sunOverride 2 |
| 15 | CF_HIGH_WALL | corridor | PRE_T4A_CANYON | ~20 | 2.0 | 2 | 2 | darkSlabs:true |
| 16 | CF_REST | rest | — | 3 | 2.1 | 2 | 3 | music 'keepgoing', klaxon |
| 17 | S7_L4_CORRIDOR | corridor | L4_SINE_CORRIDOR | 518 rows ≈48 s | 2.1 | 2 | 3 | |
| 18 | CG_CANYON | corridor | PRE_T4A_CANYON | ~20 | 2.1 | 3 | 3 | |
| 19 | CG_REST | rest | — | 3 | 2.1 | 3 | 3 | |
| 20 | S8_FAT_CONES | fat_cones | — | 30 | 2.1 | 3 | 3 | |
| 21 | CH_CANYON | corridor | PRE_T4B_CANYON | ~20 | 2.1 | 3 | 3 | |
| 22 | CH_REST | rest | — | 3 | 2.1 | 3 | 3 | |
| 23 | S9_SLALOM | slalom_only | — | 30 | 2.1 | 3 | 3 | gap 10, 16–18 rows/run |
| 24 | CI_CANYON | corridor | PRE_T4A_CANYON | ~20 | 2.1 | 3 | 3 | |
| 25 | CI_REST | rest | — | 3 | 2.2 | 3 | 3 | klaxon |
| 26 | S10_ZIPPER | zipper_only | — | 30 | 2.2 | 3 | 3 | 13-row bursts, re-arm |
| 27 | CJ_CC1_MILD | corridor | PRE_T4B_CANYON | ~20 | 2.2 | 3 | 3 | |
| 28 | CJ_REST | rest | — | 3 | 2.5 | 4 | 4 | klaxon |
| 29 | S11_L5_CORRIDOR | corridor | L5_SINE_CORRIDOR | 60 cap / 420 rows ≈33 s | 2.5 | 4 | 4 | speed floor locks at 2.5 |
| 30 | CK_GATE_CANYON | corridor | PRE_T4A_CANYON | ~20 | 2.5 | 4 | 4 | |
| 31 | CK_REST | rest | — | 3 | 2.5 | 4 | 4 | |
| 32 | ENDLESS | endless_mix | — | ∞ | 2.5 | 5 | 4→rotate | |

Vibes (visual palettes only): 0 NEON DAWN, 1 ULTRAVIOLET, 2 ELECTRIC HORIZON,
3 ICE STORM, 4 VOID SINGULARITY, 5+ rotation set. "Warped era" (sun domain warp)
forced on from S3 onward for sun shaders 0/1/2 (67-main-late.js:1464-1486).

### 3.2 JSON (Unity-ready)

```json
{
  "baseSpeed": 36.0,
  "stages": [
    { "name": "S1_CONES",        "type": "random_cones",     "duration": 30, "speed": 1.5, "physTier": 1, "vibeIdx": 0, "density": "ramp" },
    { "name": "CA_CANYON",       "type": "corridor", "family": "PRE_T4B_CANYON", "speed": 1.8, "physTier": 1, "vibeIdx": 0 },
    { "name": "CA_REST",         "type": "rest",             "duration": 3,  "speed": 1.8, "physTier": 1, "vibeIdx": 1 },
    { "name": "S2_FAT_CONES",    "type": "fat_cones",        "duration": 30, "speed": 1.8, "physTier": 2, "vibeIdx": 1 },
    { "name": "CB_CANYON",       "type": "corridor", "family": "PRE_T4B_CANYON", "speed": 2.0, "physTier": 2, "vibeIdx": 1 },
    { "name": "CB_REST",         "type": "rest",             "duration": 3,  "speed": 2.0, "physTier": 2, "vibeIdx": 2 },
    { "name": "S3_L3_CORRIDOR",  "type": "l3_cone_corridor", "duration": 40, "speed": 2.0, "physTier": 2, "vibeIdx": 2, "useL3Warp": true, "musicTrack": "l4" },
    { "name": "CC_REST",         "type": "rest",             "duration": 3,  "speed": 2.0, "physTier": 2, "vibeIdx": 2 },
    { "name": "S4_WALLS_RAND",   "type": "angled_walls",     "duration": 30, "speed": 2.0, "physTier": 2, "vibeIdx": 2 },
    { "name": "CD_CANYON",       "type": "corridor", "family": "PRE_T4A_CANYON", "speed": 2.0, "physTier": 2, "vibeIdx": 2 },
    { "name": "CD_REST",         "type": "rest",             "duration": 3,  "speed": 2.0, "physTier": 2, "vibeIdx": 2 },
    { "name": "S5_WALLS_STRUCT", "type": "structured_walls", "duration": 30, "speed": 2.0, "physTier": 2, "vibeIdx": 2 },
    { "name": "CE_CANYON",       "type": "corridor", "family": "PRE_T4A_CANYON", "speed": 2.0, "physTier": 2, "vibeIdx": 2 },
    { "name": "CE_REST",         "type": "rest",             "duration": 3,  "speed": 2.0, "physTier": 2, "vibeIdx": 2 },
    { "name": "S6_RINGS",        "type": "lethal_rings",     "duration": 30, "speed": 2.0, "physTier": 2, "vibeIdx": 2, "sunOverride": 2 },
    { "name": "CF_HIGH_WALL",    "type": "corridor", "family": "PRE_T4A_CANYON", "speed": 2.0, "physTier": 2, "vibeIdx": 2, "darkSlabs": true },
    { "name": "CF_REST",         "type": "rest",             "duration": 3,  "speed": 2.1, "physTier": 2, "vibeIdx": 3, "musicTrack": "keepgoing" },
    { "name": "S7_L4_CORRIDOR",  "type": "corridor", "family": "L4_SINE_CORRIDOR", "speed": 2.1, "physTier": 2, "vibeIdx": 3 },
    { "name": "CG_CANYON",       "type": "corridor", "family": "PRE_T4A_CANYON", "speed": 2.1, "physTier": 3, "vibeIdx": 3 },
    { "name": "CG_REST",         "type": "rest",             "duration": 3,  "speed": 2.1, "physTier": 3, "vibeIdx": 3 },
    { "name": "S8_FAT_CONES",    "type": "fat_cones",        "duration": 30, "speed": 2.1, "physTier": 3, "vibeIdx": 3 },
    { "name": "CH_CANYON",       "type": "corridor", "family": "PRE_T4B_CANYON", "speed": 2.1, "physTier": 3, "vibeIdx": 3 },
    { "name": "CH_REST",         "type": "rest",             "duration": 3,  "speed": 2.1, "physTier": 3, "vibeIdx": 3 },
    { "name": "S9_SLALOM",       "type": "slalom_only",      "duration": 30, "speed": 2.1, "physTier": 3, "vibeIdx": 3 },
    { "name": "CI_CANYON",       "type": "corridor", "family": "PRE_T4A_CANYON", "speed": 2.1, "physTier": 3, "vibeIdx": 3 },
    { "name": "CI_REST",         "type": "rest",             "duration": 3,  "speed": 2.2, "physTier": 3, "vibeIdx": 3 },
    { "name": "S10_ZIPPER",      "type": "zipper_only",      "duration": 30, "speed": 2.2, "physTier": 3, "vibeIdx": 3 },
    { "name": "CJ_CC1_MILD",     "type": "corridor", "family": "PRE_T4B_CANYON", "speed": 2.2, "physTier": 3, "vibeIdx": 3 },
    { "name": "CJ_REST",         "type": "rest",             "duration": 3,  "speed": 2.5, "physTier": 4, "vibeIdx": 4 },
    { "name": "S11_L5_CORRIDOR", "type": "corridor", "family": "L5_SINE_CORRIDOR", "duration": 60, "speed": 2.5, "physTier": 4, "vibeIdx": 4 },
    { "name": "CK_GATE_CANYON",  "type": "corridor", "family": "PRE_T4A_CANYON", "speed": 2.5, "physTier": 4, "vibeIdx": 4 },
    { "name": "CK_REST",         "type": "rest",             "duration": 3,  "speed": 2.5, "physTier": 4, "vibeIdx": 4 },
    { "name": "ENDLESS",         "type": "endless_mix",      "speed": 2.5, "physTier": 5, "vibeIdx": 4 }
  ]
}
```

---

## 4. Sequencer logic (`_drSequencerTick`, 67-main-late.js:1408)

Runs every frame. `state.seqStageIdx` / `state.seqStageElapsed`.

### 4.1 Speed writes
- Per-tick STAGE_RAMP: `target = BASE_SPEED * max(stage.speed, _drSpeedFloor)`;
  written only when: no pending bump, not a bump-rest, no canyon active
  (`!l3KnifeCanyon && !preT4ACanyon && !preT4BCanyon`), not invincible, and
  `|speed − target| > 0.5` (67:1445-1461).
- On advance (`_drSeqAdvance`, 67:1901): speed **increase is deferred** — snapshot
  every in-flight hazard uuid; the new speed applies only when all snapshotted
  hazards have despawned (`_drApplyPendingSpeed`, 8 s safety deadline). Decrease or
  equal applies instantly.
- `_drSpeedFloor` ratchet: set 2.5 permanently when L5 corridor activates
  (67:2479); handling-tier "head start" can pre-seed 1.8/2.1/2.3.

### 4.2 Stage advancement
- **rest**: on entry wipe all active cone obstacles; `deathRunRestBeat = 0.5`
  every tick (suppresses spawner). Advance at `elapsed ≥ duration` (3 s).
- **corridor**: on entry set `_seqSpawnMode='none'`, `clearAllCorridorFlags()`,
  `deathRunRestBeat=1.5`, write `state._drStageSpeed = stage.speed`, call
  `family.activate()`, clear `_drStageSpeed`. For `darkSlabs` stages temporarily
  mutate `_PRE_T4A_CANYON_TUNER` (`_allDark=true, darkRgh=0.32, darkEmi=1.4`) and
  restore after activate. Advance when family `isActive()` returns false OR
  `stage.duration` elapses (whichever first).
- **timed stages**: `seqStageElapsed += (invincible ? dt*1.8 : dt)`; advance at
  duration.
- **Pre-canyon quiet window**: for any timed stage whose next stage is a corridor,
  the last **4 s** (`_PRE_CANYON_QUIET_S = 4`, 67:1509) force `_seqSpawnMode='none'`
  / abort zippers / don't start new slaloms — lets in-flight hazards clear before
  canyon walls appear (cones need 144 u / speed to reach the ship).
- **Klaxon countdown**: fires when a rest OR timed stage has 1.5 s left AND the
  next stage's speed is greater: 3 klaxon hits on a 500 ms grid (vol 0.32/0.32/0.36)
  + thruster impact (0.7) at +1500 ms == the speed-change beat. Reset flag on advance.
- On every advance: clear zipper/slalom/walls/rings flags, reset burst counters,
  `_seqSpawnMode='cones'`, `_seqConeDensity='normal'`, restBeat 0.4 s if leaving a
  bump-rest else 0. Music: crossfade if next stage has `musicTrack` (fade 4000 ms
  for 'l4', 2000 ms otherwise).

### 4.3 Per-type behavior deltas (67:1650-1846)
- `random_cones` density 'ramp': `rampT01 = min(1, elapsed/duration)`; row count
  fixed 4–5, cadence −32→−26 u (see §2.1).
- `angled_walls` (S4): spawn mode 'angled' 0–15 s, none 15–17 s (breather),
  'angled' 17–30 s.
- `structured_walls` (S5): every 3 s fire ANGLED_WALL family burst (unless one is
  still active or in quiet window).
- `slalom_only` (S9): re-arm continuously; gap width 10, physics curve, gap starts
  ±18 from ship, `maxRows = 16 + floor(rand*3)`.
- `zipper_only` (S10): re-arm continuously with `zipperRowsLeft = ZIPPER_ROWS` (13).
- `l3_cone_corridor` (S3): fires `_startL3KnifeCanyon()` once; advance on
  `l3KnifeDone` or 40 s. (Legacy fallback: cone corridor, 415 rows.)
- `lethal_rings` / `fat_cones`: just set spawn mode.

### 4.4 Endless mode (`_drEndlessTick`, 67:2184)
- `BLOCK_DURATION = 15 s`, `REST_DURATION = 4 s`.
- Rotation (fixed order, 67:2172): random_cones → angled_random → lethal →
  fat_cones → angled_struct → zipper → slalom → L3_CORRIDOR → L4_SINE_CORRIDOR.
- Corridors gated: only after wave ≥3, and ≥5 waves since the last corridor.
- Per block: RELEASE phase counts 4 s rest, then activates next type
  (`deathRunRestBeat=1.0` at activation). Zipper block: `rows = 18 + floor(rand*6)`.
  Slalom block: gap 9, `rows = 16 + floor(rand*4)`, gap start ±18.
- Block ends at 15 s (or when a non-spawnmode mechanic finishes; L3 knife always
  runs its full 40 s). Then: clear everything, `_seqSpawnMode='none'`,
  `deathRunRestBeat=4.0`, `drWaveCount++`, spawn a bonus-ring row at shipX (unless
  next is corridor), advance vibe: `(endlessVibeIdx+1) % DEATH_RUN_VIBES.length`.
- `random_cones` block mirrors S1 at peak: density 'ramp' with `rampT01=1`.

### 4.5 Vestigial band system
`DR2_RUN_BANDS` (67:1246) still exists: maxTime 30/60/90/∞/∞/∞ labels BAND1..6.
In DR the only live uses: (a) spawn-Z base tweak by band index (§2.1 — band 1 → −30,
band 2 → −22; with sequencer running elapsed puts you at band 3 → −30 for most of a
run); (b) `dummyBand {label:'BAND4'}` passed to family activate (slalom gap 8,
zipper count 14 in the legacy lookup tables — DR stages override these anyway).
**Unity: skip the band system entirely; hardcode the per-stage values above.**

---

## 5. Sine cone-corridors (L3 legacy / L4 / L5)

Shared structure per row (row spacing 7 u, from spawn-cursor reset −7±1):
funnel squeeze → straight → sine sweep with amp/period ramps → exit widen.
`halfX` easing uses smootherstep-ish quad in/out: `ease(t) = t<0.5 ? 2t² : −1+(4−2t)t`.

### L3 (legacy corridor — only if `_L3_KNIFE_ENABLED=false`; 761 rows campaign / 415 DR)
Constants 40-main-late.js:1327-1339: WIDE_X 80, NARROW_X 9, CLOSE_ROWS 40,
STRAIGHT_ROWS 4, AMP_START 10, AMP_MAX 36, AMP_RAMP 200, PERIOD_START 200,
PERIOD_MIN 150, PERIOD_RAMP 300, tint 0x00ffcc.

### L4 sine corridor (S7 — 518 rows ≈ 48 s @ 2.1×)
Constants 40-main-late.js:1342-1351: NARROW_X 6, CLOSE_ROWS 35, STRAIGHT 10,
AMP_START 14, AMP_MAX 44, AMP_RAMP 120, PERIOD_START 220, PERIOD_MIN 160,
PERIOD_RAMP 260, WIDE_X 80, tint 0xff00aa. Exit widen last 20 rows.
`spawnL4CorridorRow()` (40:1771):

```
if rowsDone < 35:            halfX = 80 + (6-80)*ease(rowsDone/35)
else:
    curveRows = max(0, rowsDone - 45)
    squeezeT  = min(1, curveRows/120)
    halfX     = 6 - (6-4.5) * squeezeT²                    // squeezes 6 → 4.5
    if 370 <= curveRows < 395:                              // knife-edge spike
        knifeT = (curveRows-370)/25 ; spike = 1-|knifeT*2-1|
        halfX  = halfX - (halfX-3)*spike                    // dips to 3 at spike peak
if rowsDone >= maxRows-20: halfX += (80-halfX) * min(1,(rowsDone-(maxRows-20))/20)

center = anchor (=shipX at activation)
if rowsDone >= 45:
    ampT   = min(1, curveRows/120);  amp    = 14 + (44-14)*ampT²
    perT   = min(1, curveRows/260);  period = 220 - (220-160)*perT²
    l4SineT += 2π/period
    center = anchor + amp * sin(l4SineT)
cones: inner ± halfX, outer ± (halfX + 3.2), jitter ±0.3, every 7 u of scroll
```

### L5 sine corridor (S11 — 420 rows ≈ 33 s @ 2.5×; stage cap 60 s)
Constants 40-main-late.js:1363-1376: CLOSE_ROWS 29, WIDE_X 64, NARROW_X 10,
STRAIGHT_ROWS 12, TOTAL_ROWS 420, EXIT_ROWS 20, AMP_START 10, AMP_MAX 40,
AMP_RAMP 180, PERIOD_START 200, PERIOD_MIN 140, PERIOD_RAMP 280,
CENTER_CONE_INTERVAL 12, tint 0xffcc00. Same math as L4 with these constants;
squeeze after straight: `halfX = 10 − 2*squeezeT²` (→ 8); **center hazard cone**
spawned dead-center every 12 rows once the sine has started (not in exit rows).

Both anchor `center` on shipX at activation (`_l4CenterAnchor`/`_l5CenterAnchor`),
share `state.corridorGapCenter = center` each row, and end when
`rowsDone ≥ maxRows` (family isActive → false → sequencer advances).

---

## 6. Canyon system (slab corridors)

Mental model: two pools of big slab meshes (left/right walls) scroll +Z and
recycle back-to-front. Corridor centerline & width come from **stateless per-Z
functions**, so a slab bakes its X once (at init or recycle) and never moves
laterally. Kill = ship X-edge past the wall's baked inner edge.

### 6.1 Shared tuner defaults (`_canyonTuner`, 20-main-early.js:9762)

| Key | Default | Meaning |
|---|---|---|
| slabH | 55 | slab height (Y) |
| slabW | 20 | slab length in Z == recycle SPACING |
| slabThick | 60 | slab depth in X |
| cols / rows | 5 / 6 | inner-face subdivision |
| disp | 4.0 | inner-face X jitter |
| snap | 0.7 | vertex quantize divisor (low = jagged knife look) |
| footX / sweepX / midX / crestX | 9 / 4 / 17 / 20 | profile outward X (foot→crest) |
| scrollSpeed | 1.0 | multiplier on world scroll for slabs |
| cyanEmi / cyanRgh | 1.1 / 0.4 | cyan slab material |
| darkRgh / darkClearcoat / darkEmi | 0.22 / 0.40 / 0.9 | dark slab material |
| halfXOverride | 40 | corridor half-width (wall foot at center ± halfX) |
| entranceThick | 450 | entrance slab thickness |
| entranceSlabs | 1 | entrance slab count (hard-clamped ≤1) |
| spawnDepth | −400 | INIT_Z, farthest regular slab at build |
| sineIntensity / sineAmp / sinePeriod / sineSpeed | 0 / 30 / 25 / 1 | canyon sine |
| _allCyan / _allDark | true / (unset) | material mode; both false = alternate by parity |
| _l4Recreation | false | bend slabs along L4 sine instead of canyon sine |
| _l4RampCompress / _l4AmpScale / _l4HalfX / _l4SlabW | 1.45 / 1.0 / 8 / 40 | L4 mode |

Materials: cyan `MeshPhysical(color 0x04d4f0, emissive 0x6ef2ff, flat)`,
dark `MeshPhysical(color 0x080810, emissive 0xff00cc)` (20:10358-10387).

### 6.2 Pool construction (`_createCanyonWalls`, 20-main-early.js:10336)

```
SPACING   = slabW                          // 20 (40 in L3-knife mode)
INIT_Z    = spawnDepth                     // −250 in all game presets
SAFE_Z    = −150                           // nearest allowed init slab
initCount = max(1, floor((SAFE_Z − INIT_Z)/SPACING))          // 5 @ −250
autoPool  = ceil((DESPAWN_Z − INIT_Z)/SPACING) + 2 + entranceSlabs
          // = ceil(256/20)+3 = 16 per side @ −250/20 ; 10 per side @ slabW 40
entranceEnd  = SAFE_Z                       // (entranceSlabs=1)
slab i Z: entrance (i==0):    −500          // ENTRANCE_SPAWN_Z, scrolls in
          regular (i<initCount): entranceEnd − (i − 1 + 1)*SPACING? → −170, −190, …
          overflow:            continue stepping −SPACING behind the last regular
Regular slabs start INVISIBLE and FROZEN; entrance visible, scrolling.
Entrance geometry: thickness entranceThick (700), Z footprint 200 u, X frozen at
its FINAL resting Z (−150), halfX flush with regulars.
Sine phase pre-seeded so sin==0 when ship meets the first regular slab:
  _canyonSinePhase = −(round((3.9 − firstRegularZ)/SPACING) * (2π/sinePeriod) * sineSpeed)
```

**Reveal (entrance choreography):** entrance spawns at Z −500 and scrolls in.
When it reaches **Z ≥ −210** → one-shot `_corridorRevealed = true`: all regular
slabs become visible, sine phase starts advancing, scrolling begins for regulars
(20:10847-10861). Before reveal, only the entrance moves.

### 6.3 Per-frame update (`_updateCanyonWalls`, 20:10756)

```
scroll = max(speed, BASE_SPEED) * dt * scrollSpeed
if sineIntensity>0 and revealed: _canyonSinePhase += (scroll/sinePeriod) * 2π * sineSpeed
if _l4Recreation and revealed:   _l4RowsElapsed   += (scroll/7) * _l4RampCompress
each slab: position.z += scroll
emissive fade-in: fadeT = clamp((z − spawnDepth)/(−80 − spawnDepth)); emissive = base*fadeT
RECYCLE when z > DESPAWN_Z + SPACING (skip while exiting; entrance just hides):
    minZ       = min Z of other non-entrance slabs on this side
    snappedMin = round(minZ/SPACING)*SPACING
    slabZ      = snappedMin − SPACING
    rowsAhead  = max(0, round((3.9 − slabZ)/SPACING))
    center     = _l4Recreation ? _l4SineAtZ(slabZ) : _canyonPredictCenter(rowsAhead)
    halfX      = mode5 ? _canyonHalfXAtZ(slabZ) : halfXOverride
    bakedX     = center + halfX * side          // side: left −1, right +1
    rotation.y = side * atan2(predictCenter(rowsAhead+1) − predictCenter(rowsAhead), SPACING)
    material   = _allCyan ? cyan : _allDark ? dark : (round(−slabZ/SPACING) % 2 == 0 ? cyan : dark)
non-recycled slabs: position.x held at bakedX (never re-evaluated)
EXIT: _canyonActive=false, _canyonExiting=true → slabs drift, no recycle,
      hide past despawn; destroy pool once all gone.
```

### 6.4 Stateless corridor functions (20-main-early.js:10667-10723)

```
// base for all: state.corridorGapCenter (= shipX captured at canyon activation)

_canyonIntensityAtZ(z):
    mode 5:  t = clamp((z − sineStartZ)/(sineFullZ − sineStartZ), 0, 1)   // −150 → −500
             return sineStartI + (sineIntensity − sineStartI)*t
    mode 2:  t = clamp((z + 150)/(−350), 0, 1); return 0.15 + (sineIntensity − 0.15)*t
    else:    return sineIntensity

_canyonHalfXAtZ(z):        // mode 5 only, else halfXOverride
    t = clamp((z − halfXStartZ)/(halfXFullZ − halfXStartZ), 0, 1)         // −150 → −500
    return max(5, halfXStart + (halfXFull − halfXStart)*t)                // 60 → 25

_canyonXAtZ(z):            // used at INIT bake
    ENTRANCE_REF_Z = −150
    phase = ((z − ENTRANCE_REF_Z)/sinePeriod) * 2π * sineSpeed
    return base + sineAmp * _canyonIntensityAtZ(z) * sin(phase)

_canyonPredictCenter(rowsAhead):    // used at RECYCLE bake
    phase   = _canyonSinePhase + rowsAhead * (2π/sinePeriod) * sineSpeed
    approxZ = 3.9 − rowsAhead * SPACING
    return base + sineAmp * _canyonIntensityAtZ(approxZ) * sin(phase)
```

`_l4SineAtZ(z)` (20:10088): maps Z to L4 corridor rows —
`rawRows = max(0,(−150 − z)/7)`, `rows = rawRows*_l4RampCompress + _l4RowsElapsed`,
then applies the exact L4 center formula from §5 (CLOSE 35 + STRAIGHT 10, amp
14→44 over 120, period 220→160 over 260) around `base`, amp × `_l4AmpScale`.

### 6.5 Collision (20:10979-11016)
```
ship: X ± 1.2 (SHIP_HALF_WIDTH), Z 3.9 ± 1.0 ; GRACE = 0.3
for each visible slab overlapping ship Z range [pivot.z, pivot.z + SPACING]:
    right wall: hit if shipX + 1.2 >= bakedX + 0.3
    left  wall: hit if shipX − 1.2 <= bakedX − 0.3
hit → killPlayer()
```

### 6.6 Canyon families (activation presets)

All families: wipe bonus rings, capture `savedSpeed/savedPhysLevel`, reset tuner
to defaults (`_canyonTunerReset`), set `_canyonMode`, `Object.assign` preset,
`_canyonSinePhase=0`, destroy old walls, `corridorGapCenter = shipX`, create walls,
start lightning pattern. Entry ramp: when reveal fires (`Z ≥ −210`), physics snaps
to override level 4 and speed lerps `saved → BASE_SPEED*max(stage.speed, floor)`
over **0.4 s** with ease-out cubic `e = 1−(1−t)³`. Exit: at
`elapsed ≥ DURATION − 4 s` flip to exiting (drift out, stop lightning); at
`DURATION` stop fully and restore saved speed/physLevel.

| | PRE_T4A ("high wall") | PRE_T4B ("CC1 mild") | L3 KNIFE |
|---|---|---|---|
| Source | 40-main-late.js:937/971 | 40:1130/1155 | 40:709 |
| Duration | **20 s** (`_PRE_T4A_DURATION`) | **20 s** | **40 s** (`_L3_KNIFE_DURATION`) |
| Exit window | 4 s | 4 s | 4 s |
| Ramp | 0.4 s | 0.4 s | 0.4 s |
| `_canyonMode` | 5 | 1 | 1 (+ `_l4Recreation=true`) |
| slabH | **190** | 55 | 55 |
| slabW (SPACING) | 20 | 20 | **40** (`_l4SlabW`) |
| slabThick | 60 | 60 | 60 |
| snap | 0.7 | (default 0.7) | oscillates 0.1↔1.5, sine period 4 s: `snap = 0.1 + 1.4*(0.5+0.5*sin(t*2π/4))` |
| footX/sweepX/midX/crestX | 9/4/17/20 | (defaults) | 26/20/0/0 (knife profile) |
| scrollSpeed | **1.5** | 1.0 | 1.0 |
| halfXOverride | 50 (unused; mode-5 taper wins) | **34** | **21.5** (`_l4HalfX`) |
| halfX taper | 60 → 25 over Z −150→−500 (min 5) | flat 34 | flat 21.5 |
| sineIntensity | 0.3, ramp 0 → 0.3 over Z −150→−500 | 0.28 flat | 0.28 (but centerline = `_l4SineAtZ`) |
| sineAmp / period | 120 / 330 | 120 / 330 | 120 / 330 (unused in L4 mode) |
| colors | alternate cyan/dark (CF stage: all-dark, darkRgh 0.32, darkEmi 1.4) | **all cyan** | alternate off (allCyan=false, allDark=false → parity alternate) |
| entrance | thick 700, spawnDepth −250 | thick 700, −250 | thick 700, −250 |
| lightning | frequency 0.3 s, random lanes −8..8, spawnZ −83 | frequency 2.0 s (chill), same otherwise | none |
| disp | 4 | (default 4) | 2 |
| cyanEmi/cyanRgh | 1.1/0.4 | default | 2 / 0.65 |
| darkCrkCount/Bright/Rgh | 6/1/0.22 | default | 14 / 1.95 / 0.62 |

Natural per-stage timeline: ~2 s approach (entrance flies −500→−210 at ~2× speed)
→ reveal + 0.4 s speed ramp → corridor until `DURATION−4` → 4 s drift-out → family
`isActive()` false → sequencer advances to the rest stage.

Other presets (`_CANYON_PRESETS`, 20:9889 — used by dev hotkeys/JL only):
1 `{sineIntensity .28, amp 120, period 330, halfX 34, allCyan}`;
2 `{.47, 146, 530, halfX 34, allDark, darkRgh .32, darkEmi 1.4}`;
3 `{.28, 120, 265, halfX 34, alternate}`;
4 `{sine off, halfX 68, scrollSpeed 2.6, alternate}` (straight fast);
5 = experimental ramp preset (matches T4A fields).

Speed handoff rule: the sequencer writes `state._drStageSpeed = stage.speed`
before `activate()`; families use `BASE_SPEED * max(_drStageSpeed ?? 2.0, _drSpeedFloor)`.

---

## 7. Lake / water — gameplay clarification

**There is no lake gameplay stage.** All "lake" references are an *ambient audio
layer*: `lake-music` (volume 0.28, `TRACK_VOL.lake`, 20-main-early.js:5623) starts
with an 800 ms fade at run start (67:579-593), loops under every music track, and
stops on death/title. The reflective water is the permanent floor of the entire
game (mirror plane at Y 0, forward flow scroll `_waterFlowScale 0.45`); it has no
collision and no bounds — the playfield is bounded only by obstacles and, during
canyons, by slab walls. In Unity: one looping ambient AudioSource + the water
shader everywhere; no lake-specific gameplay logic needed.

---

## 8. Implementation checklist deltas vs docs
- S2 is `fat_cones` (doc said cones_and_zips); the `cones_and_zips` handler still
  exists (escalating zipper bursts 1,2,3… rows with 2 s rests) but is unused.
- PRE_T4A/T4B duration is 20 s (doc "~40 s slab-pool length" is stale).
- Wave-director phase machine (RELEASE/BUILD/PEAK/SUSTAIN/RECOVERY) is dead except
  inside ENDLESS (`drPhase` RELEASE/BUILD only) — do not port the band scheduler.
- Arc families (CORRIDOR_ARC/SLALOM_ARC/ZIPPER_ARC) exist but are unreachable in
  normal play — optional.
- Klaxon/speed-defer/pre-canyon-quiet are the three pacing features that make
  transitions feel right; port all three.
