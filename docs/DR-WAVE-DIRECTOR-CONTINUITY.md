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

### Terminology
- **Echos** — the lateral obstacle multipliers. When a mechanic (zipper, slalom, corridor, etc.) spawns a wall of cones, the cones that extend far beyond the playable lane area into the periphery are called echos. They fill the player's side vision so walls look infinite rather than ending abruptly.
- **Repair Ship** — the game-over continue mechanic. When the player dies, a "REPAIR SHIP" button appears on the game-over screen. Costs fuel cells (default 50) to revive and continue the run from where they died. Code uses `saveme` internally (`#saveme-btn`, `state.saveme`, `go-saveme-wrap`). Saves corridor type on death (`state._deathCorridorType`) so the active corridor can restart from scratch after repair.

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

#### Jump Mechanic (QUARANTINED)
- Vertical thrust mechanic: hold Space to fly up, release to fall back to hover height
- Code fully intact — vars, physics block, `triggerJump()` function all preserved
- **Disabled by two commented-out lines** (search `JUMP QUARANTINED`):
  - Keydown: `if (isSpace && phaseAtEvent === 'playing') triggerJump();`
  - Keyup: `if (e.key === ' ') _thrustHeld = false;`
- To restore: uncomment both lines
- Space still works normally for title start / dead restart / unpause

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

### Session Changes (April 7, 2026)

#### DR Sequence — Speed Values (CORRECTED, NEVER DROPS)
Speed never decreases at any point. All recovery stages hold the previous stage's speed:
| Stage | Speed |
|-------|-------|
| T1_WARMUP | 1.0x |
| T2_RAMPUP | 1.2x |
| T3A_ZIPS | 1.35x |
| T3B_L3BOSS | 2.0x |
| RECOVERY_1 | 2.0x |
| T4A_ANGLED | 2.0x |
| T4B_LETHAL | 2.0x |
| T4C_L4BOSS | 2.1x |
| RECOVERY_2 | 2.1x |
| T5A_FATCONES | 2.1x |
| T5B_SLALOM_ZIP | 2.1x |
| T5C_L5BOSS | 2.5x |
| RECOVERY_3 | 2.5x |
| ENDLESS | 2.5x |

#### DR Sequence — T4B Structure (UPDATED)
70s total with breathers:
- 0–15s: random angled walls
- 15–17s: breather
- 17–32s: structured angled walls (burst mechanic)
- 32–34s: breather
- 34–49s: lethal rings
- 49–51s: breather
- 51–66s: lethal rings
- 66–70s: 4s final breather

#### DR Sequence — T4A Structure (UPDATED)
30s with mid-breather:
- 0–15s: random angled walls
- 15–17s: breather
- 17–30s: random angled walls

#### T5B Slalom (UPDATED)
- 0–15s: slalom (no background cones)
- 15–17s: 2s breather
- 17–30s: zip lines
- Gap starts offset ±18 from ship center so player must dodge immediately
- Gap maintains minimum distance of 14 units from ship at all times

#### Double Spawner Bug Fixed (T4A)
- T4A was running both the burst mechanic AND `_seqSpawnMode = 'angled'` simultaneously → double wall density
- Fixed: T4A now only uses `_seqSpawnMode = 'angled'` (spawner only, no burst)

#### Angled Walls — Z Spacing
- `_awTuner.zSpacing = 38` (random walls only)
- Structured walls use burst mechanic separately, not affected by zSpacing
- All `angledWallSpawnZ` inits use `-_awTuner.zSpacing` (was hardcoded `-7`)

#### Spawn from Horizon
- Rings and angled walls now spawn from far horizon (Z = -160 / -60) not close-up (-7)
- Matches cone fade-in behavior

#### Speed Warning Beeps (FIXED)
- Beeps fire 1.5s before ANY stage with a higher speed than the current one
- Were broken because `_restBeepFired` was never reset between stages
- Now reset in `_drSeqAdvance()` and `startDeathRun()`
- Thruster roar fires at speed-up moment (0.25 volume)
- Skip-prologue thruster roar bumped to 0.7 volume

