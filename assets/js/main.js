import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadRav4Model, MODULES } from './rav4-model.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const isMobile = matchMedia('(max-width: 760px)').matches || (navigator.maxTouchPoints > 0 && innerWidth < 900);
const params = new URLSearchParams(location.search);

const stage = $('#stage');
const boot = $('#boot');
const bootBar = $('#bootBar');
const bootNum = $('#bootNum');
const toastEl = $('#toast');
const partListEl = $('#partList');
const explodeRange = $('#explodeRange');
const explodeValue = $('#explodeValue');
const rangeFill = $('#rangeFill');

const MODULE_MAP = new Map(MODULES.map((m) => [m.id, m]));
const INTERIOR_MODULES = new Set(['interior']);
const EXTERIOR_MODULES = new Set(['shell', 'glass', 'lights']);

let toastTimer = 0;
function toast(message, ms = 1900) {
  toastEl.textContent = message;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), ms);
}

// ---------------------------------------------------------------------------
// Renderer, camera and lighting
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true
});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.45 : 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x182022, 18, 34);
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.08, 60);
camera.position.set(4.6, 2.3, 5.1);

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
const envRT = pmrem.fromScene(new RoomEnvironment(), 0.035);
scene.environment = envRT.texture;

const hemi = new THREE.HemisphereLight(0xe8f0ed, 0x3a4645, 1.88);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff4e6, 2.65);
key.position.set(5.6, 8.4, 5.4);
key.target.position.set(0, 0.55, 0);
key.castShadow = true;
key.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
key.shadow.camera.left = -5.2; key.shadow.camera.right = 5.2;
key.shadow.camera.top = 4.7; key.shadow.camera.bottom = -4.7;
key.shadow.camera.near = 0.5; key.shadow.camera.far = 24;
key.shadow.bias = -0.00035;
key.shadow.normalBias = 0.025;
key.shadow.radius = 3;
scene.add(key, key.target);

const fill = new THREE.DirectionalLight(0xbfd4d2, 1.48);
fill.position.set(-5.5, 4.2, 2.8);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffc6a5, 1.55);
rim.position.set(-2.4, 5.2, -6.2);
scene.add(rim);
const frontFill = new THREE.DirectionalLight(0xf4f5ee, 1.42);
frontFill.position.set(0.2, 2.8, 8.5);
frontFill.target.position.set(0, 0.72, 0);
scene.add(frontFill, frontFill.target);
const bottomFill = new THREE.PointLight(0xcfe4dc, 34, 8.5, 1.6);
bottomFill.position.set(0, -1.7, 0.5);
scene.add(bottomFill);
const warmKick = new THREE.PointLight(0xff8a54, 3.0, 6.0, 2.0);
warmKick.position.set(-3.5, 1.0, -3.5);
scene.add(warmKick);
const underKey = new THREE.DirectionalLight(0xc9ddd6, 2.7);
underKey.position.set(-2.2, -4.2, 1.8);
underKey.target.position.set(0, 0.35, -0.3);
scene.add(underKey, underKey.target);
const underRim = new THREE.DirectionalLight(0xffd2b0, 1.35);
underRim.position.set(3.2, -2.2, -3.8);
scene.add(underRim);
const underFill = new THREE.DirectionalLight(0xc4d8d1, 1.8);
underFill.position.set(1.8, -5.8, 4.6);
underFill.target.position.set(0, 0.26, -0.15);
scene.add(underFill, underFill.target);
const cabinFill = new THREE.PointLight(0xffefd7, 18, 4.2, 2.0);
cabinFill.position.set(0, 1.28, 0.28);
cabinFill.visible = false;
scene.add(cabinFill);
const engineFill = new THREE.PointLight(0xe6f3ef, 15, 3.4, 2.0);
engineFill.position.set(0, 0.98, 1.48);
engineFill.visible = false;
scene.add(engineFill);

// transparent studio floor: shadow catcher + soft contact patch + optional grid
const floor = new THREE.Group();
floor.name = 'Studio ground';
scene.add(floor);
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 13),
  new THREE.ShadowMaterial({ color: 0x050707, opacity: 0.26, transparent: true, depthWrite: false })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = 0.002;
shadowCatcher.receiveShadow = true;
floor.add(shadowCatcher);

function makeContactTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 250);
  g.addColorStop(0, 'rgba(0,0,0,.54)');
  g.addColorStop(0.34, 'rgba(0,0,0,.26)');
  g.addColorStop(0.72, 'rgba(0,0,0,.06)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(6.8, 3.1),
  new THREE.MeshBasicMaterial({ map: makeContactTexture(), transparent: true, opacity: 0.68, depthWrite: false, toneMapped: false })
);
contact.rotation.x = -Math.PI / 2;
contact.position.set(0, 0.006, -0.02);
contact.renderOrder = 1;
floor.add(contact);

