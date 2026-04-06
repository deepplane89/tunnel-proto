# Jet Horizon — Game & Codebase Continuity Document (v5)
# Paste/upload this file when starting a new chat or Cursor session.

---

## Game Overview

### What Is Jet Horizon?
Jet Horizon is an endless runner web game with a synthwave aesthetic. The player controls a small hovercraft (ship) flying forward over a reflective water grid, dodging procedurally generated obstacles. The game runs entirely in the browser using Three.js for 3D rendering.

### Visual Style
- Dark sky with stars, nebula clouds, and a large retro sun on the horizon
- Neon-lit water floor with grid lines and real-time reflections
- Obstacles are obsidian/black cones with colored neon bands (pink, cyan, gold)
- Corridors are walls of cones forming sine-wave channels the player weaves through
- Bonus rings are Line2 octagon wireframes (orange/cyan/purple cycling colors)
- Lethal rings look identical but red — kill on contact
- Angled walls are glowing neon panels tilted at angles
- Bloom post-processing, speed streaks, and particle effects throughout

### Player Experience Flow
1. **Title Screen** — twinkling starfield background, "JET HORIZON" title, ship preview (swipe left/right to browse skins, tap ship to open shop), TAP TO PLAY button at bottom center
2. **Cinematic Prologue** — text sequence ("ONE RUN STANDS BETWEEN YOU AND PEACE" → "THIS IS THAT RUN" → "JET HORIZON"), engine startup SFX, tap to skip
3. **Gameplay** — ship flies forward automatically, player swipes/arrows left-right to dodge obstacles. Collect coins (gold) and fly through bonus rings (fuel cells). Wave director controls difficulty progression.
4. **Death** — crash SFX, game over screen with score, best score, leaderboard submit, restart button. One-time UPGRADES UNLOCKED banner if player can afford first shop item.
5. **Back to Title** — streak claim (daily login rewards with bezier fly particles), shop access

### Controls
- **Mobile**: Swipe left/right to move ship, tap to start
- **Desktop**: Arrow keys left/right, Space to start
- Ship moves along X axis only. Forward movement is automatic (camera + obstacles scroll toward player).

### Ship & Physics
- Ship sits at Y=0.28 (`_hoverBaseY`), Z=3.9
- Scale: 0.30
- 21 lanes, each 3.2 units wide (~54.4 total road width)
- Ship has velocity-based movement with acceleration/deceleration
- Ship bob animation (configurable frequency, default 0)
- Ship size default: 127% (adjustable via layout tuner)

### Economy & Progression
- **Coins** — collected during runs, spent in shop on skins and upgrades
- **Fuel Cells** — collected from bonus ring fly-throughs, spent on Head Starts
- **XP / Leveling** — earn XP per run, level up unlocks new content
- **Daily Streak** — login streak awards coins and/or fuel cells, with bezier fly animation
- **Skins** — cosmetic ship variants, purchased with coins, browsed on title screen
- **Upgrades** — power-up tier upgrades (handling, XP boost, etc.) in shop
- **Head Start** — spend fuel cells to start a run with a speed/score boost
- **Missions** — in-game objectives for bonus rewards

### Power-ups (collected during gameplay)
- **Shield** — absorbs one hit
- **Laser** — destroys obstacles ahead
- **Magnet** — attracts nearby coins
- **Invincible Speed** — temporary invulnerability + speed boost
- **Score Multiplier** — 2x score for duration

---

## Repo & File Structure

### GitHub
- **Repo**: `deepplane89/tunnel-proto`
- **Deployed**: `tunnel-proto.vercel.app`
- **Other repos**: `jet-slide` (main game), `deathrun` (old DR1 backup), `jet-slide-sandbox`, `Jet-Horizon`

### Files
| File | Lines | Size | Purpose |
|---|---|---|---|
| `game.js` | ~15,750 | 5.4MB | ALL game logic, rendering, UI |
| `style.css` | ~4,260 | ~140KB | All CSS styling |
| `index.html` | ~479 | ~20KB | HTML structure, overlays, HUD |
| `api/analytics.js` | ~60 | — | Vercel serverless: session analytics |
| `api/scores.js` | ~80 | — | Vercel serverless: leaderboard |

### Critical: game.js structure
- **Lines 16-17**: ~4.7MB of base64 GLB model data. NEVER read these lines.
- **Lines 18+**: Actual game code (~636KB)
- Single-file architecture — everything is in game.js