#### Zipper Row Spacing Fix
- In endless, `zipperRowsLeft = 18-23` but formula used `ZIPPER_ROWS=13` as denominator
- `rowsDone` was going negative → first rows spawned slower than intended
- Fixed: `rowsDone = Math.max(0, ZIPPER_ROWS - state.zipperRowsLeft)`

#### Endless Mode (UPDATED)
- Block duration: **15s** (was 20s)
- Breather: **4s** (was 3s)
- `_seqSpawnMode = 'none'` set immediately at block end — clean breather
- Vibe cycles through ALL 16 vibes on each wave via `_applyVibeTransition()`
- `state._endlessVibeIdx` tracks position in cycle, starts at 4 (VOID SINGULARITY)
- `random_cones` → `_seqSpawnMode = 'cones'`
- `angled_random` → `_seqSpawnMode = 'angled'`
- `angled_struct` and `slalom` always run full 15s (added to exclusion list)
- Slalom gets same gap offset fix as T5B (gapX = ±18 from center)

#### Pause Button Fix
- `.touch-pause` z-index raised to 202 (above touch zones at 201)

#### localStorage Fix
- `window._LS` was an in-memory mock — all data lost on refresh
- Now wired to real `localStorage` with try/catch fallback for private/blocked contexts
- All progression (XP, coins, skins, tutorial flag, upgrades) now persists across sessions

#### Distance Tracking (NEW)
- `state.distance` accumulates `effectiveSpeed * dt` every frame while playing
- Resets to 0 on `startDeathRun()` (fresh run)
- **Does NOT reset on repair ship** — distance keeps accumulating as reward for surviving
- Score multiplier on death: every 5,000 distance = +0.1x multiplier
- Shows as "Distance bonus ×X.X" under score on game over screen
- XP bonus: `+1 XP per 100 distance units` on top of score-based XP
- Distance per stage reference:
  - T3B reached: ~9,162 units
  - T4B reached: ~16,506 units
  - Endless entry: ~30,700 units

#### Repair Ship — Score Reset
- Using repair ship (saveme-btn on game over) resets `state.score` and `state.playerScore` to 0
- Disqualifies from leaderboard high score
- Distance does NOT reset

#### Tutorial (OVERHAULED)
Full flow:
1. Tutorial starts → no prologue text → **DODGE** box appears immediately (100ms delay)
2. Tap dismiss → cone spawns at ship X, player taps left/right once → cone flies past naturally
3. **SIGNAL RECEIVED...** flash (white, Knewave font, center screen, fades at 600ms)
4. 2.5s delay → **YOU WON'T SURVIVE** box: "Unless you can adapt. Some walls can't be dodged — they must be threaded. Swipe up to roll."
5. Tap dismiss → player swipes up → ship rolls → signal flash
6. 2.5s delay → **LEVEL OUT** box: "Swipe down to come back flat."
7. Tap dismiss → player must have rolled first, then swipe down → signal flash
8. 2.5s delay → **THREAD THE NEEDLE** box (no body text)
9. Tap dismiss → zip wall comes → player rolls through → signal flash
10. 2.5s delay → **CHASE THE HORIZON** end card: "Collect coins, fuel cells, and level up your ship to push further toward the horizon each run"
11. Tap dismiss → `returnToTitle()`

Key details:
- Prologue suppressed in both `startGame()` and `startDeathRun()` when `_tutorialActive`
- Rings blocked at source: `_ringSpawnRow()` returns immediately if `_tutorialActive`
- Main spawner blocked: `!state._tutorialActive` guard in nextSpawnZ spawner
- Cone flies past naturally after dodge (not immediately removed)
- `_tutWasRolled` flag prevents level-out step firing before player has actually rolled
- Step -1 holding state on init, setTimeout 100ms fires step 0
- All instruction boxes use **Knewave** font (loaded from Google Fonts)
- Knewave font added to `<head>` in index.html
- Settings panel has **TUTORIAL** button — clears `jh_tutorial_done` and calls `startDeathRun()` directly
- `_tutSignal()` function: creates/reuses `#tut-signal-flash` div, z-index 19000
- Signal flash held 600ms then CSS transition fades out (0.15s)
- At 2.5s mark: force `opacity:0` + `transition:none` before showing next box

