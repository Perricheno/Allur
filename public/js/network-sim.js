// Движение поездов по всей сети КТЖ. Чистые функции без состояния: положение каждого поезда определяется
// только временем, поэтому после перезапуска сервера «вся сеть» продолжает жить без сохранения.
// Маршруты — реальные пути по OpenStreetMap (public/data/kz-routes.json); расписание синтетическое.
const TZ = 300; // Asia/Almaty, минут от UTC
import { countComputation } from './computation-metrics.js';
export const CREW_LIMIT_MIN = 480; // Плановая смена 8 ч; настройка модели, не универсальный норматив.
const executionPlans = new WeakMap();
export function setNetworkPlan(sim, plan) {
  if (!plan?.executionEnabled) { executionPlans.delete(sim); return; }
  if (executionPlans.get(sim)?.plan === plan) return;
  const services = new Map(sim.services.map(s => [s.id, { routes: [s.route], services: [s], byId: sim.byId }]));
  executionPlans.set(sim, { plan, services, ids: new Set(plan.optimized.rows.map(r => r.uid)) });
}

function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

export const CATEGORIES = {
  passenger: { label: 'Пассажирский', short: 'пасс.', holdPct: 8, hold: [8, 35], dwell: [5, 12], stopEvery: 140 },
  container: { label: 'Контейнерный', short: 'конт.', holdPct: 14, hold: [15, 60], dwell: [20, 45], stopEvery: 230 },
  freight: { label: 'Грузовой', short: 'груз.', holdPct: 22, hold: [20, 95], dwell: [30, 75], stopEvery: 170 },
};
const HOLD_REASONS = ['пропуск встречного поезда', 'ожидание свободного пути', 'ожидание подачи на станцию', 'устранение неисправности'];
const CARGO = ['уголь', 'зерно', 'нефтепродукты', 'руда', 'металл', 'химические грузы', 'строительные грузы'];

// Частота рейсов (в сутки на направление) — настроена так, чтобы на сети одновременно было около 700 поездов.
const trips = {
  passenger: r => (r.km >= 150 ? Math.max(1, Math.round(r.weight / 2.2)) : 1),
  container: r => (r.km >= 200 ? Math.max(1, Math.round(r.weight * 1.35)) : 1),
  freight: r => Math.max(2, Math.round(r.weight * 3.3 * Math.min(1.3, r.km / 520))),
};
const averageKmh = (cat, r) => (cat === 'passenger' ? (r.electrified > 0.5 ? 92 : 76) : cat === 'container' ? 60 : 44);

/** Подготовка маршрутов и расписания (один раз при загрузке данных). */
export function prepare(data) {
  const routes = data.routes.map(r => ({ ...r, cum: r.points.map(p => p[2]) }));
  const next = { passenger: [2, 1], container: [2002, 2001], freight: [3000, 3001] };
  const services = [];
  for (const route of routes) {
    for (const cat of Object.keys(CATEGORIES)) {
      for (const dir of ['fwd', 'rev']) {
        const spec = CATEGORIES[cat];
        const n = trips[cat](route);
        const period = 1440 / n;
        const stops = pickStops(route, spec, dir);
        const dwellSum = stops.reduce((s, x) => s + x.dwell, 0);
        const avg = averageKmh(cat, route);
        const plan = route.km / avg * 60;
        const run = Math.max(plan - dwellSum, plan * 0.55);
        const id = `${route.id}:${dir}:${cat}`;
        const maxHold = spec.hold[1];
        const tMax = run + dwellSum + maxHold + stops.length * 14;
        const parity = dir === 'fwd' ? 0 : 1;
        const copies = Math.ceil(tMax / period) + 1;
        const base = next[cat][parity];
        next[cat][parity] += 2 * copies;
        services.push({ id, route, dir, cat, n, period, phase: hash(id) % 1440, stops, run, avg, tMax, copies, base });
      }
    }
  }
  for (const service of services) serviceNetworks.set(service, services);
  return { routes, services, byId: new Map(routes.map(r => [r.id, r])) };
}

function pickStops(route, spec, dir) {
  const out = [];
  let target = spec.stopEvery;
  const L = route.km;
  const list = route.stops.filter(([, km]) => km > 25 && km < L - 25);
  while (target < L - 40 && list.length) {
    let best = null, bd = 45;
    for (const [name, km] of list) { const d = Math.abs(km - target); if (d < bd) { bd = d; best = [name, km]; } }
    if (best && !out.some(s => s.name === best[0])) out.push({ name: best[0], km: best[1], dwell: Math.round((spec.dwell[0] + spec.dwell[1]) / 2) });
    target += spec.stopEvery;
  }
  if (dir === 'rev') return out.map(s => ({ ...s, km: route.km - s.km })).sort((a, b) => a.km - b.km);
  return out;
}

const profiles = new WeakMap();
const rawProfiles = new WeakMap();
const serviceNetworks = new WeakMap();
const repairDays = new WeakMap();
export const NETWORK_REPAIRS_PER_DAY = 8; // ещё 2 автоматических события зарезервированы детальному участку

