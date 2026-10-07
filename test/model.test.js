import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, act, snapshot, advanceTime, tick, groupView, SPEEDS } from '../server/model.js';
import { nowMinutes } from '../server/dispatch.js';
import { autoEvents, dayStart } from '../server/world.js';

test('corridor automatic repair quota survives saved state and rolls over only at Almaty midnight', () => {
  const state = createState({ auto: { stations: true, intensity: 'high', approve: true } });
  state.autoBreakdownBudget = { day: dayStart(state.now), count: 2 };
  const restored = JSON.parse(JSON.stringify(state));
  const count = restored.incidents.filter(i => i.kind === 'breakdown').length;
  for (let i = 0; i < 50; i++) autoEvents(restored, 1);
  assert.equal(restored.incidents.filter(i => i.kind === 'breakdown').length, count);
  assert.equal(restored.autoBreakdownBudget.count, 2);
  restored.now = dayStart(restored.now) + 86400000;
  autoEvents(restored, 0);
  assert.equal(restored.autoBreakdownBudget.count, 0);
});

const quiet = () => createState({ auto: { stations: false, intensity: 'off', approve: false } });
const minutesNow = sn => (sn.now - sn.baseTime) / 60000;
const onLine = sn => sn.trains.filter(t => t.forecast[0][0] <= minutesNow(sn) && t.forecast.at(-1)[0] >= minutesNow(sn));
const eligibleGroup = sn => sn.groups.find(g => g.eligible && g.status === 'approaching');

test('scenario: ten stations, a rolling timetable with unique numbers and a group per freight train', () => {
  const sn = snapshot(quiet());
  assert.equal(sn.stations.length, 10);
  assert.ok(sn.trains.length > 0 && sn.trains.length <= 25, `поездов ${sn.trains.length}`);
  assert.equal(new Set(sn.trains.map(t => t.number)).size, sn.trains.length);
  assert.ok(onLine(sn).length >= 6, 'на линии есть поезда');
  assert.ok(sn.stations.every(s => s.tracks.length >= 2 && s.tracks.length <= 3));
  for (const t of sn.trains) {
    assert.equal(Number(t.number) % 2, t.route[0][1] < t.route.at(-1)[1] ? 0 : 1, `чётность ${t.number}`);
    assert.ok(t.route.every(([m], i) => i === 0 || m >= t.route[i - 1][0]));
    if (t.category === 'passenger') assert.equal(sn.groups.some(g => g.uid === t.uid), false);
    else assert.equal(sn.groups.filter(g => g.uid === t.uid).length, 1, `группа ${t.number}`);
  }
  assert.ok(sn.trains.some(t => t.category === 'passenger') && sn.trains.some(t => t.category === 'container') && sn.trains.some(t => t.kind === 'local'));
});

test('every train has characteristics, load and technical state', () => {
  const sn = snapshot(quiet());
  for (const t of sn.trains) {
    assert.ok(t.loco.series && t.loco.number && t.grossT > 0 && t.lengthM > 0 && t.avgKmh > 20 && t.maxKmh >= t.avgKmh, t.number);
    assert.ok(t.loadPct >= 0 && t.loadPct <= 100);
    assert.ok(t.techState.conditionPct >= 28 && t.techState.conditionPct <= 100);
    assert.ok(['в норме', 'скоро ТО', 'на ТО', 'ТО перед рейсом', 'ТО пройдено'].includes(t.techState.status), t.techState.status);
  }
  assert.ok(sn.trains.some(t => t.loco.type === 'тепловоз' && t.techState.fuelPct !== null));
});

test('maintenance: container trains need service before almost every run, and the run starts after it', () => {
  const sn = snapshot(quiet());
  const containers = sn.trains.filter(t => t.kind === 'container' && t.route[0][0] >= (sn.now - sn.baseTime) / 60000);
  assert.ok(containers.filter(t => t.service).length >= containers.length * 0.6, 'контейнерные часто на ТО');
  for (const t of sn.trains.filter(t => t.service)) {
    assert.equal(t.route[0][0], t.service.to, 'отправление сразу после ТО');
    assert.ok(t.service.to - t.service.from === t.tech.durationMin);
  }
  const t = containers.find(x => x.service);
  const state = quiet();
  state.now = state.origin + (t.service.from + 5) * 60000;
  const inService = snapshot(state).trains.find(x => x.uid === t.uid);
  assert.equal(inService.techState.status, 'на ТО');
});