#### ELECTRIC HORIZON Warp Colors (UPDATED)
- dark=(1,1,1) mid=(0.05,0,0) bright=(0,0,0.08)
- (Was: dark=(0,0.01,0) mid=(0,1,0.77) bright=(0.83,0.06,0.37) — the green one)

#### VOID SINGULARITY Warp Colors (NEW)
- dark=(0.23,1,0) mid=(0,0.14,0.10) bright=(0.13,0.45,0)
- Used for T5/Endless stages

#### Tutorial End Card Text
- **"CHASE THE HORIZON"** — "Collect coins, fuel cells, and level up your ship to push further toward the horizon each run"
- (Was: "BUILD SHIP XP")

#### DR Hotkeys (CURRENT — supersedes all previous)
| Key | Stage/Action |
|-----|-------------|
| 1 | T1_WARMUP |
| 2 | T2_RAMPUP |
| 3 | T3A_ZIPS |
| 4 | T3B_L3BOSS |
| 5 | T4A_ANGLED |
| 6 | T4B_LETHAL |
| 7 | T4C_L4BOSS |
| 8 | T5A_FATCONES |
| Shift+1 | T5B_SLALOM_ZIP |
| Shift+2 | T5C_L5BOSS |
| Shift+3 | ENDLESS |
| 9 | Debug HUD |
| L | Laser powerup |
| S | Shield powerup |
| I | Overdrive |
| M | Magnet |
| G/`/' | Toggle no-spawn mode |

#### Future: Ghost Ships (PLANNED, NOT BUILT)
- Show faded static ships at positions where other leaderboard players' scores were crossed
- Max 3 ghosts: player just above, player just below, own last high score
- Positioned by score — when your current score crosses another player's best, their ghost appears
- Distance tracking is the groundwork for this

---

### Session Changes (April 9, 2026)

#### Wormhole System — REMOVED
- ~1,685 lines of wormhole code deleted from game.js
- All injected guards cleaned: state vars, returnToTitle, keydown handler, touch handlers, render loop, resize handler, wormhole-btn click listener
- `_whWasWormhole` and `state.wormholeActive` removed everywhere
- Wormhole button (`wormhole-btn`) click listener removed
- Dead/restart flow now: `if (state.isDeathRun) startDeathRun(); else startGame()` (no wormhole branch)
- game.js is now **15,937 lines** (was 17,724)
- Quarantine repo: `deepplane89/tunnel-quarantine` (wormhole code archived there)

#### Flow Shield — IMPLEMENTED
- Replaces old `MeshBasicMaterial` sphere + wireframe shield
- Full hex flow `ShaderMaterial` — exact shader from `cortiz2894/flow-shield-effect` repo
- Approach: `bloom.threshold = 1.0`, shield uses `toneMapped: true`, outputs HDR values above 1.0 so it's the only thing that catches bloom
- Sun `emissiveIntensity` bumped from 0.9 → 1.1 to keep blooming at new threshold
- Shield stays in main scene — correct depth testing against walls

#### Shield Shader Uniforms (current defaults)
```
uHexScale: 2.2, uEdgeWidth: 0.10, uHexOpacity: 0.50
uFresnelPower: 1.8, uFresnelStrength: 1.45, uOpacity: 1.09
uFlashSpeed: 1.25, uFlashIntensity: 0.46
uNoiseEdgeIntensity: 7.9, uNoiseEdgeSmoothness: 0.69
uFlowScale: 1.9, uFlowSpeed: 0.25, uFlowIntensity: 1.2
uHitRingSpeed: 5.0, uHitRingWidth: 0.5, uHitMaxRadius: 2.0
uHitDuration: 1.5, uHitIntensity: 20.0, uHitImpactRadius: 1.0
uFadeStart: 0.40, uDisplaceStrength: 0.03
uColor: RGB(0.149, 0.54, 1.0) — blue
uHitColor: RGB(1.0, 0.1, 0.1) — red ripple
```

#### Shield Color System
- T1/T2: blue (`#26aeff` with G=0.54), `uLife` locked at 1.0 (no color shift on damage)
- T3/T4/T5: teal (`#00f0cc`), `uLife` drops on hit → shifts toward pale blue
- Hit ripple ring always flashes red (`uHitColor`) regardless of tier
- Tier colors defined in `shieldTierColors = [0x26aeff, 0x26aeff, 0x00f0cc, 0x00f0cc, 0x00f0cc]`

