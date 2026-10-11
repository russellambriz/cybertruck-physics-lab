// Procedural Cybertruck built entirely from code (no downloaded models).
// Frame: +X forward, +Y up, +Z = truck's right side. Units: meters.
import * as THREE from 'three';

export const DIM = { halfL: 2.84, halfW: 1.0, wheelR: 0.44, wheelW: 0.32, axle: 1.82, track: 0.86, baseClear: 0.305, cgY: 0.9 };

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function canvasTex(w, h, draw, { repeat = [1, 1], srgb = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function brushedTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const y = Math.random() * h, x = Math.random() * w, l = 40 + Math.random() * 320;
      const v = (85 + Math.random() * 100) | 0;
      g.strokeStyle = `rgba(${v},${v},${v},0.22)`; g.lineWidth = 0.4 + Math.random();
      g.beginPath(); g.moveTo(x - w, y); g.lineTo(x - w + l, y); g.moveTo(x, y); g.lineTo(x + l, y); g.stroke();
    }
  }, { repeat: [0.7, 0.7] });
}

// Collects triangles, fixing winding so normals point away from `center` (faceted flat shading).
class TriBuilder {
  constructor(center, uvFn) { this.p = []; this.uv = []; this.c = center; this.uvFn = uvFn || ((v) => [v.x * 0.5, (v.y + Math.abs(v.z)) * 0.5]); }
  tri(a, b, c) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const cen = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3).sub(this.c);
    if (n.dot(cen) < 0) [b, c] = [c, b];
    for (const v of [a, b, c]) { this.p.push(v.x, v.y, v.z); const t = this.uvFn(v); this.uv.push(t[0], t[1]); }
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

// Body key points
const NOSE = [2.84, 1.04], A_ = [2.21, 1.20], APEX = [-0.1, 1.79], TAIL = [-2.84, 1.30];
const ZA = 0.985, ZB = 0.70;
const pA = (s) => V(A_[0], A_[1], s * ZA), pB = (s) => V(APEX[0], APEX[1], s * ZB), pC = (s) => V(TAIL[0], TAIL[1], s * ZA);
const arch = (ax) => [[ax - 0.62, 0.38], [ax - 0.40, 1.0], [ax + 0.40, 1.0], [ax + 0.62, 0.38]];

export function roofLine(x) { // top silhouette height at x (design ride height)
  if (x > NOSE[0] || x < TAIL[0]) return 0;
  if (x >= APEX[0]) return NOSE[1] + (NOSE[0] - x) * (APEX[1] - NOSE[1]) / (NOSE[0] - APEX[0]);
  return APEX[1] - (APEX[0] - x) * (APEX[1] - TAIL[1]) / (APEX[0] - TAIL[0]);
}

function sidePlaneZ(s) { // z on the side greenhouse plane for (x, y)
  const a = pA(s), b = pB(s), c = pC(s);
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  if (n.z * s < 0) n.negate();
  const nn = n.clone().normalize();
  return { z: (x, y) => a.z - (n.x * (x - a.x) + n.y * (y - a.y)) / n.z, n: nn };
}

function polyOnSide(pts, s, off, center) {
  const plane = sidePlaneZ(s);
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  const sg = new THREE.ShapeGeometry(shape);
  const pos = sg.attributes.position, idx = sg.index.array;
  const tb = new TriBuilder(center, (v) => [v.x * 0.4, v.y * 0.4]);
  const P = (i) => { const x = pos.getX(i), y = pos.getY(i); return V(x, y, plane.z(x, y)).addScaledVector(plane.n, off); };
  for (let i = 0; i < idx.length; i += 3) tb.tri(P(idx[i]), P(idx[i + 1]), P(idx[i + 2]));
  sg.dispose();
  return tb.build();
}

