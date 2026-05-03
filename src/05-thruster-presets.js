// ── THRUSTER PRESETS (data-only) ─────────────────────────────────────────
// All preset value-blocks live here. The apply/snapshot/restore engine and
// the toggle buttons live in 72-main-late-mid.js; this file is pure data.
//
// To add a new preset: paste a new key into THRUSTER_PRESETS with the same
// shape as 'short' or 'fatIon'. Then add a button entry in 72-main-late-mid.js
// at the THRUSTER_PRESET_BUTTONS array. That's it.
//
// Shape:
//   - All keys starting with '_' map directly to window globals (e.g. _thrusterScale → window._thrusterScale)
//   - _pointMatSize / _miniPointMatSize are written to thrusterSystems[*].points.material.size
//   - nozL/nozR/miniL/miniR (optional) are 3-element [x,y,z] arrays for nozzle world offsets
//
// 'baseline' is captured at runtime from the live game-default values on first
// panel build (see 72-main-late-mid.js). Keep it as `null` here.

window._THRUSTER_PRESETS = {
  // Captured at runtime — first panel build snapshots the live defaults.
  baseline: null,

  // ── SHORT THRUSTER PRESET (MK Runner) ──
  // Captured 2026-05-01 from user's tuned MK Runner session.
  short: {
    label: 'short thruster preset',
    // Nozzle positions (asymmetric per user tuning) — only this preset bakes them
    nozL: [-0.48, 0.05, 5.16], nozR: [0.50, -0.01, 5.10],
    miniL: [-0.15, 0.06, 5.10], miniR: [0.16, 0.06, 5.10],
    // Global
    _thrPart_partOpacity: 0.44, _thrPart_miniPartOpacity: 0.44, _thrPart_posPinFrac: 0.12,
    _thrusterScale: 1.00, _pointMatSize: 0.13, _miniPointMatSize: 0.08,
    _nozzleBloomScale: 0.45, _nozzleBloomOpacity: 0.24, _nozzleBloom_whiteMix: 0.00,
    _miniBloomScale: 1.00, _miniBloomOpacity: 0.15, _miniBloomOpacitySpd: 0.15, _miniBloom_whiteMix: 0.00,
    // Particles
    _thrPart_bendInherit: 0.15, _thrPart_bendCatchup: 0.00,
    _thrPart_midEnd: 0.65, _thrPart_midBoost: 0.30,
    _thrPart_sizeBase: 0.19, _thrPart_sizeSpeed: 0.13,
    _thrPart_bumpMult: 1.60, _thrPart_bumpEnd: 0.10, _thrPart_sizeJitter: 0.06,
    _thrPart_lifeMin: 0.18, _thrPart_lifeJit: 0.22,
    _thrPart_lifeBase: 0.20, _thrPart_lifeSpd: 0.00, _thrPart_spawnJit: 0.10,
    // Flame mesh
    _thrFlame_coreEnd: 0.10, _thrFlame_coreRGB: 0.85, _thrFlame_midEnd: 0.60,
    _thrFlame_sizeBase: 0.04, _thrFlame_sizeSpeed: 0.01,
    _thrFlame_bumpMult: 1.40, _thrFlame_bumpEnd: 0.07,
    _thrFlame_lifeMin: 0.05, _thrFlame_lifeJit: 0.06, _thrFlame_spawnJit: 0.02,
  },

  // ── LIGHT PRESET ──
  // Captured 2026-05-02. Subtle, low-bloom, soft particles.
  light: {
    label: 'LIGHT',
    // Global
    _thrPart_partOpacity: 0.48, _thrPart_miniPartOpacity: 0.48, _thrPart_posPinFrac: 0.14,
    _thrusterScale: 0.80, _pointMatSize: 0.06, _miniPointMatSize: 0.09,
    _nozzleBloomScale: 0.10, _nozzleBloomOpacity: 0.43, _nozzleBloom_whiteMix: 0.00,
    _nozzleBloomPulse: 0.15,
    _miniBloomScale: 1.00, _miniBloomOpacity: 0.15, _miniBloomOpacitySpd: 0.15, _miniBloom_whiteMix: 0.00,
    // Particles
    _thrPart_bendInherit: 0.15, _thrPart_bendCatchup: 0.00,
    _thrPart_midEnd: 0.10, _thrPart_midBoost: 0.00,
    _thrPart_sizeBase: 0.05, _thrPart_sizeSpeed: 0.00,
    _thrPart_bumpMult: 1.00, _thrPart_bumpEnd: 0.00, _thrPart_sizeJitter: 0.00,
    _thrPart_lifeMin: 0.05, _thrPart_lifeJit: 0.05,
    _thrPart_lifeBase: 0.20, _thrPart_lifeSpd: 0.00, _thrPart_spawnJit: 0.07,
    // Flame mesh
    _thrFlame_coreEnd: 0.00, _thrFlame_coreRGB: 0.00, _thrFlame_midEnd: 0.10,
    _thrFlame_sizeBase: 0.01, _thrFlame_sizeSpeed: 0.00,
    _thrFlame_bumpMult: 1.00, _thrFlame_bumpEnd: 0.00,
    _thrFlame_lifeMin: 0.01, _thrFlame_lifeJit: 0.00, _thrFlame_spawnJit: 0.08,
  },

  // ── FAT ION PRESET ──
  // Captured 2026-05-02 from user screenshots. Globals + particles + flame mesh only.
  // Does NOT touch nozzle positions.
  fatIon: {
    label: 'FAT ION',
    // Global
    _thrPart_partOpacity: 0.48, _thrPart_miniPartOpacity: 0.52, _thrPart_posPinFrac: 0.14,
    _thrusterScale: 0.70, _pointMatSize: 0.12, _miniPointMatSize: 0.06,
    _nozzleBloomScale: 2.45, _nozzleBloomOpacity: 0.94, _nozzleBloom_whiteMix: 0.00,
    _nozzleBloomPulse: 0.15,
    _miniBloomScale: 1.00, _miniBloomOpacity: 0.15, _miniBloomOpacitySpd: 0.15, _miniBloom_whiteMix: 0.00,
    // Particles
    _thrPart_bendInherit: 0.15, _thrPart_bendCatchup: 0.00,
    _thrPart_midEnd: 0.10, _thrPart_midBoost: 1.02,
    _thrPart_sizeBase: 0.05, _thrPart_sizeSpeed: 0.00,
    _thrPart_bumpMult: 1.00, _thrPart_bumpEnd: 0.00, _thrPart_sizeJitter: 0.00,
    _thrPart_lifeMin: 0.05, _thrPart_lifeJit: 0.08,
    _thrPart_lifeBase: 1.30, _thrPart_lifeSpd: 0.00, _thrPart_spawnJit: 0.09,
    // Flame mesh
    _thrFlame_coreEnd: 0.00, _thrFlame_coreRGB: 0.37, _thrFlame_midEnd: 0.35,
    _thrFlame_sizeBase: 0.06, _thrFlame_sizeSpeed: 0.10,
    _thrFlame_bumpMult: 3.00, _thrFlame_bumpEnd: 0.30,
    _thrFlame_lifeMin: 0.01, _thrFlame_lifeJit: 0.00, _thrFlame_spawnJit: 0.07,
  },
};

