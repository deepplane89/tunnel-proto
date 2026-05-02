// Playwright fuzz harness for tunnel-proto.
// Hammers game-state transitions to surface stuck-state bugs.
//
// Usage:  node fuzz/fuzz.js [duration_seconds]
// Default duration: 300s (5 min).
//
// Watches for: [INVARIANT-FAIL] console.warn and uncaught pageerror events.
// On hit: logs the action sequence that triggered it and the full message.

const { chromium } = require('playwright');

const URL = 'https://tunnel-proto.vercel.app';
const DURATION_S = parseInt(process.argv[2] || '300', 10);

// Action types we'll randomly pick from.
// Each returns a Promise that resolves when the action is done.
const ACTIONS = {
  // Tap center of screen — works for "Tap to Play" and "Tap to Retry"
  async tap(page) {
    const v = page.viewportSize();
    await page.mouse.click(v.width / 2, v.height / 2);
  },
  // Wait random short time (player letting game run / dying naturally)
  async waitShort(page) {
    await page.waitForTimeout(200 + Math.random() * 1500);
  },
  // Wait long enough for player to die naturally if not steering
  async waitDie(page) {
    await page.waitForTimeout(3000 + Math.random() * 4000);
  },
  // Spam tap (rapid double/triple click — simulates panic-tap on retry)
  async spamTap(page) {
    const v = page.viewportSize();
    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
      await page.mouse.click(v.width / 2, v.height / 2);
      await page.waitForTimeout(20 + Math.random() * 80);
    }
  },
  // Refresh the page mid-flow
  async refresh(page) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
  },
  // Tab away (visibilitychange) — simulates phone-lock / app-switch
  async tabAway(page) {
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500 + Math.random() * 2000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  },
  // Steer left briefly (key input)
  async steerLeft(page) {
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(100 + Math.random() * 400);
    await page.keyboard.up('ArrowLeft');
  },
  // Steer right briefly
  async steerRight(page) {
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(100 + Math.random() * 400);
    await page.keyboard.up('ArrowRight');
  },
};

// Weighted picker — favors actions that drive state transitions
const WEIGHTS = {
  tap:        4,  // primary state-transition trigger
  waitShort:  3,
  waitDie:    2,  // produces game-overs naturally
  spamTap:    3,  // the bug class user reported (rapid tapping)
  refresh:    1,  // rarer but important
  tabAway:    1,
  steerLeft:  2,
  steerRight: 2,
};
const ACTION_LIST = [];
for (const [k, w] of Object.entries(WEIGHTS)) {
  for (let i = 0; i < w; i++) ACTION_LIST.push(k);
}
function pickAction() {
  return ACTION_LIST[Math.floor(Math.random() * ACTION_LIST.length)];
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await context.newPage();

  const events = [];   // { ts, kind, msg, recentActions }
  const recentActions = []; // ring buffer of last 20 actions

  page.on('pageerror', e => {
    events.push({
      ts: Date.now(),
      kind: 'PAGEERROR',
      msg: e.message,
      stack: (e.stack || '').split('\n').slice(0, 4).join('\n'),
      recentActions: [...recentActions],
    });
    console.error(`\n[PAGEERROR] ${e.message}\n  recent: ${recentActions.slice(-10).join(' -> ')}`);
  });

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'warning' && text.includes('[INVARIANT-FAIL]')) {
      events.push({
        ts: Date.now(),
        kind: 'INVARIANT-FAIL',
        msg: text,
        recentActions: [...recentActions],
      });
      console.error(`\n[INVARIANT-FAIL] (after ${recentActions.slice(-10).join(' -> ')})\n${text}\n`);
    }
  });

  console.log(`Loading ${URL}...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Click once to satisfy any initial gesture requirement
  await ACTIONS.tap(page);
  await page.waitForTimeout(1000);

  const startTs = Date.now();
  const endTs = startTs + DURATION_S * 1000;
  let actionCount = 0;
  let lastProgressTs = startTs;

  console.log(`Fuzzing for ${DURATION_S}s...`);
  while (Date.now() < endTs) {
    const action = pickAction();
    recentActions.push(action);
    if (recentActions.length > 20) recentActions.shift();
    actionCount++;
    try {
      await ACTIONS[action](page);
    } catch (e) {
      console.error(`Action ${action} threw: ${e.message}`);
      events.push({
        ts: Date.now(),
        kind: 'ACTION-THREW',
        msg: `${action}: ${e.message}`,
        recentActions: [...recentActions],
      });
    }
    // Progress log every 30s
    const now = Date.now();
    if (now - lastProgressTs > 30000) {
      const elapsed = ((now - startTs) / 1000).toFixed(0);
      console.log(`  [${elapsed}s] ${actionCount} actions, ${events.length} events`);
      lastProgressTs = now;
    }
  }

  console.log(`\n=== FUZZ COMPLETE ===`);
  console.log(`Duration: ${DURATION_S}s`);
  console.log(`Actions:  ${actionCount}`);
  console.log(`Events:   ${events.length}`);
  console.log('');

  if (events.length === 0) {
    console.log('NO BUGS FOUND. Game survived the fuzz. Ship it.');
  } else {
    console.log('=== EVENTS ===');
    for (const ev of events) {
      const t = ((ev.ts - startTs) / 1000).toFixed(1);
      console.log(`\n[${t}s] ${ev.kind}`);
      console.log(`  msg: ${ev.msg.split('\n').slice(0, 6).join('\n        ')}`);
      console.log(`  recent actions: ${ev.recentActions.slice(-12).join(' -> ')}`);
      if (ev.stack) console.log(`  stack: ${ev.stack}`);
    }
  }

  await browser.close();
  process.exit(events.length === 0 ? 0 : 1);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(2);
});
