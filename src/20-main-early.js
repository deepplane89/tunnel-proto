
// ── Reset hook ──
// Visit ?reset=1 to wipe all localStorage (coins, level, owned skins, owned
// power-ups, equipped thrusters, leaderboard, daily streak) and reload clean.
// Runs before any other code reads storage. iPhone-friendly fallback for
// users without DevTools access.
try {
  if (typeof location !== 'undefined' && /[?&]reset=1\b/.test(location.search || '')) {
    try { localStorage.clear(); } catch(_){}
    try { sessionStorage.clear(); } catch(_){}
    // Strip the query string so a manual reload doesn't re-trigger.
    const cleanUrl = location.pathname + location.hash;
    location.replace(cleanUrl);
  }
} catch(_){}

// ── Mobile-tight tap binding ──
// Binds to pointerdown for instant response (no 300ms click delay on mobile).
// Suppresses the synthetic click that follows so handlers don't double-fire,
// and falls back to click on the rare browser without pointer events.
function _tapBind(el, fn, opts) {
  if (!el) return;
  const passive = !(opts && opts.preventDefault);
  let _firedAt = 0;
  const handler = (e) => {
    _firedAt = performance.now();
    if (opts && opts.preventDefault) { try { e.preventDefault(); } catch (_) {} }
    fn(e);
  };
  if ('onpointerdown' in window) {
    el.addEventListener('pointerdown', handler, { passive });
    // Suppress the synthetic click (within 500ms of pointerdown)
    el.addEventListener('click', (e) => {
      if (performance.now() - _firedAt < 500) { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }
    });
  } else {
    el.addEventListener('click', handler);
  }
}

let shipModelLoaded = false;

// ── TITLE SHIP PREVIEW STATE ──────────────────────────────────────────────
let _titleShipModel = null;          // cloned ship in titleScene
let _titleMeshMap = [];              // [{mesh, origName}] for skin application
const _titleDarkMat = new THREE.MeshStandardMaterial({
  color: 0x181818, metalness: 0.3, roughness: 0.85,
  transparent: false, depthWrite: true,
});
let _titleGlowPhase = 0;            // for handling-upgrade pulse
let crystalTemplate = null;  // cloned for each obstacle instance

// ═══════════════════════════════════════════════════
//  LEVEL DEFINITIONS
// ═══════════════════════════════════════════════════
// ─── COLOR THEORY NOTES ────────────────────────────────────────────────────
// Each level uses a tight 3-color palette:
//   sky: near-black tinted with the hue family
//   grid: saturated accent (the "primary" color of the level)
//   sun:  warm complementary, or analogous highlight
// Levels progress through the color wheel: blue→violet→red→cyan→gold
// ───────────────────────────────────────────────────────────────────────────
const LEVELS = [
  {
    // L1 — NEON DAWN: deep navy sky, electric cyan grid, warm amber sun
    // Palette: navy #08102a | cyan #00eeff | amber #ff9500
    // Cyan/amber = classic complementary split across cool/warm
    id: 1, name: 'NEON DAWN',        scoreThreshold: 0,
    speedMult: 1.0,  obstaclesPerSpawn: 6, maxObstaclesPerSpawn: 8, gapFactor: 1.0,
    skyTop: new THREE.Color(0x03070f), skyBot: new THREE.Color(0x08102a),
    gridColor: new THREE.Color(0x00eeff), sunColor: new THREE.Color(0xff9500),
    sunStripeColor: new THREE.Color(0xff5500), bloomStrength: 0.35,
    fogColor: new THREE.Color(0x05091a), lateralDrift: false,
  },
  {
    // L2 — ULTRAVIOLET: deep violet sky, vivid magenta grid, violet sun
    // Palette: #0e0320 | #dd00ff | #8800cc — analogous violet/magenta
    id: 2, name: 'ULTRAVIOLET',      scoreThreshold: 150,
    speedMult: 1.2,  obstaclesPerSpawn: 8, maxObstaclesPerSpawn: 10, gapFactor: 0.9,
    skyTop: new THREE.Color(0x060010), skyBot: new THREE.Color(0x0e0320),
    gridColor: new THREE.Color(0xdd00ff), sunColor: new THREE.Color(0xcc44ff),
    sunStripeColor: new THREE.Color(0x8800cc), bloomStrength: 0.38,
    fogColor: new THREE.Color(0x080018), lateralDrift: false,
  },
  {
    // L3 — CRIMSON VOID: pure black sky, hot pink/red grid, blood-orange sun
    // Palette: #000 | #ff1050 | #ff4400 — tight red-pink analogous
    id: 3, name: 'CRIMSON VOID',     scoreThreshold: 300,
    speedMult: 1.35, obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 13, gapFactor: 0.82,
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x0f0005),
    gridColor: new THREE.Color(0xff1050), sunColor: new THREE.Color(0xff4400),
    sunStripeColor: new THREE.Color(0xcc0000), bloomStrength: 0.42,
    fogColor: new THREE.Color(0x080003), lateralDrift: true,
  },
  {
    // L4 — ICE STORM: pitch black sky, icy cyan-white grid, pale blue sun
    // Palette: #000 | #55ffff | #aaeeff — cool desaturated ice tones
    id: 4, name: 'ICE STORM',        scoreThreshold: 490,
    speedMult: 1.5,  obstaclesPerSpawn: 9,  maxObstaclesPerSpawn: 11,  gapFactor: 0.88,
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x000c18),
    gridColor: new THREE.Color(0x55ffff), sunColor: new THREE.Color(0xaaeeff),
    sunStripeColor: new THREE.Color(0x4499cc), bloomStrength: 0.30,
    fogColor: new THREE.Color(0x00080f), lateralDrift: true,
  },
  {
    // L5 — VOID SINGULARITY: total black, gold grid, white-hot sun
    // Palette: #000 | #ffcc00 | #fff0aa — warm gold monochromatic
    id: 5, name: 'VOID SINGULARITY', scoreThreshold: 675,
    speedMult: 1.85, obstaclesPerSpawn: 9,  maxObstaclesPerSpawn: 11,  gapFactor: 0.88,
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x060400),
    gridColor: new THREE.Color(0xffcc00), sunColor: new THREE.Color(0xffaa33),
    sunStripeColor: new THREE.Color(0xff6600), bloomStrength: 0.30,
    fogColor: new THREE.Color(0x030200), lateralDrift: true,
  },
];

// ═══════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════
const BASE_SPEED         = 36;  // fast from the start

// ═══════════════════════════════════════════════════
//  SPEED SETTER — SINGLE SOURCE OF TRUTH
// ═══════════════════════════════════════════════════
// All gameplay speed changes should go through `_setDRSpeed(value, trigger)`
// (added 2026-04, infra only — callers will be migrated in Pass 2B). The
// `trigger` argument MUST be one of DR_SPEED_TRIGGERS keys; this gives us:
//   1. ONE place to put a breakpoint when speed misbehaves
//   2. ONE place to add logging (toggle DEBUG_DR_SPEED below)
//   3. A grep-able audit trail of every legal reason speed can change
//   4. A future hook for safeForSpeed deferral, ratchet enforcement, etc.
//
// DO NOT set state.speed directly. Use _setDRSpeed(). The setter is global
// (window._setDRSpeed) so it's reachable from every src/*.js file.
//
// Pass 2B (DONE) migrated all ~32 `state.speed = ...` write sites to use this
// setter. Pass 2C (DONE) deleted the parallel BAND_SPEED pathway in
// checkDeathRunSpeed (which fought the sequencer) along with the dead
// checkDeathRunVibe time-band reader. Speed + vibes are now 100%
// sequencer-driven (DR_SEQUENCE table + _drEndlessTick wave rotation).
// ─────────────────────────────────────────────────────────────────────────
const DR_SPEED_TRIGGERS = Object.freeze({
  // Lifecycle
  INIT:            'state initialization (BASE_SPEED default)',
  RUN_START:       'startGame() reset',
  // Sequencer
  STAGE_START:     'DR_SEQUENCE advanced to a new stage',
  STAGE_RAMP:      'in-stage speed ramp (e.g. canyon arc easing)',
  // User / debug
  TUNER_OVERRIDE:  'scene tuner speed slider',
  KONAMI:          'Konami / dev menu speed jump',
  // Mechanics that legitimately re-write speed
  CANYON_EXIT:     'corridor exit speed restore',
  RING_PAUSE:      'ring tuner freeze (sets to 0 / restores prior)',
  WARP:            'L3 warp transition',
  PENDING_APPLY:   '_pendingSpeed deferred apply (post safe window)',
  // Legacy / to be retired
  LEGACY_LEVEL:    'pre-DR level-table speed writer (head-start ramp interval)',
  JL:              'Jet Lightning canyon/base swap (TO BE DELETED with JL surgery)',
});

let DEBUG_DR_SPEED = false; // flip in console: window.DEBUG_DR_SPEED = true
window.DEBUG_DR_SPEED = DEBUG_DR_SPEED;

function _setDRSpeed(value, trigger) {
  if (!DR_SPEED_TRIGGERS[trigger]) {
    console.warn(`[DR_SPEED] unknown trigger: ${trigger} — add it to DR_SPEED_TRIGGERS or use an existing key`);
  }
  if (window.DEBUG_DR_SPEED) {
    const prev = state.speed;
    if (Math.abs(prev - value) > 0.01) {
    }
  }
  state.speed = value;
  state._lastSpeedTrigger = trigger;
}
window._setDRSpeed = _setDRSpeed;
window.DR_SPEED_TRIGGERS = DR_SPEED_TRIGGERS;
// Play corridor: ship-relative lanes spanning ~2x screen width
const LANE_COUNT         = 21;   // wide enough that you can never outrun the edges
const LANE_WIDTH         = 3.2;
const TOTAL_ROAD_WIDTH   = LANE_COUNT * LANE_WIDTH;   // ~54.4
const WALL_HALF_WIDTH    = 18; // kept for gauntlet math only, no visual walls
const SHIP_HALF_WIDTH    = 1.2;
const OBSTACLE_HALF      = 0.9;                       // effective collision half-width
const GRID_TILE_DEPTH    = 4;
const GRID_TILES         = 40;
const SPAWN_Z            = -160;  // spawn further out so cones fade in from deep horizon
const DESPAWN_Z          = 6;
const OBSTACLE_POOL_SIZE = 3000;
const POWERUP_POOL_SIZE  = 10;
const STAR_COUNT         = 1800;

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let debugHitboxes = false;  // toggled by key '0' during play
const state = {
  phase: 'title',          // 'title' | 'playing' | 'dead'
  score: 0,
  bestScore: 0,
  multiplier: 1,
  currentLevelIdx: 0,
  speed: BASE_SPEED,
  shipX: 0,
  shipVelX: 0,
  shieldActive: false,
  laserActive: false,
  magnetActive: false,
  invincibleSpeedActive: false,
  multiplierTimer: 0,
  laserTimer: 0,
  invincibleTimer: 0,
  sessionCoins: 0,   // coins collected this run
  sessionPowerups: 0,    // powerups collected this run
  sessionShields: 0,     // shields collected this run
  sessionLasers: 0,      // lasers collected this run
  sessionInvincibles: 0, // invincibles collected this run
  _missionCheckTimer: 0, // timer for in-run mission checks
  _missionToasted: false, // tracks if current mission already toasted this run
  saveMeCount: 0,     // how many times Save Me used this run
  playerScore: 0,     // player-facing score (separate from level-threshold score)
  nearMissBendAllowed: true, // corridor: one near-miss per bend
  nearMissFlash: 0,            // 1.0 → 0.0 decay for hull red pulse
  prevCorridorCenter: 0,     // track corridor sine for bend detection
  prevCorridorDir: 0,        // sign of last corridor center movement
  startedFromL1: true, // true only when player starts from level 1 (eligible for leaderboard)
  magnetTimer: 0,
  shieldHit: false,
  frameCount: 0,
  elapsed: 0,       // total seconds played — used for smooth per-frame animations
  nextSpawnZ: -50,
  // Tutorial
  _tutorialActive: false,
  _tutorialStep: 0,       // 0=cones, 1=zipline, 2=endcard, 3=done
  _tutorialTimer: 0,
  _tutorialConesFired: 0, // how many cone rows spawned
  _tutorialConeZ: -99,    // spawn Z accumulator for cone rows
  _tutorialZipZ: -99,     // spawn Z for zip rows
  _tutorialZipRows: 0,
  spawnInterval: 18,
  corridorCenter: 0,   // world X center of current play corridor, lerps toward ship smoothly
  levelElapsed: 0,     // seconds spent in current level (resets on level change)
  l4CorridorDone: false, // true once L4 corridor has been triggered this level entry
  wallCenterX: 0,      // smooth wall center — lerps to ship position, prevents wall jitter
  muted: false,
  // Gauntlet state
  gauntletActive: false,
  gauntletRowsLeft: 0,
  gauntletGapLane: 6,    // which lane the gap is currently on (0-based)
  gauntletGapDir: 1,     // which direction the gap is drifting
  gauntletCooldown: 0,   // rows until next gauntlet can trigger
  // L5 Zipper state
  zipperActive: false,   // true when L5 zipper slalom is running
  zipperRowsLeft: 0,     // rows remaining in this zipper burst
  zipperCooldown: 0,     // rows cooldown before next zipper
  zipperSide: 1,         // current gate side: +1=right gap, -1=left gap (alternates each row)
  zipperSpawnZ: -7,      // high-freq spawn timer for zipper rows
  zipperSpawnTimer: 0,   // seconds until next zipper row fires
  zipperRunCount: 0,     // how many zipper bursts have completed this L5 session
  l5EndingActive: false, // true once L5 ending sequence has started
  l5EndingTimer: 0,      // seconds into ending (for slowdown)
  l5TitleShown: false,   // true once JET HORIZON fade-in has been triggered
  l5PreZipperRandom: 0,   // seconds of random cones on L5 entry before first zipper fires
  postL3Gap: 0,             // seconds remaining in post-L3-corridor cone-free gap
  l5RandomAfterZipper: 0, // seconds of random cones after 2nd zipper before ending
  l5RandomAfterCorridor: 0, // seconds of random cones after corridor before sail-out
  // L5 sine corridor (final challenge before ending)
  l5CorridorActive: false,
  l5CorridorDone: false,
  l5CorridorRowsDone: 0,
  l5CorridorSpawnZ: -7,
  l5SineT: 0,
  corridorMode: false,   // true when L3 permanent dense corridor is active
  corridorSpawnZ: -7,    // high-freq spawn timer for corridor rows
  corridorDelay: 0,      // seconds remaining before corridor starts spawning (entry breathing room)
  // Ship wobble on release
  wobbleAmp: 0,          // current wobble amplitude (radians)
  wobblePhase: 0,        // oscillation phase
  wobbleDir: 1,          // +1 or -1 — direction of initial rock
  wasSteering: false,    // tracks whether player was steering last frame
  steerStartTime: 0,     // when current steer began (performance.now)
  // Hold-to-spin roll
  rollAngle: 0,          // current Z rotation in radians (0 = upright, Math.PI/2 = perpendicular)
  rollDir: 0,            // +1 = right (up), -1 = left (down)
  rollHeld: false,       // is the roll key currently held
  tiltTimer: 0,          // seconds spent tilted — penalty only kicks in after grace period
  // Death Run mode
  isDeathRun: false,       // true when playing Death Run (cycling vibes, no level progression)
  deathRunVibeIdx: 0,      // which DEATH_RUN_VIBES[] vibe is currently active (cycles 0→19→0…)
  deathRunRestBeat: 0,     // seconds remaining in rest beat (no cones)
  deathRunMechanic: 'random', // 'random' | 'corridor' | 'l4corridor' | 'l5corridor' | 'zipper'
  deathRunMechTimer: 0,    // seconds until next mechanic switch
  deathRunMechCooldown: 0, // seconds of random cones before next mechanic can trigger
  deathRunCorridorMaxRows: 0, // max rows for current death run corridor burst
  deathRunSpeedTier: 1,      // physTier floor is 1 (matches DR_SEQUENCE rules); ramps 1→5 over the run
  deathRunMusicPhase: 0,     // 0=bg(L1), 1=l4
  // Wave director state (drives pacing for DeathRun)
  drPhase: 'RELEASE',        // 'RELEASE' | 'BUILD' | 'PEAK' | 'RECOVERY'
  drPhaseTimer: 0,           // seconds elapsed in current phase
  drPhaseDuration: 0,        // target duration for current phase
  drWaveCount: 0,            // total wave cycles completed this run
  drIntensity: 0,            // 0-100 running intensity (for Phase 3)
  drRecentFamilies: [],      // anti-repeat ring buffer (for Phase 2+)
  // Slalom minefield
  slalomActive: false,
  slalomSpawnZ: -7,
  slalomRowsDone: 0,
  slalomMaxRows: 0,

  drPatternCooldown: 0, // seconds of random cones before next pattern
  drCustomPatternActive: false,
  drCustomPatternRow: 0,
  drCustomPatternSpawnZ: -7,
  // Angled walls (DR opening weave)
  angledWallsActive: false,
  angledWallSpawnZ: -7,
  angledWallRowsDone: 0,
  angledWallMaxRows: 20,
  // Upgrade tier state
  shieldHitPoints: 1,
  shieldDuration: 0,
  shieldTimer: 0,
  _prevShieldHP: 0,
  laserTier: 1,
  laserBoltTimer: 0,
  laserFireRate: 5,
  laserColor: 0xff2200,
  invincibleGrace: 2.0,
  magnetRadius: 18,
  magnetPullsPowerups: false,
  // Reward wheel
  wheelEarned: false,
};

// ── SKIN SYSTEM ─────────────────────────────────────────────
const SKIN_STORAGE_KEY = 'jh_skins';
const COIN_STORAGE_KEY = 'jh_coins';
const LEVEL_PROGRESS_KEY = 'jh_levels_beaten';

function loadLevelProgress() {
  const raw = window._LS.getItem(LEVEL_PROGRESS_KEY);
  return raw ? JSON.parse(raw) : [false, false, false, false, false]; // L1-L5
}
function saveLevelBeaten(levelIdx) {
  const prog = loadLevelProgress();
  prog[levelIdx] = true;
  window._LS.setItem(LEVEL_PROGRESS_KEY, JSON.stringify(prog));
  updateTitleBadges();
}
function updateTitleBadges() { /* badges removed from UI */ }

// RUNNER (default ship) cone offsets — user-tuned 2026-05-01.
// Applied via _applyConeConfig() whenever the active ship is RUNNER (incl. on
// MK→Runner switch via _hideAltShip). Stored ship-local via shipGroup parent so
// cones track ship rotation (xwing/barrel-roll) intrinsically.
const RUNNER_CONE_CFG = {
  length: 3.30, radius: 0.29,
  rotX: 0, rotY: 0, rotZ: 0,
  offX: 0, offY: 0, offZ: 0,
  offLX: -0.02, offLY: 0.03, offLZ: 0,
  offRX:  0.02, offRY: 0.02, offRZ: 0,
};

// All 4 skins share spaceship_01.glb (formerly the MK II hull, geometrically
// identical to default_ship.glb but with addon nodes Fins_01/Fins_02/Rings_001/
// Turrets_001-003). Each skin gets recolored via _SKIN_PALETTE[idx] inside the
// _loadAltShip matchDefault path. Addons are keyed by glbFile so they're shared
// across all 4 skins (toggling Fins on RUNNER also shows on GHOST/MAMBA/CIPHER).
// When activeSkinIdx===0 AND every spaceship_01.glb addon is enabled, the UI
// flips the displayed name to 'RUNNER MK II' (text only — see _displayedSkinName).
const _SHIP_GLB_CONFIG = {
  posX: 0, posY: -0.590, posZ: 0, rotX: 0, rotY: 3.142, rotZ: 0, scale: 1.0,
  nozzleL: [-0.480, 0.050, 5.100], nozzleR: [0.480, 0.050, 5.100],
  miniL:   [-0.150, 0.060, 5.100], miniR:   [0.160, 0.060, 5.100], thrusterScale: 1.0,
  portraitNozzleL: [-0.480, 0.050, 5.100], portraitNozzleR: [0.480, 0.050, 5.100],
  portraitMiniL:   [-0.150, 0.060, 5.100], portraitMiniR:   [0.160, 0.060, 5.100],
  coneCfg: {
    length: 3.30, radius: 0.29,
    rotX: 0, rotY: 0, rotZ: 0,
    offX: 0, offY: 0, offZ: 0,
    offLX: -0.02, offLY: 0.03, offLZ: 0,
    offRX:  0.02, offRY: 0.02, offRZ: 0,
  },
  matchDefault: true,
};
const _SHIP_LASER_CONFIG = { lanes:2, spread:0.35, yOff:0.45, zOff:-2.50, len:10.00, glowLen:7.50, fireRate:8.50 };
const SHIP_SKINS = [
  { name: 'RUNNER',       price: 0,    description: 'Default',                glbFile: 'spaceship_01.glb', glbConfig: _SHIP_GLB_CONFIG, laserConfig: _SHIP_LASER_CONFIG },
  { name: 'GHOST',        price: 400,  description: 'Clean glossy white',     glbFile: 'spaceship_01.glb', glbConfig: _SHIP_GLB_CONFIG, laserConfig: _SHIP_LASER_CONFIG },
  { name: 'BLACK MAMBA',  price: 800,  description: 'Stealth predator',       glbFile: 'spaceship_01.glb', glbConfig: _SHIP_GLB_CONFIG, laserConfig: _SHIP_LASER_CONFIG },
  { name: 'CIPHER',       price: 1400, description: 'Voronoi hull plating',   glbFile: 'spaceship_01.glb', glbConfig: _SHIP_GLB_CONFIG, laserConfig: _SHIP_LASER_CONFIG },
];

let activeSkinIdx = 0;
let skinViewerIdx = 0;
let _skinAdminMode = false; // secret admin: 5-tap skin label to toggle

// Returns the displayed name for a skin index. Skin 0 is RUNNER by default,
// but flips to 'RUNNER MK II' when every spaceship_01.glb addon is enabled
// (Fins_01, Fins_02, Rings_001, Turrets_001-003). Other skins return their
// raw SHIP_SKINS name unchanged. Used by garage cards, shop labels, tuner HUD.
function _displayedSkinName(idx) {
  const s = SHIP_SKINS[idx];
  if (!s) return 'SKIN ' + idx;
  if (idx !== 0) return s.name;
  try {
    const raw = window._LS && window._LS.getItem('jh_showroom_addons_v2');
    if (!raw) return s.name;
    const all = JSON.parse(raw) || {};
    const bucket = all['spaceship_01.glb'] || {};
    const REQ = ['Fins_01','Fins_02','Rings_001','Turrets_001','Turrets_002','Turrets_003'];
    for (let i = 0; i < REQ.length; i++) if (bucket[REQ[i]] !== true) return s.name;
    return 'RUNNER MK II';
  } catch(_) { return s.name; }
}
try { window._displayedSkinName = _displayedSkinName; } catch(_){}

function loadSkinData() {
  const raw = window._LS.getItem(SKIN_STORAGE_KEY);
  const defaults = { selected: 0, unlocked: [0] };
  if (!raw) return defaults;
  try {
    const d = JSON.parse(raw);
    if (!Array.isArray(d.unlocked)) d.unlocked = [0];
    // 2026-05-03: RUNNER MK II merged into RUNNER. Anyone who had idx 4
    // selected gets bounced to idx 0 and all spaceship_01.glb addons enabled
    // (preserves the upgraded look). Then drop idx 4 from unlocked.
    let _wantMk2Migration = (d.selected === 4) || d.unlocked.includes(4);
    if (_wantMk2Migration) {
      try {
        const _addonsRaw = window._LS.getItem('jh_showroom_addons_v2');
        const _addons = _addonsRaw ? JSON.parse(_addonsRaw) : {};
        const _key = 'spaceship_01.glb';
        if (!_addons[_key]) _addons[_key] = {};
        ['Fins_01','Fins_02','Rings_001','Turrets_001','Turrets_002','Turrets_003']
          .forEach(n => { _addons[_key][n] = true; });
        window._LS.setItem('jh_showroom_addons_v2', JSON.stringify(_addons));
      } catch(_){}
      if (d.selected === 4) d.selected = 0;
    }
    // Migration: drop any unlocked indices that no longer exist (e.g. removed skins)
    d.unlocked = d.unlocked.filter(i => i >= 0 && i < SHIP_SKINS.length);
    if (!d.unlocked.includes(0)) d.unlocked.push(0);
    // Migration: bounce selected to RUNNER if it points at a removed slot
    if (typeof d.selected !== 'number' || d.selected < 0 || d.selected >= SHIP_SKINS.length) {
      d.selected = 0;
    }
    return d;
  } catch { return defaults; }
}

function saveSkinData(data) {
  window._LS.setItem(SKIN_STORAGE_KEY, JSON.stringify(data));
}

// ── THRUSTER INVENTORY (presets + cosmetic colors) ───────────────────────────────
// Storage shape:
//   { selectedPreset, selectedColor, unlockedPresets:[], unlockedColors:[] }
// 'baseline' preset and 'default' color are always unlocked.
const THRUSTER_STORAGE_KEY = 'jh_thrusters';
function loadThrusterData() {
  const defaults = {
    selectedPreset: 'baseline',
    selectedColor:  'default',
    unlockedPresets: ['baseline'],
    unlockedColors:  ['default'],
  };
  const raw = window._LS.getItem(THRUSTER_STORAGE_KEY);
  if (!raw) return defaults;
  try {
    const d = JSON.parse(raw);
    if (!Array.isArray(d.unlockedPresets)) d.unlockedPresets = ['baseline'];
    if (!Array.isArray(d.unlockedColors))  d.unlockedColors  = ['default'];
    if (!d.unlockedPresets.includes('baseline')) d.unlockedPresets.push('baseline');
    if (!d.unlockedColors.includes('default'))   d.unlockedColors.push('default');
    // Migration: drop unlocked entries that no longer exist in data tables
    try {
      const presets = window._THRUSTER_PRESETS || {};
      const palette = window._THRUSTER_COLOR_PALETTE || {};
      d.unlockedPresets = d.unlockedPresets.filter(k => k in presets);
      d.unlockedColors  = d.unlockedColors.filter(k => k in palette);
    } catch(_){}
    if (typeof d.selectedPreset !== 'string' || !d.unlockedPresets.includes(d.selectedPreset)) {
      d.selectedPreset = 'baseline';
    }
    if (typeof d.selectedColor !== 'string' || !d.unlockedColors.includes(d.selectedColor)) {
      d.selectedColor = 'default';
    }
    return d;
  } catch { return defaults; }
}
function saveThrusterData(data) {
  window._LS.setItem(THRUSTER_STORAGE_KEY, JSON.stringify(data));
}

// ── THRUSTER COLOR LOCK ─────────────────────────────────────────────────────
// When true, updateThrusterColor() and the per-frame thruster-color lerps
// (in updateTransition + applyDeathRunVibeTransition) are no-ops. Set true
// at run start so tier/vibe transitions never change thruster color mid-run.
// Cleared on title return so the title vibe preview can repaint.
window._thrusterColorLocked = false;

function loadCoinWallet() {
  return parseInt(window._LS.getItem(COIN_STORAGE_KEY) || '0', 10);
}

function saveCoinWallet(amount) {
  window._LS.setItem(COIN_STORAGE_KEY, String(amount));
}

// ── LEVELING SYSTEM ──────────────────────────────────────────────────────────
const LEVEL_STORAGE_KEY = 'jetslide_level';
const XP_STORAGE_KEY = 'jetslide_xp';

function xpForLevel(level) {
  // Very fast L1-5, gentle quadratic ramp after
  if (level <= 5) return Math.floor(100 + 50 * level + 10 * level * level);  // 160,240,340,460,600
  return Math.floor(300 + 150 * level + 5 * level * level);  // L6=1380, L10=2300, L15=3675, L22=6196
}

function loadPlayerLevel() {
  return parseInt(window._LS.getItem(LEVEL_STORAGE_KEY) || '1', 10);
}

function loadPlayerXP() {
  return parseInt(window._LS.getItem(XP_STORAGE_KEY) || '0', 10);
}

function savePlayerLevel(level) {
  window._LS.setItem(LEVEL_STORAGE_KEY, String(level));
}

function savePlayerXP(xp) {
  window._LS.setItem(XP_STORAGE_KEY, String(xp));
}

function addXPFromRun(playerScore, bonusXP) {
  const distXP = Math.floor((state.distance || 0) / 100);
  const xpEarned = Math.floor(playerScore / 25) + (bonusXP || 0) + distXP;
  const startLevel = loadPlayerLevel();
  const startXP = loadPlayerXP();
  const startXPForLevel = xpForLevel(startLevel);
  let level = startLevel;
  let xp = startXP + xpEarned;

  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
  }

  savePlayerLevel(level);
  savePlayerXP(xp);

  return {
    xpEarned,
    level,
    xp,
    xpForNext: xpForLevel(level),
    levelsGained: level - startLevel,
    newLevel: level > startLevel,
    startPct: startXP / startXPForLevel,  // where the bar should start from
  };
}

// Level-gated skin unlocks (replaces coin-based)
const SKIN_LEVEL_UNLOCKS = {
  0: 1,   // RUNNER: Level 1 (default)
  1: 10,  // GHOST: Level 10
  2: 20,  // BLACK MAMBA: Level 20
  3: 35,  // CIPHER: Level 35
};

// Ship handling upgrades — drift reduces as player levels up
const HANDLING_TIERS = [
  { level: 1,  drift: 1.0,  label: null },              // stock
  { level: 2,  drift: 0.70, label: 'Hull Stabilized' },
  { level: 3,  drift: 0.50, label: 'Thrusters Aligned' },
  { level: 5,  drift: 0.30, label: 'Flight Control Online' },
  { level: 8,  drift: 0.15, label: 'Advanced Handling' },
  { level: 14, drift: 0.05, label: 'Precision Flight' },
  { level: 22, drift: 0.0,  label: 'Full Control' },
];
const HANDLING_UPGRADE_KEY = 'jetslide_handling_claimed';

let _handlingDriftOverride = -1; // -1 = use player level, 0-1 = tuner override
// ── Named physics presets ───────────────────────────────────────────────────
// Restore these via the physics tuner "RESTORE PRESET" button
const _PHYSICS_PRESETS = {
  'JL_v1': {
    label:        'Jet Lightning v1 (rchouake approved)',
    accelBase:    60,
    accelSnap:    100,
    maxVelBase:   18,
    maxVelSnap:   23,
    bankMax:      0.04,
    bankSmoothing:8,
    decelBasePct: 0.02,
    decelFullPct: 0.05,
    speed:        'L4',
  },
  'JL_v2': {
    label:        'Jet Lightning v2 — tighter lateral cap (maxVelBase 13)',
    accelBase:    60,
    accelSnap:    100,
    maxVelBase:   13,
    maxVelSnap:   23,
    bankMax:      0.04,
    bankSmoothing:8,
    decelBasePct: 0.02,
    decelFullPct: 0.05,
    speed:        'L4',
  },
};

// ── Ship physics tuner overrides (-1 = use formula) ──
let _accelBase       = 22;   // base ACCEL at L1
let _accelSnap       = 52;   // extra ACCEL added at max level
let _physLevelOverride = -1; // -1 = use game level, 0-4 = force physics snap level (0=floaty L1, 4=crisp L5)
let _accelDriftMult  = 4.0;  // unused — kept for tuner slider
let _decelBasePct    = 0.02; // DECEL % at stock (long slide)
let _decelFullPct    = 0.05; // DECEL % at full control (nice slide, stops cleanly)
let _decelOppScale   = 1.0;  // unused — kept for tuner slider (always start at -1 = live)
let _maxVelBase      = 9;    // lateral velocity cap at L1
let _maxVelSnap      = 13;   // extra cap added at max level (total = _maxVelBase + _maxVelSnap at L5)
let _funFloorSpeed     = 1.0;  // speed multiplier applied at game start (1.0 = BASE_SPEED, 1.85 = L5)
let _funFloorIntensity = 0.0;  // 0→1: scales asteroid + lightning frequency down at spawn (0=tuner defaults, 1=max chaos)
function getHandlingDrift() {
  if (_handlingDriftOverride >= 0) return _handlingDriftOverride;
  const level = loadPlayerLevel();
  let drift = 1.0;
  for (const t of HANDLING_TIERS) {
    if (level >= t.level) drift = t.drift;
  }
  return drift;
}

function getPendingHandlingUpgrade() {
  const level = loadPlayerLevel();
  const claimed = parseInt(window._LS.getItem(HANDLING_UPGRADE_KEY) || '1', 10);
  for (const t of HANDLING_TIERS) {
    if (t.level > claimed && t.level <= level && t.label) return t;
  }
  return null;
}

function claimHandlingUpgrade() {
  const pending = getPendingHandlingUpgrade();
  if (!pending) return null;
  window._LS.setItem(HANDLING_UPGRADE_KEY, String(pending.level));
  return pending;
}

function isSkinUnlocked(skinIdx) {
  const requiredLevel = SKIN_LEVEL_UNLOCKS[skinIdx] || 1;
  return loadPlayerLevel() >= requiredLevel;
}


// ── UPGRADE SYSTEM ──────────────────────────────────────────────────────────
const UPGRADE_STORAGE_PREFIX = 'jetslide_up_';

const UPGRADE_COSTS = [0, 500, 1500, 4000, 10000]; // cost to reach tier 1,2,3,4,5

// SVG line icons (24x24 viewbox, stroke only, currentColor)
const SVG_ICONS = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L3 7v5c0 5.25 3.75 10 9 11 5.25-1 9-5.75 9-11V7L12 2z"/></svg>',
  laser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="6" y1="18" x2="18" y2="4"/><line x1="10" y1="18" x2="22" y2="4"/><circle cx="4" cy="20" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="20" r="1.5" fill="currentColor" stroke="none"/></svg>',
  invincible: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13,2 16,9 23,9 17.5,14 19.5,21 13,17 6.5,21 8.5,14 3,9 10,9"/></svg>',
  magnet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V4h4v4a4 4 0 008 0V4h4v4a8 8 0 01-16 0z"/><line x1="4" y1="6" x2="8" y2="6"/><line x1="16" y1="6" x2="20" y2="6"/></svg>',
  coinvalue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="10" r="6"/><ellipse cx="12" cy="14" rx="6" ry="3"/><ellipse cx="12" cy="18" rx="6" ry="3"/></svg>',
};

const POWERUP_UPGRADES = {
  shield: {
    name: 'SHIELD', icon: SVG_ICONS.shield, color: '#00f0ff',
    tiers: [
      { desc: '10s duration, 1 hit' },
      { desc: '+50% duration, 1 hit' },
      { desc: 'Permanent, 1 hit' },
      { desc: 'Permanent, stacks 2 hits' },
      { desc: 'Permanent, stacks 3 hits' },
    ]
  },
  laser: {
    name: 'LASER', icon: SVG_ICONS.laser, color: '#ff2200',
    tiers: [
      { desc: 'Dual guns' },
      { desc: 'Dual guns, +25% duration' },
      { desc: '+50% duration, wider spread' },
      { desc: '+75% duration, unibeam' },
      { desc: '+100% duration, scanning unibeam' },
    ]
  },
  invincible: {
    name: 'OVERDRIVE', icon: SVG_ICONS.invincible, color: '#ffcc00',
    tiers: [
      { desc: 'Base duration' },
      { desc: '+20% duration' },
      { desc: '+50% duration' },
      { desc: '+80% duration' },
      { desc: '+100% duration, +50% grace' },
    ]
  },
  magnet: {
    name: 'MAGNET', icon: SVG_ICONS.magnet, color: '#44ff88',
    tiers: [
      { desc: 'Base duration & radius' },
      { desc: '+25% duration, +15% radius' },
      { desc: '+50% duration, +30% radius' },
      { desc: '+75% duration, +50% radius' },
      { desc: '+100% duration, +75% radius, pulls powerups' },
    ]
  },
  coinvalue: {
    name: 'COIN VALUE', icon: SVG_ICONS.coinvalue, color: '#ffaa00',
    levelGate: 3,
    maxTier: 3,
    tiers: [
      { desc: '2x at L3, 3x at L4' },
      { desc: '2x at L2, 3x at L4' },
      { desc: '2x at L2, 3x at L3' },
    ]
  },
};

const STAT_UPGRADES = {
  spawnrate: {
    name: 'Pickup Spawn Rate',
    tiers: ['10% more', '15% more', '20% more', '25% more', '30% more'],
    costs: [1500, 3000, 6000, 12000, 20000],
  },
  powermeter: {
    name: 'Power Meter Speed',
    levelGate: 5,
    tiers: ['10% faster', '15%', '20%', '25%', '30%'],
    costs: [1500, 3000, 6000, 12000, 20000],
  },
  saveme: {
    name: 'Repair Discount',
    tiers: ['20% off', '35% off', '50% off', '65% off', '75% off'],
    costs: [2000, 4000, 8000, 15000, 25000],
  },
  scoremult: {
    name: 'Score Multiplier',
    levelGate: 15,
    tiers: ['+1x', '+2x', '+3x', '+4x', '+5x'],
    costs: [3000, 6000, 12000, 20000, 35000],
  },
};

function loadUpgradeTier(id) {
  return parseInt(window._LS.getItem(UPGRADE_STORAGE_PREFIX + id) || '1', 10);
}
function saveUpgradeTier(id, tier) {
  window._LS.setItem(UPGRADE_STORAGE_PREFIX + id, String(tier));
}

function getUpgradeCost(id, currentTier) {
  if (STAT_UPGRADES[id]) {
    const idx = currentTier - 1;
    return STAT_UPGRADES[id].costs[idx] || null;
  }
  return UPGRADE_COSTS[currentTier] || null;
}

function purchaseUpgrade(id) {
  const tier = loadUpgradeTier(id);
  const maxTier = (POWERUP_UPGRADES[id] && POWERUP_UPGRADES[id].maxTier) || 5;
  if (tier >= maxTier) return false;
  const cost = getUpgradeCost(id, tier);
  if (!cost) return false;
  const wallet = loadCoinWallet();
  if (wallet < cost) return false;
  saveCoinWallet(wallet - cost);
  _totalCoins = loadCoinWallet();
  saveUpgradeTier(id, tier + 1);
  updateTitleCoins();
  return true;
}

// ═══════════════════════════════════════════════════
//  MISSION LADDER SYSTEM
// ═══════════════════════════════════════════════════

const LADDER_POS_KEY = 'jetslide_ladder_pos';
const FUELCELL_KEY = 'jetslide_fuelcells';
const _FUEL_SVG = '<img src="assets/images/fuelcell-icon-new.png" class="fuelcell-icon" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;">';
const LIFETIME_STATS_KEY = 'jetslide_lifetime';

function loadLadderPos() { return parseInt(window._LS.getItem(LADDER_POS_KEY) || '0', 10); }
function saveLadderPos(n) { window._LS.setItem(LADDER_POS_KEY, String(n)); }
function loadMissionFlags() {
  try { return JSON.parse(window._LS.getItem('jetslide_mission_flags') || '{}'); }
  catch(e) { return {}; }
}
function saveMissionFlags(flags) {
  window._LS.setItem('jetslide_mission_flags', JSON.stringify(flags));
}
function loadFuelCells() { return parseInt(window._LS.getItem(FUELCELL_KEY) || '0', 10); }
function saveFuelCells(n) { window._LS.setItem(FUELCELL_KEY, String(n)); }

// ── HEAD START ──
const FREE_HS_KEY = 'jetslide_free_headstarts';
function loadFreeHeadStarts() { return parseInt(window._LS.getItem(FREE_HS_KEY) || '0', 10); }
function saveFreeHeadStarts(n) { window._LS.setItem(FREE_HS_KEY, String(Math.max(0, n))); }

const HEAD_START_BASE  = 100;  // fuel cells
const MEGA_START_BASE  = 250;
const HEAD_START_DISCOUNTS = [0, 0.10, 0.20, 0.35, 0.50, 0.70]; // tier 0-5

function getHeadStartCost(mega) {
  // Discount comes from mission ladder stat rewards
  const discount = getStatValue('headstart') || 0;
  const base = mega ? MEGA_START_BASE : HEAD_START_BASE;
  return Math.floor(base * (1 - discount));
}
function loadLifetimeStats() {
  const raw = window._LS.getItem(LIFETIME_STATS_KEY);
  return raw ? JSON.parse(raw) : { coins: 0, runs: 0, score: 0, powerups: 0 };
}
function saveLifetimeStats(s) { window._LS.setItem(LIFETIME_STATS_KEY, JSON.stringify(s)); }

function updateTitleFuelCells() {
  const el = document.getElementById('title-fuelcell-count');
  if (el) el.textContent = loadFuelCells().toLocaleString();
  const mel = document.getElementById('missions-fuel-count');
  if (mel) mel.textContent = loadFuelCells().toLocaleString();
}

const MISSION_LADDER = [
  { type:'mission', id:'score3k', desc:'Score 3,000+ in one run', check:(r)=>r.score>=3000 },
  { type:'mission', id:'coins25', desc:'Collect 25 coins in one run', check:(r)=>r.coins>=25 },
  { type:'reward', reward:{ kind:'fuelcells', amount:50, label:'50 Fuel Cells', xp:100 } },
  { type:'reward', reward:{ kind:'thrustercolor', colorKey:'red', label:'Unlock CRIMSON Thruster Color' } },
  { type:'mission', id:'runs5', desc:'Complete 5 runs', check:(r,lt)=>lt.runs>=5 },
  { type:'mission', id:'score7k', desc:'Score 7,000+ in one run', check:(r)=>r.score>=7000 },
  { type:'reward', reward:{ kind:'unlock', powerup:'laser', label:'Unlock LASER', coins:250 } },
  { type:'reward', reward:{ kind:'thruster', presetKey:'short', label:'Unlock SHORT Thruster' } },
  { type:'mission', id:'coins50', desc:'Collect 50 coins in one run', check:(r)=>r.coins>=50 },
  { type:'mission', id:'pu3', desc:'Collect 3 powerups in one run', check:(r)=>r.powerups>=3 },
  { type:'reward', reward:{ kind:'fuelcells', amount:75, label:'75 Fuel Cells', xp:150 } },
  { type:'reward', reward:{ kind:'thrustercolor', colorKey:'green', label:'Unlock TOXIC Thruster Color' } },
  { type:'mission', id:'score15k', desc:'Score 15,000+ in one run', check:(r)=>r.score>=15000 },
  { type:'mission', id:'coins100', desc:'Collect 100 coins in one run', check:(r)=>r.coins>=100 },
  { type:'reward', reward:{ kind:'stat', stat:'spawnrate', value:0.10, label:'Pickup Spawn +10%' } },
  { type:'mission', id:'shield2', desc:'Use shield 2 times in one run', check:(r)=>r.shields>=2 },
  { type:'mission', id:'drtier2', desc:'Reach speed tier 2 in DR', check:(r)=>r.isDR&&r.drTier>=2 },
  { type:'reward', reward:{ kind:'unlock', powerup:'invincible', label:'Unlock OVERDRIVE', fuelcells:100 } },
  { type:'reward', reward:{ kind:'thruster', presetKey:'light', label:'Unlock LIGHT Thruster' } },
  { type:'reward', reward:{ kind:'thrustercolor', colorKey:'cyan', label:'Unlock CYAN Thruster Color' } },
  { type:'mission', id:'runs15', desc:'Complete 15 runs', check:(r,lt)=>lt.runs>=15 },
  { type:'mission', id:'ltcoins500', desc:'Collect 500 total coins', check:(r,lt)=>lt.coins>=500 },
  { type:'reward', reward:{ kind:'coins', amount:500, label:'500 Coins', xp:200 } },
  { type:'reward', reward:{ kind:'thrustercolor', colorKey:'pink', label:'Unlock NEON PINK Thruster Color' } },
  { type:'mission', id:'score25k', desc:'Score 25,000+ in one run', check:(r)=>r.score>=25000 },
  { type:'mission', id:'pu5', desc:'Collect 5 powerups in one run', check:(r)=>r.powerups>=5 },
  { type:'reward', reward:{ kind:'stat', stat:'spawnrate', value:0.15, label:'Pickup Spawn +15%' } },
  { type:'mission', id:'laser3', desc:'Use laser 3 times in one run', check:(r)=>r.lasers>=3 },
  { type:'mission', id:'coins150', desc:'Collect 150 coins in one run', check:(r)=>r.coins>=150 },
  { type:'reward', reward:{ kind:'unlock', powerup:'magnet', label:'Unlock MAGNET', fuelcells:150 } },
  { type:'reward', reward:{ kind:'thruster', presetKey:'fatIon', label:'Unlock FAT ION Thruster' } },
  { type:'reward', reward:{ kind:'thrustercolor', colorKey:'orange', label:'Unlock EMBER Thruster Color' } },
  { type:'mission', id:'ltcoins2k', desc:'Collect 2,000 total coins', check:(r,lt)=>lt.coins>=2000 },
  { type:'mission', id:'runs30', desc:'Complete 30 runs', check:(r,lt)=>lt.runs>=30 },
  { type:'reward', reward:{ kind:'stat', stat:'scoremult', value:1, label:'Score Mult +1x' } },
  { type:'mission', id:'score40k', desc:'Score 40,000+ in one run', check:(r)=>r.score>=40000 },
  { type:'mission', id:'drtier3', desc:'Reach speed tier 3 in DR', check:(r)=>r.isDR&&r.drTier>=3 },
  { type:'reward', reward:{ kind:'fuelcells', amount:200, label:'200 Fuel Cells', xp:250 } },
  { type:'reward', reward:{ kind:'thrustercolor', colorKey:'gold', label:'Unlock SOLAR GOLD Thruster Color' } },
  { type:'mission', id:'invinc2', desc:'Use invincible 2 times in one run', check:(r)=>r.invincibles>=2 },
  { type:'mission', id:'coins200', desc:'Collect 200 coins in one run', check:(r)=>r.coins>=200 },
  { type:'reward', reward:{ kind:'coins', amount:1000, label:'1,000 Coins', xp:300 } },
  { type:'mission', id:'pu8', desc:'Collect 8 powerups in one run', check:(r)=>r.powerups>=8 },
  { type:'mission', id:'score60k', desc:'Score 60,000+ in one run', check:(r)=>r.score>=60000 },
  { type:'reward', reward:{ kind:'stat', stat:'spawnrate', value:0.20, label:'Pickup Spawn +20%' } },
  { type:'mission', id:'runs50', desc:'Complete 50 runs', check:(r,lt)=>lt.runs>=50 },
  { type:'mission', id:'drcoins100', desc:'Collect 100 coins in one DR', check:(r)=>r.isDR&&r.coins>=100 },
  { type:'reward', reward:{ kind:'fuelcells', amount:250, label:'250 Fuel Cells', xp:350 } },
  { type:'mission', id:'shield4', desc:'Use shield 4 times in one run', check:(r)=>r.shields>=4 },
  { type:'mission', id:'ltcoins5k', desc:'Collect 5,000 total coins', check:(r,lt)=>lt.coins>=5000 },
  { type:'reward', reward:{ kind:'stat', stat:'scoremult', value:2, label:'Score Mult +2x' } },
  { type:'reward', reward:{ kind:'unlock', powerup:'powermeter', label:'Unlock POWER METER', fuelcells:200 } },
  { type:'mission', id:'score80k', desc:'Score 80,000+ in one run', check:(r)=>r.score>=80000 },
  { type:'mission', id:'drtier4', desc:'Reach speed tier 4 in DR', check:(r)=>r.isDR&&r.drTier>=4 },
  { type:'reward', reward:{ kind:'fuelcells', amount:300, label:'300 Fuel Cells', coins:1500, xp:400 } },
  { type:'reward', reward:{ kind:'thrustercolor', colorKey:'violet', label:'Unlock VIOLET Thruster Color' } },
  { type:'mission', id:'coins300', desc:'Collect 300 coins in one run', check:(r)=>r.coins>=300 },
  { type:'mission', id:'pu12', desc:'Collect 12 powerups in one run', check:(r)=>r.powerups>=12 },
  { type:'reward', reward:{ kind:'stat', stat:'spawnrate', value:0.25, label:'Pickup Spawn +25%' } },
  { type:'mission', id:'score100k', desc:'Score 100,000+ in one run', check:(r)=>r.score>=100000 },
  { type:'mission', id:'drcoins200', desc:'Collect 200 coins in one DR', check:(r)=>r.isDR&&r.coins>=200 },
  { type:'reward', reward:{ kind:'fuelcells', amount:400, label:'400 Fuel Cells', xp:450 } },
  { type:'reward', reward:{ kind:'thrustercolor', colorKey:'white', label:'Unlock WHITE HOT Thruster Color' } },
  { type:'mission', id:'runs75', desc:'Complete 75 runs', check:(r,lt)=>lt.runs>=75 },
  { type:'mission', id:'ltcoins10k', desc:'Collect 10,000 total coins', check:(r,lt)=>lt.coins>=10000 },
  { type:'reward', reward:{ kind:'stat', stat:'scoremult', value:3, label:'Score Mult +3x' } },
  { type:'mission', id:'score150k', desc:'Score 150,000+ in one run', check:(r)=>r.score>=150000 },
  { type:'mission', id:'drtier5', desc:'Reach speed tier 5 in DR', check:(r)=>r.isDR&&r.drTier>=5 },
  { type:'reward', reward:{ kind:'fuelcells', amount:500, label:'500 Fuel Cells', coins:2000, xp:500 } },
  { type:'mission', id:'coins500', desc:'Collect 500 coins in one run', check:(r)=>r.coins>=500 },
  { type:'mission', id:'runs100', desc:'Complete 100 runs', check:(r,lt)=>lt.runs>=100 },
  { type:'reward', reward:{ kind:'stat', stat:'spawnrate', value:0.30, label:'Pickup Spawn +30%' } },
  { type:'mission', id:'drcoins300', desc:'Collect 300 coins in one DR', check:(r)=>r.isDR&&r.coins>=300 },
  { type:'mission', id:'score250k', desc:'Score 250,000+ in one run', check:(r)=>r.score>=250000 },
  { type:'reward', reward:{ kind:'stat', stat:'scoremult', value:4, label:'Score Mult +4x', fuelcells:600 } },
  { type:'mission', id:'ltcoins25k', desc:'Collect 25,000 total coins', check:(r,lt)=>lt.coins>=25000 },
  { type:'mission', id:'ltscore500k', desc:'Score 500,000 total points', check:(r,lt)=>lt.score>=500000 },
  { type:'reward', reward:{ kind:'stat', stat:'scoremult', value:5, label:'Score Mult +5x', coins:3000 } },
];

const REWARD_COLORS = { fuelcells:'#4488ff', coins:'#ffcc00', stat:'#00eeff', unlock:'#44ff88', thruster:'#ff66bb', thrustercolor:'#ff66bb' };

// ═══════════════════════════════════════════════════
//  BANNER TOAST SYSTEM
// ═══════════════════════════════════════════════════
const _bannerQueue = [];
let _bannerActive = 0; // how many banners currently visible
const MAX_BANNERS = 3;

/**
 * Show a banner toast at the top of the screen.
 * @param {string} text - Banner text
 * @param {string} type - 'mission' | 'levelup' | 'handling' | 'headstart' | 'xp'
 * @param {number} [holdMs=2000] - How long to show (ms)
 */
function showBanner(text, type, holdMs) {
  holdMs = holdMs || 2000;
  const container = document.getElementById('banner-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'game-banner banner-' + type;
  el.textContent = text;
  container.appendChild(el);

  // Trigger slide-in on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('banner-in'));
  });

  // Auto-dismiss
  setTimeout(() => {
    el.classList.remove('banner-in');
    el.classList.add('banner-out');
    setTimeout(() => el.remove(), 350);
  }, holdMs);
}

function getStatValue(statId) {
  const pos = loadLadderPos();
  let val = 0;
  for (let i = 0; i < pos && i < MISSION_LADDER.length; i++) {
    const rung = MISSION_LADDER[i];
    if (rung.type === 'reward' && rung.reward.kind === 'stat' && rung.reward.stat === statId) {
      val = rung.reward.value;
    }
  }
  return val;
}

function isPowerupUnlocked(puId) {
  if (puId === 'shield') return true;
  const unlocked = JSON.parse(window._LS.getItem('jetslide_pu_unlocked') || '["shield"]');
  return unlocked.includes(puId);
}

function applyReward(r) {
  if (r.kind === 'fuelcells' || r.fuelcells) {
    const amt = (r.kind === 'fuelcells' ? r.amount : 0) + (r.fuelcells || 0);
    saveFuelCells(loadFuelCells() + amt);
  }
  if (r.kind === 'coins' || r.coins) {
    const amt = (r.kind === 'coins' ? r.amount : 0) + (r.coins || 0);
    saveCoinWallet(loadCoinWallet() + amt);
    _totalCoins = loadCoinWallet();
    updateTitleCoins();
  }
  if (r.kind === 'unlock') {
    const unlocked = JSON.parse(window._LS.getItem('jetslide_pu_unlocked') || '["shield"]');
    if (!unlocked.includes(r.powerup)) unlocked.push(r.powerup);
    window._LS.setItem('jetslide_pu_unlocked', JSON.stringify(unlocked));
    if (r.fuelcells) saveFuelCells(loadFuelCells() + r.fuelcells);
    if (r.coins) { saveCoinWallet(loadCoinWallet() + r.coins); _totalCoins = loadCoinWallet(); updateTitleCoins(); }
  }
  // Thruster preset cosmetic unlock (e.g. 'short', 'light', 'fatIon').
  if (r.kind === 'thruster' && r.presetKey) {
    const td = loadThrusterData();
    let dirty = false;
    if (!td.unlockedPresets.includes(r.presetKey)) {
      td.unlockedPresets.push(r.presetKey);
      dirty = true;
    }
    // Always flag as freshly-unlocked on a thruster reward, even if a prior
    // partial save already had it in unlockedPresets. Garage clears the flag
    // on first click so it can't get stuck.
    if (!Array.isArray(td.newPresets)) td.newPresets = [];
    if (r.presetKey !== td.selectedPreset && !td.newPresets.includes(r.presetKey)) {
      td.newPresets.push(r.presetKey);
      dirty = true;
    }
    if (dirty) saveThrusterData(td);
  }
  // Thruster color cosmetic unlock (e.g. 'red', 'green', 'gold').
  if (r.kind === 'thrustercolor' && r.colorKey) {
    const td = loadThrusterData();
    let dirty = false;
    if (!td.unlockedColors.includes(r.colorKey)) {
      td.unlockedColors.push(r.colorKey);
      dirty = true;
    }
    if (!Array.isArray(td.newColors)) td.newColors = [];
    if (r.colorKey !== td.selectedColor && !td.newColors.includes(r.colorKey)) {
      td.newColors.push(r.colorKey);
      dirty = true;
    }
    if (dirty) saveThrusterData(td);
  }
  // stat rewards: value is derived from ladder position, no separate storage
  // XP bonus (added to current XP pool)
  if (r.xp) {
    const curXP = loadPlayerXP();
    let lvl = loadPlayerLevel();
    let xp = curXP + r.xp;
    while (xp >= xpForLevel(lvl)) {
      xp -= xpForLevel(lvl);
      lvl++;
    }
    savePlayerLevel(lvl);
    savePlayerXP(xp);
    updateTitleLevel();
  }
}

function checkLadder(runStats, lifetime) {
  let pos = loadLadderPos();
  const startPos = pos;
  const completedMissions = [];
  const flags = loadMissionFlags();

  // Find current group: missions from pos up to next reward
  if (pos < MISSION_LADDER.length && MISSION_LADDER[pos].type === 'mission') {
    let groupEnd = pos;
    while (groupEnd < MISSION_LADDER.length && MISSION_LADDER[groupEnd].type === 'mission') {
      groupEnd++;
    }
    // groupEnd now points to the reward rung (or end of array)

    // Check ALL missions in group independently
    for (let i = pos; i < groupEnd; i++) {
      const rung = MISSION_LADDER[i];
      if (flags[rung.id]) continue; // already completed in a previous run
      if (rung.check(runStats, lifetime)) {
        flags[rung.id] = true;
        completedMissions.push(rung);
      }
    }

    // Check if entire group is now complete
    let allComplete = true;
    for (let i = pos; i < groupEnd; i++) {
      if (!flags[MISSION_LADDER[i].id]) { allComplete = false; break; }
    }

    if (allComplete) {
      pos = groupEnd; // advance to the reward rung
    }

    saveMissionFlags(flags);
  }

  saveLadderPos(pos);
  updateTitleFuelCells();
  updateNotificationDots();
  return { advanced: pos > startPos, completedMissions, newPos: pos, startPos };
}

function showMissionToast(text) {
  const el = document.getElementById('mission-toast');
  if (!el) return;
  el.textContent = '\u2714 ' + text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ── Missions UI ──────────────────────────────────────────

let _missionsOpenedFromGameplay = false;

function playClickSFX() {
  playSFX(900, 0.06, 'square', 0.35);
  setTimeout(() => playSFX(1200, 0.04, 'square', 0.25), 30);
}

function openMissions() {
  initAudio();
  playTitleTap();
  const overlay = document.getElementById('missions-overlay');
  if (!overlay) return;
  // Pause if mid-game
  if (state.phase === 'playing') {
    _missionsOpenedFromGameplay = true;
    state.phase = 'paused';
    const _engP = document.getElementById('engine-start');
    const _roarP = document.getElementById('engine-roar');
    if (_engP && !_engP.paused) _engP.pause();
    if (_roarP && !_roarP.paused) _roarP.pause();
  } else {
    _missionsOpenedFromGameplay = false;
  }
  overlay.classList.remove('hidden');
  document.getElementById('missions-fuel-count').textContent = loadFuelCells().toLocaleString();
  renderLadder();
  updateNotificationDots();
}
window.openMissions = openMissions;

function closeMissions() {
  playTitleTap();
  const overlay = document.getElementById('missions-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  // Resume if we paused for missions
  if (_missionsOpenedFromGameplay && state.phase === 'paused') {
    state.phase = 'playing';
    _missionsOpenedFromGameplay = false;
    const _engP = document.getElementById('engine-start');
    const _roarP = document.getElementById('engine-roar');
    if (_engP && _engP.paused) _engP.play().catch(()=>{});
    if (_roarP && _roarP.paused) _roarP.play().catch(()=>{});
  }
}
window.closeMissions = closeMissions;


// ── SHIP HUB / SHOWROOM glue ─────────────────────────────────────────────
// V2: Showroom logic lives in src/48-showroom.js. These thin functions just
// delegate so all existing call-sites (▲ icon, claim flow, etc.) keep working.
let _thrusterPanelOpenedFromGameplay = false;

function openThrusterPanel(targetTab) {
  initAudio();
  try { playTitleTap(); } catch(_){}
  // Pause gameplay if mid-run (mirrors V1 behavior).
  if (state.phase === 'playing') {
    _thrusterPanelOpenedFromGameplay = true;
    state.phase = 'paused';
    const _engP = document.getElementById('engine-start');
    const _roarP = document.getElementById('engine-roar');
    if (_engP && !_engP.paused) _engP.pause();
    if (_roarP && !_roarP.paused) _roarP.pause();
  } else {
    _thrusterPanelOpenedFromGameplay = false;
  }
  // Clear NEW badge once seen.
  window._LS.removeItem('jetslide_thrusters_new');
  const dot = document.getElementById('title-thrusters-new-dot');
  if (dot) dot.style.display = 'none';
  // Delegate to showroom module if loaded; otherwise fall back to overlay-only.
  if (window.Showroom && typeof window.Showroom.open === 'function') {
    window.Showroom.open(targetTab || 'skins');
  } else {
    const overlay = document.getElementById('thruster-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }
}
window.openThrusterPanel = openThrusterPanel;

function closeThrusterPanel() {
  try { playTitleTap(); } catch(_){}
  if (window.Showroom && typeof window.Showroom.close === 'function') {
    window.Showroom.close();
  } else {
    const overlay = document.getElementById('thruster-overlay');
    if (overlay) overlay.classList.add('hidden');
  }
  if (_thrusterPanelOpenedFromGameplay && state.phase === 'paused') {
    state.phase = 'playing';
    _thrusterPanelOpenedFromGameplay = false;
    const _engP = document.getElementById('engine-start');
    const _roarP = document.getElementById('engine-roar');
    if (_engP && _engP.paused) _engP.play().catch(()=>{});
    if (_roarP && _roarP.paused) _roarP.play().catch(()=>{});
  }
}
window.closeThrusterPanel = closeThrusterPanel;

function hasClaimableReward() {
  const pos = loadLadderPos();
  return pos < MISSION_LADDER.length && MISSION_LADDER[pos].type === 'reward';
}

function hasNewShopUnlock() {
  // Check if any recently-passed reward was an unlock that the shop should highlight
  const flag = window._LS.getItem('jetslide_shop_new');
  return flag === '1';
}

function updateNotificationDots() {
  const mBtn = document.getElementById('missions-btn');
  const sBtn = document.getElementById('shop-btn');
  const shipLabel = document.getElementById('skin-viewer-label');
  const hudShopBtn = document.getElementById('hud-shop-btn');
  if (mBtn) mBtn.classList.toggle('has-dot', hasClaimableReward());
  if (sBtn) sBtn.classList.toggle('has-dot', hasNewShopUnlock());
  if (shipLabel) shipLabel.classList.toggle('has-dot', !!getPendingHandlingUpgrade());
  if (hudShopBtn) hudShopBtn.classList.toggle('has-dot', !state._shopOpened && _canAffordAnyShopItem());
  // Thruster panel NEW badge — set by claimReward when a thruster reward fires.
  const thrDot = document.getElementById('title-thrusters-new-dot');
  if (thrDot) thrDot.style.display = (window._LS.getItem('jetslide_thrusters_new') === '1') ? 'block' : 'none';
}

// ── Particle burst animation ──────────────────────────────
function spawnRewardParticles(originEl, destSelector, color, icon, count) {
  const originRect = originEl.getBoundingClientRect();
  const destEl = document.querySelector(destSelector);
  const destRect = destEl ? destEl.getBoundingClientRect() : { left: window.innerWidth / 2, top: 0, width: 40, height: 40 };

  const ox = originRect.left + originRect.width / 2;
  const oy = originRect.top + originRect.height / 2;
  const dx = destRect.left + destRect.width / 2;
  const dy = destRect.top + destRect.height / 2;

  for (let p = 0; p < count; p++) {
    const el = document.createElement('div');
    el.className = 'reward-particle';
    el.textContent = icon;
    el.style.color = color;
    el.style.left = ox + 'px';
    el.style.top = oy + 'px';
    document.body.appendChild(el);

    // Random spread from origin
    const spreadX = (Math.random() - 0.5) * 120;
    const spreadY = (Math.random() - 0.5) * 80;
    const delay = p * 40;

    // Phase 1: burst outward
    setTimeout(() => {
      el.style.transition = 'left 0.25s ease-out, top 0.25s ease-out, opacity 0.1s';
      el.style.left = (ox + spreadX) + 'px';
      el.style.top = (oy + spreadY) + 'px';
      el.style.opacity = '1';
    }, delay);

    // Phase 2: fly to destination
    setTimeout(() => {
      el.style.transition = 'left 0.45s cubic-bezier(0.4,0,0.2,1), top 0.45s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease 0.2s, transform 0.45s ease';
      el.style.left = dx + 'px';
      el.style.top = dy + 'px';
      el.style.transform = 'scale(0.4)';
      el.style.opacity = '0';
    }, delay + 280);

    // Cleanup
    setTimeout(() => el.remove(), delay + 800);
  }

  // Bump destination counter
  if (destEl) {
    setTimeout(() => {
      destEl.classList.add('counter-bump');
      setTimeout(() => destEl.classList.remove('counter-bump'), 300);
    }, count * 40 + 400);
  }
}

// ── Reward claim SFX ──────────────────────────────
function playRewardSFX() {
  playSFX(500, 0.25, 'sine', 0.12);
  setTimeout(() => playSFX(700, 0.2, 'sine', 0.12), 80);
  setTimeout(() => playSFX(1000, 0.15, 'sine', 0.15), 180);
}

function claimReward(rungIndex, clickEvent) {
  const rung = MISSION_LADDER[rungIndex];
  if (!rung || rung.type !== 'reward') return;
  const r = rung.reward;

  // Determine particle params
  let color, icon, dest, count;
  if (r.kind === 'fuelcells') {
    color = '#4488ff'; icon = '\u26A1'; dest = '#missions-fuel-count'; count = Math.min(r.amount / 5, 25) | 0 || 15;
  } else if (r.kind === 'coins') {
    color = '#ffcc00'; icon = '\u2B21'; dest = '#title-coin-count'; count = Math.min(r.amount / 25, 25) | 0 || 15;
  } else if (r.kind === 'unlock') {
    color = REWARD_COLORS.unlock; icon = '\uD83D\uDD13'; dest = '#shop-btn'; count = 20;
    window._LS.setItem('jetslide_shop_new', '1'); // flag for shop NEW badge
  } else if (r.kind === 'stat') {
    color = '#00eeff'; icon = '\u2605'; dest = '#missions-fuel-count'; count = 14;
  } else if (r.kind === 'thruster' || r.kind === 'thrustercolor') {
    color = REWARD_COLORS.thruster; icon = '\u25B2'; dest = '#title-thrusters-btn'; count = 18;
    window._LS.setItem('jetslide_thrusters_new', '1'); // flag for thruster panel NEW badge
  } else {
    color = '#fff'; icon = '\u2B50'; dest = '#missions-fuel-count'; count = 14;
  }

  // Find the clicked element for origin
  const originEl = clickEvent ? clickEvent.currentTarget : document.querySelector('.ladder-rung.reward.claimable');
  if (originEl) spawnRewardParticles(originEl, dest, color, icon, count);

  // Apply the reward
  applyReward(r);
  playRewardSFX();

  // ~20% chance of bonus free head start
  if (Math.random() < 0.20) {
    saveFreeHeadStarts(loadFreeHeadStarts() + 1);
    // Show bonus pop
    setTimeout(() => {
      const pop = document.createElement('div');
      pop.className = 'hs-bonus-pop';
      pop.textContent = '+1 HEAD START!';
      if (originEl) {
        const rect = originEl.getBoundingClientRect();
        pop.style.left = rect.left + rect.width / 2 + 'px';
        pop.style.top = rect.top - 10 + 'px';
      } else {
        pop.style.left = '50%'; pop.style.top = '40%';
      }
      document.body.appendChild(pop);
      requestAnimationFrame(() => pop.classList.add('show'));
      setTimeout(() => { pop.classList.add('fade'); setTimeout(() => pop.remove(), 600); }, 1800);
    }, 600);
  }

  // Advance ladder past this reward
  const pos = loadLadderPos();
  saveLadderPos(pos + 1);
  saveMissionFlags({}); // clear flags for new group

  // Update UI
  setTimeout(() => {
    updateTitleFuelCells();
    updateTitleCoins();
    document.getElementById('missions-fuel-count').textContent = loadFuelCells().toLocaleString();
    updateNotificationDots();
    renderLadder();
  }, 500);
}

function renderLadder() {
  const container = document.getElementById('missions-ladder');
  if (!container) return;
  const pos = loadLadderPos();
  // Find the next reward after current pos — show everything up to and including it
  let visibleEnd = pos;
  for (let j = pos; j < MISSION_LADDER.length; j++) {
    visibleEnd = j;
    if (MISSION_LADDER[j].type === 'reward' && j > pos) break;
  }

  const flags = loadMissionFlags();
  container.innerHTML = MISSION_LADDER.map((rung, i) => {
    // Hide rungs beyond the next reward
    if (i > visibleEnd) return '';

    if (rung.type === 'mission') {
      const completed = i < pos || flags[rung.id];
      const current = !completed && i >= pos && i <= visibleEnd;
      const cls = completed ? 'completed' : current ? 'current' : 'locked';
      return `<div class="ladder-rung mission ${cls}">${rung.desc}</div>`;
    } else {
      // reward
      const earned = i < pos;
      const claimable = (i === pos); // ladder stopped here, player must tap
      const isNext = !earned && !claimable && (i > 0 && MISSION_LADDER[i - 1].type === 'mission' && i - 1 === pos);
      const cls = earned ? 'earned' : claimable ? 'claimable' : isNext ? 'next' : 'locked';
      const color = REWARD_COLORS[rung.reward.kind] || '#fff';
      const icon = rung.reward.kind === 'fuelcells' ? _FUEL_SVG : rung.reward.kind === 'coins' ? '\u2B21' : rung.reward.kind === 'unlock' ? '\uD83D\uDD13' : (rung.reward.kind === 'thruster' || rung.reward.kind === 'thrustercolor') ? '\u25B2' : '\u2605';
      return `<div class="ladder-rung reward ${cls}" data-rung="${i}" style="--reward-color:${color}">
        ${icon} ${rung.reward.label}
        ${claimable ? '<span class="claim-tap">TAP TO COLLECT</span>' : ''}
      </div>`;
    }
  }).join('');

  // Attach click handlers to claimable rewards
  container.querySelectorAll('.ladder-rung.reward.claimable').forEach(el => {
    _tapBind(el, (e) => {
      const idx = parseInt(el.dataset.rung, 10);
      claimReward(idx, e);
    });
  });

  // Auto-scroll to current mission or claimable reward
  const scrollTarget = container.querySelector('.ladder-rung.claimable') || container.querySelector('.ladder-rung.current');
  if (scrollTarget) {
    setTimeout(() => scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }
}

// ═══════════════════════════════════════════════════
//  RENDERER, SCENE, CAMERA
// ═══════════════════════════════════════════════════
// ── PERFORMANCE MODE STATE ────────────────────────────────
let perfMode = false;
const perfToggleBtn = document.getElementById('perf-toggle');
_tapBind(perfToggleBtn, (e) => {
  try { e.stopPropagation(); } catch (_) {}
  perfMode = !perfMode;
  perfToggleBtn.classList.toggle('on', perfMode);
  perfToggleBtn.setAttribute('aria-pressed', perfMode);
  applyPerfMode();
});
// applyPerfMode defined after bloom + reflectRT are created (below)
// ────────────────────────────────────────────────────────────

const canvas   = document.getElementById('game-canvas');
const _mobAA = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1);
// Expose for cross-file mobile gating (perf-diag, etc.)
window._isMobile = _mobAA;

// ── Initial DPR resolution (graphics quality setting lives in 65-settings.js,
// loaded after this file). Read the saved setting directly from localStorage so
// the renderer boots at the correct DPR on first frame. Default 'balanced' (1.5).
function _bootDPR() {
  const native = window.devicePixelRatio || 1;
  let q = 'balanced';
  try {
    const raw = (window._LS || localStorage).getItem('jh_settings');
    if (raw) { const s = JSON.parse(raw); if (s && s.graphicsQuality) q = s.graphicsQuality; }
  } catch(e) {}
  if (q === 'performance') return 1.0;
  if (q === 'sharp')       return Math.min(native, 3);
  return Math.min(native, 1.5); // balanced (default)
}
const _initialDPR = _bootDPR();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !_mobAA, powerPreference: 'high-performance' });
renderer.setPixelRatio(_initialDPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = false;

const scene  = new THREE.Scene();

// ── Milky Way panorama sky — full-screen NDC quad above stars, below sun ──
// Uses same NDC passthrough as star shader so it fills the screen independent of camera
const _skyQuadGeo = new THREE.PlaneGeometry(2, 2);
const _skyPanoTex = new THREE.TextureLoader().load('assets/images/milkyway-pano.jpg', () => {
  if (window.__loadGate) window.__loadGate.setStatus('SKYBOX', 30);
});
_skyPanoTex.colorSpace = THREE.SRGBColorSpace;
// Mobile anisotropy clamp — GPU max can be wasteful (e.g. 16x). 4x is plenty for skybox.
try { if (typeof _mobAA !== 'undefined' && _mobAA) _skyPanoTex.anisotropy = 4; } catch(e) {}
// Track skybox load for boot gate
if (window.__loadGate) {
  window.__loadGate.add('skybox', new Promise(res => {
    if (_skyPanoTex.image && _skyPanoTex.image.complete) return res();
    const iv = setInterval(() => {
      if (_skyPanoTex.image && _skyPanoTex.image.complete) { clearInterval(iv); res(); }
    }, 50);
    setTimeout(() => { clearInterval(iv); res(); }, 8000); // hard timeout safety
  }));
}
const _skyQuadMat = new THREE.ShaderMaterial({
  uniforms: {
    uTex:        { value: _skyPanoTex },
    uBrightness: { value: 5.0 },
    uTintR:      { value: 0.56 },
    uTintG:      { value: 1.0 },
    uTintB:      { value: 1.0 },
    uOffsetY:    { value: -0.06 },
    uSunFadeR:   { value: 0.0 },
    uSunFadeSoft: { value: 0.3 },
    uSunFadeX:   { value: 0.5 },
    uSunFadeY:   { value: 0.25 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.999, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D uTex;
    uniform float uBrightness;
    uniform float uTintR;
    uniform float uTintG;
    uniform float uTintB;
    uniform float uOffsetY;
    uniform float uSunFadeR;
    uniform float uSunFadeSoft;
    uniform float uSunFadeX;
    uniform float uSunFadeY;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      uv.y = clamp(uv.y + uOffsetY, 0.0, 1.0);
      vec3 col = texture2D(uTex, uv).rgb;
      col *= uBrightness;
      col *= vec3(uTintR, uTintG, uTintB);
      // Optional circular fade around sun area
      if (uSunFadeR > 0.0) {
        float dist = length(vUv - vec2(uSunFadeX, uSunFadeY));
        float fade = smoothstep(uSunFadeR - uSunFadeSoft, uSunFadeR, dist);
        col *= fade;
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
  depthWrite: false, depthTest: false,
  transparent: false,
});
const _skyQuad = new THREE.Mesh(_skyQuadGeo, _skyQuadMat);
_skyQuad.frustumCulled = false;
_skyQuad.renderOrder = -5;  // above stars (-9), below sun (0)
_skyQuad.layers.set(0);     // visible to main camera only
scene.add(_skyQuad);
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 600);

// ── TITLE SCENE (completely separate from gameplay) ─────────────────
const titleScene = new THREE.Scene();
const titleCamera = new THREE.PerspectiveCamera(35, 200/180, 0.1, 100);
titleCamera.position.set(0, 0.35, 3.4);
titleCamera.lookAt(0, -0.05, 0);

// Small dedicated canvas + renderer for title ship preview
const _titleCanvas = document.createElement('canvas');
_titleCanvas.id = 'title-ship-canvas';
_titleCanvas.style.transform = 'translate(-1px, -14px)';
const _titleRenderer = new THREE.WebGLRenderer({ canvas: _titleCanvas, antialias: true, alpha: true });
_titleRenderer.setPixelRatio(_initialDPR);
_titleRenderer.toneMapping = THREE.ACESFilmicToneMapping;
_titleRenderer.toneMappingExposure = 1.6;
// Insert into skin-viewer after DOM ready
function _mountTitleCanvas() {
  const showcase = document.querySelector('.ship-showcase-center');
  if (!showcase) return;
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = 200, h = 180;
  _titleCanvas.style.width = w + 'px';
  _titleCanvas.style.height = h + 'px';
  _titleRenderer.setSize(w * dpr, h * dpr);
  titleCamera.aspect = w / h;
  titleCamera.updateProjectionMatrix();
  _titleCanvas.style.cursor = 'pointer';
  _tapBind(_titleCanvas, () => { if (typeof openThrusterPanel === 'function') openThrusterPanel('skins'); });
  showcase.appendChild(_titleCanvas);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _mountTitleCanvas);
} else {
  _mountTitleCanvas();
}

// ── TITLE SCREEN STARFIELD ──────────────────────────────
(function initTitleStars() {
  const cv = document.getElementById('title-star-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let dpr = Math.min(window.devicePixelRatio, 2);

  // Seeded deterministic random so stars stay consistent
  let _s = 7;
  function rng() { _s = (_s * 1664525 + 1013904223) & 0xffffffff; return (_s >>> 0) / 0xffffffff; }

  // Box-Muller gaussian using seeded rng
  function gaussRng() {
    let u, v;
    do { u = rng(); } while (u === 0);
    do { v = rng(); } while (v === 0);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Generate star data once
  const STAR_COUNT = 320;
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: rng(),           // 0-1 normalised
      y: rng(),
      r: 0.3 + rng() * 1.0,  // radius px (before dpr)
      a: 0.3 + rng() * 0.7,  // base alpha
      twinkleSpeed: 0.5 + rng() * 2.0,
      twinklePhase: rng() * Math.PI * 2,
    });
  }
  // A few brighter stars
  for (let i = 0; i < 20; i++) {
    stars.push({
      x: rng(), y: rng(),
      r: 1.0 + rng() * 1.2,
      a: 0.7 + rng() * 0.3,
      twinkleSpeed: 0.3 + rng() * 1.0,
      twinklePhase: rng() * Math.PI * 2,
    });
  }
  // Milky Way band — 1500 stars biased along a diagonal arc
  for (let i = 0; i < 1500; i++) {
    const x = rng();
    const yCenter = 0.12 + x * 0.28;
    const y = yCenter + gaussRng() * 0.09;
    stars.push({
      x,
      y: Math.max(0, Math.min(1, y)),
      r: 0.3 + rng() * 0.7,
      a: 0.35 + rng() * 0.45,
      twinkleSpeed: 0.4 + rng() * 1.5,
      twinklePhase: rng() * Math.PI * 2,
    });
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio, 2);
    cv.width  = cv.clientWidth  * dpr;
    cv.height = cv.clientHeight * dpr;
  }

  let rafId = null;
  function draw(t) {
    rafId = requestAnimationFrame(draw);
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const ts = t * 0.001; // seconds
    for (const s of stars) {
      const flicker = 0.6 + 0.4 * Math.sin(ts * s.twinkleSpeed + s.twinklePhase);
      const alpha = s.a * flicker;
      const px = s.x * w;
      const py = s.y * h;
      const pr = s.r * dpr;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
      // Glow on brighter stars
      if (s.r > 1.0) {
        ctx.globalAlpha = alpha * 0.15;
        ctx.beginPath();
        ctx.arc(px, py, pr * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Start/stop based on title screen visibility
  function start() { if (!rafId) { resize(); rafId = requestAnimationFrame(draw); } }
  function stop()  { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

  // Observe title screen hidden class
  const titleEl = document.getElementById('title-screen');
  if (titleEl) {
    const obs = new MutationObserver(() => {
      if (titleEl.classList.contains('hidden')) stop(); else start();
    });
    obs.observe(titleEl, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('resize', resize);
  start();
})();

camera.layers.enable(1);  // render ship edge lines (layer 1) without bloom
camera.layers.enable(3);  // render sky stars (layer 3) — excluded from Water reflection camera

// Camera rig: pivot moves through world, camera child handles roll.
// camera.position stays (0,0,0) — pivot carries world position.
const cameraPivot = new THREE.Object3D();
cameraPivot.position.set(0, 2.8, 9);
scene.add(cameraPivot);
cameraPivot.add(camera);
camera.position.set(0, 0, 0);
// Aim camera: look toward (0, -2.0, -50) in pivot-local space (offset applied on game start)
camera.lookAt(new THREE.Vector3(0, -7.8, -19.5)); // baked: -2.8 + lookY(-5.0), -50 + lookZ(30.5)
let cameraRoll = 0;  // smoothed roll angle (radians)

// Camera tracks ship X with lag
let camTargetX = 0;

// ═══════════════════════════════════════════════════
//  POST-PROCESSING
// ═══════════════════════════════════════════════════
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// Bloom resolution: /2 on both desktop and mobile. Previously /3 on mobile,
// but that left the sun corona/atmosphere glow visibly blurry — bloom IS the
// look for a hero element like the sun. Cost: ~0.3–0.5 ms/frame on mobile,
// well within budget after this session's draw-call + alloc savings.
const _BLOOM_DIV = 2;
const bloom = new UnrealBloomPass(
  new THREE.Vector2(Math.floor(window.innerWidth / _BLOOM_DIV), Math.floor(window.innerHeight / _BLOOM_DIV)),
  0.35,  // strength — subtle, not overpowering
  0.25,  // radius — tight so glow hugs the source
  1.0    // threshold — only HDR emissives bloom (shield uses toneMapped:false)
);
composer.addPass(bloom);

// ── LOCALIZED HEAT HAZE (thruster exhaust distortion) — opt-in per skin via window._coneThrustersEnabled ──
const _thrusterHazeShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uNozzleL:   { value: new THREE.Vector2(0.5, 0.5) },
    uNozzleR:   { value: new THREE.Vector2(0.5, 0.5) },
    uTime:      { value: 0.0 },
    uIntensity: { value: 0.0 },   // 0 = off, ~0.6-1.0 = visible
    uRadius:    { value: 0.02 },
    uHazeDir:   { value: 0.6 },
    uAspect:    { value: 1.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uNozzleL;
    uniform vec2 uNozzleR;
    uniform float uTime;
    uniform float uIntensity;
    uniform float uRadius;
    uniform float uHazeDir;
    uniform float uAspect;
    varying vec2 vUv;

    float hazeField(vec2 uv, vec2 nozzle) {
      vec2 d = uv - nozzle;
      d.x *= uAspect;
      // Offset haze in the direction set by slider
      d.y += uHazeDir * uRadius * 0.8;
      d.y *= 0.7;
      float dist = length(d);
      return smoothstep(uRadius, uRadius * 0.2, dist);
    }

    void main() {
      if (uIntensity < 0.001) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      float haze = max(hazeField(vUv, uNozzleL), hazeField(vUv, uNozzleR));
      float strength = haze * uIntensity;
      // Animated sine distortion — two frequencies for richness
      vec2 offset = vec2(
        sin(vUv.y * 40.0 + uTime * 4.0) * 0.004 + sin(vUv.y * 80.0 + uTime * 7.0) * 0.002,
        cos(vUv.x * 35.0 + uTime * 3.5) * 0.003 + cos(vUv.x * 70.0 + uTime * 6.0) * 0.0015
      ) * strength;
      gl_FragColor = texture2D(tDiffuse, vUv + offset);
    }
  `,
};
const _thrusterHazePass = new ShaderPass(_thrusterHazeShader);
_thrusterHazePass.enabled = false;  // enabled per-frame only when _coneThrustersEnabled
composer.addPass(_thrusterHazePass);

// ── RADIAL BLUR (speed streaks) — only active during wormhole
const RadialBlurShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uIntensity:  { value: 0.0 },
    uSamples:    { value: 12 },
    uLength:     { value: 0.3 },
    uFalloff:    { value: 0.5 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform int uSamples;
    uniform float uLength;
    uniform float uFalloff;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity < 0.001) { gl_FragColor = base; return; }
      vec2 dir = vUv - vec2(0.5);
      float dist = length(dir);
      // Center fade: less blur near center
      float mask = smoothstep(0.0, uFalloff, dist);
      vec4 sum = base;
      float total = 1.0;
      for (int i = 1; i < 24; i++) {
        if (i >= uSamples) break;
        float t = float(i) / float(uSamples);
        vec2 offset = dir * t * uLength;
        sum += texture2D(tDiffuse, vUv - offset);
        total += 1.0;
      }
      vec4 blurred = sum / total;
      gl_FragColor = mix(base, blurred, mask * uIntensity);
    }
  `,
};
const _radialBlurPass = new ShaderPass(RadialBlurShader);
_radialBlurPass.enabled = false; // only during wormhole
composer.addPass(_radialBlurPass);

// ── PERFORMANCE MODE — defined here so bloom + renderer are in scope
function applyPerfMode() {
  if (perfMode) {
    renderer.setPixelRatio(1);
    bloom.resolution.set(
      Math.floor(window.innerWidth  * 0.5),
      Math.floor(window.innerHeight * 0.5)
    );
  } else {
    // Use the user's selected graphics quality DPR (defined in 65-settings.js).
    // Fallback to balanced default (1.5) if helper not yet loaded.
    const dpr = (typeof window._targetDPR === 'function') ? window._targetDPR() : Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    bloom.resolution.set(Math.floor(window.innerWidth / _BLOOM_DIV), Math.floor(window.innerHeight / _BLOOM_DIV));
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}
// ───────────────────────────────────────────────

// Vignette + chromatic aberration shader
const vignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset:   { value: 0.55 },
    darkness: { value: 0.5 },     // lighter vignette
    aberration: { value: _mobAA ? 0.0 : 0.0015 }, // subtle aberration; off on mobile (saves 2 tex samples per fragment per frame)
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    uniform float aberration;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float dist = length(center);
      vec3 col;
      // Skip the 3-tap split when aberration is at baseline — saves 2 texture
      // samples per fragment per frame on mobile. Boost FX (>= 0.0005) keeps
      // the full RGB split.
      if (aberration < 0.0005) {
        col = texture2D(tDiffuse, uv).rgb;
      } else {
        float r = texture2D(tDiffuse, uv + center * aberration).r;
        float g = texture2D(tDiffuse, uv).g;
        float b = texture2D(tDiffuse, uv - center * aberration).b;
        col = vec3(r, g, b);
      }
      // Vignette
      col *= 1.0 - smoothstep(offset, offset + 0.4, dist) * darkness;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
const vignettePass = new ShaderPass(vignetteShader);
composer.addPass(vignettePass);

// ═══════════════════════════════════════════════════
//  LIGHTING
// ═══════════════════════════════════════════════════
const ambientLight = new THREE.AmbientLight(0xffffff, 0.02);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 2.56);  // key light
dirLight.position.set(2, 8.8, 8);
scene.add(dirLight);
const rimLight = new THREE.DirectionalLight(0x00f0ff, 0.10);  // cyan rim — very subtle, just barely kisses the nose edge
rimLight.position.set(-3, 6, -8);
scene.add(rimLight);
const fillLight = new THREE.DirectionalLight(0xff44cc, 0.25);  // pink fill — reduced, was adding too much pink noise
fillLight.position.set(0, -2, 6);
scene.add(fillLight);
const sunLight = new THREE.DirectionalLight(0xff9500, 0.22);  // right sun rake
sunLight.position.set(2.5, 1, -18);
sunLight.target.position.set(0, 0.3, 4.5);
scene.add(sunLight);
scene.add(sunLight.target);
const sunLightL = new THREE.DirectionalLight(0xff9500, 0.10);  // left whisper
sunLightL.position.set(-2.5, 1, -18);
sunLightL.target.position.set(0, 0.3, 4.5);
scene.add(sunLightL);
scene.add(sunLightL.target);

// ═══════════════════════════════════════════════════
//  SKY GRADIENT (fullscreen quad)
// ═══════════════════════════════════════════════════
const skyGeo = new THREE.PlaneGeometry(2, 2);
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    topColor: { value: new THREE.Color(0x060820) },
    botColor: { value: new THREE.Color(0x1a0535) },
    horizonLine: { value: 0.38 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 botColor;
    uniform float horizonLine;
    varying vec2 vUv;
    void main(){
      float t = smoothstep(horizonLine - 0.05, horizonLine + 0.25, vUv.y);
      gl_FragColor = vec4(mix(botColor, topColor, t), 1.0);
    }
  `,
  depthWrite: false,
  depthTest: false,
});
const skyMesh = new THREE.Mesh(skyGeo, skyMat);
skyMesh.renderOrder = -10;
scene.add(skyMesh);

// ═══════════════════════════════════════════════════
//  DEEP SPACE ENVIRONMENT — layered starfield + nebula
//  Hand-crafted procedural system, no external assets.
//  Three layers:
//    1. galaxyMat starfield  — 3,000 tiny colored stars, sparse
//    2. Nebula cloud blobs   — 600 soft additive blobs
//    3. Warp particles       — instanced planes flying toward camera
//  All layers placed in world space and scroll via Z recycling.
// ═══════════════════════════════════════════════════

// ── Shared sprite factory ──
function makeSpriteTex(r, g, b) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const ct = cv.getContext('2d');
  const grd = ct.createRadialGradient(16,16,0, 16,16,16);
  grd.addColorStop(0,   `rgba(${r},${g},${b},1)`);
  grd.addColorStop(0.4, `rgba(${r},${g},${b},0.55)`);
  grd.addColorStop(1,   `rgba(${r},${g},${b},0)`);
  ct.fillStyle = grd; ct.fillRect(0,0,32,32);
  return new THREE.CanvasTexture(cv);
}

// ── Level nebula tint palette ──
const NEBULA_TINTS = [
  new THREE.Color(0x2244aa),  // L1 NEON DAWN
  new THREE.Color(0x661199),  // L2 ULTRAVIOLET
  new THREE.Color(0x990022),  // L3 CRIMSON VOID
  new THREE.Color(0x003388),  // L4 ICE STORM
  new THREE.Color(0x110033),  // L5 VOID SINGULARITY
];
let currentNebulaTint = NEBULA_TINTS[0].clone();
let targetNebulaTint  = NEBULA_TINTS[0].clone();

// ── Layer 1: STARFIELD — 3,000 sparse tiny stars ──
const SPACE_STAR_COUNT  = 5000;
const STAR_HW           = 500;   // half-width — wider spread for more side stars
const STAR_HH           = 220;   // half-height
const STAR_DEPTH        = 600;   // total Z span
// Tight star sprite — sharp bright core, very short falloff
function makeStarTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 16;
  const ct = cv.getContext('2d');
  const grd = ct.createRadialGradient(8,8,0, 8,8,8);
  grd.addColorStop(0,    'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1,    'rgba(255,255,255,0)');
  ct.fillStyle = grd; ct.fillRect(0,0,16,16);
  return new THREE.CanvasTexture(cv);
}
const starTex = makeStarTex();
let galaxyMat = new THREE.PointsMaterial({
  size: 0.4,
  map: starTex, alphaMap: starTex,
  transparent: true, opacity: 0.85,
  depthWrite: false,
  blending: THREE.NormalBlending,
  sizeAttenuation: true,
  color: new THREE.Color(0.55, 0.65, 1.0),  // blue-tinted — ACES maps this to clean blue-white
});
const starGeo     = new THREE.BufferGeometry();
const starPos     = new Float32Array(SPACE_STAR_COUNT * 3);
for (let i = 0; i < SPACE_STAR_COUNT; i++) {
  starPos[i*3]   = (Math.random()-0.5) * STAR_HW * 2;
  starPos[i*3+1] = (Math.random()-0.5) * STAR_HH * 2;
  starPos[i*3+2] = (Math.random()-0.5) * STAR_DEPTH;
}
const starPosAttr = new THREE.BufferAttribute(starPos, 3);
starPosAttr.setUsage(THREE.DynamicDrawUsage);
starGeo.setAttribute('position', starPosAttr);
const starField = new THREE.Points(starGeo, galaxyMat);
starField.frustumCulled = false;
scene.add(starField);

// ── Layer 1b: BRIGHT STARS — ~60 larger stars for depth/variation ──
// Ref image shows a handful of bigger, brighter stars with slight glow
const BRIGHT_STAR_COUNT = 160;
function makeBrightStarTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const ct = cv.getContext('2d');
  const grd = ct.createRadialGradient(32,32,0, 32,32,32);
  grd.addColorStop(0,    'rgba(255,255,255,1)');
  grd.addColorStop(0.08, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.22, 'rgba(200,220,255,0.4)');
  grd.addColorStop(0.50, 'rgba(150,180,255,0.08)');
  grd.addColorStop(1,    'rgba(100,140,255,0)');
  ct.fillStyle = grd; ct.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(cv);
}
const brightStarTex = makeBrightStarTex();
const brightStarGeo = new THREE.BufferGeometry();
const brightStarPos   = new Float32Array(BRIGHT_STAR_COUNT * 3);
const brightStarSizes = new Float32Array(BRIGHT_STAR_COUNT);
// Exclusion zone: skip stars that would appear on/near the sun disc
// Constants inlined because SUN_Y/SUN_Z/SUN_R are defined later in the file
const _SUN_EX_Z = -340, _SUN_EX_Y = -2, _SUN_EX_R = 112;
function isTooCloseToSun(x, y, z) {
  const dz = z - _SUN_EX_Z;
  if (dz > 0 && dz < STAR_DEPTH) {
    const scale = -_SUN_EX_Z / (-z || 1);
    const px = x * scale;
    const py = y * scale;
    const dist = Math.sqrt(px*px + (py - _SUN_EX_Y)*(py - _SUN_EX_Y));
    if (dist < _SUN_EX_R * 1.1) return true;
  }
  return false;
}
for (let i = 0; i < BRIGHT_STAR_COUNT; i++) {
  let x, y, z;
  do {
    // Bias X toward lateral edges (away from center where sun is)
    const rawX = (Math.random()-0.5) * 2; // -1..1
    x = Math.sign(rawX) * (0.3 + 0.7 * Math.abs(rawX)) * STAR_HW;
    y = (Math.random()-0.5) * STAR_HH * 2;
    z = (Math.random()-0.5) * STAR_DEPTH;
  } while (isTooCloseToSun(x, y, z));
  brightStarPos[i*3]   = x;
  brightStarPos[i*3+1] = y;
  brightStarPos[i*3+2] = z;
  brightStarSizes[i] = 0.6 + Math.random() * 0.8 + (Math.random() > 0.8 ? 0.6 : 0.0);
}
const bsPosAttr = new THREE.BufferAttribute(brightStarPos, 3);
bsPosAttr.setUsage(THREE.DynamicDrawUsage);
brightStarGeo.setAttribute('position', bsPosAttr);
brightStarGeo.setAttribute('size', new THREE.BufferAttribute(brightStarSizes, 1));
const brightStarMat = new THREE.ShaderMaterial({
  uniforms: {
    uTex:   { value: brightStarTex },
    uAlpha: { value: 0.85 },
  },
  vertexShader: `
    attribute float size;
    varying float vSize;
    void main() {
      vSize = size;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (300.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform sampler2D uTex;
    uniform float uAlpha;
    void main() {
      vec4 t = texture2D(uTex, gl_PointCoord);
      if (t.a < 0.01) discard;
      gl_FragColor = vec4(t.rgb, t.a * uAlpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const brightStarField = new THREE.Points(brightStarGeo, brightStarMat);
brightStarField.frustumCulled = false;
scene.add(brightStarField);

// ── Layer 2: NEBULA CLOUDS — 600 soft blobs ──
const CLOUD_COUNT = 600;
const nebTex = makeSpriteTex(100, 50, 230);
const nebulaMat = new THREE.PointsMaterial({
  size: 22, map: nebTex, alphaMap: nebTex,
  transparent: true, opacity: 0.02,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true,
  color: new THREE.Color(0x4422bb),
});
const nebulaGeo  = new THREE.BufferGeometry();
const nebulaPos  = new Float32Array(CLOUD_COUNT * 3);
for (let i = 0; i < CLOUD_COUNT; i++) {
  nebulaPos[i*3]   = (Math.random()-0.5) * 500;
  nebulaPos[i*3+1] = Math.random() * 0.8 * STAR_HH - 20;  // favour above horizon
  nebulaPos[i*3+2] = (Math.random()-0.5) * STAR_DEPTH;
}
const nebulaPosAttr = new THREE.BufferAttribute(nebulaPos, 3);
nebulaPosAttr.setUsage(THREE.DynamicDrawUsage);
nebulaGeo.setAttribute('position', nebulaPosAttr);
const nebulaCloud = new THREE.Points(nebulaGeo, nebulaMat);
nebulaCloud.frustumCulled = false;
scene.add(nebulaCloud);

// ── Layer 3: WARP STREAKS — Z-aligned, perspective does the radial work ──
// Leading point accelerates faster than trailing in Z → streaks elongate.
// Perspective camera naturally fans them out from center — hyperspace look.
let WARP_COUNT = 200;
let _warpSpeed = 80;        // velocity multiplier (on top of state.speed)
let _warpBrightness = 1.0; // line opacity — cranked to max
let _warpMaxLen = 4;        // max Z-distance between lead & trail points
let _warpYCenter = 50;      // center of Y spread — lowered to put more particles near ship
let _warpYRange = 400;      // total Y spread from center (tunable)
let _warpEdgeBias = 0;      // 0 = uniform spread, 1 = clustered at screen edges
const WARP_DEPTH = STAR_DEPTH;
const WARP_HW = 520;
const WARP_HH = 260;
const WARP_MIN_Y = 2;       // above water level (water at Y≈0)

function _warpRandY() {
  let r = Math.random();
  if (_warpEdgeBias > 0) {
    r = r < 0.5
      ? 0.5 * Math.pow(2 * r, 1 + _warpEdgeBias * 3)
      : 1 - 0.5 * Math.pow(2 * (1 - r), 1 + _warpEdgeBias * 3);
  }
  const y = _warpYCenter + (r - 0.5) * _warpYRange * 2;
  return Math.max(WARP_MIN_Y, y);
}
function _warpRandX() {
  let r = Math.random();
  if (_warpEdgeBias > 0) {
    r = r < 0.5
      ? 0.5 * Math.pow(2 * r, 1 + _warpEdgeBias * 3)
      : 1 - 0.5 * Math.pow(2 * (1 - r), 1 + _warpEdgeBias * 3);
  }
  return (r - 0.5) * WARP_HW * 2;
}

// Z-aligned streaks — perspective camera creates the radial spread naturally.
// Each line = leading point + trailing point, both at same X,Y.
// Leading point moves faster in Z → streak elongates as it approaches.
//
// PERF: pre-allocate at MAX_WARP_COUNT once. Speed-driven count adjustment
// is now done via geometry.setDrawRange() and an active-count cursor —
// no Float32Array / BufferAttribute reallocation per speed bucket. Was
// allocating ~22KB of typed arrays + a new BufferAttribute on every speed
// bucket change, which during acceleration could fire every frame.
// Game runtime caps at 1800 (line 2067 _warpMaxCount). Tuner slider goes up to 5000
// for debug sweeps, so we allocate at 5000 to preserve the slider's full range.
// Cost: 5000 * 6 * 4 = 120 KB Float32 + 5000 * 4 * 2 = 40 KB velocity buffers = 160 KB.
const _MAX_WARP_COUNT = 5000;
const _warpGeo = new THREE.BufferGeometry();
const _warpPos = new Float32Array(_MAX_WARP_COUNT * 6);
// Per-particle state: lead velocity, trail velocity (accelerating)
const _warpLeadVel  = new Float32Array(_MAX_WARP_COUNT);
const _warpTrailVel = new Float32Array(_MAX_WARP_COUNT);
const _WARP_LEAD_ACCEL  = 0.006;  // leading point acceleration
const _WARP_TRAIL_ACCEL = 0.003;  // trailing point acceleration (slower)
function _warpInitOne(i) {
  const x = _warpRandX();
  const y = _warpRandY();
  const z = -WARP_DEPTH * 0.5 + Math.random() * WARP_DEPTH * 0.6;
  _warpPos[i*6]   = x;  _warpPos[i*6+1] = y;  _warpPos[i*6+2] = z;
  _warpPos[i*6+3] = x;  _warpPos[i*6+4] = y;  _warpPos[i*6+5] = z;
  _warpLeadVel[i]  = Math.random() * 0.5;
  _warpTrailVel[i] = Math.random() * 0.3;
}
// Initialize ALL slots up to MAX so we never read garbage when count grows.
for (let i = 0; i < _MAX_WARP_COUNT; i++) _warpInitOne(i);
const _warpPosAttr = new THREE.BufferAttribute(_warpPos, 3);
_warpPosAttr.setUsage(THREE.DynamicDrawUsage);
_warpGeo.setAttribute('position', _warpPosAttr);
// Initial draw range = WARP_COUNT pairs (each pair = 2 vertices in the LineSegments)
_warpGeo.setDrawRange(0, WARP_COUNT * 2);
// Re-init slots that were initialized when not yet visible — keeps positions sane.
function _warpRebuild(newCount) {
  if (newCount > _MAX_WARP_COUNT) newCount = _MAX_WARP_COUNT;
  if (newCount < 1) newCount = 1;
  // If growing, re-roll the newly-active slots so they spawn fresh
  // (otherwise they'd carry stale Z values left over from initial init).
  if (newCount > WARP_COUNT) {
    for (let i = WARP_COUNT; i < newCount; i++) _warpInitOne(i);
    _warpPosAttr.needsUpdate = true;
  }
  WARP_COUNT = newCount;
  _warpGeo.setDrawRange(0, WARP_COUNT * 2);
}
const _warpMat = new THREE.LineBasicMaterial({
  color: new THREE.Color(0.51, 0.45, 0.63), transparent: true, opacity: _warpBrightness,
  blending: THREE.NormalBlending, depthWrite: false, fog: false,
});
const _warpMesh = new THREE.LineSegments(_warpGeo, _warpMat);
_warpMesh.frustumCulled = false;
scene.add(_warpMesh);

// ── Called every frame — scroll all three layers forward ──
function updateGalaxyScroll(dt) {
  if (state.phase !== 'playing' && state.phase !== 'paused' && state.phase !== 'title') return;
  if (state.phase === 'paused') { for (const fm of shipFireMeshes) fm.visible = state.thrusterPower > 0; composer.render(); return; }
  // On title screen, use a slow idle drift speed
  if (state.phase === 'title') {
    const idleStep = BASE_SPEED * 0.35 * dt * 0.72;
    const sp = starPosAttr.array;
    for (let i = 0; i < SPACE_STAR_COUNT; i++) {
      sp[i*3+2] += idleStep;
      if (sp[i*3+2] > STAR_DEPTH * 0.5) {
        sp[i*3]   = (Math.random()-0.5) * STAR_HW * 2;
        sp[i*3+1] = (Math.random()-0.5) * STAR_HH * 2;
        sp[i*3+2] -= STAR_DEPTH;
      }
    }
    starPosAttr.needsUpdate = true;
    // Bright stars — same idle drift
    const bp0 = bsPosAttr.array;
    for (let i = 0; i < BRIGHT_STAR_COUNT; i++) {
      bp0[i*3+2] += idleStep;
      if (bp0[i*3+2] > STAR_DEPTH * 0.5) {
        let x, y, z;
        do {
          const rawX = (Math.random()-0.5) * 2;
          x = Math.sign(rawX) * (0.3 + 0.7 * Math.abs(rawX)) * STAR_HW;
          y = (Math.random()-0.5) * STAR_HH * 2;
          z = bp0[i*3+2] - STAR_DEPTH;
        } while (isTooCloseToSun(x, y, z));
        bp0[i*3] = x; bp0[i*3+1] = y; bp0[i*3+2] = z;
      }
    }
    bsPosAttr.needsUpdate = true;
    // Warp streaks — gentle idle drift on title screen
    // Both points accelerate in Z; leading faster than trailing → streaks grow
    const idleAccelMult = BASE_SPEED * 0.35 * _warpSpeed * 0.02;
    const wp0 = _warpPosAttr.array;
    for (let i = 0; i < WARP_COUNT; i++) {
      _warpLeadVel[i]  += _WARP_LEAD_ACCEL  * idleAccelMult * dt;
      _warpTrailVel[i] += _WARP_TRAIL_ACCEL * idleAccelMult * dt;
      wp0[i*6+2] += _warpLeadVel[i] * dt * 60;
      wp0[i*6+5] += _warpTrailVel[i] * dt * 60;
      // Clamp max streak length
      if (wp0[i*6+2] - wp0[i*6+5] > _warpMaxLen) {
        wp0[i*6+5] = wp0[i*6+2] - _warpMaxLen;
        _warpTrailVel[i] = _warpLeadVel[i];
      }
      // Recycle when trailing point passes camera
      if (wp0[i*6+5] > WARP_DEPTH * 0.5) {
        const x = _warpRandX();
        const y = _warpRandY();
        const z = -WARP_DEPTH * 0.55 - Math.random() * WARP_DEPTH * 0.35;
        wp0[i*6]=x; wp0[i*6+1]=y; wp0[i*6+2]=z;
        wp0[i*6+3]=x; wp0[i*6+4]=y; wp0[i*6+5]=z;
        _warpLeadVel[i]  = 0;
        _warpTrailVel[i] = 0;
      }
    }
    _warpPosAttr.needsUpdate = true;
    return;
  }
  const step = state.speed * dt * 0.72;  // slightly slower — depth parallax

  // Stars scroll at base speed
  const sp = starPosAttr.array;
  for (let i = 0; i < SPACE_STAR_COUNT; i++) {
    sp[i*3+2] += step;
    if (sp[i*3+2] > STAR_DEPTH * 0.5) {
      sp[i*3]   = (Math.random()-0.5) * STAR_HW * 2;
      sp[i*3+1] = (Math.random()-0.5) * STAR_HH * 2;
      sp[i*3+2] -= STAR_DEPTH;
    }
  }
  starPosAttr.needsUpdate = true;

  // Bright stars scroll at same speed as small stars
  const bp = bsPosAttr.array;
  for (let i = 0; i < BRIGHT_STAR_COUNT; i++) {
    bp[i*3+2] += step;
    if (bp[i*3+2] > STAR_DEPTH * 0.5) {
      let x, y, z;
      do {
        const rawX = (Math.random()-0.5) * 2;
        x = Math.sign(rawX) * (0.3 + 0.7 * Math.abs(rawX)) * STAR_HW;
        y = (Math.random()-0.5) * STAR_HH * 2;
        z = bp[i*3+2] - STAR_DEPTH;
      } while (isTooCloseToSun(x, y, z));
      bp[i*3] = x; bp[i*3+1] = y; bp[i*3+2] = z;
    }
  }
  bsPosAttr.needsUpdate = true;

  // Nebula drifts slower — gives depth parallax
  const np = nebulaPosAttr.array;
  for (let i = 0; i < CLOUD_COUNT; i++) {
    np[i*3+2] += step * 0.40;
    if (np[i*3+2] > STAR_DEPTH * 0.5) {
      np[i*3]   = (Math.random()-0.5) * 500;
      np[i*3+1] = Math.random() * 0.8 * STAR_HH - 20;
      np[i*3+2] -= STAR_DEPTH;
    }
  }
  nebulaPosAttr.needsUpdate = true;

  // Warp streaks — Z-aligned, perspective camera creates radial look.
  // Scale warp count with speed: 200 at BASE_SPEED, up to 1800 at peak.
  const _warpSpd = state.speed;
  const _warpMinCount = 200, _warpMaxCount = 1800;
  const _speedT = Math.min(1, Math.max(0, (_warpSpd - BASE_SPEED) / (BASE_SPEED * 1.1))); // 0…1 over speed range — maxes out at 2.1x (T4c ICE STORM cyan sun)
  const _targetWarpCount = Math.round(_warpMinCount + (_warpMaxCount - _warpMinCount) * _speedT);
  if (_targetWarpCount !== WARP_COUNT) _warpRebuild(_targetWarpCount);
  // Both points accelerate in Z; leading faster → streaks elongate with speed.
  const accelMult = _warpSpd * _warpSpeed * 0.05;
  const wp = _warpPosAttr.array;
  for (let i = 0; i < WARP_COUNT; i++) {
    _warpLeadVel[i]  += _WARP_LEAD_ACCEL  * accelMult * dt;
    _warpTrailVel[i] += _WARP_TRAIL_ACCEL * accelMult * dt;
    wp[i*6+2] += _warpLeadVel[i] * dt * 60;
    wp[i*6+5] += _warpTrailVel[i] * dt * 60;
    // Clamp max streak length
    if (wp[i*6+2] - wp[i*6+5] > _warpMaxLen) {
      wp[i*6+5] = wp[i*6+2] - _warpMaxLen;
      _warpTrailVel[i] = _warpLeadVel[i];
    }
    // Recycle when trailing point passes camera
    if (wp[i*6+5] > WARP_DEPTH * 0.5) {
      const x = _warpRandX();
      const y = _warpRandY();
      const z = -WARP_DEPTH * 0.55 - Math.random() * WARP_DEPTH * 0.35;
      wp[i*6]=x; wp[i*6+1]=y; wp[i*6+2]=z;
      wp[i*6+3]=x; wp[i*6+4]=y; wp[i*6+5]=z;
      _warpLeadVel[i]  = 0;
      _warpTrailVel[i] = 0;
    }
  }
  _warpPosAttr.needsUpdate = true;
  _warpMat.opacity = _warpBrightness;

  // Smooth nebula tint transition between levels
  currentNebulaTint.lerp(targetNebulaTint, dt * 0.5);
  nebulaMat.color.copy(currentNebulaTint);
}


// ═══════════════════════════════════════════════════
//  STARS
// ═══════════════════════════════════════════════════
//  FLOOR SURFACE — classic synthwave neon grid
// ═══════════════════════════════════════════════════
// Dark near-black floor with thin bright glowing lines,
// perspective-foreshortened, fading to black at the horizon.
// Tile size ~4 world units so lines feel like the reference image.
const GRID_TILE_SIZE = 4.0;

// Per-level line colors (floor stays near-black, only lines change)
const FLOOR_PALETTES = [
  { line: new THREE.Color(0x00eeff) },   // NEON DAWN    — cyan
  { line: new THREE.Color(0xcc44ff) },   // ULTRAVIOLET  — purple
  { line: new THREE.Color(0xff1060) },   // CRIMSON VOID — hot pink/red
  { line: new THREE.Color(0x44ccff) },   // ICE STORM    — ice blue
  { line: new THREE.Color(0xffd700) },   // VOID SINGULARITY — gold
];

const floorVS = `
varying vec2 vWorldXZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const floorFS = `
uniform float uOffsetX;
uniform float uOffsetZ;
uniform float uTileSize;
uniform vec3  uLineColor;
varying vec2  vWorldXZ;

float gridLine(vec2 uv) {
  // uv in tile space [0,1). Returns 1 on line, 0 in fill.
  vec2 fw = fwidth(uv);                      // screen-space derivative = pixel size
  vec2 edge = min(uv, 1.0 - uv);            // distance to nearest edge in tile UV
  vec2 aa   = fw * 1.2;                     // anti-alias width
  // Line thickness: 0.022 of a tile (looks ~1-2px thin)
  vec2 line = smoothstep(aa, vec2(0.0), edge - 0.022);
  return max(line.x, line.y);
}

void main() {
  vec2 scrolled = vWorldXZ + vec2(uOffsetX, uOffsetZ);
  vec2 tileUV   = fract(scrolled / uTileSize);

  float g = gridLine(tileUV);

  // Core line color with a soft inner glow (slightly wider, dimmer band)
  vec2 glowUV  = fract(scrolled / uTileSize);
  vec2 glowEdge = min(glowUV, 1.0 - glowUV);
  float glow   = max(
    smoothstep(0.08, 0.0, glowEdge.x),
    smoothstep(0.08, 0.0, glowEdge.y)
  ) * 0.35;

  // Floor fill: pure black
  vec3 floorColor = vec3(0.0, 0.0, 0.0);

  // Compose: pure black — no grid lines, no glow
  vec3 col = floorColor;

  // Horizon fade — disappear into darkness toward the far end (negative Z in world)
  float depth     = -vWorldXZ.y;                         // world Z forward
  float fogNear   = 20.0;
  float fogFar    = 260.0;  // extended to match deeper spawn distance
  float fogFactor = clamp((depth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
  col = mix(col, vec3(0.0), fogFactor * fogFactor);      // quadratic = softer near, sharp horizon

  // Also fade behind camera (positive Z)
  float behindFade = clamp((-depth + 8.0) / 10.0, 0.0, 1.0);
  col = mix(col, vec3(0.0), behindFade);

  gl_FragColor = vec4(col, 1.0);
}
`;

const floorMat = new THREE.ShaderMaterial({
  vertexShader:   floorVS,
  fragmentShader: floorFS,
  extensions: { derivatives: true },
  uniforms: {
    uOffsetX:  { value: 0.0 },
    uOffsetZ:  { value: 0.0 },
    uTileSize: { value: GRID_TILE_SIZE },
    uLineColor:{ value: FLOOR_PALETTES[0].line.clone() },
  },
  side: THREE.FrontSide,
});

const floorGeo  = new THREE.PlaneGeometry(1400, 700, 1, 1);
const floorMesh = new THREE.Mesh(floorGeo, floorMat);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.position.set(0, 0.0, -100);
scene.add(floorMesh);

// ─── WATER FLOOR — Three.js Water shader with live reflection + ripples ──────
// Uses three/addons Water object: real mirror reflection + animated normal map
// ripples + Fresnel + sun specular streak. Replaces the old manual render-target.

const waterNormals = new THREE.TextureLoader().load('assets/images/waternormals.jpg', tex => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (_mobAA) tex.anisotropy = 4; // mobile aniso clamp — 4x is plenty for tiled normals
  if (window.__loadGate) window.__loadGate.setStatus('WATER', 50);
});
if (window.__loadGate) {
  window.__loadGate.add('waternormals', new Promise(res => {
    if (waterNormals.image && waterNormals.image.complete) return res();
    const iv = setInterval(() => {
      if (waterNormals.image && waterNormals.image.complete) { clearInterval(iv); res(); }
    }, 50);
    setTimeout(() => { clearInterval(iv); res(); }, 8000);
  }));
}

const waterGeo  = new THREE.PlaneGeometry(1400, 700, 4, 4);
const mirrorMesh = new Water(waterGeo, {
  textureWidth:  512,
  textureHeight: 512,
  waterNormals,
  sunDirection:  new THREE.Vector3(0, 1, 0),
  sunColor:      0x000000,   // overridden below
  waterColor:    0x000000,   // pitch black
  distortionScale: 2.5,
  alpha: 1.0,
  fog: false,
});
mirrorMesh.rotation.x = -Math.PI / 2;
mirrorMesh.position.set(0, 0.01, -100);
scene.add(mirrorMesh);

// Patch Water's onBeforeRender so the internal mirrorCamera skips thruster /
// flame / cone / warp objects (those default to layer 0 like the rest of
// the scene, so mirrorCamera DOES see them; we hide explicitly).
// PERF: was forEach with new closure per call + new _hidden array per frame.
// Now uses a hoisted scratch buffer and plain for-loops — zero allocations
// and zero closures per frame.
const _origWaterOBR  = mirrorMesh.onBeforeRender;
const _waterHideBuf  = new Array(64);   // scratch — grows once, never re-allocs
let   _waterHideLen  = 0;
function _waterMaybeHide(obj) {
  if (obj && obj.visible) {
    obj.visible = false;
    _waterHideBuf[_waterHideLen++] = obj;
  }
}
mirrorMesh.onBeforeRender = function(renderer, scene, camera) {
  _waterHideLen = 0;
  for (let i = 0, n = thrusterSystems.length;     i < n; i++) _waterMaybeHide(thrusterSystems[i].points);
  for (let i = 0, n = miniThrusterSystems.length; i < n; i++) _waterMaybeHide(miniThrusterSystems[i].points);
  for (let i = 0, n = nozzleBloomSprites.length;  i < n; i++) _waterMaybeHide(nozzleBloomSprites[i]);
  for (let i = 0, n = miniBloomSprites.length;    i < n; i++) _waterMaybeHide(miniBloomSprites[i]);
  for (let i = 0, n = flameMeshes.length;         i < n; i++) _waterMaybeHide(flameMeshes[i]);
  if (typeof _thrusterCones !== 'undefined') {
    for (let i = 0, n = _thrusterCones.length;    i < n; i++) _waterMaybeHide(_thrusterCones[i]);
  }
  _waterMaybeHide(_warpMesh);
  _origWaterOBR.call(this, renderer, scene, camera);
  for (let i = 0; i < _waterHideLen; i++) _waterHideBuf[i].visible = true;
};

// Almost totally black water — only sun streak illuminates it
// Sun direction: toward horizon ahead (-Z), slightly above floor
mirrorMesh.material.uniforms.sunDirection.value.set(0, 0.3, -1).normalize();
// Warm amber sun streak, strong specular
mirrorMesh.material.uniforms.sunColor.value.setRGB(0.55, 0.28, 0.03); // dimmer sun streak
// Tight normal map scale = smaller focused ripples, not a blurry wash
mirrorMesh.material.uniforms.size.value = 8.0;
mirrorMesh.material.uniforms.distortionScale.value = 0.6;
mirrorMesh.material.uniforms.alpha.value = 1.0;

// ── Inject forward-flow uniform into Water fragment shader ──
// Adds uFlowZ to offset only the Z axis of normal map sampling, creating
// directional forward scroll proportional to ship speed.
mirrorMesh.material.uniforms.uFlowZ = { value: 0.0 };
mirrorMesh.material.fragmentShader = mirrorMesh.material.fragmentShader
  .replace(
    'uniform float distortionScale;',
    'uniform float distortionScale;\nuniform float uFlowZ;'
  )
  .replace(
    'getNoise( worldPosition.xz * size )',
    'getNoise( (worldPosition.xz + vec2(0.0, uFlowZ)) * size )'
  );
mirrorMesh.material.needsUpdate = true;
let _waterFlowZ = 0;  // accumulator for forward water scroll
let _waterFlowScale = 0.45;  // faster forward water flow, especially noticeable at L4/L5
let _tunerSpeedOverride = -1; // -1 = off; >0 = override state.speed each frame (for tuning)



// Convenience alias so existing uniform-update code keeps working
const mirrorMat = mirrorMesh.material;
// Patch in uSunColor / uLineColor aliases pointing at Water uniforms
mirrorMat.uniforms.uSunColor  = mirrorMat.uniforms.sunColor;
mirrorMat.uniforms.uLineColor = { value: FLOOR_PALETTES[0].line.clone() }; // unused visually but keeps refs alive

// Dummy objects so resize handler doesn't crash (Water manages its own RT)
const reflectRT    = { setSize: () => {} };
const mirrorCamera = { aspect: 1, updateProjectionMatrix: () => {} };

// ═══════════════════════════════════════════════════
//  SHIP WATER WAKE
// ═══════════════════════════════════════════════════
// Two systems:
//  1. Expanding ring ripples — spawned periodically under ship, grow + fade
//  2. V-wake chevron — two thin angled quads trailing the ship, width = speed

// ── Ring ripples ─────────────────────────────────────────────────────────────
const WAKE_RING_POOL  = 40;    // max simultaneous rings
let WAKE_RING_LIFE  = 0.20;  // seconds to live
let WAKE_RING_RATE  = 0.07;  // seconds between spawns (faster = more rings)
let WAKE_Y          = -0.10; // just below water surface

const wakeRingPool = [];
for (let i = 0; i < WAKE_RING_POOL; i++) {
  const geo = new THREE.RingGeometry(0.12, 0.32, 32);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  wakeRingPool.push({ mesh, life: 0, maxLife: 0, startX: 0, startZ: 0 });
}
let wakeRingTimer = 0;
let wakeRingLateralAcc = 0; // accumulator for lateral extra rings

function spawnWakeRing(x, z, velX) {
  for (let i = 0; i < wakeRingPool.length; i++) {
    const r = wakeRingPool[i];
    if (r.life <= 0) {
      r.life    = WAKE_RING_LIFE;
      r.maxLife = WAKE_RING_LIFE;
      r.startX  = x;
      r.startZ  = z;
      r.velX    = velX || 0;  // lateral velocity at spawn — drives ellipse skew
      r.mesh.position.set(x, WAKE_Y, z);
      r.mesh.scale.set(1, 1, 1);
      r.mesh.visible = true;
      return;
    }
  }
}

// ── V-wake chevron ────────────────────────────────────────────────────────────
// Two thin quads fanning BEHIND the ship (positive Z = toward camera in world,
// so behind-ship = more negative Z in world = we position in local space going -Z)
const VWAKE_LEN    = 20;   // how far back the wake stretches
const VWAKE_SPREAD = 8;    // how wide at the tail
const VWAKE_Y      = 0.03;

function makeVWakeGeo(side) {
  // In local space: ship is at origin facing -Z (away)
  // Wake goes BEHIND = +Z in local (toward camera)
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    0,                    VWAKE_Y,  0,              // tip at ship
    side * 0.5,           VWAKE_Y,  3,              // near edge just behind
    side * VWAKE_SPREAD,  VWAKE_Y,  VWAKE_LEN,      // far outer behind
    side * 1.4,           VWAKE_Y,  VWAKE_LEN,      // far inner behind
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex([0,1,2, 0,2,3]);
  geo.computeVertexNormals();
  return geo;
}

const vWakeMats = [-1, 1].map(() => new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0,
  depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
}));
const vWakeMeshes = [-1, 1].map((side, i) => {
  const m = new THREE.Mesh(makeVWakeGeo(side), vWakeMats[i]);
  m.frustumCulled = false;
  m.visible = false;
  scene.add(m);
  return m;
});

function updateWake(dt) {
  const playing    = state.phase === 'playing';
  const waterOn    = mirrorMesh.visible;
  const speed      = state.speed || 0;
  const shipX      = state.shipX || 0;
  const shipZ      = shipGroup.position.z;   // ship world Z (tracks slider)



  // ── Ring spawner ──
  const velX = state.shipVelX || 0;
  const absVelX = Math.abs(velX);
  if (playing && waterOn) {
    // Base timed spawn
    wakeRingTimer -= dt;
    if (wakeRingTimer <= 0) {
      spawnWakeRing(shipX, shipZ - 1.2, velX);
      wakeRingTimer = WAKE_RING_RATE;
    }
    // Extra lateral rings — accumulator so we never lose fractional spawns
    const lateralT = Math.max(0, (absVelX - 3) / 19); // 0 at vel≤3, 1 at vel=22
    if (lateralT > 0) {
      wakeRingLateralAcc += lateralT * 20 * dt; // up to 20 rings/sec at max lateral vel
      while (wakeRingLateralAcc >= 1) {
        wakeRingLateralAcc -= 1;
        const jitter = (Math.random() - 0.5) * absVelX * 0.06;
        spawnWakeRing(shipX + jitter, shipZ - 1.2 - Math.random() * 1.0, velX);
      }
    } else {
      wakeRingLateralAcc = 0;
    }
  }

  // ── Tick rings ──
  for (let i = 0; i < wakeRingPool.length; i++) {
    const r = wakeRingPool[i];
    if (r.life <= 0) continue;
    r.life -= dt;
    if (r.life <= 0) { r.mesh.visible = false; r.life = 0; continue; }
    const t    = 1 - (r.life / r.maxLife);
    const fade = Math.sin(t * Math.PI);
    // Base scale grows over life; lateral velocity stretches X outward
    const baseScale = 1 + t * 6.0;
    const latFactor = Math.min(1, Math.abs(r.velX) / 12); // 0→1 across vel range
    const scaleX = baseScale * (1 + latFactor * 3.5);     // up to 4.5x wider in X
    const scaleZ = baseScale * (1 + latFactor * 0.4);     // barely grows in Z
    r.mesh.scale.set(scaleX, 1, scaleZ);
    r.mesh.material.opacity = fade * 0.38;
    r.mesh.position.z += speed * dt;  // drift back with world
    if (r.mesh.position.z > DESPAWN_Z) { r.mesh.visible = false; r.life = 0; }
  }

  // ── V-wake ──
  // V-wake chevron disabled — too visible as triangular shadow under ship
  vWakeMeshes.forEach(m => { m.visible = false; });
}



// ═══════════════════════════════════════════════════
//  L5 CHROMATIC GROUND DUST
// ═══════════════════════════════════════════════════
// Dense multicolored particle layer on the floor, only during L5 2nd zipper onward.
// 2400 particles with per-vertex shifting hue — like aurora tendrils laid flat.
const L5D_COUNT   = 2400;
const L5D_SPREAD_X = 60;   // wider than normal dust
const L5D_SPAWN_Z  = -175;
const L5D_DEAD_Z   = 8;

const l5dPositions = new Float32Array(L5D_COUNT * 3);
const l5dColors    = new Float32Array(L5D_COUNT * 3);  // per-vertex RGB
const l5dAlphas    = new Float32Array(L5D_COUNT);
const l5dSpeeds    = new Float32Array(L5D_COUNT);
const l5dHues      = new Float32Array(L5D_COUNT);  // base hue 0..1 for cycling

// Palette bands: each particle gets a random hue offset in a vivid band
const L5D_HUE_BANDS = [0.0, 0.08, 0.17, 0.28, 0.50, 0.58, 0.67, 0.83, 0.92];

function l5dRandHue() {
  return L5D_HUE_BANDS[Math.floor(Math.random() * L5D_HUE_BANDS.length)] + (Math.random() - 0.5) * 0.07;
}

function hsvToRgb(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    case 5: return [v, p, q];
  }
}

for (let i = 0; i < L5D_COUNT; i++) {
  l5dPositions[i*3]   = (Math.random() - 0.5) * L5D_SPREAD_X * 2;
  l5dPositions[i*3+1] = 0.04 + Math.random() * 0.06;  // hover just above floor
  l5dPositions[i*3+2] = L5D_SPAWN_Z + Math.random() * Math.abs(L5D_SPAWN_Z - L5D_DEAD_Z);
  l5dAlphas[i]   = Math.random();
  l5dSpeeds[i]   = 0.7 + Math.random() * 0.6;
  l5dHues[i]     = l5dRandHue();
  const rgb = hsvToRgb(l5dHues[i], 1.0, 1.0);
  l5dColors[i*3] = rgb[0]; l5dColors[i*3+1] = rgb[1]; l5dColors[i*3+2] = rgb[2];
}

const l5dGeo = new THREE.BufferGeometry();
l5dGeo.setAttribute('position', new THREE.BufferAttribute(l5dPositions, 3));
l5dGeo.setAttribute('color',    new THREE.BufferAttribute(l5dColors,    3));
l5dGeo.setAttribute('alpha',    new THREE.BufferAttribute(l5dAlphas,    1));

const l5dMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0.0 } },
  vertexShader: `
    attribute vec3 color;
    attribute float alpha;
    varying vec3 vColor;
    varying float vAlpha;
    varying float vDepth;
    void main() {
      vColor = color;
      vAlpha = alpha;
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      vDepth = -mvPos.z;
      // Larger points than normal dust — visible density
      gl_PointSize = clamp(4.5 - vDepth * 0.003, 1.2, 5.0);
      gl_Position  = projectionMatrix * mvPos;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    varying vec3 vColor;
    varying float vAlpha;
    varying float vDepth;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = dot(uv, uv);
      if (d > 0.25) discard;
      // Soft round glow core
      float core = 1.0 - smoothstep(0.0, 0.25, d);
      // Slow hue drift — each particle shifts color over time
      // We bake a subtle brightness pulse so clusters breathe
      float pulse = 0.75 + 0.25 * sin(uTime * 2.1 + vDepth * 0.08);
      // Depth fade
      float nearFade = smoothstep(0.0, 18.0, vDepth);
      float farFade  = 1.0 - smoothstep(130.0, 168.0, vDepth);
      float fade = nearFade * farFade;
      gl_FragColor = vec4(vColor * pulse, vAlpha * fade * core * 0.88);
    }
  `,
  transparent: true,
  depthWrite:  false,
  blending:    THREE.AdditiveBlending,
  vertexColors: true,
});

const l5DustPoints = new THREE.Points(l5dGeo, l5dMat);
l5DustPoints.visible = false;
scene.add(l5DustPoints);

// Track accumulated time for the l5 dust shader
let l5DustTime = 0;

function updateL5Dust(dt) {
  if (!l5DustPoints.visible) return;

  l5DustTime += dt;
  l5dMat.uniforms.uTime.value = l5DustTime;

  const speedFactor = state.speed / BASE_SPEED;

  for (let i = 0; i < L5D_COUNT; i++) {
    // Scroll toward camera
    l5dPositions[i*3+2] += state.speed * l5dSpeeds[i] * dt;

    // Respawn at back when past camera
    if (l5dPositions[i*3+2] > L5D_DEAD_Z) {
      l5dPositions[i*3]   = state.shipX + (Math.random() - 0.5) * L5D_SPREAD_X * 2;
      l5dPositions[i*3+1] = 0.04 + Math.random() * 0.06;
      l5dPositions[i*3+2] = L5D_SPAWN_Z;
      l5dAlphas[i]   = 0.2 + Math.random() * 0.8;
      l5dSpeeds[i]   = 0.7 + Math.random() * 0.6;
      // Reassign hue on respawn — creates constant color churn
      l5dHues[i] = l5dRandHue();
    }

    // Slowly cycle the vertex color by drifting the hue
    l5dHues[i] += dt * 0.08;  // drift ~0.08 hue/sec — subtle, not strobing
    const rgb = hsvToRgb(l5dHues[i], 1.0, 1.0);
    l5dColors[i*3] = rgb[0]; l5dColors[i*3+1] = rgb[1]; l5dColors[i*3+2] = rgb[2];

    // Alpha breathes slightly
    l5dAlphas[i] = Math.min(l5dAlphas[i] + dt * speedFactor * 0.6, 1.0);
  }

  l5dGeo.attributes.position.needsUpdate = true;
  l5dGeo.attributes.color.needsUpdate    = true;
  l5dGeo.attributes.alpha.needsUpdate    = true;
}



// ── CONE DESTRUCTION PARTICLE SYSTEM ───────────────────────────────────────
const SHARD_COUNT = 180;
const shardPositions  = new Float32Array(SHARD_COUNT * 3);
const shardColors     = new Float32Array(SHARD_COUNT * 3);
const shardAlphas     = new Float32Array(SHARD_COUNT);
const shardVelocities = [];
const shardAges       = new Float32Array(SHARD_COUNT);
const shardLifetimes  = new Float32Array(SHARD_COUNT);
for (let i = 0; i < SHARD_COUNT; i++) {
  shardVelocities.push(new THREE.Vector3());
  shardAges[i] = 9999; // start dead
  shardLifetimes[i] = 1;
  // Park far below floor so they're invisible until first spawn
  shardPositions[i * 3]     = 0;
  shardPositions[i * 3 + 1] = -9999;
  shardPositions[i * 3 + 2] = 0;
  shardAlphas[i] = 0;
}
const shardGeo = new THREE.BufferGeometry();
shardGeo.setAttribute('position', new THREE.BufferAttribute(shardPositions, 3));
shardGeo.setAttribute('color',    new THREE.BufferAttribute(shardColors,    3));
shardGeo.setAttribute('alpha',    new THREE.BufferAttribute(shardAlphas,    1));
const shardMat = new THREE.ShaderMaterial({
  vertexShader: `
    attribute float alpha;
    attribute vec3 color;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vAlpha = alpha;
      vColor = color;
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = clamp(4.0 + mvPos.z * 0.02, 1.5, 5.0);
      gl_Position = projectionMatrix * mvPos;
    }
  `,
  fragmentShader: `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = dot(uv, uv);
      if (d > 0.25) discard;
      float core = 1.0 - smoothstep(0.0, 0.25, d);
      gl_FragColor = vec4(vColor, vAlpha * core);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  // NO vertexColors:true — we handle color via custom 'color' attribute in the shader
});
const shardPoints = new THREE.Points(shardGeo, shardMat);
shardPoints.frustumCulled = false;
scene.add(shardPoints);


function spawnConeShards(x, y, z, levelColor) {
  let spawned = 0;
  for (let i = 0; i < SHARD_COUNT && spawned < 28; i++) {
    if (shardAges[i] < shardLifetimes[i]) continue; // alive, skip
    // Spawn this shard
    shardPositions[i * 3]     = x + (Math.random() - 0.5) * 1.2;
    shardPositions[i * 3 + 1] = y + Math.random() * 3.0;
    shardPositions[i * 3 + 2] = z + (Math.random() - 0.5) * 1.2;
    const speed = 4 + Math.random() * 10;
    const angle = Math.random() * Math.PI * 2;
    const upward = 2 + Math.random() * 6;
    shardVelocities[i].set(
      Math.cos(angle) * speed,
      upward,
      Math.sin(angle) * speed
    );
    shardAges[i]      = 0;
    shardLifetimes[i] = 0.35 + Math.random() * 0.35;
    // Color: mix white core → level color
    const bright = Math.random() > 0.4;
    shardColors[i * 3]     = bright ? 1.0 : levelColor.r;
    shardColors[i * 3 + 1] = bright ? 1.0 : levelColor.g;
    shardColors[i * 3 + 2] = bright ? 1.0 : levelColor.b;
    shardAlphas[i] = 1.0;
    spawned++;
  }
}

function updateShards(dt) {
  for (let i = 0; i < SHARD_COUNT; i++) {
    if (shardAges[i] >= shardLifetimes[i]) continue;
    shardAges[i] += dt;
    const t = shardAges[i] / shardLifetimes[i];
    // Gravity
    shardVelocities[i].y -= 18 * dt;
    shardPositions[i * 3]     += shardVelocities[i].x * dt;
    shardPositions[i * 3 + 1] += shardVelocities[i].y * dt;
    shardPositions[i * 3 + 2] += shardVelocities[i].z * dt;
    shardAlphas[i] = Math.max(0, 1.0 - t * t);
  }
  shardGeo.attributes.position.needsUpdate = true;
  shardGeo.attributes.alpha.needsUpdate    = true;
  shardGeo.attributes.color.needsUpdate    = true;
}


// ═══════════════════════════════════════════════════
//  SHIP EXPLOSION PARTICLE SYSTEM
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
//  SHIP EXPLOSION — Robot Bobby TSL approach (WebGL)
//  Particles spawn from actual ship mesh vertices,
//  per-particle speed/life ranges, TSL-style fade.
// ═══════════════════════════════════════════════════
const _EXP_COUNT = 20000;
const _expPositions  = new Float32Array(_EXP_COUNT * 3);
const _expColors     = new Float32Array(_EXP_COUNT * 3);
const _expAlphas     = new Float32Array(_EXP_COUNT);
const _expSizes      = new Float32Array(_EXP_COUNT);
const _expVelocities = [];
const _expSpeeds     = new Float32Array(_EXP_COUNT); // per-particle speed range (TSL)
const _expLifetimes  = new Float32Array(_EXP_COUNT); // per-particle life range  (TSL)
const _expStartSizes = new Float32Array(_EXP_COUNT); // initial sizes for scaling
let   _expStartTime  = 0; // global start time for TSL fade formula
let   _expTime       = 0; // running clock
for (let i = 0; i < _EXP_COUNT; i++) {
  _expVelocities.push(new THREE.Vector3());
  _expLifetimes[i] = 1;
  _expSpeeds[i] = 0.3;
  _expPositions[i * 3]     = 0;
  _expPositions[i * 3 + 1] = -9999;
  _expPositions[i * 3 + 2] = 0;
  _expAlphas[i] = 0;
  _expSizes[i]  = 0;
  _expStartSizes[i] = 0;
}
const _expGeo = new THREE.BufferGeometry();
_expGeo.setAttribute('position', new THREE.BufferAttribute(_expPositions, 3));
_expGeo.setAttribute('color',    new THREE.BufferAttribute(_expColors,    3));
_expGeo.setAttribute('alpha',    new THREE.BufferAttribute(_expAlphas,    1));
_expGeo.setAttribute('size',     new THREE.BufferAttribute(_expSizes,     1));
const _expMat = new THREE.ShaderMaterial({
  vertexShader: `
    attribute float alpha;
    attribute float size;
    attribute vec3 color;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vAlpha = alpha;
      vColor = color;
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (300.0 / -mvPos.z);
      gl_Position = projectionMatrix * mvPos;
    }
  `,
  fragmentShader: `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = dot(uv, uv);
      if (d > 0.25) discard;
      float core = 1.0 - smoothstep(0.0, 0.18, d);
      gl_FragColor = vec4(vColor * 2.0, vAlpha * core);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const _expPoints = new THREE.Points(_expGeo, _expMat);
_expPoints.frustumCulled = false;
scene.add(_expPoints);

let _expActive = false;
let _expElapsed = 0;
const _EXP_DURATION = 2.8; // seconds before game over screen (longer for sky-pivot cam)
let _expDeathZoomTarget = 0;
let _expDeathZoomActive = false;
let _gameOverDelayTimer = null;
let _titleFadeTimer = null;     // stale-timer guard for title screen fade-out
// Death camera — sky pivot: rise up and look down at crash site
let _expCamOrbitActive = false;
let _expCamOrbitT = 0;        // 0→1 progress
let _expCamAnchorX = 0;       // ship X at moment of death
let _expCamAnchorY = 0;
let _expCamAnchorZ = 0;
let _expCrashWorldPos = new THREE.Vector3(); // world-space crash point for lookAt
const _EXP_CAM_ORBIT_SPEED = 0.38;   // how fast we sweep
const _EXP_CAM_RISE = 35.0;          // how far up camera rises — big birds-eye
const _EXP_CAM_PULLBACK = 2.0;       // minimal pullback — almost directly above
const _EXP_CAM_LATERAL = 1.5;        // tiny lateral offset so it's not perfectly centered

// ── Explosion slo-mo: burst at 1x, dip to 0.3x, ramp back to 1x ──
let _expSlomoAge = 0;               // real-time age since explosion start
const _SLOMO_BURST  = 0.06;         // seconds at full speed (initial pop)
const _SLOMO_HOLD   = 0.9;          // seconds in slow-mo after burst (long hold for sky pivot)
const _SLOMO_RAMP   = 0.7;          // seconds to ramp back to 1x (gradual ramp for drama)
const _SLOMO_FACTOR = 0.18;         // time scale during slow-mo (very slow)
function _getExpTimescale(realAge) {
  if (realAge < _SLOMO_BURST) return 1.0;                       // initial pop
  const afterBurst = realAge - _SLOMO_BURST;
  if (afterBurst < _SLOMO_HOLD) return _SLOMO_FACTOR;           // slow-mo hold
  const rampT = Math.min(1, (afterBurst - _SLOMO_HOLD) / _SLOMO_RAMP);
  return _SLOMO_FACTOR + (1.0 - _SLOMO_FACTOR) * rampT;        // ease back to 1x
}

// ── Retry camera sweep: establishing shot → chase cam ──
let _retrySweepActive = false;
let _retrySweepT = 0;
const _RETRY_SWEEP_DUR = 1.3;       // seconds for camera to arrive at chase cam
// Establishing shot: above + behind, looking down at ship
const _RETRY_CAM_START = new THREE.Vector3(0, 7.5, 16);
const _RETRY_FOV_START = 85;         // wide establishing FOV
let _retryIsFromDead = false;        // flag to distinguish retry from fresh title start
let _retrySweepThrusterFired = false; // one-shot flag for thruster SFX during sweep

// ── Game-over tap cooldown: prevent accidental restart/exit ──
let _gameOverTapReady = false;
let _gameOverTapTimer = null;
const _GO_TAP_COOLDOWN = 700; // ms before taps are accepted on game over screen

// ── Harvest ship mesh vertex positions in world space ──
function _getShipVertices() {
  const verts = [];
  const colors = [];
  const model = window._shipModel;
  if (!model) return { verts, colors };
  const _wPos = new THREE.Vector3();
  const _tmpColor = new THREE.Color();
  model.traverse(child => {
    if (!child.isMesh) return;
    // skip fire / exhaust meshes
    const name = (child.userData._origMatName || child.name || '').toLowerCase();
    if (name.includes('fire')) return;
    const geo = child.geometry;
    if (!geo || !geo.attributes.position) return;
    const posAttr = geo.attributes.position;
    // Get mesh color from material
    const mat = child.material;
    if (mat && mat.color) {
      _tmpColor.copy(mat.color);
    } else {
      _tmpColor.set(0xffffff);
    }
    // Sample every vertex (or stride if too many)
    const count = posAttr.count;
    const stride = count > 500 ? Math.ceil(count / 500) : 1;
    for (let vi = 0; vi < count; vi += stride) {
      _wPos.set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
      child.localToWorld(_wPos);
      verts.push(_wPos.x, _wPos.y, _wPos.z);
      colors.push(_tmpColor.r, _tmpColor.g, _tmpColor.b);
    }
  });
  return { verts, colors };
}

function _spawnExplosion(shipPos, obstaclePos, shipSpeed, palette) {
  _expActive = true;
  _expElapsed = 0;
  _expStartTime = 0;
  _expTime = 0;
  _expSlomoAge = 0;

  // ── Harvest vertex positions from ship mesh (Robot Bobby style) ──
  const { verts: meshVerts, colors: meshColors } = _getShipVertices();
  const hasVerts = meshVerts.length >= 3;
  const vertCount = hasVerts ? (meshVerts.length / 3) : 0;

  // Forward momentum: ship travels in -Z — strong bias so debris wraps past obstacle
  const fwdZ = -shipSpeed * 0.85;

  // Deflection normal from obstacle toward ship (XZ plane)
  const nx = shipPos.x - obstaclePos.x;
  const nz = shipPos.z - obstaclePos.z;
  const nLen = Math.sqrt(nx * nx + nz * nz) || 1;
  const deflectX = nx / nLen;
  const deflectZ = nz / nLen;

  for (let i = 0; i < _EXP_COUNT; i++) {
    // ── Position: sample from actual ship mesh vertex (TSL instanceBufferAttribute) ──
    if (hasVerts) {
      const vi = Math.floor(Math.random() * vertCount) * 3;
      _expPositions[i * 3]     = meshVerts[vi];
      _expPositions[i * 3 + 1] = meshVerts[vi + 1];
      _expPositions[i * 3 + 2] = meshVerts[vi + 2];
    } else {
      // Fallback: spawn around ship center
      _expPositions[i * 3]     = shipPos.x + (Math.random() - 0.5) * 0.5;
      _expPositions[i * 3 + 1] = shipPos.y + (Math.random() - 0.5) * 0.4;
      _expPositions[i * 3 + 2] = shipPos.z + (Math.random() - 0.5) * 0.5;
    }

    // ── Particle roles: core explosion (0-799), streams (800+) ──
    const CORE_COUNT = 800;
    const isCore = i < CORE_COUNT;

    // ── 6 forward-shooting streams with tight angular clustering ──
    const STREAM_COUNT = 6;
    // Stream angles: tighter forward arc (-Z), in XZ plane
    // Angles relative to forward (-Z): spread from -35° to +35°
    const _streamAngles = [-0.6, -0.35, -0.12, 0.12, 0.35, 0.6]; // radians from -Z
    const streamIdx = isCore ? -1 : ((i - CORE_COUNT) % STREAM_COUNT);

    // ── Per-particle speed range ──
    _expSpeeds[i] = isCore
      ? 0.6 + Math.random() * 0.5   // core: fast fade
      : 0.06 + Math.random() * 0.45; // streams: wide range, some linger

    // ── Per-particle life range ──
    _expLifetimes[i] = isCore
      ? 0.35 + Math.random() * 0.4   // core: medium burst
      : 0.8 + Math.random() * 2.5;   // streams: long lived for sky-pivot cam

    // ── Velocity ──
    if (isCore) {
      // Big center explosion: radial burst in all directions
      const cSpd = 3 + Math.random() * 6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      _expVelocities[i].set(
        Math.sin(phi) * Math.cos(theta) * cSpd,
        Math.abs(Math.sin(phi) * Math.sin(theta)) * cSpd + 2.0, // bias upward
        Math.cos(phi) * cSpd
      );
    } else {
      // Stream particles: tightly clustered around stream direction
      const baseAngle = _streamAngles[streamIdx];
      // Very tight spread within stream: ±0.06 radians (~3.5°)
      const angle = baseAngle + (Math.random() - 0.5) * 0.12;
      // Forward speed: ship velocity carries debris forward (-Z)
      const fwdSpeed = shipSpeed * (0.8 + Math.random() * 0.7);
      // Stream direction in XZ plane
      const vx = Math.sin(angle) * fwdSpeed;
      const vz = -Math.cos(angle) * fwdSpeed;
      // Very small vertical scatter (keep streams flat/visible from above)
      const vUp = (Math.random() - 0.45) * 1.5;
      _expVelocities[i].set(vx, vUp, vz);
    }

    // ── Color ──
    if (isCore) {
      // Core fireball: white → hot yellow/orange
      const hotRoll = Math.random();
      if (hotRoll < 0.4) {
        // White-hot center
        _expColors[i * 3]     = 1.0;
        _expColors[i * 3 + 1] = 0.95;
        _expColors[i * 3 + 2] = 0.8;
      } else if (hotRoll < 0.7) {
        // Orange fire
        _expColors[i * 3]     = 1.0;
        _expColors[i * 3 + 1] = 0.6 + Math.random() * 0.3;
        _expColors[i * 3 + 2] = 0.1 + Math.random() * 0.2;
      } else {
        // Yellow
        _expColors[i * 3]     = 1.0;
        _expColors[i * 3 + 1] = 0.85 + Math.random() * 0.15;
        _expColors[i * 3 + 2] = 0.3 + Math.random() * 0.4;
      }
    } else if (hasVerts && meshColors.length >= 3) {
      const ci = Math.floor(Math.random() * vertCount) * 3;
      const meshR = meshColors[ci], meshG = meshColors[ci + 1], meshB = meshColors[ci + 2];
      // 35% chance: hot flash, 65%: inherited mesh color
      if (Math.random() < 0.35) {
        _expColors[i * 3]     = 1.0;
        _expColors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
        _expColors[i * 3 + 2] = 0.3 + Math.random() * 0.4;
      } else {
        _expColors[i * 3]     = meshR;
        _expColors[i * 3 + 1] = meshG;
        _expColors[i * 3 + 2] = meshB;
      }
    } else {
      const col = palette[Math.floor(Math.random() * palette.length)];
      const bright = Math.random() > 0.5;
      _expColors[i * 3]     = bright ? 1.0 : col.r;
      _expColors[i * 3 + 1] = bright ? 0.9 : col.g;
      _expColors[i * 3 + 2] = bright ? 0.7 : col.b;
    }

    _expAlphas[i] = 1.0;

    // ── Size variation ──
    const sizeBase = isCore
      ? 0.25 + Math.random() * 0.35   // core: big glowing chunks
      : 0.06 + Math.random() * 0.18;  // streams: visible fragments
    _expSizes[i] = sizeBase;
    _expStartSizes[i] = sizeBase;
  }
  _expGeo.attributes.position.needsUpdate = true;
  _expGeo.attributes.color.needsUpdate    = true;
  _expGeo.attributes.alpha.needsUpdate    = true;
  _expGeo.attributes.size.needsUpdate     = true;
}

function _updateExplosion(dt) {
  if (!_expActive) return;
  _expSlomoAge += dt;                       // real-time age for slo-mo curve
  const ts = _getExpTimescale(_expSlomoAge); // 1→0.3→1 timescale
  const sDt = dt * ts;                       // scaled dt for explosion
  _expElapsed += sDt;
  _expTime += sDt;
  let allDead = true;
  for (let i = 0; i < _EXP_COUNT; i++) {
    // ── TSL fade formula: opacity = 1.0 - fract((time - startTime) * speed / life) ──
    const tslT = (_expTime - _expStartTime) * _expSpeeds[i] / _expLifetimes[i];
    const faded = tslT >= 1.0;
    if (faded) {
      _expAlphas[i] = 0;
      _expSizes[i] = 0;
      continue;
    }
    allDead = false;
    const opacity = Math.max(0, 1.0 - tslT);
    _expAlphas[i] = opacity;

    // ── Drift with drag — grace period then deceleration ──
    const isCorePart = i < 800;
    const age = _expTime - _expStartTime;
    const dragRamp = Math.min(1, age / 0.15); // 0→1 over first 0.15s
    const baseDrag = isCorePart ? 4.0 : 1.8; // streams: less drag so they stay long
    const dragRate = baseDrag * dragRamp; // near-zero drag initially
    const drag = Math.max(0, 1 - dragRate * dt);
    _expVelocities[i].x *= drag;
    _expVelocities[i].y *= drag;
    _expVelocities[i].z *= drag;
    _expVelocities[i].y -= (isCorePart ? 1.5 : 2.0) * dt; // streams barely drop — stay flat
    _expPositions[i * 3]     += _expVelocities[i].x * dt;
    _expPositions[i * 3 + 1] += _expVelocities[i].y * dt;
    _expPositions[i * 3 + 2] += _expVelocities[i].z * dt;

    // ── Size: shrink over life (TSL-style scale decay) ──
    _expSizes[i] = _expStartSizes[i] * (1.0 - tslT * 0.6);
  }
  _expGeo.attributes.position.needsUpdate = true;
  _expGeo.attributes.alpha.needsUpdate    = true;
  _expGeo.attributes.size.needsUpdate     = true;
  if (allDead) _expActive = false;
}

function _killExplosion() {
  _expActive = false;
  _expElapsed = 0;
  _expDeathZoomActive = false;
  _expCamOrbitActive = false;
  _expCamOrbitT = 0;
  _expTime = 0;
  _expStartTime = 0;
  // Reset camera lookAt from death sky-pivot
  camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
  for (let i = 0; i < _EXP_COUNT; i++) {
    _expPositions[i * 3 + 1] = -9999;
    _expAlphas[i] = 0;
    _expSizes[i] = 0;
  }
  _expGeo.attributes.position.needsUpdate = true;
  _expGeo.attributes.alpha.needsUpdate    = true;
  _expGeo.attributes.size.needsUpdate     = true;
  // Kill all VFX layers
  _killFlash();
  _killShockwave();
  _killSparks();
  _killFaceExplosion();
}

// ═══════════════════════════════════════════════════
//  EXPLOSION LAYER 2: FLASH + BLOOM SPIKE
// ═══════════════════════════════════════════════════
const _flashSpriteMat = new THREE.SpriteMaterial({
  color: 0xffffff,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  opacity: 0,
});
const _flashSprite = new THREE.Sprite(_flashSpriteMat);
_flashSprite.scale.setScalar(0.01); // start tiny
_flashSprite.visible = false;
scene.add(_flashSprite);

const _flashLight = new THREE.PointLight(0xffeedd, 0, 15); // warm white, range 15
_flashLight.visible = false;
scene.add(_flashLight);

let _flashActive = false;
let _flashT = 0;
const _FLASH_DUR = 0.15;   // total flash duration
let _bloomBaseStrength = 0.35;
let _bloomSpikeActive = false;
let _bloomSpikeT = 0;
const _BLOOM_SPIKE_DUR = 0.3;
const _BLOOM_SPIKE_STRENGTH = 1.2; // peak bloom during explosion — subtle punch

function _triggerFlash(pos) {
  _flashSprite.position.copy(pos);
  _flashSprite.visible = true;
  _flashSpriteMat.opacity = 1.0;
  _flashSprite.scale.setScalar(5.0); // brief punch, not screen-filling
  _flashLight.position.copy(pos);
  _flashLight.visible = true;
  _flashLight.intensity = 10;
  _flashActive = true;
  _flashT = 0;
  // Bloom spike
  _bloomBaseStrength = bloom.strength;
  _bloomSpikeActive = true;
  _bloomSpikeT = 0;
}

function _updateFlash(dt) {
  if (_flashActive) {
    _flashT += dt;
    const t = Math.min(1, _flashT / _FLASH_DUR);
    // Fast attack, smooth decay
    const intensity = t < 0.15 ? (t / 0.15) : Math.max(0, 1 - (t - 0.15) / 0.85);
    _flashSpriteMat.opacity = intensity;
    _flashSprite.scale.setScalar(5.0 + t * 4.0); // expand as it fades
    _flashLight.intensity = intensity * 10;
    if (t >= 1) {
      _flashActive = false;
      _flashSprite.visible = false;
      _flashLight.visible = false;
    }
  }
  // Bloom spike: ramp up then ease back to base
  if (_bloomSpikeActive) {
    _bloomSpikeT += dt;
    const bt = Math.min(1, _bloomSpikeT / _BLOOM_SPIKE_DUR);
    // Quick peak at 20%, then ease back
    const peak = bt < 0.2 ? (bt / 0.2) : 1 - (bt - 0.2) / 0.8;
    bloom.strength = _bloomBaseStrength + (_BLOOM_SPIKE_STRENGTH - _bloomBaseStrength) * peak;
    if (bt >= 1) {
      _bloomSpikeActive = false;
      bloom.strength = _bloomBaseStrength;
    }
  }
}

function _killFlash() {
  _flashActive = false;
  _flashSprite.visible = false;
  _flashLight.visible = false;
  if (_bloomSpikeActive) {
    _bloomSpikeActive = false;
    bloom.strength = _bloomBaseStrength;
  }
}

// ═══════════════════════════════════════════════════
//  EXPLOSION LAYER 3: SHIELD-STYLE HEX SHOCKWAVE DISC
//  Flat disc on XZ, hex grid + noise dissolve ripping outward
// ═══════════════════════════════════════════════════
// Shockwave disc: 32 segs is identical to 64 at this size (one-shot effect)
const _shockDiscGeo = new THREE.CircleGeometry(1.0, _mobAA ? 32 : 48);
_shockDiscGeo.rotateX(-Math.PI / 2); // lay flat on XZ plane
const _shockDiscMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:       { value: 0 },
    uColor:      { value: new THREE.Color(0.15, 0.85, 1.0) },    // blue
    uColor2:     { value: new THREE.Color(0.1, 1.0, 0.65) },     // green
    uProgress:   { value: 0.0 },
    uHexScale:   { value: 2.8 },
    uEdgeWidth:  { value: 0.08 },
    uNoiseScale: { value: 1.5 },
  },
  vertexShader: `
    varying vec2 vWorldXZ;
    varying float vRadius;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldXZ = wp.xz;
      // Radius from disc center (position is in local space, disc is unit circle)
      vRadius = length(position.xz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform vec3  uColor;
    uniform vec3  uColor2;
    uniform float uProgress;
    uniform float uHexScale;
    uniform float uEdgeWidth;
    uniform float uNoiseScale;
    varying vec2 vWorldXZ;
    varying float vRadius;

    // Simplex noise (compact)
    vec3 mod289v3(vec3 x){ return x - floor(x*(1./289.))*289.; }
    vec4 mod289v4(vec4 x){ return x - floor(x*(1./289.))*289.; }
    vec4 permute(vec4 x){ return mod289v4(((x*34.)+1.)*x); }
    vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }
    float snoise(vec3 v){
      const vec2 C = vec2(1./6., 1./3.);
      const vec4 D = vec4(0., 0.5, 1., 2.);
      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g  = step(x0.yzx, x0.xyz);
      vec3 l  = 1. - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289v3(i);
      vec4 p = permute(permute(permute(
        i.z+vec4(0.,i1.z,i2.z,1.))
       +i.y+vec4(0.,i1.y,i2.y,1.))
       +i.x+vec4(0.,i1.x,i2.x,1.));
      float n_ = 0.142857142857;
      vec3  ns = n_*D.wyz - D.xzx;
      vec4 j   = p - 49.*floor(p*ns.z*ns.z);
      vec4 x_  = floor(j*ns.z);
      vec4 y_  = floor(j - 7.*x_);
      vec4 x   = x_*ns.x + ns.yyyy;
      vec4 y   = y_*ns.x + ns.yyyy;
      vec4 h   = 1. - abs(x) - abs(y);
      vec4 b0  = vec4(x.xy, y.xy);
      vec4 b1  = vec4(x.zw, y.zw);
      vec4 s0  = floor(b0)*2.+1.;
      vec4 s1  = floor(b1)*2.+1.;
      vec4 sh  = -step(h, vec4(0.));
      vec4 a0  = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1  = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0  = vec3(a0.xy, h.x);
      vec3 p1  = vec3(a0.zw, h.y);
      vec3 p2  = vec3(a1.xy, h.z);
      vec3 p3  = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
      vec4 m = max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
      m = m*m;
      return 42.*dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }

    // Hex grid — same as shield
    float hexPattern(vec2 p){
      p *= uHexScale;
      const vec2 s = vec2(1., 1.7320508);
      vec4 hC = floor(vec4(p, p - vec2(0.5, 1.)) / s.xyxy) + 0.5;
      vec4 h  = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
      vec2 cell = (dot(h.xy, h.xy) < dot(h.zw, h.zw)) ? h.xy : h.zw;
      cell = abs(cell);
      float d = max(dot(cell, s * 0.5), cell.x);
      return smoothstep(0.5 - uEdgeWidth, 0.5, d);
    }

    void main(){
      float noise = snoise(vec3(vWorldXZ * uNoiseScale, uTime * 3.0)) * 0.5 + 0.5;
      float radialNorm = vRadius;

      // Donut ring: band moves outward with progress
      float ringCenter = uProgress * 1.1;
      float ringWidth  = 0.15 + uProgress * 0.06;
      float dist = abs(radialNorm - ringCenter) - noise * 0.06;
      float ringMask = smoothstep(ringWidth, ringWidth * 0.2, dist);

      if (ringMask < 0.01) discard;

      // Hex grid on world XZ
      float hex = hexPattern(vWorldXZ);

      // Color: blue → green across ring
      float colorT = smoothstep(ringCenter - ringWidth, ringCenter + ringWidth, radialNorm);
      vec3 col = mix(uColor, uColor2, colorT);
      vec3 finalCol = col * (1.0 + hex * 2.0) * ringMask;
      float alpha = ringMask * (0.3 + hex * 0.4);
      // Fade out as ring expands
      alpha *= (1.0 - uProgress * 0.85);
      gl_FragColor = vec4(finalCol, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const _shockDiscMesh = new THREE.Mesh(_shockDiscGeo, _shockDiscMat);
_shockDiscMesh.visible = false;
_shockDiscMesh.frustumCulled = false;
scene.add(_shockDiscMesh);

let _shockActive = false;
let _shockT = 0;
const _SHOCK_DUR = 0.55;
const _SHOCK_MAX_SCALE = 2.5;

function _triggerShockwave(pos) {
  _shockDiscMesh.position.copy(pos);
  _shockDiscMesh.position.y += 1.0; // raise to ship center height
  _shockDiscMesh.visible = true;
  _shockDiscMesh.scale.setScalar(0.3);
  _shockDiscMat.uniforms.uProgress.value = 0;
  _shockDiscMat.uniforms.uTime.value = performance.now() / 1000;
  _shockActive = true;
  _shockT = 0;
}

function _updateShockwave(dt) {
  if (!_shockActive) return;
  const shockTs = _expActive ? _getExpTimescale(_expSlomoAge) : 1.0;
  const shockDt = dt * shockTs;
  _shockT += shockDt;
  _shockDiscMat.uniforms.uTime.value += shockDt;
  const t = Math.min(1, _shockT / _SHOCK_DUR);
  const easeT = 1 - Math.pow(1 - t, 2.5);
  const s = 0.3 + _SHOCK_MAX_SCALE * easeT;
  _shockDiscMesh.scale.set(s, 1, s);
  _shockDiscMat.uniforms.uProgress.value = t;
  if (t >= 1) {
    _shockActive = false;
    _shockDiscMesh.visible = false;
  }
}

function _killShockwave() {
  _shockActive = false;
  _shockDiscMesh.visible = false;
}

// ═══════════════════════════════════════════════════
//  EXPLOSION LAYER 5: SHIP FACE EXPLOSION
//  Clone ship geometry, toNonIndexed, vertex shader pushes faces apart
// ═══════════════════════════════════════════════════
let _faceExpGroup = null;       // THREE.Group holding exploding face meshes
let _faceExpActive = false;
let _faceExpT = 0;
const _FACE_EXP_DUR = 0.6;      // how long the faces fly apart
const _FACE_EXP_MAT = new THREE.ShaderMaterial({
  uniforms: {
    uProgress:  { value: 0.0 },
    uImpactDir: { value: new THREE.Vector3(0, 0, -1) },
    uColor:     { value: new THREE.Color(0.15, 0.15, 0.18) },
    uHotColor:  { value: new THREE.Color(1.0, 0.6, 0.2) },
  },
  vertexShader: `
    attribute vec3 faceCentroid;
    attribute vec3 faceNormal;
    uniform float uProgress;
    uniform vec3 uImpactDir;
    varying float vHeat;
    varying float vAlpha;
    void main() {
      // Hard initial kick: sqrt gives instant pop then decelerates
      float t = uProgress;
      float easeT = sqrt(t);
      // Forward carry (-Z) + lateral spread from face normal
      float hash = fract(sin(dot(faceCentroid.xz, vec2(127.1, 311.7))) * 43758.5453);
      float speed = 4.0 + hash * 10.0;
      // Strong forward direction (ship travel = -Z)
      vec3 fwd = vec3(0.0, 0.0, -1.0);
      // Lateral component from face normal (XY only, no Z)
      vec3 lateral = vec3(faceNormal.x, faceNormal.y * 0.3, 0.0);
      vec3 dir = normalize(fwd * 0.7 + lateral * 0.3);
      // Gravity pulls fragments down
      float gravity = easeT * easeT * 3.0;
      vec3 offset = dir * easeT * speed;
      offset.y -= gravity;
      // Slight tumble rotation per face
      float angle = easeT * (2.0 + hash * 6.0);
      float ca = cos(angle), sa = sin(angle);
      // Rotate displaced position around centroid
      vec3 local = position - faceCentroid;
      vec3 axis = normalize(cross(faceNormal, vec3(0., 1., 0.)) + 0.001);
      float d = dot(local, axis);
      vec3 proj = d * axis;
      vec3 perp = local - proj;
      vec3 rotated = proj + perp * ca + cross(axis, perp) * sa;
      vec3 finalPos = faceCentroid + rotated + offset;
      // Heat: early = hot (white-orange), fades to dark
      vHeat = max(0.0, 1.0 - t * 2.5);
      // Fade out at end
      vAlpha = smoothstep(1.0, 0.7, t);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform vec3 uHotColor;
    varying float vHeat;
    varying float vAlpha;
    void main() {
      vec3 col = mix(uColor, uHotColor, vHeat);
      // Emissive boost when hot
      col += uHotColor * vHeat * 1.5;
      gl_FragColor = vec4(col, vAlpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
});

function _triggerFaceExplosion(shipModel, impactDir) {
  // Clean up previous
  if (_faceExpGroup) {
    scene.remove(_faceExpGroup);
    _faceExpGroup.traverse(c => { if (c.geometry) c.geometry.dispose(); });
    _faceExpGroup = null;
  }
  _faceExpGroup = new THREE.Group();
  // Group lives at scene root — no transform, geometry is baked to world space

  _FACE_EXP_MAT.uniforms.uImpactDir.value.copy(impactDir).normalize();
  _FACE_EXP_MAT.uniforms.uProgress.value = 0;

  // Force ship world matrices to be current before we read them
  shipModel.parent.updateMatrixWorld(true);

  shipModel.traverse(child => {
    if (!child.isMesh) return;
    const name = (child.userData._origMatName || child.name || '').toLowerCase();
    if (name.includes('fire')) return; // skip flame meshes
    // Clone and toNonIndexed
    let geo = child.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    // Bake FULL world transform into geometry (scene root = identity)
    geo.applyMatrix4(child.matrixWorld);
    const posAttr = geo.attributes.position;
    const count = posAttr.count;
    const triCount = Math.floor(count / 3);
    // Compute per-face centroid + normal (stored per vertex, same for 3 verts of each tri)
    const centroids = new Float32Array(count * 3);
    const faceNormals = new Float32Array(count * 3);
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const _cb = new THREE.Vector3(), _ab = new THREE.Vector3();
    for (let tri = 0; tri < triCount; tri++) {
      const i0 = tri * 3, i1 = i0 + 1, i2 = i0 + 2;
      vA.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0));
      vB.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1));
      vC.set(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2));
      const cx = (vA.x + vB.x + vC.x) / 3;
      const cy = (vA.y + vB.y + vC.y) / 3;
      const cz = (vA.z + vB.z + vC.z) / 3;
      _cb.subVectors(vC, vB);
      _ab.subVectors(vA, vB);
      _cb.cross(_ab).normalize();
      for (let v = 0; v < 3; v++) {
        const idx = (i0 + v) * 3;
        centroids[idx] = cx; centroids[idx + 1] = cy; centroids[idx + 2] = cz;
        faceNormals[idx] = _cb.x; faceNormals[idx + 1] = _cb.y; faceNormals[idx + 2] = _cb.z;
      }
    }
    geo.setAttribute('faceCentroid', new THREE.BufferAttribute(centroids, 3));
    geo.setAttribute('faceNormal', new THREE.BufferAttribute(faceNormals, 3));
    // Get base color from the original material
    const matClone = _FACE_EXP_MAT.clone();
    if (child.material && child.material.color) {
      matClone.uniforms.uColor.value.copy(child.material.color);
    }
    const mesh = new THREE.Mesh(geo, matClone);
    mesh.frustumCulled = false; // faces fly far, don't cull
    _faceExpGroup.add(mesh);
  });
  scene.add(_faceExpGroup);
  _faceExpActive = true;
  _faceExpT = 0;
}

function _updateFaceExplosion(dt) {
  if (!_faceExpActive) return;
  const faceTs = _expActive ? _getExpTimescale(_expSlomoAge) : 1.0;
  _faceExpT += dt * faceTs;
  const t = Math.min(1, _faceExpT / _FACE_EXP_DUR);
  if (_faceExpGroup) {
    _faceExpGroup.traverse(c => {
      if (c.isMesh && c.material.uniforms) {
        c.material.uniforms.uProgress.value = t;
      }
    });
  }
  if (t >= 1) {
    _faceExpActive = false;
    if (_faceExpGroup) {
      scene.remove(_faceExpGroup);
      _faceExpGroup.traverse(c => { if (c.geometry) c.geometry.dispose(); });
      _faceExpGroup = null;
    }
  }
}

function _killFaceExplosion() {
  _faceExpActive = false;
  _faceExpT = 0;
  if (_faceExpGroup) {
    scene.remove(_faceExpGroup);
    _faceExpGroup.traverse(c => { if (c.geometry) c.geometry.dispose(); });
    _faceExpGroup = null;
  }
}

// ═══════════════════════════════════════════════════
//  EXPLOSION LAYER 4: SPARK JETS
// ═══════════════════════════════════════════════════
const _SPARK_COUNT = 400;
const _sparkPositions  = new Float32Array(_SPARK_COUNT * 3);
const _sparkColors     = new Float32Array(_SPARK_COUNT * 3);
const _sparkAlphas     = new Float32Array(_SPARK_COUNT);
const _sparkSizes      = new Float32Array(_SPARK_COUNT);
const _sparkVelocities = [];
const _sparkLifetimes  = new Float32Array(_SPARK_COUNT);
const _sparkAges       = new Float32Array(_SPARK_COUNT);
for (let i = 0; i < _SPARK_COUNT; i++) {
  _sparkVelocities.push(new THREE.Vector3());
  _sparkPositions[i * 3 + 1] = -9999;
  _sparkAlphas[i] = 0;
  _sparkSizes[i] = 0;
}
const _sparkGeo = new THREE.BufferGeometry();
_sparkGeo.setAttribute('position', new THREE.BufferAttribute(_sparkPositions, 3));
_sparkGeo.setAttribute('color',    new THREE.BufferAttribute(_sparkColors, 3));
_sparkGeo.setAttribute('alpha',    new THREE.BufferAttribute(_sparkAlphas, 1));
_sparkGeo.setAttribute('size',     new THREE.BufferAttribute(_sparkSizes, 1));
const _sparkMat = new THREE.ShaderMaterial({
  vertexShader: `
    attribute float alpha;
    attribute float size;
    attribute vec3 color;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vAlpha = alpha;
      vColor = color;
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (300.0 / -mvPos.z);
      gl_Position = projectionMatrix * mvPos;
    }
  `,
  fragmentShader: `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = dot(uv, uv);
      if (d > 0.25) discard;
      float core = 1.0 - smoothstep(0.0, 0.12, d);
      gl_FragColor = vec4(vColor * 3.0, vAlpha * core);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const _sparkPoints = new THREE.Points(_sparkGeo, _sparkMat);
_sparkPoints.frustumCulled = false;
scene.add(_sparkPoints);

let _sparkActive = false;
const _SPARK_JET_COUNT = 6; // number of directional jets

function _triggerSparks(pos) {
  _sparkActive = true;
  // Create jet directions (random spears outward)
  const jets = [];
  for (let j = 0; j < _SPARK_JET_COUNT; j++) {
    const angle = Math.random() * Math.PI * 2;
    const elev = (Math.random() - 0.3) * Math.PI * 0.6; // slightly upward bias
    jets.push(new THREE.Vector3(
      Math.cos(angle) * Math.cos(elev),
      Math.sin(elev),
      Math.sin(angle) * Math.cos(elev)
    ));
  }
  for (let i = 0; i < _SPARK_COUNT; i++) {
    // Position: at explosion center with tiny random offset
    _sparkPositions[i * 3]     = pos.x + (Math.random() - 0.5) * 0.2;
    _sparkPositions[i * 3 + 1] = pos.y + (Math.random() - 0.5) * 0.15;
    _sparkPositions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.2;
    // Pick a random jet and scatter around it
    const jet = jets[Math.floor(Math.random() * jets.length)];
    const spd = 8 + Math.random() * 18; // fast
    const scatter = 0.3;
    _sparkVelocities[i].set(
      jet.x * spd + (Math.random() - 0.5) * scatter * spd,
      jet.y * spd + (Math.random() - 0.5) * scatter * spd + 2,
      jet.z * spd + (Math.random() - 0.5) * scatter * spd
    );
    // Life: short (0.2 - 0.6s)
    _sparkLifetimes[i] = 0.2 + Math.random() * 0.4;
    _sparkAges[i] = 0;
    // Color: hot white → orange → red
    _sparkColors[i * 3]     = 1.0;
    _sparkColors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
    _sparkColors[i * 3 + 2] = 0.2 + Math.random() * 0.3;
    _sparkAlphas[i] = 1.0;
    _sparkSizes[i] = 0.03 + Math.random() * 0.06; // hot sparks visible at camera distance
  }
  _sparkGeo.attributes.position.needsUpdate = true;
  _sparkGeo.attributes.color.needsUpdate    = true;
  _sparkGeo.attributes.alpha.needsUpdate    = true;
  _sparkGeo.attributes.size.needsUpdate     = true;
}

function _updateSparks(dt) {
  if (!_sparkActive) return;
  let allDead = true;
  for (let i = 0; i < _SPARK_COUNT; i++) {
    _sparkAges[i] += dt;
    if (_sparkAges[i] >= _sparkLifetimes[i]) {
      _sparkAlphas[i] = 0;
      _sparkSizes[i] = 0;
      continue;
    }
    allDead = false;
    const lifeT = _sparkAges[i] / _sparkLifetimes[i];
    // Fade out
    _sparkAlphas[i] = 1.0 - lifeT;
    // Strong gravity + drag
    _sparkVelocities[i].x *= Math.max(0, 1 - 3.0 * dt);
    _sparkVelocities[i].y *= Math.max(0, 1 - 3.0 * dt);
    _sparkVelocities[i].z *= Math.max(0, 1 - 3.0 * dt);
    _sparkVelocities[i].y -= 15.0 * dt; // strong gravity
    _sparkPositions[i * 3]     += _sparkVelocities[i].x * dt;
    _sparkPositions[i * 3 + 1] += _sparkVelocities[i].y * dt;
    _sparkPositions[i * 3 + 2] += _sparkVelocities[i].z * dt;
    // Color shift: cool from white→yellow→orange→red over life
    _sparkColors[i * 3]     = 1.0;
    _sparkColors[i * 3 + 1] = Math.max(0.1, 0.8 - lifeT * 0.7);
    _sparkColors[i * 3 + 2] = Math.max(0.0, 0.4 - lifeT * 0.4);
  }
  _sparkGeo.attributes.position.needsUpdate = true;
  _sparkGeo.attributes.alpha.needsUpdate    = true;
  _sparkGeo.attributes.size.needsUpdate     = true;
  _sparkGeo.attributes.color.needsUpdate    = true;
  if (allDead) _sparkActive = false;
}

function _killSparks() {
  _sparkActive = false;
  for (let i = 0; i < _SPARK_COUNT; i++) {
    _sparkPositions[i * 3 + 1] = -9999;
    _sparkAlphas[i] = 0;
    _sparkSizes[i] = 0;
  }
  _sparkGeo.attributes.position.needsUpdate = true;
  _sparkGeo.attributes.alpha.needsUpdate    = true;
  _sparkGeo.attributes.size.needsUpdate     = true;
}


// ═══════════════════════════════════════════════════
//  GIANT SUN
// ═══════════════════════════════════════════════════
// A large emissive sphere sitting low on the horizon, with a soft sprite halo
const SUN_Z   = -340;  // far back on the horizon
const SUN_Y   = -2;    // low — just peeking above the floor plane
const SUN_R   = 112;   // big radius (doubled)

// Core sphere — emissive solid disc look
// Sun: silhouette-only (always far). 32x32 is visually identical to 64x64
// and saves ~6k tris. _mobAA is set on mobile UAs (line 1106).
// Sun is a hero visual element — use full 48 segments on mobile too.
// 16 extra triangles on a single sphere is negligible perf, but eliminates
// visible silhouette/corona faceting that was happening at 32 segments.
const _SUN_SEG = 48;
const sunGeo = new THREE.SphereGeometry(SUN_R * 0.95, _SUN_SEG, _SUN_SEG);
const sunMat = new THREE.ShaderMaterial({
  uniforms: {
    uSunColor: { value: new THREE.Color(LEVELS[0].sunColor) },
    uTime:     { value: 0.0 },
    uIsUV:     { value: 0.0 },  // blend 0..1 for L2 ULTRAVIOLET (smooth transition)
    uIsIce:    { value: 0.0 },  // blend 0..1 for L4 ICE STORM (smooth transition)
    uIsGold:   { value: 0.0 },  // blend 0..1 for L5 VOID SINGULARITY (smooth transition)
    uIsL3:     { value: 0.0 },  // blend 0..1 for L3 SOLAR FLARE (red shift)
    uIsL3Warp: { value: 0.0 },  // blend 0..1 for L3 Quilez domain warp (crimson boil)
    uWarpCol1: { value: new THREE.Vector3(0.25, 0.04, 0.02) },
    uWarpCol2: { value: new THREE.Vector3(0.85, 0.15, 0.04) },
    uWarpCol3: { value: new THREE.Vector3(1.0,  0.45, 0.08) },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldNormal;
    varying float vModelY;
    varying float vRadial;
    void main() {
      vUv          = uv;
      vNormal      = normalize(normalMatrix * normal);
      vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vModelY      = position.y / ${(SUN_R * 0.95).toFixed(1)};
      vRadial      = length(vec2(position.x * 0.55, position.y)) / ${(SUN_R * 0.95).toFixed(1)};
      gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform vec3  uSunColor;
    uniform float uTime;
    uniform float uIsUV;    // 0..1 blend for UV gradient
    uniform float uIsIce;   // 0..1 blend for ice warp
    uniform float uIsGold;  // 0..1 blend for gold warp
    uniform float uIsL3;    // 0..1 blend for L3 red shift
    uniform float uIsL3Warp; // 0..1 blend for L3 Quilez crimson boil
    uniform vec3 uWarpCol1;
    uniform vec3 uWarpCol2;
    uniform vec3 uWarpCol3;
    varying vec2  vUv;
    varying vec3  vNormal;
    varying vec3  vWorldNormal;
    varying float vModelY;
    varying float vRadial;

    // --- 2D hash + FBM (used by all levels) ---
    float hash(vec2 p) {
      p = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }
    float smoothNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i),             hash(i + vec2(1,0)), u.x),
        mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x),
        u.y
      );
    }
    float fbm2(vec2 p) {
      float v = 0.0; float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * smoothNoise(p);
        p *= 2.1; a *= 0.5;
      }
      return v;
    }

    // --- Ashima Arts / Ian McEwan simplex noise (MIT license) ---
    vec3 mod289v3(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec4 mod289v4(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289v4(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g  = step(x0.yzx, x0.xyz);
      vec3 l  = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289v3(i);
      vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3  ns = n_ * D.wyz - D.xzx;
      vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x  = x_ * ns.x + ns.yyyy;
      vec4 y  = y_ * ns.x + ns.yyyy;
      vec4 h  = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }
    // FBM built on simplex
    float fbmS(vec3 p) {
      float v = 0.0; float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * (snoise(p) * 0.5 + 0.5); // remap -1..1 to 0..1
        p *= 2.1; a *= 0.5;
      }
      return v; // 0..1
    }

    void main() {
      float limb = dot(vNormal, vec3(0.0, 0.0, 1.0));
      limb = clamp(limb, 0.0, 1.0);

      // ── Compute all shader branches, then blend ──
      vec3 colPlain, colIce, colGold, colL3Warp;

      // ── PLAIN branch (L1, L3) — ref-matched: radial gradient + top bias + corona ──
      {
        float yN = vModelY * 0.5 + 0.5;          // 0 bottom, 1 top
        float rd = clamp(vRadial, 0.0, 1.0);     // 0 center, 1 rim (vertex-position based)

        // Surface noise churn
        vec2 noiseUv = vUv * 3.2 + vec2(uTime * 0.015, uTime * 0.008);
        float n = fbm2(noiseUv);
        float churnBase = 0.94 + n * 0.12;
        float churnL3   = 0.85 + n * 0.30;
        float churn = mix(churnBase, churnL3, uIsL3);

        // 1) RADIAL GRADIENT: dark center → brighter edges
        //    L1 hardcoded, L3 red-shifted via uIsL3 mix
        vec3 coreL1 = vec3(0.68, 0.24, 0.02);
        vec3 rimL1  = vec3(0.90, 0.38, 0.04);
        vec3 coreL3 = vec3(0.58, 0.12, 0.02);
        vec3 rimL3  = vec3(0.95, 0.28, 0.04);
        vec3 coreCol = mix(coreL1, coreL3, uIsL3);
        vec3 rimCol  = mix(rimL1,  rimL3,  uIsL3);
        float radialFade = smoothstep(0.15, 0.85, rd);
        vec3 col = mix(coreCol, rimCol, radialFade);

        // 2) TOP GLOW: upper body glows hotter/lighter, lower half slightly muted
        float topGlow = smoothstep(0.45, 0.85, yN);
        vec3 glowL1 = vec3(0.18, 0.10, 0.02);
        vec3 glowL3 = vec3(0.18, 0.06, 0.02);
        col += mix(glowL1, glowL3, uIsL3) * topGlow;
        float botDim = 1.0 - 0.08 * smoothstep(0.60, 0.48, yN);
        col *= botDim;

        // 3) CORONA: bright edge glow, strong at top + horizon line
        vec3 coronaL1 = vec3(1.0, 0.55, 0.08);
        vec3 coronaL3 = vec3(1.0, 0.35, 0.06);
        vec3 corona = mix(coronaL1, coronaL3, uIsL3);
        float coronaBlend = smoothstep(0.82, 0.97, rd);
        // Bright at top arc AND at horizon (bottom of visible disc ~yN 0.5)
        float horizonBand = smoothstep(0.58, 0.50, yN); // bright near horizon
        float topArc = smoothstep(0.4, 0.9, yN);        // bright at top
        float coronaBias = max(topArc, horizonBand * 0.85);
        coronaBias = 0.3 + 0.7 * coronaBias;
        col = mix(col, corona, coronaBlend * coronaBias);

        // Black edge kill
        col *= smoothstep(0.0, 0.05, limb);

        colPlain = col * churn;
      }

      // ── UV branch (L2 ULTRAVIOLET) — radial gradient like L1 but purple ───
      vec3 colUV;
      if (uIsUV > 0.0) {
        float rd = clamp(vRadial, 0.0, 1.0);
        float yN = vModelY * 0.5 + 0.5;

        // Radial: deep purple center → brighter magenta at edges (subtler)
        vec3 coreCol = uSunColor * 0.42;                          // purple center
        vec3 rimCol  = uSunColor * 0.82;                          // bright magenta near edges
        float radialFade = smoothstep(0.15, 0.88, rd);
        vec3 col = mix(coreCol, rimCol, radialFade);

        // Surface noise for depth
        vec2 noiseUv = vUv * 3.2 + vec2(uTime * 0.015, uTime * 0.008);
        float n = fbm2(noiseUv);
        col *= 0.92 + n * 0.16;

        // Top glow
        float topGlow = smoothstep(0.45, 0.85, yN);
        col += uSunColor * 0.20 * topGlow;

        // Corona edge
        vec3 corona = min(uSunColor * 1.5 + vec3(0.25, 0.12, 0.25), 1.0);
        float coronaBlend = smoothstep(0.82, 0.97, rd);
        float coronaBias = 0.3 + 0.7 * max(smoothstep(0.4, 0.9, yN), smoothstep(0.58, 0.50, yN) * 0.85);
        col = mix(col, corona, coronaBlend * coronaBias);

        // Black edge kill
        col *= smoothstep(0.0, 0.05, limb);

        colUV = col;
      } else { colUV = colPlain; }

      // ── ICE branch (L4) ──────────────────────────────────────────
      if (uIsIce > 0.0) {
        // ── L4 ICE STORM — Quilez double domain warp ──────────────
        // Steep limb darkening: black rim → rich ice → bright core
        float darkening = pow(limb, 2.2);

        // Base coord: world normal (spherical, no seams) + time drift
        // Each warp layer drifts at a different rate so they churn independently
        vec3 p = vWorldNormal * 3.5;

        // ── Pass 1: q — first displacement field ──
        // Two offset seeds so q.x and q.y are uncorrelated
        vec3 q = vec3(
          fbmS(p + vec3(0.0, 0.0, 0.0)        + vec3(uTime*0.031, uTime*0.021, uTime*0.013)),
          fbmS(p + vec3(5.2, 1.3, 2.7)        + vec3(uTime*0.025, uTime*0.018, uTime*0.011)),
          fbmS(p + vec3(3.1, 4.4, 1.1)        + vec3(uTime*0.019, uTime*0.027, uTime*0.015))
        );

        // ── Pass 2: r — second displacement field, warped by q ──
        vec3 qOff = p + 3.5 * q;
        vec3 r = vec3(
          fbmS(qOff + vec3(1.7, 9.2, 4.3)     + vec3(uTime*0.017, uTime*0.012, uTime*0.008)),
          fbmS(qOff + vec3(8.3, 2.8, 6.1)     + vec3(uTime*0.022, uTime*0.016, uTime*0.010)),
          fbmS(qOff + vec3(2.9, 7.5, 0.8)     + vec3(uTime*0.014, uTime*0.020, uTime*0.009))
        );

        // ── Final value: doubly warped FBM ──
        float f = fbmS(p + 3.5 * r + vec3(uTime*0.011, uTime*0.008, uTime*0.006));
        // f in 0..1

        // ── Color ramp from f, |q|, r.y (Quilez coloring method) ──
        // Base: ice blue. Hot core: near-white. Cold pockets: deep teal.
        vec3 iceBlue   = uSunColor;                         // 0xaaeeff
        vec3 hotWhite  = min(uSunColor * 1.25, vec3(1.0));  // near-white hot spot
        vec3 deepTeal  = uSunColor * 0.35;                  // cold dark pocket

        // f drives overall brightness — high f = hot bright
        vec3 col = mix(deepTeal, iceBlue, smoothstep(0.2, 0.7, f));
        col = mix(col, hotWhite, smoothstep(0.6, 0.9, f));

        // |q| adds streaky plasma tendrils across the surface
        float qMag = length(q) / 1.73; // normalise ~0..1
        col = mix(col, iceBlue * 1.1, smoothstep(0.4, 0.8, qMag) * 0.35);

        // r.y shifts the deep pockets darker — gives depth
        col = mix(col, deepTeal, smoothstep(0.6, 0.9, r.y) * 0.4);

        // ── Limb darkening — black at rim, full color inward ──
        col *= smoothstep(0.0, 0.30, darkening);  // black edge
        col = mix(col, col * 1.15, smoothstep(0.5, 1.0, darkening)); // extra core brightness
        colIce = col;
      } else { colIce = colPlain; }

      // ── L3 CRIMSON WARP branch ── Quilez domain warp with red/crimson palette
      if (uIsL3Warp > 0.0) {
        float darkening = pow(limb, 2.2);
        vec3 p = vWorldNormal * 3.5;
        vec3 q = vec3(
          fbmS(p + vec3(0.0, 0.0, 0.0) + vec3(uTime*0.031, uTime*0.021, uTime*0.013)),
          fbmS(p + vec3(5.2, 1.3, 2.7) + vec3(uTime*0.025, uTime*0.018, uTime*0.011)),
          fbmS(p + vec3(3.1, 4.4, 1.1) + vec3(uTime*0.019, uTime*0.027, uTime*0.015))
        );
        vec3 qOff = p + 3.5 * q;
        vec3 r = vec3(
          fbmS(qOff + vec3(1.7, 9.2, 4.3) + vec3(uTime*0.017, uTime*0.012, uTime*0.008)),
          fbmS(qOff + vec3(8.3, 2.8, 6.1) + vec3(uTime*0.022, uTime*0.016, uTime*0.010)),
          fbmS(qOff + vec3(2.9, 7.5, 0.8) + vec3(uTime*0.014, uTime*0.020, uTime*0.009))
        );
        float f = fbmS(p + 3.5 * r + vec3(uTime*0.011, uTime*0.008, uTime*0.006));
        // Warp palette — tunable via uWarpCol1/2/3 uniforms
        vec3 deepRed  = uWarpCol1;
        vec3 crimson  = uWarpCol2;
        vec3 hotFire  = uWarpCol3;
        vec3 col = mix(deepRed, crimson, smoothstep(0.2, 0.7, f));
        col = mix(col, hotFire, smoothstep(0.6, 0.9, f));
        float qMag = length(q) / 1.73;
        col = mix(col, crimson * 1.1, smoothstep(0.4, 0.8, qMag) * 0.35);
        col = mix(col, deepRed, smoothstep(0.6, 0.9, r.y) * 0.4);
        col *= smoothstep(0.0, 0.30, darkening);
        col = mix(col, col * 1.15, smoothstep(0.5, 1.0, darkening));
        colL3Warp = col;
      } else { colL3Warp = colPlain; }

      // ── GOLD branch (L5) ─────────────────────────────────────────
      if (uIsGold > 0.0) {
        // ── L5 VOID SINGULARITY — Podgursky + Quilez domain warp ──
        float darkening = pow(limb, 2.2);

        vec3 p = vWorldNormal * 3.5;

        // Pass 1: q
        vec3 q = vec3(
          fbmS(p + vec3(0.0, 0.0, 0.0)   + vec3(uTime*0.028, uTime*0.019, uTime*0.012)),
          fbmS(p + vec3(5.2, 1.3, 2.7)   + vec3(uTime*0.022, uTime*0.016, uTime*0.010)),
          fbmS(p + vec3(3.1, 4.4, 1.1)   + vec3(uTime*0.017, uTime*0.024, uTime*0.014))
        );

        // Pass 2: r — warped by q
        vec3 qOff = p + 3.5 * q;
        vec3 r = vec3(
          fbmS(qOff + vec3(1.7, 9.2, 4.3) + vec3(uTime*0.015, uTime*0.011, uTime*0.007)),
          fbmS(qOff + vec3(8.3, 2.8, 6.1) + vec3(uTime*0.020, uTime*0.014, uTime*0.009)),
          fbmS(qOff + vec3(2.9, 7.5, 0.8) + vec3(uTime*0.012, uTime*0.018, uTime*0.008))
        );

        // Final doubly-warped value
        float f = fbmS(p + 3.5 * r + vec3(uTime*0.010, uTime*0.007, uTime*0.005));

        // Podgursky sunspots — dark blobs subtracted
        vec3 gc2 = vWorldNormal * 1.1 + vec3(uTime*0.009, uTime*0.006, uTime*0.004);
        float sn2 = snoise(gc2) * 2.5 - 1.7;
        float spots = max(0.0, sn2);

        // Broad hot regions
        vec3 gc3 = vWorldNormal * 0.5 + vec3(uTime*0.005, uTime*0.003, uTime*0.002);
        float brightSpot = max(0.0, snoise(gc3) * 1.3 - 0.7);

        // Combine: warp drives structure, Podgursky adds surface detail
        float total = clamp(f - spots * 0.4 + brightSpot * 0.3, 0.0, 1.0);

        // Gold color ramp: deep amber → gold → yellow-white hot core
        vec3 deepAmber   = uSunColor * 0.30;                   // dark burnt orange pocket
        vec3 gold        = uSunColor;                           // 0xffaa33 full gold
        vec3 hotYellow   = min(vec3(1.0, 0.95, 0.6), vec3(1.0)); // yellow-white hot core

        vec3 col = mix(deepAmber, gold, smoothstep(0.2, 0.65, total));
        col = mix(col, hotYellow, smoothstep(0.62, 0.88, total));

        // |q| streaks — brighter gold plasma tendrils
        float qMag = length(q) / 1.73;
        col = mix(col, gold * 1.15, smoothstep(0.4, 0.8, qMag) * 0.30);

        // r.y deep pockets
        col = mix(col, deepAmber, smoothstep(0.6, 0.9, r.y) * 0.35);

        // Limb darkening
        col *= smoothstep(0.0, 0.30, darkening);
        col = mix(col, col * 1.15, smoothstep(0.5, 1.0, darkening));
        colGold = col;
      } else { colGold = colPlain; }

      // ── Final blend: plain → UV → ice → gold ─────────────────────
      vec3 finalCol = colPlain;
      finalCol = mix(finalCol, colUV,      clamp(uIsUV,      0.0, 1.0));
      finalCol = mix(finalCol, colL3Warp,  clamp(uIsL3Warp,  0.0, 1.0));
      finalCol = mix(finalCol, colIce,     clamp(uIsIce,     0.0, 1.0));
      finalCol = mix(finalCol, colGold,    clamp(uIsGold,    0.0, 1.0));
      gl_FragColor = vec4(finalCol, 1.0);
    }
  `,
  fog: false,
});
const sunMesh = new THREE.Mesh(sunGeo, sunMat);
sunMesh.position.set(0, SUN_Y, SUN_Z);
// sunMesh renderOrder = 0 (default) — opaque, draws after stars (-9) naturally
scene.add(sunMesh);

// Sun cap disc — opaque circle sitting just in front of the sun sphere (Z+4),
// renderOrder=1 so it draws AFTER the tendrils (renderOrder=0) and paints over
// any tendril roots that bleed onto the sun face. Color tracks sunColor.
// Sun cap circle: 32 segs is indistinguishable from 64 at this size/distance
// Match sun sphere segments (48) on mobile too — sun cap traces the same
// silhouette as the sphere, faceting at 32 was visible against the corona.
const sunCapGeo = new THREE.CircleGeometry(SUN_R * 0.95, 48);
const sunCapMat = new THREE.ShaderMaterial({
  uniforms: {
    uSunColor: { value: new THREE.Color(LEVELS[0].sunColor) },
    uRadius:   { value: SUN_R * 0.95 },
    uIsUV:     { value: 0.0 },
    uIsIce:    { value: 0.0 },
    uIsGold:   { value: 0.0 },
    uIsL3:     { value: 0.0 },
    uIsL3Warp: { value: 0.0 },
    uWarpCol1: { value: new THREE.Vector3(0.25, 0.04, 0.02) }, // deep dark
    uWarpCol2: { value: new THREE.Vector3(0.85, 0.15, 0.04) }, // mid
    uWarpCol3: { value: new THREE.Vector3(1.0,  0.45, 0.08) }, // bright
  },
  vertexShader: `
    varying vec2 vPos;
    void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    precision highp float;
    uniform vec3  uSunColor;
    uniform float uRadius;
    uniform float uIsUV;
    uniform float uIsIce;
    uniform float uIsGold;
    varying vec2  vPos;
    void main() {
      float r = length(vPos) / uRadius; // 0 at center, 1 at edge

      // Plain (L1/L3) — vertical body gradient + radial rim (matches sphere shader)
      // Cap is a flat disc so we use vPos.y as vertical coord
      float yN = (vPos.y / uRadius) * 0.5 + 0.5; // 0 bottom, 1 top
      vec3 tint = uSunColor;
      vec3 botCol = tint * 0.55;
      vec3 topCol = tint * 1.0;
      vec3 body = mix(botCol, topCol, smoothstep(0.0, 1.0, yN));
      vec3 hotRim = min(tint * 1.3 + vec3(0.10, 0.06, 0.0), 1.0);
      float rimBlend = smoothstep(0.65, 0.90, r);
      vec3 col = mix(body, hotRim, rimBlend);
      vec3 corona = min(tint * 0.7 + vec3(0.35, 0.30, 0.15), 1.0);
      float coronaBlend = smoothstep(0.88, 0.97, r);
      float coronaTopBias = 0.6 + 0.4 * smoothstep(0.0, 0.8, yN);
      col = mix(col, corona, coronaBlend * coronaTopBias);
      vec3 plainCol = col * (1.0 - smoothstep(0.75, 1.0, r));

      // Other levels: flat fill tapered at edge (original behavior)
      vec3 otherCol = uSunColor * (1.0 - smoothstep(0.75, 1.0, r));

      // Blend: if any special level active, use otherCol
      float special = clamp(uIsUV + uIsIce + uIsGold, 0.0, 1.0);
      gl_FragColor = vec4(mix(plainCol, otherCol, special), 1.0);
    }
  `,
  transparent: false,
  depthWrite: true,
  fog: false,
});
const sunCapMesh = new THREE.Mesh(sunCapGeo, sunCapMat);
sunCapMesh.position.set(0, SUN_Y, SUN_Z + 4);
sunCapMesh.renderOrder = 1;
scene.add(sunCapMesh);

// Glow + corona baked into one canvas/mesh — avoids alignment issues
// Canvas size 1024 for sharp ring strokes
const glowCanvas = document.createElement('canvas');
glowCanvas.width = glowCanvas.height = 1024;
const gc = glowCanvas.getContext('2d');
const GS = 1024, GC = GS / 2;

// Corona — drawn as bright arc segments directly on black canvas, additive blended in-game
// Black bg adds nothing; bright pixels add light on top of the sphere.
// Weight: thickest at top (12-o'clock), tapers to thin at sides.
const ringR_gc = GC * 0.625;
(function drawCorona() {
  // Canvas coord mapping (verified):
  //   crownY = GC - ringR_gc ≈ 192px = top of sun disc in world
  //   PI→2PI arc = canvas top semicircle = world top arc ✓
  //   angle PI/2 in canvas = downward = into sun body in world ✓

  const STEPS = 200;
  const crownY = GC - ringR_gc; // top edge of sun disc

  // ── 1. Crown bloom — clipped strictly to corona arc circle ──
  gc.save();
  gc.beginPath();
  gc.arc(GC, GC, ringR_gc, 0, Math.PI * 2); // clip to exact corona radius
  gc.clip();
  gc.save();
  gc.translate(GC, crownY);
  gc.scale(2.2, 1.0);
  const crownBloomR = ringR_gc * 0.85;
  const crownGrad = gc.createRadialGradient(0, 0, 0, 0, 0, crownBloomR);
  crownGrad.addColorStop(0.0,  'rgba(255,255,220,0.22)');
  crownGrad.addColorStop(0.15, 'rgba(255,230,120,0.16)');
  crownGrad.addColorStop(0.40, 'rgba(255,170,40,0.08)');
  crownGrad.addColorStop(1.0,  'rgba(0,0,0,0)');
  gc.fillStyle = crownGrad;
  gc.fillRect(-crownBloomR * 2.5, -crownBloomR, crownBloomR * 5, crownBloomR * 2);
  gc.restore();
  gc.restore();

  // ── 2. Limb arc — boosted alphas/widths to survive ACES tone mapping ──
  function coronaWeight(t) {
    const mid = Math.abs(t - 0.5) * 2;
    return 0.28 + 0.72 * Math.pow(1 - mid, 1.6);
  }
  const layers = [
    { rOff: -8,  w: 16, color: [255, 130, 25],  a: 0.35 },
    { rOff: -3,  w: 12, color: [255, 170, 55],  a: 0.70 },
    { rOff:  0,  w: 10, color: [255, 215, 95],  a: 1.00 },
    { rOff:  0,  w:  4, color: [255, 250, 200], a: 1.00 },
    { rOff:  3,  w: 10, color: [255, 185, 60],  a: 0.70 },
    { rOff:  8,  w: 16, color: [255, 148, 30],  a: 0.30 },
  ];
  for (const L of layers) {
    for (let i = 0; i < STEPS; i++) {
      const t = (i + 0.5) / STEPS;
      const wt = coronaWeight(t);
      if (wt < 0.01) continue;
      gc.beginPath();
      gc.lineWidth = Math.max(0.5, wt * L.w);
      gc.strokeStyle = `rgba(${L.color[0]},${L.color[1]},${L.color[2]},${(L.a * wt).toFixed(3)})`;
      gc.arc(GC, GC, ringR_gc + L.rOff, Math.PI + (i / STEPS) * Math.PI, Math.PI + ((i + 1) / STEPS) * Math.PI);
      gc.stroke();
    }
  }

}());

const glowTex = new THREE.CanvasTexture(glowCanvas);
const glowSpriteGeo = new THREE.PlaneGeometry(SUN_R * 3.2, SUN_R * 3.2);
const glowSpriteMat = new THREE.MeshBasicMaterial({
  map: glowTex, transparent: true, blending: THREE.AdditiveBlending,
  depthWrite: false, depthTest: true, fog: false,
});
const sunGlowSprite = new THREE.Mesh(glowSpriteGeo, glowSpriteMat);
sunGlowSprite.position.set(0, SUN_Y, SUN_Z + 1);  // 1 unit in front of sun sphere
sunGlowSprite.renderOrder = 3;  // draw after sun (2) and stars (1)
scene.add(sunGlowSprite);
const _sunBillboardV3 = new THREE.Vector3(); // reusable temp for sun billboard lookAt

const sunRayMeshes = []; // rays removed — were causing dark artifact lines

// ═══════════════════════════════════════════════════
//  HORIZON SEAM  (thin bright line at the sun’s equator / waterline)
// ═══════════════════════════════════════════════════
// A very thin wide plane at SUN_Y (sun equator) — the white glowing
// line in the reference where sun base meets the water surface.

const rimCanvas = document.createElement('canvas');
rimCanvas.width  = 512;
rimCanvas.height = 16;
const rimCtx  = rimCanvas.getContext('2d');
const rimGrad = rimCtx.createLinearGradient(0, 0, 512, 0);
rimGrad.addColorStop(0.0,  'rgba(255,255,255,0)');
rimGrad.addColorStop(0.10, 'rgba(255,220,160,0.30)');
rimGrad.addColorStop(0.32, 'rgba(255,245,200,0.85)');
rimGrad.addColorStop(0.50, 'rgba(255,255,255,1.00)');
rimGrad.addColorStop(0.68, 'rgba(255,245,200,0.85)');
rimGrad.addColorStop(0.90, 'rgba(255,220,160,0.30)');
rimGrad.addColorStop(1.0,  'rgba(255,255,255,0)');
rimCtx.fillStyle = rimGrad;
rimCtx.fillRect(0, 0, 512, 16);
const rimTex = new THREE.CanvasTexture(rimCanvas);

const rimGlowGeo = new THREE.PlaneGeometry(SUN_R * 2.5, 2.8);
const rimGlowMat = new THREE.MeshBasicMaterial({
  map: rimTex, transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false, fog: false,
});
const sunRimGlow = new THREE.Mesh(rimGlowGeo, rimGlowMat);
sunRimGlow.position.set(0, SUN_Y, SUN_Z + 2);
sunRimGlow.renderOrder = 3;
sunRimGlow.frustumCulled = false;
scene.add(sunRimGlow);

const rimGlowCtx = rimCtx;
const rimGlowTex = rimTex;

// ═══════════════════════════════════════════════════
//  SKY STAR BACKDROP — canvas texture, NDC quad
// ═══════════════════════════════════════════════════
// GPU Twinkling Stars — THREE.Points with ShaderMaterial
// Each star blinks independently via per-vertex seed attribute.
// Constellation lines via LineSegments with slow breath pulse.
// All on layer 3 (excluded from Water reflection camera).
// transparent:false + alphaTest:0.01 keeps in opaque queue
// so sunMesh (renderOrder=0) naturally draws on top.
// ═══════════════════════════════════════════════════
let skyStarPoints = null;     // exported so animate loop can update uTime
let skyConstellLines = null;  // constellation LineSegments

(function buildSkyStars() {
  // ── Seeded LCG deterministic random ──
  let _seed = 42;
  function rng() {
    _seed = (_seed * 1664525 + 1013904223) & 0xffffffff;
    return ((_seed >>> 0) / 0xffffffff);
  }
  function rngRange(a, b) { return a + rng() * (b - a); }

  // ── Horizon & sun constants (NDC space) ──
  // NDC y range: -1 (bottom) → +1 (top).
  // Horizon is at UV y=0.58 → NDC y = 0.58*2-1 = 0.16
  // Sun center UV (0.5, 0.511) → NDC (0.0, 0.022), radius UV 0.155 → NDC 0.31
  const HORIZON_NDC = -0.40;  // extend stars well below horizon — water covers them, but they show during rolls
  const SUN_CX_NDC  = 0.0;
  const SUN_CY_NDC  = 0.022;
  const SUN_R_NDC   = 0.36;   // slightly larger than sun disc (0.31) for clean corona masking

  // ── Color palette — 7 entries encoded as vec3 for shader ──
  // We'll pass color per vertex as a BufferAttribute (r,g,b floats 0-1)
  const PALETTE = [
    [1.00, 1.00, 1.00],   // pure white
    [1.00, 1.00, 1.00],   // pure white
    [1.00, 1.00, 1.00],   // pure white
    [1.00, 1.00, 1.00],   // pure white
    [0.96, 0.98, 1.00],   // barely-blue white (1 in 5)
  ];

  function pickColor() {
    return PALETTE[Math.floor(rng() * PALETTE.length)];
  }

  // Returns true if an NDC point is in the sky zone (above horizon, not inside sun disc)
  function isValidSkyPos(nx, ny) {
    if (ny < HORIZON_NDC + 0.04) return false;  // above horizon with small margin
    const dx = nx - SUN_CX_NDC;
    const dy = ny - SUN_CY_NDC;
    if (dx*dx + dy*dy < SUN_R_NDC * SUN_R_NDC) return false;  // inside sun disc
    return true;
  }

  // ── Build star positions ──
  // We work in NDC space: x in [-1,1], y in [HORIZON_NDC, 1]
  // Positions passed as z=0 (NDC quad, no perspective)

  const positions = [];
  const colors    = [];
  const seeds     = [];    // per-star random seed for twinkle phase
  const sizes     = [];    // per-star base point size in pixels

  // 1. Sparse field — 700 scattered stars
  const FIELD_COUNT = 350;
  let fieldAdded = 0;
  let attempts = 0;
  while (fieldAdded < FIELD_COUNT && attempts < FIELD_COUNT * 8) {
    attempts++;
    const nx = rngRange(-1.0, 1.0);
    const ny = rngRange(HORIZON_NDC + 0.04, 1.0);
    if (!isValidSkyPos(nx, ny)) continue;
    positions.push(nx, ny, 0);
    const c = pickColor();
    colors.push(c[0], c[1], c[2]);
    seeds.push(rng() * 628.318);   // random phase 0–2π*100
    sizes.push(rngRange(0.6, 2.0));
    fieldAdded++;
  }

  // 2. Clusters — 8 gaussian blobs
  const CLUSTERS = [
    { cx: 0.70, cy: 0.72, sx: 0.08, sy: 0.06, count: 30 },
    { cx:-0.65, cy: 0.50, sx: 0.06, sy: 0.05, count: 22 },
    { cx: 0.10, cy: 0.84, sx: 0.10, sy: 0.07, count: 38 },
    { cx:-0.40, cy: 0.25, sx: 0.05, sy: 0.04, count: 16 },
    { cx: 0.88, cy: 0.35, sx: 0.04, sy: 0.04, count: 14 },
    { cx:-0.78, cy: 0.60, sx: 0.07, sy: 0.05, count: 24 },
    { cx: 0.42, cy: 0.55, sx: 0.06, sy: 0.04, count: 18 },
    { cx:-0.15, cy: 0.40, sx: 0.08, sy: 0.06, count: 26 },
  ];
  for (const cl of CLUSTERS) {
    let added = 0, att = 0;
    while (added < cl.count && att < cl.count * 10) {
      att++;
      const u1 = rng(), u2 = rng();
      const mag = Math.sqrt(-2 * Math.log(u1 + 1e-9));
      const ang = 2 * Math.PI * u2;
      const nx = cl.cx + mag * Math.cos(ang) * cl.sx;
      const ny = cl.cy + mag * Math.sin(ang) * cl.sy;
      if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue;
      if (!isValidSkyPos(nx, ny)) continue;
      positions.push(nx, ny, 0);
      const c = pickColor();
      colors.push(c[0], c[1], c[2]);
      seeds.push(rng() * 628.318);
      // Cluster stars slightly smaller, denser look
      sizes.push(rngRange(0.6, 1.6));
      added++;
    }
  }


  // 3. Foreground stars -- a few slightly brighter/larger for depth
  const FG_COUNT = 14;
  let fgAdded = 0, fgAtt = 0;
  while (fgAdded < FG_COUNT && fgAtt < FG_COUNT * 20) {
    fgAtt++;
    const nx = rngRange(-0.95, 0.95);
    const ny = rngRange(HORIZON_NDC + 0.08, 0.95);
    if (!isValidSkyPos(nx, ny)) continue;
    positions.push(nx, ny, 0);
    const c = pickColor();
    colors.push(c[0], c[1], c[2]);
    seeds.push(rng() * 62.83);
    sizes.push(rngRange(2.0, 3.2));
    fgAdded++;
  }

  // ── Constellation definitions (NDC space) ──
  // 3 loose constellations in sky zone
  const CONSTELLATIONS = [
    // Left — big dipper-ish
    [ [-0.72, 0.62], [-0.62, 0.70], [-0.50, 0.66], [-0.44, 0.72],
      [-0.55, 0.80], [-0.66, 0.78] ],
    // Top center — cross shape
    [ [ 0.08, 0.88], [ 0.00, 0.78], [-0.08, 0.88],
      [ 0.00, 0.78], [ 0.00, 0.68] ],
    // Right — small triangle + tail
    [ [ 0.62, 0.52], [ 0.72, 0.60], [ 0.80, 0.52],
      [ 0.72, 0.60], [ 0.72, 0.72], [ 0.64, 0.80] ],
  ];

  // Add constellation node stars to the Points geometry (bigger, brighter seeds)
  for (const con of CONSTELLATIONS) {
    for (const [nx, ny] of con) {
      if (!isValidSkyPos(nx, ny)) continue;
      positions.push(nx, ny, 0);
      const c = pickColor();
      colors.push(c[0], c[1], c[2]);
      // Constellation nodes twinkle slower, more noble
      seeds.push(rng() * 62.83);
      sizes.push(rngRange(1.4, 2.2));  // constellation nodes — slightly bigger than field but not giant
    }
  }

  // 4. Milky Way band — 600 stars biased along a diagonal arc across the sky
  let bandAdded = 0, bandAtt = 0;
  while (bandAdded < 600 && bandAtt < 4800) {
    bandAtt++;
    const nx = rngRange(-1.0, 1.0);
    const nyCenter = 0.28 + nx * 0.22;
    const u1 = rng(), u2 = rng();
    const g = Math.sqrt(-2 * Math.log(u1 + 1e-9)) * Math.cos(2 * Math.PI * u2);
    const ny = nyCenter + g * 0.08;
    if (ny < HORIZON_NDC + 0.04 || ny > 1.0) continue;
    if (!isValidSkyPos(nx, ny)) continue;
    positions.push(nx, ny, 0);
    const c = pickColor();
    colors.push(c[0], c[1], c[2]);
    seeds.push(rng() * 628.318);
    sizes.push(rngRange(0.5, 1.4));
    bandAdded++;
  }

  // 5. Below-horizon fill — dense star field revealed during rolls
  const LOW_COUNT = 300;
  let lowAdded = 0, lowAtt = 0;
  while (lowAdded < LOW_COUNT && lowAtt < LOW_COUNT * 8) {
    lowAtt++;
    const nx = rngRange(-1.0, 1.0);
    const ny = rngRange(HORIZON_NDC + 0.04, 0.20);  // below old horizon line
    if (!isValidSkyPos(nx, ny)) continue;
    positions.push(nx, ny, 0);
    const c = pickColor();
    colors.push(c[0], c[1], c[2]);
    seeds.push(rng() * 628.318);
    sizes.push(rngRange(0.5, 1.8));
    lowAdded++;
  }

  // ── Build BufferGeometry ──
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aColor',   new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aSeed',    new THREE.Float32BufferAttribute(seeds, 1));
  geo.setAttribute('aSize',    new THREE.Float32BufferAttribute(sizes, 1));

  // ── ShaderMaterial ──
  // transparent:false → opaque queue → sunMesh (renderOrder=0) draws on top naturally
  // alphaTest:0.01 → discard near-zero fragments (no black squares over water)
  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:        { value: 0.0 },
      uPixelRatio:  { value: _initialDPR },
      uStarR:       { value: 0.40 },
      uStarG:       { value: 0.56 },
      uStarB:       { value: 0.78 },
      uStarBright:  { value: 3.70 },
      uTwinkleMin:  { value: 0.64 },
      uTwinkleRange:{ value: 0.67 },
      uSizeMult:    { value: 1.30 },
    },
    vertexShader: `
      attribute vec3  aColor;
      attribute float aSeed;
      attribute float aSize;
      uniform   float uTime;
      uniform   float uPixelRatio;
      uniform   float uTwinkleMin;
      uniform   float uTwinkleRange;
      uniform   float uSizeMult;

      varying vec3  vColor;
      varying float vAlpha;
      varying float vSize;

      void main() {
        float speed = 0.4 + mod(aSeed * 0.0137, 1.0);
        float twinkle = uTwinkleMin + uTwinkleRange * sin(uTime * speed + aSeed);

        vColor = aColor;
        vAlpha = twinkle;
        vSize  = aSize;

        gl_Position = vec4(position.xy, 0.999, 1.0);

        float coreSize = aSize * uSizeMult * (0.7 + 0.3 * twinkle) * uPixelRatio;
        float glowMul  = aSize > 2.5 ? 1.6 : 1.0;
        gl_PointSize = coreSize * glowMul;
      }
    `,
    fragmentShader: `
      uniform float uStarR;
      uniform float uStarG;
      uniform float uStarB;
      uniform float uStarBright;
      varying vec3  vColor;
      varying float vAlpha;
      varying float vSize;

      void main() {
        float d = distance(gl_PointCoord, vec2(0.5));
        vec3 starCol = vec3(uStarR, uStarG, uStarB);

        if (vSize > 2.5) {
          float coreD = d * 1.6;
          float core  = 1.0 - clamp(coreD * 2.0, 0.0, 1.0);
          core = pow(core, 2.2);
          float glow  = 1.0 - d * 2.0;
          glow = pow(max(glow, 0.0), 4.0) * 0.08;
          float intensity = (core + glow) * vAlpha;
          if (intensity < 0.01) discard;
          gl_FragColor = vec4(starCol * intensity * uStarBright, 1.0);
        } else {
          float strength = 1.0 - d * 2.0;
          strength = pow(max(strength, 0.0), 2.2);
          float intensity = strength * vAlpha;
          if (intensity < 0.01) discard;
          gl_FragColor = vec4(starCol * intensity * uStarBright, 1.0);
        }
      }
    `,
    transparent:  false,
    depthWrite:   false,
    depthTest:    false,
    blending:     THREE.AdditiveBlending,
    vertexColors: false,
  });

  skyStarPoints = new THREE.Points(geo, starMat);
  skyStarPoints.renderOrder  = -4;  // above panorama (-5), below sun (0)
  skyStarPoints.frustumCulled = false;
  skyStarPoints.layers.set(3);
  window._starMat = starMat;  // expose for scene tuner

  scene.add(skyStarPoints);

  // ── Constellation lines — LineSegments ──
  // Very faint, thin, slow-breathing opacity pulse
  const linePositions = [];
  for (const con of CONSTELLATIONS) {
    for (let i = 0; i < con.length - 1; i++) {
      const [ax, ay] = con[i];
      const [bx, by] = con[i + 1];
      linePositions.push(ax, ay, 0,  bx, by, 0);
    }
  }

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));

  const lineMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
    },
    vertexShader: `
      void main() {
        gl_Position = vec4(position.xy, 0.998, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      void main() {
        // Slow breath — constellation lines gently pulse 0.025–0.06 opacity
        float breath = 0.025 + 0.035 * (0.5 + 0.5 * sin(uTime * 0.4));
        gl_FragColor = vec4(0.65, 0.78, 1.0, breath);
      }
    `,
    transparent: true,
    depthWrite:  false,
    depthTest:   false,
    blending:    THREE.NormalBlending,
  });

  skyConstellLines = new THREE.LineSegments(lineGeo, lineMat);
  skyConstellLines.renderOrder   = -9;
  skyConstellLines.frustumCulled = false;
  skyConstellLines.layers.set(3);
  scene.add(skyConstellLines);

}());


// ═══════════════════════════════════════════════════
//  L4 SUN AURORA TENDRILS
// ═══════════════════════════════════════════════════
// Wiggly neon streams radiating outward from the sun during L4.
// angle=0 = straight up. Points extend in local XY of auroraGroup
// which sits at (0, SUN_Y, SUN_Z+2) facing the camera.

const AURORA_COUNT = 80;
const AURORA_SEGS  = 32;
const AURORA_LEN   = 180;

// Each tendril is TWO overlapping ribbon meshes:
//   outer: wide + dim  → soft glow halo
//   inner: narrow + bright → glowing core
// This fakes the thick glowing neon look without post-processing.
const TENDRIL_WIDTH_OUTER = 3.2;   // world units wide (outer glow)
const TENDRIL_WIDTH_INNER = 1.1;   // world units wide (bright core)

const AURORA_COLORS = [
  0xff00ff, 0xff00cc, 0xff0088,
  0x00ffff, 0x00ccff, 0x0088ff,
  0xff3399, 0xff66aa,
  0x44ff00, 0x88ff00, 0x00ff88,
  0x8844ff, 0xaa66ff, 0xcc00ff,
  0xffff00, 0xffee00,
  0xff6600, 0xff8800,
  0xffffff,
];

const auroraTendrils = [];  // { outerMesh, innerMesh, pts (computed each frame) }
const auroraGroup    = new THREE.Group();
auroraGroup.position.set(0, SUN_Y, SUN_Z + 3);
auroraGroup.visible = false;
auroraGroup.frustumCulled = false;
scene.add(auroraGroup);

const auroraData = [];

// Helper: build a ribbon BufferGeometry for SEGS points
// pts: Float32Array of length SEGS*2 (x,y pairs)
// width: ribbon half-width in local XY
// The ribbon is flat in Z=0 (the auroraGroup plane facing camera)
function makeRibbonGeo(segs) {
  // (segs-1) quads, each quad = 2 triangles = 6 indices
  const verts   = new Float32Array(segs * 2 * 3);  // 2 verts per seg (left, right edge)
  const indices = [];
  for (let s = 0; s < segs - 1; s++) {
    const a = s * 2, b = s * 2 + 1, c = (s+1)*2, d = (s+1)*2 + 1;
    indices.push(a, b, c,  b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(indices);
  return geo;
}

function updateRibbonGeo(geo, pts, halfWidth, segs, rootFade) {
  // pts: array of {x, y} length segs
  // rootFade (optional 0-1): fraction of strand length that fades in from invisible at root
  // e.g. rootFade=0.28 means first 28% of strand ramps from width=0 up to full width
  const pos = geo.attributes.position;
  const fade = rootFade || 0;

  for (let j = 0; j < segs; j++) {
    const t = j / (segs - 1);

    // Tangent direction along the ribbon
    let tx, ty;
    if (j === 0) {
      tx = pts[1].x - pts[0].x; ty = pts[1].y - pts[0].y;
    } else if (j === segs - 1) {
      tx = pts[j].x - pts[j-1].x; ty = pts[j].y - pts[j-1].y;
    } else {
      tx = pts[j+1].x - pts[j-1].x; ty = pts[j+1].y - pts[j-1].y;
    }
    const len = Math.sqrt(tx*tx + ty*ty) || 1;
    const nx = -ty / len, ny = tx / len;

    // Taper: full width at root, narrows slightly at tip
    const taper = 1.0 - t * 0.35;
    const hw = halfWidth * taper;

    // Root fade: smoothly ramp width from 0 → full over the fade zone
    const fadeMult = fade > 0 ? Math.min(1.0, t / fade) : 1.0;
    const hw2 = hw * fadeMult;

    pos.setXYZ(j*2,     pts[j].x + nx*hw2, pts[j].y + ny*hw2, 0);
    pos.setXYZ(j*2 + 1, pts[j].x - nx*hw2, pts[j].y - ny*hw2, 0);
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}

for (let i = 0; i < AURORA_COUNT; i++) {
  const frac  = i / (AURORA_COUNT - 1);
  const angle = (frac - 0.5) * Math.PI * 1.28;

  const centerBias = 1.0 - Math.abs(frac - 0.5) * 0.7;
  const len = AURORA_LEN * (0.55 + centerBias * 0.45) * (0.65 + Math.random() * 0.7);

  auroraData.push({
    angle, len,
    freq1: 0.008 + Math.random() * 0.012, amp1: 8.0  + Math.random() * 10.0,
    phase1: Math.random() * Math.PI * 2,  speed1: 0.4 + Math.random() * 0.8,
    freq2: 0.022 + Math.random() * 0.030, amp2: 4.0  + Math.random() * 5.0,
    phase2: Math.random() * Math.PI * 2,  speed2: 0.8 + Math.random() * 1.4,
    freq3: 0.06  + Math.random() * 0.06,  amp3: 1.5  + Math.random() * 2.0,
    phase3: Math.random() * Math.PI * 2,  speed3: 1.5 + Math.random() * 2.0,
    opacityBase:  0.7  + Math.random() * 0.3,
    opacitySpeed: 0.4  + Math.random() * 0.8,
    opacityPhase: Math.random() * Math.PI * 2,
    pts: Array.from({length: AURORA_SEGS}, () => ({x:0, y:0})),
  });

  const colorHex = AURORA_COLORS[i % AURORA_COLORS.length];
  const color    = new THREE.Color(colorHex);

  // Outer glow mesh — dimmer, wider
  const outerGeo = makeRibbonGeo(AURORA_SEGS);
  const outerMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.frustumCulled = false;

  // Inner core mesh — brighter, narrower
  const innerGeo = makeRibbonGeo(AURORA_SEGS);
  const innerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1, 1, 1).lerp(color, 0.4),  // slightly whitened
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.frustumCulled = false;

  auroraGroup.add(outerMesh);
  auroraGroup.add(innerMesh);
  auroraTendrils.push({ outerMesh, innerMesh });
}



// ═══════════════════════════════════════════════════
//  L5 SOLAR FLARE TENDRILS  (VOID SINGULARITY)
// ═══════════════════════════════════════════════════
// Fewer but MUCH larger, faster, brighter ribbons — same ribbon system as L4
// but with a gold→white-hot color story. Fills the entire sky.
// Radiates from the same sun position as L4.

const L5F_COUNT  = 60;   // fewer but thicker than L4's 80
const L5F_SEGS   = 40;   // more segments = smoother long curves
const L5F_LEN    = 280;  // much longer — reach across the whole sky

// 3 overlapping meshes per tendril: outer glow + mid + bright core
const L5F_W_OUTER = 7.0;   // wide gold halo
const L5F_W_MID   = 3.0;   // mid
const L5F_W_INNER = 1.2;   // hot-white core

// Color story: pure gold outer → warm white inner
// We want only 3 hues — deep gold, orange-gold, near-white
const L5F_COLORS_OUTER = [
  new THREE.Color(0xffaa00),  // deep gold
  new THREE.Color(0xff8800),  // amber
  new THREE.Color(0xffcc33),  // bright gold
  new THREE.Color(0xff6600),  // orange flare
  new THREE.Color(0xffdd66),  // pale gold
];
const L5F_COLOR_MID   = new THREE.Color(0xffffff).lerp(new THREE.Color(0xffcc00), 0.45); // warm white
const L5F_COLOR_INNER = new THREE.Color(1, 1, 1);  // pure white-hot core

const l5fTendrils = [];
const l5fGroup    = new THREE.Group();
l5fGroup.position.set(0, SUN_Y, SUN_Z + 3);
l5fGroup.visible = false;
l5fGroup.frustumCulled = false;
scene.add(l5fGroup);

const l5fData = [];

for (let i = 0; i < L5F_COUNT; i++) {
  const frac  = i / (L5F_COUNT - 1);
  const angle = (frac - 0.5) * Math.PI * 1.45;  // slightly wider fan than L4

  const centerBias = 1.0 - Math.abs(frac - 0.5) * 0.6;
  const len = L5F_LEN * (0.5 + centerBias * 0.5) * (0.6 + Math.random() * 0.8);

  l5fData.push({
    angle, len,
    // Faster, bigger waves than L4
    freq1: 0.005 + Math.random() * 0.010, amp1: 14.0 + Math.random() * 18.0,
    phase1: Math.random() * Math.PI * 2,  speed1: 0.8  + Math.random() * 1.4,
    freq2: 0.018 + Math.random() * 0.025, amp2:  7.0 + Math.random() * 8.0,
    phase2: Math.random() * Math.PI * 2,  speed2: 1.6  + Math.random() * 2.0,
    freq3: 0.055 + Math.random() * 0.055, amp3:  2.5 + Math.random() * 3.0,
    phase3: Math.random() * Math.PI * 2,  speed3: 2.5  + Math.random() * 3.0,
    opacityBase:  0.75 + Math.random() * 0.25,
    opacitySpeed: 0.6  + Math.random() * 1.2,
    opacityPhase: Math.random() * Math.PI * 2,
    pts: Array.from({length: L5F_SEGS}, () => ({x:0, y:0})),
  });

  const outerColor = L5F_COLORS_OUTER[i % L5F_COLORS_OUTER.length];

  // Outer halo — wide, gold
  const outerGeo = makeRibbonGeo(L5F_SEGS);
  const outerMat = new THREE.MeshBasicMaterial({
    color: outerColor,
    transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.frustumCulled = false;

  // Mid layer — warm white
  const midGeo = makeRibbonGeo(L5F_SEGS);
  const midMat = new THREE.MeshBasicMaterial({
    color: L5F_COLOR_MID.clone(),
    transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const midMesh = new THREE.Mesh(midGeo, midMat);
  midMesh.frustumCulled = false;

  // Inner core — pure white-hot
  const innerGeo = makeRibbonGeo(L5F_SEGS);
  const innerMat = new THREE.MeshBasicMaterial({
    color: L5F_COLOR_INNER.clone(),
    transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.frustumCulled = false;

  l5fGroup.add(outerMesh);
  l5fGroup.add(midMesh);
  l5fGroup.add(innerMesh);
  l5fTendrils.push({ outerMesh, midMesh, innerMesh });
}

let l5fFadeT = 0;
let l5fTime  = 0;

function updateL5Flares(dt) {
  // Active on L5 from the start (full level, unlike dust which waits for 2nd zipper)
  const isL5 = ((state.currentLevelIdx === 4 &&
                (state.phase === 'playing' || state.phase === 'paused')) ||
               (state.isDeathRun && DEATH_RUN_VIBES[state.deathRunVibeIdx].tendrils === 'l5f' &&
                (state.phase === 'playing' || state.phase === 'paused')));

  l5fFadeT = isL5
    ? Math.min(1, l5fFadeT + dt * 0.45)   // fade in a bit slower than L4 for drama
    : Math.max(0, l5fFadeT - dt * 1.0);

  if (l5fFadeT <= 0.001 || !auroraTVisible) { l5fGroup.visible = false; if (!auroraTVisible) return; }
  else l5fGroup.visible = true;
  l5fTime += dt;

  for (let i = 0; i < L5F_COUNT; i++) {
    const d = l5fData[i];
    const { outerMesh, midMesh, innerMesh } = l5fTendrils[i];

    const dirX  =  Math.sin(d.angle);
    const dirY  =  Math.cos(d.angle);
    const perpX =  Math.cos(d.angle);
    const perpY = -Math.sin(d.angle);

    for (let j = 0; j < L5F_SEGS; j++) {
      const t    = j / (L5F_SEGS - 1);
      const dist = t * d.len;
      const tip  = t * t;

      const w = Math.sin(d.freq1 * dist + l5fTime * d.speed1 + d.phase1) * d.amp1 * tip
              + Math.sin(d.freq2 * dist + l5fTime * d.speed2 + d.phase2) * d.amp2 * tip
              + Math.sin(d.freq3 * dist + l5fTime * d.speed3 + d.phase3) * d.amp3 * tip * 0.5;

      d.pts[j].x = dirX * dist + perpX * w;
      d.pts[j].y = dirY * dist + perpY * w;
    }

    updateRibbonGeo(outerMesh.geometry, d.pts, L5F_W_OUTER, L5F_SEGS);
    updateRibbonGeo(midMesh.geometry,   d.pts, L5F_W_MID,   L5F_SEGS);
    updateRibbonGeo(innerMesh.geometry, d.pts, L5F_W_INNER, L5F_SEGS);

    const pulse = 0.5 + 0.5 * Math.sin(l5fTime * d.opacitySpeed + d.opacityPhase);
    const base  = l5fFadeT * d.opacityBase * (0.70 + 0.30 * pulse);
    outerMesh.material.opacity = base * 0.17;   // wide gold halo
    midMesh.material.opacity   = base * 0.26;   // mid warm-white
    innerMesh.material.opacity = base * 0.42;   // bright white-hot core
  }
}

let auroraFadeT = 0;
let auroraTime  = 0;
let auroraTVisible = false; // T key toggle — default off

function updateAurora(dt) {
  const isL4 = ((state.currentLevelIdx === 3 &&
                (state.phase === 'playing' || state.phase === 'paused')) ||
               (state.isDeathRun && DEATH_RUN_VIBES[state.deathRunVibeIdx].tendrils === 'aurora' &&
                (state.phase === 'playing' || state.phase === 'paused')));

  auroraFadeT = isL4
    ? Math.min(1, auroraFadeT + dt * 0.6)
    : Math.max(0, auroraFadeT - dt * 1.2);

  if (auroraFadeT <= 0.001) { auroraGroup.visible = false; return; }
  auroraGroup.visible = auroraTVisible;
  auroraTime += dt;

  for (let i = 0; i < AURORA_COUNT; i++) {
    const d = auroraData[i];
    const { outerMesh, innerMesh } = auroraTendrils[i];

    const dirX  =  Math.sin(d.angle);
    const dirY  =  Math.cos(d.angle);
    const perpX =  Math.cos(d.angle);
    const perpY = -Math.sin(d.angle);

    // Compute spine points
    for (let j = 0; j < AURORA_SEGS; j++) {
      const t    = j / (AURORA_SEGS - 1);
      const dist = t * d.len;
      const tip  = t * t;

      const w = Math.sin(d.freq1 * dist + auroraTime * d.speed1 + d.phase1) * d.amp1 * tip
              + Math.sin(d.freq2 * dist + auroraTime * d.speed2 + d.phase2) * d.amp2 * tip
              + Math.sin(d.freq3 * dist + auroraTime * d.speed3 + d.phase3) * d.amp3 * tip * 0.5;

      d.pts[j].x = dirX * dist + perpX * w;
      d.pts[j].y = dirY * dist + perpY * w;
    }

    updateRibbonGeo(outerMesh.geometry, d.pts, TENDRIL_WIDTH_OUTER, AURORA_SEGS, 0.28);
    updateRibbonGeo(innerMesh.geometry, d.pts, TENDRIL_WIDTH_INNER, AURORA_SEGS, 0.28);

    const pulse = 0.5 + 0.5 * Math.sin(auroraTime * d.opacitySpeed + d.opacityPhase);
    const baseOpacity = auroraFadeT * d.opacityBase * (0.65 + 0.35 * pulse);
    outerMesh.material.opacity = baseOpacity * 0.22;  // wide halo, dimmer
    innerMesh.material.opacity = baseOpacity * 0.50;  // bright core
  }
}

// ── Music system: Web Audio API gain nodes for smooth crossfades ─────────
const TRACK_VOL = { title: 0.4, bg: 0.45, l3: 0.45, l4: 0.45, lake: 0.28, keepgoing: 0.7 };
const trackGains = {};   // { title: GainNode, bg: GainNode, ... }
let   _gainsReady = false;

function allTracks() {
  return { title: titleMusic, bg: bgMusic, l3: l3Music, l4: l4Music, lake: lakeMusic, keepgoing: keepGoingMusic };
}

// Wire each <audio> element through a GainNode. Called once from initAudio.
function _initTrackGains() {
  if (!audioCtx) return;
  const tracks = allTracks();
  Object.entries(tracks).forEach(([k, el]) => {
    if (!el || trackGains[k]) return; // skip missing or already-wired tracks
    const src  = audioCtx.createMediaElementSource(el);
    const gain = audioCtx.createGain();
    gain.gain.value = el.volume; // inherit current volume (e.g. title already playing)
    src.connect(gain).connect(audioCtx.destination);
    trackGains[k] = gain;
    el.volume = 1;  // max HTML volume — gain node controls actual level
  });
  _gainsReady = true;
}

// Set a track's gain instantly (no ramp).
function setTrackVol(name, vol) {
  const g = trackGains[name];
  if (g && audioCtx) {
    g.gain.cancelScheduledValues(audioCtx.currentTime);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
  } else {
    // Fallback before gains are wired (pre-gesture)
    const el = allTracks()[name];
    if (el) el.volume = vol;
  }
}
function getTrackVol(name) {
  const g = trackGains[name];
  if (g) return g.gain.value;
  const el = allTracks()[name];
  return el ? el.volume : 0;
}
function rampTrackVol(name, vol, sec) {
  const g = trackGains[name];
  if (!g || !audioCtx) { setTrackVol(name, vol); return; }
  g.gain.cancelScheduledValues(audioCtx.currentTime);
  g.gain.setValueAtTime(g.gain.value, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + sec);
}

// Hard-stop all tracks and immediately start one (no crossfade).
function setActiveMusic(track) {
  initAudio();
  const all = allTracks();
  Object.entries(all).forEach(([k, el]) => {
    if (!el || k === 'lake') return;
    el.pause();
    el.currentTime = 0;
    setTrackVol(k, TRACK_VOL[k] || 0.45);
  });
  if (state.muted || !track) return;
  const el = all[track];
  if (!el) return;
  el.currentTime = 0;
  setTrackVol(track, TRACK_VOL[track]);
  el.play().catch(() => {});
}

// pauseGameTrack / resumeGameTrack — used by togglePause
function pauseGameTrackInPlace(track) {
  initAudio();
  const all = allTracks();
  Object.entries(all).forEach(([k, el]) => {
    if (!el || k === 'title') return;
    if (!el.paused) el.pause();
  });
  if (titleMusic) {
    titleMusic.currentTime = 0;
    setTrackVol('title', state.muted ? 0 : TRACK_VOL.title);
    if (!state.muted) titleMusic.play().catch(() => {});
  }
}
function resumeGameTrackInPlace(track) {
  initAudio();
  if (titleMusic) { titleMusic.pause(); titleMusic.currentTime = 0; setTrackVol('title', 0); }
  const all = allTracks();
  const el = all[track];
  if (el && !state.muted) {
    setTrackVol(track, 0);
    el.play().catch(() => {});
    musicFadeTo(track, 1200);
  }
  if (lakeMusic && !state.muted) lakeMusic.play().catch(() => {});
}

// Smooth crossfade using Web Audio gain ramps — no JS timers for volume.
function musicFadeTo(toTrack, durationMs, outFadeMult) {
  initAudio();
  const all = allTracks();
  const toEl = all[toTrack];
  if (!toEl) return;
  const durSec    = durationMs / 1000;
  const outDurSec = durSec * (outFadeMult || 1.0);

  if (state.muted) {
    Object.entries(all).forEach(([k, el]) => { if (el && k !== toTrack && k !== 'lake') el.pause(); });
    if (toEl.paused) { setTrackVol(toTrack, 0); toEl.play().catch(() => {}); }
    return;
  }
  // Start destination silently if paused
  if (toEl.paused) { setTrackVol(toTrack, 0); toEl.play().catch(() => {}); }
  // Ramp destination in
  rampTrackVol(toTrack, TRACK_VOL[toTrack], durSec);
  // Ramp all others out (except lake)
  Object.entries(all).forEach(([k, el]) => {
    if (!el || k === toTrack || k === 'lake') return;
    rampTrackVol(k, 0, outDurSec);
  });
  // Schedule cleanup: pause faded-out tracks after ramp completes
  const cleanupMs = Math.max(durationMs, durationMs * (outFadeMult || 1.0)) + 100;
  setTimeout(() => {
    Object.entries(all).forEach(([k, el]) => {
      if (!el || k === toTrack || k === 'lake') return;
      if (getTrackVol(k) < 0.01) el.pause();
    });
  }, cleanupMs);
}

function updateSunColor(color, levelIdx) {
  sunMat.uniforms.uSunColor.value.copy(color);
  sunCapMat.uniforms.uSunColor.value.copy(color);
  if (mirrorMat) mirrorMat.uniforms.uSunColor.value.copy(color);
  sunLight.color.copy(color);   // sun-facing ship lights track level color
  sunLightL.color.copy(color);
  // L4 ICE STORM (index 3) gets the special gradient+granule shader
  // levelIdx === -1 means transition is driving blends manually — skip the snap
  if (levelIdx !== -1) {
    sunMat.uniforms.uIsUV.value   = (levelIdx === 1) ? 1.0 : 0.0;
    sunMat.uniforms.uIsL3.value   = (levelIdx === 2) ? 1.0 : 0.0;
    sunMat.uniforms.uIsIce.value  = (levelIdx === 3) ? 1.0 : 0.0;
    sunMat.uniforms.uIsGold.value = (levelIdx === 4) ? 1.0 : 0.0;
    sunCapMat.uniforms.uIsUV.value   = sunMat.uniforms.uIsUV.value;
    sunCapMat.uniforms.uIsL3.value   = sunMat.uniforms.uIsL3.value;
    sunCapMat.uniforms.uIsL3Warp.value = sunMat.uniforms.uIsL3Warp.value;
    sunCapMat.uniforms.uIsIce.value  = sunMat.uniforms.uIsIce.value;
    sunCapMat.uniforms.uIsGold.value = sunMat.uniforms.uIsGold.value;
  }
  // Recolor the glow gradient using the level's sun color
  const r = color.r, g2 = color.g, b = color.b;
  const rSun = Math.round(r*255), gSun = Math.round(g2*255), bSun = Math.round(b*255);
  // Redraw corona crescent only
  gc.clearRect(0, 0, GS, GS);

  // Corona — same layer system as init, tinted to level color
  // Adaptive corona boost — scale down additions when color already near-white
  // so a pale cyan sun (ICE STORM 0xaaeeff) doesn't go blinding white
  const sunLuma = 0.299*(rSun/255) + 0.587*(gSun/255) + 0.114*(bSun/255);
  // L1 (idx 0) gets extra corona punch — orange sun has high luma so adaptive boost is weak
  const _coronaExtra = (levelIdx === 0) ? 1.6 : 1.0;
  const boostF  = Math.max(0, 1.0 - sunLuma * 1.4) * _coronaExtra;  // 0 when already very bright
  const cR = Math.min(255, rSun + Math.round(60 * boostF));
  const cG = Math.min(255, gSun + Math.round(30 * boostF));
  const cB = bSun;
  (function drawCoronaUpd() {
    const STEPS = 200;
    const crownY2 = GC - ringR_gc; // top edge of sun disc
    const crownR2 = Math.min(255, rSun + Math.round(80 * boostF));
    const crownG2 = Math.min(255, gSun + Math.round(40 * boostF));
    const sR2 = Math.min(255, rSun + Math.round(50*boostF));
    const sG2 = Math.min(255, gSun + Math.round(60*boostF));

    // ── 1. Crown bloom — clipped strictly to corona arc circle ──
    gc.save();
    gc.beginPath();
    gc.arc(GC, GC, ringR_gc, 0, Math.PI * 2); // clip to exact corona radius
    gc.clip();
    gc.save();
    gc.translate(GC, crownY2);
    gc.scale(2.2, 1.0);
    const crownBloomR2 = ringR_gc * 0.85;
    const crownGrad2 = gc.createRadialGradient(0, 0, 0, 0, 0, crownBloomR2);
    crownGrad2.addColorStop(0.0,  `rgba(${Math.min(255,crownR2+60)},${Math.min(255,crownG2+80)},${Math.min(255,bSun+80)},0.22)`);
    crownGrad2.addColorStop(0.15, `rgba(${crownR2},${crownG2},${bSun},0.16)`);
    crownGrad2.addColorStop(0.40, `rgba(${rSun},${gSun},${bSun},0.08)`);
    crownGrad2.addColorStop(1.0,  'rgba(0,0,0,0)');
    gc.fillStyle = crownGrad2;
    gc.fillRect(-crownBloomR2 * 2.5, -crownBloomR2, crownBloomR2 * 5, crownBloomR2 * 2);
    gc.restore();
    gc.restore();

    // ── 2. Limb arc — boosted alphas/widths to survive ACES tone mapping ──
    function coronaWeight(t) {
      const mid = Math.abs(t - 0.5) * 2;
      return 0.28 + 0.72 * Math.pow(1 - mid, 1.6);
    }
    const layers = [
      { rOff: -8,  w: 16, color: [cR, Math.max(0,cG-30), cB],                                     a: 0.26 },
      { rOff: -3,  w: 10, color: [cR, cG,                 cB],                                     a: 0.55 },
      { rOff:  0,  w:  8, color: [Math.min(255,cR+Math.round(15*boostF)), Math.min(255,cG+Math.round(30*boostF)), cB], a: 0.90 },
      { rOff:  0,  w:  3, color: [Math.min(255,cR+Math.round(25*boostF)), Math.min(255,cG+Math.round(55*boostF)), Math.min(255,cB+Math.round(55*boostF))], a: 1.00 },
      { rOff:  3,  w:  8, color: [cR, Math.max(0,cG-10), cB],                                     a: 0.55 },
      { rOff:  8,  w: 14, color: [cR, Math.max(0,cG-40), cB],                                     a: 0.20 },
    ];
    for (const L of layers) {
      for (let i = 0; i < STEPS; i++) {
        const t = (i + 0.5) / STEPS;
        const wt = coronaWeight(t);
        if (wt < 0.01) continue;
        gc.beginPath();
        gc.lineWidth = Math.max(0.5, wt * L.w);
        gc.strokeStyle = `rgba(${L.color[0]},${L.color[1]},${L.color[2]},${(L.a * wt).toFixed(3)})`;
        gc.arc(GC, GC, ringR_gc + L.rOff, Math.PI + (i / STEPS) * Math.PI, Math.PI + ((i + 1) / STEPS) * Math.PI);
        gc.stroke();
      }
    }

  }());

  glowTex.needsUpdate = true;

  // Recolor horizon seam line toward new sun color
  const rr  = Math.round(Math.min(1, r + 0.15) * 255);
  const rgg = Math.round(Math.min(1, g2 + 0.05) * 255);
  const rb2 = Math.round(b * 255);
  const rimGrad2 = rimGlowCtx.createLinearGradient(0, 0, 512, 0);
  rimGrad2.addColorStop(0.0,  'rgba(0,0,0,0)');
  rimGrad2.addColorStop(0.12, `rgba(${rr},${rgg},${rb2},0.22)`);
  rimGrad2.addColorStop(0.35, `rgba(${Math.min(255,rr+30)},${Math.min(255,rgg+20)},${rb2},0.80)`);
  rimGrad2.addColorStop(0.50, 'rgba(255,255,255,0.95)');
  rimGrad2.addColorStop(0.65, `rgba(${Math.min(255,rr+30)},${Math.min(255,rgg+20)},${rb2},0.80)`);
  rimGrad2.addColorStop(0.88, `rgba(${rr},${rgg},${rb2},0.22)`);
  rimGrad2.addColorStop(1.0,  'rgba(0,0,0,0)');
  rimGlowCtx.clearRect(0, 0, 512, 16);
  rimGlowCtx.fillStyle = rimGrad2;
  rimGlowCtx.fillRect(0, 0, 512, 16);
  rimGlowTex.needsUpdate = true;

}

function updateGridColor(color) {
  floorMat.uniforms.uLineColor.value.copy(color);
  if (mirrorMat) mirrorMat.uniforms.uLineColor.value.copy(color);
  mirrorMat.uniforms.uLineColor.value.copy(color);
  // Ship edge lines + accent strip track level color
  shipEdgeLines.forEach(m => {
    if (!m.color) return;
    m.color.copy(color);
    if (m.emissive) m.emissive.copy(color);
  });
  // Thruster color is set separately via applyLevelVisuals/updateThrusterColor
}

function updateFloorPalette(palA, palB, palC) {
  // palC = line color (palA/palB unused — floor is always near-black)
  floorMat.uniforms.uLineColor.value.copy(palC);
  mirrorMat.uniforms.uLineColor.value.copy(palC);
}

// No terrain hills — open infinite field

// No walls — open infinite field

// ═══════════════════════════════════════════════════
//  SHIP
// ═══════════════════════════════════════════════════
const shipGroup = new THREE.Group();
scene.add(shipGroup);
shipGroup.position.set(0, 0.28, 3.9); // init position; _hoverBaseY applied on game start
shipGroup.scale.setScalar(0.30);  // smaller ship, more like original

// ── Ship studio lighting — key + fill so alt ships read in dark scene ──
const _shipKeyLight = new THREE.DirectionalLight(0xffffff, 1.8);
_shipKeyLight.position.set(2, 4, -3); // above-right-front
shipGroup.add(_shipKeyLight);
const _shipFillLight = new THREE.DirectionalLight(0x8899bb, 0.6);
_shipFillLight.position.set(-2, 1, 2); // below-left-behind
shipGroup.add(_shipFillLight);

// Load GLB ship model — replaces hand-built geometry
const shipEdgeLines = [];  // LineBasicMaterial refs — updated on level color change
const shipHullMats  = [];  // MeshStandardMaterial refs — for emissive pulse animation
const shipFireMeshes = []; // 'fire' and 'fire1' GLTF meshes (engine exhaust geometry)
// _prebuiltSkins: populated inside gltfLoader.load callback; declared here so applySkin can access it
let _prebuiltSkins = [];

// ── HOISTED SKIN MATERIAL TOOLKIT ─────────────────────────────────────────
// Constants and a factory for building per-skin materials at runtime, used
// both by the default-ship _prebuiltSkins build (skin 0/1/2/3 on default_ship.glb)
// AND by the alt-GLB matchDefault path (where skins 0/1/2/3 share spaceship_01.glb
// so addons can attach). Hoisted to module scope so _loadAltShip can reach them.
const _SHADER_VERT_PRE = 'varying vec3 vWorldPos;\n';
const _SHADER_VERT_INJ = `#include <begin_vertex>
vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`;
window._diamondUniforms = {
  dScale:     { value: 0.5 },
  dBump:      { value: 0.6 },
  dEdgeMin:   { value: 0.45 },
  dEdgeMax:   { value: 0.80 },
  dGlowR:     { value: 0.2 },
  dGlowG:     { value: 0.76 },
  dGlowB:     { value: 1.0 },
  dGlowMul:   { value: 0.9 },
  dGlowEdgeMin: { value: 0.10 },
  dGlowEdgeMax: { value: 0.50 },
};
const _GLSL_DIAMOND = `#include <normal_fragment_maps>
float _dSc = dScale;
vec2 _uvXZ = vWorldPos.xz * _dSc;
vec2 _uvXY = vWorldPos.xy * _dSc;
vec2 _dUVxz = vec2(_uvXZ.x + _uvXZ.y, _uvXZ.x - _uvXZ.y) * 0.707;
vec2 _dUVxy = vec2(_uvXY.x + _uvXY.y, _uvXY.x - _uvXY.y) * 0.707;
vec2 _dcXZ = abs(fract(_dUVxz) - 0.5);
float _ddXZ = max(_dcXZ.x, _dcXZ.y);
float _deXZ = 1.0 - smoothstep(dEdgeMin, dEdgeMax, _ddXZ);
vec2 _dcXY = abs(fract(_dUVxy) - 0.5);
float _ddXY = max(_dcXY.x, _dcXY.y);
float _deXY = 1.0 - smoothstep(dEdgeMin, dEdgeMax, _ddXY);
float _blY = abs(normal.y);
float _dEdge = mix(_deXY, _deXZ, _blY);
vec2 _dUV = mix(_dUVxy, _dUVxz, _blY);
float _dBumpV = dBump;
vec2 _dEps = vec2(0.01, 0.0);
vec2 _dUVdx = _dUV + _dEps.xy; vec2 _ddcDx = abs(fract(_dUVdx)-0.5);
float _deDx = 1.0 - smoothstep(dEdgeMin,dEdgeMax, max(_ddcDx.x,_ddcDx.y));
vec2 _dUVdy = _dUV + _dEps.yx; vec2 _ddcDy = abs(fract(_dUVdy)-0.5);
float _deDy = 1.0 - smoothstep(dEdgeMin,dEdgeMax, max(_ddcDy.x,_ddcDy.y));
vec3 _dbn = normalize(normal + vec3((_deDx-_dEdge)*_dBumpV, (_deDy-_dEdge)*_dBumpV, 0.0));
normal = _dbn;`;
const _GLSL_DIAMOND_EMISSIVE = `#include <emissivemap_fragment>
{
  float _deSc = dScale;
  vec2 _deUVxz = vWorldPos.xz * _deSc;
  vec2 _deUVxy = vWorldPos.xy * _deSc;
  vec2 _deDUVxz = vec2(_deUVxz.x + _deUVxz.y, _deUVxz.x - _deUVxz.y) * 0.707;
  vec2 _deDUVxy = vec2(_deUVxy.x + _deUVxy.y, _deUVxy.x - _deUVxy.y) * 0.707;
  float _deBlY = abs(normal.y);
  vec2 _deDUV = mix(_deDUVxy, _deDUVxz, _deBlY);
  vec2 _deFr = abs(fract(_deDUV) - 0.5);
  float _deD = max(_deFr.x, _deFr.y);
  float _deEdge = 1.0 - smoothstep(dGlowEdgeMin, dGlowEdgeMax, _deD);
  totalEmissiveRadiance += vec3(dGlowR, dGlowG, dGlowB) * _deEdge * dGlowMul;
}`;

// Per-skin slot palette. slotName matches GLB material name. Idx 0 mirrors
// the default RUNNER colors (lines ~5420-5471). Idx 1/2/3 mirror SKIN_DEFS
// so the default-ship _prebuiltSkins path and the alt-GLB matchDefault path
// produce visually identical materials. Edit one place, both paths follow.
const _SKIN_PALETTE = [
  // 0 — RUNNER (default)
  {
    nozzle:       { color: 0x0a0a0a, metalness: 0.95, roughness: 0.12 },
    gray:         { color: 0x888899, metalness: 0.6,  roughness: 0.32 },
    rocket_light: { color: 0x0044ff, metalness: 0.0,  roughness: 0.05, emissive: 0x0033cc, emissiveIntensity: 2.5 },
    rocket_base:  { color: 0x0e1014, metalness: 0.90, roughness: 0.30, hexBump: true },
    white:        { color: 0xddeeff, metalness: 0.5,  roughness: 0.08, emissive: 0x2255ff, emissiveIntensity: 0.6 },
    fallback:     { color: 0x141820, metalness: 0.88, roughness: 0.25, hexBump: true },
  },
  // 1 — GHOST: holographic except nozzle
  {
    nozzle:       { color: 0x0a0a0a, metalness: 0.95, roughness: 0.12 },
    gray:         { holo: true, hologramColor: '#00e0ff' },
    rocket_light: { holo: true, hologramColor: '#00e0ff' },
    rocket_base:  { holo: true, hologramColor: '#00e0ff' },
    white:        { holo: true, hologramColor: '#00e0ff' },
    fallback:     { holo: true, hologramColor: '#00e0ff' },
  },
  // 2 — BLACK MAMBA
  {
    nozzle:       { color: 0x000000, metalness: 0.00, roughness: 0.32, emissive: 0x000000, emissiveIntensity: 0 },
    gray:         { color: 0xd36b4a, metalness: 1.00, roughness: 0.32 },
    rocket_light: { color: 0x000000, metalness: 0.0,  roughness: 0.32, emissive: 0x19d9e6, emissiveIntensity: 11 },
    rocket_base:  { color: 0xd36b4a, metalness: 1.00, roughness: 0.32 },
    white:        { color: 0x797234, metalness: 0.00, roughness: 0.32, emissive: 0x19d9e6, emissiveIntensity: 5.0 },
    fallback:     { color: 0xd36b4a, metalness: 1.00, roughness: 0.32 },
  },
  // 3 — CIPHER (diamond plate)
  {
    nozzle:       { color: 0x080808, metalness: 0.95, roughness: 0.10 },
    gray:         { color: 0x000000, metalness: 0.98, roughness: 0,    emissive: 0x000000, emissiveIntensity: 0, diamond: true },
    rocket_light: { color: 0x000000, metalness: 0.0,  roughness: 0,    emissive: 0x88bbff, emissiveIntensity: 6 },
    rocket_base:  { color: 0x000000, metalness: 0.98, roughness: 0,    emissive: 0x000000, emissiveIntensity: 0, diamond: true },
    white:        { color: 0x000000, metalness: 0.98, roughness: 0,    emissive: 0x000000, emissiveIntensity: 0, diamond: true },
    fallback:     { color: 0x000000, metalness: 0.98, roughness: 0,    emissive: 0x000000, emissiveIntensity: 0, diamond: true },
  },
];

// Build a fresh material for a given (skinIdx, slotName). Returns null for
// fire/fire1 slots — caller handles those (push to shipFireMeshes, leave mat alone).
function _makeMatForSkinSlot(skinIdx, slotName) {
  if (slotName === 'fire' || slotName === 'fire1') return null;
  const palette = _SKIN_PALETTE[skinIdx] || _SKIN_PALETTE[0];
  let key = slotName;
  if (key === 'rocket light') key = 'rocket_light';
  if (key === 'rocket base') key = 'rocket_base';
  if (key === 'white ') key = 'white';
  if (key === 'Light') key = 'rocket_light'; // alt-GLB sometimes labels emissive as Light
  if (!palette[key]) key = 'fallback';
  const def = palette[key];
  let mat;
  if (def.holo) {
    mat = new HolographicMaterial({
      hologramColor:      def.hologramColor || '#00e0ff',
      fresnelAmount:      0.70,
      fresnelOpacity:     0.82,
      scanlineSize:       5.50,
      hologramBrightness: 1.94,
      signalSpeed:        0.00,
      enableBlinking:     true,
      blinkFresnelOnly:   true,
      hologramOpacity:    0.31,
      side:               THREE.DoubleSide,
      blendMode:          THREE.NormalBlending,
    });
    mat.depthWrite = true;
    _registerHoloMaterial(mat);
    return mat;
  }
  const props = {
    color: def.color,
    metalness: def.metalness !== undefined ? def.metalness : 0,
    roughness: def.roughness !== undefined ? def.roughness : 0.5,
    transparent: false, depthWrite: true,
  };
  if (def.emissive !== undefined) props.emissive = def.emissive;
  if (def.emissiveIntensity !== undefined) props.emissiveIntensity = def.emissiveIntensity;
  mat = new THREE.MeshStandardMaterial(props);
  if (def.diamond) {
    mat.onBeforeCompile = (shader) => {
      const du = window._diamondUniforms;
      if (du) for (const k in du) shader.uniforms[k] = du[k];
      const _uniDecl = 'varying vec3 vWorldPos;\n' +
        'uniform float dScale;\nuniform float dBump;\n' +
        'uniform float dEdgeMin;\nuniform float dEdgeMax;\n' +
        'uniform float dGlowR;\nuniform float dGlowG;\nuniform float dGlowB;\n' +
        'uniform float dGlowMul;\nuniform float dGlowEdgeMin;\nuniform float dGlowEdgeMax;\n';
      shader.vertexShader = _SHADER_VERT_PRE + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', _SHADER_VERT_INJ);
      shader.fragmentShader = _uniDecl + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', _GLSL_DIAMOND);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', _GLSL_DIAMOND_EMISSIVE);
    };
    mat.needsUpdate = true;
  } else if (def.hexBump) {
    mat.onBeforeCompile = _hexBumpShaderPatch;
    mat.needsUpdate = true;
  }
  return mat;
}

const gltfLoader = new GLTFLoader();
// Track default ship load for boot gate
let _shipLoadResolve = null;
if (window.__loadGate) {
  window.__loadGate.add('default_ship', new Promise(res => {
    _shipLoadResolve = res;
    setTimeout(() => res(), 12000); // hard timeout safety
  }));
}
gltfLoader.load('./assets/ships/default_ship.glb', (gltf) => {
  if (window.__loadGate) window.__loadGate.setStatus('SHIP', 70);
  const model = gltf.scene;
  // New ship GLB: Sketchfab export — root matrices handle Y->Z-up conversion.
  // Ship nose points toward +X in model space; rotate so it faces -Z (away from camera).
  model.rotation.y = Math.PI;
  model.position.set(0, -0.5, 0);  // center vertically
  model.scale.setScalar(1.0);
  // Pre-cache original material names for skin system (before materials are replaced below)
  model.traverse(child => {
    if (!child.isMesh) return;
    child.userData._origMatName = (child.material && child.material.name) ? child.material.name : '';
  });
  // Apply material per original GLB role — preserve detail like the reference image
  model.traverse(child => {
    if (!child.isMesh) return;
    const name = (child.material && child.material.name) ? child.material.name : '';
    child.castShadow = false;
    if (name === 'nozzle') {
      // Engine nozzles — near-black polished metal
      child.material = new THREE.MeshStandardMaterial({
        color: 0x0a0a0a, metalness: 0.95, roughness: 0.12,
        transparent: false, depthWrite: true,
      });
    } else if (name === 'gray') {
      // Recessed panel sections — slightly glossy for smooth contour reads
      child.material = new THREE.MeshStandardMaterial({
        color: 0x888899, metalness: 0.6, roughness: 0.32,
        transparent: false, depthWrite: true,
      });
    } else if (name === 'rocket_light') {
      // Glowing accent strip — emissive blue, original intensity
      child.material = new THREE.MeshStandardMaterial({
        color: 0x0044ff, emissive: 0x0033cc, emissiveIntensity: 2.5,
        metalness: 0.0, roughness: 0.05,
        transparent: false, depthWrite: true,
      });
      shipEdgeLines.push(child.material);
    } else if (name === 'rocket_base') {
      // Hull panels — near-black, high metalness so sun rakes across it
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0e1014, metalness: 0.90, roughness: 0.30,
        transparent: false, depthWrite: true,
      });
      mat.onBeforeCompile = _hexBumpShaderPatch;
      mat.needsUpdate = true;
      child.material = mat;
      shipHullMats.push(child.material);
    } else if (name === 'fire' || name === 'fire1') {
      // Leave fire meshes untouched — store ref for tuner toggle
      shipFireMeshes.push(child);
    } else if (name === 'white') {
      // Top crease panel — original
      child.material = new THREE.MeshStandardMaterial({
        color: 0xddeeff, metalness: 0.5, roughness: 0.08,
        emissive: 0x2255ff, emissiveIntensity: 0.6,
        transparent: false, depthWrite: true,
      });
      shipEdgeLines.push(child.material);
    } else {
      // Main hull — near-black, picks up sun rake like ref
      const mat = new THREE.MeshStandardMaterial({
        color: 0x141820, metalness: 0.88, roughness: 0.25,
        emissive: 0x000000, emissiveIntensity: 0,
        transparent: false, depthWrite: true,
      });
      mat.onBeforeCompile = _hexBumpShaderPatch;
      mat.needsUpdate = true;
      child.material = mat;
      shipHullMats.push(child.material);
    }
  });
  shipGroup.add(model);

  // ── SKIN SYSTEM: store model ref and pre-build material sets ──────────────
  window._shipModel = model;

  // Store references to default materials (skin 0) by mesh
  // Note: _origMatName was already set by the pre-cache traverse above (preserves GLB names)
  const _defaultMats = new Map();
  model.traverse(child => {
    if (!child.isMesh) return;
    // Store this material instance — we'll reassign it later when switching back to default
    _defaultMats.set(child.uuid, child.material);
  });

  // ── VORONOI HULL shader ── irregular polygonal armor plating via onBeforeCompile
  const _shaderVertPre = 'varying vec3 vWorldPos;\n';
  const _shaderVertInj = `#include <begin_vertex>
vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`;

  // ── Diamond plate shared uniforms (tuner-controllable) ──
  window._diamondUniforms = {
    dScale:     { value: 0.5 },
    dBump:      { value: 0.6 },
    dEdgeMin:   { value: 0.45 },
    dEdgeMax:   { value: 0.80 },
    dGlowR:     { value: 0.2 },
    dGlowG:     { value: 0.76 },
    dGlowB:     { value: 1.0 },
    dGlowMul:   { value: 0.9 },
    dGlowEdgeMin: { value: 0.10 },
    dGlowEdgeMax: { value: 0.50 },
  };

  // DIAMOND PLATE — 45-degree rotated raised diamond grid (uniform-driven)
  const GLSL_DIAMOND = `#include <normal_fragment_maps>
float _dSc = dScale;
vec2 _uvXZ = vWorldPos.xz * _dSc;
vec2 _uvXY = vWorldPos.xy * _dSc;
vec2 _dUVxz = vec2(_uvXZ.x + _uvXZ.y, _uvXZ.x - _uvXZ.y) * 0.707;
vec2 _dUVxy = vec2(_uvXY.x + _uvXY.y, _uvXY.x - _uvXY.y) * 0.707;
vec2 _dcXZ = abs(fract(_dUVxz) - 0.5);
float _ddXZ = max(_dcXZ.x, _dcXZ.y);
float _deXZ = 1.0 - smoothstep(dEdgeMin, dEdgeMax, _ddXZ);
vec2 _dcXY = abs(fract(_dUVxy) - 0.5);
float _ddXY = max(_dcXY.x, _dcXY.y);
float _deXY = 1.0 - smoothstep(dEdgeMin, dEdgeMax, _ddXY);
float _blY = abs(normal.y);
float _dEdge = mix(_deXY, _deXZ, _blY);
vec2 _dUV = mix(_dUVxy, _dUVxz, _blY);
float _dBumpV = dBump;
vec2 _dEps = vec2(0.01, 0.0);
vec2 _dUVdx = _dUV + _dEps.xy; vec2 _ddcDx = abs(fract(_dUVdx)-0.5);
float _deDx = 1.0 - smoothstep(dEdgeMin,dEdgeMax, max(_ddcDx.x,_ddcDx.y));
vec2 _dUVdy = _dUV + _dEps.yx; vec2 _ddcDy = abs(fract(_dUVdy)-0.5);
float _deDy = 1.0 - smoothstep(dEdgeMin,dEdgeMax, max(_ddcDy.x,_ddcDy.y));
vec3 _dbn = normalize(normal + vec3((_deDx-_dEdge)*_dBumpV, (_deDy-_dEdge)*_dBumpV, 0.0));
normal = _dbn;`;

  // Emissive edge glow for diamond plate — uniform-driven
  const GLSL_DIAMOND_EMISSIVE = `#include <emissivemap_fragment>
{
  float _deSc = dScale;
  vec2 _deUVxz = vWorldPos.xz * _deSc;
  vec2 _deUVxy = vWorldPos.xy * _deSc;
  vec2 _deDUVxz = vec2(_deUVxz.x + _deUVxz.y, _deUVxz.x - _deUVxz.y) * 0.707;
  vec2 _deDUVxy = vec2(_deUVxy.x + _deUVxy.y, _deUVxy.x - _deUVxy.y) * 0.707;
  float _deBlY = abs(normal.y);
  vec2 _deDUV = mix(_deDUVxy, _deDUVxz, _deBlY);
  vec2 _deFr = abs(fract(_deDUV) - 0.5);
  float _deD = max(_deFr.x, _deFr.y);
  float _deEdge = 1.0 - smoothstep(dGlowEdgeMin, dGlowEdgeMax, _deD);
  totalEmissiveRadiance += vec3(dGlowR, dGlowG, dGlowB) * _deEdge * dGlowMul;
}`;

  // Pre-build material sets for skins 1-3
  // Each skin = Map<meshUUID, Material>
  // 'shader' property = GLSL string injected via onBeforeCompile (normal perturbation)
  const SKIN_DEFS = [
    null, // skin 0 = default (already applied)
    // Skin 1: GHOST — full holographic skin (every slot uses HolographicMaterial).
    // Uniforms match the latest tuned powerup-cube settings (2026-05-02).
    // Nozzle keeps a normal dark MeshStandard so the exhaust port reads as
    // a real opening rather than a transparent cyan ring.
    {
      rocket_base: { holo: true, hologramColor: '#00e0ff' },
      white:       { holo: true, hologramColor: '#00e0ff' },
      gray:        { holo: true, hologramColor: '#00e0ff' },
      nozzle:      { color: 0x0a0a0a, metalness: 0.95, roughness: 0.12 },
      rocket_light:{ holo: true, hologramColor: '#00e0ff' },
      fallback:    { holo: true, hologramColor: '#00e0ff' },
    },
    // Skin 2: BLACK MAMBA — user-tuned 2026-05-02 (rust hull + cyan trim glow,
    // global Matte 0.32 baked into roughness). HSL conventions: tuner stores
    // m.color via setHSL; emissive uses Math.max(s,0.8), Math.max(l,0.5).
    {
      rocket_base: { color: 0xd36b4a, metalness: 1.00, roughness: 0.32 },
      white:       { color: 0x797234, metalness: 0.00, roughness: 0.32, emissive: 0x19d9e6, emissiveIntensity: 5.0 },
      gray:        { color: 0xd36b4a, metalness: 1.00, roughness: 0.32 },
      nozzle:      { color: 0x000000, metalness: 0.00, roughness: 0.32, emissive: 0x000000, emissiveIntensity: 0 },
      rocket_light:{ color: 0x000000, emissive: 0x19d9e6, emissiveIntensity: 11, metalness: 0, roughness: 0.32 },
      fallback:    { color: 0xd36b4a, metalness: 1.00, roughness: 0.32 },
    },
    // Skin 3: CIPHER — diamond plate with emissive edge glow
    {
      rocket_base: { color: 0x000000, metalness: 0.98, roughness: 0, emissive: 0x000000, emissiveIntensity: 0, shader: GLSL_DIAMOND, shaderEmissive: GLSL_DIAMOND_EMISSIVE },
      white:       { color: 0x000000, metalness: 0.98, roughness: 0, emissive: 0x000000, emissiveIntensity: 0, shader: GLSL_DIAMOND, shaderEmissive: GLSL_DIAMOND_EMISSIVE },
      gray:        { color: 0x000000, metalness: 0.98, roughness: 0, emissive: 0x000000, emissiveIntensity: 0, shader: GLSL_DIAMOND, shaderEmissive: GLSL_DIAMOND_EMISSIVE },
      nozzle:      { color: 0x080808, metalness: 0.95, roughness: 0.10 },
      rocket_light:{ color: 0x000000, emissive: 0x88bbff, emissiveIntensity: 6, metalness: 0, roughness: 0 },
      fallback:    { color: 0x000000, metalness: 0.98, roughness: 0, emissive: 0x000000, emissiveIntensity: 0, shader: GLSL_DIAMOND, shaderEmissive: GLSL_DIAMOND_EMISSIVE },
    },
  ];

  // Pre-build each skin's materials per mesh
  _prebuiltSkins = [_defaultMats]; // index 0 = default
  for (let s = 1; s < SKIN_DEFS.length; s++) {
    const skinMap = new Map();
    const defs = SKIN_DEFS[s];
    model.traverse(child => {
      if (!child.isMesh) return;
      const name = child.userData._origMatName;
      if (name === 'fire' || name === 'fire1') return;

      let def;
      if (name === 'rocket_base') def = defs.rocket_base;
      else if (name === 'white') def = defs.white;
      else if (name === 'gray') def = defs.gray;
      else if (name === 'nozzle') def = defs.nozzle;
      else if (name === 'rocket_light') def = defs.rocket_light;
      else def = defs.fallback;

      const props = {
        color: def.color,
        metalness: def.metalness !== undefined ? def.metalness : 0,
        roughness: def.roughness !== undefined ? def.roughness : 0.5,
        transparent: false, depthWrite: true,
      };
      if (def.emissive !== undefined) props.emissive = def.emissive;
      if (def.emissiveIntensity !== undefined) props.emissiveIntensity = def.emissiveIntensity;

      let mat;
      if (def.holo) {
        // Full holographic skin slot — same uniforms as powerup cube.
        // Ghost holo defaults — user-tuned 2026-05-02 (screenshot).
        mat = new HolographicMaterial({
          hologramColor:      def.hologramColor || '#00e0ff',
          fresnelAmount:      0.70,
          fresnelOpacity:     0.82,
          scanlineSize:       5.50,
          hologramBrightness: 1.94,
          signalSpeed:        0.00,
          enableBlinking:     true,
          blinkFresnelOnly:   true,
          hologramOpacity:    0.31,
          side:               THREE.DoubleSide,
          blendMode:          THREE.NormalBlending,
        });
        mat.depthWrite = true; // occlude sun/skybox like powerup cube
        _registerHoloMaterial(mat);
      } else if (def.physical) {
        props.clearcoat = def.clearcoat || 0;
        props.clearcoatRoughness = def.clearcoatRoughness || 0;
        if (def.anisotropy !== undefined) props.anisotropy = def.anisotropy;
        if (def.anisotropyRotation !== undefined) props.anisotropyRotation = def.anisotropyRotation;
        mat = new THREE.MeshPhysicalMaterial(props);
      } else {
        mat = new THREE.MeshStandardMaterial(props);
      }
      // Inject procedural shader if defined
      if (def.shader) {
        mat.onBeforeCompile = (shader) => {
          // Merge diamond uniforms into shader so they update live
          const du = window._diamondUniforms;
          if (du) {
            for (const k in du) shader.uniforms[k] = du[k];
          }
          // Uniform declarations for fragment shader
          const _uniDecl = 'varying vec3 vWorldPos;\n' +
            'uniform float dScale;\nuniform float dBump;\n' +
            'uniform float dEdgeMin;\nuniform float dEdgeMax;\n' +
            'uniform float dGlowR;\nuniform float dGlowG;\nuniform float dGlowB;\n' +
            'uniform float dGlowMul;\nuniform float dGlowEdgeMin;\nuniform float dGlowEdgeMax;\n';
          shader.vertexShader = _shaderVertPre + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>', _shaderVertInj);
          shader.fragmentShader = _uniDecl + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_maps>', def.shader);
          if (def.shaderEmissive) {
            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <emissivemap_fragment>', def.shaderEmissive);
          }
        };
        mat.needsUpdate = true;
      }
      skinMap.set(child.uuid, mat);
    });
    _prebuiltSkins.push(skinMap);
  }
  // ── END SKIN SYSTEM setup ────────────────────────────────────────────────

  // Warm underbelly point light — amber pool on the water below the ship
  const shipUnderlightWarm = new THREE.PointLight(0xff6620, 0.15, 6);
  shipUnderlightWarm.position.set(0, -1.2, 0);
  shipGroup.add(shipUnderlightWarm);

  shipModelLoaded = true;

  // ── PRELOAD ALT-GLB SHIPS BEHIND THE LOAD GATE ────────────────────────
  // Without this, alt-GLB ships (e.g. RUNNER MK II) only start loading when
  // applySkin() runs for them — which can be after the loading screen has
  // already faded out, leaving the user staring at a black silhouette while
  // shaders compile lazily on the first rendered frame at gameplay-start.
  // Register every alt-GLB ship as a gate promise so the loader bar genuinely
  // waits for them. _loadAltShip is cached: when applySkin later asks for the
  // same glbFile it hits the cached path and is instant.
  if (window.__loadGate) {
    SHIP_SKINS.forEach((skinDef, idx) => {
      if (!skinDef || !skinDef.glbFile) return;
      window.__loadGate.add('alt_ship_' + idx, new Promise(res => {
        // Hard timeout so a missing/broken alt GLB never blocks boot.
        const _to = setTimeout(() => res(), 12000);
        try {
          _loadAltShip(skinDef.glbFile, skinDef, idx, () => {
            clearTimeout(_to);
            res();
          });
        } catch (e) { clearTimeout(_to); res(); }
      }));
    });
  }

  // Re-apply selected skin now that model + materials are ready. For alt-GLB
  // skins this hits the cache populated by the preload above (instant).
  applySkin(loadSkinData().selected);

  // ── TITLE SHIP PREVIEW: clone into separate titleScene ──────────────
  initTitleShipPreview(model);

  // Boot gate: ship is the gating asset — resolve last
  if (typeof _shipLoadResolve === 'function') _shipLoadResolve();
});

// ── TITLE 3D SHIP PREVIEW ────────────────────────────────────────────────
function initTitleShipPreview(sourceModel) {
  // Deep clone so title and gameplay models are fully independent
  _titleShipModel = sourceModel.clone(true);

  // Build mesh map: name → mesh (for skin switching by name, not uuid)
  _titleMeshMap = [];
  _titleShipModel.traverse(child => {
    if (!child.isMesh) return;
    _titleMeshMap.push({ mesh: child, origName: child.userData._origMatName || '' });
  });

  // Apply current skin materials to clone (copy refs from source by name)
  const skinIdx = loadSkinData().selected;
  applyTitleSkin(skinIdx);

  // Position / rotation — nice 3/4 view angle, slightly nose-up
  // no rotation on model — pivot handles orientation
  _titleShipModel.position.set(0, 0, 0); // centered at origin for clean spin
  _titleShipModel.scale.setScalar(0.12);

  // Remove any existing pivot before adding a new one
  const _oldPivot = titleScene.getObjectByName('titleShipPivot');
  if (_oldPivot) titleScene.remove(_oldPivot);

  // Outer group: turntable spin (Y only)
  const spinGroup = new THREE.Group();
  spinGroup.name = 'titleShipPivot';
  spinGroup.position.set(0, -0.1, 0); // offset on the spin group, not the model
  // Inner group: perpendicular tilt
  // Use landscape tilt (0.13) on desktop/landscape, vertical (π/2) on portrait
  const tiltGroup = new THREE.Group();
  const _isTitleLandscape = window.innerWidth > window.innerHeight;
  tiltGroup.rotation.x = _isTitleLandscape ? 0.13 : Math.PI / 2;
  tiltGroup.add(_titleShipModel);
  spinGroup.add(tiltGroup);
  titleScene.add(spinGroup);

  // Display pad is now an HTML image overlay (assets/images/platform-pad.png)

  // ── STUDIO LIGHTING (title only) ── adjusted for perpendicular (nose-up) orientation
  // Key light — front-right, illuminates the side facing camera
  const keyLight = new THREE.DirectionalLight(0xffffff, 4.5);
  keyLight.position.set(3, 2, 5);
  titleScene.add(keyLight);

  // Fill light — left side, lifts shadows on opposite flank
  const fillLight = new THREE.DirectionalLight(0xddeeff, 2.2);
  fillLight.position.set(-4, 0, 4);
  titleScene.add(fillLight);

  // Rim light — behind and above for edge pop on nose/tail
  const rimLight = new THREE.DirectionalLight(0xffffff, 2.5);
  rimLight.position.set(0, 5, -4);
  titleScene.add(rimLight);

  // Top light — hits the nose from above
  const topLight = new THREE.DirectionalLight(0xeeeeff, 1.5);
  topLight.position.set(0, 6, 1);
  titleScene.add(topLight);

  // Strong ambient so dark metallic hull still reads
  const ambientLight = new THREE.AmbientLight(0x667799, 1.2);
  titleScene.add(ambientLight);
}


// Title-only cloned-material cache for per-skin overrides (see applyTitleSkin)
let _titleSkinOverrides = null;

// Apply a skin to the title ship clone — maps by mesh name, not uuid
function applyTitleSkin(skinIndex) {
  if (!_titleShipModel || !_prebuiltSkins.length) return;
  // Clamp out-of-range to default — BUT only when the skin is also missing
  // from SHIP_SKINS. Alt-GLB skins (e.g. MK Runner at idx 4) are valid even
  // though _prebuiltSkins doesn't have an entry for them: their materials
  // come from the alt GLB itself, not the per-skin material map.
  if (skinIndex < 0 || skinIndex >= SHIP_SKINS.length) skinIndex = 0;

  // ── ALT-GLB SWAP (e.g. RUNNER MK II) ─────────────────────────────────
  // Default Runner reuses the original cloned mesh and only swaps materials.
  // Skins with their own GLB file (skinDef.glbFile) need geometry swapped
  // entirely. We pull from the alt-ship cache (already preloaded behind the
  // boot gate). Falls back to default Runner clone when no alt is cached or
  // we're switching back to a non-alt skin.
  const _skinDef = SHIP_SKINS[skinIndex];
  const _wantAltGlb = !!(_skinDef && _skinDef.glbFile);
  const _curAltKey = _titleShipModel.userData && _titleShipModel.userData._altKey; // 'glb|idx' or null
  const _wantFile = _wantAltGlb ? _skinDef.glbFile : null;
  const _wantKey = _wantAltGlb ? (_skinDef.glbFile + '|' + skinIndex) : null;
  if (_wantKey !== (_curAltKey || null)) {
    let _newSrc = null;
    if (_wantKey) {
      const _cached = (typeof _altShipCache !== 'undefined') && _altShipCache[_wantKey];
      if (_cached && _cached.model) _newSrc = _cached.model;
    } else {
      _newSrc = window._shipModel || null;
    }
    if (_newSrc) {
      const parent = _titleShipModel.parent;
      if (parent) parent.remove(_titleShipModel);
      const fresh = _newSrc.clone(true);
      // Re-mark mesh slots so material override loop below can find them,
      // AND deep-clone every material so showroom-only mutations (forced
      // opaque, depth tweaks, locked silhouette) never leak back into the
      // shared gameplay alt ship that lives in the alt-ship cache.
      _titleMeshMap = [];
      // Helper: holographic ShaderMaterials must be shared with gameplay so the
      // _holoMaterials time-uniform tick keeps running on them. Cloning them
      // produces a static (often near-white) shader instance — which is the
      // GHOST 'white in garage' bug. Hull/edge MeshStandardMaterials still get
      // deep-cloned so gameplay mutations (near-miss flash, invincible rainbow)
      // don't bleed into the showroom preview.
      const _isHolo = (m) => !!(m && m.uniforms && m.uniforms.hologramColor);
      fresh.traverse(child => {
        if (!child.isMesh) return;
        if (Array.isArray(child.material)) {
          child.material = child.material.map(m => (m && m.clone && !_isHolo(m)) ? m.clone() : m);
        } else if (child.material && child.material.clone && !_isHolo(child.material)) {
          child.material = child.material.clone();
        }
        const srcOrig = child.userData && child.userData._origMatName;
        const matName = (child.material && child.material.name) ? child.material.name : '';
        child.userData._origMatName = srcOrig || matName || '';
        _titleMeshMap.push({ mesh: child, origName: child.userData._origMatName });
      });
      fresh.userData._altGlb = _wantFile;
      fresh.userData._altKey = _wantKey; // 'glb|idx' — cache key for skin-specific clone
      fresh.position.set(0, 0, 0);
      fresh.scale.setScalar(0.12);
      // Cached alt models live with visible=false (so gameplay can hide them
      // until _showAltShip flips them on). Title preview must be visible.
      fresh.visible = true;
      _titleShipModel = fresh;
      if (parent) parent.add(_titleShipModel);
      // Showroom anchors are children of the OLD ship; force them to be
      // re-created on next open by clearing the lazy-init guard.
      try {
        if (window.Showroom && typeof window.Showroom.resetThrusterAnchors === 'function') {
          window.Showroom.resetThrusterAnchors();
        }
      } catch(_){}
    }
  }

  const isLocked = !_skinAdminMode && !isSkinUnlocked(skinIndex);

  // Alt-GLB skins carry their own gameplay-tuned materials — we already
  // cloned them above. Just hide exhaust/fire flames on title and (if locked)
  // dark-silhouette every mesh, then bail before the default-Runner skin map
  // loop below (which only knows about the default ship's mesh names).
  if (_wantAltGlb) {
    // Paint per-skin materials on the title/garage preview. Without this the
    // ship inherits whatever materials the swap path produced — which on a
    // cache miss is the raw GLB (looks white/grey), and even on a cache hit
    // would skip per-skin overrides for RUNNER. _makeMatForSkinSlot returns a
    // fresh material from _SKIN_PALETTE[skinIndex] for the slot name.
    for (const entry of _titleMeshMap) {
      const { mesh, origName } = entry;
      if (origName === 'fire' || origName === 'fire1') { mesh.visible = false; continue; }
      if (isLocked) { mesh.material = _titleDarkMat; continue; }
      const newMat = _makeMatForSkinSlot(skinIndex, origName || '');
      if (newMat) mesh.material = newMat;
      // BLACK MAMBA (idx 2) extra darkening: ensures hull reads stealth black
      // under the title's bright studio rig (palette base color is rust orange
      // for in-game lighting).
      let s = origName || '';
      if (s === 'rocket base') s = 'rocket_base';
      if (s === 'white ') s = 'white';
      if (skinIndex === 2 && (s === 'rocket_base' || s === 'gray' || s === 'fallback')) {
        if (mesh.material && mesh.material.color) mesh.material.color.setHex(0x000000);
      }
    }
    return;
  }

  // Get source model's meshes to pull materials from (since _prebuiltSkins uses source uuids)
  const srcModel = window._shipModel;
  if (!srcModel) return;

  // Build source uuid→name map
  const srcNameToUuid = new Map();
  const srcUuidToMesh = new Map();
  srcModel.traverse(child => {
    if (!child.isMesh) return;
    const name = child.userData._origMatName || '';
    // Multiple meshes can share a name; collect them in order
    if (!srcNameToUuid.has(name)) srcNameToUuid.set(name, []);
    srcNameToUuid.get(name).push(child.uuid);
    srcUuidToMesh.set(child.uuid, child);
  });

  // Track how many times each name has been seen in clone traversal
  const nameCounter = new Map();

  const skinMap = _prebuiltSkins[skinIndex];

  // ── TITLE-ONLY MATERIAL OVERRIDES ────────────────────────────────
  // Some skins look correct under gameplay's dramatic lighting but read wrong
  // under title's bright studio rig (e.g. BM's rust hull color #d36b4a reads
  // black in-game because sun=0 + dirLight from below; reads orange on title).
  // Clone affected materials per skin and override their base colors so the
  // title preview matches the in-game appearance. Gameplay materials in
  // _prebuiltSkins are NOT touched.
  if (!_titleSkinOverrides) _titleSkinOverrides = new Map(); // skinIdx -> Map<srcUuid, ClonedMat>
  function getTitleMat(skinIdx, srcUuid, srcMat) {
    let bySkin = _titleSkinOverrides.get(skinIdx);
    if (!bySkin) { bySkin = new Map(); _titleSkinOverrides.set(skinIdx, bySkin); }
    if (bySkin.has(srcUuid)) return bySkin.get(srcUuid);
    // Skin 2 (Black Mamba): force hull-color slots to near-black so title
    // reads black under bright studio lights. Cyan emissive on white/
    // rocket_light slots is preserved — only base color slots are darkened.
    if (skinIdx === 2) {
      const meshAtUuid = srcUuidToMesh.get(srcUuid);
      const slot = (meshAtUuid && meshAtUuid.userData._origMatName) || '';
      // Only override hull-color slots (base color visible). Cyan-glow slots
      // (white, rocket_light) keep their original cyan look.
      if (slot === 'rocket_base' || slot === 'gray' || slot === 'fallback') {
        const cloned = srcMat.clone();
        if (cloned.color) cloned.color.setHex(0x000000);
        bySkin.set(srcUuid, cloned);
        return cloned;
      }
    }
    bySkin.set(srcUuid, srcMat);
    return srcMat;
  }

  for (const entry of _titleMeshMap) {
    const { mesh, origName } = entry;
    if (origName === 'fire' || origName === 'fire1') {
      mesh.visible = false; // hide exhaust flames on title
      continue;
    }

    if (isLocked) {
      // Locked: dark silhouette
      mesh.material = _titleDarkMat;
    } else {
      // Find the matching source mesh by name + order index
      const count = nameCounter.get(origName) || 0;
      nameCounter.set(origName, count + 1);
      const srcUuids = srcNameToUuid.get(origName);
      if (srcUuids && srcUuids[count]) {
        const srcUuid = srcUuids[count];
        const mat = skinMap.get(srcUuid);
        if (mat) mesh.material = getTitleMat(skinIndex, srcUuid, mat);
      }
    }
  }
}

// Engine exhaust glow cones removed — using particle system only

// ── SKIN SYSTEM: applySkin function (uses _prebuiltSkins declared above gltf callback) ───
function applySkin(skinIndex) {
  if (!window._shipModel || !_prebuiltSkins.length) return;
  if (skinIndex < 0 || skinIndex >= SHIP_SKINS.length) skinIndex = 0;
  activeSkinIdx = skinIndex;

  // ── DEFENSIVE LIGHTING RESET ─────────────────────────────────────────
  // Always reset lights to safe Runner defaults FIRST, before any per-skin
  // override. This guarantees that even if the per-skin lighting block at the
  // bottom is somehow short-circuited (early return, exception, async race),
  // we never leave the scene with Black Mamba's dirLight.position=(0.20,
  // -16.70, -19.20) (key light pointing UP from below) or sunLight.intensity=0
  // (no rake). That stuck state was the visible 'MK Runner is black' bug:
  // the alt-GLB hull is intentionally dark base-color (0x141820) and depends
  // on the key-from-above + sun-rake combo to read as anything but
  // silhouette. Reset is unconditional and idempotent — skins 2/3 re-stomp
  // these values below, so net behavior is unchanged for them.
  dirLight.intensity = 2.56; dirLight.position.set(2, 8.8, 8);
  rimLight.intensity = 0.10; fillLight.intensity = 0.25;
  sunLight.intensity = 0.22; sunLightL.intensity = 0.10;
  window._thrusterScale = 1.6;
  window._baseThrusterScale = 1.6;

  // ── Stale material-ref cleanup ───────────────────────────────────────
  // shipHullMats / shipEdgeLines are mutated per-frame for near-miss flash,
  // shield, invincible-speed FX. If we don't clear them at applySkin entry,
  // the alt-GLB cache-hit path (which has no traverse) leaves stale refs
  // from the previous (hard-coded) skin in these arrays — those refs point
  // at materials on the now-INVISIBLE default ship, so the visible alt ship
  // never receives the FX writes. Clear unconditionally; the !_isAltGlb
  // branch below repopulates for hard-coded skins, and the alt-GLB cache-hit
  // re-collection below repopulates for alt-GLB skins.
  shipHullMats.length = 0;
  shipEdgeLines.length = 0;

  // ── Alt GLB ship handling ──
  // Alt-GLB skins (e.g. RUNNER MK II) take a different path for the MODEL
  // (load GLB + show alt mesh), but they STILL need the per-skin lighting block
  // below to run — otherwise lights inherit whatever the last hard-coded skin
  // (e.g. Black Mamba sunLight=0, Cipher rim=0) left them at, which causes the
  // ship to render deep black on next entry. Fall through to the lighting
  // block; alt-GLB skins land in the default `else` which restores Runner
  // lighting values.
  const skinDef = SHIP_SKINS[skinIndex];
  const _isAltGlb = !!(skinDef && skinDef.glbFile);

  // ── Cone-thruster opt-in per skin ────────────────────────────────────
  // Per-skin override: skinDef.coneThrusters = true makes this skin use the
  // shader cone exhaust (mounted at nozzleWorld()) instead of the particle
  // thrusters. When ON, hide the particle systems too so only cones show.
  // Skins without the flag: cones OFF, particles ON (default behavior).
  const _wantCones = !!(skinDef && skinDef.coneThrusters);
  window._coneThrustersEnabled = _wantCones;
  window._hideOldThrusters     = _wantCones;

  if (_isAltGlb) {
    _loadAltShip(skinDef.glbFile, skinDef, skinIndex, () => {
      _showAltShip();
      // Re-collect hull/edge material refs from the now-visible alt model
      // (cache-hit path skips the traverse in _loadAltShip itself).
      if (_altShipModel) {
        const _altMeshes = _altShipModel.userData._altMeshes || [];
        for (let i = 0; i < _altMeshes.length; i++) {
          const mesh = _altMeshes[i];
          if (!mesh || !mesh.material) continue;
          const name = mesh.userData._origMatName || '';
          if (name === 'fire' || name === 'fire1') continue;
          if (name === 'rocket_base' || (name !== 'white' && name !== 'gray' && name !== 'nozzle' && name !== 'rocket_light' && name !== 'alt_hull')) {
            shipHullMats.push(mesh.material);
          } else if (name === 'alt_hull') {
            shipHullMats.push(mesh.material);
          }
          if (name === 'rocket_light' || name === 'white' || name === 'Light') {
            shipEdgeLines.push(mesh.material);
          }
        }
      }
      // Apply persisted add-on visibility (Fins/Warp Drive/Turrets) to the
      // gameplay alt ship so garage selections carry into the run.
      try { if (typeof window._applyAddonsToGameplayShip === 'function') window._applyAddonsToGameplayShip(); } catch(_){}
    });
  } else {
    _hideAltShip();
  }

  // Material work below operates on the DEFAULT _shipModel — only run it for
  // hard-coded (non-GLB) skins. Alt-GLB skins handle their own materials inside
  // _loadAltShip / _showAltShip.
  if (!_isAltGlb) {
    if (skinIndex >= _prebuiltSkins.length) skinIndex = 0;
    const skinMap = _prebuiltSkins[skinIndex];

    window._shipModel.traverse(child => {
      if (!child.isMesh) return;
      const name = child.userData._origMatName;
      if (name === 'fire' || name === 'fire1') return;

      const mat = skinMap.get(child.uuid);
      if (mat) child.material = mat;

      // Rebuild hull/edge refs
      if (name === 'rocket_base' || (name !== 'white' && name !== 'gray' && name !== 'nozzle' && name !== 'rocket_light' && name !== 'fire' && name !== 'fire1')) {
        shipHullMats.push(child.material);
      }
      if (name === 'rocket_light' || name === 'white') {
        shipEdgeLines.push(child.material);
      }
    });
  }

  // Per-skin lighting overrides (0=Runner, 1=Ghost, 2=Black Mamba, 3=Cipher,
  // 4=RUNNER MK II falls into default `else` for Runner lighting). Defaults
  // were already applied at the top — these branches override for skins 2/3.
  if (skinIndex === 2) {
    // Black Mamba: custom dramatic lighting
    dirLight.intensity = 2.37; dirLight.position.set(0.20, -16.70, -19.20);
    rimLight.intensity = 0.42; fillLight.intensity = 0.56;
    sunLight.intensity = 0.00; sunLightL.intensity = 0.00;
    window._thrusterScale = 0.5;
    window._baseThrusterScale = 0.5;
  } else if (skinIndex === 3) {
    // Cipher: no sun, no rim light, let diamond plate glow dominate
    sunLight.intensity = 0.0;
    sunLightL.intensity = 0.0;
    dirLight.intensity = 2.56; dirLight.position.set(2, 8.8, 8);
    rimLight.intensity = 0.0; fillLight.intensity = 0.25;
  }
  // else: defaults already applied at top — no-op.

  // Fix: ship-light-pop-on bug. applySkin recreates MeshStandardMaterial
  // instances every call (lines ~5868-5881). Those fresh materials have never
  // been seen by the renderer until the first gameplay frame, causing a
  // 1-frame black/dark ship as the shader compiles against the gameplay
  // scene's lights. renderer.compile() is idempotent — already-compiled
  // mats are no-ops, so this is cheap on every call but eliminates the pop.
  try { renderer.compile(scene, camera); } catch (e) {}
}

// Shared hex-panel bump shader patch (used by default ship + matchDefault alt ships)
function _hexBumpShaderPatch(shader) {
  shader.vertexShader = 'varying vec3 vWorldPos;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
  );
  shader.fragmentShader = 'varying vec3 vWorldPos;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>
float _sc = 2.0;
vec2 _uvXZ = vWorldPos.xz * _sc;
vec2 _uvXY = vWorldPos.xy * _sc;
vec2 _g1xz = fract(_uvXZ) - 0.5; vec2 _g2xz = fract(_uvXZ + 0.5) - 0.5;
float _cellXZ = min(length(_g1xz), length(_g2xz));
float _edgeXZ = 1.0 - smoothstep(0.30, 0.46, _cellXZ);
vec2 _g1xy = fract(_uvXY) - 0.5; vec2 _g2xy = fract(_uvXY + 0.5) - 0.5;
float _cellXY = min(length(_g1xy), length(_g2xy));
float _edgeXY = 1.0 - smoothstep(0.30, 0.46, _cellXY);
float _blendY = abs(normal.y);
float _edge = mix(_edgeXY, _edgeXZ, _blendY);
vec2 _hUV = mix(_uvXY, _uvXZ, _blendY);
float _bumpStr = 0.22;
vec2 _eps = vec2(0.008, 0.0);
vec2 _hUV_dx = _hUV + _eps.xy; vec2 _g1dx = fract(_hUV_dx)-0.5; vec2 _g2dx = fract(_hUV_dx+0.5)-0.5;
float _eDx = 1.0 - smoothstep(0.30,0.46, min(length(_g1dx),length(_g2dx)));
vec2 _hUV_dy = _hUV + _eps.yx; vec2 _g1dy = fract(_hUV_dy)-0.5; vec2 _g2dy = fract(_hUV_dy+0.5)-0.5;
float _eDy = 1.0 - smoothstep(0.30,0.46, min(length(_g1dy),length(_g2dy)));
vec3 _bn = normalize(normal + vec3((_eDx-_edge)*_bumpStr, (_eDy-_edge)*_bumpStr, 0.0));
normal = normalize(mix(normal, _bn, 0.65));`
  );
}

// ═══════════════════════════════════════════════════
//  ALTERNATE GLB SHIP SYSTEM
// ═══════════════════════════════════════════════════
let _altShipModel = null;       // THREE.Group for currently active alternate GLB
let _altShipActive = false;     // is alt model currently shown?
const _altShipCache = {};       // glbFile -> { model, mixer, clips, config }
let _altShipCurrentFile = null; // which glbFile is currently active
let _altShipMixer = null;       // active AnimationMixer
let _altShipClips = {};         // name -> AnimationAction for active ship

// Runtime tuner config (populated from glbConfig on skin switch)
const _altShip = {
  posX: 0, posY: 0, posZ: 0,
  rotX: 0, rotY: 0, rotZ: 0,
  scale: 0.06,
  nozzleL: new THREE.Vector3(-0.35, 0.05, 5.00),
  nozzleR: new THREE.Vector3( 0.35, 0.05, 5.00),
  miniL:   new THREE.Vector3(-0.18, 0.02, 4.90),
  miniR:   new THREE.Vector3( 0.18, 0.02, 4.90),
  thrusterScale: 1.0,
  thrusterLength: null,  // null = use global window._thrusterLength
  noMiniThrusters: false,
  bloomScale: 1.0,
};
// Baseline transform when nozzles were last tuned — used to auto-track
const _nozzleBaseline = { scale: 1.0, posX: 0, posY: 0, posZ: 0 };
function _snapshotNozzleBaseline() {
  _nozzleBaseline.scale = _altShip.scale || 1.0;
  _nozzleBaseline.posX  = _altShip.posX;
  _nozzleBaseline.posY  = _altShip.posY;
  _nozzleBaseline.posZ  = _altShip.posZ;
}

// Copy per-ship cone offsets into the live window._coneThruster so the cone
// renderer picks them up next frame. Only writes keys present in cfg — anything
// missing keeps its previous live value.
function _applyConeConfig(cfg) {
  if (!cfg || !window._coneThruster) return;
  const ct = window._coneThruster;
  const KEYS = ['length','radius','rotX','rotY','rotZ',
                'offX','offY','offZ',
                'offLX','offLY','offLZ','offRX','offRY','offRZ'];
  for (const k of KEYS) if (cfg[k] != null) ct[k] = cfg[k];
}

function _applyGlbConfig(cfg) {
  if (!cfg) return;
  _altShip.posX = cfg.posX || 0; _altShip.posY = cfg.posY || 0; _altShip.posZ = cfg.posZ || 0;
  _altShip.rotX = cfg.rotX || 0; _altShip.rotY = cfg.rotY || 0; _altShip.rotZ = cfg.rotZ || 0;
  _altShip.scale = cfg.scale || 0.06;
  if (cfg.nozzleL) _altShip.nozzleL.set(cfg.nozzleL[0], cfg.nozzleL[1], cfg.nozzleL[2]);
  if (cfg.nozzleR) _altShip.nozzleR.set(cfg.nozzleR[0], cfg.nozzleR[1], cfg.nozzleR[2]);
  if (cfg.miniL) _altShip.miniL.set(cfg.miniL[0], cfg.miniL[1], cfg.miniL[2]);
  if (cfg.miniR) _altShip.miniR.set(cfg.miniR[0], cfg.miniR[1], cfg.miniR[2]);
  _altShip.thrusterScale = cfg.thrusterScale != null ? cfg.thrusterScale : 1.0;
  _altShip.thrusterLength = cfg.thrusterLength != null ? cfg.thrusterLength : null;
  _altShip.noMiniThrusters = !!cfg.noMiniThrusters;
  _altShip.bloomScale = cfg.bloomScale != null ? cfg.bloomScale : 1.0;
  // Per-ship cone thruster offsets (if defined on this skin)
  if (cfg.coneCfg) _applyConeConfig(cfg.coneCfg);
  _snapshotNozzleBaseline();
}

function _loadAltShip(glbFile, skinDef, skinIdx, callback) {
  // Backwards-compat: old call sites passed (glbFile, skinDef, callback). If
  // a function was passed in skinIdx position, treat it as the callback and
  // derive skinIdx from SHIP_SKINS lookup.
  if (typeof skinIdx === 'function') { callback = skinIdx; skinIdx = SHIP_SKINS.indexOf(skinDef); }
  if (typeof skinIdx !== 'number' || skinIdx < 0) skinIdx = SHIP_SKINS.indexOf(skinDef);
  if (skinIdx < 0) skinIdx = 0;
  // Cache key includes skinIdx because multiple skins (RUNNER/GHOST/MAMBA/CIPHER)
  // share the same glbFile but have different per-skin materials. Each gets its
  // own cloned model + materials. Addons still key off glbFile (see _currentAddonsKey)
  // so toggling Fins on RUNNER also shows on GHOST.
  const cacheKey = glbFile + '|' + skinIdx;
  // If already cached, just switch to it
  if (_altShipCache[cacheKey]) {
    const cached = _altShipCache[cacheKey];
    _altShipModel = cached.model;
    _altShipMixer = cached.mixer || null;
    _altShipClips = cached.clips || {};
    _altShipCurrentFile = glbFile;
    _applyGlbConfig(skinDef && skinDef.glbConfig);
    _updateAltShipTransform();
    if (callback) callback();
    return;
  }
  const _skinIdxForLoad = skinIdx;
  const loader = new GLTFLoader();
  loader.load('./assets/ships/' + glbFile, (gltf) => {
    const model = gltf.scene;
    // Apply config from skin definition
    _applyGlbConfig(skinDef && skinDef.glbConfig);
    model.rotation.set(_altShip.rotX, _altShip.rotY, _altShip.rotZ);
    model.position.set(_altShip.posX, _altShip.posY, _altShip.posZ);
    model.scale.setScalar(_altShip.scale);
    // Apply materials + hide placeholder slabs
    const _altMeshes = [];
    const _cfg = skinDef && skinDef.glbConfig;
    const _stripTex = _cfg && _cfg.stripTextures;
    const _keepMats = _cfg && _cfg.keepMaterials; // trust GLB materials as-is, no overrides
    const _matchDefault = _cfg && _cfg.matchDefault; // apply same materials as default ship
    const _hasEmissiveTex = _cfg && _cfg.animated && !_stripTex; // animated models have proper PBR, don't override (unless stripped)
    model.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = false;
      // Hide flat placeholder slabs (Material.008 type — 12-face quads at origin)
      const geoCount = child.geometry ? child.geometry.index ? child.geometry.index.count / 3 : (child.geometry.attributes.position ? child.geometry.attributes.position.count / 3 : 0) : 0;
      if (geoCount <= 12) { child.visible = false; return; }
      child.userData._origMatName = 'alt_hull';
      _altMeshes.push(child);
      if (child.material) {
        if (_keepMats) {
          // Trust the GLB's own materials — add hex bump for panel detail
          child.material.onBeforeCompile = _hexBumpShaderPatch;
          child.material.needsUpdate = true;
        } else if (_matchDefault) {
          // Apply per-skin materials based on activeSkinIdx (set by caller before _loadAltShip).
          // 4 main skins (RUNNER/GHOST/MAMBA/CIPHER) all share spaceship_01.glb so addons attach;
          // each gets recolored via _SKIN_PALETTE so they keep their distinct looks.
          const matName = (child.material && child.material.name) ? child.material.name : '';
          child.userData._origMatName = matName;
          if (matName === 'fire' || matName === 'fire1') {
            shipFireMeshes.push(child);
          } else {
            const newMat = _makeMatForSkinSlot(_skinIdxForLoad, matName);
            if (newMat) {
              child.material = newMat;
              if (matName === 'rocket_base' || matName === 'rocket base' ||
                  (matName !== 'white' && matName !== 'white ' && matName !== 'gray' &&
                   matName !== 'nozzle' && matName !== 'rocket_light' && matName !== 'rocket light' &&
                   matName !== 'Light')) {
                shipHullMats.push(child.material);
              }
              if (matName === 'rocket_light' || matName === 'rocket light' ||
                  matName === 'white' || matName === 'white ' || matName === 'Light') {
                shipEdgeLines.push(child.material);
              }
            }
          }
        } else if (_stripTex) {
          // Synthwave procedural material — dark hull + neon trim
          const mname = child.name || '';
          const origMat = Array.isArray(child.material) ? child.material[0] : child.material;
          const isSpaceship2 = origMat && origMat.name === 'Spaceship_2';
          const isEngine = mname.includes('Engine_') || mname.includes('Turbine');
          const isNozzle = mname.includes('Nozzle_') || mname.includes('Thruster');
          const isGlass = mname.includes('Glass');
          const isGun = mname.includes('Gun');
          const isRocket = mname.includes('Rocket') || mname.includes('Torpedo');
          const isAirbrake = mname.includes('Airbrake');
          const isWing = mname.includes('Wing') || mname.includes('Chrome') || mname.includes('Vent');
          let mat;
          if (isGlass) {
            // Cockpit glass — translucent cyan glow
            mat = new THREE.MeshStandardMaterial({
              color: 0x0a1628, metalness: 0.9, roughness: 0.1,
              emissive: new THREE.Color(0x00e5ff), emissiveIntensity: 0.6,
              transparent: true, opacity: 0.7,
            });
          } else if (isNozzle || isEngine) {
            // Engine pods + nozzles — dark with magenta/pink neon glow
            mat = new THREE.MeshStandardMaterial({
              color: 0x12081e, metalness: 0.8, roughness: 0.25,
              emissive: new THREE.Color(0xff00ff), emissiveIntensity: 0.5,
              flatShading: true,
            });
          } else if (isGun || isRocket) {
            // Weapons — dark gunmetal with subtle orange glow
            mat = new THREE.MeshStandardMaterial({
              color: 0x0d0d14, metalness: 0.85, roughness: 0.2,
              emissive: new THREE.Color(0xff6600), emissiveIntensity: 0.3,
              flatShading: true,
            });
          } else if (isAirbrake || isWing || isSpaceship2) {
            // Trim/accent pieces (wings, fairings, body panels, airbrakes) — neon cyan edge
            mat = new THREE.MeshStandardMaterial({
              color: 0x0c0c1a, metalness: 0.7, roughness: 0.3,
              emissive: new THREE.Color(0x00e5ff), emissiveIntensity: 0.4,
              flatShading: true,
            });
          } else {
            // Primary hull — deep dark with subtle purple emissive
            mat = new THREE.MeshStandardMaterial({
              color: 0x0e0a18, metalness: 0.7, roughness: 0.35,
              emissive: new THREE.Color(0x6a0dad), emissiveIntensity: 0.25,
              flatShading: true,
            });
          }
          child.material = mat;
          if (child.geometry.attributes.uv) child.geometry.deleteAttribute('uv');
          child.geometry.computeVertexNormals(); // recompute for flat shading
        } else if (_hasEmissiveTex) {
          // Trust the model's own PBR materials — just ensure emissive is boosted for visibility
          child.material.emissiveIntensity = Math.max(child.material.emissiveIntensity || 0, 1.5);
          child.material.needsUpdate = true;
        } else {
          // Simple models without proper PBR — override for visibility + hex bump
          child.material.metalness = 0.3;
          child.material.roughness = 0.5;
          if (!child.material.emissive) child.material.emissive = new THREE.Color(0x333333);
          else child.material.emissive.set(0x333333);
          child.material.emissiveIntensity = 1.0;
          child.material.onBeforeCompile = _hexBumpShaderPatch;
          child.material.needsUpdate = true;
        }
      }
    });
    // Store mesh refs for runtime material tuning
    model.userData._altMeshes = _altMeshes;
    // ── Pod anchor capture for cone-drift diagnostic ──
    // Find the rear-most mesh node in this GLB (per-side wingtip pod or single
    // symmetric mesh) and stash a ref so the cone diagnostic can call
    // getWorldPosition() on it each frame. If the cone is rigid with shipGroup
    // and the pod node is rigid with shipGroup, the world-space Δ between them
    // must be constant frame-to-frame in ship-local space (rotates with ship
    // but stays the same after un-rotating). Any time-variation in that Δ = a
    // hidden GLB-internal transform we haven't found via grep.
    let _bestPodNode = null;
    let _bestPodCentroidZ = -Infinity;
    model.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      const bb = child.geometry.boundingBox;
      // Local-space centroid Z. We want the rear-most pod node.
      const cz = (bb.min.z + bb.max.z) * 0.5;
      if (cz > _bestPodCentroidZ) {
        _bestPodCentroidZ = cz;
        _bestPodNode = child;
      }
    });
    window._mkPodAnchor = _bestPodNode;
    model.visible = false; // hidden until skin is applied
    shipGroup.add(model);
    // Set up AnimationMixer if GLB has animations
    let mixer = null;
    const clips = {};
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      gltf.animations.forEach(clip => {
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
        clips[clip.name] = action;
      });
      // Snap hatch/door/landing-gear animations to CLOSED (end frame) for flight mode
      const _closeAnims = [
        'Cargo_DoorAction', 'Cargo_Door_AAction',
        'Chassis_Door_AAction', 'Chassis_Door_BAction',
        'Interior_Doors_LAction', 'Interior_Doors_RAction',
        'Leg_AAction', 'Leg_BAction', 'Leg_CAction', 'Leg_DAction', 'Leg_EAction',
        'FootAction_2'
      ];
      _closeAnims.forEach(name => {
        const a = clips[name];
        if (!a) return;
        a.reset();
        a.timeScale = 1;
        a.clampWhenFinished = true;
        a.setLoop(THREE.LoopOnce);
        a.play();
        // Seek to end so it snaps to closed pose instantly
        a.time = a.getClip().duration;
        a.paused = true;
      });
      // Tick mixer once at dt=0 to apply the closed poses
      if (mixer) mixer.update(0);
    }
    _altShipCache[cacheKey] = { model, mixer, clips };
    _altShipModel = model;
    _altShipMixer = mixer;
    _altShipClips = clips;
    _altShipCurrentFile = glbFile;
    // Prewarm: compile this alt ship's shaders NOW (model is in scene graph
    // but invisible) so the materials don't compile lazily on first render at
    // gameplay-start — lazy compilation showed up as a black silhouette frame
    // for MK Runner on cold loads.
    try {
      if (typeof renderer !== 'undefined' && renderer && typeof scene !== 'undefined') {
        renderer.compile(scene, camera);
      }
    } catch (e) { /* non-fatal */ }
    if (callback) callback();
  }, undefined, (err) => {
    console.error('[ALT SHIP] Failed to load:', err);
  });
}

// Apply orientation-specific nozzle offsets for ships that have portrait/landscape variants
function _applyOrientationNozzles() {
  if (!_altShipActive) return;
  const cfg = SHIP_SKINS[activeSkinIdx] && SHIP_SKINS[activeSkinIdx].glbConfig;
  if (!cfg || !cfg.portraitNozzleL) return; // no portrait overrides → nothing to do
  const isLandscape = window.innerWidth > window.innerHeight;
  if (isLandscape) {
    NOZZLE_OFFSETS[0].set(cfg.nozzleL[0], cfg.nozzleL[1], cfg.nozzleL[2]);
    NOZZLE_OFFSETS[1].set(cfg.nozzleR[0], cfg.nozzleR[1], cfg.nozzleR[2]);
    MINI_NOZZLE_OFFSETS[0].set(cfg.miniL[0], cfg.miniL[1], cfg.miniL[2]);
    MINI_NOZZLE_OFFSETS[1].set(cfg.miniR[0], cfg.miniR[1], cfg.miniR[2]);
  } else {
    NOZZLE_OFFSETS[0].set(cfg.portraitNozzleL[0], cfg.portraitNozzleL[1], cfg.portraitNozzleL[2]);
    NOZZLE_OFFSETS[1].set(cfg.portraitNozzleR[0], cfg.portraitNozzleR[1], cfg.portraitNozzleR[2]);
    MINI_NOZZLE_OFFSETS[0].set(cfg.portraitMiniL[0], cfg.portraitMiniL[1], cfg.portraitMiniL[2]);
    MINI_NOZZLE_OFFSETS[1].set(cfg.portraitMiniR[0], cfg.portraitMiniR[1], cfg.portraitMiniR[2]);
  }
  _rebuildLocalNozzles();
}

function _showAltShip() {
  if (!_altShipModel) return;
  // Hide default model
  if (window._shipModel) window._shipModel.visible = false;
  // Hide all other cached alt models
  for (const key in _altShipCache) {
    if (_altShipCache[key].model !== _altShipModel) _altShipCache[key].model.visible = false;
  }
  _altShipModel.visible = true;
  _altShipActive = true;
  // Override nozzle offsets for thrusters
  NOZZLE_OFFSETS[0].copy(_altShip.nozzleL);
  NOZZLE_OFFSETS[1].copy(_altShip.nozzleR);
  MINI_NOZZLE_OFFSETS[0].copy(_altShip.miniL);
  MINI_NOZZLE_OFFSETS[1].copy(_altShip.miniR);
  // Sync per-ship thruster globals
  window._prevThrusterScale = window._thrusterScale;  // stash to restore later
  window._prevThrusterLength = window._thrusterLength;
  window._thrusterScale = _altShip.thrusterScale;
  window._baseThrusterScale = _altShip.thrusterScale;
  if (_altShip.thrusterLength != null) window._thrusterLength = _altShip.thrusterLength;
  // Apply orientation-specific nozzles if available, otherwise just rebuild
  _applyOrientationNozzles();
  if (!SHIP_SKINS[activeSkinIdx] || !SHIP_SKINS[activeSkinIdx].glbConfig || !SHIP_SKINS[activeSkinIdx].glbConfig.portraitNozzleL) {
    _rebuildLocalNozzles();
  }
}

function _hideAltShip() {
  // Stop all running animations
  if (_altShipMixer) _altShipMixer.stopAllAction();
  _altShipMixer = null;
  _altShipClips = {};
  // Hide all cached alt models
  for (const key in _altShipCache) _altShipCache[key].model.visible = false;
  if (_altShipModel) _altShipModel.visible = false;
  if (window._shipModel) window._shipModel.visible = true;
  _altShipActive = false;
  // Restore default RUNNER nozzle offsets — must match the source-of-truth
  // NOZZLE_OFFSETS / MINI_NOZZLE_OFFSETS literals declared above. If those
  // literals change, update these too. (2026-05-01: was incorrectly hard-coded
  // to (±0.50, 0.12, 5.20) which stomped the real Runner values whenever the
  // user switched MK → Runner.)
  NOZZLE_OFFSETS[0].set(-0.48, 0.05, 5.10);
  NOZZLE_OFFSETS[1].set( 0.48, 0.05, 5.10);
  MINI_NOZZLE_OFFSETS[0].set(-0.22, 0.08, 5.10);
  MINI_NOZZLE_OFFSETS[1].set( 0.22, 0.08, 5.10);
  // Restore RUNNER cone offsets (separate from MK Runner's coneCfg)
  _applyConeConfig(RUNNER_CONE_CFG);
  // Restore stashed thruster globals
  if (window._prevThrusterScale != null) { window._thrusterScale = window._prevThrusterScale; window._baseThrusterScale = window._prevThrusterScale; }
  if (window._prevThrusterLength != null) window._thrusterLength = window._prevThrusterLength;
  _rebuildLocalNozzles();
}

function _updateAltShipTransform() {
  if (!_altShipModel) return;
  _altShipModel.rotation.set(_altShip.rotX, _altShip.rotY, _altShip.rotZ);
  _altShipModel.position.set(_altShip.posX, _altShip.posY, _altShip.posZ);
  _altShipModel.scale.setScalar(_altShip.scale);
  if (_altShipActive) _rebuildLocalNozzles();
}

function _rebuildLocalNozzles() {
  const _skinCfg2 = _altShipActive && SHIP_SKINS[activeSkinIdx] && SHIP_SKINS[activeSkinIdx].glbConfig;
  const _matchDef = _skinCfg2 && _skinCfg2.matchDefault;
  // matchDefault ships use fixed default scale (0.30) just like the default ship's
  // initial _localNozzles computation — this keeps thrusters locked to the ship
  // regardless of orientation/scale changes.
  const sc = (_matchDef || !_altShipActive) ? 0.30 : (shipGroup.scale.x || 0.30);
  const refX = (_altShipActive && !_matchDef) ? _altShip.posX : 0;
  const refY = (_altShipActive && !_matchDef) ? _altShip.posY : 0.28;
  const refZ = (_altShipActive && !_matchDef) ? _altShip.posZ : 4.5;
  const sRatio = (_altShipActive && !_matchDef) ? ((_altShip.scale || 1.0) / (_nozzleBaseline.scale || 1.0)) : 1.0;
  const dX = (_altShipActive && !_matchDef) ? (_altShip.posX - _nozzleBaseline.posX) : 0;
  const dY = (_altShipActive && !_matchDef) ? (_altShip.posY - _nozzleBaseline.posY) : 0;
  const dZ = (_altShipActive && !_matchDef) ? (_altShip.posZ - _nozzleBaseline.posZ) : 0;
  for (let i = 0; i < NOZZLE_OFFSETS.length; i++) {
    const nx = NOZZLE_OFFSETS[i].x * sRatio + dX;
    const ny = NOZZLE_OFFSETS[i].y * sRatio + dY;
    const nz = NOZZLE_OFFSETS[i].z * sRatio + dZ;
    _localNozzles[i].set(
      (nx - refX) / sc,
      (ny - refY) / sc,
      (nz - refZ) / sc
    );
  }
  for (let i = 0; i < MINI_NOZZLE_OFFSETS.length; i++) {
    const nx = MINI_NOZZLE_OFFSETS[i].x * sRatio + dX;
    const ny = MINI_NOZZLE_OFFSETS[i].y * sRatio + dY;
    const nz = MINI_NOZZLE_OFFSETS[i].z * sRatio + dZ;
    _localMiniNozzles[i].set(
      (nx - refX) / sc,
      (ny - refY) / sc,
      (nz - refZ) / sc
    );
  }
}

// ═══════════════════════════════════════════════════
//  THRUSTER PARTICLE SYSTEM
// ═══════════════════════════════════════════════════
const PARTICLE_COUNT = 160;  // per engine pod (reduced — flame quads handle core visual)
const thrusterSystems = [];

// Engine nozzle world-space offsets — derived from default_ship.glb geometry (2026-04-27)
// Anchor analysis:
//   - Hull rear face exits at world Z ≈ 5.08 (model Z=+1.92 × scale 0.30 + shipGroup.z 4.5)
//   - Engine bay (nozzle-material meshes) spans model X=[-0.46, +0.46]; mid-pod ≈ ±0.45 × 0.30 + ... → ±0.45 world
//   - Flame anchor in GLB sits at model y=-0.27, exit y ≈ 0.05 world
// Picked z=5.10 (just outside hull rear face), y=0.05, x=±0.45 as principled starting point;
// retune via T-tuner sliders if needed.
// NOZZLE_OFFSETS: particle thruster spawn positions (kept at hand-tuned values per user).
// GLB-measured anchors are kept separately in _GLB_NOZZLE_ANCHORS below for cone use.
const NOZZLE_OFFSETS = [
  new THREE.Vector3(-0.48, 0.05, 5.10),  // left pod back-bottom
  new THREE.Vector3( 0.48, 0.05, 5.10),  // right pod back-bottom
];
// User-tuned per-pose nozzle positions for signed-pitch pose-blend (Runner default).
// Pose-blend interpolates _localNozzles between NOZZLE_OFFSETS (zero pitch) and these
// targets at full pitch (±π/2). See the pose-blend block in the per-frame loop.
window._nozPoseDown = [
  new THREE.Vector3(-0.55, 0.10, 5.16),  // left  @ pitch-down
  new THREE.Vector3( 0.40, 0.09, 5.10),  // right @ pitch-down
];
window._nozPoseUp = [
  new THREE.Vector3(-0.27, 0.08, 4.91),  // left  @ pitch-up
  new THREE.Vector3( 0.74, 0.09, 5.01),  // right @ pitch-up
];
// User-tuned cone-offset deltas for full barrel roll (±pi/2). Same target for both
// up and down rolls (user confirmed one set works both ways), so blend uses
// |state.rollAngle| / (pi/2). Targets are absolute slider values, blended FROM the
// current ct.offL*/offR* sacred-zero values toward these.
//
// 2026-05-02: per-skin lookup so Default Runner and MK Runner can each have their
// own working values. Indexed by activeSkinIdx. Default Runner uses its most-recent
// Down-direction tune; MK Runner uses the 558bfb5 values (verified visually correct).
window._conePoseRoll = {};
window._conePoseRoll[4] = [
  new THREE.Vector3(-0.04, 0.00, -0.10),  // L — MK Runner full roll (558bfb5)
  new THREE.Vector3( 0.00, 0.00, -0.11),  // R — MK Runner full roll (558bfb5)
];
// Default Runner (and its recolors GHOST/BLACK MAMBA/CIPHER) use a per-direction
// Up/Down split because the user tuned distinct targets for each. Captured
// 2026-05-02 from raw-slider build (b6c6b82 — no blend, slider drives cone 1:1).
window._conePoseUp = {};
window._conePoseDown = {};
window._conePoseUp[0] = [
  new THREE.Vector3(-0.02, 0.03, -0.09),  // L — Default Runner ArrowUp full roll
  new THREE.Vector3( 0.03, 0.02, -0.14),  // R — Default Runner ArrowUp full roll
];
window._conePoseDown[0] = [
  new THREE.Vector3(-0.04, 0.02, -0.12),  // L — Default Runner ArrowDown full roll
  new THREE.Vector3(-0.04, 0.02, -0.17),  // R — Default Runner ArrowDown full roll
];
// Recolors share Default's banks.
window._conePoseUp[1]   = window._conePoseUp[0];
window._conePoseUp[2]   = window._conePoseUp[0];
window._conePoseUp[3]   = window._conePoseUp[0];
window._conePoseDown[1] = window._conePoseDown[0];
window._conePoseDown[2] = window._conePoseDown[0];
window._conePoseDown[3] = window._conePoseDown[0];
// ── Steering pose targets (drive cone offsets based on left/right turn magnitude) ──
// Indexed by activeSkinIdx, then by side (0=L, 1=R). Per-side entry = {x, y, z}
// where ONLY defined axes blend; missing axes (or null entries) leave the slider value alone.
// Blend factor is |window._steerNorm|. Disable via window._coneSteerEnabled = false.
// Auto-zeroed during barrel roll. CRITICAL: missing axis !== 0 — omitted axes are
// untouched so they stay at whatever the slider/default has.
window._conePoseSteerLeft = {};
window._conePoseSteerRight = {};
// Default Runner (skin 0): left turn shifts L offX → 0; right turn shifts R offX → 0.04.
window._conePoseSteerLeft[0]  = [ { x:  0.00 }, null ];
window._conePoseSteerRight[0] = [ null,         { x:  0.04 } ];
// Recolors share Default's steering banks.
window._conePoseSteerLeft[1]  = window._conePoseSteerLeft[0];
window._conePoseSteerLeft[2]  = window._conePoseSteerLeft[0];
window._conePoseSteerLeft[3]  = window._conePoseSteerLeft[0];
window._conePoseSteerRight[1] = window._conePoseSteerRight[0];
window._conePoseSteerRight[2] = window._conePoseSteerRight[0];
window._conePoseSteerRight[3] = window._conePoseSteerRight[0];
// MK Runner (skin 4): left turn shifts L offX → -0.04; right turn shifts R offX → 0.04.
window._conePoseSteerLeft[4]  = [ { x: -0.04 }, null ];
window._conePoseSteerRight[4] = [ null,         { x:  0.04 } ];
// GLB-derived true thruster center per side (Object_51 rear edge + Object_28/33 bore center,
// at_c079637.glb pre-merge runner). These are the EXACT geometric thruster anchors regardless
// of how NOZZLE_OFFSETS is hand-tuned for visual particle spawn. Used by the cone thruster
// console-log diagnostic so the cone-to-GLB relationship stays observable as the ship transforms.
const _GLB_NOZZLE_ANCHORS = [
  new THREE.Vector3(-0.481, 0.129, 5.114),  // left  — GLB Object_51 rear edge
  new THREE.Vector3( 0.481, 0.129, 5.114),  // right — GLB Object_51 rear edge
];
// Visible-wingtip-thruster rear-face centroid (Object_5 nozzle mesh, idx 1).
// This is the actual exhaust hole the player sees, distinct from Object_51.
// Used by the cone diagnostic to test parallax theory: if the cone (Z=5.10)
// and this anchor (Z=4.543) are on the same camera ray at zero roll, they
// will project to the same screen pixel — that's why everything looks aligned
// at zero. Any rotation should reveal a screen-pixel gap proportional to ΔZ
// projected onto the camera's right/up axes.
const _GLB_VISIBLE_THRUSTER = [
  new THREE.Vector3(-0.394, 0.129, 4.543),  // left  wingtip rear face centroid
  new THREE.Vector3( 0.394, 0.129, 4.543),  // right wingtip rear face centroid
];
// Mini thruster nozzles — inboard hull lights
const MINI_NOZZLE_OFFSETS = [
  new THREE.Vector3(-0.22, 0.08, 5.10),  // left inner hull
  new THREE.Vector3( 0.22, 0.08, 5.10),  // right inner hull
];

// Ship-local nozzle offsets for localToWorld (subtract ship default pos 0, 0.28, 4.5 then divide by scale 0.30)
const _localNozzles = NOZZLE_OFFSETS.map(n => new THREE.Vector3((n.x) / 0.30, (n.y - 0.28) / 0.30, (n.z - 4.5) / 0.30));
const _localMiniNozzles = MINI_NOZZLE_OFFSETS.map(n => new THREE.Vector3((n.x) / 0.30, (n.y - 0.28) / 0.30, (n.z - 4.5) / 0.30));
const _nozzleTmp = new THREE.Vector3();
function nozzleWorld(localOffset) {
  _nozzleTmp.copy(localOffset);
  _nozzleTmp.applyMatrix4(shipGroup.matrixWorld);
  return { x: _nozzleTmp.x, y: _nozzleTmp.y, z: _nozzleTmp.z };
}

function createThrusterSystem() {
  const positions  = new Float32Array(PARTICLE_COUNT * 3);
  const colors     = new Float32Array(PARTICLE_COUNT * 3);
  const sizes      = new Float32Array(PARTICLE_COUNT);
  const velocities = [];  // not in buffer — stored in userData
  const ages       = new Float32Array(PARTICLE_COUNT);
  const lifetimes  = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    ages[i]      = Math.random();      // stagger initial ages
    lifetimes[i] = 0.18 + Math.random() * 0.22;
    velocities.push(new THREE.Vector3());
    positions[i * 3]     = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));

  const mat = new THREE.PointsMaterial({
    size: 0.13,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    depthTest: false,   // render through water when submerged
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;  // above water plane
  scene.add(points);

  return { points, geo, velocities, ages, lifetimes, positions, colors, sizes };
}

NOZZLE_OFFSETS.forEach(() => thrusterSystems.push(createThrusterSystem()));

// ── Mini thruster systems (fewer particles, smaller) ──
const MINI_PARTICLE_COUNT = 50;
const miniThrusterSystems = [];
function createMiniThrusterSystem() {
  const positions  = new Float32Array(MINI_PARTICLE_COUNT * 3);
  const colors     = new Float32Array(MINI_PARTICLE_COUNT * 3);
  const sizes      = new Float32Array(MINI_PARTICLE_COUNT);
  const velocities = [];
  const ages       = new Float32Array(MINI_PARTICLE_COUNT);
  const lifetimes  = new Float32Array(MINI_PARTICLE_COUNT);
  for (let i = 0; i < MINI_PARTICLE_COUNT; i++) {
    ages[i]      = Math.random();
    lifetimes[i] = 0.10 + Math.random() * 0.12;
    velocities.push(new THREE.Vector3());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));
  const mat = new THREE.PointsMaterial({
    size: 0.06,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;
  scene.add(points);
  return { points, geo, velocities, ages, lifetimes, positions, colors, sizes };
}
MINI_NOZZLE_OFFSETS.forEach(() => miniThrusterSystems.push(createMiniThrusterSystem()));

// ── Mini bloom sprites ──
const miniBloomSprites = MINI_NOZZLE_OFFSETS.map(() => {
  const mat = new THREE.SpriteMaterial({
    map: null, // set after bloomTex is created
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  mat.depthTest = false;
  const sprite = new THREE.Sprite(mat);
  sprite.frustumCulled = false;
  sprite.visible = false;
  sprite.renderOrder = 10;
  scene.add(sprite);
  return sprite;
});

// ── Nozzle bloom sprites ──────────────────────────────────────────────────────
// Soft radial glow disc at each nozzle — fakes HDR bloom
function makeBloomTex() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0,   'rgba(255,255,255,1.0)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
const bloomTex = makeBloomTex();
// Assign bloomTex to mini bloom sprites (created before tex existed)
miniBloomSprites.forEach(s => { s.material.map = bloomTex; s.material.needsUpdate = true; });
const nozzleBloomSprites = NOZZLE_OFFSETS.map(() => {
  const mat = new THREE.SpriteMaterial({
    map: bloomTex,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.frustumCulled = false;
  sprite.visible = false;
  sprite.renderOrder = 10;
  mat.depthTest = false;
  scene.add(sprite);
  return sprite;
});

// ── Flame shader quads (realistic tapered flame per nozzle) ───────────────────
// Each flame is a PlaneGeometry billboard with a custom ShaderMaterial
// that uses animated noise for organic flickering.
const flameVertSrc = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const flameFragSrc = `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uIntensity;

  // Simplex-ish hash noise
  vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }
  float noise(vec2 p) {
    const float K1 = 0.366025404;  // (sqrt(3)-1)/2
    const float K2 = 0.211324865;  // (3-sqrt(3))/6
    vec2 i = floor(p + (p.x + p.y) * K1);
    vec2 a = p - i + (i.x + i.y) * K2;
    float m = step(a.y, a.x);
    vec2 o = vec2(m, 1.0 - m);
    vec2 b = a - o + K2;
    vec2 c = a - 1.0 + 2.0 * K2;
    vec3 h = max(0.5 - vec3(dot(a,a), dot(b,b), dot(c,c)), 0.0);
    h = h * h * h * h;
    vec3 n = h * vec3(dot(a, hash(i)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
    return dot(n, vec3(70.0));
  }
  float fbm(vec2 p) {
    float f = 0.0;
    f += 0.5000 * noise(p); p *= 2.02;
    f += 0.2500 * noise(p); p *= 2.03;
    f += 0.1250 * noise(p); p *= 2.01;
    f += 0.0625 * noise(p);
    return f / 0.9375;
  }

  void main() {
    // UV: x=0..1 across width, y=0 at nozzle (bottom), y=1 at tip (top)
    vec2 uv = vUv;

    // Taper: flame narrows toward tip
    float taper = 1.0 - uv.y;
    float width = mix(0.28, 0.02, uv.y * uv.y);  // quadratic taper
    float centerDist = abs(uv.x - 0.5);
    float edgeMask = smoothstep(width, width * 0.3, centerDist);

    // Animated noise for flicker
    vec2 noiseUV = vec2(uv.x * 3.0, uv.y * 2.0 - uTime * 4.5);
    float n = fbm(noiseUV + uTime * 0.8);
    float flicker = 0.7 + 0.3 * n;

    // Edge distortion — makes flame edges dance
    float edgeNoise = fbm(vec2(uv.y * 5.0 - uTime * 6.0, uv.x * 2.0)) * 0.12;
    float distortedEdge = smoothstep(width + edgeNoise, (width + edgeNoise) * 0.2, centerDist);

    // Vertical falloff — bright at base, fades at tip
    float yFade = 1.0 - smoothstep(0.0, 1.0, uv.y * uv.y);

    // Core hotspot — white-hot at nozzle center
    float core = smoothstep(0.15, 0.0, centerDist) * smoothstep(0.5, 0.0, uv.y);

    // Color: white core → level color → darker at tips
    vec3 white = vec3(1.0, 0.95, 0.9);
    vec3 col = mix(uColor, white, core * 0.4);
    // Darken tips slightly
    col = mix(col, uColor * 0.3, uv.y * uv.y * 0.5);

    float alpha = distortedEdge * yFade * flicker * uIntensity;
    alpha *= smoothstep(0.0, 0.05, uv.y); // hard cut at very base (nozzle covers it)

    gl_FragColor = vec4(col, alpha);
  }
`;

const flameMeshes = NOZZLE_OFFSETS.map(() => {
  const geo = new THREE.PlaneGeometry(1.0, 2.5);  // wider flame quad
  // Shift geometry so bottom edge is at local origin (flame extends upward from nozzle)
  geo.translate(0, 1.25, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: flameVertSrc,
    fragmentShader: flameFragSrc,
    uniforms: {
      uTime:      { value: 0 },
      uColor:     { value: new THREE.Color(0x00eeff) },
      uIntensity: { value: 1.0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 9;  // behind bloom (10)
  scene.add(mesh);
  return mesh;
});

// ── Thruster exhaust CONE meshes (neon ramp + noise dissolve) ──
// Opt-in per skin: set window._coneThrustersEnabled = true in applySkin to enable.
window._coneThrustersEnabled = false; // default off; flip per skin
// Tunable globals for the cone shader — exposed via sliders
window._coneThruster = {
  // 2026-05-01: initial values match RUNNER_CONE_CFG (boot ship is Runner).
  // Per-ship overrides: RUNNER uses RUNNER_CONE_CFG (above), MK RUNNER has its own
  // coneCfg in glbConfig. Both apply via _applyConeConfig() on ship switch.
  length:       3.30,
  radius:       0.29,    // user-tuned to fit visible thruster bore
  // Auto-orient: cone is parented to shipGroup with baseline rotX=π/2 so it points
  // straight back (+Z ship-local). rotX/rotY/rotZ here are additive fine-tune offsets
  // on top of that baseline — leave at 0 unless live-tuning a specific skin.
  rotX:         0,
  rotY:         0,
  rotZ:         0,
  // Per-side position offsets — independent for left and right cones.
  // World-space, applied on top of NOZZLE_OFFSETS[idx] (idx 0=left, 1=right).
  // Initial values = RUNNER_CONE_CFG (matching the boot ship).
  offLX:       -0.02,  offLY:        0.03,  offLZ:        0,
  offRX:        0.02,  offRY:        0.02,  offRZ:        0,
  // Legacy shared offsets (kept for back-compat — applied to BOTH sides equally).
  offX:         0,
  offY:         0,
  offZ:         0,
  neonPower:    0.90,
  noiseSpeed:   0.80,
  noiseStrength:0.13,
  fresnelPower: 6.0,
  opacity:      1.0,
};

const _coneVertSrc = /* glsl */`
  varying float vHeight;  // 0 = nozzle base, 1 = tip
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = -mvPos.xyz;
    // Unit geometry: base at y=0, tip at y=1 (after translate)
    vHeight = clamp(position.y, 0.0, 1.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const _coneFragSrc = /* glsl */`
  precision mediump float;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uNeonPower;
  uniform float uNoiseSpeed;
  uniform float uNoiseStrength;
  uniform float uFresnelPower;
  uniform float uOpacity;
  varying float vHeight;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  // Hash-based simplex noise
  vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }
  float noise(vec2 p) {
    const float K1 = 0.366025404;
    const float K2 = 0.211324865;
    vec2 i = floor(p + (p.x + p.y) * K1);
    vec2 a = p - i + (i.x + i.y) * K2;
    float m = step(a.y, a.x);
    vec2 o = vec2(m, 1.0 - m);
    vec2 b = a - o + K2;
    vec2 c = a - 1.0 + 2.0 * K2;
    vec3 h = max(0.5 - vec3(dot(a,a), dot(b,b), dot(c,c)), 0.0);
    h = h * h * h * h;
    vec3 n = h * vec3(dot(a, hash(i)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
    return dot(n, vec3(70.0));
  }
  float fbm(vec2 p) {
    float f = 0.0;
    f += 0.5000 * noise(p); p *= 2.02;
    f += 0.2500 * noise(p); p *= 2.03;
    f += 0.1250 * noise(p);
    return f / 0.875;
  }

  // Neon color ramp — hot white core → saturated color → dark
  vec3 neonRamp(float value, vec3 color) {
    float ramp = clamp(value, 0.0, 1.0);
    vec3 out_color = vec3(0.0);
    ramp = ramp * ramp;
    out_color += pow(color, vec3(4.0)) * ramp;
    ramp = ramp * ramp;
    out_color += color * ramp;
    ramp = ramp * ramp;
    out_color += vec3(1.0) * ramp;
    return out_color;
  }

  void main() {
    // Gradient: 1.0 at nozzle base, 0.0 at tip
    float grad = 1.0 - vHeight;

    // Animated noise dissolve
    vec2 noiseUV = vec2(vUv.x * 3.0, vUv.y * 0.6 - uTime * uNoiseSpeed);
    float n = fbm(noiseUV) * uNoiseStrength;
    grad = clamp(grad + n, 0.0, 1.0);

    // Neon color ramp
    vec3 col = neonRamp(pow(grad, uNeonPower), uColor);

    // Fresnel edge softening
    float fresnel = 1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
    float edgeFade = 1.0 - pow(fresnel, uFresnelPower);

    // Final alpha: gradient * edge fade * master opacity
    float alpha = grad * edgeFade * uOpacity;

    // Fade tip to zero
    alpha *= smoothstep(0.0, 0.08, grad);

    gl_FragColor = vec4(col, alpha);
  }
`;

const _thrusterCones = NOZZLE_OFFSETS.map(() => {
  const _ct = window._coneThruster;
  // Unit cone: radius=1, height=1 — scaled at runtime via cone.scale
  const geo = new THREE.ConeGeometry(1, 1, 16, 1, true);
  // Shift so base sits at local origin, tip extends in +Y
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: _coneVertSrc,
    fragmentShader: _coneFragSrc,
    uniforms: {
      uTime:          { value: 0 },
      uColor:         { value: new THREE.Color(0x44aaff) },
      uNeonPower:     { value: _ct.neonPower },
      uNoiseSpeed:    { value: _ct.noiseSpeed },
      uNoiseStrength: { value: _ct.noiseStrength },
      uFresnelPower:  { value: _ct.fresnelPower },
      uOpacity:       { value: _ct.opacity },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;  // shown only when _coneThrustersEnabled
  mesh.renderOrder = 9;
  // Parent to shipGroup so cone auto-rotates with the ship (matches particle
  // thrusters' implicit ship-relative behavior). Position is set per-frame in
  // ship-local space using _localNozzles[idx] (same offsets the particles use).
  shipGroup.add(mesh);
  return mesh;
});

// Thruster FX excluded from water reflection via onBeforeRender patch on mirrorMesh (see Water section).

// Per-level thruster colors — each level gets a unique exhaust hue
// L1 NEON DAWN:       turquoise (signature starting exhaust)
// L2 ULTRAVIOLET:     vivid violet-pink
// L3 CRIMSON VOID:    hot orange-red (fire)
// L4 ICE STORM:       icy pale blue-white
// L5 VOID SINGULARITY: warm gold
const THRUSTER_COLORS = [
  new THREE.Color(0x44aaff),  // L1 — saturated sky-blue (lum 0.61)
  new THREE.Color(0xee00ff),  // L2 — vivid violet       (lum 0.27)
  new THREE.Color(0xff3300),  // L3 — fire orange-red     (lum 0.36)
  new THREE.Color(0x33aaee),  // L4 — icy cyan-blue       (lum 0.59)
  new THREE.Color(0xff9a00),  // L5 — warm orange-gold    (lum 0.65)
];

// Level-tinted thruster color — updated each level transition
let thrusterColor = new THREE.Color(0x44aaff);
let _flameYawMult = 0.04;      // how much flame quads yaw with lateral velocity
let _flameLateralMult = 0.05;  // how much flame quads shift X with lateral velocity

// ── Hover bob mechanics ──────────────────────────────────────────────────────
let _hoverBaseY = 1.21;          // base hover height (updated by Ship Y slider)
let _bobAmplitude = 0.03;        // vertical bob range
let _bobFrequency = 0.60;       // Hz
let _bobSteerFadeOut = 4;        // how fast bob suppresses during steering
let _bobSteerFadeIn = 2;         // how fast bob returns when idle
let _bobBlend = 1;               // fades bob in (starts at 1 since no takeoff)
let _bobSteerBlend = 1;          // fades bob out during steering

// ── Thrust-based vertical flight ────────────────────────────────────────────
let _jumpVelY = 0;               // current vertical velocity
let _jumpActive = false;         // is ship above ground
let _thrustHeld = false;         // is spacebar currently held
let _thrustPower = 18.0;         // upward acceleration when holding space
let _thrustGravity = 2.0;        // light gravity while thrusting
let _fallSpeed = 20.0;           // how fast ship drops when NOT thrusting
let _thrustMaxHeight = 3.0;      // max altitude above _hoverBaseY
let _thrustDamping = 0.92;       // velocity damping each frame
let _jumpPitchMult = 1.0;        // how much pitch tilts with vertical movement
let _jumpThrusterFlare = 2.0;    // thruster intensity multiplier while thrusting

// ── Tunable thruster shape globals (exposed in G-key panel) ──
// Defaults locked from tuner export 2026-05-02. All consumers read with
// `(window._x != null ? window._x : <fallback>)`, so setting once here covers
// every read site without touching consumers.
window._thrusterSpreadX = 1.0;   // lateral spread multiplier (wider)
window._thrusterSpreadY = 1.0;   // vertical spread multiplier (flatter < 1, taller > 1)
window._thrusterLength  = 1.0;   // exhaust length multiplier
window._thrusterVisible = true;  // master on/off
// Bloom (nozzle + mini)
window._nozzleBloomScale    = (window._nozzleBloomScale    != null) ? window._nozzleBloomScale    : 1.0;
window._nozzleBloomOpacity  = (window._nozzleBloomOpacity  != null) ? window._nozzleBloomOpacity  : 0.78;
window._miniBloomScale      = (window._miniBloomScale      != null) ? window._miniBloomScale      : 1.0;
window._miniBloomOpacity    = (window._miniBloomOpacity    != null) ? window._miniBloomOpacity    : 0.15;
window._miniBloomOpacitySpd = (window._miniBloomOpacitySpd != null) ? window._miniBloomOpacitySpd : 0.15;
window._nozzleBloom_whiteMix = (window._nozzleBloom_whiteMix != null) ? window._nozzleBloom_whiteMix : 0.0;
window._miniBloom_whiteMix   = (window._miniBloom_whiteMix   != null) ? window._miniBloom_whiteMix   : 0.0;
// Particles
window._thrPart_partOpacity     = (window._thrPart_partOpacity     != null) ? window._thrPart_partOpacity     : 0.48;
window._thrPart_miniPartOpacity = (window._thrPart_miniPartOpacity != null) ? window._thrPart_miniPartOpacity : 0.48;
window._thrPart_posPinFrac      = (window._thrPart_posPinFrac      != null) ? window._thrPart_posPinFrac      : 0.14;
window._thrPart_midEnd       = (window._thrPart_midEnd       != null) ? window._thrPart_midEnd       : 0.10;
window._thrPart_midBoost     = (window._thrPart_midBoost     != null) ? window._thrPart_midBoost     : 0.00;
window._thrPart_sizeBase     = (window._thrPart_sizeBase     != null) ? window._thrPart_sizeBase     : 0.05;
window._thrPart_sizeSpeed    = (window._thrPart_sizeSpeed    != null) ? window._thrPart_sizeSpeed    : 0.00;
window._thrPart_bumpMult     = (window._thrPart_bumpMult     != null) ? window._thrPart_bumpMult     : 1.00;
window._thrPart_bumpEnd      = (window._thrPart_bumpEnd      != null) ? window._thrPart_bumpEnd      : 0.00;
window._thrPart_sizeJitter   = (window._thrPart_sizeJitter   != null) ? window._thrPart_sizeJitter   : 0.00;
window._thrPart_lifeMin      = (window._thrPart_lifeMin      != null) ? window._thrPart_lifeMin      : 0.34;
window._thrPart_lifeJit      = (window._thrPart_lifeJit      != null) ? window._thrPart_lifeJit      : 0.05;
window._thrPart_lifeBase     = (window._thrPart_lifeBase     != null) ? window._thrPart_lifeBase     : 0.20;
window._thrPart_lifeSpd      = (window._thrPart_lifeSpd      != null) ? window._thrPart_lifeSpd      : 0.00;
window._thrPart_spawnJit     = (window._thrPart_spawnJit     != null) ? window._thrPart_spawnJit     : 0.00;
// Flame mesh
window._thrFlame_coreEnd   = (window._thrFlame_coreEnd   != null) ? window._thrFlame_coreEnd   : 0.00;
window._thrFlame_coreRGB   = (window._thrFlame_coreRGB   != null) ? window._thrFlame_coreRGB   : 0.37;
window._thrFlame_midEnd    = (window._thrFlame_midEnd    != null) ? window._thrFlame_midEnd    : 0.35;
window._thrFlame_sizeBase  = (window._thrFlame_sizeBase  != null) ? window._thrFlame_sizeBase  : 0.06;
window._thrFlame_sizeSpeed = (window._thrFlame_sizeSpeed != null) ? window._thrFlame_sizeSpeed : 0.10;
window._thrFlame_bumpMult  = (window._thrFlame_bumpMult  != null) ? window._thrFlame_bumpMult  : 3.00;
window._thrFlame_bumpEnd   = (window._thrFlame_bumpEnd   != null) ? window._thrFlame_bumpEnd   : 0.30;
window._thrFlame_lifeMin   = (window._thrFlame_lifeMin   != null) ? window._thrFlame_lifeMin   : 0.01;
window._thrFlame_lifeJit   = (window._thrFlame_lifeJit   != null) ? window._thrFlame_lifeJit   : 0.00;
window._thrFlame_spawnJit  = (window._thrFlame_spawnJit  != null) ? window._thrFlame_spawnJit  : 0.075;
let _jumpLandingBounce = 0.3;    // how much bounce on landing
let _jumpLandingBounceT = 0;
let _camYFollow = 0.35;          // 0 = camera stays fixed, 1 = fully tracks ship Y

function triggerJump() {
  if (state.phase !== 'playing') return;
  _thrustHeld = true;
}

// ── Pitch tilt mechanics ─────────────────────────────────────────────────────
let _pitchForwardMax = 0.15;     // radians — nose dip on speed increase
let _pitchBackMax = 0.08;        // radians — nose up on deceleration
let _pitchSmoothing = 5;         // higher = snappier
let _pitchSmooth = 0;
let _yawMax = 0.01;              // radians — nose turn into steering direction
let _yawSmoothing = 12;          // higher = snappier yaw response
let _yawSmooth = 0;
let _bankMax = 0.03;             // LEGACY — retained for compat with old tuner code/state. New steering bank uses _steerBankRadMax (a hard angular cap in radians).
let _steerBankRadMax = 0.52;     // ~30° — hard angular cap for held-steering bank. Industry standard: aviation "bank angle warning" at 35°; modern Wipeout/F-Zero ~30–40°; Star Fox ~25°. Past ~45° breaks the mental model (brain reads it as a barrel roll, not a turn). The roll/knife-edge feature (state.rollAngle, capped ±π/2) is a separate axis.
let _bankSmoothing = 8;          // bank lerp speed while steering — into-the-bank response
let _bankReturnSmoothing = 8;    // bank lerp speed when NOT steering — controls how snappy the return-to-flat lerp is (decoupled from going-into-bank feel)
let _bankReturnRate = 12;        // how fast _bankVelX (the roll TARGET) decays back to 0 when not steering; bigger = target zeroes faster
let _camRollAmt = 0.4;           // camera-roll multiplier — horizon mirrors shipGroup.rotation.z * this; ship-roll lerp already handles smoothing
let _bankVelX = 0;               // smoothed velocity used for banking (decoupled from drift physics)
let _wobbleMaxAmp = 0.05;        // max wobble amplitude (baked)
let _wobbleDamping = 10;         // how fast wobble fades (baked)
let _overshootAmt  = 0.0;        // roll overshoot (off by default)
let _overshootDamp = 6;          // how fast overshoot damps out
let _turbulence    = 0.0;        // micro-drift turbulence (off by default)
let _wobbleSpeedMult = 0.0;      // speed wobble amplification (baked)
let _shipRotXOffset = 0.02;      // tuner offset for ship pitch angle
let _shipRotZOffset = 0;         // tuner offset for ship roll angle
let _shipZOffset = 0;            // tuner offset for ship Z position
let _shipScaleOffset = 0;        // tuner offset for ship scale (added to 0.30 base)
let _camPivotYOffset = 0.10;     // tuner offset for camera pivot Y (baked)
let _camPivotZOffset = -0.20;    // tuner offset for camera pivot Z (baked)
let _camLookYOffset = -5.00;     // tuner offset for camera lookAt Y (baked)
let _camLookZOffset = 30.50;     // tuner offset for camera lookAt Z (baked)
let _camFOVOffset = 13;          // tuner offset for camera FOV (baked from prior _baseFOV tuning)
let _baseFOV = 78;               // set per orientation in updateCameraFOV
let _fovSpeedBoost = 32;         // max FOV increase at top speed — cranked for dramatic speed feel (was 22; bumped because DR stage-to-stage felt flat)
let _prevSpeed = 0;              // for detecting accel vs decel

function updateThrusterColor(color) {
  // Locked during a run so tier/vibe transitions can't repaint the thruster.
  // Cleared on title return. Bypass with updateThrusterColor.force = true if
  // ever needed (currently no callsite uses it).
  if (window._thrusterColorLocked) return;
  thrusterColor.copy(color);
}

function updateThrusters(dt, shipX, shipY, shipZ, accel) {
  const playing    = state.phase === 'playing';
  const tp         = state.thrusterPower != null ? state.thrusterPower : 1;
  // Cap raised 2.0 → 2.6 so thruster response keeps growing through L4/L5
  // (DR max speed is 2.5x = 90 u/s). Old 2.0 cap meant any stage at ≥2.0x
  // had identical thruster particle spawn/size/length — no perceived speed
  // change in the entire mid/late game.
  const speedScale = Math.min(state.speed / BASE_SPEED, 2.6);
  const spawnRate  = (0.5 + accel * 0.5 + (speedScale - 1.0) * 0.6) * tp;  // scaled by thruster power

  // Exhaust cone scale/opacity handled in the main update() animation block

  // ── Particle PointsMaterial opacity — scales every additive contribution.
  // This is the PRIMARY white-hot dial: lower = less pile-up saturation = thruster color survives
  // through the additive stack instead of clamping to (1,1,1) and triggering bloom halo.
  const _partOp = (window._thrPart_partOpacity != null) ? window._thrPart_partOpacity : 1.0;
  const _miniPartOp = (window._thrPart_miniPartOpacity != null) ? window._thrPart_miniPartOpacity : _partOp;
  for (let i = 0, n = thrusterSystems.length; i < n; i++) {
    if (thrusterSystems[i].points.material.opacity !== _partOp) thrusterSystems[i].points.material.opacity = _partOp;
  }
  for (let i = 0, n = miniThrusterSystems.length; i < n; i++) {
    if (miniThrusterSystems[i].points.material.opacity !== _miniPartOp) miniThrusterSystems[i].points.material.opacity = _miniPartOp;
  }

  // ── Pose-blended nozzle offsets (signed-pitch interpolation) ──
  // Empirical fix for visible thruster drift under pitch: the static nozzle
  // positions only align at zero pitch. User-tuned values for full pitch-up
  // and pitch-down are stored in window._nozPoseUp / _nozPoseDown. Here we
  // lerp _localNozzles between the zero-pose (already in _localNozzles from
  // _rebuildLocalNozzles) and the pose target based on signed pitch ratio.
  // Disabled if window._nozPoseEnabled === false.
  if (window._nozPoseEnabled !== false) {
    // Driver is state.rollAngle (knife-edge / barrel-roll axis), NOT shipGroup.rotation.z.
    // rotation.z also picks up steering-bank lerp (_steerBankRadMax ~0.52 rad), which would
    // wrongly blend toward up/down pose during normal turning. state.rollAngle is 0 unless
    // ArrowUp/Down (or rollUp/Down touch) is engaged.
    const _roll = (typeof state !== 'undefined' && state && typeof state.rollAngle === 'number') ? state.rollAngle : 0;
    const _ratio = Math.max(-1, Math.min(1, _roll / (Math.PI * 0.5)));
    if (Math.abs(_ratio) > 0.001) {
      const _matchDef = _altShipActive && SHIP_SKINS[activeSkinIdx] && SHIP_SKINS[activeSkinIdx].glbConfig && SHIP_SKINS[activeSkinIdx].glbConfig.matchDefault;
      const _sc = (_matchDef || !_altShipActive) ? 0.30 : (shipGroup.scale.x || 0.30);
      const _refX = (_altShipActive && !_matchDef) ? _altShip.posX : 0;
      const _refY = (_altShipActive && !_matchDef) ? _altShip.posY : 0.28;
      const _refZ = (_altShipActive && !_matchDef) ? _altShip.posZ : 4.5;
      // ArrowUp / rollUp -> rollDir=-1 -> rotation.z negative -> _nozPoseUp.
      // ArrowDown / rollDown -> rollDir=+1 -> rotation.z positive -> _nozPoseDown.
      const _pose = (_ratio < 0) ? window._nozPoseUp : window._nozPoseDown;
      const _t = Math.abs(_ratio);
      if (_pose && _pose[0] && _pose[1]) {
        for (let i = 0; i < 2; i++) {
          const _zx = NOZZLE_OFFSETS[i].x, _zy = NOZZLE_OFFSETS[i].y, _zz = NOZZLE_OFFSETS[i].z;
          const _px = _pose[i].x,           _py = _pose[i].y,          _pz = _pose[i].z;
          const _bx = _zx + (_px - _zx) * _t;
          const _by = _zy + (_py - _zy) * _t;
          const _bz = _zz + (_pz - _zz) * _t;
          _localNozzles[i].set((_bx - _refX) / _sc, (_by - _refY) / _sc, (_bz - _refZ) / _sc);
        }
      }
    } else {
      // Near zero pitch — ensure _localNozzles reflects pure zero pose.
      // (Rebuild only if last pitch was non-trivial; cheap to just re-apply.)
      if (window._nozPoseLastRatio && Math.abs(window._nozPoseLastRatio) > 0.001) {
        _rebuildLocalNozzles();
      }
    }
    window._nozPoseLastRatio = _ratio;
  }

  // ── localToWorld: lock all thruster elements to shipGroup transform ──
  shipGroup.updateMatrixWorld(true);

  thrusterSystems.forEach((sys, idx) => {
    // Hide entire particle system when cone thrusters are taking over (debug-only toggle)
    const _oldOff = window._hideOldThrusters && window._coneThrustersEnabled;
    sys.points.visible = !_oldOff && playing && tp > 0.01 && window._thrusterVisible !== false;
    const nw = nozzleWorld(_localNozzles[idx]);
    const wx = nw.x;
    const wy = nw.y;
    const wz = nw.z;

    const pos = sys.positions;
    const col = sys.colors;
    const sz  = sys.sizes;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      sys.ages[i] += dt;

      if (sys.ages[i] >= sys.lifetimes[i]) {
        // Respawn at nozzle
        sys.ages[i] = 0;
        // Speed-reactive lifetime — longer trail at high speed [knob-substituted]
        const _tLifeMin = (window._thrPart_lifeMin != null) ? window._thrPart_lifeMin : 0.18;
        const _tLifeJit = (window._thrPart_lifeJit != null) ? window._thrPart_lifeJit : 0.22;
        const _tLifeBase = (window._thrPart_lifeBase != null) ? window._thrPart_lifeBase : 0.6;
        const _tLifeSpd = (window._thrPart_lifeSpd != null) ? window._thrPart_lifeSpd : 0.9;
        sys.lifetimes[i] = (_tLifeMin + Math.random() * _tLifeJit) * (_tLifeBase + speedScale * _tLifeSpd);

        const _tSpawn = (window._thrPart_spawnJit != null) ? window._thrPart_spawnJit : 0.03;
        pos[i * 3]     = wx + (Math.random() - 0.5) * _tSpawn;
        pos[i * 3 + 1] = wy + (Math.random() - 0.5) * _tSpawn;
        pos[i * 3 + 2] = wz;

        // Velocity: mostly +Z (backward), very tight lateral — condensed needle look
        // bendInherit: fraction of ship lateral velocity baked into spawn velocity.
        // This is what makes the trail bend with turns: while turning, shipVelX != 0
        // → new particles inherit it → trail trails out laterally. Once turn ends,
        // shipVelX → 0 → new particles spawn straight, old particles keep their inherited
        // motion and naturally fall off the back of the trail at lifetime rate.
        // No frame-rate force-pull = no slow trickle back to midline.
        const _spX = window._thrusterSpreadX || 1.0;
        const _spY = window._thrusterSpreadY || 1.0;
        const _len = (_altShipActive && _altShip.thrusterLength != null) ? _altShip.thrusterLength : (window._thrusterLength || 1.0);
        const _bendInherit = (window._thrPart_bendInherit != null) ? window._thrPart_bendInherit : 0.15;
        const _shipVelX = (state.shipVelX != null) ? state.shipVelX : 0;
        sys.velocities[i].set(
          (Math.random() - 0.5) * 0.06 * _spX + _shipVelX * _bendInherit,
          (Math.random() - 0.5) * 0.06 * _spY - 0.02,
          (2.5 + Math.random() * 2.0 + speedScale * 1.5) * _len
        );
      } else {
        const t0 = sys.ages[i] / sys.lifetimes[i];
        // Position-pin window: how long particles are clamped to the nozzle (causes additive pile-up = white-hot core).
        // Default 0.12 reproduces original look; lower values disperse particles sooner and reduce additive saturation.
        const _tPosPin = (window._thrPart_posPinFrac != null) ? window._thrPart_posPinFrac : 0.12;
        if (t0 < _tPosPin) {
          // Pin to nozzle — origin locked to pod
          pos[i * 3]     = wx;
          pos[i * 3 + 1] = wy;
          pos[i * 3 + 2] = wz;
        } else {
          // Integrate freely after leaving the nozzle
          const v = sys.velocities[i];
          pos[i * 3]     += v.x * dt;
          pos[i * 3 + 1] += v.y * dt;
          pos[i * 3 + 2] += v.z * dt;
          v.multiplyScalar(0.92);
          // Legacy bend catch-up (force-pull X toward current nozzle X). Default 0 = off.
          // Caused the "slow trickle back to midline" bug because it kept dragging old
          // particles toward the nozzle every frame regardless of when they were emitted.
          // Kept exposed at 0 default; bump to taste if you want a stylistic curve back in.
          const _bendCatchup = (window._thrPart_bendCatchup != null) ? window._thrPart_bendCatchup : 0.0;
          if (_bendCatchup > 0) pos[i * 3] += (wx - pos[i * 3]) * _bendCatchup * dt;
        }
      }

      // Lifetime ratio 0→1
      const t = sys.ages[i] / sys.lifetimes[i];

      // Color: subtle white core → level color → fade  [ORIGINAL pre-slider behavior]
      // Sliders simply substitute their values. At defaults, behavior is byte-for-byte original.
      const _tCoreEnd  = (window._thrPart_coreEnd  != null) ? window._thrPart_coreEnd  : 0.10;
      const _tCoreR    = (window._thrPart_coreR    != null) ? window._thrPart_coreR    : 1.00;
      const _tCoreGB   = (window._thrPart_coreGB   != null) ? window._thrPart_coreGB   : 0.85;
      const _tMidEnd   = (window._thrPart_midEnd   != null) ? window._thrPart_midEnd   : 0.65;
      const _tMidBoost = (window._thrPart_midBoost != null) ? window._thrPart_midBoost : 0.30;
      if (t < _tCoreEnd) {
        const s = t / _tCoreEnd;
        col[i * 3]     = _tCoreR;
        col[i * 3 + 1] = THREE.MathUtils.lerp(_tCoreGB, thrusterColor.g, s);
        col[i * 3 + 2] = THREE.MathUtils.lerp(_tCoreGB, thrusterColor.b, s);
      } else if (t < _tMidEnd) {
        // Full level color, brighter at high speed
        const s = (t - _tCoreEnd) / Math.max(0.001, (_tMidEnd - _tCoreEnd));
        const bright = 1.0 + speedScale * _tMidBoost;
        col[i * 3]     = THREE.MathUtils.lerp(thrusterColor.r * bright, thrusterColor.r, s);
        col[i * 3 + 1] = THREE.MathUtils.lerp(thrusterColor.g * bright, thrusterColor.g, s);
        col[i * 3 + 2] = THREE.MathUtils.lerp(thrusterColor.b * bright, thrusterColor.b, s);
      } else {
        // Fade to black
        const s = (t - _tMidEnd) / Math.max(0.001, (1.0 - _tMidEnd));
        col[i * 3]     = THREE.MathUtils.lerp(thrusterColor.r, 0, s);
        col[i * 3 + 1] = THREE.MathUtils.lerp(thrusterColor.g, 0, s);
        col[i * 3 + 2] = THREE.MathUtils.lerp(thrusterColor.b, 0, s);
      }

      // Size: speed-reactive — bigger/longer at high speed, scaled by thruster power [ORIGINAL behavior]
      const _tSzBase   = (window._thrPart_sizeBase   != null) ? window._thrPart_sizeBase   : 0.22;
      const _tSzSpeed  = (window._thrPart_sizeSpeed  != null) ? window._thrPart_sizeSpeed  : 0.10;
      const _tSzBumpM  = (window._thrPart_bumpMult   != null) ? window._thrPart_bumpMult   : 1.60;
      const _tSzBumpE  = (window._thrPart_bumpEnd    != null) ? window._thrPart_bumpEnd    : 0.10;
      const _tSzJitter = (window._thrPart_sizeJitter != null) ? window._thrPart_sizeJitter : 0.06;
      const baseSize = _tSzBase + speedScale * _tSzSpeed;
      const rawSz = t < _tSzBumpE
        ? THREE.MathUtils.lerp(baseSize * _tSzBumpM, baseSize, t / _tSzBumpE)
        : (1.0 - t) * (baseSize + Math.random() * _tSzJitter);
      const _shipSc = shipGroup.scale.x;
      sz[i] = rawSz * tp * (window._thrusterScale || 1.0) * _shipSc;
    }

    sys.geo.attributes.position.needsUpdate = true;
    sys.geo.attributes.color.needsUpdate    = true;
    sys.geo.attributes.size.needsUpdate     = true;

    // ── Bloom sprite for this nozzle ──
    const bloom = nozzleBloomSprites[idx];
    if (!_oldOff && playing && tp > 0.01 && window._thrusterVisible !== false) {
      bloom.visible = true;
      bloom.position.set(wx, wy, wz);
      // Sprites auto-billboard — just set size + color
      const _ts = window._thrusterScale || 1.0;
      const _nbs = window._nozzleBloomScale || 1.0;
      const _shipSc2 = shipGroup.scale.x;
      const _abs = _altShipActive ? (_altShip.bloomScale || 1.0) : 1.0;
      const bloomSize = (0.6 + speedScale * 0.7) * _ts * _nbs * _shipSc2 * _abs;
      bloom.scale.setScalar(bloomSize);
      // White-mix dial: 0 = pure thrusterColor (current default, cool/saturated), 1 = pure white (hottest)
      const _nbWhite = (window._nozzleBloom_whiteMix != null) ? window._nozzleBloom_whiteMix : 0.0;
      bloom.material.color.setRGB(
        THREE.MathUtils.lerp(thrusterColor.r, 1.0, _nbWhite),
        THREE.MathUtils.lerp(thrusterColor.g, 1.0, _nbWhite),
        THREE.MathUtils.lerp(thrusterColor.b, 1.0, _nbWhite)
      );
      const _nbo = window._nozzleBloomOpacity != null ? window._nozzleBloomOpacity : 0.34;
      // Pulse depth: amplitude of the sin throb. 0 = steady, 0.15 = legacy default.
      const _nbPulse = (window._nozzleBloomPulse != null) ? window._nozzleBloomPulse : 0.15;
      bloom.material.opacity = _nbo * ((1 - _nbPulse) + Math.sin(Date.now() * 0.008) * _nbPulse) * tp;
    } else {
      bloom.visible = false;
    }

    // Flame shader quads disabled — rigid quad can't bend with particle trail
    flameMeshes[idx].visible = false;

    // ── Thruster cone mesh ──
    // Parented to shipGroup — use ship-local offsets so cone follows ship orientation.
    // Cone geometry tip extends in +Y; ship-back direction is +Z in shipGroup local space
    // (ship nose faces -Z), so base rotation is rotX=π/2 to point cone tip out the back.
    // _coneThruster.rotX/rotY/rotZ act as additive fine-tune offsets on top of auto-orient.
    const cone = _thrusterCones[idx];
    if (window._coneThrustersEnabled && tp > 0.01 && window._thrusterVisible !== false) {
      cone.visible = true;
      const ct = window._coneThruster;
      const localNoz = _localNozzles[idx];
      // Per-side offsets (offLX/Y/Z for idx 0, offRX/Y/Z for idx 1) plus legacy shared offX/Y/Z.
      // Sliders express offsets in WORLD units (so user numbers match what the eye sees).
      // _localNozzles is in ship-local units (NOZZLE_OFFSETS / 0.30), so we must divide the
      // world-space offsets by the same ship-local scale factor before adding.
      // (2026-05-01 fix: previously the offsets were added directly in ship-local units, so
      // a slider value of 0.09 only moved the cone 0.027 in world space — making sliders feel
      // ~3.3× weaker than expected.)
      const _coneScale = (typeof shipGroup !== 'undefined' && shipGroup.scale && shipGroup.scale.x) ? shipGroup.scale.x : 0.30;
      let sideOX = idx === 0 ? (ct.offLX || 0) : (ct.offRX || 0);
      let sideOY = idx === 0 ? (ct.offLY || 0) : (ct.offRY || 0);
      let sideOZ = idx === 0 ? (ct.offLZ || 0) : (ct.offRZ || 0);
      // ── Cone-offset pose-blend (roll-magnitude driven) ──
      // User-tuned per-pose values for full barrel roll (±pi/2) — same target for both
      // directions, so blend uses |state.rollAngle| / (pi/2). Disable via
      // window._conePoseEnabled = false. Targets are stored in window._conePoseRoll.
      if (window._conePoseEnabled !== false && typeof state !== 'undefined' && state) {
        const _ra = (typeof state.rollAngle === 'number') ? state.rollAngle : 0;
        const _t = Math.max(0, Math.min(1, Math.abs(_ra) / (Math.PI * 0.5)));
        if (_t > 0.001) {
          // Default Runner + recolors (idx 0–3): direction-split Up/Down banks.
          // MK Runner (idx 4): single magnitude bank (_conePoseRoll), 558bfb5 formula.
          let _tgt = null;
          if (activeSkinIdx <= 3 && window._conePoseUp && window._conePoseDown) {
            const _bank = (_ra < 0) ? window._conePoseUp[activeSkinIdx] : window._conePoseDown[activeSkinIdx];
            _tgt = _bank && _bank[idx];
          } else if (window._conePoseRoll) {
            const _bank = window._conePoseRoll[activeSkinIdx];
            _tgt = _bank && _bank[idx];
          }
          if (_tgt) {
            sideOX = sideOX + (_tgt.x - sideOX) * _t;
            sideOY = sideOY + (_tgt.y - sideOY) * _t;
            sideOZ = sideOZ + (_tgt.z - sideOZ) * _t;
          }
        }
      }
      // ── Cone-offset pose-blend (steering-magnitude driven) ──
      // Mirrors the barrel-roll blend above but driven by window._steerNorm ∈ [-1, +1].
      // Sign picks left/right pose table; magnitude drives blend factor. Per-side null entries
      // mean "don't blend this side" — the cone stays at its slider/zero value. Disable via
      // window._coneSteerEnabled = false. _steerNorm is already zeroed during barrel roll.
      if (window._coneSteerEnabled !== false) {
        const _sNorm = (typeof window._steerNorm === 'number') ? window._steerNorm : 0;
        const _sT = Math.max(0, Math.min(1, Math.abs(_sNorm)));
        if (_sT > 0.001) {
          const _sBank = (_sNorm < 0) ? window._conePoseSteerLeft : window._conePoseSteerRight;
          const _sSide = _sBank && _sBank[activeSkinIdx];
          const _sTgt  = _sSide && _sSide[idx];
          if (_sTgt) {
            // Only blend axes that are explicitly defined on the target.
            // Omitted axes leave sideOX/sideOY/sideOZ at their slider/roll-blended value.
            if (typeof _sTgt.x === 'number') sideOX = sideOX + (_sTgt.x - sideOX) * _sT;
            if (typeof _sTgt.y === 'number') sideOY = sideOY + (_sTgt.y - sideOY) * _sT;
            if (typeof _sTgt.z === 'number') sideOZ = sideOZ + (_sTgt.z - sideOZ) * _sT;
          }
        }
      }
      cone.position.set(
        localNoz.x + (ct.offX + sideOX) / _coneScale,
        localNoz.y + (ct.offY + sideOY) / _coneScale,
        localNoz.z + (ct.offZ + sideOZ) / _coneScale
      );
      // ── Cone↔GLB diagnostic logging (throttled) ──
      // Log the live cone world position vs the GLB-derived true thruster anchor so the
      // cone-to-GLB spatial relationship is observable regardless of how shipGroup transforms.
      cone.rotation.set(Math.PI / 2 + ct.rotX, ct.rotY, ct.rotZ);
      cone.scale.set(ct.radius, ct.length * tp, ct.radius);
      // Update shader uniforms from live slider values
      const u = cone.material.uniforms;
      u.uTime.value = performance.now() * 0.001;
      u.uColor.value.copy(thrusterColor);
      u.uNeonPower.value = ct.neonPower;
      u.uNoiseSpeed.value = ct.noiseSpeed;
      u.uNoiseStrength.value = ct.noiseStrength;
      u.uFresnelPower.value = ct.fresnelPower;
      u.uOpacity.value = ct.opacity * tp;
    } else {
      cone.visible = false;
    }
  });

  // ── Mini thrusters ──
  const _hideMini = _altShipActive && _altShip.noMiniThrusters;
  miniThrusterSystems.forEach((sys, idx) => {
    sys.points.visible = !_hideMini && playing && tp > 0.01 && window._thrusterVisible !== false;
    const nw = nozzleWorld(_localMiniNozzles[idx]);
    const wx = nw.x;
    const wy = nw.y;
    const wz = nw.z;
    // Blink flicker during turns
    const turnFlicker = accel > 0.5 ? (0.5 + Math.sin(performance.now() * 0.025) * 0.5) : 1.0;
    const pos = sys.positions;
    const col = sys.colors;
    const sz  = sys.sizes;
    for (let i = 0; i < MINI_PARTICLE_COUNT; i++) {
      sys.ages[i] += dt;
      if (sys.ages[i] >= sys.lifetimes[i]) {
        sys.ages[i] = 0;
        const _fLifeMin = (window._thrFlame_lifeMin != null) ? window._thrFlame_lifeMin : 0.05;
        const _fLifeJit = (window._thrFlame_lifeJit != null) ? window._thrFlame_lifeJit : 0.06;
        sys.lifetimes[i] = _fLifeMin + Math.random() * _fLifeJit;
        const _fSpawn = (window._thrFlame_spawnJit != null) ? window._thrFlame_spawnJit : 0.02;
        pos[i * 3]     = wx + (Math.random() - 0.5) * _fSpawn;
        pos[i * 3 + 1] = wy + (Math.random() - 0.5) * _fSpawn;
        pos[i * 3 + 2] = wz;
        // Inherit ship lateral velocity at spawn (mini system uses same knob as main).
        const _miniBendInherit = (window._thrPart_bendInherit != null) ? window._thrPart_bendInherit : 0.15;
        const _shipVelX2 = (state.shipVelX != null) ? state.shipVelX : 0;
        sys.velocities[i].set(
          _shipVelX2 * _miniBendInherit,
          -0.01,
          0.8 + Math.random() * 0.4 + Math.min(speedScale, 1.2) * 0.5
        );
      } else {
        const t0 = sys.ages[i] / sys.lifetimes[i];
        if (t0 < 0.15) {
          pos[i * 3] = wx; pos[i * 3 + 1] = wy; pos[i * 3 + 2] = wz;
        } else {
          const v = sys.velocities[i];
          pos[i * 3]     += v.x * dt;
          pos[i * 3 + 1] += v.y * dt;
          pos[i * 3 + 2] += v.z * dt;
          v.multiplyScalar(0.90);
          // Legacy catch-up (default 0 = off) — see main system for rationale.
          const _miniBendCatchup = (window._thrPart_bendCatchup != null) ? window._thrPart_bendCatchup : 0.0;
          if (_miniBendCatchup > 0) pos[i * 3] += (wx - pos[i * 3]) * _miniBendCatchup * dt;
        }
      }
      const t = sys.ages[i] / sys.lifetimes[i];
      // Flame-mesh color phases [ORIGINAL pre-slider behavior, knob-substituted]
      const _fCoreEnd  = (window._thrFlame_coreEnd  != null) ? window._thrFlame_coreEnd  : 0.08;
      const _fCoreRGB  = (window._thrFlame_coreRGB  != null) ? window._thrFlame_coreRGB  : 0.85;
      const _fMidEnd   = (window._thrFlame_midEnd   != null) ? window._thrFlame_midEnd   : 0.60;
      if (t < _fCoreEnd) {
        // Hot near-white core → thruster color
        const s = t / _fCoreEnd;
        col[i*3]   = THREE.MathUtils.lerp(_fCoreRGB, thrusterColor.r, s);
        col[i*3+1] = THREE.MathUtils.lerp(_fCoreRGB, thrusterColor.g, s);
        col[i*3+2] = THREE.MathUtils.lerp(_fCoreRGB, thrusterColor.b, s);
      } else if (t < _fMidEnd) {
        col[i*3]   = thrusterColor.r;
        col[i*3+1] = thrusterColor.g;
        col[i*3+2] = thrusterColor.b;
      } else {
        const s = (t - 0.6) / 0.4;
        col[i*3]   = THREE.MathUtils.lerp(thrusterColor.r, 0, s);
        col[i*3+1] = THREE.MathUtils.lerp(thrusterColor.g, 0, s);
        col[i*3+2] = THREE.MathUtils.lerp(thrusterColor.b, 0, s);
      }
      // Flame-mesh size [ORIGINAL pre-slider behavior, knob-substituted]
      const _fSzBase  = (window._thrFlame_sizeBase  != null) ? window._thrFlame_sizeBase  : 0.035;
      const _fSzSpeed = (window._thrFlame_sizeSpeed != null) ? window._thrFlame_sizeSpeed : 0.015;
      const _fSzBumpM = (window._thrFlame_bumpMult  != null) ? window._thrFlame_bumpMult  : 1.40;
      const _fSzBumpE = (window._thrFlame_bumpEnd   != null) ? window._thrFlame_bumpEnd   : 0.10;
      const bSz = _fSzBase + speedScale * _fSzSpeed;
      const raw = t < _fSzBumpE ? THREE.MathUtils.lerp(bSz * _fSzBumpM, bSz, t / _fSzBumpE) : (1.0 - t) * bSz;
      const _shipSc3 = shipGroup.scale.x;
      sz[i] = raw * tp * turnFlicker * (window._thrusterScale || 1.0) * _shipSc3;
    }
    sys.geo.attributes.position.needsUpdate = true;
    sys.geo.attributes.color.needsUpdate    = true;
    sys.geo.attributes.size.needsUpdate     = true;

    // Mini bloom sprite
    const mBloom = miniBloomSprites[idx];
    if (playing && tp > 0.01 && window._thrusterVisible !== false) {
      mBloom.visible = true;
      mBloom.position.set(wx, wy, wz);
      const _mbs = window._miniBloomScale || 1.0;
      const _shipSc4 = shipGroup.scale.x;
      mBloom.scale.setScalar((0.25 + speedScale * 0.25) * _mbs * _shipSc4);
      const _mbWhite = (window._miniBloom_whiteMix != null) ? window._miniBloom_whiteMix : 0.0;
      mBloom.material.color.setRGB(
        THREE.MathUtils.lerp(thrusterColor.r, 1.0, _mbWhite),
        THREE.MathUtils.lerp(thrusterColor.g, 1.0, _mbWhite),
        THREE.MathUtils.lerp(thrusterColor.b, 1.0, _mbWhite)
      );
      const _mbo = (window._miniBloomOpacity != null) ? window._miniBloomOpacity : 0.15;
      const _mbs2 = (window._miniBloomOpacitySpd != null) ? window._miniBloomOpacitySpd : 0.15;
      mBloom.material.opacity = (_mbo + speedScale * _mbs2) * tp;
    } else {
      mBloom.visible = false;
    }
  });
}

// ── Flow Shield ShaderMaterial ────────────────────────────────────────────
const _shieldHitPositions = Array.from({ length: 6 }, () => new THREE.Vector3(0, 1.8, 0));
const _shieldHitTimes     = new Array(6).fill(-999);
let _shieldHitIdx = 0;

// Shield bubble: shader is animated + translucent, faceting is invisible.
// 32x32 saves ~6k tris while shield is up. Desktop keeps 48x48.
const shieldGeo = new THREE.SphereGeometry(2.4, _mobAA ? 32 : 48, _mobAA ? 32 : 48);
const shieldMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:                { value: 0 },
    uColor:               { value: new THREE.Color().setRGB(0x26/255, 0.54, 0xff/255) },
    uLife:                { value: 1.0 },
    uHitColor:            { value: new THREE.Color(1.0, 0.1, 0.1) },
    uHexScale:            { value: 2.2 },
    uEdgeWidth:           { value: 0.10 },
    uFresnelPower:        { value: 1.8 },
    uFresnelStrength:     { value: 1.45 },
    uOpacity:             { value: 1.09 },
    uReveal:              { value: 1.0 },
    uFlashSpeed:          { value: 1.25 },
    uFlashIntensity:      { value: 0.46 },
    uNoiseScale:          { value: 1.3 },
    uNoiseEdgeColor:      { value: new THREE.Color().setRGB(0x26/255, 0.54, 0xff/255) },
    uNoiseEdgeWidth:      { value: 0.02 },
    uNoiseEdgeIntensity:  { value: 7.9 },
    uNoiseEdgeSmoothness: { value: 0.69 },
    uHexOpacity:          { value: 0.50 },
    uShowHex:             { value: 1.0 },
    uFlowScale:           { value: 1.9 },
    uFlowSpeed:           { value: 0.25 },
    uFlowIntensity:       { value: 1.2 },
    uHitPos:              { value: _shieldHitPositions },
    uHitTime:             { value: _shieldHitTimes },
    uHitRingSpeed:        { value: 5.0 },
    uHitRingWidth:        { value: 0.5 },
    uHitMaxRadius:        { value: 2.0 },
    uHitDuration:         { value: 1.5 },
    uHitIntensity:        { value: 20.0 },
    uHitImpactRadius:     { value: 1.0 },
    uFadeStart:           { value: 0.40 },
    uDisplaceStrength:    { value: 0.03 },
  },
  vertexShader: `
    #define MAX_HITS 6
    uniform float uTime;
    uniform vec3  uHitPos[MAX_HITS];
    uniform float uHitTime[MAX_HITS];
    uniform float uHitRingSpeed;
    uniform float uHitRingWidth;
    uniform float uHitMaxRadius;
    uniform float uHitDuration;
    uniform float uDisplaceStrength;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vObjPos;
    void main() {
      vObjPos = position;
      vNormal = normalize(normalMatrix * normal);

      // ── Hit ripple vertex displacement ──
      // Traveling sine wave that expands from hit point and returns to 0
      vec3 normPos = normalize(position);
      float totalDisplace = 0.0;
      for (int i = 0; i < MAX_HITS; i++) {
        float ht      = uHitTime[i];
        float elapsed = uTime - ht;
        float isActive = step(0.0, ht)
                       * step(0.0, elapsed)
                       * step(elapsed, uHitDuration);
        float dist    = acos(clamp(dot(normPos, normalize(uHitPos[i])), -1.0, 1.0));
        // Traveling wave: sin advances outward over time, envelope limits spread
        float wave    = sin(dist * 12.0 - elapsed * uHitRingSpeed * 8.0);
        float envelope = smoothstep(uHitMaxRadius, 0.0, dist - elapsed * uHitRingSpeed);
        float fade    = 1.0 - smoothstep(uHitDuration * 0.4, uHitDuration, elapsed);
        totalDisplace += wave * envelope * fade * isActive;
      }
      totalDisplace = clamp(totalDisplace, -1.0, 1.0);
      vec3 displacedPos = position + normal * totalDisplace * uDisplaceStrength;

      vec4 viewPosition = modelViewMatrix * vec4(displacedPos, 1.0);
      vViewDir = normalize(-viewPosition.xyz);
      gl_Position = projectionMatrix * viewPosition;
    }
  `,
  fragmentShader: `
    #define MAX_HITS 6
    uniform float uTime;
    uniform vec3  uColor;
    uniform float uLife;
    uniform float uHexScale;
    uniform float uEdgeWidth;
    uniform float uFresnelPower;
    uniform float uFresnelStrength;
    uniform float uOpacity;
    uniform float uReveal;
    uniform float uFlashSpeed;
    uniform float uFlashIntensity;
    uniform float uNoiseScale;
    uniform vec3  uNoiseEdgeColor;
    uniform float uNoiseEdgeWidth;
    uniform float uNoiseEdgeIntensity;
    uniform float uNoiseEdgeSmoothness;
    uniform float uHexOpacity;
    uniform float uShowHex;
    uniform float uFlowScale;
    uniform float uFlowSpeed;
    uniform float uFlowIntensity;
    uniform vec3  uHitPos[MAX_HITS];
    uniform float uHitTime[MAX_HITS];
    uniform float uHitRingSpeed;
    uniform float uHitRingWidth;
    uniform float uHitMaxRadius;
    uniform float uHitDuration;
    uniform float uHitIntensity;
    uniform float uHitImpactRadius;
    uniform float uFadeStart;
    uniform vec3  uHitColor;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vObjPos;

    vec3 mod289v3(vec3 x){ return x - floor(x*(1./289.))*289.; }
    vec4 mod289v4(vec4 x){ return x - floor(x*(1./289.))*289.; }
    vec4 permute(vec4 x){ return mod289v4(((x*34.)+1.)*x); }
    vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }
    float snoise(vec3 v){
      const vec2 C = vec2(1./6., 1./3.);
      const vec4 D = vec4(0., 0.5, 1., 2.);
      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g  = step(x0.yzx, x0.xyz);
      vec3 l  = 1. - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289v3(i);
      vec4 p = permute(permute(permute(
        i.z+vec4(0.,i1.z,i2.z,1.))
       +i.y+vec4(0.,i1.y,i2.y,1.))
       +i.x+vec4(0.,i1.x,i2.x,1.));
      float n_ = 0.142857142857;
      vec3  ns = n_*D.wyz - D.xzx;
      vec4 j   = p - 49.*floor(p*ns.z*ns.z);
      vec4 x_  = floor(j*ns.z);
      vec4 y_  = floor(j - 7.*x_);
      vec4 x   = x_*ns.x + ns.yyyy;
      vec4 y   = y_*ns.x + ns.yyyy;
      vec4 h   = 1. - abs(x) - abs(y);
      vec4 b0  = vec4(x.xy, y.xy);
      vec4 b1  = vec4(x.zw, y.zw);
      vec4 s0  = floor(b0)*2.+1.;
      vec4 s1  = floor(b1)*2.+1.;
      vec4 sh  = -step(h, vec4(0.));
      vec4 a0  = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1  = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0  = vec3(a0.xy, h.x);
      vec3 p1  = vec3(a0.zw, h.y);
      vec3 p2  = vec3(a1.xy, h.z);
      vec3 p3  = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
      vec4 m = max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
      m = m*m;
      return 42.*dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }
    vec3 lifeColor(float life){
      return mix(vec3(0.6, 0.85, 1.0), uColor, life);
    }
    float hexPattern(vec2 p){
      p *= uHexScale;
      const vec2 s = vec2(1., 1.7320508);
      vec4 hC = floor(vec4(p, p-vec2(0.5,1.))/s.xyxy) + 0.5;
      vec4 h  = vec4(p-hC.xy*s, p-(hC.zw+0.5)*s);
      vec2 cell = (dot(h.xy,h.xy) < dot(h.zw,h.zw)) ? h.xy : h.zw;
      cell = abs(cell);
      float d = max(dot(cell, s*0.5), cell.x);
      return smoothstep(0.5-uEdgeWidth, 0.5, d);
    }
    vec2 hexCellId(vec2 p){
      p *= uHexScale;
      const vec2 s = vec2(1., 1.7320508);
      vec4 hC = floor(vec4(p, p-vec2(0.5,1.))/s.xyxy) + 0.5;
      vec4 h  = vec4(p-hC.xy*s, p-(hC.zw+0.5)*s);
      return (dot(h.xy,h.xy) < dot(h.zw,h.zw)) ? hC.xy : hC.zw+0.5;
    }
    float cellFlash(vec2 cellId){
      float rnd   = fract(sin(dot(cellId, vec2(127.1,311.7)))*43758.5453);
      float phase = rnd * 6.2831;
      float speed = 0.5 + rnd * 1.5;
      return smoothstep(0.6, 1.0, sin(uTime*uFlashSpeed*speed+phase)) * uFlashIntensity;
    }
    void main(){
      float noise = snoise(vObjPos * uNoiseScale) * 0.5 + 0.5;
      float revealMask = smoothstep(uReveal - uNoiseEdgeWidth, uReveal, noise);
      if (revealMask < 0.001) discard;
      float innerFade  = mix(0.98, 0.15, uNoiseEdgeSmoothness);
      float edgeLow    = smoothstep(uReveal-uNoiseEdgeWidth, uReveal-uNoiseEdgeWidth*innerFade, noise);
      float edgeHigh   = smoothstep(uReveal-uNoiseEdgeWidth*0.15, uReveal, noise);
      float revealEdge = edgeLow * (1.0 - edgeHigh);
      float fresnel = pow(1.0 - dot(vNormal, vViewDir), uFresnelPower) * uFresnelStrength;
      float t   = uTime * uFlowSpeed;
      float fn1 = snoise(vObjPos*uFlowScale + vec3(t, t*0.6, t*0.4));
      float fn2 = snoise(vObjPos*uFlowScale*2.1 + vec3(-t*0.5, t*0.9, t*0.3));
      float flowNoise = (fn1*0.6 + fn2*0.4)*0.5 + 0.5;
      vec3 absN = abs(normalize(vObjPos));
      float dominance = max(absN.x, max(absN.y, absN.z));
      float hexFade   = smoothstep(0.65, 0.85, dominance);
      vec2 faceUV;
      if (absN.x >= absN.y && absN.x >= absN.z) {
        faceUV = vObjPos.yz;
      } else if (absN.y >= absN.z) {
        faceUV = vObjPos.xz;
      } else {
        faceUV = vObjPos.xy;
      }
      float hex   = hexPattern(faceUV) * hexFade;
      vec2  cId   = hexCellId(faceUV);
      float flash = cellFlash(cId) * hexFade;
      vec3  normPos     = normalize(vObjPos);
      float ringContrib = 0.0;
      float hexHitBoost = 0.0;
      for (int i = 0; i < MAX_HITS; i++) {
        float ht      = uHitTime[i];
        float elapsed = uTime - ht;
        float isActive = step(0.0, ht)
                       * step(0.0, elapsed)
                       * step(elapsed, uHitDuration);
        float dist = acos(clamp(dot(normPos, normalize(uHitPos[i])), -1.0, 1.0));
        float ringR      = min(elapsed * uHitRingSpeed, uHitMaxRadius);
        float noiseD     = snoise(normPos*5.0 + vec3(elapsed*2.0)) * 0.05;
        float ring       = smoothstep(uHitRingWidth, 0.0, abs(dist + noiseD - ringR));
        float fade       = 1.0 - smoothstep(uHitDuration*0.5, uHitDuration, elapsed);
        float radialFade = 1.0 - smoothstep(uHitMaxRadius*0.75, uHitMaxRadius, ringR);
        ringContrib     += ring * fade * radialFade * isActive;
        float zone     = smoothstep(uHitImpactRadius, 0.0, dist);
        float zoneFade = 1.0 - smoothstep(0.0, uHitDuration*0.35, elapsed);
        hexHitBoost   += zone * zoneFade * isActive;
      }
      ringContrib = min(ringContrib, 2.0);
      hexHitBoost = min(hexHitBoost, 1.0);
      vec3  lColor = lifeColor(uLife);
      float effectiveHexOpacity = (uHexOpacity + hexHitBoost * uHitIntensity) * uShowHex;
      float intensity = hex * effectiveHexOpacity * (0.3 + fresnel*0.7) + fresnel*0.4 + flash * uShowHex;
      vec3 shieldColor = lColor * intensity * 2.0;
      shieldColor += lColor * (flowNoise * fresnel * uFlowIntensity);
      shieldColor += uHitColor * ringContrib * uHitIntensity;
      vec3 edgeColor = mix(uNoiseEdgeColor, lColor, 1.0 - uLife);
      vec3 edgeGlow  = edgeColor * revealEdge * uNoiseEdgeIntensity;
      float alpha = clamp(intensity*uOpacity*revealMask + revealEdge*uNoiseEdgeIntensity, 0.0, 1.0);
      float normY = vObjPos.y / 1.8;
      alpha *= smoothstep(-1.0, uFadeStart, normY);
      gl_FragColor = vec4(shieldColor + edgeGlow, alpha);
    }
  `,
  transparent:  true,
  depthWrite:   false,
  side:         THREE.FrontSide,
  blending:     THREE.AdditiveBlending,
  toneMapped:   true,
});
const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
shieldMesh.visible = false;
shipGroup.add(shieldMesh);

const shieldWireGeo = new THREE.SphereGeometry(2.45, 10, 10);
const shieldWireMat = new THREE.MeshBasicMaterial({
  color: 0x88ffff, transparent: true, opacity: 0, wireframe: true, depthWrite: false,
});
const shieldWire = new THREE.Mesh(shieldWireGeo, shieldWireMat);
shieldWire.visible = false;
shipGroup.add(shieldWire);

// Point light that illuminates surroundings when shield is on
const shieldLight = new THREE.PointLight(0x00eeff, 0, 8);
shipGroup.add(shieldLight);

// Magnet — orbiting green ring + green glow light
const magnetRingGeo = new THREE.TorusGeometry(3.2, 0.08, 6, 40);
const magnetRingMat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
const magnetRing  = new THREE.Mesh(magnetRingGeo, magnetRingMat);
const magnetRing2 = new THREE.Mesh(magnetRingGeo.clone(), magnetRingMat.clone());
magnetRing.visible  = false;
magnetRing2.visible = false;
shipGroup.add(magnetRing);
shipGroup.add(magnetRing2);
const magnetLight = new THREE.PointLight(0x44ff88, 0, 12);
shipGroup.add(magnetLight);

// ═══════════════════════════════════════════════════
//  OBSTACLE POOL
// ═══════════════════════════════════════════════════
const obstaclePool = [];
const activeObstacles = [];

function createObstacleMesh(type) {
  const group = new THREE.Group();
  const SINK = 2.0;

  const CONE_COLORS  = [0xff1a8c, 0x44ccff, 0xffcc00];
  const CONE_OPACITY = [0.92,     0.88,     0.95    ];
  const h = 8 + Math.random() * 3;
  const totalH = h + SINK;
  const SEGS = 6; // keep hexagon aesthetic

  // ── Obsidian cone with neon base gradient — ShaderMaterial, UV-based ──
  const neonCol = new THREE.Color(CONE_COLORS[type]);
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: {
      uNeon:    { value: neonCol },
      uObsidian:{ value: new THREE.Color(0x12121a) },
      uOpacity: { value: 0.0 },
      uGlowBot: { value: 0.255 },  // neon starts ~0.8 above waterline
      uGlowTop: { value: 0.345 },  // neon ends at ~20% up visible cone
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uNeon;
      uniform vec3 uObsidian;
      uniform float uOpacity;
      uniform float uGlowBot;
      uniform float uGlowTop;
      varying vec2 vUv;
      void main() {
        // floating neon band above waterline — obsidian below and above it
        float mid = (uGlowBot + uGlowTop) * 0.5;
        float band = smoothstep(uGlowBot, mid, vUv.y) * (1.0 - smoothstep(mid, uGlowTop, vUv.y));
        vec3 neonGlow = uNeon * (1.0 + band * 5.0);
        vec3 col = mix(uObsidian, neonGlow, band);
        gl_FragColor = vec4(col, uOpacity);
      }
    `,
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  bodyMat.userData.baseOpacity = 1.0;
  bodyMat.userData.baseColor   = CONE_COLORS[type];
  const bodyMesh = new THREE.Mesh(new THREE.ConeGeometry(1.6, totalH, SEGS), bodyMat);
  bodyMesh.position.y = totalH / 2 - SINK;
  group.add(bodyMesh);

  group.userData.type   = type;
  group.userData.active = false;
  group.userData.velX   = 0;
  group.visible         = false;
  scene.add(group);
  return group;
}

for (let i = 0; i < OBSTACLE_POOL_SIZE; i++) {
  const _o = createObstacleMesh(i % 3);
  // Cache mesh children so we never need .traverse() at runtime
  const _m = [];
  _o.traverse(c => { if (c.isMesh && c.material) _m.push(c); });
  _o.userData._meshes = _m;
  obstaclePool.push(_o);
}

// ═══════════════════════════════════════════════════
//  TERRAIN WALLS — vaporwave mountain ridges on both sides
// ═══════════════════════════════════════════════════
const _terrainTuner = {
  width:     400,   // how wide each terrain strip is (X)
  length:    400,   // how long (Z) — needs to tile seamlessly
  segsX:     24,    // grid subdivisions across width
  segsZ:     80,    // grid subdivisions along length
  xOffset:   200,   // center of terrain strip from road center
  peakHeight: 55,   // max mountain peak height — sharper glacier walls
  baseY:     -25,   // Y position
  metalness: 0.85,
  roughness: 0.25,
  scrollSpeed: 1.0, // multiplier of game speed
  gridColor: '#00eeff',
  gridOpacity: 0.15,
  baseColor: '#ffffff',
  emissiveHex: '#00eeff',
  emissiveIntensity: 1.4, // crack glow brightness
};
let _terrainWalls = null; // { left, right, mat, gridTex, shaderRef }

// Procedural grid texture on canvas
function _makeGridTexture(segsX, segsZ, color, opacity) {
  const w = 512, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // Dark glacier base
  ctx.fillStyle = '#03080f';
  ctx.fillRect(0, 0, w, h);

  // Primary cyan grid lines (thin, bright)
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= segsX; i++) {
    const x = (i / segsX) * w;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let j = 0; j <= segsZ; j++) {
    const y = (j / segsZ) * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Magenta crack lines — irregular diagonals that run across grid cells
  // Seeded so they look the same on rebuild
  let _rs = 42;
  const srng = () => { _rs = (_rs * 16807) % 2147483647; return (_rs - 1) / 2147483646; };
  ctx.lineWidth = 1.2;
  const crackCount = 18;
  for (let ci = 0; ci < crackCount; ci++) {
    const startX = srng() * w;
    const startY = srng() * h;
    // Crack wanders in ~3-5 jagged segments
    const segs = 3 + Math.floor(srng() * 3);
    const bright = srng() > 0.4; // some cracks are magenta, some pink-white
    ctx.strokeStyle = bright ? '#ff00cc' : '#cc44ff';
    ctx.globalAlpha = 0.55 + srng() * 0.35;
    ctx.lineWidth = 0.8 + srng() * 1.4;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    let cx = startX, cy2 = startY;
    for (let si = 0; si < segs; si++) {
      cx  += (srng() - 0.3) * 80;
      cy2 += (srng() - 0.1) * 60;
      ctx.lineTo(cx, cy2);
    }
    ctx.stroke();
  }

  // Subtle hotspot glows at crack intersections — small radial gradients
  for (let gi = 0; gi < 8; gi++) {
    const gx = srng() * w, gy = srng() * h;
    const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, 18 + srng() * 22);
    gr.addColorStop(0,   'rgba(255,  0, 200, 0.55)');
    gr.addColorStop(0.4, 'rgba(100,  0, 255, 0.20)');
    gr.addColorStop(1,   'rgba(0,    0,   0, 0.00)');
    ctx.fillStyle = gr;
    ctx.globalAlpha = 1;
    ctx.fillRect(gx - 40, gy - 40, 80, 80);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Displacement: sharp glacier canyon walls — steep near road edge, jagged peaks
function _displaceTerrain(geo, segsX, segsZ, peakHeight) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u  = uv.getX(i);  // 0 = road edge, 1 = far edge
    const vv = uv.getY(i);  // 0..1 along Z
    // Sharp cliff ramp: steep wall near road, peaks further out
    const edgeRamp = Math.pow(u, 1.1);  // steeper than before (was 1.8)
    // High-frequency angular noise for jagged glacier faces
    const px = u * 10.0, pz = vv * 22.0;
    const n1 = Math.sin(px * 2.1 + pz * 1.1) * 0.35;
    const n2 = Math.sin(px * 5.3 + pz * 3.7) * 0.25;  // sharper ridges
    const n3 = Math.sin(px * 0.7 + pz * 6.1) * 0.20;
    const n4 = Math.abs(Math.sin(px * 4.0 + pz * 2.5)) * 0.25; // abs = ridge peaks not valleys
    const noise = 0.45 + n1 + n2 + n3 + n4;
    // Sharpen: push toward 0 or 1 for more cliff-like faces
    const sharp = Math.pow(Math.max(0, noise), 1.35);
    const h = edgeRamp * sharp * peakHeight;
    pos.setY(i, h);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function _createTerrainWalls() {
  if (_terrainWalls) return; // already created
  const T = _terrainTuner;
  const gridTex = _makeGridTexture(T.segsX, T.segsZ, T.gridColor, T.gridOpacity);
  gridTex.repeat.set(1, 2); // tile the grid texture along length

  // Metalness map: per-cell variation via canvas noise
  const mw = 256, mh = 256;
  const mc = document.createElement('canvas');
  mc.width = mw; mc.height = mh;
  const mctx = mc.getContext('2d');
  for (let cy = 0; cy < T.segsZ; cy++) {
    for (let cx = 0; cx < T.segsX; cx++) {
      const bright = Math.random() > 0.6 ? 200 + Math.random() * 55 : Math.random() * 80;
      mctx.fillStyle = `rgb(${bright},${bright},${bright})`;
      const cw = mw / T.segsX, ch = mh / T.segsZ;
      mctx.fillRect(cx * cw, cy * ch, cw, ch);
    }
  }
  const metalTex = new THREE.CanvasTexture(mc);
  metalTex.wrapS = THREE.RepeatWrapping;
  metalTex.wrapT = THREE.RepeatWrapping;

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(T.baseColor),
    map: gridTex,
    metalnessMap: metalTex,
    metalness: T.metalness,
    roughness: T.roughness,
    emissive: new THREE.Color(T.emissiveHex),
    emissiveIntensity: T.emissiveIntensity,
    emissiveMap: gridTex,  // grid lines glow
    flatShading: true,
    side: THREE.DoubleSide,
  });

  function makeStrip(side, zOff) {
    // side: 1 = right, -1 = left; zOff: z position offset for leapfrog
    const geo = new THREE.PlaneGeometry(T.width, T.length, T.segsX, T.segsZ);
    geo.rotateX(-Math.PI / 2);
    const uvAttr = geo.attributes.uv;
    const posAttr = geo.attributes.position;
    for (let i = 0; i < uvAttr.count; i++) {
      const x = posAttr.getX(i);
      let u = (x + T.width / 2) / T.width;
      if (side === -1) u = 1.0 - u;
      uvAttr.setX(i, u);
    }
    _displaceTerrain(geo, T.segsX, T.segsZ, T.peakHeight);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.x = side * T.xOffset;
    mesh.position.y = T.baseY;
    mesh.position.z = zOff;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }

  // Two strips per side for seamless leapfrog scrolling
  const leftA  = makeStrip(-1, -T.length / 2);
  const leftB  = makeStrip(-1, -T.length / 2 - T.length);
  const rightA = makeStrip( 1, -T.length / 2);
  const rightB = makeStrip( 1, -T.length / 2 - T.length);
  _terrainWalls = { strips: [leftA, leftB, rightA, rightB], mat, gridTex, metalTex };
}

function _destroyTerrainWalls() {
  if (!_terrainWalls) return;
  _terrainWalls.strips.forEach(m => {
    scene.remove(m);
    m.geometry.dispose();
  });
  _terrainWalls.mat.dispose();
  _terrainWalls.gridTex.dispose();
  _terrainWalls.metalTex.dispose();
  _terrainWalls = null;
}

// Scroll terrain walls with game speed
function _updateTerrainWalls(dt, speed) {
  if (!_terrainWalls) return;
  const T = _terrainTuner;
  const scroll = speed * dt * T.scrollSpeed;
  _terrainWalls.strips.forEach(m => {
    m.position.z += scroll;
    // Leapfrog: when a strip passes camera, jump it behind the other
    if (m.position.z > T.length / 2) {
      m.position.z -= T.length * 2;
    }
  });
}

// ═══════════════════════════════════════════════════
//  CANYON CORRIDOR WALLS
// ═══════════════════════════════════════════════════
const _canyonTuner = {
  // Thick-block slab geometry (dialled in sandbox)
  slabH:         55,    // height
  slabW:         20,    // Z-length per slab
  slabThick:     60,    // X depth of block
  cols:           5,    // Z subdivisions
  rows:           6,    // Y subdivisions
  disp:           4.0,  // inner-face X jitter amount
  snap:           0.7,  // quantize divisor
  // Profile shape (foot→sweep→mid→crest outward X)
  footX:         9.0,   // 0 = straight inner wall, negative = overhang toward corridor
  sweepX:        4.0,
  midX:         17.0,
  crestX:       20.0,
  poolSize:      10,    // slabs per side
  // Scroll
  scrollSpeed:   1.0,
  snapRate:      6.0,
  // Cyan slab material
  cyanEmi:       1.1,   // emissive intensity
  cyanRgh:       0.4,   // roughness
  // Holo overlay
  holoOpacity:   0.5,
  holoGrid:      6.0,
  // Dark slab
  darkCrkCount:  6,
  darkCrkBright: 1.0,
  darkRgh:       0.22,   // marble roughness (0=mirror, 1=matte)
  darkClearcoat: 0.40,   // clearcoat layer strength
  darkEmi:       0.9,    // dark slab emissive intensity
  // Canyon lights
  lightIntensity: 1.0,   // master multiplier for all 4 canyon lights
  // Corridor width override — half-gap between walls (wall foot lands at center ± halfXOverride)
  halfXOverride: 40,
  // Entrance: first N slabs get entranceThick — extends the slab outward while staying flush
  entranceThick: 450,   // slab thickness for entrance slabs (increase to expand laterally)
  entranceSlabs:  1,    // how many leading slabs use entranceThick
  // How far away the canyon spawns (larger = see entrance from farther away)
  spawnDepth:   -400,
  // Canyon-own sine wave (independent of L3 corridor)
  sineIntensity: 0.0,   // master multiplier 0=off, 1=full
  sineAmp:       30.0,  // peak swing in world units
  sinePeriod:    25.0,  // rows per full cycle (larger = lazier curves)
  sineSpeed:     1.0,   // how fast phase advances per slab scroll tick
  _allCyan:      true,  // true = all slabs cyan, false = alternating cyan/dark
  // === L4-RECREATION (experimental) ===
  // When true: inner face of each slab is bent into a column-wise curve that
  // traces L4's sine-corridor shape. Pinned at near edge to previous slab's
  // far edge (anchor lock) so adjacent slabs meet without gap.
  // Flip from console: window._canyonSet({_l4Recreation: true})
  // No collision changes yet — ship passes through bent walls (Push 1 visual only).
  _l4Recreation: false,
  _l4RampCompress: 1.45, // compress L4's 386-row ramp into canyon's ~93-slab window
  _l4AmpScale:     1.0,  // tune overall amp later
  // L4-only overrides applied at K-hotkey spawn (not applied to C1 preset itself).
  // _l4HalfX:  half-gap between walls in L4 mode. L4 uses L4_NARROW_X=6 (12u gap).
  //            Default 8 leaves small buffer over L4 min to avoid wall clipping at peak amp.
  // _l4SlabW:  Z-length per slab in L4 mode. Longer slabs = fewer recycles + more columns
  //            across a wider Z span for smoother bend sampling. 40 = 2x default.
  _l4HalfX:        8,
  _l4SlabW:       40,
};
// Expose for window._exportScene() — mirrors live tuner state after B/V edits
window._canyonTuner = _canyonTuner;
let _canyonWalls     = null;
let _canyonTexCache  = null; // pre-warmed textures + materials to avoid first-spawn stutter
let _canyonFillLight = null;
const _CANYON_LIGHT_DEFS = [
  { pos: [-3,  4,  2], intensity: 1.2 },
  { pos: [ 3,  4,  2], intensity: 1.2 },
  { pos: [ 0,  3, -4], intensity: 1.0 },
  { pos: [ 0, -2,  4], intensity: 0.8 },
];

// Persistent canyon lights: pre-added at scene init with intensity=0 so the
// lights-hash (which drives every material's program cacheKey) is stable across
// the entire session. Canyon activate/deactivate just flips intensity — no
// visibility toggle, no scene.add/remove — so no material recompile wave.
// (THREE.js: changing intensity does NOT recompile; visibility or presence does.)
//
// Color = original cyan (0xc8f0ff). User confirmed this looks best. Smoothing
// of transitions handled by _canyonLightT ramp below — 600ms smoothstep on
// enter and exit so the change is imperceptible.
const _CANYON_PERSISTENT_LIGHTS = _CANYON_LIGHT_DEFS.map(({ pos }) => {
  const l = new THREE.DirectionalLight(0xc8f0ff, 0); // intensity=0 until canyon active
  l.position.set(...pos);
  scene.add(l);
  return l;
});
// Canyon transition ramp (0..1). Ticked in _updateCanyonWalls each frame.
// 0 = global lighting (no canyon lights, dirLight at saved value).
// 1 = canyon lighting (full canyon lights, dirLight at canyon target).
// Smoothed with smoothstep ease + 600ms duration for imperceptible blend.
let _canyonLightT = 0;
const _CANYON_LIGHT_FILL = 1.0;       // 100% — original intensities preserved
const _CANYON_LIGHT_RAMP_S = 0.60;    // 600ms ease in/out (long enough to be invisible)
// Optional dirLight modulation during canyon (used by L3-knife / Pre-T4A / Pre-T4B).
// _canyonDirLightFrom = saved pre-canyon intensity (set when entering one of those
// canyons). _canyonDirLightTarget = where to drive it (0 traditionally). When both
// are non-null, _updateCanyonWalls ramps dirLight = lerp(From, Target, eased(_canyonLightT)).
let _canyonDirLightFrom = null;
let _canyonDirLightTarget = null;
window._setCanyonDirLightTarget = function(target) {
  if (typeof dirLight === 'undefined' || !dirLight) return;
  if (_canyonDirLightFrom === null) _canyonDirLightFrom = dirLight.intensity;
  _canyonDirLightTarget = target;
};
window._clearCanyonDirLightTarget = function() {
  // Called by canyon-exit logic. Ramp will drive dirLight back toward From
  // as _canyonLightT eases to 0; once fully eased, we restore + clear state.
  _canyonDirLightTarget = null; // tells ramp to head home
};
let _canyonActive = false;
let _canyonManual = false; // true when triggered by V key — bypasses sequencer row counting
let _canyonMode   = 0;    // 0=off, 1=Corridor1 (cyan+sine), 2=Regular (alt+sine), 3=Straight (cyan+no sine)
const _CANYON_MODE_NAMES = ['OFF', 'Canyon Corridor 1', 'Canyon Corridor 2', 'Regular Canyon', 'Straight Canyon'];
const _CANYON_PRESETS = {
  // NOTE: _allCyan and _allDark MUST be explicit on every preset. _canyonTuner is
  // updated via Object.assign, so an omitted key inherits the previous preset's
  // value — e.g. mode 2 (_allDark:true) bleeding into mode 4 made the straight
  // canyon render all-dark instead of alternating cyan/dark.
  1: { slabH:55, slabW:20, slabThick:60, sineIntensity:0.28, sineAmp:120, sinePeriod:330, sineSpeed:1, halfXOverride:34, entranceThick:700, entranceSlabs:1, spawnDepth:-250, scrollSpeed:1.0, _allCyan:true,  _allDark:false },
  2: { slabH:55, slabW:20, slabThick:60, sineIntensity:0.47, sineAmp:146, sinePeriod:530, sineSpeed:1, halfXOverride:34, entranceThick:700, entranceSlabs:1, spawnDepth:-250, scrollSpeed:1.0, _allCyan:false, _allDark:true, darkRgh:0.32, darkEmi:1.4 },
  3: { slabH:55, slabW:20, slabThick:60, sineIntensity:0.28, sineAmp:120, sinePeriod:265, sineSpeed:1, halfXOverride:34, entranceThick:700, entranceSlabs:1, spawnDepth:-250, scrollSpeed:1.0, _allCyan:false, _allDark:false },
  4: { slabH:55, slabW:20, slabThick:60, sineIntensity:0.0,  sineAmp:0,   sinePeriod:265, sineSpeed:1, halfXOverride:68, entranceThick:700, entranceSlabs:1, spawnDepth:-250, scrollSpeed:2.6, _allCyan:false, _allDark:false },
  // Mode 5 = EXPERIMENTAL — test bed, B hotkey only, never triggered by sequencer.
  // Has optional ramp fields: sineStartI/Z/FullZ for gradual sine-intensity along Z,
  // halfXStart/Full/StartZ/FullZ for corridor width squeeze along Z.
  // Undefined fields → flat behavior.
  5: { slabH:55, slabW:20, slabThick:60,
       sineIntensity:0.30, sineAmp:120, sinePeriod:330, sineSpeed:1,
       sineStartI:0.0,   sineStartZ:-150, sineFullZ:-500,
       halfXOverride:50,
       halfXStart:60,    halfXFull:25, halfXStartZ:-150, halfXFullZ:-500,
       entranceThick:700, entranceSlabs:1, spawnDepth:-250, scrollSpeed:1.5,
       _allCyan:false },
};
let _canyonSqueezeRow = 0;
let _canyonSqueezeZ   = 0;
let _canyonSineT         = 0;
let _canyonSineRows      = 0;
let _canyonSineZ         = 0;
let _canyonSinePhase     = 0; // canyon-own sine accumulator
let _l4RowsElapsed       = 0; // L4-recreation: rows of L4 corridor progression advanced since canyon start
let _canyonExiting       = false; // true during scroll-out exit — slabs drift off, no recycle
let _canyonWasCorridor   = false;
let _canyonDiagFrame     = 0;     // frame counter for periodic diagnostic log
// Call window._canyonLog() from console to get a full snapshot of canyon state + tuner
window._canyonLog = function() {
  const T = _canyonTuner;
  const walls = _canyonWalls;
  const footOff = T.footX; // signed
  // Find slabs nearest to ship for true gap measurement
  let nearL = null, nearR = null, bestLZ = Infinity, bestRZ = Infinity;
  if (walls) {
    walls.left.forEach(m  => { const d = Math.abs(m.position.z - 3.9); if(d < bestLZ){ bestLZ=d; nearL=m; } });
    walls.right.forEach(m => { const d = Math.abs(m.position.z - 3.9); if(d < bestRZ){ bestRZ=d; nearR=m; } });
  }
  const leftEdge  = nearL ? nearL.position.x : null;
  const rightEdge = nearR ? nearR.position.x : null;
  const gap = (leftEdge != null && rightEdge != null) ? +(rightEdge - leftEdge).toFixed(2) : null;
  const driftRight = null;
  const driftLeft  = null;
  const accurate   = null;
  const out = {
    '--- CORRIDOR ---': '',
    active:            _canyonActive,
    rowsDone:          row,
    sineT:             +(state.corridorSineT||0).toFixed(3),
    gapCenter:         +(state.corridorGapCenter||0).toFixed(2),
    shipX:             +(state.shipX||0).toFixed(2),
    leftEdgeX:         leftEdge  != null ? +leftEdge.toFixed(2)  : null,
    rightEdgeX:        rightEdge != null ? +rightEdge.toFixed(2) : null,
    visibleGapWidth:   gap,
    shipInGap:         (leftEdge!=null && rightEdge!=null) ? (state.shipX > leftEdge && state.shipX < rightEdge) : null,
    '--- L3 ACCURACY ---': '',
    l3_row:            row,
    l3_center:         l3Center,
    l3_halfX:          l3HalfX,
    l3_expectedRight:  l3ExpectedRight,
    l3_expectedLeft:   l3ExpectedLeft,
    driftRight:        driftRight,
    driftLeft:         driftLeft,
    accurate:          accurate,
    verdict:           accurate === null ? 'no data' : (accurate ? 'OK ✓' : 'DRIFTED ✗ — check footX math'),
    '--- TUNER ---': '',
    slabH:        T.slabH,
    slabW:        T.slabW,
    slabThick:    T.slabThick,
    cols:         T.cols,
    rows:         T.rows,
    disp:         T.disp,
    snap:         T.snap,
    footX:        T.footX,
    sweepX:       T.sweepX,
    midX:         T.midX,
    crestX:       T.crestX,
    poolSize:     T.poolSize,
    scrollSpeed:  T.scrollSpeed,
    cyanEmi:      T.cyanEmi,
    cyanRgh:      T.cyanRgh,
    holoOpacity:  T.holoOpacity,
    holoGrid:     T.holoGrid,
    darkCrkCount: T.darkCrkCount,
    darkCrkBright:T.darkCrkBright,
    '--- SLAB POSITIONS ---': '',
    // DIAG: flags driving material choice
    _allCyan_flag: T._allCyan,
    _allDark_flag: T._allDark,
    _spacing:      walls ? walls._spacing : null,
    rightSlabs: walls ? walls.right.map(m => {
      const mat = m.children && m.children[0] ? m.children[0].material : null;
      const isCy = mat === walls.cyanMat ? 'CYAN' : mat === walls.darkMat ? 'dark' : '?';
      const pIdx = walls._spacing ? Math.round(-m.position.z / walls._spacing) : null;
      return { x: +m.position.x.toFixed(1), z: +m.position.z.toFixed(1), bakedX: m.userData.bakedX != null ? +m.userData.bakedX.toFixed(1) : null, posIdx: pIdx, mat: isCy, ent: !!m.userData.isEntrance };
    }).sort((a,b)=>a.z-b.z) : null,
  };
  console.log('[CANYON LOG]\n' + JSON.stringify(out, null, 2));
  return out;
};
// Also expose tuner setter: window._canyonSet({slabH:70, footX:0, ...})
window._canyonSet = function(vals) {
  Object.assign(_canyonTuner, vals);
  console.log('[CANYON SET] applied:', JSON.stringify(vals));
  return _canyonTuner;
};

function _makeCanyonCyanTex(seed) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#030b14';
  ctx.fillRect(0,0,512,512);
  const streak = ctx.createLinearGradient(0,0,300,512);
  streak.addColorStop(0,   'rgba(120,240,255,0.95)');
  streak.addColorStop(0.15,'rgba(60,200,255,0.70)');
  streak.addColorStop(0.4, 'rgba(20,120,200,0.30)');
  streak.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(0,0,512,512);
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

function _makeCanyonDarkTex(seed) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const ctx = cv.getContext('2d');
  let s = (seed|0) || 1;
  const rng = () => { s=(s*9301+49297)%233280; return s/233280; };
  ctx.fillStyle = '#030608';
  ctx.fillRect(0,0,512,512);
  // Subtle marble veins
  ctx.strokeStyle = '#0a1525';
  for(let i=0;i<6;i++){
    ctx.globalAlpha=0.3+rng()*0.3; ctx.lineWidth=6+rng()*12;
    ctx.beginPath();
    let x=rng()*512,y=0; ctx.moveTo(x,y);
    for(let sg=0;sg<8;sg++){ x=Math.max(0,Math.min(512,x+(rng()-0.5)*80)); y=Math.min(512,y+rng()*70+10); ctx.lineTo(x,y); }
    ctx.stroke();
  }
  ctx.globalAlpha=1;
  // Magenta cracks — horizontal
  const _crk = _canyonTuner.darkCrkCount || 6;
  const _crkB = _canyonTuner.darkCrkBright !== undefined ? _canyonTuner.darkCrkBright : 1.0;
  for(let ci=0;ci<_crk;ci++){
    const bright=rng()>0.4;
    ctx.strokeStyle=bright?'#ff00cc':'#cc44ff';
    ctx.shadowColor='#ff00cc'; ctx.shadowBlur=bright?(14*_crkB):(6*_crkB);
    ctx.globalAlpha=(0.7+rng()*0.3)*_crkB; ctx.lineWidth=1.5+rng()*3.0;
    ctx.beginPath();
    let x=rng()*60+4, y=rng()*480+16; ctx.moveTo(x,y);
    for(let sg=0;sg<5+Math.floor(rng()*5);sg++){
      x=Math.min(508,x+rng()*80+15);
      y=Math.max(4,Math.min(508,y+(rng()-0.3)*60));
      ctx.lineTo(x,y);
      if(rng()>0.7){
        ctx.save(); ctx.beginPath(); ctx.moveTo(x,y);
        ctx.lineTo(Math.min(508,x+rng()*50+10),Math.max(4,Math.min(508,y+(rng()-0.5)*50)));
        ctx.globalAlpha=(0.4+rng()*0.3); ctx.lineWidth=0.8+rng()*1.5; ctx.stroke(); ctx.restore();
      }
      if(x>=504) break;
    }
    ctx.stroke();
  }
  ctx.shadowBlur=0; ctx.globalAlpha=1;
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

// === L4-RECREATION math helpers ==========================================
// Ported from src/40-main-late.js (L4 corridor constants). Returns the L4
// centerline X at a given worldZ, evaluated as if the canyon was the L4
// corridor. Pure function. No state. Call at bake time, never per-frame.
//
//  worldZ:    the world-Z position of the query point
//  canyonElapsedSec: seconds since canyon corridor began (for time-based ramp)
//                   if null, pure Z-based ramp (same shape at any time)
//
// Ramp compression: L4 runs 386 rows over 50s. Canyon segment is ~30s, and
// runs at ~62 u/s with 20u slab spacing ≈ 93 slabs. We compress L4's AMP_RAMP
// and PERIOD_RAMP by _l4RampCompress (default 1.45x) so the canyon hits L4's
// mid-to-peak shape within its window.
//
// NOTE: this fn is Z-anchored — entrance-ref-Z is -150 (same as _canyonXAtZ),
// so phase at Z=-150 = 0. That guarantees the corridor mouth is centered.
const _L4_CONST = {
  CORRIDOR_WIDE_X:  80, L4_NARROW_X:   6,  PEAK_NARROW:   4.5, KNIFE_NARROW: 3,
  CLOSE_ROWS:       35, STRAIGHT:      10,
  AMP_START:        14, AMP_MAX:       44, AMP_RAMP:    120,
  PERIOD_START:    220, PERIOD_MIN:   160, PERIOD_RAMP: 260,
  KNIFE_START:     370, KNIFE_END:    395,
  ROW_GAP_Z:         7,
};

function _l4SineAtZ(worldZ) {
  // Map worldZ to L4-row count. Entrance mouth is at Z=-150 (row 0 equivalent),
  // deeper Z = further into L4 corridor. L4 row_gap = 7u in L4 world; at canyon
  // scroll speed 62 u/s the canyon covers 7u faster than L4 does, so 1 canyon
  // slab (20u) = 20/7 ≈ 2.86 L4-rows. Ramp compression scales this further.
  const C = _L4_CONST;
  const T = _canyonTuner;
  const ENTRANCE_REF_Z = -150;
  // L4 rows elapsed at this worldZ (deeper Z → more rows into corridor)
  const rawRows   = Math.max(0, (ENTRANCE_REF_Z - worldZ) / C.ROW_GAP_Z);
  // Compress: pretend we're further into L4 than we actually are
  // Add _l4RowsElapsed: global accumulator advanced per-frame by scroll/ROW_GAP_Z × compress.
  // This makes the whole corridor walk THROUGH L4's progression (approach → curve → peak → knife)
  // over time, mirroring how _canyonSinePhase drives C1/C2 sine motion.
  const rows      = rawRows * (T._l4RampCompress || 1.0) + _l4RowsElapsed;
  // Base = corridorGapCenter (set to state.shipX at canyon trigger time, see
  // _startL3KnifeCanyon at 40-main-late.js:526). Mirrors _canyonXAtZ which
  // also bases off corridorGapCenter — without this the L4-recreation canyon
  // builds anchored to world X=0 even when the ship is offset, so the
  // entrance + entire corridor lands off-ship. Anchor-chain (_bakeSlabCurveForL4
  // deltas) then carries the ship-X anchor through every slab.
  const base = state.corridorGapCenter || 0;
  // Center (sine) — mirrors L4 math exactly
  let center = 0;
  if (rows >= C.CLOSE_ROWS + C.STRAIGHT) {
    const curveRows = rows - (C.CLOSE_ROWS + C.STRAIGHT);
    const ampT   = Math.min(1, curveRows / C.AMP_RAMP);
    const amp    = (C.AMP_START + (C.AMP_MAX - C.AMP_START) * ampT * ampT) * (T._l4AmpScale || 1.0);
    const perT   = Math.min(1, curveRows / C.PERIOD_RAMP);
    const period = C.PERIOD_START - (C.PERIOD_START - C.PERIOD_MIN) * perT * perT;
    // Phase: sum of (2pi/period) over accumulated rows. Approximate via integral of period(r):
    //   phase(rows) ≈ sum_{r=0}^{curveRows} 2pi/period(r). For small compression we
    //   can accurately use the mean period — at peak, period ranges 220→160, mean ~190.
    //   For tuning purposes here, use integral approx: phase = 2pi * rows / period_avg.
    //   TODO after first preview: switch to exact numerical integration if visible drift.
    const periodAvg = (C.PERIOD_START + period) / 2;
    const phase     = (2 * Math.PI) * curveRows / periodAvg;
    center = amp * Math.sin(phase);
  }
  return base + center;
}

// Bend a slab's inner-face vertex buffer to follow L4 sine. Called after the
// flat-default geometry is already on the mesh. Overwrites the inner-face
// triangle positions in-place. Other faces (back, bottom, top, caps) are left
// flat — we only care about the inner visible corridor wall.
//
// Anchor-lock: the near-edge column (c=0) gets pinned to `anchorX` (which is
// the previous slab's far-edge X). Remaining columns sample L4 sine at their
// worldZ and apply the X delta relative to what the original flat slab had.
//
//  pivot:   the slab's pivot Group (has position.z = slabZ, children[0] = mesh)
//  slabZ:   world Z of pivot
//  side:    -1 for left, +1 for right
//  anchorX: previous slab's far-edge world X (or null for first-in-chain)
//
// Returns: this slab's far-edge world X (for next slab's anchor).
function _bakeSlabCurveForL4(pivot, slabZ, side, anchorX) {
  const T = _canyonTuner;
  if (!T._l4Recreation) return null;
  const mesh = pivot.children && pivot.children[0];
  if (!mesh || !mesh.geometry) return null;
  const geo  = mesh.geometry;
  const posAttr = geo.attributes.position;
  if (!posAttr) return null;
  const W    = T.slabW;
  const COLS = T.cols;

  // Each column's world-Z (pivot.z + local z). Inner-face verts have local Z
  // in [0, W]. Column c is at local z = (c/COLS) * W. We sample L4 at each
  // column boundary (0..COLS) — COLS+1 sample points.
  const sampleCenters = new Array(COLS + 1);
  for (let c = 0; c <= COLS; c++) {
    const localZ = (c / COLS) * W;
    const worldZ = slabZ + localZ;
    sampleCenters[c] = _l4SineAtZ(worldZ);
  }

  // Anchor lock: if anchorX provided, shift all samples so sample[0] matches
  // what the anchor implies. Ship-space: pivot.position.x is the foot X of
  // this slab at c=0 when flat. anchorX is the previous slab's foot at c=COLS.
  // Ideally sample[0]_worldFoot === anchorX. If _l4SineAtZ returns center X
  // and flat baked pivot.x = center + halfX*side, then foot-X = pivot.x (the
  // offset). So we want sample[0] adjustment so that pivotX_new + sample[0]*side == anchorX.
  // Easier: store raw centers, let caller set pivot.x = sample[0]*base + halfX*side
  // and pin remaining columns as deltas relative to sample[0].
  //
  // For Push 1 (visual-only): apply X deltas as local-space offsets to inner-face
  // verts. Baseline: delta[c] = sampleCenters[c] - sampleCenters[0].
  // Anchor-lock is implicit: at c=0 delta=0, so near-edge is untouched — it sits
  // wherever pivot.x already put it (which should equal previous slab's far edge
  // IF pivot.x uses L4 sine). We'll set pivot.x below.
  const deltas = new Array(COLS + 1);
  for (let c = 0; c <= COLS; c++) deltas[c] = sampleCenters[c] - sampleCenters[0];

  // Apply deltas to inner-face triangles. Inner face vertices in position buffer:
  // for r in 0..ROWS-1, c in 0..COLS-1, each quad = 2 triangles = 6 verts.
  // Triangle pattern in _buildCanyonSlabGeo:
  //   tri A: (r,c), (r+1,c), (r,c+1)      → cols: c, c, c+1
  //   tri B: (r,c+1), (r+1,c), (r+1,c+1)  → cols: c+1, c, c+1
  // That's 6 verts per quad, column pattern: [c, c, c+1, c+1, c, c+1]
  // Inner face is the FIRST block in the position array — ROWS*COLS quads = 6*5=30 quads = 180 vertex-positions.
  const ROWS = T.rows;
  const innerVertCount = ROWS * COLS * 6;
  const colPattern = [0, 0, 1, 1, 0, 1]; // column offset within quad, per-vertex
  const arr = posAttr.array;
  // Inner-face X values are in arr[0], arr[3], arr[6], ...
  // (x, y, z) every 3 floats. For inner face only (first innerVertCount*3 floats).
  //
  // CRITICAL: recycle bakes run EVERY time a slab cycles to the back. Without caching
  // the original flat X values, each bake accumulates deltas on top of the previous
  // bake — slabs drift further from their intended shape on every recycle. Fix:
  // cache the flat inner-face X array in userData on first bake, restore from it
  // before applying the new delta set.
  if (!mesh.userData._flatInnerX) {
    const flat = new Float32Array(innerVertCount);
    for (let i = 0; i < innerVertCount; i++) flat[i] = arr[i * 3];
    mesh.userData._flatInnerX = flat;
  }
  const flatX = mesh.userData._flatInnerX;
  // CRITICAL: deltas are in WORLD-X, but mesh has scale.x = side (for left wall,
  // scale.x = -1 flips X). Applying delta to local-X on a mirrored mesh means
  // the world effect is delta*side. We want world-X shift of `delta`, so local-X
  // shift = delta*side.
  let v = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (let k = 0; k < 6; k++) {
        const cc = c + colPattern[k]; // 0..COLS
        const worldDelta = deltas[cc];
        const localDelta = worldDelta * side;
        // Restore flat baseline + apply current delta (replaces prior bake)
        arr[v * 3] = flatX[v] + localDelta;
        v++;
      }
    }
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();

  // Return far-edge world X for next slab's anchor. Far edge sits at slabZ+W.
  return sampleCenters[COLS];
}
// =========================================================================

function _buildCanyonSlabGeo(seed, thickOverride, snapOverride) {
  // Thick rectangular block: flat back face, angular inner face, profile-shaped cross-section.
  // Inner face verts get independent X jitter + quantized snap → flat crystalline facets.
  // Non-indexed triangle soup → computeVertexNormals gives true flat normals per face.
  const T = _canyonTuner;
  let s = (seed|0) || 1;
  const rng = () => { s=(s*9301+49297)%233280; return s/233280; };

  const H     = T.slabH;
  const W     = T.slabW;
  const THICK = (thickOverride !== undefined) ? thickOverride : T.slabThick;
  const COLS  = T.cols;
  const ROWS  = T.rows;
  const DISP  = T.disp;
  // snapOverride lets a caller (e.g. entrance bake on the snap-locked L3 knife
  // variant where T.snap=0.1) build a single slab with a different snap value.
  // Without this, T.snap=0.1 would round every inner-face row X to multiples of
  // 10, collapsing the 7-row profile into ~3 visible horizontal cliff bands —
  // very obvious on the 700-thick entrance slab. Regular slabs still use T.snap.
  const SNAP  = (snapOverride !== undefined) ? snapOverride : T.snap;

  function profileX(v) {
    if(v < 0.15) return T.footX  + v/0.15*(T.sweepX - T.footX);
    if(v < 0.45) return T.sweepX + (v-0.15)/0.30*(T.midX - T.sweepX);
    if(v < 0.85) return T.midX   + (v-0.45)/0.40*(T.crestX - T.midX);
    return T.crestX;
  }

  const innerX=[],innerY=[],innerZ=[];
  for(let r=0;r<=ROWS;r++){
    for(let c=0;c<=COLS;c++){
      const v=r/ROWS;
      const base=profileX(v);
      let x=base+(rng()-0.5)*2.0*DISP;
      if(v>0.8) x+=(rng()-0.4)*DISP*(v-0.8)/0.2*2.0;
      x=Math.round(x*SNAP)/SNAP;
      const y=v*H+(v>0.85?(rng()-0.4)*H*0.18:0);
      innerX.push(x);
      innerY.push(Math.round(y*1.5)/1.5);
      innerZ.push(c/COLS*W);
    }
  }
  const idxf=(r,c)=>r*(COLS+1)+c;
  const pos=[],uvs=[];
  function tri(ax,ay,az,bx,by,bz,cx,cy,cz,u0,v0,u1,v1,u2,v2){
    pos.push(ax,ay,az,bx,by,bz,cx,cy,cz);
    uvs.push(u0,v0,u1,v1,u2,v2);
  }
  // Inner face
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const i00=idxf(r,c),i10=idxf(r,c+1),i01=idxf(r+1,c),i11=idxf(r+1,c+1);
    const u0=c/COLS,u1=(c+1)/COLS,v0=r/ROWS,v1=(r+1)/ROWS;
    tri(innerX[i00],innerY[i00],innerZ[i00],innerX[i01],innerY[i01],innerZ[i01],innerX[i10],innerY[i10],innerZ[i10],u0,v0,u0,v1,u1,v0);
    tri(innerX[i10],innerY[i10],innerZ[i10],innerX[i01],innerY[i01],innerZ[i01],innerX[i11],innerY[i11],innerZ[i11],u1,v0,u0,v1,u1,v1);
  }
  // Back face
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const z0=c/COLS*W,z1=(c+1)/COLS*W,y0=r/ROWS*H,y1=(r+1)/ROWS*H;
    const u0=c/COLS,u1=(c+1)/COLS,v0=r/ROWS,v1=(r+1)/ROWS;
    tri(THICK,y0,z0,THICK,y0,z1,THICK,y1,z0,u0,v0,u1,v0,u0,v1);
    tri(THICK,y0,z1,THICK,y1,z1,THICK,y1,z0,u1,v0,u1,v1,u0,v1);
  }
  // Bottom
  for(let c=0;c<COLS;c++){
    const z0=c/COLS*W,z1=(c+1)/COLS*W,x0=innerX[idxf(0,c)],x1=innerX[idxf(0,c+1)];
    const u0=c/COLS,u1=(c+1)/COLS;
    tri(x0,0,z0,THICK,0,z0,x1,0,z1,u0,0,u0,0,u1,0);
    tri(THICK,0,z0,THICK,0,z1,x1,0,z1,u0,0,u1,0,u1,0);
  }
  // Top crest
  for(let c=0;c<COLS;c++){
    const z0=c/COLS*W,z1=(c+1)/COLS*W;
    const x0i=idxf(ROWS,c),x1i=idxf(ROWS,c+1);
    const x0=innerX[x0i],y0=innerY[x0i],x1=innerX[x1i],y1=innerY[x1i];
    const backY=H*(0.92+rng()*0.08);
    const u0=c/COLS,u1=(c+1)/COLS;
    tri(x0,y0,z0,x1,y1,z1,THICK,backY,z0,u0,1,u1,1,u0,0.8);
    tri(x1,y1,z1,THICK,backY,z1,THICK,backY,z0,u1,1,u1,0.8,u0,0.8);
  }
  // Near cap
  for(let r=0;r<ROWS;r++){
    const y0=innerY[idxf(r,0)],y1=innerY[idxf(r+1,0)],ix0=innerX[idxf(r,0)],ix1=innerX[idxf(r+1,0)];
    const v0=r/ROWS,v1=(r+1)/ROWS;
    tri(ix0,y0,0,THICK,y0,0,ix1,y1,0,0,v0,1,v0,0,v1);
    tri(THICK,y0,0,THICK,y1,0,ix1,y1,0,1,v0,1,v1,0,v1);
  }
  // Far cap
  for(let r=0;r<ROWS;r++){
    const y0=innerY[idxf(r,COLS)],y1=innerY[idxf(r+1,COLS)],ix0=innerX[idxf(r,COLS)],ix1=innerX[idxf(r+1,COLS)];
    const v0=r/ROWS,v1=(r+1)/ROWS;
    tri(THICK,y0,W,ix0,y0,W,THICK,y1,W,1,v0,0,v0,1,v1);
    tri(ix0,y0,W,ix1,y1,W,THICK,y1,W,0,v0,0,v1,1,v1);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));
  geo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(uvs),2));
  geo.computeVertexNormals();
  return geo;
}

function _createCanyonWalls() {
  if (_canyonWalls) return;
  _canyonDbgFrame = 0; _canyonDbgLastNearestRot = null; _canyonDbgStartTime = null;
  const T = _canyonTuner;
  // Defensive clamp: canyons must never have more than 1 entry slab. Some
  // legacy presets (e.g. the K-hotkey "knife arches" debug preset) write
  // entranceSlabs:3, which produces a stack of thick slabs at the canyon
  // mouth that visually blocks the entry. Cap it here at the source so no
  // preset can ever request more than 1, regardless of which start path
  // populated the tuner.
  if (T.entranceSlabs > 1) {
    console.warn('[CANYON] entranceSlabs ' + T.entranceSlabs + ' > 1, clamping to 1');
    T.entranceSlabs = 1;
  }

  // Two slab types: cyan (MeshPhysical + holo overlay) and dark (MeshStandard + veins)
  // Use pre-warmed cache if available (built at JL start to avoid first-spawn stutter)
  const cyanTex = _canyonTexCache ? _canyonTexCache.cyanTex : _makeCanyonCyanTex(1);
  const darkTex = _canyonTexCache ? _canyonTexCache.darkTex : _makeCanyonDarkTex(2);

  const cyanMat = new THREE.MeshPhysicalMaterial({
    color:              new THREE.Color(0x04d4f0),
    metalness:          0.0,
    roughness:          T.cyanRgh,
    ior:                1.22,
    reflectivity:       0.55,
    clearcoat:          0.65,
    clearcoatRoughness: 0.22,
    emissive:           new THREE.Color(0x6ef2ff),
    emissiveMap:        cyanTex,
    emissiveIntensity:  T.cyanEmi,
    transparent:        false,
    flatShading:        true,
    side:               THREE.DoubleSide,
  });

  const darkMat = new THREE.MeshPhysicalMaterial({
    color:              new THREE.Color(0x080810),
    roughness:          T.darkRgh,
    metalness:          0.0,
    clearcoat:          T.darkClearcoat,
    clearcoatRoughness: 0.08,
    reflectivity:       0.7,
    emissive:           new THREE.Color(0xff00cc),
    emissiveMap:        darkTex,
    emissiveIntensity:  T.darkEmi,
    transparent:        false,
    flatShading:        false,
    side:               THREE.DoubleSide,
  });

  // Holographic grid overlay REMOVED for perf (was doubling draw calls on cyan slabs).
  // Post-processing _holoPass (screen-space) is separate and still active.

  // Canyon-scoped lights — original cyan rig at full intensity.
  // Smoothed in/out via _canyonLightT in _updateCanyonWalls (600ms ease)
  // so transitions are imperceptible. Light-count hash unchanged — no
  // recompile hitch. Start at 0; ramp will drive up over ~600ms.
  // Note: do NOT reset _canyonLightT here — if a previous canyon was still
  // ramping out, preserve its current value so we ease forward smoothly
  // instead of snap-restarting at 0.
  _CANYON_PERSISTENT_LIGHTS.forEach((l) => {
    l.intensity = 0;
  });
  const canyonLight = { lights: _CANYON_PERSISTENT_LIGHTS };

  const SPACING  = T.slabW;
  // FOOT_OFF: the foot vertex sits at local X = footX.
  // To place foot at world X = center + halfX*side, group.x = center + halfX*side - footX*side.
  // So store footX directly; subtract it (times side) when baking position.
  const FOOT_OFF = T.footX; // signed — subtracted below, not added

  function makeSlab(side, seed, zPos, idx, thickOverride) {
    const isEntrance = (thickOverride !== undefined);
    // Parity must match the recycle path (line ~8213) which uses posIdx from Z,
    // NOT the init-loop index `idx`. Otherwise a slab baked cyan at idx=4 lands
    // at a Z whose posIdx is odd, gets flipped to dark on first recycle, and
    // alternation drifts (looks like it 'goes all cyan' partway through).
    const posIdx = Math.round(-zPos / SPACING);
    const isCyan = T._allCyan ? true : T._allDark ? false : (posIdx % 2 === 0);
    // Entrance gate on the snap-locked L3 knife variant (T.snap=0.1) gets a
    // higher snap floor — otherwise the 700-thick entrance face quantizes into
    // 3 stair-step bands and reads as off-center. Regular slabs keep T.snap so
    // the locked-jagged corridor look is preserved. Threshold 0.5: anything
    // tighter than 0.5 collapses the profile too aggressively for entrance.
    const _entSnap   = (isEntrance && T.snap < 0.5) ? 1.5 : undefined;
    const geo        = _buildCanyonSlabGeo(seed, thickOverride, _entSnap);

    // Pivot group — sits at the inner foot edge of the corridor.
    // Rotating the group around Y pivots the slab face inward/outward correctly.
    const pivot = new THREE.Group();
    pivot.position.z = zPos;
    pivot.frustumCulled = false;
    scene.add(pivot);

    // Mesh is offset so its foot (local x=footX) sits at the pivot origin (x=0)
    // For right wall (side=1): mesh.position.x = -footX  (foot at 0, back wall at THICK-footX)
    // For left wall (side=-1): scale.x=-1 mirrors geometry, same offset
    const mesh = new THREE.Mesh(geo, isCyan ? cyanMat : darkMat);
    mesh.scale.x      = side;
    mesh.position.x   = -FOOT_OFF * side; // offset so foot sits at pivot origin
    mesh.frustumCulled = false;
    pivot.add(mesh);

    pivot.userData.isEntrance = isEntrance;
    return pivot; // callers use the pivot for position/rotation
  }

  const INIT_Z  = T.spawnDepth || -400;
  const SAFE_Z  = -150; // no slab spawns closer than this on init
  // Init sinePhase so sin=0 exactly when ship hits the first regular slab — no jut
  const _firstRegularZ = SAFE_Z - (T.entranceSlabs - 1) * SPACING - SPACING;
  const rowsToFirst = Math.round((3.9 - _firstRegularZ) / SPACING);
  _canyonSinePhase = -(rowsToFirst * (2 * Math.PI / T.sinePeriod) * T.sineSpeed);
  // Only create slabs that fit between INIT_Z and SAFE_Z — recycle handles the rest
  const initCount = Math.max(1, Math.floor((SAFE_Z - INIT_Z) / SPACING));
  // Full pool size covers the whole visible range for recycling
  const autoPool  = Math.ceil((DESPAWN_Z - INIT_Z) / SPACING) + 2 + T.entranceSlabs;

  const chunks = { left: [], right: [] };
  ['left','right'].forEach(k => {
    const side = k === 'left' ? -1 : 1;
    for (let i = 0; i < autoPool; i++) {
      const seed = i * 7 + (k === 'right' ? 100 : 0);
      const isEntrance = i < T.entranceSlabs;
      const thick = isEntrance ? T.entranceThick : undefined;
      // Entrance slabs spawn at SAFE_Z (close to ship) so they appear as the canyon gate
      // Regular slabs fill INIT_Z → SAFE_Z; overflow parks behind INIT_Z
      // entranceEnd: Z of last entrance slab; regular + overflow continue from here
      const entranceEnd    = SAFE_Z - (T.entranceSlabs - 1) * SPACING;
      const lastRegularZ   = entranceEnd - (initCount - T.entranceSlabs) * SPACING;
      // ENTRANCE spawns far out at -500 (scrolls in from distance).
      // Final resting pattern (where it would have been at spawn pre-change): -150/-170/-190.
      // Regular slabs unchanged (near spawn, hidden until entrance arrives).
      const ENTRANCE_SPAWN_Z = -500;
      const initZ = isEntrance
        ? ENTRANCE_SPAWN_Z - i * SPACING                             // entrance far: -500/-520/-540
        : i < initCount
          ? entranceEnd - (i - T.entranceSlabs + 1) * SPACING        // regular: same as today
          : lastRegularZ - (i - initCount + 1) * SPACING;            // overflow: same as today
      const slab = makeSlab(side, seed, initZ, i, thick);
      // Regular slabs hidden at init — revealed when entrance reaches corridor front zone.
      // Entrance visible immediately (it's the thing emerging from distance).
      if (!isEntrance) slab.visible = false;
      chunks[k].push(slab);
    }
  });

  // Bake X at init: entrance slabs stay flush with corridor (same halfX as regular)
  // Their thickness already pushes them outward visually
  ['left','right'].forEach(k => {
    const side = k === 'left' ? -1 : 1;
    chunks[k].forEach((pivot) => {
      // Entrance: X frozen at FINAL resting Z (-150/-170/-190), not spawn Z (-500/-520/-540).
      // This way the gate visually sits where it would end up, flying at the ship as a stable shape.
      if (pivot.userData.isEntrance) {
        // Entrance-only pad: mouth is 10u wider each side than corridor proper.
        // Only applied at INIT — recycled entrance slabs (line ~8030) snap back
        // to halfXOverride so the corridor behind doesn't inherit extra width.
        const ENTRANCE_PAD = 10;
        // Mode 5 entrance matches the near-end (start Z) squeeze value.
        const _baseHalf = (_canyonMode === 5) ? _canyonHalfXAtZ(SAFE_Z) : (T.halfXOverride || 34);
        const halfX    = _baseHalf + ENTRANCE_PAD;
        // Find this entrance slab's index by its Z offset from ENTRANCE_SPAWN_Z=-500
        const entIdx   = Math.round((-500 - pivot.position.z) / SPACING); // 0,1,2
        const finalZ   = SAFE_Z - entIdx * SPACING;                       // -150,-170,-190
        // L4-recreation canyons (e.g. L3 knife) use _l4SineAtZ for the regular
        // slab center curve. The entrance MUST use the same curve or it lands
        // ~9-10u off from the corridor opening (entrance built off _canyonXAtZ
        // anchored to z=-170 produces non-zero sine at z=-150 while _l4SineAtZ
        // is ~0 there). Match whichever curve the regulars are on.
        const center   = _canyonTuner._l4Recreation ? _l4SineAtZ(finalZ) : _canyonXAtZ(finalZ);
        pivot.userData.bakedX    = center + halfX * side;
        pivot.userData.entFinalZ = finalZ; // for trigger check later
        pivot.position.x = pivot.userData.bakedX;
        pivot.rotation.y = 0;
      } else {
        const initZ      = pivot.position.z;
        // L4-recreation: override center math with L4 sine. Keep rotation at 0
        // (bending replaces rotation) and let the bake function bend inner face.
        const useL4 = _canyonTuner._l4Recreation;
        const center     = useL4 ? _l4SineAtZ(initZ)             : _canyonXAtZ(initZ);
        const centerNext = useL4 ? _l4SineAtZ(initZ - SPACING)   : _canyonXAtZ(initZ - SPACING);
        const halfX      = (_canyonMode === 5) ? _canyonHalfXAtZ(initZ) : _canyonPredictHalfX(0);
        // Init rotation: _canyonXAtZ is correct here — each slab is at a unique Z
        // so the stateless sine naturally gives the right angle per slab.
        // (predictCenter is wrong at init — it's near phase=0 so all deltas are equal)
        const angle = useL4 ? 0 : side * Math.atan2(centerNext - center, SPACING);
        pivot.userData.bakedX = center + halfX * side;
        pivot.position.x = pivot.userData.bakedX;
        pivot.rotation.y = angle;
        if (useL4) _bakeSlabCurveForL4(pivot, initZ, side, null);
      }
    });
  });

  // ==== SPAWN DUMP: where every slab actually starts on the Z axis ====
  // Camera far clip ~600, camera at z=9, so slabs past z=-591 are frustum-culled.
  const _leftSorted = [...chunks.left].sort((a,b) => b.position.z - a.position.z);
  const _ent = _leftSorted.filter(p => p.userData.isEntrance);
  const _reg = _leftSorted.filter(p => !p.userData.isEntrance);
  _ent.forEach((p, i) => {
  });
  _reg.forEach((p, i) => {
    const beyondFarClip = p.position.z < -591;
  });
  if (_reg.length > 0) {
    const zMax = _reg[0].position.z;
    const zMin = _reg[_reg.length-1].position.z;
  }

  _canyonWalls = {
    strips:       [...chunks.left, ...chunks.right],
    left:         chunks.left,
    right:        chunks.right,
    cyanMat, darkMat,
    cyanTex, darkTex,
    canyonLight,
    _spacing:     SPACING,
    _footOff:     FOOT_OFF,
    _corridorRevealed: false, // flips true when entrance reaches trigger Z
  };

  // ==== GPU PREWARM: compile shaders + upload geometry for ALL pool slabs ====
  // Without this, reveal frame stalls while GPU uploads 30+ slab geometries
  // and compiles MeshPhysicalMaterial + holo shaders. Proxy scene pattern
  // (same as asteroid _preWarmAsteroidShaders at line ~20743) does this
  // invisibly — never renders to main canvas.
  try {
    const _warmScene = new THREE.Scene();
    const _warmCam   = new THREE.PerspectiveCamera();
    // Compile materials (shaders) once per unique material
    // Dedupe on geometry (each slab has unique geo via seed).
    // Materials are shared (cyanMat, darkMat, holoMat) — they'll compile once
    // on the first proxy that uses each, subsequent proxies reuse compiled shaders.
    const _seenGeos = new Set();
    const _addProxy = (mesh) => {
      if (!mesh || !mesh.material || !mesh.geometry) return;
      if (_seenGeos.has(mesh.geometry)) return;
      _seenGeos.add(mesh.geometry);
      const proxy = new THREE.Mesh(mesh.geometry, mesh.material);
      _warmScene.add(proxy);
    };
    // Walk every pool mesh so every unique (material, geometry) pair gets uploaded
    for (const pivot of _canyonWalls.strips) {
      for (const child of pivot.children) {
        _addProxy(child);
        // Holo overlay is child of base mesh, walk one level deeper
        for (const grand of child.children) _addProxy(grand);
      }
    }
    renderer.compile(_warmScene, _warmCam);
    if (window._perfDiag) window._perfDiag.tag('canyon_prewarm', _seenGeos.size+'geos');
    // Don't dispose proxy geometries — they reference real slab geometries still in use
    // _warmScene goes out of scope, proxy meshes GC naturally
  } catch(e) {
    console.warn('[CANYON PREWARM] failed:', e.message);
  }
}

function _destroyCanyonWalls() {
  if (!_canyonWalls) return;
  _canyonSinePhase = 0;
  _l4RowsElapsed    = 0;
  _canyonExiting    = false;
  // strips are pivot Groups — remove group from scene, dispose child mesh geometry
  _canyonWalls.strips.forEach(pivot => {
    scene.remove(pivot);
    pivot.children.forEach(child => { if (child.geometry) child.geometry.dispose(); });
  });
  ['cyanMat','darkMat'].forEach(k => { if(_canyonWalls[k]) _canyonWalls[k].dispose(); });
  ['cyanTex','darkTex'].forEach(k => { if(_canyonWalls[k]) _canyonWalls[k].dispose(); });
  // Canyon lights: don't remove from scene (would trigger light-hash change →
  // recompile wave). Just zero their intensity so they contribute nothing.
  if (_canyonWalls.canyonLight && _canyonWalls.canyonLight.lights) {
    _canyonWalls.canyonLight.lights.forEach(l => { l.intensity = 0; });
  }
  _canyonWalls = null;
  // Same rule as canyonLight above: don't remove from scene (would trigger
  // light-hash change → recompile wave → intermittent "ship light didn't turn
  // on" + 90ms freezes after canyon exit). Zero intensity to disable.
  if (_canyonFillLight) {
    if (_canyonFillLight.lights) _canyonFillLight.lights.forEach(l => { l.intensity = 0; });
    else _canyonFillLight.intensity = 0;
    _canyonFillLight = null;
  }
}

// Z-based intensity ramp — C2 ONLY. Each slab bakes its X ONCE at its bake-time
// Z using the intensity value for that Z. bakedX is then frozen and the slab
// only scrolls in Z, so walls never drift laterally during their visible life.
// First curve is gentle (I=0.15 at entrance), full dramatic swing kicks in by
// z=-500. Result: easy entry, stable walls, dramatic curves deeper.
function _canyonIntensityAtZ(worldZ) {
  const T = _canyonTuner;
  // Mode 5 EXPERIMENTAL: preset-driven ramp via sineStartI/sineStartZ/sineFullZ.
  // Missing fields → flat sineIntensity. Can ramp up OR down (startI can be higher than target).
  if (_canyonMode === 5) {
    if (T.sineStartI === undefined) return T.sineIntensity;
    const SZ = (T.sineStartZ !== undefined) ? T.sineStartZ : -150;
    const FZ = (T.sineFullZ  !== undefined) ? T.sineFullZ  : -500;
    const denom = (FZ - SZ) || 1;
    const t = Math.min(1, Math.max(0, (worldZ - SZ) / denom));
    return T.sineStartI + (T.sineIntensity - T.sineStartI) * t;
  }
  // C2 legacy hardcoded ramp (unchanged).
  if (_canyonMode !== 2) return T.sineIntensity;
  const START_Z = -150, FULL_Z = -500;
  const START_I = 0.15;
  const t = Math.min(1, Math.max(0, (worldZ - START_Z) / (FULL_Z - START_Z)));
  return START_I + (T.sineIntensity - START_I) * t;
}

// EXPERIMENTAL (mode 5) — halfX tapers along Z via preset fields.
// Missing halfXStart/halfXFull → flat halfXOverride. 5u minimum floor prevents wall cross-over.
function _canyonHalfXAtZ(worldZ) {
  const T = _canyonTuner;
  if (_canyonMode !== 5) return T.halfXOverride;
  if (T.halfXStart === undefined || T.halfXFull === undefined) return T.halfXOverride;
  const SZ = (T.halfXStartZ !== undefined) ? T.halfXStartZ : -150;
  const FZ = (T.halfXFullZ  !== undefined) ? T.halfXFullZ  : -500;
  const denom = (FZ - SZ) || 1;
  const t = Math.min(1, Math.max(0, (worldZ - SZ) / denom));
  return Math.max(5, T.halfXStart + (T.halfXFull - T.halfXStart) * t);
}
function _canyonPredictCenter(rowsAhead) {
  const T = _canyonTuner;
  const base = state.corridorGapCenter || 0;
  if (T.sineIntensity <= 0) return base;
  const phase = _canyonSinePhase + rowsAhead * (2 * Math.PI / T.sinePeriod) * T.sineSpeed;
  // Convert rowsAhead back to worldZ for intensity lookup (row 0 = ship Z=3.9)
  const SPACING = (_canyonWalls && _canyonWalls._spacing) || 20;
  const approxZ = 3.9 - rowsAhead * SPACING;
  const I = _canyonIntensityAtZ(approxZ);
  return base + T.sineAmp * I * Math.sin(phase);
}
function _canyonPredictHalfX(rowsAhead) {
  return _canyonTuner.halfXOverride;
}
function _canyonXAtZ(worldZ) {
  const T = _canyonTuner;
  const base = state.corridorGapCenter || 0;
  if (T.sineIntensity <= 0) return base;
  // Phase reference at entrance Z so sin(phase)=0 at the mouth.
  const ENTRANCE_REF_Z = -150;
  const phase = ((worldZ - ENTRANCE_REF_Z) / T.sinePeriod) * (2 * Math.PI) * T.sineSpeed;
  // Z-based intensity (C2 only) — gentler first curve, baked once per slab's Z.
  const I = _canyonIntensityAtZ(worldZ);
  return base + T.sineAmp * I * Math.sin(phase);
}

// Set DEBUG_CANYON=true to re-enable per-2s canyon diagnostics (CANYON SNAP,
// COVERAGE, NEAREST, NEAR LEFT/RIGHT). Off in production to avoid GC-jank from
// per-frame string allocs while a canyon is active.
const DEBUG_CANYON = false;
let _canyonDbgFrame = 0;
let _canyonDbgLastNearestRot = null;
let _canyonDbgStartTime = null;

function _debugCanyonNearShip() {
  const shipZ = 3.9;
  const spacing = _canyonWalls._spacing;
  ['left','right'].forEach(k => {
    const slabs = _canyonWalls[k];
    const sorted = slabs
      .filter(m => !m.userData.isEntrance)
      .map(m => ({ m, dz: Math.abs(m.position.z - shipZ), z: m.position.z }))
      .sort((a,b) => a.dz - b.dz)
      .slice(0, 5);
    const entries = sorted.map((s,idx) => {
      const z = s.z;
      const centerHere = _canyonXAtZ(z);
      const centerNext = _canyonXAtZ(z + spacing);
      const dx = centerNext - centerHere;
      const yawPredDeg  = Math.atan2(dx, spacing) * 180 / Math.PI;
      const yawBakedDeg = s.m.rotation.y * 180 / Math.PI;
      const src = s.m.userData.bakedAtZ ? 'R' : 'I';
      return `i${idx}[${src}] z=${z.toFixed(1)} yawPred=${yawPredDeg.toFixed(1)} yawBaked=${yawBakedDeg.toFixed(1)} dx=${dx.toFixed(2)}`;
    });
  });
}

function _updateCanyonWalls(dt, speed) {
  if (!_canyonWalls || (!_canyonActive && !_canyonExiting)) return;

  // ── Canyon transition ramp — 600ms smoothstep ease on every enter/exit.
  // Drives both: (1) the 4 cyan canyon fill-lights, (2) optional dirLight
  // modulation during L3-knife/Pre-T4A/Pre-T4B (via _setCanyonDirLightTarget).
  // Light count never changes so no shader recompile.
  const _ltTarget = _canyonActive ? 1 : 0;
  const _ltStep = dt / _CANYON_LIGHT_RAMP_S;
  if (_canyonLightT < _ltTarget) _canyonLightT = Math.min(_ltTarget, _canyonLightT + _ltStep);
  else if (_canyonLightT > _ltTarget) _canyonLightT = Math.max(_ltTarget, _canyonLightT - _ltStep);
  // smoothstep ease for an imperceptible perceived blend
  const e = _canyonLightT * _canyonLightT * (3 - 2 * _canyonLightT);
  const fill = _CANYON_LIGHT_FILL * e;
  for (let _i = 0; _i < _CANYON_PERSISTENT_LIGHTS.length; _i++) {
    _CANYON_PERSISTENT_LIGHTS[_i].intensity = _CANYON_LIGHT_DEFS[_i].intensity * fill;
  }
  // dirLight ramp — only active for L3-knife/Pre-T4A/Pre-T4B (which call
  // _setCanyonDirLightTarget on entry). At t=0 we read From, at t=1 we hit Target.
  // When _canyonDirLightTarget is null but From is non-null, we're heading home.
  if (_canyonDirLightFrom !== null && typeof dirLight !== 'undefined' && dirLight) {
    const target = (_canyonDirLightTarget !== null) ? _canyonDirLightTarget : _canyonDirLightFrom;
    dirLight.intensity = _canyonDirLightFrom + (target - _canyonDirLightFrom) * e;
    // Once fully eased home and target was cleared, drop the saved From.
    if (_canyonDirLightTarget === null && _canyonLightT <= 0.001) {
      dirLight.intensity = _canyonDirLightFrom;
      _canyonDirLightFrom = null;
    }
  }

  _canyonDbgFrame++;
  if (_canyonDbgStartTime === null) _canyonDbgStartTime = performance.now();
  const _canyonElapsed = ((performance.now() - _canyonDbgStartTime) / 1000).toFixed(1);

  if (DEBUG_CANYON && _canyonDbgFrame % 120 === 0) {
    const spacing2 = _canyonWalls._spacing;
    // Global snapshot

    // Coverage check
    const allZ = _canyonWalls.left.concat(_canyonWalls.right)
      .filter(m => m.visible).map(m => m.position.z).sort((a,b)=>a-b);
    const minZ = allZ.length ? allZ[0].toFixed(1) : '?';
    const maxZ = allZ.length ? allZ[allZ.length-1].toFixed(1) : '?';

    // Nearest slab detail
    let nearestM = null, nearestDist = Infinity;
    for (const m of _canyonWalls.left) {
      if (m.userData.isEntrance) continue;
      const d = Math.abs(m.position.z);
      if (d < nearestDist) { nearestDist = d; nearestM = m; }
    }
    if (nearestM) {
      const nearRot    = (nearestM.rotation.y * 180 / Math.PI).toFixed(2);
      const nearZ2     = nearestM.position.z.toFixed(1);
      const nearBaked  = (nearestM.userData.bakedAtZ || 0).toFixed(1);
      const nearBRot   = ((nearestM.userData.bakedRot || 0) * 180 / Math.PI).toFixed(2);
      const dx2        = _canyonXAtZ(nearestM.position.z + spacing2) - _canyonXAtZ(nearestM.position.z);
      const correctRot = (Math.atan2(dx2, spacing2) * 180 / Math.PI).toFixed(2);
      const src        = nearestM.userData.bakedAtZ ? 'RECYCLED' : 'INIT';
      if (_canyonDbgLastNearestRot !== null) {
        const delta = Math.abs(parseFloat(nearRot) - _canyonDbgLastNearestRot);
      }
      _canyonDbgLastNearestRot = parseFloat(nearRot);
    }

    // Near-ship detail for 5 closest slabs
    _debugCanyonNearShip();
  }
  const T   = _canyonTuner;
  const spd = (speed && speed > 1) ? speed : BASE_SPEED;
  const scroll  = spd * dt * T.scrollSpeed;
  const spacing = _canyonWalls._spacing;
  // Advance canyon sine phase proportional to world scroll.
  // Paused until corridor reveal — keeps init-baked X values consistent with
  // the phase the recycle path will see on frame 1 of corridor motion.
  if (T.sineIntensity > 0 && _canyonWalls._corridorRevealed) {
    _canyonSinePhase += (scroll / T.sinePeriod) * (2 * Math.PI) * T.sineSpeed;
  }
  // L4-recreation: advance global L4-row accumulator so the corridor walks through
  // L4's shape over time. Same gating as _canyonSinePhase — only after corridor reveal.
  // scroll units (world Z per frame) / ROW_GAP_Z (7) = L4 rows per frame, × compress scalar.
  if (T._l4Recreation && _canyonWalls._corridorRevealed) {
    _l4RowsElapsed += (scroll / _L4_CONST.ROW_GAP_Z) * (T._l4RampCompress || 1.0);
  }

  // ── Corridor reveal: when nearest entrance slab reaches Z=-210 (front of corridor),
  //    unhide all regular slabs. Before this, regular slabs are frozen in place + invisible.
  //    After, they scroll/recycle normally. One-shot.
  if (!_canyonWalls._corridorRevealed && !_canyonExiting) {
    let nearestEntZ = -Infinity;
    for (const m of _canyonWalls.left) {
      if (m.userData.isEntrance && m.visible && m.position.z > nearestEntZ) nearestEntZ = m.position.z;
    }
    if (nearestEntZ >= -210) {
      _canyonWalls._corridorRevealed = true;
      _canyonWalls.left.forEach(m => { if (!m.userData.isEntrance) m.visible = true; });
      _canyonWalls.right.forEach(m => { if (!m.userData.isEntrance) m.visible = true; });
      if (window._perfDiag) window._perfDiag.tag('canyon_reveal');
    }
  }

  // ── Baked-X corridor tracking ───────────────────────────────────────────
  // Each slab gets its X baked at spawn/recycle time from corridorGapCenter
  // and _lastHalfX at that exact moment — the same values the corridor cones
  // at that Z receive. position.x never changes until the next recycle.
  // This is why the cones form a curved path: each one carries its own baked X.

  const footOff = _canyonWalls._footOff || 0;

  // PERF: was nested forEach with array literal ['left','right'] allocated every
  // frame plus closure-per-mesh allocations (~40/frame during active canyon).
  // Converted to plain for-loops with hoisted side constants — zero allocations,
  // zero closures. Behavior identical: same iteration order, same early-exit
  // semantics (forEach `return` → `continue`).
  for (let _kIdx = 0; _kIdx < 2; _kIdx++) {
    const k = _kIdx === 0 ? 'left' : 'right';
    const side = _kIdx === 0 ? -1 : 1;
    const meshes = _canyonWalls[k];
    const meshCount = meshes.length;

    for (let _mIdx = 0; _mIdx < meshCount; _mIdx++) {
      const m = meshes[_mIdx];
      // Freeze regular slabs at their init Z until entrance arrives and reveal fires.
      // Entrance scrolls normally. This keeps the corridor exactly where today's baseline
      // places it (Z=-210 to -490) at the moment of reveal, so corridor math is identical.
      if (!m.userData.isEntrance && !_canyonWalls._corridorRevealed) continue;

      m.position.z += scroll;

      // ── Distance fade-in: keep slabs emissive-dark deep in fog, ramp up close ──
      // Extended fade range so emissive stays 0 through the full fog zone.
      // Emissive bypasses scene fog in Three.js; keeping emissive low until the
      // slab is close lets exponential fog fully hide the silhouette during
      // sine-wave curves where slabs would otherwise emerge visibly.
      if (m.children[0]) {
        const fadeStart = T.spawnDepth || -250;
        const fadeEnd   = -80;  // was -150; tighter fade-in keeps distant slabs fogged out
        const fadeT     = Math.min(1, Math.max(0, (m.position.z - fadeStart) / (fadeEnd - fadeStart)));
        const mat = m.children[0].material;
        if (mat.emissiveIntensity !== undefined) {
          const baseEmi = mat.color && mat.color.r > 0.5 ? T.cyanEmi : T.darkEmi;
          mat.emissiveIntensity = baseEmi * fadeT;
        }
      }

      // ── EXITING: slabs drift forward, no recycle, hide when past despawn ──
      if (_canyonExiting) {
        if (m.position.z > DESPAWN_Z + spacing) m.visible = false;
        continue;
      }

      // Entrance slabs: scroll through once then hide — never recycle into corridor
      if (m.userData.isEntrance && m.position.z > DESPAWN_Z + spacing) {
        m.visible = false;
        continue;
      }

      // Recycle: slab passed ship → send to back of queue and bake new X
      if (m.position.z > DESPAWN_Z + spacing) {
        // Find minimum Z in this side's pool (excluding self) and place just behind it
        let minZ = Infinity;
        for (const om of meshes) if (om !== m && !om.userData.isEntrance && om.position.z < minZ) minZ = om.position.z;
        const snappedMin = Math.round(minZ / spacing) * spacing;
        const slabZ = snappedMin - spacing;

        const rowsAhead  = Math.max(0, Math.round((3.9 - slabZ) / spacing));
        const center     = _canyonPredictCenter(rowsAhead);
        const centerNext = _canyonPredictCenter(rowsAhead + 1);
        const halfX      = (_canyonMode === 5) ? _canyonHalfXAtZ(slabZ) : _canyonPredictHalfX(rowsAhead);
        if (m.userData.isEntrance) {
          const eHalfX = (_canyonMode === 5) ? _canyonHalfXAtZ(slabZ) : (_canyonTuner.halfXOverride || 34);
          m.userData.bakedX = eHalfX * side;
          m.position.x = m.userData.bakedX;
          m.position.z = slabZ;
          m.rotation.y = 0;
        } else {
          // L4-recreation override: use L4 sine for centerline, bend inner face,
          // keep rotation at 0 (bending replaces yaw).
          const useL4      = _canyonTuner._l4Recreation;
          const l4Center   = useL4 ? _l4SineAtZ(slabZ) : center;
          m.userData.bakedX = l4Center + halfX * side;
          m.position.x = m.userData.bakedX;
          m.position.z = slabZ;
          m.rotation.y = useL4 ? 0 : side * Math.atan2(centerNext - center, spacing);
          // Reassign cyan/dark material based on positional idx — otherwise recycling
          // scrambles the alternation pattern that was baked at makeSlab time.
          if (m.children[0]) {
            const posIdx = Math.round(-slabZ / spacing);
            const wantCyan = T._allCyan ? true : T._allDark ? false : (posIdx % 2 === 0);
            const wantMat = wantCyan ? _canyonWalls.cyanMat : _canyonWalls.darkMat;
            if (window._canyonMatDbg) {
              const prev = m.children[0].material === _canyonWalls.cyanMat ? 'CYAN' : m.children[0].material === _canyonWalls.darkMat ? 'dark' : '?';
              const now  = wantCyan ? 'CYAN' : 'dark';
            }
            if (m.children[0].material !== wantMat) m.children[0].material = wantMat;
          }
          if (useL4) _bakeSlabCurveForL4(m, slabZ, side, null);
        }
        m.visible = true;
      } else {
        // Hold baked X — rotation frozen at bake time, only updates on recycle
        if (m.userData.bakedX !== undefined) m.position.x = m.userData.bakedX;
      }
    }
  }

  // Auto-destroy once all slabs have scrolled off during exit
  if (_canyonExiting && _canyonWalls) {
    const allGone = _canyonWalls.strips.every(m => !m.visible || m.position.z > DESPAWN_Z + spacing);
    if (allGone) _destroyCanyonWalls();
  }

  // Collision — per-slab bakedX inner-edge test against every visible slab near ship Z.
  // bakedX is the slab foot (inner edge of wall). For right wall (side=1) the wall
  // occupies world X >= bakedX; for left wall (side=-1), world X <= bakedX.
  // Test ALL slabs overlapping ship Z range — not just nearest — so angled/entrance
  // slabs that cross into ship's Z band are caught.
  if (_canyonActive && state.phase === 'playing' && !state._godMode && !_godMode) {
    const shipX = state.shipX || 0;
    const shipZ = 3.9;
    const shipHalfW = SHIP_HALF_WIDTH; // 1.2
    const shipHalfL = 1.0;             // ship Z half-length
    const shipMinZ = shipZ - shipHalfL, shipMaxZ = shipZ + shipHalfL;
    const shipMaxX = shipX + shipHalfW, shipMinX = shipX - shipHalfW;
    // 0.3u grace buffer — matches pre-Push-4 feel (ship can kiss wall without insta-die)
    const GRACE = 0.3;

    let hit = false;
    // Right wall: wall occupies X >= bakedX. Ship collides if shipMaxX >= bakedX - GRACE.
    for (const pivot of _canyonWalls.right) {
      if (!pivot.visible || pivot.userData.bakedX === undefined) continue;
      // Z overlap: slab Z range = [pivot.z, pivot.z + spacing]
      if (pivot.position.z + spacing < shipMinZ) continue;
      if (pivot.position.z > shipMaxZ) continue;
      if (shipMaxX >= pivot.userData.bakedX - GRACE) { hit = true; break; }
    }
    // Left wall: wall occupies X <= bakedX. Ship collides if shipMinX <= bakedX + GRACE.
    if (!hit) {
      for (const pivot of _canyonWalls.left) {
        if (!pivot.visible || pivot.userData.bakedX === undefined) continue;
        if (pivot.position.z + spacing < shipMinZ) continue;
        if (pivot.position.z > shipMaxZ) continue;
        if (shipMinX <= pivot.userData.bakedX + GRACE) { hit = true; break; }
      }
    }

    if (hit) {
      killPlayer();
      if (state.phase === 'playing') state.invincibleTimer = Math.max(state.invincibleTimer, 0.5);
    }
  }
}

// ═══════════════════════════════════════════════════
//  ANGLED WALL POOL (DR opening weave)
// ═══════════════════════════════════════════════════
const _awTuner = {
  wallW: 22,        // wall width
  wallH: 4,         // wall height
  angle: 35,        // rotation degrees around Y axis
  zSpacing: 50,     // z distance between rows (random angled walls only; structured uses burst mechanic)
  xOffset: 12,      // how far left/right center of wall sits from ship lane
  rows: 20,         // number of wall rows to spawn
  colorR: 0.0, colorG: 0.4, colorB: 1.0,  // neon tint
  emissive: 1.5,    // emissive intensity
  opacity: 1.0,     // wall opacity
  thickness: 0.3,   // visual thickness (extruded box depth)
  edgeGlow: 1.5,    // edge line glow intensity
  // Per-axis copies: how many walls per row in each direction
  copiesX: 6,       // copies along X (left-right)
  spacingX: 42,     // gap between X copies
  copiesY: 2,       // copies along Y (up-down / vertical stacking)
  spacingY: 6,      // gap between Y copies
  copiesZ: 2,       // copies along Z (depth / front-back per row)
  spacingZ: 5,      // gap between Z copies
  rotX: -36,        // extra rotation around X axis (degrees)
  rotY: 0,          // extra rotation around Y axis (degrees, added to angle)
  rotZ: 0,          // extra rotation around Z axis (degrees)
  fieldShift: -9.5, // shift entire wall pattern left/right on the field
};
const _awTunerDefaults = Object.freeze({ ...(_awTuner) });
let _awTunerPaused = false;

// ── RANDOM angled-wall tuner (System 2: lane-based obstacles used by T4A) ──
// Separate from _awTuner (grid generator). These drive the hardcoded values in
// the _isWallBand branch of spawnObstacles (src/40-main-late.js).
const _awRandTuner = {
  wallW:     8,    // wall width
  wallH:     4,    // wall height
  angleMin:  25,   // min angle degrees
  angleMax:  45,   // max angle degrees
  countMin:  6,    // walls per row min
  countMax:  8,    // walls per row max
  laneGap:   4,    // min lane separation (tuned up from 3 to ease T4A)
  fireRows:  70,   // FIRE rows (full T4A equivalent)
  fireRowGap: 40,  // FIRE row Z-gap
  fireJitter: 5,   // ±Z jitter per FIRE row
};
const _awRandDefaults = Object.freeze({ ..._awRandTuner });
window._awRand = _awRandTuner; // expose for obstacle spawner to read

window._awLog = function() {
  console.log('[AW-RAND LOG]\n' + JSON.stringify(_awRandTuner, null, 2));
  return _awRandTuner;
};
window._awSet = function(vals) {
  Object.assign(_awRandTuner, vals);
  console.log('[AW-RAND SET] applied:', JSON.stringify(vals));
  if (window._awPanelSync) window._awPanelSync();
  return _awRandTuner;
};
window._awReset = function() {
  Object.assign(_awRandTuner, _awRandDefaults);
  console.log('[AW-RAND RESET] back to defaults');
  if (window._awPanelSync) window._awPanelSync();
  return _awRandTuner;
};
// Fire a one-shot batch of RANDOM angled walls (the actual T4A obstacle).
// Directly spawns N rows at staggered Z, matching live T4A cadence.
window._awFire = function() {
  const T = _awRandTuner;
  for (let r = 0; r < T.fireRows; r++) {
    const count = T.countMin + Math.floor(Math.random() * (T.countMax - T.countMin + 1));
    const rowZ = SPAWN_Z - r * T.fireRowGap + (Math.random() - 0.5) * 2 * T.fireJitter;
    // Pick lanes with guaranteed 2-lane gap + min separation
    const laneCount = LANE_COUNT;
    const lanes = Array.from({ length: laneCount }, (_, i) => i);
    const shuffled = [...lanes].sort(() => Math.random() - 0.5);
    const gapStart = Math.floor(Math.random() * (laneCount - 1));
    const gapLanes = new Set([gapStart, gapStart + 1]);
    const blocked = [];
    for (const lane of shuffled) {
      if (blocked.length >= count) break;
      if (gapLanes.has(lane)) continue;
      if (blocked.some(b => Math.abs(b - lane) < T.laneGap)) continue;
      blocked.push(lane);
    }
    blocked.forEach(lane => {
      const laneX = state.shipX + (lane - (laneCount - 1) / 2) * LANE_WIDTH;
      const wall = _getPooledWall();
      if (!wall) return;
      const angleSign = Math.random() < 0.5 ? 1 : -1;
      const angleDeg = T.angleMin + Math.random() * (T.angleMax - T.angleMin);
      wall.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, rowZ);
      wall.rotation.set(0, 0, 0);
      const m = wall.userData._mesh;
      const e = wall.userData._edges;
      m.scale.set(T.wallW, T.wallH, 0.3);
      e.scale.set(T.wallW, T.wallH, 0.3);
      m.position.y = T.wallH / 2;
      e.position.y = T.wallH / 2;
      wall.rotation.y = angleSign * angleDeg * Math.PI / 180;
      m.material.uniforms.uOpacity.value = 0;
      e.material.opacity = 0;
      _awActive.push(wall);
    });
  }
  console.log('[AW-RAND FIRE] ' + T.fireRows + ' rows, ' + T.countMin + '-' + T.countMax + ' walls each');
};

// LOOP: fires a batch, when the last wall has passed, fires another.
// Tap again to stop. Uses the same cadence as FIRE.
let _awLoopTimer = null;
window._awLoopActive = false;
window._awLoop = function() {
  if (window._awLoopActive) {
    // stop
    window._awLoopActive = false;
    if (_awLoopTimer) { clearInterval(_awLoopTimer); _awLoopTimer = null; }
    console.log('[AW-RAND LOOP] stopped');
    if (window._awLoopBtnSync) window._awLoopBtnSync();
    return;
  }
  window._awLoopActive = true;
  console.log('[AW-RAND LOOP] started');
  if (window._awLoopBtnSync) window._awLoopBtnSync();
  // Fire first batch immediately.
  window._awFire();
  // Poll every 300ms: if no active walls remain, fire another batch.
  _awLoopTimer = setInterval(() => {
    if (!window._awLoopActive) return;
    if (_awActive.length === 0) window._awFire();
  }, 300);
};

let _noSpawnMode = false; // admin: suppress all obstacle spawning
const AW_POOL_SIZE = 300;
const _awPool = [];
const _awActive = [];

function _createAngledWall() {
  const group = new THREE.Group();

  // Main wall body — BoxGeometry for thickness
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(_awTuner.colorR, _awTuner.colorG, _awTuner.colorB) },
      uEmissive: { value: _awTuner.emissive },
      uOpacity: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uEmissive;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        // Vertical gradient: bright at bottom, fading up
        float grad = 1.0 - vUv.y * 0.4;
        // Edge glow on left/right sides of the wall
        float edgeDist = min(vUv.x, 1.0 - vUv.x);
        float edge = smoothstep(0.0, 0.08, edgeDist);
        float edgeGlow = (1.0 - edge) * 2.0;
        vec3 col = uColor * (grad + edgeGlow) * uEmissive;
        // Darken core slightly for depth
        col = mix(col * 0.15, col, 0.3 + edge * 0.7);
        gl_FragColor = vec4(col, uOpacity);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);

  // Edge lines for that neon outline look
  const edgesGeo = new THREE.EdgesGeometry(geo);
  const edgesMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(_awTuner.colorR, _awTuner.colorG, _awTuner.colorB),
    transparent: true,
    opacity: 0,
    linewidth: 1,
  });
  const edges = new THREE.LineSegments(edgesGeo, edgesMat);
  group.add(edges);

  group.userData.active = false;
  group.userData.isAngledWall = true;
  group.userData._mesh = mesh;
  group.userData._edges = edges;
  group.visible = false;
  scene.add(group);
  return group;
}

for (let i = 0; i < AW_POOL_SIZE; i++) _awPool.push(_createAngledWall());

function _getPooledWall() {
  for (let i = 0; i < _awPool.length; i++) {
    if (!_awPool[i].userData.active) {
      _awPool[i].userData.active = true;
      _awPool[i].visible = true;
      return _awPool[i];
    }
  }
  return null;
}

function _returnWallToPool(w) {
  w.userData.active = false;
  w.userData.isEcho = false;
  w.userData.echoOpacity = 1.0;
  w.visible = false;
  w.position.set(0, -9999, 0);
}

function _applyWallTuner(w, angleSign) {
  const m = w.userData._mesh;
  const e = w.userData._edges;
  // Scale the box to wall dimensions
  m.scale.set(_awTuner.wallW, _awTuner.wallH, _awTuner.thickness);
  e.scale.set(_awTuner.wallW, _awTuner.wallH, _awTuner.thickness);
  // Position wall so bottom sits at water level
  m.position.y = _awTuner.wallH / 2;
  e.position.y = _awTuner.wallH / 2;
  // Rotation: base alternating angle + extra tuner rotations
  const deg = Math.PI / 180;
  w.rotation.set(
    _awTuner.rotX * deg,
    (angleSign * _awTuner.angle + _awTuner.rotY) * deg,
    _awTuner.rotZ * deg
  );
  // Update material
  const col = new THREE.Color(_awTuner.colorR, _awTuner.colorG, _awTuner.colorB);
  m.material.uniforms.uColor.value.copy(col);
  m.material.uniforms.uEmissive.value = _awTuner.emissive;
  e.material.color.copy(col);
}

function spawnAngledWallRow() {
  const row = state.angledWallRowsDone;
  // Alternate sides: even rows lean right (/), odd rows lean left (\)
  const angleSign = (row % 2 === 0) ? 1 : -1;
  // Base position (fieldShift moves the whole pattern left/right)
  const baseX = state.shipX + angleSign * _awTuner.xOffset + _awTuner.fieldShift;
  const baseY = 0;
  const baseZ = SPAWN_Z;

  const cx = Math.max(1, Math.round(_awTuner.copiesX));
  const cy = Math.max(1, Math.round(_awTuner.copiesY));
  const cz = Math.max(1, Math.round(_awTuner.copiesZ));

  // Center the grid of copies around the base position
  const halfX = (cx - 1) * _awTuner.spacingX / 2;
  const halfY = (cy - 1) * _awTuner.spacingY / 2;
  const halfZ = (cz - 1) * _awTuner.spacingZ / 2;

  for (let ix = 0; ix < cx; ix++) {
    for (let iy = 0; iy < cy; iy++) {
      for (let iz = 0; iz < cz; iz++) {
        const wall = _getPooledWall();
        if (!wall) continue;
        const wx = baseX - halfX + ix * _awTuner.spacingX;
        const wy = baseY - halfY + iy * _awTuner.spacingY;
        const wz = baseZ - halfZ + iz * _awTuner.spacingZ;
        wall.position.set(wx, wy, wz);
        _applyWallTuner(wall, angleSign);
        // Start transparent for fade-in (skip if paused — show immediately)
        if (_awTunerPaused) {
          wall.userData._mesh.material.uniforms.uOpacity.value = _awTuner.opacity;
          wall.userData._edges.material.opacity = _awTuner.opacity * 0.9;
        } else {
          wall.userData._mesh.material.uniforms.uOpacity.value = 0;
          wall.userData._edges.material.opacity = 0;
        }
        _awActive.push(wall);
      }
    }
  }
  state.angledWallRowsDone++;
}

// ═══════════════════════════════════════════════════
//  POWER-UP POOL
// ═══════════════════════════════════════════════════
const POWERUP_TYPES = [
  { id: 'shield',     color: 0x00f0ff, icon: SVG_ICONS.shield,     label: 'SHIELD',      shape: 'oct'    },
  { id: 'laser',      color: 0xff2200, icon: SVG_ICONS.laser,      label: 'LASER',       shape: 'torus'  },
  { id: 'invincible', color: 0xffcc00, icon: SVG_ICONS.invincible, label: 'OVERDRIVE',   shape: 'oct'    },
  { id: 'magnet',     color: 0x44ff88, icon: SVG_ICONS.magnet,     label: 'MAGNET',      shape: 'sphere' },
];


// Coin multiplier state (must be above getPooledCoin which reads them)
let _activeCoinMult = 1;
const COIN_MULT_COLORS = { 1: 0xffcc00, 2: 0xff4444, 3: 0x4488ff };

const COIN_POOL_SIZE    = 60;
const COIN_POOL_ARC     = 40;   // extra pool slots for arc patterns
const activeCoins       = [];
const coinPool          = [];
let   framesSinceLastCoin = 0;
let   coinArcPending    = [];   // queued arc coins waiting to spawn by Z offset

function createCoinMesh() {
  const group = new THREE.Group();

  // ── Main coin body: thick disc with bevelled edges ──
  // Coins fly past fast — 32 radial segs is overkill. Mobile gets 20 (silhouette indistinguishable).
  const bodyGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.14, _mobAA ? 20 : 32);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    emissive: 0xffa500,
    emissiveIntensity: 1.1,
    metalness: 0.95,
    roughness: 0.08,
    envMapIntensity: 1.2,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // ── Raised rim torus — shiny edge ring ──
  const rimGeo = new THREE.TorusGeometry(0.46, 0.045, 8, 48);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xffe87a,
    emissive: 0xffd000,
    emissiveIntensity: 1.8,
    metalness: 1.0,
    roughness: 0.04,
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  // ── Face emboss: 5-pointed star outline ──
  const starShape = new THREE.Shape();
  const pts = 5, outerR = 0.24, innerR = 0.11;
  for (let i = 0; i < pts * 2; i++) {
    const angle = (i * Math.PI) / pts - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    i === 0 ? starShape.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
             : starShape.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  starShape.closePath();
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.03, bevelEnabled: false });
  const starMat = new THREE.MeshStandardMaterial({
    color: 0xffee44,
    emissive: 0xffd700,
    emissiveIntensity: 2.2,
    metalness: 0.9,
    roughness: 0.06,
  });
  const star = new THREE.Mesh(starGeo, starMat);
  star.rotation.x = -Math.PI / 2;
  star.position.y = 0.07;
  star.position.z = 0.0;
  group.add(star);

  // ── Back face star (mirror) ──
  const starBack = star.clone();
  starBack.rotation.x = Math.PI / 2;
  starBack.rotation.y = Math.PI;
  starBack.position.y = -0.07;
  group.add(starBack);

  // ── Spin the whole group so it faces forward (face toward player) ──
  group.rotation.x = Math.PI / 2;

  group.userData.active = false;
  group.userData.spinPhase = Math.random() * Math.PI * 2; // stagger spin timing
  group.visible = false;
  scene.add(group);
  return group;
}

for (let i = 0; i < COIN_POOL_SIZE + COIN_POOL_ARC; i++) {
  coinPool.push(createCoinMesh());
}

function getPooledCoin() {
  for (const c of coinPool) {
    if (!c.userData.active) {
      c.userData.active = true;
      c.visible = true;
      // Apply current coin color based on multiplier
      const color = COIN_MULT_COLORS[_activeCoinMult] || 0xffcc00;
      if (c.children[0] && c.children[0].material) c.children[0].material.color.setHex(color);
      return c;
    }
  }
  return null;
}

function returnCoinToPool(c) {
  c.userData.active = false;
  c.visible = false;
}

const powerupPool = [];
const activePowerups = [];

// Holo-cube powerup — 3.5u drive-through hologram cube with icon inside.
// Uses HolographicMaterial (Anderson Mancini, MIT) tinted to powerup color.
// On pickup, the cube shatters into 6 face fragments + the icon zips to ship.
const POWERUP_CUBE_SIZE = 3.5;
const POWERUP_ICON_SIZE = 1.1;  // inner icon ~1/3 of cube

function createPowerupMesh(typeIdx) {
  const def = POWERUP_TYPES[typeIdx];
  const group = new THREE.Group();

  // ── Outer holo cube — EXACTLY matches Mancini's demo defaults (drive-through, DoubleSide) ──
  // Live demo: https://threejs-vanilla-holographic-material.vercel.app/
  // (Fresnel=0.7, Scanline=3.7, Brightness=1.6, Speed=0.18, Opacity=0.7)
  // NOTE: Cube hologramColor is HARDCODED to Mancini-cyan so all 4 powerup
  // cubes look identical (clean cyan). Type is conveyed by the inner icon
  // shape+color, not the cube tint. Keeps demo-accurate look on all keys.
  const cubeMat = new HolographicMaterial({
    hologramColor:      '#00d5ff',
    fresnelAmount:      0.70,
    fresnelOpacity:     1.00,
    scanlineSize:       3.70,
    hologramBrightness: 1.60,
    signalSpeed:        0.01,
    enableBlinking:     true,
    blinkFresnelOnly:   true,
    hologramOpacity:    0.70,
    side:               THREE.DoubleSide,
    blendMode:          THREE.NormalBlending,
  });
  // depthWrite=true so the cube occludes the sun/skybox behind it
  // (HolographicMaterial constructor defaults to false). Combined with
  // NormalBlending this kills the yellow sun bleed-through.
  cubeMat.depthWrite = true;
  _registerHoloMaterial(cubeMat);
  const cubeGeo = new THREE.BoxGeometry(POWERUP_CUBE_SIZE, POWERUP_CUBE_SIZE, POWERUP_CUBE_SIZE);
  const cubeMesh = new THREE.Mesh(cubeGeo, cubeMat);
  group.add(cubeMesh);

  // ── Inner icon (same Mancini defaults so it reads as same hologram) ──
  const iconMat = new HolographicMaterial({
    hologramColor:      def.color,
    fresnelAmount:      0.70,
    fresnelOpacity:     1.00,
    scanlineSize:       3.70,
    hologramBrightness: 1.60,
    signalSpeed:        0.01,
    enableBlinking:     true,
    blinkFresnelOnly:   true,
    hologramOpacity:    0.70,
    side:               THREE.DoubleSide,
    blendMode:          THREE.NormalBlending,
  });
  // Icon sits INSIDE the cube. With cube using depthWrite=true, the cube's
  // front face would z-reject the icon. Disable depthTest on the icon and
  // bump renderOrder so it always draws on top of the cube's interior.
  iconMat.depthTest = false;
  iconMat.depthWrite = false;
  _registerHoloMaterial(iconMat);

  let iconGeo;
  if (def.shape === 'oct')        iconGeo = new THREE.OctahedronGeometry(POWERUP_ICON_SIZE);
  else if (def.shape === 'torus') iconGeo = new THREE.TorusGeometry(POWERUP_ICON_SIZE * 0.85, POWERUP_ICON_SIZE * 0.30, 10, 20);
  else if (def.shape === 'ring')  iconGeo = new THREE.TorusGeometry(POWERUP_ICON_SIZE * 0.95, POWERUP_ICON_SIZE * 0.18, 10, 28);
  else                            iconGeo = new THREE.SphereGeometry(POWERUP_ICON_SIZE * 0.9, 16, 16);
  const iconMesh = new THREE.Mesh(iconGeo, iconMat);
  iconMesh.renderOrder = 1; // draw after cube so it shows through
  group.add(iconMesh);

  group.userData.typeIdx      = typeIdx;
  group.userData.active       = false;
  group.userData.currentShape = def.shape;
  group.userData._cubeMesh    = cubeMesh;  // for shatter detach
  group.userData._iconMesh    = iconMesh;  // for icon-to-ship
  group.visible               = false;
  group.position.set(0, -9999, 0);
  scene.add(group);
  return group;
}

for (let i = 0; i < POWERUP_POOL_SIZE; i++) {
  powerupPool.push(createPowerupMesh(i % POWERUP_TYPES.length));
}

// ═══════════════════════════════════════════════════
//  POWERUP SHATTER SYSTEM
//  On pickup, the cube splits into 6 face fragments that tumble outward
//  and fade out, while the icon zips straight to the ship.
//  ~350ms total absorb time.
// ═══════════════════════════════════════════════════
const POWERUP_SHATTER_DURATION = 0.35;       // seconds
const POWERUP_SHATTER_FRAGMENT_POOL_SIZE = 60; // 10 powerups * 6 faces, plenty of headroom
const _powerupShatterFragmentPool = [];
const _powerupShatterIconPool = [];
const _activeShatterEffects = [];  // each: {fragments[6], icon, startT, endT, shipTargetFn}

function _createShatterFragment() {
  // PlaneGeometry oriented per-face. We'll set the orientation when activated.
  const geo = new THREE.PlaneGeometry(POWERUP_CUBE_SIZE, POWERUP_CUBE_SIZE);
  const mat = new HolographicMaterial({
    hologramColor:      '#00d5ff',  // overwritten on activate
    fresnelAmount:      0.70,
    fresnelOpacity:     1.00,
    scanlineSize:       3.70,
    hologramBrightness: 1.60,
    signalSpeed:        0.01,
    enableBlinking:     true,
    blinkFresnelOnly:   true,
    hologramOpacity:    0.70,
    side:               THREE.DoubleSide,
    blendMode:          THREE.AdditiveBlending,
  });
  _registerHoloMaterial(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.userData._mat = mat;
  mesh.userData._active = false;
  scene.add(mesh);
  return mesh;
}

function _createShatterIcon() {
  // Simple sphere placeholder; actual geometry is swapped on activate to match icon shape.
  // We keep one mat per pool slot to avoid material churn.
  const geo = new THREE.SphereGeometry(POWERUP_ICON_SIZE * 0.9, 16, 16);
  const mat = new HolographicMaterial({
    hologramColor:      '#00d5ff',
    fresnelAmount:      0.70,
    fresnelOpacity:     1.00,
    scanlineSize:       3.70,
    hologramBrightness: 1.60,
    signalSpeed:        0.01,
    enableBlinking:     true,
    blinkFresnelOnly:   true,
    hologramOpacity:    0.70,
    side:               THREE.DoubleSide,
    blendMode:          THREE.AdditiveBlending,
  });
  _registerHoloMaterial(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.userData._mat = mat;
  mesh.userData._active = false;
  scene.add(mesh);
  return mesh;
}

for (let i = 0; i < POWERUP_SHATTER_FRAGMENT_POOL_SIZE; i++) {
  _powerupShatterFragmentPool.push(_createShatterFragment());
}
for (let i = 0; i < POWERUP_POOL_SIZE; i++) {
  _powerupShatterIconPool.push(_createShatterIcon());
}

function _getShatterFragment() {
  for (const f of _powerupShatterFragmentPool) {
    if (!f.userData._active) { f.userData._active = true; return f; }
  }
  return null;  // pool exhausted, skip silently
}
function _getShatterIcon() {
  for (const f of _powerupShatterIconPool) {
    if (!f.userData._active) { f.userData._active = true; return f; }
  }
  return null;
}

// Cube-face local transforms: 6 faces, each at (±half) along one axis with normal pointing out.
// [posX,posY,posZ, rotX,rotY,rotZ]
const _CUBE_FACES = (() => {
  const h = POWERUP_CUBE_SIZE * 0.5;
  const PI = Math.PI;
  return [
    [ 0,  0,  h,   0,    0,    0],   // +Z front
    [ 0,  0, -h,   0,    PI,   0],   // -Z back
    [ h,  0,  0,   0,    PI/2, 0],   // +X right
    [-h,  0,  0,   0,   -PI/2, 0],   // -X left
    [ 0,  h,  0,  -PI/2, 0,    0],   // +Y top
    [ 0, -h,  0,   PI/2, 0,    0],   // -Y bottom
  ];
})();

// Spawn shatter at a powerup's current world position.
// shipTargetFn: () => THREE.Vector3 returning current ship world pos (live-updates each frame).
function _spawnPowerupShatter(pu, shipTargetFn) {
  const def = POWERUP_TYPES[pu.userData.typeIdx];
  const colorHex = def.color;
  const origin = pu.position.clone();
  const startT = state.elapsed;
  const endT = startT + POWERUP_SHATTER_DURATION;

  // 6 face fragments — explode outward along face normals + spin.
  const fragments = [];
  for (let f = 0; f < 6; f++) {
    const frag = _getShatterFragment();
    if (!frag) break;
    const [px, py, pz, rx, ry, rz] = _CUBE_FACES[f];
    frag.position.set(origin.x + px, origin.y + py, origin.z + pz);
    frag.rotation.set(rx, ry, rz);
    frag.scale.setScalar(1);
    frag.userData._mat.uniforms.hologramColor.value.setHex(colorHex);
    frag.userData._mat.uniforms.hologramOpacity.value = 0.9;
    // Outward velocity along face normal (in world space, derived from local offset since cube is axis-aligned).
    const len = Math.sqrt(px*px + py*py + pz*pz) || 1;
    frag.userData._vx = (px / len) * 14;  // ~5u over 0.35s
    frag.userData._vy = (py / len) * 14;
    frag.userData._vz = (pz / len) * 14;
    // Random tumble (rad/s)
    frag.userData._spinX = (Math.random() - 0.5) * 12;
    frag.userData._spinY = (Math.random() - 0.5) * 12;
    frag.userData._spinZ = (Math.random() - 0.5) * 12;
    frag.visible = true;
    fragments.push(frag);
  }

  // Icon — zip toward ship.
  const icon = _getShatterIcon();
  if (icon) {
    // Replace geometry to match this powerup's icon shape.
    const oldGeo = icon.geometry;
    let iconGeo;
    if (def.shape === 'oct')        iconGeo = new THREE.OctahedronGeometry(POWERUP_ICON_SIZE);
    else if (def.shape === 'torus') iconGeo = new THREE.TorusGeometry(POWERUP_ICON_SIZE * 0.85, POWERUP_ICON_SIZE * 0.30, 10, 20);
    else if (def.shape === 'ring')  iconGeo = new THREE.TorusGeometry(POWERUP_ICON_SIZE * 0.95, POWERUP_ICON_SIZE * 0.18, 10, 28);
    else                            iconGeo = new THREE.SphereGeometry(POWERUP_ICON_SIZE * 0.9, 16, 16);
    icon.geometry = iconGeo;
    if (oldGeo) oldGeo.dispose();
    icon.position.copy(origin);
    icon.scale.setScalar(1);
    icon.userData._mat.uniforms.hologramColor.value.setHex(colorHex);
    icon.userData._mat.uniforms.hologramOpacity.value = 1.0;
    icon.visible = true;
  }

  _activeShatterEffects.push({ fragments, icon, origin, startT, endT, shipTargetFn });
}

// Per-frame tick. Called from main update loop.
function _updatePowerupShatter() {
  if (_activeShatterEffects.length === 0) return;
  const now = state.elapsed;
  for (let i = _activeShatterEffects.length - 1; i >= 0; i--) {
    const fx = _activeShatterEffects[i];
    const u = Math.min(1, (now - fx.startT) / POWERUP_SHATTER_DURATION);
    const dt = 1 / 60;  // approximate; shatter is short and visual-only
    // Fragments: drift outward, spin, fade.
    for (const frag of fx.fragments) {
      frag.position.x += frag.userData._vx * dt;
      frag.position.y += frag.userData._vy * dt;
      frag.position.z += frag.userData._vz * dt;
      frag.rotation.x += frag.userData._spinX * dt;
      frag.rotation.y += frag.userData._spinY * dt;
      frag.rotation.z += frag.userData._spinZ * dt;
      const fade = 1 - u;
      frag.userData._mat.uniforms.hologramOpacity.value = 0.9 * fade;
      frag.scale.setScalar(1 - u * 0.6);
    }
    // Icon: ease toward live ship position.
    if (fx.icon && fx.shipTargetFn) {
      const target = fx.shipTargetFn();
      // smootherstep ease for a snappy lock-in feel
      const e = u * u * (3 - 2 * u);
      fx.icon.position.x = fx.origin.x + (target.x - fx.origin.x) * e;
      fx.icon.position.y = fx.origin.y + (target.y - fx.origin.y) * e;
      fx.icon.position.z = fx.origin.z + (target.z - fx.origin.z) * e;
      fx.icon.rotation.x += 8 * dt;
      fx.icon.rotation.y += 6 * dt;
      const fade = 1 - u * u;  // icon stays bright longer
      fx.icon.userData._mat.uniforms.hologramOpacity.value = fade;
      fx.icon.scale.setScalar(1 - u * 0.5);
    }
    // End — return all to pool.
    if (now >= fx.endT) {
      for (const frag of fx.fragments) {
        frag.visible = false;
        frag.userData._active = false;
      }
      if (fx.icon) {
        fx.icon.visible = false;
        fx.icon.userData._active = false;
      }
      _activeShatterEffects.splice(i, 1);
    }
  }
}

// ═══════════════════════════════════════════════════
//  LASER BEAM
// ═══════════════════════════════════════════════════
// T1 laser beam — thin bright core + soft glow cylinder
const laserCoreGeo = new THREE.CylinderGeometry(0.03, 0.03, 120, 4);
laserCoreGeo.rotateX(Math.PI / 2); // align along Z axis
const laserMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const laserMesh = new THREE.Mesh(laserCoreGeo, laserMat);
// beam mesh offset so its near end is at Z=0 of pivot, far end extends forward
laserMesh.position.set(0, 0, -60); // center 60 units forward from pivot
laserMesh.visible = false;
// Outer glow cylinder
const laserGlowGeo = new THREE.CylinderGeometry(0.12, 0.12, 120, 6);
laserGlowGeo.rotateX(Math.PI / 2);
const laserGlowMat = new THREE.MeshBasicMaterial({
  color: 0xff3300, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const laserGlowMesh = new THREE.Mesh(laserGlowGeo, laserGlowMat);
laserGlowMesh.position.copy(laserMesh.position);
laserGlowMesh.visible = false;
// Pivot group: sits at ship nose, beam extends forward inside it.
// Rotating the pivot sweeps the beam around the ship nose.
const laserPivot = new THREE.Group();
laserPivot.add(laserMesh);
laserPivot.add(laserGlowMesh);
laserPivot.visible = false;
scene.add(laserPivot);

// Dual laser bolt pool (T2+) — thin core + glow per bolt
const laserBolts = [];
// ── Laser tuner vars ──
// T1 beam
let _lBeamY      = 1.20;  // beam Y world position
let _lBeamZ      = -72;   // beam Z center
let _lBeamXOff   = 0;     // beam X offset from shipX
let _lBeamCoreR  = 0.03;  // core radius
let _lBeamGlowR  = 0.12;  // glow radius
// Bolts (T2+)
let _lbLength    = 2.0;   // core cylinder length
let _lbGlowLen   = 2.5;   // glow cylinder length
let _lbSpread    = 0.35;  // X offset between adjacent bolt lanes
let _lbLanes     = 2;     // total number of bolt lanes (spread symmetrically)
let _lbYOffset   = 0;     // Y offset relative to ship position
let _lbZOffset   = -2;    // Z offset (negative = forward)
let _lbFireRate  = 5;     // shots per second per side (base, overridden per tier)

const laserBoltCoreGeo = new THREE.CylinderGeometry(0.02, 0.02, 2.0, 4);
laserBoltCoreGeo.rotateX(Math.PI / 2);
const laserBoltGlowGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6);
laserBoltGlowGeo.rotateX(Math.PI / 2);

function spawnLaserBolt(side) {
  let bolt = laserBolts.find(b => !b.visible);
  if (!bolt) {
    const group = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const core = new THREE.Mesh(laserBoltCoreGeo, coreMat);
    group.add(core);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff2200, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Mesh(laserBoltGlowGeo, glowMat);
    group.add(glow);
    group.visible = false;
    group.userData._coreMat = coreMat;
    group.userData._glowMat = glowMat;
    scene.add(group);
    bolt = group;
    laserBolts.push(bolt);
  }
  bolt.visible = true;
  const col = state.laserColor || 0xff2200;
  bolt.userData._coreMat.color.set(0xffffff); // core is always white-hot
  bolt.userData._glowMat.color.setHex(col);   // glow is the tier color
  const _spread = state._laserBoltSpread !== undefined ? state._laserBoltSpread : _lbSpread;
  const _yoff   = state._laserBoltYOff   !== undefined ? state._laserBoltYOff   : _lbYOffset;
  const _zoff   = state._laserBoltZOff   !== undefined ? state._laserBoltZOff   : _lbZOffset;
  bolt.position.set(state.shipX + side * _spread, shipGroup.position.y + _yoff, shipGroup.position.z + _zoff);
  // Apply per-tier length scaling
  const _cLen = state._laserBoltLen  !== undefined ? state._laserBoltLen  / 2.0 : 1;
  const _gLen = state._laserBoltGlow !== undefined ? state._laserBoltGlow / 2.5 : 1;
  bolt.children[0].scale.z = _cLen;
  bolt.children[1].scale.z = _gLen;
  bolt.userData.vel = -140;
  bolt.userData.life = 0.6;
  bolt.userData._side = side * _spread; // store lane offset for X tracking
  return bolt;
}

// ═══════════════════════════════════════════════════
//  FOG
// ═══════════════════════════════════════════════════
scene.fog = new THREE.FogExp2(0x0d0428, 0.008);

