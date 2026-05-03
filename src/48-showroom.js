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
    });
    _open = true;
  }

  function close() {
    const overlay = document.getElementById('thruster-overlay');
    _restoreCanvas();
    if (overlay) overlay.classList.add('hidden');
    document.body.classList.remove('sr-open');
    _open = false;
  }

  function refresh() {
    if (!_open) return;
    _unlockReqCache = null; // recompute in case missions changed
    _populateAll();
  }

  window.Showroom = { open: open, close: close, refresh: refresh };
})();
