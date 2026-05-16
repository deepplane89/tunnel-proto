// ═══════════════════════════════════════════════════════════════════════════
//  HITCH METER — dev-only on-screen readout for one-frame stalls.
//
//  Two paths:
//
//  1) BRACKET path  (precise — measure a specific block of code)
//       const t0 = _hitchStart(); ...work... _hitchEnd('pickup-app', t0);
//
//  2) FRAME path  (catches ANYTHING that makes a frame long, including
//       shader compiles, texture uploads, layout, paint, GC.)
//
//       _hitchArm('pickup-shield');   // arms a label for the NEXT N frames
//       _hitchFrameTick(frameDeltaMs); // called once per frame in animate()
//
//       If a frame within the armed window exceeds the hitch threshold,
//       the armed label gets credit. Otherwise a generic 'frame' label is
//       used. Stale arms (frame after the immediate next) record with a '?'
//       suffix so we know the attribution may be off.
//
//  ── ARM AGE & ATTRIBUTION CONFIDENCE ─────────────────────────────────────
//  Old behavior: arm-window=3 frames, no age tracking. A hitch 2-3 frames
//  after an unrelated arm got credited to that arm with full confidence,
//  e.g. an angled-walls glitch landing within 3 frames of killPlayer's
//  _hitchArm('crash-rndr') showed as `cr-rndr`.
//  New behavior: window=2, but only frame N+1 gets full attribution.
//  Frame N+2 records with '?' suffix (e.g. `crash-rndr?`). Stale = low confidence.
//
//  ── PERF-DIAG BREAKDOWN ──────────────────────────────────────────────────
//  Each frame-path hitch now also snapshots the perf-diag breakdown
//  (js/render/shaders/draws/heap-delta) so the overlay shows WHY the frame
//  was slow, not just its duration. Perf diag is auto-enabled when hitch
//  meter is on so we always have data.
//
//  Both paths feed the same "worst in last 30s" overlay.
// ═══════════════════════════════════════════════════════════════════════════

window._hitchMeterOn = false;

const _HITCH_WINDOW_MS = 30000; // remember worst hitch for 30s
const _HITCH_THRESHOLD_MS = 5;  // ignore anything under 5ms (diagnosis mode)

// Frame-path threshold is higher: 60fps budget = 16.7ms, 120fps = 8.3ms.
// We only care when a frame demonstrably overran. Anything ≥25ms is a real
// visible stutter on 60Hz; ≥18ms is a missed frame on 60Hz.
const _HITCH_FRAME_THRESHOLD_MS = 12;  // diagnosis mode — was 18

// How many frames after _hitchArm() the label remains "live".
// Frame 1 (immediate next) = full confidence.
// Frame 2 = stale, label gets '?' suffix.
// Was 3 — caused mis-attribution (death-armed labels claiming angled-wall
// hitches that happened seconds earlier in the same arm window).
const _HITCH_ARM_FRAMES = 2;

// worst hitch over rolling window: { ms, t, name, breakdown }
let _hitchWorst = null;
// most recent over-threshold hitch (kept for potential future history view)
let _hitchLast  = null;

// Currently-armed label + how many frames of arm life remain.
let _armedLabel = null;
let _armedFramesLeft = 0;

// Snapshot perf-diag breakdown for the just-finished frame. Read at frame-path
// hitch record time. Null when perf-diag is off or hasn't run a frame yet.
function _snapPerfBreakdown() {
  const pd = window._perfDiag;
  if (!pd || !pd.lastFrame) return null;
  // Shallow copy so it doesn't mutate when perf-diag updates next frame.
  const lf = pd.lastFrame;
  return {
    js:      lf.js|0,
    rndr:    lf.rndr|0,
    shdrs:   lf.shdrs|0,
    draws:   lf.draws|0,
    heap:    lf.heap|0, // bytes delta, can be negative
    // Names of programs that compiled THIS frame (sh>0). Stored as array of
    // 'MaterialType[cacheKey...]' strings, max 8. Used for on-screen overlay
    // line 3 so we can tell WHICH 5 lightning programs are still compiling.
    shdrNames: lf.shdrNames ? lf.shdrNames.slice() : null,
  };
}

