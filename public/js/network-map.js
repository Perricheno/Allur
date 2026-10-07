// Главная страница: вся сеть КТЖ на карте Казахстана в реальном времени.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, Icon, time, dateLong, duration, count } from './lib.js';
import { app, act, go, updateUi, useLiveNow, liveNow, clock } from './store.js';
import { Badge, Button, Kpi, PageHeader, Segmented, Empty } from './ui.js';
import { attachNetwork, NetworkBar, useNetwork, KZ_BOUNDS } from './geo-network.js';
import { FleetSummary } from './fleet.js';
import { TrainSpecs } from './train-specs.js';
import { networkTrains, networkStats } from './network-sim.js';
import { useSim } from './network-data.js';

const COLORS = { passenger: '#007aa5', container: '#2c5770', freight: '#7a8c98' };
const FILTERS = [{ value: 'all', label: 'Все' }, { value: 'passenger', label: 'Пассажирские' }, { value: 'container', label: 'Контейнерные' }, { value: 'freight', label: 'Грузовые' }, { value: 'stopped', label: 'Стоят' }];
const SPEEDS = [{ value: 1, label: 'Реальное' }, { value: 60, label: '×60' }, { value: 180, label: '×180' }, { value: 600, label: '×600' }];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString('ru-RU');

const matches = (t, filter) => filter === 'all' || (filter === 'stopped' ? t.stopped && !t.planned : t.category === filter);

const DISPLAY_SPEEDS = [{ value: 1, label: 'Реальное' }, { value: 60, label: '×60' }, { value: 300, label: '×300' }, { value: 1200, label: '×1200' }];
const LABELS = [{ value: 'auto', label: 'Подписи: авто' }, { value: 'all', label: 'Все' }, { value: 'none', label: 'Нет' }];