// Quota is selected by actual occurrence day (Almaty), not departure day or UI query order.
function repairAllowed(service, uid, at) {
  const services = serviceNetworks.get(service) || [service];
  let days = repairDays.get(services);
  if (!days) { days = new Map(); repairDays.set(services, days); }
  const day = Math.floor(at / 1440);
  if (!days.has(day)) {
    const candidates = [];
    for (const s of services) {
      const lo = Math.ceil((day * 1440 - s.tMax - s.phase) / s.period);
      const hi = Math.floor(((day + 1) * 1440 - s.phase) / s.period);
      for (let m = lo; m <= hi; m++) {
        const id = `${s.id}@${m}`, dep = s.phase + m * s.period;
        const p = profileOf(s, id, true);
        if (p.legs.some(l => l.reason === 'устранение неисправности' && Math.floor((dep + l.t) / 1440) === day)) candidates.push(id);
      }
    }
    candidates.sort((a, b) => hash(`repair:${a}`) - hash(`repair:${b}`) || a.localeCompare(b));
    if (days.size >= 32) days.delete(days.keys().next().value);
    days.set(day, new Set(candidates.slice(0, NETWORK_REPAIRS_PER_DAY)));
  }
  return days.get(day).has(uid);
}
/** Расписание одного рейса: остановки с временем прибытия и стоянкой, с учётом случайной задержки. */
function profileOf(service, uid, raw = false) {
  const caches = raw ? rawProfiles : profiles;
  let cache = caches.get(service);
  if (!cache) { cache = new Map(); caches.set(service, cache); }
  const cached = cache.get(uid);
  if (cached) { countComputation('profileCacheHits'); return cached; }
  countComputation('profilesBuilt');
  const spec = CATEGORIES[service.cat];
  const h = hash(uid);
  const stops = service.stops.map(s => ({ ...s, planned: true, reason: 'плановая стоянка' }));
  let extra = 0, holdAt = -1;
  if (h % 100 < spec.holdPct) {
    extra = spec.hold[0] + ((h >>> 8) % (spec.hold[1] - spec.hold[0] + 1));
    holdAt = stops.length ? (h >>> 16) % stops.length : -1;
    if (holdAt >= 0) { stops[holdAt].dwell += extra; stops[holdAt].planned = false; stops[holdAt].reason = HOLD_REASONS[(h >>> 4) % (service.cat === 'passenger' ? 3 : HOLD_REASONS.length)]; }
  }
  const legs = []; // [tArrive, km, dwell, reason, planned]
  let t = 0, km = 0;
  const speed = service.route.km / service.run * 60; // км/ч в движении
  if (!raw && holdAt >= 0 && stops[holdAt].reason === 'устранение неисправности') {
    const original = profileOf(service, uid, true);
    const dep = service.phase + Number(uid.slice(uid.lastIndexOf('@') + 1)) * service.period;
    if (!repairAllowed(service, uid, dep + original.legs[holdAt].t)) {
      stops[holdAt].dwell -= extra;
      stops[holdAt].planned = true;
      stops[holdAt].reason = 'плановая стоянка';
      extra = 0; holdAt = -1;
    }
  }
  const pre = (h >>> 3) % 200;                 // сколько бригада уже отработала к отправлению, мин
  const limit = CREW_LIMIT_MIN;
  let worked = pre;
  stops.forEach((s, i) => {
    const travel = (s.km - km) / speed * 60;
    t += travel; worked += travel; km = s.km;
    const nextTravel = ((stops[i + 1]?.km ?? service.route.km) - s.km) / speed * 60;
    let dwell = s.dwell, crew = false, reason = s.reason;
    const workedHere = Math.round(worked);
    const projectedMin = worked + dwell + nextTravel;
    if (projectedMin > limit) { crew = true; dwell += 14; worked = 14; if (s.planned) reason = 'смена локомотивной бригады'; } else worked += dwell;
    legs.push({ t, km, dwell, reason, planned: s.planned, name: s.name, crew, workedMin: workedHere, projectedMin: Math.ceil(projectedMin), nextStation: stops[i + 1]?.name || (service.dir === 'fwd' ? service.route.to : service.route.from), track: 1 + ((h >>> (i + 5)) % 6) });
    t += dwell;
  });
  t += (service.route.km - km) / speed * 60;
  const profile = { legs, total: t, speed, extra: holdAt >= 0 ? extra : 0, holdAt, pre, limit };
  if (cache.size > 1000) cache.clear();
  cache.set(uid, profile);
  return profile;
}

/** Положение вдоль маршрута: {km, stopped, reason, planned, speed}. */
function stateAt(profile, e, L) {
  let prevT = 0, prevKm = 0;
  for (const leg of profile.legs) {
    if (e < leg.t) return { km: prevKm + (leg.km - prevKm) * ((e - prevT) / (leg.t - prevT)), stopped: false, speed: Math.min(profile.speed, (leg.km - prevKm) / Math.max(1e-6, leg.t - prevT) * 60) };
    if (e <= leg.t + leg.dwell) return { km: leg.km, stopped: true, station: leg.name, reason: leg.reason, planned: leg.planned, speed: 0, restMin: leg.t + leg.dwell - e, waitedMin: e - leg.t };
    prevT = leg.t + leg.dwell; prevKm = leg.km;
  }
  return { km: Math.min(L, prevKm + (L - prevKm) * ((e - prevT) / Math.max(1e-6, profile.total - prevT))), stopped: false, speed: Math.min(profile.speed, (L - prevKm) / Math.max(1e-6, profile.total - prevT) * 60) };
}


// ───────── Инциденты на маршрутах: закрытия путей, ограничения скорости, поломки ─────────
// Список приходит с сервера. Эффект считается чистыми функциями: профиль рейса дополняется ожиданием перед
// перегоном и медленным проездом, поэтому положение, события и прогноз прибытия согласованы.
let incidentList = [], incidentRevision = 0, adjCache = new Map(), queueCache = new Map();
export function setNetworkIncidents(list) { incidentList = Array.isArray(list) ? list : []; incidentRevision++; adjCache = new Map(); queueCache = new Map(); }
export const networkIncidentRev = () => incidentRevision;
export const networkIncidents = () => incidentList;
export const WRONG_TRACK_KMH = 40;
const HEAD_SAME = 5, HEAD_OPPOSITE = 3;
export const isSingleTrack = route => route.weight <= 2;

/** Зона инцидента в минутах модели и режим работы. */
export function incidentZone(inc, route) {
  const t0 = inc.from / 60000 + TZ, t1 = (inc.until ?? inc.from + 720 * 60000) / 60000 + TZ;
  let mode, v = WRONG_TRACK_KMH;
  if (inc.kind === 'restriction') { mode = 'slow'; v = inc.kmh; }
  else if (inc.kind === 'closure') mode = inc.track === 'both' || isSingleTrack(route) ? 'closed' : 'lane';
  else mode = { 1: 'owner', 2: 'follow', 3: 'lane', 4: 'closed' }[inc.level] || 'owner';
  return { inc, a: Math.min(inc.a, inc.b), b: Math.max(inc.a, inc.b), t0, t1, mode, v };
}
const dirOfTrack = track => (track === 'odd' ? 'rev' : 'fwd'); // чётный путь — прямое направление
// Линейная интерполяция времени по километру (с учётом стоянок).
function timeAtKm(profile, L, km) {
  let prevT = 0, prevKm = 0;
  for (const leg of profile.legs) {
    if (km <= leg.km) return prevT + (leg.t - prevT) * ((km - prevKm) / Math.max(1e-6, leg.km - prevKm));
    prevT = leg.t + leg.dwell; prevKm = leg.km;
  }
  return prevT + (profile.total - prevT) * ((km - prevKm) / Math.max(1e-6, L - prevKm));
}
const travelEntry = (zone, dir, L) => (dir === 'fwd' ? zone.a : L - zone.b);
const travelExit = (zone, dir, L) => (dir === 'fwd' ? zone.b : L - zone.a);
const weightOf = cat => WEIGHT[cat];

