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

        holoCol += vec4(r * scanlines, b * scanlines, r, 1.0) / 84.0;
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
  }

  // Time tick — called per frame from the main update loop.
  // Uses a shared external time source rather than its own clock so
  // pause/resume stays in sync with the rest of the game.
  setTime(t) {
    this.uniforms.time.value = t;
  }
}

// Track all instances so the main update loop can tick them in one place.
const _holoMaterials = [];
function _registerHoloMaterial(mat) {
  _holoMaterials.push(mat);
  return mat;
}
function _tickHoloMaterials(t) {
  for (let i = 0; i < _holoMaterials.length; i++) {
    _holoMaterials[i].setTime(t);
  }
}
