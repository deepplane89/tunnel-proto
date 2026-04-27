  if (state.muted) return;
  _ensureCtxRunning();
  const sfx = document.getElementById('crash-sound');
  if (sfx) { sfx.currentTime = 0; sfx.volume = 0.25; sfx.play().catch(() => {}); }
}

// Plasma-punch impact layered alongside engine-roar ignition.
function playThrusterImpact(vol) {
  if (state.muted) return;
  const _ti = document.getElementById('thruster-impact-sfx');
  if (_ti) {
    try {
      _ti.currentTime = 0;
      _ti.volume = (vol == null ? 0.7 : vol);
      _ti.play().catch(() => {});
    } catch (_) {}
  }
}

// ── engine-baseline removed: continuous whir was unwanted. ──
// Helpers kept as no-ops so existing callsites compile. Argon sidechain
// ambient is now the only continuous layer (and it's silent unless the
// player steers).
function startEngineBaseline(_target) { /* no-op */ }
function stopEngineBaseline(_opts) { /* no-op */ }


// ── Retry sweep whoosh: filtered noise with rising frequency sweep ──
function playRetryWhoosh() {
  if (!audioCtx || state.muted) return;
  _ensureCtxRunning();
  const vol = 0.18 * (typeof sfxMult === 'function' ? sfxMult() : 1);
  if (vol <= 0) return;
  const dur = 1.3; // match sweep duration
  const now = audioCtx.currentTime;
  // White noise buffer
  const bufLen = audioCtx.sampleRate * dur;
  const noiseBuf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf;
  // Bandpass filter: sweep low → high for rising whoosh
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(200, now);
  filter.frequency.exponentialRampToValueAtTime(3500, now + dur * 0.85);
  filter.frequency.exponentialRampToValueAtTime(1800, now + dur);
  // Volume envelope: swell up then taper
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(vol, now + dur * 0.6);
  gain.gain.linearRampToValueAtTime(vol * 1.3, now + dur * 0.85);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(filter).connect(gain).connect(audioCtx.destination);
  src.start(now);
  src.stop(now + dur);
}

// ── Rotating thunder MP3 layer ──
// Plays thunder1.mp3 / thunder2.mp3 in alternation on each lightning strike.
// If the previously-triggered clip is still playing, this strike is silent
// (no overlap, no clipping). Once it ends, the NEXT strike plays the OTHER
// clip, and so on.
let _thunderActiveSrc = null;   // active AudioBufferSourceNode (or null when free)
let _thunderNextIdx   = 0;       // 0 -> thunder1 next, 1 -> thunder2 next
function _playThunderRotating() {
  if (!audioCtx || state.muted) return;
  // Skip if previous clip is still playing (no overlap allowed).
  if (_thunderActiveSrc) return;
  // Moderately quieter than synth boom so it sits as a longer-tail rumble layer.
  const baseVol = 0.40 * (typeof sfxMult === 'function' ? sfxMult() : 1);
  if (baseVol <= 0) return;
  const name = (_thunderNextIdx === 0) ? 'thunder1' : 'thunder2';
  const buf  = (typeof _sfxBuffers !== 'undefined') ? _sfxBuffers[name] : null;
  // Buffer not decoded yet — advance rotation anyway so we don't get stuck on idx 0.
  if (!buf) { _thunderNextIdx = 1 - _thunderNextIdx; return; }
  _ensureCtxRunning();
  const src  = audioCtx.createBufferSource();
  src.buffer = buf;
  const gain = audioCtx.createGain();
  gain.gain.value = Math.min(1, baseVol);
  src.connect(gain).connect(audioCtx.destination);
  src.onended = () => {
    if (_thunderActiveSrc === src) _thunderActiveSrc = null;
  };
  _thunderActiveSrc = src;
  // Advance rotation NOW so even if onended is delayed, the next strike
  // (after this clip ends) gets the other file.
  _thunderNextIdx = 1 - _thunderNextIdx;
  src.start();
}

// ── Lightning strike: buzzy arc + deep boom two-layer SFX ──
function _playLightningStrike() {
  if (!audioCtx || state.muted) return;
  _ensureCtxRunning();
  // Layer real-thunder MP3 on top of synth boom (rotates 1↔2, never overlaps itself).
  // While a thunder clip is playing, _playThunderRotating() returns silently,
  // so mid-clip strikes get the synth boom only — the long clip plays out in full.
  _playThunderRotating();
  // Synth boom — moderate bump from 0.22 so the every-strike layer has more body.
  const vol = 0.32 * (typeof sfxMult === 'function' ? sfxMult() : 1);
  if (vol <= 0) return;
  const now = audioCtx.currentTime;

  // ── Deep boom ──
  const boom = audioCtx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(55, now);
  boom.frequency.exponentialRampToValueAtTime(28, now + 0.9);
  // Sub triangle layer for extra body
  const sub = audioCtx.createOscillator();
  sub.type = 'triangle';
  sub.frequency.setValueAtTime(38, now);
  sub.frequency.exponentialRampToValueAtTime(18, now + 1.1);
  const boomGain = audioCtx.createGain();
  boomGain.gain.setValueAtTime(0.001, now);
  boomGain.gain.linearRampToValueAtTime(vol * 0.9, now + 0.04); // fast attack
  boomGain.gain.exponentialRampToValueAtTime(vol * 0.4, now + 0.3);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
  boom.connect(boomGain).connect(audioCtx.destination);
  sub.connect(boomGain);
  boom.start(now); boom.stop(now + 1.1);
  sub.start(now);  sub.stop(now + 1.1);
}

function _playAsteroidImpact() {
  // Same boom as lightning but quieter (0.07 vs 0.22)
  if (!audioCtx || state.muted) return;
  _ensureCtxRunning();
  const vol = 0.07 * (typeof sfxMult === 'function' ? sfxMult() : 1);
  if (vol <= 0) return;
  const now = audioCtx.currentTime;
  const boom = audioCtx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(55, now);
  boom.frequency.exponentialRampToValueAtTime(28, now + 0.9);
  const sub = audioCtx.createOscillator();
  sub.type = 'triangle';
  sub.frequency.setValueAtTime(38, now);
  sub.frequency.exponentialRampToValueAtTime(18, now + 1.1);
  const boomGain = audioCtx.createGain();
  boomGain.gain.setValueAtTime(0.001, now);
  boomGain.gain.linearRampToValueAtTime(vol * 0.9, now + 0.04);
  boomGain.gain.exponentialRampToValueAtTime(vol * 0.4, now + 0.3);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
  boom.connect(boomGain).connect(audioCtx.destination);
  sub.connect(boomGain);
  boom.start(now); boom.stop(now + 1.1);
  sub.start(now);  sub.stop(now + 1.1);
}

function playPickup(typeIdx) {
  if (!audioCtx || state.muted) return;
  const freqs = [880, 1100, 660, 990, 770, 660];
  playSFX(freqs[typeIdx] || 880, 0.2, 'sine', 0.45);
  setTimeout(() => playSFX((freqs[typeIdx] || 880) * 1.25, 0.15, 'sine', 0.35), 80);
  // Quiet electron-burst layer on power-up smash.
  const _pb = document.getElementById('powerup-burst-sfx');
  if (_pb) {
    try { _pb.currentTime = 0; _pb.volume = 0.18; _pb.play().catch(() => {}); } catch (_) {}
  }
}

// ═══════════════════════════════════════════════════
//  GRID / ENVIRONMENT ANIMATION
// ═══════════════════════════════════════════════════
let gridOffset = 0;

function scrollGrid(dt) {
  gridOffset += state.speed * dt;
  // Drive shader offsets so tiles scroll forward & follow ship laterally
  floorMat.uniforms.uOffsetZ.value = gridOffset;
  floorMat.uniforms.uOffsetX.value = state.shipX;
  // Keep the floor plane centered on the ship so it's always under the camera
  floorMesh.position.x = state.shipX;
  // Mirror floor scrolls in sync
  // mirrorMat no longer needs scroll offsets — it samples reflectRT in screen-space
  mirrorMesh.position.x = state.shipX;
}

// ═══════════════════════════════════════════════════
//  LEVEL TRANSITION
// ═══════════════════════════════════════════════════
let currentLevelDef = LEVELS[0];
let targetLevelDef  = LEVELS[0];
let transitionT     = 1.0; // 0 = start, 1 = done


// Crossfade bgMusic → l3Music over `duration` seconds
function crossfadeToL3(duration) { musicFadeTo('l3', duration * 1000); }
function crossfadeToL4(duration) { musicFadeTo('l4', duration * 1000); }
function applyLevelVisuals(def) {
  skyMat.uniforms.topColor.value.copy(def.skyTop);
  skyMat.uniforms.botColor.value.copy(def.skyBot);
  scene.fog.color.copy(def.fogColor);
  bloom.strength = def.bloomStrength;
  updateGridColor(def.gridColor);
  const pidx = LEVELS.indexOf(def);
  const pal = FLOOR_PALETTES[Math.min(pidx, FLOOR_PALETTES.length - 1)];
  updateFloorPalette(null, null, pal.line);
  // Galaxy tint follows level grid color
  targetNebulaTint.copy(def.gridColor);  // set nebula tint for this level
  // Update sun color for this level
  updateSunColor(def.sunColor, LEVELS.indexOf(def));
  // Per-level thruster color (distinct palette, not just gridColor)
  const tidx = LEVELS.indexOf(def);
  updateThrusterColor(THRUSTER_COLORS[Math.min(tidx, THRUSTER_COLORS.length - 1)]);

  l5DustPoints.visible = false;  // only re-enabled by 2nd zipper / key6
}

function transitionToLevel(def) {
  targetLevelDef = def;
  transitionT    = 0;
}

function updateTransition(dt) {
  if (transitionT >= 1) return;
  transitionT = Math.min(1, transitionT + dt * 1.2);
  const t = transitionT;

  skyMat.uniforms.topColor.value.lerpColors(currentLevelDef.skyTop, targetLevelDef.skyTop, t);
  skyMat.uniforms.botColor.value.lerpColors(currentLevelDef.skyBot, targetLevelDef.skyBot, t);
  scene.fog.color.lerpColors(currentLevelDef.fogColor, targetLevelDef.fogColor, t);

  const gridLerp = new THREE.Color().lerpColors(currentLevelDef.gridColor, targetLevelDef.gridColor, t);
  updateGridColor(gridLerp);
  // Lerp floor palette
  const ci = LEVELS.indexOf(currentLevelDef);
  const ti = LEVELS.indexOf(targetLevelDef);
  const cp = FLOOR_PALETTES[Math.min(ci, FLOOR_PALETTES.length - 1)];
  const tp = FLOOR_PALETTES[Math.min(ti, FLOOR_PALETTES.length - 1)];
  floorMat.uniforms.uLineColor.value.lerpColors(cp.line, tp.line, t);
  mirrorMat.uniforms.uLineColor.value.lerpColors(cp.line, tp.line, t);

  // Galaxy tint lerps between level grid colors
  const gTint = new THREE.Color().lerpColors(currentLevelDef.gridColor, targetLevelDef.gridColor, t);
  targetNebulaTint.copy(gTint);  // set nebula tint for transition

  // Sun color lerp — smooth continuous blend including shader branch weights
  const sunLerped = new THREE.Color().lerpColors(currentLevelDef.sunColor, targetLevelDef.sunColor, t);
  const ci3 = LEVELS.indexOf(currentLevelDef);
  const ti3 = LEVELS.indexOf(targetLevelDef);
  // UV weight: 1 at L2, 0 elsewhere.
  const uvFrom  = (ci3 === 1) ? 1.0 : 0.0;
  const uvTo    = (ti3 === 1) ? 1.0 : 0.0;
  // Ice weight: 1 at L4, 0 elsewhere.
  const iceFrom = (ci3 === 3) ? 1.0 : 0.0;
  const iceTo   = (ti3 === 3) ? 1.0 : 0.0;
  // Gold weight: 1 at L5, 0 elsewhere.
  const goldFrom = (ci3 === 4) ? 1.0 : 0.0;
  const goldTo   = (ti3 === 4) ? 1.0 : 0.0;
  // L3 weight: 1 at L3, 0 elsewhere.
  const l3From = (ci3 === 2) ? 1.0 : 0.0;
  const l3To   = (ti3 === 2) ? 1.0 : 0.0;
  updateSunColor(sunLerped, -1); // -1 = don't snap uniforms — we set them manually below
  sunMat.uniforms.uIsUV.value   = uvFrom   + (uvTo   - uvFrom)   * t;
  sunMat.uniforms.uIsL3.value   = l3From   + (l3To   - l3From)   * t;
  sunMat.uniforms.uIsIce.value  = iceFrom  + (iceTo  - iceFrom)  * t;
  sunMat.uniforms.uIsGold.value = goldFrom + (goldTo - goldFrom) * t;
  sunCapMat.uniforms.uIsUV.value   = sunMat.uniforms.uIsUV.value;
  sunCapMat.uniforms.uIsL3.value   = sunMat.uniforms.uIsL3.value;
  sunCapMat.uniforms.uIsL3Warp.value = sunMat.uniforms.uIsL3Warp.value;
  sunCapMat.uniforms.uIsIce.value  = sunMat.uniforms.uIsIce.value;
  sunCapMat.uniforms.uIsGold.value = sunMat.uniforms.uIsGold.value;
  sunCapMat.uniforms.uWarpCol1.value.copy(sunMat.uniforms.uWarpCol1.value);
  sunCapMat.uniforms.uWarpCol2.value.copy(sunMat.uniforms.uWarpCol2.value);
  sunCapMat.uniforms.uWarpCol3.value.copy(sunMat.uniforms.uWarpCol3.value);

  // Thruster color lerp
  const ci2 = LEVELS.indexOf(currentLevelDef);
  const ti2 = LEVELS.indexOf(targetLevelDef);
  const tc = THRUSTER_COLORS[Math.min(ci2, THRUSTER_COLORS.length - 1)];
  const tt = THRUSTER_COLORS[Math.min(ti2, THRUSTER_COLORS.length - 1)];
  thrusterColor.lerpColors(tc, tt, t);

  bloom.strength = currentLevelDef.bloomStrength + (targetLevelDef.bloomStrength - currentLevelDef.bloomStrength) * t;

  if (transitionT >= 1) currentLevelDef = targetLevelDef;
}

// ═══════════════════════════════════════════════════
//  SPAWN LOGIC
// ═══════════════════════════════════════════════════
function getPooledObstacle(type) {
  for (const o of obstaclePool) {
    if (!o.userData.active) {
      o.userData.active = true;
      o.userData.type   = type;
      o.visible         = true;
      // Reset opacity to 0 so the cone fades in from the horizon (no pop-in)
      const _mc = o.userData._meshes;
      for (let mi = 0; mi < _mc.length; mi++) {
        const child = _mc[mi];
        if (child.material.uniforms && child.material.uniforms.uOpacity) {
          child.material.uniforms.uOpacity.value = 0.0;
          child.material.transparent = true;
          child.material.depthWrite = false;
          child.material.needsUpdate = true;
        } else if (child.material.opacity !== undefined) {
          child.material.opacity = 0.0;
          child.material.transparent = true;
          child.material.needsUpdate = true;
        }
      }
      return o;
    }
  }
  return null;
}

