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
  // Saved DOM placement of shop power-up + handling content while it lives in
  // the showroom panel. Restored on close so openShop() (if ever called) still
  // finds its own children. Garage is now the canonical entry point.
  let _shopReparentSaved = null;

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
  // INTENTIONALLY a single shared key across all ships — thruster positions
  // are the same for every skin. Per-ship buckets caused stale values to
  // load on swap (one bucket would drift behind the other), making the
  // anchors render in the wrong spot until RST overwrote them. If per-ship
  // tuning is ever needed, gate it behind an explicit user-driven toggle
  // rather than re-introducing implicit per-GLB buckets.
  function _currentTunerKey() {
    return SR_TUNER_KEY;
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
  // Preview a skin WITHOUT touching equipped state. We call BOTH applySkin
  // and applyTitleSkin (the same pair navigateToSkin runs) because alt-GLB
  // ships like MK Runner need applySkin's lighting reset + _showAltShip to
  // render correctly — applyTitleSkin alone leaves them invisible/black.
  // What we explicitly skip is the data.selected write that navigateToSkin
  // performs, since that's the equipped-state mutation we want to avoid.
  function _previewSkin(idx) {
    if (typeof applySkin === 'function') {
      try { applySkin(idx); } catch(_){}
    }
    if (typeof applyTitleSkin === 'function') {
      try { applyTitleSkin(idx); } catch(_){}
    }
  }

  // ── Skin card grid (replaces dropdown). Locked cards show LV/M/price tag
  //    and ignore clicks. Selection is preview-only (no data.selected write).
  function _buildSkinCards() {
    const grid = document.getElementById('sr-skin-grid');
    if (!grid) return;
    if (typeof SHIP_SKINS === 'undefined') { grid.innerHTML = ''; return; }
    const reqs = _getUnlockReqs();
    const selectedIdx = (_garagePreviewIdx != null) ? _garagePreviewIdx : _equippedSkinIdx();
    const lvMap = (typeof SKIN_LEVEL_UNLOCKS !== 'undefined') ? SKIN_LEVEL_UNLOCKS : null;
    let html = '';
    SHIP_SKINS.forEach((skin, idx) => {
      if (skin.hidden) return;
      const unlocked = _isSkinUnlockedSafe(idx);
      const isActive = (idx === selectedIdx) && unlocked;
      const _rawName = (typeof window._displayedSkinName === 'function') ? window._displayedSkinName(idx) : (skin.name || ('SKIN ' + idx));
      const name = String(_rawName).replace(/</g, '&lt;');
      let stateLabel;
      if (!unlocked) {
        const m = reqs.skins[idx];
        const lv = lvMap && lvMap[idx];
        if (m) stateLabel = 'M' + m;
        else if (lv && lv > 1) stateLabel = 'LV' + lv;
        else if (skin.price) stateLabel = skin.price + 'c';
        else stateLabel = 'LOCKED';
      } else {
        // No SELECTED/SELECT label when unlocked — the active highlight
        // already communicates state (per user UX feedback).
        stateLabel = '';
      }
      const cls = 'sr-addon-card' + (isActive ? ' active' : '') + (unlocked ? '' : ' locked');
      html += '<button type="button" class="' + cls + '" data-skin="' + idx + '"' +
        (unlocked ? '' : ' aria-disabled="true"') + '>' +
        '<span class="sr-addon-card-name">' + name + '</span>' +
        '<span class="sr-addon-card-state">' + stateLabel + '</span>' +
      '</button>';
    });
    grid.innerHTML = html;
    grid.querySelectorAll('button.sr-addon-card[data-skin]').forEach(btn => {
      if (btn.classList.contains('locked')) return;
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.skin, 10);
        if (isNaN(idx)) return;
        _garagePreviewIdx = idx;
        // Persist the selection so the chosen skin (e.g. MK Runner) carries
        // into gameplay instead of being reverted to the previously-equipped
        // ship when the garage closes.
        try {
          const d = loadSkinData();
          if (!Array.isArray(d.unlocked)) d.unlocked = [0];
          if (!d.unlocked.includes(idx)) d.unlocked.push(idx);
          d.selected = idx;
          saveSkinData(d);
        } catch(_){}
        try { _previewSkin(idx); } catch(_){}
        requestAnimationFrame(() => { try { _forceShipOpaque(); } catch(_){} });
        try { _refreshAddonsTabVisibility(); _populateAddons(); } catch(_){}
        // Update active visual state on the grid without rebuilding (avoids flicker).
        grid.querySelectorAll('button.sr-addon-card[data-skin]').forEach(b => {
          const on = (parseInt(b.dataset.skin, 10) === idx) && !b.classList.contains('locked');
          b.classList.toggle('active', on);
          const st = b.querySelector('.sr-addon-card-state');
          if (st && !b.classList.contains('locked')) st.textContent = '';
        });
        try { playTitleTap(); } catch(_){}
      });
    });
  }

  // ── Thruster shape card grid (replaces SHAPE dropdown). Locked cards show
  //    M-tag and ignore clicks. Selection writes selectedPreset like before.
  function _buildShapeCards() {
    const grid = document.getElementById('sr-shape-grid');
    if (!grid) return;
    const presets = window._THRUSTER_PRESETS || {};
    const reqs = _getUnlockReqs();
    let selectedKey = 'baseline';
    let newSet = [];
    try {
      const td = loadThrusterData() || {};
      selectedKey = td.selectedPreset || 'baseline';
      newSet = Array.isArray(td.newPresets) ? td.newPresets : [];
    } catch(_){}
    let html = '';
    Object.keys(presets).forEach(key => {
      const P = presets[key];
      const unlocked = _isPresetUnlocked(key);
      const isActive = (key === selectedKey) && unlocked;
      const isNew    = unlocked && newSet.indexOf(key) >= 0;
      const baseLabel = (P && P.label) ? P.label.toUpperCase() : key.toUpperCase();
      const name = String(baseLabel).replace(/</g, '&lt;');
      let stateLabel;
      if (!unlocked) {
        const m = reqs.presets[key];
        stateLabel = m ? ('M' + m) : 'LOCKED';
      } else {
        stateLabel = isActive ? 'EQUIPPED' : 'EQUIP';
      }
      const k = String(key).replace(/"/g, '&quot;');
      const cls = 'sr-addon-card'
        + (isActive ? ' active' : '')
        + (unlocked ? '' : ' locked')
        + (isNew    ? ' is-new' : '');
      html += '<button type="button" class="' + cls + '" data-shape="' + k + '"' +
        (unlocked ? '' : ' aria-disabled="true"') + '>' +
        '<span class="sr-addon-card-name">' + name + '</span>' +
        '<span class="sr-addon-card-state">' + stateLabel + '</span>' +
      '</button>';
    });
    grid.innerHTML = html;
    grid.querySelectorAll('button.sr-addon-card[data-shape]').forEach(btn => {
      if (btn.classList.contains('locked')) return;
      btn.addEventListener('click', () => {
        const key = btn.dataset.shape;
        if (!key) return;
        try {
          const d = loadThrusterData();
          if (!d.unlockedPresets.includes(key)) d.unlockedPresets.push(key);
          d.selectedPreset = key;
          // Clear "new" pulse flag once user selects this preset.
          if (Array.isArray(d.newPresets)) {
            d.newPresets = d.newPresets.filter(k => k !== key);
          }
          saveThrusterData(d);
          if (typeof window._applyEquippedThruster === 'function') window._applyEquippedThruster();
        } catch(_){}
        // Drop the pulse class on this card immediately.
        btn.classList.remove('is-new');
        try { _refreshTabBadges(); } catch(_){}
        try { _thrSyncColor(); } catch(_){}
        grid.querySelectorAll('button.sr-addon-card[data-shape]').forEach(b => {
          const on = (b.dataset.shape === key) && !b.classList.contains('locked');
          b.classList.toggle('active', on);
          const st = b.querySelector('.sr-addon-card-state');
          if (st && !b.classList.contains('locked')) st.textContent = on ? 'EQUIPPED' : 'EQUIP';
        });
        try { playTitleTap(); } catch(_){}
      });
    });
  }

  function _buildColorOptions(sel) {
    if (!sel) return;
    sel.innerHTML = '';
    const palette = window._THRUSTER_COLOR_PALETTE || {};
    const reqs = _getUnlockReqs();
    let selectedKey = 'default';
    let newSet = [];
    try {
      const td = loadThrusterData() || {};
      selectedKey = td.selectedColor || 'default';
      newSet = Array.isArray(td.newColors) ? td.newColors : [];
    } catch(_){}
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
      // Mark freshly-unlocked colors so the sci-fi-select can mirror the
      // class onto its custom <li> (47-sci-fi-select picks this up).
      if (unlocked && newSet.indexOf(key) >= 0) {
        opt.dataset.isNew = '1';
      }
      sel.appendChild(opt);
    });
  }

  function _populateAll() {
    const sColor = document.getElementById('sr-select-color');
    _buildSkinCards();
    _buildShapeCards();
    _buildColorOptions(sColor);
    // Enhance + refresh the custom sci-fi dropdown for COLOR (only remaining
    // dropdown). enhance() is idempotent; refresh() rebuilds the popup.
    if (window.SciFiSelect) {
      window.SciFiSelect.enhance(sColor);
      window.SciFiSelect.refresh(sColor);
    }
    _populateAddons();
    try { _refreshTabBadges(); } catch(_){}
  }

  // _orient kept as a small helper used elsewhere (zoom localStorage key).
  function _orient() {
    if (window.innerWidth >= 900) return 'l';
    return (window.innerWidth > window.innerHeight) ? 'l' : 'p';
  }

  // ── ADD-ONS ───────────────────────────────────────────────────────────
  // Per-GLB add-on registry. Mesh names are HARDCODED from the GLB's actual
  // node hierarchy (read from the file, not pattern-matched), and looked up
  // via traverse() so it works regardless of where they sit in the clone.
  // Default state is OFF; user toggles on. Visibility is applied AFTER the
  // ship has been placed in the scene so it never affects bbox/hullBackZ.
  const SR_ADDONS_KEY = 'jh_showroom_addons_v2';
  // GLTFLoader sanitizes node names: spaces → underscore, dots removed
  // (see three.js issue #27873). The GLB authoring tool stored names like
  // 'Fins 01' but the runtime scene has 'Fins_01'. Registry uses the
  // SANITIZED forms so _findAddonNode matches what's actually in the scene.
  // Display labels keep the spaces for readability.
  const ADDON_REGISTRY = {
    'spaceship_01.glb': [
      { node: 'Fins_01',     label: 'Fins 01' },
      { node: 'Fins_02',     label: 'Fins 02' },
      { node: 'Rings_001',   label: 'Warp Drive' },
      { node: 'Turrets_001', label: 'Turrets 001' },
      { node: 'Turrets_002', label: 'Turrets 002' },
      { node: 'Turrets_003', label: 'Turrets 003' },
    ],
  };
  function _loadAddonsState() {
    try { return JSON.parse(localStorage.getItem(SR_ADDONS_KEY) || '{}') || {}; }
    catch(_) { return {}; }
  }
  function _saveAddonsState(s) {
    try { localStorage.setItem(SR_ADDONS_KEY, JSON.stringify(s || {})); } catch(_){}
  }
  function _currentAddonsKey() {
    // Prefer the active title ship's _altGlb (set after applyTitleSkin runs).
    // Fall back to the SHIP_SKINS entry for the currently-viewed/active skin
    // so the Addons tab is available even before the alt-GLB cache resolves
    // on first boot — all 4 main skins now share spaceship_01.glb.
    const ship = (typeof _titleShipModel !== 'undefined') ? _titleShipModel : null;
    const fromShip = ship && ship.userData && ship.userData._altGlb;
    if (fromShip) return fromShip;
    try {
      const idx = (typeof skinViewerIdx === 'number') ? skinViewerIdx
                : (typeof activeSkinIdx === 'number') ? activeSkinIdx : 0;
      const def = (typeof SHIP_SKINS !== 'undefined') ? SHIP_SKINS[idx] : null;
      if (def && def.glbFile) return def.glbFile;
    } catch(_){}
    return null;
  }
  // Find a named descendant on a given ship root. MK Runner's hull is
  // 'Cube.007' and the add-ons are its children, but we traverse so the
  // lookup works no matter how deeply nested. Defaults to the title ship.
  function _findAddonNodeIn(root, name) {
    if (!root) return null;
    let hit = null;
    root.traverse(o => { if (!hit && o.name === name) hit = o; });
    return hit;
  }
  function _findAddonNode(name) {
    const ship = (typeof _titleShipModel !== 'undefined') ? _titleShipModel : null;
    return _findAddonNodeIn(ship, name);
  }
  // Apply persisted add-on visibility to a given ship root. Used for both
  // the title/showroom ship and the in-game alt ship so toggles in garage
  // carry into gameplay. Earlier versions kept the title-only call as a
  // no-op because mutating visibility before _thrInit measured the bbox
  // shifted hullBackZ. hullBackZ is now a hardcoded constant (-2.394, see
  // _thrInit) so bbox measurement is no longer in the loop — we can safely
  // sync visibility here without affecting thruster anchor placement.
  function _applyAddonsToRoot(root, key) {
    if (!root || !key) return;
    const entries = ADDON_REGISTRY[key];
    if (!entries || !entries.length) return;
    const saved = _loadAddonsState();
    const bucket = saved[key];
    if (!bucket) return;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (typeof bucket[entry.node] !== 'boolean') continue;
      const node = _findAddonNodeIn(root, entry.node);
      if (node) node.visible = !!bucket[entry.node];
    }
  }
  function _applyAddonsToShip() {
    _applyAddonsToRoot((typeof _titleShipModel !== 'undefined') ? _titleShipModel : null, _currentAddonsKey());
  }
  // Apply addons to whatever alt ship is currently shown in gameplay
  // (parented under shipGroup). Called when toggling an addon in the
  // garage and from applySkin after _showAltShip swaps to a new alt model.
  function _applyAddonsToGameplayShip() {
    try {
      const alt = (typeof _altShipModel !== 'undefined') ? _altShipModel : null;
      const file = (typeof _altShipCurrentFile !== 'undefined') ? _altShipCurrentFile : null;
      if (alt && file) _applyAddonsToRoot(alt, file);
    } catch(_){}
  }
  // Expose so applySkin (in 20-main-early.js) can call it after _showAltShip.
  try { window._applyAddonsToGameplayShip = _applyAddonsToGameplayShip; } catch(_){}
  function _populateAddons() {
    const list = document.getElementById('sr-addons-list');
    if (!list) return;
    const key = _currentAddonsKey();
    const entries = key && ADDON_REGISTRY[key];
    if (!entries || !entries.length) {
      list.innerHTML = '<div class="sr-addon-empty">No add-ons available for this ship</div>';
      return;
    }
    // Default-OFF for new users. Existing saved state wins. If no saved
    // value for this addon, write OFF immediately so next open is consistent.
    const saved = _loadAddonsState();
    const bucket = saved[key] = saved[key] || {};
    let dirty = false;
    entries.forEach(entry => {
      if (typeof bucket[entry.node] !== 'boolean') {
        bucket[entry.node] = false;
        dirty = true;
      }
      // Sync the live node visibility to match storage.
      const n = _findAddonNode(entry.node);
      if (n) n.visible = !!bucket[entry.node];
    });
    if (dirty) _saveAddonsState(saved);

    // Powerup-style cards: tap a card to toggle on/off. Active = highlighted.
    let html = '';
    entries.forEach(entry => {
      const on = !!bucket[entry.node];
      const nodeName = String(entry.node).replace(/"/g, '&quot;');
      const label = String(entry.label).replace(/</g, '&lt;');
      html += '<button type="button" class="sr-addon-card'+(on?' active':'')+'" '+
        'data-addon="'+nodeName+'" aria-pressed="'+(on?'true':'false')+'">'+
        '<span class="sr-addon-card-name">'+label+'</span>'+
        '<span class="sr-addon-card-state">'+(on?'ON':'OFF')+'</span>'+
      '</button>';
    });
    list.innerHTML = html;
    list.querySelectorAll('button.sr-addon-card[data-addon]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = _currentAddonsKey();
        if (!k) return;
        const n = btn.dataset.addon;
        const s = _loadAddonsState();
        if (!s[k]) s[k] = {};
        const next = !s[k][n];
        s[k][n] = next;
        _saveAddonsState(s);
        const node = _findAddonNode(n);
        if (node) node.visible = next;
        // Mirror visibility onto the gameplay alt ship so the add-on
        // populates into the run, not just the showroom preview.
        try {
          const alt = (typeof _altShipModel !== 'undefined') ? _altShipModel : null;
          if (alt) {
            const altNode = _findAddonNodeIn(alt, n);
            if (altNode) altNode.visible = next;
          }
        } catch(_){}
        btn.classList.toggle('active', next);
        btn.setAttribute('aria-pressed', next ? 'true' : 'false');
        const stateEl = btn.querySelector('.sr-addon-card-state');
        if (stateEl) stateEl.textContent = next ? 'ON' : 'OFF';
        // RUNNER's displayed name flips between 'RUNNER' and 'RUNNER MK II'
        // depending on whether every addon is on. Refresh the skin cards so
        // the label updates without reopening the garage.
        try { _buildSkinCards(); } catch(_){}
        try { playTitleTap(); } catch(_){}
      });
    });
  }
  // Show the ADD-ONS tab only when the current ship has add-ons registered.
  // Other ships hide the tab entirely so we never show an empty pane.
  function _refreshAddonsTabVisibility() {
    const tab = document.querySelector('.sr-tab[data-tab="addons"]');
    if (!tab) return;
    const key = _currentAddonsKey();
    const reg = key && ADDON_REGISTRY[key];
    const has = !!(reg && reg.length);
    tab.classList.toggle('sr-hidden', !has);
    // If the active tab just got hidden, fall back to thrusters.
    if (!has && _activeTab === 'addons') _switchTab('thrusters');
  }

  // ── Wire dropdown change handlers ────────────────────────────────────
  // SKIN + SHAPE click handlers are wired inline in _buildSkinCards /
  // _buildShapeCards on every populate. Only COLOR remains a dropdown.

  function _onColorChange(e) {
    const key = e.target.value;
    if (!key) return;
    try {
      const d = loadThrusterData();
      if (!d.unlockedColors.includes(key)) d.unlockedColors.push(key);
      d.selectedColor = key;
      // Clear "new" pulse flag once the user picks this color.
      if (Array.isArray(d.newColors)) {
        d.newColors = d.newColors.filter(k => k !== key);
      }
      saveThrusterData(d);
      if (typeof window._applyEquippedThruster === 'function') window._applyEquippedThruster();
    } catch(_){}
    // Sync showroom preview color immediately.
    _thrSyncColor();
    try { _refreshTabBadges(); } catch(_){}
    try { playTitleTap(); } catch(_){}
  }

  // Refresh the THRUSTERS tab “new” dot indicator. Called whenever any
  // newPresets/newColors mutate (selection, garage open).
  function _refreshTabBadges() {
    try {
      const td = loadThrusterData() || {};
      const hasNew = (Array.isArray(td.newPresets) && td.newPresets.length > 0)
                  || (Array.isArray(td.newColors)  && td.newColors.length  > 0);
      const tab = document.querySelector('.sr-tab[data-tab="thrusters"]');
      if (tab) tab.classList.toggle('has-new', !!hasNew);
    } catch(_){}
  }
  // Expose so refresh after open + after wheel rewards can re-trigger.
  window._srRefreshTabBadges = _refreshTabBadges;

  // ── Tab switching ────────────────────────────────────────────────────
  function _switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.sr-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.sr-pane').forEach(p => {
      p.classList.toggle('sr-hidden', p.dataset.pane !== tab);
    });
    // When entering Power-ups tab, refresh cards so coin counts / locks update.
    if (tab === 'powerups') {
      try {
        if (typeof renderPowerupCards === 'function') renderPowerupCards();
        const coinCount = document.getElementById('shop-coin-count');
        if (coinCount && typeof _totalCoins !== 'undefined') coinCount.textContent = _totalCoins;
      } catch(_){}
    }
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
    // SKIN + SHAPE are now card grids; their click handlers are wired in
    //   _buildSkinCards / _buildShapeCards on every populate. Only COLOR
    //   remains a dropdown that needs a one-time change listener.
    const sColor = document.getElementById('sr-select-color');
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
    // CSS @media owns the box layout; JS only resizes the WebGL canvas.
    _resizeStageCanvas();
    // Override ship pose for showroom: force horizontal (side-profile) tilt
    // in BOTH portrait and landscape so thrusters are visible. The live title
    // screen restores its own pose on close.
    try {
      const pivot = (typeof titleScene !== 'undefined') ? titleScene.getObjectByName('titleShipPivot') : null;
      const tiltGroup = pivot && pivot.children && pivot.children[0];
      if (pivot) {
        _canvasSaved.pivotX = pivot.position.x;
        _canvasSaved.pivotY = pivot.position.y;
        // Center the ship horizontally + vertically for showroom preview
        pivot.position.x = 0;
        pivot.position.y = 0;
      }
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
    // Clear any inline pixel lock we put on the stage so portrait CSS can
    // re-take over next open.
    const stage = document.getElementById('sr-stage');
    if (stage) {
      stage.style.width = '';
      stage.style.height = '';
      stage.style.maxWidth = '';
      stage.style.maxHeight = '';
    }
    const s = _canvasSaved;
    // Always restore to title's hardcoded 200x180 box (matches _mountTitleCanvas).
    // Falling back to saved values can leave stale 100%/100% from showroom.
    canvas.style.width  = '200px';
    canvas.style.height = '180px';
    canvas.style.transform = 'translate(-1px, -14px)';
    canvas.style.maxWidth = '';
    canvas.style.maxHeight = '';
    canvas.style.position = '';
    canvas.style.inset = '';
    if (s.parent) {
      if (s.nextSibling && s.nextSibling.parentNode === s.parent) {
        s.parent.insertBefore(canvas, s.nextSibling);
      } else {
        s.parent.appendChild(canvas);
      }
    }
    // Restore renderer + camera to their pre-open dimensions.
    try {
      if (typeof _titleRenderer !== 'undefined' && _titleRenderer) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        _titleRenderer.setPixelRatio(dpr);
        _titleRenderer.setSize(200, 180, false);
      }
      if (typeof titleCamera !== 'undefined' && titleCamera) {
        titleCamera.aspect = 200 / 180;
        if (s.origFov != null) titleCamera.fov = s.origFov;
        titleCamera.updateProjectionMatrix();
      }
      // Restore ship pose + pivot position.
      const pivot = (typeof titleScene !== 'undefined') ? titleScene.getObjectByName('titleShipPivot') : null;
      const tiltGroup = pivot && pivot.children && pivot.children[0];
      if (pivot && typeof s.pivotX === 'number') {
        pivot.position.x = s.pivotX;
        pivot.position.y = s.pivotY || 0;
      }
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
    const aspect = w / h;
    try {
      if (typeof _titleRenderer !== 'undefined' && _titleRenderer) {
        _titleRenderer.setPixelRatio(dpr);
        _titleRenderer.setSize(w, h, false);
      }
      if (typeof titleCamera !== 'undefined' && titleCamera) {
        titleCamera.aspect = aspect;
        // Showroom-only FOV reframe: in landscape (aspect > 1) the same FOV
        // makes the ship look small because there's more horizontal world
        // visible. Lower FOV = zoom in. This change is gated on _canvasSaved
        // (only active while showroom is open) and restored by _restoreCanvas.
        // Save original FOV once, on first resize after relocation.
        if (_canvasSaved.origFov == null) {
          _canvasSaved.origFov = titleCamera.fov;
        }
        // Portrait keeps base FOV (already framed correctly). Only landscape
        // (aspect > 1.2) zooms in, because wider stages otherwise leave the
        // ship looking tiny. Ramp from aspect 1.2 → 1.0x base to 2.2 → 0.65x.
        const baseFov = _canvasSaved.origFov || 35;
        let targetFov = baseFov;
        if (aspect > 1.2) {
          const t = Math.min(1, (aspect - 1.2) / (2.2 - 1.2));
          targetFov = baseFov * (1 - t * 0.55); // 35deg → ~15.75deg at widest
        }
        // User zoom override: slider 40-160 (100 = baseline). Per-orientation
        // storage so portrait vs landscape have independent zoom settings.
        // Default zoom by orientation: landscape uses 160 (max zoom-in)
        // because the wide stage otherwise leaves the ship looking small;
        // portrait keeps 100 baseline.
        const orient = _orient();
        let zoomPct = (orient === 'l') ? 160 : 100;
        try {
          const raw = localStorage.getItem('jh_showroom_zoom_' + orient);
          if (raw != null) {
            const stored = parseInt(raw, 10);
            if (!isNaN(stored)) zoomPct = Math.max(40, Math.min(160, stored));
          }
        } catch(_){}
        // Multiplier: pct=100 → 1.0; pct=40 → 1.6 (wider, smaller ship);
        // pct=160 → 0.55 (narrower, bigger ship). Linear inverse.
        const zoomMul = 100 / zoomPct;
        targetFov = targetFov * zoomMul;
        titleCamera.fov = Math.max(8, Math.min(60, targetFov));
        titleCamera.updateProjectionMatrix();
      }
    } catch(_){}
    // DO NOT set canvas.style.width/height — the CSS already pins canvas
    // to width:100% !important, height:100% !important inside .sr-stage.
    // Inline pixel sizes here used to lock the canvas to a stale rect
    // taken mid-rotation on iOS, causing the morph glitch. The renderer's
    // setSize(w, h, false) above updates the drawing buffer only; the
    // displayed size is controlled by CSS (always fills the stage cell).
  }

  // Re-apply the showroom-specific ship pose (centered pivot + side-profile
  // tilt). The title screen's applyDefaults() runs on every resize and
  // overwrites pivot.position + rotation.x with title-screen values; we
  // need to reclaim them after every rotation while showroom is open.
  function _reapplyShowroomPose() {
    try {
      if (typeof titleScene === 'undefined' || !titleScene) return;
      const pivot = titleScene.getObjectByName('titleShipPivot');
      const tiltGroup = pivot && pivot.children && pivot.children[0];
      if (pivot) {
        pivot.position.x = 0;
        pivot.position.y = 0;
      }
      if (tiltGroup) {
        tiltGroup.rotation.x = 0.13;
        tiltGroup.rotation.y = 0;
        tiltGroup.rotation.z = 0;
      }
    } catch(_){}
  }

  let _resizeT = null;
  function _onResize() {
    if (!_open) return;
    // Debounce 100ms so iOS Safari mid-rotation events coalesce, then
    // resize canvas AND reclaim ship pose (title screen's applyDefaults
    // also fires on resize and overwrites pivot/rotation).
    if (_resizeT) clearTimeout(_resizeT);
    // 300ms covers iOS Safari's full rotation animation (~250ms). Reading
    // stage.getBoundingClientRect earlier returns the pre-rotation rect,
    // which makes the renderer set the wrong aspect and CSS then stretches
    // the buffer (ship looks tall/narrow on portrait→landscape).
    _resizeT = setTimeout(() => {
      _resizeT = null;
      _reapplyShowroomPose();
      _resizeStageCanvas();
    }, 300);
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
    // hullBackZ is intentionally a CONSTANT. Tuner offsets are absolute
    // anchor positions in ship-local space, plus this fixed back-Z origin.
    // Measuring per-ship caused the thrusters to drift on swap because
    // bbox depended on async matrix updates and child geometry. The
    // user-confirmed working value for the default Runner is -2.394, and
    // the same tuner reproduces correctly on MK Runner with the same value.
    const hullBackZ = -2.394;
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

  // ── Tuner + FX HUDs live in src/49-tuner-hud.js ─────────────────
  // The HUD module owns DOM/event wiring; we own state. Bind the api once
  // on first show, then call into window.TunerHud for visibility toggles.
  let _tunerHudInited = false;
  function _ensureTunerHudInit() {
    if (_tunerHudInited) return;
    if (!window.TunerHud || typeof window.TunerHud.init !== 'function') return;
    window.TunerHud.init({
      getTuner:        function(){ return _tuner; },
      setTuner:        function(t){ _tuner = t; _tunerLoadedKey = _currentTunerKey(); },
      getDefaults:     function(){ return SR_TUNER_DEFAULT; },
      getThr:          function(){ return _thr; },
      isOpen:          function(){ return _open; },
      save:            _saveTuner,
      applyToAnchors:  _applyTunerToAnchors,
      getTitleCamera:  function(){ return (typeof titleCamera !== 'undefined') ? titleCamera : null; },
    });
    _tunerHudInited = true;
  }
  function _devHudsEnabled() {
    try {
      if (window.JH_DEV_HUDS === true) return true;
      if (localStorage.getItem('jh_showroom_dev_huds') === '1') return true;
    } catch(_){}
    return false;
  }
  function _showTuner(show) {
    _ensureTunerHudInit();
    if (window.TunerHud) window.TunerHud.showTuner(show);
  }
  function _showFx(show) {
    _ensureTunerHudInit();
    if (window.TunerHud) window.TunerHud.showFx(show);
  }
  function _updateTunerHud() {
    if (window.TunerHud && window.TunerHud.updateTuner) window.TunerHud.updateTuner();
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
  // Move shop's existing power-up DOM (cards container, detail view, handling
  // bar) into the showroom panel. We physically reparent the existing nodes so
  // the shop's own functions keep operating on the same IDs without rewiring.
  function _mountShopIntoShowroom() {
    if (_shopReparentSaved) return;
    const handling = document.getElementById('shop-handling-bar');
    const powerups = document.getElementById('shop-tab-powerups');
    const detail = document.getElementById('shop-detail');
    const handlingSlot = document.getElementById('sr-handling-slot');
    const powerupsPane = document.querySelector('.sr-pane[data-pane="powerups"]');
    if (!handling || !powerups || !handlingSlot || !powerupsPane) return;
    _shopReparentSaved = {
      handlingHome: handling.parentNode,
      handlingNext: handling.nextSibling,
      powerupsHome: powerups.parentNode,
      powerupsNext: powerups.nextSibling,
      detailHome: detail ? detail.parentNode : null,
      detailNext: detail ? detail.nextSibling : null,
    };
    handlingSlot.appendChild(handling);
    powerupsPane.appendChild(powerups);
    if (detail) powerupsPane.appendChild(detail);
    try { if (typeof _renderShopHandlingBar === 'function') _renderShopHandlingBar(); } catch(_){}
    try { if (typeof renderPowerupCards === 'function') renderPowerupCards(); } catch(_){}
    try {
      const cc = document.getElementById('shop-coin-count');
      if (cc && typeof _totalCoins !== 'undefined') cc.textContent = _totalCoins;
    } catch(_){}
  }
  function _unmountShopFromShowroom() {
    if (!_shopReparentSaved) return;
    const s = _shopReparentSaved;
    const handling = document.getElementById('shop-handling-bar');
    const powerups = document.getElementById('shop-tab-powerups');
    const detail = document.getElementById('shop-detail');
    if (handling && s.handlingHome) s.handlingHome.insertBefore(handling, s.handlingNext);
    if (powerups && s.powerupsHome) s.powerupsHome.insertBefore(powerups, s.powerupsNext);
    if (detail && s.detailHome) s.detailHome.insertBefore(detail, s.detailNext);
    _shopReparentSaved = null;
  }

  function open(tab) {
    const overlay = document.getElementById('thruster-overlay');
    if (!overlay) return;
    _wireOnce();
    overlay.classList.remove('hidden');
    document.body.classList.add('sr-open');
    _mountShopIntoShowroom();
    _switchTab(tab || 'skins');
    // Seed the garage preview index from whatever ship is currently on the
    // title canvas. Keeps the dropdown in sync with the visible ship without
    // firing a skin swap (which would wipe thruster anchors).
    _garagePreviewIdx = _displayedSkinIdx();
    _populateAll();
    _refreshAddonsTabVisibility();
    // Relocate after the overlay is visible so getBoundingClientRect is right.
    requestAnimationFrame(() => {
      _relocateCanvasToStage();
      if (!_resizeBound) {
        _resizeBound = true;
        window.addEventListener('resize', _onResize);
      }
      // Init thruster preview lazily on first open + show it.
      _thrInit();
      _forceShipOpaque();
      _thrSyncColor();
      _thrShow(true);
      // Tuner + FX HUDs are dev-only. Toggle on by setting
      // localStorage.jh_showroom_dev_huds = '1' (or window.JH_DEV_HUDS = true).
      if (_devHudsEnabled()) {
        _showTuner(true);
        _showFx(true);
      } else {
        _showTuner(false);
        _showFx(false);
      }
    });
    _open = true;
  }

  function close() {
    const overlay = document.getElementById('thruster-overlay');
    _restoreCanvas();
    _unmountShopFromShowroom();
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
    // Apply persisted add-on visibility to the freshly-swapped ship parts.
    try { _applyAddonsToShip(); } catch(_){}
    if (_open) {
      _thrInit();
      try { _forceShipOpaque(); } catch(_){}
      _thrSyncColor();
      _thrShow(true);
    }
  }

  // EDIT mode (tuner sliders) removed — layout is CSS-driven only.
  // Clean up any legacy localStorage keys from the old EDIT panel so they
  // don't linger in dev consoles.
  try {
    localStorage.removeItem('jh_showroom_layout_v2_l');
    localStorage.removeItem('jh_showroom_layout_v2_p');
    localStorage.removeItem('jh_showroom_layout_v2');
  } catch(_){}

  window.Showroom = {
    open: open,
    close: close,
    refresh: refresh,
    tick: tick,
    syncColor: syncColor,
    resetThrusterAnchors: resetThrusterAnchors,
    isOpen: function() { return _open; },
  };
})();
