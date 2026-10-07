import { getPlan, touchPlan, directionOf, prioOf, nowMinutes, activeClosures, locateAt, CLOSED_SEGMENT, NOTIFY_THRESHOLD, PRIORITY_NAMES } from './dispatch.js';
import {
  STATIONS, DAY, cargoNames, dayStart, event, createStations, ensureTrains, completeOperations, clearTrack, stationOps,
  createBreakdown, createClosure, expireIncidents, autoEvents, autopilot, BREAKDOWN_LEVELS, BREAKDOWN_TYPES, INTENSITIES,
} from './world.js';
export { cargoNames, BREAKDOWN_LEVELS, BREAKDOWN_TYPES, STATIONS };

/** Момент по умолчанию для детерминированных проверок и песочницы: 1 октября 2026, 09:00 (Алматы). */
export const BASE_TIME = Date.parse('2026-10-01T09:00:00+05:00');
const minute = 60_000;
const hour = 3_600_000;
/** Скорость времени относительно реального: 1 — реальный ход. */
export const SPEEDS = [1, 60, 180, 600];

export function createState({ now = BASE_TIME, auto = {} } = {}) {
  const state = {
    now, origin: dayStart(now), revision: 0, running: false, speed: 1, synced: false, seed: 20261001, seq: 0, planRev: 0,
    holds: [], overrides: {}, seen: {}, stations: createStations(null, now), trains: [], groups: [], incidents: [], restrictions: [],
    planApproved: false, variant: null, awaitingSince: null, notified: {}, notifications: [], tech: {},
    auto: { stations: true, intensity: 'off', approve: false, ...auto },
    log: [{ at: now, text: 'Система запущена: расписание строится непрерывно, поезда появляются и уходят сами.' }],
  };
  ensureTrains(state);
  return state;
}

export function occupied(track) { return track.processing + track.done + track.waiting; }
export function reservedFor(state, trackId) {
  return state.groups.filter(g => g.status === 'reserved' && g.trackId === trackId).reduce((sum, g) => sum + g.count, 0);
}
export function trackView(state, track) {
  const occupiedCount = occupied(track);
  const reserved = reservedFor(state, track.id);
  return { ...track, occupied: occupiedCount, reserved, free: track.capacity - occupiedCount,
    available: Math.max(0, track.capacity - occupiedCount - reserved),
    releaseAt: occupiedCount ? Math.max(state.now, track.processing ? track.finishAt : state.now) + (30 + Math.ceil(track.waiting / track.front) * (track.duration + 30)) * minute : null,
  };
}
export function groupView(state, group, plan = getPlan(state)) {
  const station = state.stations.find(s => s.id === group.stationId);
  const tracks = station.tracks.filter(t => t.cargo === group.cargo).map(t => trackView(state, t));
  const operationMinutes = t => Math.ceil(group.count / t.front) * (t.duration + 30);
  const matching = tracks.filter(t => t.available >= group.count).sort((a, b) => operationMinutes(a) - operationMinutes(b) || a.number - b.number);
  const best = matching[0];
  const assigned = tracks.find(t => t.id === group.trackId);
  const processingMinutes = assigned ? operationMinutes(assigned) : best ? operationMinutes(best) : tracks.length ? Math.min(...tracks.map(operationMinutes)) : null;
  const entry = plan.byTrain[group.train];
  const lost = entry && entry.delay === null && group.status === 'approaching';
  const delay = lost ? 12 * 60 : entry?.delay || 0;
  const etaAt = group.etaAt + delay * minute;
  const slackMinutes = processingMinutes === null ? null : Math.floor((group.deadlineAt - Math.max(state.now, etaAt)) / minute - processingMinutes);
  const eligible = group.status === 'approaching' && Boolean(best) && !lost;
  return { ...group, etaAt, delayMinutes: delay, slackMinutes, processingMinutes, eligible, lost: Boolean(lost),
    suggestedTrack: best?.id ?? null,
    available: tracks.reduce((n, t) => n + t.available, 0),
    maxBatch: Math.max(0, ...tracks.map(t => t.available)),
    reason: group.status === 'reserved' ? `Зарезервирован путь ${group.trackId.split('-')[1]}`
      : group.status === 'arrived' ? 'Группа принята на подъездной путь'
      : lost ? 'Поезд снят с рейса из-за поломки: вагоны будут доставлены отдельным составом.'
      : best ? `Путь ${best.number}: доступно ${best.available} ваг. · обработка ≈ ${processingMinutes} мин`
      : 'Нет пути для всей группы. Ожидать освобождения; группу не делим.',
  };
}