function _recordHitch(ms, name, breakdown) {
  if (ms < _HITCH_THRESHOLD_MS) return;
  const now = performance.now();
  _hitchLast = { ms, t: now, name, breakdown: breakdown || null };
  // Replace worst if (a) bigger, or (b) old one expired.
  if (!_hitchWorst || ms > _hitchWorst.ms || (now - _hitchWorst.t) > _HITCH_WINDOW_MS) {
    _hitchWorst = { ms, t: now, name, breakdown: breakdown || null };
  }
}

// ── BRACKET PATH ──────────────────────────────────────────────────────────
function _hitchStart() {
  if (!window._hitchMeterOn) return 0;
  return performance.now();
}
function _hitchEnd(category, t0) {
  if (!window._hitchMeterOn || !t0) return;
  const dt = performance.now() - t0;
  // Bracket hitches do not get a frame breakdown — they're a CPU subset of
  // one frame, breakdown would conflate with whatever else ran.
  _recordHitch(dt, category, null);
}

// ── FRAME PATH ────────────────────────────────────────────────────────────
// Arm a label for the NEXT N frames. If any of those frames overruns,
// the label gets credit. Cheap when meter is off.
function _hitchArm(label) {
  if (!window._hitchMeterOn) return;
  _armedLabel = label;
  _armedFramesLeft = _HITCH_ARM_FRAMES;
}

// Soft arm — only takes effect if NO specific event arm is already pending.
// Used by per-frame mechanic arms (cy-act, knife-act, aw-act) so they don't
// clobber a higher-priority event arm like lt-rndr or cy-rndr fired the
// frame before. Cheap when meter off.
function _hitchArmSoft(label) {
  if (!window._hitchMeterOn) return;
  if (_armedLabel) return; // event arm already pending; don't override
  _armedLabel = label;
  _armedFramesLeft = _HITCH_ARM_FRAMES;
}

// Frames over this are NOT hitches — they're tab-resume / debugger-pause /
// system-stall events. We don't want them poisoning the worst-in-30s display.
const _HITCH_SANITY_MAX_MS = 500;  // anything bigger = system event, ignore
// After a visibility-resume we skip the next few frames entirely because
// the very first tick after resume still carries the giant dt.
let _hitchSkipFrames = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _hitchSkipFrames = 5;
  });
}

// Called once per frame from animate() with the just-elapsed frame delta.
function _hitchFrameTick(frameDeltaMs) {
  if (!window._hitchMeterOn) return;
  // Drop the post-resume frames so a 29s backgrounded gap doesn't get logged.
  if (_hitchSkipFrames > 0) { _hitchSkipFrames--; return; }
  // Drop obvious system events (tab pause, debugger, OS scheduler hiccup).
  if (frameDeltaMs > _HITCH_SANITY_MAX_MS) return;
  if (frameDeltaMs >= _HITCH_FRAME_THRESHOLD_MS) {
    // Attribute to armed label if present, else generic 'frame'.
    // First frame after arm = full confidence. Subsequent = stale ('?').
    let name;
    if (_armedLabel) {
      const stale = (_armedFramesLeft < _HITCH_ARM_FRAMES);
      name = stale ? (_armedLabel + '?') : _armedLabel;
    } else {
      name = 'frame';
    }
    _recordHitch(frameDeltaMs, name, _snapPerfBreakdown());
  }
  // Decrement arm window
  if (_armedFramesLeft > 0) {
    _armedFramesLeft--;
    if (_armedFramesLeft === 0) _armedLabel = null;
  }
}

