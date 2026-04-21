// ═══════════════════════════════════════════════════════
//  SETTINGS SYSTEM
// ═══════════════════════════════════════════════════════
const SETTINGS_KEY = 'jh_settings';
let _settings = {
  musicVol: 80,     // 0-100
  sfxVol: 80,       // 0-100
  musicMuted: false,
  sfxMuted: false,
  hapticsOn: true,
};

function loadSettings() {
  try {
    const raw = window._LS.getItem(SETTINGS_KEY);
    if (raw) Object.assign(_settings, JSON.parse(raw));
  } catch(e) {}
}
function saveSettings() {
  window._LS.setItem(SETTINGS_KEY, JSON.stringify(_settings));
}
loadSettings();

// Derived volume multipliers (0-1)
function musicMult() { return _settings.musicMuted ? 0 : _settings.musicVol / 100; }
function sfxMult()   { return _settings.sfxMuted   ? 0 : _settings.sfxVol   / 100; }

// Apply music volume to all active tracks
function applyMusicVolume() {
  const m = musicMult();
  state.muted = m === 0 && sfxMult() === 0;
  Object.entries(TRACK_VOL).forEach(([k, base]) => {
    setTrackVol(k, base * m);
  });
}

// Open / close settings
function openSettings() {
  playTitleTap();
  const ov = document.getElementById('settings-overlay');
  if (!ov) return;
  // Sync sliders/buttons to current state
  document.getElementById('vol-music').value = _settings.musicVol;
  document.getElementById('vol-sfx').value = _settings.sfxVol;
  document.getElementById('mute-music').classList.toggle('muted', _settings.musicMuted);
  document.getElementById('mute-music').textContent = _settings.musicMuted ? '🔇' : '♪';
  document.getElementById('mute-sfx').classList.toggle('muted', _settings.sfxMuted);
  document.getElementById('mute-sfx').textContent = _settings.sfxMuted ? '🔇' : '♪';
  const hBtn = document.getElementById('haptic-toggle');
  hBtn.textContent = _settings.hapticsOn ? 'ON' : 'OFF';
  hBtn.classList.toggle('off', !_settings.hapticsOn);

  ov.classList.remove('hidden');
}
function closeSettings() {
  playTitleTap();
  document.getElementById('settings-overlay').classList.add('hidden');
}

// Wire up settings UI
(function initSettings() {
  const gearBtn = document.getElementById('settings-btn');
  if (gearBtn) gearBtn.addEventListener('click', () => { initAudio(); openSettings(); });

  const pauseSettingsBtn = document.getElementById('pause-settings-btn');
  if (pauseSettingsBtn) pauseSettingsBtn.addEventListener('click', () => { openSettings(); });

  document.getElementById('settings-close').addEventListener('click', closeSettings);

  // Replay tutorial button
  document.getElementById('replay-tutorial-btn').addEventListener('click', () => {
    window._LS.removeItem('jh_tutorial_done');
    closeSettings();
    // Apply JL_v1 physics as tutorial baseline
    const _tp = _PHYSICS_PRESETS['JL_v1'];
    _accelBase     = _tp.accelBase;
    _accelSnap     = _tp.accelSnap;
    _maxVelBase    = _tp.maxVelBase;
    _maxVelSnap    = _tp.maxVelSnap;
    _bankMax       = _tp.bankMax;
    _bankSmoothing = _tp.bankSmoothing;
    _decelBasePct  = _tp.decelBasePct;
    _decelFullPct  = _tp.decelFullPct;
    state._tutorialActive = true;  // must be set BEFORE startGame() so prologue is suppressed
    state._tutorialStep = -0.5;
    startGame();
    state._tutRocksSpawned = false;
    state._tutRocksPassed = 0;
  });

  // Jet Lightning mode button
  document.getElementById('jet-lightning-btn').addEventListener('click', () => {
    playStartSound();
    state._jetLightningMode = true;
    startJetLightning();
  });

  // ?canyon=1 — auto-fire JL button on first tap/click so mobile audio context unlocks
  if (_canyonTestMode) {
    const _canyonAutoStart = () => {
      document.removeEventListener('click',      _canyonAutoStart);
      document.removeEventListener('touchstart', _canyonAutoStart);
      document.getElementById('jet-lightning-btn').click();
    };
    document.addEventListener('click',      _canyonAutoStart, { once: true });
    document.addEventListener('touchstart', _canyonAutoStart, { once: true });
  }

  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'settings-overlay') closeSettings();
  });

  // Music volume slider
  document.getElementById('vol-music').addEventListener('input', (e) => {
    _settings.musicVol = parseInt(e.target.value);
    _settings.musicMuted = false;
    document.getElementById('mute-music').classList.remove('muted');
    document.getElementById('mute-music').textContent = '♪';
    applyMusicVolume();
    saveSettings();
  });

  // SFX volume slider
  document.getElementById('vol-sfx').addEventListener('input', (e) => {
    _settings.sfxVol = parseInt(e.target.value);
    _settings.sfxMuted = false;
    document.getElementById('mute-sfx').classList.remove('muted');
    document.getElementById('mute-sfx').textContent = '♪';
    saveSettings();
  });

  // Music mute toggle
  document.getElementById('mute-music').addEventListener('click', () => {
    _settings.musicMuted = !_settings.musicMuted;
    document.getElementById('mute-music').classList.toggle('muted', _settings.musicMuted);
    document.getElementById('mute-music').textContent = _settings.musicMuted ? '🔇' : '♪';
    applyMusicVolume();
    saveSettings();
  });

  // SFX mute toggle
  document.getElementById('mute-sfx').addEventListener('click', () => {
    _settings.sfxMuted = !_settings.sfxMuted;
    document.getElementById('mute-sfx').classList.toggle('muted', _settings.sfxMuted);
    document.getElementById('mute-sfx').textContent = _settings.sfxMuted ? '🔇' : '♪';
    saveSettings();
  });

  // Haptics toggle
  document.getElementById('haptic-toggle').addEventListener('click', () => {
    _settings.hapticsOn = !_settings.hapticsOn;
    const btn = document.getElementById('haptic-toggle');
    btn.textContent = _settings.hapticsOn ? 'ON' : 'OFF';
    btn.classList.toggle('off', !_settings.hapticsOn);
    if (_settings.hapticsOn) hapticTap();  // demo buzz
    saveSettings();
  });

  // "How to Play" button in settings
  document.getElementById('show-tutorial-btn').addEventListener('click', () => {
    closeSettings();
    const ov = document.getElementById('onboarding-overlay');
    if (ov) {
      ov.classList.remove('hidden');
      document.getElementById('onboarding-dismiss').addEventListener('click', () => {
        ov.classList.add('hidden');
      }, { once: true });
    }
  });

})();

