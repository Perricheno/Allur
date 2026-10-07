import { CORRIDOR } from './rail-corridor.js';
// Мир модели: станции, непрерывное суточное расписание, характеристики и ТО поездов,
// автономная работа станций и случайные события. Расписание строится из шаблонов по текущему времени,
// поэтому смены нет: поезда появляются и уходят сами, а состояние можно сохранять на диск.
import { getPlan, touchPlan, directionOf, nowMinutes, locateAt, activeClosures } from './dispatch.js';

export const TZ_OFFSET = 300; // Asia/Almaty, минут от UTC
export const DAY = 1440;
const minute = 60_000;
const hour = 3_600_000;
// В интерфейсе держим только ближайшие рейсы: диспетчеру не нужна вся смена сразу.
const HORIZON = 150; // поезда создаются за 2,5 часа до отправления
const MAX_VISIBLE_TRAINS = 25;

/** Начало суток (локальных) для момента ms. */
export const dayStart = ms => Math.floor((ms + TZ_OFFSET * minute) / 86_400_000) * 86_400_000 - TZ_OFFSET * minute;

// География реального участка; грузовые мощности и расписание остаются учебными.
export const STATIONS = [
  ['A', 'Караганда', 'Участковая', 0, [['Грузовая площадка', 'grain', 60, 24, 60], ['Контейнерный путь', 'container', 60, 24, 90], ['Угольный путь', 'coal', 60, 24, 70]]],
  ['B', 'Карабас', 'Промежуточная', 28.7, [['Зерновая площадка', 'grain', 40, 20, 60], ['Угольный путь', 'coal', 40, 20, 70]]],
  ['C', 'Шерубайнура', 'Промежуточная', 46.6, [['Угольный путь', 'coal', 40, 20, 70], ['Наливной путь', 'oil', 40, 20, 80]]],
  ['D', 'Дария', 'Грузовая', 91.6, [['Зерновой терминал', 'grain', 30, 16, 30], ['Элеватор', 'grain', 30, 10, 60], ['Контейнерная площадка', 'container', 40, 12, 90]]],
  ['E', 'Жарык', 'Промежуточная', 120.5, [['Контейнерный путь', 'container', 40, 20, 90], ['Металловозный путь', 'metal', 40, 20, 80]]],
  ['F', 'Агадыр', 'Промежуточная', 198.3, [['Зерновая площадка', 'grain', 40, 20, 60], ['Контейнерный путь', 'container', 40, 20, 90]]],
  ['G', 'Босага', 'Промежуточная', 243.0, [['Наливной путь', 'oil', 40, 20, 80], ['Металловозный путь', 'metal', 40, 20, 80]]],
  ['H', 'Акшагыл', 'Промежуточная', 267.4, [['Угольный путь', 'coal', 40, 20, 70], ['Зерновая площадка', 'grain', 40, 20, 60]]],
  ['I', 'Киикти', 'Промежуточная', 287.7, [['Контейнерный путь', 'container', 40, 20, 90], ['Зерновая площадка', 'grain', 40, 20, 60]]],
  ['J', 'Мойынты', 'Сортировочная', 336.5, [['Контейнерный терминал', 'container', 80, 24, 90], ['Металловозный путь', 'metal', 60, 20, 80], ['Наливной путь', 'oil', 60, 20, 80]]],
];
// Keep operational station IDs, sidings and queues stable when geographic metadata changes.
export function refreshStationGeography(state) {
  for (const station of state.stations) {
    const geo = CORRIDOR.stations.find(s => s.id === station.id);
    if (geo) Object.assign(station, { name: geo.name, km: geo.km, coordinate: geo.coordinate, osmNode: geo.osmNode });
  }
  for (const group of state.groups) {
    const train = state.trains.find(t => t.number === group.train);
    if (train) {
      const from = state.stations[train.route[0][1]], to = state.stations[train.route.at(-1)[1]];
      group.origin = from?.name ?? group.origin;
      if (from && to) group.km = Math.abs(to.km - from.km);
    }
  }
}

export const cargoNames = { grain: 'Зерно', container: 'Контейнеры', coal: 'Уголь', oil: 'Нефтепродукты', metal: 'Металл' };

// ---------- детерминированные случайные числа ----------
function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Случайное число для событий; состояние генератора хранится в state.seed. */
function rand(state) { const r = mulberry(state.seed); state.seed = (state.seed + 0x9E3779B9) >>> 0; return r(); }
const between = (r, a, b) => Math.round(a + r() * (b - a));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

