# Jet Horizon iOS Continuity Doc

**Last updated:** May 15, 2026
**Working baseline tag:** `ios-baseline-working` (commit `d7e7824` on `dev`)
**Bundle ID:** `com.deepplane.jethorizon`
**Repo:** `deepplane89/tunnel-proto` (branch `dev`)
**Active Mac:** Robert's Mac mini M4, UUID `61BC4154-7977-516D-BCDE-239119FE6D30`
**Active iPhone:** iPhone 15 Pro, UUID `BD57AB05-90D0-5385-810F-202362CDB822`

This is the iOS-side bible. If you are an AI agent starting a new chat session for this project, **you MUST read this entire file before touching anything iOS-related**. It captures the working state, all the failed attempts so we don't repeat them, and the exact mechanics of how this repo builds for iOS.

---

## 0. RULES FOR NEW CHAT SESSIONS (read before doing anything)

These rules are non-negotiable. The user (Robert) has lost hours to violations of each one. If you break a rule, you will repeat a known regression and waste another build cycle.

### 0.1 Before you make ANY iOS change

1. **READ THIS FILE END-TO-END.** No skipping. The "Failed attempts" table in section 4 is the most important part — it lists every approach that has already been tried and broken something.
2. **Verify the Mac is on the latest `dev`** by running:
   ```bash
   pc bash -- 'cd /Users/robertc/Developer/tunnel-proto && git log --oneline -3'
   ```
   If the top commit is NOT what you expect, tell Robert to run `git pull origin dev` before you proceed. The auto-sync daemon has been unreliable.
3. **Verify the baseline is intact** by running the safety check in section 1. If `contentInset` is not `"never"` or the baseline header comment is missing from `style.capacitor.css`, restore from `ios-baseline-working` BEFORE making your change.

### 0.2 Files you may edit (iOS chat scope)

Only these five files. Touching anything else for an iOS fix is a bug.

- `capacitor.config.json` (root only — the iOS bundle copy is propagated by `cp`, never edited directly except as part of the build chain)
- `style.capacitor.css`
- `ios/App/App/AppDelegate.swift`
- `ios/App/App/Base.lproj/Main.storyboard`
- `ios/App/App/Base.lproj/LaunchScreen.storyboard`

### 0.3 Files you MUST NOT edit (web chat owns these)

If you think you need to change one of these for an iOS fix, **STOP and ask Robert.** The architecture is wrong.

- `src/` (all game JS)
- `style.css` (main shared stylesheet)
- `index.html` (shared shell)
- `www/` (build output, not source)

### 0.4 The two-domain isolation contract (NEVER violate)

iOS work is split into two domains. They are completely orthogonal. Mixing them has caused every garage-vs-strip regression in this project.

**Domain A — Strip / Title / Gameplay (global layout):**
- MAY modify: `html`, `body`, `#game-canvas`, `capacitor.config.json` ios settings, storyboards, AppDelegate
- MUST NOT modify: any selector matching `.sr-*`, `.shop-*`, or `#shop-*`

**Domain B — Garage (overlay UI):**
- MAY modify: selectors matching `.sr-*`, `.shop-*`, or `#shop-*`
- MUST NOT modify: `html`, `body`, `#game-canvas`, `#hud`, `#app`, `#ui`, or anything in `capacitor.config.json`

If a single fix appears to require both domains, the architecture is wrong. STOP and ask Robert.

### 0.5 How to push iOS changes (the ONLY supported flow)

Do this. Do not deviate.

1. Edit files in the sandbox at `/home/user/workspace/tunnel-proto/...`
2. `git add` + `git commit` + `git push origin dev` (from the sandbox, with `api_credentials=["github"]`)
3. Give Robert a SINGLE pasteable Terminal command that does: `git pull origin dev` → propagate config/CSS to bundle paths via `cp` → `xcodebuild` → `devicectl install` → `devicectl launch`. Use the template in section 2.
4. Wait for Robert's result before iterating.

**Do not use `pc push` for native code** (`.swift`, `.storyboard`). Robert's Comet policy gates Swift writes and they get denied. Always go through git push + Mac git pull.

**Do not use `pc pull`** — it requires manual approval. Use `pc bash -- 'cat <file>'` to read Mac files.

**Do not run `xcodebuild` from the sandbox** — TMPDIR is restricted, builds fail. Build commands always go to Robert.

### 0.6 If iOS layout regresses

First response: restore from baseline. Don't try to diagnose mid-regression.

```bash
cd ~/Developer/tunnel-proto && git checkout ios-baseline-working -- capacitor.config.json style.capacitor.css ios/App/App/AppDelegate.swift ios/App/App/Base.lproj/Main.storyboard ios/App/App/Base.lproj/LaunchScreen.storyboard
```

