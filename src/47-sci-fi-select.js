// ─────────────────────────────────────────────────────────────────────────
// SCI-FI SELECT — custom dropdown that wraps a native <select>
//
// Why: native <select> on iOS opens a giant white system modal that does not
// match the showroom's neon/cyan aesthetic. This module renders a styled
// button + popup menu over the original <select>, mirroring its options.
// All reads/writes go through the underlying select.value, so existing
// change handlers (in 48-showroom.js) keep working with zero rewiring.
//
// Public:
//   window.SciFiSelect.enhance(selectEl)  — idempotent; safe to call repeatedly
//   window.SciFiSelect.refresh(selectEl)  — call after changing the <select>'s
//                                            options to rebuild the menu items
//
// Markup produced (inserted as next sibling of the <select>):
//   <div class="sf-select" data-for="<select id>">
//     <button class="sf-select-btn">
//       <span class="sf-select-label">CURRENT VALUE</span>
//       <span class="sf-select-chev">▾</span>
//     </button>
//     <ul class="sf-select-menu" hidden>
//       <li class="sf-select-item ..." data-value="...">LABEL</li>
//       ...
//     </ul>
//   </div>
//
// The native <select> is hidden via CSS (.sr-select-wrap > select { display:none })
// but kept in the DOM so its value/options remain the source of truth.
// ─────────────────────────────────────────────────────────────────────────

(function _installSciFiSelect() {
  'use strict';

  let _openMenu = null; // currently open menu element, or null

  function _clearMenuPos(wrap) {
    if (!wrap) return;
    const m = wrap.querySelector('.sf-select-menu');
    if (!m) return;
    m.hidden = true;
    m.style.position = '';
    m.style.left = '';
    m.style.top = '';
    m.style.bottom = '';
    m.style.width = '';
    m.style.maxHeight = '';
    const b = wrap.querySelector('.sf-select-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function _closeAnyOpen(except) {
    if (_openMenu && _openMenu !== except) {
      _openMenu.classList.remove('sf-open');
      _clearMenuPos(_openMenu);
      _openMenu = null;
    }
  }

  // Close on outside tap or Escape.
  document.addEventListener('pointerdown', function(e) {
    if (!_openMenu) return;
    if (_openMenu.contains(e.target)) return;
    _closeAnyOpen(null);
  }, true);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') _closeAnyOpen(null);
  });

  function _buildMenuItems(wrap, sel) {
    const menu = wrap.querySelector('.sf-select-menu');
    if (!menu) return;
    menu.innerHTML = '';
    const opts = Array.from(sel.options || []);
    opts.forEach(opt => {
      const li = document.createElement('li');
      li.className = 'sf-select-item';
      if (opt.disabled) li.classList.add('sf-select-disabled');
      if (opt.value === sel.value) li.classList.add('sf-select-active');
      li.dataset.value = opt.value;
      li.textContent = opt.textContent;
      li.setAttribute('role', 'option');
      menu.appendChild(li);
    });
  }

  function _syncLabel(wrap, sel) {
    const labelEl = wrap.querySelector('.sf-select-label');
    if (!labelEl) return;
    const opt = sel.options[sel.selectedIndex];
    labelEl.textContent = opt ? opt.textContent : '';
  }

  function enhance(sel) {
    if (!sel || !(sel instanceof HTMLSelectElement)) return;
    if (sel.dataset.sfEnhanced === '1') {
      // Already enhanced — refresh menu in case options changed.
      const existing = sel.parentNode && sel.parentNode.querySelector('.sf-select');
      if (existing) {
        _buildMenuItems(existing, sel);
        _syncLabel(existing, sel);
      }
      return;
    }
    sel.dataset.sfEnhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'sf-select';
    wrap.dataset.for = sel.id || '';
    wrap.innerHTML =
      '<button type="button" class="sf-select-btn" aria-haspopup="listbox" aria-expanded="false">' +
        '<span class="sf-select-label"></span>' +
        '<span class="sf-select-chev" aria-hidden="true">\u25BE</span>' +
      '</button>' +
      '<ul class="sf-select-menu" role="listbox" hidden></ul>';
    // Insert as next sibling of the select, inside .sr-select-wrap.
    sel.parentNode.appendChild(wrap);

    _buildMenuItems(wrap, sel);
    _syncLabel(wrap, sel);

    const btn = wrap.querySelector('.sf-select-btn');
    const menu = wrap.querySelector('.sf-select-menu');

    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = !wrap.classList.contains('sf-open');
      _closeAnyOpen(wrap);
      if (willOpen) {
        // Rebuild menu just before showing — options may have changed since
        // last open (e.g. unlocks completed mid-session).
        _buildMenuItems(wrap, sel);
        wrap.classList.add('sf-open');
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        // Position the menu via fixed coords so it escapes panel overflow:
        // hidden clipping. Pick top/below based on available space.
        try {
          const r = btn.getBoundingClientRect();
          const measured = menu.scrollHeight || 220;
          const need = Math.min(measured, 220) + 8;
          const below = window.innerHeight - r.bottom;
          const above = r.top;
          const openUp = below < need && above > below;
          menu.style.position = 'fixed';
          menu.style.left     = r.left + 'px';
          menu.style.width    = r.width + 'px';
          if (openUp) {
            menu.style.bottom = (window.innerHeight - r.top + 4) + 'px';
            menu.style.top    = 'auto';
            menu.style.maxHeight = Math.min(220, above - 8) + 'px';
          } else {
            menu.style.top    = (r.bottom + 4) + 'px';
            menu.style.bottom = 'auto';
            menu.style.maxHeight = Math.min(220, below - 8) + 'px';
          }
        } catch(_){}
        _openMenu = wrap;
      } else {
        wrap.classList.remove('sf-open');
        _clearMenuPos(wrap);
        _openMenu = null;
      }
    });

    menu.addEventListener('click', function(e) {
      const li = e.target.closest('.sf-select-item');
      if (!li) return;
      if (li.classList.contains('sf-select-disabled')) return;
      const val = li.dataset.value;
      if (sel.value !== val) {
        sel.value = val;
        // Fire native 'change' so existing handlers run unchanged.
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      _syncLabel(wrap, sel);
      // Update active highlight.
      menu.querySelectorAll('.sf-select-item').forEach(n => n.classList.remove('sf-select-active'));
      li.classList.add('sf-select-active');
      // Close.
      wrap.classList.remove('sf-open');
      _clearMenuPos(wrap);
      _openMenu = null;
    });

    // Keep label in sync if external code mutates sel.value programmatically.
    // We poll on focus/refresh; cheap and only when relevant.
    sel.addEventListener('change', function() {
      _syncLabel(wrap, sel);
      const items = menu.querySelectorAll('.sf-select-item');
      items.forEach(n => {
        n.classList.toggle('sf-select-active', n.dataset.value === sel.value);
      });
    });
  }

  function refresh(sel) {
    if (!sel) return;
    const wrap = sel.parentNode && sel.parentNode.querySelector('.sf-select');
    if (!wrap) return;
    _buildMenuItems(wrap, sel);
    _syncLabel(wrap, sel);
  }

  window.SciFiSelect = { enhance: enhance, refresh: refresh };
})();