export function event(state, text) {
  state.revision += 1;
  state.log.unshift({ at: state.now, text });
  state.log = state.log.slice(0, 200);
}
const clockText = (state, min) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }).format(state.origin + min * minute);

// ---------- шаблоны суточного расписания ----------
const KINDS = {
  passenger: { category: 'passenger', priority: 1, label: 'Пассажирский', avg: 78, max: 140, wagons: [12, 18], tech: [40, 60], locos: [['KZ8A', 'электровоз', 7200], ['KZ4AT', 'электровоз', 6400], ['ТЭП70БС', 'тепловоз', 2950]] },
  container: { category: 'container', priority: 2, label: 'Контейнерный', avg: 62, max: 100, wagons: [40, 60], tech: [16, 90], locos: [['KZ4AT', 'электровоз', 6400], ['KZ8A', 'электровоз', 7200], ['2ЭС5К', 'электровоз', 6560]] },
  transit: { category: 'freight', priority: 2, label: 'Транзитный грузовой', avg: 52, max: 90, wagons: [45, 68], tech: [28, 120], locos: [['2ЭС5К', 'электровоз', 6560], ['ТЭ33А', 'тепловоз', 3100], ['KZ4AT', 'электровоз', 6400]] },
  local: { category: 'freight', priority: 3, label: 'Сборный', avg: 38, max: 80, wagons: [18, 36], tech: [20, 150], locos: [['ТЭМ18ДМ', 'тепловоз', 880], ['ТЭ33А', 'тепловоз', 3100], ['ВЛ80С', 'электровоз', 6520]] },
};

function buildTemplates() {
  const t = [];
  const add = (number, kind, from, to, dep, extra = {}) => t.push({ id: String(number), kind, from, to, dep: ((dep % DAY) + DAY) % DAY, ...extra });
  // Пассажирские: чётные A→J, нечётные J→A.
  [155, 370, 575, 800, 1025, 1290].forEach((d, i) => add(160 + i * 2, 'passenger', 0, 9, d));
  [255, 510, 650, 900, 1160, 1390].forEach((d, i) => add(151 + i * 2, 'passenger', 9, 0, d));
  // Контейнерные между станциями с контейнерными путями.
  [[2002, 0, 9, 60], [2004, 3, 9, 200], [2006, 0, 5, 340], [2008, 4, 9, 480], [2010, 0, 9, 620], [2012, 3, 8, 760], [2014, 0, 5, 900], [2016, 0, 9, 1040], [2018, 4, 9, 1180], [2020, 3, 9, 1320],
    [2001, 9, 0, 130], [2003, 9, 3, 270], [2005, 5, 0, 410], [2007, 9, 4, 550], [2009, 9, 0, 690], [2011, 8, 3, 830], [2013, 5, 0, 970], [2015, 9, 0, 1110], [2017, 9, 4, 1250], [2019, 9, 3, 1390]]
    .forEach(([n, a, b, d]) => add(n, 'container', a, b, d));
  // Транзитные грузовые: 24 пары, концы чередуются.
  const spans = [[0, 9], [1, 9], [0, 8], [2, 9], [0, 7], [1, 8]];
  for (let i = 0; i < 24; i++) {
    const even = i % 2 === 0;
    const [a, b] = spans[Math.floor(i / 2) % spans.length];
    add(3400 + i * 2 + (even ? 0 : 1), 'transit', even ? a : b, even ? b : a, i * 60 + 25 + ((i * 17) % 35));
  }
  // Сборные: короткие плечи с работой на промежуточных станциях.
  [[0, 3], [3, 0], [1, 6], [6, 1], [2, 7], [7, 2], [3, 9], [9, 3], [0, 5], [5, 0], [4, 8], [8, 4], [1, 5], [5, 1], [6, 9], [9, 6]]
    .forEach(([a, b], i) => add(3100 + i * 2 + (b > a ? 0 : 1), 'local', a, b, i * 90 + 40));
  return t;
}
export const TEMPLATES = buildTemplates();

/** Грузы, которые принимает станция. */
const cargosOf = idx => [...new Set(STATIONS[idx][4].map(t => t[1]))];

