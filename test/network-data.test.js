import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const net = JSON.parse(readFileSync(new URL('../public/data/kz-stations.json', import.meta.url), 'utf8'));
const fleet = JSON.parse(readFileSync(new URL('../public/data/fleet.json', import.meta.url), 'utf8'));
const inKazakhstan = ([, , lat, lon]) => lat > 40 && lat < 56 && lon > 46 && lon < 88;

test('station data covers Kazakhstan: hundreds of stations, valid coordinates, unique OSM ids', () => {
  assert.ok(net.stations.length >= 800, `станций ${net.stations.length}`);
  assert.ok(net.halts.length >= 300, `остановочных пунктов ${net.halts.length}`);
  for (const rec of [...net.stations, ...net.halts]) {
    assert.ok(Number.isInteger(rec[0]) && typeof rec[1] === 'string' && rec[1].length > 0, `запись ${rec}`);
    assert.ok(inKazakhstan(rec), `за пределами Казахстана: ${rec[1]} ${rec[2]},${rec[3]}`);
  }
  const ids = [...net.stations, ...net.halts].map(r => r[0]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(net.license, 'ODbL-1.0');
  const names = new Set(net.stations.map(r => r[1]));
  for (const city of ['Караганда', 'Атырау', 'Павлодар', 'Тараз', 'Костанай', 'Кызылорда', 'Петропавловск']) assert.ok(names.has(city), city);
});

test('modelled corridor stations exist in the national layer', () => {
  const corridor = readFileSync(new URL('../server/rail-corridor.js', import.meta.url), 'utf8');
  const nodes = [...corridor.matchAll(/"osmNode":(\d+)/g)].map(m => Number(m[1]));
  const ids = new Set(net.stations.map(r => r[0]));
  assert.equal(nodes.length, 10);
  assert.ok(nodes.filter(n => ids.has(n)).length >= 8, 'станции участка есть в данных OpenStreetMap');
});

test('fleet data: type counts add up to the stated total, depots sit on real stations, sources are listed', () => {
  assert.equal(fleet.types.reduce((n, t) => n + t.approx, 0), fleet.total);
  assert.ok(fleet.types.every(t => t.count > 0 && Math.abs(t.count - t.approx) <= 10));
  assert.match(fleet.disclaimer, /примерные|оценка/i);
  assert.equal(fleet.deliveries2026.groups.reduce((n, g) => n + g.count, 0), fleet.deliveries2026.total);
  const stations = new Map(net.stations.map(r => [r[1], r]));
  for (const depot of fleet.depots) {
    const s = stations.get(depot.station);
    assert.ok(s, `станция депо ${depot.name}: ${depot.station}`);
    assert.ok(Math.abs(s[2] - depot.lat) < 0.01 && Math.abs(s[3] - depot.lon) < 0.01, `координаты депо ${depot.name}`);
    assert.ok(depot.kinds.every(k => fleet.types.some(t => t.id === k)));
  }
  for (const g of fleet.deliveries2026.groups) for (const name of g.depots) assert.ok(fleet.depots.some(d => d.name === name), `депо ${name} из поставок`);
  assert.ok(fleet.sources.length >= 3 && fleet.sources.every(s => /^https:\/\//.test(s.url)));
});
