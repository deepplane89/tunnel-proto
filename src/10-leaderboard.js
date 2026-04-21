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
