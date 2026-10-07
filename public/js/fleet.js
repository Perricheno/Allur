import { useMemo, useState } from 'preact/hooks';
import { html, Icon, count } from './lib.js';
import { app, go, updateUi } from './store.js';
import { Badge, Button, Kpi, PageHeader, Empty } from './ui.js';
import { useNetwork, KIND_NAMES } from './geo-network.js';
import { useNetworkTrains } from './network-data.js';

const KIND_ICON = { electric: 'zap', mainDiesel: 'fuel', shunting: 'cog' };
const fmt = n => n.toLocaleString('ru-RU');

/** Локомотивы в пути по всей сети сейчас. */
export function networkFleet(trains) {
  const by = new Map();
  for (const t of trains) {
    const e = by.get(t.loco.series) || { series: t.loco.series, type: t.loco.type, powerKw: t.loco.kw, running: 0 };
    e.running += 1; by.set(t.loco.series, e);
  }
  const sum = type => trains.filter(t => t.loco.type === type).length;
  return { series: [...by.values()].sort((a, b) => b.running - a.running), electric: sum('электровоз'), diesel: sum('тепловоз'), onLine: trains.length };
}

/** Примерный парк КТЖ по типам тяги и «на участке сейчас». */
export function FleetSummary({ data, compact = false }) {
  const network = useNetwork();
  const { trains } = useNetworkTrains(10);
  if (!network) return html`<section class="fleet-summary"><p class="muted">Загружаем данные о парке…</p></section>`;
  if (network.error) return null;
  const { fleet } = network;
  const cf = networkFleet(trains);
  const max = Math.max(...fleet.types.map(t => t.approx));
  return html`<section class=${`fleet-summary ${compact ? 'compact' : ''}`} aria-labelledby=${compact ? 'fleet-sum-title' : undefined}>
    <h3 id="fleet-sum-title">Локомотивы КТЖ <${Badge} tone="muted" title=${fleet.disclaimer}>оценка</${Badge}></h3>
    <p class="fleet-total"><strong>≈ ${fmt(fleet.total)}</strong> локомотивов в парке</p>
    <ul class="fleet-bars">${fleet.types.map(t => html`<li key=${t.id}><span class="fb-name"><${Icon} name=${KIND_ICON[t.id]} size=${15} />${t.name}</span>
      <span class="fb-bar" role="img" aria-label=${`${t.name}: около ${t.approx}`}><i style=${`width:${t.approx / max * 100}%`}></i></span><strong class="num">≈ ${fmt(t.approx)}</strong></li>`)}</ul>
    <p class="fleet-corridor"><${Icon} name="train-front" size=${15} />В пути сейчас: <strong>${cf.onLine}</strong> локомотивов (электровозов ${cf.electric}, тепловозов ${cf.diesel}).</p>
    ${!compact && html`<a class="link" href="#/fleet">Подробнее о парке и сети →</a>`}
    ${compact && html`<a class="link" href="#/fleet">Парк, серии и депо →</a>`}
  </section>`;
}

