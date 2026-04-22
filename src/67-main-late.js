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
      console.log('[L3-ENTRY] knifeEnabled=' + _L3_KNIFE_ENABLED + ' knifeActive=' + !!state.l3KnifeCanyon + ' knifeDone=' + !!state.l3KnifeDone + ' corridorMode=' + !!state.corridorMode + ' isDR=' + !!state.isDeathRun + ' band=' + (band && band.label));
      // NEW: knife-canyon replacement for L3 cone corridor. Fires once per L3
      // entry; _stopL3KnifeCanyon sets l3KnifeDone=true after 40s so the DR
      // sequencer's isActive() returns false and advances to the next stage.
      // Flip _L3_KNIFE_ENABLED to false to restore the legacy cone corridor.
      if (_L3_KNIFE_ENABLED) {
        state.speed = BASE_SPEED * 2.0; // match corridor speed for canyon scroll
        try {
          _startL3KnifeCanyon();
        } catch (e) {
          console.error('[L3-KNIFE] _startL3KnifeCanyon threw:', e);
        }
        return;
      }
      // LEGACY PATH — original L3 dense cone corridor (kept intact for revert).
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
    // DR sequencer polls this to decide when to advance. Knife canyon counts
    // as active until _stopL3KnifeCanyon flips l3KnifeDone=true (after 40s).
    isActive() { return state.corridorMode || (state.l3KnifeCanyon === true); }
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
  // Tear down L3 knife canyon if death happened during it
  if (state.l3KnifeCanyon) _stopL3KnifeCanyon();
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
  // L3 KNIFE CANYON tick — runs the 40s timer + snap oscillator when active.
  // Self-cleans when duration elapses or player leaves L3.
  _updateL3KnifeCanyon(dt);

  // L3 dense corridor (LEGACY cone path — gated off while _L3_KNIFE_ENABLED,
  // because maybeStartGauntlet no longer sets state.corridorMode in that case):
  // spawn wall rows every ~7 world units (ship-relative, cyan tinted)
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
    'border-radius:4px;scrollbar-width:thin;display:none;'
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
    const useL4 = T._l4Recreation;
    ['left','right'].forEach(k => {
      const side = k === 'left' ? -1 : 1;
      _canyonWalls[k].forEach(m => {
        const rowsAhead  = Math.max(0, Math.round((3.9 - m.position.z) / spacing));
        const center     = _canyonPredictCenter(rowsAhead);
        const centerNext = _canyonPredictCenter(rowsAhead + 1);
        const halfX      = (_canyonMode === 5) ? _canyonHalfXAtZ(m.position.z) : _canyonPredictHalfX(rowsAhead);
        if (useL4 && !m.userData.isEntrance) {
          // L4-recreation path: center from L4 sine, no yaw (bending replaces it),
          // and re-bake inner face so halfX/amp/compress slider tweaks take effect live.
          const l4Center = _l4SineAtZ(m.position.z);
          m.userData.bakedX = l4Center + halfX * side;
          m.position.x = m.userData.bakedX;
          m.rotation.y = 0;
          _bakeSlabCurveForL4(m, m.position.z, side, null);
        } else {
          m.userData.bakedX = center + halfX * side;
          m.position.x = m.userData.bakedX;
          m.rotation.y = side * Math.atan(centerNext - center);
        }
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
      } else if (mode === 'live-l4') {
        // L4-recreation live tweak — re-runs pivot placement + inner-face bake
        // on all currently-visible slabs so the slider move is instantly visible.
        // _l4HalfX slider must mirror into halfXOverride (which is what the bake
        // math actually reads via _canyonPredictHalfX) so changes take effect live.
        if (key === '_l4HalfX') T.halfXOverride = T._l4HalfX;
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

    // L4 Recreation sliders — only show when K-mode (L4 flag) is active.
    // These tune the bent-slab corridor live; changes re-bake visible slabs instantly.
    if (_canyonTuner._l4Recreation) {
      hdr('— L4 RECREATION —');
      slider('L4 halfX',       '_l4HalfX',       1,   80, 0.5, 'live-l4');
      slider('L4 amp scale',   '_l4AmpScale',    0,    2, 0.05, 'live-l4');
      slider('L4 row compress','_l4RampCompress',0.1,  4, 0.05, 'live-l4');
      // Slab length needs geo rebuild (slab mesh dimensions baked in).
      slider('L4 slab length', '_l4SlabW',      10,  160,  5,   'geo');
      // Raw halfXOverride override — live apply of _l4HalfX into the active tuner field
      // so the existing wall-spacing pipeline (rebakeAllX) picks it up without a respawn.
    }

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

  // K key — toggle L4-RECREATION canyon (bent-slab mode, experimental).
  // Spawns Canyon Corridor 1 with _l4Recreation flag on — inner wall faces
  // bend to trace L4 corridor sine math. Press K again to stop.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'k' && e.key !== 'K') return;
    if (state.phase !== 'playing') return;
    // If L4-recreation canyon is running, stop it
    if (_canyonTuner._l4Recreation && (_canyonActive || _canyonWalls)) {
      if (_canyonWalls) _destroyCanyonWalls();
      _canyonActive = false;
      _canyonExiting = false;
      _canyonManual = false;
      _jlCorridor.active = false;
      _canyonTuner._l4Recreation = false;
      if (_canyonSavedDirLight !== null && typeof dirLight !== 'undefined' && dirLight) {
        dirLight.intensity = _canyonSavedDirLight;
        _canyonSavedDirLight = null;
      }
      _canyonMode = 0;
      console.log('[L4-RECREATION] OFF');
      if (panelVisible) buildPanel();
      return;
    }
    // Otherwise spawn Canyon Corridor 1 + enable L4 recreation flag.
    // Tear down any other canyon first.
    const vals = _CANYON_PRESETS[1];
    if (!vals) return;
    _canyonMode = 1;
    _canyonTuner._allCyan = false;
    _canyonTuner._allDark = false;
    Object.assign(_canyonTuner, vals);
    // Flag ON AFTER preset apply (presets don't define it, so it stays off otherwise)
    _canyonTuner._l4Recreation = true;
    // L4 "KNIFE ARCHES" preset — user-confirmed settings from in-game tuning session.
    // Produces overlapping jagged arches that form a tight tunnel with L4-style bend.
    // Values below override C1 preset for L4 mode only; JL sequencer canyons untouched
    // because _jlCanyonStart re-Object.assigns the preset dict on entry.
    Object.assign(_canyonTuner, {
      // Geometry
      slabH: 55, slabThick: 60, cols: 5, rows: 6, disp: 2, snap: 1.5,
      // Profile (X offsets per row)
      footX: 26, sweepX: 20, midX: 0, crestX: 0,
      // Materials
      cyanEmi: 2, cyanRgh: 0.65,
      darkCrkCount: 14, darkCrkBright: 1.95, darkRgh: 0.62,
      darkClearcoat: 0.4, darkEmi: 0.9,
      lightIntensity: 1.2,
      // Corridor shape
      entranceThick: 700, entranceSlabs: 3, spawnDepth: -250,
      // Sine curves (non-L4 path — still set to user-confirmed values for consistency)
      sineIntensity: 0.28, sineAmp: 120, sinePeriod: 330, sineSpeed: 1,
      // Live
      scrollSpeed: 1,
      // L4-specific (halfX 21.5 = narrow-ish gap; slabW 40 = long slabs)
      _l4HalfX: 21.5, _l4AmpScale: 1.0, _l4RampCompress: 1.45, _l4SlabW: 40,
    });
    // Mirror L4 tuners into the live fields the bake pipeline reads
    _canyonTuner.halfXOverride = _canyonTuner._l4HalfX;
    _canyonTuner.slabW         = _canyonTuner._l4SlabW;
    _canyonSinePhase = 0;
    _l4RowsElapsed = 0;
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
    console.log('[L4-RECREATION] ON — flag=true, mode=1, rampCompress=' + _canyonTuner._l4RampCompress + ', ampScale=' + _canyonTuner._l4AmpScale);
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