function makeFloorGlow() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 250);
  g.addColorStop(0, 'rgba(132,144,140,.32)');
  g.addColorStop(0.38, 'rgba(93,105,102,.16)');
  g.addColorStop(0.72, 'rgba(65,74,72,.05)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const floorGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(9.5, 6.2),
  new THREE.MeshBasicMaterial({ map: makeFloorGlow(), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false })
);
floorGlow.rotation.x = -Math.PI / 2;
floorGlow.position.y = 0.003;
floorGlow.renderOrder = 0;
floor.add(floorGlow);

const grid = new THREE.GridHelper(9.5, 38, 0x8f9d99, 0x667270);
grid.position.y = 0.008;
grid.material.transparent = true;
grid.material.opacity = 0.12;
grid.material.depthWrite = false;
floor.add(grid);

const surveyRing = new THREE.Mesh(
  new THREE.RingGeometry(3.28, 3.295, 128),
  new THREE.MeshBasicMaterial({ color: 0xb6b9ae, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false })
);
surveyRing.rotation.x = -Math.PI / 2; surveyRing.position.y = 0.01; floor.add(surveyRing);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.78, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.rotateSpeed = 0.54;
controls.zoomSpeed = 0.72;
controls.panSpeed = 0.65;
controls.minDistance = 2.1;
controls.maxDistance = 70;
controls.minPolarAngle = 0.06;
controls.maxPolarAngle = Math.PI - 0.025;
controls.screenSpacePanning = true;
controls.autoRotateSpeed = 0.55;
controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
controls.touches.ONE = THREE.TOUCH.ROTATE;
controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
controls.update();

// ---------------------------------------------------------------------------
// Scene content and state
// ---------------------------------------------------------------------------
const VIEWS = {
  hero: { pos: [4.5, 2.25, 4.95], target: [0, 0.78, 0], zoom: 1.0 },
  front: { pos: [0.02, 1.30, 7.05], target: [0, 0.76, 0], zoom: 0.93 },
  side: { pos: [7.35, 1.35, 0.06], target: [0, 0.77, 0], zoom: 1.03 },
  rear: { pos: [3.05, 1.65, -6.55], target: [0, 0.82, 0], zoom: 1.02 },
  under: { pos: [2.73, -13.5, 8.55], target: [0, 0.78, -0.16], zoom: 1.0 },
  top: { pos: [0.001, 8.1, 0.001], target: [0, 0.5, 0], zoom: 1.0 },
  engine: { pos: [4.45, 3.05, 4.55], target: [0, 0.90, 0.90], zoom: 1.08 },
  interior: { pos: [3.85, 3.25, 3.75], target: [0, 0.82, -0.20], zoom: 1.06 },
  underbody: { pos: [1.9, -5.9, 3.9], target: [0, 0.34, -0.20], zoom: 1.00 }
};

const state = {
  explode: 0, targetExplode: 0, explodeAnimating: false,
  xray: false, labels: true, ground: true, autoRotate: false,
  selected: null, view: 'hero', booted: false, screenshotMode: params.get('ui') === '0'
};
let vehicle = null;
let currentView = 'hero';
let camTween = null;
let allMeshes = [];
let outlineObjects = [];
let xrayObjects = [];
let labelRecords = [];
let lastLabelUpdate = 0;
let lastTime = performance.now();

function responsiveScale() {
  const a = innerWidth / innerHeight;
  if (a < 0.58) return 2.02;
  if (a < 0.78) return 1.62;
  if (a < 1.00) return 1.30;
  return 1.0;
}

function viewPose(viewId) {
  const conf = VIEWS[viewId] || VIEWS.hero;
  const explode = state.explode || 0;
  const baseScale = (viewId === 'under' || viewId === 'underbody') ? Math.min(responsiveScale(), 1.22) : responsiveScale();
  const s = baseScale * (conf.zoom || 1) * (1 + explode * 0.56) * (vehicle?.isGltf ? 1.72 : 1);
  const target = new THREE.Vector3(...conf.target);
  target.y += explode * 0.42;
  const pos = new THREE.Vector3(...conf.pos).sub(target).multiplyScalar(s).add(target);
  return { pos, target };
}

function transitionCamera(pos, target, duration = 950, onDone) {
  camTween = {
    fromPos: camera.position.clone(), toPos: pos.clone(),
    fromTarget: controls.target.clone(), toTarget: target.clone(),
    start: performance.now(), duration, onDone
  };
  controls.autoRotate = false;
}