### Code Sections (approximate, use grep to find exact lines)
| Section | What It Contains |
|---|---|
| 1-15 | Imports, Three.js setup |
| 16-17 | Base64 GLB blobs (DO NOT READ) |
| 18-190 | Constants, config, state object |
| 190-340 | State object, game constants |
| 340-620 | Skin system, leveling, upgrades |
| 620-740 | Head start system, missions |
| 740-1120 | Shop, rewards, streak, UI helpers |
| 1120-1280 | Performance mode, title scene, starfield |
| 1280-2000 | Three.js scene setup, sky, camera, post-processing |
| 2000-3700 | Water floor, sun shader, aurora/tendrils, ship loading |
| 3700-4800 | Ship mesh, thruster particles, materials |
| 4800-5600 | Obstacle pool (cones), angled wall pool |
| 5600-6600 | Corridor spawners (L3/L4/L5), slalom, zipper, lethal rings |
| 6600-7400 | spawnObstacles(), coin spawning, power-up spawning |
| 7400-8100 | Title screen UI, shop UI, input handling, debug hotkeys |
| 8100-8900 | Reward wheel (unused but kept), game over, restart |
| 8900-9600 | startGame(), startDeathRun(), vibe definitions, run bands |
| 9600-10100 | DR mechanic families (8 singles + 3 arcs), fly animations, analytics |
| 10100-10600 | Ring tuner, bonus ring system, DR transitions, vibe check |
| 10600-11300 | Head start system, intro/prologue sequence |
| 11300-12600 | Main update loop (animation frame), wave director, collision, movement |
| 12600-13400 | Debug hitboxes, FPS counter, wormhole system + tuner |
| 13400-14400 | Wormhole gameplay (separate mode, hidden behind Shift+W) |
| 14400-15200 | Input handlers (keyboard, touch, resize) |
| 15200-15755 | Admin mode, layout tuner, skin tuner, startup |

---

## Working With This Codebase

### Rules (CRITICAL)
- NEVER read more than 200 lines at a time
- NEVER read lines 16-17 (base64 blobs — will crash context)
- Use `grep` to find line numbers, then `read` narrow ranges
- Use `edit` tool for changes (string replacement, no full file load)
- Syntax check after each edit: `node -c game.js`
- Don't change mesh types or materials without being asked
- Don't revert commits without being explicitly asked
- Hitboxes must match visual mesh precisely
- Ship Y position is 0.28 (`_hoverBaseY`), NOT 1.5

### How to Find Things
```bash
# Find a function
grep -n "function functionName" game.js

# Find a state variable
grep -n "state.variableName" game.js

# Find a section
grep -n "SECTION KEYWORD" game.js

# Read a range (ALWAYS use offset + limit, never full file)
read game.js offset=1234 limit=50
```

### How to Make Changes
```bash
# 1. grep to find exact line content
# 2. Use edit tool with old_string → new_string replacement
# 3. Syntax check: node -c game.js
# 4. Commit + push: git add -A && git commit -m "message" && git push origin main
```

---

## Death Run — Wave Director System

### Single unified mode
- One mode: `state.isDeathRun` (DR2 was merged into DR1, all DR2 code deleted)
- Old approach system deleted (replaced by drPortalSpawn)

### Phase Flow
```
RELEASE (4-7s random cones/obstacles)
  → BUILD (random mechanic family or arc, row-driven duration)
    → PEAK (different mechanic family or arc, row-driven, chance-based)
      → SUSTAIN (2-3s fast cones, no rest beat)
        → RECOVERY (3-5s random cones + rest beat)
          → RELEASE (new cycle, wave count++)
```

### Wave State Variables
- `drPhase` — RELEASE | BUILD | PEAK | SUSTAIN | RECOVERY
- `drPhaseTimer` — seconds in current phase
- `drPhaseDuration` — target duration
- `drWaveCount` — total wave cycles completed
- `drRecentFamilies` — ring buffer of last 3 families (anti-repeat)
- `_arcActive` — true when an arc sequence is running
- `_arcQueue` — array of stages for current arc
- `_arcStage` — current stage index in arc
- `_pendingSpeedTier` — deferred speed tier (applies when mechanic finishes)
- `_pendingVibeIdx` — deferred vibe transition (applies when mechanic finishes)

### Key Functions
- `startDeathRun()` — initializes wave director + all DR state
- `checkDeathRunVibe()` — vibe progression (deferred until safe phase)
- `_applyVibeTransition()` — applies vibe change (visuals, reset wave director)
- `_drPickMechanic(role, bandIdx)` — selects family with recency window (last 3)
- `_drAdvanceArc()` — checks if current arc stage finished, advances to next
- `clearAllCorridorFlags()` — resets all mechanic state
- `_drUpdateDebugHud()` — on-screen debug overlay (toggle with key 9)

### Config
- `DR2_PHASE_DURATIONS` — RELEASE: 4-7s, SUSTAIN: 2-3s, RECOVERY: 3-5s
- `DR2_RUN_BANDS` — 4 time bands controlling difficulty
- `DR_MECHANIC_FAMILIES` — 11 families (8 single + 3 arcs)