Then rebuild and ask Robert what specifically is wrong with the new behavior before changing anything. Do not guess.

### 0.7 Style / tone

Robert is a fast, direct, advanced developer. Communication rules he has set this session:

- No permission prompts for git push / pc push / pc bash — just do them.
- No multi-step "check then act" rituals when the action is obvious.
- One pasteable Terminal command per build cycle, not multiple.
- If something fails twice, STOP guessing and ask for a screenshot or describe what's visible.
- Don't say "I think" / "maybe" / "this should work" — measure first, then say what's true.

### 0.8 Diagnose before you fix

The single biggest source of wasted cycles in this project is fixing the wrong thing. Before any iOS change beyond a trivial CSS tweak:

1. Identify the exact element/layer at fault (the strip is layout, not color — see section 4).
2. Confirm the change is being deployed (md5 the file on Mac vs sandbox; check the built `App.app` bundle).
3. Confirm Robert's Mac actually pulled the latest commit before building.

If you skip any of these, you will fix the wrong file or build a stale binary. Both have happened multiple times.

---

## 1. TL;DR — How this project is structured

- **All development happens on `dev`.** Web (Vercel) and iOS (Capacitor) both consume `dev`.
- iOS-only files are listed in section 0.2.
- Web-only files (off-limits to iOS chat) are listed in section 0.3.
- **Non-layout changes** (game logic, audio, three.js, new features) made in `src/` are safe — they affect both web and iOS identically because Capacitor just wraps the same JS.

### Safety check before iOS build
```bash
cd ~/Developer/tunnel-proto && grep '"contentInset"' capacitor.config.json && grep -c "WORKING BASELINE" style.capacitor.css
```
Expect `"contentInset": "never",` and `1`. If either fails, baseline got clobbered — restore with:
```bash
git checkout ios-baseline-working -- capacitor.config.json style.capacitor.css ios/App/App/AppDelegate.swift ios/App/App/Base.lproj/Main.storyboard ios/App/App/Base.lproj/LaunchScreen.storyboard
```

---

## 2. The build pipeline (file-by-file)

### What lives where

```
~/Developer/tunnel-proto/                     # The Mac repo (git working dir)
├── capacitor.config.json                     # ROOT config, edited by humans
├── style.capacitor.css                       # iOS-only CSS, edited by humans
├── index.html                                # Shared, has inline <head> script
│                                              # that injects style.capacitor.css
│                                              # only when isNativePlatform()
├── style.css                                 # Web/shared CSS (NEVER touched by iOS chat)
├── src/                                      # Game JS (NEVER touched by iOS chat)
├── www/                                      # Build output for web. Capacitor's
│   ├── style.capacitor.css                   # webDir. `npx cap copy` mirrors
│   ├── index.html                            # root → www → iOS bundle.
│   └── ...
└── ios/App/App/                              # iOS Xcode project
    ├── AppDelegate.swift                     # Native iOS code (webView styling)
    ├── capacitor.config.json                 # COPY of root config, baked into binary
    ├── Base.lproj/
    │   ├── Main.storyboard                   # Initial CAPBridgeViewController
    │   └── LaunchScreen.storyboard           # Splash screen
    └── public/                               # COPY of www/, baked into binary
        ├── style.capacitor.css
        ├── index.html
        └── ...
```

### How a change propagates

For an iOS-affecting change to reach the device, the file must end up in the iOS bundle. There are TWO Capacitor sync mechanisms and one manual escape hatch:

1. **`npx cap copy ios`** — copies `www/` → `ios/App/App/public/` and `capacitor.config.json` → `ios/App/App/capacitor.config.json`. Fast, run frequently.
2. **`npx cap sync ios`** — does `cap copy` + reinstalls native plugins. Slow, run after `npm install`.
3. **Direct `cp` or `pc push`** — bypass Capacitor sync entirely. Used in agent workflows below.

### The required pre-build chain on the Mac

```bash
cd ~/Developer/tunnel-proto
git pull origin dev                                                # bring in agent commits
cp capacitor.config.json ios/App/App/capacitor.config.json         # propagate config to bundle
cp style.capacitor.css   www/style.capacitor.css                   # propagate CSS to webDir
cp style.capacitor.css   ios/App/App/public/style.capacitor.css    # propagate CSS to bundle
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination "id=BD57AB05-90D0-5385-810F-202362CDB822" \
  -allowProvisioningUpdates build
APP=$(find ~/Library/Developer/Xcode/DerivedData/App-*/Build/Products/Debug-iphoneos -name "App.app" -not -path "*Index.noindex*" | head -1)
xcrun devicectl device install app --device BD57AB05-90D0-5385-810F-202362CDB822 "$APP"
xcrun devicectl device process launch --device BD57AB05-90D0-5385-810F-202362CDB822 com.deepplane.jethorizon
```

