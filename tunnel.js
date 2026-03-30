import * as THREE from 'three';

// ═══════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════
const TUNNEL_SPEED       = 40;   // units/sec — forward speed through tunnel
const TURN_LERP_MS       = 250;  // ms for 90° world rotation
const SEGMENT_LENGTH     = 30;   // length of each tunnel segment
const TUNNEL_WIDTH       = 12;   // inner width
const TUNNEL_HEIGHT      = 10;   // inner height
const APPROACH_DISTANCE  = 200;  // how far away the tunnel mouth appears
const ENTRY_SEGMENTS     = 3;    // straight segments before first turn
const EXIT_SEGMENTS      = 3;    // straight segments after last turn
const JUNCTION_WARN_Z    = 60;   // show arrow indicator this far ahead
const JUNCTION_KILL_Z    = 2;    // kill if junction passes this Z without swipe
const NUM_TURNS          = 5;    // number of turn junctions

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
const state = {
  phase: 'approach', // approach | entering | tunnel | exiting | dead | open
  speed: TUNNEL_SPEED,
  elapsed: 0,
  // World rotation — "rotate the world, not the player"
  worldAngle: 0,       // current cumulative Y rotation (radians)
  targetAngle: 0,      // target Y rotation
  turnLerping: false,
  turnLerpStart: 0,
  turnLerpFrom: 0,
  turnLerpTo: 0,
  // Tunnel path
  currentJunction: 0,
  swipedThisJunction: false,
  // Entry animation
  entryProgress: 0,
  // Camera
  baseFOV: 65,
  tunnelFOV: 50,
};

// ═══════════════════════════════════════════════════
//  TUNNEL PATH DEFINITION
// ═══════════════════════════════════════════════════
// Each junction: { direction: 'left'|'right' }
// Path is: ENTRY_SEGMENTS straight → turns → EXIT_SEGMENTS straight
function generatePath() {
  const junctions = [];
  const dirs = ['left', 'right'];
  for (let i = 0; i < NUM_TURNS; i++) {
    junctions.push({ direction: dirs[Math.floor(Math.random() * 2)] });
  }
  return junctions;
}

let tunnelPath = generatePath();

// ═══════════════════════════════════════════════════
//  RENDERER, SCENE, CAMERA
// ═══════════════════════════════════════════════════
const canvas = document.createElement('canvas');
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050510, 0.006);
scene.background = new THREE.Color(0x050510);

const camera = new THREE.PerspectiveCamera(state.baseFOV, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 3.5, 12);
camera.lookAt(0, 2, -20);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ═══════════════════════════════════════════════════
//  LIGHTING
// ═══════════════════════════════════════════════════
scene.add(new THREE.AmbientLight(0x334466, 0.3));
const dirLight = new THREE.DirectionalLight(0x88ccff, 0.8);
dirLight.position.set(5, 15, 10);
scene.add(dirLight);

// ═══════════════════════════════════════════════════
//  SHIP (simple placeholder — wedge shape)
// ═══════════════════════════════════════════════════
const shipGroup = new THREE.Group();

// Fuselage
const fuselageGeo = new THREE.ConeGeometry(0.4, 3, 4);
fuselageGeo.rotateX(Math.PI / 2);
const fuselageMat = new THREE.MeshStandardMaterial({ 
  color: 0xccddff, metalness: 0.8, roughness: 0.2, emissive: 0x112244, emissiveIntensity: 0.3 
});
const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
shipGroup.add(fuselage);

// Wings
const wingGeo = new THREE.BoxGeometry(4, 0.05, 1.2);
const wingMat = new THREE.MeshStandardMaterial({ 
  color: 0x8899bb, metalness: 0.7, roughness: 0.3, emissive: 0x0a1a3a, emissiveIntensity: 0.2 
});
const wings = new THREE.Mesh(wingGeo, wingMat);
wings.position.z = 0.3;
shipGroup.add(wings);

// Engine glow
const engineGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.8 })
);
engineGlow.position.z = 1.5;
shipGroup.add(engineGlow);

shipGroup.position.set(0, 2.5, 5);
scene.add(shipGroup);

// ═══════════════════════════════════════════════════
//  WATER (simple reflective plane for approach phase)
// ═══════════════════════════════════════════════════
const waterGeo = new THREE.PlaneGeometry(400, 400);
const waterMat = new THREE.MeshStandardMaterial({
  color: 0x0a2a4a, metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.85
});
const water = new THREE.Mesh(waterGeo, waterMat);
water.rotation.x = -Math.PI / 2;
water.position.y = -0.5;
scene.add(water);

