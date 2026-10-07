// Сравнение двух планов на одинаковых заявках и одном пуле тяги. Не меняет исходные объекты.
import { scheduledTrips, networkTrains } from './network-sim.js';
import { fleetStandingMetrics } from './operational-metrics.js';
import { countComputation } from './computation-metrics.js';

const WEIGHT = { passenger: 10, container: 2, freight: 1 };
export const SCHEDULE_DEFAULTS = { horizonH: 12, reserve: 2, turnaroundMin: 45, couplingMin: 20, headwayMin: 10, maxFreightT: 6000, maxPassengerT: 2000, maxShiftMin: 30 };
export const ENERGY_DEFAULTS = { dieselGrade: 'summer', dieselLitresH: 0, electricKwhH: 0, dieselPrice: 0, electricPrice: 0, locoHour: 0, wagonHour: 0 };
const traction = trip => trip.electrified >= .95 ? 'electric' : 'diesel';
const role = trip => trip.category === 'passenger' ? 'passenger' : 'freight';
const series = (type, purpose) => type === 'electric' ? purpose === 'passenger' ? 'KZ4AT' : 'KZ8A' : purpose === 'passenger' ? 'ТЭП33А' : 'ТЭ33А';

export function validateScheduleSettings(raw) {
  const rules = { horizonH: [1, 24], reserve: [0, 10], turnaroundMin: [0, 240], couplingMin: [1, 120], headwayMin: [1, 60], maxFreightT: [100, 20000], maxPassengerT: [100, 5000], maxShiftMin: [0, 120] };
  const out = { ...SCHEDULE_DEFAULTS, ...raw };
  for (const [key, [min, max]] of Object.entries(rules)) if (!Number.isFinite(out[key]) || out[key] < min || out[key] > max) throw new Error(`Недопустимый параметр ${key}: допустимо ${min}–${max}`);
  if (!Number.isInteger(out.reserve)) throw new Error('Резерв должен быть целым числом');
  return out;
}

export function planningFleet(trips, active, now, config) {
  const locos = active.map(t => ({ id: `active:${t.uid}`, series: t.loco.series,
    type: t.loco.type === 'электровоз' ? 'electric' : 'diesel', role: role(t), station: t.to,
    ready: t.arrivesMs + config.turnaroundMin * 60000, origin: 'оборот действующего рейса',
    maxT: role(t) === 'passenger' ? config.maxPassengerT : config.maxFreightT }));
  const pools = new Map(trips.map(t => [`${t.from}:${traction(t)}:${role(t)}`, t]));
  for (const [key, t] of pools) for (let i = 0; i < config.reserve; i++) locos.push({ id: `reserve:${key}:${i + 1}`, series: series(traction(t), role(t)), type: traction(t), role: role(t),
    station: t.from, ready: now, origin: 'резерв планирования', maxT: role(t) === 'passenger' ? config.maxPassengerT : config.maxFreightT });
  return locos;
}

