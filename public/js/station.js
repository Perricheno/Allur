import { stationTraffic } from './station-metrics.js';
import { useState } from 'preact/hooks';
import { html, Icon, duration, time, dateShort, clockAt, downloadCsv, delayText, count } from './lib.js';
import { app, act, go, href, useLiveNow } from './store.js';
import { Button, Badge, Kpi, PageHeader, Tabs, Segmented, Empty } from './ui.js';

function Occupancy({ t }) {
  const w = v => `${(v / t.capacity) * 100}%`;
  return html`<div class="occ">
    <div class="occ-label"><strong>${t.occupied}</strong><span> / ${t.capacity} ваг.</span></div>
    <div class="occ-bar" role="img" aria-label=${`В работе ${t.processing}, обработано ${t.done}, ждут фронта ${t.waiting}, резерв ${t.reserved}`}>
      <i class="seg processing" style=${`width:${w(t.processing)}`}></i><i class="seg done" style=${`width:${w(t.done)}`}></i>
      <i class="seg waiting" style=${`width:${w(t.waiting)}`}></i><i class="seg reserved" style=${`width:${w(t.reserved)}`}></i>
    </div>
  </div>`;
}

function Tracks({ station, data }) {
  return html`<div class="table-wrap"><table class="table responsive">
    <thead><tr><th scope="col">Путь</th><th scope="col">Загрузка</th><th scope="col">Состояние</th><th scope="col">Доступно для подачи</th><th scope="col">Оценка освобождения</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
    <tbody>${station.tracks.map(t => html`<tr key=${t.id}>
      <td data-label="Путь"><div class="two"><strong>${t.number}. ${t.name}</strong><small>${data.cargoNames[t.cargo]} · ${t.productivity} ваг./ч · фронт ${t.front}</small></div></td>
      <td data-label="Загрузка"><${Occupancy} t=${t} /></td>
      <td data-label="Состояние"><div class="two">
        <span>${t.processing ? `Идёт обработка: ${t.processing} ваг.` : 'Обработки нет'}</span>
        <small>${t.done ? `${t.done} ваг. обработано, ждут уборки` : ''}${t.waiting ? ` ${t.waiting} ждут фронта` : ''}${!t.done && !t.waiting ? 'ожидающих нет' : ''}</small></div></td>
      <td data-label="Доступно" class="num"><strong>${t.available}</strong> ваг.${t.reserved ? html`<small> · резерв ${t.reserved}</small>` : ''}</td>
      <td data-label="Оценка освобождения" class="num">${t.releaseAt ? time(t.releaseAt) : html`<span class="muted">Свободен</span>`}</td>
      <td class="actions-cell"><div class="btn-row">
        <${Button} size="sm" icon="check" onClick=${() => act({ type: 'complete', trackId: t.id })} disabled=${!t.processing} pending=${app.busy}
          reason="Нет вагонов под грузовыми операциями" title="Завершить обработку вагонов на этом пути">Завершить</${Button}>
        <${Button} size="sm" variant="secondary" icon="package" onClick=${() => act({ type: 'clear', trackId: t.id })} disabled=${!t.done} pending=${app.busy}
          reason="Нет обработанных вагонов для уборки">Убрать${t.done ? ` ${t.done}` : ''}</${Button}></div></td>
    </tr>`)}</tbody></table></div>
    <div class="legend inline" aria-label="Обозначения загрузки">
      <span><i class="sw processing"></i>В работе</span><span><i class="sw done"></i>Обработано</span><span><i class="sw waiting"></i>Ждут фронта</span><span><i class="sw reserved"></i>Резерв</span></div>
    <p class="note"><${Icon} name="info" size=${15} /> Порядок работы: принять группу → обработать → убрать вагоны. Путь освобождается только после уборки. Время освобождения — оценка при уборке каждой партии за 30 минут; сама уборка выполняется по команде.</p>`;
}

const STATUS = { reserved: ['accent', 'Резерв'], arrived: ['neutral', 'Принята'], ready: ['accent', 'Есть ёмкость'], none: ['danger', 'Нет ёмкости'] };

