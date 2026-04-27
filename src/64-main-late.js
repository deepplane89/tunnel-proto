
// ── BUTTON HANDLERS ──
document.getElementById('death-run-btn').addEventListener('click', () => {
  initAudio();
  // Pre-warm engine sounds on user gesture (mobile requires this)
  // Just load them — don't play, to avoid any audible glitch
  const _ewEng = document.getElementById('engine-start');
  const _ewRoar = document.getElementById('engine-roar');
  if (_ewEng) { _ewEng.load(); }
  if (_ewRoar) { _ewRoar.load(); }
  playStartSound();
  startDeathRun();
});
document.getElementById('restart-btn').addEventListener('click', () => {
  if (!_gameOverTapReady) return; // cooldown guard
  initAudio();
  // No playStartSound — _triggerRetryWithSweep plays its own retry-tech + retry-warp SFX
  _triggerRetryWithSweep();
});
document.getElementById('gameover-exit-btn').addEventListener('click', () => {
  if (!_gameOverTapReady) return; // cooldown guard
  playExitSound();
  // [WHEEL DISABLED] reward wheel quarantined — skip straight to title
  returnToTitle();
});