function setView(viewId, instant = false) {
  const pose = viewPose(viewId);
  currentView = viewId;
  state.view = viewId;
  $$('.view-grid [data-view],.mobile-view-strip [data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === viewId));
  if (instant) {
    camera.position.copy(pose.pos);
    controls.target.copy(pose.target);
    controls.update();
    camTween = null;
  } else {
    transitionCamera(pose.pos, pose.target, 1050);
  }
}

// ---------------------------------------------------------------------------
// Visual state, selection and X-RAY
// ---------------------------------------------------------------------------
function clearXrayOutline() {
  for (const obj of xrayObjects) {
    if (obj.parent) obj.parent.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }
  xrayObjects = [];
}

function buildXrayOutline() {
  clearXrayOutline();
  if (!state.xray || !vehicle || vehicle.isGltf) return;
  const lineMat = new THREE.LineBasicMaterial({ color: 0xb9dfd5, transparent: true, opacity: 0.30, depthTest: true, depthWrite: false, toneMapped: false });
  for (const moduleId of ['shell', 'doors', 'front', 'tailgate', 'hood']) {
    const meshes = (vehicle.moduleMeshes.get(moduleId) || [])
      .filter((m) => m.visible && m.userData.isShell && m.geometry?.attributes?.position?.count > 40)
      .sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count)
      .slice(0, 8);
    for (const mesh of meshes) {
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 52), lineMat);
      line.renderOrder = 7;
      line.raycast = () => {};
      mesh.add(line);
      xrayObjects.push(line);
    }
  }
}

function applyVisualState() {
  if (!vehicle) return;
  for (const mesh of allMeshes) {
    const mat = mesh.material;
    if (!mat || !mat.userData || mat.userData.baseOpacity === undefined) continue;
    const mod = mesh.userData.moduleId;
    const isSelected = state.selected && mod === state.selected;
    const isGhost = state.xray && EXTERIOR_MODULES.has(mod);
    const ghostDecorative = isGhost && !isSelected && mod !== 'glass' && !mesh.userData.isShell;
    if (mesh.visible === ghostDecorative) mesh.visible = !ghostDecorative;
    let opacity = mat.userData.baseOpacity;
    let transparent = mat.userData.baseTransparent;
    let depthWrite = mat.userData.baseDepthWrite;
    if (isGhost) {
      opacity = mod === 'glass' ? 0.035 : 0.055;
      transparent = true;
      depthWrite = false;
    }
    if (state.selected && !isSelected) {
      opacity = Math.min(opacity * (isGhost ? 0.72 : 0.55), 0.55);
      transparent = true;
      depthWrite = false;
    }
    if (isSelected && isGhost) {
      opacity = 0.30;
      transparent = true;
      depthWrite = false;
    }
    if (isSelected && !isGhost) {
      opacity = mat.userData.baseOpacity;
      transparent = mat.userData.baseTransparent;
      depthWrite = mat.userData.baseDepthWrite;
    }
    if (mat.opacity !== opacity || mat.transparent !== transparent || mat.depthWrite !== depthWrite) {
      mat.opacity = opacity;
      mat.transparent = transparent;
      mat.depthWrite = depthWrite;
      mat.needsUpdate = true;
    }
  }
  buildOutline();
  buildXrayOutline();
}

function clearOutline() {
  for (const obj of outlineObjects) {
    if (obj.parent) obj.parent.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }
  outlineObjects = [];
}

function buildOutline() {
  clearOutline();
  if (!state.selected || !vehicle) return;
  const meshes = (vehicle.moduleMeshes.get(state.selected) || []).filter((m) => m.visible && m.geometry && m.geometry.attributes.position);
  meshes.sort((a, b) => {
    a.geometry.computeBoundingSphere(); b.geometry.computeBoundingSphere();
    return (b.geometry.boundingSphere?.radius || 0) - (a.geometry.boundingSphere?.radius || 0);
  });
  const selected = [];
  for (const mesh of meshes) {
    if (selected.length >= 34) break;
    if (mesh.material?.map && !mesh.userData.hasEdges) continue;
    if (mesh.geometry.attributes.position.count < 24) continue;
    if (mesh.geometry.attributes.position.count > 70000) continue;
    selected.push(mesh);
  }
  const lineMat = new THREE.LineBasicMaterial({ color: 0xff865d, transparent: true, opacity: 0.68, depthTest: true, depthWrite: false, toneMapped: false });
  for (const mesh of selected) {
    const eg = new THREE.EdgesGeometry(mesh.geometry, 44);
    const line = new THREE.LineSegments(eg, lineMat);
    line.renderOrder = 8;
    line.raycast = () => {};
    mesh.add(line);
    outlineObjects.push(line);
  }
}

function setSelected(moduleId, { focus = false } = {}) {
  if (!moduleId || !MODULE_MAP.has(moduleId)) { clearSelected(); return; }
  state.selected = moduleId;
  const info = MODULE_MAP.get(moduleId);
  $('#selIndex').textContent = `MODULE ${String(MODULES.indexOf(info) + 1).padStart(2, '0')}`;
  $('#selName').textContent = info.name;
  $('#selDesc').textContent = info.desc;
  $('#selMeta').innerHTML = info.meta.map((m) => `<span>${m}</span>`).join('');
  document.body.classList.add('inspector-open');
  $$('.part-row').forEach((r) => r.classList.toggle('is-active', r.dataset.module === moduleId));
  $$('.part-label').forEach((l) => l.classList.toggle('is-active', l.dataset.module === moduleId));
  applyVisualState();
  if (focus) {
    if (INTERIOR_MODULES.has(moduleId) && !state.xray) {
      setXray(true, false);
      toast('已开启 X-RAY，查看内部结构');
    }
    focusModule(moduleId);
  }
  updateLabels(true);
}

