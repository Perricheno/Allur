// Расчёт прогноза движения: закрытия путей и перегонов, ограничения скорости, поломки поездов, варианты пропуска.
// Чистые функции без побочных эффектов: на входе состояние, на выходе план.
//
// Модель намеренно простая и объяснимая:
//  * у каждого поезда есть нормативная нитка — точки [минуты от начала суток модели, координата станции];
//    координата — индекс станции, у остановки на перегоне дробная;
//  * ограничение скорости растягивает время хода по перегону пропорционально 80 км/ч / ограничение;
//  * закрытие пути на перегоне (сход, ремонт, поломка поезда): поезда закрытого направления идут по
//    соседнему пути против обычного направления, и встречные не могут быть на нём одновременно;
//    если закрыты оба пути, поезда ждут снятия закрытия;
//  * варианты пропуска — разные правила очерёдности занятия такого перегона;
//  * поломка поезда: 1 — ограничение скорости до конечной, 2 — стоянка и продолжение,
//    3 и 4 — поезд снят с рейса.
// Это не проверенный график и не замена СЦБ: интервальное регулирование и стрелочные маршруты не моделируются.

export const NOMINAL_KMH = 80;
export const WRONG_TRACK_FACTOR = 1.25; // ход по неправильному пути медленнее из-за стрелок
export const CLOSED_SEGMENT = 3; // перегон D–E: закрытие по умолчанию (кнопка «Сход»)
export const HEADWAY = 6; // минимальный интервал попутного следования, мин
export const MARGIN = 3; // зазор между встречными поездами, мин
export const MAX_HOLD = 45; // дольше этого поезд на станции не удерживают ради приоритетного, мин
export const BATCH_LOOKAHEAD = 25; // окно сбора попутных поездов в колонну, мин
export const BATCH_LIMIT = 4; // сколько поездов подряд одного направления в колонне
export const NOTIFY_THRESHOLD = 5; // с какой задержки пассажирам уходит уведомление, мин

export const PRIORITY_NAMES = { 1: 'Пассажирские', 2: 'Контейнерные и транзитные', 3: 'Сборные и прочие грузовые' };
const WEIGHT = { 1: 10, 2: 2, 3: 1 };

/** Приоритет с учётом решения диспетчера «пропустить первым». */
export const prioOf = (state, train) => state.overrides?.[train.number] ?? train.priority;
export const directionOf = train => (train.route[0][1] < train.route.at(-1)[1] ? 'even' : 'odd');
export const nowMinutes = state => (state.now - state.origin) / 60000;

const VARIANTS = [
  {
    id: 'priority', name: 'По приоритету',
    description: 'Пассажирские идут первыми, затем контейнерные и транзитные, затем сборные. Грузовой поезд ждёт на станции, если встречный приоритетный подойдёт, пока он ещё будет на перегоне.',
  },
  {
    id: 'batch', name: 'Пакетами по направлениям',
    description: 'Перегон занимается колонной до четырёх поездов одного направления. Направление меняется реже, но пассажирский может подождать.',
  },
  {
    id: 'fifo', name: 'По очерёдности подхода',
    description: 'Кто раньше подошёл по графику, тот и идёт. Приоритеты не учитываются.',
  },
];

/** Закрытия путей (ручные и от поломок), действующие сейчас или запланированные. */
export function activeClosures(state) {
  const t = nowMinutes(state);
  return (state.incidents || []).filter(i => i.track && (i.until == null || i.until > t)).sort((a, b) => a.from - b.from);
}

const closureAt = (state, segment, t, exceptTrain) =>
  activeClosures(state).find(c => c.segment === segment && t >= c.from && (c.until == null || t < c.until) && c.train !== exceptTrain);

const restrictionFor = (state, segment, t) =>
  (state.restrictions || []).find(r => r.segment === segment && (r.from == null || t >= r.from) && (r.until == null || t < r.until));

const breakdownOf = (state, train) => (state.incidents || []).find(i => i.kind === 'breakdown' && i.train === train.number);

