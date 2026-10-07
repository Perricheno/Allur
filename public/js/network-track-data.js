// Адаптер подробной схемы диспетчера (TrackMap) для маршрутов всей сети.
// Для национальных маршрутов нет сигналов и ёмкости путей, поэтому эти поля остаются неизвестными.
import { routeStations, electrifiedRanges } from './route-profile.js';

export function networkTrackData(base, route, trains, now, incidents = []) {
  const stops = routeStations(route).filter(s => !s.minor || s.end).map(s => [s.name, s.km]);
  const stations = stops.map(([name, km], i) => ({ id: String(i + 1), name, km, type: 'Маршрутная', tracks: [], capacity: null, occupied: null, network: true }));
  const position = km => {
    let i = 0;
    while (i < stops.length - 2 && stops[i + 1][1] < km) i++;
    return i + Math.max(0, Math.min(1, (km - stops[i][1]) / (stops[i + 1][1] - stops[i][1])));
  };
  const minutes = ms => (ms - base.baseTime) / 60000;
  const mapped = trains.map(t => ({ ...t, network: t, number: String(t.number), direction: t.dir === 'rev' ? 'odd' : 'even', priority: t.category === 'passenger' ? 1 : t.category === 'container' ? 2 : 3,
    diagramPosition: position(t.dir === 'rev' ? route.km - t.km : t.km), delay: t.extraMin,
    grossT: t.consist.grossT, loadPct: t.consist.loadPct, techState: { status: t.reason || 'в рейсе' },
    forecast: [[minutes(t.departedMs), t.dir === 'rev' ? stations.length - 1 : 0], [minutes(t.arrivesMs), t.dir === 'rev' ? 0 : stations.length - 1]] }));
  // события маршрута → закрытия и ограничения по перегонам схемы
  const closures = [], restrictions = [];
  for (const inc of incidents) {
    if (inc.routeId !== route.id || (inc.until ?? Infinity) <= now - 60000) continue;
    for (let i = 0; i < stops.length - 1; i++) {
      if (stops[i + 1][1] <= inc.a || stops[i][1] >= inc.b) continue;
      const from = minutes(inc.from), until = inc.until == null ? null : minutes(inc.until);
      if (inc.kind === 'restriction') restrictions.push({ segment: i, kmh: inc.kmh, from, until });
      else if (inc.kind === 'closure' || (inc.kind === 'breakdown' && inc.level >= 2)) {
        const track = inc.kind === 'breakdown' ? (inc.level >= 4 ? 'both' : inc.track) : inc.track;
        closures.push({ id: `${inc.id}:${i}`, segment: i, track: route.weight <= 2 ? 'both' : track, from, until, kind: inc.kind, train: inc.trainNumber });
      }
    }
  }
  const ranges = electrifiedRanges(route);
  const electrified = stops.slice(1).map((_, i) => { const mid = (stops[i][1] + stops[i + 1][1]) / 2; return ranges.some(([a, b]) => mid >= a && mid <= b); });
  return { ...base, network: true, now, stations, electrified, route, trains: mapped, groups: [], holds: [], restrictions, dispatch: { closures, conflicts: [] },
    sections: stations.slice(1).map((_, i) => ({ trains: mapped.filter(t => !t.network.stopped && Math.floor(t.diagramPosition) === i).length, load: null })) };
}
