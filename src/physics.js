// Longitudinal + kinematic-lateral vehicle model with a simple battery electro-thermal model.
// Every number here is an approximation built from public specs — this is an educational toy, not a validated model.

export const G = 9.81;
export const RHO = 1.225;           // air density at sea level, kg/m^3
export const MPH = 0.44704;         // m/s per mph

export const TRIMS = {
  awd: {
    id: 'awd', label: 'AWD', name: 'Cybertruck AWD (dual-motor)',
    curbKg: 2995,  // ~6,603 lb
    powerKW: 447,  // ~600 hp
    hp: 600,
    fMax: 21000,   // assumed peak tractive force at the wheels (motor-torque limit), N
    topMph: 112, quoted060: 4.1, motors: 2, rangeMi: 318,
  },
  beast: {
    id: 'beast', label: 'Cyberbeast', name: 'Cyberbeast (tri-motor)',
    curbKg: 3104,  // ~6,843 lb
    powerKW: 630,  // ~845 hp
    hp: 845,
    fMax: 31000,
    topMph: 130, quoted060: 2.6, motors: 3, rangeMi: 301,
  },
};

export const C = {
  Cd: 0.335,          // commonly cited ~0.33-0.35
  baseArea: 3.35,     // estimated frontal area at 305 mm clearance, m^2
  Crr: 0.011,         // all-terrain tire rolling resistance (assumed)
  mu: 1.0,            // tire-road friction, dry asphalt (assumed)
  muBrake: 0.92,      // achievable braking decel / g (assumed)
  etaDrive: 0.90,     // battery -> wheel efficiency (assumed)
  etaRegen: 0.80,     // wheel -> battery efficiency (assumed)
  regenMaxKW: 250,    // regen power limit (assumed)
  auxKW: 1.2,         // HVAC / electronics (assumed)
  packKWh: 123,       // ~123 kWh usable (reported)
  cellsSeries: 216,   // assumed series count for an 800-V class pack
  cellsTotal: 1336,   // ~1,336 4680 cells (reported)
  packR: 0.08,        // assumed effective pack resistance, ohm
  chargeMaxKW: 325,   // peak DC fast-charge (approx.)
  thermalC: 6.0e5,    // pack heat capacity, J/K (assumed)
  wheelR: 0.44,       // 35-in tire radius, m
  wheelbase: 3.635,   // ~143.1 in
  cgH: 0.72,          // CG height, m (low thanks to the floor pack; assumed)
  payloadMax: 1134,   // ~2,500 lb
  towMax: 4990,       // ~11,000 lb
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function cellOCV(soc) {
  // Smooth NMC/graphite-like open-circuit voltage curve: ~3.1 V empty -> ~4.25 V full.
  const s = clamp(soc, 0, 1);
  return 3.45 + 0.75 * s - 0.35 * Math.exp(-s * 12) + 0.05 * Math.pow(s, 8);
}

export function chargeKW(soc) {
  // Rough DC fast-charge taper (approx.)
  if (soc < 0.2) return C.chargeMaxKW;
  if (soc < 0.5) return C.chargeMaxKW - (soc - 0.2) / 0.3 * 75;
  if (soc < 0.8) return 250 - (soc - 0.5) / 0.3 * 140;
  return Math.max(15, 110 - (soc - 0.8) / 0.2 * 95);
}

export class Sim {
  constructor() {
    this.trim = TRIMS.awd;
    this.payload = 0; this.tow = 0; this.grade = 0;
    this.clearance = 0.305; this.clearanceCur = 0.305; this.autoLower = true;
    this.Cd = C.Cd;
    this.soc = 0.8; this.temp = 25;
    this.charging = false;
    this.result060 = null; this.resultBrake = null;
    this.energyUsed = 0; this.energyRegen = 0;
    this.reset();
  }

  reset() {
    Object.assign(this, {
      v: 0, a: 0, aLat: 0, yawRate: 0, heading: 0, posX: 0, posZ: 0, dist: 0,
      throttle: 0, brake: 0, steer: 0, gear: 'D', _gearT: 0,
      pitch: 0, pitchV: 0, roll: 0, rollV: 0, wheelAngle: 0, time: 0,
      test: null,
      F: { drive: 0, drag: 0, roll: 0, grade: 0, brake: 0, regen: 0, net: 0, tire: 0, N: 0, Nf: 0, Nr: 0 },
      P: { wheel: 0, batt: 0, regen: 0 },
      I: 0, V: 0, ocv: 0, heat: 0,
    });
    this.charging = false;
  }

  get massTruck() { return this.trim.curbKg + this.payload; }
  get massTotal() { return this.massTruck + this.tow; }
  get area() { return C.baseArea + (this.clearanceCur - 0.305) * 2.03 * 0.5; }
  get CdA() { return this.Cd * this.area; }
  dragAt(v) { return 0.5 * RHO * this.CdA * v * v; }
  rollRes() { return C.Crr * this.massTotal * G * Math.cos(Math.atan(this.grade / 100)); }
  get brakeDecelMax() { return C.muBrake * G * (this.massTruck + 0.6 * this.tow) / this.massTotal; }
  stoppingDistance(v) { return v * v / (2 * (this.brakeDecelMax + C.Crr * G)); }

  startLaunch() { this.reset(); this.test = { type: 'launch', t: 0 }; }
  startBrakeTest() { this.reset(); this.v = 60 * MPH; this.test = { type: 'brake', d: 0, t: 0 }; }

  update(dt, input) {
    if (!(dt > 0)) return;
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this._step(h, input);
  }

  _step(h, input) {
    const mt = this.massTruck, m = this.massTotal;
    const th = Math.atan(this.grade / 100);
    let thIn = input.throttle, brIn = Math.max(input.brake, input.hardBrake ? 1 : 0), stIn = input.steer;
    if (this.test) { stIn = 0; if (this.test.type === 'launch') { thIn = 1; brIn = 0; } else { thIn = 0; brIn = 1; } }
    if (this.charging) { thIn = 0; brIn = 1; }
    const spd0 = Math.abs(this.v);

    // Gear logic: hold brake at a standstill to engage reverse; hold accelerator in R at a standstill for drive.
    if (!this.test && !this.charging && spd0 < 0.3) {
      if (this.gear === 'D' && input.brake > 0.5 && thIn < 0.05) { this._gearT += h; if (this._gearT > 0.6) { this.gear = 'R'; this._gearT = 0; } }
      else if (this.gear === 'R' && thIn > 0.5) { this._gearT += h; if (this._gearT > 0.3) { this.gear = 'D'; this._gearT = 0; } }
      else this._gearT = 0;
    } else this._gearT = 0;
    const dir = this.gear === 'D' ? 1 : -1;
    const drive = dir > 0 ? thIn : (input.hardBrake ? 0 : brIn);
    const brk = dir > 0 ? brIn : Math.max(thIn, input.hardBrake ? 1 : 0);

    // Pedal smoothing (no jerky steps); launch test gets an instant pedal.
    if (this.test && this.test.type === 'launch') this.throttle = 1;
    else this.throttle += clamp(drive - this.throttle, -h * 5, h * 3.5);
    this.brake += clamp(brk - this.brake, -h * 8, h * 6);
    const maxSteer = 0.55 / (1 + spd0 * spd0 / 400);
    this.steer += clamp(stIn * maxSteer - this.steer, -h * 1.8, h * 1.8);

    // Forces (positive = +x, the truck's forward direction)
    const sgn = this.v > 0.01 ? 1 : this.v < -0.01 ? -1 : 0;
    const Fdrag = this.dragAt(this.v);
    const N = mt * G * Math.cos(th);
    const Froll = sgn ? C.Crr * m * G * Math.cos(th) : 0;
    const Fgrade = m * G * Math.sin(th);
    const P = this.trim.powerKW * 1000 * (dir < 0 ? 0.25 : 1) * (this.soc < 0.03 ? 0.1 : 1);
    let Fd = this.throttle * Math.min(this.trim.fMax, P / Math.max(spd0, 0.5), C.mu * N);
    const vTop = dir > 0 ? this.trim.topMph * MPH : 8;
    if (spd0 > vTop - 1 && sgn === dir) Fd *= clamp(vTop - spd0, 0, 1);
    Fd *= dir;

    const Fbmax = C.muBrake * G * (mt + 0.6 * this.tow); // trailer brakes assumed ~60% effective
    let Fb = this.brake * Fbmax;
    let Fone = 0; // "one-pedal" regen when lifting off
    if (this.throttle < 0.02 && spd0 > 0.5 && !this.test) Fone = Math.min(0.12 * mt * G, C.regenMaxKW * 1000 / spd0) * clamp(spd0 / 3, 0, 1);
    const FbTot = Fb + Fone;
    const Fregen = Math.min(FbTot, C.regenMaxKW * 1000 / Math.max(spd0, 0.5)) * clamp(spd0 / 2, 0, 1);

    const F = Fd - (Fdrag + Froll + FbTot) * sgn - Fgrade;
    const vPrev = this.v;
    this.v += F / m * h;
    if (sgn !== 0 && Math.sign(this.v) !== sgn && !(Fd * this.v > 0)) this.v = 0; // resistances/brakes stop, never reverse
    if (Math.abs(vPrev) < 0.01 && Math.abs(Fd) < 1) this.v = 0;                   // auto-hold when stopped
    const aRaw = (this.v - vPrev) / h;
    this.a += (aRaw - this.a) * clamp(h * 30, 0, 1);

    // Lateral (kinematic bicycle) with grip cap
    let yaw = this.v * Math.tan(this.steer) / C.wheelbase;
    const aLatMax = C.mu * G * 0.9;
    if (Math.abs(this.v * yaw) > aLatMax) yaw = Math.sign(yaw) * aLatMax / Math.max(Math.abs(this.v), 0.1);
    this.yawRate = yaw; this.aLat = this.v * yaw;
    this.heading += yaw * h;
    this.posX += this.v * Math.cos(this.heading) * h;
    this.posZ -= this.v * Math.sin(this.heading) * h;
    this.dist += Math.abs(this.v) * h;
    this.wheelAngle += this.v / C.wheelR * h;
    this.time += h;

    // Body pitch/roll: damped spring toward a weight-transfer target
    const tp = clamp(this.a * 0.0032, -0.05, 0.05), tr = clamp(this.aLat * 0.0045, -0.06, 0.06);
    const wn = 8, z = 0.45;
    this.pitchV += (wn * wn * (tp - this.pitch) - 2 * z * wn * this.pitchV) * h; this.pitch += this.pitchV * h;
    this.rollV += (wn * wn * (tr - this.roll) - 2 * z * wn * this.rollV) * h; this.roll += this.rollV * h;

    // Air suspension
    const tgtClear = this.autoLower && spd0 > 22 ? Math.min(this.clearance, 0.255) : this.clearance;
    this.clearanceCur += clamp(tgtClear - this.clearanceCur, -0.05 * h, 0.05 * h);

    // Normal-load split with weight transfer (static ~50/50)
    const dN = mt * (this.a + G * Math.sin(th)) * C.cgH / C.wheelbase;
    Object.assign(this.F, { drive: Fd, drag: Fdrag * sgn, roll: Froll * sgn, grade: Fgrade, brake: FbTot * sgn, regen: Fregen, net: F,
      tire: Fd - FbTot * sgn, N, Nf: N / 2 - dN, Nr: N / 2 + dN });

    // Battery
    const Pwheel = Fd * this.v;
    const Pregen = Fregen * spd0;
    let Pb = Math.max(Pwheel, 0) / C.etaDrive - Pregen * C.etaRegen + C.auxKW * 1000;
    let ts = 1;
    if (this.charging) {
      if (this.soc >= 0.999) { this.charging = false; }
      Pb = -chargeKW(this.soc) * 1000; ts = 40;
    }
    const ocv = cellOCV(this.soc) * C.cellsSeries;
    const R = C.packR;
    const I = (ocv - Math.sqrt(Math.max(ocv * ocv - 4 * R * Pb, 0))) / (2 * R);
    this.I = I; this.ocv = ocv; this.V = ocv - I * R; this.heat = I * I * R;
    this.P.wheel = Pwheel; this.P.batt = Pb; this.P.regen = Pregen;
    const E = ocv * I * h * ts;
    this.soc = clamp(this.soc - E / (C.packKWh * 3.6e6), 0, 1);
    if (E > 0) this.energyUsed += E / 3.6e6; else this.energyRegen -= E / 3.6e6;
    const cool = (300 + 2500 * clamp((this.temp - 30) / 10, 0, 1)) * (this.temp - 22);
    this.temp += (this.heat - cool) * h * ts / C.thermalC;

    // Tests
    if (this.test) {
      this.test.t += h;
      if (this.test.type === 'launch' && this.v >= 60 * MPH) { this.result060 = this.test.t; this.test = null; this.throttle = 0; }
      else if (this.test && this.test.type === 'brake') { this.test.d += Math.abs(this.v) * h; if (this.v === 0) { this.resultBrake = this.test.d; this.test = null; } }
    }
  }
}
