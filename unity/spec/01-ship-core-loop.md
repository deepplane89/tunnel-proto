# Jet Horizon — Ship, Core Loop & Game Flow Spec (for Unity reimplementation)

Extracted from the three.js source (`src/*.js`, concatenated build order = numeric prefix).
All line refs are `file:line` in `/Users/robertc/Developer/tunnel-proto/src/`.

---

## 0. World Scale & Conventions

| Convention | Value | Source |
|---|---|---|
| Axes | **X = lateral, Y = vertical, Z = forward/back.** World is ship-static: the SHIP stays at fixed Z; the WORLD (obstacles, coins, canyon) moves **toward +Z** at `state.speed`. Obstacles spawn at negative Z and despawn behind the ship at positive Z. | docs/CONTINUITY.md:412, update loop |
| Units | Arbitrary "world units" (u). 1 u ≈ 1 m feel. Speed in u/s. | — |
| Ship world position | `shipGroup.position = (state.shipX, hoverY, 3.9)`. **Z = 3.9 is set once at init and never changes.** Init Y = 0.28 (pre-launch), gameplay hover Y = `_hoverBaseY = 1.21`. | 20:5996, 67:234, 20:8375 |
| Ship visual scale | `shipGroup.scale = 0.30` (desktop & mobile portrait), `0.40` (mobile landscape). | 20:5997, 72:19, 72:29 |
| Floor | The floor is **WATER** (reflective plane), not a grid. Water plane 1400×700 at Y≈0 (wake rings at Y=-0.10). Water X tracks `state.shipX` every frame. | CONTINUITY.md:413, 20:2758, 70:557 |
| Camera FOV clip | PerspectiveCamera(65°, aspect, near 0.1, far 600). | 20:1813 |
| Play corridor | `LANE_COUNT = 21`, `LANE_WIDTH = 3.2`, `TOTAL_ROAD_WIDTH ≈ 67.2` (comment says ~54.4 but 21×3.2=67.2 — code value wins). No hard lateral clamp on shipX in the movement code; lanes only bound spawning. | 20:214-216 |
| Spawn / despawn Z | `SPAWN_Z = -160` (spawn deep at horizon), `DESPAWN_Z = +6` (behind ship). | 20:222-223 |
| Ship collision half width | `SHIP_HALF_WIDTH = 1.2` (used for gauntlet rings), obstacle collision uses WING_HALF/BODY_HALF below. `OBSTACLE_HALF = 0.9`. | 20:218-219 |

---

## 1. Ship Lateral Movement (the core feel)

All in `update(dt)` at 67:4380-4429. Runs at **fixed dt = 1/60**.

### 1.1 Input mapping

| Input | Effect | Source |
|---|---|---|
| Keyboard `ArrowLeft`/`a`/`A`, `ArrowRight`/`d`/`D` | steerLeft / steerRight booleans (digital, no analog) | 67:4383-4384 |
| Touch | Screen split into two zones (`touch-left`, `touch-right` DOM). **Hold finger in zone = steer that direction** (digital). Release = stop steering. | 60:852-965 |
| Touch swipe up in a zone (≥14 px vertical) | Roll toggle ON. Left zone → roll dir −1 ("rollUp"), right zone → roll dir +1 ("rollDown"). **Persists after finger lift**; swipe DOWN (≥14 px) cancels roll. | 60:854, 60:905-947 |
| Keyboard `ArrowUp` / `ArrowDown` (held) | rollHeld with dir −1 / +1; releases on keyup. | 60:588-589, 60:845 |
| No gyroscope steering (comment only), no analog steering anywhere. | | 67:4366 |

### 1.2 Lateral physics constants

Physics feel is **LOCKED constant across all levels** — difficulty comes from forward speed only.
`_snap = 0.5625` always (an "L4-equivalent" fixed baseline; level index no longer affects it). 67:4390-4396.

Base tunables (PROD shipping values — set by the startGame wrapper for every non-tutorial run, 72:2856-2864):

| Name | Value | Meaning | Source |
|---|---|---|---|
| `_accelBase` | 22 | lateral accel at snap=0 | 72:2858 (prod), 20:683 |
| `_accelSnap` | 52 | extra accel at snap=1 | 72:2859 |
| `_maxVelBase` | 9 | lateral vel cap at snap=0 | 72:2860 |
| `_maxVelSnap` | 13 | extra cap at snap=1 | 72:2861 |
| `_decelBasePct` | 0.02 | decel fraction (stock) | 20:687 |
| `_decelFullPct` | 0.05 | decel fraction (full handling) | 20:688 |
| `_snap` | 0.5625 | locked physics-level blend | 67:4396 |
| `getHandlingDrift()` | **1.0** always in prod (no flight-model override) | 20:694-701 |