test('timetable is continuous: three days pass with no gap, no duplicates and bounded size', () => {
  const state = quiet();
  const seen = new Set(state.trains.map(t => t.uid));
  for (let h = 0; h < 72; h++) {
    advanceTime(state, 60);
    const numbers = state.trains.map(t => t.number);
    assert.equal(new Set(numbers).size, numbers.length, `дубликаты в час ${h}`);
    assert.ok(state.trains.length > 0 && state.trains.length <= 25, `размер ${state.trains.length}`);
    for (const t of state.trains) seen.add(t.uid);
  }
  assert.ok(seen.size > state.trains.length * 2, 'появлялись новые поезда');
  assert.ok(state.groups.length < 400, 'группы не копятся бесконечно');
  const perTrain = new Map();
  for (const g of state.groups) perTrain.set(g.uid, (perTrain.get(g.uid) || 0) + 1);
  assert.ok([...perTrain.values()].every(n => n === 1), 'у каждого рейса ровно одна группа вагонов');
});

test('same start gives the same timetable (deterministic)', () => {
  const a = snapshot(quiet()).trains.map(t => [t.uid, t.route.at(-1)[0], t.loco.number, t.loadPct]);
  const b = snapshot(quiet()).trains.map(t => [t.uid, t.route.at(-1)[0], t.loco.number, t.loadPct]);
  assert.deepEqual(a, b);
});

test('stations: completion keeps wagons on the track until they are removed', () => {
  const state = quiet();
  const track = state.stations.flatMap(s => s.tracks).find(t => t.processing > 0);
  const before = track.processing + track.done + track.waiting;
  let sn = act(state, { type: 'complete', trackId: track.id });
  let tv = sn.stations.flatMap(s => s.tracks).find(t => t.id === track.id);
  assert.equal(tv.processing, 0);
  assert.equal(tv.occupied, before);
  sn = act(state, { type: 'clear', trackId: track.id });
  tv = sn.stations.flatMap(s => s.tracks).find(t => t.id === track.id);
  assert.ok(tv.done === 0 && tv.occupied < before || before === 0);
  assert.throws(() => act(state, { type: 'complete', trackId: track.id }), /Нет вагонов/);
  assert.throws(() => act(state, { type: 'clear', trackId: track.id }), /Нет обработанных/);
});

test('stations: reservation reduces availability, cancel restores it exactly, arrival needs reservation and ETA', () => {
  const state = quiet();
  advanceTime(state, 600);
  let sn = snapshot(state);
  const g = eligibleGroup(sn);
  assert.ok(g, 'есть группа, которую можно принять');
  const track = () => snapshot(state).stations.flatMap(s => s.tracks).find(t => t.id === g.suggestedTrack);
  const free = track().available;
  assert.throws(() => act(state, { type: 'arrive', groupId: g.id }), /Сначала зарезервируйте/);
  act(state, { type: 'reserve', groupId: g.id });
  assert.equal(track().available, free - g.count);
  assert.throws(() => act(state, { type: 'reserve', groupId: g.id }), /уже запланирована/);
  act(state, { type: 'cancel', groupId: g.id });
  assert.equal(track().available, free);
  act(state, { type: 'reserve', groupId: g.id });
  const eta = snapshot(state).groups.find(x => x.id === g.id).etaAt;
  if (state.now < eta) advanceTime(state, (eta - state.now) / 60000);
  const sn2 = act(state, { type: 'arrive', groupId: g.id });
  assert.equal(sn2.groups.find(x => x.id === g.id).status, 'arrived');
});

