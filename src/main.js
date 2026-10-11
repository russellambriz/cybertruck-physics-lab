import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildTruck, updateSuspension, canvasTex, DIM } from './truck.js';
import { Sim, TRIMS, C, MPH, G } from './physics.js';
import { Airflow } from './airflow.js';
import { BatteryPack } from './battery.js';
import { CellAnim, SteelAnim, GlassAnim } from './chem2d.js';
import { HistoryChart, LoadChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const loadStep = (pct, msg) => { $('loadBar').style.width = pct + '%'; $('loadMsg').textContent = msg; };
loadStep(30, 'Building renderer…');

const isTouch = matchMedia('(pointer: coarse)').matches;
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- renderer / scene
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090c);
scene.fog = new THREE.Fog(0x07090c, 28, 95);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 300);
camera.position.set(7.4, 2.7, 7.6);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.target.set(0, 0.9, 0);
controls.minDistance = 3.2; controls.maxDistance = 26; controls.maxPolarAngle = Math.PI * 0.495;
controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.9;

// lights
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x0b0d10, 0.35));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(6, 11, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
scene.add(sun);
const rim = new THREE.DirectionalLight(0x6fbfff, 1.1); rim.position.set(-8, 4, -6); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffe2c4, 0.45); fill.position.set(-4, 3, 8); scene.add(fill);

// world: tilts with road grade; ground slides/rotates underneath the (fixed) truck
const world = new THREE.Group(); scene.add(world);
const groundGroup = new THREE.Group(); world.add(groundGroup);
const TILE = 20, GSIZE = 400;
const groundTex = canvasTex(1024, 1024, (g, w, h) => {
  g.fillStyle = '#16191d'; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() * 18) | 0; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 2; }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(120,150,180,0.10)'; g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) { const p = i * w / 8; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
  g.strokeStyle = 'rgba(77,225,255,0.22)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 1); g.lineTo(w, 1); g.moveTo(1, 0); g.lineTo(1, h); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 6; i++) g.fillRect(w / 2 - 6, i * h / 6 + 20, 12, h / 12);
}, { repeat: [GSIZE / TILE, GSIZE / TILE], srgb: true });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(GSIZE, GSIZE), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.82, metalness: 0.05, envMapIntensity: 0.4 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; groundGroup.add(ground);
// bollards for a sense of motion
const bollards = [];
{
  const geo = new THREE.CylinderGeometry(0.09, 0.11, 1.0, 12); geo.translate(0, 0.5, 0);
  const capGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.08, 12); capGeo.translate(0, 0.86, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a3037, metalness: 0.6, roughness: 0.4 });
  const cap = new THREE.MeshStandardMaterial({ color: 0x4de1ff, emissive: 0x4de1ff, emissiveIntensity: 2.2 });
  for (let i = -3; i < 3; i++) for (let j = -3; j < 3; j++) {
    if (i === 0 && j === 0) continue;
    const b = new THREE.Group(); const m = new THREE.Mesh(geo, mat); m.castShadow = true; b.add(m, new THREE.Mesh(capGeo, cap));
    b.userData.base = [i * 24 + 12, j * 24 + 12]; groundGroup.add(b); bollards.push(b);
  }
}
// soft contact shadow under the truck
const contact = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.0), new THREE.MeshBasicMaterial({
  map: canvasTex(256, 128, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(0,0,0,0.75)'); r.addColorStop(0.55, 'rgba(0,0,0,0.35)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.save(); g.scale(1, h / w * 1.6); g.fillRect(0, 0, w, w); g.restore(); }),
  transparent: true, depthWrite: false }));
contact.rotation.x = -Math.PI / 2; contact.position.y = 0.006; contact.renderOrder = 1; world.add(contact);

loadStep(55, 'Folding stainless steel…');
// ---------------------------------------------------------------- truck + systems
const truck = buildTruck();
world.add(truck.root);
const pack = new BatteryPack(); truck.body.add(pack.group);
const air = new Airflow(2400, 7); truck.root.add(air.group); air.group.visible = false;

