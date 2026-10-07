import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepare, scheduledTrips, networkTrains } from '../public/js/network-sim.js';
import { buildSchedule, scheduleEconomics, validateScheduleSettings } from '../public/js/schedule-engine.js';

const sim = prepare(JSON.parse(readFileSync(new URL('../public/data/kz-routes.json', import.meta.url))));
const now = Date.parse('2026-10-01T04:00:00Z');

test('future trips agree with live model when their departure occurs', () => {
  for (const t of scheduledTrips(sim, now, now + 3600000).slice(0, 10)) {
    const active = networkTrains(sim, t.departedMs + 1).find(r => r.uid === t.uid);
    assert.ok(active);
    assert.equal(active.number, t.number);
    assert.equal(active.arrivesMs, t.arrivesMs);
    assert.equal(active.wagons, t.wagons);
  }
});

test('plan conserves trips, locos never overlap and only move after arrival plus turnaround', () => {
  const plan = buildSchedule(sim, now);
  assert.ok(plan.optimized.rows.length > 100);
  assert.deepEqual(plan.optimized.rows.map(r => r.uid).sort(), plan.baseline.rows.map(r => r.uid).sort());
  assert.equal(new Set(plan.optimized.rows.map(r => r.uid)).size, plan.optimized.rows.length);
  for (const variant of [plan.baseline, plan.optimized]) {
    const fleet = new Map(plan.fleet.map(l => [l.id, { ...l }]));
    for (const row of variant.rows) {
      if (!row.locoId) continue;
      const l = fleet.get(row.locoId);
      assert.equal(l.station, row.from);
      assert.ok(row.couplingAt >= l.ready - 1);
      assert.ok(row.departure >= row.departedMs);
      assert.ok(l.maxT >= row.consist.grossT);
      assert.equal(l.role, row.category === 'passenger' ? 'passenger' : 'freight');
      assert.equal(l.type, row.electrified >= .95 ? 'electric' : 'diesel');
      l.station = row.to; l.ready = row.arrival + plan.config.turnaroundMin * 60000;
    }
  }
  assert.ok(plan.optimized.weightedWait <= plan.baseline.weightedWait);
});

test('no compatible fleet produces explicit unassigned trips rather than imaginary locomotives', () => {
  const p = buildSchedule(sim, now, { reserve: 0, maxFreightT: 100, maxPassengerT: 100 });
  assert.equal(p.optimized.assigned, 0);
  assert.ok(p.optimized.rows.every(r => r.status === 'unassigned' && r.reason));
});

test('energy is based on loco idle, not wagons waiting for a locomotive; signed costs are retained', () => {
  const base = { uid: 'a', status: 'assigned', waitMin: 120, idleMin: 0, wagons: 50, traction: 'diesel' };
  const optimized = { ...base, waitMin: 60, idleMin: 30 };
  const p = { baseline: { rows: [base] }, optimized: { rows: [optimized] } };
  const e = scheduleEconomics(p, { dieselLitresH: 10, dieselPrice: 200, electricKwhH: 2, electricPrice: 30, locoHour: 0, wagonHour: 100 });
  assert.equal(e.minutes, 60); assert.equal(e.wagonHours, 50);
  assert.equal(e.dieselLitres, -5); assert.equal(e.energyKzt, -1000); assert.equal(e.totalKzt, 4000);
  assert.equal(scheduleEconomics(p).ready, false);
});

test('invalid parameters are rejected', () => {
  assert.throws(() => validateScheduleSettings({ reserve: -1 }));
  assert.throws(() => validateScheduleSettings({ horizonH: NaN }));
  assert.throws(() => scheduleEconomics({ baseline: { rows: [] }, optimized: { rows: [] } }, { dieselPrice: -1 }));
});
