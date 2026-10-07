import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replanLocally } from '../public/js/schedule-disruptions.js';
import { SCHEDULE_DEFAULTS } from '../public/js/schedule-engine.js';

const now = 1000000;
const trip = (id, routeId, locoId) => ({ uid: id, number: id, routeId, route: routeId, dir: 'fwd', from: routeId + 'A', to: routeId + 'B', category: 'freight', electrified: 0,
  consist: { grossT: 1000 }, departedMs: now + 3600000, arrivesMs: now + 7200000, departure: now + 3600000, arrival: now + 7200000,
  locoId, status: 'assigned', waitMin: 0, wagons: 10 });
test('24h service changes only connected rotations and never assigns the serviced loco during its window', () => {
  const rows = [trip('1', 'X', 'L1'), trip('2', 'Y', 'L2')];
  const fleet = rows.map(r => ({ id: r.locoId, type: 'diesel', role: 'freight', station: r.from, ready: now, maxT: 6000, series: 'ТЭ33А' }));
  const plan = { fleet, config: SCHEDULE_DEFAULTS, optimized: { rows } };
  const next = replanLocally(plan, { id: 'service1', locoId: 'L1', from: now, until: now + 86400000, reason: 'Суточное обслуживание' }, now);
  assert.equal(next.optimized.rows[1], rows[1]);
  assert.equal(next.optimized.rows[0].status, 'unassigned');
  assert.ok(next.optimized.rows[0].proposedDeparture >= now + 86400000);
  assert.equal(next.optimized.rows[0].departedMs, rows[0].departedMs);
  assert.equal(next.changes[0].changes.length, 1);
  assert.deepEqual(next.changes[0].routes, ['X']);
});
test('already departed trips remain frozen', () => {
  const row = { ...trip('1', 'X', 'L1'), departure: now - 1 };
  const plan = { fleet: [], config: SCHEDULE_DEFAULTS, optimized: { rows: [row] } };
  const next = replanLocally(plan, { id: 'a', routeId: 'X', from: now, until: now + 86400000, reason: 'окно' }, now);
  assert.equal(next.optimized.rows[0], row);
});