### 8 Single Mechanic Families
| Family | Roles | Min Band | Description |
|---|---|---|---|
| CARVED_CORRIDOR | build, peak | 0 | Physics-driven gap corridor, 3 variants (standard/l4/l5) |
| SLALOM | build, peak | 2 | Fat cone walls with a gap that weaves left-right |
| ZIPPER | peak | 1 | Alternating side walls player must zigzag through |
| ANGLED_WALL | build | 1 | Rotated neon wall panels player dodges around |
| CUSTOM_PATTERN | peak | 2 | Hand-authored 106-row alternating cone sequence |
| L3_CORRIDOR | build, peak | 1 | Dense squeeze corridor, band-scaled row count |
| L4_SINE_CORRIDOR | build, peak | 1 | Progressive sine-wave corridor with knife-edge bends |
| L5_SINE_CORRIDOR | peak | 2 | Tightest sine + center hazards, near-campaign length |

### 3 Arc Families (multi-stage sequences, Band 3+)
| Family | Roles | Stages |
|---|---|---|
| CORRIDOR_ARC | build, peak | L3_CORRIDOR → L4_SINE_CORRIDOR → L5_SINE_CORRIDOR |
| SLALOM_ARC | build, peak | SLALOM (gap 14) → SLALOM (gap 10) → SLALOM (gap 7) |
| ZIPPER_ARC | peak | ZIPPER (6 rows) → ZIPPER (10 rows) → ZIPPER (16 rows) |

Arcs always run full sequence. Each stage runs its full row count.
Half-second rest beat between arc stages. `_drAdvanceArc()` handles transitions.
All corridors have opening funnels and exit ramps (last 20 rows widen out).

### Random Obstacle Variety (by band)
During RELEASE/rest phases, the random spawner mixes different shapes:
| Band | Cones | Angled Walls | Lethal Rings |
|---|---|---|---|
| BAND1 | 100% | 0% | 0% |
| BAND2 | 92% | 8% | 0% |
| BAND3+ | 72% | 18% | 10% |