/** Техническое состояние поезда на момент state.now. */
function techView(state, train, forecast) {
  const t = nowMinutes(state);
  const depMs = state.origin + forecast[0][0] * minute;
  const hoursSince = Math.max(0, (state.now - train.tech.lastServiceAt) / hour);
  const due = Math.max(0, train.tech.intervalH - hoursSince);
  let status = 'в норме';
  if (train.service && t >= train.service.from && t < train.service.to) status = 'на ТО';
  else if (train.service && t < train.service.from) status = 'ТО перед рейсом';
  else if (train.service && state.now < depMs + 6 * hour) status = 'ТО пройдено';
  else if (due < train.tech.intervalH * 0.12) status = 'скоро ТО';
  const total = forecast.at(-1)[0] - forecast[0][0];
  const progress = Math.min(1, Math.max(0, (t - forecast[0][0]) / Math.max(1, total)));
  const onDuty = train.crewPriorHours + Math.max(0, (state.now - depMs) / hour);
  return {
    hoursSince: Math.round(hoursSince * 10) / 10, nextDueH: Math.round(due * 10) / 10, status, progress,
    conditionPct: Math.max(28, Math.min(100, Math.round(100 - 38 * Math.min(1.3, hoursSince / train.tech.intervalH) - train.healthJitter))),
    fuelPct: train.loco.type === 'тепловоз' ? Math.max(8, Math.round(100 - progress * 46 - train.healthJitter)) : null,
    crewOnDutyH: Math.round(onDuty * 10) / 10, crewRestInH: Math.max(0, Math.round((12 - onDuty) * 10) / 10),
  };
}

/** Загрузка перегонов: доля пропускной способности (10 поездов в час на путь), занятая поездами на ближайший час. */
function sectionLoad(state, plan) {
  const t = nowMinutes(state);
  return Array.from({ length: STATIONS.length - 1 }, (_, seg) => {
    let n = 0;
    for (const tr of state.trains) {
      const pts = plan.byTrain[tr.number].forecast;
      for (let k = 1; k < pts.length; k++) {
        if (pts[k - 1][1] !== pts[k][1] && Math.floor(Math.min(pts[k - 1][1], pts[k][1])) === seg && pts[k][0] > t && pts[k - 1][0] < t + 60) { n += 1; break; }
      }
    }
    return { segment: seg, trains: n, load: Math.min(100, Math.round(n / 14 * 100)) };
  });
}

export function snapshot(state) {
  const stations = state.stations.map(station => {
    const tracks = station.tracks.map(t => trackView(state, t));
    const sums = ['capacity', 'front', 'processing', 'done', 'waiting', 'occupied', 'reserved', 'available'].reduce((a, key) => {
      a[key] = tracks.reduce((sum, t) => sum + t[key], 0); return a;
    }, {});
    return { ...station, tracks, ...sums };
  });
  const plan = getPlan(state);
  const groups = state.groups.map(g => groupView(state, g, plan)).sort((a, b) => (a.slackMinutes ?? Infinity) - (b.slackMinutes ?? Infinity) || a.id.localeCompare(b.id));
  const trains = state.trains.map(t => {
    const entry = plan.byTrain[t.number];
    const bd = state.incidents.find(i => i.kind === 'breakdown' && i.train === t.number);
    return { ...t, priority: prioOf(state, t), basePriority: t.priority, overridden: t.number in state.overrides, direction: directionOf(t),
      forecast: entry.forecast, delay: entry.delay, disabled: entry.delay === null, techState: techView(state, t, entry.forecast),
      broken: bd ? { id: bd.id, level: bd.level, type: bd.type, label: bd.label, from: bd.from, until: bd.level >= 2 ? bd.from + bd.duration : null, auto: bd.auto } : null };
  });
  const { byTrain, closures, ...dispatch } = plan;
  const closureInfo = closures.map(c => ({ ...c, from: c.from, planned: c.from > nowMinutes(state) }));
  return { ...state, baseTime: state.origin, blocked: closureInfo.length > 0, trains, stations, groups, cargoNames, priorityNames: PRIORITY_NAMES,
    breakdownLevels: BREAKDOWN_LEVELS, breakdownTypes: BREAKDOWN_TYPES, intensities: INTENSITIES, sections: sectionLoad(state, plan),
    dispatch: { ...dispatch, closures: closureInfo, closedSegment: closureInfo[0]?.segment ?? CLOSED_SEGMENT, selected: dispatch.selectedId, approved: state.planApproved } };
}