function makeGeoForShape(shape) {
  if (shape === 'oct')   return new THREE.OctahedronGeometry(0.8);
  if (shape === 'torus') return new THREE.TorusGeometry(0.7, 0.25, 8, 16);
  if (shape === 'ring')  return new THREE.TorusGeometry(0.8, 0.15, 8, 24);
  return new THREE.SphereGeometry(0.7, 12, 12); // magnet / default
}

function getPooledPowerup(typeIdx) {
  for (const p of powerupPool) {
    if (!p.userData.active) {
      p.userData.active  = true;
      p.userData.typeIdx = typeIdx;
      p.visible          = true;
      p.scale.setScalar(1);
      const def      = POWERUP_TYPES[typeIdx];
      const cubeMesh = p.userData._cubeMesh;
      const iconMesh = p.userData._iconMesh;

      // Cube material: hologramColor is locked to Mancini-cyan in createPowerupMesh
      // and intentionally NOT retinted per type — the icon conveys type, not the cube.
      // We DO NOT reset other uniforms here — the dev tuner may have changed them globally
      // via _broadcastHoloUniform, and we want those to persist across spawns.

      // Icon material: retint, and swap geometry only if shape changed.
      if (iconMesh && iconMesh.material && iconMesh.material.uniforms) {
        iconMesh.material.uniforms.hologramColor.value.set(def.color);
        const needShape = def.shape;
        if (p.userData.currentShape !== needShape) {
          iconMesh.geometry.dispose();
          iconMesh.geometry = _makeIconGeoForShape(needShape);
          p.userData.currentShape = needShape;
        }
      }
      return p;
    }
  }
  return null;
}

// Inner-icon geometry factory — sized for the holo cube interior.
function _makeIconGeoForShape(shape) {
  const S = (typeof POWERUP_ICON_SIZE === 'number') ? POWERUP_ICON_SIZE : 1.1;
  if (shape === 'oct')   return new THREE.OctahedronGeometry(S);
  if (shape === 'torus') return new THREE.TorusGeometry(S * 0.85, S * 0.30, 10, 20);
  if (shape === 'ring')  return new THREE.TorusGeometry(S * 0.95, S * 0.18, 10, 28);
  return new THREE.SphereGeometry(S * 0.9, 16, 16); // magnet / default
}

let framesSinceLastPowerup = 0;
const powerupSpawnRate = 2.2; // max rate (slider removed)

// ─── GAUNTLET CONFIG ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════
//  FUNNEL / CORRIDOR SYSTEM (L3+)
//
//  Two parallel walls of cones run front-to-back like a highway.
//  They start far apart (wide open), squeeze inward to a tight corridor,
//  hold for a stretch, then spread back out — just like the original.
//
//  Each spawn tick places ONE cone on the LEFT wall and ONE on the RIGHT wall
//  at SPAWN_Z — so they form continuous lines you fly between, not flat rows.
// ═══════════════════════════════════════════════════
const FUNNEL_LEVELS        = new Set([]);  // disabled — no levels use the gauntlet funnel burst
const FUNNEL_COOLDOWN_ROWS = 22;
const FUNNEL_CLOSE_ROWS    = 10;  // rows while walls squeeze inward
const FUNNEL_HOLD_ROWS     = 12;  // rows of tight corridor
const FUNNEL_OPEN_ROWS     = 8;   // rows while walls spread outward
const FUNNEL_TOTAL_ROWS    = FUNNEL_CLOSE_ROWS + FUNNEL_HOLD_ROWS + FUNNEL_OPEN_ROWS;
const FUNNEL_WIDE_X        = 24;  // world units — wall half-offset at fully open
const FUNNEL_NARROW_X      = 5.5; // world units — wall half-offset at tightest

// L3 KNIFE CANYON replacement — see bottom of file for helpers.
// Flip _L3_KNIFE_ENABLED back to false to restore the original cone corridor.
const _L3_KNIFE_ENABLED  = true;
const _L3_KNIFE_DURATION = 40.0;    // seconds the knife canyon experience lasts

function maybeStartGauntlet() {
  // Death Run: no corridors/gauntlets — random cones only
  if (state.isDeathRun) return;
  // L3: knife-canyon (new) or dense cone corridor (old, preserved for revert).
  if (state.currentLevelIdx === 2) {
    // L3 corridor (cone or knife-canyon) is driven by the DR sequencer in
    // src/67-main-late.js (L3_CORRIDOR.activate). This branch is kept only
    // as a no-op guard so non-DR reaches L3 don't fall through to gauntlet logic.
    // LEGACY PATH — original L3 dense cone corridor (kept intact for revert).
    if (!state.corridorMode) {
      state.corridorMode      = true;
      state.corridorSpawnZ    = -7;
      state.corridorRowsDone  = 0;
      state.corridorGapCenter = 0;
      state.corridorGapDir    = 1;
      state.corridorDelay     = 2.0;  // 2-second clear gap before first cone spawns
      // Clear all existing obstacles so entry isn't blocked
      ;[...activeObstacles].forEach(returnObstacleToPool);
      activeObstacles.length = 0;
  [..._activeForcefields].forEach(returnForcefieldToPool);
  _activeForcefields.length = 0;
    }
    return;
  }
  state.corridorMode = false;
  if (state.gauntletActive) return;
  if (!FUNNEL_LEVELS.has(state.currentLevelIdx)) return;
  if (state.gauntletCooldown > 0) { state.gauntletCooldown--; return; }
  if (Math.random() < 0.22) {
    state.gauntletActive   = true;
    state.gauntletRowsLeft = FUNNEL_TOTAL_ROWS;
    state.gauntletCooldown = 0;
  }
}

// ============================================================================
// L3 KNIFE CANYON — replaces L3 cone corridor with the K-press knife-arches
// canyon for _L3_KNIFE_DURATION seconds. Snap slider oscillates 0.1 ↔ 1.5
// throughout. Old cone-corridor code preserved above — flip _L3_KNIFE_ENABLED
// to false to restore it.
// ============================================================================
function _startL3KnifeCanyon() {
  // NOTE: do NOT wipe activeObstacles/forcefields here. The DR sequencer
  // stops spawning cones before L3 trigger, so the last batch will z-scroll
  // past the player naturally during the ~1s before canyon slabs reach play
  // distance. Wiping caused cones to pop out of existence instead of
  // scrolling past — bad visual transition.

  // State flags
  state.l3KnifeCanyon    = true;
  // Cancel any deferred speed bump from the DR speed-gate — canyon owns
  // speed for its full lifecycle (ramp on entry, restore on _stopL3KnifeCanyon).
  // Without this, S2->S3 increase pending bump applies mid-canyon-ramp and
  // clobbers the entrance visual (sudden FOV/speed jump as entrance slab
  // approaches the ship). _drApplyPendingSpeed runs unconditionally at top
  // of _drSequencerTick so it can fire even while canyon owns speed.
  state._pendingSpeed = undefined;
  state._pendingSpeedObstacles = null;
  state._pendingSpeedDeadline = 0;
  state.l3KnifeElapsed   = 0;
  state.l3KnifeDone      = false;
  // Start snap oscillator at 0 — sine drives it through 0.1..1.5 over 4s period.
  state.l3KnifeSnapT     = 0;
  // Exit scroll-out trigger fires once when t reaches DURATION-EXIT_WINDOW.
  state._l3KnifeExitStarted = false;
  // Entry-to-active ramp: player gets ~2s to register the canyon before
  // speed/handling/FOV punch in. 'pending' → 'ramping' → 'active'.
  state.l3KnifeRampPhase = 'pending';
  state.l3KnifeRampT     = 0;
  // Save originals so _stopL3KnifeCanyon can restore them.
  state._l3SavedSpeed      = state.speed;
  state._l3SavedPhysLevel  = _physLevelOverride;
  state._l3SavedFOV        = (typeof camera !== 'undefined' && camera) ? camera.fov : 65;

  // Spawn the L4-recreation canyon with the knife-arches preset. Mirrors the
  // K-hotkey handler in 67-main-late.js:5470 but without the manual toggle.
  const vals = _CANYON_PRESETS[1];
  if (!vals) return;
  _canyonMode = 1;
  _canyonTuner._allCyan = false;
  _canyonTuner._allDark = false;
  Object.assign(_canyonTuner, vals);
  _canyonTuner._l4Recreation = true;
  // If a snap-lock was set by the caller (e.g. CD_CANYON L3_KNIFE_LOCKED variant),
  // bake the locked value into the slab geometry instead of the default 1.5.
  // _updateL3KnifeCanyon also skips its oscillator when this flag is set.
  const _initialSnap = (typeof state._l3KnifeSnapLocked === 'number') ? state._l3KnifeSnapLocked : 1.5;
  // Full knife-arches preset — identical to K-hotkey
  Object.assign(_canyonTuner, {
    slabH: 55, slabThick: 60, cols: 5, rows: 6, disp: 2, snap: _initialSnap,
    footX: 26, sweepX: 20, midX: 0, crestX: 0,
    cyanEmi: 2, cyanRgh: 0.65,
    darkCrkCount: 14, darkCrkBright: 1.95, darkRgh: 0.62,
    darkClearcoat: 0.4, darkEmi: 0.9,
    lightIntensity: 1.2,
    entranceThick: 700, entranceSlabs: 1, spawnDepth: -250,
    sineIntensity: 0.28, sineAmp: 120, sinePeriod: 330, sineSpeed: 1,
    scrollSpeed: 1,
    _l4HalfX: 21.5, _l4AmpScale: 1.0, _l4RampCompress: 1.45, _l4SlabW: 40,
  });
  _canyonTuner.halfXOverride = _canyonTuner._l4HalfX;
  _canyonTuner.slabW         = _canyonTuner._l4SlabW;
  _canyonSinePhase = 0;
  _l4RowsElapsed = 0;
  if (_canyonActive || _canyonExiting || _canyonWalls) _destroyCanyonWalls();
  _canyonExiting = false;
  _canyonActive  = true;
  _canyonManual  = true;  // mark manual so JL sequencer doesn't fight us
  _jlCorridor.active = false;
  state.corridorGapCenter = state.shipX || 0;
  if (typeof dirLight !== 'undefined' && dirLight) {
    if (_canyonSavedDirLight === null) _canyonSavedDirLight = dirLight.intensity;
    dirLight.intensity = 0;
  }
  _createCanyonWalls();
  console.log('[L3-KNIFE] ON for ' + _L3_KNIFE_DURATION + 's');
}

function _stopL3KnifeCanyon() {
  state.l3KnifeCanyon  = false;
  state.l3KnifeDone    = true;  // one-shot per L3 entry; re-entering L3 re-arms via level transition reset
  if (_canyonWalls) _destroyCanyonWalls();
  _canyonActive  = false;
  _canyonExiting = false;
  _canyonManual  = false;
  _jlCorridor.active = false;
  _canyonTuner._l4Recreation = false;
  if (_canyonSavedDirLight !== null && typeof dirLight !== 'undefined' && dirLight) {
    dirLight.intensity = _canyonSavedDirLight;
    _canyonSavedDirLight = null;
  }
  _canyonMode = 0;
  // Restore speed/handling/FOV if they were overridden during the canyon.
  // NOTE: state.l3KnifeCanyon was just flipped false above, so the very next
  // _drSequencerTick will re-acquire speed control and drive state.speed to
  // whatever the current DR stage wants (clobber gate at 67:960 no longer
  // holds). Writing _l3SavedSpeed here is just the one-frame bridge.
  if (state._l3SavedSpeed     !== undefined) { state.speed = state._l3SavedSpeed; state._l3SavedSpeed = undefined; }
  if (state._l3SavedPhysLevel !== undefined) { _physLevelOverride = state._l3SavedPhysLevel; state._l3SavedPhysLevel = undefined; }
  console.log('[L3-KNIFE] restored speed=' + state.speed.toFixed(1) + ' physOverride=' + _physLevelOverride);
  if (state._l3SavedFOV       !== undefined && typeof camera !== 'undefined' && camera) {
    camera.fov = state._l3SavedFOV;
    camera.updateProjectionMatrix();
    state._l3SavedFOV = undefined;
  }
  state.l3KnifeRampPhase = 'off';
  state.l3KnifeRampT     = 0;
  // Clear snap-lock so future entries (no lock) don't inherit it.
  state._l3KnifeSnapLocked = null;
  console.log('[L3-KNIFE] OFF');
}

// Entry-to-active ramp tuning.
// - RAMP_DURATION: seconds over which speed lerps to target after the
//   ship enters the canyon (corridor revealed at Z=-210).
// - TARGET_SPEED_MULT: BASE_SPEED * this during canyon. FOV follows
//   automatically via the global speed-to-FOV lerp in perf-diag.js.
const _L3_KNIFE_RAMP_DURATION  = 0.4;
const _L3_KNIFE_TARGET_SPEED_MULT = 2.2;
// Clean exit: in the last EXIT_WINDOW seconds of the canyon's life we stop
// spawning new slabs and let the existing ones drift past the ship on Z.
// Matches the JL sequencer's _jlCanyonStop pattern: _canyonActive=false +
// _canyonExiting=true; the canyon tick in 20-main-early.js watches for
// allGone and destroys the walls.
const _L3_KNIFE_EXIT_WINDOW    = 4.0;