**Tutorial** uses preset `JL_v1`: accelBase 60, accelSnap 100, maxVelBase 18, maxVelSnap 23 (20:656-667, applied 72:2846-2853). Dev builds with FLIGHT MODEL presets re-base to 60/100/13/23 × macro multipliers (78:820-840) — see §1.8.

### 1.3 Per-frame derived values (67:4402-4406)

```
ACCEL      = (_accelBase + _snap * _accelSnap) * (0.75 + (1 - drift) * 0.25)
           = (22 + 0.5625*52) * 0.75 = 51.25 * 0.75 = 38.44 u/s²   (prod, drift=1.0)
DECEL_BASE = 10 + _snap * 26 = 24.625
DECEL      = DECEL_BASE * (_decelBasePct + (1-drift)*(_decelFullPct-_decelBasePct))
           = 24.625 * 0.02 = 0.4925 /s   (prod)   ← very long glide
MAX_VEL    = _maxVelBase + _snap * _maxVelSnap = 9 + 7.3125 = 16.31 u/s
```

### 1.4 Integration (67:4420-4429)

```
counterSteer = (steerLeft && velX > 0) || (steerRight && velX < 0)
csBoost      = counterSteer ? 3.0 : 1.0            // direction reversal is 3x faster

if steerLeft:        velX -= ACCEL * csBoost * tiltFactor * dt
else if steerRight:  velX += ACCEL * csBoost * tiltFactor * dt
else:                velX *= max(0, 1 - DECEL * dt)    // exponential slide, only when idle

velX  = clamp(velX, -MAX_VEL*tiltFactor, +MAX_VEL*tiltFactor)
shipX += velX * dt
shipGroup.position.x = shipX (+ optional turbulence nudge, _turbulence = 0 in prod)  // 67:5023-5024
```

### 1.5 Roll / knife-edge tilt penalty (67:4408-4418)

```
TILT_GRACE = 2.0 s
if |rollAngle| > 0.1: tiltTimer = min(tiltTimer + dt, TILT_GRACE + 1)
else:                 tiltTimer = max(0, tiltTimer - dt*3)      // fast reset
penaltyT    = clamp01(tiltTimer - TILT_GRACE)                    // ramps 0→1 over 1s after grace
tiltPenalty = 0.35 + 0.65 * cos(rollAngle)                       // 1.0 upright → 0.35 at 90°
tiltFactor  = 1 - penaltyT * (1 - tiltPenalty)                   // multiplies ACCEL and MAX_VEL
```

### 1.6 Banking / roll visual (67:4649-4718)

```
// smoothed bank-velocity tracker
if steering:
    if steering direction opposes _bankVelX sign: _bankVelX = 0     // never dip wrong way
    _bankVelX += (velX - _bankVelX) * min(1, 20 * dt)
else:
    _bankVelX *= max(0, 1 - _bankReturnRate * dt)                   // _bankReturnRate = 12

velNorm    = clamp(_bankVelX / (MAX_VEL*tiltFactor), -1, 1)
targetRoll = -velNorm * _steerBankRadMax + overshootPos             // _steerBankRadMax = 0.52 rad (~30°) HARD cap
                                                                     // overshoot disabled in current build (amt=0)
lerpSpeed  = (steering ? _bankSmoothing : _bankReturnSmoothing)     // both = 8
             * (crossingZero ? 3 : 1)                               // 3x when bank crosses 0
shipGroup.rotation.z = lerp(rotation.z, targetRoll + _shipRotZOffset, min(1, lerpSpeed*dt))
clamp rotation.z to ±(_steerBankRadMax * 1.15 + wobbleAmp)
```

Wobble/overshoot ("JUICE") is **hard-disabled** as of 2026-06-15: `_wobbleMaxAmp = 0`, `_overshootAmt = 0`, `_wobbleDamping = 20`, `getHandlingJuice() → 0` (20:8465-8470, 20:753-763). Legacy values if re-enabled: wobbleMaxAmp 0.116, damping 6.16, overshoot 0.32, wobble oscillation `wobblePhase += dt*16`, decay `wobbleAmp *= (1 - dt*damping)`, trigger threshold |velX| > 4 on steer-release.

**Hold-to-spin knife-edge roll** (67:5038-5057):