function clearSelected() {
  state.selected = null;
  document.body.classList.remove('inspector-open');
  $$('.part-row').forEach((r) => r.classList.remove('is-active'));
  $$('.part-label').forEach((l) => l.classList.remove('is-active'));
  clearOutline();
  applyVisualState();
  updateLabels(true);
}

function focusModule(moduleId) {
  if (!vehicle) return;
  const info = MODULE_MAP.get(moduleId);
  const box = vehicle.moduleBounds(moduleId);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  let confId = info.view || 'hero';
  if (moduleId === 'interior') confId = 'interior';
  if (moduleId === 'wheels') confId = 'side';
  if (moduleId === 'lights') confId = 'front';
  currentView = confId;
  state.view = confId;
  $$('.view-grid [data-view],.mobile-view-strip [data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === confId));
  const conf = VIEWS[confId] || VIEWS.hero;
  const dir = new THREE.Vector3(...conf.pos).sub(new THREE.Vector3(...conf.target)).normalize();
  const dist = clamp(size.length() * 1.03 + 2.15, 2.9, 9.2);
  const target = center.clone();
  const pos = target.clone().addScaledVector(dir, dist);
  transitionCamera(pos, target, 1100);
}

function setXray(on, announce = true) {
  state.xray = !!on;
  cabinFill.visible = state.xray;
  engineFill.visible = state.xray;
  const btn = $('[data-action="xray"]');
  btn.classList.toggle('is-on', state.xray);
  btn.setAttribute('aria-pressed', String(state.xray));
  applyVisualState();
  updateLabels(true);
  if (announce) toast(state.xray ? 'X-RAY 透视已开启 · 内部结构可见' : 'X-RAY 透视已关闭');
}

// ---------------------------------------------------------------------------
// Explosion controls
// ---------------------------------------------------------------------------
function updateExplosionUI(value) {
  const pct = Math.round(value * 100);
  explodeValue.textContent = String(pct).padStart(3, '0');
  rangeFill.style.width = `${value * 100}%`;
  const shell = rangeFill.parentElement?.parentElement;
  if (shell) shell.style.setProperty('--p', `${value * 100}%`);
  if (document.activeElement !== explodeRange) explodeRange.value = String(Math.round(value * 100));
  $$('.preset').forEach((b) => b.classList.toggle('is-active', Math.abs(value - Number(b.dataset.preset)) < 0.012));
}

const _fitBox = new THREE.Box3();
const _fitCorner = new THREE.Vector3();

function vehicleWorldBounds() {
  _fitBox.makeEmpty();
  if (!vehicle) return _fitBox;
  vehicle.root.updateMatrixWorld(true);
  vehicle.root.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    if (!b || b.isEmpty()) return;
    _fitBox.union(b.clone().applyMatrix4(o.matrixWorld));
  });
  return _fitBox;
}

// Distance needed to fit the whole vehicle box into the current frustum.
function poseToFit(box, dir, margin = 1.10) {
  const center = box.getCenter(new THREE.Vector3());
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const up = Math.abs(dir.y) > 0.985 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const camUp = new THREE.Vector3().crossVectors(dir, right).normalize();
  let halfW = 0;
  let halfH = 0;
  let halfD = 0;
  for (let i = 0; i < 8; i++) {
    _fitCorner.set(
      (i & 1) ? box.max.x : box.min.x,
      (i & 2) ? box.max.y : box.min.y,
      (i & 4) ? box.max.z : box.min.z
    ).sub(center);
    halfW = Math.max(halfW, Math.abs(_fitCorner.dot(right)));
    halfH = Math.max(halfH, Math.abs(_fitCorner.dot(camUp)));
    halfD = Math.max(halfD, Math.abs(_fitCorner.dot(dir)));
  }
  const dist = Math.max(halfW / Math.tan(hFov / 2), halfH / Math.tan(vFov / 2)) * margin + halfD;
  return { pos: center.clone().addScaledVector(dir, dist), target: center };
}