function participants(sim, zone, route, owner) {
  const parts = [];
  for (const s of sim.services) {
    if (s.route.id !== route.id) continue;
    if (zone.mode === 'follow' && s.dir !== owner?.dir) continue;
    const entryKm = travelEntry(zone, s.dir, route.km), exitKm = travelExit(zone, s.dir, route.km);
    const lo = Math.floor((zone.t0 - s.tMax - s.phase) / s.period), hi = Math.floor((zone.t1 + 600 - s.phase) / s.period);
    for (let m = lo; m <= hi; m++) {
      const uid = `${s.id}@${m}`;
      if (owner && uid === owner.uid) continue;
      const profile = profileOf(s, uid), dep = s.phase + m * s.period;
      if (profile.total <= 0) continue;
      const en = dep + timeAtKm(profile, route.km, entryKm);
      if (en < zone.t0 || en > zone.t1 + 600) continue;
      const len = exitKm - entryKm;
      parts.push({ uid, dir: s.dir, cat: s.cat, en, trav: len / zone.v * 60, nominalTrav: len / Math.max(20, profile.speed) * 60, w: weightOf(s.cat), number: s.base + 2 * (((m % s.copies) + s.copies) % s.copies) });
    }
  }
  return parts.sort((a, b) => a.en - b.en || a.uid.localeCompare(b.uid));
}

/** Очередь на единственный свободный путь: порядок проследования зависит от варианта. */
function runQueue(parts, zone, variant) {
  const out = new Map(), pending = [], lastByDir = {};
  const openFrom = zone.mode === 'lane' ? zone.t0 : zone.t1;
  let i = 0, last = null; // последний пропущенный: { dir, start, exit }
  while (i < parts.length || pending.length) {
    let tNow = Math.max(openFrom, last ? last.start + HEAD_SAME : openFrom);
    if (!pending.length) tNow = Math.max(tNow, parts[i].en);
    while (i < parts.length && parts[i].en <= tNow) pending.push(parts[i++]);
    const bestOf = list => list.reduce((b, p) => (!b || p.w > b.w || (p.w === b.w && p.en < b.en) ? p : b), null);
    let pick;
    if (variant === 'fifo') pick = pending.reduce((b, p) => (!b || p.en < b.en ? p : b), null);
    else if (variant === 'priority') pick = bestOf(pending);
    else {
      const same = last ? pending.filter(p => p.dir === last.dir) : [];
      const top = bestOf(pending), topSame = bestOf(same);
      pick = topSame && !(top.dir !== last.dir && top.w >= 10 && topSame.w < 10) ? topSame : top;
    }
    pending.splice(pending.indexOf(pick), 1);
    let start = Math.max(pick.en, openFrom, (lastByDir[pick.dir] ?? -Infinity) + HEAD_SAME);
    // пока путь закрыт, оба направления делят один свободный путь: проезд по одному
    if (zone.mode === 'lane' && start < zone.t1 && last && last.dir !== pick.dir) start = Math.max(start, last.exit + HEAD_OPPOSITE);
    const slow = zone.mode === 'lane' && start < zone.t1;
    out.set(pick.uid, { start, en: pick.en, slow, trav: pick.trav, nominalTrav: pick.nominalTrav, w: pick.w, cat: pick.cat, dir: pick.dir, number: pick.number });
    lastByDir[pick.dir] = start;
    last = { dir: pick.dir, start, exit: start + (slow ? pick.trav : pick.nominalTrav) };
  }
  return out;
}

export const INCIDENT_VARIANTS = [
  { id: 'fifo', name: 'По очереди подхода', description: 'Поезда проходят в порядке подхода к закрытому участку. Приоритеты не учитываются.' },
  { id: 'priority', name: 'По приоритету', description: 'Пассажирские идут первыми, затем контейнерные, затем грузовые; грузовой ждёт, если приоритетный подойдёт к зоне.' },
  { id: 'batch', name: 'Пакетами по направлениям', description: 'Поезда одного направления идут колонной, пока очередь не потребует переключить путь на пассажирский.' },
];
const variantOf = inc => (inc.approved && INCIDENT_VARIANTS.some(v => v.id === inc.variant) ? inc.variant : 'fifo');

function ownerOf(sim, inc) {
  if (inc.kind !== 'breakdown' || !inc.trainUid) return null;
  const sep = inc.trainUid.lastIndexOf('@'), service = sim.services.find(s => s.id === inc.trainUid.slice(0, sep));
  return service ? { uid: inc.trainUid, dir: service.dir, service } : null;
}

/** Результат очереди для зоны и варианта (кэшируется до изменения списка инцидентов). */
function queueFor(sim, zone, route, variant) {
  const key = `${zone.inc.id}|${variant}|${zone.mode}`;
  if (queueCache.has(key)) return queueCache.get(key);
  let result = null;
  if (zone.mode === 'lane' || zone.mode === 'closed' || zone.mode === 'follow') {
    const owner = ownerOf(sim, zone.inc);
    result = runQueue(participants(sim, zone, route, owner), zone, variant);
  }
  queueCache.set(key, result);
  return result;
}

/** Сравнение вариантов пропуска для инцидента: метрики по каждому и таблица поездов. */
export function incidentVariants(sim, inc) {
  const route = sim.byId.get(inc.routeId);
  if (!route) return null;
  const zone = incidentZone(inc, route);
  const len = zone.b - zone.a;
  const variants = INCIDENT_VARIANTS.map(v => {
    const queue = queueFor(sim, zone, route, v.id);
    const rows = [];
    if (queue) for (const [uid, r] of queue) {
      const extra = r.slow ? Math.max(0, r.trav - r.nominalTrav) : 0, delay = Math.max(0, r.start - r.en) + extra;
      if (delay >= 1) rows.push({ uid, number: r.number, cat: r.cat, dir: r.dir, wait: Math.round(r.start - r.en), delay: Math.round(delay), weight: r.w, enterMs: Math.round((r.en - TZ) * 60000), releaseMs: Math.round((r.start - TZ) * 60000) });
    }
    const owner = ownerOf(sim, inc);
    if (owner && zone.mode !== 'owner') rows.push({ uid: owner.uid, number: '—', cat: 'owner', dir: owner.dir, wait: Math.round(zone.t1 - zone.t0), delay: Math.round(zone.t1 - zone.t0), weight: 0, owner: true });
    rows.sort((a, b) => b.delay * b.weight - a.delay * a.weight);
    const m = { total: 0, weighted: 0, passenger: 0, delayed: rows.length, max: 0 };
    for (const r of rows) { m.total += r.delay; m.weighted += r.delay * r.weight; if (r.cat === 'passenger') m.passenger += r.delay; m.max = Math.max(m.max, r.delay); }
    return { ...v, metrics: m, rows };
  });
  const recommended = [...variants].sort((a, b) => a.metrics.weighted - b.metrics.weighted || a.metrics.passenger - b.metrics.passenger)[0];
  for (const v of variants) v.recommended = v.id === recommended.id;
  const applied = variantOf(inc);
  return { zone, len, variants, recommendedId: recommended.id, appliedId: applied, mode: zone.mode };
}

