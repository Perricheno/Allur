import { stationTraffic, blockOccupancy } from './station-metrics.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { html, Icon, clockAt, time, dateLong, delayText, duration, PRIORITY, DIRECTION } from './lib.js';
import { app, act, go, href, updateUi, useLiveNow, liveNow, clock } from './store.js';
import { Button, Badge, Segmented } from './ui.js';
import { MARGIN, STEP, H, HALF, CARGO_Y, Y_ODD, Y_EVEN, TRAIN_W, TRAIN_H, ARROW, WAGON_W, WAGON_PITCH, ROMAN, SIGNAL_ROW, TRACK_Y, stationX, hashStr, wagonCount, consistLength, stationSignalSlots } from './track-geometry.js';
import { Signal } from './track-signals.js';
import { signalModel } from './signal-model.js';

const SPEEDS = [{ value: 1, label: 'Реальное' }, { value: 60, label: '×60' }, { value: 180, label: '×180' }, { value: 600, label: '×600' }];
const ZOOMS = [{ value: 'fit', label: 'Весь участок' }, { value: '1', label: 'Обычный' }, { value: '1.35', label: 'Крупно' }];
const FILL = { 1: 'var(--accent)', 2: '#2c5770', 3: '#667f90' };

/** Где поезд в момент tMin (минуты от начала суток модели): ТО перед рейсом, в пути, стоит или прибыл. */
export function locate(train, tMin) {
  const pts = train.forecast;
  if (train.service && tMin >= train.service.from && tMin < pts[0][0]) return { kind: 'service', idx: pts[0][1], since: train.service.from, until: pts[0][0] };
  if (tMin < pts[0][0]) return null;
  if (tMin > pts.at(-1)[0] + (train.disabled ? 0 : 8)) return null;
  for (let k = 1; k < pts.length; k++) {
    if (tMin <= pts[k][0]) {
      const [t0, i0] = pts[k - 1], [t1, i1] = pts[k];
      if (i0 === i1) return { kind: 'wait', idx: i0, since: t0, until: t1 };
      return { kind: 'move', from: i0, to: i1, f: (tMin - t0) / (t1 - t0), t0, t1 };
    }
  }
  return { kind: 'arrived', idx: pts.at(-1)[1] };
}

const segOf = (a, b) => Math.floor(Math.min(a, b) + 1e-9);
const closureAt = (data, seg, t) => data.dispatch.closures.find(c => c.segment === seg && t >= c.from && (c.until == null || t < c.until));
export const describeTrain = (data, rec, tMin) => trainStatus(data, rec, tMin);

/** Кто занимает перегон в момент tMin (для объяснения, почему другой стоит). */
function blockerOf(data, tMin, seg, exceptNumber) {
  for (const t of data.trains) {
    if (t.number === exceptNumber) continue;
    const loc = locate(t, tMin);
    if (loc?.kind === 'move' && segOf(loc.from, loc.to) === seg) return t;
  }
  return null;
}