function reframeExplosion(value, animate = true) {
  const fromDir = camera.position.clone().sub(controls.target);
  if (fromDir.lengthSq() < 0.001) {
    const conf = VIEWS[currentView] || VIEWS.hero;
    fromDir.set(...conf.pos).sub(new THREE.Vector3(...conf.target));
  }
  fromDir.normalize();
  let pose = null;
  if (value > 0.02 && vehicle) {
    const prev = state.explode;
    vehicle.setExplosion(value);
    const box = vehicleWorldBounds();
    vehicle.setExplosion(prev);
    if (!box.isEmpty()) pose = poseToFit(box, fromDir, 1.22);
  }
  if (!pose) {
    const base = viewPose(currentView);
    const target = base.target.clone();
    target.y += value * 0.20;
    pose = { pos: base.pos, target };
  }
  if (animate) transitionCamera(pose.pos, pose.target, 900);
  else {
    camera.position.copy(pose.pos);
    controls.target.copy(pose.target);
    controls.update();
  }
}

function setExplosion(value, { animate = false, reframe = false } = {}) {
  const v = clamp(value, 0, 1);
  if (animate) {
    state.targetExplode = v;
    state.explodeAnimating = true;
  } else {
    state.targetExplode = v;
    state.explode = v;
    state.explodeAnimating = false;
    if (vehicle) vehicle.setExplosion(v);
    updateExplosionUI(v);
    updateLabels(true);
  }
  if (reframe) reframeExplosion(v, animate);
}

function tickExplosion(dt) {
  if (!state.explodeAnimating) return;
  const delta = state.targetExplode - state.explode;
  if (Math.abs(delta) < 0.0008) {
    state.explode = state.targetExplode;
    state.explodeAnimating = false;
  } else {
    const speed = 1 - Math.exp(-dt * 5.4);
    state.explode += delta * speed;
  }
  if (vehicle) vehicle.setExplosion(state.explode);
  updateExplosionUI(state.explode);
  updateLabels(true);
}

// ---------------------------------------------------------------------------
// Part list and UI controls
// ---------------------------------------------------------------------------
function buildPartList() {
  partListEl.innerHTML = MODULES.map((m, i) => `
    <button class="part-row" data-module="${m.id}" role="listitem">
      <span class="part-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="part-name"><b>${m.name}</b><small>${m.en}</small></span>
      <span class="part-arrow">›</span>
    </button>`).join('');
  partListEl.addEventListener('click', (e) => {
    const row = e.target.closest('.part-row');
    if (!row) return;
    setSelected(row.dataset.module, { focus: true });
    if (isMobile) document.body.classList.remove('parts-open');
  });
}

function setGround(on) {
  state.ground = !!on;
  floor.visible = state.ground;
  const btn = $('[data-action="ground"]');
  btn.classList.toggle('is-on', state.ground);
  btn.setAttribute('aria-pressed', String(state.ground));
}

function setAutoRotate(on) {
  state.autoRotate = !!on;
  controls.autoRotate = state.autoRotate;
  if (state.autoRotate) camTween = null;
  const btn = $('[data-action="autorotate"]');
  btn.classList.toggle('is-on', state.autoRotate);
  btn.setAttribute('aria-pressed', String(state.autoRotate));
  toast(state.autoRotate ? '自动旋转已开启' : '自动旋转已关闭');
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    (document.documentElement.requestFullscreen?.() || Promise.resolve()).catch(() => toast('当前浏览器不支持全屏'));
  } else {
    document.exitFullscreen?.();
  }
}

