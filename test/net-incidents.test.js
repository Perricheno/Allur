import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepare, networkTrains, setNetworkIncidents, incidentVariants } from '../public/js/network-sim.js';
import { NetIncidents } from '../server/net-incidents.js';

const sim = prepare(JSON.parse(readFileSync(new URL('../public/data/kz-routes.json', import.meta.url))));
const now = Date.UTC(2026, 9, 3, 6, 0);
const closure = { id: 'i1', kind: 'closure', routeId: 'AST-ALA', a: 300, b: 340, track: 'even', from: now - 3600e3, until: now + 4 * 3600e3, segName: 'тест', approved: false, variant: 'priority' };

test('closure delays trains and the dispatcher variant changes weighted delay', () => {
  setNetworkIncidents([]);
  const before = networkTrains(sim, now + 30 * 60000).filter(t => t.routeId === 'AST-ALA' && t.stopped && !t.planned).length;
  setNetworkIncidents([closure]);
  const vs = incidentVariants(sim, closure);
  assert.equal(vs.variants.length, 3);
  const fifo = vs.variants.find(v => v.id === 'fifo'), priority = vs.variants.find(v => v.id === 'priority');
  assert.ok(priority.metrics.weighted <= fifo.metrics.weighted, 'приоритет не хуже очереди подхода');
  assert.ok(priority.metrics.passenger <= fifo.metrics.passenger);
  const during = networkTrains(sim, now + 30 * 60000).filter(t => t.routeId === 'AST-ALA' && t.stopped && !t.planned).length;
  assert.ok(during >= before, 'закрытие не уменьшает число вынужденных стоянок');
  setNetworkIncidents([]);
});

test('breakdown keeps its own train stopped until the repair ends', () => {
  setNetworkIncidents([]);
  const tr = networkTrains(sim, now).find(t => t.routeId === 'AST-PAV' && !t.stopped);
  const km = tr.dir === 'fwd' ? tr.km : tr.totalKm - tr.km;
  setNetworkIncidents([{ id: 'b1', kind: 'breakdown', level: 2, routeId: 'AST-PAV', a: km - 0.3, b: km + 0.3, track: tr.dir === 'fwd' ? 'even' : 'odd', from: now, until: now + 45 * 60000, trainUid: tr.uid, trainNumber: tr.number, segName: 'x', approved: true, variant: 'fifo' }]);
  const later = networkTrains(sim, now + 20 * 60000).find(t => t.uid === tr.uid);
  assert.ok(later.stopped && /неисправность/.test(later.reason));
  const after = networkTrains(sim, now + 90 * 60000).find(t => t.uid === tr.uid);
  assert.ok(!after || !after.stopped || !/неисправность/.test(after.reason));
  setNetworkIncidents([]);
});

test('server incident store validates input and enforces limits', () => {
  const store = new NetIncidents('/tmp/x.json', sim.byId, false);
  assert.throws(() => store.add({ kind: 'closure', routeId: 'NO-ROUTE', a: 1, b: 9, track: 'even', minutes: 30 }, now), /маршрут/);
  assert.throws(() => store.add({ kind: 'closure', routeId: 'AST-ALA', a: 1, b: 9, track: 'both' }, now), /длительность/);
  assert.throws(() => store.add({ kind: 'restriction', routeId: 'AST-ALA', a: 1, b: 9, kmh: 500, minutes: 30 }, now), /скорость/);
  const inc = store.add({ kind: 'restriction', routeId: 'AST-ALA', a: 9, b: 1, kmh: 25, minutes: 30 }, now);
  assert.equal(inc.a, 1); assert.equal(inc.until, now + 30 * 60000);
  assert.equal(store.approve(inc.id, 'batch').approved, true);
  assert.equal(store.remove(inc.id), true);
  for (let i = 0; i < 25; i++) store.add({ kind: 'restriction', routeId: 'AST-ALA', a: 1, b: 9, kmh: 25, minutes: 30 }, now);
  assert.throws(() => store.add({ kind: 'restriction', routeId: 'AST-ALA', a: 1, b: 9, kmh: 25, minutes: 30 }, now), /много/);
});