// Tick called every frame from the main update loop.
// Advances the 40s timer, ramps snap 1.5 → 0.1 monotonically, runs the
// entry ramp, and triggers a scroll-out exit in the final EXIT_WINDOW.
function _updateL3KnifeCanyon(dt) {
  if (!state.l3KnifeCanyon) return;
  state.l3KnifeElapsed = (state.l3KnifeElapsed || 0) + dt;
  // Snap oscillation: sine 0..1 mapped to 0.1..1.5, 4s full period (0.25 Hz).
  // Original pre-snap-change behavior. Note: SNAP is baked into slab geometry
  // at _createCanyonWalls time (src/20-main-early.js:7601), so live writes
  // here mainly take effect on freshly-recycled/spawned slabs.
  if (typeof state._l3KnifeSnapLocked === 'number') {
    // Snap-locked variant (e.g. CD_CANYON): hold at the locked value, no oscillation.
    _canyonTuner.snap = state._l3KnifeSnapLocked;
  } else {
    state.l3KnifeSnapT = (state.l3KnifeSnapT || 0) + dt;
    const w  = (state.l3KnifeSnapT * Math.PI * 2 / 4.0);
    const u  = 0.5 + 0.5 * Math.sin(w);
    _canyonTuner.snap = 0.1 + (1.5 - 0.1) * u;
  }

  // ── Entry ramp: pending → ramping → active ──────────────────────────────
  // Ramp speed+physics in over RAMP_DURATION seconds once the ship enters
  // the canyon (corridor revealed). Once ramped we stay at target until stop.
  // FOV is handled by the global speed-to-FOV lerp (perf-diag.js).
  const phase = state.l3KnifeRampPhase || 'pending';
  // Position-based trigger: fire when _canyonWalls._corridorRevealed flips
  // true (entrance slab reached Z=-210 — ship at canyon mouth). This is
  // the same reveal trigger used by the main canyon system.
  const revealed = (typeof _canyonWalls !== 'undefined' && _canyonWalls && _canyonWalls._corridorRevealed);
  if (phase === 'pending' && revealed) {
    state.l3KnifeRampPhase = 'ramping';
    state.l3KnifeRampT     = 0;
    // Snap to crisp L5 handling immediately — physics doesn't lerp well.
    _physLevelOverride = 4;
    console.log('[L3-KNIFE] entry ramp start (ship at canyon mouth)');
  }
  if (state.l3KnifeRampPhase === 'ramping') {
    state.l3KnifeRampT = (state.l3KnifeRampT || 0) + dt;
    const t = Math.min(1, state.l3KnifeRampT / _L3_KNIFE_RAMP_DURATION);
    // Ease-out cubic so the push-in decelerates at the end.
    const e = 1 - Math.pow(1 - t, 3);
    const startSpeed  = state._l3SavedSpeed || (BASE_SPEED * 2.0);
    const targetSpeed = BASE_SPEED * _L3_KNIFE_TARGET_SPEED_MULT;
    state.speed = startSpeed + (targetSpeed - startSpeed) * e;
    // FOV follows naturally via the global speed-to-FOV lerp in perf-diag.js
    // (targetFOV = _baseFOV + _fovSpeedBoost * speed/80) — matching the rest
    // of the game's speed-change pattern, so no manual FOV write needed here.
    if (t >= 1) {
      state.l3KnifeRampPhase = 'active';
      console.log('[L3-KNIFE] entry ramp complete — speed=' + state.speed.toFixed(1));
    }
  }

  // ── Scroll-out exit in the last EXIT_WINDOW seconds ─────────────────────
  // Stop spawning new slabs and flip the existing ones into drift mode so
  // they pass the ship on Z for a clean hand-off to whatever comes next.
  if (!state._l3KnifeExitStarted && state.l3KnifeElapsed >= _L3_KNIFE_DURATION - _L3_KNIFE_EXIT_WINDOW) {
    state._l3KnifeExitStarted = true;
    if (typeof _canyonActive !== 'undefined')  _canyonActive  = false;
    if (typeof _canyonExiting !== 'undefined') _canyonExiting = true;
    console.log('[L3-KNIFE] exit scroll-out start');
  }

  // Auto-end after duration. No currentLevelIdx guard — in DR mode
  // currentLevelIdx tracks the vibe shader (often 0 during T3B_L3BOSS),
  // not the campaign level. Sequencer advance + retry/death both call
  // _stopL3KnifeCanyon directly.
  if (state.l3KnifeElapsed >= _L3_KNIFE_DURATION) {
    _stopL3KnifeCanyon();
  }
}

// ============================================================================
// PRE-T4A CANYON — 40s canyon corridor inserted between RECOVERY_1 and T4A.
// Mirrors the L3 knife canyon flow (start/stop/update + auto-end timer +
// scroll-out exit) but uses canyon mode 5 with the user's exported tuner
// values + RANDOM lightning loop instead of knife-arches preset.
// Triggered by DR sequencer family registry entry 'PRE_T4A_CANYON'.
// ============================================================================
const _PRE_T4A_DURATION         = 40.0;   // seconds
const _PRE_T4A_EXIT_WINDOW      = 4.0;    // last-N seconds = scroll-out, no new slabs
const _PRE_T4A_RAMP_DURATION    = 0.4;    // entry-ramp seconds (matches L3 knife)
const _PRE_T4A_TARGET_SPEED_MULT = 2.2;   // BASE_SPEED * this during canyon

// User's exported canyon tuner (mode 5) — captured 2026-04-24.
// Overwriting current _canyonTuner with these values reproduces the visual
// scene the user tuned in the V panel.
const _PRE_T4A_CANYON_TUNER = {
  slabH: 190, slabW: 20, slabThick: 60,
  cols: 5, rows: 6, disp: 4, snap: 0.7,
  footX: 9, sweepX: 4, midX: 17, crestX: 20,
  poolSize: 10, scrollSpeed: 1.5, snapRate: 6,
  cyanEmi: 1.1, cyanRgh: 0.4,
  holoOpacity: 0.5, holoGrid: 6,
  darkCrkCount: 6, darkCrkBright: 1, darkRgh: 0.22,
  darkClearcoat: 0.4, darkEmi: 0.9,
  lightIntensity: 1,
  halfXOverride: 50,
  entranceThick: 700, entranceSlabs: 1, spawnDepth: -250,
  sineIntensity: 0.3, sineAmp: 120, sinePeriod: 330, sineSpeed: 1,
  _allCyan: false, _allDark: false,
  _l4Recreation: false, _l4RampCompress: 1.45, _l4AmpScale: 1, _l4HalfX: 8, _l4SlabW: 40,
  sineStartI: 0, sineStartZ: -150, sineFullZ: -500,
  halfXStart: 60, halfXFull: 25, halfXStartZ: -150, halfXFullZ: -500,
};

// User's exported lightning settings (mode = RANDOM loop).
const _PRE_T4A_LT_TUNER = {
  frequency: 0.3, leadFactor: 0.6, skyHeight: 55,
  warningTime: 0.3, boltDuration: 0.5, lingerDuration: 4,
  coreRadius: 0.45, glowRadius: 0.25,
  segments: 10, jaggedness: 1.9,
  hitboxScale: 1, warnRadius: 3.5,
  shakeAmt: 0.18, shakeDuration: 0.35,
  glowColor: 0x88c8ff, coreColor: 0xffffff,
  flashColor: 0x99e8ff, warnColor: 0x44a0ff,
  pattern: 'random', laneMin: -8, laneMax: 8,
  sweepSpeed: 0.4, staggerGap: 0.6, salvoCount: 3, pinchSpread: 1,
  count: 1, spawnZ: -83,
};

function _startPreT4ACanyon() {
  // State flags
  state.preT4ACanyon       = true;
  state.preT4AElapsed      = 0;
  state.preT4ADone         = false;
  state._preT4AExitStarted = false;
  // Entry ramp state — mirrors L3 knife: pending → ramping → active.
  // Pushes speed from 2.0× → 2.2× over 0.4s once corridor revealed, snaps
  // physics to L5 immediately. FOV follows via global speed-to-FOV lerp.
  state.preT4ARampPhase = 'pending';
  state.preT4ARampT     = 0;
  // Save originals for restore
  state._preT4ASavedSpeed     = state.speed;
  state._preT4ASavedPhysLevel = _physLevelOverride;
  state._preT4ASavedFOV       = (typeof camera !== 'undefined' && camera) ? camera.fov : 65;
  state._preT4ASavedLT        = window._LT ? Object.assign({}, window._LT) : null;

  // Apply canyon tuner (mode 5, NOT _l4Recreation — standard canyon).
  _canyonMode = 5;
  _canyonTuner._allCyan      = false;
  _canyonTuner._allDark      = false;
  _canyonTuner._l4Recreation = false;
  Object.assign(_canyonTuner, _PRE_T4A_CANYON_TUNER);
  _canyonSinePhase = 0;
  _l4RowsElapsed = 0;
  if (_canyonActive || _canyonExiting || _canyonWalls) _destroyCanyonWalls();
  _canyonExiting = false;
  _canyonActive  = true;
  _canyonManual  = true;
  _jlCorridor.active = false;
  state.corridorGapCenter = state.shipX || 0;
  if (typeof dirLight !== 'undefined' && dirLight) {
    if (_canyonSavedDirLight === null) _canyonSavedDirLight = dirLight.intensity;
    dirLight.intensity = 0;
  }
  _createCanyonWalls();

  // Apply lightning tuner + start RANDOM loop
  if (window._LT) Object.assign(window._LT, _PRE_T4A_LT_TUNER);
  if (typeof window._startLtPattern === 'function') {
    const ok = window._startLtPattern('random');
    if (!ok) console.warn('[PRE-T4A] failed to start RANDOM lightning pattern');
  }

  console.log('[PRE-T4A] ON for ' + _PRE_T4A_DURATION + 's');

  // ── DIAGNOSTIC: dump everything that controls sine tightness ──
  // Fires once on canyon start, then every 2s for 10s while inside.
  // Easy copy/paste back to the agent.
  (function _preT4ADiag() {
    const T = _canyonTuner;
    let n = 0;
    const dump = () => {
      const lines = [
        '════════════ PRE_T4A DIAG (t='+(state.preT4AElapsed||0).toFixed(1)+'s) ════════════',
        'mode='+_canyonMode+'  speed='+state.speed.toFixed(2)+'  rampPhase='+(state.preT4ARampPhase||'?'),
        'sine: period='+T.sinePeriod+'  amp='+T.sineAmp+'  speed='+T.sineSpeed+'  intensity='+T.sineIntensity,
        'sineRamp: startI='+T.sineStartI+'  startZ='+T.sineStartZ+'  fullZ='+T.sineFullZ,
        'halfX: override='+T.halfXOverride+'  start='+T.halfXStart+'  full='+T.halfXFull,
        'scrollSpeed='+T.scrollSpeed+'  spawnDepth='+T.spawnDepth+'  entranceSlabs='+T.entranceSlabs,
        'phase='+_canyonSinePhase.toFixed(3)+'  corridorGapCenter='+(state.corridorGapCenter||0).toFixed(2),
        'effectiveScroll(u/s)='+(state.speed*T.scrollSpeed).toFixed(1)+'  cyclesPerSec='+((state.speed*T.scrollSpeed)/T.sinePeriod).toFixed(3),
        '════════════════════════════════════════════════',
      ];
      console.log(lines.join('\n'));
      window._preT4ADiagLast = lines.join('\n');
    };
    dump();
    const iv = setInterval(() => {
      if (!state.preT4ACanyon || ++n >= 5) { clearInterval(iv); return; }
      dump();
    }, 2000);
  })();
}

function _stopPreT4ACanyon() {
  state.preT4ACanyon = false;
  state.preT4ADone   = true;
  state.preT4ARampPhase = 'off';
  state.preT4ARampT     = 0;
  if (_canyonWalls) _destroyCanyonWalls();
  _canyonActive  = false;
  _canyonExiting = false;
  _canyonManual  = false;
  _jlCorridor.active = false;
  _canyonTuner._l4Recreation = false;
  if (_canyonSavedDirLight !== null && typeof dirLight !== 'undefined' && dirLight) {
    dirLight.intensity = _canyonSavedDirLight;
    _canyonSavedDirLight = null;
  }
  _canyonMode = 0;
  // Stop lightning loop + clear active bolts so T4A starts clean
  if (typeof window._stopLtPattern === 'function') window._stopLtPattern();
  if (typeof window._clearAllLightning === 'function') window._clearAllLightning();
  // Restore lightning tuner to its prior state so other modes aren't affected
  if (state._preT4ASavedLT && window._LT) {
    Object.assign(window._LT, state._preT4ASavedLT);
    state._preT4ASavedLT = undefined;
  }
  // Restore speed/physics
  if (state._preT4ASavedSpeed     !== undefined) { state.speed = state._preT4ASavedSpeed; state._preT4ASavedSpeed = undefined; }
  if (state._preT4ASavedPhysLevel !== undefined) { _physLevelOverride = state._preT4ASavedPhysLevel; state._preT4ASavedPhysLevel = undefined; }
  if (state._preT4ASavedFOV       !== undefined && typeof camera !== 'undefined' && camera) {
    camera.fov = state._preT4ASavedFOV;
    camera.updateProjectionMatrix();
    state._preT4ASavedFOV = undefined;
  }
  console.log('[PRE-T4A] OFF');
}

function _updatePreT4ACanyon(dt) {
  if (!state.preT4ACanyon) return;
  state.preT4AElapsed = (state.preT4AElapsed || 0) + dt;

  // ── Entry ramp: pending → ramping → active ───────────────────────────────
  // Fires when canyon entrance reaches Z=-210 (ship at canyon mouth).
  // Speed lerps to 2.2×, physics snaps to L5, FOV follows via global lerp.
  const _phase = state.preT4ARampPhase || 'pending';
  const _revealed = (typeof _canyonWalls !== 'undefined' && _canyonWalls && _canyonWalls._corridorRevealed);
  if (_phase === 'pending' && _revealed) {
    state.preT4ARampPhase = 'ramping';
    state.preT4ARampT     = 0;
    _physLevelOverride    = 4;
    console.log('[PRE-T4A] entry ramp start (ship at canyon mouth)');
  }
  if (state.preT4ARampPhase === 'ramping') {
    state.preT4ARampT = (state.preT4ARampT || 0) + dt;
    const t = Math.min(1, state.preT4ARampT / _PRE_T4A_RAMP_DURATION);
    const e = 1 - Math.pow(1 - t, 3);
    const startSpeed  = state._preT4ASavedSpeed || (BASE_SPEED * 2.0);
    const targetSpeed = BASE_SPEED * _PRE_T4A_TARGET_SPEED_MULT;
    state.speed = startSpeed + (targetSpeed - startSpeed) * e;
    if (t >= 1) {
      state.preT4ARampPhase = 'active';
      console.log('[PRE-T4A] entry ramp complete — speed=' + state.speed.toFixed(1));
    }
  }

  // Scroll-out exit window: stop spawning new slabs and let existing drift past
  if (!state._preT4AExitStarted && state.preT4AElapsed >= _PRE_T4A_DURATION - _PRE_T4A_EXIT_WINDOW) {
    state._preT4AExitStarted = true;
    if (typeof _canyonActive !== 'undefined')  _canyonActive  = false;
    if (typeof _canyonExiting !== 'undefined') _canyonExiting = true;
    // Also stop firing new lightning bolts — existing bolts age out via
    // _updateLightning while preT4ACanyon flag is still true.
    if (typeof window._stopLtPattern === 'function') window._stopLtPattern();
    console.log('[PRE-T4A] exit scroll-out start');
  }

  // Auto-end after duration. DR sequencer's family.isActive() returns false
  // once preT4ADone=true, advancing to T4A_ANGLED.
  if (state.preT4AElapsed >= _PRE_T4A_DURATION) {
    _stopPreT4ACanyon();
  }
}

// ============================================================================
// PRE-T4B CANYON (preset 1 + chill RANDOM lightning) — 40s canyon corridor
// inserted between T4A_ANGLED and T4B_LETHAL. Pure visual canyon mode 1
// (all-cyan smooth sine) with low-frequency lightning for atmosphere.
// Triggered by DR sequencer family registry entry 'PRE_T4B_CANYON'.
// ============================================================================
const _PRE_T4B_DURATION         = 40.0;
const _PRE_T4B_EXIT_WINDOW      = 4.0;
const _PRE_T4B_RAMP_DURATION    = 0.4;
const _PRE_T4B_TARGET_SPEED_MULT = 2.2;

// Preset 1 visual values — mirrors V tuner preset 1 click. Kept verbatim
// here so a future preset edit doesn't silently change this stage.
const _PRE_T4B_CANYON_TUNER = {
  slabH:55, slabW:20, slabThick:60,
  sineIntensity:0.28, sineAmp:120, sinePeriod:330, sineSpeed:1,
  halfXOverride:34,
  entranceThick:700, entranceSlabs:1, spawnDepth:-250,
  scrollSpeed:1.0,
  _allCyan:true, _allDark:false,
};

