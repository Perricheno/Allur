import { networkItinerary } from './network-sim.js';

const norm = s => s.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[\s−–-]+/g, ' ').trim();
export const sameStation = (a, b) => norm(a) === norm(b);

export function buildStationIndex(sim, net) {
  const pts = sim.routes.flatMap(r => r.points.map(p => [...p, r]));
  const routesByName = new Map();
  for (const r of sim.routes) for (const name of new Set([r.from, r.to, ...r.stops.map(s => s[0])].map(norm))) {
    if (!routesByName.has(name)) routesByName.set(name, []);
    routesByName.get(name).push(r.id);
  }
  if (!pts.length) return [];
  return [['station', net.stations], ['halt', net.halts]].flatMap(([kind, records]) => records.map(rec => {
    const [, name, lat, lon] = rec, k = Math.cos(lat * Math.PI / 180);
    let best = null, bd = Infinity;
    for (const p of pts) { const dy = p[0] - lat, dx = (p[1] - lon) * k, d = dy * dy + dx * dx; if (d < bd) { bd = d; best = p; } }
    return { kind, rec, id: rec[0], name, lat, lon, routeId: best[3].id, route: best[3].name, routeIds: routesByName.get(norm(name)) || [], km: Math.round(best[2]), offKm: Math.round(Math.sqrt(bd) * 111) };
  }));
}

// Only a named timetable stop is station occupancy. Geographic proximity is not admission.
export function stationBoard(sim, station, trains, now) {
  const present = [], arrivals = [], nearby = [];
  for (const t of trains) {
    if (t.routeId !== station.routeId && !station.routeIds?.includes(t.routeId)) continue;
    if (t.waitingDeparture && sameStation(t.station, station.name)) {
      present.push({ t, stop: { name: station.name, arrival: t.scheduledDeparture, departure: t.departedMs, reason: t.reason } });
      continue;
    }
    const km = t.dir === 'fwd' ? t.km : t.totalKm - t.km;
    const distance = Math.abs(km - station.km);
    if (t.routeId === station.routeId && distance <= 60) nearby.push({ t, distance });
    const stops = networkItinerary(sim, t).filter(s => sameStation(s.name, station.name));
    for (const stop of stops) {
      if (stop.arrival <= now && stop.departure !== null && stop.departure >= now && t.stopped && sameStation(t.station, station.name)) present.push({ t, stop });
      else if (stop.arrival > now) arrivals.push({ t, stop });
    }
  }
  present.sort((a, b) => a.stop.departure - b.stop.departure);
  arrivals.sort((a, b) => a.stop.arrival - b.stop.arrival);
  nearby.sort((a, b) => a.distance - b.distance);
  return { present, arrivals, nearby };
}

export function stopExplanation(t) {
  if (t.waitingDeparture) return t.departedMs === null ? 'Нет совместимого свободного локомотива. Состав остаётся на станции; назначение повторно проверяется при продлении плана.' : 'Состав ожидает назначенный локомотив и свой слот отправления. Время плана управляет движением на карте.';
  if (!t.stopped) return 'Следует по маршруту. Следующая операция и её время показаны в прогнозе остановок.';
  if (t.crew.changing) return 'Идёт смена локомотивной бригады. После завершения стоянки рейс продолжится автоматически.';
  if (t.planned) return 'Остановка предусмотрена модельным расписанием. Поезд продолжит движение после окончания стоянки.';
  if (/неисправн/.test(t.reason)) return 'Выделено время на устранение неисправности. После завершения работ по прогнозу поезд продолжит рейс.';
  if (/бригад/.test(t.reason)) return 'Поезд ожидает замену бригады. Время ожидания задано профилем рейса.';
  if (/пропуск|свободного пути/.test(t.reason)) return 'Ожидание пропуска по графику движения. Раздел «Решения модели» показывает приоритеты и сравнение потерь при разных вариантах очерёдности.';
  return 'Поезд ожидает выполнения станционной операции. В сетевой модели ожидание завершится по времени профиля рейса.';
}