function buildRoute(tpl, depAbs, avg, r) {
  const step = tpl.to > tpl.from ? 1 : -1;
  const route = [[depAbs, tpl.from]];
  let t = depAbs;
  for (let i = tpl.from; i !== tpl.to; i += step) {
    const leg = Math.abs(STATIONS[i + step][3] - STATIONS[i][3]);
    t += Math.max(6, Math.round(leg / avg * 60));
    route.push([t, i + step]);
    // сборный поезд работает на промежуточных станциях
    if (tpl.kind === 'local' && i + step !== tpl.to && r() < 0.55) { t += between(r, 10, 26); route.push([t, i + step]); }
  }
  return route;
}

function loadFor(kind, r) {
  if (kind === 'passenger') return between(r, 22, 96);
  if (kind === 'container') return between(r, 45, 100);
  if (kind === 'transit') return between(r, 70, 100);
  return between(r, 35, 100);
}

/** Один поезд расписания на конкретные сутки. Все «случайные» характеристики зависят только от (номер, сутки). */
function instantiate(state, tpl, day) {
  const k = KINDS[tpl.kind];
  const r = mulberry(hash(`${tpl.id}:${day}`));
  const wagons = between(r, ...k.wagons);
  const loadPct = loadFor(tpl.kind, r);
  const avg = Math.round(k.avg * (tpl.kind === 'passenger' ? 1 : 1 - 0.12 * loadPct / 100) * (0.95 + r() * 0.1));
  const loco = pick(r, k.locos);
  const [series, locoType, powerKw] = loco;
  // техническое обслуживание: перед рейсом, если пора
  const stock = (state.tech[tpl.id] ||= { lastServiceAt: state.origin - between(r, 1, k.tech[0]) * hour });
  let depAbs = day * DAY + tpl.dep;
  const sinceH = (state.origin + depAbs * minute - stock.lastServiceAt) / hour;
  let service = null;
  const tech = { intervalH: k.tech[0], durationMin: k.tech[1], lastServiceAt: stock.lastServiceAt };
  if (sinceH >= k.tech[0]) {
    service = { from: depAbs, to: depAbs + k.tech[1], reason: `пробег ${Math.round(sinceH)} ч с прошлого ТО (норма ${k.tech[0]} ч)` };
    depAbs += k.tech[1];
    stock.lastServiceAt = state.origin + depAbs * minute;
    tech.lastServiceAt = stock.lastServiceAt;
  }
  const route = buildRoute(tpl, depAbs, avg, r);
  const priorityBase = tpl.kind === 'passenger' ? 1 : tpl.kind === 'container' ? 2 : tpl.kind === 'transit' ? 2 : 3;
  const train = {
    uid: `${tpl.id}@${day}`, number: tpl.id, kind: tpl.kind, category: k.category, label: k.label, priority: priorityBase,
    wagons, route, service, tech,
    loadPct, loco: { series, type: locoType, powerKw, number: String(1000 + Math.floor(r() * 8999)) },
    lengthM: Math.round(wagons * (tpl.kind === 'passenger' ? 24.5 : 14.6) + 33),
    avgKmh: avg, maxKmh: k.max,
    crewPriorHours: Math.round(r() * 30) / 10,
    healthJitter: Math.round(r() * 7),
  };
  train.grossT = tpl.kind === 'passenger' ? Math.round(wagons * (52 + loadPct * 0.08)) : Math.round(wagons * (24 + loadPct / 100 * 62) + 190);
  train.axleLoadT = tpl.kind === 'passenger' ? 17.5 : Math.round((20 + loadPct / 100 * 3.8) * 10) / 10;
  if (tpl.kind !== 'passenger') {
    const dest = tpl.to;
    const pool = cargosOf(dest);
    const bulk = pool.filter(c => c !== 'container');
    train.cargo = tpl.kind === 'container' ? 'container' : pick(r, bulk.length ? bulk : pool);
    const tracks = STATIONS[dest][4].filter(t => t[1] === train.cargo);
    const cap = Math.max(...tracks.map(t => t[2]), 10);
    train.deadlineHours = tpl.kind === 'transit' ? between(r, 20, 60) : tpl.kind === 'container' ? between(r, 36, 72) : between(r, 60, 110);
    if (tpl.kind === 'transit') { train.priority = train.deadlineHours <= 48 ? 2 : 3; train.label = train.deadlineHours <= 24 ? 'Срочный грузовой' : train.priority === 2 ? 'Транзитный грузовой' : 'Сборный'; }
    train.cargoWagons = Math.min(cap, Math.max(4, Math.round(wagons * loadPct / 100)));
    train.cargoT = Math.round(train.cargoWagons * 62 * 0.95);
  }
  return train;
}