/** Профиль рейса с учётом активных инцидентов маршрута. */
function adjusted(sim, service, uid, dep, profile) {
  const route = service.route;
  const zones = [];
  for (const inc of incidentList) {
    if (inc.routeId !== route.id) continue;
    const zone = incidentZone(inc, route);
    if (zone.t1 + 600 < dep || zone.t0 > dep + profile.total + 600) continue;
    zones.push(zone);
  }
  if (!zones.length) return profile;
  const key = `${uid}`;
  const hit = adjCache.get(key);
  if (hit && hit.base === profile) return hit.profile;
  const L = route.km;
  const dir = service.dir;
  const list = [];
  for (const zone of zones) {
    const owner = ownerOf(sim, zone.inc);
    const entry = travelEntry(zone, dir, L), exit = travelExit(zone, dir, L), len = exit - entry;
    const isOwner = owner?.uid === uid;
    let release = null, speed = zone.v, slow = false;
    if (isOwner) {
      release = zone.t1; slow = false;
      // собственная неисправность: поезд стоит в точке поломки
      list.push({ zone, entry: Math.max(0, entry), exit: Math.max(0, entry) + 0.001, release, slow: false, len: 0.001, owner: true, speed });
      continue;
    }
    if (zone.mode === 'slow') { slow = true; list.push({ zone, entry, exit, release: null, slow, len, speed }); continue; }
    if (zone.mode === 'owner') continue;
    const queue = queueFor(sim, zone, route, variantOf(zone.inc));
    const r = queue?.get(uid);
    if (!r) continue;
    list.push({ zone, entry, exit, release: r.start, slow: r.slow, len, speed });
  }
  if (!list.length) { adjCache.set(key, { base: profile, profile }); return profile; }
  list.sort((a, b) => a.entry - b.entry);
  const nominal = profile.legs;
  const legs = [];
  let shift = 0, li = 0;
  const pushLegsUpTo = km => { while (li < nominal.length && nominal[li].km <= km) { legs.push({ ...nominal[li], t: nominal[li].t + shift }); li++; } };
  for (const z of list) {
    pushLegsUpTo(z.entry);
    const tEntry = dep + timeAtKm(profile, L, z.entry) + shift;
    const wait = Math.max(0, (z.release ?? 0) - tEntry);
    const base = timeAtKm(profile, L, z.exit) - timeAtKm(profile, L, z.entry);
    const trav = z.slow ? Math.max(base, z.len / z.speed * 60) : base;
    if (wait < 0.5 && trav - base < 0.5) continue;
    const reasonWait = z.zone.inc.kind === 'breakdown' ? (z.owner ? `неисправность поезда, уровень ${z.zone.inc.level}` : `впереди поломка поезда №${z.zone.inc.trainNumber || '—'}: ожидание пропуска`)
      : z.zone.mode === 'slow' ? 'ограничение скорости' : `закрыт перегон ${z.zone.inc.segName || ''}: ожидание пропуска`;
    const tA = dep + timeAtKm(profile, L, z.entry) + shift - dep;
    legs.push({ t: tA, km: z.entry, dwell: Math.max(0, wait), reason: wait >= 0.5 ? reasonWait : 'проезд с ограничением', planned: false, name: z.zone.inc.segName ? `перегон ${z.zone.inc.segName}` : 'перегон', crew: false, workedMin: 0, projectedMin: 0, nextStation: '', track: 1, pseudo: true, incidentId: z.zone.inc.id, wrongTrack: z.zone.mode === 'lane' });
    // legs внутри зоны переносим пропорционально
    let inside = 0;
    while (li < nominal.length && nominal[li].km < z.exit) {
      const f = (nominal[li].km - z.entry) / Math.max(1e-6, z.exit - z.entry);
      legs.push({ ...nominal[li], t: tA + wait + trav * f + inside }); inside += nominal[li].dwell; li++;
    }
    if (z.exit > z.entry + 0.002) legs.push({ t: tA + wait + trav + inside, km: z.exit, dwell: 0, reason: 'выход из зоны', planned: true, name: 'выход из зоны', crew: false, workedMin: 0, projectedMin: 0, nextStation: '', track: 1, pseudo: true, silent: true });
    shift += wait + (trav - base) + inside;
  }
  while (li < nominal.length) { legs.push({ ...nominal[li], t: nominal[li].t + shift }); li++; }
  const out = { ...profile, legs, total: profile.total + shift };
  adjCache.set(key, { base: profile, profile: out });
  if (adjCache.size > 6000) adjCache.clear();
  return out;
}
const hasIncidents = route => incidentList.some(i => i.routeId === route.id);
const profileFor = (sim, s, uid, dep) => (hasIncidents(s.route) ? adjusted(sim, s, uid, dep, profileOf(s, uid)) : profileOf(s, uid));

/** Линии движения маршрута для графика (ГИД): время × километр, с учётом инцидентов. */
export function routeTimeline(sim, routeId, fromMs, toMs) {
  const route = sim.byId.get(routeId), from = fromMs / 60000 + TZ, to = toMs / 60000 + TZ, out = [];
  if (!route) return out;
  const pad = incidentList.some(i => i.routeId === routeId) ? 900 : 0;
  for (const s of sim.services) {
    if (s.route.id !== routeId) continue;
    const mFrom = Math.floor((from - s.tMax - pad - s.phase) / s.period), mTo = Math.floor((to - s.phase) / s.period);
    for (let m = mFrom; m <= mTo; m++) {
      const dep = s.phase + m * s.period, uid = `${s.id}@${m}`, profile = profileFor(sim, s, uid, dep);
      if (dep + profile.total < from) continue;
      const pts = [[dep, s.dir === 'fwd' ? 0 : route.km]];
      let forced = [];
      for (const leg of profile.legs) {
        const km = s.dir === 'fwd' ? leg.km : route.km - leg.km;
        pts.push([dep + leg.t, km]);
        if (leg.dwell > 0.5) { pts.push([dep + leg.t + leg.dwell, km]); if (!leg.planned) forced.push([dep + leg.t, dep + leg.t + leg.dwell, km]); }
      }
      pts.push([dep + profile.total, s.dir === 'fwd' ? route.km : 0]);
      out.push({ uid, number: s.base + 2 * (((m % s.copies) + s.copies) % s.copies), category: s.cat, dir: s.dir, points: pts.map(([t, km]) => [Math.round((t - TZ) * 60000), km]), forced: forced.map(([a, b, km]) => [Math.round((a - TZ) * 60000), Math.round((b - TZ) * 60000), km]) });
    }
  }
  return out;
}

function locate(route, km) {
  const cum = route.cum, pts = route.points;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= km) lo = mid; else hi = mid; }
  const span = cum[hi] - cum[lo] || 1e-9;
  const f = Math.max(0, Math.min(1, (km - cum[lo]) / span));
  const lat = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, lon = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f;
  const dy = pts[hi][0] - pts[lo][0], dx = (pts[hi][1] - pts[lo][1]) * Math.cos(lat * Math.PI / 180);
  return { lat, lon, heading: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
}