test('stations: accept takes a group that has arrived in one step and refuses early ones', () => {
  const state = quiet();
  const sn = snapshot(state);
  const early = sn.groups.find(g => g.eligible && g.etaAt > sn.now);
  assert.ok(early);
  assert.throws(() => act(state, { type: 'accept', groupId: early.id }), /ещё в пути/);
  advanceTime(state, 1200);
  const g = eligibleGroup(snapshot(state));
  const done = act(state, { type: 'accept', groupId: g.id });
  assert.equal(done.groups.find(x => x.id === g.id).status, 'arrived');
});

test('stations: automatic work accepts arrived groups and clears finished wagons', () => {
  const state = createState({ auto: { stations: true, intensity: 'off' } });
  advanceTime(state, 24 * 60);
  assert.ok(state.log.some(l => l.text.includes('принято автоматически')), 'группы принимаются сами');
  const sn = snapshot(state);
  const occ = sn.stations.reduce((n, s) => n + s.occupied, 0);
  const cap = sn.stations.reduce((n, s) => n + s.capacity, 0);
  assert.ok(occ > 0 && occ < cap, `загрузка путей ${occ}/${cap}`);
});

test('closure produces conflicts and variants; plan needs explicit confirmation', () => {
  const state = quiet();
  assert.throws(() => act(state, { type: 'approve' }), /Нет нового/);
  const snap = act(state, { type: 'block' });
  assert.equal(snap.dispatch.closures.length, 1);
  assert.equal(state.planApproved, false);
  assert.ok(snap.dispatch.conflicts.length > 0);
  assert.equal(snap.dispatch.variants.length, 3);
  assert.equal(snap.dispatch.variants.filter(v => v.recommended).length, 1);
  assert.equal(snap.dispatch.selected, snap.dispatch.recommendedId);
  act(state, { type: 'approve' });
  assert.equal(state.planApproved, true);
  assert.throws(() => act(state, { type: 'variant', variantId: 'fifo' }), /Нет варианта/);
  const open = act(state, { type: 'block' });
  assert.equal(open.dispatch.closures.length, 0);
  assert.equal(state.planApproved, false);
});

test('every variant keeps opposite trains off a shared segment at the same time', () => {
  const state = quiet();
  act(state, { type: 'close', segment: 4, track: 'even', minutes: 240 });
  for (const variant of snapshot(state).dispatch.variants) {
    state.variant = variant.id;
    state.planRev += 1;
    const sn = snapshot(state);
    const crossings = [];
    for (const t of sn.trains) {
      for (let k = 1; k < t.forecast.length; k++) {
        const [t0, i0] = t.forecast[k - 1], [t1, i1] = t.forecast[k];
        if (i0 !== i1 && Math.min(i0, i1) === 4) crossings.push({ dir: t.direction, enter: t0, exit: t1, n: t.number });
      }
    }
    const win = sn.dispatch.closures[0];
    for (const a of crossings) for (const b of crossings) {
      if (a.dir === b.dir || a.n >= b.n) continue;
      if (a.exit <= win.from || b.exit <= win.from || a.enter >= win.until || b.enter >= win.until) continue;
      assert.ok(a.exit <= b.enter || b.exit <= a.enter, `${variant.id}: №${a.n} и №${b.n} на перегоне одновременно`);
    }
  }
});

test('closing both tracks makes trains wait until the closure ends', () => {
  const state = quiet();
  const base = snapshot(state);
  const t = minutesNow(base);
  const crossing = base.trains.find(tr => tr.route.some(([m, i], k) => k && m > t + 20 && m < t + 90 && Math.min(i, tr.route[k - 1][1]) === 5 && Math.max(i, tr.route[k - 1][1]) === 6));
  assert.ok(crossing, 'есть поезд, идущий через F–G в ближайшие 1,5 часа');
  const sn = act(state, { type: 'close', segment: 5, track: 'both', minutes: 180 });
  const tr = sn.trains.find(x => x.number === crossing.number);
  const win = sn.dispatch.closures[0];
  const hop = tr.forecast.find(([, i], k) => k && i !== tr.forecast[k - 1][1] && Math.min(i, tr.forecast[k - 1][1]) === 5);
  assert.ok(tr.delay > 60, `задержка ${tr.delay}`);
  assert.ok(hop[0] >= win.until, 'вошёл на перегон только после снятия закрытия');
  assert.equal(sn.dispatch.conflicts.length, 0, 'при двух закрытых путях встречных конфликтов нет: ждут все');
  assert.throws(() => act(state, { type: 'close', segment: 5, track: 'both' }), /укажите длительность/);
  assert.throws(() => act(state, { type: 'close', segment: 99, track: 'odd' }), /перегон/);
  assert.throws(() => act(state, { type: 'close', segment: 1, track: 'sideways', minutes: 30 }), /Путь/);
});

