# Jet Horizon — Monetization Plan

**Status:** Planning locked, no code written yet. Pick up when game polish is done.
**Created:** May 19, 2026 (1 AM EDT)
**Owner:** iOS chat (all native plugin integration); web chat owns shop UI changes in `src/50-shop.js`.

## When to actually build this

Not yet. Build the monetization stack **~1-2 weeks before submitting to App Store review**, not at the final-submission moment. Why:

- IAP products go through Apple review alongside the binary; first-time products take 24-48h. Discovering "Restore Purchases is broken" on submission day = blocked launch.
- AppLovin's eCPM optimization needs ~1 week of impressions to ramp up. Don't launch cold.
- Monetization code has bugs you only catch in TestFlight (ATT prompt timing, sandbox-vs-prod purchase flows, ad dismissal edge cases).
- The base game still needs polish + friend/family TestFlight feedback first. Monetization on a half-broken game just adds noise.

**Trigger to start Phase 1: "I'm ready to schedule App Store submission in ~2 weeks."**

---

## Locked decisions (May 19, 2026 — Robert + iOS chat)

| Decision | Choice | Rationale |
|---|---|---|
| Core model | Free with ads + Premium tier + currency packs | Maximum revenue ceiling, standard for casual games |
| Ad network | **AppLovin MAX** | Mediates AdMob + Meta + Unity + others in one auction. ~15-30% higher eCPM than raw AdMob for casual games with decent volume |
| IAP backend | **Client-side only** (no Vercel server-side receipt validation) | Standard for casual games. iOS plugin handles validation against Apple servers on-device. Add server validation later if revenue justifies. |
| IAP price ladder | **Scaffold with standard tiers** ($0.99 / $2.99 / $4.99 / $9.99 / $19.99 / $49.99) | Final prices set in App Store Connect right before launch |
| Premium tier | **TWO products**: `$4.99 remove ads` AND `$7.99 remove ads + starter coin/fuel pack` | Two tiers gives "impulse" + "best value" options |

---

## Phase 0 — User-side prerequisites (no code)

Before any code can ship, Robert handles:

1. **Sign Paid Apps Agreement** in App Store Connect
   - https://appstoreconnect.apple.com → Business → Agreements, Tax, and Banking
   - Required before ANY IAP product can be created
2. **Banking info** — where Apple sends the 70% revenue cut (bank routing + account)
3. **Tax info** — W-9 form (US) or W-8BEN (non-US). Same screen as banking.
4. **AppLovin account** — sign up at https://applovin.com, create iOS app entry for `com.deepplane.jethorizon`, grab the SDK key (will be passed to the plugin via Info.plist)
5. **Re-update App Privacy on App Store Connect** — currently declares no ads / no third-party data sharing. Adding ads means re-declaring:
   - "Identifiers → Device ID" → YES (AppLovin reads IDFA when ATT permission granted)
   - "Tracking" → YES (advertising)
   - Adds the "Data Used to Track You" section to nutrition label

Estimated total user-side time: **~1 hour total** spread across the 5 items.

---

## Phase 1 — Ads (build first, ~2-4 sessions)

### Plugin
- `applovin-max-capacitor-plugin` (community plugin) OR write a thin Swift bridge ourselves if the community plugin is stale. Survey the plugin landscape when this phase starts.

### Placements (locked)
1. **Interstitial after every 3rd run** — full-screen ad shown on the run-over screen. Gated by `!isPremium()`. Counter is `localStorage['jh_runs_since_ad']`.
2. **Rewarded video for free coins OR fuel cells** — NEW button on menu / shop screen with a CHOICE:
   - "WATCH AD → 500 COINS" OR "WATCH AD → 5 FUEL CELLS"
   - Player picks one, watches 30s ad, gets the reward
   - Cooldown: 1 ad per 5 minutes (prevents reward farming)
   - NOT gated by premium — even premium users can use rewarded video (they explicitly opt in)

### Placements explicitly NOT included
- ❌ No banner ads anywhere (lowest revenue, most intrusive, hurts game feel)
- ❌ No rewarded ad for Save Me / second-chance (decided against — keep Save Me a pure fuel-cell mechanic for now; could reconsider later)
- ❌ No ads during gameplay (only on menu / run-over screens)

### App Tracking Transparency
- Show ATT prompt on first launch BEFORE first ad request
- Custom pre-prompt explaining "personalized ads = better game, free forever"
- If user denies → AppLovin still serves non-personalized ads (~30-50% lower eCPM but functional)
- Add `NSUserTrackingUsageDescription` to Info.plist

### Files that will be touched (iOS chat owns)
- `ios/App/App/Info.plist` — add AppLovin SDK key + NSUserTrackingUsageDescription
- `capacitor.config.json` — possibly plugin config
- `package.json` — add plugin
- `ios/App/App/AppDelegate.swift` — possibly init code

### Files that will be touched (web chat owns — coordinate when phase starts)
- `src/50-shop.js` — add "FREE COINS / FREE FUEL" rewarded video button
- New file: `src/55-ads.js` (or similar) — thin JS wrapper around the Capacitor plugin
- `src/65-settings.js` — possibly add ad-related toggles
- `style.css` — buttons styling

---