// Lightning settings — same RANDOM tuning as pre-T4A canyon but with chill
// frequency (one bolt every ~2s instead of 0.3s).
const _PRE_T4B_LT_TUNER = {
  frequency: 2.0, leadFactor: 0.6, skyHeight: 55,
  warningTime: 0.3, boltDuration: 0.5, lingerDuration: 4,
  coreRadius: 0.45, glowRadius: 0.25,
  segments: 10, jaggedness: 1.9,
  hitboxScale: 1, warnRadius: 3.5,
  shakeAmt: 0.18, shakeDuration: 0.35,
  glowColor: 0x88c8ff, coreColor: 0xffffff,
  flashColor: 0x99e8ff, warnColor: 0x44a0ff,
  pattern: 'random', laneMin: -8, laneMax: 8,
  sweepSpeed: 0.4, staggerGap: 0.6, salvoCount: 3, pinchSpread: 1,
  count: 1, spawnZ: -83,
};

function _startPreT4BCanyon() {
  state.preT4BCanyon       = true;
  state.preT4BElapsed      = 0;
  state.preT4BDone         = false;
  state._preT4BExitStarted = false;
  state.preT4BRampPhase    = 'pending';
  state.preT4BRampT        = 0;
  state._preT4BSavedSpeed     = state.speed;
  state._preT4BSavedPhysLevel = _physLevelOverride;
  state._preT4BSavedFOV       = (typeof camera !== 'undefined' && camera) ? camera.fov : 65;
  state._preT4BSavedLT        = window._LT ? Object.assign({}, window._LT) : null;

  _canyonMode = 1;
  _canyonTuner._allCyan      = false; // cleared first; preset re-asserts true below
  _canyonTuner._allDark      = false;
  _canyonTuner._l4Recreation = false;
  Object.assign(_canyonTuner, _PRE_T4B_CANYON_TUNER);
  _canyonSinePhase = 0;
  _l4RowsElapsed = 0;
  if (_canyonActive || _canyonExiting || _canyonWalls) _destroyCanyonWalls();
  _canyonExiting = false;
  _canyonActive  = true;
  _canyonManual  = true;
  _jlCorridor.active = false;
  state.corridorGapCenter = state.shipX || 0;
  if (typeof dirLight !== 'undefined' && dirLight) {
    if (_canyonSavedDirLight === null) _canyonSavedDirLight = dirLight.intensity;
    dirLight.intensity = 0;
  }
  _createCanyonWalls();

  if (window._LT) Object.assign(window._LT, _PRE_T4B_LT_TUNER);
  if (typeof window._startLtPattern === 'function') {
    const ok = window._startLtPattern('random');
    if (!ok) console.warn('[PRE-T4B] failed to start RANDOM lightning pattern');
  }

  console.log('[PRE-T4B] ON for ' + _PRE_T4B_DURATION + 's (preset 1, lightning freq=2.0s)');
}

function _stopPreT4BCanyon() {
  state.preT4BCanyon = false;
  state.preT4BDone   = true;
  state.preT4BRampPhase = 'off';
  state.preT4BRampT     = 0;
  if (_canyonWalls) _destroyCanyonWalls();
  _canyonActive  = false;
  _canyonExiting = false;
  _canyonManual  = false;
  _jlCorridor.active = false;
  _canyonTuner._l4Recreation = false;
  if (_canyonSavedDirLight !== null && typeof dirLight !== 'undefined' && dirLight) {
    dirLight.intensity = _canyonSavedDirLight;
    _canyonSavedDirLight = null;
  }
  _canyonMode = 0;
  if (typeof window._stopLtPattern === 'function') window._stopLtPattern();
  if (typeof window._clearAllLightning === 'function') window._clearAllLightning();
  if (state._preT4BSavedLT && window._LT) {
    Object.assign(window._LT, state._preT4BSavedLT);
    state._preT4BSavedLT = undefined;
  }
  if (state._preT4BSavedSpeed     !== undefined) { state.speed = state._preT4BSavedSpeed; state._preT4BSavedSpeed = undefined; }
  if (state._preT4BSavedPhysLevel !== undefined) { _physLevelOverride = state._preT4BSavedPhysLevel; state._preT4BSavedPhysLevel = undefined; }
  if (state._preT4BSavedFOV       !== undefined && typeof camera !== 'undefined' && camera) {
    camera.fov = state._preT4BSavedFOV;
    camera.updateProjectionMatrix();
    state._preT4BSavedFOV = undefined;
  }
  console.log('[PRE-T4B] OFF');
}

function _updatePreT4BCanyon(dt) {
  if (!state.preT4BCanyon) return;
  state.preT4BElapsed = (state.preT4BElapsed || 0) + dt;

  // ── Entry ramp: pending → ramping → active ───────────────────────────────
  const _phaseB = state.preT4BRampPhase || 'pending';
  const _revealedB = (typeof _canyonWalls !== 'undefined' && _canyonWalls && _canyonWalls._corridorRevealed);
  if (_phaseB === 'pending' && _revealedB) {
    state.preT4BRampPhase = 'ramping';
    state.preT4BRampT     = 0;
    _physLevelOverride    = 4;
    console.log('[PRE-T4B] entry ramp start (ship at canyon mouth)');
  }
  if (state.preT4BRampPhase === 'ramping') {
    state.preT4BRampT = (state.preT4BRampT || 0) + dt;
    const t = Math.min(1, state.preT4BRampT / _PRE_T4B_RAMP_DURATION);
    const e = 1 - Math.pow(1 - t, 3);
    const startSpeed  = state._preT4BSavedSpeed || (BASE_SPEED * 2.0);
    const targetSpeed = BASE_SPEED * _PRE_T4B_TARGET_SPEED_MULT;
    state.speed = startSpeed + (targetSpeed - startSpeed) * e;
    if (t >= 1) {
      state.preT4BRampPhase = 'active';
      console.log('[PRE-T4B] entry ramp complete — speed=' + state.speed.toFixed(1));
    }
  }

  if (!state._preT4BExitStarted && state.preT4BElapsed >= _PRE_T4B_DURATION - _PRE_T4B_EXIT_WINDOW) {
    state._preT4BExitStarted = true;
    if (typeof _canyonActive !== 'undefined')  _canyonActive  = false;
    if (typeof _canyonExiting !== 'undefined') _canyonExiting = true;
    if (typeof window._stopLtPattern === 'function') window._stopLtPattern();
    console.log('[PRE-T4B] exit scroll-out start');
  }

  if (state.preT4BElapsed >= _PRE_T4B_DURATION) {
    _stopPreT4BCanyon();
  }
}

function spawnGauntletRow() {
  const rowsDone = FUNNEL_TOTAL_ROWS - state.gauntletRowsLeft;

  // Compute wall half-offset (world units from ship center) based on phase
  let halfX;
  if (rowsDone < FUNNEL_CLOSE_ROWS) {
    const t = rowsDone / FUNNEL_CLOSE_ROWS;
    // ease-in so the closing feels dramatic
    halfX = FUNNEL_WIDE_X + (FUNNEL_NARROW_X - FUNNEL_WIDE_X) * (t * t);
  } else if (rowsDone < FUNNEL_CLOSE_ROWS + FUNNEL_HOLD_ROWS) {
    halfX = FUNNEL_NARROW_X;
  } else {
    const t = (rowsDone - FUNNEL_CLOSE_ROWS - FUNNEL_HOLD_ROWS) / FUNNEL_OPEN_ROWS;
    halfX = FUNNEL_NARROW_X + (FUNNEL_WIDE_X - FUNNEL_NARROW_X) * t;
  }

  // Place 1-2 cones on each wall per tick for density
  const wallJitter = 0.8;  // slight random offset so walls don’t look perfectly straight
  for (let side = -1; side <= 1; side += 2) {
    // Primary wall cone — tinted electric cyan so they stand out from level scenery
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      const wx = state.shipX + side * halfX + (Math.random() - 0.5) * wallJitter;
      obs.position.set(wx, 0, SPAWN_Z);
      obs.userData.velX = 0;
      tintObsColor(obs, 0x00ffcc);  // electric cyan — pops against crimson/orange L3 palette
      obs.userData.isCorridor = true;  // immune to laser
      activeObstacles.push(obs);
    }
    // Second cone slightly offset in X to thicken the wall
    const obs2 = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs2) {
      const wx2 = state.shipX + side * (halfX + LANE_WIDTH) + (Math.random() - 0.5) * wallJitter;
      obs2.position.set(wx2, 0, SPAWN_Z);
      obs2.userData.velX = 0;
      tintObsColor(obs2, 0x00ffcc);
      obs2.userData.isCorridor = true;
      activeObstacles.push(obs2);
    }
  }

  state.gauntletRowsLeft--;
  if (state.gauntletRowsLeft <= 0) {
    state.gauntletActive   = false;
    state.gauntletCooldown = FUNNEL_COOLDOWN_ROWS;
  }
}

// ─── L3 CORRIDOR CONSTANTS ───────────────────────────────────────────
const CORRIDOR_WIDE_X    = 80;   // wider than the entire play field — walls span full screen at entry
const CORRIDOR_NARROW_X  = 9;    // tunnel half-width — tight enough to require perpendicular x-wing
const CORRIDOR_CLOSE_ROWS = 40;  // rows to show full funnel squeeze
const CORRIDOR_HOLD_ROWS  = 999; // effectively infinite — we loop via corridorSineT
const CORRIDOR_TOTAL_ROWS = CORRIDOR_CLOSE_ROWS + CORRIDOR_HOLD_ROWS;
const CORRIDOR_STRAIGHT_ROWS = 4;  // brief straight before bends begin (was 12)

const CORRIDOR_AMP_START  = 10;  // initial swing — gentle intro curves
const CORRIDOR_AMP_MAX    = 36;  // max swing — spicy but survivable
const CORRIDOR_AMP_RAMP   = 200; // rows to reach max amplitude (campaign value)
const CORRIDOR_PERIOD_START = 200; // very long lazy arcs at the start
const CORRIDOR_PERIOD_MIN   = 150; // even at max difficulty, each curve is a long sweep
const CORRIDOR_PERIOD_RAMP  = 300; // slow ramp so tightening is barely noticeable

// ─── L4 CORRIDOR CONSTANTS ───────────────────────────────────────────
const L4_CORRIDOR_NARROW_X   = 6;    // tight entry — squeezes further to 3 at peak
const L4_CORRIDOR_CLOSE_ROWS = 35;   // rows to squeeze in
const L4_CORRIDOR_STRAIGHT   = 10;   // straight rows before curves
const L4_CORRIDOR_AMP_START  = 14;
const L4_CORRIDOR_AMP_MAX    = 44;   // deeper banks than L3
const L4_CORRIDOR_AMP_RAMP   = 120;  // ramps up faster
const L4_CORRIDOR_PERIOD_START = 220; // long lazy arcs at entry
const L4_CORRIDOR_PERIOD_MIN   = 160; // still a long sweep even at peak
const L4_CORRIDOR_PERIOD_RAMP  = 260;
const L4_CORRIDOR_TINT       = 0xff00aa; // hot magenta

// ─── L5 ZIPPER CONSTANTS ─────────────────────────────────────────────
const ZIPPER_ROWS        = 13;   // rows per zipper burst — last 2 rows have wider exit gap
const ZIPPER_COOLDOWN    = 30;   // rows of normal play between zippers
const ZIPPER_GAP_HALF    = 7.5;  // half-width of the open gate — wider so first row from center is passable
const ZIPPER_OFFSET      = 11;   // gate offset — forces a committed move without being punishing over 13 rows
const ZIPPER_TINT        = 0xffcc00; // gold — matches L5 grid color
const L4_CORRIDOR_TRIGGER_S  = 22;   // seconds into L4 before corridor starts
const L4_CORRIDOR_DURATION_S = 50;   // longer run — nearly a minute of corridor

// ─── L5 SINE CORRIDOR CONSTANTS ──────────────────────────────────────
const L5C_CLOSE_ROWS      = 29;   // ~203 world-units of gradual squeeze (29 × 7)
const L5C_WIDE_X          = 48;   // walls visible as they close — not off-screen
const L5C_NARROW_X        = 10;   // final tunnel half-width — wider than L3 (9) since L5 speed is higher
const L5C_STRAIGHT_ROWS   = 12;   // straight rows after squeeze before sine kicks in
const L5C_TOTAL_ROWS      = 420;  // full corridor duration
const L5C_EXIT_ROWS       = 20;   // last N rows widen back out
const L5C_TINT            = 0xffcc00; // gold
const L5C_AMP_START       = 10;   // gentle intro swing
const L5C_AMP_MAX         = 40;   // deeper than L3 (36) — harder sweep
const L5C_AMP_RAMP        = 180;  // rows to reach max amp
const L5C_PERIOD_START    = 200;  // long lazy arcs at entry
const L5C_PERIOD_MIN      = 140;  // faster than L3 (150) at peak
const L5C_PERIOD_RAMP     = 280;
const L5C_CENTER_CONE_INTERVAL = 12;  // spawn a center hazard cone every N rows (after squeeze+straight)

// ─── PHYSICS-DRIVEN CORRIDOR (Death Run) ─────────────────────────────
// Gap position is driven by ship reachability physics instead of fixed sine waves.
// The gap has a target velocity that it smoothly tracks. Direction reverses
// periodically, creating S-curves bounded by what the ship can physically follow.
//
// Difficulty (0-1) = fraction of ship MAX_VEL the gap moves at.
// halfGap = half-width of the corridor opening.



const _drCorridorState = { gapX: 0, gapVelX: 0, targetVelX: 0, sweepTimer: 0 };
const DR_CORRIDOR_HALF_GAP = 5;       // total gap = 10 units
const DR_CORRIDOR_MAX_WANDER = 28;    // max gap distance from center
const DR_CORRIDOR_VEL_LERP = 3.5;     // how fast gap vel tracks target (higher = sharper turns)
// Difficulty per speed tier: T0=easy curves, T3=demanding
const DR_CORRIDOR_DIFF = [0.55, 0.65, 0.72, 0.80];

function _drResetCorridorState() {
  _drCorridorState.gapX = state.shipX;
  _drCorridorState.gapVelX = 0;
  _drCorridorState.targetVelX = 0;
  _drCorridorState.sweepTimer = 0;
}