const ghostMat = new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(0x3fc8ff) } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'uniform vec3 color; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(color*(0.05 + 0.5*f), 1.0); }',
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
});

// force vectors
class FatArrow {
  constructor(color, label) {
    this.g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 10).translate(0, 0.5, 0), m);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 14).translate(0, 0.12, 0), m);
    this.shaft.renderOrder = this.head.renderOrder = 10;
    this.g.add(this.shaft, this.head);
    const div = document.createElement('div'); div.className = 'flabel'; div.style.color = '#' + new THREE.Color(color).getHexString();
    this.div = div; this.name = label; this.lbl = new CSS2DObject(div); this.g.add(this.lbl);
  }
  set(origin, dir, len, text) {
    const L = Math.max(0.001, len);
    this.g.visible = len > 0.02;
    this.g.position.copy(origin);
    this.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const sh = Math.max(0.001, L - 0.24);
    this.shaft.scale.set(1, sh, 1); this.head.position.y = sh;
    this.lbl.position.set(0, L + 0.12, 0);
    if (text !== undefined) this.div.textContent = this.name + ' ' + text;
  }
}
const forceGroup = new THREE.Group(); truck.root.add(forceGroup); forceGroup.visible = false;
const arrows = {
  grav: new FatArrow(0xffcc33, 'mg'), nf: new FatArrow(0x66ff99, 'N front'), nr: new FatArrow(0x66ff99, 'N rear'),
  drag: new FatArrow(0x4de1ff, 'Drag'), trac: new FatArrow(0xff5ab4, 'Tire force'), roll: new FatArrow(0xff8a3d, 'Rolling'),
};
Object.values(arrows).forEach((a) => forceGroup.add(a.g));
const labelRenderer = new CSS2DRenderer({ element: $('labels') });

// ---------------------------------------------------------------- post-processing / quality
let composer, bloom;
function makeComposer() {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
makeComposer();
let quality = params.get('q') || (isTouch && Math.min(innerWidth, innerHeight) < 700 ? 'low' : 'high');
function applyQuality() {
  const hi = quality === 'high';
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, hi ? 2 : 1.25));
  sun.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  $('btnQuality').textContent = hi ? 'HQ' : 'LQ';
  onResize();
}
function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h; camera.fov = w < h ? 58 : 38; camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);

// ---------------------------------------------------------------- simulation + input
const sim = new Sim();
const input = { throttle: 0, brake: 0, steer: 0, hardBrake: false };
const keys = new Set();
const padState = { left: false, right: false, brake: false, throttle: false };
function refreshInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  input.throttle = k('KeyW', 'ArrowUp') || padState.throttle ? 1 : 0;
  input.brake = k('KeyS', 'ArrowDown') || padState.brake ? 1 : 0;
  input.hardBrake = keys.has('Space');
  input.steer = (k('KeyA', 'ArrowLeft') || padState.left ? 1 : 0) - (k('KeyD', 'ArrowRight') || padState.right ? 1 : 0);
  if ((input.throttle || input.brake) && sim.test) sim.test = null;
  if (input.throttle && sim.charging) { sim.charging = false; syncChargeBtn(); }
}
const driveKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
  if (driveKeys.has(e.code)) { keys.add(e.code); refreshInput(); e.preventDefault(); return; }
  if (e.repeat) return;
  const map = { Digit1: 'drive', Digit2: 'aero', Digit3: 'battery', Digit4: 'materials' };
  if (map[e.code]) setMode(map[e.code]);
  else if (e.code === 'KeyF') { $('showForces').checked = !$('showForces').checked; syncToggles(); }
  else if (e.code === 'KeyX') { xrayOn = !xrayOn; $('xray').checked = xrayOn; applyXray(); }
  else if (e.code === 'KeyC') cycleCam();
  else if (e.code === 'KeyH' || e.key === '?') toggleHelp();
  else if (e.code === 'Escape') toggleHelp(false);
  else if (e.code === 'KeyR') { sim.reset(); toast('Reset'); }
  else if (e.code === 'KeyL') launch();
  else if (e.code === 'KeyB') brakeTest();
  else if (e.code === 'KeyP') toggleCharge();
});
addEventListener('keyup', (e) => { keys.delete(e.code); refreshInput(); });
addEventListener('blur', () => { keys.clear(); Object.keys(padState).forEach((k) => (padState[k] = false)); document.querySelectorAll('#pad button').forEach((b) => b.classList.remove('on')); refreshInput(); });
document.querySelectorAll('#pad button').forEach((b) => {
  const k = b.dataset.k;
  const on = (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); padState[k] = true; b.classList.add('on'); refreshInput(); };
  const off = (e) => { e.preventDefault(); padState[k] = false; b.classList.remove('on'); refreshInput(); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
});