```
SPIN_SPEED   = (1.2 + _snap*2.3) * PI  = 2.494*PI ≈ 7.83 rad/s (~449°/s at snap 0.5625)
RETURN_SPEED = SPIN_SPEED * 1.5
MAX_ANGLE    = PI/2  (±90°, knife edge)
held: rollAngle += rollDir * SPIN_SPEED * dt, clamped ±90°
released: return toward 0 at RETURN_SPEED, stop exactly at 0 (no overshoot)
While rolling: shipGroup.rotation.z = rollAngle directly; cameraRoll = 0 (horizon stays flat).
```

### 1.7 Yaw & pitch (visual only)

```
// Yaw — nose into turn (67:5017-5020)
_yawMax = 0.01 rad, _yawSmoothing = 12
yawTarget = -velX / 14 * _yawMax
_yawSmooth += (yawTarget - _yawSmooth) * min(1, dt * 12);  rotation.y = _yawSmooth

// Pitch — nose dips on accel / lifts on decel (67:4850-4861, 4950-4956)
_pitchForwardMax = 0.15 rad, _pitchBackMax = 0.08 rad, _pitchSmoothing = 5
speedDelta = (speed - prevSpeed)/dt
targetPitch = speedDelta > 0.5 ? -0.15 * min(1, speedDelta/50)
            : speedDelta < -0.5 ?  0.08 * min(1, |speedDelta|/50) : 0
_pitchSmooth += (targetPitch - _pitchSmooth) * min(1, dt*5)
rotation.x = _pitchSmooth + _shipRotXOffset       // _shipRotXOffset = 0.02
```

### 1.8 Vertical movement

The space-bar jump is **QUARANTINED** (commented out; `_thrustHeld` never set true — 60:563, 60:843). The vertical thrust block still runs each frame but only enforces hover. Constants if re-enabling jump: `_thrustPower 18.0, _thrustGravity 2.0, _fallSpeed 20.0, _thrustMaxHeight 3.0, _thrustDamping 0.92/frame@60, _jumpThrusterFlare 2.0, _jumpLandingBounce 0.3` (20:8384-8393).

**Hover bob** (67:4978-4993): when grounded,
```
_bobAmplitude = 0.03, _bobFrequency = 0.60 Hz
bobSteerBlend fades to 0 while |velX|>0.5 (rate 4/s out, 2/s in)
position.y = _hoverBaseY(1.21) + sin(time * 0.6 * 2π) * 0.03 * bobBlend * bobSteerBlend
Pre-launch / prologue: position.y pinned to 0.38.
```

**Intro takeoff lift** (67:4995-5015): 2.0 s, Y: 0.38 → 1.21 with cubic ease-out `1-(1-t)^3`; pitch arc peak −0.18 rad (nose up) using `sin(pitchT*π/2)` triangle over the lift.

### 1.9 Flight-model macro system (dev-only, document for parity)

Macros map [0..1] → multipliers around a 60/100/13/23 baseline (78:801-899):
`k(m) = lowMul + (1-lowMul)*(m/0.5)` for m≤0.5, else `1 + (highMul-1)*((m-0.5)/0.5)`.
- RESP (low 0.4, high 1.6): accelBase=60k, accelSnap=100k, bankSmoothing=8k, pitchSmoothing=5k, yawSmoothing=12k
- LATSPD (0.4..1.6): maxVelBase=13k, maxVelSnap=23k
- SETTLE (0.4..2.0): decelBasePct=0.02k, decelFullPct=0.05k, bankReturnSmoothing=8k, bankReturnRate=12k, overshootDamp=6k
- BANK: steerBankRadMax = lerp3(m, 0.35, 0.52, 0.79) rad
- HORIZON: camRollAmt = lerp3(m, 0.0, 0.4, 0.64)
- Presets (78:933-939): DEFAULT(.50/.50/.50/.50/.50), GLIDE(.50/.30/.50/.20/.40), JET(.65/.46/.82/1.0/.50), RAIL(.70/.45/.80/.30/.10), WIPEOUT(.55/.90/.45/.85/.60). Unlock levels 1/4/20/14/8 (20:790-796).

---

## 2. Forward Speed System

### 2.1 Meaning of variables

- `BASE_SPEED = 36` u/s (20:154). All speeds are expressed as **multipliers** of this.
- `state.speed` = current forward world-scroll speed (u/s). ONLY written via `_setDRSpeed(value, trigger)` (20:199-211).
- `effectiveSpeed = state.speed * (invincibleSpeedActive ? 1.8 : 1.0)` — overdrive powerup multiplies world speed by 1.8 (67:4376-4378). Everything that moves the world uses `effectiveSpeed`.
- `lt`/`_lt` in code = local shorthand for `laserTier` or lightning — NOT a speed variable.

### 2.2 Run-start speeds

