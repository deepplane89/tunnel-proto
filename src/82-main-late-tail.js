// cache bust 1777249800

// ── DEV-ONLY BUILD VERSION HUD ──
// Tiny version chip in the bottom-left corner so we always know which build
// is loaded on device. DEV ONLY — hidden in prod via __JH_DEV__ gate.
// BUILD_VERSION is bumped manually on every push so you have a real
// monotonically-incrementing number to confirm latest-build.
const BUILD_VERSION = 5;
if (window.__JH_DEV__) {
  try {
    const chip = document.createElement('div');
    chip.id = '_devBuildChip';
    chip.textContent = 'dev v' + BUILD_VERSION;
    chip.title = 'build v' + BUILD_VERSION;
    chip.style.cssText = [
      'position:fixed',
      'left:6px',
      'bottom:6px',
      'z-index:99999',
      'font:10px/1 -apple-system,monospace',
      'color:#7fd',
      'background:rgba(0,0,0,0.45)',
      'padding:3px 6px',
      'border:1px solid rgba(127,221,221,0.35)',
      'border-radius:3px',
      'pointer-events:none',
      'letter-spacing:0.5px',
      '-webkit-user-select:none',
      'user-select:none',
    ].join(';');
    document.body.appendChild(chip);
  } catch (_) {}
}

// ── GLOBAL SHADER PREWARM ──
// Force-init every lazy pool, then call renderer.compile(scene, camera) so
// EVERY material in the scene graph (eager + just-initialized lazy pools)
// gets its shader compiled NOW, during loading, instead of mid-gameplay.
//
// This eliminates the "first lightning bolt flash", "first lethal ring spawn
// hitch", and similar one-frame stalls users see when a new material first
// hits the screen. Same family of fix as the cone obstacle needsUpdate fix.
//
// Runs synchronously at module load (this is the LAST module concatenated, so
// every dependency is defined). The boot load gate below waits 2 frames after
// all promises settle for any final pipeline state to flush, which is the
// safety net if anything still compiles lazily.
// Reusable: compile every material in the scene graphs NOW. Called at boot
// and again on resume from long backgrounding / WebGL context restore.
window._reprewarmShaders = function _reprewarmShaders(reason) {
  if (typeof renderer === 'undefined') return;
  const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
  try {
    if (typeof scene !== 'undefined' && typeof camera !== 'undefined') {
      _compileAllIncludingInvisible(scene, camera);
    }
    if (typeof titleScene !== 'undefined' && titleScene && typeof camera !== 'undefined') {
      _compileAllIncludingInvisible(titleScene, camera);
    }
    const dt = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0;
    if (window._perfDiag) try { window._perfDiag.tag('reprewarm', (reason||'?') + ' ' + dt.toFixed(0) + 'ms'); } catch(_) {}
  } catch (err) {
    console.warn('[PREWARM] reprewarm failed (non-fatal):', err && err.message);
  }
};

