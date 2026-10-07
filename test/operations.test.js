import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepare, scheduledTrips, networkTrains, networkEvents, setNetworkPlan, networkStats } from '../public/js/network-sim.js';
import { operationalMetrics, fleetStandingMetrics } from '../public/js/operational-metrics.js';
import { scheduleEconomics, allocateTrips, SCHEDULE_DEFAULTS } from '../public/js/schedule-engine.js';
import { networkTrackData } from '../public/js/network-track-data.js';

test('national schematic preserves positions, direction and unknown infrastructure', () => {
  const sim = prepare(data), trains = networkTrains(sim, now), route = sim.byId.get(trains[0].routeId);
  const selected = trains.filter(t => t.routeId === route.id);
  const mapped = networkTrackData({ baseTime: now }, route, selected, now);
  assert.equal(mapped.trains.length, selected.length);
  assert.equal(mapped.stations[0].km, 0);
  assert.equal(mapped.stations.at(-1).km, route.km);
  assert.ok(mapped.stations.every(s => s.capacity === null && !s.tracks.length));
  for (const t of mapped.trains) {
    const i = Math.min(mapped.stations.length - 2, Math.floor(t.diagramPosition)), f = t.diagramPosition - i;
    const km = mapped.stations[i].km + f * (mapped.stations[i + 1].km - mapped.stations[i].km);
    const expected = t.network.dir === 'rev' ? route.km - t.network.km : t.network.km;
    assert.ok(Math.abs(km - expected) < .001);
    assert.equal(t.direction, t.network.dir === 'rev' ? 'odd' : 'even');
  }
});

const hour = 3600000;
const data = JSON.parse(readFileSync(new URL('../public/data/kz-routes.json', import.meta.url)));
const now = Date.parse('2026-10-03T04:00:00Z');

test('network repairs are capped by occurrence day and deterministic across restarts and query order', () => {
  const start = Date.parse('2026-10-01T19:00:00Z');
  const sim = prepare(data), fresh = prepare(data);
  for (const day of [2, 0, 1]) {
    const end = start + (day + 1) * 24 * hour - 1;
    const repairs = networkEvents(sim, end, 1440).filter(e => e.kind === 'repair');
    assert.ok(repairs.length <= 8, `day ${day}: ${repairs.length}`);
    assert.ok(repairs.length > 0);
    assert.deepEqual(repairs.map(e => e.id), networkEvents(fresh, end, 1440).filter(e => e.kind === 'repair').map(e => e.id));
    for (const event of repairs) {
      const t = networkTrains(sim, event.at + 60000).find(t => t.uid === event.uid);
      assert.equal(t?.reason, 'устранение неисправности');
    }
  }
});

test('applied schedule delays movement, station departure and events together', () => {
  const sim = prepare(data), trip = scheduledTrips(sim, now, now + hour)[0];
  const row = { ...trip, status: 'assigned', departure: trip.departedMs + hour, arrival: trip.arrivesMs + hour, assignedSeries: trip.loco.series, traction: trip.loco.type === 'тепловоз' ? 'diesel' : 'electric', locoId: 'L1', reason: 'оборот' };
  setNetworkPlan(sim, { executionEnabled: true, optimized: { rows: [row] } });
  const waiting = networkTrains(sim, trip.departedMs + 60000).filter(t => t.uid === trip.uid);
  assert.equal(waiting.length, 1); assert.equal(waiting[0].speedKmh, 0); assert.equal(waiting[0].station, trip.from);
  assert.equal(waiting[0].locoId, 'L1');
  assert.ok(!networkEvents(sim, trip.departedMs + 60000, 2).some(e => e.uid === trip.uid && e.kind === 'send'));
  const running = networkTrains(sim, row.departure + 60000).find(t => t.uid === trip.uid);
  assert.ok(running && running.km > 0); assert.equal(running.arrivesMs, row.arrival);
  const send = networkEvents(sim, row.departure + 60000, 2).find(e => e.uid === trip.uid && e.kind === 'send');
  assert.equal(send.at, row.departure); assert.equal(send.locoId, 'L1');
  assert.ok(!networkTrains(sim, row.arrival + 60000).some(t => t.uid === trip.uid));
});

test('unassigned trip remains at origin beyond its original arrival, without imaginary traction', () => {
  const sim = prepare(data), trip = scheduledTrips(sim, now, now + hour)[0];
  setNetworkPlan(sim, { executionEnabled: true, optimized: { rows: [{ ...trip, status: 'unassigned', locoId: null, reason: 'Нет тяги' }] } });
  const t = networkTrains(sim, trip.arrivesMs + hour).find(t => t.uid === trip.uid);
  assert.ok(t.waitingDeparture); assert.equal(t.arrivesMs, null); assert.equal(t.loco.series, 'Не назначен');
});

