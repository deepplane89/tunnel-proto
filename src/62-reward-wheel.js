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