| Situation | Speed | Source |
|---|---|---|
| state init / startGame | `BASE_SPEED` (1.0×) | 67:223 |
| Death-run prologue (idle before launch) | `BASE_SPEED * 0.35` | 67:1001 |
| DR launch | `BASE_SPEED * max(LEVELS[vibe.speedTier].speedMult, handlingStartBoost)` — canonical S1 = **1.5×** | 67:1148-1162 |
| Handling start-boost floor (equipped tier) | tier 0→1.00, 1→1.80, 2→2.10, 3→2.15, 4→2.20, 5→2.25, 6→2.30 (unlock at player level 1/2/3/5/8/14/22) | 20:629-637 |

### 2.3 Campaign (legacy level table) speed formula (40:2484-2503)

```
newIdx = highest level whose scoreThreshold <= state.score
continuousBoost = min(state.score / 180, 0.6)          // up to +60%
finalMult = max(LEVELS[newIdx].speedMult + continuousBoost, handlingStartBoost)
if not in a corridor: speed = BASE_SPEED * finalMult    // trigger 'LEGACY_LEVEL'
```

LEVELS table (20:100-148):

| idx | Name | scoreThreshold | speedMult | obstaclesPerSpawn | max | gapFactor |
|---|---|---|---|---|---|---|
| 0 | NEON DAWN | 0 | 1.00 | 6 | 8 | 1.00 |
| 1 | ULTRAVIOLET | 150 | 1.20 | 8 | 10 | 0.90 |
| 2 | CRIMSON VOID | 300 | 1.35 | 10 | 13 | 0.82 |
| 3 | ICE STORM | 490 | 1.50 | 9 | 11 | 0.88 |
| 4 | VOID SINGULARITY | 675 | 1.85 | 9 | 11 | 0.88 |

Natural campaign ceiling ≈ 1.85 + 0.6 = **2.45×** (88.2 u/s).

### 2.4 Death Run (main mode) speed ladder — DR_SEQUENCE (67:1319-1405)

Speed only ever goes UP; bumps happen only at canyon transitions. Multiplier ladder:
```
S1 1.5 → CA 1.8 → S2 1.8 → CB 2.0 → S3..CF 2.0 → CF_REST 2.1 → S7..CI 2.1
→ CI_REST 2.2 → S10/CJ 2.2 → CJ_REST 2.5 → S11/CK/ENDLESS 2.5
```
Top speed = 2.5 × 36 = **90 u/s**. `physTier` (1→5 over the run) feeds `deathRunSpeedTier`, but note lateral physics ignore it (locked `_snap`). `_drSpeedFloor` ratchet: speed never drops below equipped handling boost or L5-corridor lock.

### 2.5 Score↔speed coupling

Score tick multiplier `max(1, speed/BASE_SPEED)` — faster ship = faster score (67:5089-5090, 5131).

---

## 3. Camera

### 3.1 Rig

`cameraPivot` (Object3D) carries world position; `camera` is its child at local (0,0,0); roll applied to `camera.rotation.z`. (20:1969-1975)

| Param | Desktop | Mobile landscape | Mobile portrait | Source |
|---|---|---|---|---|
| `_baseFOV` | 65 + `_camFOVOffset`(13) = **78** | **60** | **79** | 72:13-35, 20:8493-8494 |
| `_camPivotYOffset` | 0.10 (baked) | 0.90 | 0.00 | 20:8489, 72:17, 72:27 |
| `_camPivotZOffset` | −1.50 | −0.80 | −1.80 | 72:35, 72:18, 72:28 |
| camBaseY (in update) | 2.8 | 2.0 | 2.8 | 67:4589 |
| lookAt (pivot-local) | (0, −2.8+lookY, −50+lookZ); lookY=−5.00 all; lookZ = 30.50 desktop / 2.00 landscape / 0.50 portrait → (0,−7.8,−19.5) desktop, (0,−7.8,−48) landscape, (0,−7.8,−49.5) portrait | | | 20:8491-8492, 72:15-16, 25-26, 47 |

Per-frame gameplay follow (67:4586-4594):
```
pivot.x = shipX                    // NO lateral lag — instant follow
shipAlt = shipY - 1.21
pivot.y = lerp(pivot.y, camBaseY + camPivotYOffset + shipAlt * 0.35, 6*dt)   // _camYFollow = 0.35
pivot.z = 9 + camPivotZOffset      // desktop 7.5
camera.rotation.z = cameraRoll     // = shipBankPure * _camRollAmt (0.4 default) — horizon tilts with steering bank, NOT with knife-edge roll
```

### 3.2 FOV speed kick (70:504-534, runs on variable rawDt AFTER fixed updates)

