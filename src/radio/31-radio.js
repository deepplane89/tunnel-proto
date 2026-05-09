// ═══════════════════════════════════════════════════
//  RADIO — unlockable shuffle station that replaces zone music in gameplay.
//
//  Unlock: after run #3 (death). Stored in localStorage.
//  When ON, gameplay zones (bg / l3 / l4 / lake / keepgoing-as-cue) all
//  play through a single shuffled <audio id="radio-music"> element instead
//  of their dedicated tracks.
//  Title music + keep-going-as-cue (when radio OFF) are untouched.
// ═══════════════════════════════════════════════════

const RADIO_TRACKS = [
  { id: 'neon-underworld',   name: 'NEON UNDERWORLD',       src: './assets/audio/l4music.mp3' },
  { id: 'brazilian-street',  name: 'BRAZILIAN STREET FIGHT',src: './assets/audio/l3music.mp3' },
  { id: 'synesthetic-gears', name: 'SYNESTHETIC GEARS',     src: './assets/audio/radio-gears-1.mp3' },
  { id: 'synthetic-gears-2', name: 'SYNTHETIC GEARS II',    src: './assets/audio/radio-gears-2.mp3' },
  { id: 'funk-of-the-night', name: 'FUNK OF THE NIGHT',     src: './assets/audio/radio-funk.mp3' },
  { id: 'orbital-ordinance', name: 'ORBITAL ORDINANCE',     src: './assets/audio/radio-orbital.mp3' },
  { id: 'neon-mountain',     name: 'NEON MOUNTAIN',         src: './assets/audio/radio-neon-mtn.mp3' },
  { id: 'house-of-fuel',     name: 'HOUSE OF FUEL',         src: './assets/audio/radio-house-of-fuel.mp3' },
  { id: 'grannies-synth',    name: 'GRANNIES SYNTH',        src: './assets/audio/radio-grannies-synth.mp3' },
  { id: 'andracid',          name: 'ANDRACID',              src: './assets/audio/radio-andracid.mp3' },
  { id: 'cosmic-relay',      name: 'COSMIC RELAY',          src: './assets/audio/radio-cosmic-relay.mp3' },
  { id: 'cosmic-relay-2',    name: 'COSMIC RELAY II',       src: './assets/audio/radio-cosmic-relay-2.mp3' },
];
window.RADIO_TRACKS = RADIO_TRACKS;

const RADIO_LS = {
  unlocked:  'jh_radio_unlocked',
  on:        'jh_radio_on',
  runCount:  'jh_radio_run_count',
  seen:      'jh_radio_seen',     // cleared on first unlock; set when overlay opened
};
const RADIO_UNLOCK_AT = 3;  // unlock on/after death of run #3

let _radioShuffleQueue = [];   // upcoming track indexes (shuffled)
let _radioHistory      = [];   // played-track history for PREV (most recent at end)
let _radioCurrentIdx   = -1;   // currently playing index into RADIO_TRACKS
let _radioEndedHooked  = false;
const _RADIO_HISTORY_MAX = 24;

function isRadioUnlocked() {
  try { return localStorage.getItem(RADIO_LS.unlocked) === '1'; } catch(_) { return false; }
}
function setRadioUnlocked(v) {
  try { localStorage.setItem(RADIO_LS.unlocked, v ? '1' : '0'); } catch(_) {}
}
function isRadioOn() {
  if (!isRadioUnlocked()) return false;
  try { return localStorage.getItem(RADIO_LS.on) === '1'; } catch(_) { return false; }
}
function setRadioOn(v) {
  try { localStorage.setItem(RADIO_LS.on, v ? '1' : '0'); } catch(_) {}
  if (!v) stopRadio();
}
window.isRadioUnlocked = isRadioUnlocked;
window.isRadioOn       = isRadioOn;
window.setRadioOn      = setRadioOn;

// Run counter: incremented at startGame() entry. Used to unlock at run >=3.
function getRadioRunCount() {
  try { return parseInt(localStorage.getItem(RADIO_LS.runCount) || '0', 10) || 0; } catch(_) { return 0; }
}
function incrementRadioRunCount() {
  const n = getRadioRunCount() + 1;
  try { localStorage.setItem(RADIO_LS.runCount, String(n)); } catch(_) {}
  return n;
}
window.incrementRadioRunCount = incrementRadioRunCount;

