// Карточки этапов модели: список метрик этапа с временем расчёта, графиком за минуту и раскрывающимся описанием.
import { html, Icon } from './lib.js';
import { Sparkline, fmt } from './engine-widgets.js';

export const BUDGET = { green: 30, yellow: 80 };          // мс на этап
export const aspectOf = ms => (ms < BUDGET.green ? 'green' : ms < BUDGET.yellow ? 'yellow' : 'red');

/** Строка метрики этапа: значение, доля времени цикла, график за минуту и раскрывающееся описание. */
export function MetricRow({ row, sample, ctx, samples, open, onToggle }) {
  const v = row.value(sample, ctx), ms = row.ms ? row.ms(sample) : null;
  const series = row.numeric === false ? [] : samples.map(s => row.value(s, ctx)).filter(x => typeof x === 'number');
  return html`<li class=${`mrow ${open ? 'open' : ''}`}>
    <button type="button" class="mrow-head" aria-expanded=${open} onClick=${onToggle}>
      <span class="mrow-label">${row.label}</span>
      <span class="mrow-value num">${fmt(v)}${row.unit ? html`<small> ${row.unit}</small>` : ''}</span>
      <span class="mrow-meta">${ms != null ? html`<span class="num" title="Время расчёта в последнем цикле">${ms.toFixed(1)} мс</span>` : ''}
        <${Sparkline} values=${series.slice(-60)} width=${96} height=${20} fill=${false} label=${`Динамика: ${row.label}`} /><${Icon} name=${open ? 'chevron-up' : 'chevron-down'} size=${14} class="mrow-chev" /></span>
    </button>
    ${open && html`<div class="mrow-detail"><p>${row.hint}</p><code>${row.formula}</code></div>`}</li>`;
}

/** Карточка этапа: заголовок, суммарное время и список метрик. */
export function StageCard({ stage, index, sample, ctx, samples, openId, onToggle }) {
  const ms = stage.ms(sample);
  return html`<section class="stage-card" aria-labelledby=${`stg-${stage.id}`}>
    <header><span class="stage-num">${index + 1}</span><div><h3 id=${`stg-${stage.id}`}>${stage.title}</h3><small>${stage.caption}</small></div>
      ${ms > 0 ? html`<span class=${`stage-ms ${aspectOf(ms)}`}><b class="num">${ms.toFixed(1)}</b> мс</span>` : ''}</header>
    <ul class="mrows">${stage.rows.map(r => html`<${MetricRow} key=${r.id} row=${r} sample=${sample} ctx=${ctx} samples=${samples} open=${openId === r.id} onToggle=${() => onToggle(openId === r.id ? null : r.id)} />`)}</ul>
  </section>`;
}