This is what Robert pastes after every agent change.

---

## 3. The WORKING BASELINE (do not regress)

Tag: `ios-baseline-working` → commit `d7e7824`

### Required configuration

**`capacitor.config.json`:**
```json
{
  "appId": "com.deepplane.jethorizon",
  "appName": "Jet Horizon",
  "webDir": "www",
  "backgroundColor": "#050614",
  "ios": {
    "contentInset": "never",
    "scrollEnabled": false,
    "preferredContentMode": "mobile",
    "backgroundColor": "#050614"
  }
}
```

**`style.capacitor.css`** essentials (dual-gated on `.is-capacitor` AND `.platform-ios-native`):
- `html`, `body` → `100dvh × 100vw`, `background: #050614`, `overflow: hidden`
- `#game-canvas` → `position: fixed; inset: 0; 100vw × 100dvh; background: #050614`
- NO layout rules on `.sr-*`, `.shop-*`, `#shop-*`, `#hud`, `#app`, `#ui`
- The dropdown un-clip rule (section 2) IS allowed: `.sr-overlay:not(.hidden):has(.shop-handling-bar.open) .sr-panel`

**Storyboards** (`Main.storyboard` + `LaunchScreen.storyboard`):
- Root view `backgroundColor` = `RGB(5, 6, 20)` = `#050614`

**`AppDelegate.swift`:**
- `styleWebViewForSafeArea()` runs in `applicationDidBecomeActive`
- Sets `webView.isOpaque = false`
- Paints `webView.backgroundColor`, `webView.scrollView.backgroundColor`, `bridgeVC.view.backgroundColor`, `window.backgroundColor` all to `#050614`

### What this baseline achieves
- ✅ No black strip under home indicator on title screen
- ✅ No black strip during gameplay (canvas fills full screen)
- ✅ Garage layout works (panel docks correctly, ship centered)
- ✅ Ship handling dropdown opens in portrait
- ✅ Tap targets align with visible buttons

---

## 4. Failed attempts (DO NOT repeat)

**Rule:** If your proposed fix matches anything in this table, STOP. It has already been tried. Find a different approach or ask Robert.

History of regressions encountered in May 14-15, 2026 sessions:

| Attempt | What broke |
|---|---|
| `contentInset: "always"` | Strip returns under home indicator |
| Pad `.sr-overlay` with `safe-area-inset-bottom` | Garage panel/ship misaligned |
| Pad `#hud`/`#app`/`#ui` with `safe-area-inset-bottom` | Garage misaligned |
| Override `.sr-stage` bottom value | Ship floats too high |
| Gate iOS rules only on `.platform-ios-native` | First-paint race — strip flashes |
| Set Capacitor `backgroundColor` without `webView.isOpaque = false` | Bug `ionic-team/capacitor#5335` — WebView paints opaque system black over the configured color |
| Edit only the root `capacitor.config.json` without copying to iOS bundle | Change has no effect on next build |
| Trust auto-sync daemon to pull `dev` to Mac | Sync was stuck at `6fe95af` for hours — Mac repo and GitHub diverged silently |

---

## 5. Two-domain isolation contract

iOS CSS and the garage are kept orthogonal to prevent whack-a-mole regressions.

**Domain A — Strip / Title / Gameplay** (global layout):
- May modify: `html`, `body`, `#game-canvas`, `capacitor.config.json` ios settings, storyboards, AppDelegate
- Must NOT modify: any `.sr-*`, `.shop-*`, `#shop-*` selector

**Domain B — Garage** (overlay UI):
- May modify: `.sr-*`, `.shop-*`, `#shop-*` selectors
- Must NOT modify: `html`, `body`, `#game-canvas`, `#hud`, `#app`, `#ui`, `capacitor.config.json`

**If a garage fix appears to require a global change, STOP** — the architecture is wrong, ask Robert.

This contract is also embedded in the top of `style.capacitor.css` so any agent that opens it can't miss it.

---

## 6. Agent workflow lessons (May 15, 2026 session)

### Problem: editing the wrong file
Multiple times in early sessions, the agent edited a file in the sandbox, ran `git commit/push`, but the Mac was on a stale commit because the auto-sync daemon stopped pulling. The agent THOUGHT changes were live; they weren't.

