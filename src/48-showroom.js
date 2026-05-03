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

  // ── Drag-tuner state (persists to localStorage) ──────────────────────
  // anchors are children of _titleShipModel — their localPosition IS the
  // tuned offset. Drag updates their localPosition; wheel updates scale.
  // 'flip' inverts the exhaust direction (Z velocity sign).
  // Default-Runner bucket keeps the v7 key so your existing tuned values
  // are preserved. Alt-GLB ships get their own bucket: SR_TUNER_KEY +
  // '__' + glbFile (e.g. 'jh_showroom_tuner_v7__spaceship_01.glb').
  const SR_TUNER_KEY = 'jh_showroom_tuner_v7';
  // Z is relative to auto-detected hull back; 0 = visible hull back.
  // pitch/yaw are exhaust direction angles in degrees (0,0 = straight back along -Z).
  // 'sel' picks which group is being dragged: L|R = main, mL|mR = mini.
  const SR_TUNER_DEFAULT = {
    L:  { x: -1.665, y:  0.010, z: 0.0, scale: 2.854, pitch: 0, yaw: 0 },
    R:  { x:  1.665, y:  0.010, z: 0.0, scale: 2.854, pitch: 0, yaw: 0 },
    mL: { x: -0.852, y:  0.032, z: 0.0, scale: 1.5,   pitch: 0, yaw: 0 },
    mR: { x:  0.852, y:  0.032, z: 0.0, scale: 1.5,   pitch: 0, yaw: 0 },
    mirror: true,
    flip: false,
    rotMode: false, // when true, mouse drag rotates the exhaust angle instead of moving position
    selected: 'L',  // 'L' | 'R' | 'mL' | 'mR'
    // Showroom-local fx overrides (do NOT leak to gameplay).
    fx: {
      bloomScale: 0.40,    // 0..2
      bloomOpacity: 0.18,  // 0..1
      partSize: 1.00,      // 0..3 multiplier on point size
      partOpacity: 1.00,   // 0..1
      lifeBase: 0.10,      // 0.1..2 trail length base
      lifeJit: 0.22,       // 0..1 trail length jitter
      miniSize: 0.55,      // 0.1..2 mini-thruster size mult
      miniBloom: 0.50,     // 0..2 mini-thruster bloom mult
    },
    panelOpen: true,
  };
  let _tuner = null;
  // Tracks which ship's bucket _tuner was loaded from — prevents writing
  // MK Runner pod values into the default Runner bucket and vice versa.
  let _tunerLoadedKey = SR_TUNER_KEY;

  // Resolve the storage key for the currently-displayed ship.
  function _currentTunerKey() {
    const ship = (typeof _titleShipModel !== 'undefined') ? _titleShipModel : null;
    const altFile = ship && ship.userData && ship.userData._altGlb;
    return altFile ? (SR_TUNER_KEY + '__' + altFile) : SR_TUNER_KEY;
  }

  function _loadTunerFromKey(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Object.assign({}, SR_TUNER_DEFAULT, parsed, {
          L:  Object.assign({}, SR_TUNER_DEFAULT.L,  parsed.L  || {}),
          R:  Object.assign({}, SR_TUNER_DEFAULT.R,  parsed.R  || {}),
          mL: Object.assign({}, SR_TUNER_DEFAULT.mL, parsed.mL || {}),
          mR: Object.assign({}, SR_TUNER_DEFAULT.mR, parsed.mR || {}),
          fx: Object.assign({}, SR_TUNER_DEFAULT.fx, parsed.fx || {}),
        });
      }
    } catch(_){}
    return JSON.parse(JSON.stringify(SR_TUNER_DEFAULT));
  }

  function _loadTuner() {
    const key = _currentTunerKey();
    _tunerLoadedKey = key;
    return _loadTunerFromKey(key);
  }

  function _saveTuner() {
    if (!_tuner) return;
    try { localStorage.setItem(_tunerLoadedKey, JSON.stringify(_tuner)); } catch(_){}
  }

  // Called from resetThrusterAnchors when the title ship swaps. Persist the
  // outgoing ship's edits, then load the incoming ship's saved values.
  function _swapTunerForCurrentShip() {
    if (_tuner) {
      try { localStorage.setItem(_tunerLoadedKey, JSON.stringify(_tuner)); } catch(_){}
    }
    const key = _currentTunerKey();
    _tunerLoadedKey = key;
    _tuner = _loadTunerFromKey(key);
  }

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
  // Garage-local preview state — separate from the equipped skin saved on the
  // title screen. Lives only in memory so a fresh page load shows the
  // currently-displayed (equipped) ship first.
  let _garagePreviewIdx = null;
  function _equippedSkinIdx() {
    try { return (loadSkinData() || {}).selected || 0; } catch(_) { return 0; }
  }
  // Reverse-lookup: which SHIP_SKINS index matches the ship currently shown
  // on the title canvas? Lets garage open sync the dropdown to the canvas
  // WITHOUT firing a skin swap (which would wipe thruster anchors).
  function _displayedSkinIdx() {
    try {
      const ship = (typeof _titleShipModel !== 'undefined') ? _titleShipModel : null;
      const altFile = ship && ship.userData && ship.userData._altGlb;
      if (typeof SHIP_SKINS !== 'undefined' && Array.isArray(SHIP_SKINS)) {
        for (let i = 0; i < SHIP_SKINS.length; i++) {
          const s = SHIP_SKINS[i];
          if (!s) continue;
          if (altFile) { if (s.glbFile === altFile) return i; }
          else { if (!s.glbFile) return i; }
        }
      }
    } catch(_){}
    return _equippedSkinIdx();
  }
  // Preview a skin in the title-ship canvas WITHOUT touching equipped state.
  function _previewSkin(idx) {
    if (typeof applyTitleSkin === 'function') {
      try { applyTitleSkin(idx); } catch(_){}
    }
  }

  function _buildSkinOptions(sel) {
    if (!sel) return;
    sel.innerHTML = '';
    if (typeof SHIP_SKINS === 'undefined') return;
    const reqs = _getUnlockReqs();
    // Highlight the GARAGE preview, not the equipped skin — they're separate.
    const selectedIdx = (_garagePreviewIdx != null) ? _garagePreviewIdx : _equippedSkinIdx();
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
    // Garage selection is preview-only — do NOT write data.selected. The
    // equipped skin only changes when the player explicitly hits USE on the
    // title screen's skin viewer.
    _garagePreviewIdx = idx;
    _previewSkin(idx);
    // Skin swap may load a new GLB whose materials default to transparent.
    requestAnimationFrame(() => { try { _forceShipOpaque(); } catch(_){} });
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

  // Build one particle+bloom system in titleScene; returns its handle.
  function _buildPodSystem(N, tex, isMini) {
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
      size: isMini ? 0.08 : 0.13,
      map: tex,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      depthTest: true, // z-test against ship hull so additive bloom doesn't blow out the hull
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = isMini ? 12 : 10;
    pts.visible = false;
    titleScene.add(pts);
    const bMat = new THREE.SpriteMaterial({
      map: tex, color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    const bSpr = new THREE.Sprite(bMat);
    bSpr.frustumCulled = false;
    bSpr.renderOrder = isMini ? 13 : 11;
    bSpr.visible = false;
    titleScene.add(bSpr);
    return { points: pts, geo, positions, colors, sizes, velocities, ages: age, lifetimes: life, bloom: bSpr, isMini };
  }

  function _thrInit() {
    if (_thr) return;
    if (typeof titleScene === 'undefined' || !titleScene) return;
    if (typeof NOZZLE_OFFSETS === 'undefined' || !NOZZLE_OFFSETS) return;
    _captureBaselineIfMissing();
    const tex = _makeBloomTex();
    // 4 pod systems: main L, main R, mini L, mini R.
    const NB = SR_PARTICLE_COUNT;
    const NM = Math.max(40, Math.floor(SR_PARTICLE_COUNT * 0.6));
    const groups = {
      L:  _buildPodSystem(NB, tex, false),
      R:  _buildPodSystem(NB, tex, false),
      mL: _buildPodSystem(NM, tex, true),
      mR: _buildPodSystem(NM, tex, true),
    };
    if (!_tuner) _tuner = _loadTuner();
    const ship = (typeof _titleShipModel !== 'undefined') ? _titleShipModel : null;
    const anchors = {};
    ['L','R','mL','mR'].forEach(k => {
      const a = new THREE.Object3D();
      a.name = 'sr_anchor_' + k;
      anchors[k] = a;
      if (ship) ship.add(a); else titleScene.add(a);
    });
    // Auto-detect hull back-Z in ship-LOCAL space so tuner.z=0 sits at the
    // visible hull back. Default Runner: simple world-bbox → worldToLocal,
    // pick more-negative local Z (matches pre-bac0720 behavior the user
    // confirmed worked). MK Runner / alt-GLB: same, then we let the user
    // tune separately because their GLB shape lays out differently.
    let hullBackZ = 0;
    if (ship) {
      try {
        const bbox = new THREE.Box3().setFromObject(ship);
        if (bbox && isFinite(bbox.max.z) && isFinite(bbox.min.z)) {
          ship.updateMatrixWorld(true);
          const vMax = new THREE.Vector3(0, 0, bbox.max.z);
          const vMin = new THREE.Vector3(0, 0, bbox.min.z);
          ship.worldToLocal(vMax);
          ship.worldToLocal(vMin);
          hullBackZ = Math.min(vMax.z, vMin.z);
        }
      } catch(_){}
    }
    _thr = {
      groups,           // { L, R, mL, mR }
      anchors,          // { L, R, mL, mR }
      color: new THREE.Color(0x66ccff),
      _v: new THREE.Vector3(),
      hullBackZ,
    };
    _applyTunerToAnchors();
  }

  // Push tuner state into the anchor Object3Ds. Anchor local Z is
  // hullBackZ + tuner.z so tuner.z == 0 sits at the visible hull back.
  // Pitch/yaw are converted to a quaternion so anchor's local -Z direction
  // (the exhaust direction) tilts — we read it via getWorldDirection in tick.
  const _DEG2RAD = Math.PI / 180;
  function _applyTunerToAnchors() {
    if (!_thr || !_thr.anchors || !_tuner) return;
    const hz = _thr.hullBackZ || 0;
    ['L','R','mL','mR'].forEach(k => {
      const t = _tuner[k]; const a = _thr.anchors[k];
      if (!t || !a) return;
      a.position.set(t.x, t.y, hz + t.z);
      // Pitch around X (looking at side profile, +pitch tilts exhaust upward).
      // Yaw around Y (+yaw rotates exhaust toward +X).
      a.rotation.set((t.pitch||0) * _DEG2RAD, (t.yaw||0) * _DEG2RAD, 0);
    });
  }

  // ── Drag tuner: HUD + mouse handlers ───────────────────────────
  // Mouse drag on the title canvas moves the selected anchor in the screen
  // plane (X/Y). Mouse wheel scales. Shift+wheel moves Z. Buttons toggle
  // selection (L/R), mirror, flip. Numbers display live so user can screenshot.
  let _tunerHud = null;
  let _tunerDragging = false;
  let _tunerWired = false;
  const _tunerVec = new THREE.Vector3();
  const _tunerVec2 = new THREE.Vector3();

  function _ensureTunerHud() {
    if (_tunerHud) return _tunerHud;
    const el = document.createElement('div');
    el.id = 'sr-tuner-hud';
    el.style.cssText = [
      'position:fixed','top:8px','left:8px','z-index:99999',
      'font:12px/1.35 ui-monospace,Menlo,monospace','color:#cef',
      'background:rgba(0,12,24,0.82)','border:1px solid #3af','padding:8px 10px',
      'border-radius:6px','user-select:none','pointer-events:auto',
      'min-width:240px','box-shadow:0 0 12px rgba(60,180,255,0.25)'
    ].join(';');
    const btn = (a, lbl, danger) =>
      '<button data-act="'+a+'" style="flex:1;background:'+(danger?'#411':'#114')+';color:'+(danger?'#fcc':'#9cf')+';border:1px solid '+(danger?'#f55':'#3af')+';padding:3px 6px;border-radius:3px;cursor:pointer;min-width:32px">'+lbl+'</button>';
    el.innerHTML = [
      '<div style="font-weight:700;color:#7df;margin-bottom:4px;letter-spacing:1px">THRUSTER TUNER</div>',
      '<div id="sr-tu-readout" style="white-space:pre;font-size:11px"></div>',
      '<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">',
        btn('sel-L','L'), btn('sel-R','R'), btn('sel-mL','mL'), btn('sel-mR','mR'),
      '</div>',
      '<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">',
        btn('mirror','MIR'), btn('flip','FLP'), btn('rot','ROT'), btn('reset','RST', true),
      '</div>',
      '<div style="font-size:10px;color:#7af;margin-top:6px;line-height:1.3">drag = move x/y &middot; wheel = scale &middot; shift+wheel = z<br>ROT mode: drag = pitch/yaw &middot; wheel = scale</div>',
    ].join('');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const act = b.dataset.act;
      if (act && act.indexOf('sel-') === 0) _tuner.selected = act.slice(4);
      else if (act === 'mirror') _tuner.mirror = !_tuner.mirror;
      else if (act === 'flip') _tuner.flip = !_tuner.flip;
      else if (act === 'rot') _tuner.rotMode = !_tuner.rotMode;
      else if (act === 'reset') {
        _tuner = JSON.parse(JSON.stringify(SR_TUNER_DEFAULT));
        _applyTunerToAnchors();
      }
      _saveTuner();
      _updateTunerHud();
    });
    _tunerHud = el;
    return el;
  }

  function _updateTunerHud() {
    if (!_tunerHud || !_tuner) return;
    const ro = _tunerHud.querySelector('#sr-tu-readout');
    const f = (n) => (Math.round(n*1000)/1000).toFixed(3);
    const fa = (n) => (Math.round(n*10)/10).toFixed(1);
    const sel = _tuner.selected;
    const row = (k) => {
      const t = _tuner[k];
      return (sel===k?'>':' ')+(k+'  ').slice(0,3)+
        ' x='+f(t.x)+' y='+f(t.y)+' z='+f(t.z)+
        ' s='+f(t.scale)+' p='+fa(t.pitch||0)+' yw='+fa(t.yaw||0);
    };
    const hz = (_thr && _thr.hullBackZ != null) ? _thr.hullBackZ : 0;
    ro.textContent = row('L')+'\n'+row('R')+'\n'+row('mL')+'\n'+row('mR')+
      '\nmir='+(_tuner.mirror?'ON ':'off')+' flp='+(_tuner.flip?'ON':'off')+
      ' rot='+(_tuner.rotMode?'ON':'off')+' hz='+f(hz);
    _tunerHud.querySelectorAll('button').forEach(b => {
      const a = b.dataset.act;
      let on = false;
      if (a && a.indexOf('sel-') === 0) on = sel === a.slice(4);
      else if (a==='mirror') on = _tuner.mirror;
      else if (a==='flip') on = _tuner.flip;
      else if (a==='rot') on = _tuner.rotMode;
      b.style.background = on ? '#3af' : (a==='reset' ? '#411' : '#114');
      b.style.color = on ? '#001' : (a==='reset' ? '#fcc' : '#9cf');
    });
  }

  // Mirror partner mapping: dragging L mirrors to R; dragging mL to mR. Mini
  // group has its own pair so main and mini don't get tangled.
  const _MIRROR_PAIR = { L: 'R', R: 'L', mL: 'mR', mR: 'mL' };

  // Convert a screen-pixel delta to a world-space delta at the anchor's depth,
  // then bake into the anchor's parent (titleShipModel) local space.
  function _screenDeltaToLocal(dxPx, dyPx, sel) {
    if (!_thr || !_thr.anchors) return null;
    const canvas = document.getElementById('title-ship-canvas');
    if (!canvas || typeof titleCamera === 'undefined' || !titleCamera) return null;
    const rect = canvas.getBoundingClientRect();
    const a = _thr.anchors[sel];
    if (!a) return null;
    a.getWorldPosition(_tunerVec);
    const ndc = _tunerVec.clone().project(titleCamera);
    const ndx = ndc.x + (2 * dxPx / rect.width);
    const ndy = ndc.y - (2 * dyPx / rect.height);
    _tunerVec2.set(ndx, ndy, ndc.z).unproject(titleCamera);
    const parent = a.parent;
    if (!parent) return null;
    parent.updateMatrixWorld(true);
    const wOld = _tunerVec.clone();
    const wNew = _tunerVec2.clone();
    parent.worldToLocal(wOld);
    parent.worldToLocal(wNew);
    return { dx: wNew.x - wOld.x, dy: wNew.y - wOld.y };
  }

  function _applyDeltaToTuner(dx, dy, dz) {
    const sel = _tuner.selected;
    const t = _tuner[sel]; if (!t) return;
    t.x += dx; t.y += dy; t.z += (dz||0);
    if (_tuner.mirror) {
      const other = _tuner[_MIRROR_PAIR[sel]];
      if (other) { other.x = -t.x; other.y = t.y; other.z = t.z; }
    }
  }

  function _applyScaleToTuner(mul) {
    const sel = _tuner.selected;
    const t = _tuner[sel]; if (!t) return;
    t.scale = Math.max(0.05, Math.min(8.0, t.scale * mul));
    if (_tuner.mirror) {
      const other = _tuner[_MIRROR_PAIR[sel]];
      if (other) other.scale = t.scale;
    }
  }

  // Rotate-mode delta: pixel-y → pitch (deg), pixel-x → yaw (deg). Mirrored
  // partner gets MIRRORED yaw (sign-flipped) so a 'pinch outward' affects both
  // sides symmetrically; pitch stays the same on both.
  function _applyRotDeltaToTuner(dxPx, dyPx) {
    const sel = _tuner.selected;
    const t = _tuner[sel]; if (!t) return;
    const SENS = 0.25; // deg per pixel
    t.pitch = (t.pitch || 0) + dyPx * SENS;
    t.yaw   = (t.yaw   || 0) + dxPx * SENS;
    // Clamp to a sane range.
    t.pitch = Math.max(-90, Math.min(90, t.pitch));
    t.yaw   = Math.max(-90, Math.min(90, t.yaw));
    if (_tuner.mirror) {
      const other = _tuner[_MIRROR_PAIR[sel]];
      if (other) { other.pitch = t.pitch; other.yaw = -t.yaw; }
    }
  }

  function _onTunerMouseDown(e) {
    if (!_open) return;
    if (e.target.closest('#sr-tuner-hud')) return;
    if (e.target.closest('#sr-fx-hud')) return;
    if (e.target.closest('.sr-panel')) return;
    if (e.button !== 0) return;
    _tunerDragging = true;
    e.preventDefault();
  }
  function _onTunerMouseMove(e) {
    if (!_tunerDragging || !_open) return;
    const dx = e.movementX || 0, dy = e.movementY || 0;
    if (_tuner.rotMode) {
      _applyRotDeltaToTuner(dx, dy);
    } else {
      const d = _screenDeltaToLocal(dx, dy, _tuner.selected);
      if (!d) return;
      _applyDeltaToTuner(d.dx, d.dy, 0);
    }
    _applyTunerToAnchors();
    _updateTunerHud();
  }
  function _onTunerMouseUp() {
    if (_tunerDragging) {
      _tunerDragging = false;
      _saveTuner();
    }
  }
  function _onTunerWheel(e) {
    if (!_open) return;
    if (e.target.closest('.sr-panel')) return;
    if (e.target.closest('#sr-tuner-hud')) return;
    if (e.target.closest('#sr-fx-hud')) return;
    e.preventDefault();
    if (e.shiftKey) {
      // Z move (along ship long axis, in local space).
      const dz = -e.deltaY * 0.002;
      _applyDeltaToTuner(0, 0, dz);
    } else {
      // Scale.
      const mul = e.deltaY < 0 ? 1.06 : 1/1.06;
      _applyScaleToTuner(mul);
    }
    _applyTunerToAnchors();
    _updateTunerHud();
    _saveTuner();
  }

  function _wireTunerOnce() {
    if (_tunerWired) return;
    _tunerWired = true;
    window.addEventListener('mousedown', _onTunerMouseDown, { passive: false });
    window.addEventListener('mousemove', _onTunerMouseMove);
    window.addEventListener('mouseup', _onTunerMouseUp);
    window.addEventListener('wheel', _onTunerWheel, { passive: false });
  }

  function _showTuner(show) {
    if (show) {
      _ensureTunerHud();
      _tunerHud.style.display = 'block';
      _wireTunerOnce();
      _updateTunerHud();
    } else if (_tunerHud) {
      _tunerHud.style.display = 'none';
    }
  }

  // ── FX slider HUD (showroom-only) ───────────────────────────────
  // Sliders that mutate _tuner.fx (persisted in localStorage). Values are
  // read by _thrTick on every frame, so changes are live. NOTHING here
  // touches gameplay particles — see the gating note above _thrTick.
  let _fxHud = null;
  const _FX_DEFS = [
    { key:'bloomScale',   lbl:'bloom scale',   min:0,    max:2.0, step:0.01 },
    { key:'bloomOpacity', lbl:'bloom opacity', min:0,    max:1.0, step:0.01 },
    { key:'partSize',     lbl:'particle size', min:0.1,  max:3.0, step:0.01 },
    { key:'partOpacity',  lbl:'particle alpha',min:0,    max:1.0, step:0.01 },
    { key:'lifeBase',     lbl:'trail length',  min:0.1,  max:2.0, step:0.01 },
    { key:'lifeJit',      lbl:'trail jitter',  min:0,    max:1.0, step:0.01 },
    { key:'miniSize',     lbl:'mini size mult',min:0.1,  max:2.0, step:0.01 },
    { key:'miniBloom',    lbl:'mini bloom mult',min:0,   max:2.0, step:0.01 },
  ];
  function _ensureFxHud() {
    if (_fxHud) return _fxHud;
    if (!_tuner) _tuner = _loadTuner();
    const el = document.createElement('div');
    el.id = 'sr-fx-hud';
    el.style.cssText = [
      'position:fixed','top:8px','left:8px','z-index:99998',
      'transform:translateY(260px)', // sits below the tuner HUD (which is fixed top:8 left:8)
      'font:12px/1.35 ui-monospace,Menlo,monospace','color:#cef',
      'background:rgba(0,12,24,0.82)','border:1px solid #3af','padding:8px 10px',
      'border-radius:6px','user-select:none','pointer-events:auto',
      'min-width:220px','box-shadow:0 0 12px rgba(60,180,255,0.25)'
    ].join(';');
    let rows = '<div style="font-weight:700;color:#7df;margin-bottom:6px;letter-spacing:1px;display:flex;justify-content:space-between;align-items:center">FX <button data-fx-act="reset" style="background:#411;color:#fcc;border:1px solid #f55;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:10px">RST</button></div>';
    for (let i = 0; i < _FX_DEFS.length; i++) {
      const d = _FX_DEFS[i];
      rows += '<div style="display:flex;align-items:center;gap:6px;margin-top:3px">'+
        '<div style="flex:0 0 96px;font-size:10px;color:#9cf">'+d.lbl+'</div>'+
        '<input type="range" data-fx-key="'+d.key+'" min="'+d.min+'" max="'+d.max+'" step="'+d.step+'" style="flex:1;accent-color:#3af">'+
        '<div data-fx-val="'+d.key+'" style="flex:0 0 40px;font-size:10px;text-align:right;color:#cef"></div>'+
      '</div>';
    }
    el.innerHTML = rows;
    document.body.appendChild(el);
    el.addEventListener('input', (e) => {
      const inp = e.target.closest('input[type=range]'); if (!inp) return;
      const k = inp.dataset.fxKey;
      const v = parseFloat(inp.value);
      if (_tuner && _tuner.fx && Number.isFinite(v)) {
        _tuner.fx[k] = v;
        const out = el.querySelector('[data-fx-val="'+k+'"]');
        if (out) out.textContent = (Math.round(v*100)/100).toFixed(2);
      }
    });
    el.addEventListener('change', () => { _saveTuner(); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fx-act="reset"]'); if (!b) return;
      _tuner.fx = JSON.parse(JSON.stringify(SR_TUNER_DEFAULT.fx));
      _saveTuner();
      _syncFxHud();
    });
    _fxHud = el;
    _syncFxHud();
    return el;
  }
  function _syncFxHud() {
    if (!_fxHud || !_tuner || !_tuner.fx) return;
    for (let i = 0; i < _FX_DEFS.length; i++) {
      const k = _FX_DEFS[i].key;
      const inp = _fxHud.querySelector('input[data-fx-key="'+k+'"]');
      const out = _fxHud.querySelector('[data-fx-val="'+k+'"]');
      const v = _tuner.fx[k];
      if (inp) inp.value = v;
      if (out) out.textContent = (Math.round(v*100)/100).toFixed(2);
    }
  }
  function _showFx(show) {
    if (show) {
      _ensureFxHud();
      _fxHud.style.display = 'block';
      _syncFxHud();
    } else if (_fxHud) {
      _fxHud.style.display = 'none';
    }
  }

  function _thrShow(visible) {
    if (!_thr) return;
    Object.values(_thr.groups).forEach(g => {
      g.points.visible = !!visible;
      g.bloom.visible = !!visible;
    });
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
    const bloomWM   = (window._nozzleBloom_whiteMix != null) ? window._nozzleBloom_whiteMix : D.bloomWhiteMix;
    const bloomPul  = (window._nozzleBloomPulse  != null) ? window._nozzleBloomPulse  : D.bloomPulse;

    // Showroom-only fx overrides (gated to this preview only — never leak to gameplay).
    const fx        = (_tuner && _tuner.fx) || SR_TUNER_DEFAULT.fx;
    const bloomScl  = fx.bloomScale;
    const bloomOp   = fx.bloomOpacity;
    const fxPartSz  = fx.partSize;
    const fxPartOp  = fx.partOpacity;
    const fxLifeB   = fx.lifeBase;
    const fxLifeJ   = fx.lifeJit;
    const fxMiniSz  = fx.miniSize;
    const fxMiniBl  = fx.miniBloom;

    const tCol = _thr.color;
    const ss = SR_SPEED_SCALE;
    const tp = SR_TP;
    const flipSign = _tuner.flip ? 1 : -1;  // -1 = exhaust into anchor -Z (default)
    const _exhDir = new THREE.Vector3();

    const KEYS = ['L','R','mL','mR'];
    for (let ki = 0; ki < KEYS.length; ki++) {
      const k = KEYS[ki];
      const g = _thr.groups[k];
      const a = _thr.anchors[k];
      const tu = _tuner[k];
      if (!g || !a || !tu) continue;
      const isMini = !!g.isMini;
      const N = g.positions.length / 3 | 0;

      // World position of the nozzle anchor.
      a.getWorldPosition(_thr._v);
      const wx = _thr._v.x, wy = _thr._v.y, wz = _thr._v.z;
      // World direction the anchor's local -Z points to (this is exhaust dir).
      a.getWorldDirection(_exhDir); // returns world +Z forward
      // Three's getWorldDirection gives the +Z axis of the object; exhaust is -Z
      // when flip=false. Multiply by flipSign so 'flip' inverts the exhaust dir.
      const exhX = flipSign * _exhDir.x;
      const exhY = flipSign * _exhDir.y;
      const exhZ = flipSign * _exhDir.z;

      const aScale = tu.scale || 1.0;
      const baseSizeMult  = (isMini ? fxMiniSz : 1.0) * fxPartSz;
      const baseBloomMult = (isMini ? fxMiniBl : 1.0);

      // Particle material size.
      const matSize = pointSize * aScale * baseSizeMult;
      if (g.points.material.size !== matSize) g.points.material.size = matSize;
      const wantOp = partOp * fxPartOp;
      if (g.points.material.opacity !== wantOp) g.points.material.opacity = wantOp;

      const pos = g.positions, col = g.colors, sz = g.sizes;
      for (let i = 0; i < N; i++) {
        g.ages[i] += dt;
        if (g.ages[i] >= g.lifetimes[i]) {
          g.ages[i] = 0;
          g.lifetimes[i] = (lifeMin + Math.random() * fxLifeJ) * (fxLifeB + ss * lifeSpd);
          pos[i*3]     = wx + (Math.random() - 0.5) * spawnJit;
          pos[i*3 + 1] = wy + (Math.random() - 0.5) * spawnJit;
          pos[i*3 + 2] = wz;
          // Velocity = exhaust direction × speed + small jitter perpendicular.
          const sp = (2.5 + Math.random() * 2.0 + ss * 1.5) * aScale;
          g.velocities[i].set(
            exhX * sp + (Math.random() - 0.5) * 0.06 * aScale,
            exhY * sp + (Math.random() - 0.5) * 0.06 * aScale - 0.02 * aScale,
            exhZ * sp
          );
        } else {
          const t0 = g.ages[i] / g.lifetimes[i];
          if (t0 < posPinFrac) {
            pos[i*3] = wx; pos[i*3 + 1] = wy; pos[i*3 + 2] = wz;
          } else {
            const v = g.velocities[i];
            pos[i*3]     += v.x * dt;
            pos[i*3 + 1] += v.y * dt;
            pos[i*3 + 2] += v.z * dt;
            v.multiplyScalar(0.92);
          }
        }
        const t = g.ages[i] / g.lifetimes[i];
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
        const baseSize = szBase + ss * szSpeed;
        const rawSz = t < bumpEnd
          ? THREE.MathUtils.lerp(baseSize * bumpMult, baseSize, t / bumpEnd)
          : (1.0 - t) * (baseSize + Math.random() * szJitter);
        sz[i] = rawSz * tp * thrScale * baseSizeMult;
      }
      g.geo.attributes.position.needsUpdate = true;
      g.geo.attributes.color.needsUpdate    = true;
      g.geo.attributes.size.needsUpdate     = true;

      g.bloom.position.set(wx, wy, wz);
      const bloomSize = (0.6 + ss * 0.7) * thrScale * bloomScl * aScale * baseBloomMult;
      g.bloom.scale.setScalar(bloomSize);
      g.bloom.material.color.setRGB(
        THREE.MathUtils.lerp(tCol.r, 1.0, bloomWM),
        THREE.MathUtils.lerp(tCol.g, 1.0, bloomWM),
        THREE.MathUtils.lerp(tCol.b, 1.0, bloomWM)
      );
      g.bloom.material.opacity = bloomOp * ((1 - bloomPul) + Math.sin(Date.now() * 0.008) * bloomPul) * tp;
    }
  }

  // Force the title ship's materials to fully opaque so the GLB doesn't
  // appear transparent in the showroom preview. Re-runs whenever a new
  // shape/skin is loaded by the showroom open hook.
  function _forceShipOpaque() {
    const ship = (typeof _titleShipModel !== 'undefined') ? _titleShipModel : null;
    if (!ship) return;
    ship.traverse((o) => {
      if (!o || !o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i]; if (!m) continue;
        // Skip skins that legitimately need transparency (Ghost holo + any
        // custom ShaderMaterial that uses transparency as part of its look).
        if (m.uniforms && m.uniforms.hologramColor) continue;
        if (m.isShaderMaterial || m.isRawShaderMaterial) continue;
        if (m.transparent) m.transparent = false;
        if (m.opacity !== 1) m.opacity = 1;
        if (m.depthWrite === false) m.depthWrite = true;
        if (m.alphaTest && m.alphaTest > 0) m.alphaTest = 0;
        m.needsUpdate = true;
      }
    });
  }

  // ── Public: open / close / refresh ───────────────────────────────────
  function open(tab) {
    const overlay = document.getElementById('thruster-overlay');
    if (!overlay) return;
    _wireOnce();
    overlay.classList.remove('hidden');
    document.body.classList.add('sr-open');
    _switchTab(tab || 'thrusters');
    // Seed the garage preview index from whatever ship is currently on the
    // title canvas. Keeps the dropdown in sync with the visible ship without
    // firing a skin swap (which would wipe thruster anchors).
    _garagePreviewIdx = _displayedSkinIdx();
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
      _forceShipOpaque();
      _thrSyncColor();
      _thrShow(true);
      _showTuner(true);
      _showFx(true);
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
    _showTuner(false);
    _showFx(false);
    // If the player previewed a different skin in the garage but never hit
    // USE on the title, snap the title canvas back to the equipped skin.
    if (_garagePreviewIdx != null && _garagePreviewIdx !== _equippedSkinIdx()) {
      try { _previewSkin(_equippedSkinIdx()); } catch(_){}
    }
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

  // Drop all thruster anchors + systems so the next _thrInit() rebuilds them
  // against the (possibly swapped) _titleShipModel. Called by applyTitleSkin
  // when an alt-GLB skin is loaded.
  function resetThrusterAnchors() {
    if (!_thr) return;
    try {
      Object.values(_thr.groups || {}).forEach(g => {
        if (g.points && g.points.parent) g.points.parent.remove(g.points);
        if (g.bloom  && g.bloom.parent)  g.bloom.parent.remove(g.bloom);
      });
      Object.values(_thr.anchors || {}).forEach(a => {
        if (a && a.parent) a.parent.remove(a);
      });
    } catch(_){}
    _thr = null;
    // Swap the working tuner to the new ship's bucket BEFORE _thrInit so
    // _applyTunerToAnchors uses the right per-ship pod offsets. Persists
    // the outgoing ship's edits to its own key, never crosses streams.
    try { _swapTunerForCurrentShip(); } catch(_){}
    try { if (typeof _updateTunerHud === 'function') _updateTunerHud(); } catch(_){}
    if (_open) {
      _thrInit();
      try { _forceShipOpaque(); } catch(_){}
      _thrSyncColor();
      _thrShow(true);
    }
  }

  window.Showroom = {
    open: open, close: close, refresh: refresh,
    tick: tick, syncColor: syncColor,
    resetThrusterAnchors: resetThrusterAnchors,
    isOpen: function() { return _open; },
  };
})();