/** Положения всех поездов на схеме и их состояние. */
export function placeTrains(data, tMin) {
  const out = [];
  const slots = new Map();
  const last = data.stations.length - 1;
  for (const t of data.trains) {
    if (t.network) {
      const nt = t.network, pos = t.diagramPosition, odd = t.direction === 'odd';
      const idx = Math.max(0, Math.min(last, Math.round(pos))), key = `${idx}:${odd}`, n = slots.get(key) || 0;
      const broken = /неисправн/.test(nt.reason);
      const seg = Math.max(0, Math.min(last - 1, Math.floor(pos)));
      const c = closureAt(data, seg, tMin);
      if (nt.stopped) {
        slots.set(key, n + 1);
        const mid = Math.abs(pos - idx) > 0.12;
        const terminal = !mid && (idx === 0 || idx === last);
        out.push({ t, odd, loc: mid ? { kind: 'wait', idx: pos, since: tMin - (nt.waitedMin || 0), until: tMin + nt.restMin } : { kind: 'wait', idx, since: tMin - (nt.waitedMin || 0), until: tMin + nt.restMin },
          stopped: !nt.planned, planned: nt.planned, wrong: false, service: false, broken, mid, held: false, segment: seg,
          x: mid ? stationX(pos) : terminal ? stationX(idx) + (idx === 0 ? -1 : 1) * (62 + Math.floor(n / 5) * 78) : stationX(idx) + [0, 66, -66, 132][n % 4] * (odd ? -1 : 1),
          y: mid ? (odd ? Y_ODD : Y_EVEN) : terminal ? (Y_ODD + Y_EVEN) / 2 + ((n % 5) - 2) * 24 : (odd ? Y_ODD - 26 - 22 * (Math.floor(n / 4) % 2) : Y_EVEN + 26 + 22 * (Math.floor(n / 4) % 2)),
          reason: nt.reason, waitedMin: Math.round(nt.waitedMin || 0), restMin: nt.restMin });
      } else {
        const wrong = Boolean(c && c.track === t.direction && c.track !== 'both');
        out.push({ t, odd, loc: { kind: 'move', from: Math.floor(pos), to: Math.ceil(pos) || 1, f: pos % 1 }, stopped: false, planned: false, wrong, service: false, broken: false, mid: false, held: false, segment: seg,
          x: stationX(pos), y: wrong ? (odd ? Y_EVEN : Y_ODD) : (odd ? Y_ODD : Y_EVEN), reason: '' });
      }
      continue;
    }
    const loc = locate(t, tMin);
    if (!loc) continue;
    const odd = t.direction === 'odd';
    const broken = Boolean(t.broken && tMin >= t.broken.from);
    const rec = { t, loc, odd, stopped: false, wrong: false, planned: false, service: false, broken, mid: false, held: false, x: 0, y: odd ? Y_ODD : Y_EVEN, reason: '', segment: null };
    if (loc.kind === 'move') {
      const a = segOf(loc.from, loc.to);
      rec.segment = a;
      rec.x = stationX(loc.from) + (stationX(loc.to) - stationX(loc.from)) * loc.f;
      const c = closureAt(data, a, tMin);
      if (c && c.track === t.direction && c.track !== 'both' && c.train !== t.number) { rec.wrong = true; rec.y = odd ? Y_EVEN : Y_ODD; }
    } else if (!Number.isInteger(loc.idx)) {
      // остановка на перегоне (поломка): стоит на своём главном пути
      rec.mid = true; rec.stopped = true; rec.segment = segOf(loc.idx, loc.idx);
      rec.x = stationX(loc.idx);
      rec.reason = t.broken ? `неисправность: ${t.broken.label.split(': ')[1] ?? t.broken.label}` : 'остановка на перегоне';
      rec.waitedMin = Math.max(0, Math.round(tMin - loc.since));
      rec.restMin = t.disabled ? null : Math.max(0, Math.round(loc.until - tMin));
    } else {
      // на станции: боковой путь (ожидание, ТО) или конечная
      const key = `${loc.idx}:${odd}`;
      const n = slots.get(key) || 0;
      slots.set(key, n + 1);
      const cx = stationX(loc.idx);
      const yard = (loc.kind === 'arrived' || loc.kind === 'service') && (loc.idx === 0 || loc.idx === last);
      rec.x = yard ? cx + (loc.idx === 0 ? -64 : 64) : cx + [0, 66, -66, 132][n % 4] * (odd ? -1 : 1);
      rec.y = yard ? (odd ? Y_ODD - 16 * (n + 1) : Y_EVEN + 16 * (n + 1)) : (odd ? Y_ODD - 26 - 22 * (Math.floor(n / 4) % 2) : Y_EVEN + 26 + 22 * (Math.floor(n / 4) % 2));
      if (loc.kind === 'service') {
        rec.service = true;
        rec.reason = `техническое обслуживание: ${t.service.reason}`;
        rec.waitedMin = Math.max(0, Math.round(tMin - loc.since));
        rec.restMin = Math.max(0, Math.round(loc.until - tMin));
      } else if (loc.kind === 'wait') {
        const held = data.holds.find(h => h.train === t.number && h.station === loc.idx);
        const ahead = odd ? loc.idx - 1 : loc.idx;                 // перегон, который ждут
        const c = closureAt(data, ahead, tMin);
        rec.held = Boolean(held);
        rec.planned = !held && !c && !broken && t.route.some((p, k) => k && p[1] === loc.idx && t.route[k - 1][1] === loc.idx);
        rec.stopped = !rec.planned;
        const blocker = c ? blockerOf(data, tMin, ahead, t.number) : null;
        rec.reason = held ? `задержан диспетчером на ${held.minutes} мин`
          : broken ? `неисправность: ${t.broken.label.split(': ')[1] ?? t.broken.label}`
          : c ? (c.track === 'both'
            ? `перегон ${data.stations[ahead].id}–${data.stations[ahead + 1].id} закрыт полностью${c.until != null ? `, до ${clockAt(data, c.until)}` : ''}`
            : `ждёт очереди на закрытый перегон ${data.stations[ahead].id}–${data.stations[ahead + 1].id}${blocker ? `: сейчас идёт №${blocker.number}` : ''}`)
          : rec.planned ? 'плановая стоянка: работа на станции' : 'ждёт на станции';
        rec.waitedMin = Math.max(0, Math.round(tMin - loc.since));
        rec.restMin = Math.max(0, Math.round(loc.until - tMin));
      }
    }
    out.push(rec);
  }
  // Поезда в колонне иначе наезжают друг на друга: разводим по «дорожкам» над/под главным путём.
  for (const line of [Y_ODD, Y_EVEN]) {
    const lanes = [];
    for (const rec of out.filter(r => r.loc.kind === 'move' && r.y === line).sort((a, b) => a.x - b.x)) {
      const half = consistLength(rec.t) / 2;
      let k = lanes.findIndex(l => rec.x - l.x >= l.half + half + 8);
      if (k < 0) { k = lanes.length; lanes.push({ x: -Infinity, half: 0 }); }
      lanes[k] = { x: rec.x, half };
      rec.lane = Math.min(k, 3);
      rec.y += (line === Y_ODD ? -1 : 1) * rec.lane * 26;
    }
  }
  return out;
}

