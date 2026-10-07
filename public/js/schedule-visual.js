import { useState } from 'preact/hooks';
import { html, time } from './lib.js';
import { Button } from './ui.js';
import { SERVICE_TYPES } from './schedule-disruptions.js';
import { ScheduleExplanation } from './schedule-explanation.js';

export function ScheduleChanges({ plan }) {
  const changes = [...(plan?.changes || [])].reverse();
  return html`<section class="panel"><div class="panel-head"><h2>Изменения расписания</h2><span>Ревизия ${plan?.revision || 0}</span></div><div class="tab-panel">
    ${changes.length ? changes.map(c => html`<details key=${c.id}><summary>${time(c.at)} · ${c.reason} · изменено ${c.changes.length} рейсов</summary>
      <p>Проверено маршрутов: ${c.routes.length}. Сохранено без изменений: ${c.frozen} рейсов.</p>
      <ul>${c.changes.map(r => html`<li key=${r.uid}>№${r.number}: ${r.oldDeparture ? new Date(r.oldDeparture).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }) : 'без тяги'} → ${r.departure ? new Date(r.departure).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }) : 'слот не обеспечен; автоматический перенос отклонён'}; ${r.oldLoco === r.locoId ? 'тяга сохранена' : 'тяга заменена'}. ${r.deltaMin != null ? `Изменение ${Math.round(r.deltaMin)} мин. ${r.wagonHoursDelta >= 0 ? 'Дополнительное ожидание' : 'Сокращение ожидания'} ${Math.round(Math.abs(r.wagonHoursDelta))} ваг·ч.` : ''}</li>`)}</ul>
    </details>`) : html`<p>Локальных изменений пока нет. Здесь появится объяснение каждого пересчёта после неисправности или обслуживания.</p>`}
  </div></section>`;
}

export function ScheduleVisual({ plan, now }) {
  const [route, setRoute] = useState(''), [selected, setSelected] = useState(null);
  const allRoutes = [...new Map(plan.optimized.rows.map(r => [r.routeId, r.route])).entries()];
  const current = route || allRoutes[0]?.[0];
  const rows = plan.optimized.rows.filter(r => r.routeId === current).sort((a, b) => a.departedMs - b.departedMs).slice(0, 30);
  const start = plan.createdAt, end = Math.max(start + plan.config.horizonH * 3600000, ...rows.map(r => r.arrival || r.arrivesMs));
  const x = t => 100 + (t - start) / (end - start) * 850;
  return html`<section class="panel"><div class="panel-head"><div><h2>График рейсов</h2><small>Голубой — обеспеченное назначение; контур — исходный слот без тяги; красный отрезок — принятый сдвиг. Нажмите поезд: варианты, причины и эффект.</small></div>
    <select aria-label="Маршрут графика" value=${current} onChange=${e => { setRoute(e.target.value); setSelected(null); }}>${allRoutes.map(([id, name]) => html`<option value=${id}>${name}</option>`)}</select></div>
    <div class="table-wrap"><svg viewBox=${`0 0 1000 ${60 + rows.length * 32}`} style="min-width:780px;width:100%" role="img" aria-label="Временной график рейсов выбранного маршрута">
      ${Array.from({ length: 9 }, (_, i) => { const t = start + (end - start) * i / 8; return html`<g><line x1=${x(t)} x2=${x(t)} y1="28" y2=${50 + rows.length * 32} stroke="var(--line)" /><text x=${x(t)} y="20" font-size="12" fill="var(--text-3)">${time(t)}</text></g>`; })}
      ${rows.map((r, i) => html`<g key=${r.uid} role="button" tabindex="0" aria-label=${`Поезд ${r.number}, ${time(r.departure)} — ${time(r.arrival)}`} onClick=${() => setSelected(r.uid)} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r.uid); } }}>
        <title>№${r.number} ${r.from} → ${r.to}. ${r.reason}</title><text x="10" y=${52 + i * 32} fill="var(--text)" font-size="12">№${r.number}</text>
        ${r.departure && html`<line x1=${x(r.departedMs)} x2=${x(r.departure)} y1=${48 + i * 32} y2=${48 + i * 32} stroke="var(--danger)" stroke-width="5" />`}
        <rect x=${x(r.departure || r.departedMs)} y=${40 + i * 32} width=${Math.max(3, x(r.arrival || r.arrivesMs) - x(r.departure || r.departedMs))} height="16" rx="4" fill=${r.departure ? selected === r.uid ? 'var(--accent-ink)' : 'var(--accent)' : 'transparent'} stroke=${r.departure ? 'none' : 'var(--danger)'} stroke-dasharray=${r.departure ? null : '4 3'} />
      </g>`)}
      ${now >= start && now <= end && html`<line x1=${x(now)} x2=${x(now)} y1="28" y2=${50 + rows.length * 32} stroke="var(--text)" stroke-dasharray="4 3" />`}
    </svg></div>
    <p class="muted pad">Показаны первые ${rows.length} рейсов участка. Время — Астана; дата и полный разбор доступны по нажатию.</p>
    ${selected && html`<div class="tab-panel">${rows.filter(r => r.uid === selected).map(r => html`<${ScheduleExplanation} row=${r} baseline=${plan.baseline.rows.find(b => b.uid === r.uid)} plan=${plan} />`)}</div>`}
  </section>`;
}

export function MaintenanceControls({ plan }) {
  const [loco, setLoco] = useState(''), [service, setService] = useState('daily'), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/schedule-incident', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locoId: loco, service }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setMessage(`Пересчёт завершён: ${data.plan.changes.at(-1).changes.length} изменённых назначений. Остальные рейсы сохранены.`);
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  return html`<section class="panel"><div class="panel-head"><h2>Обслуживание и внеплановые работы</h2></div><div class="tab-panel">
    <p>Выберите тягу и работы. План автоматически проверит следующие назначения и доступную замену. Продолжительность ниже — настройка вида работ, не единая норма для всех серий.</p>
    <div class="filter-row"><select aria-label="Локомотив для обслуживания" value=${loco} onChange=${e => setLoco(e.target.value)}><option value="">Выберите локомотив</option>${plan.fleet.map(l => html`<option value=${l.id}>${l.series} · ${l.station} · ${l.id}</option>`)}</select>
    <select aria-label="Вид обслуживания" value=${service} onChange=${e => setService(e.target.value)}>${Object.entries(SERVICE_TYPES).map(([id, s]) => html`<option value=${id}>${s.label} · ${s.minutes / 60} ч</option>`)}</select>
    <${Button} disabled=${!loco} pending=${busy} onClick=${send}>Назначить работы и пересчитать</${Button}></div><p role="status">${message}</p>
    ${(plan.constraints || []).length > 0 && html`<ul>${plan.constraints.map(c => html`<li key=${c.id}>${c.reason}: ${c.locoId || c.routeId} · до ${new Date(c.until).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}</li>`)}</ul>`}
  </div></section>`;
}
