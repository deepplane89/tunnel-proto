// ═══════════════════════════════════════════════════════════════════════════
//  BANK WATER EFFECT — v1 (cheap textured quad backend)
//
//  When the ship banks hard over the water at speed, a thin elongated white
//  pressure band appears on the water below the LOW side of the ship — the
//  side the ship is leaning toward. Reads as reflective compression / shear,
//  not a splash.
//
//  ── ARCHITECTURE ──────────────────────────────────────────────────────────
//  Two layers, intentionally decoupled:
//
//    1. STATE LAYER  (getBankWaterEffectState)
//       Pure function. Takes ship transform + gameplay inputs, returns a
//       plain state object: { position, forward, right, intensity, width,
//       length, sideSign, opacity }. No Three.js objects, no rendering.
//       This is the contract the visual layer consumes.
//
//    2. VISUAL LAYER (BankWaterEffectVisual)
//       Swappable. v1 = textured quad on the water plane. v2 (future) =
//       low-res render-target distortion pass. Both will consume the SAME
//       state object, so swapping backends never touches gameplay code.
//
//  ── FUTURE V2 UPGRADE PATH ────────────────────────────────────────────────
//  v2 architecture (NOT implemented here, just designed for):
//    - Allocate a small (e.g. 256×256) RGBA WebGLRenderTarget on init.
//    - Each frame: render only the bank quads into that target with an
//      orthographic top-down camera anchored to the ship XZ.
//    - The Water material (mirrorMesh) samples that target as a distortion
//      map in its uv lookup — water surface normals get displaced where
//      the band sits, producing real refractive shear instead of painted
//      white.
//    - The STATE layer below stays untouched. Only the visual class swaps:
//        class BankWaterEffectVisualDistortion extends BankWaterEffectVisual
//      with an override on update(state) that writes into the render target
//      + injects the sampler into the Water material's onBeforeCompile.
//    - Toggle via `window._bankWaterEffectMode = 'cheap' | 'distortion'`.
//
//  ── INTEGRATION POINTS ────────────────────────────────────────────────────
//    init:    BankWaterEffect.init(scene)                — call once after
//                                                          scene is created
//    update:  BankWaterEffect.update(inputs, dt)         — call every frame
//             inputs = {
//               shipPosition: THREE.Vector3,
//               shipQuaternion: THREE.Quaternion,
//               rollAngle: number   (signed radians; ±0.04..±0.30 typical)
//               speed: number,
//               maxSpeed: number,
//               waterY: number,
//               overWater: boolean
//             }
//    enable/disable: window._bankWaterEffectEnabled = true|false
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  if (typeof THREE === 'undefined') return;

  // ── TUNING ──────────────────────────────────────────────────────────────
  // All knobs in one place so v2 inherits them unchanged.
  const TUNING = {
    // Activation thresholds — only fires near MAX steering bank (~0.52 rad
    // / 30°, the steerBankRadMax cap). Both knobs in radians.
    bankThresholdLow:    0.42,   // ~24° — intensity starts ramping
    bankThresholdHigh:   0.52,   // ~30° — intensity saturates here
    // Anchor: band's bright HEAD sits AT the rear-wingtip world point,
    // resolved from the ship geometry bbox (auto, no magic numbers).
    // Tail trails back along ship -forward.
    bandLength:          4.5,    // world units (long axis)
    bandWidth:           0.14,   // world units (short axis)
    bandLengthBoost:     2.0,    // extra length added at full speed
    // Texture bright peak sits ~20% down its V axis. To land peak AT the
    // wingtip we shift center forward by (0.5 - 0.20) * length along head dir.
    headBias:            0.30,
    waterClearance:      0.005,  // flush w/ water (5mm above; just enough to avoid z-fight)
    // Push each strip outward along ship-right by this much beyond the auto-
    // resolved wingtip X. Small nudge so it reads as "just outside" the wing.
    lateralPush:         0.10,
    peakOpacity:         0.65,
    attackRate:          10,
    releaseRate:         4,
    rotateWithShip:      true,   // align long axis with ship forward
    // ── Artistry knobs ──────────────────────────────────────────────────
    // Slight cyan tint reads as moisture / refraction off pure white.
    tintColor:           0xeaf8ff,
    // Lower-layer parallax: wider, dimmer, scrolls slower → reads as foam +
    // underbody disturbance separate from the bright pressure head.
    underWidthMul:       2.2,
    underLengthMul:      1.10,
    underOpacityMul:     0.45,
    underScrollMul:      0.55,   // slower drift
    // UV scroll rate: world-units of strip-length per second at FULL speed.
    // Drift is along the tail (positive V → from head toward tail).
    scrollSpeed:         6.0,
  };

  // ── helpers ────────────────────────────────────────────────────────────
  const _clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const _smoothstep = (a, b, x) => {
    const t = _clamp01((x - a) / Math.max(1e-6, b - a));
    return t * t * (3 - 2 * t);
  };

  // ═════════════════════════════════════════════════════════════════════════
  //  STATE LAYER — pure logic, no rendering.
  //  Auto-resolves rear-wingtip points from ship geometry bbox (cached).
  // ═════════════════════════════════════════════════════════════════════════
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _wingtipL = new THREE.Vector3();
  const _wingtipR = new THREE.Vector3();
  const _bandPosL = new THREE.Vector3();
  const _bandPosR = new THREE.Vector3();
  const _FORWARD_LOCAL = new THREE.Vector3(0, 0, -1);
  const _RIGHT_LOCAL   = new THREE.Vector3(1, 0,  0);

  // ── Wingtip resolution from ship geometry bbox ──────────────────────────
  // Unions every visible-mesh local bbox into a single bbox in shipGroup-local
  // coords. Rear wingtip corners are (±bbox.max.x, midY, bbox.max.z). Ship
  // faces -Z so +Z IS the rear; widest |X| at the rear = wingtip. No magic
  // constants, survives model edits. Cached after first successful resolve.
  let _wingtipLocalL = null;
  let _wingtipLocalR = null;
  const _tmpBox     = new THREE.Box3();
  const _tmpMeshBox = new THREE.Box3();
  const _tmpInv     = new THREE.Matrix4();
  function _resolveWingtips(shipGroup) {
    if (_wingtipLocalL && _wingtipLocalR) return true;
    if (!shipGroup) return false;
    _tmpBox.makeEmpty();
    let any = false;
    shipGroup.updateMatrixWorld(true);
    _tmpInv.copy(shipGroup.matrixWorld).invert();
    shipGroup.traverse(obj => {
      if (!obj.isMesh || !obj.geometry) return;
      if (!obj.visible) return;
      if (obj.userData && obj.userData._excludeFromBounds) return;
      // Skip non-ship meshes parented to shipGroup: shields, magnet rings,
      // exhaust fire/underlight halos, lights, etc.
      if (/shield|magnet|fire|underlight|aura|halo|light/i.test(obj.name || '')) return;
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      _tmpMeshBox.copy(obj.geometry.boundingBox);
      obj.updateMatrixWorld(true);
      _tmpMeshBox.applyMatrix4(obj.matrixWorld); // → world
      _tmpMeshBox.applyMatrix4(_tmpInv);         // → shipGroup-local
      _tmpBox.union(_tmpMeshBox);
      any = true;
    });
    if (!any || _tmpBox.isEmpty()) return false;
    const midY = (_tmpBox.min.y + _tmpBox.max.y) * 0.5;
    _wingtipLocalR = new THREE.Vector3( _tmpBox.max.x, midY, _tmpBox.max.z);
    _wingtipLocalL = new THREE.Vector3(-_tmpBox.max.x, midY, _tmpBox.max.z);
    return true;
  }

  function getBankWaterEffectState(inputs) {
    const { shipGroup, rollAngle, speed, maxSpeed, waterY, overWater } = inputs;
    const ready = _resolveWingtips(shipGroup);

    _fwd  .copy(_FORWARD_LOCAL).applyQuaternion(shipGroup.quaternion);
    _right.copy(_RIGHT_LOCAL  ).applyQuaternion(shipGroup.quaternion);

    const absBank = Math.abs(rollAngle);
    const bankStrength = _smoothstep(
      TUNING.bankThresholdLow,
      TUNING.bankThresholdHigh,
      absBank
    );
    const speedFactor = _clamp01((speed || 0) / Math.max(0.001, maxSpeed || 1));
    const intensity   = (overWater && ready ? 1 : 0) * bankStrength * speedFactor;
    // rollAngle sign convention: banking RIGHT (hold right) rolls the ship
    // so its right wing dips DOWN → rollAngle is NEGATIVE. The inside of the
    // turn = the dipping side. So sideSign = -sign(rollAngle).
    const sideSign    = -Math.sign(rollAngle) || 0;
    const length      = TUNING.bandLength + TUNING.bandLengthBoost * speedFactor;

    // Resolve both wingtip world positions (cheap: 1 matrix4×vec3 each).
    if (ready) {
      _wingtipR.copy(_wingtipLocalR); shipGroup.localToWorld(_wingtipR);
      _wingtipL.copy(_wingtipLocalL); shipGroup.localToWorld(_wingtipL);
    } else {
      _wingtipR.copy(shipGroup.position);
      _wingtipL.copy(shipGroup.position);
    }

    // Place band center so the texture's bright peak (at 20% of V) lands AT
    // the wingtip. Shift backward along ship -forward by (0.5 - 0.20)*length,
    // and push outward along ship-right so the strip clears the wing visually.
    const centerOffset = -length * TUNING.headBias;
    const lat = TUNING.lateralPush;
    _bandPosR.copy(_wingtipR);
    _bandPosR.x += _fwd.x * centerOffset + _right.x * lat;
    _bandPosR.z += _fwd.z * centerOffset + _right.z * lat;
    _bandPosR.y  = waterY + TUNING.waterClearance;
    _bandPosL.copy(_wingtipL);
    _bandPosL.x += _fwd.x * centerOffset - _right.x * lat;
    _bandPosL.z += _fwd.z * centerOffset - _right.z * lat;
    _bandPosL.y  = waterY + TUNING.waterClearance;

    return {
      positionL: _bandPosL,
      positionR: _bandPosR,
      forward:   _fwd,
      right:     _right,
      intensity, sideSign,
      width:  TUNING.bandWidth,
      length,
      opacity: intensity * TUNING.peakOpacity,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  VISUAL LAYER — v1 cheap textured quad.
  //  Two persistent meshes (one per side); only the one on the low-side
  //  fades in. Quad lies flat over water. Long axis aligned to world +Z
  //  by default (matches game's mostly-forward camera path; cheap).
  // ═════════════════════════════════════════════════════════════════════════

  // Shared geometry + noise texture across both strips (one allocation each).
  let _sharedGeo = null;
  let _sharedNoise = null;
  const _tmpEuler = new THREE.Euler();

  // ── Procedural noise texture ───────────────────────────────────────────────
  // 64×64 grayscale noise tiled ×2 → used by the fragment shader for UV warp
  // and dissolve. ~4 KB VRAM. One upload, sampled twice per fragment at
  // different scroll rates for parallax (no obvious repeat).
  function _buildNoiseTexture() {
    const SZ = 64;
    const c = document.createElement('canvas');
    c.width = SZ; c.height = SZ;
    const g = c.getContext('2d');
    const img = g.createImageData(SZ, SZ);
    // Two-octave value-noise sampled by averaging 4 random fields with bilinear-
    // ish smoothing. Cheap and good enough — we're not doing photorealism.
    const fine   = new Float32Array(SZ * SZ);
    const coarse = new Float32Array(SZ * SZ);
    for (let i = 0; i < SZ * SZ; i++) fine[i]   = Math.random();
    // Coarse: 16×16 stretched up to 64×64 for low-freq variation.
    const CSZ = 16;
    const coarseSrc = new Float32Array(CSZ * CSZ);
    for (let i = 0; i < CSZ * CSZ; i++) coarseSrc[i] = Math.random();
    for (let y = 0; y < SZ; y++) {
      for (let x = 0; x < SZ; x++) {
        const cx = (x / SZ) * CSZ, cy = (y / SZ) * CSZ;
        const ix = Math.floor(cx), iy = Math.floor(cy);
        const fx = cx - ix,        fy = cy - iy;
        const i00 = coarseSrc[(iy            ) * CSZ + (ix            ) % CSZ];
        const i10 = coarseSrc[(iy            ) * CSZ + (ix + 1        ) % CSZ];
        const i01 = coarseSrc[((iy + 1) % CSZ) * CSZ + (ix            ) % CSZ];
        const i11 = coarseSrc[((iy + 1) % CSZ) * CSZ + (ix + 1        ) % CSZ];
        const a = i00 * (1 - fx) + i10 * fx;
        const b = i01 * (1 - fx) + i11 * fx;
        coarse[y * SZ + x] = a * (1 - fy) + b * fy;
      }
    }
    for (let i = 0; i < SZ * SZ; i++) {
      const v = (fine[i] * 0.4 + coarse[i] * 0.6) * 255 | 0;
      img.data[i * 4    ] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  // ── Stylized wake ShaderMaterial ──────────────────────────────────────
  // Everything procedural: head→tail gradient (V), cross-strip feather (U),
  // dual-octave panned noise distortion, step-cutoff foam edge, dissolve at
  // the tail. No main texture sample — only the noise.
  // V=0 is HEAD (forward of ship). V=1 is TAIL.
  const _WAKE_VS = `
    varying vec2 vUv;
    uniform float uConeShape;   // 0 = rectangle, 1 = strong cone
    void main() {
      vUv = uv;
      // Narrow the HEAD, widen the TAIL: lerp local X around 0 toward 0 as V→0.
      // PlaneGeometry has uv in [0,1]; position.x in [-0.5,0.5].
      float taper = mix(0.45, 1.0, uv.y);   // head 45% width, tail full width
      taper = mix(1.0, taper, uConeShape);
      vec3 p = position;
      p.x *= taper;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;
  const _WAKE_FS = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uNoise;
    uniform float uTime;
    uniform float uOpacity;
    uniform float uScroll;     // V-units of pan per second (mapped from speed)
    uniform float uIntensity;  // 0…1 bank strength (drives dissolve threshold)
    uniform vec3  uTint;
    void main() {
      // Cross-strip feather (U): bright down the centerline, soft on long edges.
      float feather = smoothstep(0.0, 0.35, vUv.x) * smoothstep(0.0, 0.35, 1.0 - vUv.x);

      // Head→tail base profile: bright peak near V=0.15, long fade to V=1.
      float head    = smoothstep(0.00, 0.18, vUv.y);
      float tail    = smoothstep(1.00, 0.18, vUv.y);
      float profile = head * tail;

      // Two-octave panned noise. Octave A: fast scroll, fine UV. Octave B:
      // slower scroll, coarser UV. Their sum gives a non-repeating shimmer.
      float panA = uTime * uScroll;
      float panB = uTime * uScroll * 0.55;
      float nA = texture2D(uNoise, vec2(vUv.x * 1.4, vUv.y * 1.5 + panA      )).r;
      float nB = texture2D(uNoise, vec2(vUv.x * 0.7 - 0.13, vUv.y * 0.8 - panB)).r;
      float n  = (nA * 0.55 + nB * 0.45);

      // Sine-wave foam fingers: classic stylized water trick. Bright lines
      // that scroll along V and get distorted by the noise above.
      float fingers = sin((vUv.y - uTime * uScroll * 0.6) * 22.0 + n * 6.2832);
      fingers = smoothstep(0.55, 0.95, fingers);   // crisp bright bands

      // Edge dissolve: step the noise against the profile so the strip's
      // boundary frays instead of being a clean rectangle.
      float dissolveThresh = mix(0.65, 0.15, uIntensity);  // strong bank = less erosion
      float dissolve = smoothstep(dissolveThresh - 0.10, dissolveThresh + 0.05, n + profile * 0.6);

      // Compose: base = profile * feather, plus fingers, masked by dissolve.
      float alpha = (profile * feather) * dissolve;
      // Fingers add brightness on top, modulated by feather so they fade at edges.
      float bright = alpha + fingers * feather * profile * 0.85;

      gl_FragColor = vec4(uTint * (0.65 + bright * 0.6), bright * uOpacity);
    }
  `;

  function _makeMaterial(noiseTex, tintHex) {
    const tint = new THREE.Color(tintHex);
    return new THREE.ShaderMaterial({
      vertexShader:   _WAKE_VS,
      fragmentShader: _WAKE_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uNoise:     { value: noiseTex },
        uTime:      { value: 0 },
        uOpacity:   { value: 0 },
        uScroll:    { value: 0.2 },
        uIntensity: { value: 0 },
        uConeShape: { value: 0.65 },
        uTint:      { value: new THREE.Vector3(tint.r, tint.g, tint.b) },
      },
    });
  }

  class BankWaterEffectVisual {
    constructor() {
      if (!_sharedGeo)   _sharedGeo   = new THREE.PlaneGeometry(1, 1);
      if (!_sharedNoise) _sharedNoise = _buildNoiseTexture();

      this._matL = _makeMaterial(_sharedNoise, TUNING.tintColor);
      this._matR = _makeMaterial(_sharedNoise, TUNING.tintColor);

      const make = (mat) => {
        const m = new THREE.Mesh(_sharedGeo, mat);
        m.rotation.x = -Math.PI / 2;     // flat on water
        m.visible = false;
        m.renderOrder = 8;
        m.frustumCulled = false;
        return m;
      };
      this.meshL = make(this._matL);
      this.meshR = make(this._matR);
      this._opaL = 0;
      this._opaR = 0;
      this._time = 0;
    }

    addTo(scene) {
      scene.add(this.meshL);
      scene.add(this.meshR);
    }

    // Consumes the state object from getBankWaterEffectState().
    update(state, dt) {
      // Per-side target opacity: only the bank-DOWN side shows.
      const targetR = state.sideSign > 0 ? state.opacity : 0;
      const targetL = state.sideSign < 0 ? state.opacity : 0;

      // Smooth: fast attack, slow release — pressure ramps in, eases out.
      const attack  = Math.min(1, dt * TUNING.attackRate);
      const release = Math.min(1, dt * TUNING.releaseRate);
      this._opaR += (targetR - this._opaR) * (targetR > this._opaR ? attack : release);
      this._opaL += (targetL - this._opaL) * (targetL > this._opaL ? attack : release);
      this._time += dt;

      // Each strip sits under its own rear-wingtip (auto-resolved from ship
      // geometry bbox in the state layer). Only one is visible at a time.
      this.meshR.position.copy(state.positionR);
      this.meshL.position.copy(state.positionL);
      this.meshR.scale.set(state.width, state.length, 1);
      this.meshL.scale.set(state.width, state.length, 1);

      if (TUNING.rotateWithShip) {
        const yaw = Math.atan2(state.forward.x, state.forward.z);
        _tmpEuler.set(-Math.PI / 2, yaw, 0, 'YXZ');
        this.meshR.quaternion.setFromEuler(_tmpEuler);
        this.meshL.quaternion.copy(this.meshR.quaternion);
      }

      // Shader uniforms: time, per-side opacity, intensity, speed-driven scroll.
      const uR = this._matR.uniforms;
      const uL = this._matL.uniforms;
      uR.uTime.value = uL.uTime.value = this._time;
      uR.uOpacity.value   = this._opaR;
      uL.uOpacity.value   = this._opaL;
      uR.uIntensity.value = uL.uIntensity.value = state.intensity;
      // uScroll scales with bank intensity — stronger turn, faster shimmer.
      const scroll = TUNING.scrollSpeed * (0.4 + 0.6 * state.intensity);
      uR.uScroll.value = uL.uScroll.value = scroll;

      this.meshR.visible = this._opaR > 0.01;
      this.meshL.visible = this._opaL > 0.01;
    }

    hide() {
      this.meshR.visible = false;
      this.meshL.visible = false;
      this._opaR = 0;
      this._opaL = 0;
      this._matR.uniforms.uOpacity.value = 0;
      this._matL.uniforms.uOpacity.value = 0;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  FACADE — single entry point exposed to game code.
  // ═════════════════════════════════════════════════════════════════════════
  const BankWaterEffect = {
    _visual: null,
    _ready: false,

    // init(scene) — or init(scene, renderer, camera) to prewarm the shader
    // compile and avoid a first-bank hitch.
    init(scene, renderer, camera) {
      if (this._ready) return;
      this._visual = new BankWaterEffectVisual();
      this._visual.addTo(scene);
      this._ready = true;
      try {
        if (renderer && camera && renderer.compile) {
          this._visual.meshL.visible = true;
          this._visual.meshR.visible = true;
          renderer.compile(scene, camera);
          this._visual.meshL.visible = false;
          this._visual.meshR.visible = false;
        }
      } catch (e) { /* prewarm is best-effort */ }
    },

    // Single per-frame call. Caller passes the inputs bag described in the
    // header. dt is seconds since last frame.
    update(inputs, dt) {
      if (!this._ready) return;
      if (window._bankWaterEffectEnabled === false) {
        this._visual.hide();
        if (window.BankWaterHiss) window.BankWaterHiss.update(0, dt);
        return;
      }
      // Gate: must be over water AND mirror visible AND not paused.
      if (!inputs.overWater) {
        this._visual.hide();
        if (window.BankWaterHiss) window.BankWaterHiss.update(0, dt);
        return;
      }
      const state = getBankWaterEffectState(inputs);
      this._visual.update(state, dt);
      // Hiss gain follows visual intensity unless caller asks for sfx-mute,
      // in which case force the hiss gain to 0 (visual keeps animating).
      if (window.BankWaterHiss) {
        const _hissIntensity = inputs.sfxMuted ? 0 : state.intensity;
        window.BankWaterHiss.update(_hissIntensity, dt);
      }
    },

    // Power-users: swap the visual backend (v2 distortion render-target etc).
    setVisual(visual) {
      if (this._visual) {
        this._visual.hide();
      }
      this._visual = visual;
      this._ready = !!visual;
    },

    // Direct access for tuning panels / debugging.
    getTuning() { return TUNING; },
  };

  // Default-on; gameplay flips off when leaving water mode.
  if (typeof window._bankWaterEffectEnabled === 'undefined') {
    window._bankWaterEffectEnabled = true;
  }
  window.BankWaterEffect = BankWaterEffect;
})();
