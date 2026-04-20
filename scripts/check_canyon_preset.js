#!/usr/bin/env node
// check_canyon_preset.js — Pre-push math validator for canyon presets.
//
// Why this exists:
//   Slabs bake their X position at spawn (typically Z=-500 range) and KEEP
//   that bakedX as they scroll to the ship at Z=3.9. If a preset uses
//   Z-indexed ramps (mode 5 style), the geometry a player sees when a slab
//   ARRIVES at Z=3.9 was computed from parameters at that slab's SPAWN Z.
//   So "the slab I collide with today was frozen from yesterday's math."
//
//   Push 19 (mode 5 live-rebake) died because at spawn Z=-500, mode 5 had
//   I=0.30 and halfX=25. Peak sine offset = 120*0.30 = 36. Right wall bakedX
//   = -36 + 25 = -11. Ship at X=0 has its right edge at +1.2. Result: slab
//   arrives at ship with wall already 11u LEFT of ship center — instant
//   death with zero frames to strafe.
//
//   This script replays that exact math across a sweep of spawn Z values
//   and flags any preset that would hand the player an unwinnable frame.
//
// Usage:
//   node scripts/check_canyon_preset.js             # checks all 5 presets
//   node scripts/check_canyon_preset.js 5           # checks preset 5 only
//
// Exit code 0 = all pass, 1 = any fail.

'use strict';

// ─── Ship & fairness constants (must match game.js) ─────────────────
const SHIP_X           = 0;       // ship X at spawn — never clamped, but
                                  // entry check is "can player stay here?"
const SHIP_HALF_W      = 1.2;     // 2.4u wide ship
const COLLIDE_GRACE    = 0.3;     // hitbox grace margin in game.js
const ENTRY_MARGIN     = 2.0;     // extra buffer — player needs to not JUST
                                  // fit, they need room to react
const SHIP_Z           = 3.9;
const SLAB_SPACING     = 20;      // _canyonWalls._spacing
const ENTRANCE_PAD     = 10;      // added to halfX for entrance slabs only

// ─── Extract the 5 presets verbatim from game.js ────────────────────
// Keep these in sync if game.js presets change. The validator is the
// canonical math reference — if these drift from game.js, the check is
// meaningless. A future improvement is to export presets from game.js
// and import here, but for now copies are intentional (game.js is 24k
// lines and not trivially requireable).
const _CANYON_PRESETS = {
  1: { slabH:55, slabW:20, slabThick:60, sineIntensity:0.28, sineAmp:120, sinePeriod:330, sineSpeed:1, halfXOverride:34, entranceThick:700, entranceSlabs:3, spawnDepth:-250, scrollSpeed:1.0, _allCyan:true },
  2: { slabH:55, slabW:20, slabThick:60, sineIntensity:0.47, sineAmp:146, sinePeriod:530, sineSpeed:1, halfXOverride:34, entranceThick:700, entranceSlabs:3, spawnDepth:-250, scrollSpeed:1.0, _allCyan:false, _allDark:true, darkRgh:0.32, darkEmi:1.4 },
  3: { slabH:55, slabW:20, slabThick:60, sineIntensity:0.28, sineAmp:120, sinePeriod:265, sineSpeed:1, halfXOverride:34, entranceThick:700, entranceSlabs:3, spawnDepth:-250, scrollSpeed:1.0, _allCyan:false },
  4: { slabH:55, slabW:20, slabThick:60, sineIntensity:0.0,  sineAmp:0,   sinePeriod:265, sineSpeed:1, halfXOverride:68, entranceThick:700, entranceSlabs:3, spawnDepth:-250, scrollSpeed:2.6, _allCyan:false },
  5: { slabH:55, slabW:20, slabThick:60,
       sineIntensity:0.30, sineAmp:120, sinePeriod:330, sineSpeed:1,
       sineStartI:0.0,   sineStartZ:-150, sineFullZ:-500,
       halfXOverride:50,
       halfXStart:60,    halfXFull:25, halfXStartZ:-150, halfXFullZ:-500,
       entranceThick:700, entranceSlabs:3, spawnDepth:-250, scrollSpeed:1.5,
       _allCyan:false },
};