## Phase 2 — Premium "Remove Ads" (build second, ~1-2 sessions)

### Plugin
- `@capacitor-community/in-app-purchases` (assuming still maintained when phase starts; otherwise pick alternative)

### IAP products to create in App Store Connect
| Product ID | Type | Display Name | Price | What it does |
|---|---|---|---|---|
| `jh_remove_ads` | Non-consumable | Remove Ads | $4.99 | Sets `jh_premium=1`, hides all ads |
| `jh_remove_ads_bundle` | Non-consumable | Pro Pack — Remove Ads + Starter Bundle | $7.99 | Sets `jh_premium=1` + credits 5,000 coins + 20 fuel cells (one-time) |

### Required UX
- "Restore Purchases" button in Settings (Apple REJECTS apps without this for non-consumables)
- Premium state stored as `localStorage['jh_premium']='1'` + included in existing save-code cloud sync (so user gets premium on their other devices via save code restore)
- `isPremium()` helper function used by:
  - Ad system (don't show interstitials)
  - HUD (maybe show a small "PRO" badge?)
  - Shop (maybe "thanks for supporting!" message)

### Apple compliance notes
- "Remove Ads" must be available as a one-time IAP — Apple rejects subscription-only ad removal for casual games
- Cannot be a "Pay $X to unlock the game" — Apple rejects pay-walling existing free functionality
- Bundle pack with coins/fuel is fine because it's adding value, not pay-walling

---

## Phase 3 — Consumable currency packs (build third, ~2-3 sessions)

### IAP products to create
| Product ID | Type | Display | Price | Credits |
|---|---|---|---|---|
| `jh_coins_small` | Consumable | 1,000 Coins | $0.99 | +1,000 coins |
| `jh_coins_med` | Consumable | 5,500 Coins | $2.99 | +5,500 coins (10% bonus) |
| `jh_coins_large` | Consumable | 12,000 Coins | $4.99 | +12,000 coins (20% bonus) |
| `jh_coins_mega` | Consumable | 30,000 Coins | $9.99 | +30,000 coins (50% bonus) |
| `jh_fuel_small` | Consumable | 10 Fuel Cells | $0.99 | +10 fuel |
| `jh_fuel_med` | Consumable | 55 Fuel Cells | $2.99 | +55 fuel (10% bonus) |
| `jh_fuel_large` | Consumable | 120 Fuel Cells | $4.99 | +120 fuel (20% bonus) |
| `jh_fuel_mega` | Consumable | 300 Fuel Cells | $9.99 | +300 fuel (50% bonus) |

(Exact numeric values to be tuned during build — these are placeholders.)

### Critical Apple rules
- **Consumables CANNOT be restored** (per Apple policy). If user reinstalls, their coin/fuel purchases are gone. Document this clearly in the shop UI.
- Coin/fuel balance must sync with existing save-code system so users keep balance across devices.
- Each purchase must call Apple's `finishTransaction` callback or Apple will retry the purchase indefinitely.

### UX
- New "STORE" / "GET MORE" sections in shop UI
- Purchase confirmation: native iOS dialog (Apple handles)
- On success: animate coins/fuel pouring into HUD, play SFX
- On failure: graceful error message, don't deduct anything

---

## File ownership summary (for both chats)

**iOS chat exclusive:**
- All native plugin install/config (npm install, capacitor.config.json plugin section)
- Info.plist additions (SDK keys, ATT description, etc.)
- AppDelegate.swift if needed
- App Store Connect IAP product creation
- AppLovin dashboard setup
- Privacy form re-declaration

**Web chat exclusive (when phase starts, coordinate):**
- Shop UI updates in `src/50-shop.js` (currency pack buttons, rewarded video buttons, restore purchases button)
- Settings UI in `src/65-settings.js` (restore purchases button, ad preferences if any)
- New `src/55-ads.js` or similar (thin JS wrapper calling the Capacitor plugin)
- CSS for new buttons in `style.css`

**Shared (either chat, but coordinate):**
- `package.json` (whoever installs the plugin)
- localStorage key conventions (premium flag, ad cooldown timestamps)

---

## Analytics events already in place

Your existing `jhTrack()` analytics already fires `purchase` events. When IAP launches, hook the real-money purchases into the same event with a `source: 'iap'` flag vs `source: 'coins'`. This will let you see:
- Conversion rate (free → paying)
- Average revenue per paying user
- Which packs sell best
- Ad-watch-to-purchase funnel

No new analytics infra needed.

---

## Open questions (decide at build time, not now)

- Exact coin/fuel quantities per pack (need to tune based on in-game economy at the time)
- Whether premium users get a small ongoing perk (e.g. 10% more coins per run) or just no ads
- Whether to add a "Daily ad reward" (watch 1 ad/day for a streak bonus) — strong retention mechanic but adds complexity
- Whether to add Family Sharing support for Remove Ads (Apple suggests it; trivial to enable)
- Ad-watch cooldown exact value (5 min is starting guess; tune based on data)

---

## Source of truth

When monetization work begins, this doc gets superseded by inline implementation notes in `IOS_CONTINUITY.md` (native side) and a similar `WEB_CONTINUITY.md` style note (UI side). This doc captures the *plan*; the build adds the *reality*.