function makeGroup(state, train) {
  const dest = train.route.at(-1)[1];
  const origin = STATIONS[train.route[0][1]];
  state.seq += 1;
  return {
    id: `${STATIONS[dest][0]}-G${state.seq}`, stationId: STATIONS[dest][0], train: train.number, uid: train.uid,
    origin: origin[1], cargo: train.cargo, count: train.cargoWagons,
    km: Math.abs(STATIONS[dest][3] - origin[3]),
    etaAt: state.origin + train.route.at(-1)[0] * minute,
    deadlineAt: state.origin + (train.route[0][0] + train.deadlineHours * 60) * minute,
    status: 'approaching', trackId: null,
  };
}

/** Создаёт поезда, которым пора появиться, и убирает прибывшие. Возвращает true, если список изменился. */
export function ensureTrains(state) {
  const t = nowMinutes(state);
  const day = Math.floor(t / DAY);
  let changed = false;
  // Одна группа вагонов на рейс: защита от дублей (в том числе в старом сохранённом состоянии).
  const uniq = new Set();
  const groups = state.groups.filter(g => { if (g.status !== 'approaching') return true; if (uniq.has(g.uid)) return false; uniq.add(g.uid); return true; });
  if (groups.length !== state.groups.length) state.groups = groups;
  // После перезапуска старое сохранение может содержать прежнее широкое окно рейсов.
  // Сохраняем идущие поезда и ближайшие отправления, чтобы список не превышал лимит.
  if (state.trains.length > MAX_VISIBLE_TRAINS) {
    const relevance = train => {
      const start = train.route[0][0];
      const end = train.route.at(-1)[0];
      if (end < t) return 1_000_000 + t - end;
      if (start <= t) return train.priority;
      return 10_000 + start - t + train.priority;
    };
    const keep = new Set([...state.trains]
      .sort((a, b) => relevance(a) - relevance(b))
      .slice(0, MAX_VISIBLE_TRAINS)
      .map(train => train.uid));
    for (const train of [...state.trains]) if (!keep.has(train.uid)) removeTrain(state, train);
    changed = true;
  }
  const have = new Set(state.trains.map(x => x.uid));
  for (let d = day - 1; d <= day + 1; d++) {
    for (const tpl of TEMPLATES) {
      const uid = `${tpl.id}@${d}`;
      if (have.has(uid) || uid in state.seen) continue;
      if (state.trains.length >= MAX_VISIBLE_TRAINS) continue;
      const dep = d * DAY + tpl.dep;
      if (dep > t + HORIZON || dep + 720 < t - 60) continue;
      if (state.trains.some(x => x.number === tpl.id && x.uid !== uid && x.route[0][0] > dep)) continue; // более новый уже есть
      // предыдущий поезд с этим номером должен быть снят
      for (const old of state.trains.filter(x => x.number === tpl.id)) removeTrain(state, old);
      const train = instantiate(state, tpl, d);
      if (train.route.at(-1)[0] < t - 60) { state.seen[uid] = d; continue; } // уже давно прибыл
      state.trains.push(train);
      state.seen[uid] = d;
      if (train.cargo) state.groups.push(makeGroup(state, train));
      have.add(uid); changed = true;
    }
  }
  if (changed) touchPlan(state);
  for (const uid of Object.keys(state.seen)) if (state.seen[uid] < day - 3) delete state.seen[uid];
  // убираем прибывшие
  const plan = getPlan(state);
  const gone = state.trains.filter(tr => plan.byTrain[tr.number].forecast.at(-1)[0] + 30 < t);
  for (const tr of gone) removeTrain(state, tr);
  if (gone.length) { touchPlan(state); changed = true; }
  return changed;
}

function removeTrain(state, train) {
  state.trains = state.trains.filter(x => x !== train);
  state.holds = state.holds.filter(h => h.train !== train.number);
  delete state.overrides[train.number];
  delete state.notified[train.number];
  state.incidents = state.incidents.filter(i => i.train !== train.number);
  touchPlan(state);
}