// Called from death handler. If unlock threshold met and not yet unlocked,
// flip the flag and queue the toast for after the death screen settles.
// Radio stays OFF on unlock — player turns it on themselves from the overlay.
function tryUnlockRadioOnDeath() {
  if (isRadioUnlocked()) return false;
  if (getRadioRunCount() < RADIO_UNLOCK_AT) return false;
  setRadioUnlocked(true);
  // Mark unseen so the title button shows a NEW dot until the player opens it.
  try { localStorage.removeItem(RADIO_LS.seen); } catch(_) {}
  showRadioUnlockToast();
  // Refresh title-screen UI so the RADIO button appears next time we hit title.
  try { if (typeof refreshRadioButton === 'function') refreshRadioButton(); } catch(_) {}
  return true;
}
window.tryUnlockRadioOnDeath = tryUnlockRadioOnDeath;

function showRadioUnlockToast() {
  try {
    const t = document.createElement('div');
    t.className = 'radio-unlock-toast';
    t.textContent = 'RADIO UNLOCKED';
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => { try { t.remove(); } catch(_){} }, 600);
    }, 3000);
  } catch(_) {}
}

// ── Shuffle engine ──────────────────────────────────────────────────────
// Fisher-Yates the index array; refill when the queue empties. We avoid
// repeating the most-recent track by swapping the head if it matches.
function _refillShuffleQueue() {
  const arr = RADIO_TRACKS.map((_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  if (arr.length > 1 && arr[0] === _radioCurrentIdx) {
    const tmp = arr[0]; arr[0] = arr[1]; arr[1] = tmp;
  }
  _radioShuffleQueue = arr;
}

function _nextRadioIdx() {
  if (_radioShuffleQueue.length === 0) _refillShuffleQueue();
  return _radioShuffleQueue.shift();
}

function _hookRadioEnded() {
  if (_radioEndedHooked || !radioMusic) return;
  _radioEndedHooked = true;
  radioMusic.addEventListener('ended', () => {
    // Only auto-advance if we're still meant to be playing (not paused/dead).
    if (!isRadioOn()) return;
    if (state && (state.phase === 'paused' || state.phase === 'dead' || state.phase === 'title')) return;
    if (_radioCurrentIdx >= 0) {
      _radioHistory.push(_radioCurrentIdx);
      if (_radioHistory.length > _RADIO_HISTORY_MAX) _radioHistory.shift();
    }
    _playRadioIdx(_nextRadioIdx());
  });
}

function _playRadioIdx(idx) {
  if (typeof initAudio === 'function') initAudio();
  if (!radioMusic) radioMusic = document.getElementById('radio-music');
  if (!radioMusic) return;
  _hookRadioEnded();
  const tr = RADIO_TRACKS[idx];
  if (!tr) return;
  _radioCurrentIdx = idx;
  // Switching src on the same element is the cheapest way to swap; iOS handles
  // it cleanly as long as we play() from a user-gesture-tied codepath (we are).
  if (radioMusic.src.indexOf(tr.src) === -1) {
    radioMusic.src = tr.src;
  }
  try { radioMusic.currentTime = 0; } catch(_) {}
  // Volume is gated by the gain node ('radio' track) — don't fight it here.
  radioMusic.play().catch(() => {});
  // Notify pause-menu UI to refresh "now playing".
  try { if (typeof updatePauseRadioRow === 'function') updatePauseRadioRow(); } catch(_) {}
}

function startRadio() {
  if (!isRadioOn()) return;
  if (typeof initAudio === 'function') initAudio();
  if (!radioMusic) radioMusic = document.getElementById('radio-music');
  if (!radioMusic) return;
  // If already playing, just make sure gain is up.
  if (!radioMusic.paused) {
    try { setTrackVol('radio', TRACK_VOL.radio); } catch(_) {}
    return;
  }
  // If the same track is already loaded (just paused — e.g. death→retry,
  // gameplay→pause→continue), resume from currentTime instead of restarting.
  // _playRadioIdx always slams currentTime=0, so calling it here would lose
  // the listener's spot in the song.
  const idx = (_radioCurrentIdx >= 0) ? _radioCurrentIdx : -1;
  const tr = (idx >= 0) ? RADIO_TRACKS[idx] : null;
  const sameTrackLoaded = !!(tr && radioMusic.src && radioMusic.src.indexOf(tr.src) !== -1);
  if (sameTrackLoaded) {
    try { radioMusic.play().catch(() => {}); } catch(_) {}
    try { setTrackVol('radio', TRACK_VOL.radio); } catch(_) {}
    try { if (typeof updatePauseRadioRow === 'function') updatePauseRadioRow(); } catch(_) {}
    return;
  }
  // First-time start (or src cleared): pick a track and play from 0.
  const playIdx = (idx >= 0) ? idx : _nextRadioIdx();
  _playRadioIdx(playIdx);
  try { setTrackVol('radio', TRACK_VOL.radio); } catch(_) {}
}
window.startRadio = startRadio;

function stopRadio() {
  try {
    if (radioMusic && !radioMusic.paused) radioMusic.pause();
  } catch(_) {}
  try { setTrackVol('radio', 0); } catch(_) {}
}
window.stopRadio = stopRadio;

function skipRadioTrack() {
  if (!isRadioOn()) return;
  _playRadioIdx(_nextRadioIdx());
}
window.skipRadioTrack = skipRadioTrack;

function currentRadioTrackName() {
  const tr = RADIO_TRACKS[_radioCurrentIdx];
  return tr ? tr.name : '';
}
window.currentRadioTrackName = currentRadioTrackName;

// ── musicFadeTo divert helper ────────────────────────────────────────────
// Called from musicFadeTo() (in 20-main-early.js) when radio is ON. Returns
// true if it took over the fade.
//
// Two flavors:
//  • Gameplay target (bg/l3/l4/lake/keepgoing): fade EVERYTHING but radio
//    down — including title — so hitting play from the title screen actually
//    silences title music as radio takes over.
//  • Title target: keep radio rolling untouched. The death → title and L5
//    ending → title transitions both call musicFadeTo('title'), and there's
//    no reason for the radio to drop out — the player explicitly turned it on
//    and never asked for it to stop. Make sure title music itself stays
//    silent in that window.
const _RADIO_GAMEPLAY_TRACKS = { bg: 1, l3: 1, l4: 1, lake: 1, keepgoing: 1 };
function radioInterceptMusicFade(toTrack, durationMs) {
  if (!isRadioOn()) return false;
  if (toTrack === 'title') {
    // Keep radio playing seamlessly through gameplay → title transitions.
    try {
      const all = (typeof allTracks === 'function') ? allTracks() : {};
      const durSec = (durationMs || 1500) / 1000;
      Object.entries(all).forEach(([k, el]) => {
        if (!el) return;
        if (k === 'radio') return;
        if (k === 'lake') return; // lake is its own ambience; leave as-is
        if (typeof rampTrackVol === 'function') rampTrackVol(k, 0, durSec);
        setTimeout(() => { try { if (!el.paused) el.pause(); } catch(_){} }, (durationMs || 1500) + 50);
      });
      // Make sure radio is actually rolling at full vol (it may have been
      // paused mid-run by some other path).
      startRadio();
      if (typeof rampTrackVol === 'function' && radioMusic) {
        rampTrackVol('radio', TRACK_VOL.radio, Math.min(durSec, 0.4));
      }
      return true;
    } catch(_) { return false; }
  }
  if (!_RADIO_GAMEPLAY_TRACKS[toTrack]) return false;
  try {
    const all = (typeof allTracks === 'function') ? allTracks() : {};
    const durSec = (durationMs || 1500) / 1000;
    Object.entries(all).forEach(([k, el]) => {
      if (!el) return;
      if (k === 'radio') return;
      if (typeof rampTrackVol === 'function') rampTrackVol(k, 0, durSec);
      setTimeout(() => { try { if (!el.paused) el.pause(); } catch(_){} }, (durationMs || 1500) + 50);
    });
    startRadio();
    if (typeof rampTrackVol === 'function' && radioMusic) {
      rampTrackVol('radio', 0, 0);
      rampTrackVol('radio', TRACK_VOL.radio, durSec);
    }
    return true;
  } catch(_) { return false; }
}
window.radioInterceptMusicFade = radioInterceptMusicFade;

// ── UI: title-screen RADIO button visibility + NEW dot ──────────────────
function _isRadioSeen() {
  try { return localStorage.getItem(RADIO_LS.seen) === '1'; } catch(_) { return false; }
}
function _markRadioSeen() {
  try { localStorage.setItem(RADIO_LS.seen, '1'); } catch(_) {}
}
function refreshRadioButton() {
  const btn = document.getElementById('radio-btn');
  if (!btn) return;
  if (isRadioUnlocked()) btn.classList.remove('hidden');
  else                   btn.classList.add('hidden');
  // Pulse a NEW dot until the player opens the overlay for the first time.
  btn.classList.toggle('has-new', isRadioUnlocked() && !_isRadioSeen());
}
window.refreshRadioButton = refreshRadioButton;

// ── UI: radio overlay (title-screen only) ──────────────────────────────
let _radioPreviewIdx = -1;   // currently-previewing track in the overlay
function openRadio() {
  if (!isRadioUnlocked()) return;
  try { if (typeof initAudio === 'function') initAudio(); } catch(_) {}
  try { if (typeof playTitleTap === 'function') playTitleTap(); } catch(_) {}
  const ov = document.getElementById('radio-overlay');
  if (!ov) return;
  ov.classList.remove('hidden');
  // Acknowledge the NEW dot the moment the overlay opens.
  _markRadioSeen();
  try { refreshRadioButton(); } catch(_) {}
  _renderRadioOverlay();
}
window.openRadio = openRadio;

function closeRadio() {
  try { if (typeof playTitleClose === 'function') playTitleClose(); } catch(_) {}
  const ov = document.getElementById('radio-overlay');
  if (ov) ov.classList.add('hidden');
  try { _stopRadioPlayerLoop(); } catch(_) {}
  // Intentionally DO NOT stop the preview here. If the player started a track
  // they want it to keep playing on the title screen after they close the
  // overlay. _stopRadioPreview is called from startGame and on death so the
  // preview never bleeds into gameplay or game-over.
}
window.closeRadio = closeRadio;
window._stopRadioPreview = _stopRadioPreview;

// Called from startGame() when radio is OFF — forces any title-screen
// preview to stop so it doesn't bleed into gameplay. Bypasses the
// phase-aware guard inside _stopRadioPreview (which by design refuses to
// pause radio mid-run).
function stopRadioPreviewForce() {
  if (_radioPreviewIdx < 0 && (!radioMusic || radioMusic.paused)) return;
  try { if (radioMusic && !radioMusic.paused) radioMusic.pause(); } catch(_) {}
  try { setTrackVol('radio', 0); } catch(_) {}
  _radioPreviewIdx = -1;
  try { _updatePlayIcon(); } catch(_) {}
}
window.stopRadioPreviewForce = stopRadioPreviewForce;

function _stopRadioPreview() {
  if (_radioPreviewIdx < 0) return;
  if (radioMusic && !radioMusic.paused && state && state.phase !== 'playing') {
    try { radioMusic.pause(); } catch(_) {}
    try { setTrackVol('radio', 0); } catch(_) {}
  }
  _radioPreviewIdx = -1;
  // Restore title music if we ducked it for the preview (title-screen only).
  if (state && state.phase === 'title' && titleMusic && !state.muted) {
    try {
      if (titleMusic.paused) { titleMusic.play().catch(() => {}); }
      if (typeof rampTrackVol === 'function') rampTrackVol('title', TRACK_VOL.title, 0.20);
      else setTrackVol('title', TRACK_VOL.title);
    } catch(_) {}
  }
  try { _updatePlayIcon(); } catch(_) {}
}

function _previewRadioTrack(idx) {
  if (typeof initAudio === 'function') initAudio();
  if (!radioMusic) radioMusic = document.getElementById('radio-music');
  if (!radioMusic) return;
  const tr = RADIO_TRACKS[idx];
  if (!tr) return;
  if (radioMusic.src.indexOf(tr.src) === -1) radioMusic.src = tr.src;
  try { radioMusic.currentTime = 0; } catch(_) {}
  // Duck title music while previewing so they don't overlap on the title screen.
  if (titleMusic && !titleMusic.paused) {
    try { if (typeof rampTrackVol === 'function') rampTrackVol('title', 0, 0.18); else setTrackVol('title', 0); } catch(_) {}
    setTimeout(() => { try { if (titleMusic && !titleMusic.paused) titleMusic.pause(); } catch(_) {} }, 220);
  }
  try { setTrackVol('radio', TRACK_VOL.radio); } catch(_) {}
  radioMusic.play().catch(() => {});
  _radioPreviewIdx = idx;
  _updatePlayerMeta();
  _updatePlayIcon();
}

// ── New premium player UI ─────────────────────────────────────────────
// Two players share the same audio + analyser:
//   'rp-' prefix = title-screen radio overlay
//   'pp-' prefix = in-game pause-menu player
let _rpRAF = 0;
const _rpEqCtxs = {};   // keyed by canvas id
let _rpEqBuf = null;
const RP_PREFIXES = ['rp', 'pp'];

function _fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  return m + ':' + ss;
}
function _pad2(n) { return n.toString().padStart(2, '0'); }

function _updatePlayerMeta() {
  const total = RADIO_TRACKS.length;
  const i = (_radioPreviewIdx >= 0) ? _radioPreviewIdx
          : (_radioCurrentIdx >= 0) ? _radioCurrentIdx
          : 0;
  const tr = RADIO_TRACKS[i];
  if (!tr) return;
  RP_PREFIXES.forEach(p => {
    const titleEl = document.getElementById(p + '-title');
    if (!titleEl) return;
    titleEl.textContent = tr.name;
    requestAnimationFrame(() => {
      if (titleEl.scrollWidth > titleEl.clientWidth + 4) titleEl.classList.add('scroll');
      else titleEl.classList.remove('scroll');
    });
  });
}

function _updatePlayIcon() {
  const playing = !!(radioMusic && !radioMusic.paused);
  RP_PREFIXES.forEach(p => {
    const icon = document.getElementById(p + '-play-icon');
    const btn  = document.getElementById(p + '-play');
    if (!icon || !btn) return;
    if (playing) {
      icon.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
      btn.setAttribute('aria-label', 'Pause');
    } else {
      icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
      btn.setAttribute('aria-label', 'Play');
    }
  });
}

function _drawRadioEqOnCanvas(cv) {
  if (!cv || cv.offsetParent === null) return; // skip if hidden
  let ctx = _rpEqCtxs[cv.id];
  if (!ctx) { ctx = cv.getContext('2d'); _rpEqCtxs[cv.id] = ctx; }
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const an = window._radioAnalyser;
  const bars = 8;
  const gap = 2;
  const bw = (W - gap * (bars - 1)) / bars;
  let levels = new Array(bars).fill(0);
  const playing = !!(radioMusic && !radioMusic.paused);
  if (an && playing) {
    if (!_rpEqBuf || _rpEqBuf.length !== an.frequencyBinCount) {
      _rpEqBuf = new Uint8Array(an.frequencyBinCount);
    }
    an.getByteFrequencyData(_rpEqBuf);
    // Map 32 bins down to 8 bars (skip top half — usually empty).
    const usable = Math.floor(_rpEqBuf.length * 0.85);
    const per = Math.max(1, Math.floor(usable / bars));
    for (let i = 0; i < bars; i++) {
      let s = 0;
      for (let j = 0; j < per; j++) s += _rpEqBuf[i * per + j];
      levels[i] = (s / per) / 255;
    }
  } else if (playing) {
    // Analyser unavailable — gentle pseudo-random fallback.
    const t = performance.now() / 240;
    for (let i = 0; i < bars; i++) {
      levels[i] = 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(t + i * 0.7));
    }
  } else {
    // Idle — flat baseline.
    for (let i = 0; i < bars; i++) levels[i] = 0.06;
  }
  // Draw bars bottom-up with a cyan gradient.
  const grad = ctx.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, 'rgba(34, 211, 238, 0.55)');
  grad.addColorStop(1, '#0ff');
  ctx.fillStyle = grad;
  ctx.shadowColor = 'rgba(34, 211, 238, 0.55)';
  ctx.shadowBlur = 4;
  for (let i = 0; i < bars; i++) {
    const h = Math.max(2, levels[i] * (H - 2));
    const x = i * (bw + gap);
    const y = H - h;
    ctx.fillRect(x, y, bw, h);
  }
  ctx.shadowBlur = 0;
}
function _drawRadioEq() {
  RP_PREFIXES.forEach(p => _drawRadioEqOnCanvas(document.getElementById(p + '-eq')));
}

