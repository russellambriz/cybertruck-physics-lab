// 3D battery pack: ~1,336 4680-style cells (instanced), drive units, HV cabling with animated current flow.
import * as THREE from 'three';

export class BatteryPack {
  constructor() {
    this.group = new THREE.Group();
    const g = this.group;
    // tray + frame
    const tray = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.012, 1.56), new THREE.MeshStandardMaterial({ color: 0x1a2128, metalness: 0.7, roughness: 0.5 }));
    tray.position.set(0, 0.338, 0); g.add(tray);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.62, 0.13, 1.56)), new THREE.LineBasicMaterial({ color: 0x5dffa1, transparent: true, opacity: 0.7 }));
    frame.position.set(0, 0.395, 0); g.add(frame);

    // cells: 4 modules x 334 cells, hex-packed, standing upright (46 mm x 80 mm)
    const geo = new THREE.CylinderGeometry(0.0225, 0.0225, 0.08, 12);
    this.cellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.32, emissive: 0x000000 });
    const N = 1336;
    this.cells = new THREE.InstancedMesh(geo, this.cellMat, N);
    const m = new THREE.Matrix4();
    this.cellPos = [];
    let i = 0;
    for (let mod = 0; mod < 4; mod++) {
      const cx = -0.93 + mod * 0.62;
      let k = 0;
      for (let c = 0; c < 12; c++) for (let r = 0; r < 28; r++) {
        if (k++ >= 334) continue;
        const x = cx + (c - 5.5) * 0.0416, z = (r - 13.5) * 0.048 + (c % 2 ? 0.024 : 0) - 0.012;
        m.makeTranslation(x, 0.388, z); this.cells.setMatrixAt(i, m); this.cellPos.push([x, z]); i++;
      }
    }
    this.cells.count = i;
    this.colors = new THREE.Color();
    for (let j = 0; j < i; j++) this.cells.setColorAt(j, this.colors.set(0x9fb4c8));
    this.cells.castShadow = false;
    g.add(this.cells);

    // busbar plates per module (thin, semi-transparent copper)
    const bus = new THREE.MeshStandardMaterial({ color: 0xc87f4a, metalness: 0.9, roughness: 0.35, transparent: true, opacity: 0.35 });
    for (let mod = 0; mod < 4; mod++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.004, 1.38), bus); p.position.set(-0.93 + mod * 0.62, 0.431, 0); g.add(p); }

    // drive units
    const motorMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, metalness: 0.85, roughness: 0.35 });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 0.6 });
    const mkMotor = (len) => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, len, 24).rotateX(Math.PI / 2), motorMat); grp.add(body);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.012, 8, 32), ringMat); grp.add(ring);
      return grp;
    };
    this.front = mkMotor(0.4); this.front.position.set(1.82, 0.44, 0);
    this.rearSingle = mkMotor(0.4); this.rearSingle.position.set(-1.82, 0.44, 0);
    this.rearL = mkMotor(0.28); this.rearL.position.set(-1.82, 0.44, -0.17);
    this.rearR = mkMotor(0.28); this.rearR.position.set(-1.82, 0.44, 0.17);
    g.add(this.front, this.rearSingle, this.rearL, this.rearR);
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x333840, metalness: 0.7, roughness: 0.4 });
    for (const x of [1.82, -1.82]) for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8).rotateX(Math.PI / 2), shaftMat); sh.position.set(x, 0.44, s * 0.45); g.add(sh);
    }

    // HV cables + flowing current dots
    const cableMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, emissive: 0x441800 });
    this.curves = [
      new THREE.CatmullRomCurve3([new THREE.Vector3(1.31, 0.40, 0.25), new THREE.Vector3(1.5, 0.43, 0.22), new THREE.Vector3(1.7, 0.47, 0.1)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(-1.31, 0.40, -0.25), new THREE.Vector3(-1.5, 0.43, -0.22), new THREE.Vector3(-1.7, 0.47, -0.1)]),
    ];
    for (const c of this.curves) g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.018, 8), cableMat));
    this.dotsPer = 14;
    const dg = new THREE.BufferGeometry();
    this.dotPos = new Float32Array(this.curves.length * this.dotsPer * 3);
    dg.setAttribute('position', new THREE.BufferAttribute(this.dotPos, 3));
    this.dotMat = new THREE.PointsMaterial({ color: 0x7fe8ff, size: 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.dots = new THREE.Points(dg, this.dotMat); this.dots.frustumCulled = false; g.add(this.dots);
    this.phase = 0; this._tAcc = 1; this._lastT = -99;
    this.setTrim('awd');
  }

  setTrim(id) {
    const beast = id === 'beast';
    this.rearSingle.visible = !beast; this.rearL.visible = this.rearR.visible = beast;
  }

  update(dt, I, temp, time) {
    // current flow animation: + = discharge (pack -> motors), - = charge/regen
    this.phase += dt * I / 350;
    const tmp = new THREE.Vector3();
    let k = 0;
    this.curves.forEach((c) => {
      for (let i = 0; i < this.dotsPer; i++) {
        let t = ((i / this.dotsPer + this.phase) % 1 + 1) % 1;
        c.getPointAt(t, tmp); this.dotPos[k++] = tmp.x; this.dotPos[k++] = tmp.y; this.dotPos[k++] = tmp.z;
      }
    });
    this.dots.geometry.attributes.position.needsUpdate = true;
    this.dotMat.opacity = Math.min(1, Math.abs(I) / 120);
    this.dotMat.color.set(I >= 0 ? 0x7fe8ff : 0x7dffb0);

    // cell glow ~ |I|
    const mag = Math.min(1, Math.abs(I) / 700);
    this.cellMat.emissive.set(I >= 0 ? 0x1a7cff : 0x22ff88);
    this.cellMat.emissiveIntensity = 0.08 + mag * (0.9 + 0.1 * Math.sin(time * 12));

    // thermal colouring (refresh when temperature moves)
    this._tAcc += dt;
    if (this._tAcc > 0.4 && Math.abs(temp - this._lastT) > 0.05) {
      this._tAcc = 0; this._lastT = temp;
      const cool = new THREE.Color(0x8fb2d2), warm = new THREE.Color(0xffb03a), hot = new THREE.Color(0xff3a2a);
      for (let i = 0; i < this.cellPos.length; i++) {
        const [x, z] = this.cellPos[i];
        const centre = 1 - Math.min(1, Math.hypot(x / 1.3, z / 0.75)) * 0.35; // centre runs a bit hotter
        const t = Math.max(0, Math.min(1, (temp - 25) / 25 * centre + 0.02 * Math.sin(i)));
        if (t < 0.5) this.colors.copy(cool).lerp(warm, t * 2); else this.colors.copy(warm).lerp(hot, (t - 0.5) * 2);
        this.cells.setColorAt(i, this.colors);
      }
      this.cells.instanceColor.needsUpdate = true;
    }
  }
}
