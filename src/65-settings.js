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
  // Graphics quality → DPR clamp. Defaults to 'sharp'; first-time-ever load
  // shows a picker (see _showGfxPicker below) so the player can choose.
  // 'performance' = 1.0, 'balanced' = 1.5, 'sharp' = min(devicePixelRatio, 2)
  // SHARP capped at 2 (not 3) because higher DPR causes additive-blend points
  // (stars, thruster particles) to oversaturate via bloom — 1.5→3 is 4x the
  // framebuffer pixels and the visible glow grows beyond what looks crisp.
  graphicsQuality: 'sharp',
  // Battery saver options — both default OFF so existing players see no change.
  fpsCap30: false,     // cap framerate at 30fps to cut sustained GPU power ~50%
  liteBloom: false,    // drop bloom resolution /2 → /3 + 1 fewer mip level
};
window.getSetting = function(k) { return _settings[k]; };

// Returns the DPR cap for the current graphics quality setting.
// Used by renderer.setPixelRatio() and the starfield shader uPixelRatio uniform.
function _baseTargetDPR() {
  const native = window.devicePixelRatio || 1;
  switch (_settings.graphicsQuality) {
    case 'performance': return 1.0;
    case 'sharp':       return Math.min(native, 2);
    case 'balanced':
    default:            return Math.min(native, 1.5);
  }
}

// Adaptive DPR scale (0.5–1.0). When the rAF frame loop detects sustained
// slow frames (thermal throttling on iOS, or just a struggling device), it
// drops this scale in 0.85x steps so the renderer paints fewer pixels. The
// floor of 0.5 means we won't go below half the chosen quality. Recovers
// slowly when frames stabilize.
let _adaptiveDPRScale = 1.0;
window._setAdaptiveDPRScale = function(s) {
  s = Math.max(0.5, Math.min(1.0, s));
  if (Math.abs(s - _adaptiveDPRScale) < 0.001) return;
  _adaptiveDPRScale = s;
  applyGraphicsQuality();
};
window._getAdaptiveDPRScale = function() { return _adaptiveDPRScale; };

function _targetDPR() {
  return _baseTargetDPR() * _adaptiveDPRScale;
}
window._targetDPR = _targetDPR;
window._baseTargetDPR = _baseTargetDPR;

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
// When the shuffle station is on, duck every gameplay SFX/VFX through the
// global sfxMult() so the music stays foreground and the player can groove.
// 0.60 = -4.4 dB — noticeably quieter without going inaudible. The lateral
// whoosh has its own _lateralDuck on top of this.
const _SFX_RADIO_DUCK = 0.60;
function _sfxRadioDuck() {
  try { return (typeof isRadioOn === 'function' && isRadioOn()) ? _SFX_RADIO_DUCK : 1; } catch(_) { return 1; }
}
function sfxMult()   { return (_settings.sfxMuted ? 0 : _settings.sfxVol / 100) * _sfxRadioDuck(); }
// True when the SFX mute button is engaged (or sfx slider at 0). Use this
// to gate SFX `.play()` calls — NOT `state.muted`, which only flips on when
// BOTH music AND sfx are muted (so it silently lets SFX through when only
// SFX is muted).
function isSfxMuted() { return _settings.sfxMuted || _settings.sfxVol <= 0; }
window.isSfxMuted = isSfxMuted;

// Apply music volume to all active tracks. setTrackVol applies musicMult()
// itself, so pass the raw TRACK_VOL base — don't double-multiply.
function applyMusicVolume() {
  state.muted = musicMult() === 0 && sfxMult() === 0;
  Object.entries(TRACK_VOL).forEach(([k, base]) => {
    setTrackVol(k, base);
  });
}