test('speed restriction lengthens only trains crossing that segment and notifies passengers', () => {
  const state = quiet();
  assert.ok(snapshot(state).trains.every(t => t.delay === 0));
  const snap = act(state, { type: 'restrict', segment: 5, kmh: 25 });
  const crosses = t => t.route.some(([, i], k) => k && Math.min(i, t.route[k - 1][1]) === 5 && i !== t.route[k - 1][1]);
  const hit = snap.trains.filter(crosses);
  assert.ok(hit.length > 0 && hit.every(t => t.delay > 0));
  assert.ok(snap.trains.filter(t => !crosses(t)).every(t => t.delay === 0));
  assert.ok(snap.notifications.every(n => n.delay >= 5));
  const lifted = act(state, { type: 'unrestrict', segment: 5 });
  assert.ok(lifted.trains.every(t => t.delay === 0));
  for (const bad of [{ segment: 99, kmh: 25 }, { segment: 1, kmh: 5 }, { segment: 1, kmh: 80 }, { segment: 1.5, kmh: 40 }]) assert.throws(() => act(state, { type: 'restrict', ...bad }));
});

test('breakdown levels: speed cap, stop and go, train removed, both tracks closed', () => {
  const pick = (state, pred = () => true) => onLine(snapshot(state)).find(t => t.forecast.some(([, i]) => !Number.isInteger(i)) === false && pred(t));
  // 1 — лёгкая: без остановки, только ограничение
  let state = quiet();
  let train = pick(state, t => t.category !== 'passenger');
  let sn = act(state, { type: 'breakdown', train: train.number, level: 1, kind: 'overheat' });
  let after = sn.trains.find(t => t.number === train.number);
  assert.ok(after.delay > 0 && !after.disabled && sn.dispatch.closures.length === 0);
  assert.equal(after.broken.level, 1);
  // 2 — средняя: стоит и едет дальше
  state = quiet(); train = pick(state);
  sn = act(state, { type: 'breakdown', train: train.number, level: 2, kind: 'coupling' });
  after = sn.trains.find(t => t.number === train.number);
  assert.ok(after.delay >= 15 && after.delay <= 40 + 1 && !after.disabled, `задержка ${after.delay}`);
  assert.ok(after.forecast.some(([, i], k) => k && i === after.forecast[k - 1][1]), 'есть остановка');
  // 3 — тяжёлая: снят с рейса
  state = quiet(); train = pick(state);
  sn = act(state, { type: 'breakdown', train: train.number, level: 3, kind: 'loco' });
  after = sn.trains.find(t => t.number === train.number);
  assert.equal(after.disabled, true);
  assert.equal(after.delay, null);
  assert.equal(sn.dispatch.metrics.disabled, 1);
  // 4 — критическая: оба пути закрыты, если авария на перегоне
  state = quiet(); train = pick(state, t => !Number.isInteger(t.forecast[0][1]) || true);
  sn = act(state, { type: 'breakdown', train: train.number, level: 4, kind: 'derail' });
  after = sn.trains.find(t => t.number === train.number);
  assert.equal(after.disabled, true);
  assert.ok(sn.dispatch.closures.some(c => c.track === 'both'), 'закрыты оба пути');
  // проверки
  assert.throws(() => act(state, { type: 'breakdown', train: train.number, level: 1, kind: 'overheat' }), /уже случилась/);
  assert.throws(() => act(quiet(), { type: 'breakdown', train: '153', level: 9 }), /Уровень/);
  assert.throws(() => act(quiet(), { type: 'breakdown', train: '153', level: 4, kind: 'wheelset' }), /не бывает/);
  assert.throws(() => act(quiet(), { type: 'breakdown', train: 'nope', level: 1 }), /не найден/);
});

