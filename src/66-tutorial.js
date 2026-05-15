// ── TUTORIAL MODULE ─────────────────────────────────────────────────────
// Extracted from 67-main-late.js (single-file modularization, May 2026).
// Contains:
//   - startTutorial()              — public entry, called by settings replay
//                                    button and the first-launch auto-start.
//   - _maybeAutoStartTutorial()    — fires on DOMContentLoaded for brand-new
//                                    players (gated by jh_tutorial_done +
//                                    jh_tutorial_autostarted_v1 localStorage).
//   - _tutShowInstructionBox       — full-screen modal "tap to begin" card.
//   - _tutShowHint                 — small bottom-of-screen prompt.
//   - _tutHideText                 — fades the hint overlay.
//   - _tutChime / _tutSignal       — audio + visual "step completed" feedback.
//   - _tutDestroyOverlay           — removes all tutorial DOM (called on exit).
//
// NOTE: The TUTORIAL TICK (the per-frame step machine, ~230 lines) lives in
// 67-main-late.js because it's inside the main animate loop and can't be
// cleanly extracted without restructuring the tick function. This file
// only contains the helpers and entry points. The death-handler shim
// (collision during step 1.5) also stays in 67 because it's interleaved
// inside the collision handler.
//
// Concat order: 66- prefix loads BEFORE 67-main-late.js, so all helpers
// declared here are visible to the tutorial tick at call time. startGame()
// (defined in 67) is reachable from startTutorial() via global scope at
// call time — never invoked during file-load.

function startTutorial() {
  try {
    window._LS.removeItem('jh_tutorial_done');
    const _tp = (typeof _PHYSICS_PRESETS !== 'undefined') ? _PHYSICS_PRESETS['JL_v1'] : null;
    if (_tp) {
      _accelBase     = _tp.accelBase;
      _accelSnap     = _tp.accelSnap;
      _maxVelBase    = _tp.maxVelBase;
      _maxVelSnap    = _tp.maxVelSnap;
      _bankMax       = _tp.bankMax;
      _bankSmoothing = _tp.bankSmoothing;
      _decelBasePct  = _tp.decelBasePct;
      _decelFullPct  = _tp.decelFullPct;
    }
    // Hard reset all tutorial progress flags so replay always starts from step 0.
    // Without this, a previous completion (step=2) leaked across into the next
    // run and the player landed at the end card instead of the dodge intro.
    state._tutorialStep        = -1;
    state._tutorialTimer       = 0;
    state._tutorialSubStep     = 0;
    state._tutorialConesFired  = 0;
    state._tutorialConeSpawned = false;
    state._tutorialConeZ       = -80;
    state._tutorialZipZ        = -99;
    state._tutorialZipRows     = 0;
    state._tutorialZipPassed       = false;
    state._tutorialZipSuccesses    = 0;
    state._tutorialZipHit          = false;
    state._tutorialZipRowSpawned   = false;
    state._tutWasRolled        = false;
    state._tutRocksSpawned     = false;
    state._tutRocksPassed      = 0;
    // Remove any lingering tutorial DOM so step 0's instruction box can render.
    if (typeof _tutDestroyOverlay === 'function') _tutDestroyOverlay();
    const _sigEl = document.getElementById('tut-signal-flash');
    if (_sigEl) _sigEl.style.opacity = '0';
    state._tutorialActive  = true;  // suppress prologue inside startGame()
    startGame();
  } catch (_) {}
}
window.startTutorial = startTutorial;

// First-launch auto-trigger: brand-new player (or post-?reset=1) → launch
// tutorial BEFORE the title screen is interactive. Gated by jh_tutorial_done
// so it never re-triggers, and by jh_tutorial_autostarted_v1 so existing
// players who somehow lost the flag don't get re-onboarded.
function _maybeAutoStartTutorial() {
  try {
    if (window._LS.getItem('jh_tutorial_done') === '1') return;
    if (window._LS.getItem('jh_tutorial_autostarted_v1') === '1') return;
    // Skip if any meaningful progress already exists.
    const hasProgress = (
      !!window._LS.getItem('jh_owned_skins') ||
      !!window._LS.getItem('jetslide_mission_flags') ||
      !!window._LS.getItem('jet-horizon-scores') ||
      parseInt(window._LS.getItem('jetslide_fuelcells') || '0', 10) > 50
    );
    if (hasProgress) {
      window._LS.setItem('jh_tutorial_autostarted_v1', '1');
      return;
    }
    window._LS.setItem('jh_tutorial_autostarted_v1', '1');
    // Defer one tick so the title renders a frame first (clean crossfade,
    // audio context primed). Tutorial fires before the title is interactive.
    setTimeout(() => { try { startTutorial(); } catch(_){} }, 800);
  } catch(_) {}
}
window._maybeAutoStartTutorial = _maybeAutoStartTutorial;
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { setTimeout(_maybeAutoStartTutorial, 0); });
  } else {
    setTimeout(_maybeAutoStartTutorial, 0);
  }
}

