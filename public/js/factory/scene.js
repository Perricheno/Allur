import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/OrbitControls.js';
import { createFactory } from './geometry.js';
import { BY_ID } from './data.js';
import { assemblyAt, ASSEMBLY_TACT } from './assembly-state.js';
import { OPERATIONS } from './operations.js';

export function mountFactory(container, { onSelect, onReady, onError, onTime, onFollowChange = () => {} }) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
  renderer.domElement.setAttribute('aria-label', 'Интерактивная 3D-территория завода Allur');
  renderer.domElement.setAttribute('role', 'img'); renderer.domElement.tabIndex = 0;
  container.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#eeede7');
  const camera = new THREE.OrthographicCamera(-120, 120, 90, -90, .1, 900);
  const initialOffset = new THREE.Vector3(155, 170, 205);
  camera.position.copy(initialOffset); camera.lookAt(0, 0, 0);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reduced; controls.dampingFactor = .09; controls.minZoom = .65; controls.maxZoom = 10;
  controls.minPolarAngle = .15; controls.maxPolarAngle = Math.PI / 2.25; controls.enablePan = true;
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = THREE.TOUCH.ROTATE; controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  scene.add(new THREE.HemisphereLight('#ffffff', '#a2ab8d', 1.8));
  const sun = new THREE.DirectionalLight('#fff7e9', 2.5); sun.position.set(-65, 120, 65); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -145; sun.shadow.camera.right = 145;
  sun.shadow.camera.top = 145; sun.shadow.camera.bottom = -145; sun.shadow.camera.far = 360;
  sun.shadow.normalBias = .4; sun.shadow.bias = -.0002; sun.shadow.blurSamples = 6;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: '#eeede7', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2.1; ground.receiveShadow = true; scene.add(ground);
  const factory = createFactory(scene);
  const alerts = [...BY_ID.values()].map(area => {
    const geometry = new THREE.BoxGeometry(area.w + 4, .12, area.d + 4);
    const material = new THREE.MeshBasicMaterial({ color: '#ef3427', transparent: true, opacity: .15, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(area.x, 1.03, area.z); mesh.visible = false; scene.add(mesh);
    const outlineGeometry = new THREE.EdgesGeometry(geometry), outlineMaterial = new THREE.LineBasicMaterial({ color: '#ef3427', transparent: true, opacity: .85 });
    const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial); mesh.add(outline);
    return { id: area.id, mesh, geometry, material, outlineGeometry, outlineMaterial };
  });
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let width = 1, height = 1, frame = 0, last = performance.now(), elapsed = 0, running = !reduced, speed = 1;
  let selected = null, interior = false, labelsVisible = true, flow = true, disposed = false, timeSent = -1;
  let transition = null, down = null;
  let followAssembly = false;
  let production = null, areaTimes = null, targetTimes = null;
  const assemblyTime = () => areaTimes?.assembly ?? elapsed;
  const assemblyTarget = () => new THREE.Vector3(BY_ID.get('assembly').x + assemblyAt(assemblyTime()).x, 2.5, BY_ID.get('assembly').z);
  const animateFactory = () => factory.animate(production ? production.clock.elapsedSeconds / 60 : elapsed, areaTimes);
  const layer = document.createElement('div'); layer.className = 'scene-labels'; container.append(layer);
  const vehicleLabel = document.createElement('div'); vehicleLabel.className = 'vehicle-label';
  vehicleLabel.textContent = 'A-01'; vehicleLabel.setAttribute('aria-hidden', 'true'); layer.append(vehicleLabel);
  const labelNodes = factory.labels.map(label => {
    const area = BY_ID.get(label.id), node = document.createElement('button'); node.className = 'building-label';
    node.innerHTML = `<span>${area.n}</span>${area.short}<i>↗</i>`; node.setAttribute('aria-label', `Выбрать участок: ${area.name}`);
    node.addEventListener('click', () => onSelect(area.id)); layer.append(node); return { ...label, node };
  });
  function resize() {
    width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight);
    const aspect = width / height, view = Math.max(103, 127 / aspect);
    camera.left = -view * aspect; camera.right = view * aspect; camera.top = view; camera.bottom = -view;
    camera.updateProjectionMatrix(); renderer.setSize(width, height);
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  function startMove(target, zoom, offset = null) {
    const desiredOffset = offset || camera.position.clone().sub(controls.target).normalize().multiplyScalar(initialOffset.length());
    transition = { at: performance.now(), from: controls.target.clone(), to: target, fromPos: camera.position.clone(), toPos: target.clone().add(desiredOffset), fromZoom: camera.zoom, toZoom: zoom };
    if (reduced) transition.at -= 1000;
  }
  const cancelMove = () => { transition = null; followAssembly = false; onFollowChange(false); };
  controls.addEventListener('start', cancelMove);
  function hit(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(factory.targets, false)[0]?.object.userData.areaId;
  }
  const pointerDown = event => { down = { x: event.clientX, y: event.clientY, button: event.button }; };
  const pointerUp = event => { if (down?.button === 0 && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) { const id = hit(event); if (id) onSelect(id); } down = null; };
  const pointerMove = event => { if (!down) renderer.domElement.style.cursor = hit(event) ? 'pointer' : 'grab'; };
  const contextLost = event => { event.preventDefault(); running = false; onError('Соединение с графическим процессором прервано. Перезагрузите сцену.'); };
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  const keyboard = event => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); camera.zoom = Math.min(10, camera.zoom * 1.2); camera.updateProjectionMatrix(); }
    if (event.key === '-') { event.preventDefault(); camera.zoom = Math.max(.65, camera.zoom / 1.2); camera.updateProjectionMatrix(); }
    if (event.key === 'Home') { event.preventDefault(); startMove(new THREE.Vector3(), 1, initialOffset); }
  };
  renderer.domElement.addEventListener('keydown', keyboard);
  const projected = new THREE.Vector3();
  function animate(now) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const delta = Math.min((now - last) / 1000, .1); last = now;
    if (document.hidden) return;
    if (!production && running && flow) elapsed += delta * speed;
    if (production && areaTimes && targetTimes) for (const area of production.areas) {
      if (area.status === 'working' && production.clock.running) areaTimes[area.id] += (targetTimes[area.id] - areaTimes[area.id]) * (reduced ? 1 : Math.min(1, delta * 10));
    }
    for (const alert of alerts) if (alert.mesh.visible) alert.material.opacity = reduced ? .17 : .13 + Math.sin(now / 420) * .045;
    if (flow) animateFactory();
    if (Math.floor(elapsed) !== timeSent) { timeSent = Math.floor(elapsed); onTime(timeSent); }
    if (transition) {
      const t = Math.min(1, (now - transition.at) / 800), ease = 1 - (1 - t) ** 3;
      controls.target.lerpVectors(transition.from, transition.to, ease);
      camera.position.lerpVectors(transition.fromPos, transition.toPos, ease);
      camera.zoom = THREE.MathUtils.lerp(transition.fromZoom, transition.toZoom, ease); camera.updateProjectionMatrix();
      if (t === 1) transition = null;
    }
    if (followAssembly && selected === 'assembly' && interior && !transition) {
      const shift = assemblyTarget().sub(controls.target).multiplyScalar(reduced ? 1 : .12);
      controls.target.add(shift); camera.position.add(shift);
    }
    controls.update();
    for (const { node, position, id } of labelNodes) {
      projected.copy(position).project(camera);
      const visible = labelsVisible && Math.abs(projected.x) < .94 && Math.abs(projected.y) < .91 && projected.z < 1 && (!interior || !selected || selected === id);
      node.style.display = visible ? '' : 'none';
      if (visible) node.style.transform = `translate(${(projected.x * .5 + .5) * width}px,${(-projected.y * .5 + .5) * height}px) translate(-50%, -100%)`;
      node.classList.toggle('selected', id === selected);
    }
    const tracked = assemblyAt(assemblyTime());
    projected.copy(assemblyTarget()); projected.y = 5.8; projected.z += 2; projected.project(camera);
    const showVehicle = (!production || production.areas.find(a => a.id === 'assembly')?.job) && labelsVisible && interior && selected === 'assembly' && Math.abs(projected.x) < .94 && Math.abs(projected.y) < .9 && !(tracked.stage === 4 && tracked.phase > .98);
    vehicleLabel.style.display = showVehicle ? '' : 'none';
    if (showVehicle) vehicleLabel.style.transform = `translate(${(projected.x * .5 + .5) * width}px,${(-projected.y * .5 + .5) * height}px) translate(-50%, -100%)`;
    renderer.render(scene, camera);
    renderer.domElement.dataset.ready = 'true';
  }
  frame = requestAnimationFrame(animate); onReady();
  return {
    select(id, showInside = interior, focus = true) {
      selected = id; interior = showInside; factory.select(id, interior);
      animateFactory();
      if (id !== 'assembly' || !interior) { followAssembly = false; onFollowChange(false); }
      const a = BY_ID.get(id);
      if (focus) startMove(a ? new THREE.Vector3(a.x, 2, a.z) : new THREE.Vector3(), a ? (interior ? Math.min(4, 145 / a.w) : 2) : 1, a ? null : initialOffset);
    },
    home() { selected = null; factory.select(null, interior); startMove(new THREE.Vector3(), 1, initialOffset); },
    top() { startMove(selected ? new THREE.Vector3(BY_ID.get(selected).x, 0, BY_ID.get(selected).z) : new THREE.Vector3(), selected ? 2 : 1, new THREE.Vector3(0, 290, .1)); },
    zoom(direction) { transition = null; camera.zoom = THREE.MathUtils.clamp(camera.zoom * (direction > 0 ? 1.2 : 1 / 1.2), .65, 10); camera.updateProjectionMatrix(); },
    setRunning(value) { running = value; }, setSpeed(value) { speed = value; },
    setLabels(value) { labelsVisible = value; },
    setQuality(value) { renderer.setPixelRatio(value ? Math.min(devicePixelRatio, 1.7) : 1); renderer.shadowMap.enabled = value; resize(); },
    setFlow(value) { flow = value; },
    setProduction(snapshot) {
      const previous = production;
      production = snapshot;
      if (!snapshot) {
        areaTimes = null; targetTimes = null; vehicleLabel.textContent = 'A-01';
        for (const alert of alerts) alert.mesh.visible = false;
        for (const { node } of labelNodes) { delete node.dataset.status; node.removeAttribute('title'); }
      } else {
        areaTimes ||= Object.fromEntries(Object.keys(OPERATIONS).map(id => [id, 0]));
        targetTimes ||= { ...areaTimes };
        for (const area of snapshot.areas) {
          // Use reported progress, including its final frozen position during a stop.
          if (area.job) {
            targetTimes[area.id] = Math.min(.9999, Math.max(0, area.job.progress)) * OPERATIONS[area.id].duration;
            if (!previous || previous.clock.elapsedSeconds > snapshot.clock.elapsedSeconds || previous.areas.find(a => a.id === area.id)?.job?.unit.id !== area.job.unit.id || area.status !== 'working' || !snapshot.clock.running) areaTimes[area.id] = targetTimes[area.id];
          }
          const alert = alerts.find(a => a.id === area.id);
          const critical = ['down', 'material_shortage', 'no_utilities', 'no_staff'].includes(area.status), warning = ['blocked', 'starved'].includes(area.status);
          alert.mesh.visible = critical || warning;
          alert.material.color.set(critical ? '#ef3427' : '#dca132'); alert.outlineMaterial.color.copy(alert.material.color);
          const label = labelNodes.find(item => item.id === area.id)?.node;
          if (label) { label.dataset.status = area.status; label.title = `${area.reason || area.name} · очередь ${area.queue.count}`; }
        }
        vehicleLabel.textContent = snapshot.areas.find(a => a.id === 'assembly')?.job?.unit.id || '';
      }
      animateFactory();
    },
    inspectAssembly(stage) {
      if (!Number.isInteger(stage) || stage < 0 || stage > 4) return;
      elapsed = stage * ASSEMBLY_TACT + 8; running = false;
      factory.animate(elapsed); timeSent = Math.floor(elapsed); onTime(timeSent);
      followAssembly = true; onFollowChange(true); startMove(assemblyTarget(), width < 600 ? 8 : 5.2);
    },
    followAssembly(value) {
      followAssembly = value; onFollowChange(value);
      startMove(value ? assemblyTarget() : new THREE.Vector3(BY_ID.get('assembly').x, 2, BY_ID.get('assembly').z), value ? (width < 600 ? 8 : 5.2) : 145 / BY_ID.get('assembly').w);
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointermove', pointerMove); renderer.domElement.removeEventListener('keydown', keyboard); renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      factory.dispose(); ground.geometry.dispose(); ground.material.dispose(); sun.shadow.map?.dispose(); renderer.dispose(); renderer.domElement.remove(); layer.remove();
      for (const alert of alerts) { scene.remove(alert.mesh); alert.geometry.dispose(); alert.material.dispose(); alert.outlineGeometry.dispose(); alert.outlineMaterial.dispose(); }
    },
  };
}