// ═══════════════════════════════════════════════════
//  TUNNEL SYSTEM
// ═══════════════════════════════════════════════════
const tunnelGroup = new THREE.Group();
scene.add(tunnelGroup);

const NEON_COLOR = new THREE.Color(0x00ccff);
const NEON_COLOR2 = new THREE.Color(0xff0066);
const WALL_COLOR = new THREE.Color(0x0a0a1a);

// Materials
const wallMat = new THREE.MeshStandardMaterial({
  color: WALL_COLOR, metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide
});
const neonMat = new THREE.MeshBasicMaterial({ color: NEON_COLOR, transparent: true, opacity: 0.9 });
const neonMat2 = new THREE.MeshBasicMaterial({ color: NEON_COLOR2, transparent: true, opacity: 0.9 });
const arrowMatL = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0 });
const arrowMatR = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0 });

// Build tunnel segments along the path
// The tunnel is built in "local path space" — a sequence of segments going down -Z,
// with turns baked in as actual geometry changes
// We use the "rotate the world" approach: all tunnel geometry is in tunnelGroup,
// and tunnelGroup gets rotated on turns.

const segments = [];      // { mesh, neonLines, z, type: 'straight'|'junction', direction }
const junctionMarkers = []; // arrow indicators at junctions

function createTunnelSegment(z, type, direction) {
  const seg = new THREE.Group();
  const W = TUNNEL_WIDTH / 2;
  const H = TUNNEL_HEIGHT;
  const L = SEGMENT_LENGTH;

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(TUNNEL_WIDTH, L), wallMat.clone());
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -L / 2);
  seg.add(floor);

  // Ceiling
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(TUNNEL_WIDTH, L), wallMat.clone());
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, -L / 2);
  seg.add(ceil);

  // Left wall
  const lWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat.clone());
  lWall.rotation.y = Math.PI / 2;
  lWall.position.set(-W, H / 2, -L / 2);
  seg.add(lWall);

  // Right wall
  const rWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat.clone());
  rWall.rotation.y = -Math.PI / 2;
  rWall.position.set(W, H / 2, -L / 2);
  seg.add(rWall);

  // Neon edge lines (horizontal strips along floor/ceiling edges)
  const neonGeo = new THREE.BoxGeometry(TUNNEL_WIDTH, 0.08, L);
  // Floor left edge
  const nl1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, L), neonMat);
  nl1.position.set(-W, 0.04, -L / 2);
  seg.add(nl1);
  // Floor right edge
  const nl2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, L), neonMat);
  nl2.position.set(W, 0.04, -L / 2);
  seg.add(nl2);
  // Ceiling left edge
  const nl3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, L), neonMat2);
  nl3.position.set(-W, H, -L / 2);
  seg.add(nl3);
  // Ceiling right edge
  const nl4 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, L), neonMat2);
  nl4.position.set(W, H, -L / 2);
  seg.add(nl4);

  // Vertical neon strips at segment boundaries
  const vStrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, H, 0.08), neonMat);
  const vs1 = vStrip.clone(); vs1.position.set(-W, H / 2, 0); seg.add(vs1);
  const vs2 = vStrip.clone(); vs2.position.set(W, H / 2, 0); seg.add(vs2);
  const vs3 = vStrip.clone(); vs3.position.set(-W, H / 2, -L); seg.add(vs3);
  const vs4 = vStrip.clone(); vs4.position.set(W, H / 2, -L); seg.add(vs4);

  seg.position.z = z;

  // Junction markers (arrow on the wall you should turn toward)
  if (type === 'junction') {
    // End wall (the wall you'll crash into if you don't turn)
    const endWall = new THREE.Mesh(
      new THREE.PlaneGeometry(TUNNEL_WIDTH, H),
      wallMat.clone()
    );
    endWall.position.set(0, H / 2, -L);
    seg.add(endWall);

    // Neon frame on end wall
    const frameH = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL_WIDTH, 0.1, 0.1), neonMat2);
    const fh1 = frameH.clone(); fh1.position.set(0, 0, -L); seg.add(fh1);
    const fh2 = frameH.clone(); fh2.position.set(0, H, -L); seg.add(fh2);
    const frameV = new THREE.Mesh(new THREE.BoxGeometry(0.1, H, 0.1), neonMat2);
    const fv1 = frameV.clone(); fv1.position.set(-W, H / 2, -L); seg.add(fv1);
    const fv2 = frameV.clone(); fv2.position.set(W, H / 2, -L); seg.add(fv2);

    // Opening on the side the player should turn
    // Remove part of the side wall at the end and create an opening
    const openSide = direction === 'left' ? -1 : 1;
    const openWall = new THREE.Mesh(
      new THREE.PlaneGeometry(SEGMENT_LENGTH * 0.6, H),
      new THREE.MeshBasicMaterial({ color: 0x001122, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
    );
    openWall.rotation.y = openSide > 0 ? -Math.PI / 2 : Math.PI / 2;
    openWall.position.set(openSide * W, H / 2, -L + SEGMENT_LENGTH * 0.3);
    // We'll actually just add a glowing arrow indicator
    
    // Arrow indicator
    const arrowShape = new THREE.Shape();
    const as = 1.5; // arrow size
    if (direction === 'left') {
      arrowShape.moveTo(as, 0);
      arrowShape.lineTo(-as, 0);
      arrowShape.lineTo(0, as);
      arrowShape.lineTo(as, 0);
    } else {
      arrowShape.moveTo(-as, 0);
      arrowShape.lineTo(as, 0);
      arrowShape.lineTo(0, as);
      arrowShape.lineTo(-as, 0);
    }
    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    const arrowMat = new THREE.MeshBasicMaterial({ 
      color: direction === 'left' ? 0x00ff88 : 0xff8800,
      transparent: true, opacity: 0, side: THREE.DoubleSide 
    });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    // Position arrow on the end wall
    arrow.position.set(direction === 'left' ? -2 : 2, H / 2, -L + 0.1);
    seg.add(arrow);

    junctionMarkers.push({ 
      mesh: arrow, 
      material: arrowMat,
      worldZ: z - L, // world Z of the end wall
      direction,
      index: junctionMarkers.length
    });
  }

  tunnelGroup.add(seg);
  return { group: seg, z, type, direction, length: L };
}

