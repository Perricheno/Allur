// Данные сети для списков и карты: маршруты, поезда сейчас, привязка станций к участкам.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLiveNow } from './store.js';
import { useNetwork } from './geo-network.js';
import { prepare, networkTrains, networkStats, setNetworkPlan } from './network-sim.js';
import { useLiveSchedule } from './schedule-live.js';
import { buildStationIndex } from './network-detail-data.js';
import { useIncidents } from './network-incidents.js';

let simLoading;
export function useSim() {
  const live = useLiveSchedule();
  useIncidents();
  const [sim, setSim] = useState(null);
  useEffect(() => { simLoading ||= fetch('/data/kz-routes.json').then(r => r.json()).then(prepare); simLoading.then(setSim).catch(() => setSim({ error: true })); }, []);
  if (sim && !sim.error) setNetworkPlan(sim, live.plan);
  return sim;
}

/** Сколько поездов сейчас на сети (для строки состояния в шапке). */
export function useNetworkTotals() {
  const sim = useSim();
  const now = useLiveNow(0.2);
  const { rev } = useIncidents();
  return useMemo(() => (sim && !sim.error ? networkStats(networkTrains(sim, now)) : null), [sim, Math.floor(now / 5000), rev]);
}

/** Все поезда сети; пересчитываются раз в refreshSec секунд. */
export function useNetworkTrains(refreshSec = 5) {
  const sim = useSim();
  const now = useLiveNow(1 / refreshSec);
  const slot = Math.floor(now / (refreshSec * 1000));
  const { rev } = useIncidents();
  const trains = useMemo(() => (sim && !sim.error ? networkTrains(sim, now) : []), [sim, slot, rev]);
  return { sim, trains, now, loading: !sim, failed: Boolean(sim?.error) };
}

/** Участки для выбора в фильтрах. */
export const routeOptions = sim => (sim?.routes || []).map(r => ({ value: r.id, label: r.name })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));

let indexCache = null;
/** Станции и остановочные пункты сети с привязкой к ближайшему маршруту (участку) и километру на нём. */
export function useStationIndex() {
  const sim = useSim();
  const net = useNetwork();
  return useMemo(() => {
    if (!sim || sim.error || !net || net.error) return null;
    if (indexCache?.sim === sim) return indexCache.rows;
    const rows = buildStationIndex(sim, net.net);
    indexCache = { sim, rows };
    return rows;
  }, [sim, net]);
}
