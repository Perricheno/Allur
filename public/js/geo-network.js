// Сеть Казахстана на географической карте: станции и остановочные пункты (OpenStreetMap), локомотивные депо.
import { useEffect, useState } from 'preact/hooks';
import { html, Icon } from './lib.js';
import { app, updateUi } from './store.js';
import { Button } from './ui.js';
import { CORRIDOR } from '/engine/rail-corridor.js';

let loading;
/** Станции и данные о парке грузятся один раз. */
export function loadNetwork() {
  loading ||= Promise.all([fetch('/data/kz-stations.json').then(r => r.json()), fetch('/data/fleet.json').then(r => r.json())])
    .then(([net, fleet]) => ({ net, fleet }));
  return loading;
}
export function useNetwork() {
  const [value, setValue] = useState(null);
  useEffect(() => { loadNetwork().then(setValue).catch(() => setValue({ error: true })); }, []);
  return value;
}

export const KZ_BOUNDS = [[40.4, 46.4], [55.6, 87.4]];
const corridorNodes = new Set(CORRIDOR.stations.map(s => s.osmNode));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const KIND_NAMES = { electric: 'электровозы', mainDiesel: 'магистральные тепловозы', shunting: 'маневровые тепловозы' };
const KIND_LETTER = { electric: 'Э', mainDiesel: 'Т', shunting: 'М' };

