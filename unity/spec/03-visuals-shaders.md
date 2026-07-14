# Jet Horizon — Visual / Shader / Lighting Spec (for Unity URP rebuild)

Source of truth: `src/20-main-early.js` (scene/renderer/lights/floor/water/sun/canyon),
`src/15-holographic-material.js`, `src/fx/19-bank-water-effect.js`, `src/05-thruster-presets.js`,
`src/67-main-late.js` (Death-Run vibes, boost FX), `src/48-showroom.js`, `assets/`.

All colors are sRGB hex as authored in three.js (`THREE.Color(0x...)`). The whole game is
rendered through **ACES filmic tonemapping at exposure 1.1** — reproduce with URP Tonemapping
= ACES, Post Exposure ≈ +0.14 EV (≈ ×1.1), or match by eye. Several materials opt OUT of
tonemapping (`toneMapped:false`) — noted where relevant; in URP emulate with unlit/HDR-clamped shaders.

## Unity URP presentation calibration

The tables below remain the browser source of truth. The shipping Unity presentation deliberately
does not copy every numeric value one-for-one because URP lights, ACES, bloom and vignette do not
produce the same pixels as Three.js. Current Unity calibration is owned by
`EnvironmentController`, the generated post profile, and the three `JH_*` shaders:

- ACES post exposure `+0.28 EV`, bloom threshold `0.85`, scatter `0.30`, high-quality filtering on.
- URP vignette `0.28 / 0.45` (intensity/smoothness) and chromatic aberration `0.015`; the former
  `0.5 / 0.6` URP vignette crushed too much of the playable frame.
- Global ambient `(0.045, 0.05, 0.065)`, key `3.0`, cyan rim `0.16`, pink fill `0.38`, amber rakes
  `0.30 / 0.16`, and exponential fog density `0.0065`. These are presentation-only adjustments.
- `JH_SkyboxGradient` owns the deterministic direction-space star backdrop and star-built Milky Way.
  The panorama is disabled (`_PanoBrightness = 0`); `StarfieldController` now owns warp streaks only.
- The sun uses a runtime 64x32 hero sphere, view-normal radial shading, a generated crown/limb
  corona, and billboarded corona/seam layers. `JH_Sun` emission is `1.25` so the disc retains detail.
- Standard cones are restrained obsidian facets. `ObstacleSpawner` enables the narrow neon band
  only for corridor/slalom hazard language; walls, rings and coins retain independent edge strength.

These calibrations must stay in Unity presentation code. They are not simulation/core state and
must not leak into the engine-neutral package.

---

## 1. Renderer & Post-processing

| Param | Value | Source |
|---|---|---|
| Renderer | WebGL, `antialias: !mobile`, `powerPreference:'high-performance'`, `stencil:false` | 20-main-early.js:1688 |
| Pixel ratio | 'sharp'/'ultra' → min(devicePixelRatio, 3); 'balanced' → min(dpr, 1.25); perf-mode → 1 | :1675–1686, 2104 |
| Tone mapping | `ACESFilmicToneMapping` | :1691 |
| Exposure | `toneMappingExposure = 1.1` (title-ship canvas uses its own renderer at **1.6**) | :1692, 1828 |
| Shadows | **Disabled** (`shadowMap.enabled = false`) — no realtime shadows anywhere | :1693 |
| Output color space | sRGB | :1696 |
| Anisotropy cap | mobile min(4, max); desktop = HW max | :1702–1703 |
| Composer FBO | UnsignedByteType (NOT half-float — caused iOS horizon banding), MSAA samples: 4 (sharp/ultra), 2 (balanced), 0 (perf) | :1988–2003 |
| Pass chain | RenderPass → UnrealBloomPass → ThrusterHazePass (usually disabled) → Vignette/Aberration ShaderPass | :2004–2162 |

### Bloom (UnrealBloomPass) — `20-main-early.js:2012–2021`
| Param | Value |
|---|---|
| Resolution | screen / 2 (`_BLOOM_DIV = 2`); lite-bloom battery mode: / 3 and strength×0.85, radius×0.85 |
| **strength** | **0.35** base — per-level override via `LEVELS[i].bloomStrength`: L1 0.35, L2 0.38, L3 0.42, L4 0.30, L5 0.30 |
| **radius** | **0.25** |
| **threshold** | **1.0** (only HDR emissives bloom; shield etc. use `toneMapped:false` to exceed 1.0) |
| Explosion spike | bloom strength spikes to **1.2** for 0.3 s on explosions (`_BLOOM_SPIKE_STRENGTH=1.2, DUR=0.3`, :3652–3655) |

### Vignette + chromatic aberration pass — `20-main-early.js:2122–2162`
Uniforms: `offset = 0.55`, `darkness = 0.5`, `aberration = 0.0015` desktop / `0.0` mobile.
```glsl
uniform sampler2D tDiffuse; uniform float offset; uniform float darkness; uniform float aberration;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 center = uv - 0.5;
  float dist = length(center);
  vec3 col;
  if (aberration < 0.0005) { col = texture2D(tDiffuse, uv).rgb; }
  else {
    float r = texture2D(tDiffuse, uv + center * aberration).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - center * aberration).b;
    col = vec3(r, g, b);
  }
  col *= 1.0 - smoothstep(offset, offset + 0.4, dist) * darkness;
  gl_FragColor = vec4(col, 1.0);
}
```
**Boost FX** (invincibility speed powerup, 67-main-late.js:5535–5551): aberration jumps to
`MAX_ABERRATION = 0.04` while boosted, then lerps back to base (0.0015 / 0.0) over the ~2 s grace period.