async function captureScreenshot() {
  if (!vehicle) return;
  renderer.render(scene, camera);
  const src = renderer.domElement;
  const out = document.createElement('canvas');
  out.width = src.width; out.height = src.height;
  const ctx = out.getContext('2d');
  const h = out.height, w = out.width, s = h / 1080;
  const g = ctx.createLinearGradient(0, 0, w * 0.25, h);
  g.addColorStop(0, '#3d4747'); g.addColorStop(0.38, '#242c2d'); g.addColorStop(1, '#0d1112');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const halo = ctx.createRadialGradient(w * 0.52, h * 0.4, 0, w * 0.52, h * 0.4, w * 0.48);
  halo.addColorStop(0, 'rgba(176,187,183,.28)'); halo.addColorStop(0.55, 'rgba(120,132,130,.08)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0);
  ctx.fillStyle = 'rgba(241,237,228,.9)';
  ctx.font = `600 ${22 * s}px "Arial Narrow", Inter, sans-serif`;
  ctx.fillText('TOYOTA  RAV4  /  XA30', 58 * s, 82 * s);
  ctx.fillStyle = 'rgba(241,237,228,.38)';
  ctx.font = `400 ${9 * s}px Consolas, monospace`;
  ctx.fillText('2012  ·  2.4L AUTOMATIC AWD  ·  3D DISASSEMBLY', 59 * s, 103 * s);
  ctx.strokeStyle = '#f16c43'; ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.moveTo(58 * s, 120 * s); ctx.lineTo(118 * s, 120 * s); ctx.stroke();
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(241,237,228,.52)';
  ctx.font = `400 ${10 * s}px Consolas, monospace`;
  ctx.fillText(`EXPLODE  ${String(Math.round(state.explode * 100)).padStart(3, '0')}%`, w - 58 * s, h - 58 * s);
  ctx.fillStyle = 'rgba(241,237,228,.25)';
  ctx.fillText('2AZ-FE  125 kW  ·  224 N·m  ·  4AT  ·  AWD', w - 58 * s, h - 39 * s);
  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) { toast('截图生成失败'); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `RAV4-XA30-2012-${Date.now()}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('当前画面截图已生成');
}

function resetAll() {
  clearSelected();
  setExplosion(0, { animate: true });
  setXray(false, false);
  setAutoRotate(false);
  state.labels = true;
  $('[data-action="labels"]').classList.add('is-on');
  setGround(true);
  setView('hero');
  document.body.classList.remove('parts-open');
  toast('车辆已复位');
}

function bindUI() {
  $('[data-action="xray"]').addEventListener('click', () => setXray(!state.xray));
  $('[data-action="labels"]').addEventListener('click', (e) => {
    state.labels = !state.labels;
    e.currentTarget.classList.toggle('is-on', state.labels);
    e.currentTarget.setAttribute('aria-pressed', String(state.labels));
    if (!state.labels) $$('.part-label').forEach((l) => l.classList.add('is-hidden'));
    else updateLabels(true);
  });
  $('[data-action="autorotate"]').addEventListener('click', () => setAutoRotate(!state.autoRotate));
  $('[data-action="ground"]').addEventListener('click', () => setGround(!state.ground));
  $('[data-action="screenshot"]').addEventListener('click', captureScreenshot);
  $('[data-action="fullscreen"]').addEventListener('click', toggleFullscreen);
  $('[data-action="reset"]').addEventListener('click', resetAll);
  $('[data-action="deselect"]').addEventListener('click', clearSelected);
  $('[data-action="focus-selected"]').addEventListener('click', () => state.selected && focusModule(state.selected));
  $('[data-action="parts"]').addEventListener('click', () => document.body.classList.toggle('parts-open'));
  $('[data-action="parts-close"]').addEventListener('click', () => document.body.classList.remove('parts-open'));
  $$('.preset').forEach((btn) => btn.addEventListener('click', () => {
    setExplosion(Number(btn.dataset.preset), { animate: true, reframe: true });
    if (isMobile) document.body.classList.remove('parts-open');
  }));
  explodeRange.addEventListener('input', () => {
    setExplosion(Number(explodeRange.value) / 100, { animate: false });
    if (state.autoRotate) setAutoRotate(false);
  });
  $$('.view-grid [data-view],.mobile-view-strip [data-view]').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });
  document.addEventListener('fullscreenchange', () => {
    $('[data-action="fullscreen"]').classList.toggle('is-on', !!document.fullscreenElement);
  });
  controls.addEventListener('start', () => { camTween = null; });
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || down.button !== 0) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved > 7 || dt > 800) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const candidates = vehicle.pickables.filter((m) => m.visible && !(state.xray && EXTERIOR_MODULES.has(m.userData.moduleId)));
    const hits = ray.intersectObjects(candidates, false);
    if (hits.length) {
      const mesh = hits[0].object;
      if (mesh.userData.moduleId) setSelected(mesh.userData.moduleId);
    } else if (state.selected) clearSelected();
  });
  renderer.domElement.addEventListener('dblclick', () => {
    if (state.selected) focusModule(state.selected);
  });
  window.addEventListener('resize', onResize);
  window.matchMedia?.('(orientation: landscape)').addEventListener?.('change', onResize);
}

// ---------------------------------------------------------------------------
// HTML leader-line labels with collision avoidance
// ---------------------------------------------------------------------------
function buildLabels() {
  const layer = $('#labelLayer');
  const svg = $('#leaderLayer');
  const anchors = vehicle.getAnchors();
  const wanted = new Map();
  for (const a of anchors) if (a.label && a.moduleId !== 'glass') wanted.set(a.moduleId, a);
  for (const [moduleId, a] of wanted) {
    const el = document.createElement('button');
    el.className = 'part-label is-hidden';
    el.dataset.module = moduleId;
    el.innerHTML = `<b>${a.label}</b><small>${a.sub || MODULE_MAP.get(moduleId).en}</small>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); setSelected(moduleId); });
    layer.appendChild(el);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '2.3'); dot.setAttribute('fill', '#f16c43');
    svg.append(path, dot);
    labelRecords.push({ moduleId, el, path, dot, anchor: a });
  }
}

function labelSafeRect() {
  if (innerWidth <= 760) return { l: 10, r: innerWidth - 10, t: 96, b: innerHeight - 206 };
  if (innerWidth <= 980) return { l: 298, r: innerWidth - 296, t: 100, b: innerHeight - 158 };
  return { l: 306, r: innerWidth - 330, t: 108, b: innerHeight - 162 };
}

