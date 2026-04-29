# Gameplay System Audit — 2026-04
**Context:** As of this audit, **DR (Death Run) is the only active mode.** "Main mode IS deathrun." This audit identifies what's load-bearing, what's vestigial, and what should be trimmed/consolidated for rock-solid gameplay.

---

## Surface area at a glance

| File | Lines | Role |
|---|---|---|
| 20-main-early.js | 9328 | State, FOV/camera, ship physics, init |
| 67-main-late.js | 6316 | **Gameplay engine** — DR sequencer, mechanics, spawners |
| 72-main-late-mid.js | 5848 | Tuner UI, macros, JL, settings |
| 60-main-late.js | 899 | Phase/UI transitions |
| 40-main-late.js | 2574 | Spawning utilities, density logic |
| 70-perf-diag.js | 471 | FOV/perf, diagnostics |

**Combined gameplay code: ~25k lines.** Mostly ad-hoc growth, not structured.

---

## A. ACTIVE / LOAD-BEARING SYSTEMS (don't touch)

### 1. DR_SEQUENCE (the new sequencer)
- **Location:** `67-main-late.js:1022` (33 stages, just refactored)
- **Tick:** `_drSequencerTick` at `:1067`
- **Endless tail:** `_drEndlessTick` at `:1661`
- **Status:** ✅ This is the source of truth for mode progression. Recently cleaned up.

### 2. Stage handlers / mechanic spawners
- L3 knife canyon, L4 sine corridor, L5 sine corridor — all called from sequencer
- Cone walls, slalom, zipper, fat cones, lethal rings — `_drPickMechanic` at `:2133`
- **Status:** ✅ Active. Each mechanic has its own `_xActive` state flag.

### 3. Physics tier system
- `physTier` per stage → `state.deathRunSpeedTier` → `_physIdx` lookup → MAX_VEL/ACCEL/DECEL
- Just made monotonic non-decreasing (1, 2, 3 only — no more 0)
- **Status:** ✅ Clean.

### 4. JetLightning (JL) — BREAKOUT mode
- 211 references across files
- Triggered by Konami / dev menu (`_jetLightningMode = true`)
- Has its own physics, visuals, spawner override
- **Status:** ⚠️ Active but isolated. Gates everywhere (`if (state._jetLightningMode) return`). Adds complexity.

### 5. Tutorial
- Triggered from settings only (auto-start disabled per `:729`)
- Standalone state machine
- **Status:** ⚠️ Active but standalone. Bug #4 in todo list: cone corridors bleeding into tutorial.

---

## B. VESTIGIAL / DEAD CODE (kill candidates)

### 1. **Legacy wave director block — 144 lines of dead `if (false)` code**
- **Location:** `67-main-late.js:4901–5044`
- **Status:** Wrapped in `if (false && state.isDeathRun ...) { if (false) { ... } }` — never executes.
- **What it is:** The pre-sequencer band-driven scheduler with Band 4→5→6 corridor arc auto-progression
- **Action:** **DELETE** all 144 lines. Sequencer fully replaced this.

### 2. **`_drForcedBand` / `_drBand4Started` / `_drBand5StartTime` state**
- **Location:** Reset in `:665-667`, branches in `:2685, :2762, :4908-4936, :5274`
- **What it is:** Force-band override mechanism for the dead Band 4→5→6 corridor arc
- **Status:** Only the dead `if (false)` block writes these to non-default values. Reads still happen in live code paths but always evaluate to `< 0` (default).
- **Action:** Remove all reads + writes. Default state is what live code always sees anyway.

### 3. **DR2_RUN_BANDS — partially vestigial**
- **Location:** `67-main-late.js:949` (`DR2_RUN_BANDS_BASE`)
- **What it does NOW:** Wave director eligibility, mechanic spawn density, endless density tuning
- **What it doesn't:** No longer drives speed (DR_SEQUENCE handles speed), no longer drives stage progression
- **73 references** — most still live for density / eligibility lookups
- **Action:** Audit each remaining reference. Keep if it's eligibility/density. Remove if it's progression/speed (already covered by sequencer).