// ---------------------------------------------------------------- camera presets
const VIEWS = {
  drive: { p: [7.4, 2.7, 7.6], t: [0, 0.9, 0] },
  aero: { p: [1.5, 3.6, 11.5], t: [-1.2, 1.0, 0] },
  battery: { p: [4.6, 5.4, 5.4], t: [0, 0.45, 0] },
  steel: { p: [1.6, 1.25, 4.2], t: [0.6, 0.95, 0.9] },
  glass: { p: [5.0, 3.1, 2.6], t: [1.0, 1.45, 0] },
  chase: { p: [-10.5, 3.4, 0.01], t: [2.0, 1.0, 0] },
  side: { p: [0, 1.3, 11], t: [0, 0.9, 0] },
  top: { p: [0.01, 13, 0.01], t: [0, 0.5, 0] },
  front: { p: [9, 1.4, 2.4], t: [0, 0.9, 0] },
};
const CAMS = ['Orbit', 'Chase', 'Side', 'Top', 'Front'];
let camIdx = 0, tween = null;
function flyTo(name, dur = 1.3) {
  const v = VIEWS[name];
  tween = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...v.p), t1: new THREE.Vector3(...v.t) };
  if (innerWidth < innerHeight) tween.p1.sub(tween.t1).multiplyScalar(1.12).add(tween.t1); // portrait: back off a little
}
controls.addEventListener('start', () => { tween = null; });
function cycleCam() {
  camIdx = (camIdx + 1) % CAMS.length;
  $('camName').textContent = CAMS[camIdx];
  flyTo(camIdx === 0 ? (mode === 'materials' ? matSub : mode) : CAMS[camIdx].toLowerCase());
}