const locoOf = (cat, route, h) => {
  const electric = route.electrified > 0.5;
  if (cat === 'passenger') return electric ? { series: 'KZ4AT', type: 'электровоз' } : { series: 'ТЭП33А', type: 'тепловоз' };
  if (electric) return h % 10 < 7 ? { series: 'KZ8A', type: 'электровоз' } : { series: 'ВЛ80С', type: 'электровоз' };
  return h % 20 < 15 ? { series: 'ТЭ33А', type: 'тепловоз' } : h % 20 < 18 ? { series: '2ТЭ25КМ', type: 'тепловоз' } : { series: '2ТЭ10МК', type: 'тепловоз' };
};


const LOCO_SPECS = {
  KZ4AT: { kw: 7200, massT: 123 }, KZ8A: { kw: 8800, massT: 192 }, 'ВЛ80С': { kw: 6520, massT: 192 },
  'ТЭП33А': { kw: 2950, massT: 138 }, 'ТЭ33А': { kw: 3000, massT: 138 }, '2ТЭ25КМ': { kw: 5100, massT: 288 }, '2ТЭ10МК': { kw: 4400, massT: 276 },
};

/** Подробные характеристики рейса в момент e (мин от отправления): бригада, локомотив, состав, техсостояние. */
function characteristics(service, uid, profile, e, st, h, loco, wagons, loaded) {
  const cat = service.cat, legs = profile.legs;
  // бригада
  let lastChange = null, next = null;
  for (const leg of legs) if (leg.crew) { if (leg.t + leg.dwell <= e) lastChange = leg; else if (!next) next = leg; }
  const worked = lastChange ? 14 + e - (lastChange.t + lastChange.dwell) : profile.pre + e;
  const changeCount = legs.filter(l => l.crew && l.t + l.dwell <= e).length;
  const crew = {
    number: 1000 + ((h + changeCount * 137) % 8000), workedMin: Math.round(worked), limitMin: Math.round(profile.limit), leftMin: Math.max(0, Math.round(profile.limit - worked)),
    nextChange: next ? next.name : 'на конечной станции', changing: Boolean(st.stopped && legs.some(l => l.crew && e >= l.t && e <= l.t + l.dwell)),
    restAfterH: null, restReason: 'По графику конкретной бригады; индивидуальный оборот и отдых пока не рассчитываются',
    changeReason: next ? `До ${next.nextStation} без замены получится ${next.projectedMin} мин при плановой смене ${profile.limit} мин. Учитываются предшествующая работа, стоянка и следующее плечо.` : 'На этом рейсе промежуточная замена не запланирована',
    size: 'машинист, помощник',
  };
  // локомотив
  const spec = LOCO_SPECS[loco.series] || { kw: 3000, massT: 138 };
  const electric = loco.type === 'электровоз';
  const sinceToH = (h >>> 5) % (cat === 'container' ? 48 : 96);
  const toIntervalH = cat === 'container' ? 48 : 72;
  const resource = electric ? { label: 'Нагрузка тяги', pct: Math.round(55 + ((h >>> 9) % 35) * (st.stopped ? 0.3 : 1)) }
    : { label: 'Топливо', pct: Math.max(8, Math.round(100 - ((h >>> 9) % 45) - e / Math.max(1, profile.total) * 40)) };
  const locoInfo = { ...loco, kw: spec.kw, massT: spec.massT, resource, conditionPct: 82 + ((h >>> 13) % 17), sinceToH, toIntervalH, toInH: Math.max(0, toIntervalH - sinceToH), maxKmh: cat === 'passenger' ? (electric ? 120 : 100) : cat === 'container' ? 90 : 80 };
  // состав
  const tare = cat === 'passenger' ? 52 : cat === 'container' ? 22 : 24;
  const payload = cat === 'passenger' ? 0 : loaded ? 58 + ((h >>> 3) % 8) : 0;
  const netT = wagons * payload, grossT = Math.round(wagons * (tare + payload) + spec.massT);
  const consist = { wagons, lengthM: Math.round(wagons * (cat === 'passenger' ? 24.5 : 14.6) + 21), tareT: Math.round(wagons * tare), netT, grossT,
    axleLoadT: cat === 'passenger' ? 18 : loaded ? 23.5 : 21, loadPct: cat === 'passenger' ? Math.min(99, 38 + (h >>> 7) % 58) : loaded ? 88 + (h >>> 7) % 12 : 0,
    brakeCheckMin: -(10 + (h >>> 2) % 20), braking: loaded ? 'грузовой режим' : 'порожний режим' };
  if (cat === 'passenger') consist.braking = 'пассажирский режим';
  return { crew, loco: locoInfo, consist };
}

/** Все поезда сети в момент nowMs. */
export function networkTrains(sim, nowMs, options = {}) {
  countComputation('networkSnapshots');
  const execution = options.ignorePlan ? null : executionPlans.get(sim);
  if (!execution) return baseNetworkTrains(sim, nowMs, options);
  const out = baseNetworkTrains(sim, nowMs, options).filter(t => !execution.ids.has(t.uid));
  for (const row of execution.plan.optimized.rows) {
    if (row.departedMs > nowMs || (row.status === 'assigned' && row.arrival < nowMs)) continue;
    const service = execution.services.get(row.uid.slice(0, row.uid.lastIndexOf('@')));
    if (!service) continue;
    const assigned = row.status === 'assigned', waiting = !assigned || nowMs < row.departure;
    const shifted = waiting ? row.departedMs + 1 : nowMs - (row.departure - row.departedMs);
    const t = baseNetworkTrains(service, shifted).find(t => t.uid === row.uid);
    if (!t) continue;
    const offset = assigned ? row.departure - row.departedMs : 0;
    t.scheduledDeparture = row.departedMs; t.locoId = row.locoId;
    t.departedMs = assigned ? row.departure : null; t.arrivesMs = assigned ? row.arrival : null;
    if (assigned) { t.loco.series = row.assignedSeries; t.loco.type = row.traction === 'diesel' ? 'тепловоз' : 'электровоз'; }
    else t.loco = { ...t.loco, series: 'Не назначен', type: 'нет тяги', kw: 0, massT: 0 };
    t.extraMin += offset / 60000;
    if (waiting) {
      Object.assign(t, { waitingDeparture: true, stopped: true, planned: false, station: row.from, km: 0, progress: 0, speedKmh: 0,
        reason: assigned ? `Ожидание отправления по плану: ${row.reason}` : row.reason,
        waitedMin: (nowMs - row.departedMs) / 60000, delayMin: Math.floor((nowMs - row.departedMs) / 60000),
        restMin: assigned ? Math.ceil((row.departure - nowMs) / 60000) : 0 });
      const route = service.services[0].route, pos = locate(route, row.dir === 'fwd' ? 0 : route.km);
      t.lat = pos.lat; t.lon = pos.lon;
      t.crew = { ...t.crew, assignmentPending: true, changeReason: 'Явка бригады для ожидающего состава ещё не назначена' };
    }
    if (!options.exclude?.(t.lat, t.lon)) out.push(t);
  }
  return out;
}