/** Координата поезда в момент t по нитке: {kind:'move'|'wait'|'before'|'after', ...}. */
export function locateAt(points, t) {
  if (t < points[0][0]) return { kind: 'before', idx: points[0][1], t0: points[0][0] };
  if (t > points.at(-1)[0]) return { kind: 'after', idx: points.at(-1)[1] };
  for (let k = 1; k < points.length; k++) {
    if (t <= points[k][0]) {
      const [t0, i0] = points[k - 1], [t1, i1] = points[k];
      if (i0 === i1) return { kind: 'wait', idx: i0, since: t0, until: t1 };
      return { kind: 'move', from: i0, to: i1, f: (t - t0) / (t1 - t0), pos: i0 + (i1 - i0) * ((t - t0) / (t1 - t0)) };
    }
  }
  return { kind: 'after', idx: points.at(-1)[1] };
}

// Нитка с учётом ограничений скорости, хода по неправильному пути, задержек диспетчера и поломки.
function naturalTimeline(state, train) {
  const dir = directionOf(train);
  const bd = breakdownOf(state, train);
  const points = [[train.route[0][0], train.route[0][1]]];
  let t = train.route[0][0];
  const hold = idx => (state.holds || []).find(h => h.train === train.number && h.station === idx);
  const dwell = idx => { const h = hold(idx); if (h) { t += h.minutes; points.push([t, idx]); } };
  dwell(train.route[0][1]);
  for (let k = 1; k < train.route.length; k++) {
    const [tp, ip] = train.route[k - 1], [tn, inn] = train.route[k];
    if (ip === inn) { // плановая стоянка (маневровая работа, ТО)
      t += tn - tp; points.push([t, inn]); dwell(inn); continue;
    }
    const segment = Math.min(ip, inn);
    let factor = 1;
    const restriction = restrictionFor(state, segment, t);
    if (restriction) factor *= NOMINAL_KMH / restriction.kmh;
    const c = closureAt(state, segment, t, train.number);
    if (c && c.track === dir && c.track !== 'both') factor *= WRONG_TRACK_FACTOR;
    if (bd && bd.level === 1 && t >= bd.from) factor *= bd.capFactor;
    t += Math.round((tn - tp) * factor);
    points.push([t, inn]);
    dwell(inn);
  }
  return bd && bd.level >= 2 ? applyBreakdown(points, bd) : points;
}

// Остановка из-за поломки: поезд замирает в точке, где его застала поломка.
function applyBreakdown(points, bd) {
  const t0 = bd.from;
  const here = locateAt(points, t0);
  if (here.kind === 'before' || here.kind === 'after') return points;
  const pos = here.kind === 'move' ? here.pos : here.idx;
  let j = 0;
  while (j + 1 < points.length && points[j + 1][0] <= t0) j += 1;
  const head = points.slice(0, j + 1);
  if (head.at(-1)[0] < t0 || head.at(-1)[1] !== pos) head.push([t0, pos]);
  head.push([t0 + bd.duration, pos]);
  if (bd.level >= 3) return head; // поезд снят с рейса
  const tail = points.slice(j + 1).filter(([m]) => m > t0).map(([m, i]) => [m + bd.duration, i]);
  return head.concat(tail);
}

/** Время, когда нитка впервые достигает координаты x. */
function timeAt(points, x) {
  for (let k = 1; k < points.length; k++) {
    const [t0, i0] = points[k - 1], [t1, i1] = points[k];
    if ((i0 <= x && x <= i1) || (i1 <= x && x <= i0)) return i0 === i1 ? t0 : t0 + ((x - i0) / (i1 - i0)) * (t1 - t0);
  }
  return null;
}

/** Проход закрытого перегона: прямой ход станция → станция. */
function hopOver(points, segment, dir) {
  const a = dir === 'even' ? segment : segment + 1, b = dir === 'even' ? segment + 1 : segment;
  for (let k = 1; k < points.length; k++) {
    if (points[k - 1][1] === a && points[k][1] === b) return { k, enter: points[k - 1][0], exit: points[k][0] };
  }
  return null;
}

