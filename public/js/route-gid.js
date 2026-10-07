// ГИД маршрута: график движения «время × километр» с прошлым и прогнозом, станциями и инцидентами.
import { useMemo, useRef, useState, useEffect } from 'preact/hooks';
import { html, time } from './lib.js';
import { routeTimeline } from './network-sim.js';
import { routeStations, niceStep } from './route-profile.js';

const COLORS = { passenger: '#007aa5', container: '#1f4a63', freight: '#8497a3' };
const WIDTH = { passenger: 2.6, container: 1.8, freight: 1.3 };
const SPANS = [{ value: 180, label: '3 часа' }, { value: 360, label: '6 часов' }, { value: 720, label: '12 часов' }, { value: 1440, label: 'Сутки' }];
const L = 150, R = 18, T = 26, B = 34;

export function RouteGid({ sim, route, incidents, now, selected, onSelect, slot }) {
  const [span, setSpan] = useState(360);
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  const [W, setW] = useState(960);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(560, el.clientWidth)));
    ro.observe(el); setW(Math.max(560, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const from = now - span * 60000 * 0.25, to = now + span * 60000 * 0.75;
  const lines = useMemo(() => routeTimeline(sim, route.id, from, to), [sim, route.id, Math.floor(now / 15000), span, incidents]);
  const stations = useMemo(() => routeStations(route).filter(s => !s.minor), [route.id]);
  const H = Math.max(300, Math.min(640, route.km * 0.35 + 150));
  const x = t => L + (t - from) / (to - from) * (W - L - R);
  const y = km => T + km / route.km * (H - T - B);
  // подписи станций без наложений по вертикали
  const labelled = useMemo(() => { let last = -99; return stations.filter(s => { const yy = y(s.km); if (yy - last < 15 && !s.end) return false; last = yy; return true; }); }, [stations, H]);
  const hourStep = span <= 180 ? 30 : span <= 360 ? 60 : span <= 720 ? 120 : 240;
  const ticks = []; for (let t = Math.ceil(from / (hourStep * 60000)) * hourStep * 60000; t <= to; t += hourStep * 60000) ticks.push(t);
  const act = incidents.filter(i => (i.until ?? Infinity) > from);
  const nowX = x(now);
  return html`<div class="gid" ref=${ref}>
    <div class="gid-bar"><div class="segmented" role="radiogroup" aria-label="Окно графика">${SPANS.map(s => html`<button type="button" role="radio" key=${s.value} aria-checked=${span === s.value} class=${span === s.value ? 'on' : ''} onClick=${() => setSpan(s.value)}>${s.label}</button>`)}</div>
      <div class="gid-legend"><span><i style="background:#007aa5"></i>пассажирский</span><span><i style="background:#1f4a63"></i>контейнерный</span><span><i style="background:#8497a3"></i>грузовой</span><span><i class="forced"></i>стоянка</span></div></div>
    <svg width="100%" height=${H} viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`График движения маршрута ${route.name}: ${lines.length} ниток`} class="gid-svg">
      ${ticks.map(t => html`<g key=${t}><line x1=${x(t)} x2=${x(t)} y1=${T} y2=${H - B} class="gid-grid"/><text x=${x(t)} y=${H - B + 16} text-anchor="middle" class="gid-axis">${time(t)}</text></g>`)}
      ${labelled.map(s => html`<g key=${s.i}><line x1=${L} x2=${W - R} y1=${y(s.km)} y2=${y(s.km)} class="gid-st"/><text x=${L - 8} y=${y(s.km) + 4} text-anchor="end" class="gid-name">${s.name.length > 20 ? `${s.name.slice(0, 19)}…` : s.name}</text></g>`)}
      ${act.map(i => {
        const x0 = Math.max(L, x(i.from)), x1 = Math.min(W - R, x(i.until ?? to)), both = i.track === 'both';
        return html`<rect key=${i.id} x=${x0} y=${y(i.a)} width=${Math.max(2, x1 - x0)} height=${Math.max(3, y(i.b) - y(i.a))} class=${`gid-inc ${i.kind} ${both ? 'both' : ''}`}><title>${`${i.kind === 'closure' ? 'Закрыт путь' : i.kind === 'restriction' ? `Ограничение ${i.kmh} км/ч` : `Поломка, уровень ${i.level}`} · ${i.segName || ''}`}</title></rect>`;
      })}
      ${lines.map(l => {
        const sel = l.uid === selected;
        return html`<g key=${l.uid} class=${`gid-line ${l.category} ${sel ? 'sel' : ''}`} onClick=${() => onSelect?.(sel ? null : l.uid)} onMouseEnter=${() => setTip(l)} onMouseLeave=${() => setTip(null)}>
          <polyline points=${l.points.map(([t, km]) => `${x(t).toFixed(1)},${y(km).toFixed(1)}`).join(' ')} fill="none" stroke=${COLORS[l.category]} stroke-width=${sel ? 4 : WIDTH[l.category]} stroke-linejoin="round" opacity=${sel ? 1 : 0.85}/>
          <polyline points=${l.points.map(([t, km]) => `${x(t).toFixed(1)},${y(km).toFixed(1)}`).join(' ')} fill="none" stroke="transparent" stroke-width="10"/>
          ${l.forced.map(([a, b, km], k) => html`<line key=${k} x1=${x(a)} x2=${x(b)} y1=${y(km)} y2=${y(km)} class="gid-forced"/>`)}
          <title>${`№${l.number} · ${l.category === 'passenger' ? 'пассажирский' : l.category === 'container' ? 'контейнерный' : 'грузовой'} · ${l.dir === 'fwd' ? '→' : '←'}`}</title></g>`;
      })}
      <line x1=${nowX} x2=${nowX} y1=${T - 6} y2=${H - B} class="gid-now"/><text x=${nowX} y=${T - 10} text-anchor="middle" class="gid-nowt">сейчас ${time(now)}</text>
      ${tip && html`<text x=${W - R} y=${T - 10} text-anchor="end" class="gid-nowt">№${tip.number}</text>`}
    </svg>
    <p class="muted gid-note">По вертикали километры от ${route.from}, по горизонтали время. Наклонные линии — движение, горизонтальные — стоянки; красные — вынужденные. Штриховка — зона закрытия или ограничения. Нажмите на нитку, чтобы выбрать поезд.</p>
  </div>`;
}
