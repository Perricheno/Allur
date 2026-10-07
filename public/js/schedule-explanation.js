import { html, time, dateShort } from './lib.js';
const stamp = t => t == null ? 'Нет назначения' : `${dateShort(t)} ${time(t)}`;
const fmt = n => Math.round(n * 10) / 10;
export function ScheduleExplanation({ row: r, baseline, plan }) {
  const delta = baseline?.status === 'assigned' && r.status === 'assigned' ? baseline.waitMin - r.waitMin : null;
  return html`<div class="schedule-explanation">
    <h4>№${r.number}: что изменилось</h4><dl class="detail-grid">
      <div><dt>Фиксированный слот</dt><dd>${stamp(r.departedMs)}</dd></div>
      <div><dt>Отправление по плану</dt><dd>${stamp(r.departure)}${r.departure ? ` · сдвиг +${fmt(r.waitMin)} мин` : ''}</dd></div>
      <div><dt>Прибытие: исходное → план</dt><dd>${stamp(r.arrivesMs)} → ${stamp(r.arrival)}</dd></div>
      <div><dt>Эффект против базовой очереди</dt><dd>${delta === null ? 'Нет сопоставимого назначения' : `${delta >= 0 ? 'Меньше' : 'Больше'} ожидания на ${fmt(Math.abs(delta))} мин; ${fmt(delta * r.wagons / 60)} ваг·ч высвобождено`}</dd></div>
    </dl><p>${r.reason}</p>
    ${r.proposedDeparture && html`<p class="bad">Отклонённый вариант: ${stamp(r.proposedDeparture)}, сдвиг +${fmt(r.proposedWaitMin)} мин. Он не принят как новое время отправления. Локомотив: ${r.proposedLoco}.</p>`}
    ${r.timing && html`<h4>Что ограничило отправление</h4><ul class="plain-list">
      <li>Не раньше фиксированного слота: ${stamp(r.timing.scheduled)}.</li>
      <li>Готовность тяги и ${plan.config.couplingMin} мин подготовки: ${stamp(r.timing.readyWithPreparation)}.</li>
      ${r.timing.headwaySlot && html`<li>Интервал после предыдущего назначения: не раньше ${stamp(r.timing.headwaySlot)}.</li>`}
      ${r.timing.constraints.map((c, i) => html`<li key=${i}>${c.reason}: ${stamp(c.from)} — ${stamp(c.until)}.</li>`)}
    </ul>`}
    ${r.search ? html`<h4>Как выбирала модель</h4><p>${r.search.scope}</p>
      <p>Пул: ${r.search.fleetSize}. Совместимых вариантов: ${r.search.options.length}. Исключено по первой неподходящей проверке: другая станция — ${r.search.rejected.station}; вид тяги — ${r.search.rejected.traction}; назначение — ${r.search.rejected.purpose}; масса — ${r.search.rejected.mass}.</p>
      <p>${r.search.algorithm === 'first-ready' ? 'Базовая очередь: первым выбирается раньше освободившийся локомотив.' : 'Сначала — наиболее раннее допустимое отправление. При равенстве — тяга, готовая ближе к отправлению; при полном равенстве — стабильный порядок по номеру. Это последовательный подбор, не доказанный глобальный оптимум.'}</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Вариант</th><th>Готов</th><th>Отправление</th><th>Ожидание</th><th>Результат</th></tr></thead><tbody>${r.search.options.map(o => html`<tr key=${o.id}><td>${o.series}<small> · ${o.id}</small></td><td>${stamp(o.ready)}</td><td>${stamp(o.departure)}</td><td>${fmt(o.waitMin)} мин</td><td>${o.id === r.locoId ? 'Выбран' : 'Не выбран по порядку критериев'}</td></tr>`)}</tbody></table></div>
    ` : html`<p>Для этой старой записи варианты выбора не сохранены. Новые назначения содержат полный разбор.</p>`}
    <p class="muted">Топливо не приписывается одному сдвигу: эффект энергии проверяется по всему пулу, включая резерв. Задержка из-за ремонта может увеличить затраты — это не экономия.</p>
  </div>`;
}