function baseNetworkTrains(sim, nowMs, { exclude } = {}) {
  sim = sim.services ? sim : sim;
  const t = nowMs / 60000 + TZ;
  const out = [];
  for (const s of sim.services) {
    const mFrom = Math.floor((t - s.tMax - (hasIncidents(s.route) ? 900 : 0) - s.phase) / s.period), mTo = Math.floor((t - s.phase) / s.period);
    for (let m = mFrom; m <= mTo; m++) {
      const dep = s.phase + m * s.period;
      const uid = `${s.id}@${m}`;
      const profile = profileFor(sim, s, uid, dep);
      const e = t - dep;
      if (e < 0 || e > profile.total) continue;
      const st = stateAt(profile, e, s.route.km);
      const km = s.dir === 'fwd' ? st.km : s.route.km - st.km;
      const pos = locate(s.route, km);
      if (exclude?.(pos.lat, pos.lon)) continue;
      const h = hash(uid);
      const number = s.base + 2 * (((m % s.copies) + s.copies) % s.copies);
      const heading = s.dir === 'fwd' ? pos.heading : (pos.heading + 180) % 360;
      const from = s.dir === 'fwd' ? s.route.from : s.route.to, to = s.dir === 'fwd' ? s.route.to : s.route.from;
      const loaded = s.cat !== 'passenger' && h % 100 < (s.dir === 'fwd' ? 74 : 36);
      const delayNow = st.stopped && !st.planned ? Math.round(st.waitedMin) : 0;
      out.push({
        uid, number, category: s.cat, label: CATEGORIES[s.cat].label, routeId: s.route.id, route: s.route.name, from, to, dir: s.dir,
        km: Math.round(st.km * 10) / 10, totalKm: s.route.km, progress: st.km / s.route.km, lat: pos.lat, lon: pos.lon, heading,
        speedKmh: Math.round(st.speed), stopped: st.stopped, planned: Boolean(st.stopped && st.planned), reason: st.stopped ? st.reason : '', station: st.stopped ? st.station : '',
        restMin: st.stopped ? Math.round(st.restMin) : 0, waitedMin: st.stopped ? st.waitedMin : 0, delayMin: delayNow, extraMin: profile.extra,
        departedMs: (dep - TZ) * 60000, arrivesMs: Math.round((dep - TZ + profile.total) * 60000),
        ...(() => { const lc = locoOf(s.cat, s.route, h), wg = s.cat === 'passenger' ? 8 + (h % 9) : 45 + (h % 25), ch = characteristics(s, uid, profile, e, st, h, lc, wg, loaded); return { loco: ch.loco, wagons: wg, crew: ch.crew, consist: ch.consist }; })(),
        cargo: s.cat === 'container' ? 'контейнеры' : s.cat === 'freight' ? CARGO[h % CARGO.length] : null, loaded,
      });
    }
  }
  return out;
}

/** Полный прогноз остановок активного рейса — тот же профиль, что двигает поезд. */
export function networkItinerary(sim, train) {
  const sep = train.uid.lastIndexOf('@');
  const service = sim.services.find(s => s.id === train.uid.slice(0, sep));
  if (!service) return [];
  const profile = profileFor(sim, service, train.uid, service.phase + Number(train.uid.slice(sep + 1)) * service.period);
  if (train.departedMs === null) return [{ name: train.from, km: 0, arrival: train.scheduledDeparture, departure: null, reason: train.reason, planned: false }];
  return [
    { name: train.from, km: 0, arrival: train.waitingDeparture ? train.scheduledDeparture : train.departedMs, departure: train.departedMs, reason: train.waitingDeparture ? train.reason : 'отправление', planned: !train.waitingDeparture },
    ...profile.legs.filter(leg => !leg.silent).map(leg => ({ name: leg.name, km: leg.km, track: leg.track,
      arrival: Math.round(train.departedMs + leg.t * 60000), departure: Math.round(train.departedMs + (leg.t + leg.dwell) * 60000),
      reason: leg.reason, planned: leg.planned, crew: Boolean(leg.crew) })),
    { name: train.to, km: train.totalKm, arrival: train.arrivesMs, departure: null, reason: 'прибытие на конечную', planned: true },
  ];
}

/** Заявки на будущие рейсы из непрерывного расписания. */
export function scheduledTrips(sim, fromMs, toMs) {
  const out = [];
  for (const s of sim.services) {
    const from = fromMs / 60000 + TZ, to = toMs / 60000 + TZ;
    for (let m = Math.ceil((from - s.phase) / s.period); s.phase + m * s.period < to; m++) {
      const dep = s.phase + m * s.period, uid = `${s.id}@${m}`, profile = profileOf(s, uid), h = hash(uid);
      const wagons = s.cat === 'passenger' ? 8 + h % 9 : 45 + h % 25;
      const loaded = s.cat !== 'passenger' && h % 100 < (s.dir === 'fwd' ? 74 : 36);
      const ch = characteristics(s, uid, profile, 0, { stopped: true }, h, locoOf(s.cat, s.route, h), wagons, loaded);
      out.push({ uid, number: s.base + 2 * (((m % s.copies) + s.copies) % s.copies), category: s.cat, label: CATEGORIES[s.cat].label,
        routeId: s.route.id, route: s.route.name, dir: s.dir,
        from: s.dir === 'fwd' ? s.route.from : s.route.to, to: s.dir === 'fwd' ? s.route.to : s.route.from,
        departedMs: Math.round((dep - TZ) * 60000), arrivesMs: Math.round((dep - TZ + profile.total) * 60000),
        totalKm: s.route.km, electrified: s.route.electrified, wagons, loaded, consist: ch.consist, loco: ch.loco, crew: ch.crew,
        cargo: s.cat === 'container' ? 'контейнеры' : s.cat === 'freight' ? CARGO[h % CARGO.length] : null });
    }
  }
  return out.sort((a, b) => a.departedMs - b.departedMs || a.uid.localeCompare(b.uid));
}

/** Сводка по сети. */
export function networkStats(trains) {
  const by = c => trains.filter(t => t.category === c).length;
  const moving = trains.filter(t => !t.stopped);
  const stopped = trains.filter(t => t.stopped);
  const forced = stopped.filter(t => !t.planned);
  return {
    total: trains.length, passenger: by('passenger'), container: by('container'), freight: by('freight'),
    electric: trains.filter(t => t.loco.type === 'электровоз').length, diesel: trains.filter(t => t.loco.type === 'тепловоз').length,
    moving: moving.length, stopped: stopped.length, forced: forced.length, delayed: trains.filter(t => t.delayMin >= 15).length,
    avgSpeed: moving.length ? Math.round(moving.reduce((n, t) => n + t.speedKmh, 0) / moving.length) : 0,
    wagons: trains.reduce((n, t) => n + t.wagons, 0),
    passengers: trains.filter(t => t.category === 'passenger').reduce((n, t) => n + Math.round(t.wagons * 52 * t.consist.loadPct / 100), 0),
  };
}

