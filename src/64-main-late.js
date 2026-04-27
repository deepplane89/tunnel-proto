
// ── BUTTON HANDLERS ──
_tapBind(document.getElementById('death-run-btn'), () => {
  initAudio();
  // Pre-warm engine sounds on user gesture (mobile requires this)
  // Just load them — don't play, to avoid any audible glitch
  const _ewEng = document.getElementById('engine-start');
  const _ewRoar = document.getElementById('engine-roar');
  if (_ewEng) { _ewEng.load(); }
  if (_ewRoar) { _ewRoar.load(); }
  playStartSound();
  // Orientation gate (fire-and-forget, no await):
  //   - If chosen orientation matches physical: returns true — we start now.
  //   - If mismatch: shows the rotate prompt, returns false. We register
  //     startDeathRun() as a deferred-start callback; the orientation
  //     watcher fires it once the user rotates correctly.
  // This avoids any Promise/await between user gesture and startDeathRun()
  // on the matching path (iOS audio unlock requires that).
  if (typeof window.__orientationLockNow === 'function') {
    let _matched = true;
    try { _matched = window.__orientationLockNow(); } catch (_) { _matched = true; }
    if (_matched !== false) {
      startDeathRun();
    } else {
      window.__pendingGameStart = () => { startDeathRun(); };
    }
  } else {
    startDeathRun();
  }
});
_tapBind(document.getElementById('restart-btn'), () => {
  if (!_gameOverTapReady) return; // cooldown guard
  initAudio();
  // No playStartSound — _triggerRetryWithSweep plays its own retry-tech + retry-warp SFX
  _triggerRetryWithSweep();
});
_tapBind(document.getElementById('gameover-exit-btn'), () => {
  if (!_gameOverTapReady) return; // cooldown guard
  playExitSound();
  // [WHEEL DISABLED] reward wheel quarantined — skip straight to title
  returnToTitle();
});