### Localized thruster heat-haze pass — `20-main-early.js:2042–2099`
Optional ShaderPass (only when cone thrusters enabled). Distorts screen UVs near the two nozzle
screen positions. Uniforms: `uRadius 0.02`, `uHazeDir 0.6`, `uIntensity 0 (off) … 0.6–1.0 (visible)`.
Distortion: `offset = vec2(sin(uv.y*40+t*4)*0.004 + sin(uv.y*80+t*7)*0.002, cos(uv.x*35+t*3.5)*0.003 + cos(uv.x*70+t*6)*0.0015) * hazeMask * uIntensity` where hazeMask = `smoothstep(uRadius, uRadius*0.2, dist_to_nozzle)` (aspect-corrected, y squashed ×0.7, offset by `uHazeDir*uRadius*0.8`).

---

## 2. Lighting Rig (gameplay scene)

| Light | Type | Color | Intensity | Position (→target) | Source |
|---|---|---|---|---|---|
| ambientLight | Ambient | `0xffffff` | **0.02** | — | :2167 |
| dirLight (key) | Directional | `0xffffff` | **2.56** | (2, 8.8, 8) | :2169 |
| rimLight | Directional | `0x00f0ff` cyan | 0.10 | (−3, 6, −8) | :2172 |
| fillLight | Directional | `0xff44cc` pink | 0.25 | (0, −2, 6) | :2175 |
| sunLight (right rake) | Directional | `0xff9500` amber | 0.22 | (2.5, 1, −18) → target (0, 0.3, 4.5) | :2178–2181 |
| sunLightL (left whisper) | Directional | `0xff9500` | 0.10 | (−2.5, 1, −18) → target (0, 0.3, 4.5) | :2183–2186 |
| shipKeyLight | Directional, **child of shipGroup** | `0xffffff` | 1.8 | local (2, 4, −3) | :6000 |
| shipFillLight | Directional, child of shipGroup | `0x8899bb` | 0.6 | local (−2, 1, 2) | :6003 |
| shipUnderlightWarm | Point, child of shipGroup | `0xff6620` | 0.15, range 6 | local (0, −1.2, 0) — amber pool on water | :6471 |
| shieldLight | Point, child of shipGroup | `0x00eeff` | 0 → on with shield, range 8 | — | :9232 |
| magnetLight | Point, child of shipGroup | `0x44ff88` | 0 → on with magnet, range 12 | — | :9244 |
| _flashLight (explosions) | Point | `0xffeedd` | 0 → flash, range 15 | at explosion pos, 0.15 s | :3644 |

### Canyon lights — `20-main-early.js:9844–9872`
Four persistent DirectionalLights, color `0xc8f0ff`, added at boot with intensity 0
(so shader program count never changes). Defs (`_CANYON_LIGHT_DEFS`):

| pos | intensity (at full ramp) |
|---|---|
| (−3, 4, 2) | 1.2 |
| (3, 4, 2) | 1.2 |
| (0, 3, −4) | 1.0 |
| (0, −2, 4) | 0.8 |

Master multiplier `lightIntensity = 0.75` (tuner :9793). Ramp: `_canyonLightT` 0→1 with smoothstep
ease over **600 ms** (`_CANYON_LIGHT_RAMP_S = 0.60`) on canyon enter/exit, fill scale
`_CANYON_LIGHT_FILL = 1.0`. NOTE (:9879–9884): as of 2026-05-05 the canyon light ramp and the
dirLight dim are **disabled** by user request — canyons render under the normal global rig.
Implement the ramp but ship it off by default.

### Fog — `20-main-early.js:11910`
```js
scene.fog = new THREE.FogExp2(0x0d0428, 0.008);   // exponential-squared? No: FogExp2, density 0.008
```
Fog **color** is re-driven per level/vibe: `scene.fog.color = LEVELS[i].fogColor` and lerped during
level transitions (40-main-late.js:278/307, 67-main-late.js:3053). Density stays 0.008.
Sun, sky quad, stars, warp lines all set `fog:false` / are screen-space.

### Title/showroom studio rig — `20-main-early.js:6605–6626` (separate scene, exposure 1.6)
key `0xffffff` 4.5 @ (3,2,5) · fill `0xddeeff` 2.2 @ (−4,0,4) · rim `0xffffff` 2.5 @ (0,5,−4) ·
top `0xeeeeff` 1.5 @ (0,6,1) · ambient `0x667799` 1.2.

---

## 3. Per-level palette (LEVELS, `20-main-early.js:97–149`)

| # | Name | skyTop | skyBot | gridColor | sunColor | sunStripe | bloomStr | fogColor |
|---|---|---|---|---|---|---|---|---|
| L1 | NEON DAWN | `0x03070f` | `0x08102a` | `0x00eeff` | `0xff9500` | `0xff5500` | 0.35 | `0x05091a` |
| L2 | ULTRAVIOLET | `0x060010` | `0x0e0320` | `0xdd00ff` | `0xcc44ff` | `0x8800cc` | 0.38 | `0x080018` |
| L3 | CRIMSON VOID | `0x000000` | `0x0f0005` | `0xff1050` | `0xff4400` | `0xcc0000` | 0.42 | `0x080003` |
| L4 | ICE STORM | `0x000000` | `0x000c18` | `0x55ffff` | `0xaaeeff` | `0x4499cc` | 0.30 | `0x00080f` |
| L5 | VOID SINGULARITY | `0x000000` | `0x060400` | `0xffcc00` | `0xffaa33` | `0xff6600` | 0.30 | `0x030200` |

Per-level thruster colors (`THRUSTER_COLORS`, :8361): L1 `0x44aaff`, L2 `0xee00ff`, L3 `0xff3300`,
L4 `0x33aaee`, L5 `0xff9a00`. Floor line palette (`FLOOR_PALETTES`, :2651): `0x00eeff`, `0xcc44ff`,
`0xff1060`, `0x44ccff`, `0xffd700`. Nebula tints (`NEBULA_TINTS`, :2241): `0x2244aa`, `0x661199`,
`0x990022`, `0x003388`, `0x110033`.