// Назначение времён входа на закрытый перегон по правилу очерёдности.
function scheduleClosure(items, variantId, blockedUntil = -Infinity) {
  const pending = [...items];
  const last = { even: { enter: -Infinity, exit: blockedUntil - MARGIN }, odd: { enter: -Infinity, exit: blockedUntil - MARGIN } };
  let lastEnter = -Infinity;
  let currentDir = null;
  const result = new Map();
  const order = [];
  const earliest = item => {
    const opposite = item.dir === 'even' ? 'odd' : 'even';
    return Math.max(item.enter, last[item.dir].enter + HEADWAY, last[opposite].exit + MARGIN, lastEnter);
  };
  let run = 0;
  while (pending.length) {
    const now = Math.min(...pending.map(earliest));
    const ready = pending.filter(i => earliest(i) <= now);
    let pick;
    if (variantId === 'priority') {
      // Поезд не выпускается на перегон, если встречный более приоритетный подойдёт, пока он ещё в пути.
      const free = ready.filter(c => now - c.enter >= MAX_HOLD || !pending.some(h => h.priority < c.priority && h.dir !== c.dir && h.enter < now + c.duration + MARGIN));
      const pool = free.length ? free : pending;
      pick = [...pool].sort((a, b) => a.priority - b.priority || earliest(a) - earliest(b) || a.enter - b.enter)[0];
    } else if (variantId === 'batch') {
      const gathering = pending.filter(i => i.dir === currentDir && i.enter <= now + BATCH_LOOKAHEAD);
      const starving = ready.some(i => i.dir !== currentDir && now - i.enter >= MAX_HOLD);
      const pool = gathering.length && run < BATCH_LIMIT && !starving ? gathering : ready;
      pick = [...pool].sort((a, b) => a.enter - b.enter)[0];
    } else {
      pick = [...ready].sort((a, b) => a.enter - b.enter)[0];
    }
    run = pick.dir === currentDir ? run + 1 : 1;
    const enter = earliest(pick);
    result.set(pick.train.number, enter);
    order.push(pick.train.number);
    last[pick.dir] = { enter, exit: Math.max(last[pick.dir].exit, enter + pick.duration) };
    lastEnter = enter;
    currentDir = pick.dir;
    pending.splice(pending.indexOf(pick), 1);
  }
  return { result, order };
}

function applyDelay(points, k, delay) {
  if (!delay) return points;
  // Поезд ждёт на станции перед перегоном: две точки на одной станции.
  const out = points.slice(0, k);
  out.push([points[k - 1][0] + delay, points[k - 1][1]]);
  for (let j = k; j < points.length; j++) out.push([points[j][0] + delay, points[j][1]]);
  return out;
}

function evaluate(state, variantId) {
  const trains = state.trains;
  const closures = activeClosures(state);
  const forecast = new Map(trains.map(t => [t.number, naturalTimeline(state, t)]));
  const order = [];
  for (const closure of closures) {
    const items = [];
    for (const train of trains) {
      if (train.number === closure.train) continue;
      const bd = breakdownOf(state, train);
      if (bd && bd.level >= 3) continue;
      const dir = directionOf(train);
      const hop = hopOver(forecast.get(train.number), closure.segment, dir);
      if (!hop || hop.exit <= closure.from || (closure.until != null && hop.enter >= closure.until)) continue;
      items.push({ train, dir, priority: prioOf(state, train), enter: hop.enter, duration: hop.exit - hop.enter, k: hop.k });
    }
    const until = closure.track === 'both' ? (closure.until ?? closure.from + 24 * 60) : -Infinity;
    const { result, order: o } = scheduleClosure(items, variantId, until);
    for (const number of o) {
      const item = items.find(i => i.train.number === number);
      order.push({ train: number, label: item.train.label, priority: item.priority, dir: item.dir, enter: result.get(number), delay: result.get(number) - item.enter, closure: closure.id });
    }
    for (const item of items) forecast.set(item.train.number, applyDelay(forecast.get(item.train.number), item.k, result.get(item.train.number) - item.enter));
  }
  const delays = new Map();
  for (const train of trains) {
    const points = forecast.get(train.number);
    const bd = breakdownOf(state, train);
    delays.set(train.number, bd && bd.level >= 3 ? null : points.at(-1)[0] - train.route.at(-1)[0]);
  }
  return { forecast, delays, order };
}

function metrics(state, delays) {
  let total = 0, weighted = 0, passenger = 0, max = 0, delayed = 0, disabled = 0;
  for (const train of state.trains) {
    const d = delays.get(train.number);
    if (d === null) { disabled += 1; continue; }
    if (d <= 0) continue;
    const pr = prioOf(state, train);
    delayed += 1; total += d; weighted += d * WEIGHT[pr];
    if (train.category === 'passenger') passenger += d;
    max = Math.max(max, d);
  }
  return { total, weighted, passenger, max, delayedTrains: delayed, disabled };
}