let _rpSeeking = false;  // true while user is dragging the progress track
function _radioPlayerTick() {
  let d = 0, t = 0;
  if (radioMusic) {
    d = isFinite(radioMusic.duration) ? radioMusic.duration : 0;
    t = radioMusic.currentTime || 0;
  }
  RP_PREFIXES.forEach(p => {
    const fill = document.getElementById(p + '-progress-fill');
    const cur  = document.getElementById(p + '-time-cur');
    const tot  = document.getElementById(p + '-time-tot');
    if (!fill || !cur || !tot) return;
    // Don't fight the user's finger while seeking — handler owns fill+time.
    if (!_rpSeeking) {
      fill.style.width = (d > 0 ? (t / d * 100) : 0) + '%';
      cur.textContent = _fmtTime(t);
    }
    tot.textContent = _fmtTime(d);
  });
  _drawRadioEq();
  _rpRAF = requestAnimationFrame(_radioPlayerTick);
}

function _stepRadioTrack(dir) {
  if (typeof initAudio === 'function') initAudio();
  const cur = (_radioPreviewIdx >= 0) ? _radioPreviewIdx
            : (_radioCurrentIdx >= 0) ? _radioCurrentIdx
            : -1;
  let nextIdx;
  if (dir > 0) {
    // NEXT: pull from the shuffle queue. Push current onto history.
    if (cur >= 0) {
      _radioHistory.push(cur);
      if (_radioHistory.length > _RADIO_HISTORY_MAX) _radioHistory.shift();
    }
    nextIdx = _nextRadioIdx();
    // Avoid landing on the same track we're already on (small playlists).
    if (nextIdx === cur && RADIO_TRACKS.length > 1) {
      if (_radioShuffleQueue.length === 0) _refillShuffleQueue();
      const swap = _radioShuffleQueue.shift();
      if (typeof swap === 'number') nextIdx = swap;
    }
  } else {
    // PREV: pop history. If empty, pick a fresh shuffle pick (still random).
    if (_radioHistory.length > 0) {
      nextIdx = _radioHistory.pop();
    } else {
      nextIdx = _nextRadioIdx();
      if (nextIdx === cur && RADIO_TRACKS.length > 1) {
        if (_radioShuffleQueue.length === 0) _refillShuffleQueue();
        const swap = _radioShuffleQueue.shift();
        if (typeof swap === 'number') nextIdx = swap;
      }
    }
  }
  if (typeof nextIdx !== 'number' || nextIdx < 0) return;
  _previewRadioTrack(nextIdx);
}

