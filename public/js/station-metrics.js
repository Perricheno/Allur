// Cargo groups waiting for admission are distinct from wagons on a siding.
// Reservations remain in the arrival queue until admission.
export function stationTraffic(data, stationId, now = data.now) {
  const pending = data.groups.filter(g => g.stationId === stationId && g.status !== 'arrived');
  const waiting = pending.filter(g => g.etaAt <= now);
  const enRoute = pending.filter(g => g.etaAt > now);
  const wagons = groups => groups.reduce((n, g) => n + g.count, 0);
  return { waiting: waiting.length, waitingWagons: wagons(waiting), enRoute: enRoute.length, enRouteWagons: wagons(enRoute) };
}

// Visual offsets separating overlapping train labels must not change their track.
export function blockOccupancy(trains) {
  return new Set(trains.filter(r => r.loc.kind === 'move').map(r => {
    const line = r.odd && !r.wrong ? 'o' : 'e';
    const progress = r.odd ? 1 - r.loc.f : r.loc.f;
    return `${line}:${r.segment}:${Math.min(2, Math.max(0, Math.floor(progress * 3)))}`;
  }));
}