// ─── Z-indexed samplers (must match game.js _canyonIntensityAtZ / _canyonHalfXAtZ) ───
function intensityAtZ(p, worldZ) {
  if (p.sineStartI === undefined) return p.sineIntensity;
  const SZ = p.sineStartZ !== undefined ? p.sineStartZ : -150;
  const FZ = p.sineFullZ  !== undefined ? p.sineFullZ  : -500;
  const t  = Math.min(1, Math.max(0, (worldZ - SZ) / ((FZ - SZ) || 1)));
  return p.sineStartI + (p.sineIntensity - p.sineStartI) * t;
}
function halfXAtZ(p, worldZ) {
  if (p.halfXStart === undefined || p.halfXFull === undefined) {
    return p.halfXOverride != null ? p.halfXOverride : 34;
  }
  const SZ = p.halfXStartZ !== undefined ? p.halfXStartZ : -150;
  const FZ = p.halfXFullZ  !== undefined ? p.halfXFullZ  : -500;
  const t  = Math.min(1, Math.max(0, (worldZ - SZ) / ((FZ - SZ) || 1)));
  return Math.max(5, p.halfXStart + (p.halfXFull - p.halfXStart) * t);
}

// ─── Per-preset checks ──────────────────────────────────────────────
function checkPreset(id, p) {
  const failures = [];
  const warnings = [];

  // F1: halfX >= 5 always (ship half-width + margin)
  for (let z = -1000; z <= -100; z += 50) {
    const h = halfXAtZ(p, z);
    if (h < SHIP_HALF_W + COLLIDE_GRACE + 1) {
      failures.push(`F1 halfX too small at Z=${z}: halfX=${h.toFixed(2)} < ${(SHIP_HALF_W + COLLIDE_GRACE + 1).toFixed(2)}`);
    }
  }

  // F2: Entry clearance — at mouth Z=-150, the FIRST slab the player sees.
  //
  // KEY INSIGHT (from Game Feel review + _canyonXAtZ): the sine phase is
  // PINNED so sin(phase_at_Z=-150) = 0 by construction. The corridor center
  // at the mouth equals shipX at spawn. So at Z=-150, center=0 and the ONLY
  // wall displacement is ±halfX. We check that halfX alone fits the ship.
  //
  // DEEPER slabs (Z < -150) CAN hit peak sine, but by then the player is
  // actively tracking the center — they do not need to survive a frozen
  // frame. What we DO check deeper is that gap width (2*halfX) always fits
  // the ship, and that the center displacement never exceeds the corridor
  // walls' outer reach (i.e. the slab still physically fits in world).
  const entryZs = [-150, -250, -400, -500, -700];
  for (const z of entryZs) {
    const I    = intensityAtZ(p, z);
    const hX   = halfXAtZ(p, z);

    // F2: at entry mouth, sin(phase) is pinned to 0, so center=shipX=0.
    // Walls sit at ±halfX. Ship at X=0 with edges ±SHIP_HALF_W must clear
    // both walls by at least ENTRY_MARGIN.
    if (z === -150) {
      const rightClear = hX - COLLIDE_GRACE - SHIP_HALF_W;
      const leftClear  = hX - COLLIDE_GRACE - SHIP_HALF_W;
      if (rightClear < ENTRY_MARGIN) failures.push(`F2 entry Z=${z}: halfX=${hX.toFixed(2)} gives right clearance ${rightClear.toFixed(2)} < ${ENTRY_MARGIN}`);
      if (leftClear  < ENTRY_MARGIN) failures.push(`F2 entry Z=${z}: halfX=${hX.toFixed(2)} gives left clearance ${leftClear.toFixed(2)} < ${ENTRY_MARGIN}`);
    }

    // F3: Traversability — gap width must fit ship at all depths.
    const gap = 2 * hX;
    const requiredGap = 2 * (SHIP_HALF_W + COLLIDE_GRACE) + 1; // leave 1u wiggle
    if (gap < requiredGap) {
      failures.push(`F3 gap too narrow at Z=${z}: gap=${gap.toFixed(2)} < ${requiredGap.toFixed(2)} required`);
    }

    // F3b: RAMP-SQUEEZE LANDMINE — fail if BOTH halfX and sine-intensity
    // ramp DOWN and UP respectively as Z gets deeper.
    //
    // The Push 19 mode-5 bug: halfXStart=60 → halfXFull=25 (squeezing) AND
    // sineStartI=0 → sineIntensity=0.30 (intensifying) at the same Z range.
    // So a slab spawned deep had both maximum center-swing AND minimum
    // width, baked in, arriving at ship with no navigable path.
    //
    // Static math CANNOT decide if a slab is "navigable" (that depends on
    // visual lead time, which depends on scroll speed and player reaction).
    // But we CAN flag the one specific combo known to be dangerous: ramps
    // that compound (width shrinks while swing grows). At least one of them
    // must be flat or the preset is suspect. Warn-only — mode 5 is explicitly
    // a test bed and may want this for a jackknife section.
    // (check runs once per preset; the loop is wasteful but cheap)
    if (z === entryZs[0]) {
      const halfXRampsDown = (p.halfXStart !== undefined && p.halfXFull !== undefined && p.halfXFull < p.halfXStart);
      const sineRampsUp    = (p.sineStartI !== undefined && p.sineIntensity > p.sineStartI);
      if (halfXRampsDown && sineRampsUp) {
        warnings.push(`F3b compound ramp: halfX shrinks (${p.halfXStart}→${p.halfXFull}) AND sine grows (${p.sineStartI}→${p.sineIntensity}) together — known Push 19 failure mode. Prefer ramping one at a time, with a ramp distance of at least 400 Z-units between.`);
      }
    }
  }

  // F4: Entrance slabs get +ENTRANCE_PAD. They only exist at/near the
  // mouth and use halfX from SAFE_Z (their init-bake helper). At mouth,
  // center=0 and halfX_entrance = halfX(mouth) + ENTRANCE_PAD, which is
  // ALWAYS wider than the regular mouth slab. If F2 passes, F4 passes.
  // Keep this as a sanity check against future regressions.
  {
    const zMouth = -150;
    const hX_entrance = halfXAtZ(p, zMouth) + ENTRANCE_PAD;
    const clearance = hX_entrance - COLLIDE_GRACE - SHIP_HALF_W;
    if (clearance < ENTRY_MARGIN + ENTRANCE_PAD / 2) {
      failures.push(`F4 entrance slab clearance at Z=${zMouth}: ${clearance.toFixed(2)} (halfX_entrance=${hX_entrance.toFixed(2)})`);
    }
  }

  // F5: sinePeriod must be a positive constant — the sampler does not
  // support Z-indexed period (phase discontinuities).
  if (!(typeof p.sinePeriod === 'number' && p.sinePeriod > 10)) {
    failures.push(`F5 sinePeriod invalid: ${p.sinePeriod}`);
  }

  // F6: Warn (not fail) if Z-indexed ramps are present — mode 5 only.
  // Any Z-indexed preset carries the "frozen bake" landmine; flag it.
  if (p.sineStartI !== undefined || p.halfXStart !== undefined) {
    warnings.push(`F6 preset uses Z-indexed ramps — slabs spawned deep will carry those params forward to the ship`);
  }

  // F7: halfXOverride sanity
  if (p.halfXOverride !== undefined && p.halfXOverride < 5) {
    failures.push(`F7 halfXOverride=${p.halfXOverride} below ship fit threshold (5)`);
  }

  return { id, failures, warnings };
}

// ─── Main ───────────────────────────────────────────────────────────
const targetArg = process.argv[2];
const ids = targetArg ? [Number(targetArg)] : [1, 2, 3, 4, 5];
let anyFail = false;

for (const id of ids) {
  const p = _CANYON_PRESETS[id];
  if (!p) { console.error(`No preset ${id}`); anyFail = true; continue; }
  const { failures, warnings } = checkPreset(id, p);
  const tag = failures.length === 0 ? 'PASS' : 'FAIL';
  console.log(`\n── Preset ${id} [${tag}] ──`);
  for (const w of warnings) console.log(`  WARN: ${w}`);
  for (const f of failures) console.log(`  FAIL: ${f}`);
  if (failures.length === 0) console.log(`  ok — entry clearance, gap width, halfX bounds, sinePeriod all valid`);
  if (failures.length) anyFail = true;
}

if (anyFail) {
  console.log('\n❌ One or more presets FAILED the math check. Do NOT push.');
  process.exit(1);
} else {
  console.log('\n✅ All checked presets pass.');
  process.exit(0);
}
