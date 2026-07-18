// ── CHECKPOINT BEAMS ─────────────────────────────────────────────────────────────────────────
// A deliberately simple prototype: tall water-to-sky checkpoints arranged in
// an endless slalom. The Three.js Water pass reflects these meshes naturally.

const _CHECKPOINT_BEAM_COUNT = 6;
const _CHECKPOINT_BEAM_HEIGHT = 170;
const _CHECKPOINT_BEAM_TIME_GAP = 1.55;
const _CHECKPOINT_BEAM_HIT_RADIUS = 4.25;
const _CHECKPOINT_BEAM_PENDING = new THREE.Color(0x24d8ff);
const _CHECKPOINT_BEAM_HIT = new THREE.Color(0xff3bd5);
const _CHECKPOINT_BEAM_PATTERN = [0, -9, 9, -11, 11, -9, 9];

let _checkpointBeamsActive = false;
let _checkpointBeams = [];
let _checkpointBeamPatternIdx = 0;

const _checkpointBeamGeoCore = new THREE.CylinderGeometry(
  0.34, 0.62, _CHECKPOINT_BEAM_HEIGHT, 12, 1, true
);
const _checkpointBeamGeoOuter = new THREE.CylinderGeometry(
  1.7, 2.5, _CHECKPOINT_BEAM_HEIGHT, 16, 1, true
);
const _checkpointBeamGeoDisc = new THREE.CircleGeometry(_CHECKPOINT_BEAM_HIT_RADIUS, 40);
const _checkpointBeamGeoRing = new THREE.TorusGeometry(_CHECKPOINT_BEAM_HIT_RADIUS, 0.12, 8, 48);

