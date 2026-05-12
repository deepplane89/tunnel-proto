// ═══════════════════════════════════════════════════════════════════════════
//  HITCH METER — dev-only on-screen readout for one-frame stalls.
//
//  Tracks the worst recent hitch by category (canyon, pickup, obstacle-spawn,
//  ring-spawn). Always shows "worst in last N seconds + how long ago" so the
//  user doesn't need to screenshot at the exact moment of the hitch.
//
//  Usage from instrumented code:
//    const t0 = _hitchStart();   // returns performance.now()
//    // ...work to measure...
//    _hitchEnd('canyon', t0);
//
//  Toggled from the pause-menu HITCH METER button (gated to dev mode).
//  When window._hitchMeterOn=false, _hitchStart/_hitchEnd are near-zero cost.
// ═══════════════════════════════════════════════════════════════════════════

window._hitchMeterOn = false;

const _HITCH_WINDOW_MS = 30000; // remember worst hitch for 30s
const _HITCH_THRESHOLD_MS = 8;  // ignore anything under 8ms (60fps frame budget = 16.7ms)

// worst hitch per category: { ms, t, name }
let _hitchWorst = null;
// most recent over-threshold hitch (for "30s ago" display)
let _hitchLast  = null;

function _hitchStart() {
  if (!window._hitchMeterOn) return 0;
  return performance.now();
}

function _hitchEnd(category, t0) {
  if (!window._hitchMeterOn || !t0) return;
  const dt = performance.now() - t0;
  if (dt < _HITCH_THRESHOLD_MS) return;
  const now = performance.now();
  _hitchLast = { ms: dt, t: now, name: category };
  // keep worst over rolling window; expire old ones
  if (!_hitchWorst || dt > _hitchWorst.ms || (now - _hitchWorst.t) > _HITCH_WINDOW_MS) {
    _hitchWorst = { ms: dt, t: now, name: category };
  }
}

// Render the overlay text. Called from the existing FPS update tick in
// 70-perf-diag.js so we don't add another timer.
function _renderHitchOverlay() {
  const el = document.getElementById('hitch-overlay');
  if (!el) return;
  if (!window._hitchMeterOn) {
    if (!el.classList.contains('hidden')) el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const now = performance.now();
  // Expire worst if older than window
  if (_hitchWorst && (now - _hitchWorst.t) > _HITCH_WINDOW_MS) _hitchWorst = null;

  if (!_hitchWorst) {
    el.textContent = 'hitch: clean';
    el.classList.remove('warn', 'bad');
    return;
  }
  const agoSec = Math.floor((now - _hitchWorst.t) / 1000);
  const ms = Math.round(_hitchWorst.ms);
  // ms first so it's always visible even if right edge is cropped.
  // Short cat: 'cnyn' / 'pkup' so the whole line stays compact on iPhone.
  const shortCat = _hitchWorst.name === 'canyon' ? 'cnyn'
                 : _hitchWorst.name === 'pickup' ? 'pkup'
                 : _hitchWorst.name;
  el.textContent = ms + 'ms ' + shortCat + ' ' + agoSec + 's';
  el.classList.toggle('warn', ms >= 20 && ms < 50);
  el.classList.toggle('bad',  ms >= 50);
}

window._hitchStart = _hitchStart;
window._hitchEnd = _hitchEnd;
window._renderHitchOverlay = _renderHitchOverlay;

// Wire up the pause-menu toggle button. Visible only in dev mode.
// Runs after DOM is ready (this file is loaded after index.html parses).
(function _setupHitchToggle() {
  const btn = document.getElementById('pause-hitch-toggle');
  if (!btn) return;
  // Gate visibility: dev only.
  if (window.__JH_DEV__) btn.classList.remove('hidden');
  btn.addEventListener('click', () => {
    window._hitchMeterOn = !window._hitchMeterOn;
    btn.textContent = 'HITCH METER: ' + (window._hitchMeterOn ? 'ON' : 'OFF');
    // Reset state so toggle-on starts from a clean slate.
    if (window._hitchMeterOn) { _hitchWorst = null; _hitchLast = null; }
    _renderHitchOverlay();
  });
})();
