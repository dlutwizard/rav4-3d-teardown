import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = './assets/models/rav4-2010/source/Rav4.glb';
const TARGET_LENGTH = 4.63;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const MODULES = [
  {
    id: 'shell', name: '车身外壳', en: 'BODY SHELL',
    desc: '2012 款 RAV4 XA30 改款车身外覆件：白色珠光车漆、黑色未喷漆下包围与轮眉，保留侧开尾门和外挂全尺寸备胎。',
    meta: ['2012 XA30 改款', '4630 × 1855 × 1720 mm'], view: 'hero', offsetLabel: 'UP'
  },
  {
    id: 'glass', name: '全车玻璃', en: 'GLAZING',
    desc: '前风挡、四门车窗、后侧三角窗与侧开尾门玻璃。深色隔热玻璃带轻微环境反射，拆出后可观察座舱与车架。',
    meta: ['数量：8', '拆解：向上'], view: 'side', offsetLabel: 'UP'
  },
  {
    id: 'wheels', name: '车轮与制动', en: 'WHEELS & BRAKES',
    desc: '四条 225/65 R17 轮胎、17 英寸轮毂、前后通风制动盘与卡钳。拆解时四轮沿轮轴向外移出。',
    meta: ['225/65 R17', '拆解：轴向外'], view: 'side', offsetLabel: 'OUTWARD'
  },
  {
    id: 'interior', name: '座舱内饰', en: 'CABIN INTERIOR',
    desc: '左舵五座座舱：仪表台、方向盘、中控台、中央通道与前后排座椅。开启 X-RAY 或单独拆出后可见完整内饰。',
    meta: ['布局：左舵', '拆解：向上'], view: 'interior', offsetLabel: 'UP'
  },
  {
    id: 'lights', name: '灯组与前后面板', en: 'LAMPS & FASCIAS',
    desc: '2012 款改款前大灯、转向灯、尾灯、牌照板及前后保险杠细节。独立模块便于近距离查看灯腔和饰件。',
    meta: ['前 / 后灯组', '拆解：向上'], view: 'front', offsetLabel: 'UP'
  }
];

const classifyMesh = (mesh) => {
  const parentName = mesh.parent?.name || '';
  const materialName = String(mesh.material?.name || '').toLowerCase();
  if (materialName === 'car paint (grey)') return 'shell';
  if (parentName.startsWith('Wheel')) return 'wheels';
  if (materialName === 'glass.004' || materialName === 'glass fine' || materialName === 'r_glass') return 'glass';
  if (materialName === 'dash.001' || materialName === 'int.001') return 'interior';
  if (['head', 'siginal', 'signals', 'material', 'material.026', 'material.001', 'material.003'].includes(materialName)) return 'lights';
  return 'shell';
};