function assert(condition, message) { if (!condition) throw new Error(message); }
const clock = (state, ms) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }).format(ms);

// Пассажирам уходит уведомление, когда прогноз опоздания заметно изменился (и план не ждёт подтверждения).
function notifyPassengers(state) {
  if (activeClosures(state).length && !state.planApproved) return;
  const plan = getPlan(state);
  for (const train of state.trains) {
    if (prioOf(state, train) !== 1 || train.category !== 'passenger') continue;
    const delay = plan.byTrain[train.number].delay;
    const last = state.notified[train.number] || 0;
    const dest = state.stations[train.route.at(-1)[1]].name;
    if (delay === null) {
      if (last === -1) continue;
      state.notified[train.number] = -1;
      state.notifications.unshift({ at: state.now, train: train.number, delay: null, text: `Поезд №${train.number}: рейс прерван из-за неисправности. Пассажирам организуется пересадка, время прибытия на станцию «${dest}» уточняется.` });
      continue;
    }
    if (Math.abs(delay - last) < NOTIFY_THRESHOLD && !(delay === 0 && last > 0)) continue;
    const arrival = clock(state, state.origin + (train.route.at(-1)[0] + delay) * minute);
    state.notified[train.number] = delay;
    const text = delay > 0
      ? `Поезд №${train.number}: прибытие на станцию «${dest}» ожидается в ${arrival}, опоздание ${delay} мин.`
      : `Поезд №${train.number}: движение восстановлено, прибытие на станцию «${dest}» по расписанию.`;
    state.notifications.unshift({ at: state.now, train: train.number, delay, text });
  }
  state.notifications = state.notifications.slice(0, 50);
}

function acceptGroup(state, g, quiet) {
  const station = state.stations.find(s => s.id === g.stationId);
  const view = groupView(state, g);
  const t = station.tracks.find(x => x.id === view.suggestedTrack);
  const start = Math.min(g.count, Math.max(0, t.front - t.processing - t.done));
  if (start && !t.processing) t.finishAt = state.now + t.duration * minute;
  else if (start) t.finishAt = Math.max(t.finishAt, state.now + t.duration * minute);
  t.processing += start; t.waiting += g.count - start; g.status = 'arrived'; g.trackId = t.id; g.arrivedAt = state.now;
  event(state, `${station.name}: ${quiet ? 'принято автоматически' : 'принято'} ${g.count} ваг. группы №${g.train} на путь ${t.number}; ${start} подано на грузовой фронт.`);
}

function approvePlan(state, auto) {
  state.planApproved = true;
  const plan = getPlan(state);
  const variant = plan.variants.find(v => v.id === plan.selectedId);
  if (!variant) return;
  event(state, `${auto ? 'Автопилот применил рекомендованный' : 'Диспетчер подтвердил'} вариант «${variant.name}»: суммарная задержка ${variant.metrics.total} мин, пассажирских ${variant.metrics.passenger} мин.`);
  notifyPassengers(state);
}

/** Один шаг модельного времени (не больше минуты): поезда, станции, события. */
function step(state, dtMin) {
  state.now += dtMin * minute;
  let changed = ensureTrains(state);
  if (completeOperations(state)) changed = true;
  if (expireIncidents(state)) { changed = true; notifyPassengers(state); }
  if (autoEvents(state, dtMin)) { changed = true; }
  if (autopilot(state, approvePlan)) changed = true;
  if (stationOps(state, (st, g) => acceptGroup(st, g, true), groupView)) changed = true;
  if (changed) state.revision += 1;
  return changed;
}

/** Продвинуть модельное время на minutes минут (шагами по минуте). Возвращает true, если данные изменились. */
export function advanceTime(state, minutes) {
  let left = minutes, changed = false;
  while (left > 1e-9) { const dt = Math.min(1, left); left -= dt; if (step(state, dt)) changed = true; }
  return changed;
}

