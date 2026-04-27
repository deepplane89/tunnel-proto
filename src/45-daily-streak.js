// ═══════════════════════════════════════════════════════
//  DAILY STREAK REWARDS
// ═══════════════════════════════════════════════════════
// SVG icons for streak rewards — clean, game-quality
const STREAK_SVG_COIN = '<img src="assets/images/multi-coins-icon.png" style="width:22px;height:22px;object-fit:contain;">';
const STREAK_SVG_FUEL = '<img src="assets/images/fuelcell-icon-new.png" style="width:22px;height:22px;object-fit:contain;">';
const STREAK_SVG_ROCKET = '<img src="assets/images/rocket-icon.png" style="width:22px;height:22px;object-fit:contain;">';

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
      _tapBind(el, () => claimStreakReward(el, ss.day));
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
_tapBind(document.getElementById('streak-close-btn'), closeStreak);
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