function trainStatus(data, rec, tMin) {
  const { t, loc } = rec;
  if (t.network) { const n = t.network; return n.stopped ? `${n.station}: ${n.reason}. Стоит ${Math.round(n.waitedMin || 0)} мин, осталось ${n.restMin} мин.` : `${n.from} → ${n.to} · ${n.speedKmh} км/ч · пройдено ${Math.round(n.progress * 100)}%.`; }
  const name = i => data.stations[Math.round(i)]?.name ?? '';
  if (rec.service) return `На техническом обслуживании на «${name(loc.idx)}» ещё ${rec.restMin} мин (${t.service.reason}). Отправление в ${clockAt(data, t.forecast[0][0])}.`;
  if (rec.mid) return `Остановился на перегоне ${data.stations[rec.segment].id}–${data.stations[rec.segment + 1].id} (${rec.reason}). ${t.disabled ? 'Снят с рейса, ждёт резервный локомотив' : `Продолжит движение через ${rec.restMin} мин`}.`;
  if (loc.kind === 'move') {
    const lim = data.restrictions.find(r => r.segment === rec.segment && (r.from == null || tMin >= r.from) && (r.until == null || tMin < r.until));
    const cap = t.broken?.level === 1 && tMin >= t.broken.from ? ' · скорость ограничена из-за неисправности' : '';
    return `В пути: ${name(loc.from)} → ${name(loc.to)}, пройдено ${Math.round(loc.f * 100)}%${rec.wrong ? ' · по неправильному пути' : ''}${lim ? ` · ограничение ${lim.kmh} км/ч` : ''}${cap}. Прибытие на «${name(loc.to)}» в ${clockAt(data, loc.t1)}.`;
  }
  if (loc.kind === 'wait') return rec.planned
    ? `Плановая стоянка на «${name(loc.idx)}» ещё ${rec.restMin} мин: ${rec.reason}.`
    : `Стоит на станции «${name(loc.idx)}» ${rec.waitedMin} мин, ${rec.reason}. Отправление через ${rec.restMin} мин.`;
  return `Прибыл на станцию «${name(loc.idx)}».`;
}

const TL = { odd: '#c8554d', even: 'var(--accent)' };
/** Станционные светофоры: у каждой границы свой ряд, как у перегонных. */
function StationSignals({ i, lights }) {
  const at = stationSignalSlots(i);
  const one = (key, x, line, label) => lights[key] && html`<${Signal} key=${key} x=${x} y=${SIGNAL_ROW[line]} trackY=${TRACK_Y[line]} aspect=${lights[key]} label=${label} />`;
  return html`<g>${one('eEntry', at.eEntry, 'e', 'Чётное: входной')}${one('eExit', at.eExit, 'e', 'Чётное: выходной')}${one('oEntry', at.oEntry, 'o', 'Нечётное: входной')}${one('oExit', at.oExit, 'o', 'Нечётное: выходной')}</g>`;
}