```
_fovSpeedBoost = 32°
frac = clamp01((speed - 36) / (36*1.5))          // 0 at 1.0x, 1 at 2.5x
speedFrac = phase=='playing' ? frac^1.4 : 0
targetFOV = baseFOV + 32 * speedFrac  (+ deathZoom override)
lerpRate = launch(<0.5s elapsed) ? 12 : deathZoom ? 0.8 : (fovDiff>0.5 ? 5 : 3)
camera.fov = lerp(fov, targetFOV, lerpRate * rawDt)
```
Reference points: 1.5×→+7.0°, 1.8×→+13.7°, 2.0×→+18.4°, 2.5×→+32°.
startGame sets `camera.fov = baseFOV + 15` so launch visibly snaps inward (67:363).

### 3.3 Death camera (killPlayer 67:3750-3758; animate 70:610-618)

```
_EXP_DURATION = 2.8 s (game-over screen delay)                     // 20:3333
_expDeathZoomTarget = baseFOV + 15 (FOV lerps there at rate 0.8)
Orbit: t += 0.38 * rawDt; ease = 1-(1-t)^3
pivot.y → anchorY + 35.0 (RISE), pivot.z → anchorZ + 2.0 (PULLBACK),
pivot.x → anchorX ± 1.5 (side away from crash X)
camera.lookAt(crashPos.x, crashPos.y, crashPos.z - 2)
```

### 3.4 Retry sweep (repair/try-again establishing shot) (67:39-90, 4545-4583)

```
_RETRY_CAM_START = (0, 7.5, 16), _RETRY_FOV_START = 85°, _RETRY_SWEEP_DUR = 1.3 s
Ease-in-out cubic; pivot lerps START → (0, camBaseY+yOff, 9+zOff); FOV 85 → baseFOV.
At t=0.8 fire thruster-impact SFX; at t=1 set introActive=false (spawning unblocks).
```

### 3.5 Camera shake

Only source: lightning-strike impact (dev-tunable) — `shakeAmt 0.18, shakeDuration 0.35 s` (40:490, 72:3568-3575):
```
each frame: undo last offset;  if shakeTime>0:
  s = 0.18 * (shakeTime / 0.35)
  camera.position.x += (rand-0.5)*s;  camera.position.y += (rand-0.5)*s*0.4
```
Triggered when a lightning bolt lands (`_ltShakeTime = shakeDuration`, 72:3624). No shake on ordinary death (explosion orbit instead).

---

## 4. Collision & Damage

All collision is **hand-rolled axis-distance / segment-distance math** on `state.shipX`, `shipGroup.position.y/z` — no physics engine. Checks run inside `update(dt)` (fixed 60 Hz). Ship Z is constant 3.9.

### 4.1 Cones / obstacles (67:6168-6195)

```
roll      = shipGroup.rotation.z; rollFrac = min(|roll| / (π/2), 1)
WING_HALF = 1.5;  BODY_HALF = 0.8
colDistX  = 1.5*(1-rollFrac) + 0.8*rollFrac       // rolling narrows hitbox 1.5→0.8
colDistZ  = 1.5
cScale = obs.slalomScaled ? obs.scale.x : 1
cMult  = obs.isFatCone ? 0.9 : 1.2
HIT if |obs.x - shipX| < colDistX + (cScale-1)*cMult
   AND |obs.z - shipZ| < colDistZ + (cScale-1)*0.4
→ returnObstacleToPool + killPlayer()
```

### 4.2 Near-miss (67:6197-6221)

Band `colDistX < dx < colDistX + 0.6` and `dz < 2.0`, once per cone: `playerScore += 25 * lvlMult` (lvlMult=[1,1.5,2,3,4][levelIdx]), `nearMissFlash = 1.0` (hull red pulse, decays `-dt*3`), haptic tap, SFX throttled to 1 per 500 ms. In corridors only one near-miss per bend (`nearMissBendAllowed`, re-armed on corridor sine direction change).

### 4.3 Angled walls (67:6264-6306)

Full rotated-OBB test: project ship-to-wall delta onto wall matrix axes; half extents = wall mesh scale/2; ship half extents = **0.3/0.3/0.3**. Skipped while `invincibleSpeedActive` or intro. Hit → killPlayer.

### 4.4 Lethal rings (67:6349-6378)

Distance from ship point to each octagon edge segment (`_LR_SIDES` segments, radius `_LR_R`, tube radius `_LR_TUBE`, ring Y offset `_LR_Y`); hit if 3D dist < tube radius. Skipped while invincible/intro.

### 4.5 Pickups

