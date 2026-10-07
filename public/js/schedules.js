import { useEffect, useState } from 'preact/hooks';
import { html, time, dateShort, downloadCsv } from './lib.js';
import { PageHeader, Button, Badge, Kpi, Segmented } from './ui.js';
import { useNetworkTrains } from './network-data.js';
import { RouteSelect } from './network-lists.js';
import { SCHEDULE_DEFAULTS, ENERGY_DEFAULTS, buildSchedule, scheduleEconomics } from './schedule-engine.js';
import { useLiveSchedule } from './schedule-live.js';
import { ScheduleChanges, ScheduleVisual, MaintenanceControls } from './schedule-visual.js';
import { ECONOMIC_REFERENCE, ECONOMIC_SOURCES } from './economic-reference.js';
import { ScheduleExplanation } from './schedule-explanation.js';

const fmt = n => Math.round(n).toLocaleString('ru-RU');
const stamp = n => `${dateShort(n)} ${time(n)}`;
const numberFields = [
  ['reserve', 'Резерв на станцию / вид тяги', 0, 10], ['turnaroundMin', 'Оборот после рейса, мин', 0, 240],
  ['couplingMin', 'Прицепка и подготовка, мин', 1, 120], ['headwayMin', 'Интервал отправлений, мин', 1, 60],
  ['maxFreightT', 'Предел массы грузового, т', 100, 20000], ['maxPassengerT', 'Предел массы пассажирского, т', 100, 5000],
  ['maxShiftMin', 'Максимальный автосдвиг грузового, мин', 0, 120],
];
const rateFields = [
  ['dieselLitresH', 'Дизель на стоянке, л/ч'], ['electricKwhH', 'Электроэнергия на стоянке, кВт·ч/ч'],
  ['dieselPrice', 'Дизель, ₸/л'], ['electricPrice', 'Электроэнергия, ₸/кВт·ч'],
  ['locoHour', 'Локомотиво-час без энергии, ₸/ч'], ['wagonHour', 'Вагоно-час без энергии, ₸/ч'],
];
function AssignmentReason({ row, baseline, plan }) {
  const [open, setOpen] = useState(false);
  return html`<details onToggle=${e => setOpen(e.currentTarget.open)}><summary>Почему это назначение</summary>${open && html`<${ScheduleExplanation} row=${row} baseline=${baseline} plan=${plan} />`}</details>`;
}

