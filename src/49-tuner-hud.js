// ── TUNER + FX HUDs (showroom-only) ─────────────────────────────────────
//
// This module owns the floating tuner panel (drag/wheel/RST/MIR/FLP/ROT)
// and the FX slider stack. All state still lives in the showroom; this
// module only renders + dispatches deltas back through a bound `api`.
//
// PUBLIC: window.TunerHud = {
//   init(api),       // one-time wiring; api carries getters/setters
//   showTuner(bool), // toggle tuner HUD
//   showFx(bool),    // toggle FX HUD
//   updateTuner(),   // refresh tuner readout + button highlights
// }
//
// The api contract (every field required):
//   getTuner()            -> _tuner reference (mutated in place)
//   setTuner(obj)         -> replaces _tuner whole (used by RST)
//   getDefaults()         -> SR_TUNER_DEFAULT (read-only template)
//   getThr()              -> _thr or null
//   isOpen()              -> bool, showroom open state
//   save()                -> persists current _tuner to localStorage
//   applyToAnchors()      -> push tuner state into anchor Object3Ds
//   getTitleCamera()      -> THREE.Camera or null (for screen-to-local math)
//
// Why a module: keeps slider HTML/CSS/event noise out of 48-showroom.js so
// edits there don't risk regressing thruster anchor or skin-swap logic.
// As more sliders are added (gameplay tuning, mission balance, etc.) they
// go here, not in showroom.
(function(){
  'use strict';

  let _api = null;          // bound on init()
  let _tunerHud = null;
  let _tunerDragging = false;
  let _tunerWired = false;
  let _fxHud = null;

  // Reusable scratch vectors so we don't churn allocations on every mousemove.
  // Lazy-init to avoid touching THREE before it's loaded.
  let _v1 = null, _v2 = null;
  function _ensureScratch() {
    if (!_v1) _v1 = new THREE.Vector3();
    if (!_v2) _v2 = new THREE.Vector3();
  }

  // Mirror partner mapping: dragging L mirrors to R; dragging mL to mR.
  const _MIRROR_PAIR = { L: 'R', R: 'L', mL: 'mR', mR: 'mL' };

  const _FX_DEFS = [
    { key:'bloomScale',   lbl:'bloom scale',    min:0,    max:2.0, step:0.01 },
    { key:'bloomOpacity', lbl:'bloom opacity',  min:0,    max:1.0, step:0.01 },
    { key:'partSize',     lbl:'particle size',  min:0.1,  max:3.0, step:0.01 },
    { key:'partOpacity',  lbl:'particle alpha', min:0,    max:1.0, step:0.01 },
    { key:'lifeBase',     lbl:'trail length',   min:0.1,  max:2.0, step:0.01 },
    { key:'lifeJit',      lbl:'trail jitter',   min:0,    max:1.0, step:0.01 },
    { key:'miniSize',     lbl:'mini size mult', min:0.1,  max:2.0, step:0.01 },
    { key:'miniBloom',    lbl:'mini bloom mult',min:0,    max:2.0, step:0.01 },
  ];

  // ── Tuner HUD ──────────────────────────────────────────────────────
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
      const t = _api.getTuner(); if (!t) return;
      if (act && act.indexOf('sel-') === 0) t.selected = act.slice(4);
      else if (act === 'mirror') t.mirror = !t.mirror;
      else if (act === 'flip') t.flip = !t.flip;
      else if (act === 'rot') t.rotMode = !t.rotMode;
      else if (act === 'reset') {
        // Replace the tuner whole (keeps showroom's reference in sync)
        _api.setTuner(JSON.parse(JSON.stringify(_api.getDefaults())));
        _api.applyToAnchors();
      }
      _api.save();
      _updateTunerHud();
    });
    _tunerHud = el;
    return el;
  }

  function _updateTunerHud() {
    if (!_tunerHud) return;
    const t = _api.getTuner();
    if (!t) return;
    const ro = _tunerHud.querySelector('#sr-tu-readout');
    const f  = (n) => (Math.round(n*1000)/1000).toFixed(3);
    const fa = (n) => (Math.round(n*10)/10).toFixed(1);
    const sel = t.selected;
    const row = (k) => {
      const r = t[k];
      return (sel===k?'>':' ')+(k+'  ').slice(0,3)+
        ' x='+f(r.x)+' y='+f(r.y)+' z='+f(r.z)+
        ' s='+f(r.scale)+' p='+fa(r.pitch||0)+' yw='+fa(r.yaw||0);
    };
    const thr = _api.getThr();
    const hz = (thr && thr.hullBackZ != null) ? thr.hullBackZ : 0;
    ro.textContent = row('L')+'\n'+row('R')+'\n'+row('mL')+'\n'+row('mR')+
      '\nmir='+(t.mirror?'ON ':'off')+' flp='+(t.flip?'ON':'off')+
      ' rot='+(t.rotMode?'ON':'off')+' hz='+f(hz);
    _tunerHud.querySelectorAll('button').forEach(b => {
      const a = b.dataset.act;
      let on = false;
      if (a && a.indexOf('sel-') === 0) on = sel === a.slice(4);
      else if (a==='mirror') on = t.mirror;
      else if (a==='flip')   on = t.flip;
      else if (a==='rot')    on = t.rotMode;
      b.style.background = on ? '#3af' : (a==='reset' ? '#411' : '#114');
      b.style.color      = on ? '#001' : (a==='reset' ? '#fcc' : '#9cf');
    });
  }

  // ── Drag math ──────────────────────────────────────────────────────
  // Convert a screen-pixel delta to a world-space delta at the anchor's
  // depth, then bake into the anchor's parent (titleShipModel) local space.
  function _screenDeltaToLocal(dxPx, dyPx, sel) {
    _ensureScratch();
    const thr = _api.getThr();
    if (!thr || !thr.anchors) return null;
    const canvas = document.getElementById('title-ship-canvas');
    const cam = _api.getTitleCamera();
    if (!canvas || !cam) return null;
    const rect = canvas.getBoundingClientRect();
    const a = thr.anchors[sel];
    if (!a) return null;
    a.getWorldPosition(_v1);
    const ndc = _v1.clone().project(cam);
    const ndx = ndc.x + (2 * dxPx / rect.width);
    const ndy = ndc.y - (2 * dyPx / rect.height);
    _v2.set(ndx, ndy, ndc.z).unproject(cam);
    const parent = a.parent;
    if (!parent) return null;
    parent.updateMatrixWorld(true);
    const wOld = _v1.clone();
    const wNew = _v2.clone();
    parent.worldToLocal(wOld);
    parent.worldToLocal(wNew);
    return { dx: wNew.x - wOld.x, dy: wNew.y - wOld.y };
  }

  function _applyDeltaToTuner(dx, dy, dz) {
    const t = _api.getTuner(); if (!t) return;
    const sel = t.selected;
    const r = t[sel]; if (!r) return;
    r.x += dx; r.y += dy; r.z += (dz||0);
    if (t.mirror) {
      const other = t[_MIRROR_PAIR[sel]];
      if (other) { other.x = -r.x; other.y = r.y; other.z = r.z; }
    }
  }

  function _applyScaleToTuner(mul) {
    const t = _api.getTuner(); if (!t) return;
    const sel = t.selected;
    const r = t[sel]; if (!r) return;
    r.scale = Math.max(0.05, Math.min(8.0, r.scale * mul));
    if (t.mirror) {
      const other = t[_MIRROR_PAIR[sel]];
      if (other) other.scale = r.scale;
    }
  }

  // Rotate-mode delta: pixel-y → pitch (deg), pixel-x → yaw (deg). Mirrored
  // partner gets MIRRORED yaw (sign-flipped) so a 'pinch outward' affects both
  // sides symmetrically; pitch stays the same on both.
  function _applyRotDeltaToTuner(dxPx, dyPx) {
    const t = _api.getTuner(); if (!t) return;
    const sel = t.selected;
    const r = t[sel]; if (!r) return;
    const SENS = 0.25; // deg per pixel
    r.pitch = (r.pitch || 0) + dyPx * SENS;
    r.yaw   = (r.yaw   || 0) + dxPx * SENS;
    r.pitch = Math.max(-90, Math.min(90, r.pitch));
    r.yaw   = Math.max(-90, Math.min(90, r.yaw));
    if (t.mirror) {
      const other = t[_MIRROR_PAIR[sel]];
      if (other) { other.pitch = r.pitch; other.yaw = -r.yaw; }
    }
  }

  function _onMouseDown(e) {
    if (!_api.isOpen()) return;
    if (e.target.closest('#sr-tuner-hud')) return;
    if (e.target.closest('#sr-fx-hud')) return;
    if (e.target.closest('.sr-panel')) return;
    if (e.button !== 0) return;
    _tunerDragging = true;
    e.preventDefault();
  }
  function _onMouseMove(e) {
    if (!_tunerDragging || !_api.isOpen()) return;
    const t = _api.getTuner(); if (!t) return;
    const dx = e.movementX || 0, dy = e.movementY || 0;
    if (t.rotMode) {
      _applyRotDeltaToTuner(dx, dy);
    } else {
      const d = _screenDeltaToLocal(dx, dy, t.selected);
      if (!d) return;
      _applyDeltaToTuner(d.dx, d.dy, 0);
    }
    _api.applyToAnchors();
    _updateTunerHud();
  }
  function _onMouseUp() {
    if (_tunerDragging) {
      _tunerDragging = false;
      _api.save();
    }
  }
  function _onWheel(e) {
    if (!_api.isOpen()) return;
    if (e.target.closest('.sr-panel')) return;
    if (e.target.closest('#sr-tuner-hud')) return;
    if (e.target.closest('#sr-fx-hud')) return;
    e.preventDefault();
    if (e.shiftKey) {
      _applyDeltaToTuner(0, 0, -e.deltaY * 0.002);
    } else {
      _applyScaleToTuner(e.deltaY < 0 ? 1.06 : 1/1.06);
    }
    _api.applyToAnchors();
    _updateTunerHud();
    _api.save();
  }

  function _wireGlobalsOnce() {
    if (_tunerWired) return;
    _tunerWired = true;
    window.addEventListener('mousedown', _onMouseDown, { passive: false });
    window.addEventListener('mousemove', _onMouseMove);
    window.addEventListener('mouseup',   _onMouseUp);
    window.addEventListener('wheel',     _onWheel,     { passive: false });
  }

  function showTuner(show) {
    if (show) {
      _ensureTunerHud();
      _tunerHud.style.display = 'block';
      _wireGlobalsOnce();
      _updateTunerHud();
    } else if (_tunerHud) {
      _tunerHud.style.display = 'none';
    }
  }

  // ── FX HUD ─────────────────────────────────────────────────────────
  function _ensureFxHud() {
    if (_fxHud) return _fxHud;
    const el = document.createElement('div');
    el.id = 'sr-fx-hud';
    el.style.cssText = [
      'position:fixed','top:8px','left:8px','z-index:99998',
      'transform:translateY(260px)', // sits below the tuner HUD
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
      const t = _api.getTuner();
      if (t && t.fx && Number.isFinite(v)) {
        t.fx[k] = v;
        const out = el.querySelector('[data-fx-val="'+k+'"]');
        if (out) out.textContent = (Math.round(v*100)/100).toFixed(2);
      }
    });
    el.addEventListener('change', () => { _api.save(); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fx-act="reset"]'); if (!b) return;
      const t = _api.getTuner(); if (!t) return;
      t.fx = JSON.parse(JSON.stringify(_api.getDefaults().fx));
      _api.save();
      _syncFxHud();
    });
    _fxHud = el;
    _syncFxHud();
    return el;
  }

  function _syncFxHud() {
    if (!_fxHud) return;
    const t = _api.getTuner();
    if (!t || !t.fx) return;
    for (let i = 0; i < _FX_DEFS.length; i++) {
      const k = _FX_DEFS[i].key;
      const inp = _fxHud.querySelector('input[data-fx-key="'+k+'"]');
      const out = _fxHud.querySelector('[data-fx-val="'+k+'"]');
      const v = t.fx[k];
      if (inp) inp.value = v;
      if (out) out.textContent = (Math.round(v*100)/100).toFixed(2);
    }
  }

  function showFx(show) {
    if (show) {
      _ensureFxHud();
      _fxHud.style.display = 'block';
      _syncFxHud();
    } else if (_fxHud) {
      _fxHud.style.display = 'none';
    }
  }

  // ── Public ─────────────────────────────────────────────────────────
  function init(api) { _api = api; }

  window.TunerHud = {
    init: init,
    showTuner: showTuner,
    showFx: showFx,
    updateTuner: _updateTunerHud,
  };
})();