#### Shield Animations
- **Build-up**: `uReveal` goes 1.0→0.0 over 0.8s (dissolve in)
- **Hit ripple**: `uHitPos` + `uHitTime` trigger expanding ring + vertex displacement wave
- **Vertex displacement**: traveling sine wave on sphere surface, returns to normal after wave passes (`uDisplaceStrength: 0.03`)
- **Death ripple**: on final hit, `state._shieldBreakT = 0` starts — mesh stays visible for 0.6s while ripple plays, then `uReveal` animates 0→1 (dissolve out)
- `shieldWire` hidden permanently — shader handles all visuals

#### Shield Sounds
- **Activate**: `shield-activate.mp3` (plays instead of default pickup tone)
- **Hit**: `shield-hit.mp3` (plays on every hit including final break)
- Original `playPickup()` skipped for shield: `if (def.id !== 'shield') playPickup(typeIdx)`

#### Shield Tuner Sliders
- Full SHIELD section in T-key tuner panel with sliders for all uniforms
- Including: hex scale, edge width, hex opacity, fresnel pwr/str, opacity, flow intens/speed/scale, flash speed/intens, noise edge/smooth, hit ring spd/width/intens/radius/max r/duration, fade start, displace str, color RGB

#### Angled Walls — Z Gap
- `_awTuner.spacingZ = 5` (was 2) — gap between front and back wall within a row
- Random angled walls only; structured walls use burst mechanic

#### Hotkeys Updated (S key guard)
- S key (shield) now requires `state.elapsed > 1.0` before firing to prevent freeze on game start
- Try/catch added around `update()` in game loop to prevent infinite loop on throw

#### Current Git State (April 9)
- Latest commit: `1b0918b` — wormhole cleanup
- game.js: 15,937 lines
- Bloom threshold: 1.0 (was 0.85)

### Session Changes (April 11, 2026)

#### Explosion System Overhaul
- Removed hex shockwave disc (user asked to remove it)
- `_spawnExplosion` — 20k particles with forward + lateral wrap velocity, slo-mo ramp (1x→0.3x→1x)
- `_triggerFaceExplosion` — forward carry (-Z) + lateral, sqrt ease (replaced old cubic)
- Drag grace period so particles don't immediately slow down
- Particles shoot forward around the obstacle like a crash, not spray in all directions

#### Retry / Camera Fixes
- `_retryPending` flag prevents double-tap race condition on fast restart
- `_expCamOrbitActive = false` killed in retry sweep — prevents off-center camera on fast restart
- Saveme/repair snaps camera to center to prevent death orbit drift
- Audited all death→gameplay paths for camera reset issues

#### Audio — New SFX
- `playRetryWhoosh()` (~line 7064) — filtered noise rising whoosh on retry sweep
- `engine-roar` plays at 80% through sweep at volume 0.07 (uses shortened abridged thruster sample)
- `_updateSpeedWind()` (~line 6935) — continuous filtered noise tied to ship speed for speed perception

