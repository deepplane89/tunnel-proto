// Jet Horizon — Player Analytics API
//
// POST /api/analytics
//   body { events: [ { type, ts, did, sid, platform, version, props } ] }
//   stores each event in a per-type sorted set (scored by ts) and bumps
//   daily aggregate counters. Returns { ok, stored }.
//
// GET  /api/analytics?password=...&limit=2000
//   returns { since, events, daily, summary } for the admin dashboard.
//   Requires ANALYTICS_PASSWORD env var match.
//
// Storage keys (Upstash Redis):
//   jh:ev:<type>            ZSET (member = event JSON, score = ts ms)
//   jh:daily:<YYYY-MM-DD>   HASH { dau, runs, runs_60s, crashes, sessions }
//   jh:dau:<YYYY-MM-DD>     SET  (members = device ids that played that day)
//
// Retention: each event ZSET trimmed to last 10,000 entries. Daily HASHes
// kept forever (tiny). DAU sets expire after 90 days to bound memory.

'use strict';

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const PASSWORD    = process.env.ANALYTICS_PASSWORD || '';

const MAX_PER_TYPE   = 10000;      // ring buffer per event type
const MAX_BATCH      = 50;         // events per POST
const MAX_BODY_BYTES = 64 * 1024;  // 64 KB
const DAU_TTL_SEC    = 60 * 60 * 24 * 90;  // 90 days

const KNOWN_TYPES = new Set([
  'session_start',
  'run_start',
  'run_end',
  'crash',
  'purchase',
  'skin_equip',
]);

// ── Redis (REST, zero deps) ─────────────────────────────────────────────
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