// Which preset is currently active (one at a time, mutually exclusive).
// null = none (sliders show whatever the user last set).
window._activeThrusterPreset = null;

// ── THRUSTER COLOR PALETTE ───────────────────────────────────────────────────
// Cosmetic-only color overrides that apply on top of the active preset.
// 'default' (null hex) means "don't override — keep whatever color the run
// started with". Every other entry is a fixed hex applied at run start and
// LOCKED for the entire run (tier transitions are gated by
// window._thrusterColorLocked).
//
// Add new colors by appending an entry here. The title panel auto-renders
// every key in this map. Order matters — keep 'default' first.
window._THRUSTER_COLOR_PALETTE = {
  default: { label: 'DEFAULT',   hex: null,     swatch: '#888888' },
  blue:    { label: 'ION BLUE',  hex: 0x44aaff, swatch: '#44aaff' },
  cyan:    { label: 'CYAN',      hex: 0x33eeff, swatch: '#33eeff' },
  violet:  { label: 'VIOLET',    hex: 0xee00ff, swatch: '#ee00ff' },
  red:     { label: 'CRIMSON',   hex: 0xff3300, swatch: '#ff3300' },
  orange:  { label: 'EMBER',     hex: 0xff9a00, swatch: '#ff9a00' },
  green:   { label: 'TOXIC',     hex: 0x44ff88, swatch: '#44ff88' },
  pink:    { label: 'NEON PINK', hex: 0xff66bb, swatch: '#ff66bb' },
  gold:    { label: 'SOLAR GOLD',hex: 0xffcc33, swatch: '#ffcc33' },
  white:   { label: 'WHITE HOT', hex: 0xffffff, swatch: '#ffffff' },
};
