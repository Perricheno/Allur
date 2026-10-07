import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, snapshot, act, advanceTime } from '../server/model.js';
import { stationTraffic, blockOccupancy } from '../public/js/station-metrics.js';

test('arrival counts keep reserved groups and change occupancy only on admission', () => {
  const state = createState({ auto: { stations: false, intensity: 'off' } });
  advanceTime(state, 600);
  let data = snapshot(state);
  const g = data.groups.find(x => x.eligible && x.etaAt <= data.now);
  assert.ok(g, 'есть прибывшая группа, которую можно принять');
  const station = () => data.stations.find(s => s.id === g.stationId);
  const before = stationTraffic(data, g.stationId);
  const occupiedBefore = station().occupied;
  assert.ok(before.waiting >= 1 && before.waitingWagons >= g.count);
  data = act(state, { type: 'reserve', groupId: g.id });
  assert.equal(stationTraffic(data, g.stationId).waiting, before.waiting);
  assert.equal(station().occupied, occupiedBefore);
  data = act(state, { type: 'arrive', groupId: g.id });
  assert.equal(stationTraffic(data, g.stationId).waiting, before.waiting - 1);
  assert.equal(station().occupied, occupiedBefore + g.count);
});

test('offset train labels do not move block occupancy to the opposite track', () => {
  const base = { loc: { kind: 'move', f: .4 }, segment: 3, odd: true, wrong: false, y: 152 };
  assert.deepEqual([...blockOccupancy([base])], ['o:3:1']);
  assert.deepEqual([...blockOccupancy([{ ...base, wrong: true }])], ['e:3:1']);
  assert.equal(blockOccupancy([{ ...base, loc: { kind: 'wait' } }]).size, 0);
});