/** Слои сети на карте Leaflet. Возвращает управляющий объект. */
export function attachNetwork(L, map, { all = false } = {}) {
  const canvas = L.canvas({ padding: 0.4 });
  const layers = { stations: L.layerGroup(), halts: L.layerGroup(), depots: L.layerGroup() };
  const markers = { stations: [], halts: [] };
  const labeled = new Set();
  let data = null, alive = true, highlighted = null;

  const popup = (kind, rec) => {
    const [id, name, lat, lon, kk] = rec;
    return `<div class="geo-net-popup"><strong>${esc(name)}</strong>${kk ? `<span>${esc(kk)}</span>` : ''}<small>${kind === 'halt' ? 'Остановочный пункт или разъезд' : 'Станция'} · ${lat.toFixed(3)}, ${lon.toFixed(3)}</small>
      <a href="https://www.openstreetmap.org/node/${id}" target="_blank" rel="noopener">Объект в OpenStreetMap</a></div>`;
  };
  const build = kind => (kind === 'station' ? data.net.stations : data.net.halts).filter(r => all || !corridorNodes.has(r[0])).map(rec => {
    const station = kind === 'station';
    const m = L.circleMarker([rec[2], rec[3]], { renderer: canvas, radius: station ? 5 : 3.2, weight: station ? 1.6 : 1, color: '#fff',
      fillColor: station ? '#00566f' : '#6f8594', fillOpacity: 0.95 });
    m.bindTooltip(esc(rec[1]), { direction: 'top', offset: [0, -4], className: 'geo-net-tip' });
    m.bindPopup(popup(kind, rec));
    m.netRec = rec;
    return m;
  });

  const refreshLabels = () => {
    if (!data || !alive) return;
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const want = new Set();
    if (zoom >= 5.5) {
      // подписи прореживаем по сетке экрана: одна на ячейку, чтобы названия не накладывались
      const cw = zoom >= 9 ? 96 : 120, ch = 22, taken = new Set();
      const pools = [];
      if (map.hasLayer(layers.stations)) pools.push(markers.stations);
      if (map.hasLayer(layers.halts) && zoom >= 9) pools.push(markers.halts);
      for (const pool of pools) for (const m of pool) {
        if (want.size >= 160) break;
        if (/^\d+\s*км/i.test(m.netRec[1]) && zoom < 10) continue;
        const ll = m.getLatLng();
        if (!bounds.contains(ll)) continue;
        const pt = map.latLngToContainerPoint(ll), key = `${Math.floor(pt.x / cw)}:${Math.floor(pt.y / ch)}`;
        if (taken.has(key)) continue;
        taken.add(key); want.add(m);
      }
    }
    for (const m of [...labeled]) if (!want.has(m)) {
      m.unbindTooltip().bindTooltip(esc(m.netRec[1]), { direction: 'top', offset: [0, -4], className: 'geo-net-tip' });
      labeled.delete(m);
    }
    for (const m of want) if (!labeled.has(m)) {
      m.unbindTooltip().bindTooltip(esc(m.netRec[1]), { permanent: true, direction: 'right', offset: [7, 0], className: 'geo-net-label' });
      if (map.hasLayer(m)) m.openTooltip();
      labeled.add(m);
    }
  };
  map.on('moveend zoomend', refreshLabels);

  loadNetwork().then(d => {
    if (!alive) return;
    data = d;
    markers.stations = build('station'); markers.halts = build('halt');
    markers.stations.forEach(m => m.addTo(layers.stations));
    markers.halts.forEach(m => m.addTo(layers.halts));
    for (const depot of d.fleet.depots) {
      const kinds = depot.kinds.map(k => KIND_LETTER[k]).join('');
      const marker = L.marker([depot.lat, depot.lon], { icon: L.divIcon({ className: 'geo-depot-icon', iconSize: [30, 30], iconAnchor: [15, 15],
        html: `<span class="geo-depot ${depot.kinds.includes('electric') ? 'electric' : 'diesel'}" title="Депо ${esc(depot.name)}">${esc(kinds)}</span>` }), keyboard: true, title: `Локомотивное депо ${depot.name}` });
      const recv = d.fleet.deliveries2026.groups.filter(g => g.depots.includes(depot.name));
      marker.bindPopup(`<div class="geo-net-popup"><strong>Локомотивное депо ${esc(depot.name)}</strong><small>Станция ${esc(depot.station)}</small>
        <span>Тяга: ${depot.kinds.map(k => KIND_NAMES[k]).join(', ')}</span>
        ${recv.length ? `<span>Получает новые локомотивы (2026): ${recv.map(g => `${esc(g.name)} — ${g.count} на ${g.depots.length} депо`).join('; ')}</span>` : ''}
        <small>Число локомотивов по депо не публикуется в открытых источниках — показаны тип тяги и поставки.</small></div>`);
      marker.addTo(layers.depots);
    }
    refreshLabels();
    controller.ready = true;
    controller.onReady?.();
  });

  const controller = {
    ready: false, onReady: null, counts() { return data ? { stations: markers.stations.length + (all ? 0 : corridorNodes.size), halts: markers.halts.length, depots: data.fleet.depots.length } : null; },
    set(kind, on) {
      const layer = layers[kind];
      if (on && !map.hasLayer(layer)) layer.addTo(map);
      else if (!on && map.hasLayer(layer)) map.removeLayer(layer);
      refreshLabels();
    },
    has: kind => map.hasLayer(layers[kind]),
    fitKazakhstan: () => map.fitBounds(KZ_BOUNDS, { padding: [10, 10] }),
    flyTo(lat, lon, zoom = 11) { map.flyTo([lat, lon], zoom, { duration: 0.8 }); },
    show(rec, kind) {
      this.set(kind === 'halt' ? 'halts' : 'stations', true);
      map.flyTo([rec[2], rec[3]], 12, { duration: 0.8 });
      const m = (kind === 'halt' ? markers.halts : markers.stations).find(x => x.netRec[0] === rec[0]);
      if (highlighted) highlighted.setStyle({ weight: 1.6, color: '#fff' });
      if (m) { highlighted = m; m.setStyle({ weight: 4, color: '#bf2520' }); setTimeout(() => m.openPopup(), 900); }
    },
    search(query, limit = 8) {
      if (!data) return [];
      const q = query.trim().toLowerCase();
      if (q.length < 2) return [];
      const all = [...data.net.stations.map(r => ({ r, kind: 'station' })), ...data.net.halts.map(r => ({ r, kind: 'halt' }))];
      return all.filter(({ r }) => r[1].toLowerCase().includes(q) || (r[4] && r[4].toLowerCase().includes(q)))
        .sort((a, b) => (a.r[1].toLowerCase().startsWith(q) ? 0 : 1) - (b.r[1].toLowerCase().startsWith(q) ? 0 : 1) || (a.kind === 'station' ? 0 : 1) - (b.kind === 'station' ? 0 : 1)).slice(0, limit);
    },
    destroy() { alive = false; map.off('moveend zoomend', refreshLabels); for (const l of Object.values(layers)) map.removeLayer(l); },
  };
  return controller;
}

