// Живые измерения модели: 4 раза в секунду пересчитываем сеть, замеряем каждый этап и собираем сводку для страницы «Модель».
import { useEffect, useState } from 'preact/hooks';
import { networkTrains, networkEvents, networkStats, networkDecisions, incidentVariants, networkIncidents } from './network-sim.js';
import { liveNow } from './store.js';

export const CYCLES_PER_SECOND = 4;
export const HISTORY = 240;             // 60 секунд
const MAX_LINES = 120;
const store = { samples: [], lines: [], seen: new Set(), prev: null, counters: { cycles: 0, trains: 0, events: 0, variants: 0, ms: 0, inputs: 0 }, startedAt: Date.now() };
const listeners = new Set();
const clip = (arr, n) => (arr.length > n ? arr.slice(arr.length - n) : arr);
const timed = fn => { const t0 = performance.now(); const value = fn(); return [value, performance.now() - t0]; };
const snapshot = () => ({ samples: store.samples, lines: store.lines, counters: { ...store.counters }, startedAt: store.startedAt });

/** Перцентиль по уже собранным значениям (для времени цикла). */
export const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

/** Что изменилось во входных данных с прошлого цикла: новые рейсы, остановки, бригады, события диспетчера. */
function inputDeltas(trains, incidents, now) {
  const prev = store.prev, out = [];
  const state = { uids: new Map(trains.map(t => [t.uid, t])), incidents: new Set(incidents.map(i => i.id)), crewSoon: new Set(trains.filter(t => t.crew.leftMin < 45).map(t => t.uid)) };
  if (prev) {
    for (const [uid, t] of state.uids) {
      const before = prev.uids.get(uid);
      if (!before) out.push({ kind: 'in', text: `Рейс №${t.number} вышел на маршрут ${t.route}: ${t.from} → ${t.to}`, value: `${t.wagons} ваг.` });
      else if (t.stopped && !before.stopped && !t.planned) out.push({ kind: 'in', text: `№${t.number}: остановка вне расписания на ${t.station || 'перегоне'} — ${t.reason}`, value: t.route });
      else if (!t.stopped && before.stopped && !before.planned) out.push({ kind: 'in', text: `№${t.number}: возобновил движение после вынужденной стоянки`, value: `${Math.round(before.waitedMin)} мин` });
      if (state.crewSoon.has(uid) && !prev.crewSoon.has(uid)) out.push({ kind: 'in', text: `Бригада №${t.crew.number} поезда №${t.number}: до смены менее 45 минут`, value: `${t.crew.leftMin} мин` });
    }
    for (const [uid, t] of prev.uids) if (!state.uids.has(uid)) out.push({ kind: 'in', text: `Рейс №${t.number} завершён: прибыл на ${t.to}`, value: t.route });
    for (const inc of incidents) if (!prev.incidents.has(inc.id)) out.push({ kind: 'in', text: `Диспетчер: ${inc.kind === 'closure' ? 'закрытие пути' : inc.kind === 'restriction' ? `ограничение ${inc.kmh} км/ч` : `поломка поезда №${inc.trainNumber}, уровень ${inc.level}`} · ${inc.segName}`, value: 'событие' });
    for (const id of prev.incidents) if (!state.incidents.has(id)) out.push({ kind: 'in', text: 'Событие диспетчера снято или закончилось', value: '—' });
  }
  store.prev = state;
  return out.slice(0, 8).map((l, i) => ({ ...l, at: now, id: `d${now}${i}${l.text.slice(0, 12)}` }));
}

/** Один цикл модели: вход → расчёт → оценка → результат. */
export function runCycle(sim) {
  const now = liveNow();
  const [trains, trainsMs] = timed(() => networkTrains(sim, now));
  const [events, eventsMs] = timed(() => networkEvents(sim, now, 60));
  const [stats, statsMs] = timed(() => networkStats(trains));
  const incidents = networkIncidents().filter(i => (i.until ?? Infinity) > now);
  const [variants, variantsMs] = timed(() => incidents.map(i => incidentVariants(sim, i)).filter(Boolean));
  const [decisions, decisionsMs] = timed(() => networkDecisions(trains));
  const queue = variants.reduce((n, v) => n + (v.variants[0]?.rows.length || 0), 0);
  const bestLoss = variants.reduce((n, v) => n + Math.min(...v.variants.map(x => x.metrics.weighted)), 0);
  const byKind = {};
  for (const e of events) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  const newEvents = events.filter(e => !store.seen.has(e.id));
  for (const e of events) store.seen.add(e.id);
  if (store.seen.size > 6000) store.seen = new Set(events.map(e => e.id));
  const deltas = inputDeltas(trains, incidents, now);
  const ms = trainsMs + eventsMs + statsMs + variantsMs + decisionsMs;
  const sample = {
    t: Date.now(), now, trains: trains.length, trainsMs, eventsMs, statsMs, variantsMs, decisionsMs, ms,
    moving: stats.moving, stopped: stats.stopped, forced: stats.forced, planned: stats.stopped - stats.forced, avgSpeed: stats.avgSpeed,
    passenger: stats.passenger, container: stats.container, freight: stats.freight, electric: stats.electric, diesel: stats.diesel, wagons: stats.wagons,
    crewSoon: trains.filter(t => t.crew.leftMin < 45).length, toSoon: trains.filter(t => t.loco.toInH < 8).length,
    incidents: incidents.length, queue, bestLoss: Math.round(bestLoss), variantsCount: variants.length * 3,
    eventsHour: events.length, byKind, recommendations: decisions.length, justified: decisions.filter(d => d.verdict === 'justified').length, shorten: decisions.filter(d => d.verdict === 'shorten').length,
    passengerForced: trains.filter(t => t.category === 'passenger' && t.stopped && !t.planned).length, newInputs: deltas.length, newDecisions: newEvents.length,
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, fresh: newEvents.slice(0, 6),
  };
  const c = store.counters;
  c.cycles++; c.trains += sample.trains; c.events += events.length; c.variants += sample.variantsCount; c.ms += ms; c.inputs += deltas.length;
  const lines = [...deltas];
  if (c.cycles % CYCLES_PER_SECOND === 0) {
    lines.push({ id: `c${sample.t}`, at: now, kind: 'calc', text: `Расчёт: профили и позиции ${sample.trains} поездов, очереди ${queue}, варианты ${sample.variantsCount}, разбор стоянок ${decisions.length}`, value: `${ms.toFixed(1)} мс` });
    lines.push({ id: `o${sample.t}`, at: now, kind: 'out', text: `Результат: в пути ${sample.moving}, вынужденно стоят ${sample.forced}, средняя скорость ${sample.avgSpeed} км/ч`, value: `${sample.eventsHour} за час` });
  }
  for (const e of newEvents.slice(0, 6)) lines.push({ id: `e${e.id}`, at: e.at, kind: 'decision', text: e.text, value: e.station || '', tone: e.kind });
  store.lines = clip([...store.lines, ...lines], MAX_LINES);
  store.samples = clip([...store.samples, sample], HISTORY);
  for (const fn of listeners) fn({ sample, ...snapshot() });
  return sample;
}

/** Подписка страницы: цикл идёт, пока она открыта. */
export function useEngine(sim) {
  const [state, setState] = useState(() => ({ sample: store.samples.at(-1) || null, ...snapshot() }));
  useEffect(() => {
    if (!sim || sim.error) return undefined;
    listeners.add(setState);
    runCycle(sim);
    const id = setInterval(() => runCycle(sim), 1000 / CYCLES_PER_SECOND);
    return () => { clearInterval(id); listeners.delete(setState); };
  }, [sim]);
  return state;
}
