// ═══════════════════════════════════════════════════════════════
//  ORIENTATION LOCK (2026-04-27)
//  - Title-screen toggle (LANDSCAPE default | PORTRAIT) persists in localStorage
//  - On PLAY tap: try screen.orientation.lock(chosen) [Android]; if it rejects
//    or isn't supported [iOS Safari], fall back to a "rotate device" overlay
//    that gates PLAY until the user physically rotates.
//  - During gameplay (incl. intro lift, paused, gameover): if physical
//    orientation drifts off the locked one, pause + show the same overlay.
//  - Lock is released only on returnToTitle().
// ═══════════════════════════════════════════════════════════════
(() => {
  'use strict';

  const LS_KEY = 'jh_orientationPref';

  const _isMobileLike = (
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
  const _isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Read/write preference
  function getPref() {
    try {
      const v = localStorage.getItem(LS_KEY);
      return (v === 'portrait' || v === 'landscape') ? v : 'landscape';
    } catch (_) { return 'landscape'; }
  }
  function setPref(v) {
    try { localStorage.setItem(LS_KEY, v); } catch (_) {}
  }

  // Detect physical orientation
  function physicalOrientation() {
    return (window.innerWidth > window.innerHeight) ? 'landscape' : 'portrait';
  }

  // ── Toggle UI wiring ──
  const _segLandscape = document.getElementById('orient-landscape');
  const _segPortrait  = document.getElementById('orient-portrait');
  const _toggleEl     = document.getElementById('orientation-toggle');

  function _renderToggle() {
    const pref = getPref();
    if (_segLandscape) {
      _segLandscape.classList.toggle('orient-seg-active', pref === 'landscape');
      _segLandscape.setAttribute('aria-checked', pref === 'landscape' ? 'true' : 'false');
    }
    if (_segPortrait) {
      _segPortrait.classList.toggle('orient-seg-active', pref === 'portrait');
      _segPortrait.setAttribute('aria-checked', pref === 'portrait' ? 'true' : 'false');
    }
  }
  _renderToggle();

  if (_segLandscape && typeof _tapBind === 'function') {
    _tapBind(_segLandscape, () => { setPref('landscape'); _renderToggle(); });
  }
  if (_segPortrait && typeof _tapBind === 'function') {
    _tapBind(_segPortrait, () => { setPref('portrait'); _renderToggle(); });
  }

  // ── Rotate prompt overlay ──
  const _promptEl = document.getElementById('rotate-prompt');
  const _promptSub = document.getElementById('rotate-prompt-sub');

  function _showPrompt(targetOrientation) {
    if (!_promptEl) return;
    if (_promptSub) _promptSub.textContent = 'to play in ' + targetOrientation;
    _promptEl.classList.remove('hidden');
    _promptEl.setAttribute('aria-hidden', 'false');
  }
  function _hidePrompt() {
    if (!_promptEl) return;
    _promptEl.classList.add('hidden');
    _promptEl.setAttribute('aria-hidden', 'true');
  }

  // ── Orientation lock state ──
  let _lockedOrientation = null;     // 'landscape' | 'portrait' | null

  // Try the native API first; resolve true if locked, false if rejected/unsupported.
  async function _tryNativeLock(orientation) {
    if (!screen.orientation || typeof screen.orientation.lock !== 'function') return false;
    try {
      // Prefer the broad type (allows both rotations of the same orientation).
      await screen.orientation.lock(orientation === 'landscape' ? 'landscape' : 'portrait');
      return true;
    } catch (_) {
      return false;
    }
  }
  function _tryNativeUnlock() {
    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
      try { screen.orientation.unlock(); } catch (_) {}
    }
  }

  // Public: lock orientation NOW (synchronous, fire-and-forget). Called from
  // PLAY tap. Game starts synchronously alongside this; it does not block.
  // The watcher takes over enforcement after this point.
  window.__orientationLockNow = function lockNow() {
    // Desktop: no orientation concept.
    if (!_isMobileLike) return;

    const chosen = getPref();
    _lockedOrientation = chosen;

    // Fire native lock without awaiting — promise rejection is harmless,
    // we just won't have hardware enforcement (iOS path).
    try {
      const p = _tryNativeLock(chosen);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {}

    // If physical doesn't match the chosen orientation, show the rotate prompt.
    // The watcher will hide it once they rotate (and pause/show again if they
    // drift back off mid-game).
    if (physicalOrientation() !== chosen) {
      _showPrompt(chosen);
    }
  };

  // Release the lock — call from returnToTitle().
  window.__orientationRelease = function release() {
    _lockedOrientation = null;
    _hidePrompt();
    _tryNativeUnlock();
  };

  // ── Live orientation watcher ──
  function _onOrientationChange() {
    if (!_lockedOrientation) return;
    const current = physicalOrientation();

    if (current !== _lockedOrientation) {
      // Drifted off — pause if in active gameplay, and show prompt.
      const phase = (typeof state !== 'undefined' && state) ? state.phase : null;
      if (phase === 'playing' && typeof togglePause === 'function') {
        try { togglePause(); } catch (_) {}
      }
      _showPrompt(_lockedOrientation);
    } else {
      // Back on the locked orientation — hide the prompt. Game stays paused;
      // user resumes manually via the existing pause overlay.
      _hidePrompt();
    }
  }

  window.addEventListener('resize', _onOrientationChange, { passive: true });
  window.addEventListener('orientationchange', _onOrientationChange, { passive: true });
  if (screen.orientation && typeof screen.orientation.addEventListener === 'function') {
    screen.orientation.addEventListener('change', _onOrientationChange);
  }

  // Hide toggle on non-mobile (extra safety; CSS also hides it via media query)
  if (!_isMobileLike && _toggleEl) {
    _toggleEl.style.display = 'none';
  }
})();
