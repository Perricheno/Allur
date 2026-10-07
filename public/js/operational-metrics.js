// Counts derive from the current snapshot or the selected journal window, never random KPIs.
export const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
};
export function operationalMetrics(trains, events = []) {
  const stopped = trains.filter(t => t.stopped), freight = trains.filter(t => t.category !== 'passenger');
  const delay = trains.map(t => t.delayMin || 0), waits = stopped.map(t => t.restMin || 0);
  const reasons = new Map(), series = new Map();
  for (const t of trains) {
    const s = series.get(t.loco.series) || { label: t.loco.series, total: 0, moving: 0, stopped: 0, forced: 0 };
    s.total++; s[t.stopped ? 'stopped' : 'moving']++; if (t.stopped && !t.planned) s.forced++;
    series.set(s.label, s);
    if (t.stopped) reasons.set(t.reason, (reasons.get(t.reason) || 0) + 1);
  }
  const completedHolds = events.filter(e => e.kind === 'resolved' && Number.isFinite(e.dwell));
  const count = predicate => trains.filter(predicate).length;
  return {
    total: trains.length, moving: count(t => !t.stopped), plannedStops: count(t => t.stopped && t.planned), forcedStops: count(t => t.stopped && !t.planned),
    stoppedShare: trains.length ? 100 * stopped.length / trains.length : 0,
    dieselStopped: count(t => t.stopped && t.loco.type === 'тепловоз'), electricStopped: count(t => t.stopped && t.loco.type === 'электровоз'),
    standingWagons: stopped.reduce((s, t) => s + t.wagons, 0), standingTonnes: stopped.reduce((s, t) => s + t.consist.grossT, 0),
    waitedTrainHours: stopped.reduce((s, t) => s + (t.waitedMin || t.delayMin || 0) / 60, 0),
    remainingWaitHours: waits.reduce((s, n) => s + n / 60, 0), p95RemainingMin: percentile(waits, .95),
    delayMin: delay.reduce((s, n) => s + n, 0), maxDelayMin: Math.max(0, ...delay), p95DelayMin: percentile(delay, .95),
    emptyFreight: freight.filter(t => !t.loaded).length, loadedFreight: freight.filter(t => t.loaded).length,
    crewChanging: count(t => t.crew.changing), crewOverTarget: count(t => t.crew.workedMin > t.crew.limitMin),
    toDue: count(t => t.loco.toInH === 0), lowFuel: count(t => t.loco.type === 'тепловоз' && t.loco.resource.pct < 25),
    completedHoldCount: completedHolds.length, completedHoldHours: completedHolds.reduce((s, e) => s + e.dwell / 60, 0),
    p95CompletedHoldMin: percentile(completedHolds.map(e => e.dwell), .95),
    uniqueTrips: new Set(events.map(e => e.uid)).size, eventStations: new Set(events.map(e => e.station)).size,
    reasons: [...reasons].map(([label, value]) => ({ label, value })), series: [...series.values()],
  };
}

const overlapHours = (a, b, start, end) => Math.max(0, Math.min(b, end) - Math.max(a, start)) / 3600000;
function unionHours(intervals, start, end) {
  const sorted = intervals.filter(([a, b]) => b > start && a < end).map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).sort((a, b) => a[0] - b[0]);
  let through = start, total = 0;
  for (const [a, b] of sorted) { total += Math.max(0, b - Math.max(a, through)); through = Math.max(through, b); }
  return total / 3600000;
}

/** Whole fleet, same time boundary: include unused and terminal reserve, not just pre-departure idle. */
export function fleetStandingMetrics(plan, variant = 'optimized', start = plan.createdAt, end = plan.horizonEnd || plan.createdAt + plan.config.horizonH * 3600000) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const rows = plan[variant].rows, grouped = new Map();
  for (const r of rows) if (r.status === 'assigned') { if (!grouped.has(r.locoId)) grouped.set(r.locoId, []); grouped.get(r.locoId).push(r); }
  let dieselHours = 0, electricHours = 0, serviceHours = 0, occupiedHours = 0;
  const idle = [];
  for (const l of plan.fleet) {
    const assignments = grouped.get(l.id) || [], busy = assignments.map(r => [r.departure, r.arrival]);
    // Existing locomotives enter the available pool only at their initial ready time.
    const begin = Math.max(start, l.ready);
    if (begin >= end) continue;
    const maintenance = (plan.constraints || []).filter(c => c.locoId === l.id).map(c => [c.from, c.until]);
    const occupied = unionHours(busy, begin, end), unavailable = unionHours([...busy, ...maintenance], begin, end);
    const standing = Math.max(0, (end - begin) / 3600000 - unavailable);
    occupiedHours += occupied; serviceHours += unavailable - occupied;
    if (l.type === 'diesel') dieselHours += standing; else electricHours += standing;
    idle.push({ id: l.id, series: l.series, hours: standing, assignments: assignments.length });
  }
  const n = idle.length, total = dieselHours + electricHours;
  return { start, end, fleetCount: plan.fleet.length, availableCount: n, dieselHours, electricHours, standingHours: total,
    occupiedHours, serviceHours, averageStandingH: n ? total / n : 0, p95StandingH: percentile(idle.map(l => l.hours), .95),
    over7h: idle.filter(l => l.hours >= 7).length, over12h: idle.filter(l => l.hours >= 12).length,
    unused: idle.filter(l => !l.assignments).length,
    utilizationPct: occupiedHours + total + serviceHours ? 100 * occupiedHours / (occupiedHours + total + serviceHours) : 0,
    idle: idle.sort((a, b) => b.hours - a.hours),
    coverage: 'После начальной готовности до конца окна; межрейсовые стоянки, подготовка, оборот и свободный резерв. Внутрирейсовые стоянки входят в занятость рейсом. На обслуживании расход не оценён.',
  };
}
