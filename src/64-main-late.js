
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
  // Layered warp SFX: play at click (t=0). Trimmed so peak transient at
  // 1.22s into clip lands at thruster fire (click + 180ms fade + 0.8*1.3s sweep = 1220ms).
  const _retryWarp = document.getElementById('retry-warp-sfx');
  if (_retryWarp && !state.muted) { _retryWarp.currentTime = 0; _retryWarp.volume = 0.55; _retryWarp.play().catch(()=>{}); }
  // No playStartSound — _triggerRetryWithSweep plays its own retry-tech SFX
  _triggerRetryWithSweep();
});
document.getElementById('gameover-exit-btn').addEventListener('click', () => {
  if (!_gameOverTapReady) return; // cooldown guard
  playExitSound();
  // [WHEEL DISABLED] reward wheel quarantined — skip straight to title
  returnToTitle();
});
