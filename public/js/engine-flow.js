// Граф потока данных: четыре слоя метрик, связи между ними и бегущие по связям точки. Значения узлов — живые.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html } from './lib.js';
import { STAGES, LINKS, linkRates } from './engine-graph.js';
import { fmt } from './engine-widgets.js';

const W = 1000, COL = W / STAGES.length, PILL_W = 204, PILL_H = 30, ROW = 40, TOP = 78;
const ALERT = new Set(['incidents', 'conflicts', 'shorten']);

/** Положения узлов: слои слева направо, строки по центру слоя. */
function place() {
  const most = Math.max(...STAGES.map(s => s.rows.length)), map = new Map();
  STAGES.forEach((st, si) => st.rows.forEach((row, ri) => map.set(row.id, { x: COL * (si + 0.5), y: TOP + ((most - st.rows.length) * ROW) / 2 + ri * ROW, stage: si, row })));
  return { map, height: TOP + most * ROW + 10 };
}

const LIFE_S = 1.9, LUT = 48;
const CAP = (navigator.hardwareConcurrency || 4) <= 4 ? 6000 : 14000;      // сколько точек рисуем одновременно

/** Таблица точек кривой связи: быстрый поиск положения точки по доле пути. */
function lookup(a, b) {
  const x1 = a.x + PILL_W / 2, x2 = b.x - PILL_W / 2, dx = Math.max(40, (x2 - x1) * 0.5), pts = new Float32Array((LUT + 1) * 2);
  for (let i = 0; i <= LUT; i++) {
    const t = i / LUT, m = 1 - t;
    pts[i * 2] = m * m * m * x1 + 3 * m * m * t * (x1 + dx) + 3 * m * t * t * (x2 - dx) + t * t * t * x2;
    pts[i * 2 + 1] = m * m * m * a.y + 3 * m * m * t * a.y + 3 * m * t * t * b.y + t * t * t * b.y;
  }
  return pts;
}