export function allocateTrips(trips, fleet, config, optimized = true, constraints = [], committed = []) {
  countComputation('allocationRuns');
  const locos = fleet.map(l => ({ ...l })), rows = [], slots = new Map();
  // Сначала более ранние заявки; при одинаковом времени — пассажирские, затем контейнерные.
  const ordered = [...trips].sort((a, b) => a.departedMs - b.departedMs || WEIGHT[b.category] - WEIGHT[a.category] || a.uid.localeCompare(b.uid));
  for (const source of ordered) {
    countComputation('tripAssignments');
    countComputation('compatibilityInspections', locos.length * 2);
    const t = { ...source };
    for (const key of ['departure', 'arrival', 'couplingAt', 'locoReady', 'waitMin', 'idleMin', 'locoId', 'assignedSeries', 'traction', 'status', 'reason', 'search', 'timing', 'proposedDeparture', 'proposedLoco', 'proposedWaitMin']) delete t[key];
    const slotKey = `${t.routeId}:${t.dir}`;
    const rejected = { station: 0, traction: 0, purpose: 0, mass: 0 };
    for (const l of locos) {
      if (l.station !== t.from) rejected.station++;
      else if (l.type !== traction(t)) rejected.traction++;
      else if (l.role !== role(t)) rejected.purpose++;
      else if (l.maxT < t.consist.grossT) rejected.mass++;
    }
    const candidates = locos.filter(l => l.station === t.from && l.type === traction(t) && l.role === role(t) && l.maxT >= t.consist.grossT);
    const depFor = l => {
      let dep = Math.max(t.departedMs, l.ready + config.couplingMin * 60000);
      const fixed = [...committed.filter(r => r.routeId === t.routeId && r.dir === t.dir && r.departure), ...(slots.get(slotKey) || []).map(departure => ({ departure }))].sort((a, b) => a.departure - b.departure);
      for (let pass = 0; pass <= constraints.length + fixed.length; pass++) {
        let changed = false;
        for (const c of constraints) {
          const applies = c.locoId ? c.locoId === l.id : c.routeId === t.routeId && (!c.dir || c.dir === 'all' || c.dir === t.dir);
          if (applies && dep + t.arrivesMs - t.departedMs > c.from && dep - config.couplingMin * 60000 < c.until) {
            dep = c.until + (c.locoId ? config.couplingMin * 60000 : 0); changed = true;
          }
        }
        for (const r of fixed) if (Math.abs(dep - r.departure) < config.headwayMin * 60000) { dep = r.departure + config.headwayMin * 60000; changed = true; }
        if (!changed) break;
      }
      return dep;
    };
    // База: очередь по времени готовности. Кандидат: раннее отправление и
    // ближайшая к нему готовность, чтобы не занимать раньше времени свободную тягу.
    candidates.sort(optimized
      ? (a, b) => depFor(a) - depFor(b) || b.ready - a.ready || a.id.localeCompare(b.id)
      : (a, b) => a.ready - b.ready || a.id.localeCompare(b.id));
    const loco = candidates[0];
    const search = { algorithm: optimized ? 'earliest-departure-latest-ready' : 'first-ready', fleetSize: locos.length, rejected,
      options: candidates.map(l => ({ id: l.id, series: l.series, ready: l.ready, departure: depFor(l), waitMin: (depFor(l) - t.departedMs) / 60000 })),
      scope: 'Перебраны все совместимые локомотивы текущего пула для этой заявки. Маршрут фиксирован; поиск всех путей сети и глобальный перебор сочетаний рейсов не выполняются.' };
    if (!loco) { rows.push({ ...t, status: 'unassigned', search, reason: 'Нет совместимой тяги на станции: проверьте резерв, массу и вид тяги.', locoId: null }); continue; }
    const departure = depFor(loco), arrival = departure + t.arrivesMs - t.departedMs;
    const waitMin = (departure - t.departedMs) / 60000;
    const allowedShift = t.category === 'passenger' ? 0 : (config.maxShiftMin ?? 30);
    if (waitMin > allowedShift + 1e-6) {
      rows.push({ ...t, status: 'unassigned', locoId: null, search, proposedDeparture: departure, proposedLoco: loco.id, proposedWaitMin: waitMin,
        reason: `Слот сохранён. Лучший доступный вариант требует +${Math.ceil(waitMin)} мин при допустимом сдвиге ${allowedShift} мин. Автоматическое назначение отклонено: требуется тяга на ${t.from} к исходному слоту или согласование нового графика.` });
      continue;
    }
    rows.push({ ...t, status: 'assigned', locoId: loco.id, assignedSeries: loco.series, traction: loco.type, departure, arrival,
      couplingAt: departure - config.couplingMin * 60000, locoReady: loco.ready, waitMin, search,
      timing: { scheduled: t.departedMs, readyWithPreparation: loco.ready + config.couplingMin * 60000, headwaySlot: departure > Math.max(t.departedMs, loco.ready + config.couplingMin * 60000) ? departure : null,
        constraints: constraints.filter(c => (c.locoId ? c.locoId === loco.id : c.routeId === t.routeId && (!c.dir || c.dir === 'all' || c.dir === t.dir)) && c.until > t.departedMs && c.from < arrival).map(c => ({ reason: c.reason, from: c.from, until: c.until })) },
      idleMin: Math.max(0, (departure - config.couplingMin * 60000 - loco.ready) / 60000),
      reason: `${loco.series} на ${t.from}; допустимая масса в настройках ${loco.maxT} т ≥ ${t.consist.grossT} т; ${loco.origin}. ${optimized ? 'Раннее отправление с наиболее близкой готовностью тяги.' : 'Закреплён по очереди готовности.'}` });
    loco.station = t.to; loco.ready = arrival + config.turnaroundMin * 60000;
    if (!slots.has(slotKey)) slots.set(slotKey, []);
    slots.get(slotKey).push(departure);
  }
  const assigned = rows.filter(r => r.status === 'assigned');
  return { rows, assigned: assigned.length, unassigned: rows.length - assigned.length, waitMin: assigned.reduce((n, r) => n + r.waitMin, 0),
    weightedWait: assigned.reduce((n, r) => n + r.waitMin * WEIGHT[r.category], 0), locosUsed: new Set(assigned.map(r => r.locoId)).size };
}