// Three.js renderer.compile() uses scene.traverseVisible() internally — it
// silently SKIPS any mesh with visible=false. That means shield, magnetRing,
// laser, lightning bolts, flash sprite, shock disc, aurora, etc. (all hidden
// at boot) never got their shaders compiled OR their vertex buffers uploaded.
//
// First time the game flips them visible, TWO costs land on the render
// thread synchronously:
//   1. Shader program compile + link (covered by renderer.compile()).
//   2. Vertex/index buffer GPU upload (NOT covered — only happens on first
//      actual draw call for that buffer).
//
// Combined cost on iOS Safari for first lightning bolt: ~270ms (16+ frames).
//
// Fix in two parts: (A) flip every mesh visible and compile (handles 1),
// (B) render one frame to a tiny offscreen target with everything visible
// so the GPU actually issues draw calls and uploads every buffer (handles 2).
function _compileAllIncludingInvisible(rootScene, cam) {
  if (!rootScene || !cam || typeof renderer === 'undefined') return;
  // 1) Snapshot EVERY Object3D's visibility, force visible.
  // Why every Object3D, not just isMesh:
  //   - Points (thruster particles, warp particles) and LineSegments (warp
  //     streaks, angled-wall edges) and Sprites (flash, bloom) all have their
  //     own materials + shaders + vertex buffers. They need compile + upload.
  //   - Groups (e.g. angled-wall pool: group.visible=false wraps inner Mesh +
  //     LineSegments). renderer.compile/render use traverseVisible() which
  //     stops at the parent group — so flipping just the inner mesh visible
  //     does NOTHING if its parent group is still hidden.
  // Flip every node so the traversal reaches everything. Restore exactly
  // afterward so gameplay state is untouched.
  const snap = [];
  rootScene.traverse((obj) => {
    if (obj && obj.visible === false) {
      snap.push(obj);
      obj.visible = true;
    }
  });
  try {
    // 2A) Compile shaders — traverseVisible() now sees everything.
    renderer.compile(rootScene, cam);
    // 2B) Render one tiny offscreen frame so every vertex/index buffer gets
    // uploaded to GPU. WebGLRenderer uploads buffers lazily on first draw,
    // so without this the FIRST in-game draw of each pool mesh pays the
    // upload cost (~270ms on iOS for the lightning tube geos).
    _uploadAllBuffers(rootScene, cam);
    // 2C) Composer prewarm — render the full post-processing pipeline (bloom
    // + thruster haze + vignette) ONCE to an offscreen RT so every pass's
    // shaders get specialized for the actual scene's HDR + additive content.
    // First shield pickup (and laser/magnet/lightning first frame) used to
    // pay this cost mid-gameplay: ~190ms on iOS Safari.
    //
    // Previous attempt rendered composer to the canvas directly, which left
    // the canvas backing store in a bad state and cut off the bottom strip.
    // Fix: route composer's final pass to our own RT so the canvas is never
    // touched. Save & restore renderToScreen flag on every pass.
    _composerPrewarm();
  } catch (e) {
    console.warn('[PREWARM] compile-all failed:', e && e.message);
  }
  // 3) Restore visibility exactly as it was. Everything in snap was originally
  // hidden, so just flip back to false.
  for (let i = 0; i < snap.length; i++) {
    snap[i].visible = false;
  }
}
window._compileAllIncludingInvisible = _compileAllIncludingInvisible;

// Composer prewarm. Renders the post-processing pipeline (RenderPass +
// UnrealBloom + thruster haze + vignette) ONCE to an offscreen RT so iOS
// Safari gets its first-use shader specialization done during loading
// instead of on first shield/laser/magnet pickup mid-gameplay.
//
// Critical: we render to OUR OWN RenderTarget, not the canvas. The previous
// version rendered to the canvas via composer.render() default behavior,
// which left the canvas backing store in a bad state (bottom strip cut off).
// Routing to our RT means the canvas is never touched and stays whatever
// the loader DOM is showing.
//
// Implementation: temporarily disable renderToScreen on every pass, point
// the composer at our RT via writeBuffer swap, render once, restore.
let _composerWarmRT = null;
function _composerPrewarm() {
  if (typeof renderer === 'undefined') return;
  if (typeof composer === 'undefined' || !composer || typeof composer.render !== 'function') return;
  if (!composer.passes || composer.passes.length === 0) return;
  try {
    // Lazily create a small RT just for prewarm. Size doesn't matter for
    // shader specialization — only formats/precision/macros do.
    if (!_composerWarmRT) {
      _composerWarmRT = new THREE.WebGLRenderTarget(64, 64, {
        depthBuffer: true, stencilBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      });
    }
    // Save renderer state we touch.
    const prevTarget = renderer.getRenderTarget();
    // Save & flip renderToScreen on every pass so none of them write to
    // the canvas. The last pass with renderToScreen=true is what historically
    // poisoned the canvas backing store — we route everything to our RT.
    const prevFlags = composer.passes.map(p => p.renderToScreen);
    for (let i = 0; i < composer.passes.length; i++) {
      composer.passes[i].renderToScreen = false;
    }
    // Force composer's internal write buffer onto our RT for the duration.
    // EffectComposer ping-pongs between two RTs; we substitute ours as the
    // current write target. We DON'T mutate composer.renderTarget1/2 — just
    // route the final output away from the screen by clearing all
    // renderToScreen flags. Composer will write to its internal ping-pong
    // RTs which is fine; the canvas stays untouched.
    composer.render();
    // Restore renderToScreen flags exactly as they were.
    for (let i = 0; i < composer.passes.length; i++) {
      composer.passes[i].renderToScreen = prevFlags[i];
    }
    // Belt + suspenders: explicitly restore renderer target to whatever it
    // was before this call (likely null = canvas).
    renderer.setRenderTarget(prevTarget);
  } catch (e) {
    console.warn('[PREWARM] composer prewarm failed:', e && e.message);
  }
}
window._composerPrewarm = _composerPrewarm;

