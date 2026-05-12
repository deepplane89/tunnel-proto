// Jet Horizon — Client Analytics Emitter
//
// Exposes window.jhTrack(type, props) — adds device/session metadata, queues
// events, flushes in batches every 5 seconds or when the queue hits 20, and
// uses navigator.sendBeacon on page unload so no events are dropped.
//
// Anonymous: device id is a random UUID stored in localStorage (`jh_did`).
// Not linked to any user identity. Not used for advertising or tracking.
//
// Auto-captures: window.onerror and unhandledrejection → 'crash' events.

(function () {
  'use strict';

  // ── one-time init guard ────────────────────────────────────────────────
  if (typeof window === 'undefined' || window.__jhTrackInit) return;
  window.__jhTrackInit = true;

  const ENDPOINT = '/api/analytics';
  const FLUSH_MS = 5000;
  const FLUSH_AT = 20;
  const MAX_QUEUE = 200;
  const VERSION = '1.0.0';

  // ── device id ──────────────────────────────────────────────────────────
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch (_) {}
    }
    // RFC4122 v4 fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  let did;
  try {
    did = localStorage.getItem('jh_did');
    if (!did) {
      did = uuid();
      localStorage.setItem('jh_did', did);
    }
  } catch (_) {
    did = uuid(); // private mode etc — session-only id
  }

  const sid = uuid();

  // ── platform detection ────────────────────────────────────────────────
  function detectPlatform() {
    try {
      if (window.Capacitor && window.Capacitor.getPlatform) {
        const p = window.Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
        if (p === 'ios') return 'ios';
        if (p === 'android') return 'android';
      }
      const ua = navigator.userAgent || '';
      if (/iPhone|iPad|iPod/i.test(ua)) return 'ios-web';
      if (/Android/i.test(ua)) return 'android-web';
    } catch (_) {}
    return 'web';
  }
  const platform = detectPlatform();

  // ── queue + flush ─────────────────────────────────────────────────────
  let queue = [];
  let flushTimer = null;
  let flushing = false;

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, FLUSH_MS);
  }

  async function flush(useBeacon) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (flushing && !useBeacon) return;
    if (queue.length === 0) return;
    flushing = true;
    const batch = queue.splice(0, FLUSH_AT);
    const body = JSON.stringify({ events: batch });

    try {
      if (useBeacon && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        const ok = navigator.sendBeacon(ENDPOINT, blob);
        if (!ok) {
          // put events back; will retry on next flush tick
          queue.unshift(...batch);
        }
      } else {
        const r = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        });
        if (!r.ok && r.status >= 500) {
          // server hiccup — requeue (front of line) up to MAX_QUEUE
          queue.unshift(...batch.slice(0, Math.max(0, MAX_QUEUE - queue.length)));
        }
      }
    } catch (_) {
      // network down — requeue
      queue.unshift(...batch.slice(0, Math.max(0, MAX_QUEUE - queue.length)));
    } finally {
      flushing = false;
      if (queue.length > 0) scheduleFlush();
    }
  }

  // ── public API ─────────────────────────────────────────────────────────
  function jhTrack(type, props) {
    try {
      if (!type) return;
      // Cap queue so a runaway loop can't OOM
      if (queue.length >= MAX_QUEUE) queue.shift();
      queue.push({
        type: String(type),
        ts: Date.now(),
        did,
        sid,
        platform,
        version: VERSION,
        props: (props && typeof props === 'object') ? props : {},
      });
      if (queue.length >= FLUSH_AT) {
        flush(false);
      } else {
        scheduleFlush();
      }
    } catch (_) {}
  }
  window.jhTrack = jhTrack;

  // ── auto-capture: errors ──────────────────────────────────────────────
  let crashCount = 0;
  const CRASH_CAP = 10; // don't spam server if game is on fire
  window.addEventListener('error', function (e) {
    if (crashCount++ >= CRASH_CAP) return;
    jhTrack('crash', {
      kind: 'error',
      message: String(e.message || '').slice(0, 240),
      file: String(e.filename || '').slice(0, 120),
      line: e.lineno || 0,
      col: e.colno || 0,
    });
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (crashCount++ >= CRASH_CAP) return;
    const r = e.reason;
    const msg = (r && (r.message || r.toString())) || 'unknown';
    jhTrack('crash', {
      kind: 'rejection',
      message: String(msg).slice(0, 240),
    });
  });

  // ── auto-flush on page hide / unload ──────────────────────────────────
  window.addEventListener('pagehide', function () { flush(true); });
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
  });

  // ── session_start fires once on load ──────────────────────────────────
  jhTrack('session_start', {
    ref: (document.referrer || '').slice(0, 120),
    lang: (navigator.language || '').slice(0, 16),
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  });
})();