function updateLabels(force = false) {
  if (!vehicle) return;
  const svg = $('#leaderLayer');
  svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  if (!state.labels) {
    labelRecords.forEach((r) => { r.el.classList.add('is-hidden'); r.path.setAttribute('d', ''); r.dot.setAttribute('opacity', '0'); });
    return;
  }
  const now = performance.now();
  if (!force && now - lastLabelUpdate < 92) return;
  lastLabelUpdate = now;
  const latest = new Map(vehicle.getAnchors().map((a) => [a.moduleId, a]));
  const exterior = ['lights', 'wheels', 'shell'];
  const internal = ['interior'];
  const underView = state.view === 'under' || state.view === 'underbody' || camera.position.y < 0.12;
  let ids;
  if (underView) ids = ['wheels', 'shell', 'interior'];
  else if (state.xray) ids = ['interior', 'wheels', 'shell', 'lights'];
  else ids = state.explode > 0.2 ? ['shell', 'wheels', 'interior', 'lights'] : exterior;
  if (state.selected && !ids.includes(state.selected)) ids.unshift(state.selected);
  ids = [...new Set(ids)].slice(0, 6);
  const safe = labelSafeRect();
  const cameraDir = camera.getWorldDirection(new THREE.Vector3());
  const candidates = [];
  for (const record of labelRecords) {
    const anchor = latest.get(record.moduleId) || record.anchor;
    const el = record.el;
    const shouldShow = ids.includes(record.moduleId);
    if (!shouldShow) {
      el.classList.add('is-hidden'); record.path.setAttribute('d', ''); record.dot.setAttribute('opacity', '0'); continue;
    }
    const toAnchor = anchor.position.clone().sub(camera.position);
    const facing = camera.position.clone().sub(anchor.position).normalize().dot(anchor.normal);
    if (toAnchor.dot(cameraDir) <= 0.05 || facing < 0.065) {
      el.classList.add('is-hidden'); record.path.setAttribute('d', ''); record.dot.setAttribute('opacity', '0'); continue;
    }
    const proj = anchor.position.clone().project(camera);
    if (proj.z < -1 || proj.z > 1) {
      el.classList.add('is-hidden'); record.path.setAttribute('d', ''); record.dot.setAttribute('opacity', '0'); continue;
    }
    const ax = (proj.x * 0.5 + 0.5) * innerWidth;
    const ay = (-proj.y * 0.5 + 0.5) * innerHeight;
    if (ax < -40 || ax > innerWidth + 40 || ay < -40 || ay > innerHeight + 40) {
      el.classList.add('is-hidden'); record.path.setAttribute('d', ''); record.dot.setAttribute('opacity', '0'); continue;
    }
    el.classList.remove('is-hidden');
    const w = el.offsetWidth || 132;
    const h = el.offsetHeight || 36;
    const dir = ax < innerWidth * 0.54 ? 1 : -1;
    let x = dir > 0 ? ax + 62 : ax - 62 - w;
    let y = ay - h / 2;
    x = clamp(x, safe.l, Math.max(safe.l, safe.r - w));
    y = clamp(y, safe.t, Math.max(safe.t, safe.b - h));
    candidates.push({ ...record, ax, ay, w, h, dir, x, y, preferredY: y });
  }
  candidates.sort((a, b) => a.ay - b.ay);
  const placed = [];
  for (const c of candidates) {
    let accepted = null;
    const gap = 8;
    const shifts = [0, c.h + gap, -(c.h + gap), (c.h + gap) * 2, -(c.h + gap) * 2, (c.h + gap) * 3, -(c.h + gap) * 3];
    for (const dy of shifts) {
      const y = clamp(c.preferredY + dy, safe.t, safe.b - c.h);
      const rect = { l: c.x, r: c.x + c.w, t: y, b: y + c.h };
      const clash = placed.some((p) => !(rect.r + 5 < p.l || rect.l - 5 > p.r || rect.b + 5 < p.t || rect.t - 5 > p.b));
      if (!clash) { accepted = { ...c, y, ...rect }; break; }
    }
    if (accepted) placed.push(accepted);
    else c.el.classList.add('is-hidden');
  }
  const acceptedIds = new Set(placed.map((p) => p.moduleId));
  for (const c of candidates) if (!acceptedIds.has(c.moduleId)) c.el.classList.add('is-hidden');
  for (const c of placed) {
    c.el.style.transform = `translate3d(${Math.round(c.x)}px,${Math.round(c.y)}px,0)`;
    c.el.classList.remove('is-hidden');
    const sideX = c.x > c.ax ? c.x : c.x + c.w;
    const sideY = clamp(c.ay, c.y + 5, c.y + c.h - 5);
    const elbowX = c.ax + c.dir * Math.min(34, Math.max(18, Math.abs(c.x - c.ax) * 0.35));
    c.path.setAttribute('d', `M ${c.ax.toFixed(1)} ${c.ay.toFixed(1)} L ${elbowX.toFixed(1)} ${c.ay.toFixed(1)} L ${sideX.toFixed(1)} ${sideY.toFixed(1)}`);
    c.path.setAttribute('opacity', state.selected === c.moduleId ? '0.95' : '0.6');
    c.dot.setAttribute('cx', c.ax.toFixed(1)); c.dot.setAttribute('cy', c.ay.toFixed(1));
    c.dot.setAttribute('opacity', state.selected === c.moduleId ? '1' : '0.7');
    c.el.classList.toggle('is-active', state.selected === c.moduleId);
  }
  for (const r of labelRecords) {
    if (!acceptedIds.has(r.moduleId)) {
      r.path.setAttribute('d', ''); r.dot.setAttribute('opacity', '0');
    }
  }
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (camTween) {
    const t = clamp((now - camTween.start) / camTween.duration, 0, 1);
    const e = smooth(t);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
    if (t >= 1) { const cb = camTween.onDone; camTween = null; cb?.(); }
  }
  tickExplosion(dt);
  controls.update();
  const camDist = camera.position.distanceTo(controls.target);
  scene.fog.near = Math.max(18, camDist + 3);
  scene.fog.far = scene.fog.near + 18;
  const below = camera.position.y < 0.06;
  if (state.ground) {
    shadowCatcher.visible = !below;
    contact.visible = !below;
    grid.visible = !below;
    surveyRing.visible = !below;
    floorGlow.visible = !below;
  }
  renderer.render(scene, camera);
  if (now - lastLabelUpdate > 90) updateLabels();
}
requestAnimationFrame(animate);