Death-Run mode adds extra vibes (67-main-late.js:623–730+), e.g. ELECTRIC HORIZON
(grid `0x00ffcc`, sun `0xff6600`, floorLine `0x00ffaa`, thruster `0x00eeff`), DEEP VIOLET
(sky `0x06000f/0x0a001a`, grid `0xaa44ff`, sun `0xcc88ff`), SOLAR FLARE (grid `0xff6600`,
sun `0xffdd88`, bloom 0.45). Each vibe also carries `floorLine` + `thrusterColor` + `sunShader` index
(0=plain,1=UV,3=ice-warp,4=gold) and optional `warpCol1/2/3` triplets for the sun's domain-warp palette.

---

## 4. Sky / background

### 4a. Sky gradient — fullscreen NDC quad, renderOrder −10, layer 3 (:2192–2216)
```glsl
// vert: varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }
uniform vec3 topColor;   // LEVELS[i].skyTop
uniform vec3 botColor;   // LEVELS[i].skyBot
uniform float horizonLine; // 0.38
varying vec2 vUv;
void main(){
  float t = smoothstep(horizonLine - 0.05, horizonLine + 0.25, vUv.y);
  gl_FragColor = vec4(mix(botColor, topColor, t), 1.0);
}
```
`depthWrite:false, depthTest:false`.

### 4b. Milky-Way panorama quad (:1743–1810)
Fullscreen NDC quad at depth 0.999 sampling `assets/images/milkyway-pano.jpg` (sRGB).
Uniforms: `uBrightness 5.0`, tint `(R 0.56, G 1.0, B 1.0)` (cyan-shifted), `uOffsetY −0.06`,
optional radial fade around the sun (`uSunFadeR 0` = off, soft 0.3, center (0.5, 0.25)).
`col = tex.rgb * 5.0 * vec3(0.56,1,1)`.

### 4c. World starfield layers (all layer 3 = excluded from water reflection; Z-recycled scroll)
| Layer | Count | Material | Notes |
|---|---|---|---|
| starField | 5000 pts | PointsMaterial size 0.4, color rgb(0.55,0.65,1.0), opacity 0.85, NormalBlending, radial-gradient sprite 16px (white core, stops 0/0.18/0.45/1 at a 1/0.9/0.15/0) | volume ±500 x, ±220 y, 600 z-depth; scroll `state.speed*dt*0.72` |
| brightStarField | 160 pts | Additive ShaderMaterial, `gl_PointSize = size*(300/-mv.z)`, size 0.6–2.0, alpha 0.85; 64px sprite white→(200,220,255)→(150,180,255)→(100,140,255) | X biased to edges; excluded from sun disc (Z −340, r 112×1.1) |
| nebulaCloud | 600 pts | PointsMaterial size 22, **opacity 0.02**, additive, color lerps to per-level NEBULA_TINT (lerp rate dt*0.5) — 32px radial sprite of rgb(100,50,230) | scroll ×0.40 of star step (parallax) |
| warp streaks | 200→1800 (scales with speed) | LineSegments, LineBasicMaterial color rgb(0.51,0.45,0.63), opacity 1.0, NormalBlending, fog:false, layer 4 (no water reflect) | Z-aligned 2-point lines; lead accel 0.006, trail 0.003, accelMult = speed*80*0.05; max length 4; Y ≥ 2 (above water), spawn Y center 50 range ±400, X ±520 |

There is also a screen-space "sky star backdrop" (twinkling GPU points + constellation lines,
:4919–5170): NDC-space placement, horizon at NDC y −0.40, deterministic LCG seed 42. Decorative;
same palette (white/blue-white).

### 4d. GIANT SUN — hero element (:4330–4917)
- Position **(0, −2, −340)**, sphere radius **112 × 0.95**, 64×64 segments. `fog:false`.
- Fragment shader = 5 blended branches driven by uniforms `uIsUV / uIsIce / uIsGold / uIsL3 / uIsL3Warp`
  (each 0..1, cross-faded on level transitions). `uSunColor` = LEVELS[i].sunColor.
- Noise: 2D value-noise FBM (`fbm2`, 4 octaves, lacunarity 2.1, gain 0.5, hash
  `fract(p*vec2(127.1,311.7)); p+=dot(p,p+19.19); fract(p.x*p.y)`) + standard **Ashima/McEwan
  3D simplex** `snoise` wrapped in `fbmS` (4 octaves, remapped 0..1).

Key branch math (verbatim core, from :4473–4709):
```glsl
float limb = clamp(dot(vNormal, vec3(0,0,1)), 0.0, 1.0);
// PLAIN (L1/L3): radial gradient dark-core → bright rim
//   vRadial = length(vec2(pos.x*0.55, pos.y))/R  (vertex-based)
vec2 noiseUv = vUv * 3.2 + vec2(uTime*0.015, uTime*0.008);
float n = fbm2(noiseUv);
float churn = mix(0.94 + n*0.12, 0.85 + n*0.30, uIsL3);
vec3 coreCol = mix(vec3(0.68,0.24,0.02), vec3(0.58,0.12,0.02), uIsL3);
vec3 rimCol  = mix(vec3(0.90,0.38,0.04), vec3(0.95,0.28,0.04), uIsL3);
vec3 col = mix(coreCol, rimCol, smoothstep(0.15, 0.85, rd));
col += mix(vec3(0.18,0.10,0.02), vec3(0.18,0.06,0.02), uIsL3) * smoothstep(0.45,0.85,yN); // top glow
col *= 1.0 - 0.08*smoothstep(0.60,0.48,yN);                                              // bottom dim
vec3 corona = mix(vec3(1.0,0.55,0.08), vec3(1.0,0.35,0.06), uIsL3);
float coronaBlend = smoothstep(0.82,0.97,rd);
float coronaBias = 0.3 + 0.7*max(smoothstep(0.4,0.9,yN), smoothstep(0.58,0.50,yN)*0.85);
col = mix(col, corona, coronaBlend*coronaBias);
col *= smoothstep(0.0, 0.05, limb);           // black edge kill
colPlain = col * churn;
```
- **L2 UV branch**: same structure with `core = uSunColor*0.42`, `rim = uSunColor*0.82`,
  corona `min(uSunColor*1.5 + vec3(0.25,0.12,0.25), 1.0)`, churn `0.92 + n*0.16`.
