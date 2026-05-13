// ═══════════════════════════════════════════════════════════════════════════
//  BANK WATER HISS — procedural skim sound
//
//  Subtle bandpass-filtered white-noise loop that lives forever (cheap), with
//  a smoothed gain driven by the bank water visual's intensity. No mp3, no
//  HTTP request, no buffer decode — synthesized in WebAudio.
//
//  ── DESIGN NOTES ──────────────────────────────────────────────────────────
//  We want the audio crossfaded with the visual, not a one-shot trigger:
//    - One-shots feel artificial when bank intensity is varying.
//    - A continuously-running noise loop with a smoothed gain follows the
//      visual exactly (it IS the same intensity signal driving uOpacity).
//
//  CPU cost: 1 oscillator buffer (1 sec white noise looped) + 1 bandpass
//  filter + 1 lowpass filter + 1 gain. ~zero CPU.
//
//  ── INTEGRATION ───────────────────────────────────────────────────────────
//    BankWaterHiss.init(audioCtx)        // call once when audioCtx is unlocked
//    BankWaterHiss.update(intensity, dt) // call each frame; 0…1 intensity
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  const TUNING = {
    peakGain:        0.045,   // max volume — very subtle
    attackRate:      8,       // how fast gain ramps up   (per second)
    releaseRate:     3,       // how fast gain ramps down
    bandpassFreq:    3200,    // hiss center (Hz) — water skim is high-mid
    bandpassQ:       0.7,
    lowpassFreq:     8000,    // tame the very-top sizzle
    // Only audible above this intensity (matches the visual's first ramp).
    intensityFloor:  0.05,
  };

  const BankWaterHiss = {
    _ctx: null,
    _noiseSrc: null,
    _gain: null,
    _ready: false,
    _smoothed: 0,

    init(audioCtx) {
      if (this._ready || !audioCtx) return;
      try {
        this._ctx = audioCtx;

        // 1 second of mono white noise, looped. Tiny memory cost.
        const sr = audioCtx.sampleRate;
        const buf = audioCtx.createBuffer(1, sr, sr);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.loop = true;

        const bp = audioCtx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = TUNING.bandpassFreq;
        bp.Q.value         = TUNING.bandpassQ;

        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = TUNING.lowpassFreq;

        const gain = audioCtx.createGain();
        gain.gain.value = 0;

        src.connect(bp).connect(lp).connect(gain).connect(audioCtx.destination);
        src.start();

        this._noiseSrc = src;
        this._gain     = gain;
        this._ready    = true;
      } catch (e) {
        // Audio context not ready or hardware refused — best-effort, silent.
      }
    },

    // intensity in [0,1]; dt in seconds.
    update(intensity, dt) {
      if (!this._ready) return;
      const target = intensity < TUNING.intensityFloor
        ? 0
        : (intensity * TUNING.peakGain);
      const rate = target > this._smoothed ? TUNING.attackRate : TUNING.releaseRate;
      const k = Math.min(1, dt * rate);
      this._smoothed += (target - this._smoothed) * k;
      // setTargetAtTime is smoother but we're already smoothing in JS — just
      // assign. Web Audio handles param thread interpolation.
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

  window.BankWaterHiss = BankWaterHiss;
})();
