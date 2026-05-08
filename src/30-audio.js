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
let radioMusic     = null;  // shared <audio id="radio-music"> for the unlockable shuffle station
let activeFadeIv = null;  // crossfade timer handle

function initAudio() {
  // Always assign all audio elements regardless of audioCtx state
  bgMusic    = bgMusic    || document.getElementById('bgm');
  titleMusic = titleMusic || document.getElementById('title-music');
  l3Music    = l3Music    || document.getElementById('l3-music');
  l4Music        = l4Music        || document.getElementById('l4-music');
  lakeMusic      = lakeMusic      || document.getElementById('lake-music');
  keepGoingMusic = keepGoingMusic || document.getElementById('keep-going-music');
  radioMusic     = radioMusic     || document.getElementById('radio-music');
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
  const _CtxClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new _CtxClass({ latencyHint: 'interactive' });
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

// iOS Safari can interrupt audio playback when the AudioContext enters
// 'interrupted' state (backgrounding, phone call, audio-route change). After
// the context resumes to 'running', the existing MediaElementSource nodes
// remain validly connected to destination — what's actually broken is that
// the <audio> elements themselves stalled and need a play() kick.
//
// IMPORTANT: per W3C spec (and Safari's strict enforcement), an <audio>
// element can only ever have ONE MediaElementSource attached for its entire
// lifetime. Calling createMediaElementSource() a second time throws
// InvalidStateError, even after disconnecting the original. We previously
// tried to "rewire" by tearing down and rebuilding sources, which silently
// failed in the catch and left music permanently disconnected. The fix is
// to NEVER recreate sources — leave the original graph intact, just
// re-kick the <audio> elements that were playing.
let _audioInterrupted = false;
// Snapshot of which tracks were playing when we got interrupted, so the
// resume path can re-kick exactly those (and not start tracks that were
// intentionally paused at interrupt time).
let _interruptedPlayingSnapshot = null;
function _markAudioInterrupted() {
  _audioInterrupted = true;
  // Snapshot which tracks were mid-playback before we paused them.
  if (typeof allTracks === 'function') {
    const snap = {};
    const t = allTracks();
    Object.keys(t).forEach(k => {
      const el = t[k];
      if (el && !el.paused) snap[k] = (el.currentTime || 0);
    });
    _interruptedPlayingSnapshot = snap;
  }
}
function _wasAudioInterrupted() { return _audioInterrupted; }
function _clearAudioInterrupted() {
  _audioInterrupted = false;
  _interruptedPlayingSnapshot = null;
}

// Re-kick music after an iOS interruption. Does NOT recreate MediaElementSource
// nodes — the original graph (source → gain → destination) is still wired.
// Just plays a 1-sample silent buffer to nudge the audio engine and re-issues
// play() on the elements that were playing when the interruption hit.
function _rewireTrackGains() {
  if (!audioCtx) return;
  // Make sure context is actually running before we kick the elements.
  if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
    audioCtx.resume().catch(() => {});
  }
  // iOS sample-rate renegotiation: 1-sample silent buffer through destination.
  // The buffer rate MUST match audioCtx.sampleRate — passing a fixed 22050
  // (the previous value) didn't actually trigger renegotiation on iOS WebKit
  // because the buffer needed resampling rather than passing through cleanly.
  // See: github.com/Jam3/ios-safe-audio-context, Howler.js issue #1141.
  try {
    const _silent = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const _src = audioCtx.createBufferSource();
    _src.buffer = _silent;
    _src.connect(audioCtx.destination);
    _src.start(0);
  } catch (_) {}
  // Wire trackGains lazily if for some reason init() never reached it (first
  // resume after a deep interruption can race with initAudio on cold start).
  if (typeof _initTrackGains === 'function') {
    try { _initTrackGains(); } catch (_) {}
  }
  // Re-kick the elements that were playing pre-interrupt. iOS needs ~100-300ms
  // after resume() to finish output sample-rate renegotiation; calling play()
  // any sooner produces the pitch-up/down artifact on resumed music. The
  // previous 2× requestAnimationFrame (~33ms at 60Hz, ~17ms at 120Hz) was far
  // too short. 200ms gives WebKit headroom while still feeling instant.
  const snap = _interruptedPlayingSnapshot || {};
  const tracks = (typeof allTracks === 'function') ? allTracks() : {};
  setTimeout(() => {
    if (state.muted) { _clearAudioInterrupted(); return; }
    Object.keys(snap).forEach(k => {
      const el = tracks[k];
      if (!el) return;
      try {
        // currentTime is preserved by Safari across pause/resume, but we
        // restore from the snapshot defensively in case the element got
        // bumped (e.g. an .ended fired during background).
        if (typeof snap[k] === 'number' && Math.abs((el.currentTime || 0) - snap[k]) > 1.5) {
          el.currentTime = snap[k];
        }
        el.play().catch(() => {});
      } catch (_) {}
    });
    _clearAudioInterrupted();
  }, 200);
}
function _initSFXBuffers() {
  if (!audioCtx) return;
  _loadSFXBuffer('nearmiss', './assets/audio/nearmiss.mp3');
  _loadSFXBuffer('whoosh', './assets/audio/whoosh2.mp3');
  _loadSFXBuffer('whoosh-release', './assets/audio/whoosh-release.mp3');
  _loadSFXBuffer('thunder1', './assets/audio/thunder1.mp3');
  _loadSFXBuffer('thunder2', './assets/audio/thunder2.mp3');
  _loadSFXBuffer('lightning-impact', './assets/audio/lightning-impact.mp3');
  _loadSFXBuffer('klaxon',   './assets/audio/klaxon.mp3');
  // Argon ambient: looped via dedicated _playArgonLoop (volume modulated each frame)
  _loadSFXBuffer('argon-ambient',   './assets/audio/argon-ambient.mp3');
  // Laser machine-gun: one-shot per fire-rate tick instead of looping the whole clip.
  _loadSFXBuffer('laser-mg',        './assets/audio/laser-beam-mg.mp3');
  // Shop tier-upgrade SFX — VR transform sweep (replaces the VR_compute beep).
  _loadSFXBuffer('shop-purchase',   './assets/audio/vr-transform-powerup.mp3');
  _loadSFXBuffer('reject',          './assets/audio/reject.mp3');
  // Title-screen menu taps + Exit/Resume + Garage open/close on title — pinball pip.
  _loadSFXBuffer('menu-cycle',      './assets/audio/menu-cycle.wav');
  // Garage card cycling (skin / preset / color / addon) — VR clicker.
  _loadSFXBuffer('garage-cycle',    './assets/audio/vr-transform-clicker.mp3');
  // Garage selection confirm — VR transform contacts. Fires when picking an
  // unlocked item (ship/thruster/mod/handling preset) or opening tier list.
  _loadSFXBuffer('garage-select',   './assets/audio/garage-select.mp3');
  // Title-screen "death run" button (the ENTER moment from the loading screen).
  _loadSFXBuffer('start-interference', './assets/audio/start-interference.mp3');
  // Pause-menu EXIT in gameplay — VR compute interference cue.
  _loadSFXBuffer('pause-exit',      './assets/audio/pause-exit.mp3');
  // Title-screen UI exits (garage close, settings close, daily streak close,
  // any back/exit on title) — VR mecha interlock.
  _loadSFXBuffer('title-exit',      './assets/audio/title-exit.mp3');
  // Tap-to-play on title screen — low whoosh.
  _loadSFXBuffer('tap-to-play',     './assets/audio/tap-to-play.mp3');
  // Garage open/close audio removed — no sample needed.
}

