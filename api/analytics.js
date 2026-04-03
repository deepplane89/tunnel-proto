'use strict';

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY         = 'jet-horizon:analytics';
const MAX_SESSIONS = 200; // keep last 200 sessions

async function redis(...args) {
  const r = await fetch(`${REDIS_URL}`, {
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

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: 'Storage not configured.' });
  }

  // GET: return all sessions (newest first)
  if (req.method === 'GET') {
    const raw = await redis('LRANGE', KEY, 0, MAX_SESSIONS - 1);
    const sessions = raw.map(s => { try { return JSON.parse(s); } catch(_) { return null; } }).filter(Boolean);
    res.status(200).json(sessions);
    return;
  }

  // POST: store a session
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_) { body = {}; } }
    if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Invalid body.' }); return; }

    // Add server timestamp and IP
    body._serverTime = new Date().toISOString();
    body._ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || 'unknown';

    await redis('LPUSH', KEY, JSON.stringify(body));
    await redis('LTRIM', KEY, 0, MAX_SESSIONS - 1);

    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed.' });
};
// redeploy trigger