function _togglePlayPause() {
  if (typeof initAudio === 'function') initAudio();
  if (!radioMusic) radioMusic = document.getElementById('radio-music');
  if (!radioMusic) return;
  // In gameplay (playing or paused), the play/pause button is the radio's
  // master switch — PLAY enables radio (and starts diverting gameplay zones
  // to it via the interceptor); PAUSE fully disables radio so the proper
  // gameplay music resumes on continue. This matches user expectation that
  // "pausing the radio" means the game music should come back.
  const inGame = state && (state.phase === 'playing' || state.phase === 'paused');
  if (radioMusic.paused) {
    if (inGame && !isRadioOn()) {
      enableRadioInGame();
      return;
    }
    if (!radioMusic.src) {
      const i = (_radioPreviewIdx >= 0) ? _radioPreviewIdx : 0;
      _previewRadioTrack(i);
      return;
    }
    try { setTrackVol('radio', TRACK_VOL.radio); } catch(_) {}
    if (titleMusic && !titleMusic.paused) {
      try { if (typeof rampTrackVol === 'function') rampTrackVol('title', 0, 0.18); else setTrackVol('title', 0); } catch(_) {}
      setTimeout(() => { try { if (titleMusic && !titleMusic.paused) titleMusic.pause(); } catch(_) {} }, 220);
    }
    radioMusic.play().catch(() => {});
  } else {
    // In-game pause = full disable so the zone music comes back. Title-screen
    // pause is just an audio-element pause (radio stays unlocked, no game
    // music to swap to).
    if (inGame && isRadioOn()) {
      disableRadioInGame();
    } else {
      try { radioMusic.pause(); } catch(_) {}
    }
  }
  _updatePlayIcon();
}

