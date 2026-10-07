import { useEffect, useRef, useState } from 'preact/hooks';
import { html, Icon, time, delayText, clockAt } from './lib.js';
import { app, act, href, updateUi, useLiveNow, liveNow, clock } from './store.js';
import { Button, PageHeader, Badge, Segmented } from './ui.js';
import { DispatcherPanel } from './panel.js';
import { placeTrains, describeTrain } from './trackmap.js';
import { stationTraffic } from './station-metrics.js';
import { CORRIDOR } from '/engine/rail-corridor.js';
import { coordinateAt, indexOfLocation, prepareGeometry } from './geo-position.js';
import { attachNetwork, NetworkBar } from './geo-network.js';
import { FleetSummary } from './fleet.js';

// A small railway silhouette: two cars and a cab at the leading end.
// Rotate only the vehicle; the number remains upright at every track heading.
const TRAIN_SVG = `<svg class="geo-train-vehicle" viewBox="0 0 76 24" aria-hidden="true" focusable="false">
  <g class="geo-train-body" fill="currentColor" stroke="#fff" stroke-width="1.6" stroke-linejoin="round">
    <path d="M2 5h19v12H2zM25 5h19v12H25zM48 5h12V2h7l7 8v7H48z"/>
    <path d="M21 12h4m19 0h4" fill="none"/>
  </g>
  <path class="geo-train-windows" d="M6 8h4v4H6zm8 0h4v4h-4zm15 0h4v4h-4zm8 0h4v4h-4zm25-3h3l4 5h-7z" fill="#fff"/>
  <path d="M49 13h21" stroke="#fff" stroke-width="1.5"/>
  <g fill="#183444" stroke="#fff" stroke-width="1"><circle cx="7" cy="19" r="2.6"/><circle cx="17" cy="19" r="2.6"/><circle cx="30" cy="19" r="2.6"/><circle cx="40" cy="19" r="2.6"/><circle cx="54" cy="19" r="2.6"/><circle cx="68" cy="19" r="2.6"/></g>
</svg>`;
const GEOMETRY = prepareGeometry(CORRIDOR.segments);
const SPEEDS = [{ value: 1, label: 'Реальное' }, { value: 60, label: '×60' }, { value: 180, label: '×180' }, { value: 600, label: '×600' }];
const FILTERS = [{ value: 'all', label: 'Все' }, { value: 'attention', label: 'Внимание' }, { value: 'passenger', label: 'Пассажирские' }, { value: 'cargo', label: 'Грузовые' }];
const isMoving = r => r.loc.kind === 'move' && !r.t.disabled && !(r.broken && r.t.broken.level >= 2);
const needsAttention = r => r.broken || (r.stopped && !r.planned && !r.service) || r.t.delay >= 5;
const matchesFilter = (r, filter) => filter === 'all' || (filter === 'attention' ? needsAttention(r) : filter === 'cargo' ? r.t.category !== 'passenger' : r.t.category === filter);
const openCommands = () => {
  const panel = document.getElementById('geo-dispatcher');
  if (document.fullscreenElement) document.exitFullscreen().then(() => { panel.open = true; panel.scrollIntoView({ block: 'start' }); });
  else if (panel) { panel.open = true; panel.scrollIntoView({ block: 'start' }); }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function GeographicMap({ data }) {
  const details = useRef(null), firstSelection = useRef(true);
  const surface = useRef(null), container = useRef(null), scene = useRef(null), current = useRef(data);
  current.current = data;
  const [background, setBackground] = useState('loading');
  const [railway, setRailway] = useState(true);
  const [follow, setFollow] = useState(false);
  const [filter, setFilter] = useState('all');
  const [settings, setSettings] = useState(false);
  const [names, setNames] = useState(true);
  const [numbers, setNumbers] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [screenError, setScreenError] = useState('');
  const filterRef = useRef(filter); filterRef.current = filter;
  const numbersRef = useRef(numbers); numbersRef.current = numbers;
  const followRef = useRef(follow); followRef.current = follow;
  const now = useLiveNow(2);
  const tMin = (now - data.baseTime) / 60000;
  const live = placeTrains(data, tMin);
  const rec = live.find(r => r.t.number === app.ui.selectedTrain);
  const visibleTrains = live.filter(r => matchesFilter(r, filter) || r.t.number === app.ui.selectedTrain);
  const attention = live.filter(needsAttention).sort((a,b) => Number(b.broken) - Number(a.broken) || b.t.delay - a.t.delay);
  const closures = data.dispatch.closures.filter(c => tMin >= c.from && (c.until == null || tMin < c.until));
  const restrictions = data.restrictions.filter(r => (r.from == null || tMin >= r.from) && (r.until == null || tMin < r.until));
  const selectedTrain = data.trains.find(t => t.number === app.ui.selectedTrain);
  const station = data.stations.find(s => s.id === app.ui.selectedStation);

  useEffect(() => {
    const L = window.L;
    if (!L || !container.current) { setBackground('error'); return; }
    let alive = true;
    const map = L.map(container.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true, minZoom: 5, maxZoom: 18 });
    map.attributionControl.setPrefix(false);
    const bounds = L.latLngBounds(CORRIDOR.segments.flat());
    map.fitBounds(bounds, { padding: [60, 45] });
    const base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' });
    let successes = 0;
    base.on('tileload', () => { successes++; if (alive) setBackground('ready'); });
    base.on('tileerror', () => { if (alive && !successes) setBackground('error'); });
    base.addTo(map);
    const rails = L.tileLayer('https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
      maxZoom: 19, opacity: .4,
      attribution: 'Railway style: <a href="https://www.openrailwaymap.org">OpenRailwayMap</a> (<a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA 2.0</a>)',
    }).addTo(map);
    // Local geometry remains available even when external tile services fail.
    map.attributionControl.addAttribution('Маршрут: <a href="https://www.openstreetmap.org/copyright">OSM / ODbL</a>');
    const lines = CORRIDOR.segments.map((points, i) => {
      L.polyline(points, { color: '#fff', weight: 8, opacity: .95, interactive: false }).addTo(map);
      return L.polyline(points, { color: '#007fa3', weight: 4, opacity: .9 }).addTo(map).bindTooltip(`${esc(CORRIDOR.stations[i].name)} — ${esc(CORRIDOR.stations[i + 1].name)}`);
    });
    const stations = CORRIDOR.stations.map((s, i) => {
      const marker = L.marker(coordinateAt(GEOMETRY, i), {
        icon: L.divIcon({ className: 'geo-station-icon', html: `<span>${esc(s.id)}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: `Выбрать станцию ${s.name}`, keyboard: true,
      }).addTo(map);
      marker.bindTooltip(esc(s.name), { permanent: true, direction: i % 2 ? 'right' : 'left', className: 'geo-station-label', offset: [i % 2 ? 12 : -12, 0] });
      marker.on('click', () => { setFollow(false); updateUi({ selectedStation: s.id, selectedTrain: null }); });
      marker.getElement().setAttribute('aria-label', `Выбрать станцию ${s.name}`);
      marker.getElement().setAttribute('role', 'button');
      marker.getElement().addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); updateUi({ selectedStation: s.id, selectedTrain: null }); } });
      return marker;
    });
    const trains = new Map();
    const network = attachNetwork(L, map);
    scene.current = { map, base, rails, bounds, stations, lines, trains, network };
    const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(container.current);
    let raf = 0, last = -Infinity, lastFollow = -Infinity;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const draw = ts => {
      if (ts - last >= (reduced.matches ? 500 : 100)) {
        last = ts;
        const d = current.current, t = (liveNow() - d.baseTime) / 60000;
        const records = placeTrains(d, t).filter(r => matchesFilter(r, filterRef.current) || r.t.number === app.ui.selectedTrain);
        const visible = new Set(records.map(r => r.t.number));
        for (const [number, entry] of trains) if (!visible.has(number)) { map.removeLayer(entry.marker); trains.delete(number); }
        for (const r of records) {
          const number = r.t.number, index = indexOfLocation(r.loc), point = coordinateAt(GEOMETRY, index);
          const compact = !numbersRef.current && map.getZoom() < 9 && number !== app.ui.selectedTrain;
          const state = `${compact}:${r.t.category}:${r.stopped || r.broken}:${r.service}:${number === app.ui.selectedTrain}:${r.odd}`;
          let entry = trains.get(number);
          if (!entry) {
            const marker = L.marker(point, { icon: L.divIcon({ className: 'geo-train-icon', html: '', iconSize: [66, 28], iconAnchor: [33, 14] }), keyboard: true, title: `Выбрать поезд №${number}`, zIndexOffset: 500 });
            entry = { marker, state: null }; trains.set(number, entry);
            marker.on('click', () => { setFollow(false); updateUi({ selectedTrain: number, selectedStation: null }); });
            marker.addTo(map);
          }
          if (entry.state !== state) {
            entry.marker.setIcon(L.divIcon({ className: 'geo-train-icon', iconSize: compact ? [44, 44] : [76, 76], iconAnchor: compact ? [22, 22] : [38, 38],
              html: `<span class="geo-train ${compact ? 'compact' : ''} ${r.t.category} ${r.stopped || r.broken ? 'stopped' : ''} ${r.service ? 'service' : ''} ${number === app.ui.selectedTrain ? 'selected' : ''}">${TRAIN_SVG}<span class="geo-train-number">${esc(number)}</span>${r.stopped || r.broken || r.service ? '<span class="geo-train-stop" aria-hidden="true"></span>' : ''}</span>` }));
            const el = entry.marker.getElement(); el.setAttribute('aria-label', `Выбрать поезд №${number}`); el.setAttribute('role', 'button');
            el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); updateUi({ selectedTrain: number, selectedStation: null }); } };
            entry.marker.unbindTooltip().bindTooltip(`№${esc(number)} · ${esc(r.t.label)}`, { direction: 'top' });
            entry.state = state;
          }
          entry.marker.setLatLng(point);
          // Sample both sides to retain the track heading at endpoints and while stopped.
          const behind = map.latLngToLayerPoint(coordinateAt(GEOMETRY, index - .003));
          const ahead = map.latLngToLayerPoint(coordinateAt(GEOMETRY, index + .003));
          const angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180 / Math.PI + (r.odd ? 180 : 0);
          entry.marker.getElement().style.setProperty('--train-heading', `${angle}deg`);
          if (followRef.current && number === app.ui.selectedTrain && ts - lastFollow > 1000) { map.panTo(point, { animate: false }); lastFollow = ts; }
        }
        stations.forEach((marker, i) => {
          marker.getElement()?.classList.toggle('selected', d.stations[i]?.id === app.ui.selectedStation);
        });
        lines.forEach((line, i) => {
          const closed = d.dispatch.closures.some(c => c.segment === i && t >= c.from && (c.until == null || t < c.until));
          const limited = d.restrictions.some(r => r.segment === i && (r.from == null || t >= r.from) && (r.until == null || t < r.until));
          line.setStyle({ color: closed ? '#bf2520' : limited ? '#a96b06' : '#007fa3', dashArray: closed ? '8 7' : limited ? '3 5' : null });
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const timeout = setTimeout(() => { if (alive && !successes) setBackground('error'); }, 10000);
    return () => { alive = false; clearTimeout(timeout); cancelAnimationFrame(raf); observer.disconnect(); network.destroy(); scene.current = null; map.remove(); };
  }, []);

  useEffect(() => {
    const s = scene.current; if (!s) return;
    if (railway && !s.map.hasLayer(s.rails)) s.rails.addTo(s.map);
    else if (!railway && s.map.hasLayer(s.rails)) s.map.removeLayer(s.rails);
  }, [railway]);
  useEffect(() => {
    scene.current?.stations.forEach(marker => {
      if (names) marker.openTooltip(); else marker.closeTooltip();
    });
  }, [names]);
  useEffect(() => {
    const changed = () => { setFullscreen(document.fullscreenElement === surface.current); scene.current?.map.invalidateSize(); };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (firstSelection.current) { firstSelection.current = false; return; }
    if ((station || selectedTrain) && window.matchMedia('(max-width:760px)').matches) details.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [station?.id, selectedTrain?.number]);
  const toggleFullscreen = async () => {
    try {
      setScreenError('');
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (surface.current.requestFullscreen) await surface.current.requestFullscreen();
      else setScreenError('Полноэкранный режим недоступен в этом браузере.');
    } catch { setScreenError('Браузер не разрешил полноэкранный режим.'); }
  };
  const chooseTrain = number => {
    updateUi({ selectedTrain: number, selectedStation: null }); setFollow(false);
    const r = live.find(r => r.t.number === number);
    if (r) scene.current?.map.setView(coordinateAt(GEOMETRY, indexOfLocation(r.loc)), 11);
  };
  const chooseStation = id => {
    updateUi({ selectedStation: id, selectedTrain: null }); setFollow(false);
    const index = data.stations.findIndex(s => s.id === id);
    if (index >= 0) scene.current?.map.setView(coordinateAt(GEOMETRY, index), 11);
  };
  const fit = () => { setFollow(false); scene.current?.map.fitBounds(scene.current.bounds, { padding: [60, 45] }); };
  const center = () => {
    if (rec) { scene.current?.map.setView(coordinateAt(GEOMETRY, indexOfLocation(rec.loc)), 12); setFollow(true); }
  };
  return html`<section ref=${surface} class="panel geo-panel" aria-labelledby="geo-title">
    <div class="geo-toolbar">
      <div class="geo-clock"><strong>${time(now)}</strong><span class=${`geo-clock-state ${clock.running ? 'running' : ''}`}>${clock.running ? 'Движение идёт' : 'На паузе'}</span></div>
      <${Button} size="sm" icon=${clock.running ? 'pause' : 'play'} onClick=${() => act({ type: 'clock', running: !clock.running })} disabled=${!app.online || app.busy}>${clock.running ? 'Пауза' : 'Пуск'}</${Button}>
      <label class="geo-train-picker"><span class="sr-only">Поезд на карте</span><${Icon} name="train-front" size=${16} /><select aria-label="Выбрать поезд на карте" value=${rec?.t.number ?? ''} onChange=${e => { if (e.target.value) chooseTrain(e.target.value); }}><option value="">Найти поезд по номеру</option>${live.map(r => html`<option key=${r.t.number} value=${r.t.number}>№${r.t.number} · ${r.t.label}</option>`)}</select></label>
      <div class="geo-view-controls"><${Button} size="sm" icon="locate-fixed" onClick=${fit}>Весь участок</${Button}><${Button} size="sm" icon=${fullscreen ? 'minimize' : 'maximize'} label=${fullscreen ? 'Выйти из полноэкранного режима' : 'Карта на весь экран'} title=${fullscreen ? 'Выйти из полноэкранного режима' : 'Карта на весь экран'} onClick=${toggleFullscreen} /><${Button} size="sm" icon="sliders-horizontal" aria-expanded=${settings} aria-controls="geo-settings" onClick=${() => setSettings(!settings)}>Настройки</${Button}></div>
    </div>
    ${screenError && html`<p class="geo-inline-error" role="status">${screenError}</p>`}
    <div id="geo-settings" class="geo-settings" hidden=${!settings}>
      <label class="geo-speed">Модельное время<select aria-label="Скорость времени на карте" value=${data.speed} disabled=${!app.online || app.busy} onChange=${e => act({ type: 'clock', speed: Number(e.target.value) })}>${SPEEDS.map(s => html`<option value=${s.value}>${s.label}</option>`)}</select></label>
      <label class="geo-check"><input type="checkbox" checked=${railway} onChange=${e => setRailway(e.target.checked)} />Слой OpenRailwayMap</label>
      <label class="geo-check"><input type="checkbox" checked=${names} onChange=${e => setNames(e.target.checked)} />Названия станций</label>
      <label class="geo-check"><input type="checkbox" checked=${numbers} onChange=${e => setNumbers(e.target.checked)} />Всегда показывать номера</label>
    </div>
    <div class="geo-filterbar"><${Segmented} label="Показать поезда" value=${filter} options=${FILTERS} onChange=${setFilter} /><span class="geo-visible-count">На карте <strong>${visibleTrains.length}</strong> / ${live.length}</span></div>
    <${NetworkBar} scene=${scene} />
    <div class="geo-layout">
      <div class="geo-map-wrap"><div ref=${container} class="geo-map" role="region" aria-label="Географическая карта железнодорожного участка"></div>
        ${!visibleTrains.length && html`<div class="geo-empty-filter" role="status"><strong>По этому фильтру поездов нет</strong><button type="button" onClick=${() => setFilter('all')}>Показать все поезда</button></div>`}
        ${background !== 'ready' && html`<div class="geo-background-status" role="status">${background === 'loading' ? 'Загрузка фоновой карты…' : html`Фоновая карта недоступна. Маршрут и поезда доступны. <button type="button" onClick=${() => { setBackground('loading'); scene.current?.base.redraw(); scene.current?.rails.redraw(); }}>Повторить</button>`}</div>`}
      </div>
      <aside ref=${details} class="geo-details" aria-label="Выбранный объект на карте">
        <div class="geo-detail-heading"><h2 id="geo-title">${station ? station.name : selectedTrain ? `Поезд №${selectedTrain.number}` : 'Обстановка на участке'}</h2>${(station || selectedTrain) && html`<${Button} size="sm" variant="ghost" icon="x" label="Снять выбор" onClick=${() => { updateUi({ selectedStation: null, selectedTrain: null }); setFollow(false); }} />`}</div>
        ${station ? html`<${Badge}>${station.type} · станция ${station.id}</${Badge}><div class="geo-capacity"><div><span>Занято подъездных путей</span><strong>${station.capacity ? Math.round(station.occupied / station.capacity * 100) : 0}%</strong></div><progress max=${Math.max(1,station.capacity)} value=${station.occupied} aria-label="Занятость подъездных путей" /><small>${station.occupied} из ${station.capacity} вагонных мест</small></div><dl class="geo-facts"><div><dt>Можно подать</dt><dd>${station.available} <small>ваг.</small></dd></div><div><dt>Ждут приёма</dt><dd>${stationTraffic(data, station.id, now).waiting} <small>групп</small></dd></div></dl><a class="btn btn-primary" href=${href(`/station/${station.id}`)}>Грузовая работа станции</a><${Button} onClick=${openCommands}>Команды диспетчера</${Button}><details class="geo-extra"><summary>Дополнительные сведения</summary><p>Резерв: ${station.reserved} ваг. · ${station.tracks.length} подъездных путей.</p></details>`
        : selectedTrain ? html`<${Badge} tone=${rec && needsAttention(rec) ? 'danger' : 'accent'}>${selectedTrain.label}${rec?.broken ? ' · Неисправность' : selectedTrain.delay >= 5 ? ` · +${selectedTrain.delay} мин` : ''}</${Badge}><p class="geo-train-status">${rec ? rec.broken && selectedTrain.broken.level >= 2 ? `Остановлен из-за неисправности. ${selectedTrain.disabled ? 'Поезд снят с рейса, ожидает резервный локомотив.' : `Устранение до ${clockAt(data, selectedTrain.broken.until)}.`}` : describeTrain(data, rec, tMin) : 'Поезд сейчас вне участка: ожидает отправления или завершил рейс.'}</p>${rec && isMoving(rec) && Number.isInteger(rec.loc.from) && Number.isInteger(rec.loc.to) && html`<div class="geo-journey"><span>${data.stations[rec.loc.from].name}</span><strong>${clockAt(data,rec.loc.t1)}</strong><progress max="1" value=${rec.loc.f} aria-label="Пройденная часть перегона" /><span>${data.stations[rec.loc.to].name}</span><small>прибытие по прогнозу</small></div>`}<${Button} variant="primary" onClick=${openCommands}>Команды диспетчера</${Button}><${Button} icon="locate-fixed" disabled=${!rec} reason="Поезд сейчас вне участка" onClick=${center}>Найти и следить</${Button}><label class="geo-check"><input type="checkbox" checked=${follow} disabled=${!rec} onChange=${e => setFollow(e.target.checked)} />Следить за поездом</label><details class="geo-extra"><summary>Данные поезда</summary><dl class="geo-facts"><div><dt>Вагонов</dt><dd>${selectedTrain.wagons}</dd></div><div><dt>Задержка</dt><dd>${delayText(selectedTrain.delay)}</dd></div></dl><p>${data.stations[selectedTrain.route[0][1]].name} → ${data.stations[selectedTrain.route.at(-1)[1]].name}</p></details>`
        : html`${data.blocked && !data.planApproved && html`<div class="geo-plan-alert"><${Icon} name="triangle-alert" size=${17} /><div><strong>Нужно подтвердить план пропуска</strong><a href=${href('/decisions')}>Сравнить варианты</a></div></div>`}<div class="geo-overview-stats"><span><strong>${live.filter(isMoving).length}</strong> в движении</span><span><strong>${live.filter(r => !isMoving(r)).length}</strong> без движения</span></div>
          <section class="geo-attention" aria-label="Требуют внимания"><h3>Требуют внимания <span>${attention.length}</span></h3>${attention.length ? html`<ul>${attention.slice(0,4).map(r => html`<li key=${r.t.number}><button type="button" onClick=${() => chooseTrain(r.t.number)}><${Icon} name=${r.broken ? 'triangle-alert' : 'clock'} size=${16} /><span><strong>№${r.t.number}</strong><small>${r.broken ? 'Неисправность' : r.stopped && !r.planned ? 'Ожидает пропуска' : `Задержка ${r.t.delay} мин`}</small></span><${Icon} name="chevron-right" size=${15} /></button></li>`)}</ul>${attention.length > 4 && html`<button class="geo-text-action" type="button" onClick=${() => setFilter('attention')}>Показать все ${attention.length} на карте</button>`}` : html`<p class="geo-clear"><${Icon} name="circle-check" size=${17} />Неплановых остановок и задержек от 5 минут нет.</p>`}</section>
          <section class="geo-segment-status" aria-label="Состояние перегонов"><h3>Перегоны</h3>${closures.length || restrictions.length ? html`<ul>${closures.map(c => html`<li key=${c.id}><${Icon} name="ban" size=${15} /><span>${data.stations[c.segment].name} — ${data.stations[c.segment+1].name}<small>${{odd:'Нечётный путь закрыт',even:'Чётный путь закрыт',both:'Оба пути закрыты'}[c.track]}</small></span></li>`)}${restrictions.map(r => html`<li key=${r.segment}><${Icon} name="gauge" size=${15} /><span>${data.stations[r.segment].name} — ${data.stations[r.segment+1].name}<small>Ограничение ${r.kmh} км/ч</small></span></li>`)}</ul>` : html`<p class="muted">Все 9 перегонов открыты.</p>`}</section>
          <${FleetSummary} data=${data} compact />
          <label class="geo-station-picker">Перейти к станции<select aria-label="Найти станцию на карте" value="" onChange=${e => { if(e.target.value) chooseStation(e.target.value); }}><option value="">Выберите станцию</option>${data.stations.map(s => html`<option value=${s.id}>${s.name}</option>`)}</select></label><p class="geo-hint">Нажмите на поезд или станцию, чтобы открыть сведения и команды.</p>`}
      </aside>
    </div>
    <footer class="geo-footer"><span>Учебная модель · 10 станций · ${Math.round(CORRIDOR.lengthKm)} км</span><details class="geo-map-help"><summary>Обозначения и управление</summary><div class="geo-legend" aria-label="Обозначения карты"><span><i class="geo-key passenger"></i>Пассажирский</span><span><i class="geo-key freight"></i>Грузовой</span><span><i class="geo-key container"></i>Контейнерный</span><span><i class="geo-key stopped"></i>Стоянка / неисправность</span><span><i class="geo-line closed"></i>Закрытие</span><span><i class="geo-line limited"></i>Ограничение скорости</span></div><p>Мини-поезда направлены по ходу движения. Номера видны при приближении и выборе. Масштаб меняется кнопками + / − и жестом двумя пальцами; колесо прокручивает страницу. География — OpenStreetMap, движение — симуляция, а не GPS-позиции поездов.</p></details></footer>
  </section>`;
}

export function MapPage({ data }) {
  return html`<div class="geo-page-head"><${PageHeader} title="Карта участка" subtitle="Караганда — Мойынты" actions=${html`<a class="geo-scheme-link" href=${href('/overview?route=corridor')}><${Icon} name="chart-gantt" size=${16} />Схема и ГИД</a>`} /></div>
    <${GeographicMap} data=${data} /><details id="geo-dispatcher" class="geo-command-details"><summary><${Icon} name="list-checks" size=${18} /><span><strong>Панель диспетчера</strong><small>Задачи, варианты пропуска и команды выбранному объекту</small></span><${Icon} name="chevron-down" size=${18} /></summary><${DispatcherPanel} data=${data} /></details>`;
}
