import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Telemetry } from '../server/telemetry.js';
test('telemetry counts measured writes and errors without fabricating archive records', () => {
  const t = new Telemetry();
  try {
    assert.equal(t.measure('ok', () => 7), 7);
    assert.throws(() => t.measure('fail', () => { throw new Error('test'); }));
    t.write('Журнал', 128, 2); t.write('Состояние', 1000);
    const state = { trains: [], groups: [], incidents: [], now: 1 };
    const data = t.sample({ state, archive: { events: [{}, {}], file: 'private', through: 1 } });
    assert.equal(data.archive.records, 2); assert.equal(data.writes['Журнал'].records, 2);
    assert.equal(data.writes['Состояние'].records, 0); assert.equal(data.operations.find(r => r.name === 'fail').errors, 1);
    assert.ok(data.rates.writeBytes >= 0); assert.ok(data.memory.rss > 0);
    assert.ok(!JSON.stringify(data).includes('private'));
  } finally { t.close(); }
});