// Mid-run: turn the shuffle station ON, duck/pause every other track
// (including the title-music pause underscore), fade radio in.
function enableRadioInGame() {
  if (typeof initAudio === 'function') initAudio();
  setRadioOn(true);
  try {
    const all = (typeof allTracks === 'function') ? allTracks() : {};
    Object.entries(all).forEach(([k, el]) => {
      if (!el || k === 'radio') return;
      if (typeof rampTrackVol === 'function') rampTrackVol(k, 0, 0.6);
      setTimeout(() => { try { if (!el.paused) el.pause(); } catch(_){} }, 700);
    });
  } catch(_) {}
  startRadio();
  if (typeof rampTrackVol === 'function' && radioMusic) {
    try { rampTrackVol('radio', 0, 0); rampTrackVol('radio', TRACK_VOL.radio, 0.6); } catch(_) {}
  }
  _updatePlayerMeta();
  _updatePlayIcon();
  _refreshShuffleSwitches();
}
window.enableRadioInGame = enableRadioInGame;

// Mid-run: turn the shuffle station OFF and bring the current zone's
// gameplay music back. Works whether we're 'playing' or 'paused'.
function disableRadioInGame() {
  setRadioOn(false);
  // Hard-stop the radio synchronously so it can't bleed through.
  try { if (typeof setTrackVol === 'function') setTrackVol('radio', 0); } catch(_) {}
  try { if (radioMusic && !radioMusic.paused) radioMusic.pause(); } catch(_) {}
  // What track should fill the silence depends on phase:
  //   - paused : title music is the pause underscore. resumeGameTrackInPlace
  //              will swap title → zone on CONTINUE.
  //   - playing: bring the zone gameplay track straight back.
  // currentGameTrack() is campaign + DR sequence aware.
  try {
    if (state && !state.muted) {
      const k = (state.phase === 'paused' && titleMusic) ? 'title'
              : ((typeof currentGameTrack === 'function') ? currentGameTrack() : 'bg');
      const el = (typeof allTracks === 'function') ? allTracks()[k] : null;
      if (el) {
        if (k === 'title') { try { el.currentTime = 0; } catch(_) {} }
        if (el.paused) { try { el.play().catch(() => {}); } catch(_) {} }
        if (typeof rampTrackVol === 'function') rampTrackVol(k, TRACK_VOL[k], 0.6);
        else setTrackVol(k, TRACK_VOL[k]);
      }
    }
  } catch(_) {}
  _updatePlayIcon();
  _refreshShuffleSwitches();
}
window.disableRadioInGame = disableRadioInGame;

