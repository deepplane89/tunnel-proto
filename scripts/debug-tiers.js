#!/usr/bin/env node
// Static audit of the gameplay tier system.
// - DR_SEQUENCE.physTier monotonic non-decreasing
// - DR_SEQUENCE.speed never drops mid-run
// - LEVELS.speedMult monotonic non-decreasing
// - Cross-check: speed multiplier coverage vs LEVELS table
// - List every _setDRSpeed call site + trigger
// - Mission tier thresholds vs DR_SEQUENCE physTier reachability

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

const early = read('20-main-early.js');
const late67 = read('67-main-late.js');
const late40 = read('40-main-late.js');
const late60 = read('60-main-late.js');

function section(t) { console.log('\n\u2500'.repeat(2) + ' ' + t + ' ' + '\u2500'.repeat(Math.max(0, 70 - t.length))); }

// ── 1. LEVELS table ───────────────────────────────────────────
section('LEVELS table');
const levelsMatch = early.match(/const LEVELS = \[([\s\S]*?)\n\];/);
const levelEntries = [];
if (levelsMatch) {
  const body = levelsMatch[1];
  const re = /id:\s*(\d+),\s*name:\s*'([^']+)',\s*scoreThreshold:\s*(\d+),[\s\S]*?speedMult:\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    levelEntries.push({ id: +m[1], name: m[2], scoreThreshold: +m[3], speedMult: +m[4] });
  }
}
console.table(levelEntries);

// LEVELS monotonic check
let levelsOK = true;
for (let i = 1; i < levelEntries.length; i++) {
  if (levelEntries[i].speedMult < levelEntries[i-1].speedMult) {
    console.log(`  FAIL: LEVELS[${i}] speedMult ${levelEntries[i].speedMult} < LEVELS[${i-1}] ${levelEntries[i-1].speedMult}`);
    levelsOK = false;
  }
  if (levelEntries[i].scoreThreshold <= levelEntries[i-1].scoreThreshold) {
    console.log(`  FAIL: LEVELS[${i}] scoreThreshold ${levelEntries[i].scoreThreshold} <= LEVELS[${i-1}]`);
    levelsOK = false;
  }
}
console.log(levelsOK ? '  OK: LEVELS monotonic on speedMult + scoreThreshold' : '  ISSUES above');

// ── 2. DR_SEQUENCE table ──────────────────────────────────────
section('DR_SEQUENCE stages');
const seqMatch = late67.match(/const DR_SEQUENCE = \[([\s\S]*?)\n\];/);
const seq = [];
if (seqMatch) {
  const body = seqMatch[1];
  // Walk lines starting with `{ name: '...'` and parse each one independently
  const lines = body.split('\n');
  for (const line of lines) {
    const nameM = line.match(/\{\s*name:\s*'([^']+)'/);
    if (!nameM) continue;
    const typeM = line.match(/type:\s*'([^']+)'/);
    const spdM  = line.match(/speed:\s*([\d.]+)/);
    const phM   = line.match(/physTier:\s*(\d+)/);
    seq.push({
      name: nameM[1],
      type: typeM ? typeM[1] : '?',
      speed: spdM ? +spdM[1] : NaN,
      physTier: phM ? +phM[1] : null,
    });
  }
}
console.table(seq);

// ── 3. DR_SEQUENCE invariants ────────────────────────────────
section('DR_SEQUENCE invariants');
let physMonotonic = true;
let speedMonotonic = true;
let physOK = true;
let lastPhys = -1, lastSpd = -1;
for (let i = 0; i < seq.length; i++) {
  const s = seq[i];
  if (s.physTier !== null) {
    if (s.physTier < 1) { console.log(`  FAIL: ${s.name} physTier=${s.physTier} (floor is 1, never 0)`); physOK = false; }
    if (s.physTier < lastPhys) { console.log(`  FAIL: ${s.name} physTier=${s.physTier} dropped from ${lastPhys}`); physMonotonic = false; }
    lastPhys = Math.max(lastPhys, s.physTier);
  }
  if (s.speed < lastSpd - 0.001) { console.log(`  FAIL: ${s.name} speed=${s.speed}x dropped from ${lastSpd}x`); speedMonotonic = false; }
  lastSpd = Math.max(lastSpd, s.speed);
}
console.log(physMonotonic ? '  OK: physTier monotonic non-decreasing' : '  ISSUES above');
console.log(physOK ? '  OK: physTier never below 1' : '  ISSUES above');
console.log(speedMonotonic ? '  OK: stage speed monotonic non-decreasing' : '  ISSUES above');

