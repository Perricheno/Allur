import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, LINKS, FLOW, linkRates } from '../public/js/engine-graph.js';

const sample = { trains: 684, moving: 556, incidents: 1, forced: 8, queue: 11, variantsCount: 3, recommendations: 8, shorten: 2, passengerForced: 1, eventsHour: 456 };

test('every link joins existing metrics and every metric has a flow rule', () => {
  const ids = new Set(STAGES.flatMap(s => s.rows.map(r => r.id)));
  for (const [a, b] of LINKS) { assert.ok(ids.has(a), a); assert.ok(ids.has(b), b); }
  for (const id of ids) assert.equal(typeof FLOW[id], 'function', `нет правила потока для ${id}`);
});

test('a node passes on exactly its own flow, split between outgoing links (one dot = one record)', () => {
  const rates = linkRates(sample);
  for (const id of new Set(LINKS.map(l => l[0]))) {
    const sent = LINKS.filter(l => l[0] === id).reduce((n, [a, b]) => n + rates.get(`${a}>${b}`), 0);
    assert.ok(Math.abs(sent - FLOW[id](sample)) < 1e-9, id);
  }
  const trainsOut = LINKS.filter(l => l[0] === 'trains').reduce((n, [a, b]) => n + rates.get(`${a}>${b}`), 0);
  assert.equal(trainsOut, 684);       // 684 поезда в секунду → 684 точки в секунду
});