function _refreshShuffleSwitches() {
  const on = isRadioOn();
  ['radio-master-toggle', 'pp-shuffle-toggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

// Wire transport buttons for one prefix (idempotent).
// In gameplay, PREV/NEXT only step when shuffle is ON — they never sneak
// the radio on. PLAY auto-enables shuffle (it's the user's consent moment).
function _wirePlayerTransport(prefix) {
  const prev = document.getElementById(prefix + '-prev');
  const play = document.getElementById(prefix + '-play');
  const next = document.getElementById(prefix + '-next');
  const inGame = () => state && (state.phase === 'playing' || state.phase === 'paused');
  if (prev && !prev._wired) {
    prev._wired = true;
    prev.addEventListener('click', (e) => {
      e.stopPropagation();
      if (inGame() && !isRadioOn()) return;
      _stepRadioTrack(-1);
    });
  }
  if (next && !next._wired) {
    next._wired = true;
    next.addEventListener('click', (e) => {
      e.stopPropagation();
      if (inGame() && !isRadioOn()) return;
      _stepRadioTrack(1);
    });
  }
  if (play && !play._wired) {
    play._wired = true;
    play.addEventListener('click', (e) => { e.stopPropagation(); _togglePlayPause(); });
  }

  // Tap/drag the progress track to seek. iOS Safari + iOS PWA needs explicit
  // touch handlers — pointer events alone get hijacked by gesture systems
  // (rubber-band, native scroll), so we wire BOTH paths and gate against
  // double-fire via a single _rpSeeking flag.
  const track = document.getElementById(prefix + '-progress-track');
  if (track && !track._wired) {
    track._wired = true;
    let pendingT = 0;
    const ratioFromXY = (clientX) => {
      const r = track.getBoundingClientRect();
      if (r.width <= 0) return 0;
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    };
    const updateUI = (ratio, t) => {
      RP_PREFIXES.forEach(p => {
        const f = document.getElementById(p + '-progress-fill');
        const c = document.getElementById(p + '-time-cur');
        if (f) f.style.width = (ratio * 100) + '%';
        if (c) c.textContent = _fmtTime(t);
      });
    };
    const begin = (clientX) => {
      if (!radioMusic || !isFinite(radioMusic.duration) || radioMusic.duration <= 0) return false;
      _rpSeeking = true;
      const ratio = ratioFromXY(clientX);
      pendingT = radioMusic.duration * ratio;
      updateUI(ratio, pendingT);
      return true;
    };
    const move = (clientX) => {
      if (!_rpSeeking) return;
      const d = (radioMusic && isFinite(radioMusic.duration)) ? radioMusic.duration : 0;
      const ratio = ratioFromXY(clientX);
      pendingT = d * ratio;
      updateUI(ratio, pendingT);
    };
    const commit = () => {
      if (!_rpSeeking) return;
      _rpSeeking = false;
      try { if (radioMusic && isFinite(pendingT)) radioMusic.currentTime = pendingT; } catch(_){}
    };

    // ── Pointer Events path (desktop + Android Chrome). On iOS Safari we
    //    suppress this path because Touch Events fire first and we don't
    //    want both to begin().
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;  // touch path handles it
      e.stopPropagation();
      if (!begin(e.clientX)) return;
      try { track.setPointerCapture(e.pointerId); } catch(_){}
    });
    track.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (_rpSeeking) move(e.clientX);
    });
    const ptrEnd = (e) => {
      if (e.pointerType === 'touch') return;
      commit();
      try { track.releasePointerCapture(e.pointerId); } catch(_){}
    };
    track.addEventListener('pointerup', ptrEnd);
    track.addEventListener('pointercancel', ptrEnd);

    // ── Touch Events path (iOS Safari, iOS PWA, fallback). Non-passive so
    //    we can preventDefault to stop scroll/rubber-band stealing the drag.
    track.addEventListener('touchstart', (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      if (!begin(t.clientX)) return;
      e.stopPropagation();
      if (e.cancelable) { try { e.preventDefault(); } catch(_){} }
    }, { passive: false });
    track.addEventListener('touchmove', (e) => {
      if (!_rpSeeking) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      move(t.clientX);
      e.stopPropagation();
      if (e.cancelable) { try { e.preventDefault(); } catch(_){} }
    }, { passive: false });
    const touchEnd = (e) => {
      if (!_rpSeeking) return;
      commit();
      e.stopPropagation();
    };
    track.addEventListener('touchend', touchEnd);
    track.addEventListener('touchcancel', touchEnd);
  }
}