function quadOnFace(L0, L1, R0, R1, u0, u1, w0, w1, off, center, uvScale = [1, 1]) {
  // bilinear patch on a planar face with edges L0->L1 (left) and R0->R1 (right)
  const P = (u, w) => { const l = L0.clone().lerp(L1, u), r = R0.clone().lerp(R1, u); return l.lerp(r, w); };
  const a = P(u0, w0), b = P(u1, w0), c = P(u1, w1), d = P(u0, w1);
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
  if (n.dot(a.clone().sub(center)) < 0) n.negate();
  [a, b, c, d].forEach((v) => v.addScaledVector(n, off));
  const g = new THREE.BufferGeometry();
  const tb = new TriBuilder(center);
  tb.quad(a, b, c, d);
  const geo = tb.build();
  // custom UVs: u along length, w across
  const uv = [], ord = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = V(pos.getX(i), pos.getY(i), pos.getZ(i));
    const du = v.distanceTo(a) < 1e-4 ? [u0, w0] : v.distanceTo(b) < 1e-4 ? [u1, w0] : v.distanceTo(c) < 1e-4 ? [u1, w1] : [u0, w1];
    uv.push(du[0] * uvScale[0], du[1] * uvScale[1]);
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

export function buildTruck() {
  const root = new THREE.Group(); root.name = 'truck';
  const rig = new THREE.Group(); rig.position.y = DIM.cgY;
  const body = new THREE.Group(); body.position.y = -DIM.cgY;
  root.add(rig); rig.add(body);

  const mats = {
    steel: new THREE.MeshPhysicalMaterial({ color: 0xa4aab0, metalness: 1, roughness: 0.62, roughnessMap: brushedTex(), envMapIntensity: 0.95, clearcoat: 0.12, clearcoatRoughness: 0.25 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: 0.3, roughness: 0.04, envMapIntensity: 0.8, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.93 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.78, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide }),
    tonneau: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.55, metalness: 0.6, map: canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#9aa0a6'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a3e43'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 2); }, { srgb: true }) }),
    lightW: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf6ff, emissiveIntensity: 4 }),
    lightR: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 2.4 }),
    seam: new THREE.MeshBasicMaterial({ color: 0x15171a }),
  };
  const xrayable = []; // meshes swapped to a ghost material in x-ray mode
  const add = (mesh, parent = body, xr = true) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); if (xr) xrayable.push(mesh); return mesh; };

  // ---- Lower body: extruded side profile with trapezoid wheel arches
  const bev = 0.025;
  const prof = [[-2.84, 0.60], [-2.64, 0.38], ...arch(-DIM.axle), ...arch(DIM.axle), [2.64, 0.38], [2.84, 0.58], NOSE, A_, TAIL];
  const shape = new THREE.Shape(prof.map((p) => new THREE.Vector2(p[0], p[1])));
  const lowerGeo = new THREE.ExtrudeGeometry(shape, { depth: 2 * DIM.halfW - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, curveSegments: 1 });
  lowerGeo.translate(0, 0, -(DIM.halfW - bev));
  add(new THREE.Mesh(lowerGeo, mats.steel));

  // ---- Greenhouse prism: windshield/roof plane, rear deck, tumblehome sides (one triangle each)
  const cen = V(0, 1.25, 0);
  const tb = new TriBuilder(cen);
  tb.quad(pA(-1), pA(1), pB(1), pB(-1));
  tb.quad(pB(-1), pB(1), pC(1), pC(-1));
  tb.tri(pA(-1), pB(-1), pC(-1)); tb.tri(pA(1), pB(1), pC(1));
  add(new THREE.Mesh(tb.build(), mats.steel));

  // ---- Glass
  const ws = quadOnFace(pA(-1), pB(-1), pA(1), pB(1), 0.29, 0.95, 0.035, 0.965, 0.005, cen);
  add(new THREE.Mesh(ws, mats.glass));
  const rw = quadOnFace(pB(-1), pC(-1), pB(1), pC(1), 0.04, 0.2, 0.08, 0.92, 0.005, cen);
  add(new THREE.Mesh(rw, mats.glass));
  const ton = quadOnFace(pB(-1), pC(-1), pB(1), pC(1), 0.33, 0.995, 0.085, 0.915, 0.004, cen, [14, 1]);
  add(new THREE.Mesh(ton, mats.tonneau));
  const winPts = [[1.50, 1.235], [1.50, 1.307], [-0.05, 1.702], [-1.0, 1.559], [-1.0, 1.29]];
  for (const s of [-1, 1]) {
    add(new THREE.Mesh(polyOnSide(winPts, s, 0.005, cen), mats.glass));
    add(new THREE.Mesh(polyOnSide([[0.33, 1.24], [0.33, 1.73], [0.27, 1.735], [0.27, 1.24]], s, 0.009, cen), mats.steel)); // B-pillar
  }

  // ---- Light bars
  const fl = add(new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.026, 1.94), mats.lightW), body, false); fl.position.set(2.862, 1.022, 0); fl.castShadow = false;
  const rl = add(new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.038, 1.94), mats.lightR), body, false); rl.position.set(-2.862, 1.255, 0); rl.castShadow = false;

  // ---- Arch cladding, rocker, underbody, liners, seams, mirrors
  for (const ax of [-DIM.axle, DIM.axle]) {
    const a = arch(ax);
    const o = [[a[0][0] - 0.09, 0.38], [a[1][0] - 0.07, 1.075], [a[2][0] + 0.07, 1.075], [a[3][0] + 0.09, 0.38]];
    const sh = new THREE.Shape([...o, ...a.slice().reverse()].map((p) => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false });
    for (const s of [-1, 1]) {
      const m = add(new THREE.Mesh(g, mats.trim)); m.position.z = s > 0 ? DIM.halfW - 0.012 : -DIM.halfW - 0.018;
    }
    // inner liner: three strips following the arch, spanning the body width
    const lb = new TriBuilder(V(ax, 0.3, 0));
    for (let i = 0; i < 3; i++) {
      const [x0, y0] = a[i], [x1, y1] = a[i + 1];
      lb.quad(V(x0, y0, -0.99), V(x1, y1, -0.99), V(x1, y1, 0.99), V(x0, y0, 0.99));
    }
    add(new THREE.Mesh(lb.build(), mats.dark));
  }
  for (const s of [-1, 1]) {
    const rk = add(new THREE.Mesh(new THREE.BoxGeometry(2 * (DIM.axle - 0.62) - 0.02, 0.12, 0.03), mats.trim)); rk.position.set(0, 0.44, s * (DIM.halfW + 0.003));
    for (const x of [1.18, 0.30, -0.95]) {
      const sm = add(new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.72), mats.seam), body); sm.position.set(x, 0.86, s * (DIM.halfW + 0.002)); sm.rotation.y = s > 0 ? 0 : Math.PI; sm.castShadow = false;
    }
    const mir = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.15), mats.trim)); mir.position.set(1.62, 1.30, s * 1.06); mir.rotation.y = s * 0.15;
  }
  const ub = add(new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.08, 1.9), mats.trim)); ub.position.set(0, 0.345, 0);

  // ---- Wheels with aero covers
  const wheels = [];
  const tireGeo = (() => {
    const R = DIM.wheelR, hw = DIM.wheelW / 2;
    const pts = [[0.29, -hw + 0.01], [0.40, -hw], [0.425, -hw + 0.012], [0.437, -hw + 0.04], [R, -hw + 0.07], [R, hw - 0.07], [0.437, hw - 0.04], [0.425, hw - 0.012], [0.40, hw], [0.29, hw - 0.01]];
    const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), 72);
    g.rotateX(Math.PI / 2);
    return g;
  })();
  const treadTex = canvasTex(1024, 64, (g, w, h) => {
    g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0d0d0d';
    for (let x = 0; x < w; x += w / 54) { g.fillRect(x, h * 0.36, 5, h * 0.28); g.fillRect(x + 4, h * 0.38, 3, h * 0.08); g.fillRect(x + 8, h * 0.54, 3, h * 0.08); }
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h * 0.3); g.fillRect(0, h * 0.7, w, h * 0.3);
  }, { srgb: true });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: treadTex, roughness: 0.92, metalness: 0 });
  const coverMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.45, metalness: 0.55 });
  const coverMat2 = new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.35, metalness: 0.8 });
  const coverGeo = new THREE.CylinderGeometry(0.335, 0.335, 0.03, 48).rotateX(Math.PI / 2);
  const bladeShape = new THREE.Shape([new THREE.Vector2(0.09, 0), new THREE.Vector2(0.31, -0.085), new THREE.Vector2(0.31, 0.04)]);
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.008, bevelEnabled: false });
  const hubGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.026, 6).rotateX(Math.PI / 2);
  for (const ax of [DIM.axle, -DIM.axle]) for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(ax, DIM.wheelR, s * DIM.track);
    const steer = new THREE.Group(); const spin = new THREE.Group();
    pivot.add(steer); steer.add(spin);
    const tire = new THREE.Mesh(tireGeo, tireMat); tire.castShadow = tire.receiveShadow = true; spin.add(tire);
    const cover = new THREE.Mesh(coverGeo, coverMat); cover.position.z = s * (DIM.wheelW / 2 - 0.02); spin.add(cover);
    for (let k = 0; k < 6; k++) {
      const b = new THREE.Mesh(bladeGeo, k % 2 ? coverMat2 : coverMat); b.rotation.z = k * Math.PI / 3;
      b.position.z = s * (DIM.wheelW / 2 - 0.005) - (s < 0 ? 0.008 : 0); spin.add(b);
    }
    const hub = new THREE.Mesh(hubGeo, coverMat2); hub.position.z = s * (DIM.wheelW / 2 + 0.003); spin.add(hub);
    root.add(pivot);
    wheels.push({ pivot, steer, spin, front: ax > 0, side: s, ax });
  }

  // ---- Suspension: lower arm + air spring (bellows) + damper per corner
  const suspension = [];
  const bellowsGeo = (() => {
    const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector2(0.075 + 0.012 * Math.abs(Math.sin(t * Math.PI * 3)), t - 0.5)); }
    return new THREE.LatheGeometry(pts, 20);
  })();
  const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.9, roughness: 0.3 });
  const damperGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 10);
  for (const w of wheels) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.5), alu); arm.position.set(w.ax, 0.40, w.side * 0.45); root.add(arm);
    const bag = new THREE.Mesh(bellowsGeo, rubber); bag.castShadow = true; root.add(bag);
    const dmp = new THREE.Mesh(damperGeo, alu); root.add(dmp);
    suspension.push({ w, bag, dmp, lower: V(w.ax - 0.05, 0.52, w.side * 0.62), mount: V(w.ax - 0.05, 0.98, w.side * 0.58) });
  }

  // ---- X-ray edge overlay
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const edges = [];
  for (const m of xrayable) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), edgeMat);
    e.visible = false; m.add(e); edges.push(e);
    m.userData.mat = m.material;
  }

  // Pulse markers for the materials mode
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x4de1ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const markerSteel = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.19, 48), ringMat); markerSteel.position.set(0.75, 0.85, DIM.halfW + 0.03);
  const markerGlass = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.19, 48), ringMat.clone());
  { const p = pA(-1).lerp(pB(-1), 0.6).lerp(pA(1).lerp(pB(1), 0.6), 0.5); markerGlass.position.copy(p).add(V(0.05, 0.05, 0)); markerGlass.lookAt(p.clone().add(V(0.255, 1, 0))); }
  body.add(markerSteel, markerGlass); markerSteel.visible = markerGlass.visible = false;

  return { root, rig, body, wheels, suspension, xrayable, edges, mats, markers: { steel: markerSteel, glass: markerGlass } };
}

const _y = V(0, 1, 0), _a = V(), _b = V(), _d = V(), _q = new THREE.Quaternion();
export function updateSuspension(t) {
  t.rig.updateMatrix(); t.body.updateMatrix();
  for (const s of t.suspension) {
    _a.copy(s.lower);
    _b.copy(s.mount).applyMatrix4(t.body.matrix).applyMatrix4(t.rig.matrix);
    _d.subVectors(_b, _a); const len = _d.length(); _d.divideScalar(len);
    _q.setFromUnitVectors(_y, _d);
    s.bag.position.copy(_a).addScaledVector(_d, len * 0.62); s.bag.quaternion.copy(_q); s.bag.scale.set(1, len * 0.55, 1);
    s.dmp.position.copy(_a).addScaledVector(_d, len * 0.32); s.dmp.quaternion.copy(_q); s.dmp.scale.set(1, len * 0.6, 1);
  }
}
