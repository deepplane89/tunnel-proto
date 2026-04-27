
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
  // Fire native orientation lock + show prompt if needed (mobile only),
  // BUT start the game synchronously — do NOT await. iOS Safari requires
  // audio/game start to happen inside the user-gesture call stack; awaiting
  // a promise yields the event loop and breaks audio unlock.
  if (typeof window.__orientationLockNow === 'function') {
    try { window.__orientationLockNow(); } catch (_) {}
  }
  startDeathRun();
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
