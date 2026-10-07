// Особенности маршрута для диспетчерской схемы: путевое развитие, электрификация, перегоны.
import { isSingleTrack } from './network-sim.js';

const MINOR = /^(разъезд|обгонный|блокпост|пост|\d+\s*км)/i;
const hash = str => { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };

/** Станции маршрута по порядку километров. major — станции с названием, minor — разъезды и обгонные пункты. */
export function routeStations(route) {
  const list = [[route.from, 0], ...route.stops.filter(([, km]) => km > 0.5 && km < route.km - 0.5), [route.to, route.km]]
    .sort((a, b) => a[1] - b[1]).filter((s, i, all) => !i || s[1] > all[i - 1][1] + 0.2);
  return list.map(([name, km], i) => ({ name, km, i, minor: i > 0 && i < list.length - 1 && MINOR.test(name.trim()), end: i === 0 || i === list.length - 1 }));
}

/** Перегоны между соседними станциями маршрута (главные станции без разъездов — «участки»). */
export function routeSegments(route, { minor = false } = {}) {
  const st = routeStations(route).filter(s => minor || !s.minor);
  return st.slice(1).map((to, i) => ({ i, from: st[i], to, a: st[i].km, b: to.km, len: to.km - st[i].km, label: `${st[i].name} — ${to.name}` }));
}

/** Электрифицированные отрезки (оценка по доле электрификации маршрута). */
export function electrifiedRanges(route) {
  const f = route.electrified;
  if (f >= 0.95) return [[0, route.km]];
  if (f <= 0.04) return [];
  const total = route.km * f, h = hash(route.id);
  if (f > 0.5 || h % 2) { const start = (h >>> 3) % Math.max(1, Math.round(route.km - total)); return [[start, start + total]]; }
  const first = total * 0.55, second = total - first, gap = route.km - total;
  const s1 = (h >>> 3) % Math.max(1, Math.round(gap * 0.4)), s2 = Math.min(route.km - second, s1 + first + gap * 0.3 + ((h >>> 9) % Math.max(1, Math.round(gap * 0.3))));
  return [[s1, s1 + first], [s2, s2 + second]];
}

export function routeCharacter(route) {
  const single = isSingleTrack(route);
  const cls = route.weight >= 4 ? 'магистраль' : route.weight === 3 ? 'главный ход' : route.weight === 2 ? 'линия средней нагрузки' : 'малодеятельная линия';
  return {
    single, cls,
    tracks: single ? 'однопутная, разъезды на станциях' : 'двухпутная с автоблокировкой',
    traction: route.electrified >= 0.95 ? 'электротяга на всём протяжении' : route.electrified <= 0.04 ? 'тепловозная тяга' : `смешанная тяга, электрифицировано ≈ ${Math.round(route.electrified * 100)}%`,
  };
}

/** Красивый шаг шкалы километров. */
export function niceStep(span, target) {
  const raw = span / target, pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) || pow * 10;
}
