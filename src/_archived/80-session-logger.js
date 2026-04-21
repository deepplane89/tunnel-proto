// ═══════════════════════════════════════════════════════════════════════════════
//  SESSION LOGGER
//  Records slider changes, obstacle spawns, ship state snapshots.
//  Start/Stop with 'L' key. Export with 'E' key while stopped.
//  Designed to be pasted back to reconstruct a level.
// ═══════════════════════════════════════════════════════════════════════════════
(function setupSessionLogger() {
  let _logActive  = false;
  let _logEntries = [];
  let _logStartT  = 0;
  let _logSnapshotInterval = null;
  let _logUi = null;

  // Public hook — called by tuner sliders and spawners above
  window._sessionLogSlider = function(name, value) {
    if (!_logActive) return;
    _logEntries.push({
      t: +((performance.now() - _logStartT) / 1000).toFixed(2),
      type: 'slider',
      name, value,
      shipX: +(state.shipX||0).toFixed(2),
      speed:  +(state.speed||0).toFixed(1),
    });
  };

  window._sessionLogEvent = function(type, data) {
    if (!_logActive) return;
    _logEntries.push({
      t: +((performance.now() - _logStartT) / 1000).toFixed(2),
      type,
      ...data,
      shipX: +(state.shipX||0).toFixed(2),
      speed:  +(state.speed||0).toFixed(1),
    });
  };

  function _snapshotScene() {
    if (!_logActive || state.phase !== 'playing') return;
    const astT = window._asteroidTuner || {};
    const ltT  = window._LT || {};
    _logEntries.push({
      t: +((performance.now() - _logStartT) / 1000).toFixed(2),
      type: 'snapshot',
      shipX:     +(state.shipX||0).toFixed(2),
      shipVelX:  +(state.shipVelX||0).toFixed(2),
      speed:     +(state.speed||0).toFixed(1),
      score:     state.score,
      level:     (state.currentLevelIdx||0) + 1,
      obstacles: activeObstacles.length,
      ast: {
        enabled: astT.enabled, pattern: astT.pattern,
        freq: +(astT.frequency||0).toFixed(2),
        size: +(astT.size||0).toFixed(2),
        leadFactor: +(astT.leadFactor||0).toFixed(2),
        staggerDual: astT.staggerDual,
        salvoCount: astT.salvoCount,
        laneMin: astT.laneMin, laneMax: astT.laneMax,
      },
      lt: {
        enabled: ltT.enabled, pattern: ltT.pattern,
        freq: +(ltT.frequency||0).toFixed(2),
        staggerGap: +(ltT.staggerGap||0).toFixed(2),
      },
      physics: {
        accelBase: typeof _accelBase !== 'undefined' ? _accelBase : null,
        maxVelBase: typeof _maxVelBase !== 'undefined' ? _maxVelBase : null,
      },
    });
  }

  function _startLog() {
    _logEntries = [];
    _logStartT  = performance.now();
    _logActive  = true;
    // Snapshot every 5 seconds
    _logSnapshotInterval = setInterval(_snapshotScene, 5000);
    _updateLogUi();
    // Log initial state
    _sessionLogEvent('log_start', {
      mode: state._jetLightningMode ? 'JetLightning' : state._tutorialActive ? 'Tutorial' : 'Campaign',
    });
  }

  function _stopLog() {
    _logActive = false;
    clearInterval(_logSnapshotInterval);
    _logSnapshotInterval = null;
    _updateLogUi();
  }

  function _exportLog() {
    if (_logEntries.length === 0) { alert('No log entries — start a session first.'); return; }
    const json = JSON.stringify({ version: 1, entries: _logEntries }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'jet-session-' + Date.now() + '.json';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function _updateLogUi() {
    if (!_logUi) return;
    const status = _logUi.querySelector('#log-status');
    const startBtn = _logUi.querySelector('#log-start');
    const stopBtn  = _logUi.querySelector('#log-stop');
    if (_logActive) {
      status.textContent = '● REC';
      status.style.color = '#f44';
      startBtn.style.opacity = '0.4';
      stopBtn.style.opacity  = '1';
    } else {
      status.textContent = _logEntries.length > 0 ? '■ ' + _logEntries.length + ' events' : '○ idle';
      status.style.color = _logEntries.length > 0 ? '#0f8' : '#888';
      startBtn.style.opacity = '1';
      stopBtn.style.opacity  = '0.4';
    }
  }

  // ── Floating logger HUD (always visible during play) ─────────────────────
  function _buildLogHud() {
    _logUi = document.createElement('div');
    _logUi.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;font-family:monospace;font-size:10px;background:rgba(0,0,0,0.85);border:1px solid #444;padding:5px 10px;border-radius:3px;display:flex;align-items:center;gap:8px;pointer-events:all;';

    const title = document.createElement('span');
    title.style.cssText = 'color:#888;';
    title.textContent = 'LOG';
    _logUi.appendChild(title);

    const status = document.createElement('span');
    status.id = 'log-status';
    status.style.cssText = 'color:#888;min-width:80px;';
    status.textContent = '○ idle';
    _logUi.appendChild(status);

    const startBtn = document.createElement('button');
    startBtn.id = 'log-start';
    startBtn.textContent = '● REC';
    startBtn.style.cssText = 'background:none;border:1px solid #f44;color:#f44;padding:2px 6px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;';
    startBtn.onclick = () => { if (!_logActive) _startLog(); };
    _logUi.appendChild(startBtn);

    const stopBtn = document.createElement('button');
    stopBtn.id = 'log-stop';
    stopBtn.textContent = '■ STOP';
    stopBtn.style.cssText = 'background:none;border:1px solid #888;color:#888;padding:2px 6px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;opacity:0.4;';
    stopBtn.onclick = () => { if (_logActive) _stopLog(); };
    _logUi.appendChild(stopBtn);

    const expBtn = document.createElement('button');
    expBtn.textContent = '⬇ EXPORT';
    expBtn.style.cssText = 'background:none;border:1px solid #0f8;color:#0f8;padding:2px 6px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;';
    expBtn.onclick = _exportLog;
    _logUi.appendChild(expBtn);

    document.body.appendChild(_logUi);
  }

  _buildLogHud();

  // L = toggle log, E = export
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'l' || e.key === 'L') { _logActive ? _stopLog() : _startLog(); }
    if ((e.key === 'e' || e.key === 'E') && !_logActive) _exportLog();
  });

  // Slider logging is now injected directly inside each tuner's makeSlider/mkS functions.
})();