// ── 4. Tier reachability for missions ────────────────────────
section('Mission reach checks (drtier2..drtier5)');
const reachable = {};
for (const t of [1, 2, 3, 4, 5]) {
  const stages = seq.filter(s => s.physTier !== null && s.physTier >= t);
  reachable[t] = stages[0] ? stages[0].name : null;
}
for (const t of [1, 2, 3, 4, 5]) {
  console.log(`  drtier${t}: ${reachable[t] ? `first reached at ${reachable[t]}` : 'NEVER REACHED (mission impossible)'}`);
}

// ── 5. _setDRSpeed call sites by trigger ─────────────────────
section('_setDRSpeed call sites');
const all = [
  ['20-main-early.js', early],
  ['40-main-late.js', late40],
  ['60-main-late.js', late60],
  ['67-main-late.js', late67],
];
const triggerCounts = {};
const callSites = [];
for (const [fname, src] of all) {
  const re = /_setDRSpeed\([^)]*?'([A-Z_]+)'\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    triggerCounts[m[1]] = (triggerCounts[m[1]] || 0) + 1;
    const lineNo = src.slice(0, m.index).split('\n').length;
    callSites.push({ file: fname, line: lineNo, trigger: m[1] });
  }
}
console.log('  Trigger usage counts:');
for (const t of Object.keys(triggerCounts).sort()) console.log(`    ${t}: ${triggerCounts[t]}`);

// Triggers defined but unused:
const definedMatch = early.match(/const DR_SPEED_TRIGGERS = Object\.freeze\(\{([\s\S]*?)\}\);/);
const defined = [];
if (definedMatch) {
  const re = /^\s*([A-Z_]+):\s*'/gm;
  let m;
  while ((m = re.exec(definedMatch[1])) !== null) defined.push(m[1]);
}
const unused = defined.filter(t => !triggerCounts[t]);
if (unused.length) console.log('  Defined but UNUSED triggers: ' + unused.join(', '));
else console.log('  All defined triggers are referenced');

// ── 6. Stage-speed → LEVELS bucket coverage ─────────────────
section('Stage speed multiplier vs LEVELS coverage');
const speedMults = [...new Set(seq.map(s => s.speed))].sort((a, b) => a - b);
console.log(`  Distinct stage speed multipliers used: ${speedMults.join(', ')}`);
console.log(`  LEVELS speedMult buckets:              ${levelEntries.map(l => l.speedMult).join(', ')}`);
const tierForSpd = (sp) => {
  // _physIdx logic: pick highest LEVELS index with speedMult <= sp
  let idx = 0;
  for (let i = 0; i < levelEntries.length; i++) {
    if (levelEntries[i].speedMult <= sp + 1e-6) idx = i;
  }
  return idx;
};
for (const sp of speedMults) {
  const idx = tierForSpd(sp);
  console.log(`    ${sp}x  →  LEVELS[${idx}] (${levelEntries[idx].name}, mult=${levelEntries[idx].speedMult})`);
}

// ── 7. State init values ────────────────────────────────────
section('State initialization');
const stateMatch = early.match(/deathRunSpeedTier:\s*(\d+)/);
console.log(`  state.deathRunSpeedTier initial = ${stateMatch ? stateMatch[1] : '?'}`);
console.log(`  BASE_SPEED                      = ${(early.match(/const BASE_SPEED\s*=\s*(\d+)/) || [])[1]}`);
console.log(`  state.speed initial             = BASE_SPEED (${(early.match(/speed:\s*BASE_SPEED/) ? 'OK' : 'NOT BASE_SPEED')})`);

// ── 8. Summary ──────────────────────────────────────────────
section('Summary');
const failures = [];
if (!levelsOK) failures.push('LEVELS table');
if (!physMonotonic || !physOK) failures.push('physTier ladder');
if (!speedMonotonic) failures.push('stage speed monotonicity');
if (unused.length) failures.push('unused triggers (cleanup)');
if (failures.length === 0) console.log('  ALL CHECKS PASS');
else console.log('  ISSUES: ' + failures.join('; '));