// ---------- станции: начальная загрузка и автономная работа ----------
export function createStations(_, now) {
  const r = mulberry(hash('stations'));
  return STATIONS.map(([id, name, type, km, tracks]) => ({
    id, name, type, km, coordinate: CORRIDOR.stations.find(s => s.id === id).coordinate,
    tracks: tracks.map(([tname, cargo, capacity, front, duration], i) => {
      const processing = r() < 0.7 ? between(r, 0, front) : 0;
      const done = r() < 0.6 ? between(r, 0, Math.floor(capacity * 0.35)) : 0;
      return { id: `${id}-${i + 1}`, number: i + 1, name: tname, cargo, capacity, front, processing, done, waiting: 0, duration,
        finishAt: now + between(r, 8, duration) * minute, doneAt: now - between(r, 0, 25) * minute, productivity: Math.max(2, Math.round(front * 60 / duration)) };
    }),
  }));
}

export function completeOperations(state) {
  let changed = false;
  for (const station of state.stations) for (const t of station.tracks) {
    if (t.processing && t.finishAt <= state.now) { t.done += t.processing; t.processing = 0; t.doneAt = state.now; changed = true; }
  }
  return changed;
}

/** Уборка обработанных вагонов и подача следующих (общая для диспетчера и автоматики). */
export function clearTrack(state, station, t) {
  const count = t.done; t.done = 0;
  const start = Math.min(t.waiting, t.front - t.processing);
  t.waiting -= start; t.processing += start;
  if (start) t.finishAt = state.now + t.duration * minute;
  return count;
}

/** Автоматическая работа станций (уборка через 30 минут после обработки, приём прибывших групп через 20 минут) и уборка устаревших записей. */
export function stationOps(state, accept, groupView) {
  let changed = false;
  if (state.auto.stations) {
    for (const station of state.stations) for (const t of station.tracks) {
      if (t.done > 0 && state.now - t.doneAt >= 30 * minute) { clearTrack(state, station, t); changed = true; }
    }
    const plan = getPlan(state);
    for (const g of state.groups) {
      if (g.status !== 'approaching') continue;
      const view = groupView(state, g, plan);
      if (view.eligible && view.etaAt <= state.now - 20 * minute) { accept(state, g); changed = true; }
    }
  }
  // Уборка записей: непринятые группы теряют актуальность через сутки, принятые забываются через 6 часов.
  const before = state.groups.length;
  state.groups = state.groups.filter(g => !((g.status === 'approaching' && g.etaAt < state.now - 24 * hour)
    || (g.status === 'arrived' && state.now - (g.arrivedAt || state.now) > 6 * hour)));
  return changed || state.groups.length !== before;
}

// ---------- события на участке ----------
export const BREAKDOWN_LEVELS = {
  1: { name: 'Лёгкая', short: 'Без остановки', text: 'Поезд идёт до конца рейса с ограничением скорости 40 км/ч.' },
  2: { name: 'Средняя', short: 'Остановка и продолжение', text: 'Поезд останавливается на 15–40 минут для устранения, затем продолжает рейс.' },
  3: { name: 'Тяжёлая', short: 'Снят с рейса', text: 'Поезд обездвижен до прибытия резервного локомотива (1,5–3 часа) и снимается с рейса; его путь на перегоне занят.' },
  4: { name: 'Критическая', short: 'Сход, оба пути закрыты', text: 'Сход или авария: на перегоне закрыты оба пути на 4–8 часов, поезд снят с рейса.' },
};
export const BREAKDOWN_TYPES = {
  wheelset: { name: 'Неисправность колёсной пары', levels: [1, 2, 3] },
  brakes: { name: 'Отказ тормозов', levels: [1, 2, 3] },
  overheat: { name: 'Перегрев буксы', levels: [1, 2] },
  cargo: { name: 'Смещение груза', levels: [1, 2] },
  coupling: { name: 'Обрыв автосцепки', levels: [2, 3] },
  loco: { name: 'Отказ локомотива', levels: [2, 3] },
  derail: { name: 'Сход подвижного состава', levels: [4] },
};
const defaultType = level => ({ 1: 'overheat', 2: 'coupling', 3: 'loco', 4: 'derail' }[level]);

