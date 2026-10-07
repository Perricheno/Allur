// Решения модели: что она выбирает, по какому правилу и почему это выгоднее. По сети и по детальному участку.
import { useMemo, useState } from 'preact/hooks';
import { html, Icon, count, clockAt } from './lib.js';
import { app, go, updateUi } from './store.js';
import { Badge, Button, Empty, Kpi, PageHeader, Segmented, Tabs } from './ui.js';
import { useNetworkTrains } from './network-data.js';
import { networkDecisions } from './network-sim.js';
import { RouteSelect } from './network-lists.js';
import { EventFeed } from './log.js';
import { ExportButton } from './network-export.js';
import { useNetworkArchive } from './network-archive.js';
import { useLiveSchedule } from './schedule-live.js';
import { ScheduleChanges } from './schedule-visual.js';

const VERDICT = {
  justified: { label: 'Задержка оправдана', tone: 'accent', icon: 'circle-check' },
  shorten: { label: 'Можно сократить стоянку', tone: 'danger', icon: 'timer-reset' },
  technical: { label: 'Техническая причина', tone: 'neutral', icon: 'wrench' },
};
const fmt = n => n.toLocaleString('ru-RU');

function Options({ options, chosen }) {
  const max = Math.max(...options.map(o => o.cost), 1);
  return html`<table class="opt-table"><thead><tr><th scope="col">Вариант</th><th scope="col">Расчёт</th><th scope="col" class="num">Потеря</th><th scope="col"><span class="sr-only">Шкала</span></th></tr></thead>
    <tbody>${options.map(o => html`<tr key=${o.id} class=${o.id === chosen ? 'pick' : ''}><td>${o.id === chosen && html`<${Icon} name="check" size=${14} class="inline" />`} ${o.name}</td><td>${o.detail}</td>
      <td class="num"><strong>${o.cost}</strong></td><td style="width:90px"><i class="cost-bar" style=${`width:${Math.max(4, o.cost / max * 100)}%`}></i></td></tr>`)}</tbody></table>`;
}

function NetworkDecisions() {
  const { sim, trains, loading } = useNetworkTrains(0.5);
  const [route, setRoute] = useState('all');
  const [verdict, setVerdict] = useState('all');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const all = useMemo(() => networkDecisions(trains), [trains]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(d => (route === 'all' || d.train.routeId === route) && (verdict === 'all' || d.verdict === verdict) && (category === 'all' || d.train.category === category)
      && (!q || `${d.train.number} ${d.station} ${d.train.route} ${d.train.reason} ${d.who?.number || ''}`.toLowerCase().includes(q)));
  }, [all, route, verdict, category, query]);
  const reset = fn => v => { fn(v); setLimit(20); };
  const count_ = v => all.filter(d => d.verdict === v).length;
  const saved = all.filter(d => d.verdict === 'shorten').reduce((n, d) => n + (d.ownCost - d.options[1].cost), 0);
  const show = d => { updateUi({ selectedNetTrain: d.train.uid }); go('/'); };
  return html`
    <section class="kpis" aria-label="Решения модели по сети">
      <${Kpi} label="Вынужденных стоянок сейчас" icon="octagon-alert" value=${fmt(all.length)} note="каждую разбирает модель" />
      <${Kpi} label="Задержка оправдана" icon="circle-check" value=${count_('justified')} note="приоритетный поезд не теряет ход" />
      <${Kpi} label="Можно сократить" icon="timer-reset" tone=${count_('shorten') ? 'danger' : 'neutral'} value=${count_('shorten')} note=${saved ? `экономия ${saved} ед. взвешенной задержки` : 'потерь сверх необходимого нет'} />
      <${Kpi} label="Технические причины" icon="wrench" value=${count_('technical')} note="смена бригады, неисправность и т. п." />
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Что решила модель и почему</h2><small>Для каждой вынужденной стоянки модель ищет поезд, ради которого она могла возникнуть, и сравнивает потери: держать этот поезд или отправить его и задержать приоритетный. Вес потери: пассажирский ×10, контейнерный ×2, грузовой ×1 (как в модели участка).</small></div></div>
      <div class="toolbar"><label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Поиск по решениям</span>
        <input type="search" placeholder="Город, станция, номер поезда, причина" value=${query} onInput=${e => reset(setQuery)(e.target.value)} /></label></div>
      <div class="filter-row">
        <${Segmented} label="Вывод модели" value=${verdict} onChange=${reset(setVerdict)} options=${[{ value: 'all', label: 'Все' }, { value: 'justified', label: 'Оправдано' }, { value: 'shorten', label: 'Сократить' }, { value: 'technical', label: 'Техническая' }]} />
        <${Segmented} label="Тип задержанного поезда" value=${category} onChange=${reset(setCategory)} options=${[{ value: 'all', label: 'Любой' }, { value: 'passenger', label: 'Пассажирский' }, { value: 'container', label: 'Контейнерный' }, { value: 'freight', label: 'Грузовой' }]} />
        <${RouteSelect} sim=${sim} value=${route} onChange=${reset(setRoute)} />
      </div>
      ${loading ? html`<p class="muted pad">Расчёт решений…</p>` : rows.length ? html`<div class="model-list">${rows.slice(0, limit).map(d => {
        const v = VERDICT[d.verdict];
        return html`<article class="model-card" key=${d.id}>
          <header><strong>№${d.train.number}</strong><${Badge} tone="muted">${d.train.label}</${Badge}><span>${d.station} · ${d.train.route}</span>
            <${Badge} tone=${v.tone} icon=${v.icon}>${v.label}</${Badge}><${Button} size="sm" variant="ghost" icon="map-pin" onClick=${() => show(d)}>На карте</${Button}></header>
          <p class="muted">Причина стоянки: ${d.train.reason}. ${d.who ? `Рядом приоритетный поезд №${d.who.number} (${d.who.label.toLowerCase()}), до него ${d.gap} км.` : ''}</p>
          <${Options} options=${d.options} chosen=${d.chosen} />
          <p class="model-why"><${Icon} name="lightbulb" size=${16} /><span><strong>Почему так:</strong> ${d.why}</span></p>
        </article>`; })}</div>
        <div class="table-foot">Показано ${Math.min(limit, rows.length)} из ${rows.length}
          ${rows.length > limit && html`<${Button} size="sm" onClick=${() => setLimit(limit + 20)}>Показать ещё</${Button}>`}</div>`
        : html`<${Empty} icon="circle-check" title="Решений по этим фильтрам нет">Сейчас нет вынужденных стоянок, подходящих под выбор.</${Empty}>`}
    </section>`;
}

