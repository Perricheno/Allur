import test from 'node:test';
import assert from 'node:assert/strict';
import { FactoryModel } from '../../server/allur/engine.js';
import { AREA_IDS, FACTORS, CASE_DATA } from '../../server/allur/config.js';
import { compareScenarios } from '../../server/allur/scenarios.js';
const stable = { 'maintenance.breakdownsEnabled': 0, 'logistics.deliveryReliability': 1, ...Object.fromEntries(AREA_IDS.map(id => [`lines.${id}.defectRate`, 0])) };
const create = factors => new FactoryModel({ factors: { ...stable, ...factors } });
function assertBalance(model) {
  const snap = model.snapshot(); assert.equal(snap.conservation.balanced, true);
  const ids = snap.units.map(unit => unit.id); assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, snap.conservation.active + snap.conservation.finishedStock);
  for (const value of Object.values(snap.inventory)) assert.ok(Number.isFinite(value) && value >= 0);
  for (const area of snap.areas) assert.ok(area.queue.count <= area.queue.capacity);
  assert.ok(snap.finishedStock.count <= snap.finishedStock.capacity);
}

test('historical records preserve facts and explicitly retain missing data', () => {
  assert.equal(CASE_DATA.records.length, 6); assert.equal(CASE_DATA.incidents.length, 4);
  assert.equal(CASE_DATA.records[4].defects, 6); assert.equal(CASE_DATA.records[4].defectRate, 6 / 116);
  assert.ok(CASE_DATA.records.every(record => record.oee === null));
  assert.equal(CASE_DATA.monthlyTarget - Object.values(CASE_DATA.modelPlans).reduce((a, b) => a + b), 700);
  assert.ok(Object.keys(FACTORS).length > 100);
});

test('same seed, checkpoint restoration and different tick partitioning preserve physical state', () => {
  const a = new FactoryModel({ seed: 731 }); a.advance(2700);
  const b = new FactoryModel({ state: a.exportState() });
  a.advance(3600); b.advance(3600); assert.deepEqual(a.exportState(), b.exportState());
  const c = new FactoryModel({ seed: 731 }); c.advance(6300);
  const state = c.exportState(); state.revision = a.s.revision; assert.deepEqual(a.exportState(), state);
});

test('mass and material balances survive defects, rework, repairs and blocked dispatch', () => {
  const m = new FactoryModel({ seed: 52, factors: { 'lines.paint.defectRate': .4, 'lines.welding.defectRate': .2, 'logistics.dispatchEnabled': 0, 'logistics.finishedCapacity': 8, 'rework.capacity': 3 } });
  for (let i = 0; i < 16; i++) { m.advance(1800); assertBalance(m); }
  assert.ok(m.s.totals.reworkStarted > 0); assert.ok(m.s.totals.scrapped > 0);
  assert.ok(m.s.lines.finished.stats.blockedSeconds > 0);
  for (const model of ['onix', 'cobalt', 'j7']) assert.equal(m.s.config.inventory[model] + (m.s.totals.materialReceived[model] || 0) - m.s.models[model].started, m.s.inventory[model]);
  assert.equal(m.s.totals.produced, m.s.goods.length + m.s.totals.shipped);
});

test('paint outage creates upstream blocking and downstream starvation', () => {
  const m = create(); m.action({ type: 'failure', area: 'paint', minutes: 60 }); m.advance(3000);
  assert.equal(m.s.lines.paint.status, 'down'); assert.ok(m.s.lines.welding.stats.blockedSeconds > 0);
  assert.ok(m.s.lines.assembly.stats.starvedSeconds > 0); assertBalance(m);
  m.advance(1800); assert.equal(m.s.lines.paint.repair, null); assert.ok(m.s.lines.paint.stats.completed > 0); assertBalance(m);
});

test('assembly shortages cannot consume missing materials and delivery resumes the flow', () => {
  const m = create({ 'inventory.wheels': 0, 'logistics.deliveryBatch': 0 }); m.advance(7200);
  assert.equal(m.s.lines.assembly.status, 'material_shortage'); assert.equal(m.s.lines.assembly.stats.completed, 0);
  assert.equal(m.s.inventory.engines, m.s.config.inventory.engines);
  m.action({ type: 'deliver', materials: { wheels: 80 } }); m.advance(1800);
  assert.ok(m.s.lines.assembly.stats.completed > 0); assertBalance(m);
});

test('repair queues obey crew capacity and spare inventory', () => {
  const m = create({ 'maintenance.crews': 1, 'maintenance.sparesInitial': 0 });
  m.action({ type: 'failure', area: 'paint', minutes: 2 }); m.action({ type: 'failure', area: 'assembly', minutes: 2 }); m.advance(30);
  assert.ok(m.s.incidents.every(i => i.state === 'waiting_parts'));
  m.action({ type: 'replenish_spares', count: 1 }); m.advance(30);
  assert.equal(Object.values(m.s.lines).filter(line => line.repair?.active).length, 1); assert.equal(m.s.spares, 0);
  m.advance(180); assert.equal(m.s.incidents.filter(i => i.state === 'resolved').length, 1);
  assert.equal(m.s.incidents.filter(i => i.state === 'waiting_parts').length, 1);
});