/** Поломка поезда. Возвращает созданное происшествие. */
export function createBreakdown(state, trainNumber, level, typeId, opts = {}) {
  const train = state.trains.find(t => t.number === trainNumber);
  if (!train) throw new Error('Поезд не найден');
  if (!BREAKDOWN_LEVELS[level]) throw new Error('Уровень поломки: от 1 до 4');
  const type = typeId || defaultType(level);
  if (!BREAKDOWN_TYPES[type]?.levels.includes(level)) throw new Error('Такая неисправность не бывает на этом уровне');
  if (state.incidents.some(i => i.kind === 'breakdown' && i.train === trainNumber)) throw new Error('С этим поездом уже случилась поломка');
  const tNow = nowMinutes(state);
  const forecast = getPlan(state).byTrain[trainNumber].forecast;
  const here = locateAt(forecast, tNow);
  if (here.kind === 'before' || here.kind === 'after') throw new Error('Поезд сейчас не на линии');
  const r = opts.r || (() => rand(state));
  const duration = level === 1 ? 0 : level === 2 ? between(r, 15, 40) : level === 3 ? between(r, 90, 180) : between(r, 240, 480);
  const dir = directionOf(train);
  const mid = here.kind === 'move';
  const pos = mid ? here.pos : here.idx;
  const incident = { id: `bd-${state.seq += 1}`, kind: 'breakdown', train: trainNumber, level, type, from: tNow, duration, pos, auto: Boolean(opts.auto),
    label: `№${trainNumber}: ${BREAKDOWN_TYPES[type].name} (${BREAKDOWN_LEVELS[level].name.toLowerCase()})`, createdAt: state.now };
  if (level === 1) incident.capFactor = Math.max(1, train.avgKmh / 40);
  // закрытие пути на перегоне, где стоит поезд
  let segment = null;
  if (level >= 2 && mid) segment = Math.floor(Math.min(here.from, here.to));
  if (level === 4 && !mid) segment = dir === 'even' ? Math.min(here.idx, STATIONS.length - 2) : Math.max(here.idx - 1, 0);
  if (segment !== null) {
    incident.segment = segment;
    incident.track = level === 4 ? 'both' : dir;
    incident.until = tNow + duration;
  }
  state.incidents.push(incident);
  if (incident.track) { state.planApproved = false; state.variant = null; state.awaitingSince = tNow; }
  touchPlan(state);
  return incident;
}

export function createClosure(state, { segment, track, minutes, from, label, auto }) {
  if (!Number.isInteger(segment) || segment < 0 || segment >= STATIONS.length - 1) throw new Error('Некорректный перегон');
  if (!['odd', 'even', 'both'].includes(track)) throw new Error('Путь: нечётный, чётный или оба');
  if (minutes != null && !(Number.isFinite(minutes) && minutes >= 15 && minutes <= 720)) throw new Error('Длительность закрытия: от 15 минут до 12 часов');
  if (track === 'both' && minutes == null) throw new Error('Для закрытия обоих путей укажите длительность');
  const t0 = from ?? nowMinutes(state);
  const incident = { id: `cl-${state.seq += 1}`, kind: 'closure', segment, track, from: t0, until: minutes == null ? null : t0 + minutes, auto: Boolean(auto),
    label: label || 'Закрытие пути', createdAt: state.now };
  state.incidents.push(incident);
  state.planApproved = false; state.variant = null; state.awaitingSince = t0;
  touchPlan(state);
  return incident;
}

/** Убирает завершившиеся происшествия и ограничения скорости. */
export function expireIncidents(state) {
  const t = nowMinutes(state);
  const wasClosed = activeClosures(state).length;
  const ended = state.incidents.filter(i => i.until != null && i.until <= t && !(i.kind === 'breakdown' && i.level >= 3 && state.trains.some(x => x.number === i.train)));
  const restricted = (state.restrictions || []).filter(r => r.until != null && r.until <= t);
  if (!ended.length && !restricted.length) return false;
  for (const i of ended) {
    state.incidents = state.incidents.filter(x => x !== i);
    if (i.track) event(state, i.kind === 'breakdown'
      ? `${i.label}: устранено, путь на перегоне ${STATIONS[i.segment][0]}–${STATIONS[i.segment + 1][0]} открыт.`
      : `${i.label}: перегон ${STATIONS[i.segment][0]}–${STATIONS[i.segment + 1][0]} открыт.`);
  }
  state.restrictions = (state.restrictions || []).filter(r => !restricted.includes(r));
  for (const r of restricted) event(state, `Ограничение скорости ${r.kmh} км/ч на перегоне ${STATIONS[r.segment][0]}–${STATIONS[r.segment + 1][0]} закончилось.`);
  if (wasClosed && !activeClosures(state).length) { state.planApproved = false; state.variant = null; state.awaitingSince = null; }
  touchPlan(state);
  return true;
}