const WEIGHT = { passenger: 10, container: 2, freight: 1 }; // как в модели участка: пассажирские ×10, транзит и контейнерные ×2, прочие ×1
const absKm = t => (t.dir === 'fwd' ? t.km : t.totalKm - t.km);
const eventMemo = new WeakMap();

// Build a minute ahead; reveal each event at its exact model timestamp.
// Repeated UI frames only filter the cached schedule, never rebuild the network.
export function networkEvents(sim, nowMs, windowMin = 360) {
  const execution = executionPlans.get(sim);
  if (!execution) return baseNetworkEvents(sim, nowMs, windowMin);
  const from = nowMs - windowMin * 60000;
  const events = baseNetworkEvents(sim, nowMs, windowMin).filter(e => !execution.ids.has(e.uid));
  for (const row of execution.plan.optimized.rows) {
    if (row.departedMs > nowMs || (row.status === 'assigned' && row.arrival < from)) continue;
    const service = execution.services.get(row.uid.slice(0, row.uid.lastIndexOf('@')));
    if (!service || row.status !== 'assigned') continue;
    const delta = row.departure - row.departedMs;
    for (const e of baseNetworkEvents(service, nowMs - delta, windowMin)) if (e.uid === row.uid) {
      const at = e.at + delta;
      events.push({ ...e, at, id: `${e.uid}:${e.kind}:${at}:${e.station}`, locoId: row.locoId, scheduleApplied: true });
    }
  }
  return events.sort((a, b) => b.at - a.at);
}

function baseNetworkEvents(sim, nowMs, windowMin = 360) {
  const slot = Math.floor(nowMs / 60000);
  let windows = eventMemo.get(sim);
  if (!windows) { windows = new Map(); eventMemo.set(sim, windows); }
  let cached = windows.get(windowMin);
  if (!cached || cached.slot !== slot || cached.rev !== incidentRevision) {
    cached = { slot, rev: incidentRevision, list: buildNetworkEvents(sim, (slot + 1) * 60000, windowMin + 1) };
    if (windows.size >= 8) windows.delete(windows.keys().next().value);
    windows.set(windowMin, cached);
  }
  const from = nowMs - windowMin * 60000;
  return cached.list.filter(e => e.at >= from && e.at <= nowMs);
}

/** События сети за последние windowMin минут: отправления, прибытия, стоянки (по расписанию и вынужденные). */
function buildNetworkEvents(sim, nowMs, windowMin = 360) {
  countComputation('eventWindows');
  const now = nowMs / 60000 + TZ, from = now - windowMin;
  const list = [];
  for (const s of sim.services) {
    const mFrom = Math.floor((from - s.tMax - (hasIncidents(s.route) ? 900 : 0) - s.phase) / s.period), mTo = Math.floor((now - s.phase) / s.period);
    const origin = s.dir === 'fwd' ? s.route.from : s.route.to, dest = s.dir === 'fwd' ? s.route.to : s.route.from;
    for (let m = mFrom; m <= mTo; m++) {
      const dep = s.phase + m * s.period;
      if (dep > now) continue;
      const uid = `${s.id}@${m}`, profile = profileFor(sim, s, uid, dep);
      if (dep + profile.total < from) continue;
      const realLegs = profile.legs.filter(l => !l.pseudo);
      const number = s.base + 2 * (((m % s.copies) + s.copies) % s.copies);
      const base = { uid, number, category: s.cat, label: CATEGORIES[s.cat].label, routeId: s.route.id, route: s.route.name };
      const hh = hash(uid);
      const push = (e, kind, station, text, forced = false, extra = null) => {
        const t = dep + e;
        if (t < from || t > now) return;
        const at = Math.round((t - TZ) * 60000);
        const explanation = {
          send: 'Отправление по рассчитанному графику после завершения предусмотренных операций.',
          accept: 'Приём предусмотрен маршрутом рейса; место и время определены графиком остановок.',
          crew: 'Замена бригады для соблюдения рабочего интервала и продолжения рейса без вынужденного ожидания.',
          yield: 'Пропуск поезда с большим весом приоритета: пассажирский ×10, контейнерный ×2, грузовой ×1.',
          hold: 'Стоянка до завершения операции или освобождения маршрута по профилю рейса.',
          repair: 'Движение остановлено на время устранения неисправности.',
          resolved: 'Завершён предусмотренный интервал ожидания; движение возобновлено.',
        }[kind];
        list.push({ ...base, id: `${uid}:${kind}:${at}:${station}`, at, kind, station, text, forced, explanation, ...extra });
      };
      const kindOf = reason => (/пропуск/.test(reason) ? 'yield' : /бригад/.test(reason) ? 'crew' : /неисправн/.test(reason) ? 'repair' : 'hold');
      push(0, 'send', origin, `Отправлен №${number} (${base.label.toLowerCase()}) со станции ${origin} в сторону ${dest}: путь свободен, маршрут задан`);
      s.stops.forEach((st, i) => {
        const leg = realLegs[i], track = `путь ${leg.track}`;
        if (leg.planned) {
          push(leg.t, 'accept', st.name, `Принят №${number} на станцию ${st.name}, ${track}: плановая стоянка ${leg.dwell} мин`, false, { dwell: leg.dwell });
          if (leg.crew) {
            const h = Math.floor(leg.workedMin / 60), m = leg.workedMin % 60;
            push(leg.t + leg.dwell, 'crew', st.name, `Смена бригады поезда №${number} на ${st.name}: до прибытия отработано ${h} ч ${m} мин. Без замены к ${leg.nextStation} получится ${leg.projectedMin} мин при плановой смене ${profile.limit} мин. Приёмка новой бригадой завершена; отдых прежней определяется её графиком.`, false, { workedMin: leg.workedMin, projectedMin: leg.projectedMin, limitMin: profile.limit });
          }
          push(leg.t + leg.dwell, 'send', st.name, `Отправлен №${number} со станции ${st.name}${leg.crew ? ' после смены бригады' : ''}: путь свободен`);
        } else {
          const kind = kindOf(leg.reason);
          const text = {
            yield: `№${number} (${base.label.toLowerCase()}) уступил путь приоритетному поезду на ${st.name}: решение «пропустить»`,
            crew: `№${number} задержан на ${st.name}: бригада вышла за предел работы, ожидает замену`,
            repair: `№${number} остановлен на ${st.name}: неисправность, вызвана бригада осмотрщиков`,
            hold: `№${number} (${base.label.toLowerCase()}) задержан на ${st.name}: ${leg.reason}`,
          }[kind];
          const benW = s.cat === 'freight' ? (hh % 100 < 60 ? 10 : 2) : s.cat === 'container' ? 10 : 10;
          const avoided = 12 + (hh >>> 4) % 14;
          const saving = kind === 'yield' ? { savedMin: avoided, savedWeighted: Math.max(0, avoided * benW - leg.dwell * WEIGHT[s.cat]), calculation: `Приоритетному: ${avoided} мин × ${benW}; собственный простой: ${leg.dwell} мин × ${WEIGHT[s.cat]}. Чистый эффект: ${avoided * benW - leg.dwell * WEIGHT[s.cat]} взвешенных мин. В положительную экономию входит max(0, эффект).` } : null;
          push(leg.t, kind, st.name, text, true, { dwell: leg.dwell, ...saving });
          const done = { yield: `приоритетный поезд пропущен`, crew: `бригада заменена`, repair: `неисправность устранена`, hold: `${leg.reason}: вопрос решён` }[kind];
          push(leg.t + leg.dwell, 'resolved', st.name, `Проблема решена на ${st.name}: ${done}. №${number} отправлен после ${leg.dwell} мин простоя`, false, { dwell: leg.dwell, cause: kind });
        }
      });
      for (const leg of profile.legs) {
        if (!leg.pseudo || leg.silent || leg.dwell < 0.5) continue;
        const inc = incidentList.find(i => i.id === leg.incidentId);
        const kind = inc?.kind === 'breakdown' ? 'repair' : 'hold';
        push(leg.t, kind, leg.name, `№${number} (${base.label.toLowerCase()}) остановлен перед зоной: ${leg.reason}`, true, { dwell: Math.round(leg.dwell), incidentId: leg.incidentId });
        push(leg.t + leg.dwell, 'resolved', leg.name, `Проблема решена: ограничение снято для №${number}, поезд продолжил движение после ${Math.round(leg.dwell)} мин ожидания`, false, { dwell: Math.round(leg.dwell), cause: kind, incidentId: leg.incidentId });
      }
      push(profile.total, 'accept', dest, `Принят №${number} на станцию назначения ${dest} (${s.route.name}), разгрузка и расформирование`);
    }
  }
  list.sort((a, b) => b.at - a.at);
  return list;
}