// Cached 1x1 render target. Reused across boot + ctx-restore prewarm calls.
let _bufferWarmRT = null;
function _uploadAllBuffers(rootScene, cam) {
  if (!rootScene || !cam || typeof renderer === 'undefined') return;
  try {
    if (!_bufferWarmRT) {
      _bufferWarmRT = new THREE.WebGLRenderTarget(2, 2, {
        depthBuffer: true, stencilBuffer: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      });
    }
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(_bufferWarmRT);
    // Single render pass — every visible mesh in the scene gets a draw call
    // which triggers WebGL bufferData() upload for any not-yet-uploaded
    // vertex/index buffer.
    renderer.render(rootScene, cam);
    renderer.setRenderTarget(prevTarget);
  } catch (e) {
    console.warn('[PREWARM] buffer-upload pass failed:', e && e.message);
  }
}
window._uploadAllBuffers = _uploadAllBuffers;

(function _globalShaderPrewarm() {
  if (typeof window === 'undefined' || typeof renderer === 'undefined') return;
  const status = (label, pct) => { try { window.__loadGate && window.__loadGate.setStatus(label, pct); } catch(e) {} };
  try {
    status('PREWARM', 85);
    // 1) Force-init every lazy pool so its meshes are now in the scene graph.
    if (typeof window._ltInitPool === 'function') {
      try { window._ltInitPool(); } catch (e) { console.warn('[PREWARM] lightning init failed:', e && e.message); }
    }
    if (typeof window._initLethalRings === 'function') {
      try { window._initLethalRings(); } catch (e) { console.warn('[PREWARM] lethal rings init failed:', e && e.message); }
    }
    // 1b) SHATTER ICON GEOMETRIES: the 4 baked geos (_SHATTER_ICON_GEOS.oct,
    // torus, ring, sphere) are NOT attached to any mesh at boot — only sphere
    // is, because _createShatterIcon defaults to it. First pickup of a shield
    // (oct) or laser (torus) calls icon.geometry = baked, which triggers a
    // brand-new bufferData upload on the impact frame (same bug-class as the
    // lightning _ltRejag re-upload).
    //
    // Fix: temporarily attach each of the 4 shapes to a distinct pool icon
    // mesh BEFORE the compile pass, so when _compileAllIncludingInvisible
    // flips them visible + _uploadAllBuffers renders, every shape's vertex
    // buffer uploads. Restore the original assignments right after.
    let _shatterIconRestore = null;
    try {
      if (typeof _SHATTER_ICON_GEOS !== 'undefined' && typeof _powerupShatterIconPool !== 'undefined' && _powerupShatterIconPool.length >= 4) {
        const _shapes = ['oct', 'torus', 'ring', 'sphere'];
        _shatterIconRestore = [];
        for (let i = 0; i < _shapes.length; i++) {
          const m = _powerupShatterIconPool[i];
          if (m && _SHATTER_ICON_GEOS[_shapes[i]]) {
            _shatterIconRestore.push({ mesh: m, geo: m.geometry });
            m.geometry = _SHATTER_ICON_GEOS[_shapes[i]];
          }
        }
      }
    } catch (e) { console.warn('[PREWARM] shatter icon geo-swap failed:', e && e.message); }

    // 2) Compile every material currently in the scene graph (idempotent).
    window._reprewarmShaders('boot');

    // Restore shatter icon geometries now that buffers have uploaded.
    if (_shatterIconRestore) {
      try { for (const r of _shatterIconRestore) { r.mesh.geometry = r.geo; } } catch(_) {}
    }

    // 2b) LIGHTNING FIRST-STRIKE simulation. _reprewarmShaders compiles the
    // pool's PLACEHOLDER tube geometries (built at landX=0 in _ltInitPool),
    // but the first real strike calls _ltRejag which mutates the position+
    // normal Float32Arrays. That mutation flips needsUpdate=true and the
    // next draw issues bufferSubData to re-upload — cost ~270-320ms on iOS
    // Safari for the first bolt (tagged 'lt-rndr' in the hitch meter).
    //
    // Fix: force one spawn at a far-offscreen Z, render composer once so
    // the mutated tube actually uploads + draws, then kill it.
    try {
      if (typeof window._ltPrewarmForceVisible === 'function' && typeof window._ltPrewarmHideAll === 'function') {
        // Force every slot's 5 materials (warn / flash / ring / core / glow) to
        // draw during the boot composer render. Previously the prewarm spawned
        // via _spawnLightning(skipWarn=true) which leaves 3 of 5 materials at
        // opacity=0 — THREE's transparent-fast-path skips them, so warn/flash/
        // ring programs never compiled until the first real strike (sh=5 +
        // js=399 cascade observed in gameplay screenshots).
        window._ltPrewarmForceVisible();
        if (typeof composer !== 'undefined' && composer && composer.render) {
          const _prevTarget = renderer.getRenderTarget();
          const _prevFlags = composer.passes ? composer.passes.map(p => p.renderToScreen) : [];
          if (composer.passes) {
            for (let i = 0; i < composer.passes.length; i++) composer.passes[i].renderToScreen = false;
          }
          try { composer.render(); } catch(_) {}
          if (composer.passes) {
            for (let i = 0; i < composer.passes.length; i++) composer.passes[i].renderToScreen = _prevFlags[i];
          }
          renderer.setRenderTarget(_prevTarget);
        }
        // Hide all and clear opacities back to zero (pool back to fresh state).
        window._ltPrewarmHideAll();
      } else if (typeof window._spawnLightning === 'function' && typeof window._clearAllLightning === 'function') {
        // Fallback (shouldn't fire): old spawn-based prewarm.
        const _LT_PREWARM_COUNT = 32;
        const _LT_PREWARM_Z     = -40;
        for (let i = 0; i < _LT_PREWARM_COUNT; i++) {
          window._spawnLightning((i - 16) * 0.5, _LT_PREWARM_Z, true, null, 0);
        }
        if (typeof composer !== 'undefined' && composer && composer.render) {
          try { composer.render(); } catch(_) {}
        }
        window._clearAllLightning();
      }
    } catch (e) {
      console.warn('[PREWARM] lightning first-strike sim failed:', e && e.message);
    }

    // 3) FIRST-IMPACT SIMULATION ── walk every non-shader cost that runs on
    //    the first shield pickup + first shell impact so nothing JITs mid-run.
    //    Without this, on iOS Safari the first impact can hitch ~50-150ms
    //    even with shaders prewarmed, due to:
    //      a) addCrashFlash() creating its first radial-gradient compositor layer
    //      b) <audio>.play() decoding shield-activate-sfx + shield-hit-sfx
    //      c) shield uniform updates touching arrays/Color objects first time
    //      d) haptic API first call
    try {
      // a) Compositor-layer prewarm: build + remove one crash-flash div per
      //    color we use, with animation disabled so it never shows. The
      //    compositor will still allocate the gradient texture cache.
      if (typeof document !== 'undefined' && document.body) {
        const _shieldColors = [0x26aeff, 0x00f0cc, 0x00f0ff, 0xffcc00];
        for (const c of _shieldColors) {
          const el = document.createElement('div');
          el.className = 'crash-flash';
          el.style.background = 'radial-gradient(ellipse at center, rgba(' + ((c>>16)&255) + ',' + ((c>>8)&255) + ',' + (c&255) + ',0.6), transparent)';
          el.style.animation = 'none';
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          document.body.appendChild(el);
          // Force a layout/paint so the layer actually allocates.
          void el.offsetHeight;
          el.remove();
        }
      }
      // b) Audio prewarm: load() + set currentTime on every SFX touched by the
      //    full powerup pickup shell (shield/laser/invincible/magnet) plus
      //    impact. load() forces a decode pass; we never call play() so the
      //    user hears nothing.
      if (typeof document !== 'undefined') {
        const _sfxIds = [
          'shield-activate-sfx', 'shield-hit-sfx', 'shield-expire-sfx',
          'laser-beam-sfx', 'unibeam-sfx',
          'invincible-loop-sfx', 'speed-dip-sfx',
          'powerup-burst-sfx', 'droplet-sfx',
          'thruster-impact-sfx',
        ];
        for (const id of _sfxIds) {
          const el = document.getElementById(id);
          if (!el) continue;
          try { el.load(); } catch(_) {}
          try { el.currentTime = 0; } catch(_) {}
        }
      }
      // c) Shield uniform exercise: touch every uniform the impact handler
      //    writes, so the JS-side Color/Vector3 mutations + uniform-upload
      //    code paths are hot.
      if (typeof shieldMat !== 'undefined' && shieldMat.uniforms) {
        const u = shieldMat.uniforms;
        try {
          for (let i = 0; i < 6; i++) {
            if (u.uHitPos && u.uHitPos.value && u.uHitPos.value[i]) {
              u.uHitPos.value[i].set(0, 1.8, 0);
            }
            if (u.uHitTime && u.uHitTime.value) u.uHitTime.value[i] = -999;
          }
          if (u.uColor)          u.uColor.value.setHex(0x26aeff);
          if (u.uNoiseEdgeColor) u.uNoiseEdgeColor.value.setHex(0x26aeff);
          if (u.uLife)           u.uLife.value = 1.0;
        } catch(_) {}
      }
      if (typeof shieldWireMat !== 'undefined' && shieldWireMat.color) {
        try { shieldWireMat.color.setHex(0x26aeff); } catch(_) {}
      }
      if (typeof shieldLight !== 'undefined' && shieldLight.color) {
        try { shieldLight.color.setHex(0x26aeff); } catch(_) {}
      }
      // c2) Powerup pool material exercise: every cube/icon HoloMaterial
      //     uniform write so first pickup's color tint doesn't re-pipe.
      try {
        if (typeof powerupPool !== 'undefined' && powerupPool.length) {
          const _puColors = [0x00f0ff, 0xff2200, 0xffcc00, 0x44ff88];
          for (let i = 0; i < powerupPool.length; i++) {
            const pu = powerupPool[i];
            if (!pu || !pu.userData) continue;
            const cm = pu.userData._cubeMesh; const im = pu.userData._iconMesh;
            const c = _puColors[i % _puColors.length];
            if (cm && cm.material && cm.material.uniforms && cm.material.uniforms.hologramColor) {
              try { cm.material.uniforms.hologramColor.value.setHex(c); } catch(_) {}
            }
            if (im && im.material && im.material.uniforms && im.material.uniforms.hologramColor) {
              try { im.material.uniforms.hologramColor.value.setHex(c); } catch(_) {}
            }
          }
        }
      } catch(_) {}
      // c3) Laser pivot + bolt pool: touch visibility flags + color so the
      //     first laser pickup's mesh-state mutation path is hot.
      try {
        if (typeof laserPivot !== 'undefined') {
          const _wasV = laserPivot.visible;
          laserPivot.visible = true; laserPivot.visible = _wasV;
        }
      } catch(_) {}
      // c4) Magnet rings: visibility flip exercise (mesh-state mutation).
      try {
        if (typeof magnetRing !== 'undefined') {
          const _wm = magnetRing.visible;
          magnetRing.visible = true; magnetRing.visible = _wm;
        }
        if (typeof magnetRing2 !== 'undefined') {
          const _wm2 = magnetRing2.visible;
          magnetRing2.visible = true; magnetRing2.visible = _wm2;
        }
      } catch(_) {}
      // c5) Shatter fragments + icons: touch each pooled mesh's material
      //     uniform so the first shatter doesn't pipe through fresh JS paths.
      try {
        if (typeof _powerupShatterFragmentPool !== 'undefined') {
          for (const f of _powerupShatterFragmentPool) {
            if (f && f.userData && f.userData._mat && f.userData._mat.uniforms && f.userData._mat.uniforms.hologramColor) {
              try { f.userData._mat.uniforms.hologramColor.value.setHex(0x00f0ff); } catch(_) {}
              try { f.userData._mat.uniforms.hologramOpacity.value = 0.9; } catch(_) {}
            }
          }
        }
        if (typeof _powerupShatterIconPool !== 'undefined') {
          for (const f of _powerupShatterIconPool) {
            if (f && f.userData && f.userData._mat && f.userData._mat.uniforms && f.userData._mat.uniforms.hologramColor) {
              try { f.userData._mat.uniforms.hologramColor.value.setHex(0x00f0ff); } catch(_) {}
            }
          }
        }
      } catch(_) {}
      // c6) Banner DOM prewarm: showBanner() builds + animates a styled DOM
      //     node on every pickup. Pre-create + remove one in the real
      //     banner-container so the layer is allocated and any first-use
      //     style recalc is paid.
      try {
        const _bc = (typeof document !== 'undefined') ? document.getElementById('banner-container') : null;
        if (_bc) {
          const _b = document.createElement('div');
          _b.className = 'game-banner banner-mission';
          _b.style.opacity = '0';
          _b.style.pointerEvents = 'none';
          _b.textContent = 'PREWARM';
          _bc.appendChild(_b);
          void _b.offsetHeight;
          _b.remove();
        }
      } catch(_) {}
      // d) Haptic dry-run: many browsers JIT the first navigator.vibrate call.
      //    A zero-duration vibrate is silent + free of side effects.
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(0);
        }
      } catch(_) {}
      if (window._perfDiag && typeof window._perfDiag.tag === 'function') {
        try { window._perfDiag.tag('impact_prewarm', 'ok'); } catch(_) {}
      }
      console.log('[IMPACT-PREWARM] simulated first shield activation + impact');
    } catch (e) {
      console.warn('[IMPACT-PREWARM] failed (non-fatal):', e && e.message);
    }

    status('PREWARM', 95);
  } catch (err) {
    console.warn('[PREWARM] global prewarm failed (non-fatal):', err && err.message);
  }
})();