// ---------------------------------------------------------------- modes / UI
let mode = 'drive', matSub = 'steel', xrayOn = true, chemAnims = null;
function setMode(m) {
  mode = m;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  document.querySelectorAll('#left section').forEach((s) => s.classList.toggle('on', s.dataset.mode === m));
  camIdx = 0; $('camName').textContent = 'Orbit';
  flyTo(m === 'materials' ? matSub : m);
  syncToggles(); applyXray();
}
function syncToggles() {
  forceGroup.visible = $('showForces').checked;
  $('labels').style.display = forceGroup.visible ? '' : 'none';
  air.group.visible = mode === 'aero' || $('showFlowDrive').checked;
  truck.markers.steel.visible = mode === 'materials' && matSub === 'steel';
  truck.markers.glass.visible = mode === 'materials' && matSub === 'glass';
}
function applyXray() {
  const on = mode === 'battery' && xrayOn;
  for (const m of truck.xrayable) { m.material = on ? ghostMat : m.userData.mat; m.castShadow = !on; }
  truck.edges.forEach((e) => (e.visible = on));
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

function bindRange(id, fmt, fn) {
  const el = $(id), out = $(id + 'Out') || $(id.replace(/Speed$/, '') + 'Out');
  const upd = () => { const v = parseFloat(el.value); el.style.setProperty('--p', ((v - el.min) / (el.max - el.min) * 100) + '%'); if (out) out.textContent = fmt(v); fn(v); };
  el.addEventListener('input', upd); upd();
  return upd;
}
const lb = (kg) => Math.round(kg * 2.20462).toLocaleString();
bindRange('payload', (v) => `${v} kg · ${lb(v)} lb`, (v) => (sim.payload = v));
bindRange('tow', (v) => `${v.toLocaleString()} kg · ${lb(v)} lb`, (v) => (sim.tow = v));
bindRange('grade', (v) => `${v > 0 ? '+' : ''}${v}% (${(Math.atan(v / 100) * 180 / Math.PI).toFixed(1)}°)`, (v) => (sim.grade = v));
const rideUpd = bindRange('ride', (v) => `${v} mm · ${(v / 25.4).toFixed(1)} in`, (v) => {
  sim.clearance = v / 1000;
  document.querySelectorAll('#rideChips button').forEach((b) => b.classList.toggle('on', +b.dataset.v === v));
});
document.querySelectorAll('#rideChips button').forEach((b) => b.addEventListener('click', () => { $('ride').value = b.dataset.v; rideUpd(); }));
let tunnelMph = 70;
bindRange('tunnelSpeed', (v) => `${v} mph`, (v) => (tunnelMph = v));
bindRange('cd', (v) => v.toFixed(3), (v) => (sim.Cd = v));
bindRange('density', (v) => v, (v) => air.setCount(v));
bindRange('coldWork', (v) => `${v}%`, (v) => chemAnims && chemAnims.steel.setCold(v / 100));
$('autoLower').addEventListener('change', (e) => (sim.autoLower = e.target.checked));
['showForces', 'showFlowDrive'].forEach((id) => $(id).addEventListener('change', syncToggles));
$('xray').addEventListener('change', (e) => { xrayOn = e.target.checked; applyXray(); });
document.querySelectorAll('#trimSeg button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#trimSeg button').forEach((x) => x.classList.toggle('on', x === b));
  sim.trim = TRIMS[b.dataset.v]; pack.setTrim(b.dataset.v); sim.result060 = null; renderSpec();
}));
document.querySelectorAll('#matSeg button').forEach((b) => b.addEventListener('click', () => {
  matSub = b.dataset.v;
  document.querySelectorAll('#matSeg button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-mat]').forEach((d) => (d.hidden = d.dataset.mat !== matSub));
  flyTo(matSub); syncToggles();
}));
function launch() { sim.startLaunch(); toast('Launch! Full throttle until 60 mph'); }
function brakeTest() { sim.startBrakeTest(); toast('Full brakes from 60 mph'); }
$('btnLaunch').onclick = launch; $('btnBrakeTest').onclick = brakeTest;
$('btnReset').onclick = () => { sim.reset(); toast('Reset'); };
function syncChargeBtn() { $('btnCharge').classList.toggle('active', sim.charging); $('btnCharge').innerHTML = sim.charging ? '⏹ Unplug charger <kbd>P</kbd>' : '⚡ Plug in DC fast charger <kbd>P</kbd>'; }
function toggleCharge() {
  if (!sim.charging && Math.abs(sim.v) > 0.3) { toast('Stop the truck before plugging in'); return; }
  if (!sim.charging && sim.soc > 0.995) { toast('Already full'); return; }
  sim.charging = !sim.charging; sim.test = null; syncChargeBtn();
  if (sim.charging) { if (mode !== 'battery') setMode('battery'); toast('Charging (40× time-lapse)'); }
}
$('btnCharge').onclick = toggleCharge;
$('btnSoc80').onclick = () => { sim.soc = 0.8; chemAnims?.cell.init(0.8); };
$('btnSoc20').onclick = () => { sim.soc = 0.2; chemAnims?.cell.init(0.2); };
$('btnScratch').onclick = () => chemAnims.steel.doScratch();
$('btnMild').onclick = () => { const m = !chemAnims.steel.mild; chemAnims.steel.setMild(m); $('btnMild').textContent = m ? 'Back to stainless' : 'Compare: mild steel'; if (m) setTimeout(() => chemAnims.steel.doScratch(), 300); };
$('btnImpact').onclick = () => chemAnims.glass.impact();
$('btnGlassReset').onclick = () => chemAnims.glass.reset();
$('btnCam').onclick = cycleCam;
$('btnQuality').onclick = () => { quality = quality === 'high' ? 'low' : 'high'; autoQ.done = true; applyQuality(); toast(`Quality: ${quality}`); };
function toggleHelp(force) { const h = $('help'); h.hidden = force === undefined ? !h.hidden : !force; }
$('btnHelp').onclick = () => toggleHelp(); $('helpClose').onclick = () => toggleHelp(false);
$('help').addEventListener('click', (e) => { if (e.target.id === 'help') toggleHelp(false); });
$('btnPanelL').onclick = () => { $('left').classList.toggle('open'); $('right').classList.remove('open'); };
$('btnPanelR').onclick = () => { $('right').classList.toggle('open'); $('left').classList.remove('open'); };
canvas.addEventListener('pointerdown', () => { $('left').classList.remove('open'); $('right').classList.remove('open'); });
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