/** Ход модельного времени: вызывается сервером каждую секунду. wallMs — реальное время для режима синхронизации. */
export function tick(state, seconds = 1, wallMs = Date.now()) {
  if (!state.running) return false;
  const minutes = state.synced && state.speed === 1 ? Math.max(0, (wallMs - state.now) / minute) : seconds * state.speed / 60;
  return advanceTime(state, minutes);
}


export function act(state, action) {
  assert(action && typeof action === 'object', 'Некорректное действие');
  if (action.type === 'advance') {
    assert([15, 30, 60].includes(action.minutes), 'Допустим шаг 15, 30 или 60 минут');
    advanceTime(state, action.minutes);
    state.synced = false;
    event(state, `Время модели: +${action.minutes} мин. Завершённые операции учтены; вагоны ожидают уборки.`);
  } else if (action.type === 'complete' || action.type === 'clear') {
    const station = state.stations.find(s => s.tracks.some(t => t.id === action.trackId));
    const t = station?.tracks.find(t => t.id === action.trackId);
    assert(t, 'Путь не найден');
    if (action.type === 'complete') {
      assert(t.processing > 0, 'Нет вагонов под грузовыми операциями');
      const count = t.processing; t.done += count; t.processing = 0; t.doneAt = state.now;
      event(state, `${station.name}, путь ${t.number}: обработано ${count} ваг. Для освобождения пути требуется уборка.`);
    } else {
      assert(t.done > 0, 'Нет обработанных вагонов для уборки');
      const count = clearTrack(state, station, t);
      event(state, `${station.name}, путь ${t.number}: убрано ${count} ваг., физическая ёмкость освобождена.`);
    }
  } else if (['reserve', 'cancel', 'arrive'].includes(action.type)) {
    const g = state.groups.find(g => g.id === action.groupId);
    assert(g, 'Группа вагонов не найдена');
    const station = state.stations.find(s => s.id === g.stationId);
    if (action.type === 'reserve') {
      assert(g.status === 'approaching', 'Группа уже запланирована');
      const suggestion = groupView(state, g);
      assert(suggestion.eligible, 'Недостаточно свободной ёмкости на подходящем пути');
      g.trackId = suggestion.suggestedTrack; g.status = 'reserved';
      event(state, `${station.name}: диспетчер зарезервировал ${g.count} мест на пути ${g.trackId.split('-')[1]} для группы №${g.train}.`);
    } else if (action.type === 'cancel') {
      assert(g.status === 'reserved', 'Можно отменить только резерв');
      g.status = 'approaching'; g.trackId = null;
      event(state, `${station.name}: резерв группы №${g.train} отменён.`);
    } else {
      assert(g.status === 'reserved', 'Сначала зарезервируйте путь');
      assert(groupView(state, g).etaAt <= state.now, 'Группа ещё в пути: ожидайте прогнозного прибытия');
      const t = station.tracks.find(t => t.id === g.trackId);
      assert(t.capacity - occupied(t) >= g.count, 'Путь занят, приём невозможен');
      const start = Math.min(g.count, Math.max(0, t.front - t.processing - t.done));
      if (start && !t.processing) t.finishAt = state.now + t.duration * minute;
      else if (start) t.finishAt = Math.max(t.finishAt, state.now + t.duration * minute);
      t.processing += start; t.waiting += g.count - start; g.status = 'arrived'; g.arrivedAt = state.now;
      event(state, `${station.name}: принято ${g.count} ваг. группы №${g.train} на путь ${t.number}; ${start} подано на грузовой фронт.`);
    }
  } else if (action.type === 'hold' || action.type === 'release' || action.type === 'expedite' || action.type === 'restore') {
    const train = state.trains.find(t => t.number === action.train);
    assert(train, 'Поезд не найден');
    const before = getPlan(state).metrics;
    let text;
    if (action.type === 'hold') {
      assert([5, 10, 20, 30].includes(action.minutes), 'Задержка: 5, 10, 20 или 30 минут');
      const forecast = getPlan(state).byTrain[train.number].forecast;
      const tNow = nowMinutes(state);
      assert(tNow < forecast.at(-1)[0], 'Поезд уже прибыл');
      const ahead = tNow < forecast[0][0] ? forecast[0] : forecast.find(([m, i]) => m > tNow && Number.isInteger(i));
      assert(ahead && ahead !== forecast.at(-1), 'Дальше только конечная станция: задерживать некуда');
      state.holds = state.holds.filter(h => !(h.train === train.number && h.station === ahead[1]));
      assert(state.holds.length < 8, 'Не больше восьми задержек одновременно');
      state.holds.push({ train: train.number, station: ahead[1], minutes: action.minutes });
      text = `№${train.number} задержан на станции «${state.stations[ahead[1]].name}» на ${action.minutes} мин по решению диспетчера.`;
    } else if (action.type === 'release') {
      assert(state.holds.some(h => h.train === train.number), 'У этого поезда нет задержки');
      state.holds = state.holds.filter(h => h.train !== train.number);
      text = `Задержка №${train.number} снята.`;
    } else if (action.type === 'expedite') {
      assert(train.priority > 1 && !(train.number in state.overrides), 'Поезд уже пропускается первым');
      state.overrides[train.number] = 1;
      text = `№${train.number} (${train.label}) пропускается первым: приоритет повышен до пассажирского.`;
    } else {
      assert(train.number in state.overrides, 'Приоритет не менялся');
      delete state.overrides[train.number];
      text = `Приоритет №${train.number} возвращён к исходному.`;
    }
    touchPlan(state);
    const after = getPlan(state).metrics;
    const d = after.total - before.total;
    event(state, `${text} Суммарная задержка поездов: ${before.total} → ${after.total} мин (${d > 0 ? '+' : ''}${d}).`);
    notifyPassengers(state);
  } else if (action.type === 'accept') {
    const g = state.groups.find(g => g.id === action.groupId);
    assert(g, 'Группа вагонов не найдена');
    const view = groupView(state, g);
    assert(g.status === 'approaching', 'Группа уже запланирована');
    assert(view.etaAt <= state.now, 'Группа ещё в пути: ожидайте прибытия');
    assert(view.eligible, 'Нет свободной ёмкости на подходящем пути');
    act(state, { type: 'reserve', groupId: g.id });
    act(state, { type: 'arrive', groupId: g.id });
  } else if (action.type === 'clock') {
    if (action.speed !== undefined) assert(SPEEDS.includes(action.speed), 'Скорость времени: 1 (реальная), 60, 180 или 600');
    if (action.running !== undefined) assert(typeof action.running === 'boolean', 'Некорректное действие');
    if (action.sync !== undefined) {
      assert(action.sync === true, 'Некорректное действие');
      assert(state.now <= (action.wallMs ?? Date.now()) + 1000, 'Модельное время опережает реальное: вернуться назад можно только сбросом модели');
    }
    if (action.speed !== undefined) { state.speed = action.speed; if (action.speed > 1) state.synced = false; }
    if (action.running !== undefined) state.running = action.running;
    if (action.sync) { state.synced = true; state.speed = 1; }
    state.revision += 1;
  } else if (action.type === 'auto') {
    if (action.intensity !== undefined) assert(INTENSITIES.includes(action.intensity), 'Интенсивность: off, low, normal или high');
    for (const key of ['stations', 'approve']) if (action[key] !== undefined) assert(typeof action[key] === 'boolean', 'Некорректное действие');
    for (const key of ['intensity', 'stations', 'approve']) if (action[key] !== undefined) state.auto[key] = action[key];
    event(state, `Автоматика: события — ${{ off: 'выключены', low: 'редкие', normal: 'обычные', high: 'частые' }[state.auto.intensity]}, работа станций — ${state.auto.stations ? 'включена' : 'выключена'}, автопилот — ${state.auto.approve ? 'включён' : 'выключен'}.`);
  } else if (action.type === 'block') {
    const existing = state.incidents.find(i => i.legacy);
    if (existing) {
      state.incidents = state.incidents.filter(i => i !== existing);
      if (!activeClosures(state).length) { state.planApproved = false; state.variant = null; state.awaitingSince = null; }
      touchPlan(state);
      event(state, 'Перегон D–E открыт. Восстановлен исходный прогноз движения.');
    } else {
      const c = createClosure(state, { segment: CLOSED_SEGMENT, track: 'odd', label: 'Сход подвижного состава' });
      c.legacy = true;
      const plan = getPlan(state);
      event(state, `Закрыт нечётный путь перегона D–E (сход подвижного состава). Встречных конфликтов: ${plan.conflicts.length}. Рекомендуемый вариант: «${plan.variants.find(v => v.recommended).name}».`);
    }
    notifyPassengers(state);
  } else if (action.type === 'close') {
    const c = createClosure(state, { segment: action.segment, track: action.track, minutes: action.minutes ?? null, label: 'Закрытие пути диспетчером' });
    const plan = getPlan(state);
    const tr = { odd: 'нечётный путь', even: 'чётный путь', both: 'оба пути' }[c.track];
    event(state, `Закрыт ${tr} перегона ${STATIONS[c.segment][0]}–${STATIONS[c.segment + 1][0]}${c.until == null ? '' : ` на ${action.minutes} мин`}. Конфликтов: ${plan.conflicts.length}. Рекомендуемый вариант: «${plan.variants.find(v => v.recommended).name}».`);
    notifyPassengers(state);
  } else if (action.type === 'reopen') {
    const inc = state.incidents.find(i => i.id === action.id);
    assert(inc, 'Происшествие не найдено');
    const t = nowMinutes(state);
    if (inc.kind === 'breakdown') {
      assert(inc.level >= 2, 'Лёгкая неисправность устраняется сама до конца рейса');
      inc.duration = Math.max(3, Math.ceil(t - inc.from) + 3);
      inc.until = inc.from + inc.duration;
      event(state, `${inc.label}: резервный локомотив и бригада на месте, неисправность устраняется досрочно.`);
    } else {
      state.incidents = state.incidents.filter(i => i !== inc);
      event(state, `${inc.label}: закрытие снято диспетчером.`);
    }
    if (!activeClosures(state).length) { state.planApproved = false; state.variant = null; state.awaitingSince = null; }
    touchPlan(state);
    notifyPassengers(state);
  } else if (action.type === 'breakdown') {
    const level = action.level;
    assert(Number.isInteger(level), 'Укажите уровень поломки');
    const inc = createBreakdown(state, action.train, level, action.kind);
    const plan = getPlan(state);
    event(state, `Поломка: ${inc.label}. ${BREAKDOWN_LEVELS[level].text}${inc.track ? ` Закрыт ${inc.track === 'both' ? 'оба пути' : 'путь'} перегона ${STATIONS[inc.segment][0]}–${STATIONS[inc.segment + 1][0]}, конфликтов: ${plan.conflicts.length}.` : ''}`);
    notifyPassengers(state);
  } else if (action.type === 'variant') {
    assert(activeClosures(state).length && !state.planApproved, 'Нет варианта, который можно выбрать');
    assert(getPlan(state).variants.some(v => v.id === action.variantId), 'Неизвестный вариант пропуска');
    state.variant = action.variantId;
    touchPlan(state);
    event(state, `Выбран вариант пропуска «${getPlan(state).variants.find(v => v.id === action.variantId).name}». Прогноз пересчитан, подтверждения ещё нет.`);
  } else if (action.type === 'approve') {
    assert(activeClosures(state).length && !state.planApproved, 'Нет нового варианта для подтверждения');
    approvePlan(state, false);
  } else if (action.type === 'restrict') {
    assert(Number.isInteger(action.segment) && action.segment >= 0 && action.segment < state.stations.length - 1, 'Некорректный перегон');
    assert(Number.isInteger(action.kmh) && action.kmh >= 15 && action.kmh < 80, 'Ограничение скорости: от 15 до 79 км/ч');
    state.restrictions = state.restrictions.filter(r => r.segment !== action.segment);
    assert(state.restrictions.length < 8, 'Не больше восьми ограничений одновременно');
    state.restrictions.push({ segment: action.segment, kmh: action.kmh });
    touchPlan(state);
    const [from, to] = [state.stations[action.segment], state.stations[action.segment + 1]];
    event(state, `Ограничение скорости ${action.kmh} км/ч на перегоне ${from.id}–${to.id} (${from.name} — ${to.name}). Прогноз всех затронутых поездов пересчитан.`);
    notifyPassengers(state);
  } else if (action.type === 'unrestrict') {
    assert(state.restrictions.some(r => r.segment === action.segment), 'Ограничения на этом перегоне нет');
    state.restrictions = state.restrictions.filter(r => r.segment !== action.segment);
    touchPlan(state);
    event(state, `Ограничение скорости на перегоне ${state.stations[action.segment].id}–${state.stations[action.segment + 1].id} снято.`);
    notifyPassengers(state);
  } else {
    throw new Error('Неизвестное действие');
  }
  return snapshot(state);
}