- **Angled walls**: single small wall segments (8×4), random angle
- **Lethal rings**: same Line2 octagon as bonus rings, red (#ff1a1a), kills on contact

### Deferred Transitions
- **Vibe transitions** defer until RELEASE or RECOVERY (no mid-corridor visual wipes)
- **Speed tier changes** defer until RELEASE or RECOVERY (no mid-corridor speed jumps)
- `state.elapsed` resets to 0 when intro/prologue ends

### Run Bands
| Band | Time Range | What Unlocks |
|---|---|---|
| BAND1 | 0 to 8-20s (scales with player level) | Random cones only |
| BAND2 | Band1 end to 90s | +Slalom, Zipper, Angled Wall, L3, L4 corridors |
| BAND3 | 90-180s | +Custom Pattern, L5 corridor, all 3 Arcs |
| BAND4 | 180s+ | All families, near-campaign corridor lengths |

---

## Debug Hotkeys (DR mode only, during gameplay)

### Band / Tier Control
| Key | Action |
|---|---|
| 1 | Force Band 1 (tier 0, elapsed 0) |
| 2 | Force Band 2 (tier 1, elapsed 30s) |
| 3 | Force Band 3 (tier 2, elapsed 100s) |
| 4 | Force Band 4 (tier 3, elapsed 200s) |
| 5 | Force Band 4 extreme (tier 5, elapsed 300s) |

### Phase Control
| Key | Action |
|---|---|
| 6 | Force BUILD on next tick (picks random mechanic) |
| 7 | Force SUSTAIN |
| 8 | Force RECOVERY |

### Force Specific Mechanics
| Key | Action |
|---|---|
| P | Force CUSTOM_PATTERN |
| V | Force CARVED_CORRIDOR |
| L | Force L3_CORRIDOR |
| K | Force L4_SINE_CORRIDOR |
| J | Force L5_SINE_CORRIDOR |
| M | Force SLALOM |
| N | Force ZIPPER |
| B | Force ANGLED_WALL |

### Force Arcs
| Key | Action |
|---|---|
| C | Force CORRIDOR_ARC (L3 → L4 → L5) |
| S | Force SLALOM_ARC (wide → medium → tight) |
| Z | Force ZIPPER_ARC (short → medium → long) |

### Display / Tools
| Key | Action |
|---|---|
| 9 | Toggle debug HUD overlay (phase, band, family, time, tier, wave#, speed) |
| 0 | Toggle hitbox wireframes |
| R | Ring tuner (spawns bonus rings + opens tuner panel) |
| D | Toggle FPS/draw call overlay |

Campaign mode uses 1-5 to skip between levels.

---

## Other Systems

### Bonus Rings
- Spawn during RECOVERY→RELEASE (60%) and after SUSTAIN→RECOVERY (always)
- Settings: R=5.25, W=20, LEN=12, FREQ=3.5, cycling orange/cyan/purple
- Fly-through = +1 fuel cell + ripple shockwave + bezier arc fly animation to HUD

### Lethal Rings
- Same Line2 octagon as bonus rings, red color (#ff1a1a)
- Appear in random gen at Band 3+ (10% chance per obstacle slot)
- Kill on contact (ring body collision)
- Own pool (20), own active list, own update loop

### Title Screen
- Twinkling starfield canvas (340 stars, seeded random, opaque dark background)
- TAP TO PLAY button pinned to bottom center (`position: fixed`)
- Ship tap prompt (pulsing glow + bouncing arrow, first time if player can afford shop item)
- Daily streak claim with bezier fly particles to coin/fuel HUD
- UPGRADES UNLOCKED banner on game over (one-time)

### Music Progression
- Phase 0: bg track (L1) for 45s
- Phase 1: crossfade to l4 (6s fade)

### Cinematic Prologue
- Text sequence → engine SFX → auto-launch at 18.5s (tap to skip)
- `state.elapsed` resets to 0 after prologue ends

### Server-side (needs Upstash env vars on Vercel)
- `api/analytics.js` — POST session data on death, GET last 200 sessions
- `api/scores.js` — leaderboard
- Need to copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from jet-slide Vercel to tunnel-proto Vercel

### Session Analytics
- Every phase transition logged to `_drSessionLog`
- Saves to localStorage on death (last 5 sessions)
- Retrieve: `JSON.parse(localStorage.getItem('dr_session_logs'))`

---

## What's Done
- Wave director system (full DR1/DR2 merge)
- 8 mechanic families + 3 arc families
- Random obstacle variety (angled walls, lethal rings by band)
- Deferred vibe + speed transitions
- Bonus rings + fuel/coin fly animations
- Title screen starfield
- TAP TO PLAY bottom center
- Ship tap prompt for shop
- Streak claim bezier fly animations
- UPGRADES UNLOCKED banner
- Cinematic prologue + audio progression
- Debug hotkeys for all mechanics and arcs
- Dead code cleanup (~500+ lines removed)

## To Do
- Upstash env vars on Vercel (copy from jet-slide)
- Analytics dashboard page
- Ring collection sound replacement
- Fuel cell economy for ship physics tuning
- More custom patterns (only 1 exists)
- More cosmetics
- OG meta tags for link sharing
- Dead code: reward wheel (~295 lines, keeping for future use)

## Future: Progression-Based Obstacle Unlocks (BRAINSTORM — NOT BUILT)

### Concept
Obstacle types unlock permanently based on player achievement (high score or missions). New players only see cones. As they hit milestones, new obstacle types are introduced. Within a run, ALL unlocked obstacle types appear from the start — difficulty comes from speed ramping and spawn density, not time-gating obstacle types.

### Transmission System
When a player unlocks a new obstacle tier, they receive a "transmission" — a one-time cinematic message:
- **Title screen**: text flickers in below the title. Stays until they start the next run.
- **Prologue**: if they skip to playing, the prologue opening text swaps to the warning. Fades into "THIS IS THAT RUN." as normal.
- One-time event per unlock. Normal prologue resumes after.

### Transmission Text (draft)
- Walls unlock: "NEW OBSTACLES DETECTED."
- Rings unlock: "WARNING — THEY'VE DEPLOYED RINGS."
- Fat cones + zipper + slalom: "THE GRID IS ADAPTING."
- Corridors unlock: "THE CORRIDOR HAS OPENED. NO ONE HAS RETURNED."
- Final tier (mix): "ALL DEFENSES ACTIVE. THIS IS YOUR LAST WARNING."

### Unlock Trigger — TBD
- Option A: lifetime high score thresholds
- Option B: missions completed
- Option C: cumulative distance / total runs
- Missions-based avoids high score conflation (harder game = lower scores)

### Leaderboard Fairness — TBD
Players with more obstacles unlocked play a harder game. Score comparison options:
- Separate leaderboards per unlock tier
- Score multiplier that scales with obstacle difficulty (harder = more rewarded)
- Single leaderboard with tier badge (shows what difficulty the score was achieved at)
- Missions-based unlock avoids the problem entirely

### Level Sequencer (REPLACES random wave director for DR mode)

The random band/phase wave director is being replaced with a scripted level sequencer. The mechanic family infrastructure (activate/isActive/spawn) stays — only the random picker and time-band system are replaced.

#### Tier Table (LOCKED IN)

| Tier | Section | Obstacles | Duration | Speed |
|------|---------|-----------|----------|-------|
| 1 | Warm-up | Random cones, sparse | 30s | 1.0x |
| 2 | Ramp-up | Random cones, denser + faster | 30s | 1.2x |
| 3a | Pre-boss | Random cones + zip lines | 30s | 1.35x |
| 3b | **BOSS: L3 Corridor** | L3_CORRIDOR (761 rows) | ~74s (row-based) | 2.0x |
| — | Recovery | Breather, no obstacles | 2s | 1.5x |
| 4a | Angled walls | Random + structured angled walls | 30s | 1.5x |
| 4b | Lethal rings | Lethal rings mixed with angled walls | 35s | 1.85x |
| 4c | **BOSS: L4 Corridor** | L4_SINE_CORRIDOR (518 rows) | ~48s (row-based) | 2.1x |
| — | Recovery | Breather, no obstacles | 2s | 1.85x |
| 5a | Random fat cones | Random fat cone generation | 30s | 1.85x |
| 5b | Slalom + zips | Structured slalom THEN zip lines (sequential, not simultaneous) | 30s | 2.0x |
| 5c | **BOSS: L5 Corridor** | L5_SINE_CORRIDOR (420 rows) | ~33s (row-based) | 2.5x |
| — | Recovery | Breather, no obstacles | 2s | 2.5x |
| 6+ | Endless mix | Everything combined, escalating — existing random picker | ∞ | 2.5x+ |

#### Campaign Corridor Row Counts (CORRECT — DO NOT CHANGE)
- L3: 761 rows (74s at 2.0x speed)
- L4: 518 rows (48s at 2.1x speed)
- L5: 420 rows (33s at 2.5x speed)
- These are calculated from campaign scoring (BASE_SPEED=36, score tick every 0.4s)
- All band scaling removed — corridors always run full campaign length
- CORRIDOR_STRAIGHT_ROWS reduced from 12 to 4 (bends start sooner)

#### Vibe Transitions
- T1-T3a: L1 (NEON DAWN) or L2 (ULTRAVIOLET)
- T3b (L3 boss): L3 (CRIMSON VOID)
- T4a-T4b: L3 visuals persist
- T4c (L4 boss): L4 (ICE STORM)
- T5a-T5b: L4 visuals persist
- T5c (L5 boss): L5 (VOID SINGULARITY)
- Endless: L5 visuals persist

#### Architecture
- `DR_SEQUENCE[]` — const array of stage definitions
- `state.seqStageIdx` — current stage index
- `state.seqStageElapsed` — seconds elapsed in current stage
- `_drSequencerTick(dt)` — runs each frame, advances stages
- Time-based stages advance on elapsed time
- Corridor boss stages activate the family and advance when `isActive()` returns false
- After all stages, fall back to existing `_drPickMechanic()` for endless mix
- Speed set per stage, speed floor ratchet still applies after L5

#### What Stays
- All mechanic family definitions and spawner functions
- Corridor spawn loops in update function
- Random obstacle spawner (nextSpawnZ-based)
- Debug hotkeys (L/K/J/M/N/B force mechanics)
- `_drAdvanceArc()` system

#### What Gets Replaced
- `DR2_RUN_BANDS` time-band system
- `_drPickMechanic()` random picker (only used in endless stage 6+)
- Band-based phase cycling (BUILD/PEAK/RELEASE/RECOVERY)
- `checkDeathRunSpeed()` band-based speed logic → speed from stage definition

### Session Changes (April 3, 2026)

#### Level Sequencer (IMPLEMENTED)
Random wave director replaced with scripted `DR_SEQUENCE` array (14 stages). Old wave director code preserved in `if (false)` block. Sequencer functions:
- `_drSequencerTick(dt)` — runs each frame, handles stage logic
- `_drSeqAdvance()` — cleans up mechanics, advances to next stage
- `_drEndlessTick(dt)` — endless mode fallback using old random picker
- `state.seqStageIdx`, `state.seqStageElapsed`, `state._seqSpawnMode`, `state._seqConeDensity`

Sequencer controls speed per stage (no more `checkDeathRunSpeed()` during sequenced stages). Vibe transitions tied to `vibeIdx` per stage. `checkDeathRunVibe()` and `checkDeathRunSpeed()` only run during endless mode (guarded in `checkLevelUp()`).

Corridor boss stages use visual-only crossfade (`applyDeathRunVibeTransition`) to avoid `clearAllCorridorFlags` killing the active corridor.

Spawner (`spawnObstacles()`) reads `state._seqSpawnMode` to determine obstacle type: `cones`, `angled`, `lethal`, `fat_cones`, `endless`. Density controlled by `state._seqConeDensity` (`sparse`/`dense`/`normal`). Reset to `normal` in `_drSeqAdvance()`.

#### Corridor Row Counts (LOCKED)
- L3: 761 rows (74s at 2.0x) — calculated from campaign scoring
- L4: 518 rows (48s at 2.1x)
- L5: 420 rows (33s at 2.5x)
- Band scaling removed from all three — always full campaign length
- `CORRIDOR_STRAIGHT_ROWS` = 4 (was 12)
- `SKINS` → `SHIP_SKINS` bug fixed in `_canAffordAnyShopItem()` and 2 other functions

#### Sun Shader: L3 Crimson Quilez Warp (IMPLEMENTED)
- New `uIsL3Warp` uniform on both `sunMat` and `sunCapMat`
- Quilez double domain warp with crimson palette (deep red → crimson → hot fire)
- Activates only during T3B_L3BOSS stage via sequencer tick (smooth ramp)
- Same FBM/warp technique as L4 ice and L5 gold branches
- Blend order: plain → UV → L3Warp → ice → gold

#### HUD Ship Shop Button
- `spaceship-shop-icon.png` added to repo (synthwave spaceship, 24x24px in HUD)
- Button `#hud-shop-btn` in title screen HUD row2, after fuel cell with divider
- `onclick` → `openShop()`
- Red notification dot (`has-dot`) when `_canAffordAnyShopItem()` and shop hasn't been opened yet (`state._shopOpened`)
- Smaller 10px dot variant for HUD context (CSS `.hud-shop-btn.has-dot::after`)
- Shop click on title screen isolated to ship canvas + platform pad only (removed from `.ship-showcase-center` container)

#### Landscape Support
- **Gameplay camera**: FOV 49, cameraPivot.Y 2.0 in landscape (line ~14911)
- **Per-frame camera Y bug FIXED**: `camBaseY` in update loop (line ~11747) now reads landscape state instead of hardcoded 2.8
- Game restart calls `updateCameraFOV()` to persist landscape settings
- **Title screen layout tuner** with landscape-aware defaults:
  - Portrait: shipX -1, shipY -14, shipSize 100, platX 1, platY 19, platSize 180, labelX 9, labelY -29, title clamp, titleY 40
  - Landscape: shipX 2, shipY -52, shipSize 177, platX 1, platY 37, platSize 104, labelX 13, labelY -32, titleSize 102px, titleY 87
  - Auto-switches on resize/rotation via `applyDefaults()`
  - Portrait title fontSize restores original inline `clamp(68px,15.3vw,144px)`
- Title ship canvas: landscape CSS restored to 200x180 (was crushed to 80x38)
- Skin nav arrows: `translateY(-15px)` in landscape media query
- Layout tuner activates with 3 taps on skin name (same as before)
- Title Size and Title Y sliders added to layout tuner
- Landscape gameplay tuner (camera FOV/Y sliders) DELETED

#### Deleted Code
- Shop arrow prompt (`_showShopArrow`, `_hideShopArrow`, `_checkShipPrompt`, `_showShipPrompt`) — all deleted
- Landscape gameplay tuner IIFE — deleted
- All `setTimeout` calls to deleted functions cleaned up

#### Bugs Fixed Late in Session
- **L4/L5 corridor double row increment**: `spawnL4CorridorRow()` and `spawnL5CorridorRow()` increment row counter internally, but DR spawn loop was ALSO incrementing — corridors ended at half length. Fixed by removing DR loop increment for L4 and L5. L3 was correct (no external increment).
- **`tp` referenced before declaration**: In `_drSequencerTick`, the vibe transition check used `tp` (a `const` declared later). Changed to `stage.type`.
- **Wobble not firing**: `currentLevelIdx` wasn't set during corridor visual-only vibe transitions (`applyDeathRunVibeTransition` doesn't set it). Wobble requires `currentLevelIdx >= 1`. Fixed by adding `state.currentLevelIdx = toVibe.sunShader` in corridor vibe path.
- **DECEL coupled to physTier**: Higher physTier meant higher DECEL_BASE, killing the icy ship feel. Decoupled: DECEL_BASE fixed at 11.6 (tier-0 value). ACCEL and MAX_VEL still scale with tier. Handling upgrades still control decel via drift.
- **Bob glitch**: `_jumpActive` threshold was 0.02, bob amplitude could exceed it, triggering jump system. Raised to 0.08.
- **`_hoverBaseY` and `_camLookYOffset` used before `let` declaration**: Init code at top of file referenced variables declared later. Fixed by using hardcoded values at init, applying tuner defaults on game start.

#### Ship Flight Tuner (T key during gameplay)
Added to existing T-key panel:
- ship Y (-1.0 to 3.0), ship Z, ship scale
- rotX offset, rotZ offset (layer on top of gameplay animations)
- cam lookY offset, cam pivotY offset, cam pivotZ offset (layer on top of base camera)
- Yaw: `_yawMax=0.06`, `_yawSmoothing=4` (ship nose turns into steering direction)
- Bank: `_bankMax=0.05`, `_bankSmoothing=8` (now tunable, was hardcoded 0.022)
- Wobble: `_wobbleMaxAmp=0.22`, `_wobbleDamping=4` (now tunable)
- Bob: `_bobAmplitude=0.03`, `_bobFrequency=0.60` (was 0/disabled)
- Bob fixed from additive `+=` to absolute offset from `_hoverBaseY`

#### Current Ship Defaults (from tuner screenshot)
- `_hoverBaseY = 1.71` (was 0.28)
- `_bobAmplitude = 0.03`, `_bobFrequency = 0.60`
- `_shipRotXOffset = 0.09` (slight nose-up tilt)
- `_bankMax = 0.05`
- `_camLookYOffset = 0.80`, `_camPivotYOffset = 0.10`
- Init position uses hardcoded 0.28 (can't reference `_hoverBaseY` before declaration)
- Game start / restart applies `_hoverBaseY` and `_camLookYOffset`

#### Escape Key
- Escape now toggles pause (was returning to title screen)

#### Shop
- Ship shop HUD button click area restored on `.ship-showcase-center` (canvas transform broke hit area)
- Ship handling progress bar added to shop (current tier, %, next unlock)
- Platform pad onclick for shop (CSS `pointer-events: none` blocks it though — only canvas click works)

#### Analytics
- Upstash env vars added to Vercel (copied from jet-slide)
- Session data includes `seqStage` and `seqStageIdx` on death
- Each event includes `seq` (stage name)
- `seq_advance` events logged on every stage transition
- Endpoint: `tunnel-proto.vercel.app/api/analytics`

#### Debug Hotkeys (Sequencer)
| Key | Stage |
|-----|-------|
| 1 | T1 Warmup |
| 2 | T2 Ramp-up |
| 3 | T3a Cones + Zips |
| 4 | T3b L3 Corridor Boss |
| 5 | T4a Angled Walls |
| 6 | T4b Lethal Rings |
| 7 | T4c L4 Corridor Boss |
| 8 | T5a Fat Cones |
| Shift+1 | T5b Slalom + Zips |
| Shift+2 | T5c L5 Corridor Boss |
| Shift+3 | Endless Mix |
| 9 | Toggle debug HUD |
| 0 | Toggle hitboxes |
| T | Flight physics tuner |
| L/K/J/M/N/B | Force individual mechanics (still work) |

#### Known Issues / TODO
- Nothing populates after L3 corridor when using hotkeys — needs investigation (may be `_applyVibeTransition` setting `deathRunRestBeat = 2.5` on non-corridor stage entry)
- T2 dense cones were creating impassable walls — reduced to 6 cones, gap 1.0 (may still need tuning)
- L4 debug logging still in code (remove when confirmed working)
- Handling upgrades: ACCEL/MAX_VEL boost with handling tier discussed but NOT implemented (only decel affected by handling)
- Platform pad `pointer-events: none` in CSS conflicts with onclick in HTML

#### Git HEAD
Latest commit should be checked with `git log --oneline -1`

---

### Session Changes (Pre-April 6 — Previously Undocumented)

#### Tutorial System (IMPLEMENTED)
- Fires on first ever run only (`jh_tutorial_done` localStorage flag)
- `state._tutorialActive` set true when flag not present
- **Step 0**: `_tutShowInstructionBox()` full-screen dimmed overlay, tap/Enter to begin
- **Step 0.5**: 6 dodge cones spawn. Tapping moves left/right = pass. Progress tracked via `_tutorialSubStep`
- **Step 1**: instruction box for X-wing zip wall challenge
- **Step 1.5**: zip wall spawns. Player must go perpendicular (up/down) to pass without dying
- **Step 2**: end card "BUILD SHIP XP..." — tap dismisses, plays `droplet.wav`, calls `returnToTitle()`
- **EXIT TUTORIAL** button top-right during action phases
- Success chime: `playSFX(660) → playSFX(880)` on phase completions
- `_tutShowHint()` for in-action hints (X-WING label)
- `_noSpawnMode = true` during tutorial suppresses normal spawner
- Reset tutorial: clear `jh_tutorial_done` from localStorage
- Audio: `droplet.wav` on final banner dismiss

#### DR Hotkeys (updated)
| Key | Action |
|-----|--------|
| 1-8 | Jump to T1–T5A stages |
| 0 | T5C L5BOSS (gold sun) |
| P | ENDLESS |
| L | Laser powerup |
| S | Shield powerup |
| I | Overdrive |
| M | Magnet |
| G / \` / ' | Toggle no-spawn mode |
| 9 | Debug HUD |

#### Laser System (IMPLEMENTED)
- **T1–T3**: dual laser bolts (4 lanes at T3, spread=0.50, Y=-0.25)
- **T4**: static unibeam (Y=1.20, Z=-72), loops `unibeam-sfx.wav`
- **T5**: scanning unibeam ±45°, pivots from ship nose via `laserPivot` Three.js Group
- T1–T3 SFX: `laser-beam.wav` loops for duration
- Layout tuner T-key panel has "T1 BEAM" and "LASER BOLTS (T2+)" sections

#### Music Flow (DR)
- Launch → `spacewalk.mp3` (bg)
- T3B L3BOSS entry → crossfade to `l4music.mp3`
- RECOVERY_2 (after L4 boss) → crossfade to `keep-going.mp3`
- `keep-going.mp3` ends → crossfade back to `l4music.mp3`
- Death → `title.mp3` (Ethereal)
- Pause → `title.mp3` (Ethereal)
- `clearMusicTimers()` cleans all scheduled transitions on death/restart

#### Vibes
| VibeIdx | Name | Sun | Stage |
|---------|------|-----|-------|
| 0 | NEON DAWN | Orange | T1 |
| 1 | ULTRAVIOLET | Violet | T2 |
| 2 | ELECTRIC HORIZON | Orange + teal/magenta warp | T3 |
| 3 | ICE STORM | Cyan/ice | T4 |
| 4 | VOID SINGULARITY | Gold | T5/Endless |

ELECTRIC HORIZON warp colors: dark=(0,0.01,0), mid=(0,1,0.77), bright=(0.83,0.06,0.37)

**DO NOT TOUCH** the ice (T4) or gold (T5) sun warp effects — user has explicitly locked these.

#### JET HORIZON Fix
- `l5CorridorDone = true` set on timer exit to prevent JET HORIZON overlay showing after L5 corridor in DR
- Guarded with `isDeathRun` checks throughout

#### T4B Structure (LOCKED)
- 30s angled walls → 30s lethal rings → 10s angled walls = 70s total

#### Endless Mode Rotation (IMPLEMENTED)
Explicit 9-type rotation, 20s blocks, 3s rest:
1. random_cones → 2. angled_random → 3. lethal → 4. fat_cones → 5. angled_struct → 6. zipper → 7. slalom → 8. L3_CORRIDOR (after 3 waves) → 9. L4_SINE_CORRIDOR

#### Speed Warning Beeps
- 3 ascending beeps 1.5s before each REST stage ends

#### Shop: Triple-Tap Skin Label
- Triple-tap on skin label → unlocks all shop items + 99,999 fuel (admin cheat)

#### Ship Physics (LOCKED — DO NOT TOUCH BANKING)
- `_accelBase = 22`, `_accelSnap = 52`
- ACCEL formula: `(22 + snap*52) * (0.75 + (1-drift)*0.25)` — 75% at stock, 100% at full control
- `_decelBasePct = 0.02` (stock: long slide), `_decelFullPct = 0.05` (full control: brief slide)
- DECEL only applies when NOT steering
- Wobble: `drift * 2.5` multiplier → 0 at full control, 2.5x at stock
- **NEVER touch banking**

#### Portrait Mobile Layout (from screenshot)
- Ship Y=-88, X=-1, Size=100, Plat Y=100, X=1, Size=180, Label Y=-111, X=9, Title Size=100, Title Y=-33

#### Shop Close Behavior
- When on shop detail page, close → back (not title)

---

### Session Changes (April 6, 2026)

#### Title Screen Leaderboard
- Inline leaderboard (`#title-leaderboard`) added to title screen in a previous session
- **Transparency + fade**: `background: rgba(0,0,0,0.25)`, `mask-image: linear-gradient(to bottom, black 60%, transparent 100%)` — opaque at top, fades to transparent at bottom
- **Position**: `top: 68%`, `bottom: 0%` (stretches to bottom edge, mask handles fade)
- **Scrollable**: `overflow-y: auto`, `-webkit-overflow-scrolling: touch`, `pointer-events: auto`
- **Touch guard**: `touchstart/touchmove/touchend` on element call `stopPropagation()` so scrolling doesn't trigger tap-to-play. Guard bound once via `_tlb._scrollGuarded = true` flag inside `fetchLeaderboard()` when phase === 'title'
- **Mobile landscape**: leaderboard hidden via `updateLB()` called inside `applyDefaults()` — players use HUD button instead
- **Portrait / Desktop Y**: 68%
- **Layout tuner**: LB Y slider (`tune-lb-y`, range -200 to 200, default 68) wired via `bind()` → `updateLB()`; `applyDefaults()` calls `updateLB()` on resize/rotate

#### Redis Leaderboard Cleanup
- Spam entries purged from Upstash Redis sorted set key `jet-horizon:scores`
- Removed: TEST_HUGE (9007199254740991), PENTEST_1 (99999), SPAM_TEST (500), EXTRA_FIELDS (200), UNKNOWN (100), TEST_SPECIAL (100), AAAAAAAAAAAA (100), TEST_ZERO (0), and all HTML/injection test strings
- Real scores remaining: Barnes (9885), barnes (4256), Blm (459)
- Cleanup used temporary `?purge=jh2026` GET handler (now removed from `api/scores.js`)

#### Tutorial: Fuel Cell Rings Hidden
- Bonus rings cleared at tutorial start: `if (state._tutorialActive) _ringRemoveAll()` added inside `startGame()` (~line 9815)
- Rings do not re-spawn during tutorial — no auto-spawn triggers fire during tutorial flow

#### Layout Tuner Defaults — Updated
- Portrait: shipX -1, shipY -88, shipSize 100, platX 1, platY 100, platSize 180, labelX 9, labelY -111, titleSize 100, titleY -33
- Landscape: shipX 2, shipY -52, shipSize 300, platX 1, platY 37, platSize 104, labelX 13, labelY -32, titleSize 102, titleY 87
- Desktop: shipX 2, shipY -1, shipSize 239, platX 1, platY -17, platSize 166, labelX 13, labelY -26, titleSize 160, titleY 87
- (Supersedes April 3 session values)

### Lore Direction
- The grid is a system trying to stop the player from reaching "peace" / the other side
- Each obstacle type is a defense layer deployed against the player
- Tiers are escalating responses: sentinels (cones) → barriers (walls) → traps (rings) → the corridor (final containment) → full lockdown (mix)
- The wormhole (Shift+W hidden feature) ties in as the real exit
- Ship skins = salvaged from other pilots who didn't make it
- Daily streak = pilot logging days of attempts
- Transmissions come from someone/something ahead — another pilot? the destination?
