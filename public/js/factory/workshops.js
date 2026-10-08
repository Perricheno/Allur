import * as THREE from 'three';
import { operationAt } from './operations.js';
import { createAssembly } from './assembly.js';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const ramp = (phase, from, to) => smooth((phase - from) / (to - from));

export function createWorkshop({ area, parent, batch, car, textPlane, materials, geometries }) {
  const group = new THREE.Group(); group.name = `workshop-${area.id}`; parent.add(group);
  const b = batch(group), updates = [];
  function sub(parent = group) { const g = new THREE.Group(); parent.add(g); return g; }
  function label(text, x, z, width = 6) {
    const sign = textPlane(text, width, .85, '#ffffff', '#b22e26');
    sign.position.set(x, 4.5, z); group.add(sign);
    b.box('steel', x - width / 2, 2.8, z, .09, 3.8, .09);
  }
  function pallet(parent, x = 0, y = 0, z = 0) {
    const g = sub(parent); g.position.set(x, y, z); const p = batch(g);
    for (const dx of [-.75, 0, .75]) p.box('bark', dx, .12, 0, .17, .24, 1.65);
    for (let dz = -.7; dz <= .7; dz += .35) p.box('cream', 0, .31, dz, 1.9, .14, .25);
    p.box('cream', 0, .92, 0, 1.7, 1.08, 1.45);
    for (const dx of [-.45, .45]) p.box('white', dx, .94, 0, .07, 1.13, 1.5);
    p.box('white', 0, 1, .73, .55, .4, .02); p.finish(); return g;
  }
  function worker(x, z, angle = 0) {
    const g = sub(); g.position.set(x, .95, z); g.rotation.y = angle; const p = batch(g);
    for (const dx of [-.18, .18]) { p.box('dark', dx, .48, 0, .25, .9, .3); p.box('dark', dx, .1, .1, .3, .19, .52); }
    p.box('red', 0, 1.2, 0, .78, .8, .42); p.box('yellow', 0, 1.3, .23, .79, .1, .04);
    p.sphere('cream', 0, 1.92, 0, .26, 1.1); p.sphere('white', 0, 2.1, 0, .32, .6);
    p.box('white', 0, 2.05, .14, .64, .07, .55); p.finish();
    const arm = sub(g); arm.position.set(.46, 1.47, 0); const ab = batch(arm);
    ab.box('red', 0, -.25, 0, .23, .55, .25); ab.box('cream', 0, -.48, .2, .2, .2, .53); ab.finish();
    updates.push((p, t) => { arm.rotation.x = -.45 + Math.sin(t * 1.8 + x) * .22; }); return g;
  }
  function desk(x, z) {
    b.box('white', x, 1.75, z, 2.7, 1.6, 1.1); b.box('red', x, 2.61, z, 2.9, .15, 1.2);
    b.box('dark', x, 3.1, z, 1.1, .8, .12); b.box('glassLight', x, 3.12, z + .08, .9, .55, .025);
    b.box('dark', x, 2.76, z + .3, .8, .08, .3);
  }
  function conveyor(length, z = 0) {
    b.box('dark', 0, 1.18, z, length, .4, 3.1);
    for (const side of [-1, 1]) b.box('yellow', 0, 1.4, z + side * 1.7, length, .13, .12);
    for (let x = -length / 2; x < length / 2; x += .65) b.cylinder('steel', x, 1.45, z, .14, 2.8, Math.PI / 2);
  }
  function fence(x, z, length) {
    for (let dx = -length / 2; dx <= length / 2; dx += 2) b.box('yellow', x + dx, 1.7, z, .12, 1.6, .12);
    for (const y of [1.15, 2.35]) b.box('yellow', x, y, z, length, .09, .09);
  }
  function robot(x, z, facing = 1) {
    const g = sub(); g.position.set(x, 1, z); g.rotation.y = facing < 0 ? Math.PI : 0;
    const base = batch(g); base.cylinder('dark', 0, .3, 0, .7, .6); base.cylinder('red', 0, .9, 0, .42, 1.2); base.finish();
    const shoulder = sub(g); shoulder.position.y = 1.35; const upper = batch(shoulder);
    upper.box('red', 0, .85, 0, .55, 1.7, .55); upper.cylinder('steel', 0, 1.65, 0, .38, .68, 0, Math.PI / 2); upper.finish();
    const elbow = sub(shoulder); elbow.position.y = 1.7; const forearm = batch(elbow);
    forearm.box('red', 0, 0, 1.05, .42, .42, 2.1); forearm.box('dark', 0, -.38, 2.05, .23, .8, .23); forearm.finish();
    const tip = sub(elbow); tip.position.set(0, -.78, 2.05);
    return { shoulder, elbow, tip };
  }
  // Shared shop-floor details: pedestrian aisle, cabinets, bins and wall pipes.
  const aisleZ = area.d / 2 - 3;
  b.box('grassLight', 0, .94, aisleZ, area.w - 2, .04, 2.1);
  for (const dz of [-1.1, 1.1]) b.box('white', 0, .98, aisleZ + dz, area.w - 2, .025, .12);
  for (const x of [-area.w / 2 + 2, area.w / 2 - 2]) {
    b.box('white', x, 2.25, -area.d / 2 + 1.3, 2.2, 2.6, 1.1);
    b.box('red', x, 2.25, -area.d / 2 + .72, 2.2, .4, .05);
    b.cylinder('red', x, 1.5, aisleZ - 2, .27, 1.1);
  }
  b.box('steel', 0, 6.4, -area.d / 2 + .7, area.w - 2, .17, .17);

  if (area.id === 'supply') {
    for (const z of [-8, -3.5]) for (const x of [-10, -4, 2, 8]) {
      for (const dx of [-2.4, 2.4]) b.box('red', x + dx, 3.4, z, .18, 5, 2);
      for (const y of [1.2, 3, 4.8]) {
        b.box('steel', x, y, z, 5, .18, 2);
        for (const dx of [-1.5, 0, 1.5]) { b.box('cream', x + dx, y + .65, z, 1.3, 1.1, 1.65); b.box('white', x + dx, y + .65, z + .84, .12, 1.1, .03); }
      }
    }
    label('СТЕЛЛАЖИ / КОМПЛЕКТУЮЩИЕ', -3, -9.5, 12);
    desk(11, 6); worker(11, 7.4, Math.PI); pallet(group, -11, .96, 5); pallet(group, -8.5, .96, 5);
    const destination = pallet(group, 7, .96, 3);
    const fork = sub(); const f = batch(fork);
    f.box('red', 0, .8, 0, 1.65, 1.2, 2.4); f.box('dark', 0, 1.65, -.5, .8, .65, .8);
    for (const x of [-.8, .8]) {
      for (const z of [-.8, .8]) f.cylinder('tire', x, .45, z, .4, .25, 0, Math.PI / 2);
      f.box('dark', x, 2.1, -.8, .1, 2.8, .1); f.box('steel', x, 2, 1.2, .15, 3.3, .17);
    }
    f.box('red', 0, 3.5, -.1, 1.9, .16, 1.9); f.sphere('white', 0, 2.45, -.4, .25);
    f.box('red', 0, 1.9, -.4, .6, .7, .5); f.finish();
    const lift = sub(fork); const lf = batch(lift);
    for (const x of [-.55, .55]) lf.box('steel', x, 0, 1.85, .18, .13, 1.9); lf.finish();
    const load = pallet(lift, 0, .08, 1.85); fork.rotation.y = Math.PI / 2;
    updates.push(p => {
      const travel = p < .5 ? ramp(p, .16, .5) : 1 - ramp(p, .72, 1);
      fork.position.set(-8 + travel * 12, .95, 3);
      lift.position.y = .35 + .8 * (ramp(p, 0, .16) - ramp(p, .5, .67));
      load.visible = p < .67; destination.visible = p >= .67;
    });
  } else if (area.id === 'welding') {
    conveyor(29); label('ABB-01', -8, -6, 4); label('ABB-04', 5, -6, 4);
    for (const x of [-9, 0, 9]) {
      const body = car(group, 'steel', false); body.rotation.y = Math.PI / 2;
      updates.push((p, t) => {
        const advance = 9 * (Math.floor(t / 12) + ramp(p, 0, .25));
        body.position.set((x + 13.5 + advance) % 27 - 13.5, 1.6, 0);
      });
      for (const side of [-1, 1]) {
        const arm = robot(x, side * 3.8, -side);
        const sparks = sub(arm.tip); const sb = batch(sparks);
        sb.sphere('spark', 0, 0, 0, .12);
        for (let i = 0; i < 9; i++) { const angle = i * 2.4; sb.box('spark', Math.cos(angle) * .55, -.12 - i * .08, Math.sin(angle) * .55, .065, .24, .065); }
        sb.finish();
        updates.push((p, t) => {
          const working = p >= .35 && p < .82;
          const reach = ramp(p, .25, .35) * (1 - ramp(p, .82, 1));
          arm.shoulder.rotation.x = .3 * reach; arm.elbow.rotation.x = -.2 + .32 * reach + (working ? Math.sin(t * 2) * .09 : 0);
          sparks.visible = working; sparks.rotation.y = t * 5; sparks.scale.setScalar(.8 + Math.sin(t * 9) * .2);
        });
      }
      for (const side of [-1, 1]) b.box('steel', x, 1.75, side * 1.25, 2.6, .5, .15);
    }
    fence(0, -7.4, 27); desk(13, 5.5); worker(12, 7, Math.PI); worker(-12, 7, -.4);
    for (const x of [-11, 1, 11]) b.box('dark', x, 1.6, -9.6, 3, 1.3, 1.5);
  } else if (area.id === 'paint') {
    conveyor(29); label('КАМЕРА-02 / ОКРАСКА', 0, -6, 10);
    for (const z of [-3, 3]) {
      b.box('white', 0, z < 0 ? 2.8 : 1.35, z, 9, z < 0 ? 3.8 : .9, .25);
      for (const x of [-4.7, 4.7]) b.box('red', x, 3.4, z, .3, 5, .3);
      b.box('white', 0, 5.9, z, 9.8, .35, .4);
      if (z < 0) for (const x of [-3, 0, 3]) b.box('glassLight', x, 3.3, z + .15, 2.3, 1.5, .08);
    }
    for (const x of [-4.7, 4.7]) b.box('white', x, 5.9, 0, .3, .3, 6);
    const raw = car(group, 'steel', false), painted = car(group, 'red', false);
    raw.rotation.y = painted.rotation.y = Math.PI / 2;
    for (const side of [-1, 1]) {
      const arm = robot(0, side * 4.2, -side), mist = sub(arm.tip), mb = batch(mist);
      for (let i = 0; i < 16; i++) mb.sphere('mist', Math.sin(i * 2.4) * .65, -.2 - i * .06, Math.cos(i * 2.4) * .65, .22 + i * .018);
      mb.finish();
      updates.push((p, t) => { const spraying = p >= .22 && p < .64; mist.visible = spraying; arm.shoulder.rotation.x = .24; arm.elbow.rotation.y = spraying ? Math.sin(t * 1.8) * .35 : 0; mist.rotation.y = t; });
    }
    updates.push(p => {
      const x = -11 + 11 * ramp(p, 0, .22) + 11 * ramp(p, .78, 1);
      raw.position.set(x, 1.6, 0); painted.position.copy(raw.position); raw.visible = p < .64; painted.visible = p >= .64;
    });
    for (const x of [-10, -7, 7, 10]) { b.cylinder('white', x, 2, -8, .7, 2); b.cylinder('red', x, 2.4, -8, .72, .5); }
    desk(11, 6.5); worker(11, 8, Math.PI); fence(0, -9.7, 20);
  } else if (area.id === 'assembly') {
    const animateAssembly = createAssembly({ group, batch, textPlane, materials, geometries, worker, desk });
    updates.push((p, seconds) => animateAssembly(seconds));
  } else if (area.id === 'quality') {
    conveyor(18); label('РОЛИКОВЫЙ СТЕНД', 0, -7, 9);
    const vehicle = car(group, 'white'); vehicle.rotation.y = Math.PI / 2;
    for (const x of [-1.3, 1.25]) for (const dx of [-.4, .4]) b.cylinder('dark', x + dx, 1.53, 0, .26, 3.1, Math.PI / 2);
    for (const z of [-2.8, 2.8]) b.box('white', 0, 3.7, z, .5, 5.4, .5);
    b.box('red', 0, 6.5, 0, .7, .35, 6);
    const scanner = sub(); const sc = batch(scanner);
    for (const z of [-2.2, 2.2]) sc.box('scan', 0, 2.5, z, .16, 3.1, .16);
    sc.box('scan', 0, 4.05, 0, .16, .16, 4.5); sc.finish();
    const beam = new THREE.Mesh(geometries.box, materials.scanSheet); beam.scale.set(.025, 3.2, 4.3); beam.position.y = 2.5; scanner.add(beam);
    const pass = textPlane('OK', 1.8, 1, '#ffffff', '#377b59'); pass.position.set(0, 6.4, .4); group.add(pass);
    desk(7, 5); worker(7, 6.5, Math.PI); worker(-6, 3.5, Math.PI / 2);
    for (const x of [-7, 7]) { b.box('white', x, 1.7, -5, 2.5, 1.5, 1.3); b.box('dark', x, 2.6, -5, 2, .25, 1); }
    updates.push((p, t) => {
      vehicle.position.set(-7 * (1 - ramp(p, 0, .2)) + 7 * ramp(p, .8, 1), 1.6, 0);
      vehicle.rotation.z = p >= .2 && p < .48 ? Math.sin(t * 12) * .008 : 0;
      scanner.visible = p >= .48 && p < .8; scanner.position.x = -2.5 + ramp(p, .48, .8) * 5;
      pass.visible = p >= .8;
    });
  } else if (area.id === 'finished') {
    label('ПОГРУЗКА / АВТОВОЗ', 1, -6, 11);
    const carrier = batch(group);
    carrier.box('dark', 0, 1.6, -1, 17, .4, 3.2); carrier.box('white', 9.7, 2.4, -1, 3.3, 3, 3.1);
    carrier.box('red', 9.7, 3.9, -1, 3.5, .35, 3.2); carrier.box('glass', 11.4, 3.1, -1, .04, 1, 2.7);
    for (const z of [-2.5, .5]) {
      for (const x of [-6, 1, 6]) carrier.box('red', x, 3, z, .18, 3, .18);
      carrier.box('red', 0, 4.6, z, 16.5, .25, .22);
      for (const x of [-6.5, -4.8, 6.7, 9.8]) carrier.cylinder('tire', x, 1.1, z, .65, .35, Math.PI / 2);
    }
    carrier.box('steel', 0, 4.4, -1, 16, .2, 2.7); carrier.finish();
    for (const x of [-5.5, 0, 5.5]) { const c = car(group, x === 0 ? 'red' : 'white'); c.position.set(x, 4.5, -1); c.rotation.y = Math.PI / 2; }
    for (const z of [-2, 0]) {
      const rail = new THREE.Mesh(geometries.box, materials.steel); rail.scale.set(5.2, .15, .6); rail.position.set(-10.4, 1.4, z); rail.rotation.z = .18; rail.castShadow = true; group.add(rail);
    }
    const loading = car(group, 'red'); loading.rotation.order = 'YXZ'; loading.rotation.y = Math.PI / 2;
    worker(8, 4, -Math.PI / 2); desk(-8, 6); worker(-8, 7.5, Math.PI);
    for (const x of [-3, 0, 3]) { b.cone('red', x, 1.5, 5, .3, 1.1); b.box('white', x, 1.2, 5, .65, .15, .65); }
    updates.push(p => {
      const progress = ramp(p, .16, .75);
      loading.position.set(-13 + progress * 15, .95 + Math.min(1, progress * 3) * .95, -1);
      loading.rotation.x = p > .16 && progress < .34 ? -.14 : 0;
    });
  }
  b.finish();
  function animate(seconds) { const { phase } = operationAt(area.id, seconds); updates.forEach(update => update(phase, seconds)); }
  animate(0);
  return { group, animate };
}
