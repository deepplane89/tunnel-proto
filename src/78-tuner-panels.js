// ─────────────────────────────────────────────────────────────────────────
// TUNER PANELS — Dev-only UI overlays for live game tuning.
// ─────────────────────────────────────────────────────────────────────────
//
// This file is a unity-build extraction. Every block in here is pure UI:
// builds a DOM panel, wires sliders/buttons, registers a hotkey.
// Gameplay code stays in its origin file. Panels read/write module-scoped
// `_*Tuner` data objects that live where the gameplay reads them.
//
// Hotkeys (only fire while `state.phase === 'playing'`, except as noted):
//   T — Scene Tuner (FEEL macros, thrusters, bloom, sun, stars, etc.)
//   V — Canyon Tuner panel (slab geometry, materials, presets)
//   B — toggle EXPERIMENTAL canyon (mode 5) for testing
//   K — toggle L4-RECREATION canyon (bent-slab, experimental)
//   W — Angled-Wall random-spawn tuner (also: not on title — title W = water)
//
// Touch gestures:
//   Triple-tap title heading → admin mode toggle (no-spawn, edge-case)
//
// Cross-file dependencies that MUST exist by the time these run:
//   - module-scoped tuner data: _awRandTuner, _ringTuner, _canyonTuner,
//     _CANYON_PRESETS, etc. (declared in 20/40/67)
//   - apply/recreate fns: _ringApplyTuner, _ringRecreate, _spawnLightning,
//     _LT, _asteroidTuner, etc.
//   - `state` object (declared in 20)
//   - DOM (registered on keydown / via load-time IIFEs)
//
// Load order: this file's name (78-) runs AFTER 20, 40, 60, 67, 70, 72.
// All globals it references are already in scope.
// ─────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════
// AW (Angled-Wall random spawn) tuner — moved from 20-main-early.js
// Hotkey: W (skipped on title — title W toggles water mirror)
// Reads/writes module-scoped _awRandTuner. Calls window._awFire/_awLoop/_awLog/_awReset.
// ═══════════════════════════════════════════════════════════════════════
// ── Mobile-friendly tuner panel (tap +/- to nudge each knob) ──
// Toggle with window._awPanel(true/false). Off by default. Keys to nudge:
// xOffset, spacingX, copiesX, spacingY, copiesY, spacingZ, copiesZ, angle, zSpacing, wallW, wallH.
window._awPanel = function(on) {
  let panel = document.getElementById('aw-tuner-panel');
  if (on === false) { if (panel) panel.remove(); window._awPanelSync = null; return; }
  if (panel) return; // already open

  const T = _awRandTuner;
  const KNOBS = [
    { k: 'wallW',      step: 0.5, label: 'Wall width' },
    { k: 'wallH',      step: 0.5, label: 'Wall height' },
    { k: 'angleMin',   step: 2,   label: 'Angle min (deg)' },
    { k: 'angleMax',   step: 2,   label: 'Angle max (deg)' },
    { k: 'countMin',   step: 1,   label: 'Walls/row min', int: true },
    { k: 'countMax',   step: 1,   label: 'Walls/row max', int: true },
    { k: 'laneGap',    step: 1,   label: 'Min lane gap', int: true },
    { k: 'fireRows',   step: 5,   label: 'FIRE rows', int: true },
    { k: 'fireRowGap', step: 5,   label: 'FIRE row Z-gap' },
    { k: 'fireJitter', step: 1,   label: 'FIRE Z jitter' },
  ];

  panel = document.createElement('div');
  panel.id = 'aw-tuner-panel';
  panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:rgba(0,10,25,0.92);color:#9cf;font:11px/1.3 monospace;padding:8px;border:1px solid #0af;border-radius:6px;max-width:260px;max-height:80vh;overflow-y:auto;user-select:none;-webkit-user-select:none;';

  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-weight:bold;color:#0ff;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;';
  hdr.innerHTML = '<span>AW TUNER</span><span id="aw-tp-close" style="cursor:pointer;color:#f66;padding:2px 6px;">✕</span>';
  panel.appendChild(hdr);

  const rowEls = {};
  KNOBS.forEach(({ k, step, label, int }) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin:3px 0;';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'flex:1;font-size:10px;color:#8bc;';
    lbl.textContent = label;
    const minus = document.createElement('button');
    minus.textContent = '−'; minus.style.cssText = 'width:26px;height:26px;background:#024;color:#9cf;border:1px solid #0af;border-radius:3px;font-size:14px;cursor:pointer;touch-action:manipulation;';
    const val = document.createElement('div');
    val.style.cssText = 'width:52px;text-align:center;color:#0ff;font-weight:bold;';
    const plus = document.createElement('button');
    plus.textContent = '+'; plus.style.cssText = minus.style.cssText;
    const refresh = () => { val.textContent = int ? String(T[k]) : (+T[k]).toFixed(1); };
    refresh();
    rowEls[k] = refresh;
    minus.onclick = () => { T[k] = int ? Math.max(1, T[k] - step) : Math.max(0, T[k] - step); refresh(); };
    plus.onclick  = () => { T[k] = T[k] + step; refresh(); };
    row.appendChild(lbl); row.appendChild(minus); row.appendChild(val); row.appendChild(plus);
    panel.appendChild(row);
  });

  // Action buttons
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:4px;margin-top:8px;';
  const mkBtn = (txt, col, fn) => {
    const b = document.createElement('button');
    b.textContent = txt;
    b.style.cssText = 'flex:1;padding:6px;background:#013;color:'+col+';border:1px solid '+col+';border-radius:3px;cursor:pointer;font-size:11px;touch-action:manipulation;';
    b.onclick = fn;
    return b;
  };
  actions.appendChild(mkBtn('FIRE',  '#0f0', () => window._awFire()));
  const loopBtn = mkBtn(window._awLoopActive ? 'STOP' : 'LOOP', '#0ff', () => window._awLoop());
  actions.appendChild(loopBtn);
  actions.appendChild(mkBtn('LOG',   '#ff0', () => window._awLog()));
  actions.appendChild(mkBtn('RESET', '#f66', () => window._awReset()));
  window._awLoopBtnSync = () => {
    loopBtn.textContent = window._awLoopActive ? 'STOP' : 'LOOP';
    loopBtn.style.background = window._awLoopActive ? '#032' : '#013';
  };
  panel.appendChild(actions);

  document.body.appendChild(panel);
  document.getElementById('aw-tp-close').onclick = () => window._awPanel(false);

  window._awPanelSync = () => { KNOBS.forEach(({k}) => rowEls[k] && rowEls[k]()); };
};

// Hotkey W: toggle AW tuner panel (not on title screen — W there toggles water)
try {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'w' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.phase === 'title') return; // don't conflict with water toggle
    const open = !!document.getElementById('aw-tuner-panel');
    window._awPanel(open ? false : true);
  });
} catch(_) {}

// ═══════════════════════════════════════════════════════════════════════
// RING tuner — moved from 67-main-late.js
// Build/show panel for bonus rings. Toggle: window._ringToggle() (called
// from 60-main-late.js title-cog menu). Reads/writes _ringTuner; updates
// _bonusRings live; respawn helpers _ringSpawnRow/_ringRemoveAll/_ringApplyTuner.
// `let _ringTunerPanel` declaration STAYS in 67 (read by _ringToggle).
// ═══════════════════════════════════════════════════════════════════════
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
      _setDRSpeed(0, 'RING_PAUSE');
      state._ringFrozen = true; // flag checked by update loop to skip game logic
      e.target.textContent = 'PLAY';
      e.target.style.background = '#f66';
    } else {
      _setDRSpeed(state._ringSavedSpeed || BASE_SPEED, 'RING_PAUSE');
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

// ═══════════════════════════════════════════════════════════════════════
// CANYON tuner panel — moved from 67-main-late.js
// Hotkeys: V toggles panel, B spawns/clears EXPERIMENTAL canyon (mode 5),
// K spawns/clears L4-RECREATION canyon. All gated by state.phase==="playing".
// Reads/writes module-scoped _canyonTuner, _canyonActive, _canyonWalls,
// _canyonMode, _canyonExiting, _canyonManual, _canyonSinePhase,
// _canyonSavedDirLight, _l4RowsElapsed, _CANYON_PRESETS, _CANYON_LIGHT_DEFS,
// _jlCorridor, dirLight, state. Function deps (hoisted): _destroyCanyonWalls,
// _createCanyonWalls, _canyonPredictCenter, _canyonPredictHalfX,
// _canyonHalfXAtZ, _l4SineAtZ, _bakeSlabCurveForL4.
// ═══════════════════════════════════════════════════════════════════════
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
    if (panelVisible) buildPanel();
  });
})();