- Powerup cube: collect if `|dx| < 2.5 && |dz| < 2.5` (cube is 3.5 u) — 67:6415-6417.
- Coin: collect if `|dx| < 1.6 && |dz| < 1.6` — 67:6470-6472. Coins bob `y = 1.2 + sin(elapsed*2.2+phase)*0.12`, spin `rotation.z = elapsed*2.8+phase`.
- Magnet pull (coins): if `dx²+dz² < magnetRadius²` (default 18): `coin.x -= dx*5*dt; coin.z -= dz*3*dt` — 67:6449-6459. Powerups pulled only at magnet tier 5 (radial pull 40*dt).
- Bonus (fuel-cell) rings: collect when `|ringZ - shipZ| < 2` and `|ringX - shipX| < ringRadius*0.8` → +1 fuel cell — 67:6082-6097.

### 4.6 killPlayer() resolution order (67:3546-3631)

```
1. if phase != 'playing' → return              (same-frame duplicate guard)
2. godMode (dev) → flash, return
3. tutorial → flash + respawn at x=0, return
4. invincibleTimer > 0 → flash + SFX, return    (head start / overdrive / post-repair)
5. shieldActive → shieldHitPoints--; if >0: hit ripple + color change, return
                  if 0: shieldActive=false, break-dissolve (0.6s), return   ← DEATH FULLY ABSORBED
6. else FATAL: phase='dead'; hide ship; spawn explosion; camera orbit;
   stop all gameplay audio; playCrash(); best-score update;
   game-over overlay after _EXP_DURATION (2.8 s); taps blocked further _GO_TAP_COOLDOWN (700 ms).
```

**There are no lives.** Death is instant unless shield/invincible absorbs it. "Save Me / REPAIR SHIP" (game-over button, 67:4053-4159) costs fuel cells [50,100,150,200] by use count; resumes the SAME run: score+playerScore reset to 0 (distance kept), `invincibleTimer = 3.0`, `invincibleGrace = 3.0` (invulnerable, no speed boost), ship re-centered, all mechanics cleared, `deathRunRestBeat = 1.5`, corridor-of-death restarted from scratch, retry-sweep camera plays.

### 4.7 Powerup effects & timers (50-shop.js, ticked at 67:5509-5559)

| Powerup | Duration by tier (1-5) | Notes |
|---|---|---|
| Shield | T1 10 s, T2 15 s, T3+ permanent (duration 0 = no timer) | Hit points: T1-3 = 1, T4 = 2, T5 = 3 (stacking pickups add HP up to max) |
| Laser | `4 * (1 + (tier-1)*0.25)` s | T1-3 bolt corridor `|ox-shipX| < 1.2`; T4 unibeam < 1.5; T5 scanning raycast |
| Overdrive (invincible) | [5, 6, 7.5, 9, 10] s | `invincibleSpeedActive = true` → world ×1.8; last `invincibleGrace` (2.0 s, T5 3.0 s) of timer drops the speed boost but keeps invulnerability; chromatic aberration 0.04 during boost, lerps to base (0.0015 desktop / 0 mobile) during grace |
| Magnet | [4, 5, 6, 7, 8] s | radius `state.magnetRadius` = 18 |

---

## 5. Game Flow / State Machine

`state.phase ∈ { 'title', 'playing', 'paused', 'dead' }` (a transient `'gameover'` string is checked in tutorial code only). Rendering switches on phase at the top of `animate()` (70:443-490).

```
                    tap/space (title)            crash
   ┌────────┐  startGame()/startDeathRun() ┌──────────┐  killPlayer() ┌────────┐
   │ TITLE  │ ───────────────────────────► │ PLAYING  │ ────────────► │  DEAD  │
   └────────┘ ◄─────────────────────────── └──────────┘               └────────┘
        ▲          returnToTitle()           ▲   │ Esc / pause btn        │ │
        │  (pause-menu EXIT, game-over EXIT) │   ▼                        │ │
        │                                  ┌──────────┐   tap/space:      │ │
        └──────────────────────────────────│  PAUSED  │  _triggerRetryWith│ │
                                           └──────────┘   Sweep() ────────┘ │
                                                          REPAIR (fuel) ────┘ (resumes same run)
```

- **Title**: title scene renders in a separate small renderer; gameplay scene idle. Tap anywhere / Space → `startGame()` (the main "TAP TO PLAY" actually calls `startDeathRun()` — death run IS the main mode; the L1 campaign path is legacy).
- **Playing sub-states** (flags, not phases):
  - `introActive` — cinematic prologue (DR: lines at 3 s/8.5 s, title 14 s, auto-launch 18.5 s, tap-to-skip). Blocks steering? No — blocks shipX (pinned 0) and spawning.
  - `_introLiftActive` — 2 s takeoff lift.
  - `_postLaunchGrace` — 2.0 s empty gameplay after lift before first spawn (67:5997-6000).
  - `_tutorialActive` — scripted DODGE/ROLL steps; deaths respawn instead of ending run.
  - `_ringFrozen` — dev ring-tuner freeze (update early-returns).
