// ═══════════════════════════════════════════════════════════════════════════
//  HITCH METER — dev-only on-screen readout for one-frame stalls.
//
//  Two paths:
//
//  1) BRACKET path  (precise — measure a specific block of code)
//       const t0 = _hitchStart(); ...work... _hitchEnd('pickup-app', t0);
//
//  2) FRAME path  (catches ANYTHING that makes a frame long, including
//       shader compiles, texture uploads, layout, paint, GC. The previous
//       bracket path missed those because the cost happens AFTER the bracketed
//       block, during the actual render.)
//
//       _hitchArm('pickup-shield');   // arms a label for the NEXT 2 frames
//       _hitchFrameTick(frameDeltaMs); // called once per frame in animate()
//
//       If a frame within the armed window exceeds the hitch threshold,
//       the armed label gets credited. Otherwise a generic 'frame' label is
//       used, so we still see WHEN big frames happened even if nothing armed
//       them.
//
//  Both paths feed the same "worst in last 30s" overlay.
// ═══════════════════════════════════════════════════════════════════════════

window._hitchMeterOn = false;

const _HITCH_WINDOW_MS = 30000; // remember worst hitch for 30s
const _HITCH_THRESHOLD_MS = 8;  // ignore anything under 8ms

// Frame-path threshold is higher: 60fps budget = 16.7ms, 120fps = 8.3ms.
// We only care when a frame demonstrably overran. Anything ≥25ms is a real
// visible stutter on 60Hz; ≥18ms is a missed frame on 60Hz.
const _HITCH_FRAME_THRESHOLD_MS = 18;

// How many frames after _hitchArm() the label remains "live". Shader compile
// and texture upload typically lands the very next frame, sometimes the one
// after that on iOS. 3 is generous but safe.
const _HITCH_ARM_FRAMES = 3;

// worst hitch over rolling window: { ms, t, name }
let _hitchWorst = null;
// most recent over-threshold hitch (kept for potential future history view)
let _hitchLast  = null;

// Currently-armed label + how many frames of arm life remain.
let _armedLabel = null;
let _armedFramesLeft = 0;

function _recordHitch(ms, name) {
  if (ms < _HITCH_THRESHOLD_MS) return;
  const now = performance.now();
  _hitchLast = { ms, t: now, name };
  // Replace worst if (a) bigger, or (b) old one expired.
  if (!_hitchWorst || ms > _hitchWorst.ms || (now - _hitchWorst.t) > _HITCH_WINDOW_MS) {
    _hitchWorst = { ms, t: now, name };
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
  _recordHitch(dt, category);
}

// ── FRAME PATH ────────────────────────────────────────────────────────────
// Arm a label for the NEXT few frames. If any of those frames overruns,
// the label gets credit. Cheap when meter is off.
function _hitchArm(label) {
  if (!window._hitchMeterOn) return;
  _armedLabel = label;
  _armedFramesLeft = _HITCH_ARM_FRAMES;
}

// Called once per frame from animate() with the just-elapsed frame delta.
function _hitchFrameTick(frameDeltaMs) {
  if (!window._hitchMeterOn) return;
  if (frameDeltaMs >= _HITCH_FRAME_THRESHOLD_MS) {
    // Attribute to armed label if present, else generic 'frame'.
    const name = _armedLabel || 'frame';
    _recordHitch(frameDeltaMs, name);
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
  el.textContent = ms + 'ms ' + shortCat + ' ' + agoSec + 's';
  el.classList.toggle('warn', ms >= 20 && ms < 50);
  el.classList.toggle('bad',  ms >= 50);
}

function _shortLabel(name) {
  if (!name) return '?';
  // Common labels → short forms (kept short so a long line still fits on
  // iPhone right edge with 13px font).
  if (name === 'canyon') return 'cnyn';
  if (name === 'pickup') return 'pkup';
  if (name === 'pickup-app')     return 'pk-app';
  if (name === 'pickup-shat')    return 'pk-shat';
  if (name === 'pickup-shield')  return 'pk-shld';
  if (name === 'pickup-laser')   return 'pk-lsr';
  if (name === 'pickup-magnet')  return 'pk-mag';
  if (name === 'pickup-invinc')  return 'pk-inv';
  // Canyon sub-phases (synchronous build steps inside _createCanyonWalls)
  if (name === 'cnyn-mat')   return 'cy-mat';   // material allocation
  if (name === 'cnyn-geo')   return 'cy-geo';   // slab geometry build (CPU)
  if (name === 'cnyn-bake')  return 'cy-bake';  // X/rotation bake loop
  if (name === 'cnyn-warm')  return 'cy-warm';  // GPU proxy-scene compile
  if (name === 'cnyn-rndr')  return 'cy-rndr';  // next-frame render (upload/light)
  // Lightning
  if (name === 'lt-spawn')   return 'lt-spn';   // synchronous spawn setup
  if (name === 'lt-rndr')    return 'lt-rndr';  // first render after spawn
  return name.length > 9 ? name.slice(0, 9) : name;
}

window._hitchStart = _hitchStart;
window._hitchEnd = _hitchEnd;
window._hitchArm = _hitchArm;
window._hitchFrameTick = _hitchFrameTick;
window._renderHitchOverlay = _renderHitchOverlay;

// Wire up the pause-menu toggle button. Visible only in dev mode.
(function _setupHitchToggle() {
  const btn = document.getElementById('pause-hitch-toggle');
  if (!btn) return;
  if (window.__JH_DEV__) btn.classList.remove('hidden');
  btn.addEventListener('click', () => {
    window._hitchMeterOn = !window._hitchMeterOn;
    btn.textContent = 'HITCH METER: ' + (window._hitchMeterOn ? 'ON' : 'OFF');
    if (window._hitchMeterOn) {
      _hitchWorst = null; _hitchLast = null;
      _armedLabel = null; _armedFramesLeft = 0;
    }
    _renderHitchOverlay();
  });
})();