/**
 * Разбор вынужденных стоянок сети. Для каждой стоянки ищем более приоритетный поезд поблизости, ради которого
 * мог быть задержан этот, и сравниваем взвешенную потерю: держать поезд (вес × его простой) или отправить
 * и заставить ждать приоритетный. Вес — как в модели участка.
 */
export function networkDecisions(trains) {
  const byRoute = new Map();
  for (const t of trains) { if (!byRoute.has(t.routeId)) byRoute.set(t.routeId, []); byRoute.get(t.routeId).push(t); }
  const out = [];
  for (const t of trains) {
    if (!t.stopped || t.planned) continue;
    const holdMin = Math.max(1, t.delayMin + t.restMin);
    const ownCost = holdMin * WEIGHT[t.category];
    const mine = absKm(t);
    const traffic = /пропуск|свободного пути/.test(t.reason);
    let who = null;
    if (traffic) {
      for (const o of byRoute.get(t.routeId) || []) {
        if (o.uid === t.uid || WEIGHT[o.category] <= WEIGHT[t.category] || (o.stopped && !o.planned)) continue;
        const there = absKm(o), gap = Math.abs(there - mine);
        const opposite = o.dir !== t.dir, approaching = opposite ? (t.dir === 'fwd' ? there > mine : there < mine) : (t.dir === 'fwd' ? there < mine : there > mine);
        if (!approaching || gap > 160) continue;
        if (!who || gap < who.gap) who = { train: o, gap: Math.round(gap), opposite };
      }
    }
    let options, chosen, verdict, why;
    if (who) {
      const o = who.train;
      const wait = Math.max(10, Math.round(who.gap / Math.max(30, o.speedKmh || 60) * 60 * 0.35));
      const otherCost = wait * WEIGHT[o.category];
      options = [
        { id: 'hold', name: `Задержать №${t.number} на станции`, detail: `${t.label.toLowerCase()} стоит ${holdMin} мин × вес ${WEIGHT[t.category]}`, cost: ownCost },
        { id: 'go', name: `Отправить №${t.number}, пропустить после него №${o.number}`, detail: `${o.label.toLowerCase()} ждёт около ${wait} мин × вес ${WEIGHT[o.category]}`, cost: otherCost },
      ];
      chosen = ownCost <= otherCost ? 'hold' : 'go';
      verdict = chosen === 'hold' ? 'justified' : 'shorten';
      why = chosen === 'hold'
        ? `Потеря ${ownCost} против ${otherCost}: выгоднее задержать ${t.label.toLowerCase()} поезд и пропустить ${who.opposite ? 'встречный' : 'догоняющий'} ${o.label.toLowerCase()} №${o.number} (${who.gap} км до станции). Приоритетный поезд не теряет ход.`
        : `Потеря ${ownCost} против ${otherCost}: стоянка слишком дорогая для вашего веса поезда. Стоит сократить простой и отправить №${t.number} вперёд — суммарные потери упадут на ${ownCost - otherCost}.`;
    } else {
      options = [{ id: 'hold', name: `Задержать №${t.number} на станции`, detail: `стоит ${holdMin} мин × вес ${WEIGHT[t.category]}`, cost: ownCost }];
      chosen = 'hold'; verdict = 'technical';
      why = traffic ? 'Приоритетных поездов рядом нет, ожидание вызвано занятостью пути; решение диспетчера не требуется.' : `Причина технологическая («${t.reason}»): задержка не связана с очерёдностью пропуска, поезд отправится после её устранения.`;
    }
    out.push({ id: t.uid, train: t, station: t.station, who: who?.train || null, gap: who?.gap ?? null, options, chosen, verdict, why, holdMin, ownCost });
  }
  return out.sort((a, b) => b.ownCost - a.ownCost);
}

/** Параметры модели для страницы «Модель»: всё, что определяет расчёт, в одном месте. */
export const MODEL_PARAMS = {
  weights: WEIGHT,
  headwayMin: { same: HEAD_SAME, opposite: HEAD_OPPOSITE },
  wrongTrackKmh: WRONG_TRACK_KMH,
  crewLimitMin: CREW_LIMIT_MIN,
  repairsPerDay: NETWORK_REPAIRS_PER_DAY,
  averageKmh: { passengerElectric: 92, passengerDiesel: 76, container: 60, freight: 44 },
  categories: CATEGORIES,
  variants: INCIDENT_VARIANTS,
  tz: TZ,
};
