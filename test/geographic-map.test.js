import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORRIDOR } from '../server/rail-corridor.js';
import { coordinateAt, distanceKm, indexOfLocation, prepareGeometry } from '../public/js/geo-position.js';
import { createState } from '../server/model.js';
import { refreshStationGeography } from '../server/world.js';

const geometry = prepareGeometry(CORRIDOR.segments);
test('ten real stations share one continuous railway geometry and model metadata', () => {
  assert.equal(CORRIDOR.stations.length, 10);
  assert.equal(geometry.length, 9);
  const state = createState();
  for (let i = 0; i < 10; i++) {
    assert.equal(state.stations[i].name, CORRIDOR.stations[i].name);
    assert.ok(distanceKm(coordinateAt(geometry, i), CORRIDOR.stations[i].coordinate) < .6);
    if (i < 8) assert.deepEqual(geometry[i].points.at(-1), geometry[i + 1].points[0]);
  }
  assert.ok(Math.abs(geometry.reduce((n, g) => n + g.total, 0) - CORRIDOR.lengthKm) < .1);
});

test('position follows rail arc length in both directions and supports a stop between stations', () => {
  const route = prepareGeometry([[[0, 0], [0, 1], [1, 1]], [[1, 1], [2, 1]]]);
  const even = indexOfLocation({ kind: 'move', from: 0, to: 1, f: .5 });
  const odd = indexOfLocation({ kind: 'move', from: 1, to: 0, f: .5 });
  assert.deepEqual(coordinateAt(route, even), coordinateAt(route, odd));
  const half = coordinateAt(route, even);
  assert.ok(Math.abs(half[0]) < .001 && Math.abs(half[1] - 1) < .001);
  assert.equal(indexOfLocation({ kind: 'wait', idx: .35 }), .35);
  assert.deepEqual(coordinateAt(route, -.2), [0, 0]);
  assert.deepEqual(coordinateAt(route, 5), [2, 1]);
});

test('geography migration preserves occupied sidings, reservations and train routes', () => {
  const state = createState();
  state.stations[3].name = 'Казан';
  const tracks = JSON.stringify(state.stations.map(s => s.tracks));
  const trains = JSON.stringify(state.trains);
  refreshStationGeography(state);
  assert.equal(state.stations[3].name, 'Дария');
  assert.equal(JSON.stringify(state.stations.map(s => s.tracks)), tracks);
  assert.equal(JSON.stringify(state.trains), trains);
  assert.ok(state.groups.every(g => state.stations.some(s => s.name === g.origin)));
});