export function ModelPage() {
  const [scope, setScope] = useState('network');
  const archive = useNetworkArchive();
  const schedule = useLiveSchedule();
  return html`<${PageHeader} title="Решения модели" subtitle="Что модель выбирает, по каким правилам и почему это выгоднее: по всей сети КТЖ"
      actions=${html`<${ExportButton} section="decisions" /><${ExportButton} section="model" /><${Button} icon="book-open" onClick=${() => go('/how')}>Как это работает</${Button}>`} />
    <section class="panel"><div class="tab-panel"><h2>Что означают счётчики</h2><p>10–15 технических причин — это число текущих вынужденных стоянок, а не история работы системы. Плановые стоянки, все отправления и приёмы доступны в журнале.</p><p>В архиве: ${archive.events.length.toLocaleString('ru-RU')} операций. Пересчётов расписания: ${schedule.plan?.changes?.length || 0}. Каждое изменение можно раскрыть до поезда, времени и замены тяги.</p></div></section>
    <${Tabs} label="Охват решений" value=${scope} idPrefix="md" onChange=${setScope}
      tabs=${[{ value: 'network', label: 'Сейчас · вся сеть' }, { value: 'schedule', label: 'Изменения расписания' }, { value: 'journal', label: 'Журнал решений' }]} />
    <div id="md-panel" role="tabpanel" aria-labelledby=${`md-${scope}`} class="tab-panel">
      ${scope === 'network' ? html`<${NetworkDecisions} />` : scope === 'schedule' ? html`<${ScheduleChanges} plan=${schedule.plan} />`
        : html`<section class="panel"><div class="panel-head"><div><h2>Журнал принятых решений</h2><small>Что модель решила прямо сейчас и недавно: принять, отправить, пропустить приоритетный поезд, сменить бригаду, задержать, устранить неисправность. Лента идёт в реальном времени.</small></div></div><${EventFeed} /></section>`}
      <p class="note"><${Icon} name="info" size=${15} /> Приоритеты: пассажирский ×10, контейнерный ×2, грузовой ×1. История операций и расчёт эффекта доступны во вкладке «Журнал решений» и в полном экспорте. </p>
    </div>`;
}
