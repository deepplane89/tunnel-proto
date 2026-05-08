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
};
const RADIO_UNLOCK_AT = 3;  // unlock on/after death of run #3

let _radioShuffleQueue = [];   // upcoming track indexes
let _radioCurrentIdx   = -1;   // currently playing index into RADIO_TRACKS
let _radioPlayHistory  = [];   // recent indexes for prev (most recent at end)
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
function tryUnlockRadioOnDeath() {
  if (isRadioUnlocked()) return false;
  if (getRadioRunCount() < RADIO_UNLOCK_AT) return false;
  setRadioUnlocked(true);
  // Default to ON the first time it unlocks so the player notices it next run.
  try { localStorage.setItem(RADIO_LS.on, '1'); } catch(_) {}
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
  // Track history for prev button (cap at 16 to avoid runaway memory).
  _radioPlayHistory.push(idx);
  if (_radioPlayHistory.length > 16) _radioPlayHistory.shift();
  // Switching src on the same element is the cheapest way to swap; iOS handles
  // it cleanly as long as we play() from a user-gesture-tied codepath (we are).
  if (radioMusic.src.indexOf(tr.src) === -1) {
    radioMusic.src = tr.src;
  }
  try { radioMusic.currentTime = 0; } catch(_) {}
  // Volume is gated by the gain node ('radio' track) — don't fight it here.
  radioMusic.play().catch(() => {});
  // Notify pause-menu + title-HUD UI to refresh "now playing" / glyph state.
  try { if (typeof updatePauseRadioRow === 'function') updatePauseRadioRow(); } catch(_) {}
  try { if (typeof updateTitleRadioToggle === 'function') updateTitleRadioToggle(); } catch(_) {}
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

function prevRadioTrack() {
  if (!isRadioOn()) return;
  // Pop the previous track from history (current was pushed by _playRadioIdx).
  // history layout: [..., previous, current]
  if (_radioPlayHistory.length < 2) return;
  _radioPlayHistory.pop();              // drop current
  const prev = _radioPlayHistory.pop(); // take previous (will be re-pushed by _playRadioIdx)
  if (typeof prev === 'number') _playRadioIdx(prev);
}
window.prevRadioTrack = prevRadioTrack;

function toggleRadioPause() {
  if (!isRadioOn()) return;
  if (!radioMusic) radioMusic = document.getElementById('radio-music');
  if (!radioMusic) return;
  try {
    if (radioMusic.paused) {
      if (_radioCurrentIdx < 0) _playRadioIdx(_nextRadioIdx());
      else radioMusic.play().catch(() => {});
    } else {
      radioMusic.pause();
    }
  } catch(_) {}
  try { if (typeof updatePauseRadioRow === 'function') updatePauseRadioRow(); } catch(_) {}
}
window.toggleRadioPause = toggleRadioPause;

function currentRadioTrackName() {
  const tr = RADIO_TRACKS[_radioCurrentIdx];
  return tr ? tr.name : '';
}
window.currentRadioTrackName = currentRadioTrackName;

// ── musicFadeTo divert helper ────────────────────────────────────────────
// Called from musicFadeTo() (in 20-main-early.js) when radio is ON and the
// requested track is a gameplay zone. Returns true if it took over the fade.
const _RADIO_GAMEPLAY_TRACKS = { bg: 1, l3: 1, l4: 1, lake: 1, keepgoing: 1 };
function radioInterceptMusicFade(toTrack, durationMs) {
  if (!isRadioOn()) return false;
  if (!_RADIO_GAMEPLAY_TRACKS[toTrack]) return false;
  try {
    const all = (typeof allTracks === 'function') ? allTracks() : {};
    const durSec = (durationMs || 1500) / 1000;
    Object.entries(all).forEach(([k, el]) => {
      if (!el) return;
      if (k === 'title' || k === 'radio') return;
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

// ── UI: title-screen RADIO button visibility ────────────────────────────
function refreshRadioButton() {
  const wrap = document.getElementById('title-radio-controls');
  if (!wrap) return;
  if (isRadioUnlocked()) wrap.classList.remove('hidden');
  else                   wrap.classList.add('hidden');
  // Sync the play/pause glyph with current state.
  try { if (typeof updateTitleRadioToggle === 'function') updateTitleRadioToggle(); } catch(_) {}
}
window.refreshRadioButton = refreshRadioButton;

function updateTitleRadioToggle() {
  const btn = document.getElementById('title-radio-toggle');
  if (!btn) return;
  const playing = !!(radioMusic && !radioMusic.paused && isRadioOn());
  btn.textContent = playing ? '\u23F8' : '\u25B6';
  btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}
window.updateTitleRadioToggle = updateTitleRadioToggle;

// Title-screen play: if radio is off, turn it on; fade title music down so
// radio takes over. Mirrors the gameplay radioInterceptMusicFade override
// but for the title track specifically.
function titleRadioPlay() {
  if (typeof initAudio === 'function') initAudio();
  if (!isRadioOn()) setRadioOn(true);
  // Duck/pause title music so radio is what you hear.
  try {
    if (typeof titleMusic !== 'undefined' && titleMusic && !titleMusic.paused) {
      if (typeof rampTrackVol === 'function') rampTrackVol('title', 0, 0.25);
      setTimeout(() => { try { if (titleMusic && !titleMusic.paused) titleMusic.pause(); } catch(_){} }, 280);
    }
  } catch(_) {}
  if (!radioMusic) radioMusic = document.getElementById('radio-music');
  if (!radioMusic) return;
  if (radioMusic.paused) {
    if (_radioCurrentIdx < 0) _playRadioIdx(_nextRadioIdx());
    else { try { radioMusic.play().catch(()=>{}); } catch(_){} }
  }
  try { if (typeof setTrackVol === 'function') setTrackVol('radio', TRACK_VOL.radio); } catch(_){}
  updateTitleRadioToggle();
}
window.titleRadioPlay = titleRadioPlay;

// Title-screen pause: pause radio + bring title music back.
function titleRadioPause() {
  if (radioMusic && !radioMusic.paused) { try { radioMusic.pause(); } catch(_){} }
  // Restore title music if we're on the title screen.
  try {
    if (typeof titleMusic !== 'undefined' && titleMusic && typeof state !== 'undefined' &&
        (state.phase === 'title' || state.phase === 'dead')) {
      if (typeof setTrackVol === 'function') setTrackVol('title', 0);
      titleMusic.play().catch(()=>{});
      if (typeof rampTrackVol === 'function' && typeof TRACK_VOL !== 'undefined') {
        rampTrackVol('title', TRACK_VOL.title, 0.4);
      }
    }
  } catch(_) {}
  updateTitleRadioToggle();
}
window.titleRadioPause = titleRadioPause;

function titleRadioToggle() {
  const playing = !!(radioMusic && !radioMusic.paused && isRadioOn());
  if (playing) titleRadioPause();
  else         titleRadioPlay();
}
window.titleRadioToggle = titleRadioToggle;

// ── UI: radio overlay (title-screen only) ──────────────────────────────
let _radioPreviewIdx = -1;   // currently-previewing track in the overlay
function openRadio() {
  if (!isRadioUnlocked()) return;
  try { if (typeof initAudio === 'function') initAudio(); } catch(_) {}
  try { if (typeof playTitleTap === 'function') playTitleTap(); } catch(_) {}
  const ov = document.getElementById('radio-overlay');
  if (!ov) return;
  ov.classList.remove('hidden');
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
  const row    = document.getElementById('pause-radio-row');
  const name   = document.getElementById('pause-radio-name');
  const toggle = document.getElementById('pause-radio-toggle');
  if (!row || !name) return;
  if (isRadioOn() && _radioCurrentIdx >= 0) {
    row.classList.remove('hidden');
    name.textContent = currentRadioTrackName();
    if (toggle) {
      const paused = !!(radioMusic && radioMusic.paused);
      toggle.textContent = paused ? '▶' : '⏸';
      toggle.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    }
  } else {
    row.classList.add('hidden');
  }
}
window.updatePauseRadioRow = updatePauseRadioRow;

// Wire pause-menu + title-HUD radio buttons once DOM is parsed.
(function wireRadioControls() {
  function _wire() {
    // Pause-menu controls.
    const prevBtn   = document.getElementById('pause-radio-prev');
    const toggleBtn = document.getElementById('pause-radio-toggle');
    const skipBtn   = document.getElementById('pause-radio-skip');
    if (prevBtn && !prevBtn._wired) {
      prevBtn._wired = true;
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof prevRadioTrack === 'function') prevRadioTrack();
        updatePauseRadioRow();
      });
    }
    if (toggleBtn && !toggleBtn._wired) {
      toggleBtn._wired = true;
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof toggleRadioPause === 'function') toggleRadioPause();
        updatePauseRadioRow();
      });
    }
    if (skipBtn && !skipBtn._wired) {
      skipBtn._wired = true;
      skipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof skipRadioTrack === 'function') skipRadioTrack();
        updatePauseRadioRow();
      });
    }
    // Title-HUD controls (only present after radio unlock).
    const tPrev   = document.getElementById('title-radio-prev');
    const tToggle = document.getElementById('title-radio-toggle');
    const tSkip   = document.getElementById('title-radio-skip');
    // Title controls double as title-screen taps so they should play the
    // standard title click sound.
    function _titleClick() {
      try { if (typeof playTitleTap === 'function') playTitleTap(); } catch(_) {}
    }
    if (tPrev && !tPrev._wired) {
      tPrev._wired = true;
      tPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        _titleClick();
        // If radio isn't on yet, prev = start playing the latest queued track.
        if (!isRadioOn() || (radioMusic && radioMusic.paused)) {
          if (typeof titleRadioPlay === 'function') titleRadioPlay();
        } else if (typeof prevRadioTrack === 'function') {
          prevRadioTrack();
        }
        updateTitleRadioToggle();
      });
    }
    if (tToggle && !tToggle._wired) {
      tToggle._wired = true;
      tToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        _titleClick();
        if (typeof titleRadioToggle === 'function') titleRadioToggle();
      });
    }
    if (tSkip && !tSkip._wired) {
      tSkip._wired = true;
      tSkip.addEventListener('click', (e) => {
        e.stopPropagation();
        _titleClick();
        if (!isRadioOn() || (radioMusic && radioMusic.paused)) {
          if (typeof titleRadioPlay === 'function') titleRadioPlay();
        } else if (typeof skipRadioTrack === 'function') {
          skipRadioTrack();
        }
        updateTitleRadioToggle();
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire);
  } else {
    _wire();
  }
})();

// Refresh the title button on load (in case it was already unlocked).
(function refreshOnLoad() {
  function _go() { try { refreshRadioButton(); } catch(_) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _go);
  else _go();
})();
