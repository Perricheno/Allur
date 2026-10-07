// Страница «Модель»: конвейер расчёта, что приходит и что получается, лента событий, метрики и характеристики.
import { useMemo, useState } from 'preact/hooks';
import { html, time } from './lib.js';
import { Badge, Empty, Kpi, PageHeader } from './ui.js';
import { useSim } from './network-data.js';
import { useNetwork } from './geo-network.js';
import { DECISION } from './log.js';
import { MODEL_FACTORS, FACTOR_AUDIT_DATE } from './model-factors.js';
import { STAGES, METRIC_CARDS } from './engine-graph.js';
import { useEngine, HISTORY, CYCLES_PER_SECOND, percentile } from './engine-metrics.js';
import { FlowGraph } from './engine-flow.js';
import { StageCard } from './engine-stages.js';
import { FormulaBook } from './formula-view.js';
import { EventTape } from './engine-tape.js';
import { MetricCard, Bars, Heatmap, Characteristics, Sparkline, fmt } from './engine-widgets.js';

const KINDS = ['send', 'accept', 'crew', 'yield', 'hold', 'repair', 'resolved'];
const Panel = ({ id, title, hint, actions, children, class: cls = '' }) => html`<section class=${`panel ${cls}`} aria-labelledby=${id}>
  <div class="panel-head"><div><h2 id=${id}>${title}</h2>${hint && html`<small>${hint}</small>`}</div>${actions}</div>${children}</section>`;

