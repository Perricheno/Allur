import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepare, networkTrains, networkStats } from '../public/js/network-sim.js';

const data = JSON.parse(readFileSync(new URL('../public/data/kz-routes.json', import.meta.url), 'utf8'));
const sim = prepare(data);
const noon = Date.parse('2026-10-02T12:00:00+05:00');

test('route data: real polylines between the main hubs with stations along the way', () => {
  assert.ok(data.routes.length >= 40);
  for (const r of data.routes) {
    assert.ok(r.km >= 80 && r.km <= 2200, r.id);
    assert.ok(r.points.length >= 10 && r.points.every(([lat, lon, km]) => lat > 40 && lat < 56 && lon > 46 && lon < 88 && km >= 0));
    assert.ok(r.points.every((p, i) => i === 0 || p[2] >= r.points[i - 1][2]), `километры возрастают: ${r.id}`);
    assert.ok(Math.abs(r.points.at(-1)[2] - r.km) < 2);
    assert.ok(r.stops.length >= 3 && r.stops.every(([, km]) => km >= 0 && km <= r.km + 1));
    assert.ok(r.electrified >= 0 && r.electrified <= 1 && r.weight >= 1);
  }
});

test('the whole network is alive: hundreds of trains at any hour, unique numbers, plausible mix', () => {
  for (const h of [0, 4, 8, 12, 16, 20]) {
    const trains = networkTrains(sim, noon + h * 3600e3);
    const s = networkStats(trains);
    assert.ok(s.total >= 500 && s.total <= 900, `поездов ${s.total} в ${h} ч`);
    assert.equal(new Set(trains.map(t => t.number)).size, trains.length, 'номера уникальны');
    assert.ok(s.passenger >= 15 && s.freight > s.container && s.container > s.passenger);
    assert.ok(s.electric > 100 && s.diesel > 100 && s.electric + s.diesel === s.total);
    assert.ok(s.stopped > 20 && s.moving > s.stopped, 'часть поездов стоит на станциях');
    assert.ok(s.avgSpeed > 40 && s.avgSpeed < 90);
  }
});

test('trains are deterministic and move: the same moment gives the same picture, later positions differ', () => {
  const a = networkTrains(sim, noon), b = networkTrains(sim, noon);
  assert.deepEqual(a.map(t => [t.uid, t.lat, t.lon]), b.map(t => [t.uid, t.lat, t.lon]));
  const later = new Map(networkTrains(sim, noon + 10 * 60e3).map(t => [t.uid, t]));
  const moved = a.filter(t => !t.stopped && later.get(t.uid) && (later.get(t.uid).km !== t.km));
  assert.ok(moved.length > 300, `сдвинулись ${moved.length}`);
  for (const t of a.slice(0, 200)) assert.ok(t.lat > 40 && t.lat < 56 && t.lon > 46 && t.lon < 88 && t.progress >= 0 && t.progress <= 1.001);
});

test('stopped trains explain themselves; forced stops carry a reason and a wait time', () => {
  const trains = networkTrains(sim, noon);
  const forced = trains.filter(t => t.stopped && !t.planned);
  assert.ok(forced.length > 3);
  for (const t of forced) assert.ok(t.reason && t.delayMin >= 0 && t.restMin >= 0, t.number);
  assert.ok(trains.filter(t => t.stopped && t.planned).every(t => ['плановая стоянка', 'смена локомотивной бригады'].includes(t.reason)));
  const e = trains.find(t => t.loco.type === 'электровоз');
  assert.ok(sim.byId.get(e.routeId).electrified > 0.5, 'электровозы — на электрифицированных маршрутах');
});

test('the corridor filter hides network trains near the dispatcher section', () => {
  const all = networkTrains(sim, noon);
  const some = all.filter(t => t.lat > 47 && t.lat < 50).length;
  const filtered = networkTrains(sim, noon, { exclude: (lat) => lat > 47 && lat < 50 });
  assert.equal(filtered.length, all.length - some);
});
