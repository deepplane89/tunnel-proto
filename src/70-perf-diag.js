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