// Returns the gap center X for the next corridor row in death run.
function _drNextGapCenter(diffOverride) {
  const tier = (state.deathRunSpeedTier || 0);
  const physIdx = Math.min(tier + 1, 4);
  const _lvlT = physIdx / (LEVELS.length - 1);
  const _snap = _lvlT * _lvlT;
  const maxVel = 9 + _snap * 13;
  const fwdSpeed = state.speed || (BASE_SPEED * LEVELS[physIdx].speedMult);
  const tRow = 7 / fwdSpeed; // time between rows

  const diff = diffOverride != null ? diffOverride : DR_CORRIDOR_DIFF[Math.min(tier, 3)];
  const gapMaxSpeed = maxVel * diff;
  const cs = _drCorridorState;

  // Sweep timer: pick a new target direction when it expires
  cs.sweepTimer -= tRow;
  if (cs.sweepTimer <= 0) {
    const minDur = 0.4;
    const maxDur = 2.0 - diff * 0.8;
    cs.sweepTimer = minDur + Math.random() * (maxDur - minDur);
    const spd = gapMaxSpeed * (0.5 + Math.random() * 0.5);

    if (Math.abs(cs.gapX - state.shipX) > DR_CORRIDOR_MAX_WANDER * 0.7) {
      // Too far from ship — push back
      cs.targetVelX = -Math.sign(cs.gapX - state.shipX) * spd;
    } else {
      // Zigzag: usually reverse, occasionally sustain
      const zig = cs.gapVelX > 0 ? -1 : 1;
      if (Math.random() < 0.7) {
        cs.targetVelX = zig * spd;
      } else {
        cs.targetVelX = -zig * spd;
        cs.sweepTimer *= 1.5; // extend sustained sweeps
      }
    }
  }

  // Smooth velocity toward target
  cs.gapVelX += (cs.targetVelX - cs.gapVelX) * Math.min(1, DR_CORRIDOR_VEL_LERP * tRow);
  cs.gapVelX = Math.max(-gapMaxSpeed, Math.min(gapMaxSpeed, cs.gapVelX));
  cs.gapX += cs.gapVelX * tRow;

  // Push gap away from ship if it gets too close — forces player to always dodge
  const _minGapFromShip = 14;
  if (Math.abs(cs.gapX - state.shipX) < _minGapFromShip) {
    const _pushDir = cs.gapVelX >= 0 ? 1 : -1;
    cs.gapX = state.shipX + _pushDir * _minGapFromShip;
    cs.targetVelX = _pushDir * gapMaxSpeed;
    cs.sweepTimer = 0;
  }

  // Boundary clamp
  const absFromShipStart = Math.abs(cs.gapX);
  if (absFromShipStart > DR_CORRIDOR_MAX_WANDER) {
    cs.gapX = Math.sign(cs.gapX) * DR_CORRIDOR_MAX_WANDER;
    cs.gapVelX *= -0.5;
    cs.targetVelX = -Math.sign(cs.gapX) * gapMaxSpeed;
    cs.sweepTimer = 0.5;
  }

  return cs.gapX;
}

// ─── FORCEFIELD GATE (Slalom) ────────────────────────────────────────
// Animated energy barrier stretched between two slalom cones.
// Custom ShaderMaterial: hex scanline + Fresnel edge glow + ripple.

const FORCEFIELD_POOL_SIZE = 20;
const _ffPool = [];
const _activeForcefields = [];

const _ffUniforms = { uTime: { value: 0.0 } };

const _ffVertShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const _ffFragShader = `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    // Fresnel — edges brighter
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel = pow(fresnel, 1.8);

    // Center-heavy opacity: strongest in the middle of the plane
    float centerX = 1.0 - 2.0 * abs(vUv.x - 0.5); // 1 at center, 0 at edges
    float centerY = 1.0 - 2.0 * abs(vUv.y - 0.5);
    float center = centerX * centerY;
    center = pow(center, 0.6); // soften falloff

    // Subtle slow shimmer
    float shimmer = 0.9 + 0.1 * sin(vUv.y * 6.0 - uTime * 3.0);

    // Alpha: opaque center, fading to edges
    float alpha = (0.3 + center * 0.55) * shimmer;
    alpha += fresnel * 0.15;
    alpha = clamp(alpha, 0.15, 0.8);

    // Clean blue gradient: deep center, lighter edges
    vec3 deepBlue  = vec3(0.05, 0.2, 0.8);
    vec3 brightBlue = vec3(0.2, 0.55, 1.0);
    vec3 col = mix(brightBlue, deepBlue, center);
    col += vec3(0.15, 0.3, 0.5) * fresnel; // edge highlight
    col *= shimmer;
    col *= 1.5; // slight HDR for bloom

    gl_FragColor = vec4(col, alpha);
  }
`;