function Station({ s, i, last, tracks, selected, ready, enRoute, onPick, lights, present = [] }) {
  const cx = stationX(i);
  const x0 = cx - HALF, x1 = cx + HALF;
  const yard = i === 0 || i === last;
  const dir = i === 0 ? -1 : 1;
  const load = Math.round(s.occupied / s.capacity * 100);
  // станционные пути над и под главными: ближний и дальний, между ними пассажирская платформа
  const arm = (y0, sign) => {
    const y1 = y0 + sign * 24, y2 = y0 + sign * 44, yp = y0 + sign * 34;
    return html`<g>
      <path d=${`M${x0 + 8} ${y0} L${x0 + 22} ${y1} H${x1 - 22} L${x1 - 8} ${y0}`} class="m-rail side"/>
      <path d=${`M${x0 + 22} ${y1} L${x0 + 32} ${y2} H${x1 - 32} L${x1 - 22} ${y1}`} class="m-rail side"/>
      <rect x=${x0 + 30} y=${yp - 4} width=${x1 - x0 - 60} height="8" rx="2" class="m-plat"/></g>`;
  };
  return html`<g class="m-station" key=${s.id}>
    <a href=${s.network ? '#/overview' : href(`/station/${s.id}`)} onClick=${s.network ? e => { e.preventDefault(); onPick(); } : undefined} class="m-link" aria-label=${s.network ? `Станция ${s.name}` : `Станция ${s.name}, ${s.type}, занятость ${load}%`}>
      <title>${`${s.name}: ${s.type.toLowerCase()} станция. Открыть страницу станции`}</title>
      <text x=${cx} y="26" text-anchor="middle" class="m-sname">${s.network && s.name.length > 15 ? `${s.name.slice(0, 14)}…` : s.name}</text>
    </a>
    <g class=${`m-pick ${selected ? 'on' : ''}`} role="button" tabindex="0" aria-pressed=${selected}
      aria-label=${s.network ? `Показать станцию ${s.name} в панели диспетчера` : `Показать станцию ${s.name} в панели диспетчера. Вагонов на путях ${s.occupied} из ${s.capacity}${ready ? `, ждут приёма групп: ${ready}` : ''}`}
      onClick=${onPick} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}>
      <title>Показать в панели диспетчера</title>
      <rect x=${cx - 15} y="40" width="30" height="30" rx="6" class="m-bld"/>
      <text x=${cx} y="62" text-anchor="middle" class="m-bld-l">${s.id}</text>
    </g>
    ${!yard && html`<line x1=${x0} x2=${x0} y1="92" y2=${Y_EVEN + 60} class="m-bound"/><line x1=${x1} x2=${x1} y1="92" y2=${Y_EVEN + 60} class="m-bound"/>`}
    ${yard
      ? html`<g class="m-yard">${[-2, -1, 0, 1, 2].map(k => html`<path key=${k} d=${`M${cx} ${k < 0 ? Y_ODD : Y_EVEN} L${cx + dir * 30} ${(Y_ODD + Y_EVEN) / 2 + k * 24} H${cx + dir * (s.network ? 128 : 110)}`} class="m-rail thin"/>`)}
          ${s.network && html`<g class="m-terminal">
            ${[-2, -1, 0, 1, 2].map(k => html`<g key=${k}><path d=${`M${cx + dir * 128} ${(Y_ODD + Y_EVEN) / 2 + k * 24 - 7} V${(Y_ODD + Y_EVEN) / 2 + k * 24 + 7}`} class="m-buffer"/><text x=${cx + dir * 140} y=${(Y_ODD + Y_EVEN) / 2 + k * 24 + 3} text-anchor="middle" class="m-trk-n">${ROMAN[k + 2]}</text></g>`)}
            ${[-1.5, -0.5, 0.5, 1.5].map(k => html`<rect key=${k} x=${cx + dir * 52 - (dir > 0 ? 0 : 56)} y=${(Y_ODD + Y_EVEN) / 2 + k * 24 - 4} width="56" height="8" rx="2" class="m-plat"/>`)}
            <text x=${cx + dir * 86} y=${Y_ODD - 38} text-anchor="middle" class="m-term-t">${i === 0 ? 'начальная' : 'конечная'}</text></g>`}</g>`
      : html`<g class="m-loop">
          <path d=${`M${x0 + 6} ${Y_ODD} L${x0 + 22} ${Y_EVEN} M${x0 + 6} ${Y_EVEN} L${x0 + 22} ${Y_ODD} M${x1 - 6} ${Y_ODD} L${x1 - 22} ${Y_EVEN} M${x1 - 6} ${Y_EVEN} L${x1 - 22} ${Y_ODD}`} class="m-rail cross"/>
          ${arm(Y_ODD, -1)}${arm(Y_EVEN, 1)}</g>`}
    ${lights && html`<${StationSignals} i=${i} lights=${lights} />`}
    ${s.network ? html`<g class="m-netinfo"><text x=${cx} y=${CARGO_Y - 18} text-anchor="middle" class="m-load-h">${Math.round(s.km)} км · ${yard ? (i === 0 ? 'начальная' : 'конечная') : 'промежуточная'}</text>
      ${(() => { const n = 4 + hashStr(s.name) % 6, byTrack = new Map(present.map((r, k) => [(r.t.network.track ? r.t.network.track - 1 : k) % n, r]));
        return html`${Array.from({ length: n }, (_, k) => { const r = byTrack.get(k); return html`<g key=${k} transform=${`translate(${cx - 48} ${CARGO_Y - 8 + k * 13})`}><title>${`Путь ${ROMAN[k]}${r ? `: №${r.t.number}` : ': свободен'}`}</title>
          <rect width="96" height="9" rx="4.5" class=${`m-tr-bg ${r ? (r.stopped ? 'bad' : 'busy') : ''}`}/>${r ? html`<text x="48" y="7.4" text-anchor="middle" class="m-trk-t">№${r.t.number}</text>` : html`<text x="6" y="7.4" class="m-trk-n">${ROMAN[k]}</text>`}</g>`; })}
          <text x=${cx} y=${CARGO_Y - 8 + n * 13 + 12} text-anchor="middle" class="m-load">занято ${byTrack.size} из ${n} путей</text>`; })()}</g>` : html`<g class="m-tracks m-pick-area" onClick=${onPick}><title>${`Подъездные пути станции ${s.name}: вагонов ${s.occupied} из ${s.capacity}. Не путать с главными путями: проходящие поезда их не занимают.`}</title>
      <text x=${cx} y=${CARGO_Y - 8} text-anchor="middle" class="m-load-h">подъездные пути</text>
      ${tracks.map((t, k) => html`<g key=${t.id} transform=${`translate(${cx - 42} ${CARGO_Y + k * 15})`}>
        <rect width="84" height="10" rx="5" class="m-tr-bg"/>
        <rect width=${84 * t.processing / t.capacity} height="10" rx="5" class="m-tr-work"/>
        <rect x=${84 * t.processing / t.capacity} width=${84 * t.done / t.capacity} height="10" class="m-tr-done"/>
        <rect x=${84 * (t.processing + t.done) / t.capacity} width=${84 * (t.waiting + t.reserved) / t.capacity} height="10" class="m-tr-res"/></g>`)}
      <text x=${cx} y=${CARGO_Y + tracks.length * 15 + 10} text-anchor="middle" class="m-load">${s.occupied} / ${s.capacity} ваг.</text>
      ${ready > 0 && html`<g transform=${`translate(${cx} ${CARGO_Y + tracks.length * 15 + 30})`}><rect x="-47" y="-12" width="94" height="20" rx="10" class="m-badge on"/><text y="2.5" text-anchor="middle" class="m-badge-t">ждут приёма ${ready}</text></g>`}
      ${!ready && enRoute > 0 && html`<g transform=${`translate(${cx} ${CARGO_Y + tracks.length * 15 + 30})`}><rect x="-43" y="-12" width="86" height="20" rx="10" class="m-badge"/><text y="2.5" text-anchor="middle" class="m-badge-t dim">на подходе ${enRoute}</text></g>`}
    </g>`}
  </g>`;
}