function Arrivals({ station, data }) {
  const [filter, setFilter] = useState('all');
  const groups = data.groups.filter(g => g.stationId === station.id && (filter === 'all' ? g.status !== 'arrived' : filter === 'ready' ? g.eligible : g.status === 'reserved'));
  return html`<div class="toolbar"><${Segmented} label="Фильтр групп" value=${filter} onChange=${setFilter}
      options=${[{ value: 'all', label: 'Все' }, { value: 'ready', label: 'Есть ёмкость' }, { value: 'reserved', label: 'В резерве' }]} /></div>
    <div class="table-wrap"><table class="table responsive">
      <thead><tr><th scope="col">Группа</th><th scope="col">Откуда</th><th scope="col">Прибытие</th><th scope="col">До срока доставки</th><th scope="col">Запас после обработки</th><th scope="col">Решение</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
      <tbody>${groups.map(g => {
        const st = STATUS[g.status === 'reserved' ? 'reserved' : g.eligible ? 'ready' : 'none'];
        const waitEta = g.etaAt > data.now;
        return html`<tr key=${g.id}>
          <td data-label="Группа"><div class="two"><strong>№${g.train}</strong><small>${data.cargoNames[g.cargo]} · ${g.count} ваг.</small></div></td>
          <td data-label="Откуда"><div class="two"><span>${g.origin}</span><small>${g.km} км</small></div></td>
          <td data-label="Прибытие" class="num"><div class="two"><span>${time(g.etaAt)}</span><small class=${g.delayMinutes > 0 ? 'bad' : ''}>${dateShort(g.etaAt)}${g.delayMinutes > 0 ? ` · +${g.delayMinutes} мин` : ''}</small></div></td>
          <td data-label="До срока" class="num">${duration((g.deadlineAt - data.now) / 60000)}</td>
          <td data-label="Запас" class=${`num ${g.slackMinutes < 0 ? 'bad' : ''}`}><div class="two"><span>${duration(g.slackMinutes)}</span><small>${g.slackMinutes < 0 ? 'риск просрочки' : Number.isFinite(g.slackMinutes) ? 'прогноз' : 'нет фронта'}</small></div></td>
          <td data-label="Решение"><div class="two"><${Badge} tone=${st[0]}>${st[1]}</${Badge}><small>${g.reason}</small></div></td>
          <td class="actions-cell"><div class="btn-row">${g.status === 'reserved' ? html`
            <${Button} size="sm" variant="primary" icon="check" onClick=${() => act({ type: 'arrive', groupId: g.id })} disabled=${waitEta} pending=${app.busy}
              reason=${`Группа ещё в пути: прибытие в ${time(g.etaAt)}. Продвиньте время.`}>Принять</${Button}>
            <${Button} size="sm" variant="ghost" onClick=${() => act({ type: 'cancel', groupId: g.id })}>Отменить</${Button}>`
          : html`<${Button} size="sm" icon="arrow-right" iconRight=${undefined} onClick=${() => act({ type: 'reserve', groupId: g.id })} disabled=${!g.eligible} pending=${app.busy}
              reason=${g.reason}>Зарезервировать</${Button}>`}</div></td></tr>`;
      })}
      ${!groups.length && html`<tr><td colspan="7"><${Empty} title="Групп нет">По выбранному условию групп вагонов нет.</${Empty}></td></tr>`}</tbody></table></div>
    <p class="note"><${Icon} name="info" size=${15} /> Очередь — по запасу срока после прибытия и обработки. Резерв учитывает специализацию пути и всю группу вагонов; группа не делится между путями.</p>`;
}

function Recommendation({ station, data }) {
  const groups = data.groups.filter(g => g.stationId === station.id && g.status === 'approaching');
  const candidate = groups.find(g => g.eligible);
  const blocked = groups.find(g => !g.eligible);
  return html`<section class="panel reco" aria-labelledby="reco-title">
    <div class="panel-head"><h2 id="reco-title">Рекомендация по приёму</h2><${Icon} name="zap" size=${18} /></div>
    ${candidate ? html`<div class="reco-body">
      <div><h3>Продвинуть группу №${candidate.train}</h3>
        <p>${candidate.origin} → ${station.name} · ${candidate.count} ваг. · ${data.cargoNames[candidate.cargo]}. Группа помещается на подходящий путь.</p>
        <dl class="inline-dl"><div><dt>До срока доставки</dt><dd>${duration((candidate.deadlineAt - data.now) / 60000)}</dd></div>
        <div><dt>Запас после обработки</dt><dd class=${candidate.slackMinutes < 0 ? 'bad' : ''}>${duration(candidate.slackMinutes)}</dd></div></dl></div>
      <${Button} variant="primary" icon="check" pending=${app.busy} onClick=${() => act({ type: 'reserve', groupId: candidate.id })}>Зарезервировать приём</${Button}></div>`
      : html`<p class="muted">Подходящей ёмкости сейчас нет или все группы уже запланированы. Освободите пути (завершите обработку и уберите вагоны).</p>`}
    ${blocked && html`<p class="note"><${Icon} name="info" size=${15} /> №${blocked.train}: до срока ${duration((blocked.deadlineAt - data.now) / 60000)}, но группа не помещается на подходящий путь.</p>`}
  </section>`;
}

