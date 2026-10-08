import * as THREE from 'three';
import { AREAS, LOGO } from './data.js';
import { createWorkshop } from './workshops.js';

// All meshes are authored here. Repeated architectural pieces share instanced draws.
const palette = {
  white: '#f6f5ef', roof: '#e4e6e1', trim: '#c1c8c5', red: '#f4372b', darkRed: '#ba2a24',
  glass: '#536d72', glassLight: '#91b0af', dark: '#344347', asphalt: '#687371', concrete: '#cdd2ca',
  ground: '#e5e5d9', grass: '#98ac85', grassLight: '#b4c29d', leaf: '#527e62', leafLight: '#779567',
  bark: '#827767', yellow: '#eac05b', steel: '#8a9894', tire: '#333b3b', cream: '#d9c7a4', blue: '#8b9b9c',
};

export function createFactory(scene) {
  const materials = Object.fromEntries(Object.entries(palette).map(([key, color]) => [key, new THREE.MeshStandardMaterial({ color, roughness: .82, metalness: key === 'steel' ? .35 : .05 })]));
  materials.spark = new THREE.MeshBasicMaterial({ color: '#ffd28b', toneMapped: false });
  materials.mist = new THREE.MeshBasicMaterial({ color: '#f85f50', transparent: true, opacity: .26, depthWrite: false, toneMapped: false });
  materials.scan = new THREE.MeshBasicMaterial({ color: '#28b87c', toneMapped: false });
  materials.scanSheet = new THREE.MeshBasicMaterial({ color: '#84dbb5', transparent: true, opacity: .18, depthWrite: false });
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
    cone: new THREE.ConeGeometry(1, 1, 7),
    sphere: new THREE.IcosahedronGeometry(1, 0),
  };
  const extraGeometries = [], extraMaterials = [], textures = [];
  const root = new THREE.Group(); scene.add(root);
  const roofs = new Map(), targets = [], movers = [], workshops = [], labels = [];
  let seed = 4817;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

  function batch(parent) {
    const groups = new Map();
    const dummy = new THREE.Object3D();
    function add(shape, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
      const key = `${shape}:${color}`;
      if (!groups.has(key)) groups.set(key, { shape, color, matrices: [] });
      dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
      groups.get(key).matrices.push(dummy.matrix.clone());
    }
    return {
      box: (c, x, y, z, w, h, d, ry = 0) => add('box', c, x, y, z, w, h, d, 0, ry),
      cylinder: (c, x, y, z, r, h, rx = 0, rz = 0) => add('cylinder', c, x, y, z, r, h, r, rx, 0, rz),
      cone: (c, x, y, z, r, h) => add('cone', c, x, y, z, r, h, r),
      sphere: (c, x, y, z, r, sy = 1) => add('sphere', c, x, y, z, r, r * sy, r),
      finish: () => {
        for (const { shape, color, matrices } of groups.values()) {
          const mesh = new THREE.InstancedMesh(geometries[shape], materials[color], matrices.length);
          matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
          mesh.castShadow = !['asphalt', 'grass', 'ground', 'spark', 'mist', 'scan'].includes(color); mesh.receiveShadow = !['spark', 'mist', 'scan'].includes(color);
          mesh.computeBoundingSphere(); parent.add(mesh);
        }
      },
    };
  }
  function textPlane(text, width, height, color = '#52625c', bg = '#f5f5ef') {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 192;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, 1024, 192);
    ctx.fillStyle = color; ctx.font = 'bold 85px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 512, 98, 940);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .9 }); extraMaterials.push(material);
    const geometry = new THREE.PlaneGeometry(width, height); extraGeometries.push(geometry);
    return new THREE.Mesh(geometry, material);
  }
  function car(parent, color = 'red', complete = true) {
    const group = new THREE.Group(); parent.add(group); const b = batch(group);
    b.box(color, 0, .78, 0, 1.85, .65, 4.1); b.box(color, 0, .64, 0, 1.95, .2, 4.2);
    if (complete) {
      b.box('glass', 0, 1.25, -.25, 1.55, .63, 2.08);
      b.box(color, 0, 1.6, -.3, 1.57, .12, 1.65);
    } else {
      for (const x of [-.72, .72]) {
        b.box(color, x, 1.6, -.3, .12, .12, 1.9);
        for (const z of [-1.15, .55]) b.box(color, x, 1.25, z, .12, .7, .12);
      }
      for (const z of [-1.15, .55]) b.box(color, 0, 1.6, z, 1.5, .12, .12);
    }
    b.box('dark', 0, .6, 2.1, 1.55, .2, .08);
    for (const side of [-1, 1]) {
      b.box('white', side * .62, .89, 2.09, .45, .18, .1);
      b.box('darkRed', side * .66, .88, -2.09, .43, .16, .1);
      if (complete) for (const z of [-1.3, 1.25]) {
        b.cylinder('tire', side * .95, .46, z, .4, .21, 0, Math.PI / 2);
        b.cylinder('steel', side * 1.07, .46, z, .21, .03, 0, Math.PI / 2);
      }
      b.box(color, side * .81, 1.25, -.35, .12, .72, .12);
    }
    b.finish(); return group;
  }
  function truck(parent, color = 'red') {
    const group = new THREE.Group(); parent.add(group); const b = batch(group);
    b.box('dark', 0, .8, 0, 2.5, .4, 9.8); b.box(color, 0, 2.2, 3.2, 2.65, 2.6, 2.6);
    b.box('glass', 0, 2.7, 4.53, 2.3, .9, .06); b.box('white', 0, 2.8, -1.5, 2.8, 3.6, 6.8);
    b.box('red', 0, 3, -4.93, 2.8, .45, .05);
    for (const side of [-1, 1]) for (const z of [-3.5, -2.3, 3.3]) b.cylinder('tire', side * 1.25, .7, z, .62, .35, 0, Math.PI / 2);
    b.finish(); return group;
  }
  const land = batch(root);
  land.box('ground', 0, -1, 1, 186, 2, 146);
  land.box('grassLight', 0, .02, 1, 181, .12, 141);
  land.box('concrete', 0, .13, -8, 157, .12, 99);
  // Perimeter loop, central street and connecting roads.
  for (const z of [-57, -7, 36, 60]) land.box('asphalt', 0, .25, z, 167, .13, 7);
  for (const x of [-80, 76]) land.box('asphalt', x, .26, 1.5, 7, .13, 124);
  land.box('asphalt', 60, .26, 15, 6, .13, 44);
  for (const z of [-57, -7, 36, 60]) for (let x = -74; x < 77; x += 7) land.box('white', x, .335, z, 2.7, .025, .16);
  for (const x of [-80, 76]) for (let z = -53; z < 59; z += 7) land.box('white', x, .34, z, .16, .025, 2.7);
  for (const z of [-52, -12, -2, 31, 41, 55]) land.box('white', 0, .3, z, 154, .24, .45);
  // Pedestrian crossings and a central landscaped strip.
  for (const x of [-32, 9, 59]) for (let z = -9.5; z <= -4.5; z += 1.05) land.box('white', x, .35, z, 3, .025, .5);
  for (const x of [-33, 10]) {
    land.box('grass', x, .32, -32, 3.2, .2, 28);
    for (let z = -43; z < -20; z += 5) {
      land.cylinder('bark', x, 1.3, z, .19, 2); land.sphere('leaf', x, 3.25, z, 1.3, 1.5);
    }
  }
  // Finished vehicle yard.
  land.box('concrete', 22, .3, 48, 77, .15, 15);
  for (let x = -11; x < 59; x += 3.3) for (const z of [44, 51.5]) {
    land.box('white', x - 1.4, .4, z, .09, .025, 5.1);
    const c = car(root, ['white', 'white', 'red', 'blue', 'dark'][Math.floor(random() * 5)]);
    c.position.set(x, .4, z); c.rotation.y = z === 44 ? Math.PI : 0;
  }
  // Office, visitor parking and utility building.
  land.box('white', -53, 3.5, 47, 28, 6.5, 11);
  land.box('red', -53, 6.85, 47, 29, .45, 12);
  land.box('glass', -53, 3.9, 52.56, 25, 3.1, .12);
  for (let x = -65; x <= -40; x += 2.5) land.box('white', x, 3.9, 52.7, .16, 3.4, .2);
  land.box('dark', -53, 1.8, 52.7, 3.4, 3, .15);
  land.box('white', -53, 3.6, 54.2, 7, .25, 3.3);
  land.box('white', 65, 3, 48, 12, 5.6, 10); land.box('red', 65, 5.9, 48, 12.5, .6, 10.5);
  for (const x of [62, 66, 70]) land.cylinder('steel', x, 7.7, 48, .7, 4);
  // White/red entrance, security cabin and barriers.
  land.box('asphalt', -54, .27, 67, 17, .12, 13);
  land.box('white', -65, 2.1, 65.5, 5, 4, 5); land.box('glass', -65, 2.8, 68.05, 4.4, 1.6, .1);
  land.box('red', -65, 4.3, 65.5, 5.7, .4, 5.7);
  for (const x of [-61, -44]) land.box('red', x, 5, 67, .8, 10, .8);
  land.box('white', -52.5, 9.7, 67, 18, 1.5, 1);
  for (const x of [-58, -49]) {
    land.box('steel', x, 1.1, 64, .4, 2, .4); land.box('red', x + 2, 2, 64, 4.8, .16, .2);
    for (let j = 0; j < 4; j++) land.box('white', x + j + .3, 2.01, 64, .4, .17, .22);
  }
  const gateTitle = textPlane('ALLUR  /  AUTOMOTIVE', 14, 1.1, '#ed362c'); gateTitle.position.set(-52.5, 9.7, 67.51); root.add(gateTitle);
  // Fence, lamps and landscaping.
  for (let x = -87; x <= 87; x += 5) {
    for (const z of [-66, 69]) {
      if (z === 69 && x > -64 && x < -39) continue;
      land.box('steel', x, 1.6, z, .17, 2.8, .17); land.box('steel', x + 2.4, 2.5, z, 4.8, .1, .1); land.box('steel', x + 2.4, .9, z, 4.8, .1, .1);
    }
  }
  for (let z = -64; z <= 65; z += 5) for (const x of [-88, 88]) {
    land.box('steel', x, 1.6, z, .17, 2.8, .17); land.box('steel', x, 2.5, z + 2.4, .1, .1, 4.8); land.box('steel', x, .9, z + 2.4, .1, .1, 4.8);
  }
  for (let x = -71; x < 77; x += 19) for (const z of [-51, 40]) {
    land.cylinder('steel', x, 4.2, z, .12, 8); land.box('steel', x, 8.1, z - .6, .15, .15, 1.4); land.box('white', x, 8, z - 1.2, .65, .15, 1.1);
  }
  for (let i = 0; i < 125; i++) {
    let x, z;
    if (i < 65) { x = -87 + random() * 173; z = -63 + random() * 3; }
    else { x = (i % 2 ? -1 : 1) * (84 + random() * 2.5); z = -58 + random() * 122; }
    const h = 3.5 + random() * 2.7, r = 1.1 + random() * .55;
    land.cylinder('bark', x, .9, z, .18, 1.8);
    land.cone(i % 3 ? 'leaf' : 'leafLight', x, h * .5 + 1, z, r, h * .8);
    land.cone(i % 3 ? 'leaf' : 'leafLight', x, h * .8 + .6, z, r * .72, h * .65);
  }
  for (let x = -29; x <= -19; x += 4) { land.cylinder('steel', x, 5, 48, .1, 10); land.box('red', x + 1, 8.6, 48, 2.2, 2.3, .08); }
  land.finish();

  const loader = new THREE.TextureLoader();
  const logo = loader.load(LOGO); logo.colorSpace = THREE.SRGBColorSpace; textures.push(logo);
  const logoMaterial = new THREE.MeshStandardMaterial({ map: logo, roughness: .9 }); extraMaterials.push(logoMaterial);
  function logoPlane(parent, x, y, z, w, h) {
    const geom = new THREE.PlaneGeometry(w, h); extraGeometries.push(geom);
    const mesh = new THREE.Mesh(geom, logoMaterial); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  logoPlane(root, -53, 5.8, 52.77, 9, 4.4);

  for (const area of AREAS) {
    const group = new THREE.Group(); group.position.set(area.x, 0, area.z); root.add(group);
    const structure = batch(group), { w, d, h } = area;
    structure.box('white', 0, .48, 0, w + 2, .7, d + 2);
    structure.box('concrete', 0, .85, 0, w, .12, d);
    structure.box('red', 0, 1.45, -d / 2, w, 1.2, .4);
    for (const x of [-w / 2, w / 2]) structure.box('white', x, 1.5, 0, .4, 1.5, d);
    for (let x = -w / 2 + 1; x < w / 2; x += 6) for (const z of [-d / 2 + .3, d / 2 - .3]) structure.box('white', x, h / 2, z, .5, h, .5);
    const roof = new THREE.Group(); group.add(roof); roofs.set(area.id, roof); const exterior = batch(roof);
    exterior.box('white', 0, h / 2 + .5, -d / 2, w, h - 1, .45);
    for (const x of [-w / 2, w / 2]) exterior.box('white', x, h / 2 + .5, 0, .5, h - 1, d);
    exterior.box('white', 0, h - 1.5, d / 2, w, 3, .45);
    exterior.box('red', 0, h - .2, d / 2 + .25, w + .7, 1.45, .35);
    for (const x of [-w / 2 - .28, w / 2 + .28]) exterior.box('red', x, h - .2, 0, .35, 1.45, d + .8);
    exterior.box('roof', 0, h + .65, 0, w + 1.2, .6, d + 1.2);
    // Front facade: alternating bays and vertical red frames.
    for (let x = -w / 2 + 2.6; x < w / 2 - 1; x += 5.2) {
      exterior.box('glass', x, h - 2.5, d / 2 + .3, 4.4, 1.8, .12);
      exterior.box('white', x, h - 2.5, d / 2 + .38, .11, 1.8, .05);
      structure.box('red', x - 2.5, 3.25, d / 2, .36, 5, .55);
      structure.box(area.id === 'supply' ? 'dark' : 'glassLight', x, 3.25, d / 2, 4.1, 4.5, .16);
      for (let y = 1.5; y < 5.5; y += .7) structure.box('trim', x, y, d / 2 + .11, 4.1, .065, .08);
      if (area.id === 'supply') {
        structure.box('dark', x, .7, d / 2 + 2.1, 4.4, .6, 3.7);
        structure.box('yellow', x - 2, .95, d / 2 + 3.8, .3, .2, .3);
      }
    }
    for (let z = -d / 2 + 2; z < d / 2 - 1; z += 2) {
      for (const x of [-w / 2 - .28, w / 2 + .28]) exterior.box('trim', x, h / 2, z, .08, h - 1.7, .09);
    }
    // Skylights, standing-seam roof, HVAC units and exhaust ducts.
    for (let x = -w / 2 + 2; x < w / 2; x += 2.1) exterior.box('trim', x, h + 1, 0, .06, .1, d - 1);
    for (const z of [-5, 3]) for (let x = -w / 2 + 5; x < w / 2 - 2; x += 8) {
      exterior.box('white', x, h + 1.2, z, 5.9, .45, 2.6);
      exterior.box('glassLight', x, h + 1.46, z, 5.3, .08, 2.2);
      for (let j = -2; j <= 2; j++) exterior.box('white', x + j, h + 1.53, z, .08, .05, 2.3);
    }
    for (let x = -w / 2 + 4; x < w / 2 - 1; x += 7) {
      exterior.box('steel', x, h + 1.7, -d / 2 + 3, 3, 1.5, 2.2);
      exterior.cylinder('dark', x, h + 2.5, -d / 2 + 3, .73, .15);
      exterior.cylinder('trim', x, h + 2.59, -d / 2 + 3, .35, .15);
    }
    if (area.id === 'paint') for (const x of [-9, -3, 3, 9]) {
      exterior.cylinder('white', x, h + 3, 8, .65, 5);
      exterior.cylinder('red', x, h + 5, 8, .69, .65);
      exterior.cylinder('steel', x, h + 5.6, 8, .85, .25);
    }
    const sign = textPlane(`${area.n}  /  ${area.short.toUpperCase()}`, Math.min(w - 3, 19), 2.1, '#fff', '#f4372b');
    sign.position.set(0, h - .15, d / 2 + .46); roof.add(sign);
    if (area.id === 'assembly') logoPlane(roof, 0, h + 2.5, d / 2 + .5, 12, 5.9);
    const workshop = createWorkshop({ area, parent: group, batch, car, textPlane, materials, geometries });
    workshop.group.visible = false; workshops.push({ ...workshop, area: area.id });
    structure.finish(); exterior.finish();
    const hitGeometry = new THREE.BoxGeometry(w, h + 1, d); extraGeometries.push(hitGeometry);
    const hitMaterial = new THREE.MeshBasicMaterial({ visible: false }); extraMaterials.push(hitMaterial);
    const hit = new THREE.Mesh(hitGeometry, hitMaterial); hit.position.set(0, (h + 1) / 2, 0); hit.userData.areaId = area.id; group.add(hit); targets.push(hit);
    labels.push({ id: area.id, position: new THREE.Vector3(area.x, h + 4, area.z + 1) });
  }
  // Loading trucks and a slow logistics loop.
  for (const x of [-63, -53, -43]) { const t = truck(root); t.position.set(x, .4, -14); t.rotation.y = Math.PI; }
  for (let i = 0; i < 3; i++) {
    const object = i === 0 ? truck(root) : car(root, i === 1 ? 'red' : 'white');
    movers.push({ kind: 'road', object, offset: i * 123 });
  }
  const selectionBox = new THREE.BoxGeometry(1, .1, 1);
  const selectionGeometry = new THREE.EdgesGeometry(selectionBox); selectionBox.dispose(); extraGeometries.push(selectionGeometry);
  const selectionMaterial = new THREE.LineBasicMaterial({ color: '#ff3426', linewidth: 2 }); extraMaterials.push(selectionMaterial);
  const selection = new THREE.LineSegments(selectionGeometry, selectionMaterial); selection.visible = false; root.add(selection);
  const loop = [new THREE.Vector3(-80, .4, 60), new THREE.Vector3(76, .4, 60), new THREE.Vector3(76, .4, -57), new THREE.Vector3(-80, .4, -57)];
  const lengths = loop.map((p, i) => p.distanceTo(loop[(i + 1) % 4])); const total = lengths.reduce((a, b) => a + b, 0);
  return {
    root, targets, labels,
    select(id, interior) {
      for (const [key, roof] of roofs) roof.visible = !(interior && (!id || key === id));
      for (const workshop of workshops) workshop.group.visible = interior && (!id || workshop.area === id);
      const area = AREAS.find(a => a.id === id); selection.visible = !!area;
      if (area) { selection.position.set(area.x, .94, area.z); selection.scale.set(area.w + 3, 1, area.d + 3); }
    },
    animate(seconds, areaTimes = null) {
      for (const m of movers) {
        {
          let distance = (seconds * 2.8 + m.offset) % total, k = 0;
          while (distance > lengths[k] && k < 3) { distance -= lengths[k]; k++; }
          const a = loop[k], b = loop[(k + 1) % 4]; m.object.position.lerpVectors(a, b, distance / lengths[k]); m.object.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
        }
      }
      for (const workshop of workshops) if (workshop.group.visible) workshop.animate(areaTimes?.[workshop.area] ?? seconds);
    },
    dispose() {
      root.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
      for (const geometry of [...Object.values(geometries), ...extraGeometries]) geometry.dispose();
      for (const material of [...Object.values(materials), ...extraMaterials]) material.dispose();
      textures.forEach(texture => texture.dispose()); root.removeFromParent();
    },
  };
}