// Decode a sample, then build a sample-reversed clone under another name.
// Useful when one source file should serve as both "forward" and "reverse"
// cues (e.g. open/close) without shipping a second mp3.
function _loadSFXBufferWithReverse(forwardName, reverseName, url) {
  if (!audioCtx) return;
  if (_sfxBuffers[forwardName] || _sfxLoading[forwardName]) return;
  _sfxLoading[forwardName] = fetch(url)
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(decoded => {
      _sfxBuffers[forwardName] = decoded;
      try {
        const rev = audioCtx.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          const src = decoded.getChannelData(ch);
          const dst = rev.getChannelData(ch);
          const n = src.length;
          for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i];
        }
        _sfxBuffers[reverseName] = rev;
      } catch(_){}
    })
    .catch(() => {});
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
const _sfxFallbackIds = { 'nearmiss': 'nearmiss-sfx', 'whoosh': 'whoosh1', 'whoosh-release': 'whoosh-release', 'laser-mg': 'laser-beam-sfx', 'shop-purchase': 'shop-purchase-sfx', 'reject': 'reject-sfx' };
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

// Played when the player taps something they can't interact with: a locked
// upgrade card, a fully-maxed power-up they can't enter the tier menu of, a
// locked thruster preset, etc. Short "computer reject" blip.
function playReject() {
  _playBuffer('reject', 0.55, 1.0, null);
}
window.playReject = playReject;

// Garage open/close sounds removed per design — silent now. Stubs kept so
// existing callers (Showroom.open/close) don't need to change.
function playGarageOpen()  { /* no-op */ }
function playGarageClose() { /* no-op */ }
window.playGarageOpen  = playGarageOpen;
window.playGarageClose = playGarageClose;

// Title-screen menu taps, Exit/Resume, garage open/close on title — VR clicker.
function playMenuCycle() { _playBuffer('menu-cycle', 0.6, 1.0, null); }
window.playMenuCycle = playMenuCycle;

// Garage card cycling (Showroom internal nav) — pinball pip.
function playGarageCycle() { _playBuffer('garage-cycle', 0.5, 1.0, null); }
window.playGarageCycle = playGarageCycle;

// Garage SELECT confirm — VR transform contacts. Plays when player picks an
// unlocked ship/thruster/mod/handling-preset, or opens tier-list/upgrade view.
function playGarageSelect() { _playBuffer('garage-select', 0.55, 1.0, null); }
window.playGarageSelect = playGarageSelect;

// Title-screen "start death run" press.
function playStartInterference() { _playBuffer('start-interference', 0.7, 1.0, null); }
window.playStartInterference = playStartInterference;

// Pause-menu EXIT during gameplay — VR compute interference.
function playPauseExit() { _playBuffer('pause-exit', 0.7, 1.0, null); }
window.playPauseExit = playPauseExit;

// Title-screen UI exits (garage/settings/etc back) — VR mecha interlock.
function playTitleExit() { _playBuffer('title-exit', 0.7, 1.0, null); }
window.playTitleExit = playTitleExit;

// Tap-to-play on title screen — low whoosh.
function playTapToPlay() { _playBuffer('tap-to-play', 0.7, 1.0, null); }
window.playTapToPlay = playTapToPlay;

function playCrash() {