### 4. **BAND_SPEED in `checkDeathRunSpeed`**
- **Location:** `67-main-late.js:2706`
- **What it is:** A second speed lookup table parallel to DR_SEQUENCE's per-stage speeds
- **Status:** Sequencer assigns `state.speed` from stage data; this function is a backup that often gets called and overwritten. Source-of-truth split — see todo #7 (`_setDRSpeed` setter refactor).
- **Action:** Replace with single setter pattern; delete BAND_SPEED.

### 5. **Tutorial auto-start path**
- **Location:** `67-main-late.js:729-737`
- **Status:** Disabled (line says `// disabled auto-start — settings-only access`). The `if (state._tutorialActive)` block at :731 can never fire on startGame because the line above sets it false.
- **Action:** Remove the dead `if` block (3 lines).

### 6. **`l4CorridorDone` / non-DR corridor branches**
- **Location:** `67-main-late.js:5089` (`!state.isDeathRun && ...`)
- **Status:** Code paths that only run in non-DR modes. Since DR is the only mode, dead.
- **Action:** Remove `!state.isDeathRun` branches. ~30+ sites flagged in earlier counts.

### 7. **`_skipL1Intro`, `currentLevelIdx === 0/3` branches**
- **Location:** Throughout `67-main-late.js`
- **Status:** Levels 0/3/etc. are vestigial concepts from before DR became sole mode. `currentLevelIdx` is always 0 in DR.
- **Action:** Audit — if `currentLevelIdx` always = 0 in DR, the `=== 3` checks are dead.

---

## C. STRUCTURAL CONCERNS (refactor targets)

### C1. **~30+ `state.speed = ...` write sites**
- Sequencer writes it, mechanic handlers write it, BAND_SPEED writes it, JL writes it, FOV code reads it.
- **Problem:** No single owner. Bugs hide here.
- **Fix:** Single setter `_setDRSpeed(val, source)` with logging. Reject writes from unknown callers. (Todo #7.)

### C2. **State flags soup**
- 120+ references to gameplay state flags: `corridorMode`, `zipperActive`, `slalomActive`, `angledWallsActive`, `drCustomPatternActive`, `l5EndingActive`, `l5CorridorActive`, `_ringsActive`, `_chaosMode`, `_noSpawnMode`, `introActive`, `_skipL1Intro`, `_retryIsFromDead`, `_awTunerPaused`, `_bonusRings`, etc.
- Many are mutually exclusive but managed independently.
- **Problem:** Defensive `if (!A && !B && !C && ...)` checks litter spawn code (e.g. line 5268 has 11 conjuncts).
- **Fix:** Consolidate into a single `state.gameplayMode = 'idle'|'mechanic_active'|'corridor'|'rest'|'tutorial'|'jl'` enum.

### C3. **JetLightning gates everywhere**
- 211 references; most are `if (state._jetLightningMode) return` or `&& !state._jetLightningMode`.
- **Problem:** Couples JL's existence to every gameplay subsystem.
- **Fix options:**
  - A) Lift JL out into its own update loop (like a separate sub-mode)
  - B) Replace inline gates with `_isMainMode()` helper
  - C) Move JL to its own file behind a feature flag if it's not core

### C4. **Tutorial bleed bug (open todo #4)**
- "Cone corridors bleeding into tutorial mode" → the sequencer's gating likely doesn't correctly exclude tutorial.
- **Probable cause:** Sequencer runs even when `_tutorialActive`, but spawner-side gates rely on per-mechanic checks.
- **Fix:** Sequencer should early-return if `_tutorialActive`.