/** Панель управления слоями сети и поиск станции: вставляется под фильтрами карты. */
export function NetworkBar({ scene }) {
  const network = useNetwork();
  const [on, setOn] = useState({ stations: false, halts: false, depots: false });
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(false);
  const ctrl = () => scene.current?.network;
  // контроллер появляется после создания карты
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => { tries++; if (ctrl()?.ready) { const c = ctrl(); setOn({ stations: c.has('stations'), halts: c.has('halts'), depots: c.has('depots') }); setReady(true); clearInterval(id); } else if (tries > 100) clearInterval(id); }, 150);
    return () => clearInterval(id);
  }, []);
  // переход с других страниц: «показать на карте»
  useEffect(() => {
    const focus = app.ui.mapFocus;
    if (!ready || !focus) return;
    const c = ctrl();
    if (focus.kind === 'depot') { c.set('depots', true); setOn(v => ({ ...v, depots: true })); c.flyTo(focus.lat, focus.lon, 10); }
    else { c.show(focus.rec, focus.kind); setOn(v => ({ ...v, [focus.kind === 'halt' ? 'halts' : 'stations']: true })); }
    updateUi({ mapFocus: null });
  }, [ready, app.ui.mapFocus]);
  const counts = network && !network.error ? { stations: network.net.stations.length, halts: network.net.halts.length, depots: network.fleet.depots.length } : null;
  const toggle = kind => { const next = !on[kind]; setOn({ ...on, [kind]: next }); ctrl()?.set(kind, next); };
  const results = ready ? ctrl().search(query) : [];
  const chip = (kind, label, icon, n) => html`<button type="button" class=${`net-chip ${on[kind] ? 'on' : ''}`} aria-pressed=${on[kind]} disabled=${!ready} onClick=${() => toggle(kind)}>
    <${Icon} name=${icon} size=${15} />${label}${n != null && html` <b>${n}</b>`}</button>`;
  return html`<div class="net-bar" role="group" aria-label="Сеть железных дорог Казахстана">
    <strong class="net-title"><${Icon} name="map-pin" size=${16} />Сеть Казахстана</strong>
    ${chip('stations', 'Станции', 'building-2', counts?.stations)}
    ${chip('halts', 'Остановочные пункты', 'flag-triangle-right', counts?.halts)}
    ${chip('depots', 'Локомотивные депо', 'warehouse', counts?.depots)}
    <${Button} size="sm" icon="locate-fixed" disabled=${!ready} onClick=${() => { for (const k of ['stations']) { if (!on[k]) toggle(k); } ctrl().fitKazakhstan(); }}>Весь Казахстан</${Button}>
    <label class="net-search"><${Icon} name="search" size=${15} /><span class="sr-only">Найти станцию Казахстана</span>
      <input type="search" placeholder="Найти станцию по всему Казахстану" value=${query} disabled=${!ready} onInput=${e => setQuery(e.target.value)} /></label>
    ${results.length > 0 && html`<ul class="net-results" aria-label="Найденные станции">${results.map(({ r, kind }) => html`<li key=${r[0]}><button type="button" onClick=${() => { ctrl().show(r, kind); setOn(v => ({ ...v, [kind === 'halt' ? 'halts' : 'stations']: true })); setQuery(''); }}>
      <strong>${r[1]}</strong><small>${kind === 'halt' ? 'остановочный пункт' : 'станция'}${r[4] ? ` · ${r[4]}` : ''}</small></button></li>`)}</ul>`}
    ${network?.error && html`<span class="net-error" role="status">Данные о станциях не загрузились.</span>`}
  </div>`;
}
