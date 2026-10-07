import { stationTraffic } from './station-metrics.js';
import { useMemo, useState } from 'preact/hooks';
import { html, Icon, count, delayText, clockAt, duration, PRIORITY, DIRECTION, downloadCsv, time, dateLong } from './lib.js';
import { app, go, href, updateUi, useLiveNow } from './store.js';
import { Button, Badge, Kpi, PageHeader, Segmented, Empty } from './ui.js';
import { Gantt } from './gantt.js';
import { TrackMap } from './trackmap.js';
import { DispatcherPanel } from './panel.js';
import { NetworkTrains, NetworkStations } from './network-lists.js';
import { IncidentPanel, Scenarios, PassengerNotices, AttentionCard, LateList } from './decisions.js';
import { DispatcherPage } from './dispatch-panel.js';

const stationName = (data, i) => data.stations[i].name;

/** Диспетчерская панель: по умолчанию вся сеть по маршрутам, детальная модель участка — по ссылке ?route=corridor. */
export function Overview({ data }) {
  const routeId = app.route.params.route;
  return routeId === 'corridor' ? html`<${CorridorOverview} data=${data} />` : html`<${DispatcherPage} data=${data} routeId=${routeId || 'AST-ALA'} />`;
}

function CorridorOverview({ data }) {
  const routeSelect = html`<div class="panel panel-head"><div><strong>Детальная модель: ${data.stations[0].name} — ${data.stations.at(-1).name}</strong><small class="muted"> · полные варианты пропуска и подъездные пути</small></div><a class="btn btn-secondary" href=${href('/overview')}><${Icon} name="chart-gantt" size=${17} />Диспетчерская панель сети</a></div>`;
  const late = data.trains.filter(t => t.delay > 0);
  const passengerLate = data.trains.filter(t => t.category === 'passenger' && t.delay > 0);
  const worst = passengerLate.reduce((m, t) => Math.max(m, t.delay), 0);
  const totalDelay = late.reduce((n, t) => n + t.delay, 0);
  const incident = data.blocked;
  const avgLoad = Math.round(data.sections.reduce((n, x) => n + x.load, 0) / data.sections.length);
  const busiest = data.sections.reduce((m, x) => (x.load > m.load ? x : m), data.sections[0]);
  const serviced = data.trains.filter(t => t.techState.status === 'на ТО').length;
  const soon = data.trains.filter(t => t.techState.status === 'скоро ТО').length;
  const broken = data.trains.filter(t => t.broken).length;
  return html`<${PageHeader} title="Оперативная обстановка"
      subtitle=${`${stationName(data, 0)} ↔ ${stationName(data, data.stations.length - 1)} · ${data.stations.length} станций · двухпутный участок с автоблокировкой`}
      actions=${html`<a class="btn btn-secondary" href=${href('/map')}><${Icon} name="map-pin" size=${17} />Карта участка</a><${Button} variant="primary" icon="construction" onClick=${() => go('/decisions')}>Ввести событие</${Button}>`} />
    ${routeSelect}<section class="panel map-panel" aria-labelledby="map-title">
      <div class="panel-head"><div><h2 id="map-title">Схема участка в реальном времени</h2>
        <small>Время идёт в реальном ходе; поезда, ТО, вагоны и происшествия создаются сами. Сверху нечётный путь (←), снизу чётный (→).</small></div></div>
      <${TrackMap} data=${data} />
    </section>
    <${DispatcherPanel} data=${data} />
    <section class="kpis" aria-label="Показатели участка">
      <${Kpi} label="Состояние участка" icon="activity" tone=${incident ? 'danger' : 'neutral'}
        value=${incident ? 'Инцидент' : data.restrictions.length ? 'Ограничения' : 'Норма'}
        note=${incident ? count(data.dispatch.closures.length, ['закрытие пути', 'закрытия пути', 'закрытий пути']) : data.restrictions.length ? count(data.restrictions.length, ['ограничение скорости', 'ограничения скорости', 'ограничений скорости']) : 'Движение по графику'} />
      <${Kpi} label="Конфликты" icon="triangle-alert" tone=${data.dispatch.conflicts.length ? 'danger' : 'neutral'}
        value=${data.dispatch.conflicts.length} note=${data.dispatch.conflicts.length ? 'встречных поездов на одном пути' : 'встречных поездов нет'} />
      <${Kpi} label="Загрузка участка" icon="gauge" tone=${avgLoad >= 70 ? 'danger' : 'neutral'} value=${avgLoad} unit="%"
        note=${`самый загруженный перегон ${data.stations[busiest.segment].id}–${data.stations[busiest.segment + 1].id}: ${busiest.load}%`} />
      <${Kpi} label="Опоздание пассажирских" icon="train-front" tone=${worst ? 'danger' : 'neutral'}
        value=${worst ? `+${worst}` : '0'} unit="мин"
        note=${passengerLate.length ? `${count(passengerLate.length, ['поезд задерживается', 'поезда задерживаются', 'поездов задерживается'])} из ${data.trains.filter(t => t.category === 'passenger').length}` : 'все пассажирские по графику'} />
      <${Kpi} label="Задержано поездов" icon="hourglass" value=${late.length} unit=${`из ${data.trains.length}`}
        note=${late.length ? `суммарно ${duration(totalDelay)}` : 'задержек нет'} />
      <${Kpi} label="ТО и поломки" icon="wrench" tone=${broken ? 'danger' : 'neutral'} value=${serviced} unit="на ТО"
        note=${`${soon} скоро ТО · ${broken ? `${broken} с поломкой` : 'поломок нет'}`} />
    </section>
    <div class="grid-main">
      <section class="panel gid-panel" aria-labelledby="gid-title">
        <div class="panel-head"><div><h2 id="gid-title">График движения <span class="gid-tag">ГИД</span></h2>
          <small>План и прогноз движения по участку</small></div></div>
        <${Gantt} data=${data} />
      </section>
      <aside class="aside" aria-label="Что требует внимания">
        <${AttentionCard} data=${data} />
        <${LateList} data=${data} />
      </aside>
    </div>`;
}