// Apply SFX mute live: pause every tracked gameplay <audio> SFX element so
// looped SFX (engine, laser, unibeam, invincible, etc.) stop immediately
// when the user mutes mid-run. Buffer-played SFX already gate on sfxMult()
// inside _playBuffer, so they need no per-element handling.
function applySfxMute() {
  state.muted = musicMult() === 0 && sfxMult() === 0;
  if (!_settings.sfxMuted) return;
  if (typeof window.stopAllGameplaySFX === 'function') {
    // Re-use the death kill-switch — same behavior: cancel scheduled SFX,
    // ramp+stop Web Audio sources, pause every tracked gameplay <audio>.
    window.stopAllGameplaySFX();
  }
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
  document.getElementById('mute-music').textContent = _settings.musicMuted ? '🔇' : '🔊';
  document.getElementById('mute-sfx').classList.toggle('muted', _settings.sfxMuted);
  document.getElementById('mute-sfx').textContent = _settings.sfxMuted ? '🔇' : '🔊';
  const hBtn = document.getElementById('haptic-toggle');
  hBtn.textContent = _settings.hapticsOn ? 'ON' : 'OFF';
  hBtn.classList.toggle('off', !_settings.hapticsOn);
  const fpsBtn = document.getElementById('fpscap-toggle');
  if (fpsBtn) { fpsBtn.textContent = _settings.fpsCap30 ? 'ON' : 'OFF'; fpsBtn.classList.toggle('off', !_settings.fpsCap30); }
  const lbBtn2 = document.getElementById('litebloom-toggle');
  if (lbBtn2) { lbBtn2.textContent = _settings.liteBloom ? 'ON' : 'OFF'; lbBtn2.classList.toggle('off', !_settings.liteBloom); }
  // Sync graphics quality button states
  ['performance','balanced','sharp'].forEach(q => {
    const b = document.getElementById('gfx-' + q);
    if (b) b.classList.toggle('active', _settings.graphicsQuality === q);
  });
  // Gate entire DISPLAY section to title screen only — graphics + lite bloom
  // both require scene reload to apply safely. Haptics/FPS cap go here too
  // for one-rule simplicity; user explicitly asked to remove DISPLAY in pause.
  const _dispSec = document.getElementById('display-section');
  if (_dispSec) {
    // `state` is module-const, NOT on window — earlier gate used window.state
    // which is always undefined, so the row stayed visible. Use bare ref.
    const _onTitle = (typeof state === 'undefined') || state.phase === 'title';
    _dispSec.style.display = _onTitle ? '' : 'none';
  }

  ov.classList.remove('hidden');
}
function closeSettings() {
  playTitleClose();
  document.getElementById('settings-overlay').classList.add('hidden');
}

// Single-open accordion: when one <details> opens, close the others.
// Wired here once at module init; <details> elements fire 'toggle' on change.
function _initSettingsAccordion() {
  const sections = document.querySelectorAll('#settings-overlay .settings-section');
  sections.forEach(s => {
    s.addEventListener('toggle', () => {
      if (s.open) {
        sections.forEach(other => { if (other !== s) other.open = false; });
      }
    });
  });
}

