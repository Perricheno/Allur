// Инциденты на маршрутах сети (закрытия путей, ограничения скорости, поломки): общий список для всех диспетчеров.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const KINDS = ['closure', 'restriction', 'breakdown'];
const TRACKS = ['odd', 'even', 'both'];
const LIMIT_TOTAL = 120, LIMIT_ROUTE = 25;
const num = (v, lo, hi, name) => {
  if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`Некорректное значение: ${name}`);
  return v;
};

export class NetIncidents {
  constructor(file, routes, persist) {
    this.file = file; this.routes = routes; this.persist = persist;
    this.list = []; this.seq = 1;
    if (persist && existsSync(file)) {
      try { const saved = JSON.parse(readFileSync(file, 'utf8')); this.list = Array.isArray(saved.list) ? saved.list : []; this.seq = saved.seq || 1; } catch { /* начнём с пустого списка */ }
    }
  }
  save() {
    if (!this.persist) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ list: this.list, seq: this.seq }));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (error) { console.error('Не удалось сохранить инциденты:', error.message); }
  }
  /** Убирает давно закончившиеся. Возвращает true, если список изменился. */
  expire(now) {
    const before = this.list.length;
    this.list = this.list.filter(i => (i.until ?? Infinity) > now - 3600_000);
    return this.list.length !== before;
  }
  add(input, now) {
    const route = this.routes.get(input.routeId);
    if (!route) throw new Error('Неизвестный маршрут');
    if (!KINDS.includes(input.kind)) throw new Error('Неизвестный вид события');
    const a = num(Number(input.a), 0, route.km, 'начало'), b = num(Number(input.b), 0, route.km, 'конец');
    if (Math.abs(b - a) < 0.05) throw new Error('Зона события слишком короткая');
    if (this.list.length >= LIMIT_TOTAL || this.list.filter(i => i.routeId === route.id).length >= LIMIT_ROUTE) throw new Error('Слишком много событий: снимите ненужные');
    const delay = input.delayMin == null ? 0 : num(Number(input.delayMin), 0, 240, 'начало через');
    const minutes = input.minutes == null ? null : num(Number(input.minutes), 5, 720, 'длительность');
    const from = now + delay * 60_000;
    const inc = { id: `inc${this.seq++}`, kind: input.kind, routeId: route.id, a: Math.min(a, b), b: Math.max(a, b), from, until: minutes == null ? null : from + minutes * 60_000,
      segName: String(input.segName || '').slice(0, 90), createdAt: now, approved: false, variant: 'priority', auto: Boolean(input.auto) };
    if (input.kind === 'closure') {
      if (!TRACKS.includes(input.track)) throw new Error('Выберите путь');
      if (input.track === 'both' && minutes == null) throw new Error('Для закрытия обоих путей укажите длительность');
      inc.track = input.track;
    } else if (input.kind === 'restriction') {
      inc.kmh = num(Number(input.kmh), 10, 80, 'скорость');
      inc.track = 'both';
    } else {
      inc.level = num(Number(input.level), 1, 4, 'уровень поломки');
      if (!/^[A-Z]{3}-[A-Z]{3}:(fwd|rev):(passenger|container|freight)@-?\d+$/.test(String(input.trainUid))) throw new Error('Выберите поезд');
      inc.trainUid = input.trainUid; inc.trainNumber = String(input.trainNumber || '').slice(0, 8);
      inc.track = input.track === 'odd' ? 'odd' : 'even';
      inc.until = from + (minutes ?? [0, 15, 45, 120, 240][inc.level]) * 60_000;
    }
    this.list.push(inc); this.save();
    return inc;
  }
  remove(id) { const before = this.list.length; this.list = this.list.filter(i => i.id !== id); if (this.list.length !== before) this.save(); return before !== this.list.length; }
  approve(id, variant, approved = true) {
    const inc = this.list.find(i => i.id === id);
    if (!inc) throw new Error('Событие не найдено');
    if (!['fifo', 'priority', 'batch'].includes(variant)) throw new Error('Неизвестный вариант');
    inc.variant = variant; inc.approved = Boolean(approved); this.save();
    return inc;
  }
  clear(routeId) { this.list = this.list.filter(i => routeId && i.routeId !== routeId); this.save(); }
}
