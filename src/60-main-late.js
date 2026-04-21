//  CRASH FLASH
// ═══════════════════════════════════════════════════
function addCrashFlash(hexColor) {
  const el = document.createElement('div');
  el.className = 'crash-flash';
  if (hexColor) el.style.background = `radial-gradient(ellipse at center, rgba(${(hexColor>>16)&255},${(hexColor>>8)&255},${hexColor&255},0.6), transparent)`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// ═══════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════
const keys = {};
// Touch control state — fed by on-screen buttons
const touch = { left: false, right: false, rollUp: false, rollDown: false, rollToggle: false };
function setPauseOverlay(visible) {
  const el = document.getElementById('pause-overlay');
  if (!el) return;
  if (visible) {
    el.classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
  } else {
    el.classList.add('hidden');
    if (state.phase === 'playing') document.getElementById('hud').classList.remove('hidden');
  }
}
// Expose for inline onclick on pause buttons
window.togglePause    = () => { if (state.phase === 'playing' || state.phase === 'paused') togglePause(); };
window.returnToTitle  = returnToTitle;
window.playResumeSound = () => playResumeSound();
window.playExitSound   = () => playExitSound();
// Helper: which music track should be playing right now in-game?
function currentGameTrack() {
  // Death Run: title track early, l4 after speed tier 3 crossfade
  if (state.isDeathRun) {
    // Use stage index to determine correct track
    const _idx = state.seqStageIdx || 0;
    if (_idx >= 8) return 'keepgoing'; // RECOVERY_2 is idx 8, everything after uses keepgoing
    if (_idx >= 3) return 'l4';        // T3B_L3BOSS onwards uses l4
    return 'bg';
  }
  // Title only plays after the L5 corridor completes (ending/sail-out phase)
  if (state.currentLevelIdx === 4 && state.l5CorridorDone) return 'title';
  if (state.currentLevelIdx >= 3) return 'l4';  // L4 and all of L5 up to corridor end
  if (state.currentLevelIdx >= 2) return 'l3';
  return 'bg';
}

// (crossfadeTracks is defined earlier as a thin wrapper around musicFadeTo)

function togglePause() {
  if (state.phase === 'playing') {
    state.phase = 'paused';
    // Kill any in-flight intro text
    clearIntroTimers();
    const _introOv = document.getElementById('intro-overlay');
    if (_introOv) { fadeOutIntroOverlay(_introOv); }
    state.introActive = false;
    killThrusterSputter();
    // Pause engine SFX
    const _engP = document.getElementById('engine-start');
    const _roarP = document.getElementById('engine-roar');
    if (_engP && !_engP.paused) _engP.pause();
    if (_roarP && !_roarP.paused) _roarP.pause();
    setPauseOverlay(true);
    pauseGameTrackInPlace(currentGameTrack());
    if (state._tutorialActive) _tutHideText();
  } else if (state.phase === 'paused') {
    state.phase = 'playing';
    setPauseOverlay(false);
    resumeGameTrackInPlace(currentGameTrack());
    if (state._tutorialActive) { const el = document.getElementById('tutorial-overlay'); if (el) el.style.opacity = '1'; }
  }
}

function returnToTitle() {
  state.phase = 'title';
  shipGroup.visible = true;
  _killExplosion();
  // ── Hard camera reset: prevent stale death/retry camera leaking into title ──
  _retrySweepActive = false;
  _retrySweepT = 0;
  cameraPivot.position.set(0, 2.8 + _camPivotYOffset, 9 + _camPivotZOffset);
  cameraRoll = 0;
  camera.rotation.set(0, 0, 0);
  camera.position.set(0, 0, 0);
  camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
  camera.fov = _baseFOV;
  camera.updateProjectionMatrix();
  if (_gameOverDelayTimer) { clearTimeout(_gameOverDelayTimer); _gameOverDelayTimer = null; }
  if (_titleFadeTimer) { clearTimeout(_titleFadeTimer); _titleFadeTimer = null; }
  clearMusicTimers();
  // Show inline leaderboard on title
  const _tlb = document.getElementById('title-leaderboard');
  if (_tlb) _tlb.classList.remove('hidden');
  renderLeaderboard();
  // Clean up any tutorial overlays
  _tutDestroyOverlay();
  // Clear any active banners
  const bc = document.getElementById('banner-container');
  if (bc) bc.innerHTML = '';
  // Reset title ship glow pulse state
  _titleGlowPhase = 0;
  for (const entry of _titleMeshMap) {
    const mat = entry.mesh.material;
    if (mat && mat.userData && mat.userData._baseEI !== undefined) {
      mat.emissiveIntensity = mat.userData._baseEI;
      delete mat.userData._baseEI;
    }
  }
  // Kill any in-flight intro text
  clearIntroTimers();
  const _introOv = document.getElementById('intro-overlay');
  if (_introOv) { fadeOutIntroOverlay(_introOv); }
  state.introActive = false;
  killThrusterSputter();
  // Clear all in-flight objects and mechanic state
  _clearAllMechanics();
  [..._activeForcefields].forEach(returnForcefieldToPool);
  _activeForcefields.length = 0;
  // Show title, hide everything else
  const _tEl = document.getElementById('title-screen');
  _tEl.classList.remove('hidden');
  _tEl.classList.remove('fading-out');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('reward-wheel-overlay').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  setPauseOverlay(false);
  document.getElementById('touch-controls').classList.add('hidden');
  document.getElementById('settings-btn').style.display = ''; // show gear on title/gameover
  document.getElementById('lb-icon-btn').style.display = ''; // show trophy on title
  document.getElementById('lb-overlay').classList.add('hidden'); // close leaderboard overlay
  // Stop all gameplay music, reset to start, clear crossfade timer, restart title music
  if (activeFadeIv) { clearInterval(activeFadeIv); activeFadeIv = null; }
  ['bg', 'l3', 'l4'].forEach(k => {
    const el = allTracks()[k];
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setTrackVol(k, 0);
  });
  // Stop lake ambience on return to title
  if (lakeMusic) { lakeMusic.pause(); lakeMusic.currentTime = 0; setTrackVol('lake', 0); }
  // Stop engine SFX
  const _engR = document.getElementById('engine-start');
  const _roarR = document.getElementById('engine-roar');
  if (_engR) { _engR.pause(); _engR.currentTime = 0; }
  if (_roarR) { _roarR.pause(); _roarR.currentTime = 0; }
  if (titleMusic) { titleMusic.currentTime = 0; setTrackVol('title', state.muted ? 0 : TRACK_VOL.title); if (!state.muted) titleMusic.play().catch(() => {}); }
  updateTitleCoins();
  updateTitleFuelCells();
  updateTitleLevel();
  updateTitleBadges();
  updateNotificationDots();
  updateStreakBadge();
  initSkinViewer();
  fetchLeaderboard();
}

// Clears all corridor flags — called by hotkeys so speed freeze doesn't carry over
// Wipes every in-flight gameplay object (cones, walls, lethal rings) and
// resets every mechanic flag so nothing lingers across repair-ship or restart.
function _clearAllMechanics() {
  // Return pooled objects
  for (let i = activeObstacles.length - 1; i >= 0; i--) returnObstacleToPool(activeObstacles[i]);
  activeObstacles.length = 0;
  [..._awActive].forEach(_returnWallToPool);
  _awActive.length = 0;
  for (const lr of _lethalRingActive) { lr.userData.active = false; lr.visible = false; lr.position.set(0,-9999,0); }
  _lethalRingActive.length = 0;
  // Reset all mechanic flags
  clearAllCorridorFlags();
  state.gauntletActive = false;
  state.gauntletRowsLeft = 0;
  state._arcActive = false;
  state._arcQueue = null;
  state._arcStage = 0;
}

function clearAllCorridorFlags() {
  state.corridorMode       = false;
  state.l4CorridorActive   = false;
  state.l4CorridorDone     = false;
  state.l5CorridorActive   = false;
  state.l5CorridorDone     = false;
  state.zipperActive       = false;
  state.slalomActive       = false;
  state.slalomRowsDone     = 0;
  state.slalomMaxRows      = 0;
  state.drPatternCooldown  = 0;
  state.drCustomPatternActive = false;
  state.drCustomPatternRow = 0;
  state.drCustomPatternSpawnZ = -7;
  state.angledWallsActive  = false;
  state.angledWallRowsDone = 0;
  state.angledWallSpawnZ   = -_awTuner.zSpacing;
  state._seqAngledTimer    = 0;
  state._seqStructuredTimer = 0;
  state._drL3MaxRows       = 0;
  state._drL4MaxRows       = 0;
  state._drL5MaxRows       = 0;
  state.corridorDelay      = 0;
  state.postL3Gap          = 0;
}

window.addEventListener('keydown', e => {
  keys[e.key] = true;
  const isSpace = (e.key === ' ' || e.code === 'Space');
  if (isSpace) e.preventDefault();
  // Snapshot phase BEFORE any action so we don't double-fire
  const phaseAtEvent = state.phase;
  const isMute = (e.key === 'm' || e.key === 'M');
  const isWaterToggle = (e.key === 'w' && !e.shiftKey);
  if (phaseAtEvent === 'title' && isWaterToggle) {
    mirrorMesh.visible = !mirrorMesh.visible;
    return;
  }
  const isEnter = (e.key === 'Enter');
  const isArrowLR = (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
  // Arrow keys on title screen navigate skins (don't start game)
  if (phaseAtEvent === 'title' && isArrowLR) {
    if (e.key === 'ArrowLeft') { let _ni = (skinViewerIdx - 1 + SHIP_SKINS.length) % SHIP_SKINS.length; while (SHIP_SKINS[_ni] && SHIP_SKINS[_ni].hidden) _ni = (_ni - 1 + SHIP_SKINS.length) % SHIP_SKINS.length; navigateToSkin(_ni); }
    if (e.key === 'ArrowRight') { let _ni = (skinViewerIdx + 1) % SHIP_SKINS.length; while (SHIP_SKINS[_ni] && SHIP_SKINS[_ni].hidden) _ni = (_ni + 1) % SHIP_SKINS.length; navigateToSkin(_ni); }
    return;
  }
  if (isSpace && phaseAtEvent === 'title')   { playStartSound(); startGame(); }
  // if (isSpace && phaseAtEvent === 'playing') triggerJump(); // JUMP QUARANTINED
  if (e.key === 'Escape' && phaseAtEvent === 'playing') togglePause();
  if (e.key === 'Escape' && phaseAtEvent === 'paused')  togglePause();
  if (isSpace && phaseAtEvent === 'paused')  togglePause();
  if (isSpace && phaseAtEvent === 'dead')  { initAudio(); _triggerRetryWithSweep(); }
  // Enter skips the intro text sequence
  if (e.key === 'Enter' && state.phase === 'playing' && state.introActive && !state.isDeathRun) {
    clearIntroTimers();
    const _ov = document.getElementById('intro-overlay');
    if (_ov) { fadeOutIntroOverlay(_ov); }
    state.introActive = false;
    beginThrusterSputter();
    // Trigger lift so ship rises from 0.38 to cruise height
    state._introLiftActive = true;
    state._introLiftTimer = 0;
    const _roar = document.getElementById('engine-roar');
    if (_roar && !state.muted) { _roar.currentTime = 0; _roar.volume = 0.7; _roar.play().catch(()=>{}); }
  }
  // Escape now pauses (handled above) — no longer returns to title
  // Hold-to-spin roll — up/down keys spin ship on Z axis while held
  if (state.phase === 'playing') {
    if (e.key === 'ArrowUp')   { state.rollHeld = true; state.rollDir = -1; }
    if (e.key === 'ArrowDown') { state.rollHeld = true; state.rollDir =  1; }
  }
  if (e.key === 'm' || e.key === 'M') toggleMute();
  // Level skipper for testing: press 1-5
  // ── Debug hotkeys: Sequencer stage jumping (numbers 1-9) + debug toggles ──
  const _digit = e.code.startsWith('Digit') ? e.code.replace('Digit','') : null;
  // ── JL mode: number keys jump to sequence sections ────────────────────────
  if (state._jetLightningMode && _digit) {
    // 1=0s  2=20s  3=30s(C1)  4=60s  5=75s  6=90s(C2)  7=123s  8=153s(C1+LT)  9=183s(C2+LT)  0=213s(peak)
    const _jlMap = { '1':0, '2':20, '3':30, '4':60, '5':75, '6':90, '7':123, '8':153, '9':183, '0':213 };
    if (_jlMap[_digit] !== undefined) {
      _jlJumpToTime(_jlMap[_digit]);
      return;
    }
  }
  if (state.phase === 'playing' && state.isDeathRun && _digit) {
    // 1=T1_WARMUP  2=T2_RAMPUP  3=T3A_ZIPS  4=T3B_L3BOSS
    // 5=T4A_ANGLED  6=T4B_LETHAL  7=T4C_L4BOSS  8=T5A_FATCONES
    // Shift+1=T5B_SLALOM_ZIP  Shift+2=T5C_L5BOSS  Shift+3=ENDLESS
    const stageMap = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 5, '6': 6, '7': 7, '8': 9 };
    const _hotkeyJump = (idx) => {
      const s = DR_SEQUENCE[idx];
      if (!s) return;
      clearAllCorridorFlags(); state.deathRunRestBeat = 0;
      state.seqStageIdx = idx; state.seqStageElapsed = 0;
      state._seqCorridorStarted = false; state._seqSpawnMode = 'cones'; state._seqConeDensity = 'normal';
      state._seqVibeApplied = -1; state._restBeepFired = false;
      state.speed = BASE_SPEED * s.speed;
      // Fire music transitions for hotkey jumps too
      if (s.name === 'T3B_L3BOSS') musicFadeTo('l4', 2000);
      if (s.name === 'RECOVERY_2' || idx > 7) musicFadeTo('keepgoing', 2000);
      console.log('[SEQ-DEBUG] Jump to stage ' + idx + ': ' + s.name);
    };
    if (e.shiftKey && _digit === '1') {
      _hotkeyJump(10); // T5B_SLALOM_ZIP
    } else if (e.shiftKey && _digit === '2') {
      _hotkeyJump(11); // T5C_L5BOSS
    } else if (e.shiftKey && _digit === '3') {
      state.drPhase = 'RELEASE'; state.drPhaseTimer = 0; state.drPhaseDuration = 2;
      _hotkeyJump(13); // ENDLESS
    } else if (!e.shiftKey && stageMap[_digit] !== undefined) {
      _hotkeyJump(stageMap[_digit]);
    } else if (e.key === '9') {
      // Toggle debug HUD overlay
      _drDebugHudVisible = !_drDebugHudVisible;
      const el = document.getElementById('dr-debug-hud');
      if (el) el.style.display = _drDebugHudVisible ? 'block' : 'none';
      console.log('[SEQ-DEBUG] Debug HUD ' + (_drDebugHudVisible ? 'ON' : 'OFF'));
    } else if (_digit === '0') {
      _hotkeyJump(11); // T5C_L5BOSS (gold sun)
    }
    return; // consume key in DR mode
  }
  // toggle no-spawn test mode
  if ((e.key === "'" || e.key === '`' || e.key === '\\' || e.key === 'n' || e.key === 'N') && state.phase === 'playing') {
    _noSpawnMode = !_noSpawnMode;
    // Flash HUD message so player knows it fired
    const _nsEl = document.createElement('div');
    _nsEl.textContent = _noSpawnMode ? 'SPAWN OFF' : 'SPAWN ON';
    _nsEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;font-family:monospace;font-size:24px;font-weight:bold;pointer-events:none;z-index:9999;opacity:1;transition:opacity 1s';
    document.body.appendChild(_nsEl);
    setTimeout(() => { _nsEl.style.opacity = '0'; setTimeout(() => _nsEl.remove(), 1000); }, 500);
  }

  // In-game powerup hotkeys (playing only, >1s in): L=laser S=shield I=invincible M=magnet
  if (state.phase === 'playing' && (state.elapsed || 0) > 1.0) {
    if (e.key === 'l' || e.key === 'L') applyPowerup(1); // laser
    if (e.key === 's' || e.key === 'S') applyPowerup(0); // shield
    if (e.key === 'i' || e.key === 'I') applyPowerup(2); // invincible
    if (e.key === 'm' || e.key === 'M') applyPowerup(3); // magnet
  }

  // R = spawn bonus rings + tuner (DR only)
  if ((e.key === 'r' || e.key === 'R') && !state._tutorialActive) {
    if (state.isDeathRun && state.phase === 'playing') {
      if (_bonusRings.length === 0) {
        _ringSpawnRow();
        state.speed = 0; // live pause for tuning
      } else {
        state.speed = BASE_SPEED * (LEVELS[Math.min((state.deathRunSpeedTier || 0) + 1, 4)].speedMult);
      }
      _ringShowTuner();
      console.log('[DR-DEBUG] Ring tuner toggled. Rings: ' + _bonusRings.length);
    }
  }
  // P = force custom pattern (DR only)
  if (e.key === 'p' || e.key === 'P') {
    if (state.isDeathRun && state.phase === 'playing') {
      state.drPhase = 'RELEASE'; state.drPhaseTimer = 0; state.drPhaseDuration = 2;
      const _s = DR_SEQUENCE[13]; if (_s) {
        clearAllCorridorFlags(); state.deathRunRestBeat = 0;
        state.seqStageIdx = 13; state.seqStageElapsed = 0;
        state._seqCorridorStarted = false; state._seqSpawnMode = 'cones'; state._seqConeDensity = 'normal';
        state._seqVibeApplied = -1;
        state.speed = BASE_SPEED * _s.speed;
        console.log('[SEQ-DEBUG] Jump to ENDLESS via P');
      }
    }
  }
  // ── Force specific mechanics / arcs (DR only) ──
  if (state.isDeathRun && state.phase === 'playing') {
    let _forceBandIdx = DR2_RUN_BANDS.length - 1;
    for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
      if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _forceBandIdx = bi; break; }
    }
    const _forceBand = DR2_RUN_BANDS[_forceBandIdx];
    const _forceKey = e.key.toUpperCase();
    const _forceMap = {
      'C': 'CORRIDOR_ARC',
      'X': 'SLALOM_ARC',
      'Z': 'ZIPPER_ARC',
      'V': 'L3_CORRIDOR',
      'K': 'L4_SINE_CORRIDOR',
      'J': 'L5_SINE_CORRIDOR',
      'Q': 'SLALOM',
      'N': 'ZIPPER',
      'B': 'ANGLED_WALL',
    };
    if (_forceMap[_forceKey]) {
      const famKey = _forceMap[_forceKey];
      const fam = DR_MECHANIC_FAMILIES[famKey];
      if (fam) {
        clearAllCorridorFlags(); state.deathRunRestBeat = 0;
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0; state.drPhaseDuration = 0;
        fam.activate(_forceBand, 'build');
        console.log('[DR-DEBUG] Forced ' + famKey);
      }
    }
  }
  // Campaign mode: original level-skip keys
  if (state.phase === 'playing' && !state.isDeathRun && ['1','2','3','4','5'].includes(e.key)) {
    const idx = parseInt(e.key) - 1;
    if (idx < LEVELS.length) {
      clearAllCorridorFlags();
      state.currentLevelIdx = idx;
      state.score = LEVELS[idx].scoreThreshold;
      currentLevelDef = LEVELS[idx];
      targetLevelDef  = LEVELS[idx];
      transitionT     = 1;
      applyLevelVisuals(LEVELS[idx]);
      updateHUDLevel();
      if (idx <= 1) setActiveMusic('bg');
      else if (idx === 2) setActiveMusic('l3');
      else if (idx >= 3) setActiveMusic('l4');
    }
  }
  // Key 0: toggle debug hitbox wireframes (campaign)
  if (state.phase === 'playing' && !state.isDeathRun && e.key === '0') {
    debugHitboxes = !debugHitboxes;
  }
  // Key T: toggle L4 aurora tendrils
  // Campaign key 9: skip to right before L4 corridor
  if (state.phase === 'playing' && !state.isDeathRun && e.key === '9') {
    clearAllCorridorFlags();
    const l4 = LEVELS[3];
    state.currentLevelIdx  = 3;
    state.score            = l4.scoreThreshold;
    currentLevelDef = l4; targetLevelDef = l4; transitionT = 1;
    applyLevelVisuals(l4); updateHUDLevel();
    state.levelElapsed     = L4_CORRIDOR_TRIGGER_S - 2;
    state.l4CorridorActive = false;
    state.l4CorridorDone   = false;
    state.l4RowsDone       = 0;
    state.l4SineT          = 0;
    setActiveMusic('l4');
  }
  // Campaign key 7: skip to midway through L3 corridor
  if (state.phase === 'playing' && !state.isDeathRun && e.key === '7') {
    const l3 = LEVELS[2];
    state.currentLevelIdx = 2;
    state.score           = l3.scoreThreshold + 171;
    currentLevelDef = l3; targetLevelDef = l3; transitionT = 1;
    applyLevelVisuals(l3); updateHUDLevel();
    state.corridorMode       = true;
    state.corridorSpawnZ     = -7;
    state.corridorRowsDone   = 200;
    state.corridorDelay      = 0;
    state.corridorGapCenter  = 0;
    state.corridorGapDir     = 1;
    state.corridorSineT      = 0;
    state.levelElapsed       = 68;
    state.postL3Gap          = 0;
    setActiveMusic('l3');
  }
  // Campaign key 6: skip to L5 post-2nd-zipper
  if (state.phase === 'playing' && !state.isDeathRun && e.key === '6') {
    clearAllCorridorFlags();
    const l5 = LEVELS[4];
    state.currentLevelIdx = 4;
    state.score = l5.scoreThreshold;
    currentLevelDef = l5; targetLevelDef = l5; transitionT = 1;
    applyLevelVisuals(l5); updateHUDLevel();
    // Fast-forward zipper state to: 2 runs done, random cones phase starting
    state.zipperActive        = false;
    state.zipperRunCount      = 2;
    l5DustPoints.visible = true;  // key-6 skip: enable chromatic dust
    // l4 is the correct track here — title fires when corridor ends
    setActiveMusic('l4');
    state.zipperCooldown      = 99999;
    state.l5EndingActive      = false;
    state.l5CorridorActive    = false;
    state.l5CorridorDone      = false;
    state.l5CorridorRowsDone  = 0;
    state.l5CorridorSpawnZ    = -7;
    state.l5SineT             = 0;
    state.l5RandomAfterZipper = 5.0;  // 5s of random cones, then corridor fires

  }
});
window.addEventListener('keyup', e => {
  keys[e.key] = false;
  // Release thrust on spacebar up
  // if (e.key === ' ') _thrustHeld = false; // JUMP QUARANTINED
  // Release roll spin
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    state.rollHeld = false;
    // Keep rollDir so we know which way to return
  }
});

// ── TOUCH CONTROLS ──────────────────────────────────────────────────────────
(function setupTouch() {
  // Swipe threshold in pixels — swipe up/down to toggle roll
  const SWIPE_THRESH = 14;

  function bindSteerZone(id, stateKey, rollKey) {
    const el = document.getElementById(id);
    if (!el) return;

    // Per-touch tracking: touchId -> { startY, swiped }
    const activeTouches = new Map();

    const setSteer = (v) => {
      touch[stateKey] = v;
      if (v) el.classList.add('active');
      else   el.classList.remove('active');
    };

    el.addEventListener('touchstart', e => {
      e.preventDefault();
      // If intro is active — tap anywhere skips it
      if (state.phase === 'playing' && state.introActive && !state.isDeathRun) {
        const _ov = document.getElementById('intro-overlay');
        clearIntroTimers();
        if (_ov) fadeOutIntroOverlay(_ov);
        state.introActive = false;
        beginThrusterSputter();
        state._introLiftActive = true;
        state._introLiftTimer = 0;
        const _roar = document.getElementById('engine-roar');
        if (_roar && !state.muted) { _roar.currentTime = 0; _roar.volume = 0.7; _roar.play().catch(()=>{}); }
        return;
      }
      // Start game if on title/dead — mark this touch as game-starting (ignore swipes from it)
      const ph = state.phase;
      const isStartingTouch = (ph === 'title' || ph === 'dead');
      for (const t of e.changedTouches) {
        activeTouches.set(t.identifier, { startY: t.clientY, swiped: false, isStart: isStartingTouch });
      }
      // Enable steering while finger is down
      setSteer(true);
      if (isStartingTouch) {
        if (ph === 'dead') {
          if (!_gameOverTapReady) return; // cooldown guard
          _triggerRetryWithSweep();
        }
        else if (ph === 'title') startGame();
      }
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      e.preventDefault();
      // Only allow roll toggle during active gameplay (not title, death, intro)
      if (state.phase === 'playing' && !state.introActive) {
        for (const t of e.changedTouches) {
          const info = activeTouches.get(t.identifier);
          if (!info || info.swiped || info.isStart) continue;
          const dy = t.clientY - info.startY;
          if (dy < -SWIPE_THRESH) {
            info.swiped = true;
            touch.rollToggle = true;
            touch.rollUp = true;
            touch.rollDown = false;
          } else if (dy > SWIPE_THRESH) {
            info.swiped = true;
            touch.rollToggle = false;
            touch.rollUp = false;
            touch.rollDown = false;
          }
        }
      }
    }, { passive: false });

    const endTouch = (e) => {
      e.preventDefault();
      // Catch quick flicks that touchmove missed
      if (state.phase === 'playing' && !state.introActive) {
        for (const t of e.changedTouches) {
          const info = activeTouches.get(t.identifier);
          if (!info || info.swiped || info.isStart) continue;
          const dy = t.clientY - info.startY;
          if (dy < -SWIPE_THRESH) {
            touch.rollToggle = true;
            touch.rollUp = true;
            touch.rollDown = false;
          } else if (dy > SWIPE_THRESH) {
            touch.rollToggle = false;
            touch.rollUp = false;
            touch.rollDown = false;
          }
        }
      }
      for (const t of e.changedTouches) {
        activeTouches.delete(t.identifier);
      }
      // Release steer when no touches remain in this zone
      // Roll toggle persists — does NOT release on finger lift
      if (activeTouches.size === 0) {
        setSteer(false);
      }
    };
    el.addEventListener('touchend',    endTouch, { passive: false });
    el.addEventListener('touchcancel', endTouch, { passive: false });
  }

  // Left zone: steer left, swipe-up = rollUp (dir -1)
  // Right zone: steer right, swipe-up = rollDown (dir +1)
  bindSteerZone('touch-left',  'left',  'rollUp');
  bindSteerZone('touch-right', 'right', 'rollDown');

  const pauseBtn = document.getElementById('touch-pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      togglePause();
    }, { passive: false });
  }

  // Triple-tap skin label = unlock entire shop (all skins + all powerups max tier)
  const skinLabel = document.getElementById('skin-viewer-label');
  let _skinTapCount = 0;
  let _skinTapTimer = null;
  function _adminUnlockAll() {
    // Unlock all skins
    const allSkinNames = SHIP_SKINS.map(s => s.name);
    window._LS.setItem('jh_owned_skins', JSON.stringify(allSkinNames));
    // Unlock all powerups
    const allPuIds = POWERUP_TYPES.map(p => p.id);
    window._LS.setItem('jetslide_pu_unlocked', JSON.stringify(allPuIds));
    // Give plenty of fuel to buy upgrades
    saveFuelCells(loadFuelCells() + 99999);
    updateTitleFuelCells();
    console.log('[ADMIN] Full shop unlocked');
  }
  if (skinLabel) {
    skinLabel.addEventListener('touchstart', e => {
      _skinTapCount++;
      if (_skinTapTimer) clearTimeout(_skinTapTimer);
      if (_skinTapCount >= 3) { _skinTapCount = 0; _adminUnlockAll(); return; }
      _skinTapTimer = setTimeout(() => { _skinTapCount = 0; }, 500);
    }, { passive: true });
    skinLabel.addEventListener('click', () => {
      _skinTapCount++;
      if (_skinTapTimer) clearTimeout(_skinTapTimer);
      if (_skinTapCount >= 3) { _skinTapCount = 0; _adminUnlockAll(); return; }
      _skinTapTimer = setTimeout(() => { _skinTapCount = 0; }, 500);
    });
  }
})();

// Gyro removed — touch swipe controls handle roll

// ── ADD TO HOME SCREEN NUDGE (iOS Safari only) ───────────────────────────────
(function setupA2HS() {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true;
  if (!isIOS || isStandalone) return;

  const banner = document.getElementById('a2hs-banner');
  if (!banner) return;

  // Show after a short delay so it doesn't clash with page load
  setTimeout(() => { banner.classList.remove('hidden'); }, 2000);

  // Tap anywhere on the banner to dismiss
  banner.addEventListener('click', () => {
    banner.classList.add('hidden');
  });
  banner.addEventListener('touchend', (e) => {
    e.preventDefault();
    banner.classList.add('hidden');
  }, { passive: false });
})();

// ── LEVEL CHOOSER (mobile title screen) ─────────────────────────────────────
(function setupLevelChooser() {
  const btns = document.querySelectorAll('.level-btn');
  btns.forEach(btn => {
    btn.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      // Highlight selected
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const levelIdx = parseInt(btn.dataset.level);
      // Start the game then immediately jump to the chosen level
      startGame();
      // Apply level jump after a brief tick so game state is initialised
      requestAnimationFrame(() => {
        if (levelIdx === 0) return; // L1 is default, nothing to do
        state.startedFromL1 = false; // not eligible for leaderboard
        clearAllCorridorFlags();
        state.currentLevelIdx = levelIdx;
        state.score           = LEVELS[levelIdx].scoreThreshold;
        currentLevelDef  = LEVELS[levelIdx];
        targetLevelDef   = LEVELS[levelIdx];
        transitionT      = 1;
        applyLevelVisuals(LEVELS[levelIdx]);
        updateHUDLevel();
        if (levelIdx <= 1)     setActiveMusic('bg');
        else if (levelIdx === 2) setActiveMusic('l3');
        else                   setActiveMusic('l4');
      });
    }, { passive: false });
  });
})();

// Start title music on very first user interaction with the page
function initTitleAudio() {
  if (audioCtx) { _ensureCtxRunning(); return; }  // already initialized
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  _ensureCtxRunning();
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0.0;
  engineGain.connect(audioCtx.destination);
  _initSFXBuffers();  // pre-decode SFX for instant mobile playback
  bgMusic    = bgMusic    || document.getElementById('bgm');
  titleMusic = titleMusic || document.getElementById('title-music');
  if (!l3Music) { l3Music = document.getElementById('l3-music'); setTrackVol('l3', 0); }
  if (!l4Music) { l4Music = document.getElementById('l4-music'); setTrackVol('l4', 0); }
  // Only start title music if it isn't already playing (don't restart mid-track)
  if (!state.muted && titleMusic && titleMusic.paused) {
    titleMusic.currentTime = 0;
    titleMusic.play().catch(() => {});
  }
}
// Try autoplay immediately on load; fall back to first-interaction unlock
(function attemptAutoplay() {
  // Initialise audio objects without AudioContext (doesn't need gesture)
  titleMusic = document.getElementById('title-music');
  setTrackVol('title', 0.4);
  bgMusic    = document.getElementById('bgm');
  setTrackVol('bg', 0.45);
  if (!l3Music)   { l3Music   = document.getElementById('l3-music');   setTrackVol('l3', 0); }
  if (!l4Music)   { l4Music   = document.getElementById('l4-music');   setTrackVol('l4', 0); }
  if (!lakeMusic) { lakeMusic = document.getElementById('lake-music'); setTrackVol('lake', 0); }

  if (!state.muted) {
    titleMusic.currentTime = 0;
    titleMusic.play().then(() => {
      // Autoplay succeeded — nothing more to do
    }).catch(() => {
      // Autoplay blocked — unlock audio on first interaction (no visible overlay)
      const unlock = () => {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          engineGain = audioCtx.createGain();
          engineGain.gain.value = 0.0;
          engineGain.connect(audioCtx.destination);
          _initSFXBuffers();
        }
        _ensureCtxRunning();
        if (!state.muted) { titleMusic.currentTime = 0; titleMusic.play().catch(() => {}); }
      };
      ['click','keydown','touchstart'].forEach(e => document.addEventListener(e, unlock, {once:true}));
    });
  }
})();

// One-time listeners to finish AudioContext init on first gesture (needed for sound effects)
['click', 'keydown', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, function _firstInteraction() {
    initTitleAudio();
    document.removeEventListener(evt, _firstInteraction);
  }, { once: true });
});



// Show persisted coin total, fuel cells, and level on title screen on load
updateTitleCoins();
updateTitleFuelCells();
updateTitleLevel();
updateNotificationDots();
updateStreakBadge();
// Initialize skin viewer on load (GLB may not be loaded yet, but initSkinViewer handles that gracefully)
initSkinViewer();
// Fetch leaderboard on initial load
fetchLeaderboard();

function playStartSound() {
  if (state.muted) return;
  _ensureCtxRunning();
  const sfx = document.getElementById('start-sound');
  if (sfx) { sfx.currentTime = 0; sfx.volume = 0.85; sfx.play().catch(() => {}); }
}

function playResumeSound() {
  if (state.muted) return;
  _ensureCtxRunning();
  const sfx = document.getElementById('start-sound');
  if (sfx) { sfx.currentTime = 0; sfx.volume = 0.7; sfx.play().catch(() => {}); }
}

function playExitSound() {
  if (state.muted) return;
  _ensureCtxRunning();
  const sfx = document.getElementById('exit-sound');
  if (sfx) { sfx.currentTime = 0; sfx.volume = 0.9; sfx.playbackRate = 1.0; sfx.play().catch(() => {}); }
}
function playTitleTap() {
  if (state.muted) return;
  _ensureCtxRunning();
  const sfx = document.getElementById('exit-sound');
  if (sfx) { sfx.currentTime = 0; sfx.volume = 0.7; sfx.playbackRate = 0.85 + Math.random() * 0.5; sfx.play().catch(() => {}); }
}

// ═══════════════════════════════════════════════════════
//  SIGNAL SALVAGE — REWARD WHEEL
// ═══════════════════════════════════════════════════════
const WHEEL_SEGMENTS = [
  { type: 'coins',      amount: 25, label: '+25 COINS',       color: '#ffcc00', icon: '⬡' },
  { type: 'coins',      amount: 75, label: '+75 COINS',       color: '#ffcc00', icon: '⬡' },
  { type: 'fuelcells',  amount: 15, label: '+15 FUEL CELLS',  color: '#4488ff', icon: '⚡' },
  { type: 'fuelcells',  amount: 40, label: '+40 FUEL CELLS',  color: '#4488ff', icon: '⚡' },
  { type: 'headstart',  amount: 1,  label: 'FREE HEAD START', color: '#00ff88', icon: '▲' },
  { type: 'doublecoin', amount: 0,  label: '2× COINS NEXT RUN', color: '#ff4444', icon: '2×' },
];

function rollWheel() {
  const r = Math.random();
  const isDR = state.isDeathRun;
  // Death Run: shift 5% from 25 coins (idx 0) to 75 coins (idx 1)
  if (isDR) {
    if (r < 0.25) return 0;  // 25%
    if (r < 0.50) return 1;  // 25%
    if (r < 0.70) return 2;  // 20%
    if (r < 0.82) return 3;  // 12%
    if (r < 0.92) return 4;  // 10%
    return 5;                 // 8%
  }
  // Campaign
  if (r < 0.30) return 0;  // 30%
  if (r < 0.50) return 1;  // 20%
  if (r < 0.70) return 2;  // 20%
  if (r < 0.82) return 3;  // 12%
  if (r < 0.92) return 4;  // 10%
  return 5;                 // 8%
}

function applyWheelReward(segIdx) {
  const seg = WHEEL_SEGMENTS[segIdx];
  switch (seg.type) {
    case 'coins':
      saveCoinWallet(loadCoinWallet() + seg.amount);
      _totalCoins = loadCoinWallet();
      updateTitleCoins();
      break;
    case 'fuelcells':
      saveFuelCells(loadFuelCells() + seg.amount);
      updateTitleFuelCells();
      break;
    case 'headstart':
      saveFreeHeadStarts(loadFreeHeadStarts() + 1);
      break;
    case 'doublecoin': {
      const existing = window._LS.getItem('jetslide_double_next');
      if (existing) {
        const cur = parseInt(existing) || 1;
        window._LS.setItem('jetslide_double_next', String(Math.min(cur + 1, 2)));  // cap at 3x
      } else {
        window._LS.setItem('jetslide_double_next', '1');
      }
      break;
    }
  }
}

function showRewardWheel(segIdx, callback) {
  const overlay = document.getElementById('reward-wheel-overlay');
  const disc = document.getElementById('wheel-disc');
  const resultEl = document.getElementById('wheel-result');
  const tapHint = document.getElementById('wheel-tap-hint');
  const seg = WHEEL_SEGMENTS[segIdx];

  // Set pointer color to current level's grid color
  const pointer = overlay.querySelector('.wheel-pointer');
  let gridHex = '#00eeff';
  try {
    gridHex = '#' + currentLevelDef.gridColor.getHexString();
  } catch (e) {}
  pointer.style.color = gridHex;
  pointer.style.textShadow = '0 0 12px ' + gridHex + ', 0 0 24px ' + gridHex;

  // Set divider line colors on the disc
  disc.style.setProperty('--whl-line', gridHex);

  // Update conic-gradient dividers to use grid color
  const lineRGBA = gridHex;
  disc.style.background = '#0a0a12';

  // Reset state
  resultEl.classList.add('hidden');
  resultEl.textContent = '';
  tapHint.classList.remove('hidden');
  disc.style.transition = 'none';
  disc.style.transform = 'rotate(0deg)';

  // Hide gameover, show wheel
  document.getElementById('gameover-screen').classList.add('hidden');
  overlay.classList.remove('hidden');

  // Force reflow before starting animation
  void disc.offsetHeight;

  // Spin start SFX: rising tone
  playSFX(300, 0.3, 'sine', 0.1);
  setTimeout(() => playSFX(500, 0.2, 'sine', 0.1), 100);
  setTimeout(() => playSFX(800, 0.15, 'sine', 0.1), 200);

  // Physics-based spin — exact SO attractor approach
  const NUM_SEGS = 6;
  const inertia = 0.97;
  const minSpeed = 8;
  const randRange = 5;
  const maxAttractionForce = 0.5;
  const attractionForceFactor = 0.02;

  // Disc rotation needed to place segment idx under the pointer (top)
  // Segment CSS centers: idx*60 - 30 (idx0=-30, idx1=30, idx2=90, ...)
  // To bring center to top: rotate by (360 - center) % 360
  const SEG_TARGETS = [30, 330, 270, 210, 150, 90];
  function getAngleForIndex(idx) { return SEG_TARGETS[idx]; }
  function getSliceIndex(a) {
    // Which segment is under the pointer at disc rotation `a`?
    // Reverse of getAngleForIndex: find closest target
    let best = 0, bestDist = 999;
    for (let i = 0; i < NUM_SEGS; i++) {
      let d = Math.abs(getCircularDist(a, SEG_TARGETS[i]));
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }
  function getCircularDist(a, b) {
    const d1 = b - a;
    const d2 = b - (a - 360);
    return Math.abs(d1) >= Math.abs(d2) ? d2 : d1;
  }

  let angle = 0;
  let totalAngle = 0;
  let speed = Math.floor(Math.random() * randRange) + minSpeed;

  // Speed correction: estimate landing, adjust to hit target segment
  const estimatedSpin = speed / (1 - inertia);
  const estimatedSliceIdx = getSliceIndex((angle + estimatedSpin) % 360);
  const estimatedAngle = getAngleForIndex(estimatedSliceIdx);
  const targetAngle = getAngleForIndex(segIdx);
  const spinError = getCircularDist(estimatedAngle, targetAngle);
  speed += spinError * (1 - inertia);

  let lastSegCrossing = -1;
  let animFrame = null;

  let resolved = false;

  function resolveWheel(instant) {
    if (resolved) return;
    resolved = true;
    clearTimeout(safetyTimer);
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = null;
    // Remove tap listeners so stale taps don't leak through
    overlay.removeEventListener('click', onTap);
    overlay.removeEventListener('touchstart', onTap);
    tapHint.classList.add('hidden');

    // Snap to target using totalAngle (visual) aligned to target segment
    const tgt = getAngleForIndex(segIdx);
    const fullRots = Math.floor(totalAngle / 360);
    let snapAngle = fullRots * 360 + tgt;
    if (snapAngle < totalAngle - 30) snapAngle += 360;
    if (instant) {
      disc.style.transition = 'transform 0.3s ease-out';
    }
    disc.style.transform = 'rotate(' + snapAngle + 'deg)';

    const finishDelay = instant ? 350 : 100;
    setTimeout(() => {
      // Flash winning segment
      const winEl = disc.querySelector('[data-idx="' + segIdx + '"]');
      if (winEl) winEl.classList.add('winning');

      // Show result text
      resultEl.textContent = seg.label;
      resultEl.style.color = seg.color;
      resultEl.style.textShadow = '0 0 20px ' + seg.color;
      resultEl.classList.remove('hidden');

      // Play reward SFX
      playRewardSFX();

      // Particle fly-away
      const particleOrigin = disc;
      let dest = '#title-coin-count';
      let pColor = seg.color;
      let pIcon = seg.icon;
      let pCount = 36;
      if (seg.type === 'coins') { dest = '#title-coin-count'; pCount = Math.min(seg.amount / 5, 15) * 3 | 0; }
      else if (seg.type === 'fuelcells') { dest = '#title-fuelcell-count'; pCount = Math.min(seg.amount / 3, 15) * 3 | 0; }
      else { dest = null; }

      if (dest) {
        spawnRewardParticles(particleOrigin, dest, pColor, pIcon, pCount);
      }

      // Apply reward
      applyWheelReward(segIdx);

      // Auto-dismiss after 1.5s
      setTimeout(() => {
        overlay.classList.add('hidden');
        if (winEl) winEl.classList.remove('winning');
        disc.style.transition = 'none';
        disc.style.transform = 'rotate(0deg)';
        if (callback) callback();
      }, 1500);
    }, finishDelay);
  }

  // Start physics-based spin animation
  disc.style.transition = 'none';

  function spinFrame() {
    // Update angles
    totalAngle += speed;
    angle = ((angle + speed) % 360 + 360) % 360;

    // Decay speed (friction)
    speed = speed - (1 - inertia) * speed;

    // Attractor: inverse-distance force toward target segment center
    const target = getAngleForIndex(segIdx);
    const orientedDist = getCircularDist(angle, target);
    const inverseMag = orientedDist === 0
      ? maxAttractionForce
      : Math.min(1 / Math.abs(orientedDist), maxAttractionForce);
    const attractForce = Math.sign(orientedDist) * inverseMag * attractionForceFactor;
    speed += attractForce;

    // Apply visual rotation using totalAngle
    disc.style.transform = 'rotate(' + totalAngle + 'deg)';

    // Tick sound on segment boundary crossing
    const currentSeg = getSliceIndex(angle);
    if (currentSeg !== lastSegCrossing) {
      lastSegCrossing = currentSeg;
      const vol = Math.min(0.15, Math.abs(speed) * 0.01);
      if (vol > 0.01) playSFX(1200, 0.02, 'square', vol);
    }

    // Stop condition: speed very low AND very close to target
    if (Math.abs(speed) < 0.01 && Math.abs(orientedDist) < 0.05) {
      disc.style.transform = 'rotate(' + totalAngle + 'deg)';
      resolveWheel(false);
      return;
    }

    animFrame = requestAnimationFrame(spinFrame);
  }

  animFrame = requestAnimationFrame(spinFrame);

  // Safety timeout: force-resolve after 10s if physics hasn't stopped
  const safetyTimer = setTimeout(() => {
    if (!resolved) resolveWheel(false);
  }, 10000);

  // Tap-to-skip
  function onTap(e) {
    e.stopPropagation();
    overlay.removeEventListener('click', onTap);
    overlay.removeEventListener('touchstart', onTap);
    resolveWheel(true);
  }
  // Delay tap listener slightly to avoid instant trigger
  setTimeout(() => {
    overlay.addEventListener('click', onTap, { once: true });
    overlay.addEventListener('touchstart', onTap, { once: true });
  }, 300);
}

// ── BUTTON HANDLERS ──
document.getElementById('death-run-btn').addEventListener('click', () => {
  initAudio();
  // Pre-warm engine sounds on user gesture (mobile requires this)
  // Just load them — don't play, to avoid any audible glitch
  const _ewEng = document.getElementById('engine-start');
  const _ewRoar = document.getElementById('engine-roar');
  if (_ewEng) { _ewEng.load(); }
  if (_ewRoar) { _ewRoar.load(); }
  playStartSound();
  startDeathRun();
});
document.getElementById('restart-btn').addEventListener('click', () => {
  if (!_gameOverTapReady) return; // cooldown guard
  initAudio();
  playStartSound();
  _triggerRetryWithSweep();
});
document.getElementById('gameover-exit-btn').addEventListener('click', () => {
  if (!_gameOverTapReady) return; // cooldown guard
  playExitSound();
  // [WHEEL DISABLED] reward wheel quarantined — skip straight to title
  returnToTitle();
});
// ═══════════════════════════════════════════════════════
//  SETTINGS SYSTEM
// ═══════════════════════════════════════════════════════
const SETTINGS_KEY = 'jh_settings';
let _settings = {
  musicVol: 80,     // 0-100
  sfxVol: 80,       // 0-100
  musicMuted: false,
  sfxMuted: false,
  hapticsOn: true,
};

function loadSettings() {
  try {
    const raw = window._LS.getItem(SETTINGS_KEY);
    if (raw) Object.assign(_settings, JSON.parse(raw));
  } catch(e) {}
}
function saveSettings() {
  window._LS.setItem(SETTINGS_KEY, JSON.stringify(_settings));
}
loadSettings();

// Derived volume multipliers (0-1)
function musicMult() { return _settings.musicMuted ? 0 : _settings.musicVol / 100; }
function sfxMult()   { return _settings.sfxMuted   ? 0 : _settings.sfxVol   / 100; }

// Apply music volume to all active tracks
function applyMusicVolume() {
  const m = musicMult();
  state.muted = m === 0 && sfxMult() === 0;
  Object.entries(TRACK_VOL).forEach(([k, base]) => {
    setTrackVol(k, base * m);
  });
}

// Open / close settings
function openSettings() {
  playTitleTap();
  const ov = document.getElementById('settings-overlay');
  if (!ov) return;
  // Sync sliders/buttons to current state
  document.getElementById('vol-music').value = _settings.musicVol;
  document.getElementById('vol-sfx').value = _settings.sfxVol;
  document.getElementById('mute-music').classList.toggle('muted', _settings.musicMuted);
  document.getElementById('mute-music').textContent = _settings.musicMuted ? '🔇' : '♪';
  document.getElementById('mute-sfx').classList.toggle('muted', _settings.sfxMuted);
  document.getElementById('mute-sfx').textContent = _settings.sfxMuted ? '🔇' : '♪';
  const hBtn = document.getElementById('haptic-toggle');
  hBtn.textContent = _settings.hapticsOn ? 'ON' : 'OFF';
  hBtn.classList.toggle('off', !_settings.hapticsOn);

  ov.classList.remove('hidden');
}
function closeSettings() {
  playTitleTap();
  document.getElementById('settings-overlay').classList.add('hidden');
}

// Wire up settings UI
(function initSettings() {
  const gearBtn = document.getElementById('settings-btn');
  if (gearBtn) gearBtn.addEventListener('click', () => { initAudio(); openSettings(); });

  const pauseSettingsBtn = document.getElementById('pause-settings-btn');
  if (pauseSettingsBtn) pauseSettingsBtn.addEventListener('click', () => { openSettings(); });

  document.getElementById('settings-close').addEventListener('click', closeSettings);

  // Replay tutorial button
  document.getElementById('replay-tutorial-btn').addEventListener('click', () => {
    window._LS.removeItem('jh_tutorial_done');
    closeSettings();
    // Apply JL_v1 physics as tutorial baseline
    const _tp = _PHYSICS_PRESETS['JL_v1'];
    _accelBase     = _tp.accelBase;
    _accelSnap     = _tp.accelSnap;
    _maxVelBase    = _tp.maxVelBase;
    _maxVelSnap    = _tp.maxVelSnap;
    _bankMax       = _tp.bankMax;
    _bankSmoothing = _tp.bankSmoothing;
    _decelBasePct  = _tp.decelBasePct;
    _decelFullPct  = _tp.decelFullPct;
    state._tutorialActive = true;  // must be set BEFORE startGame() so prologue is suppressed
    state._tutorialStep = -0.5;
    startGame();
    state._tutRocksSpawned = false;
    state._tutRocksPassed = 0;
  });

  // Jet Lightning mode button
  document.getElementById('jet-lightning-btn').addEventListener('click', () => {
    playStartSound();
    state._jetLightningMode = true;
    startJetLightning();
  });

  // ?canyon=1 — auto-fire JL button on first tap/click so mobile audio context unlocks
  if (_canyonTestMode) {
    const _canyonAutoStart = () => {
      document.removeEventListener('click',      _canyonAutoStart);
      document.removeEventListener('touchstart', _canyonAutoStart);
      document.getElementById('jet-lightning-btn').click();
    };
    document.addEventListener('click',      _canyonAutoStart, { once: true });
    document.addEventListener('touchstart', _canyonAutoStart, { once: true });
  }

  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'settings-overlay') closeSettings();
  });

  // Music volume slider
  document.getElementById('vol-music').addEventListener('input', (e) => {
    _settings.musicVol = parseInt(e.target.value);
    _settings.musicMuted = false;
    document.getElementById('mute-music').classList.remove('muted');
    document.getElementById('mute-music').textContent = '♪';
    applyMusicVolume();
    saveSettings();
  });

  // SFX volume slider
  document.getElementById('vol-sfx').addEventListener('input', (e) => {
    _settings.sfxVol = parseInt(e.target.value);
    _settings.sfxMuted = false;
    document.getElementById('mute-sfx').classList.remove('muted');
    document.getElementById('mute-sfx').textContent = '♪';
    saveSettings();
  });

  // Music mute toggle
  document.getElementById('mute-music').addEventListener('click', () => {
    _settings.musicMuted = !_settings.musicMuted;
    document.getElementById('mute-music').classList.toggle('muted', _settings.musicMuted);
    document.getElementById('mute-music').textContent = _settings.musicMuted ? '🔇' : '♪';
    applyMusicVolume();
    saveSettings();
  });

  // SFX mute toggle
  document.getElementById('mute-sfx').addEventListener('click', () => {
    _settings.sfxMuted = !_settings.sfxMuted;
    document.getElementById('mute-sfx').classList.toggle('muted', _settings.sfxMuted);
    document.getElementById('mute-sfx').textContent = _settings.sfxMuted ? '🔇' : '♪';
    saveSettings();
  });

  // Haptics toggle
  document.getElementById('haptic-toggle').addEventListener('click', () => {
    _settings.hapticsOn = !_settings.hapticsOn;
    const btn = document.getElementById('haptic-toggle');
    btn.textContent = _settings.hapticsOn ? 'ON' : 'OFF';
    btn.classList.toggle('off', !_settings.hapticsOn);
    if (_settings.hapticsOn) hapticTap();  // demo buzz
    saveSettings();
  });

  // "How to Play" button in settings
  document.getElementById('show-tutorial-btn').addEventListener('click', () => {
    closeSettings();
    const ov = document.getElementById('onboarding-overlay');
    if (ov) {
      ov.classList.remove('hidden');
      document.getElementById('onboarding-dismiss').addEventListener('click', () => {
        ov.classList.add('hidden');
      }, { once: true });
    }
  });

})();

// ═══════════════════════════════════════════════════════
//  HAPTIC FEEDBACK
// ═══════════════════════════════════════════════════════
function hapticTap()    { if (_settings.hapticsOn && navigator.vibrate) navigator.vibrate(10); }
function hapticMedium() { if (_settings.hapticsOn && navigator.vibrate) navigator.vibrate(25); }
function hapticHeavy()  { if (_settings.hapticsOn && navigator.vibrate) navigator.vibrate([40, 30, 40]); }

// ═══════════════════════════════════════════════════════
//  ONBOARDING (first play only)
// ═══════════════════════════════════════════════════════
const ONBOARD_KEY = 'jh_onboarded';
function maybeShowOnboarding() {
  // Disabled auto-popup — accessible from settings "HOW TO PLAY" button only
  return false;
}

// Legacy mute compat — state.muted still checked in many places
function toggleMute() {
  // Full mute — toggle both music and SFX
  const allMuted = _settings.musicMuted && _settings.sfxMuted;
  _settings.musicMuted = !allMuted;
  _settings.sfxMuted = !allMuted;
  state.muted = !allMuted;
  applyMusicVolume();
  saveSettings();
}

// ═══════════════════════════════════════════════════
//  GAME STATE TRANSITIONS
// ═══════════════════════════════════════════════════
// Canyon-only test mode — activated by ?canyon=1 URL param, skips normal game flow
var _canyonTestMode = new URLSearchParams(location.search).get('canyon') === '1';
let _skipL1Intro = false;  // set by startDeathRun() so startGame() skips L1 cinematic
let _gameStarting = false; // reentry lock — prevents double-fire from simultaneous inputs

// ── Retry with cinematic camera sweep (from game over) ──
let _retryPending = false; // guard against double-tap during fade
function _triggerRetryWithSweep() {
  if (_retrySweepActive || _retryPending) return; // debounce
  _retryPending = true;
  _retryIsFromDead = true;
  const fadeEl = document.getElementById('retry-fade');
  fadeEl.style.opacity = '1'; // fade to black (CSS 0.15s transition)
  const _wasDeathRun = state.isDeathRun;
  const _wasJetLightning = state._jetLightningMode;
  // Save JL continuation state before the reset wipes it
  const _jlDeathX    = _wasJetLightning ? (state.shipX || 0) : 0;
  const _jlDeathRamp = _wasJetLightning ? (_jlRampTime || 0) : 0;
  setTimeout(() => {
    _retryPending = false;
    // ── During black: reset scene ──
    if (_wasJetLightning) startJetLightning();
    else if (_wasDeathRun) startDeathRun();
    else startGame();
    // JL: restore ramp time + X position so player continues from death spot
    if (_wasJetLightning) {
      _jlRampTime   = _jlDeathRamp;
      state.shipX   = _jlDeathX;
      state.shipVelX = 0;
      shipGroup.position.x = _jlDeathX;
    }
    // Override: skip prologue, ship already at hover, thrusters on
    killThrusterSputter();          // kill any lingering sputter timer
    state.introActive = true;       // blocks obstacle spawning during sweep
    state.thrusterPower = 1;        // thrusters on immediately
    shipGroup.position.y = _hoverBaseY; // already hovering
    state._introLiftActive = false; // no lift animation
    // Kill death camera orbit so it doesn't fight the sweep
    _expCamOrbitActive = false;
    _expCamOrbitT = 0;
    // Position camera at establishing shot (above + behind)
    cameraPivot.position.copy(_RETRY_CAM_START);
    // Reset camera lookAt AFTER pivot move so rotation matches new position
    camera.rotation.set(0, 0, 0);
    camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
    camera.fov = _RETRY_FOV_START;
    camera.updateProjectionMatrix();
    // Start the sweep
    _retrySweepActive = true;
    _retrySweepT = 0;
    playRetryWhoosh();
    // Fade from black
    fadeEl.style.opacity = '0';
  }, 180); // wait for fade-to-black to complete
}

function startGame() {
  if (_gameStarting) return; // reentry guard — ignore double-taps / simultaneous inputs
  _gameStarting = true;
  const _tlb = document.getElementById('title-leaderboard');
  if (_tlb) _tlb.classList.add('hidden');
  // Show onboarding on very first play
  if (maybeShowOnboarding()) { _gameStarting = false; return; } // blocks game start until dismissed
  // Reset title glow pulse on shared materials before gameplay
  for (const entry of _titleMeshMap) {
    const mat = entry.mesh.material;
    if (mat && mat.userData && mat.userData._baseEI !== undefined) {
      mat.emissiveIntensity = mat.userData._baseEI;
      delete mat.userData._baseEI;
    }
  }
  clearIntroTimers();   // cancel any orphaned intro text timers
  clearMusicTimers();   // cancel any orphaned music crossfade timers
  // Apply the saved skin for gameplay (revert from any locked preview)
  const _skinData = loadSkinData();
  if (_skinAdminMode || isSkinUnlocked(_skinData.selected)) {
    applySkin(_skinData.selected);
  } else {
    applySkin(0);
  }
  state.phase          = 'playing';
  shipGroup.visible    = true;
  _killExplosion();
  // Clean up terrain walls if active
  _destroyTerrainWalls();
  // Clean up canyon if active
  if (_canyonActive || _canyonWalls) { _destroyCanyonWalls(); }
  _canyonActive = false;
  _canyonManual = false;
  _canyonMode = 0;
  _canyonSinePhase = 0;
  // Clean up lightning if active
  if (typeof window._clearAllLightning === 'function') window._clearAllLightning();
  if (_gameOverDelayTimer) { clearTimeout(_gameOverDelayTimer); _gameOverDelayTimer = null; }
  state.score          = 0;
  state.multiplier     = 1;
  state.currentLevelIdx = 0;
  state.startedFromL1  = true;
  state.isDeathRun     = false;
  state._jetLightningMode = false;
  // Clear JL sun warp — death-run tick will re-apply if applicable
  if (sunMat && sunMat.uniforms) sunMat.uniforms.uIsL3Warp.value = 0;
  if (sunCapMat && sunCapMat.uniforms) sunCapMat.uniforms.uIsL3Warp.value = 0;
  state.deathRunVibeIdx = 0;
  state.deathRunRestBeat       = 0;
  state.deathRunMechCooldown   = 0;
  state.deathRunCorridorMaxRows = 0;
  state.speed          = BASE_SPEED;
  state.shipX          = 0;
  state.shipVelX       = 0;
  state.rollAngle      = 0;
  state.rollHeld       = false;
  touch.rollToggle     = false;
  touch.rollUp         = false;
  touch.rollDown       = false;
  state.rollDir        = 0;
  shipGroup.rotation.z = 0;
  state.tiltTimer      = 0;
  state.corridorCenter = 0;
  state.corridorMode       = false;
  state.corridorSpawnZ     = -7;
  state.corridorRowsDone   = 0;
  state.corridorGapCenter  = 0;
  state.corridorGapDir     = 1;
  state.corridorSineT      = 0;
  state.levelElapsed       = 0;
  state.l4CorridorDone     = false;
  state.l4CorridorActive   = false;
  state.l4RowsDone         = 0;
  state.l4SineT            = 0;
  state.l4SpawnZ           = -7;
  state.l4Delay            = 0;
  state.l4StartElapsed     = 0;

  state.zipperHoldCount    = 0;
  auroraFadeT = 0;
  auroraTime  = 0;
  auroraTVisible = false;
  auroraGroup.visible = false;
  l5fFadeT = 0;
  l5fTime  = 0;
  l5fGroup.visible = false;
  state.corridorDelay      = 0;
  state.postL3Gap            = 0;
  state.wallCenterX = 0;
  state.zipperActive       = false;
  state.zipperRowsLeft     = 0;
  state.zipperCooldown     = 0;
  state.zipperSide         = 1;
  state.zipperHoldCount    = 0;
  state.zipperSpawnTimer   = 0;
  state.zipperRunCount     = 0;
  state.l5PreZipperRandom  = 0;
  state.slalomActive       = false;
  state.slalomSpawnZ       = -7;
  state.slalomRowsDone     = 0;
  state.slalomMaxRows      = 0;
  // Carved corridor
  state.drPatternCooldown  = 0;
  // Custom pattern will trigger via mechanic manager after intro
  state.drCustomPatternActive = false;
  state.drCustomPatternRow = 0;
  state.drCustomPatternSpawnZ = -7;
  // Gauntlet
  state.gauntletActive   = false;
  state.gauntletRowsLeft = 0;
  state.gauntletGapLane  = 0;
  state.gauntletGapDir   = 1;
  state.gauntletCooldown = 0;
  // Ship wobble + transient flags
  state.shieldHit    = false;
  state.wobbleAmp    = 0;
  state.wobblePhase  = 0;
  state.wobbleDir    = 0;
  state.wasSteering  = false;
  state.l5EndingActive    = false;
  state.l5CorridorActive   = false;
  state.l5CorridorDone     = false;
  state.l5CorridorRowsDone = 0;
  state.l5CorridorSpawnZ   = -7;
  state.l5SineT            = 0;
  state.introActive    = false;
  state.thrusterPower   = 0;     // start off, turned on by prologue/launch
  l5DustPoints.visible = false;  // reset chromatic dust
  state.l5EndingTimer  = 0;
  state.l5TitleShown   = false;
  state.l5RandomAfterZipper = 0;
  state.l5RandomAfterCorridor = 0;
  state.zipperSpawnZ   = -7;
  camTargetX           = 0;
  // Reset camera to starting position (full reset — prevent stale death/retry state)
  _retrySweepActive = false;
  _retrySweepT = 0;
  cameraPivot.position.set(0, 2.8 + _camPivotYOffset, 9 + _camPivotZOffset);
  cameraRoll = 0;
  camera.rotation.set(0, 0, 0);
  camera.position.set(0, 0, 0);
  camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
  camera.fov = _baseFOV + 15; // start zoomed out so gameplay launch snaps inward
  camera.updateProjectionMatrix();
  // Reset thrust state
  _jumpVelY = 0;
  _jumpActive = false;
  _thrustHeld = false;
  _jumpLandingBounceT = 0;
  state.shieldActive   = false;
  state.laserActive    = false;
  state.magnetActive   = false;
  _stopMagnetWhir();
  state.invincibleSpeedActive = false;
  state.multiplierTimer = 0;
  state.invincibleTimer = 0;
  state.laserTimer     = 0;
  state.sessionCoins   = 0;
  _activeCoinMult      = 1;  // reset coin multiplier for new run
  state.sessionPowerups = 0;
  state.sessionShields = 0;
  state.sessionLasers = 0;
  state.sessionInvincibles = 0;
  state._missionCheckTimer = 0;
  state._missionToasted = false;
  state.saveMeCount     = 0;
  state.playerScore     = 0;
  state.nearMissBendAllowed = true;
  state.nearMissFlash       = 0;
  state.prevCorridorCenter  = 0;
  state.prevCorridorDir     = 0;
  coinArcPending.length = 0;
  ;[...activeCoins].forEach(returnCoinToPool);
  activeCoins.length   = 0;
  framesSinceLastCoin  = 0;
  state.magnetTimer    = 0;
  state.shieldHitPoints = 1;
  state.shieldDuration  = 0;
  state.shieldTimer     = 0;
  state._prevShieldHP   = 0;
  state._shieldBreakT   = null;
  state.laserTier       = 1;
  state.laserBoltTimer  = 0;
  state.laserFireRate   = 5;
  state.laserColor      = 0xff2200;
  state.invincibleGrace = 2.0;
  state.magnetRadius    = 18;
  state.magnetPullsPowerups = false;
  // Hide any lingering laser bolts
  laserBolts.forEach(b => { b.visible = false; });
  state.nextSpawnZ     = -5;
  _noSpawnMode         = false; // always reset on game start
  state.frameCount     = 0;
  state.elapsed        = 0;
  framesSinceLastPowerup = 0;

  // Clear all in-flight objects and mechanic state
  _clearAllMechanics();
  [..._activeForcefields].forEach(returnForcefieldToPool);
  _activeForcefields.length = 0;
  _awTunerPaused = false;
  // Reset ALL pool meshes (not just active ones) so nothing lingers from last session
  powerupPool.forEach(pu => {
    pu.userData.active = false;
    pu.visible = false;
    pu.position.set(0, -9999, 0);
    pu.scale.setScalar(1);
  });
  activePowerups.length = 0;

  shieldMesh.visible = false; shieldWire.visible = false;
  shieldMat.uniforms.uReveal.value = 1.0;
  shieldWireMat.opacity = 0;
  shieldLight.intensity = 0;
  laserMat.opacity  = 0;
  laserGlowMat.opacity = 0;
  laserPivot.visible = false;
  laserBolts.forEach(b => { b.visible = false; });
  magnetRing.visible = false; magnetRing2.visible = false;
  magnetRingMat.opacity = 0;
  magnetRing2.material.opacity = 0;
  magnetLight.intensity = 0;

  currentLevelDef = LEVELS[0];
  targetLevelDef  = LEVELS[0];
  transitionT     = 1;
  applyLevelVisuals(LEVELS[0]);

  // Fade title screen out instead of instant hide (skip on retry — already hidden)
  const titleEl = document.getElementById('title-screen');
  if (!_retryIsFromDead) {
    titleEl.classList.add('fading-out');
    if (_titleFadeTimer) clearTimeout(_titleFadeTimer);
    _titleFadeTimer = setTimeout(() => {
      _titleFadeTimer = null;
      if (state.phase !== 'title') titleEl.classList.add('hidden');
    }, 750);
  }
  // Hide standalone leaderboard (lives outside title-screen div)
  const _lb = document.getElementById('title-leaderboard');
  if (_lb) _lb.classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  setPauseOverlay(false);
  document.getElementById('settings-btn').style.display = 'none'; // hide gear during gameplay
  document.getElementById('lb-icon-btn').style.display = 'none'; // hide trophy during gameplay
  document.getElementById('lb-overlay').classList.add('hidden');
  // Show touch controls on mobile (any touch-capable device)
  if (navigator.maxTouchPoints > 0) {
    document.getElementById('touch-controls').classList.remove('hidden');
  }
  updateHUDLevel();
  updateMultiplierHUD();
  updatePowerupTray();

  // Ensure audio context and all elements are ready
  initAudio();
  // Warm up audio elements on user gesture so iOS/mobile allows deferred play
  // All set to volume 0 during warmup to prevent audible blips
  // Warm up engine-start on user gesture so mobile allows deferred play (campaign only)
  if (!_skipL1Intro) {
    const _eng = document.getElementById('engine-start');
    if (_eng) { _eng.volume = 0; _eng.play().then(() => { _eng.pause(); _eng.currentTime = 0; _eng.volume = 1; }).catch(() => { _eng.volume = 1; }); }
  }
  [['l3', l3Music], ['l4', l4Music]].forEach(([k, el]) => {
    if (el && el.paused) { setTrackVol(k, 0); el.play().then(() => { el.pause(); el.currentTime = 0; }).catch(() => {}); }
  });
  // Hard-reset ALL tracks — kill title immediately, no overlap
  if (activeFadeIv) { clearInterval(activeFadeIv); activeFadeIv = null; }
  [['bg', bgMusic], ['l3', l3Music], ['l4', l4Music], ['title', titleMusic]].forEach(([k, el]) => {
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setTrackVol(k, 0);
  });
  // Short fade-in for gameplay track (title already silenced above)
  const _startTrack = state.currentLevelIdx >= 2 ? 'l3' : 'bg';
  const _startEl = _startTrack === 'l3' ? l3Music : bgMusic;
  if (_startEl && !state.muted) {
    _startEl.currentTime = 0;
    setTrackVol(_startTrack, 0);
    _startEl.play().catch(() => {});
    musicFadeTo(_startTrack, 800);
  }
  // Ensure lakeMusic element is bound before trying to play
  if (!lakeMusic) { lakeMusic = document.getElementById('lake-music'); }
  // Start lake ambience loop with fade-in matching gameplay track
  if (lakeMusic && !state.muted) {
    setTrackVol('lake', 0);
    lakeMusic.play().catch(() => {});
    // Fade lake in over 800ms to match bg track fade
    const _lakeStart = performance.now();
    const _lakeFade = setInterval(() => {
      const t = Math.min((performance.now() - _lakeStart) / 800, 1);
      setTrackVol('lake', TRACK_VOL.lake * t);
      if (t >= 1) clearInterval(_lakeFade);
    }, 16);
  }
  // engine hum removed

  // ── L1 cinematic intro text (only on fresh game start at level 0, NOT on retry) ──
  if (state.currentLevelIdx === 0 && !_skipL1Intro && !state._tutorialActive && !state._jetLightningMode && !_retryIsFromDead) {
    state.introActive = true;   // blocks cone spawning
    state.thrusterPower = 0;    // thrusters off during prologue
    showIntroText();
  }

  // ── HEAD START PROMPT (skip on retry — camera sweep replaces it) ──
  if (!_retryIsFromDead) showHeadStartPrompt();
  // Release reentry lock after one frame so simultaneous events have already fired
  requestAnimationFrame(() => { _gameStarting = false; });
}

// ═══════════════════════════════════════════════════
//  DEATH RUN MODE
// ═══════════════════════════════════════════════════
// Death Run vibe cycle thresholds — every 150 points, cycle to next vibe
const DEATH_RUN_VIBE_INTERVAL = 150;

const DEATH_RUN_VIBES = [
  {
    name: 'NEON DAWN',
    skyTop: new THREE.Color(0x03070f), skyBot: new THREE.Color(0x08102a),
    gridColor: new THREE.Color(0x00eeff), sunColor: new THREE.Color(0xff9500),
    sunStripeColor: new THREE.Color(0xff5500), bloomStrength: 0.35,
    fogColor: new THREE.Color(0x05091a),
    floorLine: new THREE.Color(0x00eeff),
    thrusterColor: new THREE.Color(0xaaddff),
    sunShader: 0, tendrils: 'none',
    obstaclesPerSpawn: 6, maxObstaclesPerSpawn: 8, gapFactor: 1.0, speedTier: 1,
  },
  {
    name: 'ULTRAVIOLET',
    skyTop: new THREE.Color(0x060010), skyBot: new THREE.Color(0x0e0320),
    gridColor: new THREE.Color(0xdd00ff), sunColor: new THREE.Color(0xcc44ff),
    sunStripeColor: new THREE.Color(0x8800cc), bloomStrength: 0.38,
    fogColor: new THREE.Color(0x080018),
    floorLine: new THREE.Color(0xcc44ff),
    thrusterColor: new THREE.Color(0xee00ff),
    sunShader: 1, tendrils: 'none',
    obstaclesPerSpawn: 7, maxObstaclesPerSpawn: 9, gapFactor: 0.95, speedTier: 1,
  },
  {
    name: 'ELECTRIC HORIZON',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x050002),
    gridColor: new THREE.Color(0x00ffcc), sunColor: new THREE.Color(0xff6600),
    sunStripeColor: new THREE.Color(0xff4400), bloomStrength: 0.38,
    fogColor: new THREE.Color(0x020001),
    floorLine: new THREE.Color(0x00ffaa),
    thrusterColor: new THREE.Color(0x00eeff),
    sunShader: 0, tendrils: 'none',
    // Warp palette: dark=(1,1,1) mid=(0.05,0,0) bright=(0,0,0.08)
    warpCol1: [1.00, 1.00, 1.00],
    warpCol2: [0.05, 0.00, 0.00],
    warpCol3: [0.00, 0.00, 0.08],
    obstaclesPerSpawn: 8, maxObstaclesPerSpawn: 10, gapFactor: 0.9, speedTier: 2,
  },
  {
    name: 'ICE STORM',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x000c18),
    gridColor: new THREE.Color(0x55ffff), sunColor: new THREE.Color(0xaaeeff),
    sunStripeColor: new THREE.Color(0x4499cc), bloomStrength: 0.30,
    fogColor: new THREE.Color(0x00080f),
    floorLine: new THREE.Color(0x44ccff),
    thrusterColor: new THREE.Color(0x88ddff),
    sunShader: 3, tendrils: 'aurora',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 3,
  },
  {
    name: 'VOID SINGULARITY',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x060400),
    gridColor: new THREE.Color(0xffcc00), sunColor: new THREE.Color(0xffaa33),
    sunStripeColor: new THREE.Color(0xff6600), bloomStrength: 0.30,
    fogColor: new THREE.Color(0x030200),
    floorLine: new THREE.Color(0xffd700),
    thrusterColor: new THREE.Color(0xff9a00),
    sunShader: 4, tendrils: 'l5f',
    // Warp palette: dark=(0.23,1,0) mid=(0,0.14,0.10) bright=(0.13,0.45,0)
    warpCol1: [0.23, 1.00, 0.00],
    warpCol2: [0.00, 0.14, 0.10],
    warpCol3: [0.13, 0.45, 0.00],
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 4,
  },
  {
    name: 'DEEP EMERALD',
    skyTop: new THREE.Color(0x000f06), skyBot: new THREE.Color(0x001a0a),
    gridColor: new THREE.Color(0x00ff88), sunColor: new THREE.Color(0x66ffaa),
    sunStripeColor: new THREE.Color(0x22aa55), bloomStrength: 0.32,
    fogColor: new THREE.Color(0x000a04),
    floorLine: new THREE.Color(0x00ff88),
    thrusterColor: new THREE.Color(0x44ffaa),
    sunShader: 0, tendrils: 'none',
    obstaclesPerSpawn: 7, maxObstaclesPerSpawn: 9, gapFactor: 0.92, speedTier: 4,
  },
  {
    name: 'SOLAR FLARE',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x100800),
    gridColor: new THREE.Color(0xff6600), sunColor: new THREE.Color(0xffdd88),
    sunStripeColor: new THREE.Color(0xff4400), bloomStrength: 0.45,
    fogColor: new THREE.Color(0x080400),
    floorLine: new THREE.Color(0xff6600),
    thrusterColor: new THREE.Color(0xff8833),
    sunShader: 2, tendrils: 'l5f',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 12, gapFactor: 0.85, speedTier: 4,
  },
  {
    name: 'MIDNIGHT ROSE',
    skyTop: new THREE.Color(0x0a0010), skyBot: new THREE.Color(0x180020),
    gridColor: new THREE.Color(0xff44aa), sunColor: new THREE.Color(0xff88cc),
    sunStripeColor: new THREE.Color(0xaa2266), bloomStrength: 0.36,
    fogColor: new THREE.Color(0x0a0012),
    floorLine: new THREE.Color(0xff44aa),
    thrusterColor: new THREE.Color(0xff66bb),
    sunShader: 1, tendrils: 'none',
    obstaclesPerSpawn: 8, maxObstaclesPerSpawn: 10, gapFactor: 0.9, speedTier: 4,
  },
  {
    name: 'TOXIC',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x0a0f00),
    gridColor: new THREE.Color(0x88ff00), sunColor: new THREE.Color(0xccff44),
    sunStripeColor: new THREE.Color(0x66aa00), bloomStrength: 0.38,
    fogColor: new THREE.Color(0x040800),
    floorLine: new THREE.Color(0x88ff00),
    thrusterColor: new THREE.Color(0xaaff22),
    sunShader: 4, tendrils: 'none',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 4,
  },
  {
    name: 'ARCTIC DAWN',
    skyTop: new THREE.Color(0x000408), skyBot: new THREE.Color(0x001020),
    gridColor: new THREE.Color(0xccddff), sunColor: new THREE.Color(0xeeeeff),
    sunStripeColor: new THREE.Color(0x8899bb), bloomStrength: 0.28,
    fogColor: new THREE.Color(0x000810),
    floorLine: new THREE.Color(0xccddff),
    thrusterColor: new THREE.Color(0xbbccee),
    sunShader: 3, tendrils: 'aurora',
    obstaclesPerSpawn: 8, maxObstaclesPerSpawn: 10, gapFactor: 0.9, speedTier: 4,
  },
  {
    name: 'BLOOD MOON',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x100000),
    gridColor: new THREE.Color(0xaa0000), sunColor: new THREE.Color(0xcc2200),
    sunStripeColor: new THREE.Color(0x880000), bloomStrength: 0.40,
    fogColor: new THREE.Color(0x080000),
    floorLine: new THREE.Color(0xaa0000),
    thrusterColor: new THREE.Color(0xff2200),
    sunShader: 2, tendrils: 'none',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 13, gapFactor: 0.82, speedTier: 4,
  },
  {
    name: 'ELECTRIC INDIGO',
    skyTop: new THREE.Color(0x000010), skyBot: new THREE.Color(0x000830),
    gridColor: new THREE.Color(0x4444ff), sunColor: new THREE.Color(0x6688ff),
    sunStripeColor: new THREE.Color(0x2222aa), bloomStrength: 0.35,
    fogColor: new THREE.Color(0x000018),
    floorLine: new THREE.Color(0x4444ff),
    thrusterColor: new THREE.Color(0x6666ff),
    sunShader: 0, tendrils: 'aurora',
    obstaclesPerSpawn: 8, maxObstaclesPerSpawn: 10, gapFactor: 0.9, speedTier: 4,
  },
  {
    name: 'COPPER',
    skyTop: new THREE.Color(0x060300), skyBot: new THREE.Color(0x0a0500),
    gridColor: new THREE.Color(0xcc7733), sunColor: new THREE.Color(0xdd8844),
    sunStripeColor: new THREE.Color(0x995522), bloomStrength: 0.32,
    fogColor: new THREE.Color(0x040200),
    floorLine: new THREE.Color(0xcc7733),
    thrusterColor: new THREE.Color(0xdd9955),
    sunShader: 4, tendrils: 'l5f',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 4,
  },
  {
    name: 'PLASMA',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x000810),
    gridColor: new THREE.Color(0xaaccff), sunColor: new THREE.Color(0xeeffff),
    sunStripeColor: new THREE.Color(0x6699cc), bloomStrength: 0.48,
    fogColor: new THREE.Color(0x000408),
    floorLine: new THREE.Color(0xaaccff),
    thrusterColor: new THREE.Color(0xccddff),
    sunShader: 3, tendrils: 'aurora',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 12, gapFactor: 0.85, speedTier: 4,
  },
  {
    name: 'OBSIDIAN',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x040404),
    gridColor: new THREE.Color(0x442200), sunColor: new THREE.Color(0x553311),
    sunStripeColor: new THREE.Color(0x331100), bloomStrength: 0.22,
    fogColor: new THREE.Color(0x020202),
    floorLine: new THREE.Color(0x442200),
    thrusterColor: new THREE.Color(0x664422),
    sunShader: 0, tendrils: 'none',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 13, gapFactor: 0.82, speedTier: 4,
  },
  {
    name: 'SUPERNOVA',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x0f0800),
    gridColor: new THREE.Color(0xff8800), sunColor: new THREE.Color(0xffcc00),
    sunStripeColor: new THREE.Color(0xff5500), bloomStrength: 0.50,
    fogColor: new THREE.Color(0x080400),
    floorLine: new THREE.Color(0xff8800),
    thrusterColor: new THREE.Color(0xffaa33),
    sunShader: 4, tendrils: 'l5f',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 12, gapFactor: 0.85, speedTier: 4,
  },
  {
    name: 'PHANTOM',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x080818),
    gridColor: new THREE.Color(0x8866cc), sunColor: new THREE.Color(0xaa88ee),
    sunStripeColor: new THREE.Color(0x553399), bloomStrength: 0.34,
    fogColor: new THREE.Color(0x040410),
    floorLine: new THREE.Color(0x8866cc),
    thrusterColor: new THREE.Color(0x9977dd),
    sunShader: 1, tendrils: 'none',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 4,
  },
  {
    name: 'DEEPWATER',
    skyTop: new THREE.Color(0x000008), skyBot: new THREE.Color(0x001030),
    gridColor: new THREE.Color(0x0066cc), sunColor: new THREE.Color(0x3399ff),
    sunStripeColor: new THREE.Color(0x003388), bloomStrength: 0.32,
    fogColor: new THREE.Color(0x000818),
    floorLine: new THREE.Color(0x0066cc),
    thrusterColor: new THREE.Color(0x4488dd),
    sunShader: 3, tendrils: 'aurora',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 4,
  },
  {
    name: 'MOLTEN',
    skyTop: new THREE.Color(0x080000), skyBot: new THREE.Color(0x100400),
    gridColor: new THREE.Color(0xff3300), sunColor: new THREE.Color(0xff6644),
    sunStripeColor: new THREE.Color(0xcc2200), bloomStrength: 0.44,
    fogColor: new THREE.Color(0x060200),
    floorLine: new THREE.Color(0xff3300),
    thrusterColor: new THREE.Color(0xff4411),
    sunShader: 2, tendrils: 'l5f',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 13, gapFactor: 0.82, speedTier: 4,
  },
  {
    name: 'WHITE DWARF',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x080808),
    gridColor: new THREE.Color(0xdddddd), sunColor: new THREE.Color(0xffffff),
    sunStripeColor: new THREE.Color(0x999999), bloomStrength: 0.25,
    fogColor: new THREE.Color(0x040404),
    floorLine: new THREE.Color(0xdddddd),
    thrusterColor: new THREE.Color(0xeeeeee),
    sunShader: 3, tendrils: 'none',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 13, gapFactor: 0.82, speedTier: 4,
  },
];

function startDeathRun() {
  clearMusicTimers();
  // Tell startGame() to skip the L1 cinematic — death run has its own prologue
  _skipL1Intro = true;
  startGame();
  _skipL1Intro = false;

  state.isDeathRun      = true;
  state.startedFromL1   = false;
  state.deathRunVibeIdx = 0;
  _pendingVibeIdx = -1;
  state._pendingSpeedTier = -1;
  state._drForcedBand = -1;
  state._drBand4Started = false;
  state._drBand5StartTime = 0;
  state._arcActive = false;
  state._arcQueue = null;
  state._arcStage = 0;
  state._drSpeedFloor = 0; // ratchet: once L5 corridor hits, speed never drops below its mult

  // Wave director state (kept for endless mix fallback)
  DR2_RUN_BANDS = _drGetRunBands();
  state.drPhase           = 'RELEASE';
  state.drPhaseTimer      = 0;
  const _initRelDur       = DR2_PHASE_DURATIONS.RELEASE;
  state.drPhaseDuration   = _initRelDur.min + Math.random() * (_initRelDur.max - _initRelDur.min);
  state.drWaveCount       = 0;
  state.drIntensity       = 0;
  state.drRecentFamilies  = [];
  state._band1Loops        = 0;

  // Level sequencer state
  state.seqStageIdx        = 0;
  state.seqStageElapsed    = 0;
  state._seqVibeApplied    = -1;
  state._seqCorridorStarted = false;
  state._seqZipTimer       = 0;
  state._restBeepFired     = false;
  state._endlessVibeIdx    = 4;
  state.distance           = 0;
  state._seqAngledTimer    = 0;
  state._seqSlalomFired    = false;
  state._seqZipFired       = false;
  state._seqSpawnMode      = 'cones';

  // Init fuel cell HUD
  const _fcHudInit = document.getElementById('hud-fuelcells');
  if (_fcHudInit) _fcHudInit.textContent = window._LS.getItem('jetslide_fuelcells') || '0';

  // Legacy DR1 state (still read by some paths)
  state.deathRunRestBeat       = 0;
  state.deathRunMechanic       = 'random';
  state.deathRunMechTimer      = 0;
  state.deathRunMechCooldown   = 0;
  state.deathRunCorridorMaxRows = 0;
  state.deathRunSpeedTier      = 0;
  state.drPatternCooldown      = 0;

  clearAllCorridorFlags();
  _drTransActive = false;
  _drTransT = 1;

  // Start visuals on first vibe (NEON DAWN)
  state.currentLevelIdx = DEATH_RUN_VIBES[0].sunShader;
  currentLevelDef = LEVELS[0];
  targetLevelDef  = LEVELS[0];
  transitionT     = 1;
  applyLevelVisuals(LEVELS[0]);
  updateHUDLevel();

  // Tutorial — fire on first ever run
  state._tutorialActive      = false; // disabled auto-start — settings-only access
  state._tutorialStep        = -1; // -1 = waiting for first frame before showing box
  if (state._tutorialActive) {
    state.speed = BASE_SPEED * _funFloorSpeed; // fun floor: dial in starting speed via T tuner
    setTimeout(() => {
      state._tutorialStep = -0.5; // start with rock mounds
    }, 100);
  } else {
    state._tutorialStep = 0;
  }
  state._tutorialTimer       = 0;
  state._tutorialSubStep     = 0;
  state._tutorialConeSpawned = false;
  state._tutorialConeZ       = -80;
  state._tutRocksSpawned     = false;
  state._tutRocksPassed      = 0;    // how many rocks have passed the player
  state._tutorialZipZ        = -99;
  state._tutorialZipRows     = 0;
  state._tutorialZipPassed     = false;
  state._tutorialZipSuccesses  = 0;
  state._tutorialZipHit        = false;
  state._tutorialZipRowSpawned  = false;

  // Rings disabled during gameplay for now (tuner still available via hotkey)
  // Also clear any rings that were on the title screen
  if (state._tutorialActive) _ringRemoveAll();

  // Prologue: ship idles, wait for tap to launch (skip in tutorial and retry)
  if (!state._tutorialActive && !_retryIsFromDead) {
    state.introActive    = true;
    state.thrusterPower  = 0;
    state.speed          = BASE_SPEED * 0.35;
  }

  // Music: start with L1 bg track, crossfade to l3/l4 as difficulty ramps
  if (activeFadeIv) { clearInterval(activeFadeIv); activeFadeIv = null; }
  [['bg', bgMusic], ['l3', l3Music], ['l4', l4Music], ['title', titleMusic]].forEach(([k, el]) => {
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setTrackVol(k, 0);
  });
  state.deathRunMusicPhase = 0;
  if (bgMusic && !state.muted) {
    bgMusic.currentTime = 0;
    setTrackVol('bg', 0);
    bgMusic.play().catch(() => {});
    musicFadeTo('bg', 800);
  }

  // Show cinematic prologue overlay (skip in tutorial and retry)
  const overlay = document.getElementById('intro-overlay');
  if (overlay && !state._tutorialActive && !_retryIsFromDead) {
    clearIntroTimers();
    overlay.innerHTML = '';
    overlay.style.display = 'flex';
    overlay.style.pointerEvents = 'auto';

    const lineA = document.createElement('div');
    lineA.className = 'intro-line line-a';
    lineA.textContent = 'ONE RUN STANDS BETWEEN YOU AND PEACE.';

    const lineB = document.createElement('div');
    lineB.className = 'intro-line line-b';
    lineB.textContent = 'THIS IS THAT RUN.';

    const lineC = document.createElement('div');
    lineC.className = 'intro-title line-c';
    lineC.textContent = 'JET HORIZON';

    const skipHint = document.createElement('div');
    skipHint.className = 'intro-skip-hint';
    skipHint.textContent = 'tap to skip';

    overlay.appendChild(lineA);
    overlay.appendChild(lineB);
    overlay.appendChild(lineC);
    overlay.appendChild(skipHint);

    // Line A fades in at 3s
    _introTimers.push(setTimeout(() => { lineA.classList.add('playing'); }, 3000));
    // Line B at 8.5s
    _introTimers.push(setTimeout(() => { lineB.classList.add('playing'); }, 8500));
    // Engine startup SFX at 8.5s
    _introTimers.push(setTimeout(() => {
      const eng = document.getElementById('engine-start');
      if (eng && !state.muted) {
        _ensureCtxRunning();
        eng.currentTime = 0;
        eng.volume = 0.12;
        eng.play().catch(() => {});
      }
    }, 8500));
    // Pre-spurts — thruster flickers
    function _preSpurt(delay, peak, dur) {
      _introTimers.push(setTimeout(() => {
        if (!state.introActive) return;
        const _start = performance.now();
        const _iv = setInterval(() => {
          const t = (performance.now() - _start) / dur;
          if (t >= 1) { state.thrusterPower = 0; clearInterval(_iv); return; }
          const env = t < 0.25 ? (t / 0.25) : (1 - (t - 0.25) / 0.75);
          state.thrusterPower = env * peak;
        }, 16);
        _introTimers.push(_iv);
      }, delay));
    }
    _preSpurt(10000, 0.45, 125);
    _preSpurt(10175, 0.35, 110);
    _preSpurt(11800, 0.5, 130);
    _preSpurt(11980, 0.35, 110);
    _preSpurt(12140, 0.25, 100);
    _preSpurt(13500, 0.4, 125);
    _preSpurt(13675, 0.3, 110);
    // JET HORIZON title at 14s
    _introTimers.push(setTimeout(() => { lineC.classList.add('playing'); }, 14000));
    // Auto-launch at 18.5s
    _introTimers.push(setTimeout(() => { _launchDeathRun(); }, 18500));

    function _launchDeathRun(e) {
      if (!state.introActive) return; // already launched
      if (e) { e.preventDefault(); e.stopPropagation(); }
      overlay.removeEventListener('touchstart', _launchDeathRun);
      overlay.removeEventListener('click', _launchDeathRun);
      document.removeEventListener('keydown', _launchKey);
      clearIntroTimers();

      fadeOutIntroOverlay(overlay);
      state.introActive = false;
      state.elapsed = 0; // reset so wave director Band 1 starts fresh from launch

      // Engine roar only on launch (engine-start already killed by clearIntroTimers)
      killThrusterSputter();
      const roar = document.getElementById('engine-roar');
      if (roar && !state.muted) {
        _ensureCtxRunning();
        roar.currentTime = 0;
        roar.volume = 0.08;
        roar.play().catch(() => {});
      }
      beginThrusterSputter(); // sputtering ramp-up to full power
      // Trigger lift immediately on launch — ship rises from 0.38 as thrusters fire
      state._introLiftActive = true;
      state._introLiftTimer = 0;
      state._introShipY = 0.38;

      const firstVibe = DEATH_RUN_VIBES[0];
      const speedIdx = Math.min(firstVibe.speedTier, 4);
      state.speed = BASE_SPEED * LEVELS[speedIdx].speedMult;
      // Opening bonus rings — right in front of ship, fly into them before cones
      _ringRemoveAll();
      _ringSpawnRow(0, true); // spawn close to ship for immediate action
      // Wave FSM handles all sequencing from here
    }
    function _launchKey(e) {
      if (e.key === 'Enter' || e.key === ' ') _launchDeathRun();
    }
    overlay.addEventListener('touchstart', _launchDeathRun, { passive: false });
    overlay.addEventListener('click', _launchDeathRun);
    document.addEventListener('keydown', _launchKey);
  }
}

// ── DeathRun2 phase durations (Phase 1 stub — full system in Phase 2) ──
const DR2_PHASE_DURATIONS = { RELEASE: {min:2, max:4}, BUILD: {min:0,max:0}, PEAK: {min:0,max:0}, SUSTAIN: {min:2,max:3}, RECOVERY: {min:2, max:4} };
// Run bands determine wave intensity — how hard the corridor is and how long.
// Band 1 duration shrinks with player level: 20s at level 1, down to 8s at level 10+
function _drBand1Duration() {
  const lvl = loadPlayerLevel();
  return Math.max(8, 20 - (lvl - 1) * 1.5);
}
const DR2_RUN_BANDS_BASE = [
  { label: 'BAND1', buildRows: {min:12, max:18}, peakRows: {min:0, max:0},  buildVariant: 'standard', peakVariant: 'standard', peakChance: 0    },
  { label: 'BAND2', buildRows: {min:55, max:65}, peakRows: {min:60, max:70}, buildVariant: 'standard', peakVariant: 'standard', peakChance: 0    },
  { label: 'BAND3', buildRows: {min:30, max:40}, peakRows: {min:35, max:50}, buildVariant: 'l4',       peakVariant: 'l4',       peakChance: 0    },
  { label: 'BAND4', buildRows: {min:40, max:50}, peakRows: {min:45, max:55}, buildVariant: 'l4',       peakVariant: 'l5',       peakChance: 0.5  },
  { label: 'BAND5', buildRows: {min:35, max:45}, peakRows: {min:40, max:55}, buildVariant: 'l4',       peakVariant: 'l5',       peakChance: 0.55 },
  { label: 'BAND6', buildRows: {min:40, max:50}, peakRows: {min:45, max:60}, buildVariant: 'l4',       peakVariant: 'l5',       peakChance: 0.65 },
];
// Build runtime bands with resolved Band 1 duration
// Band 4 (corridors) has dynamic duration — uses Infinity, but the wave director
// forces a CORRIDOR_ARC and advances to Band 5 when it finishes.
function _drGetRunBands() {
  return [
    { maxTime: 30,       ...DR2_RUN_BANDS_BASE[0] },
    { maxTime: 60,       ...DR2_RUN_BANDS_BASE[1] },
    { maxTime: 90,       ...DR2_RUN_BANDS_BASE[2] },
    { maxTime: Infinity, ...DR2_RUN_BANDS_BASE[3] }, // Band 4: corridor arc, advances on completion
    { maxTime: Infinity, ...DR2_RUN_BANDS_BASE[4] }, // Band 5: 30s after corridors finish
    { maxTime: Infinity, ...DR2_RUN_BANDS_BASE[5] }, // Band 6: mix everything
  ];
}
// Alias for backward compat (static reference used by debug HUD etc.)
let DR2_RUN_BANDS = _drGetRunBands();

// ═══════════════════════════════════════════════════
//  LEVEL SEQUENCER — replaces random wave director
// ═══════════════════════════════════════════════════
const DR_SEQUENCE = [
  // Tier 1: warm-up
  { name: 'T1_WARMUP',      type: 'random_cones', duration: 30, speed: 1.0,  density: 'sparse', vibeIdx: 0, physTier: 0 },
  // Tier 2: ramp-up
  { name: 'T2_RAMPUP',      type: 'random_cones', duration: 30, speed: 1.2,  density: 'dense',  vibeIdx: 1, physTier: 0 },
  // Tier 3a: cones + zip lines
  { name: 'T3A_ZIPS',       type: 'cones_and_zips', duration: 30, speed: 1.35, vibeIdx: 1, physTier: 1 },
  // Tier 3b: BOSS L3 corridor
  { name: 'T3B_L3BOSS',     type: 'corridor', family: 'L3_CORRIDOR', speed: 2.0, vibeIdx: 2, physTier: 1 },
  // Recovery
  { name: 'RECOVERY_1',     type: 'rest', duration: 2, speed: 2.0, vibeIdx: 2, physTier: 1 },
  // Tier 4a: angled walls
  { name: 'T4A_ANGLED',     type: 'angled_walls', duration: 30, speed: 2.0, vibeIdx: 2, physTier: 2 },
  // Tier 4b: lethal rings + angled walls
  { name: 'T4B_LETHAL',     type: 'lethal_rings', duration: 70, speed: 2.0, vibeIdx: 2, physTier: 2 },
  // Tier 4c: BOSS L4 corridor
  { name: 'T4C_L4BOSS',     type: 'corridor', family: 'L4_SINE_CORRIDOR', speed: 2.1, vibeIdx: 3, physTier: 2 },
  // Recovery
  { name: 'RECOVERY_2',     type: 'rest', duration: 5, speed: 2.1, vibeIdx: 3, physTier: 2 },  // 5s breathing room after L4 boss
  // Tier 5a: random fat cones
  { name: 'T5A_FATCONES',   type: 'fat_cones', duration: 30, speed: 2.1, vibeIdx: 3, physTier: 3 },
  // Tier 5b: structured slalom then zip lines (sequential)
  { name: 'T5B_SLALOM_ZIP', type: 'slalom_then_zips', duration: 30, speed: 2.1, vibeIdx: 3, physTier: 3 },
  // Tier 5c: BOSS L5 corridor
  { name: 'T5C_L5BOSS',     type: 'corridor', family: 'L5_SINE_CORRIDOR', duration: 60, speed: 2.5, vibeIdx: 4, physTier: 3 },
  // Recovery
  { name: 'RECOVERY_3',     type: 'rest', duration: 3, speed: 2.5, vibeIdx: 4, physTier: 3 },  // 3s breathing room after L5 boss
  // Tier 6+: endless mix (falls back to random wave director)
  { name: 'ENDLESS',        type: 'endless_mix', speed: 2.5, vibeIdx: 4, physTier: 3 },
];

// ── Sequencer tick (called each frame during DR) ──
function _drSequencerTick(dt) {
  const stage = DR_SEQUENCE[state.seqStageIdx];
  if (!stage) return;

  // ── Handle vibe transition on stage entry ──
  if (state._seqVibeApplied !== state.seqStageIdx) {
    state._seqVibeApplied = state.seqStageIdx;
    if (stage.vibeIdx !== undefined && stage.vibeIdx !== state.deathRunVibeIdx) {
      if (stage.type === 'corridor') {
        // Visual-only crossfade — don't call clearAllCorridorFlags
        const fromVibe = DEATH_RUN_VIBES[state.deathRunVibeIdx];
        const toVibe   = DEATH_RUN_VIBES[stage.vibeIdx];
        state.deathRunVibeIdx = stage.vibeIdx;
        state.currentLevelIdx = toVibe.sunShader;
        _pendingVibeIdx = -1;
        applyDeathRunVibeTransition(fromVibe, toVibe);
      } else {
        // suppressRestBeat=true: sequencer controls pacing, not the legacy 2.5s gate
        _applyVibeTransition(stage.vibeIdx, true);
      }
      state.deathRunRestBeat = 0;
    }
  }

  // ── Set speed + lateral physics tier for this stage ──
  const floor = state._drSpeedFloor || 0;
  const targetSpeed = BASE_SPEED * Math.max(stage.speed, floor);
  if (!state.invincibleSpeedActive && Math.abs(state.speed - targetSpeed) > 0.5) state.speed = targetSpeed;
  if (stage.physTier !== undefined) state.deathRunSpeedTier = stage.physTier;

  // ── Quilez domain warp: on for T3B boss and endless (except ice/gold suns which have built-in warp) ──
  const _isEndlessStage = stage.type === 'endless_mix';
  const _currentSunShader = DEATH_RUN_VIBES[state.deathRunVibeIdx]?.sunShader ?? 0;
  const _sunHasBuiltinWarp = (_currentSunShader === 3 || _currentSunShader === 4); // ice and gold already warped
  const _wantL3Warp = (stage.name === 'T3B_L3BOSS' || (_isEndlessStage && !_sunHasBuiltinWarp)) ? 1.0 : 0.0;
  const _curL3Warp = sunMat.uniforms.uIsL3Warp.value;
  if (Math.abs(_curL3Warp - _wantL3Warp) > 0.01) {
    sunMat.uniforms.uIsL3Warp.value += (_wantL3Warp - _curL3Warp) * Math.min(1, dt * 2);
  } else {
    sunMat.uniforms.uIsL3Warp.value = _wantL3Warp;
  }
  sunCapMat.uniforms.uIsL3Warp.value = sunMat.uniforms.uIsL3Warp.value;

  const tp = stage.type;

  // ─── REST: clear all obstacles and wait ───
  if (tp === 'rest') {
    // On first tick of rest stage, wipe all active obstacles so screen is clear
    if (state.seqStageElapsed === 0) {
      for (let _ri = activeObstacles.length - 1; _ri >= 0; _ri--) {
        returnObstacleToPool(activeObstacles[_ri]);
      }
      activeObstacles.length = 0;
    }
    state.seqStageElapsed += dt;
    state.deathRunRestBeat = 0.5; // suppress spawning
    // Fire warning beeps 1.5s before REST ends if next stage has higher speed
    const _nextStage = DR_SEQUENCE[state.seqStageIdx + 1];
    if (_nextStage && _nextStage.speed > stage.speed && !state._restBeepFired &&
        state.seqStageElapsed >= stage.duration - 1.5) {
      state._restBeepFired = true;
      if (!state.muted) {
        playSFX(440, 0.08, 'square', 0.25);
        setTimeout(() => playSFX(550, 0.08, 'square', 0.25), 200);
        setTimeout(() => playSFX(660, 0.10, 'square', 0.3), 400);
        // Thruster roar fires right as speed kicks in
        setTimeout(() => {
          const _roar = document.getElementById('engine-roar');
          if (_roar && !state.muted) { _roar.currentTime = 0; _roar.volume = 0.25; _roar.play().catch(()=>{}); }
        }, 1500);
      }
    }
    if (state.seqStageElapsed >= stage.duration) {
      state._restBeepFired = false;
      _drSeqAdvance();
    }
    return;
  }

  // ─── CORRIDOR BOSS: activate family, advance by time (if duration set) or row completion ───
  if (tp === 'corridor') {
    if (!state._seqCorridorStarted) {
      state._seqCorridorStarted = true;
      clearAllCorridorFlags();
      state.deathRunRestBeat = 1.5; // brief clear before corridor walls appear
      const fam = DR_MECHANIC_FAMILIES[stage.family];
      const dummyBand = { label: 'BAND4', peakChance: 1 };
      fam.activate(dummyBand, 'peak');
    }
    // If stage has a duration, use time — more reliable than row count at variable speeds
    if (stage.duration) {
      state.seqStageElapsed += dt;
      if (state.seqStageElapsed >= stage.duration) {
        state._seqCorridorStarted = false;
        state.deathRunRestBeat = 0;
        clearAllCorridorFlags();
        state.l5CorridorDone = true; // mark done so campaign ending path never fires
        _drSeqAdvance();
      }
    } else {
      // No duration — wait for corridor to finish by row count
      const fam = DR_MECHANIC_FAMILIES[stage.family];
      if (!fam.isActive()) {
        state._seqCorridorStarted = false;
        state.deathRunRestBeat = 0;
        _drSeqAdvance();
      }
    }
    return;
  }

  // ─── TIME-BASED STAGES ───
  state.seqStageElapsed += dt;

  if (tp === 'random_cones') {
    // Density control: sparse = wider gaps, fewer per spawn; dense = tighter
    // The existing spawner uses obstaclesPerSpawn from the vibe — we override
    state._seqSpawnMode = 'cones';
    state._seqConeDensity = stage.density || 'normal';
  }
  else if (tp === 'cones_and_zips') {
    state._seqSpawnMode = 'cones';
    // Fire a zipper burst periodically
    state._seqZipTimer = (state._seqZipTimer || 0) + dt;
    if (state._seqZipTimer >= 8 && !state.zipperActive) {
      state._seqZipTimer = 0;
      state.zipperActive = true;
      // Use ZIPPER_ROWS so the exit-ramp calculation in spawnZipperRow is correct
      // (was 8-11, causing rowsDone to start mid-ramp and fire too fast)
      state.zipperRowsLeft = ZIPPER_ROWS;
      state.zipperSide = Math.random() < 0.5 ? 1 : -1;
      state.zipperHoldCount = 0;
      state.zipperSpawnTimer = -1.0;
    }
  }
  else if (tp === 'angled_walls') {
    // 0-15s: random angled walls, 15-17s: breather, 17-30s: random angled walls
    const t = state.seqStageElapsed;
    if (t < 15 || t >= 17) {
      state._seqSpawnMode = 'angled';
    } else {
      state._seqSpawnMode = 'none';
    }
  }
  else if (tp === 'lethal_rings') {
    // 0-15s:   random angled walls
    // 15-17s:  breather
    // 17-32s:  structured angled walls (burst mechanic)
    // 32-34s:  breather
    // 34-49s:  lethal rings
    // 49-51s:  breather
    // 51-66s:  lethal rings
    // 66-70s:  breather (4s)
    const t = state.seqStageElapsed;
    if (t < 15) {
      state._seqSpawnMode = 'angled';
    } else if (t < 17) {
      state._seqSpawnMode = 'none';
    } else if (t < 32) {
      state._seqSpawnMode = 'none'; // structured burst mechanic handles spawning
      state._seqStructuredTimer = (state._seqStructuredTimer || 0) + dt;
      if (state._seqStructuredTimer >= 3 && !state.angledWallsActive) {
        state._seqStructuredTimer = 0;
        const fam = DR_MECHANIC_FAMILIES['ANGLED_WALL'];
        fam.activate({ label: 'BAND3' }, 'build');
      }
    } else if (t < 34) {
      state._seqSpawnMode = 'none';
    } else if (t < 49) {
      state._seqSpawnMode = 'lethal';
    } else if (t < 51) {
      state._seqSpawnMode = 'none';
    } else if (t < 66) {
      state._seqSpawnMode = 'lethal';
    } else {
      state._seqSpawnMode = 'none'; // 4s final breather
    }
  }
  else if (tp === 'fat_cones') {
    state._seqSpawnMode = 'fat_cones';
  }
  else if (tp === 'slalom_then_zips') {
    // 0-15s: slalom (no background cones)
    // 15-17s: breather
    // 17-30s: zip lines
    const t = state.seqStageElapsed;
    if (t < 15) {
      state._seqSpawnMode = 'none'; // slalom only, no background cones
      if (!state.slalomActive && !state._seqSlalomFired) {
        state._seqSlalomFired = true;
        state.slalomActive = true;
        state.slalomUsePhysicsCurve = true;
        state._slalomGapWidth = 10;
        state.slalomSpawnZ = 0;
        state.slalomRowsDone = 0;
        // Force gap to start offset from ship so player must move immediately
        const _slalomSide = Math.random() < 0.5 ? 1 : -1;
        _drCorridorState.gapX = _slalomSide * 18;
        _drCorridorState.gapVelX = 0;
        _drCorridorState.sweepTimer = 0;
        state.slalomMaxRows = 16 + Math.floor(Math.random() * 3);
      }
    } else if (t < 17) {
      state._seqSpawnMode = 'none'; // 2s breather
    } else {
      state._seqSpawnMode = 'none'; // zipper handles its own spawning
      if (!state.zipperActive && !state._seqZipFired) {
        state._seqZipFired = true;
        state.zipperActive = true;
        state.zipperRowsLeft = 10 + Math.floor(Math.random() * 4);
        state.zipperSide = Math.random() < 0.5 ? 1 : -1;
        state.zipperHoldCount = 0;
        state.zipperSpawnTimer = -1.0;
      }
    }
  }
  else if (tp === 'endless_mix') {
    const _endlessType = state._endlessActiveType || '';
    const _endlessMechActive = state.slalomActive || state.zipperActive ||
      state.angledWallsActive || state.drCustomPatternActive || state.corridorMode ||
      state.l4CorridorActive || state.l5CorridorActive || state._arcActive;
    if (state.drPhase === 'RELEASE') {
      state._seqSpawnMode = 'cones'; state._seqConeDensity = 'normal';
    } else if (_endlessType === 'random_cones') {
      state._seqSpawnMode = 'cones'; state._seqConeDensity = 'normal';
    } else if (_endlessType === 'angled_random') {
      state._seqSpawnMode = 'angled';
    } else if (_endlessType === 'lethal') {
      state._seqSpawnMode = 'lethal';
    } else if (_endlessType === 'fat_cones') {
      state._seqSpawnMode = 'fat_cones';
    } else {
      state._seqSpawnMode = 'none'; // mechanic handles its own spawning
    }
    _drEndlessTick(dt);
    return; // endless never advances
  }

  // Warning beeps + thruster 1.5s before a speed-up (any timed stage)
  if (stage.duration && !state._restBeepFired) {
    const _nextStage = DR_SEQUENCE[state.seqStageIdx + 1];
    if (_nextStage && _nextStage.speed > stage.speed &&
        state.seqStageElapsed >= stage.duration - 1.5) {
      state._restBeepFired = true;
      if (!state.muted) {
        playSFX(440, 0.08, 'square', 0.3);
        setTimeout(() => playSFX(550, 0.08, 'square', 0.3), 200);
        setTimeout(() => playSFX(660, 0.10, 'square', 0.35), 400);
        setTimeout(() => {
          const _roar = document.getElementById('engine-roar');
          if (_roar && !state.muted) { _roar.currentTime = 0; _roar.volume = 0.25; _roar.play().catch(()=>{}); }
        }, 1500);
      }
    }
  }

  // Advance if time-based stage is done
  if (stage.duration && state.seqStageElapsed >= stage.duration) {
    _drSeqAdvance();
  }
}

// Advance to next sequencer stage
function _drSeqAdvance() {
  // Clean up any active mechanics from current stage
  clearAllCorridorFlags();
  state.zipperActive = false;
  state.slalomActive = false;
  state.angledWallsActive = false;
  state._ringsActive = false;
  state.deathRunRestBeat = 0;

  state.seqStageIdx++;
  state.seqStageElapsed = 0;
  state._seqCorridorStarted = false;
  state._seqZipTimer = 0;
  state._restBeepFired = false;
  state._seqAngledTimer = 0;
  state._seqSlalomFired = false;
  state._seqZipFired = false;
  state._seqSpawnMode = 'cones';
  state._seqConeDensity = 'normal';
  state._seqRingSpawnZ = -7;

  const next = DR_SEQUENCE[state.seqStageIdx];
  if (next) {
    console.log('[SEQ] Stage ' + state.seqStageIdx + ': ' + next.name);
    _drLogEvent('seq_advance', next.name + ' | speed=' + next.speed + 'x | physTier=' + next.physTier);
    // Set speed immediately
    const floor = state._drSpeedFloor || 0;
    state.speed = BASE_SPEED * Math.max(next.speed, floor);
    // Music transitions
    if (next.name === 'T3B_L3BOSS') {
      musicFadeTo('l4', 4000); // l4music fades in at L3 corridor
    }
    if (next.name === 'RECOVERY_2') {
      musicFadeTo('keepgoing', 2000); // keep-going after L4 corridor
    }
  }
}

// Endless mix fallback — uses existing random wave director logic
// ── Tutorial overlay helpers ──
// ── Tutorial overlay helpers ──
function _tutShowInstructionBox(title, sub, color, onDismiss) {
  // Never show if tutorial already completed
  if (window._LS.getItem('jh_tutorial_done') === '1') return;
  // Full-screen dimmed instruction box, player taps to dismiss
  let el = document.getElementById('tut-instruction-box');
  if (el) return; // already showing
  el = document.createElement('div');
  el.id = 'tut-instruction-box';
  el.style.cssText = [
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center',
    'background:rgba(0,0,0,0.7);z-index:9100;cursor:pointer'
  ].join(';');
  el.innerHTML = [
    `<div style="border:1px solid ${color};padding:32px 40px;max-width:80vw;text-align:center;background:rgba(0,0,0,0.85);border-radius:4px">`,
    `<div style="color:${color};font-family:'Knewave',monospace;font-size:clamp(22px,5vw,38px);letter-spacing:4px;text-shadow:0 0 18px ${color}">${title}</div>`,
    `<div style="color:#fff;font-family:'Knewave',monospace;font-size:clamp(13px,2.5vw,17px);margin-top:14px;line-height:1.6;opacity:0.9">${sub}</div>`,
    `<div style="color:${color};font-family:monospace;font-size:13px;margin-top:22px;opacity:0.7;letter-spacing:2px">${window.innerWidth >= 1024 ? 'PRESS ENTER TO BEGIN' : 'TAP TO BEGIN'}</div>`,
    '</div>'
  ].join('');
  const _dismiss = () => { el.remove(); if (onDismiss) onDismiss(); };
  el.addEventListener('click', _dismiss);
  el.addEventListener('touchend', (e) => { e.preventDefault(); _dismiss(); }, { passive: false });
  const _keyDismiss = (e) => { if (e.key === 'Enter' || e.key === ' ') { document.removeEventListener('keydown', _keyDismiss); _dismiss(); } };
  document.addEventListener('keydown', _keyDismiss);
  document.body.appendChild(el);
}
function _tutShowHint(title, sub, color) {
  // Small non-blocking hint shown during gameplay
  let el = document.getElementById('tutorial-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tutorial-overlay';
    el.style.cssText = 'position:fixed;bottom:14%;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none;z-index:9000;transition:opacity 0.4s';
    document.body.appendChild(el);
  }
  // Exit tutorial button
  if (!document.getElementById('tutorial-exit-btn')) {
    const exitBtn = document.createElement('button');
    exitBtn.id = 'tutorial-exit-btn';
    exitBtn.textContent = 'EXIT TUTORIAL';
    exitBtn.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9100;background:rgba(0,0,0,0.6);color:#fff;border:1px solid rgba(255,255,255,0.4);padding:7px 18px;font-family:monospace;font-size:12px;cursor:pointer;letter-spacing:2px';
    exitBtn.addEventListener('click', () => {
      window._LS.setItem('jh_tutorial_done', '1');
      _tutDestroyOverlay();
      state._tutorialActive = false;
      returnToTitle();
    });
    document.body.appendChild(exitBtn);
  }
  el.innerHTML = [
    `<div style="color:${color};font-family:monospace;font-size:clamp(18px,3.5vw,28px);font-weight:bold;letter-spacing:3px;text-shadow:0 0 14px ${color}">${title}</div>`,
    `<div style="color:#fff;font-family:monospace;font-size:clamp(11px,2vw,15px);margin-top:6px;opacity:0.8">${sub}</div>`
  ].join('');
  el.style.opacity = '1';
}
function _tutHideText() {
  const el = document.getElementById('tutorial-overlay');
  if (el) el.style.opacity = '0';
}
function _tutChime() {
  // Ascending two-tone success chime
  playSFX(660, 0.12, 'sine', 0.3);
  setTimeout(() => playSFX(880, 0.18, 'sine', 0.25), 120);
}
function _tutSignal() {
  let el = document.getElementById('tut-signal-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tut-signal-flash';
    el.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-family:'Knewave',monospace;font-size:16px;letter-spacing:4px;color:#ffffff;opacity:0;pointer-events:none;z-index:19000;transition:opacity 0.15s ease;text-align:center;";
    document.body.appendChild(el);
  }
  el.textContent = 'SIGNAL RECEIVED...';
  el.style.opacity = '1';
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 600);
}

function _tutDestroyOverlay() {
  ['tutorial-overlay','tut-instruction-box','tutorial-skip','tutorial-exit-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

// Endless mode obstacle rotation — explicit list so all types appear evenly
const _ENDLESS_ROTATION = [
  'random_cones',    // sparse cones
  'angled_random',   // random angled walls
  'lethal',          // lethal rings
  'fat_cones',       // fat cone slalom
  'angled_struct',   // structural angled walls
  'zipper',          // zip lines
  'slalom',          // slalom
  'L3_CORRIDOR',     // L3 corridor (after cooldown)
  'L4_SINE_CORRIDOR',// L4 corridor (after cooldown)
];

function _drEndlessTick(dt) {
  const BLOCK_DURATION = 15;
  const REST_DURATION  = 4;

  state._endlessBlockTimer     = (state._endlessBlockTimer     || 0);
  state._endlessRotationIdx    = (state._endlessRotationIdx    || 0);
  state._endlessCorridorCount  = (state._endlessCorridorCount  || 0);

  const _drBandIdx = DR2_RUN_BANDS.length - 1;
  const _drBand    = DR2_RUN_BANDS[_drBandIdx];

  const _drMechActive = state.slalomActive || state.zipperActive ||
    state.angledWallsActive || state.drCustomPatternActive || state.corridorMode ||
    state.l4CorridorActive || state.l5CorridorActive || state._arcActive;

  const phase = state.drPhase;

  if (phase === 'RELEASE') {
    state.drPhaseTimer += dt;
    if (state.drPhaseTimer >= REST_DURATION) {
      // Pick next from rotation, skip corridors until 30s in and then only every ~3 cycles
      let nextType = _ENDLESS_ROTATION[state._endlessRotationIdx % _ENDLESS_ROTATION.length];
      const _isCorr = nextType === 'L3_CORRIDOR' || nextType === 'L4_SINE_CORRIDOR';
      // Allow corridors only after 3 full waves, and max once per 5 waves
      const _waveCount = state.drWaveCount || 0;
      const _corrAllowed = _waveCount >= 3 && (state._endlessCorridorCount === 0 || (_waveCount - (state._endlessLastCorrWave || 0)) >= 5);
      if (_isCorr && !_corrAllowed) {
        // Skip corridor, take next type
        state._endlessRotationIdx++;
        nextType = _ENDLESS_ROTATION[state._endlessRotationIdx % _ENDLESS_ROTATION.length];
      }
      state._endlessRotationIdx++;

      // Activate the obstacle type
      state.deathRunRestBeat = 1.0;
      state._endlessBlockTimer = 0;

      if (nextType === 'random_cones' || nextType === 'angled_random') {
        state._seqSpawnMode = nextType === 'angled_random' ? 'angled' : 'cones';
        state._endlessActiveType = nextType;
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'lethal') {
        state._seqSpawnMode = 'lethal';
        state._endlessActiveType = 'lethal';
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'fat_cones') {
        state._seqSpawnMode = 'fat_cones';
        state._endlessActiveType = 'fat_cones';
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'angled_struct') {
        // Structural angled walls via mechanic family
        DR_MECHANIC_FAMILIES['ANGLED_WALL'].activate(_drBand, 'build');
        state._endlessActiveType = 'angled_struct';
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'zipper') {
        state.zipperActive = true;
        state.zipperRowsLeft = 18 + Math.floor(Math.random() * 6);
        state.zipperSide = Math.random() < 0.5 ? 1 : -1;
        state.zipperHoldCount = 0;
        state.zipperSpawnTimer = -1.0;
        state._endlessActiveType = 'zipper';
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'slalom') {
        state.slalomActive = true;
        state.slalomUsePhysicsCurve = true;
        state._slalomGapWidth = 9;
        state.slalomSpawnZ = 0;
        state.slalomRowsDone = 0;
        state.slalomMaxRows = 16 + Math.floor(Math.random() * 4);
        // Force gap away from ship center so player must dodge immediately
        const _eSlalomSide = Math.random() < 0.5 ? 1 : -1;
        _drCorridorState.gapX = _eSlalomSide * 18;
        _drCorridorState.gapVelX = 0;
        _drCorridorState.sweepTimer = 0;
        state._endlessActiveType = 'slalom';
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'L3_CORRIDOR' || nextType === 'L4_SINE_CORRIDOR') {
        clearAllCorridorFlags();
        DR_MECHANIC_FAMILIES[nextType].activate(_drBand, 'peak');
        state._endlessCorridorCount++;
        state._endlessLastCorrWave = state.drWaveCount || 0;
        state._endlessActiveType = nextType;
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      }
    }
  } else if (phase === 'BUILD' || phase === 'SUSTAIN') {
    state._endlessBlockTimer += dt;
    const _type = state._endlessActiveType || '';
    // For spawn-mode types, tick the timer
    const _done = state._endlessBlockTimer >= BLOCK_DURATION ||
      (!_drMechActive && !['random_cones','angled_random','lethal','fat_cones','angled_struct','slalom'].includes(_type));
    if (_done) {
      clearAllCorridorFlags();
      state.zipperActive = false;
      state.slalomActive = false;
      state._endlessActiveType = '';
      state._seqSpawnMode = 'none'; // stop all spawning during breather
      state.deathRunRestBeat = 4.0;
      state.drPhase = 'RELEASE'; state.drPhaseTimer = 0;
      state.drWaveCount++;
      if (!state._tutorialActive && !state._jetLightningMode && _bonusRings.length === 0) _ringSpawnRow(0);
      // Cycle vibes through the full palette on each endless wave
      const _totalVibes = DR_VIBES.length;
      const _nextVibeIdx = ((state._endlessVibeIdx || 0) + 1) % _totalVibes;
      state._endlessVibeIdx = _nextVibeIdx;
      _applyVibeTransition(_nextVibeIdx, true);
    }
  } else if (phase === 'RECOVERY') {
    state.drPhase = 'RELEASE'; state.drPhaseTimer = 0;
  }
}

// ── Mechanic families for wave director ──
const DR_MECHANIC_FAMILIES = {

  SLALOM: {
    roles: ['build', 'peak'],
    minBand: 4, maxBand: 4,
    activate(band, role) {
      const baseRows = role === 'peak' ? 18 : 12;
      // Wider gap early, tighter later
      const gapByBand = { BAND1: 14, BAND2: 14, BAND3: 11, BAND4: 8, BAND5: 8, BAND6: 7 };
      state._slalomGapWidth = gapByBand[band.label] || 11;
      state.slalomActive = true;
      state.slalomUsePhysicsCurve = (role === 'peak');
      _drResetCorridorState();
      state.slalomSpawnZ = 0;
      state.slalomRowsDone = 0;
      state.slalomMaxRows = baseRows + Math.floor(Math.random() * 8);
    },
    isActive() { return state.slalomActive; }
  },
  ZIPPER: {
    roles: ['peak'],
    minBand: 4, maxBand: 4,
    activate(band, role) {
      // Fewer zippers early, more later
      const zipCount = { BAND1: 4, BAND2: 6, BAND3: 10, BAND4: 14, BAND5: 14, BAND6: 16 }[band.label] || 8;
      state.zipperActive = true;
      state.zipperRowsLeft = zipCount + Math.floor(Math.random() * 3);
      state.zipperSide = Math.random() < 0.5 ? 1 : -1;
      state.zipperHoldCount = 0;
      state.zipperSpawnTimer = -1.0;
    },
    isActive() { return state.zipperActive; }
  },
  ANGLED_WALL: {
    roles: ['build'],
    minBand: 1, maxBand: 1, // also available at Band 5 via no-max families
    activate(band, role) {
      state.angledWallsActive = true;
      state.angledWallSpawnZ = -_awTuner.zSpacing; // start far out so walls fade in from horizon
      state.angledWallRowsDone = 0;
    },
    isActive() { return state.angledWallsActive; }
  },
  CUSTOM_PATTERN: {
    roles: ['peak'],
    minBand: 5,
    activate(band, role) {
      state.drCustomPatternActive = true;
      state.drCustomPatternRow = 0;
      state.drCustomPatternSpawnZ = 0;
    },
    isActive() { return state.drCustomPatternActive; }
  },
  L3_CORRIDOR: {
    roles: ['build', 'peak'],
    minBand: 3,
    activate(band, role) {
      // Full campaign L3 corridor: 761 rows (74s at 2.0x speed)
      const rows = 761;
      state.corridorMode      = true;
      state.corridorSpawnZ    = -7;
      state.corridorRowsDone  = 0;
      state.corridorGapCenter = 0;
      state.corridorGapDir    = 1;
      state.corridorDelay     = 1.5;
      state._drL3MaxRows      = rows;
      state.speed = BASE_SPEED * 2.0; // L3 corridor speed
    },
    isActive() { return state.corridorMode; }
  },
  L4_SINE_CORRIDOR: {
    roles: ['build', 'peak'],
    minBand: 3,
    activate(band, role) {
      // Full campaign L4 corridor: 518 rows (48s at 2.1x speed)
      const rows = 518;
      state.l4CorridorActive = true;
      state.l4SpawnZ         = -7;
      state.l4RowsDone       = 0;
      state.l4SineT          = 0;
      state.l4Delay          = 1.5;
      state._drL4MaxRows     = rows;
      state.speed = BASE_SPEED * 2.1; // L4 corridor speed
    },
    isActive() { return state.l4CorridorActive; }
  },
  L5_SINE_CORRIDOR: {
    roles: ['peak'],
    minBand: 3,
    activate(band, role) {
      // Full campaign L5 corridor: 420 rows (33s at 2.5x speed)
      const rows = 420;
      state.l5CorridorActive    = true;
      state.l5CorridorSpawnZ    = -7;
      state.l5CorridorRowsDone  = 0;
      state.l5SineT             = 0;
      state._drL5MaxRows        = rows;
      state.speed = BASE_SPEED * 2.5; // L5 corridor speed
      state._drSpeedFloor = 2.5; // lock floor — speed never drops below this after L5
    },
    isActive() { return state.l5CorridorActive; }
  },

  // ── ARC FAMILIES (multi-stage sequences, Band 3+) ──────────────
  CORRIDOR_ARC: {
    roles: ['build', 'peak'],
    minBand: 3,
    activate(band, role) {
      // 3-stage corridor arc: L3 → L4 → L5 with campaign-matching speeds
      state._arcQueue = [
        { family: 'L3_CORRIDOR', role, speed: 2.0 },
        { family: 'L4_SINE_CORRIDOR', role, speed: 2.1 },
        { family: 'L5_SINE_CORRIDOR', role, speed: 2.5 },
      ];
      state._arcActive = true;
      state._arcStage = 0;
      // Activate first stage + force speed immediately
      const first = state._arcQueue[0];
      DR_MECHANIC_FAMILIES[first.family].activate(band, first.role);
      state.speed = BASE_SPEED * first.speed;
      state.deathRunSpeedTier = 3; // sync tier display
    },
    isActive() { return state._arcActive; }
  },
  SLALOM_ARC: {
    roles: ['build', 'peak'],
    minBand: 5,
    activate(band, role) {
      // 3-stage slalom: wide → medium → tight
      state._arcQueue = [
        { family: 'SLALOM', role, overrides: { _slalomGapWidth: 14 } },
        { family: 'SLALOM', role, overrides: { _slalomGapWidth: 10 } },
        { family: 'SLALOM', role, overrides: { _slalomGapWidth: 7 } },
      ];
      state._arcActive = true;
      state._arcStage = 0;
      const first = state._arcQueue[0];
      DR_MECHANIC_FAMILIES[first.family].activate(band, first.role);
      if (first.overrides) Object.assign(state, first.overrides);
    },
    isActive() { return state._arcActive; }
  },
  ZIPPER_ARC: {
    roles: ['peak'],
    minBand: 5,
    activate(band, role) {
      // 3-stage zipper: short → medium → long
      state._arcQueue = [
        { family: 'ZIPPER', role, overrides: { zipperRowsLeft: 6 } },
        { family: 'ZIPPER', role, overrides: { zipperRowsLeft: 10 } },
        { family: 'ZIPPER', role, overrides: { zipperRowsLeft: 16 } },
      ];
      state._arcActive = true;
      state._arcStage = 0;
      const first = state._arcQueue[0];
      DR_MECHANIC_FAMILIES[first.family].activate(band, first.role);
      if (first.overrides) Object.assign(state, first.overrides);
    },
    isActive() { return state._arcActive; }
  },
};

// ── Arc stage advancement (called each frame when arc is active) ──
function _drAdvanceArc() {
  if (!state._arcActive || !state._arcQueue) return;
  const stage = state._arcQueue[state._arcStage];
  if (!stage) { state._arcActive = false; return; }
  const fam = DR_MECHANIC_FAMILIES[stage.family];
  if (fam.isActive()) return; // current stage still running
  // Current stage finished — advance
  state._arcStage++;
  if (state._arcStage >= state._arcQueue.length) {
    // Arc complete
    state._arcActive = false;
    return;
  }
  // Activate next stage with tiny rest beat
  state.deathRunRestBeat = 0.5 + Math.random() * 0.3;
  const next = state._arcQueue[state._arcStage];
  // Find current band for activation
  let _arcBandIdx = DR2_RUN_BANDS.length - 1;
  for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
    if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _arcBandIdx = bi; break; }
  }
  DR_MECHANIC_FAMILIES[next.family].activate(DR2_RUN_BANDS[_arcBandIdx], next.role);
  if (next.overrides) Object.assign(state, next.overrides);
  // Apply per-stage speed override (corridor arc ramps speed per corridor)
  if (next.speed) {
    state.speed = BASE_SPEED * next.speed;
  }
}

// ── Coin fly-to-HUD animation (gold) ──
function _spawnCoinFly(worldPos, hudEl) {
  const v = worldPos.clone();
  v.project(camera);
  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
  const rect = hudEl.getBoundingClientRect();
  const tx = rect.left + rect.width / 2;
  const ty = rect.top + rect.height / 2;
  const count = 4 + Math.floor(Math.random() * 3); // 4-6 (less than fuel)
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    const size = 5 + Math.random() * 5;
    const startX = sx + (Math.random() - 0.5) * 20;
    const startY = sy + (Math.random() - 0.5) * 20;
    const delay = i * 40;
    const dur = 500 + Math.random() * 200;
    const midX = (startX + tx) / 2 + (Math.random() - 0.5) * 60;
    const midY = Math.min(startY, ty) - 20 - Math.random() * 40;
    dot.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;background:#ffd700;border-radius:50%;box-shadow:0 0 ${size+3}px #fa0;z-index:9999;pointer-events:none;will-change:transform,opacity;`;
    document.body.appendChild(dot);
    const start = performance.now() + delay;
    function tick(now) {
      const elapsed = now - start;
      if (elapsed < 0) { requestAnimationFrame(tick); return; }
      const t = Math.min(1, elapsed / dur);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      const bx = (1-ease)*(1-ease)*startX + 2*(1-ease)*ease*midX + ease*ease*tx;
      const by = (1-ease)*(1-ease)*startY + 2*(1-ease)*ease*midY + ease*ease*ty;
      const s = 1 - ease * 0.7;
      const op = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      dot.style.transform = `translate(${bx}px,${by}px) scale(${s})`;
      dot.style.opacity = op;
      if (t < 1) requestAnimationFrame(tick);
      else dot.remove();
    }
    requestAnimationFrame(tick);
  }
}

// ── Fuel cell fly-to-HUD animation ──
function _spawnFuelFly(worldPos) {
  // Project 3D position to screen
  const v = worldPos.clone();
  v.project(camera);
  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
  // Target: fuel cell HUD element position
  const _fcEl = document.getElementById('hud-fuelcells');
  let tx = 40, ty = 30;
  if (_fcEl) {
    const rect = _fcEl.getBoundingClientRect();
    tx = rect.left + rect.width / 2;
    ty = rect.top + rect.height / 2;
  }
  const count = 8 + Math.floor(Math.random() * 5); // 8-12 particles
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    const size = 6 + Math.random() * 6;
    const startX = sx + (Math.random() - 0.5) * 30;
    const startY = sy + (Math.random() - 0.5) * 30;
    const delay = i * 50;
    const dur = 600 + Math.random() * 200;
    // Unique arc midpoint for each particle
    const midX = (startX + tx) / 2 + (Math.random() - 0.5) * 80;
    const midY = Math.min(startY, ty) - 30 - Math.random() * 60;
    dot.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;background:#4cf;border-radius:50%;box-shadow:0 0 ${size+4}px #0af;z-index:9999;pointer-events:none;will-change:transform,opacity;`;
    document.body.appendChild(dot);
    // Animate with requestAnimationFrame for smooth bezier arc
    const start = performance.now() + delay;
    function tick(now) {
      const elapsed = now - start;
      if (elapsed < 0) { requestAnimationFrame(tick); return; }
      const t = Math.min(1, elapsed / dur);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease in-out quad
      // Quadratic bezier: start → mid → target
      const bx = (1-ease)*(1-ease)*startX + 2*(1-ease)*ease*midX + ease*ease*tx;
      const by = (1-ease)*(1-ease)*startY + 2*(1-ease)*ease*midY + ease*ease*ty;
      const s = 1 - ease * 0.7;
      const op = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      dot.style.transform = `translate(${bx}px,${by}px) scale(${s})`;
      dot.style.opacity = op;
      if (t < 1) requestAnimationFrame(tick);
      else dot.remove();
    }
    requestAnimationFrame(tick);
  }
}

// Pick a mechanic family for BUILD or PEAK phase
function _drPickMechanic(role, bandIdx, extraFilter) {
  // In endless mode (called from _drEndlessTick), exclude arc families so mechanics cycle individually
  const _isEndless = state.isDeathRun && DR_SEQUENCE[state.seqStageIdx] && DR_SEQUENCE[state.seqStageIdx].type === 'endless_mix';
  const eligible = Object.entries(DR_MECHANIC_FAMILIES)
    .filter(([k, f]) => f.roles.includes(role) && bandIdx >= f.minBand && (bandIdx >= 5 || f.maxBand == null || bandIdx <= f.maxBand) && (!_isEndless || !k.endsWith('_ARC')) && (!extraFilter || extraFilter(k)));
  if (eligible.length === 0) return null; // no eligible mechanics for this role/band

  // Anti-repeat: avoid last 3 families (recency window)
  const recent = state.drRecentFamilies || [];
  let filtered = eligible.filter(([k]) => !recent.includes(k));
  if (filtered.length === 0) filtered = eligible; // all excluded — allow any

  const pick = filtered[Math.floor(Math.random() * filtered.length)];
  // Update recency ring buffer (max 3)
  recent.push(pick[0]);
  if (recent.length > 3) recent.shift();
  state.drRecentFamilies = recent;
  state._drLastMechanic = pick[0];
  return pick[0];
}

// ── DR Session Analytics ──
let _drSessionLog = [];
function _drLogEvent(type, detail) {
  if (!state.isDeathRun) return;
  const _ss = DR_SEQUENCE[state.seqStageIdx];
  _drSessionLog.push({
    t: +(state.elapsed || 0).toFixed(2),
    score: state.score || 0,
    tier: state.deathRunSpeedTier || 0,
    seq: _ss ? _ss.name : '?',
    phase: state.drPhase,
    type: type,
    detail: detail || ''
  });
}
function _drSaveSession(reason) {
  if (_drSessionLog.length === 0) return;
  const _seqStage = DR_SEQUENCE[state.seqStageIdx];
  const session = {
    timestamp: new Date().toISOString(),
    reason: reason,
    finalScore: state.score || 0,
    finalTier: state.deathRunSpeedTier || 0,
    seqStage: _seqStage ? _seqStage.name : 'UNKNOWN',
    seqStageIdx: state.seqStageIdx || 0,
    elapsed: +(state.elapsed || 0).toFixed(2),
    waveCount: state.drWaveCount || 0,
    device: /iPhone|iPad|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
    events: _drSessionLog
  };
  // Save to localStorage
  try {
    const key = 'dr_session_logs';
    const prev = JSON.parse(localStorage.getItem(key) || '[]');
    prev.push(session);
    if (prev.length > 5) prev.shift();
    localStorage.setItem(key, JSON.stringify(prev));
  } catch(e) {}
  // Send to server
  try {
    fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session)
    }).catch(() => {});
  } catch(e) {}
  console.log('[DR-ANALYTICS] Session saved (' + _drSessionLog.length + ' events)');
  _drSessionLog = [];
}

// ── DR Debug HUD overlay ──
let _drDebugHudVisible = false;
function _drUpdateDebugHud() {
  if (!_drDebugHudVisible || !state.isDeathRun) return;
  let el = document.getElementById('dr-debug-hud');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dr-debug-hud';
    el.style.cssText = 'position:fixed;top:8px;left:8px;background:rgba(0,0,0,0.7);color:#0f0;font:11px monospace;padding:6px 10px;border-radius:4px;z-index:9999;pointer-events:none;white-space:pre;line-height:1.5;';
    document.body.appendChild(el);
  }
  const elapsed = (state.elapsed || 0).toFixed(1);
  let bandLabel = 'BAND4';
  for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
    if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { bandLabel = DR2_RUN_BANDS[bi].label; break; }
  }
  const family = state._drLastMechanic || '-';
  const active = state.slalomActive ? 'slalom' : state.zipperActive ? 'zipper' : state.angledWallsActive ? 'angled' : state.drCustomPatternActive ? 'custom' : state.corridorMode ? 'L3corr' : state.l4CorridorActive ? 'L4corr' : state.l5CorridorActive ? 'L5corr' : 'cones';
  const seqStage = DR_SEQUENCE[state.seqStageIdx];
  const seqName = seqStage ? seqStage.name : 'DONE';
  const seqTime = (state.seqStageElapsed || 0).toFixed(1);
  const seqDur  = seqStage && seqStage.duration ? seqStage.duration : '∞';
  el.textContent = `SEQ:   ${seqName}\nS-TIME:${seqTime}/${seqDur}s\nACTIVE:${active}\nTIME:  ${elapsed}s\nSPEED: ${state.speed.toFixed(0)}\nPHASE: ${state.drPhase}`;
}

// ── Debug logger — lightweight console output for tuning ──
function _dr2DebugLog() {
  if (!state.isDeathRun) return;
  const elapsed = (state.elapsed || 0).toFixed(1);
  let bandLabel = 'BAND4';
  for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
    if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { bandLabel = DR2_RUN_BANDS[bi].label; break; }
  }
  const family = state._drLastMechanic || 'RANDOM_CONES';
  console.log(`[DR] phase=${state.drPhase} band=${bandLabel} family=${family} elapsed=${elapsed}s tier=${state.deathRunSpeedTier} wave#${state.drWaveCount}`);
  _drLogEvent('phase', `${state.drPhase} | ${bandLabel} | ${family}`);
}


// ── Bonus Ring prototype (wormhole-style Line2 rings) ──
const _ringTuner = { x: 0, y: 2, radius: 5.25, lineWidth: 20, sides: 8, length: 12, freq: 3.5, sineAmp: 0, sinePeriod: 8, copies: 1, copyGap: 0 };
// length = number of rings per lane, freq = Z spacing
// copies = how many lanes side by side, copySpacing = X gap between lanes
const _ringPalette = [0xff6600, 0x00ddff, 0xcc00ff]; // orange, cyan, purple (matches wormhole)
let _bonusRings = [];      // array of { mesh: Line2, z: number }
let _ringTunerPanel = null;

function _ringBuildOne(colorIdx) {
  const SIDES = _ringTuner.sides;
  const R = _ringTuner.radius;
  const positions = [];
  for (let s = 0; s <= SIDES; s++) {
    const angle = (s % SIDES) * (Math.PI * 2 / SIDES);
    positions.push(Math.cos(angle) * R, Math.sin(angle) * R + _ringTuner.y, 0);
  }
  const geo = new LineGeometry();
  geo.setPositions(positions);
  const mat = new LineMaterial({
    color: _ringPalette[colorIdx % 3],
    linewidth: _ringTuner.lineWidth,
    transparent: false,
    worldUnits: false,
  });
  mat.depthWrite = true;
  mat.resolution.set(window.innerWidth, window.innerHeight);
  const ring = new Line2(geo, mat);
  ring.computeLineDistances();
  return ring;
}

function _ringSpawnRow(xPos, nearSpawn) {
  if (state._tutorialActive || state._jetLightningMode) return; // never spawn rings during tutorial or Jet Lightning
  const baseX = (xPos !== undefined) ? xPos : _ringTuner.x;
  const count = Math.max(1, Math.round(_ringTuner.length));
  const spacing = Math.max(0.5, _ringTuner.freq);
  const startZ = nearSpawn ? -15 : -160; // spawn from horizon so rings fade in naturally
  const copies = Math.max(1, Math.round(_ringTuner.copies));
  const copyStep = (_ringTuner.radius * 2) + _ringTuner.copyGap; // diameter + gap
  const totalWidth = (copies - 1) * copyStep;
  const startX = baseX - totalWidth / 2;
  for (let c = 0; c < copies; c++) {
    const laneX = startX + c * copyStep;
    for (let i = 0; i < count; i++) {
      const z = startZ - i * spacing;
      const sineX = _ringTuner.sineAmp > 0
        ? Math.sin((i / Math.max(1, _ringTuner.sinePeriod)) * Math.PI * 2) * _ringTuner.sineAmp
        : 0;
      const ring = _ringBuildOne(c * count + i);
      ring.position.set(laneX + sineX, 0, z);
      scene.add(ring);
      _bonusRings.push({ mesh: ring, collected: false });
    }
  }
  state._ringsActive = true;
}

// ── Ring ripple effect on collection ──
let _ringRipples = []; // { mesh, age, maxAge }
function _ringSpawnRipple(pos, color) {
  const SIDES = _ringTuner.sides;
  const R = _ringTuner.radius;
  const positions = [];
  for (let s = 0; s <= SIDES; s++) {
    const angle = (s % SIDES) * (Math.PI * 2 / SIDES);
    positions.push(Math.cos(angle) * R, Math.sin(angle) * R + _ringTuner.y, 0);
  }
  const geo = new LineGeometry();
  geo.setPositions(positions);
  const mat = new LineMaterial({
    color: color || 0xffffff,
    linewidth: _ringTuner.lineWidth * 1.5,
    transparent: true, opacity: 0.8,
    worldUnits: false,
  });
  mat.blending = THREE.AdditiveBlending;
  mat.depthWrite = false;
  mat.resolution.set(window.innerWidth, window.innerHeight);
  const ripple = new Line2(geo, mat);
  ripple.computeLineDistances();
  ripple.position.copy(pos);
  scene.add(ripple);
  _ringRipples.push({ mesh: ripple, age: 0, maxAge: 0.4, startScale: 1, color: color });
}

function _ringTickRipples(dt) {
  for (let i = _ringRipples.length - 1; i >= 0; i--) {
    const rp = _ringRipples[i];
    rp.age += dt;
    const t = rp.age / rp.maxAge; // 0→1
    // Expand outward
    const scale = 1 + t * 1.2;
    rp.mesh.scale.set(scale, scale, 1);
    // Fade out
    rp.mesh.material.opacity = 0.8 * (1 - t);
    // Move with world
    rp.mesh.position.z += (state.speed || 0) * dt;
    if (t >= 1) {
      scene.remove(rp.mesh); rp.mesh.geometry.dispose(); rp.mesh.material.dispose();
      _ringRipples.splice(i, 1);
    }
  }
}

function _ringRemoveAll() {
  for (const r of _bonusRings) {
    scene.remove(r.mesh);
    r.mesh.geometry.dispose();
    r.mesh.material.dispose();
  }
  _bonusRings = [];
  state._ringsActive = false;
}

function _ringApplyTuner() {
  for (let i = 0; i < _bonusRings.length; i++) {
    const r = _bonusRings[i];
    // Rebuild ring geometry with new Y and radius
    const SIDES = _ringTuner.sides;
    const R = _ringTuner.radius;
    const positions = [];
    for (let s = 0; s <= SIDES; s++) {
      const angle = (s % SIDES) * (Math.PI * 2 / SIDES);
      positions.push(Math.cos(angle) * R, Math.sin(angle) * R + _ringTuner.y, 0);
    }
    r.mesh.geometry.setPositions(positions);
    r.mesh.position.x = _ringTuner.x;
    // Don't touch Z — rings keep their spawned position
  }
}

function _ringToggle() {
  // Works from title screen or during gameplay
  if (_bonusRings.length === 0) {
    _ringSpawnRow(undefined, true); // nearSpawn so rings are visible
    state.speed = 0;
  } else {
    state.speed = BASE_SPEED * (LEVELS[Math.min((state.deathRunSpeedTier || 0) + 1, 4)].speedMult);
  }
  _ringShowTuner();
}
window._ringToggle = _ringToggle; // callable from console on mobile

function _ringShowTuner() {
  if (_ringTunerPanel) { _ringTunerPanel.style.display = _ringTunerPanel.style.display === 'none' ? 'block' : 'none'; return; }
  const panel = document.createElement('div');
  panel.id = 'ring-tuner';
  panel.style.cssText = 'position:fixed;bottom:10px;left:10px;background:rgba(0,0,0,0.85);color:#0fc;font:12px monospace;padding:10px;border-radius:6px;z-index:9999;';
  let _ringPaused = false;
  panel.innerHTML = `
    <div style="margin-bottom:6px;font-weight:bold;">RING TUNER<br><button id="ring-spawn-btn" style="background:#0af;color:#000;border:none;padding:2px 8px;border-radius:3px;font:bold 10px monospace;cursor:pointer;margin-right:4px;">SPAWN</button><button id="ring-pause-btn" style="background:#0fc;color:#000;border:none;padding:2px 10px;border-radius:3px;font:bold 11px monospace;cursor:pointer;">PAUSE</button><button id="ring-export-btn" style="background:#ff0;color:#000;border:none;padding:2px 8px;border-radius:3px;font:bold 10px monospace;cursor:pointer;margin-left:4px;">EXPORT</button></div>
    X: <input type="range" id="ring-x" min="-20" max="20" step="0.5" value="${_ringTuner.x}"> <span id="ring-x-val">${_ringTuner.x}</span><br>
    Y: <input type="range" id="ring-y" min="0" max="10" step="0.25" value="${_ringTuner.y}"> <span id="ring-y-val">${_ringTuner.y}</span><br>
    R: <input type="range" id="ring-r" min="1" max="10" step="0.25" value="${_ringTuner.radius}"> <span id="ring-r-val">${_ringTuner.radius}</span><br>
    W: <input type="range" id="ring-w" min="1" max="20" step="0.5" value="${_ringTuner.lineWidth}"> <span id="ring-w-val">${_ringTuner.lineWidth}</span><br>
    OP: <input type="range" id="ring-op" min="0.1" max="1" step="0.05" value="0.85"> <span id="ring-op-val">0.85</span><br>
    GLOW: <input type="range" id="ring-bl" min="0" max="1" step="0.1" value="0"> <span id="ring-bl-val">0</span><br>
    <div style="margin-top:4px;border-top:1px solid #0fc4;padding-top:4px;">COLOR: <select id="ring-color-mode" style="background:#111;color:#0fc;border:1px solid #0fc4;font:11px monospace;">
      <option value="cycle">Cycling</option>
      <option value="orange">Orange</option>
      <option value="cyan">Cyan</option>
      <option value="purple">Purple</option>
      <option value="white">White</option>
      <option value="gold">Gold</option>
      <option value="pink">Hot Pink</option>
      <option value="green">Green</option>
      <option value="red">Red</option>
      <option value="custom">Custom ↓</option>
    </select> <input type="color" id="ring-color-pick" value="#00ffcc" style="width:28px;height:20px;border:none;vertical-align:middle;"></div><br>
    <div style="margin-top:4px;border-top:1px solid #0fc4;padding-top:4px;">LEN: <input type="range" id="ring-len" min="2" max="100" step="1" value="${_ringTuner.length}"> <span id="ring-len-val">${_ringTuner.length}</span><br>
    FREQ: <input type="range" id="ring-freq" min="0.5" max="40" step="0.5" value="${_ringTuner.freq}"> <span id="ring-freq-val">${_ringTuner.freq}</span><br>
    SINE: <input type="range" id="ring-sa" min="0" max="15" step="0.5" value="${_ringTuner.sineAmp}"> <span id="ring-sa-val">${_ringTuner.sineAmp}</span><br>
    S-PER: <input type="range" id="ring-sp" min="2" max="20" step="1" value="${_ringTuner.sinePeriod}"> <span id="ring-sp-val">${_ringTuner.sinePeriod}</span><br>
    COPY: <input type="range" id="ring-cp" min="1" max="20" step="1" value="${_ringTuner.copies}"> <span id="ring-cp-val">${_ringTuner.copies}</span><br>
    X-GAP: <input type="range" id="ring-cg" min="-10" max="20" step="0.5" value="${_ringTuner.copyGap}"> <span id="ring-cg-val">${_ringTuner.copyGap}</span></div>
  `;
  document.body.appendChild(panel);
  _ringTunerPanel = panel;
  const _rtu = (id, key, apply) => document.getElementById(id).addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById(id + '-val').textContent = v;
    if (key) _ringTuner[key] = v;
    if (apply) apply(v);
    _ringApplyTuner();
  });
  document.getElementById('ring-spawn-btn').addEventListener('click', e => {
    e.stopPropagation();
    _ringRemoveAll();
    _ringSpawnRow(undefined, true);
  });
  document.getElementById('ring-export-btn').addEventListener('click', e => {
    e.stopPropagation();
    const out = JSON.stringify(_ringTuner, null, 2);
    console.log('[RING EXPORT]\n' + out);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(out).then(() => {
        e.target.textContent = 'COPIED!';
        setTimeout(() => { e.target.textContent = 'EXPORT'; }, 1500);
      }).catch(() => {
        e.target.textContent = 'SEE CONSOLE';
        setTimeout(() => { e.target.textContent = 'EXPORT'; }, 1500);
      });
    } else {
      e.target.textContent = 'SEE CONSOLE';
      setTimeout(() => { e.target.textContent = 'EXPORT'; }, 1500);
    }
  });
  document.getElementById('ring-pause-btn').addEventListener('click', e => {
    e.stopPropagation();
    _ringPaused = !_ringPaused;
    if (_ringPaused) {
      state._ringSavedSpeed = state.speed;
      state.speed = 0;
      state._ringFrozen = true; // flag checked by update loop to skip game logic
      e.target.textContent = 'PLAY';
      e.target.style.background = '#f66';
    } else {
      state.speed = state._ringSavedSpeed || BASE_SPEED;
      state._ringFrozen = false;
      e.target.textContent = 'PAUSE';
      e.target.style.background = '#0fc';
    }
  });
  _rtu('ring-x', 'x');
  _rtu('ring-y', 'y');
  _rtu('ring-r', 'radius');
  _rtu('ring-w', 'lineWidth', v => {
    for (const r of _bonusRings) r.mesh.material.linewidth = v;
  });
  _rtu('ring-op', null, v => {
    _ringTuner._opacity = v;
    for (const r of _bonusRings) r.mesh.material.opacity = v;
  });
  _rtu('ring-bl', null, v => {
    _ringTuner._glow = v;
    for (const r of _bonusRings) {
      r.mesh.material.blending = v > 0.5 ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
  });
  // Color controls
  const _colorMap = { orange: 0xff6600, cyan: 0x00ddff, purple: 0xcc00ff, white: 0xffffff, gold: 0xffd700, pink: 0xff1493, green: 0x00ff88, red: 0xff2222 };
  function _applyColor() {
    const mode = document.getElementById('ring-color-mode').value;
    _ringTuner.colorMode = mode;
    if (mode === 'cycle') {
      _bonusRings.forEach((r, i) => r.mesh.material.color.setHex(_ringPalette[i % 3]));
    } else if (mode === 'custom') {
      const hex = document.getElementById('ring-color-pick').value;
      const c = parseInt(hex.replace('#', ''), 16);
      _ringTuner.customColor = hex;
      for (const r of _bonusRings) r.mesh.material.color.setHex(c);
    } else {
      const c = _colorMap[mode] || 0x00ffcc;
      for (const r of _bonusRings) r.mesh.material.color.setHex(c);
    }
  }
  document.getElementById('ring-color-mode').addEventListener('change', _applyColor);
  document.getElementById('ring-color-pick').addEventListener('input', () => {
    document.getElementById('ring-color-mode').value = 'custom';
    _applyColor();
  });
  // These respawn all rings since they change layout
  const _rtuRespawn = (id, key) => document.getElementById(id).addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById(id + '-val').textContent = v;
    _ringTuner[key] = v;
    _ringRemoveAll();
    _ringSpawnRow(undefined, true); // nearSpawn for tuner visibility
  });
  _rtuRespawn('ring-len', 'length');
  _rtuRespawn('ring-freq', 'freq');
  _rtuRespawn('ring-sa', 'sineAmp');
  _rtuRespawn('ring-sp', 'sinePeriod');
  _rtuRespawn('ring-cp', 'copies');
  _rtuRespawn('ring-cg', 'copyGap');
}

// ── Death Run transition state ──
let _drTransFrom = null;   // DEATH_RUN_VIBES entry we're transitioning from
let _drTransTo   = null;   // DEATH_RUN_VIBES entry we're transitioning to
let _drTransT    = 1;      // 0 = start, 1 = done
let _drTransActive = false;

function applyDeathRunVibeTransition(fromVibe, toVibe) {
  _drTransFrom   = fromVibe;
  _drTransTo     = toVibe;
  _drTransT      = 0;
  _drTransActive = true;
}

function updateDeathRunTransition(dt) {
  if (!_drTransActive) return;
  _drTransT = Math.min(1, _drTransT + dt * 1.2);
  const t = _drTransT;
  const from = _drTransFrom;
  const to   = _drTransTo;

  // Sky
  skyMat.uniforms.topColor.value.lerpColors(from.skyTop, to.skyTop, t);
  skyMat.uniforms.botColor.value.lerpColors(from.skyBot, to.skyBot, t);
  // Fog
  scene.fog.color.lerpColors(from.fogColor, to.fogColor, t);
  // Grid
  const gridLerp = new THREE.Color().lerpColors(from.gridColor, to.gridColor, t);
  updateGridColor(gridLerp);
  // Floor line
  const floorLerp = new THREE.Color().lerpColors(from.floorLine, to.floorLine, t);
  floorMat.uniforms.uLineColor.value.copy(floorLerp);
  mirrorMat.uniforms.uLineColor.value.copy(floorLerp);
  // Galaxy tint
  targetNebulaTint.lerpColors(from.gridColor, to.gridColor, t);
  // Sun color
  const sunLerped = new THREE.Color().lerpColors(from.sunColor, to.sunColor, t);
  updateSunColor(sunLerped, -1); // -1 = manual uniform control
  // Sun shader uniform lerping
  const fromUV   = (from.sunShader === 1) ? 1.0 : 0.0;
  const toUV     = (to.sunShader === 1)   ? 1.0 : 0.0;
  const fromIce  = (from.sunShader === 3) ? 1.0 : 0.0;
  const toIce    = (to.sunShader === 3)   ? 1.0 : 0.0;
  const fromGold = (from.sunShader === 4) ? 1.0 : 0.0;
  const toGold   = (to.sunShader === 4)   ? 1.0 : 0.0;
  const fromL3   = (from.sunShader === 2) ? 1.0 : 0.0;
  const toL3     = (to.sunShader === 2)   ? 1.0 : 0.0;
  sunMat.uniforms.uIsUV.value    = fromUV   + (toUV   - fromUV)   * t;
  sunMat.uniforms.uIsL3.value    = fromL3   + (toL3   - fromL3)   * t;
  sunMat.uniforms.uIsIce.value   = fromIce  + (toIce  - fromIce)  * t;
  sunMat.uniforms.uIsGold.value  = fromGold + (toGold - fromGold) * t;
  sunCapMat.uniforms.uIsUV.value   = sunMat.uniforms.uIsUV.value;
  sunCapMat.uniforms.uIsL3.value   = sunMat.uniforms.uIsL3.value;
  sunCapMat.uniforms.uIsIce.value  = sunMat.uniforms.uIsIce.value;
  sunCapMat.uniforms.uIsGold.value = sunMat.uniforms.uIsGold.value;
  // Bloom
  bloom.strength = from.bloomStrength + (to.bloomStrength - from.bloomStrength) * t;
  // Thruster color
  thrusterColor.lerpColors(from.thrusterColor, to.thrusterColor, t);
  // Warp palette — apply target vibe's colors if defined
  const _warpTarget = t >= 0.5 ? to : from;
  if (_warpTarget.warpCol1) {
    sunMat.uniforms.uWarpCol1.value.set(_warpTarget.warpCol1[0], _warpTarget.warpCol1[1], _warpTarget.warpCol1[2]);
    sunMat.uniforms.uWarpCol2.value.set(_warpTarget.warpCol2[0], _warpTarget.warpCol2[1], _warpTarget.warpCol2[2]);
    sunMat.uniforms.uWarpCol3.value.set(_warpTarget.warpCol3[0], _warpTarget.warpCol3[1], _warpTarget.warpCol3[2]);
  }

  if (_drTransT >= 1) {
    _drTransActive = false;
  }
}

let _pendingVibeIdx = -1; // deferred vibe transition (waits for mechanic to finish)
function checkDeathRunVibe() {
  if (!state.isDeathRun) return;
  // Vibes synced to bands: each band = new vibe. Band 6+ cycles remaining vibes every 45s.
  let _curBand = DR2_RUN_BANDS.length - 1;
  if (state._drForcedBand != null && state._drForcedBand >= 0) {
    _curBand = state._drForcedBand;
  } else {
    for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
      if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _curBand = bi; break; }
    }
  }
  let targetVibeIdx;
  if (_curBand < 6) {
    targetVibeIdx = _curBand; // Band 1=vibe 0, Band 2=vibe 1, etc.
  } else {
    // Beyond Band 6: cycle through vibes 6+ every 45s
    targetVibeIdx = 5 + Math.floor((state.elapsed - 180) / 45);
  }
  targetVibeIdx = targetVibeIdx % DEATH_RUN_VIBES.length;
  if (targetVibeIdx !== state.deathRunVibeIdx && _pendingVibeIdx < 0) {
    // If we're in RELEASE or RECOVERY (no active mechanic), transition now
    const safePhase = state.drPhase === 'RELEASE' || state.drPhase === 'RECOVERY';
    if (safePhase) {
      _applyVibeTransition(targetVibeIdx);
    } else {
      // Defer until current mechanic completes
      _pendingVibeIdx = targetVibeIdx;
    }
  }
  // Check if deferred transition can fire now
  if (_pendingVibeIdx >= 0) {
    const safeNow = state.drPhase === 'RELEASE' || state.drPhase === 'RECOVERY';
    if (safeNow) {
      _applyVibeTransition(_pendingVibeIdx);
      _pendingVibeIdx = -1;
    }
  }
}
function _applyVibeTransition(targetVibeIdx, suppressRestBeat) {
  const fromVibe = DEATH_RUN_VIBES[state.deathRunVibeIdx];
  const toVibe   = DEATH_RUN_VIBES[targetVibeIdx];
  state.deathRunVibeIdx = targetVibeIdx;
  _pendingVibeIdx = -1;
  state.levelElapsed    = 0;
  clearAllCorridorFlags();
  // Rest beat: 2.5s of no cones (suppressed when called from the sequencer
  // to avoid blocking the sequencer tick)
  if (!suppressRestBeat) state.deathRunRestBeat = 2.5;
  // Reset wave director to RELEASE after vibe change
  state.drPhase = 'RELEASE';
  state.drPhaseTimer = 0;
  const _relDur = DR2_PHASE_DURATIONS.RELEASE;
  state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);
  // Let existing obstacles scroll off naturally — no wipe
  // Smooth visual transition (bypasses updateTransition which needs LEVELS[])
  applyDeathRunVibeTransition(fromVibe, toVibe);
  state.currentLevelIdx = toVibe.sunShader;
  updateThrusterColor(toVibe.thrusterColor);
  if (toVibe.tendrils === 'aurora' || toVibe.tendrils === 'l5f') {
    auroraTVisible = true;
  } else {
    auroraTVisible = false;
  }
  playLevelUp();
  updateHUDLevel();
  showBanner('TIER ' + (targetVibeIdx + 1), 'levelup', 2500);
  updateCoinColors();
}
function checkDeathRunSpeed() {
  if (!state.isDeathRun) return;
  // Don't override speed during corridor arc (arc sets its own per-stage speed)
  if (state._arcActive && state._arcQueue && state._arcQueue[state._arcStage] && state._arcQueue[state._arcStage].speed) return;

  // Player level starting speed bonus
  const _plvl = loadPlayerLevel();
  const _lvlSpeedBonus = _plvl >= 15 ? 1.5 : _plvl >= 10 ? 1.4 : _plvl >= 5 ? 1.2 : 1.0;

  // Speed synced to bands (tiers) — minimum is level bonus
  // T1-2: base, T3: 1.2x, T4: 1.35x (corridors), T5: 1.5x, T6: 1.85x (max)
  const BAND_SPEED = [1.0, 1.0, 1.2, 1.35, 1.5, 1.85]; // idx 0-5 = Band 1-6

  // Get current band index (respects forced band override)
  let _curBand = DR2_RUN_BANDS.length - 1;
  if (state._drForcedBand != null && state._drForcedBand >= 0) {
    _curBand = state._drForcedBand;
  } else {
    for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
      if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _curBand = bi; break; }
    }
  }
  const _floor = state._drSpeedFloor || 0;
  const targetSpeedMult = Math.max(_lvlSpeedBonus, _floor, BAND_SPEED[Math.min(_curBand, BAND_SPEED.length - 1)]);
  const targetTier = _curBand;

  // Defer speed change if mechanic is active
  const safeForSpeed = state.drPhase === 'RELEASE' || state.drPhase === 'RECOVERY';
  if (targetTier !== state.deathRunSpeedTier && !safeForSpeed) {
    state._pendingSpeedTier = targetTier;
  }
  if (safeForSpeed && state._pendingSpeedTier != null && state._pendingSpeedTier >= 0) {
    const prevTier = state.deathRunSpeedTier;
    state.deathRunSpeedTier = state._pendingSpeedTier;
    state.speed = BASE_SPEED * Math.max(_lvlSpeedBonus, _floor, BAND_SPEED[Math.min(state.deathRunSpeedTier, BAND_SPEED.length - 1)]);
    state._pendingSpeedTier = -1;
    if (state.deathRunSpeedTier > prevTier && prevTier >= 0 && !state.introActive) {
      state._drSpeedBeepFired = false;
      hapticMedium();
      const roar = document.getElementById('engine-roar');
      if (roar && !state.muted) { roar.currentTime = 0; roar.volume = 0.06; roar.play().catch(() => {}); }
      state._thrusterFlare = 2.0;
    }
  } else if (safeForSpeed && targetTier !== state.deathRunSpeedTier) {
    const prevTier = state.deathRunSpeedTier;
    state.deathRunSpeedTier = targetTier;
    state.speed = BASE_SPEED * targetSpeedMult;
    if (state.deathRunSpeedTier > prevTier && prevTier >= 0 && !state.introActive) {
      state._drSpeedBeepFired = false;
      hapticMedium();
      const roar = document.getElementById('engine-roar');
      if (roar && !state.muted) { roar.currentTime = 0; roar.volume = 0.06; roar.play().catch(() => {}); }
      state._thrusterFlare = 2.0;
    }
  }

  // Animate thruster flare decay
  if (state._thrusterFlare > 1.0) {
    window._thrusterScale = state._thrusterFlare;
    state._thrusterFlare -= 0.03;
    if (state._thrusterFlare <= 1.0) {
      state._thrusterFlare = 0;
      window._thrusterScale = window._baseThrusterScale || 1.0;
    }
  }

  // Music: crossfade to l4 when L3 corridor boss starts (handled in _drSeqAdvance)
}

let _introTimers = [];
function clearIntroTimers() {
  _introTimers.forEach(id => { clearTimeout(id); clearInterval(id); cancelAnimationFrame(id); });
  _introTimers = [];
  state.thrusterPower = 0;  // kill any mid-spurt flicker
  // Stop engine startup SFX if playing
  const eng = document.getElementById('engine-start');
  if (eng) { eng.pause(); eng.currentTime = 0; }
}

// ── Thruster sputter-on animation ──
let _sputterTimer = null;
function beginThrusterSputter() {
  if (_sputterTimer) { clearInterval(_sputterTimer); _sputterTimer = null; }
  state.thrusterPower = 0;
  const startT = performance.now();
  const duration = 2200; // 2.2s total sputter
  _sputterTimer = setInterval(() => {
    const t = (performance.now() - startT) / duration;
    if (t >= 1) {
      state.thrusterPower = 1;
      clearInterval(_sputterTimer);
      _sputterTimer = null;
      return;
    }
    // Base ramp with random sputters (drops to near-zero)
    const ramp = t * t; // ease-in quadratic
    const sputter = Math.random() < 0.3 ? Math.random() * 0.15 : 1.0;
    state.thrusterPower = Math.min(1, ramp * sputter + ramp * 0.3);
  }, 50);
}
function killThrusterSputter() {
  if (_sputterTimer) { clearInterval(_sputterTimer); _sputterTimer = null; }
  state.thrusterPower = 1;
}
let _musicTimers = [];
function clearMusicTimers() {
  _musicTimers.forEach(id => clearTimeout(id));
  _musicTimers = [];
}

function fadeOutIntroOverlay(el) {
  el.classList.add('fading-out');
  el.style.pointerEvents = 'none';  // restore pass-through immediately
  setTimeout(() => { el.style.display = 'none'; el.innerHTML = ''; el.classList.remove('fading-out'); }, 820);
  // Spawn opening rings right as prologue ends — close to ship for instant dopamine hit

}

// ── HEAD START SYSTEM ─────────────────────────────────────────────
let _hsTimeout = null;  // auto-dismiss timer
let _hsActive = false;  // true while head start prompt is showing

function showHeadStartPrompt() {
  const overlay = document.getElementById('headstart-overlay');
  if (!overlay) return;

  const freeCount = loadFreeHeadStarts();
  const fuel = loadFuelCells();
  const basicCost = getHeadStartCost(false);
  const megaCost = getHeadStartCost(true);
  const canBasic = freeCount > 0 || fuel >= basicCost;
  const canMega = fuel >= megaCost;

  if (!canBasic && !canMega) return; // nothing to show

  const basicBtn = document.getElementById('hs-basic-btn');
  const megaBtn = document.getElementById('hs-mega-btn');

  // Basic button
  if (canBasic && basicBtn) {
    if (freeCount > 0) {
      basicBtn.innerHTML = _FUEL_SVG + ' HEAD START <span class="hs-free">FREE</span>';
    } else {
      basicBtn.innerHTML = _FUEL_SVG + ' HEAD START \u2014 ' + basicCost;
    }
    basicBtn.style.display = '';
    basicBtn.onclick = () => { activateHeadStart(false); dismissHeadStart(); };
    basicBtn.addEventListener('touchstart', () => { basicBtn.style.transform = 'scale(0.94)'; }, { passive: true });
    basicBtn.addEventListener('touchend', () => { basicBtn.style.transform = 'scale(1)'; }, { passive: true });
  } else if (basicBtn) {
    basicBtn.style.display = 'none';
  }

  // Mega button
  if (canMega && megaBtn) {
    megaBtn.innerHTML = _FUEL_SVG + _FUEL_SVG + ' MEGA \u2014 ' + megaCost;
    megaBtn.style.display = '';
    megaBtn.onclick = () => { activateHeadStart(true); dismissHeadStart(); };
    megaBtn.addEventListener('touchstart', () => { megaBtn.style.transform = 'scale(0.94)'; }, { passive: true });
    megaBtn.addEventListener('touchend', () => { megaBtn.style.transform = 'scale(1)'; }, { passive: true });
  } else if (megaBtn) {
    megaBtn.style.display = 'none';
  }

  overlay.style.display = 'flex';
  overlay.classList.remove('fading');
  _hsActive = true;
  // Tap outside buttons = dismiss (skip head start)
  overlay.onclick = (e) => { if (e.target === overlay) dismissHeadStart(); };
  requestAnimationFrame(() => overlay.classList.add('visible'));

  // Auto-dismiss after 4 seconds
  if (_hsTimeout) clearTimeout(_hsTimeout);
  _hsTimeout = setTimeout(() => dismissHeadStart(), 4000);
}

function dismissHeadStart() {
  _hsActive = false;
  if (_hsTimeout) { clearTimeout(_hsTimeout); _hsTimeout = null; }
  const overlay = document.getElementById('headstart-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.classList.add('fading');
  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.classList.remove('fading');
  }, 500);
}

function activateHeadStart(mega) {
  const freeCount = loadFreeHeadStarts();
  const fuel = loadFuelCells();
  const cost = getHeadStartCost(mega);

  // Deduct cost
  if (!mega && freeCount > 0) {
    saveFreeHeadStarts(freeCount - 1);
  } else {
    if (fuel < cost) return; // safety
    saveFuelCells(fuel - cost);
  }
  updateTitleFuelCells();

  // Target: Head Start → T3 (idx 2), Mega → T5 (idx 4)
  const targetLevelIdx = mega ? 4 : 2;
  const targetScore = LEVELS[Math.min(targetLevelIdx, LEVELS.length - 1)].scoreThreshold;
  const warpSpeed = BASE_SPEED * 4.5;  // ~4.5x normal — visually fast warp
  const warpDuration = mega ? 3500 : 2500; // ms — time to blast through levels
  const graceDuration = mega ? 3000 : 2000; // invincible grace after landing

  // Activate invincible + warp speed immediately
  state.invincibleTimer = (warpDuration + graceDuration) / 1000;
  state.invincibleSpeedActive = true;
  state.invincibleGraceTimer = 0;
  state.speed = warpSpeed;
  // Enable magnet to hoover up all coins during warp
  state.magnetActive = true;
  state.magnetTimer = (warpDuration + graceDuration) / 1000;

  // Skip intro if somehow still active
  if (state.introActive) {
    state.introActive = false;
    const introOv = document.getElementById('intro-overlay');
    if (introOv) { introOv.style.display = 'none'; introOv.innerHTML = ''; }
    clearIntroTimers();
  }

  // Rapidly tick score up during warp — levels transition naturally via checkLevelUp()
  const scoreStart = state.score;
  const scoreTarget = targetScore + 5; // slightly past threshold
  const rampStart = performance.now();
  const _hsRamp = setInterval(() => {
    const t = Math.min(1, (performance.now() - rampStart) / warpDuration);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    state.score = Math.floor(scoreStart + (scoreTarget - scoreStart) * ease);
    if (t >= 1) {
      clearInterval(_hsRamp);
      if (state.isDeathRun) {
        // DR: jump sequencer directly — normal=T3A (idx 2, key 3), mega=T3B_L3BOSS (idx 3, key 4)
        const _targetStageIdx = mega ? 3 : 2;
        clearAllCorridorFlags();
        state.deathRunRestBeat = 0;
        state.seqStageIdx = _targetStageIdx;
        state.seqStageElapsed = 0;
        state._seqCorridorStarted = false;
        state._seqSpawnMode = 'cones';
        state._seqConeDensity = 'normal';
        state._seqVibeApplied = -1;
        const _ts = DR_SEQUENCE[_targetStageIdx];
        if (_ts) state.speed = BASE_SPEED * _ts.speed;
      } else {
        const finalLvl = LEVELS[Math.min(targetLevelIdx, LEVELS.length - 1)];
        state.speed = BASE_SPEED * finalLvl.speedMult;
      }
    }
  }, 16);

  // Flash banner
  const bannerText = mega ? 'MEGA START' : 'HEAD START';
  const banner = document.createElement('div');
  banner.className = 'hs-banner';
  banner.textContent = bannerText;
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('show'));
  setTimeout(() => {
    banner.classList.add('fade');
    setTimeout(() => banner.remove(), 600);
  }, 1500);
}

function showIntroText() {
  const overlay = document.getElementById('intro-overlay');
  if (!overlay) return;
  clearIntroTimers();
  overlay.innerHTML = '';
  overlay.style.display = 'flex';

  const lineA = document.createElement('div');
  lineA.className = 'intro-line line-a';
  lineA.textContent = "ONE RACE STANDS BETWEEN YOU AND PEACE.";

  const lineB = document.createElement('div');
  lineB.className = 'intro-line line-b';
  lineB.textContent = "THIS IS THAT RACE.";

  const lineC = document.createElement('div');
  lineC.className = 'intro-title line-c';
  lineC.textContent = "JET HORIZON";

  const skipHint = document.createElement('div');
  skipHint.className = 'intro-skip-hint';
  const _isMobile = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  skipHint.textContent = 'tap to skip';

  overlay.appendChild(lineA);
  overlay.appendChild(lineB);
  overlay.appendChild(lineC);
  overlay.appendChild(skipHint);

  // Mobile: tap anywhere on the intro overlay to skip
  overlay.addEventListener('touchstart', function _tapSkip(e) {
    e.preventDefault();
    overlay.removeEventListener('touchstart', _tapSkip);
    clearIntroTimers();
    fadeOutIntroOverlay(overlay);
    state.introActive = false;
    beginThrusterSputter();
    state._introLiftActive = true;
    state._introLiftTimer = 0;
  }, { passive: false });

  // Line A fades in at 3s (3.5s duration → done ~6.5s)
  _introTimers.push(setTimeout(() => { lineA.classList.add('playing'); }, 3000));
  // 2s pause → Line B starts at 8.5s (3.5s duration → done ~12s)
  _introTimers.push(setTimeout(() => { lineB.classList.add('playing'); }, 8500));
  // Engine startup SFX — fade is baked into the audio file, just play from start
  _introTimers.push(setTimeout(() => {
    const eng = document.getElementById('engine-start');
    if (eng && !state.muted) {
      _ensureCtxRunning();
      eng.currentTime = 0;
      eng.volume = 0.12;
      eng.play().catch(() => {});
    }
  }, 8500));

  // Pre-spurts — ultra-quick thruster flickers, paired like failed ignition
  function _preSpurt(delay, peak, dur) {
    _introTimers.push(setTimeout(() => {
      if (!state.introActive) return;
      const _start = performance.now();
      const _iv = setInterval(() => {
        const t = (performance.now() - _start) / dur;
        if (t >= 1) { state.thrusterPower = 0; clearInterval(_iv); return; }
        const env = t < 0.25 ? (t / 0.25) : (1 - (t - 0.25) / 0.75);
        state.thrusterPower = env * peak;
      }, 16);
      _introTimers.push(_iv);
    }, delay));
  }
  // Pair 1 — after engine audio has faded in (~10s)
  _preSpurt(10000, 0.45, 125);
  _preSpurt(10175, 0.35, 110);
  // Trio 2 — more urgent triple burst (~11.8s)
  _preSpurt(11800, 0.5, 130);
  _preSpurt(11980, 0.35, 110);
  _preSpurt(12140, 0.25, 100);
  // Pair 3 — one more double flicker (~13.5s)
  _preSpurt(13500, 0.4, 125);
  _preSpurt(13675, 0.3, 110);
  // 2s pause → JET HORIZON title card starts at 14s (4.5s duration → done ~18.5s)
  _introTimers.push(setTimeout(() => { lineC.classList.add('playing'); }, 14000));
  // Cones unlock right as title finishes fading out (~18.5s)
  _introTimers.push(setTimeout(() => {
    fadeOutIntroOverlay(overlay);
    state.introActive = false;
    beginThrusterSputter();
  }, 18500));
}

function killPlayer() {
  // Tutorial: flash and respawn, reset current zip row if in zip phase
  if (state._tutorialActive) {
    hapticMedium();
    addCrashFlash(0xff4400);
    playSFX(300, 0.2, 'sawtooth', 0.15);
    state.shipVelX = 0;
    state.shipX = 0;
    // In zip phase: flag as hit and clear row so it respawns
    if (state._tutorialStep === 1.5) {
      state._tutorialZipHit = true;
      for (let _ti = activeObstacles.length - 1; _ti >= 0; _ti--) {
        if (activeObstacles[_ti].userData._tutZip) {
          returnObstacleToPool(activeObstacles[_ti]);
          activeObstacles.splice(_ti, 1);
        }
      }
    }
    return;
  }
  // Invincibility check — head start, overdrive powerup, etc.
  if (state.invincibleTimer > 0) {
    hapticMedium();
    addCrashFlash(0xffcc00);
    playSFX(400, 0.3, 'sawtooth', 0.2);
    return;
  }
  if (state.shieldActive) {
    // Decrement hit points
    state.shieldHitPoints = (state.shieldHitPoints || 1) - 1;
    hapticMedium();
    // Trigger hit ripple — rotate through 6 slots
    _shieldHitIdx = (_shieldHitIdx + 1) % 6;
    const _hitTheta = Math.random() * Math.PI * 2;
    const _hitPhi   = Math.acos(2 * Math.random() - 1);
    shieldMat.uniforms.uHitPos.value[_shieldHitIdx].set(
      Math.sin(_hitPhi) * Math.cos(_hitTheta),
      Math.sin(_hitPhi) * Math.sin(_hitTheta),
      Math.cos(_hitPhi)
    );
    shieldMat.uniforms.uHitTime.value[_shieldHitIdx] = shieldMat.uniforms.uTime.value;
    // Update uLife
    const _shieldTier = loadUpgradeTier('shield');
    const _maxHits = (_shieldTier >= 5) ? 3 : (_shieldTier >= 4) ? 2 : 1;
    const _shTierForLife = loadUpgradeTier('shield');
    shieldMat.uniforms.uLife.value = (_shTierForLife >= 3) ? state.shieldHitPoints / _maxHits : 1.0;
    if (state.shieldHitPoints > 0) {
      // Shield survives — update color + life
      const shieldColors = [0x26aeff, 0x26aeff, 0x00f0cc, 0x00f0cc];
      const sc = shieldColors[state.shieldHitPoints] || 0x00f0ff;
      shieldMat.uniforms.uColor.value.setHex(sc);
      shieldMat.uniforms.uNoiseEdgeColor.value.setHex(sc);
      shieldWireMat.color.setHex(sc);
      shieldLight.color.setHex(sc);
      const _shTier = loadUpgradeTier('shield');
      const _shMaxHits = (_shTier >= 5) ? 3 : (_shTier >= 4) ? 2 : 1;
      const _shTierForLife2 = loadUpgradeTier('shield');
      shieldMat.uniforms.uLife.value = (_shTierForLife2 >= 3) ? state.shieldHitPoints / _shMaxHits : 1.0;
      addCrashFlash(sc);
      const _shHitSfx = document.getElementById('shield-hit-sfx'); if (_shHitSfx) { _shHitSfx.currentTime = 0; _shHitSfx.play().catch(()=>{}); }
      state._prevShieldHP = state.shieldHitPoints;
      return;
    }
    // Shield breaks — trigger death ripple then dissolve
    state.shieldActive = false;
    state._prevShieldHP = 0;
    state._shieldBreakT = 0;
    shieldWireMat.opacity = 0;
    addCrashFlash(0x00f0ff);
    const _shHitSfx2 = document.getElementById('shield-hit-sfx'); if (_shHitSfx2) { _shHitSfx2.currentTime = 0; _shHitSfx2.play().catch(()=>{}); }
    return;
  }

  // Save corridor type so repair ship can restart it from scratch
  state._deathCorridorType = state.l5CorridorActive ? 'l5' : state.l4CorridorActive ? 'l4' : state.corridorMode ? 'l3' : null;

  state.phase = 'dead';
  // Cancel retry/repair sweep if somehow active
  _retrySweepActive = false;
  _retryIsFromDead = false;
  _drLogEvent('death', `score=${state.score} tier=${state.deathRunSpeedTier}`);
  _drSaveSession('death');
  // [WHEEL DISABLED] if (!state.wheelEarned) state.wheelEarned = true;
  dismissHeadStart(); // clean up if still showing
  // Kill roll state immediately on death
  touch.rollToggle = false;
  touch.rollUp = false;
  touch.rollDown = false;
  state.rollHeld = false;
  state.rollAngle = 0;
  state.rollDir = 0;
  shipGroup.rotation.z = 0;

  // ── Ship explosion: hide ship + thrusters, spawn particles ──
  shipGroup.visible = false;
  // Kill thruster particle systems (they're on scene, not shipGroup)
  thrusterSystems.forEach(s => { s.points.visible = false; });
  miniThrusterSystems.forEach(s => { s.points.visible = false; });
  {
    // Find nearest obstacle for deflection direction
    const _sPos = new THREE.Vector3(state.shipX, shipGroup.position.y, shipGroup.position.z);
    let _obstPos = new THREE.Vector3(_sPos.x, _sPos.y, _sPos.z - 2); // default: obstacle ahead
    let _nearestDist = Infinity;
    for (let _oi = 0; _oi < activeObstacles.length; _oi++) {
      const _op = activeObstacles[_oi].position;
      const _dx = _sPos.x - _op.x;
      const _dz = _sPos.z - _op.z;
      const _d2 = _dx * _dx + _dz * _dz;
      if (_d2 < _nearestDist) {
        _nearestDist = _d2;
        _obstPos.set(_op.x, _op.y, _op.z);
      }
    }
    // Build color palette from current level
    const _lvl = LEVELS[state.currentLevelIdx] || LEVELS[0];
    const _palette = [
      _lvl.gridColor,
      _lvl.sunColor,
      new THREE.Color(0xffffff),
    ];
    const _deathSpeed = state.invincibleSpeedActive ? state.speed * 1.8 : state.speed;
    _spawnExplosion(_sPos, _obstPos, _deathSpeed, _palette);
    // Layered VFX: temporarily disabled to isolate face explosion + particles
    // _triggerFlash(_sPos);
    // _triggerShockwave(_sPos);
    // _triggerSparks(_sPos);
    // Face explosion: ship triangles fly apart from impact
    const _faceExpModel = _altShipActive ? _altShipModel : window._shipModel;
    if (_faceExpModel) {
      const _impDir = new THREE.Vector3().subVectors(_sPos, _obstPos).normalize();
      _triggerFaceExplosion(_faceExpModel, _impDir);
    }
    // Camera zoom-out + lateral orbit to profile view
    _expDeathZoomTarget = _baseFOV + 15; // less FOV zoom since camera rises instead
    _expDeathZoomActive = true;
    _expCamOrbitActive = true;
    _expCamOrbitT = 0;
    _expCamAnchorX = cameraPivot.position.x;
    _expCamAnchorY = cameraPivot.position.y;
    _expCamAnchorZ = cameraPivot.position.z;
    // Store crash site in world space for lookAt
    _expCrashWorldPos.set(shipGroup.position.x, shipGroup.position.y, shipGroup.position.z);
  }

  if (state.score > state.bestScore) state.bestScore = state.score;

  hapticHeavy(); // death
  // Stop engine SFX
  const _engD = document.getElementById('engine-start');
  const _roarD = document.getElementById('engine-roar');
  if (_engD && !_engD.paused) { _engD.pause(); _engD.currentTime = 0; }
  if (_roarD && !_roarD.paused) { _roarD.pause(); _roarD.currentTime = 0; }
  playCrash();
  // addCrashFlash(); // disabled to isolate face explosion

  if (titleMusic) titleMusic.currentTime = 0;  // always start title from top on game over
  // Stop lake ambience on game over
  if (lakeMusic) { lakeMusic.pause(); lakeMusic.currentTime = 0; setTrackVol('lake', 0); }
  musicFadeTo('title', 2500);

  // Player-facing score — apply distance multiplier
  const _rawScore = Math.floor(state.playerScore);
  const _dist = state.distance || 0;
  // Multiplier: every 5000 distance units = +0.1x (so ~3min full run ≈ 3x)
  const _distMultiplier = Math.max(1, 1 + Math.floor(_dist / 5000) * 0.1);
  const finalScore = Math.floor(_rawScore * _distMultiplier);
  const isNewBest = finalScore > state.bestScore;
  if (isNewBest) state.bestScore = finalScore;
  document.getElementById('go-score').textContent = finalScore.toLocaleString();
  // Show multiplier breakdown if it applied
  const _goMultEl = document.getElementById('go-dist-mult');
  if (_goMultEl) {
    if (_distMultiplier > 1) {
      _goMultEl.textContent = 'Distance bonus ×' + _distMultiplier.toFixed(1);
      _goMultEl.style.display = 'block';
    } else {
      _goMultEl.style.display = 'none';
    }
  }

  // ── Coins earned (single total) ──
  const pickupCoins = state.sessionCoins;
  const distanceBonus = Math.floor(finalScore / 10) * ((state.isDeathRun) ? 1.5 : 1);
  const drTier = state.isDeathRun ? (state.deathRunSpeedTier || 0) : 0;
  const tierBonus = drTier * 50;
  let coinMultiplier = 1;
  const _dcFlag = window._LS.getItem('jetslide_double_next');
  if (_dcFlag) {
    coinMultiplier = (parseInt(_dcFlag) || 1) + 1;  // '1' → 2x, '2' → 3x
    window._LS.removeItem('jetslide_double_next');
  }
  const totalCoins = (pickupCoins + Math.floor(distanceBonus) + tierBonus) * coinMultiplier;
  const _totalEl = document.getElementById('go-coins-total');
  if (_totalEl) _totalEl.textContent = '+' + totalCoins + (coinMultiplier > 1 ? ' (' + coinMultiplier + '×)' : '');

  // Persist total earned coins to wallet
  saveCoinWallet(loadCoinWallet() + totalCoins);
  _totalCoins = loadCoinWallet();

  // ── Mission Ladder ──
  const runStats = {
    score: Math.floor(state.playerScore),
    coins: state.sessionCoins,
    powerups: state.sessionPowerups || 0,
    shields: state.sessionShields || 0,
    lasers: state.sessionLasers || 0,
    invincibles: state.sessionInvincibles || 0,
    isDR: state.isDeathRun,
    drTier: state.deathRunSpeedTier || 0,
  };
  // Update lifetime stats
  const lt = loadLifetimeStats();
  lt.coins += runStats.coins;
  lt.score += runStats.score;
  lt.runs += 1;
  lt.powerups += runStats.powerups;
  saveLifetimeStats(lt);

  const ladderResult = checkLadder(runStats, lt);

  // Show ladder progress on death screen
  // Mission complete SFX
  if (ladderResult.advanced && ladderResult.completedMissions.length > 0) {
    playSFX(600, 0.2, 'sine', 0.15);
    setTimeout(() => playSFX(900, 0.2, 'sine', 0.15), 120);
  }

  // ── Level bar ──
  const xpResult = addXPFromRun(state.playerScore);
  const _levelLabelEl = document.getElementById('go-level-label');
  const _xpBarEl = document.getElementById('go-xp-fill-end');
  const _levelUpWrap = document.getElementById('go-levelup-wrap');

  if (_levelLabelEl) _levelLabelEl.textContent = 'LV ' + (xpResult.newLevel ? xpResult.level - xpResult.levelsGained : xpResult.level);
  if (_xpBarEl) {
    const startPct = Math.min(100, xpResult.startPct * 100);
    const endPct = Math.min(100, (xpResult.xp / xpResult.xpForNext) * 100);
    _xpBarEl.style.transition = 'none';
    _xpBarEl.style.width = startPct + '%';
    _xpBarEl.classList.remove('xp-comet');

    if (xpResult.newLevel) {
      // Phase 1: fill to 100% with comet
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        _xpBarEl.classList.add('xp-comet');
        _xpBarEl.style.transition = 'width 0.9s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        _xpBarEl.style.width = '100%';
      }); });
      // Phase 2: flash bright on level-up, reset, fill to remainder
      setTimeout(() => {
        const barWrap = _xpBarEl.parentElement;
        if (barWrap) { barWrap.classList.add('xp-flash'); }
        if (_levelLabelEl) _levelLabelEl.textContent = 'LV ' + xpResult.level;
        setTimeout(() => {
          _xpBarEl.classList.remove('xp-comet');
          _xpBarEl.style.transition = 'none';
          _xpBarEl.style.width = '0%';
          if (barWrap) barWrap.classList.remove('xp-flash');
          requestAnimationFrame(() => { requestAnimationFrame(() => {
            _xpBarEl.classList.add('xp-comet');
            _xpBarEl.style.transition = 'width 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            _xpBarEl.style.width = endPct + '%';
          }); });
          setTimeout(() => _xpBarEl.classList.remove('xp-comet'), 900);
        }, 400);
      }, 950);
    } else {
      // Normal fill with comet tail
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        _xpBarEl.classList.add('xp-comet');
        _xpBarEl.style.transition = 'width 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        _xpBarEl.style.width = endPct + '%';
      }); });
      setTimeout(() => _xpBarEl.classList.remove('xp-comet'), 1300);
    }
  }

  if (_levelUpWrap) {
    if (xpResult.newLevel) {
      const showDelay = xpResult.newLevel ? 1000 : 0;
      setTimeout(() => {
        _levelUpWrap.classList.remove('hidden');
        _levelUpWrap.querySelector('.go-levelup-text').textContent = 'LEVEL ' + xpResult.level;
        const unlockedSkin = Object.entries(SKIN_LEVEL_UNLOCKS).find(([idx, lvl]) => lvl === xpResult.level);
        const unlockEl = _levelUpWrap.querySelector('.go-levelup-unlock');
        if (unlockedSkin && unlockEl) {
          const skinName = SHIP_SKINS[parseInt(unlockedSkin[0])].name;
          unlockEl.textContent = '\u{1F513} ' + skinName + ' unlocked!';
          unlockEl.classList.remove('hidden');
        } else if (unlockEl) {
          unlockEl.classList.add('hidden');
        }
      }, showDelay);
    } else {
      _levelUpWrap.classList.add('hidden');
    }
  }

  updateTitleLevel();

  // ── Ship Handling Bar ──
  // Maps player level onto the full handling range (Level 1 = 0%, Level 22+ = 100%)
  // Dings when crossing a tier boundary
  const _handlingBarEl = document.getElementById('go-handling-fill');
  const _handlingTierEl = document.getElementById('go-handling-tier');
  const _handlingUpgradeWrap = document.getElementById('go-handling-upgrade-wrap');
  if (_handlingBarEl) {
    const firstTierLvl = HANDLING_TIERS[0].level; // 1
    const lastTierLvl = HANDLING_TIERS[HANDLING_TIERS.length - 1].level; // 22
    const totalRange = lastTierLvl - firstTierLvl; // 21
    const playerLevel = loadPlayerLevel();
    const playerXP = loadPlayerXP();
    const xpNeeded = xpForLevel(playerLevel);
    const prevPlayerLevel = xpResult.newLevel ? xpResult.level - xpResult.levelsGained : playerLevel;

    // Fractional level: level + partial XP progress toward next level
    // Before this run: startPct is fraction of XP at the pre-run level
    const prevFrac = prevPlayerLevel + Math.max(0, xpResult.startPct);
    const nowFrac = playerLevel + (playerLevel >= lastTierLvl ? 0 : playerXP / xpNeeded);
    const startPct = Math.min(100, Math.max(0, ((prevFrac - firstTierLvl) / totalRange) * 100));
    const endPct = Math.min(100, Math.max(0, ((nowFrac - firstTierLvl) / totalRange) * 100));

    // Find what tier the player is at now vs before
    let prevTierLabel = 'Stock', newTierLabel = 'Stock', crossedTier = null;
    for (const t of HANDLING_TIERS) {
      if (prevPlayerLevel >= t.level) prevTierLabel = t.label || 'Stock';
      if (playerLevel >= t.level) newTierLabel = t.label || 'Stock';
    }
    // Did we cross a tier boundary this run?
    for (const t of HANDLING_TIERS) {
      if (t.label && prevPlayerLevel < t.level && playerLevel >= t.level) {
        crossedTier = t;
      }
    }

    if (_handlingTierEl) _handlingTierEl.textContent = newTierLabel;

    // Animate the bar
    _handlingBarEl.style.transition = 'none';
    _handlingBarEl.style.width = startPct + '%';
    _handlingBarEl.classList.remove('handling-comet');

    if (crossedTier) {
      // Find the % where the tier boundary sits
      const tierPct = Math.min(100, ((crossedTier.level - firstTierLvl) / totalRange) * 100);
      // Phase 1: fill to tier boundary
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        _handlingBarEl.classList.add('handling-comet');
        _handlingBarEl.style.transition = 'width 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        _handlingBarEl.style.width = tierPct + '%';
      }); });
      // Phase 2: flash at tier boundary, then continue to final position
      setTimeout(() => {
        const barWrap = _handlingBarEl.parentElement;
        if (barWrap) barWrap.classList.add('handling-flash');
        if (_handlingTierEl) _handlingTierEl.textContent = crossedTier.label;
        setTimeout(() => {
          if (barWrap) barWrap.classList.remove('handling-flash');
          _handlingBarEl.style.transition = 'width 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          _handlingBarEl.style.width = endPct + '%';
          setTimeout(() => _handlingBarEl.classList.remove('handling-comet'), 900);
        }, 400);
      }, 750);
      // Show upgrade text
      if (_handlingUpgradeWrap) {
        setTimeout(() => {
          _handlingUpgradeWrap.classList.remove('hidden');
          _handlingUpgradeWrap.querySelector('.go-handling-upgrade-text').textContent = crossedTier.label.toUpperCase();
        }, 800);
      }
    } else {
      // Normal fill with comet
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        _handlingBarEl.classList.add('handling-comet');
        _handlingBarEl.style.transition = 'width 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        _handlingBarEl.style.width = endPct + '%';
      }); });
      setTimeout(() => _handlingBarEl.classList.remove('handling-comet'), 1300);
      if (_handlingUpgradeWrap) _handlingUpgradeWrap.classList.add('hidden');
    }
  }

  // ── Save Me button setup (fuel cells) ──
  const baseFuelCost = [50, 100, 150, 200][Math.min(state.saveMeCount, 3)];
  const saveMeDiscount = getStatValue('saveme');
  const saveMeFuelCost = Math.floor(baseFuelCost * (1 - saveMeDiscount));
  const currentFuel = loadFuelCells();
  const canAfford = currentFuel >= saveMeFuelCost;
  const _saveMeWrap = document.getElementById('go-saveme-wrap');
  const _saveMeBtn = document.getElementById('saveme-btn');
  const _saveMeCostEl = document.getElementById('saveme-cost');
  if (_saveMeCostEl) _saveMeCostEl.innerHTML = _FUEL_SVG + ' ' + saveMeFuelCost;
  if (_saveMeBtn) {
    _saveMeBtn.disabled = !canAfford;
    // Remove old listener, add fresh one
    const newBtn = _saveMeBtn.cloneNode(true);
    _saveMeBtn.parentNode.replaceChild(newBtn, _saveMeBtn);
    newBtn.disabled = !canAfford;
    newBtn.addEventListener('click', () => {
      if (!_gameOverTapReady) return; // cooldown guard
      if (_retryPending) return; // already fading
      if (loadFuelCells() < saveMeFuelCost) return;
      // Deduct fuel cells
      saveFuelCells(loadFuelCells() - saveMeFuelCost);
      updateTitleFuelCells();
      state.saveMeCount++;
      _retryPending = true;
      const fadeEl = document.getElementById('retry-fade');
      fadeEl.style.opacity = '1'; // fade to black
      setTimeout(() => {
        _retryPending = false;
        // Reset score only — distance keeps accumulating as reward for survival
        state.score = 0;
        state.playerScore = 0;
        state.startedFromL1 = false;
        // Resume the run
        state.phase = 'playing';
        shipGroup.visible = true;
        _killExplosion();
        // Kill death camera orbit
        _expCamOrbitActive = false;
        _expCamOrbitT = 0;
        if (_gameOverDelayTimer) { clearTimeout(_gameOverDelayTimer); _gameOverDelayTimer = null; }
        state.invincibleTimer = 3.0;
        state.shipX = 0;
        state.shipVelX = 0;
        shipGroup.position.x = 0;
        // Wipe everything on screen and reset all mechanic state
        _clearAllMechanics();
        state.deathRunRestBeat = 1.5; // brief clear before wave director picks next mechanic
        // Corridor death: restart that corridor from scratch
        if (state._deathCorridorType === 'l3') {
          state.corridorMode = true; state.corridorSpawnZ = -7; state.corridorRowsDone = 0; state.corridorSineT = 0;
        } else if (state._deathCorridorType === 'l4') {
          state.l4CorridorActive = true; state.l4SpawnZ = -7; state.l4RowsDone = 0; state.l4SineT = 0;
        } else if (state._deathCorridorType === 'l5') {
          state.l5CorridorActive = true; state.l5CorridorSpawnZ = -7; state.l5CorridorRowsDone = 0;
        }
        state.invincibleSpeedActive = false; // no speed boost, just invincible visual
        state.invincibleGrace = 3.0;
        document.getElementById('gameover-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
        // Position camera at establishing shot (same as retry sweep)
        killThrusterSputter();
        state.introActive = true; // block obstacle spawning during sweep
        state.thrusterPower = 1;
        shipGroup.position.y = _hoverBaseY;
        state._introLiftActive = false;
        cameraPivot.position.copy(_RETRY_CAM_START);
        camera.rotation.set(0, 0, 0);
        camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
        camera.fov = _RETRY_FOV_START;
        camera.updateProjectionMatrix();
        // Start the sweep
        _retrySweepActive = true;
        _retrySweepT = 0;
        _retrySweepThrusterFired = false;
        playRetryWhoosh();
        // Re-engage the correct music track for wherever we are in the run
        musicFadeTo(currentGameTrack(), 1500);
        // Fade from black
        fadeEl.style.opacity = '0';
      }, 180); // wait for fade-to-black
    });
  }

  // Show NEW BEST banner only when player actually beat their record
  const _bestWrap = document.getElementById('go-best-wrap');
  if (_bestWrap) {
    if (isNewBest) {
      _bestWrap.classList.remove('hidden');
      _bestWrap.classList.add('new-best');
      _bestWrap.querySelector('.go-best-label').textContent = 'NEW BEST!';
      _bestWrap.querySelector('.go-best-val').textContent = finalScore;
    } else {
      _bestWrap.classList.add('hidden');
    }
  }
  document.getElementById('hud').classList.add('hidden');
  // Delay game over screen so explosion plays first
  if (_gameOverDelayTimer) clearTimeout(_gameOverDelayTimer);
  _gameOverTapReady = false; // block taps until cooldown
  if (_gameOverTapTimer) clearTimeout(_gameOverTapTimer);
  _gameOverDelayTimer = setTimeout(() => {
    _gameOverDelayTimer = null;
    document.getElementById('gameover-screen').classList.remove('hidden');
    // Re-trigger staggered animations by forcing reflow
    document.querySelectorAll('.go-anim').forEach(el => {
      el.style.animation = 'none';
      el.offsetHeight; // force reflow
      el.style.animation = '';
    });
    // Start tap cooldown AFTER screen appears
    _gameOverTapTimer = setTimeout(() => { _gameOverTapReady = true; }, _GO_TAP_COOLDOWN);
  }, _EXP_DURATION * 1000);

  // ── UPGRADES UNLOCKED banner (one-time, game over screen) ──
  if (!localStorage.getItem('jh_upgrades_unlocked_shown')) {
    const coins = loadCoinWallet();
    const owned = JSON.parse(localStorage.getItem('jh_owned_skins') || '["RUNNER"]');
    const canBuy = SHIP_SKINS.some(s => s.price > 0 && !owned.includes(s.name) && coins >= s.price)
      || Object.entries(POWERUP_UPGRADES).some(([id, up]) => {
           const tier = loadUpgradeTier(id);
           return tier < up.tiers.length && coins >= getUpgradeCost(id, tier);
         });
    if (canBuy) {
      localStorage.setItem('jh_upgrades_unlocked_shown', '1');
      const banner = document.createElement('div');
      banner.textContent = 'UPGRADES UNLOCKED';
      banner.style.cssText = `
        position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(0.5);
        color:#0ff;font-family:inherit;font-size:clamp(20px,5vw,36px);font-weight:700;
        letter-spacing:4px;text-transform:uppercase;white-space:nowrap;
        text-shadow:0 0 20px rgba(0,255,255,0.6),0 0 40px rgba(0,255,255,0.3);
        background:rgba(0,0,0,0.7);border:1px solid rgba(0,255,255,0.4);
        padding:16px 32px;border-radius:8px;z-index:9999;
        opacity:0;transition:opacity 0.4s ease,transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
        pointer-events:none;
      `;
      document.body.appendChild(banner);
      requestAnimationFrame(() => {
        banner.style.opacity = '1';
        banner.style.transform = 'translate(-50%,-50%) scale(1)';
      });
      setTimeout(() => {
        banner.style.opacity = '0';
        banner.style.transform = 'translate(-50%,-50%) scale(0.9)';
      }, 2800);
      setTimeout(() => banner.remove(), 3400);
    }
  }

  // ── Leaderboard submit (only if started from L1) ──────────────────────────
  {
    const _submitDiv = document.getElementById('score-submit');
    const _oldMsg = document.getElementById('score-saved-msg');
    if (_oldMsg) _oldMsg.remove();

    if (!state.isDeathRun) {
      _submitDiv.classList.add('hidden');
    } else {

    const _savedName = window._LS.getItem('jet-horizon-player-name') || '';

    const _showSaved = () => {
      _submitDiv.classList.add('hidden');
      const _msg = document.createElement('div');
      _msg.id = 'score-saved-msg';
      _msg.className = 'score-saved-msg go-anim';
      _msg.style.setProperty('--d', '4');
      _msg.textContent = 'SCORE SAVED \u2713';
      _submitDiv.parentNode.insertBefore(_msg, _submitDiv);
      // Fade out after 2s
      setTimeout(() => { _msg.style.opacity = '0'; _msg.style.transition = 'opacity 0.6s'; }, 2000);
    };

    if (_savedName) {
      // Returning player — auto-submit silently
      _submitDiv.classList.add('hidden');
      submitScore(_savedName, finalScore).then(_showSaved);
    } else {
      // First time — show compact name input
      _submitDiv.classList.remove('hidden');

      const _oldInput = document.getElementById('player-name');
      const _newInput = _oldInput.cloneNode(true);
      _oldInput.parentNode.replaceChild(_newInput, _oldInput);
      _newInput.value = '';

      const _oldConfirm = document.getElementById('submit-confirm-btn');
      const _newConfirm = _oldConfirm.cloneNode(true);
      _oldConfirm.parentNode.replaceChild(_newConfirm, _oldConfirm);

      const _doSubmit = async () => {
        const _name = _newInput.value.trim();
        if (!_name) { _newInput.focus(); return; }
        _newConfirm.disabled = true;
        _newConfirm.textContent = '...';
        window._LS.setItem('jet-horizon-player-name', _name);
        await submitScore(_name, finalScore);
        _showSaved();
      };

      _newConfirm.addEventListener('click', _doSubmit);
      _newInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); _doSubmit(); }
      });
    }
    } // end else (startedFromL1)
  }
}

// Tint the neon gradient on an obstacle group to a given hex color
function tintObsColor(obs, hex) {
  const _mc = obs.userData._meshes;
  for (let mi = 0; mi < _mc.length; mi++) {
    const mat = _mc[mi].material;
    if (mat.uniforms && mat.uniforms.uNeon) {
      mat.uniforms.uNeon.value.setHex(hex);
    } else if (mat.blending === THREE.AdditiveBlending) {
      mat.color.setHex(hex);
    }
  }
}
// Restore neon gradient to its original baked color
function resetObsColor(obs) {
  const _mc = obs.userData._meshes;
  for (let mi = 0; mi < _mc.length; mi++) {
    const mat = _mc[mi].material;
    if (mat.uniforms && mat.uniforms.uNeon && mat.userData.baseColor !== undefined) {
      mat.uniforms.uNeon.value.setHex(mat.userData.baseColor);
    } else if (mat.userData.baseColor !== undefined && mat.color) {
      mat.color.setHex(mat.userData.baseColor);
    }
  }
}

function returnObstacleToPool(obs) {
  obs.userData.isCorridor = false;
  obs.userData.isEcho = false;
  obs.userData.active = false;
  obs.visible = false;
  if (obs.userData.slalomScaled) {
    obs.scale.set(1, 1, 1);  // reset fat slalom scale
    obs.userData.slalomScaled = false;
  }
  // Reset baseOpacity to 1.0 so recycled cones aren't stuck dim from echo duty
  const _mc = obs.userData._meshes;
  for (let mi = 0; mi < _mc.length; mi++) _mc[mi].material.userData.baseOpacity = 1.0;
  resetObsColor(obs);  // always restore original color on return
}

function returnPowerupToPool(pu) {
  pu.userData.active = false;
  pu.visible = false;
  pu.position.set(0, -9999, 0);  // park far off-screen so it can't ghost-render near ship
  pu.scale.setScalar(1);
}

// ═══════════════════════════════════════════════════
//  UPDATE LOOP
// ═══════════════════════════════════════════════════
const FIXED_DT = 1 / 60;
let accumulator = 0;
const clock = new THREE.Clock();
let scoreTick = 0;

function update(dt) {
  if (state.phase !== 'playing') return;
  if (state._ringFrozen) return; // ring tuner freeze — scene renders but game logic paused
  // Gyroscope input — mobile only, no-op on desktop

  state.elapsed += dt;  // real-time accumulator for smooth animations
  _drUpdateDebugHud();
  state.levelElapsed = (state.levelElapsed || 0) + dt;  // time spent in current level

  const effectiveSpeed = state.invincibleSpeedActive
    ? state.speed * 1.8
    : state.speed;

  // ── Ship movement
  const _introBlock = state.introActive || state._introLiftActive;
  if (_introBlock) { state.shipX = 0; state.shipVelX = 0; shipGroup.position.x = 0; }
  const steerLeft  = !_introBlock && (keys['ArrowLeft']  || keys['a'] || keys['A'] || touch.left);
  const steerRight = !_introBlock && (keys['ArrowRight'] || keys['d'] || keys['D'] || touch.right);
  // Physics ramp: starts floaty at L1, gradually snappier by L5
  // Death Run: lateral physics matches independent speed ramp (not vibe)
  // DR: snappiness ramps L2→L5 but caps at L5 even as speed keeps climbing
  const _physIdx = _physLevelOverride >= 0 ? _physLevelOverride
    : state.isDeathRun ? Math.min(state.deathRunSpeedTier + 1, 4) : state.currentLevelIdx;
  const _lvlT   = _physIdx / (LEVELS.length - 1); // 0 at L1, 1 at L5
  const _snap   = _lvlT * _lvlT;  // ease-in so early levels stay floaty longer
  // Handling tier: 0.0 at max upgrade (crisp), 1.0 at stock (loose)
  const _handlingDrift = getHandlingDrift();
  // Low handling = HIGH ACCEL (over-responsive, hard to control)
  // High handling = moderate ACCEL (precise, predictable)
  // ACCEL: low tier = sluggish (60%), high tier = snappy (100%)
  const ACCEL = (_accelBase + _snap * _accelSnap) * (0.75 + (1 - _handlingDrift) * 0.25);
  // DECEL: low tier = long slide, high tier = brief slide
  const DECEL_BASE = 10 + _snap * 26;
  const DECEL = DECEL_BASE * (_decelBasePct + (1 - _handlingDrift) * (_decelFullPct - _decelBasePct));
  const MAX_VEL = _maxVelBase + _snap * _maxVelSnap;

  // Tilt penalty: only kicks in after a 2s grace period of being tilted
  const TILT_GRACE = 2.0;  // seconds before penalty starts
  if (Math.abs(state.rollAngle) > 0.1) {
    state.tiltTimer = Math.min(state.tiltTimer + dt, TILT_GRACE + 1.0);
  } else {
    state.tiltTimer = Math.max(0, state.tiltTimer - dt * 3);  // resets quickly when upright
  }
  // penaltyT: 0 during grace period, ramps to 1 over next second after grace ends
  const penaltyT    = Math.max(0, Math.min(1, (state.tiltTimer - TILT_GRACE)));
  const tiltPenalty = 0.35 + 0.65 * Math.cos(state.rollAngle);  // 1.0 upright → 0.35 sideways
  const tiltFactor  = 1.0 - penaltyT * (1.0 - tiltPenalty);    // lerp from no penalty → full penalty

  // Counter-steer: when input opposes velocity, multiply ACCEL so direction reverses fast
  const _counterSteer = (steerLeft && state.shipVelX > 0) || (steerRight && state.shipVelX < 0);
  const _csBoost = _counterSteer ? 3.0 : 1.0;
  if (steerLeft)       state.shipVelX -= ACCEL * _csBoost * tiltFactor * dt;
  else if (steerRight) state.shipVelX += ACCEL * _csBoost * tiltFactor * dt;
  else                 state.shipVelX *= Math.max(0, 1 - DECEL * dt); // slide only when not steering

  const tiltMaxVel = MAX_VEL * tiltFactor;
  state.shipVelX = Math.max(-tiltMaxVel, Math.min(tiltMaxVel, state.shipVelX));
  state.shipX   += state.shipVelX * dt;


  // Camera pivot follows ship X
  camTargetX = state.shipX;
  // ── Retry sweep: establishing shot → chase cam ──
  if (_retrySweepActive) {
    _retrySweepT = Math.min(1, _retrySweepT + dt / _RETRY_SWEEP_DUR);
    // Ease-in-out cubic
    const st = _retrySweepT < 0.5
      ? 4 * _retrySweepT * _retrySweepT * _retrySweepT
      : 1 - Math.pow(-2 * _retrySweepT + 2, 3) / 2;
    // Target: normal chase cam position
    const _isLandscapeRS = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && window.innerWidth > window.innerHeight;
    const _rsCamY = (_isLandscapeRS ? 2.0 : 2.8) + _camPivotYOffset;
    const _rsCamZ = 9 + _camPivotZOffset;
    cameraPivot.position.x = THREE.MathUtils.lerp(_RETRY_CAM_START.x, 0, st);
    cameraPivot.position.y = THREE.MathUtils.lerp(_RETRY_CAM_START.y, _rsCamY, st);
    cameraPivot.position.z = THREE.MathUtils.lerp(_RETRY_CAM_START.z, _rsCamZ, st);
    // FOV narrows from wide establishing to base
    camera.fov = THREE.MathUtils.lerp(_RETRY_FOV_START, _baseFOV, st);
    camera.updateProjectionMatrix();
    // Trigger quiet thruster ignition as camera arrives at ship
    if (_retrySweepT >= 0.8 && !_retrySweepThrusterFired) {
      _retrySweepThrusterFired = true;
      const _rsEng = document.getElementById('engine-roar');
      if (_rsEng && !state.muted) {
        _ensureCtxRunning();
        _rsEng.currentTime = 0;
        _rsEng.volume = 0.07 * (typeof sfxMult === 'function' ? sfxMult() : 1);
        _rsEng.play().catch(() => {});
      }
    }
    if (_retrySweepT >= 1) {
      _retrySweepActive = false;
      _retryIsFromDead = false;
      _retrySweepThrusterFired = false;
      state.introActive = false; // unblock obstacle spawning
      state.thrusterPower = 1;
      // Ensure camera is exactly at chase cam
      cameraPivot.position.set(0, _rsCamY, _rsCamZ);
      camera.fov = _baseFOV;
      camera.updateProjectionMatrix();
    }
  } else if (!_expCamOrbitActive) {
    // Normal gameplay camera (death cam handled in animate())
    cameraPivot.position.x = camTargetX;
    // Camera Y partially follows ship altitude
    const _isLandscapeCam = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && window.innerWidth > window.innerHeight;
    const camBaseY = _isLandscapeCam ? 2.0 : 2.8;
    const shipAlt = shipGroup.position.y - _hoverBaseY;
    const camTargetY = camBaseY + _camPivotYOffset + shipAlt * _camYFollow;
    cameraPivot.position.y = THREE.MathUtils.lerp(cameraPivot.position.y, camTargetY, 6 * dt);
    cameraPivot.position.z = 9 + _camPivotZOffset;
  }

  // ── Camera roll: tilt screen when steering (like original Jet Slalom)
  // camera.rotation is in LOCAL space of pivot; lookAt was already set at init.
  // We only change rotation.z (roll) — x/y stay from the initial lookAt.
  const _maxVelNow = _maxVelBase + _snap * _maxVelSnap;
  const targetCamRoll = -(state.shipVelX / Math.max(1, _maxVelNow)) * 0.4;  // normalized: ~10° max regardless of vel cap
  cameraRoll = THREE.MathUtils.lerp(cameraRoll, targetCamRoll, 5 * dt);
  camera.rotation.z = cameraRoll;


  // Detect turn release — trigger wobble when player stops steering
  const isSteering = keys['ArrowLeft'] || keys['a'] || keys['A'] ||
                     keys['ArrowRight'] || keys['d'] || keys['D'] ||
                     touch.left || touch.right;
  // Cancel wobble instantly when player starts steering again
  if (isSteering && state.wobbleAmp > 0) state.wobbleAmp = 0;


  // Wobble kicks in at L2+ in campaign, or always in DR (uses deathRunSpeedTier instead of currentLevelIdx)
  if (state.wasSteering && !isSteering && (state.isDeathRun || state.currentLevelIdx >= 1) && Math.abs(state.shipVelX) > 4) {
    // velRatio: 0 at threshold (4), 1 at absolute max (18) — fixed scale so it works at all levels
    const velRatio = (Math.abs(state.shipVelX) - 4) / 14;
    const clamped  = Math.max(0, Math.min(1, velRatio));
    const _driftMult = getHandlingDrift() * 2.5; // stock drift=1.0 → 2.5x wobble, full control drift=0 → 0 (no wobble)
    // Speed also amplifies wobble at low handling — faster = wilder at low tier
    const _speedRatio = Math.min(1, (state.speed - BASE_SPEED) / (BASE_SPEED * 1.5));
    const _speedWobble = 1.0 + _speedRatio * _wobbleSpeedMult * getHandlingDrift();
    state.wobbleAmp   = (0.02 + clamped * clamped * _wobbleMaxAmp) * _driftMult * _speedWobble;
    // Trigger roll overshoot — ship banks past target then bounces back
    state._overshootVel = (state._overshootVel || 0) + Math.sign(state.shipVelX) * _overshootAmt * clamped * getHandlingDrift();
    state.wobbleDir   = Math.sign(state.shipVelX);
    state.wobblePhase = 0;
    // Release whoosh — only on hard turns held > 1.5s
    const holdSec = (performance.now() - state.steerStartTime) / 1000;
    if (holdSec > 1.5) {
      playWhooshRelease(Math.sign(state.shipVelX), holdSec);
    }
  }
  // Lane-change whoosh on turn start + track hold time
  if (!state.wasSteering && isSteering) {
    state.steerStartTime = performance.now();
    const dir = (keys['ArrowLeft'] || keys['a'] || keys['A'] || touch.left) ? -1 : 1;
    const velIntensity = Math.min(1, Math.abs(state.shipVelX) / 14);
    playWhoosh(dir, Math.max(0.3, velIntensity));
  }
  state.wasSteering = isSteering;

  // Decay wobble with a damped sine — completely isolated from camera
  if (state.wobbleAmp > 0.001) {
    state.wobblePhase += dt * 16;          // oscillation speed
    state.wobbleAmp   *= (1 - dt * _wobbleDamping);    // damping — tunable via flight tuner
    if (state.wobbleAmp < 0.001) state.wobbleAmp = 0;
  }
  const wobbleOffset = Math.sin(state.wobblePhase) * state.wobbleAmp * state.wobbleDir;

  // Bank the ship — track velocity while steering, decay to flat on release.
  if (isSteering) {
    // If steering opposes current bank, zero it so we never dip the wrong way
    if ((steerLeft && _bankVelX > 0) || (steerRight && _bankVelX < 0)) _bankVelX = 0;
    _bankVelX += (state.shipVelX - _bankVelX) * Math.min(1, 20 * dt);
  } else {
    _bankVelX *= Math.max(0, 1 - 12 * dt); // decay to flat, no pull from shipVelX
  }
  // Overshoot spring — decays each frame, triggered on steering release
  state._overshootPos = (state._overshootPos || 0);
  state._overshootVel = (state._overshootVel || 0);
  if (isSteering) { state._overshootPos *= 0.8; state._overshootVel = 0; }
  state._overshootPos += state._overshootVel * dt;
  state._overshootVel -= state._overshootPos * 40 * dt; // spring constant
  state._overshootVel *= Math.max(0, 1 - _overshootDamp * dt); // damping
  const targetRoll = -_bankVelX * _bankMax + state._overshootPos;
  if (state.rollAngle !== 0 || state.rollHeld) {
    // Roll is active — drive rotation.z directly from rollAngle
    shipGroup.rotation.z = state.rollAngle;
  } else {
    const _rollTarget = targetRoll + wobbleOffset + _shipRotZOffset;
    const _crossingZero = (shipGroup.rotation.z > 0.01 && _rollTarget < -0.01) || (shipGroup.rotation.z < -0.01 && _rollTarget > 0.01);
    const _lerpSpeed = _crossingZero ? _bankSmoothing * 3 : _bankSmoothing;
    shipGroup.rotation.z = THREE.MathUtils.lerp(shipGroup.rotation.z, _rollTarget, Math.min(1, _lerpSpeed * dt));
  }
  // ── Pitch tilt: nose dips on accel, lifts on decel (when grounded) ──
  const speedDelta = (state.speed - _prevSpeed) / dt;
  _prevSpeed = state.speed;
  let targetPitch = 0;
  if (!_jumpActive) {
    if (speedDelta > 0.5) {
      targetPitch = -_pitchForwardMax * Math.min(1, speedDelta / 50);
    } else if (speedDelta < -0.5) {
      targetPitch = _pitchBackMax * Math.min(1, Math.abs(speedDelta) / 50);
    }
  }
  _pitchSmooth += (targetPitch - _pitchSmooth) * Math.min(1, dt * _pitchSmoothing);

  // ── Alt ship animation drive (wing bank + engine boost) ──
  if (_altShipActive && _altShipMixer) {
    const _roll = shipGroup.rotation.z || 0; // negative = banking right, positive = banking left
    const _bankThresh = 0.08; // minimum roll before triggering wing anim
    const _playClip = (name, timescale) => {
      const a = _altShipClips[name];
      if (!a) return;
      if (a.timeScale < 0) { a.timeScale = timescale || 1; } // was reversing, switch to forward
      if (!a.isRunning()) { a.reset(); a.timeScale = timescale || 1; a.play(); }
    };
    const _stopClip = (name) => {
      const a = _altShipClips[name];
      if (!a || !a.isRunning()) return;
      // Play in reverse to smoothly return to rest pose instead of snapping
      if (a.timeScale > 0) {
        a.timeScale = -a.timeScale;
        a.paused = false;
      }
    };
    // Wing + airbrake animations: bank left -> left wings down, right wings up, airbrakes deploy
    if (_roll > _bankThresh) {
      // Banking left
      _playClip('Wing_Down_A_LeftAction', 1.5);
      _playClip('Wing_Up_A_RightAction', 1.5);
      _stopClip('Wing_Up_A_LeftAction');
      _stopClip('Wing_Down_A_RightAction');
      // Airbrakes: left side deploys down, right side deploys up (asymmetric drag for banking)
      _playClip('Airbrake_Down_LeftAction', 1.2);
      _playClip('Airbrake_Up_RightAction', 1.2);
      _stopClip('Airbrake_UP_LeftAction_2');
      _stopClip('Airbrake_Down_RightAction');
    } else if (_roll < -_bankThresh) {
      // Banking right
      _playClip('Wing_Down_A_RightAction', 1.5);
      _playClip('Wing_Up_A_LeftAction', 1.5);
      _stopClip('Wing_Up_A_RightAction');
      _stopClip('Wing_Down_A_LeftAction');
      // Airbrakes: right side deploys down, left side deploys up
      _playClip('Airbrake_Down_RightAction', 1.2);
      _playClip('Airbrake_UP_LeftAction_2', 1.2);
      _stopClip('Airbrake_Up_RightAction');
      _stopClip('Airbrake_Down_LeftAction');
    } else {
      // Neutral — return wings + airbrakes to default
      _stopClip('Wing_Down_A_LeftAction');
      _stopClip('Wing_Down_A_RightAction');
      _stopClip('Wing_Up_A_LeftAction');
      _stopClip('Wing_Up_A_RightAction');
      _stopClip('Airbrake_Down_LeftAction');
      _stopClip('Airbrake_Down_RightAction');
      _stopClip('Airbrake_Up_RightAction');
      _stopClip('Airbrake_UP_LeftAction_2');
    }
  }

  // ── Thrust-based vertical flight ──
  {
    const altitude = shipGroup.position.y - _hoverBaseY;

    if (_thrustHeld && altitude < _thrustMaxHeight) {
      const ceilingFactor = 1.0 - Math.pow(altitude / _thrustMaxHeight, 2);
      _jumpVelY += _thrustPower * Math.max(ceilingFactor, 0.05) * dt;
      _jumpActive = true;
      _jumpVelY -= _thrustGravity * dt;
    } else {
      _jumpVelY -= _fallSpeed * dt;
    }

    _jumpVelY *= Math.pow(_thrustDamping, dt * 60);
    shipGroup.position.y += _jumpVelY * dt;

    // Hard floor + landing
    if (shipGroup.position.y <= _hoverBaseY) {
      shipGroup.position.y = _hoverBaseY;
      if (_jumpActive && _jumpVelY <= 0) {
        _jumpLandingBounceT = _jumpLandingBounce;
      }
      _jumpVelY = Math.max(_jumpVelY, 0);
      _jumpActive = altitude > 0.08; // raised from 0.02 so bob amplitude doesn't trigger jump system
    }

    // Hard ceiling
    if (altitude > _thrustMaxHeight) {
      shipGroup.position.y = _hoverBaseY + _thrustMaxHeight;
      _jumpVelY = Math.min(_jumpVelY, 0);
    }

    // Pitch: thrust overrides speed-based pitch when airborne
    if (_jumpActive) {
      const thrustPitch = Math.max(-0.25, Math.min(0.25, (_jumpVelY / 8.0) * 0.2 * _jumpPitchMult));
      shipGroup.rotation.x = THREE.MathUtils.lerp(shipGroup.rotation.x, thrustPitch, 8 * dt) + _shipRotXOffset;
    } else {
      shipGroup.rotation.x = _pitchSmooth + _shipRotXOffset;
    }

    // Thruster power (skip during intro — let sputter timers control it)
    if (!state.introActive) {
      if (_thrustHeld && _jumpActive) {
        state.thrusterPower = _jumpThrusterFlare;
      } else if (_jumpActive) {
        state.thrusterPower = _jumpVelY > 0 ? 0.7 : 0.3;
      } else {
        state.thrusterPower = 1;
      }
    }

    // Landing bounce decay
    if (!_jumpActive && _jumpLandingBounceT > 0) {
      _jumpLandingBounceT -= dt * 4;
      const bounceY = Math.sin(_jumpLandingBounceT * Math.PI * 3) * 0.03 * _jumpLandingBounceT;
      shipGroup.position.y = _hoverBaseY + bounceY;
      shipGroup.rotation.x = THREE.MathUtils.lerp(shipGroup.rotation.x, _pitchSmooth, 6 * dt);
    }
  }

  // ── Hover bob: subtle sinusoidal float when grounded, suppressed during steering ──
  if (!_jumpActive) {
    const steeringActive = Math.abs(state.shipVelX) > 0.5;
    const bobSteerTarget = steeringActive ? 0 : 1;
    const bobSteerRate = steeringActive ? _bobSteerFadeOut : _bobSteerFadeIn;
    _bobSteerBlend += (bobSteerTarget - _bobSteerBlend) * Math.min(1, dt * bobSteerRate);
    const bobNow = performance.now() / 1000;
    const bobOffset = (_bobFrequency > 0) ? Math.sin(bobNow * _bobFrequency * Math.PI * 2) * _bobAmplitude * _bobBlend * _bobSteerBlend : 0;
    // Hold ship at 0.38 before launch, and during lift animation
    // (skip during retry sweep — ship should stay at _hoverBaseY)
    if (!state._introLiftActive && !_retrySweepActive && (state.introActive || state.elapsed < 0.1)) {
      shipGroup.position.y = 0.38;
    } else if (!state._introLiftActive) {
      shipGroup.position.y = _hoverBaseY + bobOffset;
    }
  }

  // ── Intro takeoff lift ──
  if (state._introLiftActive) {
    const _liftDuration = 2.0; // seconds to reach cruise height
    state._introLiftTimer += dt;
    const _lt = Math.min(1, state._introLiftTimer / _liftDuration);
    // Ease out: fast rise then settles
    const _liftEase = 1 - Math.pow(1 - _lt, 3);
    const _launchY = 0.38;
    state._introShipY = _launchY + (_hoverBaseY - _launchY) * _liftEase;
    // Pitch arc: nose up in first half, settles back to _shipRotXOffset
    const _pitchPeak = -0.18; // nose up (negative = up in Three.js)
    // Pitch up in first half, settle back — never dip below start Y
    const _pitchT = _lt < 0.5 ? _lt * 2 : 2 - _lt * 2;
    const _pitchEase = Math.sin(_pitchT * Math.PI * 0.5);
    shipGroup.rotation.x = _shipRotXOffset + _pitchPeak * _pitchEase;
    shipGroup.position.y = Math.max(0.38, state._introShipY);
    if (_lt >= 1) {
      state._introLiftActive = false;
      shipGroup.rotation.x = _shipRotXOffset;
      // In JL mode, re-lock speed and clear any velocity that built up during prologue
      if (state._jetLightningMode) {
        state.shipVelX = 0;
        state.shipX    = 0;
        shipGroup.position.x = 0;
      }
    }
  }

  // ── Yaw: nose turns into steering direction ──
  const _yawTarget = -state.shipVelX / 14 * _yawMax;
  _yawSmooth += (_yawTarget - _yawSmooth) * Math.min(1, dt * _yawSmoothing);
  shipGroup.rotation.y = _yawSmooth;

  // Micro-turbulence: visual-only random X nudge at low handling/high speed
  const _turbNudge = _turbulence > 0 ? (Math.random() - 0.5) * _turbulence * getHandlingDrift() * (state.speed / BASE_SPEED) : 0;
  shipGroup.position.x = state.shipX + _turbNudge;
  // laserPivot X is set per-frame in the laser update block (T4/T5 only)

  // Sync touch roll into rollHeld state each frame
  // Toggle mode: rollToggle stays true until swipe-down
  if (touch.rollToggle) { state.rollHeld = true; state.rollDir = -1; }
  else if (touch.rollUp)   { state.rollHeld = true; state.rollDir = -1; }
  else if (touch.rollDown) { state.rollHeld = true; state.rollDir =  1; }
  else if (!keys['ArrowUp'] && !keys['ArrowDown']) { state.rollHeld = false; }

  // Hold-to-spin — pure Z-axis rotation, no lateral boost
  // Up/down spin the ship orientation; left/right handle all movement
  {
    // Roll speed scales with level snap — floaty at L1, snappy at L5 (mirrors steering feel)
    const SPIN_SPEED   = (1.2 + _snap * 2.3) * Math.PI;  // ~216°/s floaty → ~630°/s snappy
    const RETURN_SPEED = SPIN_SPEED * 1.5;
    const MAX_ANGLE    = Math.PI / 2;     // 90° max — fully sideways (knife edge)

    if (state.rollHeld) {
      state.rollAngle += state.rollDir * SPIN_SPEED * dt;
      state.rollAngle  = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, state.rollAngle));
    } else {
      if (Math.abs(state.rollAngle) > 0.01) {
        const returnDir  = -Math.sign(state.rollAngle);
        const newAngle   = state.rollAngle + returnDir * RETURN_SPEED * dt;
        // Stop exactly at zero — don't overshoot
        state.rollAngle  = Math.sign(newAngle) !== Math.sign(state.rollAngle) ? 0 : newAngle;
      } else {
        state.rollAngle = 0;
        state.rollDir   = 0;
      }
    }
  }

  // Galaxy flythrough: scroll particles past the ship
  updateGalaxyScroll(dt);

  // Exhaust cone animation removed — cones deleted

  // Ship hull emissive — static, no pulse (removed to prevent transparency issues)



  // Thruster particles
  const isAccel = (keys['ArrowLeft'] || keys['a'] || keys['A'] || keys['ArrowRight'] || keys['d'] || keys['D'] || touch.left || touch.right) ? 1.0 : 0.0;
  updateThrusters(dt, state.shipX, shipGroup.position.y, shipGroup.position.z, isAccel);

  updateL5Dust(dt);
  updateShards(dt);

  // ── Distance accumulation (speed × time, not reset on repair)
  if (!state.introActive && state.phase === 'playing') {
    state.distance = (state.distance || 0) + effectiveSpeed * dt;
  }

  // ── Score ticking (internal level-threshold score)
  if (!state.introActive) scoreTick += dt;
  if (scoreTick > 0.4) {
    scoreTick = 0;
    state.score += state.multiplier + getStatValue('scoremult');
    document.getElementById('hud-speed').textContent = `${(effectiveSpeed / BASE_SPEED).toFixed(1)}x`;
    checkLevelUp();
  }

  // In-run mission toast check (every 2s)
  state._missionCheckTimer = (state._missionCheckTimer || 0) + dt;
  if (state._missionCheckTimer >= 2) {
    state._missionCheckTimer = 0;
    const _ladderPos = loadLadderPos();
    if (_ladderPos < MISSION_LADDER.length && !state._missionToasted) {
      const _rung = MISSION_LADDER[_ladderPos];
      if (_rung.type === 'mission') {
        const _rs = {
          score: Math.floor(state.playerScore), coins: state.sessionCoins,
          powerups: state.sessionPowerups || 0, shields: state.sessionShields || 0,
          lasers: state.sessionLasers || 0, invincibles: state.sessionInvincibles || 0,
          isDR: state.isDeathRun, drTier: state.deathRunSpeedTier || 0,
        };
        const _lt = loadLifetimeStats();
        const _tmpLt = { coins: _lt.coins + _rs.coins, score: _lt.score + _rs.score, runs: _lt.runs + 1, powerups: _lt.powerups + _rs.powerups };
        if (_rung.check(_rs, _tmpLt)) {
          state._missionToasted = true;
          showMissionToast(_rung.desc);
        }
      }
    }
  }

  // ── Player-facing score tick (distance-based, fast counter)
  if (!state.l5EndingActive && !state.introActive) {
    const lvlMult = [1, 1.5, 2, 3, 4][state.currentLevelIdx] || 1;
    // Player level score bonus
    const _pLvl = loadPlayerLevel();
    const _lvlScoreMult = _pLvl >= 15 ? 1.6 : _pLvl >= 10 ? 1.5 : _pLvl >= 5 ? 1.2 : 1.0;
    state.playerScore += 8 * lvlMult * _lvlScoreMult * dt;
  }
  document.getElementById('hud-score').textContent = Math.floor(state.playerScore);

  // ── Corridor bend detection (reset near-miss allowance on direction change)
  if (state.corridorMode || state.l4CorridorActive || state.l5CorridorActive) {
    const curCenter = state.corridorGapCenter || 0;
    const delta = curCenter - state.prevCorridorCenter;
    const curDir = delta > 0.1 ? 1 : delta < -0.1 ? -1 : state.prevCorridorDir;
    if (curDir !== 0 && curDir !== state.prevCorridorDir) {
      state.nearMissBendAllowed = true; // new bend — allow one near-miss
    }
    state.prevCorridorDir = curDir;
    state.prevCorridorCenter = curCenter;
  } else {
    state.prevCorridorDir = 0;
    state.prevCorridorCenter = 0;
  }

  // ── TUTORIAL TICK ──
  if (state._tutorialActive && !state.introActive) {
    state._tutorialTimer += dt;
    const _mob = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Respawn ship at center if dead, keep playing
    if (state.phase === 'dead' || state.phase === 'gameover') {
      state.phase = 'playing';
      state.shipX = 0;
      state.shipVelX = 0;
      state.rollAngle = 0;
      // Reset current obstacle challenge
      for (let _ti = activeObstacles.length - 1; _ti >= 0; _ti--) returnObstacleToPool(activeObstacles[_ti]);
      activeObstacles.length = 0;
      state._tutorialSubStep = 0; // restart current challenge
      state._tutorialConeZ = -80;
      state._tutorialZipZ = -99;
      state._tutorialZipRows = 0;
    }

    // ── STEP -0.5: Terrain walls — vaporwave mountain ridges for testing ──
    if (state._tutorialStep === -0.5) {
      if (!_terrainWalls) {
        _createTerrainWalls();
        // Default off — enable via R tuner
        _terrainWalls.strips.forEach(m => { m.visible = false; });
      }
      _updateTerrainWalls(dt, effectiveSpeed);
    }

    if (state._tutorialStep === 0) {
      // ── STEP 0: Show instruction box, wait for tap ──
      _tutShowInstructionBox(
        'DODGE',
        (_mob ? 'Tap left or right' : 'Use ← → arrow keys') + '<br>to dodge incoming cones',
        '#00eeff',
        () => { state._tutorialStep = 0.5; } // advance to spawning
      );

    } else if (state._tutorialStep === 0.5) {
      // ── STEP 0.5: One cone at a time at ship X, keeps spawning until player dodges ──
      _tutShowHint('DODGE', _mob ? 'Tap left or right' : '← → to dodge', '#00eeff');

      // Spawn one cone directly at ship X if none active
      const _tutCone = activeObstacles.find(o => o.userData._tutCone);
      if (!_tutCone) {
        const obs = getPooledObstacle(0);
        if (obs) {
          obs.position.set(state.shipX, 0, SPAWN_Z); // spawn at ship X
          obs.userData.velX = 0;
          obs.userData.isCorridor = false;
          obs.userData._tutCone = true;
          obs.userData._tutConeSpawnX = state.shipX; // remember where it spawned
          activeObstacles.push(obs);
          state._tutorialConesFired = (state._tutorialConesFired || 0);
        }
      } else {
        // Success = player moved sideways while cone is approaching
        if (Math.abs(state.shipVelX) > 0.5 && !_tutCone.userData._tutCodgeCounted) {
          _tutCone.userData._tutCodgeCounted = true; // count once per cone
          state._tutorialConesFired++;
          // Don't remove cone — let it fly past naturally
          if (state._tutorialConesFired >= 1) {
            _tutChime(); _tutSignal();
            _tutHideText();
            state._tutorialStep = 1.05; // holding step — wait for signal to fade
            state._tutorialTimer = 0;
            state._tutorialConesFired = 0;
            state._tutorialZipZ = -99;
            state._tutorialZipRows = 0;
            state._tutorialZipPassed = false;
            for (let _ti = activeObstacles.length - 1; _ti >= 0; _ti--) returnObstacleToPool(activeObstacles[_ti]);
            activeObstacles.length = 0;
          }
        } else if (_tutCone.position.z >= DESPAWN_Z) {
          returnObstacleToPool(_tutCone);
          activeObstacles.splice(activeObstacles.indexOf(_tutCone), 1);
        }
      }

    } else if (state._tutorialStep === 1.05) {
      state._tutorialTimer = (state._tutorialTimer || 0) + dt;
      if (state._tutorialTimer >= 2.5) {
        const _sf = document.getElementById('tut-signal-flash');
        if (_sf) { _sf.style.transition = 'none'; _sf.style.opacity = '0'; }
        state._tutorialStep = 1; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 1) {
      // ── STEP 1a: YOU WON'T SURVIVE — swipe up to roll ──
      _tutShowInstructionBox(
        'YOU WON\'T SURVIVE',
        'Unless you can adapt. Some walls can\'t be dodged — they must be threaded.<br>' + (_mob ? 'Swipe up to roll.' : 'Press ↑ to roll.'),
        '#ffcc00',
        () => {
          // Wait for player to actually swipe up before advancing
          state._tutorialStep = 1.1;
        }
      );

    } else if (state._tutorialStep === 1.1) {
      // ── STEP 1b: Wait for swipe up (roll) ──
      _tutShowHint('ROLL', _mob ? 'Swipe up' : 'Press ↑', '#ffcc00');
      if (state.rollHeld || Math.abs(state.rollAngle) > 0.3) {
        _tutChime(); _tutSignal();
        _tutHideText();
        state._tutorialStep = 1.15; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 1.15) {
      state._tutorialTimer = (state._tutorialTimer || 0) + dt;
      if (state._tutorialTimer >= 2.5) {
        const _sf = document.getElementById('tut-signal-flash');
        if (_sf) { _sf.style.transition = 'none'; _sf.style.opacity = '0'; }
        state._tutorialStep = 1.2; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 1.2) {
      // ── STEP 1c: LEVEL OUT — swipe down to return flat ──
      _tutShowInstructionBox(
        'LEVEL OUT',
        _mob ? 'Swipe down to come back flat.' : 'Press ↓ to come back flat.',
        '#ffcc00',
        () => { state._tutorialStep = 1.3; }
      );

    } else if (state._tutorialStep === 1.3) {
      // ── STEP 1d: Wait for swipe down (return flat) ──
      _tutShowHint('LEVEL OUT', _mob ? 'Swipe down' : 'Press ↓', '#ffcc00');
      if (Math.abs(state.rollAngle) > 0.3) state._tutWasRolled = true;
      if (state._tutWasRolled && !state.rollHeld && Math.abs(state.rollAngle) < 0.15) {
        _tutChime(); _tutSignal();
        _tutHideText();
        state._tutorialStep = 1.35; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 1.35) {
      state._tutorialTimer = (state._tutorialTimer || 0) + dt;
      if (state._tutorialTimer >= 2.5) {
        const _sf = document.getElementById('tut-signal-flash');
        if (_sf) { _sf.style.transition = 'none'; _sf.style.opacity = '0'; }
        state._tutorialStep = 1.4; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 1.4) {
      // ── STEP 1e: THREAD THE NEEDLE — wall incoming ──
      _tutShowInstructionBox(
        'THREAD THE NEEDLE',
        '',
        '#ffcc00',
        () => { state._tutorialStep = 1.5; state._tutorialZipZ = -7; }
      );

    } else if (state._tutorialStep === 1.5) {
      // ── STEP 1.5: Zip wall spawning ──
      _tutShowHint('THREAD THE NEEDLE', _mob ? 'Roll through the gap' : '↑ to roll', '#ffcc00');

      // One row at a time. Track perp state. When row fully passes, check if passed.
      const _zipRowPresent = activeObstacles.some(o => o.userData._tutZip);
      const _isPerpendicular = state.rollHeld || Math.abs(state.rollAngle) > 0.3 || _jumpActive;

      // Track when row is at ship position
      const _zipAtShip = activeObstacles.some(o => o.userData._tutZip && o.position.z > -6 && o.position.z < DESPAWN_Z);
      if (_zipAtShip && _isPerpendicular) state._tutorialZipPassed = true;

      // Row cleared — evaluate success BEFORE spawning next row
      if (!_zipRowPresent && state._tutorialZipRowSpawned && (state._tutorialZipSuccesses || 0) < 1) {
        if (state._tutorialZipPassed && !state._tutorialZipHit) {
          state._tutorialZipSuccesses = 1;
        }
        state._tutorialZipHit = false;
        state._tutorialZipPassed = false;
      }

      // 1 clean pass = advance (check before spawning)
      if ((state._tutorialZipSuccesses || 0) >= 1 && !_zipRowPresent) {
        _tutChime(); _tutSignal();
        _tutHideText();
        state._tutorialStep = 1.55; state._tutorialTimer = 0;
      } else if (!_zipRowPresent && (state._tutorialZipSuccesses || 0) < 1) {
        // Spawn next row only if not yet succeeded
        state._tutorialZipPassed = false;
        state._tutorialZipRowSpawned = true;
        for (let zi = -LANE_COUNT; zi <= LANE_COUNT; zi++) {
          const obs = getPooledObstacle(Math.floor(Math.random() * 3));
          if (!obs) continue;
          obs.position.set(zi * LANE_WIDTH, 0, SPAWN_Z);
          obs.userData.velX = 0;
          obs.userData.isCorridor = false;
          obs.userData._tutZip = true;
          tintObsColor(obs, 0xffcc00);
          activeObstacles.push(obs);
        }
      }

    } else if (state._tutorialStep === 1.55) {
      state._tutorialTimer = (state._tutorialTimer || 0) + dt;
      if (state._tutorialTimer >= 2.5) {
        const _sf = document.getElementById('tut-signal-flash');
        if (_sf) { _sf.style.transition = 'none'; _sf.style.opacity = '0'; }
        state._tutorialStep = 2; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 2) {
      // ── END CARD ──
      _tutShowInstructionBox(
        'CHASE THE HORIZON',
        'Collect coins, fuel cells, and level up your ship<br>to push further toward the horizon each run',
        '#ff9500',
        () => {
          window._LS.setItem('jh_tutorial_done', '1');
          _tutDestroyOverlay();
          // Play droplet sound on exit
          const _drp = document.getElementById('droplet-sfx');
          if (_drp && !state.muted) { _drp.currentTime = 0; _drp.volume = 0.8; _drp.play().catch(()=>{}); }
          returnToTitle();
        }
      );
    }
    if (!_chaosMode && !state._jetLightningMode) _noSpawnMode = true; // suppress normal spawner during tutorial (chaos/JL override this)
  }

  // ── T5 scanning beam: fan-ray destruction (runs before obstacle loop)
  if (state.laserActive && (state.laserTier || 1) >= 5 && activeObstacles.length > 0) {
    const _rayOrigin = new THREE.Vector3(state.shipX + _lBeamXOff, _lBeamY, shipGroup.position.z);
    const _angle = state._laserScanAngle || 0;
    const _prevAngle = state._laserScanPrevAngle !== undefined ? state._laserScanPrevAngle : _angle;
    // Fan: sweep from prev angle to current angle in 5 steps — catches any cone the beam crossed
    const _steps = 6;
    const _destroyed = new Set();
    for (let _fi = 0; _fi <= _steps; _fi++) {
      const _fa = _prevAngle + (_angle - _prevAngle) * (_fi / _steps);
      const _rayDir = new THREE.Vector3(Math.sin(_fa), 0, -Math.cos(_fa));
      for (let _si = activeObstacles.length - 1; _si >= 0; _si--) {
        if (_destroyed.has(_si)) continue;
        const _sobs = activeObstacles[_si];
        if (_sobs.userData.isCorridor) continue;
        const _op = new THREE.Vector3().copy(_sobs.position).sub(_rayOrigin);
        const _along = _op.dot(_rayDir);
        if (_along < 0) continue; // behind pivot
        // Hit radius scales with distance: wider at range, tighter up close
        const _hitR = Math.max(2.5, Math.min(4.5, 2.5 + _along * 0.02));
        const _closest = new THREE.Vector3().copy(_rayOrigin).addScaledVector(_rayDir, _along);
        if (_closest.distanceTo(_sobs.position) < _hitR) {
          _destroyed.add(_si);
        }
      }
    }
    // Destroy in reverse order so splice indices stay valid
    const _toDestroy = [..._destroyed].sort((a,b) => b - a);
    for (const _si of _toDestroy) {
      const _sobs = activeObstacles[_si];
      spawnConeShards(_sobs.position.x, _sobs.position.y, _sobs.position.z, currentLevelDef.gridColor);
      returnObstacleToPool(_sobs);
      activeObstacles.splice(_si, 1);
      playSFX(220, 0.15, 'sawtooth', 0.2);
    }
    state._laserScanPrevAngle = _angle;
  }

  // ── Power-up timers
  if (state.laserActive) {
    state.laserTimer -= dt;
    const _tier = state.laserTier || 1;
    const lc = state.laserColor || 0xff3300;
    const pulse = 0.8 + Math.sin(state.frameCount * 1.2) * 0.15;

    if (_tier <= 3) {
      // T1-T3: bolt machine gun
      laserPivot.visible = false;
      state.laserBoltTimer = (state.laserBoltTimer || 0) + dt;
      const interval = 1.0 / (state.laserFireRate || _lbFireRate);
      while (state.laserBoltTimer >= interval) {
        state.laserBoltTimer -= interval;
        const lanes = state._laserBoltLanes || _lbLanes;
        const half  = (lanes - 1) / 2;
        for (let li = 0; li < lanes; li++) spawnLaserBolt(li - half);
      }
    } else if (_tier === 4) {
      // T4: static unibeam — pivot at ship nose, no rotation
      laserPivot.visible = true;
      laserMesh.visible = true;
      laserGlowMesh.visible = true;
      laserMat.color.set(0xffffff);
      laserGlowMat.color.setHex(lc);
      laserMat.opacity = pulse;
      laserGlowMat.opacity = pulse * 0.25;
      laserPivot.position.set(state.shipX + _lBeamXOff, _lBeamY, shipGroup.position.z);
      laserPivot.rotation.y = 0;
    } else {
      // T5: scanning unibeam — pivot sits at ship nose, beam sweeps left-right
      laserPivot.visible = true;
      laserMesh.visible = true;
      laserGlowMesh.visible = true;
      laserMat.color.set(0xffffff);
      laserGlowMat.color.setHex(lc);
      laserMat.opacity = pulse;
      laserGlowMat.opacity = pulse * 0.3;
      const _scanMax   = Math.PI / 4;  // ±45°
      const _scanSpeed = 1.2;
      state._laserScanAngle = (state._laserScanAngle || 0) + state._laserScanDir * _scanSpeed * dt;
      if (state._laserScanAngle >= _scanMax)  { state._laserScanAngle = _scanMax;  state._laserScanDir = -1; }
      if (state._laserScanAngle <= -_scanMax) { state._laserScanAngle = -_scanMax; state._laserScanDir =  1; }
      // Pivot is at ship nose — rotating it swings the far end of the beam
      laserPivot.position.set(state.shipX + _lBeamXOff, _lBeamY, shipGroup.position.z);
      laserPivot.rotation.y = state._laserScanAngle;
    }

    if (state.laserTimer <= 0) {
      state.laserActive = false;
      laserMat.opacity = 0;
      laserGlowMat.opacity = 0;
      laserPivot.visible = false;
    }
  }

  // Update laser bolts
  for (let bi = laserBolts.length - 1; bi >= 0; bi--) {
    const bolt = laserBolts[bi];
    if (!bolt.visible) continue;
    bolt.position.x = state.shipX + (bolt.userData._side || 0);
    bolt.position.z += bolt.userData.vel * dt;
    bolt.userData.life -= dt;
    if (bolt.userData.life <= 0 || bolt.position.z < -200) {
      bolt.visible = false;
      continue;
    }
    // Check collision with obstacles
    for (let oi = activeObstacles.length - 1; oi >= 0; oi--) {
      const obs = activeObstacles[oi];
      if (obs.userData.isCorridor) continue;
      const dx = Math.abs(bolt.position.x - obs.position.x);
      const dz = Math.abs(bolt.position.z - obs.position.z);
      if (dx < 1.5 && dz < 2) {
        spawnConeShards(obs.position.x, obs.position.y, obs.position.z, currentLevelDef.gridColor);
        returnObstacleToPool(obs);
        activeObstacles.splice(oi, 1);
        bolt.visible = false;
        playSFX(220, 0.15, 'sawtooth', 0.2);
        break;
      }
    }
  }
  if (state.multiplierTimer > 0) {
    state.multiplierTimer -= dt;
    if (state.multiplierTimer <= 0) { state.multiplier = 1; updateMultiplierHUD(); }
  }
  // Shield duration timer (tier 2+)
  if (state.shieldActive && state.shieldDuration > 0 && state.invincibleTimer <= 0) {
    state.shieldTimer -= dt;
    if (state.shieldTimer <= 0) {
      state.shieldActive = false;
      state._prevShieldHP = 0;
      shieldMesh.visible = false;
      shieldMat.uniforms.uReveal.value = 1.0;
      shieldWireMat.opacity = 0;
      shieldLight.intensity = 0;
      const _shExpSfx = document.getElementById('shield-expire-sfx'); if (_shExpSfx) { _shExpSfx.currentTime = 0; _shExpSfx.play().catch(()=>{}); }
    }
  }
  if (state.invincibleTimer > 0) {
    state.invincibleTimer -= dt;
    const GRACE_PERIOD = state.invincibleGrace || 2.0;
    // Kill speed boost but keep invincibility for grace period
    if (state.invincibleTimer <= GRACE_PERIOD && state.invincibleSpeedActive) {
      state.invincibleSpeedActive = false;
    }
    // RGB chromatic aberration: full split during speed, ramp down during grace
    const BASE_ABERRATION = 0.0015;
    const MAX_ABERRATION = 0.04;
    if (state.invincibleSpeedActive) {
      vignettePass.uniforms.aberration.value = MAX_ABERRATION;
    } else {
      // Grace period: lerp from current toward base
      const t = Math.max(0, state.invincibleTimer / GRACE_PERIOD);
      vignettePass.uniforms.aberration.value = BASE_ABERRATION + (MAX_ABERRATION - BASE_ABERRATION) * t;
    }
    if (state.invincibleTimer <= 0) {
      state.shieldActive = false;
      state.invincibleSpeedActive = false;
      vignettePass.uniforms.aberration.value = BASE_ABERRATION;
      shieldMesh.visible = false; shieldWire.visible = false;
      shieldMat.uniforms.uReveal.value = 1.0;
      shieldWireMat.opacity = 0;
      shieldLight.intensity = 0;
    }
    // Near-miss red flash (skip if invincible rainbow is active)
    if (state.nearMissFlash > 0 && !state.invincibleSpeedActive && shipHullMats.length) {
      const f = state.nearMissFlash;
      const red = new THREE.Color(1.0, 0.15, 0.05);
      for (let i = 0; i < shipHullMats.length; i++) {
        shipHullMats[i].emissive.copy(red);
        shipHullMats[i].emissiveIntensity = f * 2.5;
      }
      state.nearMissFlash = Math.max(0, state.nearMissFlash - dt * 3.0); // ~0.33s decay
    }
    // Gold-rainbow hull cycle while invincible (gold/amber/warm hues only)
    if (state.invincibleSpeedActive && shipHullMats.length) {
      // Full MarioKart rainbow — full HSL rotation at 2 Hz
      const hue     = (state.elapsed * 2.0) % 1.0;
      const c       = new THREE.Color().setHSL(hue, 1.0, 0.55);
      const emissHue = (hue + 0.08) % 1.0;
      const eC      = new THREE.Color().setHSL(emissHue, 1.0, 0.5);
      const eiPulse = 1.4 + Math.sin(state.elapsed * 6 * Math.PI * 2) * 0.6;
      for (let i = 0; i < shipHullMats.length; i++) {
        shipHullMats[i].color.copy(c);
        shipHullMats[i].emissive.copy(eC);
        shipHullMats[i].emissiveIntensity = eiPulse;
      }
      const eHue2 = (hue + 0.5) % 1.0;
      const eC2   = new THREE.Color().setHSL(eHue2, 1.0, 0.6);
      for (let i = 0; i < shipEdgeLines.length; i++) {
        shipEdgeLines[i].color.copy(eC2);
        shipEdgeLines[i].emissive.copy(eC2);
        shipEdgeLines[i].emissiveIntensity = 3.0;
      }
    }
    // Grace period: speed boost ended but still invincible — slow white flash
    if (!state.invincibleSpeedActive && state.shieldActive && state.invincibleTimer > 0 && shipHullMats.length) {
      const flash = 0.5 + 0.5 * Math.sin(state.elapsed * 3 * Math.PI * 2); // ~1.5 Hz pulse
      const c = new THREE.Color(1, 1, 1);
      for (let i = 0; i < shipHullMats.length; i++) {
        shipHullMats[i].color.copy(c);
        shipHullMats[i].emissive.copy(c);
        shipHullMats[i].emissiveIntensity = flash * 1.5;
      }
    }
  }
  if (shipHullMats.length && shipHullMats[0].emissiveIntensity > 0) {
    // Fade back to white when turbo ends
    for (let i = 0; i < shipHullMats.length; i++) {
      shipHullMats[i].color.lerp(new THREE.Color(0xffffff), 0.08);
      shipHullMats[i].emissive.lerp(new THREE.Color(0x000000), 0.08);
      shipHullMats[i].emissiveIntensity = Math.max(0, shipHullMats[i].emissiveIntensity - 0.02);
    }
    // Restore edge lines to current level color
    const _lvlColor = LEVELS[state.currentLevelIdx].gridColor;
    for (let i = 0; i < shipEdgeLines.length; i++) {
      shipEdgeLines[i].color.lerp(_lvlColor, 0.08);
      if (shipEdgeLines[i].emissive) shipEdgeLines[i].emissive.lerp(_lvlColor, 0.08);
    }
  }
  if (state.magnetActive) {
    state.magnetTimer -= dt;
    if (state.magnetTimer <= 0) {
      state.magnetActive = false;
      _stopMagnetWhir();
      magnetRing.visible = false; magnetRing2.visible = false;
      magnetRingMat.opacity = 0;
      magnetRing2.material.opacity = 0;
      magnetLight.intensity = 0;
    } else {
      // Two orthogonal rings orbit around the ship at different angles
      const mt = state.elapsed;
      magnetRing.rotation.x  = mt * 1.8;
      magnetRing.rotation.y  = mt * 0.9;
      magnetRing2.rotation.x = mt * 1.8 + Math.PI * 0.5;
      magnetRing2.rotation.z = mt * 1.2;
      const mPulse = 0.55 + Math.sin(mt * 8) * 0.2;
      magnetRingMat.opacity          = mPulse;
      magnetRing2.material.opacity   = mPulse * 0.7;
      magnetLight.intensity = 1.8 + Math.sin(mt * 6) * 0.8;
    }
  } else {
    magnetRingMat.opacity = 0;
    magnetRing2.material.opacity = 0;
    magnetLight.intensity = 0;
  }
  updatePowerupTray();

  // ── Grid scroll
  scrollGrid(dt * effectiveSpeed / state.speed);

  // ── Death Run level sequencer ──
  // Always tick the sequencer — REST stages manage deathRunRestBeat internally
  // to suppress the spawner. Gating the sequencer on restBeat caused REST stages
  // to run ~31x longer than intended (seqStageElapsed only advanced 1 frame per 0.5s).
  if (state.isDeathRun && !state.introActive && !state._tutorialActive && !state._jetLightningMode) {
    if (state.deathRunRestBeat > 0) state.deathRunRestBeat -= dt;
    _drSequencerTick(dt);
  }
  // ── Legacy wave director (disabled — replaced by sequencer) ──
  if (false && state.isDeathRun && !state.introActive) {
    if (false) {
      // Current run band (with forced band override for dynamic-duration tiers)
      const _drElapsed = state.elapsed || 0;
      let _drBandIdx = DR2_RUN_BANDS.length - 1;
      let _drBand = DR2_RUN_BANDS[_drBandIdx];
      if (state._drForcedBand != null && state._drForcedBand >= 0) {
        _drBandIdx = state._drForcedBand;
        _drBand = DR2_RUN_BANDS[_drBandIdx];
      } else {
        for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
          if (_drElapsed < DR2_RUN_BANDS[bi].maxTime) { _drBand = DR2_RUN_BANDS[bi]; _drBandIdx = bi; break; }
        }
      }
      // Band 4 (idx 3): auto-start CORRIDOR_ARC on entry
      if (_drBandIdx === 3 && !state._drBand4Started) {
        state._drBand4Started = true;
        clearAllCorridorFlags(); state.deathRunRestBeat = 1.0;
        const fam = DR_MECHANIC_FAMILIES['CORRIDOR_ARC'];
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0; state.drPhaseDuration = 0;
        fam.activate(_drBand, 'build');
      }
      // Band 4→5: when corridor arc finishes, advance to Band 5
      if (_drBandIdx === 3 && state._drBand4Started && !state._arcActive &&
          !state.corridorMode && !state.l4CorridorActive && !state.l5CorridorActive) {
        state._drForcedBand = 4; // Band 5
        state._drBand5StartTime = state.elapsed;
        state.drPhase = 'RELEASE'; state.drPhaseTimer = 0;
        const _relDur = DR2_PHASE_DURATIONS.RELEASE;
        state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);
      }
      // Band 5→6: after 30s in Band 5, advance to Band 6
      if (state._drForcedBand === 4 && state._drBand5StartTime &&
          state.elapsed - state._drBand5StartTime >= 30) {
        state._drForcedBand = 5; // Band 6
      }

      // Is ANY structured mechanic currently active?
      // Advance arc stages (must run before mechActive check)
      _drAdvanceArc();
      const _drMechActive = state.slalomActive ||
                            state.zipperActive || state.angledWallsActive ||
                            state.drCustomPatternActive || state.corridorMode ||
                            state.l4CorridorActive || state.l5CorridorActive ||
                            state._arcActive;

      const phase = state.drPhase;

      if (phase === 'RELEASE' || phase === 'RECOVERY') {
        state.drPhaseTimer += dt;
        if (state.drPhaseTimer >= state.drPhaseDuration) {
          if (phase === 'RELEASE') {
            // Band 1: pure random cones only — loop RELEASE until Band 2
            if (_drBand.label === 'BAND1') {
              state.drPhaseTimer = 0;
              const _relDur = DR2_PHASE_DURATIONS.RELEASE;
              state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);

            } else {
              // Brief clear beat before structured mechanic starts
              const familyKey = _drPickMechanic('build', _drBandIdx);
              if (!familyKey) {
                // No eligible mechanics — loop RELEASE
                state.drPhaseTimer = 0;
                const _relDur2 = DR2_PHASE_DURATIONS.RELEASE;
                state.drPhaseDuration = _relDur2.min + Math.random() * (_relDur2.max - _relDur2.min);
              } else {
                state.deathRunRestBeat = 1.0 + Math.random() * 0.5;
                const family = DR_MECHANIC_FAMILIES[familyKey];
                state.drPhase = 'BUILD';
                state.drPhaseTimer = 0;
                state.drPhaseDuration = 0;
                family.activate(_drBand, 'build');
                _dr2DebugLog();
              }
            }
          } else {
            // RECOVERY -> RELEASE
            state.drPhase = 'RELEASE';
            state.drPhaseTimer = 0;
            const _relDur = DR2_PHASE_DURATIONS.RELEASE;
            state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);
            state.drWaveCount++;
            // 40% chance to spawn bonus rings at start of new RELEASE
            if (!state._tutorialActive && !state._jetLightningMode && Math.random() < 0.6 && _bonusRings.length === 0) { _ringSpawnRow(0); console.log('[DR] Bonus rings spawned (RELEASE), count=' + _bonusRings.length); }
            _dr2DebugLog();
          }
        }
      } else if (phase === 'BUILD') {
        if (!_drMechActive) {
          // BUILD mechanic finished. PEAK or RECOVERY?
          const doPeak = Math.random() < _drBand.peakChance;
          if (doPeak) {
            const familyKey = _drPickMechanic('peak', _drBandIdx);
            if (!familyKey) {
              // No eligible peak mechanics — skip to RECOVERY
              state.drPhase = 'RECOVERY';
              state.drPhaseTimer = 0;
              const _recDur2 = DR2_PHASE_DURATIONS.RECOVERY;
              state.drPhaseDuration = _recDur2.min + Math.random() * (_recDur2.max - _recDur2.min);
            } else {
              state.deathRunRestBeat = 1.0 + Math.random() * 0.5;
              const family = DR_MECHANIC_FAMILIES[familyKey];
              state.drPhase = 'PEAK';
              state.drPhaseTimer = 0;
              state.drPhaseDuration = 0;
              family.activate(_drBand, 'peak');
            }
          } else {
            state.drPhase = 'RECOVERY';
            state.drPhaseTimer = 0;
            const _recDur = DR2_PHASE_DURATIONS.RECOVERY;
            state.drPhaseDuration = _recDur.min + Math.random() * (_recDur.max - _recDur.min);
            state.deathRunRestBeat = 0.8 + Math.random() * 0.4;

          }
          _dr2DebugLog();
        }
      } else if (phase === 'PEAK') {
        if (!_drMechActive) {
          // PEAK mechanic done → SUSTAIN (brief high-intensity cones before recovery)
          state.drPhase = 'SUSTAIN';
          state.drPhaseTimer = 0;
          const _susDur = DR2_PHASE_DURATIONS.SUSTAIN;
          state.drPhaseDuration = _susDur.min + Math.random() * (_susDur.max - _susDur.min);
          _dr2DebugLog();
        }
      } else if (phase === 'SUSTAIN') {
        // Fast random cones, no rest beat — intensity holds before dropping
        state.drPhaseTimer += dt;
        if (state.drPhaseTimer >= state.drPhaseDuration) {
          state.drPhase = 'RECOVERY';
          state.drPhaseTimer = 0;
          const _recDur = DR2_PHASE_DURATIONS.RECOVERY;
          state.drPhaseDuration = _recDur.min + Math.random() * (_recDur.max - _recDur.min);
          state.deathRunRestBeat = 1.0 + Math.random() * 0.5;
          // Always spawn bonus rings after surviving peak — reward
          if (!state._tutorialActive && !state._jetLightningMode && _bonusRings.length === 0) { _ringSpawnRow(0); console.log('[DR] Bonus rings spawned (post-PEAK), count=' + _bonusRings.length); }
          _dr2DebugLog();
        }
      }
    }
  }

  // ── Spawn
  // L3 dense corridor: spawn wall rows every ~7 world units (ship-relative, cyan tinted)
  if (state.corridorMode && !state._jetLightningMode) {
    if (!state.isDeathRun) maybeStartGauntlet();
    if (state.corridorDelay > 0) {
      state.corridorDelay -= dt;
    } else {
      state.corridorSpawnZ += effectiveSpeed * dt;
      if (state.corridorSpawnZ >= 0) {
        state.corridorSpawnZ = -7 + (Math.random() - 0.5) * 2;
        spawnCorridorRow();
        // DR: row-limited — wave director controls duration
        if (state.isDeathRun && state.corridorRowsDone >= (state._drL3MaxRows || 999)) {
          state.corridorMode = false;
        }
      }
    }
  }

  // L4 sine corridor (death run: row-limited, no auto-trigger)
  if (state.isDeathRun && state.l4CorridorActive) {
    if (state.l4Delay > 0) {
      state.l4Delay -= dt;
    } else {
      state.l4SpawnZ += effectiveSpeed * dt;
      if (state.l4SpawnZ >= 0) {
        state.l4SpawnZ = -7 + (Math.random() - 0.5) * 2;
        spawnL4CorridorRow(); // increments l4RowsDone internally
        if (state.l4RowsDone % 50 === 0) console.log('[L4-DEBUG] row ' + state.l4RowsDone + '/' + (state._drL4MaxRows || 999));
        if (state.l4RowsDone >= (state._drL4MaxRows || 999)) {
          console.log('[L4-DEBUG] ENDED at row ' + state.l4RowsDone);
          state.l4CorridorActive = false;
        }
      }
    }
  } else if (state.currentLevelIdx === 3 && !state.l4CorridorDone && !state.isDeathRun && !state._jetLightningMode) {
    if (!state.l4CorridorActive) {
      if (state.levelElapsed >= L4_CORRIDOR_TRIGGER_S) {
        state.l4CorridorActive = true;
        state.l4SpawnZ         = -7;
        state.l4RowsDone       = 0;
        state.l4SineT          = 0;
        state.l4StartElapsed   = state.levelElapsed;
        state.l4Delay          = 2.0;

      }
    } else {
      // Check if duration expired
      if (state.levelElapsed - state.l4StartElapsed >= L4_CORRIDOR_DURATION_S) {
        state.l4CorridorActive = false;
        state.l4CorridorDone   = true;
      } else {
        if (state.l4Delay > 0) {
          state.l4Delay -= dt;
        } else {
          state.l4SpawnZ += effectiveSpeed * dt;
          if (state.l4SpawnZ >= 0) {
            state.l4SpawnZ = -7 + (Math.random() - 0.5) * 2;
            spawnL4CorridorRow();
          }
        }
      }
    }
  }

  // L5 zipper: fully time-based, managed here so cooldown ticks regardless of normal spawn path
  if (state.isDeathRun && (state.l5CorridorActive || state.zipperActive)) {
    // Death run: only run active spawners
    if (state.l5CorridorActive) {
      state.l5CorridorSpawnZ += effectiveSpeed * dt;
      if (state.l5CorridorSpawnZ >= 0) {
        state.l5CorridorSpawnZ = -7 + (Math.random() - 0.5) * 2;
        spawnL5CorridorRow(); // increments l5CorridorRowsDone internally
        if (state.l5CorridorRowsDone >= (state._drL5MaxRows || L5C_TOTAL_ROWS)) {
          state.l5CorridorActive = false;
          // DR: wave director handles transition (no ending sequence)
        }
      }
    } else if (state.zipperActive) {
      state.zipperSpawnTimer -= dt;
      if (state.zipperSpawnTimer <= 0) {
        const rowsDone = Math.max(0, ZIPPER_ROWS - state.zipperRowsLeft);
        const ramp = Math.min(rowsDone / (ZIPPER_ROWS - 1), 1.0);
        state.zipperSpawnTimer = 1.5 - ramp * 0.65;
        spawnZipperRow();
      }
    }
  }

  // Slalom minefield spawner (death run only)
  if (state.isDeathRun && state.slalomActive) {
    state.slalomSpawnZ += effectiveSpeed * dt;
    if (state.slalomSpawnZ >= 0) {
      state.slalomSpawnZ = -SLALOM_Z_SPACING;
      spawnSlalomRow();
      if (state.slalomRowsDone >= state.slalomMaxRows) {
        state.slalomActive = false;
        // Wave director handles rest/transition in its phase tick
      }
    }
  }


  // Custom pattern spawner (death run only)
  if (state.isDeathRun && state.drCustomPatternActive && !state.introActive) {
    state.drCustomPatternSpawnZ += effectiveSpeed * dt;
    if (state.drCustomPatternSpawnZ >= 0) {
      state.drCustomPatternSpawnZ = -7;
      spawnCustomPatternRow();
    }
  }

  if (state.currentLevelIdx === 4 && !state.isDeathRun && !state.isDeathRun2) {
    if (state.l5EndingActive) {
      // Ending: just sail — no cones, dots stay on, gentle deceleration
      state.l5EndingTimer += dt;
      const slowTarget = BASE_SPEED * 0.9;
      state.speed = Math.max(slowTarget, state.speed - dt * 8);
      // After 3s of sailing, fade in JET HORIZON title card cinematic-style
      if (!state.l5TitleShown && state.l5EndingTimer >= 3.0) {
        state.l5TitleShown = true;
        const _ov = document.getElementById('intro-overlay');
        if (_ov) {
          _ov.innerHTML = '';
          _ov.style.display = 'flex';
          const _tc = document.createElement('div');
          _tc.className = 'intro-title line-c';
          _tc.textContent = 'JET HORIZON';
          _ov.appendChild(_tc);
          // Use a longer animation for the ending — fade in slowly, stay, never fade out
          _tc.style.animation = 'none';
          _tc.style.opacity   = '0';
          _tc.style.transition = 'opacity 3s ease-in-out';
          requestAnimationFrame(() => requestAnimationFrame(() => {
            _tc.style.opacity = '1';
          }));
        }
      }
    } else if (state.l5CorridorActive) {
      // L5 final challenge: random-walk corridor
      state.l5CorridorSpawnZ += effectiveSpeed * dt;
      if (state.l5CorridorSpawnZ >= 0) {
        state.l5CorridorSpawnZ = -7 + (Math.random() - 0.5) * 2;
        if (state.l5CorridorRowsDone >= L5C_TOTAL_ROWS) {
          // Corridor complete — brief random cone burst before sail-out
          state.l5CorridorActive       = false;
          state.l5CorridorDone         = true;
          if (!state.isDeathRun) {
            state.l5RandomAfterCorridor  = 5.0;  // 5s of random cones then ending
            // Fire title music now — 3s into this post-corridor phase
            const _tDelay = setTimeout(() => {
              if (titleMusic) titleMusic.currentTime = 0;
              musicFadeTo('title', 6000);
            }, 3000);
            _musicTimers.push(_tDelay);
          }
        } else {
          spawnL5CorridorRow();
        }
      }
    } else if (state.l5RandomAfterCorridor > 0) {
      // Post-corridor: random cones for a few seconds before sail-out
      state.l5RandomAfterCorridor -= dt;
      if (state.l5RandomAfterCorridor <= 0) {
        if (!state.isDeathRun) {
          state.l5EndingActive = true;
          saveLevelBeaten(4); // L5 beaten
        }
      }
    } else if (state.l5RandomAfterZipper > 0) {
      // Post-2nd-zipper: a few more random cones, then trigger corridor
      state.l5RandomAfterZipper -= dt;
      if (state.l5RandomAfterZipper <= 0 && !state.l5CorridorDone) {
        state.l5CorridorActive    = true;
        state.l5CorridorRowsDone  = 0;
        state.l5CorridorSpawnZ    = -7;
        state.l5SineT             = 0;
      }
    } else if (state.l5PreZipperRandom > 0) {
      // Entry buffer: random cones before first zipper fires
      state.l5PreZipperRandom -= dt;
      if (state.l5PreZipperRandom <= 0) {
        state.zipperCooldown = 0; // release the zipper immediately
      }
    } else if (state.zipperActive) {
      state.zipperSpawnTimer -= dt;
      if (state.zipperSpawnTimer <= 0) {
        // Ramp interval: starts at 1.5s, tightens to 0.85s by row 13
        const rowsDone = ZIPPER_ROWS - state.zipperRowsLeft;
        const ramp = Math.min(rowsDone / (ZIPPER_ROWS - 1), 1.0);
        state.zipperSpawnTimer = 1.5 - ramp * 0.65;
        spawnZipperRow();
      }
    } else {
      // Cooldown ticks in real time so it always counts down correctly
      if (state.zipperCooldown > 0) {
        state.zipperCooldown -= dt;
      } else {
        state.zipperActive    = true;
        state.zipperRowsLeft  = ZIPPER_ROWS;
        state.zipperSide      = Math.random() < 0.5 ? 1 : -1;
        state.zipperHoldCount = 0;
        state.zipperSpawnTimer = -1.0;  // 1s grace before first row
      }
    }
  }

  // Normal nextSpawnZ-based spawner — suppressed during active zipper, L5 ending, intro, or death run rest beat
  if (!state._tutorialActive && !state._jetLightningMode && !state.zipperActive && !state.l5EndingActive && !state.l5CorridorActive && !state.drCustomPatternActive && !state.angledWallsActive && !state.introActive && !(state.isDeathRun && state.deathRunRestBeat > 0) && !_awTunerPaused && !state._ringsActive) {
    state.nextSpawnZ += effectiveSpeed * dt;
    if (state.nextSpawnZ >= 0) {
      // Tighter Z spacing for rings (easier to pass through, need more density)
      let _spawnBand = 0;
      if (state.isDeathRun) {
        if (state._drForcedBand != null && state._drForcedBand >= 0) { _spawnBand = state._drForcedBand; }
        else { for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) { if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _spawnBand = bi; break; } _spawnBand = bi; } }
      }
      const _isFatConeMode = state._seqSpawnMode === 'fat_cones';
      const _spawnZBase = _isFatConeMode ? -22 : (_spawnBand === 1) ? -30 : (_spawnBand === 2 || _spawnBand >= 5) ? -22 : (state.isDeathRun ? -30 : -50);
      state.nextSpawnZ = _spawnZBase + (Math.random() - 0.5) * 10;
      state.frameCount++;
      const l4PreClear = (!state.isDeathRun && state.currentLevelIdx === 3 && !state.l4CorridorDone &&
                          state.levelElapsed >= L4_CORRIDOR_TRIGGER_S - 4);

      if (!state.corridorMode && !state.l4CorridorActive && !l4PreClear && state.corridorDelay <= 0 && !state.slalomActive && !state.drCustomPatternActive && !_noSpawnMode) spawnObstacles();
    }
  }


  // ── Move bonus rings
  for (let i = _bonusRings.length - 1; i >= 0; i--) {
    const br = _bonusRings[i];
    br.mesh.position.z += effectiveSpeed * dt;
    // Ring collision: check against actual octagon line segments
    const _rZ = Math.abs(br.mesh.position.z - shipGroup.position.z);
    if (_rZ < 2.0) {
      const shipX = state.shipX;
      const shipY = shipGroup.position.y;
      const ringCX = br.mesh.position.x;

      if (br.mesh.userData.isGauntletRing) {
        // Gauntlet: use _rgDesign values, not _ringTuner
        const R = _rgDesign.radius;
        const SIDES = _rgDesign.sides;
        const ringCY = _rgDesign.y;
        const halfLW = 1.5 / 2; // world units linewidth / 2
        const shipHalf = 1.2;
        let hit = false;
        for (let s = 0; s < SIDES && !hit; s++) {
          const a0 = (s / SIDES) * Math.PI * 2;
          const a1 = ((s + 1) / SIDES) * Math.PI * 2;
          const x0 = ringCX + Math.cos(a0) * R;
          const y0 = ringCY + Math.sin(a0) * R;
          const x1 = ringCX + Math.cos(a1) * R;
          const y1 = ringCY + Math.sin(a1) * R;
          // Point-to-segment distance
          const dx = x1 - x0, dy = y1 - y0;
          const len2 = dx * dx + dy * dy;
          let t = len2 > 0 ? ((shipX - x0) * dx + (shipY - y0) * dy) / len2 : 0;
          t = Math.max(0, Math.min(1, t));
          const closestX = x0 + t * dx;
          const closestY = y0 + t * dy;
          const dist = Math.sqrt((shipX - closestX) ** 2 + (shipY - closestY) ** 2);
          if (dist < shipHalf + halfLW) hit = true;
        }
        if (hit) { killPlayer(); return; }
      } else if (!br.collected) {
        const R = _ringTuner.radius;
        const ringCX2 = br.mesh.position.x;
        const _rDx = Math.abs(ringCX2 - shipX);
        if (_rDx < R * 0.8) {
          br.collected = true;
          br.mesh.material.opacity = 0.08;
          _ringSpawnRipple(br.mesh.position.clone(), br.mesh.material.color.getHex());
          const fc = parseInt(window._LS.getItem('jetslide_fuelcells') || '0', 10);
          window._LS.setItem('jetslide_fuelcells', String(fc + 1));
          const _fcHud = document.getElementById('hud-fuelcells');
          if (_fcHud) _fcHud.textContent = fc + 1;
          playSFX(880, 0.2, 'sine', 0.15);
          // Fuel cell particle fly from ship position
          _spawnFuelFly(shipGroup.position);
        }
      }
    }
    // Despawn when past camera
    if (br.mesh.position.z > 20) {
      scene.remove(br.mesh); br.mesh.geometry.dispose(); br.mesh.material.dispose();
      _bonusRings.splice(i, 1);
    }
  }
  if (_bonusRings.length === 0 && state._ringsActive) state._ringsActive = false;
  _ringTickRipples(dt);

  // ── Move obstacles
  for (let i = activeObstacles.length - 1; i >= 0; i--) {
    const obs = activeObstacles[i];
    obs.position.z += effectiveSpeed * dt;

    // Smooth fade-in from horizon: invisible at spawn, fully opaque by z=-80
    const FADE_START_Z = SPAWN_Z;       // -160: totally transparent at birth
    const FADE_END_Z   = -110;          // fully opaque from here onward
    const fadeT = Math.max(0, Math.min(1, (obs.position.z - FADE_START_Z) / (FADE_END_Z - FADE_START_Z)));
    const fullyOpaque = fadeT >= 1.0;
    const _mc = obs.userData._meshes;
    for (let mi = 0; mi < _mc.length; mi++) {
      const child = _mc[mi];
      const baseOp = child.material.userData.baseOpacity ?? 1.0;
      if (child.material.uniforms && child.material.uniforms.uOpacity) {
        child.material.uniforms.uOpacity.value = fadeT * baseOp;
        // Once fully opaque, switch to solid for depth buffer (blocks corona)
        if (fullyOpaque && child.material.transparent) {
          child.material.transparent = false;
          child.material.depthWrite = true;
          child.material.needsUpdate = true;
        } else if (!fullyOpaque && !child.material.transparent) {
          child.material.transparent = true;
          child.material.depthWrite = false;
          child.material.needsUpdate = true;
        }
      } else {
        const wantTransparent = !fullyOpaque;
        if (child.material.transparent !== wantTransparent) {
          child.material.transparent = wantTransparent;
          child.material.needsUpdate = true;
        }
        child.material.opacity = fullyOpaque ? 1.0 : fadeT * baseOp;
      }
    }

    if (obs.position.z > DESPAWN_Z) {
      returnObstacleToPool(obs);
      activeObstacles.splice(i, 1);
      continue;
    }

    // ── Laser destroys obstacles (corridor/zipper cones are immune)
    if (state.laserActive && !obs.userData.isCorridor) {
      const _lt = state.laserTier || 1;
      let _laserHit = false;
      const oz = obs.position.z;
      const ox = obs.position.x;
      if (oz < 8 && oz > SPAWN_Z) {
        if (_lt <= 3) {
          // Bolt laser: narrow corridor around ship center
          _laserHit = Math.abs(ox - state.shipX) < 1.2;
        } else if (_lt === 4) {
          // T4 static unibeam: narrow corridor straight ahead
          _laserHit = Math.abs(ox - state.shipX) < 1.5;
        } else {
          // T5 scanning beam: handled separately via raycaster below — skip here
        }
      }
      if (_laserHit) {
        spawnConeShards(ox, obs.position.y, oz, currentLevelDef.gridColor);
        returnObstacleToPool(obs);
        activeObstacles.splice(i, 1);
        playSFX(220, 0.15, 'sawtooth', 0.2);
        continue;
      }
    }

    // ── Collision with ship
    if (obs.userData.isEcho) continue; // echo cones are visual only — no collision
    // Rotation-aware hitbox: wings (±2.1) point sideways when flat, up/down when rolled 90°
    // Roll angle from shipGroup.rotation.z — at 0 = flat (full wing width), at ±PI/2 = vertical (fuselage only)
    const roll = shipGroup.rotation.z || 0;
    const absRoll = Math.abs(roll);
    const rollFrac = Math.min(absRoll / (Math.PI / 2), 1); // 0=flat, 1=fully vertical
    const WING_HALF  = 1.5;  // reduced — ring is visual only, not part of hitbox
    const BODY_HALF  = 0.8;  // wider rolled hitbox so threading gaps is harder
    const colDistX = WING_HALF * (1 - rollFrac) + BODY_HALF * rollFrac;
    const colDistZ = 1.5;    // wider Z so fast head-on hits register
    // Scale hitbox for fat/slalom cones — fat cones get a more forgiving hitbox
    const cScale = obs.userData.slalomScaled ? (obs.scale.x || 1) : 1;
    const cMult = obs.userData.isFatCone ? 0.9 : 1.2; // fat cones: hitbox matches cone visual at ship flight height (Y=1.71, ~4.33 unit radius)
    const dxC = Math.abs(obs.position.x - state.shipX);
    const dzC = Math.abs(obs.position.z - shipGroup.position.z);
    if (dxC < (colDistX + (cScale - 1) * cMult) && dzC < (colDistZ + (cScale - 1) * 0.4)) {
      returnObstacleToPool(obs);
      activeObstacles.splice(i, 1);
      if (_godMode) {
        const _shHitSfx = document.getElementById('shield-hit-sfx');
        if (_shHitSfx) { _shHitSfx.currentTime = 0; _shHitSfx.play().catch(()=>{}); }
        addCrashFlash(0xff4400);
      } else {
        killPlayer();
      }
      return;
    }

    // ── Near-miss detection (must survive the kill check above)
    if (!state.l5EndingActive && !obs.userData.nearMissScored && dxC < (colDistX + 0.6) && dzC < 2.0 && dxC > colDistX) {
      // Cooldown: max 1 near-miss SFX per 0.5s to prevent audio spam
      const now = performance.now();
      if (!state._lastNearMissTime) state._lastNearMissTime = 0;
      const canPlaySFX = (now - state._lastNearMissTime) > 500;

      const lvlMult = [1, 1.5, 2, 3, 4][state.currentLevelIdx] || 1;
      if (state.corridorMode || state.l4CorridorActive || state.l5CorridorActive) {
        // Inside corridor: only award on bends
        if (state.nearMissBendAllowed) {
          state.playerScore += 25 * lvlMult;
          state.nearMissBendAllowed = false;
          obs.userData.nearMissScored = true;
          state.nearMissFlash = 1.0; hapticTap();
          if (canPlaySFX) { playNearMissSFX(); state._lastNearMissTime = now; }
        }
      } else {
        // Outside corridor: one per cone, but cooldown on SFX
        state.playerScore += 25 * lvlMult;
        obs.userData.nearMissScored = true;
        state.nearMissFlash = 1.0; hapticTap();
        if (canPlaySFX) { playNearMissSFX(); state._lastNearMissTime = now; }
      }
    }
  }

  // ── Angled walls: spawn + move + collide
  if (state.angledWallsActive && !_awTunerPaused) {
    state.angledWallSpawnZ += effectiveSpeed * dt;
    if (state.angledWallSpawnZ >= 0 && state.angledWallRowsDone < _awTuner.rows) {
      state.angledWallSpawnZ = -_awTuner.zSpacing;
      spawnAngledWallRow();
    }
    // End angled walls phase when all rows spawned AND all walls passed
    if (state.angledWallRowsDone >= _awTuner.rows && _awActive.length === 0) {
      state.angledWallsActive = false;
    }
  }
  for (let i = _awActive.length - 1; i >= 0; i--) {
    const w = _awActive[i];
    if (!_awTunerPaused) w.position.z += effectiveSpeed * dt;
    // Fade-in (skip when paused — walls are placed manually with full opacity)
    if (!_awTunerPaused) {
      const awFadeT = Math.max(0, Math.min(1, (w.position.z - SPAWN_Z) / (SPAWN_Z * -0.4)));
      const awEchoMul = w.userData.echoOpacity ?? 1.0;
      w.userData._mesh.material.uniforms.uOpacity.value = awFadeT * _awTuner.opacity * awEchoMul;
      w.userData._edges.material.opacity = awFadeT * _awTuner.opacity * 0.9 * awEchoMul;
    }
    // Laser destroys walls
    if (state.laserActive) {
      const ldx = Math.abs(w.position.x - state.shipX);
      if (ldx < 5 && w.position.z < 8 && w.position.z > SPAWN_Z) {
        _returnWallToPool(w);
        _awActive.splice(i, 1);
        playSFX(180, 0.15, 'sawtooth', 0.25);
        continue;
      }
    }
    // Despawn
    if (w.position.z > DESPAWN_Z + 10) {
      _returnWallToPool(w);
      _awActive.splice(i, 1);
      continue;
    }
    // Collision: full 3-axis rotated AABB check (uses wall's actual mesh scale)
    if (!state.invincibleSpeedActive && !state.introActive) {
      const ms = w.userData._mesh.scale;
      const halfW = ms.x / 2;
      const halfH = ms.y / 2;
      const halfT = ms.z / 2;
      // Ship world position
      const sx = state.shipX;
      const sy = shipGroup.position.y;
      const sz = shipGroup.position.z;
      // Wall mesh center in world space (mesh is offset by halfH in local Y)
      w.updateMatrixWorld(true);
      const wm = w.userData._mesh;
      wm.updateMatrixWorld(true);
      const wc = new THREE.Vector3();
      wm.getWorldPosition(wc);
      // Delta in world space
      const dx = sx - wc.x;
      const dy = sy - wc.y;
      const dz = sz - wc.z;
      // Extract wall's world rotation axes from its matrixWorld
      const e = wm.matrixWorld.elements;
      // Column vectors (normalized — scale is baked into half-extents)
      const ax0x = e[0], ax0y = e[1], ax0z = e[2];
      const ax1x = e[4], ax1y = e[5], ax1z = e[6];
      const ax2x = e[8], ax2y = e[9], ax2z = e[10];
      const len0 = Math.sqrt(ax0x*ax0x + ax0y*ax0y + ax0z*ax0z) || 1;
      const len1 = Math.sqrt(ax1x*ax1x + ax1y*ax1y + ax1z*ax1z) || 1;
      const len2 = Math.sqrt(ax2x*ax2x + ax2y*ax2y + ax2z*ax2z) || 1;
      // Project delta onto wall's local axes
      const localX = (dx * ax0x + dy * ax0y + dz * ax0z) / len0;
      const localY = (dx * ax1x + dy * ax1y + dz * ax1z) / len1;
      const localZ = (dx * ax2x + dy * ax2y + dz * ax2z) / len2;
      const shipHalfX = 0.3;
      const shipHalfZ = 0.3;
      const shipHalfY = 0.3;
      if (Math.abs(localX) < (halfW + shipHalfX) &&
          Math.abs(localY) < (halfH + shipHalfY) &&
          Math.abs(localZ) < (halfT + shipHalfZ)) {
        killPlayer();
        return;
      }
    }
  }

  // ── Lethal rings: move, fade, collide, despawn
  for (let i = _lethalRingActive.length - 1; i >= 0; i--) {
    const lr = _lethalRingActive[i];
    lr.position.z += effectiveSpeed * dt;
    const fadeT = Math.max(0, Math.min(1, (lr.position.z - SPAWN_Z) / (SPAWN_Z * -0.4)));
    lr.userData._ringMesh.material.uniforms.uOpacity.value = fadeT * 0.92;
    // Laser destroys lethal rings
    if (state.laserActive) {
      let _ringHit = false;
      const _lt2 = state.laserTier || 1;
      if (_lt2 >= 5 && state._laserScanAngle !== undefined) {
        // T5: use same raycaster math
        const _rp = new THREE.Vector3().copy(lr.position).sub(new THREE.Vector3(state.shipX + _lBeamXOff, _lBeamY, shipGroup.position.z));
        const _rd = new THREE.Vector3(Math.sin(state._laserScanAngle), 0, -Math.cos(state._laserScanAngle));
        const _al = _rp.dot(_rd);
        if (_al > 0) {
          const _cl = new THREE.Vector3(state.shipX + _lBeamXOff, _lBeamY, shipGroup.position.z).addScaledVector(_rd, _al);
          _ringHit = _cl.distanceTo(lr.position) < 5.0;
        }
      } else {
        const ldx = Math.abs(lr.position.x - state.shipX);
        _ringHit = ldx < 6 && lr.position.z < 8 && lr.position.z > SPAWN_Z;
      }
      if (_ringHit) {
        lr.userData.active = false;
        lr.visible = false;
        lr.position.set(0, -9999, 0);
        _lethalRingActive.splice(i, 1);
        playSFX(200, 0.15, 'sawtooth', 0.2);
        continue;
      }
    }
    if (lr.position.z > DESPAWN_Z + 5) {
      lr.userData.active = false;
      lr.visible = false;
      lr.position.set(0, -9999, 0);
      _lethalRingActive.splice(i, 1);
      continue;
    }
    if (!state.invincibleSpeedActive && !state.introActive) {
      // Hitbox = distance to octagon tube path (matches mesh exactly)
      const sx = state.shipX - lr.position.x;
      const sy = shipGroup.position.y - (lr.position.y + _LR_Y);
      const sz = shipGroup.position.z - lr.position.z;
      // Check distance to each octagon edge segment
      const hitR = _LR_TUBE; // exact tube radius — tight to mesh
      for (let seg = 0; seg < _LR_SIDES; seg++) {
        const a0 = (seg / _LR_SIDES) * Math.PI * 2;
        const a1 = ((seg + 1) / _LR_SIDES) * Math.PI * 2;
        const ax = Math.cos(a0) * _LR_R, ay = Math.sin(a0) * _LR_R;
        const bx = Math.cos(a1) * _LR_R, by = Math.sin(a1) * _LR_R;
        // Closest point on segment A→B to ship (in ring's XY plane)
        const ex = bx - ax, ey = by - ay;
        const t = Math.max(0, Math.min(1, ((sx - ax) * ex + (sy - ay) * ey) / (ex * ex + ey * ey)));
        const cx = ax + t * ex, cy = ay + t * ey;
        const dx = sx - cx, dy2 = sy - cy;
        const dist = Math.sqrt(dx * dx + dy2 * dy2 + sz * sz);
        if (dist < hitR) {
          if (_godMode) {
            // God mode: shield-hit flash + sound, no death
            _triggerCrashFlash();
            playSFX(220, 0.18, 'sawtooth', 0.15);
            return;
          }
          killPlayer();
          return;
        }
      }
    }
  }

  // ── Move power-ups
  for (let i = activePowerups.length - 1; i >= 0; i--) {
    const pu = activePowerups[i];
    pu.position.z += effectiveSpeed * dt;
    pu.rotation.y += 1.8 * dt;
    pu.rotation.x += 0.6 * dt;

    // Magnet pull toward ship (powerups only at tier 5)
    if (state.magnetActive && state.magnetPullsPowerups) {
      const dx = state.shipX - pu.position.x;
      const dz = shipGroup.position.z - pu.position.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist < state.magnetRadius) {
        const pull = 40 * dt; // pull speed — strong enough to reel in distant powerups
        pu.position.x += (dx / dist) * pull;
        pu.position.z += (dz / dist) * pull;
      }
    }

    // Scale pulse
    const s = 1.0 + Math.sin(state.frameCount * 0.12 + i) * 0.12;
    pu.scale.setScalar(s);

    if (pu.position.z > DESPAWN_Z) {
      returnPowerupToPool(pu);
      activePowerups.splice(i, 1);
      continue;
    }

    // Collect
    const dxP = Math.abs(pu.position.x - state.shipX);
    const dzP = Math.abs(pu.position.z - shipGroup.position.z);
    if (dxP < 2.0 && dzP < 2.0) {
      applyPowerup(pu.userData.typeIdx);
      returnPowerupToPool(pu);
      activePowerups.splice(i, 1);
    }
  }


  // ── Move coins
  for (let ci = activeCoins.length - 1; ci >= 0; ci--) {
    const coin = activeCoins[ci];
    coin.position.z += effectiveSpeed * dt;
    // Spin the coin face-on (tumble in world-Y which is coin's local Z after the x-rotation)
    coin.rotation.z = state.elapsed * 2.8 + (coin.userData.spinPhase || 0);
    // Gentle bob
    coin.position.y = 1.2 + Math.sin(state.elapsed * 2.2 + (coin.userData.spinPhase || 0)) * 0.12;

    // Magnet pull — wider radius for coins than power-ups
    if (state.magnetActive) {
      const dx = coin.position.x - state.shipX;
      const dz = coin.position.z - shipGroup.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < (state.magnetRadius || 18)) {
        coin.position.x -= dx * 5 * dt;
        coin.position.z -= dz * 3 * dt;
      }
    }

    // Despawn if past camera
    if (coin.position.z > DESPAWN_Z + 2) {
      returnCoinToPool(coin);
      activeCoins.splice(ci, 1);
      continue;
    }

    // Collect
    const dcx = Math.abs(coin.position.x - state.shipX);
    const dcz = Math.abs(coin.position.z - shipGroup.position.z);
    if (dcx < 1.6 && dcz < 1.6) {
      collectCoin(coin, coin.position.clone());
      returnCoinToPool(coin);
      activeCoins.splice(ci, 1);
    }
  }

  // ── Move forcefields
  for (let fi = _activeForcefields.length - 1; fi >= 0; fi--) {
    const ff = _activeForcefields[fi];
    ff.position.z += effectiveSpeed * dt;
    if (ff.position.z > DESPAWN_Z) {
      returnForcefieldToPool(ff);
      _activeForcefields.splice(fi, 1);
      continue;
    }
    // Collision: flat plane spanning the gap, height ~4 units
    const halfW = (ff.userData.gapWidth || SLALOM_SPACING) * 0.5;
    const dx = Math.abs(ff.position.x - state.shipX);
    const dz = Math.abs(ff.position.z - shipGroup.position.z);
    if (dx < halfW && dz < 1.5 && !state.invincibleSpeedActive && !state.shieldActive) {
      killPlayer();
      return;
    }
  }

  // ── Shield — flow shader drives everything via uReveal + uTime
  if (state.shieldActive && !state.invincibleSpeedActive) {
    shieldMat.uniforms.uTime.value += dt;
    shieldWire.visible = false;
    shieldMesh.visible = true;
    if (state.shieldBuildT != null && state.shieldBuildT < 1) {
      state.shieldBuildT = Math.min(1, state.shieldBuildT + dt / 0.8);
      const ease = state.shieldBuildT * (2 - state.shieldBuildT);
      shieldMat.uniforms.uReveal.value = 1.0 - ease;
      shieldLight.intensity = ease * 1.5;
    } else {
      shieldMat.uniforms.uReveal.value = 0.0;
      shieldLight.intensity = 1.2 + Math.sin(state.frameCount * 0.15) * 0.4;
    }
  } else if (!state.shieldActive && state._shieldBreakT != null && state._shieldBreakT < 1) {
    // Death ripple: keep mesh alive, dissolve out over 0.6s
    shieldMat.uniforms.uTime.value += dt;
    state._shieldBreakT = Math.min(1, state._shieldBreakT + dt / 0.6);
    const breakEase = state._shieldBreakT * state._shieldBreakT;
    shieldMesh.visible = true;
    shieldWire.visible = false;
    shieldMat.uniforms.uReveal.value = breakEase;
    shieldLight.intensity = (1.0 - breakEase) * 1.5;
    if (state._shieldBreakT >= 1) {
      shieldMesh.visible = false;
      state._shieldBreakT = null;
      shieldLight.intensity = 0;
    }
  } else if (!state.shieldActive) {
    shieldMesh.visible = false;
    shieldWire.visible = false;
    shieldMesh.scale.setScalar(1);
  }

  // ── Sun slow rotation
  // galaxy scroll handled in updateGalaxyScroll above

  // ── Post-L3-corridor gap: 3s no cone gen before L4 random cones start
  if (state.postL3Gap > 0 && !state.corridorMode && state.currentLevelIdx === 3) {
    state.postL3Gap -= dt;
    // Block normal spawner by keeping corridorDelay positive
    state.corridorDelay = Math.max(state.corridorDelay, 0.01);
    if (state.postL3Gap <= 0) state.corridorDelay = 0;
  }

  // ── DR Portal gate update ──


  // ── Auto-spawn portal gate in DR mode after 10 seconds (POC trigger) ──
  // QUARANTINED: wormhole sequence disabled for both DR and campaign while sequencer is in development
  // if (state.isDeathRun && !_drPortalActive && !state.wormholeActive && state.elapsed > 10 && !state.introActive) {
  //   drPortalSpawn();
  // }

  updateTransition(dt);
  updateDeathRunTransition(dt);
}

// ═══════════════════════════════════════════════════
//  DEBUG OVERLAY
// ═══════════════════════════════════════════════════
let dbgFrames = 0, dbgLast = performance.now(), dbgFps = 0;
let dbgVisible = false;
const dbgEl = document.getElementById('debug-overlay');

// Toggle debug overlay with 'D' key (desktop only)
window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    dbgVisible = !dbgVisible;
    dbgEl.classList.toggle('visible', dbgVisible);
  }
  // V — toggle canyon on/off
  // V key is handled by the canyon tuner panel listener below
});

// ═══════════════════════════════════════════════════
//  CANYON TUNER PANEL  (shown/hidden with V key alongside canyon toggle)
// ═══════════════════════════════════════════════════
(function _setupCanyonTunerPanel() {
  const S = (css) => Object.assign(document.createElement('div'), { style: css });
  const panel = document.createElement('div');
  panel.id = 'canyon-tuner';
  panel.style.cssText = [
    'position:fixed;top:10px;left:10px;width:calc(min(300px,90vw));max-height:90vh;overflow-y:auto',
    'background:rgba(0,10,20,0.95);border:1px solid #00eeff;color:#00eeff',
    'font-family:monospace;font-size:11px;padding:10px;z-index:9999',
    'border-radius:4px;scrollbar-width:thin;'
  ].join(';');
  document.body.appendChild(panel);

  let panelVisible = false;

  function rebuildGeo() {
    if (!_canyonActive) return;
    _destroyCanyonWalls();
    _createCanyonWalls();
  }

  function rebakeAllX() {
    if (!_canyonWalls) return;
    const T = _canyonTuner;
    const footOff = _canyonWalls._footOff || 0;
    const spacing = _canyonWalls._spacing;
    ['left','right'].forEach(k => {
      const side = k === 'left' ? -1 : 1;
      _canyonWalls[k].forEach(m => {
        const rowsAhead  = Math.max(0, Math.round((3.9 - m.position.z) / spacing));
        const center     = _canyonPredictCenter(rowsAhead);
        const centerNext = _canyonPredictCenter(rowsAhead + 1);
        const halfX      = (_canyonMode === 5) ? _canyonHalfXAtZ(m.position.z) : _canyonPredictHalfX(rowsAhead);
        m.userData.bakedX = center + halfX * side;
        m.position.x = m.userData.bakedX;
        m.rotation.y = side * Math.atan(centerNext - center);
      });
    });
  }

  // rebuildTex removed — referenced nonexistent gridTex / _makeCanyonGridTexture

  function hdr(txt) {
    const d = document.createElement('div');
    d.style.cssText = 'color:#ff0;font-size:10px;margin:8px 0 3px;letter-spacing:1px;';
    d.textContent = txt;
    panel.appendChild(d);
  }

  function slider(label, key, min, max, step, mode) {
    // mode: 'geo' = rebuild geometry, 'tex' = rebuild texture, 'live' = instant
    const T = _canyonTuner;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;margin:2px 0;gap:5px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'flex:0 0 85px;font-size:10px;color:#aef;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    lbl.textContent = label;
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step; sl.value = T[key];
    sl.style.cssText = 'flex:1;accent-color:#00eeff;cursor:pointer;';
    const vl = document.createElement('span');
    vl.style.cssText = 'flex:0 0 42px;text-align:right;font-size:11px;font-weight:bold;color:#fff;';
    vl.textContent = T[key];
    sl.addEventListener('input', () => {
      T[key] = parseFloat(sl.value);
      vl.textContent = sl.value;
      if (mode === 'geo') rebuildGeo();
      else if (mode === 'live-cyan') {
        if (_canyonWalls && _canyonWalls.cyanMat) {
          _canyonWalls.cyanMat.emissiveIntensity = T.cyanEmi;
          _canyonWalls.cyanMat.roughness = T.cyanRgh;
          _canyonWalls.cyanMat.needsUpdate = true;
        }
      } else if (mode === 'dark-tex') {
        rebuildDarkTex();
      } else if (mode === 'live-sine') {
        rebakeAllX();
      } else if (mode === 'live-lights') {
        if (_canyonWalls && _canyonWalls.canyonLight && _canyonWalls.canyonLight.lights) {
          _canyonWalls.canyonLight.lights.forEach((l, i) => {
            l.intensity = _CANYON_LIGHT_DEFS[i].intensity * T.lightIntensity;
          });
        }
      } else if (mode === 'live-dark-mat') {
        if (_canyonWalls && _canyonWalls.darkMat) {
          _canyonWalls.darkMat.roughness  = T.darkRgh;
          _canyonWalls.darkMat.clearcoat  = T.darkClearcoat;
          _canyonWalls.darkMat.emissiveIntensity = T.darkEmi;
          _canyonWalls.darkMat.needsUpdate = true;
        }
      }
      // 'live' — nothing extra needed, update loop reads T directly
    });
    row.appendChild(lbl); row.appendChild(sl); row.appendChild(vl);
    panel.appendChild(row);
  }

  function toggle(label, key, mode) {
    // mode: 'geo' = destroy+recreate pool, undefined/other = just flip flag
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;margin:4px 0;gap:8px;';
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.checked = !!_canyonTuner[key];
    chk.addEventListener('change', () => {
      _canyonTuner[key] = chk.checked;
      if (mode === 'geo') rebuildGeo();
    });
    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:10px;color:#aef;cursor:pointer;';
    lbl.textContent = label;
    row.appendChild(chk); row.appendChild(lbl);
    panel.appendChild(row);
  }

  function rebuildDarkTex() {
    if (!_canyonWalls) return;
    const newTex = _makeCanyonDarkTex(2);
    _canyonWalls.darkMat.emissiveMap = newTex;
    _canyonWalls.darkMat.needsUpdate = true;
    if (_canyonWalls.darkTex) _canyonWalls.darkTex.dispose();
    _canyonWalls.darkTex = newTex;
  }

  function buildPanel() {
    panel.innerHTML = '';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:12px;font-weight:bold;color:#fff;border-bottom:1px solid #00eeff;padding-bottom:5px;margin-bottom:4px;';
    title.textContent = 'CANYON TUNER  [V to close]';
    panel.appendChild(title);

    hdr('— GEOMETRY —');
    slider('Height',        'slabH',        5, 260,  5,    'geo');
    slider('Slab length',   'slabW',       10, 200,  5,    'geo');
    slider('Thickness',     'slabThick',    5, 120,  1,    'geo');
    slider('Cols',          'cols',         2,  14,  1,    'geo');
    slider('Rows',          'rows',         2,  14,  1,    'geo');
    slider('Displacement',  'disp',         0,  20,  0.5,  'geo');
    slider('Snap',          'snap',       0.1,   3,  0.1,  'geo');

    hdr('— PROFILE —');
    slider('Foot X',        'footX',      -30,  40,  0.5,  'geo');
    slider('Sweep X',       'sweepX',       0,  20,  0.5,  'geo');
    slider('Mid X',         'midX',         0,  30,  0.5,  'geo');
    slider('Crest X',       'crestX',       0,  35,  0.5,  'geo');

    hdr('— CYAN SLAB —');
    slider('Emissive',      'cyanEmi',      0,   2,  0.05, 'live-cyan');
    slider('Roughness',     'cyanRgh',      0,   1,  0.05, 'live-cyan');

    hdr('— DARK SLAB —');
    slider('Crack count',   'darkCrkCount',   1, 15, 1,    'dark-tex');
    slider('Crack bright',  'darkCrkBright',  0,  2, 0.05, 'dark-tex');
    slider('Roughness',     'darkRgh',        0,  1, 0.02, 'live-dark-mat');
    slider('Clearcoat',     'darkClearcoat',  0,  1, 0.05, 'live-dark-mat');
    slider('Emissive',      'darkEmi',        0,  3, 0.05, 'live-dark-mat');

    hdr('— LIGHTS —');
    slider('Intensity',     'lightIntensity', 0,  3, 0.05, 'live-lights');

    hdr('— CORRIDOR —');
    slider('Wall spacing',   'halfXOverride',  1,  300,  1,  'live-sine');
    slider('Entrance thick', 'entranceThick',  5, 2000,  5,  'geo');
    slider('Entrance slabs', 'entranceSlabs',  1,   20,  1,  'geo');
    slider('Spawn depth',    'spawnDepth',  -600, -100, 10,  'geo');
    toggle('All cyan',       '_allCyan',  'geo');
    toggle('All dark',       '_allDark',  'geo');

    hdr('— SINE CURVES —');
    slider('Intensity',      'sineIntensity',  0,    1, 0.01, 'live-sine');
    slider('Amplitude',      'sineAmp',        1,  400, 1,   'live-sine');
    slider('Period (rows)',   'sinePeriod',    20,  600, 5,   'live-sine');
    slider('Speed',          'sineSpeed',    0.1,    5, 0.1, 'live-sine');

    hdr('— LIVE —');
    slider('scrollSpeed',   'scrollSpeed',  0, 3,   0.1,  'live');

    const btn = document.createElement('button');
    btn.textContent = 'REBUILD GEO';
    btn.style.cssText = 'margin-top:10px;width:100%;background:#001a2a;border:1px solid #00eeff;color:#00eeff;padding:5px;cursor:pointer;font-family:monospace;font-size:11px;border-radius:2px;';
    btn.onclick = rebuildGeo;
    panel.appendChild(btn);

    const rbx = document.createElement('button');
    rbx.textContent = 'REBAKE X';
    rbx.style.cssText = 'margin-top:4px;width:100%;background:#1a0a2a;border:1px solid #c08cff;color:#c08cff;padding:5px;cursor:pointer;font-family:monospace;font-size:11px;border-radius:2px;';
    rbx.onclick = rebakeAllX;
    panel.appendChild(rbx);

    const stp = document.createElement('button');
    stp.textContent = 'STOP CANYON';
    stp.style.cssText = 'margin-top:4px;width:100%;background:#2a0a0a;border:1px solid #ff6060;color:#ff6060;padding:5px;cursor:pointer;font-family:monospace;font-size:11px;border-radius:2px;';
    stp.onclick = () => {
      if (_canyonWalls) _destroyCanyonWalls();
      _canyonActive = false;
      _canyonExiting = false;
      _canyonManual = false;
      _jlCorridor.active = false;
      if (_canyonSavedDirLight !== null && typeof dirLight !== 'undefined' && dirLight) {
        dirLight.intensity = _canyonSavedDirLight;
        _canyonSavedDirLight = null;
      }
    };
    panel.appendChild(stp);

    const dmp = document.createElement('button');
    dmp.textContent = 'DUMP TUNER JSON';
    dmp.style.cssText = 'margin-top:4px;width:100%;background:#2a1a0a;border:1px solid #ffc060;color:#ffc060;padding:5px;cursor:pointer;font-family:monospace;font-size:11px;border-radius:2px;';
    dmp.onclick = () => {
      const snap = JSON.stringify(_canyonTuner, null, 2);
      console.log('[TUNER DUMP]\n' + snap);
      try { navigator.clipboard && navigator.clipboard.writeText(snap); } catch(e){}
    };
    panel.appendChild(dmp);

    // EXPERIMENTAL section — only shows when mode 5 is active.
    // Edits here call rebakeAllX so visible slabs update immediately.
    if (_canyonMode === 5) {
      hdr('— EXPERIMENTAL: SINE RAMP —');
      slider('sineStartI',  'sineStartI',  0,    1, 0.01, 'live-sine');
      slider('sineStartZ',  'sineStartZ', -500, -50, 10,  'live-sine');
      slider('sineFullZ',   'sineFullZ',  -700,-150, 10,  'live-sine');
      hdr('— EXPERIMENTAL: WIDTH SQUEEZE —');
      slider('halfXStart',  'halfXStart',   5,  200, 1,   'live-sine');
      slider('halfXFull',   'halfXFull',    5,  200, 1,   'live-sine');
      slider('halfXStartZ', 'halfXStartZ', -500,-50, 10,  'live-sine');
      slider('halfXFullZ',  'halfXFullZ',  -700,-150,10,  'live-sine');
      const xbtn = document.createElement('button');
      xbtn.textContent = 'REBAKE X (EXP)';
      xbtn.style.cssText = 'margin-top:4px;width:100%;background:#2a1a2a;border:1px solid #ff80ff;color:#ff80ff;padding:5px;cursor:pointer;font-family:monospace;font-size:11px;border-radius:2px;';
      xbtn.onclick = rebakeAllX;
      panel.appendChild(xbtn);
    }

    hdr('— PRESETS —');
    const PRESET_LABELS = {
      1: 'Canyon Corridor 1',
      2: 'Canyon Corridor 2',
      3: 'Regular Canyon',
      4: 'Straight Canyon',
      5: 'EXPERIMENTAL (B)',
    };
    [1,2,3,4,5].forEach((mode) => {
      const vals = _CANYON_PRESETS[mode];
      if (!vals) return;
      const pb = document.createElement('button');
      pb.textContent = PRESET_LABELS[mode] || ('Preset '+mode);
      pb.style.cssText = 'margin-top:6px;width:100%;background:#0a1a0a;border:1px solid #00ff88;color:#00ff88;padding:5px;cursor:pointer;font-family:monospace;font-size:11px;border-radius:2px;';
      pb.onclick = () => {
        _canyonMode = mode;
        // Clear mutually-exclusive palette flags first so preset doesn't inherit stale state
        _canyonTuner._allCyan = false;
        _canyonTuner._allDark = false;
        Object.assign(_canyonTuner, vals);
        _canyonSinePhase = 0;
        if (_canyonActive || _canyonExiting || _canyonWalls) _destroyCanyonWalls();
        // Manual tuner spawn: bypass JL sequencer, no spawner pause
        _canyonExiting = false;
        _canyonActive = true;
        _canyonManual = true;
        _jlCorridor.active = false;
        state.corridorGapCenter = state.shipX || 0;
        if (typeof dirLight !== 'undefined' && dirLight) {
          if (_canyonSavedDirLight === null) _canyonSavedDirLight = dirLight.intensity;
          dirLight.intensity = 0;
        }
        _createCanyonWalls();
        buildPanel();
      };
      panel.appendChild(pb);
    });
  }

  // V key — toggle tuner panel independently of canyon state
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'v' && e.key !== 'V') return;
    if (state.phase !== 'playing') return;
    panelVisible = !panelVisible;
    if (panelVisible) { buildPanel(); panel.style.display = 'block'; }
    else panel.style.display = 'none';
  });

  // B key — toggle EXPERIMENTAL canyon (mode 5) for testing
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'b' && e.key !== 'B') return;
    if (state.phase !== 'playing') return;
    // If experimental canyon is running, stop it
    if (_canyonMode === 5 && (_canyonActive || _canyonWalls)) {
      if (_canyonWalls) _destroyCanyonWalls();
      _canyonActive = false;
      _canyonExiting = false;
      _canyonManual = false;
      _jlCorridor.active = false;
      if (_canyonSavedDirLight !== null && typeof dirLight !== 'undefined' && dirLight) {
        dirLight.intensity = _canyonSavedDirLight;
        _canyonSavedDirLight = null;
      }
      _canyonMode = 0;
      if (panelVisible) buildPanel();
      return;
    }
    // Otherwise spawn experimental canyon (tear down any other canyon first)
    const vals = _CANYON_PRESETS[5];
    if (!vals) return;
    _canyonMode = 5;
    _canyonTuner._allCyan = false;
    _canyonTuner._allDark = false;
    Object.assign(_canyonTuner, vals);
    _canyonSinePhase = 0;
    if (_canyonActive || _canyonExiting || _canyonWalls) _destroyCanyonWalls();
    _canyonExiting = false;
    _canyonActive = true;
    _canyonManual = true;
    _jlCorridor.active = false;
    state.corridorGapCenter = state.shipX || 0;
    if (typeof dirLight !== 'undefined' && dirLight) {
      if (_canyonSavedDirLight === null) _canyonSavedDirLight = dirLight.intensity;
      dirLight.intensity = 0;
    }
    _createCanyonWalls();
    if (panelVisible) buildPanel();
  });
})();

function updateDebug() {
  if (!dbgVisible) return;
  dbgFrames++;
  const now = performance.now();
  if (now - dbgLast >= 1000) {
    dbgFps = Math.round(dbgFrames * 1000 / (now - dbgLast));
    dbgFrames = 0;
    dbgLast = now;
    const info = renderer.info;
    dbgEl.textContent = [
      `FPS:${dbgFps}  Phase:${state.phase}`,
      `Draw:${info.render.calls}  Tri:${info.render.triangles}`,
      `Obs:${activeObstacles.length}  PU:${activePowerups.length}`,
      `Score:${state.score}  Lvl:${state.currentLevelIdx + 1}  Spd:${state.speed.toFixed(1)}`,
    ].join('\n');
  }
}

// ═══════════════════════════════════════════════════
//  RENDER LOOP
// ═══════════════════════════════════════════════════
// ─── DEBUG HITBOX HELPERS ────────────────────────────────────────────────────
const _dbgShipBox = (() => {
  const geo = new THREE.BoxGeometry(2.2, 2.2, 2.2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, depthTest: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 999;
  m.visible = false;
  scene.add(m);
  return m;
})();

const _dbgObsPool = [];
function _getDbgObsBox() {
  for (const b of _dbgObsPool) if (!b.visible) return b;
  const geo = new THREE.BoxGeometry(2.2, 2.2, 2.2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff2222, wireframe: true, depthTest: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 998;
  scene.add(m);
  _dbgObsPool.push(m);
  return m;
}

function updateDebugHitboxes() {
  // Hide all obs boxes first
  for (const b of _dbgObsPool) b.visible = false;

  if (!debugHitboxes || state.phase !== 'playing') {
    _dbgShipBox.visible = false;
    return;
  }

  // Ship box — colDist=1.55 so full span is 3.1 on X and Z
  _dbgShipBox.visible = true;
  _dbgShipBox.position.set(shipGroup.position.x, shipGroup.position.y, shipGroup.position.z);

  // Obstacle boxes
  for (const obs of activeObstacles) {
    const b = _getDbgObsBox();
    b.visible = true;
    b.position.copy(obs.position);
  }
}

// ── FPS counter (admin-only) ──
let _fpsOn = false, _fpsFrames = 0, _fpsLastTime = performance.now(), _lastDC = 0;
const _fpsEl = document.getElementById('fps-overlay');
(function setupFpsToggle() {
  const btn = document.getElementById('fps-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    _fpsOn = !_fpsOn;
    btn.setAttribute('aria-pressed', _fpsOn);
    btn.classList.toggle('on', _fpsOn);
    if (_fpsEl) _fpsEl.classList.toggle('hidden', !_fpsOn);
    _fpsFrames = 0; _fpsLastTime = performance.now();
  });
})();

// ═══════════════════════════════════════════════════════════════════════════
//  PERF DIAGNOSTIC — per-frame timing + event tags + first-render detection
//  Purpose: pinpoint source of freeze (shader compile vs geo upload vs GC vs
//  draw-call spike vs JS stall). Pure additive — no behavior changes.
//  Toggle: window._perfDiagOn = false to silence.
//  Threshold: frames >20ms log as [FREEZE]. Rolling p95/p99 every 2s as [PERF].
// ═══════════════════════════════════════════════════════════════════════════
window._perfDiagOn = true;
const _perfDiag = (function() {
  let _frameStartTs = 0;
  let _renderStartTs = 0;
  let _renderEndTs = 0;
  let _lastFrameEndTs = 0;
  let _prevDraws = 0;
  let _prevTris = 0;
  let _prevHeap = 0;
  let _prevProgramCount = 0;         // for churn detection: same count + different programs = eviction
  let _seenPrograms = new WeakSet(); // track compiled programs
  let _seenProgramNames = new Map(); // program ref -> name, for eviction-diff
  let _prevProgramRefs = [];         // refs seen last frame, for churn detection
  let _frameEvents = [];              // events tagged this frame
  let _rollingFrames = [];            // frame times for last 2s
  let _rollingStart = 0;
  let _needsUpdateHits = [];          // captured by needsUpdate setter trap

  function _getHeap() {
    if (performance.memory && performance.memory.usedJSHeapSize) {
      return performance.memory.usedJSHeapSize;
    }
    return 0;
  }

  let _newProgramNames = []; // populated by _detectNewPrograms each frame
  function _detectNewPrograms() {
    // Walk renderer.info.programs; return count of programs not yet seen.
    // First render of a new material = shader compile stall this frame.
    // Also capture each new program's name/type so we know WHICH material compiled.
    _newProgramNames.length = 0;
    if (!renderer || !renderer.info || !renderer.info.programs) return 0;
    let newCount = 0;
    for (const p of renderer.info.programs) {
      if (!_seenPrograms.has(p)) {
        _seenPrograms.add(p);
        newCount++;
        // p.name = THREE material type (e.g. 'MeshStandardMaterial', 'ShaderMaterial')
        // cacheKey encodes #define flags; truncate for readability.
        const name = p.name || '?';
        const ck = (p.cacheKey || '').slice(0, 40);
        const label = name + (ck ? '[' + ck + ']' : '');
        _newProgramNames.push(label);
        _seenProgramNames.set(p, label);
      }
    }
    return newCount;
  }

  // Diff current program refs against last-frame snapshot — returns labels of evicted programs
  function _detectEvictedPrograms() {
    if (!renderer || !renderer.info || !renderer.info.programs) return [];
    const curr = renderer.info.programs;
    const currSet = new Set(curr);
    const evicted = [];
    for (const p of _prevProgramRefs) {
      if (!currSet.has(p)) {
        const label = _seenProgramNames.get(p) || '?';
        evicted.push(label);
      }
    }
    // Snapshot current for next frame
    _prevProgramRefs = curr.slice();
    return evicted;
  }

  function frameStart() {
    if (!window._perfDiagOn) return;
    _frameStartTs = performance.now();
    _frameEvents.length = 0;
  }

  function markRenderStart() {
    if (!window._perfDiagOn) return;
    _renderStartTs = performance.now();
  }

  function markRenderEnd() {
    if (!window._perfDiagOn) return;
    _renderEndTs = performance.now();
  }

  function tag(name, extra) {
    if (!window._perfDiagOn) return;
    _frameEvents.push(extra ? (name + '(' + extra + ')') : name);
  }

  // Walk entire scene graph (not just top-level children) counting ALL lights.
  // Also captures toggle state. Only called on bad frames — too slow for every frame.
  function _sampleLights() {
    if (!scene) return { count: 0, summary: '' };
    const lights = [];
    scene.traverse(obj => {
      if (obj.isLight) {
        lights.push({
          type: obj.type,
          visible: obj.visible && (obj.parent ? obj.parent.visible !== false : true),
          intensity: obj.intensity,
          color: obj.color ? ('#' + obj.color.getHexString()) : null,
          name: obj.name || '',
        });
      }
    });
    // THREE's uniform setup counts lights that are .visible AND .intensity > 0 AND in scene graph.
    // That's what drives the lights hash in cacheKey.
    const effective = lights.filter(l => l.visible && l.intensity > 0);
    const byType = {};
    for (const l of effective) byType[l.type] = (byType[l.type]||0) + 1;
    const summary = Object.keys(byType).map(k => k+'×'+byType[k]).join(',');
    return { total: lights.length, effective: effective.length, summary };
  }

  // Sample toggleable game state flags that might drive material variant churn.
  function _sampleState() {
    // Use module-local state via closure (window.state is not set)
    const s = state || {};
    const cw = (typeof _canyonWalls !== 'undefined') ? _canyonWalls : null;
    const ap = (typeof _asteroidActive !== 'undefined') ? _asteroidActive : [];
    const astActive = ap.length;
    const canyonVis = cw ? (cw.left || []).filter(m => m.visible).length : 0;
    const rampT = (typeof _jlRampTime !== 'undefined') ? _jlRampTime.toFixed(1) : '?';
    const corridor = (typeof _jlCorridor !== 'undefined' && _jlCorridor.active) ? 1 : 0;
    const canyonAct = (typeof _canyonActive !== 'undefined' && _canyonActive) ? 1 : 0;
    return 'phase='+(s.phase||'?')
      + ' jl='+(s._jetLightningMode?1:0)
      + ' rampT='+rampT
      + ' corridor='+corridor
      + ' canyonAct='+canyonAct
      + ' chaos='+(window._chaosMode?1:0)
      + ' revealed='+(cw && cw._corridorRevealed?1:0)
      + ' astActive='+astActive
      + ' canyonVis='+canyonVis;
  }

  function frameEnd() {
    if (!window._perfDiagOn) return;
    if (_frameStartTs === 0) return; // not initialized
    const now = performance.now();
    const frameMs = now - _frameStartTs;
    const jsMs = (_renderStartTs > 0) ? (_renderStartTs - _frameStartTs) : 0;
    const renderMs = (_renderEndTs > _renderStartTs) ? (_renderEndTs - _renderStartTs) : 0;

    const draws = (renderer && renderer.info) ? renderer.info.render.calls : 0;
    const tris  = (renderer && renderer.info) ? renderer.info.render.triangles : 0;
    const heap  = _getHeap();

    const drawsDelta = draws - _prevDraws;
    const trisDelta  = tris - _prevTris;
    const heapDelta  = heap - _prevHeap;

    const newShaders = _detectNewPrograms();
    const totalPrograms = (renderer && renderer.info && renderer.info.programs) ? renderer.info.programs.length : 0;
    const programDelta = totalPrograms - _prevProgramCount;

    // Rolling window for p95/p99
    _rollingFrames.push(frameMs);
    if (_rollingStart === 0) _rollingStart = now;
    if (now - _rollingStart >= 2000) {
      const sorted = _rollingFrames.slice().sort((a,b)=>a-b);
      const p50 = sorted[Math.floor(sorted.length*0.5)];
      const p95 = sorted[Math.floor(sorted.length*0.95)];
      const p99 = sorted[Math.floor(sorted.length*0.99)];
      const worst = sorted[sorted.length-1];
      console.log('[PERF] '+sorted.length+' frames / 2s — p50='+p50.toFixed(1)+'ms p95='+p95.toFixed(1)+'ms p99='+p99.toFixed(1)+'ms worst='+worst.toFixed(1)+'ms');
      _rollingFrames.length = 0;
      _rollingStart = now;
    }

    // Bad frame: emit detailed log
    if (frameMs > 20) {
      const evts = _frameEvents.length ? _frameEvents.join(', ') : '(none)';
      const heapStr = heap > 0 ? (' heap='+(heap/1048576).toFixed(1)+'MB d=' + (heapDelta>=0?'+':'') + (heapDelta/1048576).toFixed(1)+'MB') : '';
      const shaderStr = newShaders > 0 ? (' newShaders='+newShaders) : '';
      // Tally duplicate material names so log stays compact.
      let shaderDetail = '';
      if (_newProgramNames.length) {
        const counts = {};
        for (const n of _newProgramNames) counts[n] = (counts[n]||0) + 1;
        const parts = [];
        for (const k of Object.keys(counts)) parts.push(counts[k] > 1 ? (k+'×'+counts[k]) : k);
        shaderDetail = ' compiled: [' + parts.join(', ') + ']';
      }
      // KEY churn indicator: if programs count didn't grow but newShaders>0 → eviction/recompile.
      // If it grew by newShaders → first-time compile (cache growing).
      let churnMarker = '';
      if (newShaders > 0 && programDelta < newShaders) {
        const evictedLabels = _detectEvictedPrograms();
        const evSummary = evictedLabels.length
          ? ' [' + evictedLabels.slice(0, 8).join(', ') + (evictedLabels.length > 8 ? ',+' + (evictedLabels.length - 8) : '') + ']'
          : '';
        churnMarker = ' CHURN(evicted=' + (newShaders - programDelta) + evSummary + ')';
      } else {
        // Still snapshot refs even on non-churn frames so we have a baseline
        _detectEvictedPrograms();
      }
      // Light sample — detects light count/visibility toggles that drive cacheKey churn.
      const lights = _sampleLights();
      const lightStr = ' lights='+lights.effective+'/'+lights.total+'['+lights.summary+']';
      // State flags
      const stateStr = ' state:['+_sampleState()+']';
      // needsUpdate hits since last bad frame
      const nuStr = _needsUpdateHits.length ? (' needsUpdate=['+_needsUpdateHits.join(',')+']') : '';
      _needsUpdateHits.length = 0;
      console.log('[FREEZE] '+frameMs.toFixed(1)+'ms | js='+jsMs.toFixed(1)+' render='+renderMs.toFixed(1)
        +' | progs='+totalPrograms+'(d'+(programDelta>=0?'+':'')+programDelta+')'+churnMarker
        +' draws='+draws+'(d'+(drawsDelta>=0?'+':'')+drawsDelta+')'
        +' tris='+Math.round(tris/1000)+'k(d'+(trisDelta>=0?'+':'')+Math.round(trisDelta/1000)+'k)'
        +heapStr+shaderStr+lightStr+stateStr
        +' | events: '+evts+shaderDetail+nuStr);
    }

    _prevDraws = draws;
    _prevTris = tris;
    _prevHeap = heap;
    _prevProgramCount = totalPrograms;
  }

  // needsUpdate trap — wraps THREE's existing needsUpdate setter so we can count
  // how many times code sets it = true during gameplay. Classic cause of
  // "everything recompiles" when code sets it on a shared material.
  // We delegate to the original setter to preserve THREE's internal behavior.
  function _installNeedsUpdateTrap() {
    if (typeof THREE === 'undefined' || !THREE.Material) return;
    const proto = THREE.Material.prototype;
    if (proto._perfDiagTrapped) return;
    // Find the existing descriptor (may be on prototype or up the chain)
    let existing = null;
    let target = proto;
    while (target && !existing) {
      existing = Object.getOwnPropertyDescriptor(target, 'needsUpdate');
      if (!existing) target = Object.getPrototypeOf(target);
    }
    if (!existing || !existing.set) {
      console.warn('[PERF DIAG] could not find needsUpdate setter, trap not installed');
      return;
    }
    const origSet = existing.set;
    const origGet = existing.get || function(){return false;};
    proto._perfDiagTrapped = true;
    Object.defineProperty(proto, 'needsUpdate', {
      set: function(v) {
        if (v && window._perfDiagOn) {
          const name = this.type + (this.name ? ('/'+this.name) : '') + '#' + (this.id||'?');
          _needsUpdateHits.push(name);
        }
        origSet.call(this, v);
      },
      get: function() { return origGet.call(this); },
      configurable: true,
    });
    console.log('[PERF DIAG] needsUpdate trap installed');
  }
  setTimeout(_installNeedsUpdateTrap, 100);

  return { frameStart, markRenderStart, markRenderEnd, frameEnd, tag };
})();
window._perfDiag = _perfDiag;

function animate() {
  requestAnimationFrame(animate);
  _perfDiag.frameStart();
  // FPS + draw call measurement
  if (_fpsOn) {
    _fpsFrames++;
    const now = performance.now();
    if (now - _fpsLastTime >= 500) {
      const fps = Math.round(_fpsFrames / ((now - _fpsLastTime) / 1000));
      if (_fpsEl) _fpsEl.textContent = fps + ' FPS  ' + _lastDC + ' DC';
      _fpsFrames = 0; _fpsLastTime = now;
    }
  }
  const rawDt = Math.min(clock.getDelta(), 0.05);

  // ── TITLE SCREEN: render title scene only, skip all gameplay ──────
  if (state.phase === 'title') {
    // Rotate title ship slowly
    const pivot = titleScene.getObjectByName('titleShipPivot');
    const _spinDefault = window.innerWidth >= 1024 ? 0.001 : 0.004;
    const _spinRate = window._titleSpinSpeed !== undefined ? window._titleSpinSpeed : _spinDefault;
    if (pivot) pivot.rotation.y += _spinRate;

    // Handling upgrade pending → subtle cyan emissive glow pulse on title ship
    if (_titleShipModel && getPendingHandlingUpgrade()) {
      _titleGlowPhase += rawDt * 2.5;
      const pulse = 0.08 + 0.08 * Math.sin(_titleGlowPhase);
      for (const entry of _titleMeshMap) {
        if (entry.origName === 'fire' || entry.origName === 'fire1') continue;
        const mat = entry.mesh.material;
        if (mat && mat !== _titleDarkMat && mat.emissive) {
          // Store base intensity once, pulse relative to it
          if (mat.userData._baseEI === undefined) mat.userData._baseEI = mat.emissiveIntensity;
          mat.emissiveIntensity = mat.userData._baseEI + pulse;
        }
      }
    }

    _titleRenderer.render(titleScene, titleCamera);
    return;
  }



  // ── GAMEPLAY (playing / dead / paused) ────────────────────────
  accumulator += rawDt;
  while (accumulator >= FIXED_DT) {
    try { update(FIXED_DT); } catch(e) { console.error('update() threw:', e); }
    accumulator -= FIXED_DT;
  }

  // JL visual speed boost — JL caps state.speed at 54/62 u/s, which makes
  // FOV/warp/water underperform. Feed a faked higher "visual speed" to
  // perception-only systems without touching physics. Ramps in over 2.5s
  // from launch so the handoff from liftoff feels snappy.
  // Target fake speed: BASE*2.11 = 76 → matches T4c ICE STORM feel.
  // Canyon segments get an extra +10% on top so they punch harder.
  const _jlVisualSpeed = (() => {
    if (!state._jetLightningMode || state.phase !== 'playing') return state.speed;
    const rampT = Math.min(1, Math.max(0, (_jlRampTime || 0) / 2.5));
    const base  = state.speed; // 54 open, 62 canyon
    const targetMult = (_canyonActive || _canyonExiting) ? 1.55 : 1.40;
    const mult = 1.0 + (targetMult - 1.0) * rampT;
    return base * mult;
  })();

  // FOV scales with speed — most effective speed perception trick.
  // Lerps toward base+boost during gameplay, back to base on death/title.
  // Skip during retry sweep (sweep controls FOV directly)
  if (!_retrySweepActive) {
    const _fovSpd = state._jetLightningMode ? _jlVisualSpeed : state.speed;
    const speedFrac = (state.phase === 'playing') ? Math.min(_fovSpd / 80, 1) : 0;
    let targetFOV = _baseFOV + _fovSpeedBoost * speedFrac;
    // Death zoom-out: push FOV wider during explosion (only during dead phase)
    if (_expDeathZoomActive && state.phase === 'dead') targetFOV = _expDeathZoomTarget;
    // Launch snap in first 0.5s, then moderate accel / gentle decel
    const fovDiff = targetFOV - camera.fov;
    const isLaunch = state.phase === 'playing' && (state.elapsed || 0) < 0.5;
    const fovLerpRate = isLaunch ? 12 : (_expDeathZoomActive ? 0.8 : (fovDiff > 0.5 ? 5 : 2));
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, fovLerpRate * rawDt);
    camera.updateProjectionMatrix();
  }

  // ── Tuner speed override (slider in scene tuner) ──
  if (_tunerSpeedOverride > 0) state.speed = _tunerSpeedOverride;

  // Water time tick — drives ripple animation
  mirrorMesh.material.uniforms.time.value += rawDt * 0.5;
  // Forward water flow — scroll normal map along Z proportional to speed
  if (state.phase === 'playing' && state.thrusterPower > 0 && !state.introActive) {
    const _rawWSpd = state._jetLightningMode ? _jlVisualSpeed : state.speed;
    const _wSpd = state.invincibleSpeedActive ? _rawWSpd * 1.8 : _rawWSpd;
    const _wSpdNorm = _wSpd / BASE_SPEED; // 1.0 at T1, 2.5 at T5c
    _waterFlowZ -= _wSpd * _wSpdNorm * rawDt * _waterFlowScale; // squared scaling
    _waterFlowZ %= 10000;
    mirrorMesh.material.uniforms.uFlowZ.value = _waterFlowZ;
  }

  // JL sun warp — Quilez domain warp on sun during Jet Lightning, except
  // ice (shader 3) and gold (shader 4) which already have builtin warp.
  // Skip during liftoff/intro so the launch can play clean.
  if (state._jetLightningMode && state.phase === 'playing'
      && !state.introActive && !state._introLiftActive
      && sunMat && sunMat.uniforms) {
    const _curShader = (typeof _currentSunShader !== 'undefined') ? _currentSunShader : 0;
    const _builtin = (_curShader === 3 || _curShader === 4);
    const _wantW = _builtin ? 0.0 : 1.0;
    const _curW  = sunMat.uniforms.uIsL3Warp.value;
    if (Math.abs(_curW - _wantW) > 0.01) {
      sunMat.uniforms.uIsL3Warp.value += (_wantW - _curW) * Math.min(1, rawDt * 2);
    } else {
      sunMat.uniforms.uIsL3Warp.value = _wantW;
    }
    if (sunCapMat && sunCapMat.uniforms) sunCapMat.uniforms.uIsL3Warp.value = sunMat.uniforms.uIsL3Warp.value;
  }
  // Sun surface churn
  if (sunMat && sunMat.uniforms) sunMat.uniforms.uTime.value += rawDt;
  // Twinkling sky stars — update uTime uniform each frame
  if (skyStarPoints)      skyStarPoints.material.uniforms.uTime.value      += rawDt;
  if (skyConstellLines)   skyConstellLines.material.uniforms.uTime.value   += rawDt;
  // Forcefield animation
  _ffUniforms.uTime.value += rawDt;
  // Keep water X in sync with ship so reflection doesn't drift
  mirrorMesh.position.x = state.shipX;

  if (state.phase === 'paused') { _perfDiag.markRenderStart(); composer.render(); _perfDiag.markRenderEnd(); _perfDiag.frameEnd(); return; }

  updateAurora(rawDt);
  updateL5Flares(rawDt);
  updateWake(rawDt);
  renderer.info.reset();
  updateDebugHitboxes();

  // Keep all sun layers locked to ship X — sun is effectively at infinite distance
  // so lateral movement should never shift it on screen
  const _sunX = state.shipX || 0;
  sunMesh.position.x      = _sunX;
  sunCapMesh.position.x   = _sunX;
  sunGlowSprite.position.x = _sunX;
  sunRimGlow.position.x   = _sunX;
  const _camWP = camera.getWorldPosition(_sunBillboardV3);
  sunGlowSprite.lookAt(_camWP);
  sunCapMesh.lookAt(_camWP);

  // Fire meshes track thrusterPower every frame (no timing gaps)
  for (const fm of shipFireMeshes) fm.visible = state.thrusterPower > 0 && window._thrusterVisible !== false;
  // Tick alt ship animation mixer
  if (_altShipActive && _altShipMixer) _altShipMixer.update(rawDt);
  // ── Death sky pivot camera (runs in animate so it works during dead phase) ──
  if (_expCamOrbitActive && state.phase === 'dead') {
    _expCamOrbitT = Math.min(1, _expCamOrbitT + _EXP_CAM_ORBIT_SPEED * rawDt);
    const easeT = 1 - Math.pow(1 - _expCamOrbitT, 3);
    cameraPivot.position.y = THREE.MathUtils.lerp(_expCamAnchorY, _expCamAnchorY + _EXP_CAM_RISE, easeT);
    cameraPivot.position.z = THREE.MathUtils.lerp(_expCamAnchorZ, _expCamAnchorZ + _EXP_CAM_PULLBACK, easeT);
    const lateralDir = (_expCrashWorldPos.x >= 0) ? 1 : -1;
    cameraPivot.position.x = THREE.MathUtils.lerp(_expCamAnchorX, _expCamAnchorX + lateralDir * _EXP_CAM_LATERAL, easeT);
    camera.lookAt(_expCrashWorldPos.x, _expCrashWorldPos.y, _expCrashWorldPos.z - 2);
  }
  // Tick explosion particles + all VFX layers (runs during dead phase too)
  _updateExplosion(rawDt);
  _updateFlash(rawDt);
  _updateShockwave(rawDt);
  _updateSparks(rawDt);
  _updateFaceExplosion(rawDt);
  // ── Update localized heat haze pass (low poly only) ──
  {
    _thrusterHazePass.enabled = window._coneThrustersEnabled && state.phase === 'playing' && state.thrusterPower > 0.01;
    if (_thrusterHazePass.enabled) {
      const _hzProj = new THREE.Vector3();
      let _hazeValid = true;
      // Project left nozzle to screen UV
      const nwL = nozzleWorld(_localNozzles[0]);
      _hzProj.set(nwL.x, nwL.y, nwL.z).project(camera);
      if (_hzProj.z > 1 || _hzProj.z < -1) _hazeValid = false;
      _thrusterHazePass.uniforms.uNozzleL.value.set(_hzProj.x * 0.5 + 0.5, _hzProj.y * 0.5 + 0.5);
      // Project right nozzle to screen UV
      const nwR = nozzleWorld(_localNozzles[1]);
      _hzProj.set(nwR.x, nwR.y, nwR.z).project(camera);
      if (_hzProj.z > 1 || _hzProj.z < -1) _hazeValid = false;
      _thrusterHazePass.uniforms.uNozzleR.value.set(_hzProj.x * 0.5 + 0.5, _hzProj.y * 0.5 + 0.5);
      _thrusterHazePass.uniforms.uTime.value = performance.now() * 0.001;
      // Kill haze if nozzles aren't on screen
      _thrusterHazePass.uniforms.uIntensity.value = _hazeValid
        ? (window._hazeBaseIntensity != null ? window._hazeBaseIntensity : 0.10) * state.thrusterPower
        : 0.0;
      _thrusterHazePass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
    }
  }
  _perfDiag.markRenderStart();
  composer.render();
  _perfDiag.markRenderEnd();
  if (_fpsOn) _lastDC = renderer.info.render.calls;
  updateDebug();
  _perfDiag.frameEnd();
}

// ═══════════════════════════════════════════════════
//  RESIZE
// ═══════════════════════════════════════════════════
function updateCameraFOV() {
  const isMobile = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const isLandscape = window.innerWidth > window.innerHeight;
  if (isMobile && isLandscape) {
    // ── Mobile landscape settings (baked from tuner) ──
    _baseFOV = 60;
    camera.fov = 60;
    _camLookYOffset = -5.00;
    _camLookZOffset = 2.00;
    _camPivotYOffset = 0.90;
    _camPivotZOffset = -0.80;
    shipGroup.scale.setScalar(0.40);
    _skyQuadMat.uniforms.uOffsetY.value = -0.16;
  } else if (isMobile && !isLandscape) {
    // ── Mobile portrait settings (baked from tuner) ──
    _baseFOV = 79;
    camera.fov = 79;
    _camLookYOffset = -5.00;
    _camLookZOffset = 0.50;
    _camPivotYOffset = 0.00;
    _camPivotZOffset = -1.80;
    shipGroup.scale.setScalar(0.30);
    _skyQuadMat.uniforms.uOffsetY.value = -0.16;
  } else {
    // ── Desktop settings (baked from tuner) ──
    _baseFOV = 65 + _camFOVOffset;
    camera.fov = _baseFOV;
    _camPivotZOffset = -1.50;
    _skyQuadMat.uniforms.uOffsetY.value = -0.24;
  }
  // Apply pivot offsets immediately (not just in animate loop)
  // X must be zeroed here — if a resize fires mid-gameplay the animate loop
  // will restore it to shipX on the next frame, but lookAt must be computed
  // from a centered pivot or the camera angle drifts permanently.
  cameraPivot.position.x = (state && state.phase === 'playing') ? (camTargetX || 0) : 0;
  cameraPivot.position.y = 2.8 + _camPivotYOffset;
  cameraPivot.position.z = 9 + _camPivotZOffset;
  camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
  _applyOrientationNozzles(); // swap portrait/landscape nozzles if applicable
  _rebuildLocalNozzles();
  camera.updateProjectionMatrix();
}

function _doResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Gameplay camera
  camera.aspect = w / h;
  updateCameraFOV();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(Math.floor(w / 2), Math.floor(h / 2));
  reflectRT.setSize(Math.floor(w * 0.5), Math.floor(h * 0.5));
  mirrorCamera.aspect = w / h;
  mirrorCamera.updateProjectionMatrix();
}
let _resizeTimer = 0;
window.addEventListener('resize', () => {
  _doResize();
  // iOS Safari fires resize before rotation animation finishes —
  // re-measure after a short delay to catch the final dimensions
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(_doResize, 150);
});

// ═══════════════════════════════════════════════════
//  TESTING HOOKS
// ═══════════════════════════════════════════════════
window.render_game_to_text = () => JSON.stringify({
  phase: state.phase,
  score: state.score,
  level: state.currentLevelIdx + 1,
  speed: +state.speed.toFixed(2),
  shipX: +state.shipX.toFixed(2),
  obstacles: activeObstacles.length,
  powerups: activePowerups.length,
  shield: state.shieldActive,
  laser: state.laserActive,
  multiplier: state.multiplier,
});

window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i++) update(FIXED_DT);
  renderer.info.reset();
  composer.render();
};


// ═══════════════════════════════════════════════════
//  VISIBILITY CHANGE — auto-pause when app loses focus (mobile)
// ═══════════════════════════════════════════════════
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause all audio immediately regardless of game state
    const tracks = allTracks();
    Object.values(tracks).forEach(el => { if (el && !el.paused) el.pause(); });
    const _engV = document.getElementById('engine-start');
    if (_engV && !_engV.paused) _engV.pause();
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => {});
    // If actively playing, trigger a proper game pause
    if (state.phase === 'playing') {
      togglePause();
    }
  } else {
    // Tab/app regained focus — resume AudioContext so sounds work again
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    // Restore audio for the current screen
    if (!state.muted) {
      if (state.phase === 'title' || state.phase === 'dead' || state.phase === 'paused') {
        // Title/gameover/paused all play title music
        if (titleMusic) titleMusic.play().catch(() => {});
      }
      // Paused: also resume lake ambience (was playing during gameplay)
      if (state.phase === 'paused' && lakeMusic) lakeMusic.play().catch(() => {});
    }
  }
});

// ═══════════════════════════════════════════════════
//  MOBILE TITLE SCREEN — swap SPACE button for TAP TO PLAY
// ═══════════════════════════════════════════════════
(function mobileTitleSetup() {
  const isMobile = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  if (!isMobile) return;
  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.textContent = 'CAMPAIGN';
})();

// ── Init
applyLevelVisuals(LEVELS[0]);
applySkin(loadSkinData().selected); // re-apply skin lighting after level visuals
applyTitleSkin(loadSkinData().selected);
updateTitleBadges();
updateCameraFOV(); // set correct FOV on load (mobile landscape)

// Title-screen shader prewarm: compile all materials that are already in the
// scene graph so the 33-shader / 400ms+ first-frame hitch happens during
// loading instead of on the first rendered frame. Safe because renderer.compile()
// is a no-op for materials already compiled.
try {
  renderer.compile(scene, camera);
  if (typeof titleScene !== 'undefined' && titleScene) renderer.compile(titleScene, camera);
} catch (e) { /* non-fatal */ }

clock.start();
animate();
// iOS Safari: viewport may not be settled on first paint (address bar, safe area).
// Re-run camera FOV + renderer sizing only while still on title screen.
setTimeout(() => { if (state.phase === 'title') { _doResize(); } }, 300);
setTimeout(() => { if (state.phase === 'title') { _doResize(); } }, 800);

// deploy nudge

// ═══════════════════════════════════════════════════
//  SKIN TUNER — live material property sliders
// ═══════════════════════════════════════════════════

let _skinTunerOpen = false;
let _tunerSavedShipPos = null;
let _tunerSavedShipRot = null;
let _tunerSavedCamPivot = null;
let _tunerSavedCamPos = null;


function toggleSkinTuner() {
  _skinTunerOpen = !_skinTunerOpen;
  document.getElementById('skin-tuner').style.display = _skinTunerOpen ? 'block' : 'none';
  if (_skinTunerOpen) {
    // Save ship + camera state
    _tunerSavedShipPos = shipGroup.position.clone();
    _tunerSavedShipRot = shipGroup.rotation.clone();
    _tunerSavedCamPivot = cameraPivot.position.clone();
    _tunerSavedCamPos = camera.position.clone();

    // Position ship right in front of camera, centered, facing camera (no spin)
    cameraPivot.position.set(0, 2.8, 9);
    camera.position.set(0, 0, 0);
    shipGroup.position.set(0, 1.8, 4.5);
    shipGroup.rotation.set(0, Math.PI, 0);

    // Hide the entire title-screen overlay so the 3D canvas is fully visible
    const titleEl = document.getElementById('title-screen');
    if (titleEl) titleEl.style.display = 'none';

    // Orbit drag — click & drag on canvas to rotate ship
    if (!window._tunerDragBound) {
      window._tunerDragBound = true;
      let dragging = false, lastX = 0, lastY = 0;
      renderer.domElement.addEventListener('pointerdown', e => {
        if (!_skinTunerOpen) return;
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        renderer.domElement.setPointerCapture(e.pointerId);
      });
      renderer.domElement.addEventListener('pointermove', e => {
        if (!_skinTunerOpen || !dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        shipGroup.rotation.y += dx * 0.01;
        shipGroup.rotation.x += dy * 0.01;
        lastX = e.clientX; lastY = e.clientY;
      });
      renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
    }

    buildSkinTunerSliders();
  } else {
    // Restore ship + camera
    if (_tunerSavedShipPos) shipGroup.position.copy(_tunerSavedShipPos);
    if (_tunerSavedShipRot) shipGroup.rotation.copy(_tunerSavedShipRot);
    if (_tunerSavedCamPivot) cameraPivot.position.copy(_tunerSavedCamPivot);
    if (_tunerSavedCamPos) camera.position.copy(_tunerSavedCamPos);

    // Restore title screen
    const titleEl = document.getElementById('title-screen');
    if (titleEl) titleEl.style.display = '';
  }
}
window.toggleSkinTuner = toggleSkinTuner;

// Show tuner button when admin mode activates
const _origAdminToggle = document.getElementById('skin-viewer-label');
if (_origAdminToggle) {
  const origClick = _origAdminToggle.onclick;
  // MutationObserver on the label color to detect admin mode
  new MutationObserver(() => {
    document.getElementById('skin-tuner-btn').style.display = _skinAdminMode ? 'block' : 'none';
  }).observe(_origAdminToggle, { attributes: true, attributeFilter: ['style'] });
}

function buildSkinTunerSliders() {
  const container = document.getElementById('skin-tuner-sliders');
  container.innerHTML = '';
  const skinName = SHIP_SKINS[skinViewerIdx] ? SHIP_SKINS[skinViewerIdx].name : 'Unknown';
  document.getElementById('skin-tuner-current').textContent = 'Skin: ' + skinName + ' (#' + skinViewerIdx + ')';

  if (!window._shipModel) { container.textContent = 'Ship not loaded'; return; }

  // ── Collect meshes by group ──
  const GROUPS = [
    { label: 'HULL',      parts: ['rocket_base', 'gray'], color: '#0f8' },
    { label: 'TRIM',      parts: ['white'],               color: '#0cf' },
    { label: 'NOZZLE',    parts: ['nozzle'],               color: '#f80' },
    { label: 'THRUSTERS', parts: ['rocket_light'],         color: '#f0f' },
  ];

  const allMeshes = [];
  window._shipModel.traverse(child => {
    if (!child.isMesh) return;
    const name = child.userData._origMatName || child.name || 'unnamed';
    if (name === 'fire' || name === 'fire1') return;
    allMeshes.push({ name, mesh: child });
  });

  // ── Helper: create slider row ──
  function makeSlider(label, val, min, max, step, onChange, accentColor) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'width:120px;flex-shrink:0;font-size:11px;';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step;
    slider.value = val;
    slider.style.cssText = 'flex:1;height:14px;cursor:pointer;accent-color:' + (accentColor || '#0af') + ';';
    const valSpan = document.createElement('span');
    valSpan.textContent = Number(val).toFixed(step < 0.1 ? 2 : 1);
    valSpan.style.cssText = 'width:42px;text-align:right;font-size:10px;';
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valSpan.textContent = Number(v).toFixed(step < 0.1 ? 2 : 1);
      onChange(v);
    });
    row.appendChild(lbl); row.appendChild(slider); row.appendChild(valSpan);
    return row;
  }

  // ── Helper: HSL from THREE.Color ──
  function getHSL(color) {
    const hsl = {};
    color.getHSL(hsl);
    return hsl;
  }

  // No extra tuner spotlight — use actual scene lighting so preview matches L1

  // ── PER-GROUP CONTROLS ──
  GROUPS.forEach(group => {
    const mats = [];
    allMeshes.forEach(({ name, mesh }) => {
      if (group.parts.includes(name) && mesh.material) mats.push(mesh.material);
    });
    if (!mats.length) return;

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px;border-bottom:1px solid #333;padding-bottom:10px;';

    const header = document.createElement('div');
    header.style.cssText = 'font-weight:bold;color:' + group.color + ';margin-bottom:6px;font-size:13px;';
    header.textContent = group.label;
    section.appendChild(header);

    // Get average HSL from the group's base colors
    const avgHSL = { h: 0, s: 0, l: 0 };
    let count = 0;
    mats.forEach(m => {
      if (m.color) {
        const hsl = getHSL(m.color);
        avgHSL.h += hsl.h; avgHSL.s += hsl.s; avgHSL.l += hsl.l;
        count++;
      }
    });
    if (count) { avgHSL.h /= count; avgHSL.s /= count; avgHSL.l /= count; }

    // 1) HUE slider — sweep through full color spectrum
    section.appendChild(makeSlider('Hue', avgHSL.h, 0, 1, 0.005, v => {
      mats.forEach(m => {
        if (!m.color) return;
        const hsl = getHSL(m.color);
        m.color.setHSL(v, hsl.s, hsl.l);
      });
    }, group.color));

    // 2) SATURATION
    section.appendChild(makeSlider('Saturation', avgHSL.s, 0, 1, 0.01, v => {
      mats.forEach(m => {
        if (!m.color) return;
        const hsl = getHSL(m.color);
        m.color.setHSL(hsl.h, v, hsl.l);
      });
    }, group.color));

    // 3) BRIGHTNESS (lightness)
    section.appendChild(makeSlider('Brightness', avgHSL.l, 0, 1, 0.01, v => {
      mats.forEach(m => {
        if (!m.color) return;
        const hsl = getHSL(m.color);
        m.color.setHSL(hsl.h, hsl.s, v);
      });
    }, group.color));

    // 4) EMISSIVE GLOW — color + intensity combo
    if (mats.some(m => m.emissive !== undefined)) {
      const firstE = mats.find(m => m.emissive);
      const eHSL = firstE ? getHSL(firstE.emissive) : { h: 0, s: 1, l: 0.5 };
      const eInt = firstE ? (firstE.emissiveIntensity || 0) : 0;

      section.appendChild(makeSlider('Glow Hue', eHSL.h, 0, 1, 0.005, v => {
        mats.forEach(m => {
          if (!m.emissive) return;
          const hsl = getHSL(m.emissive);
          m.emissive.setHSL(v, Math.max(hsl.s, 0.8), Math.max(hsl.l, 0.5));
        });
      }, '#ff0'));

      section.appendChild(makeSlider('Glow Power', eInt, 0, 20, 0.1, v => {
        mats.forEach(m => {
          if (m.emissiveIntensity !== undefined) m.emissiveIntensity = v;
          // If glow was off, set a default emissive color
          if (v > 0 && m.emissive && m.emissive.getHex() === 0) {
            m.emissive.setHSL(0.6, 1, 0.5);
          }
        });
      }, '#ff0'));
    }

    // 5) FRESNEL RIM GLOW — inject via onBeforeCompile for real-time rim lighting
    // Instead of shader injection (would break existing compiled shaders), use emissive trick:
    // We add a "rim intensity" that brightens edges. Simulated by increasing emissive when metalness is set.
    // More practical: just expose metalness as "Reflectivity" since scene has good lighting
    const avgMet = mats.reduce((s, m) => s + (m.metalness || 0), 0) / mats.length;
    section.appendChild(makeSlider('Reflectivity', avgMet, 0, 1, 0.01, v => {
      mats.forEach(m => { if (m.metalness !== undefined) { m.metalness = v; m.needsUpdate = true; } });
    }, group.color));

    // 6) GLOSSINESS (inverse of roughness — more intuitive)
    const avgGloss = 1.0 - (mats.reduce((s, m) => s + (m.roughness || 0.5), 0) / mats.length);
    section.appendChild(makeSlider('Glossiness', avgGloss, 0, 1, 0.01, v => {
      mats.forEach(m => { if (m.roughness !== undefined) { m.roughness = 1.0 - v; m.needsUpdate = true; } });
    }, group.color));

    container.appendChild(section);
  });

  // ═══════════════════════════════════════════════════
  //  GLOBAL FINISH + WEIRD FX (all skins)
  // ═══════════════════════════════════════════════════
  {
    const finishHeader = document.createElement('div');
    finishHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#aaf;margin:16px 0 8px;border-top:2px solid #aaf;padding-top:8px;';
    finishHeader.textContent = 'GLOBAL FINISH';
    container.appendChild(finishHeader);

    // Collect ALL ship materials
    const allShipMats = [];
    allMeshes.forEach(({ mesh }) => { if (mesh.material) allShipMats.push(mesh.material); });

    // MATTE slider — overrides roughness on everything
    container.appendChild(makeSlider('Matte', 0, 0, 1, 0.01, v => {
      allShipMats.forEach(m => {
        if (m.roughness !== undefined) { m.roughness = v; m.needsUpdate = true; }
      });
    }, '#aaf'));

    // ── WEIRD FX ──
    const weirdHeader = document.createElement('div');
    weirdHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#f0f;margin:16px 0 8px;border-top:2px solid #f0f;padding-top:8px;';
    weirdHeader.textContent = 'WEIRD FX';
    container.appendChild(weirdHeader);

    // 1) Fresnel Rim Glow — add emissive at grazing angles
    if (!window._fresnelPass) {
      const fs = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 }, color: { value: new THREE.Vector3(0.2, 0.6, 1.0) } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;uniform vec3 color;
          varying vec2 vUv;
          void main(){
            vec4 c=texture2D(tDiffuse,vUv);
            float lum=dot(c.rgb,vec3(0.299,0.587,0.114));
            vec2 uvc=vUv*2.0-1.0;
            float edge=length(uvc);
            float rim=smoothstep(0.3,1.0,edge);
            c.rgb+=color*rim*intensity;
            gl_FragColor=c;
          }`,
      };
      window._fresnelPass = new ShaderPass(fs);
      window._fresnelPass.enabled = false;
      composer.addPass(window._fresnelPass);
    }

    // 2) Holographic / Iridescence — hue shift based on screen position
    if (!window._holoPass) {
      const hs = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 }, time: { value: 0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;uniform float time;
          varying vec2 vUv;
          vec3 hueRot(vec3 c,float h){float a=h*6.28318;vec3 k=vec3(0.57735);float ca=cos(a);float sa=sin(a);return c*ca+cross(k,c)*sa+k*dot(k,c)*(1.0-ca);}
          void main(){
            vec4 c=texture2D(tDiffuse,vUv);
            float lum=dot(c.rgb,vec3(0.299,0.587,0.114));
            if(lum>0.05){
              float shift=vUv.x*0.5+vUv.y*0.3+time*0.1;
              c.rgb=mix(c.rgb,hueRot(c.rgb,fract(shift)),intensity);
            }
            gl_FragColor=c;
          }`,
      };
      window._holoPass = new ShaderPass(hs);
      window._holoPass.enabled = false;
      composer.addPass(window._holoPass);
    }

    // 3) Pulse / Breathe — sinusoidal brightness oscillation
    if (!window._pulsePass) {
      const ps = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 }, speed: { value: 2.0 }, time: { value: 0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;uniform float speed;uniform float time;
          varying vec2 vUv;
          void main(){
            vec4 c=texture2D(tDiffuse,vUv);
            float pulse=sin(time*speed)*0.5+0.5;
            c.rgb*=1.0+pulse*intensity;
            gl_FragColor=c;
          }`,
      };
      window._pulsePass = new ShaderPass(ps);
      window._pulsePass.enabled = false;
      composer.addPass(window._pulsePass);
    }

    // 4) Negative / Invert
    if (!window._invertPass) {
      const is = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;
          varying vec2 vUv;
          void main(){
            vec4 c=texture2D(tDiffuse,vUv);
            vec3 inv=1.0-c.rgb;
            c.rgb=mix(c.rgb,inv,intensity);
            gl_FragColor=c;
          }`,
      };
      window._invertPass = new ShaderPass(is);
      window._invertPass.enabled = false;
      composer.addPass(window._invertPass);
    }

    // 5) RGB Split / Glitch
    if (!window._rgbSplitPass) {
      const rs = {
        uniforms: { tDiffuse: { value: null }, amount: { value: 0.0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float amount;
          varying vec2 vUv;
          void main(){
            float o=amount;
            vec4 cr=texture2D(tDiffuse,vec2(vUv.x+o,vUv.y));
            vec4 cg=texture2D(tDiffuse,vUv);
            vec4 cb=texture2D(tDiffuse,vec2(vUv.x-o,vUv.y));
            gl_FragColor=vec4(cr.r,cg.g,cb.b,1.0);
          }`,
      };
      window._rgbSplitPass = new ShaderPass(rs);
      window._rgbSplitPass.enabled = false;
      composer.addPass(window._rgbSplitPass);
    }

    // 6) Pixelate
    if (!window._pixelPass) {
      const px = {
        uniforms: { tDiffuse: { value: null }, pixels: { value: 0.0 }, resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float pixels;uniform vec2 resolution;
          varying vec2 vUv;
          void main(){
            if(pixels<=0.0){gl_FragColor=texture2D(tDiffuse,vUv);return;}
            float px=pixels*resolution.x/800.0;
            vec2 d=vec2(px)/resolution;
            vec2 uv=d*floor(vUv/d)+d*0.5;
            gl_FragColor=texture2D(tDiffuse,uv);
          }`,
      };
      window._pixelPass = new ShaderPass(px);
      window._pixelPass.enabled = false;
      composer.addPass(window._pixelPass);
    }

    // 7) Noise Grit / Battle-worn — adds noisy darkening
    if (!window._gritPass) {
      const gp = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 }, scale: { value: 200.0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;uniform float scale;
          varying vec2 vUv;
          float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
          float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
          void main(){
            vec4 c=texture2D(tDiffuse,vUv);
            float n=noise(vUv*scale);
            float wear=1.0-intensity*n*0.7;
            float scratch=noise(vUv*scale*3.0+vec2(17.3,91.7));
            wear-=step(0.92,scratch)*intensity*0.3;
            c.rgb*=max(wear,0.0);
            gl_FragColor=c;
          }`,
      };
      window._gritPass = new ShaderPass(gp);
      window._gritPass.enabled = false;
      composer.addPass(window._gritPass);
    }

    // 8) Heat Warp — wavy distortion like heat shimmer
    if (!window._heatPass) {
      const hp = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 }, time: { value: 0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;uniform float time;
          varying vec2 vUv;
          void main(){
            vec2 uv=vUv;
            uv.x+=sin(uv.y*20.0+time*3.0)*intensity*0.01;
            uv.y+=cos(uv.x*15.0+time*2.5)*intensity*0.008;
            gl_FragColor=texture2D(tDiffuse,uv);
          }`,
      };
      window._heatPass = new ShaderPass(hp);
      window._heatPass.enabled = false;
      composer.addPass(window._heatPass);
    }

    // Tick time for animated passes
    if (!window._weirdFxTickAdded) {
      window._weirdFxTickAdded = true;
      const _origRender2 = composer.render.bind(composer);
      composer.render = function() {
        const t = performance.now() * 0.001;
        if (window._holoPass && window._holoPass.enabled) window._holoPass.uniforms.time.value = t;
        if (window._pulsePass && window._pulsePass.enabled) window._pulsePass.uniforms.time.value = t;
        if (window._heatPass && window._heatPass.enabled) window._heatPass.uniforms.time.value = t;
        _origRender2();
      };
    }

    const WEIRD_FX = [
      { label: 'Rim Glow',     pass: window._fresnelPass,  uniform: 'intensity', min: 0, max: 3,    step: 0.05 },
      { label: 'Holographic',   pass: window._holoPass,     uniform: 'intensity', min: 0, max: 1,    step: 0.01 },
      { label: 'Pulse',         pass: window._pulsePass,    uniform: 'intensity', min: 0, max: 2,    step: 0.05 },
      { label: 'Negative',      pass: window._invertPass,   uniform: 'intensity', min: 0, max: 1,    step: 0.01 },
      { label: 'RGB Split',     pass: window._rgbSplitPass, uniform: 'amount',    min: 0, max: 0.05, step: 0.001 },
      { label: 'Pixelate',      pass: window._pixelPass,    uniform: 'pixels',    min: 0, max: 20,   step: 0.5 },
      { label: 'Battle Worn',   pass: window._gritPass,     uniform: 'intensity', min: 0, max: 2,    step: 0.05 },
      { label: 'Heat Warp',     pass: window._heatPass,     uniform: 'intensity', min: 0, max: 3,    step: 0.05 },
    ];

    WEIRD_FX.forEach(fx => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox'; toggle.checked = fx.pass.enabled;
      toggle.style.cssText = 'margin:0;cursor:pointer;accent-color:#f0f;';
      const label = document.createElement('span');
      label.textContent = fx.label;
      label.style.cssText = 'width:90px;flex-shrink:0;';
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = fx.min; slider.max = fx.max; slider.step = fx.step;
      slider.value = fx.pass.uniforms[fx.uniform].value;
      slider.style.cssText = 'flex:1;height:14px;cursor:pointer;accent-color:#f0f;';
      const valSpan = document.createElement('span');
      valSpan.textContent = Number(fx.pass.uniforms[fx.uniform].value).toFixed(3);
      valSpan.style.cssText = 'width:45px;text-align:right;font-size:10px;';
      toggle.addEventListener('change', () => { fx.pass.enabled = toggle.checked; });
      slider.addEventListener('input', () => {
        fx.pass.uniforms[fx.uniform].value = parseFloat(slider.value);
        valSpan.textContent = Number(slider.value).toFixed(3);
        if (parseFloat(slider.value) > 0 && !toggle.checked) { toggle.checked = true; fx.pass.enabled = true; }
      });
      row.appendChild(toggle); row.appendChild(label); row.appendChild(slider); row.appendChild(valSpan);
      container.appendChild(row);
    });
  }

  // ═══════════════════════════════════════════════════
  //  SHIP LIGHTING
  // ═══════════════════════════════════════════════════
  {
    const lightHeader = document.createElement('div');
    lightHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#ff8;margin:16px 0 8px;border-top:2px solid #ff8;padding-top:8px;';
    lightHeader.textContent = 'SHIP LIGHTING';
    container.appendChild(lightHeader);

    // Key Light
    const keyLabel = document.createElement('div');
    keyLabel.style.cssText = 'font-size:11px;font-weight:bold;color:#ff8;margin:8px 0 4px;';
    keyLabel.textContent = 'Key Light';
    container.appendChild(keyLabel);

    container.appendChild(makeSlider('Intensity', _shipKeyLight.intensity, 0, 6, 0.1, v => { _shipKeyLight.intensity = v; }, '#ff8'));
    container.appendChild(makeSlider('X', _shipKeyLight.position.x, -10, 10, 0.5, v => { _shipKeyLight.position.x = v; }, '#ff8'));
    container.appendChild(makeSlider('Y', _shipKeyLight.position.y, -10, 10, 0.5, v => { _shipKeyLight.position.y = v; }, '#ff8'));
    container.appendChild(makeSlider('Z', _shipKeyLight.position.z, -10, 10, 0.5, v => { _shipKeyLight.position.z = v; }, '#ff8'));

    // Key light color hue
    const kCol = _shipKeyLight.color;
    const kHSL = {}; kCol.getHSL(kHSL);
    container.appendChild(makeSlider('Hue', kHSL.h, 0, 1, 0.005, v => {
      const h = {}; kCol.getHSL(h);
      kCol.setHSL(v, h.s, h.l);
    }, '#ff8'));
    container.appendChild(makeSlider('Saturation', kHSL.s, 0, 1, 0.01, v => {
      const h = {}; kCol.getHSL(h);
      kCol.setHSL(h.h, v, h.l);
    }, '#ff8'));

    // Fill Light
    const fillLabel = document.createElement('div');
    fillLabel.style.cssText = 'font-size:11px;font-weight:bold;color:#8bf;margin:12px 0 4px;';
    fillLabel.textContent = 'Fill Light';
    container.appendChild(fillLabel);

    container.appendChild(makeSlider('Intensity', _shipFillLight.intensity, 0, 4, 0.1, v => { _shipFillLight.intensity = v; }, '#8bf'));
    container.appendChild(makeSlider('X', _shipFillLight.position.x, -10, 10, 0.5, v => { _shipFillLight.position.x = v; }, '#8bf'));
    container.appendChild(makeSlider('Y', _shipFillLight.position.y, -10, 10, 0.5, v => { _shipFillLight.position.y = v; }, '#8bf'));
    container.appendChild(makeSlider('Z', _shipFillLight.position.z, -10, 10, 0.5, v => { _shipFillLight.position.z = v; }, '#8bf'));

    // Fill light color hue
    const fCol = _shipFillLight.color;
    const fHSL = {}; fCol.getHSL(fHSL);
    container.appendChild(makeSlider('Hue', fHSL.h, 0, 1, 0.005, v => {
      const h = {}; fCol.getHSL(h);
      fCol.setHSL(v, h.s, h.l);
    }, '#8bf'));
    container.appendChild(makeSlider('Saturation', fHSL.s, 0, 1, 0.01, v => {
      const h = {}; fCol.getHSL(h);
      fCol.setHSL(h.h, v, h.l);
    }, '#8bf'));
  }

  // ═══════════════════════════════════════════════════
  //  SHADER PATTERN CONTROLS (skin-specific)
  // ═══════════════════════════════════════════════════
  if (window._diamondUniforms && skinViewerIdx === 2) {
    const shaderHeader = document.createElement('div');
    shaderHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#0ff;margin:16px 0 8px;border-top:2px solid #0ff;padding-top:8px;';
    shaderHeader.textContent = 'DIAMOND PLATE SHADER';
    container.appendChild(shaderHeader);

    const du = window._diamondUniforms;

    container.appendChild(makeSlider('Pattern Scale', du.dScale.value, 0.5, 10, 0.1, v => { du.dScale.value = v; }, '#0ff'));
    container.appendChild(makeSlider('Bump Depth', du.dBump.value, 0, 3, 0.05, v => { du.dBump.value = v; }, '#0ff'));
    container.appendChild(makeSlider('Edge Sharpness', du.dEdgeMin.value, 0.05, 0.45, 0.01, v => { du.dEdgeMin.value = v; }, '#0ff'));
    container.appendChild(makeSlider('Edge Width', du.dEdgeMax.value, 0.2, 0.8, 0.01, v => { du.dEdgeMax.value = v; }, '#0ff'));

    const glowSubheader = document.createElement('div');
    glowSubheader.style.cssText = 'font-size:11px;font-weight:bold;color:#0ff;margin:8px 0 4px;';
    glowSubheader.textContent = 'Seam Glow';
    container.appendChild(glowSubheader);

    // Glow color as HSL hue for easy sweeping
    const glowCol = new THREE.Color(du.dGlowR.value, du.dGlowG.value, du.dGlowB.value);
    const glowHSL = {};
    glowCol.getHSL(glowHSL);

    container.appendChild(makeSlider('Glow Hue', glowHSL.h, 0, 1, 0.005, v => {
      const c = new THREE.Color();
      c.setHSL(v, 1.0, 0.6);
      du.dGlowR.value = c.r; du.dGlowG.value = c.g; du.dGlowB.value = c.b;
    }, '#0ff'));

    container.appendChild(makeSlider('Glow Intensity', du.dGlowMul.value, 0, 10, 0.1, v => { du.dGlowMul.value = v; }, '#0ff'));
    container.appendChild(makeSlider('Glow Tightness', du.dGlowEdgeMin.value, 0.1, 0.49, 0.01, v => { du.dGlowEdgeMin.value = v; }, '#0ff'));
  }

  // ═══════════════════════════════════════════════════
  //  SCENE LIGHTING CONTROLS
  // ═══════════════════════════════════════════════════
  const lightHeader = document.createElement('div');
  lightHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#ff0;margin:16px 0 8px;border-top:2px solid #ff0;padding-top:8px;';
  lightHeader.textContent = 'SCENE LIGHTING';
  container.appendChild(lightHeader);

  // Key light intensity
  container.appendChild(makeSlider('Key Light', dirLight.intensity, 0, 5, 0.05, v => {
    dirLight.intensity = v;
  }, '#ff0'));

  // Ambient intensity
  container.appendChild(makeSlider('Ambient', ambientLight.intensity, 0, 1, 0.01, v => {
    ambientLight.intensity = v;
  }, '#ff0'));

  // Exposure
  container.appendChild(makeSlider('Exposure', renderer.toneMappingExposure, 0.1, 3, 0.01, v => {
    renderer.toneMappingExposure = v;
  }, '#ff0'));

  // ═══════════════════════════════════════════════════
  //  POST-PROCESSING FX (kept from before)
  // ═══════════════════════════════════════════════════
  const fxHeader = document.createElement('div');
  fxHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#f80;margin:16px 0 8px;border-top:2px solid #f80;padding-top:8px;';
  fxHeader.textContent = 'POST-PROCESSING FX';
  container.appendChild(fxHeader);

  container.appendChild(makeSlider('Bloom', bloom.strength, 0, 3, 0.01, v => { bloom.strength = v; }, '#f80'));
  container.appendChild(makeSlider('Bloom Radius', bloom.radius, 0, 1, 0.01, v => { bloom.radius = v; }, '#f80'));
  container.appendChild(makeSlider('Vignette', vignettePass.uniforms.darkness.value, 0, 2, 0.01, v => { vignettePass.uniforms.darkness.value = v; }, '#f80'));
  container.appendChild(makeSlider('Chromatic Aberr.', vignettePass.uniforms.aberration.value, 0, 0.02, 0.0001, v => { vignettePass.uniforms.aberration.value = v; }, '#f80'));

  // ── EXTRA TOGGLEABLE FX ──
  const extraHeader = document.createElement('div');
  extraHeader.style.cssText = 'font-size:12px;font-weight:bold;color:#f80;margin:12px 0 6px;';
  extraHeader.textContent = 'EXTRA EFFECTS (toggle + intensity)';
  container.appendChild(extraHeader);

  // Film Grain pass
  if (!window._grainPass) {
    const gs = {
      uniforms: { tDiffuse: { value: null }, amount: { value: 0.0 }, time: { value: 0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tDiffuse;uniform float amount;uniform float time;varying vec2 vUv;float rand(vec2 co){return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453);}void main(){vec4 c=texture2D(tDiffuse,vUv);float n=rand(vUv*time)*2.0-1.0;c.rgb+=n*amount;gl_FragColor=c;}',
    };
    window._grainPass = new ShaderPass(gs);
    window._grainPass.enabled = false;
    composer.addPass(window._grainPass);
  }
  // Scanlines pass
  if (!window._scanPass) {
    const ss = {
      uniforms: { tDiffuse: { value: null }, count: { value: 400 }, intensity: { value: 0.0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tDiffuse;uniform float count;uniform float intensity;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);float s=sin(vUv.y*count*3.14159)*0.5+0.5;c.rgb=mix(c.rgb,c.rgb*s,intensity);gl_FragColor=c;}',
    };
    window._scanPass = new ShaderPass(ss);
    window._scanPass.enabled = false;
    composer.addPass(window._scanPass);
  }
  // Hue Shift pass
  if (!window._huePass) {
    const hs = {
      uniforms: { tDiffuse: { value: null }, shift: { value: 0.0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tDiffuse;uniform float shift;varying vec2 vUv;vec3 hueRot(vec3 c,float h){float a=h*6.28318;vec3 k=vec3(0.57735);float ca=cos(a);float sa=sin(a);return c*ca+cross(k,c)*sa+k*dot(k,c)*(1.0-ca);}void main(){vec4 c=texture2D(tDiffuse,vUv);c.rgb=hueRot(c.rgb,shift);gl_FragColor=c;}',
    };
    window._huePass = new ShaderPass(hs);
    window._huePass.enabled = false;
    composer.addPass(window._huePass);
  }

  // Tick grain time
  if (!window._grainTickAdded) {
    window._grainTickAdded = true;
    const _origRender = composer.render.bind(composer);
    composer.render = function() {
      if (window._grainPass && window._grainPass.enabled)
        window._grainPass.uniforms.time.value = performance.now() * 0.001;
      _origRender();
    };
  }

  const EXTRA_FX = [
    { label: 'Film Grain',  pass: window._grainPass, uniform: 'amount',    min: 0, max: 0.3, step: 0.005 },
    { label: 'Scanlines',   pass: window._scanPass,  uniform: 'intensity', min: 0, max: 1,   step: 0.01  },
    { label: 'Hue Shift',   pass: window._huePass,   uniform: 'shift',     min: 0, max: 1,   step: 0.01  },
  ];

  EXTRA_FX.forEach(fx => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox'; toggle.checked = fx.pass.enabled;
    toggle.style.cssText = 'margin:0;cursor:pointer;accent-color:#f80;';
    const label = document.createElement('span');
    label.textContent = fx.label;
    label.style.cssText = 'width:90px;flex-shrink:0;';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = fx.min; slider.max = fx.max; slider.step = fx.step;
    slider.value = fx.pass.uniforms[fx.uniform].value;
    slider.style.cssText = 'flex:1;height:14px;cursor:pointer;accent-color:#f80;';
    const valSpan = document.createElement('span');
    valSpan.textContent = Number(fx.pass.uniforms[fx.uniform].value).toFixed(3);
    valSpan.style.cssText = 'width:45px;text-align:right;font-size:10px;';
    toggle.addEventListener('change', () => { fx.pass.enabled = toggle.checked; });
    slider.addEventListener('input', () => {
      fx.pass.uniforms[fx.uniform].value = parseFloat(slider.value);
      valSpan.textContent = Number(slider.value).toFixed(3);
      if (parseFloat(slider.value) > 0 && !toggle.checked) { toggle.checked = true; fx.pass.enabled = true; }
    });
    row.appendChild(toggle); row.appendChild(label); row.appendChild(slider); row.appendChild(valSpan);
    container.appendChild(row);
  });

  // Dump button
  document.getElementById('skin-tuner-dump').onclick = () => {
    const out = { materials: {}, fx: {} };
    allMeshes.forEach(({ name, mesh }) => {
      const m = mesh.material;
      if (!m) return;
      const o = {};
      o.color = '0x' + (m.color ? m.color.getHexString() : '000000');
      o.metalness = m.metalness;
      o.roughness = m.roughness;
      if (m.emissive) o.emissive = '0x' + m.emissive.getHexString();
      if (m.emissiveIntensity) o.emissiveIntensity = m.emissiveIntensity;
      if (m.clearcoat) o.clearcoat = m.clearcoat;
      out.materials[name] = o;
    });
    out.fx.bloomStrength = bloom.strength;
    out.fx.bloomRadius = bloom.radius;
    out.fx.bloomThreshold = bloom.threshold;
    out.fx.exposure = renderer.toneMappingExposure;
    out.fx.vignetteDarkness = vignettePass.uniforms.darkness.value;
    out.fx.vignetteOffset = vignettePass.uniforms.offset.value;
    out.fx.chromaticAberration = vignettePass.uniforms.aberration.value;
    if (window._grainPass) out.fx.filmGrain = window._grainPass.uniforms.amount.value;
    if (window._scanPass) out.fx.scanlines = window._scanPass.uniforms.intensity.value;
    if (window._huePass) out.fx.hueShift = window._huePass.uniforms.shift.value;
    if (window._diamondUniforms) {
      out.diamondShader = {};
      for (const k in window._diamondUniforms) out.diamondShader[k] = window._diamondUniforms[k].value;
    }
    out.lighting = {};
    out.lighting.keyLight = dirLight.intensity;
    out.lighting.ambient = ambientLight.intensity;
    out.lighting.exposure = renderer.toneMappingExposure;

    // Panorama + star tuner values
    out.panorama = {
      brightness: _skyQuadMat.uniforms.uBrightness.value,
      tintR: _skyQuadMat.uniforms.uTintR.value,
      tintG: _skyQuadMat.uniforms.uTintG.value,
      tintB: _skyQuadMat.uniforms.uTintB.value,
      offsetY: _skyQuadMat.uniforms.uOffsetY.value,
      sunFadeR: _skyQuadMat.uniforms.uSunFadeR.value,
      sunFadeSoft: _skyQuadMat.uniforms.uSunFadeSoft.value,
      sunFadeX: _skyQuadMat.uniforms.uSunFadeX.value,
      sunFadeY: _skyQuadMat.uniforms.uSunFadeY.value,
    };
    if (window._starMat) {
      const sm = window._starMat;
      out.twinkleStars = {
        colorR: sm.uniforms.uStarR.value,
        colorG: sm.uniforms.uStarG.value,
        colorB: sm.uniforms.uStarB.value,
        brightness: sm.uniforms.uStarBright.value,
        twinkleMin: sm.uniforms.uTwinkleMin.value,
        twinkleRange: sm.uniforms.uTwinkleRange.value,
        sizeMult: sm.uniforms.uSizeMult.value,
      };
    }

    console.log('SKIN TUNER DUMP:', JSON.stringify(out, null, 2));
    alert('Dumped to console (F12)');
  };
}

// ═══════════════════════════════════════════════════
//  SCENE DEBUG TUNER — press T to toggle (expanded)
// ═══════════════════════════════════════════════════
(function setupSceneTuner() {
  const panel = document.createElement('div');
  panel.id = 'scene-tuner';
  panel.style.cssText = 'display:none;position:fixed;top:0;left:0;width:280px;height:100%;background:rgba(0,0,0,0.92);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;';
  document.body.appendChild(panel);

  function makeSlider(label, val, min, max, step, onChange, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:4px;flex-wrap:wrap;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:100px;color:'+(color||'#aaa')+';font-size:10px;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    inp.style.cssText = 'flex:1;height:14px;accent-color:'+(color||'#0af')+';';
    const valEl = document.createElement('span');
    valEl.style.cssText = 'width:40px;text-align:right;font-size:10px;color:#fff;';
    valEl.textContent = (+val).toFixed(2);
    inp.oninput = () => { onChange(+inp.value); valEl.textContent = (+inp.value).toFixed(2); };
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(valEl);
    return row;
  }

  function makeToggle(label, obj, prop, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:8px;';
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:1px solid '+(color||'#666')+';color:'+(color||'#aaa')+';padding:2px 8px;cursor:pointer;font-family:monospace;font-size:10px;';
    btn.textContent = label + ': ' + (obj[prop] ? 'ON' : 'OFF');
    btn.onclick = () => { obj[prop] = !obj[prop]; btn.textContent = label + ': ' + (obj[prop] ? 'ON' : 'OFF'); };
    row.appendChild(btn);
    return row;
  }

  function makeHeader(text, color) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:8px 0 4px;font-size:11px;font-weight:bold;color:'+(color||'#ff0')+';border-bottom:1px solid #333;padding-bottom:2px;';
    h.textContent = text;
    return h;
  }

  function build() {
    panel.innerHTML = '<div style="font-size:13px;font-weight:bold;color:#0af;margin-bottom:6px;">SCENE TUNER (T)</div>';

    // SPEED TEST — override game speed for tuning visuals at different tiers
    panel.appendChild(makeHeader('SPEED TEST'));
    const _spdLabel = document.createElement('div');
    _spdLabel.style.cssText = 'color:#0ff;font-size:10px;margin:2px 0;font-family:monospace;';
    _spdLabel.textContent = 'OFF (live game speed)';
    panel.appendChild(_spdLabel);
    panel.appendChild(makeSlider('speed mult', 0, 0, 2.5, 0.05, v => {
      if (v <= 0) {
        _tunerSpeedOverride = -1;
        _spdLabel.textContent = 'OFF (live game speed)';
      } else {
        _tunerSpeedOverride = BASE_SPEED * v;
        // label with tier info
        let tier = '';
        if (v <= 1.05)       tier = 'T1';
        else if (v <= 1.25)  tier = 'T2';
        else if (v <= 1.4)   tier = 'T3a';
        else if (v <= 1.55)  tier = 'T4a';
        else if (v <= 1.9)   tier = 'T4b / T5a';
        else if (v <= 2.05)  tier = 'T3b / T5b';
        else if (v <= 2.15)  tier = 'T4c ICE STORM';
        else                 tier = 'T5c VOID / T6+';
        _spdLabel.textContent = v.toFixed(2) + 'x  (' + tier + ')  = ' + (BASE_SPEED * v).toFixed(0);
      }
    }, '#0ff'));

    // JL SEQUENCER
    panel.appendChild(makeHeader('JL SEQUENCER', '#fa0'));
    {
      // Intensity scalar — multiplies into frequency of all active tracks
      const intRow = makeSlider('intensity', _jlIntensity, 0.1, 3.0, 0.05, v => {
        _jlIntensity = v;
      }, '#fa0');
      panel.appendChild(intRow);

      // Live readout: ramp time + active tracks
      const seqInfo = document.createElement('div');
      seqInfo.style.cssText = 'font-family:monospace;font-size:9px;color:#888;margin:3px 0 6px;line-height:1.5;';
      const _refreshSeqInfo = () => {
        if (!state._jetLightningMode) { seqInfo.textContent = 'JL not active'; return; }
        const t = _jlRampTime || 0;
        const active = _JL_TRACKS
          .filter(tr => t >= tr.startT && (tr.endT === null || t < tr.endT))
          .map(tr => tr.id)
          .join(', ');
        seqInfo.textContent = 't=' + t.toFixed(1) + 's  intensity=' + _jlIntensity.toFixed(2) + '\nactive: ' + (active || 'none');
      };
      setInterval(_refreshSeqInfo, 500);
      _refreshSeqInfo();
      panel.appendChild(seqInfo);
    }

    // LIGHTS
    panel.appendChild(makeHeader('LIGHTS'));
    panel.appendChild(makeSlider('dirLight', dirLight.intensity, 0, 5, 0.01, v => dirLight.intensity = v, '#fff'));
    panel.appendChild(makeSlider('dir posX', dirLight.position.x, -20, 20, 0.1, v => dirLight.position.x = v, '#fff'));
    panel.appendChild(makeSlider('dir posY', dirLight.position.y, -20, 20, 0.1, v => dirLight.position.y = v, '#fff'));
    panel.appendChild(makeSlider('dir posZ', dirLight.position.z, -20, 20, 0.1, v => dirLight.position.z = v, '#fff'));
    panel.appendChild(makeSlider('rimLight', rimLight.intensity, 0, 2, 0.01, v => rimLight.intensity = v, '#0ff'));
    panel.appendChild(makeSlider('fillLight', fillLight.intensity, 0, 2, 0.01, v => fillLight.intensity = v, '#f4c'));
    panel.appendChild(makeSlider('sunLight R', sunLight.intensity, 0, 2, 0.01, v => sunLight.intensity = v, '#f90'));
    panel.appendChild(makeSlider('sunLight L', sunLightL.intensity, 0, 2, 0.01, v => sunLightL.intensity = v, '#f90'));
    panel.appendChild(makeSlider('ambient', ambientLight.intensity, 0, 1, 0.01, v => ambientLight.intensity = v, '#888'));

    // BLOOM
    panel.appendChild(makeHeader('BLOOM'));
    panel.appendChild(makeSlider('strength', bloom.strength, 0, 3, 0.01, v => bloom.strength = v, '#f80'));
    panel.appendChild(makeSlider('radius', bloom.radius, 0, 2, 0.01, v => bloom.radius = v, '#f80'));
    panel.appendChild(makeSlider('threshold', bloom.threshold, 0, 2, 0.01, v => bloom.threshold = v, '#f80'));

    // SHIELD
    panel.appendChild(makeHeader('SHIELD'));
    panel.appendChild(makeSlider('hex scale',    shieldMat.uniforms.uHexScale.value,         1, 8,    0.1,  v => shieldMat.uniforms.uHexScale.value = v,           '#0ef'));
    panel.appendChild(makeSlider('edge width',   shieldMat.uniforms.uEdgeWidth.value,         0.01, 0.3, 0.005, v => shieldMat.uniforms.uEdgeWidth.value = v,        '#0ef'));
    panel.appendChild(makeSlider('hex opacity',  shieldMat.uniforms.uHexOpacity.value,        0, 1,    0.01, v => shieldMat.uniforms.uHexOpacity.value = v,          '#0ef'));
    panel.appendChild(makeSlider('fresnel pwr',  shieldMat.uniforms.uFresnelPower.value,      0.5, 5,  0.05, v => shieldMat.uniforms.uFresnelPower.value = v,        '#0ef'));
    panel.appendChild(makeSlider('fresnel str',  shieldMat.uniforms.uFresnelStrength.value,   0, 5,    0.05, v => shieldMat.uniforms.uFresnelStrength.value = v,     '#0ef'));
    panel.appendChild(makeSlider('opacity',      shieldMat.uniforms.uOpacity.value,           0, 2,    0.01, v => shieldMat.uniforms.uOpacity.value = v,             '#0ef'));
    panel.appendChild(makeSlider('flow intens',  shieldMat.uniforms.uFlowIntensity.value,     0, 10,   0.1,  v => shieldMat.uniforms.uFlowIntensity.value = v,       '#0ef'));
    panel.appendChild(makeSlider('flow speed',   shieldMat.uniforms.uFlowSpeed.value,         0, 3,    0.05, v => shieldMat.uniforms.uFlowSpeed.value = v,           '#0ef'));
    panel.appendChild(makeSlider('flow scale',   shieldMat.uniforms.uFlowScale.value,         0.5, 6,  0.1,  v => shieldMat.uniforms.uFlowScale.value = v,          '#0ef'));
    panel.appendChild(makeSlider('flash speed',  shieldMat.uniforms.uFlashSpeed.value,        0, 3,    0.05, v => shieldMat.uniforms.uFlashSpeed.value = v,          '#0ef'));
    panel.appendChild(makeSlider('flash intens', shieldMat.uniforms.uFlashIntensity.value,    0, 1,    0.01, v => shieldMat.uniforms.uFlashIntensity.value = v,      '#0ef'));
    panel.appendChild(makeSlider('noise edge',   shieldMat.uniforms.uNoiseEdgeIntensity.value,0, 20,   0.1,  v => shieldMat.uniforms.uNoiseEdgeIntensity.value = v,  '#0ef'));
    panel.appendChild(makeSlider('noise smooth', shieldMat.uniforms.uNoiseEdgeSmoothness.value,0,1,   0.01, v => shieldMat.uniforms.uNoiseEdgeSmoothness.value = v, '#0ef'));
    panel.appendChild(makeSlider('hit ring spd', shieldMat.uniforms.uHitRingSpeed.value,      0.5, 5,  0.05, v => shieldMat.uniforms.uHitRingSpeed.value = v,       '#0ef'));
    panel.appendChild(makeSlider('hit intens',   shieldMat.uniforms.uHitIntensity.value,      0, 20,   0.1,  v => shieldMat.uniforms.uHitIntensity.value = v,       '#0ef'));
    panel.appendChild(makeSlider('hit radius',   shieldMat.uniforms.uHitImpactRadius.value,   0.05, 1, 0.01, v => shieldMat.uniforms.uHitImpactRadius.value = v,    '#0ef'));
    panel.appendChild(makeSlider('hit max r',    shieldMat.uniforms.uHitMaxRadius.value,      0.1, 2,  0.05, v => shieldMat.uniforms.uHitMaxRadius.value = v,       '#0ef'));
    panel.appendChild(makeSlider('hit duration', shieldMat.uniforms.uHitDuration.value,       0.1, 8,  0.05, v => shieldMat.uniforms.uHitDuration.value = v,        '#0ef'));
    panel.appendChild(makeSlider('hit ring w',   shieldMat.uniforms.uHitRingWidth.value,      0.01, 0.5,0.01, v => shieldMat.uniforms.uHitRingWidth.value = v,      '#0ef'));
    panel.appendChild(makeSlider('fade start',   shieldMat.uniforms.uFadeStart.value,        -1, 1,    0.01, v => shieldMat.uniforms.uFadeStart.value = v,           '#0ef'));
    panel.appendChild(makeSlider('displace str', shieldMat.uniforms.uDisplaceStrength.value,  0, 1,    0.01, v => shieldMat.uniforms.uDisplaceStrength.value = v,    '#0ef'));
    panel.appendChild(makeSlider('color R',      shieldMat.uniforms.uColor.value.r,           0, 1,    0.01, v => { shieldMat.uniforms.uColor.value.r = v; shieldMat.uniforms.uNoiseEdgeColor.value.r = v; }, '#0ef'));
    panel.appendChild(makeSlider('color G',      shieldMat.uniforms.uColor.value.g,           0, 1,    0.01, v => { shieldMat.uniforms.uColor.value.g = v; shieldMat.uniforms.uNoiseEdgeColor.value.g = v; }, '#0ef'));
    panel.appendChild(makeSlider('color B',      shieldMat.uniforms.uColor.value.b,           0, 1,    0.01, v => { shieldMat.uniforms.uColor.value.b = v; shieldMat.uniforms.uNoiseEdgeColor.value.b = v; }, '#0ef'));

    // RENDERER
    panel.appendChild(makeHeader('RENDERER'));
    panel.appendChild(makeSlider('exposure', renderer.toneMappingExposure, 0, 3, 0.01, v => renderer.toneMappingExposure = v, '#8f8'));

    // WATER
    panel.appendChild(makeHeader('WATER'));
    panel.appendChild(makeSlider('w sunR', mirrorMat.uniforms.sunColor.value.r, 0, 1, 0.01, v => mirrorMat.uniforms.sunColor.value.r = v, '#f44'));
    panel.appendChild(makeSlider('w sunG', mirrorMat.uniforms.sunColor.value.g, 0, 1, 0.01, v => mirrorMat.uniforms.sunColor.value.g = v, '#4f4'));
    panel.appendChild(makeSlider('w sunB', mirrorMat.uniforms.sunColor.value.b, 0, 1, 0.01, v => mirrorMat.uniforms.sunColor.value.b = v, '#44f'));
    panel.appendChild(makeSlider('distortion', mirrorMat.uniforms.distortionScale.value, 0, 10, 0.1, v => mirrorMat.uniforms.distortionScale.value = v, '#4af'));
    panel.appendChild(makeSlider('waterAlpha', mirrorMat.uniforms.alpha.value, 0, 1, 0.01, v => mirrorMat.uniforms.alpha.value = v, '#4af'));
    panel.appendChild(makeSlider('waterSize', mirrorMat.uniforms.size.value, 0, 20, 0.1, v => mirrorMat.uniforms.size.value = v, '#4af'));
    panel.appendChild(makeSlider('flowScale', _waterFlowScale, 0, 3, 0.05, v => { _waterFlowScale = v; }, '#4af'));

    // SUN ELEMENTS
    panel.appendChild(makeHeader('SUN'));
    panel.appendChild(makeToggle('sunGlowSprite', sunGlowSprite, 'visible', '#fa0'));
    panel.appendChild(makeToggle('sunRimGlow', sunRimGlow, 'visible', '#fa0'));
    panel.appendChild(makeToggle('sunCapMesh', sunCapMesh, 'visible', '#fa0'));
    panel.appendChild(makeToggle('sunMesh', sunMesh, 'visible', '#fa0'));

    // FLOOR
    panel.appendChild(makeHeader('FLOOR'));
    panel.appendChild(makeToggle('floorGrid', floorMesh, 'visible', '#0f8'));
    panel.appendChild(makeToggle('water', mirrorMesh, 'visible', '#0af'));

    // THRUSTER / FLAME / BLOOM SPRITES
    panel.appendChild(makeHeader('THRUSTERS & FX'));
    thrusterSystems.forEach((s, i) => panel.appendChild(makeToggle('thruster'+i, s.points, 'visible', '#f80')));
    miniThrusterSystems.forEach((s, i) => panel.appendChild(makeToggle('miniThr'+i, s.points, 'visible', '#f60')));
    nozzleBloomSprites.forEach((s, i) => panel.appendChild(makeToggle('nozBloom'+i, s, 'visible', '#ff0')));
    miniBloomSprites.forEach((s, i) => panel.appendChild(makeToggle('miniBlm'+i, s, 'visible', '#fd0')));
    flameMeshes.forEach((s, i) => panel.appendChild(makeToggle('flame'+i, s, 'visible', '#f40')));

    // SKY / STARS / NEBULA
    panel.appendChild(makeHeader('SKY & SPACE'));
    panel.appendChild(makeToggle('skyMesh', skyMesh, 'visible', '#66a'));
    panel.appendChild(makeToggle('brightStars', brightStarField, 'visible', '#aaf'));
    panel.appendChild(makeToggle('nebula', nebulaCloud, 'visible', '#a6f'));
    panel.appendChild(makeToggle('warpParts', _warpMesh, 'visible', '#88f'));

    // WARP STREAKS
    panel.appendChild(makeHeader('WARP STREAKS'));
    panel.appendChild(makeSlider('warp speed', _warpSpeed, 0, 80, 1, v => { _warpSpeed = v; }, '#88f'));
    panel.appendChild(makeSlider('warp bright', _warpBrightness, 0, 1, 0.01, v => { _warpBrightness = v; _warpMat.opacity = v; }, '#88f'));
    panel.appendChild(makeSlider('warp R', 1, 0, 1, 0.01, v => { _warpMat.color.r = v; }, '#f44'));
    panel.appendChild(makeSlider('warp G', 1, 0, 1, 0.01, v => { _warpMat.color.g = v; }, '#4f4'));
    panel.appendChild(makeSlider('warp B', 1, 0, 1, 0.01, v => { _warpMat.color.b = v; }, '#48f'));
    panel.appendChild(makeSlider('warp max len', _warpMaxLen, 1, 200, 1, v => { _warpMaxLen = v; }, '#88f'));
    panel.appendChild(makeSlider('warp count', WARP_COUNT, 100, 5000, 100, v => { _warpRebuild(v); }, '#88f'));
    panel.appendChild(makeSlider('warp Y center', _warpYCenter, -50, 200, 5, v => { _warpYCenter = v; }, '#88f'));
    panel.appendChild(makeSlider('warp Y range', _warpYRange, 10, 400, 10, v => { _warpYRange = v; }, '#88f'));
    panel.appendChild(makeSlider('warp edge bias', _warpEdgeBias, 0, 1, 0.05, v => { _warpEdgeBias = v; }, '#88f'));


    if (typeof skyStarPoints !== 'undefined') panel.appendChild(makeToggle('skyStarPts', skyStarPoints, 'visible', '#aaf'));
    if (typeof skyConstellLines !== 'undefined') panel.appendChild(makeToggle('constLines', skyConstellLines, 'visible', '#88a'));
    panel.appendChild(makeToggle('auroraGrp', auroraGroup, 'visible', '#0f8'));
    panel.appendChild(makeToggle('l5fGrp', l5fGroup, 'visible', '#f80'));

    // ── PANORAMA SKY ──
    panel.appendChild(makeHeader('PANORAMA'));
    panel.appendChild(makeToggle('panoQuad', _skyQuad, 'visible', '#c8f'));
    panel.appendChild(makeSlider('pano bright', _skyQuadMat.uniforms.uBrightness.value, 0, 15, 0.1, v => _skyQuadMat.uniforms.uBrightness.value = v, '#c8f'));
    panel.appendChild(makeSlider('pano tint R', _skyQuadMat.uniforms.uTintR.value, 0, 2, 0.01, v => _skyQuadMat.uniforms.uTintR.value = v, '#f44'));
    panel.appendChild(makeSlider('pano tint G', _skyQuadMat.uniforms.uTintG.value, 0, 2, 0.01, v => _skyQuadMat.uniforms.uTintG.value = v, '#4f4'));
    panel.appendChild(makeSlider('pano tint B', _skyQuadMat.uniforms.uTintB.value, 0, 2, 0.01, v => _skyQuadMat.uniforms.uTintB.value = v, '#44f'));
    panel.appendChild(makeSlider('pano Y offset', _skyQuadMat.uniforms.uOffsetY.value, -0.5, 0.5, 0.01, v => _skyQuadMat.uniforms.uOffsetY.value = v, '#c8f'));
    panel.appendChild(makeSlider('sun fade R', _skyQuadMat.uniforms.uSunFadeR.value, 0, 0.8, 0.01, v => _skyQuadMat.uniforms.uSunFadeR.value = v, '#fa0'));
    panel.appendChild(makeSlider('sun fade soft', _skyQuadMat.uniforms.uSunFadeSoft.value, 0, 0.5, 0.01, v => _skyQuadMat.uniforms.uSunFadeSoft.value = v, '#fa0'));
    panel.appendChild(makeSlider('sun fade X', _skyQuadMat.uniforms.uSunFadeX.value, 0, 1, 0.01, v => _skyQuadMat.uniforms.uSunFadeX.value = v, '#fa0'));
    panel.appendChild(makeSlider('sun fade Y', _skyQuadMat.uniforms.uSunFadeY.value, 0, 1, 0.01, v => _skyQuadMat.uniforms.uSunFadeY.value = v, '#fa0'));

    // ── TWINKLE STARS ──
    if (window._starMat) {
      panel.appendChild(makeHeader('TWINKLE STARS'));
      const sm = window._starMat;
      panel.appendChild(makeSlider('star R', sm.uniforms.uStarR.value, 0, 2, 0.01, v => sm.uniforms.uStarR.value = v, '#f44'));
      panel.appendChild(makeSlider('star G', sm.uniforms.uStarG.value, 0, 2, 0.01, v => sm.uniforms.uStarG.value = v, '#4f4'));
      panel.appendChild(makeSlider('star B', sm.uniforms.uStarB.value, 0, 2, 0.01, v => sm.uniforms.uStarB.value = v, '#44f'));
      panel.appendChild(makeSlider('star bright', sm.uniforms.uStarBright.value, 0, 30, 0.1, v => sm.uniforms.uStarBright.value = v, '#fff'));
      panel.appendChild(makeSlider('twinkle min', sm.uniforms.uTwinkleMin.value, 0, 1, 0.01, v => sm.uniforms.uTwinkleMin.value = v, '#aaf'));
      panel.appendChild(makeSlider('twinkle range', sm.uniforms.uTwinkleRange.value, 0, 1, 0.01, v => sm.uniforms.uTwinkleRange.value = v, '#aaf'));
      panel.appendChild(makeSlider('star size', sm.uniforms.uSizeMult.value, 0.1, 5, 0.05, v => sm.uniforms.uSizeMult.value = v, '#aaf'));
    }

    // SHIP
    panel.appendChild(makeHeader('SHIP'));
    panel.appendChild(makeToggle('shipGroup', shipGroup, 'visible', '#0ff'));
    panel.appendChild(makeToggle('shieldMesh', shieldMesh, 'visible', '#0ef'));
    panel.appendChild(makeToggle('shieldWire', shieldWire, 'visible', '#0ef'));
    // Ship hull emissive
    if (shipHullMats.length > 0) {
      panel.appendChild(makeSlider('hull emissive', shipHullMats[0].emissiveIntensity || 0, 0, 5, 0.01, v => {
        shipHullMats.forEach(m => { if (m.emissiveIntensity !== undefined) m.emissiveIntensity = v; });
      }, '#0ff'));
    }

    // MISC
    panel.appendChild(makeHeader('MISC'));
    panel.appendChild(makeToggle('l5Dust', l5DustPoints, 'visible', '#aaa'));
    // Fog
    panel.appendChild(makeSlider('fog near', scene.fog ? scene.fog.near : 0, 0, 200, 1, v => { if (scene.fog) scene.fog.near = v; }, '#888'));
    panel.appendChild(makeSlider('fog far', scene.fog ? scene.fog.far : 300, 0, 600, 1, v => { if (scene.fog) scene.fog.far = v; }, '#888'));

    // WAKE
    panel.appendChild(makeHeader('WAKE'));
    panel.appendChild(makeSlider('ring life', WAKE_RING_LIFE, 0.2, 4, 0.1, v => WAKE_RING_LIFE = v, '#4af'));
    panel.appendChild(makeSlider('ring rate', WAKE_RING_RATE, 0.01, 0.3, 0.01, v => WAKE_RING_RATE = v, '#4af'));
    panel.appendChild(makeSlider('ring Y', WAKE_Y, -0.1, 0.2, 0.01, v => WAKE_Y = v, '#4af'));
    panel.appendChild(makeSlider('vwake opacity', vWakeMats[0] ? vWakeMats[0].opacity : 0.18, 0, 1, 0.01, v => vWakeMats.forEach(m => m.opacity = v), '#4af'));

    // SHIP EXHAUST DEBUGGING
    panel.appendChild(makeHeader('SHIP EXHAUST DEBUG'));
    shipFireMeshes.forEach((m, i) => panel.appendChild(makeToggle('fire'+i, m, 'visible', '#f44')));
    panel.appendChild(makeToggle('underlight', shipGroup.getObjectByName && shipGroup.children.find(c => c.isLight) || { visible: true }, 'visible', '#fa0'));
    thrusterSystems.forEach((s, i) => panel.appendChild(makeToggle('thrPart'+i, s.points, 'visible', '#0af')));
    miniThrusterSystems.forEach((s, i) => panel.appendChild(makeToggle('miniPart'+i, s.points, 'visible', '#0af')));
    nozzleBloomSprites.forEach((s, i) => panel.appendChild(makeToggle('nozGlow'+i, s, 'visible', '#ff0')));
    miniBloomSprites.forEach((s, i) => panel.appendChild(makeToggle('miniGlow'+i, s, 'visible', '#fd0')));
    flameMeshes.forEach((s, i) => panel.appendChild(makeToggle('flameQ'+i, s, 'visible', '#f80')));
    panel.appendChild(makeSlider('flame yaw', _flameYawMult, 0, 0.3, 0.005, v => _flameYawMult = v, '#f80'));
    panel.appendChild(makeSlider('flame lateral', _flameLateralMult, 0, 0.2, 0.005, v => _flameLateralMult = v, '#f80'));

    panel.appendChild(makeHeader('THRUSTERS'));
    panel.appendChild(makeSlider('thruster scale', window._thrusterScale || 1.0, 0, 3, 0.05, v => { window._thrusterScale = v; }, '#f60'));
    panel.appendChild(makeSlider('particle size', thrusterSystems[0].points.material.size, 0.01, 1.0, 0.01, v => {
      thrusterSystems.forEach(s => s.points.material.size = v);
    }, '#f60'));
    panel.appendChild(makeSlider('mini part size', miniThrusterSystems[0].points.material.size, 0.01, 0.5, 0.01, v => {
      miniThrusterSystems.forEach(s => s.points.material.size = v);
    }, '#f60'));
    panel.appendChild(makeSlider('bloom size', nozzleBloomSprites[0].scale.x || 0.6, 0.1, 4, 0.05, v => {
      window._nozzleBloomScale = v;
    }, '#f60'));
    panel.appendChild(makeSlider('bloom opacity', 0.34, 0, 1, 0.01, v => {
      window._nozzleBloomOpacity = v;
    }, '#f60'));
    panel.appendChild(makeSlider('mini bloom size', miniBloomSprites[0].scale.x || 0.3, 0.05, 2, 0.05, v => {
      window._miniBloomScale = v;
    }, '#f60'));

    // HOVER BOB
    panel.appendChild(makeHeader('HOVER BOB'));
    panel.appendChild(makeSlider('ship Y', _hoverBaseY, -1.0, 3.0, 0.01, v => { _hoverBaseY = v; shipGroup.position.y = v; }, '#0ff'));
    panel.appendChild(makeSlider('ship Z', shipGroup.position.z, 0, 10, 0.1, v => { shipGroup.position.z = v; }, '#0ff'));
    panel.appendChild(makeSlider('rotX offset', _shipRotXOffset, -0.5, 0.5, 0.01, v => { _shipRotXOffset = v; }, '#0ff'));
    panel.appendChild(makeSlider('rotZ offset', _shipRotZOffset, -0.5, 0.5, 0.01, v => { _shipRotZOffset = v; }, '#0ff'));
    panel.appendChild(makeSlider('ship scale', shipGroup.scale.x, 0.1, 1.0, 0.01, v => { shipGroup.scale.setScalar(v); }, '#0ff'));
    panel.appendChild(makeSlider('cam lookY', _camLookYOffset, -5, 5, 0.1, v => { _camLookYOffset = v; camera.lookAt(new THREE.Vector3(0, -2.8 + v, -50 + _camLookZOffset)); }, '#f0f'));
    panel.appendChild(makeSlider('cam lookZ', _camLookZOffset, 0, 50, 0.5, v => { _camLookZOffset = v; camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + v)); }, '#f0f'));
    panel.appendChild(makeSlider('cam FOV', camera.fov, 30, 120, 1, v => { _camFOVOffset = v - 65; _baseFOV = v; camera.fov = v; camera.updateProjectionMatrix(); }, '#f0f'));
    panel.appendChild(makeSlider('FOV spd boost', _fovSpeedBoost, 0, 30, 1, v => { _fovSpeedBoost = v; }, '#f0f'));
    panel.appendChild(makeSlider('cam pivotY', _camPivotYOffset, -3, 3, 0.1, v => { _camPivotYOffset = v; }, '#f0f'));
    panel.appendChild(makeSlider('cam pivotZ', _camPivotZOffset, -5, 7, 0.1, v => { _camPivotZOffset = v; }, '#f0f'));
    panel.appendChild(makeSlider('bob amp', _bobAmplitude, 0, 0.06, 0.001, v => _bobAmplitude = v, '#0f8'));
    panel.appendChild(makeSlider('bob freq', _bobFrequency, 0.5, 4, 0.1, v => _bobFrequency = v, '#0f8'));
    panel.appendChild(makeSlider('bob steerOut', _bobSteerFadeOut, 0.5, 10, 0.5, v => _bobSteerFadeOut = v, '#0f8'));
    panel.appendChild(makeSlider('bob steerIn', _bobSteerFadeIn, 0.5, 10, 0.5, v => _bobSteerFadeIn = v, '#0f8'));

    // PITCH TILT
    panel.appendChild(makeHeader('PITCH TILT'));
    panel.appendChild(makeSlider('pitch fwd', _pitchForwardMax, 0, 0.4, 0.01, v => _pitchForwardMax = v, '#fa0'));
    panel.appendChild(makeSlider('pitch back', _pitchBackMax, 0, 0.3, 0.01, v => _pitchBackMax = v, '#fa0'));
    panel.appendChild(makeSlider('pitch smooth', _pitchSmoothing, 1, 12, 0.5, v => _pitchSmoothing = v, '#fa0'));

    // YAW (nose into turn)
    panel.appendChild(makeHeader('YAW'));
    panel.appendChild(makeSlider('yaw max', _yawMax, 0, 0.2, 0.005, v => _yawMax = v, '#ff0'));
    panel.appendChild(makeSlider('yaw smooth', _yawSmoothing, 1, 12, 0.5, v => _yawSmoothing = v, '#ff0'));

    // BANK (roll into turn)
    // SHIP HANDLING
    panel.appendChild(makeHeader('SHIP HANDLING'));
    const _handlingLabel = document.createElement('div');
    _handlingLabel.style.cssText = 'color:#0ff;font-size:11px;margin:2px 0 4px 0;font-family:monospace';
    _handlingLabel.textContent = 'Player level (live)';
    panel.appendChild(_handlingLabel);
    panel.appendChild(makeSlider('tier', 0, 0, HANDLING_TIERS.length, 1, v => {
      const idx = Math.round(v);
      if (idx === 0) {
        _handlingDriftOverride = -1;
        _handlingLabel.textContent = 'Player level (live)';
      } else {
        const t = HANDLING_TIERS[idx - 1];
        _handlingDriftOverride = t.drift;
        _handlingLabel.textContent = (t.label || 'Stock') + ' — drift=' + t.drift;
      }
    }, '#0ff'));

    // FUN FLOOR
    panel.appendChild(makeHeader('FUN FLOOR'));
    panel.appendChild(makeSlider('start speed (x BASE)', _funFloorSpeed, 1.0, 1.85, 0.01, v => { _funFloorSpeed = v; }, '#ff0'));
    panel.appendChild(makeSlider('spawn intensity (0=off, 1=max)', _funFloorIntensity, 0.0, 1.0, 0.01, v => { _funFloorIntensity = v; }, '#ff0'));

    // LATERAL PHYSICS
    panel.appendChild(makeHeader('LATERAL PHYSICS'));

    // ── Preset restore buttons ────────────────────────────────────────────────
    Object.entries(_PHYSICS_PRESETS).forEach(([key, p]) => {
      const btn = document.createElement('button');
      btn.textContent = '↩ RESTORE: ' + key;
      btn.title = p.label;
      btn.style.cssText = 'background:none;border:1px solid #0f8;color:#0f8;padding:3px 8px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:4px 0 6px;width:100%;text-align:left;';
      btn.onclick = () => {
        _accelBase    = p.accelBase;
        _accelSnap    = p.accelSnap;
        _maxVelBase   = p.maxVelBase;
        _maxVelSnap   = p.maxVelSnap;
        _bankMax      = p.bankMax;
        _bankSmoothing = p.bankSmoothing;
        _decelBasePct = p.decelBasePct;
        _decelFullPct = p.decelFullPct;
        if (p.speed === 'L4') state.speed = BASE_SPEED * LEVELS[3].speedMult;
        // Rebuild panel so sliders reflect restored values
        build();
        panel.style.display = 'block';
      };
      panel.appendChild(btn);
    });

    panel.appendChild(makeSlider('phys level (0=L1 floaty, 4=L5 crisp, -1=live)', _physLevelOverride, -1, 4, 1, v => _physLevelOverride = Math.round(v), '#0ff'));
    panel.appendChild(makeSlider('accel base', _accelBase, 1, 60, 1, v => _accelBase = v, '#0f8'));
    panel.appendChild(makeSlider('accel snap', _accelSnap, 0, 100, 1, v => _accelSnap = v, '#0f8'));
    panel.appendChild(makeSlider('accel drift x', _accelDriftMult, 0, 8, 0.1, v => _accelDriftMult = v, '#0f8'));
    panel.appendChild(makeSlider('decel stock %', _decelBasePct, 0, 0.5, 0.01, v => _decelBasePct = v, '#0f8'));
    panel.appendChild(makeSlider('decel full %', _decelFullPct, 0, 1.0, 0.01, v => _decelFullPct = v, '#0f8'));
    panel.appendChild(makeSlider('opp decel scale', _decelOppScale, 0, 2, 0.05, v => _decelOppScale = v, '#0f8'));
    panel.appendChild(makeSlider('max vel base', _maxVelBase, 1, 120, 1, v => _maxVelBase = v, '#0f8'));
    panel.appendChild(makeSlider('max vel snap', _maxVelSnap, 0, 120, 1, v => _maxVelSnap = v, '#0f8'));

    panel.appendChild(makeHeader('BANK'));
    panel.appendChild(makeSlider('bank max', _bankMax, 0, 0.06, 0.001, v => _bankMax = v, '#0af'));
    panel.appendChild(makeSlider('bank smooth', _bankSmoothing, 1, 16, 0.5, v => _bankSmoothing = v, '#0af'));

    // WOBBLE
    // WARP SUN COLORS
    panel.appendChild(makeHeader('WARP SUN'));
    const _warpCols = [
      { label: 'dark ', key: 'uWarpCol1', def: [0.25, 0.04, 0.02] },
      { label: 'mid  ', key: 'uWarpCol2', def: [0.85, 0.15, 0.04] },
      { label: 'bright', key: 'uWarpCol3', def: [1.0,  0.45, 0.08] },
    ];
    _warpCols.forEach(({label, key, def}) => {
      ['r','g','b'].forEach((ch, ci) => {
        panel.appendChild(makeSlider(label+ch, def[ci], 0, 1, 0.01, v => {
          const u = sunMat.uniforms[key].value;
          if (ci === 0) u.x = v; else if (ci === 1) u.y = v; else u.z = v;
          sunCapMat.uniforms[key].value.copy(u);
        }, '#f80'));
      });
    });

    panel.appendChild(makeHeader('WOBBLE'));
    panel.appendChild(makeSlider('wobble amp', _wobbleMaxAmp, 0, 0.5, 0.01, v => _wobbleMaxAmp = v, '#f4a'));
    panel.appendChild(makeSlider('wobble damp', _wobbleDamping, 1, 10, 0.5, v => _wobbleDamping = v, '#f4a'));
    panel.appendChild(makeSlider('spd mult', _wobbleSpeedMult, 0, 4, 0.1, v => _wobbleSpeedMult = v, '#f4a'));

    // ROLL OVERSHOOT
    panel.appendChild(makeHeader('ROLL OVERSHOOT'));
    panel.appendChild(makeSlider('amount', _overshootAmt, 0, 1.0, 0.05, v => _overshootAmt = v, '#fa4'));
    panel.appendChild(makeSlider('damping', _overshootDamp, 1, 20, 0.5, v => _overshootDamp = v, '#fa4'));

    // TURBULENCE
    panel.appendChild(makeHeader('TURBULENCE'));
    panel.appendChild(makeSlider('amount', _turbulence, 0, 0.5, 0.01, v => _turbulence = v, '#4fa'));

    // T1 BEAM
    panel.appendChild(makeHeader('T1 BEAM'));
    panel.appendChild(makeSlider('beam Y', _lBeamY, -2, 4, 0.05, v => { _lBeamY = v; }, '#f88'));
    panel.appendChild(makeSlider('beam Z', _lBeamZ, -120, 0, 1, v => { _lBeamZ = v; }, '#f88'));
    panel.appendChild(makeSlider('beam X off', _lBeamXOff, -4, 4, 0.05, v => { _lBeamXOff = v; }, '#f88'));
    panel.appendChild(makeSlider('core radius', _lBeamCoreR, 0.01, 0.5, 0.01, v => { _lBeamCoreR = v; laserMesh.scale.x = v / 0.03; laserMesh.scale.y = v / 0.03; }, '#f88'));
    panel.appendChild(makeSlider('glow radius', _lBeamGlowR, 0.01, 1.0, 0.01, v => { _lBeamGlowR = v; laserGlowMesh.scale.x = v / 0.12; laserGlowMesh.scale.y = v / 0.12; }, '#f88'));

    // LASER BOLTS
    panel.appendChild(makeHeader('LASER BOLTS (T2+)'));
    panel.appendChild(makeSlider('lanes', _lbLanes, 1, 8, 1, v => { _lbLanes = Math.round(v); state._laserBoltLanes = Math.round(v); }, '#f44'));
    panel.appendChild(makeSlider('spread', _lbSpread, 0, 4, 0.05, v => { _lbSpread = v; state._laserBoltSpread = v; }, '#f44'));
    panel.appendChild(makeSlider('Y offset', _lbYOffset, -2, 2, 0.05, v => { _lbYOffset = v; state._laserBoltYOff = v; }, '#f44'));
    panel.appendChild(makeSlider('Z offset', _lbZOffset, -8, 0, 0.1, v => { _lbZOffset = v; state._laserBoltZOff = v; }, '#f44'));
    panel.appendChild(makeSlider('length', _lbLength, 0.5, 10, 0.1, v => {
      _lbLength = v; state._laserBoltLen = v;
      // rescale all pooled bolts
      laserBolts.forEach(b => { const c = b.children[0]; if (c) c.scale.z = v / 2.0; });
    }, '#f44'));
    panel.appendChild(makeSlider('glow len', _lbGlowLen, 0.5, 12, 0.1, v => {
      _lbGlowLen = v; state._laserBoltGlow = v;
      laserBolts.forEach(b => { const g = b.children[1]; if (g) g.scale.z = v / 2.5; });
    }, '#f44'));
    panel.appendChild(makeSlider('fire rate', _lbFireRate, 1, 30, 0.5, v => { _lbFireRate = v; state.laserFireRate = v; }, '#f44'));

    // CANYON MATERIAL — use V key to open dedicated Canyon Tuner panel
    panel.appendChild(makeHeader('CANYON MATERIAL', '#0ef'));
    panel.appendChild(makeSlider('bloom threshold', bloom.threshold, 0, 1.5, 0.05, v => {
      bloom.threshold = v;
    }, '#0ef'));
    panel.appendChild(makeSlider('bloom strength', bloom.strength, 0, 3, 0.05, v => {
      bloom.strength = v;
    }, '#0ef'));
  }

  let visible = false;
  window._sceneTunerOpen = false;
  document.addEventListener('keydown', e => {
    if (e.key === 't' || e.key === 'T') {
      visible = !visible;
      window._sceneTunerOpen = visible;
      if (visible) { try { build(); } catch(err) { panel.innerHTML += '<div style="color:red;font-size:10px;padding:4px">BUILD ERROR: ' + err.message + '<br>' + (err.stack||'').split('\n')[1] + '</div>'; console.error('[SCENE TUNER] build() threw:', err); } panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// ── ADMIN MODE: Triple-tap title to toggle ─────────────────────────────────
(function setupAdminMode() {
  const titleEl = document.querySelector('.game-title');
  const panel = document.getElementById('admin-panel');
  if (!titleEl || !panel) return;
  let tapCount = 0, tapTimer = null;
  function onTap(e) {
    e.stopPropagation();
    tapCount++;
    if (tapCount === 1) tapTimer = setTimeout(() => { tapCount = 0; }, 1000);
    if (tapCount >= 3) { clearTimeout(tapTimer); tapCount = 0; panel.classList.toggle('hidden'); }
  }
  titleEl.addEventListener('touchstart', onTap, { passive: true });
  titleEl.addEventListener('click', onTap);
})();

// Ship Z tuner slider (syncs admin panel + settings panel)
(function setupShipZSlider() {
  const sliders = [
    { slider: document.getElementById('ship-z-slider'), label: document.getElementById('ship-z-val') },
    { slider: document.getElementById('ship-z-settings'), label: document.getElementById('ship-z-settings-val') },
  ];
  sliders.forEach(({ slider, label }) => {
    if (!slider || !label) return;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      shipGroup.position.z = v;
      // Sync both sliders
      sliders.forEach(s => {
        if (s.slider) s.slider.value = v;
        if (s.label) s.label.textContent = v.toFixed(1);
      });
    });
  });
})();

// Camera Pitch slider (admin panel)
(function setupCamPitchSlider() {
  const slider = document.getElementById('cam-pitch-slider');
  const label = document.getElementById('cam-pitch-val');
  if (!slider || !label) return;
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    cameraPivot.position.y = v;
    label.textContent = v.toFixed(1);
  });
})();

// Ship Y (hover height) slider — syncs admin panel + settings panel
(function setupShipYSlider() {
  const sliders = [
    { slider: document.getElementById('ship-y-slider'), label: document.getElementById('ship-y-val') },
    { slider: document.getElementById('ship-y-settings'), label: document.getElementById('ship-y-settings-val') },
  ];
  sliders.forEach(({ slider, label }) => {
    if (!slider || !label) return;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      _hoverBaseY = v;
      shipGroup.position.y = v;
      sliders.forEach(s => {
        if (s.slider) s.slider.value = v;
        if (s.label) s.label.textContent = v.toFixed(2);
      });
    });
  });
})();

// ── LAYOUT TUNER ──────────────────────────────────────────────────────────
(function() {
  // Triple-tap skin label to toggle
  let tapCount = 0, tapTimer = null;
  const skinLabel = document.getElementById('skin-viewer-label');
  const tunerPanel = document.getElementById('layout-tuner');
  if (!skinLabel || !tunerPanel) return;

  skinLabel.addEventListener('click', () => {
    tapCount++;
    if (tapCount === 3) {
      tapCount = 0;
      clearTimeout(tapTimer);
      tunerPanel.classList.toggle('hidden');
    } else {
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 500);
    }
  });

  const canvas = document.getElementById('title-ship-canvas');
  const platform = document.querySelector('.platform-pad');
  const viewer = document.querySelector('.skin-viewer');
  const labelEl = document.getElementById('skin-viewer-label');
  const showcase = document.querySelector('.ship-showcase-center');
  const titleEl = document.querySelector('.game-title');

  function bind(sliderId, valId, cb) {
    const s = document.getElementById(sliderId);
    const v = document.getElementById(valId);
    if (!s || !v) return;
    s.addEventListener('input', () => {
      v.textContent = s.value;
      cb(Number(s.value));
    });
  }

  // Portrait defaults
  const PORTRAIT   = { shipX: -1, shipY: -88, shipSize: 100, platX: 1, platY: 100, platSize: 180, labelX: 9,  labelY: -111, titleSize: 100, titleY: -33 };
  // Mobile landscape defaults (phone on its side)
  const LANDSCAPE  = { shipX: 2,  shipY: -52, shipSize: 300, platX: 1, platY: 37, platSize: 104, labelX: 13, labelY: -32, titleSize: 102, titleY: 87 };
  // Desktop defaults
  const DESKTOP    = { shipX: 2, shipY: -1, shipSize: 239, platX: 1, platY: -17, platSize: 166, labelX: 13, labelY: -26, titleSize: 160, titleY: 87 };

  let shipX, shipY, shipSize, platX, platY, platSize, labelX, labelY, titleSize, titleY;

  function _isLandscape() { return window.innerWidth > window.innerHeight; }
  function _isMobileLandscape() { return _isLandscape() && window.innerWidth < 1024; }
  function _isDesktop() { return window.innerWidth >= 1024; }

  function updateShip() {
    if (canvas) canvas.style.transform = 'translate(' + shipX + 'px, ' + shipY + 'px) scale(' + (shipSize / 100) + ')';
  }
  function updatePlat() {
    if (platform) {
      platform.style.bottom = (-10 + platY) + 'px';
      platform.style.transform = 'translateX(calc(-50% + ' + platX + 'px))';
      platform.style.width = platSize + 'px';
    }
  }
  function updateLabel() {
    if (labelEl) labelEl.style.transform = 'translate(' + labelX + 'px, ' + labelY + 'px)';
  }
  function updateTitle() {
    if (titleEl) {
      if (_isLandscape()) {
        titleEl.style.fontSize = titleSize + 'px';
      } else {
        titleEl.style.fontSize = 'clamp(68px,15.3vw,144px)';
      }
      titleEl.style.transform = 'translateY(' + titleY + 'px)';
    }
  }
  function updateLB() {
    const lb = document.getElementById('title-leaderboard');
    if (!lb) return;
    // Only show on title screen
    if (state.phase !== 'title') {
      lb.classList.add('hidden');
      return;
    }
    // Hide on mobile landscape
    if (_isMobileLandscape()) {
      lb.classList.add('hidden');
      return;
    }
    lb.classList.remove('hidden');
    // Desktop: position 10px below the skin label
    if (_isDesktop()) {
      const labelEl = document.querySelector('.skin-viewer-label');
      if (labelEl) {
        const labelRect = labelEl.getBoundingClientRect();
        lb.style.top = (labelRect.bottom + 10) + 'px';
        lb.style.bottom = '0';
      }
    } else {
      lb.style.top = '68%';
      lb.style.bottom = '0';
    }
  }

  function setSlider(id, valId, v) {
    const s = document.getElementById(id);
    const d = document.getElementById(valId);
    if (s) s.value = v;
    if (d) d.textContent = v;
  }

  function applyDefaults() {
    const d = _isDesktop() ? DESKTOP : _isLandscape() ? LANDSCAPE : PORTRAIT;
    shipX = d.shipX; shipY = d.shipY; shipSize = d.shipSize;
    platX = d.platX; platY = d.platY; platSize = d.platSize;
    labelX = d.labelX; labelY = d.labelY;
    titleSize = d.titleSize; titleY = d.titleY;
    setSlider('tune-ship-y', 'val-ship-y', shipY);
    setSlider('tune-ship-x', 'val-ship-x', shipX);
    setSlider('tune-ship-size', 'val-ship-size', shipSize);
    setSlider('tune-plat-y', 'val-plat-y', platY);
    setSlider('tune-plat-x', 'val-plat-x', platX);
    setSlider('tune-plat-size', 'val-plat-size', platSize);
    setSlider('tune-label-y', 'val-label-y', labelY);
    setSlider('tune-label-x', 'val-label-x', labelX);
    setSlider('tune-title-size', 'val-title-size', titleSize);
    setSlider('tune-title-y', 'val-title-y', titleY);
    updateShip(); updatePlat(); updateLabel(); updateTitle(); updateLB();
    // Apply 3D ship orientation per mode
    const tg = titleScene.getObjectByName('titleShipPivot')?.children[0];
    const sg = titleScene.getObjectByName('titleShipPivot');
    if (_isDesktop()) {
      if (tg) { tg.rotation.x = 0.13; tg.rotation.y = 0; tg.rotation.z = 0; }
      if (sg) sg.position.y = -0.10;
      if (_titleShipModel) _titleShipModel.scale.setScalar(0.12);
      titleCamera.position.z = 3.4;
      titleCamera.position.y = 0.35;
      window._titleSpinSpeed = 0.001;
      setSlider('tune-3d-tilt-x', 'val-3d-tilt-x', 13);
      setSlider('tune-3d-spin', 'val-3d-spin', 0);
    } else if (_isLandscape()) {
      if (tg) tg.rotation.x = 0.13;
      setSlider('tune-3d-tilt-x', 'val-3d-tilt-x', 13);
    } else {
      if (tg) tg.rotation.x = Math.PI / 2;
      setSlider('tune-3d-tilt-x', 'val-3d-tilt-x', 157);
    }
  }
  applyDefaults();
  window.addEventListener('resize', applyDefaults);

  // Bind sliders
  bind('tune-ship-y', 'val-ship-y', v => { shipY = v; updateShip(); });
  bind('tune-ship-x', 'val-ship-x', v => { shipX = v; updateShip(); });
  bind('tune-ship-size', 'val-ship-size', v => { shipSize = v; updateShip(); });
  bind('tune-plat-y', 'val-plat-y', v => { platY = v; updatePlat(); });
  bind('tune-plat-x', 'val-plat-x', v => { platX = v; updatePlat(); });
  bind('tune-plat-size', 'val-plat-size', v => { platSize = v; updatePlat(); });
  bind('tune-label-y', 'val-label-y', v => { labelY = v; updateLabel(); });
  bind('tune-label-x', 'val-label-x', v => { labelX = v; updateLabel(); });
  bind('tune-title-size', 'val-title-size', v => { titleSize = v; updateTitle(); });
  bind('tune-title-y', 'val-title-y', v => { titleY = v; updateTitle(); });
  bind('tune-lb-y', 'val-lb-y', v => {
    const lb = document.getElementById('title-leaderboard');
    if (lb) lb.style.top = v + '%';
  });

  // 3D ship orientation sliders (values stored as integers, divided to get floats)
  function bind3d(sliderId, valId, divisor, cb) {
    const s = document.getElementById(sliderId);
    const v = document.getElementById(valId);
    if (!s || !v) return;
    s.addEventListener('input', () => {
      const val = Number(s.value) / divisor;
      v.textContent = val.toFixed(2);
      cb(val);
    });
  }
  bind3d('tune-3d-tilt-x', 'val-3d-tilt-x', 100, v => {
    const tg = titleScene.getObjectByName('titleShipPivot')?.children[0];
    if (tg) tg.rotation.x = v;
  });
  bind3d('tune-3d-tilt-y', 'val-3d-tilt-y', 100, v => {
    const tg = titleScene.getObjectByName('titleShipPivot')?.children[0];
    if (tg) tg.rotation.y = v;
  });
  bind3d('tune-3d-tilt-z', 'val-3d-tilt-z', 100, v => {
    const tg = titleScene.getObjectByName('titleShipPivot')?.children[0];
    if (tg) tg.rotation.z = v;
  });
  bind3d('tune-3d-pivot-y', 'val-3d-pivot-y', 100, v => {
    const sg = titleScene.getObjectByName('titleShipPivot');
    if (sg) sg.position.y = v;
  });
  bind3d('tune-3d-scale', 'val-3d-scale', 100, v => {
    if (_titleShipModel) _titleShipModel.scale.setScalar(v);
  });
  bind3d('tune-3d-cam-z', 'val-3d-cam-z', 10, v => {
    titleCamera.position.z = v; titleCamera.updateProjectionMatrix();
  });
  bind3d('tune-3d-cam-y', 'val-3d-cam-y', 10, v => {
    titleCamera.position.y = v;
  });
  bind3d('tune-3d-spin', 'val-3d-spin', 1000, v => {
    window._titleSpinSpeed = v;
  });
})();

// ═══════════════════════════════════════════════════
//  ANGLED WALL TUNER (key: `)
// ═══════════════════════════════════════════════════
(function() {
  const panel = document.createElement('div');
  panel.id = 'aw-tuner';
  panel.style.cssText = 'position:fixed;top:0;right:0;width:280px;height:100%;background:rgba(0,0,0,0.92);overflow-y:auto;z-index:10001;font-family:monospace;font-size:11px;color:#ccc;padding:10px;box-sizing:border-box;-webkit-overflow-scrolling:touch;border-left:1px solid #333;display:none;';
  document.body.appendChild(panel);

  let built = false;
  function build() {
    if (built) return;
    built = true;

    // Header + pause
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
    const t = document.createElement('span');
    t.textContent = 'WALL TUNER';
    t.style.cssText = 'color:#0ff;font-size:13px;font-weight:bold;letter-spacing:2px;';
    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = 'PAUSE';
    pauseBtn.style.cssText = 'background:#ff0;color:#000;border:none;padding:4px 12px;cursor:pointer;font-family:monospace;font-size:11px;font-weight:bold;';
    pauseBtn.onclick = () => {
      _awTunerPaused = !_awTunerPaused;
      pauseBtn.textContent = _awTunerPaused ? 'PLAY' : 'PAUSE';
      pauseBtn.style.background = _awTunerPaused ? '#0f0' : '#ff0';
    };
    hdr.appendChild(t); hdr.appendChild(pauseBtn);
    panel.appendChild(hdr);

    // Spawn / reset buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;';
    const spawnBtn = document.createElement('button');
    spawnBtn.textContent = 'SPAWN WALLS';
    spawnBtn.style.cssText = 'flex:1;background:#0af;color:#000;border:none;padding:6px;cursor:pointer;font-family:monospace;font-weight:bold;font-size:11px;';
    function _awRespawn() {
      // Clear existing
      [..._awActive].forEach(_returnWallToPool);
      _awActive.length = 0;
      state.angledWallRowsDone = 0;
      if (_awTunerPaused) {
        // Paused: spawn all rows instantly so you can see the full layout
        const rowCount = Math.round(_awTuner.rows);
        for (let r = 0; r < rowCount; r++) {
          // Override SPAWN_Z: place rows spread out in front of ship
          const savedSpawnZ = SPAWN_Z;
          // Temporarily patch the spawn to use staggered Z positions
          const origFn = spawnAngledWallRow;
          // We'll just call it and then move the walls to visible positions
          spawnAngledWallRow();
        }
        // Reposition all walls in a grid in front of the camera
        let rowIdx = 0;
        const cx = Math.max(1, Math.round(_awTuner.copiesX));
        const cy = Math.max(1, Math.round(_awTuner.copiesY));
        const cz = Math.max(1, Math.round(_awTuner.copiesZ));
        const wallsPerRow = cx * cy * cz;
        for (let r = 0; r < rowCount; r++) {
          const rowZ = shipGroup.position.z - 30 - r * _awTuner.zSpacing;
          const angleSign = (r % 2 === 0) ? 1 : -1;
          const baseX = state.shipX + angleSign * _awTuner.xOffset + _awTuner.fieldShift;
          const halfXs = (cx - 1) * _awTuner.spacingX / 2;
          const halfYs = (cy - 1) * _awTuner.spacingY / 2;
          const halfZs = (cz - 1) * _awTuner.spacingZ / 2;
          let wi = 0;
          for (let ix = 0; ix < cx; ix++) {
            for (let iy = 0; iy < cy; iy++) {
              for (let iz = 0; iz < cz; iz++) {
                const idx = r * wallsPerRow + wi;
                if (idx < _awActive.length) {
                  const w = _awActive[idx];
                  w.position.set(
                    baseX - halfXs + ix * _awTuner.spacingX,
                    -halfYs + iy * _awTuner.spacingY,
                    rowZ - halfZs + iz * _awTuner.spacingZ
                  );
                  _applyWallTuner(w, angleSign);
                  w.userData._mesh.material.uniforms.uOpacity.value = _awTuner.opacity;
                  w.userData._edges.material.opacity = _awTuner.opacity * 0.9;
                }
                wi++;
              }
            }
          }
        }
      } else {
        // Playing: spawn rows over time as usual
        state.angledWallsActive = true;
        state.angledWallSpawnZ = -_awTuner.zSpacing;
      }
    }
    spawnBtn.onclick = _awRespawn;
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'CLEAR';
    clearBtn.style.cssText = 'flex:1;background:#f44;color:#fff;border:none;padding:6px;cursor:pointer;font-family:monospace;font-weight:bold;font-size:11px;';
    clearBtn.onclick = () => {
      [..._awActive].forEach(_returnWallToPool);
      _awActive.length = 0;
      state.angledWallsActive = false;
      state.angledWallRowsDone = 0;
    };
    btnRow.appendChild(spawnBtn); btnRow.appendChild(clearBtn);
    panel.appendChild(btnRow);

    function mkSl(label, val, min, max, step, onChange, color) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:2px;';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'width:90px;flex-shrink:0;font-size:10px;';
      const sl = document.createElement('input');
      sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step; sl.value = val;
      sl.style.cssText = 'flex:1;height:12px;cursor:pointer;accent-color:' + (color || '#0af') + ';';
      const vs = document.createElement('span');
      vs.textContent = Number(val).toFixed(step < 0.1 ? 2 : 1);
      vs.style.cssText = 'width:44px;text-align:right;font-size:9px;';
      sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        vs.textContent = Number(v).toFixed(step < 0.1 ? 2 : 1);
        onChange(v);
        // When paused with walls active, full respawn so copies/spacing/rotation update live
        if (_awTunerPaused && _awActive.length > 0) {
          _awRespawn();
        } else {
          // Live-update visual properties on existing walls
          _awActive.forEach((w, idx) => {
            const sign = (idx % 2 === 0) ? 1 : -1;
            _applyWallTuner(w, sign);
            w.userData._mesh.material.uniforms.uOpacity.value = _awTuner.opacity;
            w.userData._edges.material.opacity = _awTuner.opacity * 0.9;
          });
        }
      });
      row.appendChild(lbl); row.appendChild(sl); row.appendChild(vs);
      return row;
    }

    function mkSec(name, color) {
      const s = document.createElement('div');
      s.style.cssText = 'margin:8px 0 4px;border-bottom:1px solid #222;padding-bottom:4px;';
      const h = document.createElement('div');
      h.textContent = name;
      h.style.cssText = 'color:' + color + ';font-weight:bold;font-size:11px;letter-spacing:1px;';
      s.appendChild(h);
      return s;
    }

    // GEOMETRY
    const geoSec = mkSec('GEOMETRY', '#0ff');
    geoSec.appendChild(mkSl('Width', _awTuner.wallW, 10, 100, 1, v => _awTuner.wallW = v, '#0ff'));
    geoSec.appendChild(mkSl('Height', _awTuner.wallH, 4, 40, 1, v => _awTuner.wallH = v, '#0ff'));
    geoSec.appendChild(mkSl('Thickness', _awTuner.thickness, 0.1, 3, 0.05, v => _awTuner.thickness = v, '#0ff'));
    geoSec.appendChild(mkSl('Angle \u00B0', _awTuner.angle, 5, 80, 1, v => _awTuner.angle = v, '#0ff'));
    panel.appendChild(geoSec);

    // SPACING
    const spcSec = mkSec('SPACING', '#f80');
    spcSec.appendChild(mkSl('Z Spacing', _awTuner.zSpacing, 10, 80, 1, v => _awTuner.zSpacing = v, '#f80'));
    spcSec.appendChild(mkSl('X Offset', _awTuner.xOffset, 0, 40, 0.5, v => _awTuner.xOffset = v, '#f80'));
    spcSec.appendChild(mkSl('Rows', _awTuner.rows, 5, 40, 1, v => _awTuner.rows = v, '#f80'));
    spcSec.appendChild(mkSl('Field Shift', _awTuner.fieldShift, -40, 40, 0.5, v => _awTuner.fieldShift = v, '#f80'));
    panel.appendChild(spcSec);

    // COPIES (per-axis)
    const cpSec = mkSec('COPIES', '#ff0');
    cpSec.appendChild(mkSl('X Copies', _awTuner.copiesX, 1, 10, 1, v => _awTuner.copiesX = v, '#ff0'));
    cpSec.appendChild(mkSl('X Gap', _awTuner.spacingX, 2, 80, 1, v => _awTuner.spacingX = v, '#ff0'));
    cpSec.appendChild(mkSl('Y Copies', _awTuner.copiesY, 1, 6, 1, v => _awTuner.copiesY = v, '#ff0'));
    cpSec.appendChild(mkSl('Y Gap', _awTuner.spacingY, 2, 30, 0.5, v => _awTuner.spacingY = v, '#ff0'));
    cpSec.appendChild(mkSl('Z Copies', _awTuner.copiesZ, 1, 6, 1, v => _awTuner.copiesZ = v, '#ff0'));
    cpSec.appendChild(mkSl('Z Gap', _awTuner.spacingZ, 2, 40, 1, v => _awTuner.spacingZ = v, '#ff0'));
    panel.appendChild(cpSec);

    // ROTATION
    const rotSec = mkSec('ROTATION', '#0f0');
    rotSec.appendChild(mkSl('Rot X \u00B0', _awTuner.rotX, -90, 90, 1, v => _awTuner.rotX = v, '#0f0'));
    rotSec.appendChild(mkSl('Rot Y \u00B0', _awTuner.rotY, -90, 90, 1, v => _awTuner.rotY = v, '#0f0'));
    rotSec.appendChild(mkSl('Rot Z \u00B0', _awTuner.rotZ, -90, 90, 1, v => _awTuner.rotZ = v, '#0f0'));
    panel.appendChild(rotSec);

    // COLOR
    const colSec = mkSec('COLOR', '#f0f');
    colSec.appendChild(mkSl('Red', _awTuner.colorR, 0, 1, 0.01, v => _awTuner.colorR = v, '#f44'));
    colSec.appendChild(mkSl('Green', _awTuner.colorG, 0, 1, 0.01, v => _awTuner.colorG = v, '#4f4'));
    colSec.appendChild(mkSl('Blue', _awTuner.colorB, 0, 1, 0.01, v => _awTuner.colorB = v, '#44f'));
    colSec.appendChild(mkSl('Emissive', _awTuner.emissive, 0.5, 6, 0.1, v => _awTuner.emissive = v, '#ff0'));
    colSec.appendChild(mkSl('Opacity', _awTuner.opacity, 0.1, 1, 0.01, v => _awTuner.opacity = v, '#aaa'));
    panel.appendChild(colSec);

    // DUMP button
    const dumpBtn = document.createElement('button');
    dumpBtn.textContent = 'DUMP CONFIG';
    dumpBtn.style.cssText = 'margin-top:12px;width:100%;background:#222;color:#0ff;border:1px solid #0ff;padding:8px;cursor:pointer;font-family:monospace;font-size:11px;font-weight:bold;letter-spacing:1px;';
    dumpBtn.onclick = () => console.log('AW TUNER:', JSON.stringify(_awTuner, null, 2));
    panel.appendChild(dumpBtn);

    // RESET TO DEFAULT button
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'RESET TO DEFAULT';
    resetBtn.style.cssText = 'margin-top:6px;width:100%;background:#222;color:#f44;border:1px solid #f44;padding:8px;cursor:pointer;font-family:monospace;font-size:11px;font-weight:bold;letter-spacing:1px;';
    resetBtn.onclick = () => {
      Object.assign(_awTuner, _awTunerDefaults);
      built = false;
      panel.innerHTML = '';
      build();
      if (_awTunerPaused && _awActive.length > 0) _awRespawn();
    };
    panel.appendChild(resetBtn);
  }

  // Toggle with backtick key (`)
  document.addEventListener('keydown', e => {
    if (e.key === '`') {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const vis = panel.style.display === 'none';
      if (vis) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// ═══════════════════════════════════════════════════
//  TERRAIN TUNER PANEL (hotkey: R)
// ═══════════════════════════════════════════════════
(function() {
  const panel = document.createElement('div');
  panel.id = 'terrain-tuner';
  panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:rgba(0,0,0,0.88);' +
    'border:1px solid #00eeff;border-radius:8px;padding:12px 16px;font:12px monospace;color:#ccc;' +
    'display:none;min-width:220px;max-height:90vh;overflow-y:auto;pointer-events:auto;';
  document.body.appendChild(panel);

  const sliders = [
    { key: 'width',      label: 'Width',       min: 20,  max: 400,  step: 2 },
    { key: 'xOffset',    label: 'X Offset',    min: 0,   max: 200,  step: 1 },
    { key: 'peakHeight', label: 'Peak Height',  min: 2,  max: 200,  step: 1 },
    { key: 'baseY',      label: 'Base Y',       min: -30, max: 20,  step: 0.5 },
    { key: 'metalness',  label: 'Metalness',    min: 0,  max: 1,    step: 0.02 },
    { key: 'roughness',  label: 'Roughness',    min: 0,  max: 1,    step: 0.02 },
    { key: 'gridOpacity',label: 'Grid Opacity',  min: 0, max: 1,    step: 0.05 },
    { key: 'emissiveIntensity', label: 'Emissive', min: 0, max: 5,  step: 0.05 },
  ];

  function build() {
    let html = '<div style="color:#00eeff;font-weight:bold;margin-bottom:8px;">TERRAIN TUNER [R]</div>';
    // ON/OFF toggle button
    const terrainVisible = !_terrainWalls || _terrainWalls.strips[0].visible;
    html += `<button id="tt-toggle" style="width:100%;margin-bottom:10px;padding:6px;font:bold 11px monospace;cursor:pointer;border-radius:3px;border:1px solid ${terrainVisible ? '#f44' : '#0f8'};background:${terrainVisible ? 'rgba(255,60,60,0.15)' : 'rgba(0,255,120,0.15)'};color:${terrainVisible ? '#f88' : '#0f8'};">TERRAIN: ${terrainVisible ? 'ON  — click to hide' : 'OFF — click to show'}</button>`;
    sliders.forEach(s => {
      const val = _terrainTuner[s.key];
      html += `<div style="margin:4px 0;"><label>${s.label}: <span id="tt-${s.key}-val">${val}</span></label><br>`;
      html += `<input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${val}" ` +
        `id="tt-${s.key}" style="width:180px;"></div>`;
    });
    // Color pickers
    html += '<div style="margin:6px 0;"><label>Grid Color: </label>';
    html += `<input type="color" id="tt-gridColor" value="${_terrainTuner.gridColor}" style="width:40px;height:24px;border:none;background:none;"></div>`;
    html += '<div style="margin:6px 0;"><label>Base Color: </label>';
    html += `<input type="color" id="tt-baseColor" value="${_terrainTuner.baseColor}" style="width:40px;height:24px;border:none;background:none;"></div>`;
    // Rebuild button
    html += '<button id="tt-rebuild" style="margin-top:8px;width:100%;background:#222;color:#0ff;border:1px solid #0ff;padding:6px;cursor:pointer;font:11px monospace;font-weight:bold;">REBUILD TERRAIN</button>';
    panel.innerHTML = html;

    // Wire terrain toggle
    document.getElementById('tt-toggle').addEventListener('click', () => {
      if (_terrainWalls) {
        const next = !_terrainWalls.strips[0].visible;
        _terrainWalls.strips.forEach(m => { m.visible = next; });
      }
      build(); // rebuild panel to reflect new state
    });

    // Wire up sliders
    sliders.forEach(s => {
      const inp = document.getElementById('tt-' + s.key);
      const valEl = document.getElementById('tt-' + s.key + '-val');
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        _terrainTuner[s.key] = v;
        valEl.textContent = v;
        _applyTerrainTuner();
      });
    });
    document.getElementById('tt-gridColor').addEventListener('input', (e) => {
      _terrainTuner.gridColor = e.target.value;
    });
    document.getElementById('tt-baseColor').addEventListener('input', (e) => {
      _terrainTuner.baseColor = e.target.value;
    });
    document.getElementById('tt-rebuild').addEventListener('click', () => {
      _destroyTerrainWalls();
      _createTerrainWalls();
    });
  }

  // Apply live-tunable values (no rebuild needed)
  window._applyTerrainTuner = function() {
    if (!_terrainWalls) return;
    const T = _terrainTuner;
    _terrainWalls.mat.metalness = T.metalness;
    _terrainWalls.mat.roughness = T.roughness;
    _terrainWalls.mat.emissiveIntensity = T.emissiveIntensity;
    _terrainWalls.strips.forEach(m => {
      // Determine side from current x position
      const side = m.position.x < 0 ? -1 : 1;
      m.position.x = side * T.xOffset;
      m.position.y = T.baseY;
    });
  };

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'KeyR') {
      const vis = panel.style.display === 'none';
      if (vis) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// ═══════════════════════════════════════════════════
//  SHIP GLB TUNER PANEL (hotkey: G)
// ═══════════════════════════════════════════════════
(function() {
  const panel = document.createElement('div');
  panel.id = 'ship-glb-tuner';
  panel.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;background:rgba(0,0,0,0.92);' +
    'border:1px solid #ff00ff;border-radius:8px;padding:12px 16px;font:11px monospace;color:#ccc;' +
    'display:none;min-width:250px;max-height:92vh;overflow-y:auto;pointer-events:auto;';
  document.body.appendChild(panel);

  function makeSlider(label, val, min, max, step, onChange) {
    const wrap = document.createElement('div');
    wrap.style.margin = '3px 0';
    const lbl = document.createElement('label');
    lbl.style.color = '#ff88ff';
    const valSpan = document.createElement('span');
    valSpan.textContent = typeof val === 'number' ? val.toFixed(3) : val;
    lbl.textContent = label + ': ';
    lbl.appendChild(valSpan);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
    inp.value = val; inp.style.width = '170px';
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      valSpan.textContent = v.toFixed(3);
      onChange(v);
    });
    wrap.appendChild(lbl);
    wrap.appendChild(document.createElement('br'));
    wrap.appendChild(inp);
    return wrap;
  }

  function build() {
    panel.innerHTML = '<div style="color:#ff00ff;font-weight:bold;margin-bottom:6px;">SHIP GLB TUNER [G]</div>';

    // ── Ship Transform ──
    if (_altShipActive) {
    const hdr1 = document.createElement('div');
    hdr1.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr1.textContent = '— SHIP TRANSFORM —';
    panel.appendChild(hdr1);

    panel.appendChild(makeSlider('Pos X', _altShip.posX, -2, 2, 0.01, v => { _altShip.posX = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Pos Y', _altShip.posY, -2, 2, 0.01, v => { _altShip.posY = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Pos Z', _altShip.posZ, -3, 3, 0.01, v => { _altShip.posZ = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Rot X', _altShip.rotX, -Math.PI, Math.PI, 0.01, v => { _altShip.rotX = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Rot Y', _altShip.rotY, -Math.PI, Math.PI, 0.01, v => { _altShip.rotY = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Rot Z', _altShip.rotZ, -Math.PI, Math.PI, 0.01, v => { _altShip.rotZ = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Scale', _altShip.scale, 0.01, 1.0, 0.001, v => { _altShip.scale = v; _updateAltShipTransform(); }));

    // ── Thruster Positions ──
    const hdr2 = document.createElement('div');
    hdr2.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr2.textContent = '— THRUSTER NOZZLES —';
    panel.appendChild(hdr2);

    const nozzleUpdate = () => {
      NOZZLE_OFFSETS[0].copy(_altShip.nozzleL);
      NOZZLE_OFFSETS[1].copy(_altShip.nozzleR);
      MINI_NOZZLE_OFFSETS[0].copy(_altShip.miniL);
      MINI_NOZZLE_OFFSETS[1].copy(_altShip.miniR);
      _snapshotNozzleBaseline(); // re-anchor baseline to current transform
      _rebuildLocalNozzles();
    };

    panel.appendChild(makeSlider('Noz L x', _altShip.nozzleL.x, -2, 2, 0.01, v => { _altShip.nozzleL.x = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Noz L y', _altShip.nozzleL.y, -1, 1, 0.01, v => { _altShip.nozzleL.y = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Noz L z', _altShip.nozzleL.z, 3, 7, 0.01, v => { _altShip.nozzleL.z = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Noz R x', _altShip.nozzleR.x, -2, 2, 0.01, v => { _altShip.nozzleR.x = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Noz R y', _altShip.nozzleR.y, -1, 1, 0.01, v => { _altShip.nozzleR.y = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Noz R z', _altShip.nozzleR.z, 3, 7, 0.01, v => { _altShip.nozzleR.z = v; nozzleUpdate(); }));

    // ── Mini Thrusters ──
    panel.appendChild(makeSlider('Mini L x', _altShip.miniL.x, -2, 2, 0.01, v => { _altShip.miniL.x = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Mini L y', _altShip.miniL.y, -1, 1, 0.01, v => { _altShip.miniL.y = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Mini L z', _altShip.miniL.z, 3, 7, 0.01, v => { _altShip.miniL.z = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Mini R x', _altShip.miniR.x, -2, 2, 0.01, v => { _altShip.miniR.x = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Mini R y', _altShip.miniR.y, -1, 1, 0.01, v => { _altShip.miniR.y = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Mini R z', _altShip.miniR.z, 3, 7, 0.01, v => { _altShip.miniR.z = v; nozzleUpdate(); }));
    } else {
    // Non-GLB ships: direct NOZZLE_OFFSETS sliders
    const hdr2b = document.createElement('div');
    hdr2b.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr2b.textContent = '— THRUSTER NOZZLES —';
    panel.appendChild(hdr2b);

    const nozzleUpdateDirect = () => { _rebuildLocalNozzles(); };

    panel.appendChild(makeSlider('Noz L x', NOZZLE_OFFSETS[0].x, -2, 2, 0.01, v => { NOZZLE_OFFSETS[0].x = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Noz L y', NOZZLE_OFFSETS[0].y, -1, 1, 0.01, v => { NOZZLE_OFFSETS[0].y = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Noz L z', NOZZLE_OFFSETS[0].z, -2, 7, 0.01, v => { NOZZLE_OFFSETS[0].z = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Noz R x', NOZZLE_OFFSETS[1].x, -2, 2, 0.01, v => { NOZZLE_OFFSETS[1].x = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Noz R y', NOZZLE_OFFSETS[1].y, -1, 1, 0.01, v => { NOZZLE_OFFSETS[1].y = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Noz R z', NOZZLE_OFFSETS[1].z, -2, 7, 0.01, v => { NOZZLE_OFFSETS[1].z = v; nozzleUpdateDirect(); }));

    panel.appendChild(makeSlider('Mini L x', MINI_NOZZLE_OFFSETS[0].x, -2, 2, 0.01, v => { MINI_NOZZLE_OFFSETS[0].x = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Mini L y', MINI_NOZZLE_OFFSETS[0].y, -1, 1, 0.01, v => { MINI_NOZZLE_OFFSETS[0].y = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Mini L z', MINI_NOZZLE_OFFSETS[0].z, -2, 7, 0.01, v => { MINI_NOZZLE_OFFSETS[0].z = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Mini R x', MINI_NOZZLE_OFFSETS[1].x, -2, 2, 0.01, v => { MINI_NOZZLE_OFFSETS[1].x = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Mini R y', MINI_NOZZLE_OFFSETS[1].y, -1, 1, 0.01, v => { MINI_NOZZLE_OFFSETS[1].y = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Mini R z', MINI_NOZZLE_OFFSETS[1].z, -2, 7, 0.01, v => { MINI_NOZZLE_OFFSETS[1].z = v; nozzleUpdateDirect(); }));
    } // end alt ship / default nozzle sliders

    // ── Thruster Controls ──
    const hdr3 = document.createElement('div');
    hdr3.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr3.textContent = '— THRUSTER CONTROLS —';
    panel.appendChild(hdr3);

    // On/Off toggle
    const togWrap = document.createElement('div');
    togWrap.style.margin = '4px 0 6px';
    const togBtn = document.createElement('button');
    togBtn.textContent = window._thrusterVisible !== false ? 'THRUSTERS: ON' : 'THRUSTERS: OFF';
    togBtn.style.cssText = 'background:' + (window._thrusterVisible !== false ? '#040' : '#400') + ';color:#fff;border:1px solid ' + (window._thrusterVisible !== false ? '#0f0' : '#f00') + ';padding:4px 12px;cursor:pointer;font:11px monospace;';
    togBtn.addEventListener('click', () => {
      window._thrusterVisible = !window._thrusterVisible;
      togBtn.textContent = window._thrusterVisible ? 'THRUSTERS: ON' : 'THRUSTERS: OFF';
      togBtn.style.background = window._thrusterVisible ? '#040' : '#400';
      togBtn.style.borderColor = window._thrusterVisible ? '#0f0' : '#f00';
    });
    togWrap.appendChild(togBtn);
    panel.appendChild(togWrap);

    panel.appendChild(makeSlider('Thruster Scale', window._thrusterScale || 1.0, 0.01, 5, 0.05, v => {
      window._thrusterScale = v;
      window._baseThrusterScale = v;
      if (_altShipActive) _altShip.thrusterScale = v;
    }));
    panel.appendChild(makeSlider('Spread X (wider)', window._thrusterSpreadX || 1.0, 0.1, 10, 0.1, v => {
      window._thrusterSpreadX = v;
    }));
    panel.appendChild(makeSlider('Spread Y (flat/tall)', window._thrusterSpreadY || 1.0, 0.1, 10, 0.1, v => {
      window._thrusterSpreadY = v;
    }));
    panel.appendChild(makeSlider('Length', window._thrusterLength || 1.0, 0.1, 5, 0.1, v => {
      window._thrusterLength = v;
    }));

    // ── Bloom / Glow ──
    const hdr4 = document.createElement('div');
    hdr4.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr4.textContent = '— BLOOM / GLOW —';
    panel.appendChild(hdr4);

    panel.appendChild(makeSlider('Bloom Size', window._nozzleBloomScale || 1.0, 0, 5, 0.1, v => {
      window._nozzleBloomScale = v;
    }));
    panel.appendChild(makeSlider('Bloom Opacity', window._nozzleBloomOpacity != null ? window._nozzleBloomOpacity : 0.34, 0, 1, 0.01, v => {
      window._nozzleBloomOpacity = v;
    }));
    panel.appendChild(makeSlider('Mini Bloom Size', window._miniBloomScale || 1.0, 0, 5, 0.1, v => {
      window._miniBloomScale = v;
    }));

    // ── Cone Thruster ──
    const hdrCone = document.createElement('div');
    hdrCone.style.cssText = 'color:#ff6600;margin:8px 0 4px;font-weight:bold;';
    hdrCone.textContent = '— CONE THRUSTER —';
    panel.appendChild(hdrCone);

    // Cone on/off toggle
    const coneTogBtn = document.createElement('button');
    coneTogBtn.textContent = window._coneThrustersEnabled ? 'Cone Thrusters: ON' : 'Cone Thrusters: OFF';
    coneTogBtn.style.cssText = 'background:' + (window._coneThrustersEnabled ? '#040' : '#400') + ';color:#fff;border:1px solid ' + (window._coneThrustersEnabled ? '#0f0' : '#f00') + ';padding:4px 12px;cursor:pointer;font:11px monospace;margin:4px 4px 4px 0;';
    coneTogBtn.addEventListener('click', () => {
      window._coneThrustersEnabled = !window._coneThrustersEnabled;
      coneTogBtn.textContent = window._coneThrustersEnabled ? 'Cone Thrusters: ON' : 'Cone Thrusters: OFF';
      coneTogBtn.style.background = window._coneThrustersEnabled ? '#040' : '#400';
      coneTogBtn.style.borderColor = window._coneThrustersEnabled ? '#0f0' : '#f00';
    });
    panel.appendChild(coneTogBtn);

    const ct = window._coneThruster;
    const hideOldBtn = document.createElement('button');
    hideOldBtn.textContent = 'Toggle Old Thrusters';
    hideOldBtn.style.cssText = 'background:#333;color:#ff6600;border:1px solid #ff6600;padding:4px 12px;cursor:pointer;font:11px monospace;margin:4px 0;';
    hideOldBtn.addEventListener('click', () => {
      window._hideOldThrusters = !window._hideOldThrusters;
      hideOldBtn.textContent = window._hideOldThrusters ? 'Old Thrusters: OFF' : 'Old Thrusters: ON';
    });
    panel.appendChild(hideOldBtn);
    panel.appendChild(makeSlider('Cone Length', ct.length, 0.5, 8, 0.1, v => { ct.length = v; }));
    panel.appendChild(makeSlider('Cone Radius', ct.radius, 0.02, 1, 0.01, v => { ct.radius = v; }));
    panel.appendChild(makeSlider('Cone Rot X', ct.rotX, -3.15, 3.15, 0.01, v => { ct.rotX = v; }));
    panel.appendChild(makeSlider('Cone Rot Y', ct.rotY, -3.15, 3.15, 0.01, v => { ct.rotY = v; }));
    panel.appendChild(makeSlider('Cone Rot Z', ct.rotZ, -3.15, 3.15, 0.01, v => { ct.rotZ = v; }));
    panel.appendChild(makeSlider('Cone Off X', ct.offX, -2, 2, 0.01, v => { ct.offX = v; }));
    panel.appendChild(makeSlider('Cone Off Y', ct.offY, -2, 2, 0.01, v => { ct.offY = v; }));
    panel.appendChild(makeSlider('Cone Off Z', ct.offZ, -2, 2, 0.01, v => { ct.offZ = v; }));
    panel.appendChild(makeSlider('Neon Power', ct.neonPower, 0.5, 6, 0.1, v => { ct.neonPower = v; }));
    panel.appendChild(makeSlider('Noise Speed', ct.noiseSpeed, 0, 5, 0.1, v => { ct.noiseSpeed = v; }));
    panel.appendChild(makeSlider('Noise Strength', ct.noiseStrength, 0, 1, 0.01, v => { ct.noiseStrength = v; }));
    panel.appendChild(makeSlider('Fresnel Power', ct.fresnelPower, 0.5, 6, 0.1, v => { ct.fresnelPower = v; }));
    panel.appendChild(makeSlider('Cone Opacity', ct.opacity, 0, 1, 0.01, v => { ct.opacity = v; }));

    // ── Heat Haze (low poly only) ──
    const hdrHaze = document.createElement('div');
    hdrHaze.style.cssText = 'color:#00ccff;margin:8px 0 4px;font-weight:bold;';
    hdrHaze.textContent = '— HEAT HAZE —';
    panel.appendChild(hdrHaze);

    if (typeof _thrusterHazePass !== 'undefined' && _thrusterHazePass && _thrusterHazePass.uniforms) {
    panel.appendChild(makeSlider('Haze Intensity', _thrusterHazePass.uniforms.uIntensity.value || 0.7, 0, 2, 0.05, v => {
      window._hazeBaseIntensity = v;
    }));
    panel.appendChild(makeSlider('Haze Radius', _thrusterHazePass.uniforms.uRadius.value, 0.02, 0.4, 0.01, v => {
      _thrusterHazePass.uniforms.uRadius.value = v;
    }));
    panel.appendChild(makeSlider('Haze Direction', _thrusterHazePass.uniforms.uHazeDir.value, -3, 3, 0.1, v => {
      _thrusterHazePass.uniforms.uHazeDir.value = v;
    }));
    } else {
      panel.appendChild(document.createTextNode('(Haze pass not initialized — start a run first)'));
    }

    // ── Material ──
    const hdr5 = document.createElement('div');
    hdr5.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr5.textContent = '— MATERIAL —';
    panel.appendChild(hdr5);

    const _getMeshes = () => _altShipModel && _altShipModel.userData._altMeshes ? _altShipModel.userData._altMeshes : [];
    const _matUpdate = (fn) => { _getMeshes().forEach(m => { if (m.material) { fn(m.material); m.material.needsUpdate = true; } }); };

    const _initEmR = _getMeshes().length > 0 && _getMeshes()[0].material ? _getMeshes()[0].material.emissiveIntensity : 1.0;
    const _initMet = _getMeshes().length > 0 && _getMeshes()[0].material ? _getMeshes()[0].material.metalness : 0.3;
    const _initRgh = _getMeshes().length > 0 && _getMeshes()[0].material ? _getMeshes()[0].material.roughness : 0.5;

    panel.appendChild(makeSlider('Emissive Boost', _initEmR, 0, 3, 0.05, v => {
      _matUpdate(m => { m.emissiveIntensity = v; });
    }));
    panel.appendChild(makeSlider('Metalness', _initMet, 0, 1, 0.05, v => {
      _matUpdate(m => { m.metalness = v; });
    }));
    panel.appendChild(makeSlider('Roughness', _initRgh, 0, 1, 0.05, v => {
      _matUpdate(m => { m.roughness = v; });
    }));

    // Color override button
    const colorWrap = document.createElement('div');
    colorWrap.style.margin = '4px 0';
    const colorLbl = document.createElement('label');
    colorLbl.style.color = '#ff88ff';
    colorLbl.textContent = 'Emissive Color: ';
    const colorInp = document.createElement('input');
    colorInp.type = 'color';
    colorInp.value = '#333333';
    colorInp.style.cssText = 'width:50px;height:22px;border:none;cursor:pointer;vertical-align:middle;';
    colorInp.addEventListener('input', () => {
      const c = new THREE.Color(colorInp.value);
      _matUpdate(m => { m.emissive.copy(c); });
    });
    colorWrap.appendChild(colorLbl);
    colorWrap.appendChild(colorInp);
    panel.appendChild(colorWrap);

    // ── Log Values Button ──
    const logBtn = document.createElement('button');
    logBtn.textContent = 'LOG VALUES TO CONSOLE';
    logBtn.style.cssText = 'background:#222;color:#0f0;border:1px solid #0f0;padding:4px 12px;cursor:pointer;font:11px monospace;margin-top:8px;';
    logBtn.addEventListener('click', () => {
      console.log('[SHIP TUNER] _altShip =', JSON.stringify({
        posX: _altShip.posX, posY: _altShip.posY, posZ: _altShip.posZ,
        rotX: _altShip.rotX, rotY: _altShip.rotY, rotZ: _altShip.rotZ,
        scale: _altShip.scale,
        nozzleL: { x: _altShip.nozzleL.x, y: _altShip.nozzleL.y, z: _altShip.nozzleL.z },
        nozzleR: { x: _altShip.nozzleR.x, y: _altShip.nozzleR.y, z: _altShip.nozzleR.z },
        miniL: { x: _altShip.miniL.x, y: _altShip.miniL.y, z: _altShip.miniL.z },
        miniR: { x: _altShip.miniR.x, y: _altShip.miniR.y, z: _altShip.miniR.z },
        thrusterScale: _altShip.thrusterScale,
        spreadX: window._thrusterSpreadX, spreadY: window._thrusterSpreadY,
        length: window._thrusterLength,
        bloomSize: window._nozzleBloomScale, bloomOpacity: window._nozzleBloomOpacity,
        miniBloomSize: window._miniBloomScale,
      }, null, 2));
    });
    panel.appendChild(logBtn);
  }

  let visible = false;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'KeyG') {
      visible = !visible;
      if (visible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// ═══════════════════════════════════════════════════════════════════════════════
//  FLAMING ASTEROID SYSTEM
//  Rocky enflamed asteroids fall from sky on diagonal trajectories.
//  Tutorial mode only (gated by _asteroidTuner.enabled).
//  Architecture:
//    - _asteroidGroup: THREE.Group pooled per asteroid
//    - Rock shell: IcosahedronGeometry + custom ShaderMaterial (lava cracks via FBM)
//    - Fire shell: slightly larger icosahedron, additive blending, vertex displacement
//    - PointLight child: orange glow casts on water as it falls
//    - Tail particles: BufferGeometry points trailing behind
//    - Impact warning: glow disc on water at projected landing X
//    - Impact: water shockwave + kill check + ripple burst
//    - Pattern: sweep / stagger / random / salvo
// ═══════════════════════════════════════════════════════════════════════════════

// ── Tuner config (all live-editable via panel, key='Y') ──────────────────────
let _chaosMode  = false;  // combined asteroid + lightning stagger mode
let _chaosLevel = 0.0;    // 0=chill stagger, 1=physically impossible

// Chaos curve helpers — called every tick when _chaosMode is on
// Returns the effective frequency (seconds) for a given chaos level
function _chaosAstFreq(c)  { return 3.3 - c * 2.86; }         // 3.3s → 0.44s (−10%)
function _chaosLtFreq(c)   { return 3.5 - c * 3.2; }          // 3.5s → 0.3s
function _chaosStaggerGap(c){ return 0.8 - c * 0.65; }        // 0.8s → 0.15s
function _chaosLtStaggerGap(c){ return 0.7 - c * 0.58; }      // 0.7s → 0.12s
function _chaosSalvo(c)    { return Math.round(1 + c * 6); }   // 1 → 7 shots

const _asteroidTuner = {
  enabled:        false,   // master on/off (tutorial only)
  size:           1.2,     // base radius (world units)
  sizeVariance:   0.4,     // ± random added to size
  frequency:      4.24,    // seconds between spawns — was 3.85, additional −10% pass
  speed:          162,     // travel speed (units/s along trajectory) — was 180, additional −10% pass
  leadFactor:     1.0,     // partial lead: 0=no lead (aim at current X), 1=perfect intercept, 0.6=forgiving
  skyHeight:      42,      // Y spawn height above water at the horizon
  //
  // TRAJECTORY — three independent axes, all slider-controlled:
  //   trajZ  : how far toward the camera the asteroid travels on Z.
  //            0 = lands at the horizon, 160 = lands right at the ship.
  //            Default ~140 so it visibly crosses the whole play field.
  //   trajY  : how far it drops on Y (sky → water). Driven by skyHeight
  //            automatically, but offset here lets you keep height and
  //            shorten/lengthen the Y drop independently.
  //   trajX  : lateral drift added on top of the targeted lane X.
  //            0 = dead-on the lane, higher = random side-scatter.
  trajZ:          140,     // Z distance traveled toward camera (0–160)
  trajY:          1.0,     // multiplier on the Y drop (skyHeight → 0). 1=full drop
  trajX:          0.0,     // ± random lateral scatter at spawn (0 = straight-on, no jitter)
  fireIntensity:  1.0,     // fire shell opacity multiplier
  trailLength:    1.0,     // particle trail length multiplier
  glowRange:      14,      // PointLight range
  killRadius:     2.2,     // collision kill radius at water level
  // Pattern
  pattern:        'random', // 'random' | 'sweep' | 'stagger' | 'salvo'
  sweepSpeed:     0.4,     // lanes/sec for sweep pattern
  pinchStep:      0.12,    // how much the pinch closes per tick (independent of sweepSpeed)
  pinchSpread:    1.0,     // arm spread multiplier: 1=full lane width, 0.5=half, 2=extra wide
  chaseFlank:     0.25,    // chase flank offset as fraction of lane range (0=no flanks, 0.5=wide)
  staggerDual:    false,   // when true: each stagger step fires a 2nd shot at predicted position
  staggerGap:     0.8,     // seconds between stagger drops — tight enough to force movement
  salvoCount:     5,       // how many shots in a stagger/salvo burst
  laneMin:        -8,      // leftmost lane X
  laneMax:         8,      // rightmost lane X
  warningTime:    1.8,     // seconds warning disc shows before impact
  showWarning:    true,    // toggle warning disc on/off
  // Chase difficulty ramp
  chaseRampStart: 4.0,     // initial mirror interval (seconds) — forgiving
  chaseRampEnd:   1.2,     // final mirror interval (seconds) — ruthless
  chaseRampDuration: 90,   // seconds over which ramp plays out
  // Filler (decorative background asteroids)
  lateralEnabled: true,   // spawn lateral asteroids on own timer independent of stagger
  lateralFreq:    0.5,    // seconds between lateral spawns
  lateralMinOff:  8,      // min X offset from shipX
  lateralMaxOff:  25,     // max X offset from shipX
  _lateralTimer:  0,      // internal timer
  fillerEnabled:  true,    // toggle on/off
  fillerFreq:      0.4,    // seconds between filler spawns
  fillerLaneMin:  -20,     // X range — wider than normal to sell depth
  fillerLaneMax:   20,
  fillerSkyHeight: 25,     // spawn height (independent of main skyHeight)
  fillerSizeMin:   0.15,   // scale at max distance from center
  fillerSizeMax:   0.55,   // scale at center
  fillerSpeedMin:  1.2,    // speed multiplier at max distance (fast = far)
  fillerSpeedMax:  0.7,    // speed multiplier at center (slower = closer)
};

// ── Shaders ──────────────────────────────────────────────────────────────────
const _asteroidRockVS = `
varying vec3 vNormal;
varying vec3 vPos;
uniform float uTime;

// Simple hash + FBM for vertex displacement
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  float n=mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                  mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
              mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                  mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  return n*2.0-1.0;
}
float fbm(vec3 p){
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){v+=a*noise3(p); p*=2.1; a*=0.5;}
  return v;
}

void main(){
  vNormal = normalize(normalMatrix * normal);
  // Distort vertex position to make chunky irregular rock
  vec3 displaced = position + normal * (fbm(position * 1.8 + uTime * 0.05) * 0.28);
  vPos = displaced;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}`;

const _asteroidRockFS = `
varying vec3 vNormal;
varying vec3 vPos;
uniform float uTime;

float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z)*2.0-1.0;
}
float fbm(vec3 p){
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){v+=a*noise3(p); p*=2.1; a*=0.5;}
  return v;
}

void main(){
  float nml = dot(normalize(vNormal), vec3(0.0, 1.0, -0.5)) * 0.5 + 0.5;
  // Lava crack pattern: narrow high-contrast ridges
  float crack = fbm(vPos * 3.2 + uTime * 0.12);
  float crack2 = fbm(vPos * 5.8 - uTime * 0.08);
  float lava = smoothstep(0.22, 0.55, crack) * smoothstep(0.18, 0.48, crack2);
  lava = clamp(lava, 0.0, 1.0);

  // Base rock: very dark basalt with slight roughness shading
  vec3 rockColor = mix(vec3(0.06, 0.04, 0.04), vec3(0.18, 0.10, 0.06), nml * 0.5 + fbm(vPos*1.1)*0.3);
  // Lava: glowing orange/red/yellow
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0 + vPos.y * 4.0);
  vec3 lavaColor = mix(vec3(1.0, 0.18, 0.0), vec3(1.0, 0.72, 0.0), crack * pulse);

  vec3 col = mix(rockColor, lavaColor, lava);
  // Emissive hotspots where lava is strongest
  float emission = lava * lava * 2.5 * pulse;
  col = col + lavaColor * emission * 0.6;

  gl_FragColor = vec4(col, 1.0);
}`;

const _asteroidFireVS = `
varying float vAlpha;
varying vec3 vPos;
uniform float uTime;
uniform float uRadius;

float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z)*2.0-1.0;
}
float fbm(vec3 p){
  float v=0.0,a=0.5;
  for(int i=0;i<3;i++){v+=a*noise3(p); p*=2.1; a*=0.5;}
  return v;
}

void main(){
  // Vertex displacement: fire billows outward from surface
  float n = fbm(position * 1.6 + uTime * 0.35);
  vec3 disp = position + normalize(position) * (n * 0.45 + 0.12) * uRadius;
  vPos = disp;

  // Alpha: opaque at equator, fade at poles — fire wraps belly
  float polarFade = 1.0 - abs(normalize(position).y);
  vAlpha = clamp(polarFade * 1.2, 0.0, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(disp, 1.0);
}`;

const _asteroidFireFS = `
varying float vAlpha;
varying vec3 vPos;
uniform float uTime;
uniform float uIntensity;

float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z)*2.0-1.0;
}
float fbm(vec3 p){
  float v=0.0,a=0.5;
  for(int i=0;i<4;i++){v+=a*noise3(p); p*=2.1; a*=0.5;}
  return v;
}

void main(){
  float f = fbm(vPos * 2.5 + vec3(0.0, uTime * 0.8, uTime * 0.3));
  f = f * 0.5 + 0.5;
  // Fire color ramp: core=white-yellow, mid=orange, outer=deep red
  vec3 fireInner = vec3(1.0, 0.95, 0.5);
  vec3 fireMid   = vec3(1.0, 0.38, 0.0);
  vec3 fireOuter = vec3(0.6, 0.05, 0.0);
  vec3 col = mix(fireOuter, fireMid, f);
  col = mix(col, fireInner, smoothstep(0.55, 0.85, f));

  float alpha = vAlpha * (0.55 + 0.45 * f) * uIntensity;
  gl_FragColor = vec4(col, alpha);
}`;

// Impact warning disc shader (glows on water at landing point)
const _asteroidWarnVS = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const _asteroidWarnFS = `
varying vec2 vUv;
uniform float uProgress; // 0=just appeared, 1=impact
uniform float uTime;
void main(){
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  // Pulsing outer ring + inner glow
  float ring = smoothstep(0.75, 0.85, r) * smoothstep(1.0, 0.85, r);
  float inner = smoothstep(0.6, 0.0, r) * 0.25;
  // Pulse gets more frantic as progress → 1
  float pulse = 0.6 + 0.4 * sin(uTime * (4.0 + uProgress * 12.0));
  float alpha = (ring + inner) * pulse * (0.4 + uProgress * 0.6);
  // Color: orange→red as impact nears
  vec3 col = mix(vec3(1.0, 0.55, 0.0), vec3(1.0, 0.1, 0.0), uProgress);
  gl_FragColor = vec4(col, alpha);
}`;

// ── Pool + state ─────────────────────────────────────────────────────────────
const _AST_POOL_SIZE = 12;
const _asteroidPool  = [];      // { group, rockMesh, fireMesh, light, tailGeo, tailPts, warnMesh, warnMat, active, ... }
let   _asteroidActive = [];     // refs into pool currently in flight
let   _astTimer = 0;            // time until next spawn
let   _astSweepX = 0;           // current sweep lane X
let   _astSweepDir = 1;
let   _astStaggerQueue = [];    // pending stagger/salvo lane Xs
let   _astStaggerT = 0;

// Tail particle constants
const _AST_TAIL_COUNT = 60;

function _buildAsteroidInstance() {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // Rock shell
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rockMat = new THREE.ShaderMaterial({
    vertexShader: _asteroidRockVS,
    fragmentShader: _asteroidRockFS,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
  });
  const rockMesh = new THREE.Mesh(rockGeo, rockMat);
  group.add(rockMesh);

  // Fire shell (slightly larger, additive)
  const fireGeo = new THREE.IcosahedronGeometry(1, 2);
  const fireMat = new THREE.ShaderMaterial({
    vertexShader: _asteroidFireVS,
    fragmentShader: _asteroidFireFS,
    uniforms: {
      uTime:      { value: 0 },
      uRadius:    { value: 1.0 },
      uIntensity: { value: 1.0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fireMesh = new THREE.Mesh(fireGeo, fireMat);
  fireMesh.scale.setScalar(1.28);
  group.add(fireMesh);

  // PointLight removed: per-asteroid dynamic PointLights were bumping scene's
  // light-count hash on every spawn/despawn/visibility toggle, invalidating all
  // standard/physical/basic/mirror material program cacheKeys → 8-shader recompile
  // per event = 130–400ms freeze. Fire mesh is additive+emissive and drives enough
  // bloom on its own. Keep glowRange slider as cosmetic no-op for now.

  // Tail particles
  const tailPositions = new Float32Array(_AST_TAIL_COUNT * 3);
  const tailAlphas    = new Float32Array(_AST_TAIL_COUNT);
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPositions, 3));
  tailGeo.setAttribute('alpha',    new THREE.BufferAttribute(tailAlphas, 1));
  const tailMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      attribute float alpha;
      varying float vAlpha;
      void main(){
        vAlpha = alpha;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (80.0 / -mvPos.z) * alpha;
        gl_Position = projectionMatrix * mvPos;
      }`,
    fragmentShader: `
      varying float vAlpha;
      void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        if(d > 0.5) discard;
        float a = (1.0 - d*2.0) * vAlpha;
        gl_FragColor = vec4(1.0, 0.45 + vAlpha*0.3, 0.0, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const tailPts = new THREE.Points(tailGeo, tailMat);
  tailPts.frustumCulled = false;
  scene.add(tailPts);

  // Warning disc on water
  const warnGeo = new THREE.CircleGeometry(1, 32);
  const warnMat = new THREE.ShaderMaterial({
    vertexShader: _asteroidWarnVS,
    fragmentShader: _asteroidWarnFS,
    uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const warnMesh = new THREE.Mesh(warnGeo, warnMat);
  warnMesh.rotation.x = -Math.PI / 2;
  warnMesh.position.y = 0.12;
  warnMesh.visible = false;
  scene.add(warnMesh);

  // Tail history ring buffer
  const tailHistory = [];
  for (let i = 0; i < _AST_TAIL_COUNT; i++) tailHistory.push(new THREE.Vector3(0, 999, 0));

  return {
    group, rockMesh, fireMesh, tailGeo, tailPts, tailHistory,
    warnMesh, warnMat,
    active: false,
    // per-instance state
    vel: new THREE.Vector3(),
    radius: 1,
    landingX: 0,
    landingZ: 0,
    warnTimer: 0,
    totalFallTime: 0,
    elapsed: 0,
    tailWriteIdx: 0,
    tailTimer: 0,
  };
}

// Build pool
for (let _ai = 0; _ai < _AST_POOL_SIZE; _ai++) _asteroidPool.push(_buildAsteroidInstance());

// ── Pre-warm shaders: force GPU compile on all pool instances before first spawn
// so the first real asteroid doesn't cause a hitch. We render each mesh once
// at an off-screen position using renderer.compile().
(function _preWarmAsteroidShaders() {
  // Compile all unique ShaderMaterials by building throwaway meshes with the same
  // material — never touching the actual pool groups so scene membership is untouched.
  const _warmScene = new THREE.Scene();
  const _warmCam   = new THREE.PerspectiveCamera();
  const _warmGeo   = new THREE.IcosahedronGeometry(1, 2); // tiny proxy geometry
  const _seenMats  = new Set();
  for (const inst of _asteroidPool) {
    for (const mat of [inst.rockMesh.material, inst.fireMesh.material,
                       inst.tailPts.material, inst.warnMat]) {
      if (mat && !_seenMats.has(mat)) {
        _seenMats.add(mat);
        const proxy = new THREE.Mesh(_warmGeo, mat);
        _warmScene.add(proxy);
      }
    }
  }
  try { renderer.compile(_warmScene, _warmCam); } catch(e) {}
  _warmGeo.dispose();
  // _warmScene and proxy meshes go out of scope and are GC'd
})();

// ── Helper: get free instance from pool ──────────────────────────────────────
function _getAsteroidFromPool() {
  return _asteroidPool.find(a => !a.active) || null;
}

// ── Spawn one asteroid ───────────────────────────────────────────────────────
function _spawnAsteroid(targetX) {
  const inst = _getAsteroidFromPool();
  if (!inst) return;
  if (window._perfDiag) window._perfDiag.tag('asteroid_spawn', inst.userData && inst.userData._hasRendered ? 'pooled' : 'fresh');
  if (inst.userData) inst.userData._hasRendered = true;
  const T = _asteroidTuner;
  const radius = T.size + (Math.random() - 0.5) * T.sizeVariance * 2;

  // ── Trajectory ──
  // Spawn at the horizon (SPAWN_Z, same as cones), elevated by skyHeight.
  // Land position is driven by three independent tuner sliders:
  //   trajZ  → how far toward the camera it travels (landZ = spawnZ + trajZ)
  //   trajY  → multiplier on height drop (1.0 = full drop to water)
  //   trajX  → lateral jitter at spawn point
  // Spawn at horizon, elevated
  const spawnY = T.skyHeight;
  const spawnZ = SPAWN_Z; // -160

  // Landing point: always at ship Z (ship is static, world scrolls)
  const landZ = shipGroup.position.z;
  const landY = 0.15;

  // ── Quadratic intercept targeting ──────────────────────────────────────────
  // totalTime: straight-line fall from (spawnX, spawnY, spawnZ) to (landX, landY, landZ).
  // Since vel.x will be 0 (spawnX = landX), only Y and Z contribute to distance.
  const totalTime = Math.sqrt((landY - spawnY) ** 2 + (landZ - spawnZ) ** 2) / T.speed;

  // Predict where the ship will actually be when the asteroid lands:
  //   landX = targetX + shipVelX * totalTime
  // This is pure physics — if the ship keeps its current velocity it will be here at impact.
  // leadFactor lets you dial it back (1.0 = perfect prediction, 0.6 = gives player a chance to escape).
  const shipVelX_now = (state && state.shipVelX) || 0;
  const landX = targetX + shipVelX_now * totalTime * T.leadFactor;

  // Spawn X = same as landX so trajectory is straight down-forward (vel.x = 0)
  const spawnX = landX;

  // Velocity vector: reuse pooled vector on inst to avoid GC allocation
  inst.vel.set(
    (landX - spawnX) / totalTime,
    (landY - spawnY) / totalTime,
    (landZ - spawnZ) / totalTime
  );

  // Scale meshes to radius
  inst.group.scale.setScalar(radius);
  inst.rockMesh.material.uniforms.uTime.value = Math.random() * 100;
  inst.fireMesh.material.uniforms.uTime.value  = Math.random() * 100;
  inst.fireMesh.material.uniforms.uRadius.value = radius;
  inst.fireMesh.material.uniforms.uIntensity.value = T.fireIntensity;

  inst.group.position.set(spawnX, spawnY, spawnZ);
  inst.group.visible = true;

  // transparent + depthWrite already set at build time — do NOT reassign here,
  // assigning material properties triggers needsUpdate which forces a shader recompile.

  // (light removed — see _buildAsteroidInstance comment)

  // Warning disc at landing point (hidden until asteroid fades in enough)
  const warnRadius = Math.max(3.0, radius * 2.5);
  inst.warnMesh.position.set(landX, 0.12, landZ);
  inst.warnMesh.scale.setScalar(warnRadius);
  inst.warnMesh.visible = false; // shown once fadeT > 0.3
  inst.warnMat.uniforms.uProgress.value = 0;
  inst.warnMat.uniforms.uTime.value = 0;

  // Randomize rotation
  inst.group.rotation.set(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2
  );

  inst.radius   = radius;
  inst.landingX = landX;
  inst.landingZ = landZ;
  inst.totalFallTime = totalTime;
  inst.elapsed  = 0;
  inst.warnTimer = 0;
  inst.tailWriteIdx = 0;
  inst.tailTimer = 0;
  // Reset tail history
  for (let ti = 0; ti < _AST_TAIL_COUNT; ti++) inst.tailHistory[ti].set(0, 999, 0);
  inst.tailPts.visible = true;
  inst.active = true;

  _asteroidActive.push(inst);
  return inst;
}

// ── Kill one asteroid ─────────────────────────────────────────────────────────
function _killAsteroid(inst, impact) {
  inst.active = false;
  inst.isFiller = false; // reset so pool reuse is clean
  inst.group.visible = false;
  inst.tailPts.visible = false;
  inst.warnMesh.visible = false;

  if (impact) {
    // Water shockwave at landing point
    _triggerShockwave(new THREE.Vector3(inst.landingX, 0.5, inst.landingZ));
    if (!inst.isFiller) _playAsteroidImpact();
    // Burst wake rings (capped at 3 to avoid frame hitch)
    for (let ri = 0; ri < 3; ri++) {
      spawnWakeRing(
        inst.landingX + (Math.random()-0.5)*inst.radius,
        inst.landingZ + (Math.random()-0.5)*inst.radius,
        (Math.random()-0.5)*2
      );
    }
    // Kill check: use asteroid's ACTUAL world position at impact, not pre-stored landing coords.
    if (state.phase === 'playing' && !inst.isFiller) {
      const ax = inst.group.position.x;
      const az = inst.group.position.z;
      const dx = state.shipX - ax;
      const dz = shipGroup.position.z - az;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist < _asteroidTuner.killRadius * inst.radius) {
        if (state._tutorialActive || _godMode) {
          // Tutorial / god mode: play shield-hit sound, no death
          const _shHitSfx = document.getElementById('shield-hit-sfx');
          if (_shHitSfx) { _shHitSfx.currentTime = 0; _shHitSfx.play().catch(()=>{}); }
          addCrashFlash(0xff4400);
        } else {
          killPlayer();
        }
      }
    }
    // Flash the warning disc briefly (already hidden but trigger shockwave covers it)
  }

  const idx = _asteroidActive.indexOf(inst);
  if (idx >= 0) _asteroidActive.splice(idx, 1);
}

// ── Pattern: generate next target X ──────────────────────────────────────────
function _astNextTargetX() {
  const T = _asteroidTuner;
  const range = T.laneMax - T.laneMin;
  const sx = (state && state.shipX) || 0; // always center patterns on ship
  switch (T.pattern) {
    case 'sweep': {
      const x = sx + (_astSweepX - 0.5) * range;
      _astSweepX += _astSweepDir * T.sweepSpeed * T.frequency / range * 0.12;
      if (_astSweepX >= 1.0 || _astSweepX <= 0.0) { _astSweepDir *= -1; _astSweepX = THREE.MathUtils.clamp(_astSweepX, 0, 1); }
      return x;
    }
    case 'stagger': {
      // Always read ship X fresh so each shot tracks the live position
      // Small random nudge keeps it from being perfectly predictable
      const liveX = (state && state.shipX) || 0;
      return liveX + (Math.random() - 0.5) * 1.5;
    }
    case 'salvo': {
      // Handled specially in spawn tick — fallback to random near ship
      return sx + (Math.random() - 0.5) * range * 0.5;
    }
    default: // 'random' — tight scatter around ship so every shot is a threat
      return sx + (Math.random() - 0.5) * 3.0;
  }
}

// ── Update all active asteroids each frame ────────────────────────────────────
function _updateAsteroids(dt) {
  const T = _asteroidTuner;
  const uTime = performance.now() * 0.001;

  for (let ai = _asteroidActive.length - 1; ai >= 0; ai--) {
    const inst = _asteroidActive[ai];
    inst.elapsed += dt;
    const progress = Math.min(inst.elapsed / inst.totalFallTime, 1.0);

    // Move
    inst.group.position.addScaledVector(inst.vel, dt);

    // Slow tumble
    inst.group.rotation.x += 0.4 * dt;
    inst.group.rotation.z += 0.25 * dt;

    // ── Horizon fade-in: same Z bands as cone system ──
    // SPAWN_Z (-160) = invisible, -110 = fully opaque
    const _AST_FADE_START = SPAWN_Z;   // -160
    const _AST_FADE_END   = -100;      // fully visible from here
    const fadeT = Math.max(0, Math.min(1, (inst.group.position.z - _AST_FADE_START) / (_AST_FADE_END - _AST_FADE_START)));

    // Rock visibility driven by fadeT — material flags are fixed at build time (never toggled)
    inst.rockMesh.visible = fadeT > 0.02;
    // Fire shell: has uIntensity, use it as combined fire + fade
    inst.fireMesh.material.uniforms.uIntensity.value = T.fireIntensity * fadeT;
    // Tail: fade alpha with fadeT
    inst.tailPts.material.opacity !== undefined && (inst.tailPts.material.opacity = fadeT);

    // (light removed)

    // Show warning disc once asteroid is visible enough (respects toggle)
    if (T.showWarning && fadeT > 0.3 && progress < 0.88) inst.warnMesh.visible = true;
    else inst.warnMesh.visible = false;

    // Update shader uniforms
    inst.rockMesh.material.uniforms.uTime.value += dt;
    inst.fireMesh.material.uniforms.uTime.value  += dt;

    // Update warning disc
    inst.warnMat.uniforms.uProgress.value = Math.min(progress * 1.2, 1.0);
    inst.warnMat.uniforms.uTime.value += dt;

    // Tail particles: write current position into ring buffer
    inst.tailTimer += dt;
    const tailInterval = 0.022 / Math.max(0.5, T.trailLength);
    if (inst.tailTimer >= tailInterval) {
      inst.tailTimer = 0;
      inst.tailHistory[inst.tailWriteIdx % _AST_TAIL_COUNT].copy(inst.group.position);
      inst.tailWriteIdx++;
    }
    // Update tail buffer
    const tailPos  = inst.tailGeo.attributes.position.array;
    const tailAlph = inst.tailGeo.attributes.alpha.array;
    for (let ti = 0; ti < _AST_TAIL_COUNT; ti++) {
      const histIdx = ((inst.tailWriteIdx - 1 - ti) % _AST_TAIL_COUNT + _AST_TAIL_COUNT) % _AST_TAIL_COUNT;
      const hp = inst.tailHistory[histIdx];
      tailPos[ti*3]   = hp.x;
      tailPos[ti*3+1] = hp.y;
      tailPos[ti*3+2] = hp.z;
      tailAlph[ti] = Math.max(0, (1.0 - ti / _AST_TAIL_COUNT) * T.trailLength * 0.85);
    }
    inst.tailGeo.attributes.position.needsUpdate = true;
    inst.tailGeo.attributes.alpha.needsUpdate    = true;

    // Impact: reached water level or timeout
    const landed = inst.group.position.y <= 0.3 || progress >= 1.0;
    if (landed) {
      _killAsteroid(inst, true);
    }
  }
}

// ── Spawn tick: called from tutorial update block ─────────────────────────────
let _astFillerTimer = 0;

function _spawnFillerAsteroid() {
  const inst = _getAsteroidFromPool();
  if (!inst) return;
  const T = _asteroidTuner;

  // Random X across filler lane range
  const x = T.fillerLaneMin + Math.random() * (T.fillerLaneMax - T.fillerLaneMin);

  // Distance from center [0..1] — drives size and speed
  const maxDist = Math.max(Math.abs(T.fillerLaneMin), Math.abs(T.fillerLaneMax));
  const distFrac = Math.min(Math.abs(x) / maxDist, 1.0);

  // Size: smaller further out (parallax depth)
  const radius = T.fillerSizeMax + (T.fillerSizeMin - T.fillerSizeMax) * distFrac;

  // Speed scalar: faster further out
  const speedMult = T.fillerSpeedMax + (T.fillerSpeedMin - T.fillerSpeedMax) * distFrac;
  const speed = T.speed * speedMult;

  const spawnY = T.fillerSkyHeight;
  const spawnZ = SPAWN_Z;
  const landZ  = shipGroup.position.z - 20; // land well ahead of ship — never reaches it
  const landY  = 0.15;

  const totalTime = Math.sqrt((landY - spawnY) ** 2 + (landZ - spawnZ) ** 2) / speed;

  inst.vel.set(
    0,
    (landY - spawnY) / totalTime,
    (landZ - spawnZ) / totalTime
  );

  inst.group.scale.setScalar(radius);
  inst.rockMesh.material.uniforms.uTime.value = Math.random() * 100;
  inst.fireMesh.material.uniforms.uTime.value  = Math.random() * 100;
  inst.fireMesh.material.uniforms.uRadius.value = radius;
  inst.fireMesh.material.uniforms.uIntensity.value = T.fireIntensity * 0.5; // dimmer

  inst.group.position.set(x, spawnY, spawnZ);
  inst.group.visible = true;

  // (light removed)

  inst.warnMesh.visible = false; // no warning disc for fillers

  inst.group.rotation.set(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2
  );

  inst.radius        = radius;
  inst.landingX      = x;
  inst.landingZ      = landZ;
  inst.totalFallTime = totalTime;
  inst.elapsed       = 0;
  inst.warnTimer     = 0;
  inst.tailWriteIdx  = 0;
  inst.tailTimer     = 0;
  inst.isFiller      = true; // skip hit check
  for (let ti = 0; ti < _AST_TAIL_COUNT; ti++) inst.tailHistory[ti].set(0, 999, 0);
  inst.tailPts.visible = true;
  inst.active = true;

  _asteroidActive.push(inst);
}

function _tickAsteroidSpawner(dt) {
  const T = _asteroidTuner;

  // DIAG: always-logged (throttled once/3s) — prove this function runs and show guard state
  // Logs to console unconditionally so we can see it in a normal playtest log
  if (state._jetLightningMode) {
    window._latTickCounter = (window._latTickCounter || 0) + 1;
    if (window._latTickCounter >= 180) {
      window._latTickCounter = 0;
      console.log('[LAT_DIAG] tick jl=1 le='+(T.lateralEnabled?1:0)
        +' rT='+_jlRampTime.toFixed(1)
        +' corridor='+(_jlCorridor && _jlCorridor.active?1:0)
        +' obs='+(window._jlActiveObstacleType||'-')
        +' timer='+(T._lateralTimer!=null?T._lateralTimer.toFixed(2):'?')
        +' gateOK='+((T.lateralEnabled && _jlRampTime>=4)?1:0));
    }
  }

  // ── Lateral camp punish — asteroid-ONLY. Only fires when the active obstacle is 'asteroid'.
  // Prevents asteroids from firing during LT-only segments (60-90s) and LT-combined segments.
  if (T.lateralEnabled && state._jetLightningMode && _jlRampTime >= 4
      && window._jlActiveObstacleType === 'asteroid') {
    T._lateralTimer -= dt;
    if (T._lateralTimer <= 0) {
      T._lateralTimer = T.lateralFreq * (0.7 + Math.random() * 0.6);
      const side = Math.random() < 0.5 ? 1 : -1;
      const offset = T.lateralMinOff + Math.random() * (T.lateralMaxOff - T.lateralMinOff);
      const sx = (state && state.shipX) || 0;
      const spawnX = sx + side * offset;
      // DIAG: always log lateral fires
      console.log('[LAT_FIRE] obs='+(window._jlActiveObstacleType||'ast')
        +' rT='+_jlRampTime.toFixed(1)+' side='+side+' x='+spawnX.toFixed(1));
      if (window._perfDiag) window._perfDiag.tag('lateral_ast');
      _spawnAsteroid(spawnX);
    }
  }

  if (!T.enabled) return;
  if (_noSpawnMode && !_chaosMode && !state._jetLightningMode) return;
  // Keep chaos params live every tick so slider changes take effect instantly
  if (_chaosMode) {
    const c = _chaosLevel;
    T.pattern    = 'stagger';
    T.frequency  = _chaosAstFreq(c);
    T.staggerGap = _chaosStaggerGap(c);
    T.salvoCount = _chaosSalvo(c);
    T.staggerDual = c > 0.5;
    if (window._LT && window._LT.enabled) {
      window._LT.pattern    = 'stagger';
      window._LT.frequency  = _chaosLtFreq(c);
      window._LT.staggerGap = _chaosLtStaggerGap(c);
      window._LT.salvoCount = _chaosSalvo(c);
    }
  }
  // Pattern loop buttons handle their own spawning — don't double-fire
  if (window._astPatternLoopActive) return;

  _astTimer -= dt;
  _astStaggerT -= dt;

  if (_astTimer <= 0) {
    _astTimer = T.frequency * (0.8 + Math.random() * 0.4) * Math.max(0.15, 1.0 - _funFloorIntensity * 0.85);

    if (T.pattern === 'stagger') {
      // Use the shared _fireStagger if available (wired by tuner IIFE) — identical to loop button
      if (window._fireStagger) { window._fireStagger(); }
      else {
        // Fallback: same logic inline (Y panel not yet opened)
        const steps = Math.max(1, Math.round(T.salvoCount));
        const snapX = state.shipX || 0;
        for (let si = 0; si < steps; si++) {
          setTimeout(() => {
            if (state.phase !== 'playing') return;
            _spawnAsteroid(snapX);
          }, si * T.staggerGap * 1000);
        }
      }
    } else if (T.pattern === 'salvo') {
      // Simultaneous wall spread across lanes centered on ship X
      const count = Math.max(1, Math.round(T.salvoCount));
      const sx = (state && state.shipX) || 0;
      const half = (T.laneMax - T.laneMin) * 0.45;
      for (let si = 0; si < count; si++) {
        const frac = count === 1 ? 0.5 : si / (count - 1);
        const targetX = sx + (frac - 0.5) * half * 2;
        _spawnAsteroid(targetX);
      }
    } else {
      _spawnAsteroid(_astNextTargetX());
    }
  }

  // ── Filler asteroids (decorative, no hit check) ─────────────────────
  if (T.fillerEnabled && state._jetLightningMode && _jlRampTime >= 4) {
    _astFillerTimer -= dt;
    if (_astFillerTimer <= 0) {
      _astFillerTimer = T.fillerFreq * (0.6 + Math.random() * 0.8);
      _spawnFillerAsteroid();
    }
  }

}

// ── Cleanup: remove all active asteroids ─────────────────────────────────────
function _clearAllAsteroids() {
  for (let ai = _asteroidActive.length - 1; ai >= 0; ai--) {
    _killAsteroid(_asteroidActive[ai], false);
  }
  _asteroidActive.length = 0;
  _astTimer = 0;
  _astSweepX = 0; _astSweepDir = 1;
  _astStaggerQueue.length = 0;
}

// ── Hook into main animate loop — append _updateAsteroids after _updateShockwave
// (done via monkey-patch pattern to avoid re-editing large blocks)
const _origUpdateShockwave = _updateShockwave;
// _updateShockwave already declared; we extend the animate-level call by wrapping
// Instead we hook into the existing update() call by extending that function's end.
// Since update() runs the tutorial tick, we extend the tutorial section.
// The cleanest safe hook: override _noSpawnMode setter end; we'll patch the update tail.
// Safest: add to the tail particle update already called in animate via a small wrapper.
(function _hookAsteroidIntoLoop() {
  const _origComposerRender = composer.render.bind(composer);
  let _lastAstDt = 0;
  let _lastAstTime = performance.now();
  composer.render = function(...args) {
    const now = performance.now();
    const dt = Math.min((now - _lastAstTime) * 0.001, 0.05);
    _lastAstTime = now;
    // Run during tutorial gameplay OR when chaos mode is active
    if (state.phase === 'playing' && !state.introActive &&
        (state._tutorialActive || _chaosMode || state._jetLightningMode)) {
      // Corridor takes over — pause all JL obstacle spawning during breather
      // _canyonMode > 0 means slab canyon is active — never use old L3/L4 corridor ticker
      if (_jlCorridor.active && !_canyonActive && !_canyonMode) {
        _jlTickCorridor(dt, state.speed);
      } else if (!_jlCorridor.active) {
        // Run asteroid spawner when no pure corridor is active
        // (open canyon segments have _canyonActive=true but _jlCorridor.active=false — still spawn)
        _tickAsteroidSpawner(dt);
      }
    }
    // Canyon corridor sine tick — only for old L3/L4 cone corridors, never for slab canyon
    if (_canyonActive && _jlCorridor.active && !_canyonMode) {
      _jlTickCorridor(dt, state.speed);
    }
    _updateAsteroids(dt);
    // Canyon corridor walls — only update when actually playing
    if ((_canyonActive || _canyonExiting) && state.phase === 'playing') {
      if (_canyonActive && !_canyonWalls) _createCanyonWalls();
      _updateCanyonWalls(dt, state.speed);
    }
    _origComposerRender(...args);
  };
})();

// ═══════════════════════════════════════════════════════════════════════════════
//  ASTEROID TUNER PANEL  (key = 'Y')
// ═══════════════════════════════════════════════════════════════════════════════
(function setupAsteroidTuner() {
  const panel = document.createElement('div');
  panel.id = 'asteroid-tuner';
  panel.style.cssText = 'display:none;position:fixed;top:0;right:0;width:270px;height:100%;background:rgba(0,0,0,0.93);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;border-left:1px solid #f60;';
  document.body.appendChild(panel);

  function makeSlider(label, val, min, max, step, onChange, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:4px;flex-wrap:wrap;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:108px;color:'+(color||'#f80')+';font-size:10px;flex-shrink:0;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    inp.style.cssText = 'flex:1;height:14px;accent-color:'+(color||'#f80')+';';
    const valEl = document.createElement('span');
    valEl.style.cssText = 'width:36px;text-align:right;font-size:10px;color:#fff;';
    valEl.textContent = (+val).toFixed(2);
    inp.oninput = () => { const v = +inp.value; onChange(v); valEl.textContent = v.toFixed(2); if (window._sessionLogSlider) _sessionLogSlider('ast_' + label, v); };
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(valEl);
    return { row, inp, valEl };
  }

  function makeHeader(text, color) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:10px 0 4px;font-size:11px;font-weight:bold;color:'+(color||'#f80')+';border-bottom:1px solid #333;padding-bottom:2px;';
    h.textContent = text;
    return h;
  }

  function makeToggle(label, getter, setter, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:8px;';
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:1px solid '+(color||'#f80')+';color:'+(color||'#f80')+';padding:3px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;';
    const refresh = () => { btn.textContent = label + ': ' + (getter() ? 'ON' : 'OFF'); btn.style.opacity = getter() ? '1' : '0.5'; };
    btn.onclick = () => { setter(!getter()); refresh(); };
    refresh();
    row.appendChild(btn);
    return row;
  }

  function makeSelect(label, options, getter, setter, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'color:'+(color||'#f80')+';font-size:10px;width:108px;flex-shrink:0;';
    lbl.textContent = label;
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;background:#111;color:#fff;border:1px solid #f80;font-family:monospace;font-size:10px;padding:2px;';
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o === getter()) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => setter(sel.value);
    row.appendChild(lbl); row.appendChild(sel);
    return row;
  }

  function build() {
    panel.innerHTML = '<div style="font-size:13px;font-weight:bold;color:#f60;margin-bottom:6px;">☄ ASTEROID TUNER (Y)</div>';
    const T = _asteroidTuner;

    // MASTER
    panel.appendChild(makeHeader('MASTER', '#f60'));
    panel.appendChild(makeToggle('ENABLED', () => T.enabled, v => {
      T.enabled = v;
      if (!v) _clearAllAsteroids();
      else { _astTimer = 0.5; } // spawn quickly on enable
    }, '#f60'));
    panel.appendChild(makeToggle('TUTORIAL MODE', () => state._tutorialActive, v => {
      state._tutorialActive = v;
      if (v) {
        // Apply JL_v1 physics as tutorial baseline
        const _tp = _PHYSICS_PRESETS['JL_v1'];
        _accelBase = _tp.accelBase; _accelSnap = _tp.accelSnap;
        _maxVelBase = _tp.maxVelBase; _maxVelSnap = _tp.maxVelSnap;
        _bankMax = _tp.bankMax; _bankSmoothing = _tp.bankSmoothing;
        _decelBasePct = _tp.decelBasePct; _decelFullPct = _tp.decelFullPct;
        state.phase = 'playing'; state._tutorialStep = 2;
      }
    }, '#ff0'));

    // PHYSICAL
    panel.appendChild(makeHeader('PHYSICAL'));
    panel.appendChild(makeSlider('size', T.size, 0.3, 4.0, 0.05, v => T.size = v, '#f80').row);
    panel.appendChild(makeSlider('size variance', T.sizeVariance, 0, 2.0, 0.05, v => T.sizeVariance = v, '#f80').row);
    panel.appendChild(makeSlider('speed', T.speed, 4, 200, 0.5, v => T.speed = v, '#fa0').row);
    panel.appendChild(makeSlider('lead factor', T.leadFactor, 0, 1, 0.01, v => T.leadFactor = v, '#fa0').row);
    panel.appendChild(makeSlider('kill radius', T.killRadius, 0.5, 6.0, 0.1, v => T.killRadius = v, '#f44').row);

    panel.appendChild(makeHeader('TRAJECTORY', '#8cf'));
    const trajNote = document.createElement('div');
    trajNote.style.cssText = 'font-size:9px;color:#666;margin:2px 0 6px;line-height:1.4;';
    trajNote.textContent = 'Always lands at ship Z. skyHeight = arc steepness. scatter = lane spread.';
    panel.appendChild(trajNote);
    panel.appendChild(makeSlider('sky height', T.skyHeight, 5, 120, 1, v => T.skyHeight = v, '#8cf').row);
    panel.appendChild(makeSlider('lane scatter', T.trajX, 0, 20, 0.5, v => T.trajX = v, '#8cf').row);

    // VISUALS
    panel.appendChild(makeHeader('VISUALS'));
    panel.appendChild(makeSlider('fire intensity', T.fireIntensity, 0, 3.0, 0.05, v => {
      T.fireIntensity = v;
      _asteroidActive.forEach(a => { a.fireMesh.material.uniforms.uIntensity.value = v; });
    }, '#f84').row);
    panel.appendChild(makeSlider('trail length', T.trailLength, 0, 3.0, 0.05, v => T.trailLength = v, '#fa0').row);
    panel.appendChild(makeSlider('glow range', T.glowRange, 0, 40, 0.5, v => {
      T.glowRange = v; // cosmetic: per-asteroid PointLight removed (perf)
    }, '#f60').row);

    // PATTERN
    panel.appendChild(makeHeader('PATTERN', '#0df'));
    panel.appendChild(makeSelect('pattern', ['random','sweep','stagger','salvo'],
      () => T.pattern, v => { T.pattern = v; _astSweepX = 0; _astStaggerQueue.length = 0; }, '#0df'));
    panel.appendChild(makeSlider('frequency (s)', T.frequency, 0.5, 20, 0.1, v => T.frequency = v, '#0df').row);
    panel.appendChild(makeSlider('sweep speed', T.sweepSpeed, 0.05, 2.0, 0.01, v => T.sweepSpeed = v, '#0df').row);
    panel.appendChild(makeSlider('pinch step', T.pinchStep, 0.01, 0.5, 0.01, v => T.pinchStep = v, '#f0f').row);
    panel.appendChild(makeSlider('pinch spread', T.pinchSpread, 0.1, 3.0, 0.05, v => T.pinchSpread = v, '#f0f').row);
    panel.appendChild(makeToggle('stagger dual shot', () => T.staggerDual, v => { T.staggerDual = v; }));
    panel.appendChild(makeSlider('stagger gap', T.staggerGap, 0.2, 5.0, 0.1, v => T.staggerGap = v, '#0df').row);
    panel.appendChild(makeSlider('salvo count', T.salvoCount, 1, 8, 1, v => T.salvoCount = Math.round(v), '#0df').row);
    panel.appendChild(makeSlider('lane min X', T.laneMin, -20, 0, 0.5, v => T.laneMin = v, '#8df').row);
    panel.appendChild(makeSlider('lane max X', T.laneMax, 0, 20, 0.5, v => T.laneMax = v, '#8df').row);

    // CHASE RAMP
    panel.appendChild(makeHeader('CHASE RAMP', '#f84'));
    panel.appendChild(makeSlider('ramp start (s)', T.chaseRampStart, 0.5, 10, 0.1, v => T.chaseRampStart = v, '#f84').row);
    panel.appendChild(makeSlider('ramp end (s)', T.chaseRampEnd, 0.1, 5, 0.05, v => T.chaseRampEnd = v, '#f84').row);
    panel.appendChild(makeSlider('ramp duration (s)', T.chaseRampDuration, 10, 300, 5, v => T.chaseRampDuration = v, '#f84').row);
    panel.appendChild(makeSlider('chase flank', T.chaseFlank, 0, 0.6, 0.01, v => T.chaseFlank = v, '#f84').row);

    // CHAOS MODE
    panel.appendChild(makeHeader('CHAOS MODE', '#f0f'));
    panel.appendChild(makeToggle('⚡ CHAOS — asteroids + lightning stagger', () => _chaosMode, v => {
      _chaosMode = v;
      if (v) {
        // Force both systems into stagger, enable lightning
        T.pattern = 'stagger';
        T.enabled = true;
        if (window._LT) {
          window._LT.pattern = 'stagger';
          window._LT.enabled = true;
        }
        _astTimer = 0.1; // spawn fast on enable
      } else {
        if (window._LT) window._LT.enabled = false;
      }
    }, '#f0f'));
    panel.appendChild(makeSlider('chaos level', _chaosLevel, 0.0, 1.0, 0.01, v => {
      _chaosLevel = v;
      // Live-update both systems immediately
      T.frequency   = _chaosAstFreq(v);
      T.staggerGap  = _chaosStaggerGap(v);
      T.salvoCount  = _chaosSalvo(v);
      T.staggerDual = v > 0.5;
      if (window._LT) {
        window._LT.frequency  = _chaosLtFreq(v);
        window._LT.staggerGap = _chaosLtStaggerGap(v);
        window._LT.salvoCount = _chaosSalvo(v);
      }
    }, '#f0f').row);

    // DANGER ZONE
    panel.appendChild(makeHeader('DANGER ZONE', '#f44'));
    panel.appendChild(makeToggle('show warning disc', () => T.showWarning, v => {
      T.showWarning = v;
      if (!v) _asteroidActive.forEach(a => { a.warnMesh.visible = false; });
    }, '#f44'));
    panel.appendChild(makeSlider('warning time', T.warningTime, 0.2, 4.0, 0.1, v => T.warningTime = v, '#f44').row);

    // ACTIONS
    panel.appendChild(makeHeader('ACTIONS', '#0f8'));

    // Single one-shot
    const spawnBtn = document.createElement('button');
    spawnBtn.textContent = '▼ ONE';
    spawnBtn.style.cssText = 'background:#060;border:1px solid #0f8;color:#0f8;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:3px 0;width:100%;';
    spawnBtn.onclick = () => {
      if (state.phase !== 'playing') state.phase = 'playing';
      _spawnAsteroid((state && state.shipX) || 0);
    };
    panel.appendChild(spawnBtn);

    // Continuous pattern toggles — self-scheduling setTimeout so T.frequency is live.
    // Only one loop runs at a time; starting one stops any previous.
    let _activePatternTimeout = null;  // current pending setTimeout handle
    let _activePatternCancelFn = null; // cancel function for the running loop
    let _activePatternBtn = null;

    function _stopPatternLoop() {
      if (_activePatternCancelFn) { _activePatternCancelFn(); _activePatternCancelFn = null; }
      if (_activePatternTimeout) { clearTimeout(_activePatternTimeout); _activePatternTimeout = null; }
      if (_activePatternBtn) { _activePatternBtn.style.outline = 'none'; _activePatternBtn.style.opacity = '1'; _activePatternBtn = null; }
      window._astPatternLoopActive = false;
    }

    // Shared stagger fire — used by loop button AND JL auto-spawner
    // Snapshots ship X at fire time — all steps land at the same X column
    window._fireStagger = function _fireStagger() {
      const T = _asteroidTuner;
      const steps = Math.max(1, Math.round(T.salvoCount));
      const snapX = state.shipX || 0; // snapshot ship X once — don't track movement
      for (let si = 0; si < steps; si++) {
        setTimeout(() => {
          if (state.phase !== 'playing') return;
          _spawnAsteroid(snapX);
          if (T.staggerDual) {
            const spawnY = T.skyHeight;
            const totalTime = Math.sqrt((0 - spawnY) ** 2 + (3.9 - (-160)) ** 2) / T.speed;
            const leadX = snapX + (state.shipVelX || 0) * totalTime * T.leadFactor;
            if (Math.abs(leadX - snapX) > 0.8) _spawnAsteroid(leadX);
          }
        }, si * T.staggerGap * 1000);
      }
    };

    function _startPatternLoop(btn, color, tickFn) {
      if (_activePatternBtn === btn) { _stopPatternLoop(); return; } // toggle off
      _stopPatternLoop();
      _activePatternBtn = btn;
      window._astPatternLoopActive = true;
      btn.style.outline = `2px solid ${color}`;
      btn.style.opacity = '0.75';
      if (state.phase !== 'playing') state.phase = 'playing';
      state._tutorialActive = true; // suppress prologue while pattern loop is running
      let cancelled = false;
      _activePatternCancelFn = () => { cancelled = true; };
      const scheduleNext = () => {
        const delay = Math.max(100, T.frequency * 1000);
        _activePatternTimeout = setTimeout(() => {
          if (cancelled) return;
          if (state.phase === 'playing') tickFn();
          scheduleNext();
        }, delay);
      };
      tickFn(); // fire immediately
      scheduleNext();
    }

    function _startChaseLoop(btn) {
      // Chase-specific loop with difficulty ramp: interval lerps chaseRampStart→chaseRampEnd over chaseRampDuration seconds.
      if (_activePatternBtn === btn) { _stopPatternLoop(); return; } // toggle off
      _stopPatternLoop();
      _activePatternBtn = btn;
      window._astPatternLoopActive = true;
      btn.style.outline = '2px solid #f84';
      btn.style.opacity = '0.75';
      if (state.phase !== 'playing') state.phase = 'playing';
      state._tutorialActive = true; // suppress prologue while pattern loop is running
      const rampOrigin = (state.elapsed || 0);
      const chaseTick = () => {
        // Fire a burst of 3: mirror shot + one flanking on each side to force real movement
        if (typeof window._astChaseLastX === 'undefined') window._astChaseLastX = state.shipX;
        const prevX = window._astChaseLastX;
        const shipX = state.shipX;
        const mirrorX = shipX + (shipX - prevX);
        const targetX = mirrorX;
        const flank = (T.laneMax - T.laneMin) * T.chaseFlank;
        _spawnAsteroid(targetX); // mirror shot
        setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(targetX - flank); }, 280);
        setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(targetX + flank); }, 560);
        window._astChaseLastX = targetX;
      };
      let cancelled = false;
      _activePatternCancelFn = () => { cancelled = true; };
      const scheduleNext = () => {
        const elapsed = Math.max(0, (state.elapsed || 0) - rampOrigin);
        const tRamp = Math.min(elapsed / Math.max(1, T.chaseRampDuration), 1);
        const interval = T.chaseRampStart + (T.chaseRampEnd - T.chaseRampStart) * tRamp;
        _activePatternTimeout = setTimeout(() => {
          if (cancelled) return;
          if (state.phase === 'playing') chaseTick();
          scheduleNext();
        }, Math.max(100, interval * 1000));
      };
      chaseTick(); // fire immediately
      scheduleNext();
    }

    // Burst helper: spawn targets[i] after i*gapMs, snapshotting ship X at call time
    function _burstSpawn(targets, gapMs) {
      targets.forEach((x, i) => {
        if (i === 0) { _spawnAsteroid(x); return; }
        setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(x); }, i * gapMs);
      });
    }

    const _patternDefs = [
      {
        // RANDOM: 4 shots scattered around ship X — always threatening, never safe to stay put
        label: '▼▼ RANDOM (loop)',
        color: '#0f8',
        tick: () => {
          // re-read shipX at each fire time so delayed shots still track
          const half = (T.laneMax - T.laneMin) * 0.5;
          const offsets = Array.from({ length: 4 }, () => (Math.random() - 0.5) * half * 2.5);
          offsets.forEach((off, i) => {
            setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(state.shipX + off); }, i * 350);
          });
        },
      },
      {
        // SWEEP: burst of 5 shots, origin tracks ship X, sweeps laterally across the lane range
        label: '►◄ SWEEP (loop)',
        color: '#0df',
        tick: () => {
          const range = T.laneMax - T.laneMin;
          const sweepOffset = (_astSweepX - 0.5) * range;
          _astSweepX += _astSweepDir * T.sweepSpeed * 0.35;
          if (_astSweepX >= 1 || _astSweepX <= 0) { _astSweepDir *= -1; _astSweepX = THREE.MathUtils.clamp(_astSweepX, 0, 1); }
          const waveSize = 5;
          // compute fracs now, re-read shipX at each fire time
          const fracs = Array.from({ length: waveSize }, (_, i) => i / (waveSize - 1));
          fracs.forEach((frac, i) => {
            setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(state.shipX + sweepOffset + (frac - 0.5) * range * 0.5); }, i * 200);
          });
        },
      },
      {
        // PINCH: 5 pairs fired 300ms apart, arms close on ship X — you see them converging
        // and must commit to a lane before the kill shot lands center
        label: '▷◁ PINCH (loop)',
        color: '#f0f',
        tick: () => {
          const sx = state.shipX; // snapshot — arms all target where you ARE now
          const pairCount = 5;
          const gapMs = 300;
          const fullHalf = (T.laneMax - T.laneMin) * 0.5 * T.pinchSpread;
          for (let pi = 0; pi < pairCount; pi++) {
            const progress = pi / (pairCount - 1); // 0=wide, 1=closed
            const halfSpread = Math.max(0.3, fullHalf * (1.0 - progress));
            const delay = pi * gapMs;
            (function(hs, d) {
              const fn = () => {
                if (state.phase !== 'playing') return;
                _spawnAsteroid(sx - hs);
                _spawnAsteroid(sx + hs);
              };
              if (d === 0) fn(); else setTimeout(fn, d);
            })(halfSpread, delay);
          }
          // Kill shot dead-center after arms close
          setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(sx); }, pairCount * gapMs);
        },
      },
      // CHASE is handled separately via _startChaseLoop (difficulty ramp)
      // placeholder entry omitted — button wired below
      {
        // STAGGER: rolling wall left→right, centered on ship X so no lane is permanently safe
        label: '▼ ▼▼ STAGGER (loop)',
        color: '#ff0',
        tick: () => { if (window._fireStagger) window._fireStagger(); },
      },
      {
        // SALVO: simultaneous wall centered on ship X — survive by reading the gaps
        label: '▼▼▼ SALVO (loop)',
        color: '#f80',
        tick: () => {
          const sx = state.shipX;
          const count = Math.max(1, Math.round(T.salvoCount));
          const half = (T.laneMax - T.laneMin) * 0.45;
          for (let si = 0; si < count; si++) {
            const frac = count === 1 ? 0.5 : si / (count - 1);
            _spawnAsteroid(sx + (frac - 0.5) * half * 2);
          }
        },
      },
        ];

    _patternDefs.forEach(({ label, color, tick }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `background:none;border:1px solid ${color};color:${color};padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px 0;width:100%;text-align:left;transition:opacity 0.1s;`;
      btn.onclick = () => _startPatternLoop(btn, color, tick);
      panel.appendChild(btn);
    });

    // CHASE button — wired to ramp loop
    {
      const chaseBtn = document.createElement('button');
      chaseBtn.textContent = '⇔ CHASE (loop, ramp)';
      chaseBtn.style.cssText = 'background:none;border:1px solid #f84;color:#f84;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px 0;width:100%;text-align:left;transition:opacity 0.1s;';
      chaseBtn.onclick = () => _startChaseLoop(chaseBtn);
      panel.appendChild(chaseBtn);
    }

    const stopBtn = document.createElement('button');
    stopBtn.textContent = '⏹ STOP LOOP';
    stopBtn.style.cssText = 'background:#222;border:1px solid #888;color:#aaa;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:4px 0 2px;width:100%;';
    stopBtn.onclick = () => _stopPatternLoop();
    panel.appendChild(stopBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕ CLEAR ALL';
    clearBtn.style.cssText = 'background:#300;border:1px solid #f44;color:#f44;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px 0;width:100%;';
    clearBtn.onclick = () => { _stopPatternLoop(); _clearAllAsteroids(); };
    panel.appendChild(clearBtn);

    // Active count
    const countEl = document.createElement('div');
    countEl.style.cssText = 'margin-top:6px;color:#888;font-size:10px;';
    const refreshCount = () => { countEl.textContent = 'active: ' + _asteroidActive.length + ' / ' + _AST_POOL_SIZE; };
    refreshCount();
    setInterval(refreshCount, 500);
    panel.appendChild(countEl);

    // ── LATERAL section
    panel.appendChild(makeHeader('LATERAL CAMP PUNISH', '#fa4'));
    panel.appendChild(makeToggle('enabled', () => T.lateralEnabled, v => { T.lateralEnabled = v; }));
    panel.appendChild(makeSlider('frequency (s)', T.lateralFreq, 0.1, 5.0, 0.1, v => T.lateralFreq = v, '#fa4').row);
    panel.appendChild(makeSlider('min offset', T.lateralMinOff, 0, 60, 1, v => T.lateralMinOff = v, '#fa4').row);
    panel.appendChild(makeSlider('max offset', T.lateralMaxOff, 0, 100, 1, v => T.lateralMaxOff = v, '#fa4').row);
    // ── FILLER section
    panel.appendChild(makeHeader('FILLER (decorative)', '#88f'));
    panel.appendChild(makeToggle('enabled (JL stagger only)', () => T.fillerEnabled, v => { T.fillerEnabled = v; }));
    panel.appendChild(makeSlider('frequency (s)', T.fillerFreq, 0.05, 3.0, 0.05, v => T.fillerFreq = v, '#88f').row);
    panel.appendChild(makeSlider('sky height', T.fillerSkyHeight, 1, 80, 1, v => T.fillerSkyHeight = v, '#88f').row);
    panel.appendChild(makeSlider('lane min', T.fillerLaneMin, -40, 0, 1, v => T.fillerLaneMin = v, '#8df').row);
    panel.appendChild(makeSlider('lane max', T.fillerLaneMax, 0, 40, 1, v => T.fillerLaneMax = v, '#8df').row);
    panel.appendChild(makeSlider('size near', T.fillerSizeMax, 0.05, 1.5, 0.05, v => T.fillerSizeMax = v, '#88f').row);
    panel.appendChild(makeSlider('size far', T.fillerSizeMin, 0.05, 1.0, 0.05, v => T.fillerSizeMin = v, '#88f').row);
    panel.appendChild(makeSlider('speed near', T.fillerSpeedMax, 0.1, 3.0, 0.05, v => T.fillerSpeedMax = v, '#f8f').row);
    panel.appendChild(makeSlider('speed far', T.fillerSpeedMin, 0.1, 3.0, 0.05, v => T.fillerSpeedMin = v, '#f8f').row);
  }

  let visible = false;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'y' || e.key === 'Y') {
      visible = !visible;
      if (visible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();


// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
//  JET LIGHTNING MODE
//  A standalone arcade mode: asteroids → lightning → glacier terrain, ramping
//  difficulty over time. Physics tuned for high-speed lateral feel.
// ═══════════════════════════════════════════════════════════════════════════════

let _jlRampTime      = 0;   // seconds elapsed in Jet Lightning mode

function startJetLightning() {
  // ── Flag ──────────────────────────────────────────────────────────────────
  state._jetLightningMode = true;
  state._tutorialActive   = false;

  // ── Physics override ──────────────────────────────────────────────────────
  _accelBase      = 60;
  _accelSnap      = 100;
  _maxVelBase     = 13;    // JL_v2 — tighter lateral cap, more intentional feel
  _maxVelSnap     = 23;
  _bankMax        = 0.04;
  _bankSmoothing  = 8;

  // ── Reset ramp timer + corridor/canyon state ──────────────────────────────
  _jlRampTime          = 0;
  _jlCorridor.active   = false;
  _canyonActive        = false;
  _canyonExiting       = false;
  _canyonMode          = 0;
  if (_canyonWalls) _destroyCanyonWalls();
  _jlFatConeTimer      = 99;
  _jlLrTimer           = 99;
  // Clear any in-flight lethal rings from a previous session
  for (const lr of _lethalRingActive) { lr.userData.active = false; lr.visible = false; lr.position.set(0,-9999,0); }
  _lethalRingActive.length = 0;
  // Reset track activation state so onActivate fires fresh each run
  for (const k of Object.keys(_jlTrackActive)) _jlTrackActive[k] = false;
  // ── Asteroids: disabled at start — track system enables at startT:4 ────────
  const T = _asteroidTuner;
  T.enabled      = false;
  T.pattern      = 'stagger';
  T.frequency    = 1.4;    // locked from session log (rchouake approved)
  T.staggerGap   = 0.6;    // locked from session log
  T.salvoCount   = 1;      // stagger = 1 shot at a time, tracking ship live
  T.speed        = 200;
  T.size         = 1.2;    // locked from session log
  T.sizeVariance = 0.55;   // locked from session log
  T.skyHeight    = 42;
  T.leadFactor   = 0.0;    // aim at ship's CURRENT position, not predicted
  T.staggerDual  = false;  // dual shot unlocks in Phase 3 only
  T.killRadius   = 2.2;
  T.laneMin      = -8;
  T.laneMax      =  8;
  _astTimer      = 2.0;  // 2s grace period after liftoff before first asteroid

  // ── Lightning: OFF at start — ramp turns it on ────────────────────────────
  if (window._LT) {
    window._LT.enabled    = false;
    window._LT.frequency  = 0.3;   // locked from session log
    window._LT.count      = 1;
    window._LT.jaggedness = 1.9;
    window._LT.glowRadius = 0.25;
    window._LT.spawnZ     = -83;
    window._LT.pattern    = 'random';
    window._LT.laneMin    = -8;
    window._LT.laneMax    =  8;
  }

  // ── Ice: OFF at start — ramp turns it on ─────────────────────────────────
  if (window._ICE) {
    window._ICE.enabled = false;
  }

  // ── Terrain: OFF at start — ramp turns it on ─────────────────────────────
  if (_terrainWalls) {
    _terrainWalls.strips.forEach(m => { m.visible = false; });
  }

  // ── noSpawnMode: clear ────────────────────────────────────────────────────
  _noSpawnMode = false;

  // ── Start the game ────────────────────────────────────────────────────────
  startGame();

  // ── Re-apply JL flags AFTER startGame() resets them ─────────────────────
  state._jetLightningMode  = true;
  // Campaign prologue runs normally (startGame sets introActive=true);
  // the prologue's own _launchDeathRun() clears introActive & _introLiftActive
  // when the player taps or the 18.5s auto-launch fires.

  // Re-apply physics — startGame() resets to campaign defaults internally
  _accelBase      = 60;
  _accelSnap      = 100;
  _maxVelBase     = 13;
  _maxVelSnap     = 23;
  _bankMax        = 0.04;
  _bankSmoothing  = 8;

  _asteroidTuner.enabled     = false;  // track system enables at startT:4
  _asteroidTuner.showWarning  = false;
  _noSpawnMode               = false;
  _astTimer                = 4.0;  // 4s grace after liftoff
  state.l4CorridorActive   = false;
  state.l4CorridorDone     = true;
  state.score         = 490; // LEVELS[3].scoreThreshold
  state.currentLevelIdx = 3;
  currentLevelDef     = LEVELS[3];
  targetLevelDef      = LEVELS[3];
  state.speed         = BASE_SPEED * LEVELS[3].speedMult; // 1.5x = L4

  // ── Canyon test mode: activate corridor + canyon walls, kill asteroids ──
  if (_canyonTestMode) {
    _skipL1Intro            = true;
    _godMode                = true;
    _asteroidTuner.enabled  = false;
    state._drL3MaxRows      = 750;
    state.corridorRowsDone  = 60; // skip funnel-in, start where curves are active
    state.corridorSineT     = 0.5028; // pre-seeded to match row 60
    state.corridorSpawnZ    = -7;
    state.corridorDelay     = 0;
    // Prime corridorGapCenter from the seeded sineT so slabs bake non-zero X immediately
    {
      const _cr = 60 - (40 + 4);
      const _ampT = Math.min(1, _cr / 200);
      const _amp  = 10 + (36 - 10) * (_ampT * _ampT);
      state.corridorGapCenter = _amp * Math.sin(0.5028);
    }
    state.corridorGapDir    = 1;
    _jlCorridor.active      = true;
    _jlCorridor.type        = 'l3';
    _jlCorridor.totalRows   = 750;
    _canyonActive           = true;
    if (!_canyonWalls) _createCanyonWalls();
  }

  // ── Pre-warm canyon textures so first corridor spawn has no stutter ────────
  if (!_canyonTexCache) {
    _canyonTexCache = {
      cyanTex: _makeCanyonCyanTex(1),
      darkTex: _makeCanyonDarkTex(2),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  JET LIGHTNING SEQUENCER
//  Each track activates at startT and deactivates at endT (null = forever).
//  _jlIntensity is a scalar locked at 1.0 — wire it to a ramp later.
//  Track types:
//    'asteroid' — sets _asteroidTuner fields each frame while active
//    'lightning' — sets _LT fields each frame while active
//    'fatcone'  — drives its own spawn timer while active
//    'custom'   — calls onActivate() once on entry, onDeactivate() once on exit
// ═══════════════════════════════════════════════════════════════════════════════

let _jlIntensity  = 3.0; // frequency scalar — 3.0 default (doubled from 1.5)
let _jlSizeScalar = 1.0; // size scalar — 1.0 = approved baseline
let _godMode      = false; // no damage — plays shield-hit sound on hit instead of killing

// ─── JL Corridor — reusable self-contained corridor obstacle ─────────────────
// Drives the existing spawnCorridorRow / spawnL4CorridorRow functions
// independent of level/trigger system. Call _jlStartCorridor('l3' or 'l4').
// Rows measured from main-mode playtests:
//   L3: 750 rows at speed 72 ≈ 83s   (loop cut at 750, exit ramp last 20 rows)
//   L4: 518 rows at speed 75.6 ≈ 50s (matches main mode, exit ramp last 20 rows)
const _jlCorridor = {
  active:    false,
  type:      'l3',   // 'l3' or 'l4'
  spawnZ:    -7,
  delay:     2.0,    // seconds of clear gap before first row spawns
  totalRows: 750,    // set by _jlStartCorridor
  exitRows:  20,     // widen walls back out over last N rows
};

function _jlStartCorridor(type) {
  const isL4 = type === 'l4';
  // Reset shared corridor state
  if (isL4) {
    state.l4RowsDone  = 0;
    state.l4SineT     = 0;
    state.l4SpawnZ    = -7;
    state.l4Delay     = 2.0;
  } else {
    state.corridorRowsDone  = 0;
    state.corridorSineT     = 0;
    state.corridorSpawnZ    = -7;
    state.corridorDelay     = 2.0;
    state.corridorGapCenter = 0;
    state.corridorGapDir    = 1;
  }
  state.nearMissBendAllowed = true;
  state.prevCorridorCenter  = 0;
  state.prevCorridorDir     = 0;
  // Clear existing obstacles so entry isn't blocked
  ;[...activeObstacles].forEach(returnObstacleToPool);
  activeObstacles.length = 0;
  // Activate
  _jlCorridor.active    = true;
  _jlCorridor.type      = type;
  _jlCorridor.spawnZ    = -7;
  _jlCorridor.delay     = 2.0;
  _jlCorridor.totalRows = isL4 ? 518 : 750;
}

function _jlStopCorridor() {
  _jlCorridor.active = false;
  // Clear corridor cones
  for (let i = activeObstacles.length - 1; i >= 0; i--) {
    if (activeObstacles[i].userData.isCorridor) {
      returnObstacleToPool(activeObstacles[i]);
      activeObstacles.splice(i, 1);
    }
  }
}

function _jlTickCorridor(dt, effectiveSpd) {
  if (!_jlCorridor.active) return;
  const isL4   = _jlCorridor.type === 'l4';
  const rowsDone = isL4 ? (state.l4RowsDone || 0) : (state.corridorRowsDone || 0);
  const total  = _jlCorridor.totalRows;
  const exitAt = total - _jlCorridor.exitRows;

  // Inject exit-ramp maxRows so existing row functions widen walls cleanly
  if (isL4) {
    state._drL4MaxRows = total;
  } else {
    state._drL3MaxRows = total;
    state.isDeathRun   = state.isDeathRun || false; // preserve, but exit ramp reads isDeathRun
  }

  // Done — clean up (skip if canyon is manually active via V key)
  if (rowsDone >= total && !_canyonManual) {
    _jlStopCorridor();
    if (isL4) { state._drL4MaxRows = undefined; }
    else      { state._drL3MaxRows = undefined; }
    return;
  }

  // Delay (breathing room before walls appear)
  if (isL4) {
    if (state.l4Delay > 0) { state.l4Delay -= dt; return; }
    state.l4SpawnZ += effectiveSpd * dt;
    if (state.l4SpawnZ >= 0) {
      state.l4SpawnZ = -7 + (Math.random() - 0.5) * 2;
      spawnL4CorridorRow();
    }
    // Expose current halfX for canyon walls
    {
      const rd = state.l4RowsDone || 0;
      let hx = L4_CORRIDOR_NARROW_X;
      if (rd < L4_CORRIDOR_CLOSE_ROWS) {
        const t2 = rd / L4_CORRIDOR_CLOSE_ROWS;
        const ease = t2 < 0.5 ? 2*t2*t2 : -1+(4-2*t2)*t2;
        hx = CORRIDOR_WIDE_X + (L4_CORRIDOR_NARROW_X - CORRIDOR_WIDE_X) * ease;
      } else {
        const cr = Math.max(0, rd - (L4_CORRIDOR_CLOSE_ROWS + L4_CORRIDOR_STRAIGHT));
        const sq = Math.min(1, cr / L4_CORRIDOR_AMP_RAMP);
        hx = L4_CORRIDOR_NARROW_X - (L4_CORRIDOR_NARROW_X - 4.5) * (sq * sq);
      }
      _jlCorridor._lastHalfX = hx;
    }
  } else {
    if (state.corridorDelay > 0) { state.corridorDelay -= dt; return; }
    state.corridorSpawnZ += effectiveSpd * dt;
    if (state.corridorSpawnZ >= 0) {
      state.corridorSpawnZ = -7 + (Math.random() - 0.5) * 2;
      spawnCorridorRow();
    }
    // Expose current halfX for canyon walls
    {
      const rd = state.corridorRowsDone || 0;
      let hx = CORRIDOR_NARROW_X;
      if (rd < CORRIDOR_CLOSE_ROWS) {
        const t2 = rd / CORRIDOR_CLOSE_ROWS;
        const ease = t2 < 0.5 ? 2*t2*t2 : -1+(4-2*t2)*t2;
        hx = CORRIDOR_WIDE_X + (CORRIDOR_NARROW_X - CORRIDOR_WIDE_X) * ease;
      } else {
        const cr = Math.max(0, rd - (CORRIDOR_CLOSE_ROWS + CORRIDOR_STRAIGHT_ROWS));
        const sq = Math.min(1, cr / CORRIDOR_AMP_RAMP);
        hx = CORRIDOR_NARROW_X - (CORRIDOR_NARROW_X - 6) * (sq * sq);
      }
      _jlCorridor._lastHalfX = hx;
    }
  }

  // Near-miss bend tracking (scoring/SFX — mirrors main mode)
  const curCenter = state.corridorGapCenter || 0;
  const delta = curCenter - state.prevCorridorCenter;
  const curDir = delta > 0.1 ? 1 : delta < -0.1 ? -1 : state.prevCorridorDir;
  if (curDir !== 0 && curDir !== state.prevCorridorDir) state.nearMissBendAllowed = true;
  state.prevCorridorDir    = curDir;
  state.prevCorridorCenter = curCenter;
}

// ── Track definitions ─────────────────────────────────────────────────────────
// Act 1 — Asteroids (0–45s)
//   0–25s:  stagger sparse → dense
//   25–40s: salvos bleed in as stagger peaks
//   40–45s: breathing room (nothing)
// Act 2 — Lightning (45–100s)
//   45–65s: LT stagger sparse → ramping, asteroids OFF
//   65–80s: LT sweeps layer in
//   80–95s: LT stagger + salvo peak
//   95–100s: breathing room (nothing)
// Act 3 — Combined (100s+)
//   100s+: asteroid stagger + lightning both on, both ramping
// Helper — activate a canyon preset from the JL sequencer (pure obstacle, pauses spawner)
let _canyonSavedDirLight = null;
function _jlCanyonStart(mode) {
  if (_canyonActive || _canyonExiting || _canyonWalls) _destroyCanyonWalls();
  _canyonMode    = mode;
  _canyonExiting = false;
  Object.assign(_canyonTuner, _CANYON_PRESETS[mode] || _CANYON_PRESETS[1]);
  _canyonActive      = true;
  _canyonManual      = false;
  _jlCorridor.active = true;
  state.corridorGapCenter = state.shipX || 0;
  _canyonSavedDirLight = dirLight.intensity;
  dirLight.intensity = 0;
  _createCanyonWalls();
}
// Helper — activate canyon alongside obstacles (does NOT pause spawner)
function _jlCanyonStartOpen(mode) {
  if (_canyonActive || _canyonExiting || _canyonWalls) _destroyCanyonWalls();
  _canyonMode    = mode;
  _canyonExiting = false;
  Object.assign(_canyonTuner, _CANYON_PRESETS[mode] || _CANYON_PRESETS[1]);
  _canyonActive      = true;
  _canyonManual      = false;
  _jlCorridor.active = false;
  state.corridorGapCenter = state.shipX || 0;
  _canyonSavedDirLight = dirLight.intensity;
  dirLight.intensity = 0;
  _createCanyonWalls();
}
// Helper — tear down canyon from JL sequencer
function _jlCanyonStop() {
  if (_canyonActive && _canyonWalls) {
    // Scroll-out exit: let slabs drift off naturally instead of instant pop
    _canyonExiting = true;
  } else if (_canyonWalls) {
    _destroyCanyonWalls();
  }
  _canyonActive      = false;
  _jlCorridor.active = false;
  if (_canyonSavedDirLight !== null) { dirLight.intensity = _canyonSavedDirLight; _canyonSavedDirLight = null; }
}

// Jump JL sequencer to any time — shared by panel buttons and number hotkeys
function _jlJumpToTime(targetT) {
  if (!state._jetLightningMode) return;
  for (const k of Object.keys(_jlTrackActive)) _jlTrackActive[k] = false;
  // Clear corridor state so sequencer starts clean
  _jlCorridor.active = false;
  _canyonExiting = false;
  if (_canyonActive) _jlCanyonStop();
  _jlRampTime = targetT;
  // Always clear both — sequencer will re-enable correct ones next frame
  _asteroidTuner.enabled = false;
  _astTimer = 0.1;
  if (window._LT) window._LT.enabled = false;
  if (window._stopFcLoop) window._stopFcLoop();
  for (const lr of _lethalRingActive) { lr.userData.active = false; lr.visible = false; lr.position.set(0,-9999,0); }
  _lethalRingActive.length = 0;
}

const _JL_TRACKS = [

  // ════════ ACT 1 — ASTEROIDS (0–30s) ══════════════════════════════════════
  {
    id: 'ast_stagger_1', label: 'A1 AST Stagger', type: 'asteroid',
    // freq 1.8 → 1.98 (-10%)
    startT: 4, endT: 20,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 1.98, staggerGap: 0.6, salvoCount: 1,
      size: 1.0, sizeVariance: 0.45, laneMin: -8, laneMax: 8,
    },
  },
  {
    id: 'ast_salvo_1', label: 'A1 AST Salvo', type: 'asteroid',
    startT: 20, endT: 30,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 1.21, staggerGap: 0.5, salvoCount: 2,
      size: 1.2, sizeVariance: 0.55, laneMin: -8, laneMax: 8,
    },
  },

  // ════════ CANYON 1 (30–60s) — pure corridor, pauses spawner ══════════════
  {
    id: 'canyon_1', label: 'Canyon C1', type: 'custom',
    startT: 30, endT: 60,
    onActivate()   { _jlCanyonStart(1); },
    onDeactivate() { _jlCanyonStop(); },
  },

  // ════════ ACT 2 — LIGHTNING ONLY (60–90s) ════════════════════════════════
  {
    id: 'lt_stagger_1', label: 'A2 LT Stagger', type: 'lightning',
    startT: 60, endT: 75,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 0.5, laneMin: -8, laneMax: 8,
    },
    onActivate()   { if (window._asteroidTuner) window._asteroidTuner.enabled = false; },
    onDeactivate() {},
  },
  {
    id: 'lt_sweep_1', label: 'A2 LT Sweep', type: 'lightning',
    startT: 75, endT: 90,
    settings: {
      enabled: true, pattern: 'sweep', leadFactor: 0.0,
      frequency: 0.4, sweepSpeed: 0.4, laneMin: -8, laneMax: 8,
    },
    onActivate()   { if (window._asteroidTuner) window._asteroidTuner.enabled = false; },
    onDeactivate() {},
  },

  // ════════ CANYON 2 (90–120s) — pure corridor, pauses spawner ═════════════
  {
    id: 'canyon_2', label: 'Canyon C2', type: 'custom',
    startT: 90, endT: 120,
    onActivate()   { _jlCanyonStart(2); },
    onDeactivate() { _jlCanyonStop(); },
  },

  // ════════ BREATHER (120–132s) — 12s for canyon 2 scroll-out + pacing ══════

  // ════════ STRAIGHT CANYON + AST + LT PEAK (132–162s) ════════════════════
  {
    id: 'canyon_straight', label: 'Straight Canyon', type: 'custom',
    startT: 132, endT: 162,
    onActivate()   { _jlCanyonStartOpen(4); },
    onDeactivate() { _jlCanyonStop(); },
  },
  {
    id: 'ast_straight', label: 'Straight AST', type: 'asteroid',
    startT: 132, endT: 162,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 1.21, staggerGap: 0.5, salvoCount: 2,
      size: 1.2, sizeVariance: 0.55, laneMin: -8, laneMax: 8,
    },
  },
  {
    id: 'lt_straight', label: 'Straight LT', type: 'lightning',
    startT: 132, endT: 162,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 0.3, laneMin: -8, laneMax: 8,
    },
  },

  // ════════ CORRIDOR 1 + LIGHTNING (162–192s) ═══════════════════════════════
  {
    id: 'canyon_1_lt', label: 'Canyon C1+LT', type: 'custom',
    startT: 162, endT: 192,
    onActivate()   { _jlCanyonStartOpen(1); },
    onDeactivate() { _jlCanyonStop(); },
  },
  {
    id: 'lt_canyon_1', label: 'C1 LT', type: 'lightning',
    startT: 162, endT: 192,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 0.3, laneMin: -8, laneMax: 8,
    },
  },

  // ════════ CORRIDOR 2 + LIGHTNING (192–222s) ═══════════════════════════════
  {
    id: 'canyon_2_lt', label: 'Canyon C2+LT', type: 'custom',
    startT: 192, endT: 222,
    onActivate()   { _jlCanyonStartOpen(2); },
    onDeactivate() { _jlCanyonStop(); },
  },
  {
    id: 'lt_canyon_2', label: 'C2 LT', type: 'lightning',
    startT: 192, endT: 222,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 0.25, laneMin: -8, laneMax: 8,
    },
  },

  // ════════ ENDLESS PEAK — AST + LT (222s+) ════════════════════════════════
  {
    id: 'ast_peak', label: 'Peak AST', type: 'asteroid',
    startT: 222, endT: null,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 1.21, staggerGap: 0.5, salvoCount: 2,
      size: 1.2, sizeVariance: 0.55, laneMin: -8, laneMax: 8,
    },
  },
  {
    id: 'lt_peak', label: 'Peak LT', type: 'lightning',
    startT: 222, endT: null,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 0.25, laneMin: -8, laneMax: 8,
    },
  },
];

// Track which custom tracks have been activated (so onActivate fires once)
const _jlTrackActive = {};

// ── Apply one asteroid track's settings to _asteroidTuner ────────────────────
// _jlIntensity > 1 = shorter interval = more frequent spawns
function _jlApplyAsteroidTrack(track) {
  const T = _asteroidTuner;
  const s = track.settings;
  // Preserve user-tunable values that track settings must never overwrite
  const _keepLateralEnabled = T.lateralEnabled;
  const _keepLateralFreq    = T.lateralFreq;
  const _keepLateralMinOff  = T.lateralMinOff;
  const _keepLateralMaxOff  = T.lateralMaxOff;
  const _keepLateralTimer   = T._lateralTimer;
  for (const k of Object.keys(s)) T[k] = s[k];
  T.lateralEnabled = _keepLateralEnabled;
  T.lateralFreq    = _keepLateralFreq;
  T.lateralMinOff  = _keepLateralMinOff;
  T.lateralMaxOff  = _keepLateralMaxOff;
  T._lateralTimer  = _keepLateralTimer;
  if (s.frequency !== undefined) T.frequency = s.frequency / _jlIntensity;
  if (s.size      !== undefined) T.size      = s.size      * _jlSizeScalar;
  T.enabled = true; // always re-enable when a track is active
}

// ── Apply one lightning track's settings to _LT ───────────────────────────────
function _jlApplyLightningTrack(track) {
  const LT = window._LT;
  if (!LT) return;
  const s = track.settings;
  for (const k of Object.keys(s)) LT[k] = s[k];
  if (s.frequency !== undefined) LT.frequency = s.frequency / _jlIntensity;
}

// ── JL lethal ring row spawner — exact campaign lane-grid algo ──────────────
function _jlSpawnLethalRingRow() {
  _initLethalRings();
  const sx = state.shipX || 0;
  const spawnCount = 3 + Math.floor(Math.random() * 2); // 3-4 rings per row
  const lanes  = Array.from({ length: LANE_COUNT }, (_, i) => i);
  const shuffled = [...lanes].sort(() => Math.random() - 0.5);
  // Guaranteed 2-wide clear gap
  const gapStart = Math.floor(Math.random() * (LANE_COUNT - 1));
  const gapLanes = new Set([gapStart, gapStart + 1]);
  const blocked = [];
  for (const lane of shuffled) {
    if (blocked.length >= spawnCount) break;
    if (gapLanes.has(lane)) continue;
    if (blocked.some(b => Math.abs(b - lane) < 4)) continue; // min 4-lane gap between rings
    blocked.push(lane);
  }
  blocked.forEach(lane => {
    const laneX = sx + (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
    _spawnLethalRing(laneX + (Math.random() - 0.5) * 0.6, SPAWN_Z);
  });
}

// ── Main sequencer tick ───────────────────────────────────────────────────────
let _jlWasInLiftoff = false;
let _jlFatConeTimer = 99;
let _jlLrTimer      = 99; // lethal ring row spawn timer

function _tickJetLightningRamp(dt) {
  if (!state._jetLightningMode || state.phase !== 'playing') return;

  const _inLiftoff = state.introActive || state._introLiftActive;

  if (_jlWasInLiftoff && !_inLiftoff) {
    _astTimer   = 2.0;
    _jlRampTime = 0;
    state.speed = BASE_SPEED * LEVELS[3].speedMult;
  }
  _jlWasInLiftoff = _inLiftoff;
  if (_inLiftoff) return;

  _jlRampTime += dt;
  const t = _jlRampTime;

  // ── Canyon speed bump: +15% while any canyon (pure or open) is active.
  // FOV widens automatically (see render loop targetFOV = _baseFOV + _fovSpeedBoost*speedFrac).
  // Reassign every frame canyon is active/inactive — safe because JL never sets speed
  // outside the initial liftoff transition at line ~22540.
  const _jlBaseSpeed   = BASE_SPEED * LEVELS[3].speedMult;        // 54 u/s
  const _jlCanyonSpeed = _jlBaseSpeed * 1.15;                     // ~62 u/s
  if (_canyonActive || _canyonExiting) {
    state.speed = _jlCanyonSpeed;
  } else {
    state.speed = _jlBaseSpeed;
  }

  // ── Corridor breather — pause asteroid/lightning spawning, but still check
  // custom track deactivation so canyon onDeactivate fires at endT
  if (_jlCorridor.active) {
    for (const track of _JL_TRACKS) {
      if (track.type !== 'custom') continue;
      const active = t >= track.startT && (track.endT === null || t < track.endT);
      if (!active && _jlTrackActive[track.id]) {
        _jlTrackActive[track.id] = false;
        if (track.onDeactivate) track.onDeactivate();
      }
    }
    return;
  }

  // ── Iterate tracks ────────────────────────────────────────────────────────
  // First pass: find which asteroid/lightning tracks are active this frame
  // (last one wins if ranges overlap — intentional for combined phases)
  let _activeAst = null;
  let _activeLt  = null;

  for (const track of _JL_TRACKS) {
    const active = t >= track.startT && (track.endT === null || t < track.endT);

    if (active) {
      // Fire onActivate once on entry
      if (!_jlTrackActive[track.id]) {
        _jlTrackActive[track.id] = true;
        if (track.onActivate) track.onActivate();
        if (track.type === 'fatcone') {
          _jlFatConeTimer = 1.0; // fire first cone quickly on track entry
        }
        if (track.type === 'lethal_rings') {
          _jlLrTimer = 1.0; // fire first ring row quickly on track entry
        }
      }

      if      (track.type === 'asteroid')  { _activeAst = track; window._jlActiveObstacleType = 'asteroid'; }
      else if (track.type === 'lightning') { _activeLt  = track;  window._jlActiveObstacleType = 'lightning'; }
      else if (track.type === 'fatcone') {
        // Fat cone spawner — delegates to _spawnFatCone() which uses FCT settings
        _jlFatConeTimer -= dt;
        if (_jlFatConeTimer <= 0) {
          const _fct = window._FCT || track;
          _jlFatConeTimer = (_fct.frequency / _jlIntensity) * (0.7 + Math.random() * 0.6);
          if (typeof window._spawnFatConeRow === 'function') window._spawnFatConeRow();
        }
      } else if (track.type === 'lethal_rings') {
        // Lethal ring row spawner — same cadence as campaign T4B_LETHAL
        _jlLrTimer -= dt;
        if (_jlLrTimer <= 0) {
          const baseInterval = track.settings && track.settings.frequency != null
            ? track.settings.frequency : 1.1;
          _jlLrTimer = (baseInterval / _jlIntensity) * (0.7 + Math.random() * 0.6);
          _jlSpawnLethalRingRow();
        }
      }
      // custom tracks: onActivate already fired above, they manage themselves
    } else {
      // Fire onDeactivate once on exit
      if (_jlTrackActive[track.id]) {
        _jlTrackActive[track.id] = false;
        if (track.onDeactivate) track.onDeactivate();
      }
    }
  }

  // ── Apply active asteroid settings each frame ─────────────────────────────
  if (_activeAst) {
    _jlApplyAsteroidTrack(_activeAst);
  } else {
    // No asteroid track active — disable
    _asteroidTuner.enabled = false;
  }

  // ── Apply active lightning settings each frame ────────────────────────────
  if (_activeLt) {
    _jlApplyLightningTrack(_activeLt);
  } else if (window._LT) {
    window._LT.enabled = false;
  }

}

// ═══════════════════════════════════════════════════════════════════════════════
//  JL SEQUENCER PANEL  (Q key)
// ═══════════════════════════════════════════════════════════════════════════════
(function setupJLSequencerPanel() {
  const panel = document.createElement('div');
  panel.id = 'jl-seq-panel';
  panel.style.cssText = 'display:none;position:fixed;top:0;right:0;width:320px;max-height:100%;background:rgba(0,0,0,0.93);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:10px;box-sizing:border-box;border:1px solid #fa0;border-top:none;border-right:none;';
  document.body.appendChild(panel);

  function mkH(text, color) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:8px 0 4px;font-size:11px;font-weight:bold;color:'+(color||'#fa0')+';border-bottom:1px solid #333;padding-bottom:2px;';
    h.textContent = text;
    return h;
  }
  function mkS(label, val, min, max, step, fn, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:100px;color:'+(color||'#fa0')+';font-size:10px;flex-shrink:0;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=val;
    inp.style.cssText = 'flex:1;height:14px;accent-color:'+(color||'#fa0')+';';
    const vEl = document.createElement('span');
    vEl.style.cssText = 'width:36px;text-align:right;font-size:10px;color:#fff;';
    vEl.textContent = (+val).toFixed(2);
    inp.oninput = () => { const v=+inp.value; vEl.textContent=v.toFixed(2); fn(v); };
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(vEl);
    return { row, inp, vEl };
  }
  function mkBtn(text, color, fn) {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'background:none;border:1px solid '+color+';color:'+color+';padding:3px 8px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px;';
    b.onclick = fn;
    return b;
  }

  function build() {
    panel.innerHTML = '<div style="font-size:13px;font-weight:bold;color:#fa0;margin-bottom:6px;">⚡ JL SEQUENCER (Q)</div>';

    // ── God mode toggle
    const godBtn = mkBtn(_godMode ? '☑ GOD MODE  (no damage)' : '☐ GOD MODE  (no damage)', _godMode ? '#0f0' : '#555', () => {
      _godMode = !_godMode;
      godBtn.textContent = _godMode ? '☑ GOD MODE  (no damage)' : '☐ GOD MODE  (no damage)';
      godBtn.style.color  = _godMode ? '#0f0' : '#555';
      godBtn.style.borderColor = _godMode ? '#0f0' : '#555';
    });
    godBtn.style.width = '100%';
    godBtn.style.marginBottom = '6px';
    panel.appendChild(godBtn);

    // ── Global scalars
    panel.appendChild(mkH('SCALARS'));
    const intSlider = mkS('intensity', _jlIntensity, 0.1, 3.0, 0.05, v => { _jlIntensity = v; }, '#fa0');
    panel.appendChild(intSlider.row);
    const sizeSlider = mkS('size', _jlSizeScalar, 0.2, 3.0, 0.05, v => { _jlSizeScalar = v; }, '#f80');
    panel.appendChild(sizeSlider.row);

    // ── Live readout
    const info = document.createElement('div');
    info.style.cssText = 'font-size:9px;color:#666;margin:4px 0 8px;line-height:1.6;white-space:pre;';
    const refreshInfo = () => {
      if (!state._jetLightningMode) { info.textContent = 'JL not active'; return; }
      const t = _jlRampTime || 0;
      const active = _JL_TRACKS
        .filter(tr => t >= tr.startT && (tr.endT === null || t < tr.endT))
        .map(tr => tr.label || tr.id).join(', ');
      info.textContent = 't=' + t.toFixed(1) + 's   intensity=' + _jlIntensity.toFixed(2) + '   size=' + _jlSizeScalar.toFixed(2) + '\nactive: ' + (active || 'none');
    };
    const _infoInterval = setInterval(refreshInfo, 250);
    refreshInfo();
    panel.appendChild(info);

    // ── Jump buttons: one per track
    panel.appendChild(mkH('JUMP TO TRACK'));
    const jumpNote = document.createElement('div');
    jumpNote.style.cssText = 'font-size:9px;color:#666;margin-bottom:4px;';
    jumpNote.textContent = 'Sets game clock to track startT. JL mode only.';
    panel.appendChild(jumpNote);

    let _lastJumpBtn = null;
    for (const track of _JL_TRACKS) {
      const color = track.type === 'asteroid'     ? '#f80'
                  : track.type === 'lightning'    ? '#6af'
                  : track.type === 'fatcone'      ? '#0f8'
                  : track.type === 'lethal_rings' ? '#f44'
                  : '#888';
      const endLabel = track.endT !== null ? track.endT + 's' : '∞';
      const btn = mkBtn(
        (track.label || track.id) + '  [' + track.startT + 's–' + endLabel + ']',
        color,
        () => {
          if (!state._jetLightningMode) return;
          // Reset all track activation flags so onActivate fires correctly
          for (const k of Object.keys(_jlTrackActive)) _jlTrackActive[k] = false;
          // Tear down any active canyon before jumping
          if (_canyonActive) _jlCanyonStop();
          _jlRampTime = track.startT;
          // If jumping to a non-asteroid track, disable asteroids so they don't overlap
          if (track.type !== 'asteroid') {
            _asteroidTuner.enabled = false;
          } else {
            _asteroidTuner.enabled = true;
            _astTimer = 0.1;
          }
          // If jumping to a non-lightning track, disable lightning
          if (track.type !== 'lightning') {
            if (window._LT) window._LT.enabled = false;
          }
          if (track.id === 'fatcone') { if (window._startFcLoop) window._startFcLoop(null); }
          else { if (window._stopFcLoop) window._stopFcLoop(); }
          // If jumping away from lethal rings, clear in-flight rings
          if (track.type !== 'lethal_rings') {
            for (const lr of _lethalRingActive) { lr.userData.active = false; lr.visible = false; lr.position.set(0,-9999,0); }
            _lethalRingActive.length = 0;
          } else {
            _jlLrTimer = 1.0; // fire first row quickly on jump
          }
          if (_lastJumpBtn) { _lastJumpBtn.style.fontWeight = 'normal'; _lastJumpBtn.style.background = 'none'; }
          btn.style.fontWeight = 'bold'; btn.style.background = color + '22';
          _lastJumpBtn = btn;
        }
      );
      btn.style.width = '100%'; btn.style.textAlign = 'left';
      // Highlight currently active track
      const t = _jlRampTime || 0;
      if (t >= track.startT && (track.endT === null || t < track.endT)) {
        btn.style.fontWeight = 'bold'; btn.style.background = color + '22';
        _lastJumpBtn = btn;
      }
      panel.appendChild(btn);
    }
  }

  let visible = false;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'q' || e.key === 'Q') {
      visible = !visible;
      if (visible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// Hook ramp into composer chain (safe to call before lightning IIFE since it
// just calls free-standing functions that exist by then)
(function _hookJLRamp() {
  const _jlOrigRender = composer.render.bind(composer);
  let   _jlLastTime   = performance.now();
  composer.render = function(...args) {
    const now = performance.now();
    const dt  = Math.min((now - _jlLastTime) * 0.001, 0.05);
    _jlLastTime = now;
    _tickJetLightningRamp(dt);
    _jlOrigRender(...args);
  };
})();

// Reset JL state when game ends / restarts
const _origStartGame_JL = startGame;
startGame = function() {
  if (state._jetLightningMode) {
    // JL physics applied in startJetLightning re-apply block — don't touch
  } else if (state._tutorialActive) {
    // Tutorial uses JL_v1 physics as baseline
    const _tp = _PHYSICS_PRESETS['JL_v1'];
    _accelBase     = _tp.accelBase;
    _accelSnap     = _tp.accelSnap;
    _maxVelBase    = _tp.maxVelBase;
    _maxVelSnap    = _tp.maxVelSnap;
    _bankMax       = _tp.bankMax;
    _bankSmoothing = _tp.bankSmoothing;
    _decelBasePct  = _tp.decelBasePct;
    _decelFullPct  = _tp.decelFullPct;
  } else {
    // Campaign defaults
    _accelBase     = 22;
    _accelSnap     = 52;
    _maxVelBase    = 9;
    _maxVelSnap    = 13;
    _bankMax       = 0.03;
  }
  _origStartGame_JL.apply(this, arguments);
  // After startGame resets speed to BASE_SPEED, bump tutorial to L4
  if (state._tutorialActive) {
    state.speed = BASE_SPEED * LEVELS[3].speedMult; // L4 = 1.5x
    state.currentLevelIdx = 3;
    currentLevelDef = LEVELS[3];
    targetLevelDef  = LEVELS[3];
  }
};

// Expose for title button
window.startJetLightning = startJetLightning;

// Debug probe for stress testing (read/write internal JL state)
window._jlDebug = {
  get rampTime()          { return _jlRampTime; },
  set rampTime(v)         { _jlRampTime = v; },
  get jlMode()            { return state._jetLightningMode; },
  get phase()             { return state.phase; },
  get score()             { return state.score; },
  get levelIdx()          { return state.currentLevelIdx; },
  get speed()             { return state.speed; },
  get shipX()             { return state.shipX; },
  set shipX(v)            { state.shipX = v; },
  get l4CorridorActive()  { return state.l4CorridorActive; },
  get l4CorridorDone()    { return state.l4CorridorDone; },
  get noSpawnMode()       { return _noSpawnMode; },
  get astEnabled()        { return _asteroidTuner.enabled; },
  get astPattern()        { return _asteroidTuner.pattern; },
  get astFreq()           { return _asteroidTuner.frequency; },
  get astLeadFactor()     { return _asteroidTuner.leadFactor; },
  get astStaggerDual()    { return _asteroidTuner.staggerDual; },
  get activeAsteroids()   { return _asteroidActive.length; },
  get activeObstacles()   { return activeObstacles.length; },
  tick(dt)                { _tickJetLightningRamp(dt); },
  snapshot() {
    return {
      rampTime:        Math.round(_jlRampTime),
      jlMode:          state._jetLightningMode,
      phase:           state.phase,
      score:           state.score,
      levelIdx:        state.currentLevelIdx,
      speed:           Math.round(state.speed),
      l4CorridorActive: state.l4CorridorActive,
      l4CorridorDone:  state.l4CorridorDone,
      noSpawnMode:     _noSpawnMode,
      astEnabled:      _asteroidTuner.enabled,
      astPattern:      _asteroidTuner.pattern,
      astFreq:         +_asteroidTuner.frequency.toFixed(2),
      astLeadFactor:   _asteroidTuner.leadFactor,
      astStaggerDual:  _asteroidTuner.staggerDual,
      ltEnabled:       window._LT.enabled,
      ltFreq:          +window._LT.frequency.toFixed(2),
      iceEnabled:      window._ICE.enabled,
      activeAsteroids: _asteroidActive.length,
      activeObstacles: activeObstacles.length,
    };
  }
};

//  LIGHTNING STRIKE SYSTEM  v3
//  – Spawns at SPAWN_Z like a cone, scrolls toward ship at game speed
//  – Warning disc travels with it (always over the target X)
//  – When it reaches ship Z it slams: bolt flash, shockwave, kill check
//  – TubeGeometry bolt (real width, not LineBasicMaterial)
//  – Full pattern engine: random / sweep / stagger / salvo / pinch
//  – Tuner on L key
// ═══════════════════════════════════════════════════════════════════════════════
(function setupLightningSystem() {

  const _LT = {
    enabled:      false,
    frequency:    0.3,   // locked from session log (rchouake approved)
    leadFactor:   0.6,
    skyHeight:    55,
    warningTime:  0.3,    // seconds disc shows before bolt slams — keep short so bolt strikes ahead of ship
    boltDuration: 0.5,    // seconds of initial flash
    lingerDuration: 4.0,  // seconds bolt stays planted in world (ship flies past it)
    coreRadius:   0.12,
    glowRadius:   0.25,
    segments:     10,
    jaggedness:   1.9,
    hitboxScale:  1.0,    // multiplier on glowRadius — hitbox always matches bolt visual
    warnRadius:   3.5,
    shakeAmt:     0.18,
    shakeDuration:0.35,
    glowColor:    0x88ccff,
    coreColor:    0xffffff,
    flashColor:   0x99ddff,
    warnColor:    0x44aaff,
    pattern:      'random',
    laneMin:      -8,
    laneMax:       8,
    sweepSpeed:   0.4,
    staggerGap:   0.6,
    salvoCount:   3,
    pinchSpread:  1.0,
    count:        1,
    spawnZ:      -83,   // how far out bolts spawn — closer = less reaction time
  };

  let _ltTimer    = 2.0;
  let _ltSweepX   = 0.5;
  let _ltSweepDir = 1;
  const _ltStaggerQ = [];
  const _ltActive   = [];   // active bolt instances

  // ── Pattern loop ──────────────────────────────────────────────────────────
  let _ltLoopActive = false, _ltLoopTimeout = null, _ltActiveBtn = null;
  function _startLtLoop(btn, color, tick) {
    _stopLtLoop();
    _ltLoopActive = true; _ltActiveBtn = btn;
    if (btn) { btn.style.background = color+'33'; btn.style.fontWeight='bold'; }
    function loop() {
      if (!_ltLoopActive) return;
      tick();
      _ltLoopTimeout = setTimeout(loop, _LT.frequency * 1000);
    }
    loop();
  }
  function _stopLtLoop() {
    _ltLoopActive = false;
    if (_ltLoopTimeout) { clearTimeout(_ltLoopTimeout); _ltLoopTimeout = null; }
    if (_ltActiveBtn) { _ltActiveBtn.style.background='none'; _ltActiveBtn.style.fontWeight='normal'; _ltActiveBtn=null; }
  }
  function _clearAllLightning() {
    [..._ltActive].forEach(_ltKill);
    _ltActive.length = 0;
  }

  // ── Target X from pattern ─────────────────────────────────────────────────
  function _ltNextTargetX() {
    const range = _LT.laneMax - _LT.laneMin;
    const sx = (state && state.shipX) || 0;
    switch (_LT.pattern) {
      case 'sweep': {
        const x = sx + (_ltSweepX - 0.5) * range;
        _ltSweepX += _ltSweepDir * _LT.sweepSpeed * _LT.frequency / range * 0.12;
        if (_ltSweepX >= 1 || _ltSweepX <= 0) { _ltSweepDir *= -1; _ltSweepX = Math.max(0,Math.min(1,_ltSweepX)); }
        return x;
      }
      case 'stagger': {
        // Ship-tracking: each shot reads shipX live at fire time (see auto-spawner)
        return sx + (Math.random()-0.5) * Math.min(3.0, range * 0.3);
      }
      case 'salvo': return sx + (Math.random()-0.5)*range*0.5;
      default:      return sx + (Math.random()-0.5)*3.0;
    }
  }

  // ── Build jagged TubeGeometry bolt ────────────────────────────────────────
  // Bolt geometry built at Z=0 local space — Group handles world Z position
  function _ltBoltGeo(topY, landX, segs, jagg, radius) {
    let pts = [{ x: landX, y: topY }, { x: landX, y: 0.5 }];
    const iters = Math.max(1, Math.round(Math.log2(Math.max(4, segs))));
    for (let d = 0; d < iters; d++) {
      const next = [];
      for (let i = 0; i < pts.length-1; i++) {
        next.push(pts[i]);
        next.push({ x:(pts[i].x+pts[i+1].x)*0.5+(Math.random()-0.5)*jagg*(1-d*0.2), y:(pts[i].y+pts[i+1].y)*0.5 });
      }
      next.push(pts[pts.length-1]);
      pts = next;
    }
    const v3pts = pts.map(p => new THREE.Vector3(p.x, p.y, 0)); // Z=0 local
    const curve = new THREE.CatmullRomCurve3(v3pts);
    return new THREE.TubeGeometry(curve, Math.max(4, pts.length), radius, 5, false);
  }

  // ── Spawn one lightning bolt ──────────────────────────────────────────────
  // Everything spawns at a Z offset ahead of the ship.
  // Warning disc pulses for warningTime seconds, then bolt slams and lingers.
  // After the strike the bolt is a planted world-space column — ship flies past it.
  function _spawnLightning(targetX, landZOverride, skipWarn, radiiOverride) {
    if (window._perfDiag) window._perfDiag.tag('lightning_spawn');
    const shipZ  = _shipZ();
    // landZOverride lets callers (e.g. lateral) spawn at a custom Z without touching _LT.spawnZ
    const landZ  = (landZOverride !== undefined) ? landZOverride : (shipZ + _LT.spawnZ);
    const velX   = (state && state.shipVelX) || 0;
    const travelTime = Math.abs(_LT.spawnZ) / Math.max(1, state.speed || 73);
    // When a caller passes landZOverride (lateral), they've already computed the
    // final world X. Re-applying _LT.leadFactor here would double-dip and pull
    // bolts back toward ship's predicted path — turning lateral bolts medial.
    const landX  = (landZOverride !== undefined)
      ? targetX
      : targetX + velX * travelTime * _LT.leadFactor;
    // radiiOverride: { coreRadius, glowRadius } to override _LT defaults for this instance
    const _core  = (radiiOverride && radiiOverride.coreRadius != null) ? radiiOverride.coreRadius : _LT.coreRadius;
    const _glow  = (radiiOverride && radiiOverride.glowRadius != null) ? radiiOverride.glowRadius : _LT.glowRadius;

    // Warning disc — visible immediately at landZ ahead of ship
    const warnGeo  = new THREE.CircleGeometry(_LT.warnRadius, 32);
    const warnMat  = new THREE.MeshBasicMaterial({ color:_LT.warnColor, transparent:true, opacity:0.6, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
    const warnMesh = new THREE.Mesh(warnGeo, warnMat);
    warnMesh.rotation.x = -Math.PI/2;
    warnMesh.position.set(landX, 0.08, landZ);
    scene.add(warnMesh);

    // Ground flash
    const flashMat = new THREE.SpriteMaterial({ color:_LT.flashColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending });
    const flash    = new THREE.Sprite(flashMat);
    flash.scale.set(10, 10, 1);
    flash.position.set(landX, 1.5, landZ);
    scene.add(flash);

    // Shockwave ring
    const ringGeo  = new THREE.RingGeometry(0.1, 0.5, 48);
    const ringMat  = new THREE.MeshBasicMaterial({ color:_LT.glowColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
    const ring     = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI/2;
    ring.position.set(landX, 0.1, landZ);
    scene.add(ring);

    // Bolt group — Z=0 local geometry, group positioned at landZ and scrolled like a cone
    const boltGroup = new THREE.Group();
    boltGroup.position.set(0, 0, landZ);
    const coreMat  = new THREE.MeshBasicMaterial({ color:_LT.coreColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending });
    const glowMat  = new THREE.MeshBasicMaterial({ color:_LT.glowColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
    const coreGeo  = _ltBoltGeo(_LT.skyHeight, landX, _LT.segments, _LT.jaggedness,       _core);
    const glowGeo  = _ltBoltGeo(_LT.skyHeight, landX, _LT.segments, _LT.jaggedness * 1.4, _glow);
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    boltGroup.add(coreMesh); boltGroup.add(glowMesh);
    scene.add(boltGroup);

    const inst = {
      landX, landZ, strikePosZ: landZ,
      phase: 'warn', elapsed: 0, strikeElapsed: 0, lingerElapsed: 0,
      warnMesh, warnGeo, warnMat,
      flash, flashMat,
      ring, ringGeo, ringMat,
      boltGroup, coreMesh, coreGeo, coreMat,
      glowMesh, glowGeo, glowMat,
      ringScale: 0.3, hitChecked: false,
      // Per-instance radii — _ltRejag reads these instead of _LT.* so overrides persist
      _coreRadius: _core,
      _glowRadius: _glow,
    };

    // skipWarn: bolt pops in pre-struck at landZ (no warn disc, no flash, no ring).
    // Ship sees a planted column drifting in from distance — the bolt IS the warning.
    // Used for lateral bolts where a warn disc would reveal the ambush too early.
    if (skipWarn) {
      inst.phase          = 'strike';
      inst.strikeElapsed  = 0;
      warnMat.opacity     = 0;
      flashMat.opacity    = 0;
      ringMat.opacity     = 0;
      coreMat.opacity     = 1.0;
      glowMat.opacity     = 0.5;
      _ltRejag(inst);
    }

    _ltActive.push(inst);
  }

  function _ltKill(inst) {
    scene.remove(inst.warnMesh); inst.warnGeo.dispose(); inst.warnMat.dispose();
    scene.remove(inst.flash);    inst.flashMat.dispose();
    scene.remove(inst.ring);     inst.ringGeo.dispose(); inst.ringMat.dispose();
    scene.remove(inst.boltGroup); inst.coreGeo.dispose(); inst.coreMat.dispose(); inst.glowGeo.dispose(); inst.glowMat.dispose();
  }

  function _ltRejag(inst) {
    inst.coreGeo.dispose(); inst.glowGeo.dispose();
    // Use per-instance radii (set at spawn) so lateral fat bolts stay fat through rejags
    const cr = (inst._coreRadius != null) ? inst._coreRadius : _LT.coreRadius;
    const gr = (inst._glowRadius != null) ? inst._glowRadius : _LT.glowRadius;
    const ng = _ltBoltGeo(_LT.skyHeight, inst.landX, _LT.segments, _LT.jaggedness,     cr);
    const gg = _ltBoltGeo(_LT.skyHeight, inst.landX, _LT.segments, _LT.jaggedness*1.4, gr);
    inst.coreMesh.geometry = ng; inst.coreGeo = ng;
    inst.glowMesh.geometry = gg; inst.glowGeo = gg;
  }

  let _ltShakeTime = 0;
  let _ltShakeOffX = 0, _ltShakeOffY = 0;
  const _shipZ = () => shipGroup ? shipGroup.position.z : 3.9;

  // ── Lightning lateral punish ──────────────────────────────────────────────
  // Mirrors asteroid lateral, but predicts where ship will be when bolt strikes
  // so sliding doesn't just skate past a static column. Only fires when there
  // are no walls (canyon inactive) — walls already hold the ship in place.
  const _LT_LATERAL = {
    enabled: true,
    timer:   0,
    freq:    0.8,   // seconds between fires (with 0.7–1.3x jitter)
    minOff:  8,     // minimum lateral offset — bolts ALWAYS visibly to the side, never medial
    maxOff:  25,    // maximum lateral offset — covers realistic slide distance
    spawnZ:  -150,  // lateral-specific spawn Z — ~2.78s travel at 54 u/s
    leadFactor: 1.0, // FULL prediction — offset from WHERE SHIP WILL BE at landZ, not current X.
                    // At velX=26 × 2.78s travel = 72u drift; without lead bolt ends up 72u behind ship = medial.
                    // With lead=1.0, bolt spawns at predictedShipX±offset so it's lateral AT IMPACT.
    slideBias: 0.7, // probability bolt spawns in direction of current slide (1=always, 0.5=random)
                    // sliding left → 70% of bolts spawn left (ship heading into them)
    coreRadius: 0.4, // 3.3x main (_LT.coreRadius=0.12) — fatter visual
    glowRadius: 0.8, // 3.2x main (_LT.glowRadius=0.25) — hitbox 0.8u wide
  };
  function _tickLightningLateral(dt) {
    // ALWAYS-ON DIAG: throttled once/3s so we can see why LT lateral isn't firing.
    // Mirrors [LAT_DIAG] in _tickAsteroidSpawner. Logs every gate state.
    if (state && state._jetLightningMode) {
      window._ltLatTickCounter = (window._ltLatTickCounter || 0) + 1;
      if (window._ltLatTickCounter >= 180) {
        window._ltLatTickCounter = 0;
        console.log('[LT_LAT_DIAG] en='+(_LT_LATERAL.enabled?1:0)
          +' jl='+(state._jetLightningMode?1:0)
          +' rT='+(typeof _jlRampTime!=='undefined'?_jlRampTime.toFixed(1):'?')
          +' obs='+(window._jlActiveObstacleType||'-')
          +' canyon='+((typeof _canyonActive!=='undefined'&&(_canyonActive||_canyonExiting))?1:0)
          +' timer='+_LT_LATERAL.timer.toFixed(2)
          +' gateOK='+((_LT_LATERAL.enabled
              && typeof _jlRampTime!=='undefined' && _jlRampTime>=4
              && window._jlActiveObstacleType==='lightning'
              && !(typeof _canyonActive!=='undefined'&&(_canyonActive||_canyonExiting)))?1:0));
      }
    }

    if (!_LT_LATERAL.enabled) return;
    if (!state || !state._jetLightningMode) return;
    if (typeof _jlRampTime === 'undefined' || _jlRampTime < 4) return;
    if (window._jlActiveObstacleType !== 'lightning') return;
    // Walls present — they already hold the ship; no lateral needed.
    if (typeof _canyonActive !== 'undefined' && (_canyonActive || _canyonExiting)) return;

    _LT_LATERAL.timer -= dt;
    if (_LT_LATERAL.timer > 0) return;
    _LT_LATERAL.timer = _LT_LATERAL.freq * (0.7 + Math.random() * 0.6);

    const sx     = (state && state.shipX)    || 0;
    const velX   = (state && state.shipVelX) || 0;
    // Side bias: if ship is sliding, bolts favor the slide direction so ship
    // heads INTO them. Not-sliding → pure 50/50. slideBias=0.7 means 70% of the
    // time the bolt spawns in slide direction, 30% opposite.
    let side;
    if (Math.abs(velX) > 0.5) {
      const slideSign = velX > 0 ? 1 : -1;
      side = (Math.random() < _LT_LATERAL.slideBias) ? slideSign : -slideSign;
    } else {
      side = Math.random() < 0.5 ? 1 : -1;
    }
    const offset = _LT_LATERAL.minOff + Math.random() * (_LT_LATERAL.maxOff - _LT_LATERAL.minOff);
    // Lateral uses ITS OWN spawnZ (farther than main) so warn disc appears well ahead —
    // ship's X at spawn time visually disconnects from bolt's landing X.
    // Half-lead prediction (leadFactor=0.5) still punishes camping without aimbot overshoot.
    const travelTime = Math.abs(_LT_LATERAL.spawnZ) / Math.max(1, (state && state.speed) || 73);
    const predictedX = sx + velX * travelTime * _LT_LATERAL.leadFactor;
    const spawnX    = predictedX + side * offset;
    const landZ     = (_shipZ ? _shipZ() : 3.9) + _LT_LATERAL.spawnZ;
    console.log('[LT_LAT_FIRE] sx='+sx.toFixed(1)+' velX='+velX.toFixed(2)
      +' predX='+predictedX.toFixed(1)+' side='+side+' off='+offset.toFixed(1)
      +' spawnX='+spawnX.toFixed(1)+' landZ='+landZ.toFixed(1));
    if (window._perfDiag) window._perfDiag.tag('lateral_lt');
    // skipWarn=true: bolt pops in pre-struck — no telegraph disc, bolt itself is the warning.
    // Fat radii: lateral bolts are 3x chunkier than main pattern bolts.
    _spawnLightning(spawnX, landZ, true, {
      coreRadius: _LT_LATERAL.coreRadius,
      glowRadius: _LT_LATERAL.glowRadius,
    });
  }

  function _updateLightning(dt) {
    // Lateral punish tick — runs before main spawn loop
    _tickLightningLateral(dt);

    // Auto-spawn
    if (_LT.enabled && !_noSpawnMode && !_ltLoopActive) {
      _ltTimer -= dt;
      if (_ltTimer <= 0) {
        _ltTimer = _LT.frequency * (0.8 + Math.random()*0.4) * Math.max(0.15, 1.0 - _funFloorIntensity * 0.85);
        // Always one bolt at a time, aimed at ship's current X — no salvo, no batching
        if (_LT.pattern === 'stagger') {
          _spawnLightning(state.shipX || 0);
        } else {
          _spawnLightning(_ltNextTargetX());
        }
      }
    }

    // Camera shake: undo last frame's offset, apply new one — never drifts
    camera.position.x -= _ltShakeOffX;
    camera.position.y -= _ltShakeOffY;
    if (_ltShakeTime > 0) {
      _ltShakeTime -= dt;
      const s = _LT.shakeAmt * (_ltShakeTime / Math.max(0.01, _LT.shakeDuration));
      _ltShakeOffX = (Math.random()-0.5)*s;
      _ltShakeOffY = (Math.random()-0.5)*s*0.4;
      camera.position.x += _ltShakeOffX;
      camera.position.y += _ltShakeOffY;
    } else {
      _ltShakeOffX = 0; _ltShakeOffY = 0;
    }

    const spd = state ? (state.invincibleSpeedActive ? state.speed * 1.8 : state.speed) : 73;

    for (let i = _ltActive.length-1; i >= 0; i--) {
      const inst = _ltActive[i];
      inst.elapsed += dt;

      // Scroll ALL phases — bolt moves toward ship like a cone, always
      const scrollDt = spd * dt;
      inst.warnMesh.position.z  += scrollDt;
      inst.flash.position.z     += scrollDt;
      inst.ring.position.z      += scrollDt;
      inst.boltGroup.position.z += scrollDt;
      inst.strikePosZ           += scrollDt;

      // Despawn once it scrolls past ship
      if (inst.boltGroup.position.z > _shipZ() + 20) {
        _ltKill(inst); _ltActive.splice(i, 1); continue;
      }

      if (inst.phase === 'warn') {
        // Live-track ship X during warn phase (stagger pattern only) so the
        // strike snaps to wherever the ship actually is at the moment of impact.
        if (_LT.pattern === 'stagger') {
          const liveX = (state && state.shipX) || 0;
          if (liveX !== inst.landX) {
            inst.landX = liveX;
            inst.warnMesh.position.x = liveX;
            inst.flash.position.x    = liveX;
            inst.ring.position.x     = liveX;
            // Bolt geo stays hidden (opacity 0) during warn — rebuild at strike time
          }
        }

        // Warning disc pulses at the target position
        inst.warnMat.opacity = 0.4 + 0.35 * Math.abs(Math.sin(inst.elapsed * 8));
        const sc = 0.85 + 0.2 * Math.abs(Math.sin(inst.elapsed * 5));
        inst.warnMesh.scale.set(sc, sc, 1);

        // Strike after warningTime — bolt is still ahead of ship, plants there
        if (inst.elapsed >= _LT.warningTime) {
          inst.phase = 'strike';
          inst.strikeElapsed = 0;
          inst.warnMat.opacity = 0;
          inst.coreMat.opacity = 1.0;
          inst.glowMat.opacity = 0.5;
          inst.flashMat.opacity = 1.0;
          inst.ringMat.opacity  = 0.9;
          _ltShakeTime = _LT.shakeDuration;
          _playLightningStrike();
          // Rebuild bolt geometry at the final locked landX (ship pos at strike)
          _ltRejag(inst);
        }

      } else if (inst.phase === 'strike') {
        inst.strikeElapsed += dt;
        const t = inst.strikeElapsed / Math.max(0.01, _LT.boltDuration);

        if (Math.floor(inst.strikeElapsed * 22) % 3 === 0) _ltRejag(inst);

        // Flash fades fast, bolt stays bright
        inst.coreMat.opacity  = Math.max(0.8, 1.0 - t*0.1);
        inst.glowMat.opacity  = Math.max(0.4, 0.5 - t*0.05);
        inst.flashMat.opacity = Math.max(0, 1.0 - t*4.0);
        inst.ringScale += dt * 22;
        inst.ring.scale.set(inst.ringScale, inst.ringScale, 1);
        inst.ringMat.opacity  = Math.max(0, 0.9 - t*2.0);

        // Hit check — bolt is a vertical column, only X matters at strike moment
        if (!inst.hitChecked && state && state.phase === 'playing') {
          inst.hitChecked = true;
          const dx = (state.shipX||0) - inst.landX;
          const dz = Math.abs(_shipZ() - inst.strikePosZ);
          if (Math.abs(dx) < (_LT.glowRadius * _LT.hitboxScale) && dz < 6) {
                    const _ltHitSfx = document.getElementById('shield-hit-sfx');
            if (_ltHitSfx) { _ltHitSfx.currentTime = 0; _ltHitSfx.play().catch(()=>{}); }
            if (state._tutorialActive || _godMode) addCrashFlash(0x4488ff);
            else killPlayer();
          }
        }

        if (inst.strikeElapsed >= _LT.boltDuration) {
          // Transition to linger — bolt stays planted, crackles as ship flies past
          inst.phase = 'linger';
          inst.lingerElapsed = 0;
          inst.flashMat.opacity = 0;
        }

      } else if (inst.phase === 'linger') {
        inst.lingerElapsed += dt;
        const t = inst.lingerElapsed / Math.max(0.01, _LT.lingerDuration);

        // Crackle: random flicker
        if (Math.floor(inst.lingerElapsed * 18) % 2 === 0) _ltRejag(inst);
        // Stay bright for most of linger, only fade in last 25%
        const fadeT = Math.max(0, (t - 0.75) / 0.25);
        const flicker = 0.7 + 0.3 * Math.abs(Math.sin(inst.lingerElapsed * 14 + Math.random()));
        inst.coreMat.opacity = Math.max(0, (1.0 - fadeT) * flicker);
        inst.glowMat.opacity = Math.max(0, (0.5  - fadeT * 0.5) * flicker);

        // During linger: bolt is planted in world, ship is flying past it.
        // Kill zone = lateral X only — hitbox width = glowRadius * hitboxScale (tracks bolt visual)
        // and the bolt's world Z is still near the ship (within a ship-length)
        if (state && state.phase === 'playing') {
          const dx = Math.abs((state.shipX||0) - inst.landX);
          const dz = Math.abs(_shipZ() - inst.strikePosZ);
          const near = dx < (_LT.glowRadius * _LT.hitboxScale) && dz < 4;
          if (near && !inst.hitChecked) {
            inst.hitChecked = true;
                    const _ltHitSfx = document.getElementById('shield-hit-sfx');
            if (_ltHitSfx) { _ltHitSfx.currentTime = 0; _ltHitSfx.play().catch(()=>{}); }
            if (state._tutorialActive || _godMode) addCrashFlash(0x4488ff);
            else killPlayer();
          }
          if (!near) inst.hitChecked = false;
        }

        if (inst.lingerElapsed >= _LT.lingerDuration) {
          _ltKill(inst); _ltActive.splice(i,1);
        }
      }
    }
  }

  // ── Hook into composer render ─────────────────────────────────────────────
  const _ltOrigRender = composer.render.bind(composer);
  let _ltLastTime = performance.now();
  composer.render = function(...args) {
    const now = performance.now();
    const dt  = Math.min((now - _ltLastTime)*0.001, 0.05);
    _ltLastTime = now;
    if (state.phase === 'playing' && !state.introActive &&
        (state._tutorialActive || _chaosMode || state._jetLightningMode)) {
      _updateLightning(dt);
    }
    _ltOrigRender(...args);
  };

  // ── Tuner panel (L key) ───────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'lightning-tuner';
  panel.style.cssText = 'display:none;position:fixed;top:0;left:270px;width:260px;height:100%;background:rgba(0,0,0,0.93);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;border-right:1px solid #6af;';
  document.body.appendChild(panel);

  function mkS(label,val,min,max,step,fn){ const row=document.createElement('div'); row.style.cssText='margin:3px 0;display:flex;align-items:center;gap:4px;'; const lbl=document.createElement('span'); lbl.style.cssText='width:120px;color:#6af;font-size:10px;flex-shrink:0;'; lbl.textContent=label; const inp=document.createElement('input'); inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=val; inp.style.cssText='flex:1;height:14px;accent-color:#6af;'; const vEl=document.createElement('span'); vEl.style.cssText='width:38px;text-align:right;font-size:10px;color:#fff;'; vEl.textContent=(+val).toFixed(2); inp.addEventListener('input',()=>{ const v=parseFloat(inp.value); vEl.textContent=v.toFixed(2); fn(v); if(window._sessionLogSlider) _sessionLogSlider('lt_'+label,v); }); row.appendChild(lbl); row.appendChild(inp); row.appendChild(vEl); return row; }
  function mkT(label,getter,setter){ const row=document.createElement('div'); row.style.cssText='margin:4px 0;display:flex;align-items:center;gap:8px;'; const lbl=document.createElement('span'); lbl.style.cssText='color:#6af;font-size:10px;flex:1;'; lbl.textContent=label; const btn=document.createElement('button'); btn.style.cssText='padding:2px 10px;font-size:10px;cursor:pointer;background:#222;border:1px solid #6af;color:#fff;border-radius:3px;'; const ref=()=>{ btn.textContent=getter()?'ON':'OFF'; btn.style.background=getter()?'#224':'#222'; }; ref(); btn.addEventListener('click',()=>{ setter(!getter()); ref(); }); row.appendChild(lbl); row.appendChild(btn); return row; }
  function mkSel(label,opts,getter,setter){ const row=document.createElement('div'); row.style.cssText='margin:4px 0;display:flex;align-items:center;gap:6px;'; const lbl=document.createElement('span'); lbl.style.cssText='width:80px;color:#6af;font-size:10px;flex-shrink:0;'; lbl.textContent=label; const sel=document.createElement('select'); sel.style.cssText='flex:1;background:#111;color:#fff;border:1px solid #6af;font-size:10px;padding:1px;'; opts.forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; if(o===getter()) op.selected=true; sel.appendChild(op); }); sel.addEventListener('change',()=>setter(sel.value)); row.appendChild(lbl); row.appendChild(sel); return row; }
  function mkH(t){ const h=document.createElement('div'); h.style.cssText='color:#6af;font-weight:bold;font-size:12px;margin:10px 0 3px;border-bottom:1px solid #6af;padding-bottom:2px;'; h.textContent=t; return h; }
  function mkB(label,color,onClick){ const b=document.createElement('button'); b.textContent=label; b.style.cssText=`background:none;border:1px solid ${color};color:${color};padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px 0;width:100%;text-align:left;`; b.addEventListener('click',onClick); return b; }

  function build(){
    panel.innerHTML='';
    panel.appendChild(mkH('⚡ LIGHTNING TUNER'));
    panel.appendChild(mkT('ENABLED',()=>_LT.enabled,v=>{ _LT.enabled=v; if(!v){_stopLtLoop();_clearAllLightning();} }));
    panel.appendChild(mkH('SPAWN'));
    panel.appendChild(mkS('frequency (s)',  _LT.frequency,    0.05,15, 0.05, v=>_LT.frequency=v));
    panel.appendChild(mkS('count',          _LT.count,        1,  4,   1,   v=>_LT.count=Math.round(v)));
    panel.appendChild(mkS('lead factor',    _LT.leadFactor,   0,  1.5, 0.05,v=>_LT.leadFactor=v));
    panel.appendChild(mkS('sky height',     _LT.skyHeight,    10, 120, 1,   v=>_LT.skyHeight=v));
    panel.appendChild(mkS('forward dist', Math.abs(_LT.spawnZ), 5, 160, 1, v=>_LT.spawnZ=-v));
    panel.appendChild(mkH('PATTERN'));
    panel.appendChild(mkSel('pattern',['random','sweep','stagger','salvo','pinch'],()=>_LT.pattern,v=>{ _LT.pattern=v; _ltStaggerQ.length=0; _ltSweepX=0.5; }));
    panel.appendChild(mkS('lane min X',    _LT.laneMin,    -20,0,   0.5, v=>_LT.laneMin=v));
    panel.appendChild(mkS('lane max X',    _LT.laneMax,    0,  20,  0.5, v=>_LT.laneMax=v));
    panel.appendChild(mkS('sweep speed',   _LT.sweepSpeed, 0.05,2,  0.01,v=>_LT.sweepSpeed=v));
    panel.appendChild(mkS('stagger gap(s)',_LT.staggerGap, 0.1,3,   0.05,v=>_LT.staggerGap=v));
    panel.appendChild(mkS('salvo count',   _LT.salvoCount, 1,  8,   1,   v=>_LT.salvoCount=Math.round(v)));
    panel.appendChild(mkS('pinch spread',  _LT.pinchSpread,0.1,3,   0.05,v=>_LT.pinchSpread=v));
    panel.appendChild(mkH('TIMING'));
    panel.appendChild(mkS('bolt duration(s)', _LT.boltDuration,  0.1, 2,   0.05, v=>_LT.boltDuration=v));
    panel.appendChild(mkS('linger duration(s)',_LT.lingerDuration, 0.2, 6.0, 0.1,  v=>_LT.lingerDuration=v));
    panel.appendChild(mkH('VISUALS'));
    panel.appendChild(mkS('core radius',  _LT.coreRadius,  0.01,3,  0.01,v=>_LT.coreRadius=v));
    panel.appendChild(mkS('glow radius',  _LT.glowRadius,  0.05,8,  0.05,v=>_LT.glowRadius=v));
    panel.appendChild(mkS('segments',     _LT.segments,    4,  64,  1,   v=>_LT.segments=Math.round(v)));
    panel.appendChild(mkS('jaggedness',   _LT.jaggedness,  0.1,6,   0.05,v=>_LT.jaggedness=v));
    panel.appendChild(mkS('warn radius',  _LT.warnRadius,  0.5,12,  0.1, v=>_LT.warnRadius=v));
    panel.appendChild(mkH('IMPACT'));
    panel.appendChild(mkS('hitbox scale',  _LT.hitboxScale,  0.1, 3.0, 0.05, v=>_LT.hitboxScale=v));
    panel.appendChild(mkS('shake amount',   _LT.shakeAmt,      0,  1,  0.01,v=>_LT.shakeAmt=v));
    panel.appendChild(mkS('shake duration', _LT.shakeDuration, 0,  1,  0.02,v=>_LT.shakeDuration=v));
    panel.appendChild(mkH('PATTERN LOOPS'));
    const pats=[
      {label:'↯ RANDOM (loop)', color:'#6af', tick:()=>{ for(let c=0;c<Math.max(1,_LT.count);c++) setTimeout(()=>{ if(state.phase==='playing') _spawnLightning(_ltNextTargetX()); },c*120); }},
      {label:'►◄ SWEEP (loop)', color:'#0df', tick:()=>{ const range=_LT.laneMax-_LT.laneMin,swOff=(_ltSweepX-0.5)*range; _ltSweepX+=_ltSweepDir*_LT.sweepSpeed*0.35; if(_ltSweepX>=1||_ltSweepX<=0){_ltSweepDir*=-1;_ltSweepX=Math.max(0,Math.min(1,_ltSweepX));} const n=Math.max(2,_LT.salvoCount); for(let i=0;i<n;i++) setTimeout(()=>{ if(state.phase==='playing') _spawnLightning(state.shipX+swOff+(i/(n-1)-0.5)*range*0.5); },i*250); }},
      {label:'▼ ▼▼ STAGGER (loop)', color:'#ff0', tick:()=>{ if(state.phase==='playing') _spawnLightning(state.shipX); }},
      {label:'▼▼▼ SALVO (loop)', color:'#f80', tick:()=>{ const sx=state.shipX,n=Math.max(1,_LT.salvoCount),half=(_LT.laneMax-_LT.laneMin)*0.45; for(let si=0;si<n;si++) _spawnLightning(sx+(n===1?0:(si/(n-1)-0.5))*half*2); }},
      {label:'▷◁ PINCH (loop)', color:'#f0f', tick:()=>{ const sx=state.shipX,pairs=5,fh=(_LT.laneMax-_LT.laneMin)*0.5*_LT.pinchSpread; for(let pi=0;pi<pairs;pi++){ const hs=Math.max(0.3,fh*(1-pi/(pairs-1))),d=pi*300; (function(s,dl){const fn=()=>{ if(state.phase!=='playing')return; _spawnLightning(sx-s); _spawnLightning(sx+s); }; dl===0?fn():setTimeout(fn,dl);})(hs,d); } setTimeout(()=>{ if(state.phase==='playing') _spawnLightning(sx); },pairs*300); }},
    ];
    pats.forEach(({label,color,tick})=>{ const b=mkB(label,color,()=>_startLtLoop(b,color,tick)); panel.appendChild(b); });
    panel.appendChild(mkB('⏹ STOP LOOP','#888',_stopLtLoop));
    panel.appendChild(mkB('✕ CLEAR ALL','#f44',()=>{ _stopLtLoop(); _clearAllLightning(); }));
    const oneBtn=document.createElement('button'); oneBtn.textContent='⚡ STRIKE NOW';
    oneBtn.style.cssText='width:100%;padding:6px;margin:6px 0 2px;background:#224;border:1px solid #6af;color:#6af;font-family:monospace;font-size:12px;cursor:pointer;border-radius:3px;';
    oneBtn.addEventListener('click',()=>_spawnLightning((state&&state.shipX)||0));
    panel.appendChild(oneBtn);
    const cEl=document.createElement('div'); cEl.style.cssText='margin-top:6px;color:#888;font-size:10px;';
    const rc=()=>{ cEl.textContent='active: '+_ltActive.length; }; rc(); setInterval(rc,500); panel.appendChild(cEl);
  }

  // Expose config + spawner so external systems (chaos mode) can drive lightning
  window._LT             = _LT;
  window._spawnLightning = _spawnLightning;
  window._clearAllLightning = () => { _stopLtLoop(); _clearAllLightning(); };

  let visible=false;
  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    if(e.key==='l'||e.key==='L'){ visible=!visible; if(visible){build();panel.style.display='block';}else panel.style.display='none'; }
  });

})();


// ═══════════════════════════════════════════════════════════════════════════════
//  ICE CHUNK OBSTACLE SYSTEM  v1
//  – Spawns massive floating ice slabs ahead of the ship (like cones / lightning)
//  – MeshPhysicalMaterial with transmission for a real ice/glass look
//  – Pool of 8 chunks; each scrolls with the world
//  – Tuner on C key
// ═══════════════════════════════════════════════════════════════════════════════
(function setupIceSystem() {

  // ── Config object (mirrors _LT / _asteroidTuner structure) ─────────────────
  const _ICE = {
    enabled:      false,
    frequency:    3.0,    // seconds between spawns
    spawnZ:      -120,    // how far ahead chunks appear
    laneMin:     -10,
    laneMax:      10,
    pattern:      'random',
    sweepSpeed:   0.25,
    staggerGap:   0.8,
    salvoCount:   2,
    // Size
    sizeMin:      8.0,    // base XZ scale
    sizeMax:      14.0,   // max XZ scale
    heightMin:    6.0,    // base Y scale
    heightMax:    14.0,   // max Y scale
    baseY:       -1.2,    // Y offset at spawn — negative sinks into water
    // Material
    transmission:      0.25,
    roughness:         0.4,
    metalness:         0.85,
    ior:               1.31,
    thickness:         6.0,
    emissiveIntensity: 4.0,
    // Style
    chunkStyle:        'grid',
    chunkBaseColor:    '#ffffff',
    chunkCrackColor:   '#ff00cc',
    chunkGridColor:    '#00eeff',
    chunkGridOpacity:  0.55,
    chunkEmissiveColor:'#003060',
    // Hitbox
    hitboxScale:  0.72,
  };

  const _ICE_POOL_SIZE = 8;
  const _icePool       = [];
  let   _iceActive     = [];
  let   _iceTimer      = 2.0;
  let   _iceSweepX     = 0.5;
  let   _iceSweepDir   = 1;
  const _iceStaggerQ   = [];

  // ── Displaced-icosahedron glacier geometry ────────────────────────────────
  // ── Ice chunk geometry: small terrain-slab fragments ───────────────────────
  // Each chunk is a displaced PlaneGeometry patch — same noise as the canyon
  // walls, so it looks like a piece that broke off. Style is independent from
  // the terrain: own color, own crack texture, own material mode.

  // Build a canvas texture for the chunk surface (called on rebuild)
  function _makeIceChunkTex() {
    const w = 256, h = 256;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');

    // Base fill
    const bc = _ICE.chunkBaseColor || '#060d1a';
    ctx.fillStyle = bc;
    ctx.fillRect(0, 0, w, h);

    const style = _ICE.chunkStyle || 'cracks';

    if (style === 'cracks' || style === 'both') {
      // Magenta/cyan crack lines
      let _rs = 77;
      const srng = () => { _rs = (_rs * 16807) % 2147483647; return (_rs - 1) / 2147483646; };
      const cc = _ICE.chunkCrackColor || '#ff00cc';
      for (let ci = 0; ci < 14; ci++) {
        const sx = srng() * w, sy = srng() * h;
        ctx.strokeStyle = srng() > 0.5 ? cc : '#00eeff';
        ctx.globalAlpha  = 0.4 + srng() * 0.5;
        ctx.lineWidth    = 0.7 + srng() * 1.6;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        let cx = sx, cy2 = sy;
        for (let si = 0; si < 3 + Math.floor(srng()*3); si++) {
          cx  += (srng() - 0.3) * 70;
          cy2 += (srng() - 0.2) * 55;
          ctx.lineTo(cx, cy2);
        }
        ctx.stroke();
      }
      // Glow hotspots
      for (let gi = 0; gi < 5; gi++) {
        const gx = srng()*w, gy = srng()*h;
        const gr = ctx.createRadialGradient(gx,gy,0,gx,gy,14+srng()*20);
        gr.addColorStop(0,   'rgba(255,0,200,0.6)');
        gr.addColorStop(0.5, 'rgba(80,0,200,0.2)');
        gr.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.globalAlpha = 1;
        ctx.fillRect(gx-35, gy-35, 70, 70);
      }
    }

    if (style === 'grid' || style === 'both') {
      const gc = _ICE.chunkGridColor || '#00eeff';
      ctx.strokeStyle = gc;
      ctx.globalAlpha  = _ICE.chunkGridOpacity || 0.55;
      ctx.lineWidth    = 1.2;
      const gx = 8, gz = 8;
      for (let i = 0; i <= gx; i++) { const x=(i/gx)*w; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
      for (let j = 0; j <= gz; j++) { const y=(j/gz)*h; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    }

    if (style === 'clean') {
      // Just a subtle edge vignette — no lines, pure ice slab
      const gr = ctx.createRadialGradient(w/2,h/2,h*0.2,w/2,h/2,h*0.75);
      gr.addColorStop(0, 'rgba(150,220,255,0.08)');
      gr.addColorStop(1, 'rgba(0,20,60,0.55)');
      ctx.fillStyle = gr; ctx.globalAlpha = 1;
      ctx.fillRect(0,0,w,h);
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // Shared chunk material — rebuilt via REBUILD button
  let _iceChunkTex = _makeIceChunkTex();
  function _makeIceMat() {
    const useTransmission = _ICE.transmission > 0.05;
    if (useTransmission) {
      return new THREE.MeshPhysicalMaterial({
        color:             new THREE.Color(_ICE.chunkBaseColor || '#aaccee'),
        map:               _iceChunkTex,
        emissive:          new THREE.Color(_ICE.chunkEmissiveColor || '#0044aa'),
        emissiveMap:       _iceChunkTex,
        emissiveIntensity: _ICE.emissiveIntensity,
        transmission:      _ICE.transmission,
        roughness:         _ICE.roughness,
        metalness:         _ICE.metalness,
        ior:               _ICE.ior,
        thickness:         _ICE.thickness,
        transparent:       true,
        opacity:           0.94,
        side:              THREE.DoubleSide,
        flatShading:       true,
        depthWrite:        false,
      });
    } else {
      return new THREE.MeshStandardMaterial({
        color:             new THREE.Color(_ICE.chunkBaseColor || '#0a1a2a'),
        map:               _iceChunkTex,
        emissive:          new THREE.Color(_ICE.chunkEmissiveColor || '#0044aa'),
        emissiveMap:       _iceChunkTex,
        emissiveIntensity: _ICE.emissiveIntensity,
        roughness:         _ICE.roughness,
        metalness:         _ICE.metalness,
        side:              THREE.DoubleSide,
        flatShading:       true,
      });
    }
  }

  // Terrain-patch displacement — same noise as canyon walls, small scale
  function _displaceChunk(geo, seed, peakH) {
    let _s = seed;
    const srng = () => { _s = (_s*16807)%2147483647; return (_s-1)/2147483646; };
    const pos = geo.attributes.position;
    const uv  = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u  = uv.getX(i);
      const vv = uv.getY(i);
      const px = u * 10.0 + srng()*2, pz = vv * 14.0 + srng()*2;
      const n1 = Math.sin(px*2.1+pz*1.1)*0.35;
      const n2 = Math.sin(px*5.3+pz*3.7)*0.25;
      const n3 = Math.abs(Math.sin(px*3.8+pz*2.2))*0.28;
      const noise = Math.pow(Math.max(0, 0.4+n1+n2+n3), 1.3);
      pos.setY(i, noise * peakH);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  function _buildIceInstance(seed) {
    const group = new THREE.Group();
    group.visible = false;
    const mat = _makeIceMat();

    // Chunk: a PlaneGeometry patch, displaced upward like a terrain fragment
    const segs = 10;
    const geo = new THREE.PlaneGeometry(1, 1, segs, segs);
    geo.rotateX(-Math.PI / 2);  // lay flat, displacement goes up
    _displaceChunk(geo, seed || 7919, 0.9);
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    const light = new THREE.PointLight(0x44aaff, 0.9, 20);
    light.position.set(0, 0.5, 0);
    group.add(light);

    scene.add(group);
    return {
      group, mesh, light,
      mats: [mat],
      get mat()  { return mat; },
      get mat2() { return mat; },
      active: false, halfW: 1, elapsed: 0,
    };
  }

  function _rebuildIcePool() {
    // Dispose old pool
    for (const inst of _icePool) {
      scene.remove(inst.group);
      inst.mesh.geometry.dispose();
      inst.mats.forEach(m => m.dispose());
    }
    _icePool.length = 0;
    _iceActive.length = 0;
    _iceChunkTex.dispose();
    _iceChunkTex = _makeIceChunkTex();
    for (let _ii = 0; _ii < _ICE_POOL_SIZE; _ii++) _icePool.push(_buildIceInstance((_ii+1)*7919));
  }

  // Initial pool build
  for (let _ii = 0; _ii < _ICE_POOL_SIZE; _ii++) _icePool.push(_buildIceInstance((_ii + 1) * 7919));

  function _getFreeIce() {
    return _icePool.find(c => !c.active) || null;
  }

  // ── Next target X from pattern (mirrors _ltNextTargetX) ───────────────────
  function _iceNextX() {
    const range = _ICE.laneMax - _ICE.laneMin;
    const sx    = (state && state.shipX) || 0;
    switch (_ICE.pattern) {
      case 'sweep': {
        const x = sx + (_iceSweepX - 0.5) * range;
        _iceSweepX += _iceSweepDir * _ICE.sweepSpeed * _ICE.frequency / range * 0.12;
        if (_iceSweepX >= 1 || _iceSweepX <= 0) { _iceSweepDir *= -1; _iceSweepX = Math.max(0, Math.min(1, _iceSweepX)); }
        return x;
      }
      case 'stagger': {
        if (_iceStaggerQ.length === 0) {
          const steps = 4 + Math.floor(Math.random() * 4);
          for (let i = 0; i < steps; i++) _iceStaggerQ.push(sx + (i / (steps - 1) - 0.5) * range * 0.85);
        }
        return _iceStaggerQ.shift();
      }
      case 'salvo': return sx + (Math.random() - 0.5) * range * 0.5;
      default:      return sx + (Math.random() - 0.5) * (range * 0.55);
    }
  }

  // ── Spawn one chunk ────────────────────────────────────────────────────────
  function _spawnIce(targetX) {
    const inst = _getFreeIce();
    if (!inst) return;

    // Randomise size each spawn
    const scaleX = _ICE.sizeMin   + Math.random() * (_ICE.sizeMax   - _ICE.sizeMin);
    const scaleY = _ICE.heightMin + Math.random() * (_ICE.heightMax - _ICE.heightMin);
    const scaleZ = scaleX * (0.55 + Math.random() * 0.7);
    const tiltY  = (Math.random() - 0.5) * 0.9;   // random yaw
    const tiltX  = (Math.random() - 0.5) * 0.06;  // very slight pitch — stay mostly upright

    inst.group.scale.set(scaleX, scaleY, scaleZ);
    inst.group.rotation.set(tiltX, tiltY, 0);
    inst.halfW = scaleX * _ICE.hitboxScale * 0.5;

    // Live-update material params for all spire/base materials
    for (const m of inst.mats) {
      m.transmission      = _ICE.transmission;
      m.roughness         = _ICE.roughness;
      m.ior               = _ICE.ior;
      m.thickness         = _ICE.thickness;
      m.emissiveIntensity = _ICE.emissiveIntensity;
      m.needsUpdate       = true;
    }

    // World-space Z: ahead of ship (shipGroup.position.z is always 3.9 — world scrolls)
    const shipZ  = (typeof shipGroup !== 'undefined' && shipGroup) ? shipGroup.position.z : 3.9;
    const spawnZ = shipZ + _ICE.spawnZ;
    inst.group.position.set(targetX, _ICE.baseY, spawnZ);
    inst.group.visible = true;
    inst.light.intensity = 0.6;
    inst.elapsed = 0;
    inst.active  = true;
    _iceActive.push(inst);
  }

  // ── Kill / recycle one chunk ───────────────────────────────────────────────
  function _killIce(inst) {
    inst.group.visible = false;
    inst.active = false;
    const idx = _iceActive.indexOf(inst);
    if (idx !== -1) _iceActive.splice(idx, 1);
  }

  function _clearAllIce() {
    for (let i = _iceActive.length - 1; i >= 0; i--) _killIce(_iceActive[i]);
    _iceActive.length = 0;
    _iceTimer = 0;
    _iceSweepX = 0.5; _iceSweepDir = 1;
    _iceStaggerQ.length = 0;
  }

  // ── Per-frame update: scroll + hitcheck ───────────────────────────────────
  function _updateIce(dt) {
    const scrollSpeed = state.speed || 36;
    for (let i = _iceActive.length - 1; i >= 0; i--) {
      const inst = _iceActive[i];
      inst.elapsed += dt;

      // Scroll — same as cones: world moves toward ship, chunk moves +Z each frame
      inst.group.position.z += scrollSpeed * dt;

      // Gentle bob on water
      inst.group.position.y = _ICE.baseY + Math.sin(inst.elapsed * 0.9 + i) * 0.06;

      // Despawn behind ship
      if (inst.group.position.z > 8) {
        _killIce(inst);
        continue;
      }

      // Hit check — only when chunk is near ship Z (z > -4)
      if (inst.group.position.z > -4 && inst.group.position.z < 5) {
        const sx  = (state && state.shipX) || 0;
        const dx  = Math.abs(inst.group.position.x - sx);
        if (dx < inst.halfW) {
          if (_godMode) {
            // God mode: shield-hit sound, no death
            const _shHitSfx = document.getElementById('shield-hit-sfx');
            if (_shHitSfx) { _shHitSfx.currentTime = 0; _shHitSfx.play().catch(()=>{}); }
            addCrashFlash(0xff4400);
          } else {
            if (typeof triggerDeath === 'function') triggerDeath();
            else if (typeof window.triggerDeath === 'function') window.triggerDeath();
          }
          _killIce(inst);
          continue;
        }
      }
    }
  }

  // ── Spawn tick ────────────────────────────────────────────────────────────
  function _tickIceSpawner(dt) {
    if (!_ICE.enabled) return;
    // _ICE.enabled already checked above — always allow when enabled (bypasses tutorial _noSpawnMode)

    _iceTimer -= dt;
    if (_iceTimer <= 0) {
      _iceTimer = _ICE.frequency * (0.75 + Math.random() * 0.5);

      if (_ICE.pattern === 'salvo') {
        const count = Math.max(1, Math.round(_ICE.salvoCount));
        const sx    = (state && state.shipX) || 0;
        const half  = (_ICE.laneMax - _ICE.laneMin) * 0.45;
        for (let si = 0; si < count; si++) {
          const frac = count === 1 ? 0.5 : si / (count - 1);
          _spawnIce(sx + (frac - 0.5) * half * 2);
        }
      } else {
        _spawnIce(_iceNextX());
      }
    }
  }

  // ── Hook into composer.render (same chaining pattern as asteroids/lightning)
  const _iceOrigRender = composer.render.bind(composer);
  let   _iceLastTime   = performance.now();
  composer.render = function(...args) {
    const now = performance.now();
    const dt  = Math.min((now - _iceLastTime) * 0.001, 0.05);
    _iceLastTime = now;
    if (state.phase === 'playing' && !state.introActive &&
        (state._tutorialActive || _chaosMode || state._jetLightningMode)) {
      _tickIceSpawner(dt);
    }
    _updateIce(dt);
    _iceOrigRender(...args);
  };

  // ── Expose for external systems ────────────────────────────────────────────
  window._ICE        = _ICE;
  window._spawnIce   = _spawnIce;
  window._clearAllIce = _clearAllIce;

  // ═══════════════════════════════════════════════════════════════════════════
  //  ICE TUNER PANEL  (key = 'C')
  // ═══════════════════════════════════════════════════════════════════════════
  const panel = document.createElement('div');
  panel.id = 'ice-tuner';
  panel.style.cssText = 'display:none;position:fixed;top:0;right:270px;width:260px;height:100%;background:rgba(0,0,0,0.93);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;border-left:1px solid #6cf;';
  document.body.appendChild(panel);

  function mkS(label, val, min, max, step, fn, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:3px 0;display:flex;align-items:center;gap:4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:120px;color:' + (color || '#6cf') + ';font-size:10px;flex-shrink:0;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    inp.style.cssText = 'flex:1;height:14px;accent-color:' + (color || '#6cf') + ';';
    const vEl = document.createElement('span');
    vEl.style.cssText = 'width:38px;text-align:right;font-size:10px;color:#fff;';
    vEl.textContent = (+val).toFixed(2);
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); vEl.textContent = v.toFixed(2); fn(v); });
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(vEl);
    return row;
  }

  function mkH(text, color) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:10px 0 4px;font-size:11px;font-weight:bold;color:' + (color || '#6cf') + ';border-bottom:1px solid #336;padding-bottom:2px;';
    h.textContent = text;
    return h;
  }

  function mkT(label, getter, setter, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:8px;';
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:1px solid ' + (color || '#6cf') + ';color:' + (color || '#6cf') + ';padding:3px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;';
    const refresh = () => { btn.textContent = label + ': ' + (getter() ? 'ON' : 'OFF'); btn.style.opacity = getter() ? '1' : '0.5'; };
    btn.onclick = () => { setter(!getter()); refresh(); };
    refresh();
    row.appendChild(btn);
    return row;
  }

  function mkSel(label, options, getter, setter, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'color:' + (color || '#6cf') + ';font-size:10px;width:120px;flex-shrink:0;';
    lbl.textContent = label;
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;background:#111;color:#fff;border:1px solid #6cf;font-family:monospace;font-size:10px;padding:2px;';
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o === getter()) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => setter(sel.value);
    row.appendChild(lbl); row.appendChild(sel);
    return row;
  }

  function build() {
    panel.innerHTML = '<div style="font-size:13px;font-weight:bold;color:#6cf;margin-bottom:6px;">🧊 ICE TUNER (C)</div>';

    // MASTER
    panel.appendChild(mkH('MASTER', '#6cf'));
    panel.appendChild(mkT('ENABLED', () => _ICE.enabled, v => {
      _ICE.enabled = v;
      if (!v) _clearAllIce();
      else _iceTimer = 0.5;
    }, '#6cf'));

    // SPAWN
    panel.appendChild(mkH('SPAWN', '#8df'));
    panel.appendChild(mkS('frequency (s)', _ICE.frequency, 0.5, 20, 0.1, v => _ICE.frequency = v));
    panel.appendChild(mkSel('pattern', ['random', 'sweep', 'stagger', 'salvo'],
      () => _ICE.pattern, v => { _ICE.pattern = v; _iceSweepX = 0.5; _iceStaggerQ.length = 0; }));
    panel.appendChild(mkS('sweep speed', _ICE.sweepSpeed, 0.02, 1.5, 0.01, v => _ICE.sweepSpeed = v));
    panel.appendChild(mkS('stagger gap', _ICE.staggerGap, 0.2, 5.0, 0.1, v => _ICE.staggerGap = v));
    panel.appendChild(mkS('salvo count', _ICE.salvoCount, 1, 6, 1, v => _ICE.salvoCount = Math.round(v)));
    panel.appendChild(mkS('spawn Z', _ICE.spawnZ, -200, -30, 1, v => _ICE.spawnZ = v));
    panel.appendChild(mkS('lane min X', _ICE.laneMin, -20, 0, 0.5, v => _ICE.laneMin = v));
    panel.appendChild(mkS('lane max X', _ICE.laneMax, 0, 20, 0.5, v => _ICE.laneMax = v));

    // SIZE
    panel.appendChild(mkH('SIZE', '#aef'));
    panel.appendChild(mkS('size min', _ICE.sizeMin, 0.5, 8, 0.1, v => _ICE.sizeMin = v));
    panel.appendChild(mkS('size max', _ICE.sizeMax, 1.0, 14, 0.1, v => _ICE.sizeMax = v));
    panel.appendChild(mkS('height min', _ICE.heightMin, 1.0, 16, 0.1, v => _ICE.heightMin = v));
    panel.appendChild(mkS('height max', _ICE.heightMax, 2.0, 24, 0.1, v => _ICE.heightMax = v));
    panel.appendChild(mkS('hitbox scale', _ICE.hitboxScale, 0.1, 1.0, 0.01, v => _ICE.hitboxScale = v));

    // MATERIAL
    panel.appendChild(mkH('MATERIAL', '#9cf'));
    panel.appendChild(mkS('transmission', _ICE.transmission, 0, 1, 0.01, v => {
      _ICE.transmission = v;
      _icePool.forEach(inst => { inst.mats.forEach(m => { if (m.transmission !== undefined) { m.transmission = v; m.needsUpdate = true; } }); });
    }));
    panel.appendChild(mkS('roughness', _ICE.roughness, 0, 1, 0.01, v => {
      _ICE.roughness = v;
      _icePool.forEach(inst => { inst.mats.forEach(m => { m.roughness = v; }); });
    }));
    panel.appendChild(mkS('metalness', _ICE.metalness, 0, 1, 0.01, v => {
      _ICE.metalness = v;
      _icePool.forEach(inst => { inst.mats.forEach(m => { m.metalness = v; }); });
    }));
    panel.appendChild(mkS('emissive intensity', _ICE.emissiveIntensity, 0, 5, 0.05, v => {
      _ICE.emissiveIntensity = v;
      _icePool.forEach(inst => { inst.mats.forEach(m => { m.emissiveIntensity = v; }); });
    }));

    // STYLE
    panel.appendChild(mkH('STYLE', '#c8f'));
    panel.appendChild(mkSel('surface style', ['cracks','grid','both','clean'],
      () => _ICE.chunkStyle, v => { _ICE.chunkStyle = v; }));

    // Color pickers
    function mkColor(label, getter, setter) {
      const row = document.createElement('div');
      row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:8px;font-size:10px;color:#c8f;';
      const lbl = document.createElement('span'); lbl.style.width='120px'; lbl.textContent = label;
      const inp = document.createElement('input'); inp.type='color'; inp.value=getter();
      inp.style.cssText='width:36px;height:22px;border:none;background:none;cursor:pointer;';
      inp.oninput = () => setter(inp.value);
      row.appendChild(lbl); row.appendChild(inp);
      return row;
    }
    panel.appendChild(mkColor('base color',    () => _ICE.chunkBaseColor,    v => _ICE.chunkBaseColor = v));
    panel.appendChild(mkColor('crack color',   () => _ICE.chunkCrackColor,   v => _ICE.chunkCrackColor = v));
    panel.appendChild(mkColor('grid color',    () => _ICE.chunkGridColor,    v => _ICE.chunkGridColor = v));
    panel.appendChild(mkColor('emissive color',() => _ICE.chunkEmissiveColor,v => _ICE.chunkEmissiveColor = v));
    panel.appendChild(mkS('grid opacity', _ICE.chunkGridOpacity, 0, 1, 0.01, v => _ICE.chunkGridOpacity = v, '#c8f'));

    // REBUILD button — regenerates texture + pool
    const rebuildBtn = document.createElement('button');
    rebuildBtn.textContent = '⟳ REBUILD CHUNKS';
    rebuildBtn.style.cssText = 'background:#110022;border:1px solid #c8f;color:#c8f;padding:5px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:6px 0;width:100%;';
    rebuildBtn.onclick = () => {
      _clearAllIce();
      _rebuildIcePool();
      rebuildBtn.textContent = '✓ REBUILT';
      setTimeout(() => { rebuildBtn.textContent = '⟳ REBUILD CHUNKS'; }, 1200);
    };
    panel.appendChild(rebuildBtn);

    // ACTIONS
    panel.appendChild(mkH('ACTIONS', '#0f8'));
    const spawnBtn = document.createElement('button');
    spawnBtn.textContent = '▼ SPAWN ONE';
    spawnBtn.style.cssText = 'background:#062;border:1px solid #0f8;color:#0f8;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:3px 0;width:100%;';
    spawnBtn.onclick = () => {
      if (state.phase !== 'playing') state.phase = 'playing';
      _spawnIce((state && state.shipX) || 0);
    };
    panel.appendChild(spawnBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕ CLEAR ALL';
    clearBtn.style.cssText = 'background:#300;border:1px solid #f44;color:#f44;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:3px 0;width:100%;';
    clearBtn.onclick = () => _clearAllIce();
    panel.appendChild(clearBtn);

    // Active count
    const cEl = document.createElement('div');
    cEl.style.cssText = 'margin-top:6px;color:#888;font-size:10px;';
    const rc = () => { cEl.textContent = 'active: ' + _iceActive.length; };
    rc();
    setInterval(rc, 500);
    panel.appendChild(cEl);
  }

  let visible = false;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'c' || e.key === 'C') {
      visible = !visible;
      if (visible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });

})();

// ═══════════════════════════════════════════════════════════════════════════════
//  FAT CONE TUNER PANEL  (key = 'F')
//  Spawns massive cones (scale 12,1,12) — same pool as campaign cones.
//  Has loop mode identical to asteroid/lightning tuners.
// ═══════════════════════════════════════════════════════════════════════════════
(function setupFatConeTuner() {
  // ── Tuner state ─────────────────────────────────────────────────────────────
  const FCT = {
    enabled:   false,
    frequency: 1.0,    // seconds between spawns — matches campaign T5A_FATCONES cadence
    // shape
    scaleXZ:        4,     // standard campaign fat cone footprint
    scaleY:         1,     // height scalar
    glowBot:        0.255, // neon band bottom (UV space)
    glowTop:        0.345, // neon band top (UV space)
    neonColor:      0xff1a8c, // default: pink (matches type-0)
    obsidianColor:  0x12121a, // dark body color
    // placement
    laneMin:  -10,
    laneMax:   10,
    spreadAroundShip: 8,
    coneType: -1,       // -1 = random, 0/1/2 = specific mesh
  };

  let _fcLoopActive = false, _fcLoopTimer = null, _fcActiveBtn = null;

  function _spawnFatConeRow() {
    if (state.phase !== 'playing') return;
    // Port campaign fat cone spawner exactly:
    // Pick 2-3 lanes from the 21-lane grid, enforce 8-lane min gap, guarantee a 2-lane gap for player
    const count = 2 + Math.floor(Math.random() * 2); // 2 or 3 cones per row
    const shipX = (state && state.shipX) || 0;
    const lanes = Array.from({ length: LANE_COUNT }, (_, i) => i);
    const shuffled = [...lanes].sort(() => Math.random() - 0.5);
    const gapStart = Math.floor(Math.random() * (LANE_COUNT - 1));
    const gapLanes = new Set([gapStart, gapStart + 1]);
    const blocked = [];
    for (const lane of shuffled) {
      if (blocked.length >= count) break;
      if (gapLanes.has(lane)) continue;
      if (blocked.some(b => Math.abs(b - lane) < 8)) continue; // wide gap between fat cones
      blocked.push(lane);
    }
    blocked.forEach(lane => {
      const laneX = shipX + (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
      const type = FCT.coneType < 0 ? Math.floor(Math.random() * 3) : FCT.coneType;
      const obs = getPooledObstacle(type);
      if (!obs) return;
      obs.position.set(laneX, 0, SPAWN_Z);
      obs.scale.set(FCT.scaleXZ, FCT.scaleY, FCT.scaleXZ);
      obs.userData.velX         = 0;
      obs.userData.slalomScaled = true;
      obs.userData.isFatCone    = true;
      // Apply shape tuner overrides
      const _mc = obs.userData._meshes;
      for (let mi = 0; mi < _mc.length; mi++) {
        const mat = _mc[mi].material;
        if (mat.uniforms) {
          if (mat.uniforms.uGlowBot)  mat.uniforms.uGlowBot.value  = FCT.glowBot;
          if (mat.uniforms.uGlowTop)  mat.uniforms.uGlowTop.value  = FCT.glowTop;
          if (mat.uniforms.uNeon)     mat.uniforms.uNeon.value.setHex(FCT.neonColor);
          if (mat.uniforms.uObsidian) mat.uniforms.uObsidian.value.setHex(FCT.obsidianColor);
        }
      }
      activeObstacles.push(obs);
      _sessionLogEvent('fatCone_spawn', { x: laneX, scaleXZ: FCT.scaleXZ });
    });
  }

  // Keep _spawnFatCone as alias for single-cone manual spawn (F panel SPAWN ONE button)
  function _spawnFatCone() {
    if (state.phase !== 'playing') return;
    const type = FCT.coneType < 0 ? Math.floor(Math.random() * 3) : FCT.coneType;
    const obs = getPooledObstacle(type);
    if (!obs) return;
    const shipX = (state && state.shipX) || 0;
    const laneX = FCT.laneMin + Math.random() * (FCT.laneMax - FCT.laneMin);
    obs.position.set(laneX, 0, SPAWN_Z);
    obs.scale.set(FCT.scaleXZ, FCT.scaleY, FCT.scaleXZ);
    obs.userData.velX         = 0;
    obs.userData.slalomScaled = true;
    obs.userData.isFatCone    = true;
    const _mc = obs.userData._meshes;
    for (let mi = 0; mi < _mc.length; mi++) {
      const mat = _mc[mi].material;
      if (mat.uniforms) {
        if (mat.uniforms.uGlowBot)  mat.uniforms.uGlowBot.value  = FCT.glowBot;
        if (mat.uniforms.uGlowTop)  mat.uniforms.uGlowTop.value  = FCT.glowTop;
        if (mat.uniforms.uNeon)     mat.uniforms.uNeon.value.setHex(FCT.neonColor);
        if (mat.uniforms.uObsidian) mat.uniforms.uObsidian.value.setHex(FCT.obsidianColor);
      }
    }
    activeObstacles.push(obs);
    _sessionLogEvent('fatCone_spawn', { x: laneX, scaleXZ: FCT.scaleXZ });
  }

  function _startFcLoop(btn) {
    _stopFcLoop();
    _fcLoopActive = true;
    _fcActiveBtn = btn;
    if (btn) { btn.style.opacity = '1'; btn.style.background = '#1a1a00'; }
    function loop() {
      if (!_fcLoopActive) return;
      _spawnFatConeRow(); // use campaign row algo
      _fcLoopTimer = setTimeout(loop, FCT.frequency * 1000 * (0.7 + Math.random() * 0.6));
    }
    loop();
  }

  function _stopFcLoop() {
    _fcLoopActive = false;
    if (_fcLoopTimer) { clearTimeout(_fcLoopTimer); _fcLoopTimer = null; }
    if (_fcActiveBtn) { _fcActiveBtn.style.opacity = '0.7'; _fcActiveBtn.style.background = 'none'; _fcActiveBtn = null; }
  }

  // ── Panel ──────────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'fatcone-tuner';
  panel.style.cssText = 'display:none;position:fixed;top:0;right:0;width:270px;height:100%;background:rgba(0,0,0,0.93);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;border-left:1px solid #f80;';
  document.body.appendChild(panel);

  function mkSlider(label, val, min, max, step, onChange, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:4px;flex-wrap:wrap;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:110px;color:'+(color||'#f80')+';font-size:10px;flex-shrink:0;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=val;
    inp.style.cssText = 'flex:1;height:14px;accent-color:'+(color||'#f80')+';';
    const valEl = document.createElement('span');
    valEl.style.cssText = 'width:36px;text-align:right;font-size:10px;color:#fff;';
    valEl.textContent = (+val).toFixed(2);
    inp.oninput = () => {
      const v = +inp.value;
      onChange(v);
      valEl.textContent = v.toFixed(2);
      _sessionLogSlider('fatcone_' + label, v);
    };
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(valEl);
    return row;
  }

  function mkH(text, color) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:10px 0 4px;font-size:11px;font-weight:bold;color:'+(color||'#f80')+';border-bottom:1px solid #333;padding-bottom:2px;';
    h.textContent = text;
    return h;
  }

  function mkBtn(label, color, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `background:none;border:1px solid ${color};color:${color};padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px 0;width:100%;text-align:left;opacity:0.7;transition:opacity 0.1s;`;
    b.onclick = onClick;
    return b;
  }

  function build() {
    panel.innerHTML = '<div style="font-size:13px;font-weight:bold;color:#f80;margin-bottom:6px;">🔺 FAT CONE TUNER (F)</div>';

    panel.appendChild(mkH('SHAPE', '#f80'));
    panel.appendChild(mkSlider('scale XZ', FCT.scaleXZ, 0.5, 20, 0.25, v => FCT.scaleXZ = v, '#f80'));
    panel.appendChild(mkSlider('scale Y', FCT.scaleY, 0.1, 5, 0.1, v => FCT.scaleY = v, '#f80'));
    panel.appendChild(mkSlider('glow bot', FCT.glowBot, 0, 1, 0.005, v => FCT.glowBot = v, '#f0a'));
    panel.appendChild(mkSlider('glow top', FCT.glowTop, 0, 1, 0.005, v => FCT.glowTop = v, '#f0a'));

    // Neon color picker
    (() => {
      const row = document.createElement('div');
      row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;';
      const lbl = document.createElement('span'); lbl.style.cssText = 'width:110px;color:#f0a;font-size:10px;flex-shrink:0;'; lbl.textContent = 'neon color';
      const inp = document.createElement('input'); inp.type='color'; inp.value='#'+FCT.neonColor.toString(16).padStart(6,'0');
      inp.style.cssText = 'flex:1;height:22px;border:none;background:none;cursor:pointer;';
      inp.oninput = () => { FCT.neonColor = parseInt(inp.value.slice(1),16); };
      row.appendChild(lbl); row.appendChild(inp); panel.appendChild(row);
    })();

    // Obsidian color picker
    (() => {
      const row = document.createElement('div');
      row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;';
      const lbl = document.createElement('span'); lbl.style.cssText = 'width:110px;color:#aaa;font-size:10px;flex-shrink:0;'; lbl.textContent = 'body color';
      const inp = document.createElement('input'); inp.type='color'; inp.value='#'+FCT.obsidianColor.toString(16).padStart(6,'0');
      inp.style.cssText = 'flex:1;height:22px;border:none;background:none;cursor:pointer;';
      inp.oninput = () => { FCT.obsidianColor = parseInt(inp.value.slice(1),16); };
      row.appendChild(lbl); row.appendChild(inp); panel.appendChild(row);
    })();

    panel.appendChild(mkH('SPAWN', '#f80'));


    panel.appendChild(mkSlider('lane min', FCT.laneMin, -25, 0, 0.5, v => FCT.laneMin = v, '#8df'));
    panel.appendChild(mkSlider('lane max', FCT.laneMax, 0, 25, 0.5, v => FCT.laneMax = v, '#8df'));

    const coneTypeSel = document.createElement('div');
    coneTypeSel.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const ctLbl = document.createElement('span');
    ctLbl.style.cssText = 'color:#f80;font-size:10px;width:110px;flex-shrink:0;';
    ctLbl.textContent = 'cone type';
    const ctSel = document.createElement('select');
    ctSel.style.cssText = 'flex:1;background:#111;color:#fff;border:1px solid #f80;font-family:monospace;font-size:10px;padding:2px;';
    [['random', -1],['type 0',0],['type 1',1],['type 2',2]].forEach(([lbl, val]) => {
      const o = document.createElement('option'); o.value=val; o.textContent=lbl;
      if (val === FCT.coneType) o.selected = true;
      ctSel.appendChild(o);
    });
    ctSel.onchange = () => { FCT.coneType = +ctSel.value; };
    coneTypeSel.appendChild(ctLbl); coneTypeSel.appendChild(ctSel);
    panel.appendChild(coneTypeSel);

    // Manual spawn
    const spawnBtn = mkBtn('▼ SPAWN ONE', '#f80', _spawnFatCone);
    spawnBtn.style.opacity = '1';
    spawnBtn.style.marginTop = '6px';
    panel.appendChild(spawnBtn);

    panel.appendChild(mkH('LOOP', '#fa0'));
    panel.appendChild(mkSlider('frequency (s)', FCT.frequency, 0.3, 20, 0.1, v => FCT.frequency = v, '#fa0'));

    const loopBtn = mkBtn('▶ START LOOP', '#fa0', () => _startFcLoop(loopBtn));
    panel.appendChild(loopBtn);

    const stopBtn = document.createElement('button');
    stopBtn.textContent = '⏹ STOP LOOP';
    stopBtn.style.cssText = 'background:#222;border:1px solid #888;color:#aaa;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:4px 0 2px;width:100%;';
    stopBtn.onclick = _stopFcLoop;
    panel.appendChild(stopBtn);

    const clearBtn = mkBtn('✕ CLEAR ALL CONES', '#f44', () => {
      _stopFcLoop();
      for (let i = activeObstacles.length - 1; i >= 0; i--) {
        if (activeObstacles[i].userData.isFatCone) {
          const o = activeObstacles.splice(i, 1)[0];
          scene.remove(o);
        }
      }
    });
    panel.appendChild(clearBtn);

    const countEl = document.createElement('div');
    countEl.style.cssText = 'margin-top:6px;color:#888;font-size:10px;';
    const refreshCount = () => {
      const n = activeObstacles.filter(o => o.userData.isFatCone).length;
      countEl.textContent = 'fat cones active: ' + n;
    };
    refreshCount();
    setInterval(refreshCount, 500);
    panel.appendChild(countEl);
  }

  // Expose to sequencer tick (outside IIFE scope)
  window._spawnFatCone    = _spawnFatCone;
  window._spawnFatConeRow = _spawnFatConeRow;
  window._startFcLoop     = _startFcLoop;
  window._stopFcLoop      = _stopFcLoop;
  window._FCT = FCT;

  let _fcVisible = false;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'f' || e.key === 'F') {
      _fcVisible = !_fcVisible;
      if (_fcVisible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// ═══════════════════════════════════════════════════════════════════════════════
//  SESSION LOGGER
//  Records slider changes, obstacle spawns, ship state snapshots.
//  Start/Stop with 'L' key. Export with 'E' key while stopped.
//  Designed to be pasted back to reconstruct a level.
// ═══════════════════════════════════════════════════════════════════════════════
(function setupSessionLogger() {
  let _logActive  = false;
  let _logEntries = [];
  let _logStartT  = 0;
  let _logSnapshotInterval = null;
  let _logUi = null;

  // Public hook — called by tuner sliders and spawners above
  window._sessionLogSlider = function(name, value) {
    if (!_logActive) return;
    _logEntries.push({
      t: +((performance.now() - _logStartT) / 1000).toFixed(2),
      type: 'slider',
      name, value,
      shipX: +(state.shipX||0).toFixed(2),
      speed:  +(state.speed||0).toFixed(1),
    });
  };

  window._sessionLogEvent = function(type, data) {
    if (!_logActive) return;
    _logEntries.push({
      t: +((performance.now() - _logStartT) / 1000).toFixed(2),
      type,
      ...data,
      shipX: +(state.shipX||0).toFixed(2),
      speed:  +(state.speed||0).toFixed(1),
    });
  };

  function _snapshotScene() {
    if (!_logActive || state.phase !== 'playing') return;
    const astT = window._asteroidTuner || {};
    const ltT  = window._LT || {};
    _logEntries.push({
      t: +((performance.now() - _logStartT) / 1000).toFixed(2),
      type: 'snapshot',
      shipX:     +(state.shipX||0).toFixed(2),
      shipVelX:  +(state.shipVelX||0).toFixed(2),
      speed:     +(state.speed||0).toFixed(1),
      score:     state.score,
      level:     (state.currentLevelIdx||0) + 1,
      obstacles: activeObstacles.length,
      ast: {
        enabled: astT.enabled, pattern: astT.pattern,
        freq: +(astT.frequency||0).toFixed(2),
        size: +(astT.size||0).toFixed(2),
        leadFactor: +(astT.leadFactor||0).toFixed(2),
        staggerDual: astT.staggerDual,
        salvoCount: astT.salvoCount,
        laneMin: astT.laneMin, laneMax: astT.laneMax,
      },
      lt: {
        enabled: ltT.enabled, pattern: ltT.pattern,
        freq: +(ltT.frequency||0).toFixed(2),
        staggerGap: +(ltT.staggerGap||0).toFixed(2),
      },
      physics: {
        accelBase: typeof _accelBase !== 'undefined' ? _accelBase : null,
        maxVelBase: typeof _maxVelBase !== 'undefined' ? _maxVelBase : null,
      },
    });
  }

  function _startLog() {
    _logEntries = [];
    _logStartT  = performance.now();
    _logActive  = true;
    // Snapshot every 5 seconds
    _logSnapshotInterval = setInterval(_snapshotScene, 5000);
    _updateLogUi();
    // Log initial state
    _sessionLogEvent('log_start', {
      mode: state._jetLightningMode ? 'JetLightning' : state._tutorialActive ? 'Tutorial' : 'Campaign',
    });
  }

  function _stopLog() {
    _logActive = false;
    clearInterval(_logSnapshotInterval);
    _logSnapshotInterval = null;
    _updateLogUi();
  }

  function _exportLog() {
    if (_logEntries.length === 0) { alert('No log entries — start a session first.'); return; }
    const json = JSON.stringify({ version: 1, entries: _logEntries }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'jet-session-' + Date.now() + '.json';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function _updateLogUi() {
    if (!_logUi) return;
    const status = _logUi.querySelector('#log-status');
    const startBtn = _logUi.querySelector('#log-start');
    const stopBtn  = _logUi.querySelector('#log-stop');
    if (_logActive) {
      status.textContent = '● REC';
      status.style.color = '#f44';
      startBtn.style.opacity = '0.4';
      stopBtn.style.opacity  = '1';
    } else {
      status.textContent = _logEntries.length > 0 ? '■ ' + _logEntries.length + ' events' : '○ idle';
      status.style.color = _logEntries.length > 0 ? '#0f8' : '#888';
      startBtn.style.opacity = '1';
      stopBtn.style.opacity  = '0.4';
    }
  }

  // ── Floating logger HUD (always visible during play) ─────────────────────
  function _buildLogHud() {
    _logUi = document.createElement('div');
    _logUi.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;font-family:monospace;font-size:10px;background:rgba(0,0,0,0.85);border:1px solid #444;padding:5px 10px;border-radius:3px;display:flex;align-items:center;gap:8px;pointer-events:all;';

    const title = document.createElement('span');
    title.style.cssText = 'color:#888;';
    title.textContent = 'LOG';
    _logUi.appendChild(title);

    const status = document.createElement('span');
    status.id = 'log-status';
    status.style.cssText = 'color:#888;min-width:80px;';
    status.textContent = '○ idle';
    _logUi.appendChild(status);

    const startBtn = document.createElement('button');
    startBtn.id = 'log-start';
    startBtn.textContent = '● REC';
    startBtn.style.cssText = 'background:none;border:1px solid #f44;color:#f44;padding:2px 6px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;';
    startBtn.onclick = () => { if (!_logActive) _startLog(); };
    _logUi.appendChild(startBtn);

    const stopBtn = document.createElement('button');
    stopBtn.id = 'log-stop';
    stopBtn.textContent = '■ STOP';
    stopBtn.style.cssText = 'background:none;border:1px solid #888;color:#888;padding:2px 6px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;opacity:0.4;';
    stopBtn.onclick = () => { if (_logActive) _stopLog(); };
    _logUi.appendChild(stopBtn);

    const expBtn = document.createElement('button');
    expBtn.textContent = '⬇ EXPORT';
    expBtn.style.cssText = 'background:none;border:1px solid #0f8;color:#0f8;padding:2px 6px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;';
    expBtn.onclick = _exportLog;
    _logUi.appendChild(expBtn);

    document.body.appendChild(_logUi);
  }

  _buildLogHud();

  // L = toggle log, E = export
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'l' || e.key === 'L') { _logActive ? _stopLog() : _startLog(); }
    if ((e.key === 'e' || e.key === 'E') && !_logActive) _exportLog();
  });

  // Slider logging is now injected directly inside each tuner's makeSlider/mkS functions.
})();
// cache bust 1776456958