// Wire up settings UI
(function initSettings() {
  _initSettingsAccordion();
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

  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'settings-overlay') closeSettings();
  });

  // ── SYNC PROGRESS (cross-device save codes) ─────────────────────────
  // Backend: /api/save (POST → upload, returns {code}; GET ?code=... → keys).
  // On Capacitor (iOS native, file://) relative /api/... won't resolve, so we
  // fall back to the production Vercel URL. Web build uses the same origin.
  const SYNC_API_BASE = (function() {
    try {
      const proto = window.location && window.location.protocol;
      if (proto === 'http:' || proto === 'https:') return '/api/save';
    } catch (_) {}
    return 'https://tunnel-proto.vercel.app/api/save';
  })();
  // Keys that count as "player progress" — backed up on GET CODE.
  function _collectSyncKeys() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith('jh_') || k.startsWith('jet-horizon') || k.startsWith('jetslide')) {
          out[k] = localStorage.getItem(k);
        }
      }
    } catch(_) {}
    return out;
  }
  function _setSyncStatus(msg, kind) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.remove('ok', 'err', 'busy');
    if (kind) el.classList.add(kind);
  }
  const getCodeBtn = document.getElementById('sync-get-code-btn');
  if (getCodeBtn) {
    _tapBind(getCodeBtn, async () => {
      _setSyncStatus('Uploading save…', 'busy');
      getCodeBtn.disabled = true;
      try {
        const keys = _collectSyncKeys();
        if (Object.keys(keys).length === 0) {
          _setSyncStatus('Nothing to back up yet.', 'err');
          return;
        }
        const r = await fetch(SYNC_API_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.code) {
          _setSyncStatus(data.error || 'Upload failed.', 'err');
          return;
        }
        const row     = document.getElementById('sync-code-row');
        const display = document.getElementById('sync-code-display');
        if (row && display) {
          display.textContent = data.code;
          row.style.display = '';
        }
        _setSyncStatus('Saved. Use this code on another device to restore.', 'ok');
      } catch (e) {
        _setSyncStatus('Network error — check connection.', 'err');
      } finally {
        getCodeBtn.disabled = false;
      }
    });
  }
  const copyBtn = document.getElementById('sync-copy-btn');
  if (copyBtn) {
    _tapBind(copyBtn, async () => {
      const display = document.getElementById('sync-code-display');
      const code = display && display.textContent;
      if (!code || code === '—') return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(code);
        } else {
          const ta = document.createElement('textarea');
          ta.value = code; document.body.appendChild(ta);
          ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        }
        _setSyncStatus('Code copied.', 'ok');
      } catch (_) {
        _setSyncStatus('Could not copy — select & copy manually.', 'err');
      }
    });
  }
  const restoreInput = document.getElementById('sync-restore-input');
  const restoreBtn   = document.getElementById('sync-restore-btn');
  if (restoreBtn && restoreInput) {
    _tapBind(restoreBtn, async () => {
      const raw = (restoreInput.value || '').trim();
      if (!raw) { _setSyncStatus('Enter a code first.', 'err'); return; }
      _setSyncStatus('Looking up code…', 'busy');
      restoreBtn.disabled = true;
      try {
        const url = SYNC_API_BASE + '?code=' + encodeURIComponent(raw);
        const r = await fetch(url);
        const data = await r.json().catch(() => ({}));
        if (r.status === 404) {
          _setSyncStatus('Code not found or expired.', 'err');
          return;
        }
        if (!r.ok || !data.keys) {
          _setSyncStatus(data.error || 'Restore failed.', 'err');
          return;
        }
        // Wipe current progress keys, then write restored ones, then reload.
        try {
          const toRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (k.startsWith('jh_') || k.startsWith('jet-horizon') || k.startsWith('jetslide')) {
              toRemove.push(k);
            }
          }
          toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
          Object.keys(data.keys).forEach(k => {
            try { localStorage.setItem(k, data.keys[k]); } catch(_) {}
          });
        } catch(_) {}
        _setSyncStatus('Progress restored. Reloading…', 'ok');
        setTimeout(() => { try { location.reload(); } catch(_) {} }, 600);
      } catch (e) {
        _setSyncStatus('Network error — check connection.', 'err');
      } finally {
        restoreBtn.disabled = false;
      }
    });
    // Auto-uppercase as user types; keep cursor sane.
    restoreInput.addEventListener('input', () => {
      const v = restoreInput.value.toUpperCase();
      if (v !== restoreInput.value) restoreInput.value = v;
    });
  }

  // Reset Game button — wipes all local progress (skins, missions, fuel cells,
  // thrusters, upgrades, headstarts, tutorial flag, radio unlock, etc.).
  // Two-tap confirm: first tap arms (button turns red, label CONFIRM?), second
  // tap within 4s actually wipes. Tap anywhere else (or wait) to cancel.
  const resetBtn = document.getElementById('settings-reset-btn');
  if (resetBtn) {
    let _armed = false;
    let _armTimer = null;
    function disarm() {
      _armed = false;
      resetBtn.textContent = 'RESET GAME';
      resetBtn.classList.remove('armed');
      if (_armTimer) { clearTimeout(_armTimer); _armTimer = null; }
    }
    _tapBind(resetBtn, () => {
      if (!_armed) {
        _armed = true;
        resetBtn.textContent = 'CONFIRM?';
        resetBtn.classList.add('armed');
        _armTimer = setTimeout(disarm, 4000);
        return;
      }
      // Confirmed — wipe.
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (k.startsWith('jh_') || k.startsWith('jet-horizon') || k.startsWith('jetslide')) {
            keys.push(k);
          }
        }
        keys.forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
      } catch(_) {}
      // Hard reload to fully reinit state with cleared storage.
      try { location.reload(); } catch(_) { window.location.href = window.location.href; }
    });
  }

  // Music volume slider
  document.getElementById('vol-music').addEventListener('input', (e) => {
    _settings.musicVol = parseInt(e.target.value);
    _settings.musicMuted = false;
    document.getElementById('mute-music').classList.remove('muted');
    document.getElementById('mute-music').textContent = '🔊';
    applyMusicVolume();
    saveSettings();
  });

  // SFX volume slider
  document.getElementById('vol-sfx').addEventListener('input', (e) => {
    _settings.sfxVol = parseInt(e.target.value);
    _settings.sfxMuted = false;
    document.getElementById('mute-sfx').classList.remove('muted');
    document.getElementById('mute-sfx').textContent = '🔊';
    applySfxMute(); // refresh state.muted (and no-op live stop since not muted)
    saveSettings();
  });

  // Music mute toggle — moveCancel: scroll-flicks that start on the button
  // (settings panel is scrollable) must not flip the mute state.
  _tapBind(document.getElementById('mute-music'), () => {
    _settings.musicMuted = !_settings.musicMuted;
    document.getElementById('mute-music').classList.toggle('muted', _settings.musicMuted);
    document.getElementById('mute-music').textContent = _settings.musicMuted ? '🔇' : '🔊';
    applyMusicVolume();
    saveSettings();
  }, { moveCancel: true });

  // SFX mute toggle — same scroll-cancel guard as music mute.
  _tapBind(document.getElementById('mute-sfx'), () => {
    _settings.sfxMuted = !_settings.sfxMuted;
    document.getElementById('mute-sfx').classList.toggle('muted', _settings.sfxMuted);
    document.getElementById('mute-sfx').textContent = _settings.sfxMuted ? '🔇' : '🔊';
    applySfxMute(); // immediately silence looping <audio> SFX when muting
    saveSettings();
  }, { moveCancel: true });

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

  // 30 FPS cap toggle — caps framerate at 30 to reduce GPU power ~50%.
  _tapBind(document.getElementById('fpscap-toggle'), () => {
    _settings.fpsCap30 = !_settings.fpsCap30;
    const btn = document.getElementById('fpscap-toggle');
    btn.textContent = _settings.fpsCap30 ? 'ON' : 'OFF';
    btn.classList.toggle('off', !_settings.fpsCap30);
    saveSettings();
  });

  // Lite Bloom toggle — drops bloom resolution /2 → /3 for big mobile savings.
  _tapBind(document.getElementById('litebloom-toggle'), () => {
    _settings.liteBloom = !_settings.liteBloom;
    const btn = document.getElementById('litebloom-toggle');
    btn.textContent = _settings.liteBloom ? 'ON' : 'OFF';
    btn.classList.toggle('off', !_settings.liteBloom);
    if (typeof window.applyLiteBloom === 'function') window.applyLiteBloom();
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

// ── First-time-ever graphics-quality picker ──
// Shown on the very first ACCESS GRANTED tap. Stores 'jh_gfx_picked' = '1'
// in localStorage so it never appears again. Player picks Performance /
// Balanced / Sharp; choice is persisted to _settings.graphicsQuality.
// Visual style mirrors the access-gate UI (cyan tech aesthetic) so it
// reads as part of the boot sequence, not a settings dialog.
window._showGfxPicker = function _showGfxPicker(onDone) {
  let pick = document.getElementById('gfx-picker');
  if (!pick) {
    pick = document.createElement('div');
    pick.id = 'gfx-picker';
    pick.innerHTML = [
      '<div class="gfxp-msg">SELECT RENDER MODE</div>',
      '<div class="gfxp-row">',
        '<button type="button" class="gfxp-btn" data-q="performance">',
          '<span class="gfxp-name">PERFORMANCE</span>',
          '<span class="gfxp-sub">SMOOTHEST</span>',
        '</button>',
        '<button type="button" class="gfxp-btn" data-q="balanced">',
          '<span class="gfxp-name">BALANCED</span>',
          '<span class="gfxp-sub">RECOMMENDED</span>',
        '</button>',
        '<button type="button" class="gfxp-btn primary" data-q="sharp">',
          '<span class="gfxp-name">SHARP</span>',
          '<span class="gfxp-sub">CRISPEST</span>',
        '</button>',
      '</div>',
      '<div class="gfxp-hint">CHANGE ANYTIME IN SETTINGS</div>',
    ].join('');
    document.body.appendChild(pick);
  }
  pick.classList.add('show');
  const _pickFn = (q) => {
    _settings.graphicsQuality = q;
    saveSettings();
    try { window._LS.setItem('jh_gfx_picked', '1'); } catch (_) {}
    try { applyGraphicsQuality(); } catch (_) {}
    pick.classList.add('hide');
    setTimeout(() => { if (pick.parentNode) pick.parentNode.removeChild(pick); }, 500);
    if (typeof onDone === 'function') onDone();
  };
  pick.querySelectorAll('.gfxp-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { if (typeof window.playMenuCycle === 'function') window.playMenuCycle(); } catch (_) {}
      _pickFn(b.getAttribute('data-q'));
    }, { once: true, passive: false });
  });
};