test('crew rest is not a fixed invented 12h and change explains next leg', () => {
  const sim = prepare(data), trains = networkTrains(sim, now);
  for (const t of trains) { assert.equal(t.crew.restAfterH, null); assert.equal(t.crew.limitMin, 480); assert.ok(t.crew.changeReason); }
  const events = networkEvents(sim, now, 1440).filter(e => e.kind === 'crew');
  assert.ok(events.length > 0);
  for (const e of events) { assert.ok(!e.text.includes('(12 ч)')); assert.ok(!e.savedMin); assert.ok(e.projectedMin > e.limitMin); }
});

test('passengers use actual model load and current counters are reproducible', () => {
  const trains = networkTrains(prepare(data), now), metrics = operationalMetrics(trains);
  assert.equal(metrics.moving + metrics.plannedStops + metrics.forcedStops, trains.length);
  assert.equal(networkStats(trains).passengers, trains.filter(t => t.category === 'passenger').reduce((sum, t) => sum + Math.round(t.wagons * 52 * t.consist.loadPct / 100), 0));
});

test('whole-fleet fuel includes unused reserve: swapping locos cannot create savings', () => {
  const row = { uid: 'a', status: 'assigned', departure: hour, arrival: 2 * hour, waitMin: 0, idleMin: 60, wagons: 10, traction: 'diesel', locoId: 'L1' };
  const plan = { createdAt: 0, config: { horizonH: 12 }, fleet: ['L1', 'L2'].map(id => ({ id, type: 'diesel', series: 'ТЭ33А', ready: 0 })),
    baseline: { rows: [row] }, optimized: { rows: [{ ...row, locoId: 'L2', idleMin: 0 }] } };
  const m = fleetStandingMetrics(plan);
  assert.equal(m.standingHours, 23); assert.equal(m.unused, 1); assert.equal(m.over12h, 1);
  assert.equal(scheduleEconomics(plan, { dieselLitresH: 15 }).dieselLitres, 0);
});

test('overlapping maintenance intervals count once and window clipping excludes future hours', () => {
  const plan = { createdAt: 0, config: { horizonH: 12 }, fleet: [{ id: 'L1', type: 'diesel', ready: 0 }], optimized: { rows: [] },
    constraints: [{ locoId: 'L1', from: hour, until: 3 * hour }, { locoId: 'L1', from: 2 * hour, until: 4 * hour }] };
  const m = fleetStandingMetrics(plan, 'optimized', 0, 6 * hour);
  assert.equal(m.serviceHours, 3); assert.equal(m.standingHours, 3);
});

test('a late freight cannot push an on-time passenger out of its fixed slot', () => {
  const make = (uid, category, dep) => ({ uid, routeId: 'X', dir: 'fwd', from: 'A', to: 'B', category, electrified: 0, consist: { grossT: 100 }, departedMs: dep, arrivesMs: dep + hour, wagons: 10 });
  const fleet = [{ id: 'F', type: 'diesel', role: 'freight', station: 'A', ready: 10 * hour, maxT: 6000 }, { id: 'P', type: 'diesel', role: 'passenger', station: 'A', ready: 0, maxT: 2000 }];
  const result = allocateTrips([make('f', 'freight', hour), make('p', 'passenger', 2 * hour)], fleet, SCHEDULE_DEFAULTS);
  assert.equal(result.rows[0].status, 'unassigned'); assert.ok(result.rows[0].proposedWaitMin > 400);
  assert.equal(result.rows[1].departure, 2 * hour); assert.equal(result.rows[1].waitMin, 0);
});

test('rejected reassignment must not retain stale departure and locomotive fields', () => {
  const old = { uid: 'old', category: 'freight', routeId: 'X', from: 'A', to: 'B', dir: 'fwd', electrified: 0, consist: { grossT: 100 }, departedMs: hour, arrivesMs: 2 * hour, departure: 4 * hour, arrival: 5 * hour, locoId: 'obsolete' };
  const r = allocateTrips([old], [], SCHEDULE_DEFAULTS).rows[0];
  assert.equal(r.departure, undefined); assert.equal(r.arrival, undefined); assert.equal(r.locoId, null); assert.equal(r.departedMs, hour);
});
