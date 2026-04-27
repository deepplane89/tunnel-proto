
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
  // Orientation gate: if user picked landscape but is in portrait (or vice versa),
  // show "rotate device" overlay and start once they comply. Native lock is
  // attempted once oriented correctly (works on Android, no-op on iOS).
  if (typeof window.__orientationGate === 'function') {
    window.__orientationGate().then(() => { startDeathRun(); });
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
