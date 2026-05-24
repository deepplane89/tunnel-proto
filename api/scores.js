// Jet Horizon — High Score Leaderboard API
// GET  /api/scores  → returns top 10 scores
// POST /api/scores  → submits a new score, returns updated top 10
//
// Storage: Upstash Redis (persistent, free tier: 500K commands/month)
// Uses Redis REST API directly — no npm dependencies needed.

'use strict';

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY         = 'jet-horizon:scores';   // sorted set key
const TOP_N       = 10;
const MAX_ENTRIES = 50;

// In-memory rate-limit map: ip → last submit timestamp (ms)
const rateLimitMap = new Map();
const RATE_LIMIT_MS = 5000;

// ── Redis helpers (REST API, zero dependencies) ─────────────────────────

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

// Pipeline: send multiple commands in one round-trip
async function redisPipeline(commands) {
  const r = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  const data = await r.json();
  return data;
}

async function getTop(n = TOP_N) {
  // ZREVRANGE returns highest scores first, WITHSCORES includes the score
  const raw = await redis('ZREVRANGE', KEY, 0, n - 1, 'WITHSCORES');
  // raw = [member1, score1, member2, score2, ...]
  const results = [];
  for (let i = 0; i < raw.length; i += 2) {
    let name;
    try {
      const parsed = JSON.parse(raw[i]);
      name = parsed.name || raw[i];
    } catch (_) {
      name = raw[i]; // plain name string (new format)
    }
    results.push({
      name,
      score: parseInt(raw[i + 1], 10),
    });
  }
  return results;
}

