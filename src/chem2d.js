// 2D canvas animations for the chemistry/materials panels (logical size 340x230, HiDPI-aware).
const W = 340, H = 230;
function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

// ---------------------------------------------------------------------------------------------
// Li-ion cell: graphite (-) | separator | NMC (+), Li+ shuttling, electrons in the external circuit
export class CellAnim {
  constructor(canvas) {
    this.g = setup(canvas);
    this.aSites = []; this.cSites = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) {
      this.aSites.push({ x: 36 + c * 19 + (r % 2) * 8, y: 66 + r * 18 + 9, ion: null });
      this.cSites.push({ x: 212 + c * 19 + (r % 2) * 8, y: 66 + r * 18 + 9, ion: null });
    }
    this.ions = []; this.N = 34; this.acc = 0; this.ePh = 0; this.t = 0;
    this.init(0.8);
  }
  init(soc) {
    this.ions = [];
    this.aSites.forEach((s) => (s.ion = null)); this.cSites.forEach((s) => (s.ion = null));
    const nA = Math.round(this.N * soc);
    const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
    const as = shuffle(this.aSites.slice()), cs = shuffle(this.cSites.slice());
    for (let i = 0; i < this.N; i++) {
      const site = i < nA ? as[i] : cs[i - nA];
      const ion = { site, side: i < nA ? 'a' : 'c', x: site.x, y: site.y, tr: null, alpha: 1 };
      site.ion = ion; this.ions.push(ion);
    }
  }
  _free(sites) { const f = sites.filter((s) => !s.ion); return f[(Math.random() * f.length) | 0]; }
  _move(from, to, ion, dur = 1.1, teleport = false) {
    const dst = this._free(to === 'a' ? this.aSites : this.cSites); if (!dst) return;
    ion.site.ion = null; dst.ion = ion;
    const sy = rnd(70, 205);
    ion.tr = { x0: ion.x, y0: ion.y, x1: dst.x, y1: dst.y, sy, t: 0, dur, teleport };
    ion.site = dst; ion.side = 't'; ion.dest = to;
  }
  update(dt, I, soc, charging) {
    this.t += dt;
    const dir = I > 3 ? 1 : I < -3 ? -1 : 0;
    this.dir = dir; this.charging = charging;
    const rate = dir ? Math.min(9, 1.5 + Math.abs(I) / 70) : 0;
    this.acc += rate * dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      const src = dir > 0 ? 'a' : 'c';
      const cand = this.ions.filter((i) => i.side === src);
      if (cand.length) this._move(src, src === 'a' ? 'c' : 'a', cand[(Math.random() * cand.length) | 0]);
    }
    this.ePh += dt * dir * Math.min(1.2, 0.15 + Math.abs(I) / 600);
    for (const ion of this.ions) {
      if (!ion.tr) continue;
      const tr = ion.tr; tr.t += dt / tr.dur;
      if (tr.teleport) { ion.alpha = tr.t < 0.5 ? 1 - tr.t * 2 : (tr.t - 0.5) * 2; if (tr.t > 0.5) { ion.x = tr.x1; ion.y = tr.y1; } }
      else {
        const t = Math.min(1, tr.t), e = ease(t);
        const midX = 170;
        if (t < 0.5) { const q = e * 2; ion.x = tr.x0 + (midX - tr.x0) * q; ion.y = tr.y0 + (tr.sy - tr.y0) * q; }
        else { const q = (e - 0.5) * 2; ion.x = midX + (tr.x1 - midX) * q; ion.y = tr.sy + (tr.y1 - tr.sy) * q; }
        ion.y += Math.sin(this.t * 9 + tr.sy) * 1.2 * Math.sin(Math.PI * t);
      }
      if (tr.t >= 1) { ion.x = tr.x1; ion.y = tr.y1; ion.side = ion.dest; ion.tr = null; ion.alpha = 1; }
    }
    // keep site populations consistent with SOC (quiet fade-swap; the pack has billions of ions)
    const target = Math.round(this.N * soc);
    const nA = this.ions.filter((i) => i.side === 'a' || (i.side === 't' && i.dest === 'a')).length;
    if (nA > target + 1) { const c = this.ions.filter((i) => i.side === 'a'); if (c.length) this._move('a', 'c', c[0], 0.8, true); }
    else if (nA < target - 1) { const c = this.ions.filter((i) => i.side === 'c'); if (c.length) this._move('c', 'a', c[0], 0.8, true); }
  }
  draw() {
    const g = this.g; g.clearRect(0, 0, W, H);
    g.fillStyle = '#071019'; g.fillRect(0, 0, W, H);
    // electrolyte
    g.fillStyle = 'rgba(77,225,255,0.05)'; g.fillRect(22, 60, 296, 156);
    // collectors
    g.fillStyle = '#b8703f'; g.fillRect(12, 56, 9, 164);
    g.fillStyle = '#c3cbd3'; g.fillRect(319, 56, 9, 164);
    // graphite layers (hexagonal sheets seen edge-on)
    g.strokeStyle = '#4a5560'; g.lineWidth = 2;
    for (let r = 0; r <= 8; r++) {
      const y = 66 + r * 18; g.beginPath();
      for (let x = 26; x <= 146; x += 8) g.lineTo(x, y + ((x / 8) % 2 ? 2 : -2));
      g.stroke();
    }
    // NMC layered oxide: TM-O slabs
    for (let r = 0; r <= 8; r++) {
      const y = 66 + r * 18;
      for (let x = 202, k = 0; x <= 314; x += 9, k++) {
        g.fillStyle = '#ff5a5a'; g.beginPath(); g.arc(x, y - 4, 1.7, 0, 7); g.arc(x + 4, y + 4, 1.7, 0, 7); g.fill();
        g.fillStyle = ['#4bd18b', '#4bd18b', '#c58cff', '#4d9dff'][(k + r) % 4]; g.beginPath(); g.arc(x + 2, y, 2.6, 0, 7); g.fill();
      }
    }
    // separator
    g.setLineDash([4, 4]); g.strokeStyle = '#d6e2ec'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(170, 58); g.lineTo(170, 218); g.stroke(); g.setLineDash([]);
    // external circuit
    g.strokeStyle = '#6c7884'; g.lineWidth = 2; g.beginPath(); g.moveTo(16, 56); g.lineTo(16, 24); g.lineTo(324, 24); g.lineTo(324, 56); g.stroke();
    const lbl = this.charging ? 'CHARGER' : this.dir < 0 ? 'REGEN' : 'MOTOR';
    g.fillStyle = '#0b1622'; g.strokeStyle = this.dir < 0 ? '#5dffa1' : this.dir > 0 ? '#4de1ff' : '#56636f'; g.lineWidth = 1.5;
    g.fillRect(140, 14, 60, 20); g.strokeRect(140, 14, 60, 20);
    g.fillStyle = '#dfeaf2'; g.font = '600 9px ui-monospace,monospace'; g.textAlign = 'center'; g.fillText(lbl, 170, 27);
    // electrons along wire
    const path = [[16, 56], [16, 24], [324, 24], [324, 56]], segL = [32, 308, 32], tot = 372;
    if (this.dir) for (let i = 0; i < 16; i++) {
      let s = (((i / 16 + this.ePh) % 1) + 1) % 1 * tot; let k = 0; while (k < 2 && s > segL[k]) { s -= segL[k]; k++; }
      const [x0, y0] = path[k], [x1, y1] = path[k + 1], q = s / segL[k];
      const x = x0 + (x1 - x0) * q, y = y0 + (y1 - y0) * q;
      if (x > 138 && x < 202 && y < 36) continue;
      g.fillStyle = '#58b6ff'; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill();
    }
    // ions
    for (const ion of this.ions) {
      g.globalAlpha = ion.alpha;
      g.fillStyle = ion.tr && !ion.tr.teleport ? '#fff07a' : '#ffd84d';
      g.shadowColor = '#ffd84d'; g.shadowBlur = ion.tr && !ion.tr.teleport ? 10 : 3;
      g.beginPath(); g.arc(ion.x, ion.y, 4.2, 0, 7); g.fill();
      g.shadowBlur = 0; g.fillStyle = '#4a3600'; g.fillRect(ion.x - 2.2, ion.y - 0.6, 4.4, 1.2); g.fillRect(ion.x - 0.6, ion.y - 2.2, 1.2, 4.4);
    }
    g.globalAlpha = 1;
    // labels
    g.font = '600 9px ui-monospace,monospace'; g.fillStyle = '#9fb0bf'; g.textAlign = 'left';
    g.fillText('(−) GRAPHITE', 24, 52); g.textAlign = 'right'; g.fillText('NMC OXIDE (+)', 318, 52);
    g.textAlign = 'center'; g.fillStyle = '#6f7d8a'; g.fillText('separator', 170, 228);
    g.textAlign = 'left'; g.fillText('Cu', 2, 140); g.textAlign = 'right'; g.fillText('Al', 339, 140);
    g.textAlign = 'left'; g.fillStyle = '#ffd84d'; g.fillText('● Li⁺', 24, 12); g.fillStyle = '#58b6ff'; g.fillText('● e⁻', 70, 12);
    if (this.dir) {
      g.fillStyle = 'rgba(255,240,122,0.9)'; g.textAlign = 'center';
      g.fillText(this.dir > 0 ? 'Li⁺ →' : '← Li⁺', 170, 46);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Stainless steel lattice with passive Cr2O3 film, scratch + self-heal, mild-steel comparison
export class SteelAnim {
  constructor(canvas) {
    this.g = setup(canvas); this.t = 0; this.mild = false; this.cw = 0.6;
    this.atoms = [];
    for (let y = 104, r = 0; y < 226; y += 12, r++) for (let x = 6 + (r % 2) * 6; x < W; x += 12) this.atoms.push({ x, y, r });
    this.film = []; for (let x = 4; x < W; x += 7) this.film.push({ x, p: 1, rust: 0 });
    this.mol = []; for (let i = 0; i < 16; i++) this.mol.push(this._newMol());
    this.scratch = null; this.disl = [];
    this._types();
    this.setCold(0.6);
  }
  _newMol(target) { return { x: rnd(0, W), y: rnd(8, 70), vx: rnd(-12, 12), vy: rnd(-6, 6), h2o: Math.random() < 0.35, target, a: rnd(0, 6) }; }
  _types() {
    for (const a of this.atoms) {
      const r = Math.random();
      a.type = this.mild ? (r < 0.02 ? 'C' : 'Fe') : r < 0.71 ? 'Fe' : r < 0.89 ? 'Cr' : r < 0.98 ? 'Ni' : 'Mn';
    }
    for (const f of this.film) { f.p = this.mild ? 0 : 1; f.rust = 0; }
  }
  setMild(m) { this.mild = m; this._types(); this.scratch = null; }
  setCold(v) {
    this.cw = v; const n = Math.round(2 + v * 16);
    this.disl = []; for (let i = 0; i < n; i++) this.disl.push({ x: rnd(20, W - 20), y: rnd(116, 216), rot: Math.random() < 0.5 ? 0 : Math.PI });
  }
  doScratch() { this.scratch = { t: 0, x0: 110, x1: 230 }; }
  update(dt) {
    this.t += dt;
    for (const m of this.mol) {
      if (m.target != null) {
        const f = this.film[m.target]; const dx = f.x - m.x, dy = 92 - m.y; m.x += dx * dt * 3; m.y += dy * dt * 3;
        if (Math.abs(dy) < 3) { if (this.mild) f.rust = Math.min(1, f.rust + 0.35); else f.p = Math.min(1, f.p + 0.5); Object.assign(m, this._newMol()); m.y = 6; }
      } else {
        m.x += m.vx * dt; m.y += m.vy * dt; m.a += dt;
        if (m.x < 0) m.x = W; if (m.x > W) m.x = 0; if (m.y < 6 || m.y > 76) m.vy *= -1;
      }
    }
    if (this.scratch) {
      const s = this.scratch; s.t += dt;
      const tipX = s.x0 + (s.x1 - s.x0) * Math.min(1, s.t / 0.8);
      for (const f of this.film) if (f.x >= s.x0 && f.x <= tipX) { f.p = 0; f.rust = 0; }
      if (s.t > 1.6) this.scratch = null;
    }
    // repassivation / rusting: free molecules are drawn to exposed metal
    if (!this.scratch || this.scratch.t > 0.9) {
      const exposed = this.film.map((f, i) => [f, i]).filter(([f]) => (this.mild ? f.rust < 1 : f.p < 1));
      if (exposed.length) {
        const free = this.mol.filter((m) => m.target == null);
        if (free.length > 6 && Math.random() < dt * (this.mild ? 3 : 6)) {
          const pick = exposed[(Math.random() * exposed.length) | 0][1]; free[0].target = pick;
        }
      }
    }
  }
  draw() {
    const g = this.g; g.clearRect(0, 0, W, H);
    const sky = g.createLinearGradient(0, 0, 0, 90); sky.addColorStop(0, '#08121c'); sky.addColorStop(1, '#0c1824');
    g.fillStyle = sky; g.fillRect(0, 0, W, 90);
    g.fillStyle = '#0a0d11'; g.fillRect(0, 96, W, H - 96);
    // molecules
    for (const m of this.mol) {
      g.fillStyle = '#ff5a5a';
      const c = Math.cos(m.a), s = Math.sin(m.a);
      g.beginPath(); g.arc(m.x - 3 * c, m.y - 3 * s, 3, 0, 7); g.arc(m.x + 3 * c, m.y + 3 * s, 3, 0, 7); g.fill();
      if (m.h2o) { g.fillStyle = '#e8eef3'; g.beginPath(); g.arc(m.x + 6 * c, m.y + 6 * s - 3, 1.8, 0, 7); g.fill(); }
    }
    // lattice + dislocation strain
    const col = { Fe: '#9aa3ad', Cr: '#4bd18b', Ni: '#4d9dff', Mn: '#c58cff', C: '#c58cff' };
    for (const a of this.atoms) {
      let dx = 0, dy = 0;
      for (const d of this.disl) { const rx = a.x - d.x, ry = a.y - d.y, r2 = rx * rx + ry * ry; if (r2 < 400) { const k = (1 - r2 / 400) * 2.2; dx += k * (ry > 0 ? 1 : -1) * (d.rot ? -1 : 1); } }
      let rust = 0; if (this.mild && a.y < 130) { const f = this.film[Math.min(this.film.length - 1, Math.round((a.x - 4) / 7))]; rust = f ? f.rust * (1 - (a.y - 104) / 30) : 0; }
      g.fillStyle = rust > 0.4 ? '#b5542a' : col[a.type];
      g.beginPath(); g.arc(a.x + dx, a.y + dy, a.type === 'C' ? 2.2 : 4.4, 0, 7); g.fill();
    }
    g.strokeStyle = '#ffb03a'; g.lineWidth = 2;
    for (const d of this.disl) { g.save(); g.translate(d.x, d.y); g.rotate(d.rot); g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.moveTo(0, 0); g.lineTo(0, -9); g.stroke(); g.restore(); }
    // surface film
    for (const f of this.film) {
      if (this.mild) {
        if (f.rust > 0) { g.fillStyle = `rgba(181,84,42,${0.4 + 0.6 * f.rust})`; const hgt = 4 + f.rust * 10; g.fillRect(f.x - 3 + Math.sin(f.x) * 1.5, 97 - hgt + 4, 6, hgt); }
      } else if (f.p > 0) {
        g.globalAlpha = f.p;
        g.fillStyle = '#ff5a5a'; g.beginPath(); g.arc(f.x, 90, 2.3, 0, 7); g.arc(f.x + 3.5, 97, 2.3, 0, 7); g.fill();
        g.fillStyle = '#4bd18b'; g.beginPath(); g.arc(f.x + 3.5, 90, 2.6, 0, 7); g.arc(f.x, 97, 2.6, 0, 7); g.fill();
        g.globalAlpha = 1;
      }
    }
    if (this.scratch && this.scratch.t < 1.0) {
      const s = this.scratch; const tipX = s.x0 + (s.x1 - s.x0) * Math.min(1, s.t / 0.8);
      g.fillStyle = '#e6edf3'; g.beginPath(); g.moveTo(tipX, 93); g.lineTo(tipX + 10, 40); g.lineTo(tipX + 18, 44); g.closePath(); g.fill();
    }
    g.font = '600 9px ui-monospace,monospace'; g.textAlign = 'left'; g.fillStyle = '#9fb0bf';
    g.fillText(this.mild ? 'MILD STEEL — porous rust (Fe₂O₃·nH₂O)' : 'STAINLESS — passive Cr₂O₃ film (~1–3 nm)', 8, 84);
    g.fillText(this.mild ? 'Fe (bcc ferrite, no Cr)' : 'Fe–Cr–Ni austenite (fcc)', 8, 226);
    g.textAlign = 'right'; g.fillText('O₂ / H₂O in air', W - 8, 14);
    const healed = this.film.filter((f) => f.p >= 1).length / this.film.length;
    if (!this.mild && healed < 1) { g.fillStyle = '#5dffa1'; g.fillText(`re-passivating… ${Math.round(healed * 100)}%`, W - 8, 84); }
    g.fillStyle = '#ffb03a'; g.textAlign = 'right'; g.fillText(`⊥ dislocations ×${this.disl.length}`, W - 8, 226);
  }
}

// ---------------------------------------------------------------------------------------------
// Laminated glass cross-section with impact
export class GlassAnim {
  constructor(canvas) { this.g = setup(canvas); this.reset(); }
  reset() { this.imp = null; this.cracks = []; this.t = 0; }
  impact() {
    this.reset(); this.imp = { t: 0 };
    for (let i = 0; i < 9; i++) this.cracks.push({ x: 170 + rnd(-38, 38), a: rnd(-0.6, 0.6), ply: i < 6 ? 0 : 1, len: rnd(0.6, 1) });
  }
  update(dt) { this.t += dt; if (this.imp) this.imp.t += dt; }
  draw() {
    const g = this.g; g.clearRect(0, 0, W, H); g.fillStyle = '#071019'; g.fillRect(0, 0, W, H);
    const layers = [
      { n: 'outer glass ply', h: 26, c: 'rgba(140,220,255,0.35)', glass: true },
      { n: 'polymer interlayer (PVB)', h: 9, c: 'rgba(255,214,102,0.55)' },
      { n: 'glass ply', h: 26, c: 'rgba(140,220,255,0.30)', glass: true },
      { n: 'polymer interlayer', h: 9, c: 'rgba(255,214,102,0.55)' },
      { n: 'inner ply', h: 18, c: 'rgba(140,220,255,0.25)', glass: true },
    ];
    let ballY = 20, bulge = 0;
    if (this.imp) {
      const t = this.imp.t;
      if (t < 0.35) ballY = 20 + Math.pow(t / 0.35, 2) * 64;
      else {
        const q = t - 0.35;
        bulge = 12 * Math.exp(-q * 2.5) * Math.min(1, q / 0.08) + 4 * Math.min(1, q / 0.08);
        ballY = Math.min(84, 84 - (q * 110 - q * q * 90)) + bulge * (q < 0.1 ? 1 : 0);
      }
    }
    const y0 = 96;
    const def = (x) => bulge * Math.exp(-Math.pow((x - 170) / 50, 2));
    let y = y0, idx = 0;
    for (const L of layers) {
      g.fillStyle = L.c; g.beginPath();
      for (let x = 10; x <= 330; x += 5) g.lineTo(x, y + def(x));
      for (let x = 330; x >= 10; x -= 5) g.lineTo(x, y + L.h + def(x) * (1 - idx * 0.08));
      g.closePath(); g.fill();
      g.fillStyle = '#b8c7d4'; g.font = '9px ui-monospace,monospace'; g.textAlign = 'left'; g.fillText(L.n, 12, y + L.h / 2 + 3 + def(12));
      if (this.imp && this.imp.t > 0.35 && L.glass && idx < 3) {
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1;
        for (const c of this.cracks) if (c.ply === (idx === 0 ? 0 : 1)) {
          const p = Math.min(1, (this.imp.t - 0.35) * 8) * c.len;
          g.beginPath(); g.moveTo(c.x, y + def(c.x)); g.lineTo(c.x + Math.sin(c.a) * L.h * p, y + L.h * p + def(c.x)); g.stroke();
        }
      }
      y += L.h; idx++;
    }
    // projectile
    g.fillStyle = '#cfd6dc'; g.beginPath(); g.arc(170, ballY, 12, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(166, ballY - 4, 4, 0, 7); g.fill();
    g.font = '600 9px ui-monospace,monospace'; g.textAlign = 'center'; g.fillStyle = '#9fb0bf';
    g.fillText('EXTERIOR', 170, 12); g.fillText('CABIN', 170, 222);
    if (this.imp && this.imp.t > 0.4) {
      g.fillStyle = '#5dffa1'; g.textAlign = 'right';
      g.fillText('interlayer stretches · shards stay bonded', 330, 206);
      g.fillStyle = '#ffd84d'; g.fillText('outer ply cracks → absorbs energy', 330, 194);
    }
    g.textAlign = 'right'; g.fillStyle = '#6f7d8a'; g.fillText('illustrative layup', 330, 12);
  }
}