export function FleetPage({ data }) {
  const network = useNetwork();
  const { trains } = useNetworkTrains(10);
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    if (!network || network.error) return [];
    const q = query.trim().toLowerCase();
    const all = [...network.net.stations.map(r => ({ r, kind: 'station' })), ...network.net.halts.map(r => ({ r, kind: 'halt' }))];
    const named = ({ r, kind }) => kind === 'station' && /^[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/.test(r[1]) && !/км|разъезд/i.test(r[1]);
    const list = q.length < 2 ? all.filter(named).slice(0, 24) : all.filter(({ r }) => r[1].toLowerCase().includes(q) || (r[4] && r[4].toLowerCase().includes(q)));
    return list.slice(0, 60);
  }, [network, query]);
  if (!network) return html`<${PageHeader} title="Парк и сеть" subtitle="Загружаем данные…" />`;
  if (network.error) return html`<${PageHeader} title="Парк и сеть" /><${Empty} icon="circle-alert" title="Данные не загрузились">Обновите страницу.</${Empty}>`;
  const { fleet, net } = network;
  const cf = networkFleet(trains);
  const showOnMap = (rec, kind) => { updateUi({ mapFocus: { kind, rec } }); go('/'); };
  const showDepot = d => { updateUi({ mapFocus: { kind: 'depot', lat: d.lat, lon: d.lon } }); go('/'); };
  return html`<${PageHeader} title="Парк и сеть" subtitle="Локомотивы КТЖ (оценка), станции Казахстана и депо. Модель движения использует те же серии."
      actions=${html`<${Button} variant="primary" icon="map-pin" onClick=${() => go('/')}>Открыть карту</${Button}>`} />
    <section class="kpis" aria-label="Парк и сеть в цифрах">
      <${Kpi} label="Парк локомотивов" icon="truck" value=${`≈ ${fmt(fleet.total)}`} note="оценка на 2026 год" />
      ${fleet.types.map(t => html`<${Kpi} key=${t.id} label=${t.name} icon=${KIND_ICON[t.id]} value=${`≈ ${fmt(t.approx)}`} note=${t.note} />`)}
      <${Kpi} label="Станции" icon="building-2" value=${fmt(net.stations.length)} note="по данным OpenStreetMap" />
      <${Kpi} label="Остановочные пункты" icon="flag-triangle-right" value=${fmt(net.halts.length)} note="и разъезды, OpenStreetMap" />
    </section>
    <div class="grid-main fleet-grid">
      <section class="panel" aria-labelledby="ft-title">
        <div class="panel-head"><h2 id="ft-title">Парк по типам тяги</h2><${Badge} tone="muted">оценка</${Badge}></div>
        <${FleetSummary} data=${data} />
        <p class="note"><${Icon} name="info" size=${15} /> ${fleet.disclaimer}</p>
        <div class="fleet-series">${fleet.series.map(g => html`<div key=${g.type}><h3><${Icon} name=${KIND_ICON[g.type]} size=${16} />${KIND_NAMES[g.type][0].toUpperCase() + KIND_NAMES[g.type].slice(1)}</h3>
          <ul>${g.items.map(([name, text]) => html`<li key=${name}><strong>${name}</strong><span>${text}</span></li>`)}</ul></div>`)}</div>
      </section>
      <aside class="aside">
        <section class="panel" aria-labelledby="del-title">
          <div class="panel-head"><h2 id="del-title">Новые поставки 2026</h2><strong class="num">${fleet.deliveries2026.total}</strong></div>
          <ul class="deliveries">${fleet.deliveries2026.groups.map(g => html`<li key=${g.type}><div><strong>${g.count}</strong> <span>${g.name}</span></div><small>Депо: ${g.depots.join(', ')}</small></li>`)}</ul>
          <small class="muted">По состоянию на ${fleet.deliveries2026.asOf}.</small>
        </section>
        <section class="panel" aria-labelledby="mod-title">
          <div class="panel-head"><h2 id="mod-title">Парк в работе сейчас</h2></div>
          <p class="muted">Сейчас на линии ${count(cf.onLine, ['поезд', 'поезда', 'поездов'])}.</p>
          <ul class="series-now">${cf.series.map(s => html`<li key=${s.series}><span><strong>${s.series}</strong> <small>${s.type}, ${fmt(s.powerKw)} кВт</small></span><span class="num">${s.running} в пути</span></li>`)}</ul>
        </section>
      </aside>
    </div>
    <section class="panel" aria-labelledby="dep-title">
      <div class="panel-head"><h2 id="dep-title">Локомотивные депо</h2><small>Расположение по станциям; число локомотивов по депо в открытых источниках не публикуется.</small></div>
      <div class="table-wrap"><table class="table responsive"><thead><tr><th scope="col">Депо</th><th scope="col">Станция</th><th scope="col">Тяга</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
        <tbody>${fleet.depots.map(d => html`<tr key=${d.name}><td data-label="Депо"><strong>${d.name}</strong></td><td data-label="Станция">${d.station}</td>
          <td data-label="Тяга">${d.kinds.map(k => KIND_NAMES[k]).join(', ')}</td><td class="actions-cell"><${Button} size="sm" variant="ghost" icon="map-pin" onClick=${() => showDepot(d)}>На карте</${Button}></td></tr>`)}</tbody></table></div>
    </section>
    <section class="panel" aria-labelledby="stn-title">
      <div class="panel-head"><h2 id="stn-title">Станции Казахстана</h2><small>${fmt(net.stations.length)} станций и ${fmt(net.halts.length)} остановочных пунктов · данные OpenStreetMap (ODbL), могут быть неполными</small></div>
      <label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Найти станцию</span>
        <input type="search" placeholder="Название на русском или казахском" value=${query} onInput=${e => setQuery(e.target.value)} /></label>
      <ul class="station-list">${results.map(({ r, kind }) => html`<li key=${r[0]}><span><strong>${r[1]}</strong>${r[4] ? html` <small>${r[4]}</small>` : ''}<small>${kind === 'halt' ? 'остановочный пункт' : 'станция'} · ${r[2].toFixed(3)}, ${r[3].toFixed(3)}</small></span>
        <${Button} size="sm" variant="ghost" icon="map-pin" onClick=${() => showOnMap(r, kind)}>На карте</${Button}></li>`)}
        ${!results.length && html`<li><${Empty} icon="search" title="Ничего не найдено">Попробуйте другое название.</${Empty}></li>`}</ul>
      <p class="table-foot">${query.trim().length < 2 ? 'Показаны первые 24 станции. Введите название, чтобы найти нужную.' : `Найдено ${results.length}${results.length === 60 ? ' (показаны первые 60)' : ''}.`}</p>
    </section>
    <section class="panel" aria-labelledby="src-title"><div class="panel-head"><h2 id="src-title">Источники</h2></div>
      <ul class="sources">${fleet.sources.map(s => html`<li key=${s.url}><a href=${s.url} target="_blank" rel="noopener">${s.title}</a></li>`)}
        <li><a href=${net.source} target="_blank" rel="noopener">© участники OpenStreetMap, ODbL 1.0 — станции и остановочные пункты (снимок ${net.capturedAt})</a></li></ul></section>`;
}
