// Qualitative streamline visualisation around the truck (potential-flow-style displacement, not CFD).
import * as THREE from 'three';
import { roofLine } from './truck.js';

const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const X0 = -12, X1 = 8, STEP = 0.05;

export class Airflow {
  constructor(max = 2400, segs = 7) {
    this.max = max; this.segs = segs; this.count = 1400;
    const nv = max * segs * 2;
    this.pos = new Float32Array(nv * 3); this.col = new Float32Array(nv * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lines = new THREE.LineSegments(g, this.mat); this.lines.frustumCulled = false;
    this.group = new THREE.Group(); this.group.add(this.lines);

    // smoothed body envelope tables
    const n = Math.round((X1 - X0) / STEP) + 1;
    const raw = new Float32Array(n), w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = X0 + i * STEP;
      let h = roofLine(x);
      if (x > 2.84) h = 1.04 * Math.pow(1 - sm(2.84, 4.3, x), 1.6);
      else if (x < -2.84) h = 1.30 * Math.exp((x + 2.84) / 2.4);
      raw[i] = h > 0 ? h + 0.09 : 0;
      w[i] = x > 2.84 ? 1.05 * (1 - sm(2.84, 4.0, x)) : x < -2.84 ? 1.05 * Math.exp((x + 2.84) / 2.8) : 1.05;
    }
    this.H = new Float32Array(n); this.W = w;
    const k = 6;
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = -k; j <= k; j++) { const q = i + j; if (q >= 0 && q < n) { s += raw[q]; c++; } } this.H[i] = Math.max(raw[i], s / c); }

    this.px = new Float32Array(max); this.y0 = new Float32Array(max); this.z0 = new Float32Array(max); this.ph = new Float32Array(max);
    for (let i = 0; i < max; i++) this._seed(i, X0 + Math.random() * (X1 - X0));
    this.t = 0; this.rideOff = 0;
    this._p = new Float32Array(4);
  }

  _seed(i, x) {
    this.px[i] = x;
    const r = Math.random();
    if (r < 0.1) { this.y0[i] = 0.07 + Math.random() * 0.12; this.z0[i] = (Math.random() * 2 - 1) * 0.9; }
    else { this.y0[i] = 0.3 + Math.pow(Math.random(), 1.3) * 2.5; { const u = Math.random() * 2 - 1; this.z0[i] = Math.sign(u) * Math.pow(Math.abs(u), 1.4) * 2.3; } }
    this.ph[i] = Math.random() * 100;
  }

  _tab(arr, x) { const f = (x - X0) / STEP; const i = Math.floor(f); if (i < 0) return arr[0]; if (i >= arr.length - 1) return arr[arr.length - 1]; const t = f - i; return arr[i] * (1 - t) + arr[i + 1] * t; }

  // map undisturbed (x, y0, z0) -> displaced position + local speed ratio
  _map(x, y0, z0, ph, out) {
    const off = this.rideOff;
    let H = this._tab(this.H, x); if (H > 0) H += off * Math.min(1, H);
    const W = this._tab(this.W, x);
    const az = Math.abs(z0);
    const inside = az < 1.0 ? 1 : 1 - sm(1.0, 1.3, az);
    let y = y0, z = z0, ratio = 1;
    if (y0 > 0.25) {
      const yy = Math.sqrt(y0 * y0 + H * H);
      y = y0 + (yy - y0) * inside;
      const comp = H > 0 ? y0 / yy : 1;
      ratio = 1 + (1 / Math.max(comp, 0.45) - 1) * 0.55 * inside;
    } else {
      ratio = 1 - 0.25 * inside * (H > 0.5 ? 1 : 0);
    }
    const below = Math.min(1, Math.max(0, (H + 0.2 - y0) / 0.4));
    const lat = (1 - inside) * below;
    if (lat > 0) { z = Math.sign(z0) * Math.sqrt(z0 * z0 + W * W * lat); ratio *= 1 + 0.25 * lat * (W / 1.05) * Math.exp(-(az - 1) * 1.2); }
    // stagnation at nose, slow wake behind the tailgate
    const stag = Math.exp(-Math.pow((x - 3.0) / 0.4, 2)) * inside * (y0 < 1.05 ? 1 : 0.25);
    ratio *= 1 - 0.75 * stag;
    if (x < -2.7) {
      const wk = sm(-2.7, -4.0, x) * Math.exp((x + 4) / 7) * (az < 1.5 ? 1 : 0.3) * (y0 < 2.0 ? 1 : 0.4);
      ratio *= 1 - 0.45 * wk;
      const a = 0.32 * wk;
      y += a * Math.sin(x * 2.3 + ph + this.t * 5.0) * (0.6 + 0.4 * Math.sin(ph * 3));
      z += a * Math.cos(x * 1.9 + ph * 1.7 + this.t * 4.3);
      if (y < 0.03) y = 0.03;
    }
    out[0] = x; out[1] = y; out[2] = z; out[3] = ratio;
  }

  setCount(n) { this.count = Math.min(this.max, n); this.lines.geometry.setDrawRange(0, this.count * this.segs * 2); }

  update(dt, U, rideOff) {
    this.rideOff = rideOff;
    this.t += dt;
    const slow = 0.25;                        // animation slowed 4x
    const trail = Math.min(2.6, Math.max(0.25, U * 0.075));
    const vis = Math.min(1, U / 4);
    this.mat.opacity = 0.15 + 0.85 * vis;
    const p = this._p, segs = this.segs;
    let vi = 0;
    for (let i = 0; i < this.count; i++) {
      this._map(this.px[i], this.y0[i], this.z0[i], this.ph[i], p);
      this.px[i] -= U * slow * p[3] * dt;
      if (this.px[i] < X0) this._seed(i, X1 - Math.random() * 0.5);
      let lx = p[0], ly = p[1], lz = p[2], lr = p[3];
      for (let s = 1; s <= segs; s++) {
        this._map(this.px[i] + trail * s / segs, this.y0[i], this.z0[i], this.ph[i], p);
        const fA = 1 - (s - 1) / segs, fB = 1 - s / segs;
        // colour by local speed ratio: slow -> red/orange, free stream -> ice white, fast -> blue/violet
        const t = Math.min(1, Math.max(0, (lr - 0.35) / 1.1));
        let r, g, b;
        if (t < 0.55) { const q = t / 0.55; r = 1.0 - 0.8 * q; g = 0.32 + 0.43 * q; b = 0.06 + 0.94 * q; }
        else { const q = (t - 0.55) / 0.45; r = 0.2 + 0.6 * q; g = 0.75 - 0.35 * q; b = 1.0; }
        const k = 0.42 * vis + 0.1;
        this.pos[vi * 3] = lx; this.pos[vi * 3 + 1] = ly; this.pos[vi * 3 + 2] = lz;
        this.col[vi * 3] = r * fA * k; this.col[vi * 3 + 1] = g * fA * k; this.col[vi * 3 + 2] = b * fA * k; vi++;
        this.pos[vi * 3] = p[0]; this.pos[vi * 3 + 1] = p[1]; this.pos[vi * 3 + 2] = p[2];
        this.col[vi * 3] = r * fB * k; this.col[vi * 3 + 1] = g * fB * k; this.col[vi * 3 + 2] = b * fB * k; vi++;
        lx = p[0]; ly = p[1]; lz = p[2]; lr = p[3];
      }
    }
    const g = this.lines.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, vi);
  }
}
