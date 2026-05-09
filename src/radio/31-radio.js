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
  { id: 'keep-going',        name: 'KEEP GOING',            src: './assets/audio/keep-going.mp3' },
  { id: 'synesthetic-gears', name: 'SYNESTHETIC GEARS',     src: './assets/audio/radio-gears-1.mp3' },
  { id: 'synthetic-gears-2', name: 'SYNTHETIC GEARS II',    src: './assets/audio/radio-gears-2.mp3' },
  { id: 'funk-of-the-night', name: 'FUNK OF THE NIGHT',     src: './assets/audio/radio-funk.mp3' },
  { id: 'orbital-ordinance', name: 'ORBITAL ORDINANCE',     src: './assets/audio/radio-orbital.mp3' },
  { id: 'neon-mountain',     name: 'NEON MOUNTAIN',         src: './assets/audio/radio-neon-mtn.mp3' },
];
window.RADIO_TRACKS = RADIO_TRACKS;

const RADIO_LS = {
  unlocked:  'jh_radio_unlocked',
  on:        'jh_radio_on',
  runCount:  'jh_radio_run_count',
  seen:      'jh_radio_seen',     // cleared on first unlock; set when overlay opened
};
const RADIO_UNLOCK_AT = 3;  // unlock on/after death of run #3

let _radioShuffleQueue = [];   // upcoming track indexes
let _radioCurrentIdx   = -1;   // currently playing index into RADIO_TRACKS
let _radioEndedHooked  = false;

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
  const idx = (_radioCurrentIdx >= 0) ? _radioCurrentIdx : _nextRadioIdx();
  _playRadioIdx(idx);
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
// Called from musicFadeTo() (in 20-main-early.js) when radio is ON and the
// requested track is a gameplay zone. Returns true if it took over the fade.
// Fades EVERYTHING but radio down — including title — so hitting play from
// the title screen actually silences title music as radio takes over.
const _RADIO_GAMEPLAY_TRACKS = { bg: 1, l3: 1, l4: 1, lake: 1, keepgoing: 1 };
function radioInterceptMusicFade(toTrack, durationMs) {
  if (!isRadioOn()) return false;
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
  _stopRadioPreview();
}
window.closeRadio = closeRadio;

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
  // Refresh play buttons in list.
  const list = document.getElementById('radio-track-list');
  if (list) list.querySelectorAll('.radio-row-play').forEach(b => b.textContent = '\u25B6');
}

function _previewRadioTrack(idx) {
  if (typeof initAudio === 'function') initAudio();
  if (!radioMusic) radioMusic = document.getElementById('radio-music');
  if (!radioMusic) return;
  // If tapping the row that's already previewing, stop.
  if (_radioPreviewIdx === idx) { _stopRadioPreview(); return; }
  // Stop previous preview.
  _stopRadioPreview();
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
  // Update play button glyph.
  const list = document.getElementById('radio-track-list');
  if (list) {
    list.querySelectorAll('.radio-row-play').forEach(b => b.textContent = '\u25B6');
    const btn = list.querySelector('.radio-row[data-idx="' + idx + '"] .radio-row-play');
    if (btn) btn.textContent = '\u25A0';
  }
}

function _renderRadioOverlay() {
  const list = document.getElementById('radio-track-list');
  const toggleBtn = document.getElementById('radio-master-toggle');
  if (!list || !toggleBtn) return;
  toggleBtn.textContent = isRadioOn() ? 'ON' : 'OFF';
  toggleBtn.classList.toggle('on', isRadioOn());
  list.innerHTML = RADIO_TRACKS.map((t, i) =>
    '<div class="radio-row" data-idx="' + i + '">' +
      '<button class="radio-row-play" aria-label="Preview">\u25B6</button>' +
      '<span class="radio-row-name">' + t.name + '</span>' +
    '</div>'
  ).join('');
  // Wire rows.
  list.querySelectorAll('.radio-row-play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('.radio-row');
      const idx = parseInt(row.getAttribute('data-idx'), 10);
      _previewRadioTrack(idx);
    });
  });
  // Wire master toggle.
  toggleBtn.onclick = () => {
    const next = !isRadioOn();
    setRadioOn(next);
    toggleBtn.textContent = next ? 'ON' : 'OFF';
    toggleBtn.classList.toggle('on', next);
    if (!next) _stopRadioPreview();
  };
  // Wire close button (idempotent).
  const closeBtn = document.getElementById('radio-close');
  if (closeBtn && !closeBtn._wired) {
    closeBtn._wired = true;
    closeBtn.addEventListener('click', () => closeRadio());
  }
}

// ── UI: pause-menu now-playing row ──────────────────────────────────────
function updatePauseRadioRow() {
  const row  = document.getElementById('pause-radio-row');
  const name = document.getElementById('pause-radio-name');
  if (!row || !name) return;
  if (isRadioOn() && _radioCurrentIdx >= 0) {
    row.classList.remove('hidden');
    name.textContent = currentRadioTrackName();
  } else {
    row.classList.add('hidden');
  }
}
window.updatePauseRadioRow = updatePauseRadioRow;

// Wire pause skip button once DOM is parsed.
(function wirePauseRadioSkip() {
  function _wire() {
    const skipBtn = document.getElementById('pause-radio-skip');
    if (!skipBtn || skipBtn._wired) return;
    skipBtn._wired = true;
    skipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof skipRadioTrack === 'function') skipRadioTrack();
      updatePauseRadioRow();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire);
  } else {
    _wire();
  }
})();

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