function _checkpointBeamMaterial(opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: _CHECKPOINT_BEAM_PENDING.clone() },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float baseFade = smoothstep(0.0, 0.035, vUv.y);
        float skyFade = 1.0 - 0.72 * smoothstep(0.70, 1.0, vUv.y);
        float bands = 0.84 + 0.16 * sin(vUv.y * 180.0 - uTime * 5.0);
        float shimmer = 0.92 + 0.08 * sin(uTime * 3.0 + vUv.y * 23.0);
        float alpha = uOpacity * baseFade * skyFade * bands;
        gl_FragColor = vec4(uColor * (1.05 + 0.38 * shimmer), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function _checkpointMakeBeam() {
  const group = new THREE.Group();

  const outerMat = _checkpointBeamMaterial(0.16);
  const outer = new THREE.Mesh(_checkpointBeamGeoOuter, outerMat);
  outer.position.y = _CHECKPOINT_BEAM_HEIGHT * 0.5;
  outer.frustumCulled = false;
  group.add(outer);

  const coreMat = _checkpointBeamMaterial(0.72);
  const core = new THREE.Mesh(_checkpointBeamGeoCore, coreMat);
  core.position.y = _CHECKPOINT_BEAM_HEIGHT * 0.5;
  core.frustumCulled = false;
  group.add(core);

  const discMat = new THREE.MeshBasicMaterial({
    color: _CHECKPOINT_BEAM_PENDING.clone(),
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const disc = new THREE.Mesh(_checkpointBeamGeoDisc, discMat);
  disc.rotation.x = -Math.PI * 0.5;
  disc.position.y = 0.055;
  group.add(disc);

  const ringMat = new THREE.MeshBasicMaterial({
    color: _CHECKPOINT_BEAM_PENDING.clone(),
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(_checkpointBeamGeoRing, ringMat);
  ring.rotation.x = Math.PI * 0.5;
  ring.position.y = 0.08;
  group.add(ring);

  const pulseMat = ringMat.clone();
  pulseMat.opacity = 0;
  const pulse = new THREE.Mesh(_checkpointBeamGeoRing, pulseMat);
  pulse.rotation.x = Math.PI * 0.5;
  pulse.position.y = 0.1;
  pulse.visible = false;
  group.add(pulse);

  group.visible = false;
  scene.add(group);
  return {
    group, coreMat, outerMat, discMat, ringMat, pulseMat, pulse,
    hit: false, hitAge: 0, prevZ: 0,
  };
}

function _checkpointEnsurePool() {
  if (_checkpointBeams.length) return;
  for (let i = 0; i < _CHECKPOINT_BEAM_COUNT; i++) {
    _checkpointBeams.push(_checkpointMakeBeam());
  }
}

function _checkpointSetColor(beam, color) {
  beam.coreMat.uniforms.uColor.value.copy(color);
  beam.outerMat.uniforms.uColor.value.copy(color);
  beam.discMat.color.copy(color);
  beam.ringMat.color.copy(color);
  beam.pulseMat.color.copy(color);
}

function _checkpointResetBeam(beam, x, z) {
  beam.group.position.set(x, 0, z);
  beam.group.visible = true;
  beam.prevZ = z;
  beam.hit = false;
  beam.hitAge = 0;
  beam.pulse.visible = false;
  beam.pulse.scale.set(1, 1, 1);
  beam.pulseMat.opacity = 0;
  beam.coreMat.uniforms.uOpacity.value = 0.72;
  beam.outerMat.uniforms.uOpacity.value = 0.16;
  beam.discMat.opacity = 0.12;
  beam.ringMat.opacity = 0.78;
  _checkpointSetColor(beam, _CHECKPOINT_BEAM_PENDING);
}

function _checkpointNextX() {
  const x = _CHECKPOINT_BEAM_PATTERN[_checkpointBeamPatternIdx % _CHECKPOINT_BEAM_PATTERN.length];
  _checkpointBeamPatternIdx++;
  return x;
}

function _checkpointBeamsStart() {
  _checkpointEnsurePool();
  _checkpointBeamsActive = true;
  _checkpointBeamPatternIdx = 0;
  state.checkpointHits = 0;

  const speed = Math.max(BASE_SPEED, state.speed || BASE_SPEED);
  const firstArrival = 1.45;
  for (let i = 0; i < _checkpointBeams.length; i++) {
    const arrival = firstArrival + i * _CHECKPOINT_BEAM_TIME_GAP;
    const z = shipGroup.position.z - speed * arrival;
    _checkpointResetBeam(_checkpointBeams[i], _checkpointNextX(), z);
  }
}

function _checkpointBeamsStop() {
  _checkpointBeamsActive = false;
  for (let i = 0; i < _checkpointBeams.length; i++) {
    _checkpointBeams[i].group.visible = false;
  }
}

function _checkpointBeamHit(beam) {
  beam.hit = true;
  beam.hitAge = 0;
  _checkpointSetColor(beam, _CHECKPOINT_BEAM_HIT);
  beam.coreMat.uniforms.uOpacity.value = 1.0;
  beam.outerMat.uniforms.uOpacity.value = 0.34;
  beam.discMat.opacity = 0.34;
  beam.ringMat.opacity = 1.0;
  beam.pulse.visible = true;
  beam.pulse.scale.set(1, 1, 1);
  beam.pulseMat.opacity = 1.0;

  state.checkpointHits = (state.checkpointHits || 0) + 1;
  state.playerScore += 250;
  state.score += 5;
  try { hapticMedium(); } catch (_) {}
  try { playPickup(1); } catch (_) {}
}

function _checkpointRecycle(beam, effectiveSpeed) {
  let farthestZ = 0;
  for (let i = 0; i < _checkpointBeams.length; i++) {
    const other = _checkpointBeams[i];
    if (other !== beam) farthestZ = Math.min(farthestZ, other.group.position.z);
  }
  const gap = Math.max(70, effectiveSpeed * _CHECKPOINT_BEAM_TIME_GAP);
  _checkpointResetBeam(beam, _checkpointNextX(), farthestZ - gap);
}

function _checkpointBeamsUpdate(dt, effectiveSpeed) {
  const stage = state.isDeathRun && typeof DR_SEQUENCE !== 'undefined'
    ? DR_SEQUENCE[state.seqStageIdx]
    : null;
  const shouldRun = !!(stage && stage.type === 'checkpoint_beams' && !state.introActive);

  if (!shouldRun) {
    if (_checkpointBeamsActive) _checkpointBeamsStop();
    return;
  }
  if (!_checkpointBeamsActive) _checkpointBeamsStart();

  const shipZ = shipGroup.position.z;
  const scroll = effectiveSpeed * dt;
  for (let i = 0; i < _checkpointBeams.length; i++) {
    const beam = _checkpointBeams[i];
    beam.prevZ = beam.group.position.z;
    beam.group.position.z += scroll;

    const time = state.elapsed + i * 0.37;
    beam.coreMat.uniforms.uTime.value = time;
    beam.outerMat.uniforms.uTime.value = time;
    beam.group.scale.y = 1.0 + Math.sin(time * 1.7) * 0.008;

    if (!beam.hit && beam.prevZ < shipZ && beam.group.position.z >= shipZ) {
      if (Math.abs(state.shipX - beam.group.position.x) <= _CHECKPOINT_BEAM_HIT_RADIUS) {
        _checkpointBeamHit(beam);
      } else {
        beam.coreMat.uniforms.uOpacity.value = 0.18;
        beam.outerMat.uniforms.uOpacity.value = 0.06;
        beam.discMat.opacity = 0.04;
        beam.ringMat.opacity = 0.16;
      }
    }

    if (beam.hit) {
      beam.hitAge += dt;
      const t = Math.min(1, beam.hitAge / 0.72);
      beam.pulse.scale.setScalar(1 + t * 2.8);
      beam.pulseMat.opacity = 1 - t;
      if (t >= 1) beam.pulse.visible = false;
    }

    if (beam.group.position.z > DESPAWN_Z + 24) {
      _checkpointRecycle(beam, effectiveSpeed);
    }
  }
}

window._checkpointBeamsStart = _checkpointBeamsStart;
window._checkpointBeamsStop = _checkpointBeamsStop;
