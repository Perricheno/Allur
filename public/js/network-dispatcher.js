import { useMemo, useState } from 'preact/hooks';
import { html, time } from './lib.js';
import { Button, Dialog, Kpi, Segmented } from './ui.js';
import { useNetworkTrains } from './network-data.js';
import { useLiveSchedule } from './schedule-live.js';
import { useNetworkArchive } from './network-archive.js';
import { networkItinerary } from './network-sim.js';
import { TrainDetails } from './network-details.js';
import { go, updateUi } from './store.js';
import { TrackMap } from './trackmap.js';
import { networkTrackData } from './network-track-data.js';


export function NetworkDispatcher({ data, routeId }) {
  const { sim, trains, now, loading } = useNetworkTrains(.5), live = useLiveSchedule(), archive = useNetworkArchive();
  const [direction, setDirection] = useState('all'), [selected, setSelected] = useState(null), [station, setStation] = useState(''), [minutes, setMinutes] = useState(60), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const route = sim?.routes?.find(r => r.id === routeId) || sim?.routes?.[0];
  const rows = useMemo(() => trains.filter(t => t.routeId === route?.id && (direction === 'all' || t.dir === direction)), [trains, route, direction]);
  const picked = rows.find(t => t.uid === selected);
  const planRows = live.plan?.optimized.rows.filter(r => r.routeId === route?.id && (direction === 'all' || r.dir === direction)) || [];
  const conflicts = planRows.filter(r => r.status !== 'assigned');
  const events = archive.events.filter(e => e.routeId === route?.id && e.at <= now).slice(-10).reverse();
  const stationName = station || route?.from;
  const present = rows.filter(t => t.stopped && t.station === stationName);
  const arrivals = rows.flatMap(t => networkItinerary(sim, t).filter(s => s.name === stationName && s.arrival > now).map(s => ({ t, s }))).sort((a, b) => a.s.arrival - b.s.arrival).slice(0, 8);
  const restrict = async () => {
    setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/schedule-route-incident', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routeId: route.id, dir: direction, minutes }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error);
      setMessage(`План пересчитан: ${body.plan.changes.at(-1).changes.length} изменённых назначений. Поезда в движении не остановлены этой командой.`);
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  if (loading || !route) return html`<section class="panel pad">Загрузка диспетчерской сети…</section>`;
  return html`<section class="network-dispatcher" aria-label="Диспетчерская всей сети">
    <section class="panel map-panel" aria-labelledby="map-title"><div class="panel-head"><div><h2 id="map-title">Схема участка в реальном времени</h2><small>${route.name} · ${Math.round(route.km)} км</small></div><${Segmented} label="Направление диспетчера" value=${direction} onChange=${setDirection} options=${[{ value: 'all', label: 'Оба направления' }, { value: 'fwd', label: 'Прямое →' }, { value: 'rev', label: '← Обратное' }]} /></div>
      <${TrackMap} key=${route.id} data=${networkTrackData(data, route, rows, now)} selectedTrain=${picked ? String(picked.number) : null} onTrain=${number => setSelected(rows.find(t => String(t.number) === number)?.uid || null)} onStation=${setStation} />
      <div class="kpis kpis-tight"><${Kpi} label="Поездов на маршруте" value=${rows.length} /><${Kpi} label="Ожидают на станциях" value=${rows.filter(t => t.stopped).length} /><${Kpi} label="Слотов без тяги в плане" value=${conflicts.length} tone=${conflicts.length ? 'danger' : 'neutral'} /><${Kpi} label="Станций вдоль маршрута" value=${route.stops.length} /></div>
      <p class="muted pad">Две линии показывают направления. Пути станций изображены условно; показания светофоров и вместимость подъездных путей для этого маршрута не заданы. Нажмите поезд для полного паспорта, станцию — для её операций ниже.</p>
    </section>
    <div class="dispatch-workspace"><section class="panel"><div class="panel-head"><div><h3>Станционный пост</h3><small>Фактические остановки профиля и ближайшие прибытия</small></div></div><div class="tab-panel"><label class="schedule-field"><span>Станция маршрута</span><select value=${stationName} onChange=${e => setStation(e.target.value)}>${route.stops.map(([name, km]) => html`<option value=${name}>${name} · ${km} км</option>`)}</select></label>
      <h4>На станции · ${present.length}</h4>${present.length ? present.map(t => html`<button class="dispatch-task" key=${t.uid} onClick=${() => setSelected(t.uid)}><strong>№${t.number} · ${t.loco.series}</strong><span>${t.reason}</span><small>Стоит ${Math.round(t.waitedMin || 0)} мин · осталось ${t.restMin} мин</small></button>`) : html`<p class="muted">Остановившихся поездов нет. Поезда поблизости не считаются принятыми на станцию.</p>`}
      <h4>На подходе</h4>${arrivals.length ? arrivals.map(({ t, s }) => html`<button class="dispatch-task" key=${t.uid} onClick=${() => setSelected(t.uid)}><strong>${time(s.arrival)} · №${t.number}</strong><span>${t.from} → ${t.to}</span><small>${s.reason}</small></button>`) : html`<p class="muted">В активных рейсах ближайших прибытий нет.</p>`}
    </div></section>
    <section class="panel"><div class="panel-head"><div><h3>Очередь диспетчерских задач</h3><small>Не скрываем рейсы, которым не удалось подобрать тягу</small></div></div><div class="tab-panel">
      ${conflicts.length ? conflicts.slice(0, 10).map(r => html`<details class="dispatch-task" key=${r.uid}><summary>№${r.number} · ${time(r.departedMs)} · ${r.from}</summary><p>${r.reason}</p><p>${r.wagons} вагонов · ${r.consist.grossT} т</p><a href="#/schedules">Открыть варианты в расписании</a></details>`) : html`<p>Все слоты выбранного направления обеспечены в текущем плане.</p>`}
      ${conflicts.length > 10 && html`<p>Ещё ${conflicts.length - 10} — в полном расписании.</p>`}
      <h4>Ограничение отправлений в плане</h4><p class="muted">Для выбранного маршрута и направления. Пересчитывает будущие назначения; это не команда светофорам и не остановка уже идущих поездов.</p>
      <div class="filter-row"><label class="schedule-field"><span>Продолжительность, мин</span><select value=${minutes} onChange=${e => setMinutes(Number(e.target.value))}>${[15, 30, 60, 120, 240, 720].map(n => html`<option value=${n}>${n}</option>`)}</select></label><${Button} icon="construction" pending=${busy} onClick=${restrict}>Ввести ограничение плана</${Button}></div><p role="status">${message}</p>
    </div></section></div>
    <section class="panel"><div class="panel-head"><h3>Последние операции этого маршрута</h3><a href="#/log">Весь журнал</a></div><ol class="dispatch-events">${events.map(e => html`<li key=${e.id}><time>${time(e.at)}</time><p>${e.text}</p></li>`)}</ol></section>
    <${Dialog} id="dispatch-network-train" open=${Boolean(picked)} onClose=${() => setSelected(null)} title=${picked ? `Поезд №${picked.number}` : 'Поезд'}>${picked && html`<${TrainDetails} sim=${sim} t=${picked} now=${now} onMap=${() => { updateUi({ selectedNetTrain: picked.uid }); go('/'); }} />`}</${Dialog}>
  </section>`;
}