**Mitigation:**
- Always `git pull origin dev` on the Mac at the start of a build cycle (not just trust auto-sync)
- After every `pc push`, verify with `pc bash -- 'md5 <path>'` against the sandbox file's md5

### Problem: two `capacitor.config.json` files diverging
`~/Developer/tunnel-proto/capacitor.config.json` is the human-edited source. `~/Developer/tunnel-proto/ios/App/App/capacitor.config.json` is the bundle copy. Without `cap sync` (or `cp`), they drift, and xcodebuild bakes the bundle copy.

**Mitigation:** the pre-build chain in section 2 always `cp`s the root config to the bundle path.

### Problem: `pc pull` requires manual approval
`pc bash -- 'cat <file>'` does not require approval and is functionally equivalent for read-only inspection. Use `pc bash -- 'cat'` instead of `pc pull` whenever possible. `pc push` is usually approved, but for `*.swift` it has been gated stricter (Robert's local Comet policy) — agents should use git push to GitHub + manual `git pull` on the Mac as the primary sync path for native code.

### Problem: sandbox cannot run xcodebuild
The sandbox's TMPDIR is restricted. Builds must run on Robert's Mac mini. Agents prepare a single pasteable Terminal command for him to run.

### Problem: sandbox cannot write to `.git/` on the Mac
Commands like `git pull`, `git stash`, `git reset` from `pc bash` fail with `Operation not permitted` on `.git/FETCH_HEAD`. The agent must commit/push via sandbox's local clone to GitHub, then Robert manually runs `git pull` on the Mac.

### Recommended agent flow for iOS changes
1. Edit file in sandbox (`/home/user/workspace/tunnel-proto/...`)
2. `git commit && git push origin dev` from sandbox (no Mac involvement)
3. Hand Robert the build command (he runs `git pull` + `cp` + xcodebuild on Mac)
4. Skip all `pc push` / `pc pull` unless directly inspecting Mac state

---

## 7. Device identifiers

| Device | UUID |
|---|---|
| Robert's Mac mini M4 | `61BC4154-7977-516D-BCDE-239119FE6D30` |
| iPhone 15 Pro | `BD57AB05-90D0-5385-810F-202362CDB822` |
| Mac LAN IP | `192.168.2.37` |

---

## 8. Useful spelunking commands

```bash
# Confirm Mac repo is on the latest dev
pc bash -- 'cd /Users/robertc/Developer/tunnel-proto && git log --oneline -3'

# Check if a critical config value matches the baseline
pc bash -- 'grep "contentInset" /Users/robertc/Developer/tunnel-proto/capacitor.config.json'

# Inspect what's in the latest built .app bundle
pc bash -- 'find ~/Library/Developer/Xcode/DerivedData/App-*/Build/Products/Debug-iphoneos -name "App.app" -not -path "*Index.noindex*" | head -1 | xargs -I{} bash -c "stat -f %Sm {}; cat {}/capacitor.config.json"'

# Verify CSS hash matches sandbox version
pc bash -- 'md5 /Users/robertc/Developer/tunnel-proto/ios/App/App/public/style.capacitor.css /Users/robertc/Developer/tunnel-proto/www/style.capacitor.css /Users/robertc/Developer/tunnel-proto/style.capacitor.css'

# Restore baseline if iOS layout regresses
cd ~/Developer/tunnel-proto && git checkout ios-baseline-working -- capacitor.config.json style.capacitor.css ios/App/App/AppDelegate.swift ios/App/App/Base.lproj/Main.storyboard ios/App/App/Base.lproj/LaunchScreen.storyboard
```

---

## 9. When to update this doc

**Rule:** This doc is authoritative. If reality and this doc disagree, fix the doc in the same commit that fixes reality. Never leave them out of sync.

Update this file whenever:
- A new working baseline is confirmed → tag it on GitHub, bump the tag reference in the header and section 3, add a one-line entry in section 10 changelog.
- A new failed approach gets discovered → add a row to section 4.
- The build pipeline changes (e.g., switching off Capacitor, adding a new sync step) → update sections 2 and 6.
- A new device gets added/swapped → update header and section 7.
- The isolation contract gets refined → update section 0.4.
- Robert sets a new communication preference → add it to section 0.7.

Every doc update commit message must start with `docs(ios-continuity):` so it's easy to grep.

---

## 10. Changelog

- **May 15, 2026** — Doc created. Baseline `d7e7824` tagged as `ios-baseline-working`. Captures: strip fix via `contentInset: "never"` + `webView.isOpaque = false`; garage isolation contract; agent workflow lessons from a session that burned ~3 hours on whack-a-mole.