// ── Tutorial overlay helpers ──
function _tutShowInstructionBox(title, sub, color, onDismiss) {
  // Never show if tutorial already completed
  if (window._LS.getItem('jh_tutorial_done') === '1') return;
  // Full-screen dimmed instruction box, player taps to dismiss
  let el = document.getElementById('tut-instruction-box');
  if (el) return; // already showing
  el = document.createElement('div');
  el.id = 'tut-instruction-box';
  el.style.cssText = [
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center',
    'background:rgba(0,0,0,0.7);z-index:9100;cursor:pointer'
  ].join(';');
  el.innerHTML = [
    `<div style="border:1px solid ${color};padding:32px 40px;max-width:80vw;text-align:center;background:rgba(0,0,0,0.85);border-radius:4px">`,
    `<div style="color:${color};font-family:'Knewave',monospace;font-size:clamp(22px,5vw,38px);letter-spacing:4px;text-shadow:0 0 18px ${color}">${title}</div>`,
    `<div style="color:#fff;font-family:'Knewave',monospace;font-size:clamp(13px,2.5vw,17px);margin-top:14px;line-height:1.6;opacity:0.9">${sub}</div>`,
    `<div style="color:${color};font-family:monospace;font-size:13px;margin-top:22px;opacity:0.7;letter-spacing:2px">${window.innerWidth >= 1024 ? 'PRESS ENTER TO BEGIN' : 'TAP TO BEGIN'}</div>`,
    '</div>'
  ].join('');
  const _dismiss = () => { el.remove(); if (onDismiss) onDismiss(); };
  el.addEventListener('click', _dismiss);
  el.addEventListener('touchend', (e) => { e.preventDefault(); _dismiss(); }, { passive: false });
  const _keyDismiss = (e) => { if (e.key === 'Enter' || e.key === ' ') { document.removeEventListener('keydown', _keyDismiss); _dismiss(); } };
  document.addEventListener('keydown', _keyDismiss);
  document.body.appendChild(el);
}
function _tutShowHint(title, sub, color) {
  // Small non-blocking hint shown during gameplay
  let el = document.getElementById('tutorial-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tutorial-overlay';
    el.style.cssText = 'position:fixed;bottom:14%;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none;z-index:9000;transition:opacity 0.4s';
    document.body.appendChild(el);
  }
  // Exit tutorial button
  if (!document.getElementById('tutorial-exit-btn')) {
    const exitBtn = document.createElement('button');
    exitBtn.id = 'tutorial-exit-btn';
    exitBtn.textContent = 'EXIT TUTORIAL';
    exitBtn.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9100;background:rgba(0,0,0,0.6);color:#fff;border:1px solid rgba(255,255,255,0.4);padding:7px 18px;font-family:monospace;font-size:12px;cursor:pointer;letter-spacing:2px';
    _tapBind(exitBtn, () => {
      window._LS.setItem('jh_tutorial_done', '1');
      _tutDestroyOverlay();
      state._tutorialActive = false;
      returnToTitle();
    });
    document.body.appendChild(exitBtn);
  }
  el.innerHTML = [
    `<div style="color:${color};font-family:monospace;font-size:clamp(18px,3.5vw,28px);font-weight:bold;letter-spacing:3px;text-shadow:0 0 14px ${color}">${title}</div>`,
    `<div style="color:#fff;font-family:monospace;font-size:clamp(11px,2vw,15px);margin-top:6px;opacity:0.8">${sub}</div>`
  ].join('');
  el.style.opacity = '1';
}
function _tutHideText() {
  const el = document.getElementById('tutorial-overlay');
  if (el) el.style.opacity = '0';
}
function _tutChime() {
  // Ascending two-tone success chime
  playSFX(660, 0.12, 'sine', 0.3);
  setTimeout(() => playSFX(880, 0.18, 'sine', 0.25), 120);
}
function _tutSignal() {
  let el = document.getElementById('tut-signal-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tut-signal-flash';
    el.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-family:'Knewave',monospace;font-size:16px;letter-spacing:4px;color:#ffffff;opacity:0;pointer-events:none;z-index:19000;transition:opacity 0.15s ease;text-align:center;";
    document.body.appendChild(el);
  }
  el.textContent = 'SIGNAL RECEIVED...';
  el.style.opacity = '1';
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 600);
}

function _tutDestroyOverlay() {
  ['tutorial-overlay','tut-instruction-box','tutorial-skip','tutorial-exit-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}
