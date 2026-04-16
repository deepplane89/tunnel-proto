import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.167.0/examples/jsm/loaders/GLTFLoader.js';



// ═══════════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════════
const LEADERBOARD_API = '/api/scores';
let cachedLeaderboard = [];

async function fetchLeaderboard() {
  try {
    const res = await fetch(LEADERBOARD_API);
    if (res.ok) {
      cachedLeaderboard = await res.json();
    } else {
      throw new Error('API not ok');
    }
  } catch (e) {
    // API not available (local dev) — fall back to window._LS
    cachedLeaderboard = JSON.parse(window._LS.getItem('jet-horizon-scores') || '[]');
  }
  renderLeaderboard();
  // Show on title screen if we're on title
  if (state.phase === 'title') {
    const _tlb = document.getElementById('title-leaderboard');
    if (_tlb) {
      _tlb.classList.remove('hidden');
      // Block touch events from bubbling to the canvas so scrolling
      // the leaderboard doesn't trigger tap-to-play
      if (!_tlb._scrollGuarded) {
        _tlb._scrollGuarded = true;
        _tlb.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
        _tlb.addEventListener('touchmove',  e => e.stopPropagation(), { passive: true });
        _tlb.addEventListener('touchend',   e => e.stopPropagation(), { passive: true });
      }
    }
  }
}

async function submitScore(name, score) {
  // Always save to window._LS as backup — one entry per player (best score only)
  const local = JSON.parse(window._LS.getItem('jet-horizon-scores') || '[]');
  const existing = local.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (score > existing.score) { existing.score = score; existing.date = Date.now(); }
  } else {
    local.push({ name, score, date: Date.now() });
  }
  local.sort((a, b) => b.score - a.score);
  window._LS.setItem('jet-horizon-scores', JSON.stringify(local.slice(0, 50)));

  try {
    const res = await fetch(LEADERBOARD_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score }),
    });
    if (res.ok) {
      cachedLeaderboard = await res.json();
    } else {
      throw new Error('API not ok');
    }
  } catch (e) {
    cachedLeaderboard = local.slice(0, 10);
  }
  renderLeaderboard();
}

function renderLeaderboard() {
  const top10 = (cachedLeaderboard || []).slice(0, 10);
  const _html = top10.length === 0
    ? '<div class="lb-empty">NO SCORES YET</div>'
    : top10.map((entry, i) =>
        `<div class="lb-row">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${escapeHtml(entry.name)}</span>
          <span class="lb-score">${entry.score.toLocaleString()}</span>
        </div>`
      ).join('');
  const list = document.getElementById('leaderboard-list');
  if (list) list.innerHTML = _html;
  // Also populate title screen inline leaderboard
  const titleList = document.getElementById('title-leaderboard-list');
  if (titleList) titleList.innerHTML = _html;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
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
  _jetLightningMode: false,  // Jet Lightning arcade mode
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
  deathRunSpeedTier: 0,      // independent speed ramp, infinite (0=L2, 3=L5, 4+=beyond)
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

const SHIP_SKINS = [
  { name: 'RUNNER',         price: 0,    description: 'Default' },
  { name: 'GHOST',         price: 400,  description: 'Clean glossy white' },
  { name: 'BLACK MAMBA',   price: 800,  description: 'Stealth predator' },
  { name: 'CIPHER',        price: 1400, description: 'Voronoi hull plating' },
  { name: 'LOW POLY',      price: 0,    description: 'Low poly fighter',  glbFile: 'spaceship_low_poly.glb',
    glbConfig: { posX:0, posY:0.850, posZ:3.000, rotX:-0.052, rotY:-0.002, rotZ:-0.002, scale:0.248,
      nozzleL:[-0.420,0.190,3.440], nozzleR:[0.420,0.170,3.390],
      miniL:[-0.280,0.032,1.550], miniR:[0.260,0.032,1.550],
      thrusterScale:0.46, thrusterLength:3.9, noMiniThrusters:true, bloomScale:0.3 } },
  { name: 'RUNNER MK II',    price: 0,    description: 'Upgraded Runner',   glbFile: 'spaceship_01.glb',
    glbConfig: { posX:0, posY:-0.590, posZ:0, rotX:0, rotY:3.142, rotZ:0, scale:1.0,
      nozzleL:[-0.560,-0.050,4.960], nozzleR:[0.530,-0.060,4.900],
      miniL:[-0.150,0.060,5.100], miniR:[0.160,0.060,5.100], thrusterScale:1.0,
      portraitNozzleL:[-0.520,-0.020,5.020], portraitNozzleR:[0.570,-0.130,4.860],
      portraitMiniL:[-0.140,0.070,5.100], portraitMiniR:[0.160,0.070,5.100],
      matchDefault: true },
    laserConfig: { lanes:2, spread:0.35, yOff:0.45, zOff:-2.50, len:10.00, glowLen:7.50, fireRate:8.50 } },
  { name: 'SCORPION',        price: 0,    description: 'Heavy gunship',     glbFile: 'scorpion_ship.glb',
    glbConfig: { posX:0, posY:0, posZ:3.000, rotX:-1.602, rotY:0.028, rotZ:-0.002, scale:0.591,
      nozzleL:[-0.500,0.050,4.550], nozzleR:[0.610,-0.190,4.340],
      miniL:[-0.010,0.330,4.900], miniR:[0.070,0.330,4.900], thrusterScale:1.0,
      keepMaterials: true } },
];

let activeSkinIdx = 0;
let skinViewerIdx = 0;
let _skinAdminMode = false; // secret admin: 5-tap skin label to toggle

function loadSkinData() {
  const raw = window._LS.getItem(SKIN_STORAGE_KEY);
  const defaults = { selected: 0, unlocked: [0] };
  if (!raw) return defaults;
  try {
    const d = JSON.parse(raw);
    if (!Array.isArray(d.unlocked)) d.unlocked = [0];
    if (!d.unlocked.includes(0)) d.unlocked.push(0);
    return d;
  } catch { return defaults; }
}

function saveSkinData(data) {
  window._LS.setItem(SKIN_STORAGE_KEY, JSON.stringify(data));
}

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
const _FUEL_SVG = '<img src="fuelcell-icon-new.png" class="fuelcell-icon" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;">';
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
  { type:'mission', id:'runs5', desc:'Complete 5 runs', check:(r,lt)=>lt.runs>=5 },
  { type:'mission', id:'score7k', desc:'Score 7,000+ in one run', check:(r)=>r.score>=7000 },
  { type:'reward', reward:{ kind:'unlock', powerup:'laser', label:'Unlock LASER', coins:250 } },
  { type:'mission', id:'coins50', desc:'Collect 50 coins in one run', check:(r)=>r.coins>=50 },
  { type:'mission', id:'pu3', desc:'Collect 3 powerups in one run', check:(r)=>r.powerups>=3 },
  { type:'reward', reward:{ kind:'fuelcells', amount:75, label:'75 Fuel Cells', xp:150 } },
  { type:'mission', id:'score15k', desc:'Score 15,000+ in one run', check:(r)=>r.score>=15000 },
  { type:'mission', id:'coins100', desc:'Collect 100 coins in one run', check:(r)=>r.coins>=100 },
  { type:'reward', reward:{ kind:'stat', stat:'spawnrate', value:0.10, label:'Pickup Spawn +10%' } },
  { type:'mission', id:'shield2', desc:'Use shield 2 times in one run', check:(r)=>r.shields>=2 },
  { type:'mission', id:'drtier2', desc:'Reach speed tier 2 in DR', check:(r)=>r.isDR&&r.drTier>=2 },
  { type:'reward', reward:{ kind:'unlock', powerup:'invincible', label:'Unlock OVERDRIVE', fuelcells:100 } },
  { type:'mission', id:'runs15', desc:'Complete 15 runs', check:(r,lt)=>lt.runs>=15 },
  { type:'mission', id:'ltcoins500', desc:'Collect 500 total coins', check:(r,lt)=>lt.coins>=500 },
  { type:'reward', reward:{ kind:'coins', amount:500, label:'500 Coins', xp:200 } },
  { type:'mission', id:'score25k', desc:'Score 25,000+ in one run', check:(r)=>r.score>=25000 },
  { type:'mission', id:'pu5', desc:'Collect 5 powerups in one run', check:(r)=>r.powerups>=5 },
  { type:'reward', reward:{ kind:'stat', stat:'spawnrate', value:0.15, label:'Pickup Spawn +15%' } },
  { type:'mission', id:'laser3', desc:'Use laser 3 times in one run', check:(r)=>r.lasers>=3 },
  { type:'mission', id:'coins150', desc:'Collect 150 coins in one run', check:(r)=>r.coins>=150 },
  { type:'reward', reward:{ kind:'unlock', powerup:'magnet', label:'Unlock MAGNET', fuelcells:150 } },
  { type:'mission', id:'ltcoins2k', desc:'Collect 2,000 total coins', check:(r,lt)=>lt.coins>=2000 },
  { type:'mission', id:'runs30', desc:'Complete 30 runs', check:(r,lt)=>lt.runs>=30 },
  { type:'reward', reward:{ kind:'stat', stat:'scoremult', value:1, label:'Score Mult +1x' } },
  { type:'mission', id:'score40k', desc:'Score 40,000+ in one run', check:(r)=>r.score>=40000 },
  { type:'mission', id:'drtier3', desc:'Reach speed tier 3 in DR', check:(r)=>r.isDR&&r.drTier>=3 },
  { type:'reward', reward:{ kind:'fuelcells', amount:200, label:'200 Fuel Cells', xp:250 } },
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
  { type:'mission', id:'coins300', desc:'Collect 300 coins in one run', check:(r)=>r.coins>=300 },
  { type:'mission', id:'pu12', desc:'Collect 12 powerups in one run', check:(r)=>r.powerups>=12 },
  { type:'reward', reward:{ kind:'stat', stat:'spawnrate', value:0.25, label:'Pickup Spawn +25%' } },
  { type:'mission', id:'score100k', desc:'Score 100,000+ in one run', check:(r)=>r.score>=100000 },
  { type:'mission', id:'drcoins200', desc:'Collect 200 coins in one DR', check:(r)=>r.isDR&&r.coins>=200 },
  { type:'reward', reward:{ kind:'fuelcells', amount:400, label:'400 Fuel Cells', xp:450 } },
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

const REWARD_COLORS = { fuelcells:'#4488ff', coins:'#ffcc00', stat:'#00eeff', unlock:'#44ff88' };

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
      const icon = rung.reward.kind === 'fuelcells' ? _FUEL_SVG : rung.reward.kind === 'coins' ? '\u2B21' : rung.reward.kind === 'unlock' ? '\uD83D\uDD13' : '\u2605';
      return `<div class="ladder-rung reward ${cls}" data-rung="${i}" style="--reward-color:${color}">
        ${icon} ${rung.reward.label}
        ${claimable ? '<span class="claim-tap">TAP TO COLLECT</span>' : ''}
      </div>`;
    }
  }).join('');

  // Attach click handlers to claimable rewards
  container.querySelectorAll('.ladder-rung.reward.claimable').forEach(el => {
    el.addEventListener('click', (e) => {
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
perfToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  perfMode = !perfMode;
  perfToggleBtn.classList.toggle('on', perfMode);
  perfToggleBtn.setAttribute('aria-pressed', perfMode);
  applyPerfMode();
});
// applyPerfMode defined after bloom + reflectRT are created (below)
// ────────────────────────────────────────────────────────────

const canvas   = document.getElementById('game-canvas');
const _mobAA = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !_mobAA, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = false;

const scene  = new THREE.Scene();

// ── Milky Way panorama sky — full-screen NDC quad above stars, below sun ──
// Uses same NDC passthrough as star shader so it fills the screen independent of camera
const _skyQuadGeo = new THREE.PlaneGeometry(2, 2);
const _skyPanoTex = new THREE.TextureLoader().load('milkyway-pano.jpg');
_skyPanoTex.colorSpace = THREE.SRGBColorSpace;
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
_titleRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
  _titleCanvas.addEventListener('click', () => { if (typeof openShop === 'function') openShop(); });
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

const bloom = new UnrealBloomPass(
  new THREE.Vector2(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2)),
  0.35,  // strength — subtle, not overpowering
  0.25,  // radius — tight so glow hugs the source
  1.0    // threshold — only HDR emissives bloom (shield uses toneMapped:false)
);
composer.addPass(bloom);

// ── LOCALIZED HEAT HAZE (thruster exhaust distortion — low poly only) ──
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
_thrusterHazePass.enabled = false;  // enabled per-frame only for LOW POLY
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    bloom.resolution.set(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2));
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
    aberration: { value: 0.0015 }, // subtle aberration
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
      // Chromatic aberration
      float r = texture2D(tDiffuse, uv + center * aberration).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - center * aberration).b;
      vec3 col = vec3(r, g, b);
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
const _warpGeo = new THREE.BufferGeometry();
let _warpPos = new Float32Array(WARP_COUNT * 6);
// Per-particle state: lead velocity, trail velocity (accelerating)
let _warpLeadVel = new Float32Array(WARP_COUNT);
let _warpTrailVel = new Float32Array(WARP_COUNT);
const _WARP_LEAD_ACCEL  = 0.006;  // leading point acceleration
const _WARP_TRAIL_ACCEL = 0.003;  // trailing point acceleration (slower)
function _warpInitPositions(count) {
  for (let i = 0; i < count; i++) {
    const x = _warpRandX();
    const y = _warpRandY();
    const z = -WARP_DEPTH * 0.5 + Math.random() * WARP_DEPTH * 0.6;
    _warpPos[i*6]   = x;  _warpPos[i*6+1] = y;  _warpPos[i*6+2] = z;
    _warpPos[i*6+3] = x;  _warpPos[i*6+4] = y;  _warpPos[i*6+5] = z;
    _warpLeadVel[i]  = Math.random() * 0.5;
    _warpTrailVel[i] = Math.random() * 0.3;
  }
}
_warpInitPositions(WARP_COUNT);
let _warpPosAttr = new THREE.BufferAttribute(_warpPos, 3);
_warpPosAttr.setUsage(THREE.DynamicDrawUsage);
_warpGeo.setAttribute('position', _warpPosAttr);
function _warpRebuild(newCount) {
  WARP_COUNT = newCount;
  _warpPos = new Float32Array(WARP_COUNT * 6);
  _warpLeadVel = new Float32Array(WARP_COUNT);
  _warpTrailVel = new Float32Array(WARP_COUNT);
  _warpInitPositions(WARP_COUNT);
  _warpPosAttr = new THREE.BufferAttribute(_warpPos, 3);
  _warpPosAttr.setUsage(THREE.DynamicDrawUsage);
  _warpGeo.setAttribute('position', _warpPosAttr);
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
  // Scale warp count with speed: 200 at BASE_SPEED, up to 1800 at peak
  const _warpMinCount = 200, _warpMaxCount = 1800;
  const _speedT = Math.min(1, Math.max(0, (state.speed - BASE_SPEED) / (BASE_SPEED * 1.1))); // 0…1 over speed range — maxes out at 2.1x (T4c ICE STORM cyan sun)
  const _targetWarpCount = Math.round(_warpMinCount + (_warpMaxCount - _warpMinCount) * _speedT);
  if (_targetWarpCount !== WARP_COUNT) _warpRebuild(_targetWarpCount);
  // Both points accelerate in Z; leading faster → streaks elongate with speed.
  const accelMult = state.speed * _warpSpeed * 0.05;
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

const waterNormals = new THREE.TextureLoader().load('waternormals.jpg', tex => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
});

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

// Patch Water's onBeforeRender so the internal mirrorCamera skips layer 2 (thrusters)
const _origWaterOBR = mirrorMesh.onBeforeRender;
mirrorMesh.onBeforeRender = function(renderer, scene, camera) {
  // Temporarily remove layer 2 from all thruster objects so mirror camera won't see them
  // (mirrorCamera inherits default layers mask = layer 0 only, but to be safe we
  //  hide them explicitly by toggling visibility)
  const _hidden = [];
  const _hide = (obj) => { if (obj.visible) { obj.visible = false; _hidden.push(obj); } };
  thrusterSystems.forEach(s => _hide(s.points));
  miniThrusterSystems.forEach(s => _hide(s.points));
  nozzleBloomSprites.forEach(s => _hide(s));
  miniBloomSprites.forEach(s => _hide(s));
  flameMeshes.forEach(s => _hide(s));
  _hide(_warpMesh);
  _origWaterOBR.call(this, renderer, scene, camera);
  _hidden.forEach(obj => { obj.visible = true; });
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
const _shockDiscGeo = new THREE.CircleGeometry(1.0, 64);
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
const sunGeo = new THREE.SphereGeometry(SUN_R * 0.95, 64, 64);
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
const sunCapGeo = new THREE.CircleGeometry(SUN_R * 0.95, 64);
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
      uPixelRatio:  { value: Math.min(window.devicePixelRatio, 2) },
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
const gltfLoader = new GLTFLoader();
gltfLoader.load('./default_ship.glb', (gltf) => {
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
    // Skin 1: GHOST — tuned from skin tuner
    {
      rocket_base: { color: 0xe0e0e0, metalness: 0.05, roughness: 0.33, clearcoat: 1.0, clearcoatRoughness: 0.199, physical: true },
      white:       { color: 0x00e0ff, metalness: 0.0, roughness: 0.33, emissive: 0x00e0ff, emissiveIntensity: 1.0 },
      gray:        { color: 0xe0e0e0, metalness: 0.05, roughness: 0.33 },
      nozzle:      { color: 0x858585, metalness: 0.68, roughness: 0.32, emissive: 0x19e690, emissiveIntensity: 0.1 },
      rocket_light:{ color: 0x000000, emissive: 0x00e0ff, emissiveIntensity: 10, metalness: 0, roughness: 0.33 },
      fallback:    { color: 0xe0e0e0, metalness: 0.05, roughness: 0.33, clearcoat: 1.0, clearcoatRoughness: 0.199, physical: true },
    },
    // Skin 2: BLACK MAMBA — stealth predator, cyan trim glow
    {
      rocket_base: { color: 0x666666, metalness: 0.7, roughness: 0.5 },
      white:       { color: 0x1a9999, metalness: 0.5, roughness: 0.1, emissive: 0x00cccc, emissiveIntensity: 1.2 },
      gray:        { color: 0x666666, metalness: 0.7, roughness: 0.5 },
      nozzle:      { color: 0xffffff, metalness: 0.1, roughness: 1.0, emissive: 0xff6600, emissiveIntensity: 0.8 },
      rocket_light:{ color: 0x000000, emissive: 0x00cccc, emissiveIntensity: 11, metalness: 0, roughness: 0.5 },
      fallback:    { color: 0x666666, metalness: 0.7, roughness: 0.5 },
    },
    // Skin 3: CIPHER — diamond plate with emissive edge glow
    {
      rocket_base: { color: 0x000000, metalness: 0.98, roughness: 0, emissive: 0xf35959, emissiveIntensity: 1, shader: GLSL_DIAMOND, shaderEmissive: GLSL_DIAMOND_EMISSIVE },
      white:       { color: 0x000000, metalness: 0.98, roughness: 0, emissive: 0xff0000, emissiveIntensity: 1, shader: GLSL_DIAMOND, shaderEmissive: GLSL_DIAMOND_EMISSIVE },
      gray:        { color: 0x000000, metalness: 0.98, roughness: 0, emissive: 0xf35959, emissiveIntensity: 1, shader: GLSL_DIAMOND, shaderEmissive: GLSL_DIAMOND_EMISSIVE },
      nozzle:      { color: 0x080808, metalness: 0.95, roughness: 0.10 },
      rocket_light:{ color: 0x000000, emissive: 0x88bbff, emissiveIntensity: 6, metalness: 0, roughness: 0 },
      fallback:    { color: 0x000000, metalness: 0.98, roughness: 0, emissive: 0xf35959, emissiveIntensity: 1, shader: GLSL_DIAMOND, shaderEmissive: GLSL_DIAMOND_EMISSIVE },
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
      if (def.physical) {
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
  // Re-apply selected skin now that model + materials are ready
  applySkin(loadSkinData().selected);

  // ── TITLE SHIP PREVIEW: clone into separate titleScene ──────────────
  initTitleShipPreview(model);
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

  // Display pad is now an HTML image overlay (platform-pad.png)

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

// Apply a skin to the title ship clone — maps by mesh name, not uuid
function applyTitleSkin(skinIndex) {
  if (!_titleShipModel || !_prebuiltSkins.length) return;
  if (skinIndex < 0 || skinIndex >= _prebuiltSkins.length) skinIndex = 0;

  const isLocked = !_skinAdminMode && !isSkinUnlocked(skinIndex);

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
        const mat = skinMap.get(srcUuids[count]);
        if (mat) mesh.material = mat;
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

  // ── Alt GLB ship handling ──
  const skinDef = SHIP_SKINS[skinIndex];
  if (skinDef && skinDef.glbFile) {
    _loadAltShip(skinDef.glbFile, skinDef, () => { _showAltShip(); });
    return;
  } else {
    _hideAltShip();
  }

  if (skinIndex >= _prebuiltSkins.length) skinIndex = 0;
  const skinMap = _prebuiltSkins[skinIndex];
  shipHullMats.length = 0;
  shipEdgeLines.length = 0;

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

  // Per-skin lighting overrides (0=Runner, 1=Ghost, 2=Black Mamba, 3=Cipher)
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
  } else {
    // Restore defaults for other skins
    dirLight.intensity = 2.56; dirLight.position.set(2, 8.8, 8);
    rimLight.intensity = 0.10; fillLight.intensity = 0.25;
    sunLight.intensity = 0.22; sunLightL.intensity = 0.10;
    window._thrusterScale = 1.0;
    window._baseThrusterScale = 1.0;
  }
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
  _snapshotNozzleBaseline();
}

function _loadAltShip(glbFile, skinDef, callback) {
  // If already cached, just switch to it
  if (_altShipCache[glbFile]) {
    const cached = _altShipCache[glbFile];
    _altShipModel = cached.model;
    _altShipMixer = cached.mixer || null;
    _altShipClips = cached.clips || {};
    _altShipCurrentFile = glbFile;
    _applyGlbConfig(skinDef && skinDef.glbConfig);
    _updateAltShipTransform();
    if (callback) callback();
    return;
  }
  const loader = new GLTFLoader();
  loader.load('./' + glbFile, (gltf) => {
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
          // Apply same materials as the default ship based on GLB material names
          const matName = (child.material && child.material.name) ? child.material.name : '';
          child.userData._origMatName = matName;
          if (matName === 'nozzle') {
            child.material = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.95, roughness: 0.12 });
          } else if (matName === 'gray') {
            child.material = new THREE.MeshStandardMaterial({ color: 0x888899, metalness: 0.6, roughness: 0.32 });
          } else if (matName === 'rocket_light' || matName === 'rocket light') {
            child.material = new THREE.MeshStandardMaterial({ color: 0x0044ff, emissive: 0x0033cc, emissiveIntensity: 2.5, metalness: 0.0, roughness: 0.05 });
          } else if (matName === 'rocket_base' || matName === 'rocket base') {
            const _rbMat = new THREE.MeshStandardMaterial({ color: 0x0e1014, metalness: 0.90, roughness: 0.30 });
            _rbMat.onBeforeCompile = _hexBumpShaderPatch;
            _rbMat.needsUpdate = true;
            child.material = _rbMat;
            shipHullMats.push(child.material);
          } else if (matName === 'fire' || matName === 'fire1') {
            shipFireMeshes.push(child);
          } else if (matName === 'white' || matName === 'white ') {
            child.material = new THREE.MeshStandardMaterial({ color: 0xddeeff, metalness: 0.5, roughness: 0.08, emissive: 0x2255ff, emissiveIntensity: 0.6 });
          } else if (matName === 'Light') {
            child.material = new THREE.MeshStandardMaterial({ color: 0x0044ff, emissive: 0x0033cc, emissiveIntensity: 2.5, metalness: 0.0, roughness: 0.05 });
          } else {
            const _hMat = new THREE.MeshStandardMaterial({ color: 0x141820, metalness: 0.88, roughness: 0.25 });
            _hMat.onBeforeCompile = _hexBumpShaderPatch;
            _hMat.needsUpdate = true;
            child.material = _hMat;
            shipHullMats.push(child.material);
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
      console.log('[ALT SHIP] Animations:', Object.keys(clips).join(', '));
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
    _altShipCache[glbFile] = { model, mixer, clips };
    _altShipModel = model;
    _altShipMixer = mixer;
    _altShipClips = clips;
    _altShipCurrentFile = glbFile;
    console.log('[ALT SHIP] Loaded:', glbFile);
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
  // Cone thrusters default ON for LOW POLY, OFF for others
  window._coneThrustersEnabled = (activeSkinIdx === 4);
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
  window._coneThrustersEnabled = false; // default ships: cones off
  // Restore default nozzle offsets
  NOZZLE_OFFSETS[0].set(-0.50, 0.12, 5.20);
  NOZZLE_OFFSETS[1].set( 0.50, 0.12, 5.20);
  MINI_NOZZLE_OFFSETS[0].set(-0.22, 0.08, 5.10);
  MINI_NOZZLE_OFFSETS[1].set( 0.22, 0.08, 5.10);
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

// Engine nozzle world-space offsets
// Side pods (Mesh4/5): local x=±1.52, y=-0.233(bottom), z=1.488(back) × scale 0.30
// World: x=±0.456, y=0.28-0.07=0.21, z=4.5+1.488*0.30=4.946
const NOZZLE_OFFSETS = [
  new THREE.Vector3(-0.50, 0.12, 5.20),  // left pod back-bottom
  new THREE.Vector3( 0.50, 0.12, 5.20),  // right pod back-bottom
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
    size: 0.18,
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
    size: 0.09,
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
// Per-skin toggle: LOW POLY defaults ON, all others OFF
window._coneThrustersEnabled = false; // set true by applySkin when idx===4
// Tunable globals for the cone shader — exposed via sliders
window._coneThruster = {
  length:       3.4,
  radius:       0.14,
  rotX:         1.42,
  rotY:         1.72,
  rotZ:         0.05,
  offX:         0,
  offY:         0,
  offZ:         0,
  neonPower:    1.5,
  noiseSpeed:   0.8,
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

  // Neon color ramp from the article — hot white core → saturated color → dark
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
  mesh.visible = false;  // only shown for low poly
  mesh.renderOrder = 9;
  scene.add(mesh);
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
window._thrusterSpreadX = 1.0;   // lateral spread multiplier (wider)
window._thrusterSpreadY = 1.0;   // vertical spread multiplier (flatter < 1, taller > 1)
window._thrusterLength  = 1.0;   // exhaust length multiplier
window._thrusterVisible = true;  // master on/off
window._nozzleBloomScale = window._nozzleBloomScale || 1.0;
window._nozzleBloomOpacity = window._nozzleBloomOpacity != null ? window._nozzleBloomOpacity : 0.34;
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
let _yawMax = 0.06;              // radians — nose turn into steering direction
let _yawSmoothing = 4;           // higher = snappier yaw response
let _yawSmooth = 0;
let _bankMax = 0.03;             // bank multiplier (baked from tuner)
let _bankSmoothing = 8;          // bank lerp speed (existing: 8)
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
let _camFOVOffset = 13;          // tuner offset for camera FOV (baked: 78 - 65 = 13)
let _baseFOV = 78;               // set per orientation in updateCameraFOV
let _fovSpeedBoost = 22;         // max FOV increase at top speed — cranked for dramatic speed feel
let _prevSpeed = 0;              // for detecting accel vs decel

function updateThrusterColor(color) {
  thrusterColor.copy(color);
}

function updateThrusters(dt, shipX, shipY, shipZ, accel) {
  const playing    = state.phase === 'playing';
  const tp         = state.thrusterPower != null ? state.thrusterPower : 1;
  const speedScale = Math.min(state.speed / BASE_SPEED, 2.0);
  const spawnRate  = (0.5 + accel * 0.5 + (speedScale - 1.0) * 0.6) * tp;  // scaled by thruster power

  // Exhaust cone scale/opacity handled in the main update() animation block

  // ── localToWorld: lock all thruster elements to shipGroup transform ──
  shipGroup.updateMatrixWorld(true);

  thrusterSystems.forEach((sys, idx) => {
    // Hide entire particle system when thrusters are off or toggled
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
        // Speed-reactive lifetime — longer trail at high speed
        sys.lifetimes[i] = (0.18 + Math.random() * 0.22) * (0.6 + speedScale * 0.9);

        pos[i * 3]     = wx + (Math.random() - 0.5) * 0.03;  // tighter spawn
        pos[i * 3 + 1] = wy + (Math.random() - 0.5) * 0.03;
        pos[i * 3 + 2] = wz;

        // Velocity: mostly +Z (backward), very tight lateral — condensed needle look
        const _spX = window._thrusterSpreadX || 1.0;
        const _spY = window._thrusterSpreadY || 1.0;
        const _len = (_altShipActive && _altShip.thrusterLength != null) ? _altShip.thrusterLength : (window._thrusterLength || 1.0);
        sys.velocities[i].set(
          (Math.random() - 0.5) * 0.06 * _spX,
          (Math.random() - 0.5) * 0.06 * _spY - 0.02,
          (2.5 + Math.random() * 2.0 + speedScale * 1.5) * _len
        );
      } else {
        const t0 = sys.ages[i] / sys.lifetimes[i];
        if (t0 < 0.12) {
          // Pin to nozzle for the first 12% of life — origin always locked to pod
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
          // Bend trail: gently pull particle X toward current nozzle X
          pos[i * 3] += (wx - pos[i * 3]) * 4.0 * dt;
        }
      }

      // Lifetime ratio 0→1
      const t = sys.ages[i] / sys.lifetimes[i];

      // Color: subtle white core → level color → fade
      if (t < 0.10) {
        // Brief soft white tint at nozzle (toned down)
        const s = t / 0.10;
        col[i * 3]     = 1.0;
        col[i * 3 + 1] = THREE.MathUtils.lerp(0.85, thrusterColor.g, s);
        col[i * 3 + 2] = THREE.MathUtils.lerp(0.85, thrusterColor.b, s);
      } else if (t < 0.65) {
        // Full level color, brighter at high speed
        const s = (t - 0.10) / 0.55;
        const bright = 1.0 + speedScale * 0.3;
        col[i * 3]     = THREE.MathUtils.lerp(thrusterColor.r * bright, thrusterColor.r, s);
        col[i * 3 + 1] = THREE.MathUtils.lerp(thrusterColor.g * bright, thrusterColor.g, s);
        col[i * 3 + 2] = THREE.MathUtils.lerp(thrusterColor.b * bright, thrusterColor.b, s);
      } else {
        // Fade to black
        const s = (t - 0.65) / 0.35;
        col[i * 3]     = THREE.MathUtils.lerp(thrusterColor.r, 0, s);
        col[i * 3 + 1] = THREE.MathUtils.lerp(thrusterColor.g, 0, s);
        col[i * 3 + 2] = THREE.MathUtils.lerp(thrusterColor.b, 0, s);
      }

      // Size: speed-reactive — bigger/longer at high speed, scaled by thruster power
      const baseSize = 0.22 + speedScale * 0.10;
      const rawSz = t < 0.10
        ? THREE.MathUtils.lerp(baseSize * 1.6, baseSize, t / 0.10)
        : (1.0 - t) * (baseSize + Math.random() * 0.06);
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
      bloom.material.color.set(thrusterColor);
      const _nbo = window._nozzleBloomOpacity != null ? window._nozzleBloomOpacity : 0.34;
      bloom.material.opacity = _nbo * (0.85 + Math.sin(Date.now() * 0.008) * 0.15) * tp;
    } else {
      bloom.visible = false;
    }

    // Flame shader quads disabled — rigid quad can't bend with particle trail
    flameMeshes[idx].visible = false;

    // ── Thruster cone mesh ──
    const cone = _thrusterCones[idx];
    if (window._coneThrustersEnabled && tp > 0.01 && window._thrusterVisible !== false) {
      cone.visible = true;
      const ct = window._coneThruster;
      cone.position.set(wx + ct.offX, wy + ct.offY, wz + ct.offZ);
      cone.rotation.set(ct.rotX, ct.rotY, ct.rotZ);
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
        sys.lifetimes[i] = 0.05 + Math.random() * 0.06;
        pos[i * 3]     = wx + (Math.random() - 0.5) * 0.02;
        pos[i * 3 + 1] = wy + (Math.random() - 0.5) * 0.02;
        pos[i * 3 + 2] = wz;
        // Always straight back — no roll influence on velocity
        sys.velocities[i].set(
          0,
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
          // Bend trail with ship lateral movement
          pos[i * 3] += (wx - pos[i * 3]) * 4.0 * dt;
        }
      }
      const t = sys.ages[i] / sys.lifetimes[i];
      if (t < 0.08) {
        // Hot white core → thruster color
        const s = t / 0.08;
        col[i*3]   = THREE.MathUtils.lerp(0.85, thrusterColor.r, s);
        col[i*3+1] = THREE.MathUtils.lerp(0.85, thrusterColor.g, s);
        col[i*3+2] = THREE.MathUtils.lerp(0.85, thrusterColor.b, s);
      } else if (t < 0.6) {
        col[i*3]   = thrusterColor.r;
        col[i*3+1] = thrusterColor.g;
        col[i*3+2] = thrusterColor.b;
      } else {
        const s = (t - 0.6) / 0.4;
        col[i*3]   = THREE.MathUtils.lerp(thrusterColor.r, 0, s);
        col[i*3+1] = THREE.MathUtils.lerp(thrusterColor.g, 0, s);
        col[i*3+2] = THREE.MathUtils.lerp(thrusterColor.b, 0, s);
      }
      const bSz = 0.035 + speedScale * 0.015;
      const raw = t < 0.10 ? THREE.MathUtils.lerp(bSz * 1.4, bSz, t / 0.10) : (1.0 - t) * bSz;
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
      mBloom.material.color.set(thrusterColor);
      mBloom.material.opacity = (0.15 + speedScale * 0.15) * tp;
    } else {
      mBloom.visible = false;
    }
  });
}

// ── Flow Shield ShaderMaterial ────────────────────────────────────────────
const _shieldHitPositions = Array.from({ length: 6 }, () => new THREE.Vector3(0, 1.8, 0));
const _shieldHitTimes     = new Array(6).fill(-999);
let _shieldHitIdx = 0;

const shieldGeo = new THREE.SphereGeometry(2.4, 64, 64);
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
  // Chunk geometry — PlaneGeometry rotated vertical, per-vert Z displaced
  chunkH:        120,   // height of each chunk
  chunkW:        24,    // Z-width of each chunk
  chunkDepth:    30,    // max Z displacement (how far verts jut in/out)
  segsH:         10,    // vertical segments — more = more face variety
  segsW:         5,     // horizontal segments
  poolSize:      14,    // chunks per side
  // Appearance
  color:         0x2a7090,   // mid teal — bright enough to catch light
  emissive:      0x001828,
  emissiveInt:   0.6,
  roughness:     0.75,
  metalness:     0.10,
  // Canyon fill light
  ambientBoost:  0.35,  // extra ambient added when canyon is active
  // Scroll
  scrollSpeed:   1.0,
  snapRate:      6.0,
};
let _canyonWalls = null;
let _canyonFillLight = null;
let _canyonActive = false;
let _canyonSqueezeRow = 0;
let _canyonSqueezeZ   = 0;
let _canyonSineT         = 0;
let _canyonSineRows      = 0;
let _canyonSineZ         = 0;
let _canyonWasCorridor   = false;
let _canyonDiagFrame     = 0;     // frame counter for periodic diagnostic log
// Call window._canyonLog() from console to get a snapshot
window._canyonLog = function() {
  const T = _canyonTuner;
  const walls = _canyonWalls;
  const halfX = T.canyonHalfX || 45;
  const spawnBase = walls ? (walls._spawnX || 0) : 0;
  // Center comes from the real L3 algorithm via spawnCorridorRow
  const center = T.freezeWide ? 0 : (state.corridorGapCenter || 0);
  const out = {
    active:            _canyonActive,
    freezeWide:        T.freezeWide,
    corridorGapCenter: +(state.corridorGapCenter||0).toFixed(2),
    corridorRowsDone:  state.corridorRowsDone||0,
    corridorSineT:     +(state.corridorSineT||0).toFixed(3),
    center:            +center.toFixed(2),
    spawnBase:         +spawnBase.toFixed(2),
    halfX,
    leftX:        walls ? +walls.left[0].position.x.toFixed(2) : null,
    rightX:       walls ? +walls.right[0].position.x.toFixed(2) : null,
    gapActual:    walls ? +(walls.right[0].position.x - walls.left[0].position.x).toFixed(2) : null,
    shipX:        +(state.shipX||0).toFixed(2),
    shipInGap:    walls ? (state.shipX > walls.left[0].position.x && state.shipX < walls.right[0].position.x) : null,
    jlCorridorActive: _jlCorridor.active,
  };
  console.log('[CANYON LOG]\n' + JSON.stringify(out, null, 2));
  return out;
};

function _makeCanyonGridTexture() {
  const T  = _canyonTuner;
  const W  = 512, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Transparent base — face color comes from MeshStandardMaterial.color
  ctx.clearRect(0, 0, W, H);

  // Seeded RNG
  let _s = 42;
  const rng = () => { _s = (_s * 16807) % 2147483647; return (_s-1)/2147483646; };

  // Sparse diagonal grid lines
  ctx.strokeStyle = T.gridColor;
  ctx.lineWidth   = 1.5;
  const step = 80;
  for (let i = -H; i < W + H; i += step) {
    ctx.globalAlpha = T.gridOpacity * (0.6 + rng() * 0.4);
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i + H, H);
    ctx.stroke();
  }
  // A few horizontal hairlines
  for (let j = 0; j < 6; j++) {
    const y = rng() * H;
    ctx.globalAlpha = T.gridOpacity * 0.4;
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Magenta cracks — sparse, jagged, per-face contained
  ctx.lineWidth = 1.2;
  for (let ci = 0; ci < 7; ci++) {
    const sx = rng() * W, sy = rng() * H;
    ctx.strokeStyle = rng() > 0.4 ? T.crackColor : '#cc44ff';
    ctx.globalAlpha = T.crackOpacity * (0.5 + rng() * 0.5);
    ctx.lineWidth   = 0.8 + rng() * 2.0;
    ctx.beginPath(); ctx.moveTo(sx, sy);
    let cx = sx, cy = sy;
    const segs = 3 + Math.floor(rng() * 4);
    for (let s = 0; s < segs; s++) {
      cx += (rng() - 0.35) * 80; cy += (rng() * 0.7 + 0.1) * 60;
      ctx.lineTo(Math.max(0,Math.min(W,cx)), Math.max(0,Math.min(H,cy)));
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function _buildCanyonSlabGeo(seed, side) {
  // Vertical plane with per-vertex random Z displacement.
  // Key insight: each vertex gets an INDEPENDENT Z offset, so adjacent
  // triangles face completely different directions. flatShading then gives
  // each triangle a distinct brightness from the directional key light.
  // This is what creates the AI-ref cliff face look.

  const T = _canyonTuner;
  let _s = (Math.abs(seed) * 9301 + 49297) % 233280;
  const rng = () => { _s = (_s * 9301 + 49297) % 233280; return _s / 233280; };

  const H     = T.chunkH * (0.85 + rng() * 0.30);
  const W     = T.chunkW * (0.90 + rng() * 0.20);
  const segH  = T.segsH;
  const segW  = T.segsW;
  const vCols = segW + 1;
  const vRows = segH + 1;
  const D     = T.chunkDepth;

  const pos = new Float32Array(vCols * vRows * 3);
  const uvs = new Float32Array(vCols * vRows * 2);
  const idx = [];

  for (let row = 0; row < vRows; row++) {
    const v  = row / segH;
    const y  = v * H;
    // Top edge ragged: extra Z jitter at top
    const topFactor = v > 0.85 ? (v - 0.85) / 0.15 : 0;

    for (let col = 0; col < vCols; col++) {
      const u  = col / segW;
      // Per-vertex Z displacement — the core of the effect
      // Low-freq base (large boulder shapes) + high-freq detail
      const zBase   = (rng() - 0.5) * 2.0 * D;
      const zDetail = (rng() - 0.5) * 2.0 * D * 0.3;
      const zTop    = topFactor * (rng() - 0.3) * D * 1.5;
      const z = zBase + zDetail + zTop;

      // X is 0 — the inner face sits at corridor edge.
      // Side just determines which direction the chunk faces.
      const i = row * vCols + col;
      pos[i*3+0] = 0;
      pos[i*3+1] = y;
      pos[i*3+2] = u * W + z;
      uvs[i*2+0] = u;
      uvs[i*2+1] = v;
    }
  }

  // Quads — winding so inner face (facing corridor, -X for right wall) is front
  for (let row = 0; row < segH; row++) {
    for (let col = 0; col < segW; col++) {
      const a = row * vCols + col;
      const b = a + 1;
      const c = a + vCols;
      const d = c + 1;
      if (side === 1) {
        // Right wall — inner face faces -X (toward ship)
        idx.push(a, c, b,  b, c, d);
      } else {
        // Left wall — inner face faces +X (toward ship)
        idx.push(a, b, c,  b, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals(); // needed for MeshStandardMaterial lighting
  return geo;
}

function _createCanyonWalls() {
  if (_canyonWalls) return;
  const T  = _canyonTuner;
  const gridTex = _makeCanyonGridTexture();

  // Bump scene ambient while canyon is active so faces catching no direct
  // light still read as dark-teal rather than pure black
  ambientLight.intensity += T.ambientBoost;

  // Single material — flatShading:true so each triangle gets its own flat
  // normal → different brightness per face from scene directional light
  const mat = new THREE.MeshStandardMaterial({
    color:             T.color,
    emissive:          T.emissive,
    emissiveMap:       gridTex,
    emissiveIntensity: T.emissiveInt,
    roughness:         T.roughness,
    metalness:         T.metalness,
    flatShading:       true,
    side:              THREE.DoubleSide,
  });

  const SPACING = T.chunkW * 1.02;

  function makeChunk(side, seed, zPos) {
    const geo  = _buildCanyonSlabGeo(seed, side);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = zPos;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }

  const chunks = { left: [], right: [] };
  ['left','right'].forEach(k => {
    const side = k === 'left' ? -1 : 1;
    for (let i = 0; i < T.poolSize; i++) {
      const seed = i * 7 + (k === 'right' ? 100 : 0);
      chunks[k].push(makeChunk(side, seed, SPAWN_Z + i * SPACING));
    }
  });

  const gapCenter = state.corridorGapCenter || 0;
  chunks.left.forEach(m  => { m.position.x = gapCenter - 80; });
  chunks.right.forEach(m => { m.position.x = gapCenter + 80; });

  _canyonWalls = {
    strips:   [...chunks.left, ...chunks.right],
    left:     chunks.left,
    right:    chunks.right,
    mat,
    gridTex,
    _spacing: SPACING,
  };
}

function _destroyCanyonWalls() {
  if (!_canyonWalls) return;
  // Restore ambient light
  ambientLight.intensity -= _canyonTuner.ambientBoost;
  _canyonWalls.strips.forEach(m => { scene.remove(m); m.geometry.dispose(); });
  if (_canyonWalls.mat)     _canyonWalls.mat.dispose();
  if (_canyonWalls.gridTex) _canyonWalls.gridTex.dispose();
  _canyonWalls = null;
  if (_canyonFillLight) {
    if (_canyonFillLight.lights) _canyonFillLight.lights.forEach(l => scene.remove(l));
    else scene.remove(_canyonFillLight);
    _canyonFillLight = null;
  }
}

function _updateCanyonWalls(dt, speed) {
  if (!_canyonWalls || !_canyonActive) return;
  const T   = _canyonTuner;
  const spd = (speed && speed > 1) ? speed : BASE_SPEED;
  const scroll  = spd * dt * T.scrollSpeed;
  const spacing = _canyonWalls._spacing;

  const gapCenter = state.corridorGapCenter || 0;
  const gapHalfX  = (_jlCorridor && _jlCorridor._lastHalfX != null)
    ? _jlCorridor._lastHalfX : CORRIDOR_NARROW_X;

  ['left','right'].forEach(k => {
    const side   = k === 'left' ? -1 : 1;
    const edgeX  = gapCenter + gapHalfX * side;
    const meshes = _canyonWalls[k];

    meshes.forEach(m => {
      m.position.z += scroll;

      // Recycle: chunk scrolled past ship → teleport to back of queue
      if (m.position.z > DESPAWN_Z + spacing) {
        let minZ = Infinity;
        for (const om of meshes) if (om !== m && om.position.z < minZ) minZ = om.position.z;
        m.position.z = minZ - spacing;
        m.position.x = edgeX; // snap X on recycle
      } else {
        // Smooth lateral tracking while in view
        m.position.x += (edgeX - m.position.x) * Math.min(1, T.snapRate * dt);
      }
    });
  });

  // Collision
  if (state._jetLightningMode && state.phase === 'playing' && !state._godMode && !_godMode) {
    const shipX  = state.shipX || 0;
    const buffer = 1.5;
    const gapC   = state.corridorGapCenter || 0;
    const gapH   = (_jlCorridor && _jlCorridor._lastHalfX != null)
      ? _jlCorridor._lastHalfX : CORRIDOR_NARROW_X;
    if (shipX < gapC - gapH + buffer || shipX > gapC + gapH - buffer) {
      if (typeof _killPlayer === 'function') _killPlayer();
      else if (typeof triggerDeath === 'function') triggerDeath();
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
  const bodyGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.14, 32);
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

function createPowerupMesh(typeIdx) {
  const def = POWERUP_TYPES[typeIdx];
  const group = new THREE.Group();

  const mat = new THREE.MeshStandardMaterial({
    color: def.color, emissive: def.color, emissiveIntensity: 1.2,
    metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.9,
  });

  let geo;
  if (def.shape === 'oct')    geo = new THREE.OctahedronGeometry(0.8);
  else if (def.shape === 'torus')  geo = new THREE.TorusGeometry(0.7, 0.25, 8, 16);
  else if (def.shape === 'star')   geo = new THREE.OctahedronGeometry(0.8);
  else if (def.shape === 'ring')   geo = new THREE.TorusGeometry(0.8, 0.15, 8, 24);
  else                             geo = new THREE.SphereGeometry(0.7, 12, 12);

  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);

  // Glow ring around powerup
  const ringGeo = new THREE.TorusGeometry(1.1, 0.06, 6, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.5 });
  group.add(new THREE.Mesh(ringGeo, ringMat));

  group.userData.typeIdx       = typeIdx;
  group.userData.active         = false;
  group.userData.currentShape   = def.shape;  // track current geometry shape
  group.visible                 = false;
  group.position.set(0, -9999, 0);  // park off-screen on creation
  scene.add(group);
  return group;
}

for (let i = 0; i < POWERUP_POOL_SIZE; i++) {
  powerupPool.push(createPowerupMesh(i % POWERUP_TYPES.length));
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
  _ensureCtxRunning();
  _magnetWhirGain = audioCtx.createGain();
  _magnetWhirGain.gain.setValueAtTime(0, audioCtx.currentTime);
  _magnetWhirGain.gain.linearRampToValueAtTime(0.055, audioCtx.currentTime + 0.35);
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
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}
function _initSFXBuffers() {
  if (!audioCtx) return;
  _loadSFXBuffer('nearmiss', './nearmiss.mp3');
  _loadSFXBuffer('whoosh', './whoosh2.mp3');
  _loadSFXBuffer('whoosh-release', './whoosh-release.mp3');
}
// SFX element fallback map — used when AudioBuffer hasn't decoded yet
const _sfxFallbackIds = { 'nearmiss': 'nearmiss-sfx', 'whoosh': 'whoosh1', 'whoosh-release': 'whoosh-release' };
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
  const vol = 0.06 + intensity * 0.14;
  const pan = direction * (0.3 + intensity * 0.4);
  _playBuffer('whoosh', vol, rate, pan);
}

function playWhooshRelease(direction, holdTime) {
  if (state.muted) return;
  const intensity = Math.min(1, (holdTime - 1.5) / 1.5);
  const rate = 0.90 + Math.random() * 0.15 + intensity * 0.1;
  const vol = 0.08 + intensity * 0.18;
  const pan = direction * (0.2 + intensity * 0.3);
  _playBuffer('whoosh-release', vol, rate, pan);
}

function playLevelUp() {
  if (!audioCtx || state.muted) return;
  [440, 550, 660, 880].forEach((f, i) => {
    setTimeout(() => playSFX(f, 0.25, 'triangle', 0.25), i * 80);
  });
}

function playCrash() {
  if (state.muted) return;
  _ensureCtxRunning();
  const sfx = document.getElementById('crash-sound');
  if (sfx) { sfx.currentTime = 0; sfx.volume = 0.25; sfx.play().catch(() => {}); }
}


// ── Retry sweep whoosh: filtered noise with rising frequency sweep ──
function playRetryWhoosh() {
  if (!audioCtx || state.muted) return;
  _ensureCtxRunning();
  const vol = 0.18 * (typeof sfxMult === 'function' ? sfxMult() : 1);
  if (vol <= 0) return;
  const dur = 1.3; // match sweep duration
  const now = audioCtx.currentTime;
  // White noise buffer
  const bufLen = audioCtx.sampleRate * dur;
  const noiseBuf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf;
  // Bandpass filter: sweep low → high for rising whoosh
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(200, now);
  filter.frequency.exponentialRampToValueAtTime(3500, now + dur * 0.85);
  filter.frequency.exponentialRampToValueAtTime(1800, now + dur);
  // Volume envelope: swell up then taper
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(vol, now + dur * 0.6);
  gain.gain.linearRampToValueAtTime(vol * 1.3, now + dur * 0.85);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(filter).connect(gain).connect(audioCtx.destination);
  src.start(now);
  src.stop(now + dur);
}

// ── Lightning strike: buzzy arc + deep boom two-layer SFX ──
function _playLightningStrike() {
  if (!audioCtx || state.muted) return;
  _ensureCtxRunning();
  const vol = 0.22 * (typeof sfxMult === 'function' ? sfxMult() : 1);
  if (vol <= 0) return;
  const now = audioCtx.currentTime;

  // ── Deep boom ──
  const boom = audioCtx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(55, now);
  boom.frequency.exponentialRampToValueAtTime(28, now + 0.9);
  // Sub triangle layer for extra body
  const sub = audioCtx.createOscillator();
  sub.type = 'triangle';
  sub.frequency.setValueAtTime(38, now);
  sub.frequency.exponentialRampToValueAtTime(18, now + 1.1);
  const boomGain = audioCtx.createGain();
  boomGain.gain.setValueAtTime(0.001, now);
  boomGain.gain.linearRampToValueAtTime(vol * 0.9, now + 0.04); // fast attack
  boomGain.gain.exponentialRampToValueAtTime(vol * 0.4, now + 0.3);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
  boom.connect(boomGain).connect(audioCtx.destination);
  sub.connect(boomGain);
  boom.start(now); boom.stop(now + 1.1);
  sub.start(now);  sub.stop(now + 1.1);
}

function _playAsteroidImpact() {
  // Same boom as lightning but quieter (0.07 vs 0.22)
  if (!audioCtx || state.muted) return;
  _ensureCtxRunning();
  const vol = 0.07 * (typeof sfxMult === 'function' ? sfxMult() : 1);
  if (vol <= 0) return;
  const now = audioCtx.currentTime;
  const boom = audioCtx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(55, now);
  boom.frequency.exponentialRampToValueAtTime(28, now + 0.9);
  const sub = audioCtx.createOscillator();
  sub.type = 'triangle';
  sub.frequency.setValueAtTime(38, now);
  sub.frequency.exponentialRampToValueAtTime(18, now + 1.1);
  const boomGain = audioCtx.createGain();
  boomGain.gain.setValueAtTime(0.001, now);
  boomGain.gain.linearRampToValueAtTime(vol * 0.9, now + 0.04);
  boomGain.gain.exponentialRampToValueAtTime(vol * 0.4, now + 0.3);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
  boom.connect(boomGain).connect(audioCtx.destination);
  sub.connect(boomGain);
  boom.start(now); boom.stop(now + 1.1);
  sub.start(now);  sub.stop(now + 1.1);
}

function playPickup(typeIdx) {
  if (!audioCtx || state.muted) return;
  const freqs = [880, 1100, 660, 990, 770, 660];
  playSFX(freqs[typeIdx] || 880, 0.2, 'sine', 0.45);
  setTimeout(() => playSFX((freqs[typeIdx] || 880) * 1.25, 0.15, 'sine', 0.35), 80);
}

// ═══════════════════════════════════════════════════
//  GRID / ENVIRONMENT ANIMATION
// ═══════════════════════════════════════════════════
let gridOffset = 0;

function scrollGrid(dt) {
  gridOffset += state.speed * dt;
  // Drive shader offsets so tiles scroll forward & follow ship laterally
  floorMat.uniforms.uOffsetZ.value = gridOffset;
  floorMat.uniforms.uOffsetX.value = state.shipX;
  // Keep the floor plane centered on the ship so it's always under the camera
  floorMesh.position.x = state.shipX;
  // Mirror floor scrolls in sync
  // mirrorMat no longer needs scroll offsets — it samples reflectRT in screen-space
  mirrorMesh.position.x = state.shipX;
}

// ═══════════════════════════════════════════════════
//  LEVEL TRANSITION
// ═══════════════════════════════════════════════════
let currentLevelDef = LEVELS[0];
let targetLevelDef  = LEVELS[0];
let transitionT     = 1.0; // 0 = start, 1 = done


// Crossfade bgMusic → l3Music over `duration` seconds
function crossfadeToL3(duration) { musicFadeTo('l3', duration * 1000); }
function crossfadeToL4(duration) { musicFadeTo('l4', duration * 1000); }
function applyLevelVisuals(def) {
  skyMat.uniforms.topColor.value.copy(def.skyTop);
  skyMat.uniforms.botColor.value.copy(def.skyBot);
  scene.fog.color.copy(def.fogColor);
  bloom.strength = def.bloomStrength;
  updateGridColor(def.gridColor);
  const pidx = LEVELS.indexOf(def);
  const pal = FLOOR_PALETTES[Math.min(pidx, FLOOR_PALETTES.length - 1)];
  updateFloorPalette(null, null, pal.line);
  // Galaxy tint follows level grid color
  targetNebulaTint.copy(def.gridColor);  // set nebula tint for this level
  // Update sun color for this level
  updateSunColor(def.sunColor, LEVELS.indexOf(def));
  // Per-level thruster color (distinct palette, not just gridColor)
  const tidx = LEVELS.indexOf(def);
  updateThrusterColor(THRUSTER_COLORS[Math.min(tidx, THRUSTER_COLORS.length - 1)]);

  l5DustPoints.visible = false;  // only re-enabled by 2nd zipper / key6
}

function transitionToLevel(def) {
  targetLevelDef = def;
  transitionT    = 0;
}

function updateTransition(dt) {
  if (transitionT >= 1) return;
  transitionT = Math.min(1, transitionT + dt * 1.2);
  const t = transitionT;

  skyMat.uniforms.topColor.value.lerpColors(currentLevelDef.skyTop, targetLevelDef.skyTop, t);
  skyMat.uniforms.botColor.value.lerpColors(currentLevelDef.skyBot, targetLevelDef.skyBot, t);
  scene.fog.color.lerpColors(currentLevelDef.fogColor, targetLevelDef.fogColor, t);

  const gridLerp = new THREE.Color().lerpColors(currentLevelDef.gridColor, targetLevelDef.gridColor, t);
  updateGridColor(gridLerp);
  // Lerp floor palette
  const ci = LEVELS.indexOf(currentLevelDef);
  const ti = LEVELS.indexOf(targetLevelDef);
  const cp = FLOOR_PALETTES[Math.min(ci, FLOOR_PALETTES.length - 1)];
  const tp = FLOOR_PALETTES[Math.min(ti, FLOOR_PALETTES.length - 1)];
  floorMat.uniforms.uLineColor.value.lerpColors(cp.line, tp.line, t);
  mirrorMat.uniforms.uLineColor.value.lerpColors(cp.line, tp.line, t);

  // Galaxy tint lerps between level grid colors
  const gTint = new THREE.Color().lerpColors(currentLevelDef.gridColor, targetLevelDef.gridColor, t);
  targetNebulaTint.copy(gTint);  // set nebula tint for transition

  // Sun color lerp — smooth continuous blend including shader branch weights
  const sunLerped = new THREE.Color().lerpColors(currentLevelDef.sunColor, targetLevelDef.sunColor, t);
  const ci3 = LEVELS.indexOf(currentLevelDef);
  const ti3 = LEVELS.indexOf(targetLevelDef);
  // UV weight: 1 at L2, 0 elsewhere.
  const uvFrom  = (ci3 === 1) ? 1.0 : 0.0;
  const uvTo    = (ti3 === 1) ? 1.0 : 0.0;
  // Ice weight: 1 at L4, 0 elsewhere.
  const iceFrom = (ci3 === 3) ? 1.0 : 0.0;
  const iceTo   = (ti3 === 3) ? 1.0 : 0.0;
  // Gold weight: 1 at L5, 0 elsewhere.
  const goldFrom = (ci3 === 4) ? 1.0 : 0.0;
  const goldTo   = (ti3 === 4) ? 1.0 : 0.0;
  // L3 weight: 1 at L3, 0 elsewhere.
  const l3From = (ci3 === 2) ? 1.0 : 0.0;
  const l3To   = (ti3 === 2) ? 1.0 : 0.0;
  updateSunColor(sunLerped, -1); // -1 = don't snap uniforms — we set them manually below
  sunMat.uniforms.uIsUV.value   = uvFrom   + (uvTo   - uvFrom)   * t;
  sunMat.uniforms.uIsL3.value   = l3From   + (l3To   - l3From)   * t;
  sunMat.uniforms.uIsIce.value  = iceFrom  + (iceTo  - iceFrom)  * t;
  sunMat.uniforms.uIsGold.value = goldFrom + (goldTo - goldFrom) * t;
  sunCapMat.uniforms.uIsUV.value   = sunMat.uniforms.uIsUV.value;
  sunCapMat.uniforms.uIsL3.value   = sunMat.uniforms.uIsL3.value;
  sunCapMat.uniforms.uIsL3Warp.value = sunMat.uniforms.uIsL3Warp.value;
  sunCapMat.uniforms.uIsIce.value  = sunMat.uniforms.uIsIce.value;
  sunCapMat.uniforms.uIsGold.value = sunMat.uniforms.uIsGold.value;
  sunCapMat.uniforms.uWarpCol1.value.copy(sunMat.uniforms.uWarpCol1.value);
  sunCapMat.uniforms.uWarpCol2.value.copy(sunMat.uniforms.uWarpCol2.value);
  sunCapMat.uniforms.uWarpCol3.value.copy(sunMat.uniforms.uWarpCol3.value);

  // Thruster color lerp
  const ci2 = LEVELS.indexOf(currentLevelDef);
  const ti2 = LEVELS.indexOf(targetLevelDef);
  const tc = THRUSTER_COLORS[Math.min(ci2, THRUSTER_COLORS.length - 1)];
  const tt = THRUSTER_COLORS[Math.min(ti2, THRUSTER_COLORS.length - 1)];
  thrusterColor.lerpColors(tc, tt, t);

  bloom.strength = currentLevelDef.bloomStrength + (targetLevelDef.bloomStrength - currentLevelDef.bloomStrength) * t;

  if (transitionT >= 1) currentLevelDef = targetLevelDef;
}

// ═══════════════════════════════════════════════════
//  SPAWN LOGIC
// ═══════════════════════════════════════════════════
function getPooledObstacle(type) {
  for (const o of obstaclePool) {
    if (!o.userData.active) {
      o.userData.active = true;
      o.userData.type   = type;
      o.visible         = true;
      // Reset opacity to 0 so the cone fades in from the horizon (no pop-in)
      const _mc = o.userData._meshes;
      for (let mi = 0; mi < _mc.length; mi++) {
        const child = _mc[mi];
        if (child.material.uniforms && child.material.uniforms.uOpacity) {
          child.material.uniforms.uOpacity.value = 0.0;
          child.material.transparent = true;
          child.material.depthWrite = false;
          child.material.needsUpdate = true;
        } else if (child.material.opacity !== undefined) {
          child.material.opacity = 0.0;
          child.material.transparent = true;
          child.material.needsUpdate = true;
        }
      }
      return o;
    }
  }
  return null;
}

function makeGeoForShape(shape) {
  if (shape === 'oct')   return new THREE.OctahedronGeometry(0.8);
  if (shape === 'torus') return new THREE.TorusGeometry(0.7, 0.25, 8, 16);
  if (shape === 'ring')  return new THREE.TorusGeometry(0.8, 0.15, 8, 24);
  return new THREE.SphereGeometry(0.7, 12, 12); // magnet / default
}

function getPooledPowerup(typeIdx) {
  for (const p of powerupPool) {
    if (!p.userData.active) {
      p.userData.active  = true;
      p.userData.typeIdx = typeIdx;
      p.visible          = true;
      const def      = POWERUP_TYPES[typeIdx];
      const c        = new THREE.Color(def.color);
      const bodyMesh = p.children[0];
      const ringMesh = p.children[1];
      // Swap geometry if shape changed (avoids wrong-shape artifacts)
      if (bodyMesh) {
        const needShape = def.shape;
        if (p.userData.currentShape !== needShape) {
          bodyMesh.geometry.dispose();
          bodyMesh.geometry = makeGeoForShape(needShape);
          p.userData.currentShape = needShape;
        }
        bodyMesh.material.color.copy(c);
        bodyMesh.material.emissive.copy(c);
        bodyMesh.material.needsUpdate = true;
      }
      if (ringMesh && ringMesh.material) {
        ringMesh.material.color.copy(c);
        ringMesh.material.needsUpdate = true;
      }
      return p;
    }
  }
  return null;
}

let framesSinceLastPowerup = 0;
const powerupSpawnRate = 2.2; // max rate (slider removed)

// ─── GAUNTLET CONFIG ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════
//  FUNNEL / CORRIDOR SYSTEM (L3+)
//
//  Two parallel walls of cones run front-to-back like a highway.
//  They start far apart (wide open), squeeze inward to a tight corridor,
//  hold for a stretch, then spread back out — just like the original.
//
//  Each spawn tick places ONE cone on the LEFT wall and ONE on the RIGHT wall
//  at SPAWN_Z — so they form continuous lines you fly between, not flat rows.
// ═══════════════════════════════════════════════════
const FUNNEL_LEVELS        = new Set([]);  // disabled — no levels use the gauntlet funnel burst
const FUNNEL_COOLDOWN_ROWS = 22;
const FUNNEL_CLOSE_ROWS    = 10;  // rows while walls squeeze inward
const FUNNEL_HOLD_ROWS     = 12;  // rows of tight corridor
const FUNNEL_OPEN_ROWS     = 8;   // rows while walls spread outward
const FUNNEL_TOTAL_ROWS    = FUNNEL_CLOSE_ROWS + FUNNEL_HOLD_ROWS + FUNNEL_OPEN_ROWS;
const FUNNEL_WIDE_X        = 24;  // world units — wall half-offset at fully open
const FUNNEL_NARROW_X      = 5.5; // world units — wall half-offset at tightest

function maybeStartGauntlet() {
  // Death Run: no corridors/gauntlets — random cones only
  if (state.isDeathRun) return;
  // L3: always-on dense corridor — activate immediately and loop forever
  if (state.currentLevelIdx === 2) {
    if (!state.corridorMode) {
      state.corridorMode      = true;
      state.corridorSpawnZ    = -7;
      state.corridorRowsDone  = 0;
      state.corridorGapCenter = 0;
      state.corridorGapDir    = 1;
      state.corridorDelay     = 2.0;  // 2-second clear gap before first cone spawns
      // Clear all existing obstacles so entry isn't blocked
      ;[...activeObstacles].forEach(returnObstacleToPool);
      activeObstacles.length = 0;
  [..._activeForcefields].forEach(returnForcefieldToPool);
  _activeForcefields.length = 0;
    }
    return;
  }
  state.corridorMode = false;
  if (state.gauntletActive) return;
  if (!FUNNEL_LEVELS.has(state.currentLevelIdx)) return;
  if (state.gauntletCooldown > 0) { state.gauntletCooldown--; return; }
  if (Math.random() < 0.22) {
    state.gauntletActive   = true;
    state.gauntletRowsLeft = FUNNEL_TOTAL_ROWS;
    state.gauntletCooldown = 0;
  }
}

function spawnGauntletRow() {
  const rowsDone = FUNNEL_TOTAL_ROWS - state.gauntletRowsLeft;

  // Compute wall half-offset (world units from ship center) based on phase
  let halfX;
  if (rowsDone < FUNNEL_CLOSE_ROWS) {
    const t = rowsDone / FUNNEL_CLOSE_ROWS;
    // ease-in so the closing feels dramatic
    halfX = FUNNEL_WIDE_X + (FUNNEL_NARROW_X - FUNNEL_WIDE_X) * (t * t);
  } else if (rowsDone < FUNNEL_CLOSE_ROWS + FUNNEL_HOLD_ROWS) {
    halfX = FUNNEL_NARROW_X;
  } else {
    const t = (rowsDone - FUNNEL_CLOSE_ROWS - FUNNEL_HOLD_ROWS) / FUNNEL_OPEN_ROWS;
    halfX = FUNNEL_NARROW_X + (FUNNEL_WIDE_X - FUNNEL_NARROW_X) * t;
  }

  // Place 1-2 cones on each wall per tick for density
  const wallJitter = 0.8;  // slight random offset so walls don’t look perfectly straight
  for (let side = -1; side <= 1; side += 2) {
    // Primary wall cone — tinted electric cyan so they stand out from level scenery
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      const wx = state.shipX + side * halfX + (Math.random() - 0.5) * wallJitter;
      obs.position.set(wx, 0, SPAWN_Z);
      obs.userData.velX = 0;
      tintObsColor(obs, 0x00ffcc);  // electric cyan — pops against crimson/orange L3 palette
      obs.userData.isCorridor = true;  // immune to laser
      activeObstacles.push(obs);
    }
    // Second cone slightly offset in X to thicken the wall
    const obs2 = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs2) {
      const wx2 = state.shipX + side * (halfX + LANE_WIDTH) + (Math.random() - 0.5) * wallJitter;
      obs2.position.set(wx2, 0, SPAWN_Z);
      obs2.userData.velX = 0;
      tintObsColor(obs2, 0x00ffcc);
      obs2.userData.isCorridor = true;
      activeObstacles.push(obs2);
    }
  }

  state.gauntletRowsLeft--;
  if (state.gauntletRowsLeft <= 0) {
    state.gauntletActive   = false;
    state.gauntletCooldown = FUNNEL_COOLDOWN_ROWS;
  }
}

// ─── L3 CORRIDOR CONSTANTS ───────────────────────────────────────────
const CORRIDOR_WIDE_X    = 80;   // wider than the entire play field — walls span full screen at entry
const CORRIDOR_NARROW_X  = 9;    // tunnel half-width — tight enough to require perpendicular x-wing
const CORRIDOR_CLOSE_ROWS = 40;  // rows to show full funnel squeeze
const CORRIDOR_HOLD_ROWS  = 999; // effectively infinite — we loop via corridorSineT
const CORRIDOR_TOTAL_ROWS = CORRIDOR_CLOSE_ROWS + CORRIDOR_HOLD_ROWS;
const CORRIDOR_STRAIGHT_ROWS = 4;  // brief straight before bends begin (was 12)

const CORRIDOR_AMP_START  = 10;  // initial swing — gentle intro curves
const CORRIDOR_AMP_MAX    = 36;  // max swing — spicy but survivable
const CORRIDOR_AMP_RAMP   = 200; // rows to reach max amplitude (campaign value)
const CORRIDOR_PERIOD_START = 200; // very long lazy arcs at the start
const CORRIDOR_PERIOD_MIN   = 150; // even at max difficulty, each curve is a long sweep
const CORRIDOR_PERIOD_RAMP  = 300; // slow ramp so tightening is barely noticeable

// ─── L4 CORRIDOR CONSTANTS ───────────────────────────────────────────
const L4_CORRIDOR_NARROW_X   = 6;    // tight entry — squeezes further to 3 at peak
const L4_CORRIDOR_CLOSE_ROWS = 35;   // rows to squeeze in
const L4_CORRIDOR_STRAIGHT   = 10;   // straight rows before curves
const L4_CORRIDOR_AMP_START  = 14;
const L4_CORRIDOR_AMP_MAX    = 44;   // deeper banks than L3
const L4_CORRIDOR_AMP_RAMP   = 120;  // ramps up faster
const L4_CORRIDOR_PERIOD_START = 220; // long lazy arcs at entry
const L4_CORRIDOR_PERIOD_MIN   = 160; // still a long sweep even at peak
const L4_CORRIDOR_PERIOD_RAMP  = 260;
const L4_CORRIDOR_TINT       = 0xff00aa; // hot magenta

// ─── L5 ZIPPER CONSTANTS ─────────────────────────────────────────────
const ZIPPER_ROWS        = 13;   // rows per zipper burst — last 2 rows have wider exit gap
const ZIPPER_COOLDOWN    = 30;   // rows of normal play between zippers
const ZIPPER_GAP_HALF    = 7.5;  // half-width of the open gate — wider so first row from center is passable
const ZIPPER_OFFSET      = 11;   // gate offset — forces a committed move without being punishing over 13 rows
const ZIPPER_TINT        = 0xffcc00; // gold — matches L5 grid color
const L4_CORRIDOR_TRIGGER_S  = 22;   // seconds into L4 before corridor starts
const L4_CORRIDOR_DURATION_S = 50;   // longer run — nearly a minute of corridor

// ─── L5 SINE CORRIDOR CONSTANTS ──────────────────────────────────────
const L5C_CLOSE_ROWS      = 29;   // ~203 world-units of gradual squeeze (29 × 7)
const L5C_WIDE_X          = 48;   // walls visible as they close — not off-screen
const L5C_NARROW_X        = 10;   // final tunnel half-width — wider than L3 (9) since L5 speed is higher
const L5C_STRAIGHT_ROWS   = 12;   // straight rows after squeeze before sine kicks in
const L5C_TOTAL_ROWS      = 420;  // full corridor duration
const L5C_EXIT_ROWS       = 20;   // last N rows widen back out
const L5C_TINT            = 0xffcc00; // gold
const L5C_AMP_START       = 10;   // gentle intro swing
const L5C_AMP_MAX         = 40;   // deeper than L3 (36) — harder sweep
const L5C_AMP_RAMP        = 180;  // rows to reach max amp
const L5C_PERIOD_START    = 200;  // long lazy arcs at entry
const L5C_PERIOD_MIN      = 140;  // faster than L3 (150) at peak
const L5C_PERIOD_RAMP     = 280;
const L5C_CENTER_CONE_INTERVAL = 12;  // spawn a center hazard cone every N rows (after squeeze+straight)

// ─── PHYSICS-DRIVEN CORRIDOR (Death Run) ─────────────────────────────
// Gap position is driven by ship reachability physics instead of fixed sine waves.
// The gap has a target velocity that it smoothly tracks. Direction reverses
// periodically, creating S-curves bounded by what the ship can physically follow.
//
// Difficulty (0-1) = fraction of ship MAX_VEL the gap moves at.
// halfGap = half-width of the corridor opening.



const _drCorridorState = { gapX: 0, gapVelX: 0, targetVelX: 0, sweepTimer: 0 };
const DR_CORRIDOR_HALF_GAP = 5;       // total gap = 10 units
const DR_CORRIDOR_MAX_WANDER = 28;    // max gap distance from center
const DR_CORRIDOR_VEL_LERP = 3.5;     // how fast gap vel tracks target (higher = sharper turns)
// Difficulty per speed tier: T0=easy curves, T3=demanding
const DR_CORRIDOR_DIFF = [0.55, 0.65, 0.72, 0.80];

function _drResetCorridorState() {
  _drCorridorState.gapX = state.shipX;
  _drCorridorState.gapVelX = 0;
  _drCorridorState.targetVelX = 0;
  _drCorridorState.sweepTimer = 0;
}

// Returns the gap center X for the next corridor row in death run.
function _drNextGapCenter(diffOverride) {
  const tier = (state.deathRunSpeedTier || 0);
  const physIdx = Math.min(tier + 1, 4);
  const _lvlT = physIdx / (LEVELS.length - 1);
  const _snap = _lvlT * _lvlT;
  const maxVel = 9 + _snap * 13;
  const fwdSpeed = state.speed || (BASE_SPEED * LEVELS[physIdx].speedMult);
  const tRow = 7 / fwdSpeed; // time between rows

  const diff = diffOverride != null ? diffOverride : DR_CORRIDOR_DIFF[Math.min(tier, 3)];
  const gapMaxSpeed = maxVel * diff;
  const cs = _drCorridorState;

  // Sweep timer: pick a new target direction when it expires
  cs.sweepTimer -= tRow;
  if (cs.sweepTimer <= 0) {
    const minDur = 0.4;
    const maxDur = 2.0 - diff * 0.8;
    cs.sweepTimer = minDur + Math.random() * (maxDur - minDur);
    const spd = gapMaxSpeed * (0.5 + Math.random() * 0.5);

    if (Math.abs(cs.gapX - state.shipX) > DR_CORRIDOR_MAX_WANDER * 0.7) {
      // Too far from ship — push back
      cs.targetVelX = -Math.sign(cs.gapX - state.shipX) * spd;
    } else {
      // Zigzag: usually reverse, occasionally sustain
      const zig = cs.gapVelX > 0 ? -1 : 1;
      if (Math.random() < 0.7) {
        cs.targetVelX = zig * spd;
      } else {
        cs.targetVelX = -zig * spd;
        cs.sweepTimer *= 1.5; // extend sustained sweeps
      }
    }
  }

  // Smooth velocity toward target
  cs.gapVelX += (cs.targetVelX - cs.gapVelX) * Math.min(1, DR_CORRIDOR_VEL_LERP * tRow);
  cs.gapVelX = Math.max(-gapMaxSpeed, Math.min(gapMaxSpeed, cs.gapVelX));
  cs.gapX += cs.gapVelX * tRow;

  // Push gap away from ship if it gets too close — forces player to always dodge
  const _minGapFromShip = 14;
  if (Math.abs(cs.gapX - state.shipX) < _minGapFromShip) {
    const _pushDir = cs.gapVelX >= 0 ? 1 : -1;
    cs.gapX = state.shipX + _pushDir * _minGapFromShip;
    cs.targetVelX = _pushDir * gapMaxSpeed;
    cs.sweepTimer = 0;
  }

  // Boundary clamp
  const absFromShipStart = Math.abs(cs.gapX);
  if (absFromShipStart > DR_CORRIDOR_MAX_WANDER) {
    cs.gapX = Math.sign(cs.gapX) * DR_CORRIDOR_MAX_WANDER;
    cs.gapVelX *= -0.5;
    cs.targetVelX = -Math.sign(cs.gapX) * gapMaxSpeed;
    cs.sweepTimer = 0.5;
  }

  return cs.gapX;
}

// ─── FORCEFIELD GATE (Slalom) ────────────────────────────────────────
// Animated energy barrier stretched between two slalom cones.
// Custom ShaderMaterial: hex scanline + Fresnel edge glow + ripple.

const FORCEFIELD_POOL_SIZE = 20;
const _ffPool = [];
const _activeForcefields = [];

const _ffUniforms = { uTime: { value: 0.0 } };

const _ffVertShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const _ffFragShader = `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    // Fresnel — edges brighter
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel = pow(fresnel, 1.8);

    // Center-heavy opacity: strongest in the middle of the plane
    float centerX = 1.0 - 2.0 * abs(vUv.x - 0.5); // 1 at center, 0 at edges
    float centerY = 1.0 - 2.0 * abs(vUv.y - 0.5);
    float center = centerX * centerY;
    center = pow(center, 0.6); // soften falloff

    // Subtle slow shimmer
    float shimmer = 0.9 + 0.1 * sin(vUv.y * 6.0 - uTime * 3.0);

    // Alpha: opaque center, fading to edges
    float alpha = (0.3 + center * 0.55) * shimmer;
    alpha += fresnel * 0.15;
    alpha = clamp(alpha, 0.15, 0.8);

    // Clean blue gradient: deep center, lighter edges
    vec3 deepBlue  = vec3(0.05, 0.2, 0.8);
    vec3 brightBlue = vec3(0.2, 0.55, 1.0);
    vec3 col = mix(brightBlue, deepBlue, center);
    col += vec3(0.15, 0.3, 0.5) * fresnel; // edge highlight
    col *= shimmer;
    col *= 1.5; // slight HDR for bloom

    gl_FragColor = vec4(col, alpha);
  }
`;

function createForcefieldMesh() {
  const geo = new THREE.PlaneGeometry(1, 4, 1, 8); // width=1 (scaled per gap), height=4
  const mat = new THREE.ShaderMaterial({
    uniforms: _ffUniforms,
    vertexShader: _ffVertShader,
    fragmentShader: _ffFragShader,
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.active = false;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

for (let i = 0; i < FORCEFIELD_POOL_SIZE; i++) _ffPool.push(createForcefieldMesh());

function returnForcefieldToPool(ff) {
  ff.userData.active = false;
  ff.visible = false;
  ff.scale.set(1, 1, 1);
}

// ─── SLALOM MINEFIELD (Death Run) ────────────────────────────────────
// Slalom minefield: uniform staggered grid of cones — no carved gap.
// Even rows: cones at 0, ±S, ±2S, …  Odd rows offset by S/2 (brick pattern).
// Ship must weave through the grid openings. Spacing tuned so ship always fits.

const SLALOM_SPACING    = 30.0;         // lateral distance between cones
const SLALOM_FIELD_HALF = 90;           // cone field spans ±90
const SLALOM_Z_SPACING  = 60;           // z-distance between rows
const SLALOM_TINT       = 0xff44aa;     // hot pink — distinct from corridor colors

// Closing doors pattern: two fat walls with a gap that shifts position each row.
// Gap is ~8 units wide (ship is 3), position moves left/right/center randomly.
// Forcefield spans one side, coins sit in the gap to reward threading the needle.

const SLALOM_GAP_WIDTH = 8;       // gap the player must fly through
const SLALOM_WALL_HALF = 500;     // total wall span ±500

function spawnSlalomRow() {
  const row = state.slalomRowsDone;

  let gapCenter;
  if (state.slalomUsePhysicsCurve) {
    // Physics-based curving gap — uses _drNextGapCenter for smooth sweeps
    gapCenter = _drNextGapCenter(0.7);
  } else {
    // Random lane pick — never repeat the same twice
    const laneOptions = [-18, -9, 0, 9, 18];
    if (state._lastSlalomGap === undefined) state._lastSlalomGap = -999;
    do {
      gapCenter = laneOptions[Math.floor(Math.random() * laneOptions.length)];
    } while (gapCenter === state._lastSlalomGap);
    state._lastSlalomGap = gapCenter;
  }

  const _sgw = state._slalomGapWidth || SLALOM_GAP_WIDTH;
  const gapLeft  = gapCenter - _sgw * 0.5;
  const gapRight = gapCenter + _sgw * 0.5;

  // Left wall: cones from -WALL_HALF to gapLeft (skip ~30% for random gaps)
  const coneScale = 4;
  for (let x = -SLALOM_WALL_HALF; x < gapLeft - 1; x += 10) {
    if (Math.random() < 0.3) continue; // random gap
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      obs.position.set(x, 0, SPAWN_Z);
      obs.scale.set(coneScale, 1, coneScale);
      obs.userData.velX = 0;
      obs.userData.isCorridor = false; // lasers CAN destroy slalom cones
      obs.userData.slalomScaled = true;
      tintObsColor(obs, SLALOM_TINT);
      activeObstacles.push(obs);
    }
  }

  // Right wall: cones from gapRight to +WALL_HALF (skip ~30% for random gaps)
  for (let x = gapRight + 1; x <= SLALOM_WALL_HALF; x += 10) {
    if (Math.random() < 0.3) continue; // random gap
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      obs.position.set(x, 0, SPAWN_Z);
      obs.scale.set(coneScale, 1, coneScale);
      obs.userData.velX = 0;
      obs.userData.isCorridor = false; // lasers CAN destroy slalom cones
      obs.userData.slalomScaled = true;
      tintObsColor(obs, SLALOM_TINT);
      activeObstacles.push(obs);
    }
  }

  // Coins in the gap — reward threading the needle
  const coinCount = 3;
  for (let i = 0; i < coinCount; i++) {
    const coin = getPooledCoin();
    if (coin) {
      const cx = gapLeft + (i + 1) * (_sgw / (coinCount + 1));
      coin.position.set(cx, 1.2, SPAWN_Z);
      coin.userData.spinPhase = Math.random() * Math.PI * 2;
      activeCoins.push(coin);
    }
  }

  state.slalomRowsDone++;
}



// ── Custom pattern from level editor ──
const DR_CUSTOM_PATTERN_1 = [
[5,7,9,11,13,15,17,19,21,23],
[5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[],
[],
[],
[],
[],
[],
[5,7,9,11,13,15,17,19,21,23],
[5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[],
[],
[],
[],
[],
[],
[5,7,9,11,13,15,17,19,21,23],
[5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[],
[],
[],
[],
[],
[],
[5,7,9,11,13,15,17,19,21,23],
[5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[],
[],
[],
[],
[],
[],
[-5,-4,-3,-2,-1,2,3,4,5,7,9,11,13,15,17,19,21,23],
[-5,-4,-3,-2,-1,2,3,4,5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5,-2,-1,0,1],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5,-2,-1,0,1],
[],
[],
[],
[],
[],
[],
[2,3,4,5,7,9,11,13,15,17,19,21,23],
[2,3,4,5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5,-3,-2,-1,0],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5,-3],
[],
[],
[],
[],
[],
[],
[0,1,2,3,4,5,7,9,11,13,15,17,19,21,23],
[0,1,2,3,4,5,7,9,11,13,15,17,19,21,23],
[],
[],
[],
[],
[],
[40],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5],
[-23,-21,-19,-17,-15,-13,-11,-9,-7,-5]
];

function spawnCustomPatternRow() {
  const rowIdx = state.drCustomPatternRow;
  if (rowIdx >= DR_CUSTOM_PATTERN_1.length) {
    state.drCustomPatternActive = false;
    // Wave director handles rest/transition in its phase tick
    return;
  }
  const xPositions = DR_CUSTOM_PATTERN_1[rowIdx];
  const offsetX = state.shipX; // center pattern on player
  const xScale = 3; // widen spacing between all cones
  for (let i = 0; i < xPositions.length; i++) {
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (!obs) continue;
    obs.position.set(xPositions[i] * xScale + offsetX + (Math.random() - 0.5) * 0.5, 0, SPAWN_Z);
    obs.userData.velX = 0;
    obs.userData.isCorridor = true;
    tintObsColor(obs, 0xff1a8c);
    activeObstacles.push(obs);
  }
  state.drCustomPatternRow++;
}

function spawnL5CorridorRow() {
  const rowsDone = state.l5CorridorRowsDone;
  const maxRows = state._drL5MaxRows || L5C_TOTAL_ROWS;
  const exitRows = L5C_EXIT_ROWS; // 20 rows

  // Squeeze phase: walls close in from ±48 to ±L5C_NARROW_X over L5C_CLOSE_ROWS
  let halfX;
  if (rowsDone < L5C_CLOSE_ROWS) {
    const t = rowsDone / L5C_CLOSE_ROWS;
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    halfX = L5C_WIDE_X + (L5C_NARROW_X - L5C_WIDE_X) * ease;
  } else {
    const curveRowsForSqueeze = Math.max(0, rowsDone - (L5C_CLOSE_ROWS + L5C_STRAIGHT_ROWS));
    const squeezeT = Math.min(1, curveRowsForSqueeze / L5C_AMP_RAMP);
    halfX = L5C_NARROW_X - (L5C_NARROW_X - (L5C_NARROW_X - 2)) * (squeezeT * squeezeT);
  }

  // Exit ramp: last 20 rows widen back out (works for both campaign and DR)
  if (rowsDone >= maxRows - exitRows) {
    const exitT = (rowsDone - (maxRows - exitRows)) / exitRows;
    const ease = exitT < 0.5 ? 2*exitT*exitT : -1+(4-2*exitT)*exitT;
    halfX = halfX + (L5C_WIDE_X - halfX) * ease;
  }

  // Sine-driven center — amplitude and period evolve progressively
  state.l5SineT = (state.l5SineT || 0);
  let center = 0;
  if (rowsDone >= L5C_CLOSE_ROWS + L5C_STRAIGHT_ROWS) {
    const curveRows = rowsDone - (L5C_CLOSE_ROWS + L5C_STRAIGHT_ROWS);
    const ampT   = Math.min(1, curveRows / L5C_AMP_RAMP);
    const amp    = L5C_AMP_START + (L5C_AMP_MAX - L5C_AMP_START) * (ampT * ampT);
    const perT   = Math.min(1, curveRows / L5C_PERIOD_RAMP);
    const period = L5C_PERIOD_START - (L5C_PERIOD_START - L5C_PERIOD_MIN) * (perT * perT);
    state.l5SineT += (2 * Math.PI) / period;
    center = amp * Math.sin(state.l5SineT);
  } else {
    state.l5SineT = 0;
    center = 0;
  }
  state.corridorGapCenter = center; // share for bend detection

  const wallJitter = 0.6;
  for (let side = -1; side <= 1; side += 2) {
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      obs.position.set(center + side * halfX + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs.userData.velX = 0;
      tintObsColor(obs, L5C_TINT);
      obs.userData.isCorridor = true;
      activeObstacles.push(obs);
    }
    const obs2 = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs2) {
      obs2.position.set(center + side * (halfX + LANE_WIDTH) + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs2.userData.velX = 0;
      tintObsColor(obs2, L5C_TINT);
      obs2.userData.isCorridor = true;
      activeObstacles.push(obs2);
    }
  }

  // Center hazard cone: spawns every L5C_CENTER_CONE_INTERVAL rows, only after sine kicks in
  // Not during exit rows so the finish stays clean
  const sineStartRow = L5C_CLOSE_ROWS + L5C_STRAIGHT_ROWS;
  const sinceStart = rowsDone - sineStartRow;
  const isExiting = rowsDone >= L5C_TOTAL_ROWS - L5C_EXIT_ROWS;
  if (sinceStart > 0 && sinceStart % L5C_CENTER_CONE_INTERVAL === 0 && !isExiting) {
    const mid = getPooledObstacle(Math.floor(Math.random() * 3));
    if (mid) {
      mid.position.set(center, 0, SPAWN_Z);
      mid.userData.velX = 0;
      tintObsColor(mid, L5C_TINT);
      mid.userData.isCorridor = true;
      activeObstacles.push(mid);
    }
  }

  state.l5CorridorRowsDone++;
}

function spawnL4CorridorRow() {
  state.l4RowsDone = (state.l4RowsDone || 0);
  const rowsDone = state.l4RowsDone;
  const maxRows = state._drL4MaxRows || 999;
  const exitRows = 20; // widen back out over last 20 rows

  // Squeeze phase
  let halfX;
  if (rowsDone < L4_CORRIDOR_CLOSE_ROWS) {
    const t = rowsDone / L4_CORRIDOR_CLOSE_ROWS;
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    halfX = CORRIDOR_WIDE_X + (L4_CORRIDOR_NARROW_X - CORRIDOR_WIDE_X) * ease;
  } else {
    const curveRows = Math.max(0, rowsDone - (L4_CORRIDOR_CLOSE_ROWS + L4_CORRIDOR_STRAIGHT));
    const squeezeT  = Math.min(1, curveRows / L4_CORRIDOR_AMP_RAMP);
    let   baseHalfX = L4_CORRIDOR_NARROW_X - (L4_CORRIDOR_NARROW_X - 4.5) * (squeezeT * squeezeT);
    // Knife-edge window: rows 370-395
    const knifeStart = 370, knifeEnd = 395;
    if (curveRows >= knifeStart && curveRows < knifeEnd) {
      const knifeT = (curveRows - knifeStart) / (knifeEnd - knifeStart);
      const spike = 1 - Math.abs(knifeT * 2 - 1);
      baseHalfX = baseHalfX - (baseHalfX - 3) * spike;
      if (curveRows === knifeStart) console.log('[L4-DEBUG] KNIFE-EDGE START, halfX=' + baseHalfX.toFixed(1) + ', curveRow=' + curveRows);
    }
    halfX = baseHalfX;
  }
  // Exit ramp: last 20 rows widen back out (works for both campaign and DR)
  if (rowsDone >= maxRows - exitRows) {
    const exitT = Math.min(1, (rowsDone - (maxRows - exitRows)) / exitRows);
    halfX = halfX + (CORRIDOR_WIDE_X - halfX) * exitT;
  }

  // Sine curves
  state.l4SineT = (state.l4SineT || 0);
  let center = 0;
  if (rowsDone >= L4_CORRIDOR_CLOSE_ROWS + L4_CORRIDOR_STRAIGHT) {
    const curveRows = rowsDone - (L4_CORRIDOR_CLOSE_ROWS + L4_CORRIDOR_STRAIGHT);
    const ampT  = Math.min(1, curveRows / L4_CORRIDOR_AMP_RAMP);
    const amp   = L4_CORRIDOR_AMP_START + (L4_CORRIDOR_AMP_MAX - L4_CORRIDOR_AMP_START) * (ampT * ampT);
    const perT  = Math.min(1, curveRows / L4_CORRIDOR_PERIOD_RAMP);
    const period = L4_CORRIDOR_PERIOD_START - (L4_CORRIDOR_PERIOD_START - L4_CORRIDOR_PERIOD_MIN) * (perT * perT);
    state.l4SineT += (2 * Math.PI) / period;
    center = amp * Math.sin(state.l4SineT);
  } else {
    state.l4SineT = 0;
    center = 0;
  }
  state.corridorGapCenter = center; // share for bend detection

  const wallJitter = 0.6;
  for (let side = -1; side <= 1; side += 2) {
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      obs.position.set(center + side * halfX + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs.userData.velX = 0;
      tintObsColor(obs, L4_CORRIDOR_TINT);
      obs.userData.isCorridor = true;
      activeObstacles.push(obs);
    }
    const obs2 = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs2) {
      obs2.position.set(center + side * (halfX + LANE_WIDTH) + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs2.userData.velX = 0;
      tintObsColor(obs2, L4_CORRIDOR_TINT);
      obs2.userData.isCorridor = true;
      activeObstacles.push(obs2);
    }
  }

  state.l4RowsDone++;
}

function spawnCorridorRow() {
  // Row counter drives the squeeze from wide entry to tight tunnel
  state.corridorRowsDone = (state.corridorRowsDone || 0);
  const rowsDone = state.corridorRowsDone;
  const _l3MaxRows = state._drL3MaxRows || 999;
  const _l3ExitRows = 20;

  // Squeeze phase: wide at horizon, narrows over CORRIDOR_CLOSE_ROWS
  let halfX;
  if (rowsDone < CORRIDOR_CLOSE_ROWS) {
    const t = rowsDone / CORRIDOR_CLOSE_ROWS;
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    halfX = CORRIDOR_WIDE_X + (CORRIDOR_NARROW_X - CORRIDOR_WIDE_X) * ease;
  } else {
    const curveRowsForSqueeze = Math.max(0, rowsDone - (CORRIDOR_CLOSE_ROWS + CORRIDOR_STRAIGHT_ROWS));
    const squeezeT = Math.min(1, curveRowsForSqueeze / CORRIDOR_AMP_RAMP);
    halfX = CORRIDOR_NARROW_X - (CORRIDOR_NARROW_X - 6) * (squeezeT * squeezeT);
  }
  // DR exit ramp: last 20 rows widen back out
  if (state.isDeathRun && rowsDone >= _l3MaxRows - _l3ExitRows) {
    const exitT = Math.min(1, (rowsDone - (_l3MaxRows - _l3ExitRows)) / _l3ExitRows);
    halfX = halfX + (CORRIDOR_WIDE_X - halfX) * exitT;
  }

  // Sine-driven corridor center — amplitude and period evolve progressively
  state.corridorSineT = (state.corridorSineT || 0);
  let center = 0;
  if (rowsDone >= CORRIDOR_CLOSE_ROWS + CORRIDOR_STRAIGHT_ROWS) {
    // How many curve rows have elapsed since curves began
    const curveRows = rowsDone - (CORRIDOR_CLOSE_ROWS + CORRIDOR_STRAIGHT_ROWS);
    // Amplitude: ramps from AMP_START to AMP_MAX over CORRIDOR_AMP_RAMP rows
    const ampT   = Math.min(1, curveRows / CORRIDOR_AMP_RAMP);
    const amp    = CORRIDOR_AMP_START + (CORRIDOR_AMP_MAX - CORRIDOR_AMP_START) * (ampT * ampT);
    // Period: shrinks from PERIOD_START to PERIOD_MIN over CORRIDOR_PERIOD_RAMP rows
    const perT   = Math.min(1, curveRows / CORRIDOR_PERIOD_RAMP);
    const period = CORRIDOR_PERIOD_START - (CORRIDOR_PERIOD_START - CORRIDOR_PERIOD_MIN) * (perT * perT);
    // Advance phase accumulator — one row = 2π/period radians
    state.corridorSineT += (2 * Math.PI) / period;
    center = amp * Math.sin(state.corridorSineT);
    state.corridorGapCenter = center;
  } else {
    state.corridorSineT = 0;
    center = 0;
    state.corridorGapCenter = 0;
  }

  // center is already set above via sine computation
  // Canyon mode: skip cone spawning, just use the sine for wall tracking
  if (_canyonActive) { state.corridorRowsDone++; return; }

  const wallJitter = 0.6;

  for (let side = -1; side <= 1; side += 2) {
    // Inner wall cone — right at the gap edge
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs) {
      obs.position.set(center + side * halfX + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs.userData.velX = 0;
      obs.userData.isCorridor = true;
      tintObsColor(obs, 0x00ffcc);
      activeObstacles.push(obs);
    }
    // Outer wall cone — one lane further out to thicken the wall
    const obs2 = getPooledObstacle(Math.floor(Math.random() * 3));
    if (obs2) {
      obs2.position.set(center + side * (halfX + LANE_WIDTH) + (Math.random()-0.5)*wallJitter, 0, SPAWN_Z);
      obs2.userData.velX = 0;
      tintObsColor(obs2, 0x00ffcc);
      obs2.userData.isCorridor = true;
      activeObstacles.push(obs2);
    }
  }

  // Advance row counter, loop after TOTAL_ROWS (skip close phase on repeat)
  state.corridorRowsDone++;
  if (state.corridorRowsDone >= CORRIDOR_TOTAL_ROWS) {
    state.corridorRowsDone = CORRIDOR_CLOSE_ROWS + 1; // loop stays in hold phase — never re-trigger funnel
  }
}


function spawnZipperRow() {
  // Gate is offset to one side — cones fill the other side, leaving a narrow gap
  // Each row flips side so player must zigzag hard left/right/left/right
  const side   = state.zipperSide;  // +1 = gap is to the right, -1 = gap is to the left
  const center = state.shipX;
  const gapCX  = center + side * ZIPPER_OFFSET;  // center of the open gap

  // Spawn a wall of cones from the opposite edge inward, stopping before the gap
  // and another wall from the far opposite edge — only the ZIPPER_GAP_HALF window is clear
  const zipLaneCount = LANE_COUNT * 8; // 8x wider — fill lateral vision completely
  const totalHalf = zipLaneCount * LANE_WIDTH * 0.5;
  const gapLeft   = gapCX - ZIPPER_GAP_HALF;
  const gapRight  = gapCX + ZIPPER_GAP_HALF;

  // Last 2 rows get a wider gap as a reward for surviving
  const rowsDone = ZIPPER_ROWS - state.zipperRowsLeft;
  const isExit = rowsDone >= ZIPPER_ROWS - 2;
  const effectiveGapHalf = isExit ? ZIPPER_GAP_HALF * 1.9 : ZIPPER_GAP_HALF;
  const gapLeft2  = gapCX - effectiveGapHalf;
  const gapRight2 = gapCX + effectiveGapHalf;

  // Fill lanes that fall outside the gap window
  for (let i = 0; i < zipLaneCount; i++) {
    const lx = center + (i - (zipLaneCount - 1) / 2) * LANE_WIDTH;
    if (lx >= gapLeft2 && lx <= gapRight2) continue;
    const obs = getPooledObstacle(Math.floor(Math.random() * 3));
    if (!obs) continue;
    obs.position.set(lx + (Math.random() - 0.5) * 0.5, 0, SPAWN_Z);
    obs.userData.velX = 0;
    tintObsColor(obs, ZIPPER_TINT);
    obs.userData.isCorridor = true;
    activeObstacles.push(obs);
  }

  // Alternate gate side every row — the core zipper mechanic
  state.zipperSide *= -1;

  state.zipperRowsLeft--;
  if (state.zipperRowsLeft <= 0) {
    state.zipperActive   = false;
    state.zipperRunCount++;
    if (state.isDeathRun) {
      state.deathRunRestBeat = 1.0 + Math.random() * 0.5; // brief rest
      state.drPatternCooldown = 3 + Math.random() * 2;
    } else if (state.zipperRunCount >= 2) {
      // 2nd zipper done — start post-zipper random cone cooldown before ending
      state.l5RandomAfterZipper = 8.0;  // 8s of random cones then sail out
      state.zipperCooldown = 99999;     // never trigger another zipper
      l5DustPoints.visible = true;      // chromatic dust from 2nd zipper onward
      // Title music fires later — when the L5 corridor finishes (see corridor completion block)
    } else {
      state.zipperCooldown = ZIPPER_COOLDOWN;
    }
  }
}


// ── LETHAL RING POOL (black octagon torus with red neon band, like cones) ──
const _lethalRingPool = [];
const _lethalRingActive = [];
const LETHAL_RING_POOL_SIZE = 20;
const _LR_SIDES = 8, _LR_R = 5.25, _LR_Y = 2, _LR_TUBE = 2.2;
let _lrGeo = null;
let _lrMatTemplate = null;
function _initLethalRings() {
  if (_lethalRingPool.length > 0) return;
  // Build octagon torus: a tube that follows the octagon path
  const pathPts = [];
  for (let s = 0; s <= _LR_SIDES; s++) {
    const angle = (s / _LR_SIDES) * Math.PI * 2;
    pathPts.push(new THREE.Vector3(Math.cos(angle) * _LR_R, Math.sin(angle) * _LR_R, 0));
  }
  const path = new THREE.CatmullRomCurve3(pathPts, true);
  _lrGeo = new THREE.TubeGeometry(path, _LR_SIDES * 4, _LR_TUBE, 8, true);
  _lrMatTemplate = new THREE.ShaderMaterial({
    uniforms: {
      uNeon:    { value: new THREE.Color(0xff1a1a) },
      uObsidian:{ value: new THREE.Color(0x0a0a0f) },
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
      uniform vec3 uNeon;
      uniform vec3 uObsidian;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float band = smoothstep(0.3, 0.5, vUv.y) * (1.0 - smoothstep(0.5, 0.7, vUv.y));
        vec3 glow = uNeon * (1.0 + band * 4.0);
        vec3 col = mix(uObsidian, glow, band);
        gl_FragColor = vec4(col, uOpacity);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  for (let i = 0; i < LETHAL_RING_POOL_SIZE; i++) {
    const mat = _lrMatTemplate.clone();
    const mesh = new THREE.Mesh(_lrGeo, mat);
    mesh.position.y = _LR_Y;
    const group = new THREE.Group();
    group.add(mesh);
    group.visible = false;
    group.userData.active = false;
    group.userData.lethalRing = true;
    group.userData._ringMesh = mesh;
    scene.add(group);
    _lethalRingPool.push(group);
  }
}
function _spawnLethalRing(x, z) {
  _initLethalRings();
  for (const r of _lethalRingPool) {
    if (!r.userData.active) {
      r.userData.active = true;
      r.visible = true;
      r.position.set(x, 0, z);
      r.userData._ringMesh.material.uniforms.uOpacity.value = 0;
      _lethalRingActive.push(r);
      return;
    }
  }
}

// ── Lateral echo helper — spawns matching obstacle copies at lateral offsets ──
// Tiles the same obstacle type outward to fill peripheral vision.
const _ECHO_SHIFT = LANE_COUNT * LANE_WIDTH; // one full road width per copy (~67.2)
const _ECHO_COPIES = 2; // copies per side (2 left + 2 right)
const _ECHOES_ENABLED = false; // toggle — off until obstacle redesign
function _spawnLateralEchoes(baseX, z, kind, opts) {
  if (!_ECHOES_ENABLED) return;
  // kind: 'cone' | 'wall' | 'ring' | 'fatcone'
  for (let c = 1; c <= _ECHO_COPIES; c++) {
    const echoOpacity = 1 / Math.pow(2, c); // 0.5 for copy 1, 0.25 for copy 2
    for (const sign of [-1, 1]) {
      const ex = baseX + sign * c * _ECHO_SHIFT;
      if (kind === 'cone') {
        const obs = getPooledObstacle(Math.floor(Math.random() * 3));
        if (!obs) continue;
        obs.position.set(ex + (Math.random() - 0.5) * 0.6, 0, z);
        obs.userData.velX = 0;
        obs.userData.isEcho = true;
        // Cap max opacity so echoes fade with distance
        const _mc = obs.userData._meshes;
        for (let mi = 0; mi < _mc.length; mi++) _mc[mi].material.userData.baseOpacity = echoOpacity;
        activeObstacles.push(obs);
      } else if (kind === 'fatcone') {
        const obs = getPooledObstacle(Math.floor(Math.random() * 3));
        if (!obs) continue;
        obs.position.set(ex + (Math.random() - 0.5) * 0.6, 0, z);
        obs.scale.set(4, 1, 4);
        obs.userData.velX = 0;
        obs.userData.slalomScaled = true;
        obs.userData.isFatCone = true;
        obs.userData.isEcho = true;
        const _mc = obs.userData._meshes;
        for (let mi = 0; mi < _mc.length; mi++) _mc[mi].material.userData.baseOpacity = echoOpacity;
        activeObstacles.push(obs);
      } else if (kind === 'wall') {
        const wall = _getPooledWall();
        if (!wall) continue;
        const angleSign = (opts && opts.angleSign) || (Math.random() < 0.5 ? 1 : -1);
        wall.position.set(ex + (Math.random() - 0.5) * 0.6, 0, z);
        wall.rotation.set(0, 0, 0);
        wall.userData._mesh.scale.set(8, 4, 0.3);
        wall.userData._edges.scale.set(8, 4, 0.3);
        wall.userData._mesh.position.y = 2;
        wall.userData._edges.position.y = 2;
        wall.rotation.y = angleSign * (25 + Math.random() * 20) * Math.PI / 180;
        wall.userData._mesh.material.uniforms.uOpacity.value = 0;
        wall.userData._edges.material.opacity = 0;
        wall.userData.isEcho = true;
        wall.userData.echoOpacity = echoOpacity; // wall fade handled separately
        _awActive.push(wall);
      } else if (kind === 'ring') {
        _spawnLethalRing(ex + (Math.random() - 0.5) * 0.6, z);
        // rings fade via their own system — no baseOpacity hook available
      }
    }
  }
}

function spawnObstacles() {
  let lvl;
  if (state.isDeathRun) {
    // Sequencer density: sparse (T1) vs dense (T2) vs normal (T3+) vs endless
    const _density = state._seqConeDensity || 'normal';
    let obs, maxObs, gap;
    if (_density === 'sparse') {
      obs = 5; maxObs = 7; gap = 1.0;
    } else if (_density === 'dense') {
      obs = 6; maxObs = 8; gap = 1.0;
    } else if (_density === 'normal') {
      // Sequencer 'normal' = moderate scatter, not the brutal endless-mode count
      // (old 'normal' fell into the 27-36 cone path — an impassable wall)
      const t = (state.deathRunSpeedTier || 0);
      obs = 7 + Math.floor(t * 0.5);   // 7 at tier 0, up to ~9 at tier 3
      maxObs = obs + 2;
      gap = 1.0;
    } else {
      // 'endless' density — escalates with physTier but stays playable.
      // Old 27-36 count exceeded LANE_COUNT=21 at every tier (impassable wall).
      // New: 8-12 cones with original gap scaling.
      const t = (state.deathRunSpeedTier || 0);
      obs = Math.min(8 + Math.floor(t * 0.8), 12);
      maxObs = obs + 2;
      gap = Math.max(0.72, 0.88 - t * 0.02);
    }
    lvl = {
      obstaclesPerSpawn: obs,
      maxObstaclesPerSpawn: maxObs,
      gapFactor: gap
    };
  } else {
    lvl = LEVELS[state.currentLevelIdx];
  }

  // Predict where ship will be when this wave arrives.
  // Travel time = distance / speed. Clamp prediction so it doesn't overshoot wildly.
  // At L5 speed the prediction can overshoot badly — cap it to ±4 units from current X.
  const travelTime = Math.abs(SPAWN_Z) / state.speed;
  const rawPredictedX = state.shipX + state.shipVelX * travelTime * 0.85;
  const maxDrift = state.currentLevelIdx >= 4 ? 4 : 8;
  const predictedX = Math.max(state.shipX - maxDrift, Math.min(state.shipX + maxDrift, rawPredictedX));
  const shipX = predictedX;

  // Check if a gauntlet should start
  maybeStartGauntlet();

  // L5: zipper rows are fired from the update loop — just block normal spawns while active
  if (state.currentLevelIdx === 4 && state.zipperActive) {
    framesSinceLastPowerup++;
    return;
  }

  // Suppress all spawning if spawn mode is 'none'
  if (state._seqSpawnMode === 'none') return;

  // If gauntlet is running, use gauntlet spawner instead of random
  if (state.gauntletActive) {
    spawnGauntletRow();
    framesSinceLastPowerup++;
    return; // no power-ups during funnel — stay focused
  }

  // ── Normal random spawn ──
  // Density ramps with score: starts at base, slowly grows toward a hard cap
  const scoreFactor  = Math.min(state.score / 200, 1.0);
  const extraRandom  = Math.random() < (0.5 + scoreFactor * 0.3) ? 1 : 0;
  let count          = lvl.obstaclesPerSpawn + extraRandom;
  let clampedCount   = Math.min(count, lvl.maxObstaclesPerSpawn);

  // Rings are much larger than cones — fewer per row, wider gap between them
  // Sequencer spawn mode overrides band-based obstacle types
  let _obsBandIdx = 0;
  let _isWallBand = false, _isRingBand = false, _isFatConeBand = false, _isMixBand = false;
  if (state.isDeathRun && state._seqSpawnMode) {
    const _sm = state._seqSpawnMode;
    if (_sm === 'cones')     { /* default cones, no overrides */ }
    else if (_sm === 'angled')    { _isWallBand = true; clampedCount = 6 + Math.floor(Math.random() * 3); }
    else if (_sm === 'lethal')    { _isRingBand = true; clampedCount = 3 + Math.floor(Math.random() * 2); }
    else if (_sm === 'fat_cones') { _isFatConeBand = true; clampedCount = 2 + Math.floor(Math.random() * 2); } // original count restored
    else if (_sm === 'endless')   { _isMixBand = true; clampedCount = 3 + Math.floor(Math.random() * 2); }
  } else if (state.isDeathRun) {
    if (state._drForcedBand != null && state._drForcedBand >= 0) { _obsBandIdx = state._drForcedBand; }
    else { for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) { if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _obsBandIdx = bi; break; } _obsBandIdx = bi; } }
    _isWallBand = _obsBandIdx === 1;
    _isRingBand = _obsBandIdx === 2;
    _isFatConeBand = _obsBandIdx === 4;
    _isMixBand = _obsBandIdx >= 5;
    if (_isRingBand || _isMixBand) clampedCount = 3 + Math.floor(Math.random() * 2);
    else if (_isWallBand) clampedCount = 3 + Math.floor(Math.random() * 2);
  }

  // Always guarantee at least 2 adjacent free lanes so there's a clear path
  const _spawnLaneCount = LANE_COUNT;
  const lanes   = Array.from({ length: _spawnLaneCount }, (_, i) => i);
  const shuffled = [...lanes].sort(() => Math.random() - 0.5);

  // Pick a guaranteed gap: a random 2-wide corridor that is always free
  const gapStart  = Math.floor(Math.random() * (_spawnLaneCount - 1));
  const gapLanes  = new Set([gapStart, gapStart + 1]);

  const blocked = [];
  for (const lane of shuffled) {
    if (blocked.length >= clampedCount) break;
    if (gapLanes.has(lane)) continue;
    // For rings/walls/mix: enforce minimum lane gap so they don't overlap
    if ((_isRingBand || _isMixBand) && blocked.some(b => Math.abs(b - lane) < 4)) continue;
    if (_isWallBand && blocked.some(b => Math.abs(b - lane) < 3)) continue;
    if (_isFatConeBand && blocked.some(b => Math.abs(b - lane) < 8)) continue; // wider gap between fat cones
    blocked.push(lane);
  }

  blocked.forEach(lane => {
    const laneX = shipX + (lane - (_spawnLaneCount - 1) / 2) * LANE_WIDTH;
    // Skip if cone would land inside a bonus ring
    let inRing = false;
    for (const br of _bonusRings) {
      if (br.collected) continue;
      const dz = Math.abs(br.mesh.position.z - SPAWN_Z);
      if (dz < _ringTuner.freq * 0.7) { // within ring spacing tolerance
        const dx = Math.abs(br.mesh.position.x - laneX);
        if (dx < _ringTuner.radius + 0.8) { inRing = true; break; }
      }
    }
    if (inRing) return;

    // Obstacle type by band
    if (_isMixBand) {
      // Random pick from all obstacle types
      const roll = Math.random();
      if (roll < 0.25) {
        _spawnLethalRing(laneX + (Math.random() - 0.5) * 0.6, SPAWN_Z);
        _spawnLateralEchoes(laneX, SPAWN_Z, 'ring');
      } else if (roll < 0.5) {
        const wall = _getPooledWall();
        if (wall) {
          const angleSign = Math.random() < 0.5 ? 1 : -1;
          wall.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
          wall.rotation.set(0, 0, 0);
          wall.userData._mesh.scale.set(8, 4, 0.3);
          wall.userData._edges.scale.set(8, 4, 0.3);
          wall.userData._mesh.position.y = 2;
          wall.userData._edges.position.y = 2;
          wall.rotation.y = angleSign * (25 + Math.random() * 20) * Math.PI / 180;
          wall.userData._mesh.material.uniforms.uOpacity.value = 0;
          wall.userData._edges.material.opacity = 0;
          _awActive.push(wall);
          _spawnLateralEchoes(laneX, SPAWN_Z, 'wall', { angleSign });
        }
      } else if (roll < 0.75) {
        const type = Math.floor(Math.random() * 3);
        const obs = getPooledObstacle(type);
        if (obs) {
          obs.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
          obs.scale.set(4, 1, 4);
          obs.userData.velX = 0;
          obs.userData.slalomScaled = true;
          activeObstacles.push(obs);
          _spawnLateralEchoes(laneX, SPAWN_Z, 'fatcone');
        }
      } else {
        const type = Math.floor(Math.random() * 3);
        const obs = getPooledObstacle(type);
        if (obs) {
          obs.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
          obs.userData.velX = 0;
          activeObstacles.push(obs);
          _spawnLateralEchoes(laneX, SPAWN_Z, 'cone');
        }
      }
      return;
    }
    if (_isRingBand) {
      _spawnLethalRing(laneX + (Math.random() - 0.5) * 0.6, SPAWN_Z);
      _spawnLateralEchoes(laneX, SPAWN_Z, 'ring');
      return;
    }
    if (_isFatConeBand) {
      const type = Math.floor(Math.random() * 3);
      const obs = getPooledObstacle(type);
      if (!obs) return;
      obs.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
      obs.scale.set(4, 1, 4);
      obs.userData.velX = 0;
      obs.userData.slalomScaled = true;
      obs.userData.isFatCone = true;
      activeObstacles.push(obs);
      _spawnLateralEchoes(laneX, SPAWN_Z, 'fatcone');
      return;
    }
    if (_isWallBand) {
      const wall = _getPooledWall();
      if (wall) {
        const angleSign = Math.random() < 0.5 ? 1 : -1;
        wall.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
        wall.rotation.set(0, 0, 0);
        const m = wall.userData._mesh;
        const e = wall.userData._edges;
        m.scale.set(8, 4, 0.3);
        e.scale.set(8, 4, 0.3);
        m.position.y = 2;
        e.position.y = 2;
        wall.rotation.y = angleSign * (25 + Math.random() * 20) * Math.PI / 180;
        wall.userData._mesh.material.uniforms.uOpacity.value = 0;
        wall.userData._edges.material.opacity = 0;
        _awActive.push(wall);
        _spawnLateralEchoes(laneX, SPAWN_Z, 'wall', { angleSign });
        return;
      }
    }
    const type  = Math.floor(Math.random() * 3);
    const obs   = getPooledObstacle(type);
    if (!obs) return;
    obs.position.set(laneX + (Math.random() - 0.5) * 0.6, 0, SPAWN_Z);
    obs.userData.velX = 0;
    activeObstacles.push(obs);
    _spawnLateralEchoes(laneX, SPAWN_Z, 'cone');
  });

  // ── Coin spawn — random singles + arc patterns (DR spawns more)
  framesSinceLastCoin++;
  const _coinThresh = (state.isDeathRun) ? 1 : (2 + Math.floor(Math.random() * 2));
  if (framesSinceLastCoin > _coinThresh) {
    framesSinceLastCoin = 0;
    const freeLanes2 = lanes.filter(l => !blocked.includes(l));
    if (freeLanes2.length > 0) {
      const roll = Math.random();
      if (roll < 0.45) {
        // Single coin in a free lane
        const lane = freeLanes2[Math.floor(Math.random() * freeLanes2.length)];
        const cx   = shipX + (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
        const coin = getPooledCoin();
        if (coin) {
          coin.position.set(cx, 1.2, SPAWN_Z);
          coin.userData.collected = false;
          activeCoins.push(coin);
        }
      } else if (roll < 0.8) {
        // Curved chain — coins spaced along Z (depth) so you fly through them
        // X drifts in a sine curve as the chain stretches away from you
        const chainCount = (state.isDeathRun) ? (10 + Math.floor(Math.random() * 6)) : (6 + Math.floor(Math.random() * 4));
        const chainZSpan = 28 + Math.random() * 16;  // total Z depth of chain
        const baseX  = shipX + (Math.random() - 0.5) * 8;
        const xSwing = (Math.random() - 0.5) * 10;  // how far X curves side-to-side
        for (let ai = 0; ai < chainCount; ai++) {
          const frac = ai / (chainCount - 1);
          const cx   = baseX + Math.sin(frac * Math.PI) * xSwing;
          const cz   = SPAWN_Z + frac * chainZSpan;  // spread coins along Z
          const cy   = 1.2 + Math.sin(frac * Math.PI) * 0.7;  // gentle vertical arc
          const coin = getPooledCoin();
          if (coin) {
            coin.position.set(cx, cy, cz);
            coin.userData.collected = false;
            activeCoins.push(coin);
          }
        }
      } else {
        // Straight tunnel chain — all same X, spaced along Z, 5-8 coins
        const lineCount = (state.isDeathRun) ? (8 + Math.floor(Math.random() * 5)) : (5 + Math.floor(Math.random() * 4));
        const lineZSpan = 20 + Math.random() * 12;
        const lane = freeLanes2[Math.floor(Math.random() * freeLanes2.length)];
        const cx   = shipX + (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
        for (let li = 0; li < lineCount; li++) {
          const frac = li / (lineCount - 1);
          const cz   = SPAWN_Z + frac * lineZSpan;
          const coin = getPooledCoin();
          if (coin) {
            coin.position.set(cx, 1.2, cz);
            coin.userData.collected = false;
            activeCoins.push(coin);
          }
        }
      }
    }
  }

  // Possibly spawn a power-up in a free lane
  framesSinceLastPowerup++;
  const _puRate = powerupSpawnRate * (1 + getStatValue('spawnrate'));
  const _puThresh = _puRate > 0 ? Math.max(4, Math.round(12 / _puRate)) : Infinity;
  const _puProb   = Math.min(0.9, 0.35 * _puRate);
  if (powerupSpawnRate > 0 && framesSinceLastPowerup > _puThresh && activePowerups.length < 2 && Math.random() < _puProb) {
    framesSinceLastPowerup = 0;
    const freeLanes = lanes.filter(l => !blocked.includes(l));
    if (freeLanes.length > 0) {
      const lane  = freeLanes[Math.floor(Math.random() * freeLanes.length)];
      const laneX = shipX + (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;

      // Build available powerup types (only unlocked ones)
      const _availPU = POWERUP_TYPES.map((p, idx) => ({ idx, id: p.id })).filter(p => isPowerupUnlocked(p.id));
      if (_availPU.length === 0) _availPU.push({ idx: 0, id: 'shield' }); // fallback
      const typeIdx = _availPU[Math.floor(Math.random() * _availPU.length)].idx;

      const pu = getPooledPowerup(typeIdx);
      if (pu) {
        pu.position.set(laneX, 1.4, SPAWN_Z);
        pu.userData.typeIdx = typeIdx;
        activePowerups.push(pu);
      }
    }
  }
}

// ═══════════════════════════════════════════════════
//  LEVEL CHECKING
// ═══════════════════════════════════════════════════
function checkLevelUp() {
  // Death Run: cycle vibes instead of normal level progression
  if (state.isDeathRun) {
    // Sequencer handles vibes + speed until endless mode
    const _seqStage = DR_SEQUENCE[state.seqStageIdx];
    if (_seqStage && _seqStage.type === 'endless_mix') {
      checkDeathRunVibe(); checkDeathRunSpeed();
    }
    return;
  }
  // JL mode: frozen at L4 — score must never flip currentLevelIdx to L5
  // (L5 activates the zipper/corridor campaign system which bleeds into JL)
  if (state._jetLightningMode) return;

  let newIdx = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (state.score >= LEVELS[i].scoreThreshold) { newIdx = i; break; }
  }

  // Continuous speed scaling within + beyond levels (score/30 on top of level base)
  const lvlDef = LEVELS[newIdx];
  const continuousBoost = Math.min(state.score / 180, 0.6); // up to +60% extra, ramps faster
  // Freeze speed during corridors — prevents mid-corridor speed jumps
  const inCorridor = state.corridorMode || state.l4CorridorActive || state.l5CorridorActive;
  if (!inCorridor) state.speed = BASE_SPEED * (lvlDef.speedMult + continuousBoost);

  if (newIdx !== state.currentLevelIdx) {
    state.currentLevelIdx = newIdx;
    state.levelElapsed     = 0;   // reset time-in-level clock
    state.l4CorridorDone   = false; // allow L4 corridor to retrigger on new entry
    // L5: random cones first, then zippers
    if (newIdx === 4) {
      state.zipperActive      = false;
      state.zipperRowsLeft    = 0;
      state.zipperCooldown    = 99999; // held until l5PreZipperRandom drains
      state.zipperSide        = 1;
      state.l5PreZipperRandom = 8.0;   // 8s of open random cones before first zipper
    }
    if (newIdx === 3) {
      // L3->L4: 3s cone-free gap after corridor, then normal L4 random cones
      state.postL3Gap = 3.0;  // gates spawnObstacles for 3s after corridor ends
    }
    // Save that the previous level was beaten (campaign only)
    if (newIdx > 0 && !state.isDeathRun) saveLevelBeaten(newIdx - 1);
    transitionToLevel(lvlDef);
    playLevelUp();
    updateHUDLevel();
    // Crossfade to L3 music when entering level 3 (index 2)
    if (newIdx === 2) { const t = setTimeout(() => { if (state.currentLevelIdx >= 2) crossfadeToL3(6.0); }, 5000); _musicTimers.push(t); }
    // L3→L4 crossfade: fire immediately on L4 entry, 12s incoming fade, L3 fades out over 21.6s (12×1.8)
    if (newIdx === 3) { const t = setTimeout(() => { if (state.currentLevelIdx >= 3) crossfadeToL4(6.0); }, 5000); _musicTimers.push(t); }
    showBanner('LEVEL ' + (newIdx + 1), 'levelup', 2500);
    // Update coin multiplier/colors for new level
    updateCoinColors();
  }
}

function updateHUDLevel() {
  if (state.isDeathRun) {
    // Show the vibe number (1-indexed, wrapping)
    document.getElementById('hud-level').textContent = (state.deathRunVibeIdx % DEATH_RUN_VIBES.length) + 1;
    return;
  }
  const def = LEVELS[state.currentLevelIdx];
  document.getElementById('hud-level').textContent = def.id;
}

// ═══════════════════════════════════════════════════
//  POWER-UP EFFECT APPLICATION
// ═══════════════════════════════════════════════════

let _totalCoins = loadCoinWallet();  // in-memory running total (persists via window._LS)
// Coin Value: multiplier based on level + upgrade tier
// Base: 2x at L3 (idx 2), 3x at L4 (idx 3)
// Tier 2: 2x at L2, 3x at L4
// Tier 3: 2x at L2, 3x at L3
const COIN_MULT_TABLE = [
  // [tier]: { levelIdx: multiplier }
  { 2: 2, 3: 3 },  // tier 1 (base): 2x@L3, 3x@L4+
  { 1: 2, 3: 3 },  // tier 2: 2x@L2, 3x@L4+
  { 1: 2, 2: 3 },  // tier 3: 2x@L2, 3x@L3+
];

function getCoinMultiplier(levelIdx) {
  const tier = loadUpgradeTier('coinvalue');
  const table = COIN_MULT_TABLE[Math.min(tier - 1, COIN_MULT_TABLE.length - 1)] || COIN_MULT_TABLE[0];
  let mult = 1;
  for (const [lvl, m] of Object.entries(table)) {
    if (levelIdx >= parseInt(lvl)) mult = Math.max(mult, m);
  }
  return mult;
}

// Coin colors: gold(1x), red(2x), blue(3x)
function updateCoinColors() {
  const mult = getCoinMultiplier(state.currentLevelIdx);
  if (mult !== _activeCoinMult) {
    const prevMult = _activeCoinMult;
    _activeCoinMult = mult;
    // Recolor all active coins
    const color = COIN_MULT_COLORS[mult] || 0xffcc00;
    for (const c of activeCoins) {
      if (c.children[0] && c.children[0].material) c.children[0].material.color.setHex(color);
    }
    // Banner
    if (mult > prevMult && state.phase === 'playing') {
      showBanner(mult + 'x COINS', 'mission', 2000);
    }
  }
}

function collectCoin(coin, worldPos) {
  const mult = _activeCoinMult;
  state.sessionCoins += mult;
  _totalCoins += mult;
  // Player-facing score: orb bonus
  if (!state.l5EndingActive) {
    const lvlMult = [1, 1.5, 2, 3, 4][state.currentLevelIdx] || 1;
    state.playerScore += 75 * lvlMult;
  }
  // Update HUD coin counter
  const hudEl = document.getElementById('hud-coins');
  if (hudEl) hudEl.textContent = state.sessionCoins;
  // Gold fly animation to coins HUD
  if (worldPos && hudEl) _spawnCoinFly(worldPos, hudEl);
  // Update title screen running total
  updateTitleCoins();
  // Collect sound — bright 3-note ascending chime (C5-E5-G5)
  if (audioCtx && !state.muted) {
    const t = audioCtx.currentTime;
    if (state.magnetActive) {
      // Magnet whoosh — short rising pitch sweep per sucked coin
      const wo = audioCtx.createOscillator();
      const wg = audioCtx.createGain();
      wo.type = 'sine';
      wo.frequency.setValueAtTime(280, t);
      wo.frequency.exponentialRampToValueAtTime(980, t + 0.09);
      wg.gain.setValueAtTime(0.055, t);
      wg.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      wo.connect(wg).connect(audioCtx.destination);
      wo.start(); wo.stop(t + 0.12);
    }
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      // Add a little shimmer with a detuned second oscillator
      const osc2  = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      const onset = t + i * 0.06;
      const dur   = 0.22 - i * 0.02;
      osc.type  = 'sine';
      osc2.type = 'triangle';
      osc.frequency.setValueAtTime(freq, onset);
      osc2.frequency.setValueAtTime(freq * 1.004, onset); // slight detune shimmer
      // Attack
      gain.gain.setValueAtTime(0.0, onset);
      gain.gain.linearRampToValueAtTime(0.10 - i * 0.01, onset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, onset + dur);
      gain2.gain.setValueAtTime(0.0, onset);
      gain2.gain.linearRampToValueAtTime(0.04, onset + 0.012);
      gain2.gain.exponentialRampToValueAtTime(0.001, onset + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc2.connect(gain2).connect(audioCtx.destination);
      osc.start(onset);  osc.stop(onset + dur);
      osc2.start(onset); osc2.stop(onset + dur);
    });
  }
}

function updateTitleCoins() {
  const total = _totalCoins;
  const el = document.getElementById('title-coin-count');
  if (el) el.textContent = total.toLocaleString();
  // Also refresh skin viewer action (wallet may have changed)
  if (typeof updateSkinViewerDisplay === 'function') updateSkinViewerDisplay();
}

function updateTitleLevel() {
  const level = loadPlayerLevel();
  const xp = loadPlayerXP();
  const needed = xpForLevel(level);
  const pct = Math.min(100, (xp / needed) * 100);
  const el = document.getElementById('title-level-num');
  if (el) el.textContent = level;
  const fill = document.getElementById('title-xp-fill');
  if (fill) fill.style.width = pct + '%';
}

// ── SKIN VIEWER UI ──────────────────────────────────────────────
function initSkinViewer() {
  const data = loadSkinData();
  skinViewerIdx = data.selected;
  applySkin(data.selected);
  applyTitleSkin(data.selected);
  updateSkinViewerDisplay();

  // Only bind listeners once
  if (!window._skinViewerInited) {
    window._skinViewerInited = true;

    document.getElementById('skin-prev').addEventListener('click', e => {
      e.stopPropagation();
      { let _ni = (skinViewerIdx - 1 + SHIP_SKINS.length) % SHIP_SKINS.length; while (SHIP_SKINS[_ni] && SHIP_SKINS[_ni].hidden) _ni = (_ni - 1 + SHIP_SKINS.length) % SHIP_SKINS.length; navigateToSkin(_ni); }
    });
    document.getElementById('skin-next').addEventListener('click', e => {
      e.stopPropagation();
      { let _ni = (skinViewerIdx + 1) % SHIP_SKINS.length; while (SHIP_SKINS[_ni] && SHIP_SKINS[_ni].hidden) _ni = (_ni + 1) % SHIP_SKINS.length; navigateToSkin(_ni); }
    });

    // Touch swipe on title screen
    let touchStartX = 0;
    const titleEl = document.getElementById('title-screen');
    titleEl.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    titleEl.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) {
        { let _ni = dx < 0
          ? (skinViewerIdx + 1) % SHIP_SKINS.length
          : (skinViewerIdx - 1 + SHIP_SKINS.length) % SHIP_SKINS.length;
          while (SHIP_SKINS[_ni] && SHIP_SKINS[_ni].hidden) _ni = dx < 0 ? (_ni + 1) % SHIP_SKINS.length : (_ni - 1 + SHIP_SKINS.length) % SHIP_SKINS.length;
          navigateToSkin(_ni); }
      }
    }, { passive: true });

    // Admin mode: 3 rapid taps on the skin label (only when no handling upgrade pending)
    let adminTapCount = 0;
    let adminTapTimer = null;
    document.getElementById('skin-viewer-label').addEventListener('click', (e) => {
      // If handling upgrade pending, claim it
      const pendingHandling = getPendingHandlingUpgrade();
      if (pendingHandling) {
        const tier = claimHandlingUpgrade();
        if (tier) {
          const labelEl = document.getElementById('skin-viewer-label');
          // Particle burst toward ship preview
          spawnRewardParticles(labelEl, '#skin-viewer', '#00eeff', '\u2699', 12);
          playRewardSFX();
          // Show +% handling popup
          const pctGain = Math.round((1 - tier.drift) * 100);
          const popup = document.createElement('div');
          popup.className = 'handling-popup';
          popup.textContent = tier.label + ' \u2022 +' + pctGain + '% HANDLING';
          const rect = labelEl.getBoundingClientRect();
          popup.style.left = rect.left + rect.width / 2 + 'px';
          popup.style.top = rect.top - 10 + 'px';
          document.body.appendChild(popup);
          requestAnimationFrame(() => popup.classList.add('show'));
          setTimeout(() => { popup.classList.add('fade'); setTimeout(() => popup.remove(), 600); }, 1800);
          updateNotificationDots();
        }
        return;
      }
      adminTapCount++;
      if (adminTapTimer) clearTimeout(adminTapTimer);
      adminTapTimer = setTimeout(() => { adminTapCount = 0; }, 1500);
      if (adminTapCount >= 3) {
        _skinAdminMode = !_skinAdminMode;
        adminTapCount = 0;
        updateSkinViewerDisplay();
        if (_skinAdminMode) {
          // Auto-grant coins + fuel cells for testing
          saveCoinWallet(loadCoinWallet() + 99999);
          _totalCoins = loadCoinWallet();
          updateTitleCoins();
          saveFuelCells(loadFuelCells() + 9999);
          updateTitleFuelCells();
        }
        // Brief flash feedback
        const label = document.getElementById('skin-viewer-label');
        label.style.color = _skinAdminMode ? '#ff0' : '';
        setTimeout(() => { label.style.color = ''; }, 300);
        // Admin cheats for testing
        if (_skinAdminMode) {
          window._cheatCoins = (amount) => { saveCoinWallet(loadCoinWallet() + (amount || 99999)); _totalCoins = loadCoinWallet(); updateTitleCoins(); };
          window._cheatFuel = (amount) => { saveFuelCells(loadFuelCells() + (amount || 9999)); updateTitleFuelCells(); };
          window._cheatLevel = (lvl) => { savePlayerLevel(lvl || 50); savePlayerXP(0); updateTitleLevel(); };
          window._cheatMaxUpgrades = () => { Object.keys(POWERUP_UPGRADES).forEach(id => saveUpgradeTier(id, 5)); };
          window._cheatLadder = (pos) => { saveLadderPos(pos || MISSION_LADDER.length); saveMissionFlags({}); updateTitleFuelCells(); };
          // Auto-reset streak for testing
          localStorage.removeItem(STREAK_KEY_DAY); localStorage.removeItem(STREAK_KEY_LAST); updateStreakBadge();
          window._cheatReset = () => { Object.keys(POWERUP_UPGRADES).forEach(id => saveUpgradeTier(id, 1)); Object.keys(STAT_UPGRADES).forEach(id => saveUpgradeTier(id, 1)); saveCoinWallet(0); saveFuelCells(0); saveFreeHeadStarts(0); saveLadderPos(0); window._LS.removeItem('jetslide_mission_flags'); window._LS.setItem('jetslide_pu_unlocked', '["shield"]'); savePlayerLevel(1); savePlayerXP(0); _totalCoins = 0; updateTitleCoins(); updateTitleFuelCells(); updateTitleLevel(); };
        }
      }
    });
  }
}

// ═══════════════════════════════════════════════════════
//  DAILY STREAK REWARDS
// ═══════════════════════════════════════════════════════
// SVG icons for streak rewards — clean, game-quality
const STREAK_SVG_COIN = '<img src="multi-coins-icon.png" style="width:22px;height:22px;object-fit:contain;">';
const STREAK_SVG_FUEL = '<img src="fuelcell-icon-new.png" style="width:22px;height:22px;object-fit:contain;">';
const STREAK_SVG_ROCKET = '<img src="rocket-icon.png" style="width:22px;height:22px;object-fit:contain;">';

const STREAK_REWARDS = [
  { day: 1, coins: 25,  fuel: 0, heads: 0, svg: 'coin',    color: '#ffcc00' },
  { day: 2, coins: 50,  fuel: 0, heads: 0, svg: 'coin',    color: '#ffcc00' },
  { day: 3, coins: 0,   fuel: 3, heads: 0, svg: 'fuel',    color: '#4488ff' },
  { day: 4, coins: 75,  fuel: 2, heads: 0, svg: 'both',    color: '#ffcc00' },
  { day: 5, coins: 100, fuel: 0, heads: 0, svg: 'coin',    color: '#ffcc00' },
  { day: 6, coins: 0,   fuel: 5, heads: 0, svg: 'fuel',    color: '#4488ff' },
  { day: 7, coins: 150, fuel: 5, heads: 1, svg: 'rocket',  color: '#ff6600' },
];

const STREAK_KEY_DAY = 'jh_streak_day';
const STREAK_KEY_LAST = 'jh_streak_last_claim';

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function loadStreakState() {
  const lastClaim = localStorage.getItem(STREAK_KEY_LAST);
  let day = parseInt(localStorage.getItem(STREAK_KEY_DAY)) || 1;
  const today = getTodayStr();
  const yesterday = getYesterdayStr();

  if (!lastClaim) {
    return { day: 1, claimed: false };
  }
  if (lastClaim === today) {
    return { day: day, claimed: true };
  }
  if (lastClaim === yesterday) {
    day = day >= 7 ? 1 : day + 1;
    return { day: day, claimed: false };
  }
  // Missed a day — reset
  return { day: 1, claimed: false };
}

function renderStreakCircles() {
  const container = document.getElementById('streak-circles');
  if (!container) return;
  container.innerHTML = '';
  const ss = loadStreakState();

  for (let i = 0; i < 7; i++) {
    const r = STREAK_REWARDS[i];
    const dayNum = i + 1;
    const el = document.createElement('div');
    el.className = 'streak-day';
    el.dataset.day = dayNum;

    el.innerHTML = '<span class="streak-num">' + dayNum + '</span>';

    // State
    if (dayNum < ss.day || (dayNum === ss.day && ss.claimed)) {
      el.classList.add('claimed');
    } else if (dayNum === ss.day && !ss.claimed) {
      el.classList.add('today');
      el.addEventListener('click', () => claimStreakReward(el, ss.day));
      el.addEventListener('touchstart', (e) => { e.preventDefault(); claimStreakReward(el, ss.day); }, { passive: false });
    } else {
      el.classList.add('future');
    }

    container.appendChild(el);
  }
}

function claimStreakReward(el, dayNum) {
  if (el.classList.contains('claimed')) return;
  playTitleTap();
  el.classList.remove('today');
  el.classList.add('burst');

  const r = STREAK_REWARDS[dayNum - 1];

  // Save streak state FIRST so it persists no matter what
  localStorage.setItem(STREAK_KEY_DAY, '' + dayNum);
  localStorage.setItem(STREAK_KEY_LAST, getTodayStr());

  // Apply rewards
  if (r.coins > 0) {
    const cur = loadCoinWallet();
    saveCoinWallet(cur + r.coins);
    document.getElementById('title-coin-count').textContent = (cur + r.coins).toLocaleString();
  }
  if (r.fuel > 0) {
    const cur = loadFuelCells();
    saveFuelCells(cur + r.fuel);
    document.getElementById('title-fuelcell-count').textContent = (cur + r.fuel).toLocaleString();
  }
  if (r.heads > 0) {
    const cur = parseInt(localStorage.getItem('jh_headstarts') || '0');
    localStorage.setItem('jh_headstarts', '' + (cur + r.heads));
  }

  // Mark claimed visually
  setTimeout(() => {
    el.classList.remove('burst');
    el.classList.add('claimed');
  }, 400);

  // Show streak popup — dynamic element appended to body (same pattern as handling-popup)
  const elRect = el.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'streak-claim-popup';
  popup.textContent = '\uD83D\uDD25 ' + dayNum + ' Day Streak!';
  popup.style.left = (elRect.left + elRect.width / 2) + 'px';
  popup.style.top = (elRect.top - 6) + 'px';
  document.body.appendChild(popup);
  requestAnimationFrame(() => popup.classList.add('show'));
  setTimeout(() => { popup.classList.add('fade'); setTimeout(() => popup.remove(), 600); }, 1800);

  // Bezier fly particles — coins fly to coin HUD, fuel flies to fuel HUD
  const ox = elRect.left + elRect.width / 2;
  const oy = elRect.top + elRect.height / 2;
  function _streakFly(count, color, glow, targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const tx = rect.left + rect.width / 2;
    const ty = rect.top + rect.height / 2;
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('div');
      const size = 6 + Math.random() * 7;
      const startX = ox + (Math.random() - 0.5) * 40;
      const startY = oy + (Math.random() - 0.5) * 40;
      const delay = i * 25;
      const dur = 500 + Math.random() * 250;
      const midX = (startX + tx) / 2 + (Math.random() - 0.5) * 100;
      const midY = Math.min(startY, ty) - 30 - Math.random() * 70;
      dot.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;background:${color};border-radius:50%;box-shadow:0 0 ${size+3}px ${glow};z-index:9999;pointer-events:none;will-change:transform,opacity;`;
      document.body.appendChild(dot);
      const start = performance.now() + delay;
      (function tick(now) {
        const elapsed = now - start;
        if (elapsed < 0) { requestAnimationFrame(tick); return; }
        const t = Math.min(1, elapsed / dur);
        const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
        const bx = (1-ease)*(1-ease)*startX + 2*(1-ease)*ease*midX + ease*ease*tx;
        const by = (1-ease)*(1-ease)*startY + 2*(1-ease)*ease*midY + ease*ease*ty;
        const s = 1 - ease * 0.7;
        const op = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
        dot.style.transform = `translate(${bx}px,${by}px) scale(${s})`;
        dot.style.opacity = op;
        if (t < 1) requestAnimationFrame(tick);
        else dot.remove();
      })(performance.now());
    }
  }
  const coinHud = document.getElementById('title-coin-count');
  const fuelHud = document.getElementById('title-fuelcell-count');
  if (r.coins > 0 && coinHud) _streakFly(Math.min(30, Math.max(12, (r.coins / 3) | 0)), '#ffd700', '#fa0', coinHud);
  if (r.fuel > 0 && fuelHud)  _streakFly(Math.min(25, Math.max(10, r.fuel * 4)), '#4cf', '#0af', fuelHud);

  // Play SFX
  playRewardSFX();

  // Hide badge
  const badge = document.getElementById('streak-badge');
  if (badge) badge.classList.add('hidden');

  // Auto-dismiss overlay
  setTimeout(() => {
    document.getElementById('streak-overlay').classList.add('hidden');
  }, 1800);
}

function openStreak() {
  initAudio();
  playTitleTap();
  renderStreakCircles();
  document.getElementById('streak-overlay').classList.remove('hidden');
  // Hide badge when panel opens
  const badge = document.getElementById('streak-badge');
  if (badge) badge.classList.add('hidden');
}
window.openStreak = openStreak;

// Close streak overlay — X button or tap outside panel
function closeStreak() {
  playTitleTap();
  document.getElementById('streak-overlay').classList.add('hidden');
}
document.getElementById('streak-close-btn').addEventListener('click', closeStreak);
document.getElementById('streak-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeStreak();
});

// Update streak badge + day counter on title screen load
function updateStreakBadge() {
  const ss = loadStreakState();
  const badge = document.getElementById('streak-badge');
  if (badge) {
    if (!ss.claimed) badge.classList.remove('hidden');
    else badge.classList.add('hidden');
  }
  // Update day counter label (e.g. "3/7")
  const dayLabel = document.getElementById('streak-day-label');
  if (dayLabel) dayLabel.textContent = ss.day + '/7';
}

// ═══════════════════════════════════════════════════
//  SHOP SYSTEM
// ═══════════════════════════════════════════════════

function toggleLeaderboard() {
  const overlay = document.getElementById('lb-overlay');
  if (overlay) overlay.classList.toggle('hidden');
}
window.toggleLeaderboard = toggleLeaderboard;

// ── Shop affordability check (used by HUD notification dot) ──
function _canAffordAnyShopItem() {
  const coins = loadCoinWallet();
  const owned = JSON.parse(localStorage.getItem('jh_owned_skins') || '["RUNNER"]');
  if (SHIP_SKINS.some(s => s.price > 0 && !owned.includes(s.name) && coins >= s.price)) return true;
  return Object.entries(POWERUP_UPGRADES).some(([id, up]) => {
    const tier = loadUpgradeTier(id);
    const cost = getUpgradeCost(id, tier);
    return tier < (up.maxTier || 5) && cost !== null && coins >= cost;
  });
}

function _showShopArrow() { /* removed */ }
function _hideShopArrow() { /* removed */ }

function openShop() {
  initAudio();
  playTitleTap();
  _hideShopArrow();
  state._shopOpened = true;
  updateNotificationDots();
  const overlay = document.getElementById('shop-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.classList.add('shop-open');
  document.getElementById('shop-coin-count').textContent = _totalCoins;
  closeShopDetail();
  renderPowerupCards();
  updateNotificationDots();
  _renderShopHandlingBar();
}
window.openShop = openShop;

function _renderShopHandlingBar() {
  const bar = document.getElementById('shop-handling-bar');
  if (!bar) return;
  const level = loadPlayerLevel();
  // Find current and next tier
  let currentTier = HANDLING_TIERS[0];
  let nextTier = null;
  for (let i = 0; i < HANDLING_TIERS.length; i++) {
    if (level >= HANDLING_TIERS[i].level) currentTier = HANDLING_TIERS[i];
    else { nextTier = HANDLING_TIERS[i]; break; }
  }
  const tierLabel = currentTier.label || 'Stock';
  const handlingPct = Math.round((1 - currentTier.drift) * 100);
  // Progress toward next tier
  let fillPct = 100;
  let nextText = 'MAX HANDLING';
  if (nextTier) {
    const prevLevel = currentTier.level;
    const needed = nextTier.level - prevLevel;
    const progress = level - prevLevel;
    fillPct = Math.min(100, Math.round((progress / needed) * 100));
    nextText = 'Next: ' + nextTier.label + ' (Lv ' + nextTier.level + ')';
  }
  bar.innerHTML =
    '<div class="shop-handling-label">SHIP HANDLING</div>' +
    '<div class="shop-handling-tier">' + tierLabel + ' \u2022 ' + handlingPct + '% Control</div>' +
    '<div class="shop-handling-track"><div class="shop-handling-fill" style="width:' + fillPct + '%"></div></div>' +
    '<div class="shop-handling-next">' + nextText + '</div>';
}

function closeShop() {
  playTitleTap();
  const overlay = document.getElementById('shop-overlay');
  if (!overlay) return;
  overlay.classList.remove('shop-open');
  overlay.classList.add('hidden');
}
window.closeShop = closeShop;

function switchShopTab(tab) {
  document.querySelectorAll('.shop-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('shop-tab-powerups').classList.toggle('hidden', tab !== 'powerups');
  document.getElementById('shop-detail').classList.add('hidden');
}

// Tab click handlers
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.shop-tab').forEach(tab => {
    tab.addEventListener('click', () => switchShopTab(tab.dataset.tab));
  });

});

function renderPowerupCards() {
  const container = document.getElementById('shop-powerup-cards');
  if (!container) return;
  container.innerHTML = '';
  const playerLevel = loadPlayerLevel();
  const isNew = hasNewShopUnlock();
  Object.entries(POWERUP_UPGRADES).forEach(([id, up]) => {
    const tier = loadUpgradeTier(id);
    const cost = getUpgradeCost(id, tier);
    // Lock by level gate OR ladder unlock state
    const levelLocked = up.levelGate && playerLevel < up.levelGate;
    const ladderLocked = (id !== 'shield' && id !== 'coinvalue') && !isPowerupUnlocked(id);
    const locked = levelLocked || ladderLocked;
    const mt = up.maxTier || 5;
    const maxed = tier >= mt;
    const canAfford = cost !== null && _totalCoins >= cost;
    // Check if this was just unlocked (show NEW badge)
    const justUnlocked = isNew && !locked && id !== 'shield';

    const card = document.createElement('div');
    card.className = 'shop-card' + (canAfford && !maxed && !locked ? ' affordable' : '') + (locked ? ' locked' : '') + (justUnlocked ? ' new-unlock' : '');
    card.style.borderColor = up.color;

    let lockLabel = '';
    if (ladderLocked) lockLabel = `<div class="shop-card-lock">\uD83D\uDD12 MISSIONS</div>`;
    else if (levelLocked) lockLabel = `<div class="shop-card-lock">LV ${up.levelGate}</div>`;

    card.innerHTML = `
      <div class="shop-card-icon" style="color:${up.color}">${up.icon}</div>
      <div class="shop-card-name">${up.name}</div>
      <div class="shop-card-pips">${renderPips(tier, up.color)}</div>
      <div class="shop-card-desc">${up.tiers[tier - 1]?.desc || 'MAX'}</div>
      ${locked ? lockLabel :
        maxed ? '<div class="shop-card-maxed">MAXED</div>' :
        `<div class="shop-card-cost">${cost !== null ? '\u2B21 ' + cost : ''}</div>`}
      ${justUnlocked ? '<div class="shop-new-badge">NEW</div>' : ''}
    `;
    if (!locked && !maxed) {
      card.addEventListener('click', () => {
        // Clear NEW flag when they tap a newly unlocked card
        if (justUnlocked) window._LS.removeItem('jetslide_shop_new');
        updateNotificationDots();
        openShopDetail(id);
      });
    }
    container.appendChild(card);
  });
}

function renderPips(tier, color) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="shop-pip${i <= tier ? ' filled' : ''}" style="${i <= tier ? 'background:' + color : ''}"></span>`;
  }
  return html;
}

function openShopDetail(id) {
  const detail = document.getElementById('shop-detail');
  const content = document.getElementById('shop-detail-content');
  if (!detail || !content) return;

  // Hide cards and handling bar, show detail
  document.getElementById('shop-tab-powerups').classList.add('hidden');
  document.getElementById('shop-handling-bar').classList.add('hidden');
  detail.classList.remove('hidden');

  const isPowerup = !!POWERUP_UPGRADES[id];
  const up = isPowerup ? POWERUP_UPGRADES[id] : STAT_UPGRADES[id];
  const tier = loadUpgradeTier(id);
  const cost = getUpgradeCost(id, tier);
  const maxed = tier >= (up.maxTier || 5);
  const canAfford = cost !== null && _totalCoins >= cost;
  const color = isPowerup ? up.color : '#0af';

  let tiersHTML = '';
  const tiers = isPowerup ? up.tiers : up.tiers.map((t, i) => ({ desc: t }));
  for (let i = 0; i < 5; i++) {
    const desc = isPowerup ? tiers[i].desc : up.tiers[i];
    const active = i < tier;
    const next = i === tier;
    tiersHTML += `<div class="shop-detail-tier${active ? ' active' : ''}${next ? ' next' : ''}" style="${active ? 'border-color:' + color : ''}">
      <span class="shop-detail-tier-num">T${i + 1}</span>
      <span class="shop-detail-tier-desc">${desc}</span>
      ${isPowerup ? `<span class="shop-detail-tier-cost">${i === 0 ? 'FREE' : '<img src="single-coin-icon.png" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;"> ' + UPGRADE_COSTS[i]}</span>` :
        `<span class="shop-detail-tier-cost">${'<img src="single-coin-icon.png" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;"> ' + up.costs[i]}</span>`}
    </div>`;
  }

  content.innerHTML = `
    <div class="shop-detail-header">
      ${isPowerup ? `<span class="shop-detail-icon" style="color:${color}">${up.icon}</span>` : ''}
      <span class="shop-detail-name" style="color:${color}">${up.name}</span>
    </div>
    <div class="shop-detail-pips">${renderPips(tier, color)}</div>
    <div class="shop-detail-tiers">${tiersHTML}</div>
    ${maxed ? '<div class="shop-detail-maxed">FULLY UPGRADED</div>' :
      `<button class="btn-space btn-upgrade shop-upgrade-btn${canAfford ? '' : ' disabled'}" id="shop-buy-btn" style="--up-color:${color}">
        UPGRADE <img src="single-coin-icon.png" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;"> ${cost}
      </button>`}
  `;

  if (!maxed) {
    const buyBtn = document.getElementById('shop-buy-btn');
    if (buyBtn) {
      buyBtn.addEventListener('click', () => {
        if (purchaseUpgrade(id)) {
          // Animate purchase
          buyBtn.classList.add('shop-purchase-anim');
          document.getElementById('shop-coin-count').textContent = _totalCoins;
          // SFX
          playSFX(600, 0.2, 'sine', 0.15);
          setTimeout(() => playSFX(900, 0.2, 'sine', 0.15), 100);
          // Re-render detail after animation
          setTimeout(() => {
            openShopDetail(id);
            renderPowerupCards();
          }, 400);
        }
      });
    }
  }
}
window.openShopDetail = openShopDetail;

function closeShopDetail() {
  playTitleTap();
  const detail = document.getElementById('shop-detail');
  if (detail) detail.classList.add('hidden');
  const tabs = document.querySelectorAll('.shop-tabs')[0];
  if (tabs) tabs.classList.remove('hidden');
  // Show the powerups content and handling bar
  const puTab = document.getElementById('shop-tab-powerups');
  if (puTab) puTab.classList.remove('hidden');
  const handlingBar = document.getElementById('shop-handling-bar');
  if (handlingBar) handlingBar.classList.remove('hidden');
}
window.closeShopDetail = closeShopDetail;

function navigateToSkin(idx) {
  playTitleTap();
  skinViewerIdx = idx;
  // Always apply visually so player sees the 3D ship change
  applySkin(idx);
  // Update title ship preview clone too
  applyTitleSkin(idx);

  const data = loadSkinData();
  // If unlocked (or admin), save as selected
  if (_skinAdminMode || isSkinUnlocked(idx)) {
    data.selected = idx;
    saveSkinData(data);
  }
  updateSkinViewerDisplay();
}

function updateSkinViewerDisplay() {
  const labelEl = document.getElementById('skin-viewer-label');
  if (!labelEl) return;
  const data = loadSkinData();
  const skin = SHIP_SKINS[skinViewerIdx];
  const isSelected = data.selected === skinViewerIdx;
  const isUnlocked = _skinAdminMode || isSkinUnlocked(skinViewerIdx);
  const requiredLevel = SKIN_LEVEL_UNLOCKS[skinViewerIdx] || 1;

  // Label: skin name + checkmark/USE/lock inline
  if (skinViewerIdx === 0 || isUnlocked) {
    if (isSelected) {
      labelEl.innerHTML = skin.name + ' <span class="skin-check">&check;</span>';
    } else {
      labelEl.innerHTML = skin.name + ' <button class="skin-use-btn" onclick="selectSkin(' + skinViewerIdx + ')">USE</button>';
    }
    labelEl.classList.remove('skin-locked');
  } else {
    labelEl.innerHTML = skin.name + ' <span class="skin-lock-tag">\u{1F512} LV' + requiredLevel + '</span>';
    labelEl.classList.add('skin-locked');
  }

  // Clear the old action row (no longer used)
  const actionEl = document.getElementById('skin-viewer-action');
  if (actionEl) actionEl.innerHTML = '';
}

function selectSkin(idx) {
  const data = loadSkinData();
  data.selected = idx;
  saveSkinData(data);
  applySkin(idx);
  applyTitleSkin(idx);
  updateSkinViewerDisplay();
}

function buySkin(idx) {
  // Legacy — no longer used for purchasing. Skins are level-gated.
  selectSkin(idx);
}

// Make these available from onclick attributes
window.selectSkin = selectSkin;
window.buySkin = buySkin;

function applyPowerup(typeIdx) {
  hapticTap(); // powerup pickup
  state.sessionPowerups++;
  const def = POWERUP_TYPES[typeIdx];
  showBanner(def.label, 'mission', 1500);
  if (def.id === 'shield') state.sessionShields++;
  if (def.id === 'laser') state.sessionLasers++;
  if (def.id === 'invincible') state.sessionInvincibles++;
  if (def.id !== 'shield') playPickup(typeIdx); // shield has its own activate sound
  addCrashFlash(def.color);

  switch (def.id) {
    case 'shield': {
      const tier = loadUpgradeTier('shield');
      state.shieldActive = true;
      // T1=10s, T2=15s, T3+=permanent (0 = no timer)
      state.shieldDuration = (tier >= 3) ? 0 : (tier >= 2) ? 15 : 10;
      state.shieldTimer = state.shieldDuration;
      // T1-T3=1hit, T4=stacks to 2, T5=stacks to 3
      const maxHits = (tier >= 5) ? 3 : (tier >= 4) ? 2 : 1;
      if (state.shieldActive && state.shieldHitPoints > 0 && maxHits > 1) {
        // Stacking: add a hit point up to max
        state.shieldHitPoints = Math.min(maxHits, state.shieldHitPoints + 1);
      } else {
        state.shieldHitPoints = 1;
      }
      // Color based on tier (changes at T3+ permanent)
      // T1-T2=cyan, T3=green, T4=purple, T5=orange
      const shieldTierColors = [0x26aeff, 0x26aeff, 0x00f0cc, 0x00f0cc, 0x00f0cc];
      const sc = shieldTierColors[tier - 1] || 0x00f0ff;
      shieldMat.uniforms.uColor.value.setHex(sc);
      shieldMat.uniforms.uNoiseEdgeColor.value.setHex(sc);
      shieldLight.color.setHex(sc);
      state.shieldBuildT = 0;
      state._shieldBreakT = null;
      shieldMesh.visible = false;
      shieldWire.visible = false;
      shieldLight.intensity = 0;
      const _shActSfx = document.getElementById('shield-activate-sfx'); if (_shActSfx) { _shActSfx.currentTime = 0; _shActSfx.play().catch(()=>{}); }
      break;
    }
    case 'laser': {
      const tier = loadUpgradeTier('laser');
      state.laserActive = true;
      state.laserTier = tier;
      // Base duration 4s, +25% per tier above 1
      const baseDur = 4;
      state.laserTimer = baseDur * (1 + (tier - 1) * 0.25);
      // Laser color evolves: red → orange → yellow → white-hot
      const laserColors = [0xff2200, 0xff5500, 0xff8800, 0xffbb00, 0xffee44];
      state.laserColor = laserColors[tier - 1];
      if (tier <= 3) {
        // T1-T3: bolt machine gun mode
        laserPivot.visible = false;
        state.laserBoltTimer = 0;
        // Play laser beam SFX — loop for the duration of the laser
        const _lsfx = document.getElementById('laser-beam-sfx');
        if (_lsfx && !state.muted) {
          _lsfx.currentTime = 0;
          _lsfx.volume = 0.5;
          _lsfx.loop = true;
          _lsfx.play().catch(()=>{});
          // Stop when laser expires
          setTimeout(() => { _lsfx.loop = false; _lsfx.pause(); _lsfx.currentTime = 0; }, state.laserTimer * 1000);
        }
        // T1/T2: 2 lanes, narrow. T3: 4 lanes, wider spread
        // If scene tuner (T) is open, let slider values stay in control
        if (!window._sceneTunerOpen) {
          const _lc = SHIP_SKINS[activeSkinIdx] && SHIP_SKINS[activeSkinIdx].laserConfig;
          if (_lc) {
            state._laserBoltLanes  = _lc.lanes;
            state._laserBoltSpread = _lc.spread;
            state._laserBoltYOff   = _lc.yOff;
            state._laserBoltZOff   = _lc.zOff;
            state._laserBoltLen    = _lc.len;
            state._laserBoltGlow   = _lc.glowLen;
            state.laserFireRate    = _lc.fireRate;
          } else {
            state._laserBoltLanes  = tier <= 2 ? 2 : 4;
            state._laserBoltSpread = tier <= 2 ? 0.35 : 0.50;
            state._laserBoltYOff   = tier <= 2 ? 0 : -0.25;
            state._laserBoltZOff   = -2;
            state._laserBoltLen    = tier <= 2 ? 2.0 : 1.9;
            state._laserBoltGlow   = tier <= 2 ? 2.5 : 2.7;
            state.laserFireRate    = _lbFireRate;
          }
        }
      } else if (tier === 4) {
        // T4: unibeam
        state.laserBoltTimer = 0;
        state._laserScanActive = false;
        const _ubsfx = document.getElementById('unibeam-sfx');
        if (_ubsfx && !state.muted) { _ubsfx.currentTime = 0; _ubsfx.volume = 0.6; _ubsfx.loop = true; _ubsfx.play().catch(()=>{}); }
        setTimeout(() => { const s = document.getElementById('unibeam-sfx'); if (s) { s.loop = false; s.pause(); s.currentTime = 0; } }, state.laserTimer * 1000);
      } else {
        // T5: scanning unibeam
        state._laserScanAngle  = 0;
        state._laserScanDir    = 1;
        state._laserScanActive = true;
        state.laserBoltTimer   = 0;
        const _ubsfx = document.getElementById('unibeam-sfx');
        if (_ubsfx && !state.muted) { _ubsfx.currentTime = 0; _ubsfx.volume = 0.6; _ubsfx.loop = true; _ubsfx.play().catch(()=>{}); }
        setTimeout(() => { const s = document.getElementById('unibeam-sfx'); if (s) { s.loop = false; s.pause(); s.currentTime = 0; } }, state.laserTimer * 1000);
      }
      break;
    }
    case 'invincible': {
      const tier = loadUpgradeTier('invincible');
      state.shieldActive = true;
      state.invincibleTimer = [5, 6, 7.5, 9, 10][tier - 1];
      state.invincibleGrace = (tier >= 5) ? 3.0 : 2.0;
      state.invincibleSpeedActive = true;
      shieldMesh.visible = false; shieldWire.visible = false;
      shieldMat.uniforms.uReveal.value = 1.0;
      shieldWireMat.opacity = 0;
      shieldLight.intensity = 0;
      break;
    }

    case 'magnet': {
      const tier = loadUpgradeTier('magnet');
      state.magnetActive = true;
      state.magnetTimer = [4, 5, 6, 7, 8][tier - 1];
      state.magnetRadius = [18, 21, 23, 27, 31][tier - 1];
      state.magnetPullsPowerups = (tier >= 5);
      magnetRing.visible = true; magnetRing2.visible = true;
      _startMagnetWhir();
      break;
    }
  }
  updatePowerupTray();
}

function updateMultiplierHUD() {
  const el = document.getElementById('hud-multiplier');
  if (state.multiplier > 1) {
    el.textContent = `✕${state.multiplier}`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function updatePowerupTray() {
  const tray = document.getElementById('powerup-tray');
  tray.innerHTML = '';

  // Shield: show as dots at bottom center (separate from tray)
  let shieldDots = document.getElementById('shield-dots');
  if (!shieldDots) {
    shieldDots = document.createElement('div');
    shieldDots.id = 'shield-dots';
    shieldDots.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:60;pointer-events:none;';
    document.body.appendChild(shieldDots);
  }
  if (state.shieldActive && state.invincibleTimer <= 0) {
    const hp = state.shieldHitPoints || 1;
    shieldDots.innerHTML = '';
    for (let i = 0; i < hp; i++) {
      const dot = document.createElement('div');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#00f0ff;box-shadow:0 0 6px #00f0ff;opacity:0.8;';
      shieldDots.appendChild(dot);
    }
    shieldDots.style.display = 'flex';
  } else {
    shieldDots.style.display = 'none';
  }

  // Timed powerups: just countdown bars, no icons
  const slots = [];
  if (state.laserActive)        slots.push({ t: state.laserTimer, max: state.laserTimer > 0 ? [4,5,6,7,8][Math.max(0,(state.laserTier||1)-1)] : 8, color: state.laserColor || 0xff2200 });
  if (state.invincibleTimer > 0) slots.push({ t: state.invincibleTimer, max: [5,6,7.5,9,10][(loadUpgradeTier('invincible')||1)-1], color: 0xffcc00 });
  if (state.magnetActive)       slots.push({ t: state.magnetTimer, max: [4,5,6,7,8][(loadUpgradeTier('magnet')||1)-1], color: 0x44ff88 });
  if (state.shieldActive && state.shieldDuration > 0) slots.push({ t: state.shieldTimer, max: state.shieldDuration, color: 0x26aeff });

  slots.forEach(s => {
    const slot = document.createElement('div');
    slot.className = 'powerup-slot';
    const pct = Math.min(100, (s.t / s.max) * 100);
    const hex = '#' + s.color.toString(16).padStart(6, '0');
    slot.innerHTML = `<div class="powerup-bar-track"><div class="powerup-bar-fill" style="width:${pct}%;background:${hex}"></div></div>`;
    tray.appendChild(slot);
  });
}

// ═══════════════════════════════════════════════════
//  CRASH FLASH
// ═══════════════════════════════════════════════════
function addCrashFlash(hexColor) {
  const el = document.createElement('div');
  el.className = 'crash-flash';
  if (hexColor) el.style.background = `radial-gradient(ellipse at center, rgba(${(hexColor>>16)&255},${(hexColor>>8)&255},${hexColor&255},0.6), transparent)`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// ═══════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════
const keys = {};
// Touch control state — fed by on-screen buttons
const touch = { left: false, right: false, rollUp: false, rollDown: false, rollToggle: false };
function setPauseOverlay(visible) {
  const el = document.getElementById('pause-overlay');
  if (!el) return;
  if (visible) {
    el.classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
  } else {
    el.classList.add('hidden');
    if (state.phase === 'playing') document.getElementById('hud').classList.remove('hidden');
  }
}
// Expose for inline onclick on pause buttons
window.togglePause    = () => { if (state.phase === 'playing' || state.phase === 'paused') togglePause(); };
window.returnToTitle  = returnToTitle;
window.playResumeSound = () => playResumeSound();
window.playExitSound   = () => playExitSound();
// Helper: which music track should be playing right now in-game?
function currentGameTrack() {
  // Death Run: title track early, l4 after speed tier 3 crossfade
  if (state.isDeathRun) {
    // Use stage index to determine correct track
    const _idx = state.seqStageIdx || 0;
    if (_idx >= 8) return 'keepgoing'; // RECOVERY_2 is idx 8, everything after uses keepgoing
    if (_idx >= 3) return 'l4';        // T3B_L3BOSS onwards uses l4
    return 'bg';
  }
  // Title only plays after the L5 corridor completes (ending/sail-out phase)
  if (state.currentLevelIdx === 4 && state.l5CorridorDone) return 'title';
  if (state.currentLevelIdx >= 3) return 'l4';  // L4 and all of L5 up to corridor end
  if (state.currentLevelIdx >= 2) return 'l3';
  return 'bg';
}

// (crossfadeTracks is defined earlier as a thin wrapper around musicFadeTo)

function togglePause() {
  if (state.phase === 'playing') {
    state.phase = 'paused';
    // Kill any in-flight intro text
    clearIntroTimers();
    const _introOv = document.getElementById('intro-overlay');
    if (_introOv) { fadeOutIntroOverlay(_introOv); }
    state.introActive = false;
    killThrusterSputter();
    // Pause engine SFX
    const _engP = document.getElementById('engine-start');
    const _roarP = document.getElementById('engine-roar');
    if (_engP && !_engP.paused) _engP.pause();
    if (_roarP && !_roarP.paused) _roarP.pause();
    setPauseOverlay(true);
    pauseGameTrackInPlace(currentGameTrack());
    if (state._tutorialActive) _tutHideText();
  } else if (state.phase === 'paused') {
    state.phase = 'playing';
    setPauseOverlay(false);
    resumeGameTrackInPlace(currentGameTrack());
    if (state._tutorialActive) { const el = document.getElementById('tutorial-overlay'); if (el) el.style.opacity = '1'; }
  }
}

function returnToTitle() {
  state.phase = 'title';
  shipGroup.visible = true;
  _killExplosion();
  // ── Hard camera reset: prevent stale death/retry camera leaking into title ──
  _retrySweepActive = false;
  _retrySweepT = 0;
  cameraPivot.position.set(0, 2.8 + _camPivotYOffset, 9 + _camPivotZOffset);
  cameraRoll = 0;
  camera.rotation.set(0, 0, 0);
  camera.position.set(0, 0, 0);
  camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
  camera.fov = _baseFOV;
  camera.updateProjectionMatrix();
  if (_gameOverDelayTimer) { clearTimeout(_gameOverDelayTimer); _gameOverDelayTimer = null; }
  if (_titleFadeTimer) { clearTimeout(_titleFadeTimer); _titleFadeTimer = null; }
  clearMusicTimers();
  // Show inline leaderboard on title
  const _tlb = document.getElementById('title-leaderboard');
  if (_tlb) _tlb.classList.remove('hidden');
  renderLeaderboard();
  // Clean up any tutorial overlays
  _tutDestroyOverlay();
  // Clear any active banners
  const bc = document.getElementById('banner-container');
  if (bc) bc.innerHTML = '';
  // Reset title ship glow pulse state
  _titleGlowPhase = 0;
  for (const entry of _titleMeshMap) {
    const mat = entry.mesh.material;
    if (mat && mat.userData && mat.userData._baseEI !== undefined) {
      mat.emissiveIntensity = mat.userData._baseEI;
      delete mat.userData._baseEI;
    }
  }
  // Kill any in-flight intro text
  clearIntroTimers();
  const _introOv = document.getElementById('intro-overlay');
  if (_introOv) { fadeOutIntroOverlay(_introOv); }
  state.introActive = false;
  killThrusterSputter();
  // Clear all in-flight objects and mechanic state
  _clearAllMechanics();
  [..._activeForcefields].forEach(returnForcefieldToPool);
  _activeForcefields.length = 0;
  // Show title, hide everything else
  const _tEl = document.getElementById('title-screen');
  _tEl.classList.remove('hidden');
  _tEl.classList.remove('fading-out');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('reward-wheel-overlay').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  setPauseOverlay(false);
  document.getElementById('touch-controls').classList.add('hidden');
  document.getElementById('settings-btn').style.display = ''; // show gear on title/gameover
  document.getElementById('lb-icon-btn').style.display = ''; // show trophy on title
  document.getElementById('lb-overlay').classList.add('hidden'); // close leaderboard overlay
  // Stop all gameplay music, reset to start, clear crossfade timer, restart title music
  if (activeFadeIv) { clearInterval(activeFadeIv); activeFadeIv = null; }
  ['bg', 'l3', 'l4'].forEach(k => {
    const el = allTracks()[k];
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setTrackVol(k, 0);
  });
  // Stop lake ambience on return to title
  if (lakeMusic) { lakeMusic.pause(); lakeMusic.currentTime = 0; setTrackVol('lake', 0); }
  // Stop engine SFX
  const _engR = document.getElementById('engine-start');
  const _roarR = document.getElementById('engine-roar');
  if (_engR) { _engR.pause(); _engR.currentTime = 0; }
  if (_roarR) { _roarR.pause(); _roarR.currentTime = 0; }
  if (titleMusic) { titleMusic.currentTime = 0; setTrackVol('title', state.muted ? 0 : TRACK_VOL.title); if (!state.muted) titleMusic.play().catch(() => {}); }
  updateTitleCoins();
  updateTitleFuelCells();
  updateTitleLevel();
  updateTitleBadges();
  updateNotificationDots();
  updateStreakBadge();
  initSkinViewer();
  fetchLeaderboard();
}

// Clears all corridor flags — called by hotkeys so speed freeze doesn't carry over
// Wipes every in-flight gameplay object (cones, walls, lethal rings) and
// resets every mechanic flag so nothing lingers across repair-ship or restart.
function _clearAllMechanics() {
  // Return pooled objects
  for (let i = activeObstacles.length - 1; i >= 0; i--) returnObstacleToPool(activeObstacles[i]);
  activeObstacles.length = 0;
  [..._awActive].forEach(_returnWallToPool);
  _awActive.length = 0;
  for (const lr of _lethalRingActive) { lr.userData.active = false; lr.visible = false; lr.position.set(0,-9999,0); }
  _lethalRingActive.length = 0;
  // Reset all mechanic flags
  clearAllCorridorFlags();
  state.gauntletActive = false;
  state.gauntletRowsLeft = 0;
  state._arcActive = false;
  state._arcQueue = null;
  state._arcStage = 0;
}

function clearAllCorridorFlags() {
  state.corridorMode       = false;
  state.l4CorridorActive   = false;
  state.l4CorridorDone     = false;
  state.l5CorridorActive   = false;
  state.l5CorridorDone     = false;
  state.zipperActive       = false;
  state.slalomActive       = false;
  state.slalomRowsDone     = 0;
  state.slalomMaxRows      = 0;
  state.drPatternCooldown  = 0;
  state.drCustomPatternActive = false;
  state.drCustomPatternRow = 0;
  state.drCustomPatternSpawnZ = -7;
  state.angledWallsActive  = false;
  state.angledWallRowsDone = 0;
  state.angledWallSpawnZ   = -_awTuner.zSpacing;
  state._seqAngledTimer    = 0;
  state._seqStructuredTimer = 0;
  state._drL3MaxRows       = 0;
  state._drL4MaxRows       = 0;
  state._drL5MaxRows       = 0;
  state.corridorDelay      = 0;
  state.postL3Gap          = 0;
}

window.addEventListener('keydown', e => {
  keys[e.key] = true;
  const isSpace = (e.key === ' ' || e.code === 'Space');
  if (isSpace) e.preventDefault();
  // Snapshot phase BEFORE any action so we don't double-fire
  const phaseAtEvent = state.phase;
  const isMute = (e.key === 'm' || e.key === 'M');
  const isWaterToggle = (e.key === 'w' && !e.shiftKey);
  if (phaseAtEvent === 'title' && isWaterToggle) {
    mirrorMesh.visible = !mirrorMesh.visible;
    return;
  }
  const isEnter = (e.key === 'Enter');
  const isArrowLR = (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
  // Arrow keys on title screen navigate skins (don't start game)
  if (phaseAtEvent === 'title' && isArrowLR) {
    if (e.key === 'ArrowLeft') { let _ni = (skinViewerIdx - 1 + SHIP_SKINS.length) % SHIP_SKINS.length; while (SHIP_SKINS[_ni] && SHIP_SKINS[_ni].hidden) _ni = (_ni - 1 + SHIP_SKINS.length) % SHIP_SKINS.length; navigateToSkin(_ni); }
    if (e.key === 'ArrowRight') { let _ni = (skinViewerIdx + 1) % SHIP_SKINS.length; while (SHIP_SKINS[_ni] && SHIP_SKINS[_ni].hidden) _ni = (_ni + 1) % SHIP_SKINS.length; navigateToSkin(_ni); }
    return;
  }
  if (isSpace && phaseAtEvent === 'title')   { playStartSound(); startGame(); }
  // if (isSpace && phaseAtEvent === 'playing') triggerJump(); // JUMP QUARANTINED
  if (e.key === 'Escape' && phaseAtEvent === 'playing') togglePause();
  if (e.key === 'Escape' && phaseAtEvent === 'paused')  togglePause();
  if (isSpace && phaseAtEvent === 'paused')  togglePause();
  if (isSpace && phaseAtEvent === 'dead')  { initAudio(); _triggerRetryWithSweep(); }
  // Enter skips the intro text sequence
  if (e.key === 'Enter' && state.phase === 'playing' && state.introActive && !state.isDeathRun) {
    clearIntroTimers();
    const _ov = document.getElementById('intro-overlay');
    if (_ov) { fadeOutIntroOverlay(_ov); }
    state.introActive = false;
    beginThrusterSputter();
    // Trigger lift so ship rises from 0.38 to cruise height
    state._introLiftActive = true;
    state._introLiftTimer = 0;
    const _roar = document.getElementById('engine-roar');
    if (_roar && !state.muted) { _roar.currentTime = 0; _roar.volume = 0.7; _roar.play().catch(()=>{}); }
  }
  // Escape now pauses (handled above) — no longer returns to title
  // Hold-to-spin roll — up/down keys spin ship on Z axis while held
  if (state.phase === 'playing') {
    if (e.key === 'ArrowUp')   { state.rollHeld = true; state.rollDir = -1; }
    if (e.key === 'ArrowDown') { state.rollHeld = true; state.rollDir =  1; }
  }
  if (e.key === 'm' || e.key === 'M') toggleMute();
  // Level skipper for testing: press 1-5
  // ── Debug hotkeys: Sequencer stage jumping (numbers 1-9) + debug toggles ──
  const _digit = e.code.startsWith('Digit') ? e.code.replace('Digit','') : null;
  if (state.phase === 'playing' && state.isDeathRun && _digit) {
    // 1=T1_WARMUP  2=T2_RAMPUP  3=T3A_ZIPS  4=T3B_L3BOSS
    // 5=T4A_ANGLED  6=T4B_LETHAL  7=T4C_L4BOSS  8=T5A_FATCONES
    // Shift+1=T5B_SLALOM_ZIP  Shift+2=T5C_L5BOSS  Shift+3=ENDLESS
    const stageMap = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 5, '6': 6, '7': 7, '8': 9 };
    const _hotkeyJump = (idx) => {
      const s = DR_SEQUENCE[idx];
      if (!s) return;
      clearAllCorridorFlags(); state.deathRunRestBeat = 0;
      state.seqStageIdx = idx; state.seqStageElapsed = 0;
      state._seqCorridorStarted = false; state._seqSpawnMode = 'cones'; state._seqConeDensity = 'normal';
      state._seqVibeApplied = -1; state._restBeepFired = false;
      state.speed = BASE_SPEED * s.speed;
      // Fire music transitions for hotkey jumps too
      if (s.name === 'T3B_L3BOSS') musicFadeTo('l4', 2000);
      if (s.name === 'RECOVERY_2' || idx > 7) musicFadeTo('keepgoing', 2000);
      console.log('[SEQ-DEBUG] Jump to stage ' + idx + ': ' + s.name);
    };
    if (e.shiftKey && _digit === '1') {
      _hotkeyJump(10); // T5B_SLALOM_ZIP
    } else if (e.shiftKey && _digit === '2') {
      _hotkeyJump(11); // T5C_L5BOSS
    } else if (e.shiftKey && _digit === '3') {
      state.drPhase = 'RELEASE'; state.drPhaseTimer = 0; state.drPhaseDuration = 2;
      _hotkeyJump(13); // ENDLESS
    } else if (!e.shiftKey && stageMap[_digit] !== undefined) {
      _hotkeyJump(stageMap[_digit]);
    } else if (e.key === '9') {
      // Toggle debug HUD overlay
      _drDebugHudVisible = !_drDebugHudVisible;
      const el = document.getElementById('dr-debug-hud');
      if (el) el.style.display = _drDebugHudVisible ? 'block' : 'none';
      console.log('[SEQ-DEBUG] Debug HUD ' + (_drDebugHudVisible ? 'ON' : 'OFF'));
    } else if (_digit === '0') {
      _hotkeyJump(11); // T5C_L5BOSS (gold sun)
    }
    return; // consume key in DR mode
  }
  // toggle no-spawn test mode
  if ((e.key === "'" || e.key === '`' || e.key === '\\' || e.key === 'n' || e.key === 'N') && state.phase === 'playing') {
    _noSpawnMode = !_noSpawnMode;
    // Flash HUD message so player knows it fired
    const _nsEl = document.createElement('div');
    _nsEl.textContent = _noSpawnMode ? 'SPAWN OFF' : 'SPAWN ON';
    _nsEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;font-family:monospace;font-size:24px;font-weight:bold;pointer-events:none;z-index:9999;opacity:1;transition:opacity 1s';
    document.body.appendChild(_nsEl);
    setTimeout(() => { _nsEl.style.opacity = '0'; setTimeout(() => _nsEl.remove(), 1000); }, 500);
  }

  // In-game powerup hotkeys (playing only, >1s in): L=laser S=shield I=invincible M=magnet
  if (state.phase === 'playing' && (state.elapsed || 0) > 1.0) {
    if (e.key === 'l' || e.key === 'L') applyPowerup(1); // laser
    if (e.key === 's' || e.key === 'S') applyPowerup(0); // shield
    if (e.key === 'i' || e.key === 'I') applyPowerup(2); // invincible
    if (e.key === 'm' || e.key === 'M') applyPowerup(3); // magnet
  }

  // R = spawn bonus rings + tuner (DR only)
  if ((e.key === 'r' || e.key === 'R') && !state._tutorialActive) {
    if (state.isDeathRun && state.phase === 'playing') {
      if (_bonusRings.length === 0) {
        _ringSpawnRow();
        state.speed = 0; // live pause for tuning
      } else {
        state.speed = BASE_SPEED * (LEVELS[Math.min((state.deathRunSpeedTier || 0) + 1, 4)].speedMult);
      }
      _ringShowTuner();
      console.log('[DR-DEBUG] Ring tuner toggled. Rings: ' + _bonusRings.length);
    }
  }
  // P = force custom pattern (DR only)
  if (e.key === 'p' || e.key === 'P') {
    if (state.isDeathRun && state.phase === 'playing') {
      state.drPhase = 'RELEASE'; state.drPhaseTimer = 0; state.drPhaseDuration = 2;
      const _s = DR_SEQUENCE[13]; if (_s) {
        clearAllCorridorFlags(); state.deathRunRestBeat = 0;
        state.seqStageIdx = 13; state.seqStageElapsed = 0;
        state._seqCorridorStarted = false; state._seqSpawnMode = 'cones'; state._seqConeDensity = 'normal';
        state._seqVibeApplied = -1;
        state.speed = BASE_SPEED * _s.speed;
        console.log('[SEQ-DEBUG] Jump to ENDLESS via P');
      }
    }
  }
  // ── Force specific mechanics / arcs (DR only) ──
  if (state.isDeathRun && state.phase === 'playing') {
    let _forceBandIdx = DR2_RUN_BANDS.length - 1;
    for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
      if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _forceBandIdx = bi; break; }
    }
    const _forceBand = DR2_RUN_BANDS[_forceBandIdx];
    const _forceKey = e.key.toUpperCase();
    const _forceMap = {
      'C': 'CORRIDOR_ARC',
      'X': 'SLALOM_ARC',
      'Z': 'ZIPPER_ARC',
      'V': 'L3_CORRIDOR',
      'K': 'L4_SINE_CORRIDOR',
      'J': 'L5_SINE_CORRIDOR',
      'Q': 'SLALOM',
      'N': 'ZIPPER',
      'B': 'ANGLED_WALL',
    };
    if (_forceMap[_forceKey]) {
      const famKey = _forceMap[_forceKey];
      const fam = DR_MECHANIC_FAMILIES[famKey];
      if (fam) {
        clearAllCorridorFlags(); state.deathRunRestBeat = 0;
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0; state.drPhaseDuration = 0;
        fam.activate(_forceBand, 'build');
        console.log('[DR-DEBUG] Forced ' + famKey);
      }
    }
  }
  // Campaign mode: original level-skip keys
  if (state.phase === 'playing' && !state.isDeathRun && ['1','2','3','4','5'].includes(e.key)) {
    const idx = parseInt(e.key) - 1;
    if (idx < LEVELS.length) {
      clearAllCorridorFlags();
      state.currentLevelIdx = idx;
      state.score = LEVELS[idx].scoreThreshold;
      currentLevelDef = LEVELS[idx];
      targetLevelDef  = LEVELS[idx];
      transitionT     = 1;
      applyLevelVisuals(LEVELS[idx]);
      updateHUDLevel();
      if (idx <= 1) setActiveMusic('bg');
      else if (idx === 2) setActiveMusic('l3');
      else if (idx >= 3) setActiveMusic('l4');
    }
  }
  // Key 0: toggle debug hitbox wireframes (campaign)
  if (state.phase === 'playing' && !state.isDeathRun && e.key === '0') {
    debugHitboxes = !debugHitboxes;
  }
  // Key T: toggle L4 aurora tendrils
  if ((e.key === 't' || e.key === 'T') && state.phase === 'playing' && !state._tutorialActive) {
    auroraTVisible = !auroraTVisible;
    auroraGroup.visible = auroraTVisible;
    l5fGroup.visible = auroraTVisible;
  }
  // Campaign key 9: skip to right before L4 corridor
  if (state.phase === 'playing' && !state.isDeathRun && e.key === '9') {
    clearAllCorridorFlags();
    const l4 = LEVELS[3];
    state.currentLevelIdx  = 3;
    state.score            = l4.scoreThreshold;
    currentLevelDef = l4; targetLevelDef = l4; transitionT = 1;
    applyLevelVisuals(l4); updateHUDLevel();
    state.levelElapsed     = L4_CORRIDOR_TRIGGER_S - 2;
    state.l4CorridorActive = false;
    state.l4CorridorDone   = false;
    state.l4RowsDone       = 0;
    state.l4SineT          = 0;
    setActiveMusic('l4');
  }
  // Campaign key 7: skip to midway through L3 corridor
  if (state.phase === 'playing' && !state.isDeathRun && e.key === '7') {
    const l3 = LEVELS[2];
    state.currentLevelIdx = 2;
    state.score           = l3.scoreThreshold + 171;
    currentLevelDef = l3; targetLevelDef = l3; transitionT = 1;
    applyLevelVisuals(l3); updateHUDLevel();
    state.corridorMode       = true;
    state.corridorSpawnZ     = -7;
    state.corridorRowsDone   = 200;
    state.corridorDelay      = 0;
    state.corridorGapCenter  = 0;
    state.corridorGapDir     = 1;
    state.corridorSineT      = 0;
    state.levelElapsed       = 68;
    state.postL3Gap          = 0;
    setActiveMusic('l3');
  }
  // Campaign key 6: skip to L5 post-2nd-zipper
  if (state.phase === 'playing' && !state.isDeathRun && e.key === '6') {
    clearAllCorridorFlags();
    const l5 = LEVELS[4];
    state.currentLevelIdx = 4;
    state.score = l5.scoreThreshold;
    currentLevelDef = l5; targetLevelDef = l5; transitionT = 1;
    applyLevelVisuals(l5); updateHUDLevel();
    // Fast-forward zipper state to: 2 runs done, random cones phase starting
    state.zipperActive        = false;
    state.zipperRunCount      = 2;
    l5DustPoints.visible = true;  // key-6 skip: enable chromatic dust
    // l4 is the correct track here — title fires when corridor ends
    setActiveMusic('l4');
    state.zipperCooldown      = 99999;
    state.l5EndingActive      = false;
    state.l5CorridorActive    = false;
    state.l5CorridorDone      = false;
    state.l5CorridorRowsDone  = 0;
    state.l5CorridorSpawnZ    = -7;
    state.l5SineT             = 0;
    state.l5RandomAfterZipper = 5.0;  // 5s of random cones, then corridor fires

  }
});
window.addEventListener('keyup', e => {
  keys[e.key] = false;
  // Release thrust on spacebar up
  // if (e.key === ' ') _thrustHeld = false; // JUMP QUARANTINED
  // Release roll spin
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    state.rollHeld = false;
    // Keep rollDir so we know which way to return
  }
});

// ── TOUCH CONTROLS ──────────────────────────────────────────────────────────
(function setupTouch() {
  // Swipe threshold in pixels — swipe up/down to toggle roll
  const SWIPE_THRESH = 14;

  function bindSteerZone(id, stateKey, rollKey) {
    const el = document.getElementById(id);
    if (!el) return;

    // Per-touch tracking: touchId -> { startY, swiped }
    const activeTouches = new Map();

    const setSteer = (v) => {
      touch[stateKey] = v;
      if (v) el.classList.add('active');
      else   el.classList.remove('active');
    };

    el.addEventListener('touchstart', e => {
      e.preventDefault();
      // If intro is active — tap anywhere skips it
      if (state.phase === 'playing' && state.introActive && !state.isDeathRun) {
        const _ov = document.getElementById('intro-overlay');
        clearIntroTimers();
        if (_ov) fadeOutIntroOverlay(_ov);
        state.introActive = false;
        beginThrusterSputter();
        state._introLiftActive = true;
        state._introLiftTimer = 0;
        const _roar = document.getElementById('engine-roar');
        if (_roar && !state.muted) { _roar.currentTime = 0; _roar.volume = 0.7; _roar.play().catch(()=>{}); }
        return;
      }
      // Start game if on title/dead — mark this touch as game-starting (ignore swipes from it)
      const ph = state.phase;
      const isStartingTouch = (ph === 'title' || ph === 'dead');
      for (const t of e.changedTouches) {
        activeTouches.set(t.identifier, { startY: t.clientY, swiped: false, isStart: isStartingTouch });
      }
      // Enable steering while finger is down
      setSteer(true);
      if (isStartingTouch) {
        if (ph === 'dead') {
          if (!_gameOverTapReady) return; // cooldown guard
          _triggerRetryWithSweep();
        }
        else if (ph === 'title') startGame();
      }
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      e.preventDefault();
      // Only allow roll toggle during active gameplay (not title, death, intro)
      if (state.phase === 'playing' && !state.introActive) {
        for (const t of e.changedTouches) {
          const info = activeTouches.get(t.identifier);
          if (!info || info.swiped || info.isStart) continue;
          const dy = t.clientY - info.startY;
          if (dy < -SWIPE_THRESH) {
            info.swiped = true;
            touch.rollToggle = true;
            touch.rollUp = true;
            touch.rollDown = false;
          } else if (dy > SWIPE_THRESH) {
            info.swiped = true;
            touch.rollToggle = false;
            touch.rollUp = false;
            touch.rollDown = false;
          }
        }
      }
    }, { passive: false });

    const endTouch = (e) => {
      e.preventDefault();
      // Catch quick flicks that touchmove missed
      if (state.phase === 'playing' && !state.introActive) {
        for (const t of e.changedTouches) {
          const info = activeTouches.get(t.identifier);
          if (!info || info.swiped || info.isStart) continue;
          const dy = t.clientY - info.startY;
          if (dy < -SWIPE_THRESH) {
            touch.rollToggle = true;
            touch.rollUp = true;
            touch.rollDown = false;
          } else if (dy > SWIPE_THRESH) {
            touch.rollToggle = false;
            touch.rollUp = false;
            touch.rollDown = false;
          }
        }
      }
      for (const t of e.changedTouches) {
        activeTouches.delete(t.identifier);
      }
      // Release steer when no touches remain in this zone
      // Roll toggle persists — does NOT release on finger lift
      if (activeTouches.size === 0) {
        setSteer(false);
      }
    };
    el.addEventListener('touchend',    endTouch, { passive: false });
    el.addEventListener('touchcancel', endTouch, { passive: false });
  }

  // Left zone: steer left, swipe-up = rollUp (dir -1)
  // Right zone: steer right, swipe-up = rollDown (dir +1)
  bindSteerZone('touch-left',  'left',  'rollUp');
  bindSteerZone('touch-right', 'right', 'rollDown');

  const pauseBtn = document.getElementById('touch-pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      togglePause();
    }, { passive: false });
  }

  // Triple-tap skin label = unlock entire shop (all skins + all powerups max tier)
  const skinLabel = document.getElementById('skin-viewer-label');
  let _skinTapCount = 0;
  let _skinTapTimer = null;
  function _adminUnlockAll() {
    // Unlock all skins
    const allSkinNames = SHIP_SKINS.map(s => s.name);
    window._LS.setItem('jh_owned_skins', JSON.stringify(allSkinNames));
    // Unlock all powerups
    const allPuIds = POWERUP_TYPES.map(p => p.id);
    window._LS.setItem('jetslide_pu_unlocked', JSON.stringify(allPuIds));
    // Give plenty of fuel to buy upgrades
    saveFuelCells(loadFuelCells() + 99999);
    updateTitleFuelCells();
    console.log('[ADMIN] Full shop unlocked');
  }
  if (skinLabel) {
    skinLabel.addEventListener('touchstart', e => {
      _skinTapCount++;
      if (_skinTapTimer) clearTimeout(_skinTapTimer);
      if (_skinTapCount >= 3) { _skinTapCount = 0; _adminUnlockAll(); return; }
      _skinTapTimer = setTimeout(() => { _skinTapCount = 0; }, 500);
    }, { passive: true });
    skinLabel.addEventListener('click', () => {
      _skinTapCount++;
      if (_skinTapTimer) clearTimeout(_skinTapTimer);
      if (_skinTapCount >= 3) { _skinTapCount = 0; _adminUnlockAll(); return; }
      _skinTapTimer = setTimeout(() => { _skinTapCount = 0; }, 500);
    });
  }
})();

// Gyro removed — touch swipe controls handle roll

// ── ADD TO HOME SCREEN NUDGE (iOS Safari only) ───────────────────────────────
(function setupA2HS() {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true;
  if (!isIOS || isStandalone) return;

  const banner = document.getElementById('a2hs-banner');
  if (!banner) return;

  // Show after a short delay so it doesn't clash with page load
  setTimeout(() => { banner.classList.remove('hidden'); }, 2000);

  // Tap anywhere on the banner to dismiss
  banner.addEventListener('click', () => {
    banner.classList.add('hidden');
  });
  banner.addEventListener('touchend', (e) => {
    e.preventDefault();
    banner.classList.add('hidden');
  }, { passive: false });
})();

// ── LEVEL CHOOSER (mobile title screen) ─────────────────────────────────────
(function setupLevelChooser() {
  const btns = document.querySelectorAll('.level-btn');
  btns.forEach(btn => {
    btn.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      // Highlight selected
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const levelIdx = parseInt(btn.dataset.level);
      // Start the game then immediately jump to the chosen level
      startGame();
      // Apply level jump after a brief tick so game state is initialised
      requestAnimationFrame(() => {
        if (levelIdx === 0) return; // L1 is default, nothing to do
        state.startedFromL1 = false; // not eligible for leaderboard
        clearAllCorridorFlags();
        state.currentLevelIdx = levelIdx;
        state.score           = LEVELS[levelIdx].scoreThreshold;
        currentLevelDef  = LEVELS[levelIdx];
        targetLevelDef   = LEVELS[levelIdx];
        transitionT      = 1;
        applyLevelVisuals(LEVELS[levelIdx]);
        updateHUDLevel();
        if (levelIdx <= 1)     setActiveMusic('bg');
        else if (levelIdx === 2) setActiveMusic('l3');
        else                   setActiveMusic('l4');
      });
    }, { passive: false });
  });
})();

// Start title music on very first user interaction with the page
function initTitleAudio() {
  if (audioCtx) { _ensureCtxRunning(); return; }  // already initialized
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  _ensureCtxRunning();
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0.0;
  engineGain.connect(audioCtx.destination);
  _initSFXBuffers();  // pre-decode SFX for instant mobile playback
  bgMusic    = bgMusic    || document.getElementById('bgm');
  titleMusic = titleMusic || document.getElementById('title-music');
  if (!l3Music) { l3Music = document.getElementById('l3-music'); setTrackVol('l3', 0); }
  if (!l4Music) { l4Music = document.getElementById('l4-music'); setTrackVol('l4', 0); }
  // Only start title music if it isn't already playing (don't restart mid-track)
  if (!state.muted && titleMusic && titleMusic.paused) {
    titleMusic.currentTime = 0;
    titleMusic.play().catch(() => {});
  }
}
// Try autoplay immediately on load; fall back to first-interaction unlock
(function attemptAutoplay() {
  // Initialise audio objects without AudioContext (doesn't need gesture)
  titleMusic = document.getElementById('title-music');
  setTrackVol('title', 0.4);
  bgMusic    = document.getElementById('bgm');
  setTrackVol('bg', 0.45);
  if (!l3Music)   { l3Music   = document.getElementById('l3-music');   setTrackVol('l3', 0); }
  if (!l4Music)   { l4Music   = document.getElementById('l4-music');   setTrackVol('l4', 0); }
  if (!lakeMusic) { lakeMusic = document.getElementById('lake-music'); setTrackVol('lake', 0); }

  if (!state.muted) {
    titleMusic.currentTime = 0;
    titleMusic.play().then(() => {
      // Autoplay succeeded — nothing more to do
    }).catch(() => {
      // Autoplay blocked — unlock audio on first interaction (no visible overlay)
      const unlock = () => {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          engineGain = audioCtx.createGain();
          engineGain.gain.value = 0.0;
          engineGain.connect(audioCtx.destination);
          _initSFXBuffers();
        }
        _ensureCtxRunning();
        if (!state.muted) { titleMusic.currentTime = 0; titleMusic.play().catch(() => {}); }
      };
      ['click','keydown','touchstart'].forEach(e => document.addEventListener(e, unlock, {once:true}));
    });
  }
})();

// One-time listeners to finish AudioContext init on first gesture (needed for sound effects)
['click', 'keydown', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, function _firstInteraction() {
    initTitleAudio();
    document.removeEventListener(evt, _firstInteraction);
  }, { once: true });
});



// Show persisted coin total, fuel cells, and level on title screen on load
updateTitleCoins();
updateTitleFuelCells();
updateTitleLevel();
updateNotificationDots();
updateStreakBadge();
// Initialize skin viewer on load (GLB may not be loaded yet, but initSkinViewer handles that gracefully)
initSkinViewer();
// Fetch leaderboard on initial load
fetchLeaderboard();

function playStartSound() {
  if (state.muted) return;
  _ensureCtxRunning();
  const sfx = document.getElementById('start-sound');
  if (sfx) { sfx.currentTime = 0; sfx.volume = 0.85; sfx.play().catch(() => {}); }
}

function playResumeSound() {
  if (state.muted) return;
  _ensureCtxRunning();
  const sfx = document.getElementById('start-sound');
  if (sfx) { sfx.currentTime = 0; sfx.volume = 0.7; sfx.play().catch(() => {}); }
}

function playExitSound() {
  if (state.muted) return;
  _ensureCtxRunning();
  const sfx = document.getElementById('exit-sound');
  if (sfx) { sfx.currentTime = 0; sfx.volume = 0.9; sfx.playbackRate = 1.0; sfx.play().catch(() => {}); }
}
function playTitleTap() {
  if (state.muted) return;
  _ensureCtxRunning();
  const sfx = document.getElementById('exit-sound');
  if (sfx) { sfx.currentTime = 0; sfx.volume = 0.7; sfx.playbackRate = 0.85 + Math.random() * 0.5; sfx.play().catch(() => {}); }
}

// ═══════════════════════════════════════════════════════
//  SIGNAL SALVAGE — REWARD WHEEL
// ═══════════════════════════════════════════════════════
const WHEEL_SEGMENTS = [
  { type: 'coins',      amount: 25, label: '+25 COINS',       color: '#ffcc00', icon: '⬡' },
  { type: 'coins',      amount: 75, label: '+75 COINS',       color: '#ffcc00', icon: '⬡' },
  { type: 'fuelcells',  amount: 15, label: '+15 FUEL CELLS',  color: '#4488ff', icon: '⚡' },
  { type: 'fuelcells',  amount: 40, label: '+40 FUEL CELLS',  color: '#4488ff', icon: '⚡' },
  { type: 'headstart',  amount: 1,  label: 'FREE HEAD START', color: '#00ff88', icon: '▲' },
  { type: 'doublecoin', amount: 0,  label: '2× COINS NEXT RUN', color: '#ff4444', icon: '2×' },
];

function rollWheel() {
  const r = Math.random();
  const isDR = state.isDeathRun;
  // Death Run: shift 5% from 25 coins (idx 0) to 75 coins (idx 1)
  if (isDR) {
    if (r < 0.25) return 0;  // 25%
    if (r < 0.50) return 1;  // 25%
    if (r < 0.70) return 2;  // 20%
    if (r < 0.82) return 3;  // 12%
    if (r < 0.92) return 4;  // 10%
    return 5;                 // 8%
  }
  // Campaign
  if (r < 0.30) return 0;  // 30%
  if (r < 0.50) return 1;  // 20%
  if (r < 0.70) return 2;  // 20%
  if (r < 0.82) return 3;  // 12%
  if (r < 0.92) return 4;  // 10%
  return 5;                 // 8%
}

function applyWheelReward(segIdx) {
  const seg = WHEEL_SEGMENTS[segIdx];
  switch (seg.type) {
    case 'coins':
      saveCoinWallet(loadCoinWallet() + seg.amount);
      _totalCoins = loadCoinWallet();
      updateTitleCoins();
      break;
    case 'fuelcells':
      saveFuelCells(loadFuelCells() + seg.amount);
      updateTitleFuelCells();
      break;
    case 'headstart':
      saveFreeHeadStarts(loadFreeHeadStarts() + 1);
      break;
    case 'doublecoin': {
      const existing = window._LS.getItem('jetslide_double_next');
      if (existing) {
        const cur = parseInt(existing) || 1;
        window._LS.setItem('jetslide_double_next', String(Math.min(cur + 1, 2)));  // cap at 3x
      } else {
        window._LS.setItem('jetslide_double_next', '1');
      }
      break;
    }
  }
}

function showRewardWheel(segIdx, callback) {
  const overlay = document.getElementById('reward-wheel-overlay');
  const disc = document.getElementById('wheel-disc');
  const resultEl = document.getElementById('wheel-result');
  const tapHint = document.getElementById('wheel-tap-hint');
  const seg = WHEEL_SEGMENTS[segIdx];

  // Set pointer color to current level's grid color
  const pointer = overlay.querySelector('.wheel-pointer');
  let gridHex = '#00eeff';
  try {
    gridHex = '#' + currentLevelDef.gridColor.getHexString();
  } catch (e) {}
  pointer.style.color = gridHex;
  pointer.style.textShadow = '0 0 12px ' + gridHex + ', 0 0 24px ' + gridHex;

  // Set divider line colors on the disc
  disc.style.setProperty('--whl-line', gridHex);

  // Update conic-gradient dividers to use grid color
  const lineRGBA = gridHex;
  disc.style.background = '#0a0a12';

  // Reset state
  resultEl.classList.add('hidden');
  resultEl.textContent = '';
  tapHint.classList.remove('hidden');
  disc.style.transition = 'none';
  disc.style.transform = 'rotate(0deg)';

  // Hide gameover, show wheel
  document.getElementById('gameover-screen').classList.add('hidden');
  overlay.classList.remove('hidden');

  // Force reflow before starting animation
  void disc.offsetHeight;

  // Spin start SFX: rising tone
  playSFX(300, 0.3, 'sine', 0.1);
  setTimeout(() => playSFX(500, 0.2, 'sine', 0.1), 100);
  setTimeout(() => playSFX(800, 0.15, 'sine', 0.1), 200);

  // Physics-based spin — exact SO attractor approach
  const NUM_SEGS = 6;
  const inertia = 0.97;
  const minSpeed = 8;
  const randRange = 5;
  const maxAttractionForce = 0.5;
  const attractionForceFactor = 0.02;

  // Disc rotation needed to place segment idx under the pointer (top)
  // Segment CSS centers: idx*60 - 30 (idx0=-30, idx1=30, idx2=90, ...)
  // To bring center to top: rotate by (360 - center) % 360
  const SEG_TARGETS = [30, 330, 270, 210, 150, 90];
  function getAngleForIndex(idx) { return SEG_TARGETS[idx]; }
  function getSliceIndex(a) {
    // Which segment is under the pointer at disc rotation `a`?
    // Reverse of getAngleForIndex: find closest target
    let best = 0, bestDist = 999;
    for (let i = 0; i < NUM_SEGS; i++) {
      let d = Math.abs(getCircularDist(a, SEG_TARGETS[i]));
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }
  function getCircularDist(a, b) {
    const d1 = b - a;
    const d2 = b - (a - 360);
    return Math.abs(d1) >= Math.abs(d2) ? d2 : d1;
  }

  let angle = 0;
  let totalAngle = 0;
  let speed = Math.floor(Math.random() * randRange) + minSpeed;

  // Speed correction: estimate landing, adjust to hit target segment
  const estimatedSpin = speed / (1 - inertia);
  const estimatedSliceIdx = getSliceIndex((angle + estimatedSpin) % 360);
  const estimatedAngle = getAngleForIndex(estimatedSliceIdx);
  const targetAngle = getAngleForIndex(segIdx);
  const spinError = getCircularDist(estimatedAngle, targetAngle);
  speed += spinError * (1 - inertia);

  let lastSegCrossing = -1;
  let animFrame = null;

  let resolved = false;

  function resolveWheel(instant) {
    if (resolved) return;
    resolved = true;
    clearTimeout(safetyTimer);
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = null;
    // Remove tap listeners so stale taps don't leak through
    overlay.removeEventListener('click', onTap);
    overlay.removeEventListener('touchstart', onTap);
    tapHint.classList.add('hidden');

    // Snap to target using totalAngle (visual) aligned to target segment
    const tgt = getAngleForIndex(segIdx);
    const fullRots = Math.floor(totalAngle / 360);
    let snapAngle = fullRots * 360 + tgt;
    if (snapAngle < totalAngle - 30) snapAngle += 360;
    if (instant) {
      disc.style.transition = 'transform 0.3s ease-out';
    }
    disc.style.transform = 'rotate(' + snapAngle + 'deg)';

    const finishDelay = instant ? 350 : 100;
    setTimeout(() => {
      // Flash winning segment
      const winEl = disc.querySelector('[data-idx="' + segIdx + '"]');
      if (winEl) winEl.classList.add('winning');

      // Show result text
      resultEl.textContent = seg.label;
      resultEl.style.color = seg.color;
      resultEl.style.textShadow = '0 0 20px ' + seg.color;
      resultEl.classList.remove('hidden');

      // Play reward SFX
      playRewardSFX();

      // Particle fly-away
      const particleOrigin = disc;
      let dest = '#title-coin-count';
      let pColor = seg.color;
      let pIcon = seg.icon;
      let pCount = 36;
      if (seg.type === 'coins') { dest = '#title-coin-count'; pCount = Math.min(seg.amount / 5, 15) * 3 | 0; }
      else if (seg.type === 'fuelcells') { dest = '#title-fuelcell-count'; pCount = Math.min(seg.amount / 3, 15) * 3 | 0; }
      else { dest = null; }

      if (dest) {
        spawnRewardParticles(particleOrigin, dest, pColor, pIcon, pCount);
      }

      // Apply reward
      applyWheelReward(segIdx);

      // Auto-dismiss after 1.5s
      setTimeout(() => {
        overlay.classList.add('hidden');
        if (winEl) winEl.classList.remove('winning');
        disc.style.transition = 'none';
        disc.style.transform = 'rotate(0deg)';
        if (callback) callback();
      }, 1500);
    }, finishDelay);
  }

  // Start physics-based spin animation
  disc.style.transition = 'none';

  function spinFrame() {
    // Update angles
    totalAngle += speed;
    angle = ((angle + speed) % 360 + 360) % 360;

    // Decay speed (friction)
    speed = speed - (1 - inertia) * speed;

    // Attractor: inverse-distance force toward target segment center
    const target = getAngleForIndex(segIdx);
    const orientedDist = getCircularDist(angle, target);
    const inverseMag = orientedDist === 0
      ? maxAttractionForce
      : Math.min(1 / Math.abs(orientedDist), maxAttractionForce);
    const attractForce = Math.sign(orientedDist) * inverseMag * attractionForceFactor;
    speed += attractForce;

    // Apply visual rotation using totalAngle
    disc.style.transform = 'rotate(' + totalAngle + 'deg)';

    // Tick sound on segment boundary crossing
    const currentSeg = getSliceIndex(angle);
    if (currentSeg !== lastSegCrossing) {
      lastSegCrossing = currentSeg;
      const vol = Math.min(0.15, Math.abs(speed) * 0.01);
      if (vol > 0.01) playSFX(1200, 0.02, 'square', vol);
    }

    // Stop condition: speed very low AND very close to target
    if (Math.abs(speed) < 0.01 && Math.abs(orientedDist) < 0.05) {
      disc.style.transform = 'rotate(' + totalAngle + 'deg)';
      resolveWheel(false);
      return;
    }

    animFrame = requestAnimationFrame(spinFrame);
  }

  animFrame = requestAnimationFrame(spinFrame);

  // Safety timeout: force-resolve after 10s if physics hasn't stopped
  const safetyTimer = setTimeout(() => {
    if (!resolved) resolveWheel(false);
  }, 10000);

  // Tap-to-skip
  function onTap(e) {
    e.stopPropagation();
    overlay.removeEventListener('click', onTap);
    overlay.removeEventListener('touchstart', onTap);
    resolveWheel(true);
  }
  // Delay tap listener slightly to avoid instant trigger
  setTimeout(() => {
    overlay.addEventListener('click', onTap, { once: true });
    overlay.addEventListener('touchstart', onTap, { once: true });
  }, 300);
}

// ── BUTTON HANDLERS ──
document.getElementById('death-run-btn').addEventListener('click', () => {
  initAudio();
  // Pre-warm engine sounds on user gesture (mobile requires this)
  // Just load them — don't play, to avoid any audible glitch
  const _ewEng = document.getElementById('engine-start');
  const _ewRoar = document.getElementById('engine-roar');
  if (_ewEng) { _ewEng.load(); }
  if (_ewRoar) { _ewRoar.load(); }
  playStartSound();
  startDeathRun();
});
document.getElementById('restart-btn').addEventListener('click', () => {
  if (!_gameOverTapReady) return; // cooldown guard
  initAudio();
  playStartSound();
  _triggerRetryWithSweep();
});
document.getElementById('gameover-exit-btn').addEventListener('click', () => {
  if (!_gameOverTapReady) return; // cooldown guard
  playExitSound();
  // [WHEEL DISABLED] reward wheel quarantined — skip straight to title
  returnToTitle();
});
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

// ═══════════════════════════════════════════════════════
//  HAPTIC FEEDBACK
// ═══════════════════════════════════════════════════════
function hapticTap()    { if (_settings.hapticsOn && navigator.vibrate) navigator.vibrate(10); }
function hapticMedium() { if (_settings.hapticsOn && navigator.vibrate) navigator.vibrate(25); }
function hapticHeavy()  { if (_settings.hapticsOn && navigator.vibrate) navigator.vibrate([40, 30, 40]); }

// ═══════════════════════════════════════════════════════
//  ONBOARDING (first play only)
// ═══════════════════════════════════════════════════════
const ONBOARD_KEY = 'jh_onboarded';
function maybeShowOnboarding() {
  // Disabled auto-popup — accessible from settings "HOW TO PLAY" button only
  return false;
}

// Legacy mute compat — state.muted still checked in many places
function toggleMute() {
  // Full mute — toggle both music and SFX
  const allMuted = _settings.musicMuted && _settings.sfxMuted;
  _settings.musicMuted = !allMuted;
  _settings.sfxMuted = !allMuted;
  state.muted = !allMuted;
  applyMusicVolume();
  saveSettings();
}

// ═══════════════════════════════════════════════════
//  GAME STATE TRANSITIONS
// ═══════════════════════════════════════════════════
// Canyon-only test mode — activated by ?canyon=1 URL param, skips normal game flow
var _canyonTestMode = new URLSearchParams(location.search).get('canyon') === '1';
let _skipL1Intro = false;  // set by startDeathRun() so startGame() skips L1 cinematic
let _gameStarting = false; // reentry lock — prevents double-fire from simultaneous inputs

// ── Retry with cinematic camera sweep (from game over) ──
let _retryPending = false; // guard against double-tap during fade
function _triggerRetryWithSweep() {
  if (_retrySweepActive || _retryPending) return; // debounce
  _retryPending = true;
  _retryIsFromDead = true;
  const fadeEl = document.getElementById('retry-fade');
  fadeEl.style.opacity = '1'; // fade to black (CSS 0.15s transition)
  const _wasDeathRun = state.isDeathRun;
  const _wasJetLightning = state._jetLightningMode;
  // Save JL continuation state before the reset wipes it
  const _jlDeathX    = _wasJetLightning ? (state.shipX || 0) : 0;
  const _jlDeathRamp = _wasJetLightning ? (_jlRampTime || 0) : 0;
  setTimeout(() => {
    _retryPending = false;
    // ── During black: reset scene ──
    if (_wasJetLightning) startJetLightning();
    else if (_wasDeathRun) startDeathRun();
    else startGame();
    // JL: restore ramp time + X position so player continues from death spot
    if (_wasJetLightning) {
      _jlRampTime   = _jlDeathRamp;
      state.shipX   = _jlDeathX;
      state.shipVelX = 0;
      shipGroup.position.x = _jlDeathX;
    }
    // Override: skip prologue, ship already at hover, thrusters on
    killThrusterSputter();          // kill any lingering sputter timer
    state.introActive = true;       // blocks obstacle spawning during sweep
    state.thrusterPower = 1;        // thrusters on immediately
    shipGroup.position.y = _hoverBaseY; // already hovering
    state._introLiftActive = false; // no lift animation
    // Kill death camera orbit so it doesn't fight the sweep
    _expCamOrbitActive = false;
    _expCamOrbitT = 0;
    // Position camera at establishing shot (above + behind)
    cameraPivot.position.copy(_RETRY_CAM_START);
    // Reset camera lookAt AFTER pivot move so rotation matches new position
    camera.rotation.set(0, 0, 0);
    camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
    camera.fov = _RETRY_FOV_START;
    camera.updateProjectionMatrix();
    // Start the sweep
    _retrySweepActive = true;
    _retrySweepT = 0;
    playRetryWhoosh();
    // Fade from black
    fadeEl.style.opacity = '0';
  }, 180); // wait for fade-to-black to complete
}

function startGame() {
  if (_gameStarting) return; // reentry guard — ignore double-taps / simultaneous inputs
  _gameStarting = true;
  const _tlb = document.getElementById('title-leaderboard');
  if (_tlb) _tlb.classList.add('hidden');
  // Show onboarding on very first play
  if (maybeShowOnboarding()) { _gameStarting = false; return; } // blocks game start until dismissed
  // Reset title glow pulse on shared materials before gameplay
  for (const entry of _titleMeshMap) {
    const mat = entry.mesh.material;
    if (mat && mat.userData && mat.userData._baseEI !== undefined) {
      mat.emissiveIntensity = mat.userData._baseEI;
      delete mat.userData._baseEI;
    }
  }
  clearIntroTimers();   // cancel any orphaned intro text timers
  clearMusicTimers();   // cancel any orphaned music crossfade timers
  // Apply the saved skin for gameplay (revert from any locked preview)
  const _skinData = loadSkinData();
  if (_skinAdminMode || isSkinUnlocked(_skinData.selected)) {
    applySkin(_skinData.selected);
  } else {
    applySkin(0);
  }
  state.phase          = 'playing';
  shipGroup.visible    = true;
  _killExplosion();
  // Clean up terrain walls if active
  _destroyTerrainWalls();
  if (_gameOverDelayTimer) { clearTimeout(_gameOverDelayTimer); _gameOverDelayTimer = null; }
  state.score          = 0;
  state.multiplier     = 1;
  state.currentLevelIdx = 0;
  state.startedFromL1  = true;
  state.isDeathRun     = false;
  state._jetLightningMode = false;
  state.deathRunVibeIdx = 0;
  state.deathRunRestBeat       = 0;
  state.deathRunMechCooldown   = 0;
  state.deathRunCorridorMaxRows = 0;
  state.speed          = BASE_SPEED;
  state.shipX          = 0;
  state.shipVelX       = 0;
  state.rollAngle      = 0;
  state.rollHeld       = false;
  touch.rollToggle     = false;
  touch.rollUp         = false;
  touch.rollDown       = false;
  state.rollDir        = 0;
  shipGroup.rotation.z = 0;
  state.tiltTimer      = 0;
  state.corridorCenter = 0;
  state.corridorMode       = false;
  state.corridorSpawnZ     = -7;
  state.corridorRowsDone   = 0;
  state.corridorGapCenter  = 0;
  state.corridorGapDir     = 1;
  state.corridorSineT      = 0;
  state.levelElapsed       = 0;
  state.l4CorridorDone     = false;
  state.l4CorridorActive   = false;
  state.l4RowsDone         = 0;
  state.l4SineT            = 0;
  state.l4SpawnZ           = -7;
  state.l4Delay            = 0;
  state.l4StartElapsed     = 0;

  state.zipperHoldCount    = 0;
  auroraFadeT = 0;
  auroraTime  = 0;
  auroraTVisible = false;
  auroraGroup.visible = false;
  l5fFadeT = 0;
  l5fTime  = 0;
  l5fGroup.visible = false;
  state.corridorDelay      = 0;
  state.postL3Gap            = 0;
  state.wallCenterX = 0;
  state.zipperActive       = false;
  state.zipperRowsLeft     = 0;
  state.zipperCooldown     = 0;
  state.zipperSide         = 1;
  state.zipperHoldCount    = 0;
  state.zipperSpawnTimer   = 0;
  state.zipperRunCount     = 0;
  state.l5PreZipperRandom  = 0;
  state.slalomActive       = false;
  state.slalomSpawnZ       = -7;
  state.slalomRowsDone     = 0;
  state.slalomMaxRows      = 0;
  // Carved corridor
  state.drPatternCooldown  = 0;
  // Custom pattern will trigger via mechanic manager after intro
  state.drCustomPatternActive = false;
  state.drCustomPatternRow = 0;
  state.drCustomPatternSpawnZ = -7;
  // Gauntlet
  state.gauntletActive   = false;
  state.gauntletRowsLeft = 0;
  state.gauntletGapLane  = 0;
  state.gauntletGapDir   = 1;
  state.gauntletCooldown = 0;
  // Ship wobble + transient flags
  state.shieldHit    = false;
  state.wobbleAmp    = 0;
  state.wobblePhase  = 0;
  state.wobbleDir    = 0;
  state.wasSteering  = false;
  state.l5EndingActive    = false;
  state.l5CorridorActive   = false;
  state.l5CorridorDone     = false;
  state.l5CorridorRowsDone = 0;
  state.l5CorridorSpawnZ   = -7;
  state.l5SineT            = 0;
  state.introActive    = false;
  state.thrusterPower   = 0;     // start off, turned on by prologue/launch
  l5DustPoints.visible = false;  // reset chromatic dust
  state.l5EndingTimer  = 0;
  state.l5TitleShown   = false;
  state.l5RandomAfterZipper = 0;
  state.l5RandomAfterCorridor = 0;
  state.zipperSpawnZ   = -7;
  camTargetX           = 0;
  // Reset camera to starting position (full reset — prevent stale death/retry state)
  _retrySweepActive = false;
  _retrySweepT = 0;
  cameraPivot.position.set(0, 2.8 + _camPivotYOffset, 9 + _camPivotZOffset);
  cameraRoll = 0;
  camera.rotation.set(0, 0, 0);
  camera.position.set(0, 0, 0);
  camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
  camera.fov = _baseFOV + 15; // start zoomed out so gameplay launch snaps inward
  camera.updateProjectionMatrix();
  // Reset thrust state
  _jumpVelY = 0;
  _jumpActive = false;
  _thrustHeld = false;
  _jumpLandingBounceT = 0;
  state.shieldActive   = false;
  state.laserActive    = false;
  state.magnetActive   = false;
  _stopMagnetWhir();
  state.invincibleSpeedActive = false;
  state.multiplierTimer = 0;
  state.invincibleTimer = 0;
  state.laserTimer     = 0;
  state.sessionCoins   = 0;
  _activeCoinMult      = 1;  // reset coin multiplier for new run
  state.sessionPowerups = 0;
  state.sessionShields = 0;
  state.sessionLasers = 0;
  state.sessionInvincibles = 0;
  state._missionCheckTimer = 0;
  state._missionToasted = false;
  state.saveMeCount     = 0;
  state.playerScore     = 0;
  state.nearMissBendAllowed = true;
  state.nearMissFlash       = 0;
  state.prevCorridorCenter  = 0;
  state.prevCorridorDir     = 0;
  coinArcPending.length = 0;
  ;[...activeCoins].forEach(returnCoinToPool);
  activeCoins.length   = 0;
  framesSinceLastCoin  = 0;
  state.magnetTimer    = 0;
  state.shieldHitPoints = 1;
  state.shieldDuration  = 0;
  state.shieldTimer     = 0;
  state._prevShieldHP   = 0;
  state._shieldBreakT   = null;
  state.laserTier       = 1;
  state.laserBoltTimer  = 0;
  state.laserFireRate   = 5;
  state.laserColor      = 0xff2200;
  state.invincibleGrace = 2.0;
  state.magnetRadius    = 18;
  state.magnetPullsPowerups = false;
  // Hide any lingering laser bolts
  laserBolts.forEach(b => { b.visible = false; });
  state.nextSpawnZ     = -5;
  _noSpawnMode         = false; // always reset on game start
  state.frameCount     = 0;
  state.elapsed        = 0;
  framesSinceLastPowerup = 0;

  // Clear all in-flight objects and mechanic state
  _clearAllMechanics();
  [..._activeForcefields].forEach(returnForcefieldToPool);
  _activeForcefields.length = 0;
  _awTunerPaused = false;
  // Reset ALL pool meshes (not just active ones) so nothing lingers from last session
  powerupPool.forEach(pu => {
    pu.userData.active = false;
    pu.visible = false;
    pu.position.set(0, -9999, 0);
    pu.scale.setScalar(1);
  });
  activePowerups.length = 0;

  shieldMesh.visible = false; shieldWire.visible = false;
  shieldMat.uniforms.uReveal.value = 1.0;
  shieldWireMat.opacity = 0;
  shieldLight.intensity = 0;
  laserMat.opacity  = 0;
  laserGlowMat.opacity = 0;
  laserPivot.visible = false;
  laserBolts.forEach(b => { b.visible = false; });
  magnetRing.visible = false; magnetRing2.visible = false;
  magnetRingMat.opacity = 0;
  magnetRing2.material.opacity = 0;
  magnetLight.intensity = 0;

  currentLevelDef = LEVELS[0];
  targetLevelDef  = LEVELS[0];
  transitionT     = 1;
  applyLevelVisuals(LEVELS[0]);

  // Fade title screen out instead of instant hide (skip on retry — already hidden)
  const titleEl = document.getElementById('title-screen');
  if (!_retryIsFromDead) {
    titleEl.classList.add('fading-out');
    if (_titleFadeTimer) clearTimeout(_titleFadeTimer);
    _titleFadeTimer = setTimeout(() => {
      _titleFadeTimer = null;
      if (state.phase !== 'title') titleEl.classList.add('hidden');
    }, 750);
  }
  // Hide standalone leaderboard (lives outside title-screen div)
  const _lb = document.getElementById('title-leaderboard');
  if (_lb) _lb.classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  setPauseOverlay(false);
  document.getElementById('settings-btn').style.display = 'none'; // hide gear during gameplay
  document.getElementById('lb-icon-btn').style.display = 'none'; // hide trophy during gameplay
  document.getElementById('lb-overlay').classList.add('hidden');
  // Show touch controls on mobile (any touch-capable device)
  if (navigator.maxTouchPoints > 0) {
    document.getElementById('touch-controls').classList.remove('hidden');
  }
  updateHUDLevel();
  updateMultiplierHUD();
  updatePowerupTray();

  // Ensure audio context and all elements are ready
  initAudio();
  // Warm up audio elements on user gesture so iOS/mobile allows deferred play
  // All set to volume 0 during warmup to prevent audible blips
  // Warm up engine-start on user gesture so mobile allows deferred play (campaign only)
  if (!_skipL1Intro) {
    const _eng = document.getElementById('engine-start');
    if (_eng) { _eng.volume = 0; _eng.play().then(() => { _eng.pause(); _eng.currentTime = 0; _eng.volume = 1; }).catch(() => { _eng.volume = 1; }); }
  }
  [['l3', l3Music], ['l4', l4Music]].forEach(([k, el]) => {
    if (el && el.paused) { setTrackVol(k, 0); el.play().then(() => { el.pause(); el.currentTime = 0; }).catch(() => {}); }
  });
  // Hard-reset ALL tracks — kill title immediately, no overlap
  if (activeFadeIv) { clearInterval(activeFadeIv); activeFadeIv = null; }
  [['bg', bgMusic], ['l3', l3Music], ['l4', l4Music], ['title', titleMusic]].forEach(([k, el]) => {
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setTrackVol(k, 0);
  });
  // Short fade-in for gameplay track (title already silenced above)
  const _startTrack = state.currentLevelIdx >= 2 ? 'l3' : 'bg';
  const _startEl = _startTrack === 'l3' ? l3Music : bgMusic;
  if (_startEl && !state.muted) {
    _startEl.currentTime = 0;
    setTrackVol(_startTrack, 0);
    _startEl.play().catch(() => {});
    musicFadeTo(_startTrack, 800);
  }
  // Ensure lakeMusic element is bound before trying to play
  if (!lakeMusic) { lakeMusic = document.getElementById('lake-music'); }
  // Start lake ambience loop with fade-in matching gameplay track
  if (lakeMusic && !state.muted) {
    setTrackVol('lake', 0);
    lakeMusic.play().catch(() => {});
    // Fade lake in over 800ms to match bg track fade
    const _lakeStart = performance.now();
    const _lakeFade = setInterval(() => {
      const t = Math.min((performance.now() - _lakeStart) / 800, 1);
      setTrackVol('lake', TRACK_VOL.lake * t);
      if (t >= 1) clearInterval(_lakeFade);
    }, 16);
  }
  // engine hum removed

  // ── L1 cinematic intro text (only on fresh game start at level 0, NOT on retry) ──
  if (state.currentLevelIdx === 0 && !_skipL1Intro && !state._tutorialActive && !state._jetLightningMode && !_retryIsFromDead) {
    state.introActive = true;   // blocks cone spawning
    state.thrusterPower = 0;    // thrusters off during prologue
    showIntroText();
  }

  // ── HEAD START PROMPT (skip on retry — camera sweep replaces it) ──
  if (!_retryIsFromDead) showHeadStartPrompt();
  // Release reentry lock after one frame so simultaneous events have already fired
  requestAnimationFrame(() => { _gameStarting = false; });
}

// ═══════════════════════════════════════════════════
//  DEATH RUN MODE
// ═══════════════════════════════════════════════════
// Death Run vibe cycle thresholds — every 150 points, cycle to next vibe
const DEATH_RUN_VIBE_INTERVAL = 150;

const DEATH_RUN_VIBES = [
  {
    name: 'NEON DAWN',
    skyTop: new THREE.Color(0x03070f), skyBot: new THREE.Color(0x08102a),
    gridColor: new THREE.Color(0x00eeff), sunColor: new THREE.Color(0xff9500),
    sunStripeColor: new THREE.Color(0xff5500), bloomStrength: 0.35,
    fogColor: new THREE.Color(0x05091a),
    floorLine: new THREE.Color(0x00eeff),
    thrusterColor: new THREE.Color(0xaaddff),
    sunShader: 0, tendrils: 'none',
    obstaclesPerSpawn: 6, maxObstaclesPerSpawn: 8, gapFactor: 1.0, speedTier: 1,
  },
  {
    name: 'ULTRAVIOLET',
    skyTop: new THREE.Color(0x060010), skyBot: new THREE.Color(0x0e0320),
    gridColor: new THREE.Color(0xdd00ff), sunColor: new THREE.Color(0xcc44ff),
    sunStripeColor: new THREE.Color(0x8800cc), bloomStrength: 0.38,
    fogColor: new THREE.Color(0x080018),
    floorLine: new THREE.Color(0xcc44ff),
    thrusterColor: new THREE.Color(0xee00ff),
    sunShader: 1, tendrils: 'none',
    obstaclesPerSpawn: 7, maxObstaclesPerSpawn: 9, gapFactor: 0.95, speedTier: 1,
  },
  {
    name: 'ELECTRIC HORIZON',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x050002),
    gridColor: new THREE.Color(0x00ffcc), sunColor: new THREE.Color(0xff6600),
    sunStripeColor: new THREE.Color(0xff4400), bloomStrength: 0.38,
    fogColor: new THREE.Color(0x020001),
    floorLine: new THREE.Color(0x00ffaa),
    thrusterColor: new THREE.Color(0x00eeff),
    sunShader: 0, tendrils: 'none',
    // Warp palette: dark=(1,1,1) mid=(0.05,0,0) bright=(0,0,0.08)
    warpCol1: [1.00, 1.00, 1.00],
    warpCol2: [0.05, 0.00, 0.00],
    warpCol3: [0.00, 0.00, 0.08],
    obstaclesPerSpawn: 8, maxObstaclesPerSpawn: 10, gapFactor: 0.9, speedTier: 2,
  },
  {
    name: 'ICE STORM',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x000c18),
    gridColor: new THREE.Color(0x55ffff), sunColor: new THREE.Color(0xaaeeff),
    sunStripeColor: new THREE.Color(0x4499cc), bloomStrength: 0.30,
    fogColor: new THREE.Color(0x00080f),
    floorLine: new THREE.Color(0x44ccff),
    thrusterColor: new THREE.Color(0x88ddff),
    sunShader: 3, tendrils: 'aurora',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 3,
  },
  {
    name: 'VOID SINGULARITY',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x060400),
    gridColor: new THREE.Color(0xffcc00), sunColor: new THREE.Color(0xffaa33),
    sunStripeColor: new THREE.Color(0xff6600), bloomStrength: 0.30,
    fogColor: new THREE.Color(0x030200),
    floorLine: new THREE.Color(0xffd700),
    thrusterColor: new THREE.Color(0xff9a00),
    sunShader: 4, tendrils: 'l5f',
    // Warp palette: dark=(0.23,1,0) mid=(0,0.14,0.10) bright=(0.13,0.45,0)
    warpCol1: [0.23, 1.00, 0.00],
    warpCol2: [0.00, 0.14, 0.10],
    warpCol3: [0.13, 0.45, 0.00],
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 4,
  },
  {
    name: 'DEEP EMERALD',
    skyTop: new THREE.Color(0x000f06), skyBot: new THREE.Color(0x001a0a),
    gridColor: new THREE.Color(0x00ff88), sunColor: new THREE.Color(0x66ffaa),
    sunStripeColor: new THREE.Color(0x22aa55), bloomStrength: 0.32,
    fogColor: new THREE.Color(0x000a04),
    floorLine: new THREE.Color(0x00ff88),
    thrusterColor: new THREE.Color(0x44ffaa),
    sunShader: 0, tendrils: 'none',
    obstaclesPerSpawn: 7, maxObstaclesPerSpawn: 9, gapFactor: 0.92, speedTier: 4,
  },
  {
    name: 'SOLAR FLARE',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x100800),
    gridColor: new THREE.Color(0xff6600), sunColor: new THREE.Color(0xffdd88),
    sunStripeColor: new THREE.Color(0xff4400), bloomStrength: 0.45,
    fogColor: new THREE.Color(0x080400),
    floorLine: new THREE.Color(0xff6600),
    thrusterColor: new THREE.Color(0xff8833),
    sunShader: 2, tendrils: 'l5f',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 12, gapFactor: 0.85, speedTier: 4,
  },
  {
    name: 'MIDNIGHT ROSE',
    skyTop: new THREE.Color(0x0a0010), skyBot: new THREE.Color(0x180020),
    gridColor: new THREE.Color(0xff44aa), sunColor: new THREE.Color(0xff88cc),
    sunStripeColor: new THREE.Color(0xaa2266), bloomStrength: 0.36,
    fogColor: new THREE.Color(0x0a0012),
    floorLine: new THREE.Color(0xff44aa),
    thrusterColor: new THREE.Color(0xff66bb),
    sunShader: 1, tendrils: 'none',
    obstaclesPerSpawn: 8, maxObstaclesPerSpawn: 10, gapFactor: 0.9, speedTier: 4,
  },
  {
    name: 'TOXIC',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x0a0f00),
    gridColor: new THREE.Color(0x88ff00), sunColor: new THREE.Color(0xccff44),
    sunStripeColor: new THREE.Color(0x66aa00), bloomStrength: 0.38,
    fogColor: new THREE.Color(0x040800),
    floorLine: new THREE.Color(0x88ff00),
    thrusterColor: new THREE.Color(0xaaff22),
    sunShader: 4, tendrils: 'none',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 4,
  },
  {
    name: 'ARCTIC DAWN',
    skyTop: new THREE.Color(0x000408), skyBot: new THREE.Color(0x001020),
    gridColor: new THREE.Color(0xccddff), sunColor: new THREE.Color(0xeeeeff),
    sunStripeColor: new THREE.Color(0x8899bb), bloomStrength: 0.28,
    fogColor: new THREE.Color(0x000810),
    floorLine: new THREE.Color(0xccddff),
    thrusterColor: new THREE.Color(0xbbccee),
    sunShader: 3, tendrils: 'aurora',
    obstaclesPerSpawn: 8, maxObstaclesPerSpawn: 10, gapFactor: 0.9, speedTier: 4,
  },
  {
    name: 'BLOOD MOON',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x100000),
    gridColor: new THREE.Color(0xaa0000), sunColor: new THREE.Color(0xcc2200),
    sunStripeColor: new THREE.Color(0x880000), bloomStrength: 0.40,
    fogColor: new THREE.Color(0x080000),
    floorLine: new THREE.Color(0xaa0000),
    thrusterColor: new THREE.Color(0xff2200),
    sunShader: 2, tendrils: 'none',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 13, gapFactor: 0.82, speedTier: 4,
  },
  {
    name: 'ELECTRIC INDIGO',
    skyTop: new THREE.Color(0x000010), skyBot: new THREE.Color(0x000830),
    gridColor: new THREE.Color(0x4444ff), sunColor: new THREE.Color(0x6688ff),
    sunStripeColor: new THREE.Color(0x2222aa), bloomStrength: 0.35,
    fogColor: new THREE.Color(0x000018),
    floorLine: new THREE.Color(0x4444ff),
    thrusterColor: new THREE.Color(0x6666ff),
    sunShader: 0, tendrils: 'aurora',
    obstaclesPerSpawn: 8, maxObstaclesPerSpawn: 10, gapFactor: 0.9, speedTier: 4,
  },
  {
    name: 'COPPER',
    skyTop: new THREE.Color(0x060300), skyBot: new THREE.Color(0x0a0500),
    gridColor: new THREE.Color(0xcc7733), sunColor: new THREE.Color(0xdd8844),
    sunStripeColor: new THREE.Color(0x995522), bloomStrength: 0.32,
    fogColor: new THREE.Color(0x040200),
    floorLine: new THREE.Color(0xcc7733),
    thrusterColor: new THREE.Color(0xdd9955),
    sunShader: 4, tendrils: 'l5f',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 4,
  },
  {
    name: 'PLASMA',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x000810),
    gridColor: new THREE.Color(0xaaccff), sunColor: new THREE.Color(0xeeffff),
    sunStripeColor: new THREE.Color(0x6699cc), bloomStrength: 0.48,
    fogColor: new THREE.Color(0x000408),
    floorLine: new THREE.Color(0xaaccff),
    thrusterColor: new THREE.Color(0xccddff),
    sunShader: 3, tendrils: 'aurora',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 12, gapFactor: 0.85, speedTier: 4,
  },
  {
    name: 'OBSIDIAN',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x040404),
    gridColor: new THREE.Color(0x442200), sunColor: new THREE.Color(0x553311),
    sunStripeColor: new THREE.Color(0x331100), bloomStrength: 0.22,
    fogColor: new THREE.Color(0x020202),
    floorLine: new THREE.Color(0x442200),
    thrusterColor: new THREE.Color(0x664422),
    sunShader: 0, tendrils: 'none',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 13, gapFactor: 0.82, speedTier: 4,
  },
  {
    name: 'SUPERNOVA',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x0f0800),
    gridColor: new THREE.Color(0xff8800), sunColor: new THREE.Color(0xffcc00),
    sunStripeColor: new THREE.Color(0xff5500), bloomStrength: 0.50,
    fogColor: new THREE.Color(0x080400),
    floorLine: new THREE.Color(0xff8800),
    thrusterColor: new THREE.Color(0xffaa33),
    sunShader: 4, tendrils: 'l5f',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 12, gapFactor: 0.85, speedTier: 4,
  },
  {
    name: 'PHANTOM',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x080818),
    gridColor: new THREE.Color(0x8866cc), sunColor: new THREE.Color(0xaa88ee),
    sunStripeColor: new THREE.Color(0x553399), bloomStrength: 0.34,
    fogColor: new THREE.Color(0x040410),
    floorLine: new THREE.Color(0x8866cc),
    thrusterColor: new THREE.Color(0x9977dd),
    sunShader: 1, tendrils: 'none',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 4,
  },
  {
    name: 'DEEPWATER',
    skyTop: new THREE.Color(0x000008), skyBot: new THREE.Color(0x001030),
    gridColor: new THREE.Color(0x0066cc), sunColor: new THREE.Color(0x3399ff),
    sunStripeColor: new THREE.Color(0x003388), bloomStrength: 0.32,
    fogColor: new THREE.Color(0x000818),
    floorLine: new THREE.Color(0x0066cc),
    thrusterColor: new THREE.Color(0x4488dd),
    sunShader: 3, tendrils: 'aurora',
    obstaclesPerSpawn: 9, maxObstaclesPerSpawn: 11, gapFactor: 0.88, speedTier: 4,
  },
  {
    name: 'MOLTEN',
    skyTop: new THREE.Color(0x080000), skyBot: new THREE.Color(0x100400),
    gridColor: new THREE.Color(0xff3300), sunColor: new THREE.Color(0xff6644),
    sunStripeColor: new THREE.Color(0xcc2200), bloomStrength: 0.44,
    fogColor: new THREE.Color(0x060200),
    floorLine: new THREE.Color(0xff3300),
    thrusterColor: new THREE.Color(0xff4411),
    sunShader: 2, tendrils: 'l5f',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 13, gapFactor: 0.82, speedTier: 4,
  },
  {
    name: 'WHITE DWARF',
    skyTop: new THREE.Color(0x000000), skyBot: new THREE.Color(0x080808),
    gridColor: new THREE.Color(0xdddddd), sunColor: new THREE.Color(0xffffff),
    sunStripeColor: new THREE.Color(0x999999), bloomStrength: 0.25,
    fogColor: new THREE.Color(0x040404),
    floorLine: new THREE.Color(0xdddddd),
    thrusterColor: new THREE.Color(0xeeeeee),
    sunShader: 3, tendrils: 'none',
    obstaclesPerSpawn: 10, maxObstaclesPerSpawn: 13, gapFactor: 0.82, speedTier: 4,
  },
];

function startDeathRun() {
  clearMusicTimers();
  // Tell startGame() to skip the L1 cinematic — death run has its own prologue
  _skipL1Intro = true;
  startGame();
  _skipL1Intro = false;

  state.isDeathRun      = true;
  state.startedFromL1   = false;
  state.deathRunVibeIdx = 0;
  _pendingVibeIdx = -1;
  state._pendingSpeedTier = -1;
  state._drForcedBand = -1;
  state._drBand4Started = false;
  state._drBand5StartTime = 0;
  state._arcActive = false;
  state._arcQueue = null;
  state._arcStage = 0;
  state._drSpeedFloor = 0; // ratchet: once L5 corridor hits, speed never drops below its mult

  // Wave director state (kept for endless mix fallback)
  DR2_RUN_BANDS = _drGetRunBands();
  state.drPhase           = 'RELEASE';
  state.drPhaseTimer      = 0;
  const _initRelDur       = DR2_PHASE_DURATIONS.RELEASE;
  state.drPhaseDuration   = _initRelDur.min + Math.random() * (_initRelDur.max - _initRelDur.min);
  state.drWaveCount       = 0;
  state.drIntensity       = 0;
  state.drRecentFamilies  = [];
  state._band1Loops        = 0;

  // Level sequencer state
  state.seqStageIdx        = 0;
  state.seqStageElapsed    = 0;
  state._seqVibeApplied    = -1;
  state._seqCorridorStarted = false;
  state._seqZipTimer       = 0;
  state._restBeepFired     = false;
  state._endlessVibeIdx    = 4;
  state.distance           = 0;
  state._seqAngledTimer    = 0;
  state._seqSlalomFired    = false;
  state._seqZipFired       = false;
  state._seqSpawnMode      = 'cones';

  // Init fuel cell HUD
  const _fcHudInit = document.getElementById('hud-fuelcells');
  if (_fcHudInit) _fcHudInit.textContent = window._LS.getItem('jetslide_fuelcells') || '0';

  // Legacy DR1 state (still read by some paths)
  state.deathRunRestBeat       = 0;
  state.deathRunMechanic       = 'random';
  state.deathRunMechTimer      = 0;
  state.deathRunMechCooldown   = 0;
  state.deathRunCorridorMaxRows = 0;
  state.deathRunSpeedTier      = 0;
  state.drPatternCooldown      = 0;

  clearAllCorridorFlags();
  _drTransActive = false;
  _drTransT = 1;

  // Start visuals on first vibe (NEON DAWN)
  state.currentLevelIdx = DEATH_RUN_VIBES[0].sunShader;
  currentLevelDef = LEVELS[0];
  targetLevelDef  = LEVELS[0];
  transitionT     = 1;
  applyLevelVisuals(LEVELS[0]);
  updateHUDLevel();

  // Tutorial — fire on first ever run
  state._tutorialActive      = false; // disabled auto-start — settings-only access
  state._tutorialStep        = -1; // -1 = waiting for first frame before showing box
  if (state._tutorialActive) {
    state.speed = BASE_SPEED * _funFloorSpeed; // fun floor: dial in starting speed via T tuner
    setTimeout(() => {
      state._tutorialStep = -0.5; // start with rock mounds
    }, 100);
  } else {
    state._tutorialStep = 0;
  }
  state._tutorialTimer       = 0;
  state._tutorialSubStep     = 0;
  state._tutorialConeSpawned = false;
  state._tutorialConeZ       = -80;
  state._tutRocksSpawned     = false;
  state._tutRocksPassed      = 0;    // how many rocks have passed the player
  state._tutorialZipZ        = -99;
  state._tutorialZipRows     = 0;
  state._tutorialZipPassed     = false;
  state._tutorialZipSuccesses  = 0;
  state._tutorialZipHit        = false;
  state._tutorialZipRowSpawned  = false;

  // Rings disabled during gameplay for now (tuner still available via hotkey)
  // Also clear any rings that were on the title screen
  if (state._tutorialActive) _ringRemoveAll();

  // Prologue: ship idles, wait for tap to launch (skip in tutorial and retry)
  if (!state._tutorialActive && !_retryIsFromDead) {
    state.introActive    = true;
    state.thrusterPower  = 0;
    state.speed          = BASE_SPEED * 0.35;
  }

  // Music: start with L1 bg track, crossfade to l3/l4 as difficulty ramps
  if (activeFadeIv) { clearInterval(activeFadeIv); activeFadeIv = null; }
  [['bg', bgMusic], ['l3', l3Music], ['l4', l4Music], ['title', titleMusic]].forEach(([k, el]) => {
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setTrackVol(k, 0);
  });
  state.deathRunMusicPhase = 0;
  if (bgMusic && !state.muted) {
    bgMusic.currentTime = 0;
    setTrackVol('bg', 0);
    bgMusic.play().catch(() => {});
    musicFadeTo('bg', 800);
  }

  // Show cinematic prologue overlay (skip in tutorial and retry)
  const overlay = document.getElementById('intro-overlay');
  if (overlay && !state._tutorialActive && !_retryIsFromDead) {
    clearIntroTimers();
    overlay.innerHTML = '';
    overlay.style.display = 'flex';
    overlay.style.pointerEvents = 'auto';

    const lineA = document.createElement('div');
    lineA.className = 'intro-line line-a';
    lineA.textContent = 'ONE RUN STANDS BETWEEN YOU AND PEACE.';

    const lineB = document.createElement('div');
    lineB.className = 'intro-line line-b';
    lineB.textContent = 'THIS IS THAT RUN.';

    const lineC = document.createElement('div');
    lineC.className = 'intro-title line-c';
    lineC.textContent = 'JET HORIZON';

    const skipHint = document.createElement('div');
    skipHint.className = 'intro-skip-hint';
    skipHint.textContent = 'tap to skip';

    overlay.appendChild(lineA);
    overlay.appendChild(lineB);
    overlay.appendChild(lineC);
    overlay.appendChild(skipHint);

    // Line A fades in at 3s
    _introTimers.push(setTimeout(() => { lineA.classList.add('playing'); }, 3000));
    // Line B at 8.5s
    _introTimers.push(setTimeout(() => { lineB.classList.add('playing'); }, 8500));
    // Engine startup SFX at 8.5s
    _introTimers.push(setTimeout(() => {
      const eng = document.getElementById('engine-start');
      if (eng && !state.muted) {
        _ensureCtxRunning();
        eng.currentTime = 0;
        eng.volume = 0.12;
        eng.play().catch(() => {});
      }
    }, 8500));
    // Pre-spurts — thruster flickers
    function _preSpurt(delay, peak, dur) {
      _introTimers.push(setTimeout(() => {
        if (!state.introActive) return;
        const _start = performance.now();
        const _iv = setInterval(() => {
          const t = (performance.now() - _start) / dur;
          if (t >= 1) { state.thrusterPower = 0; clearInterval(_iv); return; }
          const env = t < 0.25 ? (t / 0.25) : (1 - (t - 0.25) / 0.75);
          state.thrusterPower = env * peak;
        }, 16);
        _introTimers.push(_iv);
      }, delay));
    }
    _preSpurt(10000, 0.45, 125);
    _preSpurt(10175, 0.35, 110);
    _preSpurt(11800, 0.5, 130);
    _preSpurt(11980, 0.35, 110);
    _preSpurt(12140, 0.25, 100);
    _preSpurt(13500, 0.4, 125);
    _preSpurt(13675, 0.3, 110);
    // JET HORIZON title at 14s
    _introTimers.push(setTimeout(() => { lineC.classList.add('playing'); }, 14000));
    // Auto-launch at 18.5s
    _introTimers.push(setTimeout(() => { _launchDeathRun(); }, 18500));

    function _launchDeathRun(e) {
      if (!state.introActive) return; // already launched
      if (e) { e.preventDefault(); e.stopPropagation(); }
      overlay.removeEventListener('touchstart', _launchDeathRun);
      overlay.removeEventListener('click', _launchDeathRun);
      document.removeEventListener('keydown', _launchKey);
      clearIntroTimers();

      fadeOutIntroOverlay(overlay);
      state.introActive = false;
      state.elapsed = 0; // reset so wave director Band 1 starts fresh from launch

      // Engine roar only on launch (engine-start already killed by clearIntroTimers)
      killThrusterSputter();
      const roar = document.getElementById('engine-roar');
      if (roar && !state.muted) {
        _ensureCtxRunning();
        roar.currentTime = 0;
        roar.volume = 0.08;
        roar.play().catch(() => {});
      }
      beginThrusterSputter(); // sputtering ramp-up to full power
      // Trigger lift immediately on launch — ship rises from 0.38 as thrusters fire
      state._introLiftActive = true;
      state._introLiftTimer = 0;
      state._introShipY = 0.38;

      const firstVibe = DEATH_RUN_VIBES[0];
      const speedIdx = Math.min(firstVibe.speedTier, 4);
      state.speed = BASE_SPEED * LEVELS[speedIdx].speedMult;
      // Opening bonus rings — right in front of ship, fly into them before cones
      _ringRemoveAll();
      _ringSpawnRow(0, true); // spawn close to ship for immediate action
      // Wave FSM handles all sequencing from here
    }
    function _launchKey(e) {
      if (e.key === 'Enter' || e.key === ' ') _launchDeathRun();
    }
    overlay.addEventListener('touchstart', _launchDeathRun, { passive: false });
    overlay.addEventListener('click', _launchDeathRun);
    document.addEventListener('keydown', _launchKey);
  }
}

// ── DeathRun2 phase durations (Phase 1 stub — full system in Phase 2) ──
const DR2_PHASE_DURATIONS = { RELEASE: {min:2, max:4}, BUILD: {min:0,max:0}, PEAK: {min:0,max:0}, SUSTAIN: {min:2,max:3}, RECOVERY: {min:2, max:4} };
// Run bands determine wave intensity — how hard the corridor is and how long.
// Band 1 duration shrinks with player level: 20s at level 1, down to 8s at level 10+
function _drBand1Duration() {
  const lvl = loadPlayerLevel();
  return Math.max(8, 20 - (lvl - 1) * 1.5);
}
const DR2_RUN_BANDS_BASE = [
  { label: 'BAND1', buildRows: {min:12, max:18}, peakRows: {min:0, max:0},  buildVariant: 'standard', peakVariant: 'standard', peakChance: 0    },
  { label: 'BAND2', buildRows: {min:55, max:65}, peakRows: {min:60, max:70}, buildVariant: 'standard', peakVariant: 'standard', peakChance: 0    },
  { label: 'BAND3', buildRows: {min:30, max:40}, peakRows: {min:35, max:50}, buildVariant: 'l4',       peakVariant: 'l4',       peakChance: 0    },
  { label: 'BAND4', buildRows: {min:40, max:50}, peakRows: {min:45, max:55}, buildVariant: 'l4',       peakVariant: 'l5',       peakChance: 0.5  },
  { label: 'BAND5', buildRows: {min:35, max:45}, peakRows: {min:40, max:55}, buildVariant: 'l4',       peakVariant: 'l5',       peakChance: 0.55 },
  { label: 'BAND6', buildRows: {min:40, max:50}, peakRows: {min:45, max:60}, buildVariant: 'l4',       peakVariant: 'l5',       peakChance: 0.65 },
];
// Build runtime bands with resolved Band 1 duration
// Band 4 (corridors) has dynamic duration — uses Infinity, but the wave director
// forces a CORRIDOR_ARC and advances to Band 5 when it finishes.
function _drGetRunBands() {
  return [
    { maxTime: 30,       ...DR2_RUN_BANDS_BASE[0] },
    { maxTime: 60,       ...DR2_RUN_BANDS_BASE[1] },
    { maxTime: 90,       ...DR2_RUN_BANDS_BASE[2] },
    { maxTime: Infinity, ...DR2_RUN_BANDS_BASE[3] }, // Band 4: corridor arc, advances on completion
    { maxTime: Infinity, ...DR2_RUN_BANDS_BASE[4] }, // Band 5: 30s after corridors finish
    { maxTime: Infinity, ...DR2_RUN_BANDS_BASE[5] }, // Band 6: mix everything
  ];
}
// Alias for backward compat (static reference used by debug HUD etc.)
let DR2_RUN_BANDS = _drGetRunBands();

// ═══════════════════════════════════════════════════
//  LEVEL SEQUENCER — replaces random wave director
// ═══════════════════════════════════════════════════
const DR_SEQUENCE = [
  // Tier 1: warm-up
  { name: 'T1_WARMUP',      type: 'random_cones', duration: 30, speed: 1.0,  density: 'sparse', vibeIdx: 0, physTier: 0 },
  // Tier 2: ramp-up
  { name: 'T2_RAMPUP',      type: 'random_cones', duration: 30, speed: 1.2,  density: 'dense',  vibeIdx: 1, physTier: 0 },
  // Tier 3a: cones + zip lines
  { name: 'T3A_ZIPS',       type: 'cones_and_zips', duration: 30, speed: 1.35, vibeIdx: 1, physTier: 1 },
  // Tier 3b: BOSS L3 corridor
  { name: 'T3B_L3BOSS',     type: 'corridor', family: 'L3_CORRIDOR', speed: 2.0, vibeIdx: 2, physTier: 1 },
  // Recovery
  { name: 'RECOVERY_1',     type: 'rest', duration: 2, speed: 2.0, vibeIdx: 2, physTier: 1 },
  // Tier 4a: angled walls
  { name: 'T4A_ANGLED',     type: 'angled_walls', duration: 30, speed: 2.0, vibeIdx: 2, physTier: 2 },
  // Tier 4b: lethal rings + angled walls
  { name: 'T4B_LETHAL',     type: 'lethal_rings', duration: 70, speed: 2.0, vibeIdx: 2, physTier: 2 },
  // Tier 4c: BOSS L4 corridor
  { name: 'T4C_L4BOSS',     type: 'corridor', family: 'L4_SINE_CORRIDOR', speed: 2.1, vibeIdx: 3, physTier: 2 },
  // Recovery
  { name: 'RECOVERY_2',     type: 'rest', duration: 5, speed: 2.1, vibeIdx: 3, physTier: 2 },  // 5s breathing room after L4 boss
  // Tier 5a: random fat cones
  { name: 'T5A_FATCONES',   type: 'fat_cones', duration: 30, speed: 2.1, vibeIdx: 3, physTier: 3 },
  // Tier 5b: structured slalom then zip lines (sequential)
  { name: 'T5B_SLALOM_ZIP', type: 'slalom_then_zips', duration: 30, speed: 2.1, vibeIdx: 3, physTier: 3 },
  // Tier 5c: BOSS L5 corridor
  { name: 'T5C_L5BOSS',     type: 'corridor', family: 'L5_SINE_CORRIDOR', duration: 60, speed: 2.5, vibeIdx: 4, physTier: 3 },
  // Recovery
  { name: 'RECOVERY_3',     type: 'rest', duration: 3, speed: 2.5, vibeIdx: 4, physTier: 3 },  // 3s breathing room after L5 boss
  // Tier 6+: endless mix (falls back to random wave director)
  { name: 'ENDLESS',        type: 'endless_mix', speed: 2.5, vibeIdx: 4, physTier: 3 },
];

// ── Sequencer tick (called each frame during DR) ──
function _drSequencerTick(dt) {
  const stage = DR_SEQUENCE[state.seqStageIdx];
  if (!stage) return;

  // ── Handle vibe transition on stage entry ──
  if (state._seqVibeApplied !== state.seqStageIdx) {
    state._seqVibeApplied = state.seqStageIdx;
    if (stage.vibeIdx !== undefined && stage.vibeIdx !== state.deathRunVibeIdx) {
      if (stage.type === 'corridor') {
        // Visual-only crossfade — don't call clearAllCorridorFlags
        const fromVibe = DEATH_RUN_VIBES[state.deathRunVibeIdx];
        const toVibe   = DEATH_RUN_VIBES[stage.vibeIdx];
        state.deathRunVibeIdx = stage.vibeIdx;
        state.currentLevelIdx = toVibe.sunShader;
        _pendingVibeIdx = -1;
        applyDeathRunVibeTransition(fromVibe, toVibe);
      } else {
        // suppressRestBeat=true: sequencer controls pacing, not the legacy 2.5s gate
        _applyVibeTransition(stage.vibeIdx, true);
      }
      state.deathRunRestBeat = 0;
    }
  }

  // ── Set speed + lateral physics tier for this stage ──
  const floor = state._drSpeedFloor || 0;
  const targetSpeed = BASE_SPEED * Math.max(stage.speed, floor);
  if (!state.invincibleSpeedActive && Math.abs(state.speed - targetSpeed) > 0.5) state.speed = targetSpeed;
  if (stage.physTier !== undefined) state.deathRunSpeedTier = stage.physTier;

  // ── Quilez domain warp: on for T3B boss and endless (except ice/gold suns which have built-in warp) ──
  const _isEndlessStage = stage.type === 'endless_mix';
  const _currentSunShader = DEATH_RUN_VIBES[state.deathRunVibeIdx]?.sunShader ?? 0;
  const _sunHasBuiltinWarp = (_currentSunShader === 3 || _currentSunShader === 4); // ice and gold already warped
  const _wantL3Warp = (stage.name === 'T3B_L3BOSS' || (_isEndlessStage && !_sunHasBuiltinWarp)) ? 1.0 : 0.0;
  const _curL3Warp = sunMat.uniforms.uIsL3Warp.value;
  if (Math.abs(_curL3Warp - _wantL3Warp) > 0.01) {
    sunMat.uniforms.uIsL3Warp.value += (_wantL3Warp - _curL3Warp) * Math.min(1, dt * 2);
  } else {
    sunMat.uniforms.uIsL3Warp.value = _wantL3Warp;
  }
  sunCapMat.uniforms.uIsL3Warp.value = sunMat.uniforms.uIsL3Warp.value;

  const tp = stage.type;

  // ─── REST: clear all obstacles and wait ───
  if (tp === 'rest') {
    // On first tick of rest stage, wipe all active obstacles so screen is clear
    if (state.seqStageElapsed === 0) {
      for (let _ri = activeObstacles.length - 1; _ri >= 0; _ri--) {
        returnObstacleToPool(activeObstacles[_ri]);
      }
      activeObstacles.length = 0;
    }
    state.seqStageElapsed += dt;
    state.deathRunRestBeat = 0.5; // suppress spawning
    // Fire warning beeps 1.5s before REST ends if next stage has higher speed
    const _nextStage = DR_SEQUENCE[state.seqStageIdx + 1];
    if (_nextStage && _nextStage.speed > stage.speed && !state._restBeepFired &&
        state.seqStageElapsed >= stage.duration - 1.5) {
      state._restBeepFired = true;
      if (!state.muted) {
        playSFX(440, 0.08, 'square', 0.25);
        setTimeout(() => playSFX(550, 0.08, 'square', 0.25), 200);
        setTimeout(() => playSFX(660, 0.10, 'square', 0.3), 400);
        // Thruster roar fires right as speed kicks in
        setTimeout(() => {
          const _roar = document.getElementById('engine-roar');
          if (_roar && !state.muted) { _roar.currentTime = 0; _roar.volume = 0.25; _roar.play().catch(()=>{}); }
        }, 1500);
      }
    }
    if (state.seqStageElapsed >= stage.duration) {
      state._restBeepFired = false;
      _drSeqAdvance();
    }
    return;
  }

  // ─── CORRIDOR BOSS: activate family, advance by time (if duration set) or row completion ───
  if (tp === 'corridor') {
    if (!state._seqCorridorStarted) {
      state._seqCorridorStarted = true;
      clearAllCorridorFlags();
      state.deathRunRestBeat = 1.5; // brief clear before corridor walls appear
      const fam = DR_MECHANIC_FAMILIES[stage.family];
      const dummyBand = { label: 'BAND4', peakChance: 1 };
      fam.activate(dummyBand, 'peak');
    }
    // If stage has a duration, use time — more reliable than row count at variable speeds
    if (stage.duration) {
      state.seqStageElapsed += dt;
      if (state.seqStageElapsed >= stage.duration) {
        state._seqCorridorStarted = false;
        state.deathRunRestBeat = 0;
        clearAllCorridorFlags();
        state.l5CorridorDone = true; // mark done so campaign ending path never fires
        _drSeqAdvance();
      }
    } else {
      // No duration — wait for corridor to finish by row count
      const fam = DR_MECHANIC_FAMILIES[stage.family];
      if (!fam.isActive()) {
        state._seqCorridorStarted = false;
        state.deathRunRestBeat = 0;
        _drSeqAdvance();
      }
    }
    return;
  }

  // ─── TIME-BASED STAGES ───
  state.seqStageElapsed += dt;

  if (tp === 'random_cones') {
    // Density control: sparse = wider gaps, fewer per spawn; dense = tighter
    // The existing spawner uses obstaclesPerSpawn from the vibe — we override
    state._seqSpawnMode = 'cones';
    state._seqConeDensity = stage.density || 'normal';
  }
  else if (tp === 'cones_and_zips') {
    state._seqSpawnMode = 'cones';
    // Fire a zipper burst periodically
    state._seqZipTimer = (state._seqZipTimer || 0) + dt;
    if (state._seqZipTimer >= 8 && !state.zipperActive) {
      state._seqZipTimer = 0;
      state.zipperActive = true;
      // Use ZIPPER_ROWS so the exit-ramp calculation in spawnZipperRow is correct
      // (was 8-11, causing rowsDone to start mid-ramp and fire too fast)
      state.zipperRowsLeft = ZIPPER_ROWS;
      state.zipperSide = Math.random() < 0.5 ? 1 : -1;
      state.zipperHoldCount = 0;
      state.zipperSpawnTimer = -1.0;
    }
  }
  else if (tp === 'angled_walls') {
    // 0-15s: random angled walls, 15-17s: breather, 17-30s: random angled walls
    const t = state.seqStageElapsed;
    if (t < 15 || t >= 17) {
      state._seqSpawnMode = 'angled';
    } else {
      state._seqSpawnMode = 'none';
    }
  }
  else if (tp === 'lethal_rings') {
    // 0-15s:   random angled walls
    // 15-17s:  breather
    // 17-32s:  structured angled walls (burst mechanic)
    // 32-34s:  breather
    // 34-49s:  lethal rings
    // 49-51s:  breather
    // 51-66s:  lethal rings
    // 66-70s:  breather (4s)
    const t = state.seqStageElapsed;
    if (t < 15) {
      state._seqSpawnMode = 'angled';
    } else if (t < 17) {
      state._seqSpawnMode = 'none';
    } else if (t < 32) {
      state._seqSpawnMode = 'none'; // structured burst mechanic handles spawning
      state._seqStructuredTimer = (state._seqStructuredTimer || 0) + dt;
      if (state._seqStructuredTimer >= 3 && !state.angledWallsActive) {
        state._seqStructuredTimer = 0;
        const fam = DR_MECHANIC_FAMILIES['ANGLED_WALL'];
        fam.activate({ label: 'BAND3' }, 'build');
      }
    } else if (t < 34) {
      state._seqSpawnMode = 'none';
    } else if (t < 49) {
      state._seqSpawnMode = 'lethal';
    } else if (t < 51) {
      state._seqSpawnMode = 'none';
    } else if (t < 66) {
      state._seqSpawnMode = 'lethal';
    } else {
      state._seqSpawnMode = 'none'; // 4s final breather
    }
  }
  else if (tp === 'fat_cones') {
    state._seqSpawnMode = 'fat_cones';
  }
  else if (tp === 'slalom_then_zips') {
    // 0-15s: slalom (no background cones)
    // 15-17s: breather
    // 17-30s: zip lines
    const t = state.seqStageElapsed;
    if (t < 15) {
      state._seqSpawnMode = 'none'; // slalom only, no background cones
      if (!state.slalomActive && !state._seqSlalomFired) {
        state._seqSlalomFired = true;
        state.slalomActive = true;
        state.slalomUsePhysicsCurve = true;
        state._slalomGapWidth = 10;
        state.slalomSpawnZ = 0;
        state.slalomRowsDone = 0;
        // Force gap to start offset from ship so player must move immediately
        const _slalomSide = Math.random() < 0.5 ? 1 : -1;
        _drCorridorState.gapX = _slalomSide * 18;
        _drCorridorState.gapVelX = 0;
        _drCorridorState.sweepTimer = 0;
        state.slalomMaxRows = 16 + Math.floor(Math.random() * 3);
      }
    } else if (t < 17) {
      state._seqSpawnMode = 'none'; // 2s breather
    } else {
      state._seqSpawnMode = 'none'; // zipper handles its own spawning
      if (!state.zipperActive && !state._seqZipFired) {
        state._seqZipFired = true;
        state.zipperActive = true;
        state.zipperRowsLeft = 10 + Math.floor(Math.random() * 4);
        state.zipperSide = Math.random() < 0.5 ? 1 : -1;
        state.zipperHoldCount = 0;
        state.zipperSpawnTimer = -1.0;
      }
    }
  }
  else if (tp === 'endless_mix') {
    const _endlessType = state._endlessActiveType || '';
    const _endlessMechActive = state.slalomActive || state.zipperActive ||
      state.angledWallsActive || state.drCustomPatternActive || state.corridorMode ||
      state.l4CorridorActive || state.l5CorridorActive || state._arcActive;
    if (state.drPhase === 'RELEASE') {
      state._seqSpawnMode = 'cones'; state._seqConeDensity = 'normal';
    } else if (_endlessType === 'random_cones') {
      state._seqSpawnMode = 'cones'; state._seqConeDensity = 'normal';
    } else if (_endlessType === 'angled_random') {
      state._seqSpawnMode = 'angled';
    } else if (_endlessType === 'lethal') {
      state._seqSpawnMode = 'lethal';
    } else if (_endlessType === 'fat_cones') {
      state._seqSpawnMode = 'fat_cones';
    } else {
      state._seqSpawnMode = 'none'; // mechanic handles its own spawning
    }
    _drEndlessTick(dt);
    return; // endless never advances
  }

  // Warning beeps + thruster 1.5s before a speed-up (any timed stage)
  if (stage.duration && !state._restBeepFired) {
    const _nextStage = DR_SEQUENCE[state.seqStageIdx + 1];
    if (_nextStage && _nextStage.speed > stage.speed &&
        state.seqStageElapsed >= stage.duration - 1.5) {
      state._restBeepFired = true;
      if (!state.muted) {
        playSFX(440, 0.08, 'square', 0.3);
        setTimeout(() => playSFX(550, 0.08, 'square', 0.3), 200);
        setTimeout(() => playSFX(660, 0.10, 'square', 0.35), 400);
        setTimeout(() => {
          const _roar = document.getElementById('engine-roar');
          if (_roar && !state.muted) { _roar.currentTime = 0; _roar.volume = 0.25; _roar.play().catch(()=>{}); }
        }, 1500);
      }
    }
  }

  // Advance if time-based stage is done
  if (stage.duration && state.seqStageElapsed >= stage.duration) {
    _drSeqAdvance();
  }
}

// Advance to next sequencer stage
function _drSeqAdvance() {
  // Clean up any active mechanics from current stage
  clearAllCorridorFlags();
  state.zipperActive = false;
  state.slalomActive = false;
  state.angledWallsActive = false;
  state._ringsActive = false;
  state.deathRunRestBeat = 0;

  state.seqStageIdx++;
  state.seqStageElapsed = 0;
  state._seqCorridorStarted = false;
  state._seqZipTimer = 0;
  state._restBeepFired = false;
  state._seqAngledTimer = 0;
  state._seqSlalomFired = false;
  state._seqZipFired = false;
  state._seqSpawnMode = 'cones';
  state._seqConeDensity = 'normal';
  state._seqRingSpawnZ = -7;

  const next = DR_SEQUENCE[state.seqStageIdx];
  if (next) {
    console.log('[SEQ] Stage ' + state.seqStageIdx + ': ' + next.name);
    _drLogEvent('seq_advance', next.name + ' | speed=' + next.speed + 'x | physTier=' + next.physTier);
    // Set speed immediately
    const floor = state._drSpeedFloor || 0;
    state.speed = BASE_SPEED * Math.max(next.speed, floor);
    // Music transitions
    if (next.name === 'T3B_L3BOSS') {
      musicFadeTo('l4', 4000); // l4music fades in at L3 corridor
    }
    if (next.name === 'RECOVERY_2') {
      musicFadeTo('keepgoing', 2000); // keep-going after L4 corridor
    }
  }
}

// Endless mix fallback — uses existing random wave director logic
// ── Tutorial overlay helpers ──
// ── Tutorial overlay helpers ──
function _tutShowInstructionBox(title, sub, color, onDismiss) {
  // Never show if tutorial already completed
  if (window._LS.getItem('jh_tutorial_done') === '1') return;
  // Full-screen dimmed instruction box, player taps to dismiss
  let el = document.getElementById('tut-instruction-box');
  if (el) return; // already showing
  el = document.createElement('div');
  el.id = 'tut-instruction-box';
  el.style.cssText = [
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center',
    'background:rgba(0,0,0,0.7);z-index:9100;cursor:pointer'
  ].join(';');
  el.innerHTML = [
    `<div style="border:1px solid ${color};padding:32px 40px;max-width:80vw;text-align:center;background:rgba(0,0,0,0.85);border-radius:4px">`,
    `<div style="color:${color};font-family:'Knewave',monospace;font-size:clamp(22px,5vw,38px);letter-spacing:4px;text-shadow:0 0 18px ${color}">${title}</div>`,
    `<div style="color:#fff;font-family:'Knewave',monospace;font-size:clamp(13px,2.5vw,17px);margin-top:14px;line-height:1.6;opacity:0.9">${sub}</div>`,
    `<div style="color:${color};font-family:monospace;font-size:13px;margin-top:22px;opacity:0.7;letter-spacing:2px">${window.innerWidth >= 1024 ? 'PRESS ENTER TO BEGIN' : 'TAP TO BEGIN'}</div>`,
    '</div>'
  ].join('');
  const _dismiss = () => { el.remove(); if (onDismiss) onDismiss(); };
  el.addEventListener('click', _dismiss);
  el.addEventListener('touchend', (e) => { e.preventDefault(); _dismiss(); }, { passive: false });
  const _keyDismiss = (e) => { if (e.key === 'Enter' || e.key === ' ') { document.removeEventListener('keydown', _keyDismiss); _dismiss(); } };
  document.addEventListener('keydown', _keyDismiss);
  document.body.appendChild(el);
}
function _tutShowHint(title, sub, color) {
  // Small non-blocking hint shown during gameplay
  let el = document.getElementById('tutorial-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tutorial-overlay';
    el.style.cssText = 'position:fixed;bottom:14%;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none;z-index:9000;transition:opacity 0.4s';
    document.body.appendChild(el);
  }
  // Exit tutorial button
  if (!document.getElementById('tutorial-exit-btn')) {
    const exitBtn = document.createElement('button');
    exitBtn.id = 'tutorial-exit-btn';
    exitBtn.textContent = 'EXIT TUTORIAL';
    exitBtn.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9100;background:rgba(0,0,0,0.6);color:#fff;border:1px solid rgba(255,255,255,0.4);padding:7px 18px;font-family:monospace;font-size:12px;cursor:pointer;letter-spacing:2px';
    exitBtn.addEventListener('click', () => {
      window._LS.setItem('jh_tutorial_done', '1');
      _tutDestroyOverlay();
      state._tutorialActive = false;
      returnToTitle();
    });
    document.body.appendChild(exitBtn);
  }
  el.innerHTML = [
    `<div style="color:${color};font-family:monospace;font-size:clamp(18px,3.5vw,28px);font-weight:bold;letter-spacing:3px;text-shadow:0 0 14px ${color}">${title}</div>`,
    `<div style="color:#fff;font-family:monospace;font-size:clamp(11px,2vw,15px);margin-top:6px;opacity:0.8">${sub}</div>`
  ].join('');
  el.style.opacity = '1';
}
function _tutHideText() {
  const el = document.getElementById('tutorial-overlay');
  if (el) el.style.opacity = '0';
}
function _tutChime() {
  // Ascending two-tone success chime
  playSFX(660, 0.12, 'sine', 0.3);
  setTimeout(() => playSFX(880, 0.18, 'sine', 0.25), 120);
}
function _tutSignal() {
  let el = document.getElementById('tut-signal-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tut-signal-flash';
    el.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-family:'Knewave',monospace;font-size:16px;letter-spacing:4px;color:#ffffff;opacity:0;pointer-events:none;z-index:19000;transition:opacity 0.15s ease;text-align:center;";
    document.body.appendChild(el);
  }
  el.textContent = 'SIGNAL RECEIVED...';
  el.style.opacity = '1';
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 600);
}

function _tutDestroyOverlay() {
  ['tutorial-overlay','tut-instruction-box','tutorial-skip','tutorial-exit-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

// Endless mode obstacle rotation — explicit list so all types appear evenly
const _ENDLESS_ROTATION = [
  'random_cones',    // sparse cones
  'angled_random',   // random angled walls
  'lethal',          // lethal rings
  'fat_cones',       // fat cone slalom
  'angled_struct',   // structural angled walls
  'zipper',          // zip lines
  'slalom',          // slalom
  'L3_CORRIDOR',     // L3 corridor (after cooldown)
  'L4_SINE_CORRIDOR',// L4 corridor (after cooldown)
];

function _drEndlessTick(dt) {
  const BLOCK_DURATION = 15;
  const REST_DURATION  = 4;

  state._endlessBlockTimer     = (state._endlessBlockTimer     || 0);
  state._endlessRotationIdx    = (state._endlessRotationIdx    || 0);
  state._endlessCorridorCount  = (state._endlessCorridorCount  || 0);

  const _drBandIdx = DR2_RUN_BANDS.length - 1;
  const _drBand    = DR2_RUN_BANDS[_drBandIdx];

  const _drMechActive = state.slalomActive || state.zipperActive ||
    state.angledWallsActive || state.drCustomPatternActive || state.corridorMode ||
    state.l4CorridorActive || state.l5CorridorActive || state._arcActive;

  const phase = state.drPhase;

  if (phase === 'RELEASE') {
    state.drPhaseTimer += dt;
    if (state.drPhaseTimer >= REST_DURATION) {
      // Pick next from rotation, skip corridors until 30s in and then only every ~3 cycles
      let nextType = _ENDLESS_ROTATION[state._endlessRotationIdx % _ENDLESS_ROTATION.length];
      const _isCorr = nextType === 'L3_CORRIDOR' || nextType === 'L4_SINE_CORRIDOR';
      // Allow corridors only after 3 full waves, and max once per 5 waves
      const _waveCount = state.drWaveCount || 0;
      const _corrAllowed = _waveCount >= 3 && (state._endlessCorridorCount === 0 || (_waveCount - (state._endlessLastCorrWave || 0)) >= 5);
      if (_isCorr && !_corrAllowed) {
        // Skip corridor, take next type
        state._endlessRotationIdx++;
        nextType = _ENDLESS_ROTATION[state._endlessRotationIdx % _ENDLESS_ROTATION.length];
      }
      state._endlessRotationIdx++;

      // Activate the obstacle type
      state.deathRunRestBeat = 1.0;
      state._endlessBlockTimer = 0;

      if (nextType === 'random_cones' || nextType === 'angled_random') {
        state._seqSpawnMode = nextType === 'angled_random' ? 'angled' : 'cones';
        state._endlessActiveType = nextType;
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'lethal') {
        state._seqSpawnMode = 'lethal';
        state._endlessActiveType = 'lethal';
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'fat_cones') {
        state._seqSpawnMode = 'fat_cones';
        state._endlessActiveType = 'fat_cones';
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'angled_struct') {
        // Structural angled walls via mechanic family
        DR_MECHANIC_FAMILIES['ANGLED_WALL'].activate(_drBand, 'build');
        state._endlessActiveType = 'angled_struct';
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'zipper') {
        state.zipperActive = true;
        state.zipperRowsLeft = 18 + Math.floor(Math.random() * 6);
        state.zipperSide = Math.random() < 0.5 ? 1 : -1;
        state.zipperHoldCount = 0;
        state.zipperSpawnTimer = -1.0;
        state._endlessActiveType = 'zipper';
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'slalom') {
        state.slalomActive = true;
        state.slalomUsePhysicsCurve = true;
        state._slalomGapWidth = 9;
        state.slalomSpawnZ = 0;
        state.slalomRowsDone = 0;
        state.slalomMaxRows = 16 + Math.floor(Math.random() * 4);
        // Force gap away from ship center so player must dodge immediately
        const _eSlalomSide = Math.random() < 0.5 ? 1 : -1;
        _drCorridorState.gapX = _eSlalomSide * 18;
        _drCorridorState.gapVelX = 0;
        _drCorridorState.sweepTimer = 0;
        state._endlessActiveType = 'slalom';
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      } else if (nextType === 'L3_CORRIDOR' || nextType === 'L4_SINE_CORRIDOR') {
        clearAllCorridorFlags();
        DR_MECHANIC_FAMILIES[nextType].activate(_drBand, 'peak');
        state._endlessCorridorCount++;
        state._endlessLastCorrWave = state.drWaveCount || 0;
        state._endlessActiveType = nextType;
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0;
      }
    }
  } else if (phase === 'BUILD' || phase === 'SUSTAIN') {
    state._endlessBlockTimer += dt;
    const _type = state._endlessActiveType || '';
    // For spawn-mode types, tick the timer
    const _done = state._endlessBlockTimer >= BLOCK_DURATION ||
      (!_drMechActive && !['random_cones','angled_random','lethal','fat_cones','angled_struct','slalom'].includes(_type));
    if (_done) {
      clearAllCorridorFlags();
      state.zipperActive = false;
      state.slalomActive = false;
      state._endlessActiveType = '';
      state._seqSpawnMode = 'none'; // stop all spawning during breather
      state.deathRunRestBeat = 4.0;
      state.drPhase = 'RELEASE'; state.drPhaseTimer = 0;
      state.drWaveCount++;
      if (!state._tutorialActive && !state._jetLightningMode && _bonusRings.length === 0) _ringSpawnRow(0);
      // Cycle vibes through the full palette on each endless wave
      const _totalVibes = DR_VIBES.length;
      const _nextVibeIdx = ((state._endlessVibeIdx || 0) + 1) % _totalVibes;
      state._endlessVibeIdx = _nextVibeIdx;
      _applyVibeTransition(_nextVibeIdx, true);
    }
  } else if (phase === 'RECOVERY') {
    state.drPhase = 'RELEASE'; state.drPhaseTimer = 0;
  }
}

// ── Mechanic families for wave director ──
const DR_MECHANIC_FAMILIES = {

  SLALOM: {
    roles: ['build', 'peak'],
    minBand: 4, maxBand: 4,
    activate(band, role) {
      const baseRows = role === 'peak' ? 18 : 12;
      // Wider gap early, tighter later
      const gapByBand = { BAND1: 14, BAND2: 14, BAND3: 11, BAND4: 8, BAND5: 8, BAND6: 7 };
      state._slalomGapWidth = gapByBand[band.label] || 11;
      state.slalomActive = true;
      state.slalomUsePhysicsCurve = (role === 'peak');
      _drResetCorridorState();
      state.slalomSpawnZ = 0;
      state.slalomRowsDone = 0;
      state.slalomMaxRows = baseRows + Math.floor(Math.random() * 8);
    },
    isActive() { return state.slalomActive; }
  },
  ZIPPER: {
    roles: ['peak'],
    minBand: 4, maxBand: 4,
    activate(band, role) {
      // Fewer zippers early, more later
      const zipCount = { BAND1: 4, BAND2: 6, BAND3: 10, BAND4: 14, BAND5: 14, BAND6: 16 }[band.label] || 8;
      state.zipperActive = true;
      state.zipperRowsLeft = zipCount + Math.floor(Math.random() * 3);
      state.zipperSide = Math.random() < 0.5 ? 1 : -1;
      state.zipperHoldCount = 0;
      state.zipperSpawnTimer = -1.0;
    },
    isActive() { return state.zipperActive; }
  },
  ANGLED_WALL: {
    roles: ['build'],
    minBand: 1, maxBand: 1, // also available at Band 5 via no-max families
    activate(band, role) {
      state.angledWallsActive = true;
      state.angledWallSpawnZ = -_awTuner.zSpacing; // start far out so walls fade in from horizon
      state.angledWallRowsDone = 0;
    },
    isActive() { return state.angledWallsActive; }
  },
  CUSTOM_PATTERN: {
    roles: ['peak'],
    minBand: 5,
    activate(band, role) {
      state.drCustomPatternActive = true;
      state.drCustomPatternRow = 0;
      state.drCustomPatternSpawnZ = 0;
    },
    isActive() { return state.drCustomPatternActive; }
  },
  L3_CORRIDOR: {
    roles: ['build', 'peak'],
    minBand: 3,
    activate(band, role) {
      // Full campaign L3 corridor: 761 rows (74s at 2.0x speed)
      const rows = 761;
      state.corridorMode      = true;
      state.corridorSpawnZ    = -7;
      state.corridorRowsDone  = 0;
      state.corridorGapCenter = 0;
      state.corridorGapDir    = 1;
      state.corridorDelay     = 1.5;
      state._drL3MaxRows      = rows;
      state.speed = BASE_SPEED * 2.0; // L3 corridor speed
    },
    isActive() { return state.corridorMode; }
  },
  L4_SINE_CORRIDOR: {
    roles: ['build', 'peak'],
    minBand: 3,
    activate(band, role) {
      // Full campaign L4 corridor: 518 rows (48s at 2.1x speed)
      const rows = 518;
      state.l4CorridorActive = true;
      state.l4SpawnZ         = -7;
      state.l4RowsDone       = 0;
      state.l4SineT          = 0;
      state.l4Delay          = 1.5;
      state._drL4MaxRows     = rows;
      state.speed = BASE_SPEED * 2.1; // L4 corridor speed
    },
    isActive() { return state.l4CorridorActive; }
  },
  L5_SINE_CORRIDOR: {
    roles: ['peak'],
    minBand: 3,
    activate(band, role) {
      // Full campaign L5 corridor: 420 rows (33s at 2.5x speed)
      const rows = 420;
      state.l5CorridorActive    = true;
      state.l5CorridorSpawnZ    = -7;
      state.l5CorridorRowsDone  = 0;
      state.l5SineT             = 0;
      state._drL5MaxRows        = rows;
      state.speed = BASE_SPEED * 2.5; // L5 corridor speed
      state._drSpeedFloor = 2.5; // lock floor — speed never drops below this after L5
    },
    isActive() { return state.l5CorridorActive; }
  },

  // ── ARC FAMILIES (multi-stage sequences, Band 3+) ──────────────
  CORRIDOR_ARC: {
    roles: ['build', 'peak'],
    minBand: 3,
    activate(band, role) {
      // 3-stage corridor arc: L3 → L4 → L5 with campaign-matching speeds
      state._arcQueue = [
        { family: 'L3_CORRIDOR', role, speed: 2.0 },
        { family: 'L4_SINE_CORRIDOR', role, speed: 2.1 },
        { family: 'L5_SINE_CORRIDOR', role, speed: 2.5 },
      ];
      state._arcActive = true;
      state._arcStage = 0;
      // Activate first stage + force speed immediately
      const first = state._arcQueue[0];
      DR_MECHANIC_FAMILIES[first.family].activate(band, first.role);
      state.speed = BASE_SPEED * first.speed;
      state.deathRunSpeedTier = 3; // sync tier display
    },
    isActive() { return state._arcActive; }
  },
  SLALOM_ARC: {
    roles: ['build', 'peak'],
    minBand: 5,
    activate(band, role) {
      // 3-stage slalom: wide → medium → tight
      state._arcQueue = [
        { family: 'SLALOM', role, overrides: { _slalomGapWidth: 14 } },
        { family: 'SLALOM', role, overrides: { _slalomGapWidth: 10 } },
        { family: 'SLALOM', role, overrides: { _slalomGapWidth: 7 } },
      ];
      state._arcActive = true;
      state._arcStage = 0;
      const first = state._arcQueue[0];
      DR_MECHANIC_FAMILIES[first.family].activate(band, first.role);
      if (first.overrides) Object.assign(state, first.overrides);
    },
    isActive() { return state._arcActive; }
  },
  ZIPPER_ARC: {
    roles: ['peak'],
    minBand: 5,
    activate(band, role) {
      // 3-stage zipper: short → medium → long
      state._arcQueue = [
        { family: 'ZIPPER', role, overrides: { zipperRowsLeft: 6 } },
        { family: 'ZIPPER', role, overrides: { zipperRowsLeft: 10 } },
        { family: 'ZIPPER', role, overrides: { zipperRowsLeft: 16 } },
      ];
      state._arcActive = true;
      state._arcStage = 0;
      const first = state._arcQueue[0];
      DR_MECHANIC_FAMILIES[first.family].activate(band, first.role);
      if (first.overrides) Object.assign(state, first.overrides);
    },
    isActive() { return state._arcActive; }
  },
};

// ── Arc stage advancement (called each frame when arc is active) ──
function _drAdvanceArc() {
  if (!state._arcActive || !state._arcQueue) return;
  const stage = state._arcQueue[state._arcStage];
  if (!stage) { state._arcActive = false; return; }
  const fam = DR_MECHANIC_FAMILIES[stage.family];
  if (fam.isActive()) return; // current stage still running
  // Current stage finished — advance
  state._arcStage++;
  if (state._arcStage >= state._arcQueue.length) {
    // Arc complete
    state._arcActive = false;
    return;
  }
  // Activate next stage with tiny rest beat
  state.deathRunRestBeat = 0.5 + Math.random() * 0.3;
  const next = state._arcQueue[state._arcStage];
  // Find current band for activation
  let _arcBandIdx = DR2_RUN_BANDS.length - 1;
  for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
    if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _arcBandIdx = bi; break; }
  }
  DR_MECHANIC_FAMILIES[next.family].activate(DR2_RUN_BANDS[_arcBandIdx], next.role);
  if (next.overrides) Object.assign(state, next.overrides);
  // Apply per-stage speed override (corridor arc ramps speed per corridor)
  if (next.speed) {
    state.speed = BASE_SPEED * next.speed;
  }
}

// ── Coin fly-to-HUD animation (gold) ──
function _spawnCoinFly(worldPos, hudEl) {
  const v = worldPos.clone();
  v.project(camera);
  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
  const rect = hudEl.getBoundingClientRect();
  const tx = rect.left + rect.width / 2;
  const ty = rect.top + rect.height / 2;
  const count = 4 + Math.floor(Math.random() * 3); // 4-6 (less than fuel)
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    const size = 5 + Math.random() * 5;
    const startX = sx + (Math.random() - 0.5) * 20;
    const startY = sy + (Math.random() - 0.5) * 20;
    const delay = i * 40;
    const dur = 500 + Math.random() * 200;
    const midX = (startX + tx) / 2 + (Math.random() - 0.5) * 60;
    const midY = Math.min(startY, ty) - 20 - Math.random() * 40;
    dot.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;background:#ffd700;border-radius:50%;box-shadow:0 0 ${size+3}px #fa0;z-index:9999;pointer-events:none;will-change:transform,opacity;`;
    document.body.appendChild(dot);
    const start = performance.now() + delay;
    function tick(now) {
      const elapsed = now - start;
      if (elapsed < 0) { requestAnimationFrame(tick); return; }
      const t = Math.min(1, elapsed / dur);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      const bx = (1-ease)*(1-ease)*startX + 2*(1-ease)*ease*midX + ease*ease*tx;
      const by = (1-ease)*(1-ease)*startY + 2*(1-ease)*ease*midY + ease*ease*ty;
      const s = 1 - ease * 0.7;
      const op = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      dot.style.transform = `translate(${bx}px,${by}px) scale(${s})`;
      dot.style.opacity = op;
      if (t < 1) requestAnimationFrame(tick);
      else dot.remove();
    }
    requestAnimationFrame(tick);
  }
}

// ── Fuel cell fly-to-HUD animation ──
function _spawnFuelFly(worldPos) {
  // Project 3D position to screen
  const v = worldPos.clone();
  v.project(camera);
  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
  // Target: fuel cell HUD element position
  const _fcEl = document.getElementById('hud-fuelcells');
  let tx = 40, ty = 30;
  if (_fcEl) {
    const rect = _fcEl.getBoundingClientRect();
    tx = rect.left + rect.width / 2;
    ty = rect.top + rect.height / 2;
  }
  const count = 8 + Math.floor(Math.random() * 5); // 8-12 particles
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    const size = 6 + Math.random() * 6;
    const startX = sx + (Math.random() - 0.5) * 30;
    const startY = sy + (Math.random() - 0.5) * 30;
    const delay = i * 50;
    const dur = 600 + Math.random() * 200;
    // Unique arc midpoint for each particle
    const midX = (startX + tx) / 2 + (Math.random() - 0.5) * 80;
    const midY = Math.min(startY, ty) - 30 - Math.random() * 60;
    dot.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;background:#4cf;border-radius:50%;box-shadow:0 0 ${size+4}px #0af;z-index:9999;pointer-events:none;will-change:transform,opacity;`;
    document.body.appendChild(dot);
    // Animate with requestAnimationFrame for smooth bezier arc
    const start = performance.now() + delay;
    function tick(now) {
      const elapsed = now - start;
      if (elapsed < 0) { requestAnimationFrame(tick); return; }
      const t = Math.min(1, elapsed / dur);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease in-out quad
      // Quadratic bezier: start → mid → target
      const bx = (1-ease)*(1-ease)*startX + 2*(1-ease)*ease*midX + ease*ease*tx;
      const by = (1-ease)*(1-ease)*startY + 2*(1-ease)*ease*midY + ease*ease*ty;
      const s = 1 - ease * 0.7;
      const op = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      dot.style.transform = `translate(${bx}px,${by}px) scale(${s})`;
      dot.style.opacity = op;
      if (t < 1) requestAnimationFrame(tick);
      else dot.remove();
    }
    requestAnimationFrame(tick);
  }
}

// Pick a mechanic family for BUILD or PEAK phase
function _drPickMechanic(role, bandIdx, extraFilter) {
  // In endless mode (called from _drEndlessTick), exclude arc families so mechanics cycle individually
  const _isEndless = state.isDeathRun && DR_SEQUENCE[state.seqStageIdx] && DR_SEQUENCE[state.seqStageIdx].type === 'endless_mix';
  const eligible = Object.entries(DR_MECHANIC_FAMILIES)
    .filter(([k, f]) => f.roles.includes(role) && bandIdx >= f.minBand && (bandIdx >= 5 || f.maxBand == null || bandIdx <= f.maxBand) && (!_isEndless || !k.endsWith('_ARC')) && (!extraFilter || extraFilter(k)));
  if (eligible.length === 0) return null; // no eligible mechanics for this role/band

  // Anti-repeat: avoid last 3 families (recency window)
  const recent = state.drRecentFamilies || [];
  let filtered = eligible.filter(([k]) => !recent.includes(k));
  if (filtered.length === 0) filtered = eligible; // all excluded — allow any

  const pick = filtered[Math.floor(Math.random() * filtered.length)];
  // Update recency ring buffer (max 3)
  recent.push(pick[0]);
  if (recent.length > 3) recent.shift();
  state.drRecentFamilies = recent;
  state._drLastMechanic = pick[0];
  return pick[0];
}

// ── DR Session Analytics ──
let _drSessionLog = [];
function _drLogEvent(type, detail) {
  if (!state.isDeathRun) return;
  const _ss = DR_SEQUENCE[state.seqStageIdx];
  _drSessionLog.push({
    t: +(state.elapsed || 0).toFixed(2),
    score: state.score || 0,
    tier: state.deathRunSpeedTier || 0,
    seq: _ss ? _ss.name : '?',
    phase: state.drPhase,
    type: type,
    detail: detail || ''
  });
}
function _drSaveSession(reason) {
  if (_drSessionLog.length === 0) return;
  const _seqStage = DR_SEQUENCE[state.seqStageIdx];
  const session = {
    timestamp: new Date().toISOString(),
    reason: reason,
    finalScore: state.score || 0,
    finalTier: state.deathRunSpeedTier || 0,
    seqStage: _seqStage ? _seqStage.name : 'UNKNOWN',
    seqStageIdx: state.seqStageIdx || 0,
    elapsed: +(state.elapsed || 0).toFixed(2),
    waveCount: state.drWaveCount || 0,
    device: /iPhone|iPad|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
    events: _drSessionLog
  };
  // Save to localStorage
  try {
    const key = 'dr_session_logs';
    const prev = JSON.parse(localStorage.getItem(key) || '[]');
    prev.push(session);
    if (prev.length > 5) prev.shift();
    localStorage.setItem(key, JSON.stringify(prev));
  } catch(e) {}
  // Send to server
  try {
    fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session)
    }).catch(() => {});
  } catch(e) {}
  console.log('[DR-ANALYTICS] Session saved (' + _drSessionLog.length + ' events)');
  _drSessionLog = [];
}

// ── DR Debug HUD overlay ──
let _drDebugHudVisible = false;
function _drUpdateDebugHud() {
  if (!_drDebugHudVisible || !state.isDeathRun) return;
  let el = document.getElementById('dr-debug-hud');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dr-debug-hud';
    el.style.cssText = 'position:fixed;top:8px;left:8px;background:rgba(0,0,0,0.7);color:#0f0;font:11px monospace;padding:6px 10px;border-radius:4px;z-index:9999;pointer-events:none;white-space:pre;line-height:1.5;';
    document.body.appendChild(el);
  }
  const elapsed = (state.elapsed || 0).toFixed(1);
  let bandLabel = 'BAND4';
  for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
    if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { bandLabel = DR2_RUN_BANDS[bi].label; break; }
  }
  const family = state._drLastMechanic || '-';
  const active = state.slalomActive ? 'slalom' : state.zipperActive ? 'zipper' : state.angledWallsActive ? 'angled' : state.drCustomPatternActive ? 'custom' : state.corridorMode ? 'L3corr' : state.l4CorridorActive ? 'L4corr' : state.l5CorridorActive ? 'L5corr' : 'cones';
  const seqStage = DR_SEQUENCE[state.seqStageIdx];
  const seqName = seqStage ? seqStage.name : 'DONE';
  const seqTime = (state.seqStageElapsed || 0).toFixed(1);
  const seqDur  = seqStage && seqStage.duration ? seqStage.duration : '∞';
  el.textContent = `SEQ:   ${seqName}\nS-TIME:${seqTime}/${seqDur}s\nACTIVE:${active}\nTIME:  ${elapsed}s\nSPEED: ${state.speed.toFixed(0)}\nPHASE: ${state.drPhase}`;
}

// ── Debug logger — lightweight console output for tuning ──
function _dr2DebugLog() {
  if (!state.isDeathRun) return;
  const elapsed = (state.elapsed || 0).toFixed(1);
  let bandLabel = 'BAND4';
  for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
    if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { bandLabel = DR2_RUN_BANDS[bi].label; break; }
  }
  const family = state._drLastMechanic || 'RANDOM_CONES';
  console.log(`[DR] phase=${state.drPhase} band=${bandLabel} family=${family} elapsed=${elapsed}s tier=${state.deathRunSpeedTier} wave#${state.drWaveCount}`);
  _drLogEvent('phase', `${state.drPhase} | ${bandLabel} | ${family}`);
}


// ── Bonus Ring prototype (wormhole-style Line2 rings) ──
const _ringTuner = { x: 0, y: 2, radius: 5.25, lineWidth: 20, sides: 8, length: 12, freq: 3.5, sineAmp: 0, sinePeriod: 8, copies: 1, copyGap: 0 };
// length = number of rings per lane, freq = Z spacing
// copies = how many lanes side by side, copySpacing = X gap between lanes
const _ringPalette = [0xff6600, 0x00ddff, 0xcc00ff]; // orange, cyan, purple (matches wormhole)
let _bonusRings = [];      // array of { mesh: Line2, z: number }
let _ringTunerPanel = null;

function _ringBuildOne(colorIdx) {
  const SIDES = _ringTuner.sides;
  const R = _ringTuner.radius;
  const positions = [];
  for (let s = 0; s <= SIDES; s++) {
    const angle = (s % SIDES) * (Math.PI * 2 / SIDES);
    positions.push(Math.cos(angle) * R, Math.sin(angle) * R + _ringTuner.y, 0);
  }
  const geo = new LineGeometry();
  geo.setPositions(positions);
  const mat = new LineMaterial({
    color: _ringPalette[colorIdx % 3],
    linewidth: _ringTuner.lineWidth,
    transparent: false,
    worldUnits: false,
  });
  mat.depthWrite = true;
  mat.resolution.set(window.innerWidth, window.innerHeight);
  const ring = new Line2(geo, mat);
  ring.computeLineDistances();
  return ring;
}

function _ringSpawnRow(xPos, nearSpawn) {
  if (state._tutorialActive || state._jetLightningMode) return; // never spawn rings during tutorial or Jet Lightning
  const baseX = (xPos !== undefined) ? xPos : _ringTuner.x;
  const count = Math.max(1, Math.round(_ringTuner.length));
  const spacing = Math.max(0.5, _ringTuner.freq);
  const startZ = nearSpawn ? -15 : -160; // spawn from horizon so rings fade in naturally
  const copies = Math.max(1, Math.round(_ringTuner.copies));
  const copyStep = (_ringTuner.radius * 2) + _ringTuner.copyGap; // diameter + gap
  const totalWidth = (copies - 1) * copyStep;
  const startX = baseX - totalWidth / 2;
  for (let c = 0; c < copies; c++) {
    const laneX = startX + c * copyStep;
    for (let i = 0; i < count; i++) {
      const z = startZ - i * spacing;
      const sineX = _ringTuner.sineAmp > 0
        ? Math.sin((i / Math.max(1, _ringTuner.sinePeriod)) * Math.PI * 2) * _ringTuner.sineAmp
        : 0;
      const ring = _ringBuildOne(c * count + i);
      ring.position.set(laneX + sineX, 0, z);
      scene.add(ring);
      _bonusRings.push({ mesh: ring, collected: false });
    }
  }
  state._ringsActive = true;
}

// ── Ring ripple effect on collection ──
let _ringRipples = []; // { mesh, age, maxAge }
function _ringSpawnRipple(pos, color) {
  const SIDES = _ringTuner.sides;
  const R = _ringTuner.radius;
  const positions = [];
  for (let s = 0; s <= SIDES; s++) {
    const angle = (s % SIDES) * (Math.PI * 2 / SIDES);
    positions.push(Math.cos(angle) * R, Math.sin(angle) * R + _ringTuner.y, 0);
  }
  const geo = new LineGeometry();
  geo.setPositions(positions);
  const mat = new LineMaterial({
    color: color || 0xffffff,
    linewidth: _ringTuner.lineWidth * 1.5,
    transparent: true, opacity: 0.8,
    worldUnits: false,
  });
  mat.blending = THREE.AdditiveBlending;
  mat.depthWrite = false;
  mat.resolution.set(window.innerWidth, window.innerHeight);
  const ripple = new Line2(geo, mat);
  ripple.computeLineDistances();
  ripple.position.copy(pos);
  scene.add(ripple);
  _ringRipples.push({ mesh: ripple, age: 0, maxAge: 0.4, startScale: 1, color: color });
}

function _ringTickRipples(dt) {
  for (let i = _ringRipples.length - 1; i >= 0; i--) {
    const rp = _ringRipples[i];
    rp.age += dt;
    const t = rp.age / rp.maxAge; // 0→1
    // Expand outward
    const scale = 1 + t * 1.2;
    rp.mesh.scale.set(scale, scale, 1);
    // Fade out
    rp.mesh.material.opacity = 0.8 * (1 - t);
    // Move with world
    rp.mesh.position.z += (state.speed || 0) * dt;
    if (t >= 1) {
      scene.remove(rp.mesh); rp.mesh.geometry.dispose(); rp.mesh.material.dispose();
      _ringRipples.splice(i, 1);
    }
  }
}

function _ringRemoveAll() {
  for (const r of _bonusRings) {
    scene.remove(r.mesh);
    r.mesh.geometry.dispose();
    r.mesh.material.dispose();
  }
  _bonusRings = [];
  state._ringsActive = false;
}

function _ringApplyTuner() {
  for (let i = 0; i < _bonusRings.length; i++) {
    const r = _bonusRings[i];
    // Rebuild ring geometry with new Y and radius
    const SIDES = _ringTuner.sides;
    const R = _ringTuner.radius;
    const positions = [];
    for (let s = 0; s <= SIDES; s++) {
      const angle = (s % SIDES) * (Math.PI * 2 / SIDES);
      positions.push(Math.cos(angle) * R, Math.sin(angle) * R + _ringTuner.y, 0);
    }
    r.mesh.geometry.setPositions(positions);
    r.mesh.position.x = _ringTuner.x;
    // Don't touch Z — rings keep their spawned position
  }
}

function _ringToggle() {
  // Works from title screen or during gameplay
  if (_bonusRings.length === 0) {
    _ringSpawnRow(undefined, true); // nearSpawn so rings are visible
    state.speed = 0;
  } else {
    state.speed = BASE_SPEED * (LEVELS[Math.min((state.deathRunSpeedTier || 0) + 1, 4)].speedMult);
  }
  _ringShowTuner();
}
window._ringToggle = _ringToggle; // callable from console on mobile

function _ringShowTuner() {
  if (_ringTunerPanel) { _ringTunerPanel.style.display = _ringTunerPanel.style.display === 'none' ? 'block' : 'none'; return; }
  const panel = document.createElement('div');
  panel.id = 'ring-tuner';
  panel.style.cssText = 'position:fixed;bottom:10px;left:10px;background:rgba(0,0,0,0.85);color:#0fc;font:12px monospace;padding:10px;border-radius:6px;z-index:9999;';
  let _ringPaused = false;
  panel.innerHTML = `
    <div style="margin-bottom:6px;font-weight:bold;">RING TUNER<br><button id="ring-spawn-btn" style="background:#0af;color:#000;border:none;padding:2px 8px;border-radius:3px;font:bold 10px monospace;cursor:pointer;margin-right:4px;">SPAWN</button><button id="ring-pause-btn" style="background:#0fc;color:#000;border:none;padding:2px 10px;border-radius:3px;font:bold 11px monospace;cursor:pointer;">PAUSE</button><button id="ring-export-btn" style="background:#ff0;color:#000;border:none;padding:2px 8px;border-radius:3px;font:bold 10px monospace;cursor:pointer;margin-left:4px;">EXPORT</button></div>
    X: <input type="range" id="ring-x" min="-20" max="20" step="0.5" value="${_ringTuner.x}"> <span id="ring-x-val">${_ringTuner.x}</span><br>
    Y: <input type="range" id="ring-y" min="0" max="10" step="0.25" value="${_ringTuner.y}"> <span id="ring-y-val">${_ringTuner.y}</span><br>
    R: <input type="range" id="ring-r" min="1" max="10" step="0.25" value="${_ringTuner.radius}"> <span id="ring-r-val">${_ringTuner.radius}</span><br>
    W: <input type="range" id="ring-w" min="1" max="20" step="0.5" value="${_ringTuner.lineWidth}"> <span id="ring-w-val">${_ringTuner.lineWidth}</span><br>
    OP: <input type="range" id="ring-op" min="0.1" max="1" step="0.05" value="0.85"> <span id="ring-op-val">0.85</span><br>
    GLOW: <input type="range" id="ring-bl" min="0" max="1" step="0.1" value="0"> <span id="ring-bl-val">0</span><br>
    <div style="margin-top:4px;border-top:1px solid #0fc4;padding-top:4px;">COLOR: <select id="ring-color-mode" style="background:#111;color:#0fc;border:1px solid #0fc4;font:11px monospace;">
      <option value="cycle">Cycling</option>
      <option value="orange">Orange</option>
      <option value="cyan">Cyan</option>
      <option value="purple">Purple</option>
      <option value="white">White</option>
      <option value="gold">Gold</option>
      <option value="pink">Hot Pink</option>
      <option value="green">Green</option>
      <option value="red">Red</option>
      <option value="custom">Custom ↓</option>
    </select> <input type="color" id="ring-color-pick" value="#00ffcc" style="width:28px;height:20px;border:none;vertical-align:middle;"></div><br>
    <div style="margin-top:4px;border-top:1px solid #0fc4;padding-top:4px;">LEN: <input type="range" id="ring-len" min="2" max="100" step="1" value="${_ringTuner.length}"> <span id="ring-len-val">${_ringTuner.length}</span><br>
    FREQ: <input type="range" id="ring-freq" min="0.5" max="40" step="0.5" value="${_ringTuner.freq}"> <span id="ring-freq-val">${_ringTuner.freq}</span><br>
    SINE: <input type="range" id="ring-sa" min="0" max="15" step="0.5" value="${_ringTuner.sineAmp}"> <span id="ring-sa-val">${_ringTuner.sineAmp}</span><br>
    S-PER: <input type="range" id="ring-sp" min="2" max="20" step="1" value="${_ringTuner.sinePeriod}"> <span id="ring-sp-val">${_ringTuner.sinePeriod}</span><br>
    COPY: <input type="range" id="ring-cp" min="1" max="20" step="1" value="${_ringTuner.copies}"> <span id="ring-cp-val">${_ringTuner.copies}</span><br>
    X-GAP: <input type="range" id="ring-cg" min="-10" max="20" step="0.5" value="${_ringTuner.copyGap}"> <span id="ring-cg-val">${_ringTuner.copyGap}</span></div>
  `;
  document.body.appendChild(panel);
  _ringTunerPanel = panel;
  const _rtu = (id, key, apply) => document.getElementById(id).addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById(id + '-val').textContent = v;
    if (key) _ringTuner[key] = v;
    if (apply) apply(v);
    _ringApplyTuner();
  });
  document.getElementById('ring-spawn-btn').addEventListener('click', e => {
    e.stopPropagation();
    _ringRemoveAll();
    _ringSpawnRow(undefined, true);
  });
  document.getElementById('ring-export-btn').addEventListener('click', e => {
    e.stopPropagation();
    const out = JSON.stringify(_ringTuner, null, 2);
    console.log('[RING EXPORT]\n' + out);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(out).then(() => {
        e.target.textContent = 'COPIED!';
        setTimeout(() => { e.target.textContent = 'EXPORT'; }, 1500);
      }).catch(() => {
        e.target.textContent = 'SEE CONSOLE';
        setTimeout(() => { e.target.textContent = 'EXPORT'; }, 1500);
      });
    } else {
      e.target.textContent = 'SEE CONSOLE';
      setTimeout(() => { e.target.textContent = 'EXPORT'; }, 1500);
    }
  });
  document.getElementById('ring-pause-btn').addEventListener('click', e => {
    e.stopPropagation();
    _ringPaused = !_ringPaused;
    if (_ringPaused) {
      state._ringSavedSpeed = state.speed;
      state.speed = 0;
      state._ringFrozen = true; // flag checked by update loop to skip game logic
      e.target.textContent = 'PLAY';
      e.target.style.background = '#f66';
    } else {
      state.speed = state._ringSavedSpeed || BASE_SPEED;
      state._ringFrozen = false;
      e.target.textContent = 'PAUSE';
      e.target.style.background = '#0fc';
    }
  });
  _rtu('ring-x', 'x');
  _rtu('ring-y', 'y');
  _rtu('ring-r', 'radius');
  _rtu('ring-w', 'lineWidth', v => {
    for (const r of _bonusRings) r.mesh.material.linewidth = v;
  });
  _rtu('ring-op', null, v => {
    _ringTuner._opacity = v;
    for (const r of _bonusRings) r.mesh.material.opacity = v;
  });
  _rtu('ring-bl', null, v => {
    _ringTuner._glow = v;
    for (const r of _bonusRings) {
      r.mesh.material.blending = v > 0.5 ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
  });
  // Color controls
  const _colorMap = { orange: 0xff6600, cyan: 0x00ddff, purple: 0xcc00ff, white: 0xffffff, gold: 0xffd700, pink: 0xff1493, green: 0x00ff88, red: 0xff2222 };
  function _applyColor() {
    const mode = document.getElementById('ring-color-mode').value;
    _ringTuner.colorMode = mode;
    if (mode === 'cycle') {
      _bonusRings.forEach((r, i) => r.mesh.material.color.setHex(_ringPalette[i % 3]));
    } else if (mode === 'custom') {
      const hex = document.getElementById('ring-color-pick').value;
      const c = parseInt(hex.replace('#', ''), 16);
      _ringTuner.customColor = hex;
      for (const r of _bonusRings) r.mesh.material.color.setHex(c);
    } else {
      const c = _colorMap[mode] || 0x00ffcc;
      for (const r of _bonusRings) r.mesh.material.color.setHex(c);
    }
  }
  document.getElementById('ring-color-mode').addEventListener('change', _applyColor);
  document.getElementById('ring-color-pick').addEventListener('input', () => {
    document.getElementById('ring-color-mode').value = 'custom';
    _applyColor();
  });
  // These respawn all rings since they change layout
  const _rtuRespawn = (id, key) => document.getElementById(id).addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById(id + '-val').textContent = v;
    _ringTuner[key] = v;
    _ringRemoveAll();
    _ringSpawnRow(undefined, true); // nearSpawn for tuner visibility
  });
  _rtuRespawn('ring-len', 'length');
  _rtuRespawn('ring-freq', 'freq');
  _rtuRespawn('ring-sa', 'sineAmp');
  _rtuRespawn('ring-sp', 'sinePeriod');
  _rtuRespawn('ring-cp', 'copies');
  _rtuRespawn('ring-cg', 'copyGap');
}

// ── Death Run transition state ──
let _drTransFrom = null;   // DEATH_RUN_VIBES entry we're transitioning from
let _drTransTo   = null;   // DEATH_RUN_VIBES entry we're transitioning to
let _drTransT    = 1;      // 0 = start, 1 = done
let _drTransActive = false;

function applyDeathRunVibeTransition(fromVibe, toVibe) {
  _drTransFrom   = fromVibe;
  _drTransTo     = toVibe;
  _drTransT      = 0;
  _drTransActive = true;
}

function updateDeathRunTransition(dt) {
  if (!_drTransActive) return;
  _drTransT = Math.min(1, _drTransT + dt * 1.2);
  const t = _drTransT;
  const from = _drTransFrom;
  const to   = _drTransTo;

  // Sky
  skyMat.uniforms.topColor.value.lerpColors(from.skyTop, to.skyTop, t);
  skyMat.uniforms.botColor.value.lerpColors(from.skyBot, to.skyBot, t);
  // Fog
  scene.fog.color.lerpColors(from.fogColor, to.fogColor, t);
  // Grid
  const gridLerp = new THREE.Color().lerpColors(from.gridColor, to.gridColor, t);
  updateGridColor(gridLerp);
  // Floor line
  const floorLerp = new THREE.Color().lerpColors(from.floorLine, to.floorLine, t);
  floorMat.uniforms.uLineColor.value.copy(floorLerp);
  mirrorMat.uniforms.uLineColor.value.copy(floorLerp);
  // Galaxy tint
  targetNebulaTint.lerpColors(from.gridColor, to.gridColor, t);
  // Sun color
  const sunLerped = new THREE.Color().lerpColors(from.sunColor, to.sunColor, t);
  updateSunColor(sunLerped, -1); // -1 = manual uniform control
  // Sun shader uniform lerping
  const fromUV   = (from.sunShader === 1) ? 1.0 : 0.0;
  const toUV     = (to.sunShader === 1)   ? 1.0 : 0.0;
  const fromIce  = (from.sunShader === 3) ? 1.0 : 0.0;
  const toIce    = (to.sunShader === 3)   ? 1.0 : 0.0;
  const fromGold = (from.sunShader === 4) ? 1.0 : 0.0;
  const toGold   = (to.sunShader === 4)   ? 1.0 : 0.0;
  const fromL3   = (from.sunShader === 2) ? 1.0 : 0.0;
  const toL3     = (to.sunShader === 2)   ? 1.0 : 0.0;
  sunMat.uniforms.uIsUV.value    = fromUV   + (toUV   - fromUV)   * t;
  sunMat.uniforms.uIsL3.value    = fromL3   + (toL3   - fromL3)   * t;
  sunMat.uniforms.uIsIce.value   = fromIce  + (toIce  - fromIce)  * t;
  sunMat.uniforms.uIsGold.value  = fromGold + (toGold - fromGold) * t;
  sunCapMat.uniforms.uIsUV.value   = sunMat.uniforms.uIsUV.value;
  sunCapMat.uniforms.uIsL3.value   = sunMat.uniforms.uIsL3.value;
  sunCapMat.uniforms.uIsIce.value  = sunMat.uniforms.uIsIce.value;
  sunCapMat.uniforms.uIsGold.value = sunMat.uniforms.uIsGold.value;
  // Bloom
  bloom.strength = from.bloomStrength + (to.bloomStrength - from.bloomStrength) * t;
  // Thruster color
  thrusterColor.lerpColors(from.thrusterColor, to.thrusterColor, t);
  // Warp palette — apply target vibe's colors if defined
  const _warpTarget = t >= 0.5 ? to : from;
  if (_warpTarget.warpCol1) {
    sunMat.uniforms.uWarpCol1.value.set(_warpTarget.warpCol1[0], _warpTarget.warpCol1[1], _warpTarget.warpCol1[2]);
    sunMat.uniforms.uWarpCol2.value.set(_warpTarget.warpCol2[0], _warpTarget.warpCol2[1], _warpTarget.warpCol2[2]);
    sunMat.uniforms.uWarpCol3.value.set(_warpTarget.warpCol3[0], _warpTarget.warpCol3[1], _warpTarget.warpCol3[2]);
  }

  if (_drTransT >= 1) {
    _drTransActive = false;
  }
}

let _pendingVibeIdx = -1; // deferred vibe transition (waits for mechanic to finish)
function checkDeathRunVibe() {
  if (!state.isDeathRun) return;
  // Vibes synced to bands: each band = new vibe. Band 6+ cycles remaining vibes every 45s.
  let _curBand = DR2_RUN_BANDS.length - 1;
  if (state._drForcedBand != null && state._drForcedBand >= 0) {
    _curBand = state._drForcedBand;
  } else {
    for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
      if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _curBand = bi; break; }
    }
  }
  let targetVibeIdx;
  if (_curBand < 6) {
    targetVibeIdx = _curBand; // Band 1=vibe 0, Band 2=vibe 1, etc.
  } else {
    // Beyond Band 6: cycle through vibes 6+ every 45s
    targetVibeIdx = 5 + Math.floor((state.elapsed - 180) / 45);
  }
  targetVibeIdx = targetVibeIdx % DEATH_RUN_VIBES.length;
  if (targetVibeIdx !== state.deathRunVibeIdx && _pendingVibeIdx < 0) {
    // If we're in RELEASE or RECOVERY (no active mechanic), transition now
    const safePhase = state.drPhase === 'RELEASE' || state.drPhase === 'RECOVERY';
    if (safePhase) {
      _applyVibeTransition(targetVibeIdx);
    } else {
      // Defer until current mechanic completes
      _pendingVibeIdx = targetVibeIdx;
    }
  }
  // Check if deferred transition can fire now
  if (_pendingVibeIdx >= 0) {
    const safeNow = state.drPhase === 'RELEASE' || state.drPhase === 'RECOVERY';
    if (safeNow) {
      _applyVibeTransition(_pendingVibeIdx);
      _pendingVibeIdx = -1;
    }
  }
}
function _applyVibeTransition(targetVibeIdx, suppressRestBeat) {
  const fromVibe = DEATH_RUN_VIBES[state.deathRunVibeIdx];
  const toVibe   = DEATH_RUN_VIBES[targetVibeIdx];
  state.deathRunVibeIdx = targetVibeIdx;
  _pendingVibeIdx = -1;
  state.levelElapsed    = 0;
  clearAllCorridorFlags();
  // Rest beat: 2.5s of no cones (suppressed when called from the sequencer
  // to avoid blocking the sequencer tick)
  if (!suppressRestBeat) state.deathRunRestBeat = 2.5;
  // Reset wave director to RELEASE after vibe change
  state.drPhase = 'RELEASE';
  state.drPhaseTimer = 0;
  const _relDur = DR2_PHASE_DURATIONS.RELEASE;
  state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);
  // Let existing obstacles scroll off naturally — no wipe
  // Smooth visual transition (bypasses updateTransition which needs LEVELS[])
  applyDeathRunVibeTransition(fromVibe, toVibe);
  state.currentLevelIdx = toVibe.sunShader;
  updateThrusterColor(toVibe.thrusterColor);
  if (toVibe.tendrils === 'aurora' || toVibe.tendrils === 'l5f') {
    auroraTVisible = true;
  } else {
    auroraTVisible = false;
  }
  playLevelUp();
  updateHUDLevel();
  showBanner('TIER ' + (targetVibeIdx + 1), 'levelup', 2500);
  updateCoinColors();
}
function checkDeathRunSpeed() {
  if (!state.isDeathRun) return;
  // Don't override speed during corridor arc (arc sets its own per-stage speed)
  if (state._arcActive && state._arcQueue && state._arcQueue[state._arcStage] && state._arcQueue[state._arcStage].speed) return;

  // Player level starting speed bonus
  const _plvl = loadPlayerLevel();
  const _lvlSpeedBonus = _plvl >= 15 ? 1.5 : _plvl >= 10 ? 1.4 : _plvl >= 5 ? 1.2 : 1.0;

  // Speed synced to bands (tiers) — minimum is level bonus
  // T1-2: base, T3: 1.2x, T4: 1.35x (corridors), T5: 1.5x, T6: 1.85x (max)
  const BAND_SPEED = [1.0, 1.0, 1.2, 1.35, 1.5, 1.85]; // idx 0-5 = Band 1-6

  // Get current band index (respects forced band override)
  let _curBand = DR2_RUN_BANDS.length - 1;
  if (state._drForcedBand != null && state._drForcedBand >= 0) {
    _curBand = state._drForcedBand;
  } else {
    for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
      if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _curBand = bi; break; }
    }
  }
  const _floor = state._drSpeedFloor || 0;
  const targetSpeedMult = Math.max(_lvlSpeedBonus, _floor, BAND_SPEED[Math.min(_curBand, BAND_SPEED.length - 1)]);
  const targetTier = _curBand;

  // Defer speed change if mechanic is active
  const safeForSpeed = state.drPhase === 'RELEASE' || state.drPhase === 'RECOVERY';
  if (targetTier !== state.deathRunSpeedTier && !safeForSpeed) {
    state._pendingSpeedTier = targetTier;
  }
  if (safeForSpeed && state._pendingSpeedTier != null && state._pendingSpeedTier >= 0) {
    const prevTier = state.deathRunSpeedTier;
    state.deathRunSpeedTier = state._pendingSpeedTier;
    state.speed = BASE_SPEED * Math.max(_lvlSpeedBonus, _floor, BAND_SPEED[Math.min(state.deathRunSpeedTier, BAND_SPEED.length - 1)]);
    state._pendingSpeedTier = -1;
    if (state.deathRunSpeedTier > prevTier && prevTier >= 0 && !state.introActive) {
      state._drSpeedBeepFired = false;
      hapticMedium();
      const roar = document.getElementById('engine-roar');
      if (roar && !state.muted) { roar.currentTime = 0; roar.volume = 0.06; roar.play().catch(() => {}); }
      state._thrusterFlare = 2.0;
    }
  } else if (safeForSpeed && targetTier !== state.deathRunSpeedTier) {
    const prevTier = state.deathRunSpeedTier;
    state.deathRunSpeedTier = targetTier;
    state.speed = BASE_SPEED * targetSpeedMult;
    if (state.deathRunSpeedTier > prevTier && prevTier >= 0 && !state.introActive) {
      state._drSpeedBeepFired = false;
      hapticMedium();
      const roar = document.getElementById('engine-roar');
      if (roar && !state.muted) { roar.currentTime = 0; roar.volume = 0.06; roar.play().catch(() => {}); }
      state._thrusterFlare = 2.0;
    }
  }

  // Animate thruster flare decay
  if (state._thrusterFlare > 1.0) {
    window._thrusterScale = state._thrusterFlare;
    state._thrusterFlare -= 0.03;
    if (state._thrusterFlare <= 1.0) {
      state._thrusterFlare = 0;
      window._thrusterScale = window._baseThrusterScale || 1.0;
    }
  }

  // Music: crossfade to l4 when L3 corridor boss starts (handled in _drSeqAdvance)
}

let _introTimers = [];
function clearIntroTimers() {
  _introTimers.forEach(id => { clearTimeout(id); clearInterval(id); cancelAnimationFrame(id); });
  _introTimers = [];
  state.thrusterPower = 0;  // kill any mid-spurt flicker
  // Stop engine startup SFX if playing
  const eng = document.getElementById('engine-start');
  if (eng) { eng.pause(); eng.currentTime = 0; }
}

// ── Thruster sputter-on animation ──
let _sputterTimer = null;
function beginThrusterSputter() {
  if (_sputterTimer) { clearInterval(_sputterTimer); _sputterTimer = null; }
  state.thrusterPower = 0;
  const startT = performance.now();
  const duration = 2200; // 2.2s total sputter
  _sputterTimer = setInterval(() => {
    const t = (performance.now() - startT) / duration;
    if (t >= 1) {
      state.thrusterPower = 1;
      clearInterval(_sputterTimer);
      _sputterTimer = null;
      return;
    }
    // Base ramp with random sputters (drops to near-zero)
    const ramp = t * t; // ease-in quadratic
    const sputter = Math.random() < 0.3 ? Math.random() * 0.15 : 1.0;
    state.thrusterPower = Math.min(1, ramp * sputter + ramp * 0.3);
  }, 50);
}
function killThrusterSputter() {
  if (_sputterTimer) { clearInterval(_sputterTimer); _sputterTimer = null; }
  state.thrusterPower = 1;
}
let _musicTimers = [];
function clearMusicTimers() {
  _musicTimers.forEach(id => clearTimeout(id));
  _musicTimers = [];
}

function fadeOutIntroOverlay(el) {
  el.classList.add('fading-out');
  el.style.pointerEvents = 'none';  // restore pass-through immediately
  setTimeout(() => { el.style.display = 'none'; el.innerHTML = ''; el.classList.remove('fading-out'); }, 820);
  // Spawn opening rings right as prologue ends — close to ship for instant dopamine hit

}

// ── HEAD START SYSTEM ─────────────────────────────────────────────
let _hsTimeout = null;  // auto-dismiss timer
let _hsActive = false;  // true while head start prompt is showing

function showHeadStartPrompt() {
  const overlay = document.getElementById('headstart-overlay');
  if (!overlay) return;

  const freeCount = loadFreeHeadStarts();
  const fuel = loadFuelCells();
  const basicCost = getHeadStartCost(false);
  const megaCost = getHeadStartCost(true);
  const canBasic = freeCount > 0 || fuel >= basicCost;
  const canMega = fuel >= megaCost;

  if (!canBasic && !canMega) return; // nothing to show

  const basicBtn = document.getElementById('hs-basic-btn');
  const megaBtn = document.getElementById('hs-mega-btn');

  // Basic button
  if (canBasic && basicBtn) {
    if (freeCount > 0) {
      basicBtn.innerHTML = _FUEL_SVG + ' HEAD START <span class="hs-free">FREE</span>';
    } else {
      basicBtn.innerHTML = _FUEL_SVG + ' HEAD START \u2014 ' + basicCost;
    }
    basicBtn.style.display = '';
    basicBtn.onclick = () => { activateHeadStart(false); dismissHeadStart(); };
    basicBtn.addEventListener('touchstart', () => { basicBtn.style.transform = 'scale(0.94)'; }, { passive: true });
    basicBtn.addEventListener('touchend', () => { basicBtn.style.transform = 'scale(1)'; }, { passive: true });
  } else if (basicBtn) {
    basicBtn.style.display = 'none';
  }

  // Mega button
  if (canMega && megaBtn) {
    megaBtn.innerHTML = _FUEL_SVG + _FUEL_SVG + ' MEGA \u2014 ' + megaCost;
    megaBtn.style.display = '';
    megaBtn.onclick = () => { activateHeadStart(true); dismissHeadStart(); };
    megaBtn.addEventListener('touchstart', () => { megaBtn.style.transform = 'scale(0.94)'; }, { passive: true });
    megaBtn.addEventListener('touchend', () => { megaBtn.style.transform = 'scale(1)'; }, { passive: true });
  } else if (megaBtn) {
    megaBtn.style.display = 'none';
  }

  overlay.style.display = 'flex';
  overlay.classList.remove('fading');
  _hsActive = true;
  // Tap outside buttons = dismiss (skip head start)
  overlay.onclick = (e) => { if (e.target === overlay) dismissHeadStart(); };
  requestAnimationFrame(() => overlay.classList.add('visible'));

  // Auto-dismiss after 4 seconds
  if (_hsTimeout) clearTimeout(_hsTimeout);
  _hsTimeout = setTimeout(() => dismissHeadStart(), 4000);
}

function dismissHeadStart() {
  _hsActive = false;
  if (_hsTimeout) { clearTimeout(_hsTimeout); _hsTimeout = null; }
  const overlay = document.getElementById('headstart-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.classList.add('fading');
  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.classList.remove('fading');
  }, 500);
}

function activateHeadStart(mega) {
  const freeCount = loadFreeHeadStarts();
  const fuel = loadFuelCells();
  const cost = getHeadStartCost(mega);

  // Deduct cost
  if (!mega && freeCount > 0) {
    saveFreeHeadStarts(freeCount - 1);
  } else {
    if (fuel < cost) return; // safety
    saveFuelCells(fuel - cost);
  }
  updateTitleFuelCells();

  // Target: Head Start → T3 (idx 2), Mega → T5 (idx 4)
  const targetLevelIdx = mega ? 4 : 2;
  const targetScore = LEVELS[Math.min(targetLevelIdx, LEVELS.length - 1)].scoreThreshold;
  const warpSpeed = BASE_SPEED * 4.5;  // ~4.5x normal — visually fast warp
  const warpDuration = mega ? 3500 : 2500; // ms — time to blast through levels
  const graceDuration = mega ? 3000 : 2000; // invincible grace after landing

  // Activate invincible + warp speed immediately
  state.invincibleTimer = (warpDuration + graceDuration) / 1000;
  state.invincibleSpeedActive = true;
  state.invincibleGraceTimer = 0;
  state.speed = warpSpeed;
  // Enable magnet to hoover up all coins during warp
  state.magnetActive = true;
  state.magnetTimer = (warpDuration + graceDuration) / 1000;

  // Skip intro if somehow still active
  if (state.introActive) {
    state.introActive = false;
    const introOv = document.getElementById('intro-overlay');
    if (introOv) { introOv.style.display = 'none'; introOv.innerHTML = ''; }
    clearIntroTimers();
  }

  // Rapidly tick score up during warp — levels transition naturally via checkLevelUp()
  const scoreStart = state.score;
  const scoreTarget = targetScore + 5; // slightly past threshold
  const rampStart = performance.now();
  const _hsRamp = setInterval(() => {
    const t = Math.min(1, (performance.now() - rampStart) / warpDuration);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    state.score = Math.floor(scoreStart + (scoreTarget - scoreStart) * ease);
    if (t >= 1) {
      clearInterval(_hsRamp);
      if (state.isDeathRun) {
        // DR: jump sequencer directly — normal=T3A (idx 2, key 3), mega=T3B_L3BOSS (idx 3, key 4)
        const _targetStageIdx = mega ? 3 : 2;
        clearAllCorridorFlags();
        state.deathRunRestBeat = 0;
        state.seqStageIdx = _targetStageIdx;
        state.seqStageElapsed = 0;
        state._seqCorridorStarted = false;
        state._seqSpawnMode = 'cones';
        state._seqConeDensity = 'normal';
        state._seqVibeApplied = -1;
        const _ts = DR_SEQUENCE[_targetStageIdx];
        if (_ts) state.speed = BASE_SPEED * _ts.speed;
      } else {
        const finalLvl = LEVELS[Math.min(targetLevelIdx, LEVELS.length - 1)];
        state.speed = BASE_SPEED * finalLvl.speedMult;
      }
    }
  }, 16);

  // Flash banner
  const bannerText = mega ? 'MEGA START' : 'HEAD START';
  const banner = document.createElement('div');
  banner.className = 'hs-banner';
  banner.textContent = bannerText;
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('show'));
  setTimeout(() => {
    banner.classList.add('fade');
    setTimeout(() => banner.remove(), 600);
  }, 1500);
}

function showIntroText() {
  const overlay = document.getElementById('intro-overlay');
  if (!overlay) return;
  clearIntroTimers();
  overlay.innerHTML = '';
  overlay.style.display = 'flex';

  const lineA = document.createElement('div');
  lineA.className = 'intro-line line-a';
  lineA.textContent = "ONE RACE STANDS BETWEEN YOU AND PEACE.";

  const lineB = document.createElement('div');
  lineB.className = 'intro-line line-b';
  lineB.textContent = "THIS IS THAT RACE.";

  const lineC = document.createElement('div');
  lineC.className = 'intro-title line-c';
  lineC.textContent = "JET HORIZON";

  const skipHint = document.createElement('div');
  skipHint.className = 'intro-skip-hint';
  const _isMobile = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  skipHint.textContent = 'tap to skip';

  overlay.appendChild(lineA);
  overlay.appendChild(lineB);
  overlay.appendChild(lineC);
  overlay.appendChild(skipHint);

  // Mobile: tap anywhere on the intro overlay to skip
  overlay.addEventListener('touchstart', function _tapSkip(e) {
    e.preventDefault();
    overlay.removeEventListener('touchstart', _tapSkip);
    clearIntroTimers();
    fadeOutIntroOverlay(overlay);
    state.introActive = false;
    beginThrusterSputter();
    state._introLiftActive = true;
    state._introLiftTimer = 0;
  }, { passive: false });

  // Line A fades in at 3s (3.5s duration → done ~6.5s)
  _introTimers.push(setTimeout(() => { lineA.classList.add('playing'); }, 3000));
  // 2s pause → Line B starts at 8.5s (3.5s duration → done ~12s)
  _introTimers.push(setTimeout(() => { lineB.classList.add('playing'); }, 8500));
  // Engine startup SFX — fade is baked into the audio file, just play from start
  _introTimers.push(setTimeout(() => {
    const eng = document.getElementById('engine-start');
    if (eng && !state.muted) {
      _ensureCtxRunning();
      eng.currentTime = 0;
      eng.volume = 0.12;
      eng.play().catch(() => {});
    }
  }, 8500));

  // Pre-spurts — ultra-quick thruster flickers, paired like failed ignition
  function _preSpurt(delay, peak, dur) {
    _introTimers.push(setTimeout(() => {
      if (!state.introActive) return;
      const _start = performance.now();
      const _iv = setInterval(() => {
        const t = (performance.now() - _start) / dur;
        if (t >= 1) { state.thrusterPower = 0; clearInterval(_iv); return; }
        const env = t < 0.25 ? (t / 0.25) : (1 - (t - 0.25) / 0.75);
        state.thrusterPower = env * peak;
      }, 16);
      _introTimers.push(_iv);
    }, delay));
  }
  // Pair 1 — after engine audio has faded in (~10s)
  _preSpurt(10000, 0.45, 125);
  _preSpurt(10175, 0.35, 110);
  // Trio 2 — more urgent triple burst (~11.8s)
  _preSpurt(11800, 0.5, 130);
  _preSpurt(11980, 0.35, 110);
  _preSpurt(12140, 0.25, 100);
  // Pair 3 — one more double flicker (~13.5s)
  _preSpurt(13500, 0.4, 125);
  _preSpurt(13675, 0.3, 110);
  // 2s pause → JET HORIZON title card starts at 14s (4.5s duration → done ~18.5s)
  _introTimers.push(setTimeout(() => { lineC.classList.add('playing'); }, 14000));
  // Cones unlock right as title finishes fading out (~18.5s)
  _introTimers.push(setTimeout(() => {
    fadeOutIntroOverlay(overlay);
    state.introActive = false;
    beginThrusterSputter();
  }, 18500));
}

function killPlayer() {
  // Tutorial: flash and respawn, reset current zip row if in zip phase
  if (state._tutorialActive) {
    hapticMedium();
    addCrashFlash(0xff4400);
    playSFX(300, 0.2, 'sawtooth', 0.15);
    state.shipVelX = 0;
    state.shipX = 0;
    // In zip phase: flag as hit and clear row so it respawns
    if (state._tutorialStep === 1.5) {
      state._tutorialZipHit = true;
      for (let _ti = activeObstacles.length - 1; _ti >= 0; _ti--) {
        if (activeObstacles[_ti].userData._tutZip) {
          returnObstacleToPool(activeObstacles[_ti]);
          activeObstacles.splice(_ti, 1);
        }
      }
    }
    return;
  }
  // Invincibility check — head start, overdrive powerup, etc.
  if (state.invincibleTimer > 0) {
    hapticMedium();
    addCrashFlash(0xffcc00);
    playSFX(400, 0.3, 'sawtooth', 0.2);
    return;
  }
  if (state.shieldActive) {
    // Decrement hit points
    state.shieldHitPoints = (state.shieldHitPoints || 1) - 1;
    hapticMedium();
    // Trigger hit ripple — rotate through 6 slots
    _shieldHitIdx = (_shieldHitIdx + 1) % 6;
    const _hitTheta = Math.random() * Math.PI * 2;
    const _hitPhi   = Math.acos(2 * Math.random() - 1);
    shieldMat.uniforms.uHitPos.value[_shieldHitIdx].set(
      Math.sin(_hitPhi) * Math.cos(_hitTheta),
      Math.sin(_hitPhi) * Math.sin(_hitTheta),
      Math.cos(_hitPhi)
    );
    shieldMat.uniforms.uHitTime.value[_shieldHitIdx] = shieldMat.uniforms.uTime.value;
    // Update uLife
    const _shieldTier = loadUpgradeTier('shield');
    const _maxHits = (_shieldTier >= 5) ? 3 : (_shieldTier >= 4) ? 2 : 1;
    const _shTierForLife = loadUpgradeTier('shield');
    shieldMat.uniforms.uLife.value = (_shTierForLife >= 3) ? state.shieldHitPoints / _maxHits : 1.0;
    if (state.shieldHitPoints > 0) {
      // Shield survives — update color + life
      const shieldColors = [0x26aeff, 0x26aeff, 0x00f0cc, 0x00f0cc];
      const sc = shieldColors[state.shieldHitPoints] || 0x00f0ff;
      shieldMat.uniforms.uColor.value.setHex(sc);
      shieldMat.uniforms.uNoiseEdgeColor.value.setHex(sc);
      shieldWireMat.color.setHex(sc);
      shieldLight.color.setHex(sc);
      const _shTier = loadUpgradeTier('shield');
      const _shMaxHits = (_shTier >= 5) ? 3 : (_shTier >= 4) ? 2 : 1;
      const _shTierForLife2 = loadUpgradeTier('shield');
      shieldMat.uniforms.uLife.value = (_shTierForLife2 >= 3) ? state.shieldHitPoints / _shMaxHits : 1.0;
      addCrashFlash(sc);
      const _shHitSfx = document.getElementById('shield-hit-sfx'); if (_shHitSfx) { _shHitSfx.currentTime = 0; _shHitSfx.play().catch(()=>{}); }
      state._prevShieldHP = state.shieldHitPoints;
      return;
    }
    // Shield breaks — trigger death ripple then dissolve
    state.shieldActive = false;
    state._prevShieldHP = 0;
    state._shieldBreakT = 0;
    shieldWireMat.opacity = 0;
    addCrashFlash(0x00f0ff);
    const _shHitSfx2 = document.getElementById('shield-hit-sfx'); if (_shHitSfx2) { _shHitSfx2.currentTime = 0; _shHitSfx2.play().catch(()=>{}); }
    return;
  }

  // Save corridor type so repair ship can restart it from scratch
  state._deathCorridorType = state.l5CorridorActive ? 'l5' : state.l4CorridorActive ? 'l4' : state.corridorMode ? 'l3' : null;

  state.phase = 'dead';
  // Cancel retry/repair sweep if somehow active
  _retrySweepActive = false;
  _retryIsFromDead = false;
  _drLogEvent('death', `score=${state.score} tier=${state.deathRunSpeedTier}`);
  _drSaveSession('death');
  // [WHEEL DISABLED] if (!state.wheelEarned) state.wheelEarned = true;
  dismissHeadStart(); // clean up if still showing
  // Kill roll state immediately on death
  touch.rollToggle = false;
  touch.rollUp = false;
  touch.rollDown = false;
  state.rollHeld = false;
  state.rollAngle = 0;
  state.rollDir = 0;
  shipGroup.rotation.z = 0;

  // ── Ship explosion: hide ship + thrusters, spawn particles ──
  shipGroup.visible = false;
  // Kill thruster particle systems (they're on scene, not shipGroup)
  thrusterSystems.forEach(s => { s.points.visible = false; });
  miniThrusterSystems.forEach(s => { s.points.visible = false; });
  {
    // Find nearest obstacle for deflection direction
    const _sPos = new THREE.Vector3(state.shipX, shipGroup.position.y, shipGroup.position.z);
    let _obstPos = new THREE.Vector3(_sPos.x, _sPos.y, _sPos.z - 2); // default: obstacle ahead
    let _nearestDist = Infinity;
    for (let _oi = 0; _oi < activeObstacles.length; _oi++) {
      const _op = activeObstacles[_oi].position;
      const _dx = _sPos.x - _op.x;
      const _dz = _sPos.z - _op.z;
      const _d2 = _dx * _dx + _dz * _dz;
      if (_d2 < _nearestDist) {
        _nearestDist = _d2;
        _obstPos.set(_op.x, _op.y, _op.z);
      }
    }
    // Build color palette from current level
    const _lvl = LEVELS[state.currentLevelIdx] || LEVELS[0];
    const _palette = [
      _lvl.gridColor,
      _lvl.sunColor,
      new THREE.Color(0xffffff),
    ];
    const _deathSpeed = state.invincibleSpeedActive ? state.speed * 1.8 : state.speed;
    _spawnExplosion(_sPos, _obstPos, _deathSpeed, _palette);
    // Layered VFX: temporarily disabled to isolate face explosion + particles
    // _triggerFlash(_sPos);
    // _triggerShockwave(_sPos);
    // _triggerSparks(_sPos);
    // Face explosion: ship triangles fly apart from impact
    const _faceExpModel = _altShipActive ? _altShipModel : window._shipModel;
    if (_faceExpModel) {
      const _impDir = new THREE.Vector3().subVectors(_sPos, _obstPos).normalize();
      _triggerFaceExplosion(_faceExpModel, _impDir);
    }
    // Camera zoom-out + lateral orbit to profile view
    _expDeathZoomTarget = _baseFOV + 15; // less FOV zoom since camera rises instead
    _expDeathZoomActive = true;
    _expCamOrbitActive = true;
    _expCamOrbitT = 0;
    _expCamAnchorX = cameraPivot.position.x;
    _expCamAnchorY = cameraPivot.position.y;
    _expCamAnchorZ = cameraPivot.position.z;
    // Store crash site in world space for lookAt
    _expCrashWorldPos.set(shipGroup.position.x, shipGroup.position.y, shipGroup.position.z);
  }

  if (state.score > state.bestScore) state.bestScore = state.score;

  hapticHeavy(); // death
  // Stop engine SFX
  const _engD = document.getElementById('engine-start');
  const _roarD = document.getElementById('engine-roar');
  if (_engD && !_engD.paused) { _engD.pause(); _engD.currentTime = 0; }
  if (_roarD && !_roarD.paused) { _roarD.pause(); _roarD.currentTime = 0; }
  playCrash();
  // addCrashFlash(); // disabled to isolate face explosion

  if (titleMusic) titleMusic.currentTime = 0;  // always start title from top on game over
  // Stop lake ambience on game over
  if (lakeMusic) { lakeMusic.pause(); lakeMusic.currentTime = 0; setTrackVol('lake', 0); }
  musicFadeTo('title', 2500);

  // Player-facing score — apply distance multiplier
  const _rawScore = Math.floor(state.playerScore);
  const _dist = state.distance || 0;
  // Multiplier: every 5000 distance units = +0.1x (so ~3min full run ≈ 3x)
  const _distMultiplier = Math.max(1, 1 + Math.floor(_dist / 5000) * 0.1);
  const finalScore = Math.floor(_rawScore * _distMultiplier);
  const isNewBest = finalScore > state.bestScore;
  if (isNewBest) state.bestScore = finalScore;
  document.getElementById('go-score').textContent = finalScore.toLocaleString();
  // Show multiplier breakdown if it applied
  const _goMultEl = document.getElementById('go-dist-mult');
  if (_goMultEl) {
    if (_distMultiplier > 1) {
      _goMultEl.textContent = 'Distance bonus ×' + _distMultiplier.toFixed(1);
      _goMultEl.style.display = 'block';
    } else {
      _goMultEl.style.display = 'none';
    }
  }

  // ── Coins earned (single total) ──
  const pickupCoins = state.sessionCoins;
  const distanceBonus = Math.floor(finalScore / 10) * ((state.isDeathRun) ? 1.5 : 1);
  const drTier = state.isDeathRun ? (state.deathRunSpeedTier || 0) : 0;
  const tierBonus = drTier * 50;
  let coinMultiplier = 1;
  const _dcFlag = window._LS.getItem('jetslide_double_next');
  if (_dcFlag) {
    coinMultiplier = (parseInt(_dcFlag) || 1) + 1;  // '1' → 2x, '2' → 3x
    window._LS.removeItem('jetslide_double_next');
  }
  const totalCoins = (pickupCoins + Math.floor(distanceBonus) + tierBonus) * coinMultiplier;
  const _totalEl = document.getElementById('go-coins-total');
  if (_totalEl) _totalEl.textContent = '+' + totalCoins + (coinMultiplier > 1 ? ' (' + coinMultiplier + '×)' : '');

  // Persist total earned coins to wallet
  saveCoinWallet(loadCoinWallet() + totalCoins);
  _totalCoins = loadCoinWallet();

  // ── Mission Ladder ──
  const runStats = {
    score: Math.floor(state.playerScore),
    coins: state.sessionCoins,
    powerups: state.sessionPowerups || 0,
    shields: state.sessionShields || 0,
    lasers: state.sessionLasers || 0,
    invincibles: state.sessionInvincibles || 0,
    isDR: state.isDeathRun,
    drTier: state.deathRunSpeedTier || 0,
  };
  // Update lifetime stats
  const lt = loadLifetimeStats();
  lt.coins += runStats.coins;
  lt.score += runStats.score;
  lt.runs += 1;
  lt.powerups += runStats.powerups;
  saveLifetimeStats(lt);

  const ladderResult = checkLadder(runStats, lt);

  // Show ladder progress on death screen
  // Mission complete SFX
  if (ladderResult.advanced && ladderResult.completedMissions.length > 0) {
    playSFX(600, 0.2, 'sine', 0.15);
    setTimeout(() => playSFX(900, 0.2, 'sine', 0.15), 120);
  }

  // ── Level bar ──
  const xpResult = addXPFromRun(state.playerScore);
  const _levelLabelEl = document.getElementById('go-level-label');
  const _xpBarEl = document.getElementById('go-xp-fill-end');
  const _levelUpWrap = document.getElementById('go-levelup-wrap');

  if (_levelLabelEl) _levelLabelEl.textContent = 'LV ' + (xpResult.newLevel ? xpResult.level - xpResult.levelsGained : xpResult.level);
  if (_xpBarEl) {
    const startPct = Math.min(100, xpResult.startPct * 100);
    const endPct = Math.min(100, (xpResult.xp / xpResult.xpForNext) * 100);
    _xpBarEl.style.transition = 'none';
    _xpBarEl.style.width = startPct + '%';
    _xpBarEl.classList.remove('xp-comet');

    if (xpResult.newLevel) {
      // Phase 1: fill to 100% with comet
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        _xpBarEl.classList.add('xp-comet');
        _xpBarEl.style.transition = 'width 0.9s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        _xpBarEl.style.width = '100%';
      }); });
      // Phase 2: flash bright on level-up, reset, fill to remainder
      setTimeout(() => {
        const barWrap = _xpBarEl.parentElement;
        if (barWrap) { barWrap.classList.add('xp-flash'); }
        if (_levelLabelEl) _levelLabelEl.textContent = 'LV ' + xpResult.level;
        setTimeout(() => {
          _xpBarEl.classList.remove('xp-comet');
          _xpBarEl.style.transition = 'none';
          _xpBarEl.style.width = '0%';
          if (barWrap) barWrap.classList.remove('xp-flash');
          requestAnimationFrame(() => { requestAnimationFrame(() => {
            _xpBarEl.classList.add('xp-comet');
            _xpBarEl.style.transition = 'width 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            _xpBarEl.style.width = endPct + '%';
          }); });
          setTimeout(() => _xpBarEl.classList.remove('xp-comet'), 900);
        }, 400);
      }, 950);
    } else {
      // Normal fill with comet tail
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        _xpBarEl.classList.add('xp-comet');
        _xpBarEl.style.transition = 'width 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        _xpBarEl.style.width = endPct + '%';
      }); });
      setTimeout(() => _xpBarEl.classList.remove('xp-comet'), 1300);
    }
  }

  if (_levelUpWrap) {
    if (xpResult.newLevel) {
      const showDelay = xpResult.newLevel ? 1000 : 0;
      setTimeout(() => {
        _levelUpWrap.classList.remove('hidden');
        _levelUpWrap.querySelector('.go-levelup-text').textContent = 'LEVEL ' + xpResult.level;
        const unlockedSkin = Object.entries(SKIN_LEVEL_UNLOCKS).find(([idx, lvl]) => lvl === xpResult.level);
        const unlockEl = _levelUpWrap.querySelector('.go-levelup-unlock');
        if (unlockedSkin && unlockEl) {
          const skinName = SHIP_SKINS[parseInt(unlockedSkin[0])].name;
          unlockEl.textContent = '\u{1F513} ' + skinName + ' unlocked!';
          unlockEl.classList.remove('hidden');
        } else if (unlockEl) {
          unlockEl.classList.add('hidden');
        }
      }, showDelay);
    } else {
      _levelUpWrap.classList.add('hidden');
    }
  }

  updateTitleLevel();

  // ── Ship Handling Bar ──
  // Maps player level onto the full handling range (Level 1 = 0%, Level 22+ = 100%)
  // Dings when crossing a tier boundary
  const _handlingBarEl = document.getElementById('go-handling-fill');
  const _handlingTierEl = document.getElementById('go-handling-tier');
  const _handlingUpgradeWrap = document.getElementById('go-handling-upgrade-wrap');
  if (_handlingBarEl) {
    const firstTierLvl = HANDLING_TIERS[0].level; // 1
    const lastTierLvl = HANDLING_TIERS[HANDLING_TIERS.length - 1].level; // 22
    const totalRange = lastTierLvl - firstTierLvl; // 21
    const playerLevel = loadPlayerLevel();
    const playerXP = loadPlayerXP();
    const xpNeeded = xpForLevel(playerLevel);
    const prevPlayerLevel = xpResult.newLevel ? xpResult.level - xpResult.levelsGained : playerLevel;

    // Fractional level: level + partial XP progress toward next level
    // Before this run: startPct is fraction of XP at the pre-run level
    const prevFrac = prevPlayerLevel + Math.max(0, xpResult.startPct);
    const nowFrac = playerLevel + (playerLevel >= lastTierLvl ? 0 : playerXP / xpNeeded);
    const startPct = Math.min(100, Math.max(0, ((prevFrac - firstTierLvl) / totalRange) * 100));
    const endPct = Math.min(100, Math.max(0, ((nowFrac - firstTierLvl) / totalRange) * 100));

    // Find what tier the player is at now vs before
    let prevTierLabel = 'Stock', newTierLabel = 'Stock', crossedTier = null;
    for (const t of HANDLING_TIERS) {
      if (prevPlayerLevel >= t.level) prevTierLabel = t.label || 'Stock';
      if (playerLevel >= t.level) newTierLabel = t.label || 'Stock';
    }
    // Did we cross a tier boundary this run?
    for (const t of HANDLING_TIERS) {
      if (t.label && prevPlayerLevel < t.level && playerLevel >= t.level) {
        crossedTier = t;
      }
    }

    if (_handlingTierEl) _handlingTierEl.textContent = newTierLabel;

    // Animate the bar
    _handlingBarEl.style.transition = 'none';
    _handlingBarEl.style.width = startPct + '%';
    _handlingBarEl.classList.remove('handling-comet');

    if (crossedTier) {
      // Find the % where the tier boundary sits
      const tierPct = Math.min(100, ((crossedTier.level - firstTierLvl) / totalRange) * 100);
      // Phase 1: fill to tier boundary
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        _handlingBarEl.classList.add('handling-comet');
        _handlingBarEl.style.transition = 'width 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        _handlingBarEl.style.width = tierPct + '%';
      }); });
      // Phase 2: flash at tier boundary, then continue to final position
      setTimeout(() => {
        const barWrap = _handlingBarEl.parentElement;
        if (barWrap) barWrap.classList.add('handling-flash');
        if (_handlingTierEl) _handlingTierEl.textContent = crossedTier.label;
        setTimeout(() => {
          if (barWrap) barWrap.classList.remove('handling-flash');
          _handlingBarEl.style.transition = 'width 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          _handlingBarEl.style.width = endPct + '%';
          setTimeout(() => _handlingBarEl.classList.remove('handling-comet'), 900);
        }, 400);
      }, 750);
      // Show upgrade text
      if (_handlingUpgradeWrap) {
        setTimeout(() => {
          _handlingUpgradeWrap.classList.remove('hidden');
          _handlingUpgradeWrap.querySelector('.go-handling-upgrade-text').textContent = crossedTier.label.toUpperCase();
        }, 800);
      }
    } else {
      // Normal fill with comet
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        _handlingBarEl.classList.add('handling-comet');
        _handlingBarEl.style.transition = 'width 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        _handlingBarEl.style.width = endPct + '%';
      }); });
      setTimeout(() => _handlingBarEl.classList.remove('handling-comet'), 1300);
      if (_handlingUpgradeWrap) _handlingUpgradeWrap.classList.add('hidden');
    }
  }

  // ── Save Me button setup (fuel cells) ──
  const baseFuelCost = [50, 100, 150, 200][Math.min(state.saveMeCount, 3)];
  const saveMeDiscount = getStatValue('saveme');
  const saveMeFuelCost = Math.floor(baseFuelCost * (1 - saveMeDiscount));
  const currentFuel = loadFuelCells();
  const canAfford = currentFuel >= saveMeFuelCost;
  const _saveMeWrap = document.getElementById('go-saveme-wrap');
  const _saveMeBtn = document.getElementById('saveme-btn');
  const _saveMeCostEl = document.getElementById('saveme-cost');
  if (_saveMeCostEl) _saveMeCostEl.innerHTML = _FUEL_SVG + ' ' + saveMeFuelCost;
  if (_saveMeBtn) {
    _saveMeBtn.disabled = !canAfford;
    // Remove old listener, add fresh one
    const newBtn = _saveMeBtn.cloneNode(true);
    _saveMeBtn.parentNode.replaceChild(newBtn, _saveMeBtn);
    newBtn.disabled = !canAfford;
    newBtn.addEventListener('click', () => {
      if (!_gameOverTapReady) return; // cooldown guard
      if (_retryPending) return; // already fading
      if (loadFuelCells() < saveMeFuelCost) return;
      // Deduct fuel cells
      saveFuelCells(loadFuelCells() - saveMeFuelCost);
      updateTitleFuelCells();
      state.saveMeCount++;
      _retryPending = true;
      const fadeEl = document.getElementById('retry-fade');
      fadeEl.style.opacity = '1'; // fade to black
      setTimeout(() => {
        _retryPending = false;
        // Reset score only — distance keeps accumulating as reward for survival
        state.score = 0;
        state.playerScore = 0;
        state.startedFromL1 = false;
        // Resume the run
        state.phase = 'playing';
        shipGroup.visible = true;
        _killExplosion();
        // Kill death camera orbit
        _expCamOrbitActive = false;
        _expCamOrbitT = 0;
        if (_gameOverDelayTimer) { clearTimeout(_gameOverDelayTimer); _gameOverDelayTimer = null; }
        state.invincibleTimer = 3.0;
        state.shipX = 0;
        state.shipVelX = 0;
        shipGroup.position.x = 0;
        // Wipe everything on screen and reset all mechanic state
        _clearAllMechanics();
        state.deathRunRestBeat = 1.5; // brief clear before wave director picks next mechanic
        // Corridor death: restart that corridor from scratch
        if (state._deathCorridorType === 'l3') {
          state.corridorMode = true; state.corridorSpawnZ = -7; state.corridorRowsDone = 0; state.corridorSineT = 0;
        } else if (state._deathCorridorType === 'l4') {
          state.l4CorridorActive = true; state.l4SpawnZ = -7; state.l4RowsDone = 0; state.l4SineT = 0;
        } else if (state._deathCorridorType === 'l5') {
          state.l5CorridorActive = true; state.l5CorridorSpawnZ = -7; state.l5CorridorRowsDone = 0;
        }
        state.invincibleSpeedActive = false; // no speed boost, just invincible visual
        state.invincibleGrace = 3.0;
        document.getElementById('gameover-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
        // Position camera at establishing shot (same as retry sweep)
        killThrusterSputter();
        state.introActive = true; // block obstacle spawning during sweep
        state.thrusterPower = 1;
        shipGroup.position.y = _hoverBaseY;
        state._introLiftActive = false;
        cameraPivot.position.copy(_RETRY_CAM_START);
        camera.rotation.set(0, 0, 0);
        camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
        camera.fov = _RETRY_FOV_START;
        camera.updateProjectionMatrix();
        // Start the sweep
        _retrySweepActive = true;
        _retrySweepT = 0;
        _retrySweepThrusterFired = false;
        playRetryWhoosh();
        // Re-engage the correct music track for wherever we are in the run
        musicFadeTo(currentGameTrack(), 1500);
        // Fade from black
        fadeEl.style.opacity = '0';
      }, 180); // wait for fade-to-black
    });
  }

  // Show NEW BEST banner only when player actually beat their record
  const _bestWrap = document.getElementById('go-best-wrap');
  if (_bestWrap) {
    if (isNewBest) {
      _bestWrap.classList.remove('hidden');
      _bestWrap.classList.add('new-best');
      _bestWrap.querySelector('.go-best-label').textContent = 'NEW BEST!';
      _bestWrap.querySelector('.go-best-val').textContent = finalScore;
    } else {
      _bestWrap.classList.add('hidden');
    }
  }
  document.getElementById('hud').classList.add('hidden');
  // Delay game over screen so explosion plays first
  if (_gameOverDelayTimer) clearTimeout(_gameOverDelayTimer);
  _gameOverTapReady = false; // block taps until cooldown
  if (_gameOverTapTimer) clearTimeout(_gameOverTapTimer);
  _gameOverDelayTimer = setTimeout(() => {
    _gameOverDelayTimer = null;
    document.getElementById('gameover-screen').classList.remove('hidden');
    // Re-trigger staggered animations by forcing reflow
    document.querySelectorAll('.go-anim').forEach(el => {
      el.style.animation = 'none';
      el.offsetHeight; // force reflow
      el.style.animation = '';
    });
    // Start tap cooldown AFTER screen appears
    _gameOverTapTimer = setTimeout(() => { _gameOverTapReady = true; }, _GO_TAP_COOLDOWN);
  }, _EXP_DURATION * 1000);

  // ── UPGRADES UNLOCKED banner (one-time, game over screen) ──
  if (!localStorage.getItem('jh_upgrades_unlocked_shown')) {
    const coins = loadCoinWallet();
    const owned = JSON.parse(localStorage.getItem('jh_owned_skins') || '["RUNNER"]');
    const canBuy = SHIP_SKINS.some(s => s.price > 0 && !owned.includes(s.name) && coins >= s.price)
      || Object.entries(POWERUP_UPGRADES).some(([id, up]) => {
           const tier = loadUpgradeTier(id);
           return tier < up.tiers.length && coins >= getUpgradeCost(id, tier);
         });
    if (canBuy) {
      localStorage.setItem('jh_upgrades_unlocked_shown', '1');
      const banner = document.createElement('div');
      banner.textContent = 'UPGRADES UNLOCKED';
      banner.style.cssText = `
        position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(0.5);
        color:#0ff;font-family:inherit;font-size:clamp(20px,5vw,36px);font-weight:700;
        letter-spacing:4px;text-transform:uppercase;white-space:nowrap;
        text-shadow:0 0 20px rgba(0,255,255,0.6),0 0 40px rgba(0,255,255,0.3);
        background:rgba(0,0,0,0.7);border:1px solid rgba(0,255,255,0.4);
        padding:16px 32px;border-radius:8px;z-index:9999;
        opacity:0;transition:opacity 0.4s ease,transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
        pointer-events:none;
      `;
      document.body.appendChild(banner);
      requestAnimationFrame(() => {
        banner.style.opacity = '1';
        banner.style.transform = 'translate(-50%,-50%) scale(1)';
      });
      setTimeout(() => {
        banner.style.opacity = '0';
        banner.style.transform = 'translate(-50%,-50%) scale(0.9)';
      }, 2800);
      setTimeout(() => banner.remove(), 3400);
    }
  }

  // ── Leaderboard submit (only if started from L1) ──────────────────────────
  {
    const _submitDiv = document.getElementById('score-submit');
    const _oldMsg = document.getElementById('score-saved-msg');
    if (_oldMsg) _oldMsg.remove();

    if (!state.isDeathRun) {
      _submitDiv.classList.add('hidden');
    } else {

    const _savedName = window._LS.getItem('jet-horizon-player-name') || '';

    const _showSaved = () => {
      _submitDiv.classList.add('hidden');
      const _msg = document.createElement('div');
      _msg.id = 'score-saved-msg';
      _msg.className = 'score-saved-msg go-anim';
      _msg.style.setProperty('--d', '4');
      _msg.textContent = 'SCORE SAVED \u2713';
      _submitDiv.parentNode.insertBefore(_msg, _submitDiv);
      // Fade out after 2s
      setTimeout(() => { _msg.style.opacity = '0'; _msg.style.transition = 'opacity 0.6s'; }, 2000);
    };

    if (_savedName) {
      // Returning player — auto-submit silently
      _submitDiv.classList.add('hidden');
      submitScore(_savedName, finalScore).then(_showSaved);
    } else {
      // First time — show compact name input
      _submitDiv.classList.remove('hidden');

      const _oldInput = document.getElementById('player-name');
      const _newInput = _oldInput.cloneNode(true);
      _oldInput.parentNode.replaceChild(_newInput, _oldInput);
      _newInput.value = '';

      const _oldConfirm = document.getElementById('submit-confirm-btn');
      const _newConfirm = _oldConfirm.cloneNode(true);
      _oldConfirm.parentNode.replaceChild(_newConfirm, _oldConfirm);

      const _doSubmit = async () => {
        const _name = _newInput.value.trim();
        if (!_name) { _newInput.focus(); return; }
        _newConfirm.disabled = true;
        _newConfirm.textContent = '...';
        window._LS.setItem('jet-horizon-player-name', _name);
        await submitScore(_name, finalScore);
        _showSaved();
      };

      _newConfirm.addEventListener('click', _doSubmit);
      _newInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); _doSubmit(); }
      });
    }
    } // end else (startedFromL1)
  }
}

// Tint the neon gradient on an obstacle group to a given hex color
function tintObsColor(obs, hex) {
  const _mc = obs.userData._meshes;
  for (let mi = 0; mi < _mc.length; mi++) {
    const mat = _mc[mi].material;
    if (mat.uniforms && mat.uniforms.uNeon) {
      mat.uniforms.uNeon.value.setHex(hex);
    } else if (mat.blending === THREE.AdditiveBlending) {
      mat.color.setHex(hex);
    }
  }
}
// Restore neon gradient to its original baked color
function resetObsColor(obs) {
  const _mc = obs.userData._meshes;
  for (let mi = 0; mi < _mc.length; mi++) {
    const mat = _mc[mi].material;
    if (mat.uniforms && mat.uniforms.uNeon && mat.userData.baseColor !== undefined) {
      mat.uniforms.uNeon.value.setHex(mat.userData.baseColor);
    } else if (mat.userData.baseColor !== undefined && mat.color) {
      mat.color.setHex(mat.userData.baseColor);
    }
  }
}

function returnObstacleToPool(obs) {
  obs.userData.isCorridor = false;
  obs.userData.isEcho = false;
  obs.userData.active = false;
  obs.visible = false;
  if (obs.userData.slalomScaled) {
    obs.scale.set(1, 1, 1);  // reset fat slalom scale
    obs.userData.slalomScaled = false;
  }
  // Reset baseOpacity to 1.0 so recycled cones aren't stuck dim from echo duty
  const _mc = obs.userData._meshes;
  for (let mi = 0; mi < _mc.length; mi++) _mc[mi].material.userData.baseOpacity = 1.0;
  resetObsColor(obs);  // always restore original color on return
}

function returnPowerupToPool(pu) {
  pu.userData.active = false;
  pu.visible = false;
  pu.position.set(0, -9999, 0);  // park far off-screen so it can't ghost-render near ship
  pu.scale.setScalar(1);
}

// ═══════════════════════════════════════════════════
//  UPDATE LOOP
// ═══════════════════════════════════════════════════
const FIXED_DT = 1 / 60;
let accumulator = 0;
const clock = new THREE.Clock();
let scoreTick = 0;

function update(dt) {
  if (state.phase !== 'playing') return;
  if (state._ringFrozen) return; // ring tuner freeze — scene renders but game logic paused
  // Gyroscope input — mobile only, no-op on desktop

  state.elapsed += dt;  // real-time accumulator for smooth animations
  _drUpdateDebugHud();
  state.levelElapsed = (state.levelElapsed || 0) + dt;  // time spent in current level

  const effectiveSpeed = state.invincibleSpeedActive
    ? state.speed * 1.8
    : state.speed;

  // ── Ship movement
  const _introBlock = state.introActive || state._introLiftActive;
  if (_introBlock) { state.shipX = 0; state.shipVelX = 0; shipGroup.position.x = 0; }
  const steerLeft  = !_introBlock && (keys['ArrowLeft']  || keys['a'] || keys['A'] || touch.left);
  const steerRight = !_introBlock && (keys['ArrowRight'] || keys['d'] || keys['D'] || touch.right);
  // Physics ramp: starts floaty at L1, gradually snappier by L5
  // Death Run: lateral physics matches independent speed ramp (not vibe)
  // DR: snappiness ramps L2→L5 but caps at L5 even as speed keeps climbing
  const _physIdx = _physLevelOverride >= 0 ? _physLevelOverride
    : state.isDeathRun ? Math.min(state.deathRunSpeedTier + 1, 4) : state.currentLevelIdx;
  const _lvlT   = _physIdx / (LEVELS.length - 1); // 0 at L1, 1 at L5
  const _snap   = _lvlT * _lvlT;  // ease-in so early levels stay floaty longer
  // Handling tier: 0.0 at max upgrade (crisp), 1.0 at stock (loose)
  const _handlingDrift = getHandlingDrift();
  // Low handling = HIGH ACCEL (over-responsive, hard to control)
  // High handling = moderate ACCEL (precise, predictable)
  // ACCEL: low tier = sluggish (60%), high tier = snappy (100%)
  const ACCEL = (_accelBase + _snap * _accelSnap) * (0.75 + (1 - _handlingDrift) * 0.25);
  // DECEL: low tier = long slide, high tier = brief slide
  const DECEL_BASE = 10 + _snap * 26;
  const DECEL = DECEL_BASE * (_decelBasePct + (1 - _handlingDrift) * (_decelFullPct - _decelBasePct));
  const MAX_VEL = _maxVelBase + _snap * _maxVelSnap;

  // Tilt penalty: only kicks in after a 2s grace period of being tilted
  const TILT_GRACE = 2.0;  // seconds before penalty starts
  if (Math.abs(state.rollAngle) > 0.1) {
    state.tiltTimer = Math.min(state.tiltTimer + dt, TILT_GRACE + 1.0);
  } else {
    state.tiltTimer = Math.max(0, state.tiltTimer - dt * 3);  // resets quickly when upright
  }
  // penaltyT: 0 during grace period, ramps to 1 over next second after grace ends
  const penaltyT    = Math.max(0, Math.min(1, (state.tiltTimer - TILT_GRACE)));
  const tiltPenalty = 0.35 + 0.65 * Math.cos(state.rollAngle);  // 1.0 upright → 0.35 sideways
  const tiltFactor  = 1.0 - penaltyT * (1.0 - tiltPenalty);    // lerp from no penalty → full penalty

  // Counter-steer: when input opposes velocity, multiply ACCEL so direction reverses fast
  const _counterSteer = (steerLeft && state.shipVelX > 0) || (steerRight && state.shipVelX < 0);
  const _csBoost = _counterSteer ? 3.0 : 1.0;
  if (steerLeft)       state.shipVelX -= ACCEL * _csBoost * tiltFactor * dt;
  else if (steerRight) state.shipVelX += ACCEL * _csBoost * tiltFactor * dt;
  else                 state.shipVelX *= Math.max(0, 1 - DECEL * dt); // slide only when not steering

  const tiltMaxVel = MAX_VEL * tiltFactor;
  state.shipVelX = Math.max(-tiltMaxVel, Math.min(tiltMaxVel, state.shipVelX));
  state.shipX   += state.shipVelX * dt;


  // Camera pivot follows ship X
  camTargetX = state.shipX;
  // ── Retry sweep: establishing shot → chase cam ──
  if (_retrySweepActive) {
    _retrySweepT = Math.min(1, _retrySweepT + dt / _RETRY_SWEEP_DUR);
    // Ease-in-out cubic
    const st = _retrySweepT < 0.5
      ? 4 * _retrySweepT * _retrySweepT * _retrySweepT
      : 1 - Math.pow(-2 * _retrySweepT + 2, 3) / 2;
    // Target: normal chase cam position
    const _isLandscapeRS = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && window.innerWidth > window.innerHeight;
    const _rsCamY = (_isLandscapeRS ? 2.0 : 2.8) + _camPivotYOffset;
    const _rsCamZ = 9 + _camPivotZOffset;
    cameraPivot.position.x = THREE.MathUtils.lerp(_RETRY_CAM_START.x, 0, st);
    cameraPivot.position.y = THREE.MathUtils.lerp(_RETRY_CAM_START.y, _rsCamY, st);
    cameraPivot.position.z = THREE.MathUtils.lerp(_RETRY_CAM_START.z, _rsCamZ, st);
    // FOV narrows from wide establishing to base
    camera.fov = THREE.MathUtils.lerp(_RETRY_FOV_START, _baseFOV, st);
    camera.updateProjectionMatrix();
    // Trigger quiet thruster ignition as camera arrives at ship
    if (_retrySweepT >= 0.8 && !_retrySweepThrusterFired) {
      _retrySweepThrusterFired = true;
      const _rsEng = document.getElementById('engine-roar');
      if (_rsEng && !state.muted) {
        _ensureCtxRunning();
        _rsEng.currentTime = 0;
        _rsEng.volume = 0.07 * (typeof sfxMult === 'function' ? sfxMult() : 1);
        _rsEng.play().catch(() => {});
      }
    }
    if (_retrySweepT >= 1) {
      _retrySweepActive = false;
      _retryIsFromDead = false;
      _retrySweepThrusterFired = false;
      state.introActive = false; // unblock obstacle spawning
      state.thrusterPower = 1;
      // Ensure camera is exactly at chase cam
      cameraPivot.position.set(0, _rsCamY, _rsCamZ);
      camera.fov = _baseFOV;
      camera.updateProjectionMatrix();
    }
  } else if (!_expCamOrbitActive) {
    // Normal gameplay camera (death cam handled in animate())
    cameraPivot.position.x = camTargetX;
    // Camera Y partially follows ship altitude
    const _isLandscapeCam = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && window.innerWidth > window.innerHeight;
    const camBaseY = _isLandscapeCam ? 2.0 : 2.8;
    const shipAlt = shipGroup.position.y - _hoverBaseY;
    const camTargetY = camBaseY + _camPivotYOffset + shipAlt * _camYFollow;
    cameraPivot.position.y = THREE.MathUtils.lerp(cameraPivot.position.y, camTargetY, 6 * dt);
    cameraPivot.position.z = 9 + _camPivotZOffset;
  }

  // ── Camera roll: tilt screen when steering (like original Jet Slalom)
  // camera.rotation is in LOCAL space of pivot; lookAt was already set at init.
  // We only change rotation.z (roll) — x/y stay from the initial lookAt.
  const _maxVelNow = _maxVelBase + _snap * _maxVelSnap;
  const targetCamRoll = -(state.shipVelX / Math.max(1, _maxVelNow)) * 0.4;  // normalized: ~10° max regardless of vel cap
  cameraRoll = THREE.MathUtils.lerp(cameraRoll, targetCamRoll, 5 * dt);
  camera.rotation.z = cameraRoll;


  // Detect turn release — trigger wobble when player stops steering
  const isSteering = keys['ArrowLeft'] || keys['a'] || keys['A'] ||
                     keys['ArrowRight'] || keys['d'] || keys['D'] ||
                     touch.left || touch.right;
  // Cancel wobble instantly when player starts steering again
  if (isSteering && state.wobbleAmp > 0) state.wobbleAmp = 0;


  // Wobble kicks in at L2+ in campaign, or always in DR (uses deathRunSpeedTier instead of currentLevelIdx)
  if (state.wasSteering && !isSteering && (state.isDeathRun || state.currentLevelIdx >= 1) && Math.abs(state.shipVelX) > 4) {
    // velRatio: 0 at threshold (4), 1 at absolute max (18) — fixed scale so it works at all levels
    const velRatio = (Math.abs(state.shipVelX) - 4) / 14;
    const clamped  = Math.max(0, Math.min(1, velRatio));
    const _driftMult = getHandlingDrift() * 2.5; // stock drift=1.0 → 2.5x wobble, full control drift=0 → 0 (no wobble)
    // Speed also amplifies wobble at low handling — faster = wilder at low tier
    const _speedRatio = Math.min(1, (state.speed - BASE_SPEED) / (BASE_SPEED * 1.5));
    const _speedWobble = 1.0 + _speedRatio * _wobbleSpeedMult * getHandlingDrift();
    state.wobbleAmp   = (0.02 + clamped * clamped * _wobbleMaxAmp) * _driftMult * _speedWobble;
    // Trigger roll overshoot — ship banks past target then bounces back
    state._overshootVel = (state._overshootVel || 0) + Math.sign(state.shipVelX) * _overshootAmt * clamped * getHandlingDrift();
    state.wobbleDir   = Math.sign(state.shipVelX);
    state.wobblePhase = 0;
    // Release whoosh — only on hard turns held > 1.5s
    const holdSec = (performance.now() - state.steerStartTime) / 1000;
    if (holdSec > 1.5) {
      playWhooshRelease(Math.sign(state.shipVelX), holdSec);
    }
  }
  // Lane-change whoosh on turn start + track hold time
  if (!state.wasSteering && isSteering) {
    state.steerStartTime = performance.now();
    const dir = (keys['ArrowLeft'] || keys['a'] || keys['A'] || touch.left) ? -1 : 1;
    const velIntensity = Math.min(1, Math.abs(state.shipVelX) / 14);
    playWhoosh(dir, Math.max(0.3, velIntensity));
  }
  state.wasSteering = isSteering;

  // Decay wobble with a damped sine — completely isolated from camera
  if (state.wobbleAmp > 0.001) {
    state.wobblePhase += dt * 16;          // oscillation speed
    state.wobbleAmp   *= (1 - dt * _wobbleDamping);    // damping — tunable via flight tuner
    if (state.wobbleAmp < 0.001) state.wobbleAmp = 0;
  }
  const wobbleOffset = Math.sin(state.wobblePhase) * state.wobbleAmp * state.wobbleDir;

  // Bank the ship — track velocity while steering, decay to flat on release.
  if (isSteering) {
    // If steering opposes current bank, zero it so we never dip the wrong way
    if ((steerLeft && _bankVelX > 0) || (steerRight && _bankVelX < 0)) _bankVelX = 0;
    _bankVelX += (state.shipVelX - _bankVelX) * Math.min(1, 20 * dt);
  } else {
    _bankVelX *= Math.max(0, 1 - 12 * dt); // decay to flat, no pull from shipVelX
  }
  // Overshoot spring — decays each frame, triggered on steering release
  state._overshootPos = (state._overshootPos || 0);
  state._overshootVel = (state._overshootVel || 0);
  if (isSteering) { state._overshootPos *= 0.8; state._overshootVel = 0; }
  state._overshootPos += state._overshootVel * dt;
  state._overshootVel -= state._overshootPos * 40 * dt; // spring constant
  state._overshootVel *= Math.max(0, 1 - _overshootDamp * dt); // damping
  const targetRoll = -_bankVelX * _bankMax + state._overshootPos;
  if (state.rollAngle !== 0 || state.rollHeld) {
    // Roll is active — drive rotation.z directly from rollAngle
    shipGroup.rotation.z = state.rollAngle;
  } else {
    const _rollTarget = targetRoll + wobbleOffset + _shipRotZOffset;
    const _crossingZero = (shipGroup.rotation.z > 0.01 && _rollTarget < -0.01) || (shipGroup.rotation.z < -0.01 && _rollTarget > 0.01);
    const _lerpSpeed = _crossingZero ? _bankSmoothing * 3 : _bankSmoothing;
    shipGroup.rotation.z = THREE.MathUtils.lerp(shipGroup.rotation.z, _rollTarget, Math.min(1, _lerpSpeed * dt));
  }
  // ── Pitch tilt: nose dips on accel, lifts on decel (when grounded) ──
  const speedDelta = (state.speed - _prevSpeed) / dt;
  _prevSpeed = state.speed;
  let targetPitch = 0;
  if (!_jumpActive) {
    if (speedDelta > 0.5) {
      targetPitch = -_pitchForwardMax * Math.min(1, speedDelta / 50);
    } else if (speedDelta < -0.5) {
      targetPitch = _pitchBackMax * Math.min(1, Math.abs(speedDelta) / 50);
    }
  }
  _pitchSmooth += (targetPitch - _pitchSmooth) * Math.min(1, dt * _pitchSmoothing);

  // ── Alt ship animation drive (wing bank + engine boost) ──
  if (_altShipActive && _altShipMixer) {
    const _roll = shipGroup.rotation.z || 0; // negative = banking right, positive = banking left
    const _bankThresh = 0.08; // minimum roll before triggering wing anim
    const _playClip = (name, timescale) => {
      const a = _altShipClips[name];
      if (!a) return;
      if (a.timeScale < 0) { a.timeScale = timescale || 1; } // was reversing, switch to forward
      if (!a.isRunning()) { a.reset(); a.timeScale = timescale || 1; a.play(); }
    };
    const _stopClip = (name) => {
      const a = _altShipClips[name];
      if (!a || !a.isRunning()) return;
      // Play in reverse to smoothly return to rest pose instead of snapping
      if (a.timeScale > 0) {
        a.timeScale = -a.timeScale;
        a.paused = false;
      }
    };
    // Wing + airbrake animations: bank left -> left wings down, right wings up, airbrakes deploy
    if (_roll > _bankThresh) {
      // Banking left
      _playClip('Wing_Down_A_LeftAction', 1.5);
      _playClip('Wing_Up_A_RightAction', 1.5);
      _stopClip('Wing_Up_A_LeftAction');
      _stopClip('Wing_Down_A_RightAction');
      // Airbrakes: left side deploys down, right side deploys up (asymmetric drag for banking)
      _playClip('Airbrake_Down_LeftAction', 1.2);
      _playClip('Airbrake_Up_RightAction', 1.2);
      _stopClip('Airbrake_UP_LeftAction_2');
      _stopClip('Airbrake_Down_RightAction');
    } else if (_roll < -_bankThresh) {
      // Banking right
      _playClip('Wing_Down_A_RightAction', 1.5);
      _playClip('Wing_Up_A_LeftAction', 1.5);
      _stopClip('Wing_Up_A_RightAction');
      _stopClip('Wing_Down_A_LeftAction');
      // Airbrakes: right side deploys down, left side deploys up
      _playClip('Airbrake_Down_RightAction', 1.2);
      _playClip('Airbrake_UP_LeftAction_2', 1.2);
      _stopClip('Airbrake_Up_RightAction');
      _stopClip('Airbrake_Down_LeftAction');
    } else {
      // Neutral — return wings + airbrakes to default
      _stopClip('Wing_Down_A_LeftAction');
      _stopClip('Wing_Down_A_RightAction');
      _stopClip('Wing_Up_A_LeftAction');
      _stopClip('Wing_Up_A_RightAction');
      _stopClip('Airbrake_Down_LeftAction');
      _stopClip('Airbrake_Down_RightAction');
      _stopClip('Airbrake_Up_RightAction');
      _stopClip('Airbrake_UP_LeftAction_2');
    }
  }

  // ── Thrust-based vertical flight ──
  {
    const altitude = shipGroup.position.y - _hoverBaseY;

    if (_thrustHeld && altitude < _thrustMaxHeight) {
      const ceilingFactor = 1.0 - Math.pow(altitude / _thrustMaxHeight, 2);
      _jumpVelY += _thrustPower * Math.max(ceilingFactor, 0.05) * dt;
      _jumpActive = true;
      _jumpVelY -= _thrustGravity * dt;
    } else {
      _jumpVelY -= _fallSpeed * dt;
    }

    _jumpVelY *= Math.pow(_thrustDamping, dt * 60);
    shipGroup.position.y += _jumpVelY * dt;

    // Hard floor + landing
    if (shipGroup.position.y <= _hoverBaseY) {
      shipGroup.position.y = _hoverBaseY;
      if (_jumpActive && _jumpVelY <= 0) {
        _jumpLandingBounceT = _jumpLandingBounce;
      }
      _jumpVelY = Math.max(_jumpVelY, 0);
      _jumpActive = altitude > 0.08; // raised from 0.02 so bob amplitude doesn't trigger jump system
    }

    // Hard ceiling
    if (altitude > _thrustMaxHeight) {
      shipGroup.position.y = _hoverBaseY + _thrustMaxHeight;
      _jumpVelY = Math.min(_jumpVelY, 0);
    }

    // Pitch: thrust overrides speed-based pitch when airborne
    if (_jumpActive) {
      const thrustPitch = Math.max(-0.25, Math.min(0.25, (_jumpVelY / 8.0) * 0.2 * _jumpPitchMult));
      shipGroup.rotation.x = THREE.MathUtils.lerp(shipGroup.rotation.x, thrustPitch, 8 * dt) + _shipRotXOffset;
    } else {
      shipGroup.rotation.x = _pitchSmooth + _shipRotXOffset;
    }

    // Thruster power (skip during intro — let sputter timers control it)
    if (!state.introActive) {
      if (_thrustHeld && _jumpActive) {
        state.thrusterPower = _jumpThrusterFlare;
      } else if (_jumpActive) {
        state.thrusterPower = _jumpVelY > 0 ? 0.7 : 0.3;
      } else {
        state.thrusterPower = 1;
      }
    }

    // Landing bounce decay
    if (!_jumpActive && _jumpLandingBounceT > 0) {
      _jumpLandingBounceT -= dt * 4;
      const bounceY = Math.sin(_jumpLandingBounceT * Math.PI * 3) * 0.03 * _jumpLandingBounceT;
      shipGroup.position.y = _hoverBaseY + bounceY;
      shipGroup.rotation.x = THREE.MathUtils.lerp(shipGroup.rotation.x, _pitchSmooth, 6 * dt);
    }
  }

  // ── Hover bob: subtle sinusoidal float when grounded, suppressed during steering ──
  if (!_jumpActive) {
    const steeringActive = Math.abs(state.shipVelX) > 0.5;
    const bobSteerTarget = steeringActive ? 0 : 1;
    const bobSteerRate = steeringActive ? _bobSteerFadeOut : _bobSteerFadeIn;
    _bobSteerBlend += (bobSteerTarget - _bobSteerBlend) * Math.min(1, dt * bobSteerRate);
    const bobNow = performance.now() / 1000;
    const bobOffset = (_bobFrequency > 0) ? Math.sin(bobNow * _bobFrequency * Math.PI * 2) * _bobAmplitude * _bobBlend * _bobSteerBlend : 0;
    // Hold ship at 0.38 before launch, and during lift animation
    // (skip during retry sweep — ship should stay at _hoverBaseY)
    if (!state._introLiftActive && !_retrySweepActive && (state.introActive || state.elapsed < 0.1)) {
      shipGroup.position.y = 0.38;
    } else if (!state._introLiftActive) {
      shipGroup.position.y = _hoverBaseY + bobOffset;
    }
  }

  // ── Intro takeoff lift ──
  if (state._introLiftActive) {
    const _liftDuration = 2.0; // seconds to reach cruise height
    state._introLiftTimer += dt;
    const _lt = Math.min(1, state._introLiftTimer / _liftDuration);
    // Ease out: fast rise then settles
    const _liftEase = 1 - Math.pow(1 - _lt, 3);
    const _launchY = 0.38;
    state._introShipY = _launchY + (_hoverBaseY - _launchY) * _liftEase;
    // Pitch arc: nose up in first half, settles back to _shipRotXOffset
    const _pitchPeak = -0.18; // nose up (negative = up in Three.js)
    // Pitch up in first half, settle back — never dip below start Y
    const _pitchT = _lt < 0.5 ? _lt * 2 : 2 - _lt * 2;
    const _pitchEase = Math.sin(_pitchT * Math.PI * 0.5);
    shipGroup.rotation.x = _shipRotXOffset + _pitchPeak * _pitchEase;
    shipGroup.position.y = Math.max(0.38, state._introShipY);
    if (_lt >= 1) {
      state._introLiftActive = false;
      shipGroup.rotation.x = _shipRotXOffset;
      // In JL mode, re-lock speed and clear any velocity that built up during prologue
      if (state._jetLightningMode) {
        state.shipVelX = 0;
        state.shipX    = 0;
        shipGroup.position.x = 0;
      }
    }
  }

  // ── Yaw: nose turns into steering direction ──
  const _yawTarget = -state.shipVelX / 14 * _yawMax;
  _yawSmooth += (_yawTarget - _yawSmooth) * Math.min(1, dt * _yawSmoothing);
  shipGroup.rotation.y = _yawSmooth;

  // Micro-turbulence: visual-only random X nudge at low handling/high speed
  const _turbNudge = _turbulence > 0 ? (Math.random() - 0.5) * _turbulence * getHandlingDrift() * (state.speed / BASE_SPEED) : 0;
  shipGroup.position.x = state.shipX + _turbNudge;
  // laserPivot X is set per-frame in the laser update block (T4/T5 only)

  // Sync touch roll into rollHeld state each frame
  // Toggle mode: rollToggle stays true until swipe-down
  if (touch.rollToggle) { state.rollHeld = true; state.rollDir = -1; }
  else if (touch.rollUp)   { state.rollHeld = true; state.rollDir = -1; }
  else if (touch.rollDown) { state.rollHeld = true; state.rollDir =  1; }
  else if (!keys['ArrowUp'] && !keys['ArrowDown']) { state.rollHeld = false; }

  // Hold-to-spin — pure Z-axis rotation, no lateral boost
  // Up/down spin the ship orientation; left/right handle all movement
  {
    // Roll speed scales with level snap — floaty at L1, snappy at L5 (mirrors steering feel)
    const SPIN_SPEED   = (1.2 + _snap * 2.3) * Math.PI;  // ~216°/s floaty → ~630°/s snappy
    const RETURN_SPEED = SPIN_SPEED * 1.5;
    const MAX_ANGLE    = Math.PI / 2;     // 90° max — fully sideways (knife edge)

    if (state.rollHeld) {
      state.rollAngle += state.rollDir * SPIN_SPEED * dt;
      state.rollAngle  = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, state.rollAngle));
    } else {
      if (Math.abs(state.rollAngle) > 0.01) {
        const returnDir  = -Math.sign(state.rollAngle);
        const newAngle   = state.rollAngle + returnDir * RETURN_SPEED * dt;
        // Stop exactly at zero — don't overshoot
        state.rollAngle  = Math.sign(newAngle) !== Math.sign(state.rollAngle) ? 0 : newAngle;
      } else {
        state.rollAngle = 0;
        state.rollDir   = 0;
      }
    }
  }

  // Galaxy flythrough: scroll particles past the ship
  updateGalaxyScroll(dt);

  // Exhaust cone animation removed — cones deleted

  // Ship hull emissive — static, no pulse (removed to prevent transparency issues)



  // Thruster particles
  const isAccel = (keys['ArrowLeft'] || keys['a'] || keys['A'] || keys['ArrowRight'] || keys['d'] || keys['D'] || touch.left || touch.right) ? 1.0 : 0.0;
  updateThrusters(dt, state.shipX, shipGroup.position.y, shipGroup.position.z, isAccel);

  updateL5Dust(dt);
  updateShards(dt);

  // ── Distance accumulation (speed × time, not reset on repair)
  if (!state.introActive && state.phase === 'playing') {
    state.distance = (state.distance || 0) + effectiveSpeed * dt;
  }

  // ── Score ticking (internal level-threshold score)
  if (!state.introActive) scoreTick += dt;
  if (scoreTick > 0.4) {
    scoreTick = 0;
    state.score += state.multiplier + getStatValue('scoremult');
    document.getElementById('hud-speed').textContent = `${(effectiveSpeed / BASE_SPEED).toFixed(1)}x`;
    checkLevelUp();
  }

  // In-run mission toast check (every 2s)
  state._missionCheckTimer = (state._missionCheckTimer || 0) + dt;
  if (state._missionCheckTimer >= 2) {
    state._missionCheckTimer = 0;
    const _ladderPos = loadLadderPos();
    if (_ladderPos < MISSION_LADDER.length && !state._missionToasted) {
      const _rung = MISSION_LADDER[_ladderPos];
      if (_rung.type === 'mission') {
        const _rs = {
          score: Math.floor(state.playerScore), coins: state.sessionCoins,
          powerups: state.sessionPowerups || 0, shields: state.sessionShields || 0,
          lasers: state.sessionLasers || 0, invincibles: state.sessionInvincibles || 0,
          isDR: state.isDeathRun, drTier: state.deathRunSpeedTier || 0,
        };
        const _lt = loadLifetimeStats();
        const _tmpLt = { coins: _lt.coins + _rs.coins, score: _lt.score + _rs.score, runs: _lt.runs + 1, powerups: _lt.powerups + _rs.powerups };
        if (_rung.check(_rs, _tmpLt)) {
          state._missionToasted = true;
          showMissionToast(_rung.desc);
        }
      }
    }
  }

  // ── Player-facing score tick (distance-based, fast counter)
  if (!state.l5EndingActive && !state.introActive) {
    const lvlMult = [1, 1.5, 2, 3, 4][state.currentLevelIdx] || 1;
    // Player level score bonus
    const _pLvl = loadPlayerLevel();
    const _lvlScoreMult = _pLvl >= 15 ? 1.6 : _pLvl >= 10 ? 1.5 : _pLvl >= 5 ? 1.2 : 1.0;
    state.playerScore += 8 * lvlMult * _lvlScoreMult * dt;
  }
  document.getElementById('hud-score').textContent = Math.floor(state.playerScore);

  // ── Corridor bend detection (reset near-miss allowance on direction change)
  if (state.corridorMode || state.l4CorridorActive || state.l5CorridorActive) {
    const curCenter = state.corridorGapCenter || 0;
    const delta = curCenter - state.prevCorridorCenter;
    const curDir = delta > 0.1 ? 1 : delta < -0.1 ? -1 : state.prevCorridorDir;
    if (curDir !== 0 && curDir !== state.prevCorridorDir) {
      state.nearMissBendAllowed = true; // new bend — allow one near-miss
    }
    state.prevCorridorDir = curDir;
    state.prevCorridorCenter = curCenter;
  } else {
    state.prevCorridorDir = 0;
    state.prevCorridorCenter = 0;
  }

  // ── TUTORIAL TICK ──
  if (state._tutorialActive && !state.introActive) {
    state._tutorialTimer += dt;
    const _mob = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Respawn ship at center if dead, keep playing
    if (state.phase === 'dead' || state.phase === 'gameover') {
      state.phase = 'playing';
      state.shipX = 0;
      state.shipVelX = 0;
      state.rollAngle = 0;
      // Reset current obstacle challenge
      for (let _ti = activeObstacles.length - 1; _ti >= 0; _ti--) returnObstacleToPool(activeObstacles[_ti]);
      activeObstacles.length = 0;
      state._tutorialSubStep = 0; // restart current challenge
      state._tutorialConeZ = -80;
      state._tutorialZipZ = -99;
      state._tutorialZipRows = 0;
    }

    // ── STEP -0.5: Terrain walls — vaporwave mountain ridges for testing ──
    if (state._tutorialStep === -0.5) {
      if (!_terrainWalls) {
        _createTerrainWalls();
        // Default off — enable via R tuner
        _terrainWalls.strips.forEach(m => { m.visible = false; });
      }
      _updateTerrainWalls(dt, effectiveSpeed);
    }

    if (state._tutorialStep === 0) {
      // ── STEP 0: Show instruction box, wait for tap ──
      _tutShowInstructionBox(
        'DODGE',
        (_mob ? 'Tap left or right' : 'Use ← → arrow keys') + '<br>to dodge incoming cones',
        '#00eeff',
        () => { state._tutorialStep = 0.5; } // advance to spawning
      );

    } else if (state._tutorialStep === 0.5) {
      // ── STEP 0.5: One cone at a time at ship X, keeps spawning until player dodges ──
      _tutShowHint('DODGE', _mob ? 'Tap left or right' : '← → to dodge', '#00eeff');

      // Spawn one cone directly at ship X if none active
      const _tutCone = activeObstacles.find(o => o.userData._tutCone);
      if (!_tutCone) {
        const obs = getPooledObstacle(0);
        if (obs) {
          obs.position.set(state.shipX, 0, SPAWN_Z); // spawn at ship X
          obs.userData.velX = 0;
          obs.userData.isCorridor = false;
          obs.userData._tutCone = true;
          obs.userData._tutConeSpawnX = state.shipX; // remember where it spawned
          activeObstacles.push(obs);
          state._tutorialConesFired = (state._tutorialConesFired || 0);
        }
      } else {
        // Success = player moved sideways while cone is approaching
        if (Math.abs(state.shipVelX) > 0.5 && !_tutCone.userData._tutCodgeCounted) {
          _tutCone.userData._tutCodgeCounted = true; // count once per cone
          state._tutorialConesFired++;
          // Don't remove cone — let it fly past naturally
          if (state._tutorialConesFired >= 1) {
            _tutChime(); _tutSignal();
            _tutHideText();
            state._tutorialStep = 1.05; // holding step — wait for signal to fade
            state._tutorialTimer = 0;
            state._tutorialConesFired = 0;
            state._tutorialZipZ = -99;
            state._tutorialZipRows = 0;
            state._tutorialZipPassed = false;
            for (let _ti = activeObstacles.length - 1; _ti >= 0; _ti--) returnObstacleToPool(activeObstacles[_ti]);
            activeObstacles.length = 0;
          }
        } else if (_tutCone.position.z >= DESPAWN_Z) {
          returnObstacleToPool(_tutCone);
          activeObstacles.splice(activeObstacles.indexOf(_tutCone), 1);
        }
      }

    } else if (state._tutorialStep === 1.05) {
      state._tutorialTimer = (state._tutorialTimer || 0) + dt;
      if (state._tutorialTimer >= 2.5) {
        const _sf = document.getElementById('tut-signal-flash');
        if (_sf) { _sf.style.transition = 'none'; _sf.style.opacity = '0'; }
        state._tutorialStep = 1; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 1) {
      // ── STEP 1a: YOU WON'T SURVIVE — swipe up to roll ──
      _tutShowInstructionBox(
        'YOU WON\'T SURVIVE',
        'Unless you can adapt. Some walls can\'t be dodged — they must be threaded.<br>' + (_mob ? 'Swipe up to roll.' : 'Press ↑ to roll.'),
        '#ffcc00',
        () => {
          // Wait for player to actually swipe up before advancing
          state._tutorialStep = 1.1;
        }
      );

    } else if (state._tutorialStep === 1.1) {
      // ── STEP 1b: Wait for swipe up (roll) ──
      _tutShowHint('ROLL', _mob ? 'Swipe up' : 'Press ↑', '#ffcc00');
      if (state.rollHeld || Math.abs(state.rollAngle) > 0.3) {
        _tutChime(); _tutSignal();
        _tutHideText();
        state._tutorialStep = 1.15; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 1.15) {
      state._tutorialTimer = (state._tutorialTimer || 0) + dt;
      if (state._tutorialTimer >= 2.5) {
        const _sf = document.getElementById('tut-signal-flash');
        if (_sf) { _sf.style.transition = 'none'; _sf.style.opacity = '0'; }
        state._tutorialStep = 1.2; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 1.2) {
      // ── STEP 1c: LEVEL OUT — swipe down to return flat ──
      _tutShowInstructionBox(
        'LEVEL OUT',
        _mob ? 'Swipe down to come back flat.' : 'Press ↓ to come back flat.',
        '#ffcc00',
        () => { state._tutorialStep = 1.3; }
      );

    } else if (state._tutorialStep === 1.3) {
      // ── STEP 1d: Wait for swipe down (return flat) ──
      _tutShowHint('LEVEL OUT', _mob ? 'Swipe down' : 'Press ↓', '#ffcc00');
      if (Math.abs(state.rollAngle) > 0.3) state._tutWasRolled = true;
      if (state._tutWasRolled && !state.rollHeld && Math.abs(state.rollAngle) < 0.15) {
        _tutChime(); _tutSignal();
        _tutHideText();
        state._tutorialStep = 1.35; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 1.35) {
      state._tutorialTimer = (state._tutorialTimer || 0) + dt;
      if (state._tutorialTimer >= 2.5) {
        const _sf = document.getElementById('tut-signal-flash');
        if (_sf) { _sf.style.transition = 'none'; _sf.style.opacity = '0'; }
        state._tutorialStep = 1.4; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 1.4) {
      // ── STEP 1e: THREAD THE NEEDLE — wall incoming ──
      _tutShowInstructionBox(
        'THREAD THE NEEDLE',
        '',
        '#ffcc00',
        () => { state._tutorialStep = 1.5; state._tutorialZipZ = -7; }
      );

    } else if (state._tutorialStep === 1.5) {
      // ── STEP 1.5: Zip wall spawning ──
      _tutShowHint('THREAD THE NEEDLE', _mob ? 'Roll through the gap' : '↑ to roll', '#ffcc00');

      // One row at a time. Track perp state. When row fully passes, check if passed.
      const _zipRowPresent = activeObstacles.some(o => o.userData._tutZip);
      const _isPerpendicular = state.rollHeld || Math.abs(state.rollAngle) > 0.3 || _jumpActive;

      // Track when row is at ship position
      const _zipAtShip = activeObstacles.some(o => o.userData._tutZip && o.position.z > -6 && o.position.z < DESPAWN_Z);
      if (_zipAtShip && _isPerpendicular) state._tutorialZipPassed = true;

      // Row cleared — evaluate success BEFORE spawning next row
      if (!_zipRowPresent && state._tutorialZipRowSpawned && (state._tutorialZipSuccesses || 0) < 1) {
        if (state._tutorialZipPassed && !state._tutorialZipHit) {
          state._tutorialZipSuccesses = 1;
        }
        state._tutorialZipHit = false;
        state._tutorialZipPassed = false;
      }

      // 1 clean pass = advance (check before spawning)
      if ((state._tutorialZipSuccesses || 0) >= 1 && !_zipRowPresent) {
        _tutChime(); _tutSignal();
        _tutHideText();
        state._tutorialStep = 1.55; state._tutorialTimer = 0;
      } else if (!_zipRowPresent && (state._tutorialZipSuccesses || 0) < 1) {
        // Spawn next row only if not yet succeeded
        state._tutorialZipPassed = false;
        state._tutorialZipRowSpawned = true;
        for (let zi = -LANE_COUNT; zi <= LANE_COUNT; zi++) {
          const obs = getPooledObstacle(Math.floor(Math.random() * 3));
          if (!obs) continue;
          obs.position.set(zi * LANE_WIDTH, 0, SPAWN_Z);
          obs.userData.velX = 0;
          obs.userData.isCorridor = false;
          obs.userData._tutZip = true;
          tintObsColor(obs, 0xffcc00);
          activeObstacles.push(obs);
        }
      }

    } else if (state._tutorialStep === 1.55) {
      state._tutorialTimer = (state._tutorialTimer || 0) + dt;
      if (state._tutorialTimer >= 2.5) {
        const _sf = document.getElementById('tut-signal-flash');
        if (_sf) { _sf.style.transition = 'none'; _sf.style.opacity = '0'; }
        state._tutorialStep = 2; state._tutorialTimer = 0;
      }

    } else if (state._tutorialStep === 2) {
      // ── END CARD ──
      _tutShowInstructionBox(
        'CHASE THE HORIZON',
        'Collect coins, fuel cells, and level up your ship<br>to push further toward the horizon each run',
        '#ff9500',
        () => {
          window._LS.setItem('jh_tutorial_done', '1');
          _tutDestroyOverlay();
          // Play droplet sound on exit
          const _drp = document.getElementById('droplet-sfx');
          if (_drp && !state.muted) { _drp.currentTime = 0; _drp.volume = 0.8; _drp.play().catch(()=>{}); }
          returnToTitle();
        }
      );
    }
    if (!_chaosMode && !state._jetLightningMode) _noSpawnMode = true; // suppress normal spawner during tutorial (chaos/JL override this)
  }

  // ── T5 scanning beam: fan-ray destruction (runs before obstacle loop)
  if (state.laserActive && (state.laserTier || 1) >= 5 && activeObstacles.length > 0) {
    const _rayOrigin = new THREE.Vector3(state.shipX + _lBeamXOff, _lBeamY, shipGroup.position.z);
    const _angle = state._laserScanAngle || 0;
    const _prevAngle = state._laserScanPrevAngle !== undefined ? state._laserScanPrevAngle : _angle;
    // Fan: sweep from prev angle to current angle in 5 steps — catches any cone the beam crossed
    const _steps = 6;
    const _destroyed = new Set();
    for (let _fi = 0; _fi <= _steps; _fi++) {
      const _fa = _prevAngle + (_angle - _prevAngle) * (_fi / _steps);
      const _rayDir = new THREE.Vector3(Math.sin(_fa), 0, -Math.cos(_fa));
      for (let _si = activeObstacles.length - 1; _si >= 0; _si--) {
        if (_destroyed.has(_si)) continue;
        const _sobs = activeObstacles[_si];
        if (_sobs.userData.isCorridor) continue;
        const _op = new THREE.Vector3().copy(_sobs.position).sub(_rayOrigin);
        const _along = _op.dot(_rayDir);
        if (_along < 0) continue; // behind pivot
        // Hit radius scales with distance: wider at range, tighter up close
        const _hitR = Math.max(2.5, Math.min(4.5, 2.5 + _along * 0.02));
        const _closest = new THREE.Vector3().copy(_rayOrigin).addScaledVector(_rayDir, _along);
        if (_closest.distanceTo(_sobs.position) < _hitR) {
          _destroyed.add(_si);
        }
      }
    }
    // Destroy in reverse order so splice indices stay valid
    const _toDestroy = [..._destroyed].sort((a,b) => b - a);
    for (const _si of _toDestroy) {
      const _sobs = activeObstacles[_si];
      spawnConeShards(_sobs.position.x, _sobs.position.y, _sobs.position.z, currentLevelDef.gridColor);
      returnObstacleToPool(_sobs);
      activeObstacles.splice(_si, 1);
      playSFX(220, 0.15, 'sawtooth', 0.2);
    }
    state._laserScanPrevAngle = _angle;
  }

  // ── Power-up timers
  if (state.laserActive) {
    state.laserTimer -= dt;
    const _tier = state.laserTier || 1;
    const lc = state.laserColor || 0xff3300;
    const pulse = 0.8 + Math.sin(state.frameCount * 1.2) * 0.15;

    if (_tier <= 3) {
      // T1-T3: bolt machine gun
      laserPivot.visible = false;
      state.laserBoltTimer = (state.laserBoltTimer || 0) + dt;
      const interval = 1.0 / (state.laserFireRate || _lbFireRate);
      while (state.laserBoltTimer >= interval) {
        state.laserBoltTimer -= interval;
        const lanes = state._laserBoltLanes || _lbLanes;
        const half  = (lanes - 1) / 2;
        for (let li = 0; li < lanes; li++) spawnLaserBolt(li - half);
      }
    } else if (_tier === 4) {
      // T4: static unibeam — pivot at ship nose, no rotation
      laserPivot.visible = true;
      laserMesh.visible = true;
      laserGlowMesh.visible = true;
      laserMat.color.set(0xffffff);
      laserGlowMat.color.setHex(lc);
      laserMat.opacity = pulse;
      laserGlowMat.opacity = pulse * 0.25;
      laserPivot.position.set(state.shipX + _lBeamXOff, _lBeamY, shipGroup.position.z);
      laserPivot.rotation.y = 0;
    } else {
      // T5: scanning unibeam — pivot sits at ship nose, beam sweeps left-right
      laserPivot.visible = true;
      laserMesh.visible = true;
      laserGlowMesh.visible = true;
      laserMat.color.set(0xffffff);
      laserGlowMat.color.setHex(lc);
      laserMat.opacity = pulse;
      laserGlowMat.opacity = pulse * 0.3;
      const _scanMax   = Math.PI / 4;  // ±45°
      const _scanSpeed = 1.2;
      state._laserScanAngle = (state._laserScanAngle || 0) + state._laserScanDir * _scanSpeed * dt;
      if (state._laserScanAngle >= _scanMax)  { state._laserScanAngle = _scanMax;  state._laserScanDir = -1; }
      if (state._laserScanAngle <= -_scanMax) { state._laserScanAngle = -_scanMax; state._laserScanDir =  1; }
      // Pivot is at ship nose — rotating it swings the far end of the beam
      laserPivot.position.set(state.shipX + _lBeamXOff, _lBeamY, shipGroup.position.z);
      laserPivot.rotation.y = state._laserScanAngle;
    }

    if (state.laserTimer <= 0) {
      state.laserActive = false;
      laserMat.opacity = 0;
      laserGlowMat.opacity = 0;
      laserPivot.visible = false;
    }
  }

  // Update laser bolts
  for (let bi = laserBolts.length - 1; bi >= 0; bi--) {
    const bolt = laserBolts[bi];
    if (!bolt.visible) continue;
    bolt.position.x = state.shipX + (bolt.userData._side || 0);
    bolt.position.z += bolt.userData.vel * dt;
    bolt.userData.life -= dt;
    if (bolt.userData.life <= 0 || bolt.position.z < -200) {
      bolt.visible = false;
      continue;
    }
    // Check collision with obstacles
    for (let oi = activeObstacles.length - 1; oi >= 0; oi--) {
      const obs = activeObstacles[oi];
      if (obs.userData.isCorridor) continue;
      const dx = Math.abs(bolt.position.x - obs.position.x);
      const dz = Math.abs(bolt.position.z - obs.position.z);
      if (dx < 1.5 && dz < 2) {
        spawnConeShards(obs.position.x, obs.position.y, obs.position.z, currentLevelDef.gridColor);
        returnObstacleToPool(obs);
        activeObstacles.splice(oi, 1);
        bolt.visible = false;
        playSFX(220, 0.15, 'sawtooth', 0.2);
        break;
      }
    }
  }
  if (state.multiplierTimer > 0) {
    state.multiplierTimer -= dt;
    if (state.multiplierTimer <= 0) { state.multiplier = 1; updateMultiplierHUD(); }
  }
  // Shield duration timer (tier 2+)
  if (state.shieldActive && state.shieldDuration > 0 && state.invincibleTimer <= 0) {
    state.shieldTimer -= dt;
    if (state.shieldTimer <= 0) {
      state.shieldActive = false;
      state._prevShieldHP = 0;
      shieldMesh.visible = false;
      shieldMat.uniforms.uReveal.value = 1.0;
      shieldWireMat.opacity = 0;
      shieldLight.intensity = 0;
      const _shExpSfx = document.getElementById('shield-expire-sfx'); if (_shExpSfx) { _shExpSfx.currentTime = 0; _shExpSfx.play().catch(()=>{}); }
    }
  }
  if (state.invincibleTimer > 0) {
    state.invincibleTimer -= dt;
    const GRACE_PERIOD = state.invincibleGrace || 2.0;
    // Kill speed boost but keep invincibility for grace period
    if (state.invincibleTimer <= GRACE_PERIOD && state.invincibleSpeedActive) {
      state.invincibleSpeedActive = false;
    }
    // RGB chromatic aberration: full split during speed, ramp down during grace
    const BASE_ABERRATION = 0.0015;
    const MAX_ABERRATION = 0.04;
    if (state.invincibleSpeedActive) {
      vignettePass.uniforms.aberration.value = MAX_ABERRATION;
    } else {
      // Grace period: lerp from current toward base
      const t = Math.max(0, state.invincibleTimer / GRACE_PERIOD);
      vignettePass.uniforms.aberration.value = BASE_ABERRATION + (MAX_ABERRATION - BASE_ABERRATION) * t;
    }
    if (state.invincibleTimer <= 0) {
      state.shieldActive = false;
      state.invincibleSpeedActive = false;
      vignettePass.uniforms.aberration.value = BASE_ABERRATION;
      shieldMesh.visible = false; shieldWire.visible = false;
      shieldMat.uniforms.uReveal.value = 1.0;
      shieldWireMat.opacity = 0;
      shieldLight.intensity = 0;
    }
    // Near-miss red flash (skip if invincible rainbow is active)
    if (state.nearMissFlash > 0 && !state.invincibleSpeedActive && shipHullMats.length) {
      const f = state.nearMissFlash;
      const red = new THREE.Color(1.0, 0.15, 0.05);
      for (let i = 0; i < shipHullMats.length; i++) {
        shipHullMats[i].emissive.copy(red);
        shipHullMats[i].emissiveIntensity = f * 2.5;
      }
      state.nearMissFlash = Math.max(0, state.nearMissFlash - dt * 3.0); // ~0.33s decay
    }
    // Gold-rainbow hull cycle while invincible (gold/amber/warm hues only)
    if (state.invincibleSpeedActive && shipHullMats.length) {
      // Full MarioKart rainbow — full HSL rotation at 2 Hz
      const hue     = (state.elapsed * 2.0) % 1.0;
      const c       = new THREE.Color().setHSL(hue, 1.0, 0.55);
      const emissHue = (hue + 0.08) % 1.0;
      const eC      = new THREE.Color().setHSL(emissHue, 1.0, 0.5);
      const eiPulse = 1.4 + Math.sin(state.elapsed * 6 * Math.PI * 2) * 0.6;
      for (let i = 0; i < shipHullMats.length; i++) {
        shipHullMats[i].color.copy(c);
        shipHullMats[i].emissive.copy(eC);
        shipHullMats[i].emissiveIntensity = eiPulse;
      }
      const eHue2 = (hue + 0.5) % 1.0;
      const eC2   = new THREE.Color().setHSL(eHue2, 1.0, 0.6);
      for (let i = 0; i < shipEdgeLines.length; i++) {
        shipEdgeLines[i].color.copy(eC2);
        shipEdgeLines[i].emissive.copy(eC2);
        shipEdgeLines[i].emissiveIntensity = 3.0;
      }
    }
    // Grace period: speed boost ended but still invincible — slow white flash
    if (!state.invincibleSpeedActive && state.shieldActive && state.invincibleTimer > 0 && shipHullMats.length) {
      const flash = 0.5 + 0.5 * Math.sin(state.elapsed * 3 * Math.PI * 2); // ~1.5 Hz pulse
      const c = new THREE.Color(1, 1, 1);
      for (let i = 0; i < shipHullMats.length; i++) {
        shipHullMats[i].color.copy(c);
        shipHullMats[i].emissive.copy(c);
        shipHullMats[i].emissiveIntensity = flash * 1.5;
      }
    }
  }
  if (shipHullMats.length && shipHullMats[0].emissiveIntensity > 0) {
    // Fade back to white when turbo ends
    for (let i = 0; i < shipHullMats.length; i++) {
      shipHullMats[i].color.lerp(new THREE.Color(0xffffff), 0.08);
      shipHullMats[i].emissive.lerp(new THREE.Color(0x000000), 0.08);
      shipHullMats[i].emissiveIntensity = Math.max(0, shipHullMats[i].emissiveIntensity - 0.02);
    }
    // Restore edge lines to current level color
    const _lvlColor = LEVELS[state.currentLevelIdx].gridColor;
    for (let i = 0; i < shipEdgeLines.length; i++) {
      shipEdgeLines[i].color.lerp(_lvlColor, 0.08);
      if (shipEdgeLines[i].emissive) shipEdgeLines[i].emissive.lerp(_lvlColor, 0.08);
    }
  }
  if (state.magnetActive) {
    state.magnetTimer -= dt;
    if (state.magnetTimer <= 0) {
      state.magnetActive = false;
      _stopMagnetWhir();
      magnetRing.visible = false; magnetRing2.visible = false;
      magnetRingMat.opacity = 0;
      magnetRing2.material.opacity = 0;
      magnetLight.intensity = 0;
    } else {
      // Two orthogonal rings orbit around the ship at different angles
      const mt = state.elapsed;
      magnetRing.rotation.x  = mt * 1.8;
      magnetRing.rotation.y  = mt * 0.9;
      magnetRing2.rotation.x = mt * 1.8 + Math.PI * 0.5;
      magnetRing2.rotation.z = mt * 1.2;
      const mPulse = 0.55 + Math.sin(mt * 8) * 0.2;
      magnetRingMat.opacity          = mPulse;
      magnetRing2.material.opacity   = mPulse * 0.7;
      magnetLight.intensity = 1.8 + Math.sin(mt * 6) * 0.8;
    }
  } else {
    magnetRingMat.opacity = 0;
    magnetRing2.material.opacity = 0;
    magnetLight.intensity = 0;
  }
  updatePowerupTray();

  // ── Grid scroll
  scrollGrid(dt * effectiveSpeed / state.speed);

  // ── Death Run level sequencer ──
  // Always tick the sequencer — REST stages manage deathRunRestBeat internally
  // to suppress the spawner. Gating the sequencer on restBeat caused REST stages
  // to run ~31x longer than intended (seqStageElapsed only advanced 1 frame per 0.5s).
  if (state.isDeathRun && !state.introActive && !state._tutorialActive && !state._jetLightningMode) {
    if (state.deathRunRestBeat > 0) state.deathRunRestBeat -= dt;
    _drSequencerTick(dt);
  }
  // ── Legacy wave director (disabled — replaced by sequencer) ──
  if (false && state.isDeathRun && !state.introActive) {
    if (false) {
      // Current run band (with forced band override for dynamic-duration tiers)
      const _drElapsed = state.elapsed || 0;
      let _drBandIdx = DR2_RUN_BANDS.length - 1;
      let _drBand = DR2_RUN_BANDS[_drBandIdx];
      if (state._drForcedBand != null && state._drForcedBand >= 0) {
        _drBandIdx = state._drForcedBand;
        _drBand = DR2_RUN_BANDS[_drBandIdx];
      } else {
        for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
          if (_drElapsed < DR2_RUN_BANDS[bi].maxTime) { _drBand = DR2_RUN_BANDS[bi]; _drBandIdx = bi; break; }
        }
      }
      // Band 4 (idx 3): auto-start CORRIDOR_ARC on entry
      if (_drBandIdx === 3 && !state._drBand4Started) {
        state._drBand4Started = true;
        clearAllCorridorFlags(); state.deathRunRestBeat = 1.0;
        const fam = DR_MECHANIC_FAMILIES['CORRIDOR_ARC'];
        state.drPhase = 'BUILD'; state.drPhaseTimer = 0; state.drPhaseDuration = 0;
        fam.activate(_drBand, 'build');
      }
      // Band 4→5: when corridor arc finishes, advance to Band 5
      if (_drBandIdx === 3 && state._drBand4Started && !state._arcActive &&
          !state.corridorMode && !state.l4CorridorActive && !state.l5CorridorActive) {
        state._drForcedBand = 4; // Band 5
        state._drBand5StartTime = state.elapsed;
        state.drPhase = 'RELEASE'; state.drPhaseTimer = 0;
        const _relDur = DR2_PHASE_DURATIONS.RELEASE;
        state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);
      }
      // Band 5→6: after 30s in Band 5, advance to Band 6
      if (state._drForcedBand === 4 && state._drBand5StartTime &&
          state.elapsed - state._drBand5StartTime >= 30) {
        state._drForcedBand = 5; // Band 6
      }

      // Is ANY structured mechanic currently active?
      // Advance arc stages (must run before mechActive check)
      _drAdvanceArc();
      const _drMechActive = state.slalomActive ||
                            state.zipperActive || state.angledWallsActive ||
                            state.drCustomPatternActive || state.corridorMode ||
                            state.l4CorridorActive || state.l5CorridorActive ||
                            state._arcActive;

      const phase = state.drPhase;

      if (phase === 'RELEASE' || phase === 'RECOVERY') {
        state.drPhaseTimer += dt;
        if (state.drPhaseTimer >= state.drPhaseDuration) {
          if (phase === 'RELEASE') {
            // Band 1: pure random cones only — loop RELEASE until Band 2
            if (_drBand.label === 'BAND1') {
              state.drPhaseTimer = 0;
              const _relDur = DR2_PHASE_DURATIONS.RELEASE;
              state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);

            } else {
              // Brief clear beat before structured mechanic starts
              const familyKey = _drPickMechanic('build', _drBandIdx);
              if (!familyKey) {
                // No eligible mechanics — loop RELEASE
                state.drPhaseTimer = 0;
                const _relDur2 = DR2_PHASE_DURATIONS.RELEASE;
                state.drPhaseDuration = _relDur2.min + Math.random() * (_relDur2.max - _relDur2.min);
              } else {
                state.deathRunRestBeat = 1.0 + Math.random() * 0.5;
                const family = DR_MECHANIC_FAMILIES[familyKey];
                state.drPhase = 'BUILD';
                state.drPhaseTimer = 0;
                state.drPhaseDuration = 0;
                family.activate(_drBand, 'build');
                _dr2DebugLog();
              }
            }
          } else {
            // RECOVERY -> RELEASE
            state.drPhase = 'RELEASE';
            state.drPhaseTimer = 0;
            const _relDur = DR2_PHASE_DURATIONS.RELEASE;
            state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);
            state.drWaveCount++;
            // 40% chance to spawn bonus rings at start of new RELEASE
            if (!state._tutorialActive && !state._jetLightningMode && Math.random() < 0.6 && _bonusRings.length === 0) { _ringSpawnRow(0); console.log('[DR] Bonus rings spawned (RELEASE), count=' + _bonusRings.length); }
            _dr2DebugLog();
          }
        }
      } else if (phase === 'BUILD') {
        if (!_drMechActive) {
          // BUILD mechanic finished. PEAK or RECOVERY?
          const doPeak = Math.random() < _drBand.peakChance;
          if (doPeak) {
            const familyKey = _drPickMechanic('peak', _drBandIdx);
            if (!familyKey) {
              // No eligible peak mechanics — skip to RECOVERY
              state.drPhase = 'RECOVERY';
              state.drPhaseTimer = 0;
              const _recDur2 = DR2_PHASE_DURATIONS.RECOVERY;
              state.drPhaseDuration = _recDur2.min + Math.random() * (_recDur2.max - _recDur2.min);
            } else {
              state.deathRunRestBeat = 1.0 + Math.random() * 0.5;
              const family = DR_MECHANIC_FAMILIES[familyKey];
              state.drPhase = 'PEAK';
              state.drPhaseTimer = 0;
              state.drPhaseDuration = 0;
              family.activate(_drBand, 'peak');
            }
          } else {
            state.drPhase = 'RECOVERY';
            state.drPhaseTimer = 0;
            const _recDur = DR2_PHASE_DURATIONS.RECOVERY;
            state.drPhaseDuration = _recDur.min + Math.random() * (_recDur.max - _recDur.min);
            state.deathRunRestBeat = 0.8 + Math.random() * 0.4;

          }
          _dr2DebugLog();
        }
      } else if (phase === 'PEAK') {
        if (!_drMechActive) {
          // PEAK mechanic done → SUSTAIN (brief high-intensity cones before recovery)
          state.drPhase = 'SUSTAIN';
          state.drPhaseTimer = 0;
          const _susDur = DR2_PHASE_DURATIONS.SUSTAIN;
          state.drPhaseDuration = _susDur.min + Math.random() * (_susDur.max - _susDur.min);
          _dr2DebugLog();
        }
      } else if (phase === 'SUSTAIN') {
        // Fast random cones, no rest beat — intensity holds before dropping
        state.drPhaseTimer += dt;
        if (state.drPhaseTimer >= state.drPhaseDuration) {
          state.drPhase = 'RECOVERY';
          state.drPhaseTimer = 0;
          const _recDur = DR2_PHASE_DURATIONS.RECOVERY;
          state.drPhaseDuration = _recDur.min + Math.random() * (_recDur.max - _recDur.min);
          state.deathRunRestBeat = 1.0 + Math.random() * 0.5;
          // Always spawn bonus rings after surviving peak — reward
          if (!state._tutorialActive && !state._jetLightningMode && _bonusRings.length === 0) { _ringSpawnRow(0); console.log('[DR] Bonus rings spawned (post-PEAK), count=' + _bonusRings.length); }
          _dr2DebugLog();
        }
      }
    }
  }

  // ── Spawn
  // L3 dense corridor: spawn wall rows every ~7 world units (ship-relative, cyan tinted)
  if (state.corridorMode && !state._jetLightningMode) {
    if (!state.isDeathRun) maybeStartGauntlet();
    if (state.corridorDelay > 0) {
      state.corridorDelay -= dt;
    } else {
      state.corridorSpawnZ += effectiveSpeed * dt;
      if (state.corridorSpawnZ >= 0) {
        state.corridorSpawnZ = -7 + (Math.random() - 0.5) * 2;
        spawnCorridorRow();
        // DR: row-limited — wave director controls duration
        if (state.isDeathRun && state.corridorRowsDone >= (state._drL3MaxRows || 999)) {
          state.corridorMode = false;
        }
      }
    }
  }

  // L4 sine corridor (death run: row-limited, no auto-trigger)
  if (state.isDeathRun && state.l4CorridorActive) {
    if (state.l4Delay > 0) {
      state.l4Delay -= dt;
    } else {
      state.l4SpawnZ += effectiveSpeed * dt;
      if (state.l4SpawnZ >= 0) {
        state.l4SpawnZ = -7 + (Math.random() - 0.5) * 2;
        spawnL4CorridorRow(); // increments l4RowsDone internally
        if (state.l4RowsDone % 50 === 0) console.log('[L4-DEBUG] row ' + state.l4RowsDone + '/' + (state._drL4MaxRows || 999));
        if (state.l4RowsDone >= (state._drL4MaxRows || 999)) {
          console.log('[L4-DEBUG] ENDED at row ' + state.l4RowsDone);
          state.l4CorridorActive = false;
        }
      }
    }
  } else if (state.currentLevelIdx === 3 && !state.l4CorridorDone && !state.isDeathRun && !state._jetLightningMode) {
    if (!state.l4CorridorActive) {
      if (state.levelElapsed >= L4_CORRIDOR_TRIGGER_S) {
        state.l4CorridorActive = true;
        state.l4SpawnZ         = -7;
        state.l4RowsDone       = 0;
        state.l4SineT          = 0;
        state.l4StartElapsed   = state.levelElapsed;
        state.l4Delay          = 2.0;

      }
    } else {
      // Check if duration expired
      if (state.levelElapsed - state.l4StartElapsed >= L4_CORRIDOR_DURATION_S) {
        state.l4CorridorActive = false;
        state.l4CorridorDone   = true;
      } else {
        if (state.l4Delay > 0) {
          state.l4Delay -= dt;
        } else {
          state.l4SpawnZ += effectiveSpeed * dt;
          if (state.l4SpawnZ >= 0) {
            state.l4SpawnZ = -7 + (Math.random() - 0.5) * 2;
            spawnL4CorridorRow();
          }
        }
      }
    }
  }

  // L5 zipper: fully time-based, managed here so cooldown ticks regardless of normal spawn path
  if (state.isDeathRun && (state.l5CorridorActive || state.zipperActive)) {
    // Death run: only run active spawners
    if (state.l5CorridorActive) {
      state.l5CorridorSpawnZ += effectiveSpeed * dt;
      if (state.l5CorridorSpawnZ >= 0) {
        state.l5CorridorSpawnZ = -7 + (Math.random() - 0.5) * 2;
        spawnL5CorridorRow(); // increments l5CorridorRowsDone internally
        if (state.l5CorridorRowsDone >= (state._drL5MaxRows || L5C_TOTAL_ROWS)) {
          state.l5CorridorActive = false;
          // DR: wave director handles transition (no ending sequence)
        }
      }
    } else if (state.zipperActive) {
      state.zipperSpawnTimer -= dt;
      if (state.zipperSpawnTimer <= 0) {
        const rowsDone = Math.max(0, ZIPPER_ROWS - state.zipperRowsLeft);
        const ramp = Math.min(rowsDone / (ZIPPER_ROWS - 1), 1.0);
        state.zipperSpawnTimer = 1.5 - ramp * 0.65;
        spawnZipperRow();
      }
    }
  }

  // Slalom minefield spawner (death run only)
  if (state.isDeathRun && state.slalomActive) {
    state.slalomSpawnZ += effectiveSpeed * dt;
    if (state.slalomSpawnZ >= 0) {
      state.slalomSpawnZ = -SLALOM_Z_SPACING;
      spawnSlalomRow();
      if (state.slalomRowsDone >= state.slalomMaxRows) {
        state.slalomActive = false;
        // Wave director handles rest/transition in its phase tick
      }
    }
  }


  // Custom pattern spawner (death run only)
  if (state.isDeathRun && state.drCustomPatternActive && !state.introActive) {
    state.drCustomPatternSpawnZ += effectiveSpeed * dt;
    if (state.drCustomPatternSpawnZ >= 0) {
      state.drCustomPatternSpawnZ = -7;
      spawnCustomPatternRow();
    }
  }

  if (state.currentLevelIdx === 4 && !state.isDeathRun && !state.isDeathRun2) {
    if (state.l5EndingActive) {
      // Ending: just sail — no cones, dots stay on, gentle deceleration
      state.l5EndingTimer += dt;
      const slowTarget = BASE_SPEED * 0.9;
      state.speed = Math.max(slowTarget, state.speed - dt * 8);
      // After 3s of sailing, fade in JET HORIZON title card cinematic-style
      if (!state.l5TitleShown && state.l5EndingTimer >= 3.0) {
        state.l5TitleShown = true;
        const _ov = document.getElementById('intro-overlay');
        if (_ov) {
          _ov.innerHTML = '';
          _ov.style.display = 'flex';
          const _tc = document.createElement('div');
          _tc.className = 'intro-title line-c';
          _tc.textContent = 'JET HORIZON';
          _ov.appendChild(_tc);
          // Use a longer animation for the ending — fade in slowly, stay, never fade out
          _tc.style.animation = 'none';
          _tc.style.opacity   = '0';
          _tc.style.transition = 'opacity 3s ease-in-out';
          requestAnimationFrame(() => requestAnimationFrame(() => {
            _tc.style.opacity = '1';
          }));
        }
      }
    } else if (state.l5CorridorActive) {
      // L5 final challenge: random-walk corridor
      state.l5CorridorSpawnZ += effectiveSpeed * dt;
      if (state.l5CorridorSpawnZ >= 0) {
        state.l5CorridorSpawnZ = -7 + (Math.random() - 0.5) * 2;
        if (state.l5CorridorRowsDone >= L5C_TOTAL_ROWS) {
          // Corridor complete — brief random cone burst before sail-out
          state.l5CorridorActive       = false;
          state.l5CorridorDone         = true;
          if (!state.isDeathRun) {
            state.l5RandomAfterCorridor  = 5.0;  // 5s of random cones then ending
            // Fire title music now — 3s into this post-corridor phase
            const _tDelay = setTimeout(() => {
              if (titleMusic) titleMusic.currentTime = 0;
              musicFadeTo('title', 6000);
            }, 3000);
            _musicTimers.push(_tDelay);
          }
        } else {
          spawnL5CorridorRow();
        }
      }
    } else if (state.l5RandomAfterCorridor > 0) {
      // Post-corridor: random cones for a few seconds before sail-out
      state.l5RandomAfterCorridor -= dt;
      if (state.l5RandomAfterCorridor <= 0) {
        if (!state.isDeathRun) {
          state.l5EndingActive = true;
          saveLevelBeaten(4); // L5 beaten
        }
      }
    } else if (state.l5RandomAfterZipper > 0) {
      // Post-2nd-zipper: a few more random cones, then trigger corridor
      state.l5RandomAfterZipper -= dt;
      if (state.l5RandomAfterZipper <= 0 && !state.l5CorridorDone) {
        state.l5CorridorActive    = true;
        state.l5CorridorRowsDone  = 0;
        state.l5CorridorSpawnZ    = -7;
        state.l5SineT             = 0;
      }
    } else if (state.l5PreZipperRandom > 0) {
      // Entry buffer: random cones before first zipper fires
      state.l5PreZipperRandom -= dt;
      if (state.l5PreZipperRandom <= 0) {
        state.zipperCooldown = 0; // release the zipper immediately
      }
    } else if (state.zipperActive) {
      state.zipperSpawnTimer -= dt;
      if (state.zipperSpawnTimer <= 0) {
        // Ramp interval: starts at 1.5s, tightens to 0.85s by row 13
        const rowsDone = ZIPPER_ROWS - state.zipperRowsLeft;
        const ramp = Math.min(rowsDone / (ZIPPER_ROWS - 1), 1.0);
        state.zipperSpawnTimer = 1.5 - ramp * 0.65;
        spawnZipperRow();
      }
    } else {
      // Cooldown ticks in real time so it always counts down correctly
      if (state.zipperCooldown > 0) {
        state.zipperCooldown -= dt;
      } else {
        state.zipperActive    = true;
        state.zipperRowsLeft  = ZIPPER_ROWS;
        state.zipperSide      = Math.random() < 0.5 ? 1 : -1;
        state.zipperHoldCount = 0;
        state.zipperSpawnTimer = -1.0;  // 1s grace before first row
      }
    }
  }

  // Normal nextSpawnZ-based spawner — suppressed during active zipper, L5 ending, intro, or death run rest beat
  if (!state._tutorialActive && !state._jetLightningMode && !state.zipperActive && !state.l5EndingActive && !state.l5CorridorActive && !state.drCustomPatternActive && !state.angledWallsActive && !state.introActive && !(state.isDeathRun && state.deathRunRestBeat > 0) && !_awTunerPaused && !state._ringsActive) {
    state.nextSpawnZ += effectiveSpeed * dt;
    if (state.nextSpawnZ >= 0) {
      // Tighter Z spacing for rings (easier to pass through, need more density)
      let _spawnBand = 0;
      if (state.isDeathRun) {
        if (state._drForcedBand != null && state._drForcedBand >= 0) { _spawnBand = state._drForcedBand; }
        else { for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) { if (state.elapsed < DR2_RUN_BANDS[bi].maxTime) { _spawnBand = bi; break; } _spawnBand = bi; } }
      }
      const _isFatConeMode = state._seqSpawnMode === 'fat_cones';
      const _spawnZBase = _isFatConeMode ? -22 : (_spawnBand === 1) ? -30 : (_spawnBand === 2 || _spawnBand >= 5) ? -22 : (state.isDeathRun ? -30 : -50);
      state.nextSpawnZ = _spawnZBase + (Math.random() - 0.5) * 10;
      state.frameCount++;
      const l4PreClear = (!state.isDeathRun && state.currentLevelIdx === 3 && !state.l4CorridorDone &&
                          state.levelElapsed >= L4_CORRIDOR_TRIGGER_S - 4);

      if (!state.corridorMode && !state.l4CorridorActive && !l4PreClear && state.corridorDelay <= 0 && !state.slalomActive && !state.drCustomPatternActive && !_noSpawnMode) spawnObstacles();
    }
  }


  // ── Move bonus rings
  for (let i = _bonusRings.length - 1; i >= 0; i--) {
    const br = _bonusRings[i];
    br.mesh.position.z += effectiveSpeed * dt;
    // Ring collision: check against actual octagon line segments
    const _rZ = Math.abs(br.mesh.position.z - shipGroup.position.z);
    if (_rZ < 2.0) {
      const shipX = state.shipX;
      const shipY = shipGroup.position.y;
      const ringCX = br.mesh.position.x;

      if (br.mesh.userData.isGauntletRing) {
        // Gauntlet: use _rgDesign values, not _ringTuner
        const R = _rgDesign.radius;
        const SIDES = _rgDesign.sides;
        const ringCY = _rgDesign.y;
        const halfLW = 1.5 / 2; // world units linewidth / 2
        const shipHalf = 1.2;
        let hit = false;
        for (let s = 0; s < SIDES && !hit; s++) {
          const a0 = (s / SIDES) * Math.PI * 2;
          const a1 = ((s + 1) / SIDES) * Math.PI * 2;
          const x0 = ringCX + Math.cos(a0) * R;
          const y0 = ringCY + Math.sin(a0) * R;
          const x1 = ringCX + Math.cos(a1) * R;
          const y1 = ringCY + Math.sin(a1) * R;
          // Point-to-segment distance
          const dx = x1 - x0, dy = y1 - y0;
          const len2 = dx * dx + dy * dy;
          let t = len2 > 0 ? ((shipX - x0) * dx + (shipY - y0) * dy) / len2 : 0;
          t = Math.max(0, Math.min(1, t));
          const closestX = x0 + t * dx;
          const closestY = y0 + t * dy;
          const dist = Math.sqrt((shipX - closestX) ** 2 + (shipY - closestY) ** 2);
          if (dist < shipHalf + halfLW) hit = true;
        }
        if (hit) { killPlayer(); return; }
      } else if (!br.collected) {
        const R = _ringTuner.radius;
        const ringCX2 = br.mesh.position.x;
        const _rDx = Math.abs(ringCX2 - shipX);
        if (_rDx < R * 0.8) {
          br.collected = true;
          br.mesh.material.opacity = 0.08;
          _ringSpawnRipple(br.mesh.position.clone(), br.mesh.material.color.getHex());
          const fc = parseInt(window._LS.getItem('jetslide_fuelcells') || '0', 10);
          window._LS.setItem('jetslide_fuelcells', String(fc + 1));
          const _fcHud = document.getElementById('hud-fuelcells');
          if (_fcHud) _fcHud.textContent = fc + 1;
          playSFX(880, 0.2, 'sine', 0.15);
          // Fuel cell particle fly from ship position
          _spawnFuelFly(shipGroup.position);
        }
      }
    }
    // Despawn when past camera
    if (br.mesh.position.z > 20) {
      scene.remove(br.mesh); br.mesh.geometry.dispose(); br.mesh.material.dispose();
      _bonusRings.splice(i, 1);
    }
  }
  if (_bonusRings.length === 0 && state._ringsActive) state._ringsActive = false;
  _ringTickRipples(dt);

  // ── Move obstacles
  for (let i = activeObstacles.length - 1; i >= 0; i--) {
    const obs = activeObstacles[i];
    obs.position.z += effectiveSpeed * dt;

    // Smooth fade-in from horizon: invisible at spawn, fully opaque by z=-80
    const FADE_START_Z = SPAWN_Z;       // -160: totally transparent at birth
    const FADE_END_Z   = -110;          // fully opaque from here onward
    const fadeT = Math.max(0, Math.min(1, (obs.position.z - FADE_START_Z) / (FADE_END_Z - FADE_START_Z)));
    const fullyOpaque = fadeT >= 1.0;
    const _mc = obs.userData._meshes;
    for (let mi = 0; mi < _mc.length; mi++) {
      const child = _mc[mi];
      const baseOp = child.material.userData.baseOpacity ?? 1.0;
      if (child.material.uniforms && child.material.uniforms.uOpacity) {
        child.material.uniforms.uOpacity.value = fadeT * baseOp;
        // Once fully opaque, switch to solid for depth buffer (blocks corona)
        if (fullyOpaque && child.material.transparent) {
          child.material.transparent = false;
          child.material.depthWrite = true;
          child.material.needsUpdate = true;
        } else if (!fullyOpaque && !child.material.transparent) {
          child.material.transparent = true;
          child.material.depthWrite = false;
          child.material.needsUpdate = true;
        }
      } else {
        const wantTransparent = !fullyOpaque;
        if (child.material.transparent !== wantTransparent) {
          child.material.transparent = wantTransparent;
          child.material.needsUpdate = true;
        }
        child.material.opacity = fullyOpaque ? 1.0 : fadeT * baseOp;
      }
    }

    if (obs.position.z > DESPAWN_Z) {
      returnObstacleToPool(obs);
      activeObstacles.splice(i, 1);
      continue;
    }

    // ── Laser destroys obstacles (corridor/zipper cones are immune)
    if (state.laserActive && !obs.userData.isCorridor) {
      const _lt = state.laserTier || 1;
      let _laserHit = false;
      const oz = obs.position.z;
      const ox = obs.position.x;
      if (oz < 8 && oz > SPAWN_Z) {
        if (_lt <= 3) {
          // Bolt laser: narrow corridor around ship center
          _laserHit = Math.abs(ox - state.shipX) < 1.2;
        } else if (_lt === 4) {
          // T4 static unibeam: narrow corridor straight ahead
          _laserHit = Math.abs(ox - state.shipX) < 1.5;
        } else {
          // T5 scanning beam: handled separately via raycaster below — skip here
        }
      }
      if (_laserHit) {
        spawnConeShards(ox, obs.position.y, oz, currentLevelDef.gridColor);
        returnObstacleToPool(obs);
        activeObstacles.splice(i, 1);
        playSFX(220, 0.15, 'sawtooth', 0.2);
        continue;
      }
    }

    // ── Collision with ship
    if (obs.userData.isEcho) continue; // echo cones are visual only — no collision
    // Rotation-aware hitbox: wings (±2.1) point sideways when flat, up/down when rolled 90°
    // Roll angle from shipGroup.rotation.z — at 0 = flat (full wing width), at ±PI/2 = vertical (fuselage only)
    const roll = shipGroup.rotation.z || 0;
    const absRoll = Math.abs(roll);
    const rollFrac = Math.min(absRoll / (Math.PI / 2), 1); // 0=flat, 1=fully vertical
    const WING_HALF  = 1.5;  // reduced — ring is visual only, not part of hitbox
    const BODY_HALF  = 0.8;  // wider rolled hitbox so threading gaps is harder
    const colDistX = WING_HALF * (1 - rollFrac) + BODY_HALF * rollFrac;
    const colDistZ = 1.5;    // wider Z so fast head-on hits register
    // Scale hitbox for fat/slalom cones — fat cones get a more forgiving hitbox
    const cScale = obs.userData.slalomScaled ? (obs.scale.x || 1) : 1;
    const cMult = obs.userData.isFatCone ? 0.9 : 1.2; // fat cones: hitbox matches cone visual at ship flight height (Y=1.71, ~4.33 unit radius)
    const dxC = Math.abs(obs.position.x - state.shipX);
    const dzC = Math.abs(obs.position.z - shipGroup.position.z);
    if (dxC < (colDistX + (cScale - 1) * cMult) && dzC < (colDistZ + (cScale - 1) * 0.4)) {
      returnObstacleToPool(obs);
      activeObstacles.splice(i, 1);
      if (_godMode) {
        const _shHitSfx = document.getElementById('shield-hit-sfx');
        if (_shHitSfx) { _shHitSfx.currentTime = 0; _shHitSfx.play().catch(()=>{}); }
        addCrashFlash(0xff4400);
      } else {
        killPlayer();
      }
      return;
    }

    // ── Near-miss detection (must survive the kill check above)
    if (!state.l5EndingActive && !obs.userData.nearMissScored && dxC < (colDistX + 0.6) && dzC < 2.0 && dxC > colDistX) {
      // Cooldown: max 1 near-miss SFX per 0.5s to prevent audio spam
      const now = performance.now();
      if (!state._lastNearMissTime) state._lastNearMissTime = 0;
      const canPlaySFX = (now - state._lastNearMissTime) > 500;

      const lvlMult = [1, 1.5, 2, 3, 4][state.currentLevelIdx] || 1;
      if (state.corridorMode || state.l4CorridorActive || state.l5CorridorActive) {
        // Inside corridor: only award on bends
        if (state.nearMissBendAllowed) {
          state.playerScore += 25 * lvlMult;
          state.nearMissBendAllowed = false;
          obs.userData.nearMissScored = true;
          state.nearMissFlash = 1.0; hapticTap();
          if (canPlaySFX) { playNearMissSFX(); state._lastNearMissTime = now; }
        }
      } else {
        // Outside corridor: one per cone, but cooldown on SFX
        state.playerScore += 25 * lvlMult;
        obs.userData.nearMissScored = true;
        state.nearMissFlash = 1.0; hapticTap();
        if (canPlaySFX) { playNearMissSFX(); state._lastNearMissTime = now; }
      }
    }
  }

  // ── Angled walls: spawn + move + collide
  if (state.angledWallsActive && !_awTunerPaused) {
    state.angledWallSpawnZ += effectiveSpeed * dt;
    if (state.angledWallSpawnZ >= 0 && state.angledWallRowsDone < _awTuner.rows) {
      state.angledWallSpawnZ = -_awTuner.zSpacing;
      spawnAngledWallRow();
    }
    // End angled walls phase when all rows spawned AND all walls passed
    if (state.angledWallRowsDone >= _awTuner.rows && _awActive.length === 0) {
      state.angledWallsActive = false;
    }
  }
  for (let i = _awActive.length - 1; i >= 0; i--) {
    const w = _awActive[i];
    if (!_awTunerPaused) w.position.z += effectiveSpeed * dt;
    // Fade-in (skip when paused — walls are placed manually with full opacity)
    if (!_awTunerPaused) {
      const awFadeT = Math.max(0, Math.min(1, (w.position.z - SPAWN_Z) / (SPAWN_Z * -0.4)));
      const awEchoMul = w.userData.echoOpacity ?? 1.0;
      w.userData._mesh.material.uniforms.uOpacity.value = awFadeT * _awTuner.opacity * awEchoMul;
      w.userData._edges.material.opacity = awFadeT * _awTuner.opacity * 0.9 * awEchoMul;
    }
    // Laser destroys walls
    if (state.laserActive) {
      const ldx = Math.abs(w.position.x - state.shipX);
      if (ldx < 5 && w.position.z < 8 && w.position.z > SPAWN_Z) {
        _returnWallToPool(w);
        _awActive.splice(i, 1);
        playSFX(180, 0.15, 'sawtooth', 0.25);
        continue;
      }
    }
    // Despawn
    if (w.position.z > DESPAWN_Z + 10) {
      _returnWallToPool(w);
      _awActive.splice(i, 1);
      continue;
    }
    // Collision: full 3-axis rotated AABB check (uses wall's actual mesh scale)
    if (!state.invincibleSpeedActive && !state.introActive) {
      const ms = w.userData._mesh.scale;
      const halfW = ms.x / 2;
      const halfH = ms.y / 2;
      const halfT = ms.z / 2;
      // Ship world position
      const sx = state.shipX;
      const sy = shipGroup.position.y;
      const sz = shipGroup.position.z;
      // Wall mesh center in world space (mesh is offset by halfH in local Y)
      w.updateMatrixWorld(true);
      const wm = w.userData._mesh;
      wm.updateMatrixWorld(true);
      const wc = new THREE.Vector3();
      wm.getWorldPosition(wc);
      // Delta in world space
      const dx = sx - wc.x;
      const dy = sy - wc.y;
      const dz = sz - wc.z;
      // Extract wall's world rotation axes from its matrixWorld
      const e = wm.matrixWorld.elements;
      // Column vectors (normalized — scale is baked into half-extents)
      const ax0x = e[0], ax0y = e[1], ax0z = e[2];
      const ax1x = e[4], ax1y = e[5], ax1z = e[6];
      const ax2x = e[8], ax2y = e[9], ax2z = e[10];
      const len0 = Math.sqrt(ax0x*ax0x + ax0y*ax0y + ax0z*ax0z) || 1;
      const len1 = Math.sqrt(ax1x*ax1x + ax1y*ax1y + ax1z*ax1z) || 1;
      const len2 = Math.sqrt(ax2x*ax2x + ax2y*ax2y + ax2z*ax2z) || 1;
      // Project delta onto wall's local axes
      const localX = (dx * ax0x + dy * ax0y + dz * ax0z) / len0;
      const localY = (dx * ax1x + dy * ax1y + dz * ax1z) / len1;
      const localZ = (dx * ax2x + dy * ax2y + dz * ax2z) / len2;
      const shipHalfX = 0.3;
      const shipHalfZ = 0.3;
      const shipHalfY = 0.3;
      if (Math.abs(localX) < (halfW + shipHalfX) &&
          Math.abs(localY) < (halfH + shipHalfY) &&
          Math.abs(localZ) < (halfT + shipHalfZ)) {
        killPlayer();
        return;
      }
    }
  }

  // ── Lethal rings: move, fade, collide, despawn
  for (let i = _lethalRingActive.length - 1; i >= 0; i--) {
    const lr = _lethalRingActive[i];
    lr.position.z += effectiveSpeed * dt;
    const fadeT = Math.max(0, Math.min(1, (lr.position.z - SPAWN_Z) / (SPAWN_Z * -0.4)));
    lr.userData._ringMesh.material.uniforms.uOpacity.value = fadeT * 0.92;
    // Laser destroys lethal rings
    if (state.laserActive) {
      let _ringHit = false;
      const _lt2 = state.laserTier || 1;
      if (_lt2 >= 5 && state._laserScanAngle !== undefined) {
        // T5: use same raycaster math
        const _rp = new THREE.Vector3().copy(lr.position).sub(new THREE.Vector3(state.shipX + _lBeamXOff, _lBeamY, shipGroup.position.z));
        const _rd = new THREE.Vector3(Math.sin(state._laserScanAngle), 0, -Math.cos(state._laserScanAngle));
        const _al = _rp.dot(_rd);
        if (_al > 0) {
          const _cl = new THREE.Vector3(state.shipX + _lBeamXOff, _lBeamY, shipGroup.position.z).addScaledVector(_rd, _al);
          _ringHit = _cl.distanceTo(lr.position) < 5.0;
        }
      } else {
        const ldx = Math.abs(lr.position.x - state.shipX);
        _ringHit = ldx < 6 && lr.position.z < 8 && lr.position.z > SPAWN_Z;
      }
      if (_ringHit) {
        lr.userData.active = false;
        lr.visible = false;
        lr.position.set(0, -9999, 0);
        _lethalRingActive.splice(i, 1);
        playSFX(200, 0.15, 'sawtooth', 0.2);
        continue;
      }
    }
    if (lr.position.z > DESPAWN_Z + 5) {
      lr.userData.active = false;
      lr.visible = false;
      lr.position.set(0, -9999, 0);
      _lethalRingActive.splice(i, 1);
      continue;
    }
    if (!state.invincibleSpeedActive && !state.introActive) {
      // Hitbox = distance to octagon tube path (matches mesh exactly)
      const sx = state.shipX - lr.position.x;
      const sy = shipGroup.position.y - (lr.position.y + _LR_Y);
      const sz = shipGroup.position.z - lr.position.z;
      // Check distance to each octagon edge segment
      const hitR = _LR_TUBE; // exact tube radius — tight to mesh
      for (let seg = 0; seg < _LR_SIDES; seg++) {
        const a0 = (seg / _LR_SIDES) * Math.PI * 2;
        const a1 = ((seg + 1) / _LR_SIDES) * Math.PI * 2;
        const ax = Math.cos(a0) * _LR_R, ay = Math.sin(a0) * _LR_R;
        const bx = Math.cos(a1) * _LR_R, by = Math.sin(a1) * _LR_R;
        // Closest point on segment A→B to ship (in ring's XY plane)
        const ex = bx - ax, ey = by - ay;
        const t = Math.max(0, Math.min(1, ((sx - ax) * ex + (sy - ay) * ey) / (ex * ex + ey * ey)));
        const cx = ax + t * ex, cy = ay + t * ey;
        const dx = sx - cx, dy2 = sy - cy;
        const dist = Math.sqrt(dx * dx + dy2 * dy2 + sz * sz);
        if (dist < hitR) {
          if (_godMode) {
            // God mode: shield-hit flash + sound, no death
            _triggerCrashFlash();
            playSFX(220, 0.18, 'sawtooth', 0.15);
            return;
          }
          killPlayer();
          return;
        }
      }
    }
  }

  // ── Move power-ups
  for (let i = activePowerups.length - 1; i >= 0; i--) {
    const pu = activePowerups[i];
    pu.position.z += effectiveSpeed * dt;
    pu.rotation.y += 1.8 * dt;
    pu.rotation.x += 0.6 * dt;

    // Magnet pull toward ship (powerups only at tier 5)
    if (state.magnetActive && state.magnetPullsPowerups) {
      const dx = state.shipX - pu.position.x;
      const dz = shipGroup.position.z - pu.position.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist < state.magnetRadius) {
        const pull = 40 * dt; // pull speed — strong enough to reel in distant powerups
        pu.position.x += (dx / dist) * pull;
        pu.position.z += (dz / dist) * pull;
      }
    }

    // Scale pulse
    const s = 1.0 + Math.sin(state.frameCount * 0.12 + i) * 0.12;
    pu.scale.setScalar(s);

    if (pu.position.z > DESPAWN_Z) {
      returnPowerupToPool(pu);
      activePowerups.splice(i, 1);
      continue;
    }

    // Collect
    const dxP = Math.abs(pu.position.x - state.shipX);
    const dzP = Math.abs(pu.position.z - shipGroup.position.z);
    if (dxP < 2.0 && dzP < 2.0) {
      applyPowerup(pu.userData.typeIdx);
      returnPowerupToPool(pu);
      activePowerups.splice(i, 1);
    }
  }


  // ── Move coins
  for (let ci = activeCoins.length - 1; ci >= 0; ci--) {
    const coin = activeCoins[ci];
    coin.position.z += effectiveSpeed * dt;
    // Spin the coin face-on (tumble in world-Y which is coin's local Z after the x-rotation)
    coin.rotation.z = state.elapsed * 2.8 + (coin.userData.spinPhase || 0);
    // Gentle bob
    coin.position.y = 1.2 + Math.sin(state.elapsed * 2.2 + (coin.userData.spinPhase || 0)) * 0.12;

    // Magnet pull — wider radius for coins than power-ups
    if (state.magnetActive) {
      const dx = coin.position.x - state.shipX;
      const dz = coin.position.z - shipGroup.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < (state.magnetRadius || 18)) {
        coin.position.x -= dx * 5 * dt;
        coin.position.z -= dz * 3 * dt;
      }
    }

    // Despawn if past camera
    if (coin.position.z > DESPAWN_Z + 2) {
      returnCoinToPool(coin);
      activeCoins.splice(ci, 1);
      continue;
    }

    // Collect
    const dcx = Math.abs(coin.position.x - state.shipX);
    const dcz = Math.abs(coin.position.z - shipGroup.position.z);
    if (dcx < 1.6 && dcz < 1.6) {
      collectCoin(coin, coin.position.clone());
      returnCoinToPool(coin);
      activeCoins.splice(ci, 1);
    }
  }

  // ── Move forcefields
  for (let fi = _activeForcefields.length - 1; fi >= 0; fi--) {
    const ff = _activeForcefields[fi];
    ff.position.z += effectiveSpeed * dt;
    if (ff.position.z > DESPAWN_Z) {
      returnForcefieldToPool(ff);
      _activeForcefields.splice(fi, 1);
      continue;
    }
    // Collision: flat plane spanning the gap, height ~4 units
    const halfW = (ff.userData.gapWidth || SLALOM_SPACING) * 0.5;
    const dx = Math.abs(ff.position.x - state.shipX);
    const dz = Math.abs(ff.position.z - shipGroup.position.z);
    if (dx < halfW && dz < 1.5 && !state.invincibleSpeedActive && !state.shieldActive) {
      killPlayer();
      return;
    }
  }

  // ── Shield — flow shader drives everything via uReveal + uTime
  if (state.shieldActive && !state.invincibleSpeedActive) {
    shieldMat.uniforms.uTime.value += dt;
    shieldWire.visible = false;
    shieldMesh.visible = true;
    if (state.shieldBuildT != null && state.shieldBuildT < 1) {
      state.shieldBuildT = Math.min(1, state.shieldBuildT + dt / 0.8);
      const ease = state.shieldBuildT * (2 - state.shieldBuildT);
      shieldMat.uniforms.uReveal.value = 1.0 - ease;
      shieldLight.intensity = ease * 1.5;
    } else {
      shieldMat.uniforms.uReveal.value = 0.0;
      shieldLight.intensity = 1.2 + Math.sin(state.frameCount * 0.15) * 0.4;
    }
  } else if (!state.shieldActive && state._shieldBreakT != null && state._shieldBreakT < 1) {
    // Death ripple: keep mesh alive, dissolve out over 0.6s
    shieldMat.uniforms.uTime.value += dt;
    state._shieldBreakT = Math.min(1, state._shieldBreakT + dt / 0.6);
    const breakEase = state._shieldBreakT * state._shieldBreakT;
    shieldMesh.visible = true;
    shieldWire.visible = false;
    shieldMat.uniforms.uReveal.value = breakEase;
    shieldLight.intensity = (1.0 - breakEase) * 1.5;
    if (state._shieldBreakT >= 1) {
      shieldMesh.visible = false;
      state._shieldBreakT = null;
      shieldLight.intensity = 0;
    }
  } else if (!state.shieldActive) {
    shieldMesh.visible = false;
    shieldWire.visible = false;
    shieldMesh.scale.setScalar(1);
  }

  // ── Sun slow rotation
  // galaxy scroll handled in updateGalaxyScroll above

  // ── Post-L3-corridor gap: 3s no cone gen before L4 random cones start
  if (state.postL3Gap > 0 && !state.corridorMode && state.currentLevelIdx === 3) {
    state.postL3Gap -= dt;
    // Block normal spawner by keeping corridorDelay positive
    state.corridorDelay = Math.max(state.corridorDelay, 0.01);
    if (state.postL3Gap <= 0) state.corridorDelay = 0;
  }

  // ── DR Portal gate update ──


  // ── Auto-spawn portal gate in DR mode after 10 seconds (POC trigger) ──
  // QUARANTINED: wormhole sequence disabled for both DR and campaign while sequencer is in development
  // if (state.isDeathRun && !_drPortalActive && !state.wormholeActive && state.elapsed > 10 && !state.introActive) {
  //   drPortalSpawn();
  // }

  updateTransition(dt);
  updateDeathRunTransition(dt);
}

// ═══════════════════════════════════════════════════
//  DEBUG OVERLAY
// ═══════════════════════════════════════════════════
let dbgFrames = 0, dbgLast = performance.now(), dbgFps = 0;
let dbgVisible = false;
const dbgEl = document.getElementById('debug-overlay');

// Toggle debug overlay with 'D' key (desktop only)
window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    dbgVisible = !dbgVisible;
    dbgEl.classList.toggle('visible', dbgVisible);
  }
  // V — toggle canyon corridor test (any mode, no cone spawning)
  if ((e.key === 'v' || e.key === 'V') && state.phase === 'playing') {
    _canyonActive = !_canyonActive;
    if (_canyonActive) {
      // Reset corridor state to row 0 with NO delay — ribbon is pre-baked from row 0
      // so the live sine counter must stay in lockstep with the geometry from frame 1.
      state.corridorRowsDone  = 0;
      state.corridorSineT     = 0;
      state.corridorSpawnZ    = -7;
      state.corridorDelay     = 0;   // no delay — geometry is already there
      state.corridorGapCenter = 0;
      state.corridorGapDir    = 1;
      state._drL3MaxRows      = 750; // exit ramp fires at row 750, matching ribbon length
      _jlCorridor.active      = true;
      _jlCorridor.type        = 'l3';
      _jlCorridor.totalRows   = 750;
      if (!_canyonWalls) _createCanyonWalls();
      const w = _canyonWalls;
      const T = _canyonTuner;
      // Also log positions after 1 frame so _updateCanyonWalls has run
      setTimeout(() => {
        if (!_canyonWalls) return;
        console.log('[CANYON] 500ms check — paste this:\n' + JSON.stringify({
          meshPositions: _canyonWalls.strips.map((m,i) => ({
            i, side: i < 2 ? 'LEFT' : 'RIGHT',
            x: +m.position.x.toFixed(1),
            y: +m.position.y.toFixed(1),
            z: +m.position.z.toFixed(1),
            geoVertCount: m.geometry.attributes.position.count,
            firstVertX:   +m.geometry.attributes.position.getX(0).toFixed(1),
            lastVertX:    +m.geometry.attributes.position.getX(m.geometry.attributes.position.count-1).toFixed(1),
          }))
        }, null, 2));
      }, 500);
      console.log('[CANYON] ON (V key) — paste this:\n' + JSON.stringify({
        freezeWide:   T.freezeWide,
        wallWidth:    T.wallWidth,
        displacement: T.displacement,
        tileLength:   T.tileLength,
        halfX:        CORRIDOR_WIDE_X,
        speed:        state.speed,
        phase:        state.phase,
        jlMode:       state._jetLightningMode,
        meshCount:    w ? w.strips.length : 0,
        meshPositions: w ? w.strips.map(m => ({
          x: +m.position.x.toFixed(1),
          y: +m.position.y.toFixed(1),
          z: +m.position.z.toFixed(1),
          visible: m.visible
        })) : []
      }, null, 2));
    } else {
      _destroyCanyonWalls();
      _jlStopCorridor();
      console.log('[CANYON] OFF');
    }
  }
});

// ═══════════════════════════════════════════════════
//  CANYON TUNER PANEL  (shown/hidden with V key alongside canyon toggle)
// ═══════════════════════════════════════════════════
(function _setupCanyonTunerPanel() {
  const S = (css) => Object.assign(document.createElement('div'), { style: css });
  const panel = document.createElement('div');
  panel.id = 'canyon-tuner';
  panel.style.cssText = [
    'position:fixed;top:10px;right:10px;width:250px;max-height:90vh;overflow-y:auto',
    'background:rgba(0,10,20,0.95);border:1px solid #00eeff;color:#00eeff',
    'font-family:monospace;font-size:11px;padding:10px;z-index:9999',
    'border-radius:4px;scrollbar-width:thin;'
  ].join(';');
  document.body.appendChild(panel);

  let panelVisible = false;

  function rebuildGeo() {
    if (!_canyonActive) return;
    _destroyCanyonWalls();
    _createCanyonWalls();
  }

  function rebuildTex() {
    if (!_canyonWalls) return;
    _canyonWalls.gridTex.dispose();
    const newTex = _makeCanyonGridTexture();
    _canyonWalls.strips.forEach(m => {
      m.material.emissiveMap = newTex;
      m.material.needsUpdate = true;
    });
    _canyonWalls.gridTex = newTex;
  }

  function hdr(txt) {
    const d = document.createElement('div');
    d.style.cssText = 'color:#ff0;font-size:10px;margin:8px 0 3px;letter-spacing:1px;';
    d.textContent = txt;
    panel.appendChild(d);
  }

  function slider(label, key, min, max, step, mode) {
    // mode: 'geo' = rebuild geometry, 'tex' = rebuild texture, 'live' = instant
    const T = _canyonTuner;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;margin:2px 0;gap:5px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'flex:0 0 105px;font-size:10px;color:#aef;';
    lbl.textContent = label;
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step; sl.value = T[key];
    sl.style.cssText = 'flex:1;accent-color:#00eeff;cursor:pointer;';
    const vl = document.createElement('span');
    vl.style.cssText = 'flex:0 0 42px;text-align:right;font-size:11px;font-weight:bold;color:#fff;';
    vl.textContent = T[key];
    sl.addEventListener('input', () => {
      T[key] = parseFloat(sl.value);
      vl.textContent = sl.value;
      if (mode === 'geo') rebuildGeo();
      else if (mode === 'tex') rebuildTex();
      // 'live' — nothing extra needed, update loop reads T directly
    });
    row.appendChild(lbl); row.appendChild(sl); row.appendChild(vl);
    panel.appendChild(row);
  }

  function colorPicker(label, key, mode) {
    const T = _canyonTuner;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;margin:2px 0;gap:5px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'flex:0 0 105px;font-size:10px;color:#aef;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = T[key];
    inp.style.cssText = 'flex:1;height:22px;cursor:pointer;border:none;background:none;';
    inp.addEventListener('input', () => {
      T[key] = inp.value;
      if (mode === 'tex') rebuildTex();
      else if (mode === 'geo') rebuildGeo();
    });
    row.appendChild(lbl); row.appendChild(inp);
    panel.appendChild(row);
  }

  function toggle(label, key) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;margin:4px 0;gap:8px;';
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.checked = _canyonTuner[key];
    chk.addEventListener('change', () => { _canyonTuner[key] = chk.checked; });
    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:10px;color:#aef;cursor:pointer;';
    lbl.textContent = label;
    row.appendChild(chk); row.appendChild(lbl);
    panel.appendChild(row);
  }

  function buildPanel() {
    panel.innerHTML = '';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:12px;font-weight:bold;color:#fff;border-bottom:1px solid #00eeff;padding-bottom:5px;margin-bottom:4px;';
    title.textContent = 'CANYON TUNER  [V to close]';
    panel.appendChild(title);

    hdr('— GEOMETRY —');
    slider('height',        'height',      20, 200, 1,    'geo');
    slider('canyonHalfX',   'canyonHalfX', 10, 120, 5,    'geo');
    slider('wallWidth',     'wallWidth',   10, 200, 5,    'geo');
    slider('displacement',  'displacement', 0, 100, 1,    'geo');
    slider('topRagged',     'topRagged',   0,  80, 1,    'geo');
    slider('slopeLean',     'slopeLean',   0,  5,  0.05, 'geo');
    slider('capHeight',     'capHeight',   0,  3,  0.05, 'geo');
    slider('segsX',         'segsX',       2,  80, 1,    'geo');
    slider('segsZ',         'segsZ',       4, 120, 2,    'geo');

    hdr('— TEXTURE —');
    colorPicker('baseColor',  'baseColor',  'tex');
    slider('brightness',    'brightness',   0, 2,   0.05, 'tex');
    colorPicker('gridColor',  'gridColor',  'tex');
    slider('gridOpacity',   'gridOpacity',  0, 1,   0.05, 'tex');
    slider('crackOpacity',  'crackOpacity', 0, 1,   0.05, 'tex');
    slider('slabCount',     'slabCount',    1, 10,  1,    'tex');
    slider('dividerOpacity','dividerOpacity',0, 1,  0.05, 'tex');

    hdr('— GRID SLAB —');
    slider('gridLineW',     'gridLineW',    0.5, 6,  0.5, 'tex');
    slider('gridCols',      'gridCols',     1,  12,  1,   'tex');
    slider('gridRows',      'gridRows',     1,  16,  1,   'tex');

    hdr('— VEIN SLAB —');
    colorPicker('veinColor',  'veinColor',  'tex');
    slider('veinCount',     'veinCount',    1,  20,  1,   'tex');
    slider('veinWidth',     'veinWidth',    0.5, 8,  0.5, 'tex');

    hdr('— BLOOM SLAB —');
    colorPicker('bloomColor', 'bloomColor', 'tex');
    slider('bloomRadius',   'bloomRadius',  0.1, 2,  0.05,'tex');
    slider('bloomOpacity',  'bloomOpacity', 0,   1,  0.05,'tex');

    hdr('— VEIN BLOOM —');
    slider('veinBloom',     'veinBloom',    0,   1,  0.05,'tex');

    hdr('— GRID GLOW —');
    slider('gridGlow',      'gridGlow',     0,   1,  0.05,'tex');

    hdr('— CLIFF STRATA —');
    slider('rimBright',     'strataRimBright',  0, 2,    0.05, 'tex');
    slider('rimCyan',       'strataRimCyan',    0, 1,    0.05, 'tex');
    slider('midTone',       'strataMidTone',    0, 1,    0.02, 'tex');
    slider('baseDark',      'strataBaseDark',   0, 0.5,  0.01, 'tex');
    slider('strataSplit',   'strataSplit',      0.1, 0.9, 0.02,'tex');
    slider('noiseAmt',      'strataNoiseAmt',   0, 0.3,  0.01, 'tex');

    hdr('— CORRIDOR CURVES —');
    slider('ampMax',        'corridorAmpMax',    0, 80, 1, 'geo');
    slider('ampStart',      'corridorAmpStart',  0, 40, 1, 'geo');
    slider('ampRamp (rows)','corridorAmpRamp',  20, 400, 5,'geo');

    hdr('— LIVE —');
    slider('scrollSpeed',   'scrollSpeed',  0, 3,   0.1,  'live');
    slider('tileLength',    'tileLength',   50, 400, 5,    'live');
    toggle('freeze wide',   'freezeWide');

    const btn = document.createElement('button');
    btn.textContent = 'REBUILD';
    btn.style.cssText = 'margin-top:10px;width:100%;background:#001a2a;border:1px solid #00eeff;color:#00eeff;padding:5px;cursor:pointer;font-family:monospace;font-size:11px;border-radius:2px;';
    btn.onclick = rebuildGeo;
    panel.appendChild(btn);
  }

  // Separate keydown listener — checks panelVisible flag, not _canyonActive
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'v' && e.key !== 'V') return;
    if (state.phase !== 'playing') return;
    // _canyonActive has already been toggled by the other V listener
    panelVisible = _canyonActive; // show when canyon is on, hide when off
    if (panelVisible) { buildPanel(); panel.style.display = 'block'; }
    else panel.style.display = 'none';
  });
})();

function updateDebug() {
  if (!dbgVisible) return;
  dbgFrames++;
  const now = performance.now();
  if (now - dbgLast >= 1000) {
    dbgFps = Math.round(dbgFrames * 1000 / (now - dbgLast));
    dbgFrames = 0;
    dbgLast = now;
    const info = renderer.info;
    dbgEl.textContent = [
      `FPS:${dbgFps}  Phase:${state.phase}`,
      `Draw:${info.render.calls}  Tri:${info.render.triangles}`,
      `Obs:${activeObstacles.length}  PU:${activePowerups.length}`,
      `Score:${state.score}  Lvl:${state.currentLevelIdx + 1}  Spd:${state.speed.toFixed(1)}`,
    ].join('\n');
  }
}

// ═══════════════════════════════════════════════════
//  RENDER LOOP
// ═══════════════════════════════════════════════════
// ─── DEBUG HITBOX HELPERS ────────────────────────────────────────────────────
const _dbgShipBox = (() => {
  const geo = new THREE.BoxGeometry(2.2, 2.2, 2.2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, depthTest: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 999;
  m.visible = false;
  scene.add(m);
  return m;
})();

const _dbgObsPool = [];
function _getDbgObsBox() {
  for (const b of _dbgObsPool) if (!b.visible) return b;
  const geo = new THREE.BoxGeometry(2.2, 2.2, 2.2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff2222, wireframe: true, depthTest: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 998;
  scene.add(m);
  _dbgObsPool.push(m);
  return m;
}

function updateDebugHitboxes() {
  // Hide all obs boxes first
  for (const b of _dbgObsPool) b.visible = false;

  if (!debugHitboxes || state.phase !== 'playing') {
    _dbgShipBox.visible = false;
    return;
  }

  // Ship box — colDist=1.55 so full span is 3.1 on X and Z
  _dbgShipBox.visible = true;
  _dbgShipBox.position.set(shipGroup.position.x, shipGroup.position.y, shipGroup.position.z);

  // Obstacle boxes
  for (const obs of activeObstacles) {
    const b = _getDbgObsBox();
    b.visible = true;
    b.position.copy(obs.position);
  }
}

// ── FPS counter (admin-only) ──
let _fpsOn = false, _fpsFrames = 0, _fpsLastTime = performance.now(), _lastDC = 0;
const _fpsEl = document.getElementById('fps-overlay');
(function setupFpsToggle() {
  const btn = document.getElementById('fps-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    _fpsOn = !_fpsOn;
    btn.setAttribute('aria-pressed', _fpsOn);
    btn.classList.toggle('on', _fpsOn);
    if (_fpsEl) _fpsEl.classList.toggle('hidden', !_fpsOn);
    _fpsFrames = 0; _fpsLastTime = performance.now();
  });
})();

function animate() {
  requestAnimationFrame(animate);
  // FPS + draw call measurement
  if (_fpsOn) {
    _fpsFrames++;
    const now = performance.now();
    if (now - _fpsLastTime >= 500) {
      const fps = Math.round(_fpsFrames / ((now - _fpsLastTime) / 1000));
      if (_fpsEl) _fpsEl.textContent = fps + ' FPS  ' + _lastDC + ' DC';
      _fpsFrames = 0; _fpsLastTime = now;
    }
  }
  const rawDt = Math.min(clock.getDelta(), 0.05);

  // ── TITLE SCREEN: render title scene only, skip all gameplay ──────
  if (state.phase === 'title') {
    // Rotate title ship slowly
    const pivot = titleScene.getObjectByName('titleShipPivot');
    const _spinDefault = window.innerWidth >= 1024 ? 0.001 : 0.004;
    const _spinRate = window._titleSpinSpeed !== undefined ? window._titleSpinSpeed : _spinDefault;
    if (pivot) pivot.rotation.y += _spinRate;

    // Handling upgrade pending → subtle cyan emissive glow pulse on title ship
    if (_titleShipModel && getPendingHandlingUpgrade()) {
      _titleGlowPhase += rawDt * 2.5;
      const pulse = 0.08 + 0.08 * Math.sin(_titleGlowPhase);
      for (const entry of _titleMeshMap) {
        if (entry.origName === 'fire' || entry.origName === 'fire1') continue;
        const mat = entry.mesh.material;
        if (mat && mat !== _titleDarkMat && mat.emissive) {
          // Store base intensity once, pulse relative to it
          if (mat.userData._baseEI === undefined) mat.userData._baseEI = mat.emissiveIntensity;
          mat.emissiveIntensity = mat.userData._baseEI + pulse;
        }
      }
    }

    _titleRenderer.render(titleScene, titleCamera);
    return;
  }



  // ── GAMEPLAY (playing / dead / paused) ────────────────────────
  accumulator += rawDt;
  while (accumulator >= FIXED_DT) {
    try { update(FIXED_DT); } catch(e) { console.error('update() threw:', e); }
    accumulator -= FIXED_DT;
  }

  // FOV scales with speed — most effective speed perception trick.
  // Lerps toward base+boost during gameplay, back to base on death/title.
  // Skip during retry sweep (sweep controls FOV directly)
  if (!_retrySweepActive) {
    const speedFrac = (state.phase === 'playing') ? Math.min(state.speed / 80, 1) : 0;
    let targetFOV = _baseFOV + _fovSpeedBoost * speedFrac;
    // Death zoom-out: push FOV wider during explosion (only during dead phase)
    if (_expDeathZoomActive && state.phase === 'dead') targetFOV = _expDeathZoomTarget;
    // Launch snap in first 0.5s, then moderate accel / gentle decel
    const fovDiff = targetFOV - camera.fov;
    const isLaunch = state.phase === 'playing' && (state.elapsed || 0) < 0.5;
    const fovLerpRate = isLaunch ? 12 : (_expDeathZoomActive ? 0.8 : (fovDiff > 0.5 ? 5 : 2));
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, fovLerpRate * rawDt);
    camera.updateProjectionMatrix();
  }

  // ── Tuner speed override (slider in scene tuner) ──
  if (_tunerSpeedOverride > 0) state.speed = _tunerSpeedOverride;

  // Water time tick — drives ripple animation
  mirrorMesh.material.uniforms.time.value += rawDt * 0.5;
  // Forward water flow — scroll normal map along Z proportional to speed
  if (state.phase === 'playing' && state.thrusterPower > 0 && !state.introActive) {
    const _wSpd = state.invincibleSpeedActive ? state.speed * 1.8 : state.speed;
    const _wSpdNorm = _wSpd / BASE_SPEED; // 1.0 at T1, 2.5 at T5c
    _waterFlowZ -= _wSpd * _wSpdNorm * rawDt * _waterFlowScale; // squared scaling
    _waterFlowZ %= 10000;
    mirrorMesh.material.uniforms.uFlowZ.value = _waterFlowZ;
  }
  // Sun surface churn
  if (sunMat && sunMat.uniforms) sunMat.uniforms.uTime.value += rawDt;
  // Twinkling sky stars — update uTime uniform each frame
  if (skyStarPoints)      skyStarPoints.material.uniforms.uTime.value      += rawDt;
  if (skyConstellLines)   skyConstellLines.material.uniforms.uTime.value   += rawDt;
  // Forcefield animation
  _ffUniforms.uTime.value += rawDt;
  // Keep water X in sync with ship so reflection doesn't drift
  mirrorMesh.position.x = state.shipX;

  updateAurora(rawDt);
  updateL5Flares(rawDt);
  updateWake(rawDt);
  renderer.info.reset();
  updateDebugHitboxes();

  // Keep all sun layers locked to ship X — sun is effectively at infinite distance
  // so lateral movement should never shift it on screen
  const _sunX = state.shipX || 0;
  sunMesh.position.x      = _sunX;
  sunCapMesh.position.x   = _sunX;
  sunGlowSprite.position.x = _sunX;
  sunRimGlow.position.x   = _sunX;
  const _camWP = camera.getWorldPosition(_sunBillboardV3);
  sunGlowSprite.lookAt(_camWP);
  sunCapMesh.lookAt(_camWP);

  // Fire meshes track thrusterPower every frame (no timing gaps)
  for (const fm of shipFireMeshes) fm.visible = state.thrusterPower > 0 && window._thrusterVisible !== false;
  // Tick alt ship animation mixer
  if (_altShipActive && _altShipMixer) _altShipMixer.update(rawDt);
  // ── Death sky pivot camera (runs in animate so it works during dead phase) ──
  if (_expCamOrbitActive && state.phase === 'dead') {
    _expCamOrbitT = Math.min(1, _expCamOrbitT + _EXP_CAM_ORBIT_SPEED * rawDt);
    const easeT = 1 - Math.pow(1 - _expCamOrbitT, 3);
    cameraPivot.position.y = THREE.MathUtils.lerp(_expCamAnchorY, _expCamAnchorY + _EXP_CAM_RISE, easeT);
    cameraPivot.position.z = THREE.MathUtils.lerp(_expCamAnchorZ, _expCamAnchorZ + _EXP_CAM_PULLBACK, easeT);
    const lateralDir = (_expCrashWorldPos.x >= 0) ? 1 : -1;
    cameraPivot.position.x = THREE.MathUtils.lerp(_expCamAnchorX, _expCamAnchorX + lateralDir * _EXP_CAM_LATERAL, easeT);
    camera.lookAt(_expCrashWorldPos.x, _expCrashWorldPos.y, _expCrashWorldPos.z - 2);
  }
  // Tick explosion particles + all VFX layers (runs during dead phase too)
  _updateExplosion(rawDt);
  _updateFlash(rawDt);
  _updateShockwave(rawDt);
  _updateSparks(rawDt);
  _updateFaceExplosion(rawDt);
  // ── Update localized heat haze pass (low poly only) ──
  {
    _thrusterHazePass.enabled = window._coneThrustersEnabled && state.phase === 'playing' && state.thrusterPower > 0.01;
    if (_thrusterHazePass.enabled) {
      const _hzProj = new THREE.Vector3();
      let _hazeValid = true;
      // Project left nozzle to screen UV
      const nwL = nozzleWorld(_localNozzles[0]);
      _hzProj.set(nwL.x, nwL.y, nwL.z).project(camera);
      if (_hzProj.z > 1 || _hzProj.z < -1) _hazeValid = false;
      _thrusterHazePass.uniforms.uNozzleL.value.set(_hzProj.x * 0.5 + 0.5, _hzProj.y * 0.5 + 0.5);
      // Project right nozzle to screen UV
      const nwR = nozzleWorld(_localNozzles[1]);
      _hzProj.set(nwR.x, nwR.y, nwR.z).project(camera);
      if (_hzProj.z > 1 || _hzProj.z < -1) _hazeValid = false;
      _thrusterHazePass.uniforms.uNozzleR.value.set(_hzProj.x * 0.5 + 0.5, _hzProj.y * 0.5 + 0.5);
      _thrusterHazePass.uniforms.uTime.value = performance.now() * 0.001;
      // Kill haze if nozzles aren't on screen
      _thrusterHazePass.uniforms.uIntensity.value = _hazeValid
        ? (window._hazeBaseIntensity != null ? window._hazeBaseIntensity : 0.10) * state.thrusterPower
        : 0.0;
      _thrusterHazePass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
    }
  }
  composer.render();
  if (_fpsOn) _lastDC = renderer.info.render.calls;
  updateDebug();
}

// ═══════════════════════════════════════════════════
//  RESIZE
// ═══════════════════════════════════════════════════
function updateCameraFOV() {
  const isMobile = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const isLandscape = window.innerWidth > window.innerHeight;
  if (isMobile && isLandscape) {
    // ── Mobile landscape settings (baked from tuner) ──
    _baseFOV = 60;
    camera.fov = 60;
    _camLookYOffset = -5.00;
    _camLookZOffset = 2.00;
    _camPivotYOffset = 0.90;
    _camPivotZOffset = -0.80;
    shipGroup.scale.setScalar(0.40);
    _skyQuadMat.uniforms.uOffsetY.value = -0.16;
  } else if (isMobile && !isLandscape) {
    // ── Mobile portrait settings (baked from tuner) ──
    _baseFOV = 79;
    camera.fov = 79;
    _camLookYOffset = -5.00;
    _camLookZOffset = 0.50;
    _camPivotYOffset = 0.00;
    _camPivotZOffset = -1.80;
    shipGroup.scale.setScalar(0.30);
    _skyQuadMat.uniforms.uOffsetY.value = -0.16;
  } else {
    // ── Desktop settings (baked from tuner) ──
    _baseFOV = 65 + _camFOVOffset;
    camera.fov = _baseFOV;
    _camPivotZOffset = -1.50;
    _skyQuadMat.uniforms.uOffsetY.value = -0.24;
  }
  // Apply pivot offsets immediately (not just in animate loop)
  // X must be zeroed here — if a resize fires mid-gameplay the animate loop
  // will restore it to shipX on the next frame, but lookAt must be computed
  // from a centered pivot or the camera angle drifts permanently.
  cameraPivot.position.x = (state && state.phase === 'playing') ? (camTargetX || 0) : 0;
  cameraPivot.position.y = 2.8 + _camPivotYOffset;
  cameraPivot.position.z = 9 + _camPivotZOffset;
  camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + _camLookZOffset));
  _applyOrientationNozzles(); // swap portrait/landscape nozzles if applicable
  _rebuildLocalNozzles();
  camera.updateProjectionMatrix();
}

function _doResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Gameplay camera
  camera.aspect = w / h;
  updateCameraFOV();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(Math.floor(w / 2), Math.floor(h / 2));
  reflectRT.setSize(Math.floor(w * 0.5), Math.floor(h * 0.5));
  mirrorCamera.aspect = w / h;
  mirrorCamera.updateProjectionMatrix();
}
let _resizeTimer = 0;
window.addEventListener('resize', () => {
  _doResize();
  // iOS Safari fires resize before rotation animation finishes —
  // re-measure after a short delay to catch the final dimensions
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(_doResize, 150);
});

// ═══════════════════════════════════════════════════
//  TESTING HOOKS
// ═══════════════════════════════════════════════════
window.render_game_to_text = () => JSON.stringify({
  phase: state.phase,
  score: state.score,
  level: state.currentLevelIdx + 1,
  speed: +state.speed.toFixed(2),
  shipX: +state.shipX.toFixed(2),
  obstacles: activeObstacles.length,
  powerups: activePowerups.length,
  shield: state.shieldActive,
  laser: state.laserActive,
  multiplier: state.multiplier,
});

window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i++) update(FIXED_DT);
  renderer.info.reset();
  composer.render();
};


// ═══════════════════════════════════════════════════
//  VISIBILITY CHANGE — auto-pause when app loses focus (mobile)
// ═══════════════════════════════════════════════════
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause all audio immediately regardless of game state
    const tracks = allTracks();
    Object.values(tracks).forEach(el => { if (el && !el.paused) el.pause(); });
    const _engV = document.getElementById('engine-start');
    if (_engV && !_engV.paused) _engV.pause();
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => {});
    // If actively playing, trigger a proper game pause
    if (state.phase === 'playing') {
      togglePause();
    }
  } else {
    // Tab/app regained focus — resume AudioContext so sounds work again
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    // Restore audio for the current screen
    if (!state.muted) {
      if (state.phase === 'title' || state.phase === 'dead' || state.phase === 'paused') {
        // Title/gameover/paused all play title music
        if (titleMusic) titleMusic.play().catch(() => {});
      }
      // Paused: also resume lake ambience (was playing during gameplay)
      if (state.phase === 'paused' && lakeMusic) lakeMusic.play().catch(() => {});
    }
  }
});

// ═══════════════════════════════════════════════════
//  MOBILE TITLE SCREEN — swap SPACE button for TAP TO PLAY
// ═══════════════════════════════════════════════════
(function mobileTitleSetup() {
  const isMobile = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  if (!isMobile) return;
  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.textContent = 'CAMPAIGN';
})();

// ── Init
applyLevelVisuals(LEVELS[0]);
applySkin(loadSkinData().selected); // re-apply skin lighting after level visuals
applyTitleSkin(loadSkinData().selected);
updateTitleBadges();
updateCameraFOV(); // set correct FOV on load (mobile landscape)
clock.start();
animate();
// iOS Safari: viewport may not be settled on first paint (address bar, safe area).
// Re-run camera FOV + renderer sizing only while still on title screen.
setTimeout(() => { if (state.phase === 'title') { _doResize(); } }, 300);
setTimeout(() => { if (state.phase === 'title') { _doResize(); } }, 800);

// deploy nudge

// ═══════════════════════════════════════════════════
//  SKIN TUNER — live material property sliders
// ═══════════════════════════════════════════════════

let _skinTunerOpen = false;
let _tunerSavedShipPos = null;
let _tunerSavedShipRot = null;
let _tunerSavedCamPivot = null;
let _tunerSavedCamPos = null;


function toggleSkinTuner() {
  _skinTunerOpen = !_skinTunerOpen;
  document.getElementById('skin-tuner').style.display = _skinTunerOpen ? 'block' : 'none';
  if (_skinTunerOpen) {
    // Save ship + camera state
    _tunerSavedShipPos = shipGroup.position.clone();
    _tunerSavedShipRot = shipGroup.rotation.clone();
    _tunerSavedCamPivot = cameraPivot.position.clone();
    _tunerSavedCamPos = camera.position.clone();

    // Position ship right in front of camera, centered, facing camera (no spin)
    cameraPivot.position.set(0, 2.8, 9);
    camera.position.set(0, 0, 0);
    shipGroup.position.set(0, 1.8, 4.5);
    shipGroup.rotation.set(0, Math.PI, 0);

    // Hide the entire title-screen overlay so the 3D canvas is fully visible
    const titleEl = document.getElementById('title-screen');
    if (titleEl) titleEl.style.display = 'none';

    // Orbit drag — click & drag on canvas to rotate ship
    if (!window._tunerDragBound) {
      window._tunerDragBound = true;
      let dragging = false, lastX = 0, lastY = 0;
      renderer.domElement.addEventListener('pointerdown', e => {
        if (!_skinTunerOpen) return;
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        renderer.domElement.setPointerCapture(e.pointerId);
      });
      renderer.domElement.addEventListener('pointermove', e => {
        if (!_skinTunerOpen || !dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        shipGroup.rotation.y += dx * 0.01;
        shipGroup.rotation.x += dy * 0.01;
        lastX = e.clientX; lastY = e.clientY;
      });
      renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
    }

    buildSkinTunerSliders();
  } else {
    // Restore ship + camera
    if (_tunerSavedShipPos) shipGroup.position.copy(_tunerSavedShipPos);
    if (_tunerSavedShipRot) shipGroup.rotation.copy(_tunerSavedShipRot);
    if (_tunerSavedCamPivot) cameraPivot.position.copy(_tunerSavedCamPivot);
    if (_tunerSavedCamPos) camera.position.copy(_tunerSavedCamPos);

    // Restore title screen
    const titleEl = document.getElementById('title-screen');
    if (titleEl) titleEl.style.display = '';
  }
}
window.toggleSkinTuner = toggleSkinTuner;

// Show tuner button when admin mode activates
const _origAdminToggle = document.getElementById('skin-viewer-label');
if (_origAdminToggle) {
  const origClick = _origAdminToggle.onclick;
  // MutationObserver on the label color to detect admin mode
  new MutationObserver(() => {
    document.getElementById('skin-tuner-btn').style.display = _skinAdminMode ? 'block' : 'none';
  }).observe(_origAdminToggle, { attributes: true, attributeFilter: ['style'] });
}

function buildSkinTunerSliders() {
  const container = document.getElementById('skin-tuner-sliders');
  container.innerHTML = '';
  const skinName = SHIP_SKINS[skinViewerIdx] ? SHIP_SKINS[skinViewerIdx].name : 'Unknown';
  document.getElementById('skin-tuner-current').textContent = 'Skin: ' + skinName + ' (#' + skinViewerIdx + ')';

  if (!window._shipModel) { container.textContent = 'Ship not loaded'; return; }

  // ── Collect meshes by group ──
  const GROUPS = [
    { label: 'HULL',      parts: ['rocket_base', 'gray'], color: '#0f8' },
    { label: 'TRIM',      parts: ['white'],               color: '#0cf' },
    { label: 'NOZZLE',    parts: ['nozzle'],               color: '#f80' },
    { label: 'THRUSTERS', parts: ['rocket_light'],         color: '#f0f' },
  ];

  const allMeshes = [];
  window._shipModel.traverse(child => {
    if (!child.isMesh) return;
    const name = child.userData._origMatName || child.name || 'unnamed';
    if (name === 'fire' || name === 'fire1') return;
    allMeshes.push({ name, mesh: child });
  });

  // ── Helper: create slider row ──
  function makeSlider(label, val, min, max, step, onChange, accentColor) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'width:120px;flex-shrink:0;font-size:11px;';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step;
    slider.value = val;
    slider.style.cssText = 'flex:1;height:14px;cursor:pointer;accent-color:' + (accentColor || '#0af') + ';';
    const valSpan = document.createElement('span');
    valSpan.textContent = Number(val).toFixed(step < 0.1 ? 2 : 1);
    valSpan.style.cssText = 'width:42px;text-align:right;font-size:10px;';
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valSpan.textContent = Number(v).toFixed(step < 0.1 ? 2 : 1);
      onChange(v);
    });
    row.appendChild(lbl); row.appendChild(slider); row.appendChild(valSpan);
    return row;
  }

  // ── Helper: HSL from THREE.Color ──
  function getHSL(color) {
    const hsl = {};
    color.getHSL(hsl);
    return hsl;
  }

  // No extra tuner spotlight — use actual scene lighting so preview matches L1

  // ── PER-GROUP CONTROLS ──
  GROUPS.forEach(group => {
    const mats = [];
    allMeshes.forEach(({ name, mesh }) => {
      if (group.parts.includes(name) && mesh.material) mats.push(mesh.material);
    });
    if (!mats.length) return;

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px;border-bottom:1px solid #333;padding-bottom:10px;';

    const header = document.createElement('div');
    header.style.cssText = 'font-weight:bold;color:' + group.color + ';margin-bottom:6px;font-size:13px;';
    header.textContent = group.label;
    section.appendChild(header);

    // Get average HSL from the group's base colors
    const avgHSL = { h: 0, s: 0, l: 0 };
    let count = 0;
    mats.forEach(m => {
      if (m.color) {
        const hsl = getHSL(m.color);
        avgHSL.h += hsl.h; avgHSL.s += hsl.s; avgHSL.l += hsl.l;
        count++;
      }
    });
    if (count) { avgHSL.h /= count; avgHSL.s /= count; avgHSL.l /= count; }

    // 1) HUE slider — sweep through full color spectrum
    section.appendChild(makeSlider('Hue', avgHSL.h, 0, 1, 0.005, v => {
      mats.forEach(m => {
        if (!m.color) return;
        const hsl = getHSL(m.color);
        m.color.setHSL(v, hsl.s, hsl.l);
      });
    }, group.color));

    // 2) SATURATION
    section.appendChild(makeSlider('Saturation', avgHSL.s, 0, 1, 0.01, v => {
      mats.forEach(m => {
        if (!m.color) return;
        const hsl = getHSL(m.color);
        m.color.setHSL(hsl.h, v, hsl.l);
      });
    }, group.color));

    // 3) BRIGHTNESS (lightness)
    section.appendChild(makeSlider('Brightness', avgHSL.l, 0, 1, 0.01, v => {
      mats.forEach(m => {
        if (!m.color) return;
        const hsl = getHSL(m.color);
        m.color.setHSL(hsl.h, hsl.s, v);
      });
    }, group.color));

    // 4) EMISSIVE GLOW — color + intensity combo
    if (mats.some(m => m.emissive !== undefined)) {
      const firstE = mats.find(m => m.emissive);
      const eHSL = firstE ? getHSL(firstE.emissive) : { h: 0, s: 1, l: 0.5 };
      const eInt = firstE ? (firstE.emissiveIntensity || 0) : 0;

      section.appendChild(makeSlider('Glow Hue', eHSL.h, 0, 1, 0.005, v => {
        mats.forEach(m => {
          if (!m.emissive) return;
          const hsl = getHSL(m.emissive);
          m.emissive.setHSL(v, Math.max(hsl.s, 0.8), Math.max(hsl.l, 0.5));
        });
      }, '#ff0'));

      section.appendChild(makeSlider('Glow Power', eInt, 0, 20, 0.1, v => {
        mats.forEach(m => {
          if (m.emissiveIntensity !== undefined) m.emissiveIntensity = v;
          // If glow was off, set a default emissive color
          if (v > 0 && m.emissive && m.emissive.getHex() === 0) {
            m.emissive.setHSL(0.6, 1, 0.5);
          }
        });
      }, '#ff0'));
    }

    // 5) FRESNEL RIM GLOW — inject via onBeforeCompile for real-time rim lighting
    // Instead of shader injection (would break existing compiled shaders), use emissive trick:
    // We add a "rim intensity" that brightens edges. Simulated by increasing emissive when metalness is set.
    // More practical: just expose metalness as "Reflectivity" since scene has good lighting
    const avgMet = mats.reduce((s, m) => s + (m.metalness || 0), 0) / mats.length;
    section.appendChild(makeSlider('Reflectivity', avgMet, 0, 1, 0.01, v => {
      mats.forEach(m => { if (m.metalness !== undefined) { m.metalness = v; m.needsUpdate = true; } });
    }, group.color));

    // 6) GLOSSINESS (inverse of roughness — more intuitive)
    const avgGloss = 1.0 - (mats.reduce((s, m) => s + (m.roughness || 0.5), 0) / mats.length);
    section.appendChild(makeSlider('Glossiness', avgGloss, 0, 1, 0.01, v => {
      mats.forEach(m => { if (m.roughness !== undefined) { m.roughness = 1.0 - v; m.needsUpdate = true; } });
    }, group.color));

    container.appendChild(section);
  });

  // ═══════════════════════════════════════════════════
  //  GLOBAL FINISH + WEIRD FX (all skins)
  // ═══════════════════════════════════════════════════
  {
    const finishHeader = document.createElement('div');
    finishHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#aaf;margin:16px 0 8px;border-top:2px solid #aaf;padding-top:8px;';
    finishHeader.textContent = 'GLOBAL FINISH';
    container.appendChild(finishHeader);

    // Collect ALL ship materials
    const allShipMats = [];
    allMeshes.forEach(({ mesh }) => { if (mesh.material) allShipMats.push(mesh.material); });

    // MATTE slider — overrides roughness on everything
    container.appendChild(makeSlider('Matte', 0, 0, 1, 0.01, v => {
      allShipMats.forEach(m => {
        if (m.roughness !== undefined) { m.roughness = v; m.needsUpdate = true; }
      });
    }, '#aaf'));

    // ── WEIRD FX ──
    const weirdHeader = document.createElement('div');
    weirdHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#f0f;margin:16px 0 8px;border-top:2px solid #f0f;padding-top:8px;';
    weirdHeader.textContent = 'WEIRD FX';
    container.appendChild(weirdHeader);

    // 1) Fresnel Rim Glow — add emissive at grazing angles
    if (!window._fresnelPass) {
      const fs = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 }, color: { value: new THREE.Vector3(0.2, 0.6, 1.0) } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;uniform vec3 color;
          varying vec2 vUv;
          void main(){
            vec4 c=texture2D(tDiffuse,vUv);
            float lum=dot(c.rgb,vec3(0.299,0.587,0.114));
            vec2 uvc=vUv*2.0-1.0;
            float edge=length(uvc);
            float rim=smoothstep(0.3,1.0,edge);
            c.rgb+=color*rim*intensity;
            gl_FragColor=c;
          }`,
      };
      window._fresnelPass = new ShaderPass(fs);
      window._fresnelPass.enabled = false;
      composer.addPass(window._fresnelPass);
    }

    // 2) Holographic / Iridescence — hue shift based on screen position
    if (!window._holoPass) {
      const hs = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 }, time: { value: 0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;uniform float time;
          varying vec2 vUv;
          vec3 hueRot(vec3 c,float h){float a=h*6.28318;vec3 k=vec3(0.57735);float ca=cos(a);float sa=sin(a);return c*ca+cross(k,c)*sa+k*dot(k,c)*(1.0-ca);}
          void main(){
            vec4 c=texture2D(tDiffuse,vUv);
            float lum=dot(c.rgb,vec3(0.299,0.587,0.114));
            if(lum>0.05){
              float shift=vUv.x*0.5+vUv.y*0.3+time*0.1;
              c.rgb=mix(c.rgb,hueRot(c.rgb,fract(shift)),intensity);
            }
            gl_FragColor=c;
          }`,
      };
      window._holoPass = new ShaderPass(hs);
      window._holoPass.enabled = false;
      composer.addPass(window._holoPass);
    }

    // 3) Pulse / Breathe — sinusoidal brightness oscillation
    if (!window._pulsePass) {
      const ps = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 }, speed: { value: 2.0 }, time: { value: 0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;uniform float speed;uniform float time;
          varying vec2 vUv;
          void main(){
            vec4 c=texture2D(tDiffuse,vUv);
            float pulse=sin(time*speed)*0.5+0.5;
            c.rgb*=1.0+pulse*intensity;
            gl_FragColor=c;
          }`,
      };
      window._pulsePass = new ShaderPass(ps);
      window._pulsePass.enabled = false;
      composer.addPass(window._pulsePass);
    }

    // 4) Negative / Invert
    if (!window._invertPass) {
      const is = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;
          varying vec2 vUv;
          void main(){
            vec4 c=texture2D(tDiffuse,vUv);
            vec3 inv=1.0-c.rgb;
            c.rgb=mix(c.rgb,inv,intensity);
            gl_FragColor=c;
          }`,
      };
      window._invertPass = new ShaderPass(is);
      window._invertPass.enabled = false;
      composer.addPass(window._invertPass);
    }

    // 5) RGB Split / Glitch
    if (!window._rgbSplitPass) {
      const rs = {
        uniforms: { tDiffuse: { value: null }, amount: { value: 0.0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float amount;
          varying vec2 vUv;
          void main(){
            float o=amount;
            vec4 cr=texture2D(tDiffuse,vec2(vUv.x+o,vUv.y));
            vec4 cg=texture2D(tDiffuse,vUv);
            vec4 cb=texture2D(tDiffuse,vec2(vUv.x-o,vUv.y));
            gl_FragColor=vec4(cr.r,cg.g,cb.b,1.0);
          }`,
      };
      window._rgbSplitPass = new ShaderPass(rs);
      window._rgbSplitPass.enabled = false;
      composer.addPass(window._rgbSplitPass);
    }

    // 6) Pixelate
    if (!window._pixelPass) {
      const px = {
        uniforms: { tDiffuse: { value: null }, pixels: { value: 0.0 }, resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float pixels;uniform vec2 resolution;
          varying vec2 vUv;
          void main(){
            if(pixels<=0.0){gl_FragColor=texture2D(tDiffuse,vUv);return;}
            float px=pixels*resolution.x/800.0;
            vec2 d=vec2(px)/resolution;
            vec2 uv=d*floor(vUv/d)+d*0.5;
            gl_FragColor=texture2D(tDiffuse,uv);
          }`,
      };
      window._pixelPass = new ShaderPass(px);
      window._pixelPass.enabled = false;
      composer.addPass(window._pixelPass);
    }

    // 7) Noise Grit / Battle-worn — adds noisy darkening
    if (!window._gritPass) {
      const gp = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 }, scale: { value: 200.0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;uniform float scale;
          varying vec2 vUv;
          float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
          float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
          void main(){
            vec4 c=texture2D(tDiffuse,vUv);
            float n=noise(vUv*scale);
            float wear=1.0-intensity*n*0.7;
            float scratch=noise(vUv*scale*3.0+vec2(17.3,91.7));
            wear-=step(0.92,scratch)*intensity*0.3;
            c.rgb*=max(wear,0.0);
            gl_FragColor=c;
          }`,
      };
      window._gritPass = new ShaderPass(gp);
      window._gritPass.enabled = false;
      composer.addPass(window._gritPass);
    }

    // 8) Heat Warp — wavy distortion like heat shimmer
    if (!window._heatPass) {
      const hp = {
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.0 }, time: { value: 0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse;uniform float intensity;uniform float time;
          varying vec2 vUv;
          void main(){
            vec2 uv=vUv;
            uv.x+=sin(uv.y*20.0+time*3.0)*intensity*0.01;
            uv.y+=cos(uv.x*15.0+time*2.5)*intensity*0.008;
            gl_FragColor=texture2D(tDiffuse,uv);
          }`,
      };
      window._heatPass = new ShaderPass(hp);
      window._heatPass.enabled = false;
      composer.addPass(window._heatPass);
    }

    // Tick time for animated passes
    if (!window._weirdFxTickAdded) {
      window._weirdFxTickAdded = true;
      const _origRender2 = composer.render.bind(composer);
      composer.render = function() {
        const t = performance.now() * 0.001;
        if (window._holoPass && window._holoPass.enabled) window._holoPass.uniforms.time.value = t;
        if (window._pulsePass && window._pulsePass.enabled) window._pulsePass.uniforms.time.value = t;
        if (window._heatPass && window._heatPass.enabled) window._heatPass.uniforms.time.value = t;
        _origRender2();
      };
    }

    const WEIRD_FX = [
      { label: 'Rim Glow',     pass: window._fresnelPass,  uniform: 'intensity', min: 0, max: 3,    step: 0.05 },
      { label: 'Holographic',   pass: window._holoPass,     uniform: 'intensity', min: 0, max: 1,    step: 0.01 },
      { label: 'Pulse',         pass: window._pulsePass,    uniform: 'intensity', min: 0, max: 2,    step: 0.05 },
      { label: 'Negative',      pass: window._invertPass,   uniform: 'intensity', min: 0, max: 1,    step: 0.01 },
      { label: 'RGB Split',     pass: window._rgbSplitPass, uniform: 'amount',    min: 0, max: 0.05, step: 0.001 },
      { label: 'Pixelate',      pass: window._pixelPass,    uniform: 'pixels',    min: 0, max: 20,   step: 0.5 },
      { label: 'Battle Worn',   pass: window._gritPass,     uniform: 'intensity', min: 0, max: 2,    step: 0.05 },
      { label: 'Heat Warp',     pass: window._heatPass,     uniform: 'intensity', min: 0, max: 3,    step: 0.05 },
    ];

    WEIRD_FX.forEach(fx => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox'; toggle.checked = fx.pass.enabled;
      toggle.style.cssText = 'margin:0;cursor:pointer;accent-color:#f0f;';
      const label = document.createElement('span');
      label.textContent = fx.label;
      label.style.cssText = 'width:90px;flex-shrink:0;';
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = fx.min; slider.max = fx.max; slider.step = fx.step;
      slider.value = fx.pass.uniforms[fx.uniform].value;
      slider.style.cssText = 'flex:1;height:14px;cursor:pointer;accent-color:#f0f;';
      const valSpan = document.createElement('span');
      valSpan.textContent = Number(fx.pass.uniforms[fx.uniform].value).toFixed(3);
      valSpan.style.cssText = 'width:45px;text-align:right;font-size:10px;';
      toggle.addEventListener('change', () => { fx.pass.enabled = toggle.checked; });
      slider.addEventListener('input', () => {
        fx.pass.uniforms[fx.uniform].value = parseFloat(slider.value);
        valSpan.textContent = Number(slider.value).toFixed(3);
        if (parseFloat(slider.value) > 0 && !toggle.checked) { toggle.checked = true; fx.pass.enabled = true; }
      });
      row.appendChild(toggle); row.appendChild(label); row.appendChild(slider); row.appendChild(valSpan);
      container.appendChild(row);
    });
  }

  // ═══════════════════════════════════════════════════
  //  SHIP LIGHTING
  // ═══════════════════════════════════════════════════
  {
    const lightHeader = document.createElement('div');
    lightHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#ff8;margin:16px 0 8px;border-top:2px solid #ff8;padding-top:8px;';
    lightHeader.textContent = 'SHIP LIGHTING';
    container.appendChild(lightHeader);

    // Key Light
    const keyLabel = document.createElement('div');
    keyLabel.style.cssText = 'font-size:11px;font-weight:bold;color:#ff8;margin:8px 0 4px;';
    keyLabel.textContent = 'Key Light';
    container.appendChild(keyLabel);

    container.appendChild(makeSlider('Intensity', _shipKeyLight.intensity, 0, 6, 0.1, v => { _shipKeyLight.intensity = v; }, '#ff8'));
    container.appendChild(makeSlider('X', _shipKeyLight.position.x, -10, 10, 0.5, v => { _shipKeyLight.position.x = v; }, '#ff8'));
    container.appendChild(makeSlider('Y', _shipKeyLight.position.y, -10, 10, 0.5, v => { _shipKeyLight.position.y = v; }, '#ff8'));
    container.appendChild(makeSlider('Z', _shipKeyLight.position.z, -10, 10, 0.5, v => { _shipKeyLight.position.z = v; }, '#ff8'));

    // Key light color hue
    const kCol = _shipKeyLight.color;
    const kHSL = {}; kCol.getHSL(kHSL);
    container.appendChild(makeSlider('Hue', kHSL.h, 0, 1, 0.005, v => {
      const h = {}; kCol.getHSL(h);
      kCol.setHSL(v, h.s, h.l);
    }, '#ff8'));
    container.appendChild(makeSlider('Saturation', kHSL.s, 0, 1, 0.01, v => {
      const h = {}; kCol.getHSL(h);
      kCol.setHSL(h.h, v, h.l);
    }, '#ff8'));

    // Fill Light
    const fillLabel = document.createElement('div');
    fillLabel.style.cssText = 'font-size:11px;font-weight:bold;color:#8bf;margin:12px 0 4px;';
    fillLabel.textContent = 'Fill Light';
    container.appendChild(fillLabel);

    container.appendChild(makeSlider('Intensity', _shipFillLight.intensity, 0, 4, 0.1, v => { _shipFillLight.intensity = v; }, '#8bf'));
    container.appendChild(makeSlider('X', _shipFillLight.position.x, -10, 10, 0.5, v => { _shipFillLight.position.x = v; }, '#8bf'));
    container.appendChild(makeSlider('Y', _shipFillLight.position.y, -10, 10, 0.5, v => { _shipFillLight.position.y = v; }, '#8bf'));
    container.appendChild(makeSlider('Z', _shipFillLight.position.z, -10, 10, 0.5, v => { _shipFillLight.position.z = v; }, '#8bf'));

    // Fill light color hue
    const fCol = _shipFillLight.color;
    const fHSL = {}; fCol.getHSL(fHSL);
    container.appendChild(makeSlider('Hue', fHSL.h, 0, 1, 0.005, v => {
      const h = {}; fCol.getHSL(h);
      fCol.setHSL(v, h.s, h.l);
    }, '#8bf'));
    container.appendChild(makeSlider('Saturation', fHSL.s, 0, 1, 0.01, v => {
      const h = {}; fCol.getHSL(h);
      fCol.setHSL(h.h, v, h.l);
    }, '#8bf'));
  }

  // ═══════════════════════════════════════════════════
  //  SHADER PATTERN CONTROLS (skin-specific)
  // ═══════════════════════════════════════════════════
  if (window._diamondUniforms && skinViewerIdx === 2) {
    const shaderHeader = document.createElement('div');
    shaderHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#0ff;margin:16px 0 8px;border-top:2px solid #0ff;padding-top:8px;';
    shaderHeader.textContent = 'DIAMOND PLATE SHADER';
    container.appendChild(shaderHeader);

    const du = window._diamondUniforms;

    container.appendChild(makeSlider('Pattern Scale', du.dScale.value, 0.5, 10, 0.1, v => { du.dScale.value = v; }, '#0ff'));
    container.appendChild(makeSlider('Bump Depth', du.dBump.value, 0, 3, 0.05, v => { du.dBump.value = v; }, '#0ff'));
    container.appendChild(makeSlider('Edge Sharpness', du.dEdgeMin.value, 0.05, 0.45, 0.01, v => { du.dEdgeMin.value = v; }, '#0ff'));
    container.appendChild(makeSlider('Edge Width', du.dEdgeMax.value, 0.2, 0.8, 0.01, v => { du.dEdgeMax.value = v; }, '#0ff'));

    const glowSubheader = document.createElement('div');
    glowSubheader.style.cssText = 'font-size:11px;font-weight:bold;color:#0ff;margin:8px 0 4px;';
    glowSubheader.textContent = 'Seam Glow';
    container.appendChild(glowSubheader);

    // Glow color as HSL hue for easy sweeping
    const glowCol = new THREE.Color(du.dGlowR.value, du.dGlowG.value, du.dGlowB.value);
    const glowHSL = {};
    glowCol.getHSL(glowHSL);

    container.appendChild(makeSlider('Glow Hue', glowHSL.h, 0, 1, 0.005, v => {
      const c = new THREE.Color();
      c.setHSL(v, 1.0, 0.6);
      du.dGlowR.value = c.r; du.dGlowG.value = c.g; du.dGlowB.value = c.b;
    }, '#0ff'));

    container.appendChild(makeSlider('Glow Intensity', du.dGlowMul.value, 0, 10, 0.1, v => { du.dGlowMul.value = v; }, '#0ff'));
    container.appendChild(makeSlider('Glow Tightness', du.dGlowEdgeMin.value, 0.1, 0.49, 0.01, v => { du.dGlowEdgeMin.value = v; }, '#0ff'));
  }

  // ═══════════════════════════════════════════════════
  //  SCENE LIGHTING CONTROLS
  // ═══════════════════════════════════════════════════
  const lightHeader = document.createElement('div');
  lightHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#ff0;margin:16px 0 8px;border-top:2px solid #ff0;padding-top:8px;';
  lightHeader.textContent = 'SCENE LIGHTING';
  container.appendChild(lightHeader);

  // Key light intensity
  container.appendChild(makeSlider('Key Light', dirLight.intensity, 0, 5, 0.05, v => {
    dirLight.intensity = v;
  }, '#ff0'));

  // Ambient intensity
  container.appendChild(makeSlider('Ambient', ambientLight.intensity, 0, 1, 0.01, v => {
    ambientLight.intensity = v;
  }, '#ff0'));

  // Exposure
  container.appendChild(makeSlider('Exposure', renderer.toneMappingExposure, 0.1, 3, 0.01, v => {
    renderer.toneMappingExposure = v;
  }, '#ff0'));

  // ═══════════════════════════════════════════════════
  //  POST-PROCESSING FX (kept from before)
  // ═══════════════════════════════════════════════════
  const fxHeader = document.createElement('div');
  fxHeader.style.cssText = 'font-size:14px;font-weight:bold;color:#f80;margin:16px 0 8px;border-top:2px solid #f80;padding-top:8px;';
  fxHeader.textContent = 'POST-PROCESSING FX';
  container.appendChild(fxHeader);

  container.appendChild(makeSlider('Bloom', bloom.strength, 0, 3, 0.01, v => { bloom.strength = v; }, '#f80'));
  container.appendChild(makeSlider('Bloom Radius', bloom.radius, 0, 1, 0.01, v => { bloom.radius = v; }, '#f80'));
  container.appendChild(makeSlider('Vignette', vignettePass.uniforms.darkness.value, 0, 2, 0.01, v => { vignettePass.uniforms.darkness.value = v; }, '#f80'));
  container.appendChild(makeSlider('Chromatic Aberr.', vignettePass.uniforms.aberration.value, 0, 0.02, 0.0001, v => { vignettePass.uniforms.aberration.value = v; }, '#f80'));

  // ── EXTRA TOGGLEABLE FX ──
  const extraHeader = document.createElement('div');
  extraHeader.style.cssText = 'font-size:12px;font-weight:bold;color:#f80;margin:12px 0 6px;';
  extraHeader.textContent = 'EXTRA EFFECTS (toggle + intensity)';
  container.appendChild(extraHeader);

  // Film Grain pass
  if (!window._grainPass) {
    const gs = {
      uniforms: { tDiffuse: { value: null }, amount: { value: 0.0 }, time: { value: 0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tDiffuse;uniform float amount;uniform float time;varying vec2 vUv;float rand(vec2 co){return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453);}void main(){vec4 c=texture2D(tDiffuse,vUv);float n=rand(vUv*time)*2.0-1.0;c.rgb+=n*amount;gl_FragColor=c;}',
    };
    window._grainPass = new ShaderPass(gs);
    window._grainPass.enabled = false;
    composer.addPass(window._grainPass);
  }
  // Scanlines pass
  if (!window._scanPass) {
    const ss = {
      uniforms: { tDiffuse: { value: null }, count: { value: 400 }, intensity: { value: 0.0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tDiffuse;uniform float count;uniform float intensity;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);float s=sin(vUv.y*count*3.14159)*0.5+0.5;c.rgb=mix(c.rgb,c.rgb*s,intensity);gl_FragColor=c;}',
    };
    window._scanPass = new ShaderPass(ss);
    window._scanPass.enabled = false;
    composer.addPass(window._scanPass);
  }
  // Hue Shift pass
  if (!window._huePass) {
    const hs = {
      uniforms: { tDiffuse: { value: null }, shift: { value: 0.0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tDiffuse;uniform float shift;varying vec2 vUv;vec3 hueRot(vec3 c,float h){float a=h*6.28318;vec3 k=vec3(0.57735);float ca=cos(a);float sa=sin(a);return c*ca+cross(k,c)*sa+k*dot(k,c)*(1.0-ca);}void main(){vec4 c=texture2D(tDiffuse,vUv);c.rgb=hueRot(c.rgb,shift);gl_FragColor=c;}',
    };
    window._huePass = new ShaderPass(hs);
    window._huePass.enabled = false;
    composer.addPass(window._huePass);
  }

  // Tick grain time
  if (!window._grainTickAdded) {
    window._grainTickAdded = true;
    const _origRender = composer.render.bind(composer);
    composer.render = function() {
      if (window._grainPass && window._grainPass.enabled)
        window._grainPass.uniforms.time.value = performance.now() * 0.001;
      _origRender();
    };
  }

  const EXTRA_FX = [
    { label: 'Film Grain',  pass: window._grainPass, uniform: 'amount',    min: 0, max: 0.3, step: 0.005 },
    { label: 'Scanlines',   pass: window._scanPass,  uniform: 'intensity', min: 0, max: 1,   step: 0.01  },
    { label: 'Hue Shift',   pass: window._huePass,   uniform: 'shift',     min: 0, max: 1,   step: 0.01  },
  ];

  EXTRA_FX.forEach(fx => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox'; toggle.checked = fx.pass.enabled;
    toggle.style.cssText = 'margin:0;cursor:pointer;accent-color:#f80;';
    const label = document.createElement('span');
    label.textContent = fx.label;
    label.style.cssText = 'width:90px;flex-shrink:0;';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = fx.min; slider.max = fx.max; slider.step = fx.step;
    slider.value = fx.pass.uniforms[fx.uniform].value;
    slider.style.cssText = 'flex:1;height:14px;cursor:pointer;accent-color:#f80;';
    const valSpan = document.createElement('span');
    valSpan.textContent = Number(fx.pass.uniforms[fx.uniform].value).toFixed(3);
    valSpan.style.cssText = 'width:45px;text-align:right;font-size:10px;';
    toggle.addEventListener('change', () => { fx.pass.enabled = toggle.checked; });
    slider.addEventListener('input', () => {
      fx.pass.uniforms[fx.uniform].value = parseFloat(slider.value);
      valSpan.textContent = Number(slider.value).toFixed(3);
      if (parseFloat(slider.value) > 0 && !toggle.checked) { toggle.checked = true; fx.pass.enabled = true; }
    });
    row.appendChild(toggle); row.appendChild(label); row.appendChild(slider); row.appendChild(valSpan);
    container.appendChild(row);
  });

  // Dump button
  document.getElementById('skin-tuner-dump').onclick = () => {
    const out = { materials: {}, fx: {} };
    allMeshes.forEach(({ name, mesh }) => {
      const m = mesh.material;
      if (!m) return;
      const o = {};
      o.color = '0x' + (m.color ? m.color.getHexString() : '000000');
      o.metalness = m.metalness;
      o.roughness = m.roughness;
      if (m.emissive) o.emissive = '0x' + m.emissive.getHexString();
      if (m.emissiveIntensity) o.emissiveIntensity = m.emissiveIntensity;
      if (m.clearcoat) o.clearcoat = m.clearcoat;
      out.materials[name] = o;
    });
    out.fx.bloomStrength = bloom.strength;
    out.fx.bloomRadius = bloom.radius;
    out.fx.bloomThreshold = bloom.threshold;
    out.fx.exposure = renderer.toneMappingExposure;
    out.fx.vignetteDarkness = vignettePass.uniforms.darkness.value;
    out.fx.vignetteOffset = vignettePass.uniforms.offset.value;
    out.fx.chromaticAberration = vignettePass.uniforms.aberration.value;
    if (window._grainPass) out.fx.filmGrain = window._grainPass.uniforms.amount.value;
    if (window._scanPass) out.fx.scanlines = window._scanPass.uniforms.intensity.value;
    if (window._huePass) out.fx.hueShift = window._huePass.uniforms.shift.value;
    if (window._diamondUniforms) {
      out.diamondShader = {};
      for (const k in window._diamondUniforms) out.diamondShader[k] = window._diamondUniforms[k].value;
    }
    out.lighting = {};
    out.lighting.keyLight = dirLight.intensity;
    out.lighting.ambient = ambientLight.intensity;
    out.lighting.exposure = renderer.toneMappingExposure;

    // Panorama + star tuner values
    out.panorama = {
      brightness: _skyQuadMat.uniforms.uBrightness.value,
      tintR: _skyQuadMat.uniforms.uTintR.value,
      tintG: _skyQuadMat.uniforms.uTintG.value,
      tintB: _skyQuadMat.uniforms.uTintB.value,
      offsetY: _skyQuadMat.uniforms.uOffsetY.value,
      sunFadeR: _skyQuadMat.uniforms.uSunFadeR.value,
      sunFadeSoft: _skyQuadMat.uniforms.uSunFadeSoft.value,
      sunFadeX: _skyQuadMat.uniforms.uSunFadeX.value,
      sunFadeY: _skyQuadMat.uniforms.uSunFadeY.value,
    };
    if (window._starMat) {
      const sm = window._starMat;
      out.twinkleStars = {
        colorR: sm.uniforms.uStarR.value,
        colorG: sm.uniforms.uStarG.value,
        colorB: sm.uniforms.uStarB.value,
        brightness: sm.uniforms.uStarBright.value,
        twinkleMin: sm.uniforms.uTwinkleMin.value,
        twinkleRange: sm.uniforms.uTwinkleRange.value,
        sizeMult: sm.uniforms.uSizeMult.value,
      };
    }

    console.log('SKIN TUNER DUMP:', JSON.stringify(out, null, 2));
    alert('Dumped to console (F12)');
  };
}

// ═══════════════════════════════════════════════════
//  SCENE DEBUG TUNER — press T to toggle (expanded)
// ═══════════════════════════════════════════════════
(function setupSceneTuner() {
  const panel = document.createElement('div');
  panel.id = 'scene-tuner';
  panel.style.cssText = 'display:none;position:fixed;top:0;left:0;width:280px;height:100%;background:rgba(0,0,0,0.92);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;';
  document.body.appendChild(panel);

  function makeSlider(label, val, min, max, step, onChange, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:4px;flex-wrap:wrap;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:100px;color:'+(color||'#aaa')+';font-size:10px;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    inp.style.cssText = 'flex:1;height:14px;accent-color:'+(color||'#0af')+';';
    const valEl = document.createElement('span');
    valEl.style.cssText = 'width:40px;text-align:right;font-size:10px;color:#fff;';
    valEl.textContent = (+val).toFixed(2);
    inp.oninput = () => { onChange(+inp.value); valEl.textContent = (+inp.value).toFixed(2); };
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(valEl);
    return row;
  }

  function makeToggle(label, obj, prop, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:8px;';
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:1px solid '+(color||'#666')+';color:'+(color||'#aaa')+';padding:2px 8px;cursor:pointer;font-family:monospace;font-size:10px;';
    btn.textContent = label + ': ' + (obj[prop] ? 'ON' : 'OFF');
    btn.onclick = () => { obj[prop] = !obj[prop]; btn.textContent = label + ': ' + (obj[prop] ? 'ON' : 'OFF'); };
    row.appendChild(btn);
    return row;
  }

  function makeHeader(text, color) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:8px 0 4px;font-size:11px;font-weight:bold;color:'+(color||'#ff0')+';border-bottom:1px solid #333;padding-bottom:2px;';
    h.textContent = text;
    return h;
  }

  function build() {
    panel.innerHTML = '<div style="font-size:13px;font-weight:bold;color:#0af;margin-bottom:6px;">SCENE TUNER (T)</div>';

    // SPEED TEST — override game speed for tuning visuals at different tiers
    panel.appendChild(makeHeader('SPEED TEST'));
    const _spdLabel = document.createElement('div');
    _spdLabel.style.cssText = 'color:#0ff;font-size:10px;margin:2px 0;font-family:monospace;';
    _spdLabel.textContent = 'OFF (live game speed)';
    panel.appendChild(_spdLabel);
    panel.appendChild(makeSlider('speed mult', 0, 0, 2.5, 0.05, v => {
      if (v <= 0) {
        _tunerSpeedOverride = -1;
        _spdLabel.textContent = 'OFF (live game speed)';
      } else {
        _tunerSpeedOverride = BASE_SPEED * v;
        // label with tier info
        let tier = '';
        if (v <= 1.05)       tier = 'T1';
        else if (v <= 1.25)  tier = 'T2';
        else if (v <= 1.4)   tier = 'T3a';
        else if (v <= 1.55)  tier = 'T4a';
        else if (v <= 1.9)   tier = 'T4b / T5a';
        else if (v <= 2.05)  tier = 'T3b / T5b';
        else if (v <= 2.15)  tier = 'T4c ICE STORM';
        else                 tier = 'T5c VOID / T6+';
        _spdLabel.textContent = v.toFixed(2) + 'x  (' + tier + ')  = ' + (BASE_SPEED * v).toFixed(0);
      }
    }, '#0ff'));

    // JL SEQUENCER
    panel.appendChild(makeHeader('JL SEQUENCER', '#fa0'));
    {
      // Intensity scalar — multiplies into frequency of all active tracks
      const intRow = makeSlider('intensity', _jlIntensity, 0.1, 3.0, 0.05, v => {
        _jlIntensity = v;
      }, '#fa0');
      panel.appendChild(intRow.row);

      // Live readout: ramp time + active tracks
      const seqInfo = document.createElement('div');
      seqInfo.style.cssText = 'font-family:monospace;font-size:9px;color:#888;margin:3px 0 6px;line-height:1.5;';
      const _refreshSeqInfo = () => {
        if (!state._jetLightningMode) { seqInfo.textContent = 'JL not active'; return; }
        const t = _jlRampTime || 0;
        const active = _JL_TRACKS
          .filter(tr => t >= tr.startT && (tr.endT === null || t < tr.endT))
          .map(tr => tr.id)
          .join(', ');
        seqInfo.textContent = 't=' + t.toFixed(1) + 's  intensity=' + _jlIntensity.toFixed(2) + '\nactive: ' + (active || 'none');
      };
      setInterval(_refreshSeqInfo, 500);
      _refreshSeqInfo();
      panel.appendChild(seqInfo);
    }

    // LIGHTS
    panel.appendChild(makeHeader('LIGHTS'));
    panel.appendChild(makeSlider('dirLight', dirLight.intensity, 0, 5, 0.01, v => dirLight.intensity = v, '#fff'));
    panel.appendChild(makeSlider('dir posX', dirLight.position.x, -20, 20, 0.1, v => dirLight.position.x = v, '#fff'));
    panel.appendChild(makeSlider('dir posY', dirLight.position.y, -20, 20, 0.1, v => dirLight.position.y = v, '#fff'));
    panel.appendChild(makeSlider('dir posZ', dirLight.position.z, -20, 20, 0.1, v => dirLight.position.z = v, '#fff'));
    panel.appendChild(makeSlider('rimLight', rimLight.intensity, 0, 2, 0.01, v => rimLight.intensity = v, '#0ff'));
    panel.appendChild(makeSlider('fillLight', fillLight.intensity, 0, 2, 0.01, v => fillLight.intensity = v, '#f4c'));
    panel.appendChild(makeSlider('sunLight R', sunLight.intensity, 0, 2, 0.01, v => sunLight.intensity = v, '#f90'));
    panel.appendChild(makeSlider('sunLight L', sunLightL.intensity, 0, 2, 0.01, v => sunLightL.intensity = v, '#f90'));
    panel.appendChild(makeSlider('ambient', ambientLight.intensity, 0, 1, 0.01, v => ambientLight.intensity = v, '#888'));

    // BLOOM
    panel.appendChild(makeHeader('BLOOM'));
    panel.appendChild(makeSlider('strength', bloom.strength, 0, 3, 0.01, v => bloom.strength = v, '#f80'));
    panel.appendChild(makeSlider('radius', bloom.radius, 0, 2, 0.01, v => bloom.radius = v, '#f80'));
    panel.appendChild(makeSlider('threshold', bloom.threshold, 0, 2, 0.01, v => bloom.threshold = v, '#f80'));

    // SHIELD
    panel.appendChild(makeHeader('SHIELD'));
    panel.appendChild(makeSlider('hex scale',    shieldMat.uniforms.uHexScale.value,         1, 8,    0.1,  v => shieldMat.uniforms.uHexScale.value = v,           '#0ef'));
    panel.appendChild(makeSlider('edge width',   shieldMat.uniforms.uEdgeWidth.value,         0.01, 0.3, 0.005, v => shieldMat.uniforms.uEdgeWidth.value = v,        '#0ef'));
    panel.appendChild(makeSlider('hex opacity',  shieldMat.uniforms.uHexOpacity.value,        0, 1,    0.01, v => shieldMat.uniforms.uHexOpacity.value = v,          '#0ef'));
    panel.appendChild(makeSlider('fresnel pwr',  shieldMat.uniforms.uFresnelPower.value,      0.5, 5,  0.05, v => shieldMat.uniforms.uFresnelPower.value = v,        '#0ef'));
    panel.appendChild(makeSlider('fresnel str',  shieldMat.uniforms.uFresnelStrength.value,   0, 5,    0.05, v => shieldMat.uniforms.uFresnelStrength.value = v,     '#0ef'));
    panel.appendChild(makeSlider('opacity',      shieldMat.uniforms.uOpacity.value,           0, 2,    0.01, v => shieldMat.uniforms.uOpacity.value = v,             '#0ef'));
    panel.appendChild(makeSlider('flow intens',  shieldMat.uniforms.uFlowIntensity.value,     0, 10,   0.1,  v => shieldMat.uniforms.uFlowIntensity.value = v,       '#0ef'));
    panel.appendChild(makeSlider('flow speed',   shieldMat.uniforms.uFlowSpeed.value,         0, 3,    0.05, v => shieldMat.uniforms.uFlowSpeed.value = v,           '#0ef'));
    panel.appendChild(makeSlider('flow scale',   shieldMat.uniforms.uFlowScale.value,         0.5, 6,  0.1,  v => shieldMat.uniforms.uFlowScale.value = v,          '#0ef'));
    panel.appendChild(makeSlider('flash speed',  shieldMat.uniforms.uFlashSpeed.value,        0, 3,    0.05, v => shieldMat.uniforms.uFlashSpeed.value = v,          '#0ef'));
    panel.appendChild(makeSlider('flash intens', shieldMat.uniforms.uFlashIntensity.value,    0, 1,    0.01, v => shieldMat.uniforms.uFlashIntensity.value = v,      '#0ef'));
    panel.appendChild(makeSlider('noise edge',   shieldMat.uniforms.uNoiseEdgeIntensity.value,0, 20,   0.1,  v => shieldMat.uniforms.uNoiseEdgeIntensity.value = v,  '#0ef'));
    panel.appendChild(makeSlider('noise smooth', shieldMat.uniforms.uNoiseEdgeSmoothness.value,0,1,   0.01, v => shieldMat.uniforms.uNoiseEdgeSmoothness.value = v, '#0ef'));
    panel.appendChild(makeSlider('hit ring spd', shieldMat.uniforms.uHitRingSpeed.value,      0.5, 5,  0.05, v => shieldMat.uniforms.uHitRingSpeed.value = v,       '#0ef'));
    panel.appendChild(makeSlider('hit intens',   shieldMat.uniforms.uHitIntensity.value,      0, 20,   0.1,  v => shieldMat.uniforms.uHitIntensity.value = v,       '#0ef'));
    panel.appendChild(makeSlider('hit radius',   shieldMat.uniforms.uHitImpactRadius.value,   0.05, 1, 0.01, v => shieldMat.uniforms.uHitImpactRadius.value = v,    '#0ef'));
    panel.appendChild(makeSlider('hit max r',    shieldMat.uniforms.uHitMaxRadius.value,      0.1, 2,  0.05, v => shieldMat.uniforms.uHitMaxRadius.value = v,       '#0ef'));
    panel.appendChild(makeSlider('hit duration', shieldMat.uniforms.uHitDuration.value,       0.1, 8,  0.05, v => shieldMat.uniforms.uHitDuration.value = v,        '#0ef'));
    panel.appendChild(makeSlider('hit ring w',   shieldMat.uniforms.uHitRingWidth.value,      0.01, 0.5,0.01, v => shieldMat.uniforms.uHitRingWidth.value = v,      '#0ef'));
    panel.appendChild(makeSlider('fade start',   shieldMat.uniforms.uFadeStart.value,        -1, 1,    0.01, v => shieldMat.uniforms.uFadeStart.value = v,           '#0ef'));
    panel.appendChild(makeSlider('displace str', shieldMat.uniforms.uDisplaceStrength.value,  0, 1,    0.01, v => shieldMat.uniforms.uDisplaceStrength.value = v,    '#0ef'));
    panel.appendChild(makeSlider('color R',      shieldMat.uniforms.uColor.value.r,           0, 1,    0.01, v => { shieldMat.uniforms.uColor.value.r = v; shieldMat.uniforms.uNoiseEdgeColor.value.r = v; }, '#0ef'));
    panel.appendChild(makeSlider('color G',      shieldMat.uniforms.uColor.value.g,           0, 1,    0.01, v => { shieldMat.uniforms.uColor.value.g = v; shieldMat.uniforms.uNoiseEdgeColor.value.g = v; }, '#0ef'));
    panel.appendChild(makeSlider('color B',      shieldMat.uniforms.uColor.value.b,           0, 1,    0.01, v => { shieldMat.uniforms.uColor.value.b = v; shieldMat.uniforms.uNoiseEdgeColor.value.b = v; }, '#0ef'));

    // RENDERER
    panel.appendChild(makeHeader('RENDERER'));
    panel.appendChild(makeSlider('exposure', renderer.toneMappingExposure, 0, 3, 0.01, v => renderer.toneMappingExposure = v, '#8f8'));

    // WATER
    panel.appendChild(makeHeader('WATER'));
    panel.appendChild(makeSlider('w sunR', mirrorMat.uniforms.sunColor.value.r, 0, 1, 0.01, v => mirrorMat.uniforms.sunColor.value.r = v, '#f44'));
    panel.appendChild(makeSlider('w sunG', mirrorMat.uniforms.sunColor.value.g, 0, 1, 0.01, v => mirrorMat.uniforms.sunColor.value.g = v, '#4f4'));
    panel.appendChild(makeSlider('w sunB', mirrorMat.uniforms.sunColor.value.b, 0, 1, 0.01, v => mirrorMat.uniforms.sunColor.value.b = v, '#44f'));
    panel.appendChild(makeSlider('distortion', mirrorMat.uniforms.distortionScale.value, 0, 10, 0.1, v => mirrorMat.uniforms.distortionScale.value = v, '#4af'));
    panel.appendChild(makeSlider('waterAlpha', mirrorMat.uniforms.alpha.value, 0, 1, 0.01, v => mirrorMat.uniforms.alpha.value = v, '#4af'));
    panel.appendChild(makeSlider('waterSize', mirrorMat.uniforms.size.value, 0, 20, 0.1, v => mirrorMat.uniforms.size.value = v, '#4af'));
    panel.appendChild(makeSlider('flowScale', _waterFlowScale, 0, 3, 0.05, v => { _waterFlowScale = v; }, '#4af'));

    // SUN ELEMENTS
    panel.appendChild(makeHeader('SUN'));
    panel.appendChild(makeToggle('sunGlowSprite', sunGlowSprite, 'visible', '#fa0'));
    panel.appendChild(makeToggle('sunRimGlow', sunRimGlow, 'visible', '#fa0'));
    panel.appendChild(makeToggle('sunCapMesh', sunCapMesh, 'visible', '#fa0'));
    panel.appendChild(makeToggle('sunMesh', sunMesh, 'visible', '#fa0'));

    // FLOOR
    panel.appendChild(makeHeader('FLOOR'));
    panel.appendChild(makeToggle('floorGrid', floorMesh, 'visible', '#0f8'));
    panel.appendChild(makeToggle('water', mirrorMesh, 'visible', '#0af'));

    // THRUSTER / FLAME / BLOOM SPRITES
    panel.appendChild(makeHeader('THRUSTERS & FX'));
    thrusterSystems.forEach((s, i) => panel.appendChild(makeToggle('thruster'+i, s.points, 'visible', '#f80')));
    miniThrusterSystems.forEach((s, i) => panel.appendChild(makeToggle('miniThr'+i, s.points, 'visible', '#f60')));
    nozzleBloomSprites.forEach((s, i) => panel.appendChild(makeToggle('nozBloom'+i, s, 'visible', '#ff0')));
    miniBloomSprites.forEach((s, i) => panel.appendChild(makeToggle('miniBlm'+i, s, 'visible', '#fd0')));
    flameMeshes.forEach((s, i) => panel.appendChild(makeToggle('flame'+i, s, 'visible', '#f40')));

    // SKY / STARS / NEBULA
    panel.appendChild(makeHeader('SKY & SPACE'));
    panel.appendChild(makeToggle('skyMesh', skyMesh, 'visible', '#66a'));
    panel.appendChild(makeToggle('brightStars', brightStarField, 'visible', '#aaf'));
    panel.appendChild(makeToggle('nebula', nebulaCloud, 'visible', '#a6f'));
    panel.appendChild(makeToggle('warpParts', _warpMesh, 'visible', '#88f'));

    // WARP STREAKS
    panel.appendChild(makeHeader('WARP STREAKS'));
    panel.appendChild(makeSlider('warp speed', _warpSpeed, 0, 80, 1, v => { _warpSpeed = v; }, '#88f'));
    panel.appendChild(makeSlider('warp bright', _warpBrightness, 0, 1, 0.01, v => { _warpBrightness = v; _warpMat.opacity = v; }, '#88f'));
    panel.appendChild(makeSlider('warp R', 1, 0, 1, 0.01, v => { _warpMat.color.r = v; }, '#f44'));
    panel.appendChild(makeSlider('warp G', 1, 0, 1, 0.01, v => { _warpMat.color.g = v; }, '#4f4'));
    panel.appendChild(makeSlider('warp B', 1, 0, 1, 0.01, v => { _warpMat.color.b = v; }, '#48f'));
    panel.appendChild(makeSlider('warp max len', _warpMaxLen, 1, 200, 1, v => { _warpMaxLen = v; }, '#88f'));
    panel.appendChild(makeSlider('warp count', WARP_COUNT, 100, 5000, 100, v => { _warpRebuild(v); }, '#88f'));
    panel.appendChild(makeSlider('warp Y center', _warpYCenter, -50, 200, 5, v => { _warpYCenter = v; }, '#88f'));
    panel.appendChild(makeSlider('warp Y range', _warpYRange, 10, 400, 10, v => { _warpYRange = v; }, '#88f'));
    panel.appendChild(makeSlider('warp edge bias', _warpEdgeBias, 0, 1, 0.05, v => { _warpEdgeBias = v; }, '#88f'));


    if (typeof skyStarPoints !== 'undefined') panel.appendChild(makeToggle('skyStarPts', skyStarPoints, 'visible', '#aaf'));
    if (typeof skyConstellLines !== 'undefined') panel.appendChild(makeToggle('constLines', skyConstellLines, 'visible', '#88a'));
    panel.appendChild(makeToggle('auroraGrp', auroraGroup, 'visible', '#0f8'));
    panel.appendChild(makeToggle('l5fGrp', l5fGroup, 'visible', '#f80'));

    // ── PANORAMA SKY ──
    panel.appendChild(makeHeader('PANORAMA'));
    panel.appendChild(makeToggle('panoQuad', _skyQuad, 'visible', '#c8f'));
    panel.appendChild(makeSlider('pano bright', _skyQuadMat.uniforms.uBrightness.value, 0, 15, 0.1, v => _skyQuadMat.uniforms.uBrightness.value = v, '#c8f'));
    panel.appendChild(makeSlider('pano tint R', _skyQuadMat.uniforms.uTintR.value, 0, 2, 0.01, v => _skyQuadMat.uniforms.uTintR.value = v, '#f44'));
    panel.appendChild(makeSlider('pano tint G', _skyQuadMat.uniforms.uTintG.value, 0, 2, 0.01, v => _skyQuadMat.uniforms.uTintG.value = v, '#4f4'));
    panel.appendChild(makeSlider('pano tint B', _skyQuadMat.uniforms.uTintB.value, 0, 2, 0.01, v => _skyQuadMat.uniforms.uTintB.value = v, '#44f'));
    panel.appendChild(makeSlider('pano Y offset', _skyQuadMat.uniforms.uOffsetY.value, -0.5, 0.5, 0.01, v => _skyQuadMat.uniforms.uOffsetY.value = v, '#c8f'));
    panel.appendChild(makeSlider('sun fade R', _skyQuadMat.uniforms.uSunFadeR.value, 0, 0.8, 0.01, v => _skyQuadMat.uniforms.uSunFadeR.value = v, '#fa0'));
    panel.appendChild(makeSlider('sun fade soft', _skyQuadMat.uniforms.uSunFadeSoft.value, 0, 0.5, 0.01, v => _skyQuadMat.uniforms.uSunFadeSoft.value = v, '#fa0'));
    panel.appendChild(makeSlider('sun fade X', _skyQuadMat.uniforms.uSunFadeX.value, 0, 1, 0.01, v => _skyQuadMat.uniforms.uSunFadeX.value = v, '#fa0'));
    panel.appendChild(makeSlider('sun fade Y', _skyQuadMat.uniforms.uSunFadeY.value, 0, 1, 0.01, v => _skyQuadMat.uniforms.uSunFadeY.value = v, '#fa0'));

    // ── TWINKLE STARS ──
    if (window._starMat) {
      panel.appendChild(makeHeader('TWINKLE STARS'));
      const sm = window._starMat;
      panel.appendChild(makeSlider('star R', sm.uniforms.uStarR.value, 0, 2, 0.01, v => sm.uniforms.uStarR.value = v, '#f44'));
      panel.appendChild(makeSlider('star G', sm.uniforms.uStarG.value, 0, 2, 0.01, v => sm.uniforms.uStarG.value = v, '#4f4'));
      panel.appendChild(makeSlider('star B', sm.uniforms.uStarB.value, 0, 2, 0.01, v => sm.uniforms.uStarB.value = v, '#44f'));
      panel.appendChild(makeSlider('star bright', sm.uniforms.uStarBright.value, 0, 30, 0.1, v => sm.uniforms.uStarBright.value = v, '#fff'));
      panel.appendChild(makeSlider('twinkle min', sm.uniforms.uTwinkleMin.value, 0, 1, 0.01, v => sm.uniforms.uTwinkleMin.value = v, '#aaf'));
      panel.appendChild(makeSlider('twinkle range', sm.uniforms.uTwinkleRange.value, 0, 1, 0.01, v => sm.uniforms.uTwinkleRange.value = v, '#aaf'));
      panel.appendChild(makeSlider('star size', sm.uniforms.uSizeMult.value, 0.1, 5, 0.05, v => sm.uniforms.uSizeMult.value = v, '#aaf'));
    }

    // SHIP
    panel.appendChild(makeHeader('SHIP'));
    panel.appendChild(makeToggle('shipGroup', shipGroup, 'visible', '#0ff'));
    panel.appendChild(makeToggle('shieldMesh', shieldMesh, 'visible', '#0ef'));
    panel.appendChild(makeToggle('shieldWire', shieldWire, 'visible', '#0ef'));
    // Ship hull emissive
    if (shipHullMats.length > 0) {
      panel.appendChild(makeSlider('hull emissive', shipHullMats[0].emissiveIntensity || 0, 0, 5, 0.01, v => {
        shipHullMats.forEach(m => { if (m.emissiveIntensity !== undefined) m.emissiveIntensity = v; });
      }, '#0ff'));
    }

    // MISC
    panel.appendChild(makeHeader('MISC'));
    panel.appendChild(makeToggle('l5Dust', l5DustPoints, 'visible', '#aaa'));
    // Fog
    panel.appendChild(makeSlider('fog near', scene.fog ? scene.fog.near : 0, 0, 200, 1, v => { if (scene.fog) scene.fog.near = v; }, '#888'));
    panel.appendChild(makeSlider('fog far', scene.fog ? scene.fog.far : 300, 0, 600, 1, v => { if (scene.fog) scene.fog.far = v; }, '#888'));

    // WAKE
    panel.appendChild(makeHeader('WAKE'));
    panel.appendChild(makeSlider('ring life', WAKE_RING_LIFE, 0.2, 4, 0.1, v => WAKE_RING_LIFE = v, '#4af'));
    panel.appendChild(makeSlider('ring rate', WAKE_RING_RATE, 0.01, 0.3, 0.01, v => WAKE_RING_RATE = v, '#4af'));
    panel.appendChild(makeSlider('ring Y', WAKE_Y, -0.1, 0.2, 0.01, v => WAKE_Y = v, '#4af'));
    panel.appendChild(makeSlider('vwake opacity', vWakeMats[0] ? vWakeMats[0].opacity : 0.18, 0, 1, 0.01, v => vWakeMats.forEach(m => m.opacity = v), '#4af'));

    // SHIP EXHAUST DEBUGGING
    panel.appendChild(makeHeader('SHIP EXHAUST DEBUG'));
    shipFireMeshes.forEach((m, i) => panel.appendChild(makeToggle('fire'+i, m, 'visible', '#f44')));
    panel.appendChild(makeToggle('underlight', shipGroup.getObjectByName && shipGroup.children.find(c => c.isLight) || { visible: true }, 'visible', '#fa0'));
    thrusterSystems.forEach((s, i) => panel.appendChild(makeToggle('thrPart'+i, s.points, 'visible', '#0af')));
    miniThrusterSystems.forEach((s, i) => panel.appendChild(makeToggle('miniPart'+i, s.points, 'visible', '#0af')));
    nozzleBloomSprites.forEach((s, i) => panel.appendChild(makeToggle('nozGlow'+i, s, 'visible', '#ff0')));
    miniBloomSprites.forEach((s, i) => panel.appendChild(makeToggle('miniGlow'+i, s, 'visible', '#fd0')));
    flameMeshes.forEach((s, i) => panel.appendChild(makeToggle('flameQ'+i, s, 'visible', '#f80')));
    panel.appendChild(makeSlider('flame yaw', _flameYawMult, 0, 0.3, 0.005, v => _flameYawMult = v, '#f80'));
    panel.appendChild(makeSlider('flame lateral', _flameLateralMult, 0, 0.2, 0.005, v => _flameLateralMult = v, '#f80'));

    panel.appendChild(makeHeader('THRUSTERS'));
    panel.appendChild(makeSlider('thruster scale', window._thrusterScale || 1.0, 0, 3, 0.05, v => { window._thrusterScale = v; }, '#f60'));
    panel.appendChild(makeSlider('particle size', thrusterSystems[0].points.material.size, 0.01, 1.0, 0.01, v => {
      thrusterSystems.forEach(s => s.points.material.size = v);
    }, '#f60'));
    panel.appendChild(makeSlider('mini part size', miniThrusterSystems[0].points.material.size, 0.01, 0.5, 0.01, v => {
      miniThrusterSystems.forEach(s => s.points.material.size = v);
    }, '#f60'));
    panel.appendChild(makeSlider('bloom size', nozzleBloomSprites[0].scale.x || 0.6, 0.1, 4, 0.05, v => {
      window._nozzleBloomScale = v;
    }, '#f60'));
    panel.appendChild(makeSlider('bloom opacity', 0.34, 0, 1, 0.01, v => {
      window._nozzleBloomOpacity = v;
    }, '#f60'));
    panel.appendChild(makeSlider('mini bloom size', miniBloomSprites[0].scale.x || 0.3, 0.05, 2, 0.05, v => {
      window._miniBloomScale = v;
    }, '#f60'));

    // HOVER BOB
    panel.appendChild(makeHeader('HOVER BOB'));
    panel.appendChild(makeSlider('ship Y', _hoverBaseY, -1.0, 3.0, 0.01, v => { _hoverBaseY = v; shipGroup.position.y = v; }, '#0ff'));
    panel.appendChild(makeSlider('ship Z', shipGroup.position.z, 0, 10, 0.1, v => { shipGroup.position.z = v; }, '#0ff'));
    panel.appendChild(makeSlider('rotX offset', _shipRotXOffset, -0.5, 0.5, 0.01, v => { _shipRotXOffset = v; }, '#0ff'));
    panel.appendChild(makeSlider('rotZ offset', _shipRotZOffset, -0.5, 0.5, 0.01, v => { _shipRotZOffset = v; }, '#0ff'));
    panel.appendChild(makeSlider('ship scale', shipGroup.scale.x, 0.1, 1.0, 0.01, v => { shipGroup.scale.setScalar(v); }, '#0ff'));
    panel.appendChild(makeSlider('cam lookY', _camLookYOffset, -5, 5, 0.1, v => { _camLookYOffset = v; camera.lookAt(new THREE.Vector3(0, -2.8 + v, -50 + _camLookZOffset)); }, '#f0f'));
    panel.appendChild(makeSlider('cam lookZ', _camLookZOffset, 0, 50, 0.5, v => { _camLookZOffset = v; camera.lookAt(new THREE.Vector3(0, -2.8 + _camLookYOffset, -50 + v)); }, '#f0f'));
    panel.appendChild(makeSlider('cam FOV', camera.fov, 30, 120, 1, v => { _camFOVOffset = v - 65; _baseFOV = v; camera.fov = v; camera.updateProjectionMatrix(); }, '#f0f'));
    panel.appendChild(makeSlider('FOV spd boost', _fovSpeedBoost, 0, 30, 1, v => { _fovSpeedBoost = v; }, '#f0f'));
    panel.appendChild(makeSlider('cam pivotY', _camPivotYOffset, -3, 3, 0.1, v => { _camPivotYOffset = v; }, '#f0f'));
    panel.appendChild(makeSlider('cam pivotZ', _camPivotZOffset, -5, 7, 0.1, v => { _camPivotZOffset = v; }, '#f0f'));
    panel.appendChild(makeSlider('bob amp', _bobAmplitude, 0, 0.06, 0.001, v => _bobAmplitude = v, '#0f8'));
    panel.appendChild(makeSlider('bob freq', _bobFrequency, 0.5, 4, 0.1, v => _bobFrequency = v, '#0f8'));
    panel.appendChild(makeSlider('bob steerOut', _bobSteerFadeOut, 0.5, 10, 0.5, v => _bobSteerFadeOut = v, '#0f8'));
    panel.appendChild(makeSlider('bob steerIn', _bobSteerFadeIn, 0.5, 10, 0.5, v => _bobSteerFadeIn = v, '#0f8'));

    // PITCH TILT
    panel.appendChild(makeHeader('PITCH TILT'));
    panel.appendChild(makeSlider('pitch fwd', _pitchForwardMax, 0, 0.4, 0.01, v => _pitchForwardMax = v, '#fa0'));
    panel.appendChild(makeSlider('pitch back', _pitchBackMax, 0, 0.3, 0.01, v => _pitchBackMax = v, '#fa0'));
    panel.appendChild(makeSlider('pitch smooth', _pitchSmoothing, 1, 12, 0.5, v => _pitchSmoothing = v, '#fa0'));

    // YAW (nose into turn)
    panel.appendChild(makeHeader('YAW'));
    panel.appendChild(makeSlider('yaw max', _yawMax, 0, 0.2, 0.005, v => _yawMax = v, '#ff0'));
    panel.appendChild(makeSlider('yaw smooth', _yawSmoothing, 1, 12, 0.5, v => _yawSmoothing = v, '#ff0'));

    // BANK (roll into turn)
    // SHIP HANDLING
    panel.appendChild(makeHeader('SHIP HANDLING'));
    const _handlingLabel = document.createElement('div');
    _handlingLabel.style.cssText = 'color:#0ff;font-size:11px;margin:2px 0 4px 0;font-family:monospace';
    _handlingLabel.textContent = 'Player level (live)';
    panel.appendChild(_handlingLabel);
    panel.appendChild(makeSlider('tier', 0, 0, HANDLING_TIERS.length, 1, v => {
      const idx = Math.round(v);
      if (idx === 0) {
        _handlingDriftOverride = -1;
        _handlingLabel.textContent = 'Player level (live)';
      } else {
        const t = HANDLING_TIERS[idx - 1];
        _handlingDriftOverride = t.drift;
        _handlingLabel.textContent = (t.label || 'Stock') + ' — drift=' + t.drift;
      }
    }, '#0ff'));

    // FUN FLOOR
    panel.appendChild(makeHeader('FUN FLOOR'));
    panel.appendChild(makeSlider('start speed (x BASE)', _funFloorSpeed, 1.0, 1.85, 0.01, v => { _funFloorSpeed = v; }, '#ff0'));
    panel.appendChild(makeSlider('spawn intensity (0=off, 1=max)', _funFloorIntensity, 0.0, 1.0, 0.01, v => { _funFloorIntensity = v; }, '#ff0'));

    // LATERAL PHYSICS
    panel.appendChild(makeHeader('LATERAL PHYSICS'));

    // ── Preset restore buttons ────────────────────────────────────────────────
    Object.entries(_PHYSICS_PRESETS).forEach(([key, p]) => {
      const btn = document.createElement('button');
      btn.textContent = '↩ RESTORE: ' + key;
      btn.title = p.label;
      btn.style.cssText = 'background:none;border:1px solid #0f8;color:#0f8;padding:3px 8px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:4px 0 6px;width:100%;text-align:left;';
      btn.onclick = () => {
        _accelBase    = p.accelBase;
        _accelSnap    = p.accelSnap;
        _maxVelBase   = p.maxVelBase;
        _maxVelSnap   = p.maxVelSnap;
        _bankMax      = p.bankMax;
        _bankSmoothing = p.bankSmoothing;
        _decelBasePct = p.decelBasePct;
        _decelFullPct = p.decelFullPct;
        if (p.speed === 'L4') state.speed = BASE_SPEED * LEVELS[3].speedMult;
        // Rebuild panel so sliders reflect restored values
        build();
        panel.style.display = 'block';
      };
      panel.appendChild(btn);
    });

    panel.appendChild(makeSlider('phys level (0=L1 floaty, 4=L5 crisp, -1=live)', _physLevelOverride, -1, 4, 1, v => _physLevelOverride = Math.round(v), '#0ff'));
    panel.appendChild(makeSlider('accel base', _accelBase, 1, 60, 1, v => _accelBase = v, '#0f8'));
    panel.appendChild(makeSlider('accel snap', _accelSnap, 0, 100, 1, v => _accelSnap = v, '#0f8'));
    panel.appendChild(makeSlider('accel drift x', _accelDriftMult, 0, 8, 0.1, v => _accelDriftMult = v, '#0f8'));
    panel.appendChild(makeSlider('decel stock %', _decelBasePct, 0, 0.5, 0.01, v => _decelBasePct = v, '#0f8'));
    panel.appendChild(makeSlider('decel full %', _decelFullPct, 0, 1.0, 0.01, v => _decelFullPct = v, '#0f8'));
    panel.appendChild(makeSlider('opp decel scale', _decelOppScale, 0, 2, 0.05, v => _decelOppScale = v, '#0f8'));
    panel.appendChild(makeSlider('max vel base', _maxVelBase, 1, 120, 1, v => _maxVelBase = v, '#0f8'));
    panel.appendChild(makeSlider('max vel snap', _maxVelSnap, 0, 120, 1, v => _maxVelSnap = v, '#0f8'));

    panel.appendChild(makeHeader('BANK'));
    panel.appendChild(makeSlider('bank max', _bankMax, 0, 0.06, 0.001, v => _bankMax = v, '#0af'));
    panel.appendChild(makeSlider('bank smooth', _bankSmoothing, 1, 16, 0.5, v => _bankSmoothing = v, '#0af'));

    // WOBBLE
    // WARP SUN COLORS
    panel.appendChild(makeHeader('WARP SUN'));
    const _warpCols = [
      { label: 'dark ', key: 'uWarpCol1', def: [0.25, 0.04, 0.02] },
      { label: 'mid  ', key: 'uWarpCol2', def: [0.85, 0.15, 0.04] },
      { label: 'bright', key: 'uWarpCol3', def: [1.0,  0.45, 0.08] },
    ];
    _warpCols.forEach(({label, key, def}) => {
      ['r','g','b'].forEach((ch, ci) => {
        panel.appendChild(makeSlider(label+ch, def[ci], 0, 1, 0.01, v => {
          const u = sunMat.uniforms[key].value;
          if (ci === 0) u.x = v; else if (ci === 1) u.y = v; else u.z = v;
          sunCapMat.uniforms[key].value.copy(u);
        }, '#f80'));
      });
    });

    panel.appendChild(makeHeader('WOBBLE'));
    panel.appendChild(makeSlider('wobble amp', _wobbleMaxAmp, 0, 0.5, 0.01, v => _wobbleMaxAmp = v, '#f4a'));
    panel.appendChild(makeSlider('wobble damp', _wobbleDamping, 1, 10, 0.5, v => _wobbleDamping = v, '#f4a'));
    panel.appendChild(makeSlider('spd mult', _wobbleSpeedMult, 0, 4, 0.1, v => _wobbleSpeedMult = v, '#f4a'));

    // ROLL OVERSHOOT
    panel.appendChild(makeHeader('ROLL OVERSHOOT'));
    panel.appendChild(makeSlider('amount', _overshootAmt, 0, 1.0, 0.05, v => _overshootAmt = v, '#fa4'));
    panel.appendChild(makeSlider('damping', _overshootDamp, 1, 20, 0.5, v => _overshootDamp = v, '#fa4'));

    // TURBULENCE
    panel.appendChild(makeHeader('TURBULENCE'));
    panel.appendChild(makeSlider('amount', _turbulence, 0, 0.5, 0.01, v => _turbulence = v, '#4fa'));

    // T1 BEAM
    panel.appendChild(makeHeader('T1 BEAM'));
    panel.appendChild(makeSlider('beam Y', _lBeamY, -2, 4, 0.05, v => { _lBeamY = v; }, '#f88'));
    panel.appendChild(makeSlider('beam Z', _lBeamZ, -120, 0, 1, v => { _lBeamZ = v; }, '#f88'));
    panel.appendChild(makeSlider('beam X off', _lBeamXOff, -4, 4, 0.05, v => { _lBeamXOff = v; }, '#f88'));
    panel.appendChild(makeSlider('core radius', _lBeamCoreR, 0.01, 0.5, 0.01, v => { _lBeamCoreR = v; laserMesh.scale.x = v / 0.03; laserMesh.scale.y = v / 0.03; }, '#f88'));
    panel.appendChild(makeSlider('glow radius', _lBeamGlowR, 0.01, 1.0, 0.01, v => { _lBeamGlowR = v; laserGlowMesh.scale.x = v / 0.12; laserGlowMesh.scale.y = v / 0.12; }, '#f88'));

    // LASER BOLTS
    panel.appendChild(makeHeader('LASER BOLTS (T2+)'));
    panel.appendChild(makeSlider('lanes', _lbLanes, 1, 8, 1, v => { _lbLanes = Math.round(v); state._laserBoltLanes = Math.round(v); }, '#f44'));
    panel.appendChild(makeSlider('spread', _lbSpread, 0, 4, 0.05, v => { _lbSpread = v; state._laserBoltSpread = v; }, '#f44'));
    panel.appendChild(makeSlider('Y offset', _lbYOffset, -2, 2, 0.05, v => { _lbYOffset = v; state._laserBoltYOff = v; }, '#f44'));
    panel.appendChild(makeSlider('Z offset', _lbZOffset, -8, 0, 0.1, v => { _lbZOffset = v; state._laserBoltZOff = v; }, '#f44'));
    panel.appendChild(makeSlider('length', _lbLength, 0.5, 10, 0.1, v => {
      _lbLength = v; state._laserBoltLen = v;
      // rescale all pooled bolts
      laserBolts.forEach(b => { const c = b.children[0]; if (c) c.scale.z = v / 2.0; });
    }, '#f44'));
    panel.appendChild(makeSlider('glow len', _lbGlowLen, 0.5, 12, 0.1, v => {
      _lbGlowLen = v; state._laserBoltGlow = v;
      laserBolts.forEach(b => { const g = b.children[1]; if (g) g.scale.z = v / 2.5; });
    }, '#f44'));
    panel.appendChild(makeSlider('fire rate', _lbFireRate, 1, 30, 0.5, v => { _lbFireRate = v; state.laserFireRate = v; }, '#f44'));

    // CANYON MATERIAL
    panel.appendChild(makeHeader('CANYON MATERIAL', '#0ef'));
    panel.appendChild(makeSlider('emissive intensity', _canyonTuner.brightness * 1.8, 0, 8, 0.1, v => {
      _canyonTuner.brightness = v / 1.8;
      if (_canyonWalls) { _canyonWalls.strips.forEach(m => { m.material.emissiveIntensity = v; }); }
    }, '#0ef'));
    panel.appendChild(makeSlider('bloom threshold', bloom.threshold, 0, 1.5, 0.05, v => {
      bloom.threshold = v;
    }, '#0ef'));
    panel.appendChild(makeSlider('bloom strength', bloom.strength, 0, 3, 0.05, v => {
      bloom.strength = v;
    }, '#0ef'));
    panel.appendChild(makeSlider('gridGlow', _canyonTuner.gridGlow, 0, 1, 0.05, v => {
      _canyonTuner.gridGlow = v;
      if (_canyonWalls) { rebuildTex(); }
    }, '#0ef'));
    panel.appendChild(makeSlider('veinBloom', _canyonTuner.veinBloom, 0, 1, 0.05, v => {
      _canyonTuner.veinBloom = v;
      if (_canyonWalls) { rebuildTex(); }
    }, '#0ef'));
  }

  let visible = false;
  window._sceneTunerOpen = false;
  document.addEventListener('keydown', e => {
    if (e.key === 't' || e.key === 'T') {
      visible = !visible;
      window._sceneTunerOpen = visible;
      if (visible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// ── ADMIN MODE: Triple-tap title to toggle ─────────────────────────────────
(function setupAdminMode() {
  const titleEl = document.querySelector('.game-title');
  const panel = document.getElementById('admin-panel');
  if (!titleEl || !panel) return;
  let tapCount = 0, tapTimer = null;
  function onTap(e) {
    e.stopPropagation();
    tapCount++;
    if (tapCount === 1) tapTimer = setTimeout(() => { tapCount = 0; }, 1000);
    if (tapCount >= 3) { clearTimeout(tapTimer); tapCount = 0; panel.classList.toggle('hidden'); }
  }
  titleEl.addEventListener('touchstart', onTap, { passive: true });
  titleEl.addEventListener('click', onTap);
})();

// Ship Z tuner slider (syncs admin panel + settings panel)
(function setupShipZSlider() {
  const sliders = [
    { slider: document.getElementById('ship-z-slider'), label: document.getElementById('ship-z-val') },
    { slider: document.getElementById('ship-z-settings'), label: document.getElementById('ship-z-settings-val') },
  ];
  sliders.forEach(({ slider, label }) => {
    if (!slider || !label) return;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      shipGroup.position.z = v;
      // Sync both sliders
      sliders.forEach(s => {
        if (s.slider) s.slider.value = v;
        if (s.label) s.label.textContent = v.toFixed(1);
      });
    });
  });
})();

// Camera Pitch slider (admin panel)
(function setupCamPitchSlider() {
  const slider = document.getElementById('cam-pitch-slider');
  const label = document.getElementById('cam-pitch-val');
  if (!slider || !label) return;
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    cameraPivot.position.y = v;
    label.textContent = v.toFixed(1);
  });
})();

// Ship Y (hover height) slider — syncs admin panel + settings panel
(function setupShipYSlider() {
  const sliders = [
    { slider: document.getElementById('ship-y-slider'), label: document.getElementById('ship-y-val') },
    { slider: document.getElementById('ship-y-settings'), label: document.getElementById('ship-y-settings-val') },
  ];
  sliders.forEach(({ slider, label }) => {
    if (!slider || !label) return;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      _hoverBaseY = v;
      shipGroup.position.y = v;
      sliders.forEach(s => {
        if (s.slider) s.slider.value = v;
        if (s.label) s.label.textContent = v.toFixed(2);
      });
    });
  });
})();

// ── LAYOUT TUNER ──────────────────────────────────────────────────────────
(function() {
  // Triple-tap skin label to toggle
  let tapCount = 0, tapTimer = null;
  const skinLabel = document.getElementById('skin-viewer-label');
  const tunerPanel = document.getElementById('layout-tuner');
  if (!skinLabel || !tunerPanel) return;

  skinLabel.addEventListener('click', () => {
    tapCount++;
    if (tapCount === 3) {
      tapCount = 0;
      clearTimeout(tapTimer);
      tunerPanel.classList.toggle('hidden');
    } else {
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 500);
    }
  });

  const canvas = document.getElementById('title-ship-canvas');
  const platform = document.querySelector('.platform-pad');
  const viewer = document.querySelector('.skin-viewer');
  const labelEl = document.getElementById('skin-viewer-label');
  const showcase = document.querySelector('.ship-showcase-center');
  const titleEl = document.querySelector('.game-title');

  function bind(sliderId, valId, cb) {
    const s = document.getElementById(sliderId);
    const v = document.getElementById(valId);
    if (!s || !v) return;
    s.addEventListener('input', () => {
      v.textContent = s.value;
      cb(Number(s.value));
    });
  }

  // Portrait defaults
  const PORTRAIT   = { shipX: -1, shipY: -88, shipSize: 100, platX: 1, platY: 100, platSize: 180, labelX: 9,  labelY: -111, titleSize: 100, titleY: -33 };
  // Mobile landscape defaults (phone on its side)
  const LANDSCAPE  = { shipX: 2,  shipY: -52, shipSize: 300, platX: 1, platY: 37, platSize: 104, labelX: 13, labelY: -32, titleSize: 102, titleY: 87 };
  // Desktop defaults
  const DESKTOP    = { shipX: 2, shipY: -1, shipSize: 239, platX: 1, platY: -17, platSize: 166, labelX: 13, labelY: -26, titleSize: 160, titleY: 87 };

  let shipX, shipY, shipSize, platX, platY, platSize, labelX, labelY, titleSize, titleY;

  function _isLandscape() { return window.innerWidth > window.innerHeight; }
  function _isMobileLandscape() { return _isLandscape() && window.innerWidth < 1024; }
  function _isDesktop() { return window.innerWidth >= 1024; }

  function updateShip() {
    if (canvas) canvas.style.transform = 'translate(' + shipX + 'px, ' + shipY + 'px) scale(' + (shipSize / 100) + ')';
  }
  function updatePlat() {
    if (platform) {
      platform.style.bottom = (-10 + platY) + 'px';
      platform.style.transform = 'translateX(calc(-50% + ' + platX + 'px))';
      platform.style.width = platSize + 'px';
    }
  }
  function updateLabel() {
    if (labelEl) labelEl.style.transform = 'translate(' + labelX + 'px, ' + labelY + 'px)';
  }
  function updateTitle() {
    if (titleEl) {
      if (_isLandscape()) {
        titleEl.style.fontSize = titleSize + 'px';
      } else {
        titleEl.style.fontSize = 'clamp(68px,15.3vw,144px)';
      }
      titleEl.style.transform = 'translateY(' + titleY + 'px)';
    }
  }
  function updateLB() {
    const lb = document.getElementById('title-leaderboard');
    if (!lb) return;
    // Only show on title screen
    if (state.phase !== 'title') {
      lb.classList.add('hidden');
      return;
    }
    // Hide on mobile landscape
    if (_isMobileLandscape()) {
      lb.classList.add('hidden');
      return;
    }
    lb.classList.remove('hidden');
    // Desktop: position 10px below the skin label
    if (_isDesktop()) {
      const labelEl = document.querySelector('.skin-viewer-label');
      if (labelEl) {
        const labelRect = labelEl.getBoundingClientRect();
        lb.style.top = (labelRect.bottom + 10) + 'px';
        lb.style.bottom = '0';
      }
    } else {
      lb.style.top = '68%';
      lb.style.bottom = '0';
    }
  }

  function setSlider(id, valId, v) {
    const s = document.getElementById(id);
    const d = document.getElementById(valId);
    if (s) s.value = v;
    if (d) d.textContent = v;
  }

  function applyDefaults() {
    const d = _isDesktop() ? DESKTOP : _isLandscape() ? LANDSCAPE : PORTRAIT;
    shipX = d.shipX; shipY = d.shipY; shipSize = d.shipSize;
    platX = d.platX; platY = d.platY; platSize = d.platSize;
    labelX = d.labelX; labelY = d.labelY;
    titleSize = d.titleSize; titleY = d.titleY;
    setSlider('tune-ship-y', 'val-ship-y', shipY);
    setSlider('tune-ship-x', 'val-ship-x', shipX);
    setSlider('tune-ship-size', 'val-ship-size', shipSize);
    setSlider('tune-plat-y', 'val-plat-y', platY);
    setSlider('tune-plat-x', 'val-plat-x', platX);
    setSlider('tune-plat-size', 'val-plat-size', platSize);
    setSlider('tune-label-y', 'val-label-y', labelY);
    setSlider('tune-label-x', 'val-label-x', labelX);
    setSlider('tune-title-size', 'val-title-size', titleSize);
    setSlider('tune-title-y', 'val-title-y', titleY);
    updateShip(); updatePlat(); updateLabel(); updateTitle(); updateLB();
    // Apply 3D ship orientation per mode
    const tg = titleScene.getObjectByName('titleShipPivot')?.children[0];
    const sg = titleScene.getObjectByName('titleShipPivot');
    if (_isDesktop()) {
      if (tg) { tg.rotation.x = 0.13; tg.rotation.y = 0; tg.rotation.z = 0; }
      if (sg) sg.position.y = -0.10;
      if (_titleShipModel) _titleShipModel.scale.setScalar(0.12);
      titleCamera.position.z = 3.4;
      titleCamera.position.y = 0.35;
      window._titleSpinSpeed = 0.001;
      setSlider('tune-3d-tilt-x', 'val-3d-tilt-x', 13);
      setSlider('tune-3d-spin', 'val-3d-spin', 0);
    } else if (_isLandscape()) {
      if (tg) tg.rotation.x = 0.13;
      setSlider('tune-3d-tilt-x', 'val-3d-tilt-x', 13);
    } else {
      if (tg) tg.rotation.x = Math.PI / 2;
      setSlider('tune-3d-tilt-x', 'val-3d-tilt-x', 157);
    }
  }
  applyDefaults();
  window.addEventListener('resize', applyDefaults);

  // Bind sliders
  bind('tune-ship-y', 'val-ship-y', v => { shipY = v; updateShip(); });
  bind('tune-ship-x', 'val-ship-x', v => { shipX = v; updateShip(); });
  bind('tune-ship-size', 'val-ship-size', v => { shipSize = v; updateShip(); });
  bind('tune-plat-y', 'val-plat-y', v => { platY = v; updatePlat(); });
  bind('tune-plat-x', 'val-plat-x', v => { platX = v; updatePlat(); });
  bind('tune-plat-size', 'val-plat-size', v => { platSize = v; updatePlat(); });
  bind('tune-label-y', 'val-label-y', v => { labelY = v; updateLabel(); });
  bind('tune-label-x', 'val-label-x', v => { labelX = v; updateLabel(); });
  bind('tune-title-size', 'val-title-size', v => { titleSize = v; updateTitle(); });
  bind('tune-title-y', 'val-title-y', v => { titleY = v; updateTitle(); });
  bind('tune-lb-y', 'val-lb-y', v => {
    const lb = document.getElementById('title-leaderboard');
    if (lb) lb.style.top = v + '%';
  });

  // 3D ship orientation sliders (values stored as integers, divided to get floats)
  function bind3d(sliderId, valId, divisor, cb) {
    const s = document.getElementById(sliderId);
    const v = document.getElementById(valId);
    if (!s || !v) return;
    s.addEventListener('input', () => {
      const val = Number(s.value) / divisor;
      v.textContent = val.toFixed(2);
      cb(val);
    });
  }
  bind3d('tune-3d-tilt-x', 'val-3d-tilt-x', 100, v => {
    const tg = titleScene.getObjectByName('titleShipPivot')?.children[0];
    if (tg) tg.rotation.x = v;
  });
  bind3d('tune-3d-tilt-y', 'val-3d-tilt-y', 100, v => {
    const tg = titleScene.getObjectByName('titleShipPivot')?.children[0];
    if (tg) tg.rotation.y = v;
  });
  bind3d('tune-3d-tilt-z', 'val-3d-tilt-z', 100, v => {
    const tg = titleScene.getObjectByName('titleShipPivot')?.children[0];
    if (tg) tg.rotation.z = v;
  });
  bind3d('tune-3d-pivot-y', 'val-3d-pivot-y', 100, v => {
    const sg = titleScene.getObjectByName('titleShipPivot');
    if (sg) sg.position.y = v;
  });
  bind3d('tune-3d-scale', 'val-3d-scale', 100, v => {
    if (_titleShipModel) _titleShipModel.scale.setScalar(v);
  });
  bind3d('tune-3d-cam-z', 'val-3d-cam-z', 10, v => {
    titleCamera.position.z = v; titleCamera.updateProjectionMatrix();
  });
  bind3d('tune-3d-cam-y', 'val-3d-cam-y', 10, v => {
    titleCamera.position.y = v;
  });
  bind3d('tune-3d-spin', 'val-3d-spin', 1000, v => {
    window._titleSpinSpeed = v;
  });
})();

// ═══════════════════════════════════════════════════
//  ANGLED WALL TUNER (key: `)
// ═══════════════════════════════════════════════════
(function() {
  const panel = document.createElement('div');
  panel.id = 'aw-tuner';
  panel.style.cssText = 'position:fixed;top:0;right:0;width:280px;height:100%;background:rgba(0,0,0,0.92);overflow-y:auto;z-index:10001;font-family:monospace;font-size:11px;color:#ccc;padding:10px;box-sizing:border-box;-webkit-overflow-scrolling:touch;border-left:1px solid #333;display:none;';
  document.body.appendChild(panel);

  let built = false;
  function build() {
    if (built) return;
    built = true;

    // Header + pause
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
    const t = document.createElement('span');
    t.textContent = 'WALL TUNER';
    t.style.cssText = 'color:#0ff;font-size:13px;font-weight:bold;letter-spacing:2px;';
    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = 'PAUSE';
    pauseBtn.style.cssText = 'background:#ff0;color:#000;border:none;padding:4px 12px;cursor:pointer;font-family:monospace;font-size:11px;font-weight:bold;';
    pauseBtn.onclick = () => {
      _awTunerPaused = !_awTunerPaused;
      pauseBtn.textContent = _awTunerPaused ? 'PLAY' : 'PAUSE';
      pauseBtn.style.background = _awTunerPaused ? '#0f0' : '#ff0';
    };
    hdr.appendChild(t); hdr.appendChild(pauseBtn);
    panel.appendChild(hdr);

    // Spawn / reset buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;';
    const spawnBtn = document.createElement('button');
    spawnBtn.textContent = 'SPAWN WALLS';
    spawnBtn.style.cssText = 'flex:1;background:#0af;color:#000;border:none;padding:6px;cursor:pointer;font-family:monospace;font-weight:bold;font-size:11px;';
    function _awRespawn() {
      // Clear existing
      [..._awActive].forEach(_returnWallToPool);
      _awActive.length = 0;
      state.angledWallRowsDone = 0;
      if (_awTunerPaused) {
        // Paused: spawn all rows instantly so you can see the full layout
        const rowCount = Math.round(_awTuner.rows);
        for (let r = 0; r < rowCount; r++) {
          // Override SPAWN_Z: place rows spread out in front of ship
          const savedSpawnZ = SPAWN_Z;
          // Temporarily patch the spawn to use staggered Z positions
          const origFn = spawnAngledWallRow;
          // We'll just call it and then move the walls to visible positions
          spawnAngledWallRow();
        }
        // Reposition all walls in a grid in front of the camera
        let rowIdx = 0;
        const cx = Math.max(1, Math.round(_awTuner.copiesX));
        const cy = Math.max(1, Math.round(_awTuner.copiesY));
        const cz = Math.max(1, Math.round(_awTuner.copiesZ));
        const wallsPerRow = cx * cy * cz;
        for (let r = 0; r < rowCount; r++) {
          const rowZ = shipGroup.position.z - 30 - r * _awTuner.zSpacing;
          const angleSign = (r % 2 === 0) ? 1 : -1;
          const baseX = state.shipX + angleSign * _awTuner.xOffset + _awTuner.fieldShift;
          const halfXs = (cx - 1) * _awTuner.spacingX / 2;
          const halfYs = (cy - 1) * _awTuner.spacingY / 2;
          const halfZs = (cz - 1) * _awTuner.spacingZ / 2;
          let wi = 0;
          for (let ix = 0; ix < cx; ix++) {
            for (let iy = 0; iy < cy; iy++) {
              for (let iz = 0; iz < cz; iz++) {
                const idx = r * wallsPerRow + wi;
                if (idx < _awActive.length) {
                  const w = _awActive[idx];
                  w.position.set(
                    baseX - halfXs + ix * _awTuner.spacingX,
                    -halfYs + iy * _awTuner.spacingY,
                    rowZ - halfZs + iz * _awTuner.spacingZ
                  );
                  _applyWallTuner(w, angleSign);
                  w.userData._mesh.material.uniforms.uOpacity.value = _awTuner.opacity;
                  w.userData._edges.material.opacity = _awTuner.opacity * 0.9;
                }
                wi++;
              }
            }
          }
        }
      } else {
        // Playing: spawn rows over time as usual
        state.angledWallsActive = true;
        state.angledWallSpawnZ = -_awTuner.zSpacing;
      }
    }
    spawnBtn.onclick = _awRespawn;
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'CLEAR';
    clearBtn.style.cssText = 'flex:1;background:#f44;color:#fff;border:none;padding:6px;cursor:pointer;font-family:monospace;font-weight:bold;font-size:11px;';
    clearBtn.onclick = () => {
      [..._awActive].forEach(_returnWallToPool);
      _awActive.length = 0;
      state.angledWallsActive = false;
      state.angledWallRowsDone = 0;
    };
    btnRow.appendChild(spawnBtn); btnRow.appendChild(clearBtn);
    panel.appendChild(btnRow);

    function mkSl(label, val, min, max, step, onChange, color) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:2px;';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'width:90px;flex-shrink:0;font-size:10px;';
      const sl = document.createElement('input');
      sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step; sl.value = val;
      sl.style.cssText = 'flex:1;height:12px;cursor:pointer;accent-color:' + (color || '#0af') + ';';
      const vs = document.createElement('span');
      vs.textContent = Number(val).toFixed(step < 0.1 ? 2 : 1);
      vs.style.cssText = 'width:44px;text-align:right;font-size:9px;';
      sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        vs.textContent = Number(v).toFixed(step < 0.1 ? 2 : 1);
        onChange(v);
        // When paused with walls active, full respawn so copies/spacing/rotation update live
        if (_awTunerPaused && _awActive.length > 0) {
          _awRespawn();
        } else {
          // Live-update visual properties on existing walls
          _awActive.forEach((w, idx) => {
            const sign = (idx % 2 === 0) ? 1 : -1;
            _applyWallTuner(w, sign);
            w.userData._mesh.material.uniforms.uOpacity.value = _awTuner.opacity;
            w.userData._edges.material.opacity = _awTuner.opacity * 0.9;
          });
        }
      });
      row.appendChild(lbl); row.appendChild(sl); row.appendChild(vs);
      return row;
    }

    function mkSec(name, color) {
      const s = document.createElement('div');
      s.style.cssText = 'margin:8px 0 4px;border-bottom:1px solid #222;padding-bottom:4px;';
      const h = document.createElement('div');
      h.textContent = name;
      h.style.cssText = 'color:' + color + ';font-weight:bold;font-size:11px;letter-spacing:1px;';
      s.appendChild(h);
      return s;
    }

    // GEOMETRY
    const geoSec = mkSec('GEOMETRY', '#0ff');
    geoSec.appendChild(mkSl('Width', _awTuner.wallW, 10, 100, 1, v => _awTuner.wallW = v, '#0ff'));
    geoSec.appendChild(mkSl('Height', _awTuner.wallH, 4, 40, 1, v => _awTuner.wallH = v, '#0ff'));
    geoSec.appendChild(mkSl('Thickness', _awTuner.thickness, 0.1, 3, 0.05, v => _awTuner.thickness = v, '#0ff'));
    geoSec.appendChild(mkSl('Angle \u00B0', _awTuner.angle, 5, 80, 1, v => _awTuner.angle = v, '#0ff'));
    panel.appendChild(geoSec);

    // SPACING
    const spcSec = mkSec('SPACING', '#f80');
    spcSec.appendChild(mkSl('Z Spacing', _awTuner.zSpacing, 10, 80, 1, v => _awTuner.zSpacing = v, '#f80'));
    spcSec.appendChild(mkSl('X Offset', _awTuner.xOffset, 0, 40, 0.5, v => _awTuner.xOffset = v, '#f80'));
    spcSec.appendChild(mkSl('Rows', _awTuner.rows, 5, 40, 1, v => _awTuner.rows = v, '#f80'));
    spcSec.appendChild(mkSl('Field Shift', _awTuner.fieldShift, -40, 40, 0.5, v => _awTuner.fieldShift = v, '#f80'));
    panel.appendChild(spcSec);

    // COPIES (per-axis)
    const cpSec = mkSec('COPIES', '#ff0');
    cpSec.appendChild(mkSl('X Copies', _awTuner.copiesX, 1, 10, 1, v => _awTuner.copiesX = v, '#ff0'));
    cpSec.appendChild(mkSl('X Gap', _awTuner.spacingX, 2, 80, 1, v => _awTuner.spacingX = v, '#ff0'));
    cpSec.appendChild(mkSl('Y Copies', _awTuner.copiesY, 1, 6, 1, v => _awTuner.copiesY = v, '#ff0'));
    cpSec.appendChild(mkSl('Y Gap', _awTuner.spacingY, 2, 30, 0.5, v => _awTuner.spacingY = v, '#ff0'));
    cpSec.appendChild(mkSl('Z Copies', _awTuner.copiesZ, 1, 6, 1, v => _awTuner.copiesZ = v, '#ff0'));
    cpSec.appendChild(mkSl('Z Gap', _awTuner.spacingZ, 2, 40, 1, v => _awTuner.spacingZ = v, '#ff0'));
    panel.appendChild(cpSec);

    // ROTATION
    const rotSec = mkSec('ROTATION', '#0f0');
    rotSec.appendChild(mkSl('Rot X \u00B0', _awTuner.rotX, -90, 90, 1, v => _awTuner.rotX = v, '#0f0'));
    rotSec.appendChild(mkSl('Rot Y \u00B0', _awTuner.rotY, -90, 90, 1, v => _awTuner.rotY = v, '#0f0'));
    rotSec.appendChild(mkSl('Rot Z \u00B0', _awTuner.rotZ, -90, 90, 1, v => _awTuner.rotZ = v, '#0f0'));
    panel.appendChild(rotSec);

    // COLOR
    const colSec = mkSec('COLOR', '#f0f');
    colSec.appendChild(mkSl('Red', _awTuner.colorR, 0, 1, 0.01, v => _awTuner.colorR = v, '#f44'));
    colSec.appendChild(mkSl('Green', _awTuner.colorG, 0, 1, 0.01, v => _awTuner.colorG = v, '#4f4'));
    colSec.appendChild(mkSl('Blue', _awTuner.colorB, 0, 1, 0.01, v => _awTuner.colorB = v, '#44f'));
    colSec.appendChild(mkSl('Emissive', _awTuner.emissive, 0.5, 6, 0.1, v => _awTuner.emissive = v, '#ff0'));
    colSec.appendChild(mkSl('Opacity', _awTuner.opacity, 0.1, 1, 0.01, v => _awTuner.opacity = v, '#aaa'));
    panel.appendChild(colSec);

    // DUMP button
    const dumpBtn = document.createElement('button');
    dumpBtn.textContent = 'DUMP CONFIG';
    dumpBtn.style.cssText = 'margin-top:12px;width:100%;background:#222;color:#0ff;border:1px solid #0ff;padding:8px;cursor:pointer;font-family:monospace;font-size:11px;font-weight:bold;letter-spacing:1px;';
    dumpBtn.onclick = () => console.log('AW TUNER:', JSON.stringify(_awTuner, null, 2));
    panel.appendChild(dumpBtn);

    // RESET TO DEFAULT button
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'RESET TO DEFAULT';
    resetBtn.style.cssText = 'margin-top:6px;width:100%;background:#222;color:#f44;border:1px solid #f44;padding:8px;cursor:pointer;font-family:monospace;font-size:11px;font-weight:bold;letter-spacing:1px;';
    resetBtn.onclick = () => {
      Object.assign(_awTuner, _awTunerDefaults);
      built = false;
      panel.innerHTML = '';
      build();
      if (_awTunerPaused && _awActive.length > 0) _awRespawn();
    };
    panel.appendChild(resetBtn);
  }

  // Toggle with backtick key (`)
  document.addEventListener('keydown', e => {
    if (e.key === '`') {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const vis = panel.style.display === 'none';
      if (vis) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// ═══════════════════════════════════════════════════
//  TERRAIN TUNER PANEL (hotkey: R)
// ═══════════════════════════════════════════════════
(function() {
  const panel = document.createElement('div');
  panel.id = 'terrain-tuner';
  panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:rgba(0,0,0,0.88);' +
    'border:1px solid #00eeff;border-radius:8px;padding:12px 16px;font:12px monospace;color:#ccc;' +
    'display:none;min-width:220px;max-height:90vh;overflow-y:auto;pointer-events:auto;';
  document.body.appendChild(panel);

  const sliders = [
    { key: 'width',      label: 'Width',       min: 20,  max: 400,  step: 2 },
    { key: 'xOffset',    label: 'X Offset',    min: 0,   max: 200,  step: 1 },
    { key: 'peakHeight', label: 'Peak Height',  min: 2,  max: 200,  step: 1 },
    { key: 'baseY',      label: 'Base Y',       min: -30, max: 20,  step: 0.5 },
    { key: 'metalness',  label: 'Metalness',    min: 0,  max: 1,    step: 0.02 },
    { key: 'roughness',  label: 'Roughness',    min: 0,  max: 1,    step: 0.02 },
    { key: 'gridOpacity',label: 'Grid Opacity',  min: 0, max: 1,    step: 0.05 },
    { key: 'emissiveIntensity', label: 'Emissive', min: 0, max: 5,  step: 0.05 },
  ];

  function build() {
    let html = '<div style="color:#00eeff;font-weight:bold;margin-bottom:8px;">TERRAIN TUNER [R]</div>';
    // ON/OFF toggle button
    const terrainVisible = !_terrainWalls || _terrainWalls.strips[0].visible;
    html += `<button id="tt-toggle" style="width:100%;margin-bottom:10px;padding:6px;font:bold 11px monospace;cursor:pointer;border-radius:3px;border:1px solid ${terrainVisible ? '#f44' : '#0f8'};background:${terrainVisible ? 'rgba(255,60,60,0.15)' : 'rgba(0,255,120,0.15)'};color:${terrainVisible ? '#f88' : '#0f8'};">TERRAIN: ${terrainVisible ? 'ON  — click to hide' : 'OFF — click to show'}</button>`;
    sliders.forEach(s => {
      const val = _terrainTuner[s.key];
      html += `<div style="margin:4px 0;"><label>${s.label}: <span id="tt-${s.key}-val">${val}</span></label><br>`;
      html += `<input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${val}" ` +
        `id="tt-${s.key}" style="width:180px;"></div>`;
    });
    // Color pickers
    html += '<div style="margin:6px 0;"><label>Grid Color: </label>';
    html += `<input type="color" id="tt-gridColor" value="${_terrainTuner.gridColor}" style="width:40px;height:24px;border:none;background:none;"></div>`;
    html += '<div style="margin:6px 0;"><label>Base Color: </label>';
    html += `<input type="color" id="tt-baseColor" value="${_terrainTuner.baseColor}" style="width:40px;height:24px;border:none;background:none;"></div>`;
    // Rebuild button
    html += '<button id="tt-rebuild" style="margin-top:8px;width:100%;background:#222;color:#0ff;border:1px solid #0ff;padding:6px;cursor:pointer;font:11px monospace;font-weight:bold;">REBUILD TERRAIN</button>';
    panel.innerHTML = html;

    // Wire terrain toggle
    document.getElementById('tt-toggle').addEventListener('click', () => {
      if (_terrainWalls) {
        const next = !_terrainWalls.strips[0].visible;
        _terrainWalls.strips.forEach(m => { m.visible = next; });
      }
      build(); // rebuild panel to reflect new state
    });

    // Wire up sliders
    sliders.forEach(s => {
      const inp = document.getElementById('tt-' + s.key);
      const valEl = document.getElementById('tt-' + s.key + '-val');
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        _terrainTuner[s.key] = v;
        valEl.textContent = v;
        _applyTerrainTuner();
      });
    });
    document.getElementById('tt-gridColor').addEventListener('input', (e) => {
      _terrainTuner.gridColor = e.target.value;
    });
    document.getElementById('tt-baseColor').addEventListener('input', (e) => {
      _terrainTuner.baseColor = e.target.value;
    });
    document.getElementById('tt-rebuild').addEventListener('click', () => {
      _destroyTerrainWalls();
      _createTerrainWalls();
    });
  }

  // Apply live-tunable values (no rebuild needed)
  window._applyTerrainTuner = function() {
    if (!_terrainWalls) return;
    const T = _terrainTuner;
    _terrainWalls.mat.metalness = T.metalness;
    _terrainWalls.mat.roughness = T.roughness;
    _terrainWalls.mat.emissiveIntensity = T.emissiveIntensity;
    _terrainWalls.strips.forEach(m => {
      // Determine side from current x position
      const side = m.position.x < 0 ? -1 : 1;
      m.position.x = side * T.xOffset;
      m.position.y = T.baseY;
    });
  };

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'KeyR') {
      const vis = panel.style.display === 'none';
      if (vis) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// ═══════════════════════════════════════════════════
//  SHIP GLB TUNER PANEL (hotkey: G)
// ═══════════════════════════════════════════════════
(function() {
  const panel = document.createElement('div');
  panel.id = 'ship-glb-tuner';
  panel.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;background:rgba(0,0,0,0.92);' +
    'border:1px solid #ff00ff;border-radius:8px;padding:12px 16px;font:11px monospace;color:#ccc;' +
    'display:none;min-width:250px;max-height:92vh;overflow-y:auto;pointer-events:auto;';
  document.body.appendChild(panel);

  function makeSlider(label, val, min, max, step, onChange) {
    const wrap = document.createElement('div');
    wrap.style.margin = '3px 0';
    const lbl = document.createElement('label');
    lbl.style.color = '#ff88ff';
    const valSpan = document.createElement('span');
    valSpan.textContent = typeof val === 'number' ? val.toFixed(3) : val;
    lbl.textContent = label + ': ';
    lbl.appendChild(valSpan);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
    inp.value = val; inp.style.width = '170px';
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      valSpan.textContent = v.toFixed(3);
      onChange(v);
    });
    wrap.appendChild(lbl);
    wrap.appendChild(document.createElement('br'));
    wrap.appendChild(inp);
    return wrap;
  }

  function build() {
    panel.innerHTML = '<div style="color:#ff00ff;font-weight:bold;margin-bottom:6px;">SHIP GLB TUNER [G]</div>';

    // ── Ship Transform ──
    if (_altShipActive) {
    const hdr1 = document.createElement('div');
    hdr1.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr1.textContent = '— SHIP TRANSFORM —';
    panel.appendChild(hdr1);

    panel.appendChild(makeSlider('Pos X', _altShip.posX, -2, 2, 0.01, v => { _altShip.posX = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Pos Y', _altShip.posY, -2, 2, 0.01, v => { _altShip.posY = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Pos Z', _altShip.posZ, -3, 3, 0.01, v => { _altShip.posZ = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Rot X', _altShip.rotX, -Math.PI, Math.PI, 0.01, v => { _altShip.rotX = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Rot Y', _altShip.rotY, -Math.PI, Math.PI, 0.01, v => { _altShip.rotY = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Rot Z', _altShip.rotZ, -Math.PI, Math.PI, 0.01, v => { _altShip.rotZ = v; _updateAltShipTransform(); }));
    panel.appendChild(makeSlider('Scale', _altShip.scale, 0.01, 1.0, 0.001, v => { _altShip.scale = v; _updateAltShipTransform(); }));

    // ── Thruster Positions ──
    const hdr2 = document.createElement('div');
    hdr2.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr2.textContent = '— THRUSTER NOZZLES —';
    panel.appendChild(hdr2);

    const nozzleUpdate = () => {
      NOZZLE_OFFSETS[0].copy(_altShip.nozzleL);
      NOZZLE_OFFSETS[1].copy(_altShip.nozzleR);
      MINI_NOZZLE_OFFSETS[0].copy(_altShip.miniL);
      MINI_NOZZLE_OFFSETS[1].copy(_altShip.miniR);
      _snapshotNozzleBaseline(); // re-anchor baseline to current transform
      _rebuildLocalNozzles();
    };

    panel.appendChild(makeSlider('Noz L x', _altShip.nozzleL.x, -2, 2, 0.01, v => { _altShip.nozzleL.x = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Noz L y', _altShip.nozzleL.y, -1, 1, 0.01, v => { _altShip.nozzleL.y = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Noz L z', _altShip.nozzleL.z, 3, 7, 0.01, v => { _altShip.nozzleL.z = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Noz R x', _altShip.nozzleR.x, -2, 2, 0.01, v => { _altShip.nozzleR.x = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Noz R y', _altShip.nozzleR.y, -1, 1, 0.01, v => { _altShip.nozzleR.y = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Noz R z', _altShip.nozzleR.z, 3, 7, 0.01, v => { _altShip.nozzleR.z = v; nozzleUpdate(); }));

    // ── Mini Thrusters ──
    panel.appendChild(makeSlider('Mini L x', _altShip.miniL.x, -2, 2, 0.01, v => { _altShip.miniL.x = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Mini L y', _altShip.miniL.y, -1, 1, 0.01, v => { _altShip.miniL.y = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Mini L z', _altShip.miniL.z, 3, 7, 0.01, v => { _altShip.miniL.z = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Mini R x', _altShip.miniR.x, -2, 2, 0.01, v => { _altShip.miniR.x = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Mini R y', _altShip.miniR.y, -1, 1, 0.01, v => { _altShip.miniR.y = v; nozzleUpdate(); }));
    panel.appendChild(makeSlider('Mini R z', _altShip.miniR.z, 3, 7, 0.01, v => { _altShip.miniR.z = v; nozzleUpdate(); }));
    } else {
    // Non-GLB ships: direct NOZZLE_OFFSETS sliders
    const hdr2b = document.createElement('div');
    hdr2b.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr2b.textContent = '— THRUSTER NOZZLES —';
    panel.appendChild(hdr2b);

    const nozzleUpdateDirect = () => { _rebuildLocalNozzles(); };

    panel.appendChild(makeSlider('Noz L x', NOZZLE_OFFSETS[0].x, -2, 2, 0.01, v => { NOZZLE_OFFSETS[0].x = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Noz L y', NOZZLE_OFFSETS[0].y, -1, 1, 0.01, v => { NOZZLE_OFFSETS[0].y = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Noz L z', NOZZLE_OFFSETS[0].z, -2, 7, 0.01, v => { NOZZLE_OFFSETS[0].z = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Noz R x', NOZZLE_OFFSETS[1].x, -2, 2, 0.01, v => { NOZZLE_OFFSETS[1].x = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Noz R y', NOZZLE_OFFSETS[1].y, -1, 1, 0.01, v => { NOZZLE_OFFSETS[1].y = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Noz R z', NOZZLE_OFFSETS[1].z, -2, 7, 0.01, v => { NOZZLE_OFFSETS[1].z = v; nozzleUpdateDirect(); }));

    panel.appendChild(makeSlider('Mini L x', MINI_NOZZLE_OFFSETS[0].x, -2, 2, 0.01, v => { MINI_NOZZLE_OFFSETS[0].x = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Mini L y', MINI_NOZZLE_OFFSETS[0].y, -1, 1, 0.01, v => { MINI_NOZZLE_OFFSETS[0].y = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Mini L z', MINI_NOZZLE_OFFSETS[0].z, -2, 7, 0.01, v => { MINI_NOZZLE_OFFSETS[0].z = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Mini R x', MINI_NOZZLE_OFFSETS[1].x, -2, 2, 0.01, v => { MINI_NOZZLE_OFFSETS[1].x = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Mini R y', MINI_NOZZLE_OFFSETS[1].y, -1, 1, 0.01, v => { MINI_NOZZLE_OFFSETS[1].y = v; nozzleUpdateDirect(); }));
    panel.appendChild(makeSlider('Mini R z', MINI_NOZZLE_OFFSETS[1].z, -2, 7, 0.01, v => { MINI_NOZZLE_OFFSETS[1].z = v; nozzleUpdateDirect(); }));
    } // end alt ship / default nozzle sliders

    // ── Thruster Controls ──
    const hdr3 = document.createElement('div');
    hdr3.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr3.textContent = '— THRUSTER CONTROLS —';
    panel.appendChild(hdr3);

    // On/Off toggle
    const togWrap = document.createElement('div');
    togWrap.style.margin = '4px 0 6px';
    const togBtn = document.createElement('button');
    togBtn.textContent = window._thrusterVisible !== false ? 'THRUSTERS: ON' : 'THRUSTERS: OFF';
    togBtn.style.cssText = 'background:' + (window._thrusterVisible !== false ? '#040' : '#400') + ';color:#fff;border:1px solid ' + (window._thrusterVisible !== false ? '#0f0' : '#f00') + ';padding:4px 12px;cursor:pointer;font:11px monospace;';
    togBtn.addEventListener('click', () => {
      window._thrusterVisible = !window._thrusterVisible;
      togBtn.textContent = window._thrusterVisible ? 'THRUSTERS: ON' : 'THRUSTERS: OFF';
      togBtn.style.background = window._thrusterVisible ? '#040' : '#400';
      togBtn.style.borderColor = window._thrusterVisible ? '#0f0' : '#f00';
    });
    togWrap.appendChild(togBtn);
    panel.appendChild(togWrap);

    panel.appendChild(makeSlider('Thruster Scale', window._thrusterScale || 1.0, 0.01, 5, 0.05, v => {
      window._thrusterScale = v;
      window._baseThrusterScale = v;
      if (_altShipActive) _altShip.thrusterScale = v;
    }));
    panel.appendChild(makeSlider('Spread X (wider)', window._thrusterSpreadX || 1.0, 0.1, 10, 0.1, v => {
      window._thrusterSpreadX = v;
    }));
    panel.appendChild(makeSlider('Spread Y (flat/tall)', window._thrusterSpreadY || 1.0, 0.1, 10, 0.1, v => {
      window._thrusterSpreadY = v;
    }));
    panel.appendChild(makeSlider('Length', window._thrusterLength || 1.0, 0.1, 5, 0.1, v => {
      window._thrusterLength = v;
    }));

    // ── Bloom / Glow ──
    const hdr4 = document.createElement('div');
    hdr4.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr4.textContent = '— BLOOM / GLOW —';
    panel.appendChild(hdr4);

    panel.appendChild(makeSlider('Bloom Size', window._nozzleBloomScale || 1.0, 0, 5, 0.1, v => {
      window._nozzleBloomScale = v;
    }));
    panel.appendChild(makeSlider('Bloom Opacity', window._nozzleBloomOpacity != null ? window._nozzleBloomOpacity : 0.34, 0, 1, 0.01, v => {
      window._nozzleBloomOpacity = v;
    }));
    panel.appendChild(makeSlider('Mini Bloom Size', window._miniBloomScale || 1.0, 0, 5, 0.1, v => {
      window._miniBloomScale = v;
    }));

    // ── Cone Thruster ──
    const hdrCone = document.createElement('div');
    hdrCone.style.cssText = 'color:#ff6600;margin:8px 0 4px;font-weight:bold;';
    hdrCone.textContent = '— CONE THRUSTER —';
    panel.appendChild(hdrCone);

    // Cone on/off toggle
    const coneTogBtn = document.createElement('button');
    coneTogBtn.textContent = window._coneThrustersEnabled ? 'Cone Thrusters: ON' : 'Cone Thrusters: OFF';
    coneTogBtn.style.cssText = 'background:' + (window._coneThrustersEnabled ? '#040' : '#400') + ';color:#fff;border:1px solid ' + (window._coneThrustersEnabled ? '#0f0' : '#f00') + ';padding:4px 12px;cursor:pointer;font:11px monospace;margin:4px 4px 4px 0;';
    coneTogBtn.addEventListener('click', () => {
      window._coneThrustersEnabled = !window._coneThrustersEnabled;
      coneTogBtn.textContent = window._coneThrustersEnabled ? 'Cone Thrusters: ON' : 'Cone Thrusters: OFF';
      coneTogBtn.style.background = window._coneThrustersEnabled ? '#040' : '#400';
      coneTogBtn.style.borderColor = window._coneThrustersEnabled ? '#0f0' : '#f00';
    });
    panel.appendChild(coneTogBtn);

    const ct = window._coneThruster;
    const hideOldBtn = document.createElement('button');
    hideOldBtn.textContent = 'Toggle Old Thrusters';
    hideOldBtn.style.cssText = 'background:#333;color:#ff6600;border:1px solid #ff6600;padding:4px 12px;cursor:pointer;font:11px monospace;margin:4px 0;';
    hideOldBtn.addEventListener('click', () => {
      window._hideOldThrusters = !window._hideOldThrusters;
      hideOldBtn.textContent = window._hideOldThrusters ? 'Old Thrusters: OFF' : 'Old Thrusters: ON';
    });
    panel.appendChild(hideOldBtn);
    panel.appendChild(makeSlider('Cone Length', ct.length, 0.5, 8, 0.1, v => { ct.length = v; }));
    panel.appendChild(makeSlider('Cone Radius', ct.radius, 0.02, 1, 0.01, v => { ct.radius = v; }));
    panel.appendChild(makeSlider('Cone Rot X', ct.rotX, -3.15, 3.15, 0.01, v => { ct.rotX = v; }));
    panel.appendChild(makeSlider('Cone Rot Y', ct.rotY, -3.15, 3.15, 0.01, v => { ct.rotY = v; }));
    panel.appendChild(makeSlider('Cone Rot Z', ct.rotZ, -3.15, 3.15, 0.01, v => { ct.rotZ = v; }));
    panel.appendChild(makeSlider('Cone Off X', ct.offX, -2, 2, 0.01, v => { ct.offX = v; }));
    panel.appendChild(makeSlider('Cone Off Y', ct.offY, -2, 2, 0.01, v => { ct.offY = v; }));
    panel.appendChild(makeSlider('Cone Off Z', ct.offZ, -2, 2, 0.01, v => { ct.offZ = v; }));
    panel.appendChild(makeSlider('Neon Power', ct.neonPower, 0.5, 6, 0.1, v => { ct.neonPower = v; }));
    panel.appendChild(makeSlider('Noise Speed', ct.noiseSpeed, 0, 5, 0.1, v => { ct.noiseSpeed = v; }));
    panel.appendChild(makeSlider('Noise Strength', ct.noiseStrength, 0, 1, 0.01, v => { ct.noiseStrength = v; }));
    panel.appendChild(makeSlider('Fresnel Power', ct.fresnelPower, 0.5, 6, 0.1, v => { ct.fresnelPower = v; }));
    panel.appendChild(makeSlider('Cone Opacity', ct.opacity, 0, 1, 0.01, v => { ct.opacity = v; }));

    // ── Heat Haze (low poly only) ──
    const hdrHaze = document.createElement('div');
    hdrHaze.style.cssText = 'color:#00ccff;margin:8px 0 4px;font-weight:bold;';
    hdrHaze.textContent = '— HEAT HAZE —';
    panel.appendChild(hdrHaze);

    if (typeof _thrusterHazePass !== 'undefined' && _thrusterHazePass && _thrusterHazePass.uniforms) {
    panel.appendChild(makeSlider('Haze Intensity', _thrusterHazePass.uniforms.uIntensity.value || 0.7, 0, 2, 0.05, v => {
      window._hazeBaseIntensity = v;
    }));
    panel.appendChild(makeSlider('Haze Radius', _thrusterHazePass.uniforms.uRadius.value, 0.02, 0.4, 0.01, v => {
      _thrusterHazePass.uniforms.uRadius.value = v;
    }));
    panel.appendChild(makeSlider('Haze Direction', _thrusterHazePass.uniforms.uHazeDir.value, -3, 3, 0.1, v => {
      _thrusterHazePass.uniforms.uHazeDir.value = v;
    }));
    } else {
      panel.appendChild(document.createTextNode('(Haze pass not initialized — start a run first)'));
    }

    // ── Material ──
    const hdr5 = document.createElement('div');
    hdr5.style.cssText = 'color:#ff88ff;margin:8px 0 4px;font-weight:bold;';
    hdr5.textContent = '— MATERIAL —';
    panel.appendChild(hdr5);

    const _getMeshes = () => _altShipModel && _altShipModel.userData._altMeshes ? _altShipModel.userData._altMeshes : [];
    const _matUpdate = (fn) => { _getMeshes().forEach(m => { if (m.material) { fn(m.material); m.material.needsUpdate = true; } }); };

    const _initEmR = _getMeshes().length > 0 && _getMeshes()[0].material ? _getMeshes()[0].material.emissiveIntensity : 1.0;
    const _initMet = _getMeshes().length > 0 && _getMeshes()[0].material ? _getMeshes()[0].material.metalness : 0.3;
    const _initRgh = _getMeshes().length > 0 && _getMeshes()[0].material ? _getMeshes()[0].material.roughness : 0.5;

    panel.appendChild(makeSlider('Emissive Boost', _initEmR, 0, 3, 0.05, v => {
      _matUpdate(m => { m.emissiveIntensity = v; });
    }));
    panel.appendChild(makeSlider('Metalness', _initMet, 0, 1, 0.05, v => {
      _matUpdate(m => { m.metalness = v; });
    }));
    panel.appendChild(makeSlider('Roughness', _initRgh, 0, 1, 0.05, v => {
      _matUpdate(m => { m.roughness = v; });
    }));

    // Color override button
    const colorWrap = document.createElement('div');
    colorWrap.style.margin = '4px 0';
    const colorLbl = document.createElement('label');
    colorLbl.style.color = '#ff88ff';
    colorLbl.textContent = 'Emissive Color: ';
    const colorInp = document.createElement('input');
    colorInp.type = 'color';
    colorInp.value = '#333333';
    colorInp.style.cssText = 'width:50px;height:22px;border:none;cursor:pointer;vertical-align:middle;';
    colorInp.addEventListener('input', () => {
      const c = new THREE.Color(colorInp.value);
      _matUpdate(m => { m.emissive.copy(c); });
    });
    colorWrap.appendChild(colorLbl);
    colorWrap.appendChild(colorInp);
    panel.appendChild(colorWrap);

    // ── Log Values Button ──
    const logBtn = document.createElement('button');
    logBtn.textContent = 'LOG VALUES TO CONSOLE';
    logBtn.style.cssText = 'background:#222;color:#0f0;border:1px solid #0f0;padding:4px 12px;cursor:pointer;font:11px monospace;margin-top:8px;';
    logBtn.addEventListener('click', () => {
      console.log('[SHIP TUNER] _altShip =', JSON.stringify({
        posX: _altShip.posX, posY: _altShip.posY, posZ: _altShip.posZ,
        rotX: _altShip.rotX, rotY: _altShip.rotY, rotZ: _altShip.rotZ,
        scale: _altShip.scale,
        nozzleL: { x: _altShip.nozzleL.x, y: _altShip.nozzleL.y, z: _altShip.nozzleL.z },
        nozzleR: { x: _altShip.nozzleR.x, y: _altShip.nozzleR.y, z: _altShip.nozzleR.z },
        miniL: { x: _altShip.miniL.x, y: _altShip.miniL.y, z: _altShip.miniL.z },
        miniR: { x: _altShip.miniR.x, y: _altShip.miniR.y, z: _altShip.miniR.z },
        thrusterScale: _altShip.thrusterScale,
        spreadX: window._thrusterSpreadX, spreadY: window._thrusterSpreadY,
        length: window._thrusterLength,
        bloomSize: window._nozzleBloomScale, bloomOpacity: window._nozzleBloomOpacity,
        miniBloomSize: window._miniBloomScale,
      }, null, 2));
    });
    panel.appendChild(logBtn);
  }

  let visible = false;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'KeyG') {
      visible = !visible;
      if (visible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// ═══════════════════════════════════════════════════════════════════════════════
//  FLAMING ASTEROID SYSTEM
//  Rocky enflamed asteroids fall from sky on diagonal trajectories.
//  Tutorial mode only (gated by _asteroidTuner.enabled).
//  Architecture:
//    - _asteroidGroup: THREE.Group pooled per asteroid
//    - Rock shell: IcosahedronGeometry + custom ShaderMaterial (lava cracks via FBM)
//    - Fire shell: slightly larger icosahedron, additive blending, vertex displacement
//    - PointLight child: orange glow casts on water as it falls
//    - Tail particles: BufferGeometry points trailing behind
//    - Impact warning: glow disc on water at projected landing X
//    - Impact: water shockwave + kill check + ripple burst
//    - Pattern: sweep / stagger / random / salvo
// ═══════════════════════════════════════════════════════════════════════════════

// ── Tuner config (all live-editable via panel, key='Y') ──────────────────────
let _chaosMode  = false;  // combined asteroid + lightning stagger mode
let _chaosLevel = 0.0;    // 0=chill stagger, 1=physically impossible

// Chaos curve helpers — called every tick when _chaosMode is on
// Returns the effective frequency (seconds) for a given chaos level
function _chaosAstFreq(c)  { return 3.0 - c * 2.6; }          // 3.0s → 0.4s
function _chaosLtFreq(c)   { return 3.5 - c * 3.2; }          // 3.5s → 0.3s
function _chaosStaggerGap(c){ return 0.8 - c * 0.65; }        // 0.8s → 0.15s
function _chaosLtStaggerGap(c){ return 0.7 - c * 0.58; }      // 0.7s → 0.12s
function _chaosSalvo(c)    { return Math.round(1 + c * 6); }   // 1 → 7 shots

const _asteroidTuner = {
  enabled:        false,   // master on/off (tutorial only)
  size:           1.2,     // base radius (world units)
  sizeVariance:   0.4,     // ± random added to size
  frequency:      3.5,     // seconds between spawns (per pattern unit)
  speed:          200,     // travel speed (units/s along trajectory)
  leadFactor:     1.0,     // partial lead: 0=no lead (aim at current X), 1=perfect intercept, 0.6=forgiving
  skyHeight:      42,      // Y spawn height above water at the horizon
  //
  // TRAJECTORY — three independent axes, all slider-controlled:
  //   trajZ  : how far toward the camera the asteroid travels on Z.
  //            0 = lands at the horizon, 160 = lands right at the ship.
  //            Default ~140 so it visibly crosses the whole play field.
  //   trajY  : how far it drops on Y (sky → water). Driven by skyHeight
  //            automatically, but offset here lets you keep height and
  //            shorten/lengthen the Y drop independently.
  //   trajX  : lateral drift added on top of the targeted lane X.
  //            0 = dead-on the lane, higher = random side-scatter.
  trajZ:          140,     // Z distance traveled toward camera (0–160)
  trajY:          1.0,     // multiplier on the Y drop (skyHeight → 0). 1=full drop
  trajX:          0.0,     // ± random lateral scatter at spawn (0 = straight-on, no jitter)
  fireIntensity:  1.0,     // fire shell opacity multiplier
  trailLength:    1.0,     // particle trail length multiplier
  glowRange:      14,      // PointLight range
  killRadius:     2.2,     // collision kill radius at water level
  // Pattern
  pattern:        'random', // 'random' | 'sweep' | 'stagger' | 'salvo'
  sweepSpeed:     0.4,     // lanes/sec for sweep pattern
  pinchStep:      0.12,    // how much the pinch closes per tick (independent of sweepSpeed)
  pinchSpread:    1.0,     // arm spread multiplier: 1=full lane width, 0.5=half, 2=extra wide
  chaseFlank:     0.25,    // chase flank offset as fraction of lane range (0=no flanks, 0.5=wide)
  staggerDual:    false,   // when true: each stagger step fires a 2nd shot at predicted position
  staggerGap:     0.8,     // seconds between stagger drops — tight enough to force movement
  salvoCount:     5,       // how many shots in a stagger/salvo burst
  laneMin:        -8,      // leftmost lane X
  laneMax:         8,      // rightmost lane X
  warningTime:    1.8,     // seconds warning disc shows before impact
  showWarning:    true,    // toggle warning disc on/off
  // Chase difficulty ramp
  chaseRampStart: 4.0,     // initial mirror interval (seconds) — forgiving
  chaseRampEnd:   1.2,     // final mirror interval (seconds) — ruthless
  chaseRampDuration: 90,   // seconds over which ramp plays out
  // Filler (decorative background asteroids)
  lateralEnabled: true,   // spawn lateral asteroids on own timer independent of stagger
  lateralFreq:    0.8,    // seconds between lateral spawns
  lateralMinOff:  15,     // min X offset from shipX
  lateralMaxOff:  50,     // max X offset from shipX
  _lateralTimer:  0,      // internal timer
  fillerEnabled:  true,    // toggle on/off
  fillerFreq:      0.4,    // seconds between filler spawns
  fillerLaneMin:  -20,     // X range — wider than normal to sell depth
  fillerLaneMax:   20,
  fillerSkyHeight: 25,     // spawn height (independent of main skyHeight)
  fillerSizeMin:   0.15,   // scale at max distance from center
  fillerSizeMax:   0.55,   // scale at center
  fillerSpeedMin:  1.2,    // speed multiplier at max distance (fast = far)
  fillerSpeedMax:  0.7,    // speed multiplier at center (slower = closer)
};

// ── Shaders ──────────────────────────────────────────────────────────────────
const _asteroidRockVS = `
varying vec3 vNormal;
varying vec3 vPos;
uniform float uTime;

// Simple hash + FBM for vertex displacement
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  float n=mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                  mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
              mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                  mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  return n*2.0-1.0;
}
float fbm(vec3 p){
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){v+=a*noise3(p); p*=2.1; a*=0.5;}
  return v;
}

void main(){
  vNormal = normalize(normalMatrix * normal);
  // Distort vertex position to make chunky irregular rock
  vec3 displaced = position + normal * (fbm(position * 1.8 + uTime * 0.05) * 0.28);
  vPos = displaced;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}`;

const _asteroidRockFS = `
varying vec3 vNormal;
varying vec3 vPos;
uniform float uTime;

float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z)*2.0-1.0;
}
float fbm(vec3 p){
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){v+=a*noise3(p); p*=2.1; a*=0.5;}
  return v;
}

void main(){
  float nml = dot(normalize(vNormal), vec3(0.0, 1.0, -0.5)) * 0.5 + 0.5;
  // Lava crack pattern: narrow high-contrast ridges
  float crack = fbm(vPos * 3.2 + uTime * 0.12);
  float crack2 = fbm(vPos * 5.8 - uTime * 0.08);
  float lava = smoothstep(0.22, 0.55, crack) * smoothstep(0.18, 0.48, crack2);
  lava = clamp(lava, 0.0, 1.0);

  // Base rock: very dark basalt with slight roughness shading
  vec3 rockColor = mix(vec3(0.06, 0.04, 0.04), vec3(0.18, 0.10, 0.06), nml * 0.5 + fbm(vPos*1.1)*0.3);
  // Lava: glowing orange/red/yellow
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0 + vPos.y * 4.0);
  vec3 lavaColor = mix(vec3(1.0, 0.18, 0.0), vec3(1.0, 0.72, 0.0), crack * pulse);

  vec3 col = mix(rockColor, lavaColor, lava);
  // Emissive hotspots where lava is strongest
  float emission = lava * lava * 2.5 * pulse;
  col = col + lavaColor * emission * 0.6;

  gl_FragColor = vec4(col, 1.0);
}`;

const _asteroidFireVS = `
varying float vAlpha;
varying vec3 vPos;
uniform float uTime;
uniform float uRadius;

float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z)*2.0-1.0;
}
float fbm(vec3 p){
  float v=0.0,a=0.5;
  for(int i=0;i<3;i++){v+=a*noise3(p); p*=2.1; a*=0.5;}
  return v;
}

void main(){
  // Vertex displacement: fire billows outward from surface
  float n = fbm(position * 1.6 + uTime * 0.35);
  vec3 disp = position + normalize(position) * (n * 0.45 + 0.12) * uRadius;
  vPos = disp;

  // Alpha: opaque at equator, fade at poles — fire wraps belly
  float polarFade = 1.0 - abs(normalize(position).y);
  vAlpha = clamp(polarFade * 1.2, 0.0, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(disp, 1.0);
}`;

const _asteroidFireFS = `
varying float vAlpha;
varying vec3 vPos;
uniform float uTime;
uniform float uIntensity;

float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z)*2.0-1.0;
}
float fbm(vec3 p){
  float v=0.0,a=0.5;
  for(int i=0;i<4;i++){v+=a*noise3(p); p*=2.1; a*=0.5;}
  return v;
}

void main(){
  float f = fbm(vPos * 2.5 + vec3(0.0, uTime * 0.8, uTime * 0.3));
  f = f * 0.5 + 0.5;
  // Fire color ramp: core=white-yellow, mid=orange, outer=deep red
  vec3 fireInner = vec3(1.0, 0.95, 0.5);
  vec3 fireMid   = vec3(1.0, 0.38, 0.0);
  vec3 fireOuter = vec3(0.6, 0.05, 0.0);
  vec3 col = mix(fireOuter, fireMid, f);
  col = mix(col, fireInner, smoothstep(0.55, 0.85, f));

  float alpha = vAlpha * (0.55 + 0.45 * f) * uIntensity;
  gl_FragColor = vec4(col, alpha);
}`;

// Impact warning disc shader (glows on water at landing point)
const _asteroidWarnVS = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const _asteroidWarnFS = `
varying vec2 vUv;
uniform float uProgress; // 0=just appeared, 1=impact
uniform float uTime;
void main(){
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  // Pulsing outer ring + inner glow
  float ring = smoothstep(0.75, 0.85, r) * smoothstep(1.0, 0.85, r);
  float inner = smoothstep(0.6, 0.0, r) * 0.25;
  // Pulse gets more frantic as progress → 1
  float pulse = 0.6 + 0.4 * sin(uTime * (4.0 + uProgress * 12.0));
  float alpha = (ring + inner) * pulse * (0.4 + uProgress * 0.6);
  // Color: orange→red as impact nears
  vec3 col = mix(vec3(1.0, 0.55, 0.0), vec3(1.0, 0.1, 0.0), uProgress);
  gl_FragColor = vec4(col, alpha);
}`;

// ── Pool + state ─────────────────────────────────────────────────────────────
const _AST_POOL_SIZE = 12;
const _asteroidPool  = [];      // { group, rockMesh, fireMesh, light, tailGeo, tailPts, warnMesh, warnMat, active, ... }
let   _asteroidActive = [];     // refs into pool currently in flight
let   _astTimer = 0;            // time until next spawn
let   _astSweepX = 0;           // current sweep lane X
let   _astSweepDir = 1;
let   _astStaggerQueue = [];    // pending stagger/salvo lane Xs
let   _astStaggerT = 0;

// Tail particle constants
const _AST_TAIL_COUNT = 60;

function _buildAsteroidInstance() {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // Rock shell
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rockMat = new THREE.ShaderMaterial({
    vertexShader: _asteroidRockVS,
    fragmentShader: _asteroidRockFS,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
  });
  const rockMesh = new THREE.Mesh(rockGeo, rockMat);
  group.add(rockMesh);

  // Fire shell (slightly larger, additive)
  const fireGeo = new THREE.IcosahedronGeometry(1, 2);
  const fireMat = new THREE.ShaderMaterial({
    vertexShader: _asteroidFireVS,
    fragmentShader: _asteroidFireFS,
    uniforms: {
      uTime:      { value: 0 },
      uRadius:    { value: 1.0 },
      uIntensity: { value: 1.0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fireMesh = new THREE.Mesh(fireGeo, fireMat);
  fireMesh.scale.setScalar(1.28);
  group.add(fireMesh);

  // PointLight (orange glow, added to scene not group so it doesn't inherit scale issues)
  const light = new THREE.PointLight(0xff5500, 0, 14);
  light.visible = false;
  scene.add(light);

  // Tail particles
  const tailPositions = new Float32Array(_AST_TAIL_COUNT * 3);
  const tailAlphas    = new Float32Array(_AST_TAIL_COUNT);
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPositions, 3));
  tailGeo.setAttribute('alpha',    new THREE.BufferAttribute(tailAlphas, 1));
  const tailMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      attribute float alpha;
      varying float vAlpha;
      void main(){
        vAlpha = alpha;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (80.0 / -mvPos.z) * alpha;
        gl_Position = projectionMatrix * mvPos;
      }`,
    fragmentShader: `
      varying float vAlpha;
      void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        if(d > 0.5) discard;
        float a = (1.0 - d*2.0) * vAlpha;
        gl_FragColor = vec4(1.0, 0.45 + vAlpha*0.3, 0.0, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const tailPts = new THREE.Points(tailGeo, tailMat);
  tailPts.frustumCulled = false;
  scene.add(tailPts);

  // Warning disc on water
  const warnGeo = new THREE.CircleGeometry(1, 32);
  const warnMat = new THREE.ShaderMaterial({
    vertexShader: _asteroidWarnVS,
    fragmentShader: _asteroidWarnFS,
    uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const warnMesh = new THREE.Mesh(warnGeo, warnMat);
  warnMesh.rotation.x = -Math.PI / 2;
  warnMesh.position.y = 0.12;
  warnMesh.visible = false;
  scene.add(warnMesh);

  // Tail history ring buffer
  const tailHistory = [];
  for (let i = 0; i < _AST_TAIL_COUNT; i++) tailHistory.push(new THREE.Vector3(0, 999, 0));

  return {
    group, rockMesh, fireMesh, light, tailGeo, tailPts, tailHistory,
    warnMesh, warnMat,
    active: false,
    // per-instance state
    vel: new THREE.Vector3(),
    radius: 1,
    landingX: 0,
    landingZ: 0,
    warnTimer: 0,
    totalFallTime: 0,
    elapsed: 0,
    tailWriteIdx: 0,
    tailTimer: 0,
  };
}

// Build pool
for (let _ai = 0; _ai < _AST_POOL_SIZE; _ai++) _asteroidPool.push(_buildAsteroidInstance());

// ── Pre-warm shaders: force GPU compile on all pool instances before first spawn
// so the first real asteroid doesn't cause a hitch. We render each mesh once
// at an off-screen position using renderer.compile().
(function _preWarmAsteroidShaders() {
  // Compile all unique ShaderMaterials by building throwaway meshes with the same
  // material — never touching the actual pool groups so scene membership is untouched.
  const _warmScene = new THREE.Scene();
  const _warmCam   = new THREE.PerspectiveCamera();
  const _warmGeo   = new THREE.IcosahedronGeometry(1, 2); // tiny proxy geometry
  const _seenMats  = new Set();
  for (const inst of _asteroidPool) {
    for (const mat of [inst.rockMesh.material, inst.fireMesh.material,
                       inst.tailPts.material, inst.warnMat]) {
      if (mat && !_seenMats.has(mat)) {
        _seenMats.add(mat);
        const proxy = new THREE.Mesh(_warmGeo, mat);
        _warmScene.add(proxy);
      }
    }
  }
  try { renderer.compile(_warmScene, _warmCam); } catch(e) {}
  _warmGeo.dispose();
  // _warmScene and proxy meshes go out of scope and are GC'd
})();

// ── Helper: get free instance from pool ──────────────────────────────────────
function _getAsteroidFromPool() {
  return _asteroidPool.find(a => !a.active) || null;
}

// ── Spawn one asteroid ───────────────────────────────────────────────────────
function _spawnAsteroid(targetX) {
  const inst = _getAsteroidFromPool();
  if (!inst) return;
  const T = _asteroidTuner;
  const radius = T.size + (Math.random() - 0.5) * T.sizeVariance * 2;

  // ── Trajectory ──
  // Spawn at the horizon (SPAWN_Z, same as cones), elevated by skyHeight.
  // Land position is driven by three independent tuner sliders:
  //   trajZ  → how far toward the camera it travels (landZ = spawnZ + trajZ)
  //   trajY  → multiplier on height drop (1.0 = full drop to water)
  //   trajX  → lateral jitter at spawn point
  // Spawn at horizon, elevated
  const spawnY = T.skyHeight;
  const spawnZ = SPAWN_Z; // -160

  // Landing point: always at ship Z (ship is static, world scrolls)
  const landZ = shipGroup.position.z;
  const landY = 0.15;

  // ── Quadratic intercept targeting ──────────────────────────────────────────
  // totalTime: straight-line fall from (spawnX, spawnY, spawnZ) to (landX, landY, landZ).
  // Since vel.x will be 0 (spawnX = landX), only Y and Z contribute to distance.
  const totalTime = Math.sqrt((landY - spawnY) ** 2 + (landZ - spawnZ) ** 2) / T.speed;

  // Predict where the ship will actually be when the asteroid lands:
  //   landX = targetX + shipVelX * totalTime
  // This is pure physics — if the ship keeps its current velocity it will be here at impact.
  // leadFactor lets you dial it back (1.0 = perfect prediction, 0.6 = gives player a chance to escape).
  const shipVelX_now = (state && state.shipVelX) || 0;
  const landX = targetX + shipVelX_now * totalTime * T.leadFactor;

  // Spawn X = same as landX so trajectory is straight down-forward (vel.x = 0)
  const spawnX = landX;

  // Velocity vector: reuse pooled vector on inst to avoid GC allocation
  inst.vel.set(
    (landX - spawnX) / totalTime,
    (landY - spawnY) / totalTime,
    (landZ - spawnZ) / totalTime
  );

  // Scale meshes to radius
  inst.group.scale.setScalar(radius);
  inst.rockMesh.material.uniforms.uTime.value = Math.random() * 100;
  inst.fireMesh.material.uniforms.uTime.value  = Math.random() * 100;
  inst.fireMesh.material.uniforms.uRadius.value = radius;
  inst.fireMesh.material.uniforms.uIntensity.value = T.fireIntensity;

  inst.group.position.set(spawnX, spawnY, spawnZ);
  inst.group.visible = true;

  // transparent + depthWrite already set at build time — do NOT reassign here,
  // assigning material properties triggers needsUpdate which forces a shader recompile.

  inst.light.position.copy(inst.group.position);
  inst.light.distance  = T.glowRange * radius;
  inst.light.intensity = 0; // fades in with opacity
  inst.light.visible   = true;

  // Warning disc at landing point (hidden until asteroid fades in enough)
  const warnRadius = Math.max(3.0, radius * 2.5);
  inst.warnMesh.position.set(landX, 0.12, landZ);
  inst.warnMesh.scale.setScalar(warnRadius);
  inst.warnMesh.visible = false; // shown once fadeT > 0.3
  inst.warnMat.uniforms.uProgress.value = 0;
  inst.warnMat.uniforms.uTime.value = 0;

  // Randomize rotation
  inst.group.rotation.set(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2
  );

  inst.radius   = radius;
  inst.landingX = landX;
  inst.landingZ = landZ;
  inst.totalFallTime = totalTime;
  inst.elapsed  = 0;
  inst.warnTimer = 0;
  inst.tailWriteIdx = 0;
  inst.tailTimer = 0;
  // Reset tail history
  for (let ti = 0; ti < _AST_TAIL_COUNT; ti++) inst.tailHistory[ti].set(0, 999, 0);
  inst.tailPts.visible = true;
  inst.active = true;

  _asteroidActive.push(inst);
  return inst;
}

// ── Kill one asteroid ─────────────────────────────────────────────────────────
function _killAsteroid(inst, impact) {
  inst.active = false;
  inst.isFiller = false; // reset so pool reuse is clean
  inst.group.visible = false;
  inst.light.visible = false;
  inst.tailPts.visible = false;
  inst.warnMesh.visible = false;

  if (impact) {
    // Water shockwave at landing point
    _triggerShockwave(new THREE.Vector3(inst.landingX, 0.5, inst.landingZ));
    if (!inst.isFiller) _playAsteroidImpact();
    // Burst wake rings (capped at 3 to avoid frame hitch)
    for (let ri = 0; ri < 3; ri++) {
      spawnWakeRing(
        inst.landingX + (Math.random()-0.5)*inst.radius,
        inst.landingZ + (Math.random()-0.5)*inst.radius,
        (Math.random()-0.5)*2
      );
    }
    // Kill check: use asteroid's ACTUAL world position at impact, not pre-stored landing coords.
    if (state.phase === 'playing' && !inst.isFiller) {
      const ax = inst.group.position.x;
      const az = inst.group.position.z;
      const dx = state.shipX - ax;
      const dz = shipGroup.position.z - az;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist < _asteroidTuner.killRadius * inst.radius) {
        if (state._tutorialActive || _godMode) {
          // Tutorial / god mode: play shield-hit sound, no death
          const _shHitSfx = document.getElementById('shield-hit-sfx');
          if (_shHitSfx) { _shHitSfx.currentTime = 0; _shHitSfx.play().catch(()=>{}); }
          addCrashFlash(0xff4400);
        } else {
          killPlayer();
        }
      }
    }
    // Flash the warning disc briefly (already hidden but trigger shockwave covers it)
  }

  const idx = _asteroidActive.indexOf(inst);
  if (idx >= 0) _asteroidActive.splice(idx, 1);
}

// ── Pattern: generate next target X ──────────────────────────────────────────
function _astNextTargetX() {
  const T = _asteroidTuner;
  const range = T.laneMax - T.laneMin;
  const sx = (state && state.shipX) || 0; // always center patterns on ship
  switch (T.pattern) {
    case 'sweep': {
      const x = sx + (_astSweepX - 0.5) * range;
      _astSweepX += _astSweepDir * T.sweepSpeed * T.frequency / range * 0.12;
      if (_astSweepX >= 1.0 || _astSweepX <= 0.0) { _astSweepDir *= -1; _astSweepX = THREE.MathUtils.clamp(_astSweepX, 0, 1); }
      return x;
    }
    case 'stagger': {
      // Always read ship X fresh so each shot tracks the live position
      // Small random nudge keeps it from being perfectly predictable
      const liveX = (state && state.shipX) || 0;
      return liveX + (Math.random() - 0.5) * 1.5;
    }
    case 'salvo': {
      // Handled specially in spawn tick — fallback to random near ship
      return sx + (Math.random() - 0.5) * range * 0.5;
    }
    default: // 'random' — tight scatter around ship so every shot is a threat
      return sx + (Math.random() - 0.5) * 3.0;
  }
}

// ── Update all active asteroids each frame ────────────────────────────────────
function _updateAsteroids(dt) {
  const T = _asteroidTuner;
  const uTime = performance.now() * 0.001;

  for (let ai = _asteroidActive.length - 1; ai >= 0; ai--) {
    const inst = _asteroidActive[ai];
    inst.elapsed += dt;
    const progress = Math.min(inst.elapsed / inst.totalFallTime, 1.0);

    // Move
    inst.group.position.addScaledVector(inst.vel, dt);

    // Slow tumble
    inst.group.rotation.x += 0.4 * dt;
    inst.group.rotation.z += 0.25 * dt;

    // ── Horizon fade-in: same Z bands as cone system ──
    // SPAWN_Z (-160) = invisible, -110 = fully opaque
    const _AST_FADE_START = SPAWN_Z;   // -160
    const _AST_FADE_END   = -100;      // fully visible from here
    const fadeT = Math.max(0, Math.min(1, (inst.group.position.z - _AST_FADE_START) / (_AST_FADE_END - _AST_FADE_START)));

    // Rock visibility driven by fadeT — material flags are fixed at build time (never toggled)
    inst.rockMesh.visible = fadeT > 0.02;
    // Fire shell: has uIntensity, use it as combined fire + fade
    inst.fireMesh.material.uniforms.uIntensity.value = T.fireIntensity * fadeT;
    // Tail: fade alpha with fadeT
    inst.tailPts.material.opacity !== undefined && (inst.tailPts.material.opacity = fadeT);

    // Light: fades in with opacity
    inst.light.position.copy(inst.group.position);
    inst.light.intensity = fadeT * (0.8 + progress * 2.2) * inst.radius;

    // Show warning disc once asteroid is visible enough (respects toggle)
    if (T.showWarning && fadeT > 0.3 && progress < 0.88) inst.warnMesh.visible = true;
    else inst.warnMesh.visible = false;

    // Update shader uniforms
    inst.rockMesh.material.uniforms.uTime.value += dt;
    inst.fireMesh.material.uniforms.uTime.value  += dt;

    // Update warning disc
    inst.warnMat.uniforms.uProgress.value = Math.min(progress * 1.2, 1.0);
    inst.warnMat.uniforms.uTime.value += dt;

    // Tail particles: write current position into ring buffer
    inst.tailTimer += dt;
    const tailInterval = 0.022 / Math.max(0.5, T.trailLength);
    if (inst.tailTimer >= tailInterval) {
      inst.tailTimer = 0;
      inst.tailHistory[inst.tailWriteIdx % _AST_TAIL_COUNT].copy(inst.group.position);
      inst.tailWriteIdx++;
    }
    // Update tail buffer
    const tailPos  = inst.tailGeo.attributes.position.array;
    const tailAlph = inst.tailGeo.attributes.alpha.array;
    for (let ti = 0; ti < _AST_TAIL_COUNT; ti++) {
      const histIdx = ((inst.tailWriteIdx - 1 - ti) % _AST_TAIL_COUNT + _AST_TAIL_COUNT) % _AST_TAIL_COUNT;
      const hp = inst.tailHistory[histIdx];
      tailPos[ti*3]   = hp.x;
      tailPos[ti*3+1] = hp.y;
      tailPos[ti*3+2] = hp.z;
      tailAlph[ti] = Math.max(0, (1.0 - ti / _AST_TAIL_COUNT) * T.trailLength * 0.85);
    }
    inst.tailGeo.attributes.position.needsUpdate = true;
    inst.tailGeo.attributes.alpha.needsUpdate    = true;

    // Impact: reached water level or timeout
    const landed = inst.group.position.y <= 0.3 || progress >= 1.0;
    if (landed) {
      _killAsteroid(inst, true);
    }
  }
}

// ── Spawn tick: called from tutorial update block ─────────────────────────────
let _astFillerTimer = 0;

function _spawnFillerAsteroid() {
  const inst = _getAsteroidFromPool();
  if (!inst) return;
  const T = _asteroidTuner;

  // Random X across filler lane range
  const x = T.fillerLaneMin + Math.random() * (T.fillerLaneMax - T.fillerLaneMin);

  // Distance from center [0..1] — drives size and speed
  const maxDist = Math.max(Math.abs(T.fillerLaneMin), Math.abs(T.fillerLaneMax));
  const distFrac = Math.min(Math.abs(x) / maxDist, 1.0);

  // Size: smaller further out (parallax depth)
  const radius = T.fillerSizeMax + (T.fillerSizeMin - T.fillerSizeMax) * distFrac;

  // Speed scalar: faster further out
  const speedMult = T.fillerSpeedMax + (T.fillerSpeedMin - T.fillerSpeedMax) * distFrac;
  const speed = T.speed * speedMult;

  const spawnY = T.fillerSkyHeight;
  const spawnZ = SPAWN_Z;
  const landZ  = shipGroup.position.z - 20; // land well ahead of ship — never reaches it
  const landY  = 0.15;

  const totalTime = Math.sqrt((landY - spawnY) ** 2 + (landZ - spawnZ) ** 2) / speed;

  inst.vel.set(
    0,
    (landY - spawnY) / totalTime,
    (landZ - spawnZ) / totalTime
  );

  inst.group.scale.setScalar(radius);
  inst.rockMesh.material.uniforms.uTime.value = Math.random() * 100;
  inst.fireMesh.material.uniforms.uTime.value  = Math.random() * 100;
  inst.fireMesh.material.uniforms.uRadius.value = radius;
  inst.fireMesh.material.uniforms.uIntensity.value = T.fireIntensity * 0.5; // dimmer

  inst.group.position.set(x, spawnY, spawnZ);
  inst.group.visible = true;

  inst.light.position.copy(inst.group.position);
  inst.light.distance  = T.glowRange * radius * 0.5;
  inst.light.intensity = 0;
  inst.light.visible   = true;

  inst.warnMesh.visible = false; // no warning disc for fillers

  inst.group.rotation.set(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2
  );

  inst.radius        = radius;
  inst.landingX      = x;
  inst.landingZ      = landZ;
  inst.totalFallTime = totalTime;
  inst.elapsed       = 0;
  inst.warnTimer     = 0;
  inst.tailWriteIdx  = 0;
  inst.tailTimer     = 0;
  inst.isFiller      = true; // skip hit check
  for (let ti = 0; ti < _AST_TAIL_COUNT; ti++) inst.tailHistory[ti].set(0, 999, 0);
  inst.tailPts.visible = true;
  inst.active = true;

  _asteroidActive.push(inst);
}

function _tickAsteroidSpawner(dt) {
  const T = _asteroidTuner;
  if (!T.enabled) return;
  if (_noSpawnMode && !_chaosMode && !state._jetLightningMode) return;
  // Keep chaos params live every tick so slider changes take effect instantly
  if (_chaosMode) {
    const c = _chaosLevel;
    T.pattern    = 'stagger';
    T.frequency  = _chaosAstFreq(c);
    T.staggerGap = _chaosStaggerGap(c);
    T.salvoCount = _chaosSalvo(c);
    T.staggerDual = c > 0.5;
    if (window._LT && window._LT.enabled) {
      window._LT.pattern    = 'stagger';
      window._LT.frequency  = _chaosLtFreq(c);
      window._LT.staggerGap = _chaosLtStaggerGap(c);
      window._LT.salvoCount = _chaosSalvo(c);
    }
  }
  // Pattern loop buttons handle their own spawning — don't double-fire
  if (window._astPatternLoopActive) return;

  _astTimer -= dt;
  _astStaggerT -= dt;

  if (_astTimer <= 0) {
    _astTimer = T.frequency * (0.8 + Math.random() * 0.4) * Math.max(0.15, 1.0 - _funFloorIntensity * 0.85);

    if (T.pattern === 'stagger') {
      // Use the shared _fireStagger if available (wired by tuner IIFE) — identical to loop button
      if (window._fireStagger) { window._fireStagger(); }
      else {
        // Fallback: same logic inline (Y panel not yet opened)
        const steps = Math.max(1, Math.round(T.salvoCount));
        for (let si = 0; si < steps; si++) {
          setTimeout(() => {
            if (state.phase !== 'playing') return;
            _spawnAsteroid(state.shipX || 0);
          }, si * T.staggerGap * 1000);
        }
      }
    } else if (T.pattern === 'salvo') {
      // Simultaneous wall spread across lanes centered on ship X
      const count = Math.max(1, Math.round(T.salvoCount));
      const sx = (state && state.shipX) || 0;
      const half = (T.laneMax - T.laneMin) * 0.45;
      for (let si = 0; si < count; si++) {
        const frac = count === 1 ? 0.5 : si / (count - 1);
        const targetX = sx + (frac - 0.5) * half * 2;
        _spawnAsteroid(targetX);
      }
    } else {
      _spawnAsteroid(_astNextTargetX());
    }
  }

  // ── Filler asteroids (decorative, no hit check) ─────────────────────
  if (T.fillerEnabled && state._jetLightningMode) {
    _astFillerTimer -= dt;
    if (_astFillerTimer <= 0) {
      _astFillerTimer = T.fillerFreq * (0.6 + Math.random() * 0.8);
      _spawnFillerAsteroid();
    }
  }

  // ── Lateral camp punish — independent timer, spawns offset from shipX ──
  if (T.lateralEnabled && state._jetLightningMode) {
    T._lateralTimer -= dt;
    if (T._lateralTimer <= 0) {
      T._lateralTimer = T.lateralFreq * (0.7 + Math.random() * 0.6);
      const side = Math.random() < 0.5 ? 1 : -1;
      const offset = T.lateralMinOff + Math.random() * (T.lateralMaxOff - T.lateralMinOff);
      const sx = (state && state.shipX) || 0;
      _spawnAsteroid(sx + side * offset);
    }
  }
}

// ── Cleanup: remove all active asteroids ─────────────────────────────────────
function _clearAllAsteroids() {
  for (let ai = _asteroidActive.length - 1; ai >= 0; ai--) {
    _killAsteroid(_asteroidActive[ai], false);
  }
  _asteroidActive.length = 0;
  _astTimer = 0;
  _astSweepX = 0; _astSweepDir = 1;
  _astStaggerQueue.length = 0;
}

// ── Hook into main animate loop — append _updateAsteroids after _updateShockwave
// (done via monkey-patch pattern to avoid re-editing large blocks)
const _origUpdateShockwave = _updateShockwave;
// _updateShockwave already declared; we extend the animate-level call by wrapping
// Instead we hook into the existing update() call by extending that function's end.
// Since update() runs the tutorial tick, we extend the tutorial section.
// The cleanest safe hook: override _noSpawnMode setter end; we'll patch the update tail.
// Safest: add to the tail particle update already called in animate via a small wrapper.
(function _hookAsteroidIntoLoop() {
  const _origComposerRender = composer.render.bind(composer);
  let _lastAstDt = 0;
  let _lastAstTime = performance.now();
  composer.render = function(...args) {
    const now = performance.now();
    const dt = Math.min((now - _lastAstTime) * 0.001, 0.05);
    _lastAstTime = now;
    // Run during tutorial gameplay OR when chaos mode is active
    if (state.phase === 'playing' && !state.introActive &&
        (state._tutorialActive || _chaosMode || state._jetLightningMode)) {
      // Corridor takes over — pause all JL obstacle spawning during breather
      if (_jlCorridor.active && !_canyonActive) {
        _jlTickCorridor(dt, state.speed);
      } else if (!_canyonActive) {
        _tickAsteroidSpawner(dt);
      }
    }
    // Canyon corridor sine tick — always runs when canyon is active, regardless of JL mode
    if (_canyonActive && _jlCorridor.active) {
      _jlTickCorridor(dt, state.speed);
    }
    _updateAsteroids(dt);
    // Canyon corridor walls — runs in any mode when active
    if (_canyonActive) {
      if (!_canyonWalls) _createCanyonWalls();
      _updateCanyonWalls(dt, state.speed);
    }
    _origComposerRender(...args);
  };
})();

// ═══════════════════════════════════════════════════════════════════════════════
//  ASTEROID TUNER PANEL  (key = 'Y')
// ═══════════════════════════════════════════════════════════════════════════════
(function setupAsteroidTuner() {
  const panel = document.createElement('div');
  panel.id = 'asteroid-tuner';
  panel.style.cssText = 'display:none;position:fixed;top:0;right:0;width:270px;height:100%;background:rgba(0,0,0,0.93);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;border-left:1px solid #f60;';
  document.body.appendChild(panel);

  function makeSlider(label, val, min, max, step, onChange, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:4px;flex-wrap:wrap;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:108px;color:'+(color||'#f80')+';font-size:10px;flex-shrink:0;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    inp.style.cssText = 'flex:1;height:14px;accent-color:'+(color||'#f80')+';';
    const valEl = document.createElement('span');
    valEl.style.cssText = 'width:36px;text-align:right;font-size:10px;color:#fff;';
    valEl.textContent = (+val).toFixed(2);
    inp.oninput = () => { const v = +inp.value; onChange(v); valEl.textContent = v.toFixed(2); if (window._sessionLogSlider) _sessionLogSlider('ast_' + label, v); };
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(valEl);
    return { row, inp, valEl };
  }

  function makeHeader(text, color) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:10px 0 4px;font-size:11px;font-weight:bold;color:'+(color||'#f80')+';border-bottom:1px solid #333;padding-bottom:2px;';
    h.textContent = text;
    return h;
  }

  function makeToggle(label, getter, setter, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:8px;';
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:1px solid '+(color||'#f80')+';color:'+(color||'#f80')+';padding:3px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;';
    const refresh = () => { btn.textContent = label + ': ' + (getter() ? 'ON' : 'OFF'); btn.style.opacity = getter() ? '1' : '0.5'; };
    btn.onclick = () => { setter(!getter()); refresh(); };
    refresh();
    row.appendChild(btn);
    return row;
  }

  function makeSelect(label, options, getter, setter, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'color:'+(color||'#f80')+';font-size:10px;width:108px;flex-shrink:0;';
    lbl.textContent = label;
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;background:#111;color:#fff;border:1px solid #f80;font-family:monospace;font-size:10px;padding:2px;';
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o === getter()) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => setter(sel.value);
    row.appendChild(lbl); row.appendChild(sel);
    return row;
  }

  function build() {
    panel.innerHTML = '<div style="font-size:13px;font-weight:bold;color:#f60;margin-bottom:6px;">☄ ASTEROID TUNER (Y)</div>';
    const T = _asteroidTuner;

    // MASTER
    panel.appendChild(makeHeader('MASTER', '#f60'));
    panel.appendChild(makeToggle('ENABLED', () => T.enabled, v => {
      T.enabled = v;
      if (!v) _clearAllAsteroids();
      else { _astTimer = 0.5; } // spawn quickly on enable
    }, '#f60'));
    panel.appendChild(makeToggle('TUTORIAL MODE', () => state._tutorialActive, v => {
      state._tutorialActive = v;
      if (v) {
        // Apply JL_v1 physics as tutorial baseline
        const _tp = _PHYSICS_PRESETS['JL_v1'];
        _accelBase = _tp.accelBase; _accelSnap = _tp.accelSnap;
        _maxVelBase = _tp.maxVelBase; _maxVelSnap = _tp.maxVelSnap;
        _bankMax = _tp.bankMax; _bankSmoothing = _tp.bankSmoothing;
        _decelBasePct = _tp.decelBasePct; _decelFullPct = _tp.decelFullPct;
        state.phase = 'playing'; state._tutorialStep = 2;
      }
    }, '#ff0'));

    // PHYSICAL
    panel.appendChild(makeHeader('PHYSICAL'));
    panel.appendChild(makeSlider('size', T.size, 0.3, 4.0, 0.05, v => T.size = v, '#f80').row);
    panel.appendChild(makeSlider('size variance', T.sizeVariance, 0, 2.0, 0.05, v => T.sizeVariance = v, '#f80').row);
    panel.appendChild(makeSlider('speed', T.speed, 4, 200, 0.5, v => T.speed = v, '#fa0').row);
    panel.appendChild(makeSlider('lead factor', T.leadFactor, 0, 1, 0.01, v => T.leadFactor = v, '#fa0').row);
    panel.appendChild(makeSlider('kill radius', T.killRadius, 0.5, 6.0, 0.1, v => T.killRadius = v, '#f44').row);

    panel.appendChild(makeHeader('TRAJECTORY', '#8cf'));
    const trajNote = document.createElement('div');
    trajNote.style.cssText = 'font-size:9px;color:#666;margin:2px 0 6px;line-height:1.4;';
    trajNote.textContent = 'Always lands at ship Z. skyHeight = arc steepness. scatter = lane spread.';
    panel.appendChild(trajNote);
    panel.appendChild(makeSlider('sky height', T.skyHeight, 5, 120, 1, v => T.skyHeight = v, '#8cf').row);
    panel.appendChild(makeSlider('lane scatter', T.trajX, 0, 20, 0.5, v => T.trajX = v, '#8cf').row);

    // VISUALS
    panel.appendChild(makeHeader('VISUALS'));
    panel.appendChild(makeSlider('fire intensity', T.fireIntensity, 0, 3.0, 0.05, v => {
      T.fireIntensity = v;
      _asteroidActive.forEach(a => { a.fireMesh.material.uniforms.uIntensity.value = v; });
    }, '#f84').row);
    panel.appendChild(makeSlider('trail length', T.trailLength, 0, 3.0, 0.05, v => T.trailLength = v, '#fa0').row);
    panel.appendChild(makeSlider('glow range', T.glowRange, 0, 40, 0.5, v => {
      T.glowRange = v;
      _asteroidActive.forEach(a => { a.light.distance = v * a.radius; });
    }, '#f60').row);

    // PATTERN
    panel.appendChild(makeHeader('PATTERN', '#0df'));
    panel.appendChild(makeSelect('pattern', ['random','sweep','stagger','salvo'],
      () => T.pattern, v => { T.pattern = v; _astSweepX = 0; _astStaggerQueue.length = 0; }, '#0df'));
    panel.appendChild(makeSlider('frequency (s)', T.frequency, 0.5, 20, 0.1, v => T.frequency = v, '#0df').row);
    panel.appendChild(makeSlider('sweep speed', T.sweepSpeed, 0.05, 2.0, 0.01, v => T.sweepSpeed = v, '#0df').row);
    panel.appendChild(makeSlider('pinch step', T.pinchStep, 0.01, 0.5, 0.01, v => T.pinchStep = v, '#f0f').row);
    panel.appendChild(makeSlider('pinch spread', T.pinchSpread, 0.1, 3.0, 0.05, v => T.pinchSpread = v, '#f0f').row);
    panel.appendChild(makeToggle('stagger dual shot', () => T.staggerDual, v => { T.staggerDual = v; }));
    panel.appendChild(makeSlider('stagger gap', T.staggerGap, 0.2, 5.0, 0.1, v => T.staggerGap = v, '#0df').row);
    panel.appendChild(makeSlider('salvo count', T.salvoCount, 1, 8, 1, v => T.salvoCount = Math.round(v), '#0df').row);
    panel.appendChild(makeSlider('lane min X', T.laneMin, -20, 0, 0.5, v => T.laneMin = v, '#8df').row);
    panel.appendChild(makeSlider('lane max X', T.laneMax, 0, 20, 0.5, v => T.laneMax = v, '#8df').row);

    // CHASE RAMP
    panel.appendChild(makeHeader('CHASE RAMP', '#f84'));
    panel.appendChild(makeSlider('ramp start (s)', T.chaseRampStart, 0.5, 10, 0.1, v => T.chaseRampStart = v, '#f84').row);
    panel.appendChild(makeSlider('ramp end (s)', T.chaseRampEnd, 0.1, 5, 0.05, v => T.chaseRampEnd = v, '#f84').row);
    panel.appendChild(makeSlider('ramp duration (s)', T.chaseRampDuration, 10, 300, 5, v => T.chaseRampDuration = v, '#f84').row);
    panel.appendChild(makeSlider('chase flank', T.chaseFlank, 0, 0.6, 0.01, v => T.chaseFlank = v, '#f84').row);

    // CHAOS MODE
    panel.appendChild(makeHeader('CHAOS MODE', '#f0f'));
    panel.appendChild(makeToggle('⚡ CHAOS — asteroids + lightning stagger', () => _chaosMode, v => {
      _chaosMode = v;
      if (v) {
        // Force both systems into stagger, enable lightning
        T.pattern = 'stagger';
        T.enabled = true;
        if (window._LT) {
          window._LT.pattern = 'stagger';
          window._LT.enabled = true;
        }
        _astTimer = 0.1; // spawn fast on enable
      } else {
        if (window._LT) window._LT.enabled = false;
      }
    }, '#f0f'));
    panel.appendChild(makeSlider('chaos level', _chaosLevel, 0.0, 1.0, 0.01, v => {
      _chaosLevel = v;
      // Live-update both systems immediately
      T.frequency   = _chaosAstFreq(v);
      T.staggerGap  = _chaosStaggerGap(v);
      T.salvoCount  = _chaosSalvo(v);
      T.staggerDual = v > 0.5;
      if (window._LT) {
        window._LT.frequency  = _chaosLtFreq(v);
        window._LT.staggerGap = _chaosLtStaggerGap(v);
        window._LT.salvoCount = _chaosSalvo(v);
      }
    }, '#f0f').row);

    // DANGER ZONE
    panel.appendChild(makeHeader('DANGER ZONE', '#f44'));
    panel.appendChild(makeToggle('show warning disc', () => T.showWarning, v => {
      T.showWarning = v;
      if (!v) _asteroidActive.forEach(a => { a.warnMesh.visible = false; });
    }, '#f44'));
    panel.appendChild(makeSlider('warning time', T.warningTime, 0.2, 4.0, 0.1, v => T.warningTime = v, '#f44').row);

    // ACTIONS
    panel.appendChild(makeHeader('ACTIONS', '#0f8'));

    // Single one-shot
    const spawnBtn = document.createElement('button');
    spawnBtn.textContent = '▼ ONE';
    spawnBtn.style.cssText = 'background:#060;border:1px solid #0f8;color:#0f8;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:3px 0;width:100%;';
    spawnBtn.onclick = () => {
      if (state.phase !== 'playing') state.phase = 'playing';
      _spawnAsteroid((state && state.shipX) || 0);
    };
    panel.appendChild(spawnBtn);

    // Continuous pattern toggles — self-scheduling setTimeout so T.frequency is live.
    // Only one loop runs at a time; starting one stops any previous.
    let _activePatternTimeout = null;  // current pending setTimeout handle
    let _activePatternCancelFn = null; // cancel function for the running loop
    let _activePatternBtn = null;

    function _stopPatternLoop() {
      if (_activePatternCancelFn) { _activePatternCancelFn(); _activePatternCancelFn = null; }
      if (_activePatternTimeout) { clearTimeout(_activePatternTimeout); _activePatternTimeout = null; }
      if (_activePatternBtn) { _activePatternBtn.style.outline = 'none'; _activePatternBtn.style.opacity = '1'; _activePatternBtn = null; }
      window._astPatternLoopActive = false;
    }

    // Shared stagger fire — used by loop button AND JL auto-spawner
    // Reads state.shipX live inside each setTimeout so it always tracks the ship
    window._fireStagger = function _fireStagger() {
      const T = _asteroidTuner;
      const steps = Math.max(1, Math.round(T.salvoCount));
      for (let si = 0; si < steps; si++) {
        setTimeout(() => {
          if (state.phase !== 'playing') return;
          _spawnAsteroid(state.shipX || 0);
          if (T.staggerDual) {
            const spawnY = T.skyHeight;
            const totalTime = Math.sqrt((0 - spawnY) ** 2 + (3.9 - (-160)) ** 2) / T.speed;
            const leadX = state.shipX + (state.shipVelX || 0) * totalTime * T.leadFactor;
            if (Math.abs(leadX - state.shipX) > 0.8) _spawnAsteroid(leadX);
          }
        }, si * T.staggerGap * 1000);
      }
    };

    function _startPatternLoop(btn, color, tickFn) {
      if (_activePatternBtn === btn) { _stopPatternLoop(); return; } // toggle off
      _stopPatternLoop();
      _activePatternBtn = btn;
      window._astPatternLoopActive = true;
      btn.style.outline = `2px solid ${color}`;
      btn.style.opacity = '0.75';
      if (state.phase !== 'playing') state.phase = 'playing';
      state._tutorialActive = true; // suppress prologue while pattern loop is running
      let cancelled = false;
      _activePatternCancelFn = () => { cancelled = true; };
      const scheduleNext = () => {
        const delay = Math.max(100, T.frequency * 1000);
        _activePatternTimeout = setTimeout(() => {
          if (cancelled) return;
          if (state.phase === 'playing') tickFn();
          scheduleNext();
        }, delay);
      };
      tickFn(); // fire immediately
      scheduleNext();
    }

    function _startChaseLoop(btn) {
      // Chase-specific loop with difficulty ramp: interval lerps chaseRampStart→chaseRampEnd over chaseRampDuration seconds.
      if (_activePatternBtn === btn) { _stopPatternLoop(); return; } // toggle off
      _stopPatternLoop();
      _activePatternBtn = btn;
      window._astPatternLoopActive = true;
      btn.style.outline = '2px solid #f84';
      btn.style.opacity = '0.75';
      if (state.phase !== 'playing') state.phase = 'playing';
      state._tutorialActive = true; // suppress prologue while pattern loop is running
      const rampOrigin = (state.elapsed || 0);
      const chaseTick = () => {
        // Fire a burst of 3: mirror shot + one flanking on each side to force real movement
        if (typeof window._astChaseLastX === 'undefined') window._astChaseLastX = state.shipX;
        const prevX = window._astChaseLastX;
        const shipX = state.shipX;
        const mirrorX = shipX + (shipX - prevX);
        const targetX = mirrorX;
        const flank = (T.laneMax - T.laneMin) * T.chaseFlank;
        _spawnAsteroid(targetX); // mirror shot
        setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(targetX - flank); }, 280);
        setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(targetX + flank); }, 560);
        window._astChaseLastX = targetX;
      };
      let cancelled = false;
      _activePatternCancelFn = () => { cancelled = true; };
      const scheduleNext = () => {
        const elapsed = Math.max(0, (state.elapsed || 0) - rampOrigin);
        const tRamp = Math.min(elapsed / Math.max(1, T.chaseRampDuration), 1);
        const interval = T.chaseRampStart + (T.chaseRampEnd - T.chaseRampStart) * tRamp;
        _activePatternTimeout = setTimeout(() => {
          if (cancelled) return;
          if (state.phase === 'playing') chaseTick();
          scheduleNext();
        }, Math.max(100, interval * 1000));
      };
      chaseTick(); // fire immediately
      scheduleNext();
    }

    // Burst helper: spawn targets[i] after i*gapMs, snapshotting ship X at call time
    function _burstSpawn(targets, gapMs) {
      targets.forEach((x, i) => {
        if (i === 0) { _spawnAsteroid(x); return; }
        setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(x); }, i * gapMs);
      });
    }

    const _patternDefs = [
      {
        // RANDOM: 4 shots scattered around ship X — always threatening, never safe to stay put
        label: '▼▼ RANDOM (loop)',
        color: '#0f8',
        tick: () => {
          // re-read shipX at each fire time so delayed shots still track
          const half = (T.laneMax - T.laneMin) * 0.5;
          const offsets = Array.from({ length: 4 }, () => (Math.random() - 0.5) * half * 2.5);
          offsets.forEach((off, i) => {
            setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(state.shipX + off); }, i * 350);
          });
        },
      },
      {
        // SWEEP: burst of 5 shots, origin tracks ship X, sweeps laterally across the lane range
        label: '►◄ SWEEP (loop)',
        color: '#0df',
        tick: () => {
          const range = T.laneMax - T.laneMin;
          const sweepOffset = (_astSweepX - 0.5) * range;
          _astSweepX += _astSweepDir * T.sweepSpeed * 0.35;
          if (_astSweepX >= 1 || _astSweepX <= 0) { _astSweepDir *= -1; _astSweepX = THREE.MathUtils.clamp(_astSweepX, 0, 1); }
          const waveSize = 5;
          // compute fracs now, re-read shipX at each fire time
          const fracs = Array.from({ length: waveSize }, (_, i) => i / (waveSize - 1));
          fracs.forEach((frac, i) => {
            setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(state.shipX + sweepOffset + (frac - 0.5) * range * 0.5); }, i * 200);
          });
        },
      },
      {
        // PINCH: 5 pairs fired 300ms apart, arms close on ship X — you see them converging
        // and must commit to a lane before the kill shot lands center
        label: '▷◁ PINCH (loop)',
        color: '#f0f',
        tick: () => {
          const sx = state.shipX; // snapshot — arms all target where you ARE now
          const pairCount = 5;
          const gapMs = 300;
          const fullHalf = (T.laneMax - T.laneMin) * 0.5 * T.pinchSpread;
          for (let pi = 0; pi < pairCount; pi++) {
            const progress = pi / (pairCount - 1); // 0=wide, 1=closed
            const halfSpread = Math.max(0.3, fullHalf * (1.0 - progress));
            const delay = pi * gapMs;
            (function(hs, d) {
              const fn = () => {
                if (state.phase !== 'playing') return;
                _spawnAsteroid(sx - hs);
                _spawnAsteroid(sx + hs);
              };
              if (d === 0) fn(); else setTimeout(fn, d);
            })(halfSpread, delay);
          }
          // Kill shot dead-center after arms close
          setTimeout(() => { if (state.phase === 'playing') _spawnAsteroid(sx); }, pairCount * gapMs);
        },
      },
      // CHASE is handled separately via _startChaseLoop (difficulty ramp)
      // placeholder entry omitted — button wired below
      {
        // STAGGER: rolling wall left→right, centered on ship X so no lane is permanently safe
        label: '▼ ▼▼ STAGGER (loop)',
        color: '#ff0',
        tick: () => { if (window._fireStagger) window._fireStagger(); },
      },
      {
        // SALVO: simultaneous wall centered on ship X — survive by reading the gaps
        label: '▼▼▼ SALVO (loop)',
        color: '#f80',
        tick: () => {
          const sx = state.shipX;
          const count = Math.max(1, Math.round(T.salvoCount));
          const half = (T.laneMax - T.laneMin) * 0.45;
          for (let si = 0; si < count; si++) {
            const frac = count === 1 ? 0.5 : si / (count - 1);
            _spawnAsteroid(sx + (frac - 0.5) * half * 2);
          }
        },
      },
        ];

    _patternDefs.forEach(({ label, color, tick }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `background:none;border:1px solid ${color};color:${color};padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px 0;width:100%;text-align:left;transition:opacity 0.1s;`;
      btn.onclick = () => _startPatternLoop(btn, color, tick);
      panel.appendChild(btn);
    });

    // CHASE button — wired to ramp loop
    {
      const chaseBtn = document.createElement('button');
      chaseBtn.textContent = '⇔ CHASE (loop, ramp)';
      chaseBtn.style.cssText = 'background:none;border:1px solid #f84;color:#f84;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px 0;width:100%;text-align:left;transition:opacity 0.1s;';
      chaseBtn.onclick = () => _startChaseLoop(chaseBtn);
      panel.appendChild(chaseBtn);
    }

    const stopBtn = document.createElement('button');
    stopBtn.textContent = '⏹ STOP LOOP';
    stopBtn.style.cssText = 'background:#222;border:1px solid #888;color:#aaa;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:4px 0 2px;width:100%;';
    stopBtn.onclick = () => _stopPatternLoop();
    panel.appendChild(stopBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕ CLEAR ALL';
    clearBtn.style.cssText = 'background:#300;border:1px solid #f44;color:#f44;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px 0;width:100%;';
    clearBtn.onclick = () => { _stopPatternLoop(); _clearAllAsteroids(); };
    panel.appendChild(clearBtn);

    // Active count
    const countEl = document.createElement('div');
    countEl.style.cssText = 'margin-top:6px;color:#888;font-size:10px;';
    const refreshCount = () => { countEl.textContent = 'active: ' + _asteroidActive.length + ' / ' + _AST_POOL_SIZE; };
    refreshCount();
    setInterval(refreshCount, 500);
    panel.appendChild(countEl);

    // ── LATERAL section
    panel.appendChild(makeHeader('LATERAL CAMP PUNISH', '#fa4'));
    panel.appendChild(makeToggle('enabled', () => T.lateralEnabled, v => { T.lateralEnabled = v; }));
    panel.appendChild(makeSlider('frequency (s)', T.lateralFreq, 0.1, 5.0, 0.1, v => T.lateralFreq = v, '#fa4').row);
    panel.appendChild(makeSlider('min offset', T.lateralMinOff, 0, 60, 1, v => T.lateralMinOff = v, '#fa4').row);
    panel.appendChild(makeSlider('max offset', T.lateralMaxOff, 0, 100, 1, v => T.lateralMaxOff = v, '#fa4').row);
    // ── FILLER section
    panel.appendChild(makeHeader('FILLER (decorative)', '#88f'));
    panel.appendChild(makeToggle('enabled (JL stagger only)', () => T.fillerEnabled, v => { T.fillerEnabled = v; }));
    panel.appendChild(makeSlider('frequency (s)', T.fillerFreq, 0.05, 3.0, 0.05, v => T.fillerFreq = v, '#88f').row);
    panel.appendChild(makeSlider('sky height', T.fillerSkyHeight, 1, 80, 1, v => T.fillerSkyHeight = v, '#88f').row);
    panel.appendChild(makeSlider('lane min', T.fillerLaneMin, -40, 0, 1, v => T.fillerLaneMin = v, '#8df').row);
    panel.appendChild(makeSlider('lane max', T.fillerLaneMax, 0, 40, 1, v => T.fillerLaneMax = v, '#8df').row);
    panel.appendChild(makeSlider('size near', T.fillerSizeMax, 0.05, 1.5, 0.05, v => T.fillerSizeMax = v, '#88f').row);
    panel.appendChild(makeSlider('size far', T.fillerSizeMin, 0.05, 1.0, 0.05, v => T.fillerSizeMin = v, '#88f').row);
    panel.appendChild(makeSlider('speed near', T.fillerSpeedMax, 0.1, 3.0, 0.05, v => T.fillerSpeedMax = v, '#f8f').row);
    panel.appendChild(makeSlider('speed far', T.fillerSpeedMin, 0.1, 3.0, 0.05, v => T.fillerSpeedMin = v, '#f8f').row);
  }

  let visible = false;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'y' || e.key === 'Y') {
      visible = !visible;
      if (visible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();


// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
//  JET LIGHTNING MODE
//  A standalone arcade mode: asteroids → lightning → glacier terrain, ramping
//  difficulty over time. Physics tuned for high-speed lateral feel.
// ═══════════════════════════════════════════════════════════════════════════════

let _jlRampTime      = 0;   // seconds elapsed in Jet Lightning mode

function startJetLightning() {
  // ── Flag ──────────────────────────────────────────────────────────────────
  state._jetLightningMode = true;
  state._tutorialActive   = false;

  // ── Physics override ──────────────────────────────────────────────────────
  _accelBase      = 60;
  _accelSnap      = 100;
  _maxVelBase     = 13;    // JL_v2 — tighter lateral cap, more intentional feel
  _maxVelSnap     = 23;
  _bankMax        = 0.04;
  _bankSmoothing  = 8;

  // ── Reset ramp timer ──────────────────────────────────────────────────────
  _jlRampTime      = 0;
  _jlFatConeTimer   = 99;
  _jlLrTimer        = 99;
  // Clear any in-flight lethal rings from a previous session
  for (const lr of _lethalRingActive) { lr.userData.active = false; lr.visible = false; lr.position.set(0,-9999,0); }
  _lethalRingActive.length = 0;
  // Reset track activation state so onActivate fires fresh each run
  for (const k of Object.keys(_jlTrackActive)) _jlTrackActive[k] = false;
  // ── Asteroids: on, stagger aimed at ship's current position ────────────────
  const T = _asteroidTuner;
  T.enabled      = true;
  T.pattern      = 'stagger';
  T.frequency    = 1.4;    // locked from session log (rchouake approved)
  T.staggerGap   = 0.6;    // locked from session log
  T.salvoCount   = 1;      // stagger = 1 shot at a time, tracking ship live
  T.speed        = 200;
  T.size         = 1.2;    // locked from session log
  T.sizeVariance = 0.55;   // locked from session log
  T.skyHeight    = 42;
  T.leadFactor   = 0.0;    // aim at ship's CURRENT position, not predicted
  T.staggerDual  = false;  // dual shot unlocks in Phase 3 only
  T.killRadius   = 2.2;
  T.laneMin      = -8;
  T.laneMax      =  8;
  _astTimer      = 2.0;  // 2s grace period after liftoff before first asteroid

  // ── Lightning: OFF at start — ramp turns it on ────────────────────────────
  if (window._LT) {
    window._LT.enabled    = false;
    window._LT.frequency  = 0.3;   // locked from session log
    window._LT.count      = 1;
    window._LT.jaggedness = 1.9;
    window._LT.glowRadius = 0.25;
    window._LT.spawnZ     = -83;
    window._LT.pattern    = 'random';
    window._LT.laneMin    = -8;
    window._LT.laneMax    =  8;
  }

  // ── Ice: OFF at start — ramp turns it on ─────────────────────────────────
  if (window._ICE) {
    window._ICE.enabled = false;
  }

  // ── Terrain: OFF at start — ramp turns it on ─────────────────────────────
  if (_terrainWalls) {
    _terrainWalls.strips.forEach(m => { m.visible = false; });
  }

  // ── noSpawnMode: clear ────────────────────────────────────────────────────
  _noSpawnMode = false;

  // ── Start the game ────────────────────────────────────────────────────────
  startGame();

  // ── Re-apply JL flags AFTER startGame() resets them ─────────────────────
  state._jetLightningMode  = true;
  // Campaign prologue runs normally (startGame sets introActive=true);
  // the prologue's own _launchDeathRun() clears introActive & _introLiftActive
  // when the player taps or the 18.5s auto-launch fires.

  // Re-apply physics — startGame() resets to campaign defaults internally
  _accelBase      = 60;
  _accelSnap      = 100;
  _maxVelBase     = 13;
  _maxVelSnap     = 23;
  _bankMax        = 0.04;
  _bankSmoothing  = 8;

  _asteroidTuner.enabled     = true;
  _asteroidTuner.showWarning  = false;
  _noSpawnMode               = false;
  _astTimer                = 2.0;  // 2s grace after liftoff
  state.l4CorridorActive   = false;
  state.l4CorridorDone     = true;
  state.score         = 490; // LEVELS[3].scoreThreshold
  state.currentLevelIdx = 3;
  currentLevelDef     = LEVELS[3];
  targetLevelDef      = LEVELS[3];
  state.speed         = BASE_SPEED * LEVELS[3].speedMult; // 1.5x = L4

  // ── Canyon test mode: activate corridor + canyon walls, kill asteroids ──
  if (_canyonTestMode) {
    _skipL1Intro            = true;
    _godMode                = true;
    _asteroidTuner.enabled  = false;
    state._drL3MaxRows      = 750;
    state.corridorRowsDone  = 0;
    state.corridorSineT     = 0;
    state.corridorSpawnZ    = -7;
    state.corridorDelay     = 0;
    state.corridorGapCenter = 0;
    state.corridorGapDir    = 1;
    _jlCorridor.active      = true;
    _jlCorridor.type        = 'l3';
    _jlCorridor.totalRows   = 750;
    _canyonActive           = true;
    if (!_canyonWalls) _createCanyonWalls();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  JET LIGHTNING SEQUENCER
//  Each track activates at startT and deactivates at endT (null = forever).
//  _jlIntensity is a scalar locked at 1.0 — wire it to a ramp later.
//  Track types:
//    'asteroid' — sets _asteroidTuner fields each frame while active
//    'lightning' — sets _LT fields each frame while active
//    'fatcone'  — drives its own spawn timer while active
//    'custom'   — calls onActivate() once on entry, onDeactivate() once on exit
// ═══════════════════════════════════════════════════════════════════════════════

let _jlIntensity  = 3.0; // frequency scalar — 3.0 default (doubled from 1.5)
let _jlSizeScalar = 1.0; // size scalar — 1.0 = approved baseline
let _godMode      = false; // no damage — plays shield-hit sound on hit instead of killing

// ─── JL Corridor — reusable self-contained corridor obstacle ─────────────────
// Drives the existing spawnCorridorRow / spawnL4CorridorRow functions
// independent of level/trigger system. Call _jlStartCorridor('l3' or 'l4').
// Rows measured from main-mode playtests:
//   L3: 750 rows at speed 72 ≈ 83s   (loop cut at 750, exit ramp last 20 rows)
//   L4: 518 rows at speed 75.6 ≈ 50s (matches main mode, exit ramp last 20 rows)
const _jlCorridor = {
  active:    false,
  type:      'l3',   // 'l3' or 'l4'
  spawnZ:    -7,
  delay:     2.0,    // seconds of clear gap before first row spawns
  totalRows: 750,    // set by _jlStartCorridor
  exitRows:  20,     // widen walls back out over last N rows
};

function _jlStartCorridor(type) {
  const isL4 = type === 'l4';
  // Reset shared corridor state
  if (isL4) {
    state.l4RowsDone  = 0;
    state.l4SineT     = 0;
    state.l4SpawnZ    = -7;
    state.l4Delay     = 2.0;
  } else {
    state.corridorRowsDone  = 0;
    state.corridorSineT     = 0;
    state.corridorSpawnZ    = -7;
    state.corridorDelay     = 2.0;
    state.corridorGapCenter = 0;
    state.corridorGapDir    = 1;
  }
  state.nearMissBendAllowed = true;
  state.prevCorridorCenter  = 0;
  state.prevCorridorDir     = 0;
  // Clear existing obstacles so entry isn't blocked
  ;[...activeObstacles].forEach(returnObstacleToPool);
  activeObstacles.length = 0;
  // Activate
  _jlCorridor.active    = true;
  _jlCorridor.type      = type;
  _jlCorridor.spawnZ    = -7;
  _jlCorridor.delay     = 2.0;
  _jlCorridor.totalRows = isL4 ? 518 : 750;
}

function _jlStopCorridor() {
  _jlCorridor.active = false;
  // Clear corridor cones
  for (let i = activeObstacles.length - 1; i >= 0; i--) {
    if (activeObstacles[i].userData.isCorridor) {
      returnObstacleToPool(activeObstacles[i]);
      activeObstacles.splice(i, 1);
    }
  }
}

function _jlTickCorridor(dt, effectiveSpd) {
  if (!_jlCorridor.active) return;
  const isL4   = _jlCorridor.type === 'l4';
  const rowsDone = isL4 ? (state.l4RowsDone || 0) : (state.corridorRowsDone || 0);
  const total  = _jlCorridor.totalRows;
  const exitAt = total - _jlCorridor.exitRows;

  // Inject exit-ramp maxRows so existing row functions widen walls cleanly
  if (isL4) {
    state._drL4MaxRows = total;
  } else {
    state._drL3MaxRows = total;
    state.isDeathRun   = state.isDeathRun || false; // preserve, but exit ramp reads isDeathRun
  }

  // Done — clean up
  if (rowsDone >= total) {
    _jlStopCorridor();
    if (isL4) { state._drL4MaxRows = undefined; }
    else      { state._drL3MaxRows = undefined; }
    return;
  }

  // Delay (breathing room before walls appear)
  if (isL4) {
    if (state.l4Delay > 0) { state.l4Delay -= dt; return; }
    state.l4SpawnZ += effectiveSpd * dt;
    if (state.l4SpawnZ >= 0) {
      state.l4SpawnZ = -7 + (Math.random() - 0.5) * 2;
      spawnL4CorridorRow();
    }
    // Expose current halfX for canyon walls
    {
      const rd = state.l4RowsDone || 0;
      let hx = L4_CORRIDOR_NARROW_X;
      if (rd < L4_CORRIDOR_CLOSE_ROWS) {
        const t2 = rd / L4_CORRIDOR_CLOSE_ROWS;
        const ease = t2 < 0.5 ? 2*t2*t2 : -1+(4-2*t2)*t2;
        hx = CORRIDOR_WIDE_X + (L4_CORRIDOR_NARROW_X - CORRIDOR_WIDE_X) * ease;
      } else {
        const cr = Math.max(0, rd - (L4_CORRIDOR_CLOSE_ROWS + L4_CORRIDOR_STRAIGHT));
        const sq = Math.min(1, cr / L4_CORRIDOR_AMP_RAMP);
        hx = L4_CORRIDOR_NARROW_X - (L4_CORRIDOR_NARROW_X - 4.5) * (sq * sq);
      }
      _jlCorridor._lastHalfX = hx;
    }
  } else {
    if (state.corridorDelay > 0) { state.corridorDelay -= dt; return; }
    state.corridorSpawnZ += effectiveSpd * dt;
    if (state.corridorSpawnZ >= 0) {
      state.corridorSpawnZ = -7 + (Math.random() - 0.5) * 2;
      spawnCorridorRow();
    }
    // Expose current halfX for canyon walls
    {
      const rd = state.corridorRowsDone || 0;
      let hx = CORRIDOR_NARROW_X;
      if (rd < CORRIDOR_CLOSE_ROWS) {
        const t2 = rd / CORRIDOR_CLOSE_ROWS;
        const ease = t2 < 0.5 ? 2*t2*t2 : -1+(4-2*t2)*t2;
        hx = CORRIDOR_WIDE_X + (CORRIDOR_NARROW_X - CORRIDOR_WIDE_X) * ease;
      } else {
        const cr = Math.max(0, rd - (CORRIDOR_CLOSE_ROWS + CORRIDOR_STRAIGHT_ROWS));
        const sq = Math.min(1, cr / CORRIDOR_AMP_RAMP);
        hx = CORRIDOR_NARROW_X - (CORRIDOR_NARROW_X - 6) * (sq * sq);
      }
      _jlCorridor._lastHalfX = hx;
    }
  }

  // Near-miss bend tracking (scoring/SFX — mirrors main mode)
  const curCenter = state.corridorGapCenter || 0;
  const delta = curCenter - state.prevCorridorCenter;
  const curDir = delta > 0.1 ? 1 : delta < -0.1 ? -1 : state.prevCorridorDir;
  if (curDir !== 0 && curDir !== state.prevCorridorDir) state.nearMissBendAllowed = true;
  state.prevCorridorDir    = curDir;
  state.prevCorridorCenter = curCenter;
}

// ── Track definitions ─────────────────────────────────────────────────────────
// Act 1 — Asteroids (0–45s)
//   0–25s:  stagger sparse → dense
//   25–40s: salvos bleed in as stagger peaks
//   40–45s: breathing room (nothing)
// Act 2 — Lightning (45–100s)
//   45–65s: LT stagger sparse → ramping, asteroids OFF
//   65–80s: LT sweeps layer in
//   80–95s: LT stagger + salvo peak
//   95–100s: breathing room (nothing)
// Act 3 — Combined (100s+)
//   100s+: asteroid stagger + lightning both on, both ramping
const _JL_TRACKS = [

  // ════════ ACT 1 — ASTEROIDS ═══════════════════════════════════════════════
  {
    id: 'ast_stagger_1', label: 'A1 AST Stagger', type: 'asteroid',
    startT: 0, endT: 25,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 1.4, staggerGap: 0.6, salvoCount: 1,
      size: 1.2, sizeVariance: 0.55, laneMin: -8, laneMax: 8,
    },
  },
  {
    id: 'ast_salvo_1', label: 'A1 AST Salvo', type: 'asteroid',
    startT: 25, endT: 40,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 1.1, staggerGap: 0.5, salvoCount: 2,
      size: 1.2, sizeVariance: 0.55, laneMin: -8, laneMax: 8,
    },
  },
  // 40–45s: breathing room — no tracks active

  // ════════ ACT 2 — LIGHTNING ════════════════════════════════════════════════
  {
    id: 'lt_stagger_1', label: 'A2 LT Stagger', type: 'lightning',
    startT: 45, endT: 65,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 0.5, laneMin: -8, laneMax: 8,
    },
    onActivate()   { if (window._asteroidTuner) window._asteroidTuner.enabled = false; },
    onDeactivate() {},
  },
  {
    id: 'lt_sweep_1', label: 'A2 LT Sweep', type: 'lightning',
    startT: 65, endT: 80,
    settings: {
      enabled: true, pattern: 'sweep', leadFactor: 0.0,
      frequency: 0.4, sweepSpeed: 0.4, laneMin: -8, laneMax: 8,
    },
    onActivate()   { if (window._asteroidTuner) window._asteroidTuner.enabled = false; },
    onDeactivate() {},
  },
  {
    id: 'lt_peak_1', label: 'A2 LT Peak', type: 'lightning',
    startT: 80, endT: 95,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 0.3, laneMin: -8, laneMax: 8,
    },
    onActivate()   { if (window._asteroidTuner) window._asteroidTuner.enabled = false; },
    onDeactivate() {},
  },
  // 95–100s: breathing room — no tracks active

  // ════════ ACT 3 — COMBINED (100s+) ════════════════════════════════════════
  {
    id: 'ast_stagger_2', label: 'A3 AST', type: 'asteroid',
    startT: 100, endT: null,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 1.4, staggerGap: 0.6, salvoCount: 1,
      size: 1.2, sizeVariance: 0.55, laneMin: -8, laneMax: 8,
    },
  },
  {
    id: 'lt_stagger_2', label: 'A3 LT', type: 'lightning',
    startT: 100, endT: null,
    settings: {
      enabled: true, pattern: 'stagger', leadFactor: 0.0,
      frequency: 0.3, laneMin: -8, laneMax: 8,
    },
  },
];

// Track which custom tracks have been activated (so onActivate fires once)
const _jlTrackActive = {};

// ── Apply one asteroid track's settings to _asteroidTuner ────────────────────
// _jlIntensity > 1 = shorter interval = more frequent spawns
function _jlApplyAsteroidTrack(track) {
  const T = _asteroidTuner;
  const s = track.settings;
  // Preserve user-tunable values that track settings must never overwrite
  const _keepLateralEnabled = T.lateralEnabled;
  const _keepLateralFreq    = T.lateralFreq;
  const _keepLateralMinOff  = T.lateralMinOff;
  const _keepLateralMaxOff  = T.lateralMaxOff;
  const _keepLateralTimer   = T._lateralTimer;
  for (const k of Object.keys(s)) T[k] = s[k];
  T.lateralEnabled = _keepLateralEnabled;
  T.lateralFreq    = _keepLateralFreq;
  T.lateralMinOff  = _keepLateralMinOff;
  T.lateralMaxOff  = _keepLateralMaxOff;
  T._lateralTimer  = _keepLateralTimer;
  if (s.frequency !== undefined) T.frequency = s.frequency / _jlIntensity;
  if (s.size      !== undefined) T.size      = s.size      * _jlSizeScalar;
  T.enabled = true; // always re-enable when a track is active
}

// ── Apply one lightning track's settings to _LT ───────────────────────────────
function _jlApplyLightningTrack(track) {
  const LT = window._LT;
  if (!LT) return;
  const s = track.settings;
  for (const k of Object.keys(s)) LT[k] = s[k];
  if (s.frequency !== undefined) LT.frequency = s.frequency / _jlIntensity;
}

// ── JL lethal ring row spawner — exact campaign lane-grid algo ──────────────
function _jlSpawnLethalRingRow() {
  _initLethalRings();
  const sx = state.shipX || 0;
  const spawnCount = 3 + Math.floor(Math.random() * 2); // 3-4 rings per row
  const lanes  = Array.from({ length: LANE_COUNT }, (_, i) => i);
  const shuffled = [...lanes].sort(() => Math.random() - 0.5);
  // Guaranteed 2-wide clear gap
  const gapStart = Math.floor(Math.random() * (LANE_COUNT - 1));
  const gapLanes = new Set([gapStart, gapStart + 1]);
  const blocked = [];
  for (const lane of shuffled) {
    if (blocked.length >= spawnCount) break;
    if (gapLanes.has(lane)) continue;
    if (blocked.some(b => Math.abs(b - lane) < 4)) continue; // min 4-lane gap between rings
    blocked.push(lane);
  }
  blocked.forEach(lane => {
    const laneX = sx + (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
    _spawnLethalRing(laneX + (Math.random() - 0.5) * 0.6, SPAWN_Z);
  });
}

// ── Main sequencer tick ───────────────────────────────────────────────────────
let _jlWasInLiftoff = false;
let _jlFatConeTimer = 99;
let _jlLrTimer      = 99; // lethal ring row spawn timer

function _tickJetLightningRamp(dt) {
  if (!state._jetLightningMode || state.phase !== 'playing') return;

  const _inLiftoff = state.introActive || state._introLiftActive;

  if (_jlWasInLiftoff && !_inLiftoff) {
    _astTimer   = 2.0;
    _jlRampTime = 0;
    state.speed = BASE_SPEED * LEVELS[3].speedMult;
  }
  _jlWasInLiftoff = _inLiftoff;
  if (_inLiftoff) return;

  _jlRampTime += dt;
  const t = _jlRampTime;

  // ── Corridor breather — pause all track spawning while active
  if (_jlCorridor.active) return;

  // ── Iterate tracks ────────────────────────────────────────────────────────
  // First pass: find which asteroid/lightning tracks are active this frame
  // (last one wins if ranges overlap — intentional for combined phases)
  let _activeAst = null;
  let _activeLt  = null;

  for (const track of _JL_TRACKS) {
    const active = t >= track.startT && (track.endT === null || t < track.endT);

    if (active) {
      // Fire onActivate once on entry
      if (!_jlTrackActive[track.id]) {
        _jlTrackActive[track.id] = true;
        if (track.onActivate) track.onActivate();
        if (track.type === 'fatcone') {
          _jlFatConeTimer = 1.0; // fire first cone quickly on track entry
        }
        if (track.type === 'lethal_rings') {
          _jlLrTimer = 1.0; // fire first ring row quickly on track entry
        }
      }

      if      (track.type === 'asteroid')  _activeAst = track;
      else if (track.type === 'lightning') _activeLt  = track;
      else if (track.type === 'fatcone') {
        // Fat cone spawner — delegates to _spawnFatCone() which uses FCT settings
        _jlFatConeTimer -= dt;
        if (_jlFatConeTimer <= 0) {
          const _fct = window._FCT || track;
          _jlFatConeTimer = (_fct.frequency / _jlIntensity) * (0.7 + Math.random() * 0.6);
          if (typeof window._spawnFatConeRow === 'function') window._spawnFatConeRow();
        }
      } else if (track.type === 'lethal_rings') {
        // Lethal ring row spawner — same cadence as campaign T4B_LETHAL
        _jlLrTimer -= dt;
        if (_jlLrTimer <= 0) {
          const baseInterval = track.settings && track.settings.frequency != null
            ? track.settings.frequency : 1.1;
          _jlLrTimer = (baseInterval / _jlIntensity) * (0.7 + Math.random() * 0.6);
          _jlSpawnLethalRingRow();
        }
      }
      // custom tracks: onActivate already fired above, they manage themselves
    } else {
      // Fire onDeactivate once on exit
      if (_jlTrackActive[track.id]) {
        _jlTrackActive[track.id] = false;
        if (track.onDeactivate) track.onDeactivate();
      }
    }
  }

  // ── Apply active asteroid settings each frame ─────────────────────────────
  if (_activeAst) {
    _jlApplyAsteroidTrack(_activeAst);
  } else {
    // No asteroid track active — disable
    _asteroidTuner.enabled = false;
  }

  // ── Apply active lightning settings each frame ────────────────────────────
  if (_activeLt) {
    _jlApplyLightningTrack(_activeLt);
  } else if (window._LT) {
    window._LT.enabled = false;
  }

}

// ═══════════════════════════════════════════════════════════════════════════════
//  JL SEQUENCER PANEL  (Q key)
// ═══════════════════════════════════════════════════════════════════════════════
(function setupJLSequencerPanel() {
  const panel = document.createElement('div');
  panel.id = 'jl-seq-panel';
  panel.style.cssText = 'display:none;position:fixed;top:0;right:0;width:320px;max-height:100%;background:rgba(0,0,0,0.93);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:10px;box-sizing:border-box;border:1px solid #fa0;border-top:none;border-right:none;';
  document.body.appendChild(panel);

  function mkH(text, color) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:8px 0 4px;font-size:11px;font-weight:bold;color:'+(color||'#fa0')+';border-bottom:1px solid #333;padding-bottom:2px;';
    h.textContent = text;
    return h;
  }
  function mkS(label, val, min, max, step, fn, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:100px;color:'+(color||'#fa0')+';font-size:10px;flex-shrink:0;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=val;
    inp.style.cssText = 'flex:1;height:14px;accent-color:'+(color||'#fa0')+';';
    const vEl = document.createElement('span');
    vEl.style.cssText = 'width:36px;text-align:right;font-size:10px;color:#fff;';
    vEl.textContent = (+val).toFixed(2);
    inp.oninput = () => { const v=+inp.value; vEl.textContent=v.toFixed(2); fn(v); };
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(vEl);
    return { row, inp, vEl };
  }
  function mkBtn(text, color, fn) {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'background:none;border:1px solid '+color+';color:'+color+';padding:3px 8px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px;';
    b.onclick = fn;
    return b;
  }

  function build() {
    panel.innerHTML = '<div style="font-size:13px;font-weight:bold;color:#fa0;margin-bottom:6px;">⚡ JL SEQUENCER (Q)</div>';

    // ── God mode toggle
    const godBtn = mkBtn(_godMode ? '☑ GOD MODE  (no damage)' : '☐ GOD MODE  (no damage)', _godMode ? '#0f0' : '#555', () => {
      _godMode = !_godMode;
      godBtn.textContent = _godMode ? '☑ GOD MODE  (no damage)' : '☐ GOD MODE  (no damage)';
      godBtn.style.color  = _godMode ? '#0f0' : '#555';
      godBtn.style.borderColor = _godMode ? '#0f0' : '#555';
    });
    godBtn.style.width = '100%';
    godBtn.style.marginBottom = '6px';
    panel.appendChild(godBtn);

    // ── Global scalars
    panel.appendChild(mkH('SCALARS'));
    const intSlider = mkS('intensity', _jlIntensity, 0.1, 3.0, 0.05, v => { _jlIntensity = v; }, '#fa0');
    panel.appendChild(intSlider.row);
    const sizeSlider = mkS('size', _jlSizeScalar, 0.2, 3.0, 0.05, v => { _jlSizeScalar = v; }, '#f80');
    panel.appendChild(sizeSlider.row);

    // ── Live readout
    const info = document.createElement('div');
    info.style.cssText = 'font-size:9px;color:#666;margin:4px 0 8px;line-height:1.6;white-space:pre;';
    const refreshInfo = () => {
      if (!state._jetLightningMode) { info.textContent = 'JL not active'; return; }
      const t = _jlRampTime || 0;
      const active = _JL_TRACKS
        .filter(tr => t >= tr.startT && (tr.endT === null || t < tr.endT))
        .map(tr => tr.label || tr.id).join(', ');
      info.textContent = 't=' + t.toFixed(1) + 's   intensity=' + _jlIntensity.toFixed(2) + '   size=' + _jlSizeScalar.toFixed(2) + '\nactive: ' + (active || 'none');
    };
    const _infoInterval = setInterval(refreshInfo, 250);
    refreshInfo();
    panel.appendChild(info);

    // ── Jump buttons: one per track
    panel.appendChild(mkH('JUMP TO TRACK'));
    const jumpNote = document.createElement('div');
    jumpNote.style.cssText = 'font-size:9px;color:#666;margin-bottom:4px;';
    jumpNote.textContent = 'Sets game clock to track startT. JL mode only.';
    panel.appendChild(jumpNote);

    let _lastJumpBtn = null;
    for (const track of _JL_TRACKS) {
      const color = track.type === 'asteroid'     ? '#f80'
                  : track.type === 'lightning'    ? '#6af'
                  : track.type === 'fatcone'      ? '#0f8'
                  : track.type === 'lethal_rings' ? '#f44'
                  : '#888';
      const endLabel = track.endT !== null ? track.endT + 's' : '∞';
      const btn = mkBtn(
        (track.label || track.id) + '  [' + track.startT + 's–' + endLabel + ']',
        color,
        () => {
          if (!state._jetLightningMode) return;
          // Reset all track activation flags so onActivate fires correctly
          for (const k of Object.keys(_jlTrackActive)) _jlTrackActive[k] = false;
          _jlRampTime = track.startT;
          // If jumping to a non-asteroid track, disable asteroids so they don't overlap
          if (track.type !== 'asteroid') {
            _asteroidTuner.enabled = false;
          } else {
            _asteroidTuner.enabled = true;
            _astTimer = 0.1;
          }
          // If jumping to a non-lightning track, disable lightning
          if (track.type !== 'lightning') {
            if (window._LT) window._LT.enabled = false;
          }
          if (track.id === 'fatcone') { if (window._startFcLoop) window._startFcLoop(null); }
          else { if (window._stopFcLoop) window._stopFcLoop(); }
          // If jumping away from lethal rings, clear in-flight rings
          if (track.type !== 'lethal_rings') {
            for (const lr of _lethalRingActive) { lr.userData.active = false; lr.visible = false; lr.position.set(0,-9999,0); }
            _lethalRingActive.length = 0;
          } else {
            _jlLrTimer = 1.0; // fire first row quickly on jump
          }
          if (_lastJumpBtn) { _lastJumpBtn.style.fontWeight = 'normal'; _lastJumpBtn.style.background = 'none'; }
          btn.style.fontWeight = 'bold'; btn.style.background = color + '22';
          _lastJumpBtn = btn;
        }
      );
      btn.style.width = '100%'; btn.style.textAlign = 'left';
      // Highlight currently active track
      const t = _jlRampTime || 0;
      if (t >= track.startT && (track.endT === null || t < track.endT)) {
        btn.style.fontWeight = 'bold'; btn.style.background = color + '22';
        _lastJumpBtn = btn;
      }
      panel.appendChild(btn);
    }
  }

  let visible = false;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'q' || e.key === 'Q') {
      visible = !visible;
      if (visible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

// Hook ramp into composer chain (safe to call before lightning IIFE since it
// just calls free-standing functions that exist by then)
(function _hookJLRamp() {
  const _jlOrigRender = composer.render.bind(composer);
  let   _jlLastTime   = performance.now();
  composer.render = function(...args) {
    const now = performance.now();
    const dt  = Math.min((now - _jlLastTime) * 0.001, 0.05);
    _jlLastTime = now;
    _tickJetLightningRamp(dt);
    _jlOrigRender(...args);
  };
})();

// Reset JL state when game ends / restarts
const _origStartGame_JL = startGame;
startGame = function() {
  if (state._jetLightningMode) {
    // JL physics applied in startJetLightning re-apply block — don't touch
  } else if (state._tutorialActive) {
    // Tutorial uses JL_v1 physics as baseline
    const _tp = _PHYSICS_PRESETS['JL_v1'];
    _accelBase     = _tp.accelBase;
    _accelSnap     = _tp.accelSnap;
    _maxVelBase    = _tp.maxVelBase;
    _maxVelSnap    = _tp.maxVelSnap;
    _bankMax       = _tp.bankMax;
    _bankSmoothing = _tp.bankSmoothing;
    _decelBasePct  = _tp.decelBasePct;
    _decelFullPct  = _tp.decelFullPct;
  } else {
    // Campaign defaults
    _accelBase     = 22;
    _accelSnap     = 52;
    _maxVelBase    = 9;
    _maxVelSnap    = 13;
    _bankMax       = 0.03;
  }
  _origStartGame_JL.apply(this, arguments);
  // After startGame resets speed to BASE_SPEED, bump tutorial to L4
  if (state._tutorialActive) {
    state.speed = BASE_SPEED * LEVELS[3].speedMult; // L4 = 1.5x
    state.currentLevelIdx = 3;
    currentLevelDef = LEVELS[3];
    targetLevelDef  = LEVELS[3];
  }
};

// Expose for title button
window.startJetLightning = startJetLightning;

// Debug probe for stress testing (read/write internal JL state)
window._jlDebug = {
  get rampTime()          { return _jlRampTime; },
  set rampTime(v)         { _jlRampTime = v; },
  get jlMode()            { return state._jetLightningMode; },
  get phase()             { return state.phase; },
  get score()             { return state.score; },
  get levelIdx()          { return state.currentLevelIdx; },
  get speed()             { return state.speed; },
  get shipX()             { return state.shipX; },
  set shipX(v)            { state.shipX = v; },
  get l4CorridorActive()  { return state.l4CorridorActive; },
  get l4CorridorDone()    { return state.l4CorridorDone; },
  get noSpawnMode()       { return _noSpawnMode; },
  get astEnabled()        { return _asteroidTuner.enabled; },
  get astPattern()        { return _asteroidTuner.pattern; },
  get astFreq()           { return _asteroidTuner.frequency; },
  get astLeadFactor()     { return _asteroidTuner.leadFactor; },
  get astStaggerDual()    { return _asteroidTuner.staggerDual; },
  get activeAsteroids()   { return _asteroidActive.length; },
  get activeObstacles()   { return activeObstacles.length; },
  tick(dt)                { _tickJetLightningRamp(dt); },
  snapshot() {
    return {
      rampTime:        Math.round(_jlRampTime),
      jlMode:          state._jetLightningMode,
      phase:           state.phase,
      score:           state.score,
      levelIdx:        state.currentLevelIdx,
      speed:           Math.round(state.speed),
      l4CorridorActive: state.l4CorridorActive,
      l4CorridorDone:  state.l4CorridorDone,
      noSpawnMode:     _noSpawnMode,
      astEnabled:      _asteroidTuner.enabled,
      astPattern:      _asteroidTuner.pattern,
      astFreq:         +_asteroidTuner.frequency.toFixed(2),
      astLeadFactor:   _asteroidTuner.leadFactor,
      astStaggerDual:  _asteroidTuner.staggerDual,
      ltEnabled:       window._LT.enabled,
      ltFreq:          +window._LT.frequency.toFixed(2),
      iceEnabled:      window._ICE.enabled,
      activeAsteroids: _asteroidActive.length,
      activeObstacles: activeObstacles.length,
    };
  }
};

//  LIGHTNING STRIKE SYSTEM  v3
//  – Spawns at SPAWN_Z like a cone, scrolls toward ship at game speed
//  – Warning disc travels with it (always over the target X)
//  – When it reaches ship Z it slams: bolt flash, shockwave, kill check
//  – TubeGeometry bolt (real width, not LineBasicMaterial)
//  – Full pattern engine: random / sweep / stagger / salvo / pinch
//  – Tuner on L key
// ═══════════════════════════════════════════════════════════════════════════════
(function setupLightningSystem() {

  const _LT = {
    enabled:      false,
    frequency:    0.3,   // locked from session log (rchouake approved)
    leadFactor:   0.6,
    skyHeight:    55,
    warningTime:  0.3,    // seconds disc shows before bolt slams — keep short so bolt strikes ahead of ship
    boltDuration: 0.5,    // seconds of initial flash
    lingerDuration: 4.0,  // seconds bolt stays planted in world (ship flies past it)
    coreRadius:   0.12,
    glowRadius:   0.25,
    segments:     10,
    jaggedness:   1.9,
    hitboxScale:  1.0,    // multiplier on glowRadius — hitbox always matches bolt visual
    warnRadius:   3.5,
    shakeAmt:     0.18,
    shakeDuration:0.35,
    glowColor:    0x88ccff,
    coreColor:    0xffffff,
    flashColor:   0x99ddff,
    warnColor:    0x44aaff,
    pattern:      'random',
    laneMin:      -8,
    laneMax:       8,
    sweepSpeed:   0.4,
    staggerGap:   0.6,
    salvoCount:   3,
    pinchSpread:  1.0,
    count:        1,
    spawnZ:      -83,   // how far out bolts spawn — closer = less reaction time
  };

  let _ltTimer    = 2.0;
  let _ltSweepX   = 0.5;
  let _ltSweepDir = 1;
  const _ltStaggerQ = [];
  const _ltActive   = [];   // active bolt instances

  // ── Pattern loop ──────────────────────────────────────────────────────────
  let _ltLoopActive = false, _ltLoopTimeout = null, _ltActiveBtn = null;
  function _startLtLoop(btn, color, tick) {
    _stopLtLoop();
    _ltLoopActive = true; _ltActiveBtn = btn;
    if (btn) { btn.style.background = color+'33'; btn.style.fontWeight='bold'; }
    function loop() {
      if (!_ltLoopActive) return;
      tick();
      _ltLoopTimeout = setTimeout(loop, _LT.frequency * 1000);
    }
    loop();
  }
  function _stopLtLoop() {
    _ltLoopActive = false;
    if (_ltLoopTimeout) { clearTimeout(_ltLoopTimeout); _ltLoopTimeout = null; }
    if (_ltActiveBtn) { _ltActiveBtn.style.background='none'; _ltActiveBtn.style.fontWeight='normal'; _ltActiveBtn=null; }
  }
  function _clearAllLightning() {
    [..._ltActive].forEach(_ltKill);
    _ltActive.length = 0;
  }

  // ── Target X from pattern ─────────────────────────────────────────────────
  function _ltNextTargetX() {
    const range = _LT.laneMax - _LT.laneMin;
    const sx = (state && state.shipX) || 0;
    switch (_LT.pattern) {
      case 'sweep': {
        const x = sx + (_ltSweepX - 0.5) * range;
        _ltSweepX += _ltSweepDir * _LT.sweepSpeed * _LT.frequency / range * 0.12;
        if (_ltSweepX >= 1 || _ltSweepX <= 0) { _ltSweepDir *= -1; _ltSweepX = Math.max(0,Math.min(1,_ltSweepX)); }
        return x;
      }
      case 'stagger': {
        // Ship-tracking: each shot reads shipX live at fire time (see auto-spawner)
        return sx + (Math.random()-0.5) * Math.min(3.0, range * 0.3);
      }
      case 'salvo': return sx + (Math.random()-0.5)*range*0.5;
      default:      return sx + (Math.random()-0.5)*3.0;
    }
  }

  // ── Build jagged TubeGeometry bolt ────────────────────────────────────────
  // Bolt geometry built at Z=0 local space — Group handles world Z position
  function _ltBoltGeo(topY, landX, segs, jagg, radius) {
    let pts = [{ x: landX, y: topY }, { x: landX, y: 0.5 }];
    const iters = Math.max(1, Math.round(Math.log2(Math.max(4, segs))));
    for (let d = 0; d < iters; d++) {
      const next = [];
      for (let i = 0; i < pts.length-1; i++) {
        next.push(pts[i]);
        next.push({ x:(pts[i].x+pts[i+1].x)*0.5+(Math.random()-0.5)*jagg*(1-d*0.2), y:(pts[i].y+pts[i+1].y)*0.5 });
      }
      next.push(pts[pts.length-1]);
      pts = next;
    }
    const v3pts = pts.map(p => new THREE.Vector3(p.x, p.y, 0)); // Z=0 local
    const curve = new THREE.CatmullRomCurve3(v3pts);
    return new THREE.TubeGeometry(curve, Math.max(4, pts.length), radius, 5, false);
  }

  // ── Spawn one lightning bolt ──────────────────────────────────────────────
  // Everything spawns at a Z offset ahead of the ship.
  // Warning disc pulses for warningTime seconds, then bolt slams and lingers.
  // After the strike the bolt is a planted world-space column — ship flies past it.
  function _spawnLightning(targetX) {
    const shipZ  = _shipZ();
    const landZ  = shipZ + _LT.spawnZ;  // spawnZ is negative = ahead of ship
    const velX   = (state && state.shipVelX) || 0;
    const travelTime = Math.abs(_LT.spawnZ) / Math.max(1, state.speed || 73);
    const landX  = targetX + velX * travelTime * _LT.leadFactor;

    // Warning disc — visible immediately at landZ ahead of ship
    const warnGeo  = new THREE.CircleGeometry(_LT.warnRadius, 32);
    const warnMat  = new THREE.MeshBasicMaterial({ color:_LT.warnColor, transparent:true, opacity:0.6, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
    const warnMesh = new THREE.Mesh(warnGeo, warnMat);
    warnMesh.rotation.x = -Math.PI/2;
    warnMesh.position.set(landX, 0.08, landZ);
    scene.add(warnMesh);

    // Ground flash
    const flashMat = new THREE.SpriteMaterial({ color:_LT.flashColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending });
    const flash    = new THREE.Sprite(flashMat);
    flash.scale.set(10, 10, 1);
    flash.position.set(landX, 1.5, landZ);
    scene.add(flash);

    // Shockwave ring
    const ringGeo  = new THREE.RingGeometry(0.1, 0.5, 48);
    const ringMat  = new THREE.MeshBasicMaterial({ color:_LT.glowColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
    const ring     = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI/2;
    ring.position.set(landX, 0.1, landZ);
    scene.add(ring);

    // Bolt group — Z=0 local geometry, group positioned at landZ and scrolled like a cone
    const boltGroup = new THREE.Group();
    boltGroup.position.set(0, 0, landZ);
    const coreMat  = new THREE.MeshBasicMaterial({ color:_LT.coreColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending });
    const glowMat  = new THREE.MeshBasicMaterial({ color:_LT.glowColor, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
    const coreGeo  = _ltBoltGeo(_LT.skyHeight, landX, _LT.segments, _LT.jaggedness,       _LT.coreRadius);
    const glowGeo  = _ltBoltGeo(_LT.skyHeight, landX, _LT.segments, _LT.jaggedness * 1.4, _LT.glowRadius);
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    boltGroup.add(coreMesh); boltGroup.add(glowMesh);
    scene.add(boltGroup);

    _ltActive.push({
      landX, landZ, strikePosZ: landZ,
      phase: 'warn', elapsed: 0, strikeElapsed: 0, lingerElapsed: 0,
      warnMesh, warnGeo, warnMat,
      flash, flashMat,
      ring, ringGeo, ringMat,
      boltGroup, coreMesh, coreGeo, coreMat,
      glowMesh, glowGeo, glowMat,
      ringScale: 0.3, hitChecked: false,
    });
  }

  function _ltKill(inst) {
    scene.remove(inst.warnMesh); inst.warnGeo.dispose(); inst.warnMat.dispose();
    scene.remove(inst.flash);    inst.flashMat.dispose();
    scene.remove(inst.ring);     inst.ringGeo.dispose(); inst.ringMat.dispose();
    scene.remove(inst.boltGroup); inst.coreGeo.dispose(); inst.coreMat.dispose(); inst.glowGeo.dispose(); inst.glowMat.dispose();
  }

  function _ltRejag(inst) {
    inst.coreGeo.dispose(); inst.glowGeo.dispose();
    const ng = _ltBoltGeo(_LT.skyHeight, inst.landX, _LT.segments, _LT.jaggedness,     _LT.coreRadius);
    const gg = _ltBoltGeo(_LT.skyHeight, inst.landX, _LT.segments, _LT.jaggedness*1.4, _LT.glowRadius);
    inst.coreMesh.geometry = ng; inst.coreGeo = ng;
    inst.glowMesh.geometry = gg; inst.glowGeo = gg;
  }

  let _ltShakeTime = 0;
  let _ltShakeOffX = 0, _ltShakeOffY = 0;
  const _shipZ = () => shipGroup ? shipGroup.position.z : 3.9;

  function _updateLightning(dt) {
    // Auto-spawn
    if (_LT.enabled && !_noSpawnMode && !_ltLoopActive) {
      _ltTimer -= dt;
      if (_ltTimer <= 0) {
        _ltTimer = _LT.frequency * (0.8 + Math.random()*0.4) * Math.max(0.15, 1.0 - _funFloorIntensity * 0.85);
        // Always one bolt at a time, aimed at ship's current X — no salvo, no batching
        if (_LT.pattern === 'stagger') {
          _spawnLightning(state.shipX || 0);
        } else {
          _spawnLightning(_ltNextTargetX());
        }
      }
    }

    // Camera shake: undo last frame's offset, apply new one — never drifts
    camera.position.x -= _ltShakeOffX;
    camera.position.y -= _ltShakeOffY;
    if (_ltShakeTime > 0) {
      _ltShakeTime -= dt;
      const s = _LT.shakeAmt * (_ltShakeTime / Math.max(0.01, _LT.shakeDuration));
      _ltShakeOffX = (Math.random()-0.5)*s;
      _ltShakeOffY = (Math.random()-0.5)*s*0.4;
      camera.position.x += _ltShakeOffX;
      camera.position.y += _ltShakeOffY;
    } else {
      _ltShakeOffX = 0; _ltShakeOffY = 0;
    }

    const spd = state ? (state.invincibleSpeedActive ? state.speed * 1.8 : state.speed) : 73;

    for (let i = _ltActive.length-1; i >= 0; i--) {
      const inst = _ltActive[i];
      inst.elapsed += dt;

      // Scroll ALL phases — bolt moves toward ship like a cone, always
      const scrollDt = spd * dt;
      inst.warnMesh.position.z  += scrollDt;
      inst.flash.position.z     += scrollDt;
      inst.ring.position.z      += scrollDt;
      inst.boltGroup.position.z += scrollDt;
      inst.strikePosZ           += scrollDt;

      // Despawn once it scrolls past ship
      if (inst.boltGroup.position.z > _shipZ() + 20) {
        _ltKill(inst); _ltActive.splice(i, 1); continue;
      }

      if (inst.phase === 'warn') {
        // Live-track ship X during warn phase (stagger pattern only) so the
        // strike snaps to wherever the ship actually is at the moment of impact.
        if (_LT.pattern === 'stagger') {
          const liveX = (state && state.shipX) || 0;
          if (liveX !== inst.landX) {
            inst.landX = liveX;
            inst.warnMesh.position.x = liveX;
            inst.flash.position.x    = liveX;
            inst.ring.position.x     = liveX;
            // Bolt geo stays hidden (opacity 0) during warn — rebuild at strike time
          }
        }

        // Warning disc pulses at the target position
        inst.warnMat.opacity = 0.4 + 0.35 * Math.abs(Math.sin(inst.elapsed * 8));
        const sc = 0.85 + 0.2 * Math.abs(Math.sin(inst.elapsed * 5));
        inst.warnMesh.scale.set(sc, sc, 1);

        // Strike after warningTime — bolt is still ahead of ship, plants there
        if (inst.elapsed >= _LT.warningTime) {
          inst.phase = 'strike';
          inst.strikeElapsed = 0;
          inst.warnMat.opacity = 0;
          inst.coreMat.opacity = 1.0;
          inst.glowMat.opacity = 0.5;
          inst.flashMat.opacity = 1.0;
          inst.ringMat.opacity  = 0.9;
          _ltShakeTime = _LT.shakeDuration;
          _playLightningStrike();
          // Rebuild bolt geometry at the final locked landX (ship pos at strike)
          _ltRejag(inst);
        }

      } else if (inst.phase === 'strike') {
        inst.strikeElapsed += dt;
        const t = inst.strikeElapsed / Math.max(0.01, _LT.boltDuration);

        if (Math.floor(inst.strikeElapsed * 22) % 3 === 0) _ltRejag(inst);

        // Flash fades fast, bolt stays bright
        inst.coreMat.opacity  = Math.max(0.8, 1.0 - t*0.1);
        inst.glowMat.opacity  = Math.max(0.4, 0.5 - t*0.05);
        inst.flashMat.opacity = Math.max(0, 1.0 - t*4.0);
        inst.ringScale += dt * 22;
        inst.ring.scale.set(inst.ringScale, inst.ringScale, 1);
        inst.ringMat.opacity  = Math.max(0, 0.9 - t*2.0);

        // Hit check — bolt is a vertical column, only X matters at strike moment
        if (!inst.hitChecked && state && state.phase === 'playing') {
          inst.hitChecked = true;
          const dx = (state.shipX||0) - inst.landX;
          const dz = Math.abs(_shipZ() - inst.strikePosZ);
          if (Math.abs(dx) < (_LT.glowRadius * _LT.hitboxScale) && dz < 6) {
                    const _ltHitSfx = document.getElementById('shield-hit-sfx');
            if (_ltHitSfx) { _ltHitSfx.currentTime = 0; _ltHitSfx.play().catch(()=>{}); }
            if (state._tutorialActive || _godMode) addCrashFlash(0x4488ff);
            else killPlayer();
          }
        }

        if (inst.strikeElapsed >= _LT.boltDuration) {
          // Transition to linger — bolt stays planted, crackles as ship flies past
          inst.phase = 'linger';
          inst.lingerElapsed = 0;
          inst.flashMat.opacity = 0;
        }

      } else if (inst.phase === 'linger') {
        inst.lingerElapsed += dt;
        const t = inst.lingerElapsed / Math.max(0.01, _LT.lingerDuration);

        // Crackle: random flicker
        if (Math.floor(inst.lingerElapsed * 18) % 2 === 0) _ltRejag(inst);
        // Stay bright for most of linger, only fade in last 25%
        const fadeT = Math.max(0, (t - 0.75) / 0.25);
        const flicker = 0.7 + 0.3 * Math.abs(Math.sin(inst.lingerElapsed * 14 + Math.random()));
        inst.coreMat.opacity = Math.max(0, (1.0 - fadeT) * flicker);
        inst.glowMat.opacity = Math.max(0, (0.5  - fadeT * 0.5) * flicker);

        // During linger: bolt is planted in world, ship is flying past it.
        // Kill zone = lateral X only — hitbox width = glowRadius * hitboxScale (tracks bolt visual)
        // and the bolt's world Z is still near the ship (within a ship-length)
        if (state && state.phase === 'playing') {
          const dx = Math.abs((state.shipX||0) - inst.landX);
          const dz = Math.abs(_shipZ() - inst.strikePosZ);
          const near = dx < (_LT.glowRadius * _LT.hitboxScale) && dz < 4;
          if (near && !inst.hitChecked) {
            inst.hitChecked = true;
                    const _ltHitSfx = document.getElementById('shield-hit-sfx');
            if (_ltHitSfx) { _ltHitSfx.currentTime = 0; _ltHitSfx.play().catch(()=>{}); }
            if (state._tutorialActive || _godMode) addCrashFlash(0x4488ff);
            else killPlayer();
          }
          if (!near) inst.hitChecked = false;
        }

        if (inst.lingerElapsed >= _LT.lingerDuration) {
          _ltKill(inst); _ltActive.splice(i,1);
        }
      }
    }
  }

  // ── Hook into composer render ─────────────────────────────────────────────
  const _ltOrigRender = composer.render.bind(composer);
  let _ltLastTime = performance.now();
  composer.render = function(...args) {
    const now = performance.now();
    const dt  = Math.min((now - _ltLastTime)*0.001, 0.05);
    _ltLastTime = now;
    if (state.phase === 'playing' && !state.introActive &&
        (state._tutorialActive || _chaosMode || state._jetLightningMode)) {
      _updateLightning(dt);
    }
    _ltOrigRender(...args);
  };

  // ── Tuner panel (L key) ───────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'lightning-tuner';
  panel.style.cssText = 'display:none;position:fixed;top:0;left:270px;width:260px;height:100%;background:rgba(0,0,0,0.93);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;border-right:1px solid #6af;';
  document.body.appendChild(panel);

  function mkS(label,val,min,max,step,fn){ const row=document.createElement('div'); row.style.cssText='margin:3px 0;display:flex;align-items:center;gap:4px;'; const lbl=document.createElement('span'); lbl.style.cssText='width:120px;color:#6af;font-size:10px;flex-shrink:0;'; lbl.textContent=label; const inp=document.createElement('input'); inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=val; inp.style.cssText='flex:1;height:14px;accent-color:#6af;'; const vEl=document.createElement('span'); vEl.style.cssText='width:38px;text-align:right;font-size:10px;color:#fff;'; vEl.textContent=(+val).toFixed(2); inp.addEventListener('input',()=>{ const v=parseFloat(inp.value); vEl.textContent=v.toFixed(2); fn(v); if(window._sessionLogSlider) _sessionLogSlider('lt_'+label,v); }); row.appendChild(lbl); row.appendChild(inp); row.appendChild(vEl); return row; }
  function mkT(label,getter,setter){ const row=document.createElement('div'); row.style.cssText='margin:4px 0;display:flex;align-items:center;gap:8px;'; const lbl=document.createElement('span'); lbl.style.cssText='color:#6af;font-size:10px;flex:1;'; lbl.textContent=label; const btn=document.createElement('button'); btn.style.cssText='padding:2px 10px;font-size:10px;cursor:pointer;background:#222;border:1px solid #6af;color:#fff;border-radius:3px;'; const ref=()=>{ btn.textContent=getter()?'ON':'OFF'; btn.style.background=getter()?'#224':'#222'; }; ref(); btn.addEventListener('click',()=>{ setter(!getter()); ref(); }); row.appendChild(lbl); row.appendChild(btn); return row; }
  function mkSel(label,opts,getter,setter){ const row=document.createElement('div'); row.style.cssText='margin:4px 0;display:flex;align-items:center;gap:6px;'; const lbl=document.createElement('span'); lbl.style.cssText='width:80px;color:#6af;font-size:10px;flex-shrink:0;'; lbl.textContent=label; const sel=document.createElement('select'); sel.style.cssText='flex:1;background:#111;color:#fff;border:1px solid #6af;font-size:10px;padding:1px;'; opts.forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; if(o===getter()) op.selected=true; sel.appendChild(op); }); sel.addEventListener('change',()=>setter(sel.value)); row.appendChild(lbl); row.appendChild(sel); return row; }
  function mkH(t){ const h=document.createElement('div'); h.style.cssText='color:#6af;font-weight:bold;font-size:12px;margin:10px 0 3px;border-bottom:1px solid #6af;padding-bottom:2px;'; h.textContent=t; return h; }
  function mkB(label,color,onClick){ const b=document.createElement('button'); b.textContent=label; b.style.cssText=`background:none;border:1px solid ${color};color:${color};padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px 0;width:100%;text-align:left;`; b.addEventListener('click',onClick); return b; }

  function build(){
    panel.innerHTML='';
    panel.appendChild(mkH('⚡ LIGHTNING TUNER'));
    panel.appendChild(mkT('ENABLED',()=>_LT.enabled,v=>{ _LT.enabled=v; if(!v){_stopLtLoop();_clearAllLightning();} }));
    panel.appendChild(mkH('SPAWN'));
    panel.appendChild(mkS('frequency (s)',  _LT.frequency,    0.05,15, 0.05, v=>_LT.frequency=v));
    panel.appendChild(mkS('count',          _LT.count,        1,  4,   1,   v=>_LT.count=Math.round(v)));
    panel.appendChild(mkS('lead factor',    _LT.leadFactor,   0,  1.5, 0.05,v=>_LT.leadFactor=v));
    panel.appendChild(mkS('sky height',     _LT.skyHeight,    10, 120, 1,   v=>_LT.skyHeight=v));
    panel.appendChild(mkS('forward dist', Math.abs(_LT.spawnZ), 5, 160, 1, v=>_LT.spawnZ=-v));
    panel.appendChild(mkH('PATTERN'));
    panel.appendChild(mkSel('pattern',['random','sweep','stagger','salvo','pinch'],()=>_LT.pattern,v=>{ _LT.pattern=v; _ltStaggerQ.length=0; _ltSweepX=0.5; }));
    panel.appendChild(mkS('lane min X',    _LT.laneMin,    -20,0,   0.5, v=>_LT.laneMin=v));
    panel.appendChild(mkS('lane max X',    _LT.laneMax,    0,  20,  0.5, v=>_LT.laneMax=v));
    panel.appendChild(mkS('sweep speed',   _LT.sweepSpeed, 0.05,2,  0.01,v=>_LT.sweepSpeed=v));
    panel.appendChild(mkS('stagger gap(s)',_LT.staggerGap, 0.1,3,   0.05,v=>_LT.staggerGap=v));
    panel.appendChild(mkS('salvo count',   _LT.salvoCount, 1,  8,   1,   v=>_LT.salvoCount=Math.round(v)));
    panel.appendChild(mkS('pinch spread',  _LT.pinchSpread,0.1,3,   0.05,v=>_LT.pinchSpread=v));
    panel.appendChild(mkH('TIMING'));
    panel.appendChild(mkS('bolt duration(s)', _LT.boltDuration,  0.1, 2,   0.05, v=>_LT.boltDuration=v));
    panel.appendChild(mkS('linger duration(s)',_LT.lingerDuration, 0.2, 6.0, 0.1,  v=>_LT.lingerDuration=v));
    panel.appendChild(mkH('VISUALS'));
    panel.appendChild(mkS('core radius',  _LT.coreRadius,  0.01,3,  0.01,v=>_LT.coreRadius=v));
    panel.appendChild(mkS('glow radius',  _LT.glowRadius,  0.05,8,  0.05,v=>_LT.glowRadius=v));
    panel.appendChild(mkS('segments',     _LT.segments,    4,  64,  1,   v=>_LT.segments=Math.round(v)));
    panel.appendChild(mkS('jaggedness',   _LT.jaggedness,  0.1,6,   0.05,v=>_LT.jaggedness=v));
    panel.appendChild(mkS('warn radius',  _LT.warnRadius,  0.5,12,  0.1, v=>_LT.warnRadius=v));
    panel.appendChild(mkH('IMPACT'));
    panel.appendChild(mkS('hitbox scale',  _LT.hitboxScale,  0.1, 3.0, 0.05, v=>_LT.hitboxScale=v));
    panel.appendChild(mkS('shake amount',   _LT.shakeAmt,      0,  1,  0.01,v=>_LT.shakeAmt=v));
    panel.appendChild(mkS('shake duration', _LT.shakeDuration, 0,  1,  0.02,v=>_LT.shakeDuration=v));
    panel.appendChild(mkH('PATTERN LOOPS'));
    const pats=[
      {label:'↯ RANDOM (loop)', color:'#6af', tick:()=>{ for(let c=0;c<Math.max(1,_LT.count);c++) setTimeout(()=>{ if(state.phase==='playing') _spawnLightning(_ltNextTargetX()); },c*120); }},
      {label:'►◄ SWEEP (loop)', color:'#0df', tick:()=>{ const range=_LT.laneMax-_LT.laneMin,swOff=(_ltSweepX-0.5)*range; _ltSweepX+=_ltSweepDir*_LT.sweepSpeed*0.35; if(_ltSweepX>=1||_ltSweepX<=0){_ltSweepDir*=-1;_ltSweepX=Math.max(0,Math.min(1,_ltSweepX));} const n=Math.max(2,_LT.salvoCount); for(let i=0;i<n;i++) setTimeout(()=>{ if(state.phase==='playing') _spawnLightning(state.shipX+swOff+(i/(n-1)-0.5)*range*0.5); },i*250); }},
      {label:'▼ ▼▼ STAGGER (loop)', color:'#ff0', tick:()=>{ if(state.phase==='playing') _spawnLightning(state.shipX); }},
      {label:'▼▼▼ SALVO (loop)', color:'#f80', tick:()=>{ const sx=state.shipX,n=Math.max(1,_LT.salvoCount),half=(_LT.laneMax-_LT.laneMin)*0.45; for(let si=0;si<n;si++) _spawnLightning(sx+(n===1?0:(si/(n-1)-0.5))*half*2); }},
      {label:'▷◁ PINCH (loop)', color:'#f0f', tick:()=>{ const sx=state.shipX,pairs=5,fh=(_LT.laneMax-_LT.laneMin)*0.5*_LT.pinchSpread; for(let pi=0;pi<pairs;pi++){ const hs=Math.max(0.3,fh*(1-pi/(pairs-1))),d=pi*300; (function(s,dl){const fn=()=>{ if(state.phase!=='playing')return; _spawnLightning(sx-s); _spawnLightning(sx+s); }; dl===0?fn():setTimeout(fn,dl);})(hs,d); } setTimeout(()=>{ if(state.phase==='playing') _spawnLightning(sx); },pairs*300); }},
    ];
    pats.forEach(({label,color,tick})=>{ const b=mkB(label,color,()=>_startLtLoop(b,color,tick)); panel.appendChild(b); });
    panel.appendChild(mkB('⏹ STOP LOOP','#888',_stopLtLoop));
    panel.appendChild(mkB('✕ CLEAR ALL','#f44',()=>{ _stopLtLoop(); _clearAllLightning(); }));
    const oneBtn=document.createElement('button'); oneBtn.textContent='⚡ STRIKE NOW';
    oneBtn.style.cssText='width:100%;padding:6px;margin:6px 0 2px;background:#224;border:1px solid #6af;color:#6af;font-family:monospace;font-size:12px;cursor:pointer;border-radius:3px;';
    oneBtn.addEventListener('click',()=>_spawnLightning((state&&state.shipX)||0));
    panel.appendChild(oneBtn);
    const cEl=document.createElement('div'); cEl.style.cssText='margin-top:6px;color:#888;font-size:10px;';
    const rc=()=>{ cEl.textContent='active: '+_ltActive.length; }; rc(); setInterval(rc,500); panel.appendChild(cEl);
  }

  // Expose config + spawner so external systems (chaos mode) can drive lightning
  window._LT             = _LT;
  window._spawnLightning = _spawnLightning;

  let visible=false;
  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    if(e.key==='l'||e.key==='L'){ visible=!visible; if(visible){build();panel.style.display='block';}else panel.style.display='none'; }
  });

})();


// ═══════════════════════════════════════════════════════════════════════════════
//  ICE CHUNK OBSTACLE SYSTEM  v1
//  – Spawns massive floating ice slabs ahead of the ship (like cones / lightning)
//  – MeshPhysicalMaterial with transmission for a real ice/glass look
//  – Pool of 8 chunks; each scrolls with the world
//  – Tuner on C key
// ═══════════════════════════════════════════════════════════════════════════════
(function setupIceSystem() {

  // ── Config object (mirrors _LT / _asteroidTuner structure) ─────────────────
  const _ICE = {
    enabled:      false,
    frequency:    3.0,    // seconds between spawns
    spawnZ:      -120,    // how far ahead chunks appear
    laneMin:     -10,
    laneMax:      10,
    pattern:      'random',
    sweepSpeed:   0.25,
    staggerGap:   0.8,
    salvoCount:   2,
    // Size
    sizeMin:      8.0,    // base XZ scale
    sizeMax:      14.0,   // max XZ scale
    heightMin:    6.0,    // base Y scale
    heightMax:    14.0,   // max Y scale
    baseY:       -1.2,    // Y offset at spawn — negative sinks into water
    // Material
    transmission:      0.25,
    roughness:         0.4,
    metalness:         0.85,
    ior:               1.31,
    thickness:         6.0,
    emissiveIntensity: 4.0,
    // Style
    chunkStyle:        'grid',
    chunkBaseColor:    '#ffffff',
    chunkCrackColor:   '#ff00cc',
    chunkGridColor:    '#00eeff',
    chunkGridOpacity:  0.55,
    chunkEmissiveColor:'#003060',
    // Hitbox
    hitboxScale:  0.72,
  };

  const _ICE_POOL_SIZE = 8;
  const _icePool       = [];
  let   _iceActive     = [];
  let   _iceTimer      = 2.0;
  let   _iceSweepX     = 0.5;
  let   _iceSweepDir   = 1;
  const _iceStaggerQ   = [];

  // ── Displaced-icosahedron glacier geometry ────────────────────────────────
  // ── Ice chunk geometry: small terrain-slab fragments ───────────────────────
  // Each chunk is a displaced PlaneGeometry patch — same noise as the canyon
  // walls, so it looks like a piece that broke off. Style is independent from
  // the terrain: own color, own crack texture, own material mode.

  // Build a canvas texture for the chunk surface (called on rebuild)
  function _makeIceChunkTex() {
    const w = 256, h = 256;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');

    // Base fill
    const bc = _ICE.chunkBaseColor || '#060d1a';
    ctx.fillStyle = bc;
    ctx.fillRect(0, 0, w, h);

    const style = _ICE.chunkStyle || 'cracks';

    if (style === 'cracks' || style === 'both') {
      // Magenta/cyan crack lines
      let _rs = 77;
      const srng = () => { _rs = (_rs * 16807) % 2147483647; return (_rs - 1) / 2147483646; };
      const cc = _ICE.chunkCrackColor || '#ff00cc';
      for (let ci = 0; ci < 14; ci++) {
        const sx = srng() * w, sy = srng() * h;
        ctx.strokeStyle = srng() > 0.5 ? cc : '#00eeff';
        ctx.globalAlpha  = 0.4 + srng() * 0.5;
        ctx.lineWidth    = 0.7 + srng() * 1.6;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        let cx = sx, cy2 = sy;
        for (let si = 0; si < 3 + Math.floor(srng()*3); si++) {
          cx  += (srng() - 0.3) * 70;
          cy2 += (srng() - 0.2) * 55;
          ctx.lineTo(cx, cy2);
        }
        ctx.stroke();
      }
      // Glow hotspots
      for (let gi = 0; gi < 5; gi++) {
        const gx = srng()*w, gy = srng()*h;
        const gr = ctx.createRadialGradient(gx,gy,0,gx,gy,14+srng()*20);
        gr.addColorStop(0,   'rgba(255,0,200,0.6)');
        gr.addColorStop(0.5, 'rgba(80,0,200,0.2)');
        gr.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.globalAlpha = 1;
        ctx.fillRect(gx-35, gy-35, 70, 70);
      }
    }

    if (style === 'grid' || style === 'both') {
      const gc = _ICE.chunkGridColor || '#00eeff';
      ctx.strokeStyle = gc;
      ctx.globalAlpha  = _ICE.chunkGridOpacity || 0.55;
      ctx.lineWidth    = 1.2;
      const gx = 8, gz = 8;
      for (let i = 0; i <= gx; i++) { const x=(i/gx)*w; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
      for (let j = 0; j <= gz; j++) { const y=(j/gz)*h; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    }

    if (style === 'clean') {
      // Just a subtle edge vignette — no lines, pure ice slab
      const gr = ctx.createRadialGradient(w/2,h/2,h*0.2,w/2,h/2,h*0.75);
      gr.addColorStop(0, 'rgba(150,220,255,0.08)');
      gr.addColorStop(1, 'rgba(0,20,60,0.55)');
      ctx.fillStyle = gr; ctx.globalAlpha = 1;
      ctx.fillRect(0,0,w,h);
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // Shared chunk material — rebuilt via REBUILD button
  let _iceChunkTex = _makeIceChunkTex();
  function _makeIceMat() {
    const useTransmission = _ICE.transmission > 0.05;
    if (useTransmission) {
      return new THREE.MeshPhysicalMaterial({
        color:             new THREE.Color(_ICE.chunkBaseColor || '#aaccee'),
        map:               _iceChunkTex,
        emissive:          new THREE.Color(_ICE.chunkEmissiveColor || '#0044aa'),
        emissiveMap:       _iceChunkTex,
        emissiveIntensity: _ICE.emissiveIntensity,
        transmission:      _ICE.transmission,
        roughness:         _ICE.roughness,
        metalness:         _ICE.metalness,
        ior:               _ICE.ior,
        thickness:         _ICE.thickness,
        transparent:       true,
        opacity:           0.94,
        side:              THREE.DoubleSide,
        flatShading:       true,
        depthWrite:        false,
      });
    } else {
      return new THREE.MeshStandardMaterial({
        color:             new THREE.Color(_ICE.chunkBaseColor || '#0a1a2a'),
        map:               _iceChunkTex,
        emissive:          new THREE.Color(_ICE.chunkEmissiveColor || '#0044aa'),
        emissiveMap:       _iceChunkTex,
        emissiveIntensity: _ICE.emissiveIntensity,
        roughness:         _ICE.roughness,
        metalness:         _ICE.metalness,
        side:              THREE.DoubleSide,
        flatShading:       true,
      });
    }
  }

  // Terrain-patch displacement — same noise as canyon walls, small scale
  function _displaceChunk(geo, seed, peakH) {
    let _s = seed;
    const srng = () => { _s = (_s*16807)%2147483647; return (_s-1)/2147483646; };
    const pos = geo.attributes.position;
    const uv  = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u  = uv.getX(i);
      const vv = uv.getY(i);
      const px = u * 10.0 + srng()*2, pz = vv * 14.0 + srng()*2;
      const n1 = Math.sin(px*2.1+pz*1.1)*0.35;
      const n2 = Math.sin(px*5.3+pz*3.7)*0.25;
      const n3 = Math.abs(Math.sin(px*3.8+pz*2.2))*0.28;
      const noise = Math.pow(Math.max(0, 0.4+n1+n2+n3), 1.3);
      pos.setY(i, noise * peakH);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  function _buildIceInstance(seed) {
    const group = new THREE.Group();
    group.visible = false;
    const mat = _makeIceMat();

    // Chunk: a PlaneGeometry patch, displaced upward like a terrain fragment
    const segs = 10;
    const geo = new THREE.PlaneGeometry(1, 1, segs, segs);
    geo.rotateX(-Math.PI / 2);  // lay flat, displacement goes up
    _displaceChunk(geo, seed || 7919, 0.9);
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    const light = new THREE.PointLight(0x44aaff, 0.9, 20);
    light.position.set(0, 0.5, 0);
    group.add(light);

    scene.add(group);
    return {
      group, mesh, light,
      mats: [mat],
      get mat()  { return mat; },
      get mat2() { return mat; },
      active: false, halfW: 1, elapsed: 0,
    };
  }

  function _rebuildIcePool() {
    // Dispose old pool
    for (const inst of _icePool) {
      scene.remove(inst.group);
      inst.mesh.geometry.dispose();
      inst.mats.forEach(m => m.dispose());
    }
    _icePool.length = 0;
    _iceActive.length = 0;
    _iceChunkTex.dispose();
    _iceChunkTex = _makeIceChunkTex();
    for (let _ii = 0; _ii < _ICE_POOL_SIZE; _ii++) _icePool.push(_buildIceInstance((_ii+1)*7919));
  }

  // Initial pool build
  for (let _ii = 0; _ii < _ICE_POOL_SIZE; _ii++) _icePool.push(_buildIceInstance((_ii + 1) * 7919));

  function _getFreeIce() {
    return _icePool.find(c => !c.active) || null;
  }

  // ── Next target X from pattern (mirrors _ltNextTargetX) ───────────────────
  function _iceNextX() {
    const range = _ICE.laneMax - _ICE.laneMin;
    const sx    = (state && state.shipX) || 0;
    switch (_ICE.pattern) {
      case 'sweep': {
        const x = sx + (_iceSweepX - 0.5) * range;
        _iceSweepX += _iceSweepDir * _ICE.sweepSpeed * _ICE.frequency / range * 0.12;
        if (_iceSweepX >= 1 || _iceSweepX <= 0) { _iceSweepDir *= -1; _iceSweepX = Math.max(0, Math.min(1, _iceSweepX)); }
        return x;
      }
      case 'stagger': {
        if (_iceStaggerQ.length === 0) {
          const steps = 4 + Math.floor(Math.random() * 4);
          for (let i = 0; i < steps; i++) _iceStaggerQ.push(sx + (i / (steps - 1) - 0.5) * range * 0.85);
        }
        return _iceStaggerQ.shift();
      }
      case 'salvo': return sx + (Math.random() - 0.5) * range * 0.5;
      default:      return sx + (Math.random() - 0.5) * (range * 0.55);
    }
  }

  // ── Spawn one chunk ────────────────────────────────────────────────────────
  function _spawnIce(targetX) {
    const inst = _getFreeIce();
    if (!inst) return;

    // Randomise size each spawn
    const scaleX = _ICE.sizeMin   + Math.random() * (_ICE.sizeMax   - _ICE.sizeMin);
    const scaleY = _ICE.heightMin + Math.random() * (_ICE.heightMax - _ICE.heightMin);
    const scaleZ = scaleX * (0.55 + Math.random() * 0.7);
    const tiltY  = (Math.random() - 0.5) * 0.9;   // random yaw
    const tiltX  = (Math.random() - 0.5) * 0.06;  // very slight pitch — stay mostly upright

    inst.group.scale.set(scaleX, scaleY, scaleZ);
    inst.group.rotation.set(tiltX, tiltY, 0);
    inst.halfW = scaleX * _ICE.hitboxScale * 0.5;

    // Live-update material params for all spire/base materials
    for (const m of inst.mats) {
      m.transmission      = _ICE.transmission;
      m.roughness         = _ICE.roughness;
      m.ior               = _ICE.ior;
      m.thickness         = _ICE.thickness;
      m.emissiveIntensity = _ICE.emissiveIntensity;
      m.needsUpdate       = true;
    }

    // World-space Z: ahead of ship (shipGroup.position.z is always 3.9 — world scrolls)
    const shipZ  = (typeof shipGroup !== 'undefined' && shipGroup) ? shipGroup.position.z : 3.9;
    const spawnZ = shipZ + _ICE.spawnZ;
    inst.group.position.set(targetX, _ICE.baseY, spawnZ);
    inst.group.visible = true;
    inst.light.intensity = 0.6;
    inst.elapsed = 0;
    inst.active  = true;
    _iceActive.push(inst);
  }

  // ── Kill / recycle one chunk ───────────────────────────────────────────────
  function _killIce(inst) {
    inst.group.visible = false;
    inst.active = false;
    const idx = _iceActive.indexOf(inst);
    if (idx !== -1) _iceActive.splice(idx, 1);
  }

  function _clearAllIce() {
    for (let i = _iceActive.length - 1; i >= 0; i--) _killIce(_iceActive[i]);
    _iceActive.length = 0;
    _iceTimer = 0;
    _iceSweepX = 0.5; _iceSweepDir = 1;
    _iceStaggerQ.length = 0;
  }

  // ── Per-frame update: scroll + hitcheck ───────────────────────────────────
  function _updateIce(dt) {
    const scrollSpeed = state.speed || 36;
    for (let i = _iceActive.length - 1; i >= 0; i--) {
      const inst = _iceActive[i];
      inst.elapsed += dt;

      // Scroll — same as cones: world moves toward ship, chunk moves +Z each frame
      inst.group.position.z += scrollSpeed * dt;

      // Gentle bob on water
      inst.group.position.y = _ICE.baseY + Math.sin(inst.elapsed * 0.9 + i) * 0.06;

      // Despawn behind ship
      if (inst.group.position.z > 8) {
        _killIce(inst);
        continue;
      }

      // Hit check — only when chunk is near ship Z (z > -4)
      if (inst.group.position.z > -4 && inst.group.position.z < 5) {
        const sx  = (state && state.shipX) || 0;
        const dx  = Math.abs(inst.group.position.x - sx);
        if (dx < inst.halfW) {
          if (_godMode) {
            // God mode: shield-hit sound, no death
            const _shHitSfx = document.getElementById('shield-hit-sfx');
            if (_shHitSfx) { _shHitSfx.currentTime = 0; _shHitSfx.play().catch(()=>{}); }
            addCrashFlash(0xff4400);
          } else {
            if (typeof triggerDeath === 'function') triggerDeath();
            else if (typeof window.triggerDeath === 'function') window.triggerDeath();
          }
          _killIce(inst);
          continue;
        }
      }
    }
  }

  // ── Spawn tick ────────────────────────────────────────────────────────────
  function _tickIceSpawner(dt) {
    if (!_ICE.enabled) return;
    // _ICE.enabled already checked above — always allow when enabled (bypasses tutorial _noSpawnMode)

    _iceTimer -= dt;
    if (_iceTimer <= 0) {
      _iceTimer = _ICE.frequency * (0.75 + Math.random() * 0.5);

      if (_ICE.pattern === 'salvo') {
        const count = Math.max(1, Math.round(_ICE.salvoCount));
        const sx    = (state && state.shipX) || 0;
        const half  = (_ICE.laneMax - _ICE.laneMin) * 0.45;
        for (let si = 0; si < count; si++) {
          const frac = count === 1 ? 0.5 : si / (count - 1);
          _spawnIce(sx + (frac - 0.5) * half * 2);
        }
      } else {
        _spawnIce(_iceNextX());
      }
    }
  }

  // ── Hook into composer.render (same chaining pattern as asteroids/lightning)
  const _iceOrigRender = composer.render.bind(composer);
  let   _iceLastTime   = performance.now();
  composer.render = function(...args) {
    const now = performance.now();
    const dt  = Math.min((now - _iceLastTime) * 0.001, 0.05);
    _iceLastTime = now;
    if (state.phase === 'playing' && !state.introActive &&
        (state._tutorialActive || _chaosMode || state._jetLightningMode)) {
      _tickIceSpawner(dt);
    }
    _updateIce(dt);
    _iceOrigRender(...args);
  };

  // ── Expose for external systems ────────────────────────────────────────────
  window._ICE        = _ICE;
  window._spawnIce   = _spawnIce;
  window._clearAllIce = _clearAllIce;

  // ═══════════════════════════════════════════════════════════════════════════
  //  ICE TUNER PANEL  (key = 'C')
  // ═══════════════════════════════════════════════════════════════════════════
  const panel = document.createElement('div');
  panel.id = 'ice-tuner';
  panel.style.cssText = 'display:none;position:fixed;top:0;right:270px;width:260px;height:100%;background:rgba(0,0,0,0.93);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;border-left:1px solid #6cf;';
  document.body.appendChild(panel);

  function mkS(label, val, min, max, step, fn, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:3px 0;display:flex;align-items:center;gap:4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:120px;color:' + (color || '#6cf') + ';font-size:10px;flex-shrink:0;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    inp.style.cssText = 'flex:1;height:14px;accent-color:' + (color || '#6cf') + ';';
    const vEl = document.createElement('span');
    vEl.style.cssText = 'width:38px;text-align:right;font-size:10px;color:#fff;';
    vEl.textContent = (+val).toFixed(2);
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); vEl.textContent = v.toFixed(2); fn(v); });
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(vEl);
    return row;
  }

  function mkH(text, color) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:10px 0 4px;font-size:11px;font-weight:bold;color:' + (color || '#6cf') + ';border-bottom:1px solid #336;padding-bottom:2px;';
    h.textContent = text;
    return h;
  }

  function mkT(label, getter, setter, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:8px;';
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:1px solid ' + (color || '#6cf') + ';color:' + (color || '#6cf') + ';padding:3px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;';
    const refresh = () => { btn.textContent = label + ': ' + (getter() ? 'ON' : 'OFF'); btn.style.opacity = getter() ? '1' : '0.5'; };
    btn.onclick = () => { setter(!getter()); refresh(); };
    refresh();
    row.appendChild(btn);
    return row;
  }

  function mkSel(label, options, getter, setter, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'color:' + (color || '#6cf') + ';font-size:10px;width:120px;flex-shrink:0;';
    lbl.textContent = label;
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;background:#111;color:#fff;border:1px solid #6cf;font-family:monospace;font-size:10px;padding:2px;';
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o === getter()) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => setter(sel.value);
    row.appendChild(lbl); row.appendChild(sel);
    return row;
  }

  function build() {
    panel.innerHTML = '<div style="font-size:13px;font-weight:bold;color:#6cf;margin-bottom:6px;">🧊 ICE TUNER (C)</div>';

    // MASTER
    panel.appendChild(mkH('MASTER', '#6cf'));
    panel.appendChild(mkT('ENABLED', () => _ICE.enabled, v => {
      _ICE.enabled = v;
      if (!v) _clearAllIce();
      else _iceTimer = 0.5;
    }, '#6cf'));

    // SPAWN
    panel.appendChild(mkH('SPAWN', '#8df'));
    panel.appendChild(mkS('frequency (s)', _ICE.frequency, 0.5, 20, 0.1, v => _ICE.frequency = v));
    panel.appendChild(mkSel('pattern', ['random', 'sweep', 'stagger', 'salvo'],
      () => _ICE.pattern, v => { _ICE.pattern = v; _iceSweepX = 0.5; _iceStaggerQ.length = 0; }));
    panel.appendChild(mkS('sweep speed', _ICE.sweepSpeed, 0.02, 1.5, 0.01, v => _ICE.sweepSpeed = v));
    panel.appendChild(mkS('stagger gap', _ICE.staggerGap, 0.2, 5.0, 0.1, v => _ICE.staggerGap = v));
    panel.appendChild(mkS('salvo count', _ICE.salvoCount, 1, 6, 1, v => _ICE.salvoCount = Math.round(v)));
    panel.appendChild(mkS('spawn Z', _ICE.spawnZ, -200, -30, 1, v => _ICE.spawnZ = v));
    panel.appendChild(mkS('lane min X', _ICE.laneMin, -20, 0, 0.5, v => _ICE.laneMin = v));
    panel.appendChild(mkS('lane max X', _ICE.laneMax, 0, 20, 0.5, v => _ICE.laneMax = v));

    // SIZE
    panel.appendChild(mkH('SIZE', '#aef'));
    panel.appendChild(mkS('size min', _ICE.sizeMin, 0.5, 8, 0.1, v => _ICE.sizeMin = v));
    panel.appendChild(mkS('size max', _ICE.sizeMax, 1.0, 14, 0.1, v => _ICE.sizeMax = v));
    panel.appendChild(mkS('height min', _ICE.heightMin, 1.0, 16, 0.1, v => _ICE.heightMin = v));
    panel.appendChild(mkS('height max', _ICE.heightMax, 2.0, 24, 0.1, v => _ICE.heightMax = v));
    panel.appendChild(mkS('hitbox scale', _ICE.hitboxScale, 0.1, 1.0, 0.01, v => _ICE.hitboxScale = v));

    // MATERIAL
    panel.appendChild(mkH('MATERIAL', '#9cf'));
    panel.appendChild(mkS('transmission', _ICE.transmission, 0, 1, 0.01, v => {
      _ICE.transmission = v;
      _icePool.forEach(inst => { inst.mats.forEach(m => { if (m.transmission !== undefined) { m.transmission = v; m.needsUpdate = true; } }); });
    }));
    panel.appendChild(mkS('roughness', _ICE.roughness, 0, 1, 0.01, v => {
      _ICE.roughness = v;
      _icePool.forEach(inst => { inst.mats.forEach(m => { m.roughness = v; }); });
    }));
    panel.appendChild(mkS('metalness', _ICE.metalness, 0, 1, 0.01, v => {
      _ICE.metalness = v;
      _icePool.forEach(inst => { inst.mats.forEach(m => { m.metalness = v; }); });
    }));
    panel.appendChild(mkS('emissive intensity', _ICE.emissiveIntensity, 0, 5, 0.05, v => {
      _ICE.emissiveIntensity = v;
      _icePool.forEach(inst => { inst.mats.forEach(m => { m.emissiveIntensity = v; }); });
    }));

    // STYLE
    panel.appendChild(mkH('STYLE', '#c8f'));
    panel.appendChild(mkSel('surface style', ['cracks','grid','both','clean'],
      () => _ICE.chunkStyle, v => { _ICE.chunkStyle = v; }));

    // Color pickers
    function mkColor(label, getter, setter) {
      const row = document.createElement('div');
      row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:8px;font-size:10px;color:#c8f;';
      const lbl = document.createElement('span'); lbl.style.width='120px'; lbl.textContent = label;
      const inp = document.createElement('input'); inp.type='color'; inp.value=getter();
      inp.style.cssText='width:36px;height:22px;border:none;background:none;cursor:pointer;';
      inp.oninput = () => setter(inp.value);
      row.appendChild(lbl); row.appendChild(inp);
      return row;
    }
    panel.appendChild(mkColor('base color',    () => _ICE.chunkBaseColor,    v => _ICE.chunkBaseColor = v));
    panel.appendChild(mkColor('crack color',   () => _ICE.chunkCrackColor,   v => _ICE.chunkCrackColor = v));
    panel.appendChild(mkColor('grid color',    () => _ICE.chunkGridColor,    v => _ICE.chunkGridColor = v));
    panel.appendChild(mkColor('emissive color',() => _ICE.chunkEmissiveColor,v => _ICE.chunkEmissiveColor = v));
    panel.appendChild(mkS('grid opacity', _ICE.chunkGridOpacity, 0, 1, 0.01, v => _ICE.chunkGridOpacity = v, '#c8f'));

    // REBUILD button — regenerates texture + pool
    const rebuildBtn = document.createElement('button');
    rebuildBtn.textContent = '⟳ REBUILD CHUNKS';
    rebuildBtn.style.cssText = 'background:#110022;border:1px solid #c8f;color:#c8f;padding:5px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:6px 0;width:100%;';
    rebuildBtn.onclick = () => {
      _clearAllIce();
      _rebuildIcePool();
      rebuildBtn.textContent = '✓ REBUILT';
      setTimeout(() => { rebuildBtn.textContent = '⟳ REBUILD CHUNKS'; }, 1200);
    };
    panel.appendChild(rebuildBtn);

    // ACTIONS
    panel.appendChild(mkH('ACTIONS', '#0f8'));
    const spawnBtn = document.createElement('button');
    spawnBtn.textContent = '▼ SPAWN ONE';
    spawnBtn.style.cssText = 'background:#062;border:1px solid #0f8;color:#0f8;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:3px 0;width:100%;';
    spawnBtn.onclick = () => {
      if (state.phase !== 'playing') state.phase = 'playing';
      _spawnIce((state && state.shipX) || 0);
    };
    panel.appendChild(spawnBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕ CLEAR ALL';
    clearBtn.style.cssText = 'background:#300;border:1px solid #f44;color:#f44;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:3px 0;width:100%;';
    clearBtn.onclick = () => _clearAllIce();
    panel.appendChild(clearBtn);

    // Active count
    const cEl = document.createElement('div');
    cEl.style.cssText = 'margin-top:6px;color:#888;font-size:10px;';
    const rc = () => { cEl.textContent = 'active: ' + _iceActive.length; };
    rc();
    setInterval(rc, 500);
    panel.appendChild(cEl);
  }

  let visible = false;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'c' || e.key === 'C') {
      visible = !visible;
      if (visible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });

})();

// ═══════════════════════════════════════════════════════════════════════════════
//  FAT CONE TUNER PANEL  (key = 'F')
//  Spawns massive cones (scale 12,1,12) — same pool as campaign cones.
//  Has loop mode identical to asteroid/lightning tuners.
// ═══════════════════════════════════════════════════════════════════════════════
(function setupFatConeTuner() {
  // ── Tuner state ─────────────────────────────────────────────────────────────
  const FCT = {
    enabled:   false,
    frequency: 1.0,    // seconds between spawns — matches campaign T5A_FATCONES cadence
    // shape
    scaleXZ:        4,     // standard campaign fat cone footprint
    scaleY:         1,     // height scalar
    glowBot:        0.255, // neon band bottom (UV space)
    glowTop:        0.345, // neon band top (UV space)
    neonColor:      0xff1a8c, // default: pink (matches type-0)
    obsidianColor:  0x12121a, // dark body color
    // placement
    laneMin:  -10,
    laneMax:   10,
    spreadAroundShip: 8,
    coneType: -1,       // -1 = random, 0/1/2 = specific mesh
  };

  let _fcLoopActive = false, _fcLoopTimer = null, _fcActiveBtn = null;

  function _spawnFatConeRow() {
    if (state.phase !== 'playing') return;
    // Port campaign fat cone spawner exactly:
    // Pick 2-3 lanes from the 21-lane grid, enforce 8-lane min gap, guarantee a 2-lane gap for player
    const count = 2 + Math.floor(Math.random() * 2); // 2 or 3 cones per row
    const shipX = (state && state.shipX) || 0;
    const lanes = Array.from({ length: LANE_COUNT }, (_, i) => i);
    const shuffled = [...lanes].sort(() => Math.random() - 0.5);
    const gapStart = Math.floor(Math.random() * (LANE_COUNT - 1));
    const gapLanes = new Set([gapStart, gapStart + 1]);
    const blocked = [];
    for (const lane of shuffled) {
      if (blocked.length >= count) break;
      if (gapLanes.has(lane)) continue;
      if (blocked.some(b => Math.abs(b - lane) < 8)) continue; // wide gap between fat cones
      blocked.push(lane);
    }
    blocked.forEach(lane => {
      const laneX = shipX + (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
      const type = FCT.coneType < 0 ? Math.floor(Math.random() * 3) : FCT.coneType;
      const obs = getPooledObstacle(type);
      if (!obs) return;
      obs.position.set(laneX, 0, SPAWN_Z);
      obs.scale.set(FCT.scaleXZ, FCT.scaleY, FCT.scaleXZ);
      obs.userData.velX         = 0;
      obs.userData.slalomScaled = true;
      obs.userData.isFatCone    = true;
      // Apply shape tuner overrides
      const _mc = obs.userData._meshes;
      for (let mi = 0; mi < _mc.length; mi++) {
        const mat = _mc[mi].material;
        if (mat.uniforms) {
          if (mat.uniforms.uGlowBot)  mat.uniforms.uGlowBot.value  = FCT.glowBot;
          if (mat.uniforms.uGlowTop)  mat.uniforms.uGlowTop.value  = FCT.glowTop;
          if (mat.uniforms.uNeon)     mat.uniforms.uNeon.value.setHex(FCT.neonColor);
          if (mat.uniforms.uObsidian) mat.uniforms.uObsidian.value.setHex(FCT.obsidianColor);
        }
      }
      activeObstacles.push(obs);
      _sessionLogEvent('fatCone_spawn', { x: laneX, scaleXZ: FCT.scaleXZ });
    });
  }

  // Keep _spawnFatCone as alias for single-cone manual spawn (F panel SPAWN ONE button)
  function _spawnFatCone() {
    if (state.phase !== 'playing') return;
    const type = FCT.coneType < 0 ? Math.floor(Math.random() * 3) : FCT.coneType;
    const obs = getPooledObstacle(type);
    if (!obs) return;
    const shipX = (state && state.shipX) || 0;
    const laneX = FCT.laneMin + Math.random() * (FCT.laneMax - FCT.laneMin);
    obs.position.set(laneX, 0, SPAWN_Z);
    obs.scale.set(FCT.scaleXZ, FCT.scaleY, FCT.scaleXZ);
    obs.userData.velX         = 0;
    obs.userData.slalomScaled = true;
    obs.userData.isFatCone    = true;
    const _mc = obs.userData._meshes;
    for (let mi = 0; mi < _mc.length; mi++) {
      const mat = _mc[mi].material;
      if (mat.uniforms) {
        if (mat.uniforms.uGlowBot)  mat.uniforms.uGlowBot.value  = FCT.glowBot;
        if (mat.uniforms.uGlowTop)  mat.uniforms.uGlowTop.value  = FCT.glowTop;
        if (mat.uniforms.uNeon)     mat.uniforms.uNeon.value.setHex(FCT.neonColor);
        if (mat.uniforms.uObsidian) mat.uniforms.uObsidian.value.setHex(FCT.obsidianColor);
      }
    }
    activeObstacles.push(obs);
    _sessionLogEvent('fatCone_spawn', { x: laneX, scaleXZ: FCT.scaleXZ });
  }

  function _startFcLoop(btn) {
    _stopFcLoop();
    _fcLoopActive = true;
    _fcActiveBtn = btn;
    if (btn) { btn.style.opacity = '1'; btn.style.background = '#1a1a00'; }
    function loop() {
      if (!_fcLoopActive) return;
      _spawnFatConeRow(); // use campaign row algo
      _fcLoopTimer = setTimeout(loop, FCT.frequency * 1000 * (0.7 + Math.random() * 0.6));
    }
    loop();
  }

  function _stopFcLoop() {
    _fcLoopActive = false;
    if (_fcLoopTimer) { clearTimeout(_fcLoopTimer); _fcLoopTimer = null; }
    if (_fcActiveBtn) { _fcActiveBtn.style.opacity = '0.7'; _fcActiveBtn.style.background = 'none'; _fcActiveBtn = null; }
  }

  // ── Panel ──────────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'fatcone-tuner';
  panel.style.cssText = 'display:none;position:fixed;top:0;right:0;width:270px;height:100%;background:rgba(0,0,0,0.93);overflow-y:auto;z-index:99999;font-family:monospace;font-size:11px;color:#ccc;padding:8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;border-left:1px solid #f80;';
  document.body.appendChild(panel);

  function mkSlider(label, val, min, max, step, onChange, color) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:4px;flex-wrap:wrap;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:110px;color:'+(color||'#f80')+';font-size:10px;flex-shrink:0;';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=val;
    inp.style.cssText = 'flex:1;height:14px;accent-color:'+(color||'#f80')+';';
    const valEl = document.createElement('span');
    valEl.style.cssText = 'width:36px;text-align:right;font-size:10px;color:#fff;';
    valEl.textContent = (+val).toFixed(2);
    inp.oninput = () => {
      const v = +inp.value;
      onChange(v);
      valEl.textContent = v.toFixed(2);
      _sessionLogSlider('fatcone_' + label, v);
    };
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(valEl);
    return row;
  }

  function mkH(text, color) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:10px 0 4px;font-size:11px;font-weight:bold;color:'+(color||'#f80')+';border-bottom:1px solid #333;padding-bottom:2px;';
    h.textContent = text;
    return h;
  }

  function mkBtn(label, color, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `background:none;border:1px solid ${color};color:${color};padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:2px 0;width:100%;text-align:left;opacity:0.7;transition:opacity 0.1s;`;
    b.onclick = onClick;
    return b;
  }

  function build() {
    panel.innerHTML = '<div style="font-size:13px;font-weight:bold;color:#f80;margin-bottom:6px;">🔺 FAT CONE TUNER (F)</div>';

    panel.appendChild(mkH('SHAPE', '#f80'));
    panel.appendChild(mkSlider('scale XZ', FCT.scaleXZ, 0.5, 20, 0.25, v => FCT.scaleXZ = v, '#f80'));
    panel.appendChild(mkSlider('scale Y', FCT.scaleY, 0.1, 5, 0.1, v => FCT.scaleY = v, '#f80'));
    panel.appendChild(mkSlider('glow bot', FCT.glowBot, 0, 1, 0.005, v => FCT.glowBot = v, '#f0a'));
    panel.appendChild(mkSlider('glow top', FCT.glowTop, 0, 1, 0.005, v => FCT.glowTop = v, '#f0a'));

    // Neon color picker
    (() => {
      const row = document.createElement('div');
      row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;';
      const lbl = document.createElement('span'); lbl.style.cssText = 'width:110px;color:#f0a;font-size:10px;flex-shrink:0;'; lbl.textContent = 'neon color';
      const inp = document.createElement('input'); inp.type='color'; inp.value='#'+FCT.neonColor.toString(16).padStart(6,'0');
      inp.style.cssText = 'flex:1;height:22px;border:none;background:none;cursor:pointer;';
      inp.oninput = () => { FCT.neonColor = parseInt(inp.value.slice(1),16); };
      row.appendChild(lbl); row.appendChild(inp); panel.appendChild(row);
    })();

    // Obsidian color picker
    (() => {
      const row = document.createElement('div');
      row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;';
      const lbl = document.createElement('span'); lbl.style.cssText = 'width:110px;color:#aaa;font-size:10px;flex-shrink:0;'; lbl.textContent = 'body color';
      const inp = document.createElement('input'); inp.type='color'; inp.value='#'+FCT.obsidianColor.toString(16).padStart(6,'0');
      inp.style.cssText = 'flex:1;height:22px;border:none;background:none;cursor:pointer;';
      inp.oninput = () => { FCT.obsidianColor = parseInt(inp.value.slice(1),16); };
      row.appendChild(lbl); row.appendChild(inp); panel.appendChild(row);
    })();

    panel.appendChild(mkH('SPAWN', '#f80'));


    panel.appendChild(mkSlider('lane min', FCT.laneMin, -25, 0, 0.5, v => FCT.laneMin = v, '#8df'));
    panel.appendChild(mkSlider('lane max', FCT.laneMax, 0, 25, 0.5, v => FCT.laneMax = v, '#8df'));

    const coneTypeSel = document.createElement('div');
    coneTypeSel.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const ctLbl = document.createElement('span');
    ctLbl.style.cssText = 'color:#f80;font-size:10px;width:110px;flex-shrink:0;';
    ctLbl.textContent = 'cone type';
    const ctSel = document.createElement('select');
    ctSel.style.cssText = 'flex:1;background:#111;color:#fff;border:1px solid #f80;font-family:monospace;font-size:10px;padding:2px;';
    [['random', -1],['type 0',0],['type 1',1],['type 2',2]].forEach(([lbl, val]) => {
      const o = document.createElement('option'); o.value=val; o.textContent=lbl;
      if (val === FCT.coneType) o.selected = true;
      ctSel.appendChild(o);
    });
    ctSel.onchange = () => { FCT.coneType = +ctSel.value; };
    coneTypeSel.appendChild(ctLbl); coneTypeSel.appendChild(ctSel);
    panel.appendChild(coneTypeSel);

    // Manual spawn
    const spawnBtn = mkBtn('▼ SPAWN ONE', '#f80', _spawnFatCone);
    spawnBtn.style.opacity = '1';
    spawnBtn.style.marginTop = '6px';
    panel.appendChild(spawnBtn);

    panel.appendChild(mkH('LOOP', '#fa0'));
    panel.appendChild(mkSlider('frequency (s)', FCT.frequency, 0.3, 20, 0.1, v => FCT.frequency = v, '#fa0'));

    const loopBtn = mkBtn('▶ START LOOP', '#fa0', () => _startFcLoop(loopBtn));
    panel.appendChild(loopBtn);

    const stopBtn = document.createElement('button');
    stopBtn.textContent = '⏹ STOP LOOP';
    stopBtn.style.cssText = 'background:#222;border:1px solid #888;color:#aaa;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:10px;border-radius:2px;margin:4px 0 2px;width:100%;';
    stopBtn.onclick = _stopFcLoop;
    panel.appendChild(stopBtn);

    const clearBtn = mkBtn('✕ CLEAR ALL CONES', '#f44', () => {
      _stopFcLoop();
      for (let i = activeObstacles.length - 1; i >= 0; i--) {
        if (activeObstacles[i].userData.isFatCone) {
          const o = activeObstacles.splice(i, 1)[0];
          scene.remove(o);
        }
      }
    });
    panel.appendChild(clearBtn);

    const countEl = document.createElement('div');
    countEl.style.cssText = 'margin-top:6px;color:#888;font-size:10px;';
    const refreshCount = () => {
      const n = activeObstacles.filter(o => o.userData.isFatCone).length;
      countEl.textContent = 'fat cones active: ' + n;
    };
    refreshCount();
    setInterval(refreshCount, 500);
    panel.appendChild(countEl);
  }

  // Expose to sequencer tick (outside IIFE scope)
  window._spawnFatCone    = _spawnFatCone;
  window._spawnFatConeRow = _spawnFatConeRow;
  window._startFcLoop     = _startFcLoop;
  window._stopFcLoop      = _stopFcLoop;
  window._FCT = FCT;

  let _fcVisible = false;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'f' || e.key === 'F') {
      _fcVisible = !_fcVisible;
      if (_fcVisible) { build(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    }
  });
})();

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