// ---------- случайные события ----------
const INTENSITY = { off: 0, low: 1, normal: 3, high: 8 };
export const INTENSITIES = Object.keys(INTENSITY);
// События в час при «низкой» интенсивности.
const RATES = { minor: 0.2, medium: 0.07, serious: 0.025, critical: 0.006, window: 0.035, restriction: 0.05 };

/** Само случающиеся происшествия: поломки поездов, окна на ремонт, ограничения скорости. */
export function autoEvents(state, dtMin) {
  const mult = INTENSITY[state.auto.intensity] ?? 0;
  if (!mult) return false;
  let changed = false;
  const chance = rate => 1 - Math.exp(-rate * mult * dtMin / 60);
  const t = nowMinutes(state);
  const day = dayStart(state.now);
  if (state.autoBreakdownBudget?.day !== day) {
    state.autoBreakdownBudget = { day, count: state.incidents.filter(i => i.kind === 'breakdown' && i.auto && i.createdAt >= day).length };
  }
  const onLine = () => state.trains.filter(tr => {
    const here = locateAt(getPlan(state).byTrain[tr.number].forecast, t);
    return (here.kind === 'move' || here.kind === 'wait') && !state.incidents.some(i => i.train === tr.number);
  });
  const levelOf = { minor: 1, medium: 2, serious: 3, critical: 4 };
  for (const [name, level] of Object.entries(levelOf)) {
    if (state.autoBreakdownBudget.count >= 2) break;
    if (rand(state) >= chance(RATES[name])) continue;
    const candidates = onLine();
    if (!candidates.length) continue;
    // тяжёлые поломки реже у пассажирских и чаще у тяжёлых грузовых
    const train = candidates[Math.floor(rand(state) * candidates.length)];
    const types = Object.entries(BREAKDOWN_TYPES).filter(([, v]) => v.levels.includes(level)).map(([k]) => k);
    try {
      const inc = createBreakdown(state, train.number, level, types[Math.floor(rand(state) * types.length)], { auto: true });
      state.autoBreakdownBudget.count += 1;
      event(state, `Поломка: ${inc.label}. ${BREAKDOWN_LEVELS[level].text}`);
      changed = true;
    } catch { /* поезд уже сошёл с линии */ }
  }
  if (rand(state) < chance(RATES.window)) {
    const segment = Math.floor(rand(state) * (STATIONS.length - 1));
    const track = rand(state) < 0.5 ? 'odd' : 'even';
    const minutes = between(() => rand(state), 60, 150);
    const lead = between(() => rand(state), 15, 60);
    const closure = createClosure(state, { segment, track, minutes, from: t + lead, label: 'Плановое окно: ремонт пути', auto: true });
    // после окна — ограничения скорости: первый поезд 25 км/ч, следующие 40
    const end = closure.until;
    state.restrictions.push({ segment, kmh: 25, from: end, until: end + 40 }, { segment, kmh: 40, from: end + 40, until: end + 100 });
    event(state, `Плановое окно: ремонт ${track === 'odd' ? 'нечётного' : 'чётного'} пути на перегоне ${STATIONS[segment][0]}–${STATIONS[segment + 1][0]} через ${lead} мин на ${minutes} мин, затем ограничения 25 и 40 км/ч.`);
    changed = true;
  }
  if (rand(state) < chance(RATES.restriction)) {
    const segment = Math.floor(rand(state) * (STATIONS.length - 1));
    if (!state.restrictions.some(r => r.segment === segment)) {
      const kmh = rand(state) < 0.5 ? 25 : 40;
      const minutes = between(() => rand(state), 60, 180);
      state.restrictions.push({ segment, kmh, from: t, until: t + minutes });
      event(state, `Ограничение скорости ${kmh} км/ч на перегоне ${STATIONS[segment][0]}–${STATIONS[segment + 1][0]} на ${minutes} мин (путевые работы).`);
      touchPlan(state);
      changed = true;
    }
  }
  return changed;
}

/** Автопилот: если диспетчер не вмешался за 15 минут, применяется рекомендованный вариант. */
export function autopilot(state, approve) {
  if (!state.auto.approve || state.planApproved || !activeClosures(state).length) return false;
  if (state.awaitingSince == null || nowMinutes(state) - state.awaitingSince < 15) return false;
  approve(state, true);
  return true;
}
