# Jet Horizon Build & Deploy Workflow

**Last updated:** May 15, 2026
**Companion doc:** `IOS_CONTINUITY.md` (iOS-specific rules + failed-attempts log)
**Repo:** `deepplane89/tunnel-proto`

This doc is the authoritative explanation of how this project builds and deploys. Read it before pushing anything. The terminology here is non-obvious and has caused multiple wasted cycles when agents misread "dev" as a branch name.

---

## TL;DR

- **Two git branches:** `dev` (working branch, ALL agent commits go here) and `main` (production-only, hand-promoted by Robert).
- **Two BUILD outputs of `src/*.js`:** DEV build (has tuners + hitch meter + dev tools) and PROD build (stripped). Both compile to the same path: `dist/game.js`. They are toggled by a flag to `build.sh`.
- **Three deploy targets:**
  - **Local testing** (Mac + iPhone Safari PWA via `python3 -m http.server 8080`) → DEV build
  - **Vercel web production** (the URL the public sees) → PROD build, served from `main`
  - **iOS / Capacitor app** (TestFlight + on-device builds) → PROD build, bundled from `main`
- **The committed `dist/game.js` on `dev` is always the DEV build.** The committed `dist/game.js` on `main` is always the PROD build. The same file path, opposite contents on the two branches.
- **You never push `main`** without Robert explicitly saying "push to main." Default destination is always `dev`.

---

## 1. Branches

### `dev` — working branch
- Everything lands here first.
- Both web chat and iOS chat push directly to `dev`.
- The `dist/game.js` committed on `dev` is the **DEV build** (tuners enabled, hitch meter visible, `__JH_DEV__ = true`).
- This is what Robert pulls to his Mac for local testing and what he runs through `python3 -m http.server 8080`.
- Auto-deployed to Vercel preview environments (NOT the production URL).

### `main` — production branch
- Only updated when Robert says "push to main."
- The `dist/game.js` committed on `main` is the **PROD build** (dev tools stripped, `__JH_DEV__ = false`).
- This is what Vercel serves at the public production URL.
- This is what gets baked into the iOS app bundle for TestFlight / on-device builds.
- **Never push to `main` unprompted.** If the user hasn't explicitly said "push to main" or "ship it to prod" in this session, the default is `dev`.

### Why two branches with the same source but different `dist/`?
Because `dist/game.js` is the file the browser actually loads. The dev tools (tuner panels, hitch meter, perf recorder, asteroid tuner, etc.) live in source files like `src/68-hitch-meter.js` and `src/78-tuner-panels.js`. The build script EXCLUDES those files entirely in `--prod` mode and replaces them with no-op stubs from `src/_dev-stubs.js`. Same source tree, two physically different bundle outputs. Keeping each branch pinned to its appropriate build means Robert can pull `dev` on his Mac and get the dev tools, while Vercel and iOS pull `main` and get the clean prod bundle.

---

## 2. Build outputs

### DEV build
- **How to produce:** `bash scripts/build.sh --dev`
- **First line of output:** `/* JH_BUILD: dev */ window.__JH_DEV__=true;`
- **Includes:** all `src/*.js` files, including dev-only files (`src/49-tuner-hud.js`, `src/68-hitch-meter.js`, `src/78-tuner-panels.js`).
- **Excludes:** `src/_dev-stubs.js` (only used in prod).
- **What runtime features it enables (gated on `window.__JH_DEV__`):**
  - Hitch meter toggle in pause menu (`src/68-hitch-meter.js`)
  - All tuner panels (asteroid tuner, layout tuner, physics tuner — `src/78-tuner-panels.js`)
  - Dev hotkeys (1-9 = DR stages, Shift+1 = L5, etc. — `src/72-main-late-mid.js`)
  - Tap title name to unlock garage / give coins (`src/48-showroom.js`)
  - Perf diagnostics overlay (gated by `window._perfDiagOn`, but the code is only present in DEV)
- **Where it ships:** `dist/game.js` on `dev` branch. Robert's local Mac server. Never to Vercel production, never to iOS bundle.

### PROD build
- **How to produce:** `bash scripts/build.sh` (no flag — prod is default) or `bash scripts/build.sh --prod`
- **First line of output:** `/* JH_BUILD: prod */ window.__JH_DEV__=false;`
- **Includes:** all `src/*.js` files EXCEPT the dev-only files listed above.
- **Replaces dev-only files with:** `src/_dev-stubs.js` (no-op replacements for the few unguarded globals dev-only files export).
- **What's stripped at runtime:** every `if (window.__JH_DEV__)` block becomes dead code, and the dev-only source files are physically absent from the bundle. ~30-40KB smaller than the DEV build.
- **Where it ships:** `dist/game.js` on `main` branch. Vercel production URL. iOS Capacitor app bundle.

