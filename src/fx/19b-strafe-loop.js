// ═══════════════════════════════════════════════════════════════════════════
//  STRAFE LOOP — continuous gain-modulated steering sound
//
//  Replaces the old edge-trigger / 2-play / fixed-fade-in strafe play path
//  with a permanently-looping argon-ambient buffer whose gain tracks
//  |window._steerNorm| (0..1). Same modulation pattern as the bank-water
//  hiss — fast attack, slow release, no hard edges.
//
//  Why: the prior path felt unreliable (fade quirks, drop-outs after the
//  second clip, race conditions with replay timers). A single eternal
//  loop + smoothed gain has zero of those failure modes.
//
//  ── INTEGRATION ───────────────────────────────────────────────────────────
//    StrafeLoop.init()                  — once when audioCtx + buffer ready
//    StrafeLoop.update(intensity, dt)   — every frame; 0..1 magnitude
//    StrafeLoop.silence()               — kill gain (death / pause / mute)
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  const TUNING = {
    peakGain:        0.55,    // peak volume when steering hard
    attackRate:      9,       // per second (slightly faster than hiss)
    releaseRate:     2.5,     // gentle tail off
    intensityFloor:  0.05,    // below this, target = 0 (silence at center)
    // Curve: square the input so light steering is quiet, hard steering bright.
    // Reads as "harder turn = more wind" instead of linear ramp.
    curveExp:        1.6,
  };

  const StrafeLoop = {
    _src: null,
    _gain: null,
    _ready: false,
    _smoothed: 0,

    // Tries to start the loop. Returns true on success.
    // Depends on _playArgonLoop (in src/30-audio.js) which returns a source
    // with _jhGain attached, or null if the buffer hasn't decoded yet.
    init() {
      if (this._ready) return true;
      if (typeof _playArgonLoop !== 'function') return false;
      const src = _playArgonLoop(0);   // start at silence
      if (!src || !src._jhGain) return false;
      this._src = src;
      this._gain = src._jhGain;
      this._ready = true;
      return true;
    },

    // intensity in [0,1]; dt in seconds.
    update(intensity, dt) {
      // Lazy init — buffer might not have been decoded when game first calls.
      if (!this._ready) { if (!this.init()) return; }
      const i = Math.min(1, Math.max(0, intensity || 0));
      const shaped = Math.pow(i, TUNING.curveExp);
      const target = i < TUNING.intensityFloor ? 0 : (shaped * TUNING.peakGain);
      const rate = target > this._smoothed ? TUNING.attackRate : TUNING.releaseRate;
      const k = Math.min(1, dt * rate);
      this._smoothed += (target - this._smoothed) * k;
      this._gain.gain.value = this._smoothed;
    },

    silence() {
      if (this._ready) {
        this._smoothed = 0;
        this._gain.gain.value = 0;
      }
    },

    getTuning() { return TUNING; },
  };

  window.StrafeLoop = StrafeLoop;
})();