function createForcefieldMesh() {
  const geo = new THREE.PlaneGeometry(1, 4, 1, 8); // width=1 (scaled per gap), height=4
  const mat = new THREE.ShaderMaterial({
    uniforms: _ffUniforms,
    vertexShader: _ffVertShader,
    fragmentShader: _ffFragShader,
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.active = false;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

for (let i = 0; i < FORCEFIELD_POOL_SIZE; i++) _ffPool.push(createForcefieldMesh());

function returnForcefieldToPool(ff) {
  ff.userData.active = false;
  ff.visible = false;
  ff.scale.set(1, 1, 1);
}

// ─── SLALOM MINEFIELD (Death Run) ────────────────────────────────────
// Slalom minefield: uniform staggered grid of cones — no carved gap.
// Even rows: cones at 0, ±S, ±2S, …  Odd rows offset by S/2 (brick pattern).
// Ship must weave through the grid openings. Spacing tuned so ship always fits.

const SLALOM_SPACING    = 30.0;         // lateral distance between cones
const SLALOM_FIELD_HALF = 90;           // cone field spans ±90
const SLALOM_Z_SPACING  = 60;           // z-distance between rows
const SLALOM_TINT       = 0xff44aa;     // hot pink — distinct from corridor colors

// Closing doors pattern: two fat walls with a gap that shifts position each row.
// Gap is ~8 units wide (ship is 3), position moves left/right/center randomly.
// Forcefield spans one side, coins sit in the gap to reward threading the needle.

const SLALOM_GAP_WIDTH = 8;       // gap the player must fly through
const SLALOM_WALL_HALF = 500;     // total wall span ±500

function spawnSlalomRow() {
  const row = state.slalomRowsDone;

  let gapCenter;
  if (state.slalomUsePhysicsCurve) {
    // Physics-based curving gap — uses _drNextGapCenter for smooth sweeps
    gapCenter = _drNextGapCenter(0.7);
  } else {
    // Random lane pick — never repeat the same twice
    const laneOptions = [-18, -9, 0, 9, 18];
    if (state._lastSlalomGap === undefined) state._lastSlalomGap = -999;
    do {
      gapCenter = laneOptions[Math.floor(Math.random() * laneOptions.length)];
    } while (gapCenter === state._lastSlalomGap);
    state._lastSlalomGap = gapCenter;
  }

  const _sgw = state._slalomGapWidth || SLALOM_GAP_WIDTH;
  const gapLeft  = gapCenter - _sgw * 0.5;
  const gapRight = gapCenter + _sgw * 0.5;

  // Left wall: cones from -WALL_HALF to gapLeft (skip ~30% for random gaps)
  const coneScale = 4;
  for (let x = -SLALOM_WALL_HALF; x < gapLeft - 1; x += 14) {
    if (Math.random() < 0.3) continue; // random gap
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      obs.position.set(x, 0, SPAWN_Z);
      obs.scale.set(coneScale, 1, coneScale);
      obs.userData.velX = 0;
      obs.userData.isCorridor = false; // lasers CAN destroy slalom cones
      obs.userData.slalomScaled = true;
      tintObsColor(obs, SLALOM_TINT);
      activeObstacles.push(obs);
    }
  }

  // Right wall: cones from gapRight to +WALL_HALF (skip ~30% for random gaps)
  for (let x = gapRight + 1; x <= SLALOM_WALL_HALF; x += 14) {
    if (Math.random() < 0.3) continue; // random gap
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      obs.position.set(x, 0, SPAWN_Z);
      obs.scale.set(coneScale, 1, coneScale);
      obs.userData.velX = 0;
      obs.userData.isCorridor = false; // lasers CAN destroy slalom cones
      obs.userData.slalomScaled = true;
      tintObsColor(obs, SLALOM_TINT);
      activeObstacles.push(obs);
    }
  }

  // Coins in the gap — reward threading the needle
  const coinCount = 3;
  for (let i = 0; i < coinCount; i++) {
    const coin = getPooledCoin();
    if (coin) {
      const cx = gapLeft + (i + 1) * (_sgw / (coinCount + 1));
      coin.position.set(cx, 1.2, SPAWN_Z);
      coin.userData.spinPhase = Math.random() * Math.PI * 2;
      activeCoins.push(coin);
    }
  }

  state.slalomRowsDone++;
}



// ── Custom pattern from level editor ──
const DR_CUSTOM_PATTERN_1 = [
[5,7,9,11,13,15,17,19,21,23],
[5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[],
[],
[],
[],
[],
[],
[5,7,9,11,13,15,17,19,21,23],
[5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[],
[],
[],
[],
[],
[],
[5,7,9,11,13,15,17,19,21,23],
[5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[],
[],
[],
[],
[],
[],
[5,7,9,11,13,15,17,19,21,23],
[5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[],
[],
[],
[],
[],
[],
[-5,-4,-3,-2,-1,2,3,4,5,7,9,11,13,15,17,19,21,23],
[-5,-4,-3,-2,-1,2,3,4,5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5,-2,-1,0,1],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5,-2,-1,0,1],
[],
[],
[],
[],
[],
[],
[2,3,4,5,7,9,11,13,15,17,19,21,23],
[2,3,4,5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5,-3,-2,-1,0],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5,-3],
[],
[],
[],
[],
[],
[],
[0,1,2,3,4,5,7,9,11,13,15,17,19,21,23],
[0,1,2,3,4,5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[40],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5]
];

function spawnCustomPatternRow() {
  const rowIdx = state.drCustomPatternRow;
  if (rowIdx >= DR_CUSTOM_PATTERN_1.length) {
    state.drCustomPatternActive = false;
    // Wave director handles rest/transition in its phase tick
    return;
  }
  const xPositions = DR_CUSTOM_PATTERN_1[rowIdx];
  const offsetX = state.shipX; // center pattern on player
  const xScale = 3; // widen spacing between all cones
  for (let i = 0; i < xPositions.length; i++) {
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (!obs) continue;
    obs.position.set(xPositions[i] * xScale + offsetX + (Math.random() - 0.5) * 0.5, 0, SPAWN_Z);
    obs.userData.velX = 0;
    obs.userData.isCorridor = true;
    tintObsColor(obs, 0xff1a8c);
    activeObstacles.push(obs);
  }
  state.drCustomPatternRow++;
}

function spawnL5CorridorRow() {
  const rowsDone = state.l5CorridorRowsDone;
  const maxRows = state._drL5MaxRows || L5C_TOTAL_ROWS;
  const exitRows = L5C_EXIT_ROWS; // 20 rows

  // Squeeze phase: walls close in from ±48 to ±L5C_NARROW_X over L5C_CLOSE_ROWS
  let halfX;
  if (rowsDone < L5C_CLOSE_ROWS) {
    const t = rowsDone / L5C_CLOSE_ROWS;
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    halfX = L5C_WIDE_X + (L5C_NARROW_X - L5C_WIDE_X) * ease;
  } else {
    const curveRowsForSqueeze = Math.max(0, rowsDone - (L5C_CLOSE_ROWS + L5C_STRAIGHT_ROWS));
    const squeezeT = Math.min(1, curveRowsForSqueeze / L5C_AMP_RAMP);
    halfX = L5C_NARROW_X - (L5C_NARROW_X - (L5C_NARROW_X - 2)) * (squeezeT * squeezeT);
  }

  // Exit ramp: last 20 rows widen back out (works for both campaign and DR)
  if (rowsDone >= maxRows - exitRows) {
    const exitT = (rowsDone - (maxRows - exitRows)) / exitRows;
    const ease = exitT < 0.5 ? 2*exitT*exitT : -1+(4-2*exitT)*exitT;
    halfX = halfX + (L5C_WIDE_X - halfX) * ease;
  }

  // Sine-driven center — amplitude and period evolve progressively.
  // Anchored on the ship's X at activation (see L5_SINE_CORRIDOR.activate which
  // sets state._l5CenterAnchor) so the squeeze forms around the player instead
  // of world origin. Sine sweep oscillates relative to this anchor.
  const _l5Anchor = (typeof state._l5CenterAnchor === 'number') ? state._l5CenterAnchor : 0;
  state.l5SineT = (state.l5SineT || 0);
  let center = _l5Anchor;
  if (rowsDone >= L5C_CLOSE_ROWS + L5C_STRAIGHT_ROWS) {
    const curveRows = rowsDone - (L5C_CLOSE_ROWS + L5C_STRAIGHT_ROWS);
    const ampT   = Math.min(1, curveRows / L5C_AMP_RAMP);
    const amp    = L5C_AMP_START + (L5C_AMP_MAX - L5C_AMP_START) * (ampT * ampT);
    const perT   = Math.min(1, curveRows / L5C_PERIOD_RAMP);
    const period = L5C_PERIOD_START - (L5C_PERIOD_START - L5C_PERIOD_MIN) * (perT * perT);
    state.l5SineT += (2 * Math.PI) / period;
    center = _l5Anchor + amp * Math.sin(state.l5SineT);
  } else {
    state.l5SineT = 0;
    center = _l5Anchor;
  }
  state.corridorGapCenter = center; // share for bend detection

  const wallJitter = 0.6;
  for (let side = -1; side <= 1; side += 2) {
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      obs.position.set(center + side * halfX + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs.userData.velX = 0;
      tintObsColor(obs, L5C_TINT);
      obs.userData.isCorridor = true;
      activeObstacles.push(obs);
    }
    const obs2 = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs2) {
      obs2.position.set(center + side * (halfX + LANE_WIDTH) + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs2.userData.velX = 0;
      tintObsColor(obs2, L5C_TINT);
      obs2.userData.isCorridor = true;
      activeObstacles.push(obs2);
    }
  }

  // Center hazard cone: spawns every L5C_CENTER_CONE_INTERVAL rows, only after sine kicks in
  // Not during exit rows so the finish stays clean
  const sineStartRow = L5C_CLOSE_ROWS + L5C_STRAIGHT_ROWS;
  const sinceStart = rowsDone - sineStartRow;
  const isExiting = rowsDone >= L5C_TOTAL_ROWS - L5C_EXIT_ROWS;
  if (sinceStart > 0 && sinceStart % L5C_CENTER_CONE_INTERVAL === 0 && !isExiting) {
    const mid = getPooledObstacle(Math.floor(Math.random() * 3));
    if (mid) {
      mid.position.set(center, 0, SPAWN_Z);
      mid.userData.velX = 0;
      tintObsColor(mid, L5C_TINT);
      mid.userData.isCorridor = true;
      activeObstacles.push(mid);
    }
  }

  state.l5CorridorRowsDone++;
}

function spawnL4CorridorRow() {
  state.l4RowsDone = (state.l4RowsDone || 0);
  const rowsDone = state.l4RowsDone;
  const maxRows = state._drL4MaxRows || 999;
  const exitRows = 20; // widen back out over last 20 rows

  // Squeeze phase
  let halfX;
  if (rowsDone < L4_CORRIDOR_CLOSE_ROWS) {
    const t = rowsDone / L4_CORRIDOR_CLOSE_ROWS;
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    halfX = CORRIDOR_WIDE_X + (L4_CORRIDOR_NARROW_X - CORRIDOR_WIDE_X) * ease;
  } else {
    const curveRows = Math.max(0, rowsDone - (L4_CORRIDOR_CLOSE_ROWS + L4_CORRIDOR_STRAIGHT));
    const squeezeT  = Math.min(1, curveRows / L4_CORRIDOR_AMP_RAMP);
    let   baseHalfX = L4_CORRIDOR_NARROW_X - (L4_CORRIDOR_NARROW_X - 4.5) * (squeezeT * squeezeT);
    // Knife-edge window: rows 370-395
    const knifeStart = 370, knifeEnd = 395;
    if (curveRows >= knifeStart && curveRows < knifeEnd) {
      const knifeT = (curveRows - knifeStart) / (knifeEnd - knifeStart);
      const spike = 1 - Math.abs(knifeT * 2 - 1);
      baseHalfX = baseHalfX - (baseHalfX - 3) * spike;
      if (curveRows === knifeStart) console.log('[L4-DEBUG] KNIFE-EDGE START, halfX=' + baseHalfX.toFixed(1) + ', curveRow=' + curveRows);
    }
    halfX = baseHalfX;
  }
  // Exit ramp: last 20 rows widen back out (works for both campaign and DR)
  if (rowsDone >= maxRows - exitRows) {
    const exitT = Math.min(1, (rowsDone - (maxRows - exitRows)) / exitRows);
    halfX = halfX + (CORRIDOR_WIDE_X - halfX) * exitT;
  }

  // Sine curves — anchored on the ship's X at activation (see
  // L4_SINE_CORRIDOR.activate which sets state._l4CenterAnchor). The straight
  // squeeze section sits at the anchor; the sine sweep oscillates relative to it.
  const _l4Anchor = (typeof state._l4CenterAnchor === 'number') ? state._l4CenterAnchor : 0;
  state.l4SineT = (state.l4SineT || 0);
  let center = _l4Anchor;
  if (rowsDone >= L4_CORRIDOR_CLOSE_ROWS + L4_CORRIDOR_STRAIGHT) {
    const curveRows = rowsDone - (L4_CORRIDOR_CLOSE_ROWS + L4_CORRIDOR_STRAIGHT);
    const ampT  = Math.min(1, curveRows / L4_CORRIDOR_AMP_RAMP);
    const amp   = L4_CORRIDOR_AMP_START + (L4_CORRIDOR_AMP_MAX - L4_CORRIDOR_AMP_START) * (ampT * ampT);
    const perT  = Math.min(1, curveRows / L4_CORRIDOR_PERIOD_RAMP);
    const period = L4_CORRIDOR_PERIOD_START - (L4_CORRIDOR_PERIOD_START - L4_CORRIDOR_PERIOD_MIN) * (perT * perT);
    state.l4SineT += (2 * Math.PI) / period;
    center = _l4Anchor + amp * Math.sin(state.l4SineT);
  } else {
    state.l4SineT = 0;
    center = _l4Anchor;
  }
  state.corridorGapCenter = center; // share for bend detection

  const wallJitter = 0.6;
  for (let side = -1; side <= 1; side += 2) {
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      obs.position.set(center + side * halfX + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs.userData.velX = 0;
      tintObsColor(obs, L4_CORRIDOR_TINT);
      obs.userData.isCorridor = true;
      activeObstacles.push(obs);
    }
    const obs2 = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs2) {
      obs2.position.set(center + side * (halfX + LANE_WIDTH) + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs2.userData.velX = 0;
      tintObsColor(obs2, L4_CORRIDOR_TINT);
      obs2.userData.isCorridor = true;
      activeObstacles.push(obs2);
    }
  }

  state.l4RowsDone++;
}

function spawnCorridorRow() {
  // Row counter drives the squeeze from wide entry to tight tunnel
  state.corridorRowsDone = (state.corridorRowsDone || 0);
  const rowsDone = state.corridorRowsDone;
  const _l3MaxRows = state._drL3MaxRows || 999;
  const _l3ExitRows = 20;

  // Squeeze phase: wide at horizon, narrows over CORRIDOR_CLOSE_ROWS
  let halfX;
  if (rowsDone < CORRIDOR_CLOSE_ROWS) {
    const t = rowsDone / CORRIDOR_CLOSE_ROWS;
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    halfX = CORRIDOR_WIDE_X + (CORRIDOR_NARROW_X - CORRIDOR_WIDE_X) * ease;
  } else {
    const curveRowsForSqueeze = Math.max(0, rowsDone - (CORRIDOR_CLOSE_ROWS + CORRIDOR_STRAIGHT_ROWS));
    const squeezeT = Math.min(1, curveRowsForSqueeze / CORRIDOR_AMP_RAMP);
    halfX = CORRIDOR_NARROW_X - (CORRIDOR_NARROW_X - 6) * (squeezeT * squeezeT);
  }
  // DR exit ramp: last 20 rows widen back out
  if (state.isDeathRun && rowsDone >= _l3MaxRows - _l3ExitRows) {
    const exitT = Math.min(1, (rowsDone - (_l3MaxRows - _l3ExitRows)) / _l3ExitRows);
    halfX = halfX + (CORRIDOR_WIDE_X - halfX) * exitT;
  }

  // Sine-driven corridor center — amplitude and period evolve progressively
  state.corridorSineT = (state.corridorSineT || 0);
  let center = 0;
  if (rowsDone >= CORRIDOR_CLOSE_ROWS + CORRIDOR_STRAIGHT_ROWS) {
    // How many curve rows have elapsed since curves began
    const curveRows = rowsDone - (CORRIDOR_CLOSE_ROWS + CORRIDOR_STRAIGHT_ROWS);
    // Amplitude: ramps from AMP_START to AMP_MAX over CORRIDOR_AMP_RAMP rows
    const ampT   = Math.min(1, curveRows / CORRIDOR_AMP_RAMP);
    const amp    = CORRIDOR_AMP_START + (CORRIDOR_AMP_MAX - CORRIDOR_AMP_START) * (ampT * ampT);
    // Period: shrinks from PERIOD_START to PERIOD_MIN over CORRIDOR_PERIOD_RAMP rows
    const perT   = Math.min(1, curveRows / CORRIDOR_PERIOD_RAMP);
    const period = CORRIDOR_PERIOD_START - (CORRIDOR_PERIOD_START - CORRIDOR_PERIOD_MIN) * (perT * perT);
    // Advance phase accumulator — one row = 2π/period radians
    state.corridorSineT += (2 * Math.PI) / period;
    center = amp * Math.sin(state.corridorSineT);
  } else {
    state.corridorSineT = 0;
    center = 0;
  }

  // Canyon mode: skip cone spawning, just use the sine for wall tracking
  // Do NOT overwrite corridorGapCenter when slab canyon is active — it owns that value
  if (_canyonActive) { if (!_canyonManual) state.corridorRowsDone++; return; }
  state.corridorGapCenter = center;

  const wallJitter = 0.6;

  for (let side = -1; side <= 1; side += 2) {
    // Inner wall cone — right at the gap edge
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      obs.position.set(center + side * halfX + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs.userData.velX = 0;
      obs.userData.isCorridor = true;
      tintObsColor(obs, 0x00ffcc);
      activeObstacles.push(obs);
    }
    // Outer wall cone — one lane further out to thicken the wall
    const obs2 = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs2) {
      obs2.position.set(center + side * (halfX + LANE_WIDTH) + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs2.userData.velX = 0;
      tintObsColor(obs2, 0x00ffcc);
      obs2.userData.isCorridor = true;
      activeObstacles.push(obs2);
    }
  }

  // Advance row counter, loop after TOTAL_ROWS (skip close phase on repeat)
  state.corridorRowsDone++;
  if (state.corridorRowsDone >= CORRIDOR_TOTAL_ROWS) {
    state.corridorRowsDone = CORRIDOR_CLOSE_ROWS + 1; // loop stays in hold phase — never re-trigger funnel
  }
}


function spawnZipperRow() {
  // Gate is offset to one side — cones fill the other side, leaving a narrow gap
  // Each row flips side so player must zigzag hard left/right/left/right
  const side   = state.zipperSide;  // +1 = gap is to the right, -1 = gap is to the left
  const center = state.shipX;
  const gapCX  = center + side * ZIPPER_OFFSET;  // center of the open gap

  // Spawn a wall of cones from the opposite edge inward, stopping before the gap
  // and another wall from the far opposite edge — only the ZIPPER_GAP_HALF window is clear
  const zipLaneCount = LANE_COUNT * 8; // 8x wider — fill lateral vision completely
  const totalHalf = zipLaneCount * LANE_WIDTH * 0.5;
  const gapLeft   = gapCX - ZIPPER_GAP_HALF;
  const gapRight  = gapCX + ZIPPER_GAP_HALF;

  // Last 2 rows get a wider gap as a reward for surviving
  const rowsDone = ZIPPER_ROWS - state.zipperRowsLeft;
  const isExit = rowsDone >= ZIPPER_ROWS - 2;
  const effectiveGapHalf = isExit ? ZIPPER_GAP_HALF * 1.9 : ZIPPER_GAP_HALF;
  const gapLeft2  = gapCX - effectiveGapHalf;
  const gapRight2 = gapCX + effectiveGapHalf;

  // Fill lanes that fall outside the gap window
  for (let i = 0; i < zipLaneCount; i++) {
    const lx = center + (i - (zipLaneCount - 1) / 2) * LANE_WIDTH;
    if (lx >= gapLeft2 && lx <= gapRight2) continue;
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (!obs) continue;
    obs.position.set(lx + (Math.random() - 0.5) * 0.5, 0, SPAWN_Z);
    obs.userData.velX = 0;
    tintObsColor(obs, ZIPPER_TINT);
    obs.userData.isCorridor = true;
    activeObstacles.push(obs);
  }

  // Alternate gate side every row — the core zipper mechanic
  state.zipperSide *= -1;

  state.zipperRowsLeft--;
  if (state.zipperRowsLeft <= 0) {
    state.zipperActive   = false;
    state.zipperRunCount++;
    if (state.isDeathRun) {
      state.deathRunRestBeat = 1.0 + Math.random() * 0.5; // brief rest
      state.drPatternCooldown = 3 + Math.random() * 2;
    } else if (state.zipperRunCount >= 2) {
      // 2nd zipper done — start post-zipper random cone cooldown before ending
      state.l5RandomAfterZipper = 8.0;  // 8s of random cones then sail out
      state.zipperCooldown = 99999;     // never trigger another zipper
      l5DustPoints.visible = true;      // chromatic dust from 2nd zipper onward
      // Title music fires later — when the L5 corridor finishes (see corridor completion block)
    } else {
      state.zipperCooldown = ZIPPER_COOLDOWN;
    }
  }
}


// ── LETHAL RING POOL (black octagon torus with red neon band, like cones) ──
const _lethalRingPool = [];
const _lethalRingActive = [];
const LETHAL_RING_POOL_SIZE = 20;
const _LR_SIDES = 8, _LR_R = 5.25, _LR_Y = 2, _LR_TUBE = 2.2;
let _lrGeo = null;
let _lrMatTemplate = null;
function _initLethalRings() {
  if (_lethalRingPool.length > 0) return;
  // Build octagon torus: a tube that follows the octagon path
  const pathPts = [];
  for (let s = 0; s <= _LR_SIDES; s++) {
    const angle = (s / _LR_SIDES) * Math.PI * 2;
    pathPts.push(new THREE.Vector3(Math.cos(angle) * _LR_R, Math.sin(angle) * _LR_R, 0));
  }
  const path = new THREE.CatmullRomCurve3(pathPts, true);
  _lrGeo = new THREE.TubeGeometry(path, _LR_SIDES * 4, _LR_TUBE, 8, true);
  _lrMatTemplate = new THREE.ShaderMaterial({
    uniforms: {
      uNeon:    { value: new THREE.Color(0xff1a1a) },
      uObsidian:{ value: new THREE.Color(0x0a0a0f) },
      uOpacity: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uNeon;
      uniform vec3 uObsidian;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float band = smoothstep(0.3, 0.5, vUv.y) * (1.0 - smoothstep(0.5, 0.7, vUv.y));
        vec3 glow = uNeon * (1.0 + band * 4.0);
        vec3 col = mix(uObsidian, glow, band);
        gl_FragColor = vec4(col, uOpacity);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  for (let i = 0; i < LETHAL_RING_POOL_SIZE; i++) {
    const mat = _lrMatTemplate.clone();
    const mesh = new THREE.Mesh(_lrGeo, mat);
    mesh.position.y = _LR_Y;
    const group = new THREE.Group();
    group.add(mesh);
    group.visible = false;
    group.userData.active = false;
    group.userData.lethalRing = true;
    group.userData._ringMesh = mesh;
    scene.add(group);
    _lethalRingPool.push(group);
  }
}
function _spawnLethalRing(x, z) {
  _initLethalRings();
  for (const r of _lethalRingPool) {
    if (!r.userData.active) {
      r.userData.active = true;
      r.visible = true;
      r.position.set(x, 0, z);
      r.userData._ringMesh.material.uniforms.uOpacity.value = 0;
      _lethalRingActive.push(r);
      return;
    }
  }
}

// ── Lateral echo helper — spawns matching obstacle copies at lateral offsets ──
// Tiles the same obstacle type outward to fill peripheral vision.
const _ECHO_SHIFT = LANE_COUNT * LANE_WIDTH; // one full road width per copy (~67.2)
const _ECHO_COPIES = 2; // copies per side (2 left + 2 right)
const _ECHOES_ENABLED = false; // toggle — off until obstacle redesign
function _spawnLateralEchoes(baseX, z, kind, opts) {
  if (!_ECHOES_ENABLED) return;
  // kind: 'cone' | 'wall' | 'ring' | 'fatcone'
  for (let c = 1; c <= _ECHO_COPIES; c++) {
    const echoOpacity = 1 / Math.pow(2, c); // 0.5 for copy 1, 0.25 for copy 2
    for (const sign of [-1, 1]) {
      const ex = baseX + sign * c * _ECHO_SHIFT;
      if (kind === 'cone') {
        const obs = getPooledObstacle(Math.floor(Math.random() * 3));
        if (!obs) continue;
        obs.position.set(ex + (Math.random() - 0.5) * 0.6, 0, z);
        obs.userData.velX = 0;
        obs.userData.isEcho = true;
        // Cap max opacity so echoes fade with distance
        const _mc = obs.userData._meshes;
        for (let mi = 0; mi < _mc.length; mi++) _mc[mi].material.userData.baseOpacity = echoOpacity;
        activeObstacles.push(obs);
      } else if (kind === 'fatcone') {
        const obs = getPooledObstacle(Math.floor(Math.random() * 3));
        if (!obs) continue;
        obs.position.set(ex + (Math.random() - 0.5) * 0.6, 0, z);
        obs.scale.set(4, 1, 4);
        obs.userData.velX = 0;
        obs.userData.slalomScaled = true;
        obs.userData.isFatCone = true;
        obs.userData.isEcho = true;
        const _mc = obs.userData._meshes;
        for (let mi = 0; mi < _mc.length; mi++) _mc[mi].material.userData.baseOpacity = echoOpacity;
        activeObstacles.push(obs);
      } else if (kind === 'wall') {
        const wall = _getPooledWall();
        if (!wall) continue;
        const angleSign = (opts && opts.angleSign) || (Math.random() < 0.5 ? 1 : -1);
        wall.position.set(ex + (Math.random() - 0.5) * 0.6, 0, z);
        wall.rotation.set(0, 0, 0);
        wall.userData._mesh.scale.set(8, 4, 0.3);
        wall.userData._edges.scale.set(8, 4, 0.3);
        wall.userData._mesh.position.y = 2;
        wall.userData._edges.position.y = 2;
        wall.rotation.y = angleSign * (25 + Math.random() * 20) * Math.PI / 180;
        wall.userData._mesh.material.uniforms.uOpacity.value = 0;
        wall.userData._edges.material.opacity = 0;
        wall.userData.isEcho = true;
        wall.userData.echoOpacity = echoOpacity; // wall fade handled separately
        _awActive.push(wall);
      } else if (kind === 'ring') {
        _spawnLethalRing(ex + (Math.random() - 0.5) * 0.6, z);
        // rings fade via their own system — no baseOpacity hook available
      }
    }
  }
}

function spawnObstacles() {
  let lvl;
  if (state.isDeathRun) {
    // Sequencer density: sparse (T1) vs dense (T2) vs normal (T3+) vs endless
    const _density = state._seqConeDensity || 'normal';
    let obs, maxObs, gap;
    if (_density === 'sparse') {
      obs = 5; maxObs = 7; gap = 1.0;
    } else if (_density === 'dense') {
      obs = 6; maxObs = 8; gap = 1.0;
    } else if (_density === 'ramp') {
      // Linear ramp 5→9 over the stage. _seqRampT01 set by sequencer tick.
      const t = state._seqRampT01 || 0;
      obs = Math.round(5 + 4 * t);
      maxObs = obs + 2;
      gap = 1.0;
    } else if (_density === 'normal') {
      // Sequencer 'normal' = moderate scatter, not the brutal endless-mode count
      // (old 'normal' fell into the 27-36 cone path — an impassable wall)
      const t = (state.deathRunSpeedTier || 0);
      obs = 7 + Math.floor(t * 0.5);   // 7 at tier 0, up to ~9 at tier 3
      maxObs = obs + 2;
      gap = 1.0;
    } else {
      // 'endless' density — escalates with physTier but stays playable.
      // Old 27-36 count exceeded LANE_COUNT=21 at every tier (impassable wall).
      // New: 8-12 cones with original gap scaling.
      const t = (state.deathRunSpeedTier || 0);
      obs = Math.min(8 + Math.floor(t * 0.8), 12);
      maxObs = obs + 2;
      gap = Math.max(0.72, 0.88 - t * 0.02);
    }
    lvl = {
      obstaclesPerSpawn: obs,
      maxObstaclesPerSpawn: maxObs,
      gapFactor: gap
    };
  } else {
    lvl = LEVELS[state.currentLevelIdx];
  }

  // Predict where ship will be when this wave arrives.
  // Travel time = distance / speed. Clamp prediction so it doesn't overshoot wildly.
  // At L5 speed the prediction can overshoot badly — cap it to ±4 units from current X.
  const travelTime = Math.abs(SPAWN_Z) / state.speed;
  const rawPredictedX = state.shipX + state.shipVelX * travelTime * 0.85;
  const maxDrift = state.currentLevelIdx >= 4 ? 4 : 8;
  const predictedX = Math.max(state.shipX - maxDrift, Math.min(state.shipX + maxDrift, rawPredictedX));
  const shipX = predictedX;

  // Check if a gauntlet should start
  maybeStartGauntlet();

  // L3 knife canyon — block all obstacle spawns during the 40s knife experience.
  if (state.l3KnifeCanyon) return;
  // Pre-T4A canyon — same: pure visual+lightning corridor, no cones.
  if (state.preT4ACanyon) return;
  // Pre-T4B canyon — preset 1 + chill lightning, no cones.
  if (state.preT4BCanyon) return;

  // Zipper rows are fired from the update loop (spawnZipperRow) — block ALL
  // normal/random cone spawns while a zipper is active so they don't pile into
  // the zipper gate corridor. Applies to L5 native zipper AND DR sequencer
  // bursts (S2 cones_and_zips, S9 slalom_then_zips, S10 zipper_only, endless).
  // Was previously gated by currentLevelIdx===4, which let DR-mode zipper
  // bursts spawn random cones on top of zipper rows.
  if (state.zipperActive) {
    framesSinceLastPowerup++;
    return;
  }

  // Suppress all spawning if spawn mode is 'none'
  if (state._seqSpawnMode === 'none') return;

  // If gauntlet is running, use gauntlet spawner instead of random
  if (state.gauntletActive) {
    spawnGauntletRow();
    framesSinceLastPowerup++;
    return; // no power-ups during funnel — stay focused
  }

  // ── Normal random spawn ──
  // Density ramps with score: starts at base, slowly grows toward a hard cap
  const scoreFactor  = Math.min(state.score / 200, 1.0);
  const extraRandom  = Math.random() < (0.5 + scoreFactor * 0.3) ? 1 : 0;
  let count          = lvl.obstaclesPerSpawn + extraRandom;
  let clampedCount   = Math.min(count, lvl.maxObstaclesPerSpawn);

  // Rings are much larger than cones — fewer per row, wider gap between them
  // Sequencer spawn mode overrides band-based obstacle types
  let _obsBandIdx = 0;
  let _isWallBand = false, _isRingBand = false, _isFatConeBand = false, _isMixBand = false;
  if (state.isDeathRun && state._seqSpawnMode) {
    const _sm = state._seqSpawnMode;
    if (_sm === 'cones')     { /* default cones, no overrides */ }
    else if (_sm === 'angled')    {
      _isWallBand = true;
      // Read count from _awRandTuner so tuner values drive in-game spawns too.
      const _T = window._awRand;
      if (_T) clampedCount = _T.countMin + Math.floor(Math.random() * (_T.countMax - _T.countMin + 1));
      else    clampedCount = 6 + Math.floor(Math.random() * 3);
    }
    else if (_sm === 'lethal')    { _isRingBand = true; clampedCount = 3 + Math.floor(Math.random() * 2); }
    else if (_sm === 'fat_cones') { _isFatConeBand = true; clampedCount = 2 + Math.floor(Math.random() * 2); } // original count restored
    else if (_sm === 'endless')   { _isMixBand = true; clampedCount = 3 + Math.floor(Math.random() * 2); }
  } else if (state.isDeathRun) {
    if (state._drForcedBand != null && state._drForcedBand >= 0) { _obsBandIdx = state._drForcedBand; }
    else { for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) { if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _obsBandIdx = bi; break; } _obsBandIdx = bi; } }
    _isWallBand = _obsBandIdx === 1;
    _isRingBand = _obsBandIdx === 2;
    _isFatConeBand = _obsBandIdx === 4;
    _isMixBand = _obsBandIdx >= 5;
    if (_isRingBand || _isMixBand) clampedCount = 3 + Math.floor(Math.random() * 2);
    else if (_isWallBand) clampedCount = 3 + Math.floor(Math.random() * 2);
  }

  // Always guarantee at least 2 adjacent free lanes so there's a clear path
  const _spawnLaneCount = LANE_COUNT;
  const lanes   = Array.from({ length: _spawnLaneCount }, (_, i) => i);
  const shuffled = [...lanes].sort(() => Math.random() - 0.5);

  // Pick a guaranteed gap: a random 2-wide corridor that is always free
  const gapStart  = Math.floor(Math.random() * (_spawnLaneCount - 1));
  const gapLanes  = new Set([gapStart, gapStart + 1]);

  const blocked = [];
  for (const lane of shuffled) {
    if (blocked.length >= clampedCount) break;
    if (gapLanes.has(lane)) continue;
    // For rings/walls/mix: enforce minimum lane gap so they don't overlap
    if ((_isRingBand || _isMixBand) && blocked.some(b => Math.abs(b - lane) < 4)) continue;
    if (_isWallBand && blocked.some(b => Math.abs(b - lane) < (window._awRand ? window._awRand.laneGap : 3))) continue;
    if (_isFatConeBand && blocked.some(b => Math.abs(b - lane) < 8)) continue; // wider gap between fat cones
    blocked.push(lane);
  }

  blocked.forEach(lane => {
    const laneX = shipX + (lane - (_spawnLaneCount - 1) / 2) * LANE_WIDTH;
    // Skip if cone would land inside a bonus ring
    let inRing = false;
    for (const br of _bonusRings) {
      if (br.collected) continue;
      const dz = Math.abs(br.mesh.position.z - SPAWN_Z);
      if (dz < _ringTuner.freq * 0.7) { // within ring spacing tolerance
        const dx = Math.abs(br.mesh.position.x - laneX);
        if (dx < _ringTuner.radius + 0.8) { inRing = true; break; }
      }
    }
    if (inRing) return;

    // Obstacle type by band
    if (_isMixBand) {
      // Random pick from all obstacle types
      const roll = Math.random();
      if (roll < 0.25) {
        _spawnLethalRing(laneX + (Math.random() - 0.5) * 0.6, SPAWN_Z);
        _spawnLateralEchoes(laneX, SPAWN_Z, 'ring');
      } else if (roll < 0.5) {
        const wall = _getPooledWall();
        if (wall) {
          const angleSign = Math.random() < 0.5 ? 1 : -1;
          wall.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
          wall.rotation.set(0, 0, 0);
          wall.userData._mesh.scale.set(8, 4, 0.3);
          wall.userData._edges.scale.set(8, 4, 0.3);
          wall.userData._mesh.position.y = 2;
          wall.userData._edges.position.y = 2;
          wall.rotation.y = angleSign * (25 + Math.random() * 20) * Math.PI / 180;
          wall.userData._mesh.material.uniforms.uOpacity.value = 0;
          wall.userData._edges.material.opacity = 0;
          _awActive.push(wall);
          _spawnLateralEchoes(laneX, SPAWN_Z, 'wall', { angleSign });
        }
      } else if (roll < 0.75) {
        const type = Math.floor(Math.random() * 3);
        const obs = getPooledObstacle(type);
        if (obs) {
          obs.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
          obs.scale.set(4, 1, 4);
          obs.userData.velX = 0;
          obs.userData.slalomScaled = true;
          activeObstacles.push(obs);
          _spawnLateralEchoes(laneX, SPAWN_Z, 'fatcone');
        }
      } else {
        const type = Math.floor(Math.random() * 3);
        const obs = getPooledObstacle(type);
        if (obs) {
          obs.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
          obs.userData.velX = 0;
          activeObstacles.push(obs);
          _spawnLateralEchoes(laneX, SPAWN_Z, 'cone');
        }
      }
      return;
    }
    if (_isRingBand) {
      _spawnLethalRing(laneX + (Math.random() - 0.5) * 0.6, SPAWN_Z);
      _spawnLateralEchoes(laneX, SPAWN_Z, 'ring');
      return;
    }
    if (_isFatConeBand) {
      const type = Math.floor(Math.random() * 3);
      const obs = getPooledObstacle(type);
      if (!obs) return;
      obs.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
      obs.scale.set(4, 1, 4);
      obs.userData.velX = 0;
      obs.userData.slalomScaled = true;
      obs.userData.isFatCone = true;
      activeObstacles.push(obs);
      _spawnLateralEchoes(laneX, SPAWN_Z, 'fatcone');
      return;
    }
    if (_isWallBand) {
      const wall = _getPooledWall();
      if (wall) {
        const _T = window._awRand;
        const wallW = _T ? _T.wallW : 8;
        const wallH = _T ? _T.wallH : 4;
        const angMin = _T ? _T.angleMin : 25;
        const angMax = _T ? _T.angleMax : 45;
        const angleSign = Math.random() < 0.5 ? 1 : -1;
        const angleDeg = angMin + Math.random() * (angMax - angMin);
        wall.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
        wall.rotation.set(0, 0, 0);
        const m = wall.userData._mesh;
        const e = wall.userData._edges;
        m.scale.set(wallW, wallH, 0.3);
        e.scale.set(wallW, wallH, 0.3);
        m.position.y = wallH / 2;
        e.position.y = wallH / 2;
        wall.rotation.y = angleSign * angleDeg * Math.PI / 180;
        wall.userData._mesh.material.uniforms.uOpacity.value = 0;
        wall.userData._edges.material.opacity = 0;
        _awActive.push(wall);
        _spawnLateralEchoes(laneX, SPAWN_Z, 'wall', { angleSign });
        return;
      }
    }
    const type  = Math.floor(Math.random() * 3);
    const obs   = getPooledObstacle(type);
    if (!obs) return;
    obs.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
    obs.userData.velX = 0;
    activeObstacles.push(obs);
    _spawnLateralEchoes(laneX, SPAWN_Z, 'cone');
  });

  // ── Coin spawn — random singles + arc patterns (DR spawns more)
  framesSinceLastCoin++;
  const _coinThresh = (state.isDeathRun) ? 1 : (2 + Math.floor(Math.random() * 2));
  if (framesSinceLastCoin > _coinThresh) {
    framesSinceLastCoin = 0;
    const freeLanes2 = lanes.filter(l => !blocked.includes(l));
    if (freeLanes2.length > 0) {
      const roll = Math.random();
      if (roll < 0.45) {
        // Single coin in a free lane
        const lane = freeLanes2[Math.floor(Math.random() * freeLanes2.length)];
        const cx   = shipX + (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
        const coin = getPooledCoin();
        if (coin) {
          coin.position.set(cx, 1.2, SPAWN_Z);
          coin.userData.collected = false;
          activeCoins.push(coin);
        }
      } else if (roll < 0.8) {
        // Curved chain — coins spaced along Z (depth) so you fly through them
        // X drifts in a sine curve as the chain stretches away from you
        const chainCount = (state.isDeathRun) ? (10 + Math.floor(Math.random() * 6)) : (6 + Math.floor(Math.random() * 4));
        const chainZSpan = 28 + Math.random() * 16;  // total Z depth of chain
        const baseX  = shipX + (Math.random() - 0.5) * 8;
        const xSwing = (Math.random() - 0.5) * 10;  // how far X curves side-to-side
        for (let ai = 0; ai < chainCount; ai++) {
          const frac = ai / (chainCount - 1);
          const cx   = baseX + Math.sin(frac * Math.PI) * xSwing;
          const cz   = SPAWN_Z + frac * chainZSpan;  // spread coins along Z
          const cy   = 1.2 + Math.sin(frac * Math.PI) * 0.7;  // gentle vertical arc
          const coin = getPooledCoin();
          if (coin) {
            coin.position.set(cx, cy, cz);
            coin.userData.collected = false;
            activeCoins.push(coin);
          }
        }
      } else {
        // Straight tunnel chain — all same X, spaced along Z, 5-8 coins
        const lineCount = (state.isDeathRun) ? (8 + Math.floor(Math.random() * 5)) : (5 + Math.floor(Math.random() * 4));
        const lineZSpan = 20 + Math.random() * 12;
        const lane = freeLanes2[Math.floor(Math.random() * freeLanes2.length)];
        const cx   = shipX + (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
        for (let li = 0; li < lineCount; li++) {
          const frac = li / (lineCount - 1);
          const cz   = SPAWN_Z + frac * lineZSpan;
          const coin = getPooledCoin();
          if (coin) {
            coin.position.set(cx, 1.2, cz);
            coin.userData.collected = false;
            activeCoins.push(coin);
          }
        }
      }
    }
  }

  // Possibly spawn a power-up in a free lane
  framesSinceLastPowerup++;
  const _puRate = powerupSpawnRate * (1 + getStatValue('spawnrate'));
  const _puThresh = _puRate > 0 ? Math.max(4, Math.round(12 / _puRate)) : Infinity;
  const _puProb   = Math.min(0.9, 0.35 * _puRate);
  if (powerupSpawnRate > 0 && framesSinceLastPowerup > _puThresh && activePowerups.length < 2 && Math.random() < _puProb) {
    framesSinceLastPowerup = 0;
    const freeLanes = lanes.filter(l => !blocked.includes(l));
    if (freeLanes.length > 0) {
      const lane  = freeLanes[Math.floor(Math.random() * freeLanes.length)];
      const laneX = shipX + (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;

      // Build available powerup types (only unlocked ones)
      const _availPU = POWERUP_TYPES.map((p, idx) => ({ idx, id: p.id })).filter(p => isPowerupUnlocked(p.id));
      if (_availPU.length === 0) _availPU.push({ idx: 0, id: 'shield' }); // fallback
      const typeIdx = _availPU[Math.floor(Math.random() * _availPU.length)].idx;

      const pu = getPooledPowerup(typeIdx);
      if (pu) {
        pu.position.set(laneX, 1.4, SPAWN_Z);
        pu.userData.typeIdx = typeIdx;
        activePowerups.push(pu);
      }
    }
  }
}

// ═══════════════════════════════════════════════════
//  LEVEL CHECKING
// ═══════════════════════════════════════════════════
function checkLevelUp() {
  // Death Run: cycle vibes instead of normal level progression
  if (state.isDeathRun) {
    // Sequencer handles vibes + speed until endless mode
    const _seqStage = DR_SEQUENCE[state.seqStageIdx];
    if (_seqStage && _seqStage.type === 'endless_mix') {
      checkDeathRunVibe(); checkDeathRunSpeed();
    }
    return;
  }
  // JL mode: frozen at L4 — score must never flip currentLevelIdx to L5
  // (L5 activates the zipper/corridor campaign system which bleeds into JL)
  if (state._jetLightningMode) return;

  let newIdx = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (state.score >= LEVELS[i].scoreThreshold) { newIdx = i; break; }
  }

  // Continuous speed scaling within + beyond levels (score/30 on top of level base)
  const lvlDef = LEVELS[newIdx];
  const continuousBoost = Math.min(state.score / 180, 0.6); // up to +60% extra, ramps faster
  // Freeze speed during corridors — prevents mid-corridor speed jumps
  const inCorridor = state.corridorMode || state.l4CorridorActive || state.l5CorridorActive || state.l3KnifeCanyon;
  if (!inCorridor) state.speed = BASE_SPEED * (lvlDef.speedMult + continuousBoost);

  if (newIdx !== state.currentLevelIdx) {
    state.currentLevelIdx = newIdx;
    state.levelElapsed     = 0;   // reset time-in-level clock
    state.l4CorridorDone   = false; // allow L4 corridor to retrigger on new entry
    // Arm the L3 knife canyon for the NEXT L3 entry. Cleared so it fires once
    // per L3 visit. If the player just entered L3 (newIdx === 2), reset it.
    if (newIdx === 2) { state.l3KnifeDone = false; state._l3EntryLogged = false; }
    // Leaving L3 mid-knife? tear it down so L4 can start clean.
    if (newIdx !== 2 && state.l3KnifeCanyon) _stopL3KnifeCanyon();
    // L5: random cones first, then zippers
    if (newIdx === 4) {
      state.zipperActive      = false;
      state.zipperRowsLeft    = 0;
      state.zipperCooldown    = 99999; // held until l5PreZipperRandom drains
      state.zipperSide        = 1;
      state.l5PreZipperRandom = 8.0;   // 8s of open random cones before first zipper
    }
    if (newIdx === 3) {
      // L3->L4: 3s cone-free gap after corridor, then normal L4 random cones
      state.postL3Gap = 3.0;  // gates spawnObstacles for 3s after corridor ends
    }
    // Save that the previous level was beaten (campaign only)
    if (newIdx > 0 && !state.isDeathRun) saveLevelBeaten(newIdx - 1);
    transitionToLevel(lvlDef);
    playLevelUp();
    updateHUDLevel();
    // Crossfade to L3 music when entering level 3 (index 2)
    if (newIdx === 2) { const t = setTimeout(() => { if (state.currentLevelIdx >= 2) crossfadeToL3(6.0); }, 5000); _musicTimers.push(t); }
    // L3→L4 crossfade: fire immediately on L4 entry, 12s incoming fade, L3 fades out over 21.6s (12×1.8)
    if (newIdx === 3) { const t = setTimeout(() => { if (state.currentLevelIdx >= 3) crossfadeToL4(6.0); }, 5000); _musicTimers.push(t); }
    showBanner('LEVEL ' + (newIdx + 1), 'levelup', 2500);
    // Update coin multiplier/colors for new level
    updateCoinColors();
  }
}

function updateHUDLevel() {
  if (state.isDeathRun) {
    // Show the vibe number (1-indexed, wrapping)
    document.getElementById('hud-level').textContent = (state.deathRunVibeIdx % DEATH_RUN_VIBES.length) + 1;
    return;
  }
  const def = LEVELS[state.currentLevelIdx];
  document.getElementById('hud-level').textContent = def.id;
}

// ═══════════════════════════════════════════════════
//  POWER-UP EFFECT APPLICATION
// ═══════════════════════════════════════════════════

let _totalCoins = loadCoinWallet();  // in-memory running total (persists via window._LS)
// Coin Value: multiplier based on level + upgrade tier
// Base: 2x at L3 (idx 2), 3x at L4 (idx 3)
// Tier 2: 2x at L2, 3x at L4
// Tier 3: 2x at L2, 3x at L3
const COIN_MULT_TABLE = [
  // [tier]: { levelIdx: multiplier }
  { 2: 2, 3: 3 },  // tier 1 (base): 2x@L3, 3x@L4+
  { 1: 2, 3: 3 },  // tier 2: 2x@L2, 3x@L4+
  { 1: 2, 2: 3 },  // tier 3: 2x@L2, 3x@L3+
];

function getCoinMultiplier(levelIdx) {
  const tier = loadUpgradeTier('coinvalue');
  const table = COIN_MULT_TABLE[Math.min(tier - 1, COIN_MULT_TABLE.length - 1)] || COIN_MULT_TABLE[0];
  let mult = 1;
  for (const [lvl, m] of Object.entries(table)) {
    if (levelIdx >= parseInt(lvl)) mult = Math.max(mult, m);
  }
  return mult;
}

// Coin colors: gold(1x), red(2x), blue(3x)
function updateCoinColors() {
  const mult = getCoinMultiplier(state.currentLevelIdx);
  if (mult !== _activeCoinMult) {
    const prevMult = _activeCoinMult;
    _activeCoinMult = mult;
    // Recolor all active coins
    const color = COIN_MULT_COLORS[mult] || 0xffcc00;
    for (const c of activeCoins) {
      if (c.children[0] && c.children[0].material) c.children[0].material.color.setHex(color);
    }
    // Banner
    if (mult > prevMult && state.phase === 'playing') {
      showBanner(mult + 'x COINS', 'mission', 2000);
    }
  }
}

function collectCoin(coin, worldPos) {
  const mult = _activeCoinMult;
  state.sessionCoins += mult;
  _totalCoins += mult;
  // Player-facing score: orb bonus
  if (!state.l5EndingActive) {
    const lvlMult = [1, 1.5, 2, 3, 4][state.currentLevelIdx] || 1;
    state.playerScore += 75 * lvlMult;
  }
  // Update HUD coin counter
  const hudEl = document.getElementById('hud-coins');
  if (hudEl) hudEl.textContent = state.sessionCoins;
  // Gold fly animation to coins HUD
  if (worldPos && hudEl) _spawnCoinFly(worldPos, hudEl);
  // Update title screen running total
  updateTitleCoins();
  // Collect sound — bright 3-note ascending chime (C5-E5-G5)
  if (audioCtx && !state.muted) {
    const t = audioCtx.currentTime;
    if (state.magnetActive) {
      // Magnet whoosh — short rising pitch sweep per sucked coin
      const wo = audioCtx.createOscillator();
      const wg = audioCtx.createGain();
      wo.type = 'sine';
      wo.frequency.setValueAtTime(280, t);
      wo.frequency.exponentialRampToValueAtTime(980, t + 0.09);
      wg.gain.setValueAtTime(0.055, t);
      wg.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      wo.connect(wg).connect(audioCtx.destination);
      wo.start(); wo.stop(t + 0.12);
    }
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      // Add a little shimmer with a detuned second oscillator
      const osc2  = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      const onset = t + i * 0.06;
      const dur   = 0.22 - i * 0.02;
      osc.type  = 'sine';
      osc2.type = 'triangle';
      osc.frequency.setValueAtTime(freq, onset);
      osc2.frequency.setValueAtTime(freq * 1.004, onset); // slight detune shimmer
      // Attack
      gain.gain.setValueAtTime(0.0, onset);
      gain.gain.linearRampToValueAtTime(0.10 - i * 0.01, onset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, onset + dur);
      gain2.gain.setValueAtTime(0.0, onset);
      gain2.gain.linearRampToValueAtTime(0.04, onset + 0.012);
      gain2.gain.exponentialRampToValueAtTime(0.001, onset + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc2.connect(gain2).connect(audioCtx.destination);
      osc.start(onset);  osc.stop(onset + dur);
      osc2.start(onset); osc2.stop(onset + dur);
    });
  }
}

function updateTitleCoins() {
  const total = _totalCoins;
  const el = document.getElementById('title-coin-count');
  if (el) el.textContent = total.toLocaleString();
  // Also refresh skin viewer action (wallet may have changed)
  if (typeof updateSkinViewerDisplay === 'function') updateSkinViewerDisplay();
}

function updateTitleLevel() {
  const level = loadPlayerLevel();
  const xp = loadPlayerXP();
  const needed = xpForLevel(level);
  const pct = Math.min(100, (xp / needed) * 100);
  const el = document.getElementById('title-level-num');
  if (el) el.textContent = level;
  const fill = document.getElementById('title-xp-fill');
  if (fill) fill.style.width = pct + '%';
}

// ── SKIN VIEWER UI ──────────────────────────────────────────────
function initSkinViewer() {
  const data = loadSkinData();
  skinViewerIdx = data.selected;
  applySkin(data.selected);
  applyTitleSkin(data.selected);
  updateSkinViewerDisplay();

  // Only bind listeners once
  if (!window._skinViewerInited) {
    window._skinViewerInited = true;

    document.getElementById('skin-prev').addEventListener('click', e => {
      e.stopPropagation();
      { let _ni = (skinViewerIdx - 1 + SHIP_SKINS.length) % SHIP_SKINS.length; while (SHIP_SKINS[_ni] && SHIP_SKINS[_ni].hidden) _ni = (_ni - 1 + SHIP_SKINS.length) % SHIP_SKINS.length; navigateToSkin(_ni); }
    });
    document.getElementById('skin-next').addEventListener('click', e => {
      e.stopPropagation();
      { let _ni = (skinViewerIdx + 1) % SHIP_SKINS.length; while (SHIP_SKINS[_ni] && SHIP_SKINS[_ni].hidden) _ni = (_ni + 1) % SHIP_SKINS.length; navigateToSkin(_ni); }
    });

    // Touch swipe on title screen
    let touchStartX = 0;
    const titleEl = document.getElementById('title-screen');
    titleEl.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    titleEl.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) {
        { let _ni = dx < 0
          ? (skinViewerIdx + 1) % SHIP_SKINS.length
          : (skinViewerIdx - 1 + SHIP_SKINS.length) % SHIP_SKINS.length;
          while (SHIP_SKINS[_ni] && SHIP_SKINS[_ni].hidden) _ni = dx < 0 ? (_ni + 1) % SHIP_SKINS.length : (_ni - 1 + SHIP_SKINS.length) % SHIP_SKINS.length;
          navigateToSkin(_ni); }
      }
    }, { passive: true });

    // Admin mode: 3 rapid taps on the skin label (only when no handling upgrade pending)
    let adminTapCount = 0;
    let adminTapTimer = null;
    document.getElementById('skin-viewer-label').addEventListener('click', (e) => {
      // If handling upgrade pending, claim it
      const pendingHandling = getPendingHandlingUpgrade();
      if (pendingHandling) {
        const tier = claimHandlingUpgrade();
        if (tier) {
          const labelEl = document.getElementById('skin-viewer-label');
          // Particle burst toward ship preview
          spawnRewardParticles(labelEl, '#skin-viewer', '#00eeff', '\u2699', 12);
          playRewardSFX();
          // Show +% handling popup
          const pctGain = Math.round((1 - tier.drift) * 100);
          const popup = document.createElement('div');
          popup.className = 'handling-popup';
          popup.textContent = tier.label + ' \u2022 +' + pctGain + '% HANDLING';
          const rect = labelEl.getBoundingClientRect();
          popup.style.left = rect.left + rect.width / 2 + 'px';
          popup.style.top = rect.top - 10 + 'px';
          document.body.appendChild(popup);
          requestAnimationFrame(() => popup.classList.add('show'));
          setTimeout(() => { popup.classList.add('fade'); setTimeout(() => popup.remove(), 600); }, 1800);
          updateNotificationDots();
        }
        return;
      }
      adminTapCount++;
      if (adminTapTimer) clearTimeout(adminTapTimer);
      adminTapTimer = setTimeout(() => { adminTapCount = 0; }, 1500);
      if (adminTapCount >= 3) {
        _skinAdminMode = !_skinAdminMode;
        adminTapCount = 0;
        updateSkinViewerDisplay();
        if (_skinAdminMode) {
          // Auto-grant coins + fuel cells for testing
          saveCoinWallet(loadCoinWallet() + 99999);
          _totalCoins = loadCoinWallet();
          updateTitleCoins();
          saveFuelCells(loadFuelCells() + 9999);
          updateTitleFuelCells();
        }
        // Brief flash feedback
        const label = document.getElementById('skin-viewer-label');
        label.style.color = _skinAdminMode ? '#ff0' : '';
        setTimeout(() => { label.style.color = ''; }, 300);
        // Admin cheats for testing
        if (_skinAdminMode) {
          window._cheatCoins = (amount) => { saveCoinWallet(loadCoinWallet() + (amount || 99999)); _totalCoins = loadCoinWallet(); updateTitleCoins(); };
          window._cheatFuel = (amount) => { saveFuelCells(loadFuelCells() + (amount || 9999)); updateTitleFuelCells(); };
          window._cheatLevel = (lvl) => { savePlayerLevel(lvl || 50); savePlayerXP(0); updateTitleLevel(); };
          window._cheatMaxUpgrades = () => { Object.keys(POWERUP_UPGRADES).forEach(id => saveUpgradeTier(id, 5)); };
          window._cheatLadder = (pos) => { saveLadderPos(pos || MISSION_LADDER.length); saveMissionFlags({}); updateTitleFuelCells(); };
          // Auto-reset streak for testing
          localStorage.removeItem(STREAK_KEY_DAY); localStorage.removeItem(STREAK_KEY_LAST); updateStreakBadge();
          window._cheatReset = () => { Object.keys(POWERUP_UPGRADES).forEach(id => saveUpgradeTier(id, 1)); Object.keys(STAT_UPGRADES).forEach(id => saveUpgradeTier(id, 1)); saveCoinWallet(0); saveFuelCells(0); saveFreeHeadStarts(0); saveLadderPos(0); window._LS.removeItem('jetslide_mission_flags'); window._LS.setItem('jetslide_pu_unlocked', '["shield"]'); savePlayerLevel(1); savePlayerXP(0); _totalCoins = 0; updateTitleCoins(); updateTitleFuelCells(); updateTitleLevel(); };
        }
      }
    });
  }
}