#### Rock Mound Obstacle System — NEW
- Procedural mountain obstacles using `IcosahedronGeometry(1, 3)` with sin-hash noise displacement
- Y squash 0.6 for mound shape, dark body (`MeshStandardMaterial`, color 0x0e0e14, flatShading)
- **Neon glow edges**: `EdgesGeometry(geo, 30)` (30° threshold — only strong faceted edges)
  - Core edge layer: `LineBasicMaterial`, bright neon color, 0.9 opacity
  - Glow halo layer: second `LineSegments` clone, 1.04x scaled, `AdditiveBlending`, 0.25 opacity — fakes bloom without post-processing
- `_rockTuner` object with: scale (30), xOffset (6), ySink (0.25), neonHex (#00eeff), edgeAlpha (0.9), glowAlpha (0.25), glowScale (1.04), zSpacing (80)
- `_createRockMound(side)` / `_despawnRock(rock)` — spawn/cleanup
- Continuous alternating-side spawning in tutorial (step -0.5)
- Tuner panel on R hotkey: sliders for scale, X offset, Y sink, edge brightness, glow brightness, glow size, Z spacing + neon color picker
- `_applyRockTuner()` live-updates all active rocks

#### Tutorial Changes
- Auto-start disabled (`state._tutorialActive = false` on first game start)
- Access via Settings → "How to Play" which sets tutorial step -0.5 for rock spawning
- Settings-only access while testing rock visuals

#### Current Git State (April 11)
- Latest commit: `d355a74` — neon glow edges on rocks
- game.js: ~17,889 lines
- Cache buster: `game.js?v=2393213321`

#### External Contact
- 3D artist "tkkjee" (Serbian, tkkjee@gmail.com) reached out offering lighting/atmosphere ideas for the game
- User responded "Sure would love to hear it. I've been making it in three JS though."
- Pending their response with specific suggestions

---

### Ship Skins Reference

Skins are defined in the `SHIP_SKINS` array (~line 360). Index matters for code guards.

| Idx | Name | Price | Model | Notes |
|-----|------|-------|-------|-------|
| 0 | RUNNER | 0 | Built-in (procedural) | Default ship. Hex bump shader. |
| 1 | GHOST | 400 | Built-in | Clean glossy white variant |
| 2 | BLACK MAMBA | 800 | Built-in | Stealth predator |
| 3 | CIPHER | 1400 | Built-in | Voronoi hull plating |
| 4 | LOW POLY | 0 | `spaceship_low_poly.glb` | GLB model. Has cone thrusters + heat haze (unique to this skin). `noMiniThrusters: true`, `bloomScale: 0.3`. Hex bump shader. |
| 5 | RUNNER MK II | 0 | `spaceship_01.glb` | GLB model. Has laser bolts. `matchDefault: true` flag. |
| 6 | SCORPION | 0 | `scorpion_ship.glb` | GLB model. `keepMaterials: true`. Hex bump shader. Heavy gunship. |

- `activeSkinIdx` — currently active skin index during gameplay
- `skinViewerIdx` — which skin is being previewed on title screen
- GLB skins use `_altShipActive` / `_altShipModel` for the loaded mesh
- Skins 0-3 are color/material variants of the same procedural mesh
- Skins 4-6 load external GLB files with per-skin `glbConfig` for positioning, rotation, scale, nozzle positions
- Each GLB skin can override `thrusterScale`, `thrusterLength`, `bloomScale`, `noMiniThrusters`

---

### Death → Restart / Repair Ship Transitions

These are the two paths back to gameplay after dying:

#### "Try Again" (Restart)
- Triggered by: restart button on game over screen, OR any canvas tap while `state.phase === 'dead'`
- Flow: `_triggerRetryWithSweep()` → fade to black (0.15s CSS) → during black: full game reset via `startGame()` or `startDeathRun()` → camera placed at establishing shot (`_RETRY_CAM_START` = Vector3(0, 7.5, 16), FOV 85) → fade from black → camera sweeps down to chase cam over 1.3s (`_RETRY_SWEEP_DUR`) with ease-in-out cubic
- `_retrySweepActive` / `_retrySweepT` drive the animation in the render loop (~line 14790)
- `_retryPending` flag prevents double-tap during the fade
- `playRetryWhoosh()` plays during sweep, engine roar at 80% progress
- `state.introActive = true` during sweep to block obstacle spawning

#### "Repair Ship" (Continue)
- Triggered by: saveme button on game over screen (costs fuel cells)
- Flow: fade to black → during black: reset score (NOT distance), clear mechanics, respawn ship at center, apply 3s invincibility → camera placed at same establishing shot as retry → same sweep animation via `_retrySweepActive` → fade from black
- Uses the exact same camera sweep as "Try Again" — identical visual transition
- Code: saveme button handler (~line 14499) sets `_retryPending`, fades, resets state, then starts `_retrySweepActive`
- `state.saveMeCount` tracks how many times used (escalating fuel cost: 50/100/150/200)
- Corridor type saved on death (`state._deathCorridorType`) so active corridor restarts from scratch

#### Game Over Tap Cooldown
- `_gameOverTapReady` flag — starts `false` when game over screen appears
- After the game over screen is shown (post-explosion delay), a 700ms cooldown (`_GO_TAP_COOLDOWN`) starts before `_gameOverTapReady = true`
- Guards on: restart button, exit button, saveme button, AND the canvas touchstart handler
- Prevents accidentally tapping through game over and missing the repair ship option

#### Death Camera Orbit
- On death: camera enters cinematic orbit (`_expCamOrbitActive`) — rises up and orbits laterally around crash site
- `_expCamAnchorX/Y/Z` = camera position at moment of death
- `_expCrashWorldPos` = ship position at crash for lookAt target
- Orbit killed when retry or repair sweep starts

---

### Session Changes (April 12-13, 2026)

#### Thruster Nozzle Auto-Track System
- `_nozzleBaseline` + `_snapshotNozzleBaseline()` (~line 5522): snapshots ship transform when nozzles are configured so auto-tracking can compute deltas
- `_rebuildLocalNozzles()` (~line 5838): converts world-space nozzle offsets to shipGroup local space, applying scale ratio and position deltas from baseline
- Called from `updateCameraFOV()` on orientation change so thrusters follow ship in landscape/portrait

#### Thruster Color Rebalance
- Audited all level thruster colors for luminance vs bloom interaction
- `THRUSTER_COLORS` array (~line 6153):
  - L1: `0x44aaff` — saturated sky-blue (lum 0.61)
  - L2: `0xee00ff` — vivid violet (lum 0.27)
  - L3: `0xff3300` — fire orange-red (lum 0.36)
  - L4: `0x33aaee` — icy cyan-blue (lum 0.59)
  - L5: `0xff9a00` — warm orange-gold (lum 0.65)
- L1 was 0.83 lum and L4 was 0.81 — both were way too hot, rebalanced to 0.27-0.65 range

#### Hex Bump Texture
- `_hexBumpShaderPatch` (~line 5463): applies procedural hex bump normal perturbation to ship materials
- Added to LOW POLY and SCORPION ships (was only on default RUNNER before)

#### Laser Bolt Fix
- Bolts now track `state.shipX` each frame (~line 15241) so they don't bend while strafing

#### Prologue Steering Fix
- `_introBlock` guard (~line 14465): blocks lateral input during `introActive` / `_introLiftActive`
- Prevents ship settings from getting messed up if user holds left/right during liftoff animation

#### LOW POLY Ship Config (CURRENT BAKED DEFAULTS)
```
glbConfig: {
  posX: 0, posY: 0.850, posZ: 3.000,
  rotX: -0.052, rotY: -0.002, rotZ: -0.002,
  scale: 0.248,
  nozzleL: [-0.420, 0.190, 3.440],
  nozzleR: [0.420, 0.170, 3.390],
  miniL: [-0.280, 0.032, 1.550],
  miniR: [0.260, 0.032, 1.550],
  thrusterScale: 0.46,
  thrusterLength: 3.9,
  noMiniThrusters: true,
  bloomScale: 0.3
}
```
- Per-ship `noMiniThrusters` flag hides mini thrusters (poly ship has no mini exhaust ports)
- Per-ship `bloomScale` reduces nozzle bloom sprite size
- Per-ship `thrusterLength` overrides global `window._thrusterLength` for particle velocity

#### Repair Ship Camera Fix
- Originally hard-snapped camera back to chase cam — jarring
- Now uses same fade-to-black + establishing-shot sweep as "Try Again" (reuses `_retrySweepActive`)

#### Thruster Cone Mesh — LOW POLY ONLY
- `_thrusterCones` array (~line 6261): one unit `ConeGeometry` per nozzle with custom `ShaderMaterial`
- **Neon color ramp**: inspired by gameidea.org sci-fi thrust article — `pow(color, 4.0)` stages for hot white core → saturated color → dark tips
- **Noise dissolve**: animated fbm noise eats into the gradient for organic flickering edges
- **Fresnel edge softening**: cone edges fade out so it doesn't look like a hard geometric shape
- Only visible when LOW POLY ship is active (`activeSkinIdx === 4`)
- Positioned at nozzle world position each frame, scaled by thruster power
- Cone visibility guard relaxed — no longer requires `state.phase === 'playing'`, so cones track during liftoff and x-wing banking
- Particles (old thrusters) can be toggled off via `_hideOldThrusters` flag for isolated cone viewing

#### Cone Thruster Defaults (CURRENT BAKED VALUES — user-tuned)
```
window._coneThruster = {
  length: 3.4,          // cone length (world units)
  radius: 0.14,         // base radius at nozzle
  rotX: 1.42,           // rotation around X axis
  rotY: 1.72,           // rotation around Y axis
  rotZ: 0.05,           // rotation around Z axis
  offX: 0, offY: 0, offZ: 0,  // position offsets
  neonPower: 1.5,       // neon ramp intensity exponent
  noiseSpeed: 0.8,      // noise scroll speed
  noiseStrength: 0.13,  // how much noise eats into gradient
  fresnelPower: 6.0,    // edge softening strength
  opacity: 1.0          // master opacity
}
```
- These were tuned by user via slider screenshots across 3 rounds
- rotX/rotY/rotZ and offX/offY/offZ were added because initial cone orientation was wrong

#### Heat Haze Distortion — LOW POLY ONLY
- `_thrusterHazePass`: localized post-process `ShaderPass` added to composer after bloom
- Projects both nozzle positions to screen-space UV each frame
- Applies animated sine distortion (two frequencies) in a soft elliptical radius around each nozzle
- Only enabled when LOW POLY is active + thruster power > 0
- NOT the same as the full-screen `_heatPass` in the weird FX panel — this is localized

#### Heat Haze Defaults (CURRENT BAKED VALUES — user-tuned)
```
uRadius: 0.02          // screen-space radius (was 0.12, tightened dramatically)
uHazeDir: 0.6          // haze direction control
base intensity: 0.10   // was 0.7, reduced to subtle
```
- Original haze was way too strong and global-looking. Tightened radius and intensity.
- `uHazeDir` uniform added so user could control haze stretch direction via slider

#### Tuner Sliders (Nozzle Tuner Panel, ~line 18770)
- **CONE THRUSTER** section (orange header): Cone Length, Cone Radius, Rot X/Y/Z, Offset X/Y/Z, Neon Power, Noise Speed, Noise Strength, Fresnel Power, Cone Opacity
- **HEAT HAZE** section (cyan header): Haze Intensity, Haze Radius, Haze Direction
- "Toggle Old Thrusters" button to hide particle thrusters while tuning cones
- All sliders write to `window._coneThruster` or `_thrusterHazePass.uniforms` for live preview

#### Game Over Tap Cooldown (April 13)
- `_gameOverTapReady` / `_gameOverTapTimer` / `_GO_TAP_COOLDOWN` (700ms)
- Guards on restart-btn, gameover-exit-btn, saveme-btn, AND canvas touchstart handler
- Problem was canvas `touchstart` at ~line 10805 was calling `_triggerRetryWithSweep()` directly when `phase === 'dead'`, bypassing all button cooldowns

#### Repair Ship Smooth Transition (April 13)
- Replaced hard camera snap with fade-to-black + establishing-shot sweep (same as retry)
- Repair ship handler now sets `_retryPending`, fades to black, resets state during black, positions camera at `_RETRY_CAM_START`, starts `_retrySweepActive`, fades from black
- Removed separate `_repairSweep*` system — just reuses the retry sweep

#### Git Corruption & Reclone
- Original `/home/user/workspace/tunnel-proto/` had corrupted .git objects
- Recloned to `/home/user/workspace/tunnel-proto-fresh/`
- **IMPORTANT:** Working directory is now `tunnel-proto-fresh`

#### Current Git State (April 13)
- Latest commit: `adffbaa` — fix: tap cooldown on canvas touch + repair ship uses retry sweep transition
- game.js: ~18,927 lines
- Cache buster: `game.js?v=1776310100`

#### All Commits (April 12-13 Sessions)
1. `6f4b132` — rebuild nozzles on orientation change
2. `98c3f19` — auto-scale thruster nozzles (BROKEN — reverted)
3. `d06515f` — revert msc factor
4. `1abacde` — auto-track thruster nozzles with baseline system
5. `e0342ba` — bake tuned low poly scale 0.244 + nozzle positions
6. `97f4560` — reset camera rotation + lookAt on repair ship resume
7. `fd99d74` — rebalance thruster colors + hex bump on poly & scorpion
8. `daab071` — lock laser bolts to ship X position
9. `c008b40` — block lateral steering during prologue liftoff
10. `5dd665f` — recenter poly ship + nozzles from GLB data
11. `639f1cb` — poly ship: no mini thrusters, reduced bloom, tuner position
12. `689e3e7` — thruster VFX upgrade: neon cone mesh + heat haze distortion + sliders
13. `3802c94` — fix: cone unit geometry + haze tightened + thruster scale sync
14. `d7d7aa` — hotfix: restore ct reference in cone material init
15. `f0499fa` — fix: flip heat haze direction
16. `f379a4f` — add haze direction slider
17. `9e9f983` — add cone rot/offset sliders + haze direction slider
18. `a8065fe` — add Toggle Old Thrusters button
19. `cc1f275` — bake tuned cone + haze defaults from screenshot
20. `cce7b19` — bake final tuned cone/haze defaults + relax cone visibility for liftoff tracking
21. `fb650ba` — smooth repair-ship camera ease-back + game-over tap cooldown (first attempt)
22. `adffbaa` — fix: tap cooldown on canvas touch + repair ship uses retry sweep transition

#### Active Work / Known Issues
- **Mobile thruster positioning**: Desktop-tuned cone/haze values don't translate well to mobile landscape or portrait. Cones may appear offset or mispositioned on smaller viewports. User noticed this but hasn't specified what approach to take yet (separate mobile defaults vs auto-scaling vs mobile sliders).
- **Old thrusters toggled OFF**: User had particle thrusters hidden while tuning cones. May want to permanently replace old particles with cones, or blend them. Decision pending.
- **Cone tracking during liftoff**: Relaxed visibility guard so cones don't require `state.phase === 'playing'`. If cones still drift during animations, may need to parent them to `shipGroup` instead of updating positions in the render loop.
- **Stress testing / dev tools diagnostics**: User expressed interest in building automated viewport testing, skin cycling smoke tests, FPS monitoring, and visual regression tools. Not started yet.

---

### Lore Direction
- The grid is a system trying to stop the player from reaching "peace" / the other side
- Each obstacle type is a defense layer deployed against the player
- Tiers are escalating responses: sentinels (cones) → barriers (walls) → traps (rings) → the corridor (final containment) → full lockdown (mix)
- Ship skins = salvaged from other pilots who didn't make it
- Daily streak = pilot logging days of attempts
- Transmissions come from someone/something ahead — another pilot? the destination?