### C5. **Naming inconsistency**
- "L3 corridor" / "L4 corridor" / "L5 corridor" are vestigial level names baked into stage IDs (S3_L3_CORRIDOR, S7_L4_CORRIDOR, S11_L5_CORRIDOR) — but the L1–L5 level system is dead.
- **Fix:** Rename to descriptive: `S3_KNIFE_CANYON`, `S7_SINE_CORRIDOR_FAST`, `S11_SINE_CORRIDOR_TOP`. Low priority — naming only.

---

## D. TRIM-SAFE QUICK WINS (do first)

Ranked by safety + effort:

| # | Action | Risk | Lines saved | Files |
|---|---|---|---|---|
| 1 | Delete legacy `if (false)` wave director block | None — it's dead | ~144 | 67 |
| 2 | Delete `_drForcedBand` / `_drBand[45]Started` state + reads | Low — defaults are what live code sees | ~15 | 67, 40 |
| 3 | Delete dead tutorial auto-start `if` block | None | ~5 | 67 |
| 4 | Tutorial bleed fix (sequencer early-return) | Low | +2 | 67 |
| **Total quick wins** | | | **~165 LOC removed** | |

---

## E. STRUCTURAL REFACTORS (medium effort, big payoff)

| # | Action | Risk | Effort |
|---|---|---|---|
| 5 | `_setDRSpeed` single setter + DR_SPEED trigger table (todo #7) | Med — touches every speed write site | 1-2hr |
| 6 | Audit + consolidate DR2_RUN_BANDS (todo #8) — keep eligibility/density, kill speed/progression usage | Med | 1hr |
| 7 | Replace 11-conjunct spawn gate with `gameplayMode` enum | Med — many call sites | 2-3hr |
| 8 | JL: lift to subsystem with single `_isMainMode()` gate | High — 211 refs | 3-4hr |

---

## F. TIER 3 (POLISH / OPTIONAL)

- Rename L3/L4/L5 stage IDs to descriptive names (cosmetic)
- Move JL to its own file
- Document state flag invariants

---

## RECOMMENDED EXECUTION ORDER

**Pass 1: Quick wins (D1–D4) — ~165 LOC deleted**
- Pure cleanup. No behavior change. Safe to ship.

**Pass 2: BAND_SPEED kill + `_setDRSpeed` setter (E5)**
- Fixes todo #7 (single source of truth for speed).
- Probably surfaces bugs that are masked today by parallel writes.

**Pass 3: DR2_RUN_BANDS audit (E6)**
- Fixes todo #8 (unclear what bands still drive).
- Probably another ~50–100 LOC removed.

**Pass 4: state-flags consolidation (E7)** — only if Passes 1–3 reveal it's still needed.

**Pass 5+: JL refactor / naming / etc.** — only if user prioritizes.

---

## OPEN QUESTIONS FOR USER

1. **Is JetLightning being kept as a feature?** If yes, structural refactor (E8). If it's a dev/easter egg, leave it gated as-is.
2. **Is tutorial being kept?** If settings-only and rarely used, keep but fix bleed bug (D4). If dead, full removal saves more.
3. **Is `currentLevelIdx` referenced anywhere meaningful in DR?** If always 0, all `=== 3` / `=== 0` branches are dead.
4. **Endless tail (`_drEndlessTick`) — actively played?** If yes, keep. If not, simplify.

---

## CITATIONS / FILE LOCATIONS

- DR_SEQUENCE: `src/67-main-late.js:1022`
- _drSequencerTick: `src/67-main-late.js:1067`
- Legacy wave director (DEAD): `src/67-main-late.js:4901-5044`
- BAND_SPEED: `src/67-main-late.js:2706`
- DR2_RUN_BANDS_BASE: `src/67-main-late.js:949`
- _drForcedBand resets: `src/67-main-late.js:665-667`
- Tutorial auto-start (DEAD branch): `src/67-main-late.js:729-737`
- JetLightning state: `src/20-main-early.js:162`