- **L4 ICE branch** (Quilez double domain warp on `p = vWorldNormal*3.5`):
  `q = fbmS(p + drift)` ×3 (drift rates ~0.011–0.031 · t per component, seed offsets (0,0,0)/(5.2,1.3,2.7)/(3.1,4.4,1.1)),
  `r = fbmS(p + 3.5q + seeds (1.7,9.2,4.3)/(8.3,2.8,6.1)/(2.9,7.5,0.8))`, `f = fbmS(p + 3.5r)`.
  Ramp: `deepTeal = uSunColor*0.35 → iceBlue = uSunColor → hotWhite = min(uSunColor*1.25, 1)` via
  `smoothstep(0.2,0.7,f)` then `smoothstep(0.6,0.9,f)`; `+ |q|` streaks (`mix(col, iceBlue*1.1, smoothstep(0.4,0.8,|q|/1.73)*0.35)`),
  `r.y` pockets (`mix(col, deepTeal, smoothstep(0.6,0.9,r.y)*0.4)`); limb darkening `pow(limb,2.2)`,
  `col *= smoothstep(0,0.30,dk)`, core boost `mix(col, col*1.15, smoothstep(0.5,1,dk))`.
- **L3 crimson warp branch**: same warp, palette from uniforms `uWarpCol1 (0.25,0.04,0.02)`,
  `uWarpCol2 (0.85,0.15,0.04)`, `uWarpCol3 (1.0,0.45,0.08)`.
- **L5 GOLD branch**: same warp + Podgursky sunspots `spots = max(0, snoise(n*1.1 + drift)*2.5 − 1.7)`,
  bright regions `max(0, snoise(n*0.5 + drift)*1.3 − 0.7)`, `total = clamp(f − spots*0.4 + bright*0.3, 0, 1)`;
  ramp `uSunColor*0.30 → uSunColor → vec3(1.0,0.95,0.6)`.

Supporting sun meshes:
- **Sun cap disc** (CircleGeometry R×0.95, 64 seg) at Z+4, renderOrder 1 — vertical gradient
  `tint*0.55 → tint*1.0`, hot rim `min(tint*1.3 + (0.10,0.06,0), 1)` at r 0.65–0.90, corona
  `min(tint*0.7 + (0.35,0.30,0.15),1)` at r 0.88–0.97, alpha kill at r 0.75–1.0.
