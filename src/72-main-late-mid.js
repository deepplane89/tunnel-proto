// Set DEBUG_LAT=true to re-enable lateral-spawn diagnostic logs (LAT_DIAG,
// LAT_FIRE, LT_LAT_DIAG, LT_LAT_FIRE). Off in production.
const DEBUG_LAT = false;

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
    // Mark interrupted so resume paths know to rewire MediaElementSource graph
    // (iOS Safari severs music routing on background; SFX still work because
    // they create fresh BufferSourceNodes per call).
    if (typeof _markAudioInterrupted === 'function') _markAudioInterrupted();
    // If actively playing, trigger a proper game pause
    if (state.phase === 'playing') {
      togglePause();
    }
  } else {
    // Tab/app regained focus — resume AudioContext so sounds work again
    // 'interrupted' is iOS-specific (phone call, Bluetooth route change)
    if (audioCtx && (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted')) {
      audioCtx.resume().catch(() => {});
    }
    // Belt: rewire music graph immediately if we just came back from interruption.
    // Safari sometimes keeps the context running but with severed media routing.
    if (typeof _wasAudioInterrupted === 'function' && _wasAudioInterrupted() &&
        typeof _rewireTrackGains === 'function') {
      _rewireTrackGains();
    }
    // Suspenders: if context still isn't running, install a one-shot gesture
    // listener that finishes the resume + rewire after the next user tap.
    // iOS frequently requires a user gesture to actually resume even after
    // visibility returns.
    if (audioCtx && audioCtx.state !== 'running') {
      const _retryAudio = () => {
        if (audioCtx && audioCtx.state !== 'running') {
          audioCtx.resume().catch(() => {});
        }
        if (typeof _rewireTrackGains === 'function') _rewireTrackGains();
      };
      ['touchstart','click','keydown'].forEach(evt => {
        document.addEventListener(evt, _retryAudio, { once: true, passive: true });
      });
    }
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
  // Skip applyDefaults while the showroom is open — it shares titleScene's
  // ship pivot/rotation, and applyDefaults overwriting them on every iOS
  // rotation event causes the showroom ship preview to misframe.
  window.addEventListener('resize', () => {
    if (document.body.classList.contains('sr-open')) return;
    applyDefaults();
  });

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

    // ── Cone Thruster (moved up into THRUSTERS section for visibility) ──
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
    if (ct) {
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
    } else {
      panel.appendChild(document.createTextNode('(window._coneThruster not initialized)'));
    }

    // ── Heat Haze ──
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


  // ── Lateral camp punish — asteroid spawner that targets sides of ship.
  // Manually toggled via window._lateralPunishEnabled.
  if (T.lateralEnabled && window._lateralPunishEnabled) {
    T._lateralTimer -= dt;
    if (T._lateralTimer <= 0) {
      T._lateralTimer = T.lateralFreq * (0.7 + Math.random() * 0.6);
      const side = Math.random() < 0.5 ? 1 : -1;
      const offset = T.lateralMinOff + Math.random() * (T.lateralMaxOff - T.lateralMinOff);
      const sx = (state && state.shipX) || 0;
      const spawnX = sx + side * offset;
      if (window._perfDiag) window._perfDiag.tag('lateral_ast');
      _spawnAsteroid(spawnX);
    }
  }

  if (!T.enabled) return;
  if (_noSpawnMode && !_chaosMode) return;
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
  if (T.fillerEnabled && window._lateralPunishEnabled) {
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
// Expose for run-reset paths (startGame / returnToTitle / canyon teardown).
// _updateAsteroids ticks every frame regardless of state.phase, so an in-flight
// asteroid storm would otherwise keep falling and trigger landing FX on the
// title / gameover screen if the player dies mid-storm.
window._clearAllAsteroids = _clearAllAsteroids;

// ── THRUSTER INVENTORY: top-level apply (used by startGame + title preview) ──
// Writes the equipped preset's window globals + nozzle offsets + particle
// material sizes, then applies the equipped cosmetic color on top. Mirrors
// the closure-scoped _writeThrValues / _applyThrPreset in the G-key tuner
// but is callable globally (and is reused by the title thruster panel for
// live preview).
//
// This is the run-start hook: 67-main-late.js startGame() calls
// window._applyEquippedThruster() right after applySkin(), then sets
// window._thrusterColorLocked = true.
(function _installThrusterApply(){
  function _writeThrPresetValues(P) {
    if (!P) return;
    Object.keys(P).forEach(k => {
      if (k === 'label') return;
      const v = P[k];
      if (v == null) return;
      try {
        if (k === '_pointMatSize') {
          thrusterSystems.forEach(s => s.points.material.size = v);
        } else if (k === '_miniPointMatSize') {
          miniThrusterSystems.forEach(s => s.points.material.size = v);
        } else if (k === 'nozL' || k === 'nozR') {
          if (typeof NOZZLE_OFFSETS !== 'undefined' && NOZZLE_OFFSETS[0]) {
            const t = (k === 'nozL') ? NOZZLE_OFFSETS[0] : NOZZLE_OFFSETS[1];
            t.set(v[0], v[1], v[2]);
          }
        } else if (k === 'miniL' || k === 'miniR') {
          if (typeof MINI_NOZZLE_OFFSETS !== 'undefined' && MINI_NOZZLE_OFFSETS[0]) {
            const t = (k === 'miniL') ? MINI_NOZZLE_OFFSETS[0] : MINI_NOZZLE_OFFSETS[1];
            t.set(v[0], v[1], v[2]);
          }
        } else if (k.charAt(0) === '_') {
          window[k] = v;
        }
      } catch(_){}
    });
    try { if (typeof _rebuildLocalNozzles === 'function') _rebuildLocalNozzles(); } catch(_){}
  }

  // Apply a preset by key. 'baseline' may be runtime-captured null on a fresh
  // load before the dev tuner has been opened — in that case the live values
  // are already the baseline so the no-op is safe.
  window._applyThrusterPresetByKey = function(key) {
    const P = (window._THRUSTER_PRESETS || {})[key];
    if (!P) return false;
    _writeThrPresetValues(P);
    window._activeThrusterPreset = key;
    return true;
  };

  // Apply an equipped cosmetic color override. 'default' (or unknown key) is
  // a no-op — thruster keeps whatever color the preset/scene set. Caller is
  // responsible for setting the lock flag afterward (startGame does this).
  window._applyThrusterColorByKey = function(key) {
    const palette = window._THRUSTER_COLOR_PALETTE || {};
    const entry = palette[key];
    if (!entry || entry.hex == null) return false;
    try {
      // updateThrusterColor honors the lock flag, so we bypass it by writing
      // thrusterColor directly. (thrusterColor is module-scope from
      // 20-main-early.js; in the concatenated bundle it's reachable here.)
      const wasLocked = window._thrusterColorLocked;
      window._thrusterColorLocked = false;
      if (typeof updateThrusterColor === 'function') {
        updateThrusterColor(new THREE.Color(entry.hex));
      } else if (typeof thrusterColor !== 'undefined' && thrusterColor && thrusterColor.set) {
        thrusterColor.set(entry.hex);
      }
      window._thrusterColorLocked = wasLocked;
      return true;
    } catch(_) { return false; }
  };

  // One-shot: read storage, apply preset, then color. Used at run start and
  // by the title panel after equip changes.
  window._applyEquippedThruster = function() {
    if (typeof loadThrusterData !== 'function') return;
    const d = loadThrusterData();
    window._applyThrusterPresetByKey(d.selectedPreset || 'baseline');
    window._applyThrusterColorByKey(d.selectedColor || 'default');
  };
})();

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
    // Run during tutorial gameplay, chaos mode, OR L3 knife canyon (main mode).
    if (state.phase === 'playing' && !state.introActive &&
        (state._tutorialActive || _chaosMode || state.l3KnifeCanyon)) {
      // Corridor takes over — pause all JL obstacle spawning during breather
      // _canyonMode > 0 means slab canyon is active — never use old L3/L4 corridor ticker
      if (_jlCorridor.active && !_canyonActive && !_canyonMode) {
        _jlTickCorridor(dt, state.speed);
      } else if (!_jlCorridor.active && !state.l3KnifeCanyon) {
        // Run asteroid spawner when no pure corridor is active
        // (open canyon segments have _canyonActive=true but _jlCorridor.active=false — still spawn)
        // Skip during L3 knife canyon — it's a pure visual corridor, no asteroids.
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
  // Expose for window._exportScene() — mirrors live tuner state after Y edits
  window._asteroidTuner = _asteroidTuner;
})();


// ═══════════════════════════════════════════════════════════════════════════════
//  MANUAL LATERAL PUNISH
//  window._lateralPunishEnabled = true → enables asteroid + lightning lateral
//  spawners (predictive bolts/asteroids that punish edge camping).
//  Off by default; enable via dev console when needed.
// ═══════════════════════════════════════════════════════════════════════════════
window._lateralPunishEnabled = false;

function startJetLightning() {
  // JL mode removed. No-op stub for stale callers from cached HTML.
  if (typeof console !== 'undefined') console.warn('startJetLightning: JL mode removed');
}
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
  // L4 recreation takes precedence — if user's L4 canyon is active, do NOT let
  // JL sequencer start/replace its own canyon. Prevents the "canyon ends + new one
  // spawns in distance" symptom when K-mode is used during JL playback.
  if (_canyonTuner._l4Recreation) return;
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
  // Same L4 guard as _jlCanyonStart
  if (_canyonTuner._l4Recreation) return;
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
  // L4 guard: user's L4 canyon persists across all JL canyon track boundaries.
  // Only K-press (67-main-late.js handler) can tear it down.
  if (_canyonTuner._l4Recreation) return;
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

// startGame override: tutorial + campaign/DR physics defaults.
const _origStartGame_JL = startGame;
startGame = function() {
  if (state._tutorialActive) {
    // Tutorial uses JL_v1 physics as baseline
    const _tp = _PHYSICS_PRESETS['JL_v1'];
    _accelBase     = _tp.accelBase;
    _accelSnap     = _tp.accelSnap;
    _maxVelBase    = _tp.maxVelBase;
    _maxVelSnap    = _tp.maxVelSnap;
    _bankMax       = _tp.bankMax;
    _steerBankRadMax = 0.52;  // ~30° — JET preset default for tutorial
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
    _steerBankRadMax = 0.52;  // ~30° — JET preset default for campaign
  }
  _origStartGame_JL.apply(this, arguments);
  // After startGame resets speed to BASE_SPEED, bump tutorial to L4
  if (state._tutorialActive) {
    _setDRSpeed(BASE_SPEED * LEVELS[3].speedMult, 'JL'); // L4 = 1.5x
    state.currentLevelIdx = 3;
    currentLevelDef = LEVELS[3];
    targetLevelDef  = LEVELS[3];
  }
};

// Expose for title button
window.startJetLightning = startJetLightning;

// Debug probe for stress testing (read internal asteroid/lightning state).
// JL ramp/sequencer accessors removed; only obstacle pool inspectors remain.
window._jlDebug = {
  get phase()             { return state.phase; },
  get score()             { return state.score; },
  get levelIdx()          { return state.currentLevelIdx; },
  get speed()             { return state.speed; },
  get shipX()             { return state.shipX; },
  set shipX(v)            { state.shipX = v; },
  get noSpawnMode()       { return _noSpawnMode; },
  get astEnabled()        { return _asteroidTuner.enabled; },
  get astPattern()        { return _asteroidTuner.pattern; },
  get astFreq()           { return _asteroidTuner.frequency; },
  get astLeadFactor()     { return _asteroidTuner.leadFactor; },
  get astStaggerDual()    { return _asteroidTuner.staggerDual; },
  get activeAsteroids()   { return _asteroidActive.length; },
  get activeObstacles()   { return activeObstacles.length; },
  snapshot() {
    return {
      phase:           state.phase,
      score:           state.score,
      levelIdx:        state.currentLevelIdx,
      speed:           Math.round(state.speed),
      noSpawnMode:     _noSpawnMode,
      astEnabled:      _asteroidTuner.enabled,
      astPattern:      _asteroidTuner.pattern,
      astFreq:         +_asteroidTuner.frequency.toFixed(2),
      astLeadFactor:   _asteroidTuner.leadFactor,
      astStaggerDual:  _asteroidTuner.staggerDual,
      ltEnabled:       window._LT && window._LT.enabled,
      ltFreq:          window._LT ? +window._LT.frequency.toFixed(2) : 0,
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
  let _ltSpawnCounter = 0;  // every 3rd auto-spawn uses leadFactor=1.0 (punisher)
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

  // Exposed for _exportScene() — captures pattern-button loop state, which
  // fires bolts independently of _LT.enabled (the master toggle).
  window._ltLoopState = function() {
    return {
      loopActive: !!_ltLoopActive,
      activePattern: (_ltActiveBtn && _ltActiveBtn.textContent) ? _ltActiveBtn.textContent.trim() : null,
    };
  };

  // Pattern-loop registry — programmatic access to the L-panel pattern
  // ticks. Used by deathrun pre-T4A canyon to fire RANDOM lightning without
  // requiring the L panel to be open.
  const _LT_PATTERN_REGISTRY = {};
  function _registerLtPattern(name, tick) { _LT_PATTERN_REGISTRY[name] = tick; }
  window._startLtPattern = function(name) {
    const tick = _LT_PATTERN_REGISTRY[name];
    if (!tick) { console.warn('[LT] unknown pattern:', name, 'available:', Object.keys(_LT_PATTERN_REGISTRY)); return false; }
    _startLtLoop(null, '#6af', tick);
    return true;
  };
  window._stopLtPattern = function() { _stopLtLoop(); };

  // Pattern definitions — shared between L panel and programmatic dispatch.
  // Forward-declared; populated below _ltSweepX/_ltSweepDir so closures can
  // capture them. Panel build() and the registry both dereference at call
  // time, so the late assignment is fine.
  let _LT_PANEL_PATTERNS = [];

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

  // Populate the shared pattern list now that all closures (_LT, _ltSweepX,
  // _ltSweepDir, _ltNextTargetX, _spawnLightning) are in scope. Mirrors the
  // L panel's old inline definition exactly.
  _LT_PANEL_PATTERNS = [
    {label:'↯ RANDOM (loop)', short:'random', color:'#6af', tick:()=>{ for(let c=0;c<Math.max(1,_LT.count);c++) setTimeout(()=>{ if(state.phase==='playing') _spawnLightning(_ltNextTargetX()); },c*120); }},
    {label:'►◄ SWEEP (loop)',  short:'sweep',  color:'#0df', tick:()=>{ const range=_LT.laneMax-_LT.laneMin,swOff=(_ltSweepX-0.5)*range; _ltSweepX+=_ltSweepDir*_LT.sweepSpeed*0.35; if(_ltSweepX>=1||_ltSweepX<=0){_ltSweepDir*=-1;_ltSweepX=Math.max(0,Math.min(1,_ltSweepX));} const n=Math.max(2,_LT.salvoCount); for(let i=0;i<n;i++) setTimeout(()=>{ if(state.phase==='playing') _spawnLightning(state.shipX+swOff+(i/(n-1)-0.5)*range*0.5); },i*250); }},
    {label:'▼ ▼▼ STAGGER (loop)', short:'stagger', color:'#ff0', tick:()=>{ if(state.phase==='playing') _spawnLightning(state.shipX); }},
    {label:'▼▼▼ SALVO (loop)',   short:'salvo',   color:'#f80', tick:()=>{ const sx=state.shipX,n=Math.max(1,_LT.salvoCount),half=(_LT.laneMax-_LT.laneMin)*0.45; for(let si=0;si<n;si++) _spawnLightning(sx+(n===1?0:(si/(n-1)-0.5))*half*2); }},
    {label:'▷◁ PINCH (loop)',     short:'pinch',   color:'#f0f', tick:()=>{ const sx=state.shipX,pairs=5,fh=(_LT.laneMax-_LT.laneMin)*0.5*_LT.pinchSpread; for(let pi=0;pi<pairs;pi++){ const hs=Math.max(0.3,fh*(1-pi/(pairs-1))),d=pi*300; (function(s,dl){const fn=()=>{ if(state.phase!=='playing')return; _spawnLightning(sx-s); _spawnLightning(sx+s); }; dl===0?fn():setTimeout(fn,dl);})(hs,d); } setTimeout(()=>{ if(state.phase==='playing') _spawnLightning(sx); },pairs*300); }},
  ];
  // Register both by short name and full label so callers can use either.
  _LT_PANEL_PATTERNS.forEach(p => { _registerLtPattern(p.short, p.tick); _registerLtPattern(p.label, p.tick); });

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

  // ── Lightning bolt object pool ────────────────────────────────────────────
  // Pre-allocates N slots with all meshes/materials/geometries built once and
  // added to scene once. _spawnLightning acquires a free slot and resets it;
  // _ltKill hides it and marks it free. Tube geometries are still rebuilt by
  // _ltRejag (preserves visual flicker — that's the whole point of the rejag).
  // Sized for SALVO=9 + PINCH=10 + auto + lateral + linger overlap with margin.
  const _LT_POOL_SIZE = 32;
  const _ltPool = [];
  let _ltPoolReady = false;
  // Exposed on window so the global prewarm pass (end of file) can force-init
  // the pool at startup instead of letting the first lightning strike pay the
  // shader-compile cost mid-gameplay.
  function _ltInitPool() {
    if (_ltPoolReady) return;
    for (let i = 0; i < _LT_POOL_SIZE; i++) {
      // Warning disc
      const warnGeo  = new THREE.CircleGeometry(_LT.warnRadius, 32);
      const warnMat  = new THREE.MeshBasicMaterial({ color:_LT.warnColor, transparent:true, opacity:0.6, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
      const warnMesh = new THREE.Mesh(warnGeo, warnMat);
      warnMesh.rotation.x = -Math.PI/2;
      warnMesh.visible = false;
      scene.add(warnMesh);

      // Ground flash sprite
      const flashMat = new THREE.SpriteMaterial({ color:_LT.flashColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending });
      const flash    = new THREE.Sprite(flashMat);
      flash.scale.set(10, 10, 1);
      flash.visible = false;
      scene.add(flash);

      // Shockwave ring
      const ringGeo  = new THREE.RingGeometry(0.1, 0.5, 48);
      const ringMat  = new THREE.MeshBasicMaterial({ color:_LT.glowColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
      const ring     = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI/2;
      ring.visible = false;
      scene.add(ring);

      // Bolt group with placeholder tube geos (rebuilt every spawn via _ltRejag)
      const boltGroup = new THREE.Group();
      const coreMat   = new THREE.MeshBasicMaterial({ color:_LT.coreColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending });
      const glowMat   = new THREE.MeshBasicMaterial({ color:_LT.glowColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
      const coreGeo   = _ltBoltGeo(_LT.skyHeight, 0, _LT.segments, _LT.jaggedness,       _LT.coreRadius);
      const glowGeo   = _ltBoltGeo(_LT.skyHeight, 0, _LT.segments, _LT.jaggedness * 1.4, _LT.glowRadius);
      const coreMesh  = new THREE.Mesh(coreGeo, coreMat);
      const glowMesh  = new THREE.Mesh(glowGeo, glowMat);
      boltGroup.add(coreMesh); boltGroup.add(glowMesh);
      boltGroup.visible = false;
      scene.add(boltGroup);

      _ltPool.push({
        _active: false,
        // Pose / lifecycle (mutated each spawn)
        landX: 0, landZ: 0, strikePosZ: 0,
        phase: 'warn', elapsed: 0, strikeElapsed: 0, lingerElapsed: 0,
        ringScale: 0.3, hitChecked: false,
        _coreRadius: _LT.coreRadius, _glowRadius: _LT.glowRadius,
        // Mesh/mat/geo handles (persistent — never disposed except via _ltDestroyPool)
        warnMesh, warnGeo, warnMat,
        flash, flashMat,
        ring, ringGeo, ringMat,
        boltGroup, coreMesh, coreGeo, coreMat,
        glowMesh, glowGeo, glowMat,
      });
    }
    _ltPoolReady = true;
  }
  // Expose so global prewarm can call it once at startup
  window._ltInitPool = _ltInitPool;
  function _ltAcquire() {
    if (!_ltPoolReady) _ltInitPool();
    for (let i = 0; i < _ltPool.length; i++) {
      if (!_ltPool[i]._active) { _ltPool[i]._active = true; return _ltPool[i]; }
    }
    return null; // pool exhausted — caller bails out, dropped bolt
  }

  // ── Spawn one lightning bolt ──────────────────────────────────────────────
  // Everything spawns at a Z offset ahead of the ship.
  // Warning disc pulses for warningTime seconds, then bolt slams and lingers.
  // After the strike the bolt is a planted world-space column — ship flies past it.
  function _spawnLightning(targetX, landZOverride, skipWarn, radiiOverride, leadOverride) {
    if (window._perfDiag) window._perfDiag.tag('lightning_spawn');
    const shipZ  = _shipZ();
    // landZOverride lets callers (e.g. lateral) spawn at a custom Z without touching _LT.spawnZ
    const landZ  = (landZOverride !== undefined) ? landZOverride : (shipZ + _LT.spawnZ);
    const velX   = (state && state.shipVelX) || 0;
    const travelTime = Math.abs(_LT.spawnZ) / Math.max(1, state.speed || 73);
    // When a caller passes landZOverride (lateral), they've already computed the
    // final world X. Re-applying _LT.leadFactor here would double-dip and pull
    // bolts back toward ship's predicted path — turning lateral bolts medial.
    // leadOverride: per-bolt leadFactor (e.g. 1.0 for periodic punisher shots)
    const _lead  = (leadOverride != null) ? leadOverride : _LT.leadFactor;
    const landX  = (landZOverride !== undefined)
      ? targetX
      : targetX + velX * travelTime * _lead;
    // radiiOverride: { coreRadius, glowRadius } to override _LT defaults for this instance
    const _core  = (radiiOverride && radiiOverride.coreRadius != null) ? radiiOverride.coreRadius : _LT.coreRadius;
    const _glow  = (radiiOverride && radiiOverride.glowRadius != null) ? radiiOverride.glowRadius : _LT.glowRadius;

    // Acquire pooled slot — all meshes/mats/geos pre-built, just reset state
    const inst = _ltAcquire();
    if (!inst) return; // pool exhausted (>32 concurrent bolts) — drop this spawn

    inst.landX = landX;
    inst.landZ = landZ;
    inst.strikePosZ = landZ;
    inst.phase = 'warn';
    inst.elapsed = 0;
    inst.strikeElapsed = 0;
    inst.lingerElapsed = 0;
    inst.ringScale = 0.3;
    inst.hitChecked = false;
    inst._coreRadius = _core;
    inst._glowRadius = _glow;

    // Warning disc — reset opacity, scale, position, show
    inst.warnMesh.position.set(landX, 0.08, landZ);
    inst.warnMesh.scale.set(1, 1, 1);
    inst.warnMat.opacity = 0.6;
    inst.warnMesh.visible = true;

    // Ground flash — reset opacity, position, show
    inst.flash.position.set(landX, 1.5, landZ);
    inst.flashMat.opacity = 0;
    inst.flash.visible = true;

    // Shockwave ring — reset opacity, scale, position, show
    inst.ring.position.set(landX, 0.1, landZ);
    inst.ring.scale.set(0.3, 0.3, 1);
    inst.ringMat.opacity = 0;
    inst.ring.visible = true;

    // Bolt group — reset Z, opacities, rebuild tubes for this landX/radii (rejag preserves flicker)
    inst.boltGroup.position.set(0, 0, landZ);
    inst.coreMat.opacity = 0;
    inst.glowMat.opacity = 0;
    inst.boltGroup.visible = true;
    _ltRejag(inst);

    // skipWarn: bolt pops in pre-struck at landZ (no warn disc, no flash, no ring).
    // Ship sees a planted column drifting in from distance — the bolt IS the warning.
    // Used for lateral bolts where a warn disc would reveal the ambush too early.
    if (skipWarn) {
      inst.phase             = 'strike';
      inst.strikeElapsed     = 0;
      inst.warnMat.opacity   = 0;
      inst.flashMat.opacity  = 0;
      inst.ringMat.opacity   = 0;
      inst.coreMat.opacity   = 1.0;
      inst.glowMat.opacity   = 0.5;
      _ltRejag(inst);
    }

    _ltActive.push(inst);
  }

  function _ltKill(inst) {
    // Pooled: hide meshes and release slot — no scene.remove, no dispose.
    // Tube geos (coreGeo/glowGeo) stay attached to their meshes; next spawn
    // calls _ltRejag which disposes the old tube and assigns a fresh one.
    inst.warnMesh.visible = false;
    inst.flash.visible    = false;
    inst.ring.visible     = false;
    inst.boltGroup.visible = false;
    inst._active = false;
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
    if (!_LT_LATERAL.enabled) return;
    if (!window._lateralPunishEnabled) return;
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
        // Always one bolt at a time, aimed at ship's current X — no salvo, no batching.
        // Every 3rd bolt fires with leadFactor=1.0 (perfect lead) to punish held lateral.
        _ltSpawnCounter++;
        const punisher = (_ltSpawnCounter % 3 === 0) ? 1.0 : null;
        if (_LT.pattern === 'stagger') {
          _spawnLightning(state.shipX || 0, undefined, false, null, punisher);
        } else {
          _spawnLightning(_ltNextTargetX(), undefined, false, null, punisher);
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
        (state._tutorialActive || _chaosMode || state.preT4ACanyon || state.preT4BCanyon)) {
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
    const pats = _LT_PANEL_PATTERNS;
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
      if (window._sessionLogEvent) _sessionLogEvent('fatCone_spawn', { x: laneX, scaleXZ: FCT.scaleXZ });
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
    if (window._sessionLogEvent) _sessionLogEvent('fatCone_spawn', { x: laneX, scaleXZ: FCT.scaleXZ });
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
      if (window._sessionLogSlider) _sessionLogSlider('fatcone_' + label, v);
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
//  SCENE EXPORT — window._exportScene()
//  Captures live tuner state (canyon + lightning + asteroid) plus runtime flags
//  so a scene tweaked in V / L / Y tuners can be reproduced later.
//  Copies JSON to clipboard + logs to console. Paste the blob to reconstruct.
// ═══════════════════════════════════════════════════════════════════════════════
(function _setupExportScene() {
  // Deep-clone a plain object, silently dropping non-JSON values (functions,
  // THREE refs, DOM nodes, etc). Ensures the clipboard blob is safe to paste.
  function _safeClone(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const t = typeof v;
      if (v === null || t === 'number' || t === 'string' || t === 'boolean') {
        out[k] = v;
      } else if (Array.isArray(v)) {
        // Only keep arrays of primitives — avoids THREE Vector3 etc
        if (v.every(x => x === null || ['number','string','boolean'].includes(typeof x))) {
          out[k] = v.slice();
        }
      }
      // Drop objects/functions/undefined silently.
    }
    return out;
  }

  window._exportScene = function() {
    const canyon = {
      mode:   (typeof _canyonMode !== 'undefined') ? _canyonMode : null,
      active: (typeof _canyonActive !== 'undefined') ? !!_canyonActive : false,
      tuner:  _safeClone(window._canyonTuner),
    };
    const lightning = _safeClone(window._LT);
    // Pattern-button loops fire bolts independently of _LT.enabled, so capture
    // that state too. "Effective on" = master toggle OR a pattern loop running.
    const ltLoop = (typeof window._ltLoopState === 'function') ? window._ltLoopState() : { loopActive:false, activePattern:null };
    lightning.loopActive    = ltLoop.loopActive;
    lightning.activePattern = ltLoop.activePattern;
    lightning.effectiveOn   = !!(lightning.enabled || ltLoop.loopActive);
    const asteroid  = _safeClone(window._asteroidTuner);

    const snap = {
      version: 1,
      timestamp: new Date().toISOString(),
      canyon, lightning, asteroid,
    };
    const json = JSON.stringify(snap, null, 2);

    // Log (readable) + try to copy to clipboard.
    console.log('=== SCENE EXPORT (copy everything between the fences) ===');
    console.log(json);
    console.log('=== END SCENE EXPORT ===');
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(
          () => console.log('✓ scene JSON copied to clipboard'),
          (err) => console.warn('clipboard copy failed:', err && err.message)
        );
        copied = true;
      }
    } catch (e) { /* ignore */ }
    if (!copied) console.log('(clipboard unavailable — copy from log above)');
    return snap;
  };
})();
