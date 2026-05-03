// ═══════════════════════════════════════════════════
//  AUDIO (procedural Web Audio)
// ═══════════════════════════════════════════════════
let audioCtx = null;
let engineOsc = null, engineGain = null;

let bgMusic        = null;
let titleMusic     = null;
let l3Music        = null;
let l4Music        = null;
let lakeMusic      = null;
let keepGoingMusic = null;
let activeFadeIv = null;  // crossfade timer handle

function initAudio() {
  // Always assign all audio elements regardless of audioCtx state
  bgMusic    = bgMusic    || document.getElementById('bgm');
  titleMusic = titleMusic || document.getElementById('title-music');
  l3Music    = l3Music    || document.getElementById('l3-music');
  l4Music        = l4Music        || document.getElementById('l4-music');
  lakeMusic      = lakeMusic      || document.getElementById('lake-music');
  keepGoingMusic = keepGoingMusic || document.getElementById('keep-going-music');
  if (keepGoingMusic && !keepGoingMusic._endlessLoopSet) {
    keepGoingMusic._endlessLoopSet = true;
    keepGoingMusic.addEventListener('ended', () => {
      if (state.isDeathRun && state.phase === 'playing') musicFadeTo('l4', 3000);
    });
  }
  initWhoosh();

  if (audioCtx) {
    // AudioContext exists but gains might not be wired yet (elements assigned late)
    _initTrackGains();
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  _ensureCtxRunning();

  // Engine hum removed — keep gain node at 0 so SFX chain still works
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0.0;
  engineGain.connect(audioCtx.destination);

  // Wire music tracks through Web Audio gain nodes
  _initTrackGains();

  // Pre-decode SFX into AudioBuffers for instant mobile playback
  _initSFXBuffers();

}



// ── Magnet whir (continuous while magnet active) ──
let _magnetWhirOsc  = null;
let _magnetWhirGain = null;
let _magnetWhirLfo  = null;
let _magnetWhirLfoG = null;
function _startMagnetWhir() {
  if (!audioCtx || state.muted || _magnetWhirOsc) return;
  const _sM = (typeof sfxMult === 'function' ? sfxMult() : 1);
  if (_sM <= 0) return;
  _ensureCtxRunning();
  _magnetWhirGain = audioCtx.createGain();
  _magnetWhirGain.gain.setValueAtTime(0, audioCtx.currentTime);
  _magnetWhirGain.gain.linearRampToValueAtTime(0.055 * _sM, audioCtx.currentTime + 0.35);
  _magnetWhirGain.connect(audioCtx.destination);
  _magnetWhirOsc = audioCtx.createOscillator();
  _magnetWhirOsc.type = 'sawtooth';
  _magnetWhirOsc.frequency.setValueAtTime(48, audioCtx.currentTime);
  _magnetWhirOsc.frequency.linearRampToValueAtTime(76, audioCtx.currentTime + 0.35);
  _magnetWhirOsc.connect(_magnetWhirGain);
  _magnetWhirOsc.start();
  _magnetWhirLfoG = audioCtx.createGain();
  _magnetWhirLfoG.gain.value = 9;
  _magnetWhirLfoG.connect(_magnetWhirOsc.frequency);
  _magnetWhirLfo = audioCtx.createOscillator();
  _magnetWhirLfo.frequency.value = 6.5;
  _magnetWhirLfo.connect(_magnetWhirLfoG);
  _magnetWhirLfo.start();
}
function _stopMagnetWhir() {
  if (!_magnetWhirOsc || !audioCtx) return;
  const t = audioCtx.currentTime;
  _magnetWhirGain.gain.cancelScheduledValues(t);
  _magnetWhirGain.gain.setValueAtTime(_magnetWhirGain.gain.value, t);
  _magnetWhirGain.gain.linearRampToValueAtTime(0, t + 0.22);
  try { _magnetWhirOsc.stop(t + 0.25); } catch(e) {}
  try { _magnetWhirLfo.stop(t + 0.25); } catch(e) {}
  _magnetWhirOsc = null; _magnetWhirGain = null;
  _magnetWhirLfo = null; _magnetWhirLfoG = null;
}

function playSFX(freq = 440, duration = 0.15, type = 'square', volume = 0.3) {
  volume *= (typeof sfxMult === 'function' ? sfxMult() : 1);
  if (!audioCtx || state.muted) return;
  _ensureCtxRunning();
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

// ── SFX Audio Buffer Pool (mobile-optimized) ──
// Decode audio files into AudioBuffers once, play via AudioBufferSourceNode
// Zero latency, no DOM element limits, no cloneNode overhead
const _sfxBuffers = {};  // name → AudioBuffer
const _sfxLoading = {};  // name → Promise
function _loadSFXBuffer(name, url) {
  if (_sfxBuffers[name] || _sfxLoading[name]) return;
  _sfxLoading[name] = fetch(url)
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(decoded => { _sfxBuffers[name] = decoded; })
    .catch(() => {});
}
function _ensureCtxRunning() {
  // Both 'suspended' (Chrome/standard) and 'interrupted' (iOS Safari after phone
  // call / Bluetooth route change) need explicit resume.
  if (audioCtx && (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted')) {
    audioCtx.resume().catch(() => {});
  }
}
function _initSFXBuffers() {
  if (!audioCtx) return;
  _loadSFXBuffer('nearmiss', './assets/audio/nearmiss.mp3');
  _loadSFXBuffer('whoosh', './assets/audio/whoosh2.mp3');
  _loadSFXBuffer('whoosh-release', './assets/audio/whoosh-release.mp3');
  _loadSFXBuffer('thunder1', './assets/audio/thunder1.mp3');
  _loadSFXBuffer('thunder2', './assets/audio/thunder2.mp3');
  _loadSFXBuffer('klaxon',   './assets/audio/klaxon.mp3');
  // Argon ambient: looped via dedicated _playArgonLoop (volume modulated each frame)
  _loadSFXBuffer('argon-ambient',   './assets/audio/argon-ambient.mp3');
  // Laser machine-gun: one-shot per fire-rate tick instead of looping the whole clip.
  _loadSFXBuffer('laser-mg',        './assets/audio/laser-beam-mg.mp3');
  _loadSFXBuffer('shop-purchase',   './assets/audio/shop_purchase.mp3');
}

// ── Argon looping handle (Web Audio path) ──
// iOS Safari ignores HTMLAudioElement.volume entirely — GainNode is the only
// way to actually modulate volume on mobile. So argon runs as a looping
// BufferSource feeding a GainNode that the per-frame steering code updates.
function _playArgonLoop(initialVol) {
  if (!audioCtx || state.muted) return null;
  _ensureCtxRunning();
  const buf = _sfxBuffers['argon-ambient'];
  if (!buf) return null; // not decoded yet — caller falls back to element
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = 1.0;
  const gain = audioCtx.createGain();
  gain.gain.value = Math.min(1, Math.max(0, initialVol || 0));
  src.connect(gain).connect(audioCtx.destination);
  src.start();
  src._jhGain = gain;
  return src;
}
// One-shot argon play with a programmable fade-in (Web Audio path).
// targetVol: peak gain. fadeInSec: linear ramp 0 → targetVol from now.
// Returns the source node (with _jhGain attached) or null if buffer not ready.
function _playArgonOnce(targetVol, fadeInSec) {
  if (!audioCtx || state.muted) return null;
  _ensureCtxRunning();
  const buf = _sfxBuffers['argon-ambient'];
  if (!buf) return null;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop = false;
  src.playbackRate.value = 1.0;
  const gain = audioCtx.createGain();
  const _t0 = audioCtx.currentTime;
  const _peak = Math.min(1, Math.max(0, targetVol || 0));
  const _fade = Math.max(0, fadeInSec || 0);
  try {
    gain.gain.setValueAtTime(0, _t0);
    if (_fade > 0) gain.gain.linearRampToValueAtTime(_peak, _t0 + _fade);
    else gain.gain.setValueAtTime(_peak, _t0);
  } catch (_) { gain.gain.value = _peak; }
  src.connect(gain).connect(audioCtx.destination);
  src.start();
  src._jhGain = gain;
  src._jhDuration = buf.duration;
  return src;
}
// SFX element fallback map — used when AudioBuffer hasn't decoded yet
const _sfxFallbackIds = { 'nearmiss': 'nearmiss-sfx', 'whoosh': 'whoosh1', 'whoosh-release': 'whoosh-release', 'laser-mg': 'laser-beam-sfx', 'shop-purchase': 'shop-purchase-sfx' };
// Play a pre-decoded buffer with gain + optional pan + playbackRate
function _playBuffer(name, volume, rate, panVal) {
  volume *= (typeof sfxMult === 'function' ? sfxMult() : 1);
  if (!audioCtx || state.muted || volume <= 0) return;
  _ensureCtxRunning();
  // Preferred: AudioBufferSourceNode (zero-latency, no DOM)
  if (_sfxBuffers[name]) {
    const src = audioCtx.createBufferSource();
    src.buffer = _sfxBuffers[name];
    src.playbackRate.value = rate || 1;
    const gain = audioCtx.createGain();
    gain.gain.value = Math.min(1, volume);
    src.connect(gain);
    if (panVal != null && typeof audioCtx.createStereoPanner === 'function') {
      const panner = audioCtx.createStereoPanner();
      panner.pan.value = panVal;
      gain.connect(panner).connect(audioCtx.destination);
    } else {
      gain.connect(audioCtx.destination);
    }
    src.start();
    return;
  }
  // Fallback: cloneNode from <audio> element (slower but works if buffer not ready)
  const elId = _sfxFallbackIds[name];
  const el = elId && document.getElementById(elId);
  if (!el) return;
  const clone = el.cloneNode();
  clone.playbackRate = rate || 1;
  clone.volume = Math.min(1, volume);
  clone.play().catch(() => {});
  clone.addEventListener('ended', () => clone.remove());
}

function playNearMissSFX() {
  if (state.muted) return;
  _ensureCtxRunning();
  const rate = 0.92 + Math.random() * 0.16;
  _playBuffer('nearmiss', 0.24, rate, null);
}

// ── Lane-change whoosh SFX ──
let whooshReady = false;
function initWhoosh() {
  // Buffer loading handled by _initSFXBuffers after AudioContext exists
  whooshReady = true;
}
let lastWhooshTime = 0;
function playWhoosh(direction, intensity) {
  if (!whooshReady || state.muted) return;
  const now = performance.now();
  if (now - lastWhooshTime < 80) return;
  lastWhooshTime = now;
  const speedNorm = Math.min(1, (state.speed || 20) / 60);
  const rate = 0.88 + Math.random() * 0.24 + speedNorm * 0.08;
  // Bumped 2026-05-02: argon ambient gone, whoosh now carries the strafe layer alone.
  // Was 0.06 + 0.14*intensity (0.06–0.20). Now 0.14 + 0.30*intensity (0.14–0.44).
  const vol = 0.14 + intensity * 0.30;
  const pan = direction * (0.3 + intensity * 0.4);
  _playBuffer('whoosh', vol, rate, pan);
}

function playWhooshRelease(direction, holdTime) {
  if (state.muted) return;
  const intensity = Math.min(1, (holdTime - 1.5) / 1.5);
  const rate = 0.90 + Math.random() * 0.15 + intensity * 0.1;
  // Bumped 2026-05-02: matched scale-up with playWhoosh.
  // Was 0.08 + 0.18*intensity (0.08–0.26). Now 0.18 + 0.38*intensity (0.18–0.56).
  const vol = 0.18 + intensity * 0.38;
  const pan = direction * (0.2 + intensity * 0.3);
  _playBuffer('whoosh-release', vol, rate, pan);
}

function playLevelUp() {
  if (!audioCtx || state.muted) return;
  [440, 550, 660, 880].forEach((f, i) => {
    setTimeout(() => playSFX(f, 0.25, 'triangle', 0.25), i * 80);
  });
}

function playShopPurchase() {
  _playBuffer('shop-purchase', 0.6, 1.0, null);
}

function playCrash() {
