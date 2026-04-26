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
  // Death Run: track selection driven by per-stage musicTrack field.
  // The latest musicTrack set by any stage at or before the current index wins.
  if (state.isDeathRun) {
    if (typeof DR_SEQUENCE !== 'undefined') {
      const _idx = state.seqStageIdx || 0;
      let _t = 'bg';
      for (let i = 0; i <= _idx && i < DR_SEQUENCE.length; i++) {
        if (DR_SEQUENCE[i].musicTrack) _t = DR_SEQUENCE[i].musicTrack;
      }
      return _t;
    }
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

// Full state-wipe used by hotkey jumps. clearAllCorridorFlags() handles the
// active-flag set, but six categories of substate leak between hotkey jumps
// and corrupt the sequencer/visuals. This helper wipes them all.
function _drFullStateWipe() {
  // 1) Zipper substate
  state.zipperRowsLeft     = 0;
  state.zipperCooldown     = 0;
  state.zipperHoldCount    = 0;
  state.zipperRunCount     = 0;
  state.zipperSpawnTimer   = 0;
  // 2) Stage timers / one-shot fired flags
  state._seqZipTimer       = 0;
  state._seqZipFired       = false;
  state._seqSlalomFired    = false;
  state._seqStructuredTimer = 0;
  state._seqRampT01        = 0;
  state._seqAngledTimer    = 0;
  state._restBeepFired     = false;
  // S2 burst-rhythm state (cones_and_zips)
  state._seqZipBurstNum    = 0;
  state._seqZipRestTimer   = 0;
  // 3) Canyon flags — call stop helpers if currently active so they restore
  //    speed/FOV/lighting before we wipe their flags.
  if (state.l3KnifeCanyon && typeof _stopL3KnifeCanyon === 'function') _stopL3KnifeCanyon();
  if (state.preT4ACanyon  && typeof _stopPreT4ACanyon  === 'function') _stopPreT4ACanyon();
  if (state.preT4BCanyon  && typeof _stopPreT4BCanyon  === 'function') _stopPreT4BCanyon();
  state.preT4ACanyon       = false;
  state.preT4BCanyon       = false;
  // 4) L3 entry/done state — re-arm L3 knife on next entry
  state.l3KnifeDone        = false;
  state._l3EntryLogged     = false;
  // 5) Endless-mode rotation state (Shift+2 hotkey enters endless)
  state._endlessActiveType    = '';
  state._endlessBlockTimer    = 0;
  state._endlessRotationIdx   = 0;
  state._endlessCorridorCount = 0;
  // 6) Corridor sub-state (gap drift, row counter)
  state.corridorRowsDone   = 0;
  state.corridorGapCenter  = 0;
  state.corridorGapDir     = 1;
  state.corridorSpawnZ     = -7;
  // 7) L4 corridor center anchor — cleared so the next L4 activation captures
  //    a fresh ship X. _activeSunOverride is intentionally NOT cleared here:
  //    the running stage-entry vibe / override transitions already restore the
  //    correct sun on the next stage entry. Forcing it to null here would
  //    desync from the still-painted sun-shader uniforms when a hotkey jump
  //    lands on a stage that shares the same vibeIdx and has no override.
  state._l4CenterAnchor    = 0;
  state._l5CenterAnchor    = 0;
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
    // Per-stage hotkeys, by NAME (survives DR_SEQUENCE reordering)
    // 1=S1_CONES  2=S2_CONES_ZIPS  3=S3_L3_CORRIDOR  4=S4_WALLS_RAND
    // 5=S5_WALLS_STRUCT  6=S6_RINGS  7=S7_L4_CORRIDOR  8=S8_FAT_CONES
    // 9=S9_SLALOM  0=S10_ZIPPER
    // Shift+1=S11_L5_CORRIDOR  Shift+2=ENDLESS
    // (Shift+3 retired — plain '3' now jumps to S3 which fires the knife canyon directly)
    const _digitNameMap = {
      '1': 'S1_CONES', '2': 'S2_CONES_ZIPS', '3': 'S3_L3_CORRIDOR',
      '4': 'S4_WALLS_RAND', '5': 'S5_WALLS_STRUCT', '6': 'S6_RINGS',
      '7': 'S7_L4_CORRIDOR', '8': 'S8_FAT_CONES', '9': 'S9_SLALOM',
      '0': 'S10_ZIPPER',
    };
    const _shiftDigitNameMap = {
      '1': 'S11_L5_CORRIDOR', '2': 'ENDLESS',
    };
    const _hotkeyJumpByName = (stageName) => {
      const idx = DR_SEQUENCE.findIndex(s => s.name === stageName);
      if (idx < 0) { console.warn('[SEQ-DEBUG] Stage not found: ' + stageName); return; }
      const s = DR_SEQUENCE[idx];
      clearAllCorridorFlags();
      _drFullStateWipe();
      state.deathRunRestBeat = 0;
      state.seqStageIdx = idx; state.seqStageElapsed = 0;
      state._seqCorridorStarted = false; state._seqSpawnMode = 'cones'; state._seqConeDensity = 'normal';
      state._seqVibeApplied = -1; state._restBeepFired = false;
      state.speed = BASE_SPEED * s.speed;
      // Fire music transition based on the most-recent musicTrack at or before this index
      let _t = null;
      for (let i = 0; i <= idx; i++) {
        if (DR_SEQUENCE[i].musicTrack) _t = DR_SEQUENCE[i].musicTrack;
      }
      if (_t) {
        const _fadeMs = (_t === 'l4') ? 2000 : 2000;
        musicFadeTo(_t, _fadeMs);
      }
      console.log('[SEQ-DEBUG] Jump to stage ' + idx + ': ' + s.name);
    };
    if (e.shiftKey && _shiftDigitNameMap[_digit]) {
      if (_shiftDigitNameMap[_digit] === 'ENDLESS') {
        state.drPhase = 'RELEASE'; state.drPhaseTimer = 0; state.drPhaseDuration = 2;
      }
      _hotkeyJumpByName(_shiftDigitNameMap[_digit]);
    } else if (!e.shiftKey && _digitNameMap[_digit]) {
      _hotkeyJumpByName(_digitNameMap[_digit]);
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