export async function loadRav4Model({ onProgress = () => {} } = {}) {
  onProgress(0.04);
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL, (event) => {
    if (event?.total) onProgress(clamp01(event.loaded / event.total) * 0.92);
  });

  const root = new THREE.Group();
  root.name = 'RAV4_XA30_2010_GLB';

  const source = gltf.scene;
  root.add(source);
  source.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(source);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const rawCenter = rawBox.getCenter(new THREE.Vector3());
  const scale = TARGET_LENGTH / Math.max(rawSize.z, 0.001);

  source.scale.setScalar(scale);
  source.position.set(-rawCenter.x * scale, -rawBox.min.y * scale, -rawCenter.z * scale);
  root.updateMatrixWorld(true);

  const moduleMeshes = new Map(MODULES.map((module) => [module.id, []]));
  const pickables = [];
  const exploders = [];
  const tempPosition = new THREE.Vector3();
  const tempQuaternion = new THREE.Quaternion();
  const tempScale = new THREE.Vector3();

  const explosionSpec = {
    shell: { offset: new THREE.Vector3(0, 0.92, 0), start: 0.08, duration: 0.72 },
    glass: { offset: new THREE.Vector3(0, 1.24, 0.08), start: 0.18, duration: 0.64 },
    interior: { offset: new THREE.Vector3(0, 0.46, -0.04), start: 0.14, duration: 0.58 },
    lights: { offset: new THREE.Vector3(0, 0.68, 0), start: 0.16, duration: 0.60 }
  };

  const allMeshes = [];
  source.traverse((object) => { if (object.isMesh) allMeshes.push(object); });

  for (const mesh of allMeshes) {
    const materialName = String(mesh.material?.name || '').toLowerCase();

    const moduleId = classifyMesh(mesh);
    const sourceMaterial = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = sourceMaterial.map((material) => {
      const name = String(material.name || '').toLowerCase();
      let copy;
      if (moduleId === 'shell' && name === 'car paint (grey)') {
        copy = new THREE.MeshPhysicalMaterial({
          color: 0xdde2de,
          metalness: 0.18,
          roughness: 0.38,
          clearcoat: 0.68,
          clearcoatRoughness: 0.07,
          envMapIntensity: 0.92,
          side: THREE.DoubleSide
        });
        copy.name = material.name;
      } else if (moduleId === 'shell' && name === 'black_m') {
        copy = material.clone();
        copy.color.setHex(0x0a0c0c);
        copy.metalness = 0.0;
        copy.roughness = 0.9;
        copy.envMapIntensity = 0.45;
        if ('clearcoat' in copy) copy.clearcoat = 0;
      } else {
        copy = material.clone();
        copy.envMapIntensity = moduleId === 'glass' ? 1.45 : 1.2;
      }
      if (moduleId === 'glass') {
        copy.transparent = true;
        copy.opacity = 0.26;
        copy.depthWrite = false;
        copy.side = THREE.DoubleSide;
        copy.roughness = 0.06;
        copy.metalness = 0.0;
        copy.transmission = 0;
        copy.thickness = 0;
        copy.color.set(0x223436);
        copy.envMapIntensity = 1.45;
      }
      copy.userData.baseOpacity = copy.opacity;
      copy.userData.baseTransparent = copy.transparent;
      copy.userData.baseDepthWrite = copy.depthWrite;
      return copy;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];

    mesh.castShadow = !mesh.material.transparent || moduleId === 'glass';
    mesh.receiveShadow = true;
    mesh.userData.moduleId = moduleId;
    mesh.userData.partName = mesh.material.name || mesh.name;
    mesh.userData.isShell = moduleId === 'shell' && materialName === 'car paint (grey)';
    if (moduleId === 'glass') mesh.renderOrder = 4;

    moduleMeshes.get(moduleId).push(mesh);
    pickables.push(mesh);

    const spec = explosionSpec[moduleId] || explosionSpec.shell;
    const worldOffset = spec.offset.clone();
    if (moduleId === 'wheels') {
      mesh.getWorldPosition(tempPosition);
      worldOffset.set(tempPosition.x < 0 ? -0.58 : 0.58, -0.02, 0);
    }

    const parent = mesh.parent;
    parent.getWorldQuaternion(tempQuaternion).invert();
    parent.getWorldScale(tempScale);
    const localOffset = worldOffset.applyQuaternion(tempQuaternion).divideScalar(tempScale.x || 1);

    exploders.push({
      node: mesh,
      basePos: mesh.position.clone(),
      offset: localOffset,
      start: spec.start,
      duration: spec.duration
    });
  }

  root.updateMatrixWorld(true);

  const anchorDefs = [];
  const anchorMeshes = {
    shell: moduleMeshes.get('shell').find((mesh) => mesh.userData.isShell) || moduleMeshes.get('shell')[0],
    glass: moduleMeshes.get('glass')[0],
    interior: moduleMeshes.get('interior')[0],
    lights: moduleMeshes.get('lights')[0],
    wheels: moduleMeshes.get('wheels').find((mesh) => {
      mesh.getWorldPosition(tempPosition);
      return tempPosition.x < 0 && tempPosition.z < 0;
    }) || moduleMeshes.get('wheels')[0]
  };

  const addAnchorWorld = (moduleId, worldPoint, normal, label, category, sub) => {
    const object = anchorMeshes[moduleId];
    if (!object) return;
    const local = object.worldToLocal(worldPoint.clone());
    anchorDefs.push({
      moduleId,
      object,
      local,
      normal: normal.clone().normalize(),
      label,
      category,
      sub
    });
  };

  addAnchorWorld('shell', new THREE.Vector3(0, 1.58, -0.10), new THREE.Vector3(0, 1, 0), '2012 车身外壳', 'exterior', 'XA30 FACELIFT');
  addAnchorWorld('glass', new THREE.Vector3(0, 1.38, 0.34), new THREE.Vector3(0, 0.55, 0.84), '前风挡 / 侧窗', 'exterior', 'GLAZING');
  addAnchorWorld('interior', new THREE.Vector3(0, 1.00, -0.18), new THREE.Vector3(0, 1, 0), '左舵五座座舱', 'internal', 'CABIN');
  addAnchorWorld('lights', new THREE.Vector3(0.66, 0.78, 2.14), new THREE.Vector3(0, 0.18, 1), '大灯 / 尾灯 / 牌照板', 'exterior', 'LAMPS');

  const wheelAnchorMesh = anchorMeshes.wheels;
  if (wheelAnchorMesh) {
    wheelAnchorMesh.updateWorldMatrix(true, false);
    const wheelBox = new THREE.Box3();
    wheelAnchorMesh.geometry.computeBoundingBox();
    wheelBox.copy(wheelAnchorMesh.geometry.boundingBox).applyMatrix4(wheelAnchorMesh.matrixWorld);
    const center = wheelBox.getCenter(new THREE.Vector3());
    addAnchorWorld('wheels', center, new THREE.Vector3(-1, 0, 0), '车轮 / 制动卡钳', 'exterior', '4 WHEELS');
  }

  const _position = new THREE.Vector3();
  const _normal = new THREE.Vector3();
  function getAnchors() {
    root.updateMatrixWorld(true);
    return anchorDefs.map((anchor, index) => {
      _position.copy(anchor.local);
      anchor.object.localToWorld(_position);
      _normal.copy(anchor.normal).transformDirection(anchor.object.matrixWorld).normalize();
      return {
        id: index,
        moduleId: anchor.moduleId,
        position: _position.clone(),
        normal: _normal.clone(),
        label: anchor.label,
        category: anchor.category,
        sub: anchor.sub
      };
    });
  }

  function setExplosion(progress) {
    const p = clamp01(progress);
    for (const exploder of exploders) {
      const t = clamp01((p - exploder.start) / exploder.duration);
      const eased = t * t * (3 - 2 * t);
      exploder.node.position.copy(exploder.basePos).addScaledVector(exploder.offset, eased);
    }
    root.updateMatrixWorld(true);
  }

  function moduleBounds(moduleId) {
    const box = new THREE.Box3();
    box.makeEmpty();
    for (const mesh of moduleMeshes.get(moduleId) || []) {
      if (!mesh.visible || !mesh.geometry) continue;
      mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.72, 0), new THREE.Vector3(1, 1, 1));
    return box;
  }

  root.updateMatrixWorld(true);
  onProgress(1);

  return {
    root,
    moduleMeshes,
    exploders,
    pickables,
    anchorDefs,
    getAnchors,
    setExplosion,
    moduleBounds,
    isGltf: true,
    sourceScale: scale,
    rawBox
  };
}