export function buildSchedule(sim, now, input = {}, routeId = 'all') {
  const config = validateScheduleSettings(input);
  const trips = scheduledTrips(sim, now, now + config.horizonH * 3600000).filter(t => routeId === 'all' || t.routeId === routeId);
  const fleet = planningFleet(trips, networkTrains(sim, now, { ignorePlan: true }), now, config);
  const baseline = allocateTrips(trips, fleet, config, false), candidate = allocateTrips(trips, fleet, config, true);
  // Нельзя показывать выигрыш за счёт исключения рейсов или ухудшения взвешенного простоя.
  const assignedIds = new Set(candidate.rows.filter(r => r.status === 'assigned').map(r => r.uid));
  const acceptable = baseline.rows.every(r => r.status !== 'assigned' || assignedIds.has(r.uid)) && candidate.weightedWait <= baseline.weightedWait;
  const optimized = acceptable ? candidate : baseline;
  return { version: 3, executionEnabled: false, reviewRequired: optimized.unassigned > 0, createdAt: now, routeId, config, fleet, baseline, optimized, improved: acceptable,
    note: acceptable ? 'Сравнение очереди готовности и подбора тяги к времени отправления.' : 'Кандидат ухудшал результат: сохранён базовый план.' };
}

export function scheduleEconomics(plan, input = {}) {
  const rates = { ...ENERGY_DEFAULTS, ...input };
  if (!['summer', 'winter', 'arctic'].includes(rates.dieselGrade)) throw new Error('Неизвестный вид дизтоплива');
  for (const key of Object.keys(ENERGY_DEFAULTS).filter(k => k !== 'dieselGrade')) if (!Number.isFinite(rates[key]) || rates[key] < 0 || rates[key] > 10000000) throw new Error(`Некорректный тариф ${key}`);
  const optimized = new Map(plan.optimized.rows.map(r => [r.uid, r]));
  let dieselHours = 0, electricHours = 0, wagonHours = 0, minutes = 0, comparable = 0;
  for (const base of plan.baseline.rows) {
    const row = optimized.get(base.uid);
    if (base.status !== 'assigned' || row?.status !== 'assigned') continue;
    const deltaH = (base.waitMin - row.waitMin) / 60;
    comparable++; minutes += deltaH * 60; wagonHours += deltaH * row.wagons;
    // Энергия зависит от стоянки именно локомотива, не от ожидания составом ещё не прибывшей тяги.
    if (base.traction === 'diesel') dieselHours += base.idleMin / 60; else electricHours += base.idleMin / 60;
    if (row.traction === 'diesel') dieselHours -= row.idleMin / 60; else electricHours -= row.idleMin / 60;
  }
  // Compare the whole available fleet over the same window. Moving idle from one
  // locomotive to an unused reserve must never create fictitious fuel savings.
  let fleetBaseline = null, fleetOptimized = null;
  if (plan.fleet && plan.config) {
    fleetBaseline = fleetStandingMetrics(plan, 'baseline'); fleetOptimized = fleetStandingMetrics(plan, 'optimized');
    dieselHours = fleetBaseline.dieselHours - fleetOptimized.dieselHours;
    electricHours = fleetBaseline.electricHours - fleetOptimized.electricHours;
  }
  const dieselLitres = dieselHours * rates.dieselLitresH, electricKwh = electricHours * rates.electricKwhH;
  const energyKzt = dieselLitres * rates.dieselPrice + electricKwh * rates.electricPrice;
  const timeKzt = (dieselHours + electricHours) * rates.locoHour + wagonHours * rates.wagonHour;
  return { rates, comparable, minutes, dieselHours, electricHours, wagonHours, dieselLitres, electricKwh, energyKzt, timeKzt, totalKzt: energyKzt + timeKzt, fleetBaseline, fleetOptimized,
    completeComparison: plan.baseline.rows.every(r => r.status === 'assigned') && plan.optimized.rows.every(r => r.status === 'assigned'),
    ready: plan.baseline.rows.every(r => r.status === 'assigned') && plan.optimized.rows.every(r => r.status === 'assigned') && rates.dieselLitresH > 0 && rates.electricKwhH > 0 && rates.dieselPrice > 0 && rates.electricPrice > 0 };
}