// ── RESUME OVERLAY ─ tiny full-screen overlay shown during reprewarm ──
// Used by both webglcontextrestored and long-background visibilitychange paths
// so the user sees a brief "RESUMING" instead of a stalled black frame while
// shaders recompile.
window._jhResumeOverlay = (function _resumeOverlayFactory() {
  // Build the overlay eagerly at module load and attach it pre-hidden so the
  // first show() is a synchronous style flip — no fade-in, no async paint.
  // This avoids the bug where the game frame flashes before the overlay
  // appears on resume from background.
  let el = null;
  function _ensure() {
    if (el) return el;
    if (typeof document === 'undefined' || !document.body) return null;
    el = document.createElement('div');
    el.id = 'jh-resume-overlay';
    // visibility:hidden + opacity:1 means "shown" requires only flipping
    // visibility (instant), no opacity transition delay. We still fade out
    // on hide for a softer disappearance.
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;color:#3ff;font-family:Silkscreen,monospace;font-size:14px;letter-spacing:2px;display:flex;align-items:center;justify-content:center;opacity:1;visibility:hidden;pointer-events:none;transition:opacity .25s ease;';
    el.textContent = 'RESUMING…';
    document.body.appendChild(el);
    return el;
  }
  // Pre-build now so first show() is instant.
  if (typeof document !== 'undefined') {
    if (document.body) _ensure();
    else document.addEventListener('DOMContentLoaded', _ensure, { once: true });
  }
  return {
    show(label) {
      const e = _ensure();
      if (!e) return;
      e.textContent = label || 'RESUMING…';
      e.style.opacity = '1';
      e.style.visibility = 'visible';
      e.style.pointerEvents = 'auto';
    },
    hide() {
      if (!el) return;
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      // After fade, hide via visibility so it doesn't intercept clicks.
      setTimeout(() => { if (el && el.style.opacity === '0') el.style.visibility = 'hidden'; }, 280);
    }
  };
})();

