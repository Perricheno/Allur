import { useMemo } from 'preact/hooks';
import { html, time, dateShort } from './lib.js';
import { Button, Badge } from './ui.js';
import { TrainSpecs } from './train-specs.js';
import { networkEvents, networkItinerary } from './network-sim.js';
import { stationBoard, sameStation, stopExplanation } from './network-detail-data.js';

const stamp = n => n == null ? 'Не назначено' : `${dateShort(n)} ${time(n)}`;
const minutes = ms => `${Math.max(0, Math.ceil(ms / 60000))} мин`;
const source = 'Оперативный паспорт · состояние и прогноз обновляются по времени модели.';

export function TrainDetails({ sim, t, now, onMap }) {
  const stops = useMemo(() => networkItinerary(sim, t), [sim, t.uid, t.departedMs, t.arrivesMs, t.waitingDeparture]);
  const events = networkEvents(sim, now, 1440).filter(e => e.uid === t.uid).slice(0, 12);
  return html`<div class="network-details">
    <p class="detail-source">${source}</p>
    <div class=${`detail-state ${t.stopped && !t.planned ? 'attention' : ''}`}>
      <${Badge} tone=${t.stopped && !t.planned ? 'danger' : 'accent'}>${t.stopped ? t.planned ? 'Плановая стоянка' : 'Вынужденная стоянка' : 'В движении'}</${Badge}>
      <h3>${t.stopped ? `${t.station}: ${t.reason}` : `${t.from} → ${t.to}`}</h3>
      <p>${stopExplanation(t)}</p>
      ${t.stopped && html`<p>${t.departedMs === null ? 'Время отправления пока не определено.' : `Продолжение движения через ≈ ${t.restMin} мин.`} ${t.delayMin ? `Вынужденное ожидание уже ${t.delayMin} мин.` : ''}</p>`}
      <${Button} size="sm" icon="map-pin" onClick=${onMap}>Показать на карте</${Button}>
    </div>
    <div class="journey-progress"><span>Пройдено ${Math.round(t.progress * 100)}% · осталось ${Math.max(0, Math.round(t.totalKm - t.km))} км</span><progress max="1" value=${t.progress} aria-label="Пройденная часть маршрута" /></div>
    <dl class="detail-grid">
      <div><dt>Отправление</dt><dd>${stamp(t.departedMs)}</dd></div><div><dt>Прогноз прибытия</dt><dd>${stamp(t.arrivesMs)}</dd></div>
      <div><dt>До конечной</dt><dd>${t.arrivesMs === null ? 'Ожидает назначения' : minutes(t.arrivesMs - now)}</dd></div><div><dt>Доп. ожидание в профиле рейса</dt><dd>${Math.round(t.extraMin)} мин (не текущее опоздание)</dd></div>
      <div><dt>Расчётные координаты</dt><dd>${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}</dd></div><div><dt>Направление</dt><dd>${t.dir === 'fwd' ? 'Прямое' : 'Обратное'} · курс ${Math.round(t.heading)}°</dd></div>
    </dl>
    <${TrainSpecs} t=${t} />
    <section><h3>Прогноз остановок и операций</h3><p class="muted">Только остановки данного рейса, а не все станции вдоль пути. Номера путей условные.</p>
      <ol class="operation-list">${stops.map((s, i) => html`<li key=${i} class=${now >= s.arrival && s.departure !== null && now <= s.departure ? 'current' : ''}>
        <strong>${s.name}${s.track ? ` · путь ${s.track}` : ''}</strong>
        <span>${stamp(s.arrival)}${s.departure && s.departure !== s.arrival ? ` → ${time(s.departure)}` : ''}</span>
        <small>${s.reason}${s.crew ? ' · смена бригады' : ''} · ${now < s.arrival ? 'впереди' : s.departure !== null && now <= s.departure ? 'сейчас' : 'пройдено'}</small>
      </li>`)}</ol>
    </section>
    <section><h3>Последние события рейса</h3>${events.length ? html`<ol class="operation-list">${events.map(e => html`<li key=${e.id}><span>${stamp(e.at)}</span><p>${e.text}</p></li>`)}</ol>` : html`<p class="muted">За сутки записей нет.</p>`}</section>
    <p class="muted">Идентификатор рейса: ${t.uid}. По окончании рейс исчезает из активного списка; история остаётся в журнале за выбранный период.</p>
  </div>`;
}