export function DecisionsPage({ data }) {
  const incident = data.blocked;
  const first = data.dispatch.conflicts.length ? Math.min(...data.dispatch.conflicts.map(c => Math.min(c.a.enter, c.b.enter))) : null;
  const start = first === null ? 0 : Math.max(0, Math.floor((first - 30) / 30) * 30);
  return html`<${PageHeader} title="Решения диспетчера"
      subtitle="Введите событие, сравните варианты пропуска и подтвердите лучший. Решение остаётся за диспетчером." />
    <div class="grid-main">
      <div class="stack">
        ${incident ? html`<${IncidentPanel} data=${data} />` : html`<section class="panel"><${Empty} icon="circle-check" title="Конфликтов нет">Движение идёт по графику. Введите событие справа, и система рассчитает варианты пропуска.</${Empty}></section>`}
        <section class="panel" aria-labelledby="prev-title">
          <div class="panel-head"><div><h2 id="prev-title">Прогноз для выбранного варианта</h2><small>Окно 4 часа вокруг закрытого перегона. Красный отрезок — ожидание на станции.</small></div><a href=${href('/overview?route=corridor')}>Открыть полный ГИД</a></div>
          <${Gantt} data=${data} zoom=${4} start=${start} compact />
        </section>
      </div>
      <aside class="aside" aria-label="События и уведомления">
        <${Scenarios} data=${data} />
        <${PassengerNotices} data=${data} />
      </aside>
    </div>`;
}

export function Trains() {
  return html`<${PageHeader} title="Поезда" subtitle="Все поезда КТЖ на линии прямо сейчас: поиск по городу, станции и участку, фильтры по типу, состоянию и тяге" />
    <${NetworkTrains} />`;
}

export function Stations() {
  return html`<${PageHeader} title="Станции" subtitle="Все станции и остановочные пункты Казахстана с привязкой к участкам и ближайшими поездами" />
    <${NetworkStations} />`;
}