// Tunnel mouth (the opening you fly into)
const mouthGroup = new THREE.Group();
function createTunnelMouth(z) {
  const W = TUNNEL_WIDTH / 2 + 2;
  const H = TUNNEL_HEIGHT + 2;
  
  // Neon arch frame
  const archMat = new THREE.MeshBasicMaterial({ color: 0x00ccff });
  // Top
  const top = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.15, 0.15), archMat);
  top.position.set(0, TUNNEL_HEIGHT + 1, 0);
  mouthGroup.add(top);
  // Left
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.15, H, 0.15), archMat);
  left.position.set(-W, H / 2 - 1, 0);
  mouthGroup.add(left);
  // Right
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.15, H, 0.15), archMat);
  right.position.set(W, H / 2 - 1, 0);
  mouthGroup.add(right);

  // Outer glow ring
  const ringGeo = new THREE.TorusGeometry(Math.max(W, H / 2) + 1, 0.1, 8, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x0088cc, transparent: true, opacity: 0.4 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(0, H / 2 - 1, 0);
  mouthGroup.add(ring);

  mouthGroup.position.z = z;
  tunnelGroup.add(mouthGroup);
}

function buildTunnel() {
  // Clear
  while (tunnelGroup.children.length) tunnelGroup.remove(tunnelGroup.children[0]);
  segments.length = 0;
  junctionMarkers.length = 0;

  let z = -APPROACH_DISTANCE;
  
  // Tunnel mouth
  createTunnelMouth(z);

  // Entry straight segments
  for (let i = 0; i < ENTRY_SEGMENTS; i++) {
    segments.push(createTunnelSegment(z, 'straight'));
    z -= SEGMENT_LENGTH;
  }

  // Turn junctions with straight segments between
  for (let i = 0; i < tunnelPath.length; i++) {
    segments.push(createTunnelSegment(z, 'junction', tunnelPath[i].direction));
    z -= SEGMENT_LENGTH;
    // Add a straight segment between junctions (except after last)
    if (i < tunnelPath.length - 1) {
      segments.push(createTunnelSegment(z, 'straight'));
      z -= SEGMENT_LENGTH;
    }
  }

  // Exit straight segments
  for (let i = 0; i < EXIT_SEGMENTS; i++) {
    segments.push(createTunnelSegment(z, 'straight'));
    z -= SEGMENT_LENGTH;
  }
}