function renderSpec() {
  const t = sim.trim;
  $('trimTag').textContent = t.label;
  $('specCard').innerHTML = `<table><caption>${t.name.toUpperCase()} · APPROX. SPECS</caption>
    <tr><td>Power</td><td>~${t.hp} hp (${t.powerKW} kW)</td></tr>
    <tr><td>0–60 mph (Tesla-quoted, w/ rollout)</td><td>~${t.quoted060} s</td></tr>
    <tr><td>Top speed</td><td>~${t.topMph} mph</td></tr>
    <tr><td>Curb mass</td><td>~${t.curbKg.toLocaleString()} kg (${lb(t.curbKg)} lb)</td></tr>
    <tr><td>Est. range (EPA)</td><td>~${t.rangeMi} mi</td></tr>
    <tr><td>Battery</td><td>~${C.packKWh} kWh · 800 V class</td></tr>
    <tr><td>Drag coeff. / frontal area</td><td>~${C.Cd} / ~${C.baseArea} m²</td></tr>
    <tr><td>Wheelbase / tire Ø</td><td>~${C.wheelbase} m / ~35 in</td></tr>
    <tr><td>Payload / towing</td><td>~2,500 lb / ~11,000 lb</td></tr></table>`;
}
renderSpec();

// ---------------------------------------------------------------- readouts
const fmtF = (n) => (Math.abs(n) >= 10000 ? (n / 1000).toFixed(1) + ' kN' : Math.round(n).toLocaleString() + ' N');
const fmtE = (j) => (j >= 1e6 ? (j / 1e6).toFixed(2) + ' MJ' : (j / 1000).toFixed(0) + ' kJ');
function kv(el, rows) { el.innerHTML = rows.map((r) => (r === '-' ? '<i class="sep"></i>' : `<span>${r[0]}</span><b class="${r[2] || ''}">${r[1]}</b>`)).join(''); }
function updateReadouts() {
  const v = sim.v, spd = Math.abs(v), mph = spd / MPH;
  $('spd').textContent = Math.round(mph); $('spdKmh').textContent = Math.round(spd * 3.6) + ' km/h';
  $('gear').textContent = sim.charging ? 'P ⚡' : sim.gear;
  const pk = sim.P.batt / 1000;
  $('pbarPos').style.width = clamp(pk / 700, 0, 1) * 50 + '%'; $('pbarNeg').style.width = clamp(-pk / 350, 0, 1) * 50 + '%';
  $('testMsg').textContent = sim.test ? (sim.test.type === 'launch' ? `t = ${sim.test.t.toFixed(2)} s` : `d = ${sim.test.d.toFixed(1)} m`) : '';
  const brakeD = sim.stoppingDistance(spd);
  const d60 = sim.stoppingDistance(60 * MPH);
  kv($('readouts'), [
    ['Acceleration', `${sim.a.toFixed(2)} m/s² · ${(sim.a / G).toFixed(2)} g`, 'cy'],
    ['Lateral accel', `${(sim.aLat / G).toFixed(2)} g`],
    ['Wheel power', `${(sim.P.wheel / 1000).toFixed(0)} kW · ${(sim.P.wheel / 745.7).toFixed(0)} hp`],
    ['Wheel torque (total)', `${Math.round(sim.F.drive * C.wheelR).toLocaleString()} N·m`],
    ['Battery power', `${pk.toFixed(0)} kW`, pk < -1 ? 'good' : ''],
    '-',
    ['Drag  ½ρCdAv²', fmtF(Math.abs(sim.F.drag))],
    ['Rolling resistance', fmtF(Math.abs(sim.F.roll))],
    ['Grade force mg·sinθ', fmtF(sim.F.grade)],
    ['Tire (traction) force', fmtF(sim.F.tire)],
    ['Total mass', `${sim.massTotal.toLocaleString()} kg`],
    ['Kinetic energy ½mv²', fmtE(0.5 * sim.massTotal * v * v)],
    '-',
    ['0–60 mph (sim)', sim.result060 ? `${sim.result060.toFixed(2)} s` : '— press launch', sim.result060 ? 'good' : ''],
    ['60–0 mph (sim test)', sim.resultBrake ? `${sim.resultBrake.toFixed(1)} m · ${(sim.resultBrake / 0.3048).toFixed(0)} ft` : '—'],
    ['Stop distance now', spd > 0.5 ? `${brakeD.toFixed(1)} m · ${(brakeD / 0.3048).toFixed(0)} ft` : '0 m'],
    ['60–0 estimate', `${d60.toFixed(1)} m · ${(d60 / 0.3048).toFixed(0)} ft`],
    ['Ride height', `${Math.round(sim.clearanceCur * 1000)} mm`],
  ]);
  // aero
  const U = $('tunnel').checked ? tunnelMph * MPH : spd;
  const Fd = sim.dragAt(U);
  kv($('aeroKV'), [
    ['Air speed', `${(U / MPH).toFixed(0)} mph · ${U.toFixed(1)} m/s`, 'cy'],
    ['Frontal area A (est.)', `${sim.area.toFixed(2)} m²`],
    ['Cd·A', `${sim.CdA.toFixed(3)} m²`],
    ['Dynamic pressure ½ρv²', `${(0.5 * 1.225 * U * U).toFixed(0)} Pa`],
    ['Drag force', fmtF(Fd)],
    ['Drag power', `${(Fd * U / 1000).toFixed(1)} kW`],
    ['Drag energy per mile', `${(Fd * 1609.34 / 3600).toFixed(0)} Wh/mi`],
    ['Drag at 55 / 75 mph', `${(sim.dragAt(55 * MPH) * 55 * MPH / 1000).toFixed(0)} / ${(sim.dragAt(75 * MPH) * 75 * MPH / 1000).toFixed(0)} kW`],
  ]);
  // battery
  const dir = sim.I > 3 ? 1 : sim.I < -3 ? -1 : 0;
  const st = $('cellState');
  st.textContent = sim.charging ? 'DC FAST CHARGING' : dir > 0 ? 'DISCHARGING' : dir < 0 ? 'REGEN CHARGING' : 'IDLE';
  st.className = 'cellstate ' + (dir > 0 ? 'dis' : dir < 0 ? 'chg' : '');
  $('socOut').textContent = (sim.soc * 100).toFixed(1) + '%'; $('socBar').style.width = sim.soc * 100 + '%';
  $('tempOut').textContent = sim.temp.toFixed(1) + ' °C'; $('tempBar').style.width = clamp((sim.temp - 10) / 50, 0.02, 1) * 100 + '%';
  kv($('battKV'), [
    ['Pack voltage (OCV → terminal)', `${sim.ocv.toFixed(0)} → ${sim.V.toFixed(0)} V`, 'cy'],
    ['Avg. cell voltage', `${(sim.V / C.cellsSeries).toFixed(3)} V`],
    ['Current', `${sim.I.toFixed(0)} A`, sim.I < -3 ? 'good' : ''],
    ['Battery power', `${pk.toFixed(1)} kW`],
    ['Joule heat I²R', `${(sim.heat / 1000).toFixed(2)} kW`, sim.heat > 20000 ? 'hot' : ''],
    ['Energy used / regen', `${sim.energyUsed.toFixed(2)} / ${sim.energyRegen.toFixed(2)} kWh`],
    ['Energy left (approx.)', `${(sim.soc * C.packKWh).toFixed(1)} kWh`],
  ]);
  if (rxnDir !== (sim.charging ? -2 : dir)) renderRxn(sim.charging ? -2 : dir);
}
let rxnDir = null;
function renderRxn(d) {
  rxnDir = d;
  const dis = d >= 0;
  const arr = dis ? '→' : '←';
  $('rxn').innerHTML = `
    <span class="t">${dis ? (d === 0 ? 'Discharge reactions (idle — drive to run them)' : 'Discharging: ions leave graphite, electrons power the motors') : 'Charging: the reactions run in reverse'}</span>
    <span class="${dis ? 'ox' : 'red'}">(−) Li<sub>x</sub>C<sub>6</sub> ${arr} C<sub>6</sub> + x Li⁺ + x e⁻</span> <span class="t" style="display:inline">${dis ? 'oxidation' : 'reduction'}</span><br>
    <span class="${dis ? 'red' : 'ox'}">(+) Li<sub>1−x</sub>MO<sub>2</sub> + x Li⁺ + x e⁻ ${arr} LiMO<sub>2</sub></span> <span class="t" style="display:inline">${dis ? 'reduction' : 'oxidation'}</span><br>
    <span>Overall: Li<sub>x</sub>C<sub>6</sub> + Li<sub>1−x</sub>MO<sub>2</sub> ${arr} C<sub>6</sub> + LiMO<sub>2</sub></span>
    <span class="t">M = Ni, Mn, Co (high-nickel NMC). Simplest form: LiC<sub>6</sub> ${arr} C<sub>6</sub> + Li⁺ + e⁻</span>`;
}