/** Миникарта всего участка: поезда точками, окно просмотра, клик — переход. */
function MiniMap({ data, live, W, scale, view, onJump, tMin }) {
  const n = data.stations.length;
  const w = 1000, h = 46, sx = x => (x / W) * w;
  return html`<svg class="minimap" viewBox=${`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Миникарта участка: нажмите, чтобы перейти к месту"
    onClick=${e => { const r = e.currentTarget.getBoundingClientRect(); onJump(((e.clientX - r.left) / r.width) * W); }}>
    <line x1=${sx(stationX(0))} x2=${sx(stationX(n - 1))} y1="23" y2="23" class="mm-line"/>
    ${data.stations.map((s, i) => html`<g key=${s.id}><line x1=${sx(stationX(i))} x2=${sx(stationX(i))} y1="14" y2="32" class="mm-st"/><text x=${sx(stationX(i))} y="10" text-anchor="middle" class="mm-t">${s.id}</text></g>`)}
    ${data.dispatch.closures.map(c => html`<rect key=${c.id} x=${sx(stationX(c.segment))} y="18" width=${sx(STEP)} height="10" rx="3" class=${`mm-closed ${tMin < c.from ? 'planned' : ''}`}/>`)}
    ${live.map(r => html`<circle key=${r.t.number} cx=${sx(r.x)} cy=${r.odd ? 17 : 29} r=${r.stopped || r.broken ? 4.5 : 3.2} fill=${FILL[r.t.priority]} class=${`mm-train ${r.stopped ? 'stopped' : ''}`}/>`)}
    <rect x=${sx(view.left / scale)} y="3" width=${Math.max(10, sx(view.width / scale))} height=${h - 6} rx="4" class="mm-view"/>
  </svg>`;
}

export function TrackMap({ data, selectedTrain, onTrain, onStation }) {
  const now = useLiveNow(clock.running ? 30 : 4);
  const tMin = (now - data.baseTime) / 60000;
  const wrap = useRef(null);
  const [zoom, setZoomState] = useState(() => localStorage.getItem('mapZoom') || '1');
  const setZoom = v => { localStorage.setItem('mapZoom', v); setZoomState(v); };
  const [boxW, setBoxW] = useState(1200);
  const [view, setView] = useState({ left: 0, width: 1200 });
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { setBoxW(Math.round(e.contentRect.width)); setView(v => ({ ...v, width: el.clientWidth })); });
    ro.observe(el);
    const onScroll = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll); };
  }, []);
  const n = data.stations.length;
  const W = MARGIN * 2 + (n - 1) * STEP;
  const fit = zoom === 'fit';
  const scale = fit ? Math.max(boxW, 760) / W : Number(zoom);
  const width = W * scale;
  const selected = data.network ? selectedTrain : app.ui.selectedTrain;
  const pickTrain = value => onTrain ? onTrain(value) : updateUi({ selectedTrain: value });
  const live = placeTrains(data, tMin);     // точные положения для кадра
  const closures = data.dispatch.closures;

  // светофоры: аспекты автоблокировки по занятости блок-участков и закрытиям
  const sig = signalModel({ n, closures, tMin, live });
  const stopped = live.filter(r => r.stopped);
  const serviced = live.filter(r => r.service);
  const broken = live.filter(r => r.broken);
  const onLine = live.filter(r => !r.service).length;
  const sel = selected ? live.find(r => r.t.number === selected) : null;
  const selTrain = selected ? data.trains.find(t => t.number === selected) : null;
  const ahead = clock.now - Date.now() > 120_000;

  // следим за выбранным поездом
  useEffect(() => {
    if (!sel || fit || !clock.running || !wrap.current) return;
    const target = sel.x * scale - wrap.current.clientWidth / 2;
    wrap.current.scrollLeft += (target - wrap.current.scrollLeft) * 0.15;
  });
  // при первом показе без выбора прокручиваем к самой «горячей» точке: стоящим и сломавшимся поездам
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !wrap.current || fit || !live.length) return;
    focused.current = true;
    const hot = live.find(r => r.stopped || r.broken) || live[0];
    wrap.current.scrollLeft = Math.max(0, hot.x * scale - wrap.current.clientWidth / 2);
  }, [live.length > 0]);

  const enter = (e, rec) => { const r = wrap.current.getBoundingClientRect(); setHover({ n: rec.t.number, x: e.clientX - r.left + wrap.current.scrollLeft, y: e.clientY - r.top }); };
  const toggleRun = () => act({ type: 'clock', running: !clock.running });
  const hovered = hover && live.find(r => r.t.number === hover.n);
  const jump = x => { if (wrap.current) wrap.current.scrollTo({ left: Math.max(0, x * scale - wrap.current.clientWidth / 2), behavior: 'smooth' }); };
  const trackLines = c => (c.track === 'both' ? [Y_ODD, Y_EVEN] : [c.track === 'odd' ? Y_ODD : Y_EVEN]);

  return html`<div class="trackmap">
    <div class="map-toolbar">
      <div class="map-clock" aria-live="off"><${Icon} name="clock" size=${20} /><div><strong class="num">${time(now)}</strong><small>${dateLong(now)}</small></div></div>
      ${!data.network && html`<${Button} variant=${clock.running ? 'secondary' : 'primary'} icon=${clock.running ? 'pause' : 'play'} onClick=${toggleRun}>${clock.running ? 'Пауза' : 'Пуск'}</${Button}>`}
      ${!data.network && html`
      <div class="speed" role="group" aria-label="Скорость времени">
        <${Segmented} label="Скорость времени" value=${data.speed} options=${SPEEDS} onChange=${v => act({ type: 'clock', speed: v })} />
        ${data.synced && data.speed === 1 ? html`<${Badge} tone="accent" icon="radio">реальное время</${Badge}>`
          : html`<${Button} size="sm" icon="locate-fixed" disabled=${ahead} reason="Модельное время опережает реальное: вернуться можно только сбросом модели" onClick=${() => act({ type: 'clock', sync: true })}>К реальному</${Button}>`}
      </div>`}
      <div class="map-stats" role="status" aria-live="polite">
        <span><strong>${onLine}</strong> на линии</span>
        <span class=${stopped.length ? 'bad' : ''}><strong>${stopped.length}</strong> стоят</span>
        <span><strong>${serviced.length}</strong> на ТО</span>
        ${broken.length > 0 && html`<span class="bad"><strong>${broken.length}</strong> с поломкой</span>`}
      </div>
      <div class="map-tools"><${Segmented} label="Масштаб схемы" value=${zoom} options=${ZOOMS} onChange=${setZoom} /></div>
    </div>
    <${MiniMap} data=${data} live=${live} W=${W} scale=${scale} view=${view} tMin=${tMin} onJump=${jump} />
    <div class="map-scroll" ref=${wrap} onPointerLeave=${() => setHover(null)}>
      <svg width=${width} height=${H * scale} viewBox=${`0 0 ${W} ${H}`} role="group"
        aria-label=${`Схема участка: ${onLine} поездов на линии, ${stopped.length} стоят, ${serviced.length} на техобслуживании`}>
        <defs><pattern id="mhatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="var(--danger-line)" stroke-width="3"/></pattern></defs>
        <line x1=${stationX(0)} x2=${stationX(n - 1)} y1=${Y_ODD} y2=${Y_ODD} class="m-rail m-odd"/>
        <line x1=${stationX(0)} x2=${stationX(n - 1)} y1=${Y_EVEN} y2=${Y_EVEN} class="m-rail m-even"/>
        ${data.network && data.stations.slice(0, -1).map((a, k) => data.electrified?.[k] && html`<g key=${`w${k}`} class="m-wire"><title>Контактная сеть</title>
          <line x1=${stationX(k)} x2=${stationX(k + 1)} y1=${Y_ODD - 54} y2=${Y_ODD - 54}/>
          ${Array.from({ length: Math.floor(STEP / 30) + 1 }, (_, m) => html`<line key=${m} x1=${stationX(k) + m * 30} x2=${stationX(k) + m * 30} y1=${Y_ODD - 54} y2=${Y_ODD - 46} class="mast"/>`)}</g>`)}
        ${data.network && data.stations.slice(0, -1).map((a, k) => html`<text key=${`km${k}`} x=${stationX(k) + STEP / 2} y=${Y_EVEN + 72} text-anchor="middle" class="m-kmpost">${Math.round((a.km + data.stations[k + 1].km) / 2)} км</text>`)}
        ${data.stations.slice(0, -1).map((a, k) => { const xa = stationX(k) + HALF, xb = stationX(k + 1) - HALF, xm = (xa + xb) / 2; const load = data.sections[k]; return html`<g key=${k} class="m-section">
          <path d=${`M${xa} 98 H${xb} M${xa + 5} 94 L${xa} 98 L${xa + 5} 102 M${xb - 5} 94 L${xb} 98 L${xb - 5} 102`} class="m-bracket"/>
          <text x=${xm} y="90" text-anchor="middle" class="m-sect-t">${a.id}–${data.stations[k + 1].id}${data.network ? ` · ${Math.round(data.stations[k + 1].km - a.km)} км` : ''}</text>
          <g><title>${data.network ? `Сейчас на перегоне: ${load.trains} поездов` : `Загрузка перегона: ${load.trains} поездов в ближайший час, ${load.load}% пропускной способности`}</title>
            <rect x=${xa} y="108" width=${xb - xa} height="7" rx="3.5" class="m-load-bg"/>
            <rect x=${xa} y="108" width=${(xb - xa) * load.load / 100} height="7" rx="3.5" class=${`m-load-bar ${load.load >= 70 ? 'hot' : ''}`}/>
            <text x=${xm} y="128" text-anchor="middle" class="m-load-t">${data.network ? `${load.trains} поезд.` : `${load.load}%`}</text></g>
          ${[0.28, 0.5, 0.72].map(f => html`<path key=${f} d=${`M${xa + (xb - xa) * f + 4} ${Y_ODD - 5} L${xa + (xb - xa) * f - 4} ${Y_ODD} L${xa + (xb - xa) * f + 4} ${Y_ODD + 5}`} class="m-chev odd"/>`)}
          ${[0.28, 0.5, 0.72].map(f => html`<path key=${f} d=${`M${xa + (xb - xa) * f - 4} ${Y_EVEN - 5} L${xa + (xb - xa) * f + 4} ${Y_EVEN} L${xa + (xb - xa) * f - 4} ${Y_EVEN + 5}`} class="m-chev even"/>`)}</g>`; })}
        ${data.stations.map((s, i) => html`<${Station} key=${s.id} s=${s} i=${i} last=${n - 1} tracks=${s.tracks} lights=${sig.station(i)} present=${live.filter(r => r.stopped !== undefined && r.loc.kind === 'wait' && Number.isInteger(r.loc.idx) && r.loc.idx === i)} selected=${!data.network && app.ui.selectedStation === s.id}
          ready=${stationTraffic(data, s.id, now).waiting}
          enRoute=${stationTraffic(data, s.id, now).enRoute}
          onPick=${() => onStation ? onStation(s.name) : updateUi({ selectedStation: app.ui.selectedStation === s.id ? null : s.id })} />`)}
        ${closures.map(c => {
          const x0 = stationX(c.segment) + HALF, w = STEP - 2 * HALF, xm = x0 + w / 2, planned = tMin < c.from;
          const first = trackLines(c)[0];
          return html`<g key=${c.id} class=${`m-closed ${planned ? 'planned' : ''}`}>
            ${trackLines(c).map(y => html`<rect key=${y} x=${x0} y=${y - 12} width=${w} height="24" rx="4" fill="url(#mhatch)" class="m-hatch"/>`)}
            <g transform=${`translate(${xm} ${first})`}><circle r="16" class="m-star"/><path d="M-7 -7 L7 7 M7 -7 L-7 7" class="m-x"/></g>
            <text x=${xm} y=${(Y_ODD + Y_EVEN) / 2 + 5} text-anchor="middle" class="m-closed-t">${planned ? `окно с ${clockAt(data, c.from)}` : c.kind === 'breakdown' ? 'поломка поезда' : 'путь закрыт'}</text></g>`;
        })}
        ${data.restrictions.filter(r => (r.from == null || tMin >= r.from) && (r.until == null || tMin < r.until)).map(r => html`<g key=${r.segment} transform=${`translate(${stationX(r.segment) + STEP / 2} ${Y_EVEN + 42})`}>
          <circle r="16" class="m-sign"/><text y="5" text-anchor="middle" class="m-sign-t">${r.kmh}</text></g>`)}
        ${sig.blocks.map(b => html`<${Signal} ...${b} />`)}
        ${live.map(rec => {
          const { t } = rec;
          const isSel = selected === t.number;
          const dim = selected && !isSel;
          const goingLeft = rec.odd;      // нечётные всегда едут влево, даже по неправильному пути
          return html`<g key=${t.number} class=${`mtrain p${t.priority} ${rec.stopped ? 'stopped' : ''} ${rec.planned ? 'planned' : ''} ${rec.service ? 'service' : ''} ${rec.broken ? 'broken' : ''} ${rec.wrong ? 'wrong' : ''} ${isSel ? 'sel' : ''}`} opacity=${dim ? 0.3 : 1}
            transform=${`translate(${rec.x.toFixed(1)} ${rec.y})`} tabindex="0" role="button"
            aria-label=${`Поезд ${t.number}, ${t.label}. ${trainStatus(data, rec, tMin)}`} aria-pressed=${isSel}
            onClick=${() => pickTrain(isSel ? null : t.number)}
            onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickTrain(isSel ? null : t.number); } }}
            onPointerMove=${e => enter(e, rec)} onPointerEnter=${e => enter(e, rec)}>
            <rect x="-40" y="-17" width="80" height="34" fill="transparent" class="m-hit"/>
            ${rec.stopped && html`<circle r="30" class="m-pulse"/>`}
            ${t.network && Array.from({ length: wagonCount(t) }, (_, w) => html`<rect key=${w} x=${goingLeft ? TRAIN_W / 2 + 6 + w * WAGON_PITCH : -TRAIN_W / 2 - 6 - WAGON_W - w * WAGON_PITCH} y="-7" width=${WAGON_W} height="14" rx="2.5" fill=${FILL[t.priority]} class="m-wagon"/>`)}
            <rect x=${-TRAIN_W / 2} y=${-TRAIN_H / 2} width=${TRAIN_W} height=${TRAIN_H} rx="6" fill=${FILL[t.priority]} class="m-body"/>
            <path d=${goingLeft ? `M${-TRAIN_W / 2} -11 L${-TRAIN_W / 2 - 12} 0 L${-TRAIN_W / 2} 11 Z` : `M${TRAIN_W / 2} -11 L${TRAIN_W / 2 + 12} 0 L${TRAIN_W / 2} 11 Z`} fill=${FILL[t.priority]}/>
            <text y="5" text-anchor="middle" class="m-num">${t.number}</text>
            ${rec.broken && html`<g transform=${`translate(${TRAIN_W / 2 - 4} ${-TRAIN_H / 2 - 6})`}><circle r="8" class="m-warn"/><path d="M0 -4 V1 M0 4 V4.5" class="m-warn-mark"/></g>`}
            ${rec.service && html`<g transform=${`translate(${TRAIN_W / 2 - 4} ${-TRAIN_H / 2 - 6})`}><circle r="8" class="m-wrench"/><path d="M-3 3 L1 -1 M0 -4 a3 3 0 0 1 4 4 l-1 1 -3 -3z" class="m-warn-mark"/></g>`}
            ${rec.stopped && html`<text y=${rec.odd ? -20 : 34} text-anchor="middle" class="m-stop">${rec.mid ? 'неисправность' : `стоит ${rec.waitedMin} мин`}</text>`}
            ${rec.service && html`<text y=${rec.odd ? -20 : 34} text-anchor="middle" class="m-svc">ТО ещё ${rec.restMin} мин</text>`}
            ${rec.planned && html`<text y=${rec.odd ? -20 : 34} text-anchor="middle" class="m-plan">стоянка ${rec.restMin} мин</text>`}
          </g>`;
        })}
      </svg>
      ${hovered && html`<div class="tip" style=${`left:${Math.min(hover.x + 14, width - 270)}px;top:${Math.min(hover.y + 18, H * scale - 150)}px`} role="tooltip">
        <strong>№${hovered.t.number} · ${hovered.t.label}</strong>
        <span>${DIRECTION[hovered.t.direction]} направление · приоритет ${hovered.t.priority}</span>
        <span>${hovered.t.loco.series} ${hovered.t.loco.type} · ${hovered.t.wagons} ваг. · ${hovered.t.grossT} т</span>
        <span>Загрузка ${hovered.t.loadPct}% · ТО: ${hovered.t.techState.status}</span>
        <span class=${hovered.stopped ? 'bad' : ''}>${trainStatus(data, hovered, tMin).split('.')[0]}</span>
        <span class=${hovered.t.delay > 0 ? 'bad' : ''}>${hovered.t.disabled ? 'Снят с рейса' : `Прибытие ${clockAt(data, hovered.t.forecast.at(-1)[0])} · ${delayText(hovered.t.delay)}`}</span>
      </div>`}
    </div>
    ${data.network ? html`<div class="map-legend" aria-label="Условные обозначения"><span>← Обратное направление</span><span>Прямое направление →</span><span>Красная обводка — вынужденная стоянка</span><span>Номера станций — порядок вдоль маршрута</span><span>Расстояния между станциями на схеме условные</span></div>` : html`<div class="map-legend" aria-label="Условные обозначения">
      <span><svg width="34" height="10" aria-hidden="true"><line x1="2" y1="5" x2="32" y2="5" stroke="#c8554d" stroke-width="4" stroke-linecap="round"/><path d="M12 1 L6 5 L12 9" fill="none" stroke="#c8554d" stroke-width="2"/></svg>Главный путь, нечётное направление (←)</span>
      <span><svg width="34" height="10" aria-hidden="true"><line x1="2" y1="5" x2="32" y2="5" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/><path d="M24 1 L30 5 L24 9" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>Главный путь, чётное направление (→)</span>
      <span><svg width="34" height="10" aria-hidden="true"><line x1="2" y1="5" x2="32" y2="5" stroke="#a5b4be" stroke-width="3" stroke-linecap="round"/></svg>Станционный путь</span>
      <span><i class="lg-plat"></i>Пассажирская платформа</span>
      <span><svg width="12" height="20" aria-hidden="true"><rect x="1" y="1" width="10" height="18" rx="5" fill="#26333c"/><circle cx="6" cy="6" r="3" fill="#2d3c47"/><circle cx="6" cy="14" r="3" fill="#3fb37f"/></svg>Светофор: входной / выходной</span>
      <span><i class="lg-sig"></i>Блок-сигнал: зелёный</span><span><i class="lg-sig yellow"></i>жёлтый — следующий блок занят</span><span><i class="lg-sig red"></i>красный — занят / закрыт</span>
      <span><i class="lg-wagon"></i>Вагоны состава</span><span><i class="lg-wire"></i>Контактная сеть</span>
      <span><svg width="8" height="18" aria-hidden="true"><line x1="4" y1="0" x2="4" y2="18" stroke="#8798a4" stroke-dasharray="3 3"/></svg>Граница станции</span>
      <span><i class="lg-load"></i>Загрузка перегона (поездов в ближайший час)</span>
      <span class="lg-sep"></span>
      ${[1, 2, 3].map(p => html`<span key=${p}><i class="lg-train" style=${`background:${FILL[p]}`}></i>${PRIORITY[p].short}</span>`)}
      <span><i class="lg-train stopped"></i>Стоит и ждёт</span>
      <span><i class="lg-train planned"></i>Плановая стоянка</span>
      <span><i class="lg-badge svc"></i>На техобслуживании</span>
      <span><i class="lg-badge warn"></i>Поломка</span>
    </div>`}
    <div class="map-info" role="region" aria-label="Выбранный поезд" aria-live="polite">
      ${selTrain ? (sel ? html`<div class="info-main"><strong>№${selTrain.number}</strong><${Badge} tone=${PRIORITY[selTrain.priority].tone}>${selTrain.label}</${Badge}>
          <span>${trainStatus(data, sel, tMin)}</span></div>
        <div class="info-side"><${Badge} tone=${selTrain.delay > 0 || selTrain.disabled ? 'danger' : 'neutral'}>${selTrain.disabled ? 'снят с рейса' : delayText(selTrain.delay)}</${Badge}>
          <${Button} variant="ghost" size="sm" icon="x" onClick=${() => pickTrain(null)}>Снять</${Button}></div>`
        : html`<div class="info-main"><strong>№${selTrain.number}</strong><span>${tMin < selTrain.forecast[0][0] ? `Ещё не вышел: отправление в ${clockAt(data, selTrain.forecast[0][0])} со станции «${data.stations[Math.round(selTrain.forecast[0][1])].name}».` : 'Уже прибыл и ушёл с линии.'}</span></div>
          <div class="info-side"><${Button} variant="ghost" size="sm" icon="x" onClick=${() => updateUi({ selectedTrain: null })}>Снять</${Button}></div>`)
        : html`<div class="info-main muted"><${Icon} name="mouse-pointer-click" size=${17} /><span>Нажмите на поезд, чтобы увидеть, где он и почему стоит. Нажмите на станцию — в панели диспетчера откроются её пути и вагоны.</span></div>`}
    </div>
  </div>`;
}
