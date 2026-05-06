// ═══════════════════════════════════════════════════
//  HOLOGRAPHIC MATERIAL
//  Adapted from Anderson Mancini (ektogamat) — MIT license
//  https://github.com/ektogamat/threejs-vanilla-holographic-material
//  Original gist: https://gist.github.com/ektogamat/b149d9154f86c128c9fea52c974dda1a
// ═══════════════════════════════════════════════════
//
//  Adapted for tunnel-proto's unity-build (uses global THREE namespace
//  from 00-imports.js instead of named imports).

class HolographicMaterial extends THREE.ShaderMaterial {
  constructor(parameters = {}) {
    super();

    this.vertexShader = /* glsl */ `
      varying vec2 vUv;
      varying vec4 vPos;
      varying vec3 vNormalW;
      varying vec3 vPositionW;

      void main() {
        mat4 modelViewProjectionMatrix = projectionMatrix * modelViewMatrix;
        vUv = uv;
        vPos = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        vPositionW = vec3( vec4( position, 1.0 ) * modelMatrix );
        vNormalW = normalize( vec3( vec4( normal, 0.0 ) * modelMatrix ) );
        gl_Position = modelViewProjectionMatrix * vec4( position, 1.0 );
      }
    `;

    this.fragmentShader = /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPositionW;
      varying vec4 vPos;
      varying vec3 vNormalW;

      uniform float time;
      uniform float fresnelOpacity;
      uniform float scanlineSize;
      uniform float fresnelAmount;
      uniform float signalSpeed;
      uniform float hologramBrightness;
      uniform float hologramOpacity;
      uniform bool blinkFresnelOnly;
      uniform bool enableBlinking;
      uniform vec3 hologramColor;

      float flicker( float amt, float t ) { return clamp( fract( cos( t ) * 43758.5453123 ), amt, 1.0 ); }
      float random( in float a, in float b ) { return fract((cos(dot(vec2(a,b), vec2(12.9898,78.233))) * 43758.5453)); }

      void main() {
        vec2 vCoords = vPos.xy;
        vCoords /= vPos.w;
        vCoords = vCoords * 0.5 + 0.5;
        vec2 myUV = fract( vCoords );

        vec4 holoCol = vec4(hologramColor, mix(hologramBrightness, vUv.y, 0.5));

        float scanlines = 10.0;
        scanlines += 20.0 * sin(time * signalSpeed * 20.8 - myUV.y * 60.0 * scanlineSize);
        scanlines *= smoothstep(1.3 * cos(time * signalSpeed + myUV.y * scanlineSize), 0.78, 0.9);
        scanlines *= max(0.25, sin(time * signalSpeed) * 1.0);

        float r = random(vUv.x, vUv.y);
        float g = random(vUv.y * 20.2, vUv.y * 0.2);
        float b = random(vUv.y * 0.9, vUv.y * 0.2);

        // Gate scanline/noise contribution on signalSpeed. When signalSpeed=0
        // the time-driven animation is already silenced, but a STATIC screen-
        // space banding pattern still remains in scanlines + noise. As the
        // ship rotates/banks/pitches, the screen-locked pattern crawls across
        // the rotating surface UVs, reading as a flickering 'hex texture' on
        // the body. Fading by signalSpeed keeps powerup cubes (signalSpeed>0)
        // looking exactly as before, while the ghost ship (signalSpeed=0) gets
        // a clean holo: color tint + fresnel only.
        float _signalGate = clamp(signalSpeed * 50.0, 0.0, 1.0);
        holoCol += (vec4(r * scanlines, b * scanlines, r, 1.0) / 84.0) * _signalGate;
        vec4 scanlineMix = mix(vec4(0.0), holoCol, holoCol.a);

        vec3 viewDirectionW = normalize(cameraPosition - vPositionW);
        float fresnelEffect = dot(viewDirectionW, vNormalW) * (1.6 - fresnelOpacity / 2.0);
        fresnelEffect = clamp(fresnelAmount - fresnelEffect, 0.0, fresnelOpacity);

        float blinkValue = enableBlinking ? 0.6 - signalSpeed : 1.0;
        float blink = flicker(blinkValue, time * signalSpeed * 0.02);

        vec3 finalColor;
        if (blinkFresnelOnly) {
          finalColor = scanlineMix.rgb + fresnelEffect * blink;
        } else {
          finalColor = scanlineMix.rgb * blink + fresnelEffect;
        }

        // Clamp under bloom threshold (1.0) so the post-process bloom pass
        // doesn't pick up the cube and ACES-desaturate it to yellow/white.
        finalColor = min(finalColor, vec3(0.95));
        gl_FragColor = vec4( finalColor, hologramOpacity );
      }
    `;

    this.uniforms = {
      time:               { value: 0.0 },
      fresnelOpacity:     { value: parameters.fresnelOpacity     !== undefined ? parameters.fresnelOpacity     : 1.0 },
      fresnelAmount:      { value: parameters.fresnelAmount      !== undefined ? parameters.fresnelAmount      : 0.45 },
      scanlineSize:       { value: parameters.scanlineSize       !== undefined ? parameters.scanlineSize       : 8.0 },
      hologramBrightness: { value: parameters.hologramBrightness !== undefined ? parameters.hologramBrightness : 1.0 },
      signalSpeed:        { value: parameters.signalSpeed        !== undefined ? parameters.signalSpeed        : 1.0 },
      hologramColor:      { value: parameters.hologramColor      !== undefined ? new THREE.Color(parameters.hologramColor) : new THREE.Color('#00d5ff') },
      enableBlinking:     { value: parameters.enableBlinking     !== undefined ? parameters.enableBlinking     : true  },
      blinkFresnelOnly:   { value: parameters.blinkFresnelOnly   !== undefined ? parameters.blinkFresnelOnly   : true  },
      hologramOpacity:    { value: parameters.hologramOpacity    !== undefined ? parameters.hologramOpacity    : 1.0 },
    };

    this.transparent = true;
    this.depthTest   = parameters.depthTest !== undefined ? parameters.depthTest : true;
    this.depthWrite  = false;
    this.blending    = parameters.blendMode !== undefined ? parameters.blendMode : THREE.AdditiveBlending;
    this.side        = parameters.side      !== undefined ? parameters.side      : THREE.FrontSide;
    // Skip ACES tone mapping so saturated cyan stays cyan instead of
    // desaturating toward yellow/white. Combined with shader clamp <1.0
    // this also keeps the bloom pass from picking up the cube.
    this.toneMapped  = false;
  }

  // Time tick — called per frame from the main update loop.
  // Uses a shared external time source rather than its own clock so
  // pause/resume stays in sync with the rest of the game.
  setTime(t) {
    this.uniforms.time.value = t;
  }
}

// Track all instances so the main update loop can tick them in one place,
// and the dev tuner can broadcast settings updates to every instance.
const _holoMaterials = [];
function _registerHoloMaterial(mat) {
  _holoMaterials.push(mat);
  return mat;
}
// Remove a holo material from the registry + dispose its GPU resources.
// Used by the title-ship swap path so orphan holos from previous skins
// don't keep ticking + don't leave stale uniforms attached to anything.
// Remove a holo material from the tick registry. We intentionally do NOT
// call mat.dispose() here — in this codebase holo materials get cloned and
// shared between the title-scene preview and gameplay alt-ship cache, so
// disposing one can break a still-rendering instance. Removing from the
// registry is enough to stop the orphan tick + tuner broadcasts.
function _unregisterHoloMaterial(mat) {
  if (!mat) return;
  const i = _holoMaterials.indexOf(mat);
  if (i !== -1) _holoMaterials.splice(i, 1);
}
function _tickHoloMaterials(t) {
  for (let i = 0; i < _holoMaterials.length; i++) {
    _holoMaterials[i].setTime(t);
  }
}
// Apply a uniform value to ALL registered holo materials. Used by the tuner.
// The hologramColor is intentionally NOT broadcast — each powerup keeps its own tint.
// Materials with userData._lockHoloUniforms=true are skipped — lets the ghost
// ship hold its tuned defaults regardless of whether the holo-powerup tuner is
// used. Without this lock, moving any holo slider would clobber the ship's
// signalSpeed=0 / scanlineSize=5.5 etc. and make the ship flicker/distort.
function _broadcastHoloUniform(name, value) {
  for (let i = 0; i < _holoMaterials.length; i++) {
    const m = _holoMaterials[i];
    if (m.userData && m.userData._lockHoloUniforms) continue;
    const u = m.uniforms[name];
    if (u) u.value = value;
  }
}
