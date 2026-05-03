// ─────────────────────────────────────────────────────────────────────────
// SHIP GARAGE / SHOWROOM (Path A — reuses live title scene)
//
// Layers a sci-fi UI panel over the existing title canvas. The title scene
// already has a cloned ship + studio lighting + spinGroup for rotation, so
// the "showroom" is literally the title preview seen through a docked panel.
//
// Public API (exposed as window.Showroom):
//   open(tab)    — show panel, populate dropdowns, reframe camera
//   close()      — hide panel, restore camera
//   refresh()    — re-read storage and rebuild dropdowns (e.g. after admin unlock)
//
// Coupling:
//   Reads:   SHIP_SKINS, _THRUSTER_PRESETS, _THRUSTER_COLOR_PALETTE,
//            loadSkinData, loadThrusterData, isSkinUnlocked, _skinAdminMode,
//            MISSION_LADDER, titleCamera, titleScene
//   Writes:  saveSkinData (via navigateToSkin), saveThrusterData
//   Calls:   navigateToSkin(idx), _applyEquippedThruster(),
//            _applyThrusterPresetByKey, _applyThrusterColorByKey, playTitleTap
// ─────────────────────────────────────────────────────────────────────────

(function _installShowroom() {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────
  let _open = false;
  let _activeTab = 'thrusters';
  let _wired = false;
  let _resizeBound = false;
  // Saved canvas placement so we can restore on close.
  let _canvasSaved = null; // { parent, nextSibling, w, h, transform, dpr, camAspect, rendererW, rendererH }

  // ── Showroom-only thruster preview (independent of gameplay systems) ──
  // Lifted from updateThrusters() in 20-main-early.js. Same particle spawn
  // rules + bloom sprite, but with fixed 'speed' and the title ship's nozzle
  // world position. Reads _THRUSTER_PRESETS knobs (window.*) so changing the
  // SHAPE dropdown re-tunes immediately. Reads _THRUSTER_COLOR_PALETTE for
  // COLOR. Lives entirely in titleScene; gameplay scene is untouched.
  const SR_PARTICLE_COUNT = 80; // per pod (gameplay uses 160; this is a stationary preview)
  let _thr = null; // { points[2], geo[2], pos[2], col[2], sz[2], vel[2][], age[2], life[2], bloom[2], color }
  // Showroom-side base values (mirrors of gameplay defaults at the call site).
  // Used so showroom particles look right even before any preset is applied.
  const SR_DEFAULTS = {
    posPinFrac: 0.12, lifeMin: 0.18, lifeJit: 0.22, lifeBase: 0.6, lifeSpd: 0.9, spawnJit: 0.03,
    coreEnd: 0.10, coreR: 1.00, coreGB: 0.85, midEnd: 0.65, midBoost: 0.30,
    sizeBase: 0.22, sizeSpeed: 0.10, bumpMult: 1.60, bumpEnd: 0.10, sizeJitter: 0.06,
    bloomScale: 0.4, bloomOpacity: 0.18, bloomWhiteMix: 0.0, bloomPulse: 0.15,
    partOpacity: 1.0,
  };
  // Fixed per-frame inputs for the preview (no real ship physics):
  // - speedScale 1.0 (cruise speed, normal preset look)
  // - thrusterPower 1.0 (full power)
  // - shipVelX 0 (no lateral motion → no trail bend)
  const SR_SPEED_SCALE = 1.0;
  const SR_TP = 1.0;

  // ── Mission-ladder unlock requirement cache (M3, M7, ...) ────────────
  let _unlockReqCache = null;
  function _getUnlockReqs() {
    if (_unlockReqCache) return _unlockReqCache;
    const presets = {}, colors = {}, skins = {};
    let missionCount = 0;
    if (typeof MISSION_LADDER !== 'undefined' && Array.isArray(MISSION_LADDER)) {
      for (let i = 0; i < MISSION_LADDER.length; i++) {
        const r = MISSION_LADDER[i];
        if (r.type === 'mission') { missionCount++; continue; }
        if (r.type !== 'reward' || !r.reward) continue;
        if (r.reward.kind === 'thruster' && r.reward.presetKey) {
          presets[r.reward.presetKey] = missionCount;
        } else if (r.reward.kind === 'thrustercolor' && r.reward.colorKey) {
          colors[r.reward.colorKey] = missionCount;
        } else if (r.reward.kind === 'skin' && typeof r.reward.skinIdx === 'number') {
          skins[r.reward.skinIdx] = missionCount;
        }
      }
    }
    _unlockReqCache = { presets, colors, skins };
    return _unlockReqCache;
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  function _adminAll() {
    return (typeof _skinAdminMode !== 'undefined') && _skinAdminMode;
  }

  function _isPresetUnlocked(key) {
    if (key === 'baseline' || _adminAll()) return true;
    try {
      const td = loadThrusterData();
      return td.unlockedPresets.includes(key);
    } catch(_) { return false; }
  }
  function _isColorUnlocked(key) {
    if (key === 'default' || _adminAll()) return true;
    try {
      const td = loadThrusterData();
      return td.unlockedColors.includes(key);
    } catch(_) { return false; }
  }
  function _isSkinUnlockedSafe(idx) {
    if (idx === 0 || _adminAll()) return true;
    try {
      if (typeof isSkinUnlocked === 'function') return isSkinUnlocked(idx);
    } catch(_){}
    return false;
  }

  // ── Build dropdown <option>s ─────────────────────────────────────────
  function _buildSkinOptions(sel) {
    if (!sel) return;
    sel.innerHTML = '';
    if (typeof SHIP_SKINS === 'undefined') return;
    const reqs = _getUnlockReqs();
    let selectedIdx = 0;
    try { selectedIdx = (loadSkinData() || {}).selected || 0; } catch(_){}
    SHIP_SKINS.forEach((skin, idx) => {
      if (skin.hidden) return;
      const unlocked = _isSkinUnlockedSafe(idx);
      const opt = document.createElement('option');
      opt.value = String(idx);
      let label = (skin.name || ('SKIN ' + idx));
      if (!unlocked) {
        const m = reqs.skins[idx];
        const tag = (m ? ('M' + m) : (skin.price ? (skin.price + 'c') : 'LOCKED'));
        label += '  · ' + tag;
        opt.disabled = true;
      }
      opt.textContent = label;
      if (idx === selectedIdx) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function _buildShapeOptions(sel) {
    if (!sel) return;
    sel.innerHTML = '';
    const presets = window._THRUSTER_PRESETS || {};
    const reqs = _getUnlockReqs();
    let selectedKey = 'baseline';
    try { selectedKey = (loadThrusterData() || {}).selectedPreset || 'baseline'; } catch(_){}
    Object.keys(presets).forEach(key => {
      const P = presets[key];
      const unlocked = _isPresetUnlocked(key);
      const opt = document.createElement('option');
      opt.value = key;
      const baseLabel = (P && P.label) ? P.label.toUpperCase() : key.toUpperCase();
      let label = baseLabel;
      if (!unlocked) {
        const m = reqs.presets[key];
        label += '  · ' + (m ? ('M' + m) : 'LOCKED');
        opt.disabled = true;
      }
      opt.textContent = label;
      if (key === selectedKey) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function _buildColorOptions(sel) {
    if (!sel) return;
    sel.innerHTML = '';
    const palette = window._THRUSTER_COLOR_PALETTE || {};
    const reqs = _getUnlockReqs();
    let selectedKey = 'default';
    try { selectedKey = (loadThrusterData() || {}).selectedColor || 'default'; } catch(_){}
    Object.keys(palette).forEach(key => {
      const C = palette[key];
      const unlocked = _isColorUnlocked(key);
      const opt = document.createElement('option');
      opt.value = key;
      const baseLabel = (C && C.label) ? C.label.toUpperCase() : key.toUpperCase();
      let label = baseLabel;
      if (!unlocked) {
        const m = reqs.colors[key];
        label += '  · ' + (m ? ('M' + m) : 'LOCKED');
        opt.disabled = true;
      }
      opt.textContent = label;
      if (key === selectedKey) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function _populateAll() {
    _buildSkinOptions(document.getElementById('sr-select-skin'));
    _buildShapeOptions(document.getElementById('sr-select-shape'));
    _buildColorOptions(document.getElementById('sr-select-color'));
  }

  // ── Wire dropdown change handlers ────────────────────────────────────
  function _onSkinChange(e) {
    const idx = parseInt(e.target.value, 10);
    if (isNaN(idx)) return;
    // Admin mode: pre-mark unlocked so navigateToSkin doesn't bounce back.
    if (_adminAll()) {
      try {
        const d = loadSkinData();
        if (!d.unlocked.includes(idx)) { d.unlocked.push(idx); saveSkinData(d); }
      } catch(_){}
    }
    if (typeof navigateToSkin === 'function') {
      try { navigateToSkin(idx); } catch(_){}
    }
    try { playTitleTap(); } catch(_){}
  }

  function _onShapeChange(e) {
    const key = e.target.value;
    if (!key) return;
    try {
      const d = loadThrusterData();
      if (!d.unlockedPresets.includes(key)) d.unlockedPresets.push(key);
      d.selectedPreset = key;
      saveThrusterData(d);
      if (typeof window._applyEquippedThruster === 'function') window._applyEquippedThruster();
    } catch(_){}
    // Re-sync color (preset apply may have set a new tint) and let the
    // tick loop pick up the new knobs on the next frame.
    _thrSyncColor();
    try { playTitleTap(); } catch(_){}
  }

  function _onColorChange(e) {
    const key = e.target.value;
    if (!key) return;
    try {
      const d = loadThrusterData();
      if (!d.unlockedColors.includes(key)) d.unlockedColors.push(key);
      d.selectedColor = key;
      saveThrusterData(d);
      if (typeof window._applyEquippedThruster === 'function') window._applyEquippedThruster();
    } catch(_){}
    // Sync showroom preview color immediately.
    _thrSyncColor();
    try { playTitleTap(); } catch(_){}
  }

  // ── Tab switching ────────────────────────────────────────────────────
  function _switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.sr-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.sr-pane').forEach(p => {
      p.classList.toggle('sr-hidden', p.dataset.pane !== tab);
    });
  }

  function _onTabClick(e) {
    const t = e.currentTarget;
    if (t.classList.contains('sr-hidden')) return;
    try { playTitleTap(); } catch(_){}
    _switchTab(t.dataset.tab);
  }

  // ── One-time wiring (idempotent) ─────────────────────────────────────
  function _wireOnce() {
    if (_wired) return;
    _wired = true;
    document.querySelectorAll('.sr-tab').forEach(t => {
      t.addEventListener('click', _onTabClick);
    });
    const sSkin  = document.getElementById('sr-select-skin');
    const sShape = document.getElementById('sr-select-shape');
    const sColor = document.getElementById('sr-select-color');
    if (sSkin)  sSkin.addEventListener('change', _onSkinChange);
    if (sShape) sShape.addEventListener('change', _onShapeChange);
    if (sColor) sColor.addEventListener('change', _onColorChange);
  }

  // ── Canvas relocation: detach title-ship-canvas to fullscreen stage ──
  // The render loop in 70-perf-diag.js calls _titleRenderer.render() every
  // frame regardless of canvas position, so just resizing+reparenting the
  // canvas + updating the camera aspect = bigger ship preview, no other code.
  function _relocateCanvasToStage() {
    const canvas = document.getElementById('title-ship-canvas');
    const stage  = document.getElementById('sr-stage');
    if (!canvas || !stage) return;
    if (_canvasSaved) return; // already relocated
    _canvasSaved = {
      parent: canvas.parentNode,
      nextSibling: canvas.nextSibling,
      styleW: canvas.style.width,
      styleH: canvas.style.height,
      styleTransform: canvas.style.transform,
      styleMaxWidth: canvas.style.maxWidth,
      styleMaxHeight: canvas.style.maxHeight,
      camAspect: (typeof titleCamera !== 'undefined' && titleCamera) ? titleCamera.aspect : null,
      rendererW: 0, rendererH: 0,
    };
    // Capture current renderer drawing-buffer size.
    try {
      if (typeof _titleRenderer !== 'undefined' && _titleRenderer) {
        const sz = new THREE.Vector2();
        _titleRenderer.getSize(sz);
        _canvasSaved.rendererW = sz.x;
        _canvasSaved.rendererH = sz.y;
      }
    } catch(_){}
    // Detach + clear inline transform/size so stage CSS controls layout.
    canvas.style.transform = '';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.maxWidth = '';
    canvas.style.maxHeight = '';
    stage.appendChild(canvas);
    _resizeStageCanvas();
    // Override ship pose for showroom: force horizontal (side-profile) tilt
    // in BOTH portrait and landscape so thrusters are visible. The live title
    // screen restores its own pose on close.
    try {
      const pivot = (typeof titleScene !== 'undefined') ? titleScene.getObjectByName('titleShipPivot') : null;
      const tiltGroup = pivot && pivot.children && pivot.children[0];
      if (tiltGroup) {
        _canvasSaved.tiltX = tiltGroup.rotation.x;
        _canvasSaved.tiltY = tiltGroup.rotation.y;
        _canvasSaved.tiltZ = tiltGroup.rotation.z;
        tiltGroup.rotation.x = 0.13;
        tiltGroup.rotation.y = 0;
        tiltGroup.rotation.z = 0;
      }
    } catch(_){}
  }

  function _restoreCanvas() {
    const canvas = document.getElementById('title-ship-canvas');
    if (!canvas || !_canvasSaved) return;
    const s = _canvasSaved;
    canvas.style.width  = s.styleW || '';
    canvas.style.height = s.styleH || '';
    canvas.style.transform = s.styleTransform || '';
    canvas.style.maxWidth = s.styleMaxWidth || '';
    canvas.style.maxHeight = s.styleMaxHeight || '';
    if (s.parent) {
      if (s.nextSibling && s.nextSibling.parentNode === s.parent) {
        s.parent.insertBefore(canvas, s.nextSibling);
      } else {
        s.parent.appendChild(canvas);
      }
    }
    // Restore renderer + camera to their pre-open dimensions.
    try {
      if (typeof _titleRenderer !== 'undefined' && _titleRenderer && s.rendererW && s.rendererH) {
        _titleRenderer.setSize(s.rendererW, s.rendererH, false);
      }
      if (typeof titleCamera !== 'undefined' && titleCamera && s.camAspect) {
        titleCamera.aspect = s.camAspect;
        titleCamera.updateProjectionMatrix();
      }
      // Restore ship pose.
      const pivot = (typeof titleScene !== 'undefined') ? titleScene.getObjectByName('titleShipPivot') : null;
      const tiltGroup = pivot && pivot.children && pivot.children[0];
      if (tiltGroup && typeof s.tiltX === 'number') {
        tiltGroup.rotation.x = s.tiltX;
        tiltGroup.rotation.y = s.tiltY || 0;
        tiltGroup.rotation.z = s.tiltZ || 0;
      }
    } catch(_){}
    _canvasSaved = null;
  }

  // Resize the showroom stage canvas to fit the stage element + update camera.
  function _resizeStageCanvas() {
    const canvas = document.getElementById('title-ship-canvas');
    const stage  = document.getElementById('sr-stage');
    if (!canvas || !stage || !_canvasSaved) return; // only while relocated
    const r = stage.getBoundingClientRect();
    const w = Math.max(64, Math.floor(r.width));
    const h = Math.max(64, Math.floor(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    try {
      if (typeof _titleRenderer !== 'undefined' && _titleRenderer) {
        _titleRenderer.setPixelRatio(dpr);
        _titleRenderer.setSize(w, h, false);
      }
      if (typeof titleCamera !== 'undefined' && titleCamera) {
        titleCamera.aspect = w / h;
        titleCamera.updateProjectionMatrix();
      }
    } catch(_){}
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
  }

  function _onResize() {
    if (!_open) return;
    _resizeStageCanvas();
  }

  // ─── Showroom thruster preview: build, tick, show/hide ─────────────
  // Builds 2 particle systems + 2 bloom sprites in titleScene, mirroring the
  // gameplay particle/bloom code path with showroom-fixed inputs.
  function _makeBloomTex() {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0,   'rgba(255,255,255,1.0)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  // One-shot: ensure window._THRUSTER_PRESETS.baseline holds a real snapshot
  // of the current live values so selecting 'baseline' after another preset
  // actually restores. Mirrors the dev tuner's _captureLiveThrValues but does
  // not require opening the G-key panel.
  function _captureBaselineIfMissing() {
    try {
      const presets = window._THRUSTER_PRESETS || {};
      if (presets.baseline) return;
      const allKeys = new Set();
      Object.values(presets).forEach(p => { if (p) Object.keys(p).forEach(k => allKeys.add(k)); });
      const snap = { label: 'BASELINE' };
      allKeys.forEach(k => {
        if (k === 'label') return;
        if (k === '_pointMatSize') {
          try { if (window.thrusterSystems && window.thrusterSystems[0]) snap[k] = window.thrusterSystems[0].points.material.size; } catch(_){}
        } else if (k === '_miniPointMatSize') {
          try { if (window.miniThrusterSystems && window.miniThrusterSystems[0]) snap[k] = window.miniThrusterSystems[0].points.material.size; } catch(_){}
        } else if (k === 'nozL' || k === 'nozR') {
          if (typeof NOZZLE_OFFSETS !== 'undefined' && NOZZLE_OFFSETS[0]) {
            const v = (k === 'nozL') ? NOZZLE_OFFSETS[0] : NOZZLE_OFFSETS[1];
            snap[k] = [v.x, v.y, v.z];
          }
        } else if (k.charAt(0) === '_') {
          if (window[k] != null) snap[k] = window[k];
        }
      });
      presets.baseline = snap;
    } catch(_){}
  }

  function _thrInit() {
    if (_thr) return;
    if (typeof titleScene === 'undefined' || !titleScene) return;
    if (typeof NOZZLE_OFFSETS === 'undefined' || !NOZZLE_OFFSETS) return;
    _captureBaselineIfMissing();
    const N = SR_PARTICLE_COUNT;
    const points = [], geos = [], poses = [], cols = [], szs = [], vels = [], ages = [], lifes = [], blooms = [];
    const tex = _makeBloomTex();
    for (let p = 0; p < 2; p++) {
      const positions  = new Float32Array(N * 3);
      const colors     = new Float32Array(N * 3);
      const sizes      = new Float32Array(N);
      const velocities = [];
      const age        = new Float32Array(N);
      const life       = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        age[i] = Math.random();
        life[i] = SR_DEFAULTS.lifeMin + Math.random() * SR_DEFAULTS.lifeJit;
        velocities.push(new THREE.Vector3());
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
      geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));
      const mat = new THREE.PointsMaterial({
        size: 0.13,
        map: tex,
        vertexColors: true,
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 10;
      pts.visible = false;
      titleScene.add(pts);

      const bMat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      const bSpr = new THREE.Sprite(bMat);
      bSpr.frustumCulled = false;
      bSpr.renderOrder = 11;
      bSpr.visible = false;
      titleScene.add(bSpr);

      points.push(pts); geos.push(geo); poses.push(positions); cols.push(colors); szs.push(sizes);
      vels.push(velocities); ages.push(age); lifes.push(life); blooms.push(bSpr);
    }
    _thr = {
      points, geos, poses, cols, szs, vels, ages, lifes, blooms,
      color: new THREE.Color(0x66ccff),
      _v: new THREE.Vector3(),
    };
  }

  function _thrShow(visible) {
    if (!_thr) return;
    _thr.points.forEach(p => p.visible = !!visible);
    _thr.blooms.forEach(b => b.visible = !!visible);
  }

  // Read the equipped color from storage and update the cached color.
  function _thrSyncColor() {
    if (!_thr) return;
    let key = 'default';
    try { key = (loadThrusterData() || {}).selectedColor || 'default'; } catch(_){}
    const palette = window._THRUSTER_COLOR_PALETTE || {};
    const entry = palette[key];
    // 'default' (hex null) — use a neutral cyan-white so the preview reads;
    // gameplay's 'default' inherits whatever color the run started with, but
    // for a static showroom we pick a sensible fallback.
    if (!entry || entry.hex == null) {
      _thr.color.setRGB(0.55, 0.85, 1.0);
    } else {
      _thr.color.set(entry.hex);
    }
  }

  // Per-frame tick. Mirrors updateThrusters() particle + bloom logic with
  // showroom-fixed inputs (no shipGroup, no state.speed, no state.shipVelX).
  function _thrTick(dt) {
    if (!_thr || !_open) return;
    // Find the title ship pivot — we transform NOZZLE_OFFSETS through its
    // world matrix to get nozzle world positions every frame (cheap).
    if (typeof titleScene === 'undefined' || !titleScene) return;
    const ship = (typeof _titleShipModel !== 'undefined') ? _titleShipModel : null;
    if (!ship) return;
    ship.updateMatrixWorld(true);

    // Read knobs (preset writes these onto window.* via _writeThrPresetValues)
    const D = SR_DEFAULTS;
    const posPinFrac = (window._thrPart_posPinFrac != null) ? window._thrPart_posPinFrac : D.posPinFrac;
    const lifeMin   = (window._thrPart_lifeMin   != null) ? window._thrPart_lifeMin   : D.lifeMin;
    const lifeJit   = (window._thrPart_lifeJit   != null) ? window._thrPart_lifeJit   : D.lifeJit;
    const lifeBase  = (window._thrPart_lifeBase  != null) ? window._thrPart_lifeBase  : D.lifeBase;
    const lifeSpd   = (window._thrPart_lifeSpd   != null) ? window._thrPart_lifeSpd   : D.lifeSpd;
    const spawnJit  = (window._thrPart_spawnJit  != null) ? window._thrPart_spawnJit  : D.spawnJit;
    const coreEnd   = (window._thrPart_coreEnd   != null) ? window._thrPart_coreEnd   : D.coreEnd;
    const coreR     = (window._thrPart_coreR     != null) ? window._thrPart_coreR     : D.coreR;
    const coreGB    = (window._thrPart_coreGB    != null) ? window._thrPart_coreGB    : D.coreGB;
    const midEnd    = (window._thrPart_midEnd    != null) ? window._thrPart_midEnd    : D.midEnd;
    const midBoost  = (window._thrPart_midBoost  != null) ? window._thrPart_midBoost  : D.midBoost;
    const szBase    = (window._thrPart_sizeBase  != null) ? window._thrPart_sizeBase  : D.sizeBase;
    const szSpeed   = (window._thrPart_sizeSpeed != null) ? window._thrPart_sizeSpeed : D.sizeSpeed;
    const bumpMult  = (window._thrPart_bumpMult  != null) ? window._thrPart_bumpMult  : D.bumpMult;
    const bumpEnd   = (window._thrPart_bumpEnd   != null) ? window._thrPart_bumpEnd   : D.bumpEnd;
    const szJitter  = (window._thrPart_sizeJitter!= null) ? window._thrPart_sizeJitter: D.sizeJitter;
    const partOp    = (window._thrPart_partOpacity != null) ? window._thrPart_partOpacity : D.partOpacity;
    const thrScale  = (window._thrusterScale     != null) ? window._thrusterScale     : 1.0;
    const pointSize = (window._THRUSTER_PRESETS && window._activeThrusterPreset && window._THRUSTER_PRESETS[window._activeThrusterPreset] && window._THRUSTER_PRESETS[window._activeThrusterPreset]._pointMatSize) || 0.13;
    const bloomScl  = (window._nozzleBloomScale  != null) ? window._nozzleBloomScale  : D.bloomScale;
    const bloomOp   = (window._nozzleBloomOpacity!= null) ? window._nozzleBloomOpacity: D.bloomOpacity;
    const bloomWM   = (window._nozzleBloom_whiteMix != null) ? window._nozzleBloom_whiteMix : D.bloomWhiteMix;
    const bloomPul  = (window._nozzleBloomPulse  != null) ? window._nozzleBloomPulse  : D.bloomPulse;

    const tCol = _thr.color;
    const ss = SR_SPEED_SCALE;
    const tp = SR_TP;

    for (let idx = 0; idx < 2; idx++) {
      const sys = {
        positions: _thr.poses[idx], colors: _thr.cols[idx], sizes: _thr.szs[idx],
        velocities: _thr.vels[idx], ages: _thr.ages[idx], lifetimes: _thr.lifes[idx],
      };
      const points = _thr.points[idx];
      const bloom = _thr.blooms[idx];

      // Get nozzle world position via title ship transform.
      // Gameplay applies model.rotation.y = π to the ship (5387 in 20-main-early.js)
      // so its +Z is "back". Title ship has no flip, so we mirror: negate the
      // Z component of NOZZLE_OFFSETS before localToWorld so the nozzle ends up
      // at the back of the title ship (same physical spot).
      _thr._v.set(NOZZLE_OFFSETS[idx].x, NOZZLE_OFFSETS[idx].y, -NOZZLE_OFFSETS[idx].z);
      ship.localToWorld(_thr._v);
      const wx = _thr._v.x, wy = _thr._v.y, wz = _thr._v.z;

      // Particle material: keep size in sync with preset _pointMatSize.
      if (points.material.size !== pointSize) points.material.size = pointSize;
      if (points.material.opacity !== partOp) points.material.opacity = partOp;

      const pos = sys.positions, col = sys.colors, sz = sys.sizes;
      for (let i = 0; i < SR_PARTICLE_COUNT; i++) {
        sys.ages[i] += dt;
        if (sys.ages[i] >= sys.lifetimes[i]) {
          sys.ages[i] = 0;
          sys.lifetimes[i] = (lifeMin + Math.random() * lifeJit) * (lifeBase + ss * lifeSpd);
          pos[i*3]     = wx + (Math.random() - 0.5) * spawnJit;
          pos[i*3 + 1] = wy + (Math.random() - 0.5) * spawnJit;
          pos[i*3 + 2] = wz;
          // No lateral inheritance (showroom ship doesn't move sideways).
          // Velocity points away from the ship's BACK in world space. Title ship
          // has its back facing roughly world -Z (since tiltGroup.rotation.x = 0.13
          // leaves the ship near-horizontal and the GLB's +Z is the front), so
          // we exhaust into world -Z.
          sys.velocities[i].set(
            (Math.random() - 0.5) * 0.06,
            (Math.random() - 0.5) * 0.06 - 0.02,
            -(2.5 + Math.random() * 2.0 + ss * 1.5)
          );
        } else {
          const t0 = sys.ages[i] / sys.lifetimes[i];
          if (t0 < posPinFrac) {
            pos[i*3] = wx; pos[i*3 + 1] = wy; pos[i*3 + 2] = wz;
          } else {
            const v = sys.velocities[i];
            pos[i*3]     += v.x * dt;
            pos[i*3 + 1] += v.y * dt;
            pos[i*3 + 2] += v.z * dt;
            v.multiplyScalar(0.92);
          }
        }
        const t = sys.ages[i] / sys.lifetimes[i];
        // Color curve
        if (t < coreEnd) {
          const s = t / coreEnd;
          col[i*3]     = coreR;
          col[i*3 + 1] = THREE.MathUtils.lerp(coreGB, tCol.g, s);
          col[i*3 + 2] = THREE.MathUtils.lerp(coreGB, tCol.b, s);
        } else if (t < midEnd) {
          const s = (t - coreEnd) / Math.max(0.001, (midEnd - coreEnd));
          const bright = 1.0 + ss * midBoost;
          col[i*3]     = THREE.MathUtils.lerp(tCol.r * bright, tCol.r, s);
          col[i*3 + 1] = THREE.MathUtils.lerp(tCol.g * bright, tCol.g, s);
          col[i*3 + 2] = THREE.MathUtils.lerp(tCol.b * bright, tCol.b, s);
        } else {
          const s = (t - midEnd) / Math.max(0.001, (1.0 - midEnd));
          col[i*3]     = THREE.MathUtils.lerp(tCol.r, 0, s);
          col[i*3 + 1] = THREE.MathUtils.lerp(tCol.g, 0, s);
          col[i*3 + 2] = THREE.MathUtils.lerp(tCol.b, 0, s);
        }
        // Size curve
        const baseSize = szBase + ss * szSpeed;
        const rawSz = t < bumpEnd
          ? THREE.MathUtils.lerp(baseSize * bumpMult, baseSize, t / bumpEnd)
          : (1.0 - t) * (baseSize + Math.random() * szJitter);
        sz[i] = rawSz * tp * thrScale;
      }
      _thr.geos[idx].attributes.position.needsUpdate = true;
      _thr.geos[idx].attributes.color.needsUpdate    = true;
      _thr.geos[idx].attributes.size.needsUpdate     = true;

      // Bloom sprite at nozzle.
      bloom.position.set(wx, wy, wz);
      const bloomSize = (0.6 + ss * 0.7) * thrScale * bloomScl;
      bloom.scale.setScalar(bloomSize);
      bloom.material.color.setRGB(
        THREE.MathUtils.lerp(tCol.r, 1.0, bloomWM),
        THREE.MathUtils.lerp(tCol.g, 1.0, bloomWM),
        THREE.MathUtils.lerp(tCol.b, 1.0, bloomWM)
      );
      bloom.material.opacity = bloomOp * ((1 - bloomPul) + Math.sin(Date.now() * 0.008) * bloomPul) * tp;
    }
  }

  // ── Public: open / close / refresh ───────────────────────────────────
  function open(tab) {
    const overlay = document.getElementById('thruster-overlay');
    if (!overlay) return;
    _wireOnce();
    overlay.classList.remove('hidden');
    document.body.classList.add('sr-open');
    _switchTab(tab || 'thrusters');
    _populateAll();
    // Relocate after the overlay is visible so getBoundingClientRect is right.
    requestAnimationFrame(() => {
      _relocateCanvasToStage();
      if (!_resizeBound) {
        _resizeBound = true;
        window.addEventListener('resize', _onResize);
        window.addEventListener('orientationchange', _onResize);
      }
      // Init thruster preview lazily on first open + show it.
      _thrInit();
      _thrSyncColor();
      _thrShow(true);
    });
    _open = true;
  }

  function close() {
    const overlay = document.getElementById('thruster-overlay');
    _restoreCanvas();
    if (overlay) overlay.classList.add('hidden');
    document.body.classList.remove('sr-open');
    _open = false;
    // Hide preview immediately so it never shows on the live title screen.
    _thrShow(false);
  }

  function refresh() {
    if (!_open) return;
    _unlockReqCache = null; // recompute in case missions changed
    _populateAll();
    _thrSyncColor();
  }

  // Public tick — called from the title-phase render loop in 70-perf-diag.js,
  // which guards by checking window.Showroom?._open before invoking. When the
  // showroom is closed, the body of _thrTick early-returns, so this is free.
  function tick(dt) { _thrTick(dt); }

  // Public color sync — called by _onColorChange so dropdown updates the preview
  // without needing a full open/close cycle.
  function syncColor() { _thrSyncColor(); }

  window.Showroom = {
    open: open, close: close, refresh: refresh,
    tick: tick, syncColor: syncColor,
    isOpen: function() { return _open; },
  };
})();