// ---------------------------------------------------------------- charts / chem
const hist = new HistoryChart($('histChart'));
const load = new LoadChart($('loadChart'));
chemAnims = { cell: new CellAnim($('cellCanvas')), steel: new SteelAnim($('steelCanvas')), glass: new GlassAnim($('glassCanvas')) };
chemAnims.cell.init(sim.soc);

// ---------------------------------------------------------------- frame loop
const tmpV = new THREE.Vector3(), down = new THREE.Vector3();
let last = performance.now(), uiAcc = 1, chartAcc = 1, simT = 0, tilt = 0;
const autoQ = { t: 0, frames: 0, done: params.has('q') };
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const logLen = (F) => 0.3 * Math.log2(1 + Math.abs(F) / 400);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 20); last = now;
  sim.update(dt, input); simT += dt;

  // world motion
  groundTex.offset.set(sim.posX / TILE, -sim.posZ / TILE);
  groundGroup.rotation.y = -sim.heading;
  for (const b of bollards) {
    const [bx, bz] = b.userData.base, P = 144;
    b.position.set(((bx - sim.posX) % P + P * 1.5) % P - P / 2, 0, ((bz - sim.posZ) % P + P * 1.5) % P - P / 2);
  }
  tilt += (Math.atan(sim.grade / 100) - tilt) * Math.min(1, dt * 4);
  world.rotation.z = tilt;

  // body + wheels
  const off = sim.clearanceCur - DIM.baseClear;
  truck.rig.position.y = DIM.cgY + off;
  truck.rig.rotation.set(sim.roll, 0, sim.pitch);
  const s = sim.steer, ack = 0.12 * Math.sign(s);
  for (const w of truck.wheels) {
    w.spin.rotation.z = -sim.wheelAngle;
    if (w.front) w.steer.rotation.y = s * (1 + (w.side < 0 ? ack : -ack));
  }
  updateSuspension(truck);
  pack.update(dt, sim.I, sim.temp, simT);
  if (air.group.visible) air.update(dt, $('tunnel').checked && mode === 'aero' ? tunnelMph * MPH : Math.abs(sim.v), off);

  // materials markers pulse
  const pulse = 1 + 0.25 * Math.sin(simT * 4);
  truck.markers.steel.scale.setScalar(pulse); truck.markers.glass.scale.setScalar(pulse);

  // force vectors (log-scaled lengths; labels in kN)
  if (forceGroup.visible) {
    const th = tilt, F = sim.F, sgn = Math.sign(sim.v) || 1, mt = sim.massTruck;
    const cg = tmpV.set(0, 0.95 + off, 0);
    down.set(-Math.sin(th), -Math.cos(th), 0);
    arrows.grav.set(cg, down, logLen(mt * G), `${(mt * G / 1000).toFixed(1)} kN`);
    arrows.nf.set(new THREE.Vector3(DIM.axle, 0.02, DIM.halfW + 0.25), new THREE.Vector3(0, 1, 0), logLen(F.Nf), `${(F.Nf / 1000).toFixed(1)} kN`);
    arrows.nr.set(new THREE.Vector3(-DIM.axle, 0.02, DIM.halfW + 0.25), new THREE.Vector3(0, 1, 0), logLen(F.Nr), `${(F.Nr / 1000).toFixed(1)} kN`);
    const dl = logLen(F.drag);
    arrows.drag.set(new THREE.Vector3(2.95 + (sgn > 0 ? dl : 0), 1.15 + off, 0), new THREE.Vector3(-sgn, 0, 0), dl, `${(Math.abs(F.drag) / 1000).toFixed(2)} kN`);
    arrows.trac.set(new THREE.Vector3(-DIM.axle, 0.04, -(DIM.halfW + 0.25)), new THREE.Vector3(Math.sign(F.tire) || 1, 0, 0), logLen(F.tire), `${(F.tire / 1000).toFixed(1)} kN`);
    arrows.roll.set(new THREE.Vector3(DIM.axle, 0.04, -(DIM.halfW + 0.25)), new THREE.Vector3(-sgn, 0, 0), logLen(F.roll), `${(Math.abs(F.roll) / 1000).toFixed(2)} kN`);
  }

  // camera
  if (tween) {
    tween.t += dt / tween.dur; const k = easeIO(Math.min(1, tween.t));
    camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.t0, tween.t1, k);
    if (tween.t >= 1) tween = null;
  }
  controls.update();

  if (quality === 'high') composer.render(); else renderer.render(scene, camera);
  if (forceGroup.visible) labelRenderer.render(scene, camera);

  // 2D panels (only what is visible)
  if (mode === 'battery') { chemAnims.cell.update(dt, sim.I, sim.soc, sim.charging); chemAnims.cell.draw(); }
  if (mode === 'materials') { const a = chemAnims[matSub]; a.update(dt); a.draw(); }
  uiAcc += dt; chartAcc += dt;
  if (uiAcc > 1 / 12) { uiAcc = 0; updateReadouts(); }
  if (chartAcc > 1 / 10) { chartAcc = 0; hist.push(simT, Math.abs(sim.v) / MPH, sim.P.batt / 1000, sim.a / G); hist.draw(); load.draw(sim, Math.abs(sim.v) / MPH); }

  // adaptive quality: if the first seconds on HQ run slow, drop to LQ once
  if (!autoQ.done) {
    autoQ.t += dt; autoQ.frames++;
    if (autoQ.t > 4) { autoQ.done = true; const fps = autoQ.frames / autoQ.t; if (fps < 40 && quality === 'high') { quality = 'low'; applyQuality(); toast(`Switched to LQ for smoothness (${fps.toFixed(0)} fps)`); } }
  }
  if (!window.__appReady) {
    window.__appReady = true;
    loadStep(100, 'Ready');
    setTimeout(() => $('loader').classList.add('done'), 250);
    setTimeout(() => $('loader').remove(), 1200);
  }
}

loadStep(85, 'Compiling shaders…');
applyQuality();
const startMode = params.get('mode');
setMode(['drive', 'aero', 'battery', 'materials'].includes(startMode) ? startMode : 'drive');
if (params.get('mat') === 'glass') document.querySelector('#matSeg button[data-v=glass]').click();
if (params.has('forces')) { $('showForces').checked = true; syncToggles(); }
if (tween) { camera.position.copy(tween.p1); controls.target.copy(tween.t1); tween = null; }
renderer.compile(scene, camera);
if (!isTouch && innerWidth > 900 && !localStorage.getItem('ct-help-seen') && !params.has('nohelp')) { toggleHelp(true); localStorage.setItem('ct-help-seen', '1'); }
requestAnimationFrame((t) => { last = t; frame(t); });
window.__sim = sim; // handy for console experiments