test('a breakdown that blocks a track is recoverable: resolve early and the closure goes away', () => {
  const state = quiet();
  const midline = onLine(snapshot(state)).find(t => {
    const loc = t.forecast.findIndex(([m]) => m > minutesNow(snapshot(state)));
    return loc > 0 && t.forecast[loc][1] !== t.forecast[loc - 1][1];
  });
  const sn = act(state, { type: 'breakdown', train: midline.number, level: 3, kind: 'loco' });
  const bd = sn.dispatch.closures.find(c => c.kind === 'breakdown');
  assert.ok(bd, 'путь на перегоне занят неисправным поездом');
  const done = act(state, { type: 'reopen', id: bd.id });
  const until = done.dispatch.closures.find(c => c.id === bd.id)?.until;
  assert.ok(until !== undefined && until - minutesNow(done) <= 10, 'устранение ускорено');
  advanceTime(state, 30);
  assert.equal(snapshot(state).dispatch.closures.some(c => c.id === bd.id), false);
});

test('dispatcher levers: hold shifts the train, expedite changes the plan, both can be undone', () => {
  const state = quiet();
  const train = onLine(snapshot(state)).find(t => t.category !== 'passenger' && t.route.at(-1)[0] - minutesNow(snapshot(state)) > 40);
  assert.throws(() => act(state, { type: 'hold', train: train.number, minutes: 7 }), /5, 10, 20 или 30/);
  const held = act(state, { type: 'hold', train: train.number, minutes: 20 }).trains.find(t => t.number === train.number);
  assert.equal(held.delay, 20);
  assert.ok(state.log[0].text.includes('Суммарная задержка'));
  assert.equal(act(state, { type: 'release', train: train.number }).trains.find(t => t.number === train.number).delay, 0);
  assert.throws(() => act(state, { type: 'release', train: train.number }), /нет задержки/);
  act(state, { type: 'block' });
  const lowest = snapshot(state).trains.find(t => t.priority === 3 && t.delay > 0);
  if (lowest) {
    const after = act(state, { type: 'expedite', train: lowest.number });
    assert.equal(after.trains.find(t => t.number === lowest.number).priority, 1);
    assert.throws(() => act(state, { type: 'expedite', train: lowest.number }), /уже/);
    assert.equal(act(state, { type: 'restore', train: lowest.number }).trains.find(t => t.number === lowest.number).priority, 3);
  }
});

test('clock: speeds are validated, real-time sync follows the wall clock, ticks advance time', () => {
  const state = quiet();
  for (const bad of [{ speed: 7 }, { speed: 'fast' }, { running: 'yes' }, { speed: 60, running: 'yes' }]) {
    const before = JSON.stringify(state);
    assert.throws(() => act(state, { type: 'clock', ...bad }));
    assert.equal(JSON.stringify(state), before);
  }
  assert.deepEqual(SPEEDS, [1, 60, 180, 600]);
  act(state, { type: 'clock', running: true, speed: 60 });
  const t0 = state.now;
  tick(state, 10);
  assert.equal(state.now - t0, 10 * 60_000, 'скорость ×60: секунда = минута');
  act(state, { type: 'clock', running: true, speed: 1 });
  const wall = state.now + 5 * 60_000;
  assert.throws(() => act(state, { type: 'clock', sync: true, wallMs: state.now - 3_600_000 }), /опережает/);
  act(state, { type: 'clock', sync: true, wallMs: wall });
  tick(state, 1, wall);
  assert.equal(state.now, wall, 'при синхронизации время равно реальному');
  state.running = false;
  const frozen = state.now;
  tick(state, 5);
  assert.equal(state.now, frozen);
});