/** Рисует все поезда на одном холсте поверх карты: стрелки по курсу, подписи с характеристиками, подсветка выбранного. */
function createTrainCanvas(map, getState) {
  const container = map.getContainer();
  const canvas = document.createElement('canvas');
  canvas.className = 'net-train-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let drawn = [];
  const resize = () => {
    const r = window.devicePixelRatio || 1, w = container.clientWidth, h = container.clientHeight;
    canvas.width = w * r; canvas.height = h * r; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.setTransform(r, 0, 0, r, 0, 0);
  };
  resize();
  map.on('resize', resize);
  const arrow = (x, y, heading, s, fill, stroke, lw) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(heading * Math.PI / 180);
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s * 0.85); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.7, s * 0.85); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); ctx.restore();
  };
  const pill = (text, x, y, color, strong) => {
    ctx.font = `${strong ? 700 : 600} 11px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 10, h = 17;
    const rect = { x: x - w / 2, y: y - h, w, h };
    ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.strokeStyle = color; ctx.lineWidth = strong ? 1.8 : 1.2;
    ctx.beginPath(); ctx.roundRect(rect.x, rect.y, w, h, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#11212c'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(text, x, y - h / 2 + 0.5);
    return rect;
  };
  const overlaps = (a, list) => list.some(b => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
  const draw = () => {
    const { trains, filter, selected, hover, labels } = getState();
    const w = container.clientWidth, h = container.clientHeight, zoom = map.getZoom();
    ctx.clearRect(0, 0, w, h);
    drawn = [];
    const s = Math.max(7, Math.min(15, 4.2 + zoom * 1.35));
    const visible = [];
    for (const t of trains) {
      if (!matches(t, filter) && t.uid !== selected) continue;
      const p = map.latLngToContainerPoint([t.lat, t.lon]);
      if (p.x < -30 || p.y < -30 || p.x > w + 30 || p.y > h + 30) continue;
      visible.push({ t, x: p.x, y: p.y });
    }
    // сначала грузовые, потом контейнерные, пассажирские сверху
    const order = { freight: 0, container: 1, passenger: 2 };
    visible.sort((a, b) => order[a.t.category] - order[b.t.category] || (a.t.stopped - b.t.stopped));
    for (const v of visible) {
      const { t, x, y } = v;
      const forced = t.stopped && !t.planned;
      const size = s + (t.category === 'passenger' ? 2 : 0);
      if (forced) { ctx.beginPath(); ctx.arc(x, y, size + 6 + (Date.now() / 120 % 6), 0, Math.PI * 2); ctx.strokeStyle = 'rgba(191,37,32,0.55)'; ctx.lineWidth = 2; ctx.stroke(); }
      arrow(x, y, t.heading, size, COLORS[t.category], forced ? '#bf2520' : '#ffffff', forced ? 2.6 : 1.6);
      drawn.push({ uid: t.uid, x, y, r: size + 4 });
    }
    // подписи: выбранный и наведённый всегда; остальные — по режиму и без наложений
    const placed = [];
    const labelFor = t => `№${t.number} · ${t.loco.series} · ${t.stopped ? 'стоит' : `${t.speedKmh} км/ч`}`;
    const wantAll = labels === 'all' || (labels === 'auto' && zoom >= 6.75 && visible.length <= 90);
    const priority = visible.filter(v => v.t.uid === selected || v.t.uid === hover).concat(
      labels === 'none' ? [] : visible.filter(v => v.t.stopped && !v.t.planned && v.t.uid !== selected && v.t.uid !== hover),
      wantAll ? visible.filter(v => !(v.t.stopped && !v.t.planned) && v.t.uid !== selected && v.t.uid !== hover) : []);
    for (const v of priority) {
      const { t, x, y } = v;
      const strong = t.uid === selected || t.uid === hover;
      const lines = strong ? [`№${t.number} · ${t.label}`, `${t.loco.series} · ${t.wagons} ваг. · ${t.stopped ? 'стоит' : `${t.speedKmh} км/ч`}`] : [labelFor(t)];
      let yy = y - (s + 8);
      for (let i = lines.length - 1; i >= 0; i--) {
        const rect = pill(lines[i], x, yy, t.stopped && !t.planned ? '#bf2520' : COLORS[t.category], strong);
        if (!strong && overlaps(rect, placed)) { ctx.clearRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4); break; }
        placed.push(rect); yy -= 19;
      }
    }
  };
  return { draw, hit: (x, y) => { let best = null, bd = 1e9; for (const d of drawn) { const dist = Math.hypot(d.x - x, d.y - y); if (dist < d.r + 6 && dist < bd) { bd = dist; best = d; } } return best; },
    destroy() { map.off('resize', resize); canvas.remove(); } };
}

export function NetworkPage({ data }) {
  const sim = useSim();
  const net = useNetwork();
  const ui = useLiveNow(2);
  const container = useRef(null), scene = useRef(null), wrap = useRef(null);
  const [filter, setFilter] = useState('all');
  const [labels, setLabels] = useState('auto');
  const [selected, setSelected] = useState(app.ui.selectedNetTrain || null);
  const [hover, setHover] = useState(null);
  const [background, setBackground] = useState('loading');
  const [speed, setSpeedState] = useState(1);
  const [paused, setPaused] = useState(false);
  const clockRef = useRef({ base: liveNow(), perf: performance.now(), mult: 1, paused: false });
  const netNow = () => { const c = clockRef.current; return c.paused ? c.base : c.base + (performance.now() - c.perf) * c.mult; };
  const setClock = patch => { const c = clockRef.current; const base = netNow(); clockRef.current = { ...c, base, perf: performance.now(), ...patch }; };
  const chooseSpeed = v => { setSpeedState(v); setClock({ mult: v }); };
  const togglePause = () => { setPaused(p => { setClock({ paused: !p }); return !p; }); };

  const simRef = useRef(sim); simRef.current = sim;
  const stateRef = useRef({ trains: [], filter, selected, hover, labels });
  stateRef.current.filter = filter; stateRef.current.selected = selected; stateRef.current.hover = hover; stateRef.current.labels = labels;
  if (sim && !sim.error && !stateRef.current.trains.length) stateRef.current.trains = networkTrains(sim, netNow());
  const trains = stateRef.current.trains;
  const stats = networkStats(trains);
  const shown = trains.filter(t => matches(t, filter));
  const picked = selected && trains.find(t => t.uid === selected);
  const hovered = hover && trains.find(t => t.uid === hover);
  const forced = trains.filter(t => t.stopped && !t.planned).sort((a, b) => b.delayMin - a.delayMin).slice(0, 7);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    const L = window.L;
    if (!L || !container.current) { setBackground('error'); return; }
    let alive = true;
    const map = L.map(container.current, { zoomControl: true, scrollWheelZoom: true, attributionControl: true, minZoom: 4, maxZoom: 16, preferCanvas: true, zoomSnap: 0.25 });
    map.attributionControl.setPrefix(false);
    map.fitBounds(KZ_BOUNDS, { padding: [8, 8] });
    let ok = 0;
    const base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' });
    base.on('tileload', () => { ok++; if (alive) setBackground('ready'); });
    base.on('tileerror', () => { if (alive && !ok) setBackground('error'); });
    base.addTo(map);
    L.tileLayer('https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', { maxZoom: 19, opacity: 0.4,
      attribution: 'Railway style: <a href="https://www.openrailwaymap.org">OpenRailwayMap</a> (CC-BY-SA 2.0)' }).addTo(map);
    const network = attachNetwork(L, map, { all: true });
    network.set('stations', true);
    network.set('halts', true);
    const selectedRoute = L.polyline([], { color: '#bf2520', weight: 4, opacity: 0.8, interactive: false }).addTo(map);
    const canvas = createTrainCanvas(map, () => stateRef.current);
    scene.current = { map, network, flyTo: (lat, lon, z = 9) => map.flyTo([lat, lon], z, { duration: 0.8 }) };
    // подвижные объекты: пересчёт и рисование ~12 раз в секунду
    let raf = 0, last = 0;
    const frame = ts => {
      if (!alive) return;
      if (ts - last >= 80) {
        last = ts;
        const sm = simRef.current;
        if (sm && !sm.error) stateRef.current.trains = networkTrains(sm, netNow());
        canvas.draw();
        const sel = stateRef.current.trains.find(t => t.uid === stateRef.current.selected);
        const route = sel && sm?.byId?.get(sel.routeId);
        if (!route && selectedRoute.getLatLngs().length) selectedRoute.setLatLngs([]);
        else if (route && selectedRoute._routeId !== route.id) { selectedRoute.setLatLngs(route.points.map(p => [p[0], p[1]])); selectedRoute._routeId = route.id; }
        if (!route) selectedRoute._routeId = null;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // выбор и подсказка по близости к стрелке
    const onMove = e => {
      const h = canvas.hit(e.containerPoint.x, e.containerPoint.y);
      setHover(prev => (prev === (h?.uid ?? null) ? prev : h?.uid ?? null));
      setTip(h ? { x: e.containerPoint.x, y: e.containerPoint.y } : null);
      map.getContainer().style.cursor = h ? 'pointer' : '';
    };
    const onClick = e => { const h = canvas.hit(e.containerPoint.x, e.containerPoint.y); if (h) { setSelected(h.uid); updateUi({ selectedNetTrain: h.uid }); } };
    map.on('mousemove', onMove); map.on('click', onClick); map.on('mouseout', () => { setHover(null); setTip(null); });
    const timeout = setTimeout(() => { if (alive && !ok) setBackground('error'); }, 10000);
    return () => { alive = false; clearTimeout(timeout); cancelAnimationFrame(raf); canvas.destroy(); network.destroy(); scene.current = null; map.remove(); };
  }, []);

  const focused = useRef(false);
  useEffect(() => {
    const t = !focused.current && selected && trains.find(x => x.uid === selected);
    if (t && scene.current) { focused.current = true; scene.current.flyTo(t.lat, t.lon, 8); }
  });
  const flyToTrain = t => { setSelected(t.uid); updateUi({ selectedNetTrain: t.uid }); scene.current?.flyTo(t.lat, t.lon, 8); };
  const netTime = netNow();
  return html`<${PageHeader} title="Сеть КТЖ в реальном времени"
      subtitle=${`${fmt(stats.total)} поездов на сети · ${net && !net.error ? fmt(net.net.stations.length) : '…'} станций · ${sim?.routes ? sim.routes.length : '…'} магистральных маршрутов`}
      />
    <section class="kpis net-kpis" aria-label="Сеть в цифрах">
      <${Kpi} label="Поездов на сети" icon="train-front" value=${fmt(stats.total)} note="на магистральных маршрутах Казахстана" />
      <${Kpi} label="Пассажирских" icon="users" value=${stats.passenger} note=${`≈ ${fmt(Math.round(stats.passengers / 100) * 100)} пассажиров в пути`} />
      <${Kpi} label="Грузовых и контейнерных" icon="package" value=${fmt(stats.freight + stats.container)} note=${`${fmt(stats.wagons)} вагонов в пути`} />
      <${Kpi} label="Локомотивы в пути" icon="zap" value=${fmt(stats.electric + stats.diesel)} note=${`электровозов ${stats.electric}, тепловозов ${stats.diesel}`} />
      <${Kpi} label="Стоят на станциях" icon="hourglass" tone=${stats.forced > 40 ? 'danger' : 'neutral'} value=${fmt(stats.stopped)} note=${`из них вынужденно ${stats.forced}`} />
      <${Kpi} label="Средняя скорость" icon="gauge" value=${stats.avgSpeed} unit="км/ч" note=${`${stats.delayed} с задержкой от 15 мин`} />
    </section>
    <section class="panel net-panel" aria-labelledby="netmap-title">
      <div class="panel-head"><div><h2 id="netmap-title">Карта сети</h2><small>Стрелка — поезд, направлена по курсу. Цвет — тип; красное кольцо — вынужденная остановка. Наведите курсор или нажмите на поезд, чтобы увидеть характеристики.</small></div>
        <div class="net-clock"><strong class="num">${time(netTime)}</strong><small>${dateLong(netTime)} · показ ${speed === 1 ? 'в реальном ходе' : `ускорен ×${speed}`}</small></div></div>
      <div class="net-toolbar">
        <${Segmented} label="Показать поезда" value=${filter} options=${FILTERS} onChange=${setFilter} />
        <${Segmented} label="Подписи над поездами" value=${labels} options=${LABELS} onChange=${setLabels} />
        <span class="net-count">На карте <strong>${fmt(shown.length)}</strong> из ${fmt(trains.length)}</span>
        <div class="net-time" hidden role="group" aria-label="Скорость показа сети">
          <${Button} size="sm" variant=${paused ? 'primary' : 'secondary'} icon=${paused ? 'play' : 'pause'} onClick=${togglePause}>${paused ? 'Пуск' : 'Пауза'}</${Button}>
          <${Segmented} label="Скорость показа" value=${speed} options=${DISPLAY_SPEEDS} onChange=${chooseSpeed} /></div>
      </div>
      <${NetworkBar} scene=${scene} />
      <div class="net-layout">
        <div class="net-map-wrap" ref=${wrap}><div ref=${container} class="net-map" role="region" aria-label="Карта железнодорожной сети Казахстана с поездами"></div>
          ${hovered && tip && html`<div class="net-tip" style=${`left:${Math.min(tip.x + 16, (wrap.current?.clientWidth || 800) - 270)}px;top:${Math.max(8, tip.y - 8)}px`} role="tooltip">
            <strong>№${hovered.number} · ${hovered.label}</strong><span>${hovered.route} (${hovered.dir === 'fwd' ? 'туда' : 'обратно'})</span>
            <span>Бригада №${hovered.crew.number}: до смены ${Math.floor(hovered.crew.leftMin / 60)} ч ${hovered.crew.leftMin % 60} мин</span>
            <span>${hovered.loco.series} · ${hovered.loco.type} · ${hovered.wagons} ваг.${hovered.cargo ? ` · ${hovered.cargo}, ${hovered.loaded ? 'гружёный' : 'порожний'}` : ''}</span>
            <span class=${hovered.stopped && !hovered.planned ? 'bad' : ''}>${hovered.stopped ? `Стоит: ${hovered.reason}` : `${hovered.speedKmh} км/ч · пройдено ${Math.round(hovered.progress * 100)}%`}</span>
            <small>Прибытие в ${time(hovered.arrivesMs)}</small></div>`}
          ${background === 'error' && html`<div class="geo-background-status" role="status">Фоновая карта недоступна. Станции и поезда отображаются на пустом фоне.</div>`}
          ${sim?.error && html`<div class="geo-background-status" role="alert">Не удалось загрузить маршруты сети.</div>`}</div>
        <aside class="net-aside" aria-label="Выбранный поезд и сводка">
          ${picked ? html`<div class="net-train">
              <div class="tc-head"><strong class="tc-num">№${picked.number}</strong><${Badge} tone=${picked.category === 'passenger' ? 'accent' : 'neutral'}>${picked.label}</${Badge}>
                <${Button} size="sm" variant="ghost" icon="x" onClick=${() => { setSelected(null); updateUi({ selectedNetTrain: null }); }}>Снять</${Button}></div>
              <p class="tc-status">${picked.stopped ? `Стоит ${picked.planned ? '(плановая стоянка)' : '(вынужденно)'}: ${picked.reason}. Отправление через ${picked.restMin} мин.` : `В пути со скоростью ${picked.speedKmh} км/ч, пройдено ${Math.round(picked.progress * 100)}%.`}</p>
              <${TrainSpecs} t=${picked} />
              <${Button} icon="locate-fixed" onClick=${() => flyToTrain(picked)}>Показать на карте</${Button}></div>`
            : html`<div class="net-hint"><${Icon} name="mouse-pointer-click" size=${18} /><span>Наведите курсор на стрелку-поезд или нажмите на неё. Колёсико мыши — масштаб, перетаскивание — сдвиг. При приближении над поездами появляются подписи.</span></div>`}
          <section class="net-list" aria-labelledby="forced-title"><h3 id="forced-title">Вынужденные стоянки <${Badge} tone=${stats.forced ? 'danger' : 'neutral'}>${stats.forced}</${Badge}></h3>
            ${forced.length ? html`<ul>${forced.map(t => html`<li key=${t.uid}><button type="button" onClick=${() => flyToTrain(t)}>
              <strong>№${t.number}</strong><span>${t.route}: ${t.reason}</span><span class="bad num">${t.delayMin} мин</span></button></li>`)}</ul>` : html`<p class="muted">Сейчас таких остановок нет.</p>`}</section>
          <${FleetSummary} data=${data} compact />
        </aside>
      </div>
    </section>
`;
}