- **Glow/corona sprite**: 2048² canvas, additive, plane `SUN_R*3.2` at Z+1, renderOrder 3.
  Crown bloom radial gradient (stops rgba(255,255,220,0.22) / (255,230,120,0.16)@0.15 /
  (255,170,40,0.08)@0.40 / 0@1, scaled 2.2× horizontally) + 6-layer limb arc strokes at ring radius
  0.625·half (layers rOff −8..+8 px@1024, widths 16/12/10/4/10/16, colors (255,130,25)a.35 /
  (255,170,55)a.70 / (255,215,95)a1 / (255,250,200)a1 / (255,185,60)a.70 / (255,148,30)a.30,
  weight taper `0.28 + 0.72*pow(1−|t−0.5|*2, 1.6)` thickest at 12-o'clock). Redrawn/recolored per level.
- **Horizon seam** ("waterline"): plane `SUN_R*2.5 × 2.8` at (0, −2, −338), additive canvas
  512×16 horizontal gradient — transparent → warm → **white 1.0 at center** → warm → transparent
  (stops 0/0.10/0.32/0.50/0.68/0.90/1.0 with alphas 0/0.30/0.85/1.0/0.85/0.30/0). Recolored per level
  toward sunColor (+0.15 r, +0.05 g boost, center stays white 0.95).

---

## 5. Floor & Water

### 5a. Floor plane — `20-main-early.js:2648–2737`
PlaneGeometry **1400 × 700**, rotated flat, at (0, 0.0, −100). ShaderMaterial:

```glsl
// VS
varying vec2 vWorldXZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
// FS
uniform float uOffsetX; uniform float uOffsetZ; uniform float uTileSize; // 4.0
uniform vec3 uLineColor; varying vec2 vWorldXZ;
float gridLine(vec2 uv) {
  vec2 fw = fwidth(uv);
  vec2 edge = min(uv, 1.0 - uv);
  vec2 aa = fw * 1.2;
  vec2 line = smoothstep(aa, vec2(0.0), edge - 0.022);
  return max(line.x, line.y);
}
void main() {
  vec2 scrolled = vWorldXZ + vec2(uOffsetX, uOffsetZ);
  vec2 tileUV = fract(scrolled / uTileSize);
  float g = gridLine(tileUV);
  vec2 glowEdge = min(tileUV, 1.0 - tileUV);
  float glow = max(smoothstep(0.08,0.0,glowEdge.x), smoothstep(0.08,0.0,glowEdge.y)) * 0.35;
  vec3 col = vec3(0.0);                       // ← NOTE: currently PURE BLACK, grid lines disabled
  float depth = -vWorldXZ.y;
  float fogFactor = clamp((depth - 20.0) / (260.0 - 20.0), 0.0, 1.0);
  col = mix(col, vec3(0.0), fogFactor * fogFactor);
  float behindFade = clamp((-depth + 8.0) / 10.0, 0.0, 1.0);
  col = mix(col, vec3(0.0), behindFade);
  gl_FragColor = vec4(col, 1.0);
}
```
IMPORTANT: the classic synthwave grid code is present but **composited to pure black** (`col = floorColor`
which is black; `g`/`glow` computed but unused). The visible "grid" feel comes from the water +
level lighting. Keep `uLineColor` (updated per level) wired for potential re-enable. Scroll:
`uOffsetZ` accumulates ship speed (grid tile 4.0 world units, line width 0.022 tile, glow band 0.08 tile ×0.35).

### 5b. Water — three.js `Water` addon (mirror plane) — :2743–2864
- PlaneGeometry **1400 × 700 (4×4 seg)** at (0, **0.01**, −100), rotated flat. Sits 1 cm above floor.
- Reflection RT **512×512**. Normal map `assets/images/waternormals.jpg` (repeat wrap).
- Construction params: `waterColor 0x000000` (pitch black), `alpha 1.0`, `fog:false`.
- Post-construction uniform overrides:
  - `sunDirection = normalize(0, 0.3, −1)` (toward horizon ahead)
  - `sunColor = RGB(0.55, 0.28, 0.03)` (dim warm amber → produces the sun streak)
  - `size = 8.0` (tight ripple scale), `distortionScale = 0.6`
- Forward-flow injection: adds uniform `uFlowZ`, replaces
  `getNoise( worldPosition.xz * size )` → `getNoise( (worldPosition.xz + vec2(0.0, uFlowZ)) * size )`.
  `uFlowZ` accumulates `speed * dt * 0.45` (`_waterFlowScale = 0.45`) — normal map scrolls toward the player.
- Reflection exclusions: layer 3 (sky/stars/sun quad) and layer 4 (thruster particles, flames,
  bloom sprites, cones, warp lines) are invisible to the internal mirror camera.
- In Unity: URP planar reflection (or SSR fallback) + scrolling normal map + Fresnel + amber
  directional specular streak on a black albedo plane.

### 5c. Ship water wake — :2870–2952
- **Ring ripples**: pool 40 × RingGeometry(0.12, 0.32, 32), MeshBasicMaterial white additive,
  spawned every 0.07 s under ship at Y −0.10, life 0.20 s, grow + fade, ellipse-skewed by lateral velocity.
- **V-wake chevron**: two thin quads (tip at ship, spread ±8 wide at 20 units behind, Y 0.03),
  MeshBasicMaterial white additive, opacity scales with speed.

---

## 6. Bank-water wake effect (`src/fx/19-bank-water-effect.js`) — copy verbatim

Trigger: banking ≥ ~24° over water at speed. State layer computes intensity =
`smoothstep(0.42, 0.52, |rollAngle|) * clamp01(speed/maxSpeed) * (overWater ? 1 : 0)`;
only the bank-DOWN side strip shows. Band anchored at the rear wingtip (auto-resolved from ship
bbox: `(±bbox.max.x, midY, bbox.max.z)`), pushed 0.10 outward along ship-right, center shifted
back by `length * 0.30` so the bright head (V≈0.15–0.2) lands at the wingtip.

TUNING (:59–93): `bandLength 4.5 (+2.0 at full speed)`, `bandWidth 0.14`, `headBias 0.30`,
`waterClearance 0.005`, `lateralPush 0.10`, **`peakOpacity 0.65`**, attack 10/s, release 4/s,
`tintColor 0xeaf8ff`, `scrollSpeed 6.0` (V-units/s, scaled by `0.4 + 0.6*intensity`),
`uConeShape 0.65`. Mesh: shared 1×1 plane, flat on water, `renderOrder 8`, yaw-aligned to ship
forward, scale = (width, length, 1). NormalBlending, no depthWrite.

Noise texture (`_buildNoiseTexture`, :226–271): 64×64 grayscale canvas, repeat wrap, linear filter,
no color space. `value = fine*0.4 + coarse*0.6` where fine = per-pixel `Math.random()` and coarse =
16×16 random field bilinearly upsampled to 64×64.

Vertex shader (verbatim):
```glsl
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
```
Fragment shader (verbatim):
```glsl
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
```
Audio companion (`19a-bank-water-hiss.js`) is a noise loop whose gain follows the SAME intensity
signal (floor 0.05, peak gain 0.05, attack 8/s release 3/s) — i.e. audio is slaved to the visual trigger.

---

## 7. Holographic material (`src/15-holographic-material.js`) — copy verbatim

Extends ShaderMaterial. Adapted from Anderson Mancini (MIT). `transparent:true, depthWrite:false,
blending: Additive (default), toneMapped:false` (clamped < 1.0 so bloom threshold 1.0 never picks it up).

Vertex shader (verbatim):
```glsl
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
```
Fragment shader (verbatim):
```glsl
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

  // Gate scanline/noise on signalSpeed: ghost ship (signalSpeed=0) gets clean
  // holo (tint + fresnel only); powerup cubes (signalSpeed>0) keep scanlines.
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

  // Clamp under bloom threshold (1.0) so bloom doesn't ACES-desaturate it.
  finalColor = min(finalColor, vec3(0.95));
  gl_FragColor = vec4( finalColor, hologramOpacity );
}
```
Default uniforms: `fresnelOpacity 1.0, fresnelAmount 0.45, scanlineSize 8.0, hologramBrightness 1.0,
signalSpeed 1.0, hologramColor #00d5ff, enableBlinking true, blinkFresnelOnly true, hologramOpacity 1.0`.

**Used by**: (a) power-up pickup cubes (default params, per-powerup `hologramColor` tint);
(b) the **GHOST ship skin** — every hull slot except nozzle uses HolographicMaterial with:
`hologramColor '#00e0ff', fresnelAmount 0.70, fresnelOpacity 0.82, scanlineSize 5.50,
hologramBrightness 1.94, signalSpeed 0.00, hologramOpacity 0.31, side DoubleSide,
blending Normal, depthWrite true` (20-main-early.js:6129–6146; uniforms locked from tuner broadcast).

---

## 8. Canyon walls (cyan/dark slabs)

Slab geometry (tuner defaults :9762–9823): H 55 × Z-len 20 × X-thick 60, 5×6 inner-face
subdivisions, X jitter `disp 4.0`, quantize `snap 0.7`; inner profile foot→sweep→mid→crest X =
9.0 / 4.0 / 17.0 / 20.0 (at v 0.15/0.45/0.85); non-indexed tri soup with flat normals (crystalline
facets). Half-gap `halfXOverride 40` (34 in corridor presets, 68 straight). Entrance slab: thick 450–700,
Z-length 200. Slabs alternate cyan/dark by `posIdx % 2` unless preset `_allCyan/_allDark`.

### cyanMat — MeshPhysicalMaterial (:10358–10372)
| Param | Value |
|---|---|
| color | `0x04d4f0` |
| metalness / roughness | 0.0 / **0.4** (`cyanRgh`) |
| ior / reflectivity | 1.22 / 0.55 |
| clearcoat / clearcoatRoughness | 0.65 / 0.22 |
| emissive | `0x6ef2ff`, emissiveMap = cyanTex, **emissiveIntensity 1.1** (`cyanEmi`) |
| flatShading / side | true / DoubleSide |

`cyanTex` generation (:10000–10015): 512² canvas, fill `#030b14`, then one diagonal linear gradient
(0,0)→(300,512): stops `rgba(120,240,255,0.95)` @0, `rgba(60,200,255,0.70)` @0.15,
`rgba(20,120,200,0.30)` @0.4, transparent @1. (Bright cyan streak from top-left fading out.)

### darkMat — MeshPhysicalMaterial (:10374–10387)
| Param | Value |
|---|---|
| color | `0x080810` |
| roughness / metalness | **0.22** (`darkRgh`; preset 2 uses 0.32) / 0.0 |
| clearcoat / clearcoatRoughness | 0.40 / 0.08 |
| reflectivity | 0.7 |
| emissive | `0xff00cc` magenta, emissiveMap = darkTex, **emissiveIntensity 0.9** (`darkEmi`; preset 2: 1.4) |
| flatShading / side | false / DoubleSide |

`darkTex` generation (:10017–10061): 512² canvas, seeded LCG (`s=(s*9301+49297)%233280`), fill
`#030608`; 6 vertical marble veins stroke `#0a1525` (alpha 0.3–0.6, width 6–18, 8 wandering segments);
then `darkCrkCount = 6` horizontal magenta cracks — color `#ff00cc` (60%) or `#cc44ff`, shadowBlur
14/6 × `darkCrkBright 1.0`, alpha 0.7–1.0, width 1.5–4.5, 5–10 jagged segments marching left→right
with random branch offshoots. Tuner also carries holo-overlay knobs `holoOpacity 0.5, holoGrid 6.0`
(legacy overlay, currently not attached).

Canyon presets 1–4 (:9894–9897) change sine shape + `_allCyan/_allDark`, not materials (except
preset 2 `darkRgh 0.32, darkEmi 1.4`).

### Glacier terrain walls (L4 "ice" side terrain, :9556–9731)
Two 400×400 displaced strips per side at x ±200, y −25, peak 55. MeshStandardMaterial:
`color #ffffff, metalness 0.85 (per-cell noise metalnessMap 256²), roughness 0.25,
emissive #00eeff, emissiveIntensity 1.4, emissiveMap = gridTex, flatShading, DoubleSide`.
`gridTex` (`_makeGridTexture`, :9576–9640): 512² canvas — base `#03080f`; cyan grid lines
(`#00eeff`, alpha **0.15**, width 1.5, 24×80 cells); 18 seeded jagged crack polylines colored
`#ff00cc` (60%) / `#cc44ff`, alpha 0.55–0.90, width 0.8–2.2; 8 radial hotspot glows
(`rgba(255,0,200,0.55) → rgba(100,0,255,0.20) → 0`, r 18–40). Texture repeat (1,2); displacement =
`pow(u,1.1) * pow(max(0, 0.45 + Σ sines), 1.35) * 55` (see `_displaceTerrain` for the 4 sine terms).

---

## 9. Ship, skins & thrusters

Ships: `assets/ships/default_ship.glb` (legacy) and **`spaceship_01.glb`** — all 4 skins share
spaceship_01.glb, recolored per `_SKIN_PALETTE[idx]` by GLB material-slot name
(slots: `nozzle, gray, rocket_light, rocket_base, white, fallback`; `fire/fire1` = engine glow meshes
left as-is). Addon nodes in spaceship_01.glb: `Fins_01, Fins_02, Rings_001` (Warp Drive),
`Turrets_001..003` (visibility-toggled; level gates 2/5/14 + missions). Ship scale 0.30
(`shipGroup.scale`), hover Y ≈ 1.21.

### SHIP_SKINS (:427–432) + `_SKIN_PALETTE` (:6076–6113)

| Skin | Unlock | Look | Slot materials (MeshStandardMaterial unless noted) |
|---|---|---|---|
| 0 RUNNER | default | dark metal + blue emissive | nozzle `0x0a0a0a` m.95 r.12 · gray `0x888899` m.6 r.32 · rocket_light `0x0044ff` r.05 emissive `0x0033cc`×2.5 · rocket_base `0x0e1014` m.90 r.30 **hexBump** · white `0xddeeff` m.5 r.08 emissive `0x2255ff`×0.6 · fallback `0x141820` m.88 r.25 hexBump |
| 1 GHOST | Lv10 / 400c | holographic cyan | nozzle `0x0a0a0a` m.95 r.12; **all other slots = HolographicMaterial** `#00e0ff` (params in §7) |
| 2 BLACK MAMBA | Lv20 / 800c | copper metal + hot cyan emissives | nozzle black m0 r.32 · gray/rocket_base/fallback `0xd36b4a` m1.0 r.32 · rocket_light black + emissive `0x19d9e6` **×11** · white `0x797234` + emissive `0x19d9e6` ×5.0 |
| 3 CIPHER | Lv35 / 1400c | black mirror + diamond-plate normal + cyan seam glow | nozzle `0x080808` m.95 r.10 · rocket_light black emissive `0x88bbff` ×6 · all others `0x000000` m.98 r0 + **diamond shader patch** |

**Diamond-plate patch** (`_GLSL_DIAMOND` + `_GLSL_DIAMOND_EMISSIVE`, :6034–6070): world-space
45°-rotated grid (`vec2(x+y, x−y)*0.707`) at `dScale 0.5`, planar XZ/XY blend by `|normal.y|`;
edge mask `1 − smoothstep(0.45, 0.80, max(|fract−0.5|))`; normal perturbed with finite differences
(`dBump 0.6`, eps 0.01); emissive seam glow added: `vec3(0.2, 0.76, 1.0) * edge(0.10..0.50) * 0.9`.

**Hex-bump patch** (`_hexBumpShaderPatch`, :7212–7246): world-space offset-grid dots
(`fract(uv)−0.5` vs `fract(uv+0.5)−0.5`, min distance), scale 2.0, edge `1−smoothstep(0.30,0.46,cell)`,
bump strength 0.22, blended 65% into the normal. (Subtle hex plating on RUNNER dark panels.)

Near-miss flash: hull emissive → RGB(1.0,0.15,0.05) × (flash×2.5) (67-main-late.js:5561–5568).

### Thruster systems
Two particle pods + two mini pods (`THREE.Points`, additive, soft radial sprite), a flame mesh,
a nozzle "bloom" sprite (64px radial white sprite), all on layer 4 (no water reflection).
Global defaults (window fallbacks, :8399–8437): `partOpacity .48, posPinFrac .14, sizeBase .05,
lifeMin .34, nozzleBloomOpacity .78, flameCoreRGB .37, flameSizeBase .06, flameBumpMult 3.0`, etc.
Base thruster color `0x44aaff`, changes per level (see §3) unless a palette color is equipped (locked per run).

**Cone (shader) exhaust** — preset PYLON. Unit ConeGeometry(1,1,16, open), base at origin, tip +Y,
additive, depthTest off, renderOrder 9, DoubleSide, `frustumCulled false`. Default cfg
(`RUNNER_CONE_CFG` ≈ :417–423 / 8109–8119): length 3.30, radius 0.29, offL(−0.02, 0.03, 0),
offR(0.02, 0.02, 0), `neonPower 0.90, noiseSpeed 0.80, noiseStrength 0.13, fresnelPower 6.0, opacity 1.0`,
color `0x44aaff`. Fragment shader (verbatim, :8152–8230):
```glsl
precision mediump float;
uniform float uTime; uniform vec3 uColor;
uniform float uNeonPower; uniform float uNoiseSpeed; uniform float uNoiseStrength;
uniform float uFresnelPower; uniform float uOpacity;
varying float vHeight; varying vec3 vNormal; varying vec3 vViewDir; varying vec2 vUv;

vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noise(vec2 p) {   // 2D simplex
  const float K1 = 0.366025404; const float K2 = 0.211324865;
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  float m = step(a.y, a.x);
  vec2 o = vec2(m, 1.0 - m);
  vec2 b = a - o + K2; vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a,a), dot(b,b), dot(c,c)), 0.0);
  h = h * h * h * h;
  vec3 n = h * vec3(dot(a, hash(i)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
  return dot(n, vec3(70.0));
}
float fbm(vec2 p) {
  float f = 0.0;
  f += 0.5000 * noise(p); p *= 2.02;
  f += 0.2500 * noise(p); p *= 2.03;
  f += 0.1250 * noise(p);
  return f / 0.875;
}
vec3 neonRamp(float value, vec3 color) {   // hot white core → saturated color → dark
  float ramp = clamp(value, 0.0, 1.0);
  vec3 out_color = vec3(0.0);
  ramp = ramp * ramp; out_color += pow(color, vec3(4.0)) * ramp;
  ramp = ramp * ramp; out_color += color * ramp;
  ramp = ramp * ramp; out_color += vec3(1.0) * ramp;
  return out_color;
}
void main() {
  float grad = 1.0 - vHeight;                                  // 1 at nozzle, 0 at tip
  vec2 noiseUV = vec2(vUv.x * 3.0, vUv.y * 0.6 - uTime * uNoiseSpeed);
  float n = fbm(noiseUV) * uNoiseStrength;
  grad = clamp(grad + n, 0.0, 1.0);
  vec3 col = neonRamp(pow(grad, uNeonPower), uColor);
  float fresnel = 1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
  float edgeFade = 1.0 - pow(fresnel, uFresnelPower);
  float alpha = grad * edgeFade * uOpacity;
  alpha *= smoothstep(0.0, 0.08, grad);
  gl_FragColor = vec4(col, alpha);
}
```

### Thruster presets (`src/05-thruster-presets.js`) — full data tables
Keys map to window globals; `_pointMatSize/_miniPointMatSize` = Points material size.

| Preset | label | scale | pointSize | nozzleBloom scale/op | particle sizeBase/sizeSpd | midEnd/midBoost | bump mult/end | life min/jit/base/spd | spawnJit | flame core end/RGB, midEnd, size, bump |
|---|---|---|---|---|---|---|---|---|---|---|
| light (default) | LIGHT | 0.80 | 0.06 / 0.09 | 0.10 / 0.43 (pulse .15) | 0.05 / 0 | 0.10 / 0 | 1.0 / 0 | .05/.05/.20/0 | .07 | 0/0, .10, .01/0, 1.0/0 |
| baseline | BLINK | runtime snapshot of original defaults | | | | | | | | |
| short | SHORTY | 1.00 | 0.13 / 0.08 | 0.45 / 0.24 | 0.19 / 0.13 | 0.65 / 0.30 | 1.6 / 0.10 (jit .06) | .18/.22/.20/0 | .10 | .10/.85, .60, .04/.01, 1.4/.07 |
| coneThrust | PYLON | switches to shader cones (cfg above), hides particles | | | | | | | | |
| fatIon | FAT ION | 0.70 | 0.12 / 0.06 | **2.45 / 0.94** | 0.05 / 0 | 0.10 / **1.02** | 1.0 / 0 | .05/.08/**1.30**/0 | .09 | 0/.37, .35, .06/.10, **3.0/.30** |
| flourish | FLOURISH | 0.15 | 0.11 / 0.08 | 2.40 / 0.43 | **0.60 / 0.49** | .74 / **1.94** | 2.95/.28 (jit .09) | .11/.13/.65/.10 | .20 | .30/**1.0**, **.96**, .01/0, 1.0/0 |
| plasma | PLASMA | 0.15 | 0.11 / 0.08 | 2.40 / 0.43 | 0.60 / 0.49 | .74 / 1.94 | 2.95/.28 | .11/.13/.20/**.50** | .20 | 0/0, .23, .02/.01, 1.0/.04 (lifeJit .28) |
| distort | DISTORT | 0.15 | 0.11 / 0.08 | 2.40 / 0.43 | 0.60 / 0.49 | .74 / 1.94 | 2.95/.28 | .11/.13/.20/0 | .20 | 0/0, .15, .01/0, 1.0/.01 (lifeJit .28) |

`short` also bakes nozzle offsets: nozL (−0.48, 0.05, 5.16), nozR (0.50, −0.01, 5.10),
miniL (−0.15, 0.06, 5.10), miniR (0.16, 0.06, 5.10). Default GLB nozzles: ±0.480, 0.050, 5.100;
minis ±0.15/0.16, 0.06, 5.10 (`_SHIP_GLB_CONFIG` :411–425).

Thruster color palette (cosmetic overrides, :221–232):
default(null) · ION BLUE `0x44aaff` · CYAN `0x33eeff` · VIOLET `0xee00ff` · CRIMSON `0xff3300` ·
EMBER `0xff9a00` · TOXIC `0x44ff88` · NEON PINK `0xff66bb` · SOLAR GOLD `0xffcc33` · WHITE HOT `0xffffff`.

---

## 10. Other signature effects

| Effect | Details | Source |
|---|---|---|
| Explosion flash | White additive Sprite (`toneMapped:false`) scales up from 0.01, opacity 1→0 over **0.15 s**, plus PointLight `0xffeedd` range 15; bloom strength spikes to 1.2 for 0.3 s | 20-main-early.js:3631–3656 |
| Shield bubble | Sphere r 2.4 (48 seg desktop / 32 mobile), custom hex-grid shader: color RGB(0.149, 0.54, 1.0) ≈ `#268aff`, hexScale 2.2, fresnel pow 1.8 str 1.45, opacity 1.09, noise-edge reveal dissolve (uReveal sweep, edge color same blue, edge intensity 7.9, width 0.02), flowing noise (scale 1.9, speed 0.25, intensity 1.2), up to 6 traveling hit-ripples (ring speed 5, width 0.5, max radius 2, duration 1.5 s, intensity 20, vertex displacement 0.03) + cyan wireframe sphere `0x88ffff` + shieldLight | :8963–9232 |
| Magnet | Two orbiting torus rings (3.2, 0.08) `0x44ff88` + green point light | :9236–9245 |
| Warp/speed lines | The warp LineSegments layer (§4c) doubles as speed lines — count 200→1800 with speed, opacity 1.0 | :2403–2632 |
| Boost | Chromatic aberration 0.0015 → 0.04 while invincible-speed, lerp back over grace | 67-main-late.js:5535–5551 |
| Water bank wake + hiss | §6 | fx/19, fx/19a |
| Ghost-ship holo, powerup cubes | §7 | 15-holographic-material.js |
| Heat haze | §1 haze pass (cone thrusters only) | :2042–2099 |

---

## 11. Unity URP mapping cheat-sheet

- Volume: Tonemapping ACES; Bloom intensity ≈ 0.35 (threshold 1.0, scatter ≈ 0.25-equivalent, half-res);
  Vignette intensity ≈ 0.5 @ smoothness matching smoothstep(0.55→0.95); Chromatic Aberration 0.0015→0.04 on boost.
- No shadow casting; all lights = Directional/Point per §2 tables (intensities are three.js linear —
  use as URP intensities and match by eye against ACES output).
- Fog: exponential-squared (FogExp2) density 0.008, color per level.
- Water: planar reflection probe/renderer feature at 512², black base, scrolling `waternormals.jpg`
  (flow +Z at 0.45 × speed), amber sun streak spec from direction (0, 0.3, −1).
- Sun: single big sphere + cap disc + additive billboard corona + additive horizon-seam quad; shader
  graph or HLSL port of §4d (fbm2 + simplex domain warp branches).
- Ship skins: 4 material sets per §9, holographic + diamond/hex detail shaders as custom HLSL.
- Everything scrolls toward +Z at ship speed (world is treadmilled) — floor uses uniform offsets,
  stars/warp/nebula recycle positions.