async function redisPipeline(commands) {
  const r = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  return r.json();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function todayKey(ts) {
  const d = new Date(ts || Date.now());
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function sanitizeEvent(ev, serverTs, ip) {
  if (!ev || typeof ev !== 'object') return null;
  const type = String(ev.type || '').slice(0, 32);
  if (!KNOWN_TYPES.has(type)) return null;
  const did = String(ev.did || '').slice(0, 64);
  const sid = String(ev.sid || '').slice(0, 64);
  const platform = String(ev.platform || '').slice(0, 16);
  const version  = String(ev.version  || '').slice(0, 16);
  const ts = Number(ev.ts) || serverTs;
  // props: cap to 4KB serialized
  let props = ev.props && typeof ev.props === 'object' ? ev.props : {};
  let propsStr = JSON.stringify(props);
  if (propsStr.length > 4096) {
    propsStr = '{"_truncated":true}';
    props = { _truncated: true };
  }
  return {
    type, did, sid, platform, version, ts,
    props,
    _srv: serverTs,
    _ip: ip, // kept server-side only for abuse triage; redacted from GET response
  };
}

// ── POST: ingest events ─────────────────────────────────────────────────
async function handlePost(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_BYTES) {
      return res.status(413).json({ error: 'Body too large' });
    }
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  if (!body || !Array.isArray(body.events)) {
    return res.status(400).json({ error: 'Expected { events: [...] }' });
  }
  const events = body.events.slice(0, MAX_BATCH);
  const serverTs = Date.now();
  const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || 'unknown';

  const commands = [];
  const seenDailyDid = new Set();
  let stored = 0;

  for (const raw of events) {
    const ev = sanitizeEvent(raw, serverTs, ip);
    if (!ev) continue;
    const day = todayKey(ev.ts);

    // 1. ZADD into per-type ring buffer
    const payload = JSON.stringify(ev);
    commands.push(['ZADD', `jh:ev:${ev.type}`, ev.ts, payload]);

    // 2. trim ring buffer to MAX_PER_TYPE
    commands.push(['ZREMRANGEBYRANK', `jh:ev:${ev.type}`, 0, -(MAX_PER_TYPE + 1)]);

    // 3. daily aggregates
    if (ev.type === 'session_start') {
      commands.push(['HINCRBY', `jh:daily:${day}`, 'sessions', 1]);
    } else if (ev.type === 'run_start') {
      commands.push(['HINCRBY', `jh:daily:${day}`, 'runs', 1]);
    } else if (ev.type === 'run_end') {
      const dur = Number(ev.props?.duration) || 0;
      if (dur >= 60) {
        commands.push(['HINCRBY', `jh:daily:${day}`, 'runs_60s', 1]);
      }
    } else if (ev.type === 'crash') {
      commands.push(['HINCRBY', `jh:daily:${day}`, 'crashes', 1]);
    }

    // 4. DAU set (any event from a did counts that did as active that day)
    if (ev.did) {
      const dauKey = `jh:dau:${day}`;
      const seenKey = `${day}|${ev.did}`;
      if (!seenDailyDid.has(seenKey)) {
        seenDailyDid.add(seenKey);
        commands.push(['SADD', dauKey, ev.did]);
        commands.push(['EXPIRE', dauKey, DAU_TTL_SEC]);
      }
    }
    stored++;
  }

  if (commands.length > 0) {
    await redisPipeline(commands);
  }
  res.status(200).json({ ok: true, stored });
}

// ── GET: dashboard data (password-gated) ────────────────────────────────
async function handleGet(req, res) {
  const pw = String(req.query?.password || '');
  if (!PASSWORD || pw !== PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const limit = Math.min(parseInt(req.query?.limit, 10) || 2000, 5000);

  // Fetch recent events for each known type
  const evCmds = [];
  for (const t of KNOWN_TYPES) {
    evCmds.push(['ZREVRANGE', `jh:ev:${t}`, 0, limit - 1]);
  }
  const evResults = await redisPipeline(evCmds);

  const eventsByType = {};
  let i = 0;
  for (const t of KNOWN_TYPES) {
    const arr = (evResults[i]?.result || []).map(s => {
      try {
        const o = JSON.parse(s);
        delete o._ip; // redact IP from response
        return o;
      } catch (_) { return null; }
    }).filter(Boolean);
    eventsByType[t] = arr;
    i++;
  }

  // Last 30 days of daily aggregates
  const days = [];
  const now = new Date();
  for (let d = 29; d >= 0; d--) {
    const dt = new Date(now);
    dt.setUTCDate(dt.getUTCDate() - d);
    days.push(dt.toISOString().slice(0, 10));
  }

  const dailyCmds = [];
  for (const day of days) {
    dailyCmds.push(['HGETALL', `jh:daily:${day}`]);
    dailyCmds.push(['SCARD',   `jh:dau:${day}`]);
  }
  const dailyResults = await redisPipeline(dailyCmds);

  const daily = [];
  for (let j = 0; j < days.length; j++) {
    const hashRaw = dailyResults[j * 2]?.result || [];
    const dauCount = dailyResults[j * 2 + 1]?.result || 0;
    // HGETALL returns flat array [k1,v1,k2,v2,...]
    const h = {};
    for (let k = 0; k < hashRaw.length; k += 2) {
      h[hashRaw[k]] = parseInt(hashRaw[k + 1], 10) || 0;
    }
    daily.push({
      date: days[j],
      dau:      Number(dauCount) || 0,
      sessions: h.sessions || 0,
      runs:     h.runs || 0,
      runs_60s: h.runs_60s || 0,
      crashes:  h.crashes || 0,
    });
  }

  // Summary numbers
  const totals = daily.reduce((a, d) => ({
    dau:      a.dau + d.dau,
    sessions: a.sessions + d.sessions,
    runs:     a.runs + d.runs,
    runs_60s: a.runs_60s + d.runs_60s,
    crashes:  a.crashes + d.crashes,
  }), { dau: 0, sessions: 0, runs: 0, runs_60s: 0, crashes: 0 });

  const todayDau = daily[daily.length - 1]?.dau || 0;
  const last7Dau = new Set();
  for (let j = daily.length - 7; j < daily.length; j++) {
    // We can't union sets here without extra round trips; approximate with sum
    last7Dau.add(daily[j]?.dau || 0);
  }

  res.status(200).json({
    serverTime: new Date().toISOString(),
    summary: {
      todayDau,
      last30TotalEvents: Object.values(eventsByType).reduce((a, arr) => a + arr.length, 0),
      ...totals,
    },
    daily,
    events: eventsByType,
  });
}

// ── handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: 'Storage not configured.' });
  }

  try {
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'GET')  return await handleGet(req, res);
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('analytics error:', err);
    return res.status(500).json({ error: 'Server error', detail: String(err.message || err) });
  }
};
