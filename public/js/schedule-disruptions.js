import { allocateTrips } from './schedule-engine.js';
import { scheduledTrips } from './network-sim.js';

export function extendSchedule(sim, plan, now) {
  const oldEnd = plan.horizonEnd || plan.createdAt + plan.config.horizonH * 3600000;
  const end = now + plan.config.horizonH * 3600000;
  if (end - oldEnd < 3600000) return plan;
  const trips = scheduledTrips(sim, oldEnd, end).filter(t => plan.routeId === 'all' || t.routeId === plan.routeId);
  const extend = (variant, optimized) => {
    const fleet = plan.fleet.map(l => {
      const last = variant.rows.filter(r => r.locoId === l.id).sort((a, b) => a.arrival - b.arrival).at(-1);
      return last ? { ...l, station: last.to, ready: last.arrival + plan.config.turnaroundMin * 60000 } : { ...l };
    });
    for (const l of fleet) l.ready = Math.max(now, l.ready);
    const pending = variant.rows.filter(r => r.status !== 'assigned');
    const retained = variant.rows.filter(r => r.status === 'assigned');
    const extra = allocateTrips([...pending, ...trips], fleet, plan.config, optimized, plan.constraints || [], retained);
    const rows = [...retained, ...extra.rows], assigned = rows.filter(r => r.status === 'assigned');
    return { rows, assigned: assigned.length, unassigned: rows.length - assigned.length,
      waitMin: assigned.reduce((n, r) => n + r.waitMin, 0), weightedWait: assigned.reduce((n, r) => n + r.waitMin * ({ passenger: 10, container: 2, freight: 1 }[r.category]), 0), locosUsed: new Set(assigned.map(r => r.locoId)).size };
  };
  return { ...plan, horizonEnd: end, updatedAt: now, revision: (plan.revision || 0) + 1, baseline: extend(plan.baseline, false), optimized: extend(plan.optimized, true) };
}

export const SERVICE_TYPES = {
  inspection: { label: 'Осмотр и диагностика', minutes: 60 },
  servicing: { label: 'Экипировка и заправка', minutes: 90 },
  daily: { label: 'Суточное обслуживание', minutes: 1440 },
  repair: { label: 'Внеплановый ремонт', minutes: 360 },
  overhaul: { label: 'Длительный ремонт', minutes: 4320 },
};

export function replanLocally(plan, incident, now, baselinePass = false) {
  if (!Number.isFinite(incident.until) || !Number.isFinite(incident.from) || incident.until <= incident.from) throw new Error('Некорректный период ограничения');
  const before = plan.optimized.rows;
  const affectedRoutes = new Set(incident.routeId ? [incident.routeId] : []);
  const affectedLocos = new Set(incident.locoId ? [incident.locoId] : []);
  // Propagate only through shared locomotive rotations; unrelated routes stay byte-for-byte unchanged.
  for (let changed = true; changed;) {
    changed = false;
    for (const r of before) {
      if ((r.couplingAt ?? r.departure ?? r.departedMs) < now) continue;
      if (affectedRoutes.has(r.routeId) || affectedLocos.has(r.locoId)) {
        if (!affectedRoutes.has(r.routeId)) { affectedRoutes.add(r.routeId); changed = true; }
        if (r.locoId && !affectedLocos.has(r.locoId)) { affectedLocos.add(r.locoId); changed = true; }
      }
    }
  }
  const flexible = before.filter(r => (r.couplingAt ?? r.departure ?? r.departedMs) >= now && affectedRoutes.has(r.routeId));
  const ids = new Set(flexible.map(r => r.uid));
  const locked = before.filter(r => !ids.has(r.uid));
  const fleet = plan.fleet.map(l => ({ ...l }));
  for (const l of fleet) {
    const assignments = locked.filter(r => r.locoId === l.id).sort((a, b) => a.arrival - b.arrival);
    const last = assignments.at(-1);
    if (last) { l.station = last.to; l.ready = last.arrival + plan.config.turnaroundMin * 60000; }
    l.ready = Math.max(l.ready, now);
  }
  // Never borrow a locomotive committed to an untouched future route.
  const reserved = new Set(locked.filter(r => r.departure >= now).map(r => r.locoId));
  const available = fleet.filter(l => !reserved.has(l.id));
  const constraints = [...(plan.constraints || []).filter(c => c.until > now), incident];
  const result = allocateTrips(flexible, available, plan.config, !baselinePass, constraints, locked);
  const replacement = new Map(result.rows.map(r => [r.uid, r]));
  const rows = before.map(r => replacement.get(r.uid) || r);
  const changes = result.rows.filter(r => {
    const old = before.find(b => b.uid === r.uid);
    return old.departure !== r.departure || old.locoId !== r.locoId || old.status !== r.status;
  }).map(r => { const old = before.find(b => b.uid === r.uid); return { uid: r.uid, number: r.number, routeId: r.routeId,
    oldDeparture: old.departure ?? null, departure: r.departure ?? null, oldLoco: old.locoId, locoId: r.locoId,
    oldArrival: old.arrival ?? null, arrival: r.arrival ?? null, wagons: r.wagons,
    reason: incident.reason, deltaMin: r.departure && old.departure ? (r.departure - old.departure) / 60000 : null,
    wagonHoursDelta: r.departure && old.departure ? (r.departure - old.departure) / 3600000 * r.wagons : null,
    search: r.search }; });
  const assigned = rows.filter(r => r.status === 'assigned');
  const baseline = !baselinePass && plan.baseline ? replanLocally({ ...plan, optimized: plan.baseline }, incident, now, true).optimized : plan.baseline;
  return { ...plan, baseline, constraints, revision: (plan.revision || 0) + 1, updatedAt: now,
    optimized: { rows, assigned: assigned.length, unassigned: rows.length - assigned.length,
      waitMin: assigned.reduce((n, r) => n + r.waitMin, 0), weightedWait: assigned.reduce((n, r) => n + r.waitMin * ({ passenger: 10, container: 2, freight: 1 }[r.category]), 0), locosUsed: new Set(assigned.map(r => r.locoId)).size },
    changes: [...(plan.changes || []), { id: incident.id, at: now, reason: incident.reason, routes: [...affectedRoutes], frozen: locked.length, changes }],
  };
}
