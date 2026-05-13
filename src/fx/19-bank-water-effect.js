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
    waterClearance:      0.02,
    // Push each strip outward along ship-right by this much beyond the auto-
    // resolved wingtip X. Small nudge so it reads as "just outside" the wing.
    lateralPush:         0.10,
    peakOpacity:         0.65,
    attackRate:          10,
    releaseRate:         4,
    rotateWithShip:      true,   // align long axis with ship forward
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

  // Shared geometry + texture across both strips (one allocation, one upload).
  let _sharedGeo = null;
  let _sharedTex = null;
  const _tmpEuler = new THREE.Euler();

  function _buildStripTexture() {
    // Soft-edged elongated band: bright leading edge, long fade aft, feathered
    // on the long edges. 32×256 = 32 KB; sRGB; anisotropic 4 for crisp grazing.
    const c = document.createElement('canvas');
    c.width = 32; c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 32, 256);
    // Lengthwise gradient: head bright at ~20% down (front of strip), long tail.
    const vg = g.createLinearGradient(0, 0, 0, 256);
    vg.addColorStop(0.00, 'rgba(255,255,255,0)');
    vg.addColorStop(0.20, 'rgba(255,255,255,0.95)');
    vg.addColorStop(0.50, 'rgba(255,255,255,0.55)');
    vg.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = vg; g.fillRect(0, 0, 32, 256);
    // Crosswise feather — multiply alpha out on the long edges.
    g.globalCompositeOperation = 'destination-in';
    const hg = g.createLinearGradient(0, 0, 32, 0);
    hg.addColorStop(0.00, 'rgba(0,0,0,0)');
    hg.addColorStop(0.50, 'rgba(0,0,0,1)');
    hg.addColorStop(1.00, 'rgba(0,0,0,0)');
    g.fillStyle = hg; g.fillRect(0, 0, 32, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }

  class BankWaterEffectVisual {
    constructor() {
      if (!_sharedGeo) _sharedGeo = new THREE.PlaneGeometry(1, 1);
      if (!_sharedTex) _sharedTex = _buildStripTexture();

      const make = () => {
        const m = new THREE.Mesh(_sharedGeo, new THREE.MeshBasicMaterial({
          map: _sharedTex,
          color: 0xffffff,
          transparent: true,
          blending: THREE.NormalBlending,
          depthWrite: false,
          opacity: 0,
        }));
        m.rotation.x = -Math.PI / 2;     // flat on water; quad's local +Y → world -Z
        m.visible = false;
        m.renderOrder = 8;
        m.frustumCulled = false;
        return m;
      };
      this.meshL = make();   // shown when ship banks left  (rollAngle < 0)
      this.meshR = make();   // shown when ship banks right (rollAngle > 0)
      this._opaL = 0;        // smoothed opacities, separate per side
      this._opaR = 0;
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

      // Each strip sits under its own rear-wingtip (auto-resolved from ship
      // geometry bbox in the state layer). Only one is visible at a time.
      this.meshR.position.copy(state.positionR);
      this.meshL.position.copy(state.positionL);

      // Scale: width × length. The quad was authored long-axis = Y in canvas;
      // after the -PI/2 X rotation, local Y maps to world -Z, so scale.y is
      // the world-Z length. scale.x is the world-X width.
      this.meshR.scale.set(state.width, state.length, 1);
      this.meshL.scale.set(state.width, state.length, 1);

      // Optional ship-forward alignment (off by default — game runs mostly
      // along world Z so axis-aligned reads correctly and skips a rotation).
      if (TUNING.rotateWithShip) {
        const yaw = Math.atan2(state.forward.x, state.forward.z);
        // After -PI/2 X-rotation, the world rotation we want is around world Y.
        // Setting .rotation.y on a mesh already X-rotated rotates in its local
        // frame; we want a Y-axis world rotation. Quaternion solves it:
        _tmpEuler.set(-Math.PI / 2, yaw, 0, 'YXZ');
        this.meshR.quaternion.setFromEuler(_tmpEuler);
        this.meshL.quaternion.copy(this.meshR.quaternion);
      }

      this.meshR.material.opacity = this._opaR;
      this.meshL.material.opacity = this._opaL;
      this.meshR.visible = this._opaR > 0.01;
      this.meshL.visible = this._opaL > 0.01;
    }

    hide() {
      this.meshR.visible = false;
      this.meshL.visible = false;
      this._opaR = 0;
      this._opaL = 0;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  FACADE — single entry point exposed to game code.
  // ═════════════════════════════════════════════════════════════════════════
  const BankWaterEffect = {
    _visual: null,
    _ready: false,

    init(scene) {
      if (this._ready) return;
      this._visual = new BankWaterEffectVisual();
      this._visual.addTo(scene);
      this._ready = true;
    },

    // Single per-frame call. Caller passes the inputs bag described in the
    // header. dt is seconds since last frame.
    update(inputs, dt) {
      if (!this._ready) return;
      if (window._bankWaterEffectEnabled === false) { this._visual.hide(); return; }
      // Gate: must be over water AND mirror visible AND not paused.
      if (!inputs.overWater) { this._visual.hide(); return; }
      const state = getBankWaterEffectState(inputs);
      this._visual.update(state, dt);
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