export function SchedulesPage() {
  const { sim, now, failed } = useNetworkTrains(1);
  const live = useLiveSchedule();
  const [config, setConfig] = useState({ ...SCHEDULE_DEFAULTS });
  const [rates, setRates] = useState({ ...ECONOMIC_REFERENCE });
  const [route, setRoute] = useState('all'), [plan, setPlan] = useState(null);
  const [query, setQuery] = useState(''), [view, setView] = useState('optimized'), [limit, setLimit] = useState(60);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (live.plan) { setPlan(live.plan); setMessage(`Автоматический план · ревизия ${live.plan.revision || 0}`); } }, [live.plan]);
  useEffect(() => {
    if (!sim || sim.error) return;
    let active = true;
    fetch('/api/schedule').then(r => { if (!r.ok) throw new Error('Не удалось получить сохранённый план'); return r.json(); }).then(saved => {
      if (!active) return;
      if (saved.plan) { setPlan(saved.plan); setConfig(saved.plan.config); setRoute(saved.plan.routeId); setRates(saved.rates?.dieselPrice ? saved.rates : ECONOMIC_REFERENCE); setMessage(`Общий план от ${stamp(saved.plan.createdAt)}`); }
      else setPlan(buildSchedule(sim, now));
    }).catch(e => { if (active) { setPlan(buildSchedule(sim, now)); setError(e.message); } });
    return () => { active = false; };
  }, [sim]);
  const calculate = () => {
    try { setPlan(buildSchedule(sim, now, config, route)); setLimit(60); setMessage('Новый план рассчитан. Проверьте назначения и ограничения перед сохранением.'); setError(''); }
    catch (e) { setError(e.message); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: plan.config, routeId: plan.routeId, rates, createdAt: plan.createdAt }) });
      const result = await res.json(); if (!res.ok) throw new Error(result.error);
      setPlan(result.plan); setMessage('План сохранён на сервере и доступен всем диспетчерам.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  let economics = null;
  try { if (plan) economics = scheduleEconomics(plan, rates); } catch { /* Invalid input is explained below. */ }
  const rows = (plan?.[view]?.rows || []).filter(r => !query || `${r.number} ${r.from} ${r.to} ${r.assignedSeries || ''} ${r.locoId || ''}`.toLowerCase().includes(query.toLowerCase()));
  const dirty = plan && (JSON.stringify(config) !== JSON.stringify(plan.config) || route !== plan.routeId);
  const csv = () => downloadCsv('ktz-schedule.csv', [['Рейс', 'Номер', 'Маршрут', 'Откуда', 'Куда', 'Вагонов', 'Масса, т', 'По графику', 'Отправление плана', 'Прибытие плана', 'Локомотив', 'Серия', 'Ожидание, мин', 'Причина'],
    ...(plan?.[view]?.rows || []).map(r => [r.uid, r.number, r.route, r.from, r.to, r.wagons, r.consist.grossT, new Date(r.departedMs).toISOString(), r.departure ? new Date(r.departure).toISOString() : '', r.arrival ? new Date(r.arrival).toISOString() : '', r.locoId, r.assignedSeries, r.waitMin, r.reason])]);
  return html`<${PageHeader} title="Расписания" subtitle="Автосоставление плана рейсов, назначение тяги составам и расчёт оборота локомотивов"
    actions=${html`<${Button} icon="download" disabled=${!plan} onClick=${csv}>Расписание · CSV</${Button}><a class="btn btn-secondary" href="/api/schedule?download=1" download="ktz-schedule.json">Сохранённый план · JSON</a>`} />
    <p class="feed-status"><span class="feed-dot live"></span>План проверяется автоматически. Фиксированные слоты сохраняются; неисполнимые назначения требуют решения.${live.failed ? ' Связь с планировщиком восстанавливается…' : ''}</p>
    ${plan?.optimized.unassigned > 0 && html`<p class="bad" role="status">План не готов к исполнению: ${plan.optimized.unassigned} рейсов не обеспечены тягой в допустимое время. Они не отменены и не перенесены автоматически на много часов. На графике показаны исходные слоты; отклонённые варианты доступны в разборе. Общая экономия такого плана не подтверждается.</p>`}
    ${plan && html`<${ScheduleVisual} plan=${plan} now=${now} /><${ScheduleChanges} plan=${plan} /><${MaintenanceControls} plan=${plan} />`}
    <section class="panel"><div class="panel-head"><div><h2>Параметры планирования</h2><small>Составы берутся из расписания сети. Локомотив появляется в следующем пункте только после прибытия и оборота.</small></div></div>
      <div class="tab-panel"><div class="filter-row"><${RouteSelect} sim=${sim} value=${route} onChange=${setRoute} /><${Segmented} label="Горизонт расписания" value=${config.horizonH} onChange=${horizonH => setConfig({ ...config, horizonH })} options=${[6, 12, 24].map(value => ({ value, label: `${value} часов` }))} /></div>
      <div class="detail-grid">${numberFields.map(([key, label, min, max]) => html`<label class="schedule-field" key=${key}><span>${label}</span><input type="number" min=${min} max=${max} value=${config[key]} onInput=${e => setConfig({ ...config, [key]: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>`)}</div>
      <p class="muted">Пределы массы, резерв и времена операций — параметры этого плана. Уточняются по профилю маршрута и нормативам. Частично электрифицированный маршрут планируется с тепловозом без смены тяги.</p>
      <div class="toolbar"><${Button} icon="rotate-ccw" variant="primary" disabled=${!sim || sim.error} onClick=${calculate}>Автосоставить и назначить тягу</${Button}><${Button} icon="check" disabled=${!plan || dirty || !economics} reason=${dirty ? 'Сначала пересчитайте изменённые параметры' : 'Дождитесь расчёта и проверьте тарифы'} pending=${busy} onClick=${save}>Сохранить общий план</${Button}></div>
      ${dirty && html`<p role="status">Параметры изменены — нажмите «Автосоставить» для нового расчёта.</p>`}
      ${message && html`<p role="status">${message}</p>`}${(error || failed) && html`<p class="bad" role="alert">${error || 'Маршруты не загрузились'}</p>`}
      </div></section>
    ${plan && html`<section class="kpis"><${Kpi} label="Заявок на рейсы" value=${plan.optimized.rows.length} note=${`${plan.config.horizonH} ч с ${stamp(plan.createdAt)}; отправление может сдвинуться за горизонт`} />
      <${Kpi} label="Тяга назначена" value=${plan.optimized.assigned} note=${`${plan.optimized.locosUsed} локомотивов в обороте`} />
      <${Kpi} label="Не обеспечены тягой" value=${plan.optimized.unassigned} tone=${plan.optimized.unassigned ? 'danger' : 'neutral'} note="Нужен резерв или пересмотр ограничений" />
      <${Kpi} label="Изменение ожидания" value=${fmt(plan.baseline.waitMin - plan.optimized.waitMin)} unit=" мин" note=${`База ${fmt(plan.baseline.waitMin)} → план ${fmt(plan.optimized.waitMin)}`} /></section>
      <section class="panel"><div class="panel-head"><div><h2>Экономика плана</h2><small>Сравнение одного набора рейсов и одного парка. Это прогноз эффекта плана, не накопленная экономия исполненных операций.</small></div></div>
        <div class="tab-panel"><label class="schedule-field"><span>Вид дизельного топлива</span><select value=${rates.dieselGrade} onChange=${e => setRates({ ...rates, dieselGrade: e.target.value })}><option value="summer">Летнее</option><option value="winter">Зимнее</option><option value="arctic">Арктическое</option></select></label>
        <div class="detail-grid">${rateFields.map(([key, label]) => html`<label class="schedule-field" key=${key}><span>${label}</span><input type="number" min="0" max="10000000" step="any" value=${rates[key]} onInput=${e => setRates({ ...rates, [key]: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>`)}</div>
        <p class="muted">Начальный расчёт заполнен по открытым ориентирам и явно указанным допущениям. Это сценарная оценка, не закупочные тарифы КТЖ. Для зимнего и арктического дизеля нужна цена соответствующей поставки. Нулевые статьи не оценены.</p>
        <details><summary>Источники цен и норм · проверено 03.10.2026</summary>${ECONOMIC_SOURCES.map(s => html`<p><strong>${s.label}.</strong> ${s.note} ${s.url && html`<a href=${s.url} target="_blank" rel="noopener">Источник</a>`}</p>`)}</details>
        ${economics ? html`<div class="kpis kpis-tight"><${Kpi} label="Денежный эффект" value=${economics.ready ? fmt(economics.totalKzt) : economics.completeComparison ? 'Нужны нормы' : 'Неполный план'} unit=${economics.ready ? ' ₸' : ''} note=${economics.completeComparison ? `По заполненным статьям: ${fmt(economics.totalKzt)} ₸` : 'Сначала обеспечить все рейсы; исключение рейсов не считается экономией'} />
          <${Kpi} label="Дизтопливо на стоянках" value=${rates.dieselLitresH ? fmt(economics.dieselLitres) : 'Нужна норма'} unit=${rates.dieselLitresH ? ' л' : ''} note=${`Изменение стоянки тяги ${fmt(economics.dieselHours)} ч`} />
          <${Kpi} label="Электроэнергия на стоянках" value=${rates.electricKwhH ? fmt(economics.electricKwh) : 'Нужна норма'} unit=${rates.electricKwhH ? ' кВт·ч' : ''} note=${`Изменение стоянки тяги ${fmt(economics.electricHours)} ч`} />
          <${Kpi} label="Сокращение ожидания вагонов" value=${fmt(economics.wagonHours)} unit=" ваг·ч" note=${`${economics.comparable} сопоставимых рейсов`} /></div>` : html`<p class="bad" role="alert">Проверьте нормы: требуются неотрицательные числа.</p>`}
        <details><summary>Как считаются деньги и топливо</summary><p>Сравнивается весь доступный пул на одинаковом интервале, включая неназначенный резерв. Тепловозы на межрейсовой стоянке считаются заведёнными; электровозы питают собственные нужды. Перенос простоя между двумя локомотивами не создаёт экономии. Отрицательное значение — дополнительные расходы. При необеспеченных рейсах общий эффект не подтверждается. Расход в движении и ремонте отдельно не оценён.</p></details>
        </div></section>
      <section class="panel"><div class="panel-head"><div><h2>Рейсы и назначения</h2><small>${plan.note}</small></div></div><div class="toolbar"><${Segmented} label="Вариант расписания" value=${view} onChange=${setView} options=${[{ value: 'optimized', label: 'Подобранная тяга' }, { value: 'baseline', label: 'Базовая очередь' }]} /><input type="search" aria-label="Поиск в расписании" placeholder="Поезд, станция, локомотив" value=${query} onInput=${e => { setQuery(e.target.value); setLimit(60); }} /></div>
      <div class="table-wrap"><table class="table responsive"><thead><tr><th>Поезд / состав</th><th>Маршрут</th><th>График → план</th><th>Локомотив</th><th>Ожидание</th><th>Обоснование</th></tr></thead><tbody>${rows.slice(0, limit).map(r => html`<tr key=${r.uid}>
        <td data-label="Поезд"><strong>№${r.number}</strong><div>${r.wagons} ваг. · ${r.consist.grossT} т</div><small>${r.label}${r.cargo ? ` · ${r.cargo}` : ''}</small></td>
        <td data-label="Маршрут">${r.from} → ${r.to}<small class="muted"> · ${r.route}</small></td>
        <td data-label="Время">${stamp(r.departedMs)} → ${r.departure ? stamp(r.departure) : 'не назначено'}${r.arrival && html`<div>Прибытие ${stamp(r.arrival)}</div>`}</td>
        <td data-label="Тяга">${r.assignedSeries || 'Нет подходящей'}${r.locoId && html`<details><summary>Оборот локомотива</summary><small>${r.locoId}</small><p>Готов ${stamp(r.locoReady)} · прицепка ${stamp(r.couplingAt)} · освобождение ${stamp(r.arrival + plan.config.turnaroundMin * 60000)}</p></details>`}</td>
        <td data-label="Ожидание"><${Badge} tone=${r.status === 'unassigned' ? 'danger' : r.waitMin > 0 ? 'neutral' : 'accent'}>${r.status === 'unassigned' ? 'Не обеспечен' : `${fmt(r.waitMin)} мин`}</${Badge}></td>
        <td data-label="Почему"><${AssignmentReason} row=${r} baseline=${plan.baseline.rows.find(b => b.uid === r.uid)} plan=${plan} /></td>
      </tr>`)}</tbody></table></div><div class="table-foot">${Math.min(limit, rows.length)} из ${rows.length}${rows.length > limit && html`<${Button} onClick=${() => setLimit(limit + 60)}>Показать ещё</${Button}>`}</div></section>
      <p class="note">Автоматическое исполнение нового плана не включено: сначала должны быть обеспечены все рейсы и проверены ограничения. Исходное расписание сети продолжает действовать. Пути, СЦБ, профиль тяги и допуски бригад требуют дополнительной проверки.</p>`}
  `;
}