test('automatic events: breakdowns, windows and restrictions appear on their own; the autopilot applies the plan', () => {
  const off = createState({ auto: { intensity: 'off' } });
  advanceTime(off, 24 * 60);
  assert.equal(off.incidents.length + off.restrictions.length, 0, 'при выключенных событиях тихо');
  const live = createState({ auto: { intensity: 'high', approve: true } });
  let breakdowns = 0, closures = 0, approved = false;
  for (let h = 0; h < 96; h++) {
    advanceTime(live, 60);
    breakdowns += live.log.filter(l => l.text.startsWith('Поломка:')).length ? 1 : 0;
    closures += live.incidents.some(i => i.track) ? 1 : 0;
    approved ||= live.log.some(l => l.text.includes('Автопилот применил'));
  }
  assert.ok(breakdowns > 0 && closures > 0, 'за четверо суток случаются поломки и закрытия');
  assert.ok(approved, 'автопилот подтвердил рекомендованный вариант');
  assert.ok(live.log.length <= 200);
});

test('state survives a JSON round trip (persistence)', () => {
  const state = createState({ auto: { intensity: 'normal' } });
  advanceTime(state, 300);
  act(state, { type: 'block' });
  const copy = JSON.parse(JSON.stringify(state));
  copy.planRev += 1;
  const a = snapshot(state), b = snapshot(copy);
  assert.equal(b.trains.length, a.trains.length);
  assert.equal(b.dispatch.closures.length, a.dispatch.closures.length);
  assert.deepEqual(b.dispatch.variants.map(v => v.metrics), a.dispatch.variants.map(v => v.metrics));
  advanceTime(copy, 600); // продолжает работать после загрузки
  assert.ok(copy.now > state.now);
});

test('invalid requests do not change state', () => {
  const state = quiet();
  const before = JSON.stringify(state);
  for (const action of [null, { type: 'unknown' }, { type: 'advance', minutes: -1 }, { type: 'clear', trackId: 'missing' }, { type: 'reserve', groupId: 'missing' }, { type: 'auto', intensity: 'extreme' }, { type: 'reopen', id: 'zz' }]) {
    assert.throws(() => act(state, action));
    assert.equal(JSON.stringify(state), before);
  }
});

test('missing cargo specialization has no fabricated delivery slack', () => {
  const state = quiet();
  const g = groupView(state, { ...state.groups[0], stationId: 'B', cargo: 'oil' });
  assert.equal(g.processingMinutes, null);
  assert.equal(g.slackMinutes, null);
  assert.equal(g.eligible, false);
  assert.equal(g.maxBatch, 0);
});

test('a train that has just arrived is not respawned and does not leave duplicate wagon groups', () => {
  const state = quiet();
  advanceTime(state, 4 * 24 * 60);
  for (const tpl of new Set(state.trains.map(t => t.number))) {
    assert.equal(state.groups.filter(g => g.train === tpl && g.status === 'approaching').length <= 2, true, `группы поезда ${tpl}`);
  }
  // сохранённое состояние с дублями чинится само
  const bad = JSON.parse(JSON.stringify(state));
  const g = bad.groups.find(x => x.status === 'approaching');
  for (let i = 0; i < 50; i++) bad.groups.push({ ...g, id: `${g.id}-dup${i}` });
  bad.planRev += 1;
  advanceTime(bad, 1);
  assert.equal(bad.groups.filter(x => x.uid === g.uid && x.status === 'approaching').length, 1);
});

test('autopilot does not fail when a heavy breakdown has outlived its closure', () => {
  const state = createState({ auto: { stations: true, intensity: 'off', approve: true } });
  const sn = snapshot(state);
  const t = sn.trains.find(x => x.forecast[0][0] <= minutesNow(sn) && x.forecast.at(-1)[0] > minutesNow(sn) + 120 && !x.service);
  act(state, { type: 'breakdown', train: t.number, level: 3, kind: 'loco' });
  assert.doesNotThrow(() => advanceTime(state, 8 * 60));
});