// Встречные поезда, которые по нормативному графику одновременно оказываются на единственном свободном пути.
function conflicts(state) {
  const out = [];
  for (const closure of activeClosures(state)) {
    if (closure.track === 'both') continue;
    const items = [];
    for (const train of state.trains) {
      if (train.number === closure.train) continue;
      const dir = directionOf(train);
      const hop = hopOver(naturalTimeline(state, train), closure.segment, dir);
      if (hop && hop.exit > closure.from && (closure.until == null || hop.enter < closure.until)) items.push({ train, dir, ...hop });
    }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.dir === b.dir) continue;
      if (a.enter < b.exit + MARGIN && b.enter < a.exit + MARGIN) {
        out.push({ closure: closure.id,
          a: { train: a.train.number, label: a.train.label, priority: prioOf(state, a.train), dir: a.dir, enter: a.enter, exit: a.exit },
          b: { train: b.train.number, label: b.train.label, priority: prioOf(state, b.train), dir: b.dir, enter: b.enter, exit: b.exit } });
      }
    }
  }
  return out.sort((x, y) => Math.min(x.a.priority, x.b.priority) - Math.min(y.a.priority, y.b.priority) || x.a.enter - y.a.enter);
}

function explain(variants, recommendedId) {
  const best = variants.find(v => v.id === recommendedId);
  const others = variants.filter(v => v.id !== recommendedId);
  const worst = others.sort((a, b) => b.metrics.weighted - a.metrics.weighted)[0];
  if (!worst || worst.metrics.weighted === best.metrics.weighted) {
    return `Вариант «${best.name}» не хуже остальных по взвешенной задержке.`;
  }
  const pass = best.metrics.passenger <= worst.metrics.passenger
    ? `пассажирские теряют ${best.metrics.passenger} мин вместо ${worst.metrics.passenger}`
    : `пассажирские теряют ${best.metrics.passenger} мин (у «${worst.name}» — ${worst.metrics.passenger}), зато общая задержка меньше`;
  return `«${best.name}» даёт наименьшую взвешенную задержку (${best.metrics.weighted} против ${worst.metrics.weighted}): ${pass}.`;
}

// Основной вход: полный план для текущего состояния.
export function computePlan(state) {
  const closures = activeClosures(state);
  const hasClosure = closures.length > 0;
  const evaluated = VARIANTS.map(v => {
    const e = evaluate(state, hasClosure ? v.id : 'fifo');
    return { ...v, ...e, metrics: metrics(state, e.delays) };
  });
  const recommended = hasClosure
    ? [...evaluated].sort((a, b) => a.metrics.weighted - b.metrics.weighted || a.metrics.passenger - b.metrics.passenger || (a.id === 'priority' ? -1 : 1))[0]
    : evaluated[2];
  const selectedId = hasClosure ? (evaluated.some(v => v.id === state.variant) ? state.variant : recommended.id) : null;
  const selected = hasClosure ? evaluated.find(v => v.id === selectedId) : evaluated[2];
  const variants = hasClosure ? evaluated.map(v => ({
    id: v.id, name: v.name, description: v.description, recommended: v.id === recommended.id,
    metrics: v.metrics, order: v.order,
  })) : [];
  const byTrain = {};
  for (const train of state.trains) {
    byTrain[train.number] = { delay: selected.delays.get(train.number), forecast: selected.forecast.get(train.number) };
  }
  return {
    active: Boolean(hasClosure || (state.restrictions || []).length),
    closures,
    variants, selectedId, recommendedId: hasClosure ? recommended.id : null,
    why: hasClosure ? explain(variants, recommended.id) : null,
    conflicts: conflicts(state), byTrain, metrics: selected.metrics, order: selected.order,
  };
}

const memo = new WeakMap();
export function getPlan(state) {
  const key = `${state.planRev}|${state.variant}`;
  const cached = memo.get(state);
  if (cached?.key === key) return cached.plan;
  const plan = computePlan(state);
  memo.set(state, { key, plan });
  return plan;
}
/** Вызывать при любом изменении исходных данных расчёта (поезда, закрытия, ограничения, задержки, приоритеты). */
export function touchPlan(state) { state.planRev = (state.planRev || 0) + 1; }
