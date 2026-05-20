// ═══════════════════════════════════════════════════
//  TESTER FEEDBACK — Game-over modal → jhTrack pipe
// ═══════════════════════════════════════════════════
// Surfaces a tiny "Send feedback" link under the TRY AGAIN / EXIT row on
// the game-over screen. Opens a self-contained modal (#feedback-overlay)
// that submits a `feedback` event through the existing analytics pipe
// (window.jhTrack → /api/analytics). Diagnostic context is attached
// automatically so testers don't have to remember build/stage/score.
//
// Layout safety: the link lives INSIDE .go-actions with flex-basis:100%
// so it wraps to its own line in both portrait (row flex) and landscape
// (column flex) without disturbing the existing two-button layout.

(function () {
  'use strict';

  let _selectedTag = 'bug';

  function _collectContext() {
    const ctx = {};
    try {
      // Build version (set at the top of 82-main-late-tail.js, lives in
      // shared scope thanks to the unity-build concat).
      if (typeof BUILD_VERSION !== 'undefined') ctx.build = BUILD_VERSION;
    } catch (_) {}
    try {
      if (typeof state !== 'undefined' && state) {
        ctx.phase           = state.phase || 'unknown';
        ctx.score           = state.score || 0;
        ctx.distance        = Math.round(state.distance || 0);
        ctx.elapsed         = +(state.elapsed || 0).toFixed(2);
        ctx.seqStageIdx     = state.seqStageIdx || 0;
        ctx.drTier          = state.deathRunSpeedTier || 0;
        ctx.endlessActive   = !!state._endlessActive;
        ctx.endlessTier     = state._endlessTier || 0;
        ctx.endlessType     = state._endlessType || null;
        ctx.laserActive     = !!state.laserActive;
        ctx.laserTier       = state.laserTier || 0;
        ctx.laserTimer      = +(state.laserTimer || 0).toFixed(2);
        ctx.magnetActive    = !!state.magnetActive;
        ctx.shieldActive    = !!state.shieldActive;
        ctx.invincibleTimer = +(state.invincibleTimer || 0).toFixed(2);
        ctx.multiplier      = state.multiplier || 1;
        ctx.shipSkin        = (typeof activeSkinIdx !== 'undefined') ? activeSkinIdx : null;
      }
    } catch (_) {}
    try {
      // Current sequence stage name — useful for "what level was I in".
      if (typeof DR_SEQUENCE !== 'undefined' && typeof state !== 'undefined' &&
          DR_SEQUENCE[state.seqStageIdx]) {
        ctx.seqStageName = DR_SEQUENCE[state.seqStageIdx].name;
      }
    } catch (_) {}
    try {
      if (typeof window._lastHitchMs === 'number') ctx.lastHitchMs = Math.round(window._lastHitchMs);
    } catch (_) {}
    try {
      ctx.dpr = window.devicePixelRatio || 1;
      ctx.w = window.innerWidth;
      ctx.h = window.innerHeight;
    } catch (_) {}
    try {
      // Radio: what was playing (if anything).
      if (typeof isRadioOn === 'function' && isRadioOn()) {
        const _t = document.getElementById('pp-title');
        ctx.radioTrack = _t ? (_t.textContent || '').slice(0, 60) : '';
      }
    } catch (_) {}
    return ctx;
  }

  function _showToast(msg) {
    let toast = document.getElementById('feedback-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'feedback-toast';
      toast.style.cssText =
        'position:fixed;top:24px;left:50%;transform:translateX(-50%);' +
        'background:rgba(0,240,255,0.18);border:1px solid rgba(0,240,255,0.5);' +
        'color:rgba(0,240,255,0.95);padding:10px 18px;border-radius:8px;' +
        'font-family:inherit;font-size:12px;letter-spacing:0.18em;' +
        'text-transform:uppercase;z-index:200;pointer-events:none;' +
        'opacity:0;transition:opacity 200ms ease;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    // Force reflow so the opacity transition runs from 0.
    void toast.offsetWidth;
    toast.style.opacity = '1';
    clearTimeout(toast._jhTimer);
    toast._jhTimer = setTimeout(() => {
      toast.style.opacity = '0';
    }, 1800);
  }

  function _openFeedback() {
    const ov = document.getElementById('feedback-overlay');
    if (!ov) return;
    // Reset state
    _selectedTag = 'bug';
    const chips = document.querySelectorAll('#feedback-chips .feedback-chip');
    chips.forEach(c => c.classList.toggle('active', c.dataset.tag === 'bug'));
    const ta = document.getElementById('feedback-text');
    if (ta) { ta.value = ''; }
    ov.classList.remove('hidden');
    // Autofocus textarea on next frame — required for iOS to actually open the keyboard.
    setTimeout(() => { if (ta) try { ta.focus(); } catch(_) {} }, 60);
  }

  function _closeFeedback() {
    const ov = document.getElementById('feedback-overlay');
    if (ov) ov.classList.add('hidden');
  }

  function _send() {
    const ta = document.getElementById('feedback-text');
    const text = (ta && ta.value || '').trim();
    if (!text) {
      _showToast('Type something first');
      return;
    }
    const payload = {
      tag: _selectedTag,
      text: text.slice(0, 800),
      ctx: _collectContext(),
    };
    try {
      if (typeof window.jhTrack === 'function') {
        window.jhTrack('feedback', payload);
      }
    } catch (_) {}
    _closeFeedback();
    _showToast('Thanks — sent');
  }

  // ── Wire up after DOM is ready ────────────────────────────────────
  function _init() {
    const openBtn = document.getElementById('gameover-feedback-btn');
    if (openBtn) {
      openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _openFeedback();
      });
    }
    const cancelBtn = document.getElementById('feedback-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', _closeFeedback);
    const sendBtn = document.getElementById('feedback-send');
    if (sendBtn) sendBtn.addEventListener('click', _send);

    // Tag-chip selection
    const chips = document.querySelectorAll('#feedback-chips .feedback-chip');
    chips.forEach(c => {
      c.addEventListener('click', () => {
        _selectedTag = c.dataset.tag || 'other';
        chips.forEach(x => x.classList.toggle('active', x === c));
      });
    });

    // Backdrop click closes
    const ov = document.getElementById('feedback-overlay');
    if (ov) {
      ov.addEventListener('click', (e) => {
        if (e.target.id === 'feedback-overlay') _closeFeedback();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