function onResize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.45 : 1.8));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  $('#leaderLayer').setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  updateLabels(true);
}

// ---------------------------------------------------------------------------
// Boot / initialization
// ---------------------------------------------------------------------------
function setBootProgress(p) {
  bootBar.style.width = `${p * 100}%`;
  bootNum.textContent = String(Math.round(p * 100)).padStart(2, '0');
}

async function init() {
  setBootProgress(0.08);
  await new Promise((r) => setTimeout(r, 60));
  setBootProgress(0.24);
  if (state.screenshotMode) {
    $$('.topbar,.parts-panel,.spec-panel,.inspector,.bottom-dock,.interaction-hint,.axis-readout,.mobile-view-strip,.scene-grain').forEach((el) => el.style.visibility = 'hidden');
    document.body.style.cursor = 'none';
  }
  vehicle = await loadRav4Model({ onProgress: (p) => setBootProgress(0.24 + p * 0.42) });
  setBootProgress(0.72);
  scene.add(vehicle.root);
  allMeshes = [];
  vehicle.root.traverse((o) => { if (o.isMesh) allMeshes.push(o); });
  vehicle.setExplosion(0);
  buildPartList();
  buildLabels();
  bindUI();
  setBootProgress(0.84);
  const requestedView = VIEWS[params.get('view')] ? params.get('view') : 'hero';
  setView(requestedView, true);
  if (params.has('explode')) setExplosion(clamp(Number(params.get('explode')), 0, 1), { animate: false });
  else setExplosion(0, { animate: false });
  if (params.get('xray') === '1') setXray(true, false);
  if (params.get('labels') === '0') {
    state.labels = false;
    $('[data-action="labels"]').classList.remove('is-on');
    $('[data-action="labels"]').setAttribute('aria-pressed', 'false');
  }
  if (params.get('ground') === '0') setGround(false);
  updateExplosionUI(state.explode);
  applyVisualState();
  updateLabels(true);
  setBootProgress(1);
  await new Promise((r) => setTimeout(r, 300));
  boot.classList.add('is-done');
  state.booted = true;
  setTimeout(() => { if (!state.selected) toast(isMobile ? '单指旋转 · 双指缩放 / 平移' : '点击部件查看说明 · 拖动旋转 · 滚轮缩放', 2600); }, 650);
  window.rav4Debug = {
    setExplosion: (v, opts = { animate: false }) => setExplosion(v, opts),
    setView: (v, instant = true) => setView(v, instant),
    setXray: (v) => setXray(v, false),
    select: (id, focus = false) => setSelected(id, { focus }),
    renderNow: () => renderer.render(scene, camera),
    camera, controls, vehicle, state, renderer, scene
  };
}

init().catch((err) => {
  window.__rav4Error = err;
  console.error(err);
  bootNum.textContent = 'ERR';
  bootBar.style.background = '#f16c43';
  bootBar.style.width = '100%';
  const p = boot.querySelector('.boot-copy p');
  if (p) {
    p.textContent = '初始化失败: ' + (err && (err.stack || err.message) ? (err.stack || err.message) : String(err));
    p.style.whiteSpace = 'pre-wrap';
    p.style.fontSize = '8px';
    p.style.maxWidth = '600px';
  }
});