test('planned breaks exclude time from OEE and each planned second has exactly one loss category', () => {
  const m = create(); m.advance(13500); assert.equal(m.calendar().onBreak, true);
  const before = m.s.lines.paint.stats.plannedSeconds; m.advance(1800);
  assert.ok(m.s.lines.paint.stats.plannedSeconds - before <= 1);
  m.advance(28800 - m.s.elapsed); assert.equal(m.calendar().shift, 2);
  const snap = m.snapshot();
  for (const area of snap.areas) {
    const s = area.stats;
    assert.equal(s.plannedSeconds, s.workingSeconds + s.downSeconds + s.starvedSeconds + s.blockedSeconds + s.materialSeconds + s.changeoverSeconds + s.staffSeconds + s.powerSeconds);
    if (area.metrics.oee !== null) assert.ok(Math.abs(area.metrics.oee - area.metrics.availability * area.metrics.performance * area.metrics.quality) < 1e-12);
    assert.ok(area.metrics.performance === null || area.metrics.performance <= 1 + 1e-9);
  }
  assert.equal(snap.kpis.factoryOee, null);
});

test('grid outage stops progress, power cap constrains total energy, lower staffing reduces output', () => {
  const off = create({ 'utilities.gridAvailability': 0 }); off.advance(1800);
  assert.equal(off.s.totals.energyKwh, 0); assert.equal(off.s.lines.supply.job, null);
  const capped = create({ 'utilities.powerLimitKw': 300 }); capped.advance(7200);
  assert.ok(capped.s.totals.energyKwh <= 300 * 2 + 1e-6);
  const base = create(), short = create({ 'lines.assembly.staffAvailable': 8 }); base.advance(14400); short.advance(14400);
  assert.ok(short.s.totals.produced < base.s.totals.produced); assertBalance(short);
});

test('filter service lowers wear and paint defect risk; the maintenance stop itself costs time', () => {
  const m = create({ 'lines.paint.initialWear': .8, 'lines.paint.initialFilterLoad': .9, 'lines.paint.defectRate': .05 });
  const before = m.conditions('paint').defectProbability;
  m.action({ type: 'maintenance', area: 'paint', minutes: 2 }); m.advance(130);
  assert.ok(m.conditions('paint').defectProbability < before); assert.ok(m.s.lines.paint.stats.downSeconds >= 119);
  assert.equal(m.s.lines.paint.stats.failures, 0);
});

test('configuration and commands reject invalid values without partial mutation', () => {
  const m = create(), before = m.exportState();
  for (const factors of [{ 'unknown.value': 1 }, { 'toString': 1 }, { 'lines.paint.staffAvailable': -1 }, { 'lines.paint.cycleSeconds': 50 }, { 'calendar.shiftsPerDay': 3, 'calendar.shiftHours': 12 }, { 'inventory.wheels': 0 }, { 'mix.onix': 0, 'mix.cobalt': 0, 'mix.j7': 0 }]) assert.throws(() => m.action({ type: 'configure', factors }));
  assert.throws(() => m.action({ type: 'deliver', materials: { wheels: -1 } }));
  assert.throws(() => m.action({ type: 'failure', area: 'paint', equipment: 'ABB-01', minutes: 30 }));
  assert.deepEqual(m.exportState(), before);
});

test('scheduled events execute on model time and invalid actions are rejected', () => {
  const m = create(); m.action({ type: 'schedule', at: 300, command: { type: 'failure', area: 'assembly', minutes: 5 } });
  m.advance(299); assert.equal(m.s.lines.assembly.repair, null); m.advance(1); assert.ok(m.s.lines.assembly.repair);
  assert.equal(m.s.scheduled.length, 0);
  assert.throws(() => m.action({ type: 'schedule', at: 600, command: { type: 'reset' } }));
});

test('paired scenario comparison is isolated, repeatable, and measures changes against baseline', () => {
  const m = create(); m.advance(1800); const before = m.exportState();
  const options = { variants: ['dispatch-stop', 'power-limit'], horizonSeconds: 14400, seeds: [7, 8] };
  const a = compareScenarios(before, options), b = compareScenarios(before, options);
  assert.deepEqual(a, b); assert.deepEqual(m.exportState(), before);
  assert.equal(a.results[0].delta.produced.median, 0); assert.ok(a.results[1].delta.shipped.median < 0);
  for (const result of a.results) { assert.ok(result.runs.every(run => run.balanced)); assert.ok(result.summary.downtimeMinutes.min >= 0); assert.ok(result.runs.every(run => AREA_IDS.includes(run.bottleneck.area))); }
});

test('shift output resets at the boundary without losing cumulative totals', () => {
  const m = create(); m.advance(28800);
  const atBoundary = m.snapshot();
  assert.equal(atBoundary.planning.shiftProduced, 0);
  assert.ok(atBoundary.totals.produced > 0);
  assert.equal(atBoundary.planning.shiftStartElapsed, 28800);
  m.advance(3600); const after = m.snapshot();
  assert.equal(after.planning.shiftProduced, after.totals.produced - atBoundary.totals.produced);
});