### Where they land
| Location | Branch | dist/game.js contents | Marker |
|---|---|---|---|
| Sandbox `/tmp/tunnel-proto/` (agent working dir) | whichever was last `git checkout`'d | whichever was last built | check `head -1 dist/game.js` |
| Mac `/Users/robertc/Developer/tunnel-proto/` | `dev` | **DEV build** | `JH_BUILD: dev` |
| Local `python3 -m http.server 8080` | served from Mac repo | **DEV build** | `__JH_DEV__=true` |
| Vercel production | `main` | **PROD build** | `__JH_DEV__=false` |
| iOS Capacitor bundle (`ios/App/App/public/`) | `main` | **PROD build** | `__JH_DEV__=false` |

---

## 3. Deploy targets explained

### Local testing (Mac + iPhone Safari PWA)
- Robert serves the Mac repo with `python3 -m http.server 8080`.
- His iPhone Safari connects to the Mac's LAN IP (`192.168.2.37:8080`) and runs the PWA.
- The PWA loads `dist/game.js` from the local Mac repo, which is on branch `dev`, which contains the DEV build.
- Robert uses this for almost all day-to-day playtesting because it has the tuners and dev hotkeys.
- **iPhone Safari PWA is NOT Capacitor.** Capacitor wraps the same web app in a native iOS shell — different runtime, different bundle path.

### Vercel web production
- Deploys from `main` automatically on every push.
- Serves the PROD build (no dev tools).
- This is what shows up at the public production URL.
- `dev` branch gets Vercel preview URLs, NOT the production URL.

### iOS / Capacitor (TestFlight + on-device)
- Capacitor wraps the web app in a native iOS WebView (WKWebView).
- The web assets get copied into the iOS bundle: `ios/App/App/public/` is a copy of `www/`, which itself mirrors the repo root.
- Capacitor expects PROD build behavior — the dev tools are not designed to work inside the WebView, and shipping them would bloat the binary and expose dev surfaces.
- Build chain (Robert runs this on his Mac after a PR merges to `main`):
  ```bash
  git checkout main && git pull origin main
  cp capacitor.config.json ios/App/App/capacitor.config.json
  cp style.capacitor.css   www/style.capacitor.css
  cp style.capacitor.css   ios/App/App/public/style.capacitor.css
  # dist/game.js on main is already the PROD build — no rebuild needed
  cd ios/App
  xcodebuild ... && xcrun devicectl device install ... && launch
  ```
- See `IOS_CONTINUITY.md` section 2 for the full pre-build chain.

---

## 4. The flow for an agent making a change

### Standard change (web/gameplay/logic)
1. Make sure you're on `dev` in the sandbox: `git checkout dev && git pull origin dev`
2. Edit `src/*.js` (or whatever).
3. **Build as DEV** (because `dev` branch always carries the DEV build):
   ```bash
   bash scripts/build.sh --dev
   ```
4. Sanity check: `head -1 dist/game.js` should print `/* JH_BUILD: dev */`.
5. Syntax check: `node --check dist/game.js`.
6. Bump the cache-buster:
   ```bash
   TS=$(date +%s) && sed -i.bak -E "s|game\.js\?v=[0-9]+|game.js?v=${TS}|" index.html && rm -f index.html.bak
   ```
7. Commit + push to `dev`:
   ```bash
   git add -A && git add -f dist/game.js
   git -c user.name=dev -c user.email=dev@local commit -m "..." --quiet
   git push origin HEAD:dev --force-with-lease    # api_credentials=["github"]
   ```
8. Tell Robert to pull on his Mac and hard-refresh Safari.

### Promotion to production
**Only when Robert explicitly says "push to main" / "promote to prod" / "ship it."**
1. From `dev`:
   ```bash
   git checkout main && git pull origin main
   git merge dev --no-ff    # or cherry-pick specific commits
   ```
2. **Rebuild as PROD** (overwriting the DEV-build dist):
   ```bash
   bash scripts/build.sh        # no flag = prod
   ```
3. Sanity check: `head -1 dist/game.js` should print `/* JH_BUILD: prod */`.
4. Bump cache-buster, commit, push:
   ```bash
   TS=$(date +%s) && sed -i.bak -E "s|game\.js\?v=[0-9]+|game.js?v=${TS}|" index.html && rm -f index.html.bak
   git add -A && git add -f dist/game.js
   git -c user.name=dev -c user.email=dev@local commit -m "prod: ..." --quiet
   git push origin HEAD:main
   ```
5. Vercel auto-deploys on push to `main`.
6. iOS app needs a manual rebuild on the Mac (see `IOS_CONTINUITY.md` section 2).
7. **Then switch back to `dev`** so the next agent change doesn't accidentally land on `main`:
   ```bash
   git checkout dev
   ```