// Profanity / slur denylist. Hand-rolled, server-only. We aggressively
// normalize the name to a comparison form before checking, so leetspeak
// (n1gger, n!gger, n***er) and spacing tricks (n i g g e r) collapse to
// the same canonical string as the raw slur. The denylist itself is kept
// short and surgical — only the absolute non-negotiable slurs. We are
// NOT trying to filter every word of profanity; we ARE trying to prevent
// the most egregious leaderboard griefing.
//
// To extend: add the canonical (already-normalized) form to NAME_DENYLIST.
const LEETMAP = {
  '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a',
  '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g',
  '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't',
  '£': 'e', '€': 'e', '¥': 'y',
};
// We keep TWO normalized forms:
//   - tight:  letters only, collapsed runs (catches stretched evasion like
//             "niiiigger" or spaced "n i g g e r" or padded "_nigger_")
//   - loose:  letters only, keeps repeats (used to check whether the slur
//             appears in obvious-griefing context vs inside a real English
//             word like "sniggering")
function _leetLower(s) {
  let out = s.toLowerCase();
  try { out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
  return out.replace(/./g, ch => LEETMAP[ch] !== undefined ? LEETMAP[ch] : ch);
}
function normalizeTight(s) {
  if (typeof s !== 'string') return '';
  let out = _leetLower(s);
  out = out.replace(/[^a-z]/g, '');     // strip non-letters
  out = out.replace(/(.)\1+/g, '$1');   // collapse ALL runs to single char
  return out;
}
function normalizeLoose(s) {
  if (typeof s !== 'string') return '';
  return _leetLower(s).replace(/[^a-z]/g, '');
}

// Denylist entries are matched in BOTH forms.  We tag each entry with the
// matching strategy:
//   'tight':  the doubled letter doesn't carry meaning ("chink" / "gook"
//             collapse to "chink" / "gok" — we still want to catch them)
//   'loose':  the doubled letter IS the disambiguator ("nigger" vs "Niger",
//             "sniggering"). For these we only match on the loose form so
//             real English / proper nouns slip past.
const NAME_DENYLIST = [
  { word: 'nigger', form: 'loose' },   // tight "niger" collides with the country
  { word: 'nigga',  form: 'loose' },
  { word: 'chink',  form: 'tight' },
  { word: 'gook',   form: 'tight' },
  { word: 'spic',   form: 'tight' },
  { word: 'kike',   form: 'tight' },
  { word: 'wetback',form: 'tight' },
  { word: 'beaner', form: 'tight' },
  { word: 'tranny', form: 'tight' },
  { word: 'faggot', form: 'loose' },   // tight "fagot" is a real word (bundle of sticks)
  { word: 'retard', form: 'tight' },
  // (Add more here. Pick 'loose' if removing doubled letters collides with
  //  a real word or proper noun.)
];
// Allow-list: real English words / proper nouns whose loose form would
// otherwise be caught by a 'loose'-mode denylist entry. Checked BEFORE the
// denylist. Use the loose-normalized form (lowercased a–z, leet-substituted,
// no spaces/punctuation, doubled letters preserved).
const NAME_ALLOWLIST_LOOSE = new Set([
  'sniggering', 'sniggered', 'snigger',
  'snigger123',
  // (Add more if false-positives come up.)
]);

// Pre-compile each denylist entry to a regex matcher. Each letter in the
// slur becomes /letter+/ so stretched-evasion forms ("niiiiigger", "gooook")
// also match. Tight-mode entries match against the tight-normalized input;
// loose-mode entries match against the loose-normalized input. For loose
// mode, the slur's own doubled letters are preserved as part of the regex
// pattern, which is what gives us "nigger" ≠ "Niger" disambiguation:
//   loose entry 'nigger' compiles to /n+i+g+g+e+r+/  — needs at least 2 g's
//   tight entry 'gook'   compiles to /g+o+k+/        (after tight-normalize)
const _COMPILED_DENYLIST = NAME_DENYLIST.map(({ word, form }) => {
  const norm = form === 'tight' ? normalizeTight(word) : normalizeLoose(word);
  // letter+letter+... so each character can be repeated; collapsed runs in
  // tight mode already became single letters, but the + still helps catch
  // any letter doubled BACK by an attacker.
  const pattern = norm ? norm.split('').map(c => c + '+').join('') : null;
  return { form, norm, regex: pattern ? new RegExp(pattern) : null };
});

function isDeniedName(rawName) {
  const tight = normalizeTight(rawName);
  const loose = normalizeLoose(rawName);
  if (!tight && !loose) return false;
  if (loose && NAME_ALLOWLIST_LOOSE.has(loose)) return false;
  for (const entry of _COMPILED_DENYLIST) {
    const target = entry.form === 'tight' ? tight : loose;
    if (!target || !entry.regex) continue;
    if (entry.regex.test(target)) return true;
  }
  return false;
}

function sanitizeName(raw) {
  if (typeof raw !== 'string') return 'UNKNOWN';
  return raw
    .trim()
    .slice(0, 12)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;') || 'UNKNOWN';
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Handler ────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // If Redis is not configured, return empty (graceful fallback)
  if (!REDIS_URL || !REDIS_TOKEN) {
    if (req.method === 'GET') return res.status(200).json([]);
    return res.status(503).json({ error: 'Leaderboard storage not configured.' });
  }

  // ── GET: return top 10 ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const top = await getTop();
    res.status(200).json(top);
    return;
  }

  // ── POST: submit a new score ────────────────────────────────────────────
  if (req.method === 'POST') {
    // Rate limit by IP
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
              || req.socket?.remoteAddress
              || 'unknown';
    const now = Date.now();
    const lastSubmit = rateLimitMap.get(ip) || 0;
    if (now - lastSubmit < RATE_LIMIT_MS) {
      res.status(429).json({ error: 'Too many requests — wait a moment.' });
      return;
    }
    rateLimitMap.set(ip, now);

    // Parse body
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const name  = sanitizeName(body.name);
    const score = body.score;

    // Reject slur submissions outright. 400 + neutral message so the client
    // doesn't surface a denylist hint that would help someone iterate to find
    // a bypass. The client-side score-submit UI just shows a generic "could
    // not save" — the user re-enters a different name and tries again.
    if (isDeniedName(body.name)) {
      res.status(400).json({ error: 'Name not allowed. Please choose another.' });
      return;
    }

    if (
      typeof score !== 'number' ||
      !Number.isFinite(score)   ||
      score < 0                 ||
      Math.floor(score) !== score
    ) {
      res.status(400).json({ error: 'score must be a non-negative integer.' });
      return;
    }

    // One entry per player name — use name as the member key so ZADD GT
    // only updates if the new score is higher than the existing one.
    // First, remove any legacy entries for this name (old format: {name, date} JSON members)
    const allRaw = await redis('ZRANGE', KEY, 0, -1);
    const toRemove = [];
    for (const raw of allRaw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.name && parsed.name.toLowerCase() === name.toLowerCase() && raw !== name) {
          toRemove.push(raw);
        }
      } catch (_) {}
    }
    const cmds = [];
    for (const m of toRemove) cmds.push(['ZREM', KEY, m]);
    // Use the player name directly as the sorted set member (one entry per name)
    // ZADD GT: only update if the new score is greater than the existing score
    cmds.push(['ZADD', KEY, 'GT', score, name]);
    cmds.push(['ZREMRANGEBYRANK', KEY, 0, -(MAX_ENTRIES + 1)]);
    await redisPipeline(cmds);

    const top = await getTop();
    res.status(200).json(top);
    return;
  }

  res.status(405).json({ error: 'Method not allowed.' });
};
