import { useMemo } from 'preact/hooks';
import { html, downloadCsv } from './lib.js';
import { Button, Kpi } from './ui.js';
import { useLiveSchedule } from './schedule-live.js';
import { operationalMetrics, fleetStandingMetrics } from './operational-metrics.js';
import { ECONOMIC_REFERENCE } from './economic-reference.js';
import { MODEL_FACTORS, DISPLAY_ONLY_FACTORS, MISSING_FACTORS, FACTOR_AUDIT_DATE, FACTOR_SOURCES } from './model-factors.js';

const fmt = n => Number(n.toFixed(1)).toLocaleString('ru-RU');
export function OperationalStatistics({ trains, events }) {
  const live = useLiveSchedule();
  const m = useMemo(() => operationalMetrics(trains, events), [trains, events]);
  const fleet = useMemo(() => live.plan ? fleetStandingMetrics(live.plan) : null, [live.plan]);
  const rates = live.rates || ECONOMIC_REFERENCE;
  const snapshot = [
    ['Поездов в движении', m.moving, ''], ['Плановых стоянок', m.plannedStops, ''], ['Вынужденных стоянок', m.forcedStops, ''],
    ['Доля стоящих поездов', m.stoppedShare, '%'], ['Тепловозов стоят', m.dieselStopped, ''], ['Электровозов стоят', m.electricStopped, ''],
    ['Вагонов стоят', m.standingWagons, ''], ['Масса стоящих поездов', m.standingTonnes, ' т'],
    ['Уже прошло в текущих стоянках', m.waitedTrainHours, ' поезд·ч'], ['Осталось текущего ожидания', m.remainingWaitHours, ' поезд·ч'],
    ['P95 оставшегося ожидания', m.p95RemainingMin, ' мин'], ['Текущая задержка на вынужденных стоянках', m.delayMin, ' мин'],
    ['Наибольшая текущая задержка', m.maxDelayMin, ' мин'], ['Гружёных грузовых составов', m.loadedFreight, ''], ['Порожних грузовых составов', m.emptyFreight, ''],
    ['Смен бригады сейчас', m.crewChanging, ''], ['Бригад сверх плановой смены', m.crewOverTarget, ''], ['Локомотивов с подошедшим ТО', m.toDue, ''],
  ];
  const history = [
    ['Уникальных рейсов в журнале', m.uniqueTrips, ''], ['Станций с операциями', m.eventStations, ''],
    ['Завершённых вынужденных стоянок', m.completedHoldCount, ''], ['Их суммарная длительность', m.completedHoldHours, ' поезд·ч'],
    ['P95 завершённых стоянок', m.p95CompletedHoldMin, ' мин'],
  ];
  const planned = fleet ? [
    ['Локомотивов в пуле', fleet.fleetCount, ''], ['Свободный резерв без назначений', fleet.unused, ''],
    ['Межрейсовое стояние всего', fleet.standingHours, ' лок·ч'], ['Занятость рейсами', fleet.occupiedHours, ' лок·ч'],
    ['Недоступность на обслуживание', fleet.serviceHours, ' лок·ч'], ['Доля занятости рейсами', fleet.utilizationPct, '%'],
    ['Среднее стояние на локомотив', fleet.averageStandingH, ' ч'], ['P95 стояния', fleet.p95StandingH, ' ч'],
    ['Стояние от 7 ч за окно', fleet.over7h, ''], ['Стояние от 12 ч за окно', fleet.over12h, ''],
    ['Дизель при горячем резерве', fleet.dieselHours * rates.dieselLitresH, ' л'],
    ['Электричество на стоянке', fleet.electricHours * rates.electricKwhH, ' кВт·ч'],
    ['Стоимость энергии стоянок', fleet.dieselHours * rates.dieselLitresH * rates.dieselPrice + fleet.electricHours * rates.electricKwhH * rates.electricPrice, ' ₸'],
  ] : [];
  const exportMetrics = () => downloadCsv('ktz-operational-metrics.csv', [['Область', 'Метрика', 'Значение', 'Единица'], ...[['Сейчас', snapshot], ['Выбранный период', history], ['Горизонт плана', planned]].flatMap(([scope, rows]) => rows.map(([name, value, unit]) => [scope, name, value, unit]))]);
  const cards = rows => html`<div class="kpis kpis-tight">${rows.map(([label, value, unit]) => html`<${Kpi} key=${label} label=${label} value=${fmt(value)} unit=${unit} />`)}</div>`;
  return html`<section class="panel"><div class="panel-head"><div><h2>Подробная эксплуатационная статистика</h2><small>Текущий срез отдельно от накопленных операций. P95: 95% значений не превышают указанный уровень.</small></div><${Button} icon="download" onClick=${exportMetrics}>Метрики · CSV</${Button}></div>
    <h3>Сеть сейчас</h3>${cards(snapshot)}<h3>Операции за выбранный период</h3>${cards(history)}
    <h3>Причины текущих стоянок</h3><ul class="plain-list">${m.reasons.map(r => html`<li key=${r.label}>${r.label}: <strong>${r.value}</strong> поездов</li>`)}</ul>
    <h3>По сериям локомотивов сейчас</h3><div class="table-wrap"><table class="table"><thead><tr><th>Серия</th><th>Всего</th><th>Движутся</th><th>Стоят</th><th>Вынужденно</th></tr></thead><tbody>${m.series.map(r => html`<tr key=${r.label}><th>${r.label}</th><td>${r.total}</td><td>${r.moving}</td><td>${r.stopped}</td><td>${r.forced}</td></tr>`)}</tbody></table></div>
  </section><section class="panel"><div class="panel-head"><div><h2>Оборот и энергия всего пула локомотивов</h2><small>Прогноз сохранённого плана, не накопленный расход за выбранный период журнала.</small></div></div>
    ${live.failed && html`<p role="status" class="bad">Связь с планом потеряна; показан последний полученный прогноз.</p>`}
    ${fleet ? html`<p class="muted">Окно: ${new Date(fleet.start).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })} — ${new Date(fleet.end).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}. ${fleet.coverage}</p>${cards(planned)}
      <p>Режим расчёта: тепловозы в доступном резерве остаются заведёнными (${rates.dieselLitresH} л/ч), электровозы потребляют ${rates.electricKwhH} кВт на собственные нужды. Расход в ремонте не включён. Ставки меняются в «Расписаниях».</p>
      <details><summary>Самые долгие межрейсовые стоянки — первые 20</summary><ul class="plain-list">${fleet.idle.slice(0, 20).map(l => html`<li key=${l.id}>${l.series} · ${l.id}: ${fmt(l.hours)} ч, назначений ${l.assignments}</li>`)}</ul></details>` : html`<p>Загрузка плана…</p>`}
  </section><section class="panel"><div class="panel-head"><div><h2>Какие факторы учитывает модель</h2><small>Проверено по коду ${FACTOR_AUDIT_DATE}: ${MODEL_FACTORS.length} групп правил и расчётов. Для каждого указана область действия: вся сеть, планировщик, экономика или детальный участок.</small></div><${Button} icon="download" onClick=${() => downloadCsv('ktz-model-factors.csv', [['Область', 'Фактор', 'Влияние'], ...MODEL_FACTORS, ...DISPLAY_ONLY_FACTORS.map(x => ['Карточки', x, 'Не самостоятельное ограничение назначения']), ...MISSING_FACTORS.map(x => ['Не реализовано полностью', x, 'Не заявляется как действующий фактор'])])}>Факторы · CSV</${Button}></div><div class="tab-panel">
    <p>Правила детального участка не применяются автоматически ко всем физическим путям Казахстана. Текущий сетевой план остаётся прогнозом: автоматическое исполнение назначений отключено до проверки обеспеченности рейсов.</p>
    <details><summary>Полный список работающих правил</summary><ol>${MODEL_FACTORS.map(([scope, name, description]) => html`<li key=${name}><strong>${scope} · ${name}.</strong> ${description}</li>`)}</ol></details>
    <details><summary>Показываются в паспорте, но не все ограничивают назначение</summary><ul>${DISPLAY_ONLY_FACTORS.map(name => html`<li>${name}</li>`)}</ul></details>
    <details><summary>Что ещё нужно связать с решениями</summary><ul>${MISSING_FACTORS.map(name => html`<li>${name}</li>`)}</ul></details>
    <details><summary>Где проверены правила</summary><ul>${FACTOR_SOURCES.map(([scope, file]) => html`<li>${scope}: <code>${file}</code></li>`)}</ul></details>
  </div></section>`;
}
