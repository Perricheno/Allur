import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, Icon, clockAt, time, delayText, PRIORITY, DIRECTION } from './lib.js';
import { app, updateUi, go, href, useLiveNow } from './store.js';
import { Button, Segmented, Badge } from './ui.js';

const LEFT = 148, TOP = 36, ROW = 40, RIGHT = 18;
const ZOOMS = [{ value: 4, label: '4 ч' }, { value: 8, label: '8 ч' }, { value: 14, label: '14 ч' }];
const CATS = [{ value: 'all', label: 'Все' }, { value: 'passenger', label: 'Пассажирские' }, { value: 'freight', label: 'Грузовые' }, { value: 'container', label: 'Контейнерные' }];

const style = {
  1: { stroke: 'var(--accent)', width: 2.4 },
  2: { stroke: '#2c5770', width: 1.35 },
  3: { stroke: '#8fa0ab', width: 1.2, dash: '1 3.5' },
};

function useWidth(ref) {
  const [w, setW] = useState(960);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(560, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

export function Gantt({ data, compact = false, zoom: forcedZoom, start: forcedStart }) {
  const ui = { ...app.ui, ...(forcedZoom ? { zoom: forcedZoom } : {}), ...(forcedStart != null ? { windowStart: forcedStart } : {}) };
  const wrap = useRef(null);
  const width = useWidth(wrap);
  const [hover, setHover] = useState(null);

  const nowMin = (data.now - data.baseTime) / 60000;
  const liveMs = useLiveNow(2);
  const liveMin = (liveMs - data.baseTime) / 60000;
  const span = ui.zoom * 60;
  const lastMin = Math.max(...data.trains.map(t => t.forecast.at(-1)[0]));
  const maxStart = Math.max(0, Math.ceil(lastMin / 30) * 30 - span);
  const minStart = Math.max(0, Math.floor((nowMin - 360) / 30) * 30);
  const start = Math.min(maxStart, Math.max(minStart, ui.windowStart ?? Math.round((nowMin - span * 0.12) / 15) * 15));
  const end = start + span;
  const plotW = width - LEFT - RIGHT;
  const x = m => LEFT + ((m - start) / span) * plotW;
  const y = i => TOP + i * ROW + ROW / 2;
  const height = TOP + data.stations.length * ROW + 10;
  const closures = data.dispatch.closures;
  const selected = ui.selectedTrain;
  const trains = useMemo(() => data.trains.filter(t => (ui.category === 'all' || t.category === ui.category) && t.forecast[0][0] <= end && t.forecast.at(-1)[0] >= start), [data.trains, ui.category, start, end]);

  const ticks = [];
  for (let m = Math.ceil(start / 30) * 30; m <= end; m += 30) ticks.push(m);
  const labelEvery = ui.zoom <= 4 ? 30 : ui.zoom <= 8 ? 60 : 120;

  const pathOf = pts => pts.map(([m, i]) => `${x(m).toFixed(1)},${y(i)}`).join(' ');
  const dwell = pts => pts.flatMap((p, k) => (k && p[1] === pts[k - 1][1] ? [[pts[k - 1], p]] : []));
  const sel = selected && data.trains.find(t => t.number === selected);

  const move = e => {
    const r = wrap.current.getBoundingClientRect();
    setHover(h => h && { ...h, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const shift = dir => updateUi({ windowStart: Math.min(maxStart, Math.max(minStart, start + dir * span / 2)) });
  const hoverTrain = hover && data.trains.find(t => t.number === hover.n);
  const tipLeft = hover ? Math.min(hover.x + 14, width - 250) : 0;

  return html`<div class="gantt">
    ${!compact && html`<div class="gantt-controls">
      <${Segmented} label="Масштаб времени" value=${ui.zoom} options=${ZOOMS} onChange=${v => updateUi({ zoom: v })} />
      <div class="btn-group" role="group" aria-label="Сдвиг окна времени">
        <${Button} variant="secondary" size="sm" icon="chevron-left" label="Раньше" onClick=${() => shift(-1)} disabled=${start <= minStart} reason="Раньше данных нет: прошедшие поезда не хранятся" />
        <${Button} variant="secondary" size="sm" icon="chevron-right" label="Позже" onClick=${() => shift(1)} disabled=${start >= maxStart} reason="Больше поездов в графике нет" />
        <${Button} variant="secondary" size="sm" icon="locate-fixed" onClick=${() => updateUi({ windowStart: null })}>Сейчас</${Button}>
      </div>
      <${Segmented} label="Категория поездов" value=${ui.category} options=${CATS} onChange=${v => updateUi({ category: v })} />
    </div>`}
    ${sel && html`<div class="selection" role="status">
      <span class="swatch" style=${`background:${style[sel.priority].stroke}`}></span>
      <strong>№${sel.number}</strong><span>${sel.label}</span>
      <span class="muted">${data.stations[sel.route[0][1]].name} → ${data.stations[sel.route.at(-1)[1]].name}</span>
      <${Badge} tone=${sel.delay > 0 ? 'danger' : 'neutral'}>${delayText(sel.delay)}</${Badge}>
      <${Button} variant="ghost" size="sm" icon="x" onClick=${() => updateUi({ selectedTrain: null })}>Снять выделение</${Button}>
    </div>`}
    <div class="gantt-wrap" ref=${wrap} onPointerMove=${move} onPointerLeave=${() => setHover(null)}>
      <svg width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`} role="img"
        aria-label=${`График движения: ${trains.length} поездов на ${data.stations.length} станциях. Выделение и подробности — на странице «Поезда».`}>
        <defs>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="var(--danger-line)" stroke-width="3"/></pattern>
          <clipPath id="plot"><rect x=${LEFT} y=${TOP - 4} width=${plotW} height=${height - TOP + 4}/></clipPath>
        </defs>
        ${data.stations.map((s, i) => html`<g key=${s.id} class=${`g-station ${i % 2 ? 'alt' : ''}`}>
          <rect x="0" y=${y(i) - ROW / 2} width=${width} height=${ROW} class="g-row"/>
          <line x1=${LEFT} x2=${width - RIGHT} y1=${y(i)} y2=${y(i)} class="g-axis"/>
          <a href=${href(`/station/${s.id}`)} aria-label=${`Станция ${s.name}`}>
            <text x="12" y=${y(i) + 4} class="g-name">${s.name}</text>
            <text x=${LEFT - 14} y=${y(i) + 4} text-anchor="end" class="g-code">${s.id}</text>
          </a>
        </g>`)}
        ${ticks.map(m => html`<g key=${m}>
          <line x1=${x(m)} x2=${x(m)} y1=${TOP - 4} y2=${height - 6} class=${m % 60 === 0 ? 'g-grid hour' : 'g-grid'}/>
          ${m % labelEvery === 0 && x(m) < width - RIGHT - 18 && html`<text x=${x(m)} y="20" text-anchor="middle" class="g-time">${clockAt(data, m)}</text>`}
        </g>`)}
        <g clip-path="url(#plot)">
          ${closures.map(c => {
            const x0 = Math.max(LEFT, x(c.from)), x1 = Math.min(LEFT + plotW, c.until == null ? LEFT + plotW : x(c.until));
            if (x1 <= x0) return null;
            const label = c.kind === 'breakdown' ? c.label : `${c.track === 'both' ? 'закрыты оба пути' : c.track === 'odd' ? 'закрыт нечётный путь' : 'закрыт чётный путь'}`;
            return html`<g key=${c.id}>
              <rect x=${x0} y=${y(c.segment)} width=${x1 - x0} height=${ROW} fill="var(--danger-bg)"/>
              <rect x=${x0} y=${y(c.segment)} width=${x1 - x0} height=${ROW} fill="url(#hatch)" opacity=${c.from > nowMin ? .3 : .55}/>
              ${x1 - x0 > 120 && html`<text x=${(x0 + x1) / 2} y=${y(c.segment) + ROW / 2 + 4} text-anchor="middle" class="g-closed">Перегон ${data.stations[c.segment].id}–${data.stations[c.segment + 1].id} · ${label}</text>`}
            </g>`;
          })}
          ${data.restrictions.filter(r => (r.from == null || nowMin >= r.from) && (r.until == null || nowMin < r.until)).map(r => html`<g key=${r.segment}>
            <rect x=${LEFT + plotW - 96} y=${y(r.segment) + ROW / 2 - 11} width="90" height="22" rx="11" class="g-limit"/>
            <text x=${LEFT + plotW - 51} y=${y(r.segment) + ROW / 2 + 4} text-anchor="middle" class="g-limit-text">${r.kmh} км/ч</text>
          </g>`)}
          ${trains.map(t => {
            const st = style[t.priority];
            const faded = selected && selected !== t.number;
            const isSel = selected === t.number;
            return html`<g key=${t.number} class="g-train" opacity=${faded ? 0.2 : 1}>
              ${t.delay > 0 && html`<polyline points=${pathOf(t.route)} class="g-ghost"/>`}
              ${isSel && html`<polyline points=${pathOf(t.forecast)} fill="none" stroke="#fff" stroke-width=${st.width + 5} stroke-linejoin="round"/>`}
              <polyline points=${pathOf(t.forecast)} fill="none" stroke=${st.stroke} stroke-width=${isSel ? st.width + 1.6 : st.width}
                stroke-dasharray=${st.dash} stroke-linecap=${st.dash ? 'round' : 'butt'} stroke-linejoin="round"/>
              ${dwell(t.forecast).map(([a, b], k) => html`<line key=${k} x1=${x(a[0])} y1=${y(a[1])} x2=${x(b[0])} y2=${y(b[1])} class="g-wait"/>`)}
              <polyline points=${pathOf(t.forecast)} fill="none" stroke="transparent" stroke-width="12" class="g-hit"
                onPointerEnter=${e => { const r = wrap.current.getBoundingClientRect(); setHover({ n: t.number, x: e.clientX - r.left, y: e.clientY - r.top }); }}
                onClick=${() => updateUi({ selectedTrain: isSel ? null : t.number })}/>
            </g>`;
          })}
          ${sel && html`<text class="g-label" x=${x(sel.forecast[0][0]) + 8} y=${y(sel.forecast[0][1]) - 8}>№${sel.number}</text>`}
        </g>
        ${liveMin >= start && liveMin <= end && html`<g>
          <line x1=${x(liveMin)} x2=${x(liveMin)} y1=${TOP - 4} y2=${height - 6} class="g-now"/>
          <rect x=${x(liveMin) - 25} y="4" width="50" height="20" rx="5" class="g-now-chip"/>
          <text x=${x(liveMin)} y="18" text-anchor="middle" class="g-now-text">${time(liveMs)}</text>
        </g>`}
      </svg>
      ${hoverTrain && html`<div class="tip" style=${`left:${tipLeft}px;top:${Math.min(hover.y + 16, height - 120)}px`} role="tooltip">
        <strong>№${hoverTrain.number} · ${hoverTrain.label}</strong>
        <span>${data.stations[hoverTrain.route[0][1]].name} → ${data.stations[hoverTrain.route.at(-1)[1]].name}</span>
        <span>${DIRECTION[hoverTrain.direction]} направление · приоритет ${hoverTrain.priority}</span>
        <span class=${hoverTrain.delay > 0 ? 'bad' : ''}>Прибытие ${clockAt(data, hoverTrain.forecast.at(-1)[0])} · ${delayText(hoverTrain.delay)}</span>
      </div>`}
    </div>
    <div class="legend" aria-label="Обозначения">
      ${[1, 2, 3].map(p => html`<span key=${p}><svg width="30" height="10" aria-hidden="true"><line x1="1" y1="5" x2="29" y2="5" stroke=${style[p].stroke} stroke-width=${style[p].width + .4} stroke-dasharray=${style[p].dash} stroke-linecap=${style[p].dash ? 'round' : 'butt'}/></svg>${PRIORITY[p].short}</span>`)}
      <span><svg width="30" height="10" aria-hidden="true"><line x1="1" y1="5" x2="29" y2="5" class="g-ghost"/></svg>Нитка по графику</span>
      <span><svg width="30" height="10" aria-hidden="true"><line x1="1" y1="5" x2="29" y2="5" class="g-wait"/></svg>Ожидание на станции</span>
    </div>
  </div>`;
}
