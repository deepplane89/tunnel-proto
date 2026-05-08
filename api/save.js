// Jet Horizon — Cross-device save sync
// POST /api/save  body { keys: { jh_owned_skins: "...", ... } }
//                 returns { code: "JH-XXXX-XX" }
// GET  /api/save?code=JH-XXXX-XX
//                 returns { keys: { ... } } or 404
//
// Storage: Upstash Redis (same instance as scores).
// Codes are 8 alphanumeric chars (Crockford-style, no I/O/0/1/L) split as
// JH-XXXX-XX for readability. ~37 bits entropy → collision-safe at small scale.
// TTL: 1 year (refreshed on each successful redeem).

'use strict';

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY_PREFIX  = 'jh:save:';
const TTL_SECONDS = 60 * 60 * 24 * 365;     // 1 year
const MAX_BODY    = 64 * 1024;              // 64 KB cap on save blob
const MAX_TRIES   = 8;                      // collision retry budget

// Crockford-ish alphabet: no I/L/O/0/1 to avoid OCR/typing confusion.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const rateLimitMap = new Map();
const RATE_LIMIT_MS = 3000;

// ── Redis helpers (REST API, zero deps) ─────────────────────────────────
async function redis(...args) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function genCode() {
  let s = '';
  // crypto.randomBytes is available in node runtime (Vercel functions).
  let bytes;
  try {
    const crypto = require('crypto');
    bytes = crypto.randomBytes(8);
  } catch (_) {
    bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `JH-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  // Strip everything that isn't a letter/digit; uppercase; remap easily-confused chars.
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  s = s.replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1');
  // Allow optional "JH" prefix.
  if (s.startsWith('JH')) s = s.slice(2);
  // Now we expect exactly 8 alphabet chars; reject any that contain disallowed chars.
  if (s.length !== 8) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return `JH-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

function getClientIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(500).json({ error: 'storage not configured' });
    return;
  }

  // Rate limit per IP (3s between calls).
  const ip = getClientIP(req);
  const now = Date.now();
  const last = rateLimitMap.get(ip) || 0;
  if (now - last < RATE_LIMIT_MS) {
    res.status(429).json({ error: 'too many requests, slow down' });
    return;
  }
  rateLimitMap.set(ip, now);
  // Cheap GC: drop entries older than 5 min.
  if (rateLimitMap.size > 1000) {
    for (const [k, t] of rateLimitMap) {
      if (now - t > 5 * 60 * 1000) rateLimitMap.delete(k);
    }
  }

  try {
    if (req.method === 'POST') {
      // Body parsing — Vercel parses JSON automatically when content-type is set,
      // but be defensive.
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = null; }
      }
      if (!body || typeof body.keys !== 'object' || body.keys === null) {
        res.status(400).json({ error: 'invalid body — expected { keys: {...} }' });
        return;
      }
      const blob = JSON.stringify({ keys: body.keys, savedAt: Date.now() });
      if (blob.length > MAX_BODY) {
        res.status(413).json({ error: 'save too large' });
        return;
      }

      // Generate a code that doesn't collide. SETNX (SET ... NX) for atomicity.
      let code = null;
      for (let i = 0; i < MAX_TRIES; i++) {
        const candidate = genCode();
        const k = KEY_PREFIX + candidate;
        const r = await redis('SET', k, blob, 'NX', 'EX', String(TTL_SECONDS));
        if (r === 'OK') { code = candidate; break; }
      }
      if (!code) {
        res.status(500).json({ error: 'could not allocate code, try again' });
        return;
      }
      res.status(200).json({ code });
      return;
    }

    if (req.method === 'GET') {
      const code = normalizeCode(req.query?.code);
      if (!code) {
        res.status(400).json({ error: 'invalid code format' });
        return;
      }
      const k = KEY_PREFIX + code;
      const blob = await redis('GET', k);
      if (!blob) {
        res.status(404).json({ error: 'code not found' });
        return;
      }
      // Refresh TTL so active codes don't expire.
      try { await redis('EXPIRE', k, String(TTL_SECONDS)); } catch (_) {}
      let parsed;
      try { parsed = JSON.parse(blob); } catch (_) {
        res.status(500).json({ error: 'corrupt save' });
        return;
      }
      res.status(200).json({ keys: parsed.keys || {}, savedAt: parsed.savedAt || null });
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
