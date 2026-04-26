import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.167.0/examples/jsm/loaders/GLTFLoader.js';

// ── BOOT LOAD GATE ─────────────────────────────────────
// Modules push readiness promises into window.__loadGate.promises.
// Tail script (82-main-late-tail.js) waits on Promise.all + fades the loader.
// Status messages displayed on the loader bar via __loadGate.setStatus(s, pct).
window.__loadGate = window.__loadGate || {
  promises: [],
  setStatus(s, pct) {
    const st = document.getElementById('app-loader-status');
    const fl = document.getElementById('app-loader-fill');
    if (st && s) st.textContent = s;
    if (fl && pct != null) fl.style.width = Math.max(0, Math.min(100, pct)) + '%';
  },
  add(label, p) {
    if (p && typeof p.then === 'function') this.promises.push(p.catch(() => {}));
  }
};