export function EnginePage() {
  const sim = useSim();
  const net = useNetwork();
  const { sample, samples, lines, counters, startedAt } = useEngine(sim);
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState(null);
  const window = Math.round(Math.min(HISTORY, samples.length) / CYCLES_PER_SECOND);
  const stats = useMemo(() => {
    const ms = samples.map(s => s.ms);
    return { p50: percentile(ms, 0.5), p95: percentile(ms, 0.95), max: ms.length ? Math.max(...ms) : 0 };
  }, [samples]);
  if (!sim) return html`<${PageHeader} title="Модель" subtitle="Загрузка маршрутов…" />`;
  if (sim.error) return html`<${PageHeader} title="Модель" /><${Empty} icon="circle-alert" title="Не удалось загрузить маршруты">Обновите страницу.</${Empty}>`;
  if (!sample) return html`<${PageHeader} title="Модель" subtitle="Первый цикл расчёта…" />`;
  const ctx = { dailyTrips: sim.services.reduce((n, s) => n + s.n, 0), clock: time(sample.now) };
  const series = key => samples.map(s => s[key]);
  const node = STAGES.flatMap(st => st.rows).find(r => r.id === selected);
  const throughput = sample.ms > 0 ? Math.round(sample.trains / (sample.ms / 1000)) : 0;
  const problem = (sample.byKind.hold || 0) + (sample.byKind.repair || 0) + (sample.byKind.yield || 0);
  const kindRows = KINDS.map(k => ({ label: DECISION[k].label, value: sample.byKind[k] || 0, tone: ['hold', 'repair'].includes(k) ? 'danger' : '' }));
  return html`<${PageHeader} title="Модель" subtitle="Что модель получает, что считает и что выдаёт — прямо сейчас, полная формула и все переменные. Расчёт идёт непрерывно, 4 цикла в секунду"
      actions=${html`<${Badge} tone="accent" icon="radio">цикл ${fmt(counters.cycles)} · ${time(sample.now)}</${Badge}>`} />
    <section class="kpis" aria-label="Работа модели">
      <${Kpi} label="Цикл расчёта" icon="cpu" value=${sample.ms.toFixed(1)} unit=" мс" note=${`p95 ${stats.p95.toFixed(1)} мс · максимум ${stats.max.toFixed(1)} мс`} />
      <${Kpi} label="Производительность" icon="activity" value=${fmt(throughput)} unit=" поездов/с" note=${`${fmt(sample.trains)} поездов за цикл`} />
      <${Kpi} label="Решений за час" icon="list-checks" value=${fmt(sample.eventsHour)} note=${`с задержками и неисправностями: ${problem}`} />
      <${Kpi} label="Подсказок диспетчеру" icon="lightbulb" value=${sample.recommendations} note=${`оправдано ${sample.justified}, можно сократить ${sample.shorten}`} />
      <${Kpi} label="События на линии" icon="siren" tone=${sample.incidents ? 'danger' : 'neutral'} value=${sample.incidents} note=${sample.incidents ? `вариантов пропуска: ${sample.variantsCount}` : 'движение по графику'} />
      <${Kpi} label="Изменений на входе" icon="radio" value=${fmt(counters.inputs)} note="за сеанс: новые рейсы, остановки, бригады, события" />
    </section>
    <${Panel} id="pl-h" title="Поток данных модели" hint="Слева данные на входе, справа результат. Точки бегут по связям, узлы вспыхивают, когда значение меняется. Нажмите на узел: подсветятся его связи и откроется формула." class="engine-block">
      <${FlowGraph} sample=${sample} ctx=${ctx} selected=${selected} onSelect=${setSelected} cycle=${counters.cycles} />
      ${node ? html`<div class="flow-detail"><div><strong>${node.label}</strong><p>${node.hint}</p><code>${node.formula}</code></div>
        <div class="flow-spark"><b class="num">${node.numeric === false ? ctx.clock : `${fmt(node.value(sample, ctx))} ${node.unit}`}</b><${Sparkline} values=${samples.map(x => node.value(x, ctx)).filter(x => typeof x === 'number')} width=${220} height=${40} label=${`Динамика: ${node.label}`} /><small>последние ${window} с</small></div></div>`
        : html`<p class="muted flow-hint">Выберите узел, чтобы увидеть, что он считает и по какой формуле.</p>`}
    </${Panel}>
    <div class="engine-grid">
      <div class="stage-grid">${STAGES.map((st, i) => html`<${StageCard} key=${st.id} stage=${st} index=${i} sample=${sample} ctx=${ctx} samples=${samples} openId=${open} onToggle=${setOpen} />`)}</div>
      <aside class="engine-side"><${Panel} id="tp-h" title="События модели" hint="Что получает, что считает и какие решения принимает" class="tape-panel">
        <${EventTape} lines=${lines} />
      </${Panel}></aside>
    </div>
    <${Panel} id="mt-h" title="Метрики в реальном времени" hint=${`Последние ${window} секунд, 4 измерения в секунду`}>
      <div class="metric-grid">${METRIC_CARDS.map(c => html`<${MetricCard} key=${c.key} label=${c.label} unit=${c.unit} value=${c.digits ? sample[c.key].toFixed(c.digits) : fmt(sample[c.key])} values=${series(c.key)}
        extra=${c.key === 'ms' ? `p50 ${stats.p50.toFixed(1)} · p95 ${stats.p95.toFixed(1)} мс` : null} />`)}</div>
    </${Panel}>
    <div class="engine-two">
      <${Panel} id="rs-h" title="Что получается" hint="Результат последнего цикла">
        <h3>Решения за час</h3><${Bars} rows=${kindRows} />
        <h3>Поезда по категориям</h3><${Bars} rows=${[{ label: 'Пассажирские', value: sample.passenger }, { label: 'Контейнерные', value: sample.container }, { label: 'Грузовые', value: sample.freight }]} />
        <h3>Состояние</h3><${Bars} rows=${[{ label: 'В пути', value: sample.moving }, { label: 'Плановая стоянка', value: sample.planned }, { label: 'Вынужденная стоянка', value: sample.forced, tone: 'danger' }]} />
        <h3>Тяга</h3><${Bars} rows=${[{ label: 'Электровозы', value: sample.electric }, { label: 'Тепловозы', value: sample.diesel }]} />
      </${Panel}>
      <${Panel} id="hm-h" title="Нагрузка на ближайшие 24 часа" hint="Отправления по 20 самым загруженным маршрутам, время Алматы"><${Heatmap} sim=${sim} now=${sample.now} /></${Panel}>
    </div>
    <${Panel} id="fm-h" title="Полная формула модели" hint=${`Все уравнения и все переменные, ${MODEL_FACTORS.length} факторов проверены по коду ${FACTOR_AUDIT_DATE}`}>
      <${FormulaBook} sample=${sample} ctx=${ctx} />
    </${Panel}>
    <${Panel} id="ch-h" title="Характеристики модели" hint="Параметры, масштаб, правила и границы применимости">
      <${Characteristics} sim=${sim} stations=${net && !net.error ? net.net.stations.length + net.net.halts.length : 0} counters=${counters} startedAt=${startedAt} />
    </${Panel}>`;
}