// ── OVERLAY RENDER ────────────────────────────────────────────────────────
function _renderHitchOverlay() {
  const el = document.getElementById('hitch-overlay');
  if (!el) return;
  if (!window._hitchMeterOn) {
    if (!el.classList.contains('hidden')) el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const now = performance.now();
  if (_hitchWorst && (now - _hitchWorst.t) > _HITCH_WINDOW_MS) _hitchWorst = null;

  if (!_hitchWorst) {
    el.textContent = 'hitch: clean';
    el.classList.remove('warn', 'bad');
    return;
  }
  const agoSec = Math.floor((now - _hitchWorst.t) / 1000);
  const ms = Math.round(_hitchWorst.ms);
  // Short label so a long line still fits on iPhone right edge.
  // Drops anything past first hyphen segment for known long labels.
  const shortCat = _shortLabel(_hitchWorst.name);
  // Two-line readout: ms + label + age on line 1, breakdown on line 2.
  // Breakdown only shown if perf-diag snapshot was available (frame-path hitches).
  let txt = ms + 'ms ' + shortCat + ' ' + agoSec + 's';
  const bd = _hitchWorst.breakdown;
  if (bd) {
    // js=Nms r=Nms sh=N dr=N h=±NKB — kept tight so it fits on iPhone
    // (right-edge of HUD). Heap delta in KB (not MB) — most frames are
    // sub-MB allocations, MB display loses sub-MB GC pressure signal.
    const heapKb = Math.round(bd.heap / 1024);
    const heapStr = (heapKb >= 0 ? '+' : '') + heapKb + 'k';
    txt += '\njs=' + bd.js + ' r=' + bd.rndr + ' sh=' + bd.shdrs
         + ' dr=' + bd.draws + ' h=' + heapStr;
    // Line 3: WHICH programs compiled this frame (only when sh>0). Each name
    // is 'MaterialType[cacheKey...]'. We strip the cacheKey '[...]' to keep
    // the line short and show just the type counts (e.g. 'MeshBasic\xd73').
    if (bd.shdrs > 0 && bd.shdrNames && bd.shdrNames.length) {
      const typeCounts = {};
      for (const full of bd.shdrNames) {
        // Pull material type from 'MaterialType[cacheKey...]' format.
        const tIdx = full.indexOf('[');
        const t = tIdx > 0 ? full.slice(0, tIdx) : full;
        // Compact 'MeshBasicMaterial' \u2192 'MshBsc' style: drop 'Material' suffix.
        const tShort = t.replace(/Material$/, '');
        typeCounts[tShort] = (typeCounts[tShort] || 0) + 1;
      }
      const parts = [];
      for (const k of Object.keys(typeCounts)) {
        parts.push(typeCounts[k] > 1 ? (k + '\u00d7' + typeCounts[k]) : k);
      }
      txt += '\n' + parts.join(' ');
    }
    // Multi-line needs CSS white-space:pre to render \n.
    el.style.whiteSpace = 'pre';
  } else {
    el.style.whiteSpace = '';
  }
  el.textContent = txt;
  el.classList.toggle('warn', ms >= 20 && ms < 50);
  el.classList.toggle('bad',  ms >= 50);
}

function _shortLabel(name) {
  if (!name) return '?';
  // Stale-arm '?' suffix preserves through shortening: strip, shorten, re-add.
  const stale = name.endsWith('?');
  const base  = stale ? name.slice(0, -1) : name;
  const tail  = stale ? '?' : '';
  // Common labels → short forms (kept short so a long line still fits on
  // iPhone right edge with 13px font).
  if (base === 'canyon') return 'cnyn'+tail;
  if (base === 'pickup') return 'pkup'+tail;
  if (base === 'pickup-app')        return 'pk-app'+tail;
  if (base === 'pickup-shat')       return 'pk-shat'+tail;
  if (base === 'pickup-shield')     return 'pk-shld'+tail;
  if (base === 'pickup-laser')      return 'pk-lsr'+tail;
  if (base === 'pickup-magnet')     return 'pk-mag'+tail;
  if (base === 'pickup-invincible') return 'pk-inv'+tail;
  // Canyon sub-phases (synchronous build steps inside _createCanyonWalls)
  if (base === 'cnyn-mat')   return 'cy-mat'+tail;   // material allocation
  if (base === 'cnyn-geo')   return 'cy-geo'+tail;   // slab geometry build (CPU)
  if (base === 'cnyn-bake')  return 'cy-bake'+tail;  // X/rotation bake loop
  if (base === 'cnyn-warm')  return 'cy-warm'+tail;  // GPU proxy-scene compile
  if (base === 'cnyn-rndr')  return 'cy-rndr'+tail;  // next-frame render (upload/light)
  if (base === 'cnyn-act')   return 'cy-act'+tail;   // per-frame: any canyon active
  if (base === 'knife-act')  return 'knife'+tail;    // per-frame: L3 knife active
  // Lightning
  if (base === 'lt-spawn')   return 'lt-spn'+tail;   // synchronous spawn setup
  if (base === 'lt-rndr')    return 'lt-rndr'+tail;  // first render after spawn
  // Angled walls (Band 1 / Band 5 family) — pre-pooled but first-draw GPU upload
  if (base === 'aw-rndr')    return 'aw-rndr'+tail;  // first render after activate()
  if (base === 'aw-act')     return 'aw-act'+tail;   // per-frame: angled walls active
  // Crash sub-phases (killPlayer fatal path)
  if (base === 'crash')       return 'crsh'+tail;    // full fatal path bracket
  if (base === 'crash-tear')  return 'cr-tear'+tail; // state/timer/transition teardown
  if (base === 'crash-exp')   return 'cr-exp'+tail;  // explosion spawn + camera setup
  if (base === 'crash-audio') return 'cr-aud'+tail;  // SFX kill + engine stop + playCrash
  if (base === 'crash-rndr')  return 'cr-rndr'+tail; // first frame after death (post-FX render)
  if (base === 'exp-verts')   return 'ex-vrt'+tail;  // _getShipVertices CPU iteration
  if (base === 'exp-spawn')   return 'ex-spn'+tail;  // _spawnExplosion 6000-iter loop
  // Per-frame scene-system labels (water, reflection, bloom)
  if (base === 'water')       return 'water'+tail;   // mirrorMesh.onBeforeRender mirror render
  if (base === 'water-upd')   return 'wtr-up'+tail;  // BankWaterEffect.update call
  return (base.length > 7 ? base.slice(0, 7) : base) + tail;
}

window._hitchStart = _hitchStart;
window._hitchEnd = _hitchEnd;
window._hitchArm = _hitchArm;
window._hitchArmSoft = _hitchArmSoft;
window._hitchFrameTick = _hitchFrameTick;
window._renderHitchOverlay = _renderHitchOverlay;

// Wire up the pause-menu toggle button. Visible only in dev mode.
// Auto-enables perf-diag too so the on-screen breakdown has data to read.
(function _setupHitchToggle() {
  const btn = document.getElementById('pause-hitch-toggle');
  if (!btn) return;
  // Legacy direct button stays hidden — the DEV modal owns the UI now.
  btn.style.display = 'none';
  btn.addEventListener('click', () => {
    window._hitchMeterOn = !window._hitchMeterOn;
    // Couple perf-diag to hitch meter so the per-frame js/rndr/shdrs/heap
    // breakdown is always available when the hitch meter records a frame.
    // We don't auto-disable on hitch-off in case the user wanted perf-diag
    // on for console logging independently.
    if (window._hitchMeterOn) window._perfDiagOn = true;
    btn.textContent = 'HITCH METER: ' + (window._hitchMeterOn ? 'ON' : 'OFF');
    if (window._hitchMeterOn) {
      _hitchWorst = null; _hitchLast = null;
      _armedLabel = null; _armedFramesLeft = 0;
    }
    _renderHitchOverlay();
  });
})();

// God mode toggle — dev-only. killPlayer() short-circuits on window._godMode.
// In prod this whole file is excluded by the build, so the button stays
// display:none (set in index.html) and _godMode stays undefined.
(function _setupGodToggle() {
  const btn = document.getElementById('pause-god-toggle');
  if (!btn) return;
  // Legacy direct button stays hidden — the DEV modal owns the UI now.
  btn.style.display = 'none';
  btn.addEventListener('click', () => {
    window._godMode = !window._godMode;
    btn.textContent = 'GOD MODE: ' + (window._godMode ? 'ON' : 'OFF');
    btn.style.color = window._godMode ? '#00ff66' : '';
    btn.style.borderColor = window._godMode ? '#00ff66' : '';
  });
})();

// ── DEV PANEL WIRING (dev-only) ──
// Opens dev-overlay from the pause menu. Hosts god mode + hitch meter +
// mirror-RT A/B test. All three controls just proxy the existing globals
// (window._godMode, window._hitchMeterOn, window._setMirrorRT).
(function _setupDevPanel() {
  if (!window.__JH_DEV__) return;
  const btn = document.getElementById('pause-dev-btn');
  const overlay = document.getElementById('dev-overlay');
  const closeBtn = document.getElementById('dev-close');
  if (!btn || !overlay) return;
  btn.style.display = 'inline-flex';
  overlay.style.display = '';  // remove the inline display:none guard
  function open() { overlay.classList.remove('hidden'); _syncDev(); }
  function close() { overlay.classList.add('hidden'); }
  btn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  // Click outside the panel closes it.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // ─ God / hitch toggles ─
  const godT   = document.getElementById('dev-god-toggle');
  const hitchT = document.getElementById('dev-hitch-toggle');
  function _applyToggleVisual(el, on) {
    if (!el) return;
    el.textContent = on ? 'ON' : 'OFF';
    el.classList.toggle('on',  on);
    el.classList.toggle('off', !on);
  }
  function _syncDev() {
    _applyToggleVisual(godT,   !!window._godMode);
    _applyToggleVisual(hitchT, !!window._hitchMeterOn);
    // Sync RT button highlight to whatever was last set (if any).
    const cur = window._curMirrorRT || 512;
    [256, 320, 512].forEach(n => {
      const b = document.getElementById('dev-rt-' + n);
      if (b) b.classList.toggle('active', n === cur);
    });
  }
  if (godT) godT.addEventListener('click', () => {
    window._godMode = !window._godMode;
    _applyToggleVisual(godT, window._godMode);
    // Mirror to legacy button so its label stays in sync.
    const legacy = document.getElementById('pause-god-toggle');
    if (legacy) legacy.textContent = 'GOD MODE: ' + (window._godMode ? 'ON' : 'OFF');
  });
  if (hitchT) hitchT.addEventListener('click', () => {
    window._hitchMeterOn = !window._hitchMeterOn;
    if (window._hitchMeterOn) window._perfDiagOn = true;
    _applyToggleVisual(hitchT, window._hitchMeterOn);
    const legacy = document.getElementById('pause-hitch-toggle');
    if (legacy) legacy.textContent = 'HITCH METER: ' + (window._hitchMeterOn ? 'ON' : 'OFF');
  });

  // ─ Mirror RT A/B test ─
  [256, 320, 512].forEach(n => {
    const b = document.getElementById('dev-rt-' + n);
    if (!b) return;
    b.addEventListener('click', () => {
      if (typeof window._setMirrorRT === 'function') window._setMirrorRT(n);
      window._curMirrorRT = n;
      [256, 320, 512].forEach(m => {
        const mb = document.getElementById('dev-rt-' + m);
        if (mb) mb.classList.toggle('active', m === n);
      });
    });
  });
})();
