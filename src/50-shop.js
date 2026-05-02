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
    _tapBind(tab, () => switchShopTab(tab.dataset.tab));
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
      _tapBind(card, () => {
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
      ${isPowerup ? `<span class="shop-detail-tier-cost">${i === 0 ? 'FREE' : '<img src="assets/images/single-coin-icon.png" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;"> ' + UPGRADE_COSTS[i]}</span>` :
        `<span class="shop-detail-tier-cost">${'<img src="assets/images/single-coin-icon.png" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;"> ' + up.costs[i]}</span>`}
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
        UPGRADE <img src="assets/images/single-coin-icon.png" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;"> ${cost}
      </button>`}
  `;

  if (!maxed) {
    const buyBtn = document.getElementById('shop-buy-btn');
    if (buyBtn) {
      _tapBind(buyBtn, () => {
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
      const _shActSfx = document.getElementById('shield-activate-sfx'); if (_shActSfx) { _shActSfx.currentTime = 0; _shActSfx.volume = 0.18; _shActSfx.play().catch(()=>{}); }
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
        // Laser MG SFX: per-tick buffer fire happens in the bolt-spawn loop
        // (67-main-late.js). No looped element here — the rate of fire IS the
        // machine-gun feel. See state.laserFireRate.

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
      // Force-field loop: starts at 0 during speed phase
      const _invSfx = document.getElementById('invincible-loop-sfx');
      if (_invSfx && !state.muted) {
        try { _invSfx.currentTime = 0; _invSfx.loop = true; _invSfx.volume = 0.45; _invSfx.play().catch(()=>{}); } catch(_) {}
      }
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
