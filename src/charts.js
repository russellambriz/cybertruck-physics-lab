// Lightweight canvas charts (no deps). Logical size 280x120.
const W = 280, H = 120;
function setup(c) { const d = Math.min(window.devicePixelRatio || 1, 2); c.width = W * d; c.height = H * d; const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return g; }

export class HistoryChart {
  constructor(canvas, span = 30) { this.g = setup(canvas); this.span = span; this.data = []; }
  push(t, speedMph, powerKW, accG) { this.data.push([t, speedMph, powerKW, accG]); while (this.data.length && this.data[0][0] < t - this.span) this.data.shift(); }
  draw(maxMph = 140, maxKW = 700) {
    const g = this.g; g.clearRect(0, 0, W, H);
    const L = 30, R = W - 32, T = 14, B = H - 16;
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = T + (B - T) * i / 4; g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); }
    const zeroP = T + (B - T) * 0.75; // power axis: -maxKW/3 .. maxKW
    g.strokeStyle = 'rgba(255,176,58,0.25)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(L, zeroP); g.lineTo(R, zeroP); g.stroke(); g.setLineDash([]);
    g.font = '9px ui-monospace,monospace'; g.fillStyle = '#7e8b97'; g.textAlign = 'right';
    g.fillText(maxMph, L - 4, T + 3); g.fillText('0', L - 4, B + 3);
    g.textAlign = 'left'; g.fillText(maxKW, R + 4, T + 3); g.fillText('0', R + 4, zeroP + 3);
    g.fillStyle = '#4de1ff'; g.fillText('speed mph', L, 9); g.fillStyle = '#ffb03a'; g.fillText('battery kW', L + 70, 9); g.fillStyle = '#ff5ab4'; g.fillText('accel g', L + 146, 9);
    g.fillStyle = '#7e8b97'; g.textAlign = 'right'; g.fillText(`last ${this.span}s`, R, H - 3);
    if (this.data.length < 2) return;
    const t1 = this.data[this.data.length - 1][0], t0 = t1 - this.span;
    const X = (t) => L + (t - t0) / this.span * (R - L);
    const line = (idx, col, map) => { g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); this.data.forEach((d, i) => { const x = X(d[0]), y = map(d[idx]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
    line(2, '#ffb03a', (p) => zeroP - Math.max(-1 / 3, Math.min(1, p / maxKW)) * (zeroP - T));
    line(3, '#ff5ab4', (a) => zeroP - Math.max(-1 / 3, Math.min(1, a / 1.2)) * (zeroP - T));
    line(1, '#4de1ff', (v) => B - Math.min(1, Math.abs(v) / maxMph) * (B - T));
  }
}

export class LoadChart {
  constructor(canvas) { this.g = setup(canvas); }
  draw(sim, curMph) {
    const g = this.g; g.clearRect(0, 0, W, H);
    const L = 34, R = W - 8, T = 14, B = H - 18, maxMph = 130;
    const MPH = 0.44704;
    const roll = sim.rollRes(), grade = sim.massTotal * 9.81 * Math.sin(Math.atan(sim.grade / 100));
    const maxF = Math.max(3000, (sim.dragAt(maxMph * MPH) + roll + Math.max(0, grade)) * 1.08);
    const X = (m) => L + m / maxMph * (R - L), Y = (f) => B - Math.max(0, Math.min(1, f / maxF)) * (B - T);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let m = 0; m <= maxMph; m += 20) { g.beginPath(); g.moveTo(X(m), T); g.lineTo(X(m), B); g.stroke(); }
    g.font = '9px ui-monospace,monospace'; g.fillStyle = '#7e8b97'; g.textAlign = 'center';
    for (let m = 0; m <= 120; m += 40) g.fillText(m, X(m), H - 6);
    g.textAlign = 'right'; g.fillText((maxF / 1000).toFixed(1) + 'kN', L - 3, T + 4); g.fillText('0', L - 3, B + 3);
    const curve = (fn, col, w = 1.6) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); for (let m = 0; m <= maxMph; m += 2) { const y = Y(fn(m * MPH)); m ? g.lineTo(X(m), y) : g.moveTo(X(m), y); } g.stroke(); };
    curve(() => roll, '#ff8a3d');
    curve((v) => sim.dragAt(v), '#4de1ff');
    curve((v) => sim.dragAt(v) + roll + grade, '#e8f4ff', 2.2);
    const x = X(Math.min(maxMph, curMph));
    g.strokeStyle = '#ff5ab4'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke(); g.setLineDash([]);
    g.textAlign = 'left'; g.fillStyle = '#4de1ff'; g.fillText('drag ½ρCdAv²', L + 2, 9); g.fillStyle = '#ff8a3d'; g.fillText('rolling', L + 92, 9); g.fillStyle = '#e8f4ff'; g.fillText('total road load', L + 140, 9);
  }
}
