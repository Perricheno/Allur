// Диспетчерская панель сети: выбор маршрута, схема, ГИД, события, станционный пост, журнал.
import { useMemo, useState } from 'preact/hooks';
import { html, Icon, time, dateLong, count } from './lib.js';
import { app, go, href, updateUi, useLiveNow } from './store.js';
import { Badge, Button, Dialog, Empty, Kpi, PageHeader, Segmented } from './ui.js';
import { useNetworkTrains } from './network-data.js';
import { useIncidents } from './network-incidents.js';
import { networkEvents, networkItinerary } from './network-sim.js';
import { stationBoard } from './network-detail-data.js';
import { TrainDetails } from './network-details.js';
import { routeStations, routeSegments, routeCharacter } from './route-profile.js';
import { TrackMap } from './trackmap.js';
import { networkTrackData } from './network-track-data.js';
import { RouteGid } from './route-gid.js';
import { IncidentPanel } from './dispatch-incidents.js';
import { DECISION } from './log.js';

const hash = str => { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const stamp = ms => `${time(ms)}`;

function RouteRail({ sim, trains, incidents, now, routeId }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const stat = useMemo(() => {
    const m = new Map(sim.routes.map(r => [r.id, { n: 0, forced: 0, inc: 0 }]));
    for (const t of trains) { const e = m.get(t.routeId); if (e) { e.n++; if (t.stopped && !t.planned) e.forced++; } }
    for (const i of incidents) { const e = m.get(i.routeId); if (e && (i.until ?? Infinity) > now) e.inc++; }
    return m;
  }, [sim, trains, incidents, Math.floor(now / 5000)]);
  const rows = sim.routes.filter(r => (!query || r.name.toLowerCase().includes(query.toLowerCase())) && (filter === 'all' || (filter === 'problems' ? stat.get(r.id).forced + stat.get(r.id).inc > 0 : stat.get(r.id).inc > 0)))
    .sort((a, b) => { const sa = stat.get(a.id), sb = stat.get(b.id); return (sb.inc - sa.inc) || (sb.forced - sa.forced) || (b.weight - a.weight) || a.name.localeCompare(b.name, 'ru'); });
  return html`<aside class="dp-rail" aria-label="Маршруты сети">
    <label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Найти маршрут</span><input type="search" placeholder="Маршрут или город" value=${query} onInput=${e => setQuery(e.target.value)} /></label>
    <${Segmented} label="Фильтр маршрутов" value=${filter} onChange=${setFilter} options=${[{ value: 'all', label: 'Все' }, { value: 'problems', label: 'Есть проблемы' }, { value: 'inc', label: 'События' }]} />
    <div class="dp-routes">
      ${rows.map(r => { const s = stat.get(r.id); return html`<a key=${r.id} href=${href(`/overview?route=${r.id}`)} class=${`dp-route ${r.id === routeId ? 'on' : ''}`} aria-current=${r.id === routeId ? 'true' : undefined}>
        <strong>${r.name}</strong><span class="tags">${s.inc > 0 && html`<${Badge} tone="danger" icon="siren">${s.inc}</${Badge}>`}${s.forced > 0 && html`<${Badge} tone="muted" title="Вынужденных стоянок">${s.forced}</${Badge}>`}</span>
        <small>${Math.round(r.km)} км · ${s.n} поездов${r.electrified > 0.5 ? ' · ⚡' : ''}</small></a>`; })}
      ${!rows.length && html`<${Empty} icon="search" title="Маршрутов нет">Измените поиск или фильтр.</${Empty}>`}
      <a class="dp-route corridor" href=${href('/overview?route=corridor')}><strong>Детальная модель участка</strong><small>Караганда — Мойынты · подъездные пути</small></a>
    </div>
  </aside>`;
}

function StationPost({ sim, route, trains, now, onTrain }) {
  const stations = useMemo(() => routeStations(route).filter(s => !s.minor), [route.id]);
  const [name, setName] = useState('');
  const st = stations.find(s => s.name === name) || stations[0];
  const board = useMemo(() => stationBoard(sim, { name: st.name, routeId: route.id, routeIds: [route.id], km: st.km }, trains, now), [sim, st, route.id, trains, Math.floor(now / 5000)]);
  const n = 4 + hash(`${route.id}:${st.name}`) % 6;
  const byTrack = new Map();
  for (const { t, stop } of board.present) byTrack.set(((stop.track || 1) - 1) % n, t);
  return html`<section class="panel" aria-labelledby="sp-h"><div class="panel-head"><div><h2 id="sp-h">Станционный пост</h2><small>Что делается на станции прямо сейчас и кто подходит</small></div></div>
    <label class="schedule-field"><span>Станция</span><select value=${st.name} onChange=${e => setName(e.target.value)} aria-label="Станция маршрута">${stations.map(s => html`<option key=${s.i} value=${s.name}>${s.name} · ${Math.round(s.km)} км</option>`)}</select></label>
    <div class="sp-tracks" role="img" aria-label=${`Пути станции: занято ${byTrack.size} из ${n}`}>${Array.from({ length: n }, (_, k) => { const t = byTrack.get(k); return html`<div key=${k} class=${`sp-track ${t ? 'busy' : ''} ${t && !t.planned ? 'bad' : ''}`}><span>путь ${k + 1}</span>${t ? html`<button type="button" onClick=${() => onTrain(t.uid)}>№${t.number}</button>` : html`<small>свободен</small>`}</div>`; })}</div>
    <p class="muted">Число путей — ориентировочное (данных о путевом развитии станции нет). Занятость берётся из реальных остановок поездов.</p>
    <h3>На станции · ${board.present.length}</h3>
    ${board.present.length ? board.present.map(({ t, stop }) => html`<button type="button" class="dispatch-task" key=${t.uid} onClick=${() => onTrain(t.uid)}><strong>№${t.number} · ${t.label} · путь ${stop.track || '—'}</strong><span>${t.reason}</span><small>Отправление через ${t.restMin} мин${t.crew?.changing ? ' · идёт смена бригады' : ''}</small></button>`) : html`<p class="muted">Остановившихся поездов нет.</p>`}
    <h3>На подходе</h3>
    ${board.arrivals.length ? html`<ol class="operation-list">${board.arrivals.slice(0, 6).map(({ t, stop }) => html`<li key=${t.uid}><button type="button" class="link" onClick=${() => onTrain(t.uid)}><strong>${stamp(stop.arrival)} · №${t.number}</strong></button><span>${t.from} → ${t.to}${stop.track ? ` · путь ${stop.track}` : ''}</span><small>${stop.reason}${stop.crew ? ' · смена бригады' : ''}</small></li>`)}</ol>` : html`<p class="muted">Ближайших прибытий нет.</p>`}
  </section>`;
}

function RouteJournal({ sim, route, now }) {
  const events = useMemo(() => networkEvents(sim, now, 180).filter(e => e.routeId === route.id).slice(0, 16), [sim, route.id, Math.floor(now / 5000)]);
  return html`<section class="panel" aria-labelledby="rj-h"><div class="panel-head"><h2 id="rj-h">Журнал маршрута</h2><a href=${href('/log')}>Весь журнал</a></div>
    ${events.length ? html`<ol class="timeline">${events.map(e => html`<li key=${e.id}><time>${time(e.at)}</time><p><${Badge} tone=${DECISION[e.kind].tone} icon=${DECISION[e.kind].icon}>${DECISION[e.kind].label}</${Badge}> ${e.text}</p></li>`)}</ol>` : html`<${Empty} icon="list-checks" title="Событий пока нет">За последние 3 часа на маршруте ничего не произошло.</${Empty}>`}</section>`;
}

export function DispatcherPage({ data, routeId }) {
  const { sim, trains, now, loading, failed } = useNetworkTrains(1);
  const { list: incidents } = useIncidents();
  const clock = useLiveNow(1);
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const route = sim?.byId?.get(routeId);
  const mine = useMemo(() => trains.filter(t => t.routeId === routeId), [trains, routeId]);
  if (failed) return html`<${PageHeader} title="Диспетчерская панель" /><${Empty} icon="circle-alert" title="Не удалось загрузить маршруты">Обновите страницу.</${Empty}>`;
  if (loading) return html`<${PageHeader} title="Диспетчерская панель" subtitle="Загрузка сети…" />`;
  if (!route) return html`<${PageHeader} title="Диспетчерская панель" /><${Empty} icon="search" title="Такого маршрута нет">Выберите маршрут из списка.</${Empty}>${html`<a class="btn btn-primary" href=${href('/overview')}>К панели</a>`}`;
  const ch = routeCharacter(route);
  const forced = mine.filter(t => t.stopped && !t.planned), moving = mine.filter(t => !t.stopped);
  const avg = moving.length ? Math.round(moving.reduce((n, t) => n + t.speedKmh, 0) / moving.length) : 0;
  const incHere = incidents.filter(i => i.routeId === route.id && (i.until ?? Infinity) > now);
  const delaySum = mine.reduce((n, t) => n + (t.stopped && !t.planned ? Math.round(t.waitedMin + t.restMin) : 0), 0);
  const picked = mine.find(t => t.uid === selected);
  const trackData = useMemo(() => networkTrackData(data, route, mine, now, incidents), [data.baseTime, route.id, mine, incidents, Math.floor(now / 1000)]);
  const pick = uid => setSelected(uid);
  return html`<${PageHeader} title="Диспетчерская панель" subtitle="Вся сеть КТЖ по маршрутам: схема, график движения, события и решения модели" />
    <div class="dp-picker panel"><label class="schedule-field"><span>Маршрут</span><select value=${route.id} onChange=${e => go(`/overview?route=${e.target.value}`)} aria-label="Маршрут диспетчера">${sim.routes.map(r => html`<option key=${r.id} value=${r.id}>${r.name}</option>`)}</select></label></div>
    <div class="dp">
      <${RouteRail} sim=${sim} trains=${trains} incidents=${incidents} now=${now} routeId=${route.id} />
      <div class="dp-main">
        <section class="dp-hero" aria-label=${`Маршрут ${route.name}`}><div><span class="dp-eyebrow">${ch.cls}</span><h2>${route.name}</h2><p>${Math.round(route.km)} км · ${ch.tracks} · ${ch.traction}</p></div>
          <div class="dp-clock num">${time(clock)}<small>${dateLong(clock)} · в реальном времени</small></div></section>
        <section class="kpis" aria-label="Маршрут в цифрах">
          <${Kpi} label="Поездов на маршруте" icon="train-front" value=${mine.length} note=${`${mine.filter(t => t.category === 'passenger').length} пасс. · ${mine.filter(t => t.category !== 'passenger').length} груз.`} />
          <${Kpi} label="В пути" icon="gauge" value=${moving.length} note=${avg ? `средняя скорость ${avg} км/ч` : 'никто не движется'} />
          <${Kpi} label="Вынужденные стоянки" icon="octagon-alert" tone=${forced.length ? 'danger' : 'neutral'} value=${forced.length} note=${forced.length ? `простой в сумме ${delaySum} мин` : 'простоев нет'} />
          <${Kpi} label="События диспетчера" icon="siren" tone=${incHere.length ? 'danger' : 'neutral'} value=${incHere.length} note=${incHere.length ? 'закрытия, ограничения, поломки' : 'движение по графику'} />
        </section>
        <section class="panel" aria-labelledby="sch-h"><div class="panel-head"><div><h2 id="sch-h">Схема маршрута</h2><small>Поезда движутся в реальном времени: пути, станции, закрытия и ограничения на линии</small></div></div>
          <${TrackMap} key=${route.id} data=${trackData} selectedTrain=${picked ? String(picked.number) : null} onTrain=${number => setSelected(number ? mine.find(t => String(t.number) === number)?.uid || null : null)} onStation=${() => {}} />
          ${picked ? html`<div class="rs-picked"><div><strong>№${picked.number} · ${picked.label}</strong><span>${picked.from} → ${picked.to} · ${picked.loco.series} · ${picked.wagons} ваг. · ${picked.stopped ? `стоит: ${picked.station || 'на перегоне'} (${picked.reason})` : `${picked.speedKmh} км/ч, пройдено ${Math.round(picked.progress * 100)}%`}</span></div>
            <div class="btn-row"><${Button} size="sm" variant="primary" icon="file-text" onClick=${() => setDialog(picked.uid)}>Паспорт поезда</${Button}><${Button} size="sm" variant="ghost" icon="x" onClick=${() => setSelected(null)}>Снять</${Button}></div></div>`
            : ''}
        </section>
        <section class="panel" aria-labelledby="gid-h"><div class="panel-head"><div><h2 id="gid-h">График движения (ГИД)</h2><small>Исполненное и прогнозное движение маршрута, стоянки и зоны событий</small></div></div>
          <${RouteGid} sim=${sim} route=${route} incidents=${incHere} now=${now} selected=${selected} onSelect=${pick} /></section>
        <div class="dp-two">
          <${IncidentPanel} sim=${sim} route=${route} trains=${mine} incidents=${incidents} now=${now} />
          <div class="dp-col"><${StationPost} sim=${sim} route=${route} trains=${mine} now=${now} onTrain=${pick} /><${RouteJournal} sim=${sim} route=${route} now=${now} /></div>
        </div>
      </div>
    </div>
    <${Dialog} id="dispatch-network-train" open=${Boolean(dialog && picked)} onClose=${() => setDialog(null)} title=${picked ? `Поезд №${picked.number}` : 'Поезд'}>${picked && html`<${TrainDetails} sim=${sim} t=${picked} now=${now} onMap=${() => { updateUi({ selectedNetTrain: picked.uid }); go('/'); }} />`}</${Dialog}>`;
}