function _startPlayerLoop() {
  if (_rpRAF) cancelAnimationFrame(_rpRAF);
  _rpRAF = requestAnimationFrame(_radioPlayerTick);
}

function _renderRadioOverlay() {
  const toggleBtn = document.getElementById('radio-master-toggle');
  if (!toggleBtn) return;

  // Shuffle pill switch state. On the title screen we just flip the bit —
  // mid-run the pause-screen pill calls enable/disableRadioInGame instead.
  toggleBtn.setAttribute('aria-checked', isRadioOn() ? 'true' : 'false');
  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    const next = !isRadioOn();
    setRadioOn(next);
    toggleBtn.setAttribute('aria-checked', next ? 'true' : 'false');
    if (!next) _stopRadioPreview();
  };

  _wirePlayerTransport('rp');

  // Refresh icon state on existing <audio> events (once per element).
  if (radioMusic && !radioMusic._rpHooked) {
    radioMusic._rpHooked = true;
    radioMusic.addEventListener('play', _updatePlayIcon);
    radioMusic.addEventListener('pause', _updatePlayIcon);
  }

  // Close button (idempotent).
  const closeBtn = document.getElementById('radio-close');
  if (closeBtn && !closeBtn._wired) {
    closeBtn._wired = true;
    closeBtn.addEventListener('click', () => closeRadio());
  }

  _updatePlayerMeta();
  _updatePlayIcon();
  _startPlayerLoop();
}