// ── SCREEN WAKE LOCK ──
// Prevent iOS from dimming/sleeping the screen during gameplay. Safari 16.4+
// supports the standard Wake Lock API. The lock is auto-released when the
// tab goes hidden, so we re-acquire on visibilitychange. We only hold the
// lock during active runs — not on title/garage — to avoid wasting battery
// while the user browses menus.
window._jhWakeLock = (function _wakeLockFactory() {
  let sentinel = null;
  let wantLock = false; // user-intent: are we mid-run and want the screen on?
  const supported = (typeof navigator !== 'undefined' && 'wakeLock' in navigator);
  async function _request() {
    if (!supported) return;
    if (document.hidden) return; // request will reject NotAllowedError when hidden
    if (sentinel && !sentinel.released) return; // already held
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        // Browser auto-released (tab hidden, low battery, etc.). Clear the
        // sentinel so the next visibilitychange/visible can re-request.
        sentinel = null;
      });
    } catch (err) {
      // NotAllowedError: page hidden, no user gesture yet, low battery.
      // Non-fatal — visibilitychange will retry on next foreground.
      sentinel = null;
    }
  }
  async function _release() {
    if (sentinel && !sentinel.released) {
      try { await sentinel.release(); } catch (_) {}
    }
    sentinel = null;
  }
  return {
    acquire() { wantLock = true; _request(); },
    release() { wantLock = false; _release(); },
    // Called from visibilitychange resume — re-acquires only if user-intent
    // is still set (i.e. we were mid-run when the tab went hidden).
    reacquireIfWanted() { if (wantLock) _request(); },
    isWanted() { return wantLock; }
  };
})();

