// ═══════════════════════════════════════════════════════════════════════════
//  DEV STUBS — replaces 49-tuner-hud.js, 70-perf-diag.js, 78-tuner-panels.js
//  in production builds. Stubs out every cross-file symbol the gameplay code
//  references unguarded so the prod bundle can omit the real dev tooling.
//
//  Used by `scripts/build.sh --prod`. Do not delete or rename without
//  updating build.sh.
// ═══════════════════════════════════════════════════════════════════════════

// Tuner HUD — all callers in 48-showroom.js guard with `if (window.TunerHud)`,
// so we could leave undefined. Stub for clarity and so init logs aren't noisy.
window.TunerHud = {
  init:        function () {},
  showTuner:   function () {},
  showFx:      function () {},
  updateTuner: function () {},
};

// Perf-diag is now included in prod builds (see scripts/build.sh comment).
// No stub needed — window._perfDiag is the real factory; window._perfDiagOn
// defaults false so the inner methods stay inert.

// Tuner panel functions called unguarded from gameplay hotkey handlers.
// Hotkeys are dev-only but the call sites are not gated, so we need no-ops.
function _ringShowTuner() { /* prod stub — tuner panel omitted */ }
function buildSkinTunerSliders() { /* prod stub — skin tuner omitted */ }

// Window-attached panel toggles referenced via window._awPanel from various
// hotkey handlers. Provide no-op stubs.
window._awPanel = function () {};