// ═══════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════
let pendingSwipe = null; // 'left' | 'right' | null

// Keyboard
document.addEventListener('keydown', (e) => {
  if (state.phase === 'dead') return;
  if (e.key === 'ArrowLeft' || e.key === 'a') pendingSwipe = 'left';
  if (e.key === 'ArrowRight' || e.key === 'd') pendingSwipe = 'right';
});

// Touch swipe
let touchStartX = 0;
let touchStartY = 0;
document.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (state.phase === 'dead') return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
    pendingSwipe = dx < 0 ? 'left' : 'right';
  }
}, { passive: true });

// ═══════════════════════════════════════════════════
//  TURN MECHANIC
// ═══════════════════════════════════════════════════
function attemptTurn(direction) {
  if (state.currentJunction >= junctionMarkers.length) return;
  const junc = junctionMarkers[state.currentJunction];
  
  // Check if we're close enough to the junction
  const juncWorldZ = getJunctionWorldZ(state.currentJunction);
  const dist = juncWorldZ - shipGroup.position.z;
  
  // Allow turning when junction is within range
  if (dist > JUNCTION_WARN_Z || dist < -5) return;
  if (state.swipedThisJunction) return;
  
  state.swipedThisJunction = true;

  if (direction === junc.direction) {
    // Correct turn — rotate the world
    const angle = direction === 'left' ? Math.PI / 2 : -Math.PI / 2;
    state.targetAngle += angle;
    state.turnLerping = true;
    state.turnLerpStart = performance.now();
    state.turnLerpFrom = state.worldAngle;
    state.turnLerpTo = state.targetAngle;
    
    // Advance to next junction
    state.currentJunction++;
    state.swipedThisJunction = false;
  } else {
    // Wrong turn — death
    killPlayer();
  }
}

function getJunctionWorldZ(index) {
  if (index >= junctionMarkers.length) return -99999;
  const marker = junctionMarkers[index];
  // The junction's Z in tunnel-local space + tunnelGroup's current Z offset
  return marker.worldZ + tunnelGroup.position.z;
}

function killPlayer() {
  state.phase = 'dead';
  document.getElementById('death-overlay').classList.add('show');
}

// ═══════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════
const clock = new THREE.Clock();