- **Paused**: single top gate in animate(); sim fully frozen, composer re-renders at ~10 fps throttle. Prologue timers freeze/resume via snapshot (`freezeIntroForPause`).
- **Dead**: update() still early-returns (`phase !== 'playing'`); animate keeps rendering + explosion + camera orbit tick on rawDt. Game-over overlay appears after 2.8 s, taps enabled 700 ms later.
- **Retry** (`_triggerRetryWithSweep`, 67:39): fade to black 180 ms → startDeathRun()/startGame() (full reset) → skip prologue, retry camera sweep 1.3 s.
- **Resume gate** (85-resume-gate.js): iOS-PWA only. If app hidden > 2000 ms, a full-screen "RESUME" overlay intercepts the first tap and **reloads the page** (audio recovery is unreliable; industry pattern). Unity analog: on resume-from-background just re-init audio; overlay not needed.

### 5.1 Reset coverage (what a fresh run must clear)

`startGame()` (67:92-615) resets ~90 state fields — the authoritative checklist. Key groups (see also docs/RUN_RESET_AUDIT.md):
- Score/session: score, playerScore, multiplier=1, sessionCoins/Powerups/Shields/Lasers/Invincibles, sessionMaxLevel=1, saveMeCount=0, distance (in startDeathRun), elapsed=0, frameCount=0, nextSpawnZ=-5.
- Ship: shipX=0, shipVelX=0, rollAngle/Held/Dir=0, tiltTimer=0, position=(0,1.21,3.9), rotation=(0.02,0,0), jump state zeroed.
- Camera: pivot=(0, 2.8+yOff, 9+zOff), rotation 0, fov=baseFOV+15, cameraRoll=0.
- Powerups: all flags false, timers 0, shieldHitPoints=1, laserTier=1, invincibleGrace=2, magnetRadius=18; all pool meshes hidden; aberration uniform reset to platform baseline.
- Mechanics: `_clearAllMechanics()`, lightning/asteroid pools cleared, canyon torn down + dirLight restored, corridor/zipper/slalom/gauntlet flags false, tutorial state cleared.
- Visual: `applyLevelVisuals(LEVELS[0])`, aurora/l5 dust off, thrusterPower=0 (prologue) or 1 (retry).
- Guards: `_gameStarting` reentry lock, `_retryPending`, timers (`_retryFadeTimer`, `_gameOverDelayTimer`, `_titleFadeTimer`, `_lakeFadeIv`, intro/music timer arrays).
`returnToTitle()` (60:198) does the same defensive wipe plus `_drFullStateWipe()` and UI/audio restoration.

---

## 6. Scoring, Distance, Coins, XP

Two parallel scores:

1. **`state.score` (internal, drives level thresholds)** — every 0.4 s: `score += (multiplier + statBonus) * max(1, speed/36)` (67:5082-5092).
2. **`state.playerScore` (HUD score)** — per frame: `playerScore += 8 * lvlMult * lvlScoreMult * max(1, speed/36) * dt` where lvlMult=[1,1.5,2,3,4][levelIdx]; lvlScoreMult = 1.6 at player level ≥15, 1.5 ≥10, 1.2 ≥5, else 1.0 (67:5123-5133). Plus +25×lvlMult per near-miss, +75×lvlMult per coin.

**Distance**: `distance += effectiveSpeed * dt` while playing and not intro (67:5076-5079). Survives Save-Me repair.

**Final score** (game over, 67:3810-3815): `finalScore = floor(playerScore) * max(1, 1 + floor(distance/5000)*0.1)`.

**Coins at game over** (67:3830-3846): `total = (sessionCoins + floor(finalScore/10 * (isDR?1.5:1)) + drTier*50) * doubleNextMultiplier` → wallet.

**XP** (20:582-608): `xpEarned = floor(playerScore/25) + bonus + floor(distance/100)`; `xpForLevel(L) = L<=5 ? 100+50L+10L² : 300+150L+5L²`.

Coin pickup: +1 coin, HUD fly animation, C5-E5-G5 chime (throttled 80 ms) (40:2565-2632).

---

## 7. Main Loop Order & Timing

### 7.1 Frame driver `animate(now)` (70:379-661)