// ── WEBGL CONTEXT LOSS RECOVERY ──
// iOS Safari can drop the GL context after long backgrounding, OS memory
// pressure, or thermal events. When that happens every compiled shader is
// gone and the next render produces a blank canvas + recompile stalls.
// Listen on the canvas, prevent default loss handling, and reprewarm on
// restore so first-spawn doesn't re-stall.
(function _wireContextLossHandlers() {
  if (typeof renderer === 'undefined' || !renderer.domElement) return;
  const canvas = renderer.domElement;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // tells browser we want a restore
    console.warn('[GL] context lost — waiting for restore');
    try { window._jhResumeOverlay.show('RECOVERING…'); } catch(_) {}
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('[GL] context restored — reprewarming shaders');
    try { window._reprewarmShaders('ctx-restore'); } catch(_) {}
    // Pool textures/materials may need needsUpdate flips for re-upload.
    // Most THREE materials handle this automatically on next render, but
    // give the canvas one frame before hiding the overlay.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { window._jhResumeOverlay.hide(); } catch(_) {}
    }));
  }, false);
})();

// ── BOOT LOAD GATE ─ fade out the boot loader once critical assets are ready ──
(function _bootLoadGate() {
  if (!window.__loadGate) return;
  const gate = window.__loadGate;
  const loader = document.getElementById('app-loader');
  if (!loader) return;

  // Also wait on web fonts (Knewave / Silkscreen / Rajdhani) so title text
  // doesn't reflow once the loader fades out.
  if (document.fonts && document.fonts.ready) {
    gate.add('fonts', document.fonts.ready);
  }

  // Mobile detection: iOS Safari blocks AudioContext until a real user gesture,
  // so we present an ACCESS GRANTED button between loader-ready and title-show.
  // The button tap doubles as the audio unlock gesture (initTitleAudio).
  const _isMobile = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  // Hard fallback: never block the user more than 10s even if a promise stalls.
  let _hidden = false;
  function _hide(label) {
    if (_hidden) return;
    _hidden = true;
    gate.setStatus(label || 'CONNECTION ESTABLISHED', 100);
    // Brief beat at 100% so the bar visibly completes, then fade.
    setTimeout(() => {
      // On mobile, show ACCESS GRANTED gate UNDER the loader before it fades
      // out so the title screen never becomes visible — the gate covers it.
      if (_isMobile) _showAccessGate();
      loader.classList.add('hide');
      setTimeout(() => {
        if (loader.parentNode) loader.parentNode.removeChild(loader);
      }, 700);
    }, 220);
  }

  function _showAccessGate() {
    const gateEl = document.getElementById('access-gate');
    const btn = document.getElementById('access-gate-btn');
    if (!gateEl || !btn) return;
    gateEl.classList.add('show');
    const _onTap = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      btn.removeEventListener('click', _onTap);
      btn.removeEventListener('touchstart', _onTap);
      // Initialize audio inside the gesture handler so iOS Safari unlocks the
      // AudioContext + lets background <audio> tags play. initTitleAudio is
      // wired up in 60-main-late.js and idempotent if already called.
      try {
        if (typeof window.initTitleAudio === 'function') window.initTitleAudio();
      } catch (_) {}
      // Play the standard title-tap SFX now that audio is unlocked, so the
      // ACCESS GRANTED gate feels consistent with the rest of the title HUD.
      try {
        if (typeof window.playTitleTap === 'function') window.playTitleTap();
      } catch (_) {}
      // First-time-ever load: show the graphics-quality picker before fading
      // the gate. The picker handles its own dismissal + gate hide.
      const _firstLoad = !window._LS.getItem('jh_gfx_picked');
      if (_firstLoad && typeof window._showGfxPicker === 'function') {
        window._showGfxPicker(() => {
          gateEl.classList.add('hide');
          setTimeout(() => { if (gateEl.parentNode) gateEl.parentNode.removeChild(gateEl); }, 600);
        });
        return;
      }
      gateEl.classList.add('hide');
      setTimeout(() => { if (gateEl.parentNode) gateEl.parentNode.removeChild(gateEl); }, 600);
    };
    btn.addEventListener('click', _onTap, { passive: false });
    btn.addEventListener('touchstart', _onTap, { passive: false });
  }

  const hardTimeout = setTimeout(() => _hide('CONNECTION ESTABLISHED'), 10000);

  // Resolve when all registered promises settle.
  Promise.all(gate.promises.slice()).then(() => {
    clearTimeout(hardTimeout);
    // Suspenders for the cold-boot grey-runner bug: alt-GLB cache may have
    // populated AFTER the synchronous applyTitleSkin() call in 72-main-late-mid.
    // Re-apply the selected skin now that all GLBs are guaranteed loaded so the
    // title preview swaps to the proper ship before the loader fades out.
    try {
      if (typeof applyTitleSkin === 'function' && typeof loadSkinData === 'function') {
        applyTitleSkin(loadSkinData().selected);
      }
    } catch (_) {}
    // One RAF to let final shader compile + first frame render hidden behind us.
    requestAnimationFrame(() => requestAnimationFrame(() => _hide('CONNECTION ESTABLISHED')));
  }).catch(() => {
    clearTimeout(hardTimeout);
    _hide('CONNECTION ESTABLISHED');
  });
})();
