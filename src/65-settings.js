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
  // Graphics quality → DPR clamp. 'balanced' is mobile default.
  // 'performance' = 1.0, 'balanced' = 1.5, 'sharp' = min(devicePixelRatio, 3)
  graphicsQuality: 'balanced',
};

// Returns the DPR cap for the current graphics quality setting.
// Used by renderer.setPixelRatio() and the starfield shader uPixelRatio uniform.
function _targetDPR() {
  const native = window.devicePixelRatio || 1;
  switch (_settings.graphicsQuality) {
    case 'performance': return 1.0;
    case 'sharp':       return Math.min(native, 3);
    case 'balanced':
    default:            return Math.min(native, 1.5);
  }
}
window._targetDPR = _targetDPR;

// Apply current graphics quality → update renderer DPR + shader uniforms.
// Safe to call before renderer/composer exist (guarded).
function applyGraphicsQuality() {
  const dpr = _targetDPR();
  try {
    if (typeof renderer !== 'undefined' && renderer && !perfMode) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(window.innerWidth, window.innerHeight);
      if (typeof composer !== 'undefined' && composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
      }
    }
    // Sync starfield shader pixel-ratio uniform (line 4419 in 20-main-early.js)
    if (window._starMat && window._starMat.uniforms && window._starMat.uniforms.uPixelRatio) {
      window._starMat.uniforms.uPixelRatio.value = dpr;
    }
  } catch(e) {}
}
window.applyGraphicsQuality = applyGraphicsQuality;

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
  // Sync graphics quality button states
  ['performance','balanced','sharp'].forEach(q => {
    const b = document.getElementById('gfx-' + q);
    if (b) b.classList.toggle('active', _settings.graphicsQuality === q);
  });

  ov.classList.remove('hidden');
}
function closeSettings() {
  playTitleTap();
  document.getElementById('settings-overlay').classList.add('hidden');
}

// Wire up settings UI
(function initSettings() {
  const gearBtn = document.getElementById('settings-btn');
  if (gearBtn) _tapBind(gearBtn, () => { initAudio(); openSettings(); });

  const pauseSettingsBtn = document.getElementById('pause-settings-btn');
  if (pauseSettingsBtn) _tapBind(pauseSettingsBtn, () => { openSettings(); });

  _tapBind(document.getElementById('settings-close'), closeSettings);

  // Leaderboard button — closes settings, then opens leaderboard.
  const lbBtn = document.getElementById('settings-leaderboard-btn');
  if (lbBtn) _tapBind(lbBtn, () => {
    closeSettings();
    if (typeof toggleLeaderboard === 'function') toggleLeaderboard();
  });

  // Replay tutorial button
  _tapBind(document.getElementById('replay-tutorial-btn'), () => {
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
  _tapBind(document.getElementById('jet-lightning-btn'), () => {
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
  _tapBind(document.getElementById('mute-music'), () => {
    _settings.musicMuted = !_settings.musicMuted;
    document.getElementById('mute-music').classList.toggle('muted', _settings.musicMuted);
    document.getElementById('mute-music').textContent = _settings.musicMuted ? '🔇' : '♪';
    applyMusicVolume();
    saveSettings();
  });

  // SFX mute toggle
  _tapBind(document.getElementById('mute-sfx'), () => {
    _settings.sfxMuted = !_settings.sfxMuted;
    document.getElementById('mute-sfx').classList.toggle('muted', _settings.sfxMuted);
    document.getElementById('mute-sfx').textContent = _settings.sfxMuted ? '🔇' : '♪';
    saveSettings();
  });

  // Graphics quality 3-way toggle (Performance / Balanced / Sharp)
  ['performance','balanced','sharp'].forEach(q => {
    const b = document.getElementById('gfx-' + q);
    if (!b) return;
    _tapBind(b, () => {
      _settings.graphicsQuality = q;
      ['performance','balanced','sharp'].forEach(qq => {
        const bb = document.getElementById('gfx-' + qq);
        if (bb) bb.classList.toggle('active', qq === q);
      });
      applyGraphicsQuality();
      saveSettings();
    });
  });

  // Haptics toggle
  _tapBind(document.getElementById('haptic-toggle'), () => {
    _settings.hapticsOn = !_settings.hapticsOn;
    const btn = document.getElementById('haptic-toggle');
    btn.textContent = _settings.hapticsOn ? 'ON' : 'OFF';
    btn.classList.toggle('off', !_settings.hapticsOn);
    if (_settings.hapticsOn) hapticTap();  // demo buzz
    saveSettings();
  });

  // "How to Play" button in settings
  _tapBind(document.getElementById('show-tutorial-btn'), () => {
    closeSettings();
    const ov = document.getElementById('onboarding-overlay');
    if (ov) {
      ov.classList.remove('hidden');
      _tapBind(document.getElementById('onboarding-dismiss'), () => {
        ov.classList.add('hidden');
      }, { once: true });
    }
  });

})();