```
requestAnimationFrame loop with soft FPS cap:
  skip frame if now - last < frameBudget - 1.5ms   (budget 16.67 ms, or 33.3 ms if fpsCap30 setting)
rawDt = min(clock.getDelta(), 0.05)                 // dt CLAMP = 50 ms max
if phase == 'paused': render composer at 10 fps throttle; return
if phase == 'title':  render title scene only; return

// GAMEPLAY (playing + dead):
accumulator += rawDt
while accumulator >= FIXED_DT (1/60): update(1/60); accumulator -= FIXED_DT   // fixed-step sim
// then variable-rate visual phase (rawDt):
FOV speed lerp → tuner override → water time/flow → aurora/L5 flares/wake
→ sun layers track shipX → fire meshes ← thrusterPower → alt-ship mixer
→ death camera orbit (dead phase) → explosion/flash/shockwave/sparks ticks
→ thruster haze pass uniforms → optional-light visibility sync → composer.render()
```

### 7.2 `update(dt)` order (fixed 1/60, 67:4363-6531) — early-return unless phase=='playing'

1. `elapsed += dt`; holo materials; powerup-shatter tick; `levelElapsed += dt`
2. `effectiveSpeed = speed * (invincible ? 1.8 : 1)`
3. **Ship lateral physics** (input → velX → shipX) §1
4. Argon steering SFX edge-triggers
5. Camera pivot follow / retry sweep
6. Wobble release detection; **bank lerp → shipGroup.rotation.z; cameraRoll**
7. Cruise idle body motion (disabled, `_cruiseMacro = 0`)
8. Bank-water wake effect
9. Pitch from speed delta; alt-ship wing animations
10. Vertical thrust/hover block; hover bob; intro lift
11. Yaw; `position.x = shipX`; touch-roll sync; knife-edge roll integration
12. Galaxy scroll; thruster particles; L5 dust; cone shards
13. `distance += effectiveSpeed*dt`; score tick (0.4 s); mission toast check (2 s); playerScore accumulation; HUD
14. Corridor bend detection; tutorial state machine
15. T5 laser scan; **powerup timers** (multiplier, shield, invincible+aberration, laser, magnet); hull tint effects
16. Grid scroll; **DR sequencer tick** (`_drSequencerTick`); canyon updates (L3 knife / preT4A / preT4B); corridor row spawners (L3/L4/L5, zipper, slalom, patterns); asteroid + lightning system ticks (in 72, called from sequencer/families)
17. Spawn gate: `nextSpawnZ += effectiveSpeed*dt; if >= 0 → spawnObstacles()` and reset to `spawnZBase ± 5` (base −50 campaign, −30/-22/-28 DR bands, ramp −32→−26)
18. Bonus rings move + collect/kill; **obstacles move + fade-in (z −160→−110) + laser destroy + COLLISION + near-miss**; angled walls; lethal rings
19. Powerups move/magnet/collect; coins move/magnet/collect
20. Shield shader visuals; post-L3 gap; `updateTransition`; `updateDeathRunTransition`

Notes for Unity: keep sim at fixed 60 Hz with an accumulator (or Unity FixedUpdate at 0.01667) and put camera FOV lerp, shake, and pure-visual ticks on variable Update with rawDt clamped to 50 ms. `update()` uses several `return` statements after killPlayer — a hit aborts the rest of that frame's obstacle loop.

---

## 8. HUD / misc constants quick sheet

| Item | Value |
|---|---|
| Fixed sim dt | 1/60 s; accumulator; rawDt clamp 0.05 s |
| Game-over delay | 2.8 s (`_EXP_DURATION`); tap cooldown 700 ms |
| Retry fade-to-black | 180 ms; sweep 1.3 s from (0,7.5,16) FOV 85 |
| Prologue timeline | text 3 s / 8.5 s, engine 8.5 s, title 14 s, auto-launch 18.5 s (safety 19 s), tap-to-skip ≥250 ms grace |
| Post-launch spawn grace | 2.0 s |
| Save-Me fuel cost | [50,100,150,200] by use; grants 3 s invulnerability |
| Head-start cost | 100 fuel (mega 250) (20:1031-1032) |
| Obstacle pool | 500; powerup pool 10 |
| Obstacle fade-in | opacity 0 at z=−160 → 1 at z=−110 |
| HUD speed readout | `(effectiveSpeed/36).toFixed(1) + 'x'` every 0.4 s |
| Ship hover Y | 1.21; pre-launch 0.38; ship Z 3.9; ship scale 0.30 (0.40 mobile-landscape) |
| Water | Y≈0, follows shipX; flow scroll `uFlowZ -= speed * (speed/36) * dt * 0.45` |
| Sky/sun | locked to shipX (infinite distance illusion) |