function update() {
  const dt = Math.min(clock.getDelta(), 0.05);
  state.elapsed += dt;

  if (state.phase === 'dead') return;

  // Move tunnel toward ship (world moves, ship stays)
  tunnelGroup.position.z += state.speed * dt;

  // ── Phase: approach (ship flying toward tunnel opening) ──
  if (state.phase === 'approach') {
    // Check if tunnel mouth has reached the ship
    const mouthZ = -APPROACH_DISTANCE + tunnelGroup.position.z;
    if (mouthZ > shipGroup.position.z - 10) {
      state.phase = 'entering';
      state.entryProgress = 0;
    }
  }

  // ── Phase: entering (camera transition) ──
  if (state.phase === 'entering') {
    state.entryProgress += dt * 2; // ~0.5s transition
    const t = Math.min(state.entryProgress, 1);
    const ease = t * t * (3 - 2 * t); // smoothstep
    
    // Tighten FOV
    camera.fov = THREE.MathUtils.lerp(state.baseFOV, state.tunnelFOV, ease);
    camera.updateProjectionMatrix();
    
    // Move camera closer and lower
    camera.position.y = THREE.MathUtils.lerp(3.5, 3.0, ease);
    camera.position.z = THREE.MathUtils.lerp(12, 8, ease);
    
    // Fade water
    waterMat.opacity = THREE.MathUtils.lerp(0.85, 0, ease);
    
    // Ship pitch up slightly
    shipGroup.rotation.x = THREE.MathUtils.lerp(0, -0.12, ease);

    if (t >= 1) {
      state.phase = 'tunnel';
      water.visible = false;
      document.getElementById('prompt').style.opacity = '1';
    }
  }

  // ── Phase: tunnel (main gameplay) ──
  if (state.phase === 'tunnel') {
    // Process pending swipe
    if (pendingSwipe) {
      attemptTurn(pendingSwipe);
      pendingSwipe = null;
    }

    // Check if player missed a junction (it passed behind them)
    if (state.currentJunction < junctionMarkers.length) {
      const juncZ = getJunctionWorldZ(state.currentJunction);
      if (juncZ > shipGroup.position.z + JUNCTION_KILL_Z && !state.swipedThisJunction) {
        killPlayer();
      }
    }

    // Check if all junctions cleared — start exit
    if (state.currentJunction >= junctionMarkers.length) {
      // Check if we're past the last segment
      const lastSeg = segments[segments.length - 1];
      const lastZ = lastSeg.z - lastSeg.length + tunnelGroup.position.z;
      if (lastZ > shipGroup.position.z + 20) {
        state.phase = 'exiting';
        state.entryProgress = 0;
      }
    }

    // Update arrow indicators
    for (const junc of junctionMarkers) {
      const juncZ = junc.worldZ + tunnelGroup.position.z;
      const dist = juncZ - shipGroup.position.z;
      if (dist < JUNCTION_WARN_Z && dist > -5 && junc.index >= state.currentJunction) {
        // Fade in arrow
        const t = 1 - Math.max(0, dist) / JUNCTION_WARN_Z;
        junc.material.opacity = t * 0.9;
        // Pulse
        junc.material.opacity *= 0.7 + 0.3 * Math.sin(state.elapsed * 8);
      } else {
        junc.material.opacity = 0;
      }
    }
  }

  // ── Phase: exiting ──
  if (state.phase === 'exiting') {
    state.entryProgress += dt * 1.5;
    const t = Math.min(state.entryProgress, 1);
    const ease = t * t * (3 - 2 * t);
    
    // Widen FOV back
    camera.fov = THREE.MathUtils.lerp(state.tunnelFOV, state.baseFOV, ease);
    camera.updateProjectionMatrix();
    camera.position.y = THREE.MathUtils.lerp(3.0, 3.5, ease);
    camera.position.z = THREE.MathUtils.lerp(8, 12, ease);
    
    // Fade water back in
    water.visible = true;
    waterMat.opacity = THREE.MathUtils.lerp(0, 0.85, ease);
    
    // Ship pitch back to level
    shipGroup.rotation.x = THREE.MathUtils.lerp(-0.12, 0, ease);

    if (t >= 1) {
      state.phase = 'open';
      document.getElementById('prompt').style.opacity = '0';
      document.getElementById('hud').textContent = 'TUNNEL CLEARED!';
    }
  }

  // ── Turn lerp ──
  if (state.turnLerping) {
    const elapsed = performance.now() - state.turnLerpStart;
    const t = Math.min(elapsed / TURN_LERP_MS, 1);
    const ease = t * t * (3 - 2 * t);
    state.worldAngle = THREE.MathUtils.lerp(state.turnLerpFrom, state.turnLerpTo, ease);
    tunnelGroup.rotation.y = state.worldAngle;
    if (t >= 1) {
      state.turnLerping = false;
      state.worldAngle = state.targetAngle;
      tunnelGroup.rotation.y = state.worldAngle;
    }
  }

  // ── Ship idle bob ──
  shipGroup.position.y = 2.5 + Math.sin(state.elapsed * 2) * 0.1;
  
  // ── Engine glow pulse ──
  engineGlow.scale.setScalar(1 + Math.sin(state.elapsed * 6) * 0.15);
}

function render() {
  requestAnimationFrame(render);
  update();
  renderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════
//  RESTART
// ═══════════════════════════════════════════════════
function restartGame() {
  document.getElementById('death-overlay').classList.remove('show');
  document.getElementById('hud').textContent = 'TUNNEL PROTO';
  document.getElementById('prompt').style.opacity = '0';
  
  // Reset state
  state.phase = 'approach';
  state.speed = TUNNEL_SPEED;
  state.elapsed = 0;
  state.worldAngle = 0;
  state.targetAngle = 0;
  state.turnLerping = false;
  state.currentJunction = 0;
  state.swipedThisJunction = false;
  state.entryProgress = 0;
  
  // Reset transforms
  tunnelGroup.position.set(0, 0, 0);
  tunnelGroup.rotation.set(0, 0, 0);
  shipGroup.position.set(0, 2.5, 5);
  shipGroup.rotation.set(0, 0, 0);
  camera.fov = state.baseFOV;
  camera.position.set(0, 3.5, 12);
  camera.updateProjectionMatrix();
  water.visible = true;
  waterMat.opacity = 0.85;

  // New random path
  tunnelPath = generatePath();
  buildTunnel();
  pendingSwipe = null;
}
window.restartGame = restartGame;

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
buildTunnel();
render();