---

## 5. Common mistakes (already burned cycles on these)

| Mistake | Symptom | Fix |
|---|---|---|
| Run `bash scripts/build.sh` (no flag) and push to `dev` | DEV build dist gets replaced with PROD; hitch meter and tuners vanish on user's Mac | Always pass `--dev` when pushing to `dev` |
| Misread "dev" as "the user wants production stripped" | Push a PROD build to `dev`, breaking local testing | "dev" is a branch + a build flag. On `dev` branch, build flag is `--dev`. |
| Push to `main` without explicit user consent | Production users see unfinished work; iOS App Store version goes out of sync | Default destination is ALWAYS `dev`. Treat "push to main" as a separate manual action. |
| Edit iOS-owned files for a non-iOS fix | Breaks the working iOS baseline | See `IOS_CONTINUITY.md` section 0.2 for the five iOS-owned files. Web changes never touch them. |
| Forget the cache-buster bump | Browser serves stale `dist/game.js` after pull | The cache-buster `?v=` query string on the script tag in `index.html` must update on every build |
| `pc push` `.swift` or storyboard files | Comet policy denies the write | Use git push + Mac git pull for native iOS code. `pc push` is fine for `dist/game.js` and `index.html`. |
| `pc bash` operations that touch `.git/` | Sandbox blocks writes to `.git/FETCH_HEAD` etc. | All git ops happen in the sandbox's local clone, then Robert runs `git pull` on the Mac. |

---

## 6. Verification commands

### Confirm sandbox state matches expectation before pushing
```bash
cd /tmp/tunnel-proto
git branch --show-current        # → should be 'dev' for normal work
git status --short               # → should be empty after a commit
head -1 dist/game.js             # → JH_BUILD: dev (for dev branch) or JH_BUILD: prod (for main)
node --check dist/game.js && echo OK
```

### Confirm Mac state matches GitHub
```bash
pc bash --cwd /Users/robertc/Developer/tunnel-proto "git log --oneline -3 && head -1 dist/game.js"
```

### Confirm a Mac dist file matches the sandbox dist file (after `pc push`)
```bash
md5 /tmp/tunnel-proto/dist/game.js
pc bash --cwd /Users/robertc/Developer/tunnel-proto "md5 dist/game.js"
```
Hashes must match. If they don't, the push didn't propagate.

### Confirm both branches have the right build committed
```bash
git show origin/dev:dist/game.js  | head -1   # → JH_BUILD: dev
git show origin/main:dist/game.js | head -1   # → JH_BUILD: prod
```

---

## 7. Why this complexity exists

The unity-build refactor concatenates `src/*.js` into a single `dist/game.js` so the browser only does one network fetch. It uses file-position ordering (numeric prefix in filename) and zero module boundaries — every file shares one global scope. This makes it fast, but it also means you can't easily ship a "debug bundle" alongside the prod bundle the way you would with Webpack chunking. So instead the build script does selective inclusion + a global `__JH_DEV__` runtime flag.

The two-branches-with-different-`dist/` setup is the simplest way to keep "what the user runs locally" and "what production serves" as separate artifacts without needing a separate build server or feature flag service. Robert is a solo developer — this is fine for the project's scale and the human-readable boundary (commit goes to the right branch = right build ships) is easier to reason about than a flag system.

---

## 8. If something goes wrong

- **Local testing missing dev tools after a pull:** check `head -1 dist/game.js` on the Mac. If it says `JH_BUILD: prod`, an agent accidentally pushed a prod build to `dev`. Rebuild with `--dev` and force-push.
- **Production looks broken after a `main` push:** check `head -1 dist/game.js` on Vercel deploy logs. If it says `JH_BUILD: dev`, an agent pushed a dev build to `main`. Rebuild with `--prod` and force-push. Then audit how it happened.
- **iOS app shows tuners or hitch meter:** the iOS bundle has a dev build in it. Reset `ios/App/App/public/` from `main`'s prod `dist/game.js` and rebuild the Xcode project.
- **Sandbox `dist/game.js` and Mac `dist/game.js` don't match after a `git pull`:** the Mac's auto-sync daemon may have stalled (it has before — see `IOS_CONTINUITY.md` section 6). Force a manual pull, then verify md5.

---

## 9. Document maintenance

If the build pipeline changes, update this doc IN THE SAME COMMIT as the change. Specifically:
- New deploy target → add to section 3.
- New dev-only source file → add to the "Includes/Excludes" list in section 2.
- New build flag → document it in section 2 and the workflow in section 4.
- New common mistake → add a row to section 5.

Commit message format for updates: `docs(build-workflow): ...`