export function StationDetails({ sim, station: r, trains, now, onMap, onTrain }) {
  const board = stationBoard(sim, r, trains, now);
  const route = sim.byId.get(r.routeId);
  const events = networkEvents(sim, now, 360).filter(e => (e.routeId === r.routeId || r.routeIds?.includes(e.routeId)) && sameStation(e.station, r.name)).slice(0, 15);
  return html`<div class="network-details">
    <p class="detail-source">${source}</p>
    <div class="detail-state"><h3>${r.route}</h3><p>Ближайшая линия: ${r.km} км от её начала; расстояние до линии ≈ ${r.offKm} км.</p><p>Маршруты с этой станцией в графике: ${r.routeIds?.length ? r.routeIds.map(id => sim.byId.get(id).name).join('; ') : 'не заданы'}.</p><${Button} size="sm" icon="map-pin" onClick=${onMap}>Показать станцию на карте</${Button}></div>
    <dl class="detail-grid"><div><dt>Тип объекта</dt><dd>${r.kind === 'station' ? 'Станция' : 'Остановочный пункт'}</dd></div>
      <div><dt>Координаты OSM</dt><dd>${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}</dd></div><div><dt>Длина ближайшего маршрута</dt><dd>${Math.round(route.km)} км</dd></div>
      <div><dt>Доля электрификации маршрута</dt><dd>≈ ${Math.round(route.electrified * 100)}%</dd></div>
      <div><dt>Стоят по расписанию модели</dt><dd>${board.present.length}</dd></div><div><dt>Ожидаются из активных рейсов</dt><dd>${board.arrivals.length}</dd></div>
    </dl>
    <section><h3>На станции сейчас</h3><p class="muted">Совпадение станции остановки в расписании. Поезда просто поблизости сюда не включены.</p>
      ${board.present.length ? board.present.map(({ t, stop }) => html`<article class="station-operation" key=${t.uid}><h4>№${t.number} · ${t.label} · путь ${stop.track || 'не задан'}</h4><p>${t.reason}${stop.crew ? ' · смена бригады' : ''}</p><p>${stopExplanation(t)}</p><p>Прибыл ${stamp(stop.arrival)} · отправление ${stamp(stop.departure)} · осталось ${minutes(stop.departure - now)}</p><${Button} size="sm" onClick=${() => onTrain(t)}>Полный паспорт поезда</${Button}></article>`) : html`<p>Стоянок активных рейсов на этой станции модель сейчас не показывает.</p>`}
    </section>
    <section><h3>Ожидаемые прибытия</h3><p class="muted">Прогноз активных рейсов с остановкой здесь, не полный суточный график и не очередь приёма вагонов.</p>
      ${board.arrivals.length ? html`<ol class="operation-list">${board.arrivals.slice(0, 20).map(({ t, stop }) => html`<li key=${t.uid}><strong>№${t.number} · ${t.from} → ${t.to}</strong><span>${stamp(stop.arrival)} · через ${minutes(stop.arrival - now)}</span><small>${stop.reason}${stop.track ? ` · путь ${stop.track}` : ''}</small><${Button} size="sm" variant="ghost" onClick=${() => onTrain(t)}>Паспорт и маршрут</${Button}></li>`)}</ol>` : html`<p>В активных рейсах нет запланированных прибытий с совпадающим названием станции.</p>`}
    </section>
    <section><h3>Рядом на маршруте · до 60 км</h3><p class="muted">Близость по километражу не означает, что поезд прибудет на станцию или займёт её путь.</p>
      <ol class="operation-list">${board.nearby.slice(0, 10).map(({ t, distance }) => html`<li key=${t.uid}><strong>№${t.number} · ${distance.toFixed(1)} км</strong><span>${t.stopped ? `${t.station}: ${t.reason}` : `${t.speedKmh} км/ч · в сторону ${t.to}`}</span><${Button} size="sm" variant="ghost" onClick=${() => onTrain(t)}>Подробнее</${Button}></li>`)}</ol>${!board.nearby.length && html`<p>Поездов поблизости нет.</p>`}
    </section>
    <section><h3>Операции за 6 часов</h3>${events.length ? html`<ol class="operation-list">${events.map(e => html`<li key=${e.id}><span>${stamp(e.at)}</span><p>${e.text}</p></li>`)}</ol>` : html`<p>Нет событий с совпадающим названием на этом маршруте.</p>`}</section>
    <p class="detail-source">Вместимость путей, резервы и загрузка фронтов для этой станции не заданы. Детальная грузовая работа доступна отдельно в диспетчерской панели участка.</p>
  </div>`;
}
