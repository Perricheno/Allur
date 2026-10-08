import * as THREE from 'three';
import { ASSEMBLY_STEPS, assemblyAt, ease } from './assembly-state.js';

// Component groups stay attached to each individual vehicle for its full journey.
export function createAssembly({ group, batch, textPlane, materials, geometries, worker, desk }) {
  const b = batch(group), fixtures = [], cars = [];
  function child(parent, name) { const g = new THREE.Group(); g.name = name; parent.add(g); return g; }
  function progressiveCar(slot) {
    const g = child(group, `assembly-car-${slot}`), shell = batch(g), color = slot === 0 ? 'red' : 'white';
    g.rotation.y = Math.PI / 2; g.scale.setScalar(1.12);
    shell.box('steel', 0, .5, 0, 1.8, .16, 4.2);
    for (const x of [-.9, .9]) {
      shell.box(color, x, .72, 0, .13, .35, 4.2);
      shell.box(color, x, .99, -1.6, .17, .45, 1);
      shell.box(color, x, .99, 1.55, .17, .45, 1.1);
      shell.box(color, x * .86, 1.85, -.25, .12, .12, 2.25);
      for (const z of [-1.33, -.27, .84]) shell.box(color, x * .86, 1.4, z, .12, .85, .13);
    }
    for (const z of [-1.33, .84]) shell.box(color, 0, 1.85, z, 1.58, .12, .12);
    shell.box(color, 0, .92, -2.04, 1.8, .45, .13);
    shell.finish();
    const parts = ASSEMBLY_STEPS.map(step => child(g, step.id));
    const engine = batch(parts[0]);
    engine.box('dark', 0, .81, 1.4, 1.3, .38, .9); engine.box('steel', 0, 1.05, 1.4, 1, .3, .72);
    for (const x of [-.3, 0, .3]) { engine.cylinder('steel', x, 1.29, 1.4, .11, .2); engine.box('red', x, 1.38, 1.4, .13, .08, .4); }
    engine.box('dark', .7, .96, 1.6, .22, .6, .7); engine.finish();
    const cabin = batch(parts[1]);
    for (const x of [-.43, .43]) for (const z of [-.8, .25]) {
      cabin.box('dark', x, .9, z, .62, .25, .64); cabin.box('dark', x, 1.19, z - .24, .62, .6, .18);
      cabin.box('dark', x, 1.56, z - .24, .32, .2, .17);
    }
    cabin.box('dark', 0, 1.18, .75, 1.6, .24, .3); cabin.box('glassLight', 0, 1.39, .73, .35, .2, .05);
    cabin.cylinder('dark', -.45, 1.29, .5, .2, .06, Math.PI / 2); cabin.finish();
    const wheels = [];
    for (const side of [-1, 1]) for (const z of [-1.3, 1.35]) {
      const wheel = child(parts[2], 'wheel'), wb = batch(wheel); wheel.position.set(side * .98, .49, z);
      wb.cylinder('tire', 0, 0, 0, .43, .26, 0, Math.PI / 2);
      wb.cylinder('steel', side * .15, 0, 0, .27, .045, 0, Math.PI / 2);
      wb.cylinder('dark', side * .18, 0, 0, .09, .05, 0, Math.PI / 2);
      wb.box('white', side * .185, 0, 0, .015, .43, .05); wb.box('white', side * .185, 0, 0, .015, .05, .43); wb.finish(); wheels.push({ wheel, side });
    }
    const glass = child(parts[3], 'windows'), gb = batch(glass);
    gb.box('glass', 0, 1.53, .84, 1.42, .54, .055); gb.box('glass', 0, 1.53, -1.33, 1.42, .54, .055); gb.finish();
    const doors = [];
    for (const side of [-1, 1]) {
      const door = child(parts[3], 'doors'), db = batch(door);
      door.position.x = side * .89;
      for (const z of [-.8, .3]) {
        db.box(color, 0, .97, z, .1, .63, .98); db.box('glass', -.02 * side, 1.55, z, .07, .48, .88);
        db.box('steel', side * .065, 1.16, z - .28, .04, .05, .18);
      }
      db.box(color, side * .15, 1.4, .68, .25, .12, .22); db.finish(); doors.push({ door, side });
    }
    const finish = batch(parts[4]);
    finish.box(color, 0, 1.25, 1.48, 1.77, .12, 1.15); finish.box(color, 0, 1.24, -1.73, 1.77, .12, .5);
    finish.box(color, 0, 1.9, -.25, 1.66, .12, 2.2);
    for (const z of [-2.15, 2.15]) finish.box(color, 0, .76, z, 1.98, .3, .2);
    finish.box('dark', 0, .88, 2.26, .95, .2, .025);
    for (const side of [-1, 1]) {
      finish.box('white', side * .68, 1.08, 2.17, .46, .2, .06);
      finish.box('darkRed', side * .68, 1.08, -2.17, .45, .17, .06);
    }
    finish.finish();
    return { g, parts, wheels, doors, glass };
  }
  // Five numbered work bays with feed lanes, equipment and component carts.
  b.box('dark', 0, 1.14, 0, 46, .34, 3.3);
  for (const z of [-1.83, 1.83]) b.box('yellow', 0, 1.39, z, 46, .1, .1);
  for (let x = -22.5; x < 23; x += .65) b.cylinder('steel', x, 1.4, 0, .13, 3, Math.PI / 2);
  for (const [i, step] of ASSEMBLY_STEPS.entries()) {
    b.box(i % 2 ? 'roof' : 'white', step.x, .96, 0, 7.8, .03, 13.8);
    for (const z of [-6.9, 6.9]) b.box('white', step.x, 1, z, 7.8, .04, .13);
    b.box('red', step.x - 3.7, 1, -5, .09, .04, 3.7);
    const sign = textPlane(`0${i + 1}  ${step.short.toUpperCase()}`, 6.5, .8, '#ffffff', '#b22e26'); sign.position.set(step.x, 5.8, -5.3); group.add(sign);
    for (const dx of [-3.3, 3.3]) b.box('steel', step.x + dx, 3.4, -5.3, .1, 5, .1);
    const number = textPlane(`0${i + 1}`, 1.6, .9, '#b22e26', '#f6f5ef'); number.rotation.x = -Math.PI / 2; number.position.set(step.x, 1.03, 5.7); group.add(number);
    // Tool trolley, wheels, drawers and shadow board.
    b.box('red', step.x + 2.1, 1.7, 4.2, 1.6, 1.3, 1);
    b.box('dark', step.x + 2.1, 2.42, 4.2, 1.75, .15, 1.1);
    for (const y of [1.3, 1.7, 2.1]) b.box('steel', step.x + 2.1, y, 4.72, 1.4, .04, .03);
    for (const dx of [-.55, .55]) b.cylinder('tire', step.x + 2.1 + dx, 1.06, 4.2, .16, .8, Math.PI / 2);
    for (const dx of [-.4, 0, .4]) b.box('steel', step.x + 2.1 + dx, 2.55, 4.2, .11, .16, .6);
    worker(step.x - 1.3, 3.5, Math.PI); worker(step.x + 1.4, -3.4, 0);
    desk(step.x, -9.6);
    const light = new THREE.Mesh(geometries.sphere, materials.scan); light.scale.setScalar(.17); light.position.set(step.x + 3.3, 5.4, -5.3); group.add(light); fixtures.push(light);
  }
  // Engine bridge, cable and lifting yoke.
  for (const z of [-3.2, 3.2]) b.box('steel', -15.5, 3.6, z, .22, 5.2, .22);
  b.box('red', -15.5, 6.3, 0, .6, .35, 6.8);
  const cable = new THREE.Mesh(geometries.box, materials.dark); cable.scale.set(.06, 1, .06); group.add(cable);
  // Seats on delivery racks; power units on stands.
  for (const x of [-19, -16, -13]) {
    b.box('steel', x, 1.5, -7.3, 1.5, .7, 1.2); b.box('dark', x, 2.1, -7.3, 1.1, .6, .9);
  }
  for (const x of [-11, -9, -7]) {
    b.box('steel', x, 1.2, -7.2, 1.2, .3, 1.2); b.box('dark', x, 1.55, -7.2, 1, .4, .9); b.box('dark', x, 2, -7.6, 1, 1, .2);
  }
  for (const z of [-4.5, 4.5]) for (const x of [-1.2, 0, 1.2]) b.cylinder('tire', x, 1.7, z, .5, .5, Math.PI / 2);
  // Door delivery frames and upright glazing.
  for (const x of [6.5, 8.5, 10.5]) {
    b.box('steel', x, 1.1, -7.3, 1.4, .2, 1.7); b.box('red', x, 2, -7.3, .16, 1.7, 1.2); b.box('glass', x, 3.1, -7.3, .08, .6, 1.1);
  }
  for (const z of [-2.7, 2.7]) b.box('white', 17, 3.4, z, .24, 4.9, .24);
  b.box('white', 17, 5.9, 0, .24, .24, 5.6);
  for (const z of [-2.55, 2.55]) b.box('scan', 17, 3.7, z, .08, 3.7, .08);
  b.finish();
  for (let slot = 0; slot < 5; slot++) cars.push(progressiveCar(slot));
  // The red skid makes the observed vehicle easy to find while it is still a bare shell.
  const skid = child(group, 'tracked-skid'), sb = batch(skid);
  for (const z of [-1.7, 1.7]) sb.box('red', 0, 0, z, 5.9, .09, .12);
  for (const x of [-2.9, 2.9]) sb.box('red', x, 0, 0, .12, .09, 3.4); sb.finish();

  return seconds => {
    cars.forEach(({ g, parts, wheels, doors, glass }, slot) => {
      const s = assemblyAt(seconds, slot); g.position.set(s.x, 1.52, 0); g.visible = !(s.stage === 4 && s.phase > .98);
      g.userData.stage = s.stage; g.userData.installed = s.installed;
      parts.forEach((part, i) => { part.visible = s.stage >= i && (s.stage > i || s.phase >= .12); part.position.set(0, 0, 0); });
      parts[0].position.y = -.25 + (s.stage === 0 ? (1 - s.install) * 3.2 : 0);
      if (s.stage === 1) parts[1].position.y = (1 - s.install) * 2.4;
      for (const { wheel, side } of wheels) wheel.position.x = side * (.98 + (s.stage === 2 ? (1 - s.install) * 1.5 : 0));
      for (const { door, side } of doors) door.position.x = side * (.89 + (s.stage === 3 ? (1 - s.install) * 1.5 : 0));
      glass.position.y = s.stage === 3 ? (1 - s.install) * 1.8 : 0;
      if (s.stage === 4) parts[4].position.y = (1 - s.install) * 1.8;
      if (slot === 0) { skid.position.set(s.x, 1.55, 0); skid.visible = g.visible; }
    });
    // Exactly one vehicle occupies each post during the assembly portion of a tact.
    const phase = assemblyAt(seconds).phase, lifting = 1 - ease((phase - .15) / .5);
    const hookY = 2.9 + lifting * 3;
    cable.scale.y = Math.max(.08, 6.2 - hookY); cable.position.set(-15.5, (6.2 + hookY) / 2, 0);
    cable.visible = phase >= .12 && phase < .78;
    fixtures.forEach(light => { light.material = phase >= .15 && phase < .8 ? materials.scan : materials.yellow; });
  };
}