/** Слой точек на canvas: каждая точка — одна запись, число точек в секунду равно потоку данных. */
function useParticles(canvas, svg, map, live) {
  useEffect(() => {
    const el = canvas.current, g = el.getContext('2d'), reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const links = LINKS.map(([a, b]) => ({ key: `${a}>${b}`, a, b, lut: lookup(map.get(a), map.get(b)), u: [], off: [], carry: 0 }));
    let scale = 1, raf = 0, last = performance.now(), W = 0, H = 0;
    const resize = () => {
      const r = svg.current.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      W = r.width; H = r.height; scale = r.width / 1000;
      el.width = W * dpr; el.height = H * dpr; el.style.width = `${W}px`; el.style.height = `${H}px`; g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    };
    const ro = new ResizeObserver(resize); ro.observe(svg.current); resize();
    const frame = now => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const { rates, related, unit } = live.current;
      g.clearRect(0, 0, 1000, H / scale);
      for (const l of links) {
        const rate = (rates.get(l.key) || 0) / unit, on = !related || (related.has(l.a) && related.has(l.b));
        l.carry += rate * dt;
        while (l.carry >= 1 && l.u.length < CAP) { l.carry -= 1; l.u.push(Math.random() * dt / LIFE_S); l.off.push((Math.random() - 0.5) * 9); }
        if (l.carry > 1) l.carry = 0;
        g.fillStyle = on ? (related ? 'rgba(0,122,165,.9)' : 'rgba(0,122,165,.55)') : 'rgba(0,122,165,.08)';
        for (let i = l.u.length - 1; i >= 0; i--) {
          const u = (l.u[i] += dt / LIFE_S);
          if (u >= 1) { l.u[i] = l.u[l.u.length - 1]; l.off[i] = l.off[l.off.length - 1]; l.u.pop(); l.off.pop(); continue; }
          const k = u * LUT, j = k | 0, f = k - j, x = l.lut[j * 2] + (l.lut[j * 2 + 2] - l.lut[j * 2]) * f, y = l.lut[j * 2 + 1] + (l.lut[j * 2 + 3] - l.lut[j * 2 + 1]) * f + l.off[i];
          g.fillRect(x - 1, y - 1, 2, 2);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    if (!reduce) raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [map]);
}
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function FlowGraph({ sample, ctx, selected, onSelect, cycle }) {
  const { map, height } = useMemo(place, []);
  const prev = useRef(new Map());
  const svg = useRef(null), canvas = useRef(null), live = useRef({ rates: new Map(), related: null, unit: 1 });
  const [changed, setChanged] = useState(new Set());
  // узлы, чьё значение изменилось с прошлого цикла, коротко подсвечиваются
  useEffect(() => {
    if (!sample) return;
    const next = new Map(), diff = new Set();
    for (const [id, p] of map) { const v = p.row.value(sample, ctx); next.set(id, v); if (prev.current.has(id) && prev.current.get(id) !== v) diff.add(id); }
    prev.current = next; setChanged(diff);
  }, [cycle]);
  const related = useMemo(() => {
    if (!selected) return null;
    const set = new Set([selected]);
    for (const [a, b] of LINKS) { if (a === selected) set.add(b); if (b === selected) set.add(a); }
    return set;
  }, [selected]);
  const rates = useMemo(() => (sample ? linkRates(sample) : new Map()), [sample]);
  const total = useMemo(() => [...rates.values()].reduce((n, v) => n + v, 0), [rates]);
  const unit = Math.max(1, Math.ceil((total * LIFE_S) / CAP));
  live.current = { rates, related, unit };
  useParticles(canvas, svg, map, live);
  const curve = (a, b) => { const x1 = a.x + PILL_W / 2, x2 = b.x - PILL_W / 2, dx = Math.max(40, (x2 - x1) * 0.5); return `M${x1} ${a.y} C${x1 + dx} ${a.y} ${x2 - dx} ${b.y} ${x2} ${b.y}`; };
  return html`<div class="flow-wrap"><canvas ref=${canvas} class="flow-particles" aria-hidden="true"></canvas><svg ref=${svg} class="flow" viewBox=${`0 0 ${W} ${height}`} role="group" aria-label="Граф потока данных модели: вход, расчёт, оценка, результат">
    ${STAGES.map((st, i) => html`<g key=${st.id}><text x=${COL * (i + 0.5)} y="26" text-anchor="middle" class="flow-title">${st.title}</text>
      <text x=${COL * (i + 0.5)} y="46" text-anchor="middle" class="flow-sub">${sample ? st.summary(sample) : ''}</text></g>`)}
    ${LINKS.map(([a, b], i) => {
      const pa = map.get(a), pb = map.get(b), on = !related || (related.has(a) && related.has(b)), d = curve(pa, pb);
      return html`<g key=${`${a}-${b}`} class=${`flow-link ${on ? 'on' : 'dim'} ${related && on ? 'hot' : ''}`}><path d=${d} /></g>`;
    })}
    ${[...map].map(([id, p]) => {
      const v = sample ? p.row.value(sample, ctx) : 0, sel = selected === id, dim = related && !related.has(id), alert = ALERT.has(id) && typeof v === 'number' && v > 0;
      return html`<g key=${id} class=${`flow-node ${sel ? 'sel' : ''} ${dim ? 'dim' : ''} ${alert ? 'alert' : ''}`} transform=${`translate(${p.x - PILL_W / 2} ${p.y - PILL_H / 2})`} tabindex="0" role="button" aria-pressed=${sel}
        aria-label=${`${p.row.label}: ${fmt(v)} ${p.row.unit}`} onClick=${() => onSelect(sel ? null : id)} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(sel ? null : id); } }}>
        <rect key=${changed.has(id) ? `c${cycle}` : 'n'} width=${PILL_W} height=${PILL_H} rx="8" class=${`flow-pill ${changed.has(id) ? 'changed' : ''}`} />
        <rect width="4" height=${PILL_H} rx="2" class="flow-bar" />
        <text x="14" y="19" class="flow-label">${trunc(p.row.label, 24)}</text>
        <text x=${PILL_W - 10} y="19" text-anchor="end" class="flow-value">${p.row.numeric === false ? ctx.clock : fmt(v)}</text></g>`;
    })}
  </svg><div class="flow-count" role="status"><b class="num">${fmt(total)}</b> записей/с · одна точка = ${unit === 1 ? 'одна запись' : `${unit} записей`}</div></div>`;
}