// ═══════════════════════════════════════════════════════════════════════
// SCENE tuner — moved from 72-main-late-mid.js
// Hotkey: T toggles panel. Massive multi-section panel covering FEEL macros,
// thrusters, bloom, sun, stars, fog, FOV, ship roll/pitch, water, etc.
// All reads/writes go through window._* properties or module-scoped lets
// declared in 20/05/65 (no panel-internal mutation of cross-file state).
// ═══════════════════════════════════════════════════════════════════════
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

    // ════════════════════════════════════════════════════════════════════
    //  FEEL (MACRO) — 3 high-level knobs that drive multiple fine sliders.
    //  At 0.5 each, all child values match the current live baseline
    //  (no change). Sliding moves several child knobs together along a
    //  perceptually-meaningful axis. After moving a macro, the fine
    //  sliders below still work — the macro is just a fast preset dial.
    //  Press "RESET MACROS" to snap all three back to 0.5 (neutral).
    // ════════════════════════════════════════════════════════════════════
    panel.appendChild(makeHeader('FEEL (MACRO)', '#0fa'));

    // Per-macro state lives on window so it survives panel rebuilds.
    // Migration: old shape had {resp, settle, world}; new shape adds bank/horizon/juice.
    if (window._feelMacro == null) window._feelMacro = { resp: 0.5, latSpd: 0.5, settle: 0.5, bank: 0.5, horizon: 0.5, juice: 0.5 };
    if (window._feelMacro.bank    == null) window._feelMacro.bank    = 0.5;
    if (window._feelMacro.horizon == null) window._feelMacro.horizon = (window._feelMacro.world != null ? window._feelMacro.world : 0.5);
    if (window._feelMacro.juice   == null) window._feelMacro.juice   = 0.5;
    if (window._feelMacro.latSpd  == null) window._feelMacro.latSpd  = 0.5;
    const _fm = window._feelMacro;

    // Description text
    const _macroDesc = document.createElement('div');
    _macroDesc.style.cssText = 'color:#0fa;font-size:10px;margin:2px 0 6px 0;font-family:monospace;line-height:1.4;opacity:0.85;';
    _macroDesc.innerHTML =
      '<b>RESPONSIVENESS</b>: input→motion latency (floaty↔twitchy)<br>' +
      '<b>SETTLE</b>: how fast motion stops after release (long glide↔parks on dime)<br>' +
      '<b>BANK INTENSITY</b>: how hard the ship rolls into a turn<br>' +
      '<b>HORIZON COUPLING</b>: rigid → committed-turn (Race-the-Sun) → continuous (Wipeout)<br>' +
      '<b>JUICE</b>: organic feedback — wobble, overshoot, micro-drift (surgical↔alive)';
    panel.appendChild(_macroDesc);

    // Mobile-tuning hint — reminds why preset values look conservative on RESP/HORIZON/JUICE.
    const _mobileHint = document.createElement('div');
    _mobileHint.style.cssText = 'color:#888;font-size:9px;margin:0 0 6px 0;font-family:monospace;line-height:1.3;font-style:italic;';
    _mobileHint.textContent = 'Presets tuned for mobile touch: digital input, ~50ms lag, close-screen vestibular sensitivity.';
    panel.appendChild(_mobileHint);

    // Helper: linear scale around baseline. macro=0.5 -> 1.0x baseline.
    // macro=0.0 -> lowMul, macro=1.0 -> highMul.
    function _macroScale(macro, lowMul, highMul) {
      // 0→0.5→1.0  maps to  lowMul→1.0→highMul
      if (macro <= 0.5) return lowMul + (1.0 - lowMul) * (macro / 0.5);
      return 1.0 + (highMul - 1.0) * ((macro - 0.5) / 0.5);
    }
    // Helper: smooth interp across three control points (low, mid, high).
    // macro=0→0.5 lerps low→mid; 0.5→1.0 lerps mid→high.
    function _macroLerp3(macro, low, mid, high) {
      if (macro <= 0.5) return low + (mid - low) * (macro / 0.5);
      return mid + (high - mid) * ((macro - 0.5) / 0.5);
    }

    // RESPONSIVENESS — input→motion latency. Higher = snappier.
    // Drives lateral ACCELERATION (how immediately the ship reacts to input)
    // plus the smoothing rates for bank/pitch/yaw lerps. Per Swink (Game Feel),
    // accel and max-speed are perceptually distinct dimensions — max-speed is
    // its own LATERAL SPEED macro below. Baselines match in-game gameplay
    // values (DR/JL/tutorial/campaign all set _accelBase=60, _accelSnap=100),
    // so m=0.5 (k=1.0) leaves gameplay accel unchanged.
    function _applyResponsiveness(m) {
      const k = _macroScale(m, 0.4, 1.6); // 0.0 → 0.4x, 0.5 → 1.0x, 1.0 → 1.6x
      _accelBase     = 60  * k;
      _accelSnap     = 100 * k;
      _bankSmoothing = 8   * k;
      _pitchSmoothing= 5   * k;
      _yawSmoothing  = 12  * k;
    }

    // LATERAL SPEED — how far across the canyon the ship can slide.
    // Scales _maxVelBase / _maxVelSnap (lateral velocity ceiling).
    // m=0.5 (k=1.0) matches in-game baseline (13/23). m=1.0 (k=1.6)
    // gives Wipeout-tier reach (20.8/36.8). m=0 (k=0.4) is mushy/glide.
    // Separated from RESPONSIVENESS per Swink: high accel + low max-vel
    // feels twitchy-but-precise (Star Fox), high accel + high max-vel
    // feels committed-slide (Wipeout) — same RESP, totally different ship.
    function _applyLateralSpeed(m) {
      const k = _macroScale(m, 0.4, 1.6);
      _maxVelBase = 13 * k;
      _maxVelSnap = 23 * k;
    }

    // SETTLE — how long motion lingers after input release.
    // Higher = parks faster (heavier decay, faster return rates).
    function _applySettle(m) {
      const k = _macroScale(m, 0.4, 2.0); // 0.0 → 0.4x, 0.5 → 1.0x, 1.0 → 2.0x
      _decelBasePct        = 0.02 * k;
      _decelFullPct        = 0.05 * k;
      _bankReturnSmoothing = 8    * k;
      _bankReturnRate      = 12   * k;
      _overshootDamp       = 6    * k;
    }

    // BANK INTENSITY — how hard the ship rolls into a turn.
    // Scales _steerBankRadMax (hard radian cap on held-steering bank).
    // Three control points span the industry-standard range:
    //   m=0.0 → 0.35 rad (~20°)  Race-the-Sun / subtle
    //   m=0.5 → 0.52 rad (~30°)  Jet Horizon house style / Wipeout HD baseline
    //   m=1.0 → 0.79 rad (~45°)  HARD UPPER LIMIT — past this the brain reads it
    //                              as a barrel roll, not a steering turn (per Star Fox/
    //                              Wipeout reference research). The knife-edge mode
    //                              (state.rollAngle, capped ±π/2) is a separate axis.
    function _applyBankIntensity(m) {
      _steerBankRadMax = _macroLerp3(m, 0.35, 0.52, 0.79);
      // Belt-and-suspenders cap.
      if (_steerBankRadMax > 0.79) _steerBankRadMax = 0.79;
      if (_steerBankRadMax < 0.05) _steerBankRadMax = 0.05;
    }

    // HORIZON COUPLING — how much the world tilts with the ship's bank.
    // Direct linear multiplier on shipGroup.rotation.z. The ship bank itself is
    // already smoothed (_bankSmoothing lerp), so the horizon inherits that
    // smoothness — no deadzone, no curve, no temporal lerp needed.
    // Three control points along the perceptual axis:
    //   m=0.0 → rigid horizon (Star Fox SNES):   _camRollAmt = 0.0
    //   m=0.5 → committed-turn (Race-the-Sun):   _camRollAmt = 0.4
    //   m=1.0 → continuous-coupled (Wipeout):    _camRollAmt = 0.64
    function _applyHorizonCoupling(m) {
      _camRollAmt = _macroLerp3(m, 0.0, 0.4, 0.64);
      if (_camRollAmt > 1.0) _camRollAmt = 1.0; // hard-clamp to fine-slider range
    }

    // JUICE — organic feedback layer. Surgical (0) ↔ alive (1).
    // Scales wobble, overshoot, and micro-turbulence together. Absolute mapping
    // (not multiplicative) because some baselines are zero.
    function _applyJuice(m) {
      _wobbleMaxAmp  = _macroLerp3(m, 0.0,  0.05, 0.15);
      // Damping inverts with JUICE — high JUICE = low damping = wobble rings
      // longer. At 20 the wobble dies in ~150ms (surgical); at 4 it rings
      // for ~750ms (alive). 10 = baked legacy feel.
      _wobbleDamping = _macroLerp3(m, 20,   10,   4);
      _overshootAmt  = _macroLerp3(m, 0.0,  0.0,  0.5);
      _turbulence    = _macroLerp3(m, 0.0,  0.0,  0.15);
      // Hard-clamp to fine-slider ranges.
      if (_wobbleMaxAmp  > 0.5) _wobbleMaxAmp  = 0.5;
      if (_wobbleDamping < 1)   _wobbleDamping = 1;
      if (_wobbleDamping > 30)  _wobbleDamping = 30;
      if (_overshootAmt  > 1.0) _overshootAmt  = 1.0;
      if (_turbulence    > 0.5) _turbulence    = 0.5;
    }

    // Apply on initial build so live values reflect current macro state.
    _applyResponsiveness(_fm.resp);
    _applyLateralSpeed(_fm.latSpd);
    _applySettle(_fm.settle);
    _applyBankIntensity(_fm.bank);
    _applyHorizonCoupling(_fm.horizon);
    _applyJuice(_fm.juice);

    // ── PRESETS row ──────────────────────────────────────────────────
    // Four hand-tuned macro snapshots covering perceptually distinct flavors.
    // Each preset sets all 5 macros + refreshes the panel so all sliders
    // (macro AND fine) reflect the new live values.
    // Values are research-backed against actual game references AND mobile-tuned.
    // Mobile constraints driving the tuning:
    //   1. Touch is digital (full-on/full-off), so analog-strength assumptions fail.
    //   2. Touch input lag is ~50ms minimum — RESPONSIVENESS above ~0.7 is wasted.
    //   3. Long sustained presses dominate — SETTLE feel matters more than RESP.
    //   4. Close-screen vestibular sensitivity — high HORIZON coupling is nauseating.
    //   5. No analog micro-corrections — JUICE/wobble is perceptually amplified.
    //
    //   GLIDE   — Race-the-Sun feel: ~22° bank, long deceleration, modest horizon.
    //   RAIL    — Star Fox SNES feel: ~25° bank, rigid horizon, no juice (surgical).
    //   WIPEOUT — Modern Wipeout feel: ~36° bank (mobile-trimmed from 38°), RtS-deadzone
    //              horizon (NOT continuous — too much on a phone), moderate inertia.
    //   JET     — Jet Horizon house style: ~30° bank, RtS deadzone horizon (committed
    //              turns), snappy-but-not-twitchy, light juice. The neutral default.
    // Each preset also pins _handlingDriftOverride so JUICE has a chance to land
    // regardless of player level. drift=0 → no wobble (RAIL); drift=0.8 → loose (WIPEOUT).
    // Manual slider edits + reset clear the override (back to player-level driven).
    const _FEEL_PRESETS = {
      GLIDE:   { resp: 0.40, latSpd: 0.30, settle: 0.30, bank: 0.20, horizon: 0.40, juice: 0.35, drift: 0.6 },
      RAIL:    { resp: 0.70, latSpd: 0.45, settle: 0.80, bank: 0.30, horizon: 0.10, juice: 0.05, drift: 0.0 },
      WIPEOUT: { resp: 0.50, latSpd: 0.75, settle: 0.50, bank: 0.70, horizon: 0.55, juice: 0.40, drift: 0.8 },
      JET:     { resp: 0.65, latSpd: 0.55, settle: 0.60, bank: 0.50, horizon: 0.50, juice: 0.30, drift: 0.5 },
    };
    if (window._feelMacro._presetName === undefined) window._feelMacro._presetName = null;
    function _applyFeelPreset(name) {
      const p = _FEEL_PRESETS[name];
      if (!p) return;
      _fm.resp = p.resp; _fm.latSpd = p.latSpd; _fm.settle = p.settle; _fm.bank = p.bank;
      _fm.horizon = p.horizon; _fm.juice = p.juice;
      _fm._presetName = name;
      _applyResponsiveness(p.resp); _applyLateralSpeed(p.latSpd); _applySettle(p.settle);
      _applyBankIntensity(p.bank); _applyHorizonCoupling(p.horizon); _applyJuice(p.juice);
      // Pin handling-drift so preset is source of truth for ship feel.
      _handlingDriftOverride = p.drift;
      build(); panel.style.display = 'block';
    }
    const _presetRow = document.createElement('div');
    _presetRow.style.cssText = 'display:flex;gap:4px;margin:4px 0 8px 0;';
    const _presetMeta = [
      ['GLIDE',   '#7bf', 'low-g arcade flight'],
      ['RAIL',    '#ff7', 'surgical shmup, rigid horizon'],
      ['WIPEOUT', '#f7a', 'heavy racer, dramatic coupling'],
      ['JET',     '#0fa', 'Jet Horizon house style'],
    ];
    _presetMeta.forEach(([name, color, tip]) => {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.title = tip;
      const isActive = (_fm._presetName === name);
      btn.style.cssText =
        'flex:1;background:' + (isActive ? color + '33' : 'none') +
        ';border:1px solid ' + color +
        ';color:' + color +
        ';padding:4px 6px;cursor:pointer;font-family:monospace;font-size:10px;' +
        'border-radius:2px;font-weight:' + (isActive ? 'bold' : 'normal') + ';' +
        'box-shadow:' + (isActive ? '0 0 6px ' + color + '88' : 'none') + ';';
      btn.onclick = () => _applyFeelPreset(name);
      _presetRow.appendChild(btn);
    });
    panel.appendChild(_presetRow);

    // Manual slider edit drops out of preset mode AND releases the drift override
    // (back to player-level handling tier).
    function _exitPresetMode() { _fm._presetName = null; _handlingDriftOverride = -1; }
    panel.appendChild(makeSlider('RESPONSIVENESS', _fm.resp, 0, 1, 0.02, v => {
      _fm.resp = v; _exitPresetMode(); _applyResponsiveness(v);
    }, '#0fa'));
    panel.appendChild(makeSlider('LATERAL SPEED', _fm.latSpd, 0, 1, 0.02, v => {
      _fm.latSpd = v; _exitPresetMode(); _applyLateralSpeed(v);
    }, '#0fa'));
    panel.appendChild(makeSlider('SETTLE', _fm.settle, 0, 1, 0.02, v => {
      _fm.settle = v; _exitPresetMode(); _applySettle(v);
    }, '#0fa'));
    panel.appendChild(makeSlider('BANK INTENSITY', _fm.bank, 0, 1, 0.02, v => {
      _fm.bank = v; _exitPresetMode(); _applyBankIntensity(v);
    }, '#0fa'));
    panel.appendChild(makeSlider('HORIZON COUPLING', _fm.horizon, 0, 1, 0.02, v => {
      _fm.horizon = v; _exitPresetMode(); _applyHorizonCoupling(v);
    }, '#0fa'));
    panel.appendChild(makeSlider('JUICE', _fm.juice, 0, 1, 0.02, v => {
      _fm.juice = v; _exitPresetMode(); _applyJuice(v);
    }, '#0fa'));

    // RESET MACROS button — snap all five back to 0.5 (neutral baseline).
    const _macroResetBtn = document.createElement('button');
    _macroResetBtn.textContent = '⇺ RESET MACROS → NEUTRAL (0.5)';
    _macroResetBtn.style.cssText = 'background:none;border:1px solid #0fa;color:#0fa;padding:3px 8px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:6px 0 4px;width:100%;text-align:left;';
    _macroResetBtn.onclick = () => {
      _fm.resp = 0.5; _fm.latSpd = 0.5; _fm.settle = 0.5; _fm.bank = 0.5; _fm.horizon = 0.5; _fm.juice = 0.5;
      _fm._presetName = null;
      _handlingDriftOverride = -1; // release pin → player-level drift returns
      _applyResponsiveness(0.5); _applyLateralSpeed(0.5); _applySettle(0.5); _applyBankIntensity(0.5); _applyHorizonCoupling(0.5); _applyJuice(0.5);
      build(); // rebuild panel so all sliders (macro AND fine) reflect new values
      panel.style.display = 'block';
    };
    panel.appendChild(_macroResetBtn);

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

    panel.appendChild(makeHeader('THRUSTERS — GLOBAL'));

    // ── Preset engine (data lives in src/05-thruster-presets.js) ──
    // Mutually exclusive: turning one ON turns all others OFF.
    // Capture baseline once on first build so 'restore' is always available.
    const _THR_PRESETS = window._THRUSTER_PRESETS || {};
    const _captureLiveThrValues = () => {
      const snap = {};
      // Sample every key any preset sets (union), so baseline can restore them all.
      const allKeys = new Set();
      Object.values(_THR_PRESETS).forEach(p => { if (p) Object.keys(p).forEach(k => allKeys.add(k)); });
      allKeys.forEach(k => {
        if (k === 'label') return;
        if (k === '_pointMatSize') {
          try { snap[k] = thrusterSystems[0].points.material.size; } catch(_){}
        } else if (k === '_miniPointMatSize') {
          try { snap[k] = miniThrusterSystems[0].points.material.size; } catch(_){}
        } else if (k === 'nozL' || k === 'nozR') {
          if (typeof NOZZLE_OFFSETS !== 'undefined' && NOZZLE_OFFSETS[0]) {
            const v = (k === 'nozL') ? NOZZLE_OFFSETS[0] : NOZZLE_OFFSETS[1];
            snap[k] = [v.x, v.y, v.z];
          }
        } else if (k === 'miniL' || k === 'miniR') {
          if (typeof MINI_NOZZLE_OFFSETS !== 'undefined' && MINI_NOZZLE_OFFSETS[0]) {
            const v = (k === 'miniL') ? MINI_NOZZLE_OFFSETS[0] : MINI_NOZZLE_OFFSETS[1];
            snap[k] = [v.x, v.y, v.z];
          }
        } else if (k.startsWith('_')) {
          snap[k] = window[k];
        }
      });
      return snap;
    };
    const _writeThrValues = (P) => {
      Object.keys(P).forEach(k => {
        if (k === 'label') return;
        const v = P[k];
        if (v == null) return;
        if (k === '_pointMatSize') {
          try { thrusterSystems.forEach(s => s.points.material.size = v); } catch(_){}
        } else if (k === '_miniPointMatSize') {
          try { miniThrusterSystems.forEach(s => s.points.material.size = v); } catch(_){}
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
        } else if (k.startsWith('_')) {
          window[k] = v;
        }
      });
      try { _rebuildLocalNozzles(); } catch(_){}
    };
    // Lazy-capture baseline on first panel build (only if not already set).
    if (!_THR_PRESETS.baseline) {
      _THR_PRESETS.baseline = Object.assign({ label: 'BASELINE' }, _captureLiveThrValues());
    }
    const _applyThrPreset = (key) => {
      const P = _THR_PRESETS[key];
      if (!P) return;
      _writeThrValues(P);
      window._activeThrusterPreset = key;
    };
    // Render one button per preset. Active preset is highlighted green.
    const _thrPresetBtns = {};
    const _renderThrPresetBtns = () => {
      Object.keys(_thrPresetBtns).forEach(key => {
        const btn = _thrPresetBtns[key];
        const on = window._activeThrusterPreset === key;
        const label = (_THR_PRESETS[key] && _THR_PRESETS[key].label) || key;
        btn.textContent = label + (on ? ': ON' : '');
        btn.style.cssText = 'background:' + (on ? '#040' : '#400') + ';color:#fff;border:1px solid ' + (on ? '#0f0' : '#f00') + ';padding:6px 12px;cursor:pointer;font:11px monospace;margin:0 0 4px 0;display:block;width:100%;font-weight:bold;';
      });
    };
    Object.keys(_THR_PRESETS).forEach(key => {
      if (!_THR_PRESETS[key]) return;
      const btn = document.createElement('button');
      btn.addEventListener('click', () => {
        _applyThrPreset(key);
        _renderThrPresetBtns();
        try { panel.innerHTML = ''; build(); } catch(_){}
      });
      _thrPresetBtns[key] = btn;
      panel.appendChild(btn);
    });
    _renderThrPresetBtns();

    panel.appendChild(makeSlider('nozzle pulse depth', window._nozzleBloomPulse != null ? window._nozzleBloomPulse : 0.15, 0, 0.5, 0.01, v => { window._nozzleBloomPulse = v; }, '#f60'));

    // ★★ PRIMARY white-hot dials — scale additive pile-up at the nozzle.
    // particle opacity = how much each particle contributes to additive stack (1.0 → saturates to white)
    // pos-pin frac    = how long particles stay clamped to nozzle pos (longer → more pile-up)
    panel.appendChild(makeSlider('★★ particle opacity',     window._thrPart_partOpacity != null ? window._thrPart_partOpacity : 1.0, 0.05, 1.0, 0.01, v => { window._thrPart_partOpacity = v; }, '#f00'));
    panel.appendChild(makeSlider('★★ mini particle opacity',window._thrPart_miniPartOpacity != null ? window._thrPart_miniPartOpacity : 1.0, 0.05, 1.0, 0.01, v => { window._thrPart_miniPartOpacity = v; }, '#f00'));
    panel.appendChild(makeSlider('★★ pos-pin frac (pile-up)', window._thrPart_posPinFrac != null ? window._thrPart_posPinFrac : 0.12, 0.0, 0.30, 0.005, v => { window._thrPart_posPinFrac = v; }, '#f00'));
    panel.appendChild(makeSlider('thruster scale', window._thrusterScale || 1.0, 0, 3, 0.05, v => { window._thrusterScale = v; }, '#f60'));
    panel.appendChild(makeSlider('point material size', thrusterSystems[0].points.material.size, 0.01, 1.0, 0.01, v => {
      thrusterSystems.forEach(s => s.points.material.size = v);
    }, '#f60'));
    panel.appendChild(makeSlider('mini point mat size', miniThrusterSystems[0].points.material.size, 0.01, 0.5, 0.01, v => {
      miniThrusterSystems.forEach(s => s.points.material.size = v);
    }, '#f60'));
    panel.appendChild(makeSlider('nozzle bloom size', window._nozzleBloomScale != null ? window._nozzleBloomScale : 1.0, 0.1, 4, 0.05, v => { window._nozzleBloomScale = v; }, '#f60'));
    panel.appendChild(makeSlider('nozzle bloom opacity', window._nozzleBloomOpacity != null ? window._nozzleBloomOpacity : 0.34, 0, 1, 0.01, v => { window._nozzleBloomOpacity = v; }, '#f60'));
    // ★ PRIMARY white-hot dial: 0 = pure thruster color sprite (cool), 1 = pure white sprite (current default look at 0)
    panel.appendChild(makeSlider('★ nozzle white-mix', window._nozzleBloom_whiteMix != null ? window._nozzleBloom_whiteMix : 0.0, 0, 1, 0.02, v => { window._nozzleBloom_whiteMix = v; }, '#ff0'));
    panel.appendChild(makeSlider('mini bloom size', window._miniBloomScale != null ? window._miniBloomScale : 1.0, 0.05, 2, 0.05, v => { window._miniBloomScale = v; }, '#f60'));
    panel.appendChild(makeSlider('mini bloom opacity', window._miniBloomOpacity != null ? window._miniBloomOpacity : 0.15, 0, 1, 0.01, v => { window._miniBloomOpacity = v; }, '#f60'));
    panel.appendChild(makeSlider('mini bloom op‧spd', window._miniBloomOpacitySpd != null ? window._miniBloomOpacitySpd : 0.15, 0, 1, 0.01, v => { window._miniBloomOpacitySpd = v; }, '#f60'));
    panel.appendChild(makeSlider('★ mini white-mix', window._miniBloom_whiteMix != null ? window._miniBloom_whiteMix : 0.0, 0, 1, 0.02, v => { window._miniBloom_whiteMix = v; }, '#ff0'));

    // ── Particle SYSTEM (the long bright streaks) ──
    // Removed duds (clamped by additive pile-up so they had no perceivable effect at default settings):
    //   p.coreEnd, p.coreR, p.coreGB — superseded by ★★ particle opacity / pos-pin frac in GLOBAL.
    panel.appendChild(makeHeader('THRUSTER PARTICLES'));
    // Trail bend response (turn-in / turn-out feel)
    panel.appendChild(makeSlider('p.bendInherit (turn responsiveness)', window._thrPart_bendInherit != null ? window._thrPart_bendInherit : 0.15, 0, 0.6, 0.005, v => { window._thrPart_bendInherit = v; }, '#0fa'));
    panel.appendChild(makeSlider('p.bendCatchup (legacy drag, 0=off)', window._thrPart_bendCatchup != null ? window._thrPart_bendCatchup : 0.0, 0, 6, 0.1, v => { window._thrPart_bendCatchup = v; }, '#0fa'));
    panel.appendChild(makeSlider('p.midEnd (mid → fade @)',     window._thrPart_midEnd   != null ? window._thrPart_midEnd   : 0.65, 0.10, 0.99, 0.01, v => { window._thrPart_midEnd   = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.midBoost (HDR boost)',      window._thrPart_midBoost != null ? window._thrPart_midBoost : 0.30, 0, 2.0,  0.01, v => { window._thrPart_midBoost = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.sizeBase',                  window._thrPart_sizeBase   != null ? window._thrPart_sizeBase  : 0.22, 0.05, 0.6, 0.01, v => { window._thrPart_sizeBase   = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.sizeSpeed (size‧speed)',    window._thrPart_sizeSpeed  != null ? window._thrPart_sizeSpeed : 0.10, 0, 0.5,  0.01, v => { window._thrPart_sizeSpeed  = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.bumpMult (nozzle bump×)',   window._thrPart_bumpMult   != null ? window._thrPart_bumpMult  : 1.60, 1.0, 3.0, 0.05, v => { window._thrPart_bumpMult   = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.bumpEnd (bump duration)',   window._thrPart_bumpEnd    != null ? window._thrPart_bumpEnd   : 0.10, 0, 0.30, 0.005, v => { window._thrPart_bumpEnd  = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.sizeJitter',                window._thrPart_sizeJitter != null ? window._thrPart_sizeJitter: 0.06, 0, 0.2,  0.005, v => { window._thrPart_sizeJitter = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.lifeMin',                   window._thrPart_lifeMin != null ? window._thrPart_lifeMin : 0.18, 0.05, 0.5, 0.01, v => { window._thrPart_lifeMin = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.lifeJit',                   window._thrPart_lifeJit != null ? window._thrPart_lifeJit : 0.22, 0,    0.5, 0.01, v => { window._thrPart_lifeJit = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.lifeBase (life floor)',     window._thrPart_lifeBase != null ? window._thrPart_lifeBase : 0.6, 0.2, 1.5, 0.05, v => { window._thrPart_lifeBase = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.lifeSpd (life‧speed)',      window._thrPart_lifeSpd != null ? window._thrPart_lifeSpd : 0.9, 0,   2.0, 0.05, v => { window._thrPart_lifeSpd = v; }, '#fa0'));
    panel.appendChild(makeSlider('p.spawnJit (spawn radius)',   window._thrPart_spawnJit != null ? window._thrPart_spawnJit : 0.03, 0, 0.20, 0.005, v => { window._thrPart_spawnJit = v; }, '#fa0'));

    // ── Flame mesh (the small near-nozzle puff) ──
    panel.appendChild(makeHeader('THRUSTER FLAME MESH'));
    panel.appendChild(makeSlider('f.coreEnd',                   window._thrFlame_coreEnd != null ? window._thrFlame_coreEnd : 0.08, 0, 0.30, 0.005, v => { window._thrFlame_coreEnd = v; }, '#f80'));
    panel.appendChild(makeSlider('f.coreRGB (white start)',     window._thrFlame_coreRGB != null ? window._thrFlame_coreRGB : 0.85, 0, 1, 0.01, v => { window._thrFlame_coreRGB = v; }, '#f80'));
    panel.appendChild(makeSlider('f.midEnd',                    window._thrFlame_midEnd  != null ? window._thrFlame_midEnd  : 0.60, 0.10, 0.99, 0.01, v => { window._thrFlame_midEnd  = v; }, '#f80'));
    panel.appendChild(makeSlider('f.sizeBase',                  window._thrFlame_sizeBase  != null ? window._thrFlame_sizeBase  : 0.035, 0.005, 0.15, 0.005, v => { window._thrFlame_sizeBase  = v; }, '#f80'));
    panel.appendChild(makeSlider('f.sizeSpeed',                 window._thrFlame_sizeSpeed != null ? window._thrFlame_sizeSpeed : 0.015, 0, 0.10, 0.005, v => { window._thrFlame_sizeSpeed = v; }, '#f80'));
    panel.appendChild(makeSlider('f.bumpMult',                  window._thrFlame_bumpMult  != null ? window._thrFlame_bumpMult  : 1.40, 1.0, 3.0, 0.05, v => { window._thrFlame_bumpMult  = v; }, '#f80'));
    panel.appendChild(makeSlider('f.bumpEnd',                   window._thrFlame_bumpEnd   != null ? window._thrFlame_bumpEnd   : 0.10, 0, 0.30, 0.005, v => { window._thrFlame_bumpEnd  = v; }, '#f80'));
    panel.appendChild(makeSlider('f.lifeMin',                   window._thrFlame_lifeMin != null ? window._thrFlame_lifeMin : 0.05, 0.01, 0.30, 0.005, v => { window._thrFlame_lifeMin = v; }, '#f80'));
    panel.appendChild(makeSlider('f.lifeJit',                   window._thrFlame_lifeJit != null ? window._thrFlame_lifeJit : 0.06, 0,    0.30, 0.005, v => { window._thrFlame_lifeJit = v; }, '#f80'));
    panel.appendChild(makeSlider('f.spawnJit',                  window._thrFlame_spawnJit != null ? window._thrFlame_spawnJit : 0.02, 0, 0.20, 0.005, v => { window._thrFlame_spawnJit = v; }, '#f80'));

    // ── Export button: prints all current thruster settings to console + clipboard ──
    const _expBtn = document.createElement('button');
    _expBtn.textContent = 'EXPORT thruster settings';
    _expBtn.style.cssText = 'margin:6px 0;padding:6px 10px;background:#222;color:#0f0;border:1px solid #0f0;cursor:pointer;font:11px monospace;width:100%;';
    _expBtn.onclick = () => {
      const KEYS = [
        '_thrPart_partOpacity','_thrPart_miniPartOpacity','_thrPart_posPinFrac',
        '_thrPart_bendInherit','_thrPart_bendCatchup',
        '_thrusterScale','_nozzleBloomScale','_nozzleBloomOpacity','_nozzleBloomPulse','_miniBloomScale','_miniBloomOpacity','_miniBloomOpacitySpd',
        '_nozzleBloom_whiteMix','_miniBloom_whiteMix',
        '_thrusterSpreadX','_thrusterSpreadY','_thrusterLength',
        '_thrPart_midEnd','_thrPart_midBoost',
        '_thrPart_sizeBase','_thrPart_sizeSpeed','_thrPart_bumpMult','_thrPart_bumpEnd','_thrPart_sizeJitter',
        '_thrPart_lifeMin','_thrPart_lifeJit','_thrPart_lifeBase','_thrPart_lifeSpd','_thrPart_spawnJit',
        '_thrFlame_coreEnd','_thrFlame_coreRGB','_thrFlame_midEnd',
        '_thrFlame_sizeBase','_thrFlame_sizeSpeed','_thrFlame_bumpMult','_thrFlame_bumpEnd',
        '_thrFlame_lifeMin','_thrFlame_lifeJit','_thrFlame_spawnJit',
      ];
      // De-dup
      const _seen = {}; for (let i = KEYS.length - 1; i >= 0; i--) { if (_seen[KEYS[i]]) KEYS.splice(i,1); else _seen[KEYS[i]] = 1; }
      const out = {};
      KEYS.forEach(k => { if (window[k] !== undefined) out[k] = window[k]; });
      // Material sizes are read off three.js objects, not window
      try { out['_pointMat_size'] = thrusterSystems[0].points.material.size; } catch(_){}
      try { out['_miniPointMat_size'] = miniThrusterSystems[0].points.material.size; } catch(_){}
      const txt = JSON.stringify(out, null, 2);
      console.log('=== THRUSTER SETTINGS EXPORT ===\n' + txt);
      try { navigator.clipboard.writeText(txt); _expBtn.textContent = 'copied to clipboard'; setTimeout(()=>_expBtn.textContent='EXPORT thruster settings', 1500); }
      catch(_) { _expBtn.textContent = 'see console'; setTimeout(()=>_expBtn.textContent='EXPORT thruster settings', 1500); }
    };
    panel.appendChild(_expBtn);

    // NOZZLE POSITIONS (left/right thruster placement)
    const _nozUpd = () => { try { _rebuildLocalNozzles(); } catch(_) {} };
    panel.appendChild(makeHeader('NOZZLES (L/R)'));
    if (typeof NOZZLE_OFFSETS !== 'undefined' && NOZZLE_OFFSETS[0]) {
      panel.appendChild(makeSlider('noz L x', NOZZLE_OFFSETS[0].x, -2, 2, 0.01, v => { NOZZLE_OFFSETS[0].x = v; _nozUpd(); }, '#f80'));
      panel.appendChild(makeSlider('noz L y', NOZZLE_OFFSETS[0].y, -1, 1, 0.01, v => { NOZZLE_OFFSETS[0].y = v; _nozUpd(); }, '#f80'));
      panel.appendChild(makeSlider('noz L z', NOZZLE_OFFSETS[0].z, -2, 7, 0.01, v => { NOZZLE_OFFSETS[0].z = v; _nozUpd(); }, '#f80'));
      panel.appendChild(makeSlider('noz R x', NOZZLE_OFFSETS[1].x, -2, 2, 0.01, v => { NOZZLE_OFFSETS[1].x = v; _nozUpd(); }, '#f80'));
      panel.appendChild(makeSlider('noz R y', NOZZLE_OFFSETS[1].y, -1, 1, 0.01, v => { NOZZLE_OFFSETS[1].y = v; _nozUpd(); }, '#f80'));
      panel.appendChild(makeSlider('noz R z', NOZZLE_OFFSETS[1].z, -2, 7, 0.01, v => { NOZZLE_OFFSETS[1].z = v; _nozUpd(); }, '#f80'));
    }
    if (typeof MINI_NOZZLE_OFFSETS !== 'undefined' && MINI_NOZZLE_OFFSETS[0]) {
      panel.appendChild(makeSlider('mini L x', MINI_NOZZLE_OFFSETS[0].x, -2, 2, 0.01, v => { MINI_NOZZLE_OFFSETS[0].x = v; _nozUpd(); }, '#fa0'));
      panel.appendChild(makeSlider('mini L y', MINI_NOZZLE_OFFSETS[0].y, -1, 1, 0.01, v => { MINI_NOZZLE_OFFSETS[0].y = v; _nozUpd(); }, '#fa0'));
      panel.appendChild(makeSlider('mini L z', MINI_NOZZLE_OFFSETS[0].z, -2, 7, 0.01, v => { MINI_NOZZLE_OFFSETS[0].z = v; _nozUpd(); }, '#fa0'));
      panel.appendChild(makeSlider('mini R x', MINI_NOZZLE_OFFSETS[1].x, -2, 2, 0.01, v => { MINI_NOZZLE_OFFSETS[1].x = v; _nozUpd(); }, '#fa0'));
      panel.appendChild(makeSlider('mini R y', MINI_NOZZLE_OFFSETS[1].y, -1, 1, 0.01, v => { MINI_NOZZLE_OFFSETS[1].y = v; _nozUpd(); }, '#fa0'));
      panel.appendChild(makeSlider('mini R z', MINI_NOZZLE_OFFSETS[1].z, -2, 7, 0.01, v => { MINI_NOZZLE_OFFSETS[1].z = v; _nozUpd(); }, '#fa0'));
    }

    // CONE THRUSTER (subsection of THRUSTERS)
    panel.appendChild(makeHeader('CONE THRUSTER'));
    const _coneTogBtn = document.createElement('button');
    _coneTogBtn.textContent = window._coneThrustersEnabled ? 'cone thrusters: ON' : 'cone thrusters: OFF';
    _coneTogBtn.style.cssText = 'background:' + (window._coneThrustersEnabled ? '#040' : '#400') + ';color:#fff;border:1px solid ' + (window._coneThrustersEnabled ? '#0f0' : '#f00') + ';padding:4px 12px;cursor:pointer;font:11px monospace;margin:4px 4px 4px 0;display:block;';
    _coneTogBtn.addEventListener('click', () => {
      window._coneThrustersEnabled = !window._coneThrustersEnabled;
      _coneTogBtn.textContent = window._coneThrustersEnabled ? 'cone thrusters: ON' : 'cone thrusters: OFF';
      _coneTogBtn.style.background = window._coneThrustersEnabled ? '#040' : '#400';
      _coneTogBtn.style.borderColor = window._coneThrustersEnabled ? '#0f0' : '#f00';
    });
    panel.appendChild(_coneTogBtn);
    const _coneOldBtn = document.createElement('button');
    _coneOldBtn.textContent = window._hideOldThrusters ? 'old thrusters: OFF' : 'old thrusters: ON';
    _coneOldBtn.style.cssText = 'background:#333;color:#ff6600;border:1px solid #ff6600;padding:4px 12px;cursor:pointer;font:11px monospace;margin:4px 0;display:block;';
    _coneOldBtn.addEventListener('click', () => {
      window._hideOldThrusters = !window._hideOldThrusters;
      _coneOldBtn.textContent = window._hideOldThrusters ? 'old thrusters: OFF' : 'old thrusters: ON';
    });
    panel.appendChild(_coneOldBtn);
    if (window._coneThruster) {
      const _ct = window._coneThruster;
      panel.appendChild(makeSlider('cone length', _ct.length, 0.5, 8, 0.1, v => { _ct.length = v; }, '#f60'));
      panel.appendChild(makeSlider('cone radius', _ct.radius, 0.02, 1, 0.01, v => { _ct.radius = v; }, '#f60'));
      panel.appendChild(makeSlider('cone rotX', _ct.rotX, -3.15, 3.15, 0.01, v => { _ct.rotX = v; }, '#f60'));
      panel.appendChild(makeSlider('cone rotY', _ct.rotY, -3.15, 3.15, 0.01, v => { _ct.rotY = v; }, '#f60'));
      panel.appendChild(makeSlider('cone rotZ', _ct.rotZ, -3.15, 3.15, 0.01, v => { _ct.rotZ = v; }, '#f60'));
      panel.appendChild(makeSlider('cone offX (both)', _ct.offX, -2, 2, 0.01, v => { _ct.offX = v; }, '#f60'));
      panel.appendChild(makeSlider('cone offY (both)', _ct.offY, -2, 2, 0.01, v => { _ct.offY = v; }, '#f60'));
      panel.appendChild(makeSlider('cone offZ (both)', _ct.offZ, -2, 2, 0.01, v => { _ct.offZ = v; }, '#f60'));
      // Per-side independent offsets (added on top of the 'both' offsets above)
      panel.appendChild(makeSlider('cone L offX', _ct.offLX || 0, -1, 1, 0.005, v => { _ct.offLX = v; }, '#fa0'));
      panel.appendChild(makeSlider('cone L offY', _ct.offLY || 0, -1, 1, 0.005, v => { _ct.offLY = v; }, '#fa0'));
      panel.appendChild(makeSlider('cone L offZ', _ct.offLZ || 0, -1, 1, 0.005, v => { _ct.offLZ = v; }, '#fa0'));
      panel.appendChild(makeSlider('cone R offX', _ct.offRX || 0, -1, 1, 0.005, v => { _ct.offRX = v; }, '#fa0'));
      panel.appendChild(makeSlider('cone R offY', _ct.offRY || 0, -1, 1, 0.005, v => { _ct.offRY = v; }, '#fa0'));
      panel.appendChild(makeSlider('cone R offZ', _ct.offRZ || 0, -1, 1, 0.005, v => { _ct.offRZ = v; }, '#fa0'));
      panel.appendChild(makeSlider('neon power', _ct.neonPower, 0.5, 6, 0.1, v => { _ct.neonPower = v; }, '#f60'));
      panel.appendChild(makeSlider('noise speed', _ct.noiseSpeed, 0, 5, 0.1, v => { _ct.noiseSpeed = v; }, '#f60'));
      panel.appendChild(makeSlider('noise strength', _ct.noiseStrength, 0, 1, 0.01, v => { _ct.noiseStrength = v; }, '#f60'));
      panel.appendChild(makeSlider('fresnel power', _ct.fresnelPower, 0.5, 6, 0.1, v => { _ct.fresnelPower = v; }, '#f60'));
      panel.appendChild(makeSlider('cone opacity', _ct.opacity, 0, 1, 0.01, v => { _ct.opacity = v; }, '#f60'));
    }

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
        if (p.speed === 'L4') _setDRSpeed(BASE_SPEED * LEVELS[3].speedMult, 'JL');
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
    panel.appendChild(makeSlider('bank return smooth', _bankReturnSmoothing, 1, 30, 0.5, v => _bankReturnSmoothing = v, '#0af'));
    panel.appendChild(makeSlider('horizon return', _bankReturnRate, 1, 30, 0.5, v => _bankReturnRate = v, '#0af'));
    panel.appendChild(makeSlider('cam roll amt', _camRollAmt, 0, 1.0, 0.02, v => _camRollAmt = v, '#0af'));

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

// ═══════════════════════════════════════════════════════════════════════
// SKIN tuner sliders — moved from 72-main-late-mid.js
// Builds the live material-property slider DOM for the currently-viewed
// ship skin. Called from toggleSkinTuner() (which stays in 72 — it owns
// camera/ship state save+restore). Reads SHIP_SKINS, skinViewerIdx,
// window._shipModel; writes mesh material uniforms in place.
// ═══════════════════════════════════════════════════════════════════════
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
    // Skip groups whose materials are all non-PBR (e.g. Ghost's HolographicMaterial slots).
    // Those get their own dedicated tuner section below.
    if (!mats.some(m => m.color)) return;

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
  //  GHOST HOLO — scoped to this skin's HolographicMaterial slots only.
  //  Writes uniforms directly to the ship's holo materials so it does
  //  NOT touch powerup cubes (which use the same material class).
  // ═══════════════════════════════════════════════════
  {
    const ghostMats = [];
    allMeshes.forEach(({ mesh }) => {
      const m = mesh.material;
      if (m && m.uniforms && m.uniforms.hologramColor) ghostMats.push(m);
    });
    if (ghostMats.length) {
      const ghostHeader = document.createElement('div');
      ghostHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#0df;margin:16px 0 8px;border-top:2px solid #0df;padding-top:8px;';
      ghostHeader.textContent = 'GHOST HOLO';
      container.appendChild(ghostHeader);

      const subtitle = document.createElement('div');
      subtitle.style.cssText = 'font-size:10px;color:#7af;margin:-4px 0 6px;';
      subtitle.textContent = 'Scoped to ship — does not affect powerup cubes';
      container.appendChild(subtitle);

      const sample = ghostMats[0];
      const sv = (k, fb) => (sample.uniforms[k] ? sample.uniforms[k].value : fb);
      const setU = (k, v) => { for (const m of ghostMats) { const u = m.uniforms[k]; if (u) u.value = v; } };

      // Hologram Color — single hue slider (HSL, full saturation/mid lightness).
      const initColor = sv('hologramColor', new THREE.Color('#00d5ff'));
      const initHsl = {}; initColor.getHSL(initHsl);
      container.appendChild(makeSlider('Hue', initHsl.h, 0, 1, 0.005, v => {
        const c = new THREE.Color(); c.setHSL(v, 1.0, 0.5);
        for (const m of ghostMats) m.uniforms.hologramColor.value.copy(c);
      }, '#0df'));

      container.appendChild(makeSlider('Fresnel Opacity',  sv('fresnelOpacity', 0.82),    0, 1,    0.01, v => setU('fresnelOpacity', v),     '#0df'));
      container.appendChild(makeSlider('Fresnel Amount',   sv('fresnelAmount', 0.70),     0, 1,    0.01, v => setU('fresnelAmount', v),      '#0df'));
      container.appendChild(makeSlider('Scanline Size',    sv('scanlineSize', 5.50),      1, 15,   0.1,  v => setU('scanlineSize', v),       '#0df'));
      container.appendChild(makeSlider('Brightness',       sv('hologramBrightness', 1.94),0, 2,    0.01, v => setU('hologramBrightness', v), '#0df'));
      container.appendChild(makeSlider('Signal Speed',     sv('signalSpeed', 0.00),       0, 2,    0.01, v => setU('signalSpeed', v),        '#0df'));
      container.appendChild(makeSlider('Hologram Opacity', sv('hologramOpacity', 0.31),   0, 1,    0.01, v => setU('hologramOpacity', v),    '#0df'));

      // Toggles
      const toggleRow = document.createElement('div');
      toggleRow.style.cssText = 'display:flex;gap:12px;margin:6px 0 8px;font-size:11px;';
      function gMakeToggle(label, initial, onChange) {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = !!initial;
        cb.style.cssText = 'margin:0;cursor:pointer;accent-color:#0df;';
        cb.addEventListener('change', () => onChange(cb.checked));
        const txt = document.createElement('span'); txt.textContent = label;
        wrap.appendChild(cb); wrap.appendChild(txt);
        return wrap;
      }
      toggleRow.appendChild(gMakeToggle('Blinking',           sv('enableBlinking', true),   v => setU('enableBlinking', v)));
      toggleRow.appendChild(gMakeToggle('Blink Fresnel Only', sv('blinkFresnelOnly', true), v => setU('blinkFresnelOnly', v)));
      container.appendChild(toggleRow);
    }
  }

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

  // ══════════════════════════════════════════════════
  //  HOLO POWERUPS — live tuner for the holographic cube material.
  //  Mirrors the controls from Anderson Mancini's demo:
  //    https://threejs-vanilla-holographic-material.vercel.app/
  //  All sliders broadcast to every registered holo material instance
  //  (cubes, icons, shatter fragments) via _broadcastHoloUniform.
  //  Spawner buttons spawn one of each powerup type 30 units in front
  //  of the ship for tweak/test without waiting for the wave director.
  // ══════════════════════════════════════════════════
  if (typeof _broadcastHoloUniform === 'function' && typeof _holoMaterials !== 'undefined') {
    const holoHeader = document.createElement('div');
    holoHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#0df;margin:16px 0 8px;border-top:2px solid #0df;padding-top:8px;';
    holoHeader.textContent = 'HOLO POWERUPS';
    container.appendChild(holoHeader);

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:10px;color:#7af;margin:-4px 0 6px;';
    subtitle.textContent = 'Mirrors threejs-vanilla-holographic-material demo';
    container.appendChild(subtitle);

    // Read initial values from any live material (they all start with the same defaults).
    const sample = _holoMaterials[0];
    const sv = (k, fallback) => (sample && sample.uniforms[k]) ? sample.uniforms[k].value : fallback;

    container.appendChild(makeSlider('Fresnel Opacity',  sv('fresnelOpacity', 1.0),     0, 1,    0.01, v => _broadcastHoloUniform('fresnelOpacity', v),     '#0df'));
    container.appendChild(makeSlider('Fresnel Amount',   sv('fresnelAmount', 0.7),      0, 1,    0.01, v => _broadcastHoloUniform('fresnelAmount', v),      '#0df'));
    container.appendChild(makeSlider('Scanline Size',    sv('scanlineSize', 3.7),       1, 15,   0.1,  v => _broadcastHoloUniform('scanlineSize', v),       '#0df'));
    container.appendChild(makeSlider('Brightness',       sv('hologramBrightness', 1.6), 0, 2,    0.01, v => _broadcastHoloUniform('hologramBrightness', v), '#0df'));
    container.appendChild(makeSlider('Signal Speed',     sv('signalSpeed', 0.18),       0, 2,    0.01, v => _broadcastHoloUniform('signalSpeed', v),        '#0df'));
    container.appendChild(makeSlider('Hologram Opacity', sv('hologramOpacity', 0.7),    0, 1,    0.01, v => _broadcastHoloUniform('hologramOpacity', v),    '#0df'));
    container.appendChild(makeSlider('Cube Size',        (typeof POWERUP_CUBE_SIZE === 'number' ? POWERUP_CUBE_SIZE : 3.5), 1, 7, 0.1, v => {
      // Rescale all powerup groups + shatter fragment planes by uniform scale.
      // We don't rebuild geometry; a group-level scale is cheaper and still reads as bigger.
      const ratio = v / 3.5;
      if (typeof powerupPool !== 'undefined') {
        for (const p of powerupPool) p.userData._sizeScale = ratio;
      }
      // Apply to active groups too.
      if (typeof activePowerups !== 'undefined') {
        for (const p of activePowerups) p.scale.setScalar(ratio);
      }
    }, '#0df'));

    // ── Toggles ──
    const toggleRow = document.createElement('div');
    toggleRow.style.cssText = 'display:flex;gap:12px;margin:6px 0 8px;font-size:11px;';
    function makeToggle(label, initial, onChange) {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!initial;
      cb.style.cssText = 'margin:0;cursor:pointer;accent-color:#0df;';
      cb.addEventListener('change', () => onChange(cb.checked));
      const txt = document.createElement('span'); txt.textContent = label;
      wrap.appendChild(cb); wrap.appendChild(txt);
      return wrap;
    }
    toggleRow.appendChild(makeToggle('Blinking',   sv('enableBlinking', true),   v => _broadcastHoloUniform('enableBlinking', v)));
    toggleRow.appendChild(makeToggle('Blink Fresnel Only', sv('blinkFresnelOnly', true), v => _broadcastHoloUniform('blinkFresnelOnly', v)));
    container.appendChild(toggleRow);

    // ── Manual spawner buttons ──
    const spawnerLabel = document.createElement('div');
    spawnerLabel.style.cssText = 'font-size:11px;color:#0df;margin:8px 0 4px;font-weight:bold;';
    spawnerLabel.textContent = 'Spawn powerup in front of ship:';
    container.appendChild(spawnerLabel);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;';
    const SPAWN_TYPES = [
      { label: 'Shield',   idx: 0, color: '#00f0ff' },
      { label: 'Laser',    idx: 1, color: '#ff5544' },
      { label: 'Overdrive',idx: 2, color: '#ffcc00' },
      { label: 'Magnet',   idx: 3, color: '#44ff88' },
    ];
    SPAWN_TYPES.forEach(t => {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.style.cssText = 'flex:1;padding:6px 8px;background:#222;border:1px solid ' + t.color + ';color:' + t.color + ';font-family:monospace;font-size:10px;cursor:pointer;border-radius:3px;';
      b.addEventListener('click', () => {
        if (typeof getPooledPowerup !== 'function' || typeof activePowerups === 'undefined') return;
        const pu = getPooledPowerup(t.idx);
        if (!pu) { console.warn('[holo tuner] powerup pool exhausted'); return; }
        // Spawn 30u in front of the ship at lane center.
        const z = (typeof shipGroup !== 'undefined' && shipGroup) ? shipGroup.position.z - 30 : -30;
        pu.position.set(state.shipX || 0, 1.5, z);
        activePowerups.push(pu);
      });
      btnRow.appendChild(b);
    });
    container.appendChild(btnRow);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:#578;margin-bottom:4px;';
    hint.textContent = 'Hotkeys (in-game): Z=Shield  X=Laser  C=Overdrive  V=Magnet (spawn cube)';
    container.appendChild(hint);
  }

  // ══════════════════════════════════════════════════
  //  SCENE LIGHTING CONTROLS
  // ══════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// ADMIN mode (triple-tap title) + ship Z/Y + cam-pitch sliders
// Moved from 72-main-late-mid.js. The admin tap toggles _skinAdminMode
// (declared in 20) and grants cheats. The slider IIFEs wire up DOM
// inputs in admin/settings panels to shipGroup/cameraPivot/_hoverBaseY.
// ═══════════════════════════════════════════════════════════════════════
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
    if (tapCount >= 3) {
      clearTimeout(tapTimer); tapCount = 0;
      panel.classList.toggle('hidden');
      // Toggle skin admin mode + grant cheats
      _skinAdminMode = !_skinAdminMode;
      try { updateSkinViewerDisplay(); } catch(_) {}
      if (_skinAdminMode) {
        try { saveCoinWallet(loadCoinWallet() + 99999); _totalCoins = loadCoinWallet(); updateTitleCoins(); } catch(_) {}
        try { saveFuelCells(loadFuelCells() + 9999); updateTitleFuelCells(); } catch(_) {}
        window._cheatCoins = (amount) => { saveCoinWallet(loadCoinWallet() + (amount || 99999)); _totalCoins = loadCoinWallet(); updateTitleCoins(); };
        window._cheatFuel = (amount) => { saveFuelCells(loadFuelCells() + (amount || 9999)); updateTitleFuelCells(); };
        window._cheatLevel = (lvl) => { savePlayerLevel(lvl || 50); savePlayerXP(0); updateTitleLevel(); };
        window._cheatMaxUpgrades = () => { Object.keys(POWERUP_UPGRADES).forEach(id => saveUpgradeTier(id, 5)); };
        window._cheatLadder = (pos) => { saveLadderPos(pos || MISSION_LADDER.length); saveMissionFlags({}); updateTitleFuelCells(); };
        try { localStorage.removeItem(STREAK_KEY_DAY); localStorage.removeItem(STREAK_KEY_LAST); updateStreakBadge(); } catch(_) {}
        window._cheatReset = () => { Object.keys(POWERUP_UPGRADES).forEach(id => saveUpgradeTier(id, 1)); Object.keys(STAT_UPGRADES).forEach(id => saveUpgradeTier(id, 1)); saveCoinWallet(0); saveFuelCells(0); saveFreeHeadStarts(0); saveLadderPos(0); window._LS.removeItem('jetslide_mission_flags'); window._LS.setItem('jetslide_pu_unlocked', '["shield"]'); savePlayerLevel(1); savePlayerXP(0); _totalCoins = 0; updateTitleCoins(); updateTitleFuelCells(); updateTitleLevel(); };
      }
      // Brief yellow flash on title
      const _origColor = titleEl.style.color;
      titleEl.style.color = _skinAdminMode ? '#ff0' : '';
      setTimeout(() => { titleEl.style.color = _origColor; }, 300);
    }
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