// Stop the rAF loop when overlay closes.
function _stopRadioPlayerLoop() {
  if (_rpRAF) { cancelAnimationFrame(_rpRAF); _rpRAF = 0; }
}

// ── UI: pause-menu music player ─────────────────────────────────────────
// Show the player whenever radio is unlocked. The pill switch is the
// gate that decides whether radio actually plays during the run — if
// it's OFF the rest of the UI is just a preview surface.
function updatePauseRadioRow() {
  const row = document.getElementById('pause-radio-row');
  if (!row) return;
  const visible = (typeof isRadioUnlocked === 'function') ? isRadioUnlocked() : false;
  if (visible) {
    row.classList.remove('hidden');
    _wirePlayerTransport('pp');
    _wirePauseShuffleSwitch();
    if (radioMusic && !radioMusic._rpHooked) {
      radioMusic._rpHooked = true;
      radioMusic.addEventListener('play', _updatePlayIcon);
      radioMusic.addEventListener('pause', _updatePlayIcon);
    }
    _updatePlayerMeta();
    _updatePlayIcon();
    _refreshShuffleSwitches();
    _startPlayerLoop();
  } else {
    row.classList.add('hidden');
    const ov = document.getElementById('radio-overlay');
    if (!ov || ov.classList.contains('hidden')) _stopRadioPlayerLoop();
  }
}
window.updatePauseRadioRow = updatePauseRadioRow;

function _wirePauseShuffleSwitch() {
  const sw = document.getElementById('pp-shuffle-toggle');
  if (!sw || sw._wired) return;
  sw._wired = true;
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isRadioOn()) disableRadioInGame();
    else             enableRadioInGame();
  });
}

// Refresh the title button on load (in case it was already unlocked).
// Defensive: fire on multiple lifecycle hooks because the single-shot
// DOMContentLoaded path was racing on iOS — sometimes radio-btn was
// still hidden until the player ran a round and returned to title.
(function refreshOnLoad() {
  function _go() { try { refreshRadioButton(); } catch(_) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _go);
  else _go();
  // Also retry on next rAF (after layout) and on window load (after assets).
  try { requestAnimationFrame(_go); } catch(_) {}
  try { window.addEventListener('load', _go, { once: true }); } catch(_) {}
})();