export function StationPage({ data, params }) {
  const now = useLiveNow(4);
  const station = data.stations.find(s => s.id === params.id);
  if (!station) return html`<${PageHeader} title="Станция не найдена" crumbs=${[{ label: 'Станции', href: href('/stations') }, { label: params.id || '—' }]} />
    <${Empty} icon="search" title="Такой станции нет"><a href=${href('/stations')}>Вернуться к списку станций</a></${Empty}>`;
  const tab = params.tab === 'arrivals' ? 'arrivals' : 'tracks';
  const arrivals = data.groups.filter(g => g.stationId === station.id && g.status !== 'arrived').length;
  const traffic = stationTraffic(data, station.id, now);
  const load = Math.round(station.occupied / station.capacity * 100);
  const exportCsv = () => downloadCsv(`station-${station.id}.csv`, [
    ['Автодиспетчер — отчёт по станции', station.name, time(data.now)],
    ['Путь', 'Специализация', 'Вместимость', 'Фронт', 'В работе', 'Обработано', 'Ждут фронта', 'Резерв', 'Доступно'],
    ...station.tracks.map(t => [t.number, data.cargoNames[t.cargo], t.capacity, t.front, t.processing, t.done, t.waiting, t.reserved, t.available]),
    [], ['Группа', 'Откуда', 'Груз', 'Вагонов', 'ETA', 'Срок доставки', 'Запас, мин', 'Статус', 'Путь'],
    ...data.groups.filter(g => g.stationId === station.id).map(g => [g.train, g.origin, data.cargoNames[g.cargo], g.count, new Date(g.etaAt).toISOString(), new Date(g.deadlineAt).toISOString(), g.slackMinutes ?? '', g.status, g.trackId || '']),
  ]);
  return html`<${PageHeader} title=${`Станция ${station.name}`} subtitle=${`${station.type} · ${station.km} км от начала участка`}
      crumbs=${[{ label: 'Станции', href: href('/stations') }, { label: station.name }]}
      actions=${html`<${Button} icon="download" onClick=${exportCsv}>Выгрузить CSV</${Button}>`} />
    <section class="kpis" aria-label="Показатели станции">
      <${Kpi} label="Подъездные пути" icon="route" value=${station.tracks.length} note=${`вместимость ${station.capacity} ваг.`} />
      <${Kpi} label="Вагонов на путях" icon="package" value=${station.occupied} note=${`занятость ${load}%`} />
      <${Kpi} label="Доступно для подачи" icon="circle-check" value=${station.available} unit="ваг." note="за вычетом резерва" />
      <${Kpi} label="В резерве" icon="hourglass" value=${station.reserved} unit="ваг." note=${`Ждут приёма: ${traffic.waiting} гр. · в пути: ${traffic.enRoute} гр.`} />
    </section>
    <${Recommendation} station=${station} data=${data} />
    <section class="panel">
      <${Tabs} label="Данные станции" value=${tab} idPrefix="st" onChange=${v => go(`/station/${station.id}/${v}`)}
        tabs=${[{ value: 'tracks', label: 'Подъездные пути', count: station.tracks.length }, { value: 'arrivals', label: 'Подход вагонов', count: arrivals }]} />
      <div id="st-panel" role="tabpanel" aria-labelledby=${`st-${tab}`} class="tab-panel">
        ${tab === 'tracks' ? html`<${Tracks} station=${station} data=${data} />` : html`<${Arrivals} station=${station} data=${data} />`}
      </div>
    </section>`;
}
